function notFound(_req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists.' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
}

module.exports = { notFound, errorHandler };
