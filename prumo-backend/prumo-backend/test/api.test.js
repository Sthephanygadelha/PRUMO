process.env.DB_PATH = ':memory:';
process.env.RATE_LIMIT_DISABLED = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const cfg = require('../src/config');
const { open } = require('../src/db');
const seed = require('../src/seed');
const build = require('../src/app');

let server, base, db;
before(async () => {
  db = open(':memory:'); seed(db);
  server = http.createServer(build(db));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

async function call(method, path, { body, token, cookie, raw, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body || raw ? { 'content-type': 'application/json' } : {}), ...(token && { authorization: 'Bearer ' + token }), ...(cookie && { cookie }), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: sc && sc.split(';')[0], setCookie: sc, headers: res.headers };
}

let seq = 100000000;
function newCpf() { // gera CPF válido
  const d = String(++seq).padStart(9, '0').split('').map(Number);
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join('');
}
async function signup(extra = {}) {
  const document = newCpf();
  const r = await call('POST', '/api/auth/register', { body: { accountType: 'PF', name: 'Maria Souza', document, email: `u${document}@teste.com`, password: 'senha-forte-1', acceptTerms: true, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { document, token: r.json.accessToken, cookie: r.cookie, me: r.json.me, email: `u${document}@teste.com` };
}
const upgrade = async (u, planCode) => {
  const c = await call('POST', '/api/checkout', { token: u.token, body: { planCode, method: 'PIX' } });
  assert.equal(c.status, 201);
  const p = await call('POST', `/api/dev/payments/${c.json.paymentId}/pay`, { token: u.token });
  assert.equal(p.status, 200);
  return p.json.me;
};

test('cadastro valida documento, termos e senha', async () => {
  const base = { accountType: 'PF', name: 'Ana', email: 'a@b.com', password: 'senha-forte-1', acceptTerms: true };
  assert.equal((await call('POST', '/api/auth/register', { body: { ...base, document: '11111111111' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { ...base, document: newCpf(), acceptTerms: false } })).json.code, 'TERMS_REQUIRED');
  assert.equal((await call('POST', '/api/auth/register', { body: { ...base, document: newCpf(), password: '1234' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { ...base, accountType: 'PJ', document: newCpf() } })).json.code, 'INVALID_DOCUMENT');
  assert.equal((await call('POST', '/api/auth/register', { raw: '{quebrado' })).status, 400);
});

test('cadastro PF e PJ, conta duplicada e documento protegido no banco', async () => {
  const u = await signup();
  assert.equal(u.me.plan.code, 'free');
  assert.equal(u.me.ai.remaining, 5);
  const dup = await call('POST', '/api/auth/register', { body: { accountType: 'PF', name: 'X Y', document: u.document, email: 'outro@x.com', password: 'senha-forte-1', acceptTerms: true } });
  assert.equal(dup.status, 409);
  const row = db.get('SELECT document_hash,document_enc,document_last4,password_hash FROM users WHERE email=?', u.email);
  assert.ok(!JSON.stringify(row).includes(u.document), 'documento não pode aparecer em texto puro');
  assert.equal(row.document_last4, u.document.slice(-4));
  assert.match(row.password_hash, /^scrypt\$/);
  const pj = await call('POST', '/api/auth/register', { body: { accountType: 'PJ', name: 'Padaria Boa LTDA', document: '11222333000181', email: 'padaria@x.com', password: 'senha-forte-1', acceptTerms: true } });
  assert.equal(pj.status, 201);
  assert.equal(pj.json.me.accountType, 'PJ');
});

test('login, /me e cookie de refresh httpOnly', async () => {
  const u = await signup();
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { document: u.document, password: 'errada-123' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { document: '000.000.000-00', password: 'x' } })).status, 401);
  const ok = await call('POST', '/api/auth/login', { body: { document: u.document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), password: 'senha-forte-1' } });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  assert.equal((await call('GET', '/api/me', { token: ok.json.accessToken })).json.email, u.email);
  assert.equal((await call('GET', '/api/me', { token: ok.json.accessToken + 'x' })).status, 401);
});

test('refresh rotaciona e o reuso do token antigo derruba as sessões', async () => {
  const u = await signup();
  const r1 = await call('POST', '/api/auth/refresh', { cookie: u.cookie });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.cookie, u.cookie);
  const reuse = await call('POST', '/api/auth/refresh', { cookie: u.cookie });
  assert.equal(reuse.status, 401);
  assert.equal((await call('POST', '/api/auth/refresh', { cookie: r1.cookie })).status, 401, 'sessão nova também foi revogada');
  const u2 = await signup();
  await call('POST', '/api/auth/logout', { cookie: u2.cookie });
  assert.equal((await call('POST', '/api/auth/refresh', { cookie: u2.cookie })).status, 401);
});

test('bloqueia tentativas excessivas de login', async () => {
  const u = await signup();
  cfg.rateLimit = true;
  try {
    let last;
    for (let i = 0; i < 7; i++) last = await call('POST', '/api/auth/login', { body: { document: u.document, password: 'errada-' + i } });
    assert.equal(last.status, 429);
    assert.equal((await call('POST', '/api/auth/login', { body: { document: u.document, password: 'senha-forte-1' } })).status, 429, 'nem a senha certa passa durante o bloqueio');
  } finally { cfg.rateLimit = false; }
});

test('planos públicos', async () => {
  const r = await call('GET', '/api/plans');
  assert.deepEqual(r.json.plans.map((p) => p.code), ['free', 'monthly', 'quarterly', 'annual']);
  assert.equal(r.json.plans[1].priceCents, 2990);
});

test('cursos: bloqueio por plano, gabarito oculto e correção no servidor', async () => {
  const u = await signup();
  const list = (await call('GET', '/api/courses', { token: u.token })).json.courses;
  assert.deepEqual(list.map((c) => c.locked), [false, true, true]);
  assert.equal(list[0].progress.percent, 0);
  const locked = await call('GET', `/api/courses/${list[1].id}`, { token: u.token });
  assert.equal(locked.status, 403); assert.equal(locked.json.code, 'PLAN_REQUIRED');

  const c = (await call('GET', `/api/courses/${list[0].id}`, { token: u.token })).json;
  assert.ok(!JSON.stringify(c).includes('is_correct') && !JSON.stringify(c).includes('isCorrect'));
  const prog = await call('POST', `/api/courses/${c.id}/lessons/${c.lessons[0].id}/progress`, { token: u.token, body: { done: true } });
  assert.equal(prog.json.done, 1); assert.equal(prog.json.percent, 33);
  assert.equal((await call('PUT', `/api/courses/${c.id}/note`, { token: u.token, body: { content: 'minha nota' } })).status, 200);
  assert.equal((await call('GET', `/api/courses/${c.id}`, { token: u.token })).json.note, 'minha nota');

  const q = c.quiz[0], right = db.get('SELECT id FROM quiz_options WHERE question_id=? AND is_correct=1', q.id).id;
  const wrong = q.options.find((o) => o.id !== right).id;
  assert.equal((await call('POST', `/api/courses/${c.id}/quiz/attempt`, { token: u.token, body: { answers: { [q.id]: wrong } } })).json.score, 0);
  assert.equal((await call('POST', `/api/courses/${c.id}/quiz/attempt`, { token: u.token, body: { answers: { [q.id]: right } } })).json.score, 1);
  assert.equal((await call('POST', `/api/courses/${c.id}/messages`, { token: u.token, body: { body: 'oi turma' } })).status, 200);
  assert.equal((await call('GET', `/api/courses/${c.id}/messages`, { token: u.token })).json.messages[0].author, 'Maria');
});

test('IA: cota diária aplicada no servidor e histórico', async () => {
  const u = await signup();
  const first = await call('POST', '/api/ai/chat', { token: u.token, body: { message: 'Como funciona o DAS?' } });
  assert.equal(first.status, 200);
  assert.match(first.json.reply, /DAS/);
  assert.equal(first.json.quota.remaining, 4);
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/ai/chat', { token: u.token, body: { message: 'e agora?', conversationId: first.json.conversationId } })).status, 200);
  const over = await call('POST', '/api/ai/chat', { token: u.token, body: { message: 'mais uma' } });
  assert.equal(over.status, 429); assert.equal(over.json.code, 'AI_QUOTA_EXCEEDED');
  assert.equal((await call('GET', '/api/ai/quota', { token: u.token })).json.remaining, 0);
  assert.equal((await call('GET', `/api/ai/conversations/${first.json.conversationId}`, { token: u.token })).json.messages.length, 10);
  const other = await signup();
  assert.equal((await call('POST', '/api/ai/chat', { token: other.token, body: { message: 'x', conversationId: first.json.conversationId } })).status, 404, 'não acessa conversa alheia');
  assert.equal((await call('POST', '/api/ai/chat', { token: other.token, body: { message: '' } })).status, 400);
});

test('checkout + pagamento liberam o plano, a cota e os cursos', async () => {
  const u = await signup();
  assert.equal((await call('POST', '/api/checkout', { token: u.token, body: { planCode: 'free' } })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { token: u.token, body: { planCode: 'nao-existe' } })).status, 404);
  const me = await upgrade(u, 'monthly');
  assert.equal(me.plan.code, 'monthly'); assert.equal(me.ai.dailyQuota, 30); assert.equal(me.plan.newsFrequency, 'DAILY');
  assert.deepEqual((await call('GET', '/api/courses', { token: u.token })).json.courses.map((c) => c.locked), [false, false, false]);
  assert.equal((await call('GET', '/api/news', { token: u.token })).json.edition, 'daily');
});

