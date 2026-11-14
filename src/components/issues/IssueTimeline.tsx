/**
 * Новое в 2.0: лента задачи — описание, затем комментарии и события по времени (`mergeTimeline`: события одного автора
 * за минуту — одна строка). При `timelineTruncated` сверху строка «Показаны первые 300 записей» и «Открыть на сервере».
 */
import { memo, useMemo } from 'react';
import { mergeTimeline } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueComment_Serialize, TimelineItem_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import type { Issue } from '../../lib/issues.ts';
import IssueCommentItem, { type CommentActions } from './IssueCommentItem.tsx';
import IssueEventItem from './IssueEventItem.tsx';

interface IssueTimelineProps {
  issue: Issue;
  timeline: readonly TimelineItem_Serialize[] | null;
  truncated: boolean;
  loading: boolean;
  actions: CommentActions;
  onTaskToggle?: (index: number, checked: boolean) => void;
  descriptionRevision: number;
}

function IssueTimeline({ issue, timeline, truncated, loading, actions, onTaskToggle, descriptionRevision }: IssueTimelineProps) {
  const entries = useMemo(() => mergeTimeline(timeline ?? []), [timeline]);
  // Описание — как комментарий автора задачи
  const description: IssueComment_Serialize = useMemo(
    () => ({ id: `issue-${issue.number}`, body: issue.body, bodyHtml: issue.bodyHtml, author: issue.author, createdAt: issue.createdAt, updatedAt: null, canEdit: false, webUrl: issue.webUrl }),
    [issue.number, issue.body, issue.bodyHtml, issue.author, issue.createdAt, issue.webUrl],
  );
  const bodyPending = loading && !timeline && Boolean(issue.body.trim()) && !issue.bodyHtml;

  return (
    <ol data-testid="issue-timeline" className="flex flex-col">
      {bodyPending ? (
        <li className="flex gap-3 py-2" aria-label={t('issues-card-loading')}>
          <span className="skeleton h-7 w-7 shrink-0 rounded-full" />
          <span className="skeleton h-24 flex-1 rounded-md" />
        </li>
      ) : (
        <IssueCommentItem comment={description} description actions={actions} onTaskToggle={onTaskToggle} revision={descriptionRevision} />
      )}
      {truncated && (
        <li data-testid="timeline-truncated" className="my-1 flex items-center gap-2 rounded border border-gk-border bg-gk-hover/50 px-3 py-1.5 text-xs text-gk-muted">
          {t('issues-timeline-truncated')}
          <button type="button" onClick={() => actions.onOpenLink(issue.webUrl)} className="text-gk-blue hover:underline">
            {t('issues-open-on-server')}
          </button>
        </li>
      )}
      {entries.map((entry) =>
        entry.type === 'comment' ? (
          <IssueCommentItem key={`c-${entry.comment.id}`} comment={entry.comment} actions={actions} />
        ) : (
          <IssueEventItem key={`e-${entry.events[0].id}-${entry.createdAt}`} events={entry.events} actor={entry.actor} createdAt={entry.createdAt} onOpenLink={actions.onOpenLink} />
        ),
      )}
      {loading && !timeline && (
        <li className="flex flex-col gap-2 py-2" aria-hidden="true">
          <span className="skeleton ml-10 h-3 w-1/2 rounded" />
          <span className="skeleton ml-10 h-3 w-1/3 rounded" />
        </li>
      )}
    </ol>
  );
}

export default memo(IssueTimeline);
