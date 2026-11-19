const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const R=document.documentElement;let fs=100,role='c',user=null,hist=[],cur='landing',fa='Todas',ft='Todos',sel='',pi=0,mine=null,aa=[],at='Avulso';
const st={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Acessibilidade
function pref(){R.style.fontSize=fs+'%';st.set('fs',fs)}
fs=parseInt(st.get('fs'))||100;pref();
if(st.get('hc')==='1')R.classList.add('hc');
if(st.get('theme'))R.setAttribute('data-theme',st.get('theme'));
$('#fMais').onclick=()=>{fs=Math.min(150,fs+10);pref()};
$('#fMenos').onclick=()=>{fs=Math.max(80,fs-10);pref()};
$('#fReset').onclick=()=>{fs=100;pref()};
$('#hc').onclick=()=>{st.set('hc',R.classList.toggle('hc')?'1':'0')};
$('#tema').onclick=()=>{const d=R.getAttribute('data-theme')==='dark'||(!R.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme:dark)').matches);const t=d?'light':'dark';R.setAttribute('data-theme',t);st.set('theme',t)};
$('#bAcess').onclick=()=>{$('#acess').hidden=!$('#acess').hidden};

// Dados de exemplo (fictícios). Serviço: [nome, tipo, valor, descrição]
const AR=['Fiscal','Tributário','Econômico'];
const AD={Fiscal:'Notas, obrigações acessórias, escrituração e conformidade.',Tributário:'Escolha de regime, planejamento tributário e recuperação de créditos.',Econômico:'Viabilidade, fluxo de caixa, precificação e captação.'};
const PL=[['Básico','R$ 0','',['Perfil no catálogo','Até 3 serviços','5 pedidos de contato por mês']],
['Destaque','R$ 149','/mês',['Selo de destaque','Topo das buscas','Serviços e pedidos ilimitados']],
['Premium','R$ 349','/mês',['Tudo do Destaque','Banner na página inicial','Relatório dos pedidos recebidos']]];
const P=[
{n:'Contábil Horizonte',k:'Escritório contábil',a:['Fiscal','Tributário'],s:'Contabilidade digital para startups e empresas em crescimento.',v:[['Apoio fiscal mensal','Avulso','R$ 450/mês','Emissão de notas, obrigações e conciliação.'],['Pacote Startup Fiscal + Tributário','Pacote','R$ 1.200/mês','Rotina fiscal completa e planejamento do regime tributário.']]},
{n:'Lastro Tributário',k:'Consultoria tributária',a:['Tributário'],s:'Planejamento tributário e recuperação de tributos pagos a maior.',v:[['Diagnóstico tributário para gestor','Avulso','R$ 600','Sessão individual de 2h com análise do regime.'],['Recuperação de créditos','Avulso','Sob consulta','Levantamento de créditos tributários da empresa.']]},
{n:'Vértice Econômica',k:'Consultoria econômico-financeira',a:['Econômico'],s:'Modelagem financeira e preparação para captação de investimento.',v:[['Mentoria de caixa para gestor','Avulso','R$ 350/hora','Fluxo de caixa e precificação.'],['Modelagem e valuation','Avulso','R$ 2.500','Projeções e valuation para rodadas de investimento.']]},
{n:'Três Pilares Gestão',k:'Gestão integrada',a:['Fiscal','Tributário','Econômico'],s:'Um único contrato para os três temas da sua empresa.',v:[['Pacote Empresa Essencial','Pacote','R$ 2.200/mês','Rotina fiscal, planejamento tributário e painel financeiro mensal.'],['Pacote Empresa Completo','Pacote','R$ 3.900/mês','Fiscal, tributário e econômico, com reuniões quinzenais.']]},
{n:'Norte Fiscal',k:'Contabilidade e BPO',a:['Fiscal','Econômico'],s:'Abertura de empresas e rotina financeira terceirizada.',v:[['Abertura e regularização de CNPJ','Avulso','R$ 800','Abertura, enquadramento e licenças.'],['BPO financeiro','Avulso','R$ 1.100/mês','Contas a pagar e a receber.']]}];
const LD=[];

// Navegação
const RN={catalogo:()=>cat(),painel:()=>pnl(),anunciar:()=>drawA()};
function go(id,back){if(!back&&cur!==id)hist.push(cur);cur=id;$$('.screen').forEach(e=>e.hidden=e.id!==id);$('#bVolta').hidden=!hist.length;window.scrollTo(0,0);if(RN[id])RN[id]()}
function volta(){const p=hist.pop();if(p)go(p,true)}
$('#bVolta').onclick=volta;$('.logo').onclick=()=>{hist=[];go('landing',true)};
$('#bCat').onclick=()=>go('catalogo');$('#bAnun').onclick=()=>go(mine!==null?'painel':'anunciar');$('#bEnt').onclick=()=>go('login');
function sai(){user=null;$('#bSair').hidden=true;$('#bEnt').hidden=false;hist=[];go('landing',true)}
$('#bSair').onclick=sai;

// Landing
$('#gAreas').innerHTML=AR.map(a=>`<div class="card"><b>${a}</b><p class="mut">${AD[a]}</p><button onclick="fa='${a}';ft='Todos';go('catalogo')">Ver prestadoras</button></div>`).join('');
$('#gPl').innerHTML=PL.map((p,i)=>`<div class="card"><b>${p[0]}</b><div class="price">${p[1]}<span class="mut">${p[2]}</span></div><ul>${p[3].map(x=>'<li>'+x+'</li>').join('')}</ul><button class="${i?'p':''}" onclick="go('anunciar')">${i?'Quero este plano':'Começar grátis'}</button></div>`).join('');

// Catálogo
function chips(box,arr,val,fn){box.innerHTML=arr.map(x=>`<button class="${x===val?'on':''}" onclick="${fn}('${x}')">${x}</button>`).join('')}
function setA(x){fa=x;cat()}function setT(x){ft=x;cat()}
const tags=p=>p.a.map(a=>`<span class="tag">${a}</span>`).join(' ');
function cat(){chips($('#fA'),['Todas',...AR],fa,'setA');chips($('#fT'),['Todos','Avulso','Pacote'],ft,'setT');
const l=P.map((p,i)=>[p,i]).filter(([p])=>(fa==='Todas'||p.a.includes(fa))&&(ft==='Todos'||p.v.some(s=>s[1]===ft)));
$('#cN').textContent=l.length+' prestadora(s). Perfis de exemplo, fictícios.';
$('#gC').innerHTML=l.map(([p,i])=>`<div class="card"><b>${p.n}</b> ${p.mine?'<span class="tag">Seu perfil</span>':''}<div class="mut">${p.k}</div><p>${tags(p)}</p><p class="mut">${p.v.filter(s=>s[1]==='Avulso').length} avulso(s) · ${p.v.filter(s=>s[1]==='Pacote').length} pacote(s)</p><button class="p" onclick="perfil(${i})">Ver perfil</button></div>`).join('')||'<p>Nenhuma prestadora com esses filtros.</p>'}

// Perfil e pedido de contato
function perfil(i){pi=i;sel='';go('perfil');const p=P[i];
const bloco=(t,tit)=>{const l=p.v.filter(s=>s[1]===t);return l.length?`<h3>${tit}</h3>`+l.map(s=>`<div class="card" style="margin:.4rem 0"><div class="row" style="justify-content:space-between"><b>${s[0]}</b><span class="tag">${s[2]}</span></div><div class="mut">${s[3]}</div><p><button onclick="pedir(${p.v.indexOf(s)})">Pedir este serviço</button></p></div>`).join(''):''};
$('#pf').innerHTML=`<h2>${p.n}</h2><div class="mut">${p.k}</div><p>${p.s}</p><p>${tags(p)}</p>${bloco('Avulso','Serviços individuais (para gestores e profissionais)')}${bloco('Pacote','Pacotes para a empresa')}`;
$('#pfS').textContent='Interesse: geral';$('#qMsg').textContent='';$('#qErr').textContent=''}
function pedir(j){sel=P[pi].v[j][0];$('#pfS').textContent='Interesse: '+sel;$('#qN').scrollIntoView({behavior:'smooth'});$('#qN').focus()}
$('#qOk').onclick=()=>{const e=$('#qErr');
if(!$('#qN').value.trim()||!$('#qE').value.trim())return e.textContent='Informe seu nome e a empresa.';
if(!/^\S+@\S+\.\S+$/.test($('#qM').value))return e.textContent='E-mail inválido.';
e.textContent='';LD.push({to:pi,n:esc($('#qN').value),e:esc($('#qE').value),m:esc($('#qM').value),i:esc(sel||'geral'),t:esc($('#qT').value)});
$('#qMsg').textContent='Pedido enviado para '+P[pi].n+' (simulado). A prestadora responderá pelo e-mail informado.';['#qN','#qE','#qM','#qT'].forEach(s=>$(s).value='')};

// Anunciar (cadastro da prestadora)
function tgA(x){aa=aa.includes(x)?aa.filter(y=>y!==x):[...aa,x];drawA()}
function setAT(x){at=x;drawA()}
function drawA(){$('#aA').innerHTML=AR.map(x=>`<button class="${aa.includes(x)?'on':''}" onclick="tgA('${x}')">${x}</button>`).join('');chips($('#aT'),['Avulso','Pacote'],at,'setAT')}
$('#aC').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,14)};
$('#aOk').onclick=()=>{const e=$('#aErr');
if(!$('#aN').value.trim())return e.textContent='Informe o nome da empresa.';
if($('#aC').value.length!==14)return e.textContent='CNPJ incompleto.';
if(!/^\S+@\S+\.\S+$/.test($('#aM').value))return e.textContent='E-mail inválido.';
if(!aa.length)return e.textContent='Escolha ao menos uma área.';
if(!$('#aS').value.trim())return e.textContent='Cadastre ao menos um serviço.';
e.textContent='';const pr=$('#aP').value;mine=P.length;
P.push({n:esc($('#aN').value.trim()),k:'Prestadora de serviços',a:[...aa],s:esc($('#aD').value.trim()||'Sem descrição.'),mine:1,v:[[esc($('#aS').value.trim()),at,pr?'a partir de R$ '+esc(pr):'Sob consulta','Serviço cadastrado pela prestadora.']]});
user={r:'p'};$('#bSair').hidden=false;$('#bEnt').hidden=true;hist=[];go('painel',true)};

