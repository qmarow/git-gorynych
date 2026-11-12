/**
 * CI/CD открытого репозитория для графа и строки состояния: бывшие `useState`/`useRef` и эффекты из `App.tsx`
 * («CI/CD: статусы пайплайнов для графа»).
 * - `startPipelines` — опрос `cicd:pipelines`: первый через 400 мс (пайплайн после push появляется не сразу), дальше 10 с,
 *   пока что-то выполняется, иначе 60 с; в скрытом окне запрос пропускается, отсчёт идёт. Ошибка оставляет прежние статусы;
 *   `NO_TOKEN` — перечитать `forge`.
 * - `finishedPipelines` — пайплайны, которые шли и закончились (для уведомления); первый ответ по репозиторию только запоминается.
 * - `loadPipelineTip` — сводка по заданиям для подсказки значка, один запрос на пару «номер, статус».
 * - `refreshForge`, `setForge`, `pollForge` — состояние провайдера в `repo.forge` (`repoStore`).
 *
 * Отличие от 1.x (решение пользователя): `onForgeChanged()` без аргумента (так его вызывает `CiSettings` после сохранения)
 * ставил `repo.forge = undefined`, и статусы пайплайнов в графе пропадали до следующей загрузки репозитория. Теперь вызов
 * без аргумента перечитывает состояние провайдера (`refreshForge`), а прежнее остаётся на экране до ответа.
 *
 * Поведение то же, что было в `App.tsx` (сверка — `tests/ui-parity/ci-store.mjs`, эталон — прежний код из git).
 * TanStack Query здесь не подходит: у опроса свои правила (задержка первого запроса, пропуск в скрытом окне без сдвига
 * отсчёта, прежние статусы при смене ключа), а его кэш, повторы и обновление при фокусе их бы изменили.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  ForgeStatus_Serialize,
  PipelineDetailWithCaps_Serialize,
  PipelineListWithCaps_Serialize,
  PipelineRun_Serialize,
} from '../../crates/gorynych-tauri/bindings/commands.ts';
import type { ApiError, ApiResult } from '../platform/tauri.ts';
import type { PipelineMark } from '../components/CommitGraph.tsx';
import { ACTIVE_STATUSES } from '../components/PipelineStatus.tsx';
import { repoStore, type RepoData } from './repoStore.ts';

/** Статусы пайплайнов для графа */
export interface PipelineMap {
  bySha: Record<string, PipelineMark>;
  pipelines: PipelineRun_Serialize[];
  error: ApiError | null;
}

export type PipelineTips = Record<string, { status: string; text: string }>;

/** Та часть `window.api`, которая нужна CI/CD графа. */
export interface CiApi {
  cicd?: {
    status: (dir: string, opts: { remote?: string | null }) => Promise<ApiResult<ForgeStatus_Serialize | null>>;
    pipelines: (dir: string, opts: { remote?: string | null }) => Promise<ApiResult<PipelineListWithCaps_Serialize>>;
    pipeline: (dir: string, id: string | number, opts: { remote?: string | null }) => Promise<ApiResult<PipelineDetailWithCaps_Serialize>>;
  };
}

/** Открытый репозиторий, как его видит CI/CD. */
export interface CiRepo {
  current: () => RepoData | null;
  patch: (fn: (repo: RepoData | null) => RepoData | null) => void;
}

/** Пайплайн закончился: `label` — имя провайдера из ответа. */
export type OnFinished = (path: string, list: PipelineRun_Serialize[], label: string) => void;

export interface CiState {
  pipelineMap: PipelineMap | null;
  pipelineTips: PipelineTips;

  /** Опрос пайплайнов для ключа (тело прежнего эффекта); `key` = null — статусов нет. */
  startPipelines: (key: string | null, remote: string | null | undefined, onFinished: OnFinished) => (() => void) | undefined;
  /** Из ответа — пайплайны, которые шли и закончились успехом, ошибкой или отменой. */
  finishedPipelines: (path: string, list: PipelineRun_Serialize[]) => PipelineRun_Serialize[];
  loadPipelineTip: (p: PipelineMark) => Promise<void>;
  /** Авторизация CI/CD привязана к репозиторию и может браться из его входа — после смены входа перечитываем. */
  refreshForge: () => Promise<void>;
  /** Бывший `onForgeChanged`: новое состояние провайдера; без аргумента (настройки CI/CD сохранены) — перечитать его. */
  setForge: (next?: ForgeStatus_Serialize | null) => void;
  /** Токен входа проверяется в фоне: 8 раз через 1,5 с перечитать `forge`; возвращает остановку. */
  pollForge: () => () => void;
}

