// Раннеры: парк (собственные и облачные), статусы в реальном времени, редактор (метки, пауза, настройки),
// очистка неактивных, мастер подключения нового раннера и локальный Docker-раннер в один клик.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Apple,
  Check,
  ClipboardPaste,
  Cloud,
  Container,
  Copy,
  Cpu,
  Eraser,
  KeyRound,
  Loader2,
  Monitor,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { relativeTime } from '../../lib/format.ts';
import { Button, ErrorBox, Modal } from '../Dialogs.tsx';
import { ActionButton, ChipsInput, ConfirmAction, ErrorNote, IconBtn, Loading, SegButton, Toggle, usePolling } from './common.tsx';
import { t, tj, locale } from '../../i18n/index.ts';
import type { ApiError, ApiResult } from '../../platform/tauri.ts';
import type {
  Capabilities_Serialize,
  CiRunner_Serialize,
  DockerStatus_Serialize,
  LocalRunnerName,
  LocalRunnerStarted,
  LocalRunner_Serialize,
  LocalRunners_Serialize,
  PruneResult_Serialize,
  RemoteOptions_Deserialize,
  RunnerJob_Serialize,
  RunnerRegistration_Serialize,
  RunnersWithCaps_Serialize,
} from '../../../crates/gorynych-tauri/bindings/commands.ts';

type Runner = CiRunner_Serialize;
type Caps = Capabilities_Serialize;
type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode }) => void;
type LocalAction = (name: string) => Promise<ApiResult<LocalRunnerName>>;

interface RunnersApi {
  cicd: {
    runners: (dir: string, opts: unknown) => Promise<ApiResult<RunnersWithCaps_Serialize>>;
    localRunners: (dir: string, opts: unknown) => Promise<ApiResult<LocalRunners_Serialize>>;
    pruneRunners: (dir: string, data: { ids: unknown[] }, opts: unknown) => Promise<ApiResult<PruneResult_Serialize>>;
    updateRunner: (dir: string, data: { id: unknown; patch: Record<string, unknown> }, opts: unknown) => Promise<ApiResult<unknown>>;
    deleteRunner: (dir: string, data: { id: unknown }, opts: unknown) => Promise<ApiResult<unknown>>;
    registerRunner: (dir: string, data: { labels: string[]; name?: string; runUntagged: boolean }, opts: unknown) => Promise<ApiResult<RunnerRegistration_Serialize>>;
    startLocalRunner: (dir: string, data: { labels: string[] }, opts: unknown) => Promise<ApiResult<LocalRunnerStarted>>;
    resumeLocalRunner: LocalAction;
    stopLocalRunner: LocalAction;
  };
}

const api = window.api as unknown as RunnersApi;

interface RunnersProps {
  repoPath: string;
  opts: RemoteOptions_Deserialize | null | undefined;
  caps?: Caps | null;
  provider: string;
  providerLabel: ReactNode;
  notify?: Notify;
  onOpenJob?: (job: RunnerJob_Serialize) => void;
  onInsertTags?: (runner: Runner) => void;
  canInsert?: boolean;
}

export const RUNNER_STATUS: Record<string, { label: string; ru: string; dot: string; text: string }> = {
  online: { label: 'Online', ru: t('idle'), dot: 'bg-gk-green shadow-[0_0_8px] shadow-gk-green/60', text: 'text-gk-green' },
  busy: { label: 'Busy', ru: t('busy'), dot: 'bg-gk-blue shadow-[0_0_8px] shadow-gk-blue/60 animate-pulse', text: 'text-gk-blue' },
  offline: { label: 'Offline', ru: t('offline'), dot: 'bg-gk-red', text: 'text-gk-red' },
  paused: { label: 'Paused', ru: t('paused'), dot: 'bg-gk-yellow', text: 'text-gk-yellow' },
};

