// Пайплайны CI/CD любого провайдера (GitLab, GitHub Actions, Gitea/Forgejo, Bitbucket) через единый слой api.cicd:
// список и детали пайплайнов, задания и логи, артефакты, раннеры, секреты и переменные, расписания (GitLab), подключение.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Square,
  Variable,
  Zap,
} from 'lucide-react';
import { relativeTime } from '../../lib/format.js';
import { CiAuth } from '../TokenSetup.jsx';
import GitLabVariables from './GitLabVariables.jsx';
import GitLabSchedules from './GitLabSchedules.jsx';
import JobLog from './JobLog.jsx';
import RunDialog from './RunDialog.jsx';
import Runners from './Runners.jsx';
import Secrets from './Secrets.jsx';
import { ACTIVE_STATUSES, SOURCE_LABELS, StatusIcon, StatusPill, statusInfo } from '../PipelineStatus.jsx';
import { ActionButton, ConfirmAction, Duration, ErrorNote, IconBtn, ListSkeleton, SegButton, formatSize, usePolling } from './common.jsx';
import { t as tr, tj } from '../../i18n/index.ts';

const api = window.api;

const PROVIDER_COLORS = { gitlab: '#fc6d26', github: '#8b949e', gitea: '#609926', bitbucket: '#2684ff' };
const PROVIDERS = [
  { id: '', label: tr('Определять автоматически') },
  { id: 'gitlab', label: 'GitLab CI (gitlab.com, Self-Managed)' },
  { id: 'github', label: 'GitHub Actions (github.com, Enterprise Server)' },
  { id: 'gitea', label: 'Gitea / Forgejo Actions' },
  { id: 'bitbucket', label: 'Bitbucket Pipelines' },
];

