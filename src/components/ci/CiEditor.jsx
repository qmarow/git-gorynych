import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { highlight } from '../../lib/syntax.jsx';
import { describeCron } from '../../lib/cron.ts';
import { t } from '../../i18n/index.ts';

const LINE_H = 20; // px — одинаковая высота строки у подсветки, номеров и textarea
const INDENT = '  ';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Где курсор: внутри значения ключа с метками раннера (tags: [..], runs-on: …, или элемент списка под ними).
 * → { prefix, start } — начало набираемого слова в тексте; null — не там
 */
export function tagContext(text, pos, keys) {
  if (!keys?.length) return null;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  const k = keys.map(escapeRe).join('|');
  const inline = new RegExp(`^\\s*(?:-\\s+)?(?:${k})\\s*:\\s*(?:\\[\\s*(?:[^\\],]*,\\s*)*)?([\\w.\\-]*)$`).exec(before);
  if (inline) return { prefix: inline[1], start: pos - inline[1].length };
  const item = /^(\s*)-\s+([\w.\-]*)$/.exec(before);
  if (!item) return null;
  // Родитель элемента списка — ближайшая строка выше с меньшим отступом
  const indent = item[1].length;
  const above = text.slice(0, lineStart).split('\n').reverse();
  for (const l of above) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const ind = /^\s*/.exec(l)[0].length;
    if (ind < indent || (ind === indent && !/^\s*-/.test(l))) return new RegExp(`^\\s*(?:-\\s+)?(?:${k})\\s*:\\s*$`).test(l) ? { prefix: item[2], start: pos - item[2].length } : null;
    if (ind === indent && /^\s*-/.test(l)) continue;
  }
  return null;
}

/**
 * Редактор CI-файла: прозрачная textarea поверх подсвеченного текста.
 * Tab / Shift+Tab — отступ, Enter — сохраняет отступ (и добавляет после «:»), Ctrl+/ — комментарий.
 * completions: { keys, labels } — подсказка меток живых раннеров после tags: / runs-on:. Рядом с cron — расшифровка.
 */
