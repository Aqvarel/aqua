// Aqua — главный процесс Electron.
// Интерфейс (вкладки + адресная строка) рисуется поверх, страницы — в
// WebContentsView с общей сессией, чей прокси можно переключать на лету
// между несколькими серверами («флот»). Весь трафик идёт через сервер,
// который выбран активным; при падении прокси срабатывает kill-switch.
const { app, BrowserWindow, WebContentsView, ipcMain, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const tcp = require('net');

const CONFIG_PATH = path.join(__dirname, 'config.json');
let CFG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Геометрия «Aqua — one»: рейл + боковая панель слева, карточка страницы справа.
const RAIL = 66, SIDEBAR = 238, TOOLBAR = 52, PAD = 10, BORDER = 1;
const LEFT = RAIL + SIDEBAR;

let win;
const tabs = new Map(); // id -> WebContentsView
const newTabIds = new Set(); // вкладки на экране «новая вкладка» (страница спрятана)
let activeId = null;
let nextId = 1;
let overlayOn = false; // открыт ли оверлей (меню/настройки — страница спрятана)

// ---- Флот прокси: аутентификация по паре host:port ----
// Несколько прокси сосуществуют: пароль ищется по адресу того сервера,
// который сейчас запросил авторизацию (иначе при переключении узлов
// Chromium подставил бы не тот пароль).
let credsByHostPort = new Map();
function rebuildCreds() {
  credsByHostPort = new Map();
  for (const p of CFG.proxies || []) credsByHostPort.set(`${p.host}:${p.port}`, { user: p.user, pass: p.pass });
}
rebuildCreds();

app.on('login', (event, webContents, details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  const c = credsByHostPort.get(`${authInfo.host}:${authInfo.port}`);
  if (c) { event.preventDefault(); callback(c.user, c.pass); }
});

// Одна общая сессия на все вкладки — её прокси меняем на лету.
let sharedSes = null;
function proxiedSession() {
  if (sharedSes) return sharedSes;
  sharedSes = session.fromPartition('persist:aqua');
  installKillSwitch(sharedSes);
  return sharedSes;
}

function activeProxy() {
  return (CFG.proxies || []).find((p) => p.id === CFG.activeId) || (CFG.proxies || [])[0] || null;
}

// Применяет активный прокси (или прямое соединение) к общей сессии.
// Схемы указаны явно (http=/https=), чтобы Chromium не откатился молча
// на DIRECT и не раскрыл настоящий IP.
function applyProxy() {
  const ses = proxiedSession();
  if (CFG.directMode) return ses.setProxy({ mode: 'direct' });
  const p = activeProxy();
  if (!p) return ses.setProxy({ mode: 'direct' });
  return ses.setProxy({ proxyRules: `http=${p.host}:${p.port};https=${p.host}:${p.port}` });
}

// ---- Kill-switch: если туннель мёртв, замораживаем весь трафик ----
// Пока egressAllowed=false, любой запрос отменяется, кроме проверки
// самого прокси (чтобы уметь обнаружить восстановление).
let egressAllowed = true;
const HEALTH_HOST = 'ipinfo.io';
const HEALTH_URL = 'https://ipinfo.io/json';
function installKillSwitch(ses) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (egressAllowed) return cb({});
    let host = '';
    try { host = new URL(details.url).hostname; } catch {}
    if (host === HEALTH_HOST) return cb({}); // разрешаем только проверку прокси
    cb({ cancel: true });
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- Проверка выхода: реальный IP и гео через активный прокси ----
const exitCache = {}; // activeId | 'direct' -> {ip,city,countryCode,country}

function probeExit() {
  return new Promise((resolve) => {
    let body = '';
    const request = net.request({ url: HEALTH_URL, session: proxiedSession() });
    // net.request не проходит через app 'login' — авторизуем прокси на самом запросе
    request.on('login', (authInfo, cb) => {
      const p = activeProxy();
      if (p) cb(p.user, p.pass); else cb();
    });
    const to = setTimeout(() => { try { request.abort(); } catch {} resolve(null); }, 5000);
    request.on('response', (res) => {
      res.on('data', (d) => (body += d));
      res.on('end', () => { clearTimeout(to); try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    request.on('error', () => { clearTimeout(to); resolve(null); });
    request.end();
  });
}

async function refreshExit() {
  const key = CFG.directMode ? 'direct' : CFG.activeId;
  const data = await probeExit();
  if (data && data.ip) {
    egressAllowed = true;
    exitCache[key] = data;
    send('proxy-state', 'protected');
    // ipinfo.io: { ip, city, country (2-буквенный код) }
    send('exit-updated', { ip: data.ip, city: data.city, countryCode: data.country, country: data.country });
  } else {
    egressAllowed = false; // туннель не отвечает — замораживаем выход
    send('proxy-state', 'paused');
    send('exit-updated', { ip: null });
  }
}

// Быстрая TCP-проверка доступности узла (для бейджей задержки в «Хранилище»).
function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = tcp.connect(Number(port), host);
    const done = (r) => { clearTimeout(to); try { sock.destroy(); } catch {} resolve(r); };
    const to = setTimeout(() => done({ ok: false }), 3000);
    sock.on('connect', () => done({ ok: true, ms: Date.now() - start }));
    sock.on('error', () => done({ ok: false }));
  });
}

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CFG, null, 2));
}

