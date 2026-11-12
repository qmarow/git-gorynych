/**
 * Состояние открытого репозитория: бывшие `useState`/`useRef` из `App.jsx` (`repo`, `loading`, `loadError`, `selectedHash`,
 * `filesByHash`, `activePath`, кэш вкладок, счётчик загрузок) и функции, которые его меняют (`loadRepo`, `showBlank`, часть
 * `showTab`, `rememberActiveTab`, слияние ответа `repo:status`).
 *
 * Поведение то же, что было в `App.jsx` (сверка — `tests/ui-parity/repo-store.mjs`, эталон — прежний код из git):
 * - побеждает последняя загрузка; устаревший ответ только кладётся в кэш вкладки;
 * - тихая загрузка не своей вкладки не меняет экран;
 * - отпечаток графа прежнего ответа для той же папки (`known`) — 2.0 отвечает `commitsUnchanged`, и коммиты берутся из
 *   того ответа, чей отпечаток отправлен: тот же массив, граф и поиск не пересчитываются;
 * - выделение сохраняется, если тот же репозиторий и выделенное ещё есть (WIP с файлами, stash, коммит), иначе WIP или HEAD;
 * - ответ `repo:status` меняет `repo`, только если поменялись файлы, операция или найденные CI.
 *
 * Отличие от прежнего кода: `repoRef`/`activeRef` в `App.jsx` раньше обновлялись при отрисовке (и вручную в `showBlank`/
 * `showTab`), теперь это само хранилище, без задержки до отрисовки.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { LoadedRepository_Serialize, StatusWithCi_Serialize } from '../../crates/gorynych-tauri/bindings/commands.ts';
import type { ApiError, ApiResult } from '../platform/tauri.ts';
import { t } from '../i18n/index.ts';

/** Ответ `repo:load`. Под Electron (1.x) отпечатка графа и `commitsUnchanged` нет. */
export type RepoData = Omit<LoadedRepository_Serialize, 'graphFingerprint' | 'commitsUnchanged'> & {
  graphFingerprint?: string | null;
  commitsUnchanged?: boolean;
};

export type RepoStatus = StatusWithCi_Serialize;

/** Файлы коммитов, уже загруженные для панели деталей: `hash → ответ`. */
export type FilesByHash = Record<string, unknown>;

export interface LoadError {
  message: string;
  code?: string;
  hint?: string | null;
  details?: string;
  data?: unknown;
}

type Updater<T> = T | ((prev: T) => T);

interface TabSnapshot {
  repo?: RepoData;
  selectedHash?: string | null;
  filesByHash?: FilesByHash;
}

/** Та часть `window.api`, которая нужна хранилищу. */
export interface RepoApi {
  repo: {
    load: (dir: string, opts?: { known: string }) => Promise<ApiResult<RepoData>>;
  };
}

export interface RepoState {
  repo: RepoData | null;
  loading: boolean;
  loadingLabel: string;
  loadError: LoadError | null;
  selectedHash: string | null;
  filesByHash: FilesByHash;
  /** Путь активной вкладки (репозиторий или «Новая вкладка»). */
  activePath: string | null;

  setSelectedHash: (next: Updater<string | null>) => void;
  setFilesByHash: (next: Updater<FilesByHash>) => void;
  setLoadError: (error: LoadError | null) => void;
  setActivePath: (path: string | null) => void;
  /** Бывший `setRepo(fn)`: правка текущего ответа (например, `forge`). */
  patchRepo: (fn: (repo: RepoData | null) => RepoData | null) => void;

  /** Бывший `loadRepo`. */
  load: (dir: string, opts?: { silent?: boolean }) => Promise<RepoData | null>;
  /** Пустая вкладка или ни одной: отменяет идущие загрузки, репозитория нет. */
  showBlank: (path: string | null) => void;
  /** Переход на вкладку репозитория: сохранённое состояние сразу, затем тихая загрузка; без кэша — обычная. */
  showCached: (path: string) => void;
  /** Бывший `rememberActiveTab`. */
  rememberActive: () => void;
  forgetTab: (path: string) => void;
  /** Ответ `repo:status` после изменения рабочих файлов. */
  applyStatus: (status: RepoStatus) => void;
  /** Вызывается, когда загрузка показала другой репозиторий (раньше там же сбрасывался `access`). */
  onSwitch: (listener: () => void) => () => void;
}

const resolve = <T>(next: Updater<T>, prev: T): T => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next);

