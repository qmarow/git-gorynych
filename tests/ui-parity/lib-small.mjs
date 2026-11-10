// Сверка format, stashName, dnd, syncStatus, avatars (src/lib/*.ts) с прежними .js.
// node tests/ui-parity/lib-small.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { setup, importAs, checker, exportsOf } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
Date.now = () => NOW;

const names = ['', ' ', 'Тимур', 'тимур онофрийчук', '  a  b  c ', 'ёжик', 'x', '😀 smile', 'Jean-Luc Picard', 'O\'Brien', 'ǆ', 'ß straße', null];
const isos = [
  ...[0, 10e3, 59e3, 61e3, 3599e3, 3601e3, 86399e3, 86401e3, 1.5 * 86400e3, 2 * 86400e3, 29 * 86400e3, 31 * 86400e3, 400 * 86400e3].map((ms) => new Date(NOW - ms).toISOString()),
  new Date(NOW + 3600e3).toISOString(), '2021-09-22T01:59:00+03:00', 'не дата', '', 0, null, undefined,
];
const stashes = [
  null, undefined, {}, { message: 'On main: gorynych-auto: feature/x' }, { message: 'On main: gitidea-auto:  dev  ' },
  { message: 'WIP on main: abc1234 Сообщение коммита' }, { message: 'WIP on dev: abc1234' }, { message: 'On fix/1: своё сообщение' },
  { message: 'On fix/1:' }, { message: 'странное' }, { message: '', id: 'stash@{3}' }, { message: 42 }, { id: null },
];
const emails = ['', null, 'User@Example.com', ' 12345+login@users.noreply.github.com ', 'login@users.noreply.github.com', 'x@users.noreply.github.com.evil', 'ёж@почта.рф'];

for (const language of ['ru', 'en']) {
  const load = (name) => Promise.all([importAs(path.join(oldDir, 'lib', `${name}.js`), language), importAs(path.join(repo, 'src', 'lib', `${name}.ts`), language)]);
  const [oldF, newF] = await load('format');
  const [oldS, newS] = await load('stashName');
  const [oldD, newD] = await load('dnd');
  const [oldY, newY] = await load('syncStatus');
  const [oldA, newA] = await load('avatars');
  for (const [name, a, b] of [['format', oldF, newF], ['stashName', oldS, newS], ['dnd', oldD, newD], ['syncStatus', oldY, newY], ['avatars', oldA, newA]]) same(`экспорт ${name}`, exportsOf(a), exportsOf(b));

  for (const name of names) {
    if (name !== null) same(`initials ${name}`, oldF.initials(name), newF.initials(name));
    same(`avatarColor ${name}`, oldF.avatarColor(name ?? undefined), newF.avatarColor(name ?? undefined));
  }
  same('initials()', oldF.initials(), newF.initials());
  for (const iso of isos) {
    same(`relativeTime ${iso}`, oldF.relativeTime(iso), newF.relativeTime(iso));
    same(`shortDate ${iso}`, oldF.shortDate(iso), newF.shortDate(iso));
    same(`fullDate ${iso}`, oldF.fullDate(iso), newF.fullDate(iso));
    same(`shortAgo ${iso}`, oldS.shortAgo(iso), newS.shortAgo(iso));
  }
  same('FILE_STATUS', JSON.stringify(oldF.FILE_STATUS), JSON.stringify(newF.FILE_STATUS));
  for (let n = -30; n <= 260; n++) for (const x of [n, n + 0.5]) same(`plural ${x}`, oldF.plural(x, 'файл', 'файла', 'файлов'), newF.plural(x, 'файл', 'файла', 'файлов'));
  for (const st of stashes) same(`describeStash ${JSON.stringify(st)}`, JSON.stringify(oldS.describeStash(st)), JSON.stringify(newS.describeStash(st)));

  // dnd: подставной документ и dataTransfer записывают все вызовы
  const run = (mod) => {
    const log = [];
    globalThis.document = { createElement: (tag) => ({ tag, style: {}, remove: () => log.push('remove') }), body: { appendChild: (el) => log.push(['append', el.tag, el.textContent, JSON.stringify(el.style)]) } };
    const store = new Map();
    const transfer = { types: [], setData: (k, v) => { store.set(k, v); transfer.types.push(k); log.push(['set', k, v]); }, getData: (k) => store.get(k) ?? '', setDragImage: (el, x, y) => log.push(['image', el.tag, x, y]) };
    for (const payload of [{ kind: 'commit', hash: 'abc', label: 'Коммит' }, { kind: 'branch', hash: 'def', name: 'main', label: 'main' }]) {
      mod.startRefDrag({ dataTransfer: transfer }, payload);
      log.push(['effect', transfer.effectAllowed], mod.hasRefDrag({ dataTransfer: transfer }), JSON.stringify(mod.readRefDrag({ dataTransfer: transfer })));
    }
    log.push(mod.hasRefDrag({}), mod.hasRefDrag({ dataTransfer: null }), mod.readRefDrag({ dataTransfer: { getData: () => '{испорчен' } }), mod.REF_MIME);
    return JSON.stringify(log);
  };
  same('dnd', run(oldD), run(newD));
  await new Promise((resolve) => setTimeout(resolve, 5)); // ghost.remove() по таймеру
  delete globalThis.document; // иначе i18n следующего языка примет его за настоящий

  for (const name of ['SYNC_MODES', 'DEFAULT_SYNC_MODE', 'BACKGROUND_SEC', 'BACKOFF_SEC']) same(name, JSON.stringify(oldY[name]), JSON.stringify(newY[name]));
  for (const mode of ['realtime', 'fast', 'standard', 'rare', 'нет', undefined, null]) {
    same(`syncModeById ${mode}`, JSON.stringify(oldY.syncModeById(mode)), JSON.stringify(newY.syncModeById(mode)));
    for (const focused of [true, false]) for (const failures of [undefined, 0, 1, 2, 3, 4, 9]) for (const retryAfter of [undefined, 0, null, 10, 100, 1000]) {
      const p = { mode, focused, failures, retryAfter };
      same(`nextDelay ${JSON.stringify(p)}`, oldY.nextDelay(p), newY.nextDelay(p));
    }
  }
  // setSyncStatus и useSyncStatus без React не проверить: подписка доступна только через хук

  for (const email of [...emails, ...emails]) {
    const [a, b] = await Promise.all([oldA.avatarUrl(email), newA.avatarUrl(email)]);
    same(`avatarUrl ${email}`, a, b);
  }
  for (const url of ['u1', 'u2']) {
    same('markFailed', oldA.markFailed(url).size, newA.markFailed(url).size);
    same('isFailed', oldA.isFailed(url), newA.isFailed(url));
  }
  same('isFailed нет', oldA.isFailed('u3'), newA.isFailed('u3'));
}
console.log(`совпало проверок: ${count()}`);
