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
function git(cwd, args, { env, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      findGit(),
      ['-c', 'core.quotepath=false', '-c', 'color.ui=never', ...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
        timeout,
        env: env ? { ...process.env, ...env } : process.env,
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
  const out = await git(cwd, [
    'for-each-ref',
    `--format=%(refname)${FS}%(refname:short)${FS}%(objectname)${FS}%(upstream:short)${FS}%(upstream:track)${FS}%(HEAD)${FS}%(upstream:remotename)${FS}%(upstream:remoteref)`,
    'refs/heads',
    'refs/remotes',
  ]);

  const localBranches = [];
  const remotesMap = new Map();
  let currentBranch = null;

  for (const line of out.split('\n')) {
    if (!line) continue;
    const [full, short, hash, upstream, track, head, upstreamRemote, upstreamRef] = line.split(FS);
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
      remotesMap.get(remote).push({ name: branch, fullName: `${remote}/${branch}`, hash });
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
  const remoteNames = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
  for (const name of remoteNames) if (!remotesMap.has(name)) remotesMap.set(name, []);

  const tagsOut = await git(cwd, [
    'for-each-ref',
    '--sort=-creatordate',
    `--format=%(refname:short)${FS}%(objectname)${FS}%(*objectname)`,
    'refs/tags',
  ]);
  const tags = tagsOut
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, obj, peeled] = line.split(FS);
      return { name, hash: peeled || obj };
    });

  let stashes = [];
  try {
    const stashOut = await git(cwd, ['stash', 'list', `--format=%gd${FS}%H${FS}%gs`]);
    stashes = stashOut
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, hash, message] = line.split(FS);
        return { id, hash, message };
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
      '--topo-order',
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

async function readStatus(cwd) {
  const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = out.split('\0');
  const files = [];

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);
    if (x === 'R' || x === 'C') i++; // следующее поле — исходный путь

    const conflicted = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (conflicted) {
      files.push({ path: filePath, status: 'U', staged: false });
      continue;
    }
    if (x === '?') {
      files.push({ path: filePath, status: 'A', staged: false, untracked: true });
      continue;
    }
    if (x !== ' ') files.push({ path: filePath, status: STATUS_MAP[x] ?? 'M', staged: true });
    if (y !== ' ') files.push({ path: filePath, status: STATUS_MAP[y] ?? 'M', staged: false });
  }
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

/* ---------------- Публичное API ---------------- */

async function loadRepository(dir, { limit = DEFAULT_LIMIT } = {}) {
  const root = await resolveRepoRoot(dir);
  const refsInfo = await readRefs(root);
  const [commits, wipFiles, headHash, operation] = await Promise.all([
    readCommits(root, refsInfo, limit),
    readStatus(root),
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
  const base = ['diff-tree', '--no-commit-id', '-r', '-M', '-z'];

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
      files.push({ path: newPath, oldPath, status: letter === 'R' ? 'R' : 'A' });
    } else {
      files.push({ path: ns[++i], status: STATUS_MAP[letter] ?? 'M' });
    }
  }

  // --numstat -z: "add\tdel\tpath\0" или "add\tdel\t\0old\0new\0"
  const stats = new Map();
  const nm = numstat.split('\0');
  for (let i = 0; i < nm.length; i++) {
    const entry = nm[i];
    if (!entry) continue;
    const [add, del, p] = entry.split('\t');
    let filePath = p;
    if (p === '' || p === undefined) {
      i++; // old
      filePath = nm[++i]; // new
    }
    stats.set(filePath, {
      additions: add === '-' ? null : Number(add),
      deletions: del === '-' ? null : Number(del),
    });
  }

  return files.map((f) => ({ ...f, ...(stats.get(f.path) ?? { additions: null, deletions: null }) }));
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
  const base = ['-c', 'core.autocrlf=false'];
  let out;

  if (mode === 'commit') {
    if (!HASH_RE.test(hash || '') || (parent && !HASH_RE.test(parent))) {
      throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
    }
    const range = parent ? [parent, hash] : ['--root', hash];
    out = await git(root, [...base, 'diff-tree', '-p', '-M', '--no-commit-id', '--no-color', ...ws, ...range, ...paths]);
  } else if (mode === 'staged') {
    const head = await hasHead(root);
    out = head
      ? await git(root, [...base, 'diff', '--cached', '-M', '--no-color', ...ws, ...paths])
      : await git(root, [...base, 'diff', '--cached', '--no-color', ...ws, ...paths]); // в пустом репо сравнивается с пустым деревом
  } else if (mode === 'unstaged') {
    out = conflicted && (await hasHead(root))
      ? await git(root, [...base, 'diff', 'HEAD', '--no-color', ...ws, ...paths])
      : await git(root, [...base, 'diff', '--no-color', ...ws, ...paths]);
  } else if (mode === 'untracked') {
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
  } else {
    throw new GitError('Неизвестный режим diff', { code: 'BAD_ARGS' });
  }

  return { path: filePath, oldPath: oldPath || null, ...parseUnifiedDiff(out) };
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

module.exports = {
  git,
  gitInfo,
  hasHead,
  detectOperation,
  readRefs,
  readStatus,
  loadRepository,
  getCommitFiles,
  getFileDiff,
  parseUnifiedDiff,
  stage,
  unstage,
  commit,
  resolveRepoRoot,
  HASH_RE,
};
