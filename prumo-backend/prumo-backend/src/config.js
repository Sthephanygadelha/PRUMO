const crypto = require('node:crypto');
const path = require('node:path');
const env = process.env;
const prod = env.NODE_ENV === 'production';

function secret(name) {
  if (env[name]) return env[name];
  if (prod) throw new Error(`Defina ${name} no ambiente de produção.`);
  return crypto.createHash('sha256').update('dev-' + name).digest('hex'); // só para desenvolvimento
}

module.exports = {
  prod,
  port: +env.PORT || 3000,
  dbPath: env.DB_PATH || './data/prumo.db',
  publicDir: path.join(__dirname, '..', 'public'),
  jwtSecret: secret('JWT_SECRET'),
  docHmacKey: secret('DOC_HMAC_KEY'),
  docEncKey: crypto.createHash('sha256').update(secret('DOC_ENC_KEY')).digest(),
  webhookSecret: secret('PAYMENT_WEBHOOK_SECRET'),
  corsOrigin: env.CORS_ORIGIN || '',
  cookieSameSite: env.COOKIE_SAMESITE || 'Strict',
  trustProxy: env.TRUST_PROXY === '1',
  devTools: env.DEV_TOOLS ? env.DEV_TOOLS === '1' : !prod,
  rateLimit: env.RATE_LIMIT_DISABLED !== '1',
  accessTtl: 15 * 60,
  refreshTtl: 30 * 86400,
  ai: { key: env.ANTHROPIC_API_KEY || '', model: env.AI_MODEL || 'claude-sonnet-5-5', maxTokens: 700 },
};
