const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const R=document.documentElement;let fs=100,mode='cpf',user=null,quota=5;
const st={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
function pref(){R.style.fontSize=fs+'%';st.set('fs',fs);}
fs=parseInt(st.get('fs'))||100;pref();
if(st.get('hc')==='1')R.classList.add('hc');
if(st.get('theme'))R.setAttribute('data-theme',st.get('theme'));
$('#fMais').onclick=()=>{fs=Math.min(150,fs+10);pref()};
$('#fMenos').onclick=()=>{fs=Math.max(80,fs-10);pref()};
$('#fReset').onclick=()=>{fs=100;pref()};
$('#hc').onclick=()=>{st.set('hc',R.classList.toggle('hc')?'1':'0')};
$('#tema').onclick=()=>{const d=R.getAttribute('data-theme')==='dark'||(!R.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme:dark)').matches);const t=d?'light':'dark';R.setAttribute('data-theme',t);st.set('theme',t)};
$('#bAcess').onclick=()=>{$('#acess').hidden=!$('#acess').hidden};

$('#bPlanos').onclick=()=>go('planos');
$('#bSair').onclick=()=>{user=null;$('#bSair').hidden=true;hist=[];plan=0;go('landing',true);applyPlan()};

// Login
function setMode(m){mode=m;$('#mCpf').classList.toggle('on',m==='cpf');$('#mCnpj').classList.toggle('on',m==='cnpj');
$('#docL').textContent=m.toUpperCase();$('#doc').placeholder=m==='cpf'?'000.000.000-00':'00.000.000/0000-00';$('#doc').value=''}
$('#mCpf').onclick=()=>setMode('cpf');$('#mCnpj').onclick=()=>setMode('cnpj');
$('#doc').oninput=e=>{let v=e.target.value.replace(/\D/g,'').slice(0,mode==='cpf'?11:14);
v=mode==='cpf'?v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
:v.replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2');e.target.value=v};
function enter(){user={type:mode};$('#pfBanner').hidden=mode!=='cpf';$('#bSair').hidden=false;hist=[];go('app',true);applyPlan()}
$('#entrar').onclick=()=>{const n=$('#doc').value.replace(/\D/g,'').length;
if(n!==(mode==='cpf'?11:14))return $('#lerr').textContent='Número de '+mode.toUpperCase()+' incompleto.';
if($('#pw').value.length<4)return $('#lerr').textContent='Senha muito curta.';$('#lerr').textContent='';enter()};
$('#gov').onclick=()=>enter();

// Planos
const planos=[['Gratuito','R$ 0','',['Cursos introdutórios','IA com limite diário','Chat básico']],
['Mensal','R$ 29,90','/mês',['Todos os cursos','IA ampliada','Descontos em assessorias']],
['Trimestral','R$ 79,90','/trim.',['Tudo do mensal','Mentoria em grupo','Economia de 11%']],
['Anual','R$ 279','/ano',['Tudo do trimestral','Análise do negócio por mentor','Economia de 22%']]];
const planHTML=planos.map((p,i)=>`<div class="card"><b>${p[0]}</b><div class="price">${p[1]}<span class="mut">${p[2]}</span></div><ul>${p[3].map(x=>'<li>'+x+'</li>').join('')}</ul><button class="p" onclick="pagar(${i})">${i?'Escolher':'Começar grátis'}</button> <button onclick="prev(${i})">Ver como fica</button></div>`).join('');$('#gPlanos').innerHTML=planHTML;$('#gPlanos2').innerHTML=planHTML;

// Abas
$$('.tabs button').forEach(b=>b.onclick=()=>{$$('.tabs button').forEach(x=>x.classList.toggle('on',x===b));$$('.tab').forEach(t=>t.hidden=t.id!=='t-'+b.dataset.t)});

// Cursos
const cursos=[
{t:'Tributação para MEI',p:'Prof. Marta Lins',l:['O que é o DAS','Limite de faturamento','Declaração anual (DASN)'],q:['Qual o limite anual de faturamento do MEI?',['R$ 81 mil','R$ 500 mil','Não há limite'],0]},
{t:'Regimes tributários',p:'Prof. Rafael Souza',l:['Simples Nacional','Lucro Presumido','Quando mudar de regime'],q:['Qual regime costuma ser mais simples para pequenos negócios?',['Lucro Real','Simples Nacional','Nenhum'],1]},
{t:'Fluxo de caixa básico',p:'Profa. Ana Torres',l:['Entradas e saídas','Separar PF e PJ','Planejar o mês'],q:['Por que separar finanças pessoais e do negócio?',['Para pagar mais imposto','Para ter clareza do lucro real','Não faz diferença'],1]}];
const done={};

function abrir(i){const c=cursos[i];done[i]=done[i]||{};const d=$('#cDet');d.hidden=false;
d.innerHTML=`<h3>${c.t}</h3><p class="mut">${c.p}</p><div class="row"><button class="p" onclick="sala(${i})">Entrar na sala de aula</button><button onclick="agendar('${c.p}')">Agendar consulta com o professor</button></div>${c.l.map((x,j)=>`<label style="font-weight:400"><input type="checkbox" style="width:auto" ${done[i][j]?'checked':''} onchange="prog(${i},${j},this.checked)"> Aula ${j+1}: ${x}</label>`).join('')}
<label>Memorando (suas anotações)</label><textarea rows="3" placeholder="Anote aqui"></textarea>
<label>Teste rápido</label><p>${c.q[0]}</p><div class="row">${c.q[1].map((o,k)=>`<button onclick="resp(this,${k===c.q[2]})">${o}</button>`).join('')}</div><p id="qr"></p>`;d.scrollIntoView({behavior:'smooth'})}
function prog(i,j,v){done[i][j]=v;const n=Object.values(done[i]).filter(Boolean).length;$('#pb'+i).style.width=n/3*100+'%'}
function resp(b,ok){$('#qr').textContent=ok?'Correto!':'Não foi dessa vez. Revise a aula.';$('#qr').className=ok?'':'err'}

// Assessorias
const pros=[['Carla Mendes','Contadora · Tributário MEI','R$ 60 / 30 min'],['Bruno Alves','Consultor · Abertura de CNPJ','R$ 80 / 30 min'],['Joana Prado','Economista · Visão de mercado','R$ 90 / 30 min']];
$('#gPros').innerHTML=pros.map((p,i)=>`<div class="card"><b>${p[0]}</b><div class="mut">${p[1]}</div><div class="tag">${p[2]}</div><p><button class="p" onclick="pro(${i})">Agendar e conversar</button></p></div>`).join('');
function pro(i){const d=$('#pDet');d.hidden=false;d.innerHTML=`<h3>${pros[i][0]}</h3><label>Horários disponíveis</label><div class="row">${['Qui 10:00','Sex 14:30','Seg 09:00'].map(h=>`<button onclick="ag('${h}',${i})">${h}</button>`).join('')}</div><p id="agm"></p>
<div class="chat" id="pLog"></div><div class="row"><input id="pIn" placeholder="Mensagem" style="flex:1"><button class="p" onclick="pm()">Enviar</button></div>`;d.scrollIntoView({behavior:'smooth'})}
function ag(h,i){$('#agm').innerHTML='Chamada agendada com '+pros[i][0]+' · '+h+' (simulado). <button class="p" onclick="chamada(\''+pros[i][0]+'\')">Entrar na chamada</button>'}
function add(box,t,c){const m=document.createElement('div');m.className='m '+c;m.textContent=t;box.appendChild(m);box.scrollTop=box.scrollHeight}
function pm(){const v=$('#pIn').value.trim();if(!v)return;add($('#pLog'),v,'me');$('#pIn').value='';setTimeout(()=>add($('#pLog'),'Recebi sua mensagem! Respondo em breve.','bot'),600)}

// IA
const topics=['Como funciona o DAS?','Quando abrir CNPJ?','Qual regime escolher?'];
$('#chips').innerHTML=topics.map(t=>`<button onclick="ask('${t}')">${t}</button>`).join('');
const base=[[/das|imposto|pagar/,'O MEI paga uma guia mensal fixa (DAS) que reúne impostos e INSS. Pague até o dia 20 de cada mês.'],[/cnpj|abrir|formal/,'Vale abrir CNPJ quando você precisa emitir nota, vender para empresas ou tem faturamento regular. Posso explicar o passo a passo.'],[/regime|simples|presumido/,'Para pequenos negócios o Simples Nacional costuma ser o mais simples. A escolha ideal depende do faturamento e da atividade.']];
function cota(){$('#quota').textContent=quota>0?'Perguntas gratuitas hoje: '+quota:'Limite gratuito atingido. Veja os planos para ampliar o acesso à IA.'}cota();
function ask(q){$('#iaIn').value=q;send()}
function send(){const v=$('#iaIn').value.trim();if(!v)return;if(quota<=0)return cota();quota--;cota();const l=$('#iaLog');add(l,v,'me');$('#iaIn').value='';
const r=base.find(b=>b[0].test(v.toLowerCase()));setTimeout(()=>add(l,r?r[1]:'Boa pergunta! Em um mentor você aprofunda isso. Quer agendar uma assessoria?','bot'),600)}
$('#iaGo').onclick=send;$('#iaIn').onkeydown=e=>{if(e.key==='Enter')send()};

// Cadastro
let cm='p';
function setC(m){cm=m;$('#cP').classList.toggle('on',m==='p');$('#cE').classList.toggle('on',m==='e');
$('#cNL').textContent=m==='p'?'Nome completo':'Razão social ou nome fantasia';$('#cDL').textContent=m==='p'?'CPF':'CNPJ';$('#cD').value=''}
$('#cP').onclick=()=>setC('p');$('#cE').onclick=()=>setC('e');
$('#cD').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,cm==='p'?11:14)};
$('#cOk').onclick=()=>{const n=$('#cD').value.length;
if(!$('#cN').value.trim())return $('#cErr').textContent='Informe o nome.';
if(n!==(cm==='p'?11:14))return $('#cErr').textContent=(cm==='p'?'CPF':'CNPJ')+' incompleto.';
if(!/^\S+@\S+\.\S+$/.test($('#cM').value))return $('#cErr').textContent='E-mail inválido.';
if($('#cS').value.length<4)return $('#cErr').textContent='Senha muito curta.';
$('#cErr').textContent='';mode=cm==='p'?'cpf':'cnpj';enter()};
$('#cGov').onclick=()=>{mode=cm==='p'?'cpf':'cnpj';enter()};

// Pagamento
function setP(m){$('#pPix').classList.toggle('on',m==='pix');$('#pCar').classList.toggle('on',m==='car');$('#pixB').hidden=m!=='pix';$('#carB').hidden=m==='pix'}
$('#pPix').onclick=()=>setP('pix');$('#pCar').onclick=()=>setP('car');

// Simulador
$('#sGo').onclick=()=>{const f=+$('#sF').value||0,n=$('#sN').value==='1',e=$('#sE').value==='1',w=+$('#sW').value;let t,c;
if(f*12>81000||w>1){t='Acima do perfil de MEI';c='Seu negócio pode precisar de outro enquadramento, como ME no Simples Nacional. Converse com um mentor.'}
else if(n||e||f>=2000){t='Vale considerar abrir um MEI';c='Há sinais de que formalizar pode trazer vantagens: nota fiscal, vendas para empresas e INSS.'}
else{t='Ainda pode seguir como pessoa física';c='Acompanhe o crescimento. Quando vender com regularidade ou precisar de nota, reavalie.'}
$('#sR').innerHTML='<h4>'+t+'</h4><p>'+c+'</p><p class="mut">Critérios simplificados de exemplo. Limite do MEI: R$ 81 mil por ano. Não substitui um contador.</p><button class="p" onclick="document.querySelector(\'[data-t=assess]\').click()">Falar com um mentor</button>'};

// ===== Navegação, planos, sala de aula, agenda, chamada e notícias =====
let hist=[],cur='landing',plan=0,selPlan=1,nf='Todas',sc=0,mic=true,cam=true,ag2={d:null,h:null,p:''};
const PN=['Gratuito','Mensal','Trimestral','Anual'],IAQ=[5,30,60,100],CAB=[1,3,3,3],DESC=[0,10,15,25];
function go(id,back){if(!back&&cur!==id)hist.push(cur);cur=id;$$('.screen').forEach(e=>e.hidden=e.id!==id);$('#bVolta').hidden=!hist.length;window.scrollTo(0,0)}
function volta(){const p=hist.pop();if(p)go(p,true)}
function home(){hist=[];go(user?'app':'landing',true)}
$('#bVolta').onclick=volta;$('.logo').onclick=home;

function pagar(i){selPlan=i;if(!i){plan=0;applyPlan();return go('cadastro')}$('#pT').textContent='Plano '+PN[i]+' · '+planos[i][1]+planos[i][2];$('#pOk').textContent='';$('#pGo').hidden=true;go('pag')}
$('#pPay').onclick=()=>{plan=selPlan;applyPlan();$('#pOk').textContent='Pagamento simulado confirmado. Plano '+PN[selPlan]+' ativo no protótipo.';$('#pGo').hidden=false};
$('#pGo').onclick=()=>{hist=[];go(user?'app':'cadastro',true)};

function prev(i){go('prev');renderPrev(i)}
function renderPrev(i){
$('#pvT').innerHTML=PN.map((n,k)=>`<button class="${k===i?'on':''}" onclick="renderPrev(${k})">${n}</button>`).join('');
const L=(ok,t)=>`<div class="card" style="margin:0">${ok?'✔':'🔒'} ${t}</div>`;
$('#pvB').innerHTML=`<div class="card" style="border:2px solid var(--pri)"><div class="row" style="justify-content:space-between"><b>Prumo · Plano ${PN[i]}</b><span class="tag">${planos[i][1]}${planos[i][2]}</span></div>
<div class="grid" style="margin-top:.6rem">${L(1,'Cursos liberados: '+CAB[i]+' de 3')}${L(1,'IA: '+IAQ[i]+' perguntas por dia')}${L(1,'Notícias '+(i?'diárias':'semanais')+' com resumo de IA')}${L(i>0,'Desconto em assessorias: '+DESC[i]+'%')}${L(i>1,'Mentoria em grupo')}${L(i>2,'Análise do negócio por mentor')}</div></div>
<p><button class="p" onclick="trial(${i})">Experimentar este plano</button> <button onclick="pagar(${i})">${i?'Assinar':'Criar conta grátis'}</button></p>`}
function trial(i){plan=i;user=user||{type:'cpf'};$('#bSair').hidden=false;hist=[];go('app',true);applyPlan()}

function renderCursos(){$('#gCursos').innerHTML=cursos.map((c,i)=>i<CAB[plan]?`<div class="card"><b>${c.t}</b><div class="mut">${c.p}</div><div class="bar" style="margin:.6rem 0"><i id="pb${i}" style="width:0"></i></div><button class="p" onclick="abrir(${i})">Abrir</button></div>`:`<div class="card"><b>🔒 ${c.t}</b><div class="mut">${c.p}</div><p class="mut">Disponível no plano Mensal ou superior.</p><button onclick="prev(1)">Ver plano Mensal</button></div>`).join('');$('#cDet').hidden=true}

function sala(i){sc=i;go('aula');$('#aT').textContent=cursos[i].t;$('#aP').textContent=cursos[i].p+' · Sala de aula (simulada)';$('#vid').textContent='▶ Reproduzir: '+cursos[i].l[0];aTab('aulas')}
function aTab(t){$$('[data-a]').forEach(b=>b.classList.toggle('on',b.dataset.a===t));const c=cursos[sc],B=$('#aBody');
if(t==='aulas')B.innerHTML=c.l.map((x,j)=>`<div class="card" style="cursor:pointer;margin:.3rem 0" onclick="document.getElementById('vid').textContent='▶ Tocando: ${x}'">Aula ${j+1} · ${x}</div>`).join('');
else if(t==='mat')B.innerHTML=['📄 Apostila da aula (exemplo)','📄 Memorando: resumo em 1 página (exemplo)','📝 Teste de fixação (exemplo)'].map(x=>`<div class="card" style="margin:.3rem 0">${x}</div>`).join('');
else B.innerHTML='<div class="chat" id="tLog"><div class="m bot">Marcos (aluno): alguém já fez o teste?</div></div><div class="row"><input id="tIn" placeholder="Mensagem para a turma" style="flex:1"><button class="p" onclick="tm()">Enviar</button></div>'}
function tm(){const v=$('#tIn').value.trim();if(!v)return;add($('#tLog'),v,'me');$('#tIn').value='';setTimeout(()=>add($('#tLog'),'Professor: boa pergunta, vejo na próxima aula!','bot'),600)}
$$('[data-a]').forEach(b=>b.onclick=()=>aTab(b.dataset.a));
$('#vid').onclick=()=>{$('#vid').textContent='▶ Reproduzindo (simulado)'};

function agendar(pr){ag2={d:null,h:null,p:pr};go('agenda');$('#gP').textContent='Com '+pr;$('#gM').innerHTML='';$('#gA').value='';
const ds=[];for(let k=1;k<=5;k++){const d=new Date();d.setDate(d.getDate()+k);ds.push(d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}))}
$('#gD').innerHTML=ds.map(x=>`<button onclick="selA('d','${x}',this)">${x}</button>`).join('');
$('#gH').innerHTML=['09:00','11:00','14:30','16:00'].map(x=>`<button onclick="selA('h','${x}',this)">${x}</button>`).join('')}
function selA(k,v,b){ag2[k]=v;[...b.parentNode.children].forEach(x=>x.classList.toggle('on',x===b))}
$('#gOk').onclick=()=>{if(!ag2.d||!ag2.h)return $('#gM').innerHTML='<span class="err">Escolha o dia e o horário.</span>';
$('#gM').innerHTML='Consulta confirmada com '+ag2.p+' · '+ag2.d+' às '+ag2.h+' (simulado). <button class="p" onclick="chamada(ag2.p)">Entrar na chamada</button>'};

