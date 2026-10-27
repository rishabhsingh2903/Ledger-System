const AppError = require('../errors/AppError');
const { fromDbError } = require('../errors/dbErrors');
const paginate = require('./paginate');

function createTransactionsService(db) {
  /**
   * Inserts the transaction and updates the balance in a single database
   * transaction (see create_transaction() in the migration).
   * Resolves to { transaction, account, replayed }.
   */
  async function create({ account_id, type, amount, reference_id, description }) {
    const { data, error } = await db.rpc('create_transaction', {
      p_account_id: account_id,
      p_type: type,
      p_amount: amount,
      p_reference_id: reference_id,
      p_description: description,
    });
    if (error) throw fromDbError(error);
    return data;
  }

  async function getById(id) {
    const { data, error } = await db.from('transactions').select('*').eq('id', id).maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw AppError.notFound('TRANSACTION_NOT_FOUND', 'Transaction not found', { transaction_id: id });
    return data;
  }

  // Latest first; id breaks ties so ordering is stable across pages.
  function listForAccount(accountId, pagination) {
    return paginate(
      () =>
        db
          .from('transactions')
          .select('*', { count: 'exact' })
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
      pagination,
    );
  }

  return { create, getById, listForAccount };
}

module.exports = createTransactionsService;
