// Сверка src/state/repoStore.ts с прежним кодом App.jsx (до 2026-11-11: loadRepo, showBlank, showTab, rememberActiveTab,
// closeTab, слияние repo:status). Прежний код перенесён сюда дословно поверх подставных useState/useRef: сеттеры меняют
// состояние сразу, ref-ы обновляются «отрисовкой» после каждого шага (в окне React отрисовывает между событиями).
// Ответы repo:load приходят в случайном порядке, сервер то меняет граф, то нет (отпечаток → commitsUnchanged), бывают ошибки.
// node tests/ui-parity/repo-store.mjs <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, random } from './hooks.mjs';

const [repoRoot] = process.argv.slice(2);
setup(repoRoot);
globalThis.localStorage = { getItem: () => 'ru', setItem() {} };
const { createRepoStore } = await import(pathToFileURL(path.join(repoRoot, 'src', 'state', 'repoStore.ts')).href);

const DIRS = ['C:/a', 'C:/b', 'C:/c'];

/* ---------- Сервер: состояние папок и отложенные ответы ---------- */

function makeServer(rnd) {
  const disk = new Map(); // dir → { version, commits, wip, stashes, broken }
  const pick = (n) => Math.floor(rnd() * n);
  const regen = (dir, graph) => {
    const prev = disk.get(dir);
    const version = graph || !prev ? (prev?.version ?? 0) + 1 : prev.version;
    const commits = graph || !prev ? Array.from({ length: 1 + pick(4) }, (_, i) => ({ hash: `${dir}-${version}-${i}` })) : prev.commits;
    const wip = pick(3) === 0 ? [] : Array.from({ length: 1 + pick(2) }, (_, i) => ({ path: `f${pick(3)}${i}`, status: 'M' }));
    const stashes = Array.from({ length: pick(3) }, (_, i) => ({ hash: `${dir}-s${version}-${i}` }));
    disk.set(dir, { version, commits, wip, stashes, operation: pick(4) === 0 ? 'merge' : null, broken: pick(6) === 0 });
  };
  DIRS.forEach((d) => regen(d, true));
  const response = (dir, known) => {
    const d = disk.get(dir);
    if (d.broken) return { ok: false, error: { code: 'NOT_A_REPO', message: `нет ${dir}`, hint: null, details: '' } };
    const fp = `${dir}#${d.version}`;
    const unchanged = known === fp;
    return {
      ok: true,
      data: {
        path: dir,
        name: dir.slice(-1),
        headHash: d.commits[0].hash,
        commits: unchanged ? [] : d.commits.map((c) => ({ ...c })),
        truncated: unchanged ? false : d.commits.length > 2,
        wipFiles: d.wip.map((f) => ({ ...f })),
        stashes: d.stashes.map((s) => ({ ...s })),
        operation: d.operation,
        ci: [],
        graphFingerprint: rnd() < 0.15 ? undefined : fp, // под Electron отпечатка нет
        commitsUnchanged: unchanged,
      },
    };
  };
  const status = (dir) => {
    const d = disk.get(dir);
    return { path: dir, wipFiles: d.wip.map((f) => ({ ...f })), operation: d.operation, ci: pick(3) === 0 ? undefined : pick(2) ? [] : [{ system: 'gitlab' }] };
  };
  return { regen, response, status };
}

/** Подставной api: каждый вызов load ждёт, пока сценарий его отпустит. */
function makeApi(server) {
  const pending = [];
  const calls = [];
  const api = {
    repo: {
      load: (dir, opts) => {
        calls.push([dir, opts?.known ?? null]);
        return new Promise((done) => pending.push({ dir, known: opts?.known, done }));
      },
    },
  };
  return { api, pending, calls, server };
}

/* ---------- Эталон: прежний код App.jsx ---------- */

