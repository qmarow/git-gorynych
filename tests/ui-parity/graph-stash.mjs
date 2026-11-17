// Stash в графе (src/lib/graphStash.ts + layoutGraph): место строки, пропуск stash без своего коммита, дорожка и пунктир.
// Это новая возможность 2.0, прежней копии нет: проверяются ожидаемые раскладки.
// node tests/ui-parity/graph-stash.mjs <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup } from './hooks.mjs';

const [repo] = process.argv.slice(2);
setup(repo);
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { withStashes } = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphStash.ts')).href);
const { layoutGraph, laneColor } = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphLayout.ts')).href);

let count = 0;
const eq = (what, a, b) => {
  count++;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    console.error('РАСХОЖДЕНИЕ', what, '\nполучено: ', ja, '\nожидалось:', jb);
    process.exit(1);
  }
};
const day = (d) => `2026-11-${String(d).padStart(2, '0')}T12:00:00Z`;
// Линейная история c5 → c1 (c5 новее), дни 5…1
const linear = [5, 4, 3, 2, 1].map((d) => ({ hash: `c${d}`, parents: d > 1 ? [`c${d - 1}`] : [], date: day(d), refs: [] }));
const st = (id, hash, base, d) => ({ id: `stash@{${id}}`, hash, message: `On main: ${hash}`, date: day(d), base });
const order = (rows) => rows.map((r) => r.hash);
const title = (s) => s.hash;

eq('без stash — тот же массив', withStashes(linear, [], title) === linear, true);
eq('stash на HEAD сегодня — над HEAD', order(withStashes(linear, [st(0, 's0', 'c5', 6)], title)), ['stash:s0', 'c5', 'c4', 'c3', 'c2', 'c1']);
eq('stash на c3 между c4 и c3 по времени', order(withStashes(linear, [st(0, 's0', 'c3', 3.5)], title)), ['c5', 'c4', 'stash:s0', 'c3', 'c2', 'c1']);
eq('новый stash на старом коммите — по времени, наверху', order(withStashes(linear, [st(0, 's0', 'c2', 9)], title)), ['stash:s0', 'c5', 'c4', 'c3', 'c2', 'c1']);
eq('дата старше коммита — не ниже своего коммита', order(withStashes(linear, [st(0, 's0', 'c4', 1)], title)), ['c5', 'stash:s0', 'c4', 'c3', 'c2', 'c1']);
eq('коммит не загружен — stash не в графе', order(withStashes(linear, [st(0, 's0', 'old', 6), st(1, 's1', null, 6)], title)), order(linear));
eq('два на одном месте — новый выше', order(withStashes(linear, [st(1, 'older', 'c5', 6), st(0, 'newer', 'c5', 7)], title)), ['stash:newer', 'stash:older', 'c5', 'c4', 'c3', 'c2', 'c1']);
eq('равное время — порядок списка', order(withStashes(linear, [st(0, 'a', 'c5', 6), st(1, 'b', 'c5', 6)], title)), ['stash:a', 'stash:b', 'c5', 'c4', 'c3', 'c2', 'c1']);
eq('без даты — над своим коммитом', order(withStashes(linear, [{ ...st(0, 's0', 'c3', 1), date: '' }], title)), ['c5', 'c4', 'stash:s0', 'c3', 'c2', 'c1']);

// После rebase: дата автора верхнего коммита месячной давности, дата коммита свежая (по ней упорядочен граф). Stash недельной
// давности на старом коммите встаёт ниже верхнего коммита, а не над ним, как было бы по дате автора
const rebased = [
  { hash: 'top', parents: ['c2'], date: '2026-10-12T12:00:00Z', commitDate: '2026-11-12T12:00:00Z', refs: [] },
  { hash: 'c2', parents: ['c1'], date: '2026-10-23T12:00:00Z', commitDate: '2026-10-23T12:00:00Z', refs: [] },
  { hash: 'c1', parents: [], date: '2026-10-18T12:00:00Z', commitDate: '2026-10-18T12:00:00Z', refs: [] },
];
const weekOld = { id: 'stash@{0}', hash: 's0', message: 'On main: s0', date: '2026-11-05T12:00:00Z', base: 'c1' };
eq('после rebase — по дате коммита, ниже верхнего', order(withStashes(rebased, [weekOld], title)), ['top', 'stash:s0', 'c2', 'c1']);

const row = withStashes(linear, [st(2, 's0', 'c3', 3.5)], () => 'Заголовок')[2];
eq('строка stash', { hash: row.hash, parents: row.parents, message: row.message, description: row.description, refs: row.refs, isHead: row.isHead, id: row.stash.id }, { hash: 'stash:s0', parents: ['c3'], message: 'Заголовок', description: 'On main: s0', refs: [], isHead: false, id: 'stash@{2}' });

