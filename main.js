// Aqua — главный процесс Electron.
// Окно = наш интерфейс (панель вкладок + адресная строка) поверх,
// а сами страницы рисуются в WebContentsView, у которого весь трафик
// направлен через наш прокси-сервер. Логин/пароль к прокси подставляются
// автоматически, у пользователя ничего не спрашивается.
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const CHROME_HEIGHT = 92; // высота нашей верхней панели, px (42 вкладки + 50 тулбар)

let win;
const tabs = new Map(); // id -> WebContentsView
let activeId = null;
let nextId = 1;

// Логин к прокси приходит на уровне приложения (app 'login'), а не сессии —
// только так Chromium подставляет пароль в туннель HTTPS (CONNECT).
app.on('login', (event, webContents, details, authInfo, callback) => {
  if (authInfo.isProxy) {
    event.preventDefault();
    callback(CFG.proxy.user, CFG.proxy.pass);
  }
});

// Общая сессия со включённым прокси на наш сервер.
function proxiedSession() {
  const ses = session.fromPartition('persist:aqua');
  ses.setProxy({ proxyRules: `${CFG.proxy.host}:${CFG.proxy.port}` });
  return ses;
}

function layoutActive() {
  if (activeId == null) return;
  const view = tabs.get(activeId);
  const { width, height } = win.getContentBounds();
  view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT });
}

function send(channel, payload) {
  win.webContents.send(channel, payload);
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
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });
}

function createTab(url) {
  const id = nextId++;
  const ses = proxiedSession();
  const view = new WebContentsView({
    webPreferences: { session: ses, contextIsolation: true, sandbox: true },
  });
  tabs.set(id, view);
  win.contentView.addChildView(view);
  wireView(id, view);
  view.webContents.loadURL(url || CFG.homepage);
  send('tab-created', { id });
  activateTab(id);
  return id;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  // прячем все, показываем активную
  for (const [tid, v] of tabs) v.setVisible(tid === id);
  layoutActive();
  send('tab-activated', { id });
  const wc = tabs.get(id).webContents;
  send('tab-updated', {
    id, url: wc.getURL(), title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  });
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

// Превращает ввод адресной строки в URL: домен → открыть, иначе поиск.
function toURL(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s.]+\.[^\s]{2,}(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return CFG.searchUrl + encodeURIComponent(s);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset', // на macOS: свои кнопки утоплены, красивый безрамочный вид
    trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layoutActive);
  win.webContents.once('did-finish-load', () => createTab());
}

// ---- команды из интерфейса ----
ipcMain.on('nav', (e, { action, id, value }) => {
  const view = tabs.get(id ?? activeId);
  const wc = view && view.webContents;
  switch (action) {
    case 'go': if (wc) wc.loadURL(toURL(value)); break;
    case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) wc.reload(); break;
    case 'stop': if (wc) wc.stop(); break;
    case 'newtab': createTab(value); break;
    case 'closetab': closeTab(id); break;
    case 'activate': activateTab(id); break;
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
