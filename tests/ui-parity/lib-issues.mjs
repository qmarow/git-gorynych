// Новое в 2.0: проверка src/lib/issues.ts и src/lib/issueDrafts.ts (раздел «Задачи»). Эталона в 1.x нет — ожидаемые
// значения записаны здесь, плюс случайные проверки свойств.
// node tests/ui-parity/lib-issues.mjs <корень репозитория>
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot] = process.argv.slice(2);
if (!repoRoot) throw new Error('usage: node tests/ui-parity/lib-issues.mjs <корень репозитория>');

/* ---------- Окружение черновиков: localStorage и часы ---------- */

const store = new Map();
let broken = false;
globalThis.localStorage = {
  getItem: (k) => {
    if (broken) throw new Error('denied');
    return store.has(k) ? store.get(k) : null;
  },
  setItem: (k, v) => {
    if (broken) throw new Error('denied');
    store.set(k, String(v));
  },
  removeItem: (k) => {
    if (broken) throw new Error('denied');
    store.delete(k);
  },
};
const clock = { now: 1_000_000, timers: [] };
Date.now = () => clock.now;
globalThis.setTimeout = (fn, ms) => {
  const t = { fn, at: clock.now + ms };
  clock.timers.push(t);
  return t;
};
globalThis.clearTimeout = (t) => {
  clock.timers = clock.timers.filter((x) => x !== t);
};
const advance = (ms) => {
  const until = clock.now + ms;
  for (;;) {
    clock.timers.sort((a, b) => a.at - b.at);
    const t = clock.timers[0];
    if (!t || t.at > until) break;
    clock.timers.shift();
    clock.now = t.at;
    t.fn();
  }
  clock.now = until;
};

const lib = await import(pathToFileURL(path.join(repoRoot, 'src/lib/issues.ts')).href);
const drafts = await import(pathToFileURL(path.join(repoRoot, 'src/lib/issueDrafts.ts')).href);
let checks = 0;
const eq = (actual, expected, label) => {
  checks += 1;
  assert.deepEqual(actual, expected, label);
};

/* ---------- Детерминированный генератор ---------- */

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rnd() * list.length)];

/* ---------- DEFAULT_QUERY, queryKey, isDefaultQuery ---------- */

eq(lib.DEFAULT_QUERY, { state: 'open', search: null, labels: [], assignee: null, author: null, milestone: null, sort: 'updated', ascending: false, page: 1, perPage: 30 }, 'DEFAULT_QUERY');
assert.ok(Object.isFrozen(lib.DEFAULT_QUERY));
eq(lib.isDefaultQuery(lib.DEFAULT_QUERY), true, 'умолчание');
eq(lib.isDefaultQuery({}), true, 'пустой фильтр = умолчание');
eq(lib.isDefaultQuery({ ...lib.DEFAULT_QUERY, page: 7 }), true, 'страница не входит в ключ');
eq(lib.isDefaultQuery({ search: '   ' }), true, 'пустой поиск');
eq(lib.isDefaultQuery({ state: null }), false, '«Все»');
eq(lib.isDefaultQuery({ state: 'closed' }), false, 'закрытые');
eq(lib.isDefaultQuery({ assignee: '@me' }), false, 'назначены мне');
eq(lib.isDefaultQuery({ labels: ['bug'] }), false, 'метка');
eq(lib.isDefaultQuery({ sort: 'created', ascending: true }), false, 'старые');
eq(lib.queryKey({ labels: ['b', 'a'] }), lib.queryKey({ labels: ['a', 'b', 'a'] }), 'порядок и повторы меток');
eq(lib.queryKey({ search: ' x ' }), lib.queryKey({ search: 'x' }), 'пробелы поиска');
assert.notEqual(lib.queryKey({ search: 'x' }), lib.queryKey({ search: 'y' }));
for (let i = 0; i < 2000; i += 1) {
  const q = {
    state: pick(['open', 'closed', null]),
    search: pick([null, '', 'bug', ' bug ']),
    labels: [pick(['a', 'b']), pick(['b', 'c'])].slice(0, Math.floor(rnd() * 3)),
    assignee: pick([null, '@me', '@none', 'ivan']),
    author: pick([null, '@me']),
    milestone: pick([null, '@none', 'v1']),
    sort: pick(['updated', 'created', 'comments']),
    ascending: rnd() < 0.5,
    page: 1 + Math.floor(rnd() * 5),
    perPage: 30,
  };
  // Поля в другом порядке и другая страница — тот же ключ
  const shuffled = Object.fromEntries(Object.entries({ ...q, page: 1 }).sort(() => rnd() - 0.5));
  eq(lib.queryKey(shuffled), lib.queryKey(q), 'ключ не зависит от порядка полей');
  const isDefault = q.state === 'open' && !q.search?.trim() && !q.labels.length && !q.assignee && !q.author && !q.milestone && q.sort === 'updated' && !q.ascending;
  eq(lib.isDefaultQuery(q), isDefault, `isDefaultQuery ${JSON.stringify(q)}`);
}

