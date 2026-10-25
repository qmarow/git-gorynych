import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, FolderGit2, GitBranch, Pencil } from 'lucide-react';
import { fullDate, relativeTime } from '../lib/format.js';

// Строка состояния: текущая ветка и активный коммит (HEAD). Клик — перейти к HEAD в графе.
export default function StatusBar({ repo, onJumpToHead }) {
  const head = repo.commits.find((c) => c.hash === repo.headHash) ?? null;
  const branch = repo.localBranches.find((b) => b.name === repo.currentBranch) ?? null;

  return (
    <footer className="glass flex h-7 shrink-0 animate-fade-in items-center gap-3 border-t border-gk-border bg-gk-titlebar px-3 text-[11px] text-gk-muted">
      {/* Ветка */}
      {repo.currentBranch ? (
        <span className="flex shrink-0 items-center gap-1.5 text-gk-text" title={branch?.upstream ? `upstream: ${branch.upstream}` : 'Нет upstream'}>
          <GitBranch size={12} className="text-gk-green" />
          <span className="font-medium">{repo.currentBranch}</span>
          {branch?.upstream && <span className="text-gk-dim">→ {branch.upstream}</span>}
        </span>
      ) : repo.headHash ? (
        <span className="flex shrink-0 items-center gap-1.5 text-gk-yellow" title="HEAD не на ветке: новые коммиты не попадут ни в одну ветку">
          <AlertTriangle size={12} />
          detached HEAD
        </span>
      ) : (
        <span className="shrink-0">Нет коммитов</span>
      )}

      {branch && (branch.ahead > 0 || branch.behind > 0) && (
        <span className="flex shrink-0 items-center gap-2" title="Относительно upstream">
          {branch.ahead > 0 && (
            <span className="flex items-center text-gk-blue">
              <ArrowUp size={11} />
              {branch.ahead}
            </span>
          )}
          {branch.behind > 0 && (
            <span className="flex items-center text-gk-yellow">
              <ArrowDown size={11} />
              {branch.behind}
            </span>
          )}
        </span>
      )}

      {/* Активный коммит */}
      {repo.headHash && (
        <button
          onClick={onJumpToHead}
          title={
            head
              ? `Перейти к HEAD\n${head.hash}\n${head.message}\n${head.author.name} · ${fullDate(head.date)}`
              : `Перейти к HEAD\n${repo.headHash}`
          }
          className="group flex min-w-0 items-center gap-2 rounded px-2 py-0.5 transition-colors hover:bg-gk-hover hover:text-gk-text"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gk-green" />
          <span className="shrink-0 font-semibold tracking-wider text-gk-green">HEAD</span>
          <span className="shrink-0 font-mono text-gk-text">{repo.headHash.slice(0, 7)}</span>
          {head && (
            <>
              <span className="min-w-0 truncate text-gk-text/90">{head.message}</span>
              <span className="shrink-0 text-gk-dim">
                · {head.author.name} · {relativeTime(head.date)}
              </span>
            </>
          )}
          <Crosshair size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}

      <span className="flex-1" />

      {repo.operation && (
        <span className="shrink-0 rounded bg-gk-yellow/15 px-1.5 text-gk-yellow">{repo.operation} в процессе</span>
      )}
      {repo.wipFiles.length > 0 && (
        <span className="flex shrink-0 items-center gap-1" title="Незакоммиченные изменения">
          <Pencil size={11} />
          {repo.wipFiles.length}
        </span>
      )}
      <span className="flex min-w-0 max-w-[40%] items-center gap-1.5" title={repo.path}>
        <FolderGit2 size={12} className="shrink-0" />
        <span className="truncate">{repo.path}</span>
      </span>
    </footer>
  );
}
