import { Fragment, createContext, useContext, useMemo } from 'react';
import { highlightLines } from '../lib/highlight.js';

// Язык кода для вложенных компонентов (редактор конфликтов) — чтобы не передавать его через каждый уровень
export const CodeLang = createContext(null);

/** Токены одной строки: цветные — в span, остальное — текстом */
export function TokenText({ tokens, text }) {
  if (!tokens) return text || ' ';
  if (!tokens.length) return ' ';
  return tokens.map((t, k) => (t.cls ? <span key={k} className={t.cls}>{t.text}</span> : <Fragment key={k}>{t.text}</Fragment>));
}

/** Несколько строк кода с подсветкой синтаксиса (для <pre>): язык — из пропса или из CodeLang */
export function HighlightedLines({ lines, lang }) {
  const ctx = useContext(CodeLang);
  const language = lang ?? ctx;
  const key = lines.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tokens = useMemo(() => highlightLines(lines, language), [key, language]);
  if (!tokens) return key || ' ';
  return tokens.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && '\n'}
      <TokenText tokens={line} text={lines[i]} />
    </Fragment>
  ));
}

/** Токены для набора строк (по одной строке на элемент) — для списков с чекбоксами */
export function useLineTokens(lines, lang) {
  const ctx = useContext(CodeLang);
  const language = lang ?? ctx;
  const key = lines.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => highlightLines(lines, language), [key, language]);
}