/* ---------- parseIssueNumber ---------- */

for (const [text, expected] of [
  ['#123', 123], ['123', 123], ['  #7 ', 7], ['#0', null], ['0', null], ['#', null], ['', null], [null, null], [undefined, null],
  ['12a', null], ['#-3', null], ['1.5', null], ['# 12', null], ['##12', null], ['9007199254740993', null], ['#00012', 12],
]) eq(lib.parseIssueNumber(text), expected, `parseIssueNumber(${JSON.stringify(text)})`);

/* ---------- branchNameFor ---------- */

const issue = (number, title) => ({ number, title });
for (const [args, expected] of [
  [[issue(12, 'Fix login button')], '12-fix-login-button'],
  [[issue(5, 'Кнопка входа не работает')], '5-knopka-vkhoda-ne-rabotaet'],
  [[issue(9, 'Щука, ёж и Юла: съезд!')], '9-shchuka-ezh-i-yula-sezd'],
  [[issue(3, '🚀 Запуск 🔥 rocket')], '3-zapusk-rocket'],
  [[issue(4, '🚀🔥')], '4'],
  [[issue(7, '')], '7'],
  [[issue(8, '   ---   ')], '8'],
  [[issue(10, 'Café déjà vu — naïve')], '10-cafe-deja-vu-naive'],
  [[issue(11, 'Ґанок і їжак, Євген')], '11-ganok-i-yizhak-yevgen'],
  [[issue(12, 'API: v2/users?id=1')], '12-api-v2-users-id-1'],
  [[issue(42, 'Fix'), 'feature/{number}-{slug}'], 'feature/42-fix'],
  [[issue(42, ''), 'feature/{number}-{slug}'], 'feature/42'],
  [[issue(42, 'Fix'), ''], '42-fix'],
  [[issue(42, 'Fix'), '{slug}'], 'fix'],
]) eq(lib.branchNameFor(...args), expected, `branchNameFor(${JSON.stringify(args)})`);
const long = lib.branchNameFor(issue(123, 'Очень длинный заголовок задачи, который никак не помещается в имя ветки целиком'));
eq(long.length <= 60, true, 'длина ≤ 60');
eq(long, '123-ochen-dlinnyy-zagolovok-zadachi-kotoryy-nikak-ne-pomeshc', 'длинный заголовок');
eq(lib.branchNameFor(issue(1, 'a'.repeat(57) + ' bcd')).endsWith('-'), false, 'без - в конце после обрезки');
for (let i = 0; i < 3000; i += 1) {
  const title = Array.from({ length: Math.floor(rnd() * 90) }, () => pick(['a', 'Я', ' ', '-', '_', '🚀', 'é', '9', '/', '#', 'ß', 'щ'])).join('');
  const name = lib.branchNameFor(issue(1 + Math.floor(rnd() * 99999), title));
  assert.ok(name.length >= 1 && name.length <= 60, name);
  assert.match(name, /^[0-9]+(-[a-z0-9]+)*$/, `branchNameFor(${JSON.stringify(title)}) = ${name}`);
  checks += 1;
}

/* ---------- findIssueRefs ---------- */

const refs = (text) => lib.findIssueRefs(text).map((r) => [r.number, text.slice(r.start, r.end)]);
for (const [text, expected] of [
  ['#12', [[12, '#12']]],
  ['abc#12', []],
  ['&#12;', []],
  ['#0', []],
  ['#012', []],
  ['#12abc', []],
  ['я#5', []],
  ['_#5', []],
  ['Исправляет #12, см. #345 и (#6).', [[12, '#12'], [345, '#345'], [6, '#6']]],
  ['#1#2', [[1, '#1']]],
  ['fix: #7\nrefs #8', [[7, '#7'], [8, '#8']]],
  ['#7.', [[7, '#7']]],
  ['🚀#9', [[9, '#9']]],
  ['', []],
]) eq(refs(text), expected, `findIssueRefs(${JSON.stringify(text)})`);
const emoji = '🚀 #42';
eq(lib.findIssueRefs(emoji)[0], { number: 42, start: 3, end: 6 }, 'позиции в единицах UTF-16');

