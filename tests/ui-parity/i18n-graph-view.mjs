// Сверка src/i18n/index.ts и src/lib/graphView.ts с прежними .js (из HEAD~): t, tj, translateKnown на ru и en,
// normalizeView и moveColumn на случайном мусоре.
// node compare-i18n.mjs <папка old (i18n/index.js, lib/graphView.js)> <корень репозитория>
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const [oldDir, repo] = process.argv.slice(2);
const enPath = path.join(repo, 'electron', 'i18n', 'en.json');
const reactUrl = pathToFileURL(path.join(repo, 'node_modules', 'react', 'index.js')).href;

// JSON без `with { type: 'json' }` (так импортирует Vite) и react для копий вне репозитория
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('electron/i18n/en.json')) return { url: pathToFileURL(enPath).href + '#en', shortCircuit: true };
    if (specifier === 'react') return { url: reactUrl, shortCircuit: true };
    // `?lang=…` родителя переходит на относительные импорты: graphView получает i18n на том же языке
    const query = context.parentURL?.match(/\?lang=[^#]*/)?.[0];
    if (query && specifier.startsWith('.')) {
      const resolved = next(specifier, context);
      return { ...resolved, url: resolved.url.split('?')[0] + query };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('en.json#en')) return { format: 'module', source: `export default ${fs.readFileSync(enPath, 'utf8')};`, shortCircuit: true };
    return next(url, context);
  },
});

const { createElement } = await import(reactUrl);
const { renderToStaticMarkup } = await import(pathToFileURL(path.join(repo, 'node_modules', 'react-dom', 'server.node.js')).href);
const dict = JSON.parse(fs.readFileSync(enPath, 'utf8'));

let checks = 0;
const same = (what, a, b) => {
  checks++;
  if (a !== b) {
    console.error('РАСХОЖДЕНИЕ', what, '\nстарое:', String(a).slice(0, 300), '\nновое:', String(b).slice(0, 300));
    process.exit(1);
  }
};
const render = (node) => (typeof node === 'string' ? 's:' + node : 'h:' + renderToStaticMarkup(createElement('div', null, node)));

const keys = Object.keys(dict);
const sample = [
  ...keys.filter((k) => /\{\d+\}/.test(k)).slice(0, 400),
  ...keys.filter((k) => /<\d+>/.test(k)).slice(0, 200),
  ...keys.filter((_, i) => i % 37 === 0),
  'нет такого ключа {0} и {5}', 'без подстановок', '<0>незакрытый', 'лишний</1> тег', '<0><1>вложенный</1> {2}</0> хвост', '{0}{0}{1}', '',
];
const partsSets = [
  [],
  ['раз', 2, null],
  [createElement('b', { className: 'x' }), createElement('code'), 'строка', 7],
  [createElement('kbd', null, 'старое'), undefined, createElement('i')],
];
const argsSets = [[], ['а'], [1, 2, 3], [null, undefined, 0], ['x', { toString: () => 'объект' }]];

for (const language of ['ru', 'en', 'xx', null]) {
  globalThis.localStorage = { getItem: () => language, setItem() {} };
  const tag = `?lang=${language}`;
  const oldI = await import(pathToFileURL(path.join(oldDir, 'i18n', 'index.js')).href + tag);
  const newI = await import(pathToFileURL(path.join(repo, 'src', 'i18n', 'index.ts')).href + tag);
  same('getLanguage', oldI.getLanguage(), newI.getLanguage());
  same('locale', oldI.locale(), newI.locale());
  same('LANGUAGES', JSON.stringify(oldI.LANGUAGES), JSON.stringify(newI.LANGUAGES));
  for (const key of sample) {
    for (const args of argsSets) same(`t ${key}`, oldI.t(key, ...args), newI.t(key, ...args));
    same(`translateKnown ${key}`, oldI.translateKnown(key), newI.translateKnown(key));
    for (const parts of partsSets) same(`tj ${key}`, render(oldI.tj(key, parts)), render(newI.tj(key, parts)));
    same(`tj без parts ${key}`, render(oldI.tj(key)), render(newI.tj(key)));
  }
  for (const value of [5, null, undefined, { a: 1 }]) same('translateKnown не строка', oldI.translateKnown(value), newI.translateKnown(value));
  const exportsOf = (m) => Object.keys(m).sort().join(',');
  same('экспорт i18n', exportsOf(oldI), exportsOf(newI));

  const oldV = await import(pathToFileURL(path.join(oldDir, 'lib', 'graphView.js')).href + tag);
  const newV = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphView.ts')).href + tag);
  same('экспорт graphView', exportsOf(oldV), exportsOf(newV));
  for (const name of ['COLUMNS', 'COLUMN_IDS', 'DENSITY_OPTIONS', 'DATE_FORMAT_OPTIONS', 'NODE_STYLE_OPTIONS', 'DEFAULT_VIEW']) {
    same(name, JSON.stringify(oldV[name]), JSON.stringify(newV[name]));
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pool = ['refs', 'graph', 'message', 'sha', 'author', 'date', 'нет', '', null, 3, 'message'];
  const pickOne = (list) => list[Math.floor(rnd() * list.length)];
  const list = () => Array.from({ length: Math.floor(rnd() * 9) }, () => pickOne(pool));
  for (let i = 0; i < 3000; i++) {
    const raw = pickOne([
      null, undefined, 'строка', 42, [],
      { order: list(), hidden: list(), density: pickOne(['compact', 'relaxed', 'x', null]), dateFormat: pickOne(['relative', 'absolute', 1]), nodeStyle: pickOne(['dots', 'avatar', {}]) },
      { order: 'не массив', hidden: pickOne([undefined, 'нет', list()]) },
      { hidden: list() },
    ]);
    same('normalizeView', JSON.stringify(oldV.normalizeView(raw)), JSON.stringify(newV.normalizeView(raw)));
    const order = oldV.normalizeView(raw).order;
    const from = pickOne(pool), target = pickOne(pool), after = rnd() < 0.5;
    const a = oldV.moveColumn(order, from, target, after), b = newV.moveColumn(order, from, target, after);
    same('moveColumn', JSON.stringify(a), JSON.stringify(b));
    same('moveColumn тот же массив', a === order, b === order);
    same('columnById', JSON.stringify(oldV.columnById(from)), JSON.stringify(newV.columnById(from)));
  }
}
console.log(`совпало проверок: ${checks}`);
