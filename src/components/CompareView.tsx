import { memo, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeftRight, CaseSensitive, ChevronDown, ChevronRight, FileDiff, FileText, FoldVertical, Folder, GitCompareArrows, Loader2, Regex, Search, UnfoldVertical, X } from 'lucide-react';
import { plural, relativeTime } from '../lib/format.ts';
import { detectLanguage, highlightHunks, highlightLines, layerLine } from '../lib/highlight.ts';
import { inlineHighlights } from '../lib/inlineDiff.ts';
import { isMod, kb } from '../lib/platform.ts';
import { StatusBadge } from './RebaseView.tsx';
import { UnifiedDiff } from './DiffView.tsx';
import { t, tj } from '../i18n/index.ts';
import type { ApiError, ApiResult } from '../platform/tauri.ts';
import type {
  ChangeSearch_Serialize,
  CommitFile_Serialize,
  Comparison_Serialize,
  FileDiff_Serialize,
  MatchFile_Serialize,
  MatchLine,
} from '../../crates/gorynych-tauri/bindings/commands.ts';

/** Поля, которые 1.x всегда заполняет (в bindings они `| null`) */
type Present<T> = { [K in keyof T]-?: NonNullable<T[K]> };
type Comparison = Present<Comparison_Serialize>;
type MatchFile = Present<MatchFile_Serialize>;
type ChangeSearch = Omit<ChangeSearch_Serialize, 'files'> & { files: MatchFile[] };

/** Файл сравнения; у найденного поиском, но не попавшего в список, есть только эти поля */
export type CompareFile = Pick<CommitFile_Serialize, 'path' | 'oldPath' | 'status' | 'additions' | 'deletions'>;

/** Куда открыть файл после поиска по содержимому (DiffView) */
export interface CompareSearchJump {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  changedOnly: boolean;
  line: { t: string; n: number | null; o: number | null } | null;
}

interface ContentQuery {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}

interface Found {
  loading: boolean;
  data: ChangeSearch | null;
  error: ApiError | null;
  key: string | null;
}

type ContentResult = MatchFile & { file: CompareFile };

interface DirGroup {
  dir: string;
  files: number;
  additions: number;
  deletions: number;
}

interface CompareApi {
  repo: {
    compare: (dir: string, params: { a: string; b: string }) => Promise<ApiResult<Comparison>>;
    compareSearch: (dir: string, params: { a: string; b: string } & ContentQuery) => Promise<ApiResult<ChangeSearch>>;
    fileDiff: (dir: string, params: Record<string, unknown>) => Promise<ApiResult<FileDiff_Serialize>>;
  };
}

const api = window.api as unknown as CompareApi;

/** Вид списка файлов: строки (клик открывает окно изменений) или раскрывающиеся панели с diff прямо в сравнении */
type Layout = 'list' | 'panels';
const LAYOUT_KEY = 'compare.layout';
const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'panels' ? 'panels' : 'list';
  } catch {
    return 'list';
  }
};
const writeLayout = (layout: Layout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* выбор просто не запомнится */
  }
};

interface CompareViewProps {
  repoPath: string;
  a: string;
  b: string;
  hidden?: boolean;
  activePath?: string | null;
  onSwap: () => void;
  onClose: () => void;
  onOpenFile: (file: CompareFile, list: CompareFile[], search?: CompareSearchJump) => void;
  onLocate: (hash: string) => void;
  onFileMenu?: (file: CompareFile, list: CompareFile[], x: number, y: number) => void;
}

/**
 * Сравнение двух коммитов: a — «было», b — «стало».
 * Таблица файлов с полосками объёма изменений, сводка по папкам, коммиты между ними.
 */
