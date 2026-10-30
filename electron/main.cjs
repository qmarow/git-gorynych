const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const git = require('./git.cjs');
const actions = require('./actions.cjs');
const gitInit = require('./init.cjs');
const cloner = require('./clone.cjs');
const ci = require('./ci.cjs');
const ciEdit = require('./ciEdit.cjs');
const gitlab = require('./gitlab.cjs');
const compare = require('./compare.cjs');
const fileHistory = require('./fileHistory.cjs');
const rebasePlan = require('./rebase.cjs');
const guard = require('./guard.cjs');
const { watchRepository } = require('./watch.cjs');
const remoteWatch = require('./remoteWatch.cjs');
const system = require('./system.cjs');
const indexSync = require('./indexSync.cjs');
const credentials = require('./credentials.cjs');
const { serializeError, GitError } = require('./errors.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;

/* ---------- Название и папка данных ---------- */

const APP_NAME = 'git-Горыныч';
app.setName(APP_NAME);
// Папка данных — латиницей: в ней лежат скрипты askpass, которые запускает git, а кириллица в пути
// на Windows ломает часть сборок Git/ssh. Задаём до первого обращения к userData.
if (!process.env.GK_TEST_USERDATA) app.setPath('userData', path.join(app.getPath('appData'), 'git-Gorynych'));

// После переименования один раз переносим настройки, токены GitLab, вкладки, фоны и состояние интерфейса
// из папки прежнего названия (GitIdea, а до него GitKraken Clone). Существующие файлы не перезаписываются,
// поэтому повторный запуск ничего не портит.
function migrateUserData() {
  const now = app.getPath('userData');
  const marker = path.join(now, '.migrated');
  if (fs.existsSync(marker)) return;
  for (const name of ['GitIdea', 'GitKraken Clone']) {
    const old = path.join(app.getPath('appData'), name);
    if (path.resolve(now) === path.resolve(old) || !fs.existsSync(old)) continue;
    try {
      fs.mkdirSync(now, { recursive: true });
      fs.cpSync(old, now, {
        recursive: true,
        force: false,
        errorOnExist: false,
        // файлы блокировки Chromium старого профиля не нужны
        filter: (src) => !/[\\/](lockfile|LOCK|SingletonLock|SingletonCookie|SingletonSocket)$/.test(src),
      });
      fs.writeFileSync(marker, `${name}\n${new Date().toISOString()}`);
      return;
    } catch (error) {
      console.warn(`Не удалось перенести настройки из ${name}:`, error.message);
    }
  }
}
migrateUserData();

/* ---------- Настройки (последний открытый репозиторий) ---------- */

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch (error) {
    console.error('Не удалось сохранить настройки:', error);
  }
}

/* ---------- Недавние репозитории (страница «Новая вкладка») ---------- */

const RECENT_MAX = 30;

/** Список недавних: свежие сверху, без дублей и без удалённых с диска папок */
function recentRepos() {
  const s = readSettings();
  let list = Array.isArray(s.recentRepos) ? s.recentRepos.filter((r) => r && typeof r.path === 'string') : [];
  // Первый запуск после обновления — берём то, что знали раньше: вкладки и последний репозиторий
  if (!list.length) {
    const seed = [...(Array.isArray(s.tabs) ? s.tabs : []), s.lastRepo].filter((p) => typeof p === 'string');
    list = [...new Set(seed)].map((p) => ({ path: p, name: path.basename(p), openedAt: null }));
  }
  const seen = new Set();
  return list
    .filter((r) => {
      const key = process.platform === 'win32' ? r.path.toLowerCase() : r.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return fs.existsSync(r.path);
    })
    .slice(0, RECENT_MAX)
    .map((r) => ({ path: r.path, name: r.name || path.basename(r.path), openedAt: r.openedAt ?? null }));
}

function rememberRecent(dir, name) {
  const same = (p) => (process.platform === 'win32' ? p.toLowerCase() === dir.toLowerCase() : p === dir);
  const list = recentRepos().filter((r) => !same(r.path));
  writeSettings({ recentRepos: [{ path: dir, name: name || path.basename(dir), openedAt: new Date().toISOString() }, ...list].slice(0, RECENT_MAX) });
}

ipcMain.handle('recent:list', () => recentRepos());
ipcMain.handle('recent:remove', (_event, dir) => {
  if (typeof dir !== 'string') return false;
  writeSettings({ recentRepos: recentRepos().filter((r) => r.path !== dir) });
  return true;
});

/* ---------- Оформление ---------- */

