// Интеграция с GitLab API: статусы пайплайнов, задания, логи, действия, переменные и раннеры.
// Токен хранится зашифрованным (Electron safeStorage → DPAPI на Windows) и никогда не уходит в renderer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { git } = require('./git.cjs');
const { GitError } = require('./errors.cjs');
const credentials = require('./credentials.cjs');

const { serverKind } = credentials;

let electron = null;
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object') electron = mod; // вне Electron require('electron') возвращает путь к бинарнику
} catch {
  electron = null;
}

const REQUEST_TIMEOUT = 20000;
const MAX_LOG_SIZE = 1.5 * 1024 * 1024;
const PROJECT_CACHE_MS = 10 * 60 * 1000;

/* =================== Хранилище токенов =================== */

function storeFile() {
  const dir = process.env.GK_TEST_USERDATA || electron?.app?.getPath('userData');
  if (!dir) throw new GitError('Хранилище настроек недоступно', { code: 'NO_STORAGE' });
  return path.join(dir, 'gitlab-tokens.json');
}

// { repos: { «https://host/group/app»: токен репозитория }, hosts: { «https://host»: общий токен сервера (сохранён раньше) } }
function readStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    if (!data || typeof data.hosts !== 'object') return { hosts: {}, repos: {} };
    return { ...data, repos: data.repos && typeof data.repos === 'object' ? data.repos : {} };
  } catch {
    return { hosts: {}, repos: {} };
  }
}

function writeStore(store) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function encrypt(token) {
  const ss = electron?.safeStorage;
  if (ss?.isEncryptionAvailable()) return { enc: ss.encryptString(token).toString('base64') };
  if (process.env.GK_TEST_USERDATA) return { plain: Buffer.from(token).toString('base64') }; // только для тестов
  throw new GitError('Шифрование недоступно в системе — токен нельзя сохранить безопасно', { code: 'NO_ENCRYPTION' });
}

function decrypt(entry) {
  if (!entry) return null;
  try {
    if (entry.enc && electron?.safeStorage) return electron.safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    if (entry.plain && process.env.GK_TEST_USERDATA) return Buffer.from(entry.plain, 'base64').toString('utf8');
  } catch {
    return null; // токен зашифрован под другим пользователем Windows — нужно ввести заново
  }
  return null;
}

/* =================== Чем авторизоваться в API =================== */

/** Ключ репозитория для API: сервер + путь проекта (без учёта регистра и протокола remote) */
const apiKey = (remote) => `${remote.base}/${String(remote.path).toLowerCase()}`;

// Токен (строка) или { value, bearer } — OAuth-токен отправляется как Authorization: Bearer
const tokenValue = (token) => (typeof token === 'object' && token ? token.value : token);
const authHeaders = (token) =>
  typeof token === 'object' && token?.bearer ? { Authorization: `Bearer ${token.value}` } : { 'PRIVATE-TOKEN': tokenValue(token) };

// Проверка входа репозитория для API: отпечаток токена → { state: 'ok' | 'bad' | 'pending', info, reason, bearer, promise }
const loginChecks = new Map();
const fingerprint = (base, secret) => crypto.createHash('sha256').update(`${base}\n${secret}`).digest('hex').slice(0, 24);

const SCOPE_NAMES = { api: 'api', read_api: 'read_api', read_repository: 'read_repository', write_repository: 'write_repository', read_user: 'read_user' };

/** Подходит ли токен входа репозитория для API GitLab (результат запоминается до перезапуска или смены токена) */
function verifyLogin(base, secret) {
  const fp = fingerprint(base, secret);
  const cached = loginChecks.get(fp);
  if (cached && (cached.state !== 'bad' || Date.now() - cached.at < 10 * 60 * 1000)) return cached.promise ?? Promise.resolve(cached);
  const entry = { state: 'pending', at: Date.now() };
  entry.promise = (async () => {
    let info = null;
    let bearer = false;
    try {
      info = await tokenInfo(base, secret);
    } catch (error) {
      if (error.code === 'AUTH') {
        try {
          info = await tokenInfo(base, { value: secret, bearer: true });
          bearer = true;
        } catch {
          info = null;
        }
      }
      if (!info) {
        if (error.code === 'NETWORK' || error.code === 'RATE_LIMIT') {
          loginChecks.delete(fp); // нет связи — проверим в следующий раз
          return { state: 'unknown', reason: error.message };
        }
        // Права токена можно узнать и без доступа к /user — чтобы назвать, чего не хватает
        let scopes = null;
        if (error.code === 'FORBIDDEN') scopes = (await request(base, secret, 'GET', '/personal_access_tokens/self').catch(() => null))?.scopes ?? null;
        const reason =
          error.code === 'FORBIDDEN'
            ? scopes?.length
              ? `у токена нет права на API: есть только ${scopes.map((x) => SCOPE_NAMES[x] ?? x).join(', ')}, а нужен «api» или «read_api»`
              : 'у токена нет права на API (нужен scope «api» или «read_api»)'
            : error.code === 'AUTH'
              ? 'GitLab не принимает этот токен для API — он отозван, истёк или это не личный токен'
              : error.message;
        Object.assign(entry, { state: 'bad', reason, at: Date.now(), promise: null });
        return entry;
      }
    }
    if (info.scopes && !info.scopes.some((x) => x === 'api' || x === 'read_api')) {
      Object.assign(entry, {
        state: 'bad',
        reason: `у токена нет права на API: есть только ${info.scopes.map((x) => SCOPE_NAMES[x] ?? x).join(', ')}, а нужен «api» или «read_api»`,
        info,
        at: Date.now(),
        promise: null,
      });
      return entry;
    }
    Object.assign(entry, { state: 'ok', info, bearer, at: Date.now(), promise: null });
    return entry;
  })();
  loginChecks.set(fp, entry);
  return entry.promise;
}
const loginCheckState = (base, secret) => loginChecks.get(fingerprint(base, secret)) ?? null;

/**
 * Все варианты авторизации API для репозитория — по порядку. Авторизация одна — авторизация репозитория:
 *  login        — вход репозитория (токен или токен для пайплайнов к паролю / SSH-ключу);
 *  legacy       — отдельный токен CI/CD, сохранённый в старых версиях (только как запасной вариант);
 *  legacy-shared — старый общий токен CI/CD сервера;
 *  login-shared — общий вход сервера для git, сохранённый до привязки к репозиториям.
 */
