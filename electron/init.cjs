// Инициализация Git в существующей папке: анализ папки + git init с настройками.
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

/* ---------------- Шаблоны .gitignore ---------------- */

const TEMPLATES = {
  common: {
    label: 'Общий (ОС и редакторы)',
    lines: ['# ОС', '.DS_Store', 'Thumbs.db', 'desktop.ini', '', '# Редакторы', '.idea/', '.vscode/*', '!.vscode/extensions.json', '*.swp', '', '# Логи и секреты', '*.log', '.env', '.env.*', '!.env.example'],
  },
  node: {
    label: 'Node.js',
    lines: ['# Node.js', 'node_modules/', 'dist/', 'build/', 'out/', 'release/', 'coverage/', '.cache/', '.next/', '.nuxt/', 'npm-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*'],
  },
  python: {
    label: 'Python',
    lines: ['# Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/', 'env/', '.pytest_cache/', '.mypy_cache/', '*.egg-info/', 'dist/', 'build/'],
  },
  java: {
    label: 'Java / Kotlin',
    lines: ['# Java', 'target/', 'build/', '.gradle/', '*.class', '*.jar', 'out/'],
  },
  dotnet: {
    label: '.NET / C#',
    lines: ['# .NET', 'bin/', 'obj/', '.vs/', '*.user', '*.suo', 'packages/'],
  },
  go: { label: 'Go', lines: ['# Go', 'bin/', 'vendor/', '*.exe', '*.test', '*.out'] },
  rust: { label: 'Rust', lines: ['# Rust', 'target/'] },
  unity: {
    label: 'Unity',
    lines: ['# Unity', '[Ll]ibrary/', '[Tt]emp/', '[Oo]bj/', '[Bb]uild/', '[Bb]uilds/', '[Ll]ogs/', '[Uu]ser[Ss]ettings/', '*.csproj', '*.sln'],
  },
};

const MARKERS = [
  { type: 'node', files: ['package.json'] },
  { type: 'python', files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'], ext: ['.py'] },
  { type: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { type: 'dotnet', ext: ['.csproj', '.sln', '.fsproj'] },
  { type: 'go', files: ['go.mod'] },
  { type: 'rust', files: ['Cargo.toml'] },
  { type: 'unity', dirs: ['Assets', 'ProjectSettings'] },
];

// Тяжёлые папки, которые почти никогда не нужно коммитить
const HEAVY_DIRS = ['node_modules', '.venv', 'venv', '__pycache__', 'target', 'bin', 'obj', 'dist', 'build', 'Library', '.next'];

function buildGitignore(types) {
  const keys = ['common', ...types.filter((t) => TEMPLATES[t])];
  return `${keys.map((k) => TEMPLATES[k].lines.join('\n')).join('\n\n')}\n`;
}

/* ---------------- Анализ папки ---------------- */

function scanFolder(root, limit = 50000) {
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  let truncated = false;
  const heavy = {};
  const stack = [{ dir: root, heavy: null }];
  while (stack.length) {
    const { dir, heavy: heavyRoot } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        dirs++;
        const isHeavy = !heavyRoot && dir === root && HEAVY_DIRS.includes(e.name);
        const key = heavyRoot ?? (isHeavy ? e.name : null);
        if (key && !heavy[key]) heavy[key] = 0;
        if (files + dirs < limit) stack.push({ dir: full, heavy: key });
        else truncated = true;
      } else if (e.isFile()) {
        files++;
        if (heavyRoot) heavy[heavyRoot]++;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* файл исчез — не важно */
        }
      }
    }
    if (files + dirs >= limit) {
      truncated = true;
      break;
    }
  }
  return { files, dirs, bytes, truncated, heavy };
}

function detectTypes(root) {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const types = new Set();
  for (const m of MARKERS) {
    if (m.files?.some((f) => names.includes(f))) types.add(m.type);
    if (m.ext?.some((x) => names.some((n) => n.toLowerCase().endsWith(x)))) types.add(m.type);
    if (m.dirs?.every((d) => names.includes(d))) types.add(m.type);
  }
  return [...types];
}

