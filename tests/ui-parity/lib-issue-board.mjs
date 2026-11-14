// Новое в 2.0: проверка src/lib/issueBoard.ts (доска задач): columnsFor, columnOf, patchForMove и хранение колонок.
// Эталона в 1.x нет — ожидаемые значения записаны здесь, плюс случайные проверки свойств.
// node tests/ui-parity/lib-issue-board.mjs <корень репозитория>
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot] = process.argv.slice(2);
if (!repoRoot) throw new Error('usage: node tests/ui-parity/lib-issue-board.mjs <корень репозитория>');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const board = await import(pathToFileURL(path.join(repoRoot, 'src/lib/issueBoard.ts')).href);
const lib = await import(pathToFileURL(path.join(repoRoot, 'src/lib/issues.ts')).href);
let checks = 0;
const eq = (a, b, msg) => {
  checks += 1;
  assert.deepEqual(a, b, msg);
};

const label = (name) => ({ id: `id-${name}`, name, color: '#888888', description: null });
const issue = (number, state, ...labels) => ({ number, state, labels: labels.map(label) });
const ids = (cols) => cols.map((c) => `${c.id}:${c.items.map((i) => i.number).join('+')}`);

/* ---------- columnsFor ---------- */

const issues = [issue(1, 'open'), issue(2, 'open', 'doing'), issue(3, 'closed', 'doing'), issue(4, 'open', 'review', 'doing'), issue(5, 'open', 'Review'), issue(6, 'open', 'other')];
eq(ids(board.columnsFor(issues, [])), ['open:1+2+4+5+6', 'closed:3'], 'без колонок-меток');
eq(ids(board.columnsFor(issues, ['doing', 'review'])), ['open:1+6', 'label:doing:2+4', 'label:review:5', 'closed:3'], 'первая подходящая по порядку колонок; закрытая — в «Закрытые»');
eq(ids(board.columnsFor(issues, ['review', 'doing'])), ['open:1+6', 'label:review:4+5', 'label:doing:2', 'closed:3'], 'порядок колонок решает');
eq(ids(board.columnsFor(issues, ['doing', 'DOING', '', 5])), ['open:1+5+6', 'label:doing:2+4', 'closed:3'], 'повторы и мусор отброшены');
eq(board.normalizeColumns(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).length, 8, 'не больше 8');

/* ---------- patchForMove: четыре случая ---------- */

const cols = ['doing', 'review'];
const known = [label('doing'), label('review'), label('bug')];
// В «Закрытые»
eq(board.patchForMove(issue(1, 'open', 'doing', 'bug'), 'label:doing', 'closed', cols, known), { state: 'closed' });
// Из «Закрытых» в колонку-метку — открыть и поставить метку
eq(board.patchForMove(issue(1, 'closed', 'bug'), 'closed', 'label:review', cols, known), { state: 'open', labels: [{ id: 'id-bug', name: 'bug' }, { id: 'id-review', name: 'review' }] });
// Из «Закрытых» в «Открытые» — открыть, метки-колонки снять
eq(board.patchForMove(issue(1, 'closed', 'doing', 'bug'), 'closed', 'open', cols, known), { state: 'open', labels: [{ id: 'id-bug', name: 'bug' }] });
// Между метками — старая снята, новая поставлена, остальные на месте
eq(board.patchForMove(issue(1, 'open', 'bug', 'doing'), 'label:doing', 'label:review', cols, known), { labels: [{ id: 'id-bug', name: 'bug' }, { id: 'id-review', name: 'review' }] });
// В «Открытые» — сняты все метки-колонки
eq(board.patchForMove(issue(1, 'open', 'doing', 'review', 'bug'), 'label:doing', 'open', cols, known), { labels: [{ id: 'id-bug', name: 'bug' }] });
// Без изменений
eq(board.patchForMove(issue(1, 'open'), 'open', 'open', cols, known), null);
eq(board.patchForMove(issue(1, 'closed'), 'label:doing', 'closed', cols, known), null);
// Метки нет в справочнике — по имени
eq(board.patchForMove(issue(1, 'open'), 'open', 'label:doing', cols, []), { labels: [{ id: 'doing', name: 'doing' }] });

/* ---------- Свойство: после переноса задача оказывается в целевой колонке ---------- */

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
const names = ['doing', 'review', 'qa', 'bug', 'ui'];
for (let n = 0; n < 3000; n++) {
  const columns = names.filter(() => rnd() < 0.5).slice(0, 3);
  const all = ['open', ...columns.map((c) => `label:${c}`), 'closed'];
  const it = issue(n, rnd() < 0.3 ? 'closed' : 'open', ...names.filter(() => rnd() < 0.3));
  const from = board.columnOf(it, columns);
  eq(ids(board.columnsFor([it], columns)).find((s) => !s.endsWith(':')).split(':' + n)[0], from, 'columnOf = columnsFor');
  const to = all[Math.floor(rnd() * all.length)];
  const patch = board.patchForMove(it, from, to, columns, names.map(label));
  const moved = patch ? lib.applyPatch({ ...it, closedAt: null, stateReason: null, assignees: [], milestone: null }, patch, { labels: names.map(label), milestones: [], members: [], me: null, templates: [] }) : it;
  eq(board.columnOf(moved, columns), to === from ? from : to, `перенос ${from} → ${to}`);
  // Метки не из колонок не трогаются
  const keep = (x) => x.labels.map((l) => l.name).filter((nm) => !columns.includes(nm)).sort();
  eq(keep(moved), keep(it));
}

/* ---------- Хранение ---------- */

eq(board.readBoardColumns('C:/r'), []);
board.writeBoardColumns('C:/r', ['doing', 'doing', 'review']);
eq(store.get('issues.board.v1:C:/r'), '["doing","review"]');
eq(board.readBoardColumns('C:/r'), ['doing', 'review']);
store.set('issues.board.v1:C:/r', '{битый');
eq(board.readBoardColumns('C:/r'), []);
board.writeBoardColumns('C:/r', []);
eq(store.has('issues.board.v1:C:/r'), false);

console.log(`lib-issue-board: ${checks} проверок прошли`);
