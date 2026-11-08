// Эталон watch.cjs, indexSync.cjs, remoteWatch.cjs. Rust (tests/watcher_parity.rs) строит такие же репозитории и обязан дать те же ответы.
//   node crates/gorynych-watcher/tests/fixtures/gen-watcher-parity.cjs
// API GitLab подменён прямо в настоящем модуле: remoteWatch читает gitlab.branchHeads при каждом вызове.
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
});
delete process.env.GIT_SSH_COMMAND;
delete process.env.GIT_SSH;

const { classify } = require(path.join(repoRoot, 'electron/watch.cjs'));
const indexSync = require(path.join(repoRoot, 'electron/indexSync.cjs'));
const remoteWatch = require(path.join(repoRoot, 'electron/remoteWatch.cjs'));
const gitlab = require(path.join(repoRoot, 'electron/gitlab.cjs'));

const CLASSIFY = ['', 'a.txt', 'папка/a.txt', '.git', '.git/', '.git/HEAD', '.git\\index', '.git/index.lock', '.git/refs/heads/main', '.git/refs/heads/main.lock', '.git/objects/ab/cd', '.git/lfs/x', '.git/logs/HEAD', '.git/COMMIT_EDITMSG', '.git/gk/x', '.git/fsmonitor--daemon/x', '.git/FETCH_HEAD', '.github/x', 'node_modules/a', 'a/node_modules/b', 'a\\target\\b', 'target', 'targets/a', 'dist/a', 'build/a', 'out/a', 'bin/a', 'obj/a', '.venv/a', 'venv/a', '__pycache__/a', '.next/a', '.nuxt/a', '.cache/a', 'a.lock'];

const PLANS = [
  { entries: { a: 'MM' }, untracked: [], prev: null },
  { entries: { a: 'MM' }, untracked: [], prev: { a: 'M ' } },
  { entries: { a: 'MM' }, untracked: [], prev: { a: ' M' } },
  { entries: { a: 'MT', b: 'TM', c: 'TT' }, untracked: [], prev: { a: 'T ', b: 'MM' } },
  { entries: { a: 'AM' }, untracked: [], prev: null },
  { entries: { a: 'AM' }, untracked: [], prev: { a: 'A ' } },
  { entries: { a: 'AM' }, untracked: [], prev: { a: 'AM' } },
  { entries: { a: 'AD' }, untracked: [], prev: null },
  { entries: { a: 'D ' }, untracked: [], prev: null },
  { entries: { a: 'D ' }, untracked: ['a'], prev: null },
  { entries: { a: 'UU', b: 'AA', c: 'DD', d: 'AU', e: 'UD' }, untracked: [], prev: null },
  { entries: { a: 'M ', b: ' M', c: 'A ', d: ' D' }, untracked: ['x'], prev: { a: 'M ' } },
];

const PARSES = ['', ' M a.txt\0', 'M  a\0MM папка/б.txt\0?? новый\0', 'R  новое\0старое\0 M x\0', 'C  копия\0исходный\0', '?? a\0??\0 M\0ab\0', 'AD x y\0'];

const commitAll = (message) => [['git', 'add', '-A'], ['git', 'commit', '-q', '-m', message]];
const base = [['write', 'a.txt', 'один\n'], ['write', 'b.txt', 'два\n'], ...commitAll('Первый')];
const remote = [
  ...base,
  ['gitIn', '..', 'init', '-q', '--bare', 'origin.git'],
  ['git', 'remote', 'add', 'origin', '../origin.git'],
  ['git', 'push', '-q', '-u', 'origin', 'main'],
  ['gitIn', '..', 'clone', '-q', 'origin.git', 'other'],
  ['gitIn', '../other', 'checkout', '-q', 'main'],
];
const status = { git: ['status', '--porcelain=v1', '--untracked-files=all'] };
const refs = { git: ['for-each-ref', '--format=%(refname) %(objectname)'] };
const server = (...args) => ({ gitIn: ['../other', ...args] });
const writeServer = (file, text) => ({ write: [`../other/${file}`, text] });
const check = { call: 'light' };

