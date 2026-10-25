import { useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  Copy,
  FileText,
  GitCommitHorizontal,
  History,
  List,
  ListTree,
  Loader2,
  Minus,
  PackageOpen,
  Plus,
  Trash2,
} from 'lucide-react';
import { FILE_STATUS, avatarColor, fullDate, initials, plural, relativeTime } from '../lib/format.js';

export default function CommitDetails({
  commit,
  files,
  repo,
  busy,
  activeFile,
  onOpenFile,
  onSelectCommit,
  onStage,
  onUnstage,
  onCommit,
  onRevertTo,
  onStashAction,
  onOpenConflict,
  activeConflict,
}) {
  return (
    <aside className="glass flex w-full min-w-0 flex-col border-l border-gk-border bg-gk-panel">
      {!commit ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gk-dim">Выберите коммит</div>
      ) : commit.isStash ? (
        <StashPanel
          key={commit.hash}
          stash={commit}
          details={files}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          onAction={onStashAction}
        />
      ) : commit.wip ? (
        <WipPanel
          key={repo.path}
          repo={repo}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          onStage={onStage}
          onUnstage={onUnstage}
          onCommit={onCommit}
          onOpenConflict={onOpenConflict}
          activeConflict={activeConflict}
        />
      ) : (
        <CommitPanel
          key={commit.hash}
          commit={commit}
          files={files}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          onSelectCommit={onSelectCommit}
          onRevertTo={onRevertTo}
          busy={busy}
        />
      )}
    </aside>
  );
}

/* ---------- Выбран обычный коммит ---------- */

function CommitPanel({ commit, files, activeFile, onOpenFile, onSelectCommit, onRevertTo, busy }) {
  const [treeView, setTreeView] = useState(false);
  const list = Array.isArray(files) ? files : [];
  const counts = list.reduce((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        <GitCommitHorizontal size={14} />
        <span>commit:</span>
        <span className="select-text font-mono text-gk-text">{commit.hash.slice(0, 7)}</span>
        <button
          title="Копировать SHA"
          onClick={() => navigator.clipboard?.writeText(commit.hash)}
          className="ml-auto rounded p-1 hover:bg-gk-hover hover:text-gk-text"
        >
          <Copy size={13} />
        </button>
      </div>

      <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-b border-gk-border p-3">
        <div>
          <h2 className="select-text text-[14px] font-semibold leading-snug text-white">{commit.message}</h2>
          {commit.description && (
            <p className="mt-1.5 select-text whitespace-pre-wrap text-xs leading-relaxed text-gk-muted">
              {commit.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <Avatar name={commit.author.name} size={30} />
          <div className="min-w-0 text-xs">
            <div className="truncate font-medium text-gk-text" title={commit.author.email}>
              {commit.author.name}
            </div>
            <div className="text-gk-muted">authored {fullDate(commit.date)}</div>
          </div>
        </div>

        {commit.parents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gk-muted">
            <span>parent{commit.parents.length > 1 ? 's' : ''}:</span>
            {commit.parents.map((p) => (
              <button key={p} onClick={() => onSelectCommit(p)} className="font-mono text-gk-blue hover:underline">
                {p.slice(0, 7)}
              </button>
            ))}
          </div>
        )}

        {onRevertTo && (
          <button
            onClick={() => onRevertTo(commit)}
            disabled={busy || commit.isHead}
            title={
              commit.isHead
                ? 'Это текущий коммит'
                : 'Создать новый коммит, который вернёт все файлы к состоянию этого коммита. История не переписывается.'
            }
            className="flex w-full items-center justify-center gap-2 rounded-md bg-white/[0.05] py-1.5 text-xs text-gk-text ring-1 ring-gk-border transition hover:bg-gk-yellow/10 hover:text-gk-yellow hover:ring-gk-yellow/40 disabled:opacity-40 disabled:hover:bg-white/[0.05] disabled:hover:text-gk-text disabled:hover:ring-gk-border"
          >
            <History size={13} />
            Вернуть проект к этому коммиту…
          </button>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs">
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} className="flex items-center gap-1 text-gk-muted">
            <StatusBadge status={status} />
            {n}
          </span>
        ))}
        {commit.parents.length > 1 && <span className="text-[11px] text-gk-dim">vs 1-й родитель</span>}
        <div className="ml-auto flex overflow-hidden rounded ring-1 ring-gk-border">
          <ViewToggle active={!treeView} onClick={() => setTreeView(false)} icon={List} title="Path" />
          <ViewToggle active={treeView} onClick={() => setTreeView(true)} icon={ListTree} title="Tree" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files === undefined && <FilesSkeleton />}
        {files?.error && <div className="px-3 py-2 text-xs text-gk-red">{files.error}</div>}
        {Array.isArray(files) && files.length === 0 && (
          <div className="px-3 py-2 text-xs italic text-gk-dim">Нет изменённых файлов</div>
        )}
        {list.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            tree={treeView}
            active={activeFile?.kind === 'commit' && activeFile.path === file.path}
            onClick={() => onOpenFile(file, 'commit', list)}
          >
            {file.additions !== null ? (
              <span className="ml-auto shrink-0 font-mono text-[11px]">
                <span className="text-gk-green">+{file.additions}</span>{' '}
                <span className="text-gk-red">-{file.deletions}</span>
              </span>
            ) : (
              <span className="ml-auto shrink-0 text-[11px] text-gk-dim">bin</span>
            )}
          </FileRow>
        ))}
      </div>
    </>
  );
}

