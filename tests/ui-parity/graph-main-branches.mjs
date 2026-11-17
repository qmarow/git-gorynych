// Главные ветки графа (src/lib/mainBranches.ts + layoutGraph с pinned): закреплённые дорожки на случайных графах.
// Это новая возможность 2.0, прежней копии нет: проверяются инварианты раскладки и чистые функции выбора.
// node tests/ui-parity/graph-main-branches.mjs <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup } from './hooks.mjs';

const [repo] = process.argv.slice(2);
setup(repo);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const load = (file) => import(pathToFileURL(path.join(repo, 'src', 'lib', file)).href);
const { layoutGraph } = await load('graphLayout.ts');
const { withStashes } = await load('graphStash.ts');
const { autoMainBranches, normalizeMainBranches, resolveMainTips } = await load('mainBranches.ts');

let count = 0;
const fail = (what, ...info) => {
  console.error('РАСХОЖДЕНИЕ', what, ...info.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
  process.exit(1);
};
const eq = (what, a, b) => {
  count++;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) fail(what, '\nполучено: ', ja, '\nожидалось:', jb);
};
const ok = (what, cond, ...info) => {
  count++;
  if (!cond) fail(what, ...info);
};

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// Генератор из graph-layout.mjs: случайный DAG «дети выше родителей», 0–3 родителя среди более старых
function dag(n, mergeRate, gapRate) {
  const hashes = Array.from({ length: n }, (_, i) => `h${i.toString(16).padStart(6, '0')}`);
  const commits = [];
  for (let i = 0; i < n; i++) {
    const parents = [];
    const older = n - i - 1;
    if (older > 0 && rnd() > 0.02) {
      parents.push(hashes[i + 1 + Math.floor(rnd() * Math.min(older, rnd() < 0.7 ? 2 : 30))]);
      while (rnd() < mergeRate && parents.length < 3) parents.push(hashes[i + 1 + Math.floor(rnd() * older)]);
    }
    if (rnd() < gapRate) parents.push('outside' + i);
    commits.push({ hash: hashes[i], parents, subject: 's' + i });
  }
  return commits;
}

const summary = (g) => JSON.stringify({ nodes: g.nodes, edges: g.edges.map((e) => ({ ...e, from: e.from.hash, to: e.to.hash })), laneCount: g.laneCount });

// Цепочки, посчитанные независимо от раскладки: хэш → номер дорожки. Каждая загруженная вершина — своя дорожка по порядку;
// общие коммиты занимает раньше та ветка, чья вершина лежит на цепочке другой, иначе — левее
function chains(commits, pinned) {
  const byHash = new Map(commits.filter((c) => !c.stash).map((c) => [c.hash, c]));
  const tips = pinned.filter((h) => byHash.has(h));
  const k = tips.length;
  const path = (tip) => {
    const out = [];
    for (let h = tip; h !== undefined && byHash.has(h) && !out.includes(h); h = byHash.get(h).parents[0]) out.push(h);
    return out;
  };
  const paths = tips.map(path);
  // i раньше j, если вершина i — на цепочке j (и вершины разные); иначе по номеру
  const before = (i, j) => tips[i] !== tips[j] && paths[j].includes(tips[i]);
  const order = [];
  const rest = tips.map((_, i) => i);
  while (rest.length) {
    const i = rest.find((x) => !rest.some((y) => y !== x && before(y, x)));
    order.push(i);
    rest.splice(rest.indexOf(i), 1);
  }
  const lane = new Map();
  for (const i of order) for (const h of paths[i]) if (!lane.has(h)) lane.set(h, i);
  return { lane, k };
}

function invariants(what, commits, g, pinned) {
  const { lane, k } = chains(commits, pinned);
  for (const n of g.nodes) {
    if (lane.has(n.hash)) {
      if (n.lane !== lane.get(n.hash)) fail(`${what}: коммит цепочки не на своей дорожке`, n.hash, n.lane, lane.get(n.hash));
    } else if (n.lane < k && !n.wip) fail(`${what}: чужой узел на закреплённой дорожке`, n.hash, n.lane, k);
  }
  const at = new Map(g.nodes.map((n) => [`${n.lane}:${n.row}`, n]));
  for (const e of g.edges) {
    for (let row = e.from.row + 1; row < e.to.row; row++) {
      const n = at.get(`${e.travel}:${row}`);
      if (n) fail(`${what}: ребро проходит через узел`, e.id, n.hash);
    }
  }
  ok(`${what}: дорожек не меньше k`, g.laneCount >= k);
  tailInvariants(what, g);
  railInvariants(what, g, k);
  count += 3;
}