const remoteOf = (r: RepoData) => r.localBranches?.find((b) => b.name === r.currentBranch)?.upstreamRemote;

const icon = (st: string | null, allow?: boolean | null) =>
  st === 'success' ? '✓' : st === 'failed' ? (allow ? '⚠' : '✕') : ACTIVE_STATUSES.has(st!) ? '⟳' : st === 'manual' ? '⏸' : st === 'canceled' ? '⊘' : st === 'skipped' ? '»' : '•';

export type CiStore = StoreApi<CiState>;

export function createCiStore(getApi: () => CiApi | undefined, repo: CiRepo): CiStore {
  // Статусы, которые уже видели: пайплайн, который шёл и закончился, — уведомление
  const seenStatuses = new Map<string, Map<unknown, string | null>>();
  const tipRequested = new Set<string>();

  return createStore<CiState>()((set, get) => ({
    pipelineMap: null,
    pipelineTips: {},

    startPipelines: (key, remote, onFinished) => {
      const api = getApi();
      if (!key || !api?.cicd) {
        set({ pipelineMap: null });
        return undefined;
      }
      const cicd = api.cicd;
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const path = repo.current()?.path;
      const tick = async () => {
        let active = false;
        if (document.visibilityState === 'visible') {
          const res = await cicd.pipelines(path!, { remote });
          if (!alive) return;
          if (res.ok) {
            active = res.data.pipelines.some((p) => ACTIVE_STATUSES.has(p.status!));
            onFinished(path!, res.data.pipelines, res.data.label);
            set({ pipelineMap: { bySha: res.data.bySha as Record<string, PipelineMark>, pipelines: res.data.pipelines, error: null } });
          } else {
            const m = get().pipelineMap;
            set({ pipelineMap: { bySha: m?.bySha ?? {}, pipelines: m?.pipelines ?? [], error: res.error } });
            // Вход репозитория оказался не годен для API — показать, почему, и предложить токен
            if (res.error?.code === 'NO_TOKEN') void get().refreshForge();
          }
        }
        // Пока что-то выполняется — обновляем чаще
        if (alive) timer = setTimeout(tick, active ? 10000 : 60000);
      };
      timer = setTimeout(tick, 400);
      return () => {
        alive = false;
        clearTimeout(timer!);
      };
    },

    finishedPipelines: (path, list) => {
      const first = !seenStatuses.has(path);
      if (first) seenStatuses.set(path, new Map());
      const map = seenStatuses.get(path)!;
      const done: PipelineRun_Serialize[] = [];
      for (const p of list) {
        const prev = map.get(p.id);
        map.set(p.id, p.status);
        if (first || !prev || !ACTIVE_STATUSES.has(prev) || ACTIVE_STATUSES.has(p.status!)) continue;
        if (!['success', 'failed', 'canceled'].includes(p.status!)) continue;
        done.push(p);
      }
      return done;
    },

    loadPipelineTip: async (p) => {
      const r = repo.current();
      const key = `${p.id}:${p.status}`;
      if (!r || tipRequested.has(key)) return;
      tipRequested.add(key);
      const res = await getApi()!.cicd!.pipeline(r.path, p.id, { remote: remoteOf(r) });
      if (!res.ok) return;
      const parts = res.data.stages.flatMap((s) => (s.jobs.length > 4 ? [`${s.name}: ${icon(s.status)} (${s.jobs.length})`] : s.jobs.map((j) => `${j.name}: ${icon(j.status, j.allowFailure)}`)));
      set((s) => ({ pipelineTips: { ...s.pipelineTips, [p.id]: { status: p.status, text: parts.join(', ') } } }));
    },

    refreshForge: async () => {
      const r = repo.current();
      const api = getApi();
      if (!r || !api?.cicd) return;
      const st = await api.cicd.status(r.path, { remote: remoteOf(r) });
      if (st?.ok) repo.patch((x) => (x && x.path === r.path ? { ...x, forge: st.data } : x));
    },

    setForge: (next) => {
      if (next === undefined) {
        void get().refreshForge();
        return;
      }
      repo.patch((r) => (r ? { ...r, forge: next } : r));
    },

    pollForge: () => {
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        void get().refreshForge();
        if (n >= 8) clearInterval(t);
      }, 1500);
      return () => clearInterval(t);
    },
  }));
}

/** Хранилище окна: открытый репозиторий — из `repoStore`. */
export const ciStore = createCiStore(() => window.api as CiApi | undefined, {
  current: () => repoStore.getState().repo,
  patch: (fn) => repoStore.getState().patchRepo(fn),
});

export function useCiStore<T>(selector: (state: CiState) => T): T {
  return useStore(ciStore, selector);
}
