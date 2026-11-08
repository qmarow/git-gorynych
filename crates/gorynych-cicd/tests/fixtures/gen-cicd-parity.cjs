// Эталон CI/CD: прогоняет настоящие electron/gitlab.cjs и electron/cicd/* против локального HTTP-сервера и записывает
// результат каждого шага и каждый отправленный запрос. Rust (tests/cicd_parity.rs) обязан воспроизвести и то, и другое.
//   node crates/gorynych-cicd/tests/fixtures/gen-cicd-parity.cjs                   — cicd-parity.json
//   node crates/gorynych-cicd/tests/fixtures/gen-cicd-parity.cjs <выход.json> <N>  — вдобавок каждая N-я подмена значения в ответах сервера
//   GORYNYCH_SHARD=i/n                                                               — только подмены этой части, для запуска в n процессов
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../../..');
const electronDir = path.join(repoRoot, 'electron');
const { CASES } = require('./cicd-cases.cjs');

const HEADERS = ['authorization', 'private-token', 'accept', 'content-type', 'x-github-api-version', 'if-none-match', 'user-agent'];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x', GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z', GIT_CONFIG_NOSYSTEM: '1' };

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function deadPort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function loadModules() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(electronDir)) delete require.cache[key];
  return {
    cicd: require(path.join(electronDir, 'cicd/index.cjs')),
    gitlab: require(path.join(electronDir, 'gitlab.cjs')),
    credentials: require(path.join(electronDir, 'credentials.cjs')),
    settings: require(path.join(electronDir, 'cicd/settings.cjs')),
    runnerSetup: require(path.join(electronDir, 'cicd/runnerSetup.cjs')),
    i18n: require(path.join(electronDir, 'i18n.cjs')),
  };
}