/* ---------- Выбран stash ---------- */

function StashPanel({ stash, details, busy, activeFile, onOpenFile, onAction }) {
  const files = Array.isArray(details?.files) ? details.files : [];
  const message = stash.message.replace(/^(WIP on|On) [^:]+:\s*/, '');
  const branch = /^(?:WIP on|On) ([^:]+):/.exec(stash.message)?.[1];
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        <Archive size={14} className="text-gk-yellow" />
        <span className="font-mono text-gk-text">{stash.id}</span>
        {branch && <span className="truncate">на ветке {branch}</span>}
      </div>

      <div className="shrink-0 space-y-3 border-b border-gk-border p-3">
        <div>
          <h2 className="select-text text-[14px] font-semibold leading-snug text-white">{message || 'Без названия'}</h2>
          {stash.date && (
            <div className="mt-1 text-xs text-gk-muted" title={fullDate(stash.date)}>
              спрятано {relativeTime(stash.date)} · {fullDate(stash.date)}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <StashButton icon={ArrowDownToLine} disabled={busy} onClick={() => onAction('apply', stash)} title="Применить изменения, stash остаётся в списке">
            Apply
          </StashButton>
          <StashButton icon={PackageOpen} disabled={busy} onClick={() => onAction('pop', stash)} title="Применить и удалить из списка">
            Pop
          </StashButton>
          <StashButton icon={Trash2} danger disabled={busy} onClick={() => onAction('drop', stash)} title="Удалить stash (можно вернуть через Undo)">
            Drop
          </StashButton>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        {Array.isArray(details?.files) && (
          <>
            {files.length} {files.length === 1 ? 'файл' : 'файлов'}
            {files.some((f) => f.untracked) && <span className="text-gk-dim">· включая новые файлы</span>}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {details === undefined && <FilesSkeleton />}
        {details?.error && <div className="px-3 py-2 text-xs text-gk-red">{details.error}</div>}
        {files.map((file) => (
          <FileRow
            key={`${file.untracked ? 'u' : 't'}:${file.path}`}
            file={file}
            active={activeFile?.kind === 'stash' && activeFile.path === file.path}
            onClick={() => onOpenFile(file, 'stash', files)}
          >
            {file.untracked && <span className="ml-auto shrink-0 rounded bg-gk-green/10 px-1 text-[10px] text-gk-green">новый</span>}
            {file.additions !== null && (
              <span className={`${file.untracked ? '' : 'ml-auto'} shrink-0 font-mono text-[11px]`}>
                <span className="text-gk-green">+{file.additions}</span>{' '}
                <span className="text-gk-red">-{file.deletions}</span>
              </span>
            )}
          </FileRow>
        ))}
      </div>
    </>
  );
}

function StashButton({ icon: Icon, danger, children, ...props }) {
  return (
    <button
      {...props}
      className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs ring-1 ring-gk-border transition disabled:opacity-40 ${
        danger ? 'text-gk-red hover:bg-gk-red/10' : 'text-gk-text hover:bg-white/10'
      }`}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

// Мерцающая заглушка вместо «Загрузка…»
function FilesSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {[70, 55, 82, 46, 64].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="skeleton h-4 w-4 rounded-sm" />
          <span className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

/* ---------- Строка WIP: настоящий стейджинг и коммит ---------- */

function WipPanel({ repo, busy, activeFile, onOpenFile, onStage, onUnstage, onCommit, onOpenConflict, activeConflict }) {
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');

  // Конфликтные файлы — отдельной группой сверху, их нельзя просто застейджить
  const conflictFiles = repo.wipFiles.filter((f) => f.status === 'U');
  const unstagedFiles = repo.wipFiles.filter((f) => !f.staged && f.status !== 'U');
  const stagedFiles = repo.wipFiles.filter((f) => f.staged);
  const canCommit = !busy && stagedFiles.length > 0 && summary.trim().length > 0;

  const submit = async () => {
    if (!canCommit) return;
    const ok = await onCommit(summary, description);
    if (ok) {
      setSummary('');
      setDescription('');
    }
  };

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        <span className="truncate">
          {repo.wipFiles.length} {plural(repo.wipFiles.length, 'изменение', 'изменения', 'изменений')}
          {repo.currentBranch && (
            <>
              {' '}в <span className="font-medium text-gk-text">{repo.currentBranch}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {conflictFiles.length > 0 && (
          <div className="shrink-0 border-b border-gk-red/30 bg-gk-red/[0.06]">
            <div className="flex h-9 items-center justify-between px-3">
              <span className="text-xs font-medium text-gk-red">
                Конфликты <span className="text-gk-red/70">({conflictFiles.length})</span>
              </span>
              <button
                onClick={() => onOpenConflict?.(conflictFiles[0].path)}
                className="rounded bg-gk-red/15 px-2 py-1 text-[11px] font-medium text-gk-red hover:bg-gk-red/25"
              >
                Решить конфликты
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto pb-1">
              {conflictFiles.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  active={activeConflict === file.path}
                  onClick={() => onOpenConflict?.(file.path)}
                >
                  <span className="ml-auto shrink-0 text-[11px] text-gk-red/80 group-hover:underline">решить →</span>
                </FileRow>
              ))}
            </div>
          </div>
        )}
        <FileGroup
          title="Unstaged Files"
          kind="unstaged"
          files={unstagedFiles}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          actionLabel="Stage all changes"
          actionClass="bg-gk-green/15 text-gk-green hover:bg-gk-green/25"
          onAction={() => onStage('all')}
          onFileAction={(f) => onStage([f.path])}
          fileActionIcon={Plus}
          fileActionTitle="Stage"
        />
        <FileGroup
          title="Staged Files"
          kind="staged"
          files={stagedFiles}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          actionLabel="Unstage all"
          actionClass="bg-gk-red/15 text-gk-red hover:bg-gk-red/25"
          onAction={() => onUnstage('all')}
          onFileAction={(f) => onUnstage([f.path])}
          fileActionIcon={Minus}
          fileActionTitle="Unstage"
        />
      </div>

      <div className="space-y-2 border-t border-gk-border p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gk-muted">Commit</div>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && submit()}
          maxLength={200}
          placeholder="Summary"
          className="w-full rounded bg-gk-bg px-2.5 py-2 text-[13px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && submit()}
          rows={3}
          placeholder="Description"
          className="w-full resize-none rounded bg-gk-bg px-2.5 py-2 text-[13px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
        <button
          onClick={submit}
          disabled={!canCommit}
          title="Ctrl+Enter"
          className="w-full rounded py-2 text-[13px] font-semibold transition-colors enabled:bg-gk-green enabled:text-gk-ink enabled:shadow-lg enabled:shadow-gk-green/20 enabled:hover:brightness-110 disabled:bg-gk-hover disabled:text-gk-dim"
        >
          {stagedFiles.length === 0
            ? 'Stage files/changes to commit'
            : !summary.trim()
              ? 'Введите сообщение коммита'
              : `Commit changes to ${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''}`}
        </button>
      </div>
    </>
  );
}

function FileGroup({
  title,
  kind,
  files,
  busy,
  activeFile,
  onOpenFile,
  actionLabel,
  actionClass,
  onAction,
  onFileAction,
  fileActionIcon: Icon,
  fileActionTitle,
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-gk-border last:border-b-0">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-medium">
          {title} <span className="text-gk-muted">({files.length})</span>
        </span>
        {files.length > 0 && (
          <button
            disabled={busy}
            onClick={onAction}
            className={`rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${actionClass}`}
          >
            {actionLabel}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pb-1">
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            active={activeFile?.kind === kind && activeFile.path === file.path}
            onClick={() => onOpenFile(file, kind, files)}
            onDoubleClick={() => !busy && onFileAction(file)}
          >
            <button
              title={fileActionTitle}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onFileAction(file);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gk-muted hover:bg-gk-bg hover:text-gk-text group-hover:flex"
            >
              <Icon size={13} />
            </button>
          </FileRow>
        ))}
      </div>
    </div>
  );
}

/* ---------- Общие мелочи ---------- */

function FileRow({ file, tree, active, children, ...props }) {
  const parts = file.path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  return (
    <div
      {...props}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      className={`group flex h-7 cursor-pointer items-center gap-2 px-3 text-[13px] ${
        active ? 'bg-gk-blue/20' : 'hover:bg-gk-hover'
      }`}
      style={tree ? { paddingLeft: 12 + parts.length * 12 } : undefined}
    >
      <StatusBadge status={file.status} />
      <span className="min-w-0 truncate">
        {!tree && dir && <span className="text-gk-muted">{dir}/</span>}
        <span className="text-gk-text">{name}</span>
      </span>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const { color, label } = FILE_STATUS[status] ?? FILE_STATUS.M;
  return (
    <span
      title={label}
      style={{ color, backgroundColor: `${color}22` }}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
    >
      {status}
    </span>
  );
}

function ViewToggle({ active, icon: Icon, ...props }) {
  return (
    <button
      {...props}
      className={`flex h-6 w-7 items-center justify-center ${
        active ? 'bg-gk-hover text-gk-text' : 'text-gk-dim hover:text-gk-muted'
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function Avatar({ name, size }) {
  return (
    <span
      style={{ width: size, height: size, backgroundColor: avatarColor(name) }}
      className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
    >
      {initials(name)}
    </span>
  );
}