test('webhook exige assinatura e é idempotente', async () => {
  const u = await signup();
  const c = (await call('POST', '/api/checkout', { token: u.token, body: { planCode: 'annual', method: 'CARD' } })).json;
  const gw = db.get('SELECT gateway_id FROM payments WHERE id=?', c.paymentId).gateway_id;
  const raw = JSON.stringify({ gatewayId: gw, status: 'PAID' });
  assert.equal((await call('POST', '/api/webhooks/payments', { raw })).status, 401);
  assert.equal((await call('POST', '/api/webhooks/payments', { raw, headers: { 'x-signature': 'abcd' } })).status, 401);
  const sig = crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex');
  assert.equal((await call('POST', '/api/webhooks/payments', { raw, headers: { 'x-signature': sig } })).status, 200);
  assert.equal((await call('POST', '/api/webhooks/payments', { raw, headers: { 'x-signature': sig } })).status, 200);
  assert.equal(db.get("SELECT COUNT(*) n FROM subscriptions WHERE user_id=? AND status='ACTIVE'", u.me.id).n, 1);
  assert.equal((await call('GET', '/api/me', { token: u.token })).json.plan.code, 'annual');
  assert.equal((await call('GET', `/api/payments/${c.paymentId}`, { token: (await signup()).token })).status, 404, 'pagamento alheio');
});

