// Подсветка синтаксиса кода в диффах и конфликтах (highlight.js — src/vendor/hljs.js)
// и наложение слоёв на строку: цвет токенов + изменённые куски + совпадения поиска.
import hljs from '../vendor/hljs.js';

/* =================== Язык по имени файла =================== */

const BY_NAME = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'cmake',
  jenkinsfile: 'groovy',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  vagrantfile: 'ruby',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.bash_profile': 'bash',
  '.htaccess': 'apache',
  'nginx.conf': 'nginx',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.gitmodules': 'ini',
  '.npmrc': 'ini',
  '.env': 'bash',
  '.gitlab-ci.yml': 'yaml',
};

const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'xml', htm: 'xml', xhtml: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', xaml: 'xml', csproj: 'xml', plist: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json', babelrc: 'json', eslintrc: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', pyw: 'python', pyi: 'python',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp', tpp: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust',
  php: 'php', phtml: 'php',
  rb: 'ruby', gemspec: 'ruby', rake: 'ruby',
  sh: 'bash', bash: 'bash', zsh: 'bash', ksh: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  sql: 'sql', mk: 'makefile', mak: 'makefile',
  ini: 'ini', cfg: 'ini', conf: 'ini', toml: 'ini', properties: 'properties',
  gradle: 'groovy', groovy: 'groovy', gvy: 'groovy',
  swift: 'swift', dart: 'dart', lua: 'lua', pl: 'perl', pm: 'perl', r: 'r',
  scala: 'scala', sc: 'scala', m: 'objectivec', mm: 'objectivec',
  graphql: 'graphql', gql: 'graphql', proto: 'protobuf', cmake: 'cmake', vb: 'vbnet',
  erl: 'erlang', hrl: 'erlang', ex: 'elixir', exs: 'elixir', hs: 'haskell',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', fs: 'fsharp', fsx: 'fsharp', jl: 'julia', vim: 'vim',
  tex: 'latex', twig: 'twig', hbs: 'handlebars', handlebars: 'handlebars', mustache: 'handlebars',
  jinja: 'django', j2: 'django', wat: 'wasm', wast: 'wasm', asm: 'x86asm', nasm: 'x86asm',
};

/** id языка highlight.js для файла или null (неизвестный тип — без подсветки) */
export function detectLanguage(path) {
  const name = String(path ?? '').split('/').pop().toLowerCase();
  if (!name) return null;
  if (BY_NAME[name]) return BY_NAME[name];
  if (/^dockerfile\b/.test(name) || name.endsWith('.dockerfile')) return 'dockerfile';
  if (/^\.env\./.test(name)) return 'bash';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return BY_EXT[ext] ?? null;
}

/** Название языка для подсказки */
export function languageName(lang) {
  return lang ? hljs.getLanguage(lang)?.name ?? lang : null;
}

/* =================== Токены =================== */

// Классы highlight.js → наши (цвета — CSS-переменные --syn-*, свои для светлой и тёмной темы)
const SCOPES = {
  keyword: 'tok-keyword',
  'selector-tag': 'tok-tag',
  built_in: 'tok-builtin',
  type: 'tok-type',
  literal: 'tok-number',
  number: 'tok-number',
  string: 'tok-string',
  regexp: 'tok-regex',
  'char.escape': 'tok-regex',
  symbol: 'tok-variable',
  comment: 'tok-comment',
  doc: 'tok-comment',
  quote: 'tok-comment',
  meta: 'tok-meta',
  'meta-keyword': 'tok-meta',
  'meta-string': 'tok-string',
  title: 'tok-func',
  'title.class_': 'tok-type',
  'title.class_.inherited__': 'tok-type',
  'title.function_': 'tok-func',
  'title.function_.invoke__': 'tok-func',
  attr: 'tok-attr',
  attribute: 'tok-attr',
  property: 'tok-attr',
  name: 'tok-tag',
  tag: 'tok-punct',
  'selector-id': 'tok-func',
  'selector-class': 'tok-func',
  'selector-attr': 'tok-attr',
  'selector-pseudo': 'tok-builtin',
  variable: 'tok-variable',
  'variable.language_': 'tok-keyword',
  'variable.constant_': 'tok-number',
  'template-variable': 'tok-variable',
  'template-tag': 'tok-keyword',
  bullet: 'tok-keyword',
  section: 'tok-func',
  link: 'tok-string',
  code: 'tok-string',
  punctuation: 'tok-punct',
  subst: 'tok-plain', // ${…} внутри строки — обычный код
  params: 'tok-plain',
  emphasis: 'tok-plain',
  strong: 'tok-plain',
};