export default function CompareView({ repoPath, a, b, hidden, activePath, onSwap, onClose, onOpenFile, onLocate, onFileMenu }: CompareViewProps) {
  const [state, setState] = useState<{ loading: boolean; data: Comparison | null; error: ApiError | null }>({ loading: true, data: null, error: null });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('path'); // path | size
  const [dirFilter, setDirFilter] = useState<string | null>(null);
  const [showCommits, setShowCommits] = useState(false);
  // Поиск: по пути файла или по содержимому изменённых строк
  const [mode, setMode] = useState('path'); // path | content
  const [content, setContent] = useState<ContentQuery>({ query: '', caseSensitive: false, regex: false });
  const [found, setFound] = useState<Found>({ loading: false, data: null, error: null, key: null });
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  // Панели: какие файлы раскрыты; diff загружается при раскрытии (не больше 4 одновременно) и запоминается для этой пары коммитов
  const [layout, setLayoutRaw] = useState<Layout>(readLayout);
  const [openPaths, setOpenPaths] = useState(() => new Set<string>());
  const diffCache = useRef(new Map<string, PanelDiff>());
  const queue = useRef(limiter(4));
  const setLayout = (next: Layout) => {
    setLayoutRaw(next);
    writeLayout(next);
  };
  const togglePanel = useCallback(
    (path: string) =>
      setOpenPaths((s) => {
        const next = new Set(s);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  const loadDiff = useCallback(
    (f: CompareFile, alive: () => boolean): Promise<PanelDiff | null> => {
      const key = `${a}|${b}|${f.path}`;
      const hit = diffCache.current.get(key);
      if (hit) return Promise.resolve(hit);
      return queue.current(async () => {
        if (!alive()) return null; // панель свернули, пока ждали очереди
        const res = await api.repo.fileDiff(repoPath, {
          mode: 'commit',
          hash: b,
          parent: a,
          path: f.path,
          oldPath: f.oldPath,
          conflicted: false,
          ignoreWhitespace: false,
          fullFile: false,
        });
        const d: PanelDiff = res.ok ? { data: res.data, error: null } : { data: null, error: res.error.message };
        if (res.ok) diffCache.current.set(key, d);
        return d;
      });
    },
    [repoPath, a, b],
  );

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api.repo.compare(repoPath, { a, b }).then((res) => {
      if (alive) setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error });
    });
    setDirFilter(null);
    setOpenPaths(new Set());
    diffCache.current.clear();
    return () => {
      alive = false;
    };
  }, [repoPath, a, b]);

  // Поиск по содержимому — после паузы в наборе; устаревшие ответы отбрасываются
  const contentKey = mode === 'content' && content.query.trim() ? JSON.stringify([a, b, content]) : null;
  useEffect(() => {
    if (!contentKey) {
      seq.current++;
      setFound({ loading: false, data: null, error: null, key: null });
      return undefined;
    }
    const n = ++seq.current;
    setFound((f) => ({ ...f, loading: true }));
    const timer = setTimeout(async () => {
      const res = await api.repo.compareSearch(repoPath, { a, b, ...content });
      if (n !== seq.current) return;
      setFound(res.ok ? { loading: false, data: res.data, error: null, key: contentKey } : { loading: false, data: null, error: res.error, key: contentKey });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, repoPath]);

  // Ctrl+F в сравнении — поиск по содержимому изменений
  useEffect(() => {
    if (hidden) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.fixed.inset-0')) return;
      const key = e.key.toLowerCase();
      if (isMod(e) && !e.altKey && !e.shiftKey && (key === 'f' || key === 'а')) {
        e.preventDefault();
        e.stopPropagation();
        setMode('content');
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hidden]);

  useEffect(() => {
    if (hidden) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.fixed.inset-0')) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, onClose]);

  const d = state.data;
  const files = d?.files ?? [];
  const size = (f: CompareFile) => (f.additions ?? 0) + (f.deletions ?? 0);
  const maxSize = Math.max(1, ...files.map(size));

  // Папки верхнего уровня (или второго, если всё в одной) — для «графика»
  const dirs = useMemo(() => {
    const top = (p: string, depth: number) => {
      const parts = p.split('/');
      return parts.length > depth ? parts.slice(0, depth).join('/') : t('root-2');
    };
    const group = (depth: number) => {
      const m = new Map<string, DirGroup>();
      for (const f of files) {
        const k = top(f.path, depth);
        const g = m.get(k) ?? { dir: k, files: 0, additions: 0, deletions: 0 };
        g.files++;
        g.additions += f.additions ?? 0;
        g.deletions += f.deletions ?? 0;
        m.set(k, g);
      }
      return [...m.values()].sort((x, y) => y.additions + y.deletions - (x.additions + x.deletions));
    };
    let g = group(1);
    if (g.length === 1 && g[0].dir !== t('root-2')) g = group(2);
    return g;
  }, [files]);
  const maxDir = Math.max(1, ...dirs.map((x) => x.additions + x.deletions));

  const inDir = (path: string) => !dirFilter || (dirFilter === t('root-2') ? !path.includes('/') : path === dirFilter || path.startsWith(`${dirFilter}/`));

  // Результаты поиска по содержимому: файлы из сравнения (статус, объём) + найденные строки
  const contentResults = useMemo(() => {
    if (mode !== 'content' || !found.data) return null;
    const byPath = new Map(files.map((f) => [f.path, f]));
    let list: ContentResult[] = found.data.files
      .filter((r) => inDir(r.path))
      .map((r) => ({ ...r, file: byPath.get(r.path) ?? { path: r.path, oldPath: r.oldPath, status: 'M', additions: null, deletions: null } }));
    if (sort === 'size') list = [...list].sort((x, y) => y.count - x.count);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, found.data, files, sort, dirFilter]);

  const openMatch = (r: ContentResult, line: MatchLine | undefined) => {
    const list = contentResults!.map((x) => x.file);
    onOpenFile(r.file, list, {
      query: content.query,
      caseSensitive: content.caseSensitive,
      regex: content.regex,
      changedOnly: true,
      line: line ? { t: line.t, n: line.t === '+' ? line.line : null, o: line.t === '-' ? line.line : null } : null,
    });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = files.filter((f) => (!q || f.path.toLowerCase().includes(q) || f.oldPath?.toLowerCase().includes(q)));
    if (dirFilter) list = list.filter((f) => (dirFilter === t('root-2') ? !f.path.includes('/') : f.path === dirFilter || f.path.startsWith(`${dirFilter}/`)));
    return sort === 'size' ? [...list].sort((x, y) => size(y) - size(x)) : list;
  }, [files, query, sort, dirFilter]);

  return (
    <div className={`flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg ${hidden ? 'hidden' : ''}`}>
      <div className="glass flex h-11 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
        {tj('compare', [<GitCompareArrows size={16} className="shrink-0 text-gk-blue" />, <span className="shrink-0 text-[13px] font-semibold text-gk-strong" />, <CommitChip label={t('before-2')} info={d?.a} hash={a} onClick={() => onLocate(a)} />, <button onClick={onSwap} title={t('swap')} className="shrink-0 rounded p-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <ArrowLeftRight size={14} />
        </button>, <CommitChip label={t('after-3')} info={d?.b} hash={b} onClick={() => onLocate(b)} />, <div className="flex-1" />, <button onClick={onClose} title={t('close-esc')} className="rounded p-1.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <X size={15} />
        </button>])}
      </div>

      {state.loading && !d ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
          {tj('comparing', [<Loader2 size={15} className="animate-spin" />])}</div>
      ) : state.error ? (
        <div className="m-6 rounded-lg border border-gk-red/30 bg-gk-red/10 px-4 py-3 text-[13px] text-gk-text">{state.error.message}</div>
      ) : (
        <div className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
          {/* Сводка */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 p-3">
            <Stat value={files.length} label={plural(files.length, t('file-changed'), t('files-changed'), t('files-changed-2'))} />
            <Stat value={`+${d!.additions}`} label={plural(d!.additions, t('line-added'), t('lines-added'), t('lines-added-2'))} cls="text-gk-green" />
            <Stat value={`−${d!.deletions}`} label={plural(d!.deletions, t('line-deleted'), t('lines-deleted'), t('lines-deleted-2'))} cls="text-gk-red" />
            <button
              onClick={() => setShowCommits((v) => !v)}
              className="rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2 text-left transition-colors hover:bg-gk-fg/[0.05]"
            >
              <div className="flex items-center gap-1 text-[18px] font-semibold text-gk-strong">
                {d!.onlyA + d!.onlyB}
                {showCommits ? <ChevronDown size={14} className="text-gk-dim" /> : <ChevronRight size={14} className="text-gk-dim" />}
              </div>
              <div className="text-[11.5px] text-gk-muted">{relationText(d!)}</div>
            </button>
          </div>

          {showCommits && (
            <div className="mx-3 mb-3 grid animate-fade-in gap-3 md:grid-cols-2">
              {d!.onlyB > 0 && <CommitList title={t('only-in-after', d!.onlyB)} commits={d!.commitsB} total={d!.onlyB} onLocate={onLocate} />}
              {d!.onlyA > 0 && <CommitList title={t('only-in-before', d!.onlyA)} commits={d!.commitsA} total={d!.onlyA} onLocate={onLocate} />}
            </div>
          )}

          {/* График по папкам */}
          {dirs.length > 1 && (
            <div className="mx-3 mb-3 rounded-lg border border-gk-border bg-gk-fg/[0.015] p-3">
              <div className="mb-2 flex items-center text-[11px] font-semibold uppercase tracking-wider text-gk-muted">
                {tj('where-most-changes-are', [dirFilter && (
                  <button onClick={() => setDirFilter(null)} className="ml-auto rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-gk-blue hover:bg-gk-blue/10">
                    {t('show-all-folders')}</button>
                )])}
              </div>
              <div className="space-y-1">
                {dirs.slice(0, 10).map((g) => (
                  <button
                    key={g.dir}
                    onClick={() => setDirFilter((x) => (x === g.dir ? null : g.dir))}
                    className={`grid w-full grid-cols-[minmax(120px,220px)_1fr_auto] items-center gap-3 rounded px-1.5 py-1 text-left text-[12px] transition-colors ${
                      dirFilter === g.dir ? 'bg-gk-blue/15' : 'hover:bg-gk-fg/[0.04]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-gk-text">
                      <Folder size={12} className="shrink-0 text-gk-dim" />
                      <span className="truncate">{g.dir}</span>
                      <span className="shrink-0 text-[10.5px] text-gk-dim">{g.files}</span>
                    </span>
                    <Bar additions={g.additions} deletions={g.deletions} max={maxDir} tall />
                    <span className="w-24 shrink-0 text-right font-mono text-[11px]">
                      <span className="text-gk-green">+{g.additions}</span> <span className="text-gk-red">−{g.deletions}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Таблица файлов */}
          <div className={`mx-3 mb-4 rounded-lg border border-gk-border ${mode === 'path' && layout === 'panels' ? '' : 'overflow-hidden'}`}>
            <div className="flex items-center gap-2 border-b border-gk-border bg-gk-fg/[0.03] px-2.5 py-1.5">
              <div className="flex shrink-0 overflow-hidden rounded text-[11.5px] ring-1 ring-gk-border" role="tablist">
                <SortBtn active={mode === 'path'} onClick={() => setMode('path')} data-testid="compare-mode-path" title={t('filter-list-by-file-path')}>
                  {t('path')}</SortBtn>
                <SortBtn
                  active={mode === 'content'}
                  onClick={() => {
                    setMode('content');
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                  data-testid="compare-mode-content"
                  title={kb(t('search-text-in-changed-lines'))}
                >
                  {t('content')}</SortBtn>
              </div>
              <div
                className={`flex min-w-0 flex-1 items-center gap-1.5 rounded bg-gk-bg px-2 ring-1 focus-within:ring-gk-blue ${
                  mode === 'content' && found.error ? 'ring-gk-red/60' : 'ring-gk-border'
                }`}
              >
                {mode === 'content' && found.loading ? <Loader2 size={12} className="shrink-0 animate-spin text-gk-dim" /> : <Search size={12} className="shrink-0 text-gk-dim" />}
                {mode === 'path' ? (
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('filter-by-path')}
                    className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-gk-text outline-none placeholder:text-gk-dim"
                  />
                ) : (
                  <>
                    <input
                      ref={searchRef}
                      value={content.query}
                      onChange={(e) => setContent((c) => ({ ...c, query: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && contentResults?.[0]) openMatch(contentResults[0], contentResults[0].lines[0]);
                        if (e.altKey && (e.key === 'c' || e.key === 'с')) {
                          e.preventDefault();
                          setContent((c) => ({ ...c, caseSensitive: !c.caseSensitive }));
                        }
                        if (e.altKey && (e.key === 'r' || e.key === 'к')) {
                          e.preventDefault();
                          setContent((c) => ({ ...c, regex: !c.regex }));
                        }
                      }}
                      placeholder={t('find-in-changed-lines-of')}
                      aria-label={t('find-in-changes')}
                      spellCheck={false}
                      data-testid="compare-content-input"
                      className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-gk-text outline-none placeholder:font-sans placeholder:text-gk-dim"
                    />
                    <OptBtn on={content.caseSensitive} onClick={() => setContent((c) => ({ ...c, caseSensitive: !c.caseSensitive }))} title={t('match-case-alt-c')} testid="compare-case">
                      <CaseSensitive size={13} />
                    </OptBtn>
                    <OptBtn on={content.regex} onClick={() => setContent((c) => ({ ...c, regex: !c.regex }))} title={t('regular-expression-alt-r')} testid="compare-regex">
                      <Regex size={13} />
                    </OptBtn>
                  </>
                )}
              </div>
              {mode === 'path' && (
                <div className="flex shrink-0 overflow-hidden rounded text-[11.5px] ring-1 ring-gk-border" data-testid="compare-layout">
                  <SortBtn active={layout === 'list'} onClick={() => setLayout('list')} title={t('compare-layout-list-title')} data-testid="compare-layout-list">
                    {t('compare-layout-list')}</SortBtn>
                  <SortBtn active={layout === 'panels'} onClick={() => setLayout('panels')} title={t('compare-layout-panels-title')} data-testid="compare-layout-panels">
                    {t('compare-layout-panels')}</SortBtn>
                </div>
              )}
              {mode === 'path' && layout === 'panels' && (
                <div className="flex shrink-0 items-center">
                  <OptBtn on={false} onClick={() => setOpenPaths(new Set(shown.map((f) => f.path)))} title={t('compare-expand-all')} testid="compare-expand-all">
                    <UnfoldVertical size={13} />
                  </OptBtn>
                  <OptBtn on={false} onClick={() => setOpenPaths(new Set())} title={t('compare-collapse-all')} testid="compare-collapse-all">
                    <FoldVertical size={13} />
                  </OptBtn>
                </div>
              )}
              <div className="flex shrink-0 overflow-hidden rounded text-[11.5px] ring-1 ring-gk-border">
                <SortBtn active={sort === 'path'} onClick={() => setSort('path')}>
                  {t('by-path')}</SortBtn>
                <SortBtn active={sort === 'size'} onClick={() => setSort('size')}>
                  {t('by-size')}</SortBtn>
              </div>
            </div>
            {mode === 'content' ? (
              <ContentResults
                query={content.query}
                found={found}
                results={contentResults}
                activePath={activePath}
                onOpen={openMatch}
              />
            ) : shown.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-gk-dim">{files.length ? t('nothing-found') : t('files-in-these-commits-are')}</div>
            ) : layout === 'panels' ? (
              <div data-testid="compare-panels">
                {shown.map((f) => {
                  const key = `${a}|${b}|${f.path}`;
                  return (
                    <ComparePanel
                      key={key}
                      file={f}
                      open={openPaths.has(f.path)}
                      active={activePath === f.path}
                      maxSize={maxSize}
                      cached={diffCache.current.get(key)}
                      load={loadDiff}
                      onToggle={togglePanel}
                      onOpen={(file) => onOpenFile(file, shown)}
                      onMenu={onFileMenu && ((file, x, y) => onFileMenu(file, shown, x, y))}
                    />
                  );
                })}
              </div>
            ) : (
              shown.map((f, i) => {
                const parts = f.path.split('/');
                const name = parts.pop();
                return (
                  <button
                    key={f.path}
                    onClick={() => onOpenFile(f, shown)}
                    onContextMenu={(e) => {
                      if (!onFileMenu) return;
                      e.preventDefault();
                      onFileMenu(f, shown, e.clientX, e.clientY);
                    }}
                    className={`grid w-full animate-fade-in grid-cols-[auto_minmax(0,1fr)_minmax(80px,200px)_92px] items-center gap-3 border-b border-gk-border/60 px-2.5 py-1.5 text-left text-[12.5px] last:border-0 ${
                      activePath === f.path ? 'bg-gk-blue/15' : 'hover:bg-gk-hover'
                    }`}
                    style={{ animationDelay: `${Math.min(i, 30) * 8}ms` }}
                    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  >
                    <StatusBadge status={f.status} />
                    <span className="min-w-0 truncate">
                      {f.oldPath && f.oldPath !== f.path && <span className="text-gk-dim">{f.oldPath} → </span>}
                      {parts.length > 0 && <span className="text-gk-muted">{parts.join('/')}/</span>}
                      <span className="text-gk-text">{name}</span>
                    </span>
                    {f.additions !== null ? <Bar additions={f.additions} deletions={f.deletions!} max={maxSize} /> : <span className="text-[11px] text-gk-dim">{t('binary')}</span>}
                    <span className="text-right font-mono text-[11px]">
                      {f.additions !== null && (
                        <>
                          <span className="text-gk-green">+{f.additions}</span> <span className="text-gk-red">−{f.deletions}</span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function relationText(d: Comparison) {
  if (d.relation === 'a-before-b') return t('from-before-to-after', plural(d.onlyB, t('commit'), t('commits'), t('commits-2')));
  if (d.relation === 'b-before-a') return t('after-is-older-by', d.onlyA, plural(d.onlyA, t('commit'), t('commits'), t('commits-2')));
  return t('diverged-and', d.onlyA, d.onlyB, plural(d.onlyB, t('commit'), t('commits'), t('commits-2')));
}

function CommitChip({ label, info, hash, onClick }: { label: string; info: Comparison['a'] | undefined; hash: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={info ? `${info.subject}\n${info.author}, ${relativeTime(info.date)}` : hash}
      className="flex min-w-0 max-w-[32%] items-center gap-1.5 rounded-md bg-gk-fg/[0.05] px-2 py-1 text-[12px] ring-1 ring-gk-border hover:bg-gk-fg/10"
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-gk-dim">{label}</span>
      <span className="shrink-0 font-mono text-gk-blue">{hash.slice(0, 7)}</span>
      {info && <span className="truncate text-gk-text">{info.subject}</span>}
    </button>
  );
}

function Stat({ value, label, cls = 'text-gk-strong' }: { value: ReactNode; label: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2">
      <div className={`text-[18px] font-semibold ${cls}`}>{value}</div>
      <div className="text-[11.5px] text-gk-muted">{label}</div>
    </div>
  );
}

// Полоска объёма: зелёная часть — добавлено, красная — удалено; длина — относительно самого большого
function Bar({ additions, deletions, max, tall }: { additions: number; deletions: number; max: number; tall?: boolean }) {
  const total = additions + deletions;
  const width = total ? Math.max(3, (total / max) * 100) : 0;
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-gk-fg/[0.04] ${tall ? 'h-2.5' : 'h-1.5'}`}>
      <div className="flex h-full transition-[width] duration-500" style={{ width: `${width}%` }}>
        <span className="h-full bg-gk-green/80" style={{ width: total ? `${(additions / total) * 100}%` : 0 }} />
        <span className="h-full bg-gk-red/80" style={{ width: total ? `${(deletions / total) * 100}%` : 0 }} />
      </div>
    </div>
  );
}

function CommitList({ title, commits, total, onLocate }: { title: string; commits: Comparison['commitsA']; total: number; onLocate: (hash: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gk-border">
      <div className="border-b border-gk-border bg-gk-fg/[0.03] px-3 py-1.5 text-[11.5px] font-medium text-gk-muted">{title}</div>
      <div className="max-h-56 overflow-y-auto">
        {commits.map((c) => (
          <button key={c.hash} onClick={() => onLocate(c.hash)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-gk-hover">
            <span className="shrink-0 font-mono text-[11px] text-gk-blue">{c.hash.slice(0, 7)}</span>
            <span className="min-w-0 flex-1 truncate text-gk-text">{c.subject}</span>
            <span className="shrink-0 text-[11px] text-gk-dim">{relativeTime(c.date)}</span>
          </button>
        ))}
        {total > commits.length && <div className="px-3 py-1 text-[11px] text-gk-dim">{tj('and-more-2', [total - commits.length])}</div>}
      </div>
    </div>
  );
}

function SortBtn({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button {...props} className={`px-2 py-0.5 ${active ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted hover:text-gk-text'}`}>
      {children}
    </button>
  );
}

function OptBtn({ on, children, title, testid, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean; title: string; testid: string }) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={on}
      title={title}
      data-testid={testid}
      className={`flex h-5 w-6 shrink-0 items-center justify-center rounded ${on ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-dim hover:text-gk-text'}`}
    >
      {children}
    </button>
  );
}

/* ---------- Файлы панелями: шапка как строка списка, под ней diff файла ---------- */

interface PanelDiff {
  data: FileDiff_Serialize | null;
  error: string | null;
}

/** Не больше `max` загрузок одновременно: «Развернуть все» на сотне файлов не запускает сотню процессов git сразу */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    if (active >= max || !waiting.length) return;
    active++;
    waiting.shift()!();
  };
  return <T,>(job: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        job()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

interface ComparePanelProps {
  file: CompareFile;
  open: boolean;
  active: boolean;
  maxSize: number;
  cached: PanelDiff | undefined;
  load: (file: CompareFile, alive: () => boolean) => Promise<PanelDiff | null>;
  onToggle: (path: string) => void;
  onOpen: (file: CompareFile) => void;
  onMenu?: (file: CompareFile, x: number, y: number) => void;
}

/**
 * Раскрывающаяся панель файла. Шапка — та же строка, что в списке (статус, путь, полоска, +/−), с шевроном; клик раскрывает,
 * значок справа открывает файл в окне изменений. Diff грузится, когда раскрытая панель подходит к видимой области.
 */
const ComparePanel = memo(function ComparePanel({ file, open, active, maxSize, cached, load, onToggle, onOpen, onMenu }: ComparePanelProps) {
  const [diff, setDiff] = useState<PanelDiff | undefined>(cached);
  const [near, setNear] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || diff || near) return undefined;
    const el = bodyRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [open, diff, near]);
  useEffect(() => {
    if (!open || !near || diff) return undefined;
    let alive = true;
    load(file, () => alive).then((d) => {
      if (alive && d) setDiff(d);
    });
    return () => {
      alive = false;
    };
  }, [open, near, diff, file, load]);

  const parts = file.path.split('/');
  const name = parts.pop();
  return (
    <div className="border-b border-gk-border/60 last:border-0" data-testid="compare-panel" data-path={file.path} data-open={open ? '' : undefined}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => onToggle(file.path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(file.path);
          }
        }}
        onContextMenu={(e) => {
          if (!onMenu) return;
          e.preventDefault();
          onMenu(file, e.clientX, e.clientY);
        }}
        className={`grid w-full cursor-pointer select-none grid-cols-[auto_auto_minmax(0,1fr)_minmax(80px,200px)_92px_auto] items-center gap-3 px-2.5 py-1.5 text-left text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gk-blue ${
          open ? 'sticky top-0 z-10 border-b border-gk-border/60 bg-gk-panel' : ''
        } ${active ? 'bg-gk-blue/15' : 'hover:bg-gk-hover'}`}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        data-testid="compare-panel-header"
      >
        {open ? <ChevronDown size={14} className="text-gk-dim" /> : <ChevronRight size={14} className="text-gk-dim" />}
        <StatusBadge status={file.status} />
        <span className="min-w-0 truncate">
          {file.oldPath && file.oldPath !== file.path && <span className="text-gk-dim">{file.oldPath} → </span>}
          {parts.length > 0 && <span className="text-gk-muted">{parts.join('/')}/</span>}
          <span className="text-gk-text">{name}</span>
        </span>
        {file.additions !== null ? <Bar additions={file.additions} deletions={file.deletions!} max={maxSize} /> : <span className="text-[11px] text-gk-dim">{t('binary')}</span>}
        <span className="text-right font-mono text-[11px]">
          {file.additions !== null && (
            <>
              <span className="text-gk-green">+{file.additions}</span> <span className="text-gk-red">−{file.deletions}</span>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(file);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          title={t('compare-open-in-diff')}
          aria-label={t('compare-open-in-diff')}
          data-testid="compare-panel-open"
          className="rounded p-1 text-gk-muted hover:bg-gk-fg/10 hover:text-gk-text"
        >
          <FileDiff size={13} />
        </button>
      </div>
      {open && (
        <div ref={bodyRef} className="bg-gk-bg" data-testid="compare-panel-body">
          <PanelBody file={file} diff={diff} />
        </div>
      )}
    </div>
  );
});

const readPref = (key: string, def: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
};

// Тело панели: тот же построчный diff, что в окне изменений (Unified), с подсветкой изменений внутри строк и синтаксиса —
// по тем же настройкам окна изменений (`diff.inline`, `diff.syntax`)
function PanelBody({ file, diff }: { file: CompareFile; diff: PanelDiff | undefined }) {
  const data = diff?.data ?? null;
  const highlights = useMemo(() => (data?.hunks.length && readPref('diff.inline', true) ? data.hunks.map((h) => inlineHighlights(h.lines)) : null), [data]);
  const [syntax, setSyntax] = useState<ReturnType<typeof highlightHunks>>(null);
  useEffect(() => {
    setSyntax(null);
    const lang = detectLanguage(file.path);
    if (!lang || !data?.hunks.length || !readPref('diff.syntax', true)) return undefined;
    let alive = true;
    const timer = setTimeout(() => alive && setSyntax(highlightHunks(data.hunks, lang)), 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [data, file.path]);

  if (!diff) return <PanelNote>{tj('loading-diff', [<Loader2 size={13} className="animate-spin" />])}</PanelNote>;
  if (diff.error || !data) return <PanelNote className="text-gk-red">{diff.error}</PanelNote>;
  if (data.binary) return <PanelNote>{tj('binary-file-line-diff-unavailable', [<FileText size={13} />])}</PanelNote>;
  if (data.tooLarge) return <PanelNote>{tj('file-is-too-large-kb-to', [Math.round((data.size ?? 0) / 1024)])}</PanelNote>;
  if (!data.hunks.length) {
    return (
      <PanelNote>
        {data.eolOnly ? t('only-line-endings-changed-crlf') : file.oldPath && file.oldPath !== file.path ? t('file-was-renamed-without-content') : t('no-content-changes')}
      </PanelNote>
    );
  }
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-5 [tab-size:4]">
      <UnifiedDiff hunks={data.hunks} highlights={highlights} syntax={syntax} />
      {data.truncated && <div className="border-t border-gk-border px-4 py-2 font-sans text-xs text-gk-dim">{t('diff-is-too-large-only')}</div>}
    </div>
  );
}

function PanelNote({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <div className={`flex items-center justify-center gap-2 px-3 py-4 text-[12.5px] text-gk-muted ${className}`}>{children}</div>;
}

/* ---------- Поиск по содержимому: файлы и найденные строки ---------- */

const PREVIEW_LINES = 4;

interface ContentResultsProps {
  query: string;
  found: Found;
  results: ContentResult[] | null;
  activePath: string | null | undefined;
  onOpen: (r: ContentResult, line: MatchLine | undefined) => void;
}

function ContentResults({ query, found, results, activePath, onOpen }: ContentResultsProps) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  if (!query.trim()) {
    return (
      <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-gk-dim">
        {tj('enter-text-well-find-it', [<br />])}</div>
    );
  }
  if (found.error) return <div className="px-3 py-4 text-[12.5px] text-gk-red">{found.error.message}{found.error.hint && <span className="text-gk-dim"> — {found.error.hint}</span>}</div>;
  if (!results) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-[12.5px] text-gk-muted">
        {tj('searching', [<Loader2 size={13} className="animate-spin" />])}</div>
    );
  }
  if (!results.length) return <div className="px-3 py-6 text-center text-[12.5px] text-gk-dim">{t('not-found-in-changed-lines')}</div>;
  const total = results.reduce((n, r) => n + r.count, 0);
  return (
    <div className={found.loading ? 'opacity-60 transition-opacity' : ''} data-testid="compare-content-results">
      <div className="border-b border-gk-border/60 px-2.5 py-1 text-[11.5px] text-gk-muted" data-testid="compare-content-summary">
        {tj('in-5', [total, plural(total, t('match'), t('matches'), t('matches-2')), results.length, plural(results.length, t('file-5'), t('files-4'), t('files-4')), found.data?.truncated && <span className="text-gk-yellow"> {tj('first-shown', [found.data.total])}</span>])}
      </div>
      {results.map((r) => {
        const parts = r.path.split('/');
        const name = parts.pop();
        const open = expanded.has(r.path);
        const lines = open ? r.lines : r.lines.slice(0, PREVIEW_LINES);
        return (
          <div key={r.path} className="border-b border-gk-border/60 last:border-0" data-testid="compare-content-file">
            <button
              onClick={() => onOpen(r, r.lines[0])}
              className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12.5px] ${activePath === r.path ? 'bg-gk-blue/15' : 'hover:bg-gk-hover'}`}
              title={r.oldPath ? `${r.oldPath} → ${r.path}` : r.path}
            >
              <StatusBadge status={r.file.status} />
              <span className="min-w-0 flex-1 truncate">
                {r.oldPath && <span className="text-gk-dim">{r.oldPath} → </span>}
                {parts.length > 0 && <span className="text-gk-muted">{parts.join('/')}/</span>}
                <span className="text-gk-text">{name}</span>
              </span>
              <span className="shrink-0 rounded-full bg-gk-yellow/15 px-1.5 text-[11px] text-gk-yellow">{r.count}</span>
            </button>
            <MatchLines path={r.path} lines={lines} onOpen={(l) => onOpen(r, l)} />
            {r.lines.length > PREVIEW_LINES && (
              <button
                onClick={() =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(r.path)) next.delete(r.path);
                    else next.add(r.path);
                    return next;
                  })
                }
                className="mb-1 ml-9 text-[11.5px] text-gk-blue hover:underline"
              >
                {open ? t('collapse') : t('more', r.lines.length - PREVIEW_LINES, r.count > r.lines.length ? '+' : '')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Найденные строки с подсветкой синтаксиса и совпадений
function MatchLines({ path, lines, onOpen }: { path: string; lines: MatchLine[]; onOpen: (line: MatchLine) => void }) {
  const tokens = useMemo(() => highlightLines(lines.map((l) => l.text), detectLanguage(path)), [path, lines]);
  return (
    <div className="pb-1 font-mono text-[11.5px] leading-[18px]">
      {lines.map((l, i) => {
        const pieces = layerLine(l.text, { tokens: tokens?.[i] ?? null, hits: (l.ranges as [number, number][]).map(([start, end], idx) => ({ start, end, idx, current: false })) });
        return (
          <button
            key={`${l.t}${l.line}:${i}`}
            onClick={() => onOpen(l)}
            data-testid="compare-content-line"
            className={`flex w-full items-baseline gap-2 py-px pl-9 pr-2.5 text-left hover:bg-gk-hover ${l.t === '+' ? 'bg-gk-green/[0.05]' : 'bg-gk-red/[0.06]'}`}
          >
            <span className={`w-3 shrink-0 select-none ${l.t === '+' ? 'text-gk-green' : 'text-gk-red'}`}>{l.t === '+' ? '+' : '−'}</span>
            <span className="w-10 shrink-0 select-none text-right text-gk-dim">{l.line}</span>
            <span className="min-w-0 flex-1 truncate whitespace-pre text-gk-text">
              {l.cut && <span className="text-gk-dim">… </span>}
              {pieces.map((p, k) => (
                <span key={k} className={[p.cls, p.hit ? 'bg-gk-yellow/40' : ''].filter(Boolean).join(' ') || undefined}>
                  {p.text}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
