const http = require('node:http');
const cfg = require('./config');
const { open } = require('./db');
const seed = require('./seed');
const build = require('./app');

const db = open(cfg.dbPath);
seed(db);
const server = http.createServer(build(db));
server.listen(cfg.port, () => {
  console.log(`Prumo rodando em http://localhost:${cfg.port}  (${cfg.prod ? 'produção' : 'desenvolvimento'})`);
  if (!cfg.ai.key) console.log('IA: sem ANTHROPIC_API_KEY, respondendo por regras de exemplo.');
  if (cfg.devTools) console.log('DEV_TOOLS ligado: pagamento e gov.br simulados disponíveis.');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
