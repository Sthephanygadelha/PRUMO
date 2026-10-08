const { HttpError } = require('../lib/http');

module.exports = (r, { db, d }) => {
  r.get('/plans', () => ({ plans: db.all('SELECT * FROM plans WHERE active=1 ORDER BY tier').map((p) => d.planDto(p)) }));

  // ---------- Cursos ----------
  function course(ctx) {
    const c = db.get(`SELECT c.*, u.name AS instructor FROM courses c JOIN mentors m ON m.id=c.instructor_id JOIN users u ON u.id=m.user_id
      WHERE c.id=? AND c.published=1`, ctx.params.id);
    if (!c) throw new HttpError(404, 'Curso não encontrado.');
    const tier = d.effectivePlan(ctx.user.id).tier;
    if (c.min_tier > tier) throw new HttpError(403, 'Este curso exige um plano superior.', 'PLAN_REQUIRED', { requiredTier: c.min_tier });
    return c;
  }
  const progressOf = (userId, courseId) => {
    const total = db.get('SELECT COUNT(*) n FROM lessons WHERE course_id=?', courseId).n;
    const done = db.get('SELECT COUNT(*) n FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id WHERE lp.user_id=? AND l.course_id=?', userId, courseId).n;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  };

  r.get('/courses', { auth: true }, (ctx) => {
    const tier = d.effectivePlan(ctx.user.id).tier;
    const rows = db.all(`SELECT c.id,c.slug,c.topic,c.title,c.description,c.min_tier,u.name AS instructor FROM courses c
      JOIN mentors m ON m.id=c.instructor_id JOIN users u ON u.id=m.user_id WHERE c.published=1 ORDER BY c.position`);
    return { courses: rows.map((c) => ({ id: c.id, slug: c.slug, topic: c.topic, title: c.title, instructor: c.instructor, minTier: c.min_tier,
      locked: c.min_tier > tier, ...(c.min_tier <= tier && { progress: progressOf(ctx.user.id, c.id) }) })) };
  });

  r.get('/courses/:id', { auth: true }, (ctx) => {
    const c = course(ctx);
    const questions = db.all('SELECT id,prompt FROM quiz_questions WHERE course_id=? ORDER BY position', c.id)
      .map((q) => ({ ...q, options: db.all('SELECT id,text FROM quiz_options WHERE question_id=?', q.id) })); // sem o gabarito
    return {
      id: c.id, title: c.title, topic: c.topic, instructor: c.instructor, description: c.description,
      lessons: db.all('SELECT l.id,l.position,l.title,l.duration_sec AS durationSec, EXISTS(SELECT 1 FROM lesson_progress p WHERE p.lesson_id=l.id AND p.user_id=?) AS done FROM lessons l WHERE l.course_id=? ORDER BY l.position', ctx.user.id, c.id)
        .map((l) => ({ ...l, done: !!l.done })),
      materials: db.all('SELECT id,kind,title FROM materials WHERE course_id=?', c.id),
      quiz: questions, note: db.get('SELECT content FROM notes WHERE user_id=? AND course_id=?', ctx.user.id, c.id)?.content ?? '',
      progress: progressOf(ctx.user.id, c.id),
    };
  });

  r.post('/courses/:id/lessons/:lessonId/progress', { auth: true }, (ctx) => {
    const c = course(ctx);
    if (!db.get('SELECT 1 x FROM lessons WHERE id=? AND course_id=?', ctx.params.lessonId, c.id)) throw new HttpError(404, 'Aula não encontrada.');
    if (ctx.body.done === false) db.run('DELETE FROM lesson_progress WHERE user_id=? AND lesson_id=?', ctx.user.id, ctx.params.lessonId);
    else db.run('INSERT OR IGNORE INTO lesson_progress(user_id,lesson_id,completed_at) VALUES(?,?,?)', ctx.user.id, ctx.params.lessonId, d.iso());
    return progressOf(ctx.user.id, c.id);
  });

  r.put('/courses/:id/note', { auth: true }, (ctx) => {
    const c = course(ctx), content = String(ctx.body.content ?? '');
    if (content.length > 5000) throw new HttpError(400, 'Anotação muito longa (máx. 5000 caracteres).');
    db.run('INSERT INTO notes(user_id,course_id,content,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at', ctx.user.id, c.id, content, d.iso());
    return { ok: true };
  });

  // A correção é feita aqui: o cliente nunca recebe o gabarito antes de responder.
  r.post('/courses/:id/quiz/attempt', { auth: true }, (ctx) => {
    const c = course(ctx), answers = ctx.body.answers;
    if (!answers || typeof answers !== 'object') throw new HttpError(400, 'Envie "answers": { perguntaId: opçãoId }.');
    const qs = db.all('SELECT id,explanation FROM quiz_questions WHERE course_id=? ORDER BY position', c.id);
    const results = qs.map((q) => {
      const ok = db.get('SELECT id FROM quiz_options WHERE question_id=? AND is_correct=1', q.id);
      return { questionId: q.id, correct: answers[q.id] === ok.id, correctOptionId: ok.id, explanation: q.explanation };
    });
    const score = results.filter((x) => x.correct).length;
    db.run('INSERT INTO quiz_attempts(id,user_id,course_id,score,total,answers,created_at) VALUES(?,?,?,?,?,?,?)', d.uuid(), ctx.user.id, c.id, score, qs.length, JSON.stringify(answers), d.iso());
    return { score, total: qs.length, results };
  });

  r.get('/courses/:id/messages', { auth: true }, (ctx) => {
    const c = course(ctx);
    const rows = db.all(`SELECT m.id,m.body,m.created_at AS createdAt,u.name FROM class_messages m JOIN users u ON u.id=m.user_id
      WHERE m.course_id=? ORDER BY m.created_at DESC LIMIT 50`, c.id).reverse();
    return { messages: rows.map((m) => ({ ...m, author: String(m.name).split(' ')[0], name: undefined })) };
  });
  r.post('/courses/:id/messages', { auth: true }, (ctx) => {
    const c = course(ctx), body = String(ctx.body.body ?? '').trim();
    ctx.limit('class-msg:' + ctx.user.id, 20, 60e3);
    if (!body || body.length > 500) throw new HttpError(400, 'Mensagem vazia ou longa demais (máx. 500).');
    const id = d.uuid();
    db.run('INSERT INTO class_messages(id,course_id,user_id,body,created_at) VALUES(?,?,?,?,?)', id, c.id, ctx.user.id, body, d.iso());
    return { id, body, author: ctx.user.name.split(' ')[0] };
  });

  // ---------- Notícias ----------
  r.get('/news', { auth: true }, (ctx) => {
    const plan = d.effectivePlan(ctx.user.id), scope = plan.news_frequency;
    const cat = ctx.query.category;
    const items = db.all(`SELECT id,source_name AS source,category,title,url,published_at AS publishedAt,impact_br_ai AS impactBr FROM news_items
      WHERE (? IS NULL OR category=?) ORDER BY published_at DESC LIMIT 50`, cat ?? null, cat ?? null);
    const digest = db.get('SELECT summary FROM news_digests WHERE scope=? ORDER BY period_day DESC LIMIT 1', scope);
    return { edition: scope === 'DAILY' ? 'daily' : 'weekly', summary: digest?.summary ?? '', items };
  });

  // ---------- Simulador "Devo abrir CNPJ?" ----------
  r.post('/simulator/cnpj', (ctx) => {
    ctx.limit('sim:' + ctx.ip, 60, 60e3);
    const b = ctx.body, f = Number(b.monthlyRevenue), w = Number(b.employees ?? 0);
    if (!Number.isFinite(f) || f < 0 || f > 1e9 || !Number.isInteger(w) || w < 0 || w > 1000) throw new HttpError(400, 'Valores inválidos.');
    const limit = d.taxParam('mei_annual_limit_cents') / 100, maxEmp = d.taxParam('mei_max_employees'), formalize = d.taxParam('mei_formalize_monthly_cents') / 100;
    const out = (code, title, text) => ({ code, title, text, meiAnnualLimit: limit,
      disclaimer: `Critérios simplificados de exemplo. Limite do MEI na base: R$ ${limit.toLocaleString('pt-BR')} por ano. Não substitui um contador.` });
    if (f * 12 > limit || w > maxEmp) return out('ABOVE_MEI', 'Acima do perfil de MEI', 'Seu negócio pode precisar de outro enquadramento, como ME no Simples Nacional. Converse com um mentor.');
    if (b.needsInvoice || b.sellsToCompanies || f >= formalize) return out('CONSIDER_MEI', 'Vale considerar abrir um MEI', 'Há sinais de que formalizar pode trazer vantagens: nota fiscal, vendas para empresas e INSS.');
    return out('STAY_PF', 'Ainda pode seguir como pessoa física', 'Acompanhe o crescimento. Quando vender com regularidade ou precisar de nota, reavalie.');
  });
};