function callTable(m, tmp) {
  const { cicd, gitlab, credentials } = m;
  const opt = (a) => ({ preferredRemote: a.remote });
  return {
    'cicd.detect': (r, a) => cicd.detect(r, a.remote),
    'cicd.checkLogin': (r, a) => cicd.checkLogin(r, a.remote),
    'cicd.info': (r, a) => cicd.info(r, opt(a)),
    'cicd.pipelines': (r, a) => cicd.pipelines(r, { ref: a.ref, ...opt(a) }),
    'cicd.pipeline': (r, a) => cicd.pipeline(r, a.id, opt(a)),
    'cicd.jobLog': (r, a) => cicd.jobLog(r, a.id, { ...opt(a), pipelineId: a.pipelineId }),
    'cicd.action': (r, a) => cicd.action(r, a.action, opt(a)),
    'cicd.run': (r, a) => cicd.run(r, a.params ?? {}, opt(a)),
    'cicd.runForm': (r, a) => cicd.runForm(r, opt(a)),
    'cicd.runners': (r, a) => cicd.runners(r, opt(a)),
    'cicd.runnerUpdate': (r, a) => cicd.runnerUpdate(r, { id: a.id, patch: a.patch }, opt(a)),
    'cicd.runnerDelete': (r, a) => cicd.runnerDelete(r, { id: a.id }, opt(a)),
    'cicd.runnersPrune': (r, a) => cicd.runnersPrune(r, a.ids ? { ids: a.ids } : {}, opt(a)),
    'cicd.runnerRegister': (r, a) => cicd.runnerRegister(r, a.options ?? {}, opt(a)),
    'cicd.runnerTagCheck': (r, a) => cicd.runnerTagCheck(r, { file: a.file, drafts: a.drafts }, opt(a)),
    'cicd.localRunners': (r, a) => cicd.localRunners(r, opt(a)),
    'cicd.localRunnerStart': (r, a) => cicd.localRunnerStart(r, a.labels ? { labels: a.labels } : {}, opt(a)),
    'cicd.localRunnerStop': (r, a) => cicd.localRunnerStop(a.name),
    'cicd.localRunnerResume': (r, a) => cicd.localRunnerResume(a.name),
    'cicd.dockerStatus': () => cicd.dockerStatus(),
    'cicd.artifactDownload': (r, a) => cicd.artifactDownload(r, { artifact: a.artifact, dest: a.dest ? path.join(tmp, a.dest) : undefined }, opt(a)),
    'cicd.secrets': (r, a) => cicd.secrets(r, opt(a)),
    'cicd.secretSave': (r, a) => cicd.secretSave(r, a.data ?? {}, opt(a)),
    'cicd.secretDelete': (r, a) => cicd.secretDelete(r, a.data ?? {}, opt(a)),
    'cicd.getSettings': (r, a) => cicd.getSettings(r, opt(a)),
    'cicd.setSettings': (r, a) => cicd.setSettings(r, a.data ?? {}, opt(a)),
    'gitlab.status': (r, a) => gitlab.detectRemote(r, a.remote),
    'gitlab.pipelines': (r, a) => gitlab.listPipelines(r, { ref: a.ref, ...opt(a) }),
    'gitlab.pipeline': (r, a) => gitlab.pipelineDetail(r, a.id, opt(a)),
    'gitlab.jobLog': (r, a) => gitlab.jobLog(r, a.id, opt(a)),
    'gitlab.action': (r, a) => gitlab.runPipelineAction(r, a.action, opt(a)),
    'gitlab.variables': (r, a) => gitlab.listVariables(r, opt(a)),
    'gitlab.variableValue': (r, a) => gitlab.variableValue(r, a.variable, opt(a)),
    'gitlab.runners': (r, a) => gitlab.listRunners(r, opt(a)),
    'gitlab.lint': (r, a) => gitlab.lintCi(r, a.draft ?? {}, opt(a)),
    'gitlab.saveVariable': (r, a) => gitlab.saveVariable(r, a.data ?? {}, opt(a)),
    'gitlab.deleteVariable': (r, a) => gitlab.deleteVariable(r, a.variable ?? {}, opt(a)),
    'gitlab.schedules': (r, a) => gitlab.listSchedules(r, opt(a)),
    'gitlab.saveSchedule': (r, a) => gitlab.saveSchedule(r, a.schedule ?? {}, opt(a)),
    'gitlab.scheduleAction': (r, a) => gitlab.scheduleAction(r, a.action ?? {}, opt(a)),
    'gitlab.createMr': (r, a) => gitlab.createMergeRequest(r, a.mr ?? {}, opt(a)),
    'gitlab.checkLoginApi': (r, a) => gitlab.checkLoginApi(a.hostname, a.path, a.base),
    'gitlab.loginApiState': (r, a) => gitlab.loginApiState(a.hostname, a.path, a.base),
    'gitlab.listTokens': () => gitlab.listTokens(),
    'gitlab.forgetToken': (r, a) => gitlab.forgetToken(a.key),
    'gitlab.forgetRepoToken': (r, a) => gitlab.forgetRepoToken(a.hostname, a.path),
    'gitlab.forgetHost': (r, a) => gitlab.forgetHost(a.hostname),
    'gitlab.branchHeads': async (r, a) => {
      const map = await gitlab.branchHeads(r, a.name);
      return map ? Object.fromEntries(map) : map;
    },
    'credentials.detectServer': (r, a) => credentials.detectServer(a.input),
  };
}

function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

