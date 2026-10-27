const { Router } = require('express');
const accountsRouter = require('./accounts.routes');
const transactionsRouter = require('./transactions.routes');
const transfersRouter = require('./transfers.routes');

function apiRouter(services) {
  const router = Router();
  router.use('/accounts', accountsRouter(services));
  router.use('/transactions', transactionsRouter(services));
  router.use('/transfers', transfersRouter(services));
  return router;
}

module.exports = apiRouter;
