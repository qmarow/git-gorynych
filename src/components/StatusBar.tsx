import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, FolderGit2, GitBranch, Loader2, Pencil, RefreshCw, SquareTerminal, WifiOff } from 'lucide-react';
import { openFolderLabel, openTerminalLabel } from '../lib/platform.ts';
import { fullDate, relativeTime } from '../lib/format.ts';
import { BACKGROUND_SEC, syncModeById, useSyncStatus } from '../lib/syncStatus.ts';
import { ACTIVE_STATUSES, StatusIcon, statusInfo } from './PipelineStatus.tsx';
import { Duration } from './ci/common.tsx';
import { t as tr, tj, locale } from '../i18n/index.ts';
import type { RepoData } from '../state/repoStore.ts';

/** Автообновление: слежение за папкой и фоновая проверка сервера (состояние из App) */
export interface SyncState {
  enabled: boolean;
  mode: string;
  fetching?: boolean;
  error?: string | null;
  lastFetch?: string | null;
  onToggle: () => void;
  onSettings?: () => void;
  onFetchNow: () => void;
}

/** Последний пайплайн текущей ветки (модель `PipelineRun` из gorynych-cicd) */
interface PipelineBrief {
  id: string | number;
  number?: string | number | null;
  status: string;
  name?: string | null;
  startedAt?: string | null;
}

interface StatusBarProps {
  repo: RepoData;
  onJumpToHead: () => void;
  sync?: SyncState | null;
  onOpenFolder?: (() => void) | null;
  onOpenTerminal?: (() => void) | null;
  onPathMenu?: ((x: number, y: number) => void) | null;
  pipeline?: PipelineBrief | null;
  pipelineLabel?: string | null;
  onOpenPipeline?: (pipeline: PipelineBrief) => void;
}

