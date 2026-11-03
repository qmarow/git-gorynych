// Единый слой CI/CD (ICiCdProvider): определяет провайдера репозитория, берёт авторизацию репозитория
// (ту же, что для Pull/Push) и отдаёт интерфейсу нормализованные пайплайны, задания, раннеры, артефакты и секреты.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { git } = require('../git.cjs');
const { GitError } = require('../errors.cjs');
const credentials = require('../credentials.cjs');
const gl = require('../gitlab.cjs');
const ci = require('../ci.cjs');
const settings = require('./settings.cjs');
const M = require('./models.cjs');
const runnerSetup = require('./runnerSetup.cjs');
const { checkRunnerTags } = require('./tagCheck.cjs');
const { t } = require('../i18n.cjs');

const ADAPTERS = {
  gitlab: require('./gitlab.cjs'),
  github: require('./github.cjs'),
  gitea: require('./gitea.cjs'),
  bitbucket: require('./bitbucket.cjs'),
};

const LABELS = { gitlab: 'GitLab CI', github: 'GitHub Actions', gitea: 'Gitea / Forgejo Actions', bitbucket: 'Bitbucket Pipelines' };

/* =================== Remote → провайдер =================== */

async function remotes(root) {
  const out = await git(root, ['remote', '-v']).catch(() => '');
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Провайдер по файлам CI в репозитории — когда сервер не опознан по имени */
function kindFromFiles(root) {
  const has = (rel) => {
    try {
      return fs.statSync(path.join(root, rel)).isDirectory();
    } catch {
      return false;
    }
  };
  if (has('.gitea/workflows') || has('.forgejo/workflows')) return 'gitea';
  return null;
}

/** Адрес API провайдера: свой из настроек или стандартный */
function apiBaseFor(kind, host, siteBase, override) {
  if (override) {
    if (kind === 'github' && !/\/api\/v3$/.test(override) && override !== 'https://api.github.com' && !/^https?:\/\/api\./.test(override)) return `${override}/api/v3`;
    if (kind === 'gitea' && !/\/api\/v1$/.test(override)) return `${override}/api/v1`;
    return override;
  }
  if (kind === 'github') return host === 'github.com' ? 'https://api.github.com' : `${siteBase}/api/v3`;
  if (kind === 'gitea') return `${siteBase}/api/v1`;
  if (kind === 'bitbucket') return host === 'bitbucket.org' ? 'https://api.bitbucket.org/2.0' : `${siteBase}/rest/api/1.0`;
  return null;
}

/** Remote репозитория и провайдер CI/CD. null — remote нет или адрес не разобрать */
async function resolveRemote(root, preferredRemote) {
  const map = await remotes(root);
  if (!map.size) return null;
  const name = [preferredRemote, 'origin', ...map.keys()].find((n) => n && map.has(n));
  const url = map.get(name);
  const parsed = gl.parseRemoteUrl(url);
  if (!parsed) return null;
  const isHttp = /^https?:\/\//i.test(url);
  const siteBase = (!isHttp && credentials.serverBase(parsed.host)?.replace(/\/+$/, '')) || `${parsed.protocol}://${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`;
  const conf = settings.get(parsed.host, parsed.path);
  let kind = conf?.provider ?? null;
  if (!kind) {
    const k = credentials.serverKind(parsed.host);
    kind = ['gitlab', 'github', 'gitea', 'bitbucket'].includes(k) ? k : null;
  }
  if (!kind) kind = kindFromFiles(root);
  return { name, url, host: parsed.host, path: parsed.path, siteBase, kind, conf, protocol: isHttp ? 'https' : 'ssh' };
}

/* =================== Авторизация (GitHub, Gitea, Bitbucket) =================== */

const checks = new Map(); // отпечаток → { state, user, reason, at, promise }
const fp = (...parts) => crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);

function loginFor(r) {
  const login = credentials.apiLoginFor(r.host, r.path, r.kind);
  return { login: login.repo ?? login.shared ?? null, other: login.other };
}

