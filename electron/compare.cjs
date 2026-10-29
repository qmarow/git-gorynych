// Сравнение двух любых коммитов: какие файлы и насколько отличаются, сколько коммитов между ними
const { git, getCommitFiles, HASH_RE } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const FS = '\x1f';
const MAX_LOG = 200;

async function info(cwd, hash) {
  const out = (await git(cwd, ['log', '-1', `--format=%H${FS}%s${FS}%an${FS}%aI`, hash])).trim();
  const [h, subject, author, date] = out.split(FS);
  return { hash: h, subject, author, date };
}

async function log(cwd, range) {
  const out = await git(cwd, ['log', '-n', String(MAX_LOG), `--format=%H${FS}%s${FS}%an${FS}%aI`, range]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, author, date] = l.split(FS);
      return { hash, subject, author, date };
    });
}

/** a — «было», b — «стало» */
async function compareCommits(cwd, { a, b }) {
  if (!HASH_RE.test(a ?? '') || !HASH_RE.test(b ?? '')) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  if (a === b) throw new GitError('Выбран один и тот же коммит', { code: 'BAD_ARGS' });
  const [infoA, infoB, files, counts, base] = await Promise.all([
    info(cwd, a),
    info(cwd, b),
    getCommitFiles(cwd, b, a),
    git(cwd, ['rev-list', '--left-right', '--count', `${a}...${b}`]),
    git(cwd, ['merge-base', a, b]).then((x) => x.trim(), () => null),
  ]);
  const [onlyA, onlyB] = counts.trim().split(/\s+/).map(Number);
  const [logB, logA] = await Promise.all([onlyB ? log(cwd, `${a}..${b}`) : [], onlyA ? log(cwd, `${b}..${a}`) : []]);
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return {
    a: infoA,
    b: infoB,
    mergeBase: base,
    relation: base === a ? 'a-before-b' : base === b ? 'b-before-a' : 'diverged',
    onlyA,
    onlyB,
    commitsA: logA,
    commitsB: logB,
    files,
    additions,
    deletions,
  };
}

/* ---------- Поиск по содержимому изменений ---------- */

const MAX_MATCHES = 2000; // всего совпадений
const MAX_LINES_PER_FILE = 50; // строк с совпадениями на файл (счётчик — полный)
const MAX_LINE_TEXT = 400;

const escapeEre = (s) => s.replace(/[.[\]{}()*+?^$|\\]/g, '\\$&');

