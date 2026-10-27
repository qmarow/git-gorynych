import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Cloud, CloudOff, Laptop, LogIn, Tag } from 'lucide-react';

/**
 * Где живёт ветка: ноутбук — только у вас, облако — только на сервере,
 * ноутбук с облаком — локальная и серверная ветки на одном коммите (синхронизированы).
 */
export function RefKindIcon({ local, remote, tag, size = 12, className = '' }) {
  // Локальная и серверная на одном коммите — две маленькие иконки рядом (ноутбук + облако), как в GitKraken.
  // Раньше облако накладывалось на ноутбук, и при размере 12px это читалось как папка.
  const label = tag ? 'тег' : local && remote ? 'локальная и на сервере' : remote ? 'на сервере' : 'локальная';
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

export function refKindLabel(g) {
  if (g.tag) return 'тег';
  if (g.local && g.remote) return `локальная = ${g.remoteName ?? 'сервер'}`;
  if (g.remote) return 'на сервере';
  return 'только локальная';
}

/**
 * Поповер со всеми ветками и тегами коммита — открывается при наведении на «+N».
 * groups: [{ name, head, local, remote, tag, all: [ref], remoteName? }]
 * actions: { checkout(ref), deleteRemote(fullName), menu(ref, x, y) }
 */
export function RefsPopover({ anchor, groups, color, currentBranch, actions, onEnter, onLeave }) {
  const ref = useRef(null);
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
      {branches.length > 0 && <Header color={color}>Ветки на этом коммите · {branches.length}</Header>}
      {branches.map((g) => (
        <Row key={`b:${g.name}`} g={g} currentBranch={currentBranch} actions={actions} />
      ))}
      {tags.length > 0 && <Header color={color}>Теги · {tags.length}</Header>}
      {tags.map((g) => (
        <Row key={`t:${g.name}`} g={g} currentBranch={currentBranch} actions={actions} />
      ))}
      <div className="mt-1 border-t border-gk-border px-3 pb-0.5 pt-1.5 text-[10.5px] leading-snug text-gk-dim">
        <span className="inline-flex items-center gap-1">
          <Laptop size={10} /> у вас
        </span>
        <span className="mx-1.5">·</span>
        <span className="inline-flex items-center gap-1">
          <Cloud size={10} /> на сервере
        </span>
        <span className="mx-1.5">·</span>правый клик — действия
      </div>
    </div>,
    document.body,
  );
}

function Header({ children, color }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </div>
  );
}

function Row({ g, currentBranch, actions }) {
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
      title={canCheckout ? 'Двойной клик — checkout, правый клик — все действия' : 'Правый клик — действия'}
      className="group flex h-8 cursor-default items-center gap-2 px-3 hover:bg-gk-hover"
    >
      <RefKindIcon local={g.local} remote={g.remote} tag={g.tag} size={13} className={g.tag ? 'text-gk-yellow' : g.local ? 'text-gk-text' : 'text-gk-blue'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {isCurrent && <Check size={12} strokeWidth={3} className="shrink-0 text-gk-green" />}
          <span className={`truncate ${g.remote && !g.local ? 'text-gk-blue' : 'text-gk-text'}`}>{remoteRef && !localRef ? remoteRef.name : g.name}</span>
        </span>
        <span className="block truncate text-[10.5px] leading-tight text-gk-dim">
          {isCurrent ? 'текущая · ' : ''}
          {refKindLabel({ ...g, remoteName: remoteRef?.name })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {canCheckout && (
          <button
            title={localRef ? `Checkout ${localRef.name}` : `Checkout ${remoteRef?.name} (создаст локальную ветку)`}
            onClick={() => actions?.checkout?.(primary)}
            className="rounded p-1 text-gk-muted hover:bg-gk-fg/10 hover:text-gk-text"
          >
            <LogIn size={13} />
          </button>
        )}
        {remoteRef && (
          <button
            title={`Удалить ${remoteRef.name} с сервера…`}
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
  const timer = useRef(null);
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