async function readIdentity(dir) {
  const get = (key) => git(dir, ['config', '--get', key]).then((s) => s.trim()).catch(() => '');
  const [name, email, defaultBranch] = await Promise.all([get('user.name'), get('user.email'), get('init.defaultBranch')]);
  return { name, email, defaultBranch };
}

async function inspectFolder(dir) {
  if (typeof dir !== 'string' || !dir) throw new GitError('Не указана папка', { code: 'BAD_ARGS' });
  const full = path.resolve(dir);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new GitError(`Папка не найдена: ${full}`, { code: 'NOT_FOUND_PATH' });
  }
  if (!stat.isDirectory()) throw new GitError('Это не папка', { code: 'NOT_A_DIR' });

  let repoRoot = null;
  try {
    repoRoot = path.normalize((await git(full, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    repoRoot = null;
  }
  const isRepoRoot = Boolean(repoRoot) && path.relative(repoRoot, full) === '';

  const names = fs.readdirSync(full);
  const types = detectTypes(full);
  const identity = await readIdentity(full);
  const scan = scanFolder(full);
  const hasGitignore = names.includes('.gitignore');

  return {
    path: full,
    name: path.basename(full),
    isRepoRoot,
    parentRepo: repoRoot && !isRepoRoot ? repoRoot : null,
    empty: names.filter((n) => n !== '.git').length === 0,
    types,
    typeLabels: types.map((t) => TEMPLATES[t]?.label ?? t),
    hasGitignore,
    hasReadme: names.some((n) => /^readme(\.(md|txt|rst))?$/i.test(n)),
    gitignorePreview: buildGitignore(types),
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, { label: v.label, lines: v.lines }])),
    identity,
    ...scan,
  };
}

/* ---------------- Инициализация ---------------- */

async function initRepository(dir, opts = {}) {
  const info = await inspectFolder(dir);
  if (info.isRepoRoot) throw new GitError('Эта папка уже является Git-репозиторием', { code: 'ALREADY_REPO' });
  const cwd = info.path;
  const steps = [];
  const step = async (label, fn) => {
    try {
      const result = await fn();
      steps.push({ label, ok: true });
      return result;
    } catch (error) {
      steps.push({ label, ok: false });
      error.message = `${label}: ${error.message}`;
      error.steps = steps;
      throw error;
    }
  };

  // 1. Ветка
  const branch = (opts.branch || info.identity.defaultBranch || 'main').trim();
  await git(cwd, ['check-ref-format', '--branch', branch]).catch(() => {
    throw new GitError(`Недопустимое имя ветки: «${branch}»`, { code: 'INVALID_NAME' });
  });

  // 2. Автор — нужен для коммита
  const name = opts.identity?.name?.trim();
  const email = opts.identity?.email?.trim();
  if (opts.commit && !(name || info.identity.name)) {
    throw new GitError('Укажите имя автора для первого коммита', { code: 'NO_IDENTITY' });
  }
  if (opts.commit && !(email || info.identity.email)) {
    throw new GitError('Укажите email автора для первого коммита', { code: 'NO_IDENTITY' });
  }
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new GitError(`Некорректный email: «${email}»`, { code: 'BAD_EMAIL' });
  }
  const remote = opts.remote?.trim();
  if (remote && /\s/.test(remote)) throw new GitError('Адрес remote не должен содержать пробелов', { code: 'BAD_REMOTE' });

  await step('git init', async () => {
    try {
      await git(cwd, ['init', '-b', branch]);
    } catch {
      // Git старше 2.28 не знает -b
      await git(cwd, ['init']);
      await git(cwd, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    }
  });

  if (name || email) {
    const scope = opts.identity?.global ? ['--global'] : [];
    await step(opts.identity?.global ? 'Имя и email (для всех репозиториев)' : 'Имя и email (для этого репозитория)', async () => {
      if (name) await git(cwd, ['config', ...scope, 'user.name', name]);
      if (email) await git(cwd, ['config', ...scope, 'user.email', email]);
    });
  }

  if (opts.gitignore && !info.hasGitignore) {
    await step('.gitignore', () => fs.writeFileSync(path.join(cwd, '.gitignore'), String(opts.gitignore), 'utf8'));
  }

  if (opts.readme && !info.hasReadme) {
    await step('README.md', () => fs.writeFileSync(path.join(cwd, 'README.md'), `# ${info.name}\n`, 'utf8'));
  }

  let commit = null;
  if (opts.commit) {
    commit = await step('Первый коммит', async () => {
      await git(cwd, ['add', '-A']);
      const staged = (await git(cwd, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
      if (staged.length === 0) return { files: 0, hash: null };
      await git(cwd, ['commit', '-q', '-m', (opts.commit.message || 'Initial commit').trim()]);
      const hash = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
      return { files: staged.length, hash };
    });
  }

  if (remote) {
    await step(`Remote origin → ${remote}`, () => git(cwd, ['remote', 'add', 'origin', remote]));
  }

  return { path: cwd, name: info.name, branch, commit, remote: remote || null, steps };
}

module.exports = { inspectFolder, initRepository, buildGitignore, TEMPLATES };

/* =====================================================================
 * Подключение папки к уже созданному удалённому репозиторию (GitLab/GitHub)
 * ===================================================================== */

const os = require('node:os');
const crypto = require('node:crypto');

function lazyActions() {
  // actions.cjs подключаем лениво, чтобы не было циклической зависимости при загрузке
  return require('./actions.cjs');
}

function validateUrl(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) throw new GitError('Укажите адрес репозитория', { code: 'BAD_REMOTE' });
  if (/\s/.test(u)) throw new GitError('Адрес не должен содержать пробелов', { code: 'BAD_REMOTE' });
  const ok = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|git@[^:]+:|[\w.-]+@[\w.-]+:)/i.test(u);
  if (!ok) {
    throw new GitError('Не похоже на адрес Git-репозитория', {
      code: 'BAD_REMOTE',
      hint: 'Пример: https://gitlab.com/user/project.git или git@gitlab.com:user/project.git',
    });
  }
  return u;
}

