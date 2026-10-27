const { serializeAccount, serializeTransaction } = require('../utils/serializers');

function createTransactionsController({ transactions }) {
  return {
    async create(req, res) {
      const result = await transactions.create(req.validated.body);
      // 201 for a new transaction, 200 when an identical request is replayed.
      res.status(result.replayed ? 200 : 201).json({
        data: {
          transaction: serializeTransaction(result.transaction),
          account: serializeAccount(result.account),
        },
        meta: { replayed: result.replayed },
      });
    },

    async get(req, res) {
      const transaction = await transactions.getById(req.validated.params.id);
      res.json({ data: serializeTransaction(transaction) });
    },
  };
}

module.exports = createTransactionsController;
