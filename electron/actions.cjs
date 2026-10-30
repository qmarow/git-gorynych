// Операции, меняющие репозиторий или работающие с сетью, + история Undo/Redo.
const {
  git,
  hasHead,
  readRefs,
  readStatus,
  detectOperation,
  commit: gitCommit,
  stage,
  unstage,
  HASH_RE,
} = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const conflicts = require('./conflicts.cjs');
const rebase = require('./rebase.cjs');
const restore = require('./restore.cjs');

const NETWORK_TIMEOUT = 5 * 60 * 1000; // запас на окно входа Git Credential Manager

/* =================== Сетевое окружение =================== */

/**
 * GIT_TERMINAL_PROMPT=0 — git не ждёт ввода логина в невидимой консоли (иначе процесс висит).
 * Окно входа Git Credential Manager при этом продолжает работать.
 * Для SSH включаем BatchMode, если пользователь не настроил ssh сам: без него ssh
 * может ждать подтверждения ключа хоста или пароля ключа, которые некуда ввести.
 * Учётные данные, введённые в окне «Авторизация репозитория», подставляются здесь же (credentials.cjs) — по адресу репозитория:
 * для HTTPS — свой credential helper для хоста, для SSH — GIT_SSH_COMMAND с выбранным ключом.
 * url — адрес, с которым будет работать git (клонирование, проверка адреса); без него берутся адреса remote репозитория.
 */
async function networkOptions(cwd, { url } = {}) {
  const env = { GIT_TERMINAL_PROMPT: '0' };
  if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH) {
    const configured = await git(cwd, ['config', '--get', 'core.sshCommand']).catch(() => '');
    if (!configured.trim()) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  }
  try {
    const urls = url ? [url] : await remoteUrls(cwd);
    Object.assign(env, require('./credentials.cjs').envFor(urls));
  } catch {
    /* хранилище недоступно — работаем как раньше, через системные средства входа */
  }
  return { env, timeout: NETWORK_TIMEOUT };
}

/** Адреса remote: сначала того, за которым следит текущая ветка, потом origin, потом остальные */
async function remoteUrls(cwd) {
  const out = await git(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$']).catch(() => '');
  const list = out
    .split('\n')
    .map((line) => /^remote\.(.+)\.url (.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => ({ name: m[1], url: m[2] }));
  if (!list.length) return [];
  const upstream = (await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim();
  const first = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : 'origin';
  list.sort((a, b) => (a.name === first ? -1 : b.name === first ? 1 : a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : 0));
  return list.map((r) => r.url);
}

const net = async (cwd, args) => git(cwd, args, await networkOptions(cwd));

/* =================== Текущее состояние =================== */

async function currentState(cwd) {
  const refs = await readRefs(cwd);
  const branch = refs.localBranches.find((b) => b.name === refs.currentBranch) ?? null;
  const remotes = refs.remotes.map((r) => r.name);
  const headHash = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || null;
  const operation = await detectOperation(cwd);
  return { refs, branchName: refs.currentBranch, branch, remotes, headHash, operation };
}

const OPERATION_NAMES = { rebase: 'rebase', merge: 'merge', 'cherry-pick': 'cherry-pick', revert: 'revert' };

function requireNoOperation(state, action) {
  if (state.operation) {
    throw new GitError(`Нельзя сделать ${action}: не завершён ${OPERATION_NAMES[state.operation]}`, {
      code: 'OPERATION_IN_PROGRESS',
      hint: 'Разрешите конфликты и нажмите «Продолжить» в жёлтой панели сверху, либо «Прервать».',
    });
  }
}

function pickRemote(state) {
  if (state.branch?.upstreamRemote && state.remotes.includes(state.branch.upstreamRemote)) {
    return state.branch.upstreamRemote;
  }
  if (state.remotes.includes('origin')) return 'origin';
  return state.remotes[0] ?? null;
}

function requireBranch(state, action) {
  requireNoOperation(state, action);
  if (!state.headHash) {
    throw new GitError(`Нельзя сделать ${action}: в репозитории ещё нет коммитов`, { code: 'NO_COMMITS' });
  }
  if (!state.branchName) {
    throw new GitError(`Нельзя сделать ${action} из состояния detached HEAD`, {
      code: 'DETACHED',
      hint: 'Переключитесь на ветку (двойной клик по ветке в списке слева) или создайте новую.',
    });
  }
}

/* =================== Проверка доступа =================== */

function describeUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      return { protocol: 'https', host: u.host, url: `${u.protocol}//${u.host}${u.pathname}` }; // без логина/токена
    } catch {
      return { protocol: 'https', host: null, url };
    }
  }
  if (/^ssh:\/\//i.test(url)) {
    const host = /^ssh:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(url)?.[1] ?? null;
    return { protocol: 'ssh', host, url };
  }
  // scp-синтаксис: user@host:path (но не C:\path)
  const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(?!\/\/)/.exec(url);
  if (scp && scp[1].length > 1) return { protocol: 'ssh', host: scp[1], url };
  return { protocol: 'local', host: null, url };
}

/**
 * Проверяет доступ к remote для текущей ветки:
 *  - чтение: git ls-remote (требует авторизации для приватных репозиториев);
 *  - запись: git push --dry-run (сервер проверяет права на push, ничего не меняя).
 * Правила защиты веток сервер применяет только при настоящем push, поэтому они
 * распознаются по ответу на push (код PROTECTED).
 */