export default function CiPanel({
  repoPath,
  forge,
  remoteName,
  currentBranch,
  commitsBySha,
  initialPipelineId,
  focusFailed,
  onLocate,
  onForgeChanged,
  onEditLogin,
  notify,
  branches = [],
  onInsertTags,
  canInsertTags,
  initialTab,
}) {
  const [tab, setTab] = useState(initialTab ?? 'pipelines');
  const [jump, setJump] = useState(null); // { pipelineId, jobId }
  const opts = useMemo(() => ({ remote: remoteName }), [remoteName]);
  const caps = forge?.capabilities ?? {};
  const provider = forge?.provider ?? null;
  const label = forge?.label ?? 'CI/CD';

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!provider || !forge?.token?.configured) {
    return (
      <div className="flex min-w-0 flex-1 justify-center overflow-y-auto p-6">
        <div className="w-full max-w-[560px] animate-slide-up space-y-5" data-testid="ci-setup">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PROVIDER_COLORS[provider] ?? '#8a92a2' }} />
              <h3 className="text-[15px] font-semibold text-gk-strong">{provider ? tr('Пайплайны {0}', label) : tr('Пайплайны CI/CD')}</h3>
            </div>
            <p className="text-[13px] leading-relaxed text-gk-muted">
              {provider
                ? tr('Статусы пайплайнов в графе, логи, запуск, раннеры и секреты работают от авторизации репозитория — той же, что для Pull и Push. Отдельно входить не нужно.')
                : tr('Не удалось определить, где выполняется CI этого репозитория. Укажите сервис и, для своего сервера, адрес API.')}
            </p>
          </div>
          {provider && <CiAuth forge={forge} onEditLogin={onEditLogin} />}
          <CiSettings repoPath={repoPath} opts={opts} forge={forge} onSaved={onForgeChanged} notify={notify} compact={Boolean(provider)} />
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'pipelines', label: tr('Пайплайны'), icon: Zap },
    { id: 'runners', label: tr('Раннеры'), icon: Server, why: caps.canListRunners ? null : caps.why?.canListRunners },
    { id: 'secrets', label: tr('Секреты и переменные'), icon: Variable, why: caps.canManageSecrets ? null : caps.why?.canManageSecrets ?? tr('Секреты видны только администраторам репозитория') },
    ...(caps.hasSchedules ? [{ id: 'schedules', label: tr('Расписания'), icon: CalendarClock }] : []),
    { id: 'settings', label: tr('Подключение'), icon: Settings2 },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid="ci-panel" data-provider={provider}>
      <div className="flex shrink-0 items-center gap-1 border-b border-gk-border px-3 py-1.5">
        <span className="mr-1 flex items-center gap-1.5 text-[11.5px] font-medium text-gk-muted" data-testid="ci-provider">
          <span className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLORS[provider] }} />
          {label}
        </span>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => !t.why && setTab(t.id)}
            disabled={Boolean(t.why)}
            data-tip={t.why || undefined}
            data-testid={`ci-tab-${t.id}`}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40 ${
              tab === t.id ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted enabled:hover:text-gk-text'
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => api.openExternal(forge.webUrl)}
          className="flex items-center gap-1 truncate rounded px-2 py-1 font-mono text-[11px] text-gk-dim hover:bg-gk-hover hover:text-gk-text"
          title={tr('Открыть репозиторий в {0}', label)}
        >
          {forge.path} <ExternalLink size={11} />
        </button>
        <span
          data-testid="gl-auth-source"
          className="truncate text-[11px] text-gk-dim"
          title={`${forge.token.source?.startsWith('legacy') ? tr('Токен CI/CD из прежней версии') : tr('Авторизация репозитория — та же, что для Pull и Push')}${forge.token.scopes ? ` · ${forge.token.scopes.join(', ')}` : ''}`}
        >
          {forge.token.user?.username ? `@${forge.token.user.username}` : ''}
          {(forge.token.source === 'login' || forge.token.source === 'login-shared') && <span className="ml-1">{tr('· авторизация репозитория')}</span>}
          {forge.token.scopes && !forge.token.scopes.includes('api') && <span className="ml-1 text-gk-yellow">{tr('· только просмотр')}</span>}
        </span>
      </div>

      {tab === 'pipelines' && (
        <PipelinesTab
          repoPath={repoPath}
          opts={opts}
          caps={caps}
          provider={provider}
          providerLabel={label}
          currentBranch={currentBranch}
          branches={branches}
          commitsBySha={commitsBySha}
          initialPipelineId={jump?.pipelineId ?? initialPipelineId}
          initialJobId={jump?.jobId ?? null}
          focusFailed={focusFailed}
          onLocate={onLocate}
          notify={notify}
        />
      )}
      {tab === 'runners' && (
        <Runners
          repoPath={repoPath}
          opts={opts}
          caps={caps}
          provider={provider}
          providerLabel={label}
          notify={notify}
          canInsert={canInsertTags}
          onInsertTags={onInsertTags}
          onOpenJob={(job) => {
            if (job.pipelineId) {
              setJump({ pipelineId: job.pipelineId, jobId: job.id, n: Date.now() });
              setTab('pipelines');
            } else if (job.url) api.openExternal(job.url);
          }}
        />
      )}
      {tab === 'secrets' &&
        (provider === 'gitlab' ? (
          <GitLabVariables repoPath={repoPath} opts={opts} canWrite={!forge.token.scopes || forge.token.scopes.includes('api')} notify={notify} />
        ) : (
          <Secrets repoPath={repoPath} opts={opts} caps={caps} providerLabel={label} notify={notify} />
        ))}
      {tab === 'schedules' && (
        <GitLabSchedules
          repoPath={repoPath}
          opts={opts}
          branches={branches}
          currentBranch={currentBranch}
          notify={notify}
          onOpenPipeline={(id) => {
            setJump({ pipelineId: id, n: Date.now() });
            setTab('pipelines');
          }}
        />
      )}
      {tab === 'settings' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="max-w-[560px] space-y-5">
            <CiAuth forge={forge} onEditLogin={onEditLogin} />
            <CiSettings repoPath={repoPath} opts={opts} forge={forge} onSaved={onForgeChanged} notify={notify} />
          </div>
        </div>
      )}
    </div>
  );
}

/* =================== Подключение: провайдер и адрес API =================== */

