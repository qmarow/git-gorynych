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

// Цепочки, посчитанные независимо от раскладки: хэш → номер дорожки
function chains(commits, pinned) {
  const byHash = new Map(commits.filter((c) => !c.stash).map((c) => [c.hash, c]));
  const lane = new Map();
  let k = 0;
  for (const tip of pinned) {
    if (!byHash.has(tip) || lane.has(tip)) continue;
    for (let h = tip; h !== undefined && byHash.has(h) && !lane.has(h); h = byHash.get(h).parents[0]) lane.set(h, k);
    k++;
  }
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
  count += 3;
}

const day = (i, n) => new Date(Date.UTC(2026, 0, 1) + (n - i) * 3600_000).toISOString();
for (let round = 0; round < 400; round++) {
  const n = 1 + Math.floor(rnd() * 300);
  const commits = dag(n, rnd() * 0.4, rnd() * 0.05);
  if (round % 3 === 0) commits.unshift({ hash: 'WIP', wip: true, parents: [commits[Math.floor(rnd() * Math.min(3, n))].hash] });
  const plain = summary(layoutGraph(commits));
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
// Перестановка меняет дорожки местами: первой стала develop, общая история (M1, M0) теперь в её цепочке
eq('перестановка', lanesOf(layoutGraph(twoMains, { pinned: ['D2', 'M2'] })), { D2: 0, M2: 1, D1: 0, M1: 0, M0: 0 });
// Вершина, уже занятая более ранней цепочкой, дорожку не получает: следующие сдвигаются
eq('занятая вершина', lanesOf(layoutGraph(twoMains, { pinned: ['M2', 'M1', 'D2'] })), { D2: 1, M2: 0, D1: 1, M1: 0, M0: 0 });
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
