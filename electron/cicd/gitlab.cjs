// Адаптер GitLab CI: поверх electron/gitlab.cjs (авторизация, проект, пайплайны) — плюс раннеры, артефакты и запуск с переменными.
const { GitError } = require('../errors.cjs');
const gl = require('../gitlab.cjs');
const M = require('./models.cjs');
const { download } = require('./http.cjs');

const authHeaders = (token) =>
  typeof token === 'object' && token?.bearer ? { Authorization: `Bearer ${token.value}` } : { 'PRIVATE-TOKEN': typeof token === 'object' ? token.value : token };

const req = (ctx, method, p, opts) => gl.request(ctx.remote.base, ctx.token, method, p, opts);
const proj = (ctx) => `/projects/${ctx.project.id}`;

function normPipeline(p) {
  return {
    id: p.id,
    number: null, // GitLab показывает пайплайны по id (#503), а не по iid
    iid: p.iid ?? null,
    name: p.name ?? null,
    status: p.status,
    branch: p.ref,
    sha: p.sha,
    createdAt: p.createdAt,
    startedAt: p.startedAt ?? null,
    finishedAt: p.finishedAt ?? null,
    duration: p.duration ?? null,
    queuedDuration: p.queuedDuration ?? null,
    url: p.webUrl,
    triggeredBy: p.user ? { name: p.user.name, username: p.user.username } : null,
    source: p.source ?? null,
    coverage: p.coverage ?? null,
    yamlErrors: p.yamlErrors ?? null,
  };
}

function normJob(j) {
  return {
    id: j.id,
    kind: j.kind,
    name: j.name,
    stage: j.stage,
    status: j.status,
    runnerName: j.runner?.description ?? null,
    runnerId: j.runner?.id ?? null,
    runnerTags: j.tags ?? [],
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    duration: j.duration,
    queuedDuration: j.queuedDuration,
    url: j.webUrl,
    logsUrl: j.webUrl,
    allowFailure: j.allowFailure,
    failureReason: j.failureReason,
    steps: [],
    manual: j.status === 'manual',
    when: j.when,
    coverage: j.coverage,
    triggeredBy: j.user,
    downstream: j.downstream ? { ...j.downstream, url: j.downstream.webUrl } : null,
    artifacts: j.artifacts,
  };
}

const RUNNER_STATUS = (r) => {
  if (r.paused || r.active === false) return 'paused';
  const s = r.status ?? (r.online ? 'online' : 'offline');
  return s === 'online' ? 'online' : 'offline';
};

