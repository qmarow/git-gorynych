// Учётные данные для remote-серверов: логин/пароль, токен или SSH-ключ — с привязкой к хосту.
//
// Секреты (пароль, токен, пароль ключа) шифруются Electron safeStorage (DPAPI / Связка ключей / keyring)
// и никогда не уходят в renderer. Git получает их без интерактивных окон:
//  - HTTPS: через переменные окружения GIT_CONFIG_* добавляется credential helper только для этого хоста
//    (credential.https://host.helper). Пустое значение перед ним сбрасывает остальные helpers
//    (Git Credential Manager и т.п.) — для этого хоста отвечаем только мы.
//  - SSH: GIT_SSH_COMMAND с -i <ключ>; пароль ключа отдаёт askpass-скрипт (SSH_ASKPASS_REQUIRE=force).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { GitError } = require('./errors.cjs');

let electron = null;
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object') electron = mod;
} catch {
  electron = null;
}

const METHODS = new Set(['password', 'token', 'ssh']);

/* =================== Хранилище =================== */

function userDataDir() {
  const dir = process.env.GK_TEST_USERDATA || electron?.app?.getPath('userData');
  if (!dir) throw new GitError('Хранилище настроек недоступно', { code: 'NO_STORAGE' });
  return dir;
}
const storeFile = () => path.join(userDataDir(), 'remote-credentials.json');

function readStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return data && typeof data.hosts === 'object' ? data : { hosts: {} };
  } catch {
    return { hosts: {} };
  }
}

function writeStore(store) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function encrypt(text) {
  const ss = electron?.safeStorage;
  if (ss?.isEncryptionAvailable()) return { enc: ss.encryptString(text).toString('base64') };
  if (process.env.GK_TEST_USERDATA) return { plain: Buffer.from(text).toString('base64') }; // только для тестов
  throw new GitError('Шифрование недоступно в системе — данные нельзя сохранить безопасно', { code: 'NO_ENCRYPTION' });
}

function decrypt(entry) {
  if (!entry) return null;
  try {
    if (entry.enc && electron?.safeStorage) return electron.safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    if (entry.plain && process.env.GK_TEST_USERDATA) return Buffer.from(entry.plain, 'base64').toString('utf8');
  } catch {
    return null; // зашифровано под другим пользователем системы — нужно ввести заново
  }
  return null;
}

/* =================== Адрес remote → хост =================== */

/**
 * → { protocol: 'https' | 'ssh' | 'local', scheme: 'https' | 'http' | null, host (с портом для https), hostname, user }
 */
function parseTarget(url) {
  const raw = String(url ?? '').trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return {
        protocol: 'https',
        scheme: u.protocol.slice(0, -1).toLowerCase(),
        host: u.host.toLowerCase(),
        hostname: u.hostname.toLowerCase(),
        user: decodeURIComponent(u.username || '') || null,
        url: `${u.protocol}//${u.host}${u.pathname}`,
      };
    } catch {
      return { protocol: 'https', scheme: 'https', host: null, hostname: null, user: null, url: raw };
    }
  }
  const ssh = /^ssh:\/\/(?:([^@/]+)@)?([^:/]+)(?::(\d+))?/i.exec(raw);
  if (ssh) return { protocol: 'ssh', scheme: null, host: ssh[2].toLowerCase(), hostname: ssh[2].toLowerCase(), user: ssh[1] ?? null, url: raw };
  const scp = /^(?:([^@/\\]+)@)?([^:/\\]+):(?!\/\/)/.exec(raw);
  if (scp && scp[2].length > 1) return { protocol: 'ssh', scheme: null, host: scp[2].toLowerCase(), hostname: scp[2].toLowerCase(), user: scp[1] ?? null, url: raw };
  return { protocol: 'local', scheme: null, host: null, hostname: null, user: null, url: raw };
}

/** Ключ записи в хранилище: для HTTPS — host с портом, для SSH — имя хоста */
const keyOf = (t) => (t.protocol === 'https' ? `${t.scheme}://${t.host}` : `ssh://${t.hostname}`);

/** Что сохранено для адреса — без секретов (для интерфейса) */
function describe(url) {
  const t = parseTarget(url);
  if (!t.host) return { ...t, saved: null };
  const entry = readStore().hosts[keyOf(t)] ?? null;
  return {
    ...t,
    saved: entry
      ? {
          method: entry.method,
          username: entry.username ?? null,
          keyPath: entry.keyPath ?? null,
          hasSecret: Boolean(entry.secret),
          hasPassphrase: Boolean(entry.passphrase),
          savedAt: entry.savedAt ?? null,
          readable: entry.method === 'ssh' ? !entry.passphrase || decrypt(entry.passphrase) !== null : decrypt(entry.secret) !== null,
        }
      : null,
  };
}

