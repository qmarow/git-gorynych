/**
 * Новое в 2.0: чистые функции раздела «Задачи» (issues сервера репозитория): фильтр, номера и ссылки `#123`, имя ветки из
 * задачи, склейка ленты, мгновенное применение правки, цвет текста метки. Типы — из `bindings/commands.ts`.
 * Проверка — `tests/ui-parity/lib-issues.mjs`.
 */
import type {
  IssueComment_Serialize,
  IssueEvent_Serialize,
  IssueLabel_Serialize,
  IssueMeta_Serialize,
  IssueMilestone_Serialize,
  IssuePatch_Deserialize,
  IssueQuery_Serialize,
  IssueUser_Serialize,
  Issue_Serialize,
  TimelineItem_Serialize,
} from '../../crates/gorynych-tauri/bindings/commands.ts';

export type IssueQuery = IssueQuery_Serialize;
export type Issue = Issue_Serialize;
export type IssuePatch = IssuePatch_Deserialize;

/** Цвет метки, у которой сервер его не отдал (`DEFAULT_LABEL_COLOR` в `issues/models.rs`). */
export const DEFAULT_LABEL_COLOR = '#8a92a2';

/** Фильтр по умолчанию: открытые, недавно обновлённые сверху, страница 1, 30 задач. */
export const DEFAULT_QUERY: Readonly<IssueQuery> = Object.freeze({
  state: 'open',
  search: null,
  labels: [],
  assignee: null,
  author: null,
  milestone: null,
  sort: 'updated',
  ascending: false,
  page: 1,
  perPage: 30,
});

/** Фильтр целиком: пропущенные поля — из `DEFAULT_QUERY`, пустые строки — `null`. */
export function normalizeQuery(query: Partial<IssueQuery> | null | undefined): IssueQuery {
  const q = { ...DEFAULT_QUERY, ...(query ?? {}) };
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
  return {
    state: q.state === 'open' || q.state === 'closed' ? q.state : null,
    search: text(q.search),
    labels: Array.isArray(q.labels) ? q.labels.filter((label): label is string => typeof label === 'string' && label !== '') : [],
    assignee: text(q.assignee),
    author: text(q.author),
    milestone: text(q.milestone),
    sort: q.sort === 'created' || q.sort === 'comments' ? q.sort : 'updated',
    ascending: q.ascending === true,
    page: Number.isInteger(q.page) && q.page >= 1 ? q.page : 1,
    perPage: Number.isInteger(q.perPage) && q.perPage >= 1 ? Math.min(q.perPage, 100) : 30,
  };
}

/**
 * Стабильный ключ фильтра без номера страницы: одинаковые фильтры дают одну строку при любом порядке полей и меток
 * (метки — условие «все выбранные», порядок не важен), поиск — без пробелов по краям.
 */
export function queryKey(query: Partial<IssueQuery>): string {
  const q = normalizeQuery(query);
  return JSON.stringify([q.state, q.search?.trim() ?? null, [...new Set(q.labels)].sort(), q.assignee, q.author, q.milestone, q.sort, q.ascending, q.perPage]);
}

/** Отличается ли фильтр от умолчания (для ссылки «Сбросить фильтры»). */
export function isDefaultQuery(query: Partial<IssueQuery>): boolean {
  return queryKey(query) === queryKey(DEFAULT_QUERY);
}

/** `#123` или `123` → 123; ноль, дробь, текст и пустая строка → `null`. */
export function parseIssueNumber(text: string | null | undefined): number | null {
  const match = /^\s*#?(\d{1,15})\s*$/.exec(text ?? '');
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && Number.isSafeInteger(number) ? number : null;
}

/* ---------- Имя ветки ---------- */

export const DEFAULT_BRANCH_TEMPLATE = '{number}-{slug}';
export const MAX_BRANCH_NAME = 60;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

