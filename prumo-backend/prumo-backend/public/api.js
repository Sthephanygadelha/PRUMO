// Cliente da API do Prumo. O access token fica só em memória; o refresh token vai em cookie httpOnly.
window.PrumoAPI = (function () {
  const BASE = window.PRUMO_API_BASE || '/api';
  let token = null, refreshing = null;

  async function raw(path, opts = {}) {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(token && !opts.noAuth ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { res, data };
  }

  async function refresh() {
    refreshing = refreshing || raw('/auth/refresh', { method: 'POST', noAuth: true }).then(({ res, data }) => {
      refreshing = null;
      if (!res.ok) { token = null; return null; }
      token = data.accessToken; return data;
    });
    return refreshing;
  }

  async function req(path, opts) {
    let { res, data } = await raw(path, opts);
    if (res.status === 401 && token && !path.startsWith('/auth/') && await refresh()) ({ res, data } = await raw(path, opts));
    if (!res.ok) { const e = new Error((data && data.error) || 'Erro de comunicação com o servidor.'); e.status = res.status; e.code = data && data.code; e.data = data; throw e; }
    return data;
  }

  const take = (d) => { token = d.accessToken; return d.me; };
  return {
    isAuthed: () => !!token,
    async login(document, password) { return take(await req('/auth/login', { method: 'POST', body: { document, password } })); },
    async register(body) { return take(await req('/auth/register', { method: 'POST', body })); },
    async govSim(accountType) { return take(await req('/auth/govbr/simulado', { method: 'POST', body: { accountType } })); },
    async restore() { const d = await refresh(); return d ? d.me : null; },
    async logout() { try { await req('/auth/logout', { method: 'POST' }); } catch (e) {} token = null; },
    me: () => req('/me'),
    plans: () => req('/plans'),
    ask: (message, conversationId) => req('/ai/chat', { method: 'POST', body: { message, conversationId } }),
    checkout: (planCode, method) => req('/checkout', { method: 'POST', body: { planCode, method } }),
    payment: (id) => req('/payments/' + id),
    devPay: (id) => req('/dev/payments/' + id + '/pay', { method: 'POST' }),
    simulate: (b) => req('/simulator/cnpj', { method: 'POST', body: b }),
    // demais rotas (cursos, mentores, agenda, notícias): use api.get/post
    get: (p) => req(p),
    post: (p, body) => req(p, { method: 'POST', body }),
    put: (p, body) => req(p, { method: 'PUT', body }),
  };
})();
