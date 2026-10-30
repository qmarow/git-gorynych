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

/** Ключ сервера: для HTTPS — host с портом, для SSH — имя хоста (так хранились входы до привязки к репозиторию) */
const keyOf = (t) => (t.protocol === 'https' ? `${t.scheme}://${t.host}` : `ssh://${t.hostname}`);

/**
 * Путь репозитория из адреса: «group/sub/app» (без .git и слэшей), как написан в адресе.
 * https://host/group/app.git, git@host:group/app.git, ssh://git@host:2222/group/app.git
 */
function repoPathOf(url) {
  const raw = String(url ?? '').trim();
  let p = '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      p = decodeURIComponent(new URL(raw).pathname);
    } catch {
      p = '';
    }
  } else {
    const ssh = /^ssh:\/\/[^/]+(\/.*)$/i.exec(raw);
    const scp = /^(?:[^@/\\]+@)?[^:/\\]+:(?!\/\/)(.*)$/.exec(raw);
    p = ssh ? ssh[1] : scp ? scp[1] : '';
  }
  return p.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

/**
 * Ключ входа для репозитория: сервер + путь (регистр пути не важен — GitLab и GitHub его не различают).
 * https://gitlab.com/Group/App.git → «https://gitlab.com/group/app»; null — в адресе нет пути.
 */
function repoKeyOf(url) {
  const t = parseTarget(url);
  const p = repoPathOf(url);
  if (!t.host || !p) return null;
  return `${keyOf(t)}/${p.toLowerCase()}`;
}

/** Действующая запись для адреса: своя у репозитория или (запасной вариант) общая для сервера, сохранённая раньше */
function entryFor(store, url) {
  const t = parseTarget(url);
  if (!t.host) return { entry: null, shared: false };
  const own = store.repos?.[repoKeyOf(url)];
  if (own) return { entry: own, shared: false };
  const host = store.hosts[keyOf(t)];
  return host ? { entry: host, shared: true } : { entry: null, shared: false };
}

/** Сохранённая запись без секретов (для интерфейса) */
function describeEntry(entry) {
  if (!entry) return null;
  return {
    method: entry.method,
    username: entry.username ?? null,
    keyPath: entry.keyPath ?? null,
    hasSecret: Boolean(entry.secret),
    hasPassphrase: Boolean(entry.passphrase),
    // Токен для API сервера (пайплайны) — к входу паролем или SSH-ключом, которые API не принимает
    hasApiToken: Boolean(entry.apiToken),
    savedAt: entry.savedAt ?? null,
    readable: entry.method === 'ssh' ? !entry.passphrase || decrypt(entry.passphrase) !== null : decrypt(entry.secret) !== null,
  };
}

/** Что сохранено для адреса репозитория — без секретов (для интерфейса) */
function describe(url) {
  const t = parseTarget(url);
  if (!t.host) return { ...t, saved: null, kind: null, kindSaved: false, cloud: false, base: null, repoPath: null, repoKey: null };
  const store = readStore();
  const { entry, shared } = entryFor(store, url);
  const saved = describeEntry(entry);
  return {
    ...t,
    ...serverInfo(t.hostname, store),
    // Адрес сайта сервера: для https — как в remote (со схемой и портом), для SSH — https://имя-хоста
    base: t.protocol === 'https' ? `${t.scheme}://${t.host}` : store.servers?.[t.hostname]?.base ?? `https://${t.hostname}`,
    repoPath: repoPathOf(url) || null,
    repoKey: repoKeyOf(url),
    // shared — вход общий для всего сервера (сохранён до привязки к репозиториям); новый сохранится для этого репозитория
    saved: saved ? { ...saved, shared } : null,
  };
}

/* =================== Серверы: GitHub, GitLab, свои (Self-Managed) =================== */

const SERVER_KINDS = new Set(['github', 'gitlab', 'gitea', 'bitbucket', 'other']);
// Облачные сервисы: тип известен по домену, выбирать нечего
const CLOUD = { 'github.com': 'github', 'gitlab.com': 'gitlab', 'bitbucket.org': 'bitbucket', 'codeberg.org': 'gitea' };

/** Тип сервера по имени хоста — догадка без сети. null — не понять (свой сервер с нейтральным именем) */
function guessKind(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  if (CLOUD[h]) return CLOUD[h];
  if (/gitlab/.test(h)) return 'gitlab';
  if (/github/.test(h)) return 'github';
  if (/gitea|forgejo/.test(h)) return 'gitea';
  if (/bitbucket/.test(h)) return 'bitbucket';
  return null;
}

