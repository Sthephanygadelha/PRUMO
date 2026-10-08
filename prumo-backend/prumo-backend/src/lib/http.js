const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../config');
const S = require('./security');

class HttpError extends Error {
  constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const reply = (status, data) => ({ __reply: true, status, data });

function createRouter() {
  const routes = [];
  const add = (method) => (p, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, opts, handler });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

// Limitador em memória (por processo). Em produção com várias instâncias, trocar por Redis.
const hits = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60e3).unref();
function limit(key, max, windowMs) {
  if (!cfg.rateLimit) return;
  const t = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < t) { h = { n: 0, reset: t + windowMs }; hits.set(key, h); }
  if (++h.n > max) throw new HttpError(429, 'Muitas tentativas. Aguarde um pouco e tente novamente.', 'RATE_LIMITED');
}

const parseCookies = (h) => Object.fromEntries(String(h || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // O front atual usa onclick/style inline, por isso 'unsafe-inline'. Ao migrar para framework, remover.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  if (cfg.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, max = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'Corpo da requisição grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido.' });
  let rel; try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Caminho inválido.' }); }
  const file = path.normalize(path.join(cfg.publicDir, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(cfg.publicDir + path.sep)) return send(res, 404, { error: 'Não encontrado.' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Não encontrado.' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function createApp(db, router) {
  return async function app(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    if (cfg.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

    try {
      const p = url.pathname.slice(4);
      let route, params, pathMatched = false;
      for (const r of router.routes) {
        const m = r.re.exec(p);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        route = r; params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        break;
      }
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Método não permitido.' : 'Rota não encontrada.');

      const fwd = cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ctx = { req, res, db, params, query: Object.fromEntries(url.searchParams), ip: fwd || req.socket.remoteAddress || '', raw: '', body: {}, user: null, limit };

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        ctx.raw = await readBody(req);
        if (ctx.raw) { try { ctx.body = JSON.parse(ctx.raw); } catch { throw new HttpError(400, 'JSON inválido.'); } }
        if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'Envie um objeto JSON.');
      }

      if (route.opts.auth) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        const pl = m && S.verifyJwt(m[1]);
        const u = pl && db.get('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', pl.sub);
        if (u) ctx.user = u;
        else if (route.opts.auth !== 'optional') throw new HttpError(401, 'Faça login para continuar.', 'UNAUTHENTICATED');
      }
      if (route.opts.role && ctx.user?.role !== route.opts.role) throw new HttpError(403, 'Sem permissão.');

      const out = await route.handler(ctx);
      if (out && out.__reply) send(res, out.status, out.data); else send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.code && { code: e.code }), ...e.extra });
      console.error('Erro interno:', e);
      send(res, 500, { error: 'Erro interno. Tente novamente em instantes.' });
    }
  };
}

module.exports = { HttpError, reply, createRouter, createApp, parseCookies };
