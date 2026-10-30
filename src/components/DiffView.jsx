import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, CaseSensitive, ChevronDown, ChevronUp, CodeXml, Columns2, Diff, FileText, Highlighter, Loader2, Regex, Rows3, Search, Space, X } from 'lucide-react';
import { FILE_STATUS } from '../lib/format.js';
import { inlineHighlights } from '../lib/inlineDiff.js';
import { detectLanguage, findAll, highlightHunks, languageName, layerLine, searchRegex } from '../lib/highlight.js';
import { isMod, kb } from '../lib/platform.js';
import { readable } from '../lib/scheme.js';

const writePref = (key, on) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* не страшно */
  }
};

// Поиск переносится между файлами: открыли следующий файл — строка поиска остаётся
let lastSearch = null;
const MAX_HITS = 5000;

const readPref = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
};

const MODE_LABELS = {
  commit: (t) => (t.kind === 'compare' ? `${t.parent.slice(0, 7)} → ${t.hash.slice(0, 7)}` : t.kind === 'stash' ? (t.stashId ?? 'stash') : `коммит ${t.hash.slice(0, 7)}`),
  staged: () => 'staged',
  unstaged: () => 'unstaged',
  untracked: () => 'новый файл',
};

export default function DiffView({
  target,
  data,
  view,
  ignoreWhitespace,
  onViewChange,
  onToggleWhitespace,
  onPrev,
  onNext,
  onClose,
  hunkActions,
  onHunkAction,
  fileActions,
  guardMarkers,
  initialSearch,
}) {
  const [hunkBusy, setHunkBusy] = useState(null);
  // Действия с фрагментом (stage / отменить …) — только когда фрагменты считаются по точному тексту
  const actions = ignoreWhitespace ? null : hunkActions?.length ? hunkActions : null;
  const runHunk = async (action, hunk, index) => {
    setHunkBusy(`${action.id}:${index}`);
    try {
      await onHunkAction(action.id, hunk);
    } finally {
      setHunkBusy(null);
    }
  };
  const hunkProps = actions ? { actions, busy: hunkBusy, onRun: runHunk } : null;

  const [inline, setInline] = useState(() => readPref('diff.inline', true));
  const scrollRef = useRef(null);
  const [current, setCurrent] = useState(-1); // текущий фрагмент изменений для навигации

  // Подсветка изменений внутри строк — для каждого фрагмента (hunk) своя карта
  const highlights = useMemo(
    () => (inline && data?.hunks ? data.hunks.map((h) => inlineHighlights(h.lines)) : null),
    [inline, data],
  );

  // Блоки изменений (подряд идущие +/−) — по ним ходим кнопками и F7
  const changeCount = useMemo(() => {
    if (!data?.hunks) return 0;
    let n = 0;
    for (const h of data.hunks) {
      let prev = ' ';
      for (const l of h.lines) {
        if ((l.t === '+' || l.t === '-') && prev !== '+' && prev !== '-') n++;
        prev = l.t;
      }
    }
    return n;
  }, [data]);

  useEffect(() => setCurrent(-1), [data]);

  const goChange = (dir) => {
    const blocks = [...(scrollRef.current?.querySelectorAll('[data-change]') ?? [])];
    if (!blocks.length) return;
    const next = current === -1 ? (dir > 0 ? 0 : blocks.length - 1) : (current + dir + blocks.length) % blocks.length;
    setCurrent(next);
    blocks[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
    blocks[next].animate?.([{ backgroundColor: 'rgb(47 155 255 / 0.35)' }, { backgroundColor: 'transparent' }], { duration: 900 });
  };

  const toggleInline = () =>
    setInline((v) => {
      writePref('diff.inline', !v);
      return !v;
    });

  /* ---------- Подсветка синтаксиса: сначала текст, цвета — следом (не задерживает открытие файла) ---------- */
  const [syntaxOn, setSyntaxOn] = useState(() => readPref('diff.syntax', true));
  const lang = useMemo(() => detectLanguage(target.file.path), [target.file.path]);
  const [syntax, setSyntax] = useState(null);
  useEffect(() => {
    setSyntax(null);
    if (!syntaxOn || !lang || !data?.hunks?.length) return undefined;
    let alive = true;
    const timer = setTimeout(() => alive && setSyntax(highlightHunks(data.hunks, lang)), 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [syntaxOn, lang, data]);
  const toggleSyntax = () =>
    setSyntaxOn((v) => {
      writePref('diff.syntax', !v);
      return !v;
    });

  /* ---------- Поиск в изменениях (Ctrl+F) ---------- */
  const [search, setSearch] = useState(() => {
    const init = initialSearch ?? (lastSearch?.open ? lastSearch : null);
    return { open: Boolean(init), query: init?.query ?? '', caseSensitive: Boolean(init?.caseSensitive), regex: Boolean(init?.regex), changedOnly: Boolean(init?.changedOnly) };
  });
  const [hitIndex, setHitIndex] = useState(0);
  const jumpLine = useRef(initialSearch?.line ?? null); // открыли из поиска по сравнению — к этой строке
  const searchInput = useRef(null);
  useEffect(() => {
    lastSearch = search;
  }, [search]);
  const patchSearch = (p) => setSearch((s) => ({ ...s, ...p }));
  const openSearch = () => {
    patchSearch({ open: true });
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  };
  const closeSearch = () => patchSearch({ open: false });

  const { re: searchRe, error: searchError } = useMemo(
    () => (search.open ? searchRegex(search.query, search) : { re: null }),
    [search],
  );
  const hits = useMemo(() => {
    const out = [];
    if (!searchRe || !data?.hunks) return out;
    outer: for (let hi = 0; hi < data.hunks.length; hi++) {
      const lines = data.hunks[hi].lines;
      for (let li = 0; li < lines.length; li++) {
        const l = lines[li];
        if (l.t === '\\' || (search.changedOnly && l.t === ' ')) continue;
        for (const m of findAll(l.text, searchRe)) {
          out.push({ hi, li, start: m.start, end: m.end });
          if (out.length >= MAX_HITS) break outer;
        }
      }
    }
    return out;
  }, [searchRe, data, search.changedOnly]);
  // Совпадения по строкам: массивы стабильны между переходами — перерисовываются только две строки
  const hitsByLine = useMemo(() => {
    const map = new Map();
    hits.forEach((h, idx) => {
      const key = `${h.hi}:${h.li}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ start: h.start, end: h.end, idx });
    });
    return map;
  }, [hits]);

  // Новые совпадения: к строке из поиска по сравнению или к первому
  useEffect(() => {
    if (!hits.length) {
      setHitIndex(0);
      return;
    }
    const want = jumpLine.current;
    if (want && data?.hunks) {
      const at = hits.findIndex((h) => {
        const l = data.hunks[h.hi].lines[h.li];
        return l.t === want.t && (want.t === '-' ? l.o === want.o : l.n === want.n);
      });
      if (at >= 0) {
        jumpLine.current = null;
        setHitIndex(at);
        return;
      }
    }
    setHitIndex(0);
  }, [hits, data]);

  // Текущее совпадение — в центр экрана
  useEffect(() => {
    if (!search.open || !hits.length) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.querySelector('[data-hit-current]')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hitIndex, hits, search.open, view]);

  const stepHit = (dir) => hits.length && setHitIndex((i) => (i + dir + hits.length) % hits.length);
  const hitsAt = (hi, li) => hitsByLine.get(`${hi}:${li}`) ?? null;
  const lineView = { syntax, hitsAt, current: search.open && hits.length ? hitIndex : null };

  // Ctrl+F — поиск в этом файле (а не по коммитам); перехватываем раньше общего обработчика окна
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return;
      const key = e.key.toLowerCase();
      if (isMod(e) && !e.altKey && !e.shiftKey && (key === 'f' || key === 'а')) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      } else if (e.key === 'F3' && search.open) {
        e.preventDefault();
        e.stopPropagation();
        stepHit(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Esc — закрыть, Alt+↑/↓ — предыдущий/следующий файл, F7 / Shift+F7 — следующее/предыдущее изменение
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return; // открыт диалог
      if (e.key === 'Escape') {
        if (search.open) closeSearch();
        else onClose();
      }
      if (e.altKey && e.key === 'ArrowUp' && onPrev) onPrev();
      if (e.altKey && e.key === 'ArrowDown' && onNext) onNext();
      if (e.key === 'F7') {
        e.preventDefault();
        goChange(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const file = target.file;
  const parts = file.path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  const raw = FILE_STATUS[file.status] ?? FILE_STATUS.M;
  const status = { ...raw, color: readable(raw.color) };

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg">
      {/* Заголовок */}
      <div className="glass flex h-10 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
        <span
          style={{ color: status.color, backgroundColor: `${status.color}22` }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
          title={status.label}
        >
          {file.status}
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px]" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {file.oldPath && file.oldPath !== file.path && (
            <span className="text-gk-dim">{file.oldPath} → </span>
          )}
          {dir && <span className="text-gk-muted">{dir}/</span>}
          <span className="font-medium text-gk-strong">{name}</span>
          <span className="ml-2 rounded bg-gk-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gk-muted">
            {MODE_LABELS[target.mode]?.(target)}
          </span>
        </div>

        {data && !data.error && !data.binary && (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-gk-green">+{data.additions}</span>{' '}
            <span className="text-gk-red">−{data.deletions}</span>
          </span>
        )}

        {fileActions?.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            title={a.title}
            disabled={a.disabled}
            data-testid="diff-file-action"
            data-label={a.label}
            className={`ml-1 flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11.5px] ring-1 ring-gk-border transition-colors disabled:opacity-40 ${
              a.danger ? 'text-gk-red enabled:hover:bg-gk-red/10' : 'text-gk-muted enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
            }`}
          >
            {a.icon && <a.icon size={12} />} {a.label}
          </button>
        ))}

        <div className="ml-2 flex overflow-hidden rounded ring-1 ring-gk-border">
          <ToggleButton active={view === 'unified'} onClick={() => onViewChange('unified')} title="Unified">
            <Rows3 size={13} />
          </ToggleButton>
          <ToggleButton active={view === 'split'} onClick={() => onViewChange('split')} title="Split">
            <Columns2 size={13} />
          </ToggleButton>
        </div>
        <ToggleButton
          active={ignoreWhitespace}
          onClick={onToggleWhitespace}
          title="Игнорировать изменения пробелов"
          className="rounded ring-1 ring-gk-border"
        >
          <Space size={13} />
        </ToggleButton>
        <ToggleButton
          active={inline}
          onClick={toggleInline}
          title="Подсвечивать, что именно изменилось внутри строки"
          className="rounded ring-1 ring-gk-border"
        >
          <Highlighter size={13} />
        </ToggleButton>
        <ToggleButton
          active={syntaxOn && Boolean(lang)}
          onClick={toggleSyntax}
          disabled={!lang}
          title={lang ? `Подсветка синтаксиса: ${languageName(lang)}` : 'Подсветка синтаксиса — тип файла не распознан'}
          data-testid="diff-syntax"
          className="rounded ring-1 ring-gk-border disabled:opacity-40"
        >
          <CodeXml size={13} />
        </ToggleButton>
        <ToggleButton
          active={search.open}
          onClick={() => (search.open ? closeSearch() : openSearch())}
          title={kb('Поиск в изменениях (Ctrl+F)')}
          data-testid="diff-search-toggle"
          className="rounded ring-1 ring-gk-border"
        >
          <Search size={13} />
        </ToggleButton>
        {changeCount > 0 && (
          <div className="ml-1 flex items-center rounded ring-1 ring-gk-border">
            <ToggleButton onClick={() => goChange(-1)} title="Предыдущее изменение (Shift+F7)">
              <ArrowUpToLine size={13} />
            </ToggleButton>
            <span className="min-w-[44px] select-none text-center text-[11px] text-gk-muted" title="Блоков изменений в файле">
              {current >= 0 ? `${current + 1} / ${changeCount}` : `${changeCount} изм.`}
            </span>
            <ToggleButton onClick={() => goChange(1)} title="Следующее изменение (F7)">
              <ArrowDownToLine size={13} />
            </ToggleButton>
          </div>
        )}

        <div className="ml-1 flex items-center">
          <span className="mr-1 text-[11px] text-gk-dim">
            {target.index + 1} / {target.list.length}
          </span>
          <IconBtn title={kb('Предыдущий файл (Alt+↑)')} disabled={!onPrev} onClick={onPrev}>
            <ChevronUp size={15} />
          </IconBtn>
          <IconBtn title={kb('Следующий файл (Alt+↓)')} disabled={!onNext} onClick={onNext}>
            <ChevronDown size={15} />
          </IconBtn>
          <IconBtn title="Закрыть (Esc)" onClick={onClose}>
            <X size={15} />
          </IconBtn>
        </div>
      </div>

      {search.open && (
        <SearchBar
          inputRef={searchInput}
          search={search}
          onChange={patchSearch}
          error={searchError}
          count={hits.length}
          capped={hits.length >= MAX_HITS}
          index={hitIndex}
          onStep={stepHit}
          onClose={closeSearch}
        />
      )}

      {/* Содержимое */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5 [tab-size:4]">
        {!data ? (
          <Placeholder>
            <Loader2 size={15} className="animate-spin" /> Загрузка diff…
          </Placeholder>
        ) : data.error ? (
          <Placeholder className="text-gk-red">{data.error}</Placeholder>
        ) : data.binary ? (
          <Placeholder>
            <FileText size={15} /> Бинарный файл — построчный diff недоступен
          </Placeholder>
        ) : data.tooLarge ? (
          <Placeholder>Файл слишком большой ({Math.round(data.size / 1024)} КБ) для просмотра</Placeholder>
        ) : data.hunks.length === 0 ? (
          <Placeholder>
            {data.eolOnly
              ? 'Изменились только окончания строк (CRLF ↔ LF) — текст файла тот же'
              : file.oldPath && file.oldPath !== file.path
              ? 'Файл переименован без изменения содержимого'
              : ignoreWhitespace
                ? 'Изменения только в пробелах'
                : 'Нет изменений в содержимом'}
          </Placeholder>
        ) : view === 'split' ? (
          <SplitDiff hunks={data.hunks} highlights={highlights} hunkProps={hunkProps} markers={guardMarkers} {...lineView} />
        ) : (
          <UnifiedDiff hunks={data.hunks} highlights={highlights} hunkProps={hunkProps} markers={guardMarkers} {...lineView} />
        )}
        {data?.truncated && (
          <div className="border-t border-gk-border px-4 py-2 font-sans text-xs text-gk-dim">
            Diff слишком большой — показана только часть строк
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Unified ---------- */

const LINE_STYLES = {
  '+': { row: 'bg-gk-green/[0.09]', num: 'bg-gk-green/[0.13] text-gk-green/70', sign: 'text-gk-green' },
  '-': { row: 'bg-gk-red/[0.10]', num: 'bg-gk-red/[0.15] text-gk-red/70', sign: 'text-gk-red' },
  ' ': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
  '\\': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
};

// Строка с находкой Pre-commit Guard: жёлтая/красная метка слева и подсказка
const markerOf = (markers, line) => (markers && line.t === '+' ? markers.get(line.n) : null);
const markerCls = (m) => (m ? (m.category === 'secret' ? 'shadow-[inset_3px_0_0_rgb(242_93_93)]' : 'shadow-[inset_3px_0_0_rgb(242_202_51)]') : '');

// Совпадения строки и номер текущего (если он в этой строке) — для мемоизированной строки
const lineHits = (hitsAt, current, hi, li) => {
  const hits = hitsAt?.(hi, li) ?? null;
  return { hits, current: hits && current !== null && hits.some((h) => h.idx === current) ? current : null };
};

export function UnifiedDiff({ hunks, highlights, hunkProps, markers, syntax, hitsAt, current = null }) {
  return (
    <div className="min-w-max pb-6">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="group/hunk">
          <HunkHeader hunk={hunk} index={hi} {...hunkProps} />
          {hunk.lines.map((line, li) => {
            const startsChange = (line.t === '+' || line.t === '-') && !['+', '-'].includes(hunk.lines[li - 1]?.t);
            return (
              <UnifiedRow
                key={li}
                line={line}
                startsChange={startsChange}
                mark={markerOf(markers, line)}
                segs={highlights?.[hi]?.get(li) ?? null}
                tokens={syntax?.[hi]?.get(li) ?? null}
                {...lineHits(hitsAt, current, hi, li)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

const UnifiedRow = memo(function UnifiedRow({ line, startsChange, mark, segs, tokens, hits, current }) {
  const s = LINE_STYLES[line.t];
  return (
    <div className={`flex ${s.row} ${markerCls(mark)}`} data-change={startsChange ? '' : undefined} title={mark ? `Pre-commit Guard: ${mark.label}` : undefined}>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.o ?? ''}</span>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.n ?? ''}</span>
      <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === '\\' ? '' : line.t}</span>
      <span className={`select-text whitespace-pre pr-6 ${line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'}`}>
        <LineText line={line} segs={segs} tokens={tokens} hits={hits} current={current} />
      </span>
    </div>
  );
});

/* ---------- Split ---------- */

// Сопоставляем удаления и добавления: похожие строки — друг напротив друга, контекст — в обе стороны.
// pairs: Map индекс удалённой → индекс добавленной (из подсветки внутри строк); без неё — по порядку.
function toSplitRows(lines, pairs) {
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.t === ' ' || line.t === '\\') {
      rows.push({ left: { line, idx: i }, right: { line, idx: i } });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].t === '-') dels.push(i++);
    while (i < lines.length && lines[i].t === '+') adds.push(i++);
    const paired = [...dels].filter((d) => pairs?.has(d));
    if (!paired.length) {
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        rows.push({
          left: dels[k] !== undefined ? { line: lines[dels[k]], idx: dels[k] } : null,
          right: adds[k] !== undefined ? { line: lines[adds[k]], idx: adds[k] } : null,
        });
      }
      continue;
    }
    let a = 0;
    for (const d of dels) {
      const target = pairs.get(d);
      if (target === undefined) {
        rows.push({ left: { line: lines[d], idx: d }, right: null });
        continue;
      }
      // Добавленные строки до пары — отдельными строками справа
      while (adds[a] !== undefined && adds[a] < target) {
        rows.push({ left: null, right: { line: lines[adds[a]], idx: adds[a] } });
        a++;
      }
      rows.push({ left: { line: lines[d], idx: d }, right: { line: lines[target], idx: target } });
      a++;
    }
    while (adds[a] !== undefined) {
      rows.push({ left: null, right: { line: lines[adds[a]], idx: adds[a] } });
      a++;
    }
  }
  return rows;
}

function SplitDiff({ hunks, highlights, hunkProps, markers, syntax, hitsAt, current = null }) {
  const prepared = useMemo(
    () => hunks.map((h, hi) => ({ hunk: h, rows: toSplitRows(h.lines, highlights?.[hi]?.pairs) })),
    [hunks, highlights],
  );
  return (
    <div className="pb-6">
      {prepared.map(({ hunk, rows }, hi) => (
        <div key={hi} className="group/hunk">
          <HunkHeader hunk={hunk} index={hi} {...hunkProps} />
          {rows.map((row, ri) => {
            const isChange = (r) => r && (r.line.t === '+' || r.line.t === '-');
            const prev = rows[ri - 1];
            const startsChange = (isChange(row.left) || isChange(row.right)) && !(prev && (isChange(prev.left) || isChange(prev.right)));
            return (
              <div key={ri} className="grid grid-cols-2" data-change={startsChange ? '' : undefined}>
                <SplitCell
                  cell={row.left}
                  segs={row.left ? highlights?.[hi]?.get(row.left.idx) ?? null : null}
                  tokens={row.left ? syntax?.[hi]?.get(row.left.idx) ?? null : null}
                  {...(row.left ? lineHits(hitsAt, current, hi, row.left.idx) : {})}
                  side="old"
                />
                <SplitCell
                  cell={row.right}
                  segs={row.right ? highlights?.[hi]?.get(row.right.idx) ?? null : null}
                  tokens={row.right ? syntax?.[hi]?.get(row.right.idx) ?? null : null}
                  {...(row.right ? lineHits(hitsAt, current, hi, row.right.idx) : {})}
                  side="new"
                  border
                  mark={row.right ? markerOf(markers, row.right.line) : null}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const SplitCell = memo(function SplitCell({ cell, segs, tokens, hits = null, current = null, side, border, mark }) {
  if (!cell) {
    return <div className={`bg-gk-fg/[0.02] ${border ? 'border-l border-gk-border' : ''}`} />;
  }
  const line = cell.line;
  const s = LINE_STYLES[line.t];
  const num = side === 'old' ? line.o : line.n;
  return (
    <div className={`flex min-w-0 ${s.row} ${border ? 'border-l border-gk-border' : ''} ${markerCls(mark)}`} title={mark ? `Pre-commit Guard: ${mark.label}` : undefined}>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{num ?? ''}</span>
      <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === ' ' || line.t === '\\' ? '' : line.t}</span>
      <span
        className={`min-w-0 select-text whitespace-pre-wrap break-all pr-3 ${
          line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'
        }`}
      >
        <LineText line={line} segs={segs} tokens={tokens} hits={hits} current={current} />
      </span>
    </div>
  );
});

// Изменённые куски строки — яркой «маркерной» подложкой (цвет текста — от подсветки синтаксиса);
// пробелы в изменении делаем видимыми. Совпадения поиска — жёлтым, текущее — оранжевым.
const CHANGED = {
  '-': 'rounded-[2px] bg-gk-red/35 shadow-[inset_0_-1px_0_rgb(242_93_93/0.6)]',
  '+': 'rounded-[2px] bg-gk-green/30 shadow-[inset_0_-1px_0_rgb(60_240_160/0.6)]',
};
// Совпадение может быть разрезано токенами подсветки — поэтому сплошная подложка без рамок и скруглений
// (важнее подложки изменённого куска — иначе совпадение внутри изменения не видно)
const HIT = '!bg-gk-yellow/45';
const HIT_CURRENT = '!bg-[#ff9632] !text-[#1b1300]';

function LineText({ line, segs, tokens, hits, current }) {
  if (line.t === '\\') return line.text;
  if (!line.text) return ' ';
  if (!segs && !tokens && !hits) return line.text;
  const pieces = layerLine(line.text, {
    tokens,
    segs,
    hits: hits?.map((h) => ({ ...h, current: h.idx === current })),
  });
  return pieces.map((p, i) => {
    const changed = p.changed ? `${CHANGED[line.t] ?? CHANGED['+']} ${p.cls ? '' : 'text-gk-strong'}` : '';
    const hit = p.hit ? (p.hit.current ? HIT_CURRENT : HIT) : '';
    const cls = [p.cls, changed, hit].filter(Boolean).join(' ');
    const text = p.ws ? p.text.replace(/ /g, '·').replace(/\t/g, '→   ') : p.text;
    if (!cls) return <span key={i}>{text}</span>;
    const Tag = p.changed ? 'mark' : 'span';
    return (
      <Tag
        key={i}
        className={cls}
        data-hit={p.hit ? p.hit.idx : undefined}
        data-hit-current={p.hit?.current ? '' : undefined}
        title={p.ws ? 'Изменились пробелы' : undefined}
      >
        {text}
      </Tag>
    );
  });
}

/* ---------- Поиск ---------- */

function SearchBar({ inputRef, search, onChange, error, count, capped, index, onStep, onClose }) {
  const opt = (key, Icon, title, testid) => (
    <button
      type="button"
      onClick={() => onChange({ [key]: !search[key] })}
      aria-pressed={search[key]}
      title={title}
      data-testid={testid}
      className={`flex h-5 w-6 shrink-0 items-center justify-center rounded ${search[key] ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-dim hover:text-gk-text'}`}
    >
      <Icon size={13} />
    </button>
  );
  return (
    <div className="flex h-9 shrink-0 animate-fade-in items-center gap-2 border-b border-gk-border bg-gk-panel/80 px-3 font-sans" data-testid="diff-search">
      <div
        className={`flex w-[min(460px,60%)] min-w-0 items-center gap-1.5 rounded bg-gk-bg px-2 ring-1 focus-within:ring-gk-blue ${
          error || (search.query && !count) ? 'ring-gk-red/60' : 'ring-gk-border'
        }`}
      >
        <Search size={12} className="shrink-0 text-gk-dim" />
        <input
          ref={inputRef}
          autoFocus
          value={search.query}
          onChange={(e) => onChange({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.altKey && (e.key === 'c' || e.key === 'с')) {
              e.preventDefault();
              onChange({ caseSensitive: !search.caseSensitive });
            } else if (e.altKey && (e.key === 'r' || e.key === 'к')) {
              e.preventDefault();
              onChange({ regex: !search.regex });
            }
          }}
          placeholder="Найти в изменениях"
          aria-label="Найти в изменениях"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-gk-text outline-none placeholder:font-sans placeholder:text-gk-dim"
        />
        {opt('caseSensitive', CaseSensitive, 'Учитывать регистр (Alt+C)', 'search-case')}
        {opt('regex', Regex, 'Регулярное выражение (Alt+R)', 'search-regex')}
        {opt('changedOnly', Diff, 'Только в изменённых строках (+ и −)', 'search-changed')}
      </div>
      <span className={`min-w-[88px] text-[11.5px] ${error || (search.query && !count) ? 'text-gk-red' : 'text-gk-muted'}`} data-testid="search-count">
        {error ? error : !search.query ? '' : count ? `${index + 1} из ${count}${capped ? '+' : ''}` : 'Нет совпадений'}
      </span>
      <div className="flex items-center">
        <IconBtn title="Предыдущее (Shift+Enter, Shift+F3)" disabled={!count} onClick={() => onStep(-1)}>
          <ChevronUp size={15} />
        </IconBtn>
        <IconBtn title="Следующее (Enter, F3)" disabled={!count} onClick={() => onStep(1)}>
          <ChevronDown size={15} />
        </IconBtn>
        <IconBtn title="Закрыть поиск (Esc)" onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>
    </div>
  );
}

/* ---------- Общее ---------- */

function HunkHeader({ hunk, index, actions, busy, onRun }) {
  return (
    <div className="flex items-center border-y border-gk-border/60 bg-gk-blue/10 py-0.5 pl-3 text-[11px] text-gk-blue/90">
      <span className="sticky left-3 flex items-center gap-2">
        <span>{hunk.header.replace(/ @@.*$/, ' @@')}</span>
        {hunk.section && <span className="text-gk-muted">{hunk.section}</span>}
        {actions?.map((a) => {
          const running = busy === `${a.id}:${index}`;
          return (
            <button
              key={a.id}
              disabled={Boolean(busy)}
              title={a.title}
              onClick={() => onRun(a, hunk, index)}
              className={`flex items-center gap-1 rounded px-1.5 py-px font-sans text-[11px] opacity-70 ring-1 transition group-hover/hunk:opacity-100 disabled:opacity-40 ${
                a.danger ? 'text-gk-red ring-gk-red/30 hover:bg-gk-red/15' : 'text-gk-text ring-gk-border hover:bg-gk-fg/10'
              }`}
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : a.icon && <a.icon size={11} />}
              {a.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

function Placeholder({ children, className = '' }) {
  return (
    <div className={`flex h-full items-center justify-center gap-2 font-sans text-[13px] text-gk-muted ${className}`}>
      {children}
    </div>
  );
}

function ToggleButton({ active, children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`flex h-6 w-7 items-center justify-center ${
        active ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-dim hover:text-gk-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
