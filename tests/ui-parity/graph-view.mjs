// Вид таблицы коммитов (src/lib/graphView.ts) после раздела «Показывать» (этап 6.5): прежние поля normalizeView и moveColumn
// совпадают с копией до этого шага на случайном мусоре, новые флаги — булевы, по умолчанию true (всё видно, как раньше).
// Заменяет i18n-graph-view.mjs: тот сверял ещё и i18n с electron/i18n/en.json и не запускается с перехода на Fluent.
// Копия до шага: git show f423922:src/lib/graphView.ts > <old>/lib/graphView.ts
// node tests/ui-parity/graph-view.mjs <old> <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
globalThis.localStorage = { getItem: () => 'ru', setItem() {} };
const oldV = await import(pathToFileURL(path.join(oldDir, 'lib', 'graphView.ts')).href);
const newV = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphView.ts')).href);

let count = 0;
const fail = (what, ...info) => {
  console.error('РАСХОЖДЕНИЕ', what, ...info.map((x) => JSON.stringify(x)));
  process.exit(1);
};
const eq = (what, a, b) => {
  count++;
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(what, a, b);
};
const FLAGS = ['showRemote', 'showTags', 'showStash'];
const withoutFlags = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !FLAGS.includes(k)));

const rnd = random(17);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const junk = () => pick([undefined, null, true, false, 0, 1, '', 'x', 'true', [], {}, ['refs'], ['graph', 'graph', 'sha', 'nope', 7]]);
const COLS = ['refs', 'graph', 'message', 'sha', 'author', 'date', 'zzz', 5];
const list = () => (rnd() < 0.2 ? junk() : Array.from({ length: Math.floor(rnd() * 8) }, () => pick(COLS)));
for (let i = 0; i < 20000; i++) {
  const raw = rnd() < 0.05 ? junk() : {
    order: list(),
    hidden: list(),
    density: pick(['compact', 'standard', 'relaxed', 'нет', undefined, 3]),
    dateFormat: pick(['absolute', 'relative', 'x', null]),
    nodeStyle: pick(['avatar', 'dots', '', {}]),
    ...Object.fromEntries(FLAGS.filter(() => rnd() < 0.6).map((f) => [f, junk()])),
  };
  const a = oldV.normalizeView(raw);
  const b = newV.normalizeView(raw);
  eq('прежние поля', withoutFlags(b), a);
  for (const f of FLAGS) {
    const given = raw && typeof raw === 'object' ? raw[f] : undefined;
    eq(`флаг ${f}`, b[f], typeof given === 'boolean' ? given : true);
  }
  const order = b.order;
  const from = pick([...order, 'нет']);
  const target = pick([...order, 'нет']);
  const after = rnd() < 0.5;
  eq('moveColumn', newV.moveColumn(order, from, target, after), oldV.moveColumn(order, from, target, after));
}
eq('по умолчанию всё видно', FLAGS.map((f) => newV.DEFAULT_VIEW[f]), [true, true, true]);
eq('прежние значения по умолчанию', withoutFlags(newV.DEFAULT_VIEW), oldV.DEFAULT_VIEW);
eq('нормализация сохранённого вида', newV.normalizeView(JSON.parse(JSON.stringify(newV.normalizeView({ showTags: false, showStash: false })))), { ...newV.DEFAULT_VIEW, showTags: false, showStash: false });
for (const name of ['COLUMNS', 'COLUMN_IDS', 'DENSITY_OPTIONS', 'DATE_FORMAT_OPTIONS', 'NODE_STYLE_OPTIONS']) eq(name, newV[name], oldV[name]);
const exportsOf = (m) => Object.keys(m).sort().join(',');
eq('экспорт', exportsOf(newV), exportsOf(oldV));
console.log(`graph-view: совпало ${count} проверок`);