async function checkAccess(cwd, { write = true } = {}) {
  const state = await currentState(cwd);
  const remote = pickRemote(state);
  if (!remote) {
    throw new GitError('У репозитория нет remote', {
      code: 'NO_REMOTE',
      hint: 'Добавьте remote: git remote add origin <url>',
    });
  }

  const rawUrl = (await git(cwd, ['remote', 'get-url', remote])).trim();
  const targetRef = state.branch?.upstreamRef || (state.branchName ? `refs/heads/${state.branchName}` : null);

  const result = {
    remote,
    ...describeUrl(rawUrl),
    branch: state.branchName,
    targetRef,
    hasUpstream: Boolean(state.branch?.upstream),
    canRead: false,
    canWrite: null, // null — не проверялось
    branchExists: null,
    diverged: false,
    error: null,
    writeError: null,
    checkedAt: new Date().toISOString(),
  };

  try {
    const out = await net(cwd, ['ls-remote', '--heads', remote]);
    result.canRead = true;
    if (targetRef) result.branchExists = out.split('\n').some((line) => line.split('\t')[1] === targetRef);
  } catch (error) {
    result.error = error.toJSON ? error.toJSON() : { code: 'UNKNOWN', message: String(error) };
    return result;
  }

  if (write && state.branchName && state.headHash) {
    try {
      await net(cwd, ['push', '--dry-run', '--porcelain', remote, `refs/heads/${state.branchName}:${targetRef}`]);
      result.canWrite = true;
    } catch (error) {
      if (error.code === 'REJECTED_NON_FF' || /^!\t/m.test(error.stdout || '')) {
        // Сервер ответил и пустил нас — права на запись есть, но remote ушёл вперёд
        result.canWrite = true;
        result.diverged = true;
      } else if (['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'PROTECTED', 'HOOK_DECLINED'].includes(error.code)) {
        result.canWrite = false;
        result.writeError = error.toJSON();
      } else {
        result.writeError = error.toJSON ? error.toJSON() : { code: 'UNKNOWN', message: String(error) };
      }
    }
  }
  return result;
}

function accessError(access, action) {
  if (!access.canRead) {
    const e = access.error ?? {};
    return new GitError(e.message ?? `Нет доступа к ${access.remote}`, {
      code: e.code ?? 'AUTH',
      hint: e.hint,
      details: e.details,
    });
  }
  if (action === 'push' && access.canWrite === false) {
    const e = access.writeError ?? {};
    return new GitError(e.message ?? 'Нет прав на запись', {
      code: e.code ?? 'FORBIDDEN',
      hint: e.hint,
      details: e.details,
    });
  }
  return null;
}

/* =================== Fetch / Pull / Push =================== */

async function fetchAll(cwd) {
  const state = await currentState(cwd);
  if (state.remotes.length === 0) throw new GitError('У репозитория нет remote', { code: 'NO_REMOTE' });
  await net(cwd, ['fetch', '--all', '--prune', '--tags']);
  return { remotes: state.remotes };
}

const PULL_MODES = {
  merge: ['pull', '--no-rebase'], // fast-forward if possible
  'ff-only': ['pull', '--ff-only'],
  rebase: ['pull', '--rebase', '--autostash'],
};

async function pull(cwd, { mode = 'merge' } = {}) {
  if (!PULL_MODES[mode]) throw new GitError('Неизвестный режим pull', { code: 'BAD_ARGS' });
  const state = await currentState(cwd);
  requireBranch(state, 'pull');
  if (!state.branch?.upstream) {
    throw new GitError(`У ветки «${state.branchName}» нет upstream`, {
      code: 'NO_UPSTREAM',
      hint: 'Сделайте Push — ветка будет опубликована и связана с remote.',
    });
  }
  if (state.branch.gone) {
    throw new GitError(`Remote-ветка ${state.branch.upstream} удалена`, {
      code: 'UPSTREAM_GONE',
      hint: 'Сделайте Push, чтобы создать её заново, или переключитесь на другую ветку.',
    });
  }

  const access = await checkAccess(cwd, { write: false });
  const denied = accessError(access, 'pull');
  if (denied) throw denied;

  const before = state.headHash;
  await net(cwd, PULL_MODES[mode]);
  const after = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  return { branch: state.branchName, upstream: state.branch.upstream, updated: before !== after, mode };
}

async function push(cwd, { force = false } = {}) {
  const state = await currentState(cwd);
  requireBranch(state, 'push');

  const access = await checkAccess(cwd, { write: true });
  const denied = accessError(access, 'push');
  if (denied) throw denied;
  if (access.diverged && !force) {
    throw new GitError(`На ${access.remote} есть коммиты, которых нет в вашей ветке`, {
      code: 'REJECTED_NON_FF',
      hint: 'Сделайте Pull и повторите Push, либо Force Push (with lease), чтобы перезаписать remote-ветку.',
    });
  }

  const setUpstream = !state.branch?.upstream || state.branch.gone;
  const args = ['push', '--porcelain'];
  if (setUpstream) args.push('--set-upstream');
  if (force) args.push('--force-with-lease');
  args.push(access.remote, `refs/heads/${state.branchName}:${access.targetRef}`);

  await net(cwd, args);
  return { branch: state.branchName, remote: access.remote, setUpstream, forced: force };
}

/* =================== Ветки и checkout =================== */

async function validateBranchName(cwd, name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new GitError('Введите имя ветки', { code: 'INVALID_NAME' });
  }
  try {
    await git(cwd, ['check-ref-format', '--branch', name.trim()]);
  } catch {
    throw new GitError(`Недопустимое имя ветки: «${name}»`, {
      code: 'INVALID_NAME',
      hint: 'Нельзя использовать пробелы, «..», «~», «^», «:», «?», «*», «[» и «\\».',
    });
  }
  const exists = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name.trim()}`])
    .then(() => true)
    .catch(() => false);
  if (exists) throw new GitError(`Ветка «${name}» уже существует`, { code: 'BRANCH_EXISTS' });
  return name.trim();
}

// position: { branch } или { detached: hash }
async function switchTo(cwd, position) {
  if (position.branch) await git(cwd, ['switch', position.branch]);
  else await git(cwd, ['switch', '--detach', position.detached]);
}

async function currentPosition(cwd) {
  const state = await currentState(cwd);
  return state.branchName ? { branch: state.branchName } : { detached: state.headHash };
}

async function checkout(cwd, { branch, remoteBranch }) {
  requireNoOperation(await currentState(cwd), 'checkout');
  const previous = await currentPosition(cwd);

  if (branch) {
    if (previous.branch === branch) return { previous, to: { branch }, created: null };
    await git(cwd, ['switch', branch]);
    return { previous, to: { branch }, created: null };
  }

  // Remote-ветка: переключаемся на локальную с тем же именем или создаём отслеживающую
  if (!remoteBranch?.fullName || !remoteBranch?.name) throw new GitError('Не указана ветка', { code: 'BAD_ARGS' });
  const local = remoteBranch.name;
  const exists = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${local}`])
    .then(() => true)
    .catch(() => false);
  if (exists) {
    if (previous.branch !== local) await git(cwd, ['switch', local]);
    return { previous, to: { branch: local }, created: null };
  }
  await git(cwd, ['switch', '--create', local, '--track', remoteBranch.fullName]);
  const hash = (await git(cwd, ['rev-parse', local])).trim();
  return { previous, to: { branch: local }, created: { name: local, hash, track: remoteBranch.fullName } };
}

async function createBranch(cwd, { name, start, checkout: doCheckout = true }) {
  if (!(await hasHead(cwd))) throw new GitError('Сначала сделайте первый коммит', { code: 'NO_COMMITS' });
  if (doCheckout) requireNoOperation(await currentState(cwd), 'checkout');
  const branchName = await validateBranchName(cwd, name);
  // Начало ветки: хэш или любая ссылка (main, origin/main, тег) — проверяем, что она существует
  let startPoint = 'HEAD';
  if (start) {
    if (typeof start !== 'string' || start.startsWith('-')) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
    startPoint = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${start}^{commit}`]).catch(() => '')).trim();
    if (!startPoint) throw new GitError(`Не найдено: ${start}`, { code: 'NOT_FOUND_REF', hint: 'Проверьте имя ветки или сделайте Fetch.' });
  }
  const previous = await currentPosition(cwd);

  if (doCheckout) await git(cwd, ['switch', '--create', branchName, startPoint]);
  else await git(cwd, ['branch', branchName, startPoint]);

  const hash = (await git(cwd, ['rev-parse', branchName])).trim();
  return { name: branchName, hash, checkedOut: doCheckout, previous };
}

/* =================== Умное переключение веток (Workspace Context) =================== */

// Незакоммиченные изменения прячутся в stash с именем ветки и сами возвращаются, когда вы снова на неё переключитесь
const AUTO_STASH = 'gorynych-auto: '; // прежние «gitidea-auto:» тоже распознаются

async function autoStashes(cwd) {
  const out = await git(cwd, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs']).catch(() => '');
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, hash, subject] = line.split('\x1f');
      const m = /(?:gorynych|gitidea)-auto: (.+)$/.exec(subject ?? '');
      return m ? { id, hash, branch: m[1].trim() } : null;
    })
    .filter(Boolean);
}

/**
 * «Отпечаток» stash: базовый коммит + содержимое рабочей папки, индекса и неотслеживаемых файлов.
 * Одинаковый отпечаток — тот же самый набор правок, хранить его дважды незачем.
 */
async function stashSignature(cwd, ref) {
  const main = (await git(cwd, ['rev-parse', `${ref}^1`, `${ref}^{tree}`, `${ref}^2^{tree}`]).catch(() => '')).trim();
  if (!main) return null;
  const untracked = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^3^{tree}`]).catch(() => '')).trim();
  return `${main.replace(/\s+/g, ' ')} ${untracked}`;
}

/**
 * Только что созданный stash@{0} уже лежит в списке (тот же отпечаток) — убираем СТАРЫЕ копии, новый остаётся сверху.
 * onlyAutoFor — для авто-stash сравниваем только с авто-stash той же ветки, ручные не трогаем.
 * → сколько копий убрано
 */
async function dropOlderDuplicates(cwd, { onlyAutoFor = null } = {}) {
  const out = await git(cwd, ['stash', 'list', '--format=%gd%x1f%gs']).catch(() => '');
  const list = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, subject] = l.split('\x1f');
      return { id, subject: subject ?? '' };
    });
  if (list.length < 2) return 0;
  const top = await stashSignature(cwd, 'stash@{0}');
  if (!top) return 0;
  const dupes = [];
  for (const st of list.slice(1, 30)) {
    if (onlyAutoFor && /(?:gorynych|gitidea)-auto: (.+)$/.exec(st.subject)?.[1]?.trim() !== onlyAutoFor) continue;
    if ((await stashSignature(cwd, st.id)) === top) dupes.push(st.id);
  }
  // С конца, чтобы номера stash@{N} не съезжали
  for (const id of dupes.reverse()) await git(cwd, ['stash', 'drop', '-q', id]);
  return dupes.length;
}

