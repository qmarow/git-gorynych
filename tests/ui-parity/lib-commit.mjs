// Сверка commitMsg и commitPrefs (src/lib/*.ts) с прежними .js на случайных входах.
// node tests/ui-parity/lib-commit.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const rnd = random(31);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const int = (n) => Math.floor(rnd() * n);
const maybe = (p, value) => (rnd() < p ? value : '');
Date.now = () => 1_800_000_000_000;
const json = (v) => JSON.stringify(v);

const TYPES = ['feat', 'fix', 'refactor', 'chore', 'docs', 'style', 'test', 'perf', 'build', 'ci', 'revert', 'wip', 'Feat', 'feature'];
const TICKETS = ['PROJ-123', 'proj-123', '#42', 'AB-1', 'X-9', 'TOOLONGKEY1-5', 'ABC-12'];
const summary = () =>
  maybe(0.2, pick(['  ', ' ', '\t'])) +
  maybe(0.3, `[${pick([...TICKETS, 'WIP', '', 'x'.repeat(41), 'y'.repeat(35), 'z'.repeat(40)])}]${pick([' ', '', '  '])}`) +
  maybe(0.7, `${pick(TYPES)}${maybe(0.4, `(${pick(['ui', ' api ', '', 'PROJ-123', 'a(b'])})`)}${maybe(0.2, '!')}:${pick([' ', '', '\t', '  '])}`) +
  pick(['Добавлен вход', 'fix bug', '', ' ', 'текст (не номер)', 'x (PROJ-1) y']) +
  maybe(0.3, `${pick([' ', ''])}(${pick(TICKETS)})${pick(['', ' ', '\n'])}`);

const SEG = ['feature', 'bugfix', 'release', 'v', 'hotfix', 'fix', 'issue-42', 'PROJ-123-login', 'proj-123-login', '1234-fix', '#77', 'add-2-buttons', 'gh-15', 'node-18',
  'ABC-1', 'feat_99_x', 'main', 'tags', '12', 'v1.2.3', 'Story-77', 'release-2024', 'ab-12.x', 'TASK-5', 'ISSUE-8', 'PY-311'];
const branch = () => Array.from({ length: 1 + int(3) }, () => pick(SEG)).join(pick(['/', '/', '-']));
const PATTERNS = ['', ' ', '([A-Z]+-\\d+)', '(\\d+)', '#?(\\d+)', 'feature/(.*)', '[', '(x)?', 'proj-\\d+', '()'];

const DIRS = ['src', 'lib', 'app', 'components', 'ui', 'api', '.github', 'docs', 'packages', 'core', 'Main'];
const FILES = ['index.ts', 'package.json', 'README.md', 'notes.md', 'Cargo.lock', 'go.sum', '.gitlab-ci.yml', 'github.yml', 'x.js', 'requirements-dev.txt'];
const filePath = () => [...Array.from({ length: int(4) }, () => pick(DIRS)), pick(FILES)].join(pick(['/', '/', '\\']));

const DESCS = ['', 'Описание', 'Описание\n\nRefs: PROJ-123', 'a\nrefs: proj-123  \nb', 'Closes: #42', 'x\n\nSigned-off-by: A <a@b>\n\n', '  \n\n', 'BREAKING CHANGE: всё\n\nCo-authored-by: X <x@y>'];
const BODIES = ['', 'Что сделано:\n- \n\nКак проверить:\n1. ', 'одна строка', 'Проблема:\n\nПричина:', '{ticket} и {branch} и {other}', 'a\n  2.  \nb', null];

const store = (saved) => {
  const writes = [];
  globalThis.localStorage = { getItem: () => saved, setItem: (k, v) => writes.push([k, v]) };
  return writes;
};
const loadPair = async (name, language, saved, tag) => {
  const writes = store(saved);
  // язык берётся из того же getItem: у commitPrefs свой ключ, но подмена отвечает одним значением на всё
  const q = `?lang=${language}&s=${tag}`;
  const a = await import(pathToFileURL(path.join(oldDir, 'lib', `${name}.js`)).href + q);
  const b = await import(pathToFileURL(path.join(repo, 'src', 'lib', `${name}.ts`)).href + q);
  return [a, b, writes];
};