// Системный материал окна (Mica/Acrylic) есть в Windows 11 22H2+ (сборка 22621)
const supportsMaterial = () => process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 22621;
const BG_DIR = () => path.join(app.getPath('userData'), 'backgrounds');
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
const MAX_IMAGE = 25 * 1024 * 1024;

function storedImage() {
  try {
    const name = fs.readdirSync(BG_DIR()).find((f) => f.startsWith('current.'));
    return name ? path.join(BG_DIR(), name) : null;
  } catch {
    return null;
  }
}

function windowMaterial(appearance) {
  if (!supportsMaterial() || appearance?.background !== 'system') return null;
  return appearance.material === 'mica' ? 'mica' : 'acrylic';
}

// Светлая/тёмная схема для системных частей окна: Mica/Acrylic, меню, диалоги, полосы прокрутки
function applyNativeTheme(appearance) {
  const scheme = appearance?.scheme;
  nativeTheme.themeSource = scheme === 'light' ? 'light' : scheme === 'system' ? 'system' : 'dark';
}

function applyWindowMaterial(appearance) {
  applyNativeTheme(appearance);
  if (!mainWindow || process.platform !== 'win32' || !mainWindow.setBackgroundMaterial) return false;
  const material = windowMaterial(appearance);
  mainWindow.setBackgroundColor(material ? '#00000000' : appearance?.base || '#0e1117');
  mainWindow.setBackgroundMaterial(material ?? 'none');
  return Boolean(material);
}

/* ---------- Окно ---------- */

const IS_MAC = process.platform === 'darwin';

