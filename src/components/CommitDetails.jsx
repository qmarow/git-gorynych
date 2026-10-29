import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  Copy,
  FileSearch,
  FolderSync,
  FileText,
  GitCommitHorizontal,
  History,
  List,
  ListTree,
  Loader2,
  Minus,
  Plus,
  Square,
  SquareCheck,
  SquareMinus,
  Trash2,
} from 'lucide-react';
import { FILE_STATUS, avatarColor, fullDate, initials, plural, relativeTime } from '../lib/format.js';
import { describeStash } from '../lib/stashName.js';
import { GuardBanner } from './Guard.jsx';
import CommitForm from './CommitForm.jsx';
import { readable } from '../lib/scheme.js';

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
  onFileMenu,
  guardResult,
  guardState,
  onGuardOpen,
  onGuardToggleRepo,
  onGuardSettings,
  onStashRestore,
  onCommitSettings,
  searchHits = null, // поиск по графу: где в изменениях этого коммита найден текст
  searchQuery = '',
  onOpenSearchHit,
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
          onRestoreFiles={onStashRestore}
          onFileMenu={onFileMenu}
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
          onFileMenu={onFileMenu}
          guardResult={guardResult}
          guardState={guardState}
          onGuardOpen={onGuardOpen}
          onGuardToggleRepo={onGuardToggleRepo}
          onGuardSettings={onGuardSettings}
          onCommitSettings={onCommitSettings}
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
          onFileMenu={onFileMenu}
          searchHits={searchHits}
          searchQuery={searchQuery}
          onOpenSearchHit={onOpenSearchHit}
        />
      )}
    </aside>
  );
}

/* ---------- Выбран обычный коммит ---------- */

