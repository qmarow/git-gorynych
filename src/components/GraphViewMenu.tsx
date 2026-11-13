import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, GripVertical, Lock, Plus, RotateCcw, Sparkles, Star, X } from 'lucide-react';
import { MAX_MAIN_BRANCHES, type MainBranches } from '../lib/mainBranches.ts';
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
  /** Главные ветки графа: список, цвет дорожки каждой (null — ветки нет в графе) и ветки для «Добавить ветку…» */
  main?: { state: MainBranches; colors: Record<string, string>; branches: readonly string[] } | null;
}

export default function GraphViewMenu({ x, y, view, onChange, onResetLayout, onClose, main = null }: GraphViewMenuProps) {
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

      {main && (
        <>
          <Separator />
          <MainBranchesSection {...main} />
        </>
      )}

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

const MAIN_DRAG_TYPE = 'application/x-gorynych-main-branch';

/**
 * Раздел «Главные ветки»: список в порядке дорожек (точка цвета дорожки, имя, «убрать»), перестановка перетаскиванием,
 * добавление из веток репозитория и возврат к автоматическому выбору.
 */
function MainBranchesSection({ state, colors, branches }: { state: MainBranches; colors: Record<string, string>; branches: readonly string[] }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [drop, setDrop] = useState<{ name: string; after: boolean } | null>(null);
  const dragged = useRef<string | null>(null);
  const full = state.names.length >= MAX_MAIN_BRANCHES;
  const q = query.trim().toLowerCase();
  const candidates = branches.filter((b) => !state.names.includes(b) && (!q || b.toLowerCase().includes(q)));

  const overRow = (name: string, e: DragEvent<HTMLDivElement>) => {
    if (!dragged.current || !e.dataTransfer.types.includes(MAIN_DRAG_TYPE)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    setDrop((cur) => (cur?.name === name && cur.after === after ? cur : { name, after }));
  };
  const dropRow = (name: string, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from = dragged.current;
    dragged.current = null;
    setDrop(null);
    if (from && drop) state.move(from, name, drop.after);
  };

  return (
    <div data-testid="main-branches-menu">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
        {t('main-branches')}
        {state.auto && (
          <span data-tip={t('main-branches-auto-hint')} className="rounded bg-gk-blue/15 px-1 py-px text-[9.5px] normal-case tracking-normal text-gk-blue">
            {t('auto')}
          </span>
        )}
      </div>
      {state.names.length === 0 && <div className="px-3 pb-1 text-[11.5px] text-gk-dim">{t('no-main-branches')}</div>}
      {state.names.map((name) => {
        const missing = state.missing[name];
        const color = colors[name];
        return (
          <div
            key={name}
            draggable
            data-main-branch={name}
            onDragStart={(e) => {
              dragged.current = name;
              e.dataTransfer.setData(MAIN_DRAG_TYPE, name);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              dragged.current = null;
              setDrop(null);
            }}
            onDragOver={(e) => overRow(name, e)}
            onDrop={(e) => dropRow(name, e)}
            data-tip={missing === 'absent' ? t('main-branch-absent') : missing === 'unloaded' ? t('main-branch-unloaded') : t('drag-to-reorder')}
            className={`group relative flex cursor-grab items-center gap-2 px-3 py-[4px] hover:bg-gk-hover ${missing ? 'text-gk-muted opacity-60' : 'text-gk-text'}`}
          >
            {drop?.name === name && <span className={`pointer-events-none absolute inset-x-2 h-0.5 rounded bg-gk-blue ${drop.after ? 'bottom-0' : 'top-0'}`} />}
            <GripVertical size={12} className="shrink-0 text-gk-dim" />
            <span style={color && !missing ? { backgroundColor: color } : undefined} className={`h-2.5 w-2.5 shrink-0 rounded-full ${color && !missing ? '' : 'border border-gk-dim'}`} />
            <span className="flex-1 truncate">{name}</span>
            <button
              aria-label={t('remove', name)}
              data-tip={t('remove-from-main-branches')}
              onClick={() => state.toggle(name)}
              className="shrink-0 rounded p-0.5 text-gk-dim opacity-0 hover:bg-gk-hover hover:text-gk-text focus:opacity-100 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {adding ? (
        <div className="px-3 pb-1 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setAdding(false);
              } else if (e.key === 'Enter' && candidates[0]) {
                state.toggle(candidates[0]);
                setAdding(false);
                setQuery('');
              }
            }}
            placeholder={t('find-branch')}
            className="w-full rounded border border-gk-border bg-gk-sink/30 px-2 py-1 text-[12.5px] text-gk-text outline-none focus:border-gk-blue"
          />
          <div className="mt-1 max-h-40 overflow-y-auto">
            {candidates.length === 0 && <div className="px-1 py-1 text-[11.5px] text-gk-dim">{t('nothing-found')}</div>}
            {candidates.slice(0, 50).map((b) => (
              <button
                key={b}
                role="menuitem"
                onClick={() => {
                  state.toggle(b);
                  setAdding(false);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-[3px] text-left text-gk-text hover:bg-gk-hover"
              >
                <Star size={11} className="shrink-0 text-gk-dim" />
                <span className="truncate">{b}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          role="menuitem"
          disabled={full}
          data-tip={full ? t('main-branches-limit', MAX_MAIN_BRANCHES) : undefined}
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2.5 px-3 py-[5px] text-left text-gk-text enabled:hover:bg-gk-hover disabled:cursor-default disabled:text-gk-muted"
        >
          <Plus size={14} className="shrink-0 text-gk-muted" />
          {t('add-main-branch')}
        </button>
      )}
      <button
        role="menuitem"
        disabled={state.auto}
        onClick={state.reset}
        className="flex w-full items-center gap-2.5 px-3 py-[5px] text-left text-gk-text enabled:hover:bg-gk-hover disabled:cursor-default disabled:text-gk-muted"
      >
        <Sparkles size={14} className="shrink-0 text-gk-muted" />
        {t('detect-main-branches-automatically')}
      </button>
    </div>
  );
}
