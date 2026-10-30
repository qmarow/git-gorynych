// История одного файла (через переименования) и построчное авторство (git blame).
const { git, resolveRepoRoot, safeRelative, parseUnifiedDiff, HASH_RE } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const FS = '\x1f';
const RS = '\x1e';
const MAX_COMMITS = 300;
const MAX_PATCH_LINES = 3000; // на коммит: больше — diff подгрузится при выборе
const MAX_TOTAL_PATCH = 60000;
const MAX_BLAME_LINES = 30000;

/** ref для git: хэш или HEAD (ничего другого из интерфейса не приходит) */
function checkRev(rev) {
  if (rev == null || rev === 'HEAD') return rev ?? null;
  if (typeof rev !== 'string' || !HASH_RE.test(rev)) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  return rev;
}

/** Путь из заголовка diff: «b/путь» или в кавычках с восьмеричными кодами (core.quotepath=false — только спецсимволы) */
function unquote(raw) {
  const p = String(raw).replace(/\t$/, '');
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
 * История файла: git log --follow --numstat -p — коммиты, которые меняли файл, в том числе под прежними именами.
 * → { path, commits: [{ hash, parents, author, email, date, subject, body, path, oldPath, status, additions, deletions, binary, diff }], renamed, truncated }
 * path у коммита — имя файла в этом коммите; diff — разобранный patch (null — слишком большой, загрузить отдельно).
 */
async function fileHistory(dir, { path: file, rev = null, limit = MAX_COMMITS } = {}) {
  const root = await resolveRepoRoot(dir);
  if (!file || typeof file !== 'string') throw new GitError('Не указан файл', { code: 'BAD_ARGS' });
  safeRelative(root, file);
  const start = checkRev(rev) ?? 'HEAD';
  const n = Math.max(1, Math.min(Number(limit) || MAX_COMMITS, 2000));
  const format = `${RS}%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%s${FS}%b${FS}`;
  let out;
  try {
    out = await git(root, ['log', '--follow', '-M', '--numstat', '-p', '--no-color', '--no-ext-diff', `--format=${format}`, `-n${n + 1}`, start, '--', file]);
  } catch (error) {
    // Пустой репозиторий или файла нет в истории
    if (/does not have any commits|unknown revision|bad revision/i.test(error.details || error.message)) return { path: file, commits: [], renamed: false, truncated: false };
    throw error;
  }

  const commits = [];
  let patchBudget = MAX_TOTAL_PATCH;
  for (const rec of out.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.split(FS);
    if (parts.length < 8) continue;
    const [hash, parents, author, email, date, subject, body] = parts;
    const rest = parts.slice(7).join(FS);
    const diffAt = rest.indexOf('diff --git ');
    const head = diffAt >= 0 ? rest.slice(0, diffAt) : rest;
    const patch = diffAt >= 0 ? rest.slice(diffAt) : '';

    // --numstat: «доб.\tудал.\tпуть» (для двоичных «-\t-»)
    let additions = 0;
    let deletions = 0;
    let binary = false;
    for (const line of head.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
      if (!m) continue;
      if (m[1] === '-') binary = true;
      else {
        additions += Number(m[1]);
        deletions += Number(m[2]);
      }
    }
    // Имя файла в коммите и переименование — из заголовков patch
    let status = 'M';
    let newPath = null;
    let oldPath = null;
    for (const line of patch.split('\n', 12)) {
      if (line.startsWith('new file mode')) status = 'A';
      else if (line.startsWith('deleted file mode')) status = 'D';
      else if (line.startsWith('rename from ')) {
        status = 'R';
        oldPath = unquote(line.slice(12));
      } else if (line.startsWith('rename to ')) newPath = unquote(line.slice(10));
      else if (line.startsWith('copy from ')) {
        status = 'C';
        oldPath = unquote(line.slice(10));
      } else if (line.startsWith('copy to ')) newPath = unquote(line.slice(8));
      else if (line.startsWith('+++ ') && !newPath) newPath = line === '+++ /dev/null' ? null : unquote(line.slice(4)).replace(/^b\//, '');
      else if (line.startsWith('--- ') && !oldPath && status === 'D') oldPath = unquote(line.slice(4)).replace(/^a\//, '');
      else if (line.startsWith('diff --git ') && !newPath) {
        const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
        if (m) newPath = m[2];
      }
    }
    const pathHere = newPath ?? oldPath ?? file;

    let diff = null;
    const patchLines = patch ? patch.split('\n').length : 0;
    if (patch && patchLines <= MAX_PATCH_LINES && patchBudget > 0) {
      patchBudget -= patchLines;
      diff = { ...parseUnifiedDiff(patch), path: pathHere, oldPath: status === 'R' || status === 'C' ? oldPath : null };
    }

    commits.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      email,
      date,
      subject,
      body: body.trim(),
      path: pathHere,
      oldPath: status === 'R' || status === 'C' ? oldPath : null,
      status,
      additions: binary ? null : additions,
      deletions: binary ? null : deletions,
      binary,
      diff,
    });
  }
  const truncated = commits.length > n;
  if (truncated) commits.length = n;
  return { path: file, commits, renamed: commits.some((c) => c.status === 'R'), truncated };
}

/**
 * Построчное авторство: git blame --porcelain [-w] <rev> -- <file>.
 * rev: хэш, HEAD или null — рабочая папка (с незакоммиченными строками).
 * → { path, rev, lines: [{ text, sha, origLine }], commits: { sha: { author, email, time, summary, filename, previous, boundary, uncommitted } }, truncated }
 */
async function blame(dir, { path: file, rev = 'HEAD', ignoreWhitespace = false } = {}) {
  const root = await resolveRepoRoot(dir);
  if (!file || typeof file !== 'string') throw new GitError('Не указан файл', { code: 'BAD_ARGS' });
  safeRelative(root, file);
  const r = checkRev(rev);
  const args = ['blame', '--porcelain', ...(ignoreWhitespace ? ['-w'] : []), ...(r ? [r] : []), '--', file];
  let out;
  try {
    out = await git(root, args);
  } catch (error) {
    const text = error.details || error.message || '';
    if (/no such path|does not exist|no such file/i.test(text)) {
      throw new GitError(r ? `Файла ${file} нет в версии ${String(r).slice(0, 7)}` : `Файла ${file} нет`, { code: 'NOT_FOUND', hint: 'Возможно, файл был создан позже или переименован' });
    }
    throw error;
  }

  const commits = {};
  const lines = [];
  let cur = null;
  let truncated = false;
  const rows = out.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.startsWith('\t')) {
      if (lines.length >= MAX_BLAME_LINES) {
        truncated = true;
        break;
      }
      lines.push({ text: row.slice(1).replace(/\r$/, ''), sha: cur.sha, origLine: cur.orig });
      continue;
    }
    const head = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(row);
    if (head) {
      cur = { sha: head[1], orig: Number(head[2]) };
      if (!commits[cur.sha]) commits[cur.sha] = { uncommitted: /^0+$/.test(cur.sha) };
      continue;
    }
    if (!cur) continue;
    const c = commits[cur.sha];
    const sp = row.indexOf(' ');
    const key = sp < 0 ? row : row.slice(0, sp);
    const val = sp < 0 ? '' : row.slice(sp + 1);
    if (key === 'author') c.author = val;
    else if (key === 'author-mail') c.email = val.replace(/^<|>$/g, '');
    else if (key === 'author-time') c.time = Number(val) * 1000;
    else if (key === 'summary') c.summary = val;
    else if (key === 'filename') c.filename = val;
    else if (key === 'boundary') c.boundary = true;
    else if (key === 'previous') {
      const m = /^([0-9a-f]{40}) (.+)$/.exec(val);
      if (m) c.previous = { sha: m[1], path: m[2] };
    }
  }
  return { path: file, rev: r, ignoreWhitespace: Boolean(ignoreWhitespace), lines, commits, truncated };
}

/** Коммит для поповера blame: полное сообщение и статистика (весь коммит и этот файл) */
async function commitInfo(dir, { hash, path: file = null } = {}) {
  const root = await resolveRepoRoot(dir);
  if (!HASH_RE.test(hash ?? '')) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  const out = await git(root, ['show', '--numstat', '-M', '--no-color', `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%cn${FS}%s${FS}%b${RS}`, hash]);
  const [meta, stat = ''] = out.split(RS);
  const [h, parents, author, email, date, committer, subject, body] = meta.split(FS);
  let files = 0;
  let additions = 0;
  let deletions = 0;
  let fileStat = null;
  for (const line of stat.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    files++;
    const a = m[1] === '-' ? 0 : Number(m[1]);
    const d = m[2] === '-' ? 0 : Number(m[2]);
    additions += a;
    deletions += d;
    // «старое => новое» и «dir/{a => b}/x» при переименовании
    const p = m[3].replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/');
    if (file && p === file) fileStat = { additions: a, deletions: d };
  }
  return { hash: h, parents: parents ? parents.split(' ') : [], author, email, date, committer, subject, body: body.trim(), files, additions, deletions, fileStat };
}

module.exports = { fileHistory, blame, commitInfo };
