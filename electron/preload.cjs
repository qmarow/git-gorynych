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
  // Нативное меню macOS: интерфейс присылает пункты, клики приходят обратно
  menu: {
    set: (model) => ipcRenderer.send('menu:set', model),
    onInvoke: (callback) => subscribe('menu:invoke', callback),
  },
  tabs: {
    get: () => ipcRenderer.invoke('tabs:get'),
    save: (tabs, active) => ipcRenderer.invoke('tabs:save', tabs, active),
  },
  // Недавние репозитории — для страницы «Новая вкладка»
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    remove: (dir) => ipcRenderer.invoke('recent:remove', dir),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // Учётные данные для remote: секреты не возвращаются в интерфейс — только что сохранено
  creds: {
    describe: (dir, url) => ipcRenderer.invoke('creds:describe', dir, url),
    save: (dir, url, data) => ipcRenderer.invoke('creds:save', dir, url, data),
    clear: (dir, url) => ipcRenderer.invoke('creds:clear', dir, url),
    detectServer: (input) => ipcRenderer.invoke('creds:detect-server', input),
    checkUrl: (url) => ipcRenderer.invoke('creds:check-url', url),
    servers: () => ipcRenderer.invoke('creds:servers'),
    forgetLogin: (key) => ipcRenderer.invoke('creds:forget-login', key),
    forgetServer: (hostname) => ipcRenderer.invoke('creds:forget-server', hostname),
    setKind: (hostname, kind) => ipcRenderer.invoke('creds:set-kind', hostname, kind),
    sshKeys: () => ipcRenderer.invoke('creds:ssh-keys'),
    pickKey: () => ipcRenderer.invoke('creds:pick-key'),
    generateKey: (options) => ipcRenderer.invoke('creds:generate-key', options),
    keyDefaults: (dir, url, type) => ipcRenderer.invoke('creds:key-defaults', dir, url, type),
    switchToSsh: (dir) => ipcRenderer.invoke('creds:switch-to-ssh', dir),
    copyPublicKey: (keyPath) => ipcRenderer.invoke('creds:copy-public-key', keyPath),
  },
  // Папка репозитория: в системном файловом менеджере и в терминале
  openFolder: (dir) => ipcRenderer.invoke('shell:open-folder', dir),
  openTerminal: (dir) => ipcRenderer.invoke('shell:open-terminal', dir),
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
    lint: (dir, draft, opts) => ipcRenderer.invoke('gitlab:lint', dir, draft, opts),
    saveVariable: (dir, data, opts) => ipcRenderer.invoke('gitlab:variable-save', dir, data, opts),
    deleteVariable: (dir, v, opts) => ipcRenderer.invoke('gitlab:variable-delete', dir, v, opts),
    schedules: (dir, opts) => ipcRenderer.invoke('gitlab:schedules', dir, opts),
    saveSchedule: (dir, s, opts) => ipcRenderer.invoke('gitlab:schedule-save', dir, s, opts),
    scheduleAction: (dir, a, opts) => ipcRenderer.invoke('gitlab:schedule-action', dir, a, opts),
    // mr: { source, target, title, description, draft, removeSource }
    createMergeRequest: (dir, mr, opts) => ipcRenderer.invoke('gitlab:create-mr', dir, mr, opts),
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
    // drafts: { 'путь': 'текст' } — разбор черновиков без сохранения
    ciPreview: (dir, file, drafts) => ipcRenderer.invoke('repo:ci-preview', dir, file, drafts),
    ciDiff: (dir, draft) => ipcRenderer.invoke('repo:ci-diff', dir, draft),
    ciSave: (dir, draft) => ipcRenderer.invoke('repo:ci-save', dir, draft),
    ciCreate: (dir, opts) => ipcRenderer.invoke('repo:ci-create', dir, opts),
    ciEdit: (content, op) => ipcRenderer.invoke('repo:ci-edit', content, op),
    stashDetails: (dir, hash) => ipcRenderer.invoke('repo:stash-details', dir, hash),
    cloneProbe: (url) => ipcRenderer.invoke('repo:clone-probe', url),
    // options: { id, url, parent, name, branch, depth }
    clone: (options) => ipcRenderer.invoke('repo:clone', options),
    cloneCancel: (id) => ipcRenderer.invoke('repo:clone-cancel', id),
    onCloneProgress: (callback) => subscribe('clone:progress', callback),
    // Автообновление: следить за папкой репозитория (null — перестать)
    watch: (dir, opts) => ipcRenderer.invoke('repo:watch', dir, opts),
    onIndexSynced: (callback) => subscribe('repo:index-synced', callback),
    onChanged: (callback) => subscribe('repo:changed', callback),
    getLast: () => ipcRenderer.invoke('repo:get-last'),
    load: (dir) => ipcRenderer.invoke('repo:load', dir),
    commitFiles: (dir, hash, parent) => ipcRenderer.invoke('repo:commit-files', dir, hash, parent),
    // params: { mode: 'commit'|'staged'|'unstaged'|'untracked', hash, parent, path, oldPath, ignoreWhitespace, conflicted }
    fileDiff: (dir, params) => ipcRenderer.invoke('repo:file-diff', dir, params),
    compare: (dir, params) => ipcRenderer.invoke('repo:compare', dir, params),
    compareSearch: (dir, params) => ipcRenderer.invoke('repo:compare-search', dir, params),
    searchHistory: (dir, params) => ipcRenderer.invoke('repo:search-history', dir, params),
    gitflowConfig: (dir) => ipcRenderer.invoke('repo:gitflow-config', dir),
    fileHistory: (dir, params) => ipcRenderer.invoke('repo:file-history', dir, params),
    blame: (dir, params) => ipcRenderer.invoke('repo:blame', dir, params),
    commitInfo: (dir, params) => ipcRenderer.invoke('repo:commit-info', dir, params),
    rebasePreview: (dir, params) => ipcRenderer.invoke('repo:rebase-preview', dir, params),
    // rules: [{ id, label, pattern, flags, files, category }] — проверка staged-изменений перед коммитом
    guardScan: (dir, params) => ipcRenderer.invoke('repo:guard-scan', dir, params),
    // Лёгкая проверка сервера: ETag-запрос к API или ls-remote, fetch только если что-то изменилось
    remoteCheck: (dir) => ipcRenderer.invoke('repo:remote-check', dir),
    // params: { branch, direction: 'in'|'out', limit } → { commits, total, upstream }
    branchLog: (dir, params) => ipcRenderer.invoke('repo:branch-log', dir, params),
    // git config commit.template → null | { path, body, hint, error? }
    commitTemplate: (dir) => ipcRenderer.invoke('repo:commit-template', dir),
    action: (dir, name, payload) => ipcRenderer.invoke('repo:action', dir, name, payload),
  },
});
