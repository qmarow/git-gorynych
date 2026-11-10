// Сверка appearance (src/lib/appearance.ts) с прежним .js: нормализация, CSS-переменные и data-* на <html>, тема «Как в системе»,
// схема для графа, кэш в localStorage.
// node tests/ui-parity/lib-appearance.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setup, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
// Старая копия импортирует './scheme.ts' (уже переведённый модуль) — он в репозитории, а не рядом с копией
const schemeUrl = pathToFileURL(path.join(repo, 'src', 'lib', 'scheme.ts')).href;
const oldUrl = pathToFileURL(oldDir).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './scheme.ts' && context.parentURL?.startsWith(oldUrl)) {
      const query = context.parentURL.match(/\?[^#]*/)?.[0] ?? '';
      return { url: schemeUrl + query, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { same, count } = checker();
const rnd = random(61);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const json = (v) => JSON.stringify(v);
let tag = 0;

// Подставной <html>: записывает переменные и data-*
function fakeDocument() {
  const props = {};
  const dataset = {};
  globalThis.document = { documentElement: { style: { setProperty: (k, v) => (props[k] = v) }, dataset, lang: '' } };
  return () => json({ props, dataset });
}
let prefersLight = false;
let matchThrows = false;
globalThis.window = { matchMedia: () => { if (matchThrows) throw new Error('нет'); return { matches: prefersLight }; } };

async function loadPair(language, saved) {
  const writes = [];
  globalThis.localStorage = { getItem: (key) => (key === 'language' ? language : saved), setItem: (k, v) => writes.push([k, v]) };
  fakeDocument();
  const q = `?lang=${language}&n=${tag++}`;
  const a = await import(pathToFileURL(path.join(oldDir, 'lib', 'appearance.js')).href + q);
  const b = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'appearance.ts')).href + q);
  const scheme = await import(schemeUrl + q);
  return [a, b, scheme, writes];
}

const THEME_IDS = ['kraken', 'light', 'midnight', 'dracula', 'monokai', 'forest', 'sakura', 'oled', 'auto', 'нет', null, undefined, 5];
const BGS = ['glow', 'aurora', 'grid', 'gradient', 'solid', 'image', 'system', 'нет', null];
const NUMS = [undefined, null, '', 'abc', -10, 0, 18, 39.6, 40, 41, 90, 95, 100, 150, '55', NaN, Infinity];
const randomAppearance = () =>
  pick([
    null, undefined, 'строка', 5, [],
    {
      theme: pick(THEME_IDS), background: pick(BGS), transparency: pick(NUMS), blur: pick(NUMS), imageBlur: pick(NUMS), imageDim: pick(NUMS),
      motion: pick([true, false, 0, undefined, 'нет']), material: pick(['mica', 'acrylic', 'нет', undefined]), hasImage: pick([true, false]), extra: pick([undefined, 'лишнее']),
    },
    { theme: pick(THEME_IDS) },
  ]);

for (const language of ['ru', 'en']) {
  const [oldA, newA, scheme] = await loadPair(language, null);
  same('экспорт appearance', exportsOf(oldA), exportsOf(newA));
  for (const name of ['THEMES', 'BACKGROUNDS', 'AUTO_THEME', 'DEFAULT_APPEARANCE']) same(name, json(oldA[name]), json(newA[name]));

  for (let k = 0; k < 2500; k++) {
    prefersLight = rnd() < 0.5;
    matchThrows = rnd() < 0.1;
    const value = randomAppearance();
    same(`normalizeAppearance ${json(value)}`, json(oldA.normalizeAppearance(value)), json(newA.normalizeAppearance(value)));
    same(`resolveThemeId ${json(value?.theme)}`, json(oldA.resolveThemeId(value?.theme)), json(newA.resolveThemeId(value?.theme)));
    same('themeById', json(oldA.themeById(value?.theme)), json(newA.themeById(value?.theme)));
    same('nativeAppearance', json(oldA.nativeAppearance(value)), json(newA.nativeAppearance(value)));
    const opts = pick([undefined, {}, { imageUrl: 'http://gorynych-bg.localhost/x.png' }, { imageUrl: null, systemSupported: false }, { systemSupported: false }]);
    const readOld = fakeDocument();
    const ra = oldA.applyAppearance(value, opts);
    const schemeOld = json([scheme.isLight(), scheme.laneColors()]);
    const readNew = fakeDocument();
    const rb = newA.applyAppearance(value, opts);
    same(`applyAppearance ${json([value, opts])}`, json([ra, readOld(), schemeOld]), json([rb, readNew(), json([scheme.isLight(), scheme.laneColors()])]));
    const ta = oldA.syncScheme(value);
    const sa = json([scheme.isLight(), scheme.laneColors()]);
    const tb = newA.syncScheme(value);
    same('syncScheme', json([ta, sa]), json([tb, json([scheme.isLight(), scheme.laneColors()])]));
  }
  matchThrows = false;
}

// Кэш
for (const saved of [null, '', 'null', '{испорчен', '5', json({ theme: 'light', blur: 99 }), json({ theme: 'auto', background: 'image' })]) {
  const [oldA, newA, , writes] = await loadPair('ru', saved);
  same(`readCachedAppearance ${saved}`, json(oldA.readCachedAppearance()), json(newA.readCachedAppearance()));
  const value = { theme: 'dracula', blur: 3 };
  oldA.cacheAppearance(value);
  newA.cacheAppearance(value);
  same('cacheAppearance', json(writes[0]), json(writes[1]));
}
console.log(`совпало проверок: ${count()}`);
