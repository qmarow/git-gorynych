import { t as tr } from '../i18n/index.ts';
/**
 * Логика сообщения коммита: Conventional Commits, номер задачи из ветки, шаблоны.
 * Чистые функции — без React и без window, чтобы их было просто проверять.
 *
 * Summary разбирается на части:
 *   [TICKET] type(scope)!: subject (TICKET)
 *   prefix   type scope  breaking  subject suffix
 */

export interface CcType {
  id: string;
  hint: string;
  color: string;
}

export const CC_TYPES: readonly CcType[] = [
  { id: 'feat', hint: tr('Новая возможность'), color: '#3cf0a0' },
  { id: 'fix', hint: tr('Исправление ошибки'), color: '#f25d5d' },
  { id: 'refactor', hint: tr('Переделка кода без изменения поведения'), color: '#b98cff' },
  { id: 'chore', hint: tr('Рутина: зависимости, конфиги, сборка'), color: '#9aa3b2' },
  { id: 'docs', hint: tr('Документация'), color: '#2f9bff' },
  { id: 'style', hint: tr('Форматирование, пробелы, без изменения логики'), color: '#ff7ab6' },
  { id: 'test', hint: tr('Тесты'), color: '#f2ca33' },
  { id: 'perf', hint: tr('Производительность'), color: '#ff9f43' },
];

// Распознаём и «служебные» типы из спецификации, чтобы не принимать их за текст
const KNOWN_TYPES = new Set([...CC_TYPES.map((t) => t.id), 'build', 'ci', 'revert']);

const TICKET_SHAPE = '(?:[A-Z][A-Z0-9]{1,9}-\\d+|#\\d+)';
const SUFFIX_RE = new RegExp(`(?:^|\\s)\\((${TICKET_SHAPE})\\)\\s*$`);

/** Части summary. */
export interface SummaryParts {
  prefix: string | null;
  type: string | null;
  scope: string | null;
  breaking: boolean;
  subject: string;
  suffix: string | null;
}

export function parseSummary(text: unknown): SummaryParts {
  let rest = String(text ?? '').replace(/^\s+/, '');
  let prefix: string | null = null;
  let type: string | null = null;
  let scope: string | null = null;
  let breaking = false;
  let suffix: string | null = null;

  const m1 = rest.match(/^\[([^\]\n]{1,40})\]\s*/);
  if (m1) {
    prefix = m1[1].trim();
    rest = rest.slice(m1[0].length);
  }
  const m2 = rest.match(/^([a-z]+)(?:\(([^()\n]*)\))?(!)?:[ \t]?/);
  if (m2 && KNOWN_TYPES.has(m2[1])) {
    type = m2[1];
    scope = m2[2]?.trim() || null;
    breaking = Boolean(m2[3]);
    rest = rest.slice(m2[0].length);
  }
  const m3 = rest.match(SUFFIX_RE);
  if (m3) {
    suffix = m3[1];
    rest = rest.slice(0, m3.index);
  }
  return { prefix, type, scope, breaking, subject: rest, suffix };
}

/** Начало summary до текста (префиксы) — сюда ставится курсор после клика по чипсу */
export function headOf(p: SummaryParts): string {
  let out = '';
  if (p.prefix) out += `[${p.prefix}] `;
  if (p.type) out += `${p.type}${p.scope ? `(${p.scope})` : ''}${p.breaking ? '!' : ''}: `;
  return out;
}

export function buildSummary(p: SummaryParts): string {
  // Номер в конце всегда отделён пробелом — даже при пустом тексте курсор стоит перед ним
  return headOf(p) + p.subject + (p.suffix ? ` (${p.suffix})` : '');
}

/** Позиция курсора: конец текста, перед « (TICKET)» */
export function caretOf(p: SummaryParts): number {
  return headOf(p).length + p.subject.length;
}

/* ---------------- Номер задачи ---------------- */

// Слова, которые означают «это номер issue» → #42
const ISSUE_WORDS = new Set(['issue', 'issues', 'gh', 'bug', 'bugs', 'fix', 'fixes', 'ticket', 'task', 'tasks', 'pr', 'mr', 'story', 'item']);
// Похожие на ключ задачи, но нет: версии, шаги и т. п.
const NOT_KEYS = new Set([
  'release', 'rel', 'version', 'ver', 'v', 'hotfix', 'feature', 'feat', 'bugfix', 'sprint', 'week', 'day', 'step', 'part', 'phase',
  'iter', 'node', 'python', 'py', 'java', 'php', 'es', 'ie', 'utf', 'iso', 'http', 'rfc', 'top', 'wip', 'test', 'tmp', 'temp',
  'chore', 'docs', 'refactor', 'perf', 'style', 'build', 'ci', 'revert', 'dev', 'prod', 'stage', 'staging', 'vue', 'react', 'angular',
]);
// Первый сегмент ветки, после которого число — это версия, а не задача
const VERSION_PREFIXES = new Set(['release', 'releases', 'rel', 'version', 'versions', 'v', 'hotfix-release', 'tag', 'tags']);

