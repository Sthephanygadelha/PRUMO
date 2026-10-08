const cfg = require('../config');
const S = require('../lib/security');
const { HttpError, reply, parseCookies } = require('../lib/http');

const COOKIE = 'prumo_rt';
const digits = (s) => String(s ?? '').replace(/\D/g, '');

module.exports = (r, { db, d }) => {
  const cookie = (value, maxAge) => {
    const same = cfg.cookieSameSite;
    return `${COOKIE}=${value}; HttpOnly; SameSite=${same}; Path=/api/auth; Max-Age=${maxAge}${cfg.prod || same === 'None' ? '; Secure' : ''}`;
  };

  function issue(ctx, user) {
    const rt = require('node:crypto').randomBytes(32).toString('base64url');
    db.run('INSERT INTO sessions(id,user_id,token_hash,user_agent,ip,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
      d.uuid(), user.id, S.sha256(rt), String(ctx.req.headers['user-agent'] || '').slice(0, 200), ctx.ip, d.iso(Date.now() + cfg.refreshTtl * 1000), d.iso());
    ctx.res.setHeader('Set-Cookie', cookie(rt, cfg.refreshTtl));
    return { accessToken: S.signJwt({ sub: user.id }, cfg.accessTtl), expiresIn: cfg.accessTtl, me: d.meDto(user) };
  }

  r.post('/auth/register', async (ctx) => {
    ctx.limit('register:' + ctx.ip, 10, 3600e3);
    const b = ctx.body, type = b.accountType;
    const name = String(b.name ?? '').trim(), email = String(b.email ?? '').trim().toLowerCase(), doc = digits(b.document), pw = String(b.password ?? '');
    if (type !== 'PF' && type !== 'PJ') throw new HttpError(400, 'Tipo de conta inválido.');
    if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Informe o nome.');
    if (!(type === 'PF' ? S.validCPF(doc) : S.validCNPJ(doc))) throw new HttpError(400, type === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.', 'INVALID_DOCUMENT');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
    if (pw.length < 8 || pw.length > 128) throw new HttpError(400, 'A senha deve ter de 8 a 128 caracteres.');
    if (b.acceptTerms !== true) throw new HttpError(400, 'É preciso aceitar os Termos de Uso e a Política de Privacidade.', 'TERMS_REQUIRED');

    const user = { id: d.uuid(), account_type: type, role: 'STUDENT', name, email, document_type: type === 'PF' ? 'CPF' : 'CNPJ' };
    const passwordHash = await S.hashPassword(pw);
    try {
      db.tx(() => {
        db.run('INSERT INTO users(id,account_type,role,name,email,password_hash,document_type,document_hash,document_enc,document_last4,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          user.id, type, 'STUDENT', name, email, passwordHash, user.document_type, S.docHash(doc), S.encrypt(doc), doc.slice(-4), d.iso());
        if (type === 'PJ') db.run('INSERT INTO businesses(id,owner_id,cnpj_hash,legal_name,created_at) VALUES(?,?,?,?,?)', d.uuid(), user.id, S.docHash(doc), name, d.iso());
        for (const t of ['TERMS', 'PRIVACY']) db.run('INSERT INTO consents(id,user_id,type,version,granted,created_at) VALUES(?,?,?,?,1,?)', d.uuid(), user.id, t, 'v0', d.iso());
      });
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'Já existe uma conta com esse documento ou e-mail.', 'ACCOUNT_EXISTS');
      throw e;
    }
    d.audit(user.id, 'user.register', 'user', user.id, null, ctx.ip);
    return reply(201, issue(ctx, db.get('SELECT * FROM users WHERE id=?', user.id)));
  });

  r.post('/auth/login', async (ctx) => {
    const doc = digits(ctx.body.document), pw = String(ctx.body.password ?? '');
    if (!doc || !pw) throw new HttpError(400, 'Informe documento e senha.');
    const h = S.docHash(doc);
    ctx.limit('login-ip:' + ctx.ip, 30, 15 * 60e3);
    ctx.limit('login-doc:' + h, 5, 15 * 60e3);
    const u = db.get('SELECT * FROM users WHERE document_hash=? AND deleted_at IS NULL', h);
    if (!(await S.verifyPassword(pw, u?.password_hash)) || !u) {
      d.audit(u?.id, 'auth.login_failed', 'user', u?.id, null, ctx.ip);
      throw new HttpError(401, 'Documento ou senha inválidos.', 'BAD_CREDENTIALS');
    }
    d.audit(u.id, 'auth.login', 'user', u.id, null, ctx.ip);
    return issue(ctx, u);
  });

  // Renovação com rotação do refresh token (cookie httpOnly). Reuso de token antigo derruba todas as sessões.
  r.post('/auth/refresh', (ctx) => {
    ctx.limit('refresh:' + ctx.ip, 60, 15 * 60e3);
    const tok = parseCookies(ctx.req.headers.cookie)[COOKIE];
    const s = tok && db.get('SELECT * FROM sessions WHERE token_hash=?', S.sha256(tok));
    if (!s) throw new HttpError(401, 'Sessão inválida.', 'UNAUTHENTICATED');
    if (s.revoked_at) {
      db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', d.iso(), s.user_id);
      d.audit(s.user_id, 'auth.refresh_reuse', 'session', s.id, null, ctx.ip);
      throw new HttpError(401, 'Sessão inválida.', 'UNAUTHENTICATED');
    }
    const u = db.get('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', s.user_id);
    if (!u || s.expires_at < d.iso()) throw new HttpError(401, 'Sessão expirada.', 'UNAUTHENTICATED');
    db.run('UPDATE sessions SET revoked_at=? WHERE id=?', d.iso(), s.id);
    return issue(ctx, u);
  });

  r.post('/auth/logout', (ctx) => {
    const tok = parseCookies(ctx.req.headers.cookie)[COOKIE];
    if (tok) db.run('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL', d.iso(), S.sha256(tok));
    ctx.res.setHeader('Set-Cookie', cookie('', 0));
    return { ok: true };
  });

  // gov.br: exige credenciamento (OpenID Connect). Aqui fica apenas o ponto de entrada.
  r.get('/auth/govbr', () => { throw new HttpError(501, 'Login com gov.br ainda não configurado.', 'GOVBR_NOT_CONFIGURED'); });
  r.post('/auth/govbr/simulado', async (ctx) => {
    if (!cfg.devTools) throw new HttpError(404, 'Rota não encontrada.');
    const pj = ctx.body.accountType === 'PJ';
    const doc = pj ? '11222333000181' : '52998224725';
    let u = db.get('SELECT * FROM users WHERE document_hash=?', S.docHash(doc));
    if (!u) {
      const id = d.uuid();
      db.run('INSERT INTO users(id,account_type,role,name,email,password_hash,document_type,document_hash,document_enc,document_last4,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        id, pj ? 'PJ' : 'PF', 'STUDENT', pj ? 'Empresa Demo (gov.br simulado)' : 'Pessoa Demo (gov.br simulado)', pj ? 'demo-pj@prumo.local' : 'demo-pf@prumo.local',
        null, pj ? 'CNPJ' : 'CPF', S.docHash(doc), S.encrypt(doc), doc.slice(-4), d.iso());
      u = db.get('SELECT * FROM users WHERE id=?', id);
    }
    return issue(ctx, u);
  });

  r.get('/me', { auth: true }, (ctx) => d.meDto(ctx.user));

  // LGPD: exclusão/anonimização da conta, confirmada com a senha.
  r.delete('/me', { auth: true }, async (ctx) => {
    if (!(await S.verifyPassword(String(ctx.body.password ?? ''), ctx.user.password_hash))) throw new HttpError(403, 'Senha incorreta.');
    const u = ctx.user, anon = 'removido-' + u.id;
    db.tx(() => {
      db.run("UPDATE users SET name='Conta removida', email=?, password_hash=NULL, document_hash=?, document_enc='', document_last4='----', deleted_at=? WHERE id=?", anon + '@removido.local', anon, d.iso(), u.id);
      db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', d.iso(), u.id);
      db.run('DELETE FROM businesses WHERE owner_id=?', u.id);
      db.run('DELETE FROM ai_conversations WHERE user_id=?', u.id);
      db.run('DELETE FROM notes WHERE user_id=?', u.id);
    });
    d.audit(u.id, 'user.delete', 'user', u.id, null, ctx.ip);
    ctx.res.setHeader('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
};
