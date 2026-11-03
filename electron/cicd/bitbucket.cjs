// Адаптер Bitbucket Pipelines (bitbucket.org, API 2.0). Шаги пайплайна идут по порядку — каждый показывается этапом.
// Раннеры и артефакты Bitbucket в публичном API недоступны — интерфейс прячет эти функции с подсказкой.
const { GitError } = require('../errors.cjs');
const { request } = require('./http.cjs');
const M = require('./models.cjs');
const { t } = require('../i18n.cjs');

const repoApi = (ctx) => `/repositories/${ctx.owner}/${ctx.repo}`;
const VAR_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const bitbucket = {
  id: 'bitbucket',
  label: 'Bitbucket Pipelines',
  short: 'Bitbucket',

  capabilities(ctx) {
    const write = ctx.canWrite !== false;
    return {
      ...M.NO_CAPS,
      canListPipelines: true,
      canRunPipeline: write,
      canRunWithVariables: write,
      canCancel: write,
      canRetry: write,
      canManageSecrets: write,
      canManageVariables: write,
      why: {
        ...M.reasons('Bitbucket', ['canRetryFailed', 'canRerunSingleJob', 'canCancelJob', 'canPlayManualJob', 'canRunWithInputs']),
        canListRunners: t('Bitbucket не открывает раннеры в публичном API — управляйте ими в настройках репозитория (Repository settings → Runners)'),
        canDownloadArtifacts: t('Bitbucket не отдаёт артефакты пайплайна через публичный API'),
        canCreateRunnerToken: t('Раннер Bitbucket регистрируется в настройках репозитория — команда запуска показывается там'),
      },
    };
  },

  async init(ctx) {
    if (ctx.host !== 'bitbucket.org' && !ctx.apiOverride) {
      throw new GitError(t('Bitbucket Data Center не поддерживает Pipelines'), {
        code: 'UNSUPPORTED',
        hint: t('На своём сервере Bitbucket сборки обычно идут в Bamboo или Jenkins'),
      });
    }
    const r = await request(ctx, 'GET', repoApi(ctx), { notFound: t('Репозиторий {0}/{1} не найден или у входа нет к нему доступа', ctx.owner, ctx.repo) });
    ctx.defaultBranch = r.mainbranch?.name ?? null;
    ctx.webUrl = r.links?.html?.href ?? ctx.webUrl;
    ctx.canWrite = true;
  },

  async whoami(ctx) {
    const u = await request(ctx, 'GET', '/user');
    return { username: u.username ?? u.nickname, name: u.display_name ?? u.username, avatarUrl: u.links?.avatar?.href ?? null };
  },

  run(p, ctx) {
    const target = p.target ?? {};
    return {
      id: p.build_number,
      uuid: p.uuid,
      number: p.build_number,
      name: target.commit?.message?.split('\n')[0] ?? target.selector?.pattern ?? null,
      workflow: target.selector?.type === 'custom' ? `custom: ${target.selector.pattern}` : target.selector?.pattern ?? null,
      status: M.bitbucketStatus(p.state),
      branch: target.ref_name ?? null,
      sha: target.commit?.hash ?? null,
      createdAt: M.iso(p.created_on),
      startedAt: M.iso(p.created_on),
      finishedAt: M.iso(p.completed_on),
      duration: p.duration_in_seconds ?? p.build_seconds_used ?? null,
      url: `${ctx.webUrl}/pipelines/results/${p.build_number}`,
      triggeredBy: p.creator ? { name: p.creator.display_name, username: p.creator.nickname ?? p.creator.username ?? null } : null,
      source: p.trigger?.type ? String(p.trigger.type).replace(/^pipeline_trigger_/, '') : null,
    };
  },

  async listPipelines(ctx, { ref } = {}) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/pipelines/`, { query: { sort: '-created_on', pagelen: 50, 'target.ref_name': ref || undefined } });
    const pipelines = (data?.values ?? []).map((p) => this.run(p, ctx)).filter((p) => !ref || p.branch === ref);
    return { pipelines, bySha: M.bySha(pipelines), canWrite: ctx.canWrite !== false };
  },

  async pipelineDetail(ctx, id) {
    const [p, steps] = await Promise.all([
      request(ctx, 'GET', `${repoApi(ctx)}/pipelines/${Number(id)}`, { notFound: t('Пайплайн #{0} не найден', id) }),
      request(ctx, 'GET', `${repoApi(ctx)}/pipelines/${Number(id)}/steps/`, { query: { pagelen: 100 } }),
    ]);
    const pipeline = this.run(p, ctx);
    const jobs = (steps?.values ?? []).map((s, i) => ({
      id: s.uuid,
      kind: 'job',
      name: s.name ?? t('Шаг {0}', i + 1),
      stage: s.name ?? t('Шаг {0}', i + 1),
      status: M.bitbucketStatus(s.state),
      runnerName: s.runs_on?.length ? s.runs_on.join(', ') : null,
      runnerTags: s.runs_on ?? [],
      startedAt: M.iso(s.started_on),
      finishedAt: M.iso(s.completed_on),
      duration: s.duration_in_seconds ?? null,
      url: pipeline.url,
      logsUrl: pipeline.url,
      allowFailure: false,
      failureReason: s.state?.result?.error?.message ?? null,
      steps: [],
      manual: s.trigger?.type === 'pipeline_step_trigger_manual',
      pipelineId: pipeline.id,
    }));
    return { pipeline, jobs, artifacts: [], canWrite: ctx.canWrite !== false, sequential: true };
  },

  async jobLog(ctx, stepId, { pipelineId } = {}) {
    if (!pipelineId) throw new GitError(t('Не указан пайплайн шага'), { code: 'BAD_ARGS' });
    const log = await request(ctx, 'GET', `${repoApi(ctx)}/pipelines/${Number(pipelineId)}/steps/${encodeURIComponent(stepId)}/log`, { text: true }).catch((error) => {
      if (error.code === 'NOT_FOUND') return { text: '', size: 0 };
      throw error;
    });
    return { job: null, text: log.text, size: log.size, truncated: log.size > 1.5 * 1024 * 1024 };
  },

  async action(ctx, a) {
    if (a.type === 'pipeline.cancel') {
      await request(ctx, 'POST', `${repoApi(ctx)}/pipelines/${Number(a.id)}/stopPipeline`, { body: {} });
      return { type: a.type, id: a.id };
    }
    if (a.type === 'pipeline.retry') {
      // Повтор = новый пайплайн для той же ветки и коммита
      const p = await request(ctx, 'GET', `${repoApi(ctx)}/pipelines/${Number(a.id)}`);
      const res = await request(ctx, 'POST', `${repoApi(ctx)}/pipelines/`, { body: { target: p.target } });
      return { type: a.type, id: res?.build_number ?? null };
    }
    throw new GitError(t('Bitbucket не поддерживает это действие'), { code: 'UNSUPPORTED' });
  },

  async runPipeline(ctx, { ref, workflow, variables = [] }) {
    const target = { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: ref };
    // workflow «custom: name» — пайплайн из раздела pipelines.custom
    const m = /^custom:\s*(.+)$/.exec(workflow ?? '');
    if (m) target.selector = { type: 'custom', pattern: m[1].trim() };
    const vars = variables.filter((v) => v.key).map((v) => ({ key: v.key, value: String(v.value ?? ''), secured: Boolean(v.secured) }));
    const bad = vars.find((v) => !VAR_KEY.test(v.key));
    if (bad) throw new GitError(t('Некорректное имя переменной: {0}', bad.key), { code: 'BAD_ARGS' });
    const res = await request(ctx, 'POST', `${repoApi(ctx)}/pipelines/`, { body: { target, ...(vars.length ? { variables: vars } : {}) } });
    return { id: res?.build_number ?? null };
  },

  async listRunners() {
    throw new GitError(t('Bitbucket не открывает раннеры в публичном API'), { code: 'UNSUPPORTED', hint: 'Repository settings → Runners' });
  },

  async listArtifacts() {
    return [];
  },

  /* ---------- Переменные репозитория (Repository variables) ---------- */

  async listSecrets(ctx) {
    const data = await request(ctx, 'GET', `${repoApi(ctx)}/pipelines_config/variables/`, { query: { pagelen: 100 } });
    return (data?.values ?? []).map((v) => ({
      key: v.key,
      uuid: v.uuid,
      secret: Boolean(v.secured),
      masked: Boolean(v.secured),
      environmentScope: '*',
      value: v.secured ? null : v.value ?? '',
      updatedAt: null,
    }));
  },

  async saveSecret(ctx, { key, value, secret, original }) {
    if (!VAR_KEY.test(key ?? '')) throw new GitError(t('Имя переменной: латинские буквы, цифры и _'), { code: 'INVALID_NAME' });
    const body = { key, value: String(value ?? ''), secured: Boolean(secret) };
    if (original?.uuid) await request(ctx, 'PUT', `${repoApi(ctx)}/pipelines_config/variables/${encodeURIComponent(original.uuid)}`, { body });
    else await request(ctx, 'POST', `${repoApi(ctx)}/pipelines_config/variables/`, { body });
    return { key };
  },

  async deleteSecret(ctx, { uuid, key }) {
    if (!uuid) throw new GitError(t('Переменная {0} не найдена', key), { code: 'NOT_FOUND' });
    await request(ctx, 'DELETE', `${repoApi(ctx)}/pipelines_config/variables/${encodeURIComponent(uuid)}`);
    return { key };
  },
};

module.exports = bitbucket;
