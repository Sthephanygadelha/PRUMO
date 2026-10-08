const cfg = require('../config');
const { HttpError } = require('../lib/http');

const SYSTEM = (meiLimit) => `Você é a IA do Prumo, uma plataforma de educação tributária, fiscal e econômica para MEIs, pequenos comércios, start-ups e pessoas físicas que empreendem.
Regras:
- Responda em português do Brasil, em linguagem simples, com no máximo 6 frases curtas, e explique o porquê das coisas.
- Seu papel é educacional. Você não substitui contador, advogado nem mentor. Em casos específicos, valores, prazos ou decisões com risco (multas, desenquadramento, planejamento), diga isso e sugira agendar uma assessoria com um mentor da plataforma.
- Valores, alíquotas e prazos mudam por lei. Cite-os com cautela e recomende confirmar em fonte oficial (Portal do Empreendedor, Receita Federal, Sebrae). Limite anual do MEI na base do Prumo: R$ ${meiLimit.toLocaleString('pt-BR')}.
- Não peça nem repita CPF, CNPJ completo, senhas ou dados bancários. Se o usuário os enviar, peça para não compartilhar.
- Se a pergunta fugir de tributos, finanças e negócios, diga gentilmente que não pode ajudar com isso aqui.`;

const RULES = [
  [/\bdas\b|imposto|pagar|guia/, 'O MEI paga uma guia mensal fixa (DAS) que reúne impostos e INSS. O vencimento costuma ser no dia 20 de cada mês; confirme no Portal do Empreendedor.'],
  [/cnpj|abrir|formal/, 'Vale abrir CNPJ quando você precisa emitir nota, vender para empresas ou tem faturamento regular. Use o simulador "Devo abrir CNPJ?" e, se quiser, agende uma assessoria.'],
  [/regime|simples|presumido/, 'Para pequenos negócios o Simples Nacional costuma ser o mais simples. A escolha ideal depende do faturamento e da atividade.'],
];

// Sem chave de API, responde por regras (modo de desenvolvimento).
function fallback(message) {
  const m = message.toLowerCase(), hit = RULES.find(([re]) => re.test(m));
  return { text: hit ? hit[1] : 'Boa pergunta! Com um mentor você aprofunda isso. Quer agendar uma assessoria?', model: 'regras-de-exemplo', flagged: !hit };
}

async function answer(history, message, meiLimit) {
  if (!cfg.ai.key) return fallback(message);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.ai.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.ai.model, max_tokens: cfg.ai.maxTokens, system: SYSTEM(meiLimit), messages: [...history, { role: 'user', content: message }] }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new HttpError(502, 'A IA está indisponível agora. Tente novamente.', 'AI_UNAVAILABLE'); }
  if (!res.ok) { console.error('IA retornou', res.status); throw new HttpError(502, 'A IA está indisponível agora. Tente novamente.', 'AI_UNAVAILABLE'); }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new HttpError(502, 'A IA não retornou resposta.', 'AI_UNAVAILABLE');
  return { text, model: data.model || cfg.ai.model, flagged: false };
}
module.exports = { answer };
