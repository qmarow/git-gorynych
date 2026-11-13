/**
 * Подсветка найденного в графе (новое в 2.0): те же правила, что у `matchCommit` (`SearchBar.tsx`) — запрос без регистра,
 * слова через пробелы, каждое ищется подстрокой. Здесь — где именно в тексте эти слова, чтобы обернуть их в `<mark>`.
 */

/** Слова запроса, как их сравнивает `matchCommit`. Пустой запрос — нет слов. */
export function searchWords(query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? q.split(/\s+/) : [];
}

/** Текст кусками: `[кусок, совпал]`. Места всех слов, пересекающиеся и соседние слиты. Склейка кусков — исходный текст. */
export function markSegments(text: string, words: readonly string[]): [string, boolean][] {
  if (!text || !words.length) return [[text, false]];
  const lower = text.toLowerCase();
  // Редкие буквы (например, «İ») при смене регистра меняют длину: позиции бы съехали — такой текст не размечаем
  if (lower.length !== text.length) return [[text, false]];
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) ranges.push([at, at + word.length]);
  }
  if (!ranges.length) return [[text, false]];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [from, to] of ranges) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  const out: [string, boolean][] = [];
  let pos = 0;
  for (const [from, to] of merged) {
    if (from > pos) out.push([text.slice(pos, from), false]);
    out.push([text.slice(from, to), true]);
    pos = to;
  }
  if (pos < text.length) out.push([text.slice(pos), false]);
  return out;
}
