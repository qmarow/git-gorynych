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
const { layoutGraph } = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphLayout.ts')).href);

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

console.log(`graph-stash: совпало ${count} проверок`);
