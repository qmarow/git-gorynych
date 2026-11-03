// Правка CI-файлов: сохранение на диск, предпросмотр изменений и визуальные правки GitLab CI.
// Визуальные правки меняют YAML через Document API (комментарии сохраняются), а в файл переносятся
// только реально изменённые строки — остальное форматирование остаётся как было.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('./vendor/yaml.cjs');
const { safeRelative } = require('./git.cjs');
const { GitError } = require('./errors.cjs');
const { diffLines, toHunks } = require('./lineDiff.cjs');
const { t: tr } = require('./i18n.cjs');

const MAX_SIZE = 512 * 1024;
const hash = (text) => crypto.createHash('sha1').update(text).digest('hex');

/* =================== Чтение и сохранение =================== */

// Какие файлы можно сохранять: YAML-конфиги и Jenkinsfile внутри репозитория (не в .git)
function checkWritablePath(root, rel) {
  const full = safeRelative(root, rel);
  const relNorm = path.relative(root, full).replace(/\\/g, '/');
  if (relNorm.split('/').includes('.git')) throw new GitError(tr('Сюда писать нельзя'), { code: 'BAD_ARGS' });
  if (!/\.ya?ml$/i.test(relNorm) && path.basename(relNorm) !== 'Jenkinsfile') {
    throw new GitError(tr('Сохранять можно только файлы CI/CD (.yml, .yaml, Jenkinsfile)'), { code: 'BAD_ARGS' });
  }
  return full;
}

function readRaw(full) {
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null; // файла ещё нет
  }
}

/** Текст для редактора: без BOM, переводы строк — \n; плюс отпечаток для проверки «файл изменили снаружи» */
function fileState(raw) {
  if (raw === null) return { text: '', eol: '\n', bom: false, hash: null };
  const bom = raw.startsWith('﻿');
  const body = bom ? raw.slice(1) : raw;
  return { text: body.replace(/\r\n/g, '\n'), eol: body.includes('\r\n') ? '\r\n' : '\n', bom, hash: hash(raw) };
}

