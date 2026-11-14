// Новое в 2.0: проверка src/lib/markdownEdit.ts (редактор Markdown раздела «Задачи»). Эталона в 1.x нет — ожидаемые
// значения записаны здесь, плюс случайные проверки свойств.
// node tests/ui-parity/markdown-edit.mjs <корень репозитория>
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot] = process.argv.slice(2);
if (!repoRoot) throw new Error('usage: node tests/ui-parity/markdown-edit.mjs <корень репозитория>');
const m = await import(pathToFileURL(path.join(repoRoot, 'src/lib/markdownEdit.ts')).href);
let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks += 1;
};

/** Текст с курсором `|` или выделением `[…]` → значение и позиции. */
function at(text) {
  const caret = text.indexOf('|');
  if (caret >= 0) return { value: text.replace('|', ''), start: caret, end: caret };
  const start = text.indexOf('[[');
  const end = text.indexOf(']]') - 2;
  return { value: text.replace('[[', '').replace(']]', ''), start, end };
}
const show = (edit) => (edit ? (edit.start === edit.end ? edit.value.slice(0, edit.start) + '|' + edit.value.slice(edit.start) : edit.value.slice(0, edit.start) + '[[' + edit.value.slice(edit.start, edit.end) + ']]' + edit.value.slice(edit.end)) : null);
const run = (fn, text, ...args) => {
  const { value, start, end } = at(text);
  return show(fn(value, start, end, ...args));
};

/* ---------- Обёртка ---------- */

eq(run(m.wrapSelection, 'a [[bc]] d', '**', 'x'), 'a **[[bc]]** d');
eq(run(m.wrapSelection, 'a **[[bc]]** d', '**', 'x'), 'a [[bc]] d', 'повтор снимает');
eq(run(m.wrapSelection, 'a | d', '_', 'курсив'), 'a _[[курсив]]_ d');
eq(run(m.wrapSelection, '|', '`', 'код'), '`[[код]]`');
eq(run(m.insertLink, 'см [[тут]]', 'текст'), 'см [тут]([[https://]])');
eq(run(m.insertLink, '|', 'текст'), '[текст]([[https://]])');

/* ---------- Приставки строк ---------- */

eq(run(m.prefixLines, '[[a\nb]]', '- '), '[[- a\n- b]]');
eq(run(m.prefixLines, '[[- a\n- b]]', '- '), '[[a\nb]]', 'у всех есть — снимается');
eq(run(m.prefixLines, 'x\nab|c\ny', '> '), 'x\n> ab|c\ny');
eq(run(m.prefixLines, 'ab|c', '- [ ] '), '- [ ] ab|c');

/* ---------- Продолжение списка ---------- */

eq(run(m.continueList, '- один|'), '- один\n- |');
eq(run(m.continueList, '  * один|'), '  * один\n  * |');
eq(run(m.continueList, '1. один|'), '1. один\n2. |');
eq(run(m.continueList, '9) один|'), '9) один\n10) |');
eq(run(m.continueList, '- [x] готово|'), '- [x] готово\n- [ ] |');
eq(run(m.continueList, '- оди|н'), '- оди\n- |н', 'в середине строки — перенос с маркером');
eq(run(m.continueList, 'текст\n- |'), 'текст\n|', 'пустой пункт завершает список');
eq(run(m.continueList, '- [ ] |'), '|');
eq(run(m.continueList, 'не список|'), null);
eq(run(m.continueList, '-|- a'), null, 'курсор до текста пункта');
eq(run(m.continueList, '-нет пробела|'), null);
eq(run(m.continueList, '[[- a]]'), null, 'выделение');

/* ---------- Отступ ---------- */

eq(run(m.indentList, '- a\n- b|'), '- a\n  - b|');
eq(run(m.indentList, '  - b|', true), '- b|');
eq(run(m.indentList, ' - b|', true), '- b|');
eq(run(m.indentList, '[[- a\n- b]]'), '  [[- a\n  - b]]', 'выделение остаётся на тексте');
eq(run(m.indentList, 'просто|'), null);
eq(run(m.indentList, '[[- a\nтекст]]'), null, 'смешанное выделение — не список');

/* ---------- Подсказки ---------- */

eq(m.findTrigger('см #12', 6), { kind: '#', query: '12', at: 3 });
eq(m.findTrigger('#', 1), { kind: '#', query: '', at: 0 });
eq(m.findTrigger('привет @ив', 10), { kind: '@', query: 'ив', at: 7 });
eq(m.findTrigger('(@a', 3), { kind: '@', query: 'a', at: 1 });
eq(m.findTrigger('a@b', 3), null, 'почта');
eq(m.findTrigger('path#1', 6), null);
eq(m.findTrigger('#12 дальше', 10), null, 'после пробела');
eq(show(m.applyTrigger('см #1 и', 5, { kind: '#', query: '1', at: 3 }, '123')), 'см #123 | и');
eq(show(m.applyTrigger('@j', 2, { kind: '@', query: 'j', at: 0 }, 'john')), '@john |');

/* ---------- Цитата ---------- */

eq(m.quoteText('a\n\nb  \n'), '> a\n>\n> b\n\n');
eq(m.appendQuote('', 'x'), '> x\n\n');
eq(m.appendQuote('текст\n\n', 'x\ny'), 'текст\n\n> x\n> y\n\n');

console.log(`markdown-edit: ${checks} проверок`);