function httpCtx(r, login) {
  const label = { github: 'GitHub', gitea: 'Gitea', bitbucket: 'Bitbucket' }[r.kind];
  const apiBase = apiBaseFor(r.kind, r.host, r.siteBase, r.conf?.apiBase);
  const isToken = login.viaApiToken || login.method === 'token';
  let headers;
  if (r.kind === 'github') headers = { Authorization: `Bearer ${login.secret}`, 'X-GitHub-Api-Version': '2022-11-28' };
  else if (r.kind === 'gitea') headers = { Authorization: isToken ? `token ${login.secret}` : `Basic ${Buffer.from(`${login.username ?? ''}:${login.secret}`).toString('base64')}` };
  else {
    const user = login.username && login.username !== 'x-token-auth' ? login.username : null;
    headers = { Authorization: isToken || !user ? `Bearer ${login.secret}` : `Basic ${Buffer.from(`${user}:${login.secret}`).toString('base64')}` };
  }
  const [owner, ...rest] = r.path.split('/');
  return {
    kind: r.kind,
    label,
    host: r.host,
    apiBase,
    apiOverride: Boolean(r.conf?.apiBase),
    headers,
    owner,
    repo: rest.join('/'),
    siteBase: r.siteBase,
    webUrl: `${r.siteBase}/${r.path}`,
    scopeHint:
      r.kind === 'github'
        ? t('Токену нужны права repo и workflow (классический) или Actions, Administration и Secrets (fine-grained)')
        : r.kind === 'gitea'
          ? t('Токену нужны права write:repository (и read:user)')
          : t('Паролю приложения нужны права Pipelines: Read/Write и Repositories: Read'),
  };
}

