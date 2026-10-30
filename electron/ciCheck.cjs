// Проверка конфигурации CI/CD: собирает проблемы всех проверок в один список.
// Результат: { issues: [{ id, severity, title, when, how, why, fix, file, line, job, scenario }], scenarios, stats }.
const { Positions, repoIndex, defaultBranch } = require('./ciCheckBase.cjs');
const { git } = require('./git.cjs');
const { checkGitlab } = require('./ciCheckGitlab.cjs');
const { checkGithub, checkBitbucket, checkJenkins, checkCircle, checkAzure } = require('./ciCheckOther.cjs');

const ORDER = { error: 0, warning: 1, info: 2 };

async function branchSet(root) {
  const out = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).catch(() => '');
  const set = new Set();
  for (const line of out.split('\n')) {
    const ref = line.trim();
    if (!ref || ref.endsWith('/HEAD')) continue;
    if (ref.startsWith('refs/heads/')) set.add(ref.slice(11));
    else if (ref.startsWith('refs/remotes/')) set.add(ref.slice(13).replace(/^[^/]+\//, ''));
  }
  return set;
}

async function checkCi(root, systemId, result) {
  const issues = [];
  const seen = new Set();
  const add = (issue) => {
    const key = `${issue.id}|${issue.file}|${issue.line}|${issue.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ severity: 'warning', file: null, line: null, job: null, scenario: null, ...issue });
  };
  const started = Date.now();

  // Ошибки синтаксиса YAML — первыми: из-за них остальное может не читаться
  for (const e of result.errors ?? []) {
    add({
      id: e.severity === 'error' ? 'yaml-syntax' : 'yaml-warning',
      severity: e.severity === 'error' ? 'error' : 'warning',
      title: e.severity === 'error' ? `Ошибка синтаксиса YAML: ${e.message}` : e.message,
      when: 'Сразу при push — файл не читается',
      how: e.severity === 'error' ? 'Сервер CI не сможет прочитать файл и не запустит ни одного задания.' : 'Файл прочитается, но, возможно, не так, как задумано.',
      why: e.severity === 'error' ? 'Нарушена структура YAML: отступы, двоеточия, кавычки или табуляция вместо пробелов.' : 'Неоднозначная запись в YAML.',
      fix: 'Проверьте отступы (только пробелы, одинаковое число на уровне) и кавычки вокруг строк с «: » или «#».',
      file: e.file,
      line: e.line,
    });
  }

  let scenarios = [];
  let defBranch = null;
  try {
    const repo = await repoIndex(root);
    const pos = new Positions(result.files ?? []);
    const ctx = { pos, repo, add };
    if (systemId === 'gitlab' && result._raw) {
      const [def, branches] = await Promise.all([defaultBranch(root), branchSet(root)]);
      defBranch = def;
      ({ scenarios } = checkGitlab(result, { ...ctx, defBranch: def, branches }));
    } else if (systemId === 'github') checkGithub(result, ctx);
    else if (systemId === 'bitbucket') checkBitbucket(result, ctx);
    else if (systemId === 'jenkins') checkJenkins(result, ctx);
    else if (systemId === 'circleci') checkCircle(result, ctx);
    else if (systemId === 'azure') checkAzure(result, ctx);
  } catch (error) {
    add({ id: 'check-failed', severity: 'info', title: 'Проверка прервалась', when: '—', how: 'Часть проверок не выполнена.', why: String(error?.message ?? error), fix: 'Сообщите об ошибке — проверка конфигурации не должна падать.' });
  }
  // Предупреждения разбора, которые проверки не покрывают (для систем без подробной проверки)
  if (!['gitlab', 'github', 'bitbucket', 'jenkins'].includes(systemId)) {
    for (const w of result.warnings ?? []) add({ id: 'loader-warning', severity: 'warning', title: w, when: '—', how: 'Схема пайплайна может быть показана неполно.', why: w, fix: 'Проверьте файл.', file: result.files?.[0]?.path ?? null });
  }

  issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0));
  const stats = { error: 0, warning: 0, info: 0 };
  for (const i of issues) stats[i.severity] += 1;
  return { issues, scenarios, stats, defaultBranch: defBranch, ms: Date.now() - started };
}

module.exports = { checkCi };
