const express = require('express');
const apiRouter = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

/**
 * Builds the Express app. Services are injected so tests can run the HTTP
 * layer without a database.
 */
function createApp(services) {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', apiRouter(services));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
