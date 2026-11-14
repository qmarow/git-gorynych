/**
 * Новое в 2.0: задачи в форме коммита.
 *
 * - `useOpenIssues(repoPath, tracker)` — открытые задачи из `issuesStore` для подсказки `#`; если список этого
 *   репозитория ещё не загружался — одна тихая загрузка (`open`). Без сервера (`tracker === null`) — пусто, запросов нет.
 * - `CommitIssueBar` — если в имени текущей ветки стоит номер загруженной задачи (`branchMentions`), под сообщением
 *   строка «Задача #N: заголовок» и кнопки «Упомянуть» (`Refs #N`) и «Закрыть коммитом» (`Closes #N`) — отдельной
 *   строкой в конце описания; повтор строку не дублирует.
 */
import { memo, useEffect, useMemo } from 'react';
import { CircleDot } from 'lucide-react';
import { branchMentions, type Issue } from '../../lib/issues.ts';
import { issuesStore, useIssuesStore } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';

export interface IssueTracker {
  remote: string | null;
}

const EMPTY: Issue[] = [];
const requested = new Set<string>();

export function useOpenIssues(repoPath: string, tracker: IssueTracker | null | undefined): Issue[] {
  const items = useIssuesStore((s) => (tracker ? s.byRepo[repoPath]?.items : undefined)) ?? EMPTY;
  const known = useIssuesStore((s) => Boolean(s.byRepo[repoPath]));
  useEffect(() => {
    if (!tracker || known || requested.has(repoPath)) return;
    requested.add(repoPath);
    void issuesStore.getState().open(repoPath, tracker.remote);
  }, [repoPath, tracker, known]);
  return useMemo(() => items.filter((issue) => issue.state === 'open'), [items]);
}

/** Задача текущей ветки: первая загруженная, чей номер стоит в имени ветки отдельным числом. */
export function branchIssue(branch: string | null | undefined, issues: readonly Issue[]): Issue | null {
  if (!branch) return null;
  const numbers = [...branch.matchAll(/\d+/g)].map((m) => Number(m[0]));
  for (const n of numbers) {
    const issue = issues.find((i) => i.number === n);
    if (issue && branchMentions(branch, n)) return issue;
  }
  return null;
}

/** Строка `Refs #N` / `Closes #N` в конце описания, если такой строки ещё нет. */
export function withIssueLine(description: string, line: string): string {
  if (description.split(/\r?\n/).some((l) => l.trim() === line)) return description;
  const body = description.replace(/\s+$/, '');
  return body ? `${body}\n\n${line}` : line;
}

interface CommitIssueBarProps {
  branch: string | null;
  issues: readonly Issue[];
  description: string;
  onDescription: (next: string) => void;
}

function CommitIssueBar({ branch, issues, description, onDescription }: CommitIssueBarProps) {
  const issue = useMemo(() => branchIssue(branch, issues), [branch, issues]);
  if (!issue) return null;
  const add = (line: string) => onDescription(withIssueLine(description, line));
  return (
    <div data-testid="commit-issue-bar" className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-gk-muted">
      <CircleDot size={12} className="shrink-0 text-gk-green" />
      <span className="min-w-0 flex-1 truncate" data-tip={issue.title} data-tip-overflow="">
        {t('issues-commit-issue', issue.number, issue.title)}
      </span>
      <button type="button" data-testid="commit-issue-refs" onClick={() => add(`Refs #${issue.number}`)} className="shrink-0 rounded px-1.5 py-0.5 text-gk-blue hover:bg-gk-blue/10">
        {t('issues-commit-mention')}
      </button>
      <button type="button" data-testid="commit-issue-closes" onClick={() => add(`Closes #${issue.number}`)} className="shrink-0 rounded px-1.5 py-0.5 text-gk-blue hover:bg-gk-blue/10">
        {t('issues-commit-close')}
      </button>
    </div>
  );
}

export default memo(CommitIssueBar);
