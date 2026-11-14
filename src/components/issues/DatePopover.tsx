/**
 * Новое в 2.0: выбор срока задачи — календарь на месяц, «Сегодня», «Через неделю», «Убрать срок».
 *
 * Панель через портал под якорем, не выходит за края окна; Esc и клик снаружи закрывают. Стрелки двигают выбранный
 * день (←→ — день, ↑↓ — неделя), PageUp/PageDown — месяц, Enter выбирает. Дата — `YYYY-MM-DD` по местному времени.
 * Неделя начинается с понедельника; названия месяцев и дней — `Intl` на языке интерфейса.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localDate } from '../../lib/issues.ts';
import { locale as uiLocale, t } from '../../i18n/index.ts';

const WIDTH = 252;

interface DatePopoverProps {
  anchor: HTMLElement;
  value: string | null;
  onChange: (date: string | null) => void;
  onClose: () => void;
}

const parse = (value: string | null): Date | null => {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export default function DatePopover({ anchor, value, onChange, onClose }: DatePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const [cursor, setCursor] = useState<Date>(() => parse(value) ?? today);
  const [pos, setPos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, top: r.bottom + 4 };
  });
  const locale = uiLocale();
  const selected = value?.slice(0, 10) ?? null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const below = r.bottom + 4;
    const top = below + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - el.offsetHeight - 4) : below;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);

  const pick = (date: Date | null) => {
    onChange(date ? localDate(date) : null);
    onClose();
  };

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(addDays(new Date(2024, 0, 1), i)));
  const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(first);
  const month = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, Math.min(c.getDate(), 28)));

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      tabIndex={-1}
      aria-label={t('issues-meta-due')}
      data-testid="date-popover"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        e.stopPropagation();
        if (step) {
          e.preventDefault();
          setCursor((c) => addDays(c, step));
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          month(e.key === 'PageUp' ? -1 : 1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          pick(cursor);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      className="fixed z-50 rounded-lg border border-gk-border bg-gk-panel-2 p-2 shadow-2xl outline-none backdrop-blur animate-pop-in"
    >
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => month(-1)} aria-label={t('issues-date-prev')} className="flex h-6 w-6 items-center justify-center rounded text-gk-muted hover:bg-gk-hover">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-gk-strong first-letter:uppercase">{title}</span>
        <button type="button" onClick={() => month(1)} aria-label={t('issues-date-next')} className="flex h-6 w-6 items-center justify-center rounded text-gk-muted hover:bg-gk-hover">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center text-[11px]">
        {weekdays.map((d) => (
          <span key={d} className="py-0.5 text-gk-dim">{d}</span>
        ))}
        {days.map((d) => {
          const id = localDate(d);
          const other = d.getMonth() !== cursor.getMonth();
          const isSelected = id === selected;
          const isCursor = id === localDate(cursor);
          const isToday = id === localDate(today);
          return (
            <button
              key={id}
              type="button"
              data-date={id}
              tabIndex={-1}
              onClick={() => pick(d)}
              className={`h-7 rounded ${isSelected ? 'bg-gk-blue font-semibold text-white' : isCursor ? 'bg-gk-hover text-gk-strong' : other ? 'text-gk-dim hover:bg-gk-hover' : 'text-gk-text hover:bg-gk-hover'} ${isToday && !isSelected ? 'ring-1 ring-gk-blue/60 ring-inset' : ''}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-gk-border pt-2 text-xs">
        <button type="button" onClick={() => pick(today)} className="rounded px-2 py-1 text-gk-text hover:bg-gk-hover">{t('issues-date-today')}</button>
        <button type="button" onClick={() => pick(addDays(today, 7))} className="rounded px-2 py-1 text-gk-text hover:bg-gk-hover">{t('issues-date-week')}</button>
        <span className="flex-1" />
        {value && (
          <button type="button" onClick={() => pick(null)} className="rounded px-2 py-1 text-gk-red hover:bg-gk-red/10">{t('issues-date-clear')}</button>
        )}
      </div>
    </div>,
    document.body,
  );
}
