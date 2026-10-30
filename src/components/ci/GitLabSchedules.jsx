import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, Loader2, Pencil, Play, Plus, Save, Trash2, UserRoundCheck, X } from 'lucide-react';
import { CRON_PRESETS, TIMEZONES, describeCron, localTimezone } from '../../lib/cron.js';
import { StatusIcon, statusInfo } from '../PipelineStatus.jsx';

const api = window.api;

/** Расписания пайплайнов (Build → Pipeline schedules): список, создание, правка, запуск сейчас */
export default function GitLabSchedules({ repoPath, opts, branches, currentBranch, notify, onOpenPipeline }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [form, setForm] = useState(null); // { schedule | null }
  const [busy, setBusy] = useState(null);
  const [armDelete, setArmDelete] = useState(null);

  const load = useCallback(() => {
    api.gitlab.schedules(repoPath, opts).then((res) =>
      setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error }),
    );
  }, [repoPath, opts]);
  useEffect(load, [load]);

  const action = async (s, type, okText) => {
    if (type === 'delete' && armDelete !== s.id) {
      setArmDelete(s.id);
      setTimeout(() => setArmDelete((x) => (x === s.id ? null : x)), 4000);
      return;
    }
    setArmDelete(null);
    setBusy(`${type}:${s.id}`);
    const res = await api.gitlab.scheduleAction(repoPath, { id: s.id, type }, opts);
    setBusy(null);
    if (!res.ok) notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    else notify?.({ type: 'success', title: okText });
    load();
  };

  const toggleActive = async (s) => {
    setBusy(`toggle:${s.id}`);
    const res = await api.gitlab.saveSchedule(repoPath, { ...s, active: !s.active }, opts);
    setBusy(null);
    if (!res.ok) notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    load();
  };

  if (state.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
        <Loader2 size={14} className="animate-spin" /> Загружаем расписания…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="m-4 rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2.5 text-[12px]">
        <div className="font-medium text-gk-text">{state.error.message}</div>
        {state.error.hint && <div className="mt-1 text-gk-muted">{state.error.hint}</div>}
      </div>
    );
  }
  const { schedules, canWrite, me } = state.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-start gap-3">
        <p className="flex-1 text-[12px] leading-relaxed text-gk-dim">
          Пайплайны, которые GitLab запускает сам по расписанию — например, ночная сборка или еженедельная проверка зависимостей.
        </p>
        <button
          disabled={!canWrite}
          title={canWrite ? 'Новое расписание' : 'Нужен токен со scope «api»'}
          onClick={() => setForm({ schedule: null })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-gk-green/15 px-2.5 py-1.5 text-[12px] font-medium text-gk-green transition-colors enabled:hover:bg-gk-green/25 disabled:opacity-35"
        >
          <Plus size={13} /> Расписание
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gk-border p-8 text-center">
          <CalendarClock size={26} className="mx-auto mb-2 text-gk-dim" />
          <div className="text-[13px] text-gk-muted">Расписаний пока нет</div>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((s, i) => {
            const human = describeCron(s.cron);
            const notMine = me && s.owner && s.owner.username !== me;
            return (
              <div
                key={s.id}
                className={`group animate-slide-up rounded-lg border bg-gk-fg/[0.02] px-3 py-2.5 transition-colors ${s.active ? 'border-gk-border' : 'border-gk-border/50 opacity-70'}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="flex items-center gap-2.5">
                  <Toggle checked={s.active} disabled={!canWrite || busy === `toggle:${s.id}`} onChange={() => toggleActive(s)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-gk-text">{s.description}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-gk-muted">
                      <span>{human ?? <span className="font-mono">{s.cron}</span>}</span>
                      <span className="font-mono text-gk-dim">{s.cron}</span>
                      <span className="text-gk-dim">{s.timezone}</span>
                      <span className="rounded bg-gk-fg/5 px-1.5 font-mono text-[10.5px]">{s.ref}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-gk-dim">
                    {s.active && s.nextRunAt && <div title={new Date(s.nextRunAt).toLocaleString('ru-RU')}>след. запуск {futureTime(s.nextRunAt)}</div>}
                    {s.owner && <div>владелец @{s.owner.username}</div>}
                  </div>
                  {s.lastPipeline && (
                    <button
                      onClick={() => onOpenPipeline?.(s.lastPipeline.id)}
                      title={`Последний запуск: пайплайн #${s.lastPipeline.id} — ${statusInfo(s.lastPipeline.status).label}`}
                      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-gk-muted hover:bg-gk-hover"
                    >
                      <StatusIcon status={s.lastPipeline.status} size={14} />#{s.lastPipeline.id}
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconBtn title="Запустить сейчас" disabled={!canWrite || busy === `play:${s.id}`} onClick={() => action(s, 'play', `Пайплайн по расписанию «${s.description}» запущен`)}>
                      {busy === `play:${s.id}` ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    </IconBtn>
                    {notMine && canWrite && (
                      <IconBtn title={`Стать владельцем (сейчас — @${s.owner.username}). Нужно, чтобы менять расписание`} onClick={() => action(s, 'own', 'Теперь вы владелец расписания')}>
                        <UserRoundCheck size={13} />
                      </IconBtn>
                    )}
                    <IconBtn title="Изменить" disabled={!canWrite} onClick={() => setForm({ schedule: s })}>
                      <Pencil size={13} />
                    </IconBtn>
                    <IconBtn
                      title={armDelete === s.id ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'}
                      disabled={!canWrite}
                      danger={armDelete === s.id}
                      onClick={() => action(s, 'delete', `Расписание «${s.description}» удалено`)}
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                    {s.webUrl && (
                      <IconBtn title="Открыть в GitLab" onClick={() => api.openExternal(s.webUrl)}>
                        <ExternalLink size={13} />
                      </IconBtn>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <ScheduleForm
          repoPath={repoPath}
          opts={opts}
          schedule={form.schedule}
          branches={branches}
          currentBranch={currentBranch}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            notify?.({ type: 'success', title: msg });
            load();
          }}
        />
      )}
    </div>
  );
}

function futureTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'скоро';
  const min = Math.round(diff / 60000);
  if (min < 60) return `через ${min} мин`;
  const h = Math.round(min / 60);
  if (h < 48) return `через ${h} ч`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ScheduleForm({ repoPath, opts, schedule, branches, currentBranch, onClose, onSaved }) {
  const editing = Boolean(schedule);
  const tz = localTimezone();
  const [s, setS] = useState({
    description: schedule?.description ?? '',
    ref: schedule?.ref ?? currentBranch ?? branches[0] ?? 'main',
    cron: schedule?.cron ?? '0 3 * * *',
    timezone: schedule?.timezone ?? tz,
    active: schedule?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const human = describeCron(s.cron);
  const cronValid = /^(\S+\s+){4}\S+$/.test(s.cron.trim());

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api.gitlab.saveSchedule(repoPath, { ...s, id: schedule?.id }, opts);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(editing ? 'Расписание сохранено' : 'Расписание создано');
  };

  const timezones = [...new Set([s.timezone, tz, ...TIMEZONES])];

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[10vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="glass-strong w-[520px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex items-center gap-2 border-b border-gk-border px-4 py-3">
          <CalendarClock size={16} className="text-gk-blue" />
          <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">{editing ? 'Изменить расписание' : 'Новое расписание'}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-[12.5px]">
          <Field label="Описание">
            <input autoFocus value={s.description} onChange={(e) => set({ description: e.target.value })} placeholder="Ночная сборка" className={inputCls} />
          </Field>
          <Field label="Когда запускать">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.cron}
                  onClick={() => set({ cron: p.cron })}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                    s.cron === p.cron ? 'bg-gk-blue/20 text-gk-blue ring-1 ring-gk-blue/40' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input value={s.cron} onChange={(e) => set({ cron: e.target.value })} spellCheck={false} className={`${inputCls} font-mono`} />
            <div className={`mt-1 text-[11.5px] ${cronValid ? 'text-gk-green' : 'text-gk-yellow'}`}>
              {!cronValid ? 'Нужно 5 полей: минуты часы день месяц день_недели' : human ? `→ ${human}` : 'Формат принят — GitLab проверит при сохранении'}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ветка">
              <input list="schedule-branches" value={s.ref} onChange={(e) => set({ ref: e.target.value })} className={`${inputCls} font-mono`} />
              <datalist id="schedule-branches">
                {branches.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label="Часовой пояс">
              <select value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} className={inputCls}>
                {timezones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                    {z === tz ? ' (ваш)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-gk-text">
            <input type="checkbox" checked={s.active} onChange={(e) => set({ active: e.target.checked })} className="accent-[var(--color-gk-green)]" />
            Включено
          </label>
          {error && (
            <div className="rounded-md border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px]">
              <div className="font-medium text-gk-text">{error.message}</div>
              {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gk-border px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || !s.description.trim() || !s.ref.trim() || !cronValid}
            className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {editing ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  'w-full rounded-md bg-gk-bg px-2.5 py-1.5 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-gk-muted">{label}</div>
      {children}
    </div>
  );
}

function IconBtn({ children, danger, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        danger ? 'bg-gk-red text-white' : 'text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={checked ? 'Включено — выключить' : 'Выключено — включить'}
      onClick={onChange}
      className={`relative block h-[18px] w-8 shrink-0 rounded-full p-0 transition-colors duration-200 disabled:opacity-50 ${checked ? 'bg-gk-green' : 'bg-gk-fg/15'}`}
    >
      <span
        className="absolute left-0 top-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: `translateX(${checked ? 16 : 2}px)` }}
      />
    </button>
  );
}
