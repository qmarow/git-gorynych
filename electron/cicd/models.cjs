// Единые модели CI/CD для интерфейса — ответы GitLab, GitHub, Gitea/Forgejo и Bitbucket приводятся к ним.
//
// PipelineRun:  { id, number, name, status, branch, sha, duration, createdAt, startedAt, finishedAt, url, triggeredBy, source, workflow }
// PipelineJob:  { id, kind, name, stage, status, runnerName, runnerTags, startedAt, finishedAt, duration, url, logsUrl, allowFailure,
//                 failureReason, steps: PipelineStep[], manual, downstream, artifacts }
// PipelineStep: { number, name, status, startedAt, duration }
// CiRunner:     { id, name, description, status: online|offline|busy|paused, isShared, os, architecture, labels, version, ipAddress,
//                 currentJobId, currentJob, type, virtual, runUntagged, locked, maximumTimeout, contactedAt, editable }
// CiArtifact:   { id, name, size, downloadUrl, expired, jobId, jobName }
// CiSecretVariable: { key, masked, secret, environmentScope, value, updatedAt, protected }
//
// Статусы пайплайна и задания: success | failed | running | pending | canceled | skipped — и уточнения GitLab
// (manual, created, scheduled, preparing, waiting_for_resource, canceling), которые интерфейс тоже умеет показать.

/** Возможности провайдера: что интерфейс показывает, а что прячет или выключает с подсказкой */
const NO_CAPS = {
  canListPipelines: false,
  canRunPipeline: false,
  canRunWithInputs: false,
  canRunWithVariables: false,
  canCancel: false,
  canRetry: false,
  canRetryFailed: false,
  canRerunSingleJob: false,
  canCancelJob: false,
  canPlayManualJob: false,
  canDownloadArtifacts: false,
  canListRunners: false,
  canEditRunnerLabels: false,
  canPauseRunner: false,
  canEditRunnerSettings: false,
  canDeleteRunner: false,
  canCreateRunnerToken: false,
  canManageSecrets: false,
  canManageVariables: false,
  hasSchedules: false,
  hasStages: false,
  localRunner: false,
};

/** Почему функции нет — для подсказки на выключенной кнопке */
const reasons = (label, list) => Object.fromEntries(list.map((k) => [k, `${label} не даёт этого сделать через API`]));

const iso = (v) => (v ? new Date(v).toISOString() : null);
const secondsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : null);

/** GitHub / Gitea: status + conclusion → единый статус */
function githubStatus(status, conclusion) {
  const s = String(status ?? '').toLowerCase();
  const c = String(conclusion ?? '').toLowerCase();
  if (s === 'completed' || c) {
    if (c === 'success' || c === 'neutral') return 'success';
    if (c === 'failure' || c === 'timed_out' || c === 'startup_failure') return 'failed';
    if (c === 'cancelled' || c === 'stale') return 'canceled';
    if (c === 'skipped') return 'skipped';
    if (c === 'action_required') return 'manual';
    if (s === 'completed') return 'success';
  }
  // Старые ответы Gitea: status — сразу итог
  if (s === 'success') return 'success';
  if (s === 'failure' || s === 'failed') return 'failed';
  if (s === 'cancelled' || s === 'canceled') return 'canceled';
  if (s === 'skipped') return 'skipped';
  if (s === 'in_progress' || s === 'running') return 'running';
  if (s === 'blocked') return 'manual';
  if (s === 'queued' || s === 'waiting' || s === 'requested' || s === 'pending' || s === 'unknown') return 'pending';
  return 'pending';
}

/** Bitbucket: state { name, result { name }, stage { name } } → единый статус */
function bitbucketStatus(state) {
  const n = String(state?.name ?? '').toUpperCase();
  const r = String(state?.result?.name ?? '').toUpperCase();
  const st = String(state?.stage?.name ?? '').toUpperCase();
  if (n === 'COMPLETED') {
    if (r === 'SUCCESSFUL') return 'success';
    if (r === 'FAILED' || r === 'ERROR') return 'failed';
    if (r === 'STOPPED' || r === 'EXPIRED') return 'canceled';
    if (r === 'NOT_RUN' || r === 'SKIPPED') return 'skipped';
    return 'success';
  }
  if (n === 'IN_PROGRESS' || n === 'RUNNING') return st === 'PAUSED' || st === 'HALTED' ? 'manual' : 'running';
  if (n === 'HALTED' || n === 'PAUSED') return 'manual';
  if (n === 'PENDING' || n === 'READY') return 'pending';
  return 'pending';
}

const ORDER = ['failed', 'running', 'pending', 'preparing', 'waiting_for_resource', 'scheduled', 'manual', 'canceling', 'canceled', 'created', 'success', 'skipped'];

/** Статус этапа по его заданиям */
function aggregate(jobs) {
  const statuses = jobs.map((j) => (j.status === 'failed' && j.allowFailure ? 'success' : j.status));
  if (statuses.length && statuses.every((s) => s === 'skipped')) return 'skipped';
  for (const s of ORDER) if (statuses.includes(s)) return s === 'skipped' ? 'success' : s;
  return 'created';
}

/** Последний пайплайн каждого коммита — для значков в графе */
function bySha(pipelines) {
  const out = {};
  for (const p of pipelines) if (p.sha && !out[p.sha]) out[p.sha] = { id: p.id, status: p.status, branch: p.branch, url: p.url, name: p.name };
  return out;
}

/** Архитектура и ОС раннера по меткам GitHub/Gitea (self-hosted, Linux, X64, ubuntu-latest:docker://…) */
function platformFromLabels(labels, os = null) {
  const low = labels.map((l) => String(l).toLowerCase());
  let arch = null;
  if (low.some((l) => /^(x64|amd64|x86_64)$/.test(l))) arch = 'x64';
  else if (low.some((l) => /^(arm64|aarch64)$/.test(l) || /-arm$/.test(l))) arch = 'arm64';
  else if (low.some((l) => /^arm$/.test(l))) arch = 'arm';
  let platform = os ? String(os).toLowerCase() : null;
  if (!platform) {
    if (low.some((l) => /windows/.test(l))) platform = 'windows';
    else if (low.some((l) => /macos|osx|darwin/.test(l))) platform = 'macos';
    else if (low.some((l) => /linux|ubuntu|debian|alpine|docker/.test(l))) platform = 'linux';
  }
  if (platform === 'macos' || platform === 'darwin' || platform === 'osx') platform = 'macos';
  return { os: platform, architecture: arch };
}

function runner(fields) {
  return {
    id: fields.id,
    name: fields.name ?? `#${fields.id}`,
    description: fields.description ?? null,
    status: fields.status ?? 'offline',
    isShared: Boolean(fields.isShared),
    os: fields.os ?? null,
    architecture: fields.architecture ?? null,
    labels: [...new Set((fields.labels ?? []).map(String))],
    readOnlyLabels: fields.readOnlyLabels ?? [],
    version: fields.version ?? null,
    ipAddress: fields.ipAddress ?? null,
    currentJobId: fields.currentJobId ?? null,
    currentJob: fields.currentJob ?? null,
    type: fields.type ?? null,
    virtual: Boolean(fields.virtual),
    runUntagged: fields.runUntagged ?? null,
    locked: fields.locked ?? null,
    maximumTimeout: fields.maximumTimeout ?? null,
    contactedAt: fields.contactedAt ?? null,
    stale: Boolean(fields.stale),
    editable: fields.editable !== false && !fields.virtual,
  };
}

module.exports = { NO_CAPS, reasons, iso, secondsBetween, githubStatus, bitbucketStatus, aggregate, bySha, platformFromLabels, runner };
