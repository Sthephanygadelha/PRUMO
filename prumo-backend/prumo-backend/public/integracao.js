// Liga o protótipo (script.js) ao backend. Carregado DEPOIS de script.js: troca as partes simuladas
// (login, cadastro, plano, cota da IA, pagamento, simulador) por chamadas à API.
(function () {
  const api = window.PrumoAPI, CODES = ['free', 'monthly', 'quarterly', 'annual'];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pendingPlan = null, aiConv = null, busy = false;

  // Aplica o que o servidor diz (plano e cota) sobre a interface do protótipo.
  function applyMe(m) {
    plan = m.plan.tier;
    applyPlan();
    quota = m.ai.remaining;
    cota();
  }
  function afterLogin(m) {
    mode = m.accountType === 'PF' ? 'cpf' : 'cnpj';
    enter();
    applyMe(m);
    if (pendingPlan !== null) { const i = pendingPlan; pendingPlan = null; pagar(i); }
  }
  const fail = (sel, e) => { $(sel).textContent = e.message || 'Algo deu errado.'; };

  // ---- Login / cadastro ----
  $('#entrar').onclick = async () => {
    const doc = $('#doc').value.replace(/\D/g, '');
    if (doc.length !== (mode === 'cpf' ? 11 : 14)) return fail('#lerr', { message: 'Número de ' + mode.toUpperCase() + ' incompleto.' });
    if (!$('#pw').value) return fail('#lerr', { message: 'Informe a senha.' });
    try { $('#lerr').textContent = ''; afterLogin(await api.login(doc, $('#pw').value)); } catch (e) { fail('#lerr', e); }
  };
  $('#gov').onclick = async () => { try { afterLogin(await api.govSim(mode === 'cpf' ? 'PF' : 'PJ')); } catch (e) { fail('#lerr', e); } };

  $('#cOk').onclick = async () => {
    const doc = $('#cD').value.replace(/\D/g, '');
    if (!$('#cN').value.trim()) return fail('#cErr', { message: 'Informe o nome.' });
    if (doc.length !== (cm === 'p' ? 11 : 14)) return fail('#cErr', { message: (cm === 'p' ? 'CPF' : 'CNPJ') + ' incompleto.' });
    try {
      $('#cErr').textContent = '';
      afterLogin(await api.register({ accountType: cm === 'p' ? 'PF' : 'PJ', name: $('#cN').value.trim(), document: doc, email: $('#cM').value.trim(), password: $('#cS').value, acceptTerms: $('#cTermos').checked }));
    } catch (e) { fail('#cErr', e); }
  };
  $('#cGov').onclick = async () => { try { afterLogin(await api.govSim(cm === 'p' ? 'PF' : 'PJ')); } catch (e) { fail('#cErr', e); } };

  const sair = $('#bSair').onclick;
  $('#bSair').onclick = () => { api.logout(); aiConv = null; sair(); };

  // ---- Planos e pagamento ----
  const pagarOriginal = pagar;
  pagar = function (i) {
    if (i && !api.isAuthed()) { pendingPlan = i; $('#cErr').textContent = 'Crie sua conta (ou entre) para assinar o plano ' + PN[i] + '.'; return go('cadastro'); }
    return pagarOriginal(i);
  };

  $('#pPay').onclick = async () => {
    const out = $('#pOk'), method = $('#pPix').classList.contains('on') ? 'PIX' : 'CARD';
    try {
      out.textContent = 'Processando…';
      const c = await api.checkout(CODES[selPlan], method);
      if (c.pixCopyPaste) $('#pixB input[readonly]').value = c.pixCopyPaste;
      if (c.devMode) { applyMe((await api.devPay(c.paymentId)).me); out.textContent = 'Pagamento simulado confirmado. Plano ' + PN[selPlan] + ' ativo.'; $('#pGo').hidden = false; return; }
      out.textContent = method === 'PIX' ? 'Aguardando o pagamento do Pix…' : 'O pagamento por cartão será feito em página segura do gateway (a conectar).';
      for (let n = 0; n < 200 && method === 'PIX'; n++) { // aguarda a confirmação do gateway (webhook)
        await new Promise((r) => setTimeout(r, 3000));
        if ((await api.payment(c.paymentId)).status === 'PAID') { applyMe(await api.me()); out.textContent = 'Pagamento confirmado. Plano ' + PN[selPlan] + ' ativo.'; $('#pGo').hidden = false; return; }
      }
    } catch (e) { out.textContent = e.message; }
  };

  // ---- IA: cota e resposta vêm do servidor ----
  send = async function () {
    const v = $('#iaIn').value.trim(), l = $('#iaLog');
    if (!v || busy) return;
    if (!api.isAuthed()) return add(l, 'Entre na sua conta para usar a IA.', 'bot');
    busy = true; $('#iaIn').value = ''; add(l, v, 'me');
    try {
      const r = await api.ask(v, aiConv);
      aiConv = r.conversationId; quota = r.quota.remaining; cota();
      add(l, r.reply + (r.suggestMentor ? ' (Posso indicar um mentor na aba Assessorias.)' : ''), 'bot');
    } catch (e) {
      if (e.code === 'AI_QUOTA_EXCEEDED') { quota = 0; cota(); }
      add(l, e.message, 'bot');
    } finally { busy = false; }
  };
  $('#iaGo').onclick = send;

  // ---- Simulador ----
  $('#sGo').onclick = async () => {
    try {
      const r = await api.simulate({ monthlyRevenue: +$('#sF').value || 0, needsInvoice: $('#sN').value === '1', sellsToCompanies: $('#sE').value === '1', employees: +$('#sW').value });
      $('#sR').innerHTML = '<h4>' + esc(r.title) + '</h4><p>' + esc(r.text) + '</p><p class="mut">' + esc(r.disclaimer) + '</p><button class="p" onclick="document.querySelector(\'[data-t=assess]\').click()">Falar com um mentor</button>';
    } catch (e) { $('#sR').textContent = e.message; }
  };

  // ---- Restaura a sessão ao recarregar a página (cookie de refresh) ----
  api.restore().then((m) => { if (m) afterLogin(m); }).catch(() => {});
})();
