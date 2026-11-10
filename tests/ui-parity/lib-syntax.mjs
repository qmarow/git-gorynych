// Сверка syntax (src/lib/syntax.tsx) с прежним .jsx: подсветка YAML и Groovy для редактора CI.
// JSX в Node не исполняется: обе копии проходят через esbuild (зависимость Vite) хуком загрузки.
// Элементы сравниваются по устройству — тип, key, класс, дети, — поэтому видна и смена key.
// node tests/ui-parity/lib-syntax.mjs <папка со старым lib/syntax.jsx> <корень репозитория>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setup, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const require = createRequire(path.join(repo, 'package.json'));
const esbuild = require('esbuild');
const runtimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react/jsx-runtime') return { url: runtimeUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const clean = url.split(/[?#]/)[0];
    if (!/\.(jsx|tsx)$/.test(clean)) return next(url, context);
    const source = fs.readFileSync(fileURLToPath(clean), 'utf8');
    const { code } = esbuild.transformSync(source, { loader: clean.endsWith('.tsx') ? 'tsx' : 'jsx', jsx: 'automatic', format: 'esm' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
const { same, count } = checker();
const rnd = random(71);
const pick = (list) => list[Math.floor(rnd() * list.length)];

// Устройство результата: строки как есть, элементы — [тип, key, className, дети]
const shape = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(shape);
  return [node.type, node.key, node.props?.className, shape(node.props?.children)];
};
const enc = (v) => JSON.stringify(shape(v));

// Строки настоящих файлов CI репозитория и граничные
const corpus = [];
const walk = (dir, depth) => {
  if (depth > 6) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'target', '.git', 'dist', 'release'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth + 1);
    else if (/(\.ya?ml|Jenkinsfile|\.groovy|\.cjs)$/.test(entry.name) && fs.statSync(full).size < 200_000) corpus.push(...fs.readFileSync(full, 'utf8').split('\n'));
  }
};
walk(repo, 0);
const EDGE = [
  '', null, undefined, 'key: value', '- item', '  - name: "x # не комментарий"', 'a: b # комментарий', "k: 'it''s'", 'x: ${{ github.sha }}', 'y: $VAR ${OTHER}', 'z: &anchor', 'w: *ref', 't: !reference [a, b]',
  'n: 12.5', 'b: true', 'yes: no', '"quoted key": 1', "'q': 2", '#только комментарий', '  # отступ', 'url: http://x#frag', 'stage(\'build\') { // c', 'sh "make ${X}"', "echo 'a\\'b'", 'pipeline {', 'def x = 1 // ok', '"a//b"', 'post { always { echo "a" } success { x } failure { sh "b" } }', 'environment { input parameters }',
];

const oldS = await import(pathToFileURL(path.join(oldDir, 'lib', 'syntax.jsx')).href);
const newS = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'syntax.tsx')).href);
same('экспорт syntax', exportsOf(oldS), exportsOf(newS));
for (const line of [...EDGE, ...corpus]) {
  for (const lang of ['yaml', 'groovy', null, 'нет']) same(`highlight ${lang} ${JSON.stringify(line)}`, enc(oldS.highlight(line, lang)), enc(newS.highlight(line, lang)));
}
for (let k = 0; k < 3000; k++) {
  const line = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(EDGE.filter((x) => typeof x === 'string'))).join(pick([' ', '', ': ', ' # ']));
  const lang = pick(['yaml', 'groovy']);
  same(`highlight случайная ${lang} ${JSON.stringify(line)}`, enc(oldS.highlight(line, lang)), enc(newS.highlight(line, lang)));
}
console.log(`совпало проверок: ${count()}, строк в корпусе: ${corpus.length}`);