function createWindow() {
  const appearance = readSettings().appearance ?? {};
  const material = windowMaterial(appearance);
  applyNativeTheme(appearance);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // Windows/Linux — свой заголовок с кнопками окна (как в GitKraken).
    // macOS — нативный «светофор» поверх нашего заголовка, меню — в системной строке меню
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { frame: false }),
    backgroundColor: material ? '#00000000' : appearance.base || '#0e1117',
    ...(material ? { backgroundMaterial: material } : {}),
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'), // значок окна и панели задач (в .exe — build/icon.ico)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const sendMaximized = () =>
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);
  mainWindow.on('focus', () => mainWindow.webContents.send('window:focus'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
    // DevTools — по F12 или Ctrl+Shift+I (не открываем сами: они сыплют в консоль
    // безвредными ошибками "Autofill.enable wasn't found")
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const toggle =
        input.type === 'keyDown' &&
        (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'));
      if (toggle) {
        event.preventDefault();
        mainWindow.webContents.toggleDevTools();
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

/* ---------- Нативное меню macOS ---------- */

// Пункты (подписи, доступность, подсказки клавиш) строит интерфейс — у него вся логика и состояние.
// Здесь из них собирается системное меню; клик отправляется обратно: menu:invoke { menu, index }.
// Сочетания клавиш только показываются (registerAccelerator: false) — их обрабатывает сам интерфейс,
// иначе одно нажатие срабатывало бы дважды.
const MAC_ACCEL = { Ctrl: 'Cmd', Alt: 'Alt', Shift: 'Shift' };
function toAccelerator(hint) {
  if (typeof hint !== 'string' || !/^(?:(?:Ctrl|Alt|Shift)\+)*(?:[A-Za-z0-9,./]|F\d{1,2}|Tab|Enter)$/.test(hint)) return undefined;
  if (/^Ctrl\+(?:Shift\+)?Tab$/.test(hint)) return hint; // переключение вкладок на Mac — Control+Tab
  return hint
    .split('+')
    .map((k) => MAC_ACCEL[k] ?? k)
    .join('+');
}

function buildMacMenu(model) {
  const send = (menu, index, id = null) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('menu:invoke', { menu, index, id });
  const fromModel = (menuName, items = []) =>
    items.map((it, index) => {
      if (it.separator) return { type: 'separator' };
      if (it.header) return { label: it.header, enabled: false };
      const accelerator = toAccelerator(it.hint);
      return {
        label: it.label,
        enabled: !it.disabled,
        ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
        click: () => send(menuName, index, it.id ?? null),
      };
    });
  const m = model ?? {};
  const template = [
    {
      label: app.name,
      submenu: [
        model ? { label: `О программе ${APP_NAME}`, click: () => send(null, -1, 'about') } : { role: 'about' },
        { type: 'separator' },
        { label: 'Настройки…', accelerator: 'Cmd+,', registerAccelerator: false, enabled: Boolean(model), click: () => send(null, -1, 'settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Скрыть ${APP_NAME}` },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: `Завершить ${APP_NAME}` },
      ],
    },
    { label: 'Файл', submenu: fromModel('File', m.File) },
    {
      label: 'Правка',
      submenu: [
        ...fromModel('Edit', m.Edit),
        { type: 'separator' },
        // Системные пункты: без них на macOS не работают ⌘C / ⌘V / ⌘A в полях ввода
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выбрать всё' },
      ],
    },
    { label: 'Вид', submenu: [...fromModel('View', m.View), { type: 'separator' }, { role: 'togglefullscreen', label: 'Полноэкранный режим' }] },
    { label: 'Действия', submenu: fromModel('Actions', m.Actions) },
    { role: 'windowMenu', label: 'Окно' },
    { role: 'help', label: 'Справка', submenu: fromModel('Help', m.Help) },
  ];
  // Пустое подменю macOS не показывает — добавим заглушку
  for (const t of template) if (Array.isArray(t.submenu) && t.submenu.length === 0) t.submenu.push({ label: 'Нет действий', enabled: false });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let lastMenuJson = '';
ipcMain.on('menu:set', (_event, model) => {
  if (!IS_MAC) return;
  const json = JSON.stringify(model ?? {});
  if (json === lastMenuJson) return; // без изменений — не пересобираем
  lastMenuJson = json;
  try {
    buildMacMenu(model);
  } catch (error) {
    console.error('menu:set', error);
  }
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

/* ---------- Оформление: IPC ---------- */

ipcMain.handle('appearance:get', () => ({
  appearance: readSettings().appearance ?? null,
  supportsMaterial: supportsMaterial(),
  hasImage: Boolean(storedImage()),
}));
ipcMain.handle('appearance:set', (_event, value) => {
  if (!value || typeof value !== 'object') return false;
  writeSettings({ appearance: value });
  return applyWindowMaterial(value);
});
// Выбрать картинку для фона: копируем её к себе, чтобы не зависеть от исходного файла
ipcMain.handle('appearance:pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Картинка для фона',
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: Object.keys(IMAGE_TYPES).map((e) => e.slice(1)) }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const src = result.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  if (!IMAGE_TYPES[ext]) return { ok: false, error: { message: 'Этот формат не поддерживается' } };
  const size = fs.statSync(src).size;
  if (size > MAX_IMAGE) return { ok: false, error: { message: `Картинка слишком большая (${Math.round(size / 1048576)} МБ, максимум 25 МБ)` } };
  fs.mkdirSync(BG_DIR(), { recursive: true });
  for (const f of fs.readdirSync(BG_DIR())) if (f.startsWith('current.')) fs.rmSync(path.join(BG_DIR(), f), { force: true });
  fs.copyFileSync(src, path.join(BG_DIR(), `current${ext}`));
  return { ok: true, name: path.basename(src) };
});
// Картинка фона как data: URL (renderer не может читать файлы напрямую)
ipcMain.handle('appearance:image', () => {
  const file = storedImage();
  if (!file) return null;
  const mime = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
});

/* ---------- Git ---------- */

// Ошибки возвращаем объектом { code, message, hint, details }:
// иначе Electron оборачивает текст в "Error invoking remote method"
const safe = (fn) => async (_event, ...args) => {
  try {
    return { ok: true, data: await fn(...args) };
  } catch (error) {
    if (!(error && error.code)) console.error(error);
    return { ok: false, error: serializeError(error) };
  }
};

ipcMain.handle('repo:open-dialog', async (_event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: typeof title === 'string' ? title : 'Открыть Git-репозиторий',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('repo:get-last', () => {
  const last = readSettings().lastRepo;
  return last && fs.existsSync(last) ? last : null;
});

// Открытые вкладки: { tabs: [path], active: path }. Несуществующие папки отбрасываем.
ipcMain.handle('tabs:get', () => {
  const settings = readSettings();
  let tabs = Array.isArray(settings.tabs) ? settings.tabs.filter((p) => typeof p === 'string') : [];
  if (tabs.length === 0 && settings.lastRepo) tabs = [settings.lastRepo];
  tabs = [...new Set(tabs)].filter((p) => fs.existsSync(p));
  const active = tabs.includes(settings.activeTab) ? settings.activeTab : (tabs[0] ?? null);
  return { tabs, active };
});

ipcMain.handle('tabs:save', (_event, tabs, active) => {
  if (!Array.isArray(tabs) || tabs.some((p) => typeof p !== 'string')) return false;
  writeSettings({ tabs, activeTab: typeof active === 'string' ? active : null });
  return true;
});

ipcMain.handle(
  'repo:load',
  safe(async (dir) => {
    const data = await git.loadRepository(dir);
    data.history = actions.historySummary(data.path);
    data.ci = ci.detectCi(data.path);
    const current = data.localBranches.find((b) => b.name === data.currentBranch);
    data.forge = await gitlab.detectRemote(data.path, current?.upstreamRemote).catch(() => null);
    writeSettings({ lastRepo: data.path });
    rememberRecent(data.path, data.name);
    return data;
  }),
);
ipcMain.handle('repo:inspect', safe((dir) => gitInit.inspectFolder(dir)));
ipcMain.handle('repo:init', safe((dir, options) => gitInit.initRepository(dir, options)));
ipcMain.handle('repo:probe-remote', safe((dir, options) => gitInit.probeRemote(dir, options)));
ipcMain.handle('repo:connect', safe((dir, options) => gitInit.connectRepository(dir, options)));
// Открыть файл репозитория в программе по умолчанию (например, VS Code)
ipcMain.handle(
  'repo:open-path',
  safe(async (dir, rel) => {
    const root = await git.resolveRepoRoot(dir);
    const full = git.safeRelative(root, rel);
    const error = await shell.openPath(full);
    if (error) throw new Error(error);
    return { path: full };
  }),
);
ipcMain.handle(
  'repo:status',
  safe(async (dir) => {
    const status = await git.quickStatus(dir);
    status.ci = ci.detectCi(status.path); // мог появиться или исчезнуть файл CI
    return status;
  }),
);
// CI/CD: разбор файлов конфигурации из репозитория (только чтение)
// Правка CI: живой предпросмотр по черновикам, diff, сохранение, визуальные правки, файл из шаблона
const ciRoot = (fn) => safe(async (dir, ...args) => fn(await git.resolveRepoRoot(dir), ...args));
ipcMain.handle('repo:ci-preview', ciRoot((root, file, drafts) => ci.previewCi(root, typeof file === 'string' ? file : null, drafts)));
ipcMain.handle('repo:ci-diff', ciRoot((root, draft) => ciEdit.diffDraft(root, draft ?? {})));
ipcMain.handle('repo:ci-save', ciRoot((root, draft) => ciEdit.saveFile(root, draft ?? {})));
ipcMain.handle('repo:ci-create', ciRoot((root, opts) => ciEdit.createFromTemplate(root, opts ?? {})));
ipcMain.handle('repo:ci-edit', safe((content, op) => ciEdit.applyEdit(content, op)));
ipcMain.handle(
  'repo:ci',
  safe(async (dir, file) => ci.loadCi(await git.resolveRepoRoot(dir), typeof file === 'string' ? file : null)),
);
ipcMain.handle('repo:stash-details', safe((dir, hash) => git.getStashDetails(dir, hash)));

// GitLab API: токен хранится и используется только здесь, в main-процессе
const gl = (fn) => safe(async (dir, ...args) => fn(await git.resolveRepoRoot(dir), ...args));
const remoteOpt = (opts) => ({ preferredRemote: typeof opts?.remote === 'string' ? opts.remote : undefined });
ipcMain.handle('gitlab:status', gl((root, opts) => gitlab.detectRemote(root, remoteOpt(opts).preferredRemote)));
ipcMain.handle('gitlab:set-token', gl((root, token, opts) => gitlab.setToken(root, token, remoteOpt(opts).preferredRemote, { alsoForGit: Boolean(opts?.alsoForGit) })));
ipcMain.handle('gitlab:clear-token', gl((root, opts) => gitlab.clearToken(root, remoteOpt(opts).preferredRemote)));
ipcMain.handle('gitlab:pipelines', gl((root, opts) => gitlab.listPipelines(root, { ref: opts?.ref, ...remoteOpt(opts) })));
ipcMain.handle('gitlab:pipeline', gl((root, id, opts) => gitlab.pipelineDetail(root, id, remoteOpt(opts))));
ipcMain.handle('gitlab:job-log', gl((root, id, opts) => gitlab.jobLog(root, id, remoteOpt(opts))));
ipcMain.handle('gitlab:action', gl((root, action, opts) => gitlab.runPipelineAction(root, action, remoteOpt(opts))));
ipcMain.handle('gitlab:variables', gl((root, opts) => gitlab.listVariables(root, remoteOpt(opts))));
ipcMain.handle('gitlab:variable-value', gl((root, v, opts) => gitlab.variableValue(root, v, remoteOpt(opts))));
ipcMain.handle('gitlab:runners', gl((root, opts) => gitlab.listRunners(root, remoteOpt(opts))));
ipcMain.handle('gitlab:lint', gl((root, draft, opts) => gitlab.lintCi(root, draft ?? {}, remoteOpt(opts))));
ipcMain.handle('gitlab:variable-save', gl((root, data, opts) => gitlab.saveVariable(root, data ?? {}, remoteOpt(opts))));
ipcMain.handle('gitlab:variable-delete', gl((root, v, opts) => gitlab.deleteVariable(root, v ?? {}, remoteOpt(opts))));
ipcMain.handle('gitlab:schedules', gl((root, opts) => gitlab.listSchedules(root, remoteOpt(opts))));
ipcMain.handle('gitlab:schedule-save', gl((root, s, opts) => gitlab.saveSchedule(root, s ?? {}, remoteOpt(opts))));
ipcMain.handle('gitlab:schedule-action', gl((root, a, opts) => gitlab.scheduleAction(root, a ?? {}, remoteOpt(opts))));
ipcMain.handle('gitlab:create-mr', gl((root, mr, opts) => gitlab.createMergeRequest(root, mr ?? {}, remoteOpt(opts))));
// Открыть ссылку (пайплайн/задание в GitLab) в браузере — только http(s)
ipcMain.handle('shell:open-external', async (_event, url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    await shell.openExternal(u.toString());
    return true;
  } catch {
    return false;
  }
});

/* ---------- Авторизация на remote-сервере: логин/пароль, токен, SSH-ключ ---------- */

// Адрес, к которому нужен доступ: явный url (клонирование) или remote текущей ветки репозитория
async function credTarget(dir, url) {
  if (typeof url === 'string' && url.trim()) return { url: url.trim(), remote: null };
  const root = await git.resolveRepoRoot(dir);
  // Тот же remote, что и у Pull/Push: upstream текущей ветки, иначе origin, иначе первый
  const remotes = (await git.git(root, ['remote']).catch(() => '')).split('\n').map((r) => r.trim()).filter(Boolean);
  const branch = (await git.git(root, ['branch', '--show-current']).catch(() => '')).trim();
  const upstream = branch
    ? (await git.git(root, ['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`]).catch(() => '')).trim()
    : '';
  const remote = remotes.includes(upstream) ? upstream : remotes.includes('origin') ? 'origin' : remotes[0];
  if (remote) {
    const raw = (await git.git(root, ['remote', 'get-url', remote]).catch(() => '')).trim();
    if (raw) return { url: raw, remote };
  }
  throw new GitError('У репозитория нет remote', { code: 'NO_REMOTE' });
}
// Вход привязан к репозиторию: описание — по адресу remote (или ссылке для клонирования)
const describeTarget = async (dir, url) => {
  let t;
  try {
    t = await credTarget(dir, url);
  } catch (error) {
    // У репозитория нет remote — окно входа предложит указать, где он хранится
    if (error.code === 'NO_REMOTE' && dir && !url) return { noRemote: true, remote: null, url: null, protocol: 'https', host: null, hostname: null, saved: null, kind: null, cloud: false };
    throw error;
  }
  const info = credentials.describe(t.url);
  // Пайплайны (API GitLab) работают от этой же авторизации — состояние последней проверки, без сети
  const api = info.kind === 'gitlab' && info.repoPath ? apiState(info) : null;
  return { ...info, remote: t.remote, noRemote: false, defaultTokenUser: credentials.defaultTokenUser(info.host), api };
};
function apiState(info) {
  try {
    const st = gitlab.loginApiState(info.hostname, info.repoPath, info.base);
    if (st) return st;
    const login = credentials.apiLoginFor(info.hostname, info.repoPath);
    return login.repo ? { state: null } : login.other ? { state: 'none', method: login.other.method } : null;
  } catch {
    return null;
  }
}
ipcMain.handle('creds:describe', safe((dir, url) => describeTarget(dir, url)));
ipcMain.handle(
  'creds:save',
  safe(async (dir, url, data) => {
    const opts = data ?? {};
    // В окне входа выбрали другой сервер / адрес — сначала меняем (или добавляем) remote репозитория
    let remoteChange = null;
    if (dir && !url && opts.remoteUrl) {
      const next = String(opts.remoteUrl).trim();
      if (!credentials.parseTarget(next).host || !credentials.repoKeyOf(next)) {
        throw new GitError('Укажите полный адрес репозитория', { code: 'BAD_ARGS', hint: 'Например: https://gitlab.company.ru/group/project.git' });
      }
      const root = await git.resolveRepoRoot(dir);
      const cur = await credTarget(dir, null).catch(() => null);
      // Сначала вход (он проверяет данные) — с ошибкой в пароле remote не меняется
      const { remoteUrl, ...rest } = opts;
      credentials.save(next, rest);
      if (!cur) {
        await git.git(root, ['remote', 'add', 'origin', next]);
        remoteChange = { remote: 'origin', from: null, to: next };
      } else if (cur.url !== next) {
        await git.git(root, ['remote', 'set-url', cur.remote, next]);
        remoteChange = { remote: cur.remote, from: cur.url, to: next };
      }
    }
    if (!(dir && !url && opts.remoteUrl)) {
      const t = await credTarget(dir, url);
      const { remoteUrl, ...rest } = opts;
      credentials.save(t.url, rest);
    }
    const described = await describeTarget(dir, url);
    // Та же авторизация — для пайплайнов: сразу проверяем, принимает ли её API GitLab
    if (described.kind === 'gitlab' && described.repoPath) {
      described.api = await gitlab.checkLoginApi(described.hostname, described.repoPath, described.base).catch(() => null);
    }
    return { ...described, remoteChange };
  }),
);
ipcMain.handle('creds:clear', safe(async (dir, url) => credentials.clear((await credTarget(dir, url)).url)));
// Проверить доступ к репозиторию по адресу (git ls-remote с сохранённым входом) — для репозиториев, которые сейчас не открыты
ipcMain.handle(
  'creds:check-url',
  safe(async (url) => {
    if (!credentials.repoKeyOf(url)) throw new GitError('Укажите адрес репозитория', { code: 'BAD_ARGS' });
    const opts = await actions.networkOptions(os.homedir(), { url });
    await git.git(os.homedir(), ['ls-remote', '--heads', '--', url], { ...opts, timeout: 60000 });
    return { ok: true };
  }),
);
// Серверы и привязанные к ним репозитории; тип своего сервера (GitLab / GitHub Enterprise / Gitea…) по домену
ipcMain.handle('creds:detect-server', safe((input) => credentials.detectServer(input)));
ipcMain.handle('creds:servers', safe(() => serversWithCi()));
ipcMain.handle(
  'creds:forget-login',
  safe((key) => {
    if (String(key).startsWith('ci:')) return gitlab.forgetToken(key);
    // Авторизация одна: вместе со входом репозитория забываем и его старый отдельный токен CI/CD
    const row = credentials.listServers().flatMap((srv) => srv.repos.map((r) => ({ ...r, hostname: srv.hostname }))).find((r) => r.key === key);
    if (row) gitlab.forgetRepoToken(row.hostname, row.path);
    return credentials.forgetLogin(key);
  }),
);
ipcMain.handle(
  'creds:forget-server',
  safe((hostname) => {
    const a = credentials.forgetServer(hostname);
    const b = gitlab.forgetHost(hostname);
    return { removed: a.removed || b.removed };
  }),
);

/**
 * Серверы и репозитории; для GitLab — работают ли пайплайны от авторизации репозитория (ci: { state, reason, … }).
 * Старые отдельные токены CI/CD (до объединения авторизации) показываются при своём репозитории или отдельной строкой.
 */
function serversWithCi() {
  const servers = credentials.listServers();
  const tokens = gitlab.listTokens();
  const byHost = new Map(servers.map((s) => [s.hostname, s]));
  const serverFor = (hostname, base) => {
    if (!byHost.has(hostname)) {
      const kind = credentials.serverKind(hostname);
      const srv = { hostname, base, repos: [], shared: [], kind: kind ?? 'gitlab', cloud: hostname === 'gitlab.com', kindSaved: Boolean(kind) };
      byHost.set(hostname, srv);
      servers.push(srv);
    }
    return byHost.get(hostname);
  };
  for (const srv of servers) {
    if (srv.kind !== 'gitlab') continue;
    for (const r of srv.repos) {
      const st = gitlab.loginApiState(srv.hostname, r.path, srv.base);
      const usable = r.method === 'token' || r.hasApiToken;
      r.ci = { source: usable ? 'login' : null, state: st?.state ?? (usable ? null : 'none'), reason: st?.reason ?? null, user: st?.user ?? null, scopes: st?.scopes ?? null, viaApiToken: Boolean(r.hasApiToken) };
    }
  }
  for (const t of tokens.repos) {
    if (!t.hostname) continue;
    const srv = serverFor(t.hostname, t.base);
    const rows = srv.repos.filter((r) => r.path.toLowerCase() === t.path.toLowerCase());
    if (rows.length) for (const r of rows) r.ci = { ...(r.ci ?? {}), legacy: { key: t.key, user: t.user, scopes: t.scopes } };
    else srv.repos.push({ key: t.key, url: t.url, path: t.path, protocol: 'ci', ciOnly: true, ci: { source: 'legacy', user: t.user, scopes: t.scopes, readable: t.readable } });
  }
  for (const t of tokens.shared) {
    if (!t.hostname) continue;
    const srv = serverFor(t.hostname, t.base);
    srv.sharedCi = [...(srv.sharedCi ?? []), t];
  }
  for (const srv of servers) srv.repos.sort((x, y) => x.path.localeCompare(y.path));
  return servers;
}

ipcMain.handle(
  'creds:set-kind',
  safe((hostname, kind) => {
    credentials.setServer(hostname, { kind });
    return { kind: credentials.serverKind(hostname) };
  }),
);
ipcMain.handle('creds:ssh-keys', safe(() => credentials.listSshKeys()));
ipcMain.handle('creds:pick-key', async () => {
  const { dir } = credentials.listSshKeys();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Приватный SSH-ключ',
    defaultPath: fs.existsSync(dir) ? dir : os.homedir(),
    properties: ['openFile', 'showHiddenFiles'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
// Подсказки для формы нового ключа: имя файла и email автора из git config — как комментарий ключа
ipcMain.handle(
  'creds:key-defaults',
  safe(async (dir, url, type) => {
    const t = url ? credentials.parseTarget(url) : credentials.parseTarget((await credTarget(dir, null).catch(() => ({ url: '' }))).url);
    const root = dir ? await git.resolveRepoRoot(dir).catch(() => null) : null;
    const email = (await git.git(root ?? os.homedir(), ['config', 'user.email']).catch(() => '')).trim();
    return { name: credentials.suggestKeyName(type === 'rsa' ? 'rsa' : 'ed25519', t.hostname), comment: email || null, dir: credentials.listSshKeys().dir };
  }),
);
ipcMain.handle(
  'creds:generate-key',
  safe(async (options) => {
    const res = await credentials.generateSshKey({ ...(options ?? {}), gitBinary: git.gitInfo?.().binary });
    clipboard.writeText(res.publicKey);
    return { ...res, copied: true };
  }),
);
// Перевести remote с https:// на SSH (git@host:path.git), чтобы входить по ключу
ipcMain.handle(
  'creds:switch-to-ssh',
  safe(async (dir) => {
    const t = await credTarget(dir, null);
    const next = credentials.sshUrlFor(t.url);
    if (!next || !t.remote) throw new GitError('Адрес remote уже не https:// — менять нечего', { code: 'BAD_ARGS' });
    const root = await git.resolveRepoRoot(dir);
    await git.git(root, ['remote', 'set-url', t.remote, next]);
    return { remote: t.remote, from: t.url, to: next, target: await describeTarget(dir, null) };
  }),
);
ipcMain.handle(
  'creds:copy-public-key',
  safe((keyPath) => {
    const key = credentials.publicKeyOf(keyPath);
    if (!key) throw new GitError('Рядом с ключом нет файла .pub', { code: 'NOT_FOUND' });
    clipboard.writeText(key);
    return { publicKey: key };
  }),
);

// Папка репозитория в Проводнике / Finder и в терминале
ipcMain.handle('shell:open-folder', safe((dir) => system.openFolder(shell, dir)));
ipcMain.handle('shell:open-terminal', safe((dir) => system.openTerminal(dir)));

// Клонирование: прогресс приходит событиями clone:progress { id, phase, percent, speed, size }
ipcMain.handle('repo:clone-probe', safe((url) => cloner.probeClone(url)));
ipcMain.handle('repo:clone', (event, options) =>
  safe(() =>
    cloner.cloneRepository(options, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('clone:progress', { id: options?.id, ...progress });
    }),
  )(event),
);
ipcMain.handle('repo:clone-cancel', (_event, id) => cloner.cancelClone(id));

// Автообновление: следим за активным репозиторием и сообщаем об изменениях
const watchers = new Map(); // webContents.id -> stop()
ipcMain.handle('repo:watch', (event, dir, opts) => {
  const key = event.sender.id;
  watchers.get(key)?.();
  watchers.delete(key);
  if (typeof dir !== 'string' || !dir || !fs.existsSync(dir)) return false;
  const send = (channel, data) => !event.sender.isDestroyed() && event.sender.send(channel, data);
  // Синхронизация индекса с правками из внешних программ (откат в IDE и т.п.)
  const doSync = Boolean(opts?.syncIndex);
  let root = null;
  let stopped = false;
  const sync = async (act) => {
    root = root ?? (await git.resolveRepoRoot(dir).catch(() => null));
    if (!root) return null;
    // Репозиторий занят (действие пользователя или фоновая проверка сервера) — пробуем чуть позже
    for (let attempt = 0; attempt < 12 && !stopped; attempt++) {
      const res = await indexSync.syncIndex(root, { act }).catch(() => ({ synced: [] }));
      if (res) return res;
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  };
  if (doSync) sync(false); // запомнить исходное состояние индекса
  // Короткая задержка: правки файлов видны почти сразу, но пачка событий при сохранении склеивается
  const stopWatch = watchRepository(
    dir,
    async (what) => {
      if (doSync) {
        const res = await sync(Boolean(what.worktree));
        if (res?.synced?.length) send('repo:index-synced', { path: dir, synced: res.synced });
      }
      send('repo:changed', { path: dir, ...what });
    },
    { delay: 120 },
  );
  const stop = () => {
    stopped = true;
    stopWatch();
  };
  watchers.set(key, stop);
  event.sender.once('destroyed', () => {
    watchers.get(key)?.();
    watchers.delete(key);
  });
  return true;
});

ipcMain.handle('repo:commit-files', safe((dir, hash, parent) => git.getCommitFiles(dir, hash, parent)));
ipcMain.handle('repo:file-diff', safe((dir, params) => git.getFileDiff(dir, params)));
ipcMain.handle('repo:compare', safe((dir, params) => compare.compareCommits(dir, params)));
ipcMain.handle('repo:compare-search', safe((dir, params) => compare.searchChanges(dir, params)));
ipcMain.handle('repo:search-history', safe((dir, params) => compare.searchHistory(dir, params ?? {})));
// История файла (через переименования), построчное авторство и коммит для поповера
ipcMain.handle('repo:file-history', safe((dir, params) => fileHistory.fileHistory(dir, params ?? {})));
ipcMain.handle('repo:blame', safe((dir, params) => fileHistory.blame(dir, params ?? {})));
ipcMain.handle('repo:commit-info', safe((dir, params) => fileHistory.commitInfo(dir, params ?? {})));
// Настройки git flow репозитория (git flow init): приписки веток и основные ветки
ipcMain.handle(
  'repo:gitflow-config',
  safe(async (dir) => {
    const root = await git.resolveRepoRoot(dir);
    const out = await git.git(root, ['config', '--get-regexp', '^gitflow\\.']).catch(() => '');
    const cfg = { prefixes: {}, develop: null, master: null, configured: false };
    for (const line of out.split('\n')) {
      const m = /^gitflow\.(prefix\.(\w+)|branch\.(\w+))\s+(.*)$/.exec(line.trim());
      if (!m) continue;
      cfg.configured = true;
      if (m[2]) cfg.prefixes[m[2]] = m[4].trim();
      else if (m[3] === 'develop') cfg.develop = m[4].trim();
      else if (m[3] === 'master' || m[3] === 'main') cfg.master = m[4].trim();
    }
    return cfg;
  }),
);
ipcMain.handle('repo:rebase-preview', safe((dir, params) => rebasePlan.simulate(dir, params)));
ipcMain.handle('repo:guard-scan', safe((dir, params) => guard.scanStaged(dir, params ?? {})));
// Фоновая лёгкая проверка сервера (fetch только при изменениях) и коммиты для бейджей ↓/↑ веток
ipcMain.handle('repo:remote-check', safe(async (dir) => remoteWatch.lightCheck(await git.resolveRepoRoot(dir))));
ipcMain.handle('repo:branch-log', safe(async (dir, params) => git.branchLog(await git.resolveRepoRoot(dir), params ?? {})));
ipcMain.handle('repo:commit-template', safe(async (dir) => git.readCommitTemplate(await git.resolveRepoRoot(dir))));

// Все изменяющие и сетевые операции: checkAccess, fetch, pull, push, checkout,
// createBranch, stash, stashPop, commit, stage, unstage, undo, redo, abort/continueOperation
ipcMain.handle(
  'repo:action',
  safe(async (dir, name, payload) => {
    const root = await git.resolveRepoRoot(dir);
    return actions.runAction(root, name, payload);
  }),
);

/* ---------- Автоперезапуск в режиме разработки ---------- */

// Работает только при запуске через npm run electron:dev (scripts/dev-electron.cjs)
if (DEV_SERVER_URL && process.env.GK_DEV_RESTART === '1') {
  let timer = null;
  fs.watch(__dirname, (_event, file) => {
    if (!file || !file.endsWith('.cjs')) return;
    clearTimeout(timer);
    timer = setTimeout(() => app.exit(100), 400); // 100 = «перезапусти меня»
  });
}

/* ---------- Жизненный цикл ---------- */

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.ironxenot.gitgorynych');
  if (IS_MAC) buildMacMenu(null); // до загрузки интерфейса — системные пункты; дальше меню присылает интерфейс
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
