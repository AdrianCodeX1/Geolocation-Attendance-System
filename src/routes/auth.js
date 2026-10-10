const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const HttpError = require('../utils/httpError');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const emailSchema = z.string().trim().toLowerCase().email().max(255).refine(
  (e) => config.allowedEmailDomains.includes(e.split('@')[1]),
  { message: `Email must be an institutional address (${config.allowedEmailDomains.map((d) => '@' + d).join(', ')}).` }
);

const signToken = (u) =>
  jwt.sign({ role: u.role, email: u.email }, config.jwtSecret, {
    subject: String(u.user_id),
    expiresIn: config.jwtExpiresIn,
  });

const publicUser = (u) => ({ id: u.user_id, email: u.email, full_name: u.full_name, role: u.role });

// Self-registration is for students only. Lecturers/admins are created by an admin.
router.post(
  '/register',
  authLimiter,
  validate(z.object({
    email: emailSchema,
    password: z.string().min(8).max(100),
    full_name: z.string().trim().min(2).max(150),
  })),
  async (req, res, next) => {
    try {
      const { email, password, full_name } = req.body;
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1,$2,$3,'student') RETURNING user_id, email, full_name, role`,
        [email, hash, full_name]
      );
      res.status(201).json({ user: publicUser(rows[0]), token: signToken(rows[0]) });
    } catch (e) {
      if (e.code === '23505') return next(new HttpError(409, 'An account with this email already exists.'));
      next(e);
    }
  }
);

// The role is looked up in the database. The frontend's role dropdown is only a UI hint:
// if the chosen role differs from the account's real role, login is refused.
router.post(
  '/login',
  authLimiter,
  validate(z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
    role: z.enum(['student', 'lecturer']).optional(),
  })),
  async (req, res, next) => {
    try {
      const { email, password, role } = req.body;
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      const ok = user && (await bcrypt.compare(password, user.password_hash));
      if (!ok) throw new HttpError(401, 'Invalid email or password.');

      // The UI offers "Lecturer / Admin" under the lecturer option.
      const roleMatches = !role || (role === 'student' ? user.role === 'student' : user.role !== 'student');
      if (!roleMatches) throw new HttpError(403, `This account is not a ${role} account.`);

      res.json({ user: publicUser(user), token: signToken(user) });
    } catch (e) { next(e); }
  }
);

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT user_id, email, full_name, role FROM users WHERE user_id = $1', [req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'User not found.');
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
