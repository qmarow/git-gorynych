// Эталон для tests/edit_parity.rs: настоящие applyEdit, saveFile, readFile, diffDraft и createFromTemplate (electron/ciEdit.cjs).
// Запуск из корня репозитория:
//   node crates/gorynych-ci-linter/tests/fixtures/gen-edit-parity.cjs                   — edit-parity.json
//   node crates/gorynych-ci-linter/tests/fixtures/gen-edit-parity.cjs <выход.json> <папка> — настоящие файлы из папки (см. тест edit_corpus)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const YAML = require(path.join(root, 'electron/vendor/yaml.cjs'));
const ciEdit = require(path.join(root, 'electron/ciEdit.cjs'));
const { setLanguage } = require(path.join(root, 'electron/i18n.cjs'));

// Как sameData в ciEdit.cjs: разбор без слияния
const dataOf = (text) => {
  const doc = YAML.parseDocument(text, { uniqueKeys: false, logLevel: 'error' });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  return doc.toJS();
};
const json = (v) => JSON.parse(JSON.stringify(v ?? null));

function record(name, content, op, language = 'ru') {
  setLanguage(language);
  const out = { name, content, op, language };
  try {
    const result = ciEdit.applyEdit(content, op);
    out.ok = { content: result.content, notes: result.notes, data: json(dataOf(result.content)) };
  } catch (error) {
    out.error = { code: error.code ?? null, message: error.message, hint: error.hint ?? null };
  }
  return out;
}

const STYLED = {
  'обычный': `# Шапка файла

include:
  - local: a.yml

stages:
  - build
  - test
  - deploy

variables:
  A: 1

# Шаблон
.base:
  image: node:20

# Сборка
build:
  stage: build # этап
  image: "node:20"
  script:
    - npm ci
    # внутри списка
    - npm run build
  needs: []
  # в конце задания

test:
  stage: test
  extends: .base
  needs:
    - build
    - job: lint
      optional: true
  dependencies: [build, lint]
  script: echo test
  when: manual
  allow_failure: true

lint:
  stage: test
  script: [lint]
  tags: [docker, linux]
  needs: build

deploy:
  stage: deploy
  extends: [.base]
  environment: 'prod'
  timeout: 1h
  interruptible: true
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
    - when: never
  script:
    - |
      echo один
      echo два

# Хвост файла
`,
  'строчные этапы': 'stages: [build, test]\nbuild:\n  stage: build\n  script: [a]\ntest:\n  script: [b]\n',
  'строчные этапы с пробелами': 'stages: [ build , test ]\nbuild:\n  stage: build\n  script: [ a ]\n  needs: [ test ]\ntest:\n  script: [b]\n',
  'многострочные строчные этапы': 'stages: [\n  build,\n  test,\n]\nbuild:\n  stage: build\n  script: [a]\n',
  'без этапов': 'build:\n  stage: build\n  script: [a]\nother:\n  stage: свой\n  script: [b]\npre:\n  stage: .pre\n  script: [c]\n',
  'без этапов с include': 'include: a.yml\n\n# о сборке\nbuild:\n  stage: build\n  script: [a]\n',
  'только include': 'include: a.yml\n',
  'пустой': '',
  'только комментарий': '# комментарий\n',
  'только ---': '---\n',
  'пустой словарь': '{}\n',
  'список без отступа': 'stages:\n- build\n- test\nbuild:\n  stage: build\n  script:\n  - a\n  - b\n  needs:\n  - test\ntest:\n  script:\n  - c\n',
  'отступ 4': 'stages:\n    - build\n    - test\nbuild:\n    stage: build\n    script:\n        - a\n    needs:\n        - test\ntest:\n    script:\n        - b\n',
  'строчное задание': 'build: {stage: build, script: [a]}\ntest: {stage: test, script: [b], needs: [build]}\n',
  'строчный корень': '{a: {stage: test, script: [x]}, b: {script: [y], needs: [a]}}\n',
  'types вместо stages': 'types: [build]\nbuild:\n  script: [a]\n',
  'stages не список': 'stages: build\nbuild:\n  script: [a]\n',
  'stages алиас': 'x: &x [a]\nstages: *x\nbuild:\n  script: [a]\n',
  'корень список': '- a\n- b\n',
  'корень скаляр': 'abc\n',
  'ошибка YAML': 'a: [\n',
  'CRLF': 'stages:\r\n  - build\r\nbuild:\r\n  stage: build\r\n  script:\r\n    - a\r\n',
  'без перевода в конце': 'stages:\n  - build\nbuild:\n  stage: build\n  script:\n    - a',
  'якорь и слияние': '.t: &t\n  image: i\n  script: [a]\nbuild:\n  <<: *t\n  stage: build\nother:\n  <<: *t\n',
  'значение с якорем': 'a: &s manual\nbuild:\n  when: *s\n  script: &sc [x]\n  stage: test\nt2:\n  script: *sc\n',
  'кавычки': '"build":\n  "stage": "build"\n  script: [\'a\']\n  needs: ["test", \'other\']\n\'test\':\n  stage: \'test\'\n  script: x\nother:\n  script: y\n',
  'числа в именах': '1:\n  stage: 2\n  script: x\n2:\n  needs: [1]\n  script: y\n  dependencies: 1\nstages: [1, 2]\n',
  'кириллица': 'этапы: 1\nstages: [сборка, тест]\nсобрать:\n  stage: сборка\n  script: [эхо]\nпроверить:\n  stage: тест\n  needs: [собрать]\n  script: [😀]\n',
  'повтор ключа задания': 'build:\n  script: a\nbuild:\n  script: b\n',
  'задание не словарь': 'a: 1\nb: [1]\nc:\nd:\n  script: x\n',
  'пустые значения': 'build:\n  stage:\n  script:\n  needs:\n  image: ~\n  tags: []\n  rules: {}\ntest:\n  script: x\n',
  'блочные значения': 'build:\n  image: |\n    a\n  stage: >-\n    b\n  when: "manual"\n  script: |\n    x\n    y\n  after_script: >\n    z\n',
  'значение на следующей строке': 'build:\n  image:\n    name: a\n    # c\n  script:\n    # перед шагом\n    - a\n  stage:\n    x\n',
  'комментарий у ключа': 'build: # о задании\n  script: # о шагах\n    - a\n  stage: x # о этапе\ntest: # о тесте\n  script: y\n',
  'документ с началом': '---\nstages: [a]\nbuild:\n  stage: a\n  script: x\n...\n',
  'needs словарём': 'a:\n  needs: {job: b}\n  script: x\nb:\n  needs:\n    - job: a\n      artifacts: false\n    - pipeline: x\n    - [a]\n    - 5\n  script: y\n',
};

