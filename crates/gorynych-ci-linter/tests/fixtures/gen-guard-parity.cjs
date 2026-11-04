// Эталон для tests/guard_parity.rs: прогоняет настоящие electron/guard.cjs и RegExp из V8.
// Запуск из корня репозитория: node crates/gorynych-ci-linter/tests/fixtures/gen-guard-parity.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const { scanDiff, globToRe } = require(path.join(root, 'electron/guard.cjs'));

// Настоящие правила по умолчанию из интерфейса: модуль ESM, поэтому берём из него только литерал списка
const source = fs.readFileSync(path.join(root, 'src/lib/guardRules.js'), 'utf8');
const literal = source.slice(source.indexOf('export const DEFAULT_RULES = ') + 'export const DEFAULT_RULES = '.length, source.indexOf('\n];') + 2);
const DEFAULT_RULES = new Function('t', `return ${literal}`)((x) => x);

const clean = (value) => JSON.parse(JSON.stringify(value));

// --- Движок: шаблон × флаги × текст ---
const PATTERNS = [
  'abc', '\\bслово\\b', 'НЕ\\s*КОММИТИТЬ\\b', '\\bTODO\\b.*\\bубрать', '\\w+', '\\W+', '\\d+', '\\D+', '\\s+', '\\S+', '\\B.', '.', '.+', '^.$', '^..$', '^a', 'a$', '^$', '$',
  '[а-я]+', 'Ё', 'ё', 'σ', 'Σ', 'ς', 'ß', 'ſ', 's', 'K', 'k', '\\u212A', 'İ', 'ı', 'i',
  '😀', '[😀]', '\\u{1F600}', '[\\u{1F600}]', '\\uD83D', '\\uD83D\\uDE00', '[^a]', '[^]', '[]', '[\\s\\S]', '[\\d-x]', '[a-]', '[[]', '[]]', '[a-z&&[^b]]', '[\\b]', '[z-a]',
  '(?=b)', '(?!a)', 'a(?=b)', 'a(?!b)', '(?<=a)b', '(?<!a)b', '(a)\\1', '(?<n>a)\\k<n>', '\\k', '\\k<n>', '(?<n>a)(?<n>b)', '\\1', '\\2(a)', '\\8', '\\01', '\\0', '(a)|b\\1',
  '(', ')', '[', ']', '{', '}', '*', '+', '?', 'a{', 'a{1', 'a{1,', 'a{2,1}', 'a{1}', 'a{,2}', 'a**', 'a+?', 'a??', '(?', '(?:', '(?<', '(?<1>a)', '(?i)a', '(?#c)', '\\', 'a|', '|', '()', '(?:)', 'x*',
  '\\/', '\\-', '\\_', '\\a', '\\e', '\\A', '\\Z', '\\z', '\\Q', '\\h', '\\x41', '\\x4', '\\u0041', '\\u004', '\\u{41}', '\\u{2}', '\\u{1,2}', '\\u{', '\\\\u{2}', '[\\\\u{2}]', '[\\uD83D\\uDE00]', '[\\uD83D-\\uDE00]', '\\uDE00\\uD83D', '\\uD83D+', '[^\\uD83D]', '(?<\\u0041>a)', '(?<\\u{41}>a)', '\\u0041{2}', '[(?<\\u{2}]', '[(?<\\uD83D]>', '(?=\\u{2})', '(?<=\\u{2})a', '(?<!\\u{2})a', '(?!\\uD83D)', '\\cA', '\\c', '\\c1', '\\t', '\\n', '\\r', '\\v', '\\f',
  '\\p{L}+', '\\P{L}+', '\\p{Script=Cyrillic}+', '\\p{Lu}', '\\p{Unknown}', 'a.c', 'a\\.c', '^\\s*debugger', '(a+)+$', '(?:a|ab)c', '(a)?b', '(a*)*', '(?=(a))\\1', '^(?:<{7}|>{7}|={7})(?: |$)',
];
const FLAGS = ['', 'i', 'm', 's', 'u', 'iu', 'ms', 'ii', 'imsu'];
const TEXTS = [
  '', 'abc', 'ABC', 'a', 'b', 'ab', 'aa', 'aaa', 'aab', 'xab', 'a.c', 'axc', 'слово', 'СЛОВО', 'x слово y', 'aслово', 'НЕ КОММИТИТЬ', 'не  коммитить', 'НЕ КОММИТИТЬ x', 'TODO убрать', 'todo: убрать',
  'Ёж', 'ёж', 'σΣς', 'ß', 'SS', 'ſ', 'S', 's', 'K', 'k', 'K', 'İ', 'ı', 'I', 'i', '😀', 'x😀y', '\uD83D', '\uDE00', '123', '١٢٣', 'a_b', 'é', 'a\nb', '\n', 'a\r\nb', 'x y', 'x ', ' \t', ' ', '﻿', '\u0085', '᠎', '　',
  '<<<<<<< HEAD', '=======', '>>>>>>>', 'A', '/', '-', '_', '\b', '\x01', '\t', '\r', '\v', '\f', '\0', '[', ']', '{', '}', 'a{', 'a{1', 'a{,2}', 'k<n>', 'c', '\\c', 'cA', 'debugger', '  debugger;', 'ac', 'abc def', 'p{L}', 'u{41}', 'u004', 'x4', 'u', 'uu', 'uuu', '\\u', '\\u{2}', 'AA', 'uua', 'xa', '\u0002a',
];
const regex = [];
for (const pattern of PATTERNS) {
  for (const flags of FLAGS) {
    let re;
    try {
      re = new RegExp(pattern, flags);
    } catch {
      regex.push({ pattern, flags, invalid: true });
      continue;
    }
    // Занимает мало места: только совпавшие тексты, остальные — null
    const hits = TEXTS.map((text) => {
      const m = re.exec(text);
      return m ? [m.index, m.index + m[0].length] : null;
    });
    regex.push({ pattern, flags, hits });
  }
}

