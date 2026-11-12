// Сверка src/state/ciStore.ts с прежним кодом App.tsx (до 2026-11-12: «CI/CD: статусы пайплайнов для графа» — опрос
// `cicd:pipelines`, отбор закончившихся пайплайнов в `announceFinished`, `refreshForge`, `onForgeChanged`, опрос `forge` при
// `token.pending`, подсказки значков). Прежний код перенесён сюда дословно поверх подставных useState/useRef; эффекты
// перезапускаются при смене своих зависимостей, как в окне. Часы, видимость окна и api подставные, ответы приходят в
// случайном порядке; каждый сценарий идёт дважды с одним зерном, следы обязаны совпасть.
// node tests/ui-parity/ci-store.mjs <корень репозитория> [сценариев]
import path from 'node:path';
import fs from 'node:fs';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setup, random } from './hooks.mjs';

const [repoRoot, countArg] = process.argv.slice(2);
setup(repoRoot);
const SCENARIOS = Number(countArg ?? 400);

// `.tsx` (ACTIVE_STATUSES живёт в components/PipelineStatus.tsx) — через esbuild, как в Vite
const esbuild = createRequire(path.join(repoRoot, 'package.json'))('esbuild');
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:') && url.split('?')[0].endsWith('.tsx')) {
      const source = esbuild.transformSync(fs.readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code;
      return { format: 'module', source, shortCircuit: true };
    }
    return next(url, context);
  },
});

/* ---------- Окружение ---------- */

const env = { now: 0, timers: [], nextId: 1, visible: true, trace: [] };
const log = (...e) => env.trace.push(JSON.stringify(e));
globalThis.setTimeout = (fn, ms) => {
  const id = env.nextId++;
  env.timers.push({ id, at: env.now + ms, fn });
  return id;
};
globalThis.clearTimeout = (id) => {
  env.timers = env.timers.filter((t) => t.id !== id);
};
globalThis.setInterval = (fn, ms) => {
  const id = env.nextId++;
  const t = { id, at: env.now + ms, fn: () => {
    t.at = env.now + ms;
    env.timers.push(t);
    fn();
  } };
  env.timers.push(t);
  return id;
};
globalThis.clearInterval = globalThis.clearTimeout;
globalThis.window = {};
globalThis.document = {
  documentElement: {},
  get visibilityState() {
    return env.visible ? 'visible' : 'hidden';
  },
};
globalThis.localStorage = { getItem: (k) => (k === 'language' ? 'ru' : null), setItem() {} };

const { ACTIVE_STATUSES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'components', 'PipelineStatus.tsx')).href);
const { createCiStore } = await import(pathToFileURL(path.join(repoRoot, 'src', 'state', 'ciStore.ts')).href);

/* ---------- Подставной api ---------- */

function makeApi(withCicd) {
  const pending = [];
  const call = (kind, ...args) => {
    log('api', kind, ...args, env.now);
    return new Promise((done) => pending.push({ kind, done }));
  };
  const api = withCicd
    ? {
        cicd: {
          status: (dir, opts) => call('status', dir, opts),
          pipelines: (dir, opts) => call('pipelines', dir, opts),
          pipeline: (dir, id, opts) => call('pipeline', dir, id, opts),
        },
      }
    : {};
  return { api, pending };
}

/* ---------- Эталон: прежний код App.tsx ---------- */