// Раскладка: stash в своей дорожке, пунктир идёт по ней до коммита, линия ветки остаётся сплошной
const wip = { hash: 'WIP', wip: true, parents: ['c5'] };
const g = layoutGraph([wip, ...withStashes(linear, [st(0, 's0', 'c5', 6)], title)]);
const node = (h) => g.nodes.find((n) => n.hash === h);
const edge = (id) => g.edges.find((e) => e.id === id);
eq('WIP, stash, HEAD — строки', [node('WIP').row, node('stash:s0').row, node('c5').row], [0, 1, 2]);
eq('stash в своей дорожке', [node('WIP').lane, node('stash:s0').lane, node('c5').lane], [0, 1, 0]);
eq('ребро stash — пунктир по своей дорожке', { travel: edge('stash:s0->c5').travel, dashed: edge('stash:s0->c5').dashed }, { travel: 1, dashed: true });
eq('ветка — сплошная', edge('c5->c4').dashed, false);
eq('дорожек 2', g.laneCount, 2);

// Stash далеко над своим коммитом: линия занимает дорожку до него и не ложится на ветку
const far = layoutGraph(withStashes(linear, [st(0, 's0', 'c3', 9)], title));
const fe = far.edges.find((e) => e.id === 'stash:s0->c3');
eq('дальний stash', { lane: far.nodes[0].lane, travel: fe.travel, to: fe.to.hash, dashed: fe.dashed }, { lane: 1, travel: 1, to: 'c3', dashed: true });
eq('ветка под ним в дорожке 0', far.nodes.filter((n) => !n.stash).map((n) => n.lane), [0, 0, 0, 0, 0]);

// Параллельная ветка правее коммита занята: stash уходит ещё правее, ветки не сдвигаются
const branchy = [
  { hash: 'c5', parents: ['c4'], date: day(5) },
  { hash: 'f2', parents: ['f1'], date: day(4.5) },
  { hash: 'c4', parents: ['c3'], date: day(4) },
  { hash: 'f1', parents: ['c3'], date: day(3.5) },
  { hash: 'c3', parents: [], date: day(3) },
];
const plain = layoutGraph(branchy).nodes.map((n) => [n.hash, n.lane]);
const bg = layoutGraph(withStashes(branchy, [st(0, 's0', 'c4', 9)], title));
eq('ветки на тех же дорожках', bg.nodes.filter((n) => !n.stash).map((n) => [n.hash, n.lane]), plain);
eq('stash правее занятой дорожки', bg.nodes[0].lane, 2);
eq('дорожек 3', bg.laneCount, 3);

// Хвост: коммит с незагруженным родителем — линия до края, stash в её дорожку не встаёт
const cut = layoutGraph([...linear.slice(0, 3)]);
eq('хвост к незагруженному родителю', cut.tails.map((t) => [t.id, t.from.hash, t.travel, t.dashed]), [['c3->c2', 'c3', 0, false]]);
eq('рёбер к нему нет', cut.edges.map((e) => e.id), ['c5->c4', 'c4->c3']);
const tailed = [
  { hash: 'c5', parents: ['c4'], date: day(5) },
  { hash: 'f1', parents: ['gone'], date: day(4.5) },
  { hash: 'c4', parents: ['c3'], date: day(4) },
  { hash: 'c3', parents: [], date: day(3) },
];
const tg = layoutGraph(withStashes(tailed, [st(0, 's0', 'c3', 9)], title));
eq('хвост f1 в дорожке 1, stash правее', [tg.tails[0].travel, tg.tails[0].from.row, tg.nodes[0].lane], [1, 2, 2]);

