const AppError = require('../errors/AppError');

// When every issue concerns one of these fields, a more specific error code is
// used instead of the generic VALIDATION_ERROR.
const FIELD_CODES = {
  type: 'INVALID_TRANSACTION_TYPE',
  amount: 'INVALID_AMOUNT',
};

const SOURCE_DEFAULT_CODES = {
  query: 'INVALID_PAGINATION',
  params: 'INVALID_ID',
  body: 'VALIDATION_ERROR',
};

function toDetails(issues) {
  return issues.map((issue) => ({
    field: issue.path.join('.') || null,
    message: issue.code === 'unrecognized_keys' ? `Unknown field(s): ${issue.keys.join(', ')}` : issue.message,
  }));
}

function pickCode(source, issues) {
  if (source === 'body') {
    const fields = new Set(issues.map((i) => String(i.path[0])));
    if (fields.size === 1) {
      const [field] = fields;
      if (FIELD_CODES[field]) return FIELD_CODES[field];
    }
  }
  return SOURCE_DEFAULT_CODES[source];
}

/**
 * Validates req[source] against a zod schema. The parsed (trimmed, coerced)
 * value is exposed on req.validated[source]; controllers read only from there.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const input = req[source];

    if (source === 'body' && (input === null || typeof input !== 'object' || Array.isArray(input))) {
      return next(AppError.badRequest('INVALID_REQUEST_BODY', 'Request body must be a JSON object'));
    }

    const result = schema.safeParse(input ?? {});
    if (!result.success) {
      const { issues } = result.error;
      const code = pickCode(source, issues);
      const message = code === 'INVALID_PAGINATION' ? 'Invalid pagination parameters' : 'Request validation failed';
      return next(AppError.badRequest(code, message, toDetails(issues)));
    }

    req.validated = { ...req.validated, [source]: result.data };
    return next();
  };
}

module.exports = validate;
