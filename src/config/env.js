require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabase: {
    get url() {
      return required('SUPABASE_URL');
    },
    get serviceRoleKey() {
      return required('SUPABASE_SERVICE_ROLE_KEY');
    },
  },
};
