const { Router } = require('express');
const validate = require('../middleware/validate');
const requireJson = require('../middleware/requireJson');
const methodNotAllowed = require('../middleware/methodNotAllowed');
const { idParam } = require('../validators/common');
const { createTransferBody } = require('../validators/transfers.schema');
const createTransfersController = require('../controllers/transfers.controller');

function transfersRouter(services) {
  const router = Router();
  const controller = createTransfersController(services);

  router
    .route('/')
    .post(requireJson, validate(createTransferBody), controller.create)
    .all(methodNotAllowed(['POST']));

  router
    .route('/:id')
    .get(validate(idParam, 'params'), controller.get)
    .all(
      methodNotAllowed(['GET'], {
        code: 'TRANSFER_IMMUTABLE',
        message: 'Transfers are immutable and cannot be modified or deleted',
      }),
    );

  return router;
}

module.exports = transfersRouter;
