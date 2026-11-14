/**
 * Новое в 2.0: правки текста в редакторе Markdown раздела «Задачи» — чистые функции над строкой и выделением.
 *
 * Каждая функция получает текст и выделение (`start`, `end` — позиции UTF-16, как у `textarea`) и возвращает новый
 * текст с новым выделением, либо `null`, если правка не применима (тогда поле ведёт себя как обычно).
 * Проверка — `tests/ui-parity/markdown-edit.mjs`.
 */

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

const lineStart = (value: string, pos: number) => value.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (value: string, pos: number) => {
  const end = value.indexOf('\n', pos);
  return end < 0 ? value.length : end;
};

/**
 * Обернуть выделение (`**`, `_`, `` ` ``). Уже обёрнутое — развернуть. Пустое выделение — вставить пару с текстом-заготовкой
 * и выделить заготовку.
 */
export function wrapSelection(value: string, start: number, end: number, mark: string, placeholder: string): TextEdit {
  const selected = value.slice(start, end);
  const before = value.slice(Math.max(0, start - mark.length), start);
  const after = value.slice(end, end + mark.length);
  if (selected && before === mark && after === mark) {
    return { value: value.slice(0, start - mark.length) + selected + value.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  const inner = selected || placeholder;
  return { value: value.slice(0, start) + mark + inner + mark + value.slice(end), start: start + mark.length, end: start + mark.length + inner.length };
}

/** Ссылка: `[выделение](url)`, выделяется `url`. */
export function insertLink(value: string, start: number, end: number, textPlaceholder: string): TextEdit {
  const text = value.slice(start, end) || textPlaceholder;
  const head = `[${text}](`;
  const url = 'https://';
  return { value: value.slice(0, start) + head + url + ')' + value.slice(end), start: start + head.length, end: start + head.length + url.length };
}

/** Приставка ко всем строкам выделения (`- `, `- [ ] `, `> `); если она есть у всех — снять. */
export function prefixLines(value: string, start: number, end: number, prefix: string): TextEdit {
  const from = lineStart(value, start);
  const to = lineEnd(value, Math.max(start, end - (end > start && value[end - 1] === '\n' ? 1 : 0)));
  const lines = value.slice(from, to).split('\n');
  const all = lines.every((line) => line.startsWith(prefix));
  const next = lines.map((line) => (all ? line.slice(prefix.length) : prefix + line));
  const block = next.join('\n');
  const shift = all ? -prefix.length : prefix.length;
  const first = Math.max(from, start + shift);
  return { value: value.slice(0, from) + block + value.slice(to), start: start === end ? first : from, end: start === end ? first : from + block.length };
}

/** Пункт списка: отступ, маркер (`-`, `*`, `+`, `1.`, `1)`), флажок задачи, текст. */
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

/**
 * Enter в строке списка: следующий пункт с тем же отступом и маркером (номер +1, флажок пустой). В пустом пункте —
 * пункт убирается и список кончается. Не список, есть выделение или курсор до маркера — `null`.
 */
export function continueList(value: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const from = lineStart(value, start);
  const line = value.slice(from, lineEnd(value, start));
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const [, indent, marker, space, task, text] = match;
  const textStart = from + line.length - text.length;
  if (start < textStart) return null;
  if (!text.trim() && start === from + line.length) {
    return { value: value.slice(0, from) + value.slice(from + line.length), start: from, end: from };
  }
  const number = /^\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
  const insert = `\n${indent}${number}${space}${task ? '[ ] ' : ''}`;
  return { value: value.slice(0, start) + insert + value.slice(start), start: start + insert.length, end: start + insert.length };
}

/** Tab / Shift+Tab в пунктах списка: два пробела отступа у каждой строки выделения. Не список — `null`. */
export function indentList(value: string, start: number, end: number, outdent: boolean): TextEdit | null {
  const from = lineStart(value, start);
  const to = lineEnd(value, end);
  const lines = value.slice(from, to).split('\n');
  if (!lines.every((line) => LIST_ITEM.test(line) || !line.trim())) return null;
  if (!lines.some((line) => LIST_ITEM.test(line))) return null;
  let delta = 0;
  let firstDelta = 0;
  const next = lines.map((line, i) => {
    if (!line.trim()) return line;
    const removed = outdent ? Math.min(2, line.length - line.trimStart().length) : -2;
    if (i === 0) firstDelta = -removed;
    delta -= removed;
    return outdent ? line.slice(removed) : `  ${line}`;
  });
  const block = next.join('\n');
  return { value: value.slice(0, from) + block + value.slice(to), start: Math.max(from, start + firstDelta), end: Math.max(from, end + delta) };
}

export interface Trigger {
  kind: '#' | '@';
  query: string;
  /** Позиция знака `#` или `@`. */
  at: number;
}

/** Подсказка: `#` или `@` в начале слова перед курсором и набранное после него (без пробелов). */
export function findTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(Math.max(0, caret - 64), caret);
  const match = /(^|[\s(\[])([#@])([\p{L}\p{N}_.-]*)$/u.exec(before);
  if (!match) return null;
  const at = caret - match[3].length - 1;
  return { kind: match[2] as '#' | '@', query: match[3], at };
}

/** Заменить `#запрос` / `@запрос` выбранным значением и пробелом. */
export function applyTrigger(value: string, caret: number, trigger: Trigger, text: string): TextEdit {
  const insert = `${trigger.kind}${text} `;
  const pos = trigger.at + insert.length;
  return { value: value.slice(0, trigger.at) + insert + value.slice(caret), start: pos, end: pos };
}

/** Цитата: `> ` в начале каждой строки и пустая строка после. */
export function quoteText(text: string): string {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  return `${lines.map((line) => (line ? `> ${line}` : '>')).join('\n')}\n\n`;
}

/** Добавить цитату в конец поля: с пустой строкой перед ней, если поле не пусто. */
export function appendQuote(value: string, text: string): string {
  const quote = quoteText(text);
  if (!value.trim()) return quote;
  return `${value.replace(/\s+$/, '')}\n\n${quote}`;
}