function legacyApp(api) {
  const st = { repo: null, loading: false, loadingLabel: '', loadError: null, selectedHash: null, filesByHash: {}, activePath: null, accessResets: 0 };
  const setter = (key) => (v) => {
    st[key] = typeof v === 'function' ? v(st[key]) : v;
  };
  const setRepo = setter('repo');
  const setLoading = setter('loading');
  const setLoadingLabel = setter('loadingLabel');
  const setLoadError = setter('loadError');
  const setSelectedHash = setter('selectedHash');
  const setFilesByHash = setter('filesByHash');
  const setActivePath = setter('activePath');
  const setAccess = () => st.accessResets++;
  const repoRef = { current: null };
  const loadSeq = { current: 0 };
  const activeRef = { current: null };
  const tabCache = { current: new Map() };
  const selectedRef = { current: null };
  const filesRef = { current: {} };
  const render = () => {
    repoRef.current = st.repo;
    activeRef.current = st.activePath;
    selectedRef.current = st.selectedHash;
    filesRef.current = st.filesByHash;
  };

  const loadRepo = async (dir, { silent = false } = {}) => {
    const seq = ++loadSeq.current;
    if (!silent) {
      setLoading(true);
      setLoadingLabel(dir);
    }
    const base = repoRef.current?.path === dir ? repoRef.current : tabCache.current.get(dir)?.repo;
    const known = base?.path === dir ? base.graphFingerprint : undefined;
    const res = await api.repo.load(dir, known ? { known } : undefined);
    const stale = seq !== loadSeq.current;
    if (!stale) setLoading(false);
    if (!res.ok) {
      if (!silent && !stale) setLoadError(res.error);
      return null;
    }
    const data = res.data.commitsUnchanged ? { ...res.data, commits: base.commits, truncated: base.truncated } : res.data;
    const cached = tabCache.current.get(data.path);
    tabCache.current.set(data.path, { ...(cached ?? {}), repo: data });
    if (stale || (activeRef.current && activeRef.current !== data.path && silent)) return data;
    const samePath = repoRef.current?.path === data.path;
    if (!samePath) {
      setFilesByHash({});
      setAccess(null);
    }
    setRepo(data);
    setLoadError(null);
    setSelectedHash((prev) => {
      const keep =
        samePath &&
        prev &&
        ((prev === 'WIP' && data.wipFiles.length > 0) ||
          (prev.startsWith('stash:') && data.stashes.some((s) => `stash:${s.hash}` === prev)) ||
          data.commits.some((c) => c.hash === prev));
      if (keep) return prev;
      return data.wipFiles.length > 0 ? 'WIP' : data.headHash;
    });
    return data;
  };
  const rememberActiveTab = () => {
    const current = repoRef.current;
    if (!current) return;
    tabCache.current.set(current.path, { repo: current, selectedHash: selectedRef.current, filesByHash: filesRef.current });
  };
  const showBlank = (p) => {
    loadSeq.current++;
    setActivePath(p);
    activeRef.current = p;
    setRepo(null);
    repoRef.current = null;
    setSelectedHash(null);
    setLoading(false);
  };
  const showTab = (p) => {
    rememberActiveTab();
    setActivePath(p);
    activeRef.current = p;
    const cached = tabCache.current.get(p);
    if (cached?.repo) {
      repoRef.current = cached.repo;
      setRepo(cached.repo);
      setSelectedHash(cached.selectedHash ?? (cached.repo.wipFiles.length ? 'WIP' : cached.repo.headHash));
      setFilesByHash(cached.filesByHash ?? {});
      return [loadRepo(p, { silent: true })];
    }
    return [loadRepo(p)];
  };
  const applyStatus = (s) =>
    setRepo((r) => {
      if (!r || r.path !== s.path) return r;
      const ci = s.ci ?? r.ci;
      const same = r.operation === s.operation && JSON.stringify(r.wipFiles) === JSON.stringify(s.wipFiles) && JSON.stringify(r.ci) === JSON.stringify(ci);
      if (same) return r;
      return { ...r, wipFiles: s.wipFiles, operation: s.operation, ci };
    });
  return {
    state: st,
    render,
    load: (dir, silent) => loadRepo(dir, { silent }),
    showBlank: (p) => {
      rememberActiveTab();
      showBlank(p);
    },
    showTab,
    forget: (p) => tabCache.current.delete(p),
    select: setSelectedHash,
    files: setFilesByHash,
    setActive: (p) => {
      setActivePath(p);
      activeRef.current = p;
    },
    applyStatus,
  };
}

