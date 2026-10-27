import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ширина, которая запоминается между запусками (localStorage).
 * null — «по умолчанию» (например, авто-ширина графа).
 */
export function useStoredWidth(key, fallback, min, max) {
  // Задавал ли пользователь ширину сам (иначе можно подобрать её по содержимому)
  const [stored, setStored] = useState(() => {
    try {
      const raw = localStorage.getItem(`width:${key}`);
      return raw !== null && raw !== 'auto';
    } catch {
      return false;
    }
  });
  const [width, setWidthState] = useState(() => {
    try {
      const raw = localStorage.getItem(`width:${key}`);
      if (raw === null || raw === 'auto') return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    } catch {
      return fallback;
    }
  });

  const setWidth = useCallback(
    (value) => {
      const next = value === null ? fallback : Math.round(Math.min(max, Math.max(min, value)));
      setWidthState(next);
      setStored(value !== null);
      return next;
    },
    [fallback, min, max],
  );

  const persist = useCallback(
    (value) => {
      try {
        localStorage.setItem(`width:${key}`, value === null ? 'auto' : String(value));
      } catch {
        /* хранилище недоступно — ширина просто не запомнится */
      }
      setStored(value !== null);
    },
    [key],
  );

  return [width, setWidth, persist, stored];
}

/**
 * Ручка для перетаскивания границы.
 * direction = 1 — тянем правую границу (вправо = шире), -1 — левую (влево = шире).
 */
export function ResizeHandle({ width, onResize, onCommit, onReset, direction = 1, className = '', title }) {
  const drag = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const move = (e) => {
      const { startX, startWidth } = drag.current;
      drag.current.last = onResize(startWidth + (e.clientX - startX) * direction);
    };
    const up = () => {
      setActive(false);
      document.body.style.cursor = '';
      document.body.classList.remove('is-resizing');
      onCommit?.(drag.current.last ?? width);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [active, direction, onResize, onCommit, width]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title ?? 'Потяните, чтобы изменить ширину. Двойной клик — по умолчанию'}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        drag.current = { startX: e.clientX, startWidth: width, last: width };
        document.body.style.cursor = 'col-resize';
        document.body.classList.add('is-resizing');
        setActive(true);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset?.();
      }}
      className={`group/resize absolute top-0 z-20 flex h-full w-2 cursor-col-resize justify-center ${className}`}
    >
      <span
        className={`h-full w-[2px] rounded-full transition-colors duration-150 ${
          active ? 'bg-gk-blue' : 'bg-transparent group-hover/resize:bg-gk-blue/60'
        }`}
      />
    </div>
  );
}