async function popStash(cwd, id) {
  try {
    await git(cwd, ['stash', 'pop', '--index', id]); // вместе с тем, что было застейджено
  } catch (error) {
    if (!/index/i.test(`${error.details}`)) throw error;
    await git(cwd, ['stash', 'pop', id]); // индекс восстановить нельзя — хотя бы файлы
  }
}

async function smartCheckout(cwd, target) {
  const state = await currentState(cwd);
  requireNoOperation(state, 'checkout');
  const from = state.branchName;
  const targetName = target.branch ?? target.remoteBranch?.name;
  if (from && from === targetName) return { ...(await checkout(cwd, target)), autoStash: null, restored: null };

  // 1. Прячем изменения текущей ветки под её именем
  let autoStash = null;
  const files = await readStatus(cwd);
  if (files.length && from && state.headHash) {
    if (files.some((f) => f.status === 'U')) {
      throw new GitError('В рабочей папке есть неразрешённые конфликты', { code: 'CONFLICT', hint: 'Сначала решите их, затем переключайтесь.' });
    }
    await git(cwd, ['stash', 'push', '--include-untracked', '-m', `${AUTO_STASH}${from}`]);
    // Те же правки уже были спрятаны для этой ветки (например, после неудачного возврата) — не плодим копии
    await dropOlderDuplicates(cwd, { onlyAutoFor: from }).catch(() => 0);
    const hash = (await git(cwd, ['rev-parse', 'stash@{0}'])).trim();
    autoStash = { branch: from, hash, files: new Set(files.map((f) => f.path)).size };
  }

  // 2. Переключаемся; не вышло — возвращаем спрятанное на место
  let res;
  try {
    res = await checkout(cwd, target);
  } catch (error) {
    if (autoStash) {
      const top = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'stash@{0}']).catch(() => '')).trim();
      if (top === autoStash.hash) await popStash(cwd, 'stash@{0}').catch(() => {});
    }
    throw error;
  }

  // 3. Если для новой ветки что-то было спрятано — достаём (самое свежее)
  let restored = null;
  const waiting = (await autoStashes(cwd)).filter((s) => s.branch === res.to.branch && s.hash !== autoStash?.hash);
  if (waiting.length) {
    const s = waiting[0];
    try {
      await popStash(cwd, s.id);
      restored = { branch: s.branch, hash: s.hash, conflict: false, more: waiting.length - 1 };
    } catch (error) {
      restored = {
        branch: s.branch,
        hash: s.hash,
        conflict: true,
        more: waiting.length - 1,
        message: error.code === 'CONFLICT' ? 'Изменения вернулись с конфликтами — stash сохранён' : error.message,
      };
    }
  }
  return { ...res, autoStash, restored };
}

/* =================== Своя git-команда (из конструктора действий) =================== */

// Аргументы разбираются без shell: кавычки группируют, спецсимволы оболочки ничего не делают
function splitArgs(line) {
  const args = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of String(line)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) args.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quote) throw new GitError('Незакрытая кавычка в команде', { code: 'BAD_ARGS' });
  if (cur || has) args.push(cur);
  return args;
}

async function gitRaw(cwd, { command }) {
  const args = splitArgs(String(command ?? '').replace(/^\s*git\s+/, ''));
  if (!args.length) throw new GitError('Пустая команда', { code: 'BAD_ARGS' });
  const out = await git(cwd, args, NO_EDITOR);
  return { command: `git ${args.join(' ')}`, output: out.trim().slice(0, 4000) };
}

/* =================== Stash =================== */

async function stashPush(cwd, { message } = {}) {
  const files = await readStatus(cwd);
  if (files.length === 0) throw new GitError('Нет изменений для stash', { code: 'NOTHING_TO_STASH' });
  if (!(await hasHead(cwd))) throw new GitError('Stash недоступен до первого коммита', { code: 'NO_COMMITS' });
  const args = ['stash', 'push', '--include-untracked'];
  if (message && message.trim()) args.push('-m', message.trim());
  await git(cwd, args);
  // Повторный Stash тех же правок (например, после Pop без изменений) — старая копия не нужна
  const duplicates = await dropOlderDuplicates(cwd).catch(() => 0);
  const hash = (await git(cwd, ['rev-parse', 'stash@{0}'])).trim();
  return { hash, files: files.length, duplicates };
}

async function stashPop(cwd) {
  const top = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'stash@{0}']).catch(() => '')).trim();
  if (!top) throw new GitError('Нет сташей', { code: 'NO_STASH' });
  await git(cwd, ['stash', 'pop']); // при конфликте stash остаётся в списке, ошибка = CONFLICT
  return { hash: top };
}

/* =================== Операции над коммитом (контекстное меню) =================== */

function requireHash(hash) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  return hash;
}

async function isAncestor(cwd, a, b) {
  return git(cwd, ['merge-base', '--is-ancestor', a, b])
    .then(() => true)
    .catch(() => false);
}

async function parentsOf(cwd, hash) {
  const out = await git(cwd, ['rev-list', '--parents', '-n', '1', hash]);
  return out.trim().split(' ').slice(1);
}

async function checkoutCommit(cwd, { hash }) {
  requireHash(hash);
  requireNoOperation(await currentState(cwd), 'checkout');
  const previous = await currentPosition(cwd);
  await git(cwd, ['switch', '--detach', hash]);
  return { previous, to: { detached: hash }, created: null };
}

