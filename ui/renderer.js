// Интерфейс браузера: вкладки, адресная строка и управление флотом прокси
// (быстрое переключение узлов, «Хранилище» серверов, гео-выхода, kill-switch).
const $ = (id) => document.getElementById(id);
const strip = $('tabstrip');
const newtabBtn = $('newtab');
const urlInput = $('url');
const back = $('back');
const forward = $('forward');
const reload = $('reload');
const lock = $('lock');
const progress = $('progress');
const geo = $('geo');
const shield = $('shield');
const glow = $('glow');
const nodemenu = $('nodemenu');

let active = null;
const tabEls = new Map();

// состояние флота
let fleet = { proxies: [], activeId: null, directMode: false };
const latency = {}; // id -> {ok, ms}

function nav(action, extra = {}) { window.aqua.nav({ action, id: active, ...extra }); }

// ---------- вкладки ----------
function makeTab(id) {
  const el = document.createElement('button');
  el.className = 'tab';
  el.innerHTML = '<span class="ico"></span><span class="title">Новая вкладка</span><span class="close" title="Закрыть">×</span>';
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) window.aqua.nav({ action: 'closetab', id });
    else window.aqua.nav({ action: 'activate', id });
  });
  strip.insertBefore(el, newtabBtn);
  tabEls.set(id, { el });
}
function setSpinner(el, loading) { el.querySelector('.ico').className = 'ico' + (loading ? ' spinner' : ''); }

window.aqua.on('tab-created', ({ id }) => { if (!tabEls.has(id)) makeTab(id); });
window.aqua.on('tab-activated', ({ id }) => {
  active = id;
  for (const [tid, t] of tabEls) t.el.classList.toggle('active', tid === id);
});
window.aqua.on('tab-closed', ({ id }) => { const t = tabEls.get(id); if (t) { t.el.remove(); tabEls.delete(id); } });
window.aqua.on('tab-updated', (s) => {
  const t = tabEls.get(s.id);
  if (t) { t.el.querySelector('.title').textContent = s.title || 'Новая вкладка'; setSpinner(t.el, s.loading); }
  if (s.id === active) {
    if (document.activeElement !== urlInput) urlInput.value = s.url || '';
    back.disabled = !s.canGoBack;
    forward.disabled = !s.canGoForward;
    progress.classList.toggle('loading', !!s.loading);
  }
});

urlInput.addEventListener('focus', () => urlInput.select());
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { nav('go', { value: urlInput.value }); urlInput.blur(); }
  if (e.key === 'Escape') urlInput.blur();
});
back.addEventListener('click', () => nav('back'));
forward.addEventListener('click', () => nav('forward'));
reload.addEventListener('click', () => nav(reload.dataset.loading ? 'stop' : 'reload'));
newtabBtn.addEventListener('click', () => nav('newtab'));
reload.title = 'Обновить';
// синхронизируем иконку загрузки активной вкладки
window.aqua.on('tab-updated', (s) => {
  if (s.id !== active) return;
  reload.querySelector('path').setAttribute('d', s.loading ? 'M6 6l12 12M18 6L6 18' : 'M20 11a8 8 0 10-2.3 5.7M20 4v5h-5');
  reload.dataset.loading = s.loading ? '1' : '';
});

// ---------- выход в сеть: гео-пилюля, kill-switch, аура ----------
function flagOf(cc) {
  if (!cc || cc.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}
function hueOf(cc) {
  if (!cc) return 187; // аква по умолчанию
  let h = 0; for (const c of cc) h = (h * 31 + c.charCodeAt(0)) % 360; return h;
}

window.aqua.on('exit-updated', (d) => {
  if (d && d.ip) {
    geo.classList.remove('bad');
    geo.querySelector('.flag').textContent = flagOf(d.countryCode);
    const short = d.ip.split('.').slice(-2).join('.');
    geo.querySelector('.where').textContent = (d.city ? d.city + ' · ' : '') + '…' + short;
    geo.title = `Ваш трафик выходит: ${d.city || ''} ${d.country || ''} · IP ${d.ip}`;
    geo.dataset.ip = d.ip;
    // аура: перекрашиваем орбы под страну выхода
    // (плавность отключается в CSS через prefers-reduced-motion, цвет — всегда)
    const h = hueOf(d.countryCode);
    glow.style.setProperty('--orb-a', `hsla(${h},72%,58%,0.30)`);
    glow.style.setProperty('--orb-b', `hsla(${(h + 38) % 360},70%,60%,0.22)`);
  } else {
    geo.classList.add('bad');
    geo.querySelector('.flag').textContent = '⚠️';
    geo.querySelector('.where').textContent = 'нет выхода';
    geo.title = 'Сервер выхода не отвечает — трафик заморожен';
  }
});

window.aqua.on('proxy-state', (state) => {
  const paused = state === 'paused';
  lock.classList.toggle('protected', !paused);
  lock.classList.toggle('paused', paused);
  lock.title = paused
    ? 'Туннель недоступен — трафик заморожен, ваш реальный IP не раскрывается'
    : 'Туннель защищён — весь трафик идёт через ваш сервер';
});

geo.addEventListener('click', () => { if (geo.dataset.ip) navigator.clipboard?.writeText(geo.dataset.ip); });

// ---------- переключение узла + меню чипа ----------
function activeNode() {
  if (fleet.directMode) return null;
  return fleet.proxies.find((p) => p.id === fleet.activeId) || fleet.proxies[0] || null;
}
function paintChip() {
  const n = activeNode();
  const nm = shield.querySelector('.nm');
  if (fleet.directMode) {
    nm.textContent = 'Прямое';
    document.documentElement.style.setProperty('--node', 'var(--warn)');
    shield.style.background = 'linear-gradient(135deg,#f6c66b,#e88a3c)';
  } else if (n) {
    nm.textContent = n.label;
    document.documentElement.style.setProperty('--node', n.color || '#46d3d8');
    shield.style.background = `linear-gradient(135deg, ${n.color || '#4fe0e0'}, ${shade(n.color || '#5b9cff', -18)})`;
  }
}
// затемняет hex-цвет на процент (для градиента чипа)
function shade(hex, pct) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + pct / 100))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

