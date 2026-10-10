const jwt = require('jsonwebtoken');
const config = require('../config');
const HttpError = require('../utils/httpError');

function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Missing bearer token.'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: Number(payload.sub), role: payload.role, email: payload.email };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token.'));
  }
}

// RBAC: the role comes from the signed token (set server-side at login), never from the client.
const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Insufficient permissions.'));

module.exports = { authenticate, requireRole };