// --- Сворачивание регистра: все символы BMP и их варианты ---
const fold = [];
for (let code = 0; code < 0x10000; code++) {
  if (code >= 0xd800 && code <= 0xdfff) continue;
  const c = String.fromCharCode(code);
  const variants = new Set([c.toUpperCase(), c.toLowerCase(), c.toUpperCase().toLowerCase(), c.toLowerCase().toUpperCase()]);
  variants.delete(c);
  for (const v of variants) {
    if (v.length !== 1) continue;
    const escaped = `\\u${code.toString(16).padStart(4, '0')}`;
    fold.push([code, v.charCodeAt(0), new RegExp(escaped, 'i').test(v), new RegExp(escaped, 'iu').test(v)]);
  }
}

// --- Glob ---
const GLOBS = ['*.md', '**/*.min.js', '**/vendor/**', '**/dist/**', '**/*.test.*', '**/__tests__/**', 'docs/**', 'package-lock.json', 'docs/', './src/*.js', 'src\\*.js', ' *.TXT ', 'a?c', 'src/**', '**', '*', '?', './', '', '   ', 'a+b.(c)', '[x].md', 'файл*.txt', 'a{1}$^|.txt', 'src/**/x.js', '**x', '😀*', 'a**b', 'x/'];
const PATHS = ['README.md', 'docs/README.MD', 'docs/a/b.txt', 'docsx/a', 'a/b/c.min.js', 'c.min.js', 'vendor/x', 'a/vendor/x/y', 'vendor', 'dist/a', 'x/dist/a/b', 'a.test.js', 'x/a.test.ts', '__tests__/a', 'package-lock.json', 'a/package-lock.json', 'src/a.js', 'src/b/a.js', 'x/src/a.js', 'A.txt', 'b/a.txt', 'abc', 'a/c', 'x/abc', 'a+b.(c)', '[x].md', 'Файл1.TXT', 'папка/файл.txt', 'a{1}$^|.txt', 'src/x.js', 'src/k/l/x.js', 'bx', 'b/x', '😀a', 'aXb', 'a/b', 'x/y', 'x', 'é', 'a'];
const globs = GLOBS.map((glob) => {
  const re = globToRe(glob);
  return { glob, hits: re ? PATHS.map((file) => re.test(file)) : null };
});

