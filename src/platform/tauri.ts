/**
 * Слой совместимости: `window.api` из `electron/preload.cjs` поверх команд Tauri (`crates/gorynych-tauri/bindings/commands.ts`).
 * Интерфейс 1.x работает на 2.0 без переделки, а модули переводятся на прямые вызовы команд постепенно (Фаза 4).
 *
 * Соглашения 1.x, которые здесь воспроизводятся:
 * - каналы, обёрнутые в `safe` в `main.cjs`, отвечают `{ ok: true, data }` или `{ ok: false, error: { code, message, hint, details } }`.
 *   Команды 2.0 вместо этого отклоняют promise — здесь это снова превращается в `{ ok: false, error }`. Форму аргументов в 2.0
 *   проверяет Tauri и отвечает строкой: она становится ошибкой `BAD_ARGS`;
 * - прочие каналы (окно, вкладки, недавние, язык, оформление, диалоги, `watch`, `getLast`) отвечают значением как есть, а сбой — тем
 *   значением, которое 1.x вернул бы без ошибки (`false`, `null`, `[]`);
 * - подписки `on…` возвращают функцию отписки сразу, хотя Tauri подписывается асинхронно.
 *
 * Отличия от 1.x, которые слой сглаживает:
 * - `repo.action(dir, name, payload)` → одна команда с `{ name, payload }`;
 * - `appearance.pickImage()` → снова `{ ok, canceled, name, error }`; `appearance.image()` теперь адрес протокола, а не `data:`-URL —
 *   интерфейс подставляет его в `url(...)` так же;
 * - `localStorage` нового WebView пуст: при первом запуске он заполняется перенесёнными из 1.x настройками, а каждое изменение
 *   пачкой уходит в SQLite (`prefs_write`), чтобы настройки не зависели от профиля WebView.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type Json = unknown;
type Args = Record<string, Json>;

export interface ApiError {
  code: string;
  message: string;
  hint: string | null;
  details: string;
  data?: Json;
}

export type ApiResult<T = Json> = { ok: true; data: T } | { ok: false; error: ApiError };

declare global {
  interface Window {
    api?: Record<string, unknown>;
    __TAURI_INTERNALS__?: unknown;
    /** Отладочная проверка окна (`tests/app_smoke.rs`): интерфейс не запускается, работает сценарий проверки. */
    __GORYNYCH_SMOKE__?: boolean;
    /** Отладочный зонд окна: интерфейс запускается, а готовность сообщает зонд. */
    __GORYNYCH_PROBE__?: (report: unknown) => void;
  }
}

/** Ошибка команды в форме `GitError.toJSON()` из 1.x. */
function toApiError(error: unknown): ApiError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const e = error as Partial<ApiError>;
    return { code: String(e.code), message: String(e.message), hint: e.hint ?? null, details: e.details ?? '', ...(e.data !== undefined ? { data: e.data } : {}) };
  }
  // Tauri отвечает строкой, если аргументы не той формы
  if (typeof error === 'string') return { code: 'BAD_ARGS', message: error, hint: null, details: '' };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error), hint: null, details: '' };
}

/** Канал с `safe` в 1.x. */
async function safe<T = Json>(command: string, args?: Args): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await invoke<T>(command, args) };
  } catch (error) {
    return { ok: false, error: toApiError(error) };
  }
}

/** Канал без `safe`: значение как есть, при сбое — `fallback`. */
async function raw<T>(command: string, args: Args | undefined, fallback: T): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(command, error);
    return fallback;
  }
}

/** `ipcRenderer.send`: ответ не нужен. */
function send(command: string, args?: Args): void {
  invoke(command, args).catch((error) => console.error(command, error));
}

/** Подписка с синхронной отпиской, как `subscribe` в `preload.cjs`. */
function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let stopped = false;
  listen<T>(event, (e) => callback(e.payload)).then(
    (fn) => (stopped ? fn() : (unlisten = fn)),
    (error) => console.error(event, error),
  );
  return () => {
    stopped = true;
    unlisten?.();
  };
}

/** `process.platform` по данным браузера: в 2.0 его не передаёт preload. */
function detectPlatform(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = (nav.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('mac')) return 'darwin';
  if (p.includes('win')) return 'win32';
  if (p.includes('linux')) return 'linux';
  return 'other';
}

/* ---------- localStorage ⇄ SQLite ---------- */

const SEEDED = '__gorynych.seeded';
const FLUSH_DELAY = 400;

/**
 * При первом запуске заполняет `localStorage` настройками из базы (перенесёнными из 1.x), затем зеркалирует изменения в базу.
 * Записи копятся и уходят одной командой: интерфейс пишет, например, ширину колонок при каждом движении мыши.
 */
