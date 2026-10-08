const { HttpError, reply } = require('../lib/http');

module.exports = (r, { db, d }) => {
  const discountFor = (user) => (user ? d.effectivePlan(user.id).mentor_discount_pct : 0);
  const priceWith = (cents, pct) => Math.round((cents * (100 - pct)) / 100);

  r.get('/mentors', { auth: 'optional' }, (ctx) => {
    const pct = discountFor(ctx.user);
    const rows = db.all(`SELECT m.id,u.name,m.headline,m.bio,m.registry,m.price_30_cents FROM mentors m JOIN users u ON u.id=m.user_id
      WHERE m.status='APPROVED' ORDER BY u.name`);
    return { mentors: rows.map((m) => ({ id: m.id, name: m.name, headline: m.headline, bio: m.bio, registry: m.registry,
      price30Cents: m.price_30_cents, yourPrice30Cents: priceWith(m.price_30_cents, pct), discountPct: pct })) };
  });

  r.get('/mentors/:id/slots', (ctx) => {
    if (!db.get("SELECT 1 x FROM mentors WHERE id=? AND status='APPROVED'", ctx.params.id)) throw new HttpError(404, 'Mentor não encontrado.');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.from ?? '') ? ctx.query.from : d.brtDay();
    const days = Math.min(14, Math.max(1, parseInt(ctx.query.days, 10) || 7));
    return { timezone: 'America/Sao_Paulo', slots: d.slotsFor(ctx.params.id, from, days) };
  });

  // ---------- Agendamentos ----------
  r.post('/appointments', { auth: true }, (ctx) => {
    ctx.limit('appt:' + ctx.user.id, 10, 3600e3);
    const b = ctx.body, mentor = db.get("SELECT * FROM mentors WHERE id=? AND status='APPROVED'", b.mentorId);
    if (!mentor) throw new HttpError(404, 'Mentor não encontrado.');
    const t = new Date(b.startsAt);
    if (Number.isNaN(t.getTime())) throw new HttpError(400, 'Horário inválido.');
    const startsAt = t.toISOString(), day = d.brtDay(t.getTime());
    if (!d.slotsFor(mentor.id, day, 1).includes(startsAt)) throw new HttpError(409, 'Esse horário não está disponível.', 'SLOT_UNAVAILABLE');
    const subject = String(b.subject ?? '').trim().slice(0, 500);
    const pct = discountFor(ctx.user), price = priceWith(mentor.price_30_cents, pct);
    const id = d.uuid(), free = price === 0;
    let payment = null;
    try {
      db.tx(() => {
        db.run('INSERT INTO appointments(id,student_id,mentor_id,starts_at,ends_at,subject,status,price_cents,discount_pct,video_room,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          id, ctx.user.id, mentor.id, startsAt, d.iso(t.getTime() + 30 * 60e3), subject, free ? 'CONFIRMED' : 'REQUESTED', price, pct, free ? 'prumo-' + id.slice(0, 8) : null, d.iso());
        if (!free) {
          const fee = Math.round((price * mentor.platform_fee_pct) / 100), gw = 'sim_' + d.uuid();
          const method = b.method === 'CARD' ? 'CARD' : 'PIX';
          payment = { id: d.uuid(), gatewayId: gw, method, amountCents: price, pixCopyPaste: method === 'PIX' ? '00020126-EXEMPLO-PIX-' + gw.slice(4, 12) : null };
          db.run("INSERT INTO payments(id,user_id,purpose,appointment_id,amount_cents,platform_fee_cents,mentor_share_cents,method,status,gateway_id,pix_copy_paste,created_at) VALUES(?,?,'APPOINTMENT',?,?,?,?,?,'PENDING',?,?,?)",
            payment.id, ctx.user.id, id, price, fee, price - fee, method, gw, payment.pixCopyPaste, d.iso());
        }
      });
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'Esse horário acabou de ser reservado.', 'SLOT_UNAVAILABLE');
      throw e;
    }
    return reply(201, { appointment: db.get('SELECT id,mentor_id AS mentorId,starts_at AS startsAt,ends_at AS endsAt,subject,status,price_cents AS priceCents,discount_pct AS discountPct,video_room AS videoRoom FROM appointments WHERE id=?', id),
      payment: payment && { paymentId: payment.id, method: payment.method, amountCents: payment.amountCents, pixCopyPaste: payment.pixCopyPaste } });
  });

  r.get('/appointments', { auth: true }, (ctx) => ({
    appointments: db.all(`SELECT a.id,a.starts_at AS startsAt,a.ends_at AS endsAt,a.subject,a.status,a.price_cents AS priceCents,a.video_room AS videoRoom,
        mu.name AS mentorName, su.name AS studentName FROM appointments a JOIN mentors m ON m.id=a.mentor_id JOIN users mu ON mu.id=m.user_id JOIN users su ON su.id=a.student_id
      WHERE a.student_id=? OR m.user_id=? ORDER BY a.starts_at DESC LIMIT 100`, ctx.user.id, ctx.user.id),
  }));

  r.post('/appointments/:id/cancel', { auth: true }, (ctx) => {
    const a = db.get('SELECT a.*, m.user_id AS mentor_user FROM appointments a JOIN mentors m ON m.id=a.mentor_id WHERE a.id=?', ctx.params.id);
    if (!a || (a.student_id !== ctx.user.id && a.mentor_user !== ctx.user.id)) throw new HttpError(404, 'Agendamento não encontrado.');
    if (!['REQUESTED', 'CONFIRMED'].includes(a.status) || a.starts_at <= d.iso()) throw new HttpError(409, 'Este agendamento não pode mais ser cancelado.');
    db.run("UPDATE appointments SET status='CANCELED' WHERE id=?", a.id);
    const paid = !!db.get("SELECT 1 x FROM payments WHERE appointment_id=? AND status='PAID'", a.id);
    d.audit(ctx.user.id, 'appointment.cancel', 'appointment', a.id, { refundPending: paid }, ctx.ip);
    return { ok: true, refundPending: paid }; // estorno deve ser feito no gateway
  });

  // ---------- Chat com mentor ----------
  function conv(ctx) {
    const c = db.get('SELECT c.*, m.user_id AS mentor_user FROM conversations c JOIN mentors m ON m.id=c.mentor_id WHERE c.id=?', ctx.params.id);
    if (!c || (c.student_id !== ctx.user.id && c.mentor_user !== ctx.user.id)) throw new HttpError(404, 'Conversa não encontrada.');
    return c;
  }
  r.post('/conversations', { auth: true }, (ctx) => {
    if (!db.get("SELECT 1 x FROM mentors WHERE id=? AND status='APPROVED'", ctx.body.mentorId)) throw new HttpError(404, 'Mentor não encontrado.');
    db.run('INSERT OR IGNORE INTO conversations(id,student_id,mentor_id,created_at) VALUES(?,?,?,?)', d.uuid(), ctx.user.id, ctx.body.mentorId, d.iso());
    return { id: db.get('SELECT id FROM conversations WHERE student_id=? AND mentor_id=?', ctx.user.id, ctx.body.mentorId).id };
  });
  r.get('/conversations', { auth: true }, (ctx) => ({
    conversations: db.all(`SELECT c.id, mu.name AS mentorName, su.name AS studentName FROM conversations c JOIN mentors m ON m.id=c.mentor_id
      JOIN users mu ON mu.id=m.user_id JOIN users su ON su.id=c.student_id WHERE c.student_id=? OR m.user_id=? ORDER BY c.created_at DESC`, ctx.user.id, ctx.user.id),
  }));
  r.get('/conversations/:id/messages', { auth: true }, (ctx) => {
    const c = conv(ctx);
    return { messages: db.all('SELECT id,sender_id AS senderId,body,created_at AS createdAt FROM messages WHERE conversation_id=? AND created_at>? ORDER BY created_at LIMIT 200', c.id, ctx.query.since ?? '') };
  });
  r.post('/conversations/:id/messages', { auth: true }, (ctx) => {
    const c = conv(ctx), body = String(ctx.body.body ?? '').trim();
    ctx.limit('msg:' + ctx.user.id, 30, 60e3);
    if (!body || body.length > 2000) throw new HttpError(400, 'Mensagem vazia ou longa demais (máx. 2000).');
    const id = d.uuid();
    db.run('INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)', id, c.id, ctx.user.id, body, d.iso());
    return reply(201, { id });
  });
};
