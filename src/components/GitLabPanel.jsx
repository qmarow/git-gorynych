import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Variable,
  WrapText,
  Zap,
} from 'lucide-react';
import { relativeTime } from '../lib/format.js';
import { parseLog } from '../lib/ansi.js';
import { TokenSetup } from './TokenSetup.jsx';
import {
  ACTIVE_STATUSES,
  FAILURE_REASONS,
  SOURCE_LABELS,
  StatusIcon,
  StatusPill,
  formatDuration,
  statusInfo,
} from './PipelineStatus.jsx';

const api = window.api;

const SUBTABS = [
  { id: 'pipelines', label: 'Пайплайны', icon: Zap },
  { id: 'variables', label: 'Переменные', icon: Variable },
  { id: 'runners', label: 'Раннеры', icon: Server },
];

// Повторяем запрос с интервалом, пока вкладка видима; delay может меняться
function usePolling(fn, delay, deps) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!delay) return undefined;
    let timer = null;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === 'visible') await fnRef.current();
      if (alive) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
}

/**
 * Пайплайны GitLab: список, детали с этапами и заданиями, лог задания, переменные и раннеры проекта.
 */
export default function GitLabPanel({
  repoPath,
  forge,
  remoteName,
  currentBranch,
  commitsBySha,
  initialPipelineId,
  onLocate,
  onForgeChanged,
  notify,
}) {
  const [tab, setTab] = useState('pipelines');
  const opts = useMemo(() => ({ remote: remoteName }), [remoteName]);

  if (!forge?.token?.configured) {
    return (
      <div className="flex min-w-0 flex-1 justify-center overflow-y-auto p-6">
        <div className="w-full max-w-[520px] animate-slide-up">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#fc6d26]" />
            <h3 className="text-[15px] font-semibold text-white">Подключите GitLab</h3>
          </div>
          <p className="mb-5 text-[13px] leading-relaxed text-gk-muted">
            Чтобы видеть статусы пайплайнов прямо в графе, читать логи заданий, перезапускать и отменять их, нужен личный токен
            доступа к {forge?.host ?? 'GitLab'}.
          </p>
          <TokenSetup repoPath={repoPath} forge={forge} remoteName={remoteName} onChanged={onForgeChanged} autoFocus />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-gk-border px-3 py-1.5">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors ${
              tab === t.id ? 'bg-gk-hover text-white' : 'text-gk-muted hover:text-gk-text'
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => api.openExternal(`${forge.webUrl}/-/pipelines`)}
          className="flex items-center gap-1 truncate rounded px-2 py-1 font-mono text-[11px] text-gk-dim hover:bg-gk-hover hover:text-gk-text"
          title="Открыть проект в GitLab"
        >
          {forge.path} <ExternalLink size={11} />
        </button>
        <span className="truncate text-[11px] text-gk-dim" title={forge.token.scopes?.join(', ')}>
          @{forge.token.user?.username}
          {forge.token.scopes && !forge.token.scopes.includes('api') && <span className="ml-1 text-gk-yellow">· только просмотр</span>}
        </span>
      </div>

      {tab === 'pipelines' && (
        <PipelinesTab
          repoPath={repoPath}
          opts={opts}
          currentBranch={currentBranch}
          commitsBySha={commitsBySha}
          initialPipelineId={initialPipelineId}
          onLocate={onLocate}
          notify={notify}
        />
      )}
      {tab === 'variables' && <VariablesTab repoPath={repoPath} opts={opts} />}
      {tab === 'runners' && <RunnersTab repoPath={repoPath} opts={opts} />}
    </div>
  );
}

/* =================== Пайплайны =================== */