function authOptions(remote) {
  const store = readStore();
  const list = [];
  let login = { repo: null, shared: null, other: null };
  try {
    login = credentials.apiLoginFor(remote.host, remote.path);
  } catch {
    /* хранилище входов недоступно */
  }
  if (login.repo) list.push({ source: 'login', secret: login.repo.secret, login: login.repo, savedAt: login.repo.savedAt });
  let unreadable = false;
  const own = store.repos[apiKey(remote)];
  if (own) {
    const t = decrypt(own);
    if (t) list.push({ source: 'legacy', token: t, meta: own, savedAt: own.savedAt });
    else unreadable = true;
  }
  const shared = store.hosts[remote.base];
  if (shared) {
    const t = decrypt(shared);
    if (t) list.push({ source: 'legacy-shared', token: t, meta: shared, savedAt: shared.savedAt });
  }
  if (login.shared) list.push({ source: 'login-shared', secret: login.shared.secret, login: login.shared, savedAt: login.shared.savedAt });
  return { list, other: login.other, unreadable };
}

/**
 * Старый отдельный токен CI/CD переносится во вход репозитория: если репозиторий авторизован паролем или
 * SSH-ключом (их API не принимает), токен становится его «токеном для пайплайнов» — дальше авторизация одна.
 */
function migrateLegacy(remote) {
  const store = readStore();
  const own = store.repos[apiKey(remote)];
  if (!own) return;
  const token = decrypt(own);
  if (!token) return;
  let login;
  try {
    login = credentials.apiLoginFor(remote.host, remote.path);
  } catch {
    return;
  }
  if (login.other && !login.repo && credentials.attachApiToken(login.other.key, token)) {
    delete store.repos[apiKey(remote)];
    writeStore(store);
  }
}

/** Вариант для показа (без сети): вход репозитория с непроверенным токеном считается подходящим, пока не доказано обратное */
function pickSync(remote) {
  const { list, other, unreadable } = authOptions(remote);
  const rejected = [];
  for (const opt of list) {
    if (!opt.secret) return { opt, rejected, other, unreadable };
    const st = loginCheckState(remote.base, opt.secret);
    if (st?.state === 'bad') {
      rejected.push({ source: opt.source, method: opt.login.method, viaApiToken: opt.login.viaApiToken, reason: st.reason });
      continue;
    }
    if (!st) verifyLogin(remote.base, opt.secret).catch(() => {}); // проверим в фоне
    return { opt: { ...opt, check: st }, rejected, other, unreadable };
  }
  return { opt: null, rejected, other, unreadable };
}

/** Вариант для запроса: вход репозитория проверяется по сети (один раз) */
async function pickVerified(remote) {
  const { list, other } = authOptions(remote);
  const rejected = [];
  for (const opt of list) {
    if (!opt.secret) return { token: opt.token, meta: opt.meta ?? {}, source: opt.source };
    const st = await verifyLogin(remote.base, opt.secret);
    if (st.state === 'ok' || st.state === 'unknown') {
      const info = st.info ?? {};
      return { token: st.bearer ? { value: opt.secret, bearer: true } : opt.secret, meta: { user: info.user, scopes: info.scopes ?? null, expiresAt: info.expiresAt ?? null }, source: opt.source };
    }
    rejected.push({ source: opt.source, method: opt.login.method, viaApiToken: opt.login.viaApiToken, reason: st.reason });
  }
  return { token: null, rejected, other };
}

/** Почему вход репозитория не подходит для CI/CD — текст для интерфейса */
function loginProblem(rejected, other) {
  const r = rejected?.find((x) => x.source !== 'login-shared') ?? rejected?.[0];
  if (r) {
    return {
      method: r.method,
      reason: `${r.viaApiToken ? 'Токен для пайплайнов в авторизации репозитория' : 'Токен авторизации репозитория'} не подходит для пайплайнов: ${r.reason}.`,
    };
  }
  if (other?.method === 'ssh') {
    return { method: 'ssh', reason: 'Репозиторий авторизован SSH-ключом — его принимает git, но не API GitLab. Добавьте в авторизацию репозитория токен для пайплайнов.' };
  }
  if (other?.method === 'password') {
    return {
      method: 'password',
      reason: other.unreadable
        ? 'Пароль авторизации репозитория не расшифровывается — авторизуйтесь заново.'
        : 'Репозиторий авторизован логином и паролем — API GitLab принимает только токены. Добавьте в авторизацию репозитория токен для пайплайнов.',
    };
  }
  return null;
}

/**
 * Проверить по сети, работает ли авторизация репозитория для API (сразу после сохранения входа).
 * → { state: 'ok' | 'bad' | 'none' | 'unknown', reason, user, scopes }
 */
async function checkLoginApi(hostname, repoPath, base, timeout = 8000) {
  const login = credentials.apiLoginFor(hostname, repoPath);
  if (!login.repo) {
    const p = loginProblem([], login.other);
    return { state: 'none', reason: p?.reason ?? null, method: login.other?.method ?? null };
  }
  const st = await Promise.race([verifyLogin(base, login.repo.secret), new Promise((r) => setTimeout(() => r({ state: 'unknown', reason: 'сервер не ответил' }), timeout))]);
  const p = st.state === 'bad' ? loginProblem([{ method: login.repo.method, viaApiToken: login.repo.viaApiToken, reason: st.reason }]) : null;
  return { state: st.state, reason: p?.reason ?? st.reason ?? null, user: st.info?.user ?? null, scopes: st.info?.scopes ?? null, viaApiToken: login.repo.viaApiToken };
}

/** Токен для фоновых запросов (без ожидания проверки) */
const tokenForRemote = (remote) => {
  const { opt } = pickSync(remote);
  if (!opt) return null;
  if (!opt.secret) return opt.token;
  return opt.check?.bearer ? { value: opt.secret, bearer: true } : opt.secret;
};

/* =================== Remote → GitLab =================== */

function parseRemoteUrl(url) {
  if (!url) return null;
  let m = /^([\w.-]+)@([^:/]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(url); // git@host:group/project.git
  if (m) return { protocol: 'https', host: m[2], port: null, path: m[3] };
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');
    if (!p) return null;
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return { protocol: u.protocol.slice(0, -1), host: u.hostname, port: u.port || null, path: p };
    }
    if (u.protocol === 'ssh:' || u.protocol === 'git+ssh:') return { protocol: 'https', host: u.hostname, port: null, path: p };
  } catch {
    /* не URL */
  }
  return null;
}