const CASES = [
  {
    name: 'индекс: откат к HEAD убирает правку',
    setup: base,
    steps: [{ call: 'sync', act: false }, { write: ['a.txt', 'правка\n'] }, { git: ['add', 'a.txt'] }, { call: 'sync', act: false }, { write: ['a.txt', 'один\n'] }, status, { call: 'sync', act: true }, status, { call: 'sync', act: true }],
  },
  {
    name: 'индекс: целиком застейдженный поправили снаружи',
    setup: base,
    steps: [{ write: ['a.txt', 'правка\n'] }, { git: ['add', 'a.txt'] }, { call: 'sync', act: false }, { write: ['a.txt', 'новее\n'] }, status, { call: 'sync', act: true }, status, { git: ['diff', '--cached', '--stat'] }],
  },
  {
    name: 'индекс: без истории расхождение намеренное',
    setup: base,
    steps: [{ write: ['a.txt', 'правка\n'] }, { git: ['add', 'a.txt'] }, { write: ['a.txt', 'новее\n'] }, { call: 'sync', act: true }, status],
  },
  {
    name: 'индекс: новый файл',
    setup: base,
    steps: [{ write: ['n.txt', '1\n'] }, { git: ['add', 'n.txt'] }, { call: 'sync', act: false }, { write: ['n.txt', '2\n'] }, { call: 'sync', act: true }, status, { rm: 'n.txt' }, status, { call: 'sync', act: true }, status],
  },
  {
    name: 'индекс: удаление, а файл вернули',
    setup: base,
    steps: [{ git: ['rm', '-q', '--cached', 'a.txt'] }, status, { call: 'sync', act: true }, status, { git: ['rm', '-q', '--cached', 'b.txt'] }, { write: ['b.txt', 'другое\n'] }, { call: 'sync', act: true }, status],
  },
  {
    name: 'индекс: без коммитов',
    setup: [['write', 'a.txt', '1\n']],
    steps: [{ git: ['add', 'a.txt'] }, { call: 'sync', act: false }, { rm: 'a.txt' }, status, { call: 'sync', act: true }, status, { write: ['b.txt', '1\n'] }, { git: ['add', 'b.txt'] }, { call: 'sync', act: false }, { write: ['b.txt', '2\n'] }, { call: 'sync', act: true }, status],
  },
  {
    name: 'индекс: конфликт и незавершённый merge не трогаем',
    setup: [...base, ['git', 'checkout', '-q', '-b', 'dev'], ['write', 'a.txt', 'dev\n'], ...commitAll('dev'), ['git', 'checkout', '-q', 'main'], ['write', 'a.txt', 'main\n'], ...commitAll('main')],
    steps: [{ git: ['merge', 'dev'], allowFail: true }, status, { write: ['b.txt', 'x\n'] }, { git: ['add', 'b.txt'] }, { write: ['b.txt', 'два\n'] }, { call: 'sync', act: true }, status, { git: ['merge', '--abort'] }, status],
  },
  {
    name: 'индекс: переименование и удалённый файл',
    setup: base,
    steps: [{ git: ['mv', 'a.txt', 'c.txt'] }, { write: ['b.txt', 'x\n'] }, { git: ['add', 'b.txt'] }, { call: 'sync', act: false }, { rm: 'b.txt' }, status, { call: 'sync', act: true }, status, { write: ['b.txt', 'x\n'] }, { git: ['add', 'b.txt'] }, { call: 'sync', act: false }, { write: ['b.txt', 'y\n'] }, { rm: 'b.txt' }, { write: ['b.txt', 'y\n'] }, { call: 'sync', act: true }, status],
  },
  {
    name: 'индекс: не репозиторий',
    noGit: true,
    setup: [],
    steps: [{ call: 'sync', act: true, loose: true }],
  },
  {
    name: 'сервер: без remote и не репозиторий',
    setup: base,
    steps: [check, { call: 'lightAt', dir: '{{TMP}}' }, { write: ['.git/index.lock', ''] }, check, { rm: '.git/index.lock' }, check],
  },
  {
    name: 'сервер: ничего не изменилось и новые коммиты',
    setup: remote,
    steps: [
      check,
      refs,
      writeServer('n.txt', 'n\n'),
      server('add', '-A'),
      server('commit', '-q', '-m', 'На сервере'),
      server('push', '-q', 'origin', 'main'),
      check,
      refs,
      check,
      server('checkout', '-q', '-b', 'новая'),
      server('push', '-q', 'origin', 'новая'),
      server('tag', 'v1'),
      server('push', '-q', 'origin', 'v1'),
      server('tag', '-a', 'v2', '-m', 'аннотация'),
      server('push', '-q', 'origin', 'v2'),
      check,
      refs,
      server('push', '-q', 'origin', '--delete', 'новая'),
      check,
      refs,
      { git: ['tag', 'локальный'] },
      check,
    ],
  },
  {
    name: 'сервер: тег переписали',
    setup: remote,
    steps: [
      server('tag', 'v1'),
      server('push', '-q', 'origin', 'v1'),
      check,
      writeServer('n.txt', 'n\n'),
      server('add', '-A'),
      server('commit', '-q', '-m', 'Ещё'),
      server('tag', '-f', 'v1'),
      server('push', '-q', '-f', 'origin', 'main', 'v1'),
      server('tag', 'v2'),
      server('push', '-q', 'origin', 'v2'),
      check,
      refs,
      check,
    ],
  },
  {
    name: 'сервер: недоступен и несколько remote',
    setup: remote,
    steps: [
      { git: ['remote', 'add', 'второй', '../other'] },
      { git: ['remote', 'add', 'третий', '../other'] },
      { git: ['remote', 'add', 'четвёртый', '../нет.git'] },
      check,
      refs,
      { git: ['remote', 'set-url', 'origin', '../нет.git'] },
      check,
    ],
  },
  {
    name: 'сервер: ветка без origin',
    setup: [...base, ['gitIn', '..', 'init', '-q', '--bare', 'o.git'], ['git', 'remote', 'add', 'upstream', '../o.git'], ['git', 'push', '-q', '-u', 'upstream', 'main']],
    steps: [check, refs],
  },
  {
    name: 'сервер: через API',
    setup: remote,
    steps: [
      { api: { heads: {} } },
      check,
      { api: { heads: { main: '{{rev:main}}' } } },
      check,
      { api: { heads: { main: '0000000000000000000000000000000000000000' } } },
      check,
      check,
      { api: { heads: { main: '{{rev:main}}' } } },
      check,
      { api: { heads: { main: '{{rev:main}}', новая: '{{rev:main}}' } } },
      check,
      check,
      { api: { error: { code: 'RATE_LIMIT', message: 'Подождите', retryAfter: 42 } } },
      check,
      { api: { error: { code: 'NETWORK', message: 'Нет связи' } } },
      check,
      { api: { error: { code: 'AUTH', message: 'Токен не подошёл' } } },
      check,
      { apiCalls: true },
      { api: { error: { code: 'NETWORK', message: 'Нет связи' } } },
      check,
      { apiCalls: true },
    ],
  },
];

