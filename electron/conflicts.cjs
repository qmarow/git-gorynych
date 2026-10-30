// Разрешение конфликтов слияния: разбор файла с маркерами, подписи сторон, сохранение результата.
const fs = require('node:fs');
const path = require('node:path');
const { git, resolveRepoRoot, safeRelative, detectOperation } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

/* ---------------- Кто есть «моё» и «их» ---------------- */

async function revInfo(cwd, ref) {
  const hash = (await git(cwd, ['rev-parse', '--verify', '--quiet', ref]).catch(() => '')).trim();
  if (!hash) return null;
  const subject = (await git(cwd, ['log', '-1', '--format=%s', hash]).catch(() => '')).trim();
  const name = (
    await git(cwd, ['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', '--refs=refs/remotes/*', hash]).catch(() => '')
  )
    .trim()
    .replace(/~\d+$|\^\d+$/, '');
  return { hash, short: hash.slice(0, 7), subject, name: name || null };
}

async function currentBranch(cwd) {
  return (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null;
}

// Во время rebase стороны «перевёрнуты»: ours — то, НА что перебазируем, theirs — ваш коммит
async function sideLabels(cwd) {
  const op = await detectOperation(cwd);
  const head = await revInfo(cwd, 'HEAD');
  if (op === 'merge') {
    const other = await revInfo(cwd, 'MERGE_HEAD');
    return {
      operation: op,
      ours: { title: 'Моё', sub: (await currentBranch(cwd)) ?? head?.short ?? 'HEAD', hint: 'Ваша текущая ветка' },
      theirs: { title: 'Их', sub: other?.name ?? other?.short ?? 'MERGE_HEAD', hint: other ? `Вливаемая ветка · «${other.subject}»` : 'Вливаемая ветка' },
    };
  }
  if (op === 'rebase') {
    const mine = await revInfo(cwd, 'REBASE_HEAD');
    return {
      operation: op,
      ours: { title: 'Их', sub: head?.name ?? head?.short ?? 'upstream', hint: 'Ветка, на которую вы перебазируете (уже на сервере / в upstream)' },
      theirs: { title: 'Моё', sub: mine ? `${mine.short} · ${mine.subject}` : 'ваш коммит', hint: 'Ваш коммит, который сейчас переносится' },
      swapped: true,
    };
  }
  if (op === 'cherry-pick' || op === 'revert') {
    const pick = await revInfo(cwd, op === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD');
    return {
      operation: op,
      ours: { title: 'Моё', sub: (await currentBranch(cwd)) ?? head?.short ?? 'HEAD', hint: 'Ваша текущая ветка' },
      theirs: {
        title: op === 'cherry-pick' ? 'Переносимый коммит' : 'Отмена коммита',
        sub: pick ? `${pick.short} · ${pick.subject}` : '',
        hint: op === 'cherry-pick' ? 'Изменения из cherry-pick' : 'Изменения revert',
      },
    };
  }
  // Конфликт после stash apply/pop: операции нет, но в индексе есть конфликтующие файлы
  return {
    operation: null,
    ours: { title: 'Текущее', sub: (await currentBranch(cwd)) ?? 'рабочая версия', hint: 'Файл до применения stash' },
    theirs: { title: 'Из stash', sub: 'спрятанные изменения', hint: 'Изменения из stash' },
  };
}

/* ---------------- Разбор маркеров ---------------- */

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: (.*))?$/;
const SEP = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

function parseConflictText(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = /\r?\n$/.test(text);
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const segments = [];
  let common = [];
  let block = null;
  let part = null;
  let lineNo = 0;
  const flushCommon = () => {
    if (common.length) segments.push({ type: 'common', lines: common });
    common = [];
  };
  for (const line of lines) {
    lineNo++;
    if (!block) {
      const m = START.exec(line);
      if (m) {
        flushCommon();
        block = { type: 'conflict', ours: [], base: null, theirs: [], oursLabel: m[1] ?? '', theirsLabel: '', baseLabel: '', startLine: lineNo };
        part = 'ours';
        continue;
      }
      common.push(line);
      continue;
    }
    if (part === 'ours' && BASE.test(line)) {
      block.base = [];
      block.baseLabel = BASE.exec(line)[1] ?? '';
      part = 'base';
      continue;
    }
    if ((part === 'ours' || part === 'base') && SEP.test(line)) {
      part = 'theirs';
      continue;
    }
    if (part === 'theirs' && END.test(line)) {
      block.theirsLabel = END.exec(line)[1] ?? '';
      block.endLine = lineNo;
      segments.push(block);
      block = null;
      part = null;
      continue;
    }
    block[part].push(line);
  }
  // Незакрытый блок — считаем текст обычным, чтобы ничего не потерять
  if (block) {
    common.push(`<<<<<<< ${block.oursLabel}`, ...block.ours, ...(block.base ? ['|||||||', ...block.base] : []), '=======', ...block.theirs);
  }
  flushCommon();
  return { segments, eol, finalNewline, conflicts: segments.filter((s) => s.type === 'conflict').length };
}

/* ---------------- Публичное API ---------------- */

async function stagesOf(cwd, file) {
  const out = await git(cwd, ['ls-files', '-u', '-z', '--', file]);
  const stages = {};
  for (const entry of out.split('\0').filter(Boolean)) {
    const m = /^(\d+) ([0-9a-f]+) (\d)\t/.exec(entry);
    if (m) stages[m[3]] = { mode: m[1], hash: m[2] };
  }
  return stages;
}

async function getConflict(dir, file) {
  const root = await resolveRepoRoot(dir);
  const full = safeRelative(root, file);
  const stages = await stagesOf(root, file);
  const labels = await sideLabels(root);
  const base = { path: file, labels, stages: Object.keys(stages) };

  if (!stages['2'] && !stages['3']) {
    if (!Object.keys(stages).length) return { ...base, kind: 'resolved' };
    return { ...base, kind: 'both-deleted' };
  }
  // keepSide — с какой стороны файл остался (для кнопки «Оставить файл»)
  if (!stages['2']) return { ...base, kind: 'deleted', deletedSide: 'ours', keepSide: 'theirs', exists: fs.existsSync(full) };
  if (!stages['3']) return { ...base, kind: 'deleted', deletedSide: 'theirs', keepSide: 'ours', exists: fs.existsSync(full) };

  if (!fs.existsSync(full)) return { ...base, kind: 'no-markers', exists: false };
  const buf = fs.readFileSync(full);
  if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: 'binary' };
  const parsed = parseConflictText(buf.toString('utf8'));
  if (parsed.conflicts === 0) return { ...base, kind: 'no-markers', exists: true };
  return { ...base, kind: 'text', ...parsed };
}

