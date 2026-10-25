const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Безопасный мост: renderer видит только эти функции через window.api
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => subscribe('window:maximized-changed', callback),
    onFocus: (callback) => subscribe('window:focus', callback),
  },
  tabs: {
    get: () => ipcRenderer.invoke('tabs:get'),
    save: (tabs, active) => ipcRenderer.invoke('tabs:save', tabs, active),
  },
  // Методы возвращают { ok: true, data } или { ok: false, error: { code, message, hint, details } }
  repo: {
    openDialog: (title) => ipcRenderer.invoke('repo:open-dialog', title),
    inspect: (dir) => ipcRenderer.invoke('repo:inspect', dir),
    init: (dir, options) => ipcRenderer.invoke('repo:init', dir, options),
    // options: { url, branch } → проверка удалённого репозитория без изменений
    probeRemote: (dir, options) => ipcRenderer.invoke('repo:probe-remote', dir, options),
    connect: (dir, options) => ipcRenderer.invoke('repo:connect', dir, options),
    getLast: () => ipcRenderer.invoke('repo:get-last'),
    load: (dir) => ipcRenderer.invoke('repo:load', dir),
    commitFiles: (dir, hash, parent) => ipcRenderer.invoke('repo:commit-files', dir, hash, parent),
    // params: { mode: 'commit'|'staged'|'unstaged'|'untracked', hash, parent, path, oldPath, ignoreWhitespace, conflicted }
    fileDiff: (dir, params) => ipcRenderer.invoke('repo:file-diff', dir, params),
    action: (dir, name, payload) => ipcRenderer.invoke('repo:action', dir, name, payload),
  },
});
