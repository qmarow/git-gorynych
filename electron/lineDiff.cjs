// Построчный diff (алгоритм Майерса) — для предпросмотра правок CI-файла и точечного применения правок YAML.

/**
 * Возвращает список операций: { type: 'equal' | 'delete' | 'insert', a, b } —
 * a — индекс строки в старом тексте, b — в новом (для insert/delete один из них null).
 */
function diffLines(a, b) {
  // Общие начало и конец — отдельно: алгоритму останется только середина
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const mid = myers(A, B).map((op) => ({
    type: op.type,
    a: op.a === null ? null : op.a + start,
    b: op.b === null ? null : op.b + start,
  }));
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', a: i, b: i });
  ops.push(...mid);
  for (let i = 0; i < a.length - endA; i++) ops.push({ type: 'equal', a: endA + i, b: endB + i });
  return ops;
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((_, j) => ({ type: 'insert', a: null, b: j }));
  if (!m) return a.map((_, i) => ({ type: 'delete', a: i, b: null }));
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice());
        break outer;
      }
    }
  }
  // Обратный проход по следу
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', a: --x, b: --y });
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: 'insert', a: null, b: --y });
      else ops.push({ type: 'delete', a: --x, b: null });
    }
  }
  while (x > 0 && y > 0) ops.push({ type: 'equal', a: --x, b: --y });
  return ops.reverse();
}

/** Операции → фрагменты (hunks) в том же формате, что и разбор `git diff` */
function toHunks(oldLines, newLines, ops, context = 3) {
  const changed = ops.map((op) => op.type !== 'equal');
  const hunks = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let prevTo = 0;
  while (i < ops.length) {
    if (!changed[i]) {
      i++;
      continue;
    }
    const from = Math.max(prevTo, i - context);
    let to = i;
    // Расширяем фрагмент, пока между изменениями не больше 2×context неизменных строк
    while (to < ops.length) {
      if (changed[to]) {
        to++;
        continue;
      }
      let run = 0;
      while (to + run < ops.length && !changed[to + run]) run++;
      if (to + run >= ops.length || run > context * 2) {
        to = Math.min(ops.length, to + context);
        break;
      }
      to += run;
    }
    const slice = ops.slice(from, to);
    const firstOld = slice.find((op) => op.a !== null)?.a ?? 0;
    const firstNew = slice.find((op) => op.b !== null)?.b ?? 0;
    const lines = slice.map((op) => {
      if (op.type === 'equal') return { t: ' ', o: op.a + 1, n: op.b + 1, text: oldLines[op.a] };
      if (op.type === 'delete') {
        deletions++;
        return { t: '-', o: op.a + 1, n: null, text: oldLines[op.a] };
      }
      additions++;
      return { t: '+', o: null, n: op.b + 1, text: newLines[op.b] };
    });
    const oldCount = lines.filter((l) => l.t !== '+').length;
    const newCount = lines.filter((l) => l.t !== '-').length;
    hunks.push({ header: `@@ -${firstOld + 1},${oldCount} +${firstNew + 1},${newCount} @@`, section: '', lines });
    i = to;
    prevTo = to;
  }
  return { hunks, additions, deletions, binary: false, truncated: false };
}

module.exports = { diffLines, toHunks };