function CiSettings({ repoPath, opts, forge, onSaved, notify, compact }) {
  const [data, setData] = useState(null);
  const [provider, setProvider] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    api.cicd.settings(repoPath, opts).then((res) => {
      if (!res.ok || !res.data) return;
      setData(res.data);
      setProvider(res.data.provider ?? '');
      setApiBase(res.data.apiBase ?? '');
    });
  }, [repoPath, opts, forge?.provider]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await api.cicd.saveSettings(repoPath, { provider, apiBase }, opts);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setData(res.data);
    notify?.({ type: 'success', title: tr('Подключение CI/CD сохранено') });
    onSaved?.();
  };

  if (!data) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[12px] text-gk-blue hover:underline" data-testid="ci-settings-open">
        {tj('{0} Свой сервер: указать сервис и адрес API', [<Settings2 size={12} />])}</button>
    );
  }
  const changed = (data.provider ?? '') !== provider || (data.apiBase ?? '') !== apiBase.trim();
  return (
    <div className="space-y-3 rounded-lg border border-gk-border p-3.5" data-testid="ci-settings">
      <div className="text-[12.5px] font-medium text-gk-text">{tr('Подключение CI/CD')}</div>
      <label className="block">
        {tj('<0>Сервис</0>{1}', [<span className="mb-1 block text-[12px] text-gk-muted" />, <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          data-testid="ci-settings-provider"
          className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === '' && data.detected ? tr('{0} (сейчас: {1})', p.label, PROVIDERS.find((x) => x.id === data.detected)?.label.split(' (')[0] ?? data.detected) : p.label}
            </option>
          ))}
        </select>])}
      </label>
      <label className="block">
        {tj('<0>Base API URL — для своего сервера (GitLab Self-Managed, GitHub Enterprise, Gitea)</0>{1}<2>Пусто — {3}. Токен — из авторизации репозитория, отдельно его вводить не нужно.</2>', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder={data.defaultApiBase ?? 'https://git.company.ru'}
          data-testid="ci-settings-api"
          className="w-full rounded-md bg-gk-bg px-2 py-1.5 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
        />, <span className="mt-1 block text-[11.5px] leading-snug text-gk-dim" />, data.defaultApiBase ? <span className="font-mono">{data.defaultApiBase}</span> : tr('по адресу remote')])}
      </label>
      {error && <ErrorNote error={error} className="" />}
      <div className="flex gap-2">
        <ActionButton tone="blue" busy={busy} disabled={!changed} onClick={save} data-testid="ci-settings-save">
          {tr('Сохранить')}</ActionButton>
        {compact && (
          <ActionButton onClick={() => setOpen(false)} disabled={busy}>
            {tr('Свернуть')}</ActionButton>
        )}
      </div>
    </div>
  );
}

/* =================== Пайплайны =================== */