async function syncLocalStorage(): Promise<void> {
  const storage = window.localStorage;
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  const clear = Storage.prototype.clear;
  if (!storage.getItem(SEEDED)) {
    try {
      const snapshot = await invoke<Record<string, string>>('prefs_snapshot');
      for (const [key, value] of Object.entries(snapshot)) {
        if (storage.getItem(key) === null) setItem.call(storage, key, value);
      }
      setItem.call(storage, SEEDED, '1');
    } catch (error) {
      // Хранилище не открылось: интерфейс покажет ошибку запуска, повторим в следующий раз
      console.error('prefs_snapshot', error);
    }
  }

  const pending = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending.size) return;
    const changes = [...pending].map(([key, value]) => ({ key, value }));
    pending.clear();
    invoke('prefs_write', { changes }).catch((error) => console.error('prefs_write', error));
  };
  const queue = (key: string, value: string | null) => {
    if (key === SEEDED) return;
    pending.set(key, value);
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY);
  };
  Storage.prototype.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    if (this === storage) queue(String(key), String(value));
  };
  Storage.prototype.removeItem = function (key: string) {
    removeItem.call(this, key);
    if (this === storage) queue(String(key), null);
  };
  Storage.prototype.clear = function () {
    if (this === storage) for (let i = 0; i < storage.length; i += 1) queue(storage.key(i) ?? '', null);
    clear.call(this);
  };
  // Окно закрывается — не ждём таймера
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

/* ---------- window.api ---------- */

type Opts = Json;
const unsupported = (what: string): Promise<ApiResult> =>
  Promise.resolve({ ok: false, error: { code: 'UNSUPPORTED', message: `${what}: в 2.0 нет — авторизация репозитория одна`, hint: null, details: '' } });

