// Эталон для tests/check_parity.rs: настоящий checkCi (electron/ciCheck.cjs) через previewCi.
// Запуск из корня репозитория:
//   node crates/gorynych-ci-linter/tests/fixtures/gen-check-parity.cjs                    — check-parity.json
//   node crates/gorynych-ci-linter/tests/fixtures/gen-check-parity.cjs <выход.json>        — все подмены значений
//   node crates/gorynych-ci-linter/tests/fixtures/gen-check-parity.cjs <выход.json> <папка> — настоящие файлы из папки
// Команды git выполняются только в случаях с git: true, иначе отвечают ошибкой: папка не репозиторий, и подмены идут быстро.
globalThis.__GORYNYCH_REAL_CHECK = true;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../../..');
const gitModulePath = require.resolve(path.join(repoRoot, 'electron/git.cjs'));
const gitModule = require(gitModulePath);
let gitEnabled = false;
const realGit = gitModule.git;
gitModule.git = (...args) => (gitEnabled ? realGit(...args) : Promise.reject(new Error('нет репозитория')));

const { CASES, mutationCases, writeFiles, previewCi, setLanguage } = require('./gen-load-parity.cjs');
const { CHECK_CASES } = require('./check-cases.cjs');
const { checkRunnerTags } = require(path.join(repoRoot, 'electron/cicd/tagCheck.cjs'));

const TAG_FILES = {
  'gitlab теги': { '.gitlab-ci.yml': 'a:\n  script: x\n  tags: [docker, Linux]\nb:\n  script: x\n  tags: [linux, docker]\nc:\n  script: x\n  tags: [gpu]\nd:\n  script: x\ne:\n  script: x\n  tags: [docker, gpu, нет]\nf:\n  trigger: x\n' },
  'gitlab много': { '.gitlab-ci.yml': Array.from({ length: 6 }, (_, i) => `j${i}:\n  script: x\n  tags: [t]\n`).join('') },
  'gitlab из шаблона': { '.gitlab-ci.yml': 'default:\n  tags: [d]\na:\n  script: x\n' },
  'github': { '.github/workflows/a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    name: Второе\n    runs-on: [self-hosted, x]\n  c:\n    runs-on: ${{ matrix.os }}\n  d:\n    uses: ./x.yml\n  e: {}\n' },
  'gitea': { '.gitea/workflows/a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-latest\n' },
  'bitbucket': { 'bitbucket-pipelines.yml': 'pipelines:\n  default:\n    - step:\n        runs-on: [self.hosted, linux]\n        script: [a]\n    - step:\n        script: [b]\n' },
  'circle': { '.circleci/config.yml': 'jobs:\n  a:\n    steps: [x]\n' },
};
const TAG_RUNNERS = {
  'нет раннеров': [],
  'все подходят': [{ name: 'r1', status: 'online', labels: ['docker', 'linux', 'gpu', 'нет', 't', 'd', 'ubuntu-latest', 'self-hosted', 'x', 'self.hosted'] }],
  'занят': [{ name: 'r1', status: 'busy', labels: ['DOCKER', ' Linux '] }],
  'не в сети': [{ name: 'r1', status: 'offline', labels: ['docker', 'linux', 'gpu', 'ubuntu-latest', 'self.hosted', 'linux'] }, { name: 'r2', status: 'paused', labels: ['docker', 'linux'] }, { name: 'r3', status: 'странный', labels: ['gpu'] }],
  'по частям': [{ name: 'r1', status: 'online', labels: ['docker'] }, { name: 'r2', status: 'online', labels: ['linux', 'gpu'] }],
  'без тегов нельзя': [{ name: 'r1', status: 'online', labels: ['docker'], runUntagged: false }],
  'без тегов можно': [{ name: 'r1', status: 'online', labels: [], runUntagged: true }],
};

