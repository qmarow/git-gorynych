// Эталон для tests/yaml_parity.rs: настоящие parseYaml (electron/ci.cjs) и Positions (electron/ciCheckBase.cjs).
// Запуск из корня репозитория:
//   node crates/gorynych-ci-linter/tests/fixtures/gen-yaml-parity.cjs                   — случаи из этого файла, в yaml-parity.json
//   node crates/gorynych-ci-linter/tests/fixtures/gen-yaml-parity.cjs <выход.json> <папка>… — внешний корпус (см. тест yaml_corpus)
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const YAML = require(path.join(root, 'electron/vendor/yaml.cjs'));
const { parseYaml } = require(path.join(root, 'electron/ci.cjs'));
const { Positions } = require(path.join(root, 'electron/ciCheckBase.cjs'));

const special = (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? '$nan' : v > 0 ? '$inf' : '$-inf') : v);
const json = (v) => JSON.parse(JSON.stringify(v, special));

// Конструкции с намеренными отличиями: см. шапку yaml.rs
function knownDifference(doc) {
  let reason = null;
  YAML.visit(doc, {
    Pair(_, pair) {
      if (YAML.isCollection(pair.key) || YAML.isAlias(pair.key)) reason = 'составной ключ';
    },
    Node(_, node) {
      if (typeof node.tag === 'string' && /:(binary|set|omap|pairs|timestamp|map|seq)$/.test(node.tag)) reason = `тег ${node.tag}`;
    },
  });
  return reason;
}

function record(name, text) {
  const parsed = parseYaml(text, 'f');
  const plainDoc = YAML.parseDocument(text, { uniqueKeys: false, logLevel: 'error', customTags: [{ tag: '!reference', collection: 'seq', resolve: (s) => s }] });
  let plain;
  try {
    plain = json(plainDoc.toJS({ maxAliasCount: 1000 }) ?? null);
  } catch (e) {
    plain = { $error: e.message };
  }
  const positions = new Positions([{ path: 'f', text }]);
  const paths = [];
  const visit = (node, p) => {
    if (YAML.isMap(node)) {
      for (const pair of node.items) {
        const key = YAML.isScalar(pair.key) ? pair.key.value : null;
        // Путь в коде линтера — строки и индексы: другие числа в нём не встречаются
        if (typeof key === 'string' || (Number.isSafeInteger(key) && key >= 0)) {
          paths.push({ path: [...p, key], line: positions.line('f', [...p, key]) });
          visit(pair.value, [...p, key]);
          // Строка вместо числового ключа: getIn сравнивает строго, а последний сегмент — через String
          if (typeof key === 'number') {
            paths.push({ path: [...p, String(key)], line: positions.line('f', [...p, String(key)]) });
            paths.push({ path: [...p, String(key), 'x'], line: positions.line('f', [...p, String(key), 'x']) });
          }
        }
      }
    } else if (YAML.isSeq(node)) {
      node.items.forEach((item, i) => {
        paths.push({ path: [...p, i], line: positions.line('f', [...p, i]) });
        visit(item, [...p, i]);
      });
    }
  };
  visit(plainDoc.contents, []);
  // Пути, которых нет: откат к ближайшему родителю
  paths.push({ path: ['нет такого ключа'], line: positions.line('f', ['нет такого ключа']) });
  if (paths[0]) paths.push({ path: [...paths[0].path, 'нет', 3], line: positions.line('f', [...paths[0].path, 'нет', 3]) });
  const errors = parsed.errors.filter((e) => e.severity === 'error');
  return {
    name,
    text,
    hasError: errors.length > 0,
    semanticError: errors.find((e) => e.line === null || /multiple documents/.test(e.message)) ?? null,
    warnings: parsed.errors.filter((e) => e.severity === 'warning').length,
    data: json(parsed.data),
    plain,
    lines: parsed.lines,
    paths,
    duplicates: positions.duplicates('f'),
    known: knownDifference(plainDoc),
  };
}

const SCALARS = ['', '~', 'null', 'Null', 'NULL', 'nUll', 'true', 'True', 'TRUE', 'tRue', 'false', 'False', 'FALSE', 'yes', 'no', 'on', 'off', 'y', 'n',
  '0', '1', '-1', '+1', '-0', '+0', '007', '0o7', '0o17', '0o8', '0O7', '0x1F', '0x1f', '0X1F', '0xG', '-0x1', '0b101', '1_000', '123456789012345678901234567890', '9007199254740993',
  '1.5', '-1.5', '+1.5', '.5', '-.5', '5.', '1.', '.', '1.10', '1.2.3', '1e3', '1E3', '1e+3', '1e-3', '1.5e3', '.5e3', '5.e3', 'e3', '1e', '1e400', '-1e400', '1e21', '1e-7', '0.000001', '100000000000000000000', '1000000000000000000000',
  '.inf', '.Inf', '.INF', '+.inf', '-.inf', '-.INF', '.iNf', '.nan', '.NaN', '.NAN', '+.nan', '-.nan', 'nan', 'inf', '12:30:00', '2001-12-14', '2001-12-14t21:59:43.10-05:00',
  '"1"', "'1'", '"true"', '"null"', '""', "''", '"a\\nb"', "'it''s'", '"\\u0416"', '"\\x41"', 'hello world', 'a: b', 'a:b', 'a #comment', 'a#b', 'ж', '😀', '!!str 1', '!!str', '!!int 1', '!!int "12"', '!!int abc', '!!int 1.5', '!!float 1', '!!float 1.5', '!!float "1.5"', '!!float abc', '!!bool true', '!!bool "true"', '!!bool 1', '!!null ""', '!!null x', '!!null ~', '! 1', '!foo 1', '!foo bar', '!<tag:yaml.org,2002:str> 1', '&a 1', '&a !!str 1', '!!str &a 1'];
