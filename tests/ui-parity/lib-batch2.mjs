// Сверка inlineDiff, cron, servers, ansi (src/lib/*.ts) с прежними .js на случайных входах.
// node tests/ui-parity/lib-batch2.mjs <папка со старыми lib/*.js> <корень репозитория>
import path from 'node:path';
import { setup, importAs, checker, exportsOf, random } from './hooks.mjs';

const [oldDir, repo] = process.argv.slice(2);
setup(repo);
const { same, count } = checker();
const rnd = random(23);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const int = (n) => Math.floor(rnd() * n);
const highlights = (map) => JSON.stringify({ entries: [...map.entries()], pairs: [...map.pairs.entries()], keys: Object.keys(map) });

// Строки кода: слова, числа, знаки, пробелы, кириллица
const WORDS = ['const', 'value', 'имя', 'файл', 'x', '_tmp', '42', '3.14', 'return', 'ёж', 'αβ', 'foo_bar', '😀'];
const PUNCT = [' ', '  ', '.', ',', '(', ')', '{', '}', ';', '=', '=>', '"', "'", '\t', '-', '+'];
const codeLine = (len) => Array.from({ length: len }, () => (rnd() < 0.55 ? pick(WORDS) : pick(PUNCT))).join('');
function mutate(s) {
  const tokens = s.split(/(\s+)/);
  for (let k = 0, edits = 1 + int(3); k < edits; k++) {
    const at = int(tokens.length + 1);
    const op = int(3);
    if (op === 0) tokens.splice(at, 0, pick(WORDS));
    else if (op === 1) tokens.splice(at, 1);
    else tokens[at] = pick([...WORDS, ...PUNCT]);
  }
  return tokens.join('');
}

// Кусочки логов
const ESC = '\x1b';
const SGR = ['[0m', '[1m', '[31m', '[32;1m', '[38;5;196m', '[38;5;8m', '[38;5;240m', '[38;5;100m', '[38;5m', '[38;2;10;20;30m', '[38;2m', '[22m', '[39m', '[m', '[2m', '[3m', '[4m', '[23m', '[24m', '[0K', '[2J', '[?25l', '(B', '[91m', '[97m'];
const TEXT = ['Running build', 'error: failed', 'ERROR: Job failed: exit code 1', 'ok', 'Сборка завершена', 'fatal: no repo', 'npm ERR! code 1', 'Traceback (most recent call last):', '✗ test', 'PASS', '', '  ', 'exit status 0', 'Error!'];
function logLine() {
  const kind = int(12);
  const name = pick(['build', 'step_script', 'prepare.x', 'a-b']);
  const ts = 1700000000 + int(1000);
  if (kind === 0) return `section_start:${ts}:${name}${pick(['', '[collapsed=true]', '[collapsed=false]'])}\r${ESC}[0K${pick(TEXT)}`;
  if (kind === 1) return `section_end:${ts}:${name}\r${ESC}[0K`;
  if (kind === 2) return `##[group]${pick(TEXT)}`;
  if (kind === 3) return pick(['##[endgroup]', '::endgroup::']);
  if (kind === 4) return `${pick(['##[error]', '##[warning]', '##[notice]', '##[debug]', '##[command]', '##[section]', '::error file=a.js,line=1::', '::warning::', '::group::'])}${pick(TEXT)}`;
  if (kind === 5) return `${pick(TEXT)}\r${pick(TEXT)}\r${ESC}${pick(SGR)}`;
  if (kind === 6) return `${pick(TEXT)} section_start:${ts}:${name}\r${ESC}[0Kтитул section_end:${ts + 1}:${name} хвост`;
  return Array.from({ length: 1 + int(4) }, () => (rnd() < 0.4 ? ESC + pick(SGR) : pick(TEXT))).join('');
}
const stampedLog = (lines) => lines.map((l) => (rnd() < 0.9 ? `2026-11-10T12:00:${String(int(60)).padStart(2, '0')}.${int(9999999)}Z ${l}` : l));