// Painel da prestadora
function pnl(){if(mine===null)return go('anunciar',true);const p=P[mine],l=LD.filter(x=>x.to===mine);
$('#pnl').innerHTML=`<h2>${p.n}</h2><p class="mut">Seu perfil já aparece no catálogo.</p><p>${tags(p)}</p><p><b>${p.v.length}</b> serviço(s) · <b>${l.length}</b> pedido(s) de contato</p><button onclick="perfil(${mine})">Ver como o cliente vê</button>`;
$('#pnlL').innerHTML=l.map(x=>`<div class="card"><b>${x.n}</b> · ${x.e}<div class="mut">${x.m}</div><p>Interesse: ${x.i}</p><p>${x.t}</p></div>`).join('')||'<p class="mut">Nenhum pedido ainda.</p>'}
$('#pnlSim').onclick=()=>{if(mine===null)return;LD.push({to:mine,n:'Camila Rocha',e:'Startup Alfa (exemplo)',m:'camila@exemplo.com',i:'geral',t:'Gostaríamos de um orçamento para o pacote da empresa.'});pnl()};

// Entrar
function setR(r){role=r;$('#rC').classList.toggle('on',r==='c');$('#rP').classList.toggle('on',r==='p')}
$('#rC').onclick=()=>setR('c');$('#rP').onclick=()=>setR('p');
function enter(){user={r:role};$('#bSair').hidden=false;$('#bEnt').hidden=true;hist=[];role==='p'?go(mine===null?'anunciar':'painel',true):go('catalogo',true)}
$('#entrar').onclick=()=>{const n=$('#doc').value.replace(/\D/g,'').length;
if(n!==11&&n!==14)return $('#lerr').textContent='Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).';
if($('#pw').value.length<4)return $('#lerr').textContent='Senha muito curta.';
$('#lerr').textContent='';enter()};
$('#gov').onclick=enter;
