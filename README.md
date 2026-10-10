# Attendance System – Backend (Node.js + Express + PostGIS)

## Quick start
```bash
cp .env.example .env        # set DATABASE_URL and a long JWT_SECRET
npm install
npm run db:seed             # applies db/schema.sql + demo users (password: Password123!)
npm run dev                 # http://localhost:5000/api/health
npm test
```
Needs PostgreSQL with the PostGIS extension available.

Demo logins: `admin@`, `lecturer@`, `student1@`, `student2@` + `mulungushi.edu.zm`.
The seed creates a timetable slot open all day with a placeholder room at (-14.438, 28.446).
Replace it with a real surveyed point before field tests.

## Endpoints (all JSON; send `Authorization: Bearer <token>`)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /api/auth/register | public | Student self-registration (institutional email only) |
| POST | /api/auth/login | public | Returns `{user, token}`; role comes from the DB |
| GET | /api/auth/me | any | Current user |
| GET | /api/timetables/mine | lecturer | Own slots, with `open_now` flag |
| POST | /api/sessions/launch | lecturer | `{timetable_id, latitude, longitude}` -> starts session, anchors geofence |
| GET | /api/sessions/:id/code | lecturer | Current rotating code + `qr_payload` (poll every 1-2s) |
| POST | /api/sessions/:id/end | lecturer | End session |
| GET | /api/sessions/:id/attendance | lecturer | Live attendance list |
| GET | /api/sessions/mine | lecturer | Recent sessions |
| GET | /api/sessions/active | student | Live sessions for courses I'm enrolled in |
| POST | /api/attendance/check-in | student | `{session_id, totp_code, student_lat, student_lon, accuracy, is_mock_location}` |
| GET | /api/attendance/me | student | My history |
| POST | /api/admin/users, /courses, /timetables, /enrollments | admin | Setup data |
| GET | /api/admin/reports/course/:courseId | admin | Per-student present/late counts |

## Check-in validation order
session live -> enrolled -> not already checked in -> mock-GPS flag -> GPS accuracy
-> TOTP code -> PostGIS distance <= radius. Every attempt is written to `attendance_attempts`.
