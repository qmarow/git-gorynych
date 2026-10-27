// Pre-commit Guard: перед коммитом пробегаем по добавленным строкам staged-изменений и ищем забытые
// отладочные вызовы и похожие на секреты строки. Правила приходят из настроек (их можно отключать и дополнять).
const { git } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const MAX_LINE = 4000; // минифицированные файлы: проверяем только начало строки
const MAX_FINDINGS = 300;
const IGNORE_MARK = /gorynych-ignore|gitidea-ignore|guard-ignore/i;

function compile(rules) {
  const ok = [];
  const invalid = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r.pattern !== 'string' || !r.pattern) continue;
    try {
      const flags = String(r.flags ?? '').replace(/[^imsu]/g, '');
      const exts = String(r.files ?? '')
        .split(/[,\s]+/)
        .map((x) => x.trim().replace(/^\*?\./, '').toLowerCase())
        .filter(Boolean);
      ok.push({ ...r, re: new RegExp(r.pattern, flags), exts });
    } catch (error) {
      invalid.push({ id: r.id, label: r.label, error: error.message });
    }
  }
  return { ok, invalid };
}

const extOf = (file) => {
  const name = file.split('/').pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : name.toLowerCase();
};

// glob → RegExp: ** — любые папки, * — любые символы кроме /, ? — один символ.
// Шаблон без «/» относится к имени файла в любой папке (*.md), с «/» — к пути от корня репозитория.
function globToRe(glob) {
  let g = String(glob).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!g) return null;
  const anywhere = !g.includes('/');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${re}$`, 'i');
}

function excluder(globs) {
  const res = (Array.isArray(globs) ? globs : []).map(globToRe).filter(Boolean);
  return (file) => res.some((re) => re.test(file));
}

const RANK = { block: 2, warn: 1 };

// Секреты в списке показываем замаскированными
function mask(text) {
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 4)}${'•'.repeat(Math.min(12, text.length - 6))}${text.slice(-2)}`;
}

function scanDiff(diff, rules, exclude = []) {
  const { ok, invalid } = compile(rules);
  const isExcluded = excluder(exclude);
  let skipped = 0;
  const findings = [];
  let file = null;
  let line = 0;
  let addedLines = 0;
  const files = new Set();
  let truncated = false;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = null;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '').replace(/^"b\//, '').replace(/"$/, '');
      if (file && isExcluded(file)) {
        skipped++;
        file = null;
      }
      if (file) files.add(file);
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('Binary files ')) continue;
    if (raw.startsWith('@@ ')) {
      const m = /\+(\d+)/.exec(raw);
      line = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+')) {
      addedLines++;
      const text = raw.slice(1).replace(/\r$/, '');
      if (!IGNORE_MARK.test(text)) {
        const sample = text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text;
        const ext = extOf(file);
        // На строку — одна находка: самое строгое из сработавших правил (при равенстве — первое по списку)
        let best = null;
        for (const r of ok) {
          if (r.exts.length && !r.exts.includes(ext)) continue;
          const m = r.re.exec(sample);
          if (!m) continue;
          const rank = RANK[r.level] ?? 1;
          if (!best || rank > best.rank) best = { r, m, rank };
          if (rank === 2) break;
        }
        if (best) {
          const { r, m } = best;
          const shown = sample.trim().slice(0, 240);
          const matchText = m[0];
          const offset = sample.length - sample.trimStart().length;
          const start = m.index - offset;
          let end = start + matchText.length;
          let display = shown;
          if (r.category === 'secret' && start >= 0 && end <= shown.length) {
            const masked = mask(matchText);
            display = shown.slice(0, start) + masked + shown.slice(end);
            end = start + masked.length;
          }
          findings.push({
            file,
            line,
            rule: r.id,
            label: r.label,
            category: r.category ?? 'other',
            level: r.level === 'block' ? 'block' : 'warn',
            text: display,
            start: Math.max(0, start),
            end: Math.min(display.length, Math.max(0, end)),
          });
          if (findings.length >= MAX_FINDINGS) truncated = true;
        }
      }
      line++;
    } else if (raw.startsWith(' ')) {
      line++;
    }
    if (truncated) break;
  }
  return { findings, invalid, files: files.size, addedLines, truncated, skippedFiles: skipped, blocked: findings.some((f) => f.level === 'block') };
}

/** Проверить staged-изменения (то, что войдёт в коммит) */
async function scanStaged(cwd, { rules, exclude }) {
  const started = Date.now();
  let diff;
  try {
    diff = await git(cwd, ['diff', '--cached', '--no-color', '--no-ext-diff', '-U0', '--diff-filter=ACMR']);
  } catch (error) {
    if (/unknown revision|ambiguous argument 'HEAD'/i.test(`${error.details}`)) diff = ''; // первый коммит без HEAD
    else throw error;
  }
  if (typeof diff !== 'string') throw new GitError('Не удалось прочитать изменения', { code: 'GIT' });
  return { ...scanDiff(diff, rules, exclude), ms: Date.now() - started };
}

module.exports = { scanStaged, scanDiff, globToRe };