/**
 * Номер задачи из имени ветки:
 *   feature/PROJ-123-login → PROJ-123,  feature/proj-123-login → PROJ-123,
 *   bugfix/1234-fix → #1234,  issue-42 → #42,  fix/#77 → #77.
 * pattern — своё регулярное выражение (первая группа или всё совпадение).
 */
export function extractTicket(branch: unknown, pattern = ''): string | null {
  const name = String(branch ?? '').trim();
  if (!name) return null;

  if (pattern && pattern.trim()) {
    let re: RegExp | null;
    try {
      re = new RegExp(pattern.trim(), 'i');
    } catch {
      re = null;
    }
    if (re) {
      const m = name.match(re);
      if (!m) return null;
      const v = (m[1] ?? m[0]).trim();
      if (!v) return null;
      if (/^#?\d+$/.test(v)) return `#${v.replace('#', '')}`;
      return /^[a-z][a-z0-9]*-\d+$/i.test(v) ? v.toUpperCase() : v;
    }
  }

  const segs = name.split('/');
  const versionBranch = segs.length > 1 && VERSION_PREFIXES.has(segs[0].toLowerCase());

  // 1. Ключ в верхнем регистре где угодно: PROJ-123
  const up = name.match(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![0-9])/);
  if (up && !versionBranch) {
    const key = up[1].toLowerCase();
    if (ISSUE_WORDS.has(key)) return `#${up[2]}`;
    if (!NOT_KEYS.has(key)) return `${up[1]}-${up[2]}`;
  }
  // 2. #123 где угодно
  const hash = name.match(/#(\d{1,7})(?![0-9])/);
  if (hash) return `#${hash[1]}`;
  if (versionBranch) return null;

  // 3. В начале сегмента: proj-123…, issue-42…, 1234-…
  for (const seg of segs) {
    const kw = seg.match(/^([a-z][a-z0-9]{0,9})[-_](\d+)(?=$|[-_.])/i);
    if (kw) {
      const key = kw[1].toLowerCase();
      if (ISSUE_WORDS.has(key)) return `#${kw[2]}`;
      // ключ из строчных — только с номером от двух цифр (feature/add-2-buttons — не задача)
      if (!NOT_KEYS.has(key) && key.length >= 2 && kw[2].length >= 2 && /^[a-z]/.test(key)) return `${kw[1].toUpperCase()}-${kw[2]}`;
    }
    const num = seg.match(/^(\d{1,7})(?=$|[-_])/);
    if (num && (segs.length > 1 || /[-_]/.test(seg))) return `#${num[1]}`;
  }
  return null;
}

export type TicketFormat = 'prefix' | 'scope' | 'suffix' | 'footer';

export const TICKET_FORMATS: readonly { id: TicketFormat; label: string; hint: string }[] = [
  { id: 'prefix', label: '[PROJ-123] feat: …', hint: tr('В квадратных скобках в начале') },
  { id: 'scope', label: 'feat(PROJ-123): …', hint: tr('Вместо scope; без типа — в скобках в начале') },
  { id: 'suffix', label: 'feat: … (PROJ-123)', hint: tr('В конце, как в GitHub') },
  { id: 'footer', label: 'Refs: PROJ-123', hint: tr('Отдельной строкой в конце Description') },
];

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const footerRe = (t: string) => new RegExp(`^(?:Refs|Closes|Fixes|Resolves):\\s*${escapeRe(t)}\\s*$`, 'im');

export function ticketInSummary(p: SummaryParts, t: string | null | undefined): boolean {
  return Boolean(t) && (same(p.prefix, t) || same(p.suffix, t) || same(p.scope, t));
}

export function hasTicket(summary: unknown, description: string | null | undefined, t: string | null | undefined): boolean {
  if (!t) return false;
  return ticketInSummary(parseSummary(summary), t) || footerRe(t).test(description ?? '');
}

function stripFromParts(p: SummaryParts, t: string): SummaryParts {
  return {
    ...p,
    prefix: same(p.prefix, t) ? null : p.prefix,
    suffix: same(p.suffix, t) ? null : p.suffix,
    scope: same(p.scope, t) ? null : p.scope,
  };
}

function placeInParts(p: SummaryParts, t: string, format: unknown): SummaryParts {
  if (format === 'suffix') return { ...p, suffix: t };
  if (format === 'scope' && p.type && !p.scope) return { ...p, scope: t };
  // prefix — и запасной вариант для scope, когда типа нет или scope уже занят
  return { ...p, prefix: t };
}

function stripFooter(desc: string | null | undefined, t: string): string {
  const lines = String(desc ?? '').split('\n');
  const re = footerRe(t);
  const kept = lines.filter((l) => !re.test(l));
  return kept.join('\n').replace(/\s+$/, '');
}

function addFooter(desc: string | null | undefined, t: string): string {
  const d = String(desc ?? '').replace(/\s+$/, '');
  return d ? `${d}\n\nRefs: ${t}` : `Refs: ${t}`;
}

/** Номер задачи формы коммита и где его держать. */
export interface TicketContext {
  ticket?: string | null;
  format?: TicketFormat | string;
}

export interface SummaryEdit {
  summary: string;
  caret: number;
  parts: SummaryParts;
}

/** Изменить summary, сохранив номер задачи на «своём» месте (тип мог появиться или исчезнуть) */
function rework(summary: unknown, ctx: TicketContext | null | undefined, fn: (q: SummaryParts) => SummaryParts): SummaryEdit {
  const p = parseSummary(summary);
  const t = ctx?.ticket;
  const att = t && ctx!.format !== 'footer' && ticketInSummary(p, t);
  let q = att ? stripFromParts(p, t) : p;
  q = fn(q);
  if (att) q = placeInParts(q, t, ctx!.format);
  return { summary: buildSummary(q), caret: caretOf(q), parts: q };
}

/** Клик по чипсу типа: поставить, заменить или (повторный клик) убрать */
export function toggleType(summary: unknown, type: string, ctx?: TicketContext | null): SummaryEdit {
  return rework(summary, ctx, (q) => (q.type === type ? { ...q, type: null, scope: null, breaking: false } : { ...q, type }));
}

export function setScope(summary: unknown, scope: unknown, ctx?: TicketContext | null): SummaryEdit {
  const s = String(scope ?? '').trim().replace(/[()\n]/g, '');
  return rework(summary, ctx, (q) => (q.type ? { ...q, scope: s || null } : q));
}

export function toggleBreaking(summary: unknown, ctx?: TicketContext | null): SummaryEdit {
  return rework(summary, ctx, (q) => (q.type ? { ...q, breaking: !q.breaking } : q));
}

export interface TicketEdit {
  summary: string;
  description: string;
  caret: number;
}

/** Добавить или убрать номер задачи. → { summary, description, caret } */
export function toggleTicket(summary: unknown, description: string | null | undefined, t: string, format: unknown): TicketEdit & { added: boolean } {
  const p = parseSummary(summary);
  if (hasTicket(summary, description, t)) {
    const q = stripFromParts(p, t);
    return { summary: buildSummary(q), description: stripFooter(description, t), caret: caretOf(q), added: false };
  }
  return { ...attachTicket(summary, description, t, format), added: true };
}

/**
 * С форматом `footer` summary возвращается как пришло (в 1.x — без `String()`): для строки из поля ввода это одно и то же.
 */
export function attachTicket(summary: unknown, description: string | null | undefined, t: string, format: unknown): TicketEdit {
  if (format === 'footer') {
    const p = parseSummary(summary);
    return { summary: summary as string, description: addFooter(description, t), caret: caretOf(p) };
  }
  const q = placeInParts(parseSummary(summary), t, format);
  return { summary: buildSummary(q), description: description ?? '', caret: caretOf(q) };
}

/** Есть ли что коммитить: текст без префиксов и номера */
export function subjectOf(summary: unknown): string {
  return parseSummary(summary).subject.trim();
}

/* ---------------- Scope из staged-файлов ---------------- */

const GENERIC_DIRS = new Set(['src', 'source', 'lib', 'libs', 'app', 'apps', 'packages', 'pkg', 'modules', 'internal', 'cmd', 'main', 'java', 'kotlin', 'resources']);

/** Предложения scope по папкам staged-файлов: общая папка, затем самые частые */
export function suggestScopes(paths: readonly (string | null | undefined)[] | null | undefined, max = 6): string[] {
  const list = (paths ?? []).filter((p): p is string => Boolean(p)).map((p) => p.replace(/\\/g, '/'));
  if (!list.length) return [];
  const dirsOf = (p: string) => p.split('/').slice(0, -1);
  const meaningful = (dirs: string[]) => {
    const m = dirs.filter((d) => !GENERIC_DIRS.has(d.toLowerCase()) && !d.startsWith('.'));
    // src/lib/x.js — все папки «общие», но вложенная всё же что-то значит
    return m.length || dirs.length < 2 ? m : [dirs[dirs.length - 1]];
  };

  const out: string[] = [];
  const add = (s: string | undefined) => {
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  };

  // Общая папка всех файлов (последний «осмысленный» сегмент)
  let common = dirsOf(list[0]);
  for (const p of list.slice(1)) {
    const d = dirsOf(p);
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }
  const cm = meaningful(common);
  if (cm.length) add(cm[cm.length - 1]);

  // Частота первой осмысленной папки каждого файла
  const freq = new Map<string, number>();
  for (const p of list) {
    const m = meaningful(dirsOf(p));
    let key: string | undefined = m[0];
    if (!key) {
      const base = p.split('/').pop()!;
      if (/^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?)$/i.test(base)) key = 'deps';
      else if (/^readme/i.test(base) || /\.md$/i.test(base)) key = 'docs';
      else if (/^\.?(gitlab-ci\.yml|github)/i.test(base) || p.startsWith('.github/')) key = 'ci';
    }
    if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  for (const [k] of [...freq].sort((a, b) => b[1] - a[1])) add(k);
  return out.slice(0, max);
}

/* ---------------- Шаблоны описания ---------------- */

export interface CommitTemplate {
  id: string;
  name: string;
  body: string;
}

export const DEFAULT_TEMPLATES: readonly CommitTemplate[] = [
  {
    id: 'tpl-what-how',
    name: tr('Что сделано / Как проверить'),
    body: tr('Что сделано:\n- \n\nКак проверить:\n1. \n\nЗадача: {ticket}'),
  },
  {
    id: 'tpl-bugfix',
    name: tr('Исправление ошибки'),
    body: tr('Проблема:\n\nПричина:\n\nРешение:\n\nКак проверить:\n'),
  },
  {
    id: 'tpl-breaking',
    name: tr('Несовместимое изменение'),
    body: tr('BREAKING CHANGE: \n\nЧто сделать при обновлении:\n- '),
  },
];

export function fillTemplate(body: unknown, vars?: { ticket?: string | null; branch?: string | null } | null): string {
  return String(body ?? '').replace(/\{(ticket|branch)\}/g, (_, k: 'ticket' | 'branch') => vars?.[k] ?? '');
}

const FOOTER_LINE = /^(?:Refs|Closes|Fixes|Resolves|BREAKING[ -]CHANGE|Co-authored-by|Signed-off-by):\s/i;

/** Вставить шаблон в описание: перед строками-футерами (Refs: …), через пустую строку. → { description, caret } */
export function insertTemplate(description: unknown, body: unknown): { description: string; caret: number } {
  const lines = String(description ?? '').replace(/\s+$/, '').split('\n');
  const footer: string[] = [];
  while (lines.length && (FOOTER_LINE.test(lines[lines.length - 1]) || (!lines[lines.length - 1].trim() && footer.length))) {
    const l = lines.pop()!;
    if (l.trim()) footer.unshift(l);
  }
  const main = lines.join('\n').replace(/\s+$/, '');
  const b = String(body ?? '').replace(/\s+$/, '');
  const head = main ? `${main}\n\n` : '';
  // Курсор — в конец первой строки шаблона (обычно «Что сделано:») и на следующую строку, если она пустая
  const firstLineEnd = b.indexOf('\n') === -1 ? b.length : b.indexOf('\n');
  const result = head + b + (footer.length ? `\n\n${footer.join('\n')}` : '');
  let caret = head.length + firstLineEnd;
  const after = b.slice(firstLineEnd + 1);
  if (b[firstLineEnd] === '\n') {
    const nextLineEnd = after.indexOf('\n') === -1 ? after.length : after.indexOf('\n');
    if (/^\s*(?:[-*]|\d+\.)?\s*$/.test(after.slice(0, nextLineEnd))) caret = head.length + firstLineEnd + 1 + nextLineEnd;
  }
  return { description: result, caret };
}
