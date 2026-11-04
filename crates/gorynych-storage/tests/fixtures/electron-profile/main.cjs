// Создаёт профиль 1.x настоящим Electron во временной папке: настоящие safeStorage, Local State и LevelDB.
// Запускается тестом tests/electron_migration.rs. Настоящий профиль пользователя не затрагивается.
const { app, safeStorage, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const profile = process.argv.at(-1);
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const enc = (text) => ({ enc: safeStorage.encryptString(text).toString('base64') });
const write = (file, value) => fs.writeFileSync(path.join(profile, file), JSON.stringify(value, null, 2));

app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage недоступен');
  write('language.json', { language: 'en' });
  write('settings.json', {
    lastRepo: 'C:/repo',
    tabs: ['C:/repo', 'C:/other'],
    activeTab: 'C:/other',
    recentRepos: [{ path: 'C:/repo', name: 'Репозиторий', openedAt: '2026-01-02T03:04:05.678Z' }],
    appearance: { theme: 'kraken', background: 'glow', transparency: 50, blur: 18, motion: true, imageBlur: 8, imageDim: 45, hasImage: false, material: 'acrylic', base: '#0e1117', scheme: 'dark' },
  });
  write('cicd-settings.json', { repos: { 'gitlab.x/a/b': { provider: 'gitlab', apiBase: 'https://gitlab.x/api', savedAt: '2026-01-02T00:00:00.000Z' } } });
  write('remote-credentials.json', {
    hosts: { 'https://shared.x': { method: 'token', username: 'oauth2', secret: enc('host-токен') } },
    repos: {
      'https://gitlab.x/a/b': { method: 'password', url: 'https://gitlab.x/a/b.git', username: 'пользователь', secret: enc('пароль с пробелом 🔑'), apiToken: enc('glpat-пайплайн'), savedAt: '2026-01-02T00:00:00.000Z' },
      'ssh://gitlab.x/a/c': { method: 'ssh', url: 'git@gitlab.x:a/c.git', keyPath: 'C:/keys/id', passphrase: enc('пароль ключа') },
      // Чужой шифротекст: как запись другого пользователя Windows
      'https://gitlab.x/a/d': { method: 'token', url: 'https://gitlab.x/a/d', username: 'u', secret: { enc: Buffer.concat([Buffer.from('v10'), Buffer.alloc(40, 7)]).toString('base64') } },
    },
    servers: { 'gitlab.x': { kind: 'gitlab', base: 'https://gitlab.x', savedAt: '2026-01-02T00:00:00.000Z' } },
  });
  write('gitlab-tokens.json', { hosts: { 'https://gitlab.x': enc('ci-сервер') }, repos: { 'https://gitlab.x/a/b': enc('ci-репозиторий') } });
  fs.mkdirSync(path.join(profile, 'backgrounds'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'backgrounds', 'current.png'), 'картинка');

  const page = path.join(profile, 'blank.html');
  fs.writeFileSync(page, '<!doctype html><title>x</title>');
  const win = new BrowserWindow({ show: false });
  await win.loadFile(page);
  await win.webContents.executeJavaScript(`
    localStorage.setItem('pullMode', 'rebase');
    localStorage.setItem('latin', 'plain ascii');
    localStorage.setItem('clone.parent', 'C:\\\\Проекты');
    localStorage.setItem('width:sidebar', '320');
    localStorage.setItem('длинный', 'я'.repeat(20000));
    localStorage.setItem('удалён', 'x');
    localStorage.removeItem('удалён');
    localStorage.setItem('изменён', 'старое');
    localStorage.setItem('изменён', 'новое');
    localStorage.setItem('guard.v1', JSON.stringify({ enabled: true, rules: [{ id: 'r', pattern: 'секрет' }] }));
    localStorage.setItem('actions.v1', JSON.stringify([{ id: 'a1', name: 'Убрать ветку', icon: 'Trash2', steps: [{ id: 's1', type: 'pull', params: { mode: 'ff-only' } }, { id: 's2', type: 'push', params: { force: false } }], hotkey: 'Ctrl+K', toolbar: false }]));
    true`);
  // Chromium сбрасывает localStorage на диск с задержкой
  await new Promise((resolve) => setTimeout(resolve, 1500));
  win.destroy();
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.writeFileSync(path.join(profile, 'done'), process.versions.electron);
  app.quit();
});
