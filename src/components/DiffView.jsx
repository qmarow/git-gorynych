import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Columns2, FileText, Highlighter, Loader2, Rows3, Space, X } from 'lucide-react';
import { FILE_STATUS } from '../lib/format.js';
import { inlineHighlights } from '../lib/inlineDiff.js';

const readPref = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
};

const MODE_LABELS = {
  commit: (t) => `коммит ${t.hash.slice(0, 7)}`,
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
}) {
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
      try {
        localStorage.setItem('diff.inline', v ? '0' : '1');
      } catch {
        /* не страшно */
      }
      return !v;
    });

  // Esc — закрыть, Alt+↑/↓ — предыдущий/следующий файл, F7 / Shift+F7 — следующее/предыдущее изменение
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return; // открыт диалог
      if (e.key === 'Escape') onClose();
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
  const status = FILE_STATUS[file.status] ?? FILE_STATUS.M;

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
          <span className="font-medium text-white">{name}</span>
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
          <IconBtn title="Предыдущий файл (Alt+↑)" disabled={!onPrev} onClick={onPrev}>
            <ChevronUp size={15} />
          </IconBtn>
          <IconBtn title="Следующий файл (Alt+↓)" disabled={!onNext} onClick={onNext}>
            <ChevronDown size={15} />
          </IconBtn>
          <IconBtn title="Закрыть (Esc)" onClick={onClose}>
            <X size={15} />
          </IconBtn>
        </div>
      </div>

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
          <SplitDiff hunks={data.hunks} highlights={highlights} />
        ) : (
          <UnifiedDiff hunks={data.hunks} highlights={highlights} />
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

export function UnifiedDiff({ hunks, highlights }) {
  return (
    <div className="min-w-max pb-6">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <HunkHeader hunk={hunk} />
          {hunk.lines.map((line, li) => {
            const s = LINE_STYLES[line.t];
            const segs = highlights?.[hi]?.get(li);
            const startsChange = (line.t === '+' || line.t === '-') && !['+', '-'].includes(hunk.lines[li - 1]?.t);
            return (
              <div key={li} className={`flex ${s.row}`} data-change={startsChange ? '' : undefined}>
                <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.o ?? ''}</span>
                <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.n ?? ''}</span>
                <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === '\\' ? '' : line.t}</span>
                <span className={`select-text whitespace-pre pr-6 ${line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'}`}>
                  {segs ? <Segments segs={segs} type={line.t} /> : line.text || ' '}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

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

function SplitDiff({ hunks, highlights }) {
  const prepared = useMemo(
    () => hunks.map((h, hi) => ({ hunk: h, rows: toSplitRows(h.lines, highlights?.[hi]?.pairs) })),
    [hunks, highlights],
  );
  return (
    <div className="pb-6">
      {prepared.map(({ hunk, rows }, hi) => (
        <div key={hi}>
          <HunkHeader hunk={hunk} />
          {rows.map((row, ri) => {
            const isChange = (r) => r && (r.line.t === '+' || r.line.t === '-');
            const prev = rows[ri - 1];
            const startsChange = (isChange(row.left) || isChange(row.right)) && !(prev && (isChange(prev.left) || isChange(prev.right)));
            return (
              <div key={ri} className="grid grid-cols-2" data-change={startsChange ? '' : undefined}>
                <SplitCell cell={row.left} segs={row.left && highlights?.[hi]?.get(row.left.idx)} side="old" />
                <SplitCell cell={row.right} segs={row.right && highlights?.[hi]?.get(row.right.idx)} side="new" border />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SplitCell({ cell, segs, side, border }) {
  if (!cell) {
    return <div className={`bg-white/[0.02] ${border ? 'border-l border-gk-border' : ''}`} />;
  }
  const line = cell.line;
  const s = LINE_STYLES[line.t];
  const num = side === 'old' ? line.o : line.n;
  return (
    <div className={`flex min-w-0 ${s.row} ${border ? 'border-l border-gk-border' : ''}`}>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{num ?? ''}</span>
      <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === ' ' || line.t === '\\' ? '' : line.t}</span>
      <span
        className={`min-w-0 select-text whitespace-pre-wrap break-all pr-3 ${
          line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'
        }`}
      >
        {segs ? <Segments segs={segs} type={line.t} /> : line.text || ' '}
      </span>
    </div>
  );
}

// Изменённые куски строки — яркой «маркерной» подложкой; пробелы в изменении делаем видимыми
function Segments({ segs, type }) {
  const cls =
    type === '-'
      ? 'rounded-[3px] bg-gk-red/35 text-white shadow-[inset_0_-1px_0_rgb(242_93_93/0.6)]'
      : 'rounded-[3px] bg-gk-green/30 text-white shadow-[inset_0_-1px_0_rgb(60_240_160/0.6)]';
  return segs.map((seg, i) =>
    seg.changed ? (
      <mark key={i} className={`${cls} px-[1px]`} title={/^\s+$/.test(seg.text) ? 'Изменились пробелы' : undefined}>
        {/^\s+$/.test(seg.text) ? seg.text.replace(/ /g, '·').replace(/\t/g, '→   ') : seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

/* ---------- Общее ---------- */

function HunkHeader({ hunk }) {
  return (
    <div className="sticky left-0 border-y border-gk-border/60 bg-gk-blue/10 px-3 py-0.5 text-[11px] text-gk-blue/90">
      {hunk.header.replace(/ @@.*$/, ' @@')}
      {hunk.section && <span className="ml-2 text-gk-muted">{hunk.section}</span>}
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