/** Что выделить после загрузки: прежнее, если оно ещё есть в том же репозитории, иначе WIP (если есть изменения) или HEAD. */
export function nextSelection(prev: string | null, data: RepoData, samePath: boolean): string | null {
  const keep =
    samePath &&
    prev &&
    ((prev === 'WIP' && data.wipFiles.length > 0) ||
      (prev.startsWith('stash:') && data.stashes.some((st) => `stash:${st.hash}` === prev)) ||
      data.commits.some((c) => c.hash === prev));
  if (keep) return prev;
  return data.wipFiles.length > 0 ? 'WIP' : data.headHash;
}

/** `repo` с новым состоянием рабочей копии или тот же объект, если ничего не поменялось (не перерисовываем). */
export function mergeStatus(r: RepoData | null, status: RepoStatus): RepoData | null {
  if (!r || r.path !== status.path) return r;
  const ci = status.ci ?? r.ci;
  const same =
    r.operation === status.operation && JSON.stringify(r.wipFiles) === JSON.stringify(status.wipFiles) && JSON.stringify(r.ci) === JSON.stringify(ci);
  if (same) return r;
  return { ...r, wipFiles: status.wipFiles, operation: status.operation, ci };
}

export type RepoStore = StoreApi<RepoState>;

export function createRepoStore(getApi: () => RepoApi | undefined): RepoStore {
  let seq = 0;
  const tabCache = new Map<string, TabSnapshot>();
  const switchListeners = new Set<() => void>();

  return createStore<RepoState>()((set, get) => ({
    repo: null,
    loading: false,
    loadingLabel: '',
    loadError: null,
    selectedHash: null,
    filesByHash: {},
    activePath: null,

    setSelectedHash: (next) => set((s) => ({ selectedHash: resolve(next, s.selectedHash) })),
    setFilesByHash: (next) => set((s) => ({ filesByHash: resolve(next, s.filesByHash) })),
    setLoadError: (loadError) => set({ loadError }),
    setActivePath: (activePath) => set({ activePath }),
    patchRepo: (fn) => set((s) => ({ repo: fn(s.repo) })),

    load: async (dir, { silent = false } = {}) => {
      const api = getApi();
      if (!api) {
        set({ loadError: { message: t('window-api-is-unavailable-start') } });
        return null;
      }
      const mine = ++seq;
      if (!silent) set({ loading: true, loadingLabel: dir });

      const current = get().repo;
      const base = current?.path === dir ? current : tabCache.get(dir)?.repo;
      const known = base?.path === dir ? base.graphFingerprint : undefined;
      const res = await api.repo.load(dir, known ? { known } : undefined);
      const stale = mine !== seq;
      if (!stale) set({ loading: false });

      if (!res.ok) {
        if (!silent && !stale) set({ loadError: res.error as ApiError });
        return null;
      }

      const data: RepoData = res.data.commitsUnchanged && base ? { ...res.data, commits: base.commits, truncated: base.truncated } : res.data;
      tabCache.set(data.path, { ...(tabCache.get(data.path) ?? {}), repo: data });
      const { activePath } = get();
      if (stale || (activePath && activePath !== data.path && silent)) return data;

      const samePath = get().repo?.path === data.path;
      set((s) => ({
        repo: data,
        loadError: null,
        selectedHash: nextSelection(s.selectedHash, data, samePath),
        ...(samePath ? {} : { filesByHash: {} }),
      }));
      if (!samePath) switchListeners.forEach((fn) => fn());
      return data;
    },

    showBlank: (path) => {
      seq++; // отменяем ответы на ещё идущие загрузки
      set({ activePath: path, repo: null, selectedHash: null, loading: false });
    },

    showCached: (path) => {
      set({ activePath: path });
      const cached = tabCache.get(path);
      if (cached?.repo) {
        const repo = cached.repo;
        set({ repo, selectedHash: cached.selectedHash ?? (repo.wipFiles.length ? 'WIP' : repo.headHash), filesByHash: cached.filesByHash ?? {} });
        void get().load(path, { silent: true });
      } else {
        void get().load(path);
      }
    },

    rememberActive: () => {
      const { repo, selectedHash, filesByHash } = get();
      if (!repo) return;
      tabCache.set(repo.path, { repo, selectedHash, filesByHash });
    },

    forgetTab: (path) => {
      tabCache.delete(path);
    },

    applyStatus: (status) => {
      const { repo } = get();
      const next = mergeStatus(repo, status);
      if (next !== repo) set({ repo: next });
    },

    onSwitch: (listener) => {
      switchListeners.add(listener);
      return () => switchListeners.delete(listener);
    },
  }));
}

/** Хранилище окна: `window.api` ставит слой совместимости (`platform/tauri.ts`) или preload Electron до загрузки модулей. */
export const repoStore = createRepoStore(() => window.api as RepoApi | undefined);

export function useRepoStore<T>(selector: (state: RepoState) => T): T {
  return useStore(repoStore, selector);
}
