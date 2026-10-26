const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
const rebasePlan = require('./rebase.cjs');
const guard = require('./guard.cjs');
const { watchRepository } = require('./watch.cjs');
const { serializeError } = require('./errors.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;

/* ---------- Переименование GitKraken Clone → GitIdea ---------- */

// Electron хранит данные в папке с названием программы. После переименования один раз переносим
// из старой папки настройки, токены GitLab, вкладки, фоны и состояние интерфейса. Существующие файлы
// не перезаписываются, поэтому повторный запуск ничего не портит.
function migrateUserData() {
  try {
    const now = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'GitKraken Clone');
    const marker = path.join(now, '.migrated-from-gitkraken-clone');
    if (path.resolve(now) === path.resolve(old) || !fs.existsSync(old) || fs.existsSync(marker)) return;
    fs.mkdirSync(now, { recursive: true });
    fs.cpSync(old, now, {
      recursive: true,
      force: false,
      errorOnExist: false,
      // файлы блокировки Chromium старого профиля не нужны
      filter: (src) => !/[\\/](lockfile|LOCK|SingletonLock|SingletonCookie|SingletonSocket)$/.test(src),
    });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (error) {
    console.warn('Не удалось перенести настройки из GitKraken Clone:', error.message);
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

function applyWindowMaterial(appearance) {
  if (!mainWindow || process.platform !== 'win32' || !mainWindow.setBackgroundMaterial) return false;
  const material = windowMaterial(appearance);
  mainWindow.setBackgroundColor(material ? '#00000000' : appearance?.base || '#0e1117');
  mainWindow.setBackgroundMaterial(material ?? 'none');
  return Boolean(material);
}

/* ---------- Окно ---------- */

function createWindow() {
  const appearance = readSettings().appearance ?? {};
  const material = windowMaterial(appearance);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false, // кастомный заголовок, как в GitKraken
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
ipcMain.handle('gitlab:set-token', gl((root, token, opts) => gitlab.setToken(root, token, remoteOpt(opts).preferredRemote)));
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
ipcMain.handle('repo:watch', (event, dir) => {
  const key = event.sender.id;
  watchers.get(key)?.();
  watchers.delete(key);
  if (typeof dir !== 'string' || !dir || !fs.existsSync(dir)) return false;
  // Короткая задержка: правки файлов видны почти сразу, но пачка событий при сохранении склеивается
  const stop = watchRepository(
    dir,
    (what) => {
      if (!event.sender.isDestroyed()) event.sender.send('repo:changed', { path: dir, ...what });
    },
    { delay: 120 },
  );
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
ipcMain.handle('repo:rebase-preview', safe((dir, params) => rebasePlan.simulate(dir, params)));
ipcMain.handle('repo:guard-scan', safe((dir, params) => guard.scanStaged(dir, params ?? {})));

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
  if (process.platform === 'win32') app.setAppUserModelId('com.ironxenot.gitidea');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
