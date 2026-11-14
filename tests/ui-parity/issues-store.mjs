// Новое в 2.0: проверка src/state/issuesStore.ts (раздел «Задачи») на заглушке API, ответы которой тест отдаёт вручную и в
// любом порядке. Эталона в 1.x нет. Проверяются пять правил хранилища (последний запрос, свои правки, ошибка, другая
// вкладка, перезапуск), мгновенное применение и откат update, временный комментарий, отсев дублей loadMore, предел
// страниц refresh, карточки и meta; в конце — случайные сценарии с инвариантами.
// node tests/ui-parity/issues-store.mjs <корень репозитория> [сценариев]
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, countArg] = process.argv.slice(2);
if (!repoRoot) throw new Error('usage: node tests/ui-parity/issues-store.mjs <корень репозитория> [сценариев]');
const SCENARIOS = Number(countArg ?? 300);

const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
};
globalThis.window = {};

const { createIssuesStore, MAX_DETAILS, META_TTL, STATE_PREFIX } = await import(pathToFileURL(path.join(repoRoot, 'src/state/issuesStore.ts')).href);
const drafts = await import(pathToFileURL(path.join(repoRoot, 'src/lib/issueDrafts.ts')).href);
let checks = 0;
const eq = (actual, expected, label) => {
  checks += 1;
  assert.deepEqual(actual, expected, label);
};
const ok = (value, label) => {
  checks += 1;
  assert.ok(value, label);
};

/* ---------- Данные ---------- */