async function detectRemote(root, preferredRemote) {
  const out = await git(root, ['remote', '-v']).catch(() => '');
  const remotes = new Map();
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
    if (m) remotes.set(m[1], m[2]);
  }
  if (!remotes.size) return null;
  const name = [preferredRemote, 'origin', ...remotes.keys()].find((n) => n && remotes.has(n));
  const url = remotes.get(name);
  const parsed = parseRemoteUrl(url);
  if (!parsed) return null;
  const isHttp = /^https?:\/\//i.test(url);
  // Для SSH-адреса сайт сервера — каким его указали в окне авторизации (свой сервер может быть с портом)
  const base = (!isHttp && credentials.serverBase(parsed.host)?.replace(/\/+$/, '')) || `${parsed.protocol}://${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`;
  const remote = { remote: name, url, protocol: /^https?:\/\//i.test(url) ? 'https' : 'ssh', host: parsed.host, base, path: parsed.path };
  migrateLegacy(remote);
  const store = readStore();
  const hasCiToken = Boolean(store.repos[apiKey(remote)] || store.hosts[base]);
  // GitLab по имени хоста, по сохранённому токену или по типу, выбранному в окне входа (свой сервер с любым доменом)
  const kind = serverKind(parsed.host);
  const looksLikeGitlab = kind === 'gitlab' || hasCiToken || (kind === null && /gitlab/i.test(parsed.host));
  return {
    kind: looksLikeGitlab ? 'gitlab' : null,
    ...remote,
    webUrl: `${base}/${parsed.path}`,
    token: looksLikeGitlab ? tokenStatus(remote) : { configured: false },
  };
}

/** Чем авторизован API этого репозитория — без секретов (для интерфейса) */
function tokenStatus(remote) {
  const { opt, rejected, other, unreadable } = pickSync(remote);
  const problem = loginProblem(rejected, other);
  if (!opt) {
    return { configured: false, repoLogin: problem, unreadable, repoKey: apiKey(remote) };
  }
  if (!opt.secret) {
    const m = opt.meta ?? {};
    return { configured: true, source: opt.source, user: m.user ?? null, scopes: m.scopes ?? null, expiresAt: m.expiresAt ?? null, savedAt: m.savedAt, repoLogin: problem, repoKey: apiKey(remote) };
  }
  // Вход репозитория: пользователь и права известны после проверки
  const info = opt.check?.info ?? {};
  return {
    configured: true,
    source: opt.source,
    pending: !opt.check || opt.check.state === 'pending',
    user: info.user ?? null,
    scopes: info.scopes ?? null,
    expiresAt: info.expiresAt ?? null,
    savedAt: opt.savedAt ?? null,
    login: { method: opt.login.method, username: opt.login.username, shared: opt.login.shared, viaApiToken: opt.login.viaApiToken },
    repoKey: apiKey(remote),
  };
}

/* =================== HTTP =================== */

