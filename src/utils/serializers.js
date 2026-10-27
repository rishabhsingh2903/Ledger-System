const { toMoney } = require('./money');

const serializeAccount = (row) => ({
  id: row.id,
  name: row.name,
  balance: toMoney(row.balance),
  created_at: row.created_at,
});

const serializeTransaction = (row) => ({
  id: row.id,
  account_id: row.account_id,
  type: row.type,
  amount: toMoney(row.amount),
  description: row.description,
  reference_id: row.reference_id,
  balance_after: toMoney(row.balance_after),
  transfer_id: row.transfer_id,
  created_at: row.created_at,
});

const serializeTransfer = (row) => ({
  id: row.id,
  from_account_id: row.from_account_id,
  to_account_id: row.to_account_id,
  amount: toMoney(row.amount),
  description: row.description,
  reference_id: row.reference_id,
  created_at: row.created_at,
});

module.exports = { serializeAccount, serializeTransaction, serializeTransfer };
