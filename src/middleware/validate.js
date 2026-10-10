const HttpError = require('../utils/httpError');

const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return next(new HttpError(400, 'Validation failed.', { details }));
  }
  req.body = result.data;
  next();
};

module.exports = validate;
