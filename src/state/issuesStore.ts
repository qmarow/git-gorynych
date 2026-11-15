/**
 * Новое в 2.0: состояние раздела «Задачи» (issues сервера репозитория), отдельно для каждого пути репозитория
 * (`byRepo[путь]`). Экранов здесь нет — их строят этапы 3–8 плана «Инструмент задач».
 *
 * Правила:
 * - **побеждает последний запрос**: у списка и у каждой карточки свой счётчик; ответ с устаревшим номером отбрасывается
 *   (как `seq` в `repoStore.ts`). `loadMore` идёт под счётчиком списка: смена фильтра или обновление делают его ответ ничьим;
 * - **фоновое обновление не затирает свои правки**: пока `pending[номер] > 0`, задача из ответа списка (и шапка карточки из
 *   ответа `get`) не подменяет показанную;
 * - **ошибка не стирает данные**: `items` и `details` остаются, ошибка — в `listError` / `details[n].error`;
 * - **другая вкладка не мешает**: ответ пишется в `byRepo` того пути, с которым ушёл запрос; после `forget(path)` — никуда;
 * - **перезапуск**: `query` и `seenAt` — в `localStorage['issues.state.v1:<путь>']`, остальное только в памяти.
 *
 * Правки (`update`, `comment*`) показываются сразу, а при ошибке возвращается снимок до правки и ошибка уходит вызывающему.
 * Если по одной задаче идут две правки и первая не прошла, её снимок снимает и вторую до ответа на неё — ответ сервера
 * затем ставит верное состояние. Черновики удаляются здесь, после успешного ответа (`lib/issueDrafts.ts`).
 * Проверка — `tests/ui-parity/issues-store.mjs`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  IssueCaps,
  IssueComment_Serialize,
  IssueCounts,
  IssueDetail_Serialize,
  IssueInput_Deserialize,
  IssueLabel_Serialize,
  IssueMeta_Serialize,
  RemoteOptions_Deserialize,
  TimelineItem_Serialize,
} from '../../crates/gorynych-tauri/bindings/commands.ts';
import type { ApiError, ApiResult, IssuesApi } from '../platform/tauri.ts';
import { DEFAULT_QUERY, TEMP_PREFIX, applyPatch, normalizeQuery, type Issue, type IssuePatch, type IssueQuery } from '../lib/issues.ts';
import { clearDraft } from '../lib/issueDrafts.ts';

export type ListStatus = 'idle' | 'loading' | 'refreshing' | 'loadingMore' | 'error';
export type IssueDetail = IssueDetail_Serialize;

export interface DetailEntry {
  detail: IssueDetail | null;
  status: 'loading' | 'idle' | 'error';
  error: ApiError | null;
  loadedAt: number;
}

export type IssuesViewMode = 'list' | 'board';

export interface BoardData {
  items: Issue[];
  status: 'idle' | 'loading' | 'error';
  error: ApiError | null;
  /** Открытых больше 300 — показаны первые. */
  truncated: boolean;
}

export interface BulkProgress {
  done: number;
  total: number;
  running: boolean;
}

export interface BulkResult {
  ok: number[];
  failed: number[];
  stopped: boolean;
}

export interface RepoIssues {
  query: IssueQuery;
  /** Список или доска; хранится в `issues.state.v1`. */
  view: IssuesViewMode;
  board: BoardData | null;
  bulk: BulkProgress | null;
  /** remote, к которому обращаться (`opts.remote`); `null` — upstream текущей ветки или `origin`. */
  remote: string | null;
  items: Issue[];
  page: number;
  hasMore: boolean;
  counts: IssueCounts | null;
  caps: IssueCaps | null;
  provider: string | null;
  label: string | null;
  webUrl: string | null;
  listStatus: ListStatus;
  listError: ApiError | null;
  meta: IssueMeta_Serialize | null;
  metaLoadedAt: number;
  /** Номер открытой задачи, `'new'` — форма новой задачи. */
  selected: number | 'new' | null;
  details: Record<number, DetailEntry>;
  pending: Record<number, number>;
  seenAt: Record<number, string>;
}

