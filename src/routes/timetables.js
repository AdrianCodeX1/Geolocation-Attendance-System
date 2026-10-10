const express = require('express');
const db = require('../db');
const config = require('../config');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// The lecturer's slots, flagged with whether each one is open for launching right now.
router.get('/mine', requireRole('lecturer'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.timetable_id, c.course_code, c.course_name, t.day_of_week, t.start_time, t.end_time,
              t.room_name, t.allowed_radius_meters,
              (lower(trim(to_char(now() AT TIME ZONE $2, 'FMDay'))) = lower(t.day_of_week)
               AND EXTRACT(EPOCH FROM (now() AT TIME ZONE $2)::time) / 60
                   BETWEEN EXTRACT(EPOCH FROM t.start_time) / 60 - $3 AND EXTRACT(EPOCH FROM t.end_time) / 60
              ) AS open_now
         FROM timetables t JOIN courses c ON c.course_id = t.course_id
        WHERE t.lecturer_id = $1 ORDER BY t.day_of_week, t.start_time`,
      [req.user.id, config.attendance.timezone, config.attendance.earlyMinutes]);
    res.json({ timetables: rows });
  } catch (e) { next(e); }
});

module.exports = router;
