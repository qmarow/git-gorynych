import { t as tr } from '../i18n/index.ts';
// Конструктор действий: цепочки шагов (ветка, rebase, push, MR…) с горячими клавишами и кнопками на панели.

/* ---------------- Шаги ---------------- */

export type FieldType = 'text' | 'branch' | 'select' | 'bool' | 'textarea';

/** Поле шага в конструкторе. `def` — значение по умолчанию (строка с переменными или флаг). */
export interface StepField {
  key: string;
  label: string;
  type: FieldType;
  def: string | boolean;
  placeholder?: string;
  options?: readonly (readonly [string, string])[];
  optional?: boolean;
}

/** Параметры шага: значения полей. Хранятся как пришли из настроек, поэтому `unknown`. */
export type StepParams = Record<string, unknown>;

export interface StepType {
  group: StepGroupId;
  label: string;
  hint: string;
  fields: readonly StepField[];
  describe: (params: StepParams) => string;
}

export type StepTypeId = 'fetch' | 'pull' | 'push' | 'createBranch' | 'checkout' | 'rebase' | 'merge' | 'deleteBranch' | 'stash' | 'stashPop' | 'commit' | 'mergeRequest' | 'confirm' | 'git';
export type StepGroupId = 'branch' | 'sync' | 'changes' | 'server' | 'other';

export interface ActionStep {
  id: string;
  /** Тип из сохранённого действия: неизвестный — ошибка проверки (`validateAction`), а не падение. */
  type: StepTypeId | (string & {});
  params: StepParams;
}

/** Действие пользователя (`actions.v1` в localStorage; в 2.0 — таблица `custom_actions`). */
export interface CustomAction {
  id: string;
  name: string;
  icon?: string;
  steps: ActionStep[];
  hotkey?: string | null;
  toolbar?: boolean;
  [extra: string]: unknown;
}