export interface IssuesState {
  byRepo: Record<string, RepoIssues>;
  /** Открытые задачи, назначенные мне, по путям (`refreshMine`): живёт и без открытого раздела. */
  mine: Record<string, Issue[]>;
  open: (path: string, remote?: string | null) => Promise<void>;
  setQuery: (path: string, patch: Partial<IssueQuery>) => Promise<void>;
  refresh: (path: string, opts?: { silent?: boolean }) => Promise<void>;
  loadMore: (path: string) => Promise<void>;
  loadMeta: (path: string, opts?: { force?: boolean }) => Promise<void>;
  select: (path: string, number: number | 'new' | null) => Promise<void>;
  /** `stay` — форма «Создать ещё одну»: выбор остаётся `'new'`. */
  create: (path: string, input: IssueInput_Deserialize, opts?: { stay?: boolean }) => Promise<ApiResult<Issue>>;
  update: (path: string, number: number, patch: IssuePatch) => Promise<ApiResult<Issue>>;
  commentAdd: (path: string, number: number, body: string) => Promise<ApiResult<IssueComment_Serialize>>;
  commentUpdate: (path: string, number: number, id: string, body: string) => Promise<ApiResult<IssueComment_Serialize>>;
  commentDelete: (path: string, number: number, id: string) => Promise<ApiResult<null>>;
  labelCreate: (path: string, name: string, color: string) => Promise<ApiResult<IssueLabel_Serialize>>;
  remove: (path: string, number: number) => Promise<ApiResult<null>>;
  /** Предпросмотр Markdown: тот же HTML, что сервис кладёт в `bodyHtml`. */
  renderMarkdown: (path: string, text: string) => Promise<ApiResult<string>>;
  /** Задача с сервера без записи в состояние — проверка «описание изменили на сервере» перед сохранением. */
  fetchDetail: (path: string, number: number) => Promise<ApiResult<IssueDetail>>;
  forget: (path: string) => void;
  setView: (path: string, view: IssuesViewMode) => void;
  /** Доска: все открытые (до 300, страницами по 100) и 30 последних закрытых, с фильтрами панели. */
  loadBoard: (path: string) => Promise<void>;
  /** Правка многих задач: по 4 запроса одновременно, `stopBulk` останавливает очередь. */
  bulkUpdate: (path: string, numbers: readonly number[], makePatch: (issue: Issue) => IssuePatch | null) => Promise<BulkResult>;
  stopBulk: (path: string) => void;
  /**
   * Открытые задачи, назначенные мне (`assignee: '@me'`, до 100): `mine`. Возвращает задачи, которых не было в прошлом
   * ответе; первый ответ по репозиторию только запоминается. Ошибки молча игнорируются (`[]`).
   */
  refreshMine: (path: string, remote?: string | null) => Promise<Issue[]>;
}

export const STATE_PREFIX = 'issues.state.v1:';
/** Метки, вехи и участники устаревают через 10 минут. */
export const META_TTL = 10 * 60_000;
/** Карточек в памяти — не больше. */
export const MAX_DETAILS = 50;
/** `refresh` перечитывает не больше пяти страниц. */
export const MAX_REFRESH_PAGES = 5;
/** Доска: открытые — до трёх страниц по 100, закрытые — 30 последних. */
export const BOARD_PAGES = 3;
export const BOARD_PAGE = 100;
export const BOARD_CLOSED = 30;
/** Сколько правок `bulkUpdate` идёт одновременно. */
export const BULK_PARALLEL = 4;
const MAX_SEEN = 500;

const NO_API: ApiError = { code: 'UNSUPPORTED', message: 'window.api.issues is unavailable', hint: null, details: '' };