/** Проверить авторизацию для API (результат кэшируется до смены токена; при ошибке — на 10 минут) */
function verify(r, login) {
  const key = fp(r.kind, r.host, r.path, r.conf?.apiBase ?? '', login.secret);
  const cached = checks.get(key);
  if (cached && (cached.state === 'ok' || Date.now() - cached.at < 10 * 60 * 1000)) return cached.promise ?? Promise.resolve(cached);
  const entry = { state: 'pending', at: Date.now() };
  entry.promise = (async () => {
    const ctx = httpCtx(r, login);
    const adapter = ADAPTERS[r.kind];
    try {
      const user = await adapter.whoami(ctx).catch((error) => (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN' ? null : Promise.reject(error)));
      await adapter.init(ctx);
      Object.assign(entry, { state: 'ok', user, at: Date.now(), promise: null, flags: { canWrite: ctx.canWrite, isAdmin: ctx.isAdmin, defaultBranch: ctx.defaultBranch, webUrl: ctx.webUrl } });
    } catch (error) {
      if (error.code === 'NETWORK' || error.code === 'RATE_LIMIT') {
        checks.delete(key);
        return { state: 'unknown', reason: error.message };
      }
      Object.assign(entry, { state: 'bad', reason: error.message, hint: error.hint ?? null, code: error.code, at: Date.now(), promise: null });
    }
    return entry;
  })();
  checks.set(key, entry);
  return entry.promise;
}
const verifyState = (r, login) => checks.get(fp(r.kind, r.host, r.path, r.conf?.apiBase ?? '', login.secret)) ?? null;

function loginProblemText(r, other, bad) {
  const label = LABELS[r.kind];
  if (bad) return t('Авторизация репозитория не подходит для {0}: {1}{2}', label, bad.reason, bad.hint ? ` — ${bad.hint}` : '');
  if (other?.method === 'ssh') return t('Репозиторий авторизован SSH-ключом — его принимает git, но не API {0}. Добавьте в авторизацию репозитория токен для пайплайнов.', label);
  return null;
}

/* =================== Статус для интерфейса =================== */

/**
 * Провайдер CI/CD репозитория и состояние авторизации (без сети для GitLab; для остальных — проверка в фоне).
 * → forge: { kind, provider, label, host, base, path, webUrl, apiBase, remote, url, protocol, token, capabilities, settings }
 */
async function detect(root, preferredRemote) {
  const r = await resolveRemote(root, preferredRemote);
  if (!r) return null;
  const common = { settings: r.conf ? { provider: r.conf.provider ?? null, apiBase: r.conf.apiBase ?? null } : null, detectedKind: credentials.serverKind(r.host) ?? null };
  if (r.kind === 'gitlab' || !r.kind) {
    const g = await gl.detectRemote(root, preferredRemote);
    if (!g) return null;
    if (g.kind === 'gitlab') {
      const scopes = g.token?.scopes;
      const write = !scopes || scopes.includes('api');
      return {
        ...g,
        ...common,
        provider: 'gitlab',
        label: LABELS.gitlab,
        apiBase: `${g.base}/api/v4`,
        capabilities: ADAPTERS.gitlab.capabilities({ meta: { scopes }, project: null, ...(write ? {} : {}) }),
      };
    }
    return { ...g, ...common, kind: null, provider: null, label: null, capabilities: M.NO_CAPS };
  }
  const base = {
    kind: r.kind,
    provider: r.kind,
    label: LABELS[r.kind],
    remote: r.name,
    url: r.url,
    protocol: r.protocol,
    host: r.host,
    base: r.siteBase,
    path: r.path,
    webUrl: `${r.siteBase}/${r.path}`,
    apiBase: apiBaseFor(r.kind, r.host, r.siteBase, r.conf?.apiBase),
    ...common,
  };
  const { login, other } = loginFor(r);
  if (!login) {
    return { ...base, token: { configured: false, repoLogin: other ? { method: other.method, reason: loginProblemText(r, other) } : null }, capabilities: M.NO_CAPS };
  }
  const st = verifyState(r, login);
  if (st?.state === 'bad') {
    return {
      ...base,
      token: { configured: false, repoLogin: { method: login.method, reason: loginProblemText(r, null, st) } },
      capabilities: M.NO_CAPS,
    };
  }
  if (!st) verify(r, login).catch(() => {});
  const adapter = ADAPTERS[r.kind];
  const flags = st?.flags ?? {};
  return {
    ...base,
    webUrl: flags.webUrl ?? base.webUrl,
    token: {
      configured: true,
      source: 'login',
      pending: !st || st.state === 'pending',
      user: st?.user ?? null,
      scopes: null,
      login: { method: login.method, username: login.username, shared: login.shared, viaApiToken: login.viaApiToken },
    },
    capabilities: adapter.capabilities({ ...flags, host: r.host }),
  };
}

/** Проверить авторизацию сейчас (после сохранения входа) → { state, reason, user } */
async function checkLogin(root, preferredRemote) {
  const r = await resolveRemote(root, preferredRemote);
  if (!r || !r.kind || r.kind === 'gitlab') return null;
  const { login, other } = loginFor(r);
  if (!login) return { state: 'none', reason: loginProblemText(r, other) };
  const st = await verify(r, login);
  return { state: st.state, reason: st.state === 'bad' ? loginProblemText(r, null, st) : st.reason ?? null, user: st.user ?? null };
}

/* =================== Контекст запроса =================== */

async function context(root, preferredRemote) {
  const r = await resolveRemote(root, preferredRemote);
  if (!r) throw new GitError(t('У репозитория нет remote'), { code: 'NO_REMOTE' });
  if (r.kind === 'gitlab' || !r.kind) {
    const ctx = await gl.context(root, preferredRemote).catch((error) => {
      if (error.code === 'NOT_GITLAB') {
        throw new GitError(t('Не удалось определить сервис CI/CD'), {
          code: 'NO_PROVIDER',
          hint: t('Укажите провайдера (GitLab, GitHub, Gitea, Bitbucket) и адрес API в настройках CI/CD репозитория'),
        });
      }
      throw error;
    });
    return { adapter: ADAPTERS.gitlab, ctx: { ...ctx, root, preferredRemote, kind: 'gitlab', host: r.host, siteBase: ctx.remote.base } };
  }
  const { login, other } = loginFor(r);
  if (!login) {
    throw new GitError(t('Репозиторий не авторизован'), {
      code: 'NO_TOKEN',
      hint: loginProblemText(r, other) ?? t('Авторизуйте репозиторий — эта же авторизация работает и для {0}', LABELS[r.kind]),
    });
  }
  const st = await verify(r, login);
  if (st.state === 'bad') throw new GitError(t('Авторизация репозитория не подходит для CI/CD'), { code: 'NO_TOKEN', hint: loginProblemText(r, null, st) });
  const ctx = { ...httpCtx(r, login), ...(st.flags ?? {}), root, preferredRemote };
  return { adapter: ADAPTERS[r.kind], ctx };
}

function require_(adapter, ctx, cap, label) {
  const caps = adapter.capabilities(ctx);
  if (!caps[cap]) throw new GitError(caps.why?.[cap] ?? t('{0}: {1} недоступно', adapter.label, label), { code: 'UNSUPPORTED' });
  return caps;
}

const withCaps = (adapter, ctx, data) => ({ ...data, provider: adapter.id, label: adapter.label, capabilities: adapter.capabilities(ctx) });

/* =================== Пайплайны =================== */

async function info(root, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  return withCaps(adapter, ctx, { webUrl: ctx.webUrl ?? ctx.project?.webUrl ?? null, defaultBranch: ctx.defaultBranch ?? ctx.project?.defaultBranch ?? null });
}

async function pipelines(root, { ref, preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const data = await adapter.listPipelines(ctx, { ref });
  return withCaps(adapter, ctx, data);
}

/** Задания по этапам: GitLab — этапы из пайплайна; GitHub/Gitea — уровни по needs из workflow; Bitbucket — шаги по порядку */
async function stagesOf(root, data) {
  if (data.stageOrder) {
    return data.stageOrder.map((name) => {
      const jobs = data.jobs.filter((j) => j.stage === name).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { name, status: M.aggregate(jobs), jobs };
    });
  }
  if (data.sequential) return data.jobs.map((j) => ({ name: j.stage ?? j.name, status: j.status, jobs: [j] }));
  const levels = await workflowLevels(root, data.pipeline).catch(() => null);
  const jobs = data.jobs;
  if (levels) {
    for (const j of jobs) j.stage = levels.levelOf(j.name);
    const max = Math.max(0, ...jobs.map((j) => j.stage ?? 0));
    return Array.from({ length: max + 1 }, (_, i) => jobs.filter((j) => (j.stage ?? 0) === i))
      .map((list, i) => ({ name: max === 0 ? data.pipeline.workflow ?? t('Задания') : i === 0 ? t('Старт') : t('После шага {0}', i), status: M.aggregate(list), jobs: list.map((j) => ({ ...j, stage: i === 0 ? t('Старт') : t('После шага {0}', i) })) }))
      .filter((s) => s.jobs.length);
  }
  return jobs.length ? [{ name: data.pipeline.workflow ?? t('Задания'), status: M.aggregate(jobs), jobs: jobs.map((j) => ({ ...j, stage: data.pipeline.workflow ?? t('Задания') })) }] : [];
}

/** Уровни заданий workflow по needs (из файла в этом коммите или в рабочей папке) */
async function workflowLevels(root, pipeline) {
  const file = pipeline.workflowPath ?? (pipeline.workflowFile ? ['.gitea/workflows', '.forgejo/workflows', '.github/workflows'].map((d) => `${d}/${pipeline.workflowFile}`).find((p) => fs.existsSync(path.join(root, p))) : null);
  if (!file) return null;
  let text = await git(root, ['show', `${pipeline.sha}:${file}`]).catch(() => null);
  if (text == null) {
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      return null;
    }
  }
  const data = ci.parseYaml(text, file).data;
  const jobs = data?.jobs && typeof data.jobs === 'object' ? data.jobs : null;
  if (!jobs) return null;
  const level = new Map();
  const needsOf = (id) => [].concat(jobs[id]?.needs ?? []).map(String).filter((n) => n in jobs);
  const visit = (id, stack = []) => {
    if (level.has(id)) return level.get(id);
    if (stack.includes(id)) return 0;
    const lv = Math.max(-1, ...needsOf(id).map((n) => visit(n, [...stack, id]))) + 1;
    level.set(id, lv);
    return lv;
  };
  Object.keys(jobs).forEach((id) => visit(id));
  // Имя задания в API: name: из workflow (может быть с ${{ }}) или id; у матрицы — «имя (значения)», у вызова — «имя / …»
  const patterns = Object.keys(jobs).map((id) => {
    const display = jobs[id]?.name != null ? String(jobs[id].name) : id;
    const re = new RegExp(`^${display.split(/\$\{\{[^}]*\}\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}(?: \\(.*\\))?(?: / .*)?$`);
    return { id, display, re };
  });
  return {
    levelOf(name) {
      const hit = patterns.find((p) => p.display === name) ?? patterns.find((p) => p.re.test(name)) ?? patterns.find((p) => name.startsWith(`${p.id} `) || name === p.id);
      return hit ? level.get(hit.id) ?? 0 : 0;
    },
  };
}

async function pipeline(root, id, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const data = await adapter.pipelineDetail(ctx, id);
  const stages = await stagesOf(root, data);
  return withCaps(adapter, ctx, { pipeline: data.pipeline, stages, artifacts: data.artifacts ?? [], canWrite: data.canWrite });
}

async function jobLog(root, id, { preferredRemote, pipelineId } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const data = await adapter.jobLog(ctx, id, { pipelineId });
  return withCaps(adapter, ctx, data);
}

const ACTION_CAPS = {
  'pipeline.cancel': 'canCancel',
  'pipeline.retry': 'canRetry',
  'pipeline.retry-failed': 'canRetryFailed',
  'job.retry': 'canRerunSingleJob',
  'job.cancel': 'canCancelJob',
  'job.play': 'canPlayManualJob',
};

async function action(root, a, { preferredRemote } = {}) {
  if (!a || !ACTION_CAPS[a.type]) throw new GitError(t('Неизвестное действие'), { code: 'BAD_ARGS' });
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, ACTION_CAPS[a.type], t('действие'));
  return adapter.action(ctx, a);
}

/** Запуск пайплайна: ветка, workflow (GitHub/Gitea, custom-пайплайн Bitbucket), inputs и переменные */
async function run(root, params = {}, { preferredRemote } = {}) {
  const ref = String(params.ref ?? '').trim();
  if (!ref) throw new GitError(t('Не указана ветка'), { code: 'BAD_ARGS' });
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canRunPipeline', t('запуск'));
  const variables = Array.isArray(params.variables) ? params.variables.filter((v) => v && String(v.key ?? '').trim()) : [];
  if (variables.length && !adapter.capabilities(ctx).canRunWithVariables) throw new GitError(adapter.capabilities(ctx).why?.canRunWithVariables ?? t('Переменные при запуске не поддерживаются'), { code: 'UNSUPPORTED' });
  return adapter.runPipeline(ctx, { ref, workflow: params.workflow ?? null, inputs: params.inputs ?? {}, variables: variables.map((v) => ({ ...v, key: String(v.key).trim() })) });
}

/* ---------- Форма запуска: inputs workflow_dispatch, переменные GitLab, custom-пайплайны Bitbucket ---------- */

function inputField(key, spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const type = s.type === 'boolean' ? 'boolean' : s.type === 'choice' || Array.isArray(s.options) ? 'choice' : s.type === 'number' ? 'number' : s.type === 'environment' ? 'environment' : 'string';
  return {
    key,
    type,
    description: s.description != null ? String(s.description) : null,
    required: Boolean(s.required),
    default: s.default ?? (type === 'boolean' ? false : type === 'choice' ? (s.options ?? [])[0] ?? '' : ''),
    options: Array.isArray(s.options) ? s.options.map(String) : null,
  };
}

/** Что можно задать при запуске — из конфигов в рабочей папке */
async function runForm(root, { preferredRemote } = {}) {
  const r = await resolveRemote(root, preferredRemote);
  const kind = r?.kind ?? 'gitlab';
  const systems = ci.detectCi(root);
  const read = (rel) => {
    try {
      return ci.parseYaml(fs.readFileSync(path.join(root, rel), 'utf8'), rel).data ?? {};
    } catch {
      return null;
    }
  };
  if (kind === 'github' || kind === 'gitea') {
    const dirs = kind === 'github' ? ['github'] : ['gitea', 'forgejo', 'github'];
    const workflows = [];
    for (const sys of systems.filter((s) => dirs.includes(s.id))) {
      for (const file of sys.files) {
        const data = read(file);
        if (!data) continue;
        const on = data.on ?? data[true];
        const dispatch = on && typeof on === 'object' && !Array.isArray(on) ? on.workflow_dispatch : Array.isArray(on) ? (on.includes('workflow_dispatch') ? {} : undefined) : on === 'workflow_dispatch' ? {} : undefined;
        if (dispatch === undefined) {
          workflows.push({ path: file, name: data.name ? String(data.name) : path.posix.basename(file), dispatchable: false, inputs: [] });
          continue;
        }
        const inputs = dispatch && typeof dispatch === 'object' && dispatch.inputs && typeof dispatch.inputs === 'object' ? dispatch.inputs : {};
        workflows.push({ path: file, name: data.name ? String(data.name) : path.posix.basename(file), dispatchable: true, inputs: Object.entries(inputs).map(([k, v]) => inputField(k, v)) });
      }
    }
    return { kind, workflows, variables: [], allowCustomVariables: false };
  }
  if (kind === 'bitbucket') {
    const sys = systems.find((s) => s.id === 'bitbucket');
    const data = sys ? read(sys.files[0]) : null;
    const custom = data?.pipelines?.custom && typeof data.pipelines.custom === 'object' ? data.pipelines.custom : {};
    const workflows = [{ path: null, name: t('По ветке (branches / default)'), value: null, dispatchable: true, inputs: [] }];
    for (const [name, steps] of Object.entries(custom)) {
      const vars = [].concat(steps ?? []).find((s) => s && typeof s === 'object' && Array.isArray(s.variables))?.variables ?? [];
      workflows.push({
        path: null,
        value: `custom: ${name}`,
        name: `custom: ${name}`,
        dispatchable: true,
        inputs: vars.map((v) => inputField(String(v.name), { description: v.description, default: v.default, options: v['allowed-values'] })),
      });
    }
    return { kind, workflows, variables: [], allowCustomVariables: true };
  }
  // GitLab: переменные с description — их GitLab предлагает при ручном запуске; spec:inputs — входные параметры
  const sys = systems.find((s) => s.id === 'gitlab');
  let variables = [];
  let inputs = [];
  if (sys) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(root, sys.files[0]), 'utf8');
    } catch {
      text = '';
    }
    const docs = text.split(/^---\s*$/m);
    if (docs.length > 1) {
      const header = ci.parseYaml(docs[0], sys.files[0]).data;
      const spec = header?.spec?.inputs;
      if (spec && typeof spec === 'object') inputs = Object.entries(spec).map(([k, v]) => inputField(k, v));
    }
    const data = ci.parseYaml(docs.length > 1 ? docs.slice(1).join('---\n') : text, sys.files[0]).data ?? {};
    const vars = data.variables && typeof data.variables === 'object' ? data.variables : {};
    variables = Object.entries(vars)
      .filter(([, v]) => v && typeof v === 'object' && v.description != null)
      .map(([k, v]) => ({ key: k, description: String(v.description), default: v.value != null ? String(v.value) : '', options: Array.isArray(v.options) ? v.options.map(String) : null }));
  }
  return { kind: 'gitlab', workflows: [], inputs, variables, allowCustomVariables: true };
}

