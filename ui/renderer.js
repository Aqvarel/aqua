// Aqua — one. Логика интерфейса: вкладки в боковой панели, экран новой
// вкладки, страница настроек с управлением флотом прокси, переключение узлов.
const $ = (id) => document.getElementById(id);
const tablist = $('tablist'), tabcount = $('tabcount');
const urlInput = $('url'), scheme = $('scheme');
const back = $('back'), forward = $('forward'), reload = $('reload');
const shield = $('shield'), geo = $('geo');
const newtabPanel = $('newtab'), settingsPanel = $('settings'), nodemenu = $('nodemenu');

let active = null;
let activeIsNew = false;
let settingsOpen = false;
const tabEls = new Map();
const tabState = new Map(); // id -> {url,title,loading}

let fleet = { proxies: [], activeId: null, directMode: false };
const latency = {};

function nav(action, extra = {}) { window.aqua.nav({ action, id: active, ...extra }); }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function letterOf(url, title){ try { const h=new URL(url).hostname.replace(/^www\./,''); return (h[0]||'A').toUpperCase(); } catch { return (title||'A')[0].toUpperCase(); } }

// ---------- вкладки в боковой панели ----------
function makeTab(id) {
  const el = document.createElement('button');
  el.className = 'tab';
  el.innerHTML = '<span class="fav">A</span><span class="ttl">Новая вкладка</span><span class="x" title="Закрыть">×</span>';
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('x')) window.aqua.nav({ action: 'closetab', id });
    else window.aqua.nav({ action: 'activate', id });
  });
  tablist.appendChild(el);
  tabEls.set(id, el);
  updateCount();
}
function updateCount() {
  const n = tabEls.size, i = active ? [...tabEls.keys()].indexOf(active) + 1 : 0;
  tabcount.textContent = String(i).padStart(2,'0') + ' / ' + String(n).padStart(2,'0');
}
function paintTab(id, s) {
  const el = tabEls.get(id); if (!el) return;
  const isNew = !s.url || s.url === 'about:blank';
  el.querySelector('.ttl').textContent = isNew ? 'Новая вкладка' : (s.title || s.url || 'Загрузка…');
  const fav = el.querySelector('.fav');
  fav.className = 'fav' + (s.loading ? ' load' : '');
  fav.textContent = s.loading ? '' : (isNew ? 'A' : letterOf(s.url, s.title));
}

window.aqua.on('tab-created', ({ id }) => { if (!tabEls.has(id)) makeTab(id); });
window.aqua.on('tab-closed', ({ id }) => { const el = tabEls.get(id); if (el) { el.remove(); tabEls.delete(id); tabState.delete(id); updateCount(); } });
window.aqua.on('tab-activated', ({ id }) => {
  active = id;
  for (const [tid, el] of tabEls) el.classList.toggle('on', tid === id);
  updateCount();
  const s = tabState.get(id) || {};
  syncToolbar(s);
});
window.aqua.on('tab-updated', (s) => {
  tabState.set(s.id, s);
  paintTab(s.id, s);
  if (s.id === active) syncToolbar(s);
});

// главный процесс сообщает, показывать ли экран новой вкладки
window.aqua.on('stage', ({ newtab }) => { activeIsNew = !!newtab; syncPanels(); });

function syncToolbar(s) {
  if (document.activeElement !== urlInput) {
    const isNew = !s.url || s.url === 'about:blank';
    urlInput.value = isNew ? '' : (s.url || '');
    scheme.textContent = isNew ? 'aqua://' : (String(s.url||'').startsWith('https') ? 'https://' : 'http://');
    scheme.style.display = isNew ? '' : 'none';
  }
  back.disabled = !s.canGoBack;
  forward.disabled = !s.canGoForward;
}

