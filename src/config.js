require('dotenv').config();

const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

const config = {
  port: int(process.env.PORT, 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  allowedEmailDomains: (process.env.ALLOWED_EMAIL_DOMAINS || 'mulungushi.edu.zm')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
  totp: {
    step: int(process.env.TOTP_STEP, 5),
    window: int(process.env.TOTP_WINDOW, 2),
  },
  attendance: {
    sessionMinutes: int(process.env.SESSION_DURATION_MINUTES, 120),
    lateAfterMinutes: int(process.env.LATE_AFTER_MINUTES, 15),
    maxGpsAccuracy: int(process.env.MAX_GPS_ACCURACY_METERS, 50),
    lecturerRoomTolerance: int(process.env.LECTURER_ROOM_TOLERANCE_METERS, 50),
    enforceSchedule: bool(process.env.ENFORCE_SCHEDULE, true),
    earlyMinutes: int(process.env.SCHEDULE_EARLY_MINUTES, 15),
    timezone: process.env.TIMEZONE || 'Africa/Lusaka',
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET must be set (16+ chars). Copy .env.example to .env.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL must be set.');

module.exports = config;