async function createTag(cwd, { name, hash, message }) {
  requireHash(hash);
  if (typeof name !== 'string' || !name.trim()) throw new GitError('Введите имя тега', { code: 'INVALID_NAME' });
  const tag = name.trim();
  try {
    await git(cwd, ['check-ref-format', `refs/tags/${tag}`]);
  } catch {
    throw new GitError(`Недопустимое имя тега: «${tag}»`, { code: 'INVALID_NAME' });
  }
  const exists = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`])
    .then(() => true)
    .catch(() => false);
  if (exists) throw new GitError(`Тег «${tag}» уже существует`, { code: 'TAG_EXISTS' });

  if (message && message.trim()) await git(cwd, ['tag', '-a', tag, hash, '-m', message.trim()]);
  else await git(cwd, ['tag', tag, hash]);
  return { name: tag, hash, message: message?.trim() || null };
}

async function deleteTag(cwd, { name }) {
  const info = await git(cwd, ['for-each-ref', `--format=%(objecttype)${'\x1f'}%(*objectname)${'\x1f'}%(objectname)${'\x1f'}%(contents)`, `refs/tags/${name}`]);
  if (!info.trim()) throw new GitError(`Тег «${name}» не найден`, { code: 'NOT_FOUND_REF' });
  const [type, peeled, obj, contents] = info.split('\x1f');
  await git(cwd, ['tag', '-d', name]);
  return { name, hash: type === 'tag' ? peeled : obj.trim(), message: type === 'tag' ? contents.trim() : null };
}

/** Переименовать локальную ветку (git branch -m). Ветка на сервере не трогается; upstream сохраняется. */
async function renameBranch(cwd, { from, to }) {
  const next = String(to ?? '').trim();
  if (!from || !next) throw new GitError('Укажите новое имя ветки', { code: 'BAD_ARGS' });
  if (next === from) throw new GitError('Имя не изменилось', { code: 'BAD_ARGS' });
  if (!(await branchTip(cwd, from))) throw new GitError(`Ветка «${from}» не найдена`, { code: 'NOT_FOUND_REF' });
  await git(cwd, ['check-ref-format', '--branch', next]).catch(() => {
    throw new GitError(`Недопустимое имя ветки: «${next}»`, { code: 'INVALID_NAME', hint: 'Без пробелов, «..», «~», «^», «:», «?», «*», «[» и «\\».' });
  });
  if (await branchTip(cwd, next)) throw new GitError(`Ветка «${next}» уже есть`, { code: 'BRANCH_EXISTS' });
  await git(cwd, ['branch', '-m', from, next]);
  return { from, to: next };
}

async function deleteBranch(cwd, { name, force = false }) {
  const state = await currentState(cwd);
  if (state.branchName === name) {
    throw new GitError('Нельзя удалить текущую ветку', {
      code: 'CURRENT_BRANCH',
      hint: 'Сначала переключитесь на другую ветку.',
    });
  }
  const hash = await branchTip(cwd, name);
  if (!hash) throw new GitError(`Ветка «${name}» не найдена`, { code: 'NOT_FOUND_REF' });
  try {
    await git(cwd, ['branch', force ? '-D' : '-d', name]);
  } catch (error) {
    if (/not fully merged/i.test(error.details)) {
      throw new GitError(`Ветка «${name}» не слита с текущей`, {
        code: 'NOT_MERGED',
        hint: 'Коммиты, которые есть только в этой ветке, станут недоступны (их можно вернуть через Undo).',
      });
    }
    throw error;
  }
  return { name, hash };
}

/* =================== Удаление ветки на сервере =================== */

/**
 * git push <remote> --delete <branch>. Перед удалением запоминаем, на каком коммите была ветка, —
 * Undo публикует её обратно на тот же коммит.
 */
async function deleteRemoteBranch(cwd, { remote, branch }) {
  if (typeof remote !== 'string' || !remote || remote.startsWith('-') || typeof branch !== 'string' || !branch || branch.startsWith('-')) {
    throw new GitError('Не указана ветка', { code: 'BAD_ARGS' });
  }
  const state = await currentState(cwd);
  if (!state.remotes.includes(remote)) throw new GitError(`Remote «${remote}» не найден`, { code: 'NO_REMOTE' });
  // Узнаём реальное состояние сервера: ветку могли уже удалить или передвинуть
  const out = await net(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const line = out.split('\n').find((l) => l.split('\t')[1] === `refs/heads/${branch}`);
  if (!line) {
    await git(cwd, ['update-ref', '-d', `refs/remotes/${remote}/${branch}`]).catch(() => {});
    throw new GitError(`Ветки ${branch} уже нет на ${remote}`, { code: 'NOT_FOUND_REF', hint: 'Её удалили раньше — список веток обновлён.' });
  }
  const hash = line.split('\t')[0].trim();
  try {
    await net(cwd, ['push', '--porcelain', remote, '--delete', `refs/heads/${branch}`]);
  } catch (error) {
    const text = `${error.details ?? ''}\n${error.message ?? ''}`;
    if (/refusing to delete the current branch|deletion of the current branch prohibited|default branch/i.test(text)) {
      throw new GitError(`Нельзя удалить ${branch}: это основная ветка репозитория на сервере`, {
        code: 'DEFAULT_BRANCH',
        hint: 'Сначала смените ветку по умолчанию в настройках проекта на GitLab/GitHub.',
        details: error.details,
      });
    }
    if (/protected|only delete protected branches|GH006|cannot delete/i.test(text)) {
      throw new GitError(`Ветка ${branch} защищена на сервере — удалить её нельзя`, {
        code: 'PROTECTED',
        hint: 'Снимите защиту ветки в настройках проекта (Settings → Repository → Protected branches) или удалите её в веб-интерфейсе.',
        details: error.details,
      });
    }
    throw error;
  }
  await git(cwd, ['update-ref', '-d', `refs/remotes/${remote}/${branch}`]).catch(() => {});
  const tracking = state.refs.localBranches.filter((b) => b.upstream === `${remote}/${branch}`).map((b) => b.name);
  return { remote, branch, hash, tracking };
}

async function cherryPick(cwd, { hash }) {
  requireHash(hash);
  const state = await currentState(cwd);
  requireBranchOrDetachedHead(state, 'cherry-pick');
  if (await isAncestor(cwd, hash, 'HEAD')) {
    throw new GitError('Этот коммит уже есть в текущей ветке', { code: 'ALREADY_IN_BRANCH' });
  }
  const args = ['cherry-pick'];
  if ((await parentsOf(cwd, hash)).length > 1) args.push('-m', '1'); // мердж — относительно 1-го родителя
  await git(cwd, [...args, hash], NO_EDITOR);
  return { hash, from: state.headHash, to: await headHash(cwd) };
}

async function revertCommit(cwd, { hash }) {
  requireHash(hash);
  const state = await currentState(cwd);
  requireBranchOrDetachedHead(state, 'revert');
  const args = ['revert', '--no-edit'];
  if ((await parentsOf(cwd, hash)).length > 1) args.push('-m', '1');
  await git(cwd, [...args, hash], NO_EDITOR);
  return { hash, from: state.headHash, to: await headHash(cwd) };
}

const RESET_MODES = new Set(['soft', 'mixed', 'hard']);

async function resetTo(cwd, { hash, mode = 'mixed' }) {
  requireHash(hash);
  if (!RESET_MODES.has(mode)) throw new GitError('Неизвестный режим reset', { code: 'BAD_ARGS' });
  const state = await currentState(cwd);
  requireBranchOrDetachedHead(state, 'reset');
  await git(cwd, ['reset', `--${mode}`, hash]);
  return { hash, mode, branch: state.branchName, from: state.headHash, to: await headHash(cwd) };
}

async function mergeRef(cwd, { ref }) {
  const state = await currentState(cwd);
  requireBranch(state, 'merge');
  await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => {
    throw new GitError(`Не найдено: ${ref}`, { code: 'NOT_FOUND_REF' });
  });
  if (await isAncestor(cwd, ref, 'HEAD')) {
    throw new GitError(`${ref} уже слита в ${state.branchName}`, { code: 'UP_TO_DATE' });
  }
  await git(cwd, ['merge', '--no-edit', ref], NO_EDITOR);
  return { ref, branch: state.branchName, from: state.headHash, to: await headHash(cwd) };
}

async function rebaseOnto(cwd, { ref }) {
  const state = await currentState(cwd);
  requireBranch(state, 'rebase');
  if (await isAncestor(cwd, ref, 'HEAD')) {
    throw new GitError(`${state.branchName} уже содержит ${ref}`, { code: 'UP_TO_DATE' });
  }
  await git(cwd, ['rebase', ref], NO_EDITOR);
  return { ref, branch: state.branchName, from: state.headHash, to: await headHash(cwd) };
}

// Перемотать ветку вперёд до коммита (fast-forward) — без переключения на неё
async function fastForward(cwd, { branch, to }) {
  if (typeof branch !== 'string' || !branch || typeof to !== 'string' || !to || to.startsWith('-')) {
    throw new GitError('Не указана ветка', { code: 'BAD_ARGS' });
  }
  const tip = await branchTip(cwd, branch);
  if (!tip) throw new GitError(`Ветка «${branch}» не найдена`, { code: 'NOT_FOUND_REF' });
  const target = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${to}^{commit}`]).catch(() => '')).trim();
  if (!target) throw new GitError(`Не найдено: ${to}`, { code: 'NOT_FOUND_REF' });
  if (tip === target) throw new GitError(`${branch} уже указывает на этот коммит`, { code: 'UP_TO_DATE' });
  if (!(await isAncestor(cwd, tip, target))) {
    throw new GitError(`Перемотать ${branch} нельзя: в ней есть коммиты, которых нет в ${to.length === 40 ? to.slice(0, 7) : to}`, {
      code: 'NOT_FAST_FORWARD',
      hint: 'Используйте слияние (merge) или rebase.',
    });
  }
  const state = await currentState(cwd);
  const current = state.branchName === branch;
  if (current) {
    requireNoOperation(state, 'fast-forward');
    await git(cwd, ['merge', '--ff-only', target]);
  } else {
    await git(cwd, ['update-ref', '-m', `fast-forward: ${branch}`, `refs/heads/${branch}`, target, tip]);
  }
  return { branch, from: tip, to: target, current };
}

/**
 * Обновить ветку из её upstream без переключения (fast-forward).
 * Не текущая ветка: git fetch <remote> <ref>:refs/heads/<branch> — рабочая папка не трогается.
 * Текущая: fetch и merge --ff-only. Если в ветке есть свои коммиты — отказ: тут нужен pull/rebase.
 */
