/**
 * Новое в 2.0: строка списка задач, 56 px, две строки текста.
 *
 * Слева значок состояния; первая строка — заголовок (полужирный и синяя точка, если задача обновилась после
 * последнего просмотра) и до 3 меток с «+N»; вторая — `#номер · автор · обновлена …`, замок у конфиденциальной,
 * веха. Справа — аватары исполнителей и счётчик комментариев. Подсветка при наведении — только CSS `:hover`:
 * строка в `memo`, наведение ничего не перерисовывает.
 */
import { memo } from 'react';
import { Flag, Lock, MessageSquare } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import type { Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import { AvatarStack, LabelChip, StateIcon, userName } from './IssueBits.tsx';

export const ROW_HEIGHT = 56;
const MAX_LABELS = 3;

interface IssueRowProps {
  issue: Issue;
  top: number;
  selected: boolean;
  updated: boolean;
  domId: string;
  onClick: (number: number) => void;
  onContextMenu: (number: number, x: number, y: number) => void;
}

function IssueRow({ issue, top, selected, updated, domId, onClick, onContextMenu }: IssueRowProps) {
  const shown = issue.labels.slice(0, MAX_LABELS);
  const hidden = issue.labels.slice(MAX_LABELS);
  return (
    <div
      id={domId}
      role="option"
      aria-selected={selected}
      data-number={issue.number}
      style={{ top, height: ROW_HEIGHT }}
      onMouseDown={(e) => e.button === 0 && e.preventDefault()}
      onClick={() => onClick(issue.number)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(issue.number, e.clientX, e.clientY);
      }}
      className={`absolute inset-x-0 flex cursor-default items-center gap-3 border-b border-gk-border/60 px-3 ${
        selected ? 'bg-gk-hover' : 'hover:bg-gk-hover/60'
      }`}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-gk-blue" />}
      <StateIcon issue={issue} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-[13px] ${updated ? 'font-semibold text-gk-strong' : 'text-gk-text'}`}
            data-tip={issue.title}
            data-tip-overflow=""
          >
            {issue.title}
          </span>
          {updated && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gk-blue" data-tip={t('issues-updated-since')} />}
          {shown.map((label) => (
            <LabelChip key={label.id || label.name} label={label} />
          ))}
          {hidden.length > 0 && (
            <span className="shrink-0 text-[11px] text-gk-muted" data-tip={hidden.map((l) => l.name).join(', ')}>
              +{hidden.length}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-[11px] text-gk-muted">
          {issue.confidential && <Lock size={11} className="shrink-0 text-gk-yellow" data-tip={t('issues-confidential')} />}
          <span className="shrink-0 font-mono">#{issue.number}</span>
          {issue.author && <span className="min-w-0 truncate">· {userName(issue.author)}</span>}
          <span className="shrink-0" data-tip={shortDate(issue.updatedAt)}>
            · {t('issues-updated-ago', relativeTime(issue.updatedAt))}
          </span>
          {issue.milestone && (
            <span className="flex min-w-0 items-center gap-0.5 truncate" data-tip={issue.milestone.title}>
              · <Flag size={11} className="shrink-0" />
              <span className="truncate">{issue.milestone.title}</span>
            </span>
          )}
        </div>
      </div>
      <AvatarStack users={issue.assignees} />
      {issue.commentsCount > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-gk-muted" data-tip={t('issues-comments-count', issue.commentsCount)}>
          <MessageSquare size={12} />
          {issue.commentsCount}
        </span>
      )}
    </div>
  );
}

export default memo(IssueRow);
