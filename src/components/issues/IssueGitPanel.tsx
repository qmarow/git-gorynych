/**
 * Новое в 2.0: блок «Ветки и коммиты» панели свойств задачи — только из уже загруженного репозитория (`repoStore`),
 * без запросов к серверу.
 *
 * - Ветки: локальные и серверные, в имени которых номер задачи стоит отдельным числом (`branchMentions`). Клик — к
 *   ветке в графе (`onLocate`, раздел закрывается), значок — тот же checkout, что двойной клик по метке ветки.
 * - Коммиты: загруженные, в заголовке или описании которых `findIssueRefs` находит номер. До 10 последних, дальше «Ещё N».
 *   Клик — закрыть раздел и выбрать коммит в графе.
 * Ничего нет — «Веток и коммитов пока нет» и «Создать ветку». Списки — в `useMemo` по коммитам, веткам и номеру.
 */
import { memo, useMemo, useState } from 'react';
import { ArrowRightLeft, GitBranch, GitCommitHorizontal, Globe } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import { branchMentions, findIssueRefs } from '../../lib/issues.ts';
import { useRepoStore } from '../../state/repoStore.ts';
import { t } from '../../i18n/index.ts';

const MAX_COMMITS = 10;

export type GitTarget = { branch: string } | { remoteBranch: { name: string; fullName: string } };

interface IssueGitPanelProps {
  number: number;
  onLocate: (hash: string) => void;
  onCheckout?: (target: GitTarget) => void;
  onCreateBranch?: () => void;
}

function IssueGitPanel({ number, onLocate, onCheckout, onCreateBranch }: IssueGitPanelProps) {
  const commits = useRepoStore((s) => s.repo?.commits);
  const local = useRepoStore((s) => s.repo?.localBranches);
  const remotes = useRepoStore((s) => s.repo?.remotes);
  const current = useRepoStore((s) => s.repo?.currentBranch ?? null);
  const [all, setAll] = useState(false);

  const branches = useMemo(() => {
    const out: { key: string; name: string; hash: string; target: GitTarget; remote: boolean }[] = [];
    for (const b of local ?? []) if (branchMentions(b.name, number)) out.push({ key: `l:${b.name}`, name: b.name, hash: b.hash, target: { branch: b.name }, remote: false });
    for (const r of remotes ?? []) {
      for (const b of r.branches) {
        if (!branchMentions(b.name, number) || b.name.endsWith('/HEAD')) continue;
        // Серверная ветка, у которой есть локальная с тем же именем, не повторяется
        const short = b.fullName.slice(r.name.length + 1) || b.name;
        if ((local ?? []).some((l) => l.name === short)) continue;
        out.push({ key: `r:${b.fullName}`, name: b.fullName, hash: b.hash, target: { remoteBranch: { name: b.name, fullName: b.fullName } }, remote: true });
      }
    }
    return out;
  }, [local, remotes, number]);

  const found = useMemo(
    () => (commits ?? []).filter((c) => findIssueRefs(`${c.message}\n${c.description ?? ''}`).some((ref) => ref.number === number)),
    [commits, number],
  );
  const shown = all ? found : found.slice(0, MAX_COMMITS);

  return (
    <section data-testid="meta-git" className="border-b border-gk-border py-2.5 last:border-b-0">
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-gk-dim uppercase">{t('issues-git-title')}</h3>
      {!branches.length && !found.length ? (
        <div className="text-xs text-gk-dim">
          {t('issues-git-empty')}
          {onCreateBranch && (
            <button type="button" onClick={onCreateBranch} className="mt-1 block text-gk-blue hover:underline">
              {t('issues-create-branch')}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-xs">
          {branches.map((b) => (
            <div key={b.key} data-testid="git-branch" data-branch={b.name} className="group flex min-w-0 items-center gap-1.5">
              {b.remote ? <Globe size={12} className="shrink-0 text-gk-muted" /> : <GitBranch size={12} className="shrink-0 text-gk-green" />}
              <button type="button" onClick={() => onLocate(b.hash)} data-tip={b.name} data-tip-overflow className="min-w-0 flex-1 truncate text-left font-mono text-gk-text hover:text-gk-blue">
                {b.name}
              </button>
              {onCheckout && b.name !== current && (
                <button
                  type="button"
                  data-testid="git-checkout"
                  aria-label={t('issues-git-checkout')}
                  data-tip={t('issues-git-checkout')}
                  onClick={() => onCheckout(b.target)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gk-muted opacity-0 group-hover:opacity-100 hover:bg-gk-hover hover:text-gk-text focus:opacity-100"
                >
                  <ArrowRightLeft size={12} />
                </button>
              )}
            </div>
          ))}
          {shown.map((c) => (
            <button
              key={c.hash}
              type="button"
              data-testid="git-commit"
              data-hash={c.hash}
              onClick={() => onLocate(c.hash)}
              className="flex min-w-0 items-center gap-1.5 text-left hover:text-gk-blue"
            >
              <GitCommitHorizontal size={12} className="shrink-0 text-gk-muted" />
              <span className="shrink-0 font-mono text-gk-dim">{c.hash.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-gk-text">{c.message}</span>
              <span className="shrink-0 text-gk-dim" data-tip={shortDate(c.date)}>
                {relativeTime(c.date)}
              </span>
            </button>
          ))}
          {!all && found.length > MAX_COMMITS && (
            <button type="button" onClick={() => setAll(true)} className="self-start text-gk-blue hover:underline">
              {t('issues-git-more', found.length - MAX_COMMITS)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default memo(IssueGitPanel);
