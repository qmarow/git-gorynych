// Раннеры: парк (собственные и облачные), статусы в реальном времени, редактор (метки, пауза, настройки),
// очистка неактивных, мастер подключения нового раннера и локальный Docker-раннер в один клик.
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { relativeTime } from '../../lib/format.js';
import { Button, ErrorBox, Modal } from '../Dialogs.jsx';
import { ActionButton, ChipsInput, ConfirmAction, ErrorNote, IconBtn, Loading, SegButton, Toggle, usePolling } from './common.jsx';
import { t, tj, locale } from '../../i18n/index.ts';

const api = window.api;

export const RUNNER_STATUS = {
  online: { label: 'Online', ru: t('свободен'), dot: 'bg-gk-green shadow-[0_0_8px] shadow-gk-green/60', text: 'text-gk-green' },
  busy: { label: 'Busy', ru: t('занят'), dot: 'bg-gk-blue shadow-[0_0_8px] shadow-gk-blue/60 animate-pulse', text: 'text-gk-blue' },
  offline: { label: 'Offline', ru: t('не в сети'), dot: 'bg-gk-red', text: 'text-gk-red' },
  paused: { label: 'Paused', ru: t('на паузе'), dot: 'bg-gk-yellow', text: 'text-gk-yellow' },
};

/** Значок Windows — четыре окна (в наборе иконок брендов нет) */
function WindowsIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1 2.6l5.7-.8v5.5H1zM7.5 1.7L15 .7v6.6H7.5zM1 8.2h5.7v5.5L1 12.9zM7.5 8.2H15v6.6l-7.5-1z" />
    </svg>
  );
}

export function OsIcon({ os, size = 13 }) {
  if (os === 'windows') return <WindowsIcon size={size} />;
  if (os === 'macos') return <Apple size={size} />;
  if (os === 'docker') return <Container size={size} />;
  if (os === 'linux') return <Terminal size={size} />;
  return <Monitor size={size} />;
}
const OS_NAMES = { linux: 'Linux', macos: 'macOS', windows: 'Windows', docker: 'Docker' };

const isOwn = (r) => !r.isShared && !r.virtual;

export default function Runners({ repoPath, opts, caps, provider, providerLabel, notify, onOpenJob, onInsertTags, canInsert }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [filter, setFilter] = useState('own');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [local, setLocal] = useState(null);

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
  const live = caps ?? state.data?.capabilities ?? {};
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
      title: t('Удалено неактивных раннеров: {0}', removed.length),
      hint: failed.length ? t('Не удалось: {0}', failed.map((f) => `${f.name} (${f.error})`).join(', ')) : removed.map((r) => r.name).join(', '),
    });
    load();
  };

  if (state.loading && !state.data) return <Loading text={t('Загружаем раннеры…')} />;
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
            {tj('{0} Собственные <1>{2}</1>', [<Server size={11} />, <span className="text-gk-dim" />, counts.own])}
          </SegButton>
          <SegButton active={filter === 'shared'} onClick={() => setFilter('shared')} data-filter="shared">
            {tj('{0} Облачные <1>{2}</1>', [<Cloud size={11} />, <span className="text-gk-dim" />, counts.shared])}
          </SegButton>
          <SegButton active={filter === 'all'} onClick={() => setFilter('all')} data-filter="all">
            {t('Все')}</SegButton>
        </div>
        <label className="flex min-w-40 flex-1 items-center gap-1.5 rounded-md bg-gk-bg px-2 py-1 ring-1 ring-gk-border focus-within:ring-gk-blue">
          <Search size={12} className="text-gk-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Имя или тег')} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-gk-dim" />
        </label>
        <IconBtn title={t('Обновить')} onClick={() => load()}>
          <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} />
        </IconBtn>
        <ConfirmAction
          icon={Eraser}
          busy={pruning}
          testid="runners-prune"
          label={t('Очистить неактивные{0}', dead.length ? ` (${dead.length})` : '')}
          confirmLabel={t('Удалить {0} офлайн?', dead.length)}
          why={!live.canDeleteRunner ? live.why?.canDeleteRunner ?? t('Нет прав') : !dead.length ? t('Нет собственных раннеров не в сети') : null}
          onConfirm={prune}
        />
        <ActionButton icon={Plus} tone="green" why={live.canCreateRunnerToken ? null : live.why?.canCreateRunnerToken ?? t('Нет прав')} onClick={() => setWizard(true)} data-testid="runner-add">
          {t('Подключить раннер')}</ActionButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.error && <div className="mb-2 text-[11px] text-gk-yellow">{tj('Не удалось обновить: {0}', [state.error.message])}</div>}
        {local?.runners?.length > 0 && <LocalRunners list={local.runners} onChanged={loadLocal} notify={notify} />}
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim" data-testid="runners-empty">
            {runners.length === 0
              ? t('Нет доступных раннеров — задания будут ждать в очереди. Нажмите «Подключить раннер».')
              : filter === 'own'
                ? t('Собственных раннеров нет — задания берут облачные')
                : t('Ничего не найдено')}
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
                onInsert={canInsert && r.labels.length ? () => onInsertTags(r) : null}
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

