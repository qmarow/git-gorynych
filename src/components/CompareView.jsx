import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, CaseSensitive, ChevronDown, ChevronRight, Folder, GitCompareArrows, Loader2, Regex, Search, X } from 'lucide-react';
import { plural, relativeTime } from '../lib/format.js';
import { detectLanguage, highlightLines, layerLine } from '../lib/highlight.js';
import { isMod, kb } from '../lib/platform.js';
import { StatusBadge } from './RebaseView.jsx';

const api = window.api;

/**
 * Сравнение двух коммитов: a — «было», b — «стало».
 * Таблица файлов с полосками объёма изменений, сводка по папкам, коммиты между ними.
 */
export default function CompareView({ repoPath, a, b, hidden, activePath, onSwap, onClose, onOpenFile, onLocate, onFileMenu }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('path'); // path | size
  const [dirFilter, setDirFilter] = useState(null);
  const [showCommits, setShowCommits] = useState(false);
  // Поиск: по пути файла или по содержимому изменённых строк
  const [mode, setMode] = useState('path'); // path | content
  const [content, setContent] = useState({ query: '', caseSensitive: false, regex: false });
  const [found, setFound] = useState({ loading: false, data: null, error: null, key: null });
  const searchRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api.repo.compare(repoPath, { a, b }).then((res) => {
      if (alive) setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error });
    });
    setDirFilter(null);
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
    const onKey = (e) => {
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
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return;
      if (e.target?.tagName === 'INPUT') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, onClose]);

  const d = state.data;
  const files = d?.files ?? [];
  const size = (f) => (f.additions ?? 0) + (f.deletions ?? 0);
  const maxSize = Math.max(1, ...files.map(size));

  // Папки верхнего уровня (или второго, если всё в одной) — для «графика»
  const dirs = useMemo(() => {
    const top = (p, depth) => {
      const parts = p.split('/');
      return parts.length > depth ? parts.slice(0, depth).join('/') : '(корень)';
    };
    const group = (depth) => {
      const m = new Map();
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
    if (g.length === 1 && g[0].dir !== '(корень)') g = group(2);
    return g;
  }, [files]);
  const maxDir = Math.max(1, ...dirs.map((x) => x.additions + x.deletions));

  const inDir = (path) => !dirFilter || (dirFilter === '(корень)' ? !path.includes('/') : path === dirFilter || path.startsWith(`${dirFilter}/`));

  // Результаты поиска по содержимому: файлы из сравнения (статус, объём) + найденные строки
  const contentResults = useMemo(() => {
    if (mode !== 'content' || !found.data) return null;
    const byPath = new Map(files.map((f) => [f.path, f]));
    let list = found.data.files
      .filter((r) => inDir(r.path))
      .map((r) => ({ ...r, file: byPath.get(r.path) ?? { path: r.path, oldPath: r.oldPath, status: 'M', additions: null, deletions: null } }));
    if (sort === 'size') list = [...list].sort((x, y) => y.count - x.count);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, found.data, files, sort, dirFilter]);

  const openMatch = (r, line) => {
    const list = contentResults.map((x) => x.file);
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
    if (dirFilter) list = list.filter((f) => (dirFilter === '(корень)' ? !f.path.includes('/') : f.path === dirFilter || f.path.startsWith(`${dirFilter}/`)));
    return sort === 'size' ? [...list].sort((x, y) => size(y) - size(x)) : list;
  }, [files, query, sort, dirFilter]);

  return (
    <div className={`flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg ${hidden ? 'hidden' : ''}`}>
      <div className="glass flex h-11 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
        <GitCompareArrows size={16} className="shrink-0 text-gk-blue" />
        <span className="shrink-0 text-[13px] font-semibold text-gk-strong">Сравнение</span>
        <CommitChip label="было" info={d?.a} hash={a} onClick={() => onLocate(a)} />
        <button onClick={onSwap} title="Поменять местами" className="shrink-0 rounded p-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <ArrowLeftRight size={14} />
        </button>
        <CommitChip label="стало" info={d?.b} hash={b} onClick={() => onLocate(b)} />
        <div className="flex-1" />
        <button onClick={onClose} title="Закрыть (Esc)" className="rounded p-1.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <X size={15} />
        </button>
      </div>

      {state.loading && !d ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
          <Loader2 size={15} className="animate-spin" /> Сравниваем…
        </div>
      ) : state.error ? (
        <div className="m-6 rounded-lg border border-gk-red/30 bg-gk-red/10 px-4 py-3 text-[13px] text-gk-text">{state.error.message}</div>
      ) : (
        <div className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
          {/* Сводка */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 p-3">
            <Stat value={files.length} label={plural(files.length, 'файл изменён', 'файла изменено', 'файлов изменено')} />
            <Stat value={`+${d.additions}`} label={plural(d.additions, 'строка добавлена', 'строки добавлено', 'строк добавлено')} cls="text-gk-green" />
            <Stat value={`−${d.deletions}`} label={plural(d.deletions, 'строка удалена', 'строки удалено', 'строк удалено')} cls="text-gk-red" />
            <button
              onClick={() => setShowCommits((v) => !v)}
              className="rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2 text-left transition-colors hover:bg-gk-fg/[0.05]"
            >
              <div className="flex items-center gap-1 text-[18px] font-semibold text-gk-strong">
                {d.onlyA + d.onlyB}
                {showCommits ? <ChevronDown size={14} className="text-gk-dim" /> : <ChevronRight size={14} className="text-gk-dim" />}
              </div>
              <div className="text-[11.5px] text-gk-muted">{relationText(d)}</div>
            </button>
          </div>

          {showCommits && (
            <div className="mx-3 mb-3 grid animate-fade-in gap-3 md:grid-cols-2">
              {d.onlyB > 0 && <CommitList title={`Есть только в «стало» (${d.onlyB})`} commits={d.commitsB} total={d.onlyB} onLocate={onLocate} />}
              {d.onlyA > 0 && <CommitList title={`Есть только в «было» (${d.onlyA})`} commits={d.commitsA} total={d.onlyA} onLocate={onLocate} />}
            </div>
          )}

          {/* График по папкам */}
          {dirs.length > 1 && (
            <div className="mx-3 mb-3 rounded-lg border border-gk-border bg-gk-fg/[0.015] p-3">
              <div className="mb-2 flex items-center text-[11px] font-semibold uppercase tracking-wider text-gk-muted">
                Где больше всего изменений
                {dirFilter && (
                  <button onClick={() => setDirFilter(null)} className="ml-auto rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-gk-blue hover:bg-gk-blue/10">
                    показать все папки
                  </button>
                )}
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
          <div className="mx-3 mb-4 overflow-hidden rounded-lg border border-gk-border">
            <div className="flex items-center gap-2 border-b border-gk-border bg-gk-fg/[0.03] px-2.5 py-1.5">
              <div className="flex shrink-0 overflow-hidden rounded text-[11.5px] ring-1 ring-gk-border" role="tablist">
                <SortBtn active={mode === 'path'} onClick={() => setMode('path')} data-testid="compare-mode-path" title="Фильтр списка по пути файла">
                  Путь
                </SortBtn>
                <SortBtn
                  active={mode === 'content'}
                  onClick={() => {
                    setMode('content');
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                  data-testid="compare-mode-content"
                  title={kb('Поиск текста в изменённых строках всех файлов (Ctrl+F)')}
                >
                  Содержимое
                </SortBtn>
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
                    placeholder="Фильтр по пути"
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
                      placeholder="Найти в изменённых строках всех файлов"
                      aria-label="Найти в изменениях"
                      spellCheck={false}
                      data-testid="compare-content-input"
                      className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-gk-text outline-none placeholder:font-sans placeholder:text-gk-dim"
                    />
                    <OptBtn on={content.caseSensitive} onClick={() => setContent((c) => ({ ...c, caseSensitive: !c.caseSensitive }))} title="Учитывать регистр (Alt+C)" testid="compare-case">
                      <CaseSensitive size={13} />
                    </OptBtn>
                    <OptBtn on={content.regex} onClick={() => setContent((c) => ({ ...c, regex: !c.regex }))} title="Регулярное выражение (Alt+R)" testid="compare-regex">
                      <Regex size={13} />
                    </OptBtn>
                  </>
                )}
              </div>
              <div className="flex shrink-0 overflow-hidden rounded text-[11.5px] ring-1 ring-gk-border">
                <SortBtn active={sort === 'path'} onClick={() => setSort('path')}>
                  по пути
                </SortBtn>
                <SortBtn active={sort === 'size'} onClick={() => setSort('size')}>
                  по объёму
                </SortBtn>
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
              <div className="px-3 py-6 text-center text-[12.5px] text-gk-dim">{files.length ? 'Ничего не найдено' : 'Файлы в этих коммитах одинаковые'}</div>
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
                    {f.additions !== null ? <Bar additions={f.additions} deletions={f.deletions} max={maxSize} /> : <span className="text-[11px] text-gk-dim">бинарный</span>}
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

function relationText(d) {
  if (d.relation === 'a-before-b') return `${plural(d.onlyB, 'коммит', 'коммита', 'коммитов')} от «было» до «стало»`;
  if (d.relation === 'b-before-a') return `«стало» старше на ${d.onlyA} ${plural(d.onlyA, 'коммит', 'коммита', 'коммитов')}`;
  return `разошлись: ${d.onlyA} и ${d.onlyB} ${plural(d.onlyB, 'коммит', 'коммита', 'коммитов')}`;
}

function CommitChip({ label, info, hash, onClick }) {
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

function Stat({ value, label, cls = 'text-gk-strong' }) {
  return (
    <div className="rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2">
      <div className={`text-[18px] font-semibold ${cls}`}>{value}</div>
      <div className="text-[11.5px] text-gk-muted">{label}</div>
    </div>
  );
}

// Полоска объёма: зелёная часть — добавлено, красная — удалено; длина — относительно самого большого
function Bar({ additions, deletions, max, tall }) {
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

function CommitList({ title, commits, total, onLocate }) {
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
        {total > commits.length && <div className="px-3 py-1 text-[11px] text-gk-dim">…и ещё {total - commits.length}</div>}
      </div>
    </div>
  );
}

function SortBtn({ active, children, ...props }) {
  return (
    <button {...props} className={`px-2 py-0.5 ${active ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted hover:text-gk-text'}`}>
      {children}
    </button>
  );
}

function OptBtn({ on, children, title, testid, ...props }) {
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

/* ---------- Поиск по содержимому: файлы и найденные строки ---------- */

const PREVIEW_LINES = 4;

function ContentResults({ query, found, results, activePath, onOpen }) {
  const [expanded, setExpanded] = useState(() => new Set());
  if (!query.trim()) {
    return (
      <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-gk-dim">
        Введите текст — найдём его в добавленных и удалённых строках всех файлов сравнения.
        <br />
        Клик по строке откроет файл прямо на совпадении.
      </div>
    );
  }
  if (found.error) return <div className="px-3 py-4 text-[12.5px] text-gk-red">{found.error.message}{found.error.hint && <span className="text-gk-dim"> — {found.error.hint}</span>}</div>;
  if (!results) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-[12.5px] text-gk-muted">
        <Loader2 size={13} className="animate-spin" /> Ищем…
      </div>
    );
  }
  if (!results.length) return <div className="px-3 py-6 text-center text-[12.5px] text-gk-dim">В изменённых строках не найдено</div>;
  const total = results.reduce((n, r) => n + r.count, 0);
  return (
    <div className={found.loading ? 'opacity-60 transition-opacity' : ''} data-testid="compare-content-results">
      <div className="border-b border-gk-border/60 px-2.5 py-1 text-[11.5px] text-gk-muted" data-testid="compare-content-summary">
        {total} {plural(total, 'совпадение', 'совпадения', 'совпадений')} в {results.length} {plural(results.length, 'файле', 'файлах', 'файлах')}
        {found.data?.truncated && <span className="text-gk-yellow"> · показаны первые {found.data.total}</span>}
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
                {open ? 'свернуть' : `ещё ${r.lines.length - PREVIEW_LINES}${r.count > r.lines.length ? '+' : ''}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Найденные строки с подсветкой синтаксиса и совпадений
function MatchLines({ path, lines, onOpen }) {
  const tokens = useMemo(() => highlightLines(lines.map((l) => l.text), detectLanguage(path)), [path, lines]);
  return (
    <div className="pb-1 font-mono text-[11.5px] leading-[18px]">
      {lines.map((l, i) => {
        const pieces = layerLine(l.text, { tokens: tokens?.[i] ?? null, hits: l.ranges.map(([start, end], idx) => ({ start, end, idx, current: false })) });
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