/** Логин по умолчанию для токена: GitLab — oauth2, остальные (GitHub, Bitbucket…) — git */
function defaultTokenUser(host) {
  return /gitlab/i.test(host ?? '') ? 'oauth2' : 'git';
}

/**
 * Сохранить данные для адреса.
 * data: { method, username, secret (пароль/токен), keyPath, passphrase }
 * Пустой secret/passphrase при уже сохранённом значении — оставить прежнее.
 */
function save(url, data = {}) {
  const t = parseTarget(url);
  if (!t.host) throw new GitError('Для локального адреса учётные данные не нужны', { code: 'BAD_ARGS' });
  const method = data.method;
  if (!METHODS.has(method)) throw new GitError('Не выбран способ входа', { code: 'BAD_ARGS' });
  if (method !== 'ssh' && t.protocol !== 'https') {
    throw new GitError('Логин/пароль и токен работают только для адресов https://', {
      code: 'BAD_ARGS',
      hint: 'Адрес remote — SSH. Выберите вкладку «SSH-ключ» или смените адрес remote на https://.',
    });
  }
  if (method === 'ssh' && t.protocol !== 'ssh') {
    throw new GitError('SSH-ключ работает только для адресов SSH (git@host:… или ssh://…)', {
      code: 'BAD_ARGS',
      hint: 'Адрес remote — https://. Войдите логином и паролем или токеном, либо смените адрес remote на SSH.',
    });
  }
  const store = readStore();
  const key = keyOf(t);
  const prev = store.hosts[key]?.method === method ? store.hosts[key] : null;
  const entry = { method, savedAt: new Date().toISOString() };

  if (method === 'password' || method === 'token') {
    const username = String(data.username ?? '').trim() || (method === 'token' ? defaultTokenUser(t.host) : '');
    if (!username) throw new GitError('Введите имя пользователя', { code: 'BAD_ARGS' });
    const secret = String(data.secret ?? '');
    if (!secret && !prev?.secret) throw new GitError(method === 'token' ? 'Введите токен' : 'Введите пароль', { code: 'BAD_ARGS' });
    if (/[\r\n]/.test(username) || /[\r\n]/.test(secret)) throw new GitError('Перевод строки в логине или пароле недопустим', { code: 'BAD_ARGS' });
    entry.username = username;
    entry.secret = secret ? encrypt(secret) : prev.secret;
  } else {
    const keyPath = String(data.keyPath ?? '').trim();
    if (!keyPath) throw new GitError('Выберите файл приватного ключа', { code: 'BAD_ARGS' });
    if (!fs.existsSync(keyPath)) throw new GitError('Файл ключа не найден', { code: 'BAD_ARGS', hint: keyPath });
    if (keyPath.endsWith('.pub')) throw new GitError('Это публичный ключ (.pub) — выберите приватный, без расширения', { code: 'BAD_ARGS' });
    entry.keyPath = keyPath;
    const passphrase = String(data.passphrase ?? '');
    if (passphrase) entry.passphrase = encrypt(passphrase);
    else if (!data.clearPassphrase && prev?.keyPath === keyPath && prev?.passphrase) entry.passphrase = prev.passphrase;
  }
  store.hosts[key] = entry;
  writeStore(store);
  return describe(url);
}

function clear(url) {
  const t = parseTarget(url);
  const store = readStore();
  const removed = Boolean(t.host && store.hosts[keyOf(t)]);
  if (removed) {
    delete store.hosts[keyOf(t)];
    writeStore(store);
  }
  return { removed };
}

/* =================== Передача в git =================== */

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const toPosix = (p) => String(p).replace(/\\/g, '/');

/** Скрипт для SSH_ASKPASS: печатает пароль ключа из переменной окружения */
function askpassScript() {
  const file = path.join(userDataDir(), 'gitidea-ssh-askpass.sh');
  const body = '#!/bin/sh\nprintf \'%s\\n\' "$GITIDEA_SSH_PASS"\n';
  try {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) fs.writeFileSync(file, body, { mode: 0o700 });
    fs.chmodSync(file, 0o700);
  } catch {
    /* без прав на запись — пароль ключа не передать, ssh спросит агент */
  }
  return file;
}