/* =================== Раннеры =================== */

async function runners(root, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const caps = adapter.capabilities(ctx);
  if (!caps.canListRunners) throw new GitError(caps.why?.canListRunners ?? t('Раннеры недоступны'), { code: 'UNSUPPORTED' });
  const list = await adapter.listRunners(ctx);
  return withCaps(adapter, ctx, { runners: list });
}

async function runnerUpdate(root, { id, patch }, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const p = patch ?? {};
  if (p.labels) require_(adapter, ctx, 'canEditRunnerLabels', t('изменение меток'));
  if (p.paused !== undefined) require_(adapter, ctx, 'canPauseRunner', t('пауза'));
  if (['runUntagged', 'locked', 'description', 'maximumTimeout'].some((k) => p[k] !== undefined)) require_(adapter, ctx, 'canEditRunnerSettings', t('настройки раннера'));
  return adapter.updateRunner(ctx, id, p);
}

async function runnerDelete(root, { id }, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canDeleteRunner', t('удаление раннера'));
  return adapter.deleteRunner(ctx, id);
}

/** Удалить все раннеры не в сети (кроме общих — их удаляет администратор сервера) */
async function runnersPrune(root, { ids = null } = {}, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canDeleteRunner', t('удаление раннеров'));
  const list = await adapter.listRunners(ctx);
  const dead = list.filter((r) => r.status === 'offline' && !r.isShared && !r.virtual && r.editable && (!ids || ids.includes(r.id)));
  const removed = [];
  const failed = [];
  for (const r of dead) {
    try {
      await adapter.deleteRunner(ctx, r.id);
      removed.push({ id: r.id, name: r.name });
    } catch (error) {
      failed.push({ id: r.id, name: r.name, error: error.message });
    }
  }
  return { removed, failed };
}