const gitlab = {
  id: 'gitlab',
  label: 'GitLab CI',
  short: 'GitLab',

  capabilities(ctx) {
    const write = gl.canWrite(ctx);
    // Раннеры проекта меняет Maintainer (40) и выше
    const maintainer = (ctx.project?.accessLevel ?? 40) >= 40;
    return {
      ...M.NO_CAPS,
      canListPipelines: true,
      canRunPipeline: write,
      canRunWithInputs: write,
      canRunWithVariables: write,
      canCancel: write,
      canRetry: write,
      canRetryFailed: write,
      canRerunSingleJob: write,
      canCancelJob: write,
      canPlayManualJob: write,
      canDownloadArtifacts: true,
      canListRunners: true,
      canEditRunnerLabels: write && maintainer,
      canPauseRunner: write && maintainer,
      canEditRunnerSettings: write && maintainer,
      canDeleteRunner: write && maintainer,
      canCreateRunnerToken: write && maintainer,
      canManageSecrets: true,
      canManageVariables: true,
      hasSchedules: true,
      hasStages: true,
      localRunner: write && maintainer,
      why: write
        ? maintainer
          ? {}
          : Object.fromEntries(
              ['canEditRunnerLabels', 'canPauseRunner', 'canEditRunnerSettings', 'canDeleteRunner', 'canCreateRunnerToken'].map((k) => [k, 'Раннеры проекта меняет роль Maintainer и выше']),
            )
        : Object.fromEntries(
            ['canRunPipeline', 'canCancel', 'canRetry', 'canRetryFailed', 'canEditRunnerLabels', 'canPauseRunner', 'canDeleteRunner', 'canCreateRunnerToken'].map((k) => [
              k,
              'Токен только для чтения (read_api) — для действий нужен scope «api»',
            ]),
          ),
    };
  },

  async listPipelines(ctx, { ref } = {}) {
    const data = await gl.listPipelines(ctx.root, { ref, preferredRemote: ctx.preferredRemote });
    const pipelines = data.pipelines.map(normPipeline);
    return { pipelines, bySha: M.bySha(pipelines), canWrite: data.canWrite };
  },

  async pipelineDetail(ctx, id) {
    const data = await gl.pipelineDetail(ctx.root, id, { preferredRemote: ctx.preferredRemote });
    const jobs = data.stages.flatMap((s) => s.jobs.map(normJob));
    // Артефакты — архивы заданий
    const artifacts = data.stages
      .flatMap((s) => s.jobs)
      .filter((j) => j.kind === 'job' && j.artifacts?.some((a) => a.type === 'archive'))
      .map((j) => ({
        id: j.id,
        jobId: j.id,
        jobName: j.name,
        name: `${j.name}`,
        fileName: `${j.name.replace(/[\\/:*?"<>|]+/g, '_')}-artifacts.zip`,
        size: j.artifacts.find((a) => a.type === 'archive')?.size ?? null,
        expired: false,
        downloadUrl: `${proj(ctx)}/jobs/${j.id}/artifacts`,
      }));
    return {
      pipeline: normPipeline(data.pipeline),
      jobs,
      stageOrder: data.stages.map((s) => s.name),
      artifacts,
      canWrite: data.canWrite,
    };
  },

  async jobLog(ctx, jobId) {
    const data = await gl.jobLog(ctx.root, jobId, { preferredRemote: ctx.preferredRemote });
    return { ...data, job: normJob(data.job) };
  },

  async action(ctx, a) {
    const type = a.type === 'pipeline.retry-failed' ? 'pipeline.retry' : a.type;
    return gl.runPipelineAction(ctx.root, { ...a, type }, { preferredRemote: ctx.preferredRemote });
  },

  /** Новый пайплайн: ветка, переменные (KEY=VALUE) и inputs (spec:inputs, GitLab 17+) */
  async runPipeline(ctx, { ref, variables = [], inputs = {} }) {
    if (!gl.canWrite(ctx)) throw new GitError('Токен только для чтения', { code: 'FORBIDDEN', hint: 'Для запуска нужен токен со scope «api»' });
    const vars = variables.filter((v) => v.key).map((v) => ({ key: v.key, value: String(v.value ?? ''), variable_type: v.file ? 'file' : 'env_var' }));
    const bad = vars.find((v) => !/^[A-Za-z0-9_]+$/.test(v.key));
    if (bad) throw new GitError(`Некорректное имя переменной: ${bad.key}`, { code: 'BAD_ARGS', hint: 'Только латинские буквы, цифры и _' });
    const body = { ref, ...(vars.length ? { variables: vars } : {}), ...(Object.keys(inputs).length ? { inputs } : {}) };
    const res = await req(ctx, 'POST', `${proj(ctx)}/pipeline`, { body });
    return { id: res?.id ?? null, url: res?.web_url ?? null };
  },

  /* ---------- Раннеры ---------- */

  async runnerDetail(ctx, r) {
    const [detail, managers, jobs] = await Promise.all([
      req(ctx, 'GET', `/runners/${r.id}`).catch(() => null),
      req(ctx, 'GET', `/runners/${r.id}/managers`).catch(() => null),
      RUNNER_STATUS(r) === 'online' ? req(ctx, 'GET', `/runners/${r.id}/jobs`, { query: { status: 'running', per_page: 1 } }).catch(() => null) : null,
    ]);
    const d = detail ?? r;
    const m = Array.isArray(managers) && managers.length ? [...managers].sort((a, b) => String(b.contacted_at).localeCompare(String(a.contacted_at)))[0] : null;
    const running = Array.isArray(jobs) && jobs[0] ? jobs[0] : null;
    let status = RUNNER_STATUS(d);
    if (status === 'online' && running) status = 'busy';
    const platform = m?.platform ?? d.platform ?? null;
    return M.runner({
      id: r.id,
      name: d.description || d.name || `#${r.id}`,
      description: d.description ?? null,
      status,
      isShared: Boolean(d.is_shared) || d.runner_type === 'instance_type',
      os: platform === 'darwin' ? 'macos' : platform,
      architecture: (m?.architecture ?? d.architecture) === 'amd64' ? 'x64' : m?.architecture ?? d.architecture ?? null,
      labels: d.tag_list ?? [],
      version: m?.version ?? d.version ?? null,
      ipAddress: m?.ip_address ?? d.ip_address ?? null,
      currentJobId: running?.id ?? null,
      currentJob: running ? { id: running.id, name: running.name, pipelineId: running.pipeline?.id ?? null, url: running.web_url ?? null } : null,
      type: d.runner_type ?? null,
      runUntagged: d.run_untagged ?? null,
      locked: d.locked ?? null,
      maximumTimeout: d.maximum_timeout ?? null,
      contactedAt: M.iso(m?.contacted_at ?? d.contacted_at),
      stale: d.status === 'stale' || r.status === 'stale',
      // Общие раннеры экземпляра меняет только администратор GitLab
      editable: d.runner_type === 'project_type' || (!detail ? false : d.runner_type !== 'instance_type'),
    });
  },

  async listRunners(ctx) {
    const list = await gl.fetchAll(ctx, `${proj(ctx)}/runners`, {}, 1);
    const out = [];
    for (let i = 0; i < list.length; i += 8) out.push(...(await Promise.all(list.slice(i, i + 8).map((r) => this.runnerDetail(ctx, r)))));
    return out;
  },

  async updateRunner(ctx, id, patch) {
    const body = {};
    if (patch.labels) body.tag_list = patch.labels.map((t) => String(t).trim()).filter(Boolean).join(',');
    if (patch.paused !== undefined) body.paused = Boolean(patch.paused);
    if (patch.runUntagged !== undefined) body.run_untagged = Boolean(patch.runUntagged);
    if (patch.locked !== undefined) body.locked = Boolean(patch.locked);
    if (patch.description !== undefined) body.description = String(patch.description);
    if (patch.maximumTimeout !== undefined) {
      const t = patch.maximumTimeout === null || patch.maximumTimeout === '' ? null : Number(patch.maximumTimeout);
      if (t !== null && (!Number.isInteger(t) || t < 600)) throw new GitError('Максимальный тайм-аут — не меньше 600 секунд (10 минут)', { code: 'BAD_ARGS' });
      body.maximum_timeout = t;
    }
    if (body.run_untagged === false && body.tag_list === '') {
      throw new GitError('Раннер без тегов должен брать задания без тегов', { code: 'BAD_ARGS', hint: 'Добавьте тег или включите «Брать задания без тегов»' });
    }
    await req(ctx, 'PUT', `/runners/${Number(id)}`, { body, notFound: 'Раннер не найден или у вас нет прав его менять' });
    return { id };
  },

  async deleteRunner(ctx, id) {
    await req(ctx, 'DELETE', `/runners/${Number(id)}`, { notFound: 'Раннер не найден — возможно, его уже удалили' });
    return { id };
  },

  /** Новый раннер проекта: POST /user/runners → токен glrt-…; на старом GitLab — регистрационный токен проекта */
  async registrationToken(ctx, { labels = [], description = '', runUntagged = false, locked = true, paused = false } = {}) {
    try {
      const res = await req(ctx, 'POST', '/user/runners', {
        body: {
          runner_type: 'project_type',
          project_id: ctx.project.id,
          description: description || 'git-Горыныч',
          tag_list: labels.join(','),
          run_untagged: Boolean(runUntagged || !labels.length),
          locked: Boolean(locked),
          paused: Boolean(paused),
        },
      });
      return { token: res.token, runnerId: res.id, expiresAt: res.token_expires_at ?? null, kind: 'auth', url: ctx.remote.base };
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      const p = await req(ctx, 'GET', proj(ctx));
      if (!p.runners_token) throw new GitError('Не удалось получить токен раннера', { code: 'FORBIDDEN', hint: 'Нужна роль Maintainer в проекте' });
      return { token: p.runners_token, expiresAt: null, kind: 'registration', url: ctx.remote.base };
    }
  },

  /* ---------- Артефакты ---------- */

  async downloadArtifact(ctx, artifact, dest) {
    const http = { apiBase: `${ctx.remote.base}/api/v4`, headers: authHeaders(ctx.token), label: 'GitLab' };
    return download(http, `${proj(ctx)}/jobs/${Number(artifact.jobId ?? artifact.id)}/artifacts`, dest, { notFound: 'Артефакты задания удалены или истекли' });
  },

  /* ---------- Переменные (для единой вкладки; полный редактор — GitLabVariables) ---------- */

  async listSecrets(ctx) {
    const data = await gl.listVariables(ctx.root, { preferredRemote: ctx.preferredRemote });
    return data.variables.map((v) => ({ key: v.key, secret: v.masked || v.hidden, masked: v.masked, environmentScope: v.scope, protected: v.protected, value: null }));
  },
};

module.exports = gitlab;
