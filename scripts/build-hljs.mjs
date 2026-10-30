// Пересборка src/vendor/hljs.js — подсветка синтаксиса (highlight.js: ядро + выбранные языки) одним файлом.
// Нужна только при добавлении языков:  npm i -D highlight.js esbuild && node scripts/build-hljs.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';

export const LANGUAGES = [
  'javascript', 'typescript', 'xml', 'css', 'scss', 'less', 'json', 'yaml', 'markdown', 'python', 'java', 'kotlin', 'c', 'cpp',
  'csharp', 'go', 'rust', 'php', 'ruby', 'bash', 'shell', 'powershell', 'sql', 'dockerfile', 'makefile', 'ini', 'properties',
  'groovy', 'swift', 'dart', 'lua', 'perl', 'r', 'scala', 'objectivec', 'nginx', 'graphql', 'protobuf', 'cmake', 'vbnet',
  'erlang', 'elixir', 'haskell', 'clojure', 'fsharp', 'julia', 'vim', 'apache', 'twig', 'handlebars', 'django', 'latex', 'wasm',
  'x86asm', 'plaintext',
];

const require = createRequire(import.meta.url);
const version = require('highlight.js/package.json').version;
const entry = [
  "import hljs from 'highlight.js/lib/core';",
  ...LANGUAGES.map((l, i) => `import l${i} from 'highlight.js/lib/languages/${l}';\nhljs.registerLanguage('${l}', l${i});`),
  'export default hljs;',
].join('\n');

const res = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'none',
  write: false,
});
const header = `/* highlight.js ${version} — BSD 3-Clause License (c) 2006 Ivan Sagalaev и авторы, https://github.com/highlightjs/highlight.js.
   Ядро и ${LANGUAGES.length} языков собраны в один файл, чтобы не требовать npm install. Пересборка: scripts/build-hljs.mjs */\n`;
fs.writeFileSync(new URL('../src/vendor/hljs.js', import.meta.url), header + res.outputFiles[0].text);
console.log(`src/vendor/hljs.js: highlight.js ${version}, ${LANGUAGES.length} языков`);
