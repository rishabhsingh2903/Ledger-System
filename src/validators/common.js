const { z } = require('zod');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000_000;
const MAX_LIMIT = 100;

const uuid = (label) =>
  z.string({ error: `${label} is required and must be a string` }).regex(UUID_RE, `${label} must be a valid UUID`);

// Accepts a JSON number (100, 10.5) or a numeric string ("100.00").
// Normalized to a 2-decimal string so it reaches Postgres numeric without
// floating point drift.
const amount = z
  .union([z.number(), z.string()], { error: 'amount is required and must be a number' })
  .transform((value, ctx) => {
    const text = typeof value === 'number' ? String(value) : value.trim();
    if (typeof value === 'number' && !Number.isFinite(value)) {
      ctx.addIssue({ code: 'custom', message: 'amount must be a finite number' });
      return z.NEVER;
    }
    if (!AMOUNT_RE.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'amount must be a positive number with at most 2 decimal places' });
      return z.NEVER;
    }
    const numeric = Number(text);
    if (numeric <= 0) {
      ctx.addIssue({ code: 'custom', message: 'amount must be greater than 0' });
      return z.NEVER;
    }
    if (numeric > MAX_AMOUNT) {
      ctx.addIssue({ code: 'custom', message: `amount must not exceed ${MAX_AMOUNT}` });
      return z.NEVER;
    }
    return numeric.toFixed(2);
  });

const referenceId = z
  .string({ error: 'reference_id is required and must be a string' })
  .trim()
  .min(1, 'reference_id must not be empty')
  .max(255, 'reference_id must be at most 255 characters');

const description = z
  .string({ error: 'description must be a string' })
  .trim()
  .max(500, 'description must be at most 500 characters')
  .nullish()
  .transform((value) => (value ? value : null));

const positiveInt = (label, max) =>
  z
    .string({ error: `${label} must be a single positive integer` })
    .regex(/^[1-9]\d*$/, `${label} must be a positive integer`)
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n <= max, `${label} must be between 1 and ${max}`);

const paginationQuery = z.object({
  page: positiveInt('page', 1_000_000).optional().default(1),
  limit: positiveInt('limit', MAX_LIMIT).optional().default(20),
});

const idParam = z.object({ id: uuid('id') });

module.exports = { uuid, amount, referenceId, description, paginationQuery, idParam, MAX_AMOUNT, MAX_LIMIT };
