// Работа с Git через системный git.exe (без сторонних зависимостей).
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { GitError, fromProcessError } = require('./errors.cjs');

/* ---------------- Поиск git.exe ---------------- */

// Windows передаёт новый PATH только программам, запущенным после установки Git.
// Если терминал (или VS Code) открыт раньше, Electron получает старый PATH без Git.
// Поэтому ищем git.exe сами: PATH процесса → свежий PATH из реестра → стандартные папки.

function readRegistryPath(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    return /\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

const expandVars = (p) => p.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);

let gitBinary = null;
let gitSearched = [];

function findGit() {
  if (gitBinary) return gitBinary;
  if (process.platform !== 'win32') return (gitBinary = 'git');

  const dirs = [];
  const addPathList = (list) =>
    (list || '')
      .split(';')
      .map((s) => expandVars(s.trim().replace(/^"|"$/g, '')))
      .filter(Boolean)
      .forEach((d) => dirs.push(d));

  addPathList(process.env.PATH || process.env.Path);
  addPathList(readRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'));
  addPathList(readRegistryPath('HKCU\\Environment'));

  const bases = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    'C:\\Program Files',
  ].filter(Boolean);
  for (const base of bases) dirs.push(path.join(base, 'Git', 'cmd'), path.join(base, 'Git', 'bin'));
  if (process.env.USERPROFILE) dirs.push(path.join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'cmd'));

  gitSearched = [...new Set(dirs)];
  for (const dir of gitSearched) {
    const candidate = path.join(dir, 'git.exe');
    try {
      if (fs.statSync(candidate).isFile()) return (gitBinary = candidate);
    } catch {
      /* нет файла — ищем дальше */
    }
  }
  return 'git'; // не нашли: пусть ошибку покажет сам execFile
}

function gitInfo() {
  return { binary: findGit(), searched: gitSearched };
}

const FS = '\x1f'; // разделитель полей
const RS = '\x1e'; // разделитель записей
const HASH_RE = /^[0-9a-f]{4,64}$/i;

const DEFAULT_LIMIT = 2000;

/**
 * Запуск git. options.env — доп. переменные окружения, options.timeout — мс.
 * При ошибке бросает GitError с классификацией (AUTH, FORBIDDEN, PROTECTED, ...).
 */
function git(cwd, args, { env, timeout = 0, input = null, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      findGit(),
      ['-c', 'core.quotepath=false', '-c', 'color.ui=never', ...args],
      {
        cwd,
        encoding, // 'buffer' — содержимое файлов как есть (двоичные файлы)
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
        timeout,
        // GIT_OPTIONAL_LOCKS=0: чтение (status и т.п.) не перезаписывает .git/index —
        // иначе слежение за папкой видело бы собственные запросы как изменения
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(env ?? {}) },
      },
      (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT') {
          gitBinary = null; // при следующем вызове поищем снова (вдруг Git уже установили)
          const err = fromProcessError(error, stdout, stderr);
          err.details = `Искали git.exe в:\n${gitSearched.join('\n') || '(PATH)'}`;
          reject(err);
        } else if (error) reject(fromProcessError(error, stdout, stderr));
        else resolve(stdout);
      },
    );
    // Данные на stdin (например, список коммитов для --stdin)
    if (input != null) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
  });
}

async function resolveRepoRoot(dir) {
  try {
    const out = await git(dir, ['rev-parse', '--show-toplevel']);
    return path.normalize(out.trim());
  } catch (error) {
    if (error.code === 'GIT_MISSING') throw error;
    throw new GitError(`Папка не является Git-репозиторием: ${dir}`, { code: 'NOT_A_REPO' });
  }
}