export function emptyRepo(query?: Partial<IssueQuery>, seenAt: Record<number, string> = {}, view: IssuesViewMode = 'list'): RepoIssues {
  return {
    query: normalizeQuery(query),
    view,
    board: null,
    bulk: null,
    remote: null,
    items: [],
    page: 0,
    hasMore: false,
    counts: null,
    caps: null,
    provider: null,
    label: null,
    webUrl: null,
    listStatus: 'idle',
    listError: null,
    meta: null,
    metaLoadedAt: 0,
    selected: null,
    details: {},
    pending: {},
    seenAt,
  };
}

/** Задачи без повторов по номеру, порядок первых вхождений. */
export function uniqueByNumber(items: readonly Issue[]): Issue[] {
  const seen = new Set<number>();
  return items.filter((issue) => !seen.has(issue.number) && (seen.add(issue.number), true));
}

/** Ответ сервера, в котором задачи со своими незавершёнными правками заменены показанными. */
function keepPending(fresh: readonly Issue[], shown: readonly Issue[], pending: Record<number, number>): Issue[] {
  return fresh.map((issue) => ((pending[issue.number] ?? 0) > 0 ? (shown.find((s) => s.number === issue.number) ?? issue) : issue));
}

const later = (a: string | undefined, b: string): string => (a && Date.parse(a) >= Date.parse(b) ? a : b);