test('agendamento: horários, desconto do plano, conflito e cancelamento', async () => {
  const u = await signup(), v = await signup();
  await upgrade(v, 'quarterly'); // 15% de desconto
  const mentors = (await call('GET', '/api/mentors', { token: v.token })).json.mentors;
  const m = mentors[0];
  assert.equal(m.discountPct, 15);
  assert.equal(m.yourPrice30Cents, Math.round(m.price30Cents * 0.85));
  const slots = (await call('GET', `/api/mentors/${m.id}/slots?days=14`)).json.slots;
  assert.ok(slots.length > 10);
  assert.equal((await call('POST', '/api/appointments', { token: u.token, body: { mentorId: m.id, startsAt: '2020-01-01T12:00:00Z' } })).status, 409);

  const a = await call('POST', '/api/appointments', { token: v.token, body: { mentorId: m.id, startsAt: slots[0], subject: 'Quero abrir MEI' } });
  assert.equal(a.status, 201);
  assert.equal(a.json.appointment.priceCents, m.yourPrice30Cents);
  assert.equal(a.json.appointment.status, 'REQUESTED');
  const fee = db.get('SELECT platform_fee_cents f, mentor_share_cents s, amount_cents t FROM payments WHERE id=?', a.json.payment.paymentId);
  assert.equal(fee.f + fee.s, fee.t);

  const clash = await call('POST', '/api/appointments', { token: u.token, body: { mentorId: m.id, startsAt: slots[0] } });
  assert.equal(clash.status, 409); assert.equal(clash.json.code, 'SLOT_UNAVAILABLE');
  assert.ok(!(await call('GET', `/api/mentors/${m.id}/slots?days=14`)).json.slots.includes(slots[0]));

  await call('POST', `/api/dev/payments/${a.json.payment.paymentId}/pay`, { token: v.token });
  const mine = (await call('GET', '/api/appointments', { token: v.token })).json.appointments;
  assert.equal(mine[0].status, 'CONFIRMED'); assert.ok(mine[0].videoRoom);
  assert.equal((await call('POST', `/api/appointments/${a.json.appointment.id}/cancel`, { token: u.token })).status, 404, 'só os envolvidos');
  const cancel = await call('POST', `/api/appointments/${a.json.appointment.id}/cancel`, { token: v.token });
  assert.equal(cancel.json.refundPending, true);
  assert.ok((await call('GET', `/api/mentors/${m.id}/slots?days=14`)).json.slots.includes(slots[0]), 'horário volta a ficar livre');
});

