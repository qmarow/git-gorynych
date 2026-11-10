// Общие хуки загрузки для сверок: так модули интерфейса грузятся в Node, как в Vite.
// - `electron/i18n/en.json` без `with { type: 'json' }`;
// - `react` из node_modules репозитория для копий вне репозитория;
// - `../i18n/index.(js|ts)` из старой копии → текущий `src/i18n/index.ts` (переводы общие, сверяется сам модуль);
// - `?lang=…` родителя переходит на относительные импорты: у каждого языка свой экземпляр модулей.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

export function setup(repo, { sharedI18n = true } = {}) {
  const enPath = path.join(repo, 'electron', 'i18n', 'en.json');
  const reactUrl = pathToFileURL(path.join(repo, 'node_modules', 'react', 'index.js')).href;
  const i18nUrl = pathToFileURL(path.join(repo, 'src', 'i18n', 'index.ts')).href;
  const hljsUrl = pathToFileURL(path.join(repo, 'src', 'vendor', 'hljs.js')).href;
  registerHooks({
    resolve(specifier, context, next) {
      // Собранный highlight.js — общий для старой и новой копии
      if (/\/vendor\/hljs\.js$/.test(specifier)) return { url: hljsUrl, shortCircuit: true };
      if (specifier.endsWith('electron/i18n/en.json')) return { url: pathToFileURL(enPath).href + '#en', shortCircuit: true };
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
      if (url.endsWith('en.json#en')) return { format: 'module', source: `export default ${fs.readFileSync(enPath, 'utf8')};`, shortCircuit: true };
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
