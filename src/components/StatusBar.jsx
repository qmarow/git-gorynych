import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, FolderGit2, GitBranch, Loader2, Pencil, RefreshCw, SquareTerminal, WifiOff } from 'lucide-react';
import { openFolderLabel, openTerminalLabel } from '../lib/platform.js';
import { fullDate, relativeTime } from '../lib/format.js';
import { BACKGROUND_SEC, syncModeById, useSyncStatus } from '../lib/syncStatus.js';

// Строка состояния: текущая ветка и активный коммит (HEAD). Клик — перейти к HEAD в графе.
export default function StatusBar({ repo, onJumpToHead, sync, onOpenFolder, onOpenTerminal, onPathMenu }) {
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
            <span className="flex items-center text-gk-green" title={`Неотправленных коммитов: ${branch.ahead}`}>
              <ArrowUp size={11} />
              {branch.ahead}
            </span>
          )}
          {branch.behind > 0 && (
            <span className="flex items-center text-gk-blue" title={`Придут при Pull: ${branch.behind}`}>
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

      {/* Автообновление: слежение за папкой + фоновая проверка сервера */}
      {sync && <SyncControls sync={sync} hasRemotes={repo.remotes.length > 0} />}

      {repo.operation && (
        <span className="shrink-0 rounded bg-gk-yellow/15 px-1.5 text-gk-yellow">{repo.operation} в процессе</span>
      )}
      {repo.wipFiles.length > 0 && (
        <span className="flex shrink-0 items-center gap-1" title="Незакоммиченные изменения">
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
          data-tip={`${repo.path}\nКлик — ${openFolderLabel().toLowerCase()}, правый клик — ещё действия`}
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

const clock = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const VIA = { api: 'GitLab API (ETag)', 'ls-remote': 'git ls-remote', 'api+ls-remote': 'GitLab API и git ls-remote' };

function SyncControls({ sync, hasRemotes }) {
  const st = useSyncStatus();
  const mode = syncModeById(sync.mode);
  const retryIn = st.retryAt ? Math.max(1, Math.round((st.retryAt - Date.now()) / 1000)) : null;
  const autoTitle = sync.enabled
    ? [
        'Автообновление включено: граф обновляется при любых изменениях в папке.',
        hasRemotes ? `Сервер проверяется ${mode.hint} (окно не в фокусе — раз в ${BACKGROUND_SEC} с); fetch — только если там что-то изменилось.` : null,
        st.at ? `Последняя проверка: ${clock(st.at)}${st.via ? ` через ${VIA[st.via] ?? st.via}` : ''}${st.ms != null ? `, ${st.ms} мс` : ''}.` : null,
        'Клик — выключить, правый клик — настройки.',
      ]
        .filter(Boolean)
        .join('\n')
    : 'Автообновление выключено. Клик — включить, правый клик — настройки.';
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
        {sync.enabled ? (hasRemotes ? `авто · ${mode.sec < 60 ? `${mode.sec} с` : `${mode.sec / 60} мин`}` : 'авто') : 'авто выкл'}
      </button>
      {hasRemotes && (
        <button
          onClick={sync.onFetchNow}
          disabled={sync.fetching}
          title={
            sync.enabled && st.error
              ? `Сервер недоступен: ${st.error}${retryIn ? `\nСледующая попытка через ${retryIn} с` : ''}\nНажмите, чтобы сделать fetch сейчас.`
              : sync.error
                ? `Последний fetch не удался: ${sync.error}`
                : sync.lastFetch
                  ? `Новые данные с сервера получены в ${sync.lastFetch}. Нажмите, чтобы сделать fetch сейчас.`
                  : 'Получить изменения с сервера (fetch)'
          }
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gk-hover hover:text-gk-text ${sync.error || (sync.enabled && st.error) ? 'text-gk-yellow' : ''}`}
        >
          {sync.fetching ? <Loader2 size={11} className="animate-spin" /> : sync.enabled && st.error ? <WifiOff size={11} /> : <RefreshCw size={11} />}
          {sync.fetching ? 'fetch…' : sync.enabled && st.error ? 'нет связи' : (sync.lastFetch ?? 'fetch')}
        </button>
      )}
    </span>
  );
}
