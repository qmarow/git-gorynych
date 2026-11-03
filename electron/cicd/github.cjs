// Адаптер GitHub Actions (github.com и GitHub Enterprise Server). Gitea/Forgejo наследует его — API Actions у них похож.
const path = require('node:path');
const { GitError } = require('../errors.cjs');
const { request, download } = require('./http.cjs');
const M = require('./models.cjs');
const { seal } = require('./sealedbox.cjs');
const { t: tr } = require('../i18n.cjs');

const repoApi = (ctx) => `/repos/${ctx.owner}/${ctx.repo}`;

// Стандартные облачные раннеры GitHub (github.com): их нет в списке API, но runs-on на них ссылается
const HOSTED = [
  ['ubuntu-latest', 'linux', 'x64'],
  ['ubuntu-24.04', 'linux', 'x64'],
  ['ubuntu-22.04', 'linux', 'x64'],
  ['ubuntu-24.04-arm', 'linux', 'arm64'],
  ['ubuntu-22.04-arm', 'linux', 'arm64'],
  ['windows-latest', 'windows', 'x64'],
  ['windows-2025', 'windows', 'x64'],
  ['windows-2022', 'windows', 'x64'],
  ['windows-11-arm', 'windows', 'arm64'],
  ['macos-latest', 'macos', 'arm64'],
  ['macos-15', 'macos', 'arm64'],
  ['macos-14', 'macos', 'arm64'],
  ['macos-13', 'macos', 'x64'],
];