/* ---------- mergeTimeline ---------- */

const user = (id) => ({ id, login: `u${id}`, name: null, avatarUrl: null, webUrl: null });
const ev = (id, actor, at, kind = 'labeled') => ({ type: 'event', id, kind, actor, createdAt: at, label: null, user: null, from: null, to: null, text: null });
const cm = (id, at) => ({ type: 'comment', id, body: 'x', author: user('1'), createdAt: at, updatedAt: null, canEdit: false, webUrl: null });
const T = (s) => new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();
const shape = (entries) => entries.map((e) => (e.type === 'comment' ? `c:${e.comment.id}` : `e:${e.events.map((x) => x.id).join('+')}`));
eq(shape(lib.mergeTimeline([])), [], 'пустая лента');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(0)), ev('b', user('1'), T(30)), ev('c', user('1'), T(60))])), ['e:a+b+c'], 'один автор за минуту');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(0)), ev('b', user('1'), T(61))])), ['e:a', 'e:b'], 'больше минуты');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(0)), ev('b', user('1'), T(40)), ev('c', user('1'), T(80))])), ['e:a+b', 'e:c'], 'минута от первого события группы');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(0)), ev('b', user('2'), T(1))])), ['e:a', 'e:b'], 'разные авторы');
eq(shape(lib.mergeTimeline([ev('a', null, T(0)), ev('b', null, T(1))])), ['e:a', 'e:b'], 'без автора не склеиваются');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(0)), cm('k', T(1)), ev('b', user('1'), T(2))])), ['e:a', 'c:k', 'e:b'], 'комментарий разрывает');
eq(shape(lib.mergeTimeline([ev('a', user('1'), 'вчера'), ev('b', user('1'), 'вчера')])), ['e:a', 'e:b'], 'дата не разбирается');
eq(shape(lib.mergeTimeline([ev('a', user('1'), T(30)), ev('b', user('1'), T(0))])), ['e:a', 'e:b'], 'время назад не склеивает');
const merged = lib.mergeTimeline([cm('k', T(0)), ev('a', user('1'), T(5))]);
eq(merged[0].comment.type, undefined, 'у комментария нет поля type');
eq(merged[1].actor, user('1'), 'автор группы');
eq(merged[1].createdAt, T(5), 'время группы — первое событие');
eq('type' in merged[1].events[0], false, 'у события нет поля type');

/* ---------- applyPatch ---------- */

