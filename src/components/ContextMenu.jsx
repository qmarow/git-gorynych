import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { kb } from '../lib/platform.js';

/**
 * Контекстное меню.
 * items: [{ label, icon, onClick, disabled, danger, hint, submenu: [...] } | { separator: true } | { header: 'текст' }]
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
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
    const onDown = (e) => !ref.current?.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
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

  return (
    <div
      ref={ref}
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50"
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, onClose }) {
  const [openIndex, setOpenIndex] = useState(null);
  return (
    <div className="glass-strong min-w-60 max-w-96 origin-top-left animate-pop-in rounded-lg border border-gk-border bg-gk-panel-2 py-1 text-[13px]">
      {items.filter(Boolean).map((item, i) => {
        if (item.separator) return <div key={i} className="my-1 h-px bg-gk-border" />;
        if (item.header) {
          return (
            <div key={i} className="truncate px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
              {item.header}
            </div>
          );
        }
        return (
          <MenuRow
            key={i}
            item={item}
            open={openIndex === i}
            onHover={() => setOpenIndex(item.submenu ? i : null)}
            onClose={onClose}
          />
        );
      })}
    </div>
  );
}

function MenuRow({ item, open, onHover, onClose }) {
  const rowRef = useRef(null);
  const [side, setSide] = useState('right');
  const Icon = item.icon;

  useLayoutEffect(() => {
    if (!open || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setSide(rect.right + 260 > window.innerWidth ? 'left' : 'right');
  }, [open]);

  const activate = () => {
    if (item.disabled || item.submenu) return;
    onClose();
    item.onClick?.();
  };

  return (
    <div ref={rowRef} className="relative" onMouseEnter={onHover}>
      <button
        disabled={item.disabled}
        onClick={activate}
        title={item.title}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left enabled:hover:bg-gk-hover disabled:opacity-40 ${
          item.danger ? 'text-gk-red' : 'text-gk-text'
        } ${open ? 'bg-gk-hover' : ''}`}
      >
        <span className="flex w-4 shrink-0 justify-center">
          {Icon && <Icon size={14} className={item.danger ? 'text-gk-red' : 'text-gk-muted'} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && <span className="shrink-0 pl-3 text-[11px] text-gk-dim">{kb(item.hint)}</span>}
        {item.submenu && <ChevronRight size={13} className="shrink-0 text-gk-dim" />}
      </button>
      {open && item.submenu && !item.disabled && (
        <div className={`absolute top-[-5px] ${side === 'right' ? 'left-full' : 'right-full'}`}>
          <MenuList items={item.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
