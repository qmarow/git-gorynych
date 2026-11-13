// Подсветка поиска в графе (src/lib/searchMarks.ts, новое в 2.0): куски склеиваются в исходный текст, размечено каждое
// вхождение каждого слова и только они. Слова запроса matchCommit (SearchBar.tsx) берёт из того же searchWords.
// node tests/ui-parity/search-marks.mjs <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, random } from './hooks.mjs';

const [repo] = process.argv.slice(2);
setup(repo);
globalThis.localStorage = { getItem: () => 'ru', setItem() {} };
const { markSegments, searchWords } = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'searchMarks.ts')).href);

let count = 0;
const fail = (what, ...info) => {
  console.error('РАСХОЖДЕНИЕ', what, ...info.map((x) => JSON.stringify(x)));
  process.exit(1);
};
const eq = (what, a, b) => {
  count++;
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(what, a, b);
};

eq('слова', searchWords('  Fix   Bug '), ['fix', 'bug']);
eq('пустой запрос', searchWords('   '), []);
eq('без слов', markSegments('Fix bug', []), [['Fix bug', false]]);
eq('без регистра', markSegments('Fix the BUG', ['bug']), [['Fix the ', false], ['BUG', true]]);
eq('несколько вхождений', markSegments('aXa', ['a']), [['a', true], ['X', false], ['a', true]]);
eq('пересечения сливаются', markSegments('abcdef', ['bcd', 'cde']), [['a', false], ['bcde', true], ['f', false]]);
eq('соседние сливаются', markSegments('abcd', ['ab', 'cd']), [['abcd', true]]);
eq('кириллица', markSegments('Исправить Ошибку', ['ошиб']), [['Исправить ', false], ['Ошиб', true], ['ку', false]]);
eq('длина меняется при смене регистра — без разметки', markSegments('İstanbul', ['stan']), [['İstanbul', false]]);
eq('нет совпадений', markSegments('abc', ['x']), [['abc', false]]);

// Случайные тексты: склейка, разметка ровно по вхождениям и согласие с matchCommit
const rnd = random(5);
const alphabet = ['a', 'b', 'A', 'B', 'ё', 'Ё', ' ', '-', '1'];
const str = (n) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
for (let i = 0; i < 20000; i++) {
  const text = str(Math.floor(rnd() * 30));
  const query = str(1 + Math.floor(rnd() * 6));
  const words = searchWords(query);
  const parts = markSegments(text, words);
  if (parts.map((p) => p[0]).join('') !== text) fail('склейка', text, words, parts);
  // Размечено: символ внутри какого-нибудь вхождения
  const lower = text.toLowerCase();
  const covered = new Array(text.length).fill(false);
  for (const w of words) for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + 1)) for (let k = at; k < at + w.length; k++) covered[k] = true;
  let pos = 0;
  for (const [part, hit] of parts) {
    for (let k = pos; k < pos + part.length; k++) if (covered[k] !== hit) fail('разметка по вхождениям', text, words, parts);
    pos += part.length;
  }
  count += 2;
}
console.log(`search-marks: совпало ${count} проверок`);
