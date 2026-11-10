// Сверка actions (src/lib/actions.ts) с прежним .js: шаги и их описания, шаблоны, хранение, переменные, горячие клавиши, проверка.
// node tests/ui-parity/lib-actions.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const rnd = random(53);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const int = (n) => Math.floor(rnd() * n);
const json = (v) => JSON.stringify(v);
// id шагов случайные (Math.random) — в сравнении заменяются на «id»
const noIds = (v) => JSON.stringify(v, (k, x) => (k === 'id' && typeof x === 'string' && /^[a-z0-9]{1,8}$/.test(x) ? 'id' : x));
let tag = 0;

async function loadPair(language, saved) {
  const writes = [];
  globalThis.localStorage = { getItem: (key) => (key === 'language' ? language : saved), setItem: (k, v) => writes.push([k, v]) };
  const q = `?lang=${language}&n=${tag++}`;
  const a = await import(pathToFileURL(path.join(oldDir, 'lib', 'actions.js')).href + q);
  const b = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'actions.ts')).href + q);
  return [a, b, writes];
}

const VALUES = ['', 'main', 'feature/{input:Название задачи|slug}', '{branch}', '{start} и {default}', '{date}', '{input:Ветка}', '{input: Вопрос |slug}', 'x', true, false, 0, null, undefined, 42, 'merge', 'rebase', 'ff-only'];
const TEXTS = ['Новая форма входа', '  Ёлка_и  пальма ', 'Feature/ABC-12 Fix', '---x---', 'a//b..c', '😀 emoji', 'ÆØÅ ß', '', '   ', 'путь/к.файлу', 'Щука-щи', 'Рыба и мыло', '/начало/', './x.', '..//', 5, null];
const CODES = ['KeyA', 'KeyZ', 'Digit1', 'Numpad5', 'F5', 'F12', 'Comma', 'Slash', 'Enter', 'Space', 'Tab', 'ControlLeft', 'ShiftRight', 'AltLeft', 'MetaLeft', 'OSLeft', 'ArrowUp', 'Escape', '', undefined, 'Backslash', 'Quote', 'F13'];
const REPOS = [null, undefined,
  { localBranches: [], remotes: [] },
  { localBranches: [{ name: 'dev' }, { name: 'master' }], remotes: [] },
  { localBranches: [{ name: 'x' }], remotes: [{ branches: [{ name: 'trunk' }] }] },
  { localBranches: [{ name: 'y' }], remotes: [{ branches: [{ name: 'origin/main' }] }] },
  { localBranches: [{ name: 'develop' }, { name: 'main' }], remotes: [{ branches: [] }] },
];

