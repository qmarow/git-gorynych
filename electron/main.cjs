const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.cjs');
const actions = require('./actions.cjs');
const gitInit = require('./init.cjs');
const cloner = require('./clone.cjs');
const { watchRepository } = require('./watch.cjs');
const { serializeError } = require('./errors.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;

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

/* ---------- Окно ---------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false, // кастомный заголовок, как в GitKraken
    backgroundColor: '#0e1117',
    show: false,
    autoHideMenuBar: true,
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
    writeSettings({ lastRepo: data.path });
    return data;
  }),
);
ipcMain.handle('repo:inspect', safe((dir) => gitInit.inspectFolder(dir)));
ipcMain.handle('repo:init', safe((dir, options) => gitInit.initRepository(dir, options)));
ipcMain.handle('repo:probe-remote', safe((dir, options) => gitInit.probeRemote(dir, options)));
ipcMain.handle('repo:connect', safe((dir, options) => gitInit.connectRepository(dir, options)));
ipcMain.handle('repo:status', safe((dir) => git.quickStatus(dir)));
ipcMain.handle('repo:stash-details', safe((dir, hash) => git.getStashDetails(dir, hash)));

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
  if (process.platform === 'win32') app.setAppUserModelId('com.ironxenot.gitkrakenclone');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
