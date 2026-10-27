const { serializeAccount, serializeTransaction } = require('../utils/serializers');

function createAccountsController({ accounts, transactions }) {
  return {
    async create(req, res) {
      const account = await accounts.create(req.validated.body);
      res.status(201).json({ data: serializeAccount(account) });
    },

    async list(req, res) {
      const { rows, meta } = await accounts.list(req.validated.query);
      res.json({ data: rows.map(serializeAccount), meta });
    },

    async get(req, res) {
      const account = await accounts.getById(req.validated.params.id);
      res.json({ data: serializeAccount(account) });
    },

    async listTransactions(req, res) {
      const { id } = req.validated.params;
      await accounts.getById(id); // 404 if the account does not exist
      const { rows, meta } = await transactions.listForAccount(id, req.validated.query);
      res.json({ data: rows.map(serializeTransaction), meta });
    },
  };
}

module.exports = createAccountsController;