export default function CiEditor({ value, onChange, lang, errors, jump, onSave, readOnly = false, completions = null, onCaret, cronTz = 'UTC' }) {
  const taRef = useRef(null);
  const layerRef = useRef(null);
  const gutterRef = useRef(null);
  const measureRef = useRef(null);
  const [activeLine, setActiveLine] = useState(1);
  const [suggest, setSuggest] = useState(null); // { items, index, start, prefix, top, left }
  const lines = value.split('\n');

  // Прокрутка textarea двигает подсветку и номера строк
  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (layerRef.current) layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  useLayoutEffect(syncScroll);

  const updateActive = () => {
    const ta = taRef.current;
    if (!ta) return;
    setActiveLine(ta.value.slice(0, ta.selectionStart).split('\n').length);
    onCaret?.(ta.selectionStart);
  };

  // Автодополнение меток раннеров
  const refreshSuggest = () => {
    const ta = taRef.current;
    if (!ta || readOnly || !completions?.labels?.length || ta.selectionStart !== ta.selectionEnd) return setSuggest(null);
    const pos = ta.selectionStart;
    const ctx = tagContext(ta.value, pos, completions.keys);
    if (!ctx) return setSuggest(null);
    const low = ctx.prefix.toLowerCase();
    const items = completions.labels.filter((l) => l.toLowerCase().startsWith(low) && l.toLowerCase() !== low).slice(0, 12);
    if (!items.length) return setSuggest(null);
    const lineIdx = ta.value.slice(0, ctx.start).split('\n').length - 1;
    const col = ctx.start - (ta.value.lastIndexOf('\n', ctx.start - 1) + 1);
    const cw = measureRef.current?.getBoundingClientRect().width / 10 || 7.5;
    setSuggest((s) => ({ items, index: s && s.start === ctx.start ? Math.min(s.index, items.length - 1) : 0, start: ctx.start, prefix: ctx.prefix, top: 8 + (lineIdx + 1) * LINE_H - ta.scrollTop, left: 12 + col * cw - ta.scrollLeft }));
  };
  const accept = (label) => {
    const ta = taRef.current;
    if (!ta || !suggest) return;
    const end = ta.selectionStart;
    setSuggest(null);
    replace(suggest.start, end, label);
  };

  // Переход к строке (из ошибок, из схемы)
  useEffect(() => {
    if (!jump?.line || !taRef.current) return;
    const ta = taRef.current;
    const all = ta.value.split('\n');
    const pos = all.slice(0, jump.line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(pos, pos + (all[jump.line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (jump.line - 1) * LINE_H - ta.clientHeight / 3);
    setActiveLine(jump.line);
    syncScroll();
  }, [jump?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Заменить выделенный диапазон и поставить курсор — с поддержкой Ctrl+Z в textarea
  const replace = useCallback(
    (start, end, text, selStart, selEnd) => {
      const ta = taRef.current;
      ta.focus();
      ta.setSelectionRange(start, end);
      // execCommand сохраняет историю отмены браузера; если недоступен — меняем значение напрямую
      const ok = document.execCommand?.('insertText', false, text);
      if (!ok) {
        const next = ta.value.slice(0, start) + text + ta.value.slice(end);
        onChange(next);
        requestAnimationFrame(() => ta.setSelectionRange(selStart ?? start + text.length, selEnd ?? selStart ?? start + text.length));
        return;
      }
      if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
    },
    [onChange],
  );

  const onKeyDown = (e) => {
    const ta = taRef.current;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest((x) => ({ ...x, index: (x.index + d + x.items.length) % x.items.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(suggest.items[suggest.index]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS')) {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (readOnly) return;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;

    if (e.key === 'Tab') {
      e.preventDefault();
      const multi = v.slice(s, en).includes('\n');
      if (!multi && !e.shiftKey) {
        replace(s, en, INDENT);
        return;
      }
      // Сдвиг нескольких строк
      const blockEnd = v.indexOf('\n', en - (en > s && v[en - 1] === '\n' ? 1 : 0));
      const end = blockEnd === -1 ? v.length : blockEnd;
      const block = v.slice(lineStart, end);
      const changed = block
        .split('\n')
        .map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : INDENT + l))
        .join('\n');
      replace(lineStart, end, changed, lineStart, lineStart + changed.length);
      return;
    }

    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const line = v.slice(lineStart, s);
      let indent = /^\s*/.exec(line)[0];
      const trimmed = line.trimEnd();
      // После «key:» — на уровень глубже; в списке «- » продолжаем отступ элемента
      if (/:\s*$/.test(trimmed) || /:\s*[|>][-+]?\s*$/.test(trimmed)) indent += INDENT;
      else if (/^\s*- /.test(line) && /^\s*- \S+:\s*\S/.test(line)) indent += INDENT;
      replace(s, en, `\n${indent}`);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.code === 'Slash')) {
      e.preventDefault();
      const blockEnd = v.indexOf('\n', en);
      const end = blockEnd === -1 ? v.length : blockEnd;
      const block = v.slice(lineStart, end).split('\n');
      const marker = lang === 'yaml' ? '#' : '//';
      const allCommented = block.filter((l) => l.trim()).every((l) => l.trim().startsWith(marker));
      const changed = block
        .map((l) => {
          if (!l.trim()) return l;
          if (allCommented) return l.replace(new RegExp(`^(\\s*)${marker === '#' ? '#' : '\\/\\/'} ?`), '$1');
          const ind = /^\s*/.exec(l)[0];
          return `${ind}${marker} ${l.slice(ind.length)}`;
        })
        .join('\n');
      replace(lineStart, end, changed, lineStart, lineStart + changed.length);
    }
  };

  const errorLines = errors ?? new Map();

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--gk-base)_70%,transparent)] font-mono text-[12.5px]">
      {/* Номера строк */}
      <div className="relative w-14 shrink-0 overflow-hidden border-r border-gk-border/60 bg-gk-sink/10 text-right">
        <div ref={gutterRef} className="absolute inset-x-0 top-0 pt-2 will-change-transform">
          {lines.map((_, i) => {
            const n = i + 1;
            const err = errorLines.get(n);
            // Значение — текст (ошибка) или { text, tone: 'red' | 'yellow' }
            const yellow = typeof err === 'object' && err?.tone === 'yellow';
            return (
              <div
                key={i}
                style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
                title={typeof err === 'object' ? err?.text : err}
                className={`relative select-none pr-3 ${err ? (yellow ? 'text-gk-yellow' : 'text-gk-red') : n === activeLine ? 'text-gk-text' : 'text-gk-dim'}`}
              >
                {err && <span className={`absolute left-1.5 top-[7px] h-1.5 w-1.5 rounded-full ${yellow ? 'bg-gk-yellow' : 'bg-gk-red'}`} />}
                {n}
              </div>
            );
          })}
        </div>
      </div>

      {/* Подсветка + textarea */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={layerRef} aria-hidden className="pointer-events-none absolute left-0 top-0 min-w-full pb-[40vh] pl-3 pr-8 pt-2 will-change-transform">
          {lines.map((line, i) => (
            <Line
              key={i}
              text={line}
              lang={lang}
              cronTz={cronTz}
              active={i + 1 === activeLine}
              error={errorLines.has(i + 1) ? (errorLines.get(i + 1)?.tone === 'yellow' ? 'yellow' : 'red') : null}
              jumped={jump?.line === i + 1}
            />
          ))}
        </div>
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={() => {
            syncScroll();
            if (suggest) setSuggest(null);
          }}
          onSelect={updateActive}
          onClick={() => {
            updateActive();
            setSuggest(null);
          }}
          onKeyUp={(e) => {
            updateActive();
            if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) || !suggest) refreshSuggest();
          }}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent pb-[40vh] pl-3 pr-8 pt-2 text-transparent caret-gk-green outline-none selection:bg-gk-blue/35 [tab-size:2]"
          style={{ lineHeight: `${LINE_H}px`, fontFamily: 'inherit', fontSize: 'inherit' }}
        />
        <span ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-pre">
          MMMMMMMMMM
        </span>
        {suggest && (
          <div
            data-testid="tag-suggest"
            style={{ top: suggest.top + 2, left: Math.max(4, suggest.left) }}
            className="absolute z-20 min-w-[180px] overflow-hidden rounded-md border border-gk-fg/10 bg-[var(--gk-solid-2)] py-1 font-sans shadow-xl"
          >
            <div className="px-2.5 pb-1 text-[10.5px] uppercase tracking-wider text-gk-dim">{t('Метки живых раннеров')}</div>
            {suggest.items.map((label, i) => (
              <button
                key={label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(label);
                }}
                data-testid="tag-suggest-item"
                className={`block w-full px-2.5 py-0.5 text-left font-mono text-[12px] ${i === suggest.index ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-text hover:bg-gk-hover'}`}
              >
                <span className="font-semibold">{label.slice(0, suggest.prefix.length)}</span>
                {label.slice(suggest.prefix.length)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// «- cron: '0 3 * * *'» → расшифровка по-русски серым текстом после строки
const CRON_LINE = /^\s*-?\s*cron\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/;

const Line = memo(function Line({ text, lang, active, error, jumped, cronTz }) {
  const cron = lang === 'yaml' ? CRON_LINE.exec(text) : null;
  const human = cron ? describeCron(cron[1].trim()) : null;
  return (
    <div
      style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
      className={`whitespace-pre text-gk-text/90 ${jumped ? 'bg-gk-blue/15' : error === 'yellow' ? 'bg-gk-yellow/10' : error ? 'bg-gk-red/12' : active ? 'bg-gk-fg/[0.035]' : ''}`}
    >
      {highlight(text, lang) || ' '}
      {human && (
        <span data-testid="cron-hint" className="ml-4 rounded bg-gk-blue/10 px-1.5 font-sans text-[11px] text-gk-blue/90">
          ⏱ {human[0].toUpperCase() + human.slice(1)} {cronTz}
        </span>
      )}
    </div>
  );
});