export interface IssuesStoreOptions {
  now?: () => number;
  storage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

export type IssuesStore = StoreApi<IssuesState>;

export function createIssuesStore(getApi: () => IssuesApi | undefined, options: IssuesStoreOptions = {}): IssuesStore {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? (() => (typeof localStorage === 'undefined' ? undefined : localStorage));
  const listSeq = new Map<string, number>();
  const metaSeq = new Map<string, number>();
  const detailSeq = new Map<string, number>();
  const boardSeq = new Map<string, number>();
  const bulkSeq = new Map<string, number>();
  const mineSeq = new Map<string, number>();
  /** Номера назначенных из прошлого ответа `refreshMine` (первый ответ только запоминается). */
  const mineSeen = new Map<string, Set<number>>();
  let tempId = 0;

  const bump = (map: Map<string, number>, key: string) => {
    const next = (map.get(key) ?? 0) + 1;
    map.set(key, next);
    return next;
  };

  function readSaved(path: string): { query?: Partial<IssueQuery>; seenAt?: Record<number, string>; view?: IssuesViewMode } {
    try {
      const raw = storage()?.getItem(STATE_PREFIX + path);
      const value: unknown = raw ? JSON.parse(raw) : null;
      return value && typeof value === 'object' ? (value as { query?: Partial<IssueQuery>; seenAt?: Record<number, string>; view?: IssuesViewMode }) : {};
    } catch {
      return {};
    }
  }

  return createStore<IssuesState>()((set, get) => {
    const repoOf = (path: string): RepoIssues | undefined => get().byRepo[path];
    /** Меняет состояние пути, если оно ещё есть (вкладку могли закрыть, пока шёл запрос). */
    const patch = (path: string, fn: (repo: RepoIssues) => Partial<RepoIssues>) =>
      set((s) => {
        const repo = s.byRepo[path];
        return repo ? { byRepo: { ...s.byRepo, [path]: { ...repo, ...fn(repo) } } } : s;
      });
    const opts = (path: string): RemoteOptions_Deserialize | null => {
      const remote = repoOf(path)?.remote;
      return remote ? { remote } : null;
    };
    const persist = (path: string) => {
      const repo = repoOf(path);
      if (!repo) return;
      try {
        const seen = Object.entries(repo.seenAt).slice(-MAX_SEEN);
        storage()?.setItem(STATE_PREFIX + path, JSON.stringify({ query: { ...repo.query, page: 1 }, seenAt: Object.fromEntries(seen), ...(repo.view === 'board' ? { view: 'board' } : {}) }));
      } catch {
        /* хранилище недоступно — фильтр живёт до перезапуска */
      }
    };
    const pendingDelta = (path: string, number: number, delta: number) =>
      patch(path, (repo) => {
        const count = Math.max(0, (repo.pending[number] ?? 0) + delta);
        const pending = { ...repo.pending };
        if (count) pending[number] = count;
        else delete pending[number];
        return { pending };
      });
    /** Задача в списке и в карточке одной функцией. */
    const mapIssue = (path: string, number: number, fn: (issue: Issue) => Issue) =>
      patch(path, (repo) => {
        const entry = repo.details[number];
        return {
          items: repo.items.map((issue) => (issue.number === number ? fn(issue) : issue)),
          ...(repo.board ? { board: { ...repo.board, items: repo.board.items.map((issue) => (issue.number === number ? fn(issue) : issue)) } } : {}),
          ...(entry?.detail ? { details: { ...repo.details, [number]: { ...entry, detail: { ...entry.detail, issue: fn(entry.detail.issue) } } } } : {}),
        };
      });
    const mapTimeline = (path: string, number: number, fn: (timeline: TimelineItem_Serialize[]) => TimelineItem_Serialize[]) =>
      patch(path, (repo) => {
        const entry = repo.details[number];
        return entry?.detail ? { details: { ...repo.details, [number]: { ...entry, detail: { ...entry.detail, timeline: fn(entry.detail.timeline) } } } } : {};
      });
    const shiftCounts = (path: string, from: 'open' | 'closed' | null, to: 'open' | 'closed' | null) =>
      patch(path, (repo) => {
        if (!repo.counts || from === to) return {};
        const counts = { ...repo.counts };
        if (from) counts[from] = Math.max(0, counts[from] - 1);
        if (to) counts[to] += 1;
        return { counts };
      });

    /** Страницы `first…last` фильтра по порядку под одним номером запроса. */
    async function fetchPages(path: string, first: number, last: number, status: ListStatus | null): Promise<void> {
      const api = getApi();
      const repo = repoOf(path);
      if (!repo) return;
      const mine = bump(listSeq, path);
      if (!api) {
        patch(path, () => ({ listStatus: 'error', listError: NO_API }));
        return;
      }
      if (status) patch(path, () => ({ listStatus: status }));
      const query = repo.query;
      const fresh: Issue[] = [];
      let lastRes: Awaited<ReturnType<IssuesApi['list']>> | null = null;
      for (let page = first; page <= last; page += 1) {
        const res = await api.list(path, { ...query, page }, opts(path));
        if (listSeq.get(path) !== mine) return; // пришёл более поздний запрос
        if (!res.ok) {
          patch(path, () => ({ listStatus: 'error', listError: res.error }));
          return;
        }
        lastRes = res;
        fresh.push(...res.data.list.items);
        if (!res.data.list.hasMore) break;
      }
      if (!lastRes || !lastRes.ok) return;
      const { list, caps, provider, label, webUrl } = lastRes.data;
      patch(path, (cur) => {
        const merged = keepPending(fresh, cur.items, cur.pending);
        const items = first === 1 ? uniqueByNumber(merged) : uniqueByNumber([...cur.items, ...merged]);
        // Перечитано меньше, чем было загружено (предел страниц): дальше есть ещё
        const cut = first === 1 && last < cur.page;
        return { items, page: list.page, hasMore: list.hasMore || cut, counts: list.counts ?? cur.counts, caps, provider, label, webUrl, listStatus: 'idle', listError: null };
      });
    }

    return {
      byRepo: {},
      mine: {},

      open: async (path, remote) => {
        const existing = repoOf(path);
        if (existing) {
          if (remote !== undefined && (remote ?? null) !== existing.remote) {
            patch(path, () => ({ remote: remote ?? null }));
            await Promise.all([get().refresh(path), get().loadMeta(path, { force: true })]);
            return;
          }
          await Promise.all([get().refresh(path, { silent: true }), get().loadMeta(path)]);
          return;
        }
        const saved = readSaved(path);
        const seenAt = saved.seenAt && typeof saved.seenAt === 'object' ? saved.seenAt : {};
        const view = saved.view === 'board' ? 'board' : 'list';
        set((s) => ({ byRepo: { ...s.byRepo, [path]: { ...emptyRepo(saved.query, seenAt, view), remote: remote ?? null } } }));
        await Promise.all([fetchPages(path, 1, 1, 'loading'), get().loadMeta(path)]);
      },

      setQuery: async (path, change) => {
        const repo = repoOf(path);
        if (!repo) return;
        patch(path, (cur) => ({ query: normalizeQuery({ ...cur.query, ...change, page: 1 }) }));
        persist(path);
        // Прежние строки остаются на экране до ответа
        await fetchPages(path, 1, 1, repo.items.length ? 'refreshing' : 'loading');
      },

      refresh: async (path, { silent = false } = {}) => {
        const repo = repoOf(path);
        if (!repo) return;
        const pages = Math.min(Math.max(repo.page, 1), MAX_REFRESH_PAGES);
        await fetchPages(path, 1, pages, silent ? null : repo.items.length ? 'refreshing' : 'loading');
      },

      loadMore: async (path) => {
        const repo = repoOf(path);
        if (!repo || !repo.hasMore || repo.listStatus !== 'idle') return;
        await fetchPages(path, repo.page + 1, repo.page + 1, 'loadingMore');
      },

      loadMeta: async (path, { force = false } = {}) => {
        const api = getApi();
        const repo = repoOf(path);
        if (!api || !repo) return;
        if (!force && repo.meta && now() - repo.metaLoadedAt < META_TTL) return;
        const mine = bump(metaSeq, path);
        const res = await api.meta(path, opts(path));
        if (metaSeq.get(path) !== mine || !res.ok) return;
        patch(path, () => ({ meta: res.data, metaLoadedAt: now() }));
      },

      select: async (path, number) => {
        const api = getApi();
        const repo = repoOf(path);
        if (!repo) return;
        if (typeof number !== 'number') {
          patch(path, () => ({ selected: number }));
          return;
        }
        const key = `${path}\n${number}`;
        const mine = bump(detailSeq, key);
        const openedAt = new Date(now()).toISOString();
        patch(path, (cur) => {
          const prev = cur.details[number];
          const details = { ...cur.details, [number]: { detail: prev?.detail ?? null, status: 'loading' as const, error: null, loadedAt: prev?.loadedAt ?? 0 } };
          // Не больше 50 карточек: уходят давно не открывавшиеся
          const keys = Object.keys(details).map(Number).sort((a, b) => details[a].loadedAt - details[b].loadedAt);
          for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DETAILS))) if (old !== number) delete details[old];
          return { selected: number, details, seenAt: { ...cur.seenAt, [number]: openedAt } };
        });
        persist(path);
        if (!api) {
          patch(path, (cur) => ({ details: { ...cur.details, [number]: { ...cur.details[number], status: 'error', error: NO_API } } }));
          return;
        }
        const res = await api.get(path, number, opts(path));
        if (detailSeq.get(key) !== mine) return;
        patch(path, (cur) => {
          const prev = cur.details[number];
          if (!res.ok) {
            const gone = res.error.code === 'NOT_FOUND';
            return {
              ...(gone ? { items: cur.items.filter((i) => i.number !== number), ...(cur.board ? { board: { ...cur.board, items: cur.board.items.filter((i) => i.number !== number) } } : {}) } : {}),
              details: { ...cur.details, [number]: { detail: gone ? null : (prev?.detail ?? null), status: 'error', error: res.error, loadedAt: prev?.loadedAt ?? 0 } },
            };
          }
          const busy = (cur.pending[number] ?? 0) > 0 && prev?.detail;
          const detail = busy ? { ...res.data, issue: prev.detail!.issue } : res.data;
          const items = busy ? cur.items : cur.items.map((issue) => (issue.number === number ? res.data.issue : issue));
          // Своё открытие не должно отмечать задачу «обновлённой» из-за разницы часов
          const seenAt = { ...cur.seenAt, [number]: later(cur.seenAt[number], res.data.issue.updatedAt) };
          return { items, seenAt, details: { ...cur.details, [number]: { detail, status: 'idle', error: null, loadedAt: now() } } };
        });
        persist(path);
      },

      create: async (path, input, { stay = false } = {}) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const res = await api.create(path, input, opts(path));
        if (!res.ok || !repoOf(path)) return res;
        const issue = res.data;
        patch(path, (cur) => ({
          items: [issue, ...cur.items.filter((i) => i.number !== issue.number)],
          ...(cur.board ? { board: { ...cur.board, items: [issue, ...cur.board.items.filter((i) => i.number !== issue.number)] } } : {}),
          selected: stay ? cur.selected : issue.number,
          details: { ...cur.details, [issue.number]: { detail: { issue, timeline: [], timelineTruncated: false }, status: 'idle', error: null, loadedAt: now() } },
          seenAt: { ...cur.seenAt, [issue.number]: issue.updatedAt },
        }));
        shiftCounts(path, null, issue.state);
        persist(path);
        clearDraft(path, 'new');
        return res;
      },