async function hasHead(cwd) {
  try {
    await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Ветки, теги, сташи ---------------- */

async function readRefs(cwd) {
  // Независимые запросы — параллельно (на Windows каждый запуск git заметно дорогой)
  const [out, remoteOut, tagsOutP, stashOutP] = await Promise.all([
    git(cwd, [
    'for-each-ref',
    `--format=%(refname)${FS}%(refname:short)${FS}%(objectname)${FS}%(upstream:short)${FS}%(upstream:track)${FS}%(HEAD)${FS}%(upstream:remotename)${FS}%(upstream:remoteref)${FS}%(committerdate:iso-strict)`,
    'refs/heads',
    'refs/remotes',
    ]),
    git(cwd, ['remote']),
    git(cwd, ['for-each-ref', '--sort=-creatordate', `--format=%(refname:short)${FS}%(objectname)${FS}%(*objectname)`, 'refs/tags']),
    git(cwd, ['stash', 'list', `--format=%gd${FS}%H${FS}%gs${FS}%aI${FS}%P`]).catch(() => ''),
  ]);

  const localBranches = [];
  const remotesMap = new Map();
  let currentBranch = null;

  for (const line of out.split('\n')) {
    if (!line) continue;
    const [full, short, hash, upstream, track, head, upstreamRemote, upstreamRef, date] = line.split(FS);
    if (full.startsWith('refs/heads/')) {
      const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
      const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
      localBranches.push({
        name: short,
        hash,
        upstream: upstream || null,
        upstreamRemote: upstreamRemote || null,
        upstreamRef: upstreamRef || null, // например refs/heads/main
        gone: track.includes('gone'),
        ahead,
        behind,
        date: date || null,
      });
      if (head === '*') currentBranch = short;
    } else if (full.startsWith('refs/remotes/')) {
      const rest = full.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) continue;
      const remote = rest.slice(0, slash);
      const branch = rest.slice(slash + 1);
      if (branch === 'HEAD') continue;
      if (!remotesMap.has(remote)) remotesMap.set(remote, []);
      remotesMap.get(remote).push({ name: branch, fullName: `${remote}/${branch}`, hash, date: date || null });
    }
  }

  // В пустом репозитории веток ещё нет, но HEAD уже указывает на ветку
  if (!currentBranch) {
    try {
      currentBranch = (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null;
    } catch {
      currentBranch = null; // detached HEAD
    }
  }

  // Удалённые без веток (только что добавленные) тоже показываем
  const remoteNames = remoteOut.split('\n').filter(Boolean);
  for (const name of remoteNames) if (!remotesMap.has(name)) remotesMap.set(name, []);

  const tagsOut = tagsOutP;
  const tags = tagsOut
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, obj, peeled] = line.split(FS);
      return { name, hash: peeled || obj };
    });

  let stashes = [];
  try {
    const stashOut = stashOutP;
    stashes = stashOut
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, hash, message, date, parents] = line.split(FS);
        const [base, , untracked] = (parents || '').split(' ');
        return { id, hash, message, date, base: base || null, untracked: untracked || null };
      });
  } catch {
    /* нет сташей */
  }

  return {
    localBranches,
    remotes: [...remotesMap].map(([name, branches]) => ({ name, branches })),
    tags,
    stashes,
    currentBranch,
  };
}

/* ---------------- История коммитов ---------------- */

function parseDecorations(decor, localSet, remoteSet) {
  const refs = [];
  let isHead = false;
  if (!decor) return { refs, isHead };

  for (let part of decor.split(', ')) {
    part = part.trim();
    if (!part) continue;
    if (part === 'HEAD') {
      isHead = true;
      continue;
    }
    if (part.startsWith('HEAD -> ')) {
      isHead = true;
      refs.push({ type: 'local', name: part.slice(8), head: true });
      continue;
    }
    if (part.startsWith('tag: ')) {
      refs.push({ type: 'tag', name: part.slice(5) });
      continue;
    }
    if (part.endsWith('/HEAD')) continue;
    if (remoteSet.has(part) && !localSet.has(part)) refs.push({ type: 'remote', name: part });
    else if (localSet.has(part)) refs.push({ type: 'local', name: part });
    else if (part !== 'refs/stash') refs.push({ type: 'remote', name: part });
  }

  const order = { local: 0, remote: 1, tag: 2 };
  refs.sort((a, b) => (b.head ? 1 : 0) - (a.head ? 1 : 0) || order[a.type] - order[b.type]);
  return { refs, isHead };
}

