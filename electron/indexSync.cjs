// Синхронизация индекса с правками, сделанными в других программах (WebStorm, VS Code, терминал).
//
// Проблема: файл добавлен в индекс (staged), а потом во внешней IDE изменён или откатан к HEAD.
// Git честно показывает две версии: старую в индексе и новую в рабочей папке, — и проверка
// перед коммитом продолжает ругаться на старую (застейдженную) версию, которой на диске уже нет.
//
// Что делаем после каждого изменения файлов:
//  1. Файл на диске снова совпадает с HEAD, а в индексе осталась правка → git reset -- <file>:
//     изменение исчезает целиком — и из Staged, и из Unstaged.
//     Так же для «удалён в индексе, но файл вернули на место» и «новый файл добавлен, а потом удалён».
//  2. Файл был застейджен целиком (рабочая копия = индекс), а затем его поправили снаружи →
//     git add <file>: в индексе — актуальная версия, а не устаревшая копия.
//     Частично застейдженные файлы (stage по кускам) не трогаем: там расхождение — намеренное.
//
// Ничего не делаем во время merge/rebase/cherry-pick и пока идёт действие пользователя.
const fs = require('node:fs');
const path = require('node:path');
const { git, detectOperation } = require('./git.cjs');
const { runBackground } = require('./actions.cjs');

const snapshots = new Map(); // root → Map(path → 'XY') — статус после прошлой проверки

function parseStatus(out) {
  const entries = new Map();
  const untracked = new Set();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') {
      i++; // исходный путь переименования — переименования не трогаем
      continue;
    }
    if (xy === '??') untracked.add(file);
    else entries.set(file, xy);
  }
  return { entries, untracked };
}

async function blobOfHead(root, file) {
  return (await git(root, ['rev-parse', '-q', '--verify', `HEAD:${file}`]).catch(() => '')).trim() || null;
}

/** Хэш файла на диске так, как его сохранил бы git (с учётом autocrlf и фильтров) */
async function blobOfWorktree(root, file) {
  if (!fs.existsSync(path.join(root, file))) return null;
  return (await git(root, ['hash-object', '--', file]).catch(() => '')).trim() || null;
}

/**
 * Решает, что сделать с каждым файлом. Чистая функция — удобно тестировать.
 * entries: Map(path → XY), prev: Map(path → XY) | null, untracked: Set(path)
 * → [{ file, kind: 'compare-reset' | 'reset' | 'add-or-reset' }]
 */
function plan(entries, untracked, prev) {
  const todo = [];
  for (const [file, xy] of entries) {
    const [x, y] = xy;
    if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') continue; // конфликт — не наше дело
    if ((x === 'M' || x === 'T') && (y === 'M' || y === 'T')) {
      // Правка в индексе и другая правка на диске: откат к HEAD или новая версия целиком застейдженного файла
      const wasFullyStaged = prev?.get(file)?.[1] === ' ' && prev.get(file)[0] !== ' ';
      todo.push({ file, kind: wasFullyStaged ? 'add-or-reset' : 'compare-reset' });
    } else if (x === 'A' && y === 'M') {
      const wasFullyStaged = prev?.get(file) === 'A ';
      if (wasFullyStaged) todo.push({ file, kind: 'add' });
    } else if (x === 'A' && y === 'D') {
      todo.push({ file, kind: 'reset' }); // новый файл добавили в индекс, а потом удалили — убрать из индекса
    } else if (x === 'D' && y === ' ' && untracked.has(file)) {
      todo.push({ file, kind: 'compare-reset' }); // удаление застейджено, но файл вернули на место
    }
  }
  return todo;
}

async function statusOf(root) {
  return parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
}

/**
 * act=false — только запомнить статус (например, после изменений в .git: stage/unstage из программы).
 * act=true — после изменения рабочих файлов: синхронизировать индекс.
 * → { synced: [{ file, action: 'reset' | 'add' }] } или null, если репозиторий занят
 */
async function syncIndex(root, { act = true } = {}) {
  const job = runBackground(root, async () => {
    const before = await statusOf(root);
    const prev = snapshots.get(root) ?? null;
    snapshots.set(root, before.entries);
    if (!act || (await detectOperation(root))) return { synced: [] };

    const todo = plan(before.entries, before.untracked, prev);
    if (!todo.length) return { synced: [] };

    const hasHead = Boolean((await git(root, ['rev-parse', '-q', '--verify', 'HEAD']).catch(() => '')).trim());
    const toReset = [];
    const toAdd = [];
    for (const { file, kind } of todo) {
      if (kind === 'reset') {
        toReset.push(file);
        continue;
      }
      if (kind === 'add') {
        toAdd.push(file);
        continue;
      }
      const head = hasHead ? await blobOfHead(root, file) : null;
      const disk = await blobOfWorktree(root, file);
      if (head && disk && head === disk) toReset.push(file); // на диске снова версия из HEAD
      else if (kind === 'add-or-reset' && disk) toAdd.push(file);
    }

    const synced = [];
    if (toReset.length) {
      if (hasHead) await git(root, ['reset', '-q', 'HEAD', '--', ...toReset]);
      else await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', ...toReset]);
      synced.push(...toReset.map((file) => ({ file, action: 'reset' })));
    }
    if (toAdd.length) {
      await git(root, ['add', '--', ...toAdd]);
      synced.push(...toAdd.map((file) => ({ file, action: 'add' })));
    }
    if (synced.length) snapshots.set(root, (await statusOf(root)).entries);
    return { synced };
  });
  if (!job) return null;
  return job;
}

function forget(root) {
  snapshots.delete(root);
}

module.exports = { syncIndex, plan, parseStatus, forget };