/** Тип сервера: выбранный пользователем (сохранённый) важнее догадки по имени */
function serverKind(hostname, store = null) {
  const h = String(hostname ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return null;
  let saved = null;
  try {
    saved = (store ?? readStore()).servers?.[h]?.kind ?? null;
  } catch {
    saved = null;
  }
  return SERVER_KINDS.has(saved) ? saved : guessKind(h);
}

function serverInfo(hostname, store) {
  const h = String(hostname ?? '').toLowerCase();
  const saved = store.servers?.[h]?.kind;
  return { kind: serverKind(h, store), kindSaved: SERVER_KINDS.has(saved), cloud: Boolean(CLOUD[h]) };
}

/**
 * Адрес сервера, как его ввёл пользователь: «gitlab.company.ru», «gitlab.company.ru:8443»,
 * «http://git.local», ссылка на проект или git@host:group/app.git — берём только сервер.
 * → { base: 'https://host[:port]', scheme, host (с портом), hostname }
 */
function parseServer(input) {
  let raw = String(input ?? '').trim();
  if (!raw) throw new GitError('Укажите адрес сервера', { code: 'BAD_ARGS', hint: 'Например: gitlab.company.ru' });
  const scp = /^(?:[^@/\\\s]+@)?([^:/\\\s]+):(?!\/\/|\d+(?:\/|$))/.exec(raw); // git@host:group/app.git
  if (scp) raw = scp[1];
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(raw);
  if (ssh) raw = ssh[1];
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new GitError('Не похоже на адрес сервера', { code: 'BAD_ARGS', hint: 'Например: gitlab.company.ru или https://git.company.ru:8443' });
  }
  const hostname = u.hostname.toLowerCase();
  if (!hostname || !/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/i.test(hostname) || /^[.-]|[.-]$/.test(hostname)) {
    throw new GitError('Не похоже на адрес сервера', { code: 'BAD_ARGS', hint: 'Например: gitlab.company.ru' });
  }
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  const host = u.host.toLowerCase();
  return { base: `${scheme}://${host}`, scheme, host, hostname };
}

/** Запомнить тип сервера (и адрес сайта — для SSH-входа, где в адресе его нет) */
function setServer(hostname, { kind, base } = {}) {
  const h = String(hostname ?? '').toLowerCase();
  if (!h) return;
  if (!SERVER_KINDS.has(kind)) throw new GitError('Неизвестный тип сервера', { code: 'BAD_ARGS' });
  const store = readStore();
  store.servers = store.servers && typeof store.servers === 'object' ? store.servers : {};
  // Облако не запоминаем: github.com и так GitHub
  if (CLOUD[h] === kind) delete store.servers[h];
  else store.servers[h] = { kind, base: base ?? store.servers[h]?.base ?? null, savedAt: new Date().toISOString() };
  writeStore(store);
}

/**
 * Серверы и привязанные к ним репозитории (без секретов):
 * [{ hostname, base, kind, cloud, kindSaved, repos: [{ key, url, path, protocol, method, … }], shared: [{ key, protocol, … }] }]
 * shared — входы на весь сервер, сохранённые до привязки к репозиториям (действуют, пока у репозитория нет своего).
 */
function listServers() {
  const store = readStore();
  const map = new Map();
  const get = (hostname) => {
    if (!map.has(hostname)) map.set(hostname, { hostname, base: null, repos: [], shared: [] });
    return map.get(hostname);
  };
  for (const [key, entry] of Object.entries(store.repos ?? {})) {
    const t = parseTarget(entry.url);
    if (!t.hostname) continue;
    const srv = get(t.hostname);
    if (t.protocol === 'https') srv.base = srv.base ?? `${t.scheme}://${t.host}`;
    srv.repos.push({ key, url: entry.url, path: repoPathOf(entry.url), protocol: t.protocol, ...describeEntry(entry) });
  }
  for (const [key, entry] of Object.entries(store.hosts)) {
    const m = /^(https?|ssh):\/\/(.+)$/.exec(key);
    if (!m) continue;
    const srv = get(m[2].replace(/:\d+$/, ''));
    if (m[1] !== 'ssh') srv.base = srv.base ?? key;
    srv.shared.push({ key, protocol: m[1] === 'ssh' ? 'ssh' : 'https', ...describeEntry(entry) });
  }
  for (const [hostname, info] of Object.entries(store.servers ?? {})) {
    const srv = get(hostname);
    srv.base = srv.base ?? info.base ?? null;
  }
  return [...map.values()]
    .map((srv) => ({
      ...srv,
      base: srv.base ?? `https://${srv.hostname}`,
      repos: srv.repos.sort((x, y) => x.path.localeCompare(y.path)),
      ...serverInfo(srv.hostname, store),
    }))
    .sort((a, b) => Number(b.cloud) - Number(a.cloud) || a.hostname.localeCompare(b.hostname));
}