/* ---------- Новый код: хранилище ---------- */

function storeApp(api) {
  const store = createRepoStore(() => api);
  let accessResets = 0;
  store.getState().onSwitch(() => accessResets++);
  const s = () => store.getState();
  return {
    get state() {
      const { repo, loading, loadingLabel, loadError, selectedHash, filesByHash, activePath } = s();
      return { repo, loading, loadingLabel, loadError, selectedHash, filesByHash, activePath, accessResets };
    },
    render() {},
    load: (dir, silent) => s().load(dir, { silent }),
    showBlank: (p) => {
      s().rememberActive();
      s().showBlank(p);
    },
    showTab: (p) => {
      s().rememberActive();
      s().showCached(p);
    },
    forget: (p) => s().forgetTab(p),
    select: (v) => s().setSelectedHash(v),
    files: (v) => s().setFilesByHash(v),
    setActive: (p) => s().setActivePath(p),
    applyStatus: (st) => s().applyStatus(st),
  };
}
/* ---------- Прогон ---------- */

const flush = () => new Promise((r) => setImmediate(r)); // после всех микрозадач
let steps = 0;
let loads = 0;
let unchangedHits = 0;

for (let seed = 1; seed <= Number(process.env.SEEDS ?? 400); seed++) {
  const rnd = random(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const serverA = makeServer(random(seed * 7 + 3));
  const serverB = makeServer(random(seed * 7 + 3));
  const A = makeApi(serverA);
  const B = makeApi(serverB);
  const old = legacyApp(A.api);
  const neu = storeApp(B.api);
  const prevCommits = { old: null, neu: null };
  const results = { old: [], neu: [] };

  const compare = (what) => {
    steps++;
    const a = old.state;
    const b = neu.state;
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    const ca = a.repo?.commits ?? null;
    const cb = b.repo?.commits ?? null;
    const sameA = ca === prevCommits.old;
    const sameB = cb === prevCommits.neu;
    prevCommits.old = ca;
    prevCommits.neu = cb;
    const callsA = JSON.stringify(A.calls);
    const callsB = JSON.stringify(B.calls);
    const ra = JSON.stringify(results.old);
    const rb = JSON.stringify(results.neu);
    if (ja !== jb || sameA !== sameB || callsA !== callsB || ra !== rb || A.pending.length !== B.pending.length) {
      console.error('РАСХОЖДЕНИЕ', `seed=${seed}`, what);
      console.error('прежнее:', ja.slice(0, 600), sameA, callsA.slice(-200), ra.slice(-200));
      console.error('новое:  ', jb.slice(0, 600), sameB, callsB.slice(-200), rb.slice(-200));
      process.exit(1);
    }
  };
  const track = (key, promise) => {
    if (promise && typeof promise.then === 'function') promise.then((r) => results[key].push(r ? `${r.path}:${r.commits.length}` : null));
  };

  for (let step = 0; step < 60; step++) {
    const op = pick(10);
    const dir = DIRS[pick(DIRS.length)];
    let what;
    if (op <= 1) {
      const silent = rnd() < 0.5;
      what = `load ${dir} silent=${silent}`;
      track('old', old.load(dir, silent));
      track('neu', neu.load(dir, silent));
      loads++;
    } else if (op === 2) {
      what = `showTab ${dir}`;
      // Загрузку внутри showTab интерфейс не ждёт: её итог сверяется по состоянию
      old.showTab(dir);
      neu.showTab(dir);
      loads++;
    } else if (op === 3) {
      const p = rnd() < 0.3 ? null : `new-tab:${pick(3)}`;
      what = `showBlank ${p}`;
      old.showBlank(p);
      neu.showBlank(p);
    } else if (op === 4 && A.pending.length) {
      // Ответ в случайном порядке
      const i = pick(A.pending.length);
      const ra = A.pending.splice(i, 1)[0];
      const rb = B.pending.splice(i, 1)[0];
      const resA = serverA.response(ra.dir, ra.known);
      const resB = serverB.response(rb.dir, rb.known);
      if (resA.ok && resA.data.commitsUnchanged) unchangedHits++;
      what = `ответ ${ra.dir} known=${ra.known}`;
      ra.done(resA);
      rb.done(resB);
    } else if (op === 5) {
      const graph = rnd() < 0.5;
      what = `диск ${dir} graph=${graph}`;
      serverA.regen(dir, graph);
      serverB.regen(dir, graph);
    } else if (op === 6) {
      const choices = [null, 'WIP', 'stash:x', `${dir}-1-0`, old.state.repo?.commits[0]?.hash ?? null, old.state.repo?.stashes[0] ? `stash:${old.state.repo.stashes[0].hash}` : 'WIP'];
      const v = choices[pick(choices.length)];
      what = `select ${v}`;
      if (rnd() < 0.5) {
        old.select(v);
        neu.select(v);
      } else {
        old.select((prev) => (prev ? v : prev));
        neu.select((prev) => (prev ? v : prev));
      }
    } else if (op === 7) {
      const v = { [`h${pick(5)}`]: [pick(9)] };
      what = `files ${JSON.stringify(v)}`;
      old.files((prev) => ({ ...prev, ...v }));
      neu.files((prev) => ({ ...prev, ...v }));
    } else if (op === 8) {
      const target = old.state.repo?.path ?? dir;
      what = `status ${target}`;
      const sa = serverA.status(target);
      const sb = serverB.status(target);
      old.applyStatus(sa);
      neu.applyStatus(sb);
    } else {
      if (rnd() < 0.5) {
        what = `forget ${dir}`;
        old.forget(dir);
        neu.forget(dir);
      } else {
        what = `setActive ${dir}`;
        old.setActive(dir);
        neu.setActive(dir);
      }
    }
    await flush();
    old.render();
    compare(what);
  }
  // Отпускаем всё, что осталось
  while (A.pending.length) {
    const ra = A.pending.shift();
    const rb = B.pending.shift();
    ra.done(serverA.response(ra.dir, ra.known));
    rb.done(serverB.response(rb.dir, rb.known));
    await flush();
    old.render();
    compare('хвост');
  }
}

/* ---------- Догрузка истории (новое в 2.0, прежнего кода нет): ожидаемое поведение ---------- */

// Сервер с длинной историей: ответы отдаются по команде, отпечатки — как в Rust (ссылки; ссылки + предел)
function historyServer() {
  const disk = new Map([
    ['C:/a', { version: 1, total: 5000 }],
    ['C:/b', { version: 1, total: 300 }],
  ]);
  const commitsOf = (dir, from, to) => {
    const d = disk.get(dir);
    return Array.from({ length: Math.max(0, Math.min(to, d.total) - from) }, (_, i) => ({ hash: `${dir}-${d.version}-${from + i}` }));
  };
  const pending = [];
  const calls = [];
  const later = (call, make) => {
    calls.push(call);
    return new Promise((done) => pending.push({ call, done, make }));
  };
  const api = {
    repo: {
      load: (dir, opts) =>
        later(['load', dir, opts ?? null], () => {
          const d = disk.get(dir);
          const limit = opts?.limit ?? 2000;
          const refs = `${dir}#${d.version}`;
          const fp = `${refs}@${limit}`;
          const unchanged = opts?.known === fp;
          const commits = unchanged ? [] : commitsOf(dir, 0, limit);
          return {
            ok: true,
            data: { path: dir, name: dir, headHash: `${dir}-${d.version}-0`, commits, truncated: !unchanged && commits.length >= limit, wipFiles: [], stashes: [], operation: null, ci: [], graphFingerprint: fp, refsFingerprint: refs, commitsUnchanged: unchanged },
          };
        }),
      loadMore: (dir, { skip, count }) =>
        later(['more', dir, skip, count], () => {
          const d = disk.get(dir);
          if (d.broken) return { ok: false, error: { code: 'GIT', message: 'сбой', hint: null, details: '' } };
          const refs = `${dir}#${d.version}`;
          const commits = commitsOf(dir, skip, skip + count);
          return { ok: true, data: { commits, fingerprint: refs, graphFingerprint: `${refs}@${skip + count}`, truncated: commits.length >= count } };
        }),
    },
  };
  // Отпустить самый старый ожидающий ответ (или с номером i); ответ считается в момент отпускания
  const answer = async (i = 0) => {
    const [p] = pending.splice(i, 1);
    p.done(p.make());
    await flush();
    await flush();
  };
  return { api, disk, pending, calls, answer };
}

{
  const { createRepoStore, historyLimit } = await import(pathToFileURL(path.join(repoRoot, 'src', 'state', 'repoStore.ts')).href);
  const check = (what, a, b) => {
    steps++;
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) {
      console.error('РАСХОЖДЕНИЕ догрузка:', what, '\nполучено: ', ja, '\nожидалось:', jb);
      process.exit(1);
    }
  };
  const lastHash = (s) => s.repo?.commits.at(-1)?.hash ?? null;

  check('historyLimit', [0, 1, 2000, 2001, 4000, 49_999, 60_000].map(historyLimit), [2000, 2000, 2000, 4000, 4000, 50_000, 50_000]);

  const srv = historyServer();
  const store = createRepoStore(() => srv.api);
  const s = () => store.getState();
  s().setActivePath('C:/a');
  void s().load('C:/a');
  await srv.answer();
  check('первая загрузка', [s().repo.commits.length, s().repo.truncated], [2000, true]);
  s().setSelectedHash('C:/a-1-5');
  const before = s().repo.commits;

  // Порция дописывается к прежним; повторный вызов во время загрузки не уходит на сервер
  void s().loadMore();
  void s().loadMore();
  check('один запрос порции', srv.calls.filter((c) => c[0] === 'more'), [['more', 'C:/a', 2000, 2000]]);
  check('идёт догрузка', s().loadingMore, true);
  await srv.answer();
  check('порция применена', [s().repo.commits.length, lastHash(s()), s().repo.truncated, s().loadingMore, s().selectedHash], [4000, 'C:/a-1-3999', true, false, 'C:/a-1-5']);
  check('прежние коммиты на месте', s().repo.commits.slice(0, 2000).every((c, i) => c === before[i]), true);
  check('отпечаток для предела 4000', s().repo.graphFingerprint, 'C:/a#1@4000');

  // Полное перечитывание просит 4000 и с тем же отпечатком получает commitsUnchanged — список тот же
  const glued = s().repo.commits;
  void s().load('C:/a', { silent: true });
  check('load с пределом', srv.calls.at(-1), ['load', 'C:/a', { known: 'C:/a#1@4000', limit: 4000 }]);
  await srv.answer();
  check('граф не изменился', [s().repo.commits === glued, s().repo.commits.length], [true, 4000]);

  // Новый коммит (или fetch): список не сжимается до 2000
  srv.disk.get('C:/a').version = 2;
  void s().load('C:/a', { silent: true });
  await srv.answer();
  check('после нового коммита — 4000', [s().repo.commits.length, lastHash(s())], [4000, 'C:/a-2-3999']);

  // Устаревший ответ: пока шла порция, ветки сдвинулись и граф перечитан — порция отбрасывается, идёт тихая load
  void s().loadMore(); // skip 4000
  srv.disk.get('C:/a').version = 3;
  void s().load('C:/a', { silent: true });
  await srv.answer(1); // сначала load: 4000 коммитов версии 3
  srv.disk.get('C:/a').version = 2; // ответ порции посчитан по версии 2 (как до сдвига)
  const callsBefore = srv.calls.length;
  await srv.answer(0);
  srv.disk.get('C:/a').version = 3;
  check('устаревшая порция отброшена', [s().repo.commits.length, lastHash(s()), s().loadingMore], [4000, 'C:/a-3-3999', false]);
  check('и запущена тихая load', srv.calls.slice(callsBefore), [['load', 'C:/a', { known: 'C:/a#3@4000', limit: 4000 }]]);
  await srv.answer();

  // Другая вкладка во время порции: её коммиты не подмешиваются
  void s().loadMore();
  s().rememberActive();
  s().showCached('C:/b'); // кэша b нет — обычная загрузка
  check('переход на вкладку сбросил догрузку', s().loadingMore, false);
  await srv.answer(1); // load b
  await srv.answer(0); // порция a — ничья
  check('вкладка b без чужих коммитов', [s().repo.path, s().repo.commits.length, s().repo.commits.every((c) => c.hash.startsWith('C:/b'))], ['C:/b', 300, true]);
  check('b короткая — догрузки нет', (void s().loadMore(), srv.pending.length), 0);
  // Назад на a: в кэше вкладки 4000 коммитов (порция до перехода не пришла — она отброшена)
  s().rememberActive();
  s().showCached('C:/a');
  check('кэш вкладки a', s().repo.commits.length, 4000);
  await srv.answer();

  // Ошибка порции: состояние для «Загрузить ещё», повтор проходит
  srv.disk.get('C:/a').broken = true;
  void s().loadMore();
  await srv.answer();
  check('ошибка', [s().loadingMore, s().loadMoreError?.code, s().repo.commits.length], [false, 'GIT', 4000]);
  srv.disk.get('C:/a').broken = false;
  void s().loadMore();
  check('ошибка сброшена при повторе', s().loadMoreError, null);
  await srv.answer();
  check('повтор применён', [s().repo.commits.length, s().repo.truncated], [5000, false]);
  // Порция дошла до кэша вкладки
  s().showCached('C:/b');
  await srv.answer();
  s().showCached('C:/a');
  check('кэш вкладки обновлён порцией', s().repo.commits.length, 5000);
  await srv.answer();
  // Конец истории: дальше не просим
  const n = srv.calls.length;
  void s().loadMore();
  check('история кончилась', srv.calls.length, n);

  // Под Electron (без loadMore) — ничего
  const electron = createRepoStore(() => ({ repo: { load: srv.api.repo.load } }));
  electron.getState().setActivePath('C:/a');
  void electron.getState().load('C:/a');
  await srv.answer();
  await electron.getState().loadMore();
  check('без loadMore в api', [srv.pending.length, electron.getState().loadingMore], [0, false]);
}