function legacyApp({ api, repoRef, patchRepo, notifyFinished }) {
  const st = { pipelineMap: null, pipelineTips: {} };
  const setter = (key) => (v) => (st[key] = typeof v === 'function' ? v(st[key]) : v);
  const setPipelineMap = setter('pipelineMap');
  const setPipelineTips = setter('pipelineTips');
  const useRef = (v) => ({ current: v });
  const useCallback = (fn) => fn;
  const repoStore = { getState: () => ({ patchRepo }) };

  // --- дословно ---
  const refreshForge = useCallback(async () => {
    const r = repoRef.current;
    if (!r || !api?.cicd) return;
    const cur = r.localBranches?.find((b) => b.name === r.currentBranch);
    const st = await api.cicd.status(r.path, { remote: cur?.upstreamRemote });
    if (st?.ok) repoStore.getState().patchRepo((x) => (x && x.path === r.path ? { ...x, forge: st.data } : x));
  }, []);

  const seenStatuses = useRef(new Map());

  const pipelinesEffect = (pipelineKey, currentBranchInfo) => {
    if (!pipelineKey || !api?.cicd) {
      setPipelineMap(null);
      return undefined;
    }
    let alive = true;
    let timer = null;
    const path = repoRef.current?.path;
    const remote = currentBranchInfo?.upstreamRemote;
    const tick = async () => {
      let active = false;
      if (document.visibilityState === 'visible') {
        const res = await api.cicd.pipelines(path, { remote });
        if (!alive) return;
        if (res.ok) {
          active = res.data.pipelines.some((p) => ACTIVE_STATUSES.has(p.status));
          announceFinished(path, res.data.pipelines, res.data.label);
          setPipelineMap({ bySha: res.data.bySha, pipelines: res.data.pipelines, error: null });
        } else {
          setPipelineMap((m) => ({ bySha: m?.bySha ?? {}, pipelines: m?.pipelines ?? [], error: res.error }));
          if (res.error?.code === 'NO_TOKEN') refreshForge();
        }
      }
      if (alive) timer = setTimeout(tick, active ? 10000 : 60000);
    };
    timer = setTimeout(tick, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  };

  const onForgeChanged = useCallback((next) => {
    repoStore.getState().patchRepo((r) => (r ? { ...r, forge: next } : r));
  }, []);
  // --- исправление 2.0 (2026-11-12): без аргумента 1.x ставил forge = undefined, теперь — перечитать состояние ---
  const onForgeChangedFixed = (next) => (next === undefined ? void refreshForge() : onForgeChanged(next));

  const forgePendingEffect = (forgePending) => {
    if (!forgePending) return undefined;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      refreshForge();
      if (n >= 8) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  };

  function announceFinished(path, list, label) {
    const seen = seenStatuses.current;
    const first = !seen.has(path);
    if (first) seen.set(path, new Map());
    const map = seen.get(path);
    for (const p of list) {
      const prev = map.get(p.id);
      map.set(p.id, p.status);
      if (first || !prev || !ACTIVE_STATUSES.has(prev) || ACTIVE_STATUSES.has(p.status)) continue;
      if (!['success', 'failed', 'canceled'].includes(p.status)) continue;
      notifyFinished(p, label);
    }
  }

  const pipelineTipRequested = useRef(new Set());
  const loadPipelineTip = useCallback(async (p) => {
    const r = repoRef.current;
    const key = `${p.id}:${p.status}`;
    if (!r || pipelineTipRequested.current.has(key)) return;
    pipelineTipRequested.current.add(key);
    const res = await api.cicd.pipeline(r.path, p.id, { remote: r.localBranches?.find((b) => b.name === r.currentBranch)?.upstreamRemote });
    if (!res.ok) return;
    const icon = (st, allow) => (st === 'success' ? '✓' : st === 'failed' ? (allow ? '⚠' : '✕') : ACTIVE_STATUSES.has(st) ? '⟳' : st === 'manual' ? '⏸' : st === 'canceled' ? '⊘' : st === 'skipped' ? '»' : '•');
    const parts = res.data.stages.flatMap((s) => (s.jobs.length > 4 ? [`${s.name}: ${icon(s.status)} (${s.jobs.length})`] : s.jobs.map((j) => `${j.name}: ${icon(j.status, j.allowFailure)}`)));
    setPipelineTips((m) => ({ ...m, [p.id]: { status: p.status, text: parts.join(', ') } }));
  }, []);
  // --- конец дословного ---

  return {
    state: () => st,
    pipelines: pipelinesEffect,
    forgePending: forgePendingEffect,
    refreshForge,
    setForge: onForgeChangedFixed,
    tip: loadPipelineTip,
  };
}

/* ---------- Новое: хранилище (вызовы — как в App.tsx) ---------- */

function storeApp({ api, repoRef, patchRepo, notifyFinished }) {
  const store = createCiStore(() => api, { current: () => repoRef.current, patch: patchRepo });
  const g = () => store.getState();
  const announceFinished = (path, list, label) => {
    for (const p of g().finishedPipelines(path, list)) notifyFinished(p, label);
  };
  return {
    state: () => ({ pipelineMap: g().pipelineMap, pipelineTips: g().pipelineTips }),
    pipelines: (key, info) => g().startPipelines(key, info?.upstreamRemote, announceFinished),
    forgePending: (pending) => (pending ? g().pollForge() : undefined),
    refreshForge: () => g().refreshForge(),
    setForge: (next) => g().setForge(next),
    tip: (p) => g().loadPipelineTip(p),
  };
}

/* ---------- Сценарий ---------- */

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};
const STATUSES = ['running', 'pending', 'success', 'failed', 'canceled', 'manual', 'skipped', 'created', null];