function scopeClass(attr) {
  // "hljs-title function_" → "title.function_"; "language-xml" (вложенный язык) — без цвета
  const parts = attr.split(/\s+/).filter(Boolean);
  if (!parts[0]?.startsWith('hljs-')) return null;
  const scope = [parts[0].slice(5), ...parts.slice(1)].join('.');
  return SCOPES[scope] ?? SCOPES[scope.split('.')[0]] ?? null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#x27': "'", '#39': "'", '#x2F': '/' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => ENTITIES[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m));

const MAX_CHARS = 400_000;

/**
 * Подсветить несколько строк одним куском (многострочные строки и комментарии — правильно).
 * → массив той же длины: для каждой строки [{ text, cls }] (сумма text === строка) или null.
 */
export function highlightLines(lines, lang) {
  if (!lang || !lines?.length || !hljs.getLanguage(lang)) return null;
  const text = lines.join('\n');
  if (text.length > MAX_CHARS) return null;
  let html;
  try {
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  const out = [[]];
  const stack = [];
  const re = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) stack.push(scopeClass(m[1]));
    else if (m[0] === '</span>') stack.pop();
    else {
      let cls = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]) {
          cls = stack[i];
          break;
        }
      }
      if (cls === 'tok-plain') cls = null;
      const parts = decode(m[2]).split('\n');
      parts.forEach((p, i) => {
        if (i > 0) out.push([]);
        if (!p) return;
        const line = out[out.length - 1];
        const last = line[line.length - 1];
        if (last && last.cls === cls) last.text += p;
        else line.push({ text: p, cls });
      });
    }
  }
  // Проверка: текст токенов совпадает со строками — иначе лучше без подсветки, чем со сдвигом
  if (out.length !== lines.length) return null;
  for (let i = 0; i < lines.length; i++) {
    if (out[i].reduce((n, t) => n + t.text.length, 0) !== lines[i].length) return null;
  }
  return out;
}

/**
 * Токены для каждой строки фрагментов диффа: «было» (контекст и −) и «стало» (контекст и +)
 * подсвечиваются отдельно, как два куска файла. → [Map(индекс строки → токены)] по фрагментам или null.
 */
export function highlightHunks(hunks, lang) {
  if (!lang || !hunks?.length) return null;
  let total = 0;
  for (const h of hunks) for (const l of h.lines) total += l.text.length + 1;
  if (total > MAX_CHARS) return null;
  return hunks.map((h) => {
    const map = new Map();
    const oldIdx = [];
    const newIdx = [];
    h.lines.forEach((l, i) => {
      if (l.t === ' ' || l.t === '-') oldIdx.push(i);
      if (l.t === ' ' || l.t === '+') newIdx.push(i);
    });
    const oldTok = oldIdx.length ? highlightLines(oldIdx.map((i) => h.lines[i].text), lang) : null;
    const newTok = newIdx.length ? highlightLines(newIdx.map((i) => h.lines[i].text), lang) : null;
    oldIdx.forEach((i, k) => h.lines[i].t === '-' && oldTok && map.set(i, oldTok[k]));
    newIdx.forEach((i, k) => newTok && map.set(i, newTok[k]));
    return map;
  });
}

/* =================== Слои строки =================== */

/**
 * Разрезать строку по границам трёх слоёв.
 * tokens — [{ text, cls }] (подсветка), segs — [{ text, changed }] (что изменилось внутри строки),
 * hits — [{ start, end, idx, current }] (совпадения поиска).
 * → [{ text, cls, changed, ws (изменились только пробелы), hit: null | { idx, current } }]
 */
export function layerLine(text, { tokens, segs, hits } = {}) {
  if (!text) return [];
  const cuts = new Set([0, text.length]);
  const tokRanges = [];
  if (tokens) {
    let p = 0;
    for (const t of tokens) {
      tokRanges.push([p, p + t.text.length, t.cls]);
      p += t.text.length;
      cuts.add(p);
    }
  }
  const segRanges = [];
  if (segs) {
    let p = 0;
    for (const s of segs) {
      segRanges.push([p, p + s.text.length, s.changed, s.changed && /^\s+$/.test(s.text)]);
      p += s.text.length;
      cuts.add(p);
    }
  }
  for (const h of hits ?? []) {
    cuts.add(Math.max(0, Math.min(text.length, h.start)));
    cuts.add(Math.max(0, Math.min(text.length, h.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces = [];
  let ti = 0;
  let si = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k];
    const b = points[k + 1];
    if (a === b) continue;
    while (ti < tokRanges.length && tokRanges[ti][1] <= a) ti++;
    while (si < segRanges.length && segRanges[si][1] <= a) si++;
    const tok = tokRanges[ti] && tokRanges[ti][0] <= a ? tokRanges[ti] : null;
    const seg = segRanges[si] && segRanges[si][0] <= a ? segRanges[si] : null;
    const hit = hits?.find((h) => h.start <= a && h.end >= b) ?? null;
    const piece = { text: text.slice(a, b), cls: tok?.[2] ?? null, changed: Boolean(seg?.[2]), ws: Boolean(seg?.[3]), hit: hit ? { idx: hit.idx, current: hit.current } : null };
    const last = pieces[pieces.length - 1];
    if (last && last.cls === piece.cls && last.changed === piece.changed && last.ws === piece.ws && last.hit?.idx === piece.hit?.idx) last.text += piece.text;
    else pieces.push(piece);
  }
  return pieces;
}

/* =================== Поиск =================== */

/**
 * Регулярка для поиска: обычный текст или regex, с учётом регистра или без.
 * → { re } или { error } (неверное регулярное выражение).
 */
export function searchRegex(query, { regex = false, caseSensitive = false } = {}) {
  if (!query) return { re: null };
  try {
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(source, caseSensitive ? 'g' : 'gi');
    if (re.test('')) return { error: 'Выражение совпадает с пустой строкой' };
    re.lastIndex = 0;
    return { re };
  } catch (error) {
    return { error: `Неверное выражение: ${error.message.replace(/^Invalid regular expression: /, '')}` };
  }
}

/** Все совпадения в строке → [{ start, end }] */
export function findAll(text, re, limit = 200) {
  const out = [];
  if (!re || !text) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}
