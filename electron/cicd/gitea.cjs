// Адаптер Gitea / Forgejo Actions. API похож на GitHub (/api/v1/repos/{owner}/{repo}/actions/…),
// но умеет меньше: нет отмены и перезапуска по API, метки раннера задаются при регистрации.
// Старые версии (1.22–1.23) не отдают список запусков — берём задания (/actions/tasks) и группируем по номеру запуска.
const { GitError } = require('../errors.cjs');
const { request, download } = require('./http.cjs');
const M = require('./models.cjs');
const github = require('./github.cjs');
const { t: tr } = require('../i18n.cjs');

const repoApi = (ctx) => `/repos/${ctx.owner}/${ctx.repo}`;

const gitea = {
  ...github,
  id: 'gitea',
  label: 'Gitea / Forgejo Actions',
  short: 'Gitea',

  capabilities(ctx) {
    const write = ctx.canWrite !== false;
    const admin = ctx.isAdmin !== false;
    return {
      ...M.NO_CAPS,
      canListPipelines: true,
      canRunPipeline: write,
      canRunWithInputs: write,
      canDownloadArtifacts: true,
      canListRunners: admin,
      canDeleteRunner: admin,
      canCreateRunnerToken: admin,
      canManageSecrets: admin,
      canManageVariables: admin,
      localRunner: admin,
      why: {
        ...M.reasons('Gitea', ['canCancel', 'canRetry', 'canRetryFailed', 'canRerunSingleJob', 'canCancelJob', 'canPlayManualJob', 'canRunWithVariables']),
        canEditRunnerLabels: tr('В Gitea метки раннера задаются при регистрации (act_runner register --labels) или в его config.yaml'),
        canPauseRunner: tr('В Gitea нет паузы раннера — остановите act_runner на сервере'),
        canEditRunnerSettings: tr('Gitea не даёт менять настройки раннера через API'),
      },
    };
  },

  async init(ctx) {
    const r = await request(ctx, 'GET', repoApi(ctx), { notFound: tr('Репозиторий {0}/{1} не найден или у токена нет к нему доступа', ctx.owner, ctx.repo) });
    ctx.canWrite = r.permissions ? Boolean(r.permissions.push || r.permissions.admin) : true;
    ctx.isAdmin = r.permissions ? Boolean(r.permissions.admin) : true;
    ctx.defaultBranch = r.default_branch ?? null;
    ctx.webUrl = r.html_url ?? ctx.webUrl;
  },

  async whoami(ctx) {
    const u = await request(ctx, 'GET', '/user');
    return { username: u.login ?? u.username, name: u.full_name || u.login || u.username, avatarUrl: u.avatar_url ?? null };
  },

  run(r) {
    const base = github.run(r);
    // В Gitea workflow_id — имя файла (build.yml), path — «.gitea/workflows/build.yml@refs/heads/main»
    return { ...base, workflowPath: base.workflowPath ?? null, workflowFile: typeof r.workflow_id === 'string' ? r.workflow_id : null };
  },

  /** Запуски; на старых версиях — задания, сгруппированные по запуску */
  async listPipelines(ctx, { ref } = {}) {
    let pipelines;
    try {
      const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs`, { query: { limit: 50, branch: ref || undefined } });
      pipelines = (data?.workflow_runs ?? []).map((r) => this.run(r));
      ctx.legacyRuns = false;
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      ctx.legacyRuns = true;
      pipelines = await this.legacyRuns(ctx, ref);
    }
    return { pipelines, bySha: M.bySha(pipelines), canWrite: ctx.canWrite !== false };
  },

  async legacyTasks(ctx) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/tasks`, { query: { limit: 50 } });
    return data?.workflow_runs ?? [];
  },

  async legacyRuns(ctx, ref) {
    const tasks = await this.legacyTasks(ctx);
    const runs = new Map();
    for (const t of tasks) {
      if (ref && t.head_branch !== ref) continue;
      const key = t.run_number ?? t.id;
      if (!runs.has(key)) runs.set(key, { ...this.run(t), id: key, number: key, jobs: [] });
      runs.get(key).jobs.push(t);
    }
    return [...runs.values()].map(({ jobs, ...p }) => {
      const st = M.aggregate(jobs.map((j) => ({ status: M.githubStatus(j.status) })));
      return { ...p, status: st, url: jobs[0]?.url?.replace(/\/jobs\/\d+$/, '') ?? p.url };
    });
  },

  async pipelineDetail(ctx, id) {
    try {
      const [r, jobs, arts] = await Promise.all([
        request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${Number(id)}`, { notFound: tr('Запуск #{0} не найден', id) }),
        request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${Number(id)}/jobs`, { query: { limit: 100 } }).catch(() => ({ jobs: [] })),
        this.listArtifacts(ctx, id).catch(() => []),
      ]);
      return { pipeline: this.run(r), jobs: (jobs?.jobs ?? []).map((j) => this.job(j)), artifacts: arts, canWrite: ctx.canWrite !== false };
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      // Старая Gitea: собираем запуск из заданий
      const tasks = (await this.legacyTasks(ctx)).filter((t) => (t.run_number ?? t.id) === Number(id));
      if (!tasks.length) throw error;
      const runs = await this.legacyRuns(ctx);
      const pipeline = runs.find((p) => p.id === Number(id));
      const jobs = tasks.map((t) => ({
        ...this.job({ id: t.id, name: t.name, status: t.status, started_at: t.run_started_at, completed_at: t.updated_at, html_url: t.url }),
        logUnavailable: true,
      }));
      return { pipeline, jobs, artifacts: [], canWrite: ctx.canWrite !== false };
    }
  },

  async jobLog(ctx, jobId) {
    const id = Number(jobId);
    const job = await request(ctx, 'GET', `${repoApi(ctx)}/actions/jobs/${id}`).catch(() => null);
    const log = await request(ctx, 'GET', `${repoApi(ctx)}/actions/jobs/${id}/logs`, { text: true }).catch((error) => {
      if (error.code === 'NOT_FOUND') return { text: '', size: 0, unavailable: true };
      throw error;
    });
    return {
      job: job ? this.job(job) : null,
      text: log.text,
      size: log.size,
      truncated: log.size > 1.5 * 1024 * 1024,
      unavailable: Boolean(log.unavailable && !job),
    };
  },

  async action() {
    throw new GitError(tr('Gitea не даёт отменять и перезапускать запуски через API'), { code: 'UNSUPPORTED', hint: tr('Откройте запуск в браузере') });
  },

  async runPipeline(ctx, { ref, workflow, inputs = {} }) {
    if (!workflow) throw new GitError(tr('Выберите workflow для запуска'), { code: 'BAD_ARGS' });
    const file = String(workflow).split('/').pop();
    await request(ctx, 'POST', `${repoApi(ctx)}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
      body: { ref, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v ?? '')])) },
      notFound: tr('Запуск workflow по API поддерживается в Gitea 1.23 и новее (и workflow должен быть отправлен на сервер)'),
    });
    return { id: null };
  },

  /* ---------- Раннеры ---------- */

  async listRunners(ctx) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runners`, {
      query: { limit: 100 },
      notFound: tr('Список раннеров по API есть в Gitea 1.24 и новее'),
    });
    const list = data?.runners ?? (Array.isArray(data) ? data : []);
    return list.map((r) => {
      const labels = (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
      // Метки Gitea: «ubuntu-latest:docker://node:20-bookworm» — имя до двоеточия
      const names = labels.map((l) => l.split(':')[0]);
      const plat = M.platformFromLabels(labels);
      const status = String(r.status ?? '').toLowerCase();
      return M.runner({
        id: r.id,
        name: r.name,
        status: r.busy || status === 'active' || status === 'busy' ? 'busy' : status === 'online' || status === 'idle' ? 'online' : 'offline',
        os: plat.os ?? (labels.some((l) => /docker:\/\//.test(l)) ? 'docker' : null),
        architecture: plat.architecture,
        labels: names,
        version: r.version ?? null,
        type: r.ephemeral ? 'ephemeral' : 'repository',
        contactedAt: M.iso(r.last_online ?? null),
      });
    });
  },

  async updateRunner() {
    throw new GitError(tr('Gitea не даёт менять раннер через API'), { code: 'UNSUPPORTED', hint: tr('Метки задаются в config.yaml раннера или при регистрации') });
  },

  async deleteRunner(ctx, id) {
    await request(ctx, 'DELETE', `${repoApi(ctx)}/actions/runners/${id}`, { notFound: tr('Раннер уже удалён или Gitea не поддерживает удаление по API') });
    return { id };
  },

  async registrationToken(ctx) {
    let t;
    try {
      t = await request(ctx, 'POST', `${repoApi(ctx)}/actions/runners/registration-token`, { body: {} });
    } catch (error) {
      if (error.code !== 'NOT_FOUND' && error.code !== 'VALIDATION' && error.code !== 'API_ERROR') throw error;
      t = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runners/registration-token`);
    }
    return { token: t.token, expiresAt: null, kind: 'registration', url: ctx.siteBase };
  },

  /* ---------- Артефакты ---------- */

  async listArtifacts(ctx, runId) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${Number(runId)}/artifacts`);
    return (data?.artifacts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size_in_bytes ?? null,
      expired: Boolean(a.expired),
      downloadUrl: `${repoApi(ctx)}/actions/artifacts/${a.id}/zip`,
      fileName: `${a.name}.zip`,
      createdAt: M.iso(a.created_at),
    }));
  },

  async downloadArtifact(ctx, artifact, dest) {
    return download(ctx, `${repoApi(ctx)}/actions/artifacts/${Number(artifact.id)}/zip`, dest);
  },

  /* ---------- Секреты и переменные ---------- */

  async listSecrets(ctx) {
    const [s, v] = await Promise.all([
      request(ctx, 'GET', `${repoApi(ctx)}/actions/secrets`, { query: { limit: 100 } }).catch((e) => (e.code === 'NOT_FOUND' ? [] : Promise.reject(e))),
      request(ctx, 'GET', `${repoApi(ctx)}/actions/variables`, { query: { limit: 100 } }).catch((e) => (e.code === 'NOT_FOUND' ? [] : Promise.reject(e))),
    ]);
    const arr = (x, k) => (Array.isArray(x) ? x : x?.[k] ?? []);
    return [
      ...arr(s, 'secrets').map((x) => ({ key: x.name, secret: true, masked: true, environmentScope: '*', value: null, updatedAt: M.iso(x.created_at ?? x.created) })),
      ...arr(v, 'variables').map((x) => ({ key: x.name, secret: false, masked: false, environmentScope: '*', value: x.data ?? x.value ?? '', updatedAt: null })),
    ];
  },

  async saveSecret(ctx, { key, value, secret, original }) {
    const base = repoApi(ctx);
    if (secret) {
      await request(ctx, 'PUT', `${base}/actions/secrets/${encodeURIComponent(key)}`, { body: { data: value } });
    } else if (original && original.key === key && !original.secret) {
      await request(ctx, 'PUT', `${base}/actions/variables/${encodeURIComponent(key)}`, { body: { name: key, value } });
    } else {
      await request(ctx, 'POST', `${base}/actions/variables/${encodeURIComponent(key)}`, { body: { value } });
    }
    if (original && (original.key !== key || Boolean(original.secret) !== Boolean(secret))) await this.deleteSecret(ctx, original).catch(() => {});
    return { key };
  },

  async deleteSecret(ctx, { key, secret }) {
    await request(ctx, 'DELETE', `${repoApi(ctx)}/actions/${secret ? 'secrets' : 'variables'}/${encodeURIComponent(key)}`);
    return { key };
  },
};

module.exports = gitea;
