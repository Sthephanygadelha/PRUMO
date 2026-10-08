const { uuid, iso } = require('./domain');
const S = require('./lib/security');

// Dados iniciais (equivalentes aos arrays do protótipo). Só roda com o banco vazio.
module.exports = function seed(db) {
  if (db.get('SELECT 1 AS x FROM plans LIMIT 1')) return;
  const now = Date.now(), day = 86400e3;
  db.tx(() => {
    const plans = [
      ['free', 'Gratuito', 0, 'FREE', 36500, 0, 5, 0, 'WEEKLY', 0, 0],
      ['monthly', 'Mensal', 1, 'MONTHLY', 30, 2990, 30, 10, 'DAILY', 0, 0],
      ['quarterly', 'Trimestral', 2, 'QUARTERLY', 90, 7990, 60, 15, 'DAILY', 1, 0],
      ['annual', 'Anual', 3, 'ANNUAL', 365, 27900, 100, 25, 'DAILY', 1, 1],
    ];
    // colunas: code, name, tier, ciclo, dias, preço, cota IA/dia, desconto mentoria %, notícias, mentoria em grupo, análise do negócio
    for (const [code, name, tier, cycle, days, price, quota, disc, news, group, analysis] of plans)
      db.run('INSERT INTO plans(id,code,name,tier,billing_cycle,period_days,price_cents,ai_daily_quota,mentor_discount_pct,news_frequency,group_mentoring,business_analysis) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        uuid(), code, name, tier, cycle, days, price, quota, disc, news, group, analysis);
    const mentors = [
      ['Prof. Marta Lins', 'Professora · Tributação para MEI', 'Contadora e professora.', 'CRC (exemplo)', 5000],
      ['Prof. Rafael Souza', 'Professor · Regimes tributários', 'Consultor tributário.', 'CRC (exemplo)', 7000],
      ['Profa. Ana Torres', 'Professora · Finanças do pequeno negócio', 'Especialista em fluxo de caixa.', 'CORECON (exemplo)', 6000],
      ['Carla Mendes', 'Contadora · Tributário MEI', 'Atende MEIs e autônomos.', 'CRC (exemplo)', 6000],
      ['Bruno Alves', 'Consultor · Abertura de CNPJ', 'Ajuda na formalização.', 'CRC (exemplo)', 8000],
      ['Joana Prado', 'Economista · Visão de mercado', 'Cenário econômico e preços.', 'CORECON (exemplo)', 9000],
    ];
    const mid = [];
    mentors.forEach(([name, headline, bio, reg, price], i) => {
      const uid = uuid(), id = uuid(); mid.push(id);
      db.run('INSERT INTO users(id,account_type,role,name,email,password_hash,document_type,document_hash,document_enc,document_last4,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?,?)',
        uid, 'PF', 'MENTOR', name, `mentor${i + 1}@prumo.local`, 'CPF', S.docHash('seed-mentor-' + i), S.encrypt('seed'), '----', iso());
      db.run('INSERT INTO mentors(id,user_id,headline,bio,registry,status,price_30_cents) VALUES(?,?,?,?,?,?,?)', id, uid, headline, bio, reg, 'APPROVED', price);
      for (let wd = 1; wd <= 5; wd++) {
        db.run('INSERT INTO availability(mentor_id,weekday,start_min,end_min) VALUES(?,?,?,?)', id, wd, 9 * 60, 12 * 60);
        db.run('INSERT INTO availability(mentor_id,weekday,start_min,end_min) VALUES(?,?,?,?)', id, wd, 14 * 60, 17 * 60);
      }
    });

    const courses = [
      ['tributacao-mei', 'Tributação', 'Tributação para MEI', 0, 0, ['O que é o DAS', 'Limite de faturamento', 'Declaração anual (DASN)'],
        ['Qual o limite anual de faturamento do MEI?', ['R$ 81 mil', 'R$ 500 mil', 'Não há limite'], 0, 'O limite vigente fica em tax_parameters e pode mudar por lei. Confirme no Portal do Empreendedor.']],
      ['regimes-tributarios', 'Tributação', 'Regimes tributários', 1, 1, ['Simples Nacional', 'Lucro Presumido', 'Quando mudar de regime'],
        ['Qual regime costuma ser mais simples para pequenos negócios?', ['Lucro Real', 'Simples Nacional', 'Nenhum'], 1, 'O Simples Nacional unifica vários tributos em uma guia.']],
      ['fluxo-de-caixa', 'Finanças', 'Fluxo de caixa básico', 2, 1, ['Entradas e saídas', 'Separar PF e PJ', 'Planejar o mês'],
        ['Por que separar finanças pessoais e do negócio?', ['Para pagar mais imposto', 'Para ter clareza do lucro real', 'Não faz diferença'], 1, 'Misturar contas esconde o resultado real do negócio.']],
    ];
    courses.forEach(([slug, topic, title, inst, minTier, lessons, [prompt, opts, ok, expl]], i) => {
      const cid = uuid();
      db.run('INSERT INTO courses(id,slug,topic,instructor_id,title,description,min_tier,position,published) VALUES(?,?,?,?,?,?,?,?,1)', cid, slug, topic, mid[inst], title, 'Curso de exemplo do protótipo.', minTier, i);
      lessons.forEach((t, j) => db.run('INSERT INTO lessons(id,course_id,position,title,duration_sec) VALUES(?,?,?,?,?)', uuid(), cid, j + 1, t, 600));
      for (const [kind, t] of [['APOSTILA', 'Apostila da aula (exemplo)'], ['MEMORANDO', 'Memorando: resumo em 1 página (exemplo)']])
        db.run('INSERT INTO materials(id,course_id,kind,title) VALUES(?,?,?,?)', uuid(), cid, kind, t);
      const qid = uuid();
      db.run('INSERT INTO quiz_questions(id,course_id,position,prompt,explanation) VALUES(?,?,?,?,?)', qid, cid, 1, prompt, expl);
      opts.forEach((o, k) => db.run('INSERT INTO quiz_options(id,question_id,text,is_correct) VALUES(?,?,?,?)', uuid(), qid, o, k === ok ? 1 : 0));
    });

    const news = [
      ['TRIBUTARIO', 0, 'Jornal econômico (exemplo)', 'Novas regras para tributação do consumo seguem em debate', 'Pode mudar como pequenos negócios calculam preços e emitem notas. Acompanhe os prazos de transição.'],
      ['FISCAL', 1, 'Blog contábil (exemplo)', 'Declaração anual do MEI: o que revisar antes de enviar', 'Atrasos geram multa. Organize notas e faturamento do ano.'],
      ['ECONOMICO', 1, 'Agência de notícias (exemplo)', 'Juros e crédito: efeito da taxa básica sobre pequenos empreendedores', 'Crédito mais caro reduz a capacidade de investir. Priorize o caixa.'],
      ['INTERNACIONAL', 2, 'Jornal internacional (exemplo)', 'Mudança na política de juros dos EUA movimenta o dólar', 'Dólar mais alto encarece insumos importados e pode pressionar preços no Brasil.'],
      ['FISCAL', 3, 'Portal de contabilidade (exemplo)', 'Cuidados ao emitir nota eletrônica para empresas', 'Erros na nota podem atrasar pagamentos de clientes PJ.'],
      ['INTERNACIONAL', 4, 'Agência internacional (exemplo)', 'Petróleo sobe com tensões no exterior', 'Combustível e frete mais caros elevam custos de quem entrega mercadorias.'],
      ['ECONOMICO', 5, 'Jornal econômico (exemplo)', 'Inflação de alimentos desacelera no mês', 'Alívio nos custos de matéria-prima para alimentação e comércio.'],
      ['TRIBUTARIO', 6, 'Blog tributário (exemplo)', 'Simples Nacional: quando vale migrar de MEI para ME', 'Passar do limite sem se reenquadrar pode gerar cobrança retroativa.'],
    ];
    for (const [cat, ago, src, title, impact] of news)
      db.run('INSERT INTO news_items(id,source_name,category,title,published_at,summary_ai,impact_br_ai) VALUES(?,?,?,?,?,?,?)', uuid(), src, cat, title, iso(now - ago * day), null, impact);
    const sum = 'cenário misto. Juros e dólar pressionam custos de quem importa insumos ou depende de crédito, enquanto a inflação de alimentos desacelera. Para pequenos negócios, vale revisar preços e proteger o caixa. (Resumo de exemplo.)';
    db.run('INSERT INTO news_digests VALUES(?,?,?)', 'DAILY', '0000-00-00', 'Resumo de hoje: ' + sum);
    db.run('INSERT INTO news_digests VALUES(?,?,?)', 'WEEKLY', '0000-00-00', 'Resumo da semana: ' + sum);

    const tp = (k, v, note) => db.run('INSERT INTO tax_parameters(key,value,valid_from,note) VALUES(?,?,?,?)', k, JSON.stringify(v), '2018-01-01T00:00:00.000Z', note);
    tp('mei_annual_limit_cents', 8100000, 'Limite anual do MEI. Confirme a vigência na legislação antes de usar em produção.');
    tp('mei_max_employees', 1, 'MEI pode ter no máximo 1 empregado.');
    tp('mei_formalize_monthly_cents', 200000, 'Faturamento mensal a partir do qual o simulador sugere formalizar (critério do protótipo).');
  });
};