/** Значок Windows — четыре окна (в наборе иконок брендов нет) */
function WindowsIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1 2.6l5.7-.8v5.5H1zM7.5 1.7L15 .7v6.6H7.5zM1 8.2h5.7v5.5L1 12.9zM7.5 8.2H15v6.6l-7.5-1z" />
    </svg>
  );
}

export function OsIcon({ os, size = 13 }: { os: string | null | undefined; size?: number }) {
  if (os === 'windows') return <WindowsIcon size={size} />;
  if (os === 'macos') return <Apple size={size} />;
  if (os === 'docker') return <Container size={size} />;
  if (os === 'linux') return <Terminal size={size} />;
  return <Monitor size={size} />;
}
const OS_NAMES: Record<string, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows', docker: 'Docker' };

const isOwn = (r: Runner) => !r.isShared && !r.virtual;

export default function Runners({ repoPath, opts, caps, provider, providerLabel, notify, onOpenJob, onInsertTags, canInsert }: RunnersProps) {
  const [state, setState] = useState<{ loading: boolean; data: RunnersWithCaps_Serialize | null; error: ApiError | null }>({ loading: true, data: null, error: null });
  const [filter, setFilter] = useState<'own' | 'shared' | 'all'>('own');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Runner | null>(null);
  const [wizard, setWizard] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [local, setLocal] = useState<LocalRunners_Serialize | null>(null);

  const load = useCallback(async () => {
    const res = await api.cicd.runners(repoPath, opts);
    setState((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
    return res;
  }, [repoPath, opts]);
  const loadLocal = useCallback(async () => {
    if (!caps?.localRunner) return;
    const res = await api.cicd.localRunners(repoPath, opts);
    if (res.ok) setLocal(res.data);
  }, [repoPath, opts, caps?.localRunner]);
  useEffect(() => {
    load();
    loadLocal();
  }, [load, loadLocal]);
  // Статусы в реальном времени: опрос раз в 10 с (пока вкладка открыта)
  usePolling(load, state.error && !state.data ? 0 : 10000, [load]);

  const runners = state.data?.runners ?? [];
  const live = (caps ?? state.data?.capabilities ?? {}) as Caps;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runners
      .filter((r) => (filter === 'own' ? isOwn(r) : filter === 'shared' ? !isOwn(r) : true))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.labels.some((l) => l.toLowerCase().includes(q)) || (r.description ?? '').toLowerCase().includes(q));
  }, [runners, filter, query]);
  const counts = { own: runners.filter(isOwn).length, shared: runners.filter((r) => !isOwn(r)).length };
  const dead = runners.filter((r) => r.status === 'offline' && isOwn(r) && r.editable);

  const prune = async () => {
    setPruning(true);
    const res = await api.cicd.pruneRunners(repoPath, { ids: dead.map((r) => r.id) }, opts);
    setPruning(false);
    if (!res.ok) return notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    const { removed, failed } = res.data;
    notify?.({
      type: failed.length ? 'info' : 'success',
      title: t('inactive-runners-deleted', removed.length),
      hint: failed.length ? t('failed-2', failed.map((f) => `${f.name} (${f.error})`).join(', ')) : removed.map((r) => r.name).join(', '),
    });
    load();
  };

  if (state.loading && !state.data) return <Loading text={t('loading-runners')} />;
  if (state.error && !state.data) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ErrorNote error={state.error} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="runners">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gk-border px-3 py-2">
        <div className="flex overflow-hidden rounded ring-1 ring-gk-border" data-testid="runner-filter">
          <SegButton active={filter === 'own'} onClick={() => setFilter('own')} data-filter="own">
            {tj('self-hosted', [<Server size={11} />, <span className="text-gk-dim" />, counts.own])}
          </SegButton>
          <SegButton active={filter === 'shared'} onClick={() => setFilter('shared')} data-filter="shared">
            {tj('cloud', [<Cloud size={11} />, <span className="text-gk-dim" />, counts.shared])}
          </SegButton>
          <SegButton active={filter === 'all'} onClick={() => setFilter('all')} data-filter="all">
            {t('all-2')}</SegButton>
        </div>
        <label className="flex min-w-40 flex-1 items-center gap-1.5 rounded-md bg-gk-bg px-2 py-1 ring-1 ring-gk-border focus-within:ring-gk-blue">
          <Search size={12} className="text-gk-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('name-or-tag')} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-gk-dim" />
        </label>
        <IconBtn title={t('refresh')} onClick={() => load()}>
          <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} />
        </IconBtn>
        <ConfirmAction
          icon={Eraser}
          busy={pruning}
          testid="runners-prune"
          label={t('clean-up-inactive', dead.length ? ` (${dead.length})` : '')}
          confirmLabel={t('delete-offline', dead.length)}
          why={!live.canDeleteRunner ? live.why?.canDeleteRunner ?? t('no-permission') : !dead.length ? t('no-offline-self-hosted-runners') : null}
          onConfirm={prune}
        />
        <ActionButton icon={Plus} tone="green" why={live.canCreateRunnerToken ? null : live.why?.canCreateRunnerToken ?? t('no-permission')} onClick={() => setWizard(true)} data-testid="runner-add">
          {t('connect-runner')}</ActionButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.error && <div className="mb-2 text-[11px] text-gk-yellow">{tj('couldnt-refresh', [state.error.message])}</div>}
        {local?.runners?.length! > 0 && <LocalRunners list={local!.runners} onChanged={loadLocal} notify={notify} />}
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim" data-testid="runners-empty">
            {runners.length === 0
              ? t('no-runners-available-jobs-will')
              : filter === 'own'
                ? t('no-self-hosted-runners-jobs')
                : t('nothing-found')}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2">
            {shown.map((r, i) => (
              <RunnerCard
                key={r.id}
                runner={r}
                index={i}
                onOpen={() => setEditing(r)}
                onOpenJob={onOpenJob}
                onInsert={canInsert && r.labels.length ? () => onInsertTags!(r) : null}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <RunnerEditor
          runner={runners.find((r) => r.id === editing.id) ?? editing}
          caps={live}
          provider={provider}
          suggestions={[...new Set(runners.flatMap((r) => r.labels))]}
          repoPath={repoPath}
          opts={opts}
          notify={notify}
          onClose={() => setEditing(null)}
          onChanged={load}
        />
      )}
      {wizard && (
        <RegisterWizard
          repoPath={repoPath}
          opts={opts}
          caps={live}
          provider={provider}
          providerLabel={providerLabel}
          suggestions={[...new Set(runners.flatMap((r) => r.labels))]}
          notify={notify}
          onClose={() => setWizard(false)}
          onLocalStarted={() => {
            loadLocal();
            setTimeout(load, 4000);
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ runner, onOpenJob }: { runner: Runner; onOpenJob?: RunnersProps['onOpenJob'] }) {
  const st = RUNNER_STATUS[runner.status] ?? RUNNER_STATUS.offline;
  return (
    <span className={`flex items-center gap-1.5 text-[11.5px] ${st.text}`} data-testid="runner-status" data-status={runner.status}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
      {st.label}
      <span className="text-gk-muted">
        ({st.ru}
        {runner.status === 'busy' && runner.currentJob ? ' — ' : ''}
      </span>
      {runner.status === 'busy' && runner.currentJob ? (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenJob?.(runner.currentJob!);
            }}
            data-testid="runner-job"
            className="max-w-[140px] truncate text-gk-blue hover:underline"
            data-tip={t('open-job')}
          >
            {runner.currentJob.name ?? `#${runner.currentJob.id}`}
          </button>
        </>
      ) : null}
      <span className="-ml-1.5 text-gk-muted">)</span>
    </span>
  );
}

function RunnerCard({ runner: r, index, onOpen, onOpenJob, onInsert }: { runner: Runner; index: number; onOpen: () => void; onOpenJob?: RunnersProps['onOpenJob']; onInsert?: (() => void) | null }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      data-testid="runner-card"
      data-id={r.id}
      className="group animate-slide-up cursor-pointer rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2.5 transition-colors hover:border-gk-blue/40 hover:bg-gk-fg/[0.04]"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gk-fg/5 text-gk-muted" data-tip={OS_NAMES[r.os!] ?? t('unknown-os')}>
          <OsIcon os={r.os} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gk-text" title={r.description ?? r.name}>
          {r.name}
        </span>
        {r.virtual && <span className="rounded bg-gk-purple/15 px-1.5 text-[10px] text-gk-purple">{t('cloud-2')}</span>}
        {r.isShared && !r.virtual && <span className="rounded bg-gk-fg/5 px-1.5 text-[10px] text-gk-dim">{t('shared')}</span>}
        <span className="font-mono text-[10px] text-gk-dim">{r.virtual ? '' : `#${r.id}`}</span>
      </div>
      <div className="mt-1.5">
        <StatusBadge runner={r} onOpenJob={onOpenJob} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gk-dim">
        {r.os && <span>{OS_NAMES[r.os] ?? r.os}</span>}
        {r.architecture && (
          <span className="flex items-center gap-0.5">
            <Cpu size={10} /> {r.architecture}
          </span>
        )}
        {r.version && <span>v{r.version}</span>}
        {r.ipAddress && <span className="font-mono">{r.ipAddress}</span>}
        {r.contactedAt && r.status === 'offline' && <span>{tj('last-online', [relativeTime(r.contactedAt)])}</span>}
      </div>
      {r.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" data-testid="runner-labels">
          {r.labels.map((l) => (
            <span key={l} className={`rounded px-1.5 py-px font-mono text-[10.5px] ${r.readOnlyLabels?.includes(l) ? 'bg-gk-fg/5 text-gk-dim' : 'bg-gk-blue/12 text-gk-blue'}`}>
              {l}
            </span>
          ))}
        </div>
      )}
      {onInsert && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsert();
          }}
          data-testid="runner-insert"
          className="mt-2 flex items-center gap-1 text-[11px] text-gk-muted opacity-0 transition-opacity hover:text-gk-blue group-hover:opacity-100"
        >
          {tj('insert-into-config', [<ClipboardPaste size={11} />])}</button>
      )}
    </div>
  );
}

