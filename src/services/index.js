const createAccountsService = require('./accounts.service');
const createTransactionsService = require('./transactions.service');
const createTransfersService = require('./transfers.service');

function createServices(db) {
  return {
    accounts: createAccountsService(db),
    transactions: createTransactionsService(db),
    transfers: createTransfersService(db),
  };
}

module.exports = createServices;