function buildApi() {
  return {
    platform: detectPlatform(),
    window: {
      minimize: () => send('window_minimize'),
      toggleMaximize: () => send('window_toggle_maximize'),
      close: () => send('window_close'),
      isMaximized: () => raw<boolean>('window_is_maximized', undefined, false),
      onMaximizedChange: (cb: (maximized: boolean) => void) => subscribe<boolean>('window-maximized-changed', cb),
      onFocus: (cb: () => void) => subscribe<null>('window-focused', () => cb()),
    },
    menu: {
      set: (model: Json) => send('menu_set', { model: model ?? null }),
      onInvoke: (cb: (value: Json) => void) => subscribe('menu-invoke', cb),
    },
    tabs: {
      get: () => raw('tabs_get', undefined, { tabs: [], active: null }),
      save: async (tabs: Json, active: Json) => (await safe('tabs_save', { tabs, active: typeof active === 'string' ? active : null })).ok,
    },
    recent: {
      list: () => raw('recent_list', undefined, []),
      remove: async (dir: Json) => typeof dir === 'string' && (await safe('recent_remove', { dir })).ok,
    },
    openExternal: (url: Json) => raw('shell_open_external', { url: String(url) }, false),
    app: {
      setLanguage: (language: Json) => raw('app_set_language', { language: String(language) }, undefined),
      getLanguage: () => raw('app_get_language', undefined, 'ru'),
    },
    creds: {
      describe: (dir: Json, url: Json) => safe('creds_describe', { dir, url }),
      save: (dir: Json, url: Json, data: Json) => safe('creds_save', { dir, url, data }),
      clear: (dir: Json, url: Json) => safe('creds_clear', { dir, url }),
      detectServer: (input: Json) => safe('creds_detect_server', { input }),
      checkUrl: (url: Json) => safe('creds_check_url', { url }),
      servers: () => safe('creds_servers'),
      forgetLogin: (key: Json) => safe('creds_forget_login', { key }),
      forgetServer: (hostname: Json) => safe('creds_forget_server', { hostname }),
      setKind: (hostname: Json, kind: Json) => safe('creds_set_kind', { hostname, kind }),
      sshKeys: () => safe('creds_ssh_keys'),
      pickKey: () => raw('creds_pick_key', undefined, null),
      generateKey: (options: Json) => safe('creds_generate_key', { options }),
      keyDefaults: (dir: Json, url: Json, type: Json) => safe('creds_key_defaults', { dir, url, keyType: type }),
      switchToSsh: (dir: Json) => safe('creds_switch_to_ssh', { dir }),
      copyPublicKey: (keyPath: Json) => safe('creds_copy_public_key', { keyPath }),
    },
    openFolder: (dir: Json) => safe('shell_open_folder', { dir }),
    openTerminal: (dir: Json) => safe('shell_open_terminal', { dir }),
    appearance: {
      get: () => raw('appearance_get', undefined, { appearance: null, supportsMaterial: false, hasImage: false }),
      set: async (value: Json) => (value && typeof value === 'object' ? raw('appearance_set', { value }, false) : false),
      pickImage: async () => {
        const res = await safe<{ canceled: boolean; name: string | null }>('appearance_pick_image');
        if (!res.ok) return { ok: false, error: { message: res.error.message } };
        return res.data.canceled ? { ok: false, canceled: true } : { ok: true, name: res.data.name };
      },
      image: () => raw('appearance_image', undefined, null),
    },
    cicd: {
      status: (dir: Json, opts: Opts) => safe('cicd_status', { dir, opts }),
      info: (dir: Json, opts: Opts) => safe('cicd_info', { dir, opts }),
      settings: (dir: Json, opts: Opts) => safe('cicd_settings', { dir, opts }),
      saveSettings: (dir: Json, data: Json, opts: Opts) => safe('cicd_settings_save', { dir, data, opts }),
      pipelines: (dir: Json, opts: Opts) => safe('cicd_pipelines', { dir, opts }),
      pipeline: (dir: Json, id: Json, opts: Opts) => safe('cicd_pipeline', { dir, id, opts }),
      jobLog: (dir: Json, id: Json, opts: Opts) => safe('cicd_job_log', { dir, id, opts }),
      action: (dir: Json, action: Json, opts: Opts) => safe('cicd_action', { dir, action, opts }),
      run: (dir: Json, params: Json, opts: Opts) => safe('cicd_run', { dir, params, opts }),
      runForm: (dir: Json, opts: Opts) => safe('cicd_run_form', { dir, opts }),
      runners: (dir: Json, opts: Opts) => safe('cicd_runners', { dir, opts }),
      updateRunner: (dir: Json, data: Json, opts: Opts) => safe('cicd_runner_update', { dir, data, opts }),
      deleteRunner: (dir: Json, data: Json, opts: Opts) => safe('cicd_runner_delete', { dir, data, opts }),
      pruneRunners: (dir: Json, data: Json, opts: Opts) => safe('cicd_runners_prune', { dir, data, opts }),
      registerRunner: (dir: Json, data: Json, opts: Opts) => safe('cicd_runner_register', { dir, data, opts }),
      runnerTags: (dir: Json, data: Json, opts: Opts) => safe('cicd_runner_tags', { dir, data, opts }),
      localRunners: (dir: Json, opts: Opts) => safe('cicd_local_runners', { dir, opts }),
      startLocalRunner: (dir: Json, data: Json, opts: Opts) => safe('cicd_local_runner_start', { dir, data, opts }),
      stopLocalRunner: (name: Json) => safe('cicd_local_runner_stop', { name }),
      resumeLocalRunner: (name: Json) => safe('cicd_local_runner_resume', { name }),
      secrets: (dir: Json, opts: Opts) => safe('cicd_secrets', { dir, opts }),
      saveSecret: (dir: Json, data: Json, opts: Opts) => safe('cicd_secret_save', { dir, data, opts }),
      deleteSecret: (dir: Json, data: Json, opts: Opts) => safe('cicd_secret_delete', { dir, data, opts }),
      downloadArtifact: (dir: Json, artifact: Json, opts: Opts) => safe('cicd_artifact_download', { dir, artifact, opts }),
      showFile: (file: Json) => safe('cicd_show_file', { file: String(file) }),
    },
    gitlab: {
      status: (dir: Json, opts: Opts) => safe('gitlab_status', { dir, opts }),
      setToken: () => unsupported('gitlab:set-token'),
      clearToken: () => unsupported('gitlab:clear-token'),
      pipelines: (dir: Json, opts: Opts) => safe('gitlab_pipelines', { dir, opts }),
      pipeline: (dir: Json, id: Json, opts: Opts) => safe('gitlab_pipeline', { dir, id, opts }),
      jobLog: (dir: Json, id: Json, opts: Opts) => safe('gitlab_job_log', { dir, id, opts }),
      action: (dir: Json, action: Json, opts: Opts) => safe('gitlab_action', { dir, action, opts }),
      variables: (dir: Json, opts: Opts) => safe('gitlab_variables', { dir, opts }),
      variableValue: (dir: Json, variable: Json, opts: Opts) => safe('gitlab_variable_value', { dir, variable, opts }),
      runners: (dir: Json, opts: Opts) => safe('gitlab_runners', { dir, opts }),
      lint: (dir: Json, draft: Json, opts: Opts) => safe('gitlab_lint', { dir, draft, opts }),
      saveVariable: (dir: Json, data: Json, opts: Opts) => safe('gitlab_variable_save', { dir, data, opts }),
      deleteVariable: (dir: Json, variable: Json, opts: Opts) => safe('gitlab_variable_delete', { dir, variable, opts }),
      schedules: (dir: Json, opts: Opts) => safe('gitlab_schedules', { dir, opts }),
      saveSchedule: (dir: Json, schedule: Json, opts: Opts) => safe('gitlab_schedule_save', { dir, schedule, opts }),
      scheduleAction: (dir: Json, action: Json, opts: Opts) => safe('gitlab_schedule_action', { dir, action, opts }),
      createMergeRequest: (dir: Json, mr: Json, opts: Opts) => safe('gitlab_create_mr', { dir, mr, opts }),
    },
    repo: {
      openDialog: (title: Json) => raw('repo_open_dialog', { title: typeof title === 'string' ? title : null }, null),
      inspect: (dir: Json) => safe('repo_inspect', { dir }),
      init: (dir: Json, options: Json) => safe('repo_init', { dir, options }),
      probeRemote: (dir: Json, options: Json) => safe('repo_probe_remote', { dir, options }),
      connect: (dir: Json, options: Json) => safe('repo_connect', { dir, options }),
      status: (dir: Json) => safe('repo_status', { dir }),
      openPath: (dir: Json, rel: Json) => safe('repo_open_path', { dir, rel }),
      ci: (dir: Json, file: Json) => safe('repo_ci', { dir, file: typeof file === 'string' ? file : null }),
      ciPreview: (dir: Json, file: Json, drafts: Json) => safe('repo_ci_preview', { dir, file: typeof file === 'string' ? file : null, drafts }),
      ciDiff: (dir: Json, draft: Json) => safe('repo_ci_diff', { dir, draft: draft ?? {} }),
      ciSave: (dir: Json, draft: Json) => safe('repo_ci_save', { dir, draft: draft ?? {} }),
      ciCreate: (dir: Json, opts: Json) => safe('repo_ci_create', { dir, opts: opts ?? {} }),
      ciEdit: (content: Json, op: Json) => safe('repo_ci_edit', { content, op }),
      stashDetails: (dir: Json, hash: Json) => safe('repo_stash_details', { dir, hash }),
      cloneProbe: (url: Json) => safe('repo_clone_probe', { url }),
      clone: (options: Json) => safe('repo_clone', { options }),
      cloneCancel: (id: Json) => raw('repo_clone_cancel', { id: String(id) }, false),
      onCloneProgress: (cb: (value: Json) => void) => subscribe('clone-progress-event', cb),
      watch: (dir: Json, opts: Json) => raw('repo_watch', { dir: typeof dir === 'string' ? dir : null, opts: opts ?? null }, false),
      onIndexSynced: (cb: (value: Json) => void) => subscribe('repo-index-synced', cb),
      onChanged: (cb: (value: Json) => void) => subscribe('repo-changed', cb),
      getLast: () => raw('repo_get_last', undefined, null),
      load: (dir: Json) => safe('repo_load', { dir }),
      commitFiles: (dir: Json, hash: Json, parent: Json) => safe('repo_commit_files', { dir, hash, parent: parent ?? null }),
      fileDiff: (dir: Json, params: Json) => safe('repo_file_diff', { dir, params }),
      compare: (dir: Json, params: Json) => safe('repo_compare', { dir, params }),
      compareSearch: (dir: Json, params: Json) => safe('repo_compare_search', { dir, params }),
      searchHistory: (dir: Json, params: Json) => safe('repo_search_history', { dir, params }),
      gitflowConfig: (dir: Json) => safe('repo_gitflow_config', { dir }),
      fileHistory: (dir: Json, params: Json) => safe('repo_file_history', { dir, params }),
      blame: (dir: Json, params: Json) => safe('repo_blame', { dir, params }),
      commitInfo: (dir: Json, params: Json) => safe('repo_commit_info', { dir, params }),
      rebasePreview: (dir: Json, params: Json) => safe('repo_rebase_preview', { dir, params }),
      guardScan: (dir: Json, params: Json) => safe('repo_guard_scan', { dir, params }),
      remoteCheck: (dir: Json) => safe('repo_remote_check', { dir }),
      branchLog: (dir: Json, params: Json) => safe('repo_branch_log', { dir, params }),
      commitTemplate: (dir: Json) => safe('repo_commit_template', { dir }),
      action: (dir: Json, name: Json, payload: Json) => safe('repo_action', { dir, action: { name, payload: payload ?? {} } }),
    },
  };
}

export const isTauri = (): boolean => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

/** Ставит `window.api`, если приложение запущено под Tauri; под Electron его уже поставил preload. */
export async function installTauriApi(): Promise<void> {
  if (!isTauri() || window.api) return;
  await syncLocalStorage();
  window.api = buildApi();
}

/** Первая отрисовка готова: окно показывается только теперь (как `ready-to-show`). */
export function notifyReady(report: Json = null): void {
  if (!isTauri()) return;
  // Отладочный зонд окна (`tests/ui-probe.js`) сам решает, когда интерфейс готов
  if (window.__GORYNYCH_PROBE__) {
    window.__GORYNYCH_PROBE__(report);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => send('frontend_ready', { report: report == null ? null : JSON.stringify(report) })));
}
