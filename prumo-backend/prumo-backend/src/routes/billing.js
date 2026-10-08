const cfg = require('../config');
const S = require('../lib/security');
const { HttpError, reply } = require('../lib/http');

module.exports = (r, { db, d }) => {
  // Inicia a cobrança de um plano. Dados de cartão NUNCA passam por este servidor:
  // com o gateway real, o cartão é tokenizado no navegador (SDK do gateway) ou numa página hospedada por ele.
  r.post('/checkout', { auth: true }, (ctx) => {
    const plan = db.get('SELECT * FROM plans WHERE code=? AND active=1', String(ctx.body.planCode ?? ''));
    if (!plan) throw new HttpError(404, 'Plano não encontrado.');
    if (plan.price_cents === 0) throw new HttpError(400, 'O plano gratuito não requer pagamento.');
    const method = ctx.body.method === 'CARD' ? 'CARD' : 'PIX';
    const id = d.uuid(), gw = 'sim_' + d.uuid(), pix = method === 'PIX' ? '00020126-EXEMPLO-PIX-' + gw.slice(4, 12) : null;
    db.run("INSERT INTO payments(id,user_id,purpose,plan_id,amount_cents,method,status,gateway_id,pix_copy_paste,created_at) VALUES(?,?,'SUBSCRIPTION',?,?,?,'PENDING',?,?,?)",
      id, ctx.user.id, plan.id, plan.price_cents, method, gw, pix, d.iso());
    d.audit(ctx.user.id, 'checkout.start', 'payment', id, { plan: plan.code, method }, ctx.ip);
    return reply(201, { paymentId: id, status: 'PENDING', method, amountCents: plan.price_cents, pixCopyPaste: pix, devMode: cfg.devTools });
  });

  r.get('/payments/:id', { auth: true }, (ctx) => {
    const p = db.get('SELECT id,purpose,amount_cents AS amountCents,method,status,paid_at AS paidAt FROM payments WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id);
    if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
    return p;
  });

  // Webhook do gateway: confere assinatura HMAC-SHA256 do corpo bruto (cabeçalho x-signature, em hex).
  r.post('/webhooks/payments', (ctx) => {
    if (!S.safeEqualHex(ctx.req.headers['x-signature'], S.hmac(ctx.raw, cfg.webhookSecret).toString('hex'))) throw new HttpError(401, 'Assinatura inválida.');
    const { gatewayId, status } = ctx.body;
    if (typeof gatewayId !== 'string') throw new HttpError(400, 'gatewayId ausente.');
    if (status === 'PAID') { if (!d.confirmPayment(gatewayId)) throw new HttpError(404, 'Pagamento não encontrado.'); }
    else if (status === 'FAILED') db.run("UPDATE payments SET status='FAILED' WHERE gateway_id=? AND status='PENDING'", gatewayId);
    return { ok: true };
  });

  // Somente desenvolvimento: finge o aviso do gateway.
  r.post('/dev/payments/:id/pay', { auth: true }, (ctx) => {
    if (!cfg.devTools) throw new HttpError(404, 'Rota não encontrada.');
    const p = db.get('SELECT gateway_id FROM payments WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id);
    if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
    d.confirmPayment(p.gateway_id);
    return { ok: true, me: d.meDto(ctx.user) };
  });
};