async function tagCases() {
  const out = [];
  for (const [name, files] of Object.entries(TAG_FILES)) {
    for (const [runnersName, runners] of Object.entries(TAG_RUNNERS)) {
      for (const language of ['ru', 'en']) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorynych-tags-'));
        try {
          writeFiles(dir, files);
          setLanguage(language);
          const { current } = await previewCi(dir, '', {});
          out.push({ name: `${name} / ${runnersName}`, files, runners, language, issues: JSON.parse(JSON.stringify(checkRunnerTags(current, runners))) });
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }
  return out;
}

function gitRun(repo, args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: repo, stdio: 'ignore' });
}

async function record(testCase, language) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorynych-check-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  try {
    writeFiles(repo, testCase.files);
    if (testCase.git) {
      gitRun(repo, ['init', '-q', '-b', testCase.git.branch ?? 'main']);
      gitRun(repo, ['add', '.']);
      gitRun(repo, ['commit', '-q', '--allow-empty', '-m', 'x']);
      for (const rel of testCase.git.executable ?? []) gitRun(repo, ['update-index', '--chmod=+x', rel]);
      for (const name of testCase.git.branches ?? []) gitRun(repo, ['branch', name]);
      gitEnabled = true;
    }
    setLanguage(language);
    const result = await previewCi(repo, testCase.request ?? '', testCase.drafts ?? {});
    const check = result.current?.check ?? null;
    if (check) delete check.ms;
    const files = Object.fromEntries(Object.entries(testCase.files).map(([k, v]) => [k, typeof v === 'string' && v.length > 500 * 1024 ? { big: v.length } : v]));
    const loose = (result.current?.errors ?? []).length > 0;
    return { name: testCase.name, files, request: testCase.request, drafts: testCase.drafts, git: testCase.git, language, loose, system: result.current?.system ?? null, check: JSON.parse(JSON.stringify(check)) };
  } finally {
    gitEnabled = false;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sourceIds() {
  const ids = new Set();
  for (const name of ['ciCheck.cjs', 'ciCheckGitlab.cjs', 'ciCheckOther.cjs', 'ciCheckScripts.cjs']) {
    const text = fs.readFileSync(path.join(repoRoot, 'electron', name), 'utf8');
    for (const m of text.matchAll(/\bid: '([a-z0-9-]+)'/g)) ids.add(m[1]);
  }
  return ids;
}

async function main() {
  const [output, realDir] = process.argv.slice(2);
  if (realDir) {
    const targets = ['.gitlab-ci.yml', '.github/workflows/ci.yml', 'bitbucket-pipelines.yml', '.circleci/config.yml', 'azure-pipelines.yml'];
    const cases = [];
    for (const name of fs.readdirSync(realDir)) {
      const text = fs.readFileSync(path.join(realDir, name), 'utf8');
      for (const target of targets) cases.push(await record({ name: `${name} как ${target}`, files: { [target]: text } }, 'ru'));
    }
    fs.writeFileSync(output, `${JSON.stringify({ cases })}\n`);
    console.log(`случаев ${cases.length}, сломанных ${cases.filter((c) => c.loose).length}`);
    return;
  }
  const mutations = mutationCases();
  if (output) {
    const cases = [];
    for (const c of mutations) cases.push(await record(c, 'ru'));
    fs.writeFileSync(output, `${JSON.stringify({ cases })}\n`);
    console.log(`подмен ${cases.length}`);
    return;
  }
  const cases = [];
  for (const c of [...CASES.filter((item) => !item.dropFileText), ...CHECK_CASES]) {
    cases.push(await record(c, 'ru'));
    if (c.bothLanguages !== false) cases.push(await record(c, 'en'));
  }
  const mutated = [];
  for (const c of mutations.filter((_, i) => i % 40 === 7)) mutated.push(await record(c, 'ru'));
  const tags = await tagCases();
  fs.writeFileSync(path.join(__dirname, 'check-parity.json'), `${JSON.stringify({ cases, mutated, tags })}\n`);
  const seen = new Set([...cases, ...mutated].flatMap((c) => (c.check?.issues ?? []).map((i) => i.id)));
  const missing = [...sourceIds()].filter((id) => !seen.has(id)).sort();
  console.log(`случаев ${cases.length}, подмен ${mutated.length} из ${mutations.length}; id в исходниках ${sourceIds().size}, не покрыто ${missing.length}`);
  if (missing.length) console.log(missing.join(' '));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
