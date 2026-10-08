const { HttpError } = require('../lib/http');
const ai = require('../services/ai');

module.exports = (r, { db, d }) => {
  r.get('/ai/quota', { auth: true }, (ctx) => d.quota(ctx.user.id));

  r.post('/ai/chat', { auth: true }, async (ctx) => {
    ctx.limit('ai:' + ctx.user.id, 20, 60e3);
    const message = String(ctx.body.message ?? '').trim();
    if (!message || message.length > 1000) throw new HttpError(400, 'Digite uma pergunta de até 1000 caracteres.');

    let convId = ctx.body.conversationId;
    if (convId && !db.get('SELECT 1 x FROM ai_conversations WHERE id=? AND user_id=?', convId, ctx.user.id)) throw new HttpError(404, 'Conversa não encontrada.');

    // Cota diária consumida de forma atômica (impede furar o limite com requisições simultâneas).
    const day = d.brtDay(), limit = d.effectivePlan(ctx.user.id).ai_daily_quota;
    db.run('INSERT OR IGNORE INTO ai_usage(user_id,day,count) VALUES(?,?,0)', ctx.user.id, day);
    if (db.run('UPDATE ai_usage SET count=count+1 WHERE user_id=? AND day=? AND count<?', ctx.user.id, day, limit).changes !== 1)
      throw new HttpError(429, 'Limite diário de perguntas atingido. Veja os planos para ampliar o acesso à IA.', 'AI_QUOTA_EXCEEDED', { quota: d.quota(ctx.user.id) });

    let result;
    try {
      const history = convId ? db.all('SELECT role,content FROM ai_messages WHERE conversation_id=? ORDER BY seq DESC LIMIT 10', convId).reverse()
        .map((m) => ({ role: m.role.toLowerCase(), content: m.content })) : [];
      result = await ai.answer(history, message, d.taxParam('mei_annual_limit_cents') / 100);
    } catch (e) {
      db.run('UPDATE ai_usage SET count=MAX(0,count-1) WHERE user_id=? AND day=?', ctx.user.id, day); // falha do provedor não gasta a cota
      throw e;
    }

    db.tx(() => {
      if (!convId) {
        convId = d.uuid();
        db.run('INSERT INTO ai_conversations(id,user_id,title,created_at) VALUES(?,?,?,?)', convId, ctx.user.id, message.slice(0, 60), d.iso());
      }
      const seq = (db.get('SELECT COALESCE(MAX(seq),0) n FROM ai_messages WHERE conversation_id=?', convId).n);
      db.run("INSERT INTO ai_messages(id,conversation_id,role,content,created_at,seq) VALUES(?,?,'USER',?,?,?)", d.uuid(), convId, message, d.iso(), seq + 1);
      db.run("INSERT INTO ai_messages(id,conversation_id,role,content,model,flagged_for_mentor,created_at,seq) VALUES(?,?,'ASSISTANT',?,?,?,?,?)",
        d.uuid(), convId, result.text, result.model, result.flagged ? 1 : 0, d.iso(), seq + 2);
    });
    return { conversationId: convId, reply: result.text, suggestMentor: result.flagged, quota: d.quota(ctx.user.id) };
  });

  r.get('/ai/conversations', { auth: true }, (ctx) => ({
    conversations: db.all('SELECT id,title,created_at AS createdAt FROM ai_conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 50', ctx.user.id),
  }));
  r.get('/ai/conversations/:id', { auth: true }, (ctx) => {
    if (!db.get('SELECT 1 x FROM ai_conversations WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id)) throw new HttpError(404, 'Conversa não encontrada.');
    return { messages: db.all('SELECT role,content,created_at AS createdAt FROM ai_messages WHERE conversation_id=? ORDER BY seq', ctx.params.id) };
  });
};
