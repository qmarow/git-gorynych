// Эталон git.cjs: прогоняет настоящий модуль на настоящих репозиториях. Rust (tests/git_parity.rs) строит такие же и обязан дать то же.
//   node crates/gorynych-git/tests/fixtures/gen-git-parity.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../../..');
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Автор',
  GIT_AUTHOR_EMAIL: 'a@x',
  GIT_COMMITTER_NAME: 'Автор',
  GIT_COMMITTER_EMAIL: 'a@x',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
  // Файла нет: git считает конфигурацию пустой. NUL на Windows git не открывает
  GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'gorynych-no-gitconfig'),
  GIT_EDITOR: 'true',
});
const gitModule = require(path.join(repoRoot, 'electron/git.cjs'));
const conflicts = require(path.join(repoRoot, 'electron/conflicts.cjs'));
const history = require(path.join(repoRoot, 'electron/fileHistory.cjs'));
const compare = require(path.join(repoRoot, 'electron/compare.cjs'));
const i18n = require(path.join(repoRoot, 'electron/i18n.cjs'));
const { CASES } = require('./git-cases.cjs');

const run = (cwd, args, allowFail = false) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

function prepare(testCase, tmp, root) {
  if (!testCase.noGit) run(root, ['init', '-q', '-b', 'main']);
  for (const [op, ...args] of testCase.setup) {
    const full = (rel) => path.join(root, rel);
    const ensure = (rel) => fs.mkdirSync(path.dirname(full(rel)), { recursive: true });
    if (op === 'git') run(root, args);
    else if (op === 'gitFail') run(root, args, true);
    else if (op === 'gitIn') run(path.join(root, args[0]), args.slice(1));
    else if (op === 'write') {
      ensure(args[0]);
      fs.writeFileSync(full(args[0]), args[1]);
    } else if (op === 'writeBytes') {
      ensure(args[0]);
      fs.writeFileSync(full(args[0]), Buffer.from(args[1]));
    } else if (op === 'writeRepeat') {
      ensure(args[0]);
      fs.writeFileSync(full(args[0]), args[1].repeat(args[2]));
    } else if (op === 'writeMany') {
      fs.mkdirSync(full(args[0]), { recursive: true });
      for (let i = 0; i < args[1]; i++) fs.writeFileSync(path.join(full(args[0]), `f${String(i).padStart(4, '0')}.txt`), 'a\nb\n');
    } else if (op === 'rm') fs.rmSync(full(args[0]));
    else throw new Error(`нет операции ${op}`);
  }
}

function call(step, root) {
  const g = gitModule;
  switch (step.call) {
    case 'root':
      return g.resolveRepoRoot(root);
    case 'hasHead':
      return g.hasHead(root);
    case 'op':
      return g.detectOperation(root);
    case 'refs':
      return g.readRefs(root);
    case 'load':
      return g.loadRepository(root, step.limit ? { limit: step.limit } : {});
    case 'quick':
      return g.quickStatus(root);
    case 'status':
      return g.readStatus(root, { stats: Boolean(step.stats) });
    case 'commitFiles':
      return g.getCommitFiles(root, step.hash, step.parent);
    case 'stash':
      return g.getStashDetails(root, step.hash);
    case 'fileDiff':
      return g.getFileDiff(root, step.params);
    case 'stage':
      return g.stage(root, step.paths);
    case 'unstage':
      return g.unstage(root, step.paths);
    case 'commit':
      return g.commit(root, step.summary, step.description);
    case 'template':
      return g.readCommitTemplate(root);
    case 'configThenTemplate':
      run(root, ['config', step.key, step.value]);
      run(root, ['config', 'commit.template', step.file]);
      return g.readCommitTemplate(root);
    case 'branchLog':
      return g.branchLog(root, step.params);
    case 'getConflict':
      return conflicts.getConflict(root, step.file);
    case 'parseConflict':
      return conflicts.parseConflictText(step.text);
    case 'saveResolution':
      return conflicts.saveResolution(root, step.params);
    case 'resolveWhole':
      return conflicts.resolveWhole(root, step.params);
    case 'markResolved':
      return conflicts.markResolved(root, step.params);
    case 'fileHistory':
      return history.fileHistory(root, step.params);
    case 'blame':
      return history.blame(root, step.params);
    case 'commitInfo':
      return history.commitInfo(root, step.params);
    case 'compare':
      return compare.compareCommits(root, step.params);
    case 'searchChanges':
      return compare.searchChanges(root, step.params);
    case 'searchHistory':
      return compare.searchHistory(root, step.params);
    case 'parseDiff':
      return g.parseUnifiedDiff(step.text);
    case 'parseNumstat':
      return Object.fromEntries(g.parseNumstat(step.text));
    case 'cleanTemplate':
      return g.cleanCommitTemplate(step.text, step.comment);
    default:
      throw new Error(`нет вызова ${step.call}`);
  }
}

async function runCase(testCase, language) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-parity-'));
  const root = path.join(tmp, 'репо');
  fs.mkdirSync(root);
  i18n.setLanguage(language);
  prepare(testCase, tmp, root);
  fs.mkdirSync(path.join(root, 'папка'), { recursive: true });
  const expected = [];
  for (const step of testCase.steps) {
    const args = JSON.parse(JSON.stringify(step).replace(/\{\{rev:([^"]*?)\}\}/g, (_, rev) => run(root, ['rev-parse', rev]).trim()));
    let out;
    try {
      const value = await call(args, root);
      out = { ok: value === undefined ? null : value };
    } catch (error) {
      out = { error: { code: error.code && /^[A-Z_]+$/.test(error.code) && error.toJSON ? error.code : 'UNKNOWN', message: error.message, hint: error.hint ?? null, details: error.details ?? '' } };
    }
    const text = JSON.stringify(out)
      .replaceAll(JSON.stringify(tmp).slice(1, -1), '{{TMP}}')
      .replaceAll(tmp.replaceAll('\\', '/'), '{{TMP}}');
    expected.push(JSON.parse(text));
  }
  // На Windows файл бывает ещё занят: мусор во временной папке не повод ронять генератор
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* оставляем */
  }
  return expected;
}

async function main() {
  const cases = [];
  for (const testCase of CASES) {
    for (const language of ['ru', 'en']) cases.push({ ...testCase, language, expected: await runCase(testCase, language) });
  }
  fs.writeFileSync(path.join(__dirname, 'git-parity.json'), `${JSON.stringify({ cases })}\n`);
  console.log(`сценариев ${cases.length}, шагов ${cases.reduce((n, c) => n + c.expected.length, 0)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