test('chat com mentor: só os participantes acessam', async () => {
  const u = await signup(), x = await signup();
  const m = (await call('GET', '/api/mentors')).json.mentors[0];
  const c = (await call('POST', '/api/conversations', { token: u.token, body: { mentorId: m.id } })).json;
  assert.equal((await call('POST', '/api/conversations', { token: u.token, body: { mentorId: m.id } })).json.id, c.id);
  assert.equal((await call('POST', `/api/conversations/${c.id}/messages`, { token: u.token, body: { body: 'Olá!' } })).status, 201);
  assert.equal((await call('GET', `/api/conversations/${c.id}/messages`, { token: u.token })).json.messages.length, 1);
  assert.equal((await call('GET', `/api/conversations/${c.id}/messages`, { token: x.token })).status, 404);
});

test('simulador usa os parâmetros da base', async () => {
  const sim = (b) => call('POST', '/api/simulator/cnpj', { body: b });
  assert.equal((await sim({ monthlyRevenue: 500, employees: 0 })).json.code, 'STAY_PF');
  assert.equal((await sim({ monthlyRevenue: 3000, employees: 0 })).json.code, 'CONSIDER_MEI');
  assert.equal((await sim({ monthlyRevenue: 500, needsInvoice: true })).json.code, 'CONSIDER_MEI');
  assert.equal((await sim({ monthlyRevenue: 8000, employees: 0 })).json.code, 'ABOVE_MEI');
  assert.equal((await sim({ monthlyRevenue: 100, employees: 2 })).json.code, 'ABOVE_MEI');
  assert.equal((await sim({ monthlyRevenue: -1 })).status, 400);
});

test('exclusão de conta anonimiza e encerra sessões (LGPD)', async () => {
  const u = await signup();
  assert.equal((await call('DELETE', '/api/me', { token: u.token, body: { password: 'errada' } })).status, 403);
  assert.equal((await call('DELETE', '/api/me', { token: u.token, body: { password: 'senha-forte-1' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { document: u.document, password: 'senha-forte-1' } })).status, 401);
  assert.equal(db.get('SELECT name FROM users WHERE id=?', u.me.id).name, 'Conta removida');
});

test('front estático, cabeçalhos de segurança e rotas inexistentes', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200); assert.match(home.json, /Prumo/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await call('GET', '/..%2f..%2fetc/passwd')).status, 404);
  assert.equal((await call('GET', '/%2e%2e/package.json')).status, 404);
  assert.equal((await call('GET', '/api/nao-existe')).status, 404);
  assert.equal((await call('GET', '/api/auth/login')).status, 405);
  assert.equal((await call('POST', '/api/auth/govbr/simulado', { body: {} })).status, 200, 'modo dev');
  assert.equal((await call('GET', '/api/auth/govbr')).status, 501);
});
