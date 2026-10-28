import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  ExternalLink,
  Eye,
  FileWarning,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { CodeLang, HighlightedLines, TokenText, useLineTokens } from './CodeText.jsx';
import { detectLanguage } from '../lib/highlight.js';
import { isMod, kb } from '../lib/platform.js';
import { readable } from '../lib/scheme.js';

const api = window.api;
const LEFT = '#2f9bff'; // сторона ours (stage 2)
const RIGHT = '#c517b6'; // сторона theirs (stage 3)
const CONTEXT = 3; // сколько строк контекста показывать вокруг конфликтов

const emptyChoice = (block) => ({
  decided: false,
  ours: block.ours.map(() => false),
  theirs: block.theirs.map(() => false),
  order: 'ours',
  manual: null,
});

function blockResult(block, ch) {
  if (ch.manual != null) return ch.manual === '' ? [] : ch.manual.split('\n');
  const left = block.ours.filter((_, i) => ch.ours[i]);
  const right = block.theirs.filter((_, i) => ch.theirs[i]);
  return ch.order === 'ours' ? [...left, ...right] : [...right, ...left];
}

/**
 * Редактор конфликта одного файла.
 * runAction(name, payload, opts) — App.run (показывает ошибки, перечитывает репозиторий).
 */
export default function ConflictView({ repoPath, path, fileIndex, fileCount, onPrevFile, onNextFile, onClose, onResolved, runAction }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [choices, setChoices] = useState([]);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const cardRefs = useRef([]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.repo.action(repoPath, 'getConflict', { path }).then((res) => {
      if (!alive) return;
      if (!res.ok) return setError(res.error);
      setData(res.data);
      const blocks = (res.data.segments ?? []).filter((s) => s.type === 'conflict');
      setChoices(blocks.map(emptyChoice));
    });
    return () => {
      alive = false;
    };
  }, [repoPath, path, reloadKey]);

  const blocks = useMemo(() => (data?.segments ?? []).filter((s) => s.type === 'conflict'), [data]);
  const decidedCount = choices.filter((c) => c.decided).length;
  const allDecided = blocks.length > 0 && decidedCount === blocks.length;
  const L = data?.labels?.ours ?? { title: 'Моё', sub: '' };
  const R = data?.labels?.theirs ?? { title: 'Их', sub: '' };

  const setChoice = (i, patch) =>
    setChoices((list) => list.map((c, k) => (k === i ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch), decided: true } : c)));

  const pick = (i, mode) => {
    const b = blocks[i];
    const all = (arr) => arr.map(() => true);
    const none = (arr) => arr.map(() => false);
    const map = {
      left: { ours: all(b.ours), theirs: none(b.theirs), order: 'ours' },
      right: { ours: none(b.ours), theirs: all(b.theirs), order: 'ours' },
      leftRight: { ours: all(b.ours), theirs: all(b.theirs), order: 'ours' },
      rightLeft: { ours: all(b.ours), theirs: all(b.theirs), order: 'theirs' },
      none: { ours: none(b.ours), theirs: none(b.theirs), order: 'ours' },
    };
    setChoice(i, { ...map[mode], manual: null });
  };

  const pickAll = (mode) => blocks.forEach((_, i) => pick(i, mode));
  const resetBlock = (i) => setChoices((list) => list.map((c, k) => (k === i ? emptyChoice(blocks[i]) : c)));

  // Итоговый текст файла
  const resultText = useMemo(() => {
    if (!data || data.kind !== 'text') return '';
    const out = [];
    let bi = 0;
    for (const seg of data.segments) {
      if (seg.type === 'common') out.push(...seg.lines);
      else {
        out.push(...blockResult(seg, choices[bi] ?? emptyChoice(seg)));
        bi++;
      }
    }
    return out.join(data.eol) + (data.finalNewline ? data.eol : '');
  }, [data, choices]);

  const scrollToBlock = (i) => cardRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const nextUnresolved = useCallback(
    (dir = 1) => {
      if (!blocks.length) return;
      const order = dir > 0 ? [...blocks.keys()] : [...blocks.keys()].reverse();
      const target = order.find((i) => !choices[i]?.decided) ?? order[0];
      scrollToBlock(target);
    },
    [blocks, choices],
  );

  const save = async () => {
    if (!allDecided || saving) return;
    setSaving(true);
    const res = await runAction('saveResolution', { path, content: resultText }, { label: 'Сохранение' });
    setSaving(false);
    if (res.ok) onResolved(path);
  };

  const whole = async (side) => {
    setSaving(true);
    const res = await runAction('resolveWhole', { path, side }, { label: 'Конфликт' });
    setSaving(false);
    if (res.ok) onResolved(path);
  };

  const markResolved = async () => {
    setSaving(true);
    const res = await runAction('markResolved', { path }, { label: 'Конфликт' });
    setSaving(false);
    if (res.ok) onResolved(path);
  };

  const openInEditor = () => api.repo.openPath(repoPath, path);

  // Ctrl+S — сохранить, Alt+↑/↓ — к нерешённому конфликту, Esc — закрыть
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return;
      if (isMod(e) && (e.code === 'KeyS' || e.key === 's' || e.key === 'ы')) {
        e.preventDefault();
        save();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        nextUnresolved(1);
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        nextUnresolved(-1);
      } else if (e.key === 'Escape' && !['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const parts = path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');

  return (
    <CodeLang.Provider value={detectLanguage(path)}>
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg">
      {/* Верхняя панель */}
      <div className="glass flex shrink-0 flex-wrap items-center gap-2 border-b border-gk-border bg-gk-panel px-3 py-2">
        <FileWarning size={16} className="shrink-0 text-gk-red" />
        <div className="min-w-0 flex-1 truncate text-[13px]" title={path}>
          {dir && <span className="text-gk-muted">{dir}/</span>}
          <span className="font-medium text-gk-strong">{name}</span>
        </div>

        {fileCount > 1 && (
          <span className="flex items-center gap-0.5 text-[11px] text-gk-muted">
            <IconBtn title="Предыдущий конфликтный файл" onClick={onPrevFile} disabled={!onPrevFile}>
              <ChevronLeft size={14} />
            </IconBtn>
            файл {fileIndex + 1} из {fileCount}
            <IconBtn title="Следующий конфликтный файл" onClick={onNextFile} disabled={!onNextFile}>
              <ChevronRight size={14} />
            </IconBtn>
          </span>
        )}

        {data?.kind === 'text' && (
          <>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                allDecided ? 'bg-gk-green/15 text-gk-green' : 'bg-gk-red/15 text-gk-red'
              }`}
            >
              Решено {decidedCount} из {blocks.length}
            </span>
            <IconBtn title={kb('Предыдущий нерешённый (Alt+↑)')} onClick={() => nextUnresolved(-1)}>
              <ChevronUp size={15} />
            </IconBtn>
            <IconBtn title={kb('Следующий нерешённый (Alt+↓)')} onClick={() => nextUnresolved(1)}>
              <ChevronDown size={15} />
            </IconBtn>
            <IconBtn title={preview ? 'Показать блоки' : 'Предпросмотр итогового файла'} onClick={() => setPreview((v) => !v)} active={preview}>
              {preview ? <Columns2 size={14} /> : <Eye size={14} />}
            </IconBtn>
          </>
        )}
        <IconBtn title="Открыть файл во внешнем редакторе" onClick={openInEditor}>
          <ExternalLink size={14} />
        </IconBtn>
        <IconBtn title="Перечитать файл с диска" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw size={14} />
        </IconBtn>

        {data?.kind === 'text' && (
          <button
            onClick={save}
            disabled={!allDecided || saving}
            title={allDecided ? 'Сохранить файл и отметить конфликт решённым (Ctrl+S)' : 'Сначала решите все конфликты в файле'}
            className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12px] font-semibold text-gk-ink shadow-lg shadow-gk-green/20 transition hover:brightness-110 disabled:bg-gk-fg/10 disabled:text-gk-dim disabled:shadow-none"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            {fileCount > 1 ? 'Сохранить и дальше' : 'Сохранить'}
          </button>
        )}
        <IconBtn title="Закрыть (Esc)" onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>

      {/* Подписи сторон */}
      {data?.kind === 'text' && !preview && (
        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-gk-border bg-gk-sink/10 px-4 py-2 text-xs">
          <SideLabel color={readable(LEFT)} side={L} onTakeAll={() => pickAll('left')} />
          <SideLabel color={readable(RIGHT)} side={R} onTakeAll={() => pickAll('right')} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data && !error && (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-gk-muted">
            <Loader2 size={15} className="animate-spin" /> Читаем конфликт…
          </div>
        )}
        {error && <div className="p-4 text-[13px] text-gk-red">{error.message}</div>}

        {data?.kind === 'text' &&
          (preview ? (
            <ResultPreview data={data} choices={choices} />
          ) : (
            <TextConflict
              data={data}
              blocks={blocks}
              choices={choices}
              L={L}
              R={R}
              cardRefs={cardRefs}
              onPick={pick}
              onToggle={(i, side, line) =>
                setChoice(i, (c) => ({ [side]: c[side].map((v, k) => (k === line ? !v : v)), manual: null }))
              }
              onToggleAll={(i, side, value) => setChoice(i, (c) => ({ [side]: c[side].map(() => value), manual: null }))}
              onOrder={(i, order) => setChoice(i, { order })}
              onManual={(i, text) => setChoice(i, { manual: text })}
              onEditManual={(i) => setChoice(i, (c) => ({ manual: blockResult(blocks[i], c).join('\n') }))}
              onReset={resetBlock}
            />
          ))}

        {data && data.kind !== 'text' && (
          <SpecialConflict data={data} L={L} R={R} busy={saving} onWhole={whole} onMarkResolved={markResolved} onOpen={openInEditor} onClose={onClose} />
        )}
      </div>
    </div>
    </CodeLang.Provider>
  );
}

/* ---------------- Текстовый конфликт ---------------- */

function TextConflict({ data, blocks, choices, L, R, cardRefs, onPick, onToggle, onToggleAll, onOrder, onManual, onEditManual, onReset }) {
  let bi = -1;
  const lastIndex = data.segments.length - 1;
  return (
    <div className="space-y-2 px-4 py-3 pb-10">
      {data.segments.map((seg, si) => {
        if (seg.type === 'common') {
          return <CommonLines key={si} lines={seg.lines} isFirst={si === 0} isLast={si === lastIndex} />;
        }
        bi++;
        const i = bi;
        return (
          <ConflictCard
            key={si}
            refFn={(el) => (cardRefs.current[i] = el)}
            index={i}
            total={blocks.length}
            block={seg}
            choice={choices[i] ?? emptyChoice(seg)}
            L={L}
            R={R}
            onPick={(mode) => onPick(i, mode)}
            onToggle={(side, line) => onToggle(i, side, line)}
            onToggleAll={(side, value) => onToggleAll(i, side, value)}
            onOrder={(order) => onOrder(i, order)}
            onManual={(text) => onManual(i, text)}
            onEditManual={() => onEditManual(i)}
            onReset={() => onReset(i)}
          />
        );
      })}
    </div>
  );
}

// Неконфликтные строки: показываем по 3 строки контекста, середину сворачиваем
function CommonLines({ lines, isFirst, isLast }) {
  const [open, setOpen] = useState(false);
  const head = isFirst ? 0 : CONTEXT;
  const tail = isLast ? 0 : CONTEXT;
  if (open || lines.length <= head + tail + 1) return <Code lines={lines} />;
  return (
    <div>
      {head > 0 && <Code lines={lines.slice(0, head)} />}
      <button
        onClick={() => setOpen(true)}
        className="my-0.5 w-full rounded bg-gk-fg/[0.03] py-1 text-center text-[11px] text-gk-dim hover:bg-gk-fg/[0.06] hover:text-gk-muted"
      >
        ⋯ {lines.length - head - tail} строк без конфликтов — показать
      </button>
      {tail > 0 && <Code lines={lines.slice(lines.length - tail)} />}
    </div>
  );
}

function Code({ lines }) {
  return (
    <pre className="select-text overflow-x-auto whitespace-pre px-2 font-mono text-[12px] leading-5 text-gk-muted [tab-size:4]">
      <HighlightedLines lines={lines} />
    </pre>
  );
}

function ConflictCard({ refFn, index, total, block, choice, L, R, onPick, onToggle, onToggleAll, onOrder, onManual, onEditManual, onReset }) {
  const [showBase, setShowBase] = useState(false);
  const result = blockResult(block, choice);
  const decided = choice.decided;
  return (
    <div
      ref={refFn}
      className={`overflow-hidden rounded-lg border transition-colors ${
        decided ? 'border-gk-green/30 bg-gk-green/[0.03]' : 'border-gk-red/40 bg-gk-red/[0.04]'
      }`}
    >
      {/* Заголовок и быстрые решения */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gk-border bg-gk-sink/15 px-3 py-2">
        <span className={`text-xs font-semibold ${decided ? 'text-gk-green' : 'text-gk-red'}`}>
          {decided ? '✓' : '●'} Конфликт {index + 1} из {total}
        </span>
        <span className="mr-auto text-[11px] text-gk-dim">строка {block.startLine}</span>
        <QuickBtn color={readable(LEFT)} active={decided && choice.manual == null && choice.ours.every(Boolean) && !choice.theirs.some(Boolean)} onClick={() => onPick('left')}>
          <ArrowLeft size={12} /> {L.title}
        </QuickBtn>
        <QuickBtn color={readable(RIGHT)} active={decided && choice.manual == null && choice.theirs.every(Boolean) && !choice.ours.some(Boolean)} onClick={() => onPick('right')}>
          {R.title} <ArrowRight size={12} />
        </QuickBtn>
        <QuickBtn onClick={() => onPick('leftRight')} title={`Оставить обе версии: сначала «${L.title}», потом «${R.title}»`}>
          Оба: {L.title} + {R.title}
        </QuickBtn>
        <QuickBtn onClick={() => onPick('rightLeft')} title={`Оставить обе версии: сначала «${R.title}», потом «${L.title}»`}>
          {R.title} + {L.title}
        </QuickBtn>
        <QuickBtn onClick={() => onPick('none')} title="Убрать обе версии">
          <Trash2 size={12} /> Ничего
        </QuickBtn>
        {decided && (
          <button onClick={onReset} title="Сбросить решение" className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Две версии с выбором строк */}
      <div className="grid grid-cols-2 divide-x divide-gk-border">
        <SideLines
          color={readable(LEFT)}
          lines={block.ours}
          selected={choice.ours}
          disabled={choice.manual != null}
          onToggle={(k) => onToggle('ours', k)}
          onToggleAll={(v) => onToggleAll('ours', v)}
        />
        <SideLines
          color={readable(RIGHT)}
          lines={block.theirs}
          selected={choice.theirs}
          disabled={choice.manual != null}
          onToggle={(k) => onToggle('theirs', k)}
          onToggleAll={(v) => onToggleAll('theirs', v)}
        />
      </div>

      {block.base && (
        <div className="border-t border-gk-border">
          <button onClick={() => setShowBase((v) => !v)} className="flex w-full items-center gap-1 px-3 py-1 text-left text-[11px] text-gk-dim hover:text-gk-muted">
            {showBase ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Как было до обоих изменений (общий предок)
          </button>
          {showBase && <Code lines={block.base} />}
        </div>
      )}

      {/* Результат */}
      <div className="border-t border-gk-border bg-gk-sink/20 px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-gk-muted">
          <span className="font-semibold uppercase tracking-wider">Результат</span>
          {choice.manual == null && choice.ours.some(Boolean) && choice.theirs.some(Boolean) && (
            <span className="flex items-center gap-1">
              порядок:
              <button onClick={() => onOrder('ours')} className={choice.order === 'ours' ? 'text-gk-text underline' : 'hover:text-gk-text'}>
                {L.title} → {R.title}
              </button>
              /
              <button onClick={() => onOrder('theirs')} className={choice.order === 'theirs' ? 'text-gk-text underline' : 'hover:text-gk-text'}>
                {R.title} → {L.title}
              </button>
            </span>
          )}
          <span className="ml-auto" />
          {choice.manual == null ? (
            <button onClick={onEditManual} className="flex items-center gap-1 hover:text-gk-text">
              <Pencil size={11} /> Править вручную
            </button>
          ) : (
            <button onClick={() => onManual(null)} className="flex items-center gap-1 hover:text-gk-text">
              <RotateCcw size={11} /> Вернуться к выбору строк
            </button>
          )}
        </div>
        {choice.manual != null ? (
          <textarea
            value={choice.manual}
            onChange={(e) => onManual(e.target.value)}
            rows={Math.min(14, Math.max(3, choice.manual.split('\n').length + 1))}
            spellCheck={false}
            autoFocus
            className="w-full resize-y rounded bg-gk-bg px-2 py-1.5 font-mono text-[12px] leading-5 outline-none ring-1 ring-gk-blue/50 focus:ring-gk-blue [tab-size:4]"
          />
        ) : !decided ? (
          <div className="text-[12px] italic text-gk-dim">Выберите версию кнопками выше или отметьте нужные строки</div>
        ) : result.length === 0 ? (
          <div className="text-[12px] italic text-gk-dim">— блок будет удалён —</div>
        ) : (
          <pre className="select-text overflow-x-auto whitespace-pre rounded bg-gk-green/[0.06] px-2 py-1 font-mono text-[12px] leading-5 text-gk-text [tab-size:4]">
            <HighlightedLines lines={result} />
          </pre>
        )}
      </div>
    </div>
  );
}

function SideLines({ color, lines, selected, disabled, onToggle, onToggleAll }) {
  const all = lines.length > 0 && selected.every(Boolean);
  const tokens = useLineTokens(lines);
  return (
    <div className={`min-w-0 ${disabled ? 'opacity-50' : ''}`}>
      <label className="flex cursor-pointer items-center gap-2 border-b border-gk-border/60 px-2 py-1 text-[11px] text-gk-dim hover:text-gk-muted">
        <input
          type="checkbox"
          checked={all}
          disabled={disabled || lines.length === 0}
          onChange={(e) => onToggleAll(e.target.checked)}
          style={{ accentColor: color }}
        />
        {lines.length === 0 ? 'пусто — с этой стороны строки удалены' : `все строки (${lines.length})`}
      </label>
      <div className="overflow-x-auto py-0.5">
        {lines.map((line, k) => (
          <label
            key={k}
            className="flex cursor-pointer items-start gap-2 px-2 font-mono text-[12px] leading-5 hover:bg-gk-fg/[0.04]"
            style={selected[k] ? { backgroundColor: `${color}26` } : undefined}
          >
            <input
              type="checkbox"
              checked={selected[k]}
              disabled={disabled}
              onChange={() => onToggle(k)}
              className="mt-[3px] shrink-0"
              style={{ accentColor: color }}
            />
            <span className={`whitespace-pre [tab-size:4] ${selected[k] ? 'text-gk-strong' : 'text-gk-text/80'}`}>
              <TokenText tokens={tokens?.[k]} text={line} />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Весь итоговый файл: решённые блоки подсвечены зелёным, нерешённые — красным
function ResultPreview({ data, choices }) {
  let bi = -1;
  return (
    <div className="px-4 py-3 pb-10 font-mono text-[12px] leading-5">
      {data.segments.map((seg, si) => {
        if (seg.type === 'common')
          return (
            <pre key={si} className="select-text whitespace-pre text-gk-muted">
              <HighlightedLines lines={seg.lines} />
            </pre>
          );
        bi++;
        const ch = choices[bi] ?? emptyChoice(seg);
        if (!ch.decided) {
          return (
            <div key={si} className="my-0.5 rounded bg-gk-red/15 px-2 py-0.5 text-gk-red">
              ● конфликт {bi + 1} ещё не решён
            </div>
          );
        }
        const lines = blockResult(seg, ch);
        return (
          <pre key={si} className="select-text whitespace-pre rounded bg-gk-green/10 text-gk-text">
            {lines.length ? <HighlightedLines lines={lines} /> : <span className="italic text-gk-dim">(блок удалён)</span>}
          </pre>
        );
      })}
    </div>
  );
}

/* ---------------- Особые случаи ---------------- */

function SpecialConflict({ data, L, R, busy, onWhole, onMarkResolved, onOpen, onClose }) {
  const sideOf = (s) => (s === 'ours' ? L : R);
  let title;
  let text;
  let actions;
  if (data.kind === 'deleted') {
    const del = sideOf(data.deletedSide);
    const keep = sideOf(data.keepSide);
    title = `Файл удалён в «${del.title}», но изменён в «${keep.title}»`;
    text = `${del.title}: ${del.sub}. ${keep.title}: ${keep.sub}. Решите, нужен ли файл.`;
    actions = (
      <>
        <BigButton color={data.keepSide === 'ours' ? readable(LEFT) : readable(RIGHT)} disabled={busy} onClick={() => onWhole(data.keepSide)}>
          <Check size={14} /> Оставить файл (версия «{keep.title}»)
        </BigButton>
        <BigButton danger disabled={busy} onClick={() => onWhole('delete')}>
          <Trash2 size={14} /> Удалить файл
        </BigButton>
      </>
    );
  } else if (data.kind === 'binary') {
    title = 'Бинарный файл изменён с обеих сторон';
    text = 'Объединить картинку или другой бинарный файл построчно нельзя — выберите одну версию целиком.';
    actions = (
      <>
        <BigButton color={readable(LEFT)} disabled={busy} onClick={() => onWhole('ours')}>
          <ArrowLeft size={14} /> Взять «{L.title}» ({L.sub})
        </BigButton>
        <BigButton color={readable(RIGHT)} disabled={busy} onClick={() => onWhole('theirs')}>
          Взять «{R.title}» ({R.sub}) <ArrowRight size={14} />
        </BigButton>
      </>
    );
  } else if (data.kind === 'both-deleted') {
    title = 'Файл удалён с обеих сторон';
    text = 'Осталось подтвердить удаление.';
    actions = (
      <BigButton danger disabled={busy} onClick={() => onWhole('delete')}>
        <Trash2 size={14} /> Удалить файл
      </BigButton>
    );
  } else if (data.kind === 'no-markers') {
    title = data.exists ? 'Маркеров конфликта в файле нет' : 'Файла нет на диске';
    text = data.exists
      ? 'Похоже, вы уже исправили файл (например, в редакторе). Проверьте и отметьте его решённым.'
      : 'Отметьте конфликт решённым — файл будет удалён из репозитория.';
    actions = (
      <>
        <BigButton color={readable('#3cf0a0')} disabled={busy} onClick={onMarkResolved}>
          <Check size={14} /> Отметить решённым
        </BigButton>
        <BigButton color={readable(LEFT)} disabled={busy} onClick={() => onWhole('ours')}>
          Взять «{L.title}» целиком
        </BigButton>
        <BigButton color={readable(RIGHT)} disabled={busy} onClick={() => onWhole('theirs')}>
          Взять «{R.title}» целиком
        </BigButton>
      </>
    );
  } else {
    title = 'Конфликт в этом файле уже решён';
    text = '';
    actions = <BigButton onClick={onClose}>Закрыть</BigButton>;
  }
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="glass-strong w-full max-w-lg animate-pop-in space-y-3 rounded-xl border border-gk-border bg-gk-panel-2 p-5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-gk-yellow" />
          <div>
            <div className="text-[14px] font-semibold text-gk-strong">{title}</div>
            {text && <p className="mt-1 text-xs leading-relaxed text-gk-muted">{text}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-7">{actions}</div>
        {data.exists !== false && data.kind !== 'resolved' && (
          <button onClick={onOpen} className="ml-7 flex items-center gap-1 text-xs text-gk-blue hover:underline">
            <ExternalLink size={12} /> Открыть файл в редакторе
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Мелочи ---------------- */

function SideLabel({ color, side, onTakeAll }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={side.hint}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-semibold" style={{ color }}>
        {side.title}
      </span>
      <span className="min-w-0 truncate text-gk-muted">{side.sub}</span>
      <button
        onClick={onTakeAll}
        title={`Во всех конфликтах этого файла взять «${side.title}»`}
        className="ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] text-gk-muted ring-1 transition hover:bg-gk-fg/10 hover:text-gk-text"
        style={{ '--tw-ring-color': `${color}66` }}
      >
        Взять «{side.title}» везде
      </button>
    </div>
  );
}

function QuickBtn({ color, active, children, ...props }) {
  return (
    <button
      {...props}
      style={active && color ? { backgroundColor: `${color}33`, boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gk-text ring-1 ring-gk-border transition hover:bg-gk-fg/10"
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

function BigButton({ color, danger, children, ...props }) {
  return (
    <button
      {...props}
      style={!danger && color ? { boxShadow: `inset 0 0 0 1px ${color}88`, color } : undefined}
      className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition disabled:opacity-50 ${
        danger ? 'text-gk-red ring-1 ring-gk-red/50 hover:bg-gk-red/10' : 'hover:bg-gk-fg/10'
      } ${!color && !danger ? 'text-gk-text ring-1 ring-gk-border' : ''}`}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, active, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-30 ${
        active ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted'
      }`}
    >
      {children}
    </button>
  );
}