async function readCommits(cwd, refsInfo, limit) {
  const format = ['%H', '%P', '%an', '%ae', '%aI', '%s', '%b', '%D'].join('%x1f') + '%x1e';
  let out;
  try {
    out = await git(cwd, [
      'log',
      '--branches',
      '--remotes',
      '--tags',
      'HEAD',
      // --date-order, а не --topo-order: topo выводит каждую линию истории целиком, и при частых
      // мерджах develop → master все ребра мерджей висят одновременно — граф становится «лесенкой».
      // date-order тоже гарантирует, что родители ниже детей, но перемежает ветки по времени.
      '--date-order',
      `--max-count=${limit}`,
      `--format=${format}`,
      '--decorate=full',
      '--decorate-refs-exclude=refs/stash',
    ]);
  } catch (error) {
    // Пустой репозиторий без коммитов
    if (!(await hasHead(cwd))) return [];
    throw error;
  }

  // --decorate=full даёт refs/heads/..., refs/remotes/..., tag: refs/tags/...
  const localSet = new Set(refsInfo.localBranches.map((b) => b.name));
  const remoteSet = new Set(refsInfo.remotes.flatMap((r) => r.branches.map((b) => b.fullName)));

  const commits = [];
  for (const record of out.split(RS)) {
    const rec = record.replace(/^\n/, '');
    if (!rec) continue;
    const [hash, parents, name, email, date, subject, body, decorFull] = rec.split(FS);
    if (!hash) continue;

    const decor = (decorFull || '')
      .trim()
      .split(', ')
      .filter(Boolean)
      .map((p) =>
        p
          .replace('HEAD -> refs/heads/', 'HEAD -> ')
          .replace(/^tag: refs\/tags\//, 'tag: ')
          .replace(/^refs\/heads\//, '')
          .replace(/^refs\/remotes\//, ''),
      )
      .join(', ');

    const { refs, isHead } = parseDecorations(decor, localSet, remoteSet);
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      author: { name, email },
      date,
      message: subject,
      description: (body || '').trim(),
      refs,
      isHead,
    });
  }
  return commits;
}

/* ---------------- Рабочая копия (WIP) ---------------- */

const STATUS_MAP = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'A', T: 'M', U: 'U', '?': 'A' };

// --numstat -z: "add\tdel\tpath\0" или для переименования "add\tdel\t\0old\0new\0"
function parseNumstat(text) {
  const stats = new Map();
  const nm = text.split('\0');
  for (let i = 0; i < nm.length; i++) {
    const entry = nm[i];
    if (!entry) continue;
    const [add, del, p] = entry.split('\t');
    let filePath = p;
    let oldPath = null;
    if (p === '' || p === undefined) {
      oldPath = nm[++i];
      filePath = nm[++i];
    }
    stats.set(filePath, {
      additions: add === '-' ? null : Number(add),
      deletions: del === '-' ? null : Number(del),
      oldPath,
    });
  }
  return stats;
}

async function diffNumstat(cwd, extra) {
  const args = ['diff', ...extra, '--numstat', '-z', '-M', '--no-color', '--no-ext-diff'];
  try {
    return parseNumstat(await git(cwd, [...args, '--ignore-cr-at-eol']));
  } catch (error) {
    if (/ignore-cr-at-eol|unknown option/i.test(error.details || error.message)) {
      return parseNumstat(await git(cwd, args).catch(() => ''));
    }
    return new Map();
  }
}

const MAX_COUNTED_UNTRACKED = 400;
const MAX_COUNT_BYTES = 1024 * 1024;

// Новый файл: все его строки — «добавленные». Бинарные и слишком большие — без счётчика.
async function countLines(full) {
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile() || st.size > MAX_COUNT_BYTES) return null;
    const buf = await fs.promises.readFile(full);
    if (buf.subarray(0, 8000).includes(0)) return null;
    if (buf.length === 0) return 0;
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return buf[buf.length - 1] === 10 ? n : n + 1;
  } catch {
    return null;
  }
}

/**
 * Изменения в рабочей папке и индексе.
 * stats: true — ещё и счётчики добавленных/удалённых строк (+X −Y) и переносы файлов (oldPath, moved).
 */
