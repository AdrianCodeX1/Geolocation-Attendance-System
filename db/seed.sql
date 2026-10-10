-- Demo course. Users/timetables are created in db/init.js (needs password hashing).
INSERT INTO courses (course_code, course_name) VALUES
    ('ICT481', 'ICT Project Management')
ON CONFLICT DO NOTHING;