async function updateBranch(cwd, { branch }) {
  if (typeof branch !== 'string' || !branch || branch.startsWith('-')) throw new GitError('Не указана ветка', { code: 'BAD_ARGS' });
  const state = await currentState(cwd);
  const b = state.refs.localBranches.find((x) => x.name === branch);
  if (!b) throw new GitError(`Ветка «${branch}» не найдена`, { code: 'NOT_FOUND_REF' });
  if (!b.upstream || !b.upstreamRemote || !b.upstreamRef || b.upstreamRemote === '.') {
    throw new GitError(`У ветки «${branch}» нет ветки на сервере`, { code: 'NO_UPSTREAM', hint: 'Сделайте Push, чтобы опубликовать её.' });
  }
  if (b.gone) {
    throw new GitError(`${b.upstream} удалена на сервере`, { code: 'UPSTREAM_GONE', hint: 'Обновлять неоткуда: ветку на сервере удалили.' });
  }
  if (!state.remotes.includes(b.upstreamRemote)) throw new GitError(`Remote «${b.upstreamRemote}» не найден`, { code: 'NO_REMOTE' });
  const current = state.branchName === branch;
  const from = b.hash;

  if (current) {
    requireNoOperation(state, 'обновление');
    await net(cwd, ['fetch', '--no-tags', b.upstreamRemote, `+${b.upstreamRef}:refs/remotes/${b.upstream}`]);
    const target = (await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${b.upstream}^{commit}`]).catch(() => '')).trim();
    if (!target || target === from) return { branch, from, to: from, current, count: 0 };
    if (!(await isAncestor(cwd, from, target))) {
      throw new GitError(`В ${branch} есть свои коммиты — перемотать нельзя`, {
        code: 'NOT_FAST_FORWARD',
        hint: 'Используйте Pull (merge или rebase), чтобы объединить изменения.',
      });
    }
    try {
      await git(cwd, ['merge', '--ff-only', '-q', target]);
    } catch (error) {
      if (/overwritten|would be overwritten|untracked working tree/i.test(error.details ?? error.message)) {
        throw new GitError('Обновление затронет файлы с вашими незакоммиченными правками', {
          code: 'LOCAL_CHANGES',
          hint: 'Закоммитьте или спрячьте правки (Stash) и повторите.',
          details: error.details,
        });
      }
      throw error;
    }
  } else {
    if (b.ahead > 0) {
      throw new GitError(`В ${branch} есть неотправленные коммиты (${b.ahead})`, {
        code: 'NOT_FAST_FORWARD',
        hint: 'Без переключения обновить нельзя: переключитесь на ветку и сделайте Pull (merge или rebase).',
      });
    }
    try {
      // Без «+»: Git сам откажется, если это не перемотка вперёд
      await net(cwd, ['fetch', '--no-tags', b.upstreamRemote, `${b.upstreamRef}:refs/heads/${branch}`]);
    } catch (error) {
      const text = `${error.message}\n${error.details ?? ''}`;
      if (/non-fast-forward|rejected/i.test(text)) {
        throw new GitError(`${branch} разошлась с ${b.upstream}`, {
          code: 'NOT_FAST_FORWARD',
          hint: 'Переключитесь на ветку и сделайте Pull (merge или rebase).',
          details: error.details,
        });
      }
      if (/checked out|refusing to fetch into/i.test(text)) {
        throw new GitError(`${branch} открыта в другой рабочей папке (worktree)`, { code: 'BRANCH_IN_USE', details: error.details });
      }
      throw error;
    }
    // Ссылку origin/… Git обновляет сам (opportunistic update), но на старых версиях — нет
    const tip = await branchTip(cwd, branch);
    await git(cwd, ['update-ref', `refs/remotes/${b.upstream}`, tip]).catch(() => {});
  }
  const to = await branchTip(cwd, branch);
  const count = to === from ? 0 : Number((await git(cwd, ['rev-list', '--count', `${from}..${to}`])).trim()) || 0;
  return { branch, from, to, current, count, upstream: b.upstream };
}

async function discardAll(cwd) {
  requireNoOperation(await currentState(cwd), 'discard');
  const files = await readStatus(cwd);
  if (files.length === 0) throw new GitError('Нет изменений', { code: 'NOTHING_TO_DISCARD' });
  if (await hasHead(cwd)) await git(cwd, ['reset', '--hard', '-q', 'HEAD']);
  else await git(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.']);
  await git(cwd, ['clean', '-fd', '-q']);
  return { files: new Set(files.map((f) => f.path)).size };
}

function requireBranchOrDetachedHead(state, action) {
  requireNoOperation(state, action);
  if (!state.headHash) throw new GitError(`Нельзя сделать ${action}: нет коммитов`, { code: 'NO_COMMITS' });
}

/* =================== Stash: применить / забрать / удалить конкретный =================== */

// stash@{n} сдвигаются при каждом изменении списка — проверяем, что по индексу всё ещё нужный stash
async function resolveStash(cwd, { id, hash }) {
  if (!/^stash@\{\d+\}$/.test(id || '')) throw new GitError('Некорректный stash', { code: 'BAD_ARGS' });
  const actual = (await git(cwd, ['rev-parse', '--verify', '--quiet', id]).catch(() => '')).trim();
  if (!actual) throw new GitError('Stash не найден — список изменился', { code: 'NO_STASH' });
  if (hash && actual !== hash) throw new GitError('Список stash изменился — обновите и повторите', { code: 'HISTORY_STALE' });
  const message = (await git(cwd, ['log', '-1', '--format=%gs', '-g', id]).catch(() => '')).trim();
  return { id, hash: actual, message };
}

async function stashApplyAt(cwd, p) {
  requireNoOperation(await currentState(cwd), 'apply');
  const s = await resolveStash(cwd, p);
  await git(cwd, ['stash', 'apply', s.id]);
  return s;
}

async function stashPopAt(cwd, p) {
  requireNoOperation(await currentState(cwd), 'pop');
  const s = await resolveStash(cwd, p);
  await git(cwd, ['stash', 'pop', s.id]);
  return s;
}

async function stashDropAt(cwd, p) {
  const s = await resolveStash(cwd, p);
  await git(cwd, ['stash', 'drop', '-q', s.id]);
  return s;
}

/* =================== Вернуть проект к состоянию коммита =================== */

// Предпросмотр: что отменится, сколько файлов изменится, можно ли выполнить
async function revertToPreview(cwd, { hash }) {
  requireHash(hash);
  const state = await currentState(cwd);
  requireBranchOrDetachedHead(state, 'revert');
  const head = state.headHash;
  const ancestor = await isAncestor(cwd, hash, head);
  const range = `${hash}..${head}`;
  const count = Number((await git(cwd, ['rev-list', '--count', range])).trim());
  const log = (await git(cwd, ['log', '-n', '30', `--format=%H%x1f%s%x1f%an%x1f%aI`, range]))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [h, message, author, date] = l.split('\x1f');
      return { hash: h, message, author, date };
    });
  const shortstat = (await git(cwd, ['diff', '--shortstat', head, hash])).trim();
  const num = (re) => Number(re.exec(shortstat)?.[1] ?? 0);
  const target = (await git(cwd, ['log', '-1', '--format=%s%x1f%an%x1f%aI', hash])).trim().split('\x1f');

  const files = await readStatus(cwd);
  const dirty = files.filter((f) => !f.untracked);
  // Неотслеживаемые файлы, которые совпадают по пути с файлами в целевом коммите, были бы перезаписаны
  const untracked = files.filter((f) => f.untracked).map((f) => f.path);
  let collisions = [];
  if (untracked.length) {
    const targetFiles = new Set((await git(cwd, ['ls-tree', '-r', '-z', '--name-only', hash])).split('\0'));
    collisions = untracked.filter((p) => targetFiles.has(p));
  }
  let pushedCount = 0;
  if (state.branch?.upstream && ancestor) {
    pushedCount = Number((await git(cwd, ['rev-list', '--count', `${hash}..${state.branch.upstream}`]).catch(() => '0')).trim());
  }

  return {
    hash,
    target: { message: target[0], author: target[1], date: target[2] },
    branch: state.branchName,
    ancestor,
    count,
    commits: log,
    filesChanged: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?/),
    deletions: num(/(\d+) deletions?/),
    identical: shortstat === '',
    dirtyCount: dirty.length,
    collisions,
    pushedCount,
    hasUpstream: Boolean(state.branch?.upstream),
  };
}

// Один новый коммит, который делает файлы проекта такими, как в выбранном коммите. История не переписывается.
async function revertTo(cwd, { hash, message }) {
  const preview = await revertToPreview(cwd, { hash });
  if (preview.identical) throw new GitError('Файлы уже совпадают с этим коммитом — откатывать нечего', { code: 'UP_TO_DATE' });
  if (preview.dirtyCount) {
    throw new GitError(`Есть незакоммиченные изменения (${preview.dirtyCount})`, {
      code: 'DIRTY',
      hint: 'Закоммитьте их или сделайте Stash, затем повторите.',
    });
  }
  if (preview.collisions.length) {
    throw new GitError('Неотслеживаемые файлы мешают откату', {
      code: 'DIRTY',
      hint: `Переместите или удалите: ${preview.collisions.slice(0, 5).join(', ')}${preview.collisions.length > 5 ? '…' : ''}`,
    });
  }
  const from = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  const short = hash.slice(0, 7);
  const subject = (message && message.trim()) || `Revert to ${short}: ${preview.target.message}`;
  const body = preview.ancestor
    ? `Файлы возвращены к состоянию ${hash}.\nОтменены изменения ${preview.count} коммитов:\n${preview.commits
        .map((c) => `- ${c.hash.slice(0, 7)} ${c.message}`)
        .join('\n')}${preview.count > preview.commits.length ? '\n- …' : ''}`
    : `Файлы приведены к состоянию ${hash}.`;
  // Индекс и рабочие файлы → ровно как в целевом коммите (удалённые там файлы тоже удаляются)
  await git(cwd, ['read-tree', '-u', '--reset', hash]);
  await git(cwd, ['commit', '-q', '-m', subject, '-m', body]);
  const to = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  return { hash, from, to, subject, count: preview.count, filesChanged: preview.filesChanged, branch: preview.branch };
}

/* =================== Незавершённый merge / rebase =================== */

const NO_EDITOR = { env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' } };

async function abortOperation(cwd) {
  const op = await detectOperation(cwd);
  if (!op) throw new GitError('Нет незавершённой операции', { code: 'NO_OPERATION' });
  await git(cwd, [op, '--abort']);
  return { operation: op };
}

async function continueOperation(cwd) {
  const op = await detectOperation(cwd);
  if (!op) throw new GitError('Нет незавершённой операции', { code: 'NO_OPERATION' });
  const conflicted = (await readStatus(cwd)).filter((f) => f.status === 'U');
  if (conflicted.length) {
    throw new GitError(`Остались неразрешённые конфликты: ${conflicted.length}`, {
      code: 'CONFLICT',
      hint: 'Исправьте файлы с пометкой U и застейджите их (кнопка + в списке файлов).',
      details: conflicted.map((f) => f.path).join('\n'),
    });
  }
  if (op === 'merge') await git(cwd, ['commit', '--no-edit'], NO_EDITOR);
  else {
    // Интерактивный rebase из приложения: reword/squash после конфликта получают заранее заданные сообщения
    const env = op === 'rebase' ? rebase.continueEnv(cwd) : null;
    await git(cwd, [op, '--continue'], env ? { env } : NO_EDITOR);
  }
  return { operation: op, finished: !(await detectOperation(cwd)) };
}

/* =================== История Undo / Redo =================== */

const histories = new Map(); // repoPath -> { undo: [], redo: [] }
// Операции, остановившиеся на конфликте: откуда начинали, чтобы после «Продолжить» их можно было отменить
const pendingOps = new Map(); // repoPath -> { from, label }

// Запускаем операцию; если она встала на конфликте — запоминаем исходный HEAD
async function trackConflicts(cwd, label, fn) {
  const from = await headHash(cwd).catch(() => null);
  try {
    return await fn();
  } catch (error) {
    if (error?.code === 'CONFLICT' && from) pendingOps.set(cwd, { from, label });
    throw error;
  }
}

function historyFor(cwd) {
  if (!histories.has(cwd)) histories.set(cwd, { undo: [], redo: [] });
  return histories.get(cwd);
}

function record(cwd, entry) {
  const h = historyFor(cwd);
  h.undo.push(entry);
  if (h.undo.length > 50) h.undo.shift();
  h.redo = [];
}

function historySummary(cwd) {
  const h = historyFor(cwd);
  return {
    undo: h.undo.at(-1)?.label ?? null,
    redo: h.redo.at(-1)?.label ?? null,
  };
}

const posLabel = (p) => (p.branch ? p.branch : `${p.detached?.slice(0, 7)} (detached)`);

async function headHash(cwd) {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || null;
}

async function branchTip(cwd, name) {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).catch(() => '')).trim() || null;
}

const stale = (what) =>
  new GitError(`Нельзя отменить: ${what} изменилось после операции`, {
    code: 'HISTORY_STALE',
    hint: 'Репозиторий изменился вне приложения или другой операцией.',
  });

const HANDLERS = {
  commit: {
    async undo(cwd, e) {
      if ((await headHash(cwd)) !== e.hash) throw stale('HEAD');
      if (!e.parent) throw new GitError('Первый коммит репозитория отменить нельзя', { code: 'HISTORY_ROOT' });
      const pushed = (await git(cwd, ['branch', '-r', '--contains', e.hash])).trim();
      if (pushed) {
        throw new GitError('Коммит уже отправлен на remote — отмена переписала бы общую историю', {
          code: 'HISTORY_PUSHED',
          hint: 'Используйте revert (будет добавлен позже).',
        });
      }
      await git(cwd, ['reset', '--soft', e.parent]); // изменения остаются застейдженными
    },
    async redo(cwd, e) {
      if ((await headHash(cwd)) !== e.parent) throw stale('HEAD');
      await git(cwd, ['reset', '--soft', e.hash]);
    },
  },
  // Ветка перемотана (fast-forward): возвращаем её на прежний коммит
  branchMove: {
    async undo(cwd, e) {
      if ((await branchTip(cwd, e.branch)) !== e.to) throw stale(`ветка ${e.branch}`);
      if ((await currentState(cwd)).branchName === e.branch) await git(cwd, ['reset', '--keep', e.from]);
      else await git(cwd, ['update-ref', `refs/heads/${e.branch}`, e.from, e.to]);
    },
    async redo(cwd, e) {
      if ((await branchTip(cwd, e.branch)) !== e.from) throw stale(`ветка ${e.branch}`);
      if ((await currentState(cwd)).branchName === e.branch) await git(cwd, ['reset', '--keep', e.to]);
      else await git(cwd, ['update-ref', `refs/heads/${e.branch}`, e.to, e.from]);
    },
  },
  // Отмена умного переключения — такое же умное переключение обратно (изменения снова меняются местами)
  smartCheckout: {
    async undo(cwd, e) {
      if (!e.previous.branch) throw new GitError('Нельзя вернуться: до переключения был detached HEAD', { code: 'HISTORY_STALE' });
      await smartCheckout(cwd, { branch: e.previous.branch });
      if (e.created && (await branchTip(cwd, e.created.name)) === e.created.hash) await git(cwd, ['branch', '-D', e.created.name]);
    },
    async redo(cwd, e) {
      if (e.created) await smartCheckout(cwd, { remoteBranch: { name: e.created.name, fullName: e.created.track } });
      else await smartCheckout(cwd, { branch: e.to.branch });
    },
  },
  checkout: {
    async undo(cwd, e) {
      await switchTo(cwd, e.previous);
      if (e.created && (await branchTip(cwd, e.created.name)) === e.created.hash) {
        await git(cwd, ['branch', '-D', e.created.name]);
      }
    },
    async redo(cwd, e) {
      if (e.created) {
        await git(cwd, ['switch', '--create', e.created.name, '--track', e.created.track]);
      } else {
        await switchTo(cwd, e.to);
      }
    },
  },
  branch: {
    async undo(cwd, e) {
      if ((await branchTip(cwd, e.name)) !== e.hash) throw stale(`ветка ${e.name}`);
      if (e.checkedOut) await switchTo(cwd, e.previous);
      await git(cwd, ['branch', '-D', e.name]);
    },
    async redo(cwd, e) {
      if (e.checkedOut) await git(cwd, ['switch', '--create', e.name, e.hash]);
      else await git(cwd, ['branch', e.name, e.hash]);
    },
  },
  // cherry-pick, revert, merge, rebase: HEAD сдвинулся с from на to
  headMove: {
    async undo(cwd, e) {
      if ((await headHash(cwd)) !== e.to) throw stale('HEAD');
      await git(cwd, ['reset', '--keep', e.from]); // --keep не трогает несвязанные локальные правки
    },
    async redo(cwd, e) {
      if ((await headHash(cwd)) !== e.from) throw stale('HEAD');
      await git(cwd, ['reset', '--keep', e.to]);
    },
  },
  reset: {
    async undo(cwd, e) {
      if ((await headHash(cwd)) !== e.to) throw stale('HEAD');
      await git(cwd, ['reset', e.mode === 'hard' ? '--keep' : `--${e.mode}`, e.from]);
    },
    async redo(cwd, e) {
      if ((await headHash(cwd)) !== e.from) throw stale('HEAD');
      await git(cwd, ['reset', e.mode === 'hard' ? '--keep' : `--${e.mode}`, e.to]);
    },
  },
  tag: {
    async undo(cwd, e) {
      const at = (await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${e.name}^{commit}`]).catch(() => '')).trim();
      if (at !== e.hash) throw stale(`тег ${e.name}`);
      await git(cwd, ['tag', '-d', e.name]);
    },
    async redo(cwd, e) {
      await createTag(cwd, e);
    },
  },
  deleteTag: {
    async undo(cwd, e) {
      await createTag(cwd, e);
    },
    async redo(cwd, e) {
      await git(cwd, ['tag', '-d', e.name]);
    },
  },
  // Откат файла/фрагмента в рабочей папке: возвращаем снимок содержимого
  fileSnapshot: {
    async undo(cwd, e) {
      for (const snap of [...e.snapshots].reverse()) await restore.writeSnapshot(cwd, snap, 'before');
    },
    async redo(cwd, e) {
      for (const snap of e.snapshots) await restore.writeSnapshot(cwd, snap, 'after');
    },
  },
  stashDrop: {
    async undo(cwd, e) {
      await git(cwd, ['stash', 'store', '-m', e.message || 'restored stash', e.hash]);
    },
    async redo(cwd, e) {
      const top = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'stash@{0}']).catch(() => '')).trim();
      if (top !== e.hash) throw stale('список сташей');
      await git(cwd, ['stash', 'drop', '-q', 'stash@{0}']);
    },
  },
  renameBranch: {
    async undo(cwd, e) {
      await git(cwd, ['branch', '-m', e.to, e.from]);
    },
    async redo(cwd, e) {
      await git(cwd, ['branch', '-m', e.from, e.to]);
    },
  },
  deleteBranch: {
    async undo(cwd, e) {
      await git(cwd, ['branch', e.name, e.hash]);
    },
    async redo(cwd, e) {
      if ((await branchTip(cwd, e.name)) !== e.hash) throw stale(`ветка ${e.name}`);
      await git(cwd, ['branch', '-D', e.name]);
    },
  },
  deleteRemoteBranch: {
    async undo(cwd, e) {
      if (!e.hash) throw new GitError('Не известно, на каком коммите была ветка', { code: 'HISTORY_STALE' });
      const have = await git(cwd, ['cat-file', '-e', `${e.hash}^{commit}`]).then(() => true, () => false);
      if (!have) throw new GitError('Коммита ветки нет локально — вернуть на сервер нельзя', { code: 'HISTORY_STALE', hint: 'Сделайте fetch у коллеги или восстановите ветку на сервере.' });
      await net(cwd, ['push', '--porcelain', e.remote, `${e.hash}:refs/heads/${e.branch}`]);
      await git(cwd, ['update-ref', `refs/remotes/${e.remote}/${e.branch}`, e.hash]);
    },
    async redo(cwd, e) {
      await deleteRemoteBranch(cwd, { remote: e.remote, branch: e.branch });
    },
  },
  stash: {
    async undo(cwd, e) {
      const top = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'stash@{0}']).catch(() => '')).trim();
      if (top !== e.hash) throw stale('список сташей');
      await stashPop(cwd);
    },
    async redo(cwd, e) {
      const res = await stashPush(cwd, { message: e.message });
      e.hash = res.hash;
    },
  },
};