/** Токен для нового раннера + готовые команды */
async function runnerRegister(root, opts = {}, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canCreateRunnerToken', t('регистрация раннера'));
  const labels = [...new Set((opts.labels ?? []).map((l) => String(l).trim()).filter(Boolean))];
  const reg = await adapter.registrationToken(ctx, { ...opts, labels });
  const name = String(opts.name || `git-gorynych-${Date.now().toString(36).slice(-4)}`).replace(/[^\w.-]+/g, '-');
  return { ...reg, labels, name, provider: adapter.id, commands: runnerSetup.commands(adapter.id, { url: reg.url, token: reg.token, labels, name }) };
}

/* ---------- Локальный Docker-раннер ---------- */

const repoKeyOf = async (root, preferredRemote) => {
  const r = await resolveRemote(root, preferredRemote);
  return r ? `${r.host}/${r.path}`.toLowerCase() : null;
};

async function localRunners(root, { preferredRemote } = {}) {
  const docker = await runnerSetup.dockerStatus();
  if (!docker.available) return { docker, runners: [] };
  const key = await repoKeyOf(root, preferredRemote);
  return { docker, runners: await runnerSetup.localRunners(key) };
}

async function localRunnerStart(root, { labels = [] } = {}, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'localRunner', t('локальный раннер'));
  const r = await resolveRemote(root, preferredRemote);
  const clean = [...new Set(labels.map((l) => String(l).trim()).filter(Boolean))];
  const reg = await adapter.registrationToken(ctx, { labels: clean, description: t('git-Горыныч (локальный Docker)'), runUntagged: !clean.length });
  try {
    const started = await runnerSetup.startLocal(adapter.id, { reg, labels: clean, repoKey: `${r.host}/${r.path}`.toLowerCase(), repoName: r.path.split('/').pop() });
    return { ...started, provider: adapter.id };
  } catch (error) {
    // Раннер GitLab уже создан на сервере (POST /user/runners) — убираем, чтобы не висел мёртвым
    if (reg.runnerId && adapter.deleteRunner) await adapter.deleteRunner(ctx, reg.runnerId).catch(() => {});
    throw error;
  }
}

