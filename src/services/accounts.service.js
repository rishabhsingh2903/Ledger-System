const AppError = require('../errors/AppError');
const { fromDbError } = require('../errors/dbErrors');
const paginate = require('./paginate');

function createAccountsService(db) {
  async function create({ name }) {
    const { data, error } = await db.from('accounts').insert({ name }).select().single();
    if (error) throw fromDbError(error);
    return data;
  }

  async function getById(id) {
    const { data, error } = await db.from('accounts').select('*').eq('id', id).maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw AppError.notFound('ACCOUNT_NOT_FOUND', 'Account not found', { account_id: id });
    return data;
  }

  function list(pagination) {
    return paginate(
      () =>
        db
          .from('accounts')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
      pagination,
    );
  }

  return { create, getById, list };
}

module.exports = createAccountsService;
