-- Dynamic Schedule-Aware and Proximity-Verified Attendance System
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    user_id        SERIAL PRIMARY KEY,
    email          VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    full_name      VARCHAR(150) NOT NULL,
    role           VARCHAR(50) NOT NULL CHECK (role IN ('student', 'lecturer', 'admin')),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
    course_id    SERIAL PRIMARY KEY,
    course_code  VARCHAR(50) UNIQUE NOT NULL,
    course_name  VARCHAR(150) NOT NULL
);

-- Which students belong to which course (added: needed to authorise check-ins)
CREATE TABLE IF NOT EXISTS enrollments (
    course_id   INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    student_id  INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS timetables (
    timetable_id           SERIAL PRIMARY KEY,
    course_id              INT REFERENCES courses(course_id) ON DELETE CASCADE,
    lecturer_id            INT REFERENCES users(user_id) ON DELETE CASCADE,
    day_of_week            VARCHAR(20) NOT NULL,
    start_time             TIME NOT NULL,
    end_time               TIME NOT NULL,
    room_name              VARCHAR(100) NOT NULL,
    room_latitude          DECIMAL(10, 8) NOT NULL,
    room_longitude         DECIMAL(11, 8) NOT NULL,
    allowed_radius_meters  INT DEFAULT 20
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
    session_id           SERIAL PRIMARY KEY,
    timetable_id         INT REFERENCES timetables(timetable_id) ON DELETE CASCADE,
    lecturer_id          INT REFERENCES users(user_id) ON DELETE CASCADE,
    is_active            BOOLEAN DEFAULT TRUE,
    current_totp_secret  VARCHAR(100) NOT NULL,
    -- Lecturer's live position when the session was launched (the geofence anchor)
    anchor_latitude      DECIMAL(10, 8) NOT NULL,
    anchor_longitude     DECIMAL(11, 8) NOT NULL,
    anchor_location      GEOGRAPHY(Point, 4326) NOT NULL,
    radius_meters        INT NOT NULL,
    launched_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at           TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON attendance_sessions (is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_anchor ON attendance_sessions USING GIST (anchor_location);

-- Only accepted check-ins live here (Present / Late).
CREATE TABLE IF NOT EXISTS attendance_records (
    record_id                      SERIAL PRIMARY KEY,
    session_id                     INT REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    student_id                     INT REFERENCES users(user_id) ON DELETE CASCADE,
    check_in_time                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status                         VARCHAR(50) NOT NULL CHECK (status IN ('Present', 'Late')),
    student_latitude               DECIMAL(10, 8),
    student_longitude              DECIMAL(11, 8),
    distance_from_lecturer_meters  DECIMAL(8, 2),
    CONSTRAINT unique_student_session UNIQUE (session_id, student_id)
);

-- Audit log of every attempt, including rejected ones. Kept separate so a rejected
-- attempt never blocks a later valid check-in (unique constraint above).
CREATE TABLE IF NOT EXISTS attendance_attempts (
    attempt_id         SERIAL PRIMARY KEY,
    session_id         INT REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    student_id         INT REFERENCES users(user_id) ON DELETE CASCADE,
    attempted_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    outcome            VARCHAR(50) NOT NULL CHECK (outcome IN
        ('Accepted', 'Rejected_Distance', 'Rejected_MockGPS', 'Rejected_Code', 'Rejected_Accuracy', 'Rejected_NotEnrolled')),
    student_latitude   DECIMAL(10, 8),
    student_longitude  DECIMAL(11, 8),
    gps_accuracy_m     DECIMAL(8, 2),
    distance_meters    DECIMAL(8, 2)
);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attendance_attempts (session_id, student_id);