/** Забыть сервер целиком: входы всех его репозиториев, общий вход и выбранный тип */
function forgetServer(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  const store = readStore();
  let removed = 0;
  const sameHost = (url) => parseTarget(url).hostname === h;
  for (const [key, entry] of Object.entries(store.repos ?? {})) {
    if (sameHost(entry.url)) {
      delete store.repos[key];
      removed++;
    }
  }
  for (const key of Object.keys(store.hosts)) {
    const m = /^(?:https?|ssh):\/\/(.+)$/.exec(key);
    if (m && m[1].replace(/:\d+$/, '') === h) {
      delete store.hosts[key];
      removed++;
    }
  }
  if (store.servers?.[h]) {
    delete store.servers[h];
    removed++;
  }
  if (removed) writeStore(store);
  return { removed: removed > 0 };
}

/** Логин по умолчанию для токена: GitLab — oauth2, Bitbucket — x-token-auth, остальные (GitHub, Gitea…) — git */
function defaultTokenUser(host) {
  const kind = serverKind(host);
  if (kind === 'gitlab') return 'oauth2';
  if (kind === 'bitbucket') return 'x-token-auth';
  return 'git';
}

/* ---------- Сеть: определить тип сервера и проверить токен ---------- */

const PROBE_TIMEOUT = 6000;