function slugify(label, taken) {
  let base = (label || 'node').toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-').replace(/^-+|-+$/g, '') || 'node';
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// Нормализует список прокси из интерфейса: валидирует, выдаёт id.
function normalizeProxies(list) {
  const taken = new Set();
  const out = [];
  for (const p of list || []) {
    const host = String(p.host || '').trim();
    const port = parseInt(p.port, 10);
    if (!host || !port) continue;
    const id = p.id && !taken.has(p.id) ? p.id : slugify(p.label || host, taken);
    taken.add(id);
    out.push({
      id,
      label: String(p.label || host).trim(),
      host, port,
      user: String(p.user || ''),
      pass: String(p.pass || ''),
      type: 'http',
      color: p.color || '#46d3d8',
      country: p.country || null,
    });
  }
  return out;
}

// ---- слои интерфейса ----
function layoutActive() {
  if (activeId == null) return;
  const view = tabs.get(activeId);
  if (!view) return;
  const { width, height } = win.getContentBounds();
  const x = LEFT + BORDER;             // слева рейл+панель, +рамка карточки
  const y = PAD + TOOLBAR + BORDER;    // сверху отступ карточки + тулбар
  view.setBounds({ x, y, width: width - x - PAD - BORDER, height: height - y - PAD - BORDER });
}

// Видимость активной страницы: спрятана, если открыт оверлей или это «новая вкладка».
function updateStage() {
  const v = tabs.get(activeId);
  const isNew = newTabIds.has(activeId);
  if (v) v.setVisible(!overlayOn && !isNew);
  send('stage', { newtab: isNew });
}

function wireView(id, view) {
  const wc = view.webContents;
  const push = () =>
    send('tab-updated', {
      id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    });
  wc.on('did-start-loading', push);
  wc.on('did-stop-loading', push);
  wc.on('did-navigate', push);
  wc.on('did-navigate-in-page', push);
  wc.on('page-title-updated', push);
  wc.setWindowOpenHandler(({ url }) => { createTab(url); return { action: 'deny' }; });
}

function createTab(url) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: { session: proxiedSession(), contextIsolation: true, sandbox: true },
  });
  try { view.setBorderRadius(10); } catch {} // скругление карточки страницы (если поддерживается)
  tabs.set(id, view);
  win.contentView.addChildView(view);
  wireView(id, view);
  if (url) view.webContents.loadURL(url);
  else { newTabIds.add(id); view.webContents.loadURL('about:blank'); } // экран новой вкладки
  send('tab-created', { id });
  activateTab(id);
  return id;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  for (const [tid, v] of tabs) v.setVisible(tid === id && !overlayOn && !newTabIds.has(id));
  layoutActive();
  send('tab-activated', { id });
  const wc = tabs.get(id).webContents;
  send('tab-updated', {
    id, url: wc.getURL(), title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  });
  send('stage', { newtab: newTabIds.has(id) });
}

function closeTab(id) {
  const view = tabs.get(id);
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close();
  tabs.delete(id);
  send('tab-closed', { id });
  if (activeId === id) {
    const next = tabs.keys().next();
    if (!next.done) activateTab(next.value);
    else createTab();
  }
}

function toURL(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s.]+\.[^\s]{2,}(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return CFG.searchUrl + encodeURIComponent(s);
}

function reloadVisible() {
  const v = tabs.get(activeId);
  if (v) v.webContents.reload();
}

function fleetState() {
  return { proxies: CFG.proxies || [], activeId: CFG.activeId, directMode: !!CFG.directMode };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 760, minHeight: 480,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 24 }, // кнопки окна macOS садятся в рейл
    backgroundColor: '#070808',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layoutActive);
  win.webContents.once('did-finish-load', async () => {
    await applyProxy();
    createTab();
    refreshExit();
    setInterval(refreshExit, 6000); // проверка туннеля раз в 6 c
  });
}

// ---- навигация из интерфейса ----
ipcMain.on('nav', (e, { action, id, value }) => {
  const view = tabs.get(id ?? activeId);
  const wc = view && view.webContents;
  switch (action) {
    case 'go': if (wc) { wc.loadURL(toURL(value)); newTabIds.delete(id ?? activeId); updateStage(); } break;
    case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) wc.reload(); break;
    case 'stop': if (wc) wc.stop(); break;
    case 'newtab': createTab(value); break;
    case 'closetab': closeTab(id); break;
    case 'activate': activateTab(id); break;
  }
});

// Слой страницы лежит поверх HTML-интерфейса, поэтому на время показа
// оверлеев (меню серверов, «Хранилище») прячем активную страницу.
ipcMain.on('overlay', (e, on) => {
  overlayOn = !!on;
  const v = tabs.get(activeId);
  if (v) v.setVisible(!overlayOn && !newTabIds.has(activeId));
});

// ---- управление флотом прокси ----
ipcMain.handle('proxy:list', () => fleetState());

ipcMain.handle('proxy:save', (e, list) => {
  CFG.proxies = normalizeProxies(list);
  if (!CFG.proxies.some((p) => p.id === CFG.activeId)) CFG.activeId = CFG.proxies[0] ? CFG.proxies[0].id : null;
  rebuildCreds();
  writeConfig();
  applyProxy();
  refreshExit();
  return fleetState();
});

ipcMain.handle('proxy:setActive', async (e, id) => {
  if (id === 'direct') {
    CFG.directMode = true;
  } else if ((CFG.proxies || []).some((p) => p.id === id)) {
    CFG.directMode = false;
    CFG.activeId = id;
  }
  writeConfig();
  await applyProxy();
  egressAllowed = true; // не морозим на время переключения
  reloadVisible();
  refreshExit();
  return fleetState();
});

ipcMain.handle('proxy:test', async (e, id) => {
  const p = (CFG.proxies || []).find((x) => x.id === id);
  if (!p) return { ok: false };
  return tcpProbe(p.host, p.port);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
