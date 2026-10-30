// Конструктор действий: цепочки шагов (ветка, rebase, push, MR…) с горячими клавишами и кнопками на панели.

/* ---------------- Шаги ---------------- */

// fields: { key, label, type: 'text' | 'branch' | 'select' | 'bool' | 'textarea', placeholder, options, def }
export const STEP_TYPES = {
  fetch: {
    group: 'sync',
    label: 'Fetch',
    hint: 'Узнать, что нового на сервере',
    fields: [],
    describe: () => 'Fetch — загрузить новое с сервера',
  },
  pull: {
    group: 'sync',
    label: 'Pull',
    hint: 'Забрать изменения в текущую ветку',
    fields: [
      {
        key: 'mode',
        label: 'Режим',
        type: 'select',
        def: 'merge',
        options: [
          ['merge', 'Fast-forward, если возможно'],
          ['ff-only', 'Только fast-forward'],
          ['rebase', 'Rebase'],
        ],
      },
    ],
    describe: (p) => `Pull${p.mode === 'rebase' ? ' (rebase)' : p.mode === 'ff-only' ? ' (только fast-forward)' : ''}`,
  },
  push: {
    group: 'sync',
    label: 'Push',
    hint: 'Отправить текущую ветку',
    fields: [{ key: 'force', label: 'Force push (--force-with-lease) — нужен после rebase отправленной ветки', type: 'bool', def: false }],
    describe: (p) => (p.force ? 'Force push текущей ветки' : 'Push текущей ветки'),
  },
  createBranch: {
    group: 'branch',
    label: 'Создать ветку',
    hint: 'Новая ветка от любой ветки или коммита',
    fields: [
      { key: 'name', label: 'Имя ветки', type: 'text', def: 'feature/{input:Название задачи|slug}', placeholder: 'feature/{input:Название|slug}' },
      { key: 'from', label: 'От чего', type: 'branch', def: '{default}', placeholder: '{default}, origin/main, {branch}…' },
      { key: 'checkout', label: 'Сразу переключиться на неё', type: 'bool', def: true },
    ],
    describe: (p) => `Создать ветку «${p.name || '?'}» от ${p.from || 'HEAD'}${p.checkout ? ' и переключиться' : ''}`,
  },
  checkout: {
    group: 'branch',
    label: 'Переключить ветку',
    hint: 'Checkout (учитывает «умное переключение»)',
    fields: [{ key: 'branch', label: 'Ветка', type: 'branch', def: '{default}' }],
    describe: (p) => `Переключиться на ${p.branch || '?'}`,
  },
  rebase: {
    group: 'branch',
    label: 'Rebase',
    hint: 'Перенести текущую ветку поверх другой',
    fields: [{ key: 'onto', label: 'На что', type: 'branch', def: '{default}' }],
    describe: (p) => `Rebase текущей ветки на ${p.onto || '?'}`,
  },
  merge: {
    group: 'branch',
    label: 'Merge',
    hint: 'Слить ветку в текущую',
    fields: [{ key: 'ref', label: 'Какую ветку слить', type: 'branch', def: '{default}' }],
    describe: (p) => `Слить ${p.ref || '?'} в текущую ветку`,
  },
  deleteBranch: {
    group: 'branch',
    label: 'Удалить ветку',
    hint: 'Локальная ветка (Undo вернёт)',
    fields: [
      { key: 'name', label: 'Ветка', type: 'branch', def: '{start}' },
      { key: 'force', label: 'Даже если не слита', type: 'bool', def: false },
    ],
    describe: (p) => `Удалить ветку ${p.name || '?'}${p.force ? ' (принудительно)' : ''}`,
  },
  stash: {
    group: 'changes',
    label: 'Stash',
    hint: 'Спрятать незакоммиченные изменения',
    fields: [{ key: 'message', label: 'Подпись (необязательно)', type: 'text', def: '', optional: true }],
    describe: (p) => `Спрятать изменения${p.message ? ` «${p.message}»` : ''}`,
  },
  stashPop: {
    group: 'changes',
    label: 'Pop',
    hint: 'Вернуть последний stash',
    fields: [],
    describe: () => 'Вернуть последний stash',
  },
  commit: {
    group: 'changes',
    label: 'Коммит',
    hint: 'С проверкой Pre-commit Guard',
    fields: [
      { key: 'message', label: 'Сообщение', type: 'text', def: '{input:Сообщение коммита}' },
      { key: 'stageAll', label: 'Сначала добавить все изменения (Stage all)', type: 'bool', def: true },
    ],
    describe: (p) => `Коммит «${p.message || '?'}»${p.stageAll ? ' всех изменений' : ''}`,
  },
  mergeRequest: {
    group: 'server',
    label: 'Merge request / PR',
    hint: 'GitLab — через API, GitHub — откроется страница PR',
    fields: [
      { key: 'target', label: 'В какую ветку', type: 'branch', def: '{default}' },
      { key: 'title', label: 'Заголовок', type: 'text', def: '{branch}', optional: true },
      { key: 'draft', label: 'Черновик (Draft)', type: 'bool', def: false },
      { key: 'open', label: 'Открыть в браузере', type: 'bool', def: true },
    ],
    describe: (p) => `${p.draft ? 'Черновик MR' : 'Merge request'} из текущей ветки в ${p.target || '?'}`,
  },
  confirm: {
    group: 'other',
    label: 'Спросить',
    hint: 'Пауза: продолжить или остановиться',
    fields: [{ key: 'text', label: 'Вопрос', type: 'text', def: 'Продолжить?' }],
    describe: (p) => `Спросить: «${p.text || 'Продолжить?'}»`,
  },
  git: {
    group: 'other',
    label: 'Своя git-команда',
    hint: 'Любая команда git (без shell)',
    fields: [{ key: 'command', label: 'Команда', type: 'text', def: 'git status', placeholder: 'git tag v{date}' }],
    describe: (p) => p.command || 'git …',
  },
};

