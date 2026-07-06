// Интерфейс браузера: рисует вкладки и адресную строку, шлёт команды
// в главный процесс и слушает обновления состояния вкладок.
const strip = document.getElementById('tabstrip');
const newtabBtn = document.getElementById('newtab');
const urlInput = document.getElementById('url');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const reload = document.getElementById('reload');
const lock = document.getElementById('lock');
const progress = document.getElementById('progress');

let active = null;
const tabEls = new Map(); // id -> { el, title }

function nav(action, extra = {}) {
  window.aqua.nav({ action, id: active, ...extra });
}

function makeTab(id) {
  const el = document.createElement('button');
  el.className = 'tab';
  el.innerHTML =
    '<span class="ico"></span><span class="title">Новая вкладка</span>' +
    '<span class="close" title="Закрыть">×</span>';
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
      window.aqua.nav({ action: 'closetab', id });
    } else {
      window.aqua.nav({ action: 'activate', id });
    }
  });
  strip.insertBefore(el, newtabBtn);
  tabEls.set(id, { el, title: 'Новая вкладка' });
}

function setSpinner(el, loading) {
  const ico = el.querySelector('.ico');
  ico.className = 'ico' + (loading ? ' spinner' : '');
}

// ---- события из главного процесса ----
window.aqua.on('tab-created', ({ id }) => { if (!tabEls.has(id)) makeTab(id); });

window.aqua.on('tab-activated', ({ id }) => {
  active = id;
  for (const [tid, t] of tabEls) t.el.classList.toggle('active', tid === id);
});

window.aqua.on('tab-closed', ({ id }) => {
  const t = tabEls.get(id);
  if (t) { t.el.remove(); tabEls.delete(id); }
});

window.aqua.on('tab-updated', (s) => {
  const t = tabEls.get(s.id);
  if (t) {
    t.el.querySelector('.title').textContent = s.title || 'Новая вкладка';
    setSpinner(t.el, s.loading);
  }
  if (s.id === active) {
    if (document.activeElement !== urlInput) urlInput.value = s.url || '';
    back.disabled = !s.canGoBack;
    forward.disabled = !s.canGoForward;
    progress.classList.toggle('loading', !!s.loading);
    lock.classList.toggle('secure', (s.url || '').startsWith('https://'));
    reload.querySelector('path').setAttribute('d',
      s.loading ? 'M6 6l12 12M18 6L6 18' : 'M20 11a8 8 0 10-2.3 5.7M20 4v5h-5');
    reload.title = s.loading ? 'Остановить' : 'Обновить';
    reload.dataset.loading = s.loading ? '1' : '';
  }
});

// ---- ввод пользователя ----
urlInput.addEventListener('focus', () => urlInput.select());
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { nav('go', { value: urlInput.value }); urlInput.blur(); }
  if (e.key === 'Escape') urlInput.blur();
});
back.addEventListener('click', () => nav('back'));
forward.addEventListener('click', () => nav('forward'));
reload.addEventListener('click', () => nav(reload.dataset.loading ? 'stop' : 'reload'));
newtabBtn.addEventListener('click', () => nav('newtab'));
