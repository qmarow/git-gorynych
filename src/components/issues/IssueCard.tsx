/**
 * Новое в 2.0: карточка задачи на доске — заголовок до трёх строк, `#номер`, метки (кроме метки колонки), аватары
 * исполнителей, комментарии, срок (просроченный — красным). Перетаскивание — HTML5 (`application/x-gorynych-issue`),
 * только при праве правки. Фокус — `tabIndex`, клавиши обрабатывает доска.
 */
import { memo } from 'react';
import { CalendarClock, MessageSquare } from 'lucide-react';
import { isOverdue, localDate, type Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import { AvatarStack, LabelChip, StateIcon, commentsText, dueText } from './IssueBits.tsx';

export const ISSUE_DRAG_TYPE = 'application/x-gorynych-issue';

interface IssueCardProps {
  issue: Issue;
  /** Метка колонки — на карточке не повторяется. */
  columnLabel: string | null;
  active: boolean;
  draggable: boolean;
  pending: boolean;
  onOpen: (number: number) => void;
  onFocusCard: (number: number) => void;
}

function IssueCard({ issue, columnLabel, active, draggable, pending, onOpen, onFocusCard }: IssueCardProps) {
  const labels = issue.labels.filter((l) => !columnLabel || l.name.toLowerCase() !== columnLabel.toLowerCase());
  const overdue = isOverdue(issue, localDate(new Date()));
  return (
    <div
      role="button"
      tabIndex={active ? 0 : -1}
      data-testid="board-card"
      data-number={issue.number}
      data-active={active || undefined}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(ISSUE_DRAG_TYPE, String(issue.number));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onFocus={() => onFocusCard(issue.number)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(issue.number);
      }}
      className={`flex flex-col gap-1.5 rounded-md border bg-gk-panel p-2.5 text-left shadow-sm outline-none transition-colors ${
        active ? 'border-gk-blue/70' : 'border-gk-border hover:border-gk-fg/20'
      } ${pending ? 'opacity-60' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5">
          <StateIcon issue={issue} size={14} />
        </span>
        <span className="line-clamp-3 min-w-0 flex-1 text-[13px] leading-snug text-gk-text">{issue.title}</span>
      </div>
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <LabelChip key={label.id || label.name} label={label} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-gk-muted">
        <span className="font-mono">#{issue.number}</span>
        {issue.dueDate && (
          <span className={`flex items-center gap-0.5 ${overdue ? 'text-gk-red' : ''}`} data-tip={t('issues-meta-due')}>
            <CalendarClock size={11} />
            {dueText(issue.dueDate)}
          </span>
        )}
        <span className="flex-1" />
        {issue.commentsCount > 0 && (
          <span className="flex items-center gap-0.5" data-tip={commentsText(issue.commentsCount)} aria-label={commentsText(issue.commentsCount)}>
            <MessageSquare size={11} />
            {issue.commentsCount}
          </span>
        )}
        <AvatarStack users={issue.assignees} size={18} />
      </div>
    </div>
  );
}

export default memo(IssueCard);
