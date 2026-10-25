import { useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Columns2, FileText, Loader2, Rows3, Space, X } from 'lucide-react';
import { FILE_STATUS } from '../lib/format.js';

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
  // Esc — закрыть, Alt+↑/↓ — предыдущий/следующий файл
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return; // открыт диалог
      if (e.key === 'Escape') onClose();
      if (e.altKey && e.key === 'ArrowUp' && onPrev) onPrev();
      if (e.altKey && e.key === 'ArrowDown' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

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
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5 [tab-size:4]">
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
            {file.oldPath && file.oldPath !== file.path
              ? 'Файл переименован без изменения содержимого'
              : ignoreWhitespace
                ? 'Изменения только в пробелах'
                : 'Нет изменений в содержимом'}
          </Placeholder>
        ) : view === 'split' ? (
          <SplitDiff hunks={data.hunks} />
        ) : (
          <UnifiedDiff hunks={data.hunks} />
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
  '+': { row: 'bg-[#3cf0a0]/[0.09]', num: 'bg-[#3cf0a0]/[0.13] text-gk-green/70', sign: 'text-gk-green' },
  '-': { row: 'bg-[#f25d5d]/[0.10]', num: 'bg-[#f25d5d]/[0.15] text-gk-red/70', sign: 'text-gk-red' },
  ' ': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
  '\\': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
};

function UnifiedDiff({ hunks }) {
  return (
    <div className="min-w-max pb-6">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <HunkHeader hunk={hunk} />
          {hunk.lines.map((line, li) => {
            const s = LINE_STYLES[line.t];
            return (
              <div key={li} className={`flex ${s.row}`}>
                <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.o ?? ''}</span>
                <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.n ?? ''}</span>
                <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === '\\' ? '' : line.t}</span>
                <span className={`select-text whitespace-pre pr-6 ${line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'}`}>
                  {line.text || ' '}
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

// Сопоставляем блоки удалений и добавлений построчно, контекст — в обе стороны
function toSplitRows(lines) {
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.t === ' ' || line.t === '\\') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].t === '-') dels.push(lines[i++]);
    while (i < lines.length && lines[i].t === '+') adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

function SplitDiff({ hunks }) {
  const prepared = useMemo(() => hunks.map((h) => ({ hunk: h, rows: toSplitRows(h.lines) })), [hunks]);
  return (
    <div className="pb-6">
      {prepared.map(({ hunk, rows }, hi) => (
        <div key={hi}>
          <HunkHeader hunk={hunk} />
          {rows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-2">
              <SplitCell line={row.left} side="old" />
              <SplitCell line={row.right} side="new" border />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SplitCell({ line, side, border }) {
  if (!line) {
    return <div className={`bg-white/[0.02] ${border ? 'border-l border-gk-border' : ''}`} />;
  }
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
        {line.text || ' '}
      </span>
    </div>
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
