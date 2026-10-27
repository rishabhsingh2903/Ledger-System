const AppError = require('../errors/AppError');

function notFound(req, _res, next) {
  next(AppError.notFound('ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

module.exports = notFound;
