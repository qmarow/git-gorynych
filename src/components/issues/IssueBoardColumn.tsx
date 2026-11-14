/**
 * Новое в 2.0: колонка доски — 300 px, заголовок с цветной точкой метки и числом задач, своя вертикальная прокрутка.
 * Цель перетаскивания карточек (подсвечивается, пока над ней карточка); заголовок колонки-метки сам перетаскивается —
 * так меняется порядок колонок.
 */
import { memo, useState, type DragEvent } from 'react';
import { CheckCircle2, CircleDot } from 'lucide-react';
import type { BoardColumn } from '../../lib/issueBoard.ts';
import { DEFAULT_LABEL_COLOR } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import IssueCard, { ISSUE_DRAG_TYPE } from './IssueCard.tsx';

export const COLUMN_DRAG_TYPE = 'application/x-gorynych-board-column';

interface IssueBoardColumnProps {
  column: BoardColumn;
  color: string | null;
  active: number | null;
  editable: boolean;
  pending: Record<number, number>;
  onOpen: (number: number) => void;
  onFocusCard: (number: number) => void;
  onDropIssue: (number: number, to: BoardColumn['id']) => void;
  /** Перестановка колонок-меток: имя перетаскиваемой и колонка, перед которой встать. */
  onDropColumn?: (name: string, before: string) => void;
}

const hasType = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type);

function IssueBoardColumn({ column, color, active, editable, pending, onOpen, onFocusCard, onDropIssue, onDropColumn }: IssueBoardColumnProps) {
  const [over, setOver] = useState(false);
  const title = column.id === 'open' ? t('issues-state-open') : column.id === 'closed' ? t('issues-state-closed') : column.label;
  return (
    <section
      data-testid="board-column"
      data-column={column.id}
      data-over={over || undefined}
      onDragOver={(e) => {
        if (hasType(e, ISSUE_DRAG_TYPE) && editable) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!over) setOver(true);
        } else if (hasType(e, COLUMN_DRAG_TYPE) && column.label && onDropColumn) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const issue = e.dataTransfer.getData(ISSUE_DRAG_TYPE);
        if (issue) {
          e.preventDefault();
          onDropIssue(Number(issue), column.id);
          return;
        }
        const name = e.dataTransfer.getData(COLUMN_DRAG_TYPE);
        if (name && column.label && onDropColumn) {
          e.preventDefault();
          onDropColumn(name, column.label);
        }
      }}
      className={`flex h-full w-[300px] shrink-0 flex-col rounded-lg border transition-colors ${over ? 'border-gk-blue/60 bg-gk-blue/5' : 'border-gk-border bg-gk-hover/30'}`}
    >
      <header
        draggable={Boolean(column.label && onDropColumn)}
        onDragStart={(e) => column.label && e.dataTransfer.setData(COLUMN_DRAG_TYPE, column.label)}
        className={`flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs font-semibold text-gk-strong ${column.label && onDropColumn ? 'cursor-grab' : ''}`}
      >
        {column.id === 'open' ? (
          <CircleDot size={13} className="text-gk-green" />
        ) : column.id === 'closed' ? (
          <CheckCircle2 size={13} className="text-gk-purple" />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? DEFAULT_LABEL_COLOR }} />
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span data-testid="board-column-count" className="rounded-full bg-gk-hover px-1.5 text-[11px] font-normal text-gk-muted">
          {column.items.length}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.items.map((issue) => (
          <IssueCard
            key={issue.number}
            issue={issue}
            columnLabel={column.label}
            active={issue.number === active}
            draggable={editable}
            pending={(pending[issue.number] ?? 0) > 0}
            onOpen={onOpen}
            onFocusCard={onFocusCard}
          />
        ))}
        {!column.items.length && <div className="py-6 text-center text-[11px] text-gk-dim">{t('issues-board-empty')}</div>}
      </div>
    </section>
  );
}

export default memo(IssueBoardColumn);
