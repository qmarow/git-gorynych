import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Cloud, CloudOff, Laptop, LogIn, Tag } from 'lucide-react';
import { t, tj } from '../i18n/index.ts';

/** Ссылка коммита из графа: локальная или серверная ветка, тег */
export interface RefItem {
  type: string;
  name: string;
  [key: string]: unknown;
}

/** Ветки и тег с одним именем на коммите: локальная и серверная сливаются в одну строку */
export interface RefGroup {
  name: string;
  head?: boolean;
  local?: boolean;
  remote?: boolean;
  tag?: boolean;
  all: RefItem[];
  remoteName?: string;
}

export interface RefActions {
  checkout?: (ref: RefItem) => void;
  deleteRemote?: (fullName: string) => void;
  menu?: (ref: RefItem, x: number, y: number) => void;
}

/**
 * Где живёт ветка: ноутбук — только у вас, облако — только на сервере,
 * ноутбук с облаком — локальная и серверная ветки на одном коммите (синхронизированы).
 */
export function RefKindIcon({ local, remote, tag, size = 12, className = '' }: { local?: boolean; remote?: boolean; tag?: boolean; size?: number; className?: string }) {
  // Локальная и серверная на одном коммите — две маленькие иконки рядом (ноутбук + облако), как в GitKraken.
  // Раньше облако накладывалось на ноутбук, и при размере 12px это читалось как папка.
  const label = tag ? t('tag-4') : local && remote ? t('local-and-on-server') : remote ? t('on-server-2') : t('local');
  const small = Math.round(size * 0.9);
  return (
    <span className={`inline-flex shrink-0 items-center gap-px ${className}`} aria-label={label} data-kind={tag ? 'tag' : local && remote ? 'both' : remote ? 'remote' : 'local'}>
      {tag ? (
        <Tag size={size} />
      ) : local && remote ? (
        <>
          <Laptop size={size} />
          <Cloud size={small} className="opacity-90" />
        </>
      ) : remote ? (
        <Cloud size={size} />
      ) : (
        <Laptop size={size} />
      )}
    </span>
  );
}

export function refKindLabel(g: Pick<RefGroup, 'tag' | 'local' | 'remote' | 'remoteName'>): string {
  if (g.tag) return t('tag-4');
  if (g.local && g.remote) return t('local-4', g.remoteName ?? t('server-3'));
  if (g.remote) return t('on-server-2');
  return t('local-only');
}

/**
 * Поповер со всеми ветками и тегами коммита — открывается при наведении на «+N».
 * groups: [{ name, head, local, remote, tag, all: [ref], remoteName? }]
 * actions: { checkout(ref), deleteRemote(fullName), menu(ref, x, y) }
 */
interface RefsPopoverProps {
  anchor: HTMLElement | null;
  groups: RefGroup[];
  color: string;
  currentBranch: string | null;
  actions?: RefActions;
  onEnter?: () => void;
  onLeave?: () => void;
}

export function RefsPopover({ anchor, groups, color, currentBranch, actions, onEnter, onLeave }: RefsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + 6;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, a.top - r.height - 6);
    setPos({ left, top });
  }, [anchor, groups.length]);

  const branches = groups.filter((g) => !g.tag);
  const tags = groups.filter((g) => g.tag);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ left: pos.left, top: pos.top }}
      className="glass-strong fixed z-50 w-[300px] animate-pop-in overflow-hidden rounded-lg border border-gk-border bg-gk-panel-2 py-1 text-[12.5px] shadow-2xl"
    >
      {branches.length > 0 && <Header color={color}>{tj('branches-on-this-commit', [branches.length])}</Header>}
      {branches.map((g) => (
        <Row key={`b:${g.name}`} g={g} currentBranch={currentBranch} actions={actions} />
      ))}
      {tags.length > 0 && <Header color={color}>{tj('tags-3', [tags.length])}</Header>}
      {tags.map((g) => (
        <Row key={`t:${g.name}`} g={g} currentBranch={currentBranch} actions={actions} />
      ))}
      <div className="mt-1 border-t border-gk-border px-3 pb-0.5 pt-1.5 text-[10.5px] leading-snug text-gk-dim">
        {tj('yours-on-server-right-click', [<span className="inline-flex items-center gap-1" />, <Laptop size={10} />, <span className="mx-1.5" />, <span className="inline-flex items-center gap-1" />, <Cloud size={10} />, <span className="mx-1.5" />])}</div>
    </div>,
    document.body,
  );
}

function Header({ children, color }: { children: ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </div>
  );
}

function Row({ g, currentBranch, actions }: { g: RefGroup; currentBranch: string | null; actions?: RefActions }) {
  const localRef = g.all.find((r) => r.type === 'local');
  const remoteRef = g.all.find((r) => r.type === 'remote');
  const primary = localRef ?? remoteRef ?? g.all[0];
  const isCurrent = Boolean(localRef && localRef.name === currentBranch);
  const canCheckout = !g.tag && !isCurrent;
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        actions?.menu?.(primary, e.clientX, e.clientY);
      }}
      onDoubleClick={() => canCheckout && actions?.checkout?.(primary)}
      title={canCheckout ? t('double-click-checkout-right-click') : t('right-click-actions')}
      className="group flex h-8 cursor-default items-center gap-2 px-3 hover:bg-gk-hover"
    >
      <RefKindIcon local={g.local} remote={g.remote} tag={g.tag} size={13} className={g.tag ? 'text-gk-yellow' : g.local ? 'text-gk-text' : 'text-gk-blue'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {isCurrent && <Check size={12} strokeWidth={3} className="shrink-0 text-gk-green" />}
          <span className={`truncate ${g.remote && !g.local ? 'text-gk-blue' : 'text-gk-text'}`}>{remoteRef && !localRef ? remoteRef.name : g.name}</span>
        </span>
        <span className="block truncate text-[10.5px] leading-tight text-gk-dim">
          {isCurrent ? t('current-3') : ''}
          {refKindLabel({ ...g, remoteName: remoteRef?.name })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {canCheckout && (
          <button
            title={localRef ? `Checkout ${localRef.name}` : t('checkout-creates-local-branch', remoteRef?.name)}
            onClick={() => actions?.checkout?.(primary)}
            className="rounded p-1 text-gk-muted hover:bg-gk-fg/10 hover:text-gk-text"
          >
            <LogIn size={13} />
          </button>
        )}
        {remoteRef && (
          <button
            title={t('delete-from-server-2', remoteRef.name)}
            onClick={() => actions?.deleteRemote?.(remoteRef.name)}
            className="rounded p-1 text-gk-muted hover:bg-gk-red/15 hover:text-gk-red"
          >
            <CloudOff size={13} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Наведение с задержкой: открыть через 120 мс, закрыть через 180 мс (успеваем перевести курсор в поповер) */
export function useHoverPopover() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    open,
    show: (delay = 120) => {
      clear();
      timer.current = setTimeout(() => setOpen(true), delay);
    },
    hide: (delay = 180) => {
      clear();
      timer.current = setTimeout(() => setOpen(false), delay);
    },
    keep: clear,
    close: () => {
      clear();
      setOpen(false);
    },
  };
}
