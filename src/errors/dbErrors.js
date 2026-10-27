const AppError = require('./AppError');

// Business errors raised by the plpgsql ledger functions (RAISE EXCEPTION '<CODE>').
const LEDGER_ERRORS = {
  ACCOUNT_NOT_FOUND: [404, 'Account not found'],
  INSUFFICIENT_BALANCE: [422, 'Insufficient balance for this debit'],
  DUPLICATE_TRANSACTION: [409, 'A transaction with this reference_id already exists for this account'],
  INVALID_TRANSACTION_TYPE: [400, "Transaction type must be either 'credit' or 'debit'"],
  INVALID_AMOUNT: [400, 'Amount must be greater than 0 with at most 2 decimal places'],
  SAME_ACCOUNT_TRANSFER: [400, 'Source and destination accounts must be different'],
  IMMUTABLE_RECORD: [405, 'Ledger records cannot be modified or deleted'],
  BALANCE_UPDATE_FORBIDDEN: [409, 'Balance can only change through a transaction'],
  INVALID_INITIAL_BALANCE: [400, 'Accounts must be created with a zero balance'],
};

// Generic PostgreSQL SQLSTATEs that can surface from constraints.
const PG_ERRORS = {
  23505: [409, 'DUPLICATE_TRANSACTION', 'A record with the same unique key already exists'],
  23503: [404, 'ACCOUNT_NOT_FOUND', 'Referenced account does not exist'],
  23514: [400, 'VALIDATION_ERROR', 'Request violates a data constraint'],
  23502: [400, 'VALIDATION_ERROR', 'A required field is missing'],
  '22P02': [400, 'VALIDATION_ERROR', 'Invalid input syntax'],
  22003: [400, 'INVALID_AMOUNT', 'Numeric value out of range'],
};

function parseDetails(details) {
  if (!details) return undefined;
  try {
    return JSON.parse(details);
  } catch {
    return undefined;
  }
}

/**
 * Converts a Supabase/PostgREST error object into an AppError.
 */
function fromDbError(error) {
  const ledgerCode = (error.message || '').split(':')[0].trim();
  if (LEDGER_ERRORS[ledgerCode]) {
    const [status, message] = LEDGER_ERRORS[ledgerCode];
    return new AppError(status, ledgerCode, message, parseDetails(error.details));
  }

  if (PG_ERRORS[error.code]) {
    const [status, code, message] = PG_ERRORS[error.code];
    return new AppError(status, code, message);
  }

  const err = new AppError(500, 'INTERNAL_ERROR', 'Unexpected database error');
  err.cause = error;
  return err;
}

module.exports = { fromDbError };