const label = (id, name, color = '#ff0000') => ({ id, name, color, description: null });
const milestone = (id, number, title) => ({ id, number, title, dueDate: null, closed: false });
const meta = {
  labels: [label('1', 'bug'), label('2', 'ui', '#00ff00')],
  milestones: [milestone('m1', 1, 'v1'), milestone('m2', 2, 'v2')],
  members: [user('10'), user('11')],
  me: user('99'),
  templates: [],
};
const base = {
  id: 'i1', number: 5, title: 'Старый', body: 'текст', state: 'open', stateReason: null, author: user('10'), assignees: [user('10')], labels: [label('1', 'bug')],
  milestone: milestone('m1', 1, 'v1'), commentsCount: 2, createdAt: T(0), updatedAt: T(10), closedAt: null, dueDate: '2026-12-01', confidential: false, locked: false, webUrl: 'https://x/5',
};
const NOW = '2026-11-14T12:00:00.000Z';
eq(lib.applyPatch(base, {}, meta, NOW), base, 'пустая правка ничего не меняет');
assert.notEqual(lib.applyPatch(base, {}, meta, NOW), base, 'новая задача, а не та же');
eq(lib.applyPatch(base, { title: 'Новый', body: '' }, meta, NOW), { ...base, title: 'Новый', body: '' }, 'заголовок и пустое описание');
eq(lib.applyPatch(base, { state: 'closed', stateReason: 'not_planned' }, meta, NOW), { ...base, state: 'closed', stateReason: 'not_planned', closedAt: NOW }, 'закрытие');
const closed = { ...base, state: 'closed', stateReason: 'completed', closedAt: T(20) };
eq(lib.applyPatch(closed, { state: 'open' }, meta, NOW), { ...base }, 'переоткрытие снимает дату и причину');
eq(lib.applyPatch(closed, { state: 'closed' }, meta, NOW), closed, 'то же состояние — дата прежняя');
eq(lib.applyPatch(base, { labels: [{ name: 'ui' }, { id: '1' }, { name: 'новая' }] }, meta, NOW).labels, [label('2', 'ui', '#00ff00'), label('1', 'bug'), { id: '', name: 'новая', color: '#8a92a2', description: null }], 'метки из meta, неизвестная — серая');
eq(lib.applyPatch(base, { labels: [{ name: 'bug' }] }, null, NOW).labels, [label('1', 'bug')], 'без meta — из самой задачи');
eq(lib.applyPatch(base, { assignees: [{ login: 'u11' }, { id: '99' }, { login: 'ghost' }] }, meta, NOW).assignees, [user('11'), user('99'), { id: '', login: 'ghost', name: null, avatarUrl: null, webUrl: null }], 'исполнители');
eq(lib.applyPatch(base, { assignees: [] }, meta, NOW).assignees, [], 'снять всех');
eq(lib.applyPatch(base, { milestone: { number: 2 } }, meta, NOW).milestone, milestone('m2', 2, 'v2'), 'веха по номеру');
eq(lib.applyPatch(base, { milestone: { title: 'v2' } }, meta, NOW).milestone, milestone('m2', 2, 'v2'), 'веха по названию');
eq(lib.applyPatch(base, { milestone: { id: 'm2' }, clearMilestone: true }, meta, NOW).milestone, null, 'clearMilestone сильнее');
eq(lib.applyPatch(base, { dueDate: '2027-01-01' }, meta, NOW).dueDate, '2027-01-01', 'срок');
eq(lib.applyPatch(base, { dueDate: '2027-01-01', clearDueDate: true }, meta, NOW).dueDate, null, 'clearDueDate');
eq(lib.applyPatch(base, { confidential: true, locked: true }, meta, NOW), { ...base, confidential: true, locked: true }, 'флаги');
eq(lib.applyPatch(base, { title: null, labels: null, milestone: null }, meta, NOW), base, 'null = поле не меняется');
eq(base.title, 'Старый', 'исходная задача не изменена');

/* ---------- labelTextColor ---------- */

