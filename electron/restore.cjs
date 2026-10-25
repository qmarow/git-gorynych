// Откат файла или отдельного фрагмента (hunk) без коммита: меняется только рабочая папка (или индекс),
// история не трогается. Перед изменением рабочего файла запоминаем его содержимое — для Undo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, resolveRepoRoot, safeRelative, HASH_RE } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const MAX_SNAPSHOT = 20 * 1024 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function readFileOrNull(full) {
  try {
    return fs.readFileSync(full);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function requireHash(hash) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
}

async function firstParent(cwd, hash) {
  const out = (await git(cwd, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ');
  return out[1] ?? null;
}

async function existsIn(cwd, rev, file) {
  return git(cwd, ['cat-file', '-e', `${rev}:${file}`]).then(() => true, () => false);
}

// Снимок «до/после» для Undo; слишком большие файлы не запоминаем
function snapshot(root, file, before) {
  const full = safeRelative(root, file);
  const after = readFileOrNull(full);
  const size = Math.max(before?.length ?? 0, after?.length ?? 0);
  return size > MAX_SNAPSHOT ? null : { path: file, before, after };
}

/* ---------------- Весь файл ---------------- */

/**
 * Вернуть файл в рабочей папке к версии из коммита.
 * side: 'after' — как в самом коммите, 'before' — как было до него (в первом родителе).
 * Если в той версии файла нет — файл удаляется из рабочей папки.
 */
async function restoreFile(cwd, { hash, path: file, side = 'after' }) {
  requireHash(hash);
  const root = await resolveRepoRoot(cwd);
  const full = safeRelative(root, file);
  const source = side === 'before' ? await firstParent(root, hash) : hash;
  const before = readFileOrNull(full);
  const present = source ? await existsIn(root, source, file) : false;

  if (present) {
    await git(root, ['restore', `--source=${source}`, '--worktree', '--', file]);
  } else if (before !== null) {
    fs.rmSync(full, { force: true });
  } else {
    throw new GitError('Файла нет ни в рабочей папке, ни в той версии — менять нечего', { code: 'UP_TO_DATE' });
  }
  const snap = snapshot(root, file, before);
  if (snap && snap.before && snap.after && snap.before.equals(snap.after)) {
    throw new GitError('Файл уже совпадает с этой версией', { code: 'UP_TO_DATE' });
  }
  return { path: file, source: source ?? EMPTY_TREE, side, deleted: !present, snapshot: snap };
}

/* ---------------- Фрагменты (hunks) ---------------- */

// Заголовок фрагмента без описания функции: «@@ -10,4 +10,6 @@»
const hunkKey = (header) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(String(header).trim())?.[0] ?? null;

function splitHunks(diff) {
  const lines = diff.split('\n');
  const hunks = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      cur = { key: hunkKey(line), lines: [line] };
      hunks.push(cur);
    } else if (cur && (line[0] === ' ' || line[0] === '+' || line[0] === '-' || line[0] === '\\' || line === '')) {
      if (line === '' && cur.lines.at(-1) === '') continue;
      cur.lines.push(line);
    } else if (cur && line.startsWith('diff --git')) {
      cur = null;
    }
  }
  for (const h of hunks) while (h.lines.at(-1) === '') h.lines.pop();
  return hunks;
}

