// Разбор лога задания GitLab: ANSI-цвета, перезапись строки через \r и сворачиваемые секции
// (section_start:<время>:<имя>[collapsed=true] … section_end:<время>:<имя>)

const FG = {
  30: '#6b7385', 31: '#ff6b6b', 32: '#3cf0a0', 33: '#f5c451', 34: '#5aa2ff', 35: '#c792ea', 36: '#56d4e0', 37: '#d7dae0',
  90: '#8b93a7', 91: '#ff8f8f', 92: '#7dffc0', 93: '#ffe08a', 94: '#8cc0ff', 95: '#e0a8ff', 96: '#8eeaf2', 97: '#ffffff',
};
const PALETTE_256 = (n) => {
  if (n < 8) return FG[30 + n];
  if (n < 16) return FG[90 + n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
};

function applySgr(state, codes) {
  const list = codes === '' ? [0] : codes.split(';').map(Number);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === 0) Object.assign(state, { fg: null, bold: false, italic: false, underline: false, dim: false });
    else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 3) state.italic = true;
    else if (c === 4) state.underline = true;
    else if (c === 22) Object.assign(state, { bold: false, dim: false });
    else if (c === 23) state.italic = false;
    else if (c === 24) state.underline = false;
    else if (c === 39) state.fg = null;
    else if (FG[c]) state.fg = FG[c];
    else if (c === 38 && list[i + 1] === 5) {
      state.fg = PALETTE_256(list[i + 2] ?? 7);
      i += 2;
    } else if (c === 38 && list[i + 1] === 2) {
      state.fg = `rgb(${list[i + 2] ?? 0},${list[i + 3] ?? 0},${list[i + 4] ?? 0})`;
      i += 4;
    }
  }
}

// Текст с ANSI → сегменты { text, fg, bold, italic, underline, dim }
function toSegments(text, state) {
  const segs = [];
  const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), ...state });
    if (m[1] !== undefined && m[0].endsWith('m')) applySgr(state, m[1]);
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), ...state });
  return segs.filter((s) => s.text);
}

// \r внутри строки: терминал перезаписывает строку — оставляем последний вариант
function collapseCarriage(text) {
  if (!text.includes('\r')) return text;
  const parts = text.split('\r').filter((p) => p.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') !== '');
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Возвращает дерево: { children: [ { type:'line', n, segs } | { type:'section', key, name, title:segs, n, duration, collapsed, children } ] }
 */
export function parseLog(text) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const state = { fg: null, bold: false, italic: false, underline: false, dim: false };
  let n = 0;
  let key = 0;
  const marker = /section_(start|end):(\d+):([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\r?(?:\x1b\[0?K)*/g;

  const top = () => stack[stack.length - 1];
  const pushLine = (raw) => {
    const segs = toSegments(collapseCarriage(raw), state);
    n += 1;
    top().children.push({ type: 'line', n, segs });
  };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    marker.lastIndex = 0;
    if (!line.includes('section_')) {
      pushLine(line);
      continue;
    }
    let last = 0;
    let m;
    let pendingHeader = null;
    while ((m = marker.exec(line))) {
      const before = line.slice(last, m.index);
      if (before.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()) pushLine(before);
      last = m.index + m[0].length;
      const [, kind, ts, name, opts] = m;
      if (kind === 'start') {
        const section = {
          type: 'section',
          key: key++,
          name,
          start: Number(ts),
          end: null,
          duration: null,
          collapsed: /collapsed=true/.test(opts ?? ''),
          title: [],
          n: 0,
          children: [],
        };
        top().children.push(section);
        stack.push(section);
        pendingHeader = section;
      } else {
        // Закрываем ближайшую секцию с таким именем (и всё, что внутри неё осталось открытым)
        const idx = stack.map((s) => s.name).lastIndexOf(name);
        if (idx > 0) {
          const section = stack[idx];
          section.end = Number(ts);
          section.duration = section.end - section.start;
          stack.length = idx;
        }
      }
    }
    const rest = line.slice(last);
    if (pendingHeader && !pendingHeader.title.length) {
      n += 1;
      pendingHeader.n = n;
      pendingHeader.title = toSegments(collapseCarriage(rest), state);
      if (!pendingHeader.title.length) pendingHeader.title = [{ text: pendingHeader.name, ...state }];
    } else if (rest.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length) {
      pushLine(rest);
    }
  }
  // Хвост из одних escape-кодов — не строка
  while (root.children.length && root.children.at(-1).type === 'line' && !root.children.at(-1).segs.length) {
    root.children.pop();
    n -= 1;
  }
  root.lineCount = n;
  return root;
}
