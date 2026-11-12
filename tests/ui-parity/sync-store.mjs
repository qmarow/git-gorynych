// Сверка src/state/syncStore.ts с прежним кодом App.tsx (до 2026-11-12: «Автообновление» — `onChanged`, `backgroundFetch`,
// проверка сервера, `changeSyncMode`, переключатель `autoSync`). Прежний код перенесён сюда дословно поверх подставных
// useState/useRef (сеттеры меняют состояние сразу, ref-ы — тоже: в окне React отрисовывает между событиями), эффект проверки
// сервера перезапускается при смене репозитория, числа remote и `autoSync`, как в окне.
// Часы, таймеры, фокус окна и ответы api — подставные; ответы приходят в случайном порядке. Каждый сценарий прогоняется
// дважды (прежний код и хранилище) с одним зерном, следы (вызовы api, загрузки, строка состояния, настройки, уведомления,
// состояние после каждого шага) обязаны совпасть.
// node tests/ui-parity/sync-store.mjs <корень репозитория> [сценариев]
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setup, random } from './hooks.mjs';

const [repoRoot, countArg] = process.argv.slice(2);
setup(repoRoot);
const SCENARIOS = Number(countArg ?? 400);

/* ---------- Окружение: часы, таймеры, окно, настройки ---------- */

const env = {
  now: 1_000_000,
  timers: [],
  nextId: 1,
  focused: true,
  visible: true,
  listeners: [],
  prefs: new Map(),
  trace: [],
};
const log = (...e) => env.trace.push(JSON.stringify(e));

const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (a.length) super(...a);
    else super(env.now);
  }
  static now() {
    return env.now;
  }
};
globalThis.setTimeout = (fn, ms) => {
  const id = env.nextId++;
  env.timers.push({ id, at: env.now + ms, fn });
  return id;
};
globalThis.clearTimeout = (id) => {
  env.timers = env.timers.filter((t) => t.id !== id);
};
const target = (name) => ({
  addEventListener: (type, fn) => env.listeners.push({ name, type, fn }),
  removeEventListener: (type, fn) => {
    env.listeners = env.listeners.filter((l) => !(l.name === name && l.type === type && l.fn === fn));
  },
});
globalThis.window = target('window');
globalThis.document = Object.assign(target('document'), {
  documentElement: {},
  hasFocus: () => env.focused,
  get visibilityState() {
    return env.visible ? 'visible' : 'hidden';
  },
});
globalThis.localStorage = {
  getItem: (k) => (k === 'language' ? 'ru' : (env.prefs.get(k) ?? null)),
  setItem: (k, v) => {
    env.prefs.set(k, String(v));
    log('pref', k, String(v));
  },
};

