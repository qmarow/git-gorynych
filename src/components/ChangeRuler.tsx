/**
 * Карта изменений рядом с полосой прокрутки окна изменений (нового в 2.0, в 1.x её не было).
 *
 * Отметка — блок подряд идущих изменённых строк: зелёная — только добавления, красная — только удаления, жёлтая —
 * замена (и то и другое). Высота и место отметки — доля блока во всей высоте diff, поэтому видно, где в файле правки,
 * даже в режиме «Весь файл». Рамка — видимая сейчас часть. Клик по отметке — перейти к этому изменению (как F7),
 * клик по пустому месту — прокрутить туда.
 *
 * Блоки берутся из разметки diff: строка, с которой начинается блок, помечена `data-change`, каждая изменённая строка —
 * `data-chg` (`+`, `-` или `m`, если в Split слева удаление, а справа добавление). Так одинаково работают Unified и Split,
 * где строки переносятся и бывают разной высоты.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { t } from '../i18n/index.ts';

export interface ChangeBlock {
  /** Начало и конец блока в пикселях от верха содержимого */
  top: number;
  bottom: number;
  added: number;
  removed: number;
}

/** Блоки изменений в прокручиваемом `root`, в порядке сверху вниз (как их обходят F7 и Shift+F7). */
export function measureChanges(root: HTMLElement): ChangeBlock[] {
  const base = root.getBoundingClientRect().top - root.scrollTop;
  const blocks: ChangeBlock[] = [];
  for (const start of root.querySelectorAll<HTMLElement>('[data-change]')) {
    let added = 0;
    let removed = 0;
    let last: Element = start;
    for (let el: Element | null = start; el && el.hasAttribute('data-chg'); el = el.nextElementSibling) {
      // Новый блок начинается со своей метки: два блока подряд без строки контекста между ними не сливаются
      if (el !== start && el.hasAttribute('data-change')) break;
      const kind = el.getAttribute('data-chg');
      if (kind !== '-') added++;
      if (kind !== '+') removed++;
      last = el;
    }
    blocks.push({ top: start.getBoundingClientRect().top - base, bottom: last.getBoundingClientRect().bottom - base, added, removed });
  }
  return blocks;
}

const kindOf = (b: ChangeBlock): 'add' | 'del' | 'mod' => (b.removed === 0 ? 'add' : b.added === 0 ? 'del' : 'mod');
const COLORS = { add: 'bg-gk-green', del: 'bg-gk-red', mod: 'bg-gk-yellow' } as const;
const MIN_MARK = 3; // px: короткий блок в длинном файле всё равно виден и по нему можно попасть

interface Props {
  scrollRef: RefObject<HTMLElement | null>;
  /** Значения, с которыми меняется разметка diff (данные, Unified/Split, подсветка внутри строк): число их постоянно */
  deps: readonly unknown[];
  /** Текущее изменение навигации (−1 — нет) */
  current: number;
  onJump: (index: number) => void;
}

export default function ChangeRuler({ scrollRef, deps, current, onJump }: Props) {
  const [blocks, setBlocks] = useState<ChangeBlock[]>([]);
  const [box, setBox] = useState({ height: 1, client: 1, top: 0 });
  const rail = useRef<HTMLDivElement>(null);

  const remeasure = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    setBlocks(measureChanges(root));
    setBox({ height: Math.max(1, root.scrollHeight), client: root.clientHeight, top: root.scrollTop });
  }, [scrollRef]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(remeasure, [remeasure, ...deps]);

  // Размер окна и содержимого меняется без смены данных (ширина панели, перенос строк в Split, догрузка подсветки)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remeasure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    if (root.firstElementChild) observer.observe(root.firstElementChild);
    const onScroll = () => setBox((b) => (b.top === root.scrollTop ? b : { ...b, top: root.scrollTop }));
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, remeasure, ...deps]);

  if (!blocks.length) return null;
  const scale = (px: number) => `${(px / box.height) * 100}%`;
  const scrollable = box.height > box.client + 1;

  // Пустое место карты — прокрутить так, чтобы эта точка файла оказалась посередине
  const onRailClick = (e: MouseEvent<HTMLDivElement>) => {
    const root = scrollRef.current;
    const r = rail.current?.getBoundingClientRect();
    if (!root || !r || !scrollable) return;
    const y = ((e.clientY - r.top) / r.height) * box.height;
    root.scrollTo({ top: y - box.client / 2, behavior: 'smooth' });
  };

  return (
    <div
      ref={rail}
      onClick={onRailClick}
      data-testid="change-ruler"
      className="relative w-3 shrink-0 cursor-pointer border-l border-gk-border bg-gk-fg/[0.02]"
      aria-label={t('Карта изменений')}
    >
      {scrollable && (
        <div
          className="pointer-events-none absolute inset-x-0 rounded-sm bg-gk-fg/[0.07] ring-1 ring-inset ring-gk-fg/10"
          style={{ top: scale(box.top), height: scale(box.client) }}
        />
      )}
      {blocks.map((b, i) => (
        <button
          key={i}
          type="button"
          data-testid="change-mark"
          data-kind={kindOf(b)}
          data-tip={t('Изменение {0} из {1}: +{2} −{3}', i + 1, blocks.length, b.added, b.removed)}
          onClick={(e) => {
            e.stopPropagation();
            onJump(i);
          }}
          className={`absolute left-[2px] right-[2px] rounded-[1px] ${COLORS[kindOf(b)]} ${
            i === current ? 'opacity-100 shadow-[0_0_0_1.5px_var(--color-gk-text)]' : 'opacity-75 hover:opacity-100'
          }`}
          style={{ top: scale(b.top), height: `max(${MIN_MARK}px, ${scale(b.bottom - b.top)})` }}
        />
      ))}
    </div>
  );
}