// Подбор дорожки stash по интервалам занятости = прежний перебор всех узлов, рёбер и хвостов на каждую пробу
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function dag(n, mergeRate, gapRate) {
  const hashes = Array.from({ length: n }, (_, i) => `h${i.toString(16).padStart(6, '0')}`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const parents = [];
    const older = n - i - 1;
    if (older > 0 && rnd() > 0.02) {
      parents.push(hashes[i + 1 + Math.floor(rnd() * Math.min(older, rnd() < 0.7 ? 2 : 30))]);
      while (rnd() < mergeRate && parents.length < 3) parents.push(hashes[i + 1 + Math.floor(rnd() * older)]);
    }
    if (rnd() < gapRate) parents.push('outside' + i);
    out.push({ hash: hashes[i], parents, date: new Date(Date.UTC(2026, 0, 1) + (n - i) * 3600_000).toISOString(), refs: [] });
  }
  return out;
}
// Число закреплённых дорожек — как в layoutGraph: у каждой загруженной вершины своя дорожка (даже у общей или вершины-предка)
function pinnedCount(real, pinned) {
  const loaded = new Set(real.map((c) => c.hash));
  return (pinned ?? []).filter((tip) => loaded.has(tip)).length;
}
// Прежняя реализация layoutWithStashes дословно (с хвостами из шага 4.1), busy — перебором
function reference(commits, options) {
  const real = commits.filter((c) => !c.stash);
  const base = layoutGraph(real, options);
  const k = pinnedCount(real, options?.pinned);
  const rowOf = new Map(commits.map((c, i) => [c.hash, i]));
  const byHash = new Map(base.nodes.map((n) => [n.hash, { ...n, row: rowOf.get(n.hash) }]));
  const edges = base.edges.map((e) => {
    const from = byHash.get(e.from.hash);
    const to = byHash.get(e.to.hash);
    return { ...e, from, to, minRow: from.row, maxRow: to.row };
  });
  const tails = base.tails.map((t) => ({ ...t, from: byHash.get(t.from.hash) }));
  const nodes = [...byHash.values()];
  const side = [];
  const busy = (lane, top, bottom) =>
    nodes.some((n) => n.lane === lane && n.row >= top && n.row <= bottom) ||
    edges.some((e) => e.travel === lane && e.maxRow > top && e.minRow < bottom) ||
    tails.some((t) => t.travel === lane && t.from.row < bottom) ||
    side.some((x) => x.lane === lane && x.bottom >= top && x.top <= bottom);
  let laneCount = base.laneCount;
  const out = commits.map((commit, row) => {
    if (!commit.stash) return byHash.get(commit.hash);
    const target = byHash.get(commit.parents[0]);
    let lane = Math.max(target ? target.lane + 1 : 0, k);
    const bottom = target?.row ?? row;
    while (busy(lane, row, bottom)) lane++;
    side.push({ lane, top: row, bottom });
    laneCount = Math.max(laneCount, lane + 1);
    const node = { ...commit, row, lane };
    if (target) edges.push({ id: `${commit.hash}->${target.hash}`, from: node, to: target, travel: lane, minRow: row, maxRow: target.row, dashed: true, color: laneColor(lane) });
    return node;
  });
  return { ...base, nodes: out, edges, tails, laneCount };
}
const summary = (g) =>
  JSON.stringify({
    nodes: g.nodes,
    edges: g.edges.map((e) => ({ ...e, from: e.from.hash, to: e.to.hash })),
    tails: g.tails.map((t) => ({ ...t, from: t.from.hash })),
    laneCount: g.laneCount,
  });
let compared = 0;
for (let round = 0; round < 300; round++) {
  const n = 2 + Math.floor(rnd() * 250);
  const real = dag(n, rnd() * 0.4, rnd() * 0.06);
  const stashes = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({
    id: `stash@{${i}}`,
    hash: `s${i}`,
    message: 'm',
    date: real[Math.floor(rnd() * n)].date,
    base: real[Math.floor(rnd() * n)].hash,
  }));
  const rows = withStashes(real, stashes, title);
  const options = round % 3 === 0 ? { pinned: [real[0].hash, real[Math.floor(rnd() * n)].hash] } : undefined;
  const a = summary(layoutGraph(rows, options));
  const b = summary(reference(rows, options));
  if (a !== b) {
    console.error('РАСХОЖДЕНИЕ stash: интервалы и перебор, граф', round, '\nновое:', a.slice(0, 400), '\nпрежнее:', b.slice(0, 400));
    process.exit(1);
  }
  compared++;
}
count += compared;

// Замер: 40 stash на 20 000 коммитов — не больше чем вдвое медленнее раскладки без stash
const big = dag(20000, 0.03, 0.001);
const bigStashes = Array.from({ length: 40 }, (_, i) => ({ id: `stash@{${i}}`, hash: `b${i}`, message: 'm', date: big[Math.floor(rnd() * 20000)].date, base: big[Math.floor(rnd() * 20000)].hash }));
const bigRows = withStashes(big, bigStashes, title);
const median = (fn) => {
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((x, y) => x - y)[4];
};
median(() => layoutGraph(big));
const plainMs = median(() => layoutGraph(big));
const stashMs = median(() => layoutGraph(bigRows));
console.log(`замер: без stash ${plainMs.toFixed(1)} мс, 40 stash ${stashMs.toFixed(1)} мс (×${(stashMs / plainMs).toFixed(2)})`);
if (stashMs > plainMs * 2) {
  console.error('РАСХОЖДЕНИЕ замер: со stash больше чем вдвое медленнее');
  process.exit(1);
}

console.log(`graph-stash: совпало ${count} проверок`);