/**
 * Переменные окружения для git: все сохранённые HTTPS-доступы (каждый — только для своего хоста)
 * и SSH-ключ для хоста из urls (первого, для которого он сохранён).
 * existingCount — сколько GIT_CONFIG_* уже задано (обычно 0).
 */
function envFor(urls = []) {
  let store;
  try {
    store = readStore();
  } catch {
    return {};
  }
  const env = {};
  const config = [];
  let i = 0;
  for (const [key, entry] of Object.entries(store.hosts)) {
    if (entry.method !== 'password' && entry.method !== 'token') continue;
    const secret = decrypt(entry.secret);
    if (secret === null || !entry.username) continue;
    // Пусто — сбросить helpers (Git Credential Manager и т.п.) для этого хоста; затем наш
    config.push([`credential.${key}.helper`, '']);
    config.push([
      `credential.${key}.helper`,
      `!f() { test "$1" = get && printf 'username=%s\\npassword=%s\\n' "$GITIDEA_U_${i}" "$GITIDEA_P_${i}"; }; f`,
    ]);
    env[`GITIDEA_U_${i}`] = entry.username;
    env[`GITIDEA_P_${i}`] = secret;
    i++;
  }
  if (config.length) {
    const base = Number(process.env.GIT_CONFIG_COUNT) || 0;
    env.GIT_CONFIG_COUNT = String(base + config.length);
    config.forEach(([k, v], n) => {
      env[`GIT_CONFIG_KEY_${base + n}`] = k;
      env[`GIT_CONFIG_VALUE_${base + n}`] = v;
    });
  }

  for (const url of urls) {
    const t = parseTarget(url);
    if (t.protocol !== 'ssh') continue;
    const entry = store.hosts[keyOf(t)];
    if (entry?.method !== 'ssh' || !entry.keyPath) continue;
    const passphrase = entry.passphrase ? decrypt(entry.passphrase) : null;
    env.GIT_SSH_COMMAND = sshCommand(entry.keyPath, Boolean(passphrase));
    if (passphrase) {
      env.SSH_ASKPASS = toPosix(askpassScript());
      env.SSH_ASKPASS_REQUIRE = 'force';
      env.DISPLAY = process.env.DISPLAY || ':0';
      env.GITIDEA_SSH_PASS = passphrase;
    }
    break;
  }
  return env;
}

/**
 * Команда ssh для git. Без пароля ключа — BatchMode (никаких вопросов в невидимой консоли);
 * с паролем — askpass, а вход по паролю/клавиатуре сервера выключен, чтобы ssh не завис.
 */
function sshCommand(keyPath, withPassphrase) {
  const parts = ['ssh', '-i', shQuote(toPosix(keyPath)), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20'];
  if (withPassphrase) parts.push('-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no');
  else parts.push('-o', 'BatchMode=yes');
  return parts.join(' ');
}

/* =================== SSH-ключи =================== */

const sshDir = () => process.env.GK_TEST_SSH_DIR || path.join(os.homedir(), '.ssh');
const NOT_KEYS = new Set(['known_hosts', 'known_hosts.old', 'config', 'authorized_keys', 'environment']);

/** Приватные ключи в ~/.ssh: файлы с парным .pub или с именем id_* */
function listSshKeys() {
  const dir = sshDir();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { dir, keys: [] };
  }
  const keys = [];
  for (const name of names) {
    if (name.endsWith('.pub') || NOT_KEYS.has(name) || name.startsWith('.')) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 64 * 1024) continue;
    const hasPub = names.includes(`${name}.pub`);
    if (!hasPub && !name.startsWith('id_')) continue;
    let type = null;
    let comment = null;
    if (hasPub) {
      try {
        const [t, , ...c] = fs.readFileSync(`${file}.pub`, 'utf8').trim().split(/\s+/);
        type = t?.replace(/^ssh-/, '') ?? null;
        comment = c.join(' ') || null;
      } catch {
        /* .pub не читается */
      }
    }
    keys.push({ path: file, name, type, comment, hasPub, mtime: stat.mtimeMs });
  }
  keys.sort((a, b) => (a.name.startsWith('id_') === b.name.startsWith('id_') ? b.mtime - a.mtime : a.name.startsWith('id_') ? -1 : 1));
  return { dir, keys };
}