const SET_FIELDS = [
  { stage: 'build' }, { stage: 'новый этап' }, { stage: '.pre' }, { stage: null }, { stage: '' },
  { image: 'alpine:3' }, { image: null }, { image: 'a: b' }, { image: '1' },
  { script: ['a', 'b  ', '', '  '] }, { script: 'x\ny\n' }, { script: [] }, { script: null },
  { before_script: ['b'] }, { before_script: null }, { after_script: 'c' }, { after_script: [] },
  { when: 'manual' }, { when: 'on_success' }, { when: null }, { when: 'bad' }, { when: 'never' },
  { allow_failure: true }, { allow_failure: false }, { allow_failure: null }, { allow_failure: 1 },
  { needs: ['a', 'b'] }, { needs: [] }, { needs: null }, { needs: 'one' },
  { tags: ['x'] }, { tags: [] }, { tags: null }, { tags: 'x\ny' },
  { environment: 'prod' }, { environment: null }, { environment: { name: 'n', url: 'u' } },
  { timeout: '2h' }, { timeout: null }, { timeout: 5 },
  { interruptible: true }, { interruptible: false }, { interruptible: null },
  { rules: [{ if: ' $A ', when: 'manual', allow_failure: true }, { when: 'on_success' }, {}] }, { rules: [] }, { rules: null },
  { artifacts: {} },
  { stage: 'a', image: 'b', when: 'always', tags: ['t'] },
];