const writeFile = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const run = (cwd, args, allowFail = false) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result;
};

let api = null;
let apiCalls = 0;
gitlab.branchHeads = async () => {
  apiCalls++;
  if (api?.error) throw Object.assign(new Error(api.error.message), api.error);
  return api?.heads ? new Map(Object.entries(api.heads)) : null;
};

async function call(step, root) {
  if (step.git) {
    const result = run(root, step.git, step.allowFail);
    return { stdout: result.stdout, status: result.status };
  }
  if (step.gitIn) {
    const result = run(path.resolve(root, step.gitIn[0]), step.gitIn.slice(1));
    return { status: result.status };
  }
  if (step.write) return writeFile(path.join(root, step.write[0]), step.write[1]);
  if (step.rm) return fs.rmSync(path.join(root, step.rm));
  if ('api' in step) {
    api = step.api;
    apiCalls = 0;
    return null;
  }
  if (step.apiCalls) return apiCalls;
  switch (step.call) {
    case 'sync':
      return indexSync.syncIndex(root, { act: step.act });
    case 'light': {
      const out = await remoteWatch.lightCheck(root);
      return { ...out, ms: 0 };
    }
    case 'lightAt': {
      const out = await remoteWatch.lightCheck(step.dir);
      return { ...out, ms: 0 };
    }
    default:
      throw new Error(`нет вызова ${step.call}`);
  }
}

async function runCase(testCase) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wat-parity-'));
  const root = path.join(tmp, 'репо');
  fs.mkdirSync(root);
  api = null;
  apiCalls = 0;
  if (!testCase.noGit) run(root, ['init', '-q', '-b', 'main']);
  for (const [op, ...args] of testCase.setup) {
    if (op === 'git') run(root, args);
    else if (op === 'gitIn') run(path.resolve(root, args[0]), args.slice(1));
    else if (op === 'write') writeFile(path.join(root, args[0]), args[1]);
    else throw new Error(`нет операции ${op}`);
  }
  const posix = tmp.replaceAll('\\', '/');
  const expected = [];
  for (const step of testCase.steps) {
    const text = JSON.stringify(step)
      .replace(/\{\{rev:([^"]*?)\}\}/g, (_, rev) => run(root, ['rev-parse', rev]).stdout.trim())
      .replaceAll('{{TMP}}', JSON.stringify(tmp).slice(1, -1));
    let out;
    try {
      const value = await call(JSON.parse(text), root);
      out = { ok: value === undefined ? null : value };
    } catch (error) {
      if (error instanceof TypeError || error instanceof ReferenceError) console.error(`${testCase.name}: ${error.stack}`);
      out = { error: { code: error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'UNKNOWN', message: error.message } };
    }
    expected.push(JSON.parse(JSON.stringify(out).replaceAll(JSON.stringify(tmp).slice(1, -1), '{{TMP}}').replaceAll(posix, '{{TMP}}')));
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* оставляем */
  }
  return expected;
}

async function main() {
  const cases = [];
  // По очереди: подмена API общая на процесс
  for (const testCase of CASES) cases.push({ ...testCase, expected: await runCase(testCase) });
  const data = {
    classify: CLASSIFY.map((rel) => [rel, classify(rel)]),
    plans: PLANS.map((item) => ({ ...item, expected: indexSync.plan(new Map(Object.entries(item.entries)), new Set(item.untracked), item.prev ? new Map(Object.entries(item.prev)) : null) })),
    parses: PARSES.map((text) => {
      const out = indexSync.parseStatus(text);
      return { text, entries: [...out.entries], untracked: [...out.untracked] };
    }),
    cases,
  };
  fs.writeFileSync(path.join(__dirname, 'watcher-parity.json'), `${JSON.stringify(data)}\n`);
  console.log(`сценариев ${cases.length}, шагов ${cases.reduce((n, c) => n + c.expected.length, 0)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