function CommitPanel({ commit, files, activeFile, onOpenFile, onSelectCommit, onRevertTo, busy, onFileMenu, searchHits, searchQuery, onOpenSearchHit }) {
  const [treeView, setTreeView] = useState(false);
  const list = Array.isArray(files) ? files : [];
  const hitByPath = new Map((searchHits?.files ?? []).map((f) => [f.path, f]));
  const counts = list.reduce((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        <GitCommitHorizontal size={14} />
        <span>коммит:</span>
        <span className="select-text font-mono text-gk-text">{commit.hash.slice(0, 7)}</span>
        {/* Восстановление файлов — компактной иконкой в шапке, а не большой кнопкой посреди панели */}
        {onRevertTo && (
          <button
            onClick={() => onRevertTo(commit)}
            disabled={busy || commit.isHead}
            aria-label="Восстановить файлы из коммита…"
            data-testid="restore-files"
            data-tip={
              commit.isHead
                ? 'Это текущий коммит — восстанавливать нечего'
                : 'Восстановить файлы из коммита… (checkout files)\nНовый коммит, в котором все файлы проекта — как в этом. История не переписывается, ветка не переключается.'
            }
            className="ml-auto rounded p-1 hover:bg-gk-yellow/10 hover:text-gk-yellow disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gk-muted"
          >
            <FolderSync size={13} />
          </button>
        )}
        <button
          data-tip="Скопировать хэш коммита (SHA)"
          aria-label="Скопировать хэш коммита"
          onClick={() => navigator.clipboard?.writeText(commit.hash)}
          className={`${onRevertTo ? '' : 'ml-auto '}rounded p-1 hover:bg-gk-hover hover:text-gk-text`}
        >
          <Copy size={13} />
        </button>
      </div>

      <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-b border-gk-border p-3">
        <div>
          <h2 className="select-text text-[14px] font-semibold leading-snug text-gk-strong">{commit.message}</h2>
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
            <div className="text-gk-muted">автор · {fullDate(commit.date)}</div>
          </div>
        </div>

        {commit.parents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gk-muted">
            <span>{commit.parents.length > 1 ? 'родители:' : 'родитель:'}</span>
            {commit.parents.map((p) => (
              <button key={p} onClick={() => onSelectCommit(p)} className="font-mono text-gk-blue hover:underline">
                {p.slice(0, 7)}
              </button>
            ))}
          </div>
        )}

      </div>

      {searchHits && <SearchHits hits={searchHits} query={searchQuery} onOpen={(f, line) => onOpenSearchHit?.(commit.hash, f, line)} />}

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
        {list.map((file) => {
          const hit = hitByPath.get(file.path);
          return (
            <FileRow
              key={file.path}
              file={file}
              tree={treeView}
              active={activeFile?.kind === 'commit' && activeFile.path === file.path}
              found={Boolean(hit)}
              data-found={hit ? 'true' : undefined}
              onClick={() => (hit && onOpenSearchHit ? onOpenSearchHit(commit.hash, hit) : onOpenFile(file, 'commit', list))}
              onContextMenu={(e) => {
                e.preventDefault();
                onFileMenu?.(file, 'commit', list, e.clientX, e.clientY);
              }}
            >
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {hit && (
                  <span data-tip={`«${searchQuery}» найдено здесь: ${hit.count}`} className="flex items-center gap-0.5 rounded-full bg-gk-yellow/20 px-1.5 text-[10.5px] font-medium text-gk-yellow">
                    <FileSearch size={10} />
                    {hit.count}
                  </span>
                )}
                <DiffStat file={file} />
              </span>
            </FileRow>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Поиск по графу: где в изменениях найден текст ---------- */

function SearchHits({ hits, query, onOpen }) {
  const [open, setOpen] = useState(true);
  const files = hits.files ?? [];
  const totalFiles = files.length + (hits.moreFiles ?? 0);
  return (
    <div data-testid="search-hits" className="max-h-[40%] shrink-0 overflow-y-auto border-b border-gk-border bg-gk-yellow/[0.04]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11.5px] text-gk-yellow">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileSearch size={12} />
        <span className="min-w-0 flex-1 truncate">
          «{query}» найдено: {hits.count} в {totalFiles} {plural(totalFiles, 'файле', 'файлах', 'файлах')}
        </span>
      </button>
      {open && (
        <div className="pb-1.5">
          {files.map((f) => (
            <div key={f.path} data-testid="search-hit-file" data-path={f.path}>
              <button
                onClick={() => onOpen(f)}
                className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-[12px] hover:bg-gk-hover"
                data-tip={`${f.path}\nОткрыть изменения на месте совпадения`}
              >
                <StatusBadge status={f.status} />
                <span className="min-w-0 flex-1 truncate font-medium text-gk-text">
                  {f.path.split('/').pop()}
                  {f.path.includes('/') && <span className="ml-1.5 font-normal text-gk-dim">{compactDir(f.path.split('/').slice(0, -1).join('/'))}</span>}
                </span>
                <span className="shrink-0 text-[10.5px] text-gk-yellow">{f.count}</span>
              </button>
              {f.lines.map((l, i) => (
                <button
                  key={i}
                  data-testid="search-hit-line"
                  onClick={() => onOpen(f, l)}
                  data-tip={l.t === '+' ? `Добавлено, строка ${l.n}` : `Удалено, было на строке ${l.o}`}
                  className="flex w-full items-baseline gap-1.5 py-px pl-7 pr-3 text-left font-mono text-[11px] leading-[18px] hover:bg-gk-hover"
                >
                  <span className={`w-9 shrink-0 text-right tabular-nums ${l.t === '+' ? 'text-gk-green' : 'text-gk-red'}`}>
                    {l.t}
                    {l.t === '+' ? l.n : l.o}
                  </span>
                  <span className="min-w-0 flex-1 truncate whitespace-pre text-gk-text/85">
                    <Snippet line={l} />
                  </span>
                </button>
              ))}
              {f.count > f.lines.length && <div className="py-px pl-[3.25rem] text-[10.5px] text-gk-dim">…и ещё {f.count - f.lines.length}</div>}
            </div>
          ))}
          {hits.moreFiles > 0 && <div className="px-3 py-0.5 text-[10.5px] text-gk-dim">…и ещё {hits.moreFiles} {plural(hits.moreFiles, 'файл', 'файла', 'файлов')}</div>}
        </div>
      )}
    </div>
  );
}

// Узкая панель: начало строки отрезаем так, чтобы совпадение было видно
function Snippet({ line }) {
  const first = line.ranges?.[0]?.[0] ?? 0;
  const lead = line.text.match(/^\s*/)[0].length;
  const start = first > 18 ? first - 14 : lead;
  const ranges = (line.ranges ?? []).map(([a, b]) => [a - start, b - start]).filter(([a]) => a >= 0);
  return (
    <>
      {(line.cut || start > lead) && <span className="text-gk-dim">…</span>}
      <Highlighted text={line.text.slice(start)} ranges={ranges} />
    </>
  );
}

function Highlighted({ text, ranges }) {
  const out = [];
  let at = 0;
  for (const [a, b] of ranges ?? []) {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={a} className="rounded-sm bg-gk-yellow/45 px-px text-gk-strong">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  out.push(text.slice(at));
  return out;
}

/* ---------- Выбран stash ---------- */

function StashPanel({ stash, details, busy, activeFile, onOpenFile, onAction, onRestoreFiles, onFileMenu }) {
  const files = Array.isArray(details?.files) ? details.files : [];
  const described = describeStash(stash);
  const message = described.title;
  const branch = described.branch;
  const keyOf = (f) => `${f.untracked ? 'u' : 't'}:${f.path}`;
  const [picked, setPicked] = useState(() => new Set());
  const chosen = files.filter((f) => picked.has(keyOf(f)));
  const all = files.length > 0 && chosen.length === files.length;
  const toggle = (f) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const k = keyOf(f);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const restore = async (list) => {
    const res = await onRestoreFiles?.(list, stash);
    if (res?.ok) setPicked(new Set());
  };

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        <Archive size={14} className="text-gk-yellow" />
        <span className="font-mono text-gk-text">{stash.id}</span>
        {branch && <span className="truncate">на ветке {branch}</span>}
      </div>

      <div className="shrink-0 space-y-2.5 border-b border-gk-border p-3">
        <div className="pb-0.5">
          <h2 className="select-text text-[14px] font-semibold leading-snug text-gk-strong">{message || 'Без названия'}</h2>
          {stash.date && (
            <div className="mt-1 text-xs text-gk-muted" title={fullDate(stash.date)}>
              спрятано {relativeTime(stash.date)} · {fullDate(stash.date)}
            </div>
          )}
        </div>
        {chosen.length > 0 && (
          <StashButton
            icon={ArchiveRestore}
            accent
            disabled={busy}
            onClick={() => restore(chosen)}
            title="Восстановить только выбранные файлы в рабочую папку. Stash остаётся в списке, индекс не меняется. Undo вернёт."
          >
            Применить выбранные ({chosen.length})
          </StashButton>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          <StashButton icon={ArrowDownToLine} disabled={busy} onClick={() => onAction('apply', stash)} title="Применить весь stash (Apply), он остаётся в списке. Чтобы взять отдельные файлы — отметьте их ниже.">
            {chosen.length > 0 ? 'Применить всё' : 'Применить'}
          </StashButton>
          <StashButton icon={ArchiveRestore} disabled={busy} onClick={() => onAction('pop', stash)} title="Применить весь stash и удалить его из списка (Pop)">
            Забрать
          </StashButton>
          <StashButton icon={Trash2} danger disabled={busy} onClick={() => onAction('drop', stash)} title="Удалить stash (Drop) — можно вернуть через Undo">
            Удалить
          </StashButton>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-xs text-gk-muted">
        {files.length > 0 && (
          <Checkbox
            checked={all}
            mixed={!all && chosen.length > 0}
            onChange={() => setPicked(all ? new Set() : new Set(files.map(keyOf)))}
            title={all ? 'Снять выбор' : 'Выбрать все файлы'}
          />
        )}
        {Array.isArray(details?.files) && (
          <span className="truncate">
            {chosen.length > 0 ? (
              <>
                выбрано <span className="text-gk-text">{chosen.length}</span> из {files.length}
              </>
            ) : (
              <>
                {files.length} {plural(files.length, 'файл', 'файла', 'файлов')}
                {files.some((f) => f.untracked) && <span className="text-gk-dim"> · включая новые</span>}
              </>
            )}
          </span>
        )}
        {chosen.length > 0 && (
          <button onClick={() => setPicked(new Set())} className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            сбросить
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {details === undefined && <FilesSkeleton />}
        {details?.error && <div className="px-3 py-2 text-xs text-gk-red">{details.error}</div>}
        {files.length > 0 && chosen.length === 0 && (
          <div className="px-3 pb-1 pt-0.5 text-[11px] leading-snug text-gk-dim">Отметьте файлы, чтобы восстановить только их, или наведите на файл.</div>
        )}
        {files.map((file) => (
          <FileRow
            key={keyOf(file)}
            file={file}
            active={activeFile?.kind === 'stash' && activeFile.path === file.path}
            selected={picked.has(keyOf(file))}
            onClick={() => onOpenFile(file, 'stash', files)}
            onContextMenu={(e) => {
              e.preventDefault();
              onFileMenu?.(file, 'stash', files, e.clientX, e.clientY, { stash, restore: () => restore([file]) });
            }}
            lead={<Checkbox checked={picked.has(keyOf(file))} onChange={() => toggle(file)} title="Выбрать для восстановления" />}
          >
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {file.untracked && <span className="shrink-0 rounded bg-gk-green/10 px-1 text-[10px] text-gk-green">новый</span>}
              <DiffStat file={file} />
              <button
                title="Восстановить этот файл в рабочую папку (Undo вернёт)"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  restore([file]);
                }}
                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gk-muted hover:bg-gk-bg hover:text-gk-green group-hover:flex"
              >
                <ArchiveRestore size={13} />
              </button>
            </span>
          </FileRow>
        ))}
      </div>
    </>
  );
}

function Checkbox({ checked, mixed, onChange, title }) {
  const Icon = checked ? SquareCheck : mixed ? SquareMinus : Square;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${checked || mixed ? 'text-gk-blue' : 'text-gk-dim hover:text-gk-text'}`}
    >
      <Icon size={14} />
    </button>
  );
}

function StashButton({ icon: Icon, danger, accent, children, ...props }) {
  return (
    <button
      {...props}
      className={`flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-xs ring-1 transition disabled:opacity-40 ${
        danger
          ? 'text-gk-red ring-gk-border hover:bg-gk-red/10'
          : accent
            ? 'bg-gk-green/15 font-medium text-gk-green ring-gk-green/40 hover:bg-gk-green/25'
            : 'text-gk-text ring-gk-border hover:bg-gk-fg/10'
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{children}</span>
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

function WipPanel({ repo, busy, activeFile, onOpenFile, onStage, onUnstage, onCommit, onOpenConflict, activeConflict, onFileMenu, guardResult, guardState, onGuardOpen, onGuardToggleRepo, onGuardSettings, onCommitSettings }) {

  // Конфликтные файлы — отдельной группой сверху, их нельзя просто застейджить
  const conflictFiles = repo.wipFiles.filter((f) => f.status === 'U');
  const unstagedFiles = repo.wipFiles.filter((f) => !f.staged && f.status !== 'U');
  const stagedFiles = repo.wipFiles.filter((f) => f.staged);
  // Файлы с находками Pre-commit Guard: путь → количество
  const guardFiles = new Map();
  for (const f of guardResult?.findings ?? []) guardFiles.set(f.file, (guardFiles.get(f.file) ?? 0) + 1);

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
          title="Неиндексированные файлы"
          kind="unstaged"
          files={unstagedFiles}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          actionLabel="Добавить все"
          actionClass="bg-gk-green/15 text-gk-green hover:bg-gk-green/25"
          onAction={() => onStage('all')}
          onFileAction={(f) => onStage([f.path])}
          fileActionIcon={Plus}
          fileActionTitle="Добавить в индекс (Stage)"
          onFileMenu={onFileMenu}
        />
        <FileGroup
          title="Индексированные файлы"
          kind="staged"
          files={stagedFiles}
          busy={busy}
          activeFile={activeFile}
          onOpenFile={onOpenFile}
          actionLabel="Убрать все"
          actionClass="bg-gk-red/15 text-gk-red hover:bg-gk-red/25"
          onAction={() => onUnstage('all')}
          onFileAction={(f) => onUnstage(f.oldPath ? [f.path, f.oldPath] : [f.path])}
          fileActionIcon={Minus}
          fileActionTitle="Убрать из индекса (Unstage)"
          onFileMenu={onFileMenu}
          flagged={guardFiles}
        />
      </div>

      <CommitForm
        repoPath={repo.path}
        branch={repo.currentBranch}
        stagedFiles={stagedFiles}
        busy={busy}
        onCommit={onCommit}
        onOpenSettings={onCommitSettings}
        banner={
          <GuardBanner result={stagedFiles.length ? guardResult : null} state={guardState ?? 'on'} onOpen={onGuardOpen} onToggleRepo={onGuardToggleRepo} onSettings={onGuardSettings} />
        }
      />
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
  onFileMenu,
  flagged,
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
            onContextMenu={(e) => {
              e.preventDefault();
              onFileMenu?.(file, kind, files, e.clientX, e.clientY);
            }}
          >
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {flagged?.get(file.path) && (
                <span title={`Pre-commit Guard: ${flagged.get(file.path)} — см. предупреждение над кнопкой Commit`} className="shrink-0">
                  <AlertTriangle size={12} className="text-gk-yellow" />
                </span>
              )}
              <DiffStat file={file} />
              <button
                title={fileActionTitle}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onFileAction(file);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gk-muted hover:bg-gk-bg hover:text-gk-text group-hover:flex"
              >
                <Icon size={13} />
              </button>
            </span>
          </FileRow>
        ))}
      </div>
    </div>
  );
}

/* ---------- Общие мелочи ---------- */

function FileRow({ file, tree, active, selected, found = false, lead, children, ...props }) {
  const parts = file.path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  const renamed = Boolean(file.oldPath && file.oldPath !== file.path);
  const title = renamed
    ? `${file.oldPath} → ${file.path}\n${file.moved ? 'Перенесён без изменений содержимого' : 'Перенесён и изменён'}`
    : file.path;
  return (
    <div
      {...props}
      title={title}
      className={`group flex h-7 cursor-pointer items-center gap-2 px-3 text-[13px] ${
        active ? 'bg-gk-blue/20' : selected ? 'bg-gk-blue/[0.08] hover:bg-gk-hover' : found ? 'bg-gk-yellow/[0.08] shadow-[inset_2px_0_0_var(--gk-yellow)] hover:bg-gk-yellow/15' : 'hover:bg-gk-hover'
      }`}
      style={tree ? { paddingLeft: 12 + parts.length * 12 } : undefined}
    >
      {lead}
      <StatusBadge status={file.status} />
      {renamed ? (
        <RenamedPath from={file.oldPath} to={file.path} moved={file.moved} tree={tree} />
      ) : (
        <FileName name={name} dir={tree ? '' : dir} />
      )}
      {children}
    </div>
  );
}

/*
 * Имя файла — всегда целиком и основным цветом; папка — рядом, приглушённо и обрезается с НАЧАЛА:
 * «Form.jsx  …/shared/components». Длинный путь больше не прячет имя и расширение.
 */
function FileName({ name, dir, muted }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className={`max-w-full shrink-0 truncate ${muted ? 'italic text-gk-muted' : 'text-gk-text'}`}>{name}</span>
      {dir && <DirPath dir={compactDir(dir)} />}
    </span>
  );
}

/**
 * Длинная папка — первая папка, «…» и две последние: «frontend/…/components/Profile».
 * Конец пути (где лежит файл) виден всегда; полный путь — в подсказке строки.
 */
export function compactDir(dir) {
  const parts = String(dir).split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`;
}

// Обрезание с начала: у контейнера direction rtl — многоточие встаёт слева, а сам путь
// внутри изолирован как LTR, поэтому «/» и стрелки остаются на своих местах
function DirPath({ dir, children }) {
  return (
    <span dir="rtl" className="min-w-0 flex-1 truncate text-left text-[11.5px] text-gk-dim">
      <span dir="ltr">{children ?? dir}</span>
    </span>
  );
}

// Перенос/переименование: новое имя — основным цветом; рядом — откуда («← старое имя» или «← старая/папка»)
function RenamedPath({ from, to, moved, tree }) {
  const split = (p) => {
    const parts = p.split('/');
    const name = parts.pop();
    return [parts.join('/'), name];
  };
  const [oldDir, oldName] = split(from);
  const [newDir, newName] = split(to);
  const source = oldDir === newDir ? oldName : oldName === newName ? `${oldDir || '/'}/` : from;
  return (
    <span className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${moved ? 'opacity-80' : ''}`}>
      <span className={`max-w-full shrink-0 truncate ${moved ? 'italic text-gk-muted' : 'text-gk-text'}`}>{newName}</span>
      <DirPath dir={source}>
        {!tree && newDir && newDir !== oldDir ? `${newDir}/ ` : ''}← <span className="line-through decoration-gk-dim/60">{source}</span>
      </DirPath>
    </span>
  );
}

/** Счётчики +X −Y; чистый перенос — метка moved; бинарный — bin */
export function DiffStat({ file }) {
  if (file.additions === undefined) return null;
  if (file.moved) {
    return (
      <span title="Файл только перенесён или переименован — содержимое не менялось" className="shrink-0 rounded bg-gk-blue/10 px-1 text-[10px] font-medium text-gk-blue/90">
        moved
      </span>
    );
  }
  if (file.additions === null) {
    return (
      <span title="Бинарный или слишком большой файл — строки не считаются" className="shrink-0 text-[11px] text-gk-dim">
        bin
      </span>
    );
  }
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className="text-gk-green">+{file.additions}</span> <span className="text-gk-red">-{file.deletions}</span>
    </span>
  );
}

function StatusBadge({ status }) {
  const { color: raw, label } = FILE_STATUS[status] ?? FILE_STATUS.M;
  const color = readable(raw);
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