// --- Разбор diff ---
const header = (name) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}`;
const hunk = (name, start, ...lines) => `${header(name)}\n@@ -0,0 +${start},${lines.length} @@\n${lines.map((x) => `+${x}`).join('\n')}\n`;
const LONG_SECRET = `glpat-${'x'.repeat(40)}`;
const r = (fields) => ({ id: 'r', label: 'L', ...fields });
const SCANS = [
  { name: 'пустой diff', diff: '', rules: DEFAULT_RULES },
  { name: 'правила по умолчанию', rules: DEFAULT_RULES.map((x) => ({ ...x, level: 'warn' })), diff: [
    hunk('a.js', 5, '  console.log(1)', 'debugger;', 'it.only("x", () => {})', 'const a = 1', 'console.debug (2)', 'console.log(1) // gorynych-ignore', 'console.log(1) // GUARD-IGNORE', 'console.log(1) // GitIdea-Ignore'),
    hunk('b.py', 1, 'print("x")', '   print ("y")', 'import pdb', 'breakpoint()', 'console.log("в питоне не проверяется")'),
    hunk('c.php', 1, 'var_dump($x);', 'dd($x)'),
    hunk('d.txt', 10, '<<<<<<< HEAD', '=======', '>>>>>>> branch', '======= ', ' <<<<<<< HEAD', 'TODO убрать', 'TODO: remove this', 'fixme temp', 'do not commit', 'НЕ КОММИТИТЬ', 'nocommit'),
    hunk('s.env', 1, 'AWS_SECRET_ACCESS_KEY=abcdefghijklmnop0123', 'token: AKIA0123456789ABCDEF', `x = "${LONG_SECRET}"`, 'Authorization: Bearer abcdefghijklmnopqrstuvwx==', 'password = "hunter2hunter2"', 'password = "short"', 'API_KEY: "абвгдежзий"', 'eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc', '-----BEGIN OPENSSH PRIVATE KEY-----', 'AIza' + 'y'.repeat(35), 'xoxb-1234567890', 'sk-test-' + 'z'.repeat(24), 'ghp_' + 'q'.repeat(36)),
  ].join('') },
  { name: 'русские и английские метки в правилах по умолчанию', rules: DEFAULT_RULES, diff: hunk('r.txt', 1, 'НЕ КОММИТИТЬ', 'не коммитить', '// не  коммитить!', 'xНЕ КОММИТИТЬ', 'НЕ КОММИТИТЬx', 'неНЕ КОММИТИТЬ', 'НЕ КОММИТИТЬСЯ', '_НЕ КОММИТИТЬ', 'DO NOT COMMIT', 'nocommit', 'aNOCOMMIT', 'NOCOMMITa', 'TODO: убрать это', 'FIXME временно', 'HACK: удалить', 'todo remove', 'TODO xубрать', 'TODOубрать', 'ЖTODO убрать', 'TODO: attempt', 'TODO: temp', 'x TODO y remove') },
  { name: 'уровни: block побеждает, при равенстве первое', diff: hunk('a.txt', 1, 'abc', 'xbz'), rules: [r({ id: 'w1', pattern: 'b', level: 'warn' }), r({ id: 'w2', pattern: 'a' }), r({ id: 'b1', pattern: 'c', level: 'block' }), r({ id: 'b2', pattern: 'x', level: 'block' }), r({ id: 'unk', pattern: 'z', level: 'off' })] },
  { name: 'первый block прекращает перебор', diff: hunk('a.txt', 1, 'abc'), rules: [r({ id: 'b1', pattern: 'a', level: 'block' }), r({ id: 'b2', pattern: 'b', level: 'block' })] },
  { name: 'расширения', diff: [hunk('a.JS', 1, 'q'), hunk('b.ts', 1, 'q'), hunk('.env', 1, 'q'), hunk('Makefile', 1, 'q'), hunk('dir.x/noext', 1, 'q'), hunk('c.tar.gz', 1, 'q')].join(''), rules: [r({ id: 'a', pattern: 'q', files: '*.js, .env ,makefile' }), r({ id: 'b', pattern: 'q', files: 'GZ  noext' }), r({ id: 'c', pattern: 'q', files: ' , ' , level: 'warn', label: 'все' })] },
  { name: 'только ts', diff: [hunk('a.js', 1, 'q'), hunk('b.ts', 1, 'q')].join(''), rules: [r({ pattern: 'q', files: 'ts' })] },
  { name: 'странные расширения', diff: [hunk('a.*js', 1, 'q'), hunk('b.js', 1, 'q')].join(''), rules: [r({ pattern: 'q', files: '*js' })] },
  { name: 'исключения', diff: [hunk('README.md', 1, 'q'), hunk('docs/a.txt', 1, 'q'), hunk('src/a.js', 1, 'q'), hunk('src/b.min.js', 1, 'q')].join(''), rules: [r({ pattern: 'q' })], exclude: ['*.md', 'docs/', '**/*.min.js', '', '  '] },
  { name: 'заголовки: удаление, кавычки, пробелы, двоичный', rules: [r({ pattern: 'q' })], diff: [
    'diff --git a/x b/x\n--- a/x\n+++ /dev/null\n@@ -1 +0,0 @@\n-q\n',
    'diff --git "a/с пробелом" "b/с пробелом"\n--- "a/с пробелом"\n+++ "b/с пробелом"\n@@ -0,0 +7 @@\n+q\n',
    'diff --git a/y b/y\n--- a/y\n+++ b/y  \n@@ -0,0 +1 @@\n+q\n',
    'diff --git a/bin b/bin\nBinary files a/bin and b/bin differ\n+q\n',
    'diff --git a/z b/z\n@@ -0,0 +1 @@\n+q\n',
    '+++ noprefix\n@@ -0,0 +1 @@\n+q\n',
  ].join('') },
  { name: 'добавленная строка с ++ считается заголовком', rules: [r({ pattern: 'q' })], diff: hunk('a.txt', 1, 'q', '++ fake.txt', 'q') },
  { name: 'добавленная строка -- и контекст', rules: [r({ pattern: 'q' })], diff: `${header('a')}\n@@ -1,3 +1,4 @@\n q\n-q\n--- q\n+q\n q\n+q\n\\ No newline at end of file\n` },
  { name: 'заголовок @@: номер', rules: [r({ pattern: 'q' })], diff: `${header('a')}\n@@ -1 @@ a+b +7\n+q\n@@ broken\n+q\n@@@ -1 +1 @@@\n+q\n` },
  { name: 'CRLF', rules: [r({ pattern: 'q$' })], diff: `${header('a')}\r\n@@ -0,0 +1 @@\r\n+q\r\n+ q\r\r\n` },
  { name: 'отступы и позиция', rules: [r({ pattern: 'q+' })], diff: hunk('a', 1, '    qq  ', '\t ﻿qq', '😀 qq', '  😀qq  ', 'q') },
  { name: 'совпадение в отступе', rules: [r({ pattern: '\\s+q', category: 'secret' }), r({ pattern: '^\\s+$' })], diff: hunk('a', 1, '    q', '    ', '   x') },
  { name: 'маска секрета', rules: [r({ pattern: 'S+', category: 'secret' })], diff: hunk('a', 1, 'S', 'x SSSSSSSS y', 'x SSSSSSSSS y', `  ${'S'.repeat(40)}!`, `😀${'S'.repeat(20)}😀`) },
  { name: 'секрет на границе 240', rules: [r({ pattern: 'S{20}', category: 'secret' })], diff: hunk('a', 1, `${'x'.repeat(100)}${'S'.repeat(20)}`, `${'x'.repeat(220)}${'S'.repeat(20)}`, `${'x'.repeat(221)}${'S'.repeat(20)}`, `${'x'.repeat(230)}${'S'.repeat(20)}y`, `${'x'.repeat(300)}${'S'.repeat(20)}`) },
  { name: 'обычное правило на границе 240', rules: [r({ pattern: 'S{20}' })], diff: hunk('a', 1, `${'x'.repeat(230)}${'S'.repeat(20)}`, `${'x'.repeat(300)}${'S'.repeat(20)}`) },
  { name: 'длинная строка: 4000', rules: [r({ pattern: 'END' })], diff: hunk('a', 1, `${'x'.repeat(3997)}END`, `${'x'.repeat(3998)}END`, `${'😀'.repeat(1998)}xEND`) },
  { name: 'метка за пределами 4000', rules: [r({ pattern: 'x' })], diff: hunk('a', 1, `${'x'.repeat(5000)} guard-ignore`) },
  { name: 'лимит 300', rules: [r({ pattern: 'q', level: 'block' })], diff: `${hunk('a', 1, ...Array(320).fill('q'))}${hunk('b', 1, 'q')}` },
  { name: 'ровно 299', rules: [r({ pattern: 'q' })], diff: hunk('a', 1, ...Array(299).fill('q'), 'x') },
  { name: 'недействительные правила', diff: hunk('a', 1, 'q'), rules: [r({ id: 'bad', pattern: '(' }), { label: 'без id', pattern: '[' }, { id: 'noflags', pattern: 'q', flags: 'ii' }, { id: 'nothing' }, { id: 'empty', pattern: '' }, { pattern: 'q', flags: 'gyxi' }] },
  { name: 'правило без полей', diff: hunk('a', 1, 'q'), rules: [{ pattern: 'q' }] },
  { name: 'флаг u и i', diff: hunk('a', 1, '😀', 'ЖУК'), rules: [{ id: 'u', pattern: '^.$', flags: 'u' }, { id: 'i', pattern: 'жук', flags: 'i' }] },
  { name: 'флаг без u: половина эмодзи', diff: hunk('a', 1, '😀'), rules: [{ id: 'n', pattern: '^.', category: 'secret' }] },
  { name: 'пустое совпадение секрета', diff: hunk('a', 1, 'abc', '  abc'), rules: [r({ pattern: 'x*', category: 'secret' })] },
  { name: 'файл повторяется', diff: `${hunk('a', 1, 'q')}${hunk('a', 9, 'q')}`, rules: [r({ pattern: 'q' })] },
];

// --- Случайные diff из фрагментов (детерминированный ГСЧ) ---
let seed = 20261104;
const rnd = (n) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % n;
};
const pick = (list) => list[rnd(list.length)];
const FRAGMENTS = ['console.log(x)', 'debugger', 'print(1)', 'TODO убрать', 'do not commit', 'password = "abcdefgh12"', 'AKIA0123456789ABCDEF', `glpat-${'k'.repeat(24)}`, 'ghp_' + 'n'.repeat(32), 'guard-ignore', '  ', '\t', '😀', 'ё', 'x', 'dd(', '=======', ' ', 'it.only(', 'Bearer ' + 'b'.repeat(24), ' ', 'слово', 'var_dump(1)'];
const NAMES = ['a.js', 'b.py', 'c.php', 'docs/r.md', 'src/x.min.js', 'файл.ts', 'Makefile', '.env', 'v/vendor/k.js'];
for (let i = 0; i < 150; i++) {
  let diff = '';
  for (let f = 0, fc = 1 + rnd(4); f < fc; f++) {
    const lines = [];
    for (let l = 0, lc = 1 + rnd(8); l < lc; l++) {
      let text = '';
      for (let t = 0, tc = rnd(5); t < tc; t++) text += pick(FRAGMENTS);
      lines.push(text);
    }
    diff += hunk(pick(NAMES), 1 + rnd(500), ...lines);
  }
  const rules = DEFAULT_RULES.map((x) => ({ ...x, level: pick(['warn', 'warn', 'block']) }));
  SCANS.push({ name: `случайный ${i}`, diff, rules, exclude: pick([[], ['*.md'], ['**/vendor/**', '**/*.min.js']]) });
}

// Половина суррогатной пары в JSON не сохранится: в 2.0 она становится U+FFFD (см. шапку guard.rs), это же делает toWellFormed
const wellFormed = (result) => ({ ...result, findings: result.findings.map((f) => ({ ...f, text: f.text.toWellFormed() })) });
const scans = SCANS.map((c) => ({ name: c.name, diff: c.diff, params: clean({ rules: c.rules, exclude: c.exclude ?? [] }), result: clean(wellFormed(scanDiff(c.diff, c.rules, c.exclude ?? []))) }));

// Тексты движка — единицами UTF-16: среди них есть половины суррогатных пар
const units = (text) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
fs.writeFileSync(
  path.join(__dirname, 'guard-parity.json'),
  `${JSON.stringify({ texts: TEXTS.map(units), paths: PATHS, regex, fold, globs, scans })}\n`,
);
console.log(`regex ${regex.length}, globs ${globs.length}, scans ${scans.length}, находок ${scans.reduce((n, s) => n + s.result.findings.length, 0)}`);
