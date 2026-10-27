const AppError = require('../errors/AppError');
const { fromDbError } = require('../errors/dbErrors');

function createTransfersService(db) {
  /**
   * Debits the source and credits the destination atomically (see
   * create_transfer() in the migration). Resolves to
   * { transfer, debit, credit, from_account, to_account, replayed }.
   */
  async function create({ from_account_id, to_account_id, amount, reference_id, description }) {
    const { data, error } = await db.rpc('create_transfer', {
      p_from_account_id: from_account_id,
      p_to_account_id: to_account_id,
      p_amount: amount,
      p_reference_id: reference_id,
      p_description: description,
    });
    if (error) throw fromDbError(error);
    return data;
  }

  async function getById(id) {
    const { data, error } = await db.from('transfers').select('*, transactions(*)').eq('id', id).maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw AppError.notFound('TRANSFER_NOT_FOUND', 'Transfer not found', { transfer_id: id });

    const { transactions = [], ...transfer } = data;
    return {
      transfer,
      debit: transactions.find((t) => t.type === 'debit') ?? null,
      credit: transactions.find((t) => t.type === 'credit') ?? null,
    };
  }

  return { create, getById };
}

module.exports = createTransfersService;
