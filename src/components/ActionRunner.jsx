import { useEffect, useState } from 'react';
import { Check, CircleX, Loader2, CircleMinus, Play, RotateCcw, WandSparkles, X } from 'lucide-react';
import { ACTION_ICONS, STEP_ICONS } from './ActionBuilder.jsx';
import { STEP_TYPES, slugify } from '../lib/actions.js';

/**
 * Ход выполнения действия: шаги со статусами; при ошибке — причина и «Повторить с этого шага».
 * run: { action, steps: [{ id, type, label, status: 'pending'|'running'|'done'|'failed'|'skipped', note }], error, finished }
 */
export function RunnerCard({ run, onClose, onRetry }) {
  const Icon = ACTION_ICONS[run.action.icon] ?? WandSparkles;
  const failed = run.steps.findIndex((s) => s.status === 'failed');
  const doneCount = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const running = !run.finished;

  // Успешный запуск сам закрывается через несколько секунд
  useEffect(() => {
    if (!run.finished || run.error) return undefined;
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [run.finished, run.error, onClose]);

  return (
    <div className="glass-strong fixed bottom-10 right-4 z-40 w-[340px] animate-slide-up overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-gk-border px-3 py-2">
        <Icon size={14} className="shrink-0 text-gk-blue" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gk-strong">{run.action.name}</span>
        <span className="shrink-0 text-[11px] text-gk-dim">
          {doneCount}/{run.steps.length}
        </span>
        {!running && (
          <button onClick={onClose} className="rounded p-0.5 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="h-0.5 bg-gk-fg/5">
        <div
          className={`h-full transition-[width] duration-500 ${run.error ? 'bg-gk-red' : 'bg-gk-green'}`}
          style={{ width: `${(doneCount / Math.max(1, run.steps.length)) * 100}%` }}
        />
      </div>
      <ol className="max-h-64 overflow-y-auto px-2 py-1.5">
        {run.steps.map((s, i) => {
          const StepIcon = STEP_ICONS[s.type];
          return (
            <li key={s.id} className={`flex items-start gap-2 rounded px-1.5 py-1 text-[12px] ${s.status === 'running' ? 'bg-gk-blue/10' : ''}`}>
              <span className="mt-0.5 shrink-0">
                {s.status === 'running' ? (
                  <Loader2 size={13} className="animate-spin text-gk-blue" />
                ) : s.status === 'done' ? (
                  <Check size={13} className="text-gk-green" />
                ) : s.status === 'failed' ? (
                  <CircleX size={13} className="text-gk-red" />
                ) : s.status === 'skipped' ? (
                  <CircleMinus size={13} className="text-gk-dim" />
                ) : StepIcon ? (
                  <StepIcon size={13} className="text-gk-dim" />
                ) : (
                  <span className="block h-3 w-3 rounded-full border border-gk-dim" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={s.status === 'pending' ? 'text-gk-dim' : s.status === 'failed' ? 'text-gk-red' : 'text-gk-text'}>
                  {i + 1}. {s.label}
                </span>
                {s.note && <span className="block truncate text-[11px] text-gk-dim" title={s.note}>{s.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {run.error && (
        <div className="border-t border-gk-red/30 bg-gk-red/[0.07] px-3 py-2 text-[12px]">
          <div className="font-medium text-gk-text">{run.error.message}</div>
          {run.error.hint && <div className="mt-0.5 text-gk-muted">{run.error.hint}</div>}
          {failed >= 0 && (
            <button
              onClick={() => onRetry(failed)}
              className="mt-2 flex items-center gap-1.5 rounded-md bg-gk-fg/10 px-2.5 py-1 text-[12px] text-gk-text hover:bg-gk-fg/15"
            >
              <RotateCcw size={12} /> Повторить с шага {failed + 1}
            </button>
          )}
        </div>
      )}
      {run.finished && !run.error && (
        <div className="border-t border-gk-green/25 bg-gk-green/[0.07] px-3 py-1.5 text-[12px] text-gk-green">Готово{run.summary ? ` — ${run.summary}` : ''}</div>
      )}
    </div>
  );
}

/** Перед запуском: значения для {input:…} и/или подтверждение */
export function RunDialog({ action, inputs, branches, onRun, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(inputs.map((x) => [x.label, ''])));
  const Icon = ACTION_ICONS[action.icon] ?? WandSparkles;
  const ready = inputs.every((x) => values[x.label].trim());

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[14vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onRun(values);
        }}
        className="glass-strong w-[460px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-gk-border bg-gk-panel-2"
      >
        <div className="flex items-center gap-2 border-b border-gk-border px-4 py-3">
          <Icon size={16} className="text-gk-blue" />
          <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">{action.name}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <ol className="space-y-0.5 text-[12px] text-gk-muted">
            {action.steps.map((s, i) => (
              <li key={s.id}>
                {i + 1}. {STEP_TYPES[s.type]?.describe(s.params)}
              </li>
            ))}
          </ol>
          {inputs.map((x, i) => (
            <label key={x.label} className="block">
              <span className="mb-1 block text-[12px] font-medium text-gk-text">{x.label}</span>
              <input
                autoFocus={i === 0}
                value={values[x.label]}
                onChange={(e) => setValues((v) => ({ ...v, [x.label]: e.target.value }))}
                list={x.branchLike ? 'run-branches' : undefined}
                className="w-full rounded-md bg-gk-bg px-2.5 py-1.5 text-[13px] text-gk-text outline-none ring-1 ring-gk-border focus:ring-gk-blue"
              />
              {x.branchLike && values[x.label].trim() && (
                <span className="mt-0.5 block font-mono text-[11px] text-gk-dim">→ {slugify(values[x.label])}</span>
              )}
            </label>
          ))}
          <datalist id="run-branches">
            {branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="flex justify-end gap-2 border-t border-gk-border px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Отмена
          </button>
          <button
            type="submit"
            autoFocus={inputs.length === 0}
            disabled={!ready}
            className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-40"
          >
            <Play size={13} /> Запустить
          </button>
        </div>
      </form>
    </div>
  );
}
