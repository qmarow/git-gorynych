import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronRight, Folder, GitCompareArrows, Loader2, Search, X } from 'lucide-react';
import { plural, relativeTime } from '../lib/format.js';
import { StatusBadge } from './RebaseView.jsx';

const api = window.api;

/**
 * Сравнение двух коммитов: a — «было», b — «стало».
 * Таблица файлов с полосками объёма изменений, сводка по папкам, коммиты между ними.
 */
export default function CompareView({ repoPath, a, b, hidden, activePath, onSwap, onClose, onOpenFile, onLocate }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('path'); // path | size
  const [dirFilter, setDirFilter] = useState(null);
  const [showCommits, setShowCommits] = useState(false);

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
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-gk-bg px-2 ring-1 ring-gk-border focus-within:ring-gk-blue">
                <Search size={12} className="shrink-0 text-gk-dim" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Фильтр по пути"
                  className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-gk-text outline-none placeholder:text-gk-dim"
                />
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
            {shown.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-gk-dim">{files.length ? 'Ничего не найдено' : 'Файлы в этих коммитах одинаковые'}</div>
            ) : (
              shown.map((f, i) => {
                const parts = f.path.split('/');
                const name = parts.pop();
                return (
                  <button
                    key={f.path}
                    onClick={() => onOpenFile(f, shown)}
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