export const STEP_GROUPS = [
  ['branch', 'Ветки'],
  ['sync', 'Сервер'],
  ['changes', 'Изменения'],
  ['server', 'Merge request'],
  ['other', 'Другое'],
];

export function newStep(type) {
  const params = {};
  for (const f of STEP_TYPES[type].fields) params[f.key] = f.def;
  return { id: uid(), type, params };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------- Шаблоны ---------------- */

const tpl = (name, icon, steps, extra = {}) => ({
  name,
  icon,
  steps: steps.map(([type, params = {}]) => ({ ...newStep(type), params: { ...newStep(type).params, ...params } })),
  hotkey: null,
  toolbar: true,
  ...extra,
});

export const TEMPLATES = [
  {
    id: 'feature-mr',
    title: 'Новая задача → MR',
    description: 'Ветка от основной, rebase на свежую основу, push и merge request',
    make: () =>
      tpl('Новая задача', 'Rocket', [
        ['fetch'],
        ['createBranch', { name: 'feature/{input:Название задачи|slug}', from: '{default}', checkout: true }],
        ['rebase', { onto: 'origin/{default}' }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: '{input:Название задачи}', draft: true }],
      ]),
  },
  {
    id: 'update-branch',
    title: 'Обновить ветку из основной',
    description: 'Fetch, rebase на origin/основную и force push',
    make: () => tpl('Обновить из main', 'RefreshCw', [['fetch'], ['rebase', { onto: 'origin/{default}' }], ['push', { force: true }]]),
  },
  {
    id: 'finish',
    title: 'Закончить задачу',
    description: 'Коммит всех изменений, push и merge request',
    make: () =>
      tpl('Отправить на ревью', 'Send', [
        ['commit', { message: '{input:Сообщение коммита}', stageAll: true }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: '{branch}' }],
      ]),
  },
  {
    id: 'sync-main',
    title: 'Подтянуть основную ветку',
    description: 'Переключиться на основную, pull и вернуться обратно',
    make: () =>
      tpl('Обновить main', 'Download', [
        ['checkout', { branch: '{default}' }],
        ['pull', { mode: 'ff-only' }],
        ['checkout', { branch: '{start}' }],
      ]),
  },
  {
    id: 'cleanup',
    title: 'Ветка слита — убрать',
    description: 'Переключиться на основную, pull и удалить ветку, с которой начали',
    make: () =>
      tpl('Убрать слитую ветку', 'Trash2', [
        ['confirm', { text: 'Удалить ветку {start} после обновления основной?' }],
        ['checkout', { branch: '{default}' }],
        ['pull', { mode: 'ff-only' }],
        ['deleteBranch', { name: '{start}', force: false }],
      ], { toolbar: false }),
  },
];

/* ---------------- Хранение ---------------- */

const KEY = 'actions.v1';

export function readActions() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((a) => a && a.id && Array.isArray(a.steps)) : [];
  } catch {
    return [];
  }
}

export function writeActions(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно */
  }
}

/* ---------------- Переменные ---------------- */