async function readStatus(cwd, { stats = false } = {}) {
  const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = out.split('\0');
  const files = [];

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);
    const oldPath = x === 'R' || x === 'C' ? parts[++i] : null; // следующее поле — исходный путь

    const conflicted = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (conflicted) {
      files.push({ path: filePath, status: 'U', staged: false });
      continue;
    }
    if (x === '?') {
      files.push({ path: filePath, status: 'A', staged: false, untracked: true });
      continue;
    }
    if (x !== ' ') files.push({ path: filePath, status: STATUS_MAP[x] ?? 'M', staged: true, ...(x === 'R' && oldPath ? { oldPath } : {}) });
    if (y !== ' ') files.push({ path: filePath, status: STATUS_MAP[y] ?? 'M', staged: false });
  }
  if (!stats || files.length === 0) return files;

  const [unstagedStats, stagedStats] = await Promise.all([diffNumstat(cwd, []), diffNumstat(cwd, ['--cached'])]);
  let counted = 0;
  await Promise.all(
    files.map(async (f) => {
      if (f.status === 'U') return;
      if (f.untracked) {
        const n = counted++ < MAX_COUNTED_UNTRACKED ? await countLines(path.join(cwd, f.path)) : null;
        f.additions = n;
        f.deletions = n === null ? null : 0;
        return;
      }
      const st = (f.staged ? stagedStats : unstagedStats).get(f.path);
      if (!st) {
        f.additions = null;
        f.deletions = null;
        return;
      }
      f.additions = st.additions;
      f.deletions = st.deletions;
      if (st.oldPath && !f.oldPath) {
        f.oldPath = st.oldPath;
        f.status = 'R';
      }
      if (f.oldPath) f.moved = st.additions === 0 && st.deletions === 0;
    }),
  );
  return files;
}

/* ---------------- Незавершённые операции (merge / rebase / ...) ---------------- */

async function detectOperation(cwd) {
  const out = await git(cwd, [
    'rev-parse',
    '--git-path', 'rebase-merge',
    '--git-path', 'rebase-apply',
    '--git-path', 'MERGE_HEAD',
    '--git-path', 'CHERRY_PICK_HEAD',
    '--git-path', 'REVERT_HEAD',
  ]).catch(() => '');
  const [rebaseMerge, rebaseApply, merge, cherry, revert] = out
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (path.isAbsolute(p) ? p : path.join(cwd, p)));
  if (rebaseMerge && (fs.existsSync(rebaseMerge) || fs.existsSync(rebaseApply))) return 'rebase';
  if (merge && fs.existsSync(merge)) return 'merge';
  if (cherry && fs.existsSync(cherry)) return 'cherry-pick';
  if (revert && fs.existsSync(revert)) return 'revert';
  return null;
}

/* ---------------- Быстрое обновление рабочей копии ---------------- */

// Только статус файлов — для мгновенной реакции на правки, без перечитывания истории
async function quickStatus(dir) {
  const root = await resolveRepoRoot(dir);
  const [wipFiles, operation] = await Promise.all([readStatus(root, { stats: true }), detectOperation(root)]);
  return { path: root, wipFiles, operation };
}

/* ---------------- Публичное API ---------------- */

async function loadRepository(dir, { limit = DEFAULT_LIMIT } = {}) {
  const root = await resolveRepoRoot(dir);
  const refsInfo = await readRefs(root);
  const [commits, wipFiles, headHash, operation] = await Promise.all([
    readCommits(root, refsInfo, limit),
    readStatus(root, { stats: true }),
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => s.trim()).catch(() => null),
    detectOperation(root),
  ]);

  return {
    path: root,
    name: path.basename(root),
    currentBranch: refsInfo.currentBranch,
    detached: !refsInfo.currentBranch && Boolean(headHash),
    operation, // 'rebase' | 'merge' | 'cherry-pick' | 'revert' | null
    headHash,
    localBranches: refsInfo.localBranches,
    remotes: refsInfo.remotes,
    tags: refsInfo.tags,
    stashes: refsInfo.stashes,
    commits,
    truncated: commits.length >= limit,
    wipFiles,
  };
}