async function request(base, token, method, apiPath, { query, body, text = false, notFound } = {}) {
  const url = new URL(`${base}/api/v4${apiPath}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const doFetch = electron?.net?.fetch ? electron.net.fetch.bind(electron.net) : fetch;
  let res;
  try {
    res = await doFetch(url.toString(), {
      method,
      headers: {
        ...authHeaders(token),
        Accept: text ? 'text/plain' : 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new GitError(
      error.name === 'AbortError' ? `GitLab не ответил за ${REQUEST_TIMEOUT / 1000} с` : `Нет связи с ${new URL(base).host}`,
      { code: 'NETWORK', hint: 'Проверьте интернет, VPN и адрес сервера GitLab', details: error.message },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = '';
    let fields = null;
    try {
      const data = await res.json();
      if (data.message && typeof data.message === 'object') fields = data.message;
      message = data.message ? (typeof data.message === 'string' ? data.message : JSON.stringify(data.message)) : data.error ?? '';
    } catch {
      /* тело не JSON */
    }
    if (res.status === 401) {
      throw new GitError('GitLab отклонил токен', {
        code: 'AUTH',
        hint: 'Токен неверный, отозван или истёк — создайте новый и сохраните его заново',
        details: message,
      });
    }
    if (res.status === 403) {
      throw new GitError('Недостаточно прав', {
        code: 'FORBIDDEN',
        hint: /scope/i.test(message)
          ? 'У токена нет нужного права (scope). Для действий нужен scope «api», для просмотра — «read_api»'
          : 'Ваша роль в проекте не позволяет это действие',
        details: message,
      });
    }
    if (res.status === 404) {
      throw new GitError(notFound ?? 'Не найдено в GitLab', {
        code: 'NOT_FOUND',
        hint: notFound ? null : 'Проект не существует или у токена нет к нему доступа',
        details: message,
      });
    }
    if (res.status === 400 || res.status === 422 || res.status === 409) {
      throw new GitError(validationMessage(fields, message), { code: 'VALIDATION', hint: validationHint(fields, message), details: message });
    }
    if (res.status === 429) throw new GitError('GitLab ограничил частоту запросов — попробуйте через минуту', { code: 'RATE_LIMIT' });
    throw new GitError(`GitLab вернул ошибку ${res.status}`, { code: 'GITLAB_ERROR', details: message });
  }

  if (text) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { text: buf.subarray(Math.max(0, buf.length - MAX_LOG_SIZE)).toString('utf8'), size: buf.length };
  }
  if (res.status === 204) return null;
  return res.json();
}

// Ошибки проверки от GitLab («key: has already been taken») — по-русски
const PHRASES = [
  [/has already been taken/i, 'уже существует'],
  [/can't be blank|is missing/i, 'не может быть пустым'],
  [/is invalid/i, 'недопустимое значение'],
  [/is too long/i, 'слишком длинное'],
  [/is too short/i, 'слишком короткое'],
  [/cannot be masked|must be masked|unable to be masked/i, 'нельзя замаскировать'],
];
const FIELD_NAMES = { key: 'Имя', value: 'Значение', cron: 'Расписание (cron)', cron_timezone: 'Часовой пояс', ref: 'Ветка', description: 'Описание', environment_scope: 'Окружение' };
const translate = (text) => PHRASES.reduce((t, [re, ru]) => t.replace(re, ru), String(text));

function validationMessage(fields, message) {
  if (fields) {
    const parts = Object.entries(fields).map(([k, v]) => `${FIELD_NAMES[k] ?? k}: ${[].concat(v).map(translate).join(', ')}`);
    if (parts.length) return parts.join('; ');
  }
  return message ? translate(message) : 'GitLab отклонил запрос';
}

function validationHint(fields, message) {
  const all = `${JSON.stringify(fields ?? {})} ${message}`;
  if (/mask/i.test(all)) return 'Маскированное значение: одна строка, не короче 8 символов, только буквы, цифры и символы @ : . ~ - _ + / =';
  if (/cron/i.test(all)) return 'Формат cron: «минуты часы день месяц день_недели», например «0 3 * * *» — каждый день в 3:00';
  if (/key/i.test(all)) return 'Имя переменной: латинские буквы, цифры и _';
  return null;
}

async function fetchAll(ctx, apiPath, query = {}, maxPages = 3) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = await request(ctx.remote.base, ctx.token, 'GET', apiPath, { query: { ...query, per_page: 100, page } });
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/* =================== Контекст проекта =================== */

const projectCache = new Map();

async function context(root, preferredRemote) {
  const remote = await detectRemote(root, preferredRemote);
  if (!remote) throw new GitError('У репозитория нет remote', { code: 'NO_REMOTE' });
  if (remote.kind !== 'gitlab') {
    throw new GitError('Remote не похож на GitLab', {
      code: 'NOT_GITLAB',
      hint: 'Если это свой сервер GitLab — сохраните для него токен в настройках',
    });
  }
  const auth = await pickVerified(remote);
  if (!auth.token) {
    const problem = loginProblem(auth.rejected, auth.other);
    throw new GitError(problem ? 'Авторизация репозитория не подходит для пайплайнов' : 'Репозиторий не авторизован', {
      code: 'NO_TOKEN',
      hint: problem ? problem.reason : 'Авторизуйте репозиторий — эта же авторизация работает и для пайплайнов',
    });
  }
  const token = auth.token;

  const key = `${remote.base}|${remote.path}|${tokenValue(token).slice(-6)}`;
  const cached = projectCache.get(key);
  let project = cached && Date.now() - cached.at < PROJECT_CACHE_MS ? cached.project : null;
  if (!project) {
    const p = await request(remote.base, token, 'GET', `/projects/${encodeURIComponent(remote.path)}`);
    project = {
      id: p.id,
      name: p.name_with_namespace ?? p.name,
      path: p.path_with_namespace,
      webUrl: p.web_url,
      defaultBranch: p.default_branch ?? null,
      accessLevel: Math.max(p.permissions?.project_access?.access_level ?? 0, p.permissions?.group_access?.access_level ?? 0),
    };
    projectCache.set(key, { at: Date.now(), project });
  }
  return { remote, token, project, meta: auth.meta ?? {}, source: auth.source };
}

const canWrite = (ctx) => !ctx.meta.scopes || ctx.meta.scopes.includes('api');

/* =================== Токен =================== */

async function tokenInfo(base, token) {
  const user = await request(base, token, 'GET', '/user');
  let self = null;
  try {
    self = await request(base, token, 'GET', '/personal_access_tokens/self');
  } catch {
    self = null; // старый GitLab или токен другого типа — scopes неизвестны
  }
  return {
    user: { username: user.username, name: user.name, avatarUrl: user.avatar_url ?? null },
    scopes: self?.scopes ?? null,
    expiresAt: self?.expires_at ?? null,
    tokenName: self?.name ?? null,
  };
}

async function setToken(root, token, preferredRemote, { alsoForGit = false } = {}) {
  const remote = await detectRemote(root, preferredRemote);
  if (!remote) throw new GitError('У репозитория нет remote', { code: 'NO_REMOTE' });
  const clean = String(token ?? '').trim();
  if (!clean) throw new GitError('Вставьте токен', { code: 'BAD_ARGS' });
  if (/\s/.test(clean)) throw new GitError('В токене не должно быть пробелов', { code: 'BAD_ARGS' });

  const info = await tokenInfo(remote.base, clean);
  if (info.scopes && !info.scopes.some((s) => s === 'api' || s === 'read_api')) {
    throw new GitError('У токена нет доступа к API', {
      code: 'FORBIDDEN',
      hint: `Права токена: ${info.scopes.join(', ')}. Нужен scope «api» (просмотр и действия) или «read_api» (только просмотр)`,
    });
  }
  let projectAccess = true;
  try {
    await request(remote.base, clean, 'GET', `/projects/${encodeURIComponent(remote.path)}`);
  } catch (error) {
    if (error.code === 'NOT_FOUND') projectAccess = false;
    else throw error;
  }

  // Токен привязывается к репозиторию (как вход для Pull/Push)
  const store = readStore();
  store.repos[apiKey(remote)] = {
    ...encrypt(clean),
    url: remote.url,
    base: remote.base,
    path: remote.path,
    user: info.user,
    scopes: info.scopes,
    expiresAt: info.expiresAt,
    tokenName: info.tokenName,
    savedAt: new Date().toISOString(),
  };
  writeStore(store);
  for (const key of projectCache.keys()) if (key.startsWith(`${remote.base}|`)) projectCache.delete(key);

  // Тот же токен — и для Pull/Push по HTTPS, если у репозитория ещё нет своего входа (scope api даёт доступ к репозиторию)
  let gitSaved = false;
  if (alsoForGit && remote.protocol === 'https' && (!info.scopes || info.scopes.includes('api'))) {
    const login = credentials.apiLoginFor(remote.host, remote.path);
    const hasOwn = login.repo || login.other;
    if (!hasOwn) {
      credentials.save(remote.url, { method: 'token', secret: clean, kind: 'gitlab' });
      gitSaved = true;
    }
  }
  return { ...info, projectAccess, base: remote.base, gitSaved };
}

/**
 * Отключить токен CI/CD репозитория: свой токен репозитория, а если его нет — общий токен сервера.
 * Вход репозитория (для Pull/Push) не трогаем — он меняется в окне авторизации.
 */
async function clearToken(root, preferredRemote) {
  const remote = await detectRemote(root, preferredRemote);
  if (!remote) return { removed: false };
  const store = readStore();
  let removed = null;
  if (store.repos[apiKey(remote)]) {
    delete store.repos[apiKey(remote)];
    removed = 'ci';
  } else if (store.hosts[remote.base]) {
    delete store.hosts[remote.base];
    removed = 'shared';
  }
  if (removed) writeStore(store);
  for (const key of projectCache.keys()) if (key.startsWith(`${remote.base}|`)) projectCache.delete(key);
  return { removed: Boolean(removed), shared: removed === 'shared', base: remote.base };
}

/* ---------- Список для настроек ---------- */

const hostOf = (base) => {
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const describeToken = (entry) => ({
  user: entry.user ?? null,
  scopes: entry.scopes ?? null,
  expiresAt: entry.expiresAt ?? null,
  savedAt: entry.savedAt ?? null,
  readable: decrypt(entry) !== null,
});

/** Токены CI/CD: привязанные к репозиториям и общие (сохранённые раньше) — без секретов */
function listTokens() {
  const store = readStore();
  const repos = Object.entries(store.repos).map(([key, e]) => ({
    key: `ci:${key}`,
    hostname: hostOf(e.base ?? key),
    base: e.base ?? key.replace(/^(https?:\/\/[^/]+).*$/, '$1'),
    path: e.path ?? key.replace(/^https?:\/\/[^/]+\//, ''),
    url: e.url ?? null,
    ...describeToken(e),
  }));
  const shared = Object.entries(store.hosts).map(([base, e]) => ({ key: `ci:${base}`, hostname: hostOf(base), base, ...describeToken(e) }));
  return { repos, shared };
}

/** Состояние проверки входа репозитория для API (без сети): 'ok' | 'bad' | null — ещё не проверялся */
function loginApiState(hostname, repoPath, base) {
  const login = credentials.apiLoginFor(hostname, repoPath);
  if (!login.repo) return null;
  const st = loginCheckState(base ?? `https://${hostname}`, login.repo.secret);
  return st && st.state !== 'pending'
    ? { state: st.state, reason: st.reason ?? null, user: st.info?.user ?? null, scopes: st.info?.scopes ?? null, viaApiToken: login.repo.viaApiToken }
    : null;
}

/** Забыть токен CI/CD по ключу из списка («ci:https://host/group/app» или «ci:https://host») */
function forgetToken(key) {
  const k = String(key ?? '').replace(/^ci:/, '');
  const store = readStore();
  let removed = false;
  if (store.repos[k]) {
    delete store.repos[k];
    removed = true;
  } else if (store.hosts[k]) {
    delete store.hosts[k];
    removed = true;
  }
  if (removed) {
    writeStore(store);
    projectCache.clear();
  }
  return { removed };
}

/** Забыть старый токен CI/CD репозитория (вместе с авторизацией репозитория) */
function forgetRepoToken(hostname, repoPath) {
  const h = String(hostname ?? '').toLowerCase();
  const p = String(repoPath ?? '').toLowerCase();
  const store = readStore();
  let removed = false;
  for (const [k, e] of Object.entries(store.repos)) {
    if (hostOf(e.base ?? k) === h && String(e.path ?? '').toLowerCase() === p) {
      delete store.repos[k];
      removed = true;
    }
  }
  if (removed) {
    writeStore(store);
    projectCache.clear();
  }
  return { removed };
}

/** Забыть все токены CI/CD сервера */
function forgetHost(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  const store = readStore();
  let removed = false;
  for (const [k, e] of Object.entries(store.repos)) {
    if (hostOf(e.base ?? k) === h) {
      delete store.repos[k];
      removed = true;
    }
  }
  for (const k of Object.keys(store.hosts)) {
    if (hostOf(k) === h) {
      delete store.hosts[k];
      removed = true;
    }
  }
  if (removed) {
    writeStore(store);
    projectCache.clear();
  }
  return { removed };
}

/* =================== Пайплайны =================== */

const pipelineSummary = (p) => ({
  id: p.id,
  iid: p.iid ?? null,
  sha: p.sha,
  ref: p.ref,
  status: p.status,
  source: p.source ?? null,
  name: p.name ?? null,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  webUrl: p.web_url,
});

async function listPipelines(root, { ref, preferredRemote } = {}) {
  const ctx = await context(root, preferredRemote);
  const items = await request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/pipelines`, {
    query: { per_page: 60, order_by: 'id', sort: 'desc', ref: ref || undefined },
  });
  const pipelines = items.map(pipelineSummary);
  // Для графа: последний пайплайн каждого коммита
  const bySha = {};
  for (const p of pipelines) if (!bySha[p.sha]) bySha[p.sha] = { id: p.id, status: p.status, ref: p.ref, webUrl: p.webUrl };
  return { project: ctx.project, canWrite: canWrite(ctx), pipelines, bySha };
}

const STATUS_ORDER = ['failed', 'running', 'pending', 'preparing', 'waiting_for_resource', 'scheduled', 'manual', 'canceling', 'canceled', 'created', 'success', 'skipped'];

function aggregateStatus(jobs) {
  const statuses = jobs.map((j) => (j.status === 'failed' && j.allowFailure ? 'success' : j.status));
  if (statuses.length && statuses.every((s) => s === 'skipped')) return 'skipped';
  for (const s of STATUS_ORDER) if (statuses.includes(s)) return s === 'skipped' ? 'success' : s;
  return 'created';
}

function jobSummary(j, kind = 'job') {
  return {
    id: j.id,
    kind,
    name: j.name,
    stage: j.stage,
    status: j.status,
    allowFailure: Boolean(j.allow_failure),
    when: j.when ?? null,
    duration: j.duration ?? null,
    queuedDuration: j.queued_duration ?? null,
    createdAt: j.created_at ?? null,
    startedAt: j.started_at ?? null,
    finishedAt: j.finished_at ?? null,
    webUrl: j.web_url ?? null,
    failureReason: j.failure_reason ?? null,
    coverage: j.coverage ?? null,
    tags: j.tag_list ?? [],
    runner: j.runner ? { id: j.runner.id, description: j.runner.description ?? null, shared: j.runner.is_shared ?? null } : null,
    user: j.user ? { name: j.user.name, username: j.user.username } : null,
    artifacts: (j.artifacts ?? []).filter((a) => a.file_type !== 'trace').map((a) => ({ type: a.file_type, size: a.size })),
    downstream: j.downstream_pipeline
      ? { id: j.downstream_pipeline.id, status: j.downstream_pipeline.status, webUrl: j.downstream_pipeline.web_url, projectId: j.downstream_pipeline.project_id }
      : null,
  };
}

async function pipelineDetail(root, pipelineId, { preferredRemote } = {}) {
  const id = Number(pipelineId);
  if (!Number.isInteger(id) || id <= 0) throw new GitError('Некорректный номер пайплайна', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  const pid = ctx.project.id;
  const [p, jobs, bridges] = await Promise.all([
    request(ctx.remote.base, ctx.token, 'GET', `/projects/${pid}/pipelines/${id}`, { notFound: `Пайплайн #${id} не найден — возможно, его удалили` }),
    fetchAll(ctx, `/projects/${pid}/pipelines/${id}/jobs`),
    fetchAll(ctx, `/projects/${pid}/pipelines/${id}/bridges`, {}, 1).catch(() => []),
  ]);
  const all = [...jobs.map((j) => jobSummary(j)), ...bridges.map((b) => jobSummary(b, 'bridge'))];
  // Порядок этапов — по самому раннему заданию этапа (GitLab создаёт задания по порядку этапов)
  const firstId = new Map();
  for (const j of all) firstId.set(j.stage, Math.min(firstId.get(j.stage) ?? Infinity, j.id));
  const stages = [...firstId.keys()]
    .sort((a, b) => firstId.get(a) - firstId.get(b))
    .map((name) => {
      const list = all.filter((j) => j.stage === name).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { name, status: aggregateStatus(list), jobs: list };
    });
  return {
    project: ctx.project,
    canWrite: canWrite(ctx),
    pipeline: {
      ...pipelineSummary(p),
      user: p.user ? { name: p.user.name, username: p.user.username, avatarUrl: p.user.avatar_url ?? null } : null,
      duration: p.duration ?? null,
      queuedDuration: p.queued_duration ?? null,
      startedAt: p.started_at ?? null,
      finishedAt: p.finished_at ?? null,
      coverage: p.coverage ?? null,
      yamlErrors: p.yaml_errors ?? null,
      detailedStatus: p.detailed_status?.text ?? null,
      beforeSha: p.before_sha ?? null,
    },
    stages,
  };
}