// ---------- панели поверх области страницы ----------
function syncPanels() {
  settingsPanel.classList.toggle('show', settingsOpen);
  newtabPanel.classList.toggle('show', activeIsNew && !settingsOpen);
}
function setOverlay() {
  const on = settingsOpen || nodemenu.classList.contains('open');
  window.aqua.overlay(on);
  syncPanels();
}

// ---------- адресная строка / навигация ----------
urlInput.addEventListener('focus', () => { scheme.style.display = 'none'; urlInput.select(); });
urlInput.addEventListener('blur', () => { const s = tabState.get(active) || {}; syncToolbar(s); });
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { nav('go', { value: urlInput.value }); urlInput.blur(); }
  if (e.key === 'Escape') urlInput.blur();
});
back.addEventListener('click', () => nav('back'));
forward.addEventListener('click', () => nav('forward'));
reload.addEventListener('click', () => nav('reload'));
$('newtabbtn').addEventListener('click', () => nav('newtab'));
$('cmd').addEventListener('click', () => urlInput.focus());
$('bigcmd').addEventListener('click', () => urlInput.focus());

// ---------- экран новой вкладки: часы + быстрый доступ ----------
const QUICK = [
  { n: 'Mail', u: 'https://mail.google.com', t: 'M' },
  { n: 'GitHub', u: 'https://github.com', t: 'G' },
  { n: 'YouTube', u: 'https://youtube.com', t: 'Y' },
  { n: 'Wikipedia', u: 'https://wikipedia.org', t: 'W' },
];
function buildQuick() {
  const q = $('quick'); q.innerHTML = '';
  for (const it of QUICK) {
    const el = document.createElement('div');
    el.className = 'qt';
    el.innerHTML = `<div class="qtt">${it.t}</div><div class="qtn">${escapeHtml(it.n)}</div>`;
    el.addEventListener('click', () => nav('go', { value: it.u }));
    q.appendChild(el);
  }
  // те же ярлыки — в «Закреплённые» боковой панели
  const pins = $('pins'); pins.innerHTML = '';
  for (const it of QUICK) {
    const p = document.createElement('div'); p.className = 'pin'; p.textContent = it.t;
    p.title = it.n; p.addEventListener('click', () => nav('go', { value: it.u }));
    pins.appendChild(p);
  }
}
function tickClock() {
  const d = new Date();
  $('clock').textContent = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  $('datel').textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- выход в сеть: гео, kill-switch, акцент по стране ----------
function flagOf(cc){ if(!cc||cc.length!==2) return ''; return String.fromCodePoint(...[...cc.toUpperCase()].map(c=>127397+c.charCodeAt(0))); }

window.aqua.on('exit-updated', (d) => {
  if (d && d.ip) {
    const short = d.ip.split('.').slice(-2).join('.');
    geo.textContent = `${flagOf(d.countryCode)} ${d.city || ''} ·${short}`.trim();
    geo.title = `Выход: ${d.city || ''} ${d.country || ''} · IP ${d.ip}`;
    geo.dataset.ip = d.ip;
  } else {
    geo.textContent = '⚠ нет выхода';
    geo.title = 'Сервер выхода не отвечает — трафик заморожен';
  }
});
window.aqua.on('proxy-state', (state) => {
  const paused = state === 'paused';
  shield.classList.toggle('protected', !paused);
  shield.classList.toggle('paused', paused);
  shield.title = paused ? 'Туннель недоступен — трафик заморожен, реальный IP не раскрыт'
                        : 'Активный сервер выхода — нажмите, чтобы переключить';
});
geo.addEventListener('click', () => { if (geo.dataset.ip) navigator.clipboard?.writeText(geo.dataset.ip); });

// ---------- переключение узла + меню ----------
function activeNode(){ if (fleet.directMode) return null; return fleet.proxies.find(p=>p.id===fleet.activeId) || fleet.proxies[0] || null; }
function paintShield(){
  const n = activeNode();
  document.documentElement.style.setProperty('--aq', fleet.directMode ? '#c9a96e' : (n ? n.color : '#7ee7c4'));
}
async function setActive(id){
  fleet = await window.aqua.proxies.setActive(id);
  paintShield(); renderNodemenu(); if (settingsOpen) renderServers();
  closeNodemenu();
}
function renderNodemenu(){
  nodemenu.innerHTML = '';
  for (const p of fleet.proxies){
    const on = !fleet.directMode && p.id === fleet.activeId;
    const r = document.createElement('button'); r.className = 'nrow' + (on?' on':'');
    const l = latency[p.id];
    r.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="nn">${flagOf(p.country)} ${escapeHtml(p.label)}</span><span class="nl">${l?(l.ok?l.ms+'мс':'—'):''}</span>`;
    r.addEventListener('click', ()=>setActive(p.id));
    nodemenu.appendChild(r);
  }
  const dir = document.createElement('button'); dir.className = 'nrow' + (fleet.directMode?' on':'');
  dir.innerHTML = `<span class="dot" style="background:#c9a96e"></span><span class="nn">Прямое соединение</span>`;
  dir.addEventListener('click', ()=>setActive('direct'));
  nodemenu.appendChild(dir);
  const sep = document.createElement('div'); sep.className='nsep'; nodemenu.appendChild(sep);
  const mng = document.createElement('button'); mng.className='nrow nact'; mng.textContent='Управление серверами →';
  mng.addEventListener('click', ()=>{ openSettings('servers'); closeNodemenu(); });
  nodemenu.appendChild(mng);
}
function openNodemenu(){ renderNodemenu(); nodemenu.classList.add('open'); setOverlay(); pingAll(); }
function closeNodemenu(){ nodemenu.classList.remove('open'); setOverlay(); }
shield.addEventListener('click', (e)=>{ e.stopPropagation(); nodemenu.classList.contains('open') ? closeNodemenu() : openNodemenu(); });
document.addEventListener('click', (e)=>{ if(!nodemenu.contains(e.target) && e.target!==shield && !shield.contains(e.target)) closeNodemenu(); });
document.addEventListener('keydown',(e)=>{
  if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.code==='KeyP'){ e.preventDefault(); if(!fleet.proxies.length)return; const i=fleet.proxies.findIndex(p=>p.id===fleet.activeId); setActive(fleet.proxies[(i+1)%fleet.proxies.length].id); }
});

// ---------- страница настроек ----------
function openSettings(page){ settingsOpen = true; setOverlay(); renderSettingsNav(page||'servers'); }
function closeSettings(){ settingsOpen = false; setOverlay(); }
function renderSettingsNav(page){
  for (const b of document.querySelectorAll('.sn')) b.classList.toggle('on', b.dataset.p === page);
  const pane = $('spane');
  if (page === 'servers') renderServersPane(pane);
  else if (page === 'appearance') renderAppearance(pane);
  else if (page === 'privacy') renderPrivacy(pane);
  else renderAbout(pane);
}
document.querySelectorAll('.sn').forEach(b => b.addEventListener('click', () => renderSettingsNav(b.dataset.p)));

// серверы
let editingId = null;
function renderServersPane(pane){
  pane.innerHTML = `<h1 class="h1">Серверы выхода</h1>
    <div class="srd" style="margin:-24px 0 26px">Весь трафик Aqua идёт через выбранный сервер.</div>
    <div id="srvlist"></div>
    <div class="addsrv"><button class="btn primary" id="addSrv">+ Добавить сервер</button><button class="btn" id="pasteToggle">Вставить списком</button></div>
    <div class="srvform" id="srvform">
      <div class="frow"><div class="fld" style="flex:2"><label>Название</label><input id="f_label" placeholder="Франкфурт"></div><div class="fld" style="flex:0"><label>Цвет</label><input id="f_color" type="color" value="#7ee7c4"></div></div>
      <div class="frow"><div class="fld" style="flex:3"><label>Адрес</label><input id="f_host" placeholder="123.45.67.89" spellcheck="false"></div><div class="fld" style="flex:1"><label>Порт</label><input id="f_port" placeholder="8888" inputmode="numeric"></div></div>
      <div class="frow"><div class="fld"><label>Логин</label><input id="f_user" placeholder="aqua" spellcheck="false"></div><div class="fld"><label>Пароль</label><input id="f_pass" placeholder="••••" spellcheck="false"></div></div>
      <div class="ferr" id="ferr"></div>
      <div class="frow"><button class="btn primary" id="saveSrv" style="flex:1;justify-content:center">Сохранить</button><button class="btn" id="cancelSrv">Отмена</button></div>
    </div>
    <div class="srvform" id="pasteform"><textarea id="paste" placeholder="host:port:логин:пароль — по строке на сервер"></textarea><button class="btn" id="importSrv" style="justify-content:center">Импортировать</button></div>`;
  $('addSrv').addEventListener('click', ()=>openForm(null));
  $('pasteToggle').addEventListener('click', ()=>$('pasteform').classList.toggle('show'));
  $('cancelSrv').addEventListener('click', ()=>$('srvform').classList.remove('show'));
  $('saveSrv').addEventListener('click', saveForm);
  $('importSrv').addEventListener('click', importList);
  renderServers();
  pingAll();
}
function renderServers(){
  const list = $('srvlist'); if (!list) return; list.innerHTML = '';
  for (const p of fleet.proxies){
    const on = !fleet.directMode && p.id === fleet.activeId;
    const l = latency[p.id];
    const row = document.createElement('div'); row.className = 'srv' + (on?' on':'');
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <div class="si"><div class="sl">${flagOf(p.country)} ${escapeHtml(p.label)}</div><div class="sa">${escapeHtml(p.host)}:${p.port}</div></div>
      <span class="lat ${l?(l.ok?'good':'bad'):''}">${l?(l.ok?l.ms+' мс':'нет'):'…'}</span>
      <button class="use">${on?'Активен':'Выбрать'}</button>
      <button class="mini edit" title="Изменить">✎</button><button class="mini del" title="Удалить">×</button>`;
    row.querySelector('.use').addEventListener('click', ()=>setActive(p.id));
    row.querySelector('.edit').addEventListener('click', ()=>openForm(p));
    row.querySelector('.del').addEventListener('click', ()=>removeProxy(p.id));
    list.appendChild(row);
  }
  if (!fleet.proxies.length) list.innerHTML = '<div class="srd" style="padding:14px 0">Серверов пока нет. Добавьте первый.</div>';
}
function openForm(p){
  $('srvform').classList.add('show'); editingId = p?p.id:null;
  $('f_label').value=p?p.label:''; $('f_color').value=p?(p.color||'#7ee7c4'):'#7ee7c4';
  $('f_host').value=p?p.host:''; $('f_port').value=p?p.port:'8888';
  $('f_user').value=p?p.user:'aqua'; $('f_pass').value=p?p.pass:''; $('ferr').textContent='';
  $('f_label').focus();
}
async function saveForm(){
  const host=$('f_host').value.trim(), port=parseInt($('f_port').value,10);
  if(!host){ $('ferr').textContent='Укажите адрес'; return; }
  if(!port||port<1||port>65535){ $('ferr').textContent='Порт 1–65535'; return; }
  const entry={ id:editingId||undefined, label:$('f_label').value.trim()||host, host, port, user:$('f_user').value.trim(), pass:$('f_pass').value, color:$('f_color').value };
  const list = fleet.proxies.slice();
  if(editingId){ const i=list.findIndex(x=>x.id===editingId); if(i>=0) list[i]={...list[i],...entry}; }
  else list.push(entry);
  fleet = await window.aqua.proxies.save(list);
  $('srvform').classList.remove('show'); paintShield(); renderServers(); renderNodemenu(); pingAll();
}
async function removeProxy(id){ fleet = await window.aqua.proxies.save(fleet.proxies.filter(p=>p.id!==id)); paintShield(); renderServers(); renderNodemenu(); }
async function importList(){
  const lines=$('paste').value.split('\n').map(l=>l.trim()).filter(Boolean);
  const list=fleet.proxies.slice(); const seen=new Set(list.map(p=>`${p.host}:${p.port}`)); let n=0;
  for(const line of lines){ const [host,port,user,pass]=line.split(/[:\s]+/); if(!host||!parseInt(port,10))continue; const k=`${host}:${port}`; if(seen.has(k))continue; seen.add(k); list.push({label:host,host,port:parseInt(port,10),user:user||'',pass:pass||'',color:'#7ee7c4'}); n++; }
  if(n){ fleet=await window.aqua.proxies.save(list); $('paste').value=''; $('pasteform').classList.remove('show'); renderServers(); renderNodemenu(); pingAll(); }
}
async function pingAll(){ for(const p of fleet.proxies){ window.aqua.proxies.test(p.id).then(r=>{ latency[p.id]=r; renderServers(); if(nodemenu.classList.contains('open')) renderNodemenu(); }); } }

// оформление
function renderAppearance(pane){
  const accents = ['#7ee7c4','#c9a96e','#8fb7ff','#e8e6e1'];
  const cur = getComputedStyle(document.documentElement).getPropertyValue('--aq').trim();
  pane.innerHTML = `<h1 class="h1">Оформление</h1>
    <div class="srow"><div><div class="srt">Тема</div><div class="srd">Aqua создан для тёмного.</div></div><div class="seg"><div class="sgi on">Тёмная</div><div class="sgi">Авто</div></div></div>
    <div class="srow"><div><div class="srt">Акцент</div><div class="srd">Фокус, индикаторы и подсветка.</div></div><div class="sws">${accents.map(c=>`<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('')}</div></div>
    <div class="srow"><div><div class="srt">Стеклянные поверхности</div><div class="srd">Полупрозрачность и глубина панелей.</div></div><div class="tgl on"><div class="knob"></div></div></div>`;
  pane.querySelectorAll('.sw').forEach(s=>{ if(s.dataset.c.toLowerCase()===cur.toLowerCase()) s.classList.add('on'); s.addEventListener('click',()=>{ document.documentElement.style.setProperty('--aq', s.dataset.c); pane.querySelectorAll('.sw').forEach(x=>x.classList.remove('on')); s.classList.add('on'); }); });
  pane.querySelectorAll('.tgl').forEach(t=>t.addEventListener('click',()=>t.classList.toggle('on')));
}
function renderPrivacy(pane){
  pane.innerHTML = `<h1 class="h1">Приватность</h1>
    <div class="srow"><div><div class="srt">Kill-switch</div><div class="srd">Если туннель падает — трафик замораживается, реальный IP не утекает.</div></div><div class="tgl on"><div class="knob"></div></div></div>
    <div class="srow"><div><div class="srt">Аура выхода</div><div class="srd">Акцент подстраивается под активный сервер.</div></div><div class="tgl on"><div class="knob"></div></div></div>`;
  pane.querySelectorAll('.tgl').forEach(t=>t.addEventListener('click',()=>t.classList.toggle('on')));
}
function renderAbout(pane){
  pane.innerHTML = `<h1 class="h1">Aqua — one</h1>
    <div class="srd" style="line-height:1.7;max-width:440px">Браузер, чей трафик идёт через ваши собственные серверы. Дизайн-система «Aqua». Движок Chromium (Electron).</div>`;
}
// закрытие настроек по Esc, если открыты (и не в поле ввода)
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && settingsOpen && document.activeElement.tagName!=='INPUT') closeSettings(); });

// ---------- старт ----------
(async function init(){
  buildQuick(); tickClock(); setInterval(tickClock, 15000);
  fleet = await window.aqua.proxies.list();
  paintShield(); renderNodemenu();
})();
