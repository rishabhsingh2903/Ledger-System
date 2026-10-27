const { Router } = require('express');
const validate = require('../middleware/validate');
const requireJson = require('../middleware/requireJson');
const methodNotAllowed = require('../middleware/methodNotAllowed');
const { idParam } = require('../validators/common');
const { createTransactionBody } = require('../validators/transactions.schema');
const createTransactionsController = require('../controllers/transactions.controller');

const IMMUTABLE = {
  code: 'TRANSACTION_IMMUTABLE',
  message: 'Transactions are immutable and cannot be modified or deleted',
};

function transactionsRouter(services) {
  const router = Router();
  const controller = createTransactionsController(services);

  router
    .route('/')
    .post(requireJson, validate(createTransactionBody), controller.create)
    .all(methodNotAllowed(['POST']));

  router
    .route('/:id')
    .get(validate(idParam, 'params'), controller.get)
    .all(methodNotAllowed(['GET'], IMMUTABLE));

  return router;
}

module.exports = transactionsRouter;
