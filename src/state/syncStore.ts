/**
 * Автообновление открытого репозитория: бывшие `useState`/`useRef` и эффекты из `App.tsx` («Автообновление»).
 * - `gitBusy` — бывший `busyRef`: идёт действие пользователя, фоновые проверки и перечитывание ждут;
 * - `watchChanges` — событие `repo-changed`: через 30 мс быстрый `repo:status` или полный `repo:load` (если менялся `.git`),
 *   во время действия — повтор через 400 мс;
 * - `backgroundFetch` — fetch по кнопке и после успешной проверки, если был сбой связи;
 * - `startRemoteSync` — лёгкая проверка сервера (`repo:remote-check`) с паузой по режиму, фокусу окна и ошибкам подряд.
 *
 * Поведение то же, что было в `App.tsx` (сверка — `tests/ui-parity/sync-store.mjs`, эталон — прежний код из git).
 * Состояние строки проверки (`lib/syncStatus.ts`) по-прежнему отдельное: оно меняется каждые несколько секунд.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { LightCheck_Serialize, RepoChanged } from '../../crates/gorynych-tauri/bindings/commands.ts';
import type { ApiResult } from '../platform/tauri.ts';
import { t as tr, locale } from '../i18n/index.ts';
import { DEFAULT_SYNC_MODE, SYNC_MODES, nextDelay, resetSyncStatus, setSyncStatus } from '../lib/syncStatus.ts';
import { repoStore, type RepoStatus } from './repoStore.ts';

/** Та часть `window.api`, которая нужна автообновлению. */
export interface SyncApi {
  repo: {
    status?: (dir: string) => Promise<ApiResult<RepoStatus>>;
    remoteCheck?: (dir: string) => Promise<ApiResult<LightCheck_Serialize>>;
    onChanged?: (cb: (ev: RepoChanged) => void) => () => void;
    action: (dir: string, name: 'fetch', payload: Record<string, never>) => Promise<ApiResult<unknown>>;
  };
}

/** Открытый репозиторий, как его видит автообновление. */
export interface SyncRepo {
  path: () => string | undefined;
  remotes: () => number;
  load: (dir: string, opts: { silent: boolean }) => unknown;
  applyStatus: (status: RepoStatus) => void;
}

/** Уведомление об ошибке ручного fetch. */
export type SyncNotify = (toast: { type: 'error'; title: string; hint?: string | null }) => void;

/** Права на чтение (`access` в `App.tsx`): без подтверждённого чтения сервер в фоне не проверяется. */
export type AccessProbe = () => { status?: string; data?: { canRead?: boolean | null } | null } | null | undefined;

export interface SyncState {
  autoSync: boolean;
  syncMode: string;
  bgFetching: boolean;
  lastFetch: string | null;
  fetchError: string | null;

  /** Переключатель автообновления (настройка `autoSync`). */
  setAutoSync: (on: boolean) => void;
  /** Бывший `changeSyncMode`: настройка `syncMode`, сброс ошибок подряд, проверка сразу. */
  changeSyncMode: (mode: string) => void;
  /** Подписка на `repo-changed`; `onFsChange` — любое изменение на диске (повторная проверка staged-изменений). */
  watchChanges: (onFsChange: () => void) => (() => void) | undefined;
  backgroundFetch: (manual: boolean, notify: SyncNotify) => Promise<void>;
  /** Проверка сервера для открытого репозитория; возвращает остановку (тело прежнего эффекта). */
  startRemoteSync: (path: string | undefined, remotes: number, access: AccessProbe) => (() => void) | undefined;
}

/** Идёт действие пользователя (бывший `busyRef` в `App.tsx`). */
export const gitBusy: { current: boolean } = { current: false };

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — настройка просто не запомнится */
  }
}

const fetchTime = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

export type SyncStore = StoreApi<SyncState>;

