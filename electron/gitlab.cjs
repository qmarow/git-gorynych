// Интеграция с GitLab API: статусы пайплайнов, задания, логи, действия, переменные и раннеры.
// Токен хранится зашифрованным (Electron safeStorage → DPAPI на Windows) и никогда не уходит в renderer.
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

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

const tokenFor = (base) => decrypt(readStore().hosts[base]);

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
  const parsed = parseRemoteUrl(remotes.get(name));
  if (!parsed) return null;
  const base = `${parsed.protocol}://${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`;
  const store = readStore();
  const meta = store.hosts[base];
  const looksLikeGitlab = /gitlab/i.test(parsed.host) || Boolean(meta);
  return {
    kind: looksLikeGitlab ? 'gitlab' : null,
    remote: name,
    host: parsed.host,
    base,
    path: parsed.path,
    webUrl: `${base}/${parsed.path}`,
    token: meta
      ? { configured: true, user: meta.user ?? null, scopes: meta.scopes ?? null, expiresAt: meta.expiresAt ?? null, savedAt: meta.savedAt }
      : { configured: false },
  };
}

/* =================== HTTP =================== */

async function request(base, token, method, apiPath, { query, body, text = false } = {}) {
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
        'PRIVATE-TOKEN': token,
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
    try {
      const data = await res.json();
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
      throw new GitError('Не найдено в GitLab', {
        code: 'NOT_FOUND',
        hint: 'Проект не существует или у токена нет к нему доступа',
        details: message,
      });
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
  const token = tokenFor(remote.base);
  if (!token) throw new GitError('Не настроен токен GitLab', { code: 'NO_TOKEN', hint: 'Добавьте личный токен доступа' });

  const key = `${remote.base}|${remote.path}|${token.slice(-6)}`;
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
  return { remote, token, project, meta: readStore().hosts[remote.base] ?? {} };
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

async function setToken(root, token, preferredRemote) {
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

  const store = readStore();
  store.hosts[remote.base] = {
    ...encrypt(clean),
    user: info.user,
    scopes: info.scopes,
    expiresAt: info.expiresAt,
    tokenName: info.tokenName,
    savedAt: new Date().toISOString(),
  };
  writeStore(store);
  for (const key of projectCache.keys()) if (key.startsWith(`${remote.base}|`)) projectCache.delete(key);
  return { ...info, projectAccess, base: remote.base };
}

async function clearToken(root, preferredRemote) {
  const remote = await detectRemote(root, preferredRemote);
  if (!remote) return { removed: false };
  const store = readStore();
  const removed = Boolean(store.hosts[remote.base]);
  delete store.hosts[remote.base];
  writeStore(store);
  for (const key of projectCache.keys()) if (key.startsWith(`${remote.base}|`)) projectCache.delete(key);
  return { removed, base: remote.base };
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
    request(ctx.remote.base, ctx.token, 'GET', `/projects/${pid}/pipelines/${id}`),
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
    request(ctx.remote.base, ctx.token, 'GET', `/projects/${ctx.project.id}/jobs/${id}`),
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

module.exports = {
  parseRemoteUrl,
  detectRemote,
  setToken,
  clearToken,
  listPipelines,
  pipelineDetail,
  jobLog,
  runPipelineAction,
  listVariables,
  variableValue,
  listRunners,
};