function PipelinesTab({ repoPath, opts, currentBranch, commitsBySha, initialPipelineId, onLocate, notify }) {
  const [onlyBranch, setOnlyBranch] = useState(false);
  const [list, setList] = useState({ loading: true, data: null, error: null });
  const [selected, setSelected] = useState(initialPipelineId ?? null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (initialPipelineId) setSelected(initialPipelineId);
  }, [initialPipelineId]);

  const load = useCallback(async () => {
    const res = await api.gitlab.pipelines(repoPath, { ...opts, ref: onlyBranch ? currentBranch : undefined });
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
  const canWrite = list.data?.canWrite ?? false;

  const createPipeline = async (ref) => {
    const res = await api.gitlab.action(repoPath, { type: 'pipeline.create', ref }, opts);
    if (!res.ok) {
      notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
      return;
    }
    notify?.({ type: 'success', title: `Пайплайн #${res.data.id} запущен`, hint: `Ветка ${ref}` });
    setSelected(res.data.id);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Список */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-gk-border">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-gk-border px-2 py-1.5">
          <div className="flex overflow-hidden rounded ring-1 ring-gk-border">
            <SegButton active={!onlyBranch} onClick={() => setOnlyBranch(false)}>
              Все
            </SegButton>
            <SegButton active={onlyBranch} onClick={() => setOnlyBranch(true)} disabled={!currentBranch} title={currentBranch}>
              <GitBranch size={11} /> <span className="max-w-[110px] truncate">{currentBranch ?? 'ветка'}</span>
            </SegButton>
          </div>
          <div className="flex-1" />
          <IconBtn title="Обновить" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw size={13} className={list.loading ? 'animate-spin' : ''} />
          </IconBtn>
          <RunPipelineButton disabled={!canWrite || !currentBranch} branch={currentBranch} onRun={createPipeline} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.error && !list.data && <ErrorNote error={list.error} />}
          {list.error && list.data && (
            <div className="border-b border-gk-border px-3 py-1.5 text-[11px] text-gk-yellow">Не удалось обновить: {list.error.message}</div>
          )}
          {list.loading && !list.data && <ListSkeleton />}
          {list.data && pipelines.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-gk-dim">
              {onlyBranch ? `В ветке ${currentBranch} пайплайнов ещё не было` : 'Пайплайнов ещё не было'}
            </div>
          )}
          {pipelines.map((p, i) => {
            const commit = commitsBySha?.get(p.sha);
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`flex w-full animate-fade-in items-start gap-2.5 border-b border-gk-border/50 px-3 py-2 text-left transition-colors ${
                  selected === p.id ? 'bg-gk-blue/12' : 'hover:bg-gk-hover/60'
                }`}
                style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
              >
                <StatusIcon status={p.status} size={17} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-gk-text">{commit?.message ?? p.name ?? p.sha.slice(0, 8)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gk-dim">
                    <span className="font-mono text-gk-muted">#{p.id}</span>
                    <span className="max-w-[120px] truncate rounded bg-white/5 px-1">{p.ref}</span>
                    <span className="truncate">{SOURCE_LABELS[p.source] ?? p.source}</span>
                    <span className="ml-auto shrink-0">{relativeTime(p.createdAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Детали */}
      <div className="relative flex min-w-0 flex-1">
        {selected ? (
          <PipelineDetail
            key={selected}
            repoPath={repoPath}
            opts={opts}
            pipelineId={selected}
            commitsBySha={commitsBySha}
            onLocate={onLocate}
            notify={notify}
            onChanged={() => load()}
            onOpenPipeline={setSelected}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-gk-dim">Выберите пайплайн слева</div>
        )}
      </div>
    </div>
  );
}

function RunPipelineButton({ disabled, branch, onRun }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return undefined;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (!confirm) setConfirm(true);
        else {
          setConfirm(false);
          onRun(branch);
        }
      }}
      title={disabled ? 'Нужен токен со scope «api» и активная ветка' : `Запустить новый пайплайн для ${branch}`}
      className={`flex h-7 items-center gap-1 rounded px-2 text-[12px] font-medium transition-colors disabled:opacity-35 ${
        confirm ? 'bg-gk-green text-gk-ink' : 'bg-gk-green/15 text-gk-green enabled:hover:bg-gk-green/25'
      }`}
    >
      <Play size={12} />
      {confirm ? `Запустить для ${branch}?` : 'Запустить'}
    </button>
  );
}

/* =================== Детали пайплайна =================== */