function StatusBadge({ runner, onOpenJob }) {
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
              onOpenJob?.(runner.currentJob);
            }}
            data-testid="runner-job"
            className="max-w-[140px] truncate text-gk-blue hover:underline"
            data-tip={t('Открыть задание')}
          >
            {runner.currentJob.name ?? `#${runner.currentJob.id}`}
          </button>
        </>
      ) : null}
      <span className="-ml-1.5 text-gk-muted">)</span>
    </span>
  );
}

function RunnerCard({ runner: r, index, onOpen, onOpenJob, onInsert }) {
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
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gk-fg/5 text-gk-muted" data-tip={OS_NAMES[r.os] ?? t('ОС неизвестна')}>
          <OsIcon os={r.os} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gk-text" title={r.description ?? r.name}>
          {r.name}
        </span>
        {r.virtual && <span className="rounded bg-gk-purple/15 px-1.5 text-[10px] text-gk-purple">{t('облачный')}</span>}
        {r.isShared && !r.virtual && <span className="rounded bg-gk-fg/5 px-1.5 text-[10px] text-gk-dim">{t('общий')}</span>}
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
        {r.contactedAt && r.status === 'offline' && <span>{tj('был в сети {0}', [relativeTime(r.contactedAt)])}</span>}
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
          {tj('{0} Вставить в конфиг', [<ClipboardPaste size={11} />])}</button>
      )}
    </div>
  );
}

/* =================== Редактор раннера =================== */