// Чистые функции: граничные случаи
const { nextSelection, mergeStatus } = await import(pathToFileURL(path.join(repoRoot, 'src', 'state', 'repoStore.ts')).href);
const data = { path: 'p', wipFiles: [], stashes: [{ hash: 's' }], commits: [{ hash: 'c' }], headHash: 'c' };
const expect = (what, a, b) => {
  steps++;
  if (a !== b) {
    console.error('РАСХОЖДЕНИЕ', what, a, b);
    process.exit(1);
  }
};
expect('WIP без файлов → HEAD', nextSelection('WIP', data, true), 'c');
expect('stash сохраняется', nextSelection('stash:s', data, true), 'stash:s');
expect('другой репозиторий → HEAD', nextSelection('c', data, false), 'c');
expect('пропавший коммит → HEAD', nextSelection('x', data, true), 'c');
expect('с изменениями → WIP', nextSelection('x', { ...data, wipFiles: [{}] }, true), 'WIP');
const r = { path: 'p', wipFiles: [{ a: 1 }], operation: null, ci: [] };
expect('тот же статус — тот же объект', mergeStatus(r, { path: 'p', wipFiles: [{ a: 1 }], operation: null }), r);
expect('чужой путь — без изменений', mergeStatus(r, { path: 'q', wipFiles: [], operation: null }), r);
expect('null', mergeStatus(null, { path: 'p', wipFiles: [], operation: null }), null);

if (unchangedHits < 100) {
  console.error('мало ответов commitsUnchanged:', unchangedHits);
  process.exit(1);
}
console.log(`repo-store: совпало ${steps} шагов (${loads} загрузок, commitsUnchanged ${unchangedHits})`);
