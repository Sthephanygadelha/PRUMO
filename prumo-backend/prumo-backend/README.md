

## Rodar

```bash
node -v                # precisa ser >= 22.5
npm start              # http://localhost:3000  (front + API; cria data/prumo.db e os dados de exemplo)
npm test               # 15 testes de integração da API
```

Abra `http://localhost:3000`. O front em `public/` já fala com a API (login, cadastro, plano, cota da IA, pagamento simulado, simulador).

Para a IA responder de verdade: `ANTHROPIC_API_KEY=... npm start` (modelo em `AI_MODEL`). Sem a chave, responde por regras de exemplo.
Variáveis: veja `.env.example` (carregue com `node --env-file=.env src/server.js`).

## Estrutura

```
src/server.js        inicia o servidor
src/app.js           monta rotas + domínio
src/config.js        variáveis de ambiente (segredos obrigatórios em produção)
src/db.js            SQLite + schema
src/seed.js          planos, cursos, mentores, notícias e parâmetros de exemplo
src/domain.js        plano vigente, cota da IA, horários livres, confirmação de pagamento
src/lib/security.js  scrypt, JWT HS256, AES-256-GCM, HMAC, validação de CPF/CNPJ
src/lib/http.js      roteador, rate limit, cookies, arquivos estáticos, cabeçalhos de segurança
src/routes/*.js      auth, catalog (planos/cursos/notícias/simulador), mentors (agenda/chat), billing, ai
src/services/ai.js   chamada à API da Anthropic (ou regras de exemplo)
public/              front (index.html, style.css, script.js) + api.js + integracao.js
test/api.test.js     testes
```

## Rotas principais (prefixo `/api`)

| Rota | O que faz |
|---|---|
| `POST /auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | Conta PF/PJ, sessão (access token 15 min + refresh em cookie httpOnly com rotação) |
| `GET /me` · `DELETE /me` | Perfil, plano e cota; exclusão/anonimização (LGPD) |
| `GET /plans` | Planos |
| `GET /courses` · `GET /courses/:id` | Cursos com bloqueio por plano, progresso, materiais, teste (sem gabarito) |
| `POST /courses/:id/lessons/:lid/progress` · `PUT /courses/:id/note` · `POST /courses/:id/quiz/attempt` | Progresso, memorando, correção do teste no servidor |
| `GET/POST /courses/:id/messages` | Chat da turma |
| `GET /mentors` · `GET /mentors/:id/slots` | Mentores (preço já com desconto do plano) e horários livres |
| `POST /appointments` · `GET /appointments` · `POST /appointments/:id/cancel` | Agendamento sem conflito |
| `POST /conversations` · `GET/POST /conversations/:id/messages` | Chat aluno ↔ mentor |
| `POST /ai/chat` · `GET /ai/quota` · `GET /ai/conversations[/:id]` | IA com cota diária aplicada no servidor |
| `GET /news` | Notícias e resumo (semanal no gratuito, diário nos pagos) |
| `POST /simulator/cnpj` | "Devo abrir CNPJ?" com limites vindos de `tax_parameters` |
| `POST /checkout` · `GET /payments/:id` · `POST /webhooks/payments` | Cobrança e confirmação (webhook com assinatura HMAC) |

Só dev (`DEV_TOOLS`, ligado fora de produção): `POST /dev/payments/:id/pay`, `POST /auth/govbr/simulado`.

## O que ainda é simulado

- **gov.br**: `GET /auth/govbr` responde 501. Exige credenciamento (OpenID Connect).
- **Pagamento**: nenhum gateway conectado. `checkout` gera a cobrança e o `webhook` já valida assinatura; falta trocar o código Pix de exemplo e o cartão (tokenizado no navegador pelo SDK do gateway; este servidor nunca recebe número de cartão) pela API do gateway escolhido, com split para os mentores.
- **Vídeo das aulas e chamadas**: `video_room` é um identificador; integrar Daily, LiveKit ou Jitsi.
- **Notícias**: dados de exemplo; falta o job que coleta fontes e gera resumos com IA.
- **Cursos, mentores, agenda e chat no front**: a API está pronta, mas `script.js` ainda usa os arrays locais dessas telas. Próximo passo: trocá-los por `PrumoAPI.get('/courses')` etc.
- O botão "Experimentar este plano" do front só muda a tela localmente; o servidor continua aplicando o plano real em todas as rotas.
- Chat por polling (`?since=`); WebSocket fica para depois.

## Segurança já aplicada

Senhas com scrypt; CPF/CNPJ só como HMAC (busca) + AES-GCM (exibição) + últimos 4 dígitos; JWT curto + refresh rotativo com detecção de reuso; rate limit em login/cadastro/IA/mensagens; cota da IA atômica; gabarito do teste nunca vai ao cliente; webhook assinado; índice único impede dois agendamentos no mesmo horário; consultas parametrizadas; cabeçalhos de segurança (CSP com `unsafe-inline` por causa do `onclick` do front atual).

## Antes de produção

1. Defina `JWT_SECRET`, `DOC_HMAC_KEY`, `DOC_ENC_KEY`, `PAYMENT_WEBHOOK_SECRET` (ver `.env.example`) e sirva só por HTTPS.
2. O rate limit é em memória (1 instância). Com várias, use Redis.
3. SQLite serve para validar e para uma instância. Para escalar, migrar para PostgreSQL seguindo o `schema.prisma` entregue antes (este MVP é uma versão simplificada dele).
4. Textos reais de Termos e Política de Privacidade (o aceite hoje grava a versão `v0`); base legal LGPD para dados financeiros e para o envio de perguntas à IA.
5. Conferir na legislação os parâmetros em `tax_parameters` (limite do MEI etc.) e revisar o prompt da IA com um contador.
6. Fuso fixo UTC-3 para a agenda (Brasil sem horário de verão desde 2019).
