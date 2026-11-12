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
    hint: tr('find-out-whats-new-on'),
    fields: [],
    describe: () => tr('fetch-download-new-data-from'),
  },
  pull: {
    group: 'sync',
    label: 'Pull',
    hint: tr('bring-changes-into-current-branch'),
    fields: [
      {
        key: 'mode',
        label: tr('mode'),
        type: 'select',
        def: 'merge',
        options: [
          ['merge', tr('fast-forward-if-possible')],
          ['ff-only', tr('fast-forward-only')],
          ['rebase', 'Rebase'],
        ],
      },
    ],
    describe: (p) => `Pull${p.mode === 'rebase' ? ' (rebase)' : p.mode === 'ff-only' ? tr('fast-forward-only-2') : ''}`,
  },
  push: {
    group: 'sync',
    label: 'Push',
    hint: tr('push-current-branch'),
    fields: [{ key: 'force', label: tr('force-push-force-with-lease'), type: 'bool', def: false }],
    describe: (p) => (p.force ? tr('force-push-current-branch') : tr('push-current-branch-2')),
  },
  createBranch: {
    group: 'branch',
    label: tr('create-branch-4'),
    hint: tr('new-branch-from-any-branch'),
    fields: [
      { key: 'name', label: tr('branch-name'), type: 'text', def: tr('feature-input-task-name-slug'), placeholder: tr('feature-input-name-slug') },
      { key: 'from', label: tr('from-7'), type: 'branch', def: '{default}', placeholder: '{default}, origin/main, {branch}…' },
      { key: 'checkout', label: tr('switch-to-it-right-away'), type: 'bool', def: true },
    ],
    describe: (p) => tr('create-branch-from', p.name || '?', p.from || 'HEAD', p.checkout ? tr('and-switch') : ''),
  },
  checkout: {
    group: 'branch',
    label: tr('switch-branch-2'),
    hint: tr('checkout-respects-smart-switching'),
    fields: [{ key: 'branch', label: tr('branch'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('switch-to', p.branch || '?'),
  },
  rebase: {
    group: 'branch',
    label: 'Rebase',
    hint: tr('move-current-branch-on-top'),
    fields: [{ key: 'onto', label: tr('onto-2'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('rebase-current-branch-onto', p.onto || '?'),
  },
  merge: {
    group: 'branch',
    label: 'Merge',
    hint: tr('merge-branch-into-current-one'),
    fields: [{ key: 'ref', label: tr('which-branch-to-merge'), type: 'branch', def: '{default}' }],
    describe: (p) => tr('merge-into-current-branch', p.ref || '?'),
  },
  deleteBranch: {
    group: 'branch',
    label: tr('delete-branch-4'),
    hint: tr('local-branch-undo-brings-it'),
    fields: [
      { key: 'name', label: tr('branch'), type: 'branch', def: '{start}' },
      { key: 'force', label: tr('even-if-not-merged'), type: 'bool', def: false },
    ],
    describe: (p) => tr('delete-branch-5', p.name || '?', p.force ? tr('forced') : ''),
  },
  stash: {
    group: 'changes',
    label: 'Stash',
    hint: tr('stash-uncommitted-changes'),
    fields: [{ key: 'message', label: tr('label-optional'), type: 'text', def: '', optional: true }],
    describe: (p) => tr('stash-changes-3', p.message ? ` «${p.message}»` : ''),
  },
  stashPop: {
    group: 'changes',
    label: 'Pop',
    hint: tr('pop-last-stash-2'),
    fields: [],
    describe: () => tr('pop-last-stash-2'),
  },
  commit: {
    group: 'changes',
    label: tr('commit-4'),
    hint: tr('with-pre-commit-guard-check'),
    fields: [
      { key: 'message', label: tr('message'), type: 'text', def: tr('input-commit-message') },
      { key: 'stageAll', label: tr('stage-all-changes-first-stage'), type: 'bool', def: true },
    ],
    describe: (p) => tr('commit-7', p.message || '?', p.stageAll ? tr('of-all-changes') : ''),
  },
  mergeRequest: {
    group: 'server',
    label: 'Merge request / PR',
    hint: tr('gitlab-via-api-github-pr'),
    fields: [
      { key: 'target', label: tr('into-which-branch'), type: 'branch', def: '{default}' },
      { key: 'title', label: tr('title'), type: 'text', def: '{branch}', optional: true },
      { key: 'draft', label: tr('draft'), type: 'bool', def: false },
      { key: 'open', label: tr('open-in-browser'), type: 'bool', def: true },
    ],
    describe: (p) => tr('from-current-branch-into', p.draft ? tr('draft-mr') : 'Merge request', p.target || '?'),
  },
  confirm: {
    group: 'other',
    label: tr('ask'),
    hint: tr('pause-continue-or-stop'),
    fields: [{ key: 'text', label: tr('question'), type: 'text', def: tr('continue') }],
    describe: (p) => tr('ask-2', p.text || tr('continue')),
  },
  git: {
    group: 'other',
    label: tr('custom-git-command'),
    hint: tr('any-git-command-no-shell'),
    fields: [{ key: 'command', label: tr('command'), type: 'text', def: 'git status', placeholder: 'git tag v{date}' }],
    describe: (p) => (p.command as string) || 'git …',
  },
};

export const STEP_GROUPS: readonly (readonly [StepGroupId, string])[] = [
  ['branch', tr('branches-2')],
  ['sync', tr('server-4')],
  ['changes', tr('changes-2')],
  ['server', 'Merge request'],
  ['other', tr('other-2')],
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
    title: tr('new-task-mr'),
    description: tr('branch-from-main-rebase-onto'),
    make: () =>
      tpl(tr('new-task'), 'Rocket', [
        ['fetch'],
        ['createBranch', { name: tr('feature-input-task-name-slug'), from: '{default}', checkout: true }],
        ['rebase', { onto: 'origin/{default}' }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: tr('input-task-name'), draft: true }],
      ]),
  },
  {
    id: 'update-branch',
    title: tr('update-branch-from-main'),
    description: tr('fetch-rebase-onto-origin-main'),
    make: () => tpl(tr('update-from-main'), 'RefreshCw', [['fetch'], ['rebase', { onto: 'origin/{default}' }], ['push', { force: true }]]),
  },
  {
    id: 'finish',
    title: tr('finish-task'),
    description: tr('commit-all-changes-push-and'),
    make: () =>
      tpl(tr('send-for-review'), 'Send', [
        ['commit', { message: tr('input-commit-message'), stageAll: true }],
        ['push'],
        ['mergeRequest', { target: '{default}', title: '{branch}' }],
      ]),
  },
  {
    id: 'sync-main',
    title: tr('pull-in-main-branch'),
    description: tr('switch-to-main-pull-and'),
    make: () =>
      tpl(tr('update-main'), 'Download', [
        ['checkout', { branch: '{default}' }],
        ['pull', { mode: 'ff-only' }],
        ['checkout', { branch: '{start}' }],
      ]),
  },
  {
    id: 'cleanup',
    title: tr('branch-merged-clean-up'),
    description: tr('switch-to-main-pull-and-delete'),
    make: () =>
      tpl(tr('clean-up-merged-branch'), 'Trash2', [
        ['confirm', { text: tr('delete-branch-start-after-updating') }],
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
  ['{branch}', tr('current-branch-at-time-of')],
  ['{start}', tr('branch-action-was-started-from')],
  ['{default}', tr('main-branch-main-master')],
  ['{date}', tr('todays-date-2026-10-26')],
  [tr('input-question'), tr('ask-at-run-time')],
  [tr('input-question-slug'), tr('ask-and-make-branch-name')],
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
  if (parts.length === 1 && !/^F\d+$/.test(key)) return tr('modifier-is-needed-ctrl-alt');
  if (parts.length === 2 && parts[0] === 'Shift' && !/^F\d+$/.test(key)) return tr('shift-letter-gets-in-way');
  if (RESERVED_HOTKEYS.has(combo)) return tr('this-shortcut-is-already-taken');
  const other = actions.find((a) => a.id !== selfId && a.hotkey === combo);
  if (other) return tr('already-assigned-to-action', other.name);
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
  if (!a.name?.trim()) problems.push(tr('enter-name-2'));
  if (!a.steps.length) problems.push(tr('add-at-least-one-step'));
  a.steps.forEach((s, i) => {
    const t: StepType | undefined = STEP_TYPES[s.type as StepTypeId];
    if (!t) problems.push(tr('step-unknown-type', i + 1));
    for (const f of t?.fields ?? []) {
      if (f.type !== 'bool' && !f.optional && !String(s.params?.[f.key] ?? '').trim()) {
        problems.push(tr('step-fill-in', i + 1, t.label, f.label));
      }
    }
  });
  return problems;
}
