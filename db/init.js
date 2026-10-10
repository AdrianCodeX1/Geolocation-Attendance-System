require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Schema applied.');

  if (process.argv.includes('--seed')) {
    await pool.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
    const hash = await bcrypt.hash('Password123!', 10);
    const users = [
      ['admin@mulungushi.edu.zm', 'System Admin', 'admin'],
      ['lecturer@mulungushi.edu.zm', 'Demo Lecturer', 'lecturer'],
      ['student1@mulungushi.edu.zm', 'Demo Student One', 'student'],
      ['student2@mulungushi.edu.zm', 'Demo Student Two', 'student'],
    ];
    for (const [email, name, role] of users) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
        [email, hash, name, role]
      );
    }
    await pool.query(`
      INSERT INTO enrollments (course_id, student_id)
      SELECT c.course_id, u.user_id FROM courses c, users u
      WHERE c.course_code = 'ICT481' AND u.role = 'student'
      ON CONFLICT DO NOTHING`);
    // A slot open all day, every day, so you can test any time.
    // Replace the coordinates with a real surveyed point before field tests.
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    for (const d of days) {
      await pool.query(`
        INSERT INTO timetables (course_id, lecturer_id, day_of_week, start_time, end_time,
                                room_name, room_latitude, room_longitude, allowed_radius_meters)
        SELECT c.course_id, l.user_id, $1::varchar, '00:00', '23:59', 'Demo Room',
               -14.4380000, 28.4460000, 20
        FROM courses c, users l
        WHERE c.course_code = 'ICT481' AND l.email = 'lecturer@mulungushi.edu.zm'
          AND NOT EXISTS (SELECT 1 FROM timetables t WHERE t.day_of_week = $1::varchar AND t.room_name = 'Demo Room')`,
        [d]);
    }
    console.log('Seed data inserted (password for all demo users: Password123!).');
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
