const crypto = require('node:crypto');
const { promisify } = require('node:util');
const cfg = require('../config');
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = crypto.randomBytes(16);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  if (!stored) { await scrypt(pw, DUMMY_SALT, 64, SCRYPT); return false; } // mesmo custo: evita descobrir contas pelo tempo
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const got = await scrypt(pw, Buffer.from(s, 'base64'), 64, SCRYPT);
  const exp = Buffer.from(h, 'base64');
  return exp.length === got.length && crypto.timingSafeEqual(exp, got);
}

const b64u = (x) => Buffer.from(x).toString('base64url');
const hmac = (data, key) => crypto.createHmac('sha256', key).update(data).digest();
function signJwt(payload, ttl) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttl }));
  return `${h}.${p}.${hmac(`${h}.${p}`, cfg.jwtSecret).toString('base64url')}`;
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const exp = hmac(`${h}.${p}`, cfg.jwtSecret);
  const got = Buffer.from(s, 'base64url');
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
  try {
    if (JSON.parse(Buffer.from(h, 'base64url')).alg !== 'HS256') return null;
    const pl = JSON.parse(Buffer.from(p, 'base64url'));
    return pl.exp > Math.floor(Date.now() / 1000) ? pl : null;
  } catch { return null; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const docHash = (digits) => hmac(digits, cfg.docHmacKey).toString('hex');
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cfg.docEncKey, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const [iv, tag, ct] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cfg.docEncKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function validCPF(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[n]) return false;
  }
  return true;
}
function validCNPJ(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += +c[i] * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === +c[12] && dv(13) === +c[13];
}

module.exports = { hashPassword, verifyPassword, signJwt, verifyJwt, sha256, docHash, encrypt, decrypt, hmac, safeEqualHex, validCPF, validCNPJ };
