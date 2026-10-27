const { serializeAccount, serializeTransaction, serializeTransfer } = require('../utils/serializers');

function createTransfersController({ transfers }) {
  return {
    async create(req, res) {
      const result = await transfers.create(req.validated.body);
      res.status(result.replayed ? 200 : 201).json({
        data: {
          transfer: serializeTransfer(result.transfer),
          debit: serializeTransaction(result.debit),
          credit: serializeTransaction(result.credit),
          from_account: serializeAccount(result.from_account),
          to_account: serializeAccount(result.to_account),
        },
        meta: { replayed: result.replayed },
      });
    },

    async get(req, res) {
      const { transfer, debit, credit } = await transfers.getById(req.validated.params.id);
      res.json({
        data: {
          transfer: serializeTransfer(transfer),
          debit: debit && serializeTransaction(debit),
          credit: credit && serializeTransaction(credit),
        },
      });
    },
  };
}

module.exports = createTransfersController;
