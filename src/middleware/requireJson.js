const AppError = require('../errors/AppError');

// Write endpoints only accept application/json bodies. A request with no
// Content-Type at all is left to validate(), which reports a 400.
function requireJson(req, _res, next) {
  if (req.headers['content-type'] && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
  }
  return next();
}

module.exports = requireJson;
