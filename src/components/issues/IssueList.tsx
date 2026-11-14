/**
 * Новое в 2.0: список задач — виртуализация, подгрузка страниц, прокрутка к выбору.
 *
 * Строки фиксированной высоты (`ROW_HEIGHT`), рисуются только видимые и по 10 сверху и снизу, с абсолютным
 * позиционированием — как окно прокрутки `CommitGraph`. Следующая страница — когда до конца осталось 10 строк,
 * `hasMore` и список не занят. Прокрутка запоминается по `scrollKey` (путь репозитория) на время работы окна:
 * возврат на вкладку восстанавливает её. При смене выбора список прокручивается минимально, чтобы строка была видна
 * целиком; смена данных (фоновое обновление) прокрутку не трогает.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isUpdatedSince, type Issue } from '../../lib/issues.ts';
import type { ListStatus } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import IssueRow, { ROW_HEIGHT } from './IssueRow.tsx';
import { Skeleton } from './IssueBits.tsx';

const OVERSCAN = 10;
const LOAD_AHEAD = 10;

/** Прокрутка списков по репозиториям: живёт, пока открыто окно. */
const scrollMemory = new Map<string, number>();

export const issueDomId = (number: number) => `issue-row-${number}`;

interface IssueListProps {
  scrollKey: string;
  items: readonly Issue[];
  selected: number | null;
  seenAt: Record<number, string>;
  hasMore: boolean;
  listStatus: ListStatus;
  /** Состояние фильтра: задачи другого состояния приглушены. */
  stateFilter?: 'open' | 'closed' | null;
  onLoadMore: () => void;
  onSelect: (number: number, mods: { ctrl: boolean; shift: boolean }) => void;
  /** Выделение для массовых действий. */
  checked?: ReadonlySet<number>;
  onToggle?: (number: number) => void;
  onContextMenu: (number: number, x: number, y: number) => void;
  listRef?: (el: HTMLDivElement | null) => void;
}

export default function IssueList({ scrollKey, items, selected, seenAt, hasMore, listStatus, stateFilter = null, onLoadMore, onSelect, onContextMenu, listRef, checked, onToggle }: IssueListProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(() => scrollMemory.get(scrollKey) ?? 0);
  const [height, setHeight] = useState(600);
  const frame = useRef(0);

  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el;
      listRef?.(el);
    },
    [listRef],
  );

  // Прокрутка вкладки — до первого кадра
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const saved = scrollMemory.get(scrollKey) ?? 0;
    el.scrollTop = saved;
    setScrollTop(el.scrollTop);
  }, [scrollKey]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    setHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(items.length - 1, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const lastVisible = Math.min(items.length - 1, Math.ceil((scrollTop + height) / ROW_HEIGHT));

  useEffect(() => {
    if (hasMore && listStatus === 'idle' && items.length > 0 && lastVisible >= items.length - LOAD_AHEAD) onLoadMore();
  }, [lastVisible, items.length, hasMore, listStatus, onLoadMore]);

  // Выбранная строка целиком в окне — минимальной прокруткой. Только при смене выбора: при открытии списка (возврат на
  // вкладку, повторное открытие раздела) остаётся запомненная прокрутка
  const shownSelection = useRef(selected);
  useLayoutEffect(() => {
    const el = box.current;
    if (shownSelection.current === selected) return;
    shownSelection.current = selected;
    if (!el || selected == null) return;
    const index = items.findIndex((issue) => issue.number === selected);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    // Зависимость — только выбор: обновление данных прокрутку не трогает
  }, [selected]);

  const rows = [];
  for (let i = first; i <= last; i++) {
    const issue = items[i];
    rows.push(
      <IssueRow
        key={issue.number}
        issue={issue}
        top={i * ROW_HEIGHT}
        selected={issue.number === selected}
        dimmed={stateFilter != null && issue.state !== stateFilter}
        checked={checked?.has(issue.number) ?? false}
        selecting={Boolean(checked?.size)}
        onToggle={onToggle}
        updated={isUpdatedSince(issue, seenAt[issue.number])}
        domId={issueDomId(issue.number)}
        onClick={onSelect}
        onContextMenu={onContextMenu}
      />,
    );
  }
  const loadingMore = listStatus === 'loadingMore';

  return (
    <div
      ref={setBox}
      role="listbox"
      tabIndex={0}
      aria-label={t('issues-title')}
      aria-activedescendant={selected != null && items.some((i) => i.number === selected) ? issueDomId(selected) : undefined}
      onScroll={(e) => {
        const value = e.currentTarget.scrollTop;
        scrollMemory.set(scrollKey, value);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setScrollTop(value));
      }}
      className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-gk-blue"
    >
      <div style={{ height: items.length * ROW_HEIGHT + (loadingMore ? 3 * ROW_HEIGHT : 0) }} className="relative">
        {rows}
        {loadingMore && (
          <div className="absolute inset-x-0" style={{ top: items.length * ROW_HEIGHT }}>
            <Skeleton rows={3} />
          </div>
        )}
      </div>
    </div>
  );
}