async function runCase(testCase, language) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-parity-'));
  const userData = path.join(tmp, 'userdata');
  const root = path.join(tmp, 'repo');
  fs.mkdirSync(userData);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(tmp, 'key'), 'ключ');
  const oldEnv = { ...process.env };
  process.env.GK_TEST_USERDATA = userData;

  if (!testCase.noGit) git(root, 'init', '-q', '-b', 'main');
  let head = '';
  for (const [rel, text] of Object.entries(testCase.commit ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  if (testCase.commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'c');
    head = git(root, 'rev-parse', 'HEAD');
  }
  for (const [rel, text] of Object.entries(testCase.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }

  const counters = new Map();
  const requests = [];
  let inFlight = 0;
  let base = '';
  let host = '';
  const dead = await deadPort();
  const expand = (text) =>
    String(text)
      .replaceAll('{{BASE}}', base)
      .replaceAll('{{HOST}}', host)
      .replaceAll('{{OTHER}}', base.replace('127.0.0.1', 'localhost'))
      .replaceAll('{{DEAD}}', `http://127.0.0.1:${dead}`)
      .replaceAll('{{NOW}}', new Date().toISOString())
      .replaceAll('{{HEAD}}', head)
      .replaceAll('{{ROOT}}', tmp.replaceAll('\\', '/'));
  const server = http.createServer((req, res) => {
    inFlight += 1;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const headers = {};
      for (const name of HEADERS) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, host: req.headers.host, headers, body: text ? JSON.parse(text) : null });
      const key = `${req.method} ${req.url.split('?')[0]}`;
      let route = testCase.server?.[key];
      if (Array.isArray(route)) {
        const n = counters.get(key) ?? 0;
        counters.set(key, n + 1);
        route = route[Math.min(n, route.length - 1)];
      }
      if (route?.byAuth) route = route.byAuth[String(req.headers.authorization ?? '').toLowerCase()] ?? route.byAuth.default;
      const answer = route ?? { status: 404, json: { message: '404 Not Found' } };
      const out = {};
      for (const [k, v] of Object.entries(answer.headers ?? {})) out[k] = expand(v);
      res.writeHead(answer.status, { ...out, connection: 'close' });
      const finish = () => {
        inFlight -= 1;
      };
      res.on('close', finish);
      if (answer.json !== undefined) res.end(expand(JSON.stringify(answer.json)));
      else if (answer.text !== undefined) res.end(expand(answer.text));
      else res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${server.address().port}`;
  base = `http://${host}`;

  const m = loadModules();
  m.i18n.setLanguage(language);
  const dockerLog = path.join(tmp, 'docker.log');
  if (testCase.docker?.missing) m.runnerSetup._setDockerBin('нет-такой-программы-docker');
  else if (testCase.docker) {
    const conf = path.join(tmp, 'docker.json');
    fs.writeFileSync(conf, JSON.stringify({ log: dockerLog, script: JSON.parse(expand(JSON.stringify(testCase.docker.script))) }));
    m.runnerSetup._setDockerBin(process.execPath);
    // Обратная черта в NODE_OPTIONS — экранирование, поэтому путь с прямыми
    process.env.NODE_OPTIONS = `--require "${path.join(__dirname, 'fake-docker.cjs').replaceAll('\\', '/')}"`;
    process.env.GORYNYCH_FAKE_DOCKER = conf;
  }

  if (testCase.remote) git(root, 'remote', 'add', 'origin', expand(testCase.remote));
  for (const [name, url] of Object.entries(testCase.extraRemotes ?? {})) git(root, 'remote', 'add', name, expand(url));
  const legacy = { hosts: {}, repos: {} };
  for (const op of testCase.setup ?? []) {
    if (op.op === 'login') {
      const data = JSON.parse(expand(JSON.stringify(op.data)));
      m.credentials.save(expand(op.url), data);
    } else if (op.op === 'server') {
      m.credentials.setServer(op.host, { kind: op.kind, base: op.base ? expand(op.base) : undefined });
    } else if (op.op === 'settings') {
      m.settings.set(op.host, op.path, { provider: op.provider, apiBase: expand(op.apiBase) });
    } else if (op.op === 'sharedLogin') {
      const file = path.join(userData, 'remote-credentials.json');
      const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { hosts: {}, repos: {}, servers: {} };
      store.hosts = { ...(store.hosts ?? {}), [expand(op.key)]: { method: op.method, username: op.username, secret: { plain: Buffer.from(op.secret).toString('base64') }, savedAt: '2024-01-01T00:00:00.000Z' } };
      fs.writeFileSync(file, JSON.stringify(store));
    } else if (op.op === 'unreadableLogin') {
      const file = path.join(userData, 'remote-credentials.json');
      const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { hosts: {}, repos: {}, servers: {} };
      const url = expand(op.url);
      store.repos = { ...(store.repos ?? {}), [m.credentials.repoKeyOf(url)]: { method: op.method, url, username: 'u', secret: { enc: 'нечитаемо' }, savedAt: '2024-01-01T00:00:00.000Z' } };
      fs.writeFileSync(file, JSON.stringify(store));
    } else if (op.op === 'legacyUnreadable') {
      legacy[op.scope][expand(op.key)] = { ...JSON.parse(expand(JSON.stringify(op.entry))), enc: 'нечитаемо' };
    } else if (op.op === 'legacy') {
      const { token, ...entry } = JSON.parse(expand(JSON.stringify(op.entry)));
      legacy[op.scope][expand(op.key)] = { ...entry, plain: Buffer.from(token).toString('base64') };
    }
  }
  if (Object.keys(legacy.hosts).length || Object.keys(legacy.repos).length) fs.writeFileSync(path.join(userData, 'gitlab-tokens.json'), JSON.stringify(legacy));

  const table = callTable(m, tmp);
  const normalize = (value) =>
    JSON.parse(
      JSON.stringify(value ?? null)
        .replaceAll(JSON.stringify(tmp).slice(1, -1), '{{TMP}}')
        .replaceAll(tmp.replaceAll('\\', '/'), '{{TMP}}')
        .replaceAll(host, '{{HOST}}')
        .replaceAll(`127.0.0.1:${dead}`, '{{DEAD_HOST}}')
        .replaceAll(`localhost:${server.address().port}`, '{{OTHER_HOST}}')
        .replaceAll(head || '\u0000', '{{HEAD}}'),
    );

  const steps = [];
  for (const step of testCase.steps) {
    requests.length = 0;
    if (fs.existsSync(dockerLog)) fs.rmSync(dockerLog);
    const fn = table[step.call];
    if (!fn) throw new Error(`нет вызова ${step.call}`);
    const args = JSON.parse(expand(JSON.stringify(step)));
    let out;
    try {
      out = { ok: plain(await fn(root, args)) };
    } catch (error) {
      out = { error: { code: error.code ?? 'UNKNOWN', message: error.message, hint: error.hint ?? null, details: error.details ?? '' } };
    }
    // Проверки входа идут в фоне: ждём, пока сервер перестанет получать запросы
    for (let quiet = 0; quiet < 3; ) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      quiet = inFlight === 0 ? quiet + 1 : 0;
    }
    const log = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean) : [];
    steps.push(normalize({ ...out, requests: requests.map((r) => ({ ...r })), dockerLog: log }));
  }

  await new Promise((resolve) => server.close(resolve));
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
  return steps;
}

