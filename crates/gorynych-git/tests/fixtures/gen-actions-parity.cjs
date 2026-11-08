// Эталон actions.cjs, rebase.cjs, restore.cjs, init.cjs, clone.cjs: настоящие модули на настоящих репозиториях, сервер — папка.
// Rust (tests/actions_parity.rs) строит такие же репозитории и обязан дать те же ответы и то же состояние git.
//   node crates/gorynych-git/tests/fixtures/gen-actions-parity.cjs
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
  GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'gorynych-no-gitconfig'),
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
});
delete process.env.GIT_SSH_COMMAND;
delete process.env.GIT_SSH;

const actions = require(path.join(repoRoot, 'electron/actions.cjs'));
const rebase = require(path.join(repoRoot, 'electron/rebase.cjs'));
const init = require(path.join(repoRoot, 'electron/init.cjs'));
const cloner = require(path.join(repoRoot, 'electron/clone.cjs'));
const i18n = require(path.join(repoRoot, 'electron/i18n.cjs'));
const { CASES } = require('./actions-cases.cjs');

const run = (cwd, args, allowFail = false) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result;
};

const writeFile = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

function prepare(testCase, tmp, root) {
  if (!testCase.noGit) run(root, ['init', '-q', '-b', 'main']);
  for (const [op, ...args] of testCase.setup) {
    const full = (rel) => path.join(root, rel);
    if (op === 'git') run(root, args);
    else if (op === 'gitIn') run(path.resolve(root, args[0]), args.slice(1));
    else if (op === 'write') writeFile(full(args[0]), args[1]);
    else if (op === 'writeOther') writeFile(path.join(tmp, 'other', args[0]), args[1]);
    else if (op === 'writeOther2') writeFile(path.join(tmp, args[0], args[1]), args[2]);
    else if (op === 'writeBytes') writeFile(full(args[0]), Buffer.from(args[1]));
    else if (op === 'writeRepeat') writeFile(full(args[0]), args[1].repeat(args[2]));
    else if (op === 'mkdir') fs.mkdirSync(full(args[0]), { recursive: true });
    else if (op === 'rm') fs.rmSync(full(args[0]));
    else throw new Error(`нет операции ${op}`);
  }
}

async function call(step, root) {
  if (step.action) return actions.runAction(root, step.action, step.payload);
  if (step.git) {
    const result = run(root, step.git, step.allowFail);
    return { stdout: result.stdout, status: result.status };
  }
  if (step.write) return writeFile(path.join(root, step.write[0]), step.write[1]);
  if (step.rm) return fs.rmSync(path.join(root, step.rm));
  if (step.read) return fs.existsSync(path.join(root, step.read)) ? fs.readFileSync(path.join(root, step.read), 'utf8') : null;
  if (step.readBytes) return [...fs.readFileSync(path.join(root, step.readBytes))];
  if (step.exists) return fs.existsSync(path.join(root, step.exists));
  switch (step.call) {
    case 'summary':
      return actions.historySummary(root);
    case 'simulate':
      return rebase.simulate(root, step.params);
    case 'simulateApply': {
      const d = await rebase.simulate(root, step.params);
      return actions.runAction(root, 'rebaseApply', { oldHead: d.oldHead, newHead: d.newHead, branch: d.branch, onto: d.onto.hash });
    }
    case 'inspect':
      return init.inspectFolder('dir' in step ? step.dir : root);
    case 'init':
      return init.initRepository(step.dir, step.options);
    case 'probeRemote':
      return init.probeRemote(step.dir, step.options);
    case 'connect':
      return init.connectRepository(step.dir, step.options);
    case 'probeClone':
      return cloner.probeClone(step.url);
    case 'clone': {
      const events = [];
      const res = await cloner.cloneRepository(step.options, (event) => events.push(event));
      return { ...res, last: events.at(-1) };
    }
    case 'cancel':
      return cloner.cancelClone(step.id);
    default:
      throw new Error(`нет вызова ${step.call}`);
  }
}

async function runCase(testCase, language) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'act-parity-'));
  const root = path.join(tmp, 'репо');
  fs.mkdirSync(root);
  prepare(testCase, tmp, root);
  const expected = [];
  const posix = tmp.replaceAll('\\', '/');
  for (const step of testCase.steps) {
    const text = JSON.stringify(step)
      .replace(/\{\{rev:([^"]*?\}?)\}\}/g, (_, rev) => run(root, ['rev-parse', rev]).stdout.trim())
      .replaceAll('{{TMPURL}}', `file:///${posix.replace(/^\/+/, '')}`)
      .replaceAll('{{ROOT}}', JSON.stringify(root).slice(1, -1))
      .replaceAll('{{TMP}}', JSON.stringify(tmp).slice(1, -1));
    let out;
    try {
      const value = await call(JSON.parse(text), root);
      out = { ok: value === undefined ? null : value };
    } catch (error) {
      // Падение самого 1.x или сценария, а не ответ модуля: такие шаги нужно видеть
      if (error instanceof TypeError || error instanceof ReferenceError) console.error(`${testCase.name}: ${error.stack}`);
      out = { error: { code: error.code && /^[A-Z_]+$/.test(error.code) && error.toJSON ? error.code : 'UNKNOWN', message: error.message, hint: error.hint ?? null, details: error.details ?? '' } };
    }
    expected.push(
      JSON.parse(
        JSON.stringify(out)
          .replaceAll(JSON.stringify(tmp).slice(1, -1), '{{TMP}}')
          .replaceAll(posix, '{{TMP}}'),
      ),
    );
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* оставляем */
  }
  return expected;
}

async function main() {
  // Сценарии идут параллельно: каждый в своей папке, а язык общий, поэтому языки по очереди
  const results = new Map();
  for (const language of ['ru', 'en']) {
    i18n.setLanguage(language);
    let next = 0;
    const worker = async () => {
      while (next < CASES.length) {
        const testCase = CASES[next++];
        results.set(`${testCase.name}|${language}`, { ...testCase, language, expected: await runCase(testCase, language) });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }
  const cases = CASES.flatMap((testCase) => ['ru', 'en'].map((language) => results.get(`${testCase.name}|${language}`)));
  fs.writeFileSync(path.join(__dirname, 'actions-parity.json'), `${JSON.stringify({ cases })}\n`);
  console.log(`сценариев ${cases.length}, шагов ${cases.reduce((n, c) => n + c.expected.length, 0)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
