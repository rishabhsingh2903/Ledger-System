const AppError = require('../errors/AppError');

/**
 * Terminal handler for a route path: any method not registered above it gets
 * 405 with an Allow header.
 */
function methodNotAllowed(allowed, { code = 'METHOD_NOT_ALLOWED', message } = {}) {
  return (req, res, next) => {
    res.set('Allow', allowed.join(', '));
    next(new AppError(405, code, message || `Method ${req.method} is not allowed on this resource`));
  };
}

module.exports = methodNotAllowed;