// Строка состояния: хранилище импортирует `lib/syncStatus.ts`, его запись идёт в след
const realSync = pathToFileURL(path.join(repoRoot, 'src', 'lib', 'syncStatus.ts')).href;
const tracerUrl = 'data:text/javascript,' + encodeURIComponent(`
  export * from ${JSON.stringify(realSync + '?real')};
  export const setSyncStatus = (p) => globalThis.__syncLog('status', p);
  export const resetSyncStatus = () => globalThis.__syncLog('reset');
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../lib/syncStatus.ts' && context.parentURL?.includes('syncStore.ts')) return { url: tracerUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.__syncLog = (...e) => log(...e);

const lib = await import(realSync + '?real');
const i18n = await import(pathToFileURL(path.join(repoRoot, 'src', 'i18n', 'index.ts')).href);
const { createSyncStore } = await import(pathToFileURL(path.join(repoRoot, 'src', 'state', 'syncStore.ts')).href);

/* ---------- Подставной api: каждый вызов ждёт, пока сценарий его отпустит ---------- */

function makeApi(flags) {
  const pending = [];
  const subs = new Set();
  const call = (kind, dir) => {
    log('api', kind, dir, env.now);
    return new Promise((done) => pending.push({ kind, dir, done }));
  };
  const api = {
    repo: {
      action: (dir, name, payload) => call(`action:${name}:${JSON.stringify(payload)}`, dir),
      onChanged: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    },
  };
  if (flags.status) api.repo.status = (dir) => call('status', dir);
  if (flags.remoteCheck) api.repo.remoteCheck = (dir) => call('remoteCheck', dir);
  return { api, pending, subs };
}

/* ---------- Эталон: прежний код App.tsx ---------- */

function legacyApp({ api, repoRef, loadRepo, notify, setFsTick, setSyncStatus, resetSyncStatus }) {
  const { DEFAULT_SYNC_MODE, SYNC_MODES, nextDelay } = lib;
  const tr = i18n.t;
  const locale = i18n.locale;
  const readPref = (key, fallback) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writePref = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* */
    }
  };
  const st = {};
  const useState = (key, init) => {
    st[key] = typeof init === 'function' ? init() : init;
    return [st[key], (v) => (st[key] = typeof v === 'function' ? v(st[key]) : v)];
  };
  const useRef = (v) => ({ current: v });
  const useCallback = (fn) => fn;
  const busyRef = useRef(false);
  const accessRef = useRef(null);
  const loadRepoFn = loadRepo;

  // --- дословно ---
  const [, setAutoSync] = useState('autoSync', () => readPref('autoSync', '1') === '1');
  const [, setBgFetching] = useState('bgFetching', false);
  const [, setLastFetch] = useState('lastFetch', null);
  const [, setFetchError] = useState('fetchError', null);
  const bgFetchingRef = useRef(false);
  const syncKick = useRef(null); // «проверь сервер сейчас»
  const syncFailures = useRef(0); // ошибок подряд — для паузы (backoff)
  const refreshTimer = useRef(null);

  const watchEffect = () => {
    if (!api?.repo.onChanged) return undefined;
    let pendingFull = false;
    return api.repo.onChanged((ev) => {
      if (ev.path !== repoRef.current?.path) return;
      pendingFull = pendingFull || ev.git;
      clearTimeout(refreshTimer.current);
      const tick = async () => {
        if (busyRef.current) {
          refreshTimer.current = setTimeout(tick, 400);
          return;
        }
        if (repoRef.current?.path !== ev.path) return;
        setFsTick((n) => n + 1);
        if (pendingFull || !api.repo.status) {
          pendingFull = false;
          loadRepoFn(ev.path, { silent: true });
          return;
        }
        const res = await api.repo.status(ev.path);
        if (!res.ok || repoRef.current?.path !== res.data.path) return;
        repoRef.applyStatus(res.data);
      };
      refreshTimer.current = setTimeout(tick, 30);
    });
  };

  const backgroundFetch = useCallback(async (manual = false) => {
    const current = repoRef.current;
    if (!current || current.remotes.length === 0 || bgFetchingRef.current || busyRef.current) return;
    bgFetchingRef.current = true;
    setBgFetching(true);
    const res = await api.repo.action(current.path, 'fetch', {});
    bgFetchingRef.current = false;
    setBgFetching(false);
    if (res.ok) {
      setLastFetch(new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }));
      setFetchError(null);
      if (syncFailures.current) {
        syncFailures.current = 0;
        setSyncStatus({ error: null, failures: 0, retryAt: null, at: Date.now() });
        syncKick.current?.();
      }
      if (repoRef.current?.path === current.path) loadRepoFn(current.path, { silent: true });
    } else {
      setFetchError(res.error.message);
      if (manual) notify({ type: 'error', title: `Fetch: ${res.error.message}`, hint: res.error.hint });
    }
  });

  const [, setSyncMode] = useState('syncMode', () => {
    const v = readPref('syncMode', DEFAULT_SYNC_MODE);
    return SYNC_MODES.some((m) => m.id === v) ? v : DEFAULT_SYNC_MODE;
  });
  const syncModeRef = { get current() { return st.syncMode; } };

  const remoteEffect = (repo) => {
    const autoSync = st.autoSync;
    setLastFetch(null);
    setFetchError(null);
    resetSyncStatus();
    syncFailures.current = 0;
    const path = repo?.path;
    if (!autoSync || !path || repo.remotes.length === 0 || !api?.repo.remoteCheck) return undefined;
    let stopped = false;
    let timer = null;
    let dueAt = 0;
    const focused = () => document.hasFocus() && document.visibilityState === 'visible';
    const delay = (retryAfter) => nextDelay({ mode: syncModeRef.current, focused: focused(), failures: syncFailures.current, retryAfter });
    const schedule = (ms) => {
      clearTimeout(timer);
      if (stopped) return;
      dueAt = Date.now() + ms;
      timer = setTimeout(tick, ms);
    };
    const tick = async () => {
      if (stopped || repoRef.current?.path !== path) return;
      if (busyRef.current || bgFetchingRef.current) return schedule(2000);
      if (!accessRef.current?.data?.canRead) return schedule(accessRef.current?.status === 'checking' ? 2000 : delay());
      bgFetchingRef.current = true;
      const res = await api.repo.remoteCheck(path);
      bgFetchingRef.current = false;
      if (stopped) return;
      const data = res.ok ? res.data : { status: 'error', error: res.error };
      if (data.status === 'skipped') return schedule(2000);
      if (data.status === 'error') {
        syncFailures.current += 1;
        const ms = delay(data.retryAfter);
        setSyncStatus({ error: data.error?.message ?? tr('Нет связи с сервером'), code: data.error?.code ?? null, failures: syncFailures.current, retryAt: Date.now() + ms, focused: focused() });
        return schedule(ms);
      }
      syncFailures.current = 0;
      setSyncStatus({ at: Date.now(), via: data.via, ms: data.ms, error: null, code: null, failures: 0, retryAt: null, focused: focused() });
      if (data.fetched) {
        setLastFetch(new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }));
        setFetchError(null);
        if (repoRef.current?.path === path && !busyRef.current) loadRepoFn(path, { silent: true });
      }
      schedule(delay());
    };
    const onFocus = () => {
      setSyncStatus({ focused: focused() });
      if (!stopped && focused() && syncFailures.current === 0 && dueAt - Date.now() > delay()) schedule(400);
    };
    syncKick.current = () => schedule(300);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    schedule(2500);
    return () => {
      stopped = true;
      clearTimeout(timer);
      syncKick.current = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  };

  const changeSyncMode = (mode) => {
    setSyncMode(mode);
    writePref('syncMode', mode);
    syncFailures.current = 0;
    syncKick.current?.();
  };
  // --- конец дословного ---

  return {
    state: () => ({ autoSync: st.autoSync, syncMode: st.syncMode, bgFetching: st.bgFetching, lastFetch: st.lastFetch, fetchError: st.fetchError }),
    setBusy: (v) => (busyRef.current = v),
    setAccess: (a) => (accessRef.current = a),
    watch: watchEffect,
    remote: remoteEffect,
    fetch: (manual) => backgroundFetch(manual),
    mode: changeSyncMode,
    // строка состояния: `setAutoSync((v) => { writePref(…); return !v; })`; настройки: `setAutoSync(v); writePref(…)`
    toggle: () =>
      setAutoSync((v) => {
        writePref('autoSync', v ? '0' : '1');
        return !v;
      }),
    setAuto: (v) => {
      setAutoSync(v);
      writePref('autoSync', v ? '1' : '0');
    },
  };
}

/* ---------- Новое: хранилище ---------- */

function storeApp({ api, repoRef, loadRepo, notify, setFsTick }) {
  const busy = { current: false };
  let access = null;
  const store = createSyncStore(() => api, {
    path: () => repoRef.current?.path,
    remotes: () => repoRef.current?.remotes.length ?? 0,
    load: loadRepo,
    applyStatus: (s) => repoRef.applyStatus(s),
  }, busy);
  const g = () => store.getState();
  return {
    state: () => {
      const s = g();
      return { autoSync: s.autoSync, syncMode: s.syncMode, bgFetching: s.bgFetching, lastFetch: s.lastFetch, fetchError: s.fetchError };
    },
    setBusy: (v) => (busy.current = v),
    setAccess: (a) => (access = a),
    watch: () => g().watchChanges(() => setFsTick((n) => n + 1)),
    remote: (repo) => g().startRemoteSync(repo?.path, repo?.remotes.length ?? 0, () => access),
    fetch: (manual) => g().backgroundFetch(manual, notify),
    mode: (m) => g().changeSyncMode(m),
    toggle: () => g().setAutoSync(!g().autoSync),
    setAuto: (v) => g().setAutoSync(v),
  };
}

/* ---------- Сценарий ---------- */

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};

async function runScenario(seed, make) {
  env.now = 1_000_000;
  env.timers = [];
  env.nextId = 1;
  env.focused = true;
  env.visible = true;
  env.listeners = [];
  env.prefs = new Map();
  env.trace = [];
  const rnd = random(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const choose = (list) => list[pick(list.length)];

  if (pick(3) === 0) env.prefs.set('autoSync', choose(['0', '1', 'x']));
  if (pick(2) === 0) env.prefs.set('syncMode', choose(['realtime', 'fast', 'standard', 'rare', 'old']));
  const flags = { status: pick(5) !== 0, remoteCheck: pick(6) !== 0 };
  const { api, pending, subs } = makeApi(flags);

  const repoRef = {
    current: pick(4) ? { path: 'C:/a', remotes: Array.from({ length: 1 + pick(2) }) } : null,
    applyStatus: (s) => log('applyStatus', s.path, s.wipFiles.length),
  };
  const loadRepo = (dir, opts) => log('load', dir, opts?.silent ?? false, env.now);
  const notify = (toast) => log('notify', toast);
  let fsTick = 0;
  const setFsTick = (fn) => {
    fsTick = fn(fsTick);
    log('fsTick', fsTick);
  };
  const app = make({ api, repoRef, loadRepo, notify, setFsTick, setSyncStatus: (p) => log('status', p), resetSyncStatus: () => log('reset') });

  if (pick(3)) app.setAccess({ status: 'ok', data: { canRead: true } });
  const unwatch = app.watch();
  let cleanup;
  let deps = '';
  const rerun = () => {
    const r = repoRef.current;
    const next = JSON.stringify([r?.path, app.state().autoSync, r?.remotes.length]);
    if (next === deps) return;
    deps = next;
    cleanup?.();
    cleanup = app.remote(r);
  };
  rerun();

  const respond = (p) => {
    const err = (code) => ({ ok: false, error: { code, message: `сбой ${code}`, hint: pick(2) ? 'подсказка' : null } });
    if (p.kind === 'status') {
      if (pick(6) === 0) return p.done(err('GIT'));
      return p.done({ ok: true, data: { path: pick(5) === 0 ? 'C:/other' : p.dir, wipFiles: Array.from({ length: pick(3) }, () => ({})), operation: null } });
    }
    if (p.kind === 'remoteCheck') {
      const r = pick(8);
      if (r === 0) return p.done(err('NETWORK'));
      if (r === 1) return p.done({ ok: true, data: { status: 'skipped' } });
      if (r === 2) return p.done({ ok: true, data: { status: 'error', retryAfter: choose([null, 0, 20, 400]), error: pick(2) ? { message: 'нет сети', code: 'NETWORK' } : null } });
      return p.done({ ok: true, data: { status: 'ok', via: choose(['api', 'ls-remote']), ms: pick(300), fetched: pick(3) === 0 } });
    }
    return p.done(pick(4) === 0 ? err('AUTH') : { ok: true, data: { fetched: true } });
  };

  // Расписание таймеров (через сколько сработает каждый) — тоже часть следа
  const snapshot = (i) => log('step', i, app.state(), env.timers.map((t) => t.at - env.now).sort((x, y) => x - y), env.listeners.length, subs.size, pending.length);

  for (let i = 0; i < 90; i++) {
    const r = pick(27);
    if (r < 5 || (r >= 20 && r < 24)) {
      // время идёт: срабатывают таймеры по порядку
      const until = env.now + choose([10, 50, 400, 2000, 3000, 20000, 100000]);
      for (;;) {
        env.timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = env.timers[0];
        if (!t || t.at > until) break;
        env.timers.shift();
        env.now = t.at;
        t.fn();
        await flush();
      }
      env.now = until;
    } else if (r < 9 || r >= 24) {
      if (pending.length) respond(pending.splice(pick(pending.length), 1)[0]);
    } else if (r < 11) {
      const ev = { path: pick(5) === 0 ? 'C:/other' : (repoRef.current?.path ?? 'C:/a'), git: pick(3) === 0 };
      for (const cb of [...subs]) cb(ev);
    } else if (r < 13) {
      app.setBusy(pick(2) === 0);
    } else if (r === 13) {
      env.focused = pick(4) !== 0;
      env.visible = pick(5) !== 0;
      const type = choose(['focus', 'blur', 'visibilitychange']);
      for (const l of [...env.listeners]) if (l.type === type) l.fn();
    } else if (r === 14) {
      void app.fetch(pick(2) === 0);
    } else if (r === 15) {
      app.mode(choose(['realtime', 'fast', 'standard', 'rare']));
    } else if (r === 16 || r === 17) {
      // перезапуск эффекта сбрасывает отсчёт проверки — редко
      if (pick(4) === 0) {
        if (r === 17) repoRef.current = pick(6) === 0 ? null : { path: choose(['C:/a', 'C:/b']), remotes: Array.from({ length: pick(3) }) };
        else if (pick(2)) app.toggle();
        else app.setAuto(pick(2) === 0);
        rerun();
      }
    } else {
      const ok = { status: 'ok', data: { canRead: true } };
      app.setAccess(choose([null, { status: 'checking' }, ok, ok, ok, { status: 'ok', data: { canRead: false } }, { status: 'ok', data: { canRead: null } }]));
    }
    await flush();
    snapshot(i);
  }
  cleanup?.();
  unwatch?.();
  snapshot('end');
  return env.trace;
}

let steps = 0;
for (let seed = 1; seed <= SCENARIOS; seed++) {
  const a = await runScenario(seed, legacyApp);
  const b = await runScenario(seed, storeApp);
  steps += a.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      console.error(`РАСХОЖДЕНИЕ: сценарий ${seed}, запись ${i}\nстарое: ${a[i]}\nновое:  ${b[i]}`);
      console.error('до этого:\n' + a.slice(Math.max(0, i - 6), i).join('\n'));
      process.exit(1);
    }
  }
}
console.log(`syncStore = прежний код App.tsx: ${SCENARIOS} сценариев, ${steps} записей`);
