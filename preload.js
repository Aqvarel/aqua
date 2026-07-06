// Мост между интерфейсом (renderer) и главным процессом.
// Даём окну безопасный узкий API вместо полного доступа к Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aqua', {
  nav: (msg) => ipcRenderer.send('nav', msg),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
  // управление флотом прокси (двусторонние вызовы)
  proxies: {
    list: () => ipcRenderer.invoke('proxy:list'),
    save: (list) => ipcRenderer.invoke('proxy:save', list),
    setActive: (id) => ipcRenderer.invoke('proxy:setActive', id),
    test: (id) => ipcRenderer.invoke('proxy:test', id),
  },
});