async function undo(cwd) {
  const h = historyFor(cwd);
  const entry = h.undo.at(-1);
  if (!entry) throw new GitError('Нечего отменять', { code: 'HISTORY_EMPTY' });
  requireNoOperation(await currentState(cwd), 'undo');
  await HANDLERS[entry.type].undo(cwd, entry);
  h.undo.pop();
  h.redo.push(entry);
  return { label: entry.label };
}

async function redo(cwd) {
  const h = historyFor(cwd);
  const entry = h.redo.at(-1);
  if (!entry) throw new GitError('Нечего повторять', { code: 'HISTORY_EMPTY' });
  requireNoOperation(await currentState(cwd), 'redo');
  await HANDLERS[entry.type].redo(cwd, entry);
  h.redo.pop();
  h.undo.push(entry);
  return { label: entry.label };
}

/* =================== Действия с записью в историю =================== */

const ACTIONS = {
  checkAccess: (cwd, p) => checkAccess(cwd, p),
  fetch: (cwd) => fetchAll(cwd),
  pull: (cwd, p) => trackConflicts(cwd, 'Pull', () => pull(cwd, p)),
  push: (cwd, p) => push(cwd, p),
  undo: (cwd) => undo(cwd),
  redo: (cwd) => redo(cwd),
  async continueOperation(cwd) {
    const res = await continueOperation(cwd);
    if (res.finished) {
      // Операция с конфликтами завершена — теперь её можно отменить целиком
      let pending = pendingOps.get(cwd);
      if (!pending && (res.operation === 'merge' || res.operation === 'rebase')) {
        const orig = await git(cwd, ['rev-parse', '--verify', '--quiet', 'ORIG_HEAD']).then((x) => x.trim()).catch(() => null);
        if (orig) pending = { from: orig, label: res.operation === 'merge' ? 'Merge' : 'Rebase' };
      }
      pendingOps.delete(cwd);
      rebase.cleanup(cwd);
      const to = await headHash(cwd);
      if (pending && pending.from !== to) record(cwd, { type: 'headMove', label: `${pending.label} (с решением конфликтов)`, from: pending.from, to });
    }
    return res;
  },
  async abortOperation(cwd) {
    pendingOps.delete(cwd);
    rebase.cleanup(cwd);
    return abortOperation(cwd);
  },
  stage: (cwd, p) => stage(cwd, p.paths),
  unstage: (cwd, p) => unstage(cwd, p.paths),

  async commit(cwd, { summary, description }) {
    const res = await gitCommit(cwd, summary, description);
    record(cwd, { type: 'commit', label: `Commit «${res.summary}»`, hash: res.hash, parent: res.parent });
    return res;
  },
  async checkout(cwd, p) {
    if (p.smart) {
      const res = await smartCheckout(cwd, p);
      if (res.previous.branch !== res.to.branch || res.created) {
        record(cwd, { type: 'smartCheckout', label: `Checkout ${posLabel(res.to)}`, previous: res.previous, to: res.to, created: res.created });
      }
      return res;
    }
    const res = await checkout(cwd, p);
    if (res.previous.branch !== res.to.branch || res.created) {
      record(cwd, { type: 'checkout', label: `Checkout ${posLabel(res.to)}`, ...res });
    }
    return res;
  },
  async createBranch(cwd, p) {
    const res = await createBranch(cwd, p);
    record(cwd, { type: 'branch', label: `Создание ветки ${res.name}`, ...res });
    return res;
  },
  async stash(cwd, p) {
    const res = await stashPush(cwd, p);
    record(cwd, { type: 'stash', label: 'Stash', hash: res.hash, message: p?.message ?? null });
    return res;
  },
  async stashApplyAt(cwd, p) {
    const res = await stashApplyAt(cwd, p);
    historyFor(cwd).redo = [];
    return res;
  },
  async stashPopAt(cwd, p) {
    const res = await stashPopAt(cwd, p);
    historyFor(cwd).redo = [];
    return res;
  },
  async stashDrop(cwd, p) {
    const res = await stashDropAt(cwd, p);
    record(cwd, { type: 'stashDrop', label: `Удаление ${res.id}`, ...res });
    return res;
  },
  revertToPreview: (cwd, p) => revertToPreview(cwd, p),
  // Конфликты: не записываются в Undo (git сам держит исходные версии в индексе до коммита)
  getConflict: (cwd, p) => conflicts.getConflict(cwd, p.path),
  saveResolution: (cwd, p) => conflicts.saveResolution(cwd, p),
  resolveWhole: (cwd, p) => conflicts.resolveWhole(cwd, p),
  markResolved: (cwd, p) => conflicts.markResolved(cwd, p),
  async revertTo(cwd, p) {
    const res = await revertTo(cwd, p);
    record(cwd, { type: 'headMove', label: `Возврат к ${p.hash.slice(0, 7)}`, from: res.from, to: res.to });
    return res;
  },
  async checkoutCommit(cwd, p) {
    const res = await checkoutCommit(cwd, p);
    record(cwd, { type: 'checkout', label: `Checkout ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async createTag(cwd, p) {
    const res = await createTag(cwd, p);
    record(cwd, { type: 'tag', label: `Тег ${res.name}`, ...res });
    return res;
  },
  async deleteTag(cwd, p) {
    const res = await deleteTag(cwd, p);
    record(cwd, { type: 'deleteTag', label: `Удаление тега ${res.name}`, ...res });
    return res;
  },
  async deleteRemoteBranch(cwd, p) {
    const res = await deleteRemoteBranch(cwd, p);
    record(cwd, { type: 'deleteRemoteBranch', label: `Удаление ${res.remote}/${res.branch} с сервера`, ...res });
    return res;
  },
  async renameBranch(cwd, p) {
    const res = await renameBranch(cwd, p);
    record(cwd, { type: 'renameBranch', label: `Переименование ${res.from} → ${res.to}`, ...res });
    return res;
  },
  async deleteBranch(cwd, p) {
    const res = await deleteBranch(cwd, p);
    record(cwd, { type: 'deleteBranch', label: `Удаление ветки ${res.name}`, ...res });
    return res;
  },
  async cherryPick(cwd, p) {
    const res = await trackConflicts(cwd, `Cherry-pick ${String(p.hash).slice(0, 7)}`, () => cherryPick(cwd, p));
    record(cwd, { type: 'headMove', label: `Cherry-pick ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async revert(cwd, p) {
    const res = await trackConflicts(cwd, `Revert ${String(p.hash).slice(0, 7)}`, () => revertCommit(cwd, p));
    record(cwd, { type: 'headMove', label: `Revert ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async reset(cwd, p) {
    const res = await resetTo(cwd, p);
    if (res.from !== res.to) record(cwd, { type: 'reset', label: `Reset --${res.mode} → ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async merge(cwd, p) {
    const res = await trackConflicts(cwd, `Merge ${p.ref}`, () => mergeRef(cwd, p));
    record(cwd, { type: 'headMove', label: `Merge ${p.ref}`, ...res });
    return res;
  },
  async rebase(cwd, p) {
    const res = await trackConflicts(cwd, `Rebase на ${p.ref}`, () => rebaseOnto(cwd, p));
    record(cwd, { type: 'headMove', label: `Rebase на ${p.ref}`, ...res });
    return res;
  },
  // Интерактивный rebase: применить посчитанный в предпросмотре результат
  async rebaseApply(cwd, p) {
    const res = await rebase.apply(cwd, p);
    record(cwd, { type: 'headMove', label: `Rebase ${res.branch}`, from: res.from, to: res.to });
    return res;
  },
  // …или запустить настоящий git rebase -i, чтобы разрешить конфликты вручную
  async rebaseStart(cwd, p) {
    const res = await trackConflicts(cwd, 'Rebase', () => rebase.start(cwd, p));
    if (res.from !== res.to) record(cwd, { type: 'headMove', label: `Rebase ${res.branch}`, from: res.from, to: res.to });
    return res;
  },
  async restoreFile(cwd, p) {
    const res = await restore.restoreFile(cwd, p);
    const what = p.side === 'before' ? 'до' : 'из';
    if (res.snapshot) record(cwd, { type: 'fileSnapshot', label: `Файл ${res.path} → версия ${what} ${p.hash.slice(0, 7)}`, snapshots: [res.snapshot] });
    else historyFor(cwd).redo = [];
    return { path: res.path, deleted: res.deleted, side: res.side, undoable: Boolean(res.snapshot) };
  },
  async restoreFromStash(cwd, p) {
    const res = await restore.restoreFromStash(cwd, p);
    if (res.snapshots.length) {
      record(cwd, { type: 'fileSnapshot', label: `Из ${p.id ?? 'stash'}: ${res.changed} ${res.changed === 1 ? 'файл' : 'файлов'}`, snapshots: res.snapshots });
    }
    return { files: res.files, changed: res.changed, undoable: res.complete };
  },
  async applyHunks(cwd, p) {
    const res = await restore.applyHunks(cwd, p);
    const labels = { revert: 'Откат фрагмента коммита', discard: 'Удаление правок', apply: 'Фрагмент из stash' };
    if (res.snapshot) record(cwd, { type: 'fileSnapshot', label: `${labels[res.op]} в ${res.path}`, snapshots: [res.snapshot] });
    else if (labels[res.op]) historyFor(cwd).redo = [];
    return { op: res.op, path: res.path, hunks: res.hunks, total: res.total, undoable: Boolean(res.snapshot) };
  },
  // Перетаскивание на ветку: при необходимости переключиться на неё, затем merge / cherry-pick
  async mergeInto(cwd, p) {
    const state = await currentState(cwd);
    if (state.branchName !== p.target) await ACTIONS.checkout(cwd, { branch: p.target, smart: p.smart });
    return ACTIONS.merge(cwd, { ref: p.ref });
  },
  async cherryPickInto(cwd, p) {
    const state = await currentState(cwd);
    if (state.branchName !== p.target) await ACTIONS.checkout(cwd, { branch: p.target, smart: p.smart });
    return ACTIONS.cherryPick(cwd, { hash: p.hash });
  },
  async updateBranch(cwd, p) {
    const res = await updateBranch(cwd, p);
    if (res.from !== res.to) record(cwd, { type: 'branchMove', label: `Обновление ${res.branch}`, branch: res.branch, from: res.from, to: res.to });
    return res;
  },
  async fastForward(cwd, p) {
    const res = await fastForward(cwd, p);
    record(cwd, { type: 'branchMove', label: `Fast-forward ${res.branch}`, branch: res.branch, from: res.from, to: res.to });
    return res;
  },
  async gitRaw(cwd, p) {
    const res = await gitRaw(cwd, p);
    historyFor(cwd).redo = [];
    return res;
  },
  async discardAll(cwd) {
    const res = await discardAll(cwd);
    historyFor(cwd).redo = [];
    return res;
  },
  async stashPop(cwd) {
    const res = await stashPop(cwd);
    // pop не отменяется: стираем redo, чтобы не повторить устаревшее действие
    historyFor(cwd).redo = [];
    return res;
  },
};

/*
 * Занятость репозитория. Пока идёт действие пользователя (коммит, checkout, rebase…), фоновая
 * проверка сервера пропускает тик; а действие пользователя дожидается фонового fetch, если он уже идёт.
 * Так два git-процесса не борются за .git/index.lock и блокировки ссылок.
 */
const busy = new Map(); // root → число выполняющихся действий
const background = new Map(); // root → Promise фоновой задачи

function isBusy(cwd) {
  return (busy.get(cwd) ?? 0) > 0;
}

/** Запустить фоновую задачу, если репозиторий свободен. → Promise или null (занято) */
function runBackground(cwd, fn) {
  if (isBusy(cwd) || background.has(cwd)) return null;
  const job = Promise.resolve()
    .then(fn)
    .finally(() => background.delete(cwd));
  background.set(cwd, job);
  return job;
}

async function runAction(cwd, name, payload = {}) {
  const action = ACTIONS[name];
  if (!action) throw new GitError(`Неизвестное действие: ${name}`, { code: 'BAD_ARGS' });
  busy.set(cwd, (busy.get(cwd) ?? 0) + 1);
  try {
    const bg = background.get(cwd);
    if (bg) await bg.catch(() => {});
    return await action(cwd, payload ?? {});
  } finally {
    const n = (busy.get(cwd) ?? 1) - 1;
    if (n > 0) busy.set(cwd, n);
    else busy.delete(cwd);
  }
}

module.exports = { runAction, historySummary, checkAccess, networkOptions, isBusy, runBackground };
