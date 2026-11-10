// Сверка ciSnippets, platform, guardRules (src/lib/*.ts) с прежними .js.
// node tests/ui-parity/lib-batch3.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, checker, exportsOf } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const json = (v) => JSON.stringify(v);
let tag = 0;

// Модуль загружается заново: язык, хранилище, window и navigator — свои у каждой пары
async function loadPair(name, { language = 'ru', saved = null, window, navigator } = {}) {
  const writes = [];
  globalThis.localStorage = { getItem: (key) => (key === 'language' ? language : saved), setItem: (k, v) => writes.push([k, v]) };
  if (window === undefined) delete globalThis.window;
  else globalThis.window = window;
  if (navigator !== undefined) Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true });
  const q = `?lang=${language}&n=${tag++}`;
  const a = await import(pathToFileURL(path.join(oldDir, 'lib', `${name}.js`)).href + q);
  const b = await import(pathToFileURL(path.join(repo, 'src', 'lib', `${name}.ts`)).href + q);
  return [a, b, writes];
}

const realNavigator = globalThis.navigator;
for (const language of ['ru', 'en']) {
  // ciSnippets
  const [oldC, newC] = await loadPair('ciSnippets', { language });
  same('экспорт ciSnippets', exportsOf(oldC), exportsOf(newC));
  for (const system of ['gitlab', 'github', 'gitea', 'forgejo', 'bitbucket', 'jenkins', null, undefined, 'GitLab']) same(`snippetsFor ${system}`, json(oldC.snippetsFor(system)), json(newC.snippetsFor(system)));
  same('TAG_KEYS', json(oldC.TAG_KEYS), json(newC.TAG_KEYS));

  // platform: определение платформы при загрузке
  const envs = [
    { window: undefined },
    { window: { api: { platform: 'darwin' } } },
    { window: { api: { platform: 'freebsd' } } },
    { window: {}, navigator: { userAgentData: { platform: 'macOS' }, platform: 'Win32' } },
    { window: {}, navigator: { userAgentData: { platform: '' }, platform: 'Win32' } },
    { window: {}, navigator: { platform: 'Linux x86_64' } },
    { window: { api: {} }, navigator: { platform: 'MacIntel' } },
    { window: {}, navigator: { platform: '' } },
    { window: {}, navigator: {} },
    { window: {}, navigator: { platform: 'Wii' } },
  ];
  const TEXTS = [
    'Ctrl+S', 'Сохранить (Ctrl+S)', 'Ctrl+Shift+O', 'Ctrl + Alt + F', 'Ctrl+клик', 'Ctrl+click', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+Enter', 'Shift+Esc', 'Ctrl+,', 'Ctrl+/', 'Cmd+K',
    'Option+Delete', 'Ctrl+Backspace', 'Ctrl+a и Ctrl+b.', 'Filter (Ctrl + Alt + F)', '«Ctrl+F»', 'xCtrl+S', 'Ctrl+', 'Ctrl+колесо', 'Ctrl+scroll', 'Shift+drag', 'Alt+wheel', 'Ctrl+F12', 'нет шортката', '', null, undefined, 5,
  ];
  for (const env of envs) {
    const [oldP, newP] = await loadPair('platform', { language, ...env });
    same('экспорт platform', exportsOf(oldP), exportsOf(newP));
    same(`PLATFORM ${json(env)}`, json([oldP.PLATFORM, oldP.IS_MAC, oldP.IS_WINDOWS]), json([newP.PLATFORM, newP.IS_MAC, newP.IS_WINDOWS]));
    for (const e of [null, undefined, {}, { metaKey: true }, { ctrlKey: true }, { metaKey: true, ctrlKey: true }]) same(`isMod ${json(e)}`, oldP.isMod(e), newP.isMod(e));
    for (const text of TEXTS) {
      same(`kb ${text}`, oldP.kb(text), newP.kb(text));
      for (const mac of [true, false]) same(`kb ${text} ${mac}`, oldP.kb(text, mac), newP.kb(text, mac));
    }
    for (const platform of [undefined, 'darwin', 'win32', 'linux', 'other']) {
      for (const subject of [undefined, 'Токен', 'Данные', 'Ключи', 'Пароль']) same(`secretStorageText ${platform} ${subject}`, oldP.secretStorageText(platform, subject), newP.secretStorageText(platform, subject));
      same(`installGitHint ${platform}`, oldP.installGitHint(platform), newP.installGitHint(platform));
      same(`openFolderLabel ${platform}`, oldP.openFolderLabel(platform), newP.openFolderLabel(platform));
      same(`openTerminalLabel ${platform}`, oldP.openTerminalLabel(platform), newP.openTerminalLabel(platform));
    }
  }
  Object.defineProperty(globalThis, 'navigator', { value: realNavigator, configurable: true, writable: true });
  delete globalThis.window;

  // guardRules
  const saves = [
    null, 'null', '{испорчен', '5', '[]', json({}),
    json({ enabled: false, live: 0, levels: { 'console-log': 'block', 'jwt': 'off' }, exclude: ['dist/**', '', '  ', 5, null], custom: [{ id: 'my', label: 'Моё', pattern: 'x+' }, { id: 'nop' }, null, { id: 's', pattern: 'sk', category: 'secret' }], repoOff: ['C:\\repo'] }),
    json({ disabled: ['jwt', 'bearer'], levels: { jwt: 'block' } }),
    json({ levels: 'не объект', exclude: 'нет', custom: {}, repoOff: 'нет' }),
    json({ repoOff: ['', null, 'C:\\repo'] }),
  ];
  for (const saved of saves) {
    const [oldG, newG, writes] = await loadPair('guardRules', { language, saved });
    same('экспорт guardRules', exportsOf(oldG), exportsOf(newG));
    for (const name of ['DEFAULT_RULES', 'CATEGORY_LABELS', 'LEVELS', 'EXCLUDE_SUGGESTIONS', 'DEFAULT_GUARD']) same(name, json(oldG[name]), json(newG[name]));
    const a = oldG.readGuard(), b = newG.readGuard();
    same(`readGuard ${saved}`, json(a), json(b));
    same('activeRules', json(oldG.activeRules(a)), json(newG.activeRules(b)));
    for (const rule of [...oldG.DEFAULT_RULES, { id: 'x' }, { id: 'y', level: 'block' }]) same(`levelOf ${rule.id}`, oldG.levelOf(a, rule), newG.levelOf(b, rule));
    same('levelOf без levels', oldG.levelOf({}, { id: 'z' }), newG.levelOf({}, { id: 'z' }));
    for (const repoPath of [undefined, null, '', 'C:\\repo', 'C:\\other']) {
      same(`guardOnFor ${repoPath}`, oldG.guardOnFor(a, repoPath), newG.guardOnFor(b, repoPath));
      same('guardOnFor без repoOff', oldG.guardOnFor({ enabled: 1 }, repoPath), newG.guardOnFor({ enabled: 1 }, repoPath));
    }
    oldG.writeGuard(a);
    newG.writeGuard(b);
    same('writeGuard', json(writes[0]), json(writes[1]));
  }
  const [oldG, newG] = await loadPair('guardRules', { language });
  for (const [pattern, flags] of [['a+', ''], ['(', ''], ['[', 'u'], ['x', 'gg'], ['\\p{L}', 'u'], ['\\p{Nope}', 'u'], ['(?<n>a)(?<n>b)', ''], ['a', undefined]]) {
    same(`validatePattern ${pattern} ${flags}`, oldG.validatePattern(pattern, flags), newG.validatePattern(pattern, flags));
  }
}
console.log(`совпало проверок: ${count()}`);
