// Сверка src/lib/graphLayout.ts и scheme.ts с прежними .js (из HEAD) на случайных графах коммитов.
// node compare.mjs <папка со старыми .js> <src/lib>
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [oldDir, newDir] = process.argv.slice(2);
const load = (dir, file) => import(pathToFileURL(path.join(dir, file)).href);
const oldG = await load(oldDir, 'graphLayout.js');
const newG = await load(newDir, 'graphLayout.ts');
const oldS = await load(oldDir, 'scheme.js');
const newS = await load(newDir, 'scheme.ts');

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// Случайный DAG в порядке «дети выше родителей»: у каждого коммита 0–3 родителя среди более старых
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
    // родитель за пределами истории
    if (rnd() < gapRate) parents.push('outside' + i);
    commits.push({ hash: hashes[i], parents, subject: 's' + i, ...(i === 0 && rnd() < 0.5 ? { wip: true } : {}) });
  }
  return commits;
}

const summary = (g) => JSON.stringify({
  nodes: g.nodes,
  edges: g.edges.map((e) => ({ ...e, from: e.from.hash, to: e.to.hash })),
  laneCount: g.laneCount,
});

let cases = 0;
const fail = (what, a, b) => {
  console.error('РАСХОЖДЕНИЕ', what, '\nстарое:', a.slice(0, 400), '\nновое:', b.slice(0, 400));
  process.exit(1);
};
const lanesSets = [undefined, [], ['#123', '#abcdef', '#3cf0a0'], 'не массив'];
for (let round = 0; round < 400; round++) {
  const scheme = round % 2 ? 'light' : 'dark';
  const lanes = lanesSets[round % lanesSets.length];
  oldS.setScheme(scheme, lanes);
  newS.setScheme(scheme, lanes);
  const commits = dag(1 + Math.floor(rnd() * 400), rnd() * 0.4, rnd() * 0.05);
  const a = oldG.layoutGraph(commits);
  const b = newG.layoutGraph(commits);
  const sa = summary(a), sb = summary(b);
  if (sa !== sb) fail('layoutGraph', sa, sb);
  for (const density of ['compact', 'standard', 'relaxed', 'нет', undefined]) {
    for (const width of [0, 40, 77, 150, 1000, NaN]) {
      const ma = oldG.fitMetrics(oldG.metricsFor(density), a.laneCount, width);
      const mb = newG.fitMetrics(newG.metricsFor(density), b.laneCount, width);
      if (JSON.stringify(ma) !== JSON.stringify(mb)) fail('fitMetrics', JSON.stringify(ma), JSON.stringify(mb));
      const pa = a.edges.map((e) => oldG.edgePath(e, ma)).join('|');
      const pb = b.edges.map((e) => newG.edgePath(e, mb)).join('|');
      if (pa !== pb) fail('edgePath', pa, pb);
      if (oldG.graphWidth(a.laneCount, ma) !== newG.graphWidth(b.laneCount, mb)) fail('graphWidth', '', '');
      for (let lane = 0; lane < 12; lane++) {
        if (oldG.laneX(lane, ma) !== newG.laneX(lane, mb) || oldG.laneColor(lane) !== newG.laneColor(lane)) fail('laneX/laneColor', '', '');
      }
    }
  }
  for (const color of ['#3cf0a0', '#f2ca33', '#fff', '#000000', '#15a0bf80', 'red', undefined, null, 5]) {
    if (oldS.readable(color) !== newS.readable(color)) fail('readable ' + color, String(oldS.readable(color)), String(newS.readable(color)));
  }
  if (oldS.isLight() !== newS.isLight() || JSON.stringify(oldS.laneColors()) !== JSON.stringify(newS.laneColors())) fail('scheme', '', '');
  cases++;
}
for (const name of ['GRAPH_PADDING', 'ROW_HEIGHT', 'LANE_WIDTH', 'NODE_RADIUS', 'DENSITIES', 'DEFAULT_METRICS', 'LANE_COLORS']) {
  if (JSON.stringify(oldG[name]) !== JSON.stringify(newG[name])) fail(name, JSON.stringify(oldG[name]), JSON.stringify(newG[name]));
}
const exportsOf = (m) => Object.keys(m).sort().join(',');
if (exportsOf(oldG) !== exportsOf(newG)) fail('экспорт graphLayout', exportsOf(oldG), exportsOf(newG));
if (exportsOf(oldS) !== exportsOf(newS)) fail('экспорт scheme', exportsOf(oldS), exportsOf(newS));
console.log(`совпало: ${cases} графов, ${cases * 30} сочетаний плотности и ширины`);