// Номер записи не подменяется: `id: null` в 1.x даёт запрос по адресу `/runners/null`, а Rust такого запроса не отправляет
const ID_KEYS = new Set(['id', 'iid', 'build_number', 'run_number', 'uuid']);

/** Подмена: поле ответа сервера становится null, по одному на прогон */
function mutations(testCase) {
  const out = [];
  const visit = (value, pathTo) => {
    if (Array.isArray(value)) value.forEach((item, i) => visit(item, [...pathTo, i]));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (item !== null && !ID_KEYS.has(key)) out.push([...pathTo, key]);
        visit(item, [...pathTo, key]);
      }
    }
  };
  for (const [route, answer] of Object.entries(testCase.server ?? {})) {
    for (const [i, one] of (Array.isArray(answer) ? answer : [answer]).entries()) {
      if (one?.json && typeof one.json === 'object') visit(one.json, [route, Array.isArray(answer) ? i : null, 'json']);
    }
  }
  return out;
}

function mutated(testCase, where) {
  const copy = JSON.parse(JSON.stringify(testCase));
  const [route, index, ...rest] = where;
  let node = copy.server[route];
  if (index !== null) node = node[index];
  for (const key of rest.slice(0, -1)) node = node[key];
  node[rest[rest.length - 1]] = null;
  copy.name = `${testCase.name} / ${where.filter((part) => part !== null).join('.')} = null`;
  return copy;
}

async function main() {
  const output = process.argv[2] ?? path.join(__dirname, 'cicd-parity.json');
  const every = Number(process.argv[3] ?? 40);
  const [shard, shards] = (process.env.GORYNYCH_SHARD ?? '0/1').split('/').map(Number);
  const cases = [];
  for (const testCase of process.env.GORYNYCH_SHARD ? [] : CASES) {
    for (const language of testCase.ruOnly ? ['ru'] : ['ru', 'en']) {
      cases.push({ ...testCase, language, expected: await runCase(testCase, language) });
    }
  }
  const mutants = [];
  let counter = 0;
  for (const testCase of CASES) {
    if (testCase.ruOnly || testCase.docker) continue;
    for (const where of mutations(testCase)) {
      if (counter++ % every !== 0 || counter % shards !== shard) continue;
      const copy = mutated(testCase, where);
      mutants.push({ ...copy, language: 'ru', expected: await runCase(copy, 'ru') });
    }
  }
  fs.writeFileSync(output, `${JSON.stringify({ cases, mutants })}\n`);
  console.log(`сценариев ${cases.length}, шагов ${cases.reduce((n, c) => n + c.expected.length, 0)}; подмен ${mutants.length} из ${counter}`);
  console.log(`запросов ${cases.reduce((n, c) => n + c.expected.reduce((k, s) => k + s.requests.length, 0), 0)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
