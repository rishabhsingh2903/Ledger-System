const { Router } = require('express');
const validate = require('../middleware/validate');
const requireJson = require('../middleware/requireJson');
const methodNotAllowed = require('../middleware/methodNotAllowed');
const { idParam, paginationQuery } = require('../validators/common');
const { createAccountBody } = require('../validators/accounts.schema');
const createAccountsController = require('../controllers/accounts.controller');

function accountsRouter(services) {
  const router = Router();
  const controller = createAccountsController(services);

  router
    .route('/')
    .post(requireJson, validate(createAccountBody), controller.create)
    .get(validate(paginationQuery, 'query'), controller.list)
    .all(methodNotAllowed(['GET', 'POST']));

  router
    .route('/:id')
    .get(validate(idParam, 'params'), controller.get)
    .all(methodNotAllowed(['GET']));

  router
    .route('/:id/transactions')
    .get(validate(idParam, 'params'), validate(paginationQuery, 'query'), controller.listTransactions)
    .all(methodNotAllowed(['GET']));

  return router;
}

module.exports = accountsRouter;
