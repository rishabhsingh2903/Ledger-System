const { z } = require('zod');

// strictObject: unknown keys (e.g. "balance") are rejected. Accounts always
// start at 0 and their balance only changes through transactions.
const createAccountBody = z.strictObject({
  name: z
    .string({ error: 'name is required and must be a string' })
    .trim()
    .min(1, 'name must not be empty')
    .max(255, 'name must be at most 255 characters'),
});

module.exports = { createAccountBody };