      update: async (path, number, change) => {
        const api = getApi();
        const repo = repoOf(path);
        if (!api) return { ok: false, error: NO_API };
        const before = repo?.items.find((i) => i.number === number) ?? repo?.board?.items.find((i) => i.number === number) ?? repo?.details[number]?.detail?.issue ?? null;
        const snapshot = { item: repo?.items.find((i) => i.number === number), board: repo?.board?.items.find((i) => i.number === number), detail: repo?.details[number]?.detail?.issue };
        if (repo) {
          mapIssue(path, number, (issue) => applyPatch(issue, change, repo.meta, new Date(now()).toISOString()));
          if (before && change.state && change.state !== before.state) shiftCounts(path, before.state, change.state);
          pendingDelta(path, number, 1);
        }
        const res = await api.update(path, number, change, opts(path));
        if (!repoOf(path)) return res;
        pendingDelta(path, number, -1);
        if (res.ok) {
          mapIssue(path, number, () => res.data);
          if (change.body != null) clearDraft(path, { number, field: 'body' });
        } else {
          patch(path, (cur) => {
            const entry = cur.details[number];
            const back = snapshot.item ?? snapshot.board;
            return {
              items: cur.items.map((i) => (i.number === number && snapshot.item ? snapshot.item : i)),
              ...(cur.board && back ? { board: { ...cur.board, items: cur.board.items.map((i) => (i.number === number ? back : i)) } } : {}),
              ...(entry?.detail && snapshot.detail ? { details: { ...cur.details, [number]: { ...entry, detail: { ...entry.detail, issue: snapshot.detail } } } } : {}),
            };
          });
          if (before && change.state && change.state !== before.state) shiftCounts(path, change.state, before.state);
        }
        return res;
      },

