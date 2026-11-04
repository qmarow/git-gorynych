// Генератор эталона: прогоняет настоящие electron/*.cjs и записывает результаты в parity.json.
// Запуск из корня репозитория: node crates/gorynych-core/tests/fixtures/gen-parity.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const { classify, fromProcessError, serializeError } = require(path.join(root, 'electron/errors.cjs'));
const { t, setLanguage, locale } = require(path.join(root, 'electron/i18n.cjs'));
const { diffLines, toHunks } = require(path.join(root, 'electron/lineDiff.cjs'));
const en = require(path.join(root, 'electron/i18n/en.json'));

// Детерминированный генератор (LCG), чтобы фикстура не менялась от запуска к запуску
let seed = 20261104;
const rnd = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor((seed / 2 ** 32) * n);
};

// ---------- Коды ошибок: все литералы из main-процесса ----------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'vendor') return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.cjs') ? [p] : [];
  });
}
const NOT_CODES = new Set(['ENOENT', 'GET', 'TAG_RESOLVE_FAILED']); // код Node, HTTP-метод, код библиотеки yaml
const codes = new Set(['GIT']);
for (const f of walk(path.join(root, 'electron'))) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!/code\b|Code\b/.test(line)) continue;
    for (const m of line.matchAll(/'([A-Z][A-Z_0-9]{2,})'/g)) if (!NOT_CODES.has(m[1])) codes.add(m[1]);
  }
}

// ---------- Классификатор: по образцу на каждую альтернативу каждого правила ----------
const SAMPLES = [
  'remote: error: GH006: Protected branch update failed', 'GH013: Repository rule violations', 'protected branch hook',
  'You are not allowed to push code to protected branches', 'not allowed to force push to protected', 'not allowed to push to protected',
  'cannot force-push to a protected branch', 'push declined due to repository rule violations', 'the branch is protected',
  '! [remote rejected] main -> main (pre-receive hook declined)', 'hook declined',
  'The requested URL returned error: 403', 'Permission to foo/bar.git denied to baz', "You don't have permission to access",
  'write access to repository not granted', 'not allowed to push', 'insufficient permission for adding an object', 'HTTP 403 curl', 'access forbidden',
  'You are not allowed to push', 'Host key verification failed.', '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@',
  'Authentication failed for https://x', "could not read Username for 'https://x'", 'could not read Password', 'terminal prompts disabled',
  'Invalid username or password', 'HTTP Basic: Access denied', 'git@host: Permission denied (publickey).', 'returned error: 401', 'Bad credentials',
  'invalid credentials', 'logon failed', 'unable to get password from user', 'SSH_AUTH_SOCK not set', 'Enter passphrase for key',
  'ERROR: Repository not found.', "'x' does not appear to be a git repository", "repository 'https://x/y.git/' not found", 'returned error: 404',
  'The project you were looking for could not be found', 'No such remote origin',
  ' ! [rejected] main -> main (non-fast-forward)', ' ! [rejected] main -> main (fetch first)', 'Updates were rejected because the tip', 'stale info', '! [rejected]',
  'fatal: Not possible to fast-forward, aborting.', 'You have divergent branches... diverging branches', 'Need to specify how to reconcile divergent branches',
  'CONFLICT (content): Merge conflict in a.txt', 'Automatic merge failed; fix conflicts', 'error: could not apply abc123', 'Merge conflict in x', 'fix conflicts and then commit',
  'Your local changes to the following files would be overwritten by merge', 'Please commit your changes or stash them before', 'cannot pull with uncommitted changes',
  'cannot rebase with uncommitted changes', 'You have unstaged changes', 'Your index contains uncommitted changes',
  'Could not resolve host: x', 'Failed to connect to x port 443', 'Connection timed out', 'Connection refused', 'Connection reset by peer', 'Network is unreachable',
  'fatal: unable to access', 'Operation timed out', 'ssl handshake', 'tls error', 'fetch-pack: early EOF', 'The remote end hung up unexpectedly', 'Could not read from remote repository.',
  // Регистр, многострочность, CRLF и то, что не должно совпасть
  'BAD CREDENTIALS', 'authentication FAILED', 'fatal: something else\nsecond line', 'error: pathspec x', '  \n\n  fatal:   spaced out\r\nnext', 'FATAL:loud', 'warning: nothing special',
  "repository 'a\nb' not found", '', '   ', 'просто текст',
];
const classifyCases = [];
for (const s of SAMPLES) {
  classifyCases.push({ stderr: s, stdout: '', code: classify(s, '')?.code ?? null });
  classifyCases.push({ stderr: '', stdout: s, code: classify('', s)?.code ?? null });
}
for (let i = 0; i < 400; i++) { // Пары: порядок правил важнее порядка в тексте
  const stderr = SAMPLES[rnd(SAMPLES.length)];
  const stdout = SAMPLES[rnd(SAMPLES.length)];
  classifyCases.push({ stderr, stdout, code: classify(stderr, stdout)?.code ?? null });
}