async function setActive(id) {
  fleet = await window.aqua.proxies.setActive(id);
  paintChip();
  renderNodemenu();
  renderSlabs();
  fireRipple();
  closeNodemenu();
}
function fireRipple() {
  const rip = $('ripple');
  const rect = shield.getBoundingClientRect();
  document.documentElement.style.setProperty('--rx', rect.left + rect.width / 2 + 'px');
  rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go');
}

function renderNodemenu() {
  nodemenu.innerHTML = '';
  for (const p of fleet.proxies) {
    const row = document.createElement('button');
    row.className = 'node-row' + (!fleet.directMode && p.id === fleet.activeId ? ' active' : '');
    const lat = latency[p.id];
    const latTxt = lat ? (lat.ok ? lat.ms + ' мс' : 'нет связи') : '';
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="nm">${flagOf(p.country)} ${escapeHtml(p.label)}</span><span class="lat">${latTxt}</span>` +
      (!fleet.directMode && p.id === fleet.activeId ? '<span class="check">✓</span>' : '');
    row.addEventListener('click', () => setActive(p.id));
    nodemenu.appendChild(row);
  }
  const direct = document.createElement('button');
  direct.className = 'node-row' + (fleet.directMode ? ' active' : '');
  direct.innerHTML = `<span class="dot" style="background:var(--warn)"></span><span class="nm">Прямое соединение</span>` + (fleet.directMode ? '<span class="check">✓</span>' : '');
  direct.addEventListener('click', () => setActive('direct'));
  nodemenu.appendChild(direct);
  const sep = document.createElement('div'); sep.className = 'sep'; nodemenu.appendChild(sep);
  const manage = document.createElement('button');
  manage.className = 'menu-action';
  manage.textContent = '⚙  Управление серверами';
  manage.addEventListener('click', () => { openVault(); closeNodemenu(); });
  nodemenu.appendChild(manage);
}
// Прячем слой страницы, если открыт любой оверлей (иначе он лёг бы за страницу).
function syncOverlay() {
  const on = nodemenu.classList.contains('open') || vault.classList.contains('open');
  window.aqua.overlay(on);
}
function openNodemenu() { renderNodemenu(); nodemenu.classList.add('open'); syncOverlay(); }
function closeNodemenu() { nodemenu.classList.remove('open'); syncOverlay(); }
shield.addEventListener('click', (e) => { e.stopPropagation(); nodemenu.classList.contains('open') ? closeNodemenu() : openNodemenu(); });
document.addEventListener('click', (e) => { if (!nodemenu.contains(e.target) && e.target !== shield) closeNodemenu(); });

// быстрый цикл узлов: Cmd/Ctrl+Shift+P
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyP') {
    e.preventDefault();
    if (!fleet.proxies.length) return;
    const idx = fleet.proxies.findIndex((p) => p.id === fleet.activeId);
    const next = fleet.proxies[(idx + 1) % fleet.proxies.length];
    setActive(next.id);
  }
});

// ---------- Хранилище (Vault) ----------
const vault = $('vault'), scrim = $('scrim'), slabsEl = $('slabs');
let editingId = null;

function openVault() { scrim.classList.add('open'); vault.classList.add('open'); renderSlabs(); pingAll(); syncOverlay(); }
function closeVault() { scrim.classList.remove('open'); vault.classList.remove('open'); closeForm(); syncOverlay(); }
$('gear').addEventListener('click', openVault);
$('vclose').addEventListener('click', closeVault);
scrim.addEventListener('click', closeVault);

function latClass(lat) { if (!lat || !lat.ok) return 'bad'; if (lat.ms < 150) return 'good'; if (lat.ms < 500) return 'warn'; return 'bad'; }
function latText(lat) { if (!lat) return '…'; if (!lat.ok) return 'нет связи'; return lat.ms + ' мс'; }

function renderSlabs() {
  slabsEl.innerHTML = '';
  for (const p of fleet.proxies) {
    const slab = document.createElement('div');
    const isActive = !fleet.directMode && p.id === fleet.activeId;
    slab.className = 'slab' + (isActive ? ' active' : '');
    const lat = latency[p.id];
    slab.innerHTML =
      `<span class="dot" style="background:${p.color}"></span>` +
      `<div class="info"><div class="label">${flagOf(p.country)} ${escapeHtml(p.label)}</div><div class="addr">${escapeHtml(p.host)}:${p.port}</div></div>` +
      `<span class="lat ${latClass(lat)}">${latText(lat)}</span>` +
      `<div class="acts">` +
      `<button class="icobtn use" title="Сделать активным">${isActive ? '✓' : '→'}</button>` +
      `<button class="icobtn edit" title="Изменить">✎</button>` +
      `<button class="icobtn del" title="Удалить">🗑</button>` +
      `</div>`;
    slab.querySelector('.use').addEventListener('click', () => setActive(p.id));
    slab.querySelector('.edit').addEventListener('click', () => openForm(p));
    slab.querySelector('.del').addEventListener('click', () => removeProxy(p.id));
    slabsEl.appendChild(slab);
  }
  if (!fleet.proxies.length) slabsEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 2px">Пока нет серверов. Добавьте первый ниже.</div>';
}

// форма добавить/изменить
const form = $('form'), fLabel = $('f_label'), fColor = $('f_color'), fHost = $('f_host'), fPort = $('f_port'), fUser = $('f_user'), fPass = $('f_pass'), formErr = $('formErr');
function openForm(p) {
  editingId = p ? p.id : null;
  fLabel.value = p ? p.label : '';
  fColor.value = p ? (p.color || '#46d3d8') : '#46d3d8';
  fHost.value = p ? p.host : '';
  fPort.value = p ? p.port : '8888';
  fUser.value = p ? p.user : 'aqua';
  fPass.value = p ? p.pass : '';
  formErr.textContent = '';
  form.classList.add('open');
  fLabel.focus();
}
function closeForm() { form.classList.remove('open'); editingId = null; }
$('addBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', closeForm);

async function saveForm() {
  const host = fHost.value.trim();
  const port = parseInt(fPort.value, 10);
  if (!host) { formErr.textContent = 'Укажите адрес сервера'; return; }
  if (!port || port < 1 || port > 65535) { formErr.textContent = 'Порт должен быть числом 1–65535'; return; }
  const entry = { id: editingId || undefined, label: fLabel.value.trim() || host, host, port, user: fUser.value.trim(), pass: fPass.value, color: fColor.value };
  const list = fleet.proxies.slice();
  if (editingId) {
    const i = list.findIndex((x) => x.id === editingId);
    if (i >= 0) list[i] = { ...list[i], ...entry };
  } else list.push(entry);
  fleet = await window.aqua.proxies.save(list);
  closeForm(); paintChip(); renderSlabs(); renderNodemenu(); pingAll();
}
$('saveBtn').addEventListener('click', saveForm);

async function removeProxy(id) {
  const list = fleet.proxies.filter((p) => p.id !== id);
  fleet = await window.aqua.proxies.save(list);
  paintChip(); renderSlabs(); renderNodemenu();
}

// импорт из текста: host:port:user:pass построчно
$('importBtn').addEventListener('click', async () => {
  const lines = $('paste').value.split('\n').map((l) => l.trim()).filter(Boolean);
  const list = fleet.proxies.slice();
  const seen = new Set(list.map((p) => `${p.host}:${p.port}`));
  let added = 0;
  for (const line of lines) {
    const parts = line.split(/[:\s]+/);
    if (parts.length < 2) continue;
    const [host, port, user, pass] = parts;
    if (!host || !parseInt(port, 10)) continue;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ label: host, host, port: parseInt(port, 10), user: user || '', pass: pass || '', color: randColor() });
    added++;
  }
  if (added) { fleet = await window.aqua.proxies.save(list); $('paste').value = ''; renderSlabs(); renderNodemenu(); pingAll(); }
});

// прямое соединение
const directSw = $('directSw');
directSw.addEventListener('click', async () => { await setActive(fleet.directMode ? (fleet.activeId || (fleet.proxies[0] && fleet.proxies[0].id)) : 'direct'); syncDirectSw(); });
function syncDirectSw() { directSw.classList.toggle('on', fleet.directMode); }

// пинг всех узлов (задержка в бейджах)
async function pingAll() {
  for (const p of fleet.proxies) {
    window.aqua.proxies.test(p.id).then((r) => { latency[p.id] = r; renderSlabs(); if (nodemenu.classList.contains('open')) renderNodemenu(); });
  }
}

function randColor() { const h = Math.floor((Object.keys(latency).length * 47 + 200) % 360); return hslToHex(h, 68, 58); }
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- старт ----------
(async function init() {
  fleet = await window.aqua.proxies.list();
  paintChip(); renderNodemenu(); syncDirectSw();
})();