/* =================== Артефакты =================== */

async function artifactDownload(root, { artifact, dest }, { preferredRemote } = {}) {
  if (!artifact || !dest) throw new GitError(t('Не указан артефакт или файл'), { code: 'BAD_ARGS' });
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canDownloadArtifacts', t('скачивание артефактов'));
  return adapter.downloadArtifact(ctx, artifact, dest);
}

/* =================== Секреты и переменные =================== */

const SECRET_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function secrets(root, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canManageSecrets', t('секреты'));
  return withCaps(adapter, ctx, { secrets: await adapter.listSecrets(ctx) });
}

async function secretSave(root, data = {}, { preferredRemote } = {}) {
  const key = String(data.key ?? '').trim();
  if (!SECRET_KEY.test(key)) throw new GitError(t('Имя: латинские буквы, цифры и _, не с цифры'), { code: 'INVALID_NAME' });
  if (/^GITHUB_/i.test(key)) throw new GitError(t('Имена с GITHUB_ зарезервированы'), { code: 'INVALID_NAME' });
  if (typeof data.value !== 'string') throw new GitError(t('Введите значение'), { code: 'BAD_ARGS' });
  if (data.value.length > 48 * 1024) throw new GitError(t('Значение больше 48 КБ'), { code: 'BAD_ARGS' });
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canManageSecrets', t('секреты'));
  return adapter.saveSecret(ctx, { key, value: data.value, secret: Boolean(data.secret), original: data.original ?? null });
}