for (const language of ['ru', 'en']) {
  const [oldM, newM] = await loadPair('commitMsg', language, language, 'm');
  same('экспорт commitMsg', exportsOf(oldM), exportsOf(newM));
  for (const name of ['CC_TYPES', 'TICKET_FORMATS', 'DEFAULT_TEMPLATES']) same(name, json(oldM[name]), json(newM[name]));

  for (let k = 0; k < 3000; k++) {
    const s = summary();
    const pa = oldM.parseSummary(s), pb = newM.parseSummary(s);
    same(`parseSummary ${json(s)}`, json(pa), json(pb));
    same('headOf/buildSummary/caretOf', json([oldM.headOf(pa), oldM.buildSummary(pa), oldM.caretOf(pa)]), json([newM.headOf(pb), newM.buildSummary(pb), newM.caretOf(pb)]));
    same(`subjectOf ${json(s)}`, oldM.subjectOf(s), newM.subjectOf(s));
    const ticket = pick([...TICKETS, null, undefined, '']);
    const format = pick(['prefix', 'scope', 'suffix', 'footer', 'нет', undefined]);
    const ctx = pick([null, undefined, {}, { ticket, format }, { ticket }]);
    const desc = pick(DESCS);
    same('ticketInSummary', oldM.ticketInSummary(pa, ticket), newM.ticketInSummary(pb, ticket));
    same('hasTicket', oldM.hasTicket(s, desc, ticket), newM.hasTicket(s, desc, ticket));
    const type = pick(TYPES);
    same(`toggleType ${json([s, type, ctx])}`, json(oldM.toggleType(s, type, ctx)), json(newM.toggleType(s, type, ctx)));
    const scope = pick(['ui', '', '  (core)\n', null, 'PROJ-123']);
    same(`setScope ${json([s, scope, ctx])}`, json(oldM.setScope(s, scope, ctx)), json(newM.setScope(s, scope, ctx)));
    same(`toggleBreaking ${json([s, ctx])}`, json(oldM.toggleBreaking(s, ctx)), json(newM.toggleBreaking(s, ctx)));
    if (ticket) {
      same(`toggleTicket ${json([s, desc, ticket, format])}`, json(oldM.toggleTicket(s, desc, ticket, format)), json(newM.toggleTicket(s, desc, ticket, format)));
      same(`attachTicket ${json([s, desc, ticket, format])}`, json(oldM.attachTicket(s, desc, ticket, format)), json(newM.attachTicket(s, desc, ticket, format)));
    }
  }
  for (const s of [null, undefined, 5, '']) same(`parseSummary ${s}`, json(oldM.parseSummary(s)), json(newM.parseSummary(s)));

  for (let k = 0; k < 3000; k++) {
    const b = rnd() < 0.05 ? pick([null, undefined, '', '  ']) : branch();
    const pattern = rnd() < 0.7 ? '' : pick(PATTERNS);
    same(`extractTicket ${json([b, pattern])}`, oldM.extractTicket(b, pattern), newM.extractTicket(b, pattern));
  }
  same('extractTicket без шаблона', oldM.extractTicket('feature/PROJ-1'), newM.extractTicket('feature/PROJ-1'));

  for (let k = 0; k < 2000; k++) {
    const paths = rnd() < 0.05 ? pick([null, undefined, [], ['', null]]) : Array.from({ length: 1 + int(6) }, filePath);
    const max = pick([undefined, 1, 3, 6, 0]);
    same(`suggestScopes ${json(paths)}`, json(oldM.suggestScopes(paths, max)), json(newM.suggestScopes(paths, max)));
  }
  for (const body of BODIES) {
    for (const vars of [undefined, null, {}, { ticket: 'PROJ-1', branch: 'main' }, { ticket: null }]) same(`fillTemplate ${json([body, vars])}`, oldM.fillTemplate(body, vars), newM.fillTemplate(body, vars));
    for (const desc of [...DESCS, null, undefined]) same(`insertTemplate ${json([desc, body])}`, json(oldM.insertTemplate(desc, body)), json(newM.insertTemplate(desc, body)));
  }

  // commitPrefs: начальное значение из хранилища, затем правки
  const saves = ['null', '', '{испорчен', '[]', '5', json({ chips: false, ticketFormat: 'footer', ticketPattern: 'x'.repeat(400), templates: [{ name: 'A', body: 'b' }, { id: 7, name: 'x'.repeat(100), body: 'y'.repeat(9000) }, null, { name: 1, body: 'z' }] }), json({ ticketFormat: 'нет', useGitTemplate: 0, templates: 'не список' })];
  for (const [i, saved] of saves.entries()) {
    const [oldP, newP, writes] = await loadPair('commitPrefs', language, saved, `p${i}`);
    same('экспорт commitPrefs', exportsOf(oldP), exportsOf(newP));
    same(`getCommitPrefs из ${saved}`, json(oldP.getCommitPrefs()), json(newP.getCommitPrefs()));
    same('DEFAULT_COMMIT_PREFS', json(oldP.DEFAULT_COMMIT_PREFS), json(newP.DEFAULT_COMMIT_PREFS));
    const patches = [
      { chips: false }, (prev) => ({ ticketAuto: !prev.ticketAuto }), { ticketFormat: 'scope' }, { ticketFormat: 7 }, { ticketPattern: 5 },
      { templates: [{ name: 'Свой', body: 'тело' }] }, { templates: null }, null, undefined, 'строка',
    ];
    for (const patch of patches) {
      oldP.setCommitPrefs(patch);
      const a = json(oldP.getCommitPrefs());
      newP.setCommitPrefs(patch);
      same(`setCommitPrefs ${String(patch)}`, a, json(newP.getCommitPrefs()));
    }
    oldP.resetCommitPrefs();
    newP.resetCommitPrefs();
    same('resetCommitPrefs', json(oldP.getCommitPrefs()), json(newP.getCommitPrefs()));
    // Записи в хранилище: старые и новые идут поочерёдно, каждая пара должна совпасть
    for (let w = 0; w + 1 < writes.length; w += 2) same('localStorage.setItem', json(writes[w]), json(writes[w + 1]));
  }
}
console.log(`совпало проверок: ${count()}`);