function RunnerEditor({ runner, caps, provider, suggestions, repoPath, opts, notify, onClose, onChanged }) {
  const [labels, setLabels] = useState(runner.labels);
  const [paused, setPaused] = useState(runner.status === 'paused');
  const [untagged, setUntagged] = useState(Boolean(runner.runUntagged));
  const [locked, setLocked] = useState(Boolean(runner.locked));
  const [description, setDescription] = useState(runner.description ?? runner.name ?? '');
  const [timeout, setTimeoutMin] = useState(runner.maximumTimeout ? String(Math.round(runner.maximumTimeout / 60)) : '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const readOnly = !runner.editable;
  const settingsWhy = readOnly ? t('Общий раннер меняет администратор сервера') : caps.canEditRunnerSettings ? null : caps.why?.canEditRunnerSettings ?? t('Недоступно');
  const labelsWhy = readOnly ? t('Общий раннер меняет администратор сервера') : caps.canEditRunnerLabels ? null : caps.why?.canEditRunnerLabels ?? t('Недоступно');
  const pauseWhy = readOnly ? t('Общий раннер меняет администратор сервера') : caps.canPauseRunner ? null : caps.why?.canPauseRunner ?? t('Недоступно');

  const patch = {};
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
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
    notify?.({ type: 'success', title: t('Раннер {0} сохранён', runner.name) });
    onChanged();
    onClose();
  };
  const remove = async () => {
    setBusy('delete');
    const res = await api.cicd.deleteRunner(repoPath, { id: runner.id }, opts);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    notify?.({ type: 'success', title: t('Раннер {0} удалён', runner.name) });
    onChanged();
    onClose();
  };

  return (
    <Modal
      title={t('Раннер {0}', runner.name)}
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
                label={t('Удалить')}
                confirmLabel={t('Точно удалить раннер?')}
                testid="runner-delete"
                why={readOnly ? t('Общий раннер удаляет администратор сервера') : caps.canDeleteRunner ? null : caps.why?.canDeleteRunner ?? t('Нет прав')}
                onConfirm={remove}
              />
            </div>
          )}
          <Button onClick={onClose}>{t('Закрыть')}</Button>
          <Button variant="primary" disabled={!dirty || busy} onClick={save} data-testid="runner-save">
            {tj('{0} Сохранить', [busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />])}</Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="runner-editor">
        <div className="flex items-center gap-2">
          <StatusBadge runner={runner} />
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-gk-dim">
            <OsIcon os={runner.os} size={12} /> {OS_NAMES[runner.os] ?? '—'} {runner.architecture ?? ''} {runner.version ? `· v${runner.version}` : ''}
          </span>
        </div>
        {runner.virtual && <p className="text-[12px] text-gk-dim">{t('Облачный раннер провайдера — им управляет сам сервис.')}</p>}
        {!runner.virtual && readOnly && <p className="text-[12px] text-gk-yellow">{t('Общий раннер сервера: менять его может только администратор.')}</p>}

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[12px] text-gk-muted">
            {tj('Теги / метки {0}', [provider === 'github' && <span className="text-gk-dim">{t('(серые — системные, их задаёт GitHub)')}</span>])}
          </div>
          <div data-tip={labelsWhy || undefined}>
            <ChipsInput value={labels} onChange={setLabels} suggestions={[...suggestions, 'docker', 'linux', 'prod', 'gpu']} locked={runner.readOnlyLabels ?? []} disabled={Boolean(labelsWhy)} testid="runner-labels-input" />
          </div>
          {labelsWhy && <p className="mt-1 text-[11.5px] text-gk-dim">{labelsWhy}</p>}
        </div>

        <Toggle
          checked={!paused}
          onChange={(v) => setPaused(!v)}
          label={paused ? t('На паузе') : t('Активен')}
          hint={t('На паузе раннер не берёт новые задания, а текущие доделывает — можно вывести сервер на обслуживание без обрыва сборок')}
          why={pauseWhy}
          testid="runner-active"
        />
        <Toggle checked={untagged} onChange={setUntagged} label={t('Брать задания без тегов (Run untagged jobs)')} why={settingsWhy} testid="runner-untagged" />
        <Toggle checked={locked} onChange={setLocked} label={t('Только для этого проекта (Locked to current project)')} why={settingsWhy} testid="runner-locked" />
        <label className="block" data-tip={settingsWhy || undefined}>
          {tj('<0>Описание (Description)</0>{1}', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={Boolean(settingsWhy)}
            data-testid="runner-description"
            className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue disabled:opacity-50"
          />])}
        </label>
        <label className="block" data-tip={settingsWhy || undefined}>
          {tj('<0>Максимальный тайм-аут задания, минут (Maximum job timeout)</0>{1}', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
            type="number"
            min="10"
            value={timeout}
            onChange={(e) => setTimeoutMin(e.target.value)}
            disabled={Boolean(settingsWhy)}
            placeholder={t('как в проекте')}
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

function CodeBlock({ text, testid }) {
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
        aria-label={t('Скопировать')}
        data-testid={`${testid}-copy`}
        className="absolute right-2 top-2 rounded bg-white/10 p-1.5 text-white/70 hover:bg-white/20 hover:text-white"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function RegisterWizard({ repoPath, opts, caps, provider, providerLabel, suggestions, notify, onClose, onLocalStarted }) {
  const [labels, setLabels] = useState([]);
  const [name, setName] = useState('');
  const [untagged, setUntagged] = useState(false);
  const [reg, setReg] = useState(null);
  const [tab, setTab] = useState('docker');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [docker, setDocker] = useState(null);

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
    notify?.({ type: 'success', title: t('Локальный раннер {0} запущен в Docker', res.data.name), hint: t('Через несколько секунд он появится в списке со статусом Online') });
    onLocalStarted();
    onClose();
  };

  const command = reg?.commands?.find((c) => c.id === tab) ?? reg?.commands?.[0];
  return (
    <Modal title={t('Подключить раннер · {0}', providerLabel)} icon={Plug} iconClass="text-gk-green" onClose={onClose} width={640} footer={<Button onClick={onClose}>{t('Готово')}</Button>}>
      <div className="space-y-3" data-testid="runner-wizard">
        <div>
          <div className="mb-1 text-[12px] text-gk-muted">{t('Теги нового раннера')}</div>
          <ChipsInput value={labels} onChange={setLabels} suggestions={[...suggestions, 'docker', 'linux', 'prod', 'gpu', 'windows', 'macos']} placeholder="docker, prod, gpu…" testid="wizard-labels" />
        </div>
        <label className="block">
          {tj('<0>Имя (необязательно)</0>{1}', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input value={name} onChange={(e) => setName(e.target.value)} placeholder="build-server-1" className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue" />])}
        </label>
        {provider === 'gitlab' && <Toggle checked={untagged || !labels.length} onChange={setUntagged} label={t('Брать задания без тегов')} hint={t('Без тегов раннер берёт только такие задания')} />}

        {!reg ? (
          <ActionButton icon={KeyRound} tone="blue" busy={busy === 'token'} onClick={getToken} data-testid="wizard-token">
            {t('Получить токен и команды')}</ActionButton>
        ) : (
          <div className="space-y-2" data-testid="wizard-result">
            <div className="flex items-center gap-2 rounded-md border border-gk-green/30 bg-gk-green/[0.06] px-3 py-2 text-[12px]">
              <KeyRound size={13} className="text-gk-green" />
              <span className="text-gk-muted">{reg.kind === 'auth' ? t('Токен раннера') : t('Токен регистрации')}:</span>
              <code className="min-w-0 flex-1 truncate font-mono text-gk-text" data-testid="wizard-token-value">
                {reg.token}
              </code>
              {reg.expiresAt && <span className="shrink-0 text-gk-dim">{tj('действует до {0}', [new Date(reg.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })])}</span>}
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
              {tj('{0} Токен показывается один раз — не публикуйте его.', [command?.shell === 'powershell' ? t('Выполните в PowerShell от администратора.') : t('Выполните в терминале сервера, где будет работать раннер.')])}</p>
          </div>
        )}

        {caps.localRunner && (
          <div className="rounded-lg border border-gk-border p-3" data-testid="wizard-local">
            <div className="flex items-center gap-2">
              {tj('{0}<1>Локальный раннер в Docker на этом компьютере</1>{2}', [<Container size={15} className="text-[#2496ed]" />, <span className="flex-1 text-[12.5px] font-medium text-gk-text" />, docker === null ? (
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
              {tj('Поднимет контейнер раннера с этими тегами и зарегистрирует его в {0} — чтобы гонять пайплайны на своём компьютере. Остановить можно здесь же, во вкладке «Раннеры».', [providerLabel])}</p>
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
              {t('Запустить локально')}</ActionButton>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/* =================== Локальные контейнеры =================== */

function LocalRunners({ list, onChanged, notify }) {
  const [busy, setBusy] = useState(null);
  const act = async (fn, name, label) => {
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
        {tj('{0} Локальные раннеры (Docker)', [<Container size={12} className="text-[#2496ed]" />])}</div>
      {list.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-1 text-[12px]" data-testid="local-runner" data-state={c.state}>
          <span className={`h-2 w-2 rounded-full ${c.state === 'running' ? 'bg-gk-green' : 'bg-gk-dim'}`} />
          <span className="min-w-0 flex-1 truncate font-mono text-gk-text">{c.name}</span>
          <span className="truncate text-[11px] text-gk-dim">{c.status}</span>
          {c.runnerLabels.length > 0 && <span className="truncate font-mono text-[10.5px] text-gk-blue">{c.runnerLabels.join(', ')}</span>}
          {c.state !== 'running' && (
            <IconBtn title={t('Запустить')} onClick={() => act(api.cicd.resumeLocalRunner, c.name, t('Контейнер {0} запущен', c.name))}>
              {busy === c.name ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            </IconBtn>
          )}
          <IconBtn title={t('Остановить и удалить контейнер')} onClick={() => act(api.cicd.stopLocalRunner, c.name, t('Контейнер {0} остановлен и удалён', c.name))} data-testid="local-runner-stop">
            {busy === c.name ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
          </IconBtn>
        </div>
      ))}
    </div>
  );
}

