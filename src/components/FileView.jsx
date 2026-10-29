import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CornerLeftUp,
  FileClock,
  FileUser,
  GitCompareArrows,
  History,
  Loader2,
  LocateFixed,
  RotateCcw,
  Space,
  X,
} from 'lucide-react';
import DiffView from './DiffView.jsx';
import { FILE_STATUS, avatarColor, initials, plural, relativeTime } from '../lib/format.js';
import { detectLanguage, highlightLines } from '../lib/highlight.js';
import { TokenText } from './CodeText.jsx';
import { readable } from '../lib/scheme.js';
import { kb } from '../lib/platform.js';

const api = typeof window !== 'undefined' ? window.api : null;

const readPref = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v;
  } catch {
    return def;
  }
};
const writePref = (key, v) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* не страшно */
  }
};
const short = (h) => (h ? h.slice(0, 7) : '');
const fullDateTime = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Файл целиком: «История файла (Log)» — коммиты, менявшие файл (и через переименования), с diff каждого и сравнением
 * двух любых версий; «Blame» — кто и когда последним менял каждую строку, с тепловой картой возраста строк.
 *
 * view: { path, rev, mode: 'history' | 'blame', blameRev, blamePath, focus } — rev: от какого коммита строить историю (null — HEAD);
 * blameRev: версия для blame (null — рабочая папка, 'HEAD' или хэш).
 */
export default function FileView({ repoPath, view, hidden, onChange, onClose, onLocate, onRestore, isLoaded, notify }) {
  const mode = view.mode;
  const parts = view.path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 animate-fade-in flex-col bg-gk-bg ${hidden ? 'hidden' : ''}`} data-testid="file-view" data-mode={mode}>
      <div className="glass flex h-10 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
        {mode === 'history' ? <FileClock size={15} className="shrink-0 text-gk-blue" /> : <FileUser size={15} className="shrink-0 text-gk-yellow" />}
        <div className="min-w-0 flex-1 truncate text-[13px]" title={view.path}>
          {dir && <span className="text-gk-muted">{dir}/</span>}
          <span className="font-medium text-gk-strong">{name}</span>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-gk-border">
          <ModeTab active={mode === 'history'} onClick={() => onChange({ mode: 'history' })} icon={History} testid="fv-tab-history">
            История файла
          </ModeTab>
          <ModeTab active={mode === 'blame'} onClick={() => onChange({ mode: 'blame' })} icon={FileUser} testid="fv-tab-blame">
            Blame
          </ModeTab>
        </div>
        <button onClick={onClose} title="Закрыть (Esc)" aria-label="Закрыть" className="rounded p-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <X size={15} />
        </button>
      </div>
      {mode === 'history' ? (
        <HistoryMode key={`${view.path}:${view.rev ?? ''}`} repoPath={repoPath} view={view} onChange={onChange} onClose={onClose} onLocate={onLocate} onRestore={onRestore} hidden={hidden} />
      ) : (
        <BlameMode
          key={`${view.path}`}
          repoPath={repoPath}
          view={view}
          onChange={onChange}
          onClose={onClose}
          onLocate={onLocate}
          isLoaded={isLoaded}
          hidden={hidden}
          notify={notify}
        />
      )}
    </div>
  );
}

function ModeTab({ active, onClick, icon: Icon, children, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors ${active ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted hover:bg-gk-hover hover:text-gk-text'}`}
    >
      <Icon size={13} /> {children}
    </button>
  );
}

function Avatar({ name, size = 18 }) {
  return (
    <span
      style={{ backgroundColor: avatarColor(name ?? '?'), width: size, height: size, fontSize: Math.max(7, size * 0.42) }}
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      title={name}
    >
      {initials(name ?? '?')}
    </span>
  );
}

function Center({ children, className = '' }) {
  return <div className={`flex flex-1 items-center justify-center gap-2 p-6 text-center text-[13px] text-gk-muted ${className}`}>{children}</div>;
}

/* =================== История файла =================== */