function PipelineDetail({ repoPath, opts, pipelineId, commitsBySha, onLocate, notify, onChanged, onOpenPipeline }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const res = await api.gitlab.pipeline(repoPath, pipelineId, opts);
    setState((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
  }, [repoPath, pipelineId, opts]);

  useEffect(() => {
    load();
  }, [load]);

  const p = state.data?.pipeline;
  const jobs = useMemo(() => state.data?.stages.flatMap((s) => s.jobs) ?? [], [state.data]);
  const active = p && (ACTIVE_STATUSES.has(p.status) || jobs.some((j) => ACTIVE_STATUSES.has(j.status)));
  usePolling(load, state.error ? 0 : active ? 4000 : 0, [load]);

  const act = async (action, label) => {
    setBusy(`${action.type}:${action.id}`);
    const res = await api.gitlab.action(repoPath, action, opts);
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

  if (state.loading && !state.data) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
        <Loader2 size={15} className="animate-spin" /> Загружаем пайплайн #{pipelineId}…
      </div>
    );
  }
  if (!state.data) return <ErrorNote error={state.error} />;

  const job = jobs.find((j) => j.id === jobId);
  const commit = commitsBySha?.get(p.sha);
  const canWrite = state.data.canWrite;
  const failedCount = jobs.filter((j) => j.status === 'failed' && !j.allowFailure).length;

  return (
    <>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4">
          {/* Шапка */}
          <div className="animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={p.status} big />
              <span className="font-mono text-[13px] text-gk-muted">#{p.id}</span>
              <div className="flex-1" />
              {canWrite && ['failed', 'canceled'].includes(p.status) && (
                <ActionButton
                  icon={RotateCcw}
                  busy={busy === `pipeline.retry:${p.id}`}
                  onClick={() => act({ type: 'pipeline.retry', id: p.id }, `Пайплайн #${p.id} перезапущен`)}
                >
                  {failedCount ? `Перезапустить упавшие (${failedCount})` : 'Перезапустить'}
                </ActionButton>
              )}
              {canWrite && ACTIVE_STATUSES.has(p.status) && (
                <ConfirmAction
                  icon={Square}
                  busy={busy === `pipeline.cancel:${p.id}`}
                  label="Отменить"
                  confirmLabel="Точно отменить?"
                  onConfirm={() => act({ type: 'pipeline.cancel', id: p.id }, `Пайплайн #${p.id} отменён`)}
                />
              )}
              <ActionButton icon={ExternalLink} onClick={() => api.openExternal(p.webUrl)}>
                В GitLab
              </ActionButton>
            </div>
            <div className="mt-2 text-[15px] font-medium text-white">{commit?.message ?? p.name ?? 'Пайплайн'}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gk-muted">
              <span className="flex items-center gap-1">
                <GitBranch size={12} /> {p.ref}
              </span>
              <button
                onClick={() => onLocate?.(p.sha)}
                disabled={!commit}
                title={commit ? 'Показать коммит в графе' : 'Коммита нет в загруженной истории'}
                className="flex items-center gap-1 font-mono text-gk-blue enabled:hover:underline disabled:text-gk-dim"
              >
                <GitCommitHorizontal size={12} /> {p.sha.slice(0, 8)}
              </button>
              {p.user && <span>запустил {p.user.name}</span>}
              <span>{SOURCE_LABELS[p.source] ?? p.source}</span>
              <span title={p.createdAt}>{relativeTime(p.createdAt)}</span>
              {p.duration != null && <span>⏱ {formatDuration(p.duration)}</span>}
              {p.queuedDuration != null && p.queuedDuration > 5 && <span>в очереди {formatDuration(p.queuedDuration)}</span>}
              {p.coverage != null && <span>покрытие {p.coverage}%</span>}
            </div>
          </div>

          {p.yamlErrors && (
            <div className="rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px] text-gk-text">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-gk-red">
                <AlertTriangle size={13} /> Ошибка в .gitlab-ci.yml
              </div>
              {p.yamlErrors}
            </div>
          )}
          {state.error && <div className="text-[11px] text-gk-yellow">Не удалось обновить: {state.error.message}</div>}

          {/* Этапы */}
          {state.data.stages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim">В пайплайне нет заданий</div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max gap-3">
                {state.data.stages.map((stage, si) => (
                  <div
                    key={stage.name}
                    className="w-56 shrink-0 animate-slide-up rounded-lg border border-gk-border bg-white/[0.02]"
                    style={{ animationDelay: `${si * 40}ms` }}
                  >
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
                          selected={jobId === j.id}
                          canWrite={canWrite}
                          busy={busy}
                          onOpen={() => (j.kind === 'bridge' ? j.downstream && api.openExternal(j.downstream.webUrl) : setJobId(j.id))}
                          onAction={(type, label) => act({ type, id: j.id }, label)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
          canWrite={canWrite}
          onClose={() => setJobId(null)}
          onAction={async (type, label) => {
            const r = await act({ type, id: job.id }, label);
            // Повтор создаёт новое задание — переключаемся на него
            if (r && type === 'job.retry' && r.id && r.id !== job.id) setJobId(r.id);
          }}
          onOpenPipeline={onOpenPipeline}
        />
      )}
    </>
  );
}

function JobRow({ job, selected, canWrite, busy, onOpen, onAction }) {
  const isBusy = (type) => busy === `${type}:${job.id}`;
  const actions = [];
  if (canWrite && job.kind === 'job') {
    if (job.status === 'manual') actions.push({ type: 'job.play', icon: Play, title: 'Запустить', label: `Задание ${job.name} запущено` });
    if (['failed', 'canceled', 'success'].includes(job.status))
      actions.push({ type: 'job.retry', icon: RotateCcw, title: 'Перезапустить', label: `Задание ${job.name} перезапущено` });
    if (ACTIVE_STATUSES.has(job.status)) actions.push({ type: 'job.cancel', icon: Square, title: 'Отменить', label: `Задание ${job.name} отменено` });
  }
  return (
    <div
      onClick={onOpen}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
        selected ? 'bg-gk-blue/15 ring-1 ring-gk-blue/40' : 'hover:bg-gk-hover'
      }`}
      title={job.kind === 'bridge' ? 'Запускает другой пайплайн — открыть в GitLab' : 'Открыть лог'}
    >
      <StatusIcon status={job.allowFailure && job.status === 'failed' ? 'warning' : job.status} size={15} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {job.kind === 'bridge' && <Zap size={11} className="shrink-0 text-[#c084fc]" />}
          <span className="truncate text-[12.5px] text-gk-text">{job.name}</span>
        </div>
        <div className="truncate text-[10.5px] text-gk-dim">
          {job.kind === 'bridge'
            ? job.downstream
              ? `→ пайплайн #${job.downstream.id} · ${statusInfo(job.downstream.status).label}`
              : statusInfo(job.status).label
            : job.duration != null
              ? formatDuration(job.duration)
              : statusInfo(job.status).label}
          {job.allowFailure && job.status === 'failed' && ' · можно упасть'}
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
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-gk-muted transition-opacity hover:bg-white/10 hover:text-gk-text ${
            a.type === 'job.play' || isBusy(a.type) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isBusy(a.type) ? <Loader2 size={12} className="animate-spin" /> : <a.icon size={12} />}
        </button>
      ))}
    </div>
  );
}

