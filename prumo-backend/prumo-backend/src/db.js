const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, account_type TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'STUDENT',
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT, govbr_sub TEXT UNIQUE,
  document_type TEXT NOT NULL, document_hash TEXT NOT NULL UNIQUE, document_enc TEXT NOT NULL, document_last4 TEXT NOT NULL,
  created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT, ip TEXT, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consents(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL,
  version TEXT NOT NULL, granted INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS businesses(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cnpj_hash TEXT UNIQUE,
  legal_name TEXT, regime TEXT NOT NULL DEFAULT 'NAO_INFORMADO', monthly_revenue_cents INTEGER, employees INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS plans(
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tier INTEGER NOT NULL, billing_cycle TEXT NOT NULL,
  period_days INTEGER NOT NULL, price_cents INTEGER NOT NULL, ai_daily_quota INTEGER NOT NULL, mentor_discount_pct INTEGER NOT NULL DEFAULT 0,
  news_frequency TEXT NOT NULL, group_mentoring INTEGER NOT NULL DEFAULT 0, business_analysis INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sub_user ON subscriptions(user_id, status);
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL, plan_id TEXT, appointment_id TEXT,
  amount_cents INTEGER NOT NULL, platform_fee_cents INTEGER NOT NULL DEFAULT 0, mentor_share_cents INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL, status TEXT NOT NULL, gateway_id TEXT UNIQUE, pix_copy_paste TEXT, paid_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS mentors(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), headline TEXT NOT NULL, bio TEXT,
  registry TEXT, status TEXT NOT NULL DEFAULT 'APPROVED', price_30_cents INTEGER NOT NULL, platform_fee_pct INTEGER NOT NULL DEFAULT 20);
CREATE TABLE IF NOT EXISTS availability(
  id INTEGER PRIMARY KEY AUTOINCREMENT, mentor_id TEXT NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS appointments(
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), mentor_id TEXT NOT NULL REFERENCES mentors(id),
  business_id TEXT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, subject TEXT, status TEXT NOT NULL,
  price_cents INTEGER NOT NULL, discount_pct INTEGER NOT NULL DEFAULT 0, video_room TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS appt_no_double_booking ON appointments(mentor_id, starts_at) WHERE status IN ('REQUESTED','CONFIRMED');
CREATE TABLE IF NOT EXISTS conversations(
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, mentor_id TEXT NOT NULL REFERENCES mentors(id),
  created_at TEXT NOT NULL, UNIQUE(student_id, mentor_id));
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS courses(
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, topic TEXT NOT NULL, instructor_id TEXT NOT NULL REFERENCES mentors(id),
  title TEXT NOT NULL, description TEXT, min_tier INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS lessons(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, position INTEGER NOT NULL,
  title TEXT NOT NULL, video_ref TEXT, duration_sec INTEGER, UNIQUE(course_id, position));
CREATE TABLE IF NOT EXISTS materials(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, file_key TEXT);
CREATE TABLE IF NOT EXISTS quiz_questions(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, position INTEGER NOT NULL, prompt TEXT NOT NULL, explanation TEXT);
CREATE TABLE IF NOT EXISTS quiz_options(
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE, text TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS quiz_attempts(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  score INTEGER NOT NULL, total INTEGER NOT NULL, answers TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lesson_progress(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL, PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS notes(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, course_id));
CREATE TABLE IF NOT EXISTS class_messages(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS cm_course ON class_messages(course_id, created_at);

CREATE TABLE IF NOT EXISTS ai_conversations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_messages(
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL,
  model TEXT, flagged_for_mentor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day));

CREATE TABLE IF NOT EXISTS news_items(
  id TEXT PRIMARY KEY, source_name TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, url TEXT, published_at TEXT NOT NULL, summary_ai TEXT, impact_br_ai TEXT);
CREATE TABLE IF NOT EXISTS news_digests(scope TEXT NOT NULL, period_day TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(scope, period_day));
CREATE TABLE IF NOT EXISTS tax_parameters(key TEXT NOT NULL, value TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, source_url TEXT, note TEXT, PRIMARY KEY(key, valid_from));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, meta TEXT, ip TEXT, created_at TEXT NOT NULL);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  raw.exec(SCHEMA);
  const cache = new Map();
  const st = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  return {
    raw,
    get: (sql, ...p) => st(sql).get(...p),
    all: (sql, ...p) => st(sql).all(...p),
    run: (sql, ...p) => st(sql).run(...p),
    // Transação síncrona: não use await dentro de fn.
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    close: () => raw.close(),
  };
}
module.exports = { open };