/** Часть имени ветки из заголовка: нижний регистр, кириллица латиницей, всё кроме a-z0-9 — `-`, без повторов и краёв. */
export function slugify(title: string): string {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  // Буквы с диакритикой — без неё (é → e), остальное не из a-z0-9 — разделитель
  return latin.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Имя ветки по шаблону (`{number}` — номер задачи, `{slug}` — заголовок, см. `slugify`): повторы `-` сжимаются, длина —
 * не больше 60 символов, `-` и `/` на краях убираются. Пустой заголовок даёт просто номер.
 */
export function branchNameFor(issue: Pick<Issue, 'number' | 'title'>, template: string = DEFAULT_BRANCH_TEMPLATE): string {
  const name = (template || DEFAULT_BRANCH_TEMPLATE).split('{number}').join(String(issue.number)).split('{slug}').join(slugify(issue.title ?? ''));
  const clean = (text: string) => text.replace(/-{2,}/g, '-').replace(/^[-/]+|[-/]+$/g, '');
  return clean(clean(name).slice(0, MAX_BRANCH_NAME));
}

/* ---------- Ссылки #123 ---------- */

export interface IssueRef {
  number: number;
  /** Позиции в единицах UTF-16 (`String.slice`): `#` и конец числа. */
  start: number;
  end: number;
}

/**
 * Все ссылки `#число` в тексте. Не считаются: внутри слова (`abc#12`, `#12abc`), после `&` (`&#12;` — сущность HTML),
 * `#0` и номер с ведущим нулём.
 */
export function findIssueRefs(text: string): IssueRef[] {
  const refs: IssueRef[] = [];
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_&#])#([1-9]\d{0,14})(?![\p{L}\p{N}_])/gu)) {
    const start = match.index ?? 0;
    refs.push({ number: Number(match[1]), start, end: start + match[0].length });
  }
  return refs;
}

/* ---------- Лента ---------- */

export type TimelineEntry =
  | { type: 'comment'; comment: IssueComment_Serialize }
  | { type: 'events'; events: IssueEvent_Serialize[]; actor: IssueUser_Serialize | null; createdAt: string };

/** Окно склейки событий одного автора, мс. */
export const MERGE_WINDOW = 60_000;

const userKey = (user: IssueUser_Serialize | null | undefined): string | null => (user ? user.id || user.login || null : null);

/**
 * Лента для показа: подряд идущие события одного автора, случившиеся в пределах минуты от первого из них, — одна
 * строка. Событие без автора или без даты ни с чем не склеивается; комментарий разрывает цепочку.
 */
export function mergeTimeline(items: readonly TimelineItem_Serialize[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const item of items) {
    if (item.type === 'comment') {
      const { type: _type, ...comment } = item;
      out.push({ type: 'comment', comment });
      continue;
    }
    const { type: _type, ...event } = item;
    const last = out[out.length - 1];
    const key = userKey(event.actor);
    const at = Date.parse(event.createdAt);
    if (last?.type === 'events' && key !== null && userKey(last.actor) === key && Number.isFinite(at)) {
      const since = at - Date.parse(last.createdAt);
      if (since >= 0 && since <= MERGE_WINDOW) {
        last.events.push(event);
        continue;
      }
    }
    out.push({ type: 'events', events: [event], actor: event.actor, createdAt: event.createdAt });
  }
  return out;
}

/* ---------- Мгновенный отклик ---------- */

function findLabel(meta: IssueMeta_Serialize | null, current: readonly IssueLabel_Serialize[], ref: { id?: string; name?: string }): IssueLabel_Serialize {
  const all = [...current, ...(meta?.labels ?? [])];
  const found = (ref.id && all.find((label) => label.id === ref.id)) || (ref.name && all.find((label) => label.name === ref.name));
  return found || { id: ref.id ?? '', name: ref.name ?? '', color: DEFAULT_LABEL_COLOR, description: null };
}