/* =================== Лог задания =================== */

function JobLog({ repoPath, opts, job: initialJob, canWrite, onClose, onAction }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [wrap, setWrap] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Map());
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    const res = await api.gitlab.jobLog(repoPath, initialJob.id, opts);
    setState((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
  }, [repoPath, initialJob.id, opts]);

  useEffect(() => {
    load();
  }, [load]);

  const job = state.data?.job ?? initialJob;
  const running = ACTIVE_STATUSES.has(job.status);
  usePolling(load, state.error ? 0 : running ? 3000 : 0, [load]);

  const tree = useMemo(() => (state.data ? parseLog(state.data.text) : null), [state.data]);

  // Esc — назад к пайплайну (а не закрыть весь просмотр CI/CD)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.fixed.inset-0')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Автопрокрутка к концу, пока пользователь сам не прокрутил вверх
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [tree]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const isCollapsed = (s) => (collapsed.has(s.key) ? collapsed.get(s.key) : s.collapsed);
  const toggle = (s) => setCollapsed((m) => new Map(m).set(s.key, !isCollapsed(s)));

  const copyLog = () => {
    const plain = (state.data?.text ?? '')
      .replace(/section_(start|end):\d+:[^\r\n]*?\r?\x1b\[0K/g, '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    navigator.clipboard?.writeText(plain);
  };

  return (
    <div className="absolute inset-0 z-10 flex animate-slide-in-right flex-col bg-[#0e1117] shadow-[-12px_0_30px_-12px_rgba(0,0,0,0.6)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-gk-border bg-[#151922] px-3 py-2">
        <IconBtn title="Назад к пайплайну (Esc)" onClick={onClose}>
          <ArrowLeft size={15} />
        </IconBtn>
        <StatusPill status={job.allowFailure && job.status === 'failed' ? 'warning' : job.status} />
        <span className="min-w-0 shrink truncate text-[13px] font-semibold text-white" title={job.name}>
          {job.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim">
          {job.stage}
          {job.duration != null && ` · ${formatDuration(job.duration)}`}
          {job.runner?.description && ` · ${job.runner.description}`}
        </span>
        {canWrite && job.status === 'manual' && (
          <ActionButton icon={Play} onClick={() => onAction('job.play', `Задание ${job.name} запущено`)}>
            Запустить
          </ActionButton>
        )}
        {canWrite && ['failed', 'canceled', 'success'].includes(job.status) && (
          <ActionButton icon={RotateCcw} onClick={() => onAction('job.retry', `Задание ${job.name} перезапущено`)}>
            Повторить
          </ActionButton>
        )}
        {canWrite && running && (
          <ActionButton icon={Square} onClick={() => onAction('job.cancel', `Задание ${job.name} отменено`)}>
            Отменить
          </ActionButton>
        )}
        <IconBtn title={wrap ? 'Не переносить строки' : 'Переносить строки'} onClick={() => setWrap((v) => !v)} active={wrap}>
          <WrapText size={14} />
        </IconBtn>
        <IconBtn title="Скопировать лог" onClick={copyLog}>
          <Copy size={14} />
        </IconBtn>
        <IconBtn
          title="В конец"
          onClick={() => {
            stickToBottom.current = true;
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ArrowDownToLine size={14} />
        </IconBtn>
        <IconBtn title="Открыть в GitLab" onClick={() => job.webUrl && api.openExternal(job.webUrl)}>
          <ExternalLink size={14} />
        </IconBtn>
      </div>

      {job.failureReason && job.status === 'failed' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-red/20 bg-gk-red/10 px-4 py-1.5 text-[12px] text-gk-red">
          <AlertTriangle size={13} /> Причина: {FAILURE_REASONS[job.failureReason] ?? job.failureReason}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-[#0b0d12] py-2 font-mono text-[12px] leading-[1.6] text-[#d7dae0]"
      >
        {state.loading && !state.data && (
          <div className="flex items-center gap-2 px-4 py-6 font-sans text-[13px] text-gk-muted">
            <Loader2 size={14} className="animate-spin" /> Загружаем лог…
          </div>
        )}
        {state.error && !state.data && <ErrorNote error={state.error} />}
        {state.data?.truncated && (
          <div className="px-4 pb-2 font-sans text-[11px] text-gk-dim">
            Лог большой ({Math.round(state.data.size / 1024)} КБ) — показан конец. Полностью — в GitLab.
          </div>
        )}
        {tree && tree.children.length === 0 && (
          <div className="px-4 py-6 font-sans text-[13px] text-gk-dim">
            {job.status === 'manual' || job.status === 'created' || job.status === 'skipped'
              ? 'Задание ещё не запускалось — лога нет'
              : running
                ? 'Ждём вывод раннера…'
                : 'Лог пуст'}
          </div>
        )}
        {tree && <LogNodes nodes={tree.children} wrap={wrap} isCollapsed={isCollapsed} toggle={toggle} />}
        {running && tree?.children.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-1 font-sans text-[11px] text-gk-blue">
            <Loader2 size={11} className="animate-spin" /> выполняется…
          </div>
        )}
      </div>
    </div>
  );
}

function LogNodes({ nodes, wrap, isCollapsed, toggle }) {
  return nodes.map((node, i) =>
    node.type === 'line' ? (
      <LogLine key={`l${node.n}-${i}`} n={node.n} segs={node.segs} wrap={wrap} />
    ) : (
      <div key={`s${node.key}`}>
        <div onClick={() => toggle(node)} className="group flex cursor-pointer hover:bg-white/[0.04]">
          <span className="w-12 shrink-0 select-none pr-3 text-right text-[#4b5263]">{node.n || ''}</span>
          <span className="flex w-4 shrink-0 items-center text-gk-dim group-hover:text-gk-text">
            {isCollapsed(node) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
          <span className={`min-w-0 flex-1 pr-4 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
            <Segs segs={node.title} />
          </span>
          {node.duration != null && (
            <span className="shrink-0 pr-4 font-sans text-[10.5px] text-gk-dim">{formatDuration(node.duration)}</span>
          )}
        </div>
        {!isCollapsed(node) && <LogNodes nodes={node.children} wrap={wrap} isCollapsed={isCollapsed} toggle={toggle} />}
      </div>
    ),
  );
}

function LogLine({ n, segs, wrap }) {
  return (
    <div className="flex hover:bg-white/[0.03]">
      <span className="w-12 shrink-0 select-none pr-3 text-right text-[#4b5263]">{n}</span>
      <span className="w-4 shrink-0" />
      <span className={`min-w-0 flex-1 pr-4 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
        {segs.length ? <Segs segs={segs} /> : ' '}
      </span>
    </div>
  );
}

function Segs({ segs }) {
  return segs.map((s, i) =>
    s.fg || s.bold || s.italic || s.underline || s.dim ? (
      <span
        key={i}
        style={{
          color: s.fg ?? undefined,
          fontWeight: s.bold ? 700 : undefined,
          fontStyle: s.italic ? 'italic' : undefined,
          textDecoration: s.underline ? 'underline' : undefined,
          opacity: s.dim ? 0.6 : undefined,
        }}
      >
        {s.text}
      </span>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}

/* =================== Переменные =================== */

function VariablesTab({ repoPath, opts }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [revealed, setRevealed] = useState({}); // key|scope -> { value, hidden } | 'loading'

  useEffect(() => {
    api.gitlab.variables(repoPath, opts).then((res) =>
      setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error }),
    );
  }, [repoPath, opts]);

  const reveal = async (v) => {
    const id = `${v.key}|${v.scope}`;
    if (revealed[id] && revealed[id] !== 'loading') {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealed((r) => ({ ...r, [id]: 'loading' }));
    const res = await api.gitlab.variableValue(repoPath, { key: v.key, scope: v.scope }, opts);
    setRevealed((r) => ({ ...r, [id]: res.ok ? res.data : { error: res.error.message } }));
  };

  if (state.loading) return <Loading text="Загружаем переменные…" />;
  if (state.error) {
    return (
      <ErrorNote
        error={
          state.error.code === 'FORBIDDEN'
            ? { ...state.error, message: 'Переменные CI/CD видят только Maintainer и Owner проекта', hint: state.error.hint }
            : state.error
        }
      />
    );
  }
  const vars = state.data.variables;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-3 text-[12px] leading-relaxed text-gk-dim">
        Переменные из настроек проекта (Settings → CI/CD → Variables). Только просмотр. Значение запрашивается у GitLab, только когда
        вы нажимаете на глаз, и нигде не сохраняется.
      </p>
      {vars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim">В проекте нет переменных</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gk-border">
          <div className="grid grid-cols-[minmax(160px,1.2fr)_minmax(200px,2fr)_110px_minmax(140px,1fr)] gap-3 border-b border-gk-border bg-white/[0.03] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim">
            <span>Имя</span>
            <span>Значение</span>
            <span>Окружение</span>
            <span>Флаги</span>
          </div>
          {vars.map((v, i) => {
            const id = `${v.key}|${v.scope}`;
            const r = revealed[id];
            return (
              <div
                key={id}
                className="grid animate-fade-in grid-cols-[minmax(160px,1.2fr)_minmax(200px,2fr)_110px_minmax(140px,1fr)] items-center gap-3 border-b border-gk-border/60 px-3 py-2 text-[12px] last:border-0"
                style={{ animationDelay: `${Math.min(i, 20) * 15}ms` }}
                title={v.description ?? undefined}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {v.type === 'file' ? <FileText size={12} className="shrink-0 text-gk-dim" /> : <Variable size={12} className="shrink-0 text-gk-dim" />}
                  <span className="truncate font-mono text-gk-blue">{v.key}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {v.hidden ? (
                    <span className="italic text-gk-dim">скрыто в GitLab — значение не выдаётся</span>
                  ) : r && r !== 'loading' ? (
                    r.error ? (
                      <span className="text-gk-red">{r.error}</span>
                    ) : r.hidden ? (
                      <span className="italic text-gk-dim">скрыто в GitLab</span>
                    ) : (
                      <span className="min-w-0 flex-1 break-all font-mono text-gk-text">{r.value === '' ? <i className="text-gk-dim">пусто</i> : r.value}</span>
                    )
                  ) : (
                    <span className="flex-1 font-mono tracking-widest text-gk-dim">{v.empty ? '—' : '••••••••'}</span>
                  )}
                  {!v.hidden && !v.empty && (
                    <button
                      onClick={() => reveal(v)}
                      title={r && r !== 'loading' ? 'Скрыть' : 'Показать значение'}
                      className="shrink-0 rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text"
                    >
                      {r === 'loading' ? <Loader2 size={12} className="animate-spin" /> : r ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                  {r && r !== 'loading' && !r.error && !r.hidden && (
                    <button onClick={() => navigator.clipboard?.writeText(r.value)} title="Скопировать" className="shrink-0 rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
                      <Copy size={12} />
                    </button>
                  )}
                </span>
                <span className="truncate font-mono text-[11px] text-gk-muted">{v.scope}</span>
                <span className="flex flex-wrap gap-1">
                  {v.protected && <Flag icon={Lock} title="Только для защищённых веток и тегов">protected</Flag>}
                  {v.masked && <Flag title="Скрывается в логах заданий">masked</Flag>}
                  {v.hidden && <Flag title="Значение нельзя посмотреть после сохранения">hidden</Flag>}
                  {v.raw && <Flag title="Без подстановки $ПЕРЕМЕННЫХ">raw</Flag>}
                  {v.type === 'file' && <Flag title="Передаётся в задание как путь к файлу">file</Flag>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Flag({ children, title, icon: Icon }) {
  return (
    <span title={title} className="flex items-center gap-0.5 rounded bg-white/5 px-1.5 text-[10px] text-gk-muted">
      {Icon && <Icon size={9} />}
      {children}
    </span>
  );
}

/* =================== Раннеры =================== */

const RUNNER_STATUS = {
  online: { label: 'онлайн', cls: 'bg-gk-green' },
  offline: { label: 'офлайн', cls: 'bg-gk-red' },
  stale: { label: 'давно не выходил на связь', cls: 'bg-gk-yellow' },
  never_contacted: { label: 'ни разу не подключался', cls: 'bg-gk-dim' },
};
const RUNNER_TYPES = { instance_type: 'общий (instance)', group_type: 'группы', project_type: 'проекта' };

function RunnersTab({ repoPath, opts }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    api.gitlab.runners(repoPath, opts).then((res) =>
      setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error }),
    );
  }, [repoPath, opts]);

  if (state.loading) return <Loading text="Загружаем раннеры…" />;
  if (state.error) return <ErrorNote error={state.error} />;
  const runners = state.data.runners;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-3 text-[12px] text-gk-dim">Раннеры, которые могут выполнять задания этого проекта.</p>
      {runners.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim">
          Нет доступных раннеров — задания будут ждать в очереди
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
          {runners.map((r, i) => {
            const st = RUNNER_STATUS[r.status] ?? { label: r.status, cls: 'bg-gk-dim' };
            return (
              <div
                key={r.id}
                className="animate-slide-up rounded-lg border border-gk-border bg-white/[0.02] px-3 py-2.5"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${st.cls} ${r.status === 'online' ? 'shadow-[0_0_8px] shadow-gk-green/60' : ''}`} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gk-text">{r.description}</span>
                  <span className="font-mono text-[10px] text-gk-dim">#{r.id}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gk-muted">
                  <span>{st.label}</span>
                  {r.type && <span>· {RUNNER_TYPES[r.type] ?? r.type}</span>}
                  {r.paused && <span className="text-gk-yellow">· на паузе</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =================== Мелочи =================== */

function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="m-4 rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2.5 text-[12px]">
      <div className="flex items-center gap-1.5 font-medium text-gk-text">
        <AlertTriangle size={13} className="shrink-0 text-gk-red" /> {error.message}
      </div>
      {error.hint && <div className="mt-1 pl-5 text-gk-muted">{error.hint}</div>}
    </div>
  );
}

function Loading({ text }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
      <Loader2 size={14} className="animate-spin" /> {text}
    </div>
  );
}

function ListSkeleton() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex gap-2.5 border-b border-gk-border/50 px-3 py-2.5">
      <span className="h-4 w-4 animate-pulse rounded-full bg-white/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  ));
}

function SegButton({ active, children, ...props }) {
  return (
    <button
      {...props}
      className={`flex items-center gap-1 px-2 py-1 text-[11.5px] transition-colors disabled:opacity-40 ${
        active ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({ icon: Icon, busy, children, ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className="flex h-7 items-center gap-1.5 rounded-md bg-gk-hover px-2.5 text-[12px] text-gk-text transition-colors hover:bg-[#343a47] disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {children}
    </button>
  );
}

function ConfirmAction({ icon, busy, label, confirmLabel, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <ActionButton
      icon={icon}
      busy={busy}
      onClick={() => {
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      <span className={armed ? 'text-gk-red' : ''}>{armed ? confirmLabel : label}</span>
    </ActionButton>
  );
}

function IconBtn({ children, active, ...props }) {
  return (
    <button
      {...props}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        active ? 'bg-gk-blue/15 text-gk-blue' : 'text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}