const user = (id) => ({ id, login: `u${id}`, name: null, avatarUrl: null, webUrl: null });
const issue = (number, extra = {}) => ({
  id: `id${number}`, number, title: `Задача ${number}`, body: '', state: 'open', stateReason: null, author: user('1'), assignees: [], labels: [], milestone: null,
  commentsCount: 0, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', closedAt: null, dueDate: null, confidential: false, locked: false, webUrl: `https://x/${number}`, ...extra,
});
const caps = { create: true, edit: true, comment: true, editComments: true, deleteComments: true, close: true, labels: true, createLabel: true, multipleAssignees: true, milestones: true, dueDate: true, confidential: true, lock: true, delete: true, events: true, textSearch: true, counts: true, closeReasons: [] };
const listOf = (numbers, page = 1, hasMore = false, counts = { open: 10, closed: 2 }) => ({ list: { items: numbers.map((n) => (typeof n === 'number' ? issue(n) : n)), page, hasMore, counts }, caps, provider: 'gitlab', label: 'GitLab', webUrl: 'https://x/issues' });
const meta = { labels: [{ id: '1', name: 'bug', color: '#ff0000', description: null }], milestones: [], members: [user('2')], me: user('9'), templates: [] };
const comment = (id, body = 'x') => ({ id, body, author: user('9'), createdAt: '2026-11-02T00:00:00Z', updatedAt: null, canEdit: true, webUrl: null });
const okRes = (data) => ({ ok: true, data });
const errRes = (code = 'NETWORK') => ({ ok: false, error: { code, message: code, hint: null, details: '' } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await tick();
};

/* ---------- Заглушка API ---------- */

function makeApi() {
  const calls = [];
  const api = {};
  for (const name of ['list', 'get', 'meta', 'create', 'update', 'commentAdd', 'commentUpdate', 'commentDelete', 'labelCreate', 'remove']) {
    api[name] = (...args) =>
      new Promise((resolve) => {
        calls.push({ name, args, resolve, done: false });
      });
  }
  /** Ответ на первый неотвеченный вызов `name` (или подходящий под `match`). */
  const answer = async (name, res, match = () => true) => {
    const call = calls.find((c) => !c.done && c.name === name && match(c.args));
    assert.ok(call, `нет ожидающего вызова ${name}: ${JSON.stringify(calls.filter((c) => !c.done).map((c) => c.name))}`);
    call.done = true;
    call.resolve(typeof res === 'function' ? res(call.args) : res);
    await settle();
    return call;
  };
  const waiting = (name) => calls.filter((c) => !c.done && (!name || c.name === name));
  return { api, calls, answer, waiting };
}

let clock = 1_000_000;
function makeStore() {
  const mock = makeApi();
  const store = createIssuesStore(() => mock.api, { now: () => clock });
  return { ...mock, store, s: () => store.getState(), repo: (p) => store.getState().byRepo[p] };
}
const P = 'C:/a';
const Q = 'C:/b';
const numbers = (repo) => repo.items.map((i) => i.number);

async function opened(p = P, list = listOf([1, 2, 3])) {
  const t = makeStore();
  const done = t.s().open(p);
  await settle();
  await t.answer('list', okRes(list));
  await t.answer('meta', okRes(meta));
  await done;
  return t;
}

/* ---------- Этап 7: вид, доска, bulkUpdate, refreshMine ---------- */
{
  local.clear();
  // Вид хранится в issues.state.v1 и возвращается после перезапуска
  let t = await opened();
  eq(t.repo(P).view, 'list', 'по умолчанию — список');
  t.s().setView(P, 'board');
  eq(JSON.parse(local.get(STATE_PREFIX + P)).view, 'board', 'вид сохранён');
  t = await opened();
  eq(t.repo(P).view, 'board', 'вид после перезапуска');
  t.s().setView(P, 'list');
  ok(!('view' in JSON.parse(local.get(STATE_PREFIX + P))), 'список — умолчание, не хранится');

  // Доска: открытые страницами по 100 (до трёх) с фильтром панели и 30 закрытых
  t = await opened();
  void t.s().setQuery(P, { labels: ['bug'], search: 'вход' });
  await settle();
  await t.answer('list', okRes(listOf([1])));
  const board = t.s().loadBoard(P);
  await settle();
  eq(t.repo(P).board.status, 'loading');
  const first = t.waiting('list')[0].args[1];
  eq([first.state, first.page, first.perPage, first.labels, first.search], ['open', 1, 100, ['bug'], 'вход'], 'фильтры панели — и на доске, состояние — своё');
  await t.answer('list', okRes(listOf(Array.from({ length: 100 }, (_, i) => i + 1), 1, true)));
  await t.answer('list', okRes(listOf(Array.from({ length: 100 }, (_, i) => i + 101), 2, true)));
  await t.answer('list', okRes(listOf(Array.from({ length: 100 }, (_, i) => i + 201), 3, true)));
  const closedCall = t.waiting('list')[0].args[1];
  eq([closedCall.state, closedCall.perPage], ['closed', 30], 'закрытые — 30 последних');
  await t.answer('list', okRes(listOf([issue(900, { state: 'closed' })])));
  await board;
  eq([t.repo(P).board.items.length, t.repo(P).board.truncated, t.repo(P).board.status], [301, true, 'idle'], 'больше 300 открытых — отметка');
  // Правка задачи меняет и доску, ошибка — откат
  const up = t.s().update(P, 5, { state: 'closed' });
  eq(t.repo(P).board.items.find((i) => i.number === 5).state, 'closed', 'доска — сразу');
  await settle();
  await t.answer('update', errRes());
  await up;
  eq(t.repo(P).board.items.find((i) => i.number === 5).state, 'open', 'доска — откат');
  // Ответ доски после смены пути не пишется
  const late = t.s().loadBoard(P);
  await settle();
  t.s().forget(P);
  await t.answer('list', okRes(listOf([1])));
  await late;
  eq(t.waiting('list').length, 0, 'после forget закрытые не запрашиваются');
  eq(t.repo(P), undefined, 'после forget — никуда');

  // bulkUpdate: по 4 одновременно, прогресс, ошибки отдельно
  t = await opened(P, listOf([1, 2, 3, 4, 5, 6, 7]));
  const bulk = t.s().bulkUpdate(P, [1, 2, 3, 4, 5, 6, 7], () => ({ state: 'closed' }));
  await settle();
  eq(t.waiting('update').length, 4, 'не больше 4 запросов сразу');
  eq(t.repo(P).bulk, { done: 0, total: 7, running: true });
  await t.answer('update', okRes(issue(1, { state: 'closed' })));
  eq(t.waiting('update').length, 4, 'место освободилось — следующий');
  eq(t.repo(P).bulk.done, 1, 'прогресс');
  await t.answer('update', errRes(), (a) => a[1] === 2);
  for (const n of [3, 4, 5, 6, 7]) await t.answer('update', okRes(issue(n, { state: 'closed' })), (a) => a[1] === n);
  const result = await bulk;
  eq([result.ok.sort(), result.failed, result.stopped], [[1, 3, 4, 5, 6, 7], [2], false], 'итог');
  eq(t.repo(P).bulk, null, 'прогресс снят');
  eq(t.repo(P).items.find((i) => i.number === 2).state, 'open', 'неудавшаяся — откатилась, остальные закрыты');
  eq(t.repo(P).items.filter((i) => i.state === 'closed').length, 6);
  // Пустая правка — без запроса, считается сделанной
  const none = t.s().bulkUpdate(P, [1, 2], (i) => (i.number === 1 ? null : { title: 'x' }));
  await settle();
  eq(t.waiting('update').map((c) => c.args[1]), [2], 'пустая правка — без запроса');
  await t.answer('update', okRes(issue(2, { title: 'x' })));
  eq((await none).ok.sort(), [1, 2]);
  // Остановка: начатые доходят, новые не начинаются
  t = await opened(P, listOf([1, 2, 3, 4, 5, 6, 7, 8]));
  const stopped = t.s().bulkUpdate(P, [1, 2, 3, 4, 5, 6, 7, 8], () => ({ state: 'closed' }));
  await settle();
  t.s().stopBulk(P);
  for (const n of [1, 2, 3, 4]) await t.answer('update', okRes(issue(n, { state: 'closed' })), (a) => a[1] === n);
  const stop = await stopped;
  eq([stop.ok.length, stop.failed.length, stop.stopped, t.waiting('update').length], [4, 0, true, 0], 'после «Остановить» новых запросов нет');

  // refreshMine: первый ответ только запоминается, потом — новые; без открытого раздела тоже
  t = makeStore();
  const firstMine = t.s().refreshMine(Q, 'origin');
  await settle();
  const mineCall = t.waiting('list')[0].args;
  eq([mineCall[1].assignee, mineCall[1].state, mineCall[1].perPage, mineCall[2]], ['@me', 'open', 100, { remote: 'origin' }], 'запрос назначенных');
  await t.answer('list', okRes(listOf([1, 2])));
  eq(await firstMine, [], 'первый ответ — без уведомлений');
  eq(t.s().mine[Q].map((i) => i.number), [1, 2], 'счётчик без открытого раздела');
  eq(t.repo(Q), undefined, 'раздел не создан');
  const second = t.s().refreshMine(Q, 'origin');
  await settle();
  await t.answer('list', okRes(listOf([2, 3])));
  eq((await second).map((i) => i.number), [3], 'новая назначенная');
  const failed = t.s().refreshMine(Q, 'origin');
  await settle();
  await t.answer('list', errRes('NO_TOKEN'));
  eq([await failed, t.s().mine[Q].length], [[], 2], 'ошибка молча, прежнее на месте');
  const lateMine = t.s().refreshMine(Q, 'origin');
  await settle();
  t.s().forget(Q);
  await t.answer('list', okRes(listOf([5])));
  eq([await lateMine, t.s().mine[Q]], [[], undefined], 'после forget не пишется');
}

/* ---------- open ---------- */
{
  local.clear();
  const t = makeStore();
  void t.s().open(P, 'upstream');
  await settle();
  eq(t.repo(P).listStatus, 'loading', 'первая загрузка');
  eq(t.waiting().map((c) => c.name).sort(), ['list', 'meta'], 'список и meta параллельно');
  eq(t.waiting('list')[0].args, [P, { state: 'open', search: null, labels: [], assignee: null, author: null, milestone: null, sort: 'updated', ascending: false, page: 1, perPage: 30 }, { remote: 'upstream' }], 'запрос списка');
  await t.answer('list', okRes(listOf([1, 2])));
  eq([numbers(t.repo(P)), t.repo(P).listStatus, t.repo(P).provider, t.repo(P).counts], [[1, 2], 'idle', 'gitlab', { open: 10, closed: 2 }], 'ответ списка');
  await t.answer('meta', okRes(meta));
  eq(t.repo(P).meta, meta, 'meta');
  // Повторное открытие: прежнее на экране, тихое обновление, meta свежая — без запроса
  void t.s().open(P);
  await settle();
  eq([t.repo(P).listStatus, numbers(t.repo(P)), t.waiting().map((c) => c.name)], ['idle', [1, 2], ['list']], 'повторное открытие тихо');
  await t.answer('list', okRes(listOf([3, 1, 2])));
  eq(numbers(t.repo(P)), [3, 1, 2], 'тихое обновление применено');
  clock += META_TTL;
  void t.s().open(P);
  await settle();
  eq(t.waiting().map((c) => c.name).sort(), ['list', 'meta'], 'meta устарела через 10 минут');
}

/* ---------- Правило 1: побеждает последний запрос ---------- */
{
  const t = await opened();
  void t.s().setQuery(P, { state: 'closed' });
  void t.s().setQuery(P, { state: null });
  await settle();
  eq(t.repo(P).listStatus, 'refreshing', 'прежние строки остаются, статус обновления');
  eq(numbers(t.repo(P)), [1, 2, 3], 'до ответа — прежние строки');
  eq(t.waiting('list').map((c) => c.args[1].state), ['closed', null], 'два запроса');
  await t.answer('list', okRes(listOf([20, 21])), (a) => a[1].state === null);
  eq(numbers(t.repo(P)), [20, 21], 'последний запрос применён');
  await t.answer('list', okRes(listOf([10])), (a) => a[1].state === 'closed');
  eq([numbers(t.repo(P)), t.repo(P).query.state, t.repo(P).listStatus], [[20, 21], null, 'idle'], 'устаревший ответ отброшен');
  // Устаревшая ошибка тоже не применяется
  void t.s().setQuery(P, { search: 'a' });
  void t.s().setQuery(P, { search: 'b' });
  await settle();
  await t.answer('list', okRes(listOf([5])), (a) => a[1].search === 'b');
  await t.answer('list', errRes(), (a) => a[1].search === 'a');
  eq([numbers(t.repo(P)), t.repo(P).listError], [[5], null], 'устаревшая ошибка отброшена');
  // Карточка: тоже последний запрос
  void t.s().select(P, 5);
  void t.s().select(P, 5);
  await settle();
  const gets = t.waiting('get');
  eq(gets.length, 2, 'два запроса карточки');
  gets[1].done = true;
  gets[1].resolve(okRes({ issue: issue(5, { title: 'новая' }), timeline: [], timelineTruncated: false }));
  await settle();
  gets[0].done = true;
  gets[0].resolve(okRes({ issue: issue(5, { title: 'старая' }), timeline: [], timelineTruncated: false }));
  await settle();
  eq(t.repo(P).details[5].detail.issue.title, 'новая', 'устаревшая карточка отброшена');
  eq(t.repo(P).items[0].title, 'новая', 'карточка обновила строку списка');
}

/* ---------- Правило 2: фоновое обновление не затирает свои правки ---------- */
{
  const t = await opened();
  const done = t.s().update(P, 2, { title: 'Моё' });
  await settle();
  eq(t.repo(P).pending, { 2: 1 }, 'pending');
  void t.s().refresh(P, { silent: true });
  await settle();
  await t.answer('list', okRes(listOf([1, issue(2, { title: 'С сервера, старое' }), 3, 4])));
  eq(t.repo(P).items.map((i) => i.title), ['Задача 1', 'Моё', 'Задача 3', 'Задача 4'], 'ответ списка не затёр правку, остальное обновлено');
  await t.answer('update', okRes(issue(2, { title: 'Моё', updatedAt: '2026-11-03T00:00:00Z' })));
  await done;
  eq([t.repo(P).pending, t.repo(P).items[1].updatedAt], [{}, '2026-11-03T00:00:00Z'], 'после ответа — данные сервера');
  void t.s().refresh(P, { silent: true });
  await settle();
  await t.answer('list', okRes(listOf([1, issue(2, { title: 'Чужая правка' })])));
  eq(t.repo(P).items[1].title, 'Чужая правка', 'без pending ответ списка применяется');
}

/* ---------- Правило 3: ошибка не стирает данные ---------- */
{
  const t = await opened();
  void t.s().select(P, 1);
  await settle();
  await t.answer('get', okRes({ issue: issue(1), timeline: [{ type: 'comment', ...comment('c1') }], timelineTruncated: false }));
  void t.s().refresh(P);
  await settle();
  eq(t.repo(P).listStatus, 'refreshing', 'обновление показанного списка');
  await t.answer('list', errRes('NETWORK'));
  eq([numbers(t.repo(P)), t.repo(P).listStatus, t.repo(P).listError.code], [[1, 2, 3], 'error', 'NETWORK'], 'список на месте, ошибка рядом');
  void t.s().select(P, 1);
  await settle();
  eq(t.repo(P).details[1].status, 'loading', 'карточка перечитывается');
  ok(t.repo(P).details[1].detail, 'пока идёт запрос — прежние данные');
  await t.answer('get', errRes('AUTH'));
  eq([t.repo(P).details[1].status, t.repo(P).details[1].error.code, t.repo(P).details[1].detail.timeline.length], ['error', 'AUTH', 1], 'карточка на месте');
  void t.s().refresh(P);
  await settle();
  await t.answer('list', okRes(listOf([1, 2, 3])));
  eq([t.repo(P).listStatus, t.repo(P).listError], ['idle', null], 'успех снимает ошибку');
  // Первая загрузка с ошибкой
  const u = makeStore();
  void u.s().open(P);
  await settle();
  await u.answer('list', errRes('NO_TOKEN'));
  eq([u.repo(P).listStatus, u.repo(P).listError.code, u.repo(P).items], ['error', 'NO_TOKEN', []], 'нет входа');
}

/* ---------- Правило 4: другая вкладка не мешает ---------- */
{
  const t = makeStore();
  void t.s().open(P);
  void t.s().open(Q);
  await settle();
  await t.answer('list', okRes(listOf([200])), (a) => a[0] === Q);
  await t.answer('list', okRes(listOf([100])), (a) => a[0] === P);
  eq([numbers(t.repo(P)), numbers(t.repo(Q))], [[100], [200]], 'ответы по своим путям');
  void t.s().setQuery(P, { state: 'closed' });
  await settle();
  t.s().forget(P);
  await t.answer('list', okRes(listOf([101])));
  eq([t.repo(P), numbers(t.repo(Q))], [undefined, [200]], 'после forget ответ никуда не пишется');
  const done = t.s().update(Q, 200, { title: 'x' });
  await settle();
  t.s().forget(Q);
  await t.answer('update', okRes(issue(200, { title: 'x' })));
  eq([(await done).ok, t.s().byRepo], [true, {}], 'правка после forget не воскрешает вкладку');
  await settle();
  void t.s().open(Q);
  await settle();
  const label = t.s().labelCreate(Q, 'ui', '#00ff00');
  await settle();
  t.s().forget(Q);
  await t.answer('labelCreate', okRes({ id: '5', name: 'ui', color: '#00ff00', description: null }));
  eq([(await label).ok, t.repo(Q)], [true, undefined], 'метка после forget не воскрешает вкладку');
  // Тот же путь открыт заново: прежний ответ (с прежним номером) не применяется
  void t.s().open(P);
  await settle();
  await t.answer('list', okRes(listOf([102])), (a) => a[0] === P);
  eq(numbers(t.repo(P)), [102], 'новое открытие');
}

/* ---------- Правило 5: перезапуск ---------- */
{
  local.clear();
  const t = await opened();
  void t.s().setQuery(P, { labels: ['bug'], assignee: '@me', sort: 'created', ascending: true });
  await settle();
  await t.answer('list', okRes(listOf([3])));
  void t.s().select(P, 3);
  await settle();
  await t.answer('get', okRes({ issue: issue(3, { updatedAt: '2099-01-01T00:00:00Z' }), timeline: [], timelineTruncated: false }));
  const saved = JSON.parse(local.get(STATE_PREFIX + P));
  eq(saved.query.labels, ['bug'], 'фильтр сохранён');
  eq(saved.seenAt[3], '2099-01-01T00:00:00Z', 'seenAt не раньше updatedAt задачи');
  const u = makeStore();
  void u.s().open(P);
  await settle();
  const req = u.waiting('list')[0].args[1];
  eq([req.labels, req.assignee, req.sort, req.ascending, req.page], [['bug'], '@me', 'created', true, 1], 'после перезапуска — прежний фильтр');
  eq(u.repo(P).seenAt[3], '2099-01-01T00:00:00Z', 'и seenAt');
  eq([u.repo(P).selected, u.repo(P).items], [null, []], 'остальное — только в памяти');
  local.set(STATE_PREFIX + Q, '{битый');
  void u.s().open(Q);
  await settle();
  eq(u.repo(Q).query.state, 'open', 'битое сохранение — умолчание');
}

/* ---------- update: мгновенное применение и откат ---------- */
{
  const t = await opened(P, listOf([1, 2], 1, false, { open: 2, closed: 0 }));
  void t.s().select(P, 2);
  await settle();
  await t.answer('get', okRes({ issue: issue(2), timeline: [], timelineTruncated: false }));
  const done = t.s().update(P, 2, { state: 'closed', labels: [{ name: 'bug' }] });
  await settle();
  const shown = t.repo(P).items[1];
  eq([shown.state, shown.labels.map((l) => l.color), t.repo(P).details[2].detail.issue.state, t.repo(P).counts], ['closed', ['#ff0000'], 'closed', { open: 1, closed: 1 }], 'сразу видно, метка из meta');
  await t.answer('update', errRes('FORBIDDEN'));
  const res = await done;
  eq([res.ok, res.error.code], [false, 'FORBIDDEN'], 'ошибка уходит вызывающему');
  eq([t.repo(P).items[1], t.repo(P).details[2].detail.issue, t.repo(P).counts, t.repo(P).pending], [issue(2), issue(2), { open: 2, closed: 0 }, {}], 'откат к снимку');
  const done2 = t.s().update(P, 1, { body: 'новое' });
  drafts.saveDraft(P, { number: 1, field: 'body' }, 'новое');
  await settle();
  await t.answer('update', okRes(issue(1, { body: 'новое', updatedAt: '2026-11-05T00:00:00Z' })));
  eq([(await done2).ok, t.repo(P).items[0].updatedAt, drafts.loadDraft(P, { number: 1, field: 'body' })], [true, '2026-11-05T00:00:00Z', null], 'успех: ответ сервера, черновик удалён');
}

/* ---------- Комментарии ---------- */
{
  const t = await opened(P, listOf([1]));
  void t.s().select(P, 1);
  await settle();
  await t.answer('get', okRes({ issue: issue(1, { commentsCount: 1 }), timeline: [{ type: 'comment', ...comment('c1') }], timelineTruncated: false }));
  drafts.saveDraft(P, { number: 1, field: 'comment' }, 'привет');
  const add = t.s().commentAdd(P, 1, 'привет');
  await settle();
  const tl = () => t.repo(P).details[1].detail.timeline;
  const temp = tl()[1];
  ok(temp.id.startsWith('tmp-'), 'временный id');
  eq([temp.body, temp.author, temp.canEdit, t.repo(P).items[0].commentsCount], ['привет', meta.me, false, 2], 'временный комментарий от меня');
  await t.answer('commentAdd', okRes(comment('c2', 'привет')));
  await add;
  eq([tl().map((i) => i.id), tl()[1].type, drafts.loadDraft(P, { number: 1, field: 'comment' })], [['c1', 'c2'], 'comment', null], 'замена на ответ сервера, черновик удалён');
  const bad = t.s().commentAdd(P, 1, 'не уйдёт');
  await settle();
  eq(tl().length, 3, 'второй временный');
  await t.answer('commentAdd', errRes());
  eq([(await bad).ok, tl().map((i) => i.id), t.repo(P).items[0].commentsCount], [false, ['c1', 'c2'], 2], 'ошибка убирает временный');
  const edit = t.s().commentUpdate(P, 1, 'c1', 'правка');
  await settle();
  eq(tl()[0].body, 'правка', 'правка сразу');
  await t.answer('commentUpdate', errRes());
  eq([(await edit).ok, tl()[0]], [false, { type: 'comment', ...comment('c1') }], 'откат правки');
  const del = t.s().commentDelete(P, 1, 'c1');
  await settle();
  eq([tl().map((i) => i.id), t.repo(P).items[0].commentsCount], [['c2'], 1], 'удаление сразу');
  await t.answer('commentDelete', errRes());
  eq([(await del).ok, tl().map((i) => i.id), t.repo(P).items[0].commentsCount], [false, ['c1', 'c2'], 2], 'возврат на прежнее место');
  const del2 = t.s().commentDelete(P, 1, 'c2');
  await settle();
  await t.answer('commentDelete', okRes(null));
  eq([(await del2).ok, tl().map((i) => i.id)], [true, ['c1']], 'удалено');
}

/* ---------- loadMore и refresh ---------- */
{
  const t = await opened(P, listOf([1, 2, 3], 1, true));
  void t.s().loadMore(P);
  void t.s().loadMore(P);
  await settle();
  eq([t.repo(P).listStatus, t.waiting('list').length, t.waiting('list')[0].args[1].page], ['loadingMore', 1, 2], 'одна подгрузка за раз');
  await t.answer('list', okRes(listOf([3, 4, 2, 5], 2, true)));
  eq([numbers(t.repo(P)), t.repo(P).page, t.repo(P).hasMore], [[1, 2, 3, 4, 5], 2, true], 'дубли по номеру отброшены');
  void t.s().loadMore(P);
  await settle();
  void t.s().setQuery(P, { state: 'closed' });
  await settle();
  await t.answer('list', okRes(listOf([99], 3, false)), (a) => a[1].page === 3);
  await t.answer('list', okRes(listOf([7])), (a) => a[1].page === 1);
  eq(numbers(t.repo(P)), [7], 'подгрузка старого фильтра отброшена');
  const u = await opened(P, listOf([1], 1, false));
  void u.s().loadMore(P);
  await settle();
  eq(u.waiting('list').length, 0, 'hasMore = false — без запроса');

  // refresh: не больше пяти страниц, лишнее отрезается
  const per = (page) => Array.from({ length: 30 }, (_, i) => (page - 1) * 30 + i + 1);
  const r = await opened(P, listOf(per(1), 1, true));
  for (let page = 2; page <= 7; page += 1) {
    void r.s().loadMore(P);
    await settle();
    await r.answer('list', okRes(listOf(per(page), page, true)));
  }
  eq([r.repo(P).items.length, r.repo(P).page], [210, 7], '7 страниц');
  void r.s().refresh(P);
  await settle();
  for (let page = 1; page <= 5; page += 1) {
    eq(r.waiting('list').map((c) => c.args[1].page), [page], `страницы по порядку: ${page}`);
    await r.answer('list', okRes(listOf(per(page), page, true)));
  }
  eq([r.waiting('list').length, r.repo(P).items.length, r.repo(P).page, r.repo(P).hasMore], [0, 150, 5, true], 'сокращено до 150, дальше есть ещё');
  // Если сервер сказал «дальше нет» раньше — меньше страниц
  void r.s().refresh(P);
  await settle();
  await r.answer('list', okRes(listOf(per(1), 1, true)));
  await r.answer('list', okRes(listOf([31, 32], 2, false)));
  eq([r.waiting('list').length, r.repo(P).items.length, r.repo(P).hasMore], [0, 32, false], 'конец списка');
}

/* ---------- create, remove, labelCreate, карточки ---------- */
{
  const t = await opened(P, listOf([1, 2], 1, false, { open: 2, closed: 0 }));
  drafts.saveDraft(P, 'new', { title: 'Новая', body: 'текст' });
  const bad = t.s().create(P, { title: 'Новая' });
  await settle();
  await t.answer('create', errRes('VALIDATION'));
  eq([(await bad).ok, drafts.loadDraft(P, 'new')?.title], [false, 'Новая'], 'ошибка: черновик на месте');
  const done = t.s().create(P, { title: 'Новая' });
  await settle();
  await t.answer('create', okRes(issue(9, { title: 'Новая' })));
  await done;
  eq([numbers(t.repo(P)), t.repo(P).selected, t.repo(P).details[9].status, t.repo(P).counts.open, drafts.loadDraft(P, 'new')], [[9, 1, 2], 9, 'idle', 3, null], 'создана первой и выбрана');
  const rm = t.s().remove(P, 9);
  await settle();
  eq(numbers(t.repo(P)), [9, 1, 2], 'удаление не мгновенное');
  await t.answer('remove', okRes(null));
  await rm;
  eq([numbers(t.repo(P)), t.repo(P).selected, t.repo(P).details[9], t.repo(P).counts.open], [[1, 2], null, undefined, 2], 'удалена');
  void t.s().labelCreate(P, 'ui', '#00ff00');
  await settle();
  await t.answer('labelCreate', okRes({ id: '5', name: 'ui', color: '#00ff00', description: null }));
  eq(t.repo(P).meta.labels.map((l) => l.name), ['bug', 'ui'], 'метка в meta');
  void t.s().select(P, 'new');
  await settle();
  eq([t.repo(P).selected, t.waiting('get').length], ['new', 0], 'форма новой задачи без запроса');
  // Не больше 50 карточек
  for (let n = 100; n < 100 + MAX_DETAILS + 5; n += 1) {
    clock += 1;
    void t.s().select(P, n);
    await settle();
    await t.answer('get', okRes({ issue: issue(n), timeline: [], timelineTruncated: false }));
  }
  const kept = Object.keys(t.repo(P).details).map(Number);
  eq([kept.length <= MAX_DETAILS + 1, kept.includes(100 + MAX_DETAILS + 4), kept.includes(100)], [true, true, false], 'старые карточки уходят');
}

/* ---------- Случайные сценарии: инварианты ---------- */

let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rnd() * list.length)];
for (let k = 0; k < SCENARIOS; k += 1) {
  local.clear();
  const t = makeStore();
  const paths = [P, Q];
  const lastQuery = {};
  for (let step = 0; step < 25; step += 1) {
    const p = pick(paths);
    const action = pick(['open', 'setQuery', 'refresh', 'loadMore', 'answer', 'answer', 'answer', 'update', 'forget', 'select']);
    if (action === 'open') void t.s().open(p);
    else if (action === 'setQuery') {
      const state = pick(['open', 'closed', null]);
      lastQuery[p] = state;
      void t.s().setQuery(p, { state });
    } else if (action === 'refresh') void t.s().refresh(p, { silent: rnd() < 0.5 });
    else if (action === 'loadMore') void t.s().loadMore(p);
    else if (action === 'update') void t.s().update(p, 1 + Math.floor(rnd() * 3), { title: `t${step}` });
    else if (action === 'select') void t.s().select(p, 1 + Math.floor(rnd() * 3));
    else if (action === 'forget') {
      t.s().forget(p);
      delete lastQuery[p];
    } else {
      const waiting = t.waiting();
      if (waiting.length) {
        const call = pick(waiting);
        call.done = true;
        const [dir, arg] = call.args;
        const tag = (n) => issue(n, { title: `${dir}:${call.name === 'list' ? (arg.state ?? 'all') : 'x'}` });
        const fail = rnd() < 0.2;
        const data = {
          list: () => listOf([tag(1 + (arg.page - 1) * 3), tag(2 + (arg.page - 1) * 3), tag(3 + (arg.page - 1) * 3)], arg.page, rnd() < 0.5),
          get: () => ({ issue: issue(arg), timeline: [], timelineTruncated: false }),
          meta: () => meta,
          update: () => issue(arg, { title: 'сервер' }),
        }[call.name];
        call.resolve(fail || !data ? errRes() : okRes(data()));
      }
    }
    await settle();
    for (const [dir, repo] of Object.entries(t.s().byRepo)) {
      // Чужая вкладка не попадает в список
      for (const it of repo.items) ok(!it.title.includes(':') || it.title.startsWith(`${dir}:`), `чужой ответ в ${dir}: ${it.title}`);
      eq(new Set(numbers(repo)).size, repo.items.length, 'без повторов');
      ok(Object.values(repo.pending).every((n) => n > 0), 'pending > 0');
    }
  }
  // Всё отвечено успешно: каждый путь показывает ответ на свой последний фильтр
  for (let guard = 0; guard < 200 && t.waiting().length; guard += 1) {
    const call = t.waiting()[0];
    call.done = true;
    const [dir, arg] = call.args;
    const data = { list: () => listOf([issue(1, { title: `${dir}:${arg.state ?? 'all'}` })], arg.page, false), get: () => ({ issue: issue(arg, { title: `${dir}:${t.repo(dir)?.query.state ?? 'all'}` }), timeline: [], timelineTruncated: false }), meta: () => meta, update: () => issue(arg, { title: `${dir}:${t.repo(dir)?.query.state ?? 'all'}` }) }[call.name];
    call.resolve(okRes(data()));
    await settle();
  }
  for (const [dir, repo] of Object.entries(t.s().byRepo)) {
    eq(repo.pending, {}, 'все правки закончены');
    if (repo.listStatus === 'idle' && repo.page === 1 && repo.items[0]?.number === 1 && repo.items[0].title.startsWith(dir)) {
      const shown = repo.items[0].title.slice(dir.length + 1);
      if (!/^t\d+$|сервер/.test(shown)) eq(shown, String(repo.query.state ?? 'all'), `последний фильтр ${dir}`);
    }
  }
}

console.log(`issues-store: ${checks} проверок прошли`);
