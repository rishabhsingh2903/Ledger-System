const AppError = require('../errors/AppError');

// Every error response has the same shape:
// { "error": { "code": "...", "message": "...", "details": ... } }
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let error = err;

  if (!(error instanceof AppError)) {
    if (err.type === 'entity.parse.failed') {
      error = AppError.badRequest('INVALID_JSON', 'Request body contains malformed JSON');
    } else if (err.type === 'entity.too.large') {
      error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
      error = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding');
    } else {
      error = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
      error.cause = err;
    }
  }

  if (error.status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, error.cause || err);
  }

  const body = { code: error.code, message: error.message };
  if (error.details !== undefined) body.details = error.details;
  res.status(error.status).json({ error: body });
}

module.exports = errorHandler;