for (const language of ['ru', 'en']) {
  const load = (name) => Promise.all([importAs(path.join(oldDir, 'lib', `${name}.js`), language), importAs(path.join(repo, 'src', 'lib', `${name}.ts`), language)]);
  const [oldI, newI] = await load('inlineDiff');
  const [oldC, newC] = await load('cron');
  const [oldV, newV] = await load('servers');
  const [oldA, newA] = await load('ansi');
  for (const [name, a, b] of [['inlineDiff', oldI, newI], ['cron', oldC, newC], ['servers', oldV, newV], ['ansi', oldA, newA]]) same(`экспорт ${name}`, exportsOf(a), exportsOf(b));

  // inlineDiff
  for (let k = 0; k < 1500; k++) {
    const a = codeLine(int(30));
    const b = rnd() < 0.8 ? mutate(a) : codeLine(int(30));
    same(`diffLine ${JSON.stringify([a, b])}`, JSON.stringify(oldI.diffLine(a, b)), JSON.stringify(newI.diffLine(a, b)));
  }
  const long = codeLine(700);
  const longEdited = mutate(long);
  // Между пределом LCS (250 тыс. клеток) и 400 тыс.
  for (const words of [260, 290, 315]) {
    // слово и пробел — по токену: 2·words−1 токенов, 270–390 тыс. клеток
    const mid = Array.from({ length: words }, () => pick(['alpha', 'beta', 'имя', 'x'])).join(' ');
    // правка с обоих краёв: общих начала и конца нет, в LCS идёт вся строка
    const edited = `zz ${mutate(mid)} zz`;
    same(`diffLine ${words} слов`, JSON.stringify(oldI.diffLine(mid, edited)), JSON.stringify(newI.diffLine(mid, edited)));
  }
  same('diffLine длинная', JSON.stringify(oldI.diffLine(long, longEdited)), JSON.stringify(newI.diffLine(long, longEdited)));
  for (const [a, b] of [['', ''], ['', 'x'], ['  x', 'x  '], [' a ', 'a'], ['abc', 'abd'], ['имя файла', 'имя файлов']]) {
    same(`diffLine ${a}|${b}`, JSON.stringify(oldI.diffLine(a, b)), JSON.stringify(newI.diffLine(a, b)));
  }
  // Окно подбора пар — 6 добавленных строк: похожая строка на 1…8-м месте
  for (let at = 0; at < 9; at++) {
    const base = codeLine(20);
    const lines = [{ t: '-', text: base }];
    for (let k = 0; k < 9; k++) lines.push({ t: '+', text: k === at ? mutate(base) : 'совсем другое ' + k });
    same(`inlineHighlights окно ${at}`, highlights(oldI.inlineHighlights(lines)), highlights(newI.inlineHighlights(lines)));
  }
  for (let k = 0; k < 400; k++) {
    const lines = [];
    for (let block = 0, blocks = 1 + int(4); block < blocks; block++) {
      for (let c = int(3); c > 0; c--) lines.push({ t: ' ', text: codeLine(10) });
      const dels = Array.from({ length: int(k % 50 === 0 ? 30 : 6) }, () => codeLine(5 + int(20)));
      for (const d of dels) lines.push({ t: '-', text: d });
      for (const d of dels) if (rnd() < 0.7) lines.push({ t: '+', text: rnd() < 0.8 ? mutate(d) : codeLine(10) });
      for (let c = int(2); c > 0; c--) lines.push({ t: '+', text: codeLine(8) });
    }
    same('inlineHighlights', highlights(oldI.inlineHighlights(lines)), highlights(newI.inlineHighlights(lines)));
  }

  // cron
  same('CRON_PRESETS', JSON.stringify(oldC.CRON_PRESETS), JSON.stringify(newC.CRON_PRESETS));
  same('TIMEZONES', JSON.stringify(oldC.TIMEZONES), JSON.stringify(newC.TIMEZONES));
  same('localTimezone', oldC.localTimezone(), newC.localTimezone());
  const F = {
    min: ['*', '0', '5', '*/15', '*/1', '1-5', 'x', '07'],
    hour: ['*', '3', '0', '23', '*/2', '9,18', '1,2,3', '1-5', '24'],
    dom: ['*', '1', '2', '3', '11', '12', '13', '15', '21', '22', '23', '31', '111', '112', '1-5', '*/2', 'L'],
    mon: ['*', '1', '12', '13', '0', 'JAN', '1-3'],
    dow: ['*', '1-5', '0,6', '6,0', '6-7', '6,7', '1', '0', '7', '8', '1,3,5', '2-4', '1-7', 'MON', '*/2'],
  };
  for (let k = 0; k < 4000; k++) {
    const expr = [pick(F.min), pick(F.hour), pick(F.dom), pick(F.mon), pick(F.dow)].join(pick([' ', '  ', '\t']));
    same(`describeCron ${expr}`, oldC.describeCron(expr), newC.describeCron(expr));
  }
  for (const expr of [null, undefined, '', ' ', '* * * *', '* * * * * *', 5, '  0 3 * * *  ']) same(`describeCron ${expr}`, oldC.describeCron(expr), newC.describeCron(expr));

  // servers
  for (const name of ['SERVER_KINDS', 'CLOUD_SERVERS']) same(name, JSON.stringify(oldV[name]), JSON.stringify(newV[name]));
  const kinds = ['gitlab', 'github', 'gitea', 'bitbucket', 'other', 'нет', null, undefined];
  const bases = ['https://gitlab.example.com', 'https://git.x/', 'https://git.x///', '', null, undefined, 'https://github.com'];
  const hosts = ['github.com', 'bitbucket.org', 'gitlab.example.com', null, undefined];
  for (const kind of kinds) {
    same(`kindInfo ${kind}`, JSON.stringify(oldV.kindInfo(kind)), JSON.stringify(newV.kindInfo(kind)));
    for (const cloud of [undefined, false, true]) same(`kindLabel ${kind}`, oldV.kindLabel(kind, cloud), newV.kindLabel(kind, cloud));
    same(`tokenScopes ${kind}`, JSON.stringify(oldV.tokenScopes(kind)), JSON.stringify(newV.tokenScopes(kind)));
    same(`tokenPlaceholder ${kind}`, oldV.tokenPlaceholder(kind), newV.tokenPlaceholder(kind));
    same(`prefersToken ${kind}`, oldV.prefersToken(kind), newV.prefersToken(kind));
    for (const base of bases) for (const host of hosts) {
      same(`tokenPage ${kind} ${base} ${host}`, oldV.tokenPage(kind, base, host), newV.tokenPage(kind, base, host));
      same(`sshKeysPage ${kind} ${base} ${host}`, oldV.sshKeysPage(kind, base, host), newV.sshKeysPage(kind, base, host));
    }
  }

  // ansi
  same('ERROR_LINE', String(oldA.ERROR_LINE), String(newA.ERROR_LINE));
  for (let k = 0; k < 1500; k++) {
    let lines = Array.from({ length: int(40) }, logLine);
    if (k % 3 === 0) lines = stampedLog(lines);
    const text = lines.join(pick(['\n', '\r\n'])) + pick(['', '\n', `\n${ESC}[0K`, `\n${ESC}[0m\n`]);
    same(`parseLog ${JSON.stringify(text).slice(0, 200)}`, JSON.stringify(oldA.parseLog(text)), JSON.stringify(newA.parseLog(text)));
  }
  for (const text of ['', '\n', `${ESC}[0m`, 'one', '\r\n\r\n']) same(`parseLog ${JSON.stringify(text)}`, JSON.stringify(oldA.parseLog(text)), JSON.stringify(newA.parseLog(text)));
}
console.log(`совпало проверок: ${count()}`);