function chamada(n){go('call');$('#cT').textContent='Chamada com '+n+' (simulada)';$('#tp').textContent=n;mic=cam=true;cs()}
function cs(){$('#cMic').textContent=mic?'🎤 Microfone ligado':'🔇 Microfone desligado';$('#cCam').textContent=cam?'📷 Câmera ligada':'🚫 Câmera desligada';$('#tYou').style.opacity=cam?1:.3}
$('#cMic').onclick=()=>{mic=!mic;cs()};$('#cCam').onclick=()=>{cam=!cam;cs()};$('#cEnd').onclick=volta;

const NW=[
['Tributário',0,'Jornal econômico (exemplo)','Novas regras para tributação do consumo seguem em debate','Pode mudar como pequenos negócios calculam preços e emitem notas. Acompanhe os prazos de transição.'],
['Fiscal',1,'Blog contábil (exemplo)','Declaração anual do MEI: o que revisar antes de enviar','Atrasos geram multa. Organize notas e faturamento do ano.'],
['Econômico',1,'Agência de notícias (exemplo)','Juros e crédito: efeito da taxa básica sobre pequenos empreendedores','Crédito mais caro reduz a capacidade de investir. Priorize o caixa.'],
['Internacional',2,'Jornal internacional (exemplo)','Mudança na política de juros dos EUA movimenta o dólar','Dólar mais alto encarece insumos importados e pode pressionar preços no Brasil.'],
['Fiscal',3,'Portal de contabilidade (exemplo)','Cuidados ao emitir nota eletrônica para empresas','Erros na nota podem atrasar pagamentos de clientes PJ.'],
['Internacional',4,'Agência internacional (exemplo)','Petróleo sobe com tensões no exterior','Combustível e frete mais caros elevam custos de quem entrega mercadorias.'],
['Econômico',5,'Jornal econômico (exemplo)','Inflação de alimentos desacelera no mês','Alívio nos custos de matéria-prima para alimentação e comércio.'],
['Tributário',6,'Blog tributário (exemplo)','Simples Nacional: quando vale migrar de MEI para ME','Passar do limite sem se reenquadrar pode gerar cobrança retroativa.']];
function renderNews(f){nf=f||'Todas';const dly=plan>0;
$('#nF').innerHTML=['Todas','Tributário','Fiscal','Econômico','Internacional'].map(c=>`<button class="${c===nf?'on':''}" onclick="renderNews('${c}')">${c}</button>`).join('');
$('#nFreq').textContent=dly?'Edição diária · atualizada hoje (exemplo)':'Edição semanal · atualizada esta semana (exemplo). Assine o plano Mensal para receber todo dia.';
$('#nSum').textContent=(dly?'Resumo de hoje: ':'Resumo da semana: ')+'cenário misto. Juros e dólar pressionam custos de quem importa insumos ou depende de crédito, enquanto a inflação de alimentos desacelera. Para pequenos negócios, vale revisar preços e proteger o caixa. (Resumo de exemplo gerado pela IA.)';
$('#nL').innerHTML=NW.filter(n=>nf==='Todas'||n[0]===nf).map(n=>`<div class="card"><span class="tag">${n[0]}</span> <span class="mut">${n[2]} · ${dly?(n[1]?'há '+n[1]+' dia(s)':'hoje'):'esta semana'}</span><p><b>${n[3]}</b></p><details><summary>Impacto no Brasil (IA)</summary><p>${n[4]}</p></details></div>`).join('')}

function applyPlan(){quota=IAQ[plan];$('#planB').innerHTML=`<div class="row" style="justify-content:space-between"><span><b>Plano ${PN[plan]}</b> · IA ${IAQ[plan]}/dia · Notícias ${plan?'diárias':'semanais'} · Assessorias −${DESC[plan]}%</span><button onclick="go('planos')">Ver planos</button></div>`;renderCursos();renderNews(nf);cota()}
applyPlan();
