const { createRouter, createApp } = require('./lib/http');
const domain = require('./domain');

// Monta a aplicação (rotas + domínio) sobre um banco aberto. Usado pelo servidor e pelos testes.
module.exports = function build(db) {
  const router = createRouter(), d = domain(db), deps = { db, d };
  for (const m of ['auth', 'catalog', 'mentors', 'billing', 'ai']) require(`./routes/${m}`)(router, deps);
  return createApp(db, router);
};