async function httpGet(url, headers = {}, timeout = PROBE_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const doFetch = electron?.net?.fetch ? electron.net.fetch.bind(electron.net) : fetch;
  try {
    const res = await doFetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'follow' });
    let json = null;
    try {
      json = JSON.parse(await res.text());
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Узнать по API, что за сервер: GitLab, GitHub Enterprise, Gitea/Forgejo, Bitbucket Data Center.
 * → { kind, version?, reachable } — kind: null, если сервер не ответил; 'other' — ответил, но не узнан.
 */
async function detectServer(input) {
  const s = parseServer(input);
  if (CLOUD[s.hostname]) return { ...s, kind: CLOUD[s.hostname], reachable: true, cloud: true };
  const probes = [
    // GitLab: без токена /version отвечает 401 {"message":"401 Unauthorized"}, с открытым API — версией
    ['gitlab', '/api/v4/version', (r) => (r.status === 401 && /401/.test(r.json?.message ?? '')) || (r.status === 200 && r.json?.version && 'revision' in r.json)],
    ['github', '/api/v3/meta', (r) => r.status === 200 && r.json && ('installed_version' in r.json || 'verifiable_password_authentication' in r.json)],
    ['gitea', '/api/v1/version', (r) => r.status === 200 && typeof r.json?.version === 'string'],
    ['bitbucket', '/rest/api/1.0/application-properties', (r) => r.status === 200 && /bitbucket/i.test(r.json?.displayName ?? '')],
  ];
  let reachable = false;
  let lastError = null;
  const results = await Promise.all(
    probes.map(async ([kind, apiPath, test]) => {
      try {
        const r = await httpGet(`${s.base}${apiPath}`);
        reachable = true;
        return test(r) ? { kind, version: r.json?.version ?? r.json?.installed_version ?? null } : null;
      } catch (error) {
        lastError = error;
        return null;
      }
    }),
  );
  const hit = results.find(Boolean);
  if (hit) return { ...s, kind: hit.kind, version: hit.version ?? null, reachable: true };
  return {
    ...s,
    kind: reachable ? 'other' : null,
    reachable,
    error: reachable ? null : lastError?.name === 'AbortError' ? `${s.host} не ответил за ${PROBE_TIMEOUT / 1000} с` : `Нет связи с ${s.host}`,
  };
}

/**
 * Сохранить вход для репозитория (по адресу remote или ссылке для клонирования).
 * data: { method, username, secret (пароль/токен), keyPath, passphrase, apiToken, clearApiToken }
 * Пустой secret/passphrase/apiToken при уже сохранённом значении — оставить прежнее.
 * apiToken — к паролю или SSH-ключу: API сервера (пайплайны CI/CD) их не принимает, а одна авторизация должна работать везде.
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
  // Тип сервера, выбранный в окне входа, — до логина по умолчанию: он от типа зависит
  if (data.kind && SERVER_KINDS.has(data.kind)) setServer(t.hostname, { kind: data.kind, base: t.protocol === 'https' ? `${t.scheme}://${t.host}` : undefined });
  const key = repoKeyOf(url);
  if (!key) throw new GitError('Укажите адрес репозитория', { code: 'BAD_ARGS', hint: 'Например: https://gitlab.com/group/project.git' });
  const store = readStore();
  store.repos = store.repos && typeof store.repos === 'object' ? store.repos : {};
  // Пустой пароль/токен — оставить прежний: свой у репозитория или общий вход сервера
  const { entry: current } = entryFor(store, url);
  const prev = current?.method === method ? current : null;
  const entry = { method, url: String(url).trim(), savedAt: new Date().toISOString() };

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
  if (method !== 'token') {
    const apiToken = String(data.apiToken ?? '').trim();
    if (apiToken) {
      if (/\s/.test(apiToken)) throw new GitError('В токене для пайплайнов не должно быть пробелов', { code: 'BAD_ARGS' });
      entry.apiToken = encrypt(apiToken);
    } else if (!data.clearApiToken && current?.apiToken) entry.apiToken = current.apiToken;
  }
  store.repos[key] = entry;
  writeStore(store);
  return describe(url);
}

/** Адрес сайта сервера, выбранный в окне входа (для SSH-адресов: https://host:порт) */
function serverBase(hostname) {
  try {
    return readStore().servers?.[String(hostname ?? '').toLowerCase()]?.base ?? null;
  } catch {
    return null;
  }
}

/** Добавить токен для API к сохранённому входу репозитория (перенос старого отдельного токена CI/CD) */
function attachApiToken(key, token) {
  const store = readStore();
  const entry = store.repos?.[key];
  if (!entry || entry.method === 'token' || entry.apiToken) return false;
  entry.apiToken = encrypt(token);
  writeStore(store);
  return true;
}

/** Забыть вход репозитория; если своего нет, а действует общий вход сервера — забыть его (shared: true) */
function clear(url) {
  const t = parseTarget(url);
  const store = readStore();
  const key = repoKeyOf(url);
  if (key && store.repos?.[key]) {
    delete store.repos[key];
    writeStore(store);
    return { removed: true, shared: false };
  }
  if (t.host && store.hosts[keyOf(t)]) {
    delete store.hosts[keyOf(t)];
    writeStore(store);
    return { removed: true, shared: true };
  }
  return { removed: false, shared: false };
}

/** Забыть одну запись по ключу из списка серверов (вход репозитория или общий вход сервера) */
function forgetLogin(key) {
  const store = readStore();
  let removed = false;
  if (store.repos?.[key]) {
    delete store.repos[key];
    removed = true;
  } else if (store.hosts[key]) {
    delete store.hosts[key];
    removed = true;
  }
  if (removed) writeStore(store);
  return { removed };
}

/* =================== Вход репозитория → API (CI/CD) =================== */

// Токены, которые GitLab принимает и в git, и в API (личные, проектные, групповые, OAuth); deploy-токены (gldt-) API не дают
const API_TOKEN_PREFIX = /^(glpat-|gloas-|glsoat-)/;

/**
 * Вход, сохранённый для репозитория (hostname + путь), который можно попробовать для API сервера.
 * → { repo: { secret, method, username, key, url, savedAt } | null, shared: … | null, other: { method, key } | null }
 * repo — свой вход репозитория (токен или пароль-токен), shared — общий вход сервера (сохранён до привязки),
 * other — вход есть, но для API не годится (SSH-ключ, обычный пароль).
 */
function apiLoginFor(hostname, repoPath) {
  const h = String(hostname ?? '').toLowerCase();
  const p = String(repoPath ?? '').toLowerCase().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const store = readStore();
  const usable = (entry) =>
    entry && (Boolean(entry.apiToken) || entry.method === 'token' || (entry.method === 'password' && API_TOKEN_PREFIX.test(decrypt(entry.secret) ?? '')));
  const pack = (key, entry, shared = false) => {
    const viaApiToken = Boolean(entry.apiToken);
    const secret = viaApiToken ? decrypt(entry.apiToken) : decrypt(entry.secret);
    if (secret === null) return null;
    return { secret, method: entry.method, viaApiToken, username: entry.username ?? null, key, url: entry.url ?? null, savedAt: entry.savedAt ?? null, shared };
  };
  let repo = null;
  let other = null;
  // HTTPS-вход раньше SSH: у одного репозитория могут быть оба (адрес remote меняли)
  const own = Object.entries(store.repos ?? {})
    .filter(([, e]) => parseTarget(e.url).hostname === h && repoPathOf(e.url).toLowerCase() === p)
    .sort(([, a], [, b]) => Number(b.method !== 'ssh') - Number(a.method !== 'ssh'));
  for (const [key, entry] of own) {
    if (usable(entry)) {
      repo = pack(key, entry);
      if (repo) break;
    } else if (!other) other = { method: entry.method, key, unreadable: entry.method !== 'ssh' && decrypt(entry.secret) === null };
  }
  let shared = null;
  for (const [key, entry] of Object.entries(store.hosts)) {
    const m = /^(https?):\/\/(.+)$/.exec(key);
    if (m && m[2].replace(/:\d+$/, '') === h && usable(entry)) {
      shared = pack(key, entry, true);
      if (shared) break;
    }
  }
  return { repo, shared, other: repo ? null : other };
}

/* =================== Передача в git =================== */

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const toPosix = (p) => String(p).replace(/\\/g, '/');

/** Скрипт для SSH_ASKPASS: печатает пароль ключа из переменной окружения */
function askpassScript() {
  const file = path.join(userDataDir(), 'gorynych-ssh-askpass.sh');
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
 * Переменные окружения для git по адресам репозитория (remote или ссылка для клонирования):
 * для каждого https-сервера — вход этого репозитория (или общий вход сервера), только для этого хоста;
 * для SSH — ключ первого адреса, для которого он сохранён.
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
  const hostsDone = new Set();
  let i = 0;
  let sshDone = false;
  for (const url of urls) {
    const t = parseTarget(url);
    if (!t.host) continue;
    const { entry } = entryFor(store, url);
    if (t.protocol === 'https') {
      // Один helper на сервер: вход первого адреса (remote текущей ветки идёт первым)
      const key = keyOf(t);
      if (hostsDone.has(key) || (entry?.method !== 'password' && entry?.method !== 'token')) continue;
      const secret = decrypt(entry.secret);
      if (secret === null || !entry.username) continue;
      hostsDone.add(key);
      // Пусто — сбросить helpers (Git Credential Manager и т.п.) для этого хоста; затем наш
      config.push([`credential.${key}.helper`, '']);
      config.push([
        `credential.${key}.helper`,
        `!f() { test "$1" = get && printf 'username=%s\\npassword=%s\\n' "$GITIDEA_U_${i}" "$GITIDEA_P_${i}"; }; f`,
      ]);
      env[`GITIDEA_U_${i}`] = entry.username;
      env[`GITIDEA_P_${i}`] = secret;
      i++;
    } else if (t.protocol === 'ssh' && !sshDone && entry?.method === 'ssh' && entry.keyPath) {
      sshDone = true;
      const passphrase = entry.passphrase ? decrypt(entry.passphrase) : null;
      env.GIT_SSH_COMMAND = sshCommand(entry.keyPath, Boolean(passphrase));
      if (passphrase) {
        env.SSH_ASKPASS = toPosix(askpassScript());
        env.SSH_ASKPASS_REQUIRE = 'force';
        env.DISPLAY = process.env.DISPLAY || ':0';
        env.GITIDEA_SSH_PASS = passphrase;
      }
    }
  }
  if (config.length) {
    const base = Number(process.env.GIT_CONFIG_COUNT) || 0;
    env.GIT_CONFIG_COUNT = String(base + config.length);
    config.forEach(([k, v], n) => {
      env[`GIT_CONFIG_KEY_${base + n}`] = k;
      env[`GIT_CONFIG_VALUE_${base + n}`] = v;
    });
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
  const tag = String(host ?? 'gorynych').toLowerCase().replace(/[^a-z0-9.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'gorynych';
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
  guessKind,
  serverKind,
  parseServer,
  setServer,
  listServers,
  forgetServer,
  forgetLogin,
  detectServer,
  repoKeyOf,
  repoPathOf,
  apiLoginFor,
  attachApiToken,
  serverBase,
};
