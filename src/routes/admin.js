const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const validate = require('../middleware/validate');
const HttpError = require('../utils/httpError');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.post('/users', validate(z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  full_name: z.string().trim().min(2).max(150),
  role: z.enum(['student', 'lecturer', 'admin']),
})), async (req, res, next) => {
  try {
    const { email, password, full_name, role } = req.body;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)
       RETURNING user_id, email, full_name, role`,
      [email, await bcrypt.hash(password, 10), full_name, role]);
    res.status(201).json({ user: rows[0] });
  } catch (e) { next(e); }
});

router.post('/courses', validate(z.object({
  course_code: z.string().trim().min(2).max(50),
  course_name: z.string().trim().min(2).max(150),
})), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'INSERT INTO courses (course_code, course_name) VALUES ($1,$2) RETURNING *',
      [req.body.course_code.toUpperCase(), req.body.course_name]);
    res.status(201).json({ course: rows[0] });
  } catch (e) { next(e); }
});

router.post('/timetables', validate(z.object({
  course_id: z.number().int().positive(),
  lecturer_id: z.number().int().positive(),
  day_of_week: z.enum(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  room_name: z.string().trim().min(1).max(100),
  room_latitude: z.number().min(-90).max(90),
  room_longitude: z.number().min(-180).max(180),
  allowed_radius_meters: z.number().int().min(5).max(200).default(20),
})), async (req, res, next) => {
  try {
    const b = req.body;
    const lec = await db.query(`SELECT 1 FROM users WHERE user_id = $1 AND role = 'lecturer'`, [b.lecturer_id]);
    if (!lec.rowCount) throw new HttpError(400, 'lecturer_id must belong to a lecturer.');
    const { rows } = await db.query(
      `INSERT INTO timetables (course_id, lecturer_id, day_of_week, start_time, end_time, room_name,
                               room_latitude, room_longitude, allowed_radius_meters)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.course_id, b.lecturer_id, b.day_of_week, b.start_time, b.end_time, b.room_name,
       b.room_latitude, b.room_longitude, b.allowed_radius_meters]);
    res.status(201).json({ timetable: rows[0] });
  } catch (e) { next(e); }
});

// Enrol students by email in one call.
router.post('/enrollments', validate(z.object({
  course_id: z.number().int().positive(),
  student_emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(1000),
})), async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      `INSERT INTO enrollments (course_id, student_id)
       SELECT $1, user_id FROM users WHERE role = 'student' AND email = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [req.body.course_id, req.body.student_emails]);
    res.status(201).json({ enrolled: rowCount });
  } catch (e) { next(e); }
});

// Per-course attendance report.
router.get('/reports/course/:courseId', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.full_name, u.email,
              count(r.record_id) FILTER (WHERE r.status = 'Present')::int AS present,
              count(r.record_id) FILTER (WHERE r.status = 'Late')::int AS late,
              (SELECT count(*)::int FROM attendance_sessions s2 JOIN timetables t2 ON t2.timetable_id = s2.timetable_id
                WHERE t2.course_id = $1) AS total_sessions
         FROM enrollments e
         JOIN users u ON u.user_id = e.student_id
         LEFT JOIN attendance_sessions s ON s.session_id IN
              (SELECT s3.session_id FROM attendance_sessions s3 JOIN timetables t3 ON t3.timetable_id = s3.timetable_id
                WHERE t3.course_id = $1)
         LEFT JOIN attendance_records r ON r.session_id = s.session_id AND r.student_id = e.student_id
        WHERE e.course_id = $1
        GROUP BY u.user_id ORDER BY u.full_name`, [req.params.courseId]);
    res.json({ report: rows });
  } catch (e) { next(e); }
});

module.exports = router;