async function getCommitFiles(dir, hash, parentHash) {
  if (!HASH_RE.test(hash) || (parentHash && !HASH_RE.test(parentHash))) {
    throw new Error('Некорректный хэш коммита');
  }
  const range = parentHash ? [parentHash, hash] : ['--root', hash];
  const base = ['diff-tree', '--no-commit-id', '-r', '-M', '-z', '--ignore-cr-at-eol'];

  const [numstat, nameStatus] = await Promise.all([
    git(dir, [...base, '--numstat', ...range]),
    git(dir, [...base, '--name-status', ...range]),
  ]);

  // --name-status -z: "M\0path\0" или "R100\0old\0new\0"
  const files = [];
  const ns = nameStatus.split('\0');
  for (let i = 0; i < ns.length; i++) {
    const code = ns[i];
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = ns[++i];
      const newPath = ns[++i];
      const similarity = Number(code.slice(1)) || null;
      files.push(letter === 'R' ? { path: newPath, oldPath, status: 'R', similarity } : { path: newPath, status: 'A' });
    } else {
      files.push({ path: ns[++i], status: STATUS_MAP[letter] ?? 'M' });
    }
  }

  const stats = parseNumstat(numstat);

  return files.map((f) => {
    const st = stats.get(f.path) ?? { additions: null, deletions: null };
    const res = { ...f, additions: st.additions, deletions: st.deletions };
    if (f.oldPath) res.moved = f.similarity === 100 || (st.additions === 0 && st.deletions === 0);
    return res;
  });
}

/* ---------------- Содержимое stash ---------------- */

/**
 * Файлы stash: изменения отслеживаемых файлов (stash против базового коммита)
 * и неотслеживаемые файлы (третий родитель stash, если делали --include-untracked).
 * Для каждого файла возвращаем diffHash/diffParent — по ним строится diff.
 */
async function getStashDetails(dir, hash) {
  if (!HASH_RE.test(hash || '')) throw new GitError('Некорректный stash', { code: 'BAD_ARGS' });
  const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ').slice(1);
  const [base, , untracked] = parents;
  const tracked = (await getCommitFiles(dir, hash, base)).map((f) => ({ ...f, diffHash: hash, diffParent: base }));
  let extra = [];
  if (untracked) {
    extra = (await getCommitFiles(dir, untracked, null)).map((f) => ({
      ...f,
      status: 'A',
      untracked: true,
      diffHash: untracked,
      diffParent: null,
    }));
  }
  const [subject, date, author] = (await git(dir, ['log', '-1', `--format=%s%x1f%aI%x1f%an`, hash]).catch(() => ''))
    .trim()
    .split('\x1f');
  return { hash, base, untracked: untracked ?? null, files: [...tracked, ...extra], date: date || null, author: author || null, subject };
}

/* ---------------- Diff одного файла ---------------- */

const MAX_DIFF_LINES = 20000;
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

function parseUnifiedDiff(text) {
  const hunks = [];
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;
  let binary = false;
  let total = 0;
  let truncated = false;
  let additions = 0;
  let deletions = 0;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      binary = true;
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, section: header[3] || '', lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // заголовки diff --git, index, ---, +++
    if (total >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    const kind = line[0];
    const content = line.slice(1);
    if (kind === '+') {
      hunk.lines.push({ t: '+', o: null, n: newLine++, text: content });
      additions++;
    } else if (kind === '-') {
      hunk.lines.push({ t: '-', o: oldLine++, n: null, text: content });
      deletions++;
    } else if (kind === ' ') {
      hunk.lines.push({ t: ' ', o: oldLine++, n: newLine++, text: content });
    } else if (kind === '\\') {
      hunk.lines.push({ t: '\\', o: null, n: null, text: line.slice(2) }); // \ No newline at end of file
    } else {
      continue;
    }
    total++;
  }
  return { hunks, binary, truncated, additions, deletions };
}

function safeRelative(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) throw new GitError('Некорректный путь', { code: 'BAD_ARGS' });
  const full = path.resolve(root, rel);
  const relBack = path.relative(root, full);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) throw new GitError('Путь вне репозитория', { code: 'BAD_ARGS' });
  return full;
}

/**
 * mode:
 *  - 'commit'    — изменения файла в коммите hash относительно parent (или корневой коммит);
 *  - 'unstaged'  — рабочая папка против индекса (для конфликтов — против HEAD, чтобы были видны маркеры);
 *  - 'staged'    — индекс против HEAD;
 *  - 'untracked' — новый файл целиком.
 */