const github = {
  id: 'github',
  label: 'GitHub Actions',
  short: 'GitHub',

  capabilities(ctx) {
    const write = ctx.canWrite !== false;
    const admin = ctx.isAdmin !== false;
    return {
      ...M.NO_CAPS,
      canListPipelines: true,
      canRunPipeline: write,
      canRunWithInputs: write,
      canCancel: write,
      canRetry: write,
      canRetryFailed: write,
      canRerunSingleJob: write,
      canCancelJob: false,
      canDownloadArtifacts: true,
      canListRunners: admin,
      canEditRunnerLabels: admin,
      canDeleteRunner: admin,
      canCreateRunnerToken: admin,
      canManageSecrets: admin,
      canManageVariables: admin,
      localRunner: admin,
      why: {
        ...M.reasons('GitHub', ['canPauseRunner', 'canEditRunnerSettings', 'canRunWithVariables', 'canCancelJob', 'canPlayManualJob']),
        canRunWithVariables: tr('GitHub запускает workflow только с входными параметрами (inputs) — переменные окружения задаются в самом workflow'),
        canPauseRunner: tr('У GitHub нет паузы раннера — остановите службу раннера на сервере'),
        ...(admin ? {} : { canListRunners: tr('Раннеры и секреты видны только администраторам репозитория') }),
      },
    };
  },

  /** Права в репозитории: push — запуск и отмена, admin — раннеры и секреты */
  async init(ctx) {
    const r = await request(ctx, 'GET', repoApi(ctx), { notFound: tr('Репозиторий {0}/{1} не найден или у токена нет к нему доступа', ctx.owner, ctx.repo) });
    ctx.canWrite = r.permissions ? Boolean(r.permissions.push || r.permissions.admin) : true;
    ctx.isAdmin = r.permissions ? Boolean(r.permissions.admin) : true;
    ctx.defaultBranch = r.default_branch ?? null;
    ctx.webUrl = r.html_url ?? ctx.webUrl;
  },

  async whoami(ctx) {
    const u = await request(ctx, 'GET', '/user');
    return { username: u.login, name: u.name ?? u.login, avatarUrl: u.avatar_url ?? null };
  },

  run(r) {
    return {
      id: r.id,
      number: r.run_number ?? null,
      name: r.display_title || r.name || r.head_commit?.message?.split('\n')[0] || null,
      workflow: r.name ?? null,
      workflowPath: r.path ? r.path.replace(/@.*$/, '') : null,
      workflowId: r.workflow_id ?? null,
      status: M.githubStatus(r.status, r.conclusion),
      branch: r.head_branch ?? null,
      sha: r.head_sha,
      createdAt: M.iso(r.created_at),
      startedAt: M.iso(r.run_started_at ?? r.created_at),
      finishedAt: r.status === 'completed' ? M.iso(r.updated_at) : null,
      duration: r.status === 'completed' ? M.secondsBetween(r.run_started_at ?? r.created_at, r.updated_at) : null,
      url: r.html_url ?? r.url ?? null,
      triggeredBy: r.triggering_actor || r.actor ? { name: (r.triggering_actor ?? r.actor).login, username: (r.triggering_actor ?? r.actor).login } : null,
      source: r.event ?? null,
      attempt: r.run_attempt ?? 1,
    };
  },

  async listPipelines(ctx, { ref } = {}) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs`, { query: { per_page: 60, branch: ref || undefined } });
    const pipelines = (data?.workflow_runs ?? []).map((r) => this.run(r));
    return { pipelines, bySha: M.bySha(pipelines), canWrite: ctx.canWrite !== false };
  },

  job(j) {
    const steps = (j.steps ?? []).map((s) => ({
      number: s.number,
      name: s.name,
      status: M.githubStatus(s.status, s.conclusion),
      startedAt: M.iso(s.started_at),
      duration: M.secondsBetween(s.started_at, s.completed_at),
    }));
    return {
      id: j.id,
      kind: 'job',
      name: j.name,
      stage: null,
      status: M.githubStatus(j.status, j.conclusion),
      runnerName: j.runner_name || null,
      runnerTags: j.labels ?? [],
      startedAt: M.iso(j.started_at),
      finishedAt: M.iso(j.completed_at),
      duration: M.secondsBetween(j.started_at, j.completed_at),
      url: j.html_url ?? null,
      logsUrl: j.html_url ?? null,
      allowFailure: false,
      failureReason: null,
      steps,
      manual: false,
      runId: j.run_id ?? null,
    };
  },

  async pipelineDetail(ctx, id) {
    const runId = Number(id);
    const [r, jobs, arts] = await Promise.all([
      request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${runId}`, { notFound: tr('Запуск #{0} не найден — возможно, его удалили', runId) }),
      request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${runId}/jobs`, { query: { per_page: 100, filter: 'latest' } }),
      this.listArtifacts(ctx, runId).catch(() => []),
    ]);
    return { pipeline: this.run(r), jobs: (jobs?.jobs ?? []).map((j) => this.job(j)), artifacts: arts, canWrite: ctx.canWrite !== false };
  },

  async jobLog(ctx, jobId) {
    const id = Number(jobId);
    const [j, log] = await Promise.all([
      request(ctx, 'GET', `${repoApi(ctx)}/actions/jobs/${id}`, { notFound: tr('Задание #{0} не найдено', id) }),
      request(ctx, 'GET', `${repoApi(ctx)}/actions/jobs/${id}/logs`, { text: true }).catch((error) => {
        if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION') return { text: '', size: 0 };
        throw error;
      }),
    ]);
    return { job: this.job(j), text: log.text, size: log.size, truncated: log.size > 1.5 * 1024 * 1024 };
  },

  async action(ctx, a) {
    const base = repoApi(ctx);
    const calls = {
      'pipeline.cancel': () => ['POST', `${base}/actions/runs/${a.id}/cancel`],
      'pipeline.retry': () => ['POST', `${base}/actions/runs/${a.id}/rerun`],
      'pipeline.retry-failed': () => ['POST', `${base}/actions/runs/${a.id}/rerun-failed-jobs`],
      'job.retry': () => ['POST', `${base}/actions/jobs/${a.id}/rerun`],
    };
    const make = calls[a.type];
    if (!make) throw new GitError(tr('GitHub не поддерживает это действие'), { code: 'UNSUPPORTED' });
    const [method, p] = make();
    await request(ctx, method, p, { body: {} });
    return { type: a.type, id: a.id };
  },

  /** workflow_dispatch: workflow — путь файла (.github/workflows/x.yml), inputs — значения формы */
  async runPipeline(ctx, { ref, workflow, inputs = {} }) {
    if (!workflow) throw new GitError(tr('Выберите workflow для запуска'), { code: 'BAD_ARGS' });
    const file = path.posix.basename(String(workflow));
    const body = { ref, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : String(v ?? '')])) };
    await request(ctx, 'POST', `${repoApi(ctx)}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
      body,
      notFound: tr('Workflow {0} не найден на сервере — он закоммичен и отправлен в ветку по умолчанию?', file),
    });
    // GitHub не возвращает номер запуска — ищем свежий запуск этого workflow
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, i ? 1500 : 600));
      const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/workflows/${encodeURIComponent(file)}/runs`, { query: { per_page: 1, branch: ref, event: 'workflow_dispatch' } }).catch(() => null);
      const run = data?.workflow_runs?.[0];
      if (run && Date.now() - new Date(run.created_at).getTime() < 60000) return { id: run.id, url: run.html_url };
    }
    return { id: null };
  },

  /* ---------- Раннеры ---------- */

  runner(r, busyJobs = new Map()) {
    const labels = (r.labels ?? []).map((l) => l.name ?? l);
    const readOnly = (r.labels ?? []).filter((l) => l.type === 'read-only' || l.type === 'default').map((l) => l.name);
    const plat = M.platformFromLabels(labels, r.os);
    const job = busyJobs.get(r.name) ?? null;
    return M.runner({
      id: r.id,
      name: r.name,
      status: r.status === 'online' ? (r.busy ? 'busy' : 'online') : r.busy ? 'busy' : 'offline',
      isShared: false,
      os: plat.os,
      architecture: plat.architecture,
      labels,
      readOnlyLabels: readOnly,
      version: r.version ?? null,
      type: 'self-hosted',
      currentJobId: job?.id ?? null,
      currentJob: job,
    });
  },

  /** Что выполняет каждый занятый раннер: задания запусков «в процессе» */
  async busyJobs(ctx) {
    const map = new Map();
    const runs = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs`, { query: { status: 'in_progress', per_page: 10 } }).catch(() => null);
    for (const r of runs?.workflow_runs ?? []) {
      const jobs = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${r.id}/jobs`, { query: { per_page: 100 } }).catch(() => null);
      for (const j of jobs?.jobs ?? []) {
        if (j.runner_name && j.status === 'in_progress') map.set(j.runner_name, { id: j.id, name: j.name, pipelineId: r.id, url: j.html_url });
      }
    }
    return map;
  },

  hostedRunners(ctx) {
    if (ctx.host !== 'github.com') return [];
    return HOSTED.map(([name, os, arch]) =>
      M.runner({ id: `hosted:${name}`, name, status: 'online', isShared: true, os, architecture: arch, labels: [name], type: 'github-hosted', virtual: true }),
    );
  },

  async listRunners(ctx) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runners`, { query: { per_page: 100 } });
    const list = data?.runners ?? [];
    const busy = list.some((r) => r.busy) ? await this.busyJobs(ctx) : new Map();
    return [...list.map((r) => this.runner(r, busy)), ...this.hostedRunners(ctx)];
  },

  async updateRunner(ctx, id, patch) {
    if (patch.labels) {
      const current = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runners/${id}`);
      const readOnly = new Set((current.labels ?? []).filter((l) => l.type === 'read-only').map((l) => l.name.toLowerCase()));
      const custom = [...new Set(patch.labels.map((l) => String(l).trim()).filter((l) => l && !readOnly.has(l.toLowerCase())))];
      if (custom.length) await request(ctx, 'PUT', `${repoApi(ctx)}/actions/runners/${id}/labels`, { body: { labels: custom } });
      else await request(ctx, 'DELETE', `${repoApi(ctx)}/actions/runners/${id}/labels`);
    }
    const unsupported = ['paused', 'runUntagged', 'locked', 'description', 'maximumTimeout'].filter((k) => patch[k] !== undefined);
    if (unsupported.length) throw new GitError(tr('GitHub не позволяет менять эти настройки раннера'), { code: 'UNSUPPORTED', hint: unsupported.join(', ') });
    return { id };
  },

  async deleteRunner(ctx, id) {
    await request(ctx, 'DELETE', `${repoApi(ctx)}/actions/runners/${id}`, { notFound: tr('Раннер уже удалён') });
    return { id };
  },

  async registrationToken(ctx) {
    const t = await request(ctx, 'POST', `${repoApi(ctx)}/actions/runners/registration-token`, { body: {} });
    return { token: t.token, expiresAt: t.expires_at ?? null, kind: 'registration', url: ctx.webUrl };
  },

  /* ---------- Артефакты ---------- */

  async listArtifacts(ctx, runId) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/actions/runs/${runId}/artifacts`, { query: { per_page: 100 } });
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
      request(ctx, 'GET', `${repoApi(ctx)}/actions/secrets`, { query: { per_page: 100 } }),
      request(ctx, 'GET', `${repoApi(ctx)}/actions/variables`, { query: { per_page: 30 } }).catch(() => ({ variables: [] })),
    ]);
    return [
      ...(s?.secrets ?? []).map((x) => ({ key: x.name, secret: true, masked: true, environmentScope: '*', value: null, updatedAt: M.iso(x.updated_at ?? x.created_at) })),
      ...(v?.variables ?? []).map((x) => ({ key: x.name, secret: false, masked: false, environmentScope: '*', value: x.value ?? '', updatedAt: M.iso(x.updated_at ?? x.created_at) })),
    ];
  },

  async saveSecret(ctx, { key, value, secret, original }) {
    const base = repoApi(ctx);
    if (secret) {
      const pk = await request(ctx, 'GET', `${base}/actions/secrets/public-key`);
      await request(ctx, 'PUT', `${base}/actions/secrets/${encodeURIComponent(key)}`, { body: { encrypted_value: seal(pk.key, value), key_id: pk.key_id } });
    } else if (original && original.key === key && !original.secret) {
      await request(ctx, 'PATCH', `${base}/actions/variables/${encodeURIComponent(key)}`, { body: { name: key, value } });
    } else {
      await request(ctx, 'POST', `${base}/actions/variables`, { body: { name: key, value } });
    }
    if (original && (original.key !== key || Boolean(original.secret) !== Boolean(secret))) await this.deleteSecret(ctx, original).catch(() => {});
    return { key };
  },

  async deleteSecret(ctx, { key, secret }) {
    await request(ctx, 'DELETE', `${repoApi(ctx)}/actions/${secret ? 'secrets' : 'variables'}/${encodeURIComponent(key)}`);
    return { key };
  },
};

module.exports = github;
