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
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  appearance: {
    get: () => ipcRenderer.invoke('appearance:get'),
    set: (value) => ipcRenderer.invoke('appearance:set', value),
    pickImage: () => ipcRenderer.invoke('appearance:pick-image'),
    image: () => ipcRenderer.invoke('appearance:image'),
  },
  // GitLab: токен не покидает main-процесс; opts = { remote, ref }
  gitlab: {
    status: (dir, opts) => ipcRenderer.invoke('gitlab:status', dir, opts),
    setToken: (dir, token, opts) => ipcRenderer.invoke('gitlab:set-token', dir, token, opts),
    clearToken: (dir, opts) => ipcRenderer.invoke('gitlab:clear-token', dir, opts),
    pipelines: (dir, opts) => ipcRenderer.invoke('gitlab:pipelines', dir, opts),
    pipeline: (dir, id, opts) => ipcRenderer.invoke('gitlab:pipeline', dir, id, opts),
    jobLog: (dir, id, opts) => ipcRenderer.invoke('gitlab:job-log', dir, id, opts),
    action: (dir, action, opts) => ipcRenderer.invoke('gitlab:action', dir, action, opts),
    variables: (dir, opts) => ipcRenderer.invoke('gitlab:variables', dir, opts),
    variableValue: (dir, variable, opts) => ipcRenderer.invoke('gitlab:variable-value', dir, variable, opts),
    runners: (dir, opts) => ipcRenderer.invoke('gitlab:runners', dir, opts),
  },
  // Методы возвращают { ok: true, data } или { ok: false, error: { code, message, hint, details } }
  repo: {
    openDialog: (title) => ipcRenderer.invoke('repo:open-dialog', title),
    inspect: (dir) => ipcRenderer.invoke('repo:inspect', dir),
    init: (dir, options) => ipcRenderer.invoke('repo:init', dir, options),
    // options: { url, branch } → проверка удалённого репозитория без изменений
    probeRemote: (dir, options) => ipcRenderer.invoke('repo:probe-remote', dir, options),
    connect: (dir, options) => ipcRenderer.invoke('repo:connect', dir, options),
    // Только статус рабочих файлов — быстро, без перечитывания истории
    status: (dir) => ipcRenderer.invoke('repo:status', dir),
    openPath: (dir, rel) => ipcRenderer.invoke('repo:open-path', dir, rel),
    // Настройки CI/CD из файлов репозитория: { systems, current }
    ci: (dir, file) => ipcRenderer.invoke('repo:ci', dir, file),
    stashDetails: (dir, hash) => ipcRenderer.invoke('repo:stash-details', dir, hash),
    cloneProbe: (url) => ipcRenderer.invoke('repo:clone-probe', url),
    // options: { id, url, parent, name, branch, depth }
    clone: (options) => ipcRenderer.invoke('repo:clone', options),
    cloneCancel: (id) => ipcRenderer.invoke('repo:clone-cancel', id),
    onCloneProgress: (callback) => subscribe('clone:progress', callback),
    // Автообновление: следить за папкой репозитория (null — перестать)
    watch: (dir) => ipcRenderer.invoke('repo:watch', dir),
    onChanged: (callback) => subscribe('repo:changed', callback),
    getLast: () => ipcRenderer.invoke('repo:get-last'),
    load: (dir) => ipcRenderer.invoke('repo:load', dir),
    commitFiles: (dir, hash, parent) => ipcRenderer.invoke('repo:commit-files', dir, hash, parent),
    // params: { mode: 'commit'|'staged'|'unstaged'|'untracked', hash, parent, path, oldPath, ignoreWhitespace, conflicted }
    fileDiff: (dir, params) => ipcRenderer.invoke('repo:file-diff', dir, params),
    action: (dir, name, payload) => ipcRenderer.invoke('repo:action', dir, name, payload),
  },
});
