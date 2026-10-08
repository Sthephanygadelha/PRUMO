const crypto = require('node:crypto');
const S = require('./lib/security');

const uuid = () => crypto.randomUUID();
const iso = (t = Date.now()) => new Date(t).toISOString();
const BRT = 3 * 3600e3; // America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019)
const brtDay = (t = Date.now()) => new Date(t - BRT).toISOString().slice(0, 10);

module.exports = function domain(db) {
  const audit = (actorId, action, entity, entityId, meta, ip) =>
    db.run('INSERT INTO audit_log(actor_id,action,entity,entity_id,meta,ip,created_at) VALUES(?,?,?,?,?,?,?)',
      actorId ?? null, action, entity ?? null, entityId ?? null, meta ? JSON.stringify(meta) : null, ip ?? null, iso());

  const planDto = (p, periodEnd) => ({
    code: p.code, name: p.name, tier: p.tier, billingCycle: p.billing_cycle, priceCents: p.price_cents,
    aiDailyQuota: p.ai_daily_quota, mentorDiscountPct: p.mentor_discount_pct, newsFrequency: p.news_frequency,
    groupMentoring: !!p.group_mentoring, businessAnalysis: !!p.business_analysis, ...(periodEnd && { periodEnd }),
  });

  // Plano vigente: assinatura ativa e dentro do período; senão, gratuito.
  function effectivePlan(userId) {
    const row = db.get(`SELECT p.*, s.period_end FROM subscriptions s JOIN plans p ON p.id=s.plan_id
      WHERE s.user_id=? AND s.status='ACTIVE' AND s.period_end>? ORDER BY p.tier DESC LIMIT 1`, userId, iso());
    return row || db.get("SELECT * FROM plans WHERE code='free'");
  }

  const aiUsed = (userId) => db.get('SELECT count FROM ai_usage WHERE user_id=? AND day=?', userId, brtDay())?.count ?? 0;
  function quota(userId) {
    const dailyQuota = effectivePlan(userId).ai_daily_quota, used = aiUsed(userId);
    return { dailyQuota, used, remaining: Math.max(0, dailyQuota - used) };
  }

  function meDto(u) {
    const p = effectivePlan(u.id);
    return {
      id: u.id, name: u.name, email: u.email, accountType: u.account_type, role: u.role,
      document: { type: u.document_type, last4: u.document_last4 },
      plan: planDto(p, p.period_end), ai: quota(u.id),
    };
  }

  function taxParam(key, at = iso()) {
    const r = db.get('SELECT value FROM tax_parameters WHERE key=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) ORDER BY valid_from DESC LIMIT 1', key, at, at);
    return r ? JSON.parse(r.value) : null;
  }

  // Horários livres de 30 min (ISO UTC) a partir de fromDay (YYYY-MM-DD, BRT).
  function slotsFor(mentorId, fromDay, days) {
    const rules = db.all('SELECT weekday,start_min,end_min FROM availability WHERE mentor_id=?', mentorId);
    const booked = new Set(db.all("SELECT starts_at FROM appointments WHERE mentor_id=? AND status IN ('REQUESTED','CONFIRMED')", mentorId).map((r) => r.starts_at));
    const [y, m, d] = fromDay.split('-').map(Number);
    const minStart = Date.now() + 3600e3, out = [];
    for (let i = 0; i < days; i++) {
      const dayUtc = Date.UTC(y, m - 1, d + i), wd = new Date(dayUtc).getUTCDay();
      for (const r of rules.filter((x) => x.weekday === wd))
        for (let t = r.start_min; t + 30 <= r.end_min; t += 30) {
          const ts = dayUtc + BRT + t * 60e3;
          if (ts >= minStart && !booked.has(iso(ts))) out.push(iso(ts));
        }
    }
    return out.sort();
  }

  // Confirma um pagamento (webhook do gateway ou simulação em dev). Idempotente.
  function confirmPayment(gatewayId) {
    return db.tx(() => {
      const pay = db.get('SELECT * FROM payments WHERE gateway_id=?', gatewayId);
      if (!pay) return null;
      if (pay.status === 'PAID') return pay;
      db.run("UPDATE payments SET status='PAID', paid_at=? WHERE id=?", iso(), pay.id);
      if (pay.purpose === 'SUBSCRIPTION') {
        const plan = db.get('SELECT * FROM plans WHERE id=?', pay.plan_id);
        db.run("UPDATE subscriptions SET status='REPLACED' WHERE user_id=? AND status='ACTIVE'", pay.user_id);
        db.run("INSERT INTO subscriptions(id,user_id,plan_id,status,period_start,period_end,created_at) VALUES(?,?,?,'ACTIVE',?,?,?)",
          uuid(), pay.user_id, plan.id, iso(), iso(Date.now() + plan.period_days * 86400e3), iso());
      } else if (pay.purpose === 'APPOINTMENT') {
        db.run("UPDATE appointments SET status='CONFIRMED', video_room=? WHERE id=? AND status='REQUESTED'", 'prumo-' + pay.appointment_id.slice(0, 8), pay.appointment_id);
      }
      audit(pay.user_id, 'payment.paid', 'payment', pay.id, { purpose: pay.purpose });
      return db.get('SELECT * FROM payments WHERE id=?', pay.id);
    });
  }

  return { uuid, iso, brtDay, audit, planDto, effectivePlan, quota, meDto, taxParam, slotsFor, confirmPayment, S };
};
module.exports.uuid = uuid; module.exports.iso = iso; module.exports.brtDay = brtDay;