async function runScenario(seed, make) {
  env.now = 0;
  env.timers = [];
  env.nextId = 1;
  env.visible = true;
  env.trace = [];
  const rnd = random(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const choose = (list) => list[pick(list.length)];
  const { api, pending } = makeApi(pick(8) !== 0);

  const makeRepo = () => ({
    path: choose(['C:/a', 'C:/b']),
    currentBranch: choose(['main', 'dev']),
    localBranches: pick(5) ? [{ name: 'main', upstreamRemote: choose(['origin', 'up', undefined]) }, { name: 'dev', upstreamRemote: 'origin' }] : undefined,
    forge: null,
  });
  const repoRef = { current: pick(5) ? makeRepo() : null };
  const patchRepo = (fn) => {
    repoRef.current = fn(repoRef.current);
    log('patch', repoRef.current?.path ?? null, repoRef.current ? (repoRef.current.forge === undefined ? 'undef' : repoRef.current.forge) : null);
  };
  const notifyFinished = (p, label) => log('finished', p.id, p.status, label);
  const app = make({ api, repoRef, patchRepo, notifyFinished });

  // Эффекты: опрос пайплайнов по ключу, опрос forge по token.pending
  let key = pick(4) ? 'k1' : null;
  let info = { upstreamRemote: 'origin' };
  let stopPipelines = app.pipelines(key, info);
  let forgePending = false;
  let stopForge;

  const respond = (p) => {
    const err = (code) => ({ ok: false, error: { code, message: code } });
    if (p.kind === 'status') return p.done(pick(4) === 0 ? err('NETWORK') : pick(6) === 0 ? null : { ok: true, data: { provider: 'gitlab', n: pick(100) } });
    if (p.kind === 'pipeline') {
      if (pick(4) === 0) return p.done(err('NOT_FOUND'));
      const job = () => ({ name: `j${pick(9)}`, status: choose(STATUSES), allowFailure: pick(3) === 0 });
      return p.done({ ok: true, data: { stages: Array.from({ length: pick(3) }, (_, i) => ({ name: `s${i}`, status: choose(STATUSES), jobs: Array.from({ length: pick(7) }, job) })) } });
    }
    const r = pick(6);
    if (r === 0) return p.done(err('NETWORK'));
    if (r === 1) return p.done(err('NO_TOKEN'));
    const pipelines = Array.from({ length: pick(4) }, () => ({ id: 1 + pick(5), number: pick(2) ? pick(100) : null, status: choose(STATUSES), branch: 'main', name: null }));
    return p.done({ ok: true, data: { pipelines, bySha: Object.fromEntries(pipelines.map((x) => [`sha${x.id}`, { id: x.id, status: x.status }])), label: choose(['GitLab', '']) } });
  };

  for (let i = 0; i < 80; i++) {
    const r = pick(16);
    if (r < 5) {
      const until = env.now + choose([100, 400, 1500, 5000, 10000, 60000, 200000]);
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
    } else if (r < 10) {
      if (pending.length) respond(pending.splice(pick(pending.length), 1)[0]);
    } else if (r === 10) {
      env.visible = pick(3) !== 0;
    } else if (r === 11) {
      const next = choose([null, 'k1', 'k2', 'k3']);
      if (pick(3) === 0) repoRef.current = pick(6) ? makeRepo() : null;
      info = pick(2) ? { upstreamRemote: choose(['origin', 'up']) } : null;
      if (next !== key) {
        key = next;
        stopPipelines?.();
        stopPipelines = app.pipelines(key, info);
      }
    } else if (r === 12) {
      const next = pick(2) === 0;
      if (next !== forgePending) {
        forgePending = next;
        stopForge?.();
        stopForge = app.forgePending(forgePending);
      }
    } else if (r === 13) {
      // значок пайплайна есть только при api.cicd
      if (api.cicd) void app.tip({ id: 1 + pick(5), status: choose(STATUSES) });
    } else if (r === 14) {
      void app.refreshForge();
    } else {
      app.setForge(choose([undefined, null, { provider: 'github' }]));
    }
    await flush();
    log('step', i, app.state(), env.timers.map((t) => t.at - env.now).sort((x, y) => x - y), pending.length);
  }
  stopPipelines?.();
  stopForge?.();
  log('end', env.timers.length);
  return env.trace;
}

let records = 0;
for (let seed = 1; seed <= SCENARIOS; seed++) {
  const a = await runScenario(seed, legacyApp);
  const b = await runScenario(seed, storeApp);
  records += a.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      console.error(`РАСХОЖДЕНИЕ: сценарий ${seed}, запись ${i}\nстарое: ${a[i]}\nновое:  ${b[i]}`);
      console.error('до этого:\n' + a.slice(Math.max(0, i - 6), i).join('\n'));
      process.exit(1);
    }
  }
}
console.log(`ciStore = прежний код App.tsx: ${SCENARIOS} сценариев, ${records} записей`);