      commentAdd: async (path, number, body) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const repo = repoOf(path);
        const id = `${TEMP_PREFIX}${++tempId}`;
        if (repo) {
          const temp: TimelineItem_Serialize = { type: 'comment', id, body, bodyHtml: '', author: repo.meta?.me ?? null, createdAt: new Date(now()).toISOString(), updatedAt: null, canEdit: false, webUrl: null };
          mapTimeline(path, number, (timeline) => [...timeline, temp]);
          mapIssue(path, number, (issue) => ({ ...issue, commentsCount: issue.commentsCount + 1 }));
          pendingDelta(path, number, 1);
        }
        const res = await api.commentAdd(path, number, body, opts(path));
        if (!repoOf(path)) return res;
        pendingDelta(path, number, -1);
        if (res.ok) {
          mapTimeline(path, number, (timeline) => timeline.map((item) => (item.type === 'comment' && item.id === id ? { type: 'comment', ...res.data } : item)));
          clearDraft(path, { number, field: 'comment' });
        } else {
          mapTimeline(path, number, (timeline) => timeline.filter((item) => !(item.type === 'comment' && item.id === id)));
          mapIssue(path, number, (issue) => ({ ...issue, commentsCount: Math.max(0, issue.commentsCount - 1) }));
        }
        return res;
      },

      commentUpdate: async (path, number, id, body) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const old = repoOf(path)?.details[number]?.detail?.timeline.find((item) => item.type === 'comment' && item.id === id);
        const isTarget = (item: TimelineItem_Serialize) => item.type === 'comment' && item.id === id;
        mapTimeline(path, number, (timeline) => timeline.map((item) => (isTarget(item) ? { ...item, body, bodyHtml: '' } : item)));
        pendingDelta(path, number, 1);
        const res = await api.commentUpdate(path, number, id, body, opts(path));
        if (!repoOf(path)) return res;
        pendingDelta(path, number, -1);
        if (res.ok) mapTimeline(path, number, (timeline) => timeline.map((item) => (isTarget(item) ? { type: 'comment', ...res.data } : item)));
        else if (old) mapTimeline(path, number, (timeline) => timeline.map((item) => (isTarget(item) ? old : item)));
        return res;
      },

      commentDelete: async (path, number, id) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const timeline = repoOf(path)?.details[number]?.detail?.timeline;
        const index = timeline?.findIndex((item) => item.type === 'comment' && item.id === id) ?? -1;
        const old = index >= 0 ? timeline![index] : null;
        if (old) {
          mapTimeline(path, number, (items) => items.filter((item) => item !== old));
          mapIssue(path, number, (issue) => ({ ...issue, commentsCount: Math.max(0, issue.commentsCount - 1) }));
        }
        pendingDelta(path, number, 1);
        const res = await api.commentDelete(path, number, id, opts(path));
        if (!repoOf(path)) return res;
        pendingDelta(path, number, -1);
        if (!res.ok && old) {
          mapTimeline(path, number, (items) => [...items.slice(0, index), old, ...items.slice(index)]);
          mapIssue(path, number, (issue) => ({ ...issue, commentsCount: issue.commentsCount + 1 }));
        }
        return res;
      },

      labelCreate: async (path, name, color) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const res = await api.labelCreate(path, name, color, opts(path));
        if (res.ok) {
          patch(path, (cur) => (cur.meta ? { meta: { ...cur.meta, labels: [...cur.meta.labels.filter((l) => l.id !== res.data.id), res.data] } } : {}));
        }
        return res;
      },

      remove: async (path, number) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        const res = await api.remove(path, number, opts(path));
        const repo = repoOf(path);
        if (!res.ok || !repo) return res;
        const issue = repo.items.find((i) => i.number === number) ?? repo.details[number]?.detail?.issue;
        patch(path, (cur) => {
          const details = { ...cur.details };
          delete details[number];
          return {
            items: cur.items.filter((i) => i.number !== number),
            ...(cur.board ? { board: { ...cur.board, items: cur.board.items.filter((i) => i.number !== number) } } : {}),
            details,
            selected: cur.selected === number ? null : cur.selected,
          };
        });
        if (issue) shiftCounts(path, issue.state, null);
        return res;
      },

      fetchDetail: async (path, number) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        return api.get(path, number, opts(path));
      },

      renderMarkdown: async (path, text) => {
        const api = getApi();
        if (!api) return { ok: false, error: NO_API };
        return api.renderMarkdown(path, text, opts(path));
      },

      setView: (path, view) => {
        if (!repoOf(path) || repoOf(path)!.view === view) return;
        patch(path, () => ({ view }));
        persist(path);
      },

      loadBoard: async (path) => {
        const api = getApi();
        const repo = repoOf(path);
        if (!repo) return;
        const mine = bump(boardSeq, path);
        if (!api) {
          patch(path, (cur) => ({ board: { items: cur.board?.items ?? [], status: 'error', error: NO_API, truncated: false } }));
          return;
        }
        patch(path, (cur) => ({ board: { items: cur.board?.items ?? [], status: 'loading', error: null, truncated: cur.board?.truncated ?? false } }));
        const base = { ...repo.query, sort: 'updated' as const, ascending: false };
        const open: Issue[] = [];
        let truncated = false;
        for (let page = 1; page <= BOARD_PAGES; page += 1) {
          const res = await api.list(path, { ...base, state: 'open', page, perPage: BOARD_PAGE }, opts(path));
          if (boardSeq.get(path) !== mine) return;
          if (!res.ok) {
            patch(path, (cur) => ({ board: { items: cur.board?.items ?? [], status: 'error', error: res.error, truncated: false } }));
            return;
          }
          open.push(...res.data.list.items);
          if (!res.data.list.hasMore) break;
          if (page === BOARD_PAGES) truncated = true;
        }
        const closed = await api.list(path, { ...base, state: 'closed', page: 1, perPage: BOARD_CLOSED }, opts(path));
        if (boardSeq.get(path) !== mine) return;
        if (!closed.ok) {
          patch(path, (cur) => ({ board: { items: cur.board?.items ?? [], status: 'error', error: closed.error, truncated: false } }));
          return;
        }
        patch(path, (cur) => ({
          board: { items: keepPending(uniqueByNumber([...open, ...closed.data.list.items]), cur.board?.items ?? [], cur.pending), status: 'idle', error: null, truncated },
        }));
      },

      bulkUpdate: async (path, numbers, makePatch) => {
        const result: BulkResult = { ok: [], failed: [], stopped: false };
        const repo = repoOf(path);
        if (!repo || !numbers.length) return result;
        const run = bump(bulkSeq, path);
        const queue = [...numbers];
        patch(path, () => ({ bulk: { done: 0, total: numbers.length, running: true } }));
        const find = (n: number) => {
          const cur = repoOf(path);
          return cur?.items.find((i) => i.number === n) ?? cur?.board?.items.find((i) => i.number === n) ?? cur?.details[n]?.detail?.issue ?? null;
        };
        const worker = async () => {
          for (;;) {
            if (bulkSeq.get(path) !== run) {
              result.stopped = true;
              return;
            }
            const number = queue.shift();
            if (number === undefined) return;
            const issue = find(number);
            const change = issue ? makePatch(issue) : null;
            if (!change) result.ok.push(number);
            else {
              const res = await get().update(path, number, change);
              (res.ok ? result.ok : result.failed).push(number);
            }
            patch(path, () => ({ bulk: { done: result.ok.length + result.failed.length, total: numbers.length, running: true } }));
          }
        };
        await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, numbers.length) }, worker));
        result.stopped = result.stopped || result.ok.length + result.failed.length < numbers.length;
        patch(path, () => ({ bulk: null }));
        return result;
      },

      stopBulk: (path) => {
        bump(bulkSeq, path);
      },

      refreshMine: async (path, remote) => {
        const api = getApi();
        if (!api) return [];
        const run = bump(mineSeq, path);
        const res = await api.list(path, { ...DEFAULT_QUERY, state: 'open', assignee: '@me', page: 1, perPage: 100 }, remote ? { remote } : opts(path));
        if (mineSeq.get(path) !== run || !res.ok) return [];
        const items = res.data.list.items;
        const before = mineSeen.get(path);
        mineSeen.set(path, new Set(items.map((i) => i.number)));
        set((st) => ({ mine: { ...st.mine, [path]: items } }));
        return before ? items.filter((i) => !before.has(i.number)) : [];
      },

      forget: (path) => {
        bump(listSeq, path);
        bump(boardSeq, path);
        bump(bulkSeq, path);
        mineSeen.delete(path);
        bump(mineSeq, path);
        bump(metaSeq, path);
        for (const key of [...detailSeq.keys()]) if (key.startsWith(`${path}\n`)) bump(detailSeq, key);
        set((s) => {
          if (!s.byRepo[path] && !s.mine[path]) return s;
          const byRepo = { ...s.byRepo };
          delete byRepo[path];
          const mine = { ...s.mine };
          delete mine[path];
          return { byRepo, mine };
        });
      },
    };
  });
}

/** Хранилище окна: `window.api.issues` ставит слой совместимости (`platform/tauri.ts`); под Electron раздела нет. */
export const issuesStore = createIssuesStore(() => (window.api as { issues?: IssuesApi } | undefined)?.issues);

export function useIssuesStore<T>(selector: (state: IssuesState) => T): T {
  return useStore(issuesStore, selector);
}