/** Путь из заголовка diff: «b/путь» или «"b/пу\303\266ть"» (с core.quotepath=false кавычки — только для спецсимволов) */
function unquote(raw) {
  const p = raw.replace(/\t$/, ''); // git ставит TAB после пути с пробелами
  if (!p.startsWith('"')) return p;
  const bytes = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = body[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push({ n: 10, t: 9, r: 13, '"': 34, '\\': 92 }[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Найти текст в изменённых строках между a («было») и b («стало»).
 * query — строка или регулярное выражение (regex: true, синтаксис JavaScript); caseSensitive — учитывать регистр.
 * → { files: [{ path, oldPath, count, lines: [{ t: '+'|'-', line, text, ranges: [[from, to]] }] }], total, truncated }
 */
async function searchChanges(cwd, { a, b, query, regex = false, caseSensitive = false } = {}) {
  if (!HASH_RE.test(a ?? '') || !HASH_RE.test(b ?? '')) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  const q = String(query ?? '');
  if (!q.trim()) return { files: [], total: 0, truncated: false };
  if (q.length > 500) throw new GitError('Слишком длинный запрос', { code: 'BAD_ARGS' });
  let re;
  try {
    re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch (error) {
    throw new GitError('Неверное регулярное выражение', { code: 'BAD_ARGS', hint: error.message });
  }
  if (re.test('')) throw new GitError('Выражение совпадает с пустой строкой', { code: 'BAD_ARGS' });

  // Обычный текст — git сам отберёт файлы, где он есть в добавленных/удалённых строках (-G);
  // регулярку JavaScript в git не передаём: синтаксис другой, фильтруем сами
  const args = ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '-M', '-U0', '--ignore-cr-at-eol'];
  // (без учёта регистра — только для ASCII: регистр кириллицы движок регулярок git сравнивает ненадёжно)
  if (!regex && (caseSensitive || /^[\x20-\x7e]*$/.test(q))) args.push(`-G${escapeEre(q)}`, ...(caseSensitive ? [] : ['--regexp-ignore-case']));
  args.push(a, b);
  let out;
  try {
    out = await git(cwd, args);
  } catch (error) {
    if (!/ignore-cr-at-eol|unknown option/i.test(error.details || error.message)) throw error;
    out = await git(cwd, args.filter((x) => x !== '--ignore-cr-at-eol'));
  }

  const files = [];
  let file = null;
  let oldLine = 0;
  let newLine = 0;
  let total = 0;
  let truncated = false;
  let pendingOld = null;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      file = null;
      pendingOld = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      pendingOld = line === '--- /dev/null' ? null : unquote(line.slice(4)).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const next = line === '+++ /dev/null' ? null : unquote(line.slice(4)).replace(/^b\//, '');
      const path = next ?? pendingOld;
      file = { path, oldPath: pendingOld && next && pendingOld !== next ? pendingOld : null, count: 0, lines: [] };
      files.push(file);
      continue;
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      continue;
    }
    if (!file || !(line.startsWith('+') || line.startsWith('-'))) continue;
    const t = line[0];
    const text = line.slice(1);
    const num = t === '+' ? newLine++ : oldLine++;
    if (truncated) continue;
    re.lastIndex = 0;
    const ranges = [];
    let m;
    while ((m = re.exec(text)) && ranges.length < 50) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      ranges.push([m.index, m.index + m[0].length]);
    }
    if (!ranges.length) continue;
    file.count += ranges.length;
    total += ranges.length;
    if (file.lines.length < MAX_LINES_PER_FILE) {
      // Длинную строку обрезаем вокруг первого совпадения, диапазоны сдвигаем
      let shown = text;
      let shift = 0;
      if (text.length > MAX_LINE_TEXT) {
        shift = Math.max(0, ranges[0][0] - 80);
        shown = text.slice(shift, shift + MAX_LINE_TEXT);
      }
      file.lines.push({
        t,
        line: num,
        text: shown,
        cut: shift > 0 || shift + shown.length < text.length,
        ranges: ranges.map(([x, y]) => [x - shift, y - shift]).filter(([x, y]) => x >= 0 && y <= shown.length),
      });
    }
    if (total >= MAX_MATCHES) truncated = true;
  }
  return { files: files.filter((f) => f.count > 0), total, truncated };
}

/* ---------- Поиск по изменениям в истории (поиск по графу) ---------- */

const HIST_MAX_COMMITS = 300; // коммитов с совпадениями
const HIST_MAX_FILES = 30; // файлов на коммит
const HIST_MAX_LINES = 8; // строк на файл (счётчик — полный)
const HIST_MAX_HASHES = 5000;

/** Текст → ERE для git -G без учёта регистра и для кириллицы: «При» → «(П|п)(р|Р)(и|И)» */
function caseFreeEre(q) {
  let out = '';
  for (const ch of q) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    out += lo !== up && [...lo].length === 1 && [...up].length === 1 ? `(${escapeEre(lo)}|${escapeEre(up)})` : escapeEre(ch);
  }
  return out;
}

/**
 * В каких коммитах графа текст встречается в изменённых строках — и где именно.
 * hashes — коммиты, загруженные в граф (в их порядке); query — текст или регулярка (regex: true).
 * → { commits: [{ hash, files: [{ path, oldPath, status, count, lines: [{ t, o, n, text, ranges }] }], count }], total, truncated }
 * Строка: t '+' — добавлена (n — номер в новой версии), '-' — удалена (o — номер в старой).
 */
async function searchHistory(cwd, { hashes = [], query, regex = false, caseSensitive = false } = {}) {
  const q = String(query ?? '');
  if (!q.trim()) return { commits: [], total: 0, truncated: false };
  if (q.length > 500) throw new GitError('Слишком длинный запрос', { code: 'BAD_ARGS' });
  const list = (Array.isArray(hashes) ? hashes : []).filter((h) => HASH_RE.test(String(h))).slice(0, HIST_MAX_HASHES);
  if (!list.length) return { commits: [], total: 0, truncated: false };
  let re;
  try {
    re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch (error) {
    throw new GitError('Неверное регулярное выражение', { code: 'BAD_ARGS', hint: error.message });
  }
  if (re.test('')) throw new GitError('Выражение совпадает с пустой строкой', { code: 'BAD_ARGS' });

  // git сам отбирает коммиты, где текст есть в добавленных/удалённых строках (-G); регулярку JavaScript
  // в git не передаём (синтаксис другой) — тогда отбираем сами, но смотрим меньше коммитов
  const pre = !regex ? (caseSensitive ? escapeEre(q) : /^[\x20-\x7e]*$/.test(q) ? escapeEre(q) : caseFreeEre(q)) : null;
  const scan = regex ? list.slice(0, 400) : list;
  const base = ['log', '--no-walk=unsorted', '--stdin', '--format=%x1e%H', '-p', '-U0', '--no-color', '--no-ext-diff', '-M'];
  if (pre) base.push(`-G${pre}`, ...(!caseSensitive && /^[\x20-\x7e]*$/.test(q) ? ['--regexp-ignore-case'] : []));
  const input = `${scan.join('\n')}\n`;
  let out;
  try {
    out = await git(cwd, [...base, '--diff-merges=first-parent'], { input });
  } catch (error) {
    if (!/diff-merges|unknown option|unrecognized/i.test(error.details || error.message)) throw error;
    out = await git(cwd, base, { input });
  }

  const commits = [];
  let total = 0;
  let truncated = false;
  for (const rec of out.split('\x1e')) {
    const nl = rec.indexOf('\n');
    const hash = (nl < 0 ? rec : rec.slice(0, nl)).trim();
    if (!HASH_RE.test(hash)) continue;
    const files = [];
    let file = null;
    let oldLine = 0;
    let newLine = 0;
    let pendingOld = null;
    let status = 'M';
    for (const raw of rec.slice(nl + 1).split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('diff --git ')) {
        file = null;
        pendingOld = null;
        status = 'M';
        continue;
      }
      if (!file && line.startsWith('new file mode')) status = 'A';
      else if (!file && line.startsWith('deleted file mode')) status = 'D';
      else if (!file && line.startsWith('rename from ')) status = 'R';
      if (line.startsWith('--- ')) {
        pendingOld = line === '--- /dev/null' ? null : unquote(line.slice(4)).replace(/^a\//, '');
        continue;
      }
      if (line.startsWith('+++ ')) {
        const next = line === '+++ /dev/null' ? null : unquote(line.slice(4)).replace(/^b\//, '');
        file = { path: next ?? pendingOld, oldPath: pendingOld && next && pendingOld !== next ? pendingOld : null, status, count: 0, lines: [] };
        files.push(file);
        continue;
      }
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (h) {
        oldLine = Number(h[1]);
        newLine = Number(h[2]);
        continue;
      }
      if (!file || !(line.startsWith('+') || line.startsWith('-'))) continue;
      const t = line[0];
      const text = line.slice(1);
      const o = t === '-' ? oldLine++ : null;
      const n = t === '+' ? newLine++ : null;
      re.lastIndex = 0;
      const ranges = [];
      let m;
      while ((m = re.exec(text)) && ranges.length < 20) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
      if (!ranges.length) continue;
      file.count += ranges.length;
      if (file.lines.length < HIST_MAX_LINES) {
        let shown = text;
        let shift = 0;
        if (text.length > 240) {
          shift = Math.max(0, ranges[0][0] - 60);
          shown = text.slice(shift, shift + 240);
        }
        file.lines.push({
          t,
          o,
          n,
          text: shown,
          cut: shift > 0 || shift + shown.length < text.length,
          ranges: ranges.map(([x, y]) => [x - shift, y - shift]).filter(([x, y]) => x >= 0 && y <= shown.length),
        });
      }
    }
    const hit = files.filter((f) => f.count > 0);
    if (!hit.length) continue;
    const count = hit.reduce((acc, f) => acc + f.count, 0);
    total += count;
    commits.push({ hash, files: hit.slice(0, HIST_MAX_FILES), moreFiles: Math.max(0, hit.length - HIST_MAX_FILES), count });
    if (commits.length >= HIST_MAX_COMMITS) {
      truncated = true;
      break;
    }
  }
  return { commits, total, truncated, scanned: scan.length, partial: scan.length < list.length };
}

module.exports = { compareCommits, searchChanges, searchHistory };