const CASES = {};
SCALARS.forEach((s, i) => {
  CASES[`значение ${i}: ${s}`] = `v: ${s}\n`;
  if (!/^[!&]|: |#/.test(s) || s === '"a: b"') CASES[`ключ ${i}: ${s}`] = `${s}: x\nother: 1\n`;
  CASES[`элемент ${i}: ${s}`] = `- ${s}\n- z\n`;
  CASES[`в строку ${i}: ${s}`] = `[${s}, {${s}: 1}]\n`;
});
Object.assign(CASES, {
  'пустой файл': '',
  'только комментарий': '# ничего\n',
  'только ---': '---\n',
  'только null': 'null\n',
  'скаляр в корне': 'abc\n',
  'список в корне': '- a\n- b\n',
  'несколько документов': 'a: 1\n---\nb: 2\n',
  'несколько документов с началом': '---\na: 1\n---\nb: 2\n',
  'документ и конец': 'a: 1\n...\n',
  'ошибка после второго документа': 'a: 1\n---\nb: [\n',
  'целые ключи': 'b: 1\n2: 2\n1: 3\na: 4\n02: 5\n1.5: 6\n',
  'дубликаты': 'a: 1\nb: 2\na: 3\nc:\n  x: 1\n  x: 2\n  y:\n    z: 1\n    z: 2\n    w:\n      q: 1\n      q: 2\n      r:\n        s: 1\n        s: 2\n        t:\n          u: 1\n          u: 2\n',
  'дубликат <<': 'x: &x {a: 1}\ny:\n  <<: *x\n  <<: *x\n',
  'слияние': 'base: &b {a: 1, b: 2}\nj:\n  b: 9\n  <<: *b\n  a: 7\nk:\n  <<: *b\n  c: 3\n',
  'слияние список': 'a: &a {x: 1, y: 1}\nb: &b {x: 2, z: 2}\nc:\n  <<: [*a, *b]\n',
  'слияние встроенный словарь': 'c:\n  <<: {x: 1}\n  y: 2\n',
  'слияние встроенный список': 'c:\n  <<: [{x: 1}, {x: 2, y: 2}]\n',
  'слияние цепочка': 'a: &a {x: 1}\nb: &b\n  <<: *a\n  y: 2\nc:\n  <<: *b\n  z: 3\n',
  'слияние в кавычках': 'a: &a {x: 1}\nc:\n  "<<": *a\n',
  'слияние не словарь': 'a: &a 1\nc:\n  <<: *a\n',
  'слияние скаляр': 'c:\n  <<: x\n',
  'слияние пустое': 'c:\n  <<:\n',
  'слияние список со скаляром': 'c:\n  <<: [1]\n',
  'слияние числовые ключи': 'a: &a {2: x, 1: y, z: 1}\nc:\n  b: 0\n  <<: *a\n',
  'слияние null-ключ': 'a: &a {~: x}\nc:\n  <<: *a\n',
  'алиасы': 'a: &a [1, 2]\nb: *a\nc: {d: *a}\n',
  'алиас скаляра': 'a: &a x\nb: *a\n*a : y\n',
  'переопределение якоря': 'a: &x 1\nb: *x\nc: &x 2\nd: *x\n',
  'неизвестный алиас': 'a: *x\n',
  'бомба': 'a: &a ["x","x"]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]\n',
  'много алиасов ниже лимита': `a: &a 1\nb: [${Array(900).fill('*a').join(', ')}]\n`,
  'много алиасов выше лимита': `a: &a 1\nb: [${Array(1001).fill('*a').join(', ')}]\n`,
  'на единицу над лимитом': `a: &a 1\nb: [${Array(1000).fill('*a').join(', ')}]\n`,
  'числовые ключи в пути': '1:\n  x: 1\n  2:\n    y: 2\nz:\n  3: [a, b]\n',
  'ровно на лимите': `a: &a 1\nb: [${Array(999).fill('*a').join(', ')}]\n`,
  'алиас коллекции у лимита': `a: &a [1, 2]\nb: [${Array(999).fill('*a').join(', ')}]\n`,
  'reference': '.t:\n  script: [a]\nj:\n  script:\n    - !reference [.t, script]\n    - b\n  rules: !reference [.t, rules]\n',
  'reference блочный': 'j: !reference\n  - .t\n  - x\n',
  'reference на скаляре': 'j: !reference x\n',
  'reference на словаре': 'j: !reference {a: 1}\n',
  'блочные скаляры': 'a: |\n  x\n  y\nb: >\n  x\n  y\n\n  z\nc: |-\n  x\nd: >+\n  x\n\ne: |2\n    x\nf: |  # комментарий\n  x\ng: |\nh: >-\n\n  x\n',
  'блочный в списке': 's:\n  - |\n    x\n  - >-\n    y\n  -\n    z\n  - - a\n    - b\n',
  'якорь и тег перед коллекцией': 'a: &x\n  b: 1\nc: !!map\n  d: 2\ne: &y\n  - 1\nf: !t &z\n  # комментарий\n  - 2\ng: &w [1,\n  2]\nh: &v {a: 1}\n',
  'отступ без дефиса': 'a:\n- 1\n- 2\nb:\n- c: 1\n  d: 2\n- e: 3\n',
  'вложенные списки': '- - - a\n    - b\n  - c\n- d\n',
  'многострочные': 'a: x\n  y\n  z\nb: "x\n  y"\nc: \'x\n\n  y\'\n',
  'пустые значения': 'a:\nb: \nc: ~\nd: {}\ne: []\nf: ""\n',
  'явные ключи': '? a\n: 1\n? b\n? c\n: 3\n',
  'составной ключ': '? [a, b]\n: 1\n? {c: 1}\n: 2\n',
  'строчные': 'a: [1, 2, {b: c}, [d]]\ne: {f: 1, g, "h": 2, i: }\nj: [k: 1, l: 2]\n',
  'многострочный строчный': 'a: [\n  1,\n  2,\n]\nb: {\n  c: 1,\n  d: 2\n}\n',
  'комментарии': '# верх\na: 1 # справа\n# между\nb: # у ключа\n  # внутри\n  c: 2\n  # после\n# низ\n',
  'CRLF': 'a: 1\r\nb:\r\n  - x\r\n  - |\r\n    y\r\nc: 2\r\n',
  'кириллица': 'задание: значение\nключ с пробелом: 1\n"в кавычках": 2\nэмодзи 😀: {😀: 1}\nсписок:\n  - 😀\n  - я\n',
  'директива': '%YAML 1.2\n---\na: 1\n',
  'директива тега': '%TAG !e! tag:example.com,2000:\n---\na: !e!x 1\n',
  'длинный ключ': `${'k'.repeat(2000)}: 1\n`,
  'похожее на CI': 'include:\n  - local: a.yml\n  - template: B.gitlab-ci.yml\n\nstages: [build, test]\n\n.t: &t\n  image: node:20\n  before_script:\n    - npm ci\n\nbuild:\n  <<: *t\n  stage: build\n  script:\n    - npm run build\n    - |\n      echo "многострочно"\n      echo 2\n  rules:\n    - if: $CI_COMMIT_BRANCH == "main"\n      when: manual\n    - when: never\n  artifacts: {paths: [dist/], expire_in: 1 week}\n\ntest:\n  extends: .t\n  needs: [build]\n  script: !reference [build, script]\n  variables:\n    A: 1\n    B: "2"\n    C: 1.10\n    D: on\n',
  // Ошибки синтаксиса: сравнивается только то, что ошибка есть
  'ошибка незакрытая кавычка': 'a: "x\nb: 1\n',
  'ошибка незакрытая скобка': 'a: [1, 2\nb: 1\n',
  'ошибка табуляция': 'a:\n\tb: 1\n',
  'ошибка отступ': 'a:\n    b: 1\n  c: 2\n',
  'ошибка двоеточие': 'a: b: c\n',
  'ошибка дефис в словаре': 'a: 1\n- b\n',
  'ошибка закрывающая скобка': 'a: ]\n',
  'ошибка два якоря': 'a: &x &y 1\n',
  'ошибка экранирование': 'a: "\\q"\n',
});

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.ya?ml$/i.test(entry.name) || /(^|__).*\.ya?ml/.test(entry.name)) out.push(full);
  }
  return out;
}

const [output, ...dirs] = process.argv.slice(2);
if (output) {
  const files = dirs.flatMap((dir) => collectFiles(dir, []));
  const cases = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    try {
      cases.push(record(path.relative(path.dirname(dirs[0]), file), text));
    } catch (error) {
      cases.push({ name: file, skipped: error.message });
    }
  }
  fs.writeFileSync(output, `${JSON.stringify({ cases })}\n`);
  console.log(`файлов ${cases.length}, пропущено ${cases.filter((c) => c.skipped).length}`);
} else {
  const cases = Object.entries(CASES).map(([name, text]) => record(name, text));
  fs.writeFileSync(path.join(__dirname, 'yaml-parity.json'), `${JSON.stringify({ cases })}\n`);
  console.log(`случаев ${cases.length}, с ошибкой ${cases.filter((c) => c.hasError).length}`);
}