// Рельсы (главные ветки не сливаются): у каждой закреплённой дорожки, чья цепочка ушла в общую историю, линия идёт
// дальше вниз по своей дорожке — до корня или до края графа; на этом пути на её дорожке нет узлов
function railInvariants(what, g, k) {
  const rails = g.rails ?? [];
  if (k === 0 && rails.length) fail(`${what}: рельсы без главных веток`);
  const byHash = new Map(g.nodes.map((n) => [n.hash, n]));
  const seen = new Set();
  for (const r of rails) {
    if (r.lane >= k) fail(`${what}: рельс не на закреплённой дорожке`, r.id);
    if (seen.has(r.lane)) fail(`${what}: два рельса на дорожке`, r.id);
    seen.add(r.lane);
    if (r.from.lane === r.lane) fail(`${what}: рельс от своего узла`, r.id);
    const bottom = r.to ? r.to.row : Infinity;
    const hit = g.nodes.find((n) => n.lane === r.lane && n.row > r.from.row && n.row < bottom);
    if (hit) fail(`${what}: рельс проходит через узел`, r.id, hit.hash);
    if (r.to && r.to.parents.length && byHash.has(r.to.parents[0])) fail(`${what}: рельс кончается не в корне`, r.id);
  }
  count += 1;
}

// Хвосты (шаг 4.1): у каждого коммита столько хвостов, сколько незагруженных родителей; ниже начала хвоста на его дорожке
// нет узлов — линия идёт до края графа, не задевая чужих коммитов
function tailInvariants(what, g) {
  const loaded = new Set(g.nodes.map((n) => n.hash));
  const tailsFrom = new Map();
  for (const t of g.tails) tailsFrom.set(t.from.hash, (tailsFrom.get(t.from.hash) ?? 0) + 1);
  for (const n of g.nodes) {
    const want = n.parents.filter((p) => !loaded.has(p)).length;
    if ((tailsFrom.get(n.hash) ?? 0) !== want) fail(`${what}: хвостов у узла`, n.hash, tailsFrom.get(n.hash) ?? 0, want);
  }
  for (const t of g.tails) {
    const hit = g.nodes.find((n) => n.lane === t.travel && n.row > t.from.row);
    if (hit) fail(`${what}: хвост проходит через узел`, t.id, hit.hash);
  }
  count += 2;
}

const day = (i, n) => new Date(Date.UTC(2026, 0, 1) + (n - i) * 3600_000).toISOString();
for (let round = 0; round < 400; round++) {
  const n = 1 + Math.floor(rnd() * 300);
  const commits = dag(n, rnd() * 0.4, rnd() * 0.05);
  if (round % 3 === 0) commits.unshift({ hash: 'WIP', wip: true, parents: [commits[Math.floor(rnd() * Math.min(3, n))].hash] });
  const plain = summary(layoutGraph(commits));
  tailInvariants(`без закрепления ${round}`, layoutGraph(commits));
  if (summary(layoutGraph(commits, {})) !== plain) fail('без pinned');
  if (summary(layoutGraph(commits, { pinned: [] })) !== plain) fail('pinned: []');
  count += 2;
  // Вершины: случайные коммиты, иногда повтор, незагруженный хэш и коммит, уже занятый более ранней цепочкой
  const real = commits.filter((c) => !c.wip);
  const pinned = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => (rnd() < 0.1 ? 'outside' : real[Math.floor(rnd() * real.length)].hash));
  const g = layoutGraph(commits, { pinned });
  invariants(`граф ${round}`, commits, g, pinned);
  // WIP на вершине главной ветки — на её дорожке
  if (commits[0].wip) {
    const parent = g.nodes.find((x) => x.hash === commits[0].parents[0]);
    const { lane } = chains(commits, pinned);
    if (lane.has(parent.hash) && pinned.includes(parent.hash) && g.nodes[0].lane !== parent.lane) fail('WIP не над вершиной главной ветки', round);
  }
  // То же со stash: строки stash не занимают закреплённые дорожки и не ложатся на рёбра
  const dated = real.map((c, i) => ({ ...c, date: day(i, n), refs: [] }));
  const stashes = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => {
    const base = dated[Math.floor(rnd() * dated.length)];
    return { id: `stash@{${i}}`, hash: `s${round}_${i}`, message: 'm', date: day(Math.floor(rnd() * n), n), base: base.hash };
  });
  const rows = withStashes(dated, stashes, (s) => s.hash);
  const gs = layoutGraph(rows, { pinned });
  invariants(`stash ${round}`, rows, gs, pinned);
  if (summary(layoutGraph(rows, { pinned: [] })) !== summary(layoutGraph(rows))) fail('stash: pinned: []');
}

