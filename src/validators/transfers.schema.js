const { z } = require('zod');
const { uuid, amount, referenceId, description } = require('./common');

const createTransferBody = z
  .strictObject({
    from_account_id: uuid('from_account_id'),
    to_account_id: uuid('to_account_id'),
    amount,
    reference_id: referenceId,
    description,
  })
  .refine((body) => body.from_account_id.toLowerCase() !== body.to_account_id.toLowerCase(), {
    path: ['to_account_id'],
    message: 'to_account_id must be different from from_account_id',
  });

module.exports = { createTransferBody };