async function jobLog(root, jobId, { preferredRemote } = {}) {
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) throw new GitError('Некорректный номер задания', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  const [job, trace] = await Promise.all([
    request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/jobs/${id}`, { notFound: `Задание #${id} не найдено — возможно, его удалили` }),
    request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/jobs/${id}/trace`, { text: true }).catch((error) => {
      if (error.code === 'NOT_FOUND') return { text: '', size: 0 };
      throw error;
    }),
  ]);
  return { job: jobSummary(job), text: trace.text, size: trace.size, truncated: trace.size > MAX_LOG_SIZE };
}

/* =================== Действия =================== */

const ACTIONS = {
  'job.retry': (ctx, a) => ['POST', `/projects/${ctx.project.id}/jobs/${a.id}/retry`],
  'job.cancel': (ctx, a) => ['POST', `/projects/${ctx.project.id}/jobs/${a.id}/cancel`],
  'job.play': (ctx, a) => ['POST', `/projects/${ctx.project.id}/jobs/${a.id}/play`],
  'pipeline.retry': (ctx, a) => ['POST', `/projects/${ctx.project.id}/pipelines/${a.id}/retry`],
  'pipeline.cancel': (ctx, a) => ['POST', `/projects/${ctx.project.id}/pipelines/${a.id}/cancel`],
  'pipeline.create': (ctx, a) => ['POST', `/projects/${ctx.project.id}/pipeline`, { ref: a.ref }],
};

async function runPipelineAction(root, action, { preferredRemote } = {}) {
  const make = ACTIONS[action?.type];
  if (!make) throw new GitError('Неизвестное действие', { code: 'BAD_ARGS' });
  if (action.type === 'pipeline.create') {
    if (typeof action.ref !== 'string' || !action.ref.trim()) throw new GitError('Не указана ветка', { code: 'BAD_ARGS' });
  } else if (!Number.isInteger(Number(action.id)) || Number(action.id) <= 0) {
    throw new GitError('Некорректный номер', { code: 'BAD_ARGS' });
  }
  const ctx = await context(root, preferredRemote);
  if (!canWrite(ctx)) {
    throw new GitError('Токен только для чтения', {
      code: 'FORBIDDEN',
      hint: 'Для запуска и отмены нужен токен со scope «api» — создайте новый и сохраните его',
    });
  }
  const [method, apiPath, body] = make(ctx, action);
  const result = await request(ctx.remote.base, ctx.token, method, apiPath, { body });
  return { type: action.type, id: result?.id ?? action.id, status: result?.status ?? null, webUrl: result?.web_url ?? null };
}

/* =================== Переменные и раннеры =================== */

async function listVariables(root, { preferredRemote } = {}) {
  const ctx = await context(root, preferredRemote);
  const vars = await fetchAll(ctx, `/projects/${ctx.project.id}/variables`);
  // Значения не отдаём списком — только по явному запросу «показать»
  return {
    project: ctx.project,
    variables: vars.map((v) => ({
      key: v.key,
      type: v.variable_type,
      protected: Boolean(v.protected),
      masked: Boolean(v.masked),
      hidden: Boolean(v.hidden),
      raw: Boolean(v.raw),
      scope: v.environment_scope ?? '*',
      description: v.description ?? null,
      empty: v.value === '' || v.value == null,
    })),
  };
}

async function variableValue(root, { key, scope }, { preferredRemote } = {}) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_]+$/.test(key)) throw new GitError('Некорректное имя переменной', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  const v = await request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/variables/${key}`, {
    notFound: `Переменная ${key} не найдена — возможно, её удалили`,
    query: scope && scope !== '*' ? { 'filter[environment_scope]': scope } : {},
  });
  if (v.hidden || v.value == null) return { key, hidden: true, value: null };
  return { key, hidden: false, value: v.value };
}

async function listRunners(root, { preferredRemote } = {}) {
  const ctx = await context(root, preferredRemote);
  const runners = await fetchAll(ctx, `/projects/${ctx.project.id}/runners`, {}, 1);
  return {
    project: ctx.project,
    runners: runners.map((r) => ({
      id: r.id,
      description: r.description || r.name || `#${r.id}`,
      status: r.status ?? (r.online ? 'online' : 'offline'),
      paused: r.paused ?? r.active === false,
      shared: Boolean(r.is_shared),
      type: r.runner_type ?? null,
    })),
  };
}

/* =================== Проверка CI (CI Lint) =================== */

async function lintCi(root, { content, ref }, { preferredRemote } = {}) {
  if (typeof content !== 'string') throw new GitError('Нет содержимого', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  const res = await request(ctx.remote.base, ctx.token, 'POST', `/projects/${ctx.project.id}/ci/lint`, {
    body: { content, dry_run: true, include_jobs: true, ...(ref ? { ref } : {}) },
    notFound: 'Этот сервер GitLab не поддерживает проверку CI по API (нужен GitLab 13.6 или новее)',
  });
  return {
    valid: Boolean(res.valid),
    errors: res.errors ?? [],
    warnings: res.warnings ?? [],
    jobs: (res.jobs ?? []).map((j) => ({
      name: j.name,
      stage: j.stage,
      when: j.when ?? 'on_success',
      allowFailure: Boolean(j.allow_failure),
      tags: j.tag_list ?? [],
      environment: j.environment ?? null,
    })),
    includes: (res.includes ?? []).map((i) => ({ type: i.type, location: i.location, blob: i.blob ?? null })),
    ref: ref ?? null,
  };
}

/* =================== Переменные: изменение =================== */

const VAR_KEY = /^[A-Za-z0-9_]+$/;
const requireWrite = (ctx) => {
  if (!canWrite(ctx)) {
    throw new GitError('Токен только для чтения', {
      code: 'FORBIDDEN',
      hint: 'Для изменений нужен токен со scope «api» — создайте новый и сохраните его в настройках',
    });
  }
};

function variableBody(v) {
  const body = {
    key: v.key,
    variable_type: v.type === 'file' ? 'file' : 'env_var',
    protected: Boolean(v.protected),
    masked: Boolean(v.masked || v.hidden),
    raw: Boolean(v.raw),
    environment_scope: v.scope?.trim() || '*',
    description: v.description ?? '',
  };
  if (typeof v.value === 'string') body.value = v.value;
  return body;
}

// GitLab отвечает на неподходящее для маскировки значение просто «value is invalid» — подсказываем, в чём дело
async function saveVariable(root, args, opts) {
  try {
    return await saveVariableRaw(root, args, opts);
  } catch (error) {
    const v = args?.variable ?? {};
    if (error.code === 'VALIDATION' && (v.masked || v.hidden) && /value/i.test(error.details ?? '') && !error.hint) {
      error.hint = 'Маскированное значение: одна строка, не короче 8 символов, только буквы, цифры и символы @ : . ~ - _ + / =';
    }
    throw error;
  }
}

async function saveVariableRaw(root, { original, variable }, { preferredRemote } = {}) {
  const v = variable ?? {};
  if (!VAR_KEY.test(v.key ?? '')) throw new GitError('Имя переменной: только латинские буквы, цифры и _', { code: 'INVALID_NAME' });
  if (typeof v.value === 'string' && v.value.length > 10000) throw new GitError('Значение слишком длинное', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  requireWrite(ctx);
  const base = `/projects/${ctx.project.id}/variables`;

  if (!original) {
    if (typeof v.value !== 'string') throw new GitError('Введите значение', { code: 'BAD_ARGS' });
    const body = variableBody(v);
    if (v.hidden) body.masked_and_hidden = true;
    await request(ctx.remote.base, ctx.token, 'POST', base, { body });
    return { key: v.key, scope: body.environment_scope, created: true };
  }

  const scopeQuery = (scope) => (scope && scope !== '*' ? { 'filter[environment_scope]': scope } : {});
  // Значение не меняли — GitLab всё равно требует его в запросе: берём текущее
  let value = v.value;
  if (typeof value !== 'string') {
    const cur = await request(ctx.remote.base, ctx.token, 'GET', `${base}/${original.key}`, { query: scopeQuery(original.scope) });
    if (cur.hidden || cur.value == null) {
      throw new GitError('Значение скрытой переменной нельзя прочитать — введите его заново', { code: 'BAD_ARGS' });
    }
    value = cur.value;
  }
  const body = variableBody({ ...v, value });
  // Имя или окружение поменялись — GitLab не умеет переименовывать: создаём новую и удаляем старую
  if (original.key !== v.key || (original.scope ?? '*') !== body.environment_scope) {
    await request(ctx.remote.base, ctx.token, 'POST', base, { body });
    await request(ctx.remote.base, ctx.token, 'DELETE', `${base}/${original.key}`, { query: scopeQuery(original.scope) });
    return { key: v.key, scope: body.environment_scope, renamed: true };
  }
  await request(ctx.remote.base, ctx.token, 'PUT', `${base}/${original.key}`, { body, query: scopeQuery(original.scope) });
  return { key: v.key, scope: body.environment_scope, updated: true };
}

async function deleteVariable(root, { key, scope }, { preferredRemote } = {}) {
  if (!VAR_KEY.test(key ?? '')) throw new GitError('Некорректное имя переменной', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  requireWrite(ctx);
  await request(ctx.remote.base, ctx.token, 'DELETE', `/projects/${ctx.project.id}/variables/${key}`, {
    query: scope && scope !== '*' ? { 'filter[environment_scope]': scope } : {},
    notFound: `Переменная ${key} уже удалена`,
  });
  return { key, scope: scope ?? '*', deleted: true };
}

/* =================== Расписания пайплайнов =================== */

const scheduleSummary = (s) => ({
  id: s.id,
  description: s.description ?? '',
  ref: String(s.ref ?? '').replace(/^refs\/heads\//, ''),
  cron: s.cron,
  timezone: s.cron_timezone ?? 'UTC',
  nextRunAt: s.next_run_at ?? null,
  active: Boolean(s.active),
  owner: s.owner ? { name: s.owner.name, username: s.owner.username } : null,
  lastPipeline: s.last_pipeline ? { id: s.last_pipeline.id, status: s.last_pipeline.status, webUrl: s.last_pipeline.web_url ?? null } : null,
  webUrl: null,
});

async function listSchedules(root, { preferredRemote } = {}) {
  const ctx = await context(root, preferredRemote);
  const list = await fetchAll(ctx, `/projects/${ctx.project.id}/pipeline_schedules`, {}, 1);
  // В списке нет последнего запуска — подгружаем детали (их обычно немного)
  const detailed = await Promise.all(
    list.slice(0, 30).map((s) =>
      request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/pipeline_schedules/${s.id}`).catch(() => s),
    ),
  );
  return {
    project: ctx.project,
    canWrite: canWrite(ctx),
    me: ctx.meta.user?.username ?? null,
    schedules: detailed.map((s) => ({ ...scheduleSummary(s), webUrl: `${ctx.project.webUrl}/-/pipeline_schedules` })),
  };
}

const CRON_RE = /^(\S+\s+){4}\S+$/;

async function saveSchedule(root, schedule, { preferredRemote } = {}) {
  const s = schedule ?? {};
  if (!String(s.description ?? '').trim()) throw new GitError('Введите описание расписания', { code: 'BAD_ARGS' });
  if (!String(s.ref ?? '').trim()) throw new GitError('Выберите ветку', { code: 'BAD_ARGS' });
  if (!CRON_RE.test(String(s.cron ?? '').trim())) {
    throw new GitError('Неверный формат cron', { code: 'BAD_ARGS', hint: 'Пять полей через пробел: минуты часы день месяц день_недели, например «0 3 * * *»' });
  }
  const ctx = await context(root, preferredRemote);
  requireWrite(ctx);
  const body = {
    description: String(s.description).trim(),
    ref: String(s.ref).trim(),
    cron: String(s.cron).trim(),
    cron_timezone: s.timezone || 'UTC',
    active: s.active !== false,
  };
  const base = `/projects/${ctx.project.id}/pipeline_schedules`;
  const res = s.id
    ? await request(ctx.remote.base, ctx.token, 'PUT', `${base}/${Number(s.id)}`, { body, notFound: 'Расписание не найдено — возможно, его удалили' })
    : await request(ctx.remote.base, ctx.token, 'POST', base, { body });
  return scheduleSummary(res);
}

async function scheduleAction(root, { id, type }, { preferredRemote } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new GitError('Некорректный номер расписания', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  requireWrite(ctx);
  const base = `/projects/${ctx.project.id}/pipeline_schedules/${n}`;
  const notFound = 'Расписание не найдено — возможно, его удалили';
  if (type === 'delete') await request(ctx.remote.base, ctx.token, 'DELETE', base, { notFound });
  else if (type === 'play') await request(ctx.remote.base, ctx.token, 'POST', `${base}/play`, { notFound });
  else if (type === 'own') await request(ctx.remote.base, ctx.token, 'POST', `${base}/take_ownership`, { notFound });
  else throw new GitError('Неизвестное действие', { code: 'BAD_ARGS' });
  return { id: n, type };
}

/* =================== Merge request =================== */

async function createMergeRequest(root, { source, target, title, description, draft = false, removeSource = false }, { preferredRemote } = {}) {
  for (const [v, what] of [[source, 'исходная ветка'], [target, 'целевая ветка']]) {
    if (typeof v !== 'string' || !v.trim() || v.startsWith('-')) throw new GitError(`Не указана ${what}`, { code: 'BAD_ARGS' });
  }
  if (source === target) throw new GitError('Исходная и целевая ветки совпадают', { code: 'BAD_ARGS' });
  const ctx = await context(root, preferredRemote);
  requireWrite(ctx);
  const t = String(title ?? '').trim() || source;
  try {
    const mr = await request(ctx.remote.base, ctx.token, 'POST', `/projects/${ctx.project.id}/merge_requests`, {
      body: {
        source_branch: source,
        target_branch: target,
        title: draft && !/^draft:/i.test(t) ? `Draft: ${t}` : t,
        description: description ?? '',
        remove_source_branch: Boolean(removeSource),
      },
    });
    return { iid: mr.iid, webUrl: mr.web_url, created: true, title: mr.title };
  } catch (error) {
    // MR для этой ветки уже есть — просто открываем его
    if (error.code === 'VALIDATION' && /already exists|уже существует/i.test(`${error.details} ${error.message}`)) {
      const list = await request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/merge_requests`, {
        query: { state: 'opened', source_branch: source, target_branch: target },
      }).catch(() => []);
      if (list[0]) return { iid: list[0].iid, webUrl: list[0].web_url, created: false, title: list[0].title };
    }
    if (error.code === 'VALIDATION' && /source.?branch|does not exist|не существует/i.test(`${error.details}`)) {
      error.hint = 'Сначала отправьте ветку на сервер (Push).';
    }
    throw error;
  }
}

/* =================== Лёгкая проверка веток (для фонового опроса) =================== */

// URL → { etag, list, next }. Ответ 304 на If-None-Match почти ничего не стоит серверу и не тратит трафик
const etagCache = new Map();
const LIGHT_TIMEOUT = 8000;
const LIGHT_MAX_PAGES = 20;

/**
 * Хэши веток на сервере через GitLab API (с ETag), без запуска git.
 * → Map имя → хэш, либо null, если для этого remote нет токена GitLab (тогда — ls-remote).
 */
async function branchHeads(root, remoteName) {
  const remote = await detectRemote(root, remoteName);
  if (!remote || remote.kind !== 'gitlab' || remote.remote !== remoteName) return null;
  const token = tokenForRemote(remote);
  if (!token) return null;

  const doFetch = electron?.net?.fetch ? electron.net.fetch.bind(electron.net) : fetch;
  const heads = new Map();
  let page = 1;
  for (let i = 0; i < LIGHT_MAX_PAGES; i++) {
    const url = `${remote.base}/api/v4/projects/${encodeURIComponent(remote.path)}/repository/branches?per_page=100&page=${page}`;
    const cached = etagCache.get(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIGHT_TIMEOUT);
    let res;
    try {
      res = await doFetch(url, {
        headers: { ...authHeaders(token), Accept: 'application/json', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
        signal: controller.signal,
      });
    } catch (error) {
      throw new GitError(`Нет связи с ${remote.host}`, { code: 'NETWORK', details: error.message });
    } finally {
      clearTimeout(timer);
    }
    let entry;
    if (res.status === 304 && cached) entry = cached;
    else if (res.ok) {
      const body = await res.json();
      entry = {
        etag: res.headers.get('etag'),
        list: Array.isArray(body) ? body.map((b) => [b.name, b.commit?.id]).filter(([n, h]) => n && h) : [],
        next: res.headers.get('x-next-page') || null,
      };
      if (entry.etag) {
        etagCache.set(url, entry);
        if (etagCache.size > 300) etagCache.delete(etagCache.keys().next().value);
      }
    } else if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || null;
      const err = new GitError('GitLab ограничил частоту запросов', { code: 'RATE_LIMIT', details: retryAfter ? `retry-after: ${retryAfter}` : '' });
      err.retryAfter = retryAfter;
      throw err;
    } else {
      // 401/403/404 и прочее — токен не подходит для этого проекта; вызывающий перейдёт на ls-remote
      throw new GitError(`GitLab вернул ${res.status}`, { code: res.status === 401 ? 'AUTH' : res.status === 403 ? 'FORBIDDEN' : 'GITLAB_ERROR' });
    }
    for (const [n, h] of entry.list) heads.set(n, h);
    if (!entry.next) break;
    page = Number(entry.next);
  }
  return heads;
}

module.exports = {
  branchHeads,
  createMergeRequest,
  lintCi,
  saveVariable,
  deleteVariable,
  listSchedules,
  saveSchedule,
  scheduleAction,
  parseRemoteUrl,
  detectRemote,
  setToken,
  clearToken,
  listTokens,
  loginApiState,
  forgetToken,
  forgetHost,
  forgetRepoToken,
  verifyLogin,
  checkLoginApi,
  listPipelines,
  pipelineDetail,
  jobLog,
  runPipelineAction,
  listVariables,
  variableValue,
  listRunners,
};