// Строка состояния: текущая ветка и активный коммит (HEAD). Клик — перейти к HEAD в графе.
export default function StatusBar({ repo, onJumpToHead, sync, onOpenFolder, onOpenTerminal, onPathMenu, pipeline = null, pipelineLabel = null, onOpenPipeline }: StatusBarProps) {
  const head = repo.commits.find((c) => c.hash === repo.headHash) ?? null;
  const branch = repo.localBranches.find((b) => b.name === repo.currentBranch) ?? null;

  return (
    <footer className="glass flex h-7 shrink-0 animate-fade-in items-center gap-3 border-t border-gk-border bg-gk-titlebar px-3 text-[11px] text-gk-muted">
      {/* Ветка */}
      {repo.currentBranch ? (
        <span className="flex shrink-0 items-center gap-1.5 text-gk-text" title={branch?.upstream ? `upstream: ${branch.upstream}` : tr('no-upstream')}>
          <GitBranch size={12} className="text-gk-green" />
          <span className="font-medium">{repo.currentBranch}</span>
          {branch?.upstream && <span className="text-gk-dim">→ {branch.upstream}</span>}
        </span>
      ) : repo.headHash ? (
        <span className="flex shrink-0 items-center gap-1.5 text-gk-yellow" title={tr('head-isnt-on-branch-new')}>
          <AlertTriangle size={12} />
          detached HEAD
        </span>
      ) : (
        <span className="shrink-0">{tr('no-commits')}</span>
      )}

      {branch && (branch.ahead! > 0 || branch.behind! > 0) && (
        <span className="flex shrink-0 items-center gap-2" title={tr('relative-to-upstream')}>
          {branch.ahead! > 0 && (
            <span className="flex items-center text-gk-green" title={tr('unpushed-commits', branch.ahead)}>
              <ArrowUp size={11} />
              {branch.ahead}
            </span>
          )}
          {branch.behind! > 0 && (
            <span className="flex items-center text-gk-blue" title={tr('will-arrive-on-pull-2', branch.behind)}>
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
              ? tr('go-to-head', head.hash, head.message, head.author.name, fullDate(head.date))
              : tr('go-to-head-2', repo.headHash)
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

      {/* Автообновление: слежение за папкой + фоновая проверка сервера */}
      {sync && <SyncControls sync={sync} hasRemotes={repo.remotes.length > 0} />}

      {/* Последний пайплайн текущей ветки */}
      {pipeline && (
        <button
          onClick={() => onOpenPipeline?.(pipeline)}
          data-testid="status-pipeline"
          data-status={pipeline.status}
          data-tip={tr('last-pipeline-of-branch-click', pipelineLabel ?? 'CI/CD', repo.currentBranch, pipeline.number ?? pipeline.id, statusInfo(pipeline.status).label, pipeline.name ? `\n${pipeline.name}` : '', pipeline.status === 'failed' ? tr('log-of-failed-job') : tr('details'))}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gk-hover hover:text-gk-text"
        >
          <StatusIcon status={pipeline.status} size={12} title="" />
          <span style={{ color: statusInfo(pipeline.status).color }}>{statusInfo(pipeline.status).label}</span>
          {ACTIVE_STATUSES.has(pipeline.status) && pipeline.startedAt && <Duration startedAt={pipeline.startedAt} running className="text-gk-dim" />}
        </button>
      )}

      {repo.operation && (
        <span className="shrink-0 rounded bg-gk-yellow/15 px-1.5 text-gk-yellow">{tj('in-progress-2', [repo.operation])}</span>
      )}
      {repo.wipFiles.length > 0 && (
        <span className="flex shrink-0 items-center gap-1" title={tr('uncommitted-changes-2')}>
          <Pencil size={11} />
          {repo.wipFiles.length}
        </span>
      )}
      {/* Путь к репозиторию: клик — открыть папку в Проводнике/Finder, рядом — терминал */}
      <span className="flex min-w-0 max-w-[45%] items-center gap-0.5">
        <button
          onClick={onOpenFolder ?? undefined}
          onContextMenu={(e) => {
            if (!onPathMenu) return;
            e.preventDefault();
            onPathMenu(e.clientX, e.clientY);
          }}
          disabled={!onOpenFolder}
          data-tip={tr('click-right-click-more-actions', repo.path, openFolderLabel().toLowerCase())}
          data-testid="status-path"
          className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 enabled:hover:bg-gk-hover enabled:hover:text-gk-text"
        >
          <FolderGit2 size={12} className="shrink-0" />
          <span className="truncate">{repo.path}</span>
        </button>
        {onOpenTerminal && (
          <button
            onClick={onOpenTerminal}
            aria-label={openTerminalLabel()}
            data-tip={openTerminalLabel()}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-gk-hover hover:text-gk-text"
          >
            <SquareTerminal size={12} />
          </button>
        )}
      </span>
    </footer>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const VIA: Record<string, string> = { api: 'GitLab API (ETag)', 'ls-remote': 'git ls-remote', 'api+ls-remote': tr('gitlab-api-and-git-ls') };

function SyncControls({ sync, hasRemotes }: { sync: SyncState; hasRemotes: boolean }) {
  const st = useSyncStatus();
  const mode = syncModeById(sync.mode);
  const retryIn = st.retryAt ? Math.max(1, Math.round((st.retryAt - Date.now()) / 1000)) : null;
  const autoTitle = sync.enabled
    ? [
        tr('auto-update-is-on-graph'),
        hasRemotes ? tr('server-is-checked-window-not', mode.hint, BACKGROUND_SEC) : null,
        st.at ? tr('last-check', clock(st.at), st.via ? tr('in-6', VIA[st.via] ?? st.via) : '', st.ms != null ? tr('ms-2', st.ms) : '') : null,
        tr('click-turn-off-right-click'),
      ]
        .filter(Boolean)
        .join('\n')
    : tr('auto-update-is-off-click');
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        onClick={sync.onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          sync.onSettings?.();
        }}
        title={autoTitle}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-gk-hover hover:text-gk-text"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${!sync.enabled ? 'bg-gk-dim' : st.error && hasRemotes ? 'bg-gk-yellow' : 'bg-gk-green'} ${
            sync.enabled && hasRemotes && !st.error && mode.sec <= 15 && st.focused ? 'animate-pulse' : ''
          }`}
        />
        {sync.enabled ? (hasRemotes ? tr('auto-2', mode.sec < 60 ? tr('s-2', mode.sec) : tr('min', mode.sec / 60)) : tr('auto')) : tr('auto-off')}
      </button>
      {hasRemotes && (
        <button
          onClick={sync.onFetchNow}
          disabled={sync.fetching}
          title={
            sync.enabled && st.error
              ? tr('server-is-unavailable-click-to', st.error, retryIn ? tr('next-attempt-in-s', retryIn) : '')
              : sync.error
                ? tr('last-fetch-failed', sync.error)
                : sync.lastFetch
                  ? tr('new-data-from-server-received', sync.lastFetch)
                  : tr('get-changes-from-server-fetch')
          }
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gk-hover hover:text-gk-text ${sync.error || (sync.enabled && st.error) ? 'text-gk-yellow' : ''}`}
        >
          {sync.fetching ? <Loader2 size={11} className="animate-spin" /> : sync.enabled && st.error ? <WifiOff size={11} /> : <RefreshCw size={11} />}
          {sync.fetching ? 'fetch…' : sync.enabled && st.error ? tr('no-connection') : (sync.lastFetch ?? 'fetch')}
        </button>
      )}
    </span>
  );
}
