/**
 * Новое в 2.0: общий выбор значений раздела «Задачи» (метки, исполнители, автор, веха).
 *
 * Панель 280 px под якорем, через портал в `document.body`, не выходит за края окна (как `GraphViewMenu`). Поле
 * поиска с автофокусом, подстрока без учёта регистра; выбранные подняты наверх (порядок фиксируется при открытии, чтобы
 * строки не прыгали под мышью). Клик или Enter применяет сразу; при одиночном выборе панель закрывается. Стрелки
 * двигают подсветку, Esc и клик снаружи закрывают. Пункт «нет значения» (`noneLabel`) — первым, его id — `null`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus } from 'lucide-react';
import { t } from '../../i18n/index.ts';

const WIDTH = 280;
const MAX_HEIGHT = 340;

interface IssuePickerProps<T> {
  anchor: HTMLElement;
  items: readonly T[];
  getId: (item: T) => string;
  selectedIds: readonly string[];
  multiple?: boolean;
  renderItem: (item: T) => ReactNode;
  getSearchText: (item: T) => string;
  noneLabel?: ReactNode;
  /** `noneSelected` — выбран ли пункт «нет значения». */
  noneSelected?: boolean;
  onToggle: (id: string | null) => void;
  onCreate?: (text: string) => void;
  onClose: () => void;
}

type Row<T> = { kind: 'none' } | { kind: 'item'; item: T; id: string } | { kind: 'create'; text: string };

export default function IssuePicker<T>({
  anchor,
  items,
  getId,
  selectedIds,
  multiple = false,
  renderItem,
  getSearchText,
  noneLabel,
  noneSelected = false,
  onToggle,
  onCreate,
  onClose,
}: IssuePickerProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  // Фокус после закрытия — на кнопку, которая открыла панель (если он был внутри панели или ушёл в никуда)
  useEffect(
    () => () => {
      const active = document.activeElement;
      if (!active || active === document.body || ref.current?.contains(active)) anchor.focus?.({ preventScroll: true });
    },
    [anchor],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number }>(() => {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, top: r.bottom + 4 };
  });

  // Выбранные наверх — по состоянию на момент открытия
  const [order] = useState(() => {
    const chosen = new Set(selectedIds);
    return [...items].sort((a, b) => Number(chosen.has(getId(b))) - Number(chosen.has(getId(a))));
  });
  const ordered = useMemo(() => {
    const known = new Set(order.map(getId));
    return [...order, ...items.filter((item) => !known.has(getId(item)))];
  }, [order, items, getId]);

  const rows = useMemo<Row<T>[]>(() => {
    const needle = text.trim().toLocaleLowerCase();
    const found = ordered.filter((item) => !needle || getSearchText(item).toLocaleLowerCase().includes(needle));
    const out: Row<T>[] = [];
    if (noneLabel && !needle) out.push({ kind: 'none' });
    for (const item of found) out.push({ kind: 'item', item, id: getId(item) });
    if (onCreate && needle && !found.length) out.push({ kind: 'create', text: text.trim() });
    return out;
  }, [ordered, text, getSearchText, getId, noneLabel, onCreate]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, rows.length - 1))), [rows.length]);

  // Не даём панели выйти за край окна
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const { height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(r.left, window.innerWidth - WIDTH - 4));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 4 ? Math.max(4, r.top - height - 4) : below;
    setPos({ left, top });
  }, [anchor, rows.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const chosen = new Set(selectedIds);
  const apply = (row: Row<T> | undefined) => {
    if (!row) return;
    if (row.kind === 'create') onCreate?.(row.text);
    else onToggle(row.kind === 'none' ? null : row.id);
    if (!multiple || row.kind !== 'item') onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{ ...pos, width: WIDTH }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-gk-border bg-gk-panel-2 shadow-2xl backdrop-blur-xl animate-pop-in"
      onKeyDown={(e) => {
        // Клавиши панели не доходят до раздела (Esc закрыл бы его, стрелки двигали бы список задач)
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((a) => Math.min(rows.length - 1, a + 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          apply(rows[active]);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        placeholder={t('issues-picker-search')}
        className="m-2 rounded border border-gk-border bg-gk-sink/30 px-2 py-1 text-xs text-gk-text outline-none focus:border-gk-blue"
      />
      <div ref={listRef} role="listbox" aria-multiselectable={multiple} style={{ maxHeight: MAX_HEIGHT }} className="overflow-y-auto pb-1">
        {rows.length === 0 && <div className="px-3 py-2 text-xs text-gk-dim">{t('issues-picker-empty')}</div>}
        {rows.map((row, i) => {
          const selected = row.kind === 'none' ? noneSelected : row.kind === 'item' && chosen.has(row.id);
          return (
            <div
              key={row.kind === 'item' ? row.id : row.kind}
              data-index={i}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(row)}
              className={`flex cursor-default items-center gap-2 px-2 py-1.5 text-xs ${i === active ? 'bg-gk-hover text-gk-strong' : 'text-gk-text'}`}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {row.kind === 'create' ? <Plus size={13} className="text-gk-blue" /> : selected ? <Check size={13} className="text-gk-blue" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                {row.kind === 'none' ? (
                  <span className="text-gk-muted">{noneLabel}</span>
                ) : row.kind === 'create' ? (
                  t('issues-picker-create-label', row.text)
                ) : (
                  renderItem(row.item)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