async function getFileDiff(dir, { mode, hash, parent, path: filePath, oldPath, ignoreWhitespace = false, conflicted = false }) {
  const root = await resolveRepoRoot(dir);
  safeRelative(root, filePath);
  if (oldPath) safeRelative(root, oldPath);
  const ws = ignoreWhitespace ? ['--ignore-all-space'] : [];
  const paths = ['--', ...(oldPath && oldPath !== filePath ? [oldPath] : []), filePath];

  if (mode === 'untracked') {
    const full = safeRelative(root, filePath);
    const stat = fs.statSync(full);
    if (stat.size > MAX_UNTRACKED_BYTES) {
      return { path: filePath, hunks: [], binary: false, tooLarge: true, size: stat.size, additions: 0, deletions: 0 };
    }
    const buf = fs.readFileSync(full);
    if (buf.subarray(0, 8000).includes(0)) {
      return { path: filePath, hunks: [], binary: true, additions: 0, deletions: 0 };
    }
    const lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    const shown = lines.slice(0, MAX_DIFF_LINES);
    return {
      path: filePath,
      hunks: [
        {
          header: `@@ -0,0 +1,${lines.length} @@`,
          section: '',
          lines: shown.map((text, i) => ({ t: '+', o: null, n: i + 1, text })),
        },
      ],
      binary: false,
      truncated: lines.length > shown.length,
      additions: lines.length,
      deletions: 0,
    };
  }

  let args;
  if (mode === 'commit') {
    if (!HASH_RE.test(hash || '') || (parent && !HASH_RE.test(parent))) {
      throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
    }
    const range = parent ? [parent, hash] : ['--root', hash];
    args = ['diff-tree', '-p', '-M', '--no-commit-id', '--no-color', ...ws, ...range];
  } else if (mode === 'staged') {
    args = ['diff', '--cached', '-M', '--no-color', ...ws];
  } else if (mode === 'unstaged') {
    args = conflicted && (await hasHead(root)) ? ['diff', 'HEAD', '--no-color', ...ws] : ['diff', '--no-color', ...ws];
  } else {
    throw new GitError('Неизвестный режим diff', { code: 'BAD_ARGS' });
  }

  // Важно: core.autocrlf НЕ переопределяем — на Windows рабочие файлы с CRLF, а в репозитории LF,
  // и с autocrlf=false весь файл выглядел бы изменённым. Дополнительно не считаем изменением
  // разницу только в окончаниях строк (\r в конце строки).
  let out;
  try {
    out = await git(root, [...args, '--ignore-cr-at-eol', ...paths]);
  } catch (error) {
    if (!/ignore-cr-at-eol|unknown option/i.test(error.details || error.message)) throw error;
    out = await git(root, [...args, ...paths]); // очень старый Git без этого флага
  }
  const result = parseUnifiedDiff(out);

  // Пусто — но файл в списке изменённых? Значит, поменялись только окончания строк (CRLF ↔ LF)
  let eolOnly = false;
  if (!result.binary && result.hunks.length === 0) {
    const raw = await git(root, [...args, '--stat', ...paths]).catch(() => '');
    eolOnly = raw.trim().length > 0;
  }

  return { path: filePath, oldPath: oldPath || null, ...result, eolOnly };
}

/* ---------------- Стейджинг и коммит ---------------- */

function assertPaths(paths) {
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || !p)) {
    throw new Error('Некорректный список файлов');
  }
}

async function stage(dir, paths) {
  if (paths === 'all') return git(dir, ['add', '-A']);
  assertPaths(paths);
  return git(dir, ['add', '-A', '--', ...paths]);
}

async function unstage(dir, paths) {
  const head = await hasHead(dir);
  if (paths === 'all') {
    return head ? git(dir, ['reset', '-q']) : git(dir, ['rm', '-r', '-q', '--cached', '.']);
  }
  assertPaths(paths);
  return head
    ? git(dir, ['reset', '-q', '--', ...paths])
    : git(dir, ['rm', '-q', '--cached', '--', ...paths]);
}