// Патч только из выбранных фрагментов, с простым заголовком на текущий путь
function buildPatch(file, hunks) {
  const name = file.replace(/\\/g, '/');
  return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${hunks.map((h) => h.lines.join('\n')).join('\n')}\n`;
}

async function rawDiff(root, { mode, hash, file, oldPath }) {
  const paths = ['--', ...(oldPath && oldPath !== file ? [oldPath] : []), file];
  const base = ['--no-color', '--no-ext-diff', '-U3'];
  if (mode === 'commit') {
    requireHash(hash);
    const parent = (await firstParent(root, hash)) ?? EMPTY_TREE;
    return git(root, ['diff', ...base, '-M', parent, hash, ...paths]);
  }
  if (mode === 'staged') return git(root, ['diff', '--cached', ...base, ...paths]);
  if (mode === 'unstaged') return git(root, ['diff', ...base, ...paths]);
  throw new GitError('Неизвестный режим', { code: 'BAD_ARGS' });
}

async function applyPatch(root, patch, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-patch-'));
  const file = path.join(dir, 'hunk.patch');
  fs.writeFileSync(file, patch);
  try {
    await git(root, ['apply', '--whitespace=nowarn', ...args, file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const OPS = {
  // Отменить фрагмент коммита в рабочей папке (обратный патч)
  revert: { modes: ['commit'], args: ['-R'], worktree: true },
  // Выбросить незакоммиченный фрагмент
  discard: { modes: ['unstaged'], args: ['-R'], worktree: true },
  // Добавить фрагмент в индекс / убрать из индекса
  stage: { modes: ['unstaged'], args: ['--cached'], worktree: false },
  unstage: { modes: ['staged'], args: ['-R', '--cached'], worktree: false },
};

/**
 * hunks: список заголовков «@@ -a,b +c,d @@» выбранных фрагментов; пусто/не задано — все фрагменты файла.
 */
async function applyHunks(cwd, { op, mode, hash, path: file, oldPath, hunks: wanted }) {
  const spec = OPS[op];
  if (!spec || !spec.modes.includes(mode)) throw new GitError('Неизвестное действие с фрагментом', { code: 'BAD_ARGS' });
  const root = await resolveRepoRoot(cwd);
  const full = safeRelative(root, file);
  if (oldPath) safeRelative(root, oldPath);

  const diff = await rawDiff(root, { mode, hash, file, oldPath });
  if (/^Binary files /m.test(diff) || /^GIT binary patch/m.test(diff)) {
    throw new GitError('Бинарный файл — по фрагментам не меняется', {
      code: 'BINARY',
      hint: op === 'revert' ? 'Используйте «Вернуть файл к версии…» для всего файла.' : null,
    });
  }
  const all = splitHunks(diff);
  if (!all.length) throw new GitError('В файле нет изменений', { code: 'UP_TO_DATE' });

  let chosen = all;
  if (Array.isArray(wanted) && wanted.length) {
    const keys = new Set(wanted.map(hunkKey));
    chosen = all.filter((h) => keys.has(h.key));
    if (chosen.length !== keys.size) {
      throw new GitError('Фрагмент не найден — diff изменился', {
        code: 'HUNK_STALE',
        hint: 'Обновите просмотр. Если включено «игнорировать пробелы», выключите его: фрагменты считаются по точному тексту.',
      });
    }
  }

  if (spec.worktree && !fs.existsSync(full)) {
    throw new GitError('Файла нет в рабочей папке', {
      code: 'NOT_FOUND',
      hint: op === 'revert' ? 'Используйте «Вернуть файл к версии до этого коммита» — он создаст файл заново.' : null,
    });
  }
  const before = spec.worktree ? readFileOrNull(full) : null;
  try {
    await applyPatch(root, buildPatch(file, chosen), spec.args);
  } catch (error) {
    if (op === 'revert') {
      throw new GitError('Этот фрагмент уже изменён в рабочей папке — автоматически отменить нельзя', {
        code: 'PATCH_FAILED',
        hint: 'Строки вокруг него поменялись после коммита. Можно вернуть файл целиком к версии до этого коммита.',
        details: error.details,
      });
    }
    throw new GitError('Фрагмент не применяется — файл изменился', { code: 'PATCH_FAILED', hint: 'Обновите просмотр и повторите.', details: error.details });
  }
  return {
    op,
    path: file,
    hunks: chosen.length,
    total: all.length,
    snapshot: spec.worktree ? snapshot(root, file, before) : null,
  };
}

/* ---------------- Undo / Redo снимков рабочих файлов ---------------- */

async function writeSnapshot(cwd, snap, which) {
  const root = await resolveRepoRoot(cwd);
  const full = safeRelative(root, snap.path);
  const expected = which === 'before' ? snap.after : snap.before;
  const current = readFileOrNull(full);
  const same = expected === null ? current === null : current !== null && current.equals(expected);
  if (!same) {
    throw new GitError(`Нельзя отменить: файл ${snap.path} изменился после операции`, {
      code: 'HISTORY_STALE',
      hint: 'Файл правили после отката — верните его вручную или через diff.',
    });
  }
  const data = snap[which];
  if (data === null) fs.rmSync(full, { force: true });
  else {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  }
}

module.exports = { restoreFile, applyHunks, writeSnapshot, hunkKey, splitHunks };