/** Где взять ssh-keygen: PATH, а на Windows — ещё из комплекта Git for Windows */
function sshKeygenCandidates(gitBinary) {
  const list = ['ssh-keygen'];
  if (process.platform === 'win32') {
    if (gitBinary) {
      const root = path.resolve(path.dirname(gitBinary), '..'); // …\Git\cmd → …\Git
      list.push(path.join(root, 'usr', 'bin', 'ssh-keygen.exe'));
    }
    list.push('C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe', 'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe');
  }
  return list;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else resolve(stdout);
    });
  });
}

const KEY_TYPES = {
  ed25519: ['-t', 'ed25519'],
  rsa: ['-t', 'rsa', '-b', '4096'],
};

/** Имя файла по умолчанию: стандартное (его ssh найдёт и сам), а если занято — с именем сервера */
function suggestKeyName(type = 'ed25519', host = null, dir = sshDir(), exists = fs.existsSync) {
  const base = type === 'rsa' ? 'id_rsa' : 'id_ed25519';
  if (!exists(path.join(dir, base)) && !exists(path.join(dir, `${base}.pub`))) return base;
  const tag = String(host ?? 'gitidea').toLowerCase().replace(/[^a-z0-9.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'gitidea';
  return `${base}_${tag}`;
}

/**
 * Создать новый ключ в ~/.ssh. → { path, publicKey, type, fingerprint? }
 * type: ed25519 (по умолчанию) | rsa (4096 бит — для старых серверов).
 * Существующие ключи не перезаписываются: к имени добавляется _2, _3, …
 */
async function generateSshKey({ type = 'ed25519', comment, passphrase = '', name, host = null, gitBinary } = {}) {
  if (!KEY_TYPES[type]) throw new GitError('Неизвестный тип ключа', { code: 'BAD_ARGS' });
  const dir = sshDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const wanted = String(name ?? '').trim();
  if (wanted && (/[\\/]/.test(wanted) || wanted.startsWith('.') || wanted.endsWith('.pub'))) {
    throw new GitError('Имя файла ключа — без папок, точки в начале и .pub на конце', { code: 'BAD_ARGS' });
  }
  const base = wanted.replace(/[^\w.-]/g, '_') || suggestKeyName(type, host, dir);
  let file = path.join(dir, base);
  for (let n = 2; fs.existsSync(file) || fs.existsSync(`${file}.pub`); n++) file = path.join(dir, `${base}_${n}`);
  const label = String(comment || `${os.userInfo().username}@${os.hostname()}`).replace(/[\r\n]/g, ' ').slice(0, 200);
  let lastError = null;
  for (const cmd of sshKeygenCandidates(gitBinary)) {
    try {
      await run(cmd, [...KEY_TYPES[type], '-f', file, '-N', String(passphrase), '-C', label, '-q']);
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows — права через ACL, ssh-keygen их уже выставил */
      }
      const publicKey = fs.readFileSync(`${file}.pub`, 'utf8').trim();
      const fingerprint = await run(cmd, ['-l', '-f', `${file}.pub`]).then((o) => o.trim().split(/\s+/)[1] ?? null, () => null);
      return { path: file, name: path.basename(file), publicKey, type, fingerprint };
    } catch (error) {
      lastError = error;
      if (error.code !== 'ENOENT') break;
    }
  }
  throw new GitError('Не удалось создать SSH-ключ', {
    code: lastError?.code === 'ENOENT' ? 'NO_SSH_KEYGEN' : 'KEYGEN_FAILED',
    hint: lastError?.code === 'ENOENT' ? 'Не найдена программа ssh-keygen. Установите OpenSSH или Git for Windows.' : null,
    details: (lastError?.stderr || lastError?.message || '').trim(),
  });
}

/**
 * Адрес remote https://host/group/project(.git) → SSH-вариант git@host:group/project.git
 * (так его показывают GitLab, GitHub, Bitbucket). null — если адрес не https.
 */
function sshUrlFor(url) {
  const t = parseTarget(url);
  if (t.protocol !== 'https' || !t.hostname) return null;
  try {
    const p = new URL(String(url).trim()).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!p) return null;
    return `git@${t.hostname}:${p}.git`;
  } catch {
    return null;
  }
}

/** Публичная часть ключа (для копирования в GitLab/GitHub) */
function publicKeyOf(keyPath) {
  try {
    return fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
  } catch {
    return null;
  }
}

module.exports = {
  parseTarget,
  describe,
  save,
  clear,
  envFor,
  sshCommand,
  listSshKeys,
  generateSshKey,
  suggestKeyName,
  sshUrlFor,
  publicKeyOf,
  defaultTokenUser,
  keyOf,
};
