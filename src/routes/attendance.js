const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const totp = require('../services/totp');
const HttpError = require('../utils/httpError');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('student'));

const A = config.attendance;

// Per-student limiter: stops brute-forcing the 6-digit code.
const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `student-${req.user.id}`,
});

async function logAttempt(session_id, student_id, outcome, b, distance = null) {
  await db.query(
    `INSERT INTO attendance_attempts
       (session_id, student_id, outcome, student_latitude, student_longitude, gps_accuracy_m, distance_meters)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [session_id, student_id, outcome, b.student_lat, b.student_lon, b.accuracy ?? null, distance]
  );
}

const checkInSchema = z.object({
  session_id: z.number().int().positive(),
  totp_code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits.'),
  student_lat: z.number().min(-90).max(90),
  student_lon: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),      // coords.accuracy from the browser (meters)
  is_mock_location: z.boolean().optional().default(false),
});

router.post('/check-in', checkInLimiter, validate(checkInSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const studentId = req.user.id; // identity comes from the JWT, never the request body

    // Session + enrolment + geofence distance (PostGIS) in one round trip.
    const { rows } = await db.query(
      `SELECT s.session_id, s.current_totp_secret, s.radius_meters,
              ST_Distance(s.anchor_location, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography) AS distance,
              (now() > s.launched_at + make_interval(mins => $4)) AS is_late,
              EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = t.course_id AND e.student_id = $5) AS enrolled
         FROM attendance_sessions s JOIN timetables t ON t.timetable_id = s.timetable_id
        WHERE s.session_id = $1 AND s.is_active AND s.expires_at > now()`,
      [b.session_id, b.student_lat, b.student_lon, A.lateAfterMinutes, studentId]
    );
    const s = rows[0];
    if (!s) throw new HttpError(404, 'Session not found or no longer active.');

    if (!s.enrolled) {
      await logAttempt(s.session_id, studentId, 'Rejected_NotEnrolled', b);
      throw new HttpError(403, 'You are not enrolled in this course.');
    }

    const dup = await db.query(
      'SELECT 1 FROM attendance_records WHERE session_id = $1 AND student_id = $2', [s.session_id, studentId]);
    if (dup.rowCount) throw new HttpError(409, 'You have already checked in to this session.');

    if (b.is_mock_location) {
      await logAttempt(s.session_id, studentId, 'Rejected_MockGPS', b);
      throw new HttpError(400, 'Check-in rejected: mock GPS location detected.');
    }

    if (b.accuracy !== undefined && b.accuracy > A.maxGpsAccuracy) {
      await logAttempt(s.session_id, studentId, 'Rejected_Accuracy', b);
      throw new HttpError(400,
        `GPS signal too weak (±${Math.round(b.accuracy)}m). Move near a window or outdoors and try again.`);
    }

    if (!totp.check(b.totp_code, s.current_totp_secret)) {
      await logAttempt(s.session_id, studentId, 'Rejected_Code', b);
      throw new HttpError(400, 'Invalid or expired code. Scan or enter the latest code.');
    }

    const distance = Number(s.distance);
    if (distance > s.radius_meters) {
      await logAttempt(s.session_id, studentId, 'Rejected_Distance', b, distance);
      throw new HttpError(400, `Out of range. You are ${distance.toFixed(1)}m from the lecturer (limit ${s.radius_meters}m).`);
    }

    const status = s.is_late ? 'Late' : 'Present';
    const ins = await db.query(
      `INSERT INTO attendance_records
         (session_id, student_id, status, student_latitude, student_longitude, distance_from_lecturer_meters)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id, student_id) DO NOTHING
       RETURNING record_id, check_in_time`,
      [s.session_id, studentId, status, b.student_lat, b.student_lon, distance.toFixed(2)]
    );
    if (!ins.rowCount) throw new HttpError(409, 'You have already checked in to this session.');

    await logAttempt(s.session_id, studentId, 'Accepted', b, distance);
    res.status(201).json({
      status: 'success',
      message: `Attendance recorded (${status}).`,
      attendance_status: status,
      distance_meters: Number(distance.toFixed(2)),
      check_in_time: ins.rows[0].check_in_time,
    });
  } catch (e) { next(e); }
});

// A student's own attendance history.
router.get('/me', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.record_id, c.course_code, c.course_name, r.status, r.check_in_time,
              r.distance_from_lecturer_meters AS distance_meters
         FROM attendance_records r
         JOIN attendance_sessions s ON s.session_id = r.session_id
         JOIN timetables t ON t.timetable_id = s.timetable_id
         JOIN courses c ON c.course_id = t.course_id
        WHERE r.student_id = $1 ORDER BY r.check_in_time DESC LIMIT 200`, [req.user.id]);
    res.json({ records: rows });
  } catch (e) { next(e); }
});

module.exports = router;