// ---------- fromProcessError / serializeError на обоих языках ----------
const FAILURES = [
  { kind: 'not_found', err: { code: 'ENOENT', message: 'spawn git ENOENT' } },
  { kind: 'timed_out', err: { killed: true, message: 'Command failed: git fetch' } },
  { kind: 'exited', err: { message: 'Command failed: git x' } },
];
const processCases = [];
const rules = {};
for (const language of ['ru', 'en']) {
  setLanguage(language);
  for (const f of FAILURES) {
    for (const stderr of SAMPLES) {
      for (const stdout of ['', 'stdout output']) {
        const e = fromProcessError(f.err, stdout, stderr);
        processCases.push({ language, kind: f.kind, message: f.err.message, stderr, stdout, json: serializeError(e), keptStdout: e.stdout });
      }
    }
  }
  for (const s of SAMPLES) {
    const rule = classify(s, '');
    if (rule) (rules[rule.code] ??= {})[language] = { message: rule.message, hint: rule.hint };
  }
}

// ---------- t() ----------
const keys = Object.keys(en).sort();
const withArgs = keys.filter((k) => /\{\d+\}/.test(k) || /\{\d+\}/.test(en[k]));
const pick = (list, n) => Array.from({ length: n }, () => list[rnd(list.length)]);
const ARGS = [[], ['A'], ['A', null, 3], ['A', 'B', 'C', 'D', 'E', 'F'], [0, '{1}', undefined]];
const tCases = [];
for (const language of ['ru', 'en']) {
  setLanguage(language);
  for (const msg of [...pick(keys, 150), ...pick(withArgs, 150), 'Такого ключа нет {0}', '{99} {0} {007} {x} {} {99999999999999999999}']) {
    const args = ARGS[rnd(ARGS.length)];
    tCases.push({ language, msg, args: args.map((a) => a ?? null), out: t(msg, ...args) });
  }
}
const locales = {};
for (const l of ['ru', 'en']) {
  setLanguage(l);
  locales[l] = locale();
}

// ---------- Построчный diff ----------
const lines = (n, alphabet) => Array.from({ length: n }, () => `l${rnd(alphabet)}`);
const diffCases = [];
const addDiff = (a, b, context) => {
  const ops = diffLines(a, b);
  diffCases.push({ a, b, context: context ?? null, ops, result: toHunks(a, b, ops, ...(context === undefined ? [] : [context])) });
};
addDiff([], []);
addDiff([], ['x']);
addDiff(['x'], []);
addDiff(['x'], ['x']);
addDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
for (let i = 0; i < 120; i++) addDiff(lines(rnd(40), 2 + rnd(6)), lines(rnd(40), 2 + rnd(6)), rnd(2) ? undefined : rnd(5));
for (let i = 0; i < 40; i++) { // Длинные файлы с редкими правками — проверка склейки фрагментов
  const a = Array.from({ length: 60 + rnd(60) }, (_, j) => `line ${j}`);
  const b = a.slice();
  for (let e = 0; e < 1 + rnd(5); e++) {
    const at = rnd(b.length);
    const what = rnd(3);
    if (what === 0) b[at] = `edit ${e}`;
    else if (what === 1) b.splice(at, 1 + rnd(3));
    else b.splice(at, 0, `new ${e}`);
  }
  addDiff(a, b, rnd(2) ? undefined : rnd(5));
}

const out = { codes: [...codes].sort(), classify: classifyCases, process: processCases, rules, t: tCases, locales, diff: diffCases };
fs.writeFileSync(path.join(__dirname, 'parity.json'), `${JSON.stringify(out)}\n`);
console.log(`codes=${out.codes.length} classify=${classifyCases.length} process=${processCases.length} rules=${Object.keys(rules).length} t=${tCases.length} diff=${diffCases.length}`);