// Пример из плана: фича новее main. Без закрепления main прыгает с дорожки 1 на 0, с ним — все M* на 0, все F* на 1
const example = [
  { hash: 'F2', parents: ['F1'] },
  { hash: 'M3', parents: ['M2'] },
  { hash: 'F1', parents: ['M1'] },
  { hash: 'M2', parents: ['M1'] },
  { hash: 'M1', parents: ['M0'] },
  { hash: 'M0', parents: [] },
];
const lanesOf = (g) => Object.fromEntries(g.nodes.map((x) => [x.hash, x.lane]));
eq('пример без закрепления', lanesOf(layoutGraph(example)), { F2: 0, M3: 1, F1: 0, M2: 1, M1: 0, M0: 0 });
eq('пример с pinned M3', lanesOf(layoutGraph(example, { pinned: ['M3'] })), { F2: 1, M3: 0, F1: 1, M2: 0, M1: 0, M0: 0 });
// develop ответвился от main: обе прямые, ребро develop идёт по своей дорожке и поворачивает у коммита main
const twoMains = [
  { hash: 'D2', parents: ['D1'] },
  { hash: 'M2', parents: ['M1'] },
  { hash: 'D1', parents: ['M1'] },
  { hash: 'M1', parents: ['M0'] },
  { hash: 'M0', parents: [] },
];
const tm = layoutGraph(twoMains, { pinned: ['M2', 'D2'] });
eq('main и develop', lanesOf(tm), { D2: 1, M2: 0, D1: 1, M1: 0, M0: 0 });
eq('develop → main по своей дорожке', tm.edges.find((e) => e.id === 'D1->M1').travel, 1);
eq('дорожек 2', tm.laneCount, 2);
// Дорожка develop не сливается с main: ниже M1 она продолжается до корня M0
const railsOf = (g) => (g.rails ?? []).map((r) => [r.lane, r.from.hash, r.to?.hash ?? null]);
eq('develop не сливается с main', railsOf(tm), [[1, 'M1', 'M0']]);
eq('без главных веток рельсов нет', layoutGraph(twoMains).rails, undefined);
// develop на один коммит впереди master (как на снимке): обе линии до низа
const ahead = [{ hash: 'D3', parents: ['M2'] }, ...twoMains.filter((c) => c.hash !== 'D2' && c.hash !== 'D1')];
eq('develop впереди master', railsOf(layoutGraph(ahead, { pinned: ['M2', 'D3'] })), [[1, 'M2', 'M0']]);
eq('develop впереди master, develop левее', railsOf(layoutGraph(ahead, { pinned: ['D3', 'M2'] })), [[0, 'M2', 'M0']]);
// История загружена не вся — рельс до края графа
eq('рельс до края', railsOf(layoutGraph(ahead.slice(0, -1), { pinned: ['M2', 'D3'] })), [[1, 'M2', null]]);
// Перестановка меняет дорожки местами: первой стала develop, общая история (M1, M0) теперь в её цепочке
eq('перестановка', lanesOf(layoutGraph(twoMains, { pinned: ['D2', 'M2'] })), { D2: 0, M2: 1, D1: 0, M1: 0, M0: 0 });
// Вершина на цепочке другой главной ветки (M1 — предок M2) всё равно получает свою дорожку: общая история — её,
// у M2 остаётся только M2, и линия M2 поворачивает к M1; develop ответвился от M1 и тоже идёт к дорожке 1
const occupied = layoutGraph(twoMains, { pinned: ['M2', 'M1', 'D2'] });
eq('вершина-предок', lanesOf(occupied), { D2: 2, M2: 0, D1: 2, M1: 1, M0: 1 });
eq('вершина-предок: ребро M2 по своей дорожке', occupied.edges.find((e) => e.id === 'M2->M1').travel, 0);
eq('вершина-предок: дорожки по порядку', occupied.pinnedLanes, [0, 1, 2]);
// Ветка влита в main перемоткой (rust-migration — предок main): у каждой своя дорожка в любом порядке
const ff = [
  { hash: 'M2', parents: ['M1'] },
  { hash: 'M1', parents: ['R2'] },
  { hash: 'R2', parents: ['R1'] },
  { hash: 'R1', parents: ['R0'] },
  { hash: 'R0', parents: [] },
];
eq('перемотка: main левее', lanesOf(layoutGraph(ff, { pinned: ['M2', 'R2'] })), { M2: 0, M1: 0, R2: 1, R1: 1, R0: 1 });
eq('перемотка: main правее', lanesOf(layoutGraph(ff, { pinned: ['R2', 'M2'] })), { M2: 1, M1: 1, R2: 0, R1: 0, R0: 0 });
eq('перемотка: дорожек 2', layoutGraph(ff, { pinned: ['M2', 'R2'] }).laneCount, 2);
// Одна вершина у двух веток (develop только что создан от main): дорожка второй остаётся за ней, чужие ветки её не берут
const same = [{ hash: 'F1', parents: ['M1'] }, ...twoMains.slice(1)];
const sg = layoutGraph(same, { pinned: ['M2', 'M2'] });
eq('одна вершина', lanesOf(sg), { F1: 2, M2: 0, D1: 3, M1: 0, M0: 0 });
eq('одна вершина: дорожки', sg.pinnedLanes, [0, 1]);
eq('одна вершина: вторая дорожка не пустая', railsOf(sg), [[1, 'M2', 'M0']]);
eq('незагруженная вершина', layoutGraph(twoMains, { pinned: ['X', 'D2'] }).pinnedLanes, [-1, 0]);
// WIP на вершине main — над ней
const wipOnMain = [{ hash: 'WIP', wip: true, parents: ['M2'] }, ...twoMains];
eq('WIP над main', lanesOf(layoutGraph(wipOnMain, { pinned: ['M2', 'D2'] })).WIP, 0);
// Новый коммит в фича-ветке не сдвигает главные
const feature = [{ hash: 'F1', parents: ['D2'] }, ...twoMains];
eq('фича правее главных', lanesOf(layoutGraph(feature, { pinned: ['M2', 'D2'] })), { F1: 2, D2: 1, M2: 0, D1: 1, M1: 0, M0: 0 });