function findUser(meta: IssueMeta_Serialize | null, current: readonly IssueUser_Serialize[], ref: { id?: string; login?: string }): IssueUser_Serialize {
  const all = [...current, ...(meta?.members ?? []), ...(meta?.me ? [meta.me] : [])];
  const found = (ref.id && all.find((user) => user.id === ref.id)) || (ref.login && all.find((user) => user.login === ref.login));
  return found || { id: ref.id ?? '', login: ref.login ?? '', name: null, avatarUrl: null, webUrl: null };
}

function findMilestone(meta: IssueMeta_Serialize | null, current: IssueMilestone_Serialize | null, ref: { id?: string; number?: number | null; title?: string }): IssueMilestone_Serialize {
  const all = [...(current ? [current] : []), ...(meta?.milestones ?? [])];
  const found =
    (ref.id && all.find((m) => m.id === ref.id)) ||
    (ref.number != null && all.find((m) => m.number === ref.number)) ||
    (ref.title && all.find((m) => m.title === ref.title));
  return found || { id: ref.id ?? '', number: ref.number ?? null, title: ref.title ?? '', dueDate: null, closed: false };
}

/**
 * Задача после правки — то, что покажется до ответа сервера. Метки, люди и веха берутся из `meta` (или из самой задачи),
 * если их там нет — собираются из ссылки. Закрытие ставит `closedAt = now`, открытие снимает его и причину.
 * `updatedAt` не меняется: порядок списка до ответа сервера тот же.
 */
export function applyPatch(issue: Issue, patch: IssuePatch, meta: IssueMeta_Serialize | null, now: string = new Date().toISOString()): Issue {
  const next: Issue = { ...issue };
  if (patch.title != null) next.title = patch.title;
  if (patch.body != null) next.body = patch.body;
  if (patch.state != null && patch.state !== issue.state) {
    next.state = patch.state;
    next.closedAt = patch.state === 'closed' ? now : null;
    if (patch.state === 'open') next.stateReason = null;
  }
  if (patch.stateReason != null) next.stateReason = patch.stateReason;
  if (patch.labels != null) next.labels = patch.labels.map((ref) => findLabel(meta, issue.labels, ref));
  if (patch.assignees != null) next.assignees = patch.assignees.map((ref) => findUser(meta, issue.assignees, ref));
  if (patch.clearMilestone) next.milestone = null;
  else if (patch.milestone != null) next.milestone = findMilestone(meta, issue.milestone, patch.milestone);
  if (patch.clearDueDate) next.dueDate = null;
  else if (patch.dueDate != null) next.dueDate = patch.dueDate;
  if (patch.confidential != null) next.confidential = patch.confidential;
  if (patch.locked != null) next.locked = patch.locked;
  return next;
}

/* ---------- Метки ---------- */

/** `#rgb` / `#rrggbb` (с решёткой или без) → [r, g, b] 0…255, иначе `null`. */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Чёрный или белый текст на фоне метки: тот, у которого контраст с фоном выше (относительная яркость WCAG).
 * Непонятный цвет — как `DEFAULT_LABEL_COLOR`.
 */
export function labelTextColor(hex: string | null | undefined): '#000000' | '#ffffff' {
  const rgb = parseHex(hex) ?? (parseHex(DEFAULT_LABEL_COLOR) as [number, number, number]);
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Контраст с чёрным (L + 0.05) / 0.05 против контраста с белым 1.05 / (L + 0.05)
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

/* ---------- Прочее ---------- */

/** Временный id комментария до ответа сервера: такой комментарий показывается полупрозрачным. */
export const TEMP_PREFIX = 'tmp-';
export const isTemporaryId = (id: string): boolean => id.startsWith(TEMP_PREFIX);

/** Задача изменилась после последнего просмотра. Никогда не открытая задача не отмечается. */
export function isUpdatedSince(issue: Pick<Issue, 'updatedAt'>, seenAt: string | null | undefined): boolean {
  if (!seenAt) return false;
  const updated = Date.parse(issue.updatedAt);
  const seen = Date.parse(seenAt);
  return Number.isFinite(updated) && Number.isFinite(seen) && updated > seen;
}
