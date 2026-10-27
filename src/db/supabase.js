const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env');

// The server talks to Supabase with the service role key. RLS is enabled on all
// ledger tables with no policies, so anon/authenticated keys cannot touch them.
function createSupabaseClient() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { createSupabaseClient };