async function secretDelete(root, data = {}, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  require_(adapter, ctx, 'canManageSecrets', t('секреты'));
  return adapter.deleteSecret(ctx, data);
}

/* =================== Настройки и проверка тегов =================== */

async function getSettings(root, { preferredRemote } = {}) {
  const r = await resolveRemote(root, preferredRemote);
  if (!r) return null;
  return { host: r.host, path: r.path, detected: credentials.serverKind(r.host) ?? kindFromFiles(root), provider: r.conf?.provider ?? null, apiBase: r.conf?.apiBase ?? null, effective: r.kind, defaultApiBase: r.kind ? apiBaseFor(r.kind, r.host, r.siteBase, null) : null };
}

async function setSettings(root, data = {}, { preferredRemote } = {}) {
  const r = await resolveRemote(root, preferredRemote);
  if (!r) throw new GitError(t('У репозитория нет remote'), { code: 'NO_REMOTE' });
  settings.set(r.host, r.path, { provider: data.provider || null, apiBase: data.apiBase || null });
  checks.clear();
  return getSettings(root, { preferredRemote });
}

/** Сверка тегов/меток из конфига (tags, runs-on) с живыми раннерами */
async function runnerTagCheck(root, { file, drafts } = {}, { preferredRemote } = {}) {
  const { adapter, ctx } = await context(root, preferredRemote);
  const caps = adapter.capabilities(ctx);
  if (!caps.canListRunners) return { available: false, reason: caps.why?.canListRunners ?? null, issues: [], labels: [] };
  const list = await adapter.listRunners(ctx);
  const loaded = drafts && Object.keys(drafts).length ? await ci.previewCi(root, file, drafts) : await ci.loadCi(root, file, { skipHistory: true });
  const issues = loaded.current ? checkRunnerTags(loaded.current, list, { provider: adapter.id, host: ctx.host }) : [];
  const live = list.filter((x) => x.status === 'online' || x.status === 'busy');
  // Метки своих раннеров — первыми, затем облачных (ubuntu-latest и т. п.); без повторов с точностью до регистра
  const labels = [];
  const seen = new Set();
  for (const group of [live.filter((x) => !x.virtual), live.filter((x) => x.virtual)]) {
    for (const l of [...new Set(group.flatMap((x) => x.labels))].sort((a, b) => a.localeCompare(b))) {
      if (seen.has(l.toLowerCase())) continue;
      seen.add(l.toLowerCase());
      labels.push(l);
    }
  }
  return { available: true, issues, labels, runners: list.length, live: live.length, provider: adapter.id };
}

module.exports = {
  detect,
  checkLogin,
  info,
  pipelines,
  pipeline,
  jobLog,
  action,
  run,
  runForm,
  runners,
  runnerUpdate,
  runnerDelete,
  runnersPrune,
  runnerRegister,
  localRunners,
  localRunnerStart,
  localRunnerStop: (name) => runnerSetup.stopLocal(name),
  localRunnerResume: (name) => runnerSetup.resumeLocal(name),
  dockerStatus: () => runnerSetup.dockerStatus(),
  artifactDownload,
  secrets,
  secretSave,
  secretDelete,
  getSettings,
  setSettings,
  runnerTagCheck,
  _apiBaseFor: apiBaseFor,
};
