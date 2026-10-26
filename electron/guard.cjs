// Pre-commit Guard: перед коммитом пробегаем по добавленным строкам staged-изменений и ищем забытые
// отладочные вызовы и похожие на секреты строки. Правила приходят из настроек (их можно отключать и дополнять).
const { git } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const MAX_LINE = 4000; // минифицированные файлы: проверяем только начало строки
const MAX_FINDINGS = 300;
const IGNORE_MARK = /gitidea-ignore|guard-ignore/i;

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

// Секреты в списке показываем замаскированными
function mask(text) {
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 4)}${'•'.repeat(Math.min(12, text.length - 6))}${text.slice(-2)}`;
}

function scanDiff(diff, rules) {
  const { ok, invalid } = compile(rules);
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
        for (const r of ok) {
          if (r.exts.length && !r.exts.includes(ext)) continue;
          const m = r.re.exec(sample);
          if (!m) continue;
          const shown = sample.trim().slice(0, 240);
          const matchText = m[0];
          const offset = sample.length - sample.trimStart().length;
          let start = m.index - offset;
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
            text: display,
            start: Math.max(0, start),
            end: Math.min(display.length, Math.max(0, end)),
          });
          if (findings.length >= MAX_FINDINGS) {
            truncated = true;
            break;
          }
          break; // одна находка на строку — самое важное правило (порядок в списке)
        }
      }
      line++;
    } else if (raw.startsWith(' ')) {
      line++;
    }
    if (truncated) break;
  }
  return { findings, invalid, files: files.size, addedLines, truncated };
}

/** Проверить staged-изменения (то, что войдёт в коммит) */
async function scanStaged(cwd, { rules }) {
  const started = Date.now();
  let diff;
  try {
    diff = await git(cwd, ['diff', '--cached', '--no-color', '--no-ext-diff', '-U0', '--diff-filter=ACMR']);
  } catch (error) {
    if (/unknown revision|ambiguous argument 'HEAD'/i.test(`${error.details}`)) diff = ''; // первый коммит без HEAD
    else throw error;
  }
  if (typeof diff !== 'string') throw new GitError('Не удалось прочитать изменения', { code: 'GIT' });
  return { ...scanDiff(diff, rules), ms: Date.now() - started };
}

module.exports = { scanStaged, scanDiff };
