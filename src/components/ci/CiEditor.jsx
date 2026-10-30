import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { highlight } from '../../lib/syntax.jsx';

const LINE_H = 20; // px — одинаковая высота строки у подсветки, номеров и textarea
const INDENT = '  ';

/**
 * Редактор CI-файла: прозрачная textarea поверх подсвеченного текста.
 * Tab / Shift+Tab — отступ, Enter — сохраняет отступ (и добавляет после «:»), Ctrl+/ — комментарий.
 */
export default function CiEditor({ value, onChange, lang, errors, jump, onSave, readOnly = false }) {
  const taRef = useRef(null);
  const layerRef = useRef(null);
  const gutterRef = useRef(null);
  const [activeLine, setActiveLine] = useState(1);
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
    if (ta) setActiveLine(ta.value.slice(0, ta.selectionStart).split('\n').length);
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
          onScroll={syncScroll}
          onSelect={updateActive}
          onClick={updateActive}
          onKeyUp={updateActive}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent pb-[40vh] pl-3 pr-8 pt-2 text-transparent caret-gk-green outline-none selection:bg-gk-blue/35 [tab-size:2]"
          style={{ lineHeight: `${LINE_H}px`, fontFamily: 'inherit', fontSize: 'inherit' }}
        />
      </div>
    </div>
  );
}

const Line = memo(function Line({ text, lang, active, error, jumped }) {
  return (
    <div
      style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
      className={`whitespace-pre text-gk-text/90 ${jumped ? 'bg-gk-blue/15' : error === 'yellow' ? 'bg-gk-yellow/10' : error ? 'bg-gk-red/12' : active ? 'bg-gk-fg/[0.035]' : ''}`}
    >
      {highlight(text, lang) || ' '}
    </div>
  );
});