// Выбор веток
eq('авто: main и develop', autoMainBranches(['feature', 'develop', 'main'], []), ['main', 'develop']);
eq('авто: master с сервера, dev', autoMainBranches(['dev'], ['master', 'trunk']), ['master', 'dev']);
eq('авто: ничего', autoMainBranches(['feature'], ['x']), []);
eq('нормализация', normalizeMainBranches(['main', 'main', '', 5, null, 'dev', 'a', 'b', 'c', 'd']), ['main', 'dev', 'a', 'b', 'c']);
eq('нормализация не массива', normalizeMainBranches({ main: 1 }), []);

const linear = ['c4', 'c3', 'c2', 'c1'].map((h, i, a) => ({ hash: h, parents: a[i + 1] ? [a[i + 1]] : [] }));
const repoOf = (local, remotes) => ({ localBranches: local, remotes, commits: linear });
eq('локальная', resolveMainTips(['main'], repoOf([{ name: 'main', hash: 'c3' }], [])), [{ name: 'main', hash: 'c3' }]);
eq('только на сервере', resolveMainTips(['main'], repoOf([], [{ name: 'origin', branches: [{ name: 'main', hash: 'c2' }] }])), [{ name: 'main', hash: 'c2' }]);
eq('сначала origin', resolveMainTips(['main'], repoOf([], [{ name: 'up', branches: [{ name: 'main', hash: 'c1' }] }, { name: 'origin', branches: [{ name: 'main', hash: 'c2' }] }])), [{ name: 'main', hash: 'c2' }]);
eq('локальная отстала — серверная', resolveMainTips(['main'], repoOf([{ name: 'main', hash: 'c2' }], [{ name: 'origin', branches: [{ name: 'main', hash: 'c4' }] }])), [{ name: 'main', hash: 'c4' }]);
eq('локальная впереди — локальная', resolveMainTips(['main'], repoOf([{ name: 'main', hash: 'c4' }], [{ name: 'origin', branches: [{ name: 'main', hash: 'c2' }] }])), [{ name: 'main', hash: 'c4' }]);
eq('нет ветки или не загружена — пропуск', resolveMainTips(['x', 'main', 'old'], repoOf([{ name: 'main', hash: 'c1' }, { name: 'old', hash: 'zz' }], [])), [{ name: 'main', hash: 'c1' }]);
eq('без репозитория', resolveMainTips(['main'], null), []);

console.log(`graph-main-branches: совпало ${count} проверок`);
