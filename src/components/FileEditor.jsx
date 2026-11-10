import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightLines } from '../lib/highlight.ts';

/**
 * Редактор файла рабочей копии в окне изменений: прозрачная textarea поверх подсвеченного текста, как CiEditor,
 * но для любого языка (подсветка highlight.js) и для больших файлов: рисуются только видимые строки.
 *
 * Tab / Shift+Tab — отступ строк (табуляция или пробелы — как в самом файле), Enter — новая строка с тем же отступом,
 * Ctrl+S — сохранить. Отмена (Ctrl+Z) — браузерная: правки идут через execCommand('insertText').
 */

const LINE_H = 20; // px — одинаковая высота у номеров, подсветки и textarea
const OVERSCAN = 30; // строк сверху и снизу от видимой области
const HIGHLIGHT_DELAY = 150; // мс после последней правки: подсветка всего файла не мешает набору

/** Единица отступа файла: табуляция, если строки начинаются с неё чаще, иначе самый частый шаг пробелов (2 или 4). */
export function detectIndent(text) {
  let tabs = 0;
  const steps = new Map();
  let prev = 0;
  for (const line of text.split('\n', 5000)) {
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabs++;
      continue;
    }
    const n = /^ */.exec(line)[0].length;
    const step = Math.abs(n - prev);
    if (step === 2 || step === 4) steps.set(step, (steps.get(step) ?? 0) + 1);
    prev = n;
  }
  const spaces = [...steps.values()].reduce((a, b) => a + b, 0);
  if (tabs > spaces) return '\t';
  return (steps.get(4) ?? 0) > (steps.get(2) ?? 0) ? '    ' : '  ';
}

export default function FileEditor({ value, onChange, lang, onSave, onCaret }) {
  const taRef = useRef(null);
  const layerRef = useRef(null);
  const gutterRef = useRef(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [activeLine, setActiveLine] = useState(1);
  const lines = useMemo(() => value.split('\n'), [value]);
  // Отступ файла определяется один раз, по открытому тексту: набранное не должно его менять
  const [indent] = useState(() => detectIndent(value));

  // Подсветка — с задержкой после набора; строки, изменённые после неё, рисуются без цвета, пока она не обновится
  const [tokens, setTokens] = useState(null);
  useEffect(() => {
    if (!lang) {
      setTokens(null);
      return undefined;
    }
    const timer = setTimeout(() => setTokens(highlightLines(lines, lang)), HIGHLIGHT_DELAY);
    return () => clearTimeout(timer);
  }, [lines, lang]);

  // Прокрутка textarea двигает подсветку и номера строк; видимый диапазон — по кадру
  const frame = useRef(0);
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (layerRef.current) layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setView((v) => (v.top === ta.scrollTop && v.height === ta.clientHeight ? v : { top: ta.scrollTop, height: ta.clientHeight })));
  }, []);
  useLayoutEffect(syncScroll);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(ta);
    return () => observer.disconnect();
  }, [syncScroll]);
  useEffect(() => taRef.current?.focus(), []);

  const updateActive = () => {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    setActiveLine(line);
    onCaret?.({ line, column: ta.selectionStart - before.lastIndexOf('\n') });
  };

  // Заменить диапазон с сохранением истории отмены браузера; без execCommand — напрямую
  const replace = (start, end, text, selStart, selEnd) => {
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(start, end);
    const ok = document.execCommand?.('insertText', false, text);
    if (!ok) {
      onChange(ta.value.slice(0, start) + text + ta.value.slice(end));
      requestAnimationFrame(() => ta.setSelectionRange(selStart ?? start + text.length, selEnd ?? selStart ?? start + text.length));
      return;
    }
    if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
  };

  const onKeyDown = (e) => {
    const ta = taRef.current;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      onSave?.();
      return;
    }
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      const multi = v.slice(s, en).includes('\n');
      if (!multi && !e.shiftKey) {
        replace(s, en, indent);
        return;
      }
      const blockEnd = v.indexOf('\n', en - (en > s && v[en - 1] === '\n' ? 1 : 0));
      const end = blockEnd === -1 ? v.length : blockEnd;
      const outdent = new RegExp(`^(?:\\t| {1,${indent === '\t' ? 4 : indent.length}})`);
      const changed = v
        .slice(lineStart, end)
        .split('\n')
        .map((l) => (e.shiftKey ? l.replace(outdent, '') : indent + l))
        .join('\n');
      replace(lineStart, end, changed, lineStart, lineStart + changed.length);
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      replace(s, en, `\n${/^[ \t]*/.exec(v.slice(lineStart, s))[0]}`);
    }
  };

  // Видимые строки
  const first = Math.max(0, Math.floor(view.top / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / LINE_H) + OVERSCAN);
  const visible = [];
  for (let i = first; i < last; i++) visible.push(i);
  const gutterWidth = `${Math.max(3, String(lines.length).length) + 2}ch`;

  return (
    <div data-testid="file-editor" className="relative flex min-h-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--gk-base)_70%,transparent)] font-mono text-[12px]">
      <div className="relative shrink-0 overflow-hidden border-r border-gk-border/60 bg-gk-sink/10 text-right" style={{ width: gutterWidth }}>
        <div ref={gutterRef} className="absolute inset-x-0 top-0 pt-2 will-change-transform" style={{ height: lines.length * LINE_H + 8 }}>
          {visible.map((i) => (
            <div
              key={i}
              style={{ position: 'absolute', top: 8 + i * LINE_H, height: LINE_H, lineHeight: `${LINE_H}px` }}
              className={`inset-x-0 select-none pr-2 ${i + 1 === activeLine ? 'text-gk-text' : 'text-gk-dim'}`}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={layerRef} aria-hidden className="pointer-events-none absolute left-0 top-0 min-w-full will-change-transform [tab-size:4]" style={{ height: lines.length * LINE_H + 8 }}>
          {visible.map((i) => (
            <Line key={i} index={i} text={lines[i]} tokens={tokens?.[i]} active={i + 1 === activeLine} />
          ))}
        </div>
        <textarea
          ref={taRef}
          value={value}
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
          data-testid="file-editor-input"
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent pb-[40vh] pl-3 pr-8 pt-2 text-transparent caret-gk-green outline-none selection:bg-gk-blue/35 [tab-size:4]"
          style={{ lineHeight: `${LINE_H}px`, fontFamily: 'inherit', fontSize: 'inherit' }}
        />
      </div>
    </div>
  );
}

const Line = memo(function Line({ index, text, tokens, active }) {
  // Токены от прежней версии текста не годятся, если строка уже другая
  const fits = tokens && tokens.reduce((n, tok) => n + tok.text.length, 0) === text.length;
  return (
    <div
      style={{ position: 'absolute', top: 8 + index * LINE_H, height: LINE_H, lineHeight: `${LINE_H}px` }}
      className={`min-w-full whitespace-pre pl-3 pr-8 text-gk-text/90 ${active ? 'bg-gk-fg/[0.035]' : ''}`}
    >
      {fits ? tokens.map((tok, k) => (tok.cls ? <span key={k} className={tok.cls}>{tok.text}</span> : tok.text)) : text || ' '}
    </div>
  );
});
