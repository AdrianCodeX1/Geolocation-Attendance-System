const express = require('express');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const totp = require('../services/totp');
const HttpError = require('../utils/httpError');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const A = config.attendance;

// Load a session and make sure the caller owns it (admins can see all).
async function getOwnedSession(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid session id.');
  const { rows } = await db.query(
    `SELECT *, (is_active AND expires_at > now()) AS live FROM attendance_sessions WHERE session_id = $1`, [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found.');
  if (req.user.role !== 'admin' && s.lecturer_id !== req.user.id) throw new HttpError(403, 'Not your session.');
  return s;
}

// 1. Launch a session (lecturer). Anchors the geofence at the lecturer's current location.
router.post(
  '/launch',
  requireRole('lecturer', 'admin'),
  validate(z.object({
    timetable_id: z.number().int().positive(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })),
  async (req, res, next) => {
    try {
      const { timetable_id, latitude, longitude } = req.body;

      const { rows } = await db.query(
        `SELECT t.*,
                (lower(trim(to_char(now() AT TIME ZONE $2, 'FMDay'))) = lower(t.day_of_week)) AS right_day,
                (EXTRACT(EPOCH FROM (now() AT TIME ZONE $2)::time) / 60
                   BETWEEN EXTRACT(EPOCH FROM t.start_time) / 60 - $3
                       AND EXTRACT(EPOCH FROM t.end_time) / 60) AS in_window,
                ST_Distance(
                  ST_SetSRID(ST_MakePoint(t.room_longitude, t.room_latitude), 4326)::geography,
                  ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography) AS lecturer_to_room
           FROM timetables t WHERE t.timetable_id = $1`,
        [timetable_id, A.timezone, A.earlyMinutes, latitude, longitude]
      );
      const t = rows[0];
      if (!t) throw new HttpError(404, 'Timetable entry not found.');
      if (req.user.role !== 'admin' && t.lecturer_id !== req.user.id) {
        throw new HttpError(403, 'This timetable slot is not assigned to you.');
      }
      if (A.enforceSchedule && !(t.right_day && t.in_window)) {
        throw new HttpError(400, `Outside the scheduled slot (${t.day_of_week} ${t.start_time}-${t.end_time}).`);
      }
      if (t.lecturer_to_room > A.lecturerRoomTolerance) {
        throw new HttpError(400,
          `You are ${t.lecturer_to_room.toFixed(0)}m from ${t.room_name}. Launch the session from inside the room.`);
      }

      const secret = totp.generateSecret();
      // Only one live session per timetable slot.
      await db.query(`UPDATE attendance_sessions SET is_active = FALSE WHERE timetable_id = $1 AND is_active`, [timetable_id]);
      const ins = await db.query(
        `INSERT INTO attendance_sessions
           (timetable_id, lecturer_id, current_totp_secret, anchor_latitude, anchor_longitude,
            anchor_location, radius_meters, expires_at)
         VALUES ($1,$2,$3,$4::float8,$5::float8, ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography, $6,
                 now() + make_interval(mins => $7))
         RETURNING session_id, launched_at, expires_at, radius_meters`,
        [timetable_id, t.lecturer_id, secret, latitude, longitude, t.allowed_radius_meters || 20, A.sessionMinutes]
      );
      const s = ins.rows[0];
      res.status(201).json({
        status: 'success',
        session_id: s.session_id,
        radius_meters: s.radius_meters,
        expires_at: s.expires_at,
        current_code: totp.generate(secret),
        code_step_seconds: totp.step,
      });
    } catch (e) { next(e); }
  }
);

// 2. Current rotating code for the lecturer's screen/QR (poll every ~1-2s).
router.get('/:id/code', requireRole('lecturer', 'admin'), async (req, res, next) => {
  try {
    const s = await getOwnedSession(req);
    if (!s.live) throw new HttpError(410, 'Session has ended.');
    const code = totp.generate(s.current_totp_secret);
    res.json({
      session_id: s.session_id,
      code,
      seconds_remaining: totp.secondsRemaining(),
      step_seconds: totp.step,
      // Put this string in the QR so students' scanners can read both values at once.
      qr_payload: JSON.stringify({ s: s.session_id, c: code }),
    });
  } catch (e) { next(e); }
});

// 3. End a session early.
router.post('/:id/end', requireRole('lecturer', 'admin'), async (req, res, next) => {
  try {
    const s = await getOwnedSession(req);
    await db.query('UPDATE attendance_sessions SET is_active = FALSE WHERE session_id = $1', [s.session_id]);
    res.json({ status: 'success', message: 'Session ended.' });
  } catch (e) { next(e); }
});

// 4. Live attendance list for a session.
router.get('/:id/attendance', requireRole('lecturer', 'admin'), async (req, res, next) => {
  try {
    const s = await getOwnedSession(req);
    const { rows } = await db.query(
      `SELECT u.user_id AS student_id, u.full_name, u.email, r.status, r.check_in_time,
              r.distance_from_lecturer_meters AS distance_meters
         FROM attendance_records r JOIN users u ON u.user_id = r.student_id
        WHERE r.session_id = $1 ORDER BY r.check_in_time`, [s.session_id]);
    const total = await db.query(
      `SELECT count(*)::int AS n FROM enrollments e
         JOIN timetables t ON t.course_id = e.course_id WHERE t.timetable_id = $1`, [s.timetable_id]);
    res.json({ session_id: s.session_id, live: s.live, present: rows.length, enrolled: total.rows[0].n, records: rows });
  } catch (e) { next(e); }
});

// 5. The lecturer's recent sessions.
router.get('/mine', requireRole('lecturer', 'admin'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.session_id, s.timetable_id, c.course_code, t.room_name, s.launched_at, s.expires_at,
              (s.is_active AND s.expires_at > now()) AS live,
              (SELECT count(*)::int FROM attendance_records r WHERE r.session_id = s.session_id) AS present
         FROM attendance_sessions s
         JOIN timetables t ON t.timetable_id = s.timetable_id
         JOIN courses c ON c.course_id = t.course_id
        WHERE s.lecturer_id = $1 ORDER BY s.launched_at DESC LIMIT 50`, [req.user.id]);
    res.json({ sessions: rows });
  } catch (e) { next(e); }
});

// 6. Student: which live sessions can I check in to? (replaces typing a session ID by hand)
router.get('/active', requireRole('student'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.session_id, c.course_code, c.course_name, t.room_name, s.launched_at, s.expires_at,
              EXISTS (SELECT 1 FROM attendance_records r
                       WHERE r.session_id = s.session_id AND r.student_id = $1) AS already_checked_in
         FROM attendance_sessions s
         JOIN timetables t ON t.timetable_id = s.timetable_id
         JOIN courses c ON c.course_id = t.course_id
         JOIN enrollments e ON e.course_id = c.course_id AND e.student_id = $1
        WHERE s.is_active AND s.expires_at > now()
        ORDER BY s.launched_at DESC`, [req.user.id]);
    res.json({ sessions: rows });
  } catch (e) { next(e); }
});

module.exports = router;
