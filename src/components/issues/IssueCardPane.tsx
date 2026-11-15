/**
 * Новое в 2.0: правая часть раздела «Задачи» — форма новой задачи, карточка (`IssueDetail`), заглушка
 * загрузки, ошибка или «Выберите задачу». Та же карточка — в выезжающей панели доски.
 */
import type { ReactNode, Ref } from 'react';
import { CircleDot, GitBranch, SearchX } from 'lucide-react';
import type { Issue } from '../../lib/issues.ts';
import type { RepoIssues } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import IssueDetail, { type IssueDetailHandle } from './IssueDetail.tsx';
import IssueForm from './IssueForm.tsx';
import type { GitTarget } from './IssueGitPanel.tsx';
import { KeyList } from './IssueKeys.tsx';
import { EmptyState, Skeleton } from './IssueBits.tsx';

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

export interface CardPaneActions {
  onSelect: (number: number | null) => void;
  onOpenWeb: (url: string) => void;
  onCopy: (text: string, what: string) => void;
  notify: Notify;
  onCreateBranch?: (issue: Issue) => void;
  onLocateCommit?: (hash: string) => void;
  onCheckout?: (target: GitTarget) => void;
}

interface IssueCardPaneProps {
  repoPath: string;
  repo: RepoIssues;
  number: number | null;
  formOpen?: boolean;
  /** «Назад к списку» (узкий раздел) или закрытие панели доски. */
  onBack?: () => void;
  cardRef?: Ref<IssueDetailHandle>;
  actions: CardPaneActions;
}

export default function IssueCardPane({ repoPath, repo, number, formOpen = false, onBack, cardRef, actions }: IssueCardPaneProps) {
  const { onSelect, onOpenWeb, onCopy, notify, onCreateBranch, onLocateCommit, onCheckout } = actions;
  const issue = number != null ? (repo.items.find((i) => i.number === number) ?? repo.board?.items.find((i) => i.number === number) ?? repo.details[number]?.detail?.issue ?? null) : null;
  const entry = number != null ? repo.details[number] : undefined;
  if (formOpen) {
    return (
      <IssueForm
        key={repoPath}
        repoPath={repoPath}
        caps={repo.caps}
        meta={repo.meta}
        issues={repo.items}
        notify={notify}
        onCancel={() => onSelect(null)}
        createdAction={onCreateBranch && ((created) => ({ label: t('issues-create-branch'), onClick: () => onCreateBranch(created) }))}
      />
    );
  }
  if (issue) {
    return (
      <IssueDetail
        ref={cardRef}
        key={issue.number}
        repoPath={repoPath}
        issue={issue}
        entry={entry}
        caps={repo.caps}
        meta={repo.meta}
        issues={repo.items}
        onBack={onBack}
        onOpenIssue={onSelect}
        onOpenWeb={onOpenWeb}
        onCopy={onCopy}
        notify={notify}
        onLocate={(hash) => onLocateCommit?.(hash)}
        onCheckout={onCheckout}
        onCreateBranch={onCreateBranch && (() => onCreateBranch(issue))}
        extra={
          onCreateBranch && (
            <button type="button" data-testid="issue-create-branch" onClick={() => onCreateBranch(issue)} className="flex h-7 items-center gap-1.5 rounded border border-gk-border bg-gk-hover px-2.5 text-xs text-gk-text hover:bg-gk-fg/10">
              <GitBranch size={13} className="text-gk-green" />
              {t('issues-create-branch')}
            </button>
          )
        }
      />
    );
  }
  if (number != null && entry?.status === 'error') {
    return (
      <EmptyState state={entry.error?.code === 'NOT_FOUND' ? 'not-found' : 'card-error'} icon={SearchX} title={entry.error?.code === 'NOT_FOUND' ? t('issues-card-not-found') : `${t('issues-card-failed')}: ${entry.error?.message ?? ''}`}>
        <button type="button" onClick={() => onSelect(number)} className="text-xs text-gk-blue hover:underline">{t('issues-retry')}</button>
      </EmptyState>
    );
  }
  if (number != null) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden pt-3" aria-label={t('issues-card-loading')}>
        <Skeleton rows={4} />
      </div>
    );
  }
  return (
    <EmptyState icon={CircleDot} title={t('issues-no-selection')}>
      <KeyList />
    </EmptyState>
  );
}