/* =================== Редактор раннера =================== */

function RunnerEditor({ runner, caps, provider, suggestions, repoPath, opts, notify, onClose, onChanged }: { runner: Runner; caps: Caps; provider: string; suggestions: string[]; repoPath: string; opts: RunnersProps['opts']; notify?: Notify; onClose: () => void; onChanged: () => void }) {
  const [labels, setLabels] = useState(runner.labels);
  const [paused, setPaused] = useState(runner.status === 'paused');
  const [untagged, setUntagged] = useState(Boolean(runner.runUntagged));
  const [locked, setLocked] = useState(Boolean(runner.locked));
  const [description, setDescription] = useState(runner.description ?? runner.name ?? '');
  const [timeout, setTimeoutMin] = useState(runner.maximumTimeout ? String(Math.round(runner.maximumTimeout / 60)) : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const readOnly = !runner.editable;
  const settingsWhy = readOnly ? t('shared-runner-is-changed-by') : caps.canEditRunnerSettings ? null : caps.why?.canEditRunnerSettings ?? t('unavailable-2');
  const labelsWhy = readOnly ? t('shared-runner-is-changed-by') : caps.canEditRunnerLabels ? null : caps.why?.canEditRunnerLabels ?? t('unavailable-2');
  const pauseWhy = readOnly ? t('shared-runner-is-changed-by') : caps.canPauseRunner ? null : caps.why?.canPauseRunner ?? t('unavailable-2');

  const patch: Record<string, unknown> = {};
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!labelsWhy && !same(labels, runner.labels)) patch.labels = labels;
  if (!pauseWhy && paused !== (runner.status === 'paused')) patch.paused = paused;
  if (!settingsWhy) {
    if (untagged !== Boolean(runner.runUntagged)) patch.runUntagged = untagged;
    if (locked !== Boolean(runner.locked)) patch.locked = locked;
    if (description !== (runner.description ?? runner.name ?? '')) patch.description = description;
    const sec = timeout.trim() ? Math.round(Number(timeout) * 60) : null;
    if (sec !== (runner.maximumTimeout ?? null)) patch.maximumTimeout = sec;
  }
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    setBusy('save');
    setError(null);
    const res = await api.cicd.updateRunner(repoPath, { id: runner.id, patch }, opts);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    notify?.({ type: 'success', title: t('runner-saved', runner.name) });
    onChanged();
    onClose();
  };
  const remove = async () => {
    setBusy('delete');
    const res = await api.cicd.deleteRunner(repoPath, { id: runner.id }, opts);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    notify?.({ type: 'success', title: t('runner-deleted', runner.name) });
    onChanged();
    onClose();
  };

  return (
    <Modal
      title={t('runner', runner.name)}
      icon={Server}
      onClose={onClose}
      width={520}
      footer={
        <>
          {!runner.virtual && (
            <div className="mr-auto">
              <ConfirmAction
                icon={Trash2}
                busy={busy === 'delete'}
                label={t('delete-2')}
                confirmLabel={t('delete-runner-for-sure')}
                testid="runner-delete"
                why={readOnly ? t('shared-runner-is-deleted-by') : caps.canDeleteRunner ? null : caps.why?.canDeleteRunner ?? t('no-permission')}
                onConfirm={remove}
              />
            </div>
          )}
          <Button onClick={onClose}>{t('close')}</Button>
          <Button variant="primary" disabled={(!dirty || busy) as boolean} onClick={save} data-testid="runner-save">
            {tj('save-2', [busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />])}</Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="runner-editor">
        <div className="flex items-center gap-2">
          <StatusBadge runner={runner} />
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-gk-dim">
            <OsIcon os={runner.os} size={12} /> {OS_NAMES[runner.os!] ?? '—'} {runner.architecture ?? ''} {runner.version ? `· v${runner.version}` : ''}
          </span>
        </div>
        {runner.virtual && <p className="text-[12px] text-gk-dim">{t('providers-cloud-runner-managed-by')}</p>}
        {!runner.virtual && readOnly && <p className="text-[12px] text-gk-yellow">{t('servers-shared-runner-only-admin')}</p>}

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[12px] text-gk-muted">
            {tj('tags-labels', [provider === 'github' && <span className="text-gk-dim">{t('gray-ones-are-system-labels')}</span>])}
          </div>
          <div data-tip={labelsWhy || undefined}>
            <ChipsInput value={labels} onChange={setLabels} suggestions={[...suggestions, 'docker', 'linux', 'prod', 'gpu']} locked={runner.readOnlyLabels ?? []} disabled={Boolean(labelsWhy)} testid="runner-labels-input" />
          </div>
          {labelsWhy && <p className="mt-1 text-[11.5px] text-gk-dim">{labelsWhy}</p>}
        </div>

        <Toggle
          checked={!paused}
          onChange={(v) => setPaused(!v)}
          label={paused ? t('paused-2') : t('active')}
          hint={t('paused-runner-doesnt-take-new')}
          why={pauseWhy}
          testid="runner-active"
        />
        <Toggle checked={untagged} onChange={setUntagged} label={t('run-untagged-jobs')} why={settingsWhy} testid="runner-untagged" />
        <Toggle checked={locked} onChange={setLocked} label={t('locked-to-current-project')} why={settingsWhy} testid="runner-locked" />
        <label className="block" data-tip={settingsWhy || undefined}>
          {tj('description-2', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={Boolean(settingsWhy)}
            data-testid="runner-description"
            className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue disabled:opacity-50"
          />])}
        </label>
        <label className="block" data-tip={settingsWhy || undefined}>
          {tj('maximum-job-timeout-minutes', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
            type="number"
            min="10"
            value={timeout}
            onChange={(e) => setTimeoutMin(e.target.value)}
            disabled={Boolean(settingsWhy)}
            placeholder={t('as-in-project')}
            data-testid="runner-timeout"
            className="w-40 rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue disabled:opacity-50"
          />])}
        </label>
        {settingsWhy && !readOnly && <p className="text-[11.5px] text-gk-dim">{settingsWhy}</p>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/* =================== Подключение нового раннера =================== */

function CodeBlock({ text, testid }: { text: string; testid?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative" data-testid={testid}>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--gk-log-bg)] p-3 pr-10 font-mono text-[11.5px] leading-relaxed text-[#d7dae0]">{text}</pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={t('copy-3')}
        data-testid={`${testid}-copy`}
        className="absolute right-2 top-2 rounded bg-white/10 p-1.5 text-white/70 hover:bg-white/20 hover:text-white"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function RegisterWizard({ repoPath, opts, caps, provider, providerLabel, suggestions, notify, onClose, onLocalStarted }: { repoPath: string; opts: RunnersProps['opts']; caps: Caps; provider: string; providerLabel: ReactNode; suggestions: string[]; notify?: Notify; onClose: () => void; onLocalStarted: () => void }) {
  const [labels, setLabels] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [untagged, setUntagged] = useState(false);
  const [reg, setReg] = useState<RunnerRegistration_Serialize | null>(null);
  const [tab, setTab] = useState('docker');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [docker, setDocker] = useState<DockerStatus_Serialize | null>(null);

  useEffect(() => {
    if (caps.localRunner) api.cicd.localRunners(repoPath, opts).then((res) => res.ok && setDocker(res.data.docker));
  }, [repoPath, opts, caps.localRunner]);

  const getToken = async () => {
    setBusy('token');
    setError(null);
    const res = await api.cicd.registerRunner(repoPath, { labels, name: name.trim() || undefined, runUntagged: untagged }, opts);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setReg(res.data);
  };
  const startLocal = async () => {
    setBusy('local');
    setError(null);
    const res = await api.cicd.startLocalRunner(repoPath, { labels }, opts);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    notify?.({ type: 'success', title: t('local-runner-started-in-docker', res.data.name), hint: t('in-few-seconds-it-will') });
    onLocalStarted();
    onClose();
  };

  const command = reg?.commands?.find((c) => c.id === tab) ?? reg?.commands?.[0];
  return (
    <Modal title={t('connect-runner-2', providerLabel)} icon={Plug} iconClass="text-gk-green" onClose={onClose} width={640} footer={<Button onClick={onClose}>{t('done')}</Button>}>
      <div className="space-y-3" data-testid="runner-wizard">
        <div>
          <div className="mb-1 text-[12px] text-gk-muted">{t('new-runners-tags')}</div>
          <ChipsInput value={labels} onChange={setLabels} suggestions={[...suggestions, 'docker', 'linux', 'prod', 'gpu', 'windows', 'macos']} placeholder="docker, prod, gpu…" testid="wizard-labels" />
        </div>
        <label className="block">
          {tj('name-optional', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input value={name} onChange={(e) => setName(e.target.value)} placeholder="build-server-1" className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue" />])}
        </label>
        {provider === 'gitlab' && <Toggle checked={untagged || !labels.length} onChange={setUntagged} label={t('run-untagged-jobs-2')} hint={t('without-tags-runner-picks-up')} />}

        {!reg ? (
          <ActionButton icon={KeyRound} tone="blue" busy={busy === 'token'} onClick={getToken} data-testid="wizard-token">
            {t('get-token-and-commands')}</ActionButton>
        ) : (
          <div className="space-y-2" data-testid="wizard-result">
            <div className="flex items-center gap-2 rounded-md border border-gk-green/30 bg-gk-green/[0.06] px-3 py-2 text-[12px]">
              <KeyRound size={13} className="text-gk-green" />
              <span className="text-gk-muted">{reg.kind === 'auth' ? t('runner-token') : t('registration-token')}:</span>
              <code className="min-w-0 flex-1 truncate font-mono text-gk-text" data-testid="wizard-token-value">
                {reg.token}
              </code>
              {reg.expiresAt && <span className="shrink-0 text-gk-dim">{tj('valid-until', [new Date(reg.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })])}</span>}
            </div>
            <div className="flex overflow-hidden rounded ring-1 ring-gk-border" data-testid="wizard-tabs">
              {reg.commands.map((c) => (
                <SegButton key={c.id} active={(command?.id ?? '') === c.id} onClick={() => setTab(c.id)}>
                  {c.id === 'docker' ? <Container size={11} /> : <OsIcon os={c.id} size={11} />} {c.label}
                </SegButton>
              ))}
            </div>
            {command && <CodeBlock text={command.text} testid="wizard-command" />}
            <p className="text-[11.5px] text-gk-dim">
              {tj('token-is-shown-once-dont', [command?.shell === 'powershell' ? t('run-in-powershell-as-administrator') : t('run-in-terminal-of-server')])}</p>
          </div>
        )}

        {caps.localRunner && (
          <div className="rounded-lg border border-gk-border p-3" data-testid="wizard-local">
            <div className="flex items-center gap-2">
              {tj('local-runner-in-docker-on', [<Container size={15} className="text-[#2496ed]" />, <span className="flex-1 text-[12.5px] font-medium text-gk-text" />, docker === null ? (
                <Loader2 size={12} className="animate-spin text-gk-dim" />
              ) : docker.available ? (
                <span className="text-[11px] text-gk-green" data-testid="docker-state">
                  Docker {docker.version}
                </span>
              ) : (
                <span className="text-[11px] text-gk-yellow" data-testid="docker-state">
                  {docker.reason}
                </span>
              )])}
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-gk-dim">
              {tj('starts-runner-container-with-these', [providerLabel])}</p>
            <ActionButton
              className="mt-2"
              icon={Play}
              tone="green"
              busy={busy === 'local'}
              why={docker && !docker.available ? docker.hint ?? docker.reason : null}
              disabled={!docker}
              onClick={startLocal}
              data-testid="wizard-local-start"
            >
              {t('run-locally')}</ActionButton>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/* =================== Локальные контейнеры =================== */

function LocalRunners({ list, onChanged, notify }: { list: LocalRunner_Serialize[]; onChanged: () => void; notify?: Notify }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (fn: LocalAction, name: string, label: string) => {
    setBusy(name);
    const res = await fn(name);
    setBusy(null);
    if (!res.ok) notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    else notify?.({ type: 'success', title: label });
    onChanged();
  };
  return (
    <div className="mb-3 rounded-lg border border-[#2496ed]/30 bg-[#2496ed]/[0.05] p-2.5" data-testid="local-runners">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-muted">
        {tj('local-runners-docker', [<Container size={12} className="text-[#2496ed]" />])}</div>
      {list.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-1 text-[12px]" data-testid="local-runner" data-state={c.state}>
          <span className={`h-2 w-2 rounded-full ${c.state === 'running' ? 'bg-gk-green' : 'bg-gk-dim'}`} />
          <span className="min-w-0 flex-1 truncate font-mono text-gk-text">{c.name}</span>
          <span className="truncate text-[11px] text-gk-dim">{c.status}</span>
          {c.runnerLabels.length > 0 && <span className="truncate font-mono text-[10.5px] text-gk-blue">{c.runnerLabels.join(', ')}</span>}
          {c.state !== 'running' && (
            <IconBtn title={t('run-3')} onClick={() => act(api.cicd.resumeLocalRunner, c.name!, t('container-is-running', c.name))}>
              {busy === c.name ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            </IconBtn>
          )}
          <IconBtn title={t('stop-and-remove-container')} onClick={() => act(api.cicd.stopLocalRunner, c.name!, t('container-stopped-and-removed', c.name))} data-testid="local-runner-stop">
            {busy === c.name ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
          </IconBtn>
        </div>
      ))}
    </div>
  );
}

