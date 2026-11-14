/**
 * Новое в 2.0: карточка задачи этапа 3 — заголовок, состояние и исходный текст описания. Пока идёт запрос, показываются
 * данные из списка. Полная карточка (Markdown, лента, комментарии) — этап 4, она заменит этот файл.
 */
import { forwardRef } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import type { Issue } from '../../lib/issues.ts';
import type { DetailEntry } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import { LabelChip, StateIcon, stateTitle, userName } from './IssueBits.tsx';

interface IssuePreviewProps {
  issue: Issue;
  entry: DetailEntry | undefined;
  onBack?: () => void;
}

const IssuePreview = forwardRef<HTMLDivElement, IssuePreviewProps>(function IssuePreview({ issue: fromList, entry, onBack }, ref) {
  const issue = entry?.detail?.issue ?? fromList;
  return (
    <div ref={ref} tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 outline-none animate-fade-in">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 self-start text-xs text-gk-blue hover:underline">
          <ArrowLeft size={13} />
          {t('issues-back-to-list')}
        </button>
      )}
      <h1 className="text-xl leading-snug font-semibold text-gk-strong">
        {issue.title} <span className="font-normal text-gk-dim">#{issue.number}</span>
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gk-muted">
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${issue.state === 'open' ? 'bg-gk-green/15 text-gk-green' : 'bg-gk-purple/15 text-gk-purple'}`}>
          <StateIcon issue={issue} size={13} />
          {stateTitle(issue)}
        </span>
        {issue.author && <span>{userName(issue.author)}</span>}
        <span data-tip={shortDate(issue.createdAt)}>{relativeTime(issue.createdAt)}</span>
        {issue.labels.map((label) => (
          <LabelChip key={label.id || label.name} label={label} />
        ))}
      </div>
      {entry?.status === 'error' && (
        <div className="mt-4 flex items-center gap-2 rounded border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-xs">
          <AlertTriangle size={14} className="text-gk-red" />
          {t('issues-card-failed')}: {entry.error?.message}
        </div>
      )}
      <div className="mt-5 border-t border-gk-border pt-4">
        {issue.body.trim() ? (
          <pre className="font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-gk-text">{issue.body}</pre>
        ) : (
          <div className="text-sm text-gk-dim">{t('issues-no-description')}</div>
        )}
      </div>
      {entry?.status === 'loading' && !entry.detail && <div className="skeleton mt-6 h-24 rounded" aria-label={t('issues-card-loading')} />}
    </div>
  );
});

export default IssuePreview;
