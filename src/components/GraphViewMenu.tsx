import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, GripVertical, Lock, RotateCcw } from 'lucide-react';
import { DATE_FORMAT_OPTIONS, DENSITY_OPTIONS, NODE_STYLE_OPTIONS, columnById, type Column, type GraphView, type GraphViewPatch, type ViewOption } from '../lib/graphView.ts';
import { t, tj } from '../i18n/index.ts';

/**
 * Меню настройки вида таблицы коммитов: правый клик по шапке или значок в её правом углу.
 * Переключатели применяются сразу, меню остаётся открытым — можно поменять несколько вещей подряд.
 */
interface GraphViewMenuProps {
  x: number;
  y: number;
  view: GraphView;
  onChange: (patch: GraphViewPatch) => void;
  onResetLayout: () => void;
  onClose: () => void;
}

export default function GraphViewMenu({ x, y, view, onChange, onResetLayout, onClose }: GraphViewMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Не даём меню вылезти за край окна
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const toggle = (id: Column['id']) =>
    onChange((v) => ({ hidden: v.hidden.includes(id) ? v.hidden.filter((h) => h !== id) : [...v.hidden, id] }));

  // Колонки — в текущем порядке, как в шапке
  const ordered = view.order.map(columnById).filter(Boolean) as Column[];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('commit-table-view')}
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      className="glass-strong fixed z-50 max-h-[calc(100vh-8px)] w-80 origin-top-left animate-pop-in overflow-y-auto rounded-lg border border-gk-border bg-gk-panel-2 py-1 text-[13px]"
    >
      <Header>{t('columns')}</Header>
      {ordered.map((col) => {
        const shown = col.locked || !view.hidden.includes(col.id);
        return (
          <button
            key={col.id}
            role="menuitemcheckbox"
            aria-checked={shown}
            disabled={col.locked}
            onClick={() => toggle(col.id)}
            data-tip={col.locked ? t('message-is-always-visible-and') : undefined}
            className="flex w-full items-center gap-2.5 px-3 py-[5px] text-left text-gk-text enabled:hover:bg-gk-hover disabled:cursor-default disabled:text-gk-muted"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                shown ? 'border-gk-blue bg-gk-blue/80 text-white' : 'border-gk-border bg-gk-sink/20'
              } ${col.locked ? 'opacity-60' : ''}`}
            >
              {shown && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="flex-1 truncate">{col.menuLabel ?? col.label}</span>
            {col.locked && <Lock size={11} className="shrink-0 text-gk-dim" />}
          </button>
        );
      })}
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-[11px] text-gk-dim">
        {tj('order-drag-column-header', [<GripVertical size={11} className="shrink-0" />])}</div>

      <Separator />
      <Header>{t('row-density')}</Header>
      <Segmented options={DENSITY_OPTIONS} value={view.density} onPick={(density) => onChange({ density })} />

      <Header>{t('date-and-time')}</Header>
      <Segmented options={DATE_FORMAT_OPTIONS} value={view.dateFormat} onPick={(dateFormat) => onChange({ dateFormat })} />

      <Header>{t('graph-nodes')}</Header>
      <Segmented options={NODE_STYLE_OPTIONS} value={view.nodeStyle} onPick={(nodeStyle) => onChange({ nodeStyle })} />

      <Separator />
      <button
        role="menuitem"
        onClick={() => {
          onResetLayout();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-gk-text hover:bg-gk-hover"
      >
        {tj('reset-column-widths-and-view', [<RotateCcw size={14} className="shrink-0 text-gk-muted" />])}</button>
    </div>
  );
}

const Header = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">{children}</div>
);
const Separator = () => <div className="my-1 h-px bg-gk-border" />;

/** Выбор одного варианта: строки-радиокнопки с подсказкой справа */
function Segmented<Id extends string>({ options, value, onPick }: { options: readonly ViewOption<Id>[]; value: Id; onPick: (id: Id) => void }) {
  return (
    <div role="radiogroup" className="pb-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            role="menuitemradio"
            aria-checked={on}
            onClick={() => onPick(o.id)}
            className={`flex w-full items-center gap-2.5 px-3 py-[5px] text-left hover:bg-gk-hover ${on ? 'text-gk-strong' : 'text-gk-text/85'}`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-gk-blue' : 'border-gk-border'}`}
            >
              {on && <span className="h-2 w-2 rounded-full bg-gk-blue" />}
            </span>
            <span className="flex-1 truncate">{o.label}</span>
            {o.hint && <span className="shrink-0 font-mono text-[11px] tabular-nums text-gk-dim">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