// fields: { key, label, type: 'text' | 'branch' | 'select' | 'bool' | 'textarea', placeholder, options, def }
export const STEP_TYPES: Record<StepTypeId, StepType> = {
  fetch: {
    group: 'sync',
    label: 'Fetch',
    hint: tr('Узнать, что нового на сервере'),
    fields: [],
    describe: () => tr('Fetch — загрузить новое с сервера'),
  },
  pull: {
    group: 'sync',
    label: 'Pull',
    hint: tr('Забрать изменения в текущую ветку'),
    fields: [
      {
        key: 'mode',
        label: tr('Режим'),
        type: 'select',
        def: 'merge',
        options: [
          ['merge', tr('Fast-forward, если возможно')],
          ['ff-only', tr('Только fast-forward')],
          ['rebase', 'Rebase'],
        ],
      },
    ],
    describe: (p) => `Pull${p.mode === 'rebase' ? ' (rebase)' : p.mode === 'ff-only' ? tr(' (только fast-forward)') : ''}`,
  },
  push: {
    group: 'sync',
    label: 'Push',
    hint: tr('Отправить текущую ветку'),
    fields: [{ key: 'force', label: tr('Force push (--force-with-lease) — нужен после rebase отправленной ветки'), type: 'bool', def: false }],
    describe: (p) => (p.force ? tr('Force push текущей ветки') : tr('Push текущей ветки')),
  },
  createBranch: {
    group: 'branch',
    label: tr('Создать ветку'),
    hint: tr('Новая ветка от любой ветки или коммита'),
    fields: [
      { key: 'name', label: tr('Имя ветки'), type: 'text', def: tr('feature/{input:Название задачи|slug}'), placeholder: tr('feature/{input:Название|slug}') },
      { key: 'from', label: tr('От чего'), type: 'branch', def: '{default}', placeholder: '{default}, origin/main, {branch}…' },
      { key: 'checkout', label: tr('Сразу переключиться на неё'), type: 'bool', def: true },
    ],
    describe: (p) => tr('Создать ветку «{0}» от {1}{2}', p.name || '?', p.from || 'HEAD', p.checkout ? tr(' и переключиться') : ''),
  },
  checkout: {
    group: 'branch',
    label: tr('Переключить ветку'),
    hint: tr('Checkout (учитывает «умное переключение»)'),
    fields: [{ key: 'branch', label: tr('Ветка'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('Переключиться на {0}', p.branch || '?'),
  },
  rebase: {
    group: 'branch',
    label: 'Rebase',
    hint: tr('Перенести текущую ветку поверх другой'),
    fields: [{ key: 'onto', label: tr('На что'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('Rebase текущей ветки на {0}', p.onto || '?'),
  },
  merge: {
    group: 'branch',
    label: 'Merge',
    hint: tr('Слить ветку в текущую'),
    fields: [{ key: 'ref', label: tr('Какую ветку слить'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('Слить {0} в текущую ветку', p.ref || '?'),
  },
  deleteBranch: {
    group: 'branch',
    label: tr('Удалить ветку'),
    hint: tr('Локальная ветка (Undo вернёт)'),
    fields: [
      { key: 'name', label: tr('Ветка'), type: 'branch', def: '{start}' },
      { key: 'force', label: tr('Даже если не слита'), type: 'bool', def: false },
    ],
    describe: (p) => tr('Удалить ветку {0}{1}', p.name || '?', p.force ? tr(' (принудительно)') : ''),
  },
  stash: {
    group: 'changes',
    label: 'Stash',
    hint: tr('Спрятать незакоммиченные изменения'),
    fields: [{ key: 'message', label: tr('Подпись (необязательно)'), type: 'text', def: '', optional: true }],
    describe: (p) => tr('Спрятать изменения{0}', p.message ? ` «${p.message}»` : ''),
  },
  stashPop: {
    group: 'changes',
    label: 'Pop',
    hint: tr('Вернуть последний stash'),
    fields: [],
    describe: () => tr('Вернуть последний stash'),
  },
  commit: {
    group: 'changes',
    label: tr('Коммит'),
    hint: tr('С проверкой Pre-commit Guard'),
    fields: [
      { key: 'message', label: tr('Сообщение'), type: 'text', def: tr('{input:Сообщение коммита}') },
      { key: 'stageAll', label: tr('Сначала добавить все изменения (Stage all)'), type: 'bool', def: true },
    ],
    describe: (p) => tr('Коммит «{0}»{1}', p.message || '?', p.stageAll ? tr(' всех изменений') : ''),
  },
  mergeRequest: {
    group: 'server',
    label: 'Merge request / PR',
    hint: tr('GitLab — через API, GitHub — откроется страница PR'),
    fields: [
      { key: 'target', label: tr('В какую ветку'), type: 'branch', def: '{default}' },
      { key: 'title', label: tr('Заголовок'), type: 'text', def: '{branch}', optional: true },
      { key: 'draft', label: tr('Черновик (Draft)'), type: 'bool', def: false },
      { key: 'open', label: tr('Открыть в браузере'), type: 'bool', def: true },
    ],
    describe: (p) => tr('{0} из текущей ветки в {1}', p.draft ? tr('Черновик MR') : 'Merge request', p.target || '?'),
  },
  confirm: {
    group: 'other',
    label: tr('Спросить'),
    hint: tr('Пауза: продолжить или остановиться'),
    fields: [{ key: 'text', label: tr('Вопрос'), type: 'text', def: tr('Продолжить?') }],
    describe: (p) => tr('Спросить: «{0}»', p.text || tr('Продолжить?')),
  },
  git: {
    group: 'other',
    label: tr('Своя git-команда'),
    hint: tr('Любая команда git (без shell)'),
    fields: [{ key: 'command', label: tr('Команда'), type: 'text', def: 'git status', placeholder: 'git tag v{date}' }],
    describe: (p) => (p.command as string) || 'git …',
  },
};

export const STEP_GROUPS: readonly (readonly [StepGroupId, string])[] = [
  ['branch', tr('Ветки')],
  ['sync', tr('Сервер')],
  ['changes', tr('Изменения')],
  ['server', 'Merge request'],
  ['other', tr('Другое')],
];

/** Неизвестный тип — исключение, как в 1.x: вызывают только с типами из STEP_TYPES. */
export function newStep(type: StepTypeId): ActionStep {
  const params: StepParams = {};
  for (const f of STEP_TYPES[type].fields) params[f.key] = f.def;
  return { id: uid(), type, params };
}

export const uid = (): string => Math.random().toString(36).slice(2, 10);

/* ---------------- Шаблоны ---------------- */

type TemplateAction = Omit<CustomAction, 'id'>;

const tpl = (name: string, icon: string, steps: [StepTypeId, StepParams?][], extra: Partial<TemplateAction> = {}): TemplateAction => ({
  name,
  icon,
  steps: steps.map(([type, params = {}]) => ({ ...newStep(type), params: { ...newStep(type).params, ...params } })),
  hotkey: null,
  toolbar: true,
  ...extra,
});

export interface ActionTemplate {
  id: string;
  title: string;
  description: string;
  make: () => TemplateAction;
}

export const TEMPLATES: readonly ActionTemplate[] = [
  {
    id: 'feature-mr',
    title: tr('Новая задача → MR'),
    description: tr('Ветка от основной, rebase на свежую основу, push и merge request'),
    make: () =>
      tpl(tr('Новая задача'), 'Rocket', [
        ['fetch'],
        ['createBranch', { name: tr('feature/{input:Название задачи|slug}'), from: '{default}', checkout: true }],
        ['rebase', { onto: 'origin/{default}' }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: tr('{input:Название задачи}'), draft: true }],
      ]),
  },
  {
    id: 'update-branch',
    title: tr('Обновить ветку из основной'),
    description: tr('Fetch, rebase на origin/основную и force push'),
    make: () => tpl(tr('Обновить из main'), 'RefreshCw', [['fetch'], ['rebase', { onto: 'origin/{default}' }], ['push', { force: true }]]),
  },
  {
    id: 'finish',
    title: tr('Закончить задачу'),
    description: tr('Коммит всех изменений, push и merge request'),
    make: () =>
      tpl(tr('Отправить на ревью'), 'Send', [
        ['commit', { message: tr('{input:Сообщение коммита}'), stageAll: true }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: '{branch}' }],
      ]),
  },
  {
    id: 'sync-main',
    title: tr('Подтянуть основную ветку'),
    description: tr('Переключиться на основную, pull и вернуться обратно'),
    make: () =>
      tpl(tr('Обновить main'), 'Download', [
        ['checkout', { branch: '{default}' }],
        ['pull', { mode: 'ff-only' }],
        ['checkout', { branch: '{start}' }],
      ]),
  },
  {
    id: 'cleanup',
    title: tr('Ветка слита — убрать'),
    description: tr('Переключиться на основную, pull и удалить ветку, с которой начали'),
    make: () =>
      tpl(tr('Убрать слитую ветку'), 'Trash2', [
        ['confirm', { text: tr('Удалить ветку {start} после обновления основной?') }],
        ['checkout', { branch: '{default}' }],
        ['pull', { mode: 'ff-only' }],
        ['deleteBranch', { name: '{start}', force: false }],
      ], { toolbar: false }),
  },
];

/* ---------------- Хранение ---------------- */

const KEY = 'actions.v1';

export function readActions(): CustomAction[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((a: CustomAction | null) => a && a.id && Array.isArray(a.steps)) : [];
  } catch {
    return [];
  }
}

export function writeActions(list: readonly CustomAction[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно */
  }
}

/* ---------------- Переменные ---------------- */

export const VARIABLES: readonly (readonly [string, string])[] = [
  ['{branch}', tr('текущая ветка в момент шага')],
  ['{start}', tr('ветка, с которой запустили действие')],
  ['{default}', tr('основная ветка (main / master)')],
  ['{date}', tr('сегодняшняя дата, 2026-10-26')],
  [tr('{input:Вопрос}'), tr('спросить при запуске')],
  [tr('{input:Вопрос|slug}'), tr('спросить и сделать имя ветки: «Новая форма» → novaya-forma')],
];

const INPUT_RE = /\{input:([^}|]+)(\|slug)?\}/g;

// Какие значения нужно спросить у пользователя перед запуском
export interface ActionInput {
  label: string;
  /** Значение станет именем ветки: поле подсказывает ветки. */
  branchLike: boolean;
}

export function inputsOf(action: Pick<CustomAction, 'steps'>): ActionInput[] {
  const seen = new Map<string, ActionInput>();
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

const TRANSLIT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

// «Новая форма входа» → novaya-forma-vhoda: латиница удобнее в URL, CI и терминале
export function slugify(text: unknown): string {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}/.-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '');
}

/** Значения для переменных шага. */
export interface ExpandContext {
  inputs?: Record<string, string | undefined> | null;
  branch?: string | null;
  start?: string | null;
  defaultBranch?: string | null;
}

/** Не строка — как есть (флаги, числа). */
export function expand<T>(value: T, ctx: ExpandContext): T | string {
  if (typeof value !== 'string') return value;
  return value
    .replace(INPUT_RE, (_, label: string, slug: string | undefined) => {
      const v = ctx.inputs?.[label.trim()] ?? '';
      return slug ? slugify(v) : v;
    })
    .replace(/\{branch\}/g, ctx.branch ?? '')
    .replace(/\{start\}/g, ctx.start ?? '')
    .replace(/\{default\}/g, ctx.defaultBranch ?? 'main')
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
}

export function expandParams(params: StepParams | null | undefined, ctx: ExpandContext): StepParams {
  const out: StepParams = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = expand(v, ctx);
  return out;
}

/* ---------------- Горячие клавиши ---------------- */

// Уже занятые программой сочетания
export const RESERVED_HOTKEYS: ReadonlySet<string> = new Set([
  'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+F', 'Ctrl+B', 'Ctrl+O', 'Ctrl+N', 'Ctrl+W', 'Ctrl+S', 'Ctrl+,', 'Ctrl+Enter',
  'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+Shift+O', 'Ctrl+Alt+F', 'Ctrl+/', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A',
  'F1', 'F5', 'F7', 'Shift+F7', 'F11', 'F12', 'Alt+F4',
]);

const KEY_NAMES: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Enter: 'Enter', Space: 'Space', Tab: 'Tab' };

/** Сочетание из события клавиатуры: «Ctrl+Alt+K». Одиночные модификаторы — null. */
export function hotkeyFromEvent(e: { code?: string; key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string | null {
  const code = e.code ?? '';
  if (/^(Control|Shift|Alt|Meta|OS)/.test(code) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key as string)) return null;
  let key: string | null = null;
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

export function hotkeyProblem(combo: string | null | undefined, actions: readonly Pick<CustomAction, 'id' | 'hotkey' | 'name'>[], selfId?: string | null): string | null {
  if (!combo) return null;
  const parts = combo.split('+');
  const key = parts.at(-1)!;
  if (parts.length === 1 && !/^F\d+$/.test(key)) return tr('Нужен модификатор: Ctrl, Alt или Shift');
  if (parts.length === 2 && parts[0] === 'Shift' && !/^F\d+$/.test(key)) return tr('Shift + буква мешает вводу текста — добавьте Ctrl или Alt');
  if (RESERVED_HOTKEYS.has(combo)) return tr('Это сочетание уже занято программой');
  const other = actions.find((a) => a.id !== selfId && a.hotkey === combo);
  if (other) return tr('Уже назначено действию «{0}»', other.name);
  return null;
}

// Основная ветка: main, master или то, что есть
/** Нужны только имена веток: `Repository` из `repo:load` или его часть. */
export interface BranchSource {
  localBranches: readonly { name: string }[];
  remotes: readonly { branches: readonly { name: string }[] }[];
}

export function defaultBranchOf(repo: BranchSource | null | undefined): string {
  if (!repo) return 'main';
  const local = new Set(repo.localBranches.map((b) => b.name));
  const remote = new Set(repo.remotes.flatMap((r) => r.branches.map((b) => b.name)));
  for (const name of ['main', 'master', 'develop', 'trunk']) if (local.has(name) || remote.has(name)) return name;
  return repo.localBranches[0]?.name ?? 'main';
}

export function validateAction(a: Pick<CustomAction, 'name' | 'steps'>): string[] {
  const problems: string[] = [];
  if (!a.name?.trim()) problems.push(tr('Введите название'));
  if (!a.steps.length) problems.push(tr('Добавьте хотя бы один шаг'));
  a.steps.forEach((s, i) => {
    const t: StepType | undefined = STEP_TYPES[s.type as StepTypeId];
    if (!t) problems.push(tr('Шаг {0}: неизвестный тип', i + 1));
    for (const f of t?.fields ?? []) {
      if (f.type !== 'bool' && !f.optional && !String(s.params?.[f.key] ?? '').trim()) {
        problems.push(tr('Шаг {0} «{1}»: заполните «{2}»', i + 1, t.label, f.label));
      }
    }
  });
  return problems;
}
