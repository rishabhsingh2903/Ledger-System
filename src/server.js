const config = require('./config/env');
const createApp = require('./app');
const createServices = require('./services');
const { createSupabaseClient } = require('./db/supabase');

const app = createApp(createServices(createSupabaseClient()));

app.listen(config.port, () => {
  console.log(`Ledger API listening on http://localhost:${config.port}`);
});