for (const [hex, expected] of [
  ['#ffffff', '#000000'], ['#000000', '#ffffff'], ['#ff0000', '#000000'], ['#0000ff', '#ffffff'], ['#a2eeef', '#000000'],
  ['#7057ff', '#ffffff'], ['#fef2c0', '#000000'], ['#8a92a2', '#000000'], ['fff', '#000000'], ['#123', '#ffffff'], ['мусор', '#000000'], [null, '#000000'],
]) eq(lib.labelTextColor(hex), expected, `labelTextColor(${hex})`);
// Выбранный цвет всегда даёт контраст не хуже другого
const lum = (h) => {
  const [r, g, b] = lib.parseHex(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
for (let i = 0; i < 5000; i += 1) {
  const hex = '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
  const text = lib.labelTextColor(hex);
  const other = text === '#000000' ? '#ffffff' : '#000000';
  assert.ok(contrast(hex, text) >= contrast(hex, other) - 1e-9, hex);
  checks += 1;
}

/* ---------- Прочее ---------- */

eq(lib.isTemporaryId('tmp-1'), true, 'tmp-');
eq(lib.isTemporaryId('123'), false, 'обычный id');
eq(lib.isUpdatedSince({ updatedAt: T(10) }, T(5)), true, 'обновлена после просмотра');
eq(lib.isUpdatedSince({ updatedAt: T(5) }, T(5)), false, 'не позже');
eq(lib.isUpdatedSince({ updatedAt: T(10) }, undefined), false, 'не открывалась');
eq(lib.normalizeQuery({ perPage: 500, page: 0, labels: ['a', '', 3] }), { ...lib.DEFAULT_QUERY, perPage: 100, labels: ['a'] }, 'normalizeQuery');

/* ---------- Черновики ---------- */

const P = 'C:/repo';
eq(drafts.draftKey(P, 'new'), 'issues.draft.v1:C:/repo:new', 'ключ новой задачи');
eq(drafts.draftKey(P, { number: 7, field: 'comment' }), 'issues.draft.v1:C:/repo:7:comment', 'ключ комментария');
eq(drafts.draftKey(P, { number: 7, field: 'body' }), 'issues.draft.v1:C:/repo:7:body', 'ключ описания');
const C7 = { number: 7, field: 'comment' };
eq(drafts.loadDraft(P, C7), null, 'нет черновика');
drafts.saveDraft(P, C7, 'п');
eq(store.get('issues.draft.v1:C:/repo:7:comment'), '"п"', 'первая запись сразу');
advance(100);
drafts.saveDraft(P, C7, 'пр');
drafts.saveDraft(P, C7, 'при');
eq(store.get('issues.draft.v1:C:/repo:7:comment'), '"п"', 'в окне 500 мс не пишется');
eq(drafts.loadDraft(P, C7), 'при', 'но читается последнее');
advance(399);
eq(store.get('issues.draft.v1:C:/repo:7:comment'), '"п"', 'ещё рано');
advance(1);
eq(store.get('issues.draft.v1:C:/repo:7:comment'), '"при"', 'в конце окна — последнее значение');
advance(600);
drafts.saveDraft(P, C7, '');
eq(store.has('issues.draft.v1:C:/repo:7:comment'), false, 'пустой текст удаляет ключ');
drafts.saveDraft(P, C7, 'снова');
eq(store.has('issues.draft.v1:C:/repo:7:comment'), false, 'вторая запись в окне ждёт');
drafts.clearDraft(P, C7);
advance(1000);
eq(store.has('issues.draft.v1:C:/repo:7:comment'), false, 'clearDraft отменяет отложенную запись');
advance(1000);
drafts.saveDraft(P, 'new', { title: 'Т', body: '', labels: [{ name: 'bug' }] });
eq(drafts.loadDraft(P, 'new'), { title: 'Т', body: '', labels: [{ name: 'bug' }] }, 'новая задача целиком');
advance(1000);
drafts.saveDraft(P, 'new', { title: '', body: '', labels: [] });
eq(store.has('issues.draft.v1:C:/repo:new'), false, 'пустая форма удаляет ключ');
store.set('issues.draft.v1:C:/repo:new', '"строка"');
eq(drafts.loadDraft(P, 'new'), null, 'не объект — не черновик задачи');
store.set('issues.draft.v1:C:/repo:7:body', '{"a":1}');
eq(drafts.loadDraft(P, { number: 7, field: 'body' }), null, 'не строка — не черновик текста');
store.set('issues.draft.v1:C:/repo:7:body', '{битый');
eq(drafts.loadDraft(P, { number: 7, field: 'body' }), null, 'битый JSON');
advance(1000);
drafts.saveDraft(P, { number: 8, field: 'body' }, 'а');
drafts.saveDraft(P, { number: 8, field: 'body' }, 'аб');
drafts.flushDrafts();
eq(store.get('issues.draft.v1:C:/repo:8:body'), '"аб"', 'flushDrafts пишет сразу');
broken = true;
advance(1000);
drafts.saveDraft(P, C7, 'x');
drafts.clearDraft(P, C7);
eq(drafts.loadDraft(P, C7), null, 'ошибки localStorage молча игнорируются');
broken = false;

/* ---------- Флажки списка задач (те же номера, что data-task-index в issues/markdown.rs) ---------- */

const doc = ['- [ ] a', '- [x] b', '```', '- [ ] в коде', '```', '  1. [ ] c', '> - [ ] d', '~~~~', '- [ ] тоже код', '~~~', '- [ ] всё ещё код', '~~~~', '* [X] e', '- [ ]нет пробела', '- [] нет'].join('\n');
eq(lib.toggleTask(doc, 0, true).split('\n')[0], '- [x] a');
eq(lib.toggleTask(doc, 1, false).split('\n')[1], '- [ ] b');
eq(lib.toggleTask(doc, 2, true).split('\n')[5], '  1. [x] c', 'блок кода пропущен');
eq(lib.toggleTask(doc, 3, true).split('\n')[6], '> - [x] d');
eq(lib.toggleTask(doc, 4, false).split('\n')[12], '* [ ] e', 'закрывающая ограда не короче открывающей');
eq(lib.toggleTask(doc, 5, true), null);
eq(lib.toggleTask('- [ ] a\r', 0, true), '- [x] a\r');

// Случайные: переключение меняет ровно один символ и обратимо
const rndTask = (() => {
  let x = 7;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31), x / 2 ** 31);
})();
const parts = ['- [ ] t', '- [x] t', '  - [ ] t', 'текст', '```', '1. [ ] t', '> - [x] t', ''];
for (let n = 0; n < 2000; n++) {
  const body = Array.from({ length: 1 + Math.floor(rndTask() * 12) }, () => parts[Math.floor(rndTask() * parts.length)]).join('\n');
  for (let i = 0; i < 6; i++) {
    const next = lib.toggleTask(body, i, true);
    if (next == null) {
      eq(lib.toggleTask(body, i + 1, true), null, 'номера идут подряд');
      break;
    }
    eq(next.length, body.length);
    eq([...next].filter((c, k) => c !== body[k]).length <= 1, true);
    eq(lib.toggleTask(lib.toggleTask(next, i, false), i, true), next, 'обратимо');
  }
}