function hostHint(url) {
  if (/gitlab/i.test(url)) {
    return 'GitLab по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token (scope: read_repository и write_repository) вместо пароля. По SSH: добавьте публичный ключ в GitLab → Preferences → SSH Keys.';
  }
  if (/github/i.test(url)) {
    return 'GitHub по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token. По SSH: добавьте ключ в Settings → SSH and GPG keys.';
  }
  return null;
}

async function remoteHeads(url, cwd) {
  const opts = await lazyActions().networkOptions(cwd, { url });
  let out;
  try {
    out = await git(cwd, ['ls-remote', '--symref', url], opts);
  } catch (error) {
    if (['AUTH', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code) && hostHint(url)) error.hint = hostHint(url);
    throw error;
  }
  let head = null;
  const branches = [];
  for (const line of out.split('\n')) {
    const sym = /^ref: refs\/heads\/(\S+)\s+HEAD$/.exec(line);
    if (sym) head = sym[1];
    const ref = /^([0-9a-f]{40,64})\s+refs\/heads\/(.+)$/.exec(line);
    if (ref) branches.push({ name: ref[2], hash: ref[1] });
  }
  const defaultBranch =
    (head && branches.some((b) => b.name === head) && head) ||
    ['main', 'master', 'develop'].find((n) => branches.some((b) => b.name === n)) ||
    branches[0]?.name ||
    null;
  return { empty: branches.length === 0, branches, defaultBranch, headBranch: head };
}

