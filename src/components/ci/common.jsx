// Общие мелочи панелей CI/CD: опрос, ошибки, кнопки, живой таймер, размер файла
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { formatDuration } from '../PipelineStatus.jsx';
import { t as tr, locale } from '../../i18n/index.js';

/** Повторяем запрос с интервалом, пока окно видимо; delay может меняться, 0 — не опрашивать */
export function usePolling(fn, delay, deps) {
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

/** Текущее время, обновляется раз в секунду (для живого таймера) */
export function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Длительность: у идущего — тикает от startedAt, у завершённого — итог */
export function Duration({ startedAt, duration, running, className = '', prefix = '' }) {
  const now = useNow(Boolean(running && startedAt));
  let sec = duration;
  if (running && startedAt) sec = Math.max(0, (now - new Date(startedAt).getTime()) / 1000);
  const text = formatDuration(sec);
  if (!text) return null;
  return (
    <span className={`tabular-nums ${className}`} data-testid={running ? 'live-duration' : 'duration'} title={running ? tr('Идёт сейчас') : tr('Длительность')}>
      {prefix}
      {text}
    </span>
  );
}

export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return tr('{0} Б', bytes);
  const num = (n, digits) => n.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  if (bytes < 1024 * 1024) return tr('{0} КБ', num(bytes / 1024, bytes < 10240 ? 1 : 0));
  if (bytes < 1024 ** 3) return tr('{0} МБ', num(bytes / 1024 / 1024, 1));
  return tr('{0} ГБ', num(bytes / 1024 ** 3, 2));
}

export function ErrorNote({ error, className = 'm-4' }) {
  if (!error) return null;
  return (
    <div className={`${className} rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2.5 text-[12px]`} data-testid="ci-error">
      <div className="flex items-center gap-1.5 font-medium text-gk-text">
        <AlertTriangle size={13} className="shrink-0 text-gk-red" /> {error.message}
      </div>
      {error.hint && <div className="mt-1 pl-5 text-gk-muted">{error.hint}</div>}
    </div>
  );
}

export function Loading({ text }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 p-6 text-[13px] text-gk-muted">
      <Loader2 size={14} className="animate-spin" /> {text}
    </div>
  );
}

export function ListSkeleton() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex gap-2.5 border-b border-gk-border/50 px-3 py-2.5">
      <span className="h-4 w-4 animate-pulse rounded-full bg-gk-fg/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-3/4 animate-pulse rounded bg-gk-fg/10" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-gk-fg/5" />
      </div>
    </div>
  ));
}

export function SegButton({ active, children, ...props }) {
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

/**
 * Кнопка действия. why — почему недоступно (провайдер не умеет): кнопка выключена, причина — в подсказке.
 */
export function ActionButton({ icon: Icon, busy, children, why, tone = 'default', ...props }) {
  const tones = {
    default: 'bg-gk-hover text-gk-text enabled:hover:bg-gk-fg/10',
    green: 'bg-gk-green/15 text-gk-green enabled:hover:bg-gk-green/25',
    red: 'bg-gk-red/12 text-gk-red enabled:hover:bg-gk-red/20',
    blue: 'bg-gk-blue/15 text-gk-blue enabled:hover:bg-gk-blue/25',
  };
  return (
    <button
      {...props}
      disabled={busy || props.disabled || Boolean(why)}
      data-tip={why || props['data-tip'] || undefined}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors disabled:opacity-45 ${tones[tone]} ${props.className ?? ''}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : Icon ? <Icon size={12} /> : null}
      {children}
    </button>
  );
}

export function ConfirmAction({ icon, busy, label, confirmLabel, onConfirm, why, testid, tone }) {
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
      why={why}
      tone={armed ? 'red' : tone}
      data-testid={testid}
      onClick={() => {
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      <span>{armed ? confirmLabel : label}</span>
    </ActionButton>
  );
}

export function IconBtn({ children, active, title, ...props }) {
  return (
    <button
      {...props}
      aria-label={title}
      data-tip={title}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        active ? 'bg-gk-blue/15 text-gk-blue' : 'text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

/** Поле-тумблер (чекбокс в стиле приложения) */
export function Toggle({ checked, onChange, label, hint, disabled, why, testid }) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled || why ? 'opacity-50' : 'cursor-pointer'}`} data-tip={why || undefined} data-testid={testid}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || Boolean(why)}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors ${checked ? 'bg-gk-green' : 'bg-gk-fg/15'}`}
      >
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-gk-text">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-gk-dim">{hint}</span>}
      </span>
    </label>
  );
}

/** Ввод тегов чипсами: Enter, запятая или пробел — добавить, Backspace — убрать последний */
export function ChipsInput({ value, onChange, suggestions = [], placeholder = tr('тег'), locked = [], disabled, testid }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [open, setOpen] = useState(false); // список подсказок: открыт, пока печатают; после добавления тега — закрыт
  const lockedSet = new Set(locked.map((l) => l.toLowerCase()));
  const add = (raw) => {
    const parts = String(raw)
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const t of parts) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    onChange(next);
    setText('');
    setOpen(false);
  };
  const shown = [];
  for (const s of suggestions) {
    const low = String(s).toLowerCase();
    if (shown.length >= 8 || shown.some((x) => x.toLowerCase() === low) || value.some((v) => v.toLowerCase() === low) || !low.includes(text.toLowerCase())) continue;
    shown.push(String(s));
  }
  return (
    <div className="relative" data-testid={testid}>
      <div
        className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-md bg-gk-bg px-1.5 py-1 ring-1 ${focus ? 'ring-gk-blue' : 'ring-gk-border'} ${disabled ? 'opacity-50' : ''}`}
        onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
      >
        {value.map((t) => {
          const isLocked = lockedSet.has(t.toLowerCase());
          return (
            <span
              key={t}
              data-testid="chip"
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11.5px] ${isLocked ? 'bg-gk-fg/5 text-gk-dim' : 'bg-gk-blue/15 text-gk-blue'}`}
              data-tip={isLocked ? tr('Метку задаёт сам сервер — её не убрать') : undefined}
            >
              {t}
              {!isLocked && !disabled && (
                <button
                  type="button"
                  aria-label={tr('Убрать {0}', t)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((x) => x !== t));
                  }}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <input
          value={text}
          disabled={disabled}
          onFocus={() => {
            setFocus(true);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onChange={(e) => {
            const v = e.target.value;
            setOpen(true);
            if (/[,\s]$/.test(v)) add(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Escape' && open && shown.length) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === 'Backspace' && !text && value.length) {
              const last = value[value.length - 1];
              if (!lockedSet.has(last.toLowerCase())) onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length ? '' : placeholder}
          className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-gk-dim"
        />
      </div>
      {focus && open && shown.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-md border border-gk-fg/10 bg-[var(--gk-solid-2)] py-1 shadow-xl">
          {shown.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(s);
              }}
              className="block w-full px-2.5 py-1 text-left font-mono text-[12px] text-gk-text hover:bg-gk-hover"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Center({ children, className = '' }) {
  return <div className={`flex flex-1 items-center justify-center gap-2 p-6 text-center text-[13px] text-gk-muted ${className}`}>{children}</div>;
}
