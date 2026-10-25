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

const NETWORK_TIMEOUT = 5 * 60 * 1000; // запас на окно входа Git Credential Manager

/* =================== Сетевое окружение =================== */

/**
 * GIT_TERMINAL_PROMPT=0 — git не ждёт ввода логина в невидимой консоли (иначе процесс висит).
 * Окно входа Git Credential Manager при этом продолжает работать.
 * Для SSH включаем BatchMode, если пользователь не настроил ssh сам: без него ssh
 * может ждать подтверждения ключа хоста или пароля ключа, которые некуда ввести.
 */
async function networkOptions(cwd) {
  const env = { GIT_TERMINAL_PROMPT: '0' };
  if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH) {
    const configured = await git(cwd, ['config', '--get', 'core.sshCommand']).catch(() => '');
    if (!configured.trim()) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  }
  return { env, timeout: NETWORK_TIMEOUT };
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
  if (start && !HASH_RE.test(start)) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  const startPoint = start || 'HEAD';
  const previous = await currentPosition(cwd);

  if (doCheckout) await git(cwd, ['switch', '--create', branchName, startPoint]);
  else await git(cwd, ['branch', branchName, startPoint]);

  const hash = (await git(cwd, ['rev-parse', branchName])).trim();
  return { name: branchName, hash, checkedOut: doCheckout, previous };
}

/* =================== Stash =================== */

async function stashPush(cwd, { message } = {}) {
  const files = await readStatus(cwd);
  if (files.length === 0) throw new GitError('Нет изменений для stash', { code: 'NOTHING_TO_STASH' });
  if (!(await hasHead(cwd))) throw new GitError('Stash недоступен до первого коммита', { code: 'NO_COMMITS' });
  const args = ['stash', 'push', '--include-untracked'];
  if (message && message.trim()) args.push('-m', message.trim());
  await git(cwd, args);
  const hash = (await git(cwd, ['rev-parse', 'stash@{0}'])).trim();
  return { hash, files: files.length };
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
  else await git(cwd, [op, '--continue'], NO_EDITOR);
  return { operation: op, finished: !(await detectOperation(cwd)) };
}

/* =================== История Undo / Redo =================== */

const histories = new Map(); // repoPath -> { undo: [], redo: [] }

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
  deleteBranch: {
    async undo(cwd, e) {
      await git(cwd, ['branch', e.name, e.hash]);
    },
    async redo(cwd, e) {
      if ((await branchTip(cwd, e.name)) !== e.hash) throw stale(`ветка ${e.name}`);
      await git(cwd, ['branch', '-D', e.name]);
    },
  },
  stash: {
    async undo(cwd, e) {
      const top = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'stash@{0}']).catch(() => '')).trim();
      if (top !== e.hash) throw stale('список сташей');
      await stashPop(cwd);
    },
    async redo(cwd, e) {
      const res = await stashPush(cwd, {});
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
  pull: (cwd, p) => pull(cwd, p),
  push: (cwd, p) => push(cwd, p),
  undo: (cwd) => undo(cwd),
  redo: (cwd) => redo(cwd),
  abortOperation: (cwd) => abortOperation(cwd),
  continueOperation: (cwd) => continueOperation(cwd),
  stage: (cwd, p) => stage(cwd, p.paths),
  unstage: (cwd, p) => unstage(cwd, p.paths),

  async commit(cwd, { summary, description }) {
    const res = await gitCommit(cwd, summary, description);
    record(cwd, { type: 'commit', label: `Commit «${res.summary}»`, hash: res.hash, parent: res.parent });
    return res;
  },
  async checkout(cwd, p) {
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
    record(cwd, { type: 'stash', label: 'Stash', hash: res.hash });
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
  async deleteBranch(cwd, p) {
    const res = await deleteBranch(cwd, p);
    record(cwd, { type: 'deleteBranch', label: `Удаление ветки ${res.name}`, ...res });
    return res;
  },
  async cherryPick(cwd, p) {
    const res = await cherryPick(cwd, p);
    record(cwd, { type: 'headMove', label: `Cherry-pick ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async revert(cwd, p) {
    const res = await revertCommit(cwd, p);
    record(cwd, { type: 'headMove', label: `Revert ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async reset(cwd, p) {
    const res = await resetTo(cwd, p);
    if (res.from !== res.to) record(cwd, { type: 'reset', label: `Reset --${res.mode} → ${p.hash.slice(0, 7)}`, ...res });
    return res;
  },
  async merge(cwd, p) {
    const res = await mergeRef(cwd, p);
    record(cwd, { type: 'headMove', label: `Merge ${p.ref}`, ...res });
    return res;
  },
  async rebase(cwd, p) {
    const res = await rebaseOnto(cwd, p);
    record(cwd, { type: 'headMove', label: `Rebase на ${p.ref}`, ...res });
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

async function runAction(cwd, name, payload = {}) {
  const action = ACTIONS[name];
  if (!action) throw new GitError(`Неизвестное действие: ${name}`, { code: 'BAD_ARGS' });
  return action(cwd, payload ?? {});
}

module.exports = { runAction, historySummary, checkAccess, networkOptions };