function HistoryMode({ repoPath, view, onChange, onClose, onLocate, onRestore, hidden }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [sel, setSel] = useState(0); // выбранный коммит (индекс)
  const [cmp, setCmp] = useState(null); // второй коммит для сравнения версий
  const [diffView, setDiffView] = useState(() => readPref('diffView', 'unified'));
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [loaded, setLoaded] = useState(null); // diff, загруженный отдельно: { key, data }
  const listRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: null });
    api.repo.fileHistory(repoPath, { path: view.path, rev: view.rev ?? null }).then((res) => {
      if (!alive) return;
      if (!res.ok) return setState({ loading: false, data: null, error: res.error });
      setState({ loading: false, data: res.data, error: null });
      const at = view.focus ? res.data.commits.findIndex((c) => c.hash === view.focus) : 0;
      setSel(Math.max(0, at));
    });
    return () => {
      alive = false;
    };
  }, [repoPath, view.path, view.rev, view.focus]);

  const commits = state.data?.commits ?? [];
  const cur = commits[sel] ?? null;
  const other = cmp != null ? commits[cmp] : null;
  // Сравнение: старая версия → новая (по порядку в истории)
  const [older, newer] = other ? (cmp > sel ? [other, cur] : [cur, other]) : [null, cur];

  // Что показать справа: diff коммита или разницу двух версий
  const target = useMemo(() => {
    if (!cur) return null;
    const files = commits.map((c) => ({ path: c.path, oldPath: c.oldPath, status: c.status }));
    if (older) {
      return {
        kind: 'compare',
        mode: 'commit',
        hash: newer.hash,
        parent: older.hash,
        commitHash: newer.hash,
        file: { path: newer.path, oldPath: older.path !== newer.path ? older.path : null, status: newer.status === 'D' ? 'D' : older.path !== newer.path ? 'R' : 'M' },
        list: files,
        index: sel,
      };
    }
    return {
      kind: 'history',
      mode: 'commit',
      hash: cur.hash,
      parent: cur.parents[0] ?? null,
      commitHash: cur.hash,
      file: { path: cur.path, oldPath: cur.oldPath, status: cur.status },
      list: files,
      index: sel,
    };
  }, [cur, older, newer, commits, sel]);

  const diffKey = target ? `${target.parent ?? 'root'}..${target.hash}:${target.file.path}:${ignoreWs ? 'w' : ''}` : null;
  const preloaded = target && !older && !ignoreWs && cur?.diff ? { ...cur.diff, mode: 'commit' } : null;
  useEffect(() => {
    if (!target || preloaded || loaded?.key === diffKey) return undefined;
    let alive = true;
    api.repo
      .fileDiff(repoPath, {
        mode: 'commit',
        hash: target.hash,
        parent: target.parent,
        path: target.file.path,
        oldPath: target.file.oldPath,
        ignoreWhitespace: ignoreWs,
      })
      .then((res) => {
        if (alive) setLoaded({ key: diffKey, data: res.ok ? { ...res.data, mode: 'commit' } : { error: res.error.message, path: target.file.path, mode: 'commit' } });
      });
    return () => {
      alive = false;
    };
  }, [diffKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = preloaded ?? (loaded?.key === diffKey ? loaded.data : null);

  // Выбранный коммит — в видимой части списка
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (i, e) => {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      if (i !== sel) setCmp(i === cmp ? null : i);
      return;
    }
    setSel(i);
    setCmp(null);
  };

  if (state.loading) {
    return (
      <Center>
        <Loader2 size={15} className="animate-spin" /> Читаем историю файла…
      </Center>
    );
  }
  if (state.error) return <Center className="text-gk-red">{state.error.message}</Center>;
  if (!commits.length) {
    return <Center>У файла ещё нет истории: он не закоммичен{view.rev ? ' в этой версии' : ''}.</Center>;
  }

  const restoreTarget = newer ?? cur;
  return (
    <div className="flex min-h-0 flex-1">
      {/* Таймлайн коммитов файла */}
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-gk-border bg-gk-panel/60">
        <div className="shrink-0 border-b border-gk-border px-3 py-2 text-[11.5px] text-gk-muted">
          <div className="flex items-center gap-1.5">
            <span data-testid="fh-count">
              {commits.length}
              {state.data.truncated ? '+' : ''} {plural(commits.length, 'коммит', 'коммита', 'коммитов')}
            </span>
            {state.data.renamed && <span className="rounded bg-gk-purple/15 px-1.5 text-[10.5px] text-gk-purple">с переименованиями</span>}
            {view.rev && <span className="truncate text-gk-dim">до {short(view.rev)}</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-gk-dim">{kb('Ctrl+клик — вторая версия для сравнения')}</div>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="fh-list">
          {commits.map((c, i) => {
            const isSel = i === sel;
            const isCmp = i === cmp;
            const st = FILE_STATUS[c.status] ?? FILE_STATUS.M;
            return (
              <div
                key={c.hash}
                role="button"
                tabIndex={-1}
                data-testid="fh-item"
                data-selected={isSel ? 'true' : undefined}
                data-compare={isCmp ? 'true' : undefined}
                onClick={(e) => pick(i, e)}
                className={`group relative mx-1 cursor-pointer rounded-md border-l-2 px-2.5 py-1.5 transition-colors ${
                  isSel ? 'border-gk-blue bg-gk-blue/15' : isCmp ? 'border-gk-purple bg-gk-purple/10' : 'border-transparent hover:bg-gk-hover'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {(isSel || isCmp) && cmp != null && (
                    <span className={`rounded px-1 text-[9.5px] font-bold ${isSel ? 'bg-gk-blue/25 text-gk-blue' : 'bg-gk-purple/25 text-gk-purple'}`}>
                      {(isSel ? sel : cmp) > (isSel ? cmp : sel) ? 'A' : 'B'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-gk-text" title={c.subject}>
                    {c.subject}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px]">
                    {c.binary ? (
                      <span className="text-gk-dim">bin</span>
                    ) : (
                      <>
                        <span className="text-gk-green">+{c.additions}</span> <span className="text-gk-red">−{c.deletions}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gk-dim">
                  <Avatar name={c.author} size={14} />
                  <span className="truncate">{c.author}</span>
                  <span className="shrink-0">· {relativeTime(c.date)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocate(c.hash);
                    }}
                    title="Показать коммит в графе"
                    className="ml-auto shrink-0 font-mono text-gk-blue/80 hover:text-gk-blue hover:underline"
                  >
                    {short(c.hash)}
                  </button>
                </div>
                {c.status !== 'M' && (
                  <div className="mt-0.5 truncate text-[10.5px]" style={{ color: readable(st.color) }} title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}>
                    {c.status === 'A' ? 'файл создан' : c.status === 'D' ? 'файл удалён' : c.status === 'R' ? `переименован из ${c.oldPath}` : `скопирован из ${c.oldPath}`}
                  </div>
                )}
                {i !== sel && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCmp(i === cmp ? null : i);
                    }}
                    data-testid="fh-compare"
                    title={i === cmp ? 'Убрать из сравнения' : 'Сравнить эту версию с выбранной'}
                    className={`absolute right-1.5 top-1.5 hidden rounded bg-gk-panel p-0.5 ring-1 ring-gk-border group-hover:block ${i === cmp ? 'text-gk-purple' : 'text-gk-muted hover:text-gk-text'}`}
                  >
                    <GitCompareArrows size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {state.data.truncated && <div className="px-3 py-2 text-[11px] text-gk-dim">Показаны последние {commits.length} коммитов</div>}
        </div>
      </aside>

      {/* Diff выбранного коммита / разница двух версий */}
      <div className="flex min-w-0 flex-1 flex-col">
        {older && (
          <div data-testid="fh-compare-bar" className="flex shrink-0 items-center gap-2 border-b border-gk-border bg-gk-purple/[0.07] px-3 py-1.5 text-[12px] text-gk-muted">
            <GitCompareArrows size={13} className="text-gk-purple" />
            Сравнение версий: <span className="font-mono text-gk-text">A {short(older.hash)}</span> → <span className="font-mono text-gk-text">B {short(newer.hash)}</span>
            <span className="truncate text-gk-dim">
              ({relativeTime(older.date)} → {relativeTime(newer.date)})
            </span>
            <button onClick={() => setCmp(null)} className="ml-auto text-gk-blue hover:underline">
              Обычный режим
            </button>
          </div>
        )}
        {target && !hidden && (
          <DiffView
            key={diffKey}
            target={target}
            data={data}
            view={diffView}
            ignoreWhitespace={ignoreWs}
            onViewChange={(v) => {
              setDiffView(v);
              writePref('diffView', v);
            }}
            onToggleWhitespace={() => setIgnoreWs((v) => !v)}
            onPrev={sel > 0 ? () => pick(sel - 1) : null}
            onNext={sel < commits.length - 1 ? () => pick(sel + 1) : null}
            onClose={onClose}
            fileActions={[
              {
                label: older ? `Восстановить версию B` : 'Восстановить файл к этой версии',
                icon: RotateCcw,
                title: `Файл ${view.path} в рабочей папке станет таким, как в коммите ${short(restoreTarget.hash)}${
                  restoreTarget.path !== view.path ? ` (тогда он назывался ${restoreTarget.path})` : ''
                }. Коммит не создаётся, Undo вернёт.`,
                onClick: () => onRestore(restoreTarget),
              },
              {
                label: 'Blame этой версии',
                icon: FileUser,
                title: `Кто и когда менял строки — в версии ${short(restoreTarget.hash)}`,
                onClick: () =>
                  onChange(
                    restoreTarget.status === 'D'
                      ? { mode: 'blame', blameRev: restoreTarget.parents[0] ?? null, blamePath: restoreTarget.oldPath ?? restoreTarget.path, blameStack: [] }
                      : { mode: 'blame', blameRev: restoreTarget.hash, blamePath: restoreTarget.path, blameStack: [] },
                  ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/* =================== Blame =================== */

const ROW_H = 20;
const OVERSCAN = 40;

function BlameMode({ repoPath, view, onChange, onClose, onLocate, isLoaded, hidden, notify }) {
  const rev = view.blameRev === undefined ? 'HEAD' : view.blameRev;
  const file = view.blamePath ?? view.path;
  const [ignoreWs, setIgnoreWs] = useState(() => readPref('blameIgnoreWs', '0') === '1');
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [hoverSha, setHoverSha] = useState(null);
  const [pop, setPop] = useState(null); // { sha, top, left }
  const [infos, setInfos] = useState({}); // sha → данные для поповера
  const scrollRef = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const popTimer = useRef(null);
  const stack = view.blameStack ?? [];

  useEffect(() => {
    let alive = true;
    setState((s) => ({ loading: true, data: s.data, error: null }));
    api.repo.blame(repoPath, { path: file, rev, ignoreWhitespace: ignoreWs }).then((res) => {
      if (!alive) return;
      setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error });
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
    return () => {
      alive = false;
    };
  }, [repoPath, file, rev, ignoreWs]);

  // Esc — назад по «Blame до коммита», затем закрыть
  useEffect(() => {
    if (hidden) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.fixed.inset-0')) return;
      if (pop) setPop(null);
      else if (stack.length) back();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setScroll({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.loading]);

  const data = state.data;
  const lines = data?.lines ?? [];
  const lang = useMemo(() => detectLanguage(file), [file]);
  const tokens = useMemo(() => (lines.length && lines.length < 20000 ? highlightLines(lines.map((l) => l.text), lang) : null), [data, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Блоки строк одного коммита и «возраст» коммитов для тепловой карты
  const { blockStart, heat } = useMemo(() => {
    const starts = new Set();
    lines.forEach((l, i) => {
      if (i === 0 || lines[i - 1].sha !== l.sha) starts.add(i);
    });
    const times = Object.entries(data?.commits ?? {})
      .filter(([, c]) => !c.uncommitted && c.time)
      .map(([sha, c]) => [sha, c.time])
      .sort((a, b) => b[1] - a[1]);
    const rank = new Map(times.map(([sha], i) => [sha, i]));
    const map = new Map();
    const n = Math.max(1, times.length - 1);
    for (const [sha] of times) map.set(sha, 1 - rank.get(sha) / n); // 1 — самый свежий, 0 — самый старый
    for (const [sha, c] of Object.entries(data?.commits ?? {})) if (c.uncommitted) map.set(sha, 1);
    return { blockStart: starts, heat: map };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);

  const loadInfo = useCallback(
    (sha) => {
      if (infos[sha] || /^0+$/.test(sha)) return;
      setInfos((m) => ({ ...m, [sha]: { loading: true } }));
      api.repo.commitInfo(repoPath, { hash: sha, path: data?.commits?.[sha]?.filename ?? file }).then((res) => {
        setInfos((m) => ({ ...m, [sha]: res.ok ? res.data : { error: res.error.message } }));
      });
    },
    [infos, repoPath, data, file],
  );

  const showPop = (sha, el) => {
    clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => {
      const box = scrollRef.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!box) return;
      setPop({ sha, top: r.top - box.top + scrollRef.current.scrollTop, left: 8 });
      loadInfo(sha);
    }, 350);
  };
  const hidePop = () => {
    clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPop(null), 250);
  };
  const keepPop = () => clearTimeout(popTimer.current);

  const priorOf = (sha) => data?.commits?.[sha]?.previous ?? null;
  const blamePrior = (sha) => {
    const prev = priorOf(sha);
    if (!prev) return;
    setPop(null);
    onChange({ blameRev: prev.sha, blamePath: prev.path, blameStack: [...stack, { rev, path: file, line: Math.floor((scrollRef.current?.scrollTop ?? 0) / ROW_H), from: sha }] });
  };
  const back = () => {
    const prev = stack.at(-1);
    if (!prev) return;
    onChange({ blameRev: prev.rev, blamePath: prev.path, blameStack: stack.slice(0, -1) });
  };
  const locate = (sha) => {
    if (/^0+$/.test(sha)) return;
    if (isLoaded && !isLoaded(sha)) {
      notify?.({ type: 'info', title: `Коммита ${short(sha)} нет в загруженной истории графа`, hint: 'Он старше загруженных коммитов или в другой ветке — сделайте Fetch или увеличьте историю' });
      return;
    }
    onLocate(sha);
  };

  const revLabel = rev == null ? 'рабочая папка (с незакоммиченными строками)' : rev === 'HEAD' ? 'HEAD' : `версия ${short(rev)}`;
  const popCommit = pop ? data?.commits?.[pop.sha] : null;
  const popInfo = pop ? infos[pop.sha] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Панель: версия, пробелы, назад */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel/60 px-3 py-1.5 text-[12px] text-gk-muted">
        {stack.length > 0 && (
          <button onClick={back} data-testid="blame-back" title="Назад к предыдущему blame (Esc)" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-gk-blue hover:bg-gk-hover">
            <ArrowLeft size={13} /> Назад
          </button>
        )}
        <span data-testid="blame-rev" className="min-w-0 truncate" title={file !== view.path ? `${revLabel} · тогда файл назывался ${file}` : revLabel}>
          Blame: <span className="font-mono text-gk-text">{revLabel}</span>
          {file !== view.path && <span className="text-gk-dim"> · тогда файл назывался {file}</span>}
        </span>
        {stack.length > 0 && <span className="shrink-0 text-gk-dim">· глубина {stack.length}</span>}
        {(rev !== 'HEAD' || stack.length > 0) && (
          <button onClick={() => onChange({ blameRev: 'HEAD', blamePath: null, blameStack: [] })} className="shrink-0 text-gk-blue hover:underline">
            к HEAD
          </button>
        )}
        {rev === 'HEAD' && !stack.length && (
          <button onClick={() => onChange({ blameRev: null, blamePath: null })} className="shrink-0 text-gk-blue hover:underline" title="С незакоммиченными изменениями">
            рабочая папка
          </button>
        )}
        <div className="flex-1" />
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-gk-dim md:flex" title="Тепловая карта: чем свежее изменение, тем ярче полоса">
          старые
          <span className="h-2 w-16 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-gk-yellow) 12%, transparent), var(--color-gk-yellow))' }} />
          свежие
        </span>
        <button
          onClick={() =>
            setIgnoreWs((v) => {
              writePref('blameIgnoreWs', v ? '0' : '1');
              return !v;
            })
          }
          data-testid="blame-ws"
          aria-pressed={ignoreWs}
          title="Игнорировать пробелы (git blame -w): правки только в отступах не считаются изменением строки"
          className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 ring-1 transition-colors ${ignoreWs ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'ring-gk-border hover:text-gk-text'}`}
        >
          <Space size={12} /> Игнорировать пробелы
        </button>
        {state.loading && state.data && <Loader2 size={13} className="animate-spin" />}
      </div>

      {state.loading && !state.data ? (
        <Center>
          <Loader2 size={15} className="animate-spin" /> Считаем авторство строк…
        </Center>
      ) : state.error ? (
        <Center className="text-gk-red">
          <span>
            {state.error.message}
            {state.error.hint && <span className="block text-[12px] text-gk-muted">{state.error.hint}</span>}
          </span>
        </Center>
      ) : !lines.length ? (
        <Center>Файл пустой</Center>
      ) : (
        <div
          ref={scrollRef}
          data-testid="blame-scroll"
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
          className="relative min-h-0 flex-1 overflow-auto font-mono text-[12px] [tab-size:4]"
        >
          <div style={{ height: lines.length * ROW_H }} className="relative min-w-max">
            {lines.slice(first, last).map((l, k) => {
              const i = first + k;
              const c = data.commits[l.sha] ?? {};
              const start = blockStart.has(i);
              const h = heat.get(l.sha) ?? 0;
              const hot = hoverSha === l.sha;
              const uncommitted = c.uncommitted;
              return (
                <div
                  key={i}
                  data-testid="blame-row"
                  data-line={i + 1}
                  data-sha={l.sha}
                  style={{ top: i * ROW_H, height: ROW_H }}
                  className={`absolute inset-x-0 flex ${hot ? 'bg-gk-blue/[0.07]' : ''}`}
                  onMouseEnter={() => setHoverSha(l.sha)}
                >
                  {/* Колонка blame */}
                  <div
                    data-testid={start ? 'blame-block' : undefined}
                    data-sha={l.sha}
                    onMouseEnter={(e) => start && showPop(l.sha, e.currentTarget)}
                    onMouseLeave={hidePop}
                    className={`sticky left-0 z-[1] flex w-[300px] shrink-0 items-center gap-1.5 border-r border-gk-border bg-[var(--gk-solid)] pr-2 font-sans text-[11px] ${start && i > 0 ? 'border-t border-t-gk-border/70' : ''}`}
                  >
                    <span
                      className="h-full w-[4px] shrink-0"
                      title={uncommitted ? 'Не закоммичено' : `Возраст: ${relativeTime(c.time)}`}
                      style={{ background: `color-mix(in srgb, var(${uncommitted ? '--color-gk-green' : '--color-gk-yellow'}) ${Math.round(12 + h * 88)}%, transparent)` }}
                    />
                    {start ? (
                      uncommitted ? (
                        <span className="truncate italic text-gk-green">Не закоммичено</span>
                      ) : (
                        <>
                          <Avatar name={c.author} size={15} />
                          <span className="min-w-0 flex-1 truncate" style={{ opacity: 0.55 + h * 0.45 }}>
                            <span className="text-gk-text">{c.author}</span> <span className="text-gk-dim">· {c.summary}</span>
                          </span>
                          <span className="shrink-0 text-gk-dim">{relativeTime(c.time)}</span>
                          <button
                            onClick={() => locate(l.sha)}
                            data-testid="blame-hash"
                            title="Показать коммит в графе"
                            className="shrink-0 font-mono text-gk-blue/85 hover:text-gk-blue hover:underline"
                          >
                            {short(l.sha)}
                          </button>
                          <button
                            onClick={() => blamePrior(l.sha)}
                            disabled={!c.previous}
                            data-testid="blame-prior"
                            title={c.previous ? `Blame до этого коммита (${short(c.previous.sha)})` : 'Строки появились вместе с файлом — раньше их не было'}
                            className="shrink-0 rounded p-0.5 text-gk-dim hover:bg-gk-hover hover:text-gk-text disabled:opacity-30"
                          >
                            <CornerLeftUp size={12} />
                          </button>
                        </>
                      )
                    ) : null}
                  </div>
                  {/* Номер строки и код */}
                  <span className="w-12 shrink-0 select-none pr-3 text-right leading-5 text-gk-dim">{i + 1}</span>
                  <span className="whitespace-pre pr-6 leading-5 text-gk-text/90" style={{ opacity: uncommitted ? 1 : 0.62 + h * 0.38 }}>
                    <TokenText tokens={tokens?.[i]} text={l.text} />
                  </span>
                </div>
              );
            })}
          </div>

          {/* Поповер коммита */}
          {pop && popCommit && (
            <div
              data-testid="blame-popover"
              onMouseEnter={keepPop}
              onMouseLeave={hidePop}
              style={{ top: pop.top + ROW_H + 2, left: pop.left }}
              className="absolute z-20 w-[420px] animate-pop-in rounded-lg border border-gk-fg/10 bg-[var(--gk-solid-2)] p-3 shadow-2xl shadow-gk-sink/60 ring-1 ring-gk-sink/40 font-sans text-[12px] shadow-xl"
            >
              <div className="flex items-start gap-2">
                <Avatar name={popCommit.author} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gk-strong">{popCommit.author}</div>
                  <div className="text-[11px] text-gk-dim">
                    {popCommit.email} · {fullDateTime(popCommit.time)}
                  </div>
                </div>
                <button onClick={() => locate(pop.sha)} className="font-mono text-[11px] text-gk-blue hover:underline" title="Показать в графе">
                  {short(pop.sha)}
                </button>
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-gk-text" data-testid="blame-popover-message">
                <div className="font-medium">{popInfo?.subject ?? popCommit.summary}</div>
                {popInfo?.body && <div className="mt-1 text-[11.5px] text-gk-muted">{popInfo.body}</div>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gk-border pt-2 text-[11px] text-gk-muted" data-testid="blame-popover-stats">
                {popInfo?.loading ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" /> статистика…
                  </span>
                ) : popInfo?.error ? (
                  <span className="text-gk-red">{popInfo.error}</span>
                ) : popInfo ? (
                  <>
                    <span>
                      файлов: <span className="text-gk-text">{popInfo.files}</span>
                    </span>
                    <span>
                      <span className="text-gk-green">+{popInfo.additions}</span> <span className="text-gk-red">−{popInfo.deletions}</span>
                    </span>
                    {popInfo.fileStat && (
                      <span>
                        в этом файле: <span className="text-gk-green">+{popInfo.fileStat.additions}</span> <span className="text-gk-red">−{popInfo.fileStat.deletions}</span>
                      </span>
                    )}
                    <span>строк в blame: {lines.filter((x) => x.sha === pop.sha).length}</span>
                  </>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <PopBtn icon={LocateFixed} onClick={() => locate(pop.sha)}>
                  Показать в графе
                </PopBtn>
                <PopBtn icon={CornerLeftUp} disabled={!popCommit.previous} onClick={() => blamePrior(pop.sha)} testid="blame-popover-prior">
                  Blame до этого коммита
                </PopBtn>
                <PopBtn
                  icon={History}
                  onClick={() => {
                    setPop(null);
                    onChange({ mode: 'history', rev: pop.sha, focus: pop.sha, path: popCommit.filename ?? file });
                  }}
                >
                  Изменения в истории файла
                </PopBtn>
              </div>
            </div>
          )}
        </div>
      )}
      {data?.truncated && <div className="border-t border-gk-border px-3 py-1 text-[11px] text-gk-dim">Файл слишком большой — показаны первые {lines.length} строк</div>}
    </div>
  );
}

function PopBtn({ icon: Icon, children, testid, ...props }) {
  return (
    <button
      {...props}
      data-testid={testid}
      className="flex items-center gap-1 rounded-md bg-gk-hover px-2 py-1 text-[11.5px] text-gk-text transition-colors enabled:hover:bg-gk-fg/10 disabled:opacity-40"
    >
      <Icon size={12} /> {children}
    </button>
  );
}