export function createSyncStore(getApi: () => SyncApi | undefined, repo: SyncRepo, busy: { current: boolean } = gitBusy): SyncStore {
  let bgFetchingNow = false; // бывший `bgFetchingRef`: отметка без задержки до отрисовки
  let failures = 0; // ошибок связи подряд — для паузы (backoff)
  let kick: (() => void) | null = null; // «проверь сервер сейчас»
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  return createStore<SyncState>()((set, get) => ({
    autoSync: readPref('autoSync', '1') === '1',
    syncMode: (() => {
      const v = readPref('syncMode', DEFAULT_SYNC_MODE);
      return SYNC_MODES.some((m) => m.id === v) ? v : DEFAULT_SYNC_MODE;
    })(),
    bgFetching: false,
    lastFetch: null,
    fetchError: null,

    setAutoSync: (on) => {
      writePref('autoSync', on ? '1' : '0');
      set({ autoSync: on });
    },

    changeSyncMode: (mode) => {
      set({ syncMode: mode });
      writePref('syncMode', mode);
      failures = 0;
      kick?.();
    },

    watchChanges: (onFsChange) => {
      const api = getApi();
      if (!api?.repo.onChanged) return undefined;
      let pendingFull = false;
      return api.repo.onChanged((ev) => {
        if (ev.path !== repo.path()) return;
        // Изменилось что-то в .git (коммит, ветка, stash, fetch) — нужен полный перечит графа;
        // изменились только рабочие файлы — достаточно быстрого git status
        pendingFull = pendingFull || ev.git;
        clearTimeout(refreshTimer!);
        const tick = async () => {
          // Во время операции не мешаем — после неё граф и так перезагрузится
          if (busy.current) {
            refreshTimer = setTimeout(tick, 400);
            return;
          }
          if (repo.path() !== ev.path) return;
          // Любое изменение на диске — повод заново проверить staged-изменения (плашка «подозрительное место»)
          onFsChange();
          if (pendingFull || !api.repo.status) {
            pendingFull = false;
            repo.load(ev.path, { silent: true });
            return;
          }
          const res = await api.repo.status(ev.path);
          if (!res.ok || repo.path() !== res.data.path) return;
          repo.applyStatus(res.data); // ничего не поменялось — repo тот же, без перерисовки
        };
        refreshTimer = setTimeout(tick, 30);
      });
    },

    backgroundFetch: async (manual, notify) => {
      const api = getApi()!;
      const path = repo.path();
      if (!path || repo.remotes() === 0 || bgFetchingNow || busy.current) return;
      bgFetchingNow = true;
      set({ bgFetching: true });
      const res = await api.repo.action(path, 'fetch', {});
      bgFetchingNow = false;
      set({ bgFetching: false });
      if (res.ok) {
        set({ lastFetch: fetchTime(), fetchError: null });
        if (failures) {
          failures = 0;
          setSyncStatus({ error: null, failures: 0, retryAt: null, at: Date.now() });
          kick?.();
        }
        if (repo.path() === path) repo.load(path, { silent: true });
      } else {
        set({ fetchError: res.error.message });
        if (manual) notify({ type: 'error', title: `Fetch: ${res.error.message}`, hint: res.error.hint });
      }
    },

    // Каждые 5–300 с в активном окне, 90 с в фоне, пауза после ошибок. Рекурсивный setTimeout — следующий отсчёт
    // начинается после завершения проверки. Сервер не изменился — в .git ничего не пишется; изменился — fetch и перечит графа.
    startRemoteSync: (path, remotes, access) => {
      set({ lastFetch: null, fetchError: null });
      resetSyncStatus();
      failures = 0;
      const api = getApi();
      if (!get().autoSync || !path || remotes === 0 || !api?.repo.remoteCheck) return undefined;
      const remoteCheck = api.repo.remoteCheck;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let dueAt = 0;
      const focused = () => document.hasFocus() && document.visibilityState === 'visible';
      const delay = (retryAfter?: number | null) => nextDelay({ mode: get().syncMode, focused: focused(), failures, retryAfter });
      const schedule = (ms: number) => {
        clearTimeout(timer!);
        if (stopped) return;
        dueAt = Date.now() + ms;
        timer = setTimeout(tick, ms);
      };
      const tick = async () => {
        if (stopped || repo.path() !== path) return;
        // Идёт действие пользователя или ручной fetch — пропускаем тик, чтобы не столкнуться с index.lock
        if (busy.current || bgFetchingNow) return schedule(2000);
        // Доступ на чтение не подтверждён — фоновая проверка не должна вызывать окно входа
        const acc = access();
        if (!acc?.data?.canRead) return schedule(acc?.status === 'checking' ? 2000 : delay());
        bgFetchingNow = true;
        const res = await remoteCheck(path);
        bgFetchingNow = false;
        if (stopped) return;
        const data: Omit<Partial<LightCheck_Serialize>, 'error'> & { status: string; error?: { message?: string; code?: string } | null } = res.ok
          ? res.data
          : { status: 'error', error: res.error };
        if (data.status === 'skipped') return schedule(2000);
        if (data.status === 'error') {
          // Без всплывающих ошибок: увеличиваем паузу 15 → 30 → 60 с → 5 мин до первого успеха
          failures += 1;
          const ms = delay(data.retryAfter);
          setSyncStatus({ error: data.error?.message ?? tr('no-connection-to-server'), code: data.error?.code ?? null, failures, retryAt: Date.now() + ms, focused: focused() });
          return schedule(ms);
        }
        failures = 0;
        setSyncStatus({ at: Date.now(), via: data.via, ms: data.ms, error: null, code: null, failures: 0, retryAt: null, focused: focused() });
        if (data.fetched) {
          set({ lastFetch: fetchTime(), fetchError: null });
          if (repo.path() === path && !busy.current) repo.load(path, { silent: true });
        }
        schedule(delay());
      };
      // Вернулись в окно после долгой паузы — проверяем сразу, не дожидаясь фонового интервала
      const onFocus = () => {
        setSyncStatus({ focused: focused() });
        if (!stopped && focused() && failures === 0 && dueAt - Date.now() > delay()) schedule(400);
      };
      kick = () => schedule(300);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onFocus);
      document.addEventListener('visibilitychange', onFocus);
      schedule(2500);
      return () => {
        stopped = true;
        clearTimeout(timer!);
        kick = null;
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onFocus);
        document.removeEventListener('visibilitychange', onFocus);
      };
    },
  }));
}

/** Хранилище окна: открытый репозиторий — из `repoStore`. */
export const syncStore = createSyncStore(() => window.api as SyncApi | undefined, {
  path: () => repoStore.getState().repo?.path,
  remotes: () => repoStore.getState().repo?.remotes.length ?? 0,
  load: (dir, opts) => repoStore.getState().load(dir, opts),
  applyStatus: (status) => repoStore.getState().applyStatus(status),
});

export function useSyncStore<T>(selector: (state: SyncState) => T): T {
  return useStore(syncStore, selector);
}