function opsFor(content, limit = Infinity) {
  const ops = [{ type: 'unknown' }];
  let names = [];
  let stages = [];
  try {
    const data = YAML.parseDocument(content, { uniqueKeys: false, logLevel: 'error' }).toJS();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      names = Object.keys(data).filter((k) => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && !['default', 'variables', 'workflow'].includes(k));
      const st = data.stages ?? data.types;
      stages = Array.isArray(st) ? st.map(String) : [];
    }
  } catch { /* ошибка YAML проверяется и так */ }
  stages = [...new Set([...stages, 'build', 'нет'])];
  const step = Math.max(1, Math.floor(names.length / limit));
  for (const name of [...names.filter((_, i) => i % step === 0).slice(0, limit), 'нет такого']) {
    ops.push({ type: 'deleteJob', name }, { type: 'renameJob', from: name, to: 'новое-имя' }, { type: 'renameJob', from: name, to: 'с: двоеточием' });
    for (const fields of limit === Infinity ? SET_FIELDS : SET_FIELDS.filter((_, i) => i % 4 === 0)) ops.push({ type: 'setJob', name, fields });
  }
  ops.push(
    { type: 'addJob', name: 'новое', stage: 'build', image: 'i', script: ['a', ' ', 'b '] },
    { type: 'addJob', name: 'новое', stage: 'этап2', script: 'x\n\ny' },
    { type: 'addJob', name: ' с пробелами ', stage: ' ', image: ' ' },
    { type: 'addJob', name: '1' },
    { type: 'addJob', name: '' },
    { type: 'addJob', name: 'stages' },
    { type: 'addJob', name: 'a'.repeat(256) },
    { type: 'addJob', name: 'a\nb' },
    { type: 'addStage', name: 'новый' }, { type: 'addStage', name: 'новый', index: 0 }, { type: 'addStage', name: 'новый', index: 1 }, { type: 'addStage', name: 'новый', index: 99 }, { type: 'addStage', name: 'новый', index: -1 },
    { type: 'addStage', name: 'build' }, { type: 'addStage', name: ' ' },
    { type: 'addStage', name: 'с: двоеточием, и запятой' },
  );
  for (const name of stages) {
    ops.push({ type: 'renameStage', from: name, to: 'другой' }, { type: 'renameStage', from: name, to: 'test' }, { type: 'deleteStage', name }, { type: 'moveStage', name, dir: -1 }, { type: 'moveStage', name, dir: 1 });
  }
  return ops;
}

