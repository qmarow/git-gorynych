/**
 * Новое в 2.0: панель свойств задачи — исполнители, метки, веха, срок, конфиденциальность, блокировка, автор и даты.
 * На этапе 4 только показывает значения; изменение — этап 5. Чего у сервера нет (`caps`), того нет и здесь.
 */
import { memo, type ReactNode } from 'react';
import { CalendarClock, ExternalLink, Flag, Lock, ShieldAlert } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import type { Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import { LabelChip, UserAvatar, userName } from './IssueBits.tsx';

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-gk-border py-2.5 last:border-b-0">
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-gk-dim uppercase">{title}</h3>
      <div className="text-xs text-gk-text">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => <span className="text-gk-dim">{children}</span>;

interface IssueMetaPanelProps {
  issue: Issue;
  caps: IssueCaps | null;
  onOpenWeb: (url: string) => void;
  compact?: boolean;
}

function IssueMetaPanel({ issue, caps, onOpenWeb, compact = false }: IssueMetaPanelProps) {
  return (
    <aside data-testid="issue-meta" className={compact ? 'grid grid-cols-2 gap-x-4 border-b border-gk-border px-4 pb-1' : 'flex flex-col px-4 py-1'}>
      <Section title={t('issues-meta-assignees')}>
        {issue.assignees.length ? (
          <ul className="flex flex-col gap-1.5">
            {issue.assignees.map((user) => (
              <li key={user.id || user.login} className="flex min-w-0 items-center gap-2">
                <UserAvatar user={user} size={18} tip={false} />
                <span className="truncate">{userName(user)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <None>{t('issues-meta-no-assignees')}</None>
        )}
      </Section>
      {caps?.labels !== false && (
        <Section title={t('issues-meta-labels')}>
          {issue.labels.length ? (
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <LabelChip key={label.id || label.name} label={label} />
              ))}
            </div>
          ) : (
            <None>{t('issues-meta-no-labels')}</None>
          )}
        </Section>
      )}
      {caps?.milestones !== false && (
        <Section title={t('issues-meta-milestone')}>
          {issue.milestone ? (
            <span className="flex items-center gap-1.5">
              <Flag size={13} className="shrink-0 text-gk-muted" />
              <span className="truncate">{issue.milestone.title}</span>
            </span>
          ) : (
            <None>{t('issues-meta-no-milestone')}</None>
          )}
        </Section>
      )}
      {caps?.dueDate && (
        <Section title={t('issues-meta-due')}>
          {issue.dueDate ? (
            <span className="flex items-center gap-1.5">
              <CalendarClock size={13} className="shrink-0 text-gk-muted" />
              {issue.dueDate}
            </span>
          ) : (
            <None>{t('issues-meta-no-due')}</None>
          )}
        </Section>
      )}
      {(issue.confidential || issue.locked) && (
        <Section title={t('issues-meta-access')}>
          <div className="flex flex-col gap-1">
            {issue.confidential && (
              <span className="flex items-center gap-1.5 text-gk-yellow">
                <ShieldAlert size={13} /> {t('issues-confidential')}
              </span>
            )}
            {issue.locked && (
              <span className="flex items-center gap-1.5">
                <Lock size={13} className="text-gk-muted" /> {t('issues-meta-locked')}
              </span>
            )}
          </div>
        </Section>
      )}
      <Section title={t('issues-meta-info')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          {issue.author && (
            <>
              <dt className="text-gk-dim">{t('issues-meta-author')}</dt>
              <dd className="truncate">{userName(issue.author)}</dd>
            </>
          )}
          <dt className="text-gk-dim">{t('issues-meta-created')}</dt>
          <dd data-tip={shortDate(issue.createdAt)}>{relativeTime(issue.createdAt)}</dd>
          <dt className="text-gk-dim">{t('issues-meta-updated')}</dt>
          <dd data-tip={shortDate(issue.updatedAt)}>{relativeTime(issue.updatedAt)}</dd>
          {issue.closedAt && (
            <>
              <dt className="text-gk-dim">{t('issues-meta-closed')}</dt>
              <dd data-tip={shortDate(issue.closedAt)}>{relativeTime(issue.closedAt)}</dd>
            </>
          )}
        </dl>
        <button type="button" onClick={() => onOpenWeb(issue.webUrl)} className="mt-2 flex items-center gap-1 text-gk-blue hover:underline">
          <ExternalLink size={12} />
          {t('issues-open-on-server')}
        </button>
      </Section>
    </aside>
  );
}

export default memo(IssueMetaPanel);