// SHA-1 git-блоба, как у `git hash-object`
function blobSha1(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function sameAsRemote(localPath, remoteSha) {
  try {
    const buf = fs.readFileSync(localPath);
    if (blobSha1(buf) === remoteSha) return true;
    // На Windows файлы часто с CRLF, а в репозитории LF — считаем такие одинаковыми
    const lf = Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');
    return blobSha1(lf) === remoteSha;
  } catch {
    return false;
  }
}

/**
 * Проверка удалённого репозитория без изменений в папке проекта:
 * доступ, пустой ли он, ветки, последний коммит и сравнение файлов с локальными.
 */
async function probeRemote(dir, { url, branch } = {}) {
  const info = await inspectFolder(dir);
  const remoteUrl = validateUrl(url);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-probe-'));
  try {
    const heads = await remoteHeads(remoteUrl, tmp);
    const result = {
      url: remoteUrl,
      host: /gitlab/i.test(remoteUrl) ? 'GitLab' : /github/i.test(remoteUrl) ? 'GitHub' : /bitbucket/i.test(remoteUrl) ? 'Bitbucket' : null,
      ...heads,
      branch: null,
      lastCommit: null,
      remoteFiles: 0,
      same: [],
      differ: [],
      remoteOnly: [],
      remoteHasGitignore: false,
    };
    if (heads.empty) return result;

    const target = branch && heads.branches.some((b) => b.name === branch) ? branch : heads.defaultBranch;
    result.branch = target;

    // Неглубокая загрузка одной ветки во временный репозиторий — только чтобы увидеть файлы
    await git(tmp, ['init', '-q', '--bare']);
    const opts = await lazyActions().networkOptions(tmp, { url: remoteUrl });
    await git(tmp, ['fetch', '-q', '--depth', '1', remoteUrl, `refs/heads/${target}:refs/heads/probe`], opts);
    const [subject, author, date, hash] = (await git(tmp, ['log', '-1', '--format=%s%x1f%an%x1f%aI%x1f%H', 'refs/heads/probe']))
      .trim()
      .split('\x1f');
    result.lastCommit = { message: subject, author, date, hash };

    const tree = await git(tmp, ['ls-tree', '-r', '-z', 'refs/heads/probe']);
    for (const entry of tree.split('\0')) {
      if (!entry) continue;
      const tab = entry.indexOf('\t');
      const [, type, sha] = entry.slice(0, tab).split(' ');
      const filePath = entry.slice(tab + 1);
      if (type !== 'blob') continue;
      result.remoteFiles++;
      if (filePath === '.gitignore') result.remoteHasGitignore = true;
      const local = path.join(info.path, ...filePath.split('/'));
      if (!fs.existsSync(local)) result.remoteOnly.push(filePath);
      else if (sameAsRemote(local, sha)) result.same.push(filePath);
      else result.differ.push(filePath);
    }
    return result;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Подключение: git init → remote → (fetch и наложение истории сервера) → .gitignore → коммит → push.
 * Локальные файлы не теряются: при различиях остаётся локальная версия, файлы только с сервера добавляются.
 */
async function connectRepository(dir, opts = {}) {
  const info = await inspectFolder(dir);
  if (info.isRepoRoot) throw new GitError('В этой папке уже есть Git-репозиторий', { code: 'ALREADY_REPO' });
  const url = validateUrl(opts.url);
  const cwd = info.path;

  const name = opts.identity?.name?.trim();
  const email = opts.identity?.email?.trim();
  if (opts.commit && !(name || info.identity.name)) throw new GitError('Укажите имя автора для коммита', { code: 'NO_IDENTITY' });
  if (opts.commit && !(email || info.identity.email)) throw new GitError('Укажите email автора для коммита', { code: 'NO_IDENTITY' });
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new GitError(`Некорректный email: «${email}»`, { code: 'BAD_EMAIL' });

  const heads = await remoteHeads(url, cwd);
  const branch = (heads.empty ? opts.branch || info.identity.defaultBranch || 'main' : opts.branch || heads.defaultBranch).trim();
  if (!heads.empty && !heads.branches.some((b) => b.name === branch)) {
    throw new GitError(`На сервере нет ветки «${branch}»`, { code: 'NOT_FOUND_REF' });
  }
  await git(cwd, ['check-ref-format', '--branch', branch]).catch(() => {
    throw new GitError(`Недопустимое имя ветки: «${branch}»`, { code: 'INVALID_NAME' });
  });

  const steps = [];
  const step = async (label, fn) => {
    try {
      const r = await fn();
      steps.push({ label, ok: true });
      return r;
    } catch (error) {
      steps.push({ label, ok: false });
      error.message = `${label}: ${error.message}`;
      throw error;
    }
  };
  const netOpts = await lazyActions().networkOptions(cwd, { url });

  await step('git init', async () => {
    try {
      await git(cwd, ['init', '-b', branch]);
    } catch {
      await git(cwd, ['init']);
      await git(cwd, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    }
  });

  if (name || email) {
    const scope = opts.identity?.global ? ['--global'] : [];
    await step('Имя и email автора', async () => {
      if (name) await git(cwd, ['config', ...scope, 'user.name', name]);
      if (email) await git(cwd, ['config', ...scope, 'user.email', email]);
    });
  }

  await step('remote origin', () => git(cwd, ['remote', 'add', 'origin', url]));

  let restored = 0;
  let remoteHasGitignore = false;
  if (!heads.empty) {
    await step(`Загрузка ${branch} с сервера`, () => git(cwd, ['fetch', 'origin', branch], netOpts));
    await step('Наложение истории сервера', async () => {
      // Ветка указывает на коммит сервера, рабочие файлы остаются как есть
      await git(cwd, ['reset', '-q', '--mixed', `origin/${branch}`]);
      await git(cwd, ['branch', `--set-upstream-to=origin/${branch}`, branch]);
      // Файлы, которые есть только на сервере, возвращаем в папку
      const deleted = (await git(cwd, ['ls-files', '--deleted', '-z'])).split('\0').filter(Boolean);
      for (let i = 0; i < deleted.length; i += 100) {
        await git(cwd, ['checkout', '--', ...deleted.slice(i, i + 100)]);
      }
      restored = deleted.length;
    });
    remoteHasGitignore = fs.existsSync(path.join(cwd, '.gitignore')) && !info.hasGitignore;
  }

  if (opts.gitignore && !info.hasGitignore && !remoteHasGitignore) {
    await step('.gitignore', () => fs.writeFileSync(path.join(cwd, '.gitignore'), String(opts.gitignore), 'utf8'));
  }

  let commit = null;
  if (opts.commit) {
    commit = await step('Коммит файлов проекта', async () => {
      await git(cwd, ['add', '-A']);
      const staged = (await git(cwd, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
      if (staged.length === 0) return { files: 0, hash: null };
      await git(cwd, ['commit', '-q', '-m', (opts.commit.message || 'Add project files').trim()]);
      return { files: staged.length, hash: (await git(cwd, ['rev-parse', 'HEAD'])).trim() };
    });
  }

  // Push: ошибку не считаем провалом всей операции — репозиторий уже подключён
  let pushed = false;
  let pushError = null;
  if (opts.push && (commit?.hash || heads.empty === false)) {
    const hasCommits = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true).catch(() => false);
    const ahead = heads.empty
      ? hasCommits
      : Number((await git(cwd, ['rev-list', '--count', `origin/${branch}..HEAD`]).catch(() => '0')).trim()) > 0;
    if (ahead) {
      try {
        await git(cwd, ['push', '--porcelain', '--set-upstream', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], netOpts);
        pushed = true;
        steps.push({ label: `push → origin/${branch}`, ok: true });
      } catch (error) {
        if (error.code === 'PROTECTED' && /gitlab/i.test(url)) {
          error.hint =
            'В GitLab основная ветка защищена: пушить в неё могут только Maintainer. Попросите роль Maintainer, снимите защиту (Settings → Repository → Protected branches) или отправьте изменения в отдельную ветку.';
        }
        pushError = error.toJSON ? error.toJSON() : { code: 'UNKNOWN', message: String(error) };
        steps.push({ label: `push → origin/${branch}`, ok: false });
      }
    }
  }

  return {
    path: cwd,
    name: info.name,
    branch,
    url,
    remoteWasEmpty: heads.empty,
    restored,
    commit,
    pushed,
    pushError,
    steps,
  };
}

module.exports.probeRemote = probeRemote;
module.exports.remoteHeads = remoteHeads;
module.exports.validateUrl = validateUrl;
module.exports.hostHint = hostHint;
module.exports.connectRepository = connectRepository;
