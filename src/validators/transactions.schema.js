const { z } = require('zod');
const { uuid, amount, referenceId, description } = require('./common');

const createTransactionBody = z.strictObject({
  account_id: uuid('account_id'),
  type: z.enum(['credit', 'debit'], { error: "type must be either 'credit' or 'debit'" }),
  amount,
  reference_id: referenceId,
  description,
});

module.exports = { createTransactionBody };