for (const language of ['ru', 'en']) {
  const [oldA, newA] = await loadPair(language, null);
  same('экспорт actions', exportsOf(oldA), exportsOf(newA));
  for (const name of ['STEP_GROUPS', 'VARIABLES']) same(name, json(oldA[name]), json(newA[name]));
  same('RESERVED_HOTKEYS', json([...oldA.RESERVED_HOTKEYS]), json([...newA.RESERVED_HOTKEYS]));
  same('STEP_TYPES ключи', json(Object.keys(oldA.STEP_TYPES)), json(Object.keys(newA.STEP_TYPES)));

  // Описания шагов на случайных параметрах
  for (const [type, step] of Object.entries(oldA.STEP_TYPES)) {
    same(`STEP_TYPES.${type}`, json(step), json(newA.STEP_TYPES[type]));
    for (let k = 0; k < 60; k++) {
      const params = {};
      for (const key of ['mode', 'force', 'name', 'from', 'checkout', 'branch', 'onto', 'ref', 'message', 'stageAll', 'target', 'title', 'draft', 'open', 'text', 'command']) if (rnd() < 0.5) params[key] = pick(VALUES);
      same(`describe ${type} ${json(params)}`, step.describe(params), newA.STEP_TYPES[type].describe(params));
    }
    same(`newStep ${type}`, noIds(oldA.newStep(type)), noIds(newA.newStep(type)));
  }
  for (const t of oldA.TEMPLATES) {
    const other = newA.TEMPLATES.find((x) => x.id === t.id);
    same(`TEMPLATES ${t.id}`, json([t.title, t.description]), json([other?.title, other?.description]));
    same(`TEMPLATES ${t.id}.make`, noIds(t.make()), noIds(other.make()));
  }
  same('uid', typeof oldA.uid() === typeof newA.uid() && /^[a-z0-9]{1,8}$/.test(newA.uid()), true);

  // Переменные
  for (let k = 0; k < 800; k++) {
    const value = pick([...VALUES, `${pick(VALUES)}-${pick(VALUES)}`]);
    const ctx = {
      inputs: pick([undefined, null, {}, { 'Название задачи': pick(TEXTS), Ветка: 'feature/x', Вопрос: pick(TEXTS) }]),
      branch: pick([undefined, null, 'dev', '']),
      start: pick([undefined, 'feature/a']),
      defaultBranch: pick([undefined, null, 'master']),
    };
    same(`expand ${json([value, ctx])}`, json(oldA.expand(value, ctx)), json(newA.expand(value, ctx)));
    const params = { a: value, b: pick(VALUES), c: 7 };
    same('expandParams', json(oldA.expandParams(params, ctx)), json(newA.expandParams(params, ctx)));
  }
  for (const params of [null, undefined, {}]) same(`expandParams ${params}`, json(oldA.expandParams(params, {})), json(newA.expandParams(params, {})));
  for (const text of TEXTS) same(`slugify ${text}`, oldA.slugify(text), newA.slugify(text));
  for (let k = 0; k < 300; k++) {
    const steps = Array.from({ length: int(5) }, () => ({ id: 'x', type: pick(['commit', 'createBranch', 'нет']), params: rnd() < 0.1 ? undefined : { a: pick(VALUES), b: `{input:${pick(['Ветка', 'Branch name', 'Задача', 'Сообщение'])}${pick(['', '|slug'])}}` } }));
    same(`inputsOf ${json(steps)}`, json(oldA.inputsOf({ steps })), json(newA.inputsOf({ steps })));
  }

  // Горячие клавиши
  for (let k = 0; k < 1500; k++) {
    const code = pick(CODES);
    const e = { code, key: pick(['a', 'Control', 'Shift', 'Alt', 'Meta', 'F5', undefined]), ctrlKey: rnd() < 0.5, metaKey: rnd() < 0.2, altKey: rnd() < 0.4, shiftKey: rnd() < 0.4 };
    same(`hotkeyFromEvent ${json(e)}`, oldA.hotkeyFromEvent(e), newA.hotkeyFromEvent(e));
  }
  same('hotkeyFromEvent без code', oldA.hotkeyFromEvent({ key: 'a' }), newA.hotkeyFromEvent({ key: 'a' }));
  const actions = [{ id: '1', name: 'Первое', hotkey: 'Ctrl+K' }, { id: '2', name: 'Второе', hotkey: 'Alt+F2' }];
  for (const combo of [null, '', 'K', 'F2', 'Shift+K', 'Shift+F3', 'Ctrl+K', 'Ctrl+S', 'Alt+F2', 'Ctrl+Alt+K', 'Shift+F7', 'Ctrl+Shift+Z']) {
    for (const selfId of [undefined, '1', '2']) same(`hotkeyProblem ${combo} ${selfId}`, oldA.hotkeyProblem(combo, actions, selfId), newA.hotkeyProblem(combo, actions, selfId));
  }
  for (const r of REPOS) same(`defaultBranchOf ${json(r)}`, oldA.defaultBranchOf(r), newA.defaultBranchOf(r));

  // Проверка действия
  for (let k = 0; k < 600; k++) {
    const a = {
      name: pick(['', '  ', 'Имя', undefined, null]),
      steps: Array.from({ length: int(4) }, () => {
        const type = pick([...Object.keys(oldA.STEP_TYPES), 'нет']);
        const params = {};
        for (const f of oldA.STEP_TYPES[type]?.fields ?? []) if (rnd() < 0.7) params[f.key] = pick(VALUES);
        return { id: 'x', type, params: rnd() < 0.1 ? undefined : params };
      }),
    };
    same(`validateAction ${json(a)}`, json(oldA.validateAction(a)), json(newA.validateAction(a)));
  }
}

// Хранение: чтение из испорченного и старого вида, запись
const saves = [null, 'null', '{испорчен', '5', '{}', json([null, { id: 'a' }, { id: 'b', steps: [] }, { steps: [] }, { id: '', steps: [] }, { id: 'c', steps: 'нет' }])];
for (const saved of saves) {
  const [oldA, newA, writes] = await loadPair('ru', saved);
  same(`readActions ${saved}`, json(oldA.readActions()), json(newA.readActions()));
  const list = [{ id: 'x', name: 'Имя', steps: [] }];
  oldA.writeActions(list);
  newA.writeActions(list);
  same('writeActions', json(writes[0]), json(writes[1]));
}
console.log(`совпало проверок: ${count()}`);