async function commit(dir, summary, description) {
  if (!summary || !summary.trim()) throw new Error('Пустое сообщение коммита');
  const args = ['commit', '-m', summary.trim()];
  if (description && description.trim()) args.push('-m', description.trim());
  await git(dir, args);
  const hash = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const parent = (await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^']).catch(() => '')).trim() || null;
  return { hash, parent, summary: summary.trim() };
}

/**
 * Шаблон сообщения из git config commit.template (как `git commit` без -m).
 * Строки-комментарии (core.commentChar, по умолчанию «#») Git сам вырезает при коммите
 * из редактора, но с -m оставил бы — поэтому отдаём их отдельно, как подсказку.
 * → null, если шаблон не задан; { path, body, hint, error? }
 */
const TEMPLATE_MAX = 64 * 1024;

function cleanCommitTemplate(text, commentChar = '#') {
  const body = [];
  const hint = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (commentChar && line.startsWith(commentChar)) hint.push(line.slice(commentChar.length).replace(/^ /, ''));
    else body.push(line.replace(/\s+$/, ''));
  }
  const trimLines = (arr) => {
    let a = 0;
    let b = arr.length;
    while (a < b && !arr[a].trim()) a++;
    while (b > a && !arr[b - 1].trim()) b--;
    return arr.slice(a, b).join('\n');
  };
  return { body: trimLines(body), hint: trimLines(hint) };
}

async function readCommitTemplate(cwd) {
  let file = '';
  try {
    file = (await git(cwd, ['config', '--path', '--get', 'commit.template'])).trim();
  } catch {
    return null; // не задан (git config выходит с кодом 1)
  }
  if (!file) return null;
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  let raw;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > TEMPLATE_MAX) return { path: file, body: '', hint: '', error: 'Файл шаблона слишком большой (больше 64 КБ)' };
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    return { path: file, body: '', hint: '', error: `Файл шаблона не найден: ${abs}` };
  }
  let cc = '#';
  try {
    const v = (await git(cwd, ['config', '--get', 'core.commentChar'])).trim();
    if (v && v !== 'auto') cc = v[0];
  } catch {
    /* по умолчанию «#» */
  }
  return { path: file, ...cleanCommitTemplate(raw, cc) };
}

/**
 * Коммиты, которые придут при Pull (direction 'in': branch..upstream) или уйдут при Push ('out': upstream..branch).
 * → { commits: [{ hash, short, author, date, subject }], total, upstream }
 */
async function branchLog(cwd, { branch, direction = 'in', limit = 50 } = {}) {
  if (typeof branch !== 'string' || !branch || branch.startsWith('-') || /[\s~^:?*[\\]|\.\.|@\{/.test(branch)) {
    throw new GitError('Некорректное имя ветки', { code: 'BAD_ARGS' });
  }
  const local = `refs/heads/${branch}`;
  // for-each-ref по полному имени — без путаницы с одноимённым тегом (rev-parse x@{u} понимает только короткое имя)
  const upstream = (await git(cwd, ['for-each-ref', '--format=%(upstream)', local]).catch(() => '')).trim();
  if (!upstream) throw new GitError(`У ветки «${branch}» нет upstream`, { code: 'NO_UPSTREAM' });
  const range = direction === 'out' ? `${upstream}..${local}` : `${local}..${upstream}`;
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const [out, count] = await Promise.all([
    git(cwd, ['log', `--format=%H${FS}%h${FS}%an${FS}%aI${FS}%s`, `-n${n}`, range, '--']),
    git(cwd, ['rev-list', '--count', range, '--']),
  ]);
  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, date, subject] = line.split(FS);
      return { hash, short, author, date, subject };
    });
  return { commits, total: Number(count.trim()) || commits.length, upstream: upstream.replace(/^refs\/(remotes|heads)\//, '') };
}

module.exports = {
  git,
  branchLog,
  readCommitTemplate,
  cleanCommitTemplate,
  gitInfo,
  hasHead,
  detectOperation,
  readRefs,
  readStatus,
  loadRepository,
  getCommitFiles,
  getFileDiff,
  getStashDetails,
  quickStatus,
  parseUnifiedDiff,
  parseNumstat,
  stage,
  unstage,
  commit,
  resolveRepoRoot,
  safeRelative,
  HASH_RE,
};