function saveFile(root, { path: rel, content, baseHash }) {
  if (typeof content !== 'string') throw new GitError(tr('Нет содержимого'), { code: 'BAD_ARGS' });
  if (Buffer.byteLength(content) > MAX_SIZE) throw new GitError(tr('Файл слишком большой'), { code: 'TOO_LARGE' });
  const full = checkWritablePath(root, rel);
  const current = readRaw(full);
  const state = fileState(current);
  // Файл поменяли в другом редакторе, пока здесь шла правка — не затираем молча
  if (baseHash !== undefined && state.hash !== baseHash) {
    throw new GitError(tr('Файл изменился на диске, пока вы его редактировали'), {
      code: 'CHANGED_ON_DISK',
      hint: tr('Нажмите «Перечитать», чтобы загрузить свежую версию, или сохраните поверх (ваши правки заменят изменения на диске).'),
    });
  }
  // Сохраняем в исходном стиле файла: те же переводы строк и BOM
  let out = content.replace(/\r\n/g, '\n');
  if (state.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  if (state.bom) out = `﻿${out}`;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.gk-tmp-${process.pid}`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, full);
  return { path: rel, hash: hash(out), created: current === null };
}

function readFile(root, rel) {
  const full = safeRelative(root, rel);
  const state = fileState(readRaw(full));
  return { path: rel, ...state, exists: state.hash !== null };
}

/** Предпросмотр: diff «на диске → черновик» в формате фрагментов, как у обычного просмотра изменений */
function diffDraft(root, { path: rel, content }) {
  const full = safeRelative(root, rel);
  const before = fileState(readRaw(full)).text;
  const after = String(content ?? '').replace(/\r\n/g, '\n');
  const a = before.split('\n');
  const b = after.split('\n');
  return { path: rel, ...toHunks(a, b, diffLines(a, b)) };
}

/* =================== Визуальные правки GitLab CI =================== */

const GITLAB_GLOBAL = new Set(['default', 'include', 'stages', 'types', 'variables', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script', 'spec']);
const DEFAULT_STAGES = ['build', 'test', 'deploy'];
const EDITABLE_FIELDS = new Set(['stage', 'image', 'script', 'before_script', 'after_script', 'when', 'allow_failure', 'needs', 'tags', 'environment', 'timeout', 'rules', 'interruptible']);
const WHEN_VALUES = new Set(['on_success', 'on_failure', 'always', 'manual', 'delayed', 'never']);

// Нестандартные теги (!reference) не трогаем — они сохраняются как есть
const parse = (text) => YAML.parseDocument(text, { keepSourceTokens: true, uniqueKeys: false, logLevel: 'error' });

function stringifyOptions(text) {
  // Стиль списков в файле: «key:\n  - a» (с отступом) или «key:\n- a» (без)
  const m = /^( *)[^\s#-][^:\n]*:\s*\n( *)- /m.exec(text);
  return { lineWidth: 0, flowCollectionPadding: false, indentSeq: m ? m[2].length > m[1].length : true };
}

const keyOf = (pair) => (YAML.isScalar(pair.key) ? String(pair.key.value) : String(pair.key));

function rootMap(doc) {
  if (doc.errors.length) {
    throw new GitError(tr('В файле есть ошибки YAML — сначала исправьте их во вкладке «Файл»'), {
      code: 'YAML_ERROR',
      details: doc.errors.map((e) => e.message.split('\n')[0]).join('\n'),
    });
  }
  if (doc.contents == null) doc.contents = doc.createNode({});
  if (!YAML.isMap(doc.contents)) throw new GitError(tr('Файл должен быть словарём (key: value) на верхнем уровне'), { code: 'YAML_ERROR' });
  return doc.contents;
}

const jobPairs = (map) => map.items.filter((p) => !GITLAB_GLOBAL.has(keyOf(p)) && YAML.isMap(p.value));

function findJob(map, name) {
  const pair = map.items.find((p) => keyOf(p) === name);
  if (!pair || !YAML.isMap(pair.value)) throw new GitError(tr('Задание «{0}» не найдено в этом файле', name), { code: 'NOT_FOUND' });
  return pair;
}

function validateName(map, name, { kind = tr('задание') } = {}) {
  const n = String(name ?? '').trim();
  if (!n) throw new GitError(tr('Введите имя ({0})', kind), { code: 'INVALID_NAME' });
  if (n.length > 255) throw new GitError(tr('Слишком длинное имя'), { code: 'INVALID_NAME' });
  if (/[\n\r]/.test(n)) throw new GitError(tr('Имя не может содержать перевод строки'), { code: 'INVALID_NAME' });
  if (kind === tr('задание')) {
    if (GITLAB_GLOBAL.has(n)) throw new GitError(tr('«{0}» — зарезервированное слово GitLab CI', n), { code: 'INVALID_NAME' });
    if (map.items.some((p) => keyOf(p) === n)) throw new GitError(tr('Задание «{0}» уже есть', n), { code: 'JOB_EXISTS' });
  }
  return n;
}

// Стадии: из ключа stages, либо стандартные
function stagesNode(doc, map, { create = false } = {}) {
  let pair = map.items.find((p) => keyOf(p) === 'stages' || keyOf(p) === 'types');
  if (!pair && create) {
    const used = new Set(jobPairs(map).map((p) => String(p.value.get('stage') ?? 'test')));
    const list = [...DEFAULT_STAGES.filter((s) => used.has(s) || DEFAULT_STAGES.includes(s))];
    for (const s of used) if (!list.includes(s) && s !== '.pre' && s !== '.post') list.push(s);
    const node = doc.createNode(list);
    node.flow = true;
    pair = doc.createPair('stages', node);
    // stages — в начало файла, после include
    const at = map.items.findIndex((p) => keyOf(p) !== 'include');
    map.items.splice(at === -1 ? map.items.length : at, 0, pair);
  }
  if (pair && !YAML.isSeq(pair.value)) throw new GitError(tr('stages должен быть списком'), { code: 'YAML_ERROR' });
  return pair?.value ?? null;
}

const stageNames = (seq) => (seq ? seq.items.map((n) => String(YAML.isScalar(n) ? n.value : n)) : [...DEFAULT_STAGES]);

// Заменяем имя задания во всех ссылках needs / dependencies / extends
function forEachRef(map, fn) {
  for (const pair of jobPairs(map)) {
    for (const key of ['needs', 'dependencies', 'extends']) {
      const node = pair.value.get(key, true);
      if (!node) continue;
      if (YAML.isScalar(node)) {
        fn({ job: keyOf(pair), key, node, scalar: node, parent: pair.value, mapKey: key });
        continue;
      }
      if (!YAML.isSeq(node)) continue;
      for (let i = node.items.length - 1; i >= 0; i--) {
        const item = node.items[i];
        const scalar = YAML.isScalar(item) ? item : YAML.isMap(item) ? item.get('job', true) : null;
        if (scalar && YAML.isScalar(scalar)) fn({ job: keyOf(pair), key, node, index: i, scalar, item, parent: pair.value });
      }
    }
  }
}

function setOrDelete(doc, jobMap, key, value) {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0 && key !== 'needs');
  if (empty) {
    jobMap.delete(key);
    return;
  }
  const existing = jobMap.get(key, true);
  const node = doc.createNode(value);
  // Короткие списки (needs, tags) оставляем в строку, если так было в файле
  if (YAML.isSeq(node) && (existing?.flow || ((key === 'needs' || key === 'tags') && !existing))) node.flow = true;
  if (YAML.isScalar(existing) && YAML.isScalar(node) && existing.type) node.type = existing.type;
  jobMap.set(key, node);
}

const OPS = {
  addJob(doc, map, { name, stage, image, script }) {
    const n = validateName(map, name);
    const st = String(stage ?? '').trim() || 'test';
    const job = { stage: st };
    if (image && String(image).trim()) job.image = String(image).trim();
    const lines = (Array.isArray(script) ? script : String(script ?? '').split('\n')).map((l) => String(l).trimEnd()).filter(Boolean);
    job.script = lines.length ? lines : [`echo "${n}"`];
    const pair = doc.createPair(n, doc.createNode(job));
    if (map.items.length) pair.key = Object.assign(doc.createNode(n), { spaceBefore: true }); // пустая строка перед заданием
    // Ставим после последнего задания того же этапа — так файл остаётся сгруппированным
    const jobs = jobPairs(map);
    const lastSame = [...jobs].reverse().find((p) => String(p.value.get('stage') ?? 'test') === st);
    const at = lastSame ? map.items.indexOf(lastSame) + 1 : map.items.length;
    map.items.splice(at, 0, pair);
    // Этап, которого нет в stages, GitLab не примет — добавим его
    const seq = stagesNode(doc, map);
    if (seq && !stageNames(seq).includes(st) && st !== '.pre' && st !== '.post') seq.items.push(doc.createNode(st));
    return { notes: [] };
  },

  deleteJob(doc, map, { name }) {
    const pair = findJob(map, name);
    map.items.splice(map.items.indexOf(pair), 1);
    const notes = [];
    forEachRef(map, (ref) => {
      if (String(ref.scalar.value) !== name || ref.key === 'extends') return;
      if (ref.index !== undefined) ref.node.items.splice(ref.index, 1);
      else ref.parent.delete(ref.key);
      if (ref.index !== undefined && ref.node.items.length === 0) ref.parent.delete(ref.key);
      notes.push(tr('«{0}»: убрано из {1}', ref.job, ref.key));
    });
    return { notes: [...new Set(notes)] };
  },

  renameJob(doc, map, { from, to }) {
    const pair = findJob(map, from);
    const n = validateName(map, to);
    if (YAML.isScalar(pair.key)) pair.key.value = n;
    else pair.key = doc.createNode(n);
    const notes = [];
    forEachRef(map, (ref) => {
      if (String(ref.scalar.value) !== from) return;
      ref.scalar.value = n;
      notes.push(tr('«{0}»: обновлена ссылка в {1}', ref.job, ref.key));
    });
    return { notes: [...new Set(notes)] };
  },

  setJob(doc, map, { name, fields }) {
    const pair = findJob(map, name);
    const job = pair.value;
    const notes = [];
    for (const [key, raw] of Object.entries(fields ?? {})) {
      if (!EDITABLE_FIELDS.has(key)) throw new GitError(tr('Поле {0} нельзя менять здесь', key), { code: 'BAD_ARGS' });
      let value = raw;
      if (['script', 'before_script', 'after_script', 'tags', 'needs'].includes(key) && value !== null && value !== undefined) {
        value = (Array.isArray(value) ? value : String(value).split('\n')).map((l) => String(l).trimEnd()).filter((l) => l.trim());
        if (key === 'script' && value.length === 0) throw new GitError(tr('У задания должен быть хотя бы один шаг script'), { code: 'BAD_ARGS' });
      }
      if (key === 'when' && value && !WHEN_VALUES.has(value)) throw new GitError(tr('Недопустимое значение when: {0}', value), { code: 'BAD_ARGS' });
      if (key === 'allow_failure' && value !== null && value !== undefined) value = Boolean(value);
      if (key === 'when' && value === 'on_success') value = null; // значение по умолчанию — не пишем
      if (key === 'allow_failure' && value === false) value = null;
      if (key === 'rules' && Array.isArray(value)) {
        value = value
          .map((r) => {
            const rule = {};
            if (r.if && String(r.if).trim()) rule.if = String(r.if).trim();
            if (r.when && r.when !== 'on_success') rule.when = r.when;
            // Правило без условия — «во всех остальных случаях»: when пишем явно, иначе правило пустое
            if (!rule.if && !rule.when) rule.when = 'on_success';
            if (r.allow_failure) rule.allow_failure = true;
            return rule;
          });
      }
      if (key === 'stage' && value) {
        const seq = stagesNode(doc, map);
        if (seq && !stageNames(seq).includes(value) && value !== '.pre' && value !== '.post') {
          seq.items.push(doc.createNode(value));
          notes.push(tr('Этап «{0}» добавлен в stages', value));
        }
      }
      setOrDelete(doc, job, key, value);
    }
    return { notes };
  },

  addStage(doc, map, { name, index }) {
    const n = validateName(map, name, { kind: tr('этап') });
    const seq = stagesNode(doc, map, { create: true });
    if (stageNames(seq).includes(n)) throw new GitError(tr('Этап «{0}» уже есть', n), { code: 'STAGE_EXISTS' });
    const at = Number.isInteger(index) ? Math.max(0, Math.min(seq.items.length, index)) : seq.items.length;
    seq.items.splice(at, 0, doc.createNode(n));
    return { notes: [] };
  },

  renameStage(doc, map, { from, to }) {
    const n = validateName(map, to, { kind: tr('этап') });
    const seq = stagesNode(doc, map, { create: true });
    const names = stageNames(seq);
    const i = names.indexOf(from);
    if (i === -1) throw new GitError(tr('Этап «{0}» не найден в stages', from), { code: 'NOT_FOUND' });
    if (names.includes(n)) throw new GitError(tr('Этап «{0}» уже есть', n), { code: 'STAGE_EXISTS' });
    if (YAML.isScalar(seq.items[i])) seq.items[i].value = n;
    else seq.items[i] = doc.createNode(n);
    let moved = 0;
    for (const pair of jobPairs(map)) {
      const st = pair.value.get('stage', true);
      if (YAML.isScalar(st) && String(st.value) === from) {
        st.value = n;
        moved++;
      }
    }
    return { notes: moved ? [tr('Перенесено заданий: {0}', moved)] : [] };
  },

  deleteStage(doc, map, { name }) {
    const seq = stagesNode(doc, map, { create: true });
    const i = stageNames(seq).indexOf(name);
    if (i === -1) throw new GitError(tr('Этап «{0}» не найден в stages', name), { code: 'NOT_FOUND' });
    const users = jobPairs(map).filter((p) => String(p.value.get('stage') ?? 'test') === name).map(keyOf);
    if (users.length) {
      throw new GitError(tr('В этапе «{0}» есть задания: {1}', name, users.join(', ')), {
        code: 'STAGE_NOT_EMPTY',
        hint: tr('Сначала перенесите или удалите эти задания'),
      });
    }
    seq.items.splice(i, 1);
    return { notes: [] };
  },

  moveStage(doc, map, { name, dir }) {
    const seq = stagesNode(doc, map, { create: true });
    const i = stageNames(seq).indexOf(name);
    const j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= seq.items.length) return { notes: [] };
    const [item] = seq.items.splice(i, 1);
    seq.items.splice(j, 0, item);
    return { notes: [] };
  },
};

// Переносим в исходный текст только строки, которые реально изменила правка
function minimalPatch(original, normOriginal, normEdited) {
  const orig = original.split('\n');
  const no = normOriginal.split('\n');
  const ne = normEdited.split('\n');

  // Соответствие строк нормализованного оригинала строкам исходного файла
  const origIndex = new Array(no.length).fill(null);
  const ops1 = diffLines(orig, no);
  let block = { dels: [], ins: [] };
  const flush = () => {
    for (let k = 0; k < Math.min(block.dels.length, block.ins.length); k++) origIndex[block.ins[k]] = block.dels[k];
    block = { dels: [], ins: [] };
  };
  for (const op of ops1) {
    if (op.type === 'equal') {
      flush();
      origIndex[op.b] = op.a;
    } else if (op.type === 'delete') block.dels.push(op.a);
    else block.ins.push(op.b);
  }
  flush();

  const skip = new Set();
  const out = [];
  let cursor = 0;
  const emitUntil = (i) => {
    for (; cursor < i; cursor++) if (!skip.has(cursor)) out.push(orig[cursor]);
  };
  for (const op of diffLines(no, ne)) {
    if (op.type === 'equal') {
      const i = origIndex[op.a];
      if (i !== null && i >= cursor) {
        emitUntil(i);
        if (!skip.has(i)) out.push(orig[i]);
        cursor = i + 1;
      }
    } else if (op.type === 'delete') {
      const i = origIndex[op.a];
      if (i !== null) {
        if (i >= cursor) emitUntil(i);
        skip.add(i);
        if (i >= cursor) cursor = i + 1;
      }
    } else {
      out.push(ne[op.b]);
    }
  }
  emitUntil(orig.length);
  return out.join('\n');
}

const sameData = (a, b) => {
  try {
    return JSON.stringify(parse(a).toJS()) === JSON.stringify(parse(b).toJS());
  } catch {
    return false;
  }
};

/** Применить визуальную правку к тексту файла. Возвращает { content, notes } */
function applyEdit(content, op) {
  const fn = OPS[op?.type];
  if (!fn) throw new GitError(tr('Неизвестная правка'), { code: 'BAD_ARGS' });
  const text = String(content ?? '').replace(/\r\n/g, '\n');
  const opts = stringifyOptions(text);
  const doc = parse(text);
  const map = rootMap(doc);
  const normOriginal = parse(text).toString(opts);
  const { notes } = fn(doc, map, op);
  const normEdited = doc.toString(opts);
  let result = minimalPatch(text, normOriginal, normEdited);
  // Страховка: если точечный перенос дал не тот результат — берём нормализованный текст целиком
  if (!sameData(result, normEdited)) result = normEdited;
  return { content: result, notes };
}

/* =================== Новый файл из шаблона =================== */

const TEMPLATES = {
  gitlab: {
    path: '.gitlab-ci.yml',
    get text() {
    return tr('# Пайплайн GitLab CI: этапы выполняются по порядку, задания одного этапа — параллельно\nstages: [build, test, deploy]\n\ndefault:\n  image: node:20\n\nbuild:\n  stage: build\n  script:\n    - npm ci\n    - npm run build\n  artifacts:\n    paths: [dist/]\n\ntest:\n  stage: test\n  script:\n    - npm ci\n    - npm test\n\ndeploy:\n  stage: deploy\n  script:\n    - echo "Деплой"\n  rules:\n    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH\n      when: manual\n');
  },
  },
  github: {
    path: '.github/workflows/ci.yml',
    text: `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`,
  },
};

function createFromTemplate(root, { system }) {
  const t = TEMPLATES[system];
  if (!t) throw new GitError(tr('Нет шаблона для этой системы'), { code: 'BAD_ARGS' });
  const full = checkWritablePath(root, t.path);
  if (readRaw(full) !== null) throw new GitError(tr('Файл {0} уже существует', t.path), { code: 'EXISTS' });
  return saveFile(root, { path: t.path, content: t.text, baseHash: null });
}

module.exports = { saveFile, readFile, diffDraft, applyEdit, minimalPatch, fileState, createFromTemplate };