function fileCases() {
  const out = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorynych-edit-'));
  const run = (name, language, fn) => {
    setLanguage(language);
    const repo = path.join(dir, 'repo');
    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'lf.yml'), 'a: 1\nb: 2\n');
    fs.writeFileSync(path.join(repo, 'crlf.yml'), 'a: 1\r\nb: 2\r\n');
    fs.writeFileSync(path.join(repo, 'bom.yml'), '\uFEFFa: 1\n');
    fs.writeFileSync(path.join(repo, 'bad.yml'), Buffer.from([0x61, 0xff, 0x0a]));
    const record2 = { name, language };
    try {
      record2.ok = json(fn(repo));
    } catch (error) {
      record2.error = { code: error.code ?? null, message: error.message, hint: error.hint ?? null };
    }
    const after = {};
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(repo, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(child);
        else after[child] = fs.readFileSync(path.join(repo, child)).toString('base64');
      }
    };
    walk('');
    record2.after = after;
    out.push(record2);
  };
  const sha = (text) => require('node:crypto').createHash('sha1').update(text).digest('hex');
  const save = (p) => (repo) => ciEdit.saveFile(repo, p);
  const scenarios = {
    'read lf': { read: 'lf.yml' }, 'read crlf': { read: 'crlf.yml' }, 'read bom': { read: 'bom.yml' }, 'read нет': { read: 'нет.yml' }, 'read битый': { read: 'bad.yml' }, 'read наружу': { read: '../x.yml' }, 'read абсолютный': { read: '/x.yml' }, 'read пустой': { read: '' },
    'save новый': { save: { path: 'new/deep/c.yaml', content: 'x: 1\r\ny: 2\n' } }, 'save lf': { save: { path: 'lf.yml', content: 'a: 2\n' } }, 'save crlf': { save: { path: 'crlf.yml', content: 'a: 2\nb: 3\r\n' } }, 'save bom': { save: { path: 'bom.yml', content: 'я: 1\n' } },
    'save совпал отпечаток': { save: { path: 'lf.yml', content: 'z: 1\n', baseHash: sha('a: 1\nb: 2\n') } }, 'save чужой отпечаток': { save: { path: 'lf.yml', content: 'z: 1\n', baseHash: 'abc' } }, 'save null при файле': { save: { path: 'lf.yml', content: 'z: 1\n', baseHash: null } }, 'save null без файла': { save: { path: 'n.yml', content: 'z: 1\n', baseHash: null } }, 'save отпечаток без файла': { save: { path: 'n.yml', content: 'z: 1\n', baseHash: 'abc' } },
    'save большой': { save: { path: 'lf.yml', content: 'x'.repeat(512 * 1024 + 1) } }, 'save граница': { save: { path: 'g.yml', content: 'x'.repeat(512 * 1024) } }, 'save большой кириллицей': { save: { path: 'lf.yml', content: 'я'.repeat(262145) } },
    'save не CI': { save: { path: 'a.txt', content: 'x' } }, 'save в .git': { save: { path: '.git/a.yml', content: 'x' } }, 'save вложенный .git': { save: { path: 'x/.git/y/a.yml', content: 'x' } }, 'save .github': { save: { path: '.github/a.yml', content: 'x' } }, 'save Jenkinsfile': { save: { path: 'ci/Jenkinsfile', content: 'x' } }, 'save jenkinsfile': { save: { path: 'jenkinsfile', content: 'x' } }, 'save YML': { save: { path: 'A.YML', content: 'x' } }, 'save наружу': { save: { path: '../a.yml', content: 'x' } }, 'save обратная черта': { save: { path: 'x\\y.yml', content: 'x' } },
    'diff': { diff: { path: 'lf.yml', content: 'a: 1\nb: 3\nc: 4\n' } }, 'diff crlf': { diff: { path: 'crlf.yml', content: 'a: 1\r\nb: 2\r\n' } }, 'diff нет': { diff: { path: 'нет.yml', content: 'x\n' } }, 'diff наружу': { diff: { path: '../x', content: 'x' } },
    'template gitlab': { template: 'gitlab' }, 'template github': { template: 'github' }, 'template нет': { template: 'jenkins' },
  };
  for (const language of ['ru', 'en']) {
    for (const [name, s] of Object.entries(scenarios)) {
      const fn = s.read !== undefined ? (repo) => ciEdit.readFile(repo, s.read) : s.save ? save(s.save) : s.diff ? (repo) => ciEdit.diffDraft(repo, s.diff) : (repo) => ciEdit.createFromTemplate(repo, { system: s.template });
      run(name, language, fn);
    }
    run('template существует', language, (repo) => {
      fs.writeFileSync(path.join(repo, '.gitlab-ci.yml'), 'x');
      return ciEdit.createFromTemplate(repo, { system: 'gitlab' });
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  // Большие тексты не нужны в файле: достаточно отпечатка
  for (const r of out) for (const [k, v] of Object.entries(r.after)) if (v.length > 2000) r.after[k] = { sha: sha(Buffer.from(v, 'base64')) };
  return { out, scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, s]) => [k, s.save?.content?.length > 2000 ? { ...s, save: { ...s.save, content: null, repeat: s.save.content.length, char: s.save.content[0] } } : s])) };
}

const [output, realDir] = process.argv.slice(2);
if (realDir) {
  const cases = [];
  const documents = {};
  for (const name of fs.readdirSync(realDir)) {
    const content = fs.readFileSync(path.join(realDir, name), 'utf8');
    documents[name] = content;
    for (const op of opsFor(content, 4)) {
      const { content: _, ...rest } = record(name, content, op);
      cases.push(rest);
    }
  }
  fs.writeFileSync(output, `${JSON.stringify({ documents, cases })}\n`);
  console.log(`случаев ${cases.length}`);
} else {
  const cases = [];
  for (const [name, content] of Object.entries(STYLED)) {
    for (const op of opsFor(content)) cases.push(record(name, content, op));
  }
  for (const op of opsFor(STYLED['обычный']).filter((_, i) => i % 7 === 0)) cases.push(record('обычный', STYLED['обычный'], op, 'en'));
  const { out, scenarios } = fileCases();
  fs.writeFileSync(path.join(__dirname, 'edit-parity.json'), `${JSON.stringify({ documents: STYLED, cases: cases.map(({ content, ...rest }) => ({ ...rest, ok: rest.ok ? { ...rest.ok } : undefined })), files: out, scenarios })}\n`);
  console.log(`правок ${cases.length}, файловых ${out.length}`);
}
