import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { kb } from '../lib/platform.js';

/**
 * Подсказки для элементов с атрибутом data-tip (вместо системного title).
 * Системная подсказка не умеет переносить строки по ширине и на краю окна обрезается;
 * эта — до 280px шириной, с переносом и всегда целиком внутри окна (collision detection).
 * data-tip-overflow — показывать, только когда текст элемента не влез и обрезан многоточием.
 * Один слой на всё приложение: слушаем наведение на документе, а не на каждом элементе.
 */
const SHOW_DELAY = 450;
const GAP = 12;
const MARGIN = 8;

export default function TooltipLayer() {
  const [tip, setTip] = useState(null); // { text, x, y }
  const timer = useRef(null);
  const current = useRef(null);
  const box = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const over = (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
      if (el === current.current) return;
      hide();
      if (!el) return;
      const text = el.getAttribute('data-tip');
      if (!text) return;
      // data-tip-overflow: подсказка только если текст обрезан многоточием
      if (el.hasAttribute('data-tip-overflow') && el.scrollWidth <= el.clientWidth + 1) return;
      current.current = el;
      const { clientX: x, clientY: y } = e;
      timer.current = setTimeout(() => setTip({ text: kb(text), x, y, el, wide: el.hasAttribute('data-tip-wide') }), SHOW_DELAY);
    };
    const move = (e) => {
      // Пока подсказка не показана — она появится у последней позиции курсора
      if (current.current && !box.current) {
        clearTimeout(timer.current);
        const el = current.current;
        const { clientX: x, clientY: y } = e;
        timer.current = setTimeout(() => setTip({ text: kb(el.getAttribute('data-tip') ?? ''), x, y, el, wide: el.hasAttribute('data-tip-wide') }), SHOW_DELAY);
      }
    };
    const out = (e) => {
      if (!current.current) return;
      if (e.relatedTarget instanceof Node && current.current.contains(e.relatedTarget)) return;
      hide();
    };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseout', out, true);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseout', out, true);
      window.removeEventListener('mousedown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, { capture: true });
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Позиция: справа-снизу от курсора; не влезает — прижимаем к краю окна или переносим наверх
  useLayoutEffect(() => {
    if (!tip || !box.current) {
      setPos(null);
      return;
    }
    const r = box.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = tip.x + GAP;
    let top = tip.y + GAP + 6;
    if (left + r.width > vw - MARGIN) left = Math.max(MARGIN, vw - r.width - MARGIN);
    if (top + r.height > vh - MARGIN) top = Math.max(MARGIN, tip.y - r.height - GAP);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      className={`gk-tooltip ${tip.wide ? 'gk-tooltip-wide' : ''} pointer-events-none fixed z-[100] animate-fade-in rounded-md border border-gk-border bg-gk-panel-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-gk-text shadow-xl`}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