export const VARIABLES = [
  ['{branch}', 'текущая ветка в момент шага'],
  ['{start}', 'ветка, с которой запустили действие'],
  ['{default}', 'основная ветка (main / master)'],
  ['{date}', 'сегодняшняя дата, 2026-10-26'],
  ['{input:Вопрос}', 'спросить при запуске'],
  ['{input:Вопрос|slug}', 'спросить и сделать имя ветки: «Новая форма» → novaya-forma'],
];

const INPUT_RE = /\{input:([^}|]+)(\|slug)?\}/g;

// Какие значения нужно спросить у пользователя перед запуском
export function inputsOf(action) {
  const seen = new Map();
  for (const step of action.steps) {
    for (const v of Object.values(step.params ?? {})) {
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(INPUT_RE)) {
        const label = m[1].trim();
        if (!seen.has(label)) seen.set(label, { label, branchLike: Boolean(m[2]) || /ветк|branch/i.test(label) });
      }
    }
  }
  return [...seen.values()];
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

// «Новая форма входа» → novaya-forma-vhoda: латиница удобнее в URL, CI и терминале
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}/.-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '');
}

export function expand(value, ctx) {
  if (typeof value !== 'string') return value;
  return value
    .replace(INPUT_RE, (_, label, slug) => {
      const v = ctx.inputs?.[label.trim()] ?? '';
      return slug ? slugify(v) : v;
    })
    .replace(/\{branch\}/g, ctx.branch ?? '')
    .replace(/\{start\}/g, ctx.start ?? '')
    .replace(/\{default\}/g, ctx.defaultBranch ?? 'main')
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
}

export function expandParams(params, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = expand(v, ctx);
  return out;
}

/* ---------------- Горячие клавиши ---------------- */

// Уже занятые программой сочетания
export const RESERVED_HOTKEYS = new Set([
  'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+F', 'Ctrl+B', 'Ctrl+O', 'Ctrl+N', 'Ctrl+W', 'Ctrl+S', 'Ctrl+,', 'Ctrl+Enter',
  'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+Shift+O', 'Ctrl+Alt+F', 'Ctrl+/', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A',
  'F1', 'F5', 'F7', 'Shift+F7', 'F11', 'F12', 'Alt+F4',
]);

const KEY_NAMES = { Comma: ',', Period: '.', Slash: '/', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Enter: 'Enter', Space: 'Space', Tab: 'Tab' };

/** Сочетание из события клавиатуры: «Ctrl+Alt+K». Одиночные модификаторы — null. */
export function hotkeyFromEvent(e) {
  const code = e.code ?? '';
  if (/^(Control|Shift|Alt|Meta|OS)/.test(code) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = `Num${code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (KEY_NAMES[code]) key = KEY_NAMES[code];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

export function hotkeyProblem(combo, actions, selfId) {
  if (!combo) return null;
  const parts = combo.split('+');
  const key = parts.at(-1);
  if (parts.length === 1 && !/^F\d+$/.test(key)) return 'Нужен модификатор: Ctrl, Alt или Shift';
  if (parts.length === 2 && parts[0] === 'Shift' && !/^F\d+$/.test(key)) return 'Shift + буква мешает вводу текста — добавьте Ctrl или Alt';
  if (RESERVED_HOTKEYS.has(combo)) return 'Это сочетание уже занято программой';
  const other = actions.find((a) => a.id !== selfId && a.hotkey === combo);
  if (other) return `Уже назначено действию «${other.name}»`;
  return null;
}

// Основная ветка: main, master или то, что есть
export function defaultBranchOf(repo) {
  if (!repo) return 'main';
  const local = new Set(repo.localBranches.map((b) => b.name));
  const remote = new Set(repo.remotes.flatMap((r) => r.branches.map((b) => b.name)));
  for (const name of ['main', 'master', 'develop', 'trunk']) if (local.has(name) || remote.has(name)) return name;
  return repo.localBranches[0]?.name ?? 'main';
}

export function validateAction(a) {
  const problems = [];
  if (!a.name?.trim()) problems.push('Введите название');
  if (!a.steps.length) problems.push('Добавьте хотя бы один шаг');
  a.steps.forEach((s, i) => {
    const t = STEP_TYPES[s.type];
    if (!t) problems.push(`Шаг ${i + 1}: неизвестный тип`);
    for (const f of t?.fields ?? []) {
      if (f.type !== 'bool' && !f.optional && !String(s.params?.[f.key] ?? '').trim()) {
        problems.push(`Шаг ${i + 1} «${t.label}»: заполните «${f.label}»`);
      }
    }
  });
  return problems;
}