/* ---------- Палитра меток и срок ---------- */

eq(lib.LABEL_PALETTE.length, 8);
eq(lib.nextLabelColor(0), lib.LABEL_PALETTE[0]);
eq(lib.nextLabelColor(9), lib.LABEL_PALETTE[1], 'по кругу');
eq(lib.localDate(new Date(2026, 0, 5)), '2026-01-05');
eq(lib.isOverdue({ state: 'open', dueDate: '2026-11-13' }, '2026-11-14'), true);
eq(lib.isOverdue({ state: 'open', dueDate: '2026-11-14' }, '2026-11-14'), false, 'сегодня — не просрочено');
eq(lib.isOverdue({ state: 'closed', dueDate: '2026-01-01' }, '2026-11-14'), false, 'закрытая');
eq(lib.isOverdue({ state: 'open', dueDate: null }, '2026-11-14'), false);
eq(lib.isOverdue({ state: 'open', dueDate: '2026-11-13T00:00:00Z' }, '2026-11-14'), true);

/* ---------- Свойства → запрос ---------- */

{
  const u = { id: "7", login: "ann", name: "Анна", avatarUrl: null, webUrl: null };
  const l = { id: "3", name: "bug", color: "#d73a4a", description: null };
  const m = { id: "9", number: 2, title: "v1", dueDate: null, closed: false };
  eq(lib.propsPatch({}), {});
  eq(lib.propsPatch({ assignees: [u], labels: [l] }), { assignees: [{ id: "7", login: "ann" }], labels: [{ id: "3", name: "bug" }] });
  eq(lib.propsPatch({ assignees: [] }), { assignees: [] }, "пустой список — снять всех");
  eq(lib.propsPatch({ milestone: m }), { milestone: { id: "9", number: 2, title: "v1" } });
  eq(lib.propsPatch({ milestone: null }), { clearMilestone: true });
  eq(lib.propsPatch({ dueDate: "2026-12-01" }), { dueDate: "2026-12-01" });
  eq(lib.propsPatch({ dueDate: null }), { clearDueDate: true });
  eq(lib.propsPatch({ confidential: false }), { confidential: false });
  // Правка, собранная из изменения, применяется так же, как её применит сервер
  const issue = { number: 1, title: "x", body: "", state: "open", stateReason: null, labels: [], assignees: [], milestone: m, dueDate: "2026-01-01", confidential: false, locked: false, closedAt: null };
  const next = lib.applyPatch(issue, lib.propsPatch({ assignees: [u], labels: [l], milestone: null, dueDate: null }), { labels: [l], milestones: [m], members: [u], me: null, templates: [] });
  eq([next.assignees[0].name, next.labels[0].color, next.milestone, next.dueDate], ["Анна", "#d73a4a", null, null]);
  eq(lib.issueInput({ title: "  Заголовок ", body: "т", labels: [l], assignees: [u], milestone: null, dueDate: "", confidential: true }), {
    title: "Заголовок", body: "т", labels: [{ id: "3", name: "bug" }], assignees: [{ id: "7", login: "ann" }], milestone: null, dueDate: null, confidential: true,
  });
}

console.log(`lib-issues: ${checks} проверок прошли`);
