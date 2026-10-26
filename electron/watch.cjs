// Слежение за репозиторием: изменения в .git (коммиты, ветки, stash, fetch) и в рабочих файлах.
const fs = require('node:fs');
const path = require('node:path');

// Что в рабочей папке не влияет на граф/статус или меняется слишком часто
const IGNORED_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache', 'dist', 'build', 'out', 'target', 'bin', 'obj']);

function classify(rel) {
  if (!rel) return 'worktree';
  const parts = rel.split(/[\\/]/);
  if (parts[0] === '.git') {
    const sub = parts[1];
    // Объекты, временные lock-файлы и служебное — шум; сами изменения видны по refs/HEAD/index
    if (!sub || sub === 'objects' || sub === 'lfs' || rel.endsWith('.lock') || sub === 'fsmonitor--daemon') return null;
    if (sub === 'logs' || sub === 'COMMIT_EDITMSG' || sub === 'gk' ) return null;
    return 'git';
  }
  if (parts.some((p) => IGNORED_DIRS.has(p))) return null;
  return 'worktree';
}

/**
 * Следит за папкой репозитория и вызывает onChange({ git, worktree }) не чаще, чем раз в delay мс.
 * Возвращает функцию остановки.
 */
function watchRepository(root, onChange, { delay = 700 } = {}) {
  let timer = null;
  let pending = { git: false, worktree: false };
  const flush = () => {
    timer = null;
    const what = pending;
    pending = { git: false, worktree: false };
    onChange(what);
  };
  const handler = (_event, file) => {
    const kind = classify(file ? String(file) : '');
    if (!kind) return;
    pending[kind] = true;
    if (!timer) timer = setTimeout(flush, delay);
  };

  const watchers = [];
  try {
    // recursive поддерживается на Windows и macOS, в Node 20+ — и на Linux
    watchers.push(fs.watch(root, { recursive: true }, handler));
  } catch {
    // Запасной вариант: следим хотя бы за .git (коммиты, ветки, FETCH_HEAD) и корнем проекта.
    // refs/remotes/<remote> — чтобы fetch/pull из внешнего терминала сразу обновлял бейджи ↓/↑
    const refsRemotes = path.join(root, '.git', 'refs', 'remotes');
    let remoteDirs = [];
    try {
      remoteDirs = fs.readdirSync(refsRemotes, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(refsRemotes, d.name));
    } catch {
      /* remote ещё нет */
    }
    for (const dir of [root, path.join(root, '.git'), path.join(root, '.git', 'refs', 'heads'), refsRemotes, ...remoteDirs]) {
      try {
        const prefix = path.relative(root, dir);
        watchers.push(fs.watch(dir, (e, f) => handler(e, f ? path.join(prefix, String(f)) : prefix)));
      } catch {
        /* папки может не быть */
      }
    }
  }
  for (const w of watchers) w.on('error', () => {});

  return () => {
    clearTimeout(timer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* уже закрыт */
      }
    }
  };
}

module.exports = { watchRepository, classify };
