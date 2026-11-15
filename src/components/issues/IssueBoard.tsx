/**
 * Новое в 2.0: доска задач — «Открытые», колонки-метки (кнопка «Колонки» при `caps.labels`, не больше 8, порядок —
 * перетаскиванием заголовков; `localStorage['issues.board.v1:<путь>']`) и «Закрытые»; горизонтальная прокрутка.
 *
 * Данные — `issuesStore.loadBoard` (все открытые до 300 и 30 закрытых, с фильтрами панели); распределение —
 * `lib/issueBoard.ts::columnsFor`, правка при переносе — `patchForMove`. Перенос карточки (HTML5 drag and drop или
 * Shift+← / Shift+→) меняет задачу сразу, при ошибке она возвращается (`issuesStore.update`) и показывается уведомление.
 * Без `caps.edit` перенос выключен. Стрелки двигают фокус по карточкам, Enter открывает задачу в панели справа 560 px
 * (`renderDetail`); Esc и клик по доске её закрывают.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Columns3 } from 'lucide-react';
import { columnOf, columnsFor, MAX_LABEL_COLUMNS, patchForMove, readBoardColumns, writeBoardColumns, type BoardColumn } from '../../lib/issueBoard.ts';
import { queryKey } from '../../lib/issues.ts';
import { issuesStore, type RepoIssues } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueLabel_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssueBoardColumn from './IssueBoardColumn.tsx';
import { notifyWriteError } from './issueErrors.ts';
import IssuePicker from './IssuePicker.tsx';
import { ErrorBar, LabelChip, Skeleton } from './IssueBits.tsx';

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

interface IssueBoardProps {
  repoPath: string;
  repo: RepoIssues;
  refreshKey: number;
  notify: Notify;
  renderDetail: (number: number, onClose: () => void) => ReactNode;
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export default function IssueBoard({ repoPath, repo, refreshKey, notify, renderDetail }: IssueBoardProps) {
  const store = issuesStore.getState;
  const root = useRef<HTMLDivElement>(null);
  const columnsButton = useRef<HTMLButtonElement>(null);
  const [labelColumns, setLabelColumns] = useState(() => readBoardColumns(repoPath));
  const [picker, setPicker] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const editable = Boolean(repo.caps?.edit);
  const key = queryKey(repo.query);

  useEffect(() => setLabelColumns(readBoardColumns(repoPath)), [repoPath]);
  useEffect(() => {
    void store().loadBoard(repoPath);
  }, [repoPath, key, refreshKey, store]);

  const setColumns = (next: string[]) => {
    writeBoardColumns(repoPath, next);
    setLabelColumns(readBoardColumns(repoPath));
  };

  const items = repo.board?.items;
  const columns = useMemo(() => columnsFor(items ?? [], labelColumns), [items, labelColumns]);
  const colors = useMemo(() => new Map((repo.meta?.labels ?? []).map((l) => [l.name.toLowerCase(), l.color])), [repo.meta?.labels]);

  const move = useCallback(
    async (number: number, to: BoardColumn['id']) => {
      const cur = issuesStore.getState().byRepo[repoPath];
      const issue = cur?.board?.items.find((i) => i.number === number);
      if (!issue || !cur?.caps?.edit) return;
      const patch = patchForMove(issue, columnOf(issue, labelColumns), to, labelColumns, cur.meta?.labels ?? []);
      if (!patch) return;
      const res = await store().update(repoPath, number, patch);
      if (!res.ok) notifyWriteError(notify, repoPath, res.error, 'issues-update-failed', () => void move(number, to));
    },
    [repoPath, labelColumns, notify, store],
  );

  const open = useCallback(
    (number: number) => {
      setActive(number);
      setOpened(number);
      void store().select(repoPath, number);
    },
    [repoPath, store],
  );
  const close = () => {
    setOpened(null);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-active]')?.focus());
  };

  const position = (number: number | null): [number, number] | null => {
    if (number == null) return null;
    for (let c = 0; c < columns.length; c += 1) {
      const r = columns[c].items.findIndex((i) => i.number === number);
      if (r >= 0) return [c, r];
    }
    return null;
  };
  const focusCard = (number: number) => {
    setActive(number);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-testid="board-card"][data-number="${number}"]`)?.focus());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && opened != null) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (isTyping(e.target) || opened != null || e.ctrlKey || e.altKey || e.metaKey) return;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!arrows.includes(e.key) && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    const at = position(active);
    if (!at) {
      const first = columns.find((c) => c.items.length)?.items[0];
      if (first) focusCard(first.number);
      return;
    }
    const [c, r] = at;
    if (e.key === 'Enter') {
      open(columns[c].items[r].number);
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const target = columns[c + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (target && editable) void move(columns[c].items[r].number, target.id).then(() => focusCard(columns[c].items[r].number));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const list = columns[c].items;
      const next = list[Math.max(0, Math.min(list.length - 1, r + (e.key === 'ArrowUp' ? -1 : 1)))];
      if (next) focusCard(next.number);
      return;
    }
    for (let step = 1; step < columns.length; step += 1) {
      const col = columns[c + (e.key === 'ArrowLeft' ? -step : step)];
      if (!col) return;
      if (col.items.length) {
        focusCard(col.items[Math.min(r, col.items.length - 1)].number);
        return;
      }
    }
  };

  const board = repo.board;
  return (
    <div ref={root} data-testid="issue-board" onKeyDown={onKeyDown} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gk-border px-3 py-1.5 text-xs">
        {repo.caps?.labels !== false && (
          <button
            ref={columnsButton}
            type="button"
            data-testid="board-columns"
            onClick={() => setPicker((v) => !v)}
            className="flex items-center gap-1 rounded border border-gk-border px-2 py-1 text-gk-text hover:bg-gk-hover"
          >
            <Columns3 size={13} />
            {t('issues-board-columns')}
          </button>
        )}
        {board?.truncated && <span data-testid="board-truncated" className="text-gk-yellow">{t('issues-board-truncated')}</span>}
        {board?.status === 'loading' && board.items.length > 0 && <span className="text-gk-dim">{t('issues-card-loading')}</span>}
      </div>
      {board?.status === 'error' && board.error && <ErrorBar message={board.error.message} onRetry={() => void store().loadBoard(repoPath)} />}
      {!board || (board.status === 'loading' && !board.items.length) ? (
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <Skeleton rows={6} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" onClick={() => opened != null && close()}>
          {columns.map((column) => (
            <IssueBoardColumn
              key={column.id}
              column={column}
              color={column.label ? (colors.get(column.label.toLowerCase()) ?? null) : null}
              active={active}
              editable={editable}
              pending={repo.pending}
              onOpen={open}
              onFocusCard={setActive}
              onDropIssue={(number, to) => void move(number, to)}
              onDropColumn={(name, before) => {
                const rest = labelColumns.filter((n) => n !== name);
                const at = rest.indexOf(before);
                setColumns(at < 0 ? [...rest, name] : [...rest.slice(0, at), name, ...rest.slice(at)]);
              }}
            />
          ))}
        </div>
      )}
      {opened != null && (
        <div data-testid="board-detail" className="absolute inset-y-0 right-0 z-20 flex w-[560px] max-w-full flex-col border-l border-gk-border bg-gk-bg shadow-2xl animate-slide-in-left">
          {renderDetail(opened, close)}
        </div>
      )}
      {picker && columnsButton.current && (
        <IssuePicker<IssueLabel_Serialize>
          anchor={columnsButton.current}
          items={repo.meta?.labels ?? []}
          getId={(l) => l.name}
          selectedIds={labelColumns}
          multiple
          getSearchText={(l) => `${l.name} ${l.description ?? ''}`}
          renderItem={(l) => (
            <span className="flex">
              <LabelChip label={l} />
            </span>
          )}
          onToggle={(name) => {
            if (!name) return;
            if (labelColumns.includes(name)) setColumns(labelColumns.filter((n) => n !== name));
            else if (labelColumns.length < MAX_LABEL_COLUMNS) setColumns([...labelColumns, name]);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