async function saveResolution(dir, { path: file, content }) {
  if (typeof content !== 'string') throw new GitError('Нет содержимого', { code: 'BAD_ARGS' });
  const root = await resolveRepoRoot(dir);
  const full = safeRelative(root, file);
  if (/^(<{7}|>{7})( |$)/m.test(content)) {
    throw new GitError('В результате остались маркеры конфликта', { code: 'MARKERS_LEFT', hint: 'Решите все блоки конфликта.' });
  }
  fs.writeFileSync(full, content, 'utf8');
  await git(root, ['add', '--', file]);
  return { path: file };
}

// Взять файл целиком с одной стороны или удалить его. side: 'ours' | 'theirs' | 'delete'
async function resolveWhole(dir, { path: file, side }) {
  const root = await resolveRepoRoot(dir);
  safeRelative(root, file);
  const stages = await stagesOf(root, file);
  if (side === 'delete') {
    await git(root, ['rm', '-q', '--force', '--', file]);
    return { path: file, side };
  }
  if (side !== 'ours' && side !== 'theirs') throw new GitError('Некорректная сторона', { code: 'BAD_ARGS' });
  const stage = side === 'ours' ? '2' : '3';
  if (!stages[stage]) {
    // С этой стороны файл удалён — выбрать её значит удалить файл
    await git(root, ['rm', '-q', '--force', '--', file]);
    return { path: file, side: 'delete' };
  }
  await git(root, ['checkout', `--${side}`, '--', file]);
  await git(root, ['add', '--', file]);
  return { path: file, side };
}

async function markResolved(dir, { path: file, force = false }) {
  const root = await resolveRepoRoot(dir);
  const full = safeRelative(root, file);
  if (!fs.existsSync(full)) {
    await git(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', file]);
    return { path: file, deleted: true };
  }
  const text = fs.readFileSync(full, 'utf8');
  if (!force && /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text)) {
    throw new GitError('В файле ещё есть маркеры конфликта', {
      code: 'MARKERS_LEFT',
      hint: 'Решите конфликт в редакторе или отметьте принудительно.',
    });
  }
  await git(root, ['add', '--', file]);
  return { path: file };
}

module.exports = { getConflict, saveResolution, resolveWhole, markResolved, parseConflictText };
