// Общие хуки загрузки для сверок: так модули интерфейса грузятся в Node, как в Vite.
// - `electron/i18n/en.json` без `with { type: 'json' }` (старые копии до перехода на Fluent; после удаления electron/ — из git);
// - `*.ftl?raw` (как в Vite) — текстом;
// - `react` из node_modules репозитория для копий вне репозитория;
// - `../i18n/index.(js|ts)` из старой копии → текущий `src/i18n/index.ts` (переводы общие, сверяется сам модуль);
// - `?lang=…` родителя переходит на относительные импорты: у каждого языка свой экземпляр модулей.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Последний коммит с electron/i18n/en.json (словарь 1.x для старых копий модулей)
const EN_JSON_COMMIT = 'b63610b';

export function setup(repo, { sharedI18n = true } = {}) {
  const enPath = path.join(repo, 'electron', 'i18n', 'en.json');
  // Словарь 1.x: файл, а после удаления electron/ — из истории git (последний коммит, где он был)
  const enJson = () =>
    fs.existsSync(enPath) ? fs.readFileSync(enPath, 'utf8') : execFileSync('git', ['show', `${EN_JSON_COMMIT}:electron/i18n/en.json`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  const reactUrl = pathToFileURL(path.join(repo, 'node_modules', 'react', 'index.js')).href;
  const i18nUrl = pathToFileURL(path.join(repo, 'src', 'i18n', 'index.ts')).href;
  const hljsUrl = pathToFileURL(path.join(repo, 'src', 'vendor', 'hljs.js')).href;
  registerHooks({
    resolve(specifier, context, next) {
      // Собранный highlight.js — общий для старой и новой копии
      if (/\/vendor\/hljs\.js$/.test(specifier)) return { url: hljsUrl, shortCircuit: true };
      if (specifier.endsWith('electron/i18n/en.json')) return { url: pathToFileURL(enPath).href + '#en', shortCircuit: true };
      if (specifier.endsWith('.ftl?raw')) {
        const resolved = next(specifier.slice(0, -'?raw'.length), context);
        return { url: resolved.url + '?raw', shortCircuit: true };
      }
      if (specifier === 'react') return { url: reactUrl, shortCircuit: true };
      const query = context.parentURL?.match(/\?lang=[^#]*/)?.[0] ?? '';
      if (sharedI18n && /\/i18n\/index\.(js|ts)$/.test(specifier)) return { url: i18nUrl + query, shortCircuit: true };
      if (query && specifier.startsWith('.')) {
        const resolved = next(specifier, context);
        return { ...resolved, url: resolved.url.split('?')[0] + query };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.endsWith('en.json#en')) return { format: 'module', source: `export default ${enJson()};`, shortCircuit: true };
      if (url.endsWith('.ftl?raw')) {
        const text = fs.readFileSync(new URL(url.slice(0, -'?raw'.length)), 'utf8');
        return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
      }
      return next(url, context);
    },
  });
  return { reactUrl };
}

/** Модуль на языке `language`: `localStorage` подменяется до загрузки, у каждого языка свой экземпляр. */
export async function importAs(file, language) {
  globalThis.localStorage = { getItem: () => language, setItem() {} };
  return import(pathToFileURL(file).href + `?lang=${language}`);
}

export function checker() {
  let count = 0;
  const same = (what, a, b) => {
    count++;
    if (a !== b) {
      console.error('РАСХОЖДЕНИЕ', what, '\nстарое:', String(a).slice(0, 300), '\nновое:', String(b).slice(0, 300));
      process.exit(1);
    }
  };
  return { same, count: () => count };
}

export const exportsOf = (m) => Object.keys(m).sort().join(',');

export function random(seed = 1) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