function PipelinesTab({ repoPath, opts, caps, provider, providerLabel, currentBranch, branches, commitsBySha, initialPipelineId, initialJobId, focusFailed, onLocate, notify }) {
  const [onlyBranch, setOnlyBranch] = useState(false);
  const [list, setList] = useState({ loading: true, data: null, error: null });
  const [selected, setSelected] = useState(initialPipelineId ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => {
    if (initialPipelineId) setSelected(initialPipelineId);
  }, [initialPipelineId]);

  const load = useCallback(async () => {
    const res = await api.cicd.pipelines(repoPath, { ...opts, ref: onlyBranch ? currentBranch : undefined });
    setList((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
    return res;
  }, [repoPath, opts, onlyBranch, currentBranch]);

  useEffect(() => {
    setList((s) => ({ ...s, loading: true }));
    load().then((res) => {
      if (res.ok && !selected && res.data.pipelines[0]) setSelected(res.data.pipelines[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  const anyActive = list.data?.pipelines.some((p) => ACTIVE_STATUSES.has(p.status));
  usePolling(load, list.error ? 0 : anyActive ? 6000 : 30000, [load]);

  const pipelines = list.data?.pipelines ?? [];
  const live = list.data?.capabilities ?? caps;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-gk-border">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-gk-border px-2 py-1.5">
          <div className="flex overflow-hidden rounded ring-1 ring-gk-border">
            <SegButton active={!onlyBranch} onClick={() => setOnlyBranch(false)}>
              {tr('Все')}</SegButton>
            <SegButton active={onlyBranch} onClick={() => setOnlyBranch(true)} disabled={!currentBranch} title={currentBranch}>
              <GitBranch size={11} /> <span className="max-w-[110px] truncate">{currentBranch ?? tr('ветка')}</span>
            </SegButton>
          </div>
          <div className="flex-1" />
          <IconBtn title={tr('Обновить')} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw size={13} className={list.loading ? 'animate-spin' : ''} />
          </IconBtn>
          <ActionButton icon={Play} tone="green" why={live.canRunPipeline ? (currentBranch ? null : tr('Нет активной ветки')) : live.why?.canRunPipeline ?? tr('Нет прав на запуск')} onClick={() => setRunOpen(true)} data-testid="run-open">
            {tr('Запустить')}</ActionButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="pipeline-list">
          {list.error && !list.data && <ErrorNote error={list.error} />}
          {list.error && list.data && <div className="border-b border-gk-border px-3 py-1.5 text-[11px] text-gk-yellow">{tj('Не удалось обновить: {0}', [list.error.message])}</div>}
          {list.loading && !list.data && <ListSkeleton />}
          {list.data && pipelines.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-gk-dim">{onlyBranch ? tr('В ветке {0} пайплайнов ещё не было', currentBranch) : tr('Пайплайнов ещё не было')}</div>
          )}
          {pipelines.map((p, i) => {
            const commit = commitsBySha?.get(p.sha);
            const running = ACTIVE_STATUSES.has(p.status);
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                data-testid="pipeline-item"
                data-id={p.id}
                data-status={p.status}
                className={`flex w-full animate-fade-in items-start gap-2.5 border-b border-gk-border/50 px-3 py-2 text-left transition-colors ${selected === p.id ? 'bg-gk-blue/12' : 'hover:bg-gk-hover/60'}`}
                style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
              >
                <StatusIcon status={p.status} size={17} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-gk-text">{commit?.message ?? p.name ?? p.sha?.slice(0, 8)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gk-dim">
                    <span className="font-mono text-gk-muted">#{p.number ?? p.id}</span>
                    {p.branch && <span className="max-w-[110px] truncate rounded bg-gk-fg/5 px-1">{p.branch}</span>}
                    {p.workflow && provider !== 'gitlab' && <span className="max-w-[80px] truncate">{p.workflow}</span>}
                    {!p.workflow && p.source && <span className="truncate">{SOURCE_LABELS[p.source] ?? p.source}</span>}
                    <span className="ml-auto shrink-0">{running ? <Duration startedAt={p.startedAt ?? p.createdAt} running /> : relativeTime(p.createdAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1">
        {selected ? (
          <PipelineDetail
            key={selected}
            repoPath={repoPath}
            opts={opts}
            pipelineId={selected}
            initialJobId={selected === initialPipelineId ? initialJobId : null}
            focusFailed={focusFailed && selected === initialPipelineId}
            commitsBySha={commitsBySha}
            providerLabel={providerLabel}
            onLocate={onLocate}
            notify={notify}
            onChanged={() => load()}
            onOpenPipeline={setSelected}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-gk-dim">{tr('Выберите пайплайн слева')}</div>
        )}
      </div>

      {runOpen && (
        <RunDialog
          repoPath={repoPath}
          opts={opts}
          caps={live}
          providerLabel={providerLabel}
          branches={branches.map((b) => b.name ?? b)}
          currentBranch={currentBranch}
          onClose={() => setRunOpen(false)}
          onStarted={(res, params) => {
            setRunOpen(false);
            notify?.({ type: 'success', title: res?.id ? tr('Пайплайн #{0} запущен', res.id) : tr('Пайплайн запущен'), hint: tr('Ветка {0}', params.ref) });
            if (res?.id) setSelected(res.id);
            setRefreshKey((k) => k + 1);
            setTimeout(() => load(), 3000);
          }}
        />
      )}
    </div>
  );
}

/* =================== Детали пайплайна =================== */

function PipelineDetail({ repoPath, opts, pipelineId, initialJobId, focusFailed, commitsBySha, providerLabel, onLocate, notify, onChanged, onOpenPipeline }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [jobId, setJobId] = useState(initialJobId ?? null);
  const [busy, setBusy] = useState(null);
  const [focused, setFocused] = useState(false);

  const load = useCallback(async () => {
    const res = await api.cicd.pipeline(repoPath, pipelineId, opts);
    setState((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
  }, [repoPath, pipelineId, opts]);

  useEffect(() => {
    load();
  }, [load]);

  const p = state.data?.pipeline;
  const caps = state.data?.capabilities ?? {};
  const jobs = useMemo(() => state.data?.stages.flatMap((s) => s.jobs) ?? [], [state.data]);
  const active = p && (ACTIVE_STATUSES.has(p.status) || jobs.some((j) => ACTIVE_STATUSES.has(j.status)));
  usePolling(load, state.error ? 0 : active ? 4000 : 0, [load]);

  // Открыли из графа красный пайплайн — сразу лог упавшего задания
  useEffect(() => {
    if (!focusFailed || focused || !state.data) return;
    setFocused(true);
    if (p?.status !== 'failed') return;
    const failed = jobs.find((j) => j.status === 'failed' && !j.allowFailure) ?? jobs.find((j) => j.status === 'failed');
    if (failed) setJobId(failed.id);
  }, [focusFailed, focused, state.data, p, jobs]);

  const act = async (action, label) => {
    setBusy(`${action.type}:${action.id}`);
    const res = await api.cicd.action(repoPath, action, opts);
    setBusy(null);
    if (!res.ok) {
      notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
      return null;
    }
    notify?.({ type: 'success', title: label });
    await load();
    onChanged?.();
    return res.data;
  };

  const download = async (a) => {
    setBusy(`artifact:${a.id}`);
    const res = await api.cicd.downloadArtifact(repoPath, a, opts);
    setBusy(null);
    if (!res.ok) return notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    if (res.data.canceled) return;
    notify?.({ type: 'success', title: tr('Артефакт {0} скачан', a.name), hint: res.data.path, action: { label: tr('Показать'), onClick: () => api.cicd.showFile(res.data.path) } });
  };

  if (state.loading && !state.data) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
        {tj('{0} Загружаем пайплайн #{1}…', [<Loader2 size={15} className="animate-spin" />, pipelineId])}</div>
    );
  }
  if (!state.data) return <ErrorNote error={state.error} />;

  const job = jobs.find((j) => j.id === jobId);
  const commit = commitsBySha?.get(p.sha);
  const failedCount = jobs.filter((j) => j.status === 'failed' && !j.allowFailure).length;
  const artifacts = state.data.artifacts ?? [];
  const running = ACTIVE_STATUSES.has(p.status);

  return (
    <>
      <div className="min-w-0 flex-1 overflow-auto" data-testid="pipeline-detail" data-status={p.status}>
        <div className="space-y-4 p-4">
          <div className="animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={p.status} big />
              <span className="font-mono text-[13px] text-gk-muted">#{p.number ?? p.id}</span>
              <div className="flex-1" />
              {['failed', 'canceled'].includes(p.status) && failedCount > 0 && (
                <ActionButton
                  icon={RotateCcw}
                  busy={busy === `pipeline.retry-failed:${p.id}`}
                  why={caps.canRetryFailed ? null : caps.why?.canRetryFailed ?? tr('Недоступно')}
                  onClick={() => act({ type: 'pipeline.retry-failed', id: p.id }, tr('Упавшие задания пайплайна #{0} перезапущены', p.number ?? p.id))}
                  data-testid="retry-failed"
                >
                  {tj('Перезапустить упавшие ({0})', [failedCount])}</ActionButton>
              )}
              {!running && (
                <ActionButton
                  icon={RotateCcw}
                  busy={busy === `pipeline.retry:${p.id}`}
                  why={caps.canRetry ? null : caps.why?.canRetry ?? tr('Недоступно')}
                  onClick={() => act({ type: 'pipeline.retry', id: p.id }, tr('Пайплайн #{0} перезапущен', p.number ?? p.id))}
                  data-testid="retry-all"
                >
                  {tr('Перезапустить')}</ActionButton>
              )}
              {running && (
                <ConfirmAction
                  icon={Square}
                  busy={busy === `pipeline.cancel:${p.id}`}
                  label={tr('Отменить')}
                  confirmLabel={tr('Точно отменить?')}
                  testid="pipeline-cancel"
                  why={caps.canCancel ? null : caps.why?.canCancel ?? tr('Недоступно')}
                  onConfirm={() => act({ type: 'pipeline.cancel', id: p.id }, tr('Пайплайн #{0} отменён', p.number ?? p.id))}
                />
              )}
              {p.url && (
                <ActionButton icon={ExternalLink} onClick={() => api.openExternal(p.url)}>
                  {tj('В {0}', [providerLabel.split(' ')[0]])}
                </ActionButton>
              )}
            </div>
            <div className="mt-2 text-[15px] font-medium text-gk-strong">{commit?.message ?? p.name ?? tr('Пайплайн')}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gk-muted">
              {p.branch && (
                <span className="flex items-center gap-1">
                  <GitBranch size={12} /> {p.branch}
                </span>
              )}
              {p.sha && (
                <button
                  onClick={() => onLocate?.(p.sha)}
                  disabled={!commit}
                  title={commit ? tr('Показать коммит в графе') : tr('Коммита нет в загруженной истории')}
                  className="flex items-center gap-1 font-mono text-gk-blue enabled:hover:underline disabled:text-gk-dim"
                >
                  <GitCommitHorizontal size={12} /> {p.sha.slice(0, 8)}
                </button>
              )}
              {p.workflow && <span>{p.workflow}</span>}
              {p.triggeredBy && <span>{tj('запустил {0}', [p.triggeredBy.name])}</span>}
              {p.source && <span>{SOURCE_LABELS[p.source] ?? p.source}</span>}
              <span title={p.createdAt}>{relativeTime(p.createdAt)}</span>
              <Duration startedAt={p.startedAt ?? p.createdAt} duration={p.duration} running={running} prefix="⏱ " />
              {p.coverage != null && <span>{tj('покрытие {0}%', [p.coverage])}</span>}
            </div>
          </div>

          {p.yamlErrors && (
            <div className="rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px] text-gk-text">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-gk-red">
                {tj('{0} Ошибка в конфигурации CI', [<AlertTriangle size={13} />])}</div>
              {p.yamlErrors}
            </div>
          )}
          {state.error && <div className="text-[11px] text-gk-yellow">{tj('Не удалось обновить: {0}', [state.error.message])}</div>}

          {state.data.stages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim">{tr('В пайплайне нет заданий')}</div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max gap-3">
                {state.data.stages.map((stage, si) => (
                  <div key={`${stage.name}-${si}`} className="w-56 shrink-0 animate-slide-up rounded-lg border border-gk-border bg-gk-fg/[0.02]" style={{ animationDelay: `${si * 40}ms` }} data-testid="pipeline-stage">
                    <div className="flex items-center gap-2 border-b border-gk-border px-3 py-2">
                      <StatusIcon status={stage.status} size={14} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gk-muted">{stage.name}</span>
                      <span className="text-[10px] text-gk-dim">{stage.jobs.length}</span>
                    </div>
                    <div className="space-y-1 p-1.5">
                      {stage.jobs.map((j) => (
                        <JobRow
                          key={j.id}
                          job={j}
                          caps={caps}
                          selected={jobId === j.id}
                          busy={busy}
                          onOpen={() => (j.kind === 'bridge' ? j.downstream && api.openExternal(j.downstream.url) : setJobId(j.id))}
                          onAction={(type, label) => act({ type, id: j.id }, label)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(artifacts.length > 0 || caps.canDownloadArtifacts) && !running && (
            <div data-testid="artifacts">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">
                {tj('{0} Артефакты <1>{2}</1>', [<Package size={12} />, <span className="font-normal" />, artifacts.length])}
              </div>
              {artifacts.length === 0 ? (
                <div className="text-[12px] text-gk-dim">{tr('Пайплайн не сохранил артефактов')}</div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gk-border">
                  {artifacts.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 border-b border-gk-border/60 px-3 py-1.5 text-[12.5px] last:border-0" data-testid="artifact">
                      <Package size={13} className="shrink-0 text-gk-purple" />
                      <span className="min-w-0 flex-1 truncate text-gk-text">{a.name}</span>
                      {a.jobName && a.jobName !== a.name && <span className="truncate text-[11px] text-gk-dim">{a.jobName}</span>}
                      <span className="shrink-0 text-[11px] text-gk-dim">{formatSize(a.size)}</span>
                      <ActionButton
                        icon={a.expired ? FolderOpen : Download}
                        busy={busy === `artifact:${a.id}`}
                        why={a.expired ? tr('Срок хранения истёк — артефакт удалён') : caps.canDownloadArtifacts ? null : caps.why?.canDownloadArtifacts}
                        onClick={() => download(a)}
                        data-testid="artifact-download"
                      >
                        {tr('Скачать')}</ActionButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {job && (
        <JobLog
          key={job.id}
          repoPath={repoPath}
          opts={opts}
          job={job}
          pipelineId={job.pipelineId ?? p.id}
          caps={caps}
          providerLabel={providerLabel}
          onClose={() => setJobId(null)}
          onAction={async (type, label) => {
            const r = await act({ type, id: job.id }, label);
            if (r && type === 'job.retry' && r.id && r.id !== job.id) setJobId(r.id);
          }}
          onOpenPipeline={onOpenPipeline}
        />
      )}
    </>
  );
}

function JobRow({ job, caps, selected, busy, onOpen, onAction }) {
  const isBusy = (type) => busy === `${type}:${job.id}`;
  const running = ACTIVE_STATUSES.has(job.status);
  const actions = [];
  if (job.kind === 'job') {
    if (job.status === 'manual' && caps.canPlayManualJob) actions.push({ type: 'job.play', icon: Play, title: tr('Запустить'), label: tr('Задание {0} запущено', job.name) });
    if (['failed', 'canceled', 'success'].includes(job.status) && caps.canRerunSingleJob) actions.push({ type: 'job.retry', icon: RotateCcw, title: tr('Перезапустить'), label: tr('Задание {0} перезапущено', job.name) });
    if (running && caps.canCancelJob) actions.push({ type: 'job.cancel', icon: Square, title: tr('Отменить'), label: tr('Задание {0} отменено', job.name) });
  }
  return (
    <div
      onClick={onOpen}
      data-testid="job-row"
      data-status={job.status}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${selected ? 'bg-gk-blue/15 ring-1 ring-gk-blue/40' : 'hover:bg-gk-hover'}`}
      title={job.kind === 'bridge' ? tr('Запускает другой пайплайн — открыть в браузере') : tr('Открыть лог')}
    >
      <StatusIcon status={job.allowFailure && job.status === 'failed' ? 'warning' : job.status} size={15} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {job.kind === 'bridge' && <Zap size={11} className="shrink-0 text-gk-purple" />}
          <span className="truncate text-[12.5px] text-gk-text">{job.name}</span>
        </div>
        <div className="flex items-center gap-1 truncate text-[10.5px] text-gk-dim">
          {job.kind === 'bridge' ? (
            job.downstream ? tr('→ пайплайн #{0} · {1}', job.downstream.id, statusInfo(job.downstream.status).label) : statusInfo(job.status).label
          ) : running && job.startedAt ? (
            <Duration startedAt={job.startedAt} running className="text-gk-blue" />
          ) : job.duration != null ? (
            <Duration duration={job.duration} />
          ) : (
            statusInfo(job.status).label
          )}
          {job.allowFailure && job.status === 'failed' && tr(' · можно упасть')}
          {job.runnerName && <span className="truncate">· {job.runnerName}</span>}
        </div>
      </div>
      {actions.map((a) => (
        <button
          key={a.type}
          title={a.title}
          onClick={(e) => {
            e.stopPropagation();
            onAction(a.type, a.label);
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-gk-muted transition-opacity hover:bg-gk-fg/10 hover:text-gk-text ${
            a.type === 'job.play' || isBusy(a.type) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isBusy(a.type) ? <Loader2 size={12} className="animate-spin" /> : <a.icon size={12} />}
        </button>
      ))}
    </div>
  );
}
