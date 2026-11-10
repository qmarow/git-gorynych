// Подсветка изменений внутри строки: что именно поменялось между удалённой и добавленной строкой.

const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const MAX_CELLS = 250_000; // предел для LCS (n × m), дальше — грубое сравнение по краям

/** Кусок строки: изменён или нет. */
export interface Segment {
  text: string;
  changed: boolean;
}

export interface LineDiff {
  old: Segment[];
  new: Segment[];
  /** Доля неизменённого текста, 0…1. */
  similarity: number;
}

const tokenize = (s: string): string[] => s.match(TOKEN_RE) ?? [];

// Наибольшая общая подпоследовательность токенов → пометки «изменён» для каждого токена
function lcsMarks(a: string[], b: string[]): [boolean[], boolean[]] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ma: boolean[] = new Array(n).fill(true);
  const mb: boolean[] = new Array(m).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ma[i] = false;
      mb[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [ma, mb];
}

// Токены + пометки → сегменты; короткие неизменённые «мостики» (пробел, точка) между правками сливаем
function toSegments(tokens: string[], marks: boolean[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let changed = marks[i];
    if (!changed && i > 0 && i < tokens.length - 1 && marks[i - 1] && marks[i + 1] && tokens[i].length <= 1) changed = true;
    const last = segs[segs.length - 1];
    if (last && last.changed === changed) last.text += tokens[i];
    else segs.push({ text: tokens[i], changed });
  }
  return segs;
}

const changedLength = (segs: Segment[]): number => segs.reduce((n, s) => n + (s.changed ? s.text.length : 0), 0);

/**
 * Сравнить две строки. Возвращает { old: [{text, changed}], new: [...], similarity } или null,
 * если строки слишком разные — тогда подсвечивать внутри строки бессмысленно.
 */
export function diffLine(oldText: string, newText: string): LineDiff | null {
  if (oldText === newText) return null;
  // Общие начало и конец — по символам (быстро и точно для типичной правки в середине)
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;
  let end = 0;
  while (end < minLen - start && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  // Не режем слово посередине: расширяем изменённую часть до границ токенов
  const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
  while (start > 0 && isWord(oldText[start - 1]) && (isWord(oldText[start]) || isWord(newText[start]))) start--;
  while (
    end > 0 &&
    isWord(oldText[oldText.length - end]) &&
    (isWord(oldText[oldText.length - end - 1]) || isWord(newText[newText.length - end - 1]))
  )
    end--;

  const prefix = oldText.slice(0, start);
  const suffix = end ? oldText.slice(oldText.length - end) : '';
  const midOld = oldText.slice(start, oldText.length - end);
  const midNew = newText.slice(start, newText.length - end);

  let oldSegs: Segment[];
  let newSegs: Segment[];
  const ta = tokenize(midOld);
  const tb = tokenize(midNew);
  if (ta.length && tb.length && ta.length * tb.length <= MAX_CELLS) {
    const [ma, mb] = lcsMarks(ta, tb);
    oldSegs = toSegments(ta, ma);
    newSegs = toSegments(tb, mb);
  } else {
    oldSegs = midOld ? [{ text: midOld, changed: true }] : [];
    newSegs = midNew ? [{ text: midNew, changed: true }] : [];
  }
  const wrap = (segs: Segment[]): Segment[] => [
    ...(prefix ? [{ text: prefix, changed: false }] : []),
    ...segs,
    ...(suffix ? [{ text: suffix, changed: false }] : []),
  ];
  const oldFull = merge(wrap(oldSegs));
  const newFull = merge(wrap(newSegs));

  // Похожесть: доля неизменённого текста. Если почти всё поменялось — подсветка только мешает
  const total = Math.max(oldText.length, newText.length) || 1;
  const changed = Math.max(changedLength(oldFull), changedLength(newFull));
  const similarity = 1 - changed / total;
  if (similarity < 0.35 && !(oldText.trim() === newText.trim())) return null;
  return { old: oldFull, new: newFull, similarity };
}

function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.changed === s.changed) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

// Похожесть двух строк без полной разметки — для подбора пар в блоке правок
function quickSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const r = diffLine(a, b);
  return r ? r.similarity : 0;
}

/** Строка ханка: `t` — `'-'`, `'+'` или контекст. */
export interface HunkLine {
  t: string;
  text: string;
}

/** Индекс строки → сегменты; `pairs` — удалённая строка → добавленная (выравнивание в режиме Split). */
export type InlineHighlights = Map<number, Segment[]> & { pairs: Map<number, number> };

/**
 * Для блока подряд идущих удалений и добавлений подбираем пары «было → стало»
 * и считаем подсветку. Возвращает Map: индекс строки в hunk.lines → сегменты;
 * в result.pairs — пары «индекс удалённой → индекс добавленной» (для выравнивания в режиме Split).
 */
export function inlineHighlights(lines: readonly HunkLine[]): InlineHighlights {
  const result = Object.assign(new Map<number, Segment[]>(), { pairs: new Map<number, number>() });
  let i = 0;
  while (i < lines.length) {
    if (lines[i].t !== '-' && lines[i].t !== '+') {
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < lines.length && lines[i].t === '-') dels.push(i++);
    while (i < lines.length && lines[i].t === '+') adds.push(i++);
    if (!dels.length || !adds.length) continue;
    if (dels.length * adds.length > 400) continue; // огромный блок — не тратим время

    // Жадно по порядку: каждой удалённой строке — самая похожая из оставшихся добавленных (не возвращаясь назад)
    let from = 0;
    for (const d of dels) {
      let best = -1;
      let bestScore = 0.35;
      for (let k = from; k < adds.length && k < from + 6; k++) {
        const score = quickSimilarity(lines[d].text, lines[adds[k]].text);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best === -1) continue;
      const diff = diffLine(lines[d].text, lines[adds[best]].text);
      if (diff) {
        result.set(d, diff.old);
        result.set(adds[best], diff.new);
        result.pairs.set(d, adds[best]);
      }
      from = best + 1;
    }
  }
  return result;
}
