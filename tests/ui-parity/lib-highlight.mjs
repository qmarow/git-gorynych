// Сверка highlight (src/lib/highlight.ts) с прежним .js: язык по имени, подсветка настоящих файлов репозитория,
// фрагменты diff, наложение слоёв, поиск.
// node tests/ui-parity/lib-highlight.mjs <папка со старыми lib/*.js> <корень репозитория>
import fs from 'node:fs';
import path from 'node:path';
import { setup, importAs, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const rnd = random(41);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const int = (n) => Math.floor(rnd() * n);
const json = (v) => JSON.stringify(v);

// Настоящие файлы разных языков из репозитория (без node_modules, target, огромных эталонов)
const sources = [];
const walk = (dir, depth) => {
  if (depth > 5 || sources.length > 400) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'target', '.git', 'dist', 'release', 'webview'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth + 1);
    else if (fs.statSync(full).size < 60_000) sources.push(full);
  }
};
walk(repo, 0);

const NAMES = [
  'Dockerfile', 'dockerfile.dev', 'app.dockerfile', 'Makefile', 'CMakeLists.txt', 'Jenkinsfile', '.env', '.env.local', '.gitlab-ci.yml', 'a.JS', 'b.tsx', 'c.rs', 'd.py',
  'e.unknown', 'noext', '', 'dir/sub/x.go', 'x.min.js', 'X.YAML', 'a.b.c.json', '.bashrc', 'nginx.conf', 'file.', null, undefined, 'папка/файл.md', 'win\\path.cs',
];
const LINES = ['const x = "a"; // c', 'fn main() { println!("{}", 1); }', '/* открыт', 'ещё */ x', '<div class="a">&amp;</div>', 'SELECT * FROM t;', '', '  ', 'def f(): pass', '"""', 'x = 1 # к', '\t\tтаб'];

for (const language of ['ru', 'en']) {
  const [oldH, newH] = await Promise.all([importAs(path.join(oldDir, 'lib', 'highlight.js'), language), importAs(path.join(repo, 'src', 'lib', 'highlight.ts'), language)]);
  same('экспорт highlight', exportsOf(oldH), exportsOf(newH));

  for (const name of [...NAMES, ...sources.map((f) => path.relative(repo, f).replace(/\\/g, '/'))]) {
    same(`detectLanguage ${name}`, oldH.detectLanguage(name), newH.detectLanguage(name));
  }
  for (const lang of [null, undefined, 'javascript', 'rust', 'нет', 'xml', 'plaintext']) same(`languageName ${lang}`, oldH.languageName(lang), newH.languageName(lang));

  // Подсветка настоящих файлов целиком и кусками
  let highlighted = 0;
  for (const file of sources) {
    const lang = oldH.detectLanguage(file.replace(/\\/g, '/'));
    if (!lang) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const a = oldH.highlightLines(lines, lang), b = newH.highlightLines(lines, lang);
    same(`highlightLines ${file}`, json(a), json(b));
    if (a) highlighted++;
    const from = int(lines.length);
    const part = lines.slice(from, from + 1 + int(30));
    same(`highlightLines кусок ${file}`, json(oldH.highlightLines(part, lang)), json(newH.highlightLines(part, lang)));
  }
  same('подсвечено файлов (> 50)', highlighted > 50, true);
  for (const [lines, lang] of [[null, 'javascript'], [[], 'javascript'], [['x'], null], [['x'], 'нет'], [['a'.repeat(400_001)], 'javascript'], [Array.from({ length: 9_500 }, (_, n) => `const value${n} = "строка"; // ${n}`), 'javascript'], [LINES, 'javascript']]) {
    same(`highlightLines граничный ${lang}`, json(oldH.highlightLines(lines, lang)), json(newH.highlightLines(lines, lang)));
  }

  // Фрагменты diff
  for (let k = 0; k < 300; k++) {
    const hunks = Array.from({ length: 1 + int(3) }, () => ({
      lines: Array.from({ length: int(25) }, () => ({ t: pick([' ', ' ', '-', '+', '\\']), text: pick(LINES) })),
    }));
    const lang = pick(['javascript', 'rust', 'python', 'xml', 'sql', null, 'нет']);
    const enc = (r) => json(r && r.map((m) => [...m.entries()]));
    same(`highlightHunks ${lang}`, enc(oldH.highlightHunks(hunks, lang)), enc(newH.highlightHunks(hunks, lang)));
  }
  same('highlightHunks пусто', json(oldH.highlightHunks(null, 'javascript')), json(newH.highlightHunks(null, 'javascript')));

  // Слои строки: токены, изменённые куски, совпадения
  for (let k = 0; k < 2000; k++) {
    const text = pick(LINES) + pick(['', ' ', 'хвост', '  x  ']);
    const tokens = rnd() < 0.8 ? newH.highlightLines([text], 'javascript')?.[0] ?? null : null;
    const cutsOf = () => {
      const out = [];
      let p = 0;
      while (p < text.length) {
        const n = 1 + int(Math.max(1, text.length - p));
        out.push({ text: text.slice(p, p + n), changed: rnd() < 0.4 });
        p += n;
      }
      return out;
    };
    const segs = rnd() < 0.6 ? cutsOf() : null;
    const hits = rnd() < 0.5 ? Array.from({ length: int(3) }, (_, idx) => {
      const start = int(text.length + 2) - 1;
      return { start, end: start + int(5), idx, current: rnd() < 0.3 };
    }) : null;
    same(`layerLine ${json([text, segs, hits])}`, json(oldH.layerLine(text, { tokens, segs, hits })), json(newH.layerLine(text, { tokens, segs, hits })));
  }
  same('layerLine пусто', json(oldH.layerLine('')), json(newH.layerLine('')));
  same('layerLine без слоёв', json(oldH.layerLine('abc')), json(newH.layerLine('abc')));

  // Поиск
  const QUERIES = ['', null, 'a', 'A', 'строка', '.', '(', '[a-', 'x*', '^', 'a|', '\\d+', '(?<n>a)\\k<n>', 'ё', '😀'];
  const TEXTS = ['', null, 'aAa', 'строка Строка', 'a.b(c)', 'x😀y', '123 45', 'aaa'];
  for (const query of QUERIES) {
    for (const regex of [false, true]) {
      for (const caseSensitive of [false, true]) {
        const a = oldH.searchRegex(query, { regex, caseSensitive }), b = newH.searchRegex(query, { regex, caseSensitive });
        same(`searchRegex ${query} ${regex} ${caseSensitive}`, json({ re: a.re && String(a.re), error: a.error }), json({ re: b.re && String(b.re), error: b.error }));
        for (const text of TEXTS) {
          for (const limit of [undefined, 1, 2]) {
            const ra = a.re && new RegExp(a.re.source, a.re.flags), rb = b.re && new RegExp(b.re.source, b.re.flags);
            same(`findAll ${query} ${text}`, json(oldH.findAll(text, ra, limit)), json(newH.findAll(text, rb, limit)));
          }
        }
      }
    }
  }
  // findAll вызывают и с регуляркой, которая совпадает с пустой строкой (не через searchRegex): пустые совпадения пропускаются
  for (const source of ['x*', '(?=a)', 'a*', '\\b']) {
    for (const text of TEXTS) same(`findAll пустые ${source} ${text}`, json(oldH.findAll(text, new RegExp(source, 'g'))), json(newH.findAll(text, new RegExp(source, 'g'))));
  }
  same('searchRegex без опций', json(String(oldH.searchRegex('a').re)), json(String(newH.searchRegex('a').re)));
}
console.log(`совпало проверок: ${count()}, файлов в корпусе: ${sources.length}`);
