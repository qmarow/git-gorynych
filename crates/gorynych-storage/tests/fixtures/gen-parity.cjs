// Генератор эталона: прогоняет настоящий electron/cicd/settings.cjs и записывает результаты в parity.json.
// Запуск из корня репозитория: node crates/gorynych-storage/tests/fixtures/gen-parity.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gorynych-parity-'));
process.env.GK_TEST_USERDATA = userData;

const settings = require(path.join(root, 'electron/cicd/settings.cjs'));
const { serializeError } = require(path.join(root, 'electron/errors.cjs'));
const { setLanguage } = require(path.join(root, 'electron/i18n.cjs'));

const BASES = [
  null, '', '   ', '/', '///',
  'gitlab.company.ru', 'gitlab.company.ru/', 'GitLab.Company.RU/Api/V4/', 'localhost:8080', 'host:443/x',
  'https://a.b', 'https://a.b/', 'https://a.b/c/d///', '  https://a.b/c/  ', 'HTTPS://GitLab.Company.RU:443/api/v4/',
  'http://x:8080/a//', 'http://h:80', 'https://h:80', 'http://h:443', 'HtTp://h',
  'https://user:pw@h/p?q=1#f', 'h?x=1', 'h#f', 'https://h/a/../b', 'https://h/a/./b/', 'https://h/a%20b/c d',
  'http://[::1]:3000/p', 'https://192.168.0.1:3000/', 'https://пример.рф/путь', 'пример.рф',
  'ftp://x', 'ssh://git@x/y', 'git+ssh://x', 'FILE://x', 'a.b-c+d://x',
  'https://', 'http://', 'https:// /x', 'a b', 'https://a b', 'x:y', 'h:99999', 'https://h:abc', '1://x', '-a://x', 'a_b://x',
  'https:/a.b', 'https:a.b', 'tel:123', 'mailto:a@b.c',
];

const baseCases = [];
for (const language of ['ru', 'en']) {
  setLanguage(language);
  for (const input of BASES) {
    try {
      baseCases.push({ language, input, ok: settings.normalizeBase(input) });
    } catch (error) {
      baseCases.push({ language, input, error: serializeError(error) });
    }
  }
}
setLanguage('ru');

const KEYS = [
  ['github.com', 'a/b'], ['GitHub.COM', 'A/B'], ['h', '/a/b/'], ['h', '///a/b///'], ['h', 'a/b.git'], ['h', 'a/b.GIT'], ['h', '/a/b.git/'],
  ['h', 'a/b.git.git'], ['h', 'a/b.git/'], ['h', '.git'], ['h', ''], ['h', '/'], ['', 'a'], ['Хост.РФ', 'Группа/Проект.git'], ['h:8443', 'a/b'],
  ['h', 'a//b'], ['h', ' a/b '],
];
const file = path.join(userData, 'cicd-settings.json');
const keyCases = KEYS.map(([host, repoPath]) => {
  fs.rmSync(file, { force: true });
  settings.set(host, repoPath, { provider: 'gitlab' });
  return { host, repoPath, key: Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).repos)[0] };
});

/* =================== credentials.cjs =================== */

const sshDir = path.join(userData, 'ssh');
process.env.GK_TEST_SSH_DIR = sshDir;
const creds = require(path.join(root, 'electron/credentials.cjs'));
const credFile = path.join(userData, 'remote-credentials.json');
const plain = (text) => ({ plain: Buffer.from(text).toString('base64') });
const UNREADABLE = { enc: 'AAAA' }; // в Node нет safeStorage: такую запись прочитать нельзя

// ---------- Разбор адресов: без состояния ----------
const URLS = [
  'https://github.com/a/b.git', 'https://GitHub.com/A/B.GIT/', 'http://git.local:8080/group/sub/app', 'https://host:443/x', 'http://host:80/x', 'http://host:443/x', 'HTTPS://Host/Path',
  'https://user@host/a', 'https://us%40er:pw@host/a', 'https://%D1%8E@host/a', 'https://%zz@host/a', 'https://%FF@host/a', 'https://%+f@host/a', 'https://host/%+f/c', 'https://%-1@host/a', 'https://host/%D0%B0%20b/c.git', 'https://host/%zz/c', 'https://host/%FF/c',
  'https://host', 'https://host/', 'https://', 'https:// bad', 'https://host:abc/x', '  https://host/a.git  ', 'https://host/a?x=1#f', 'https://[::1]:3000/a/b',
  'git@github.com:a/b.git', 'git@GitHub.COM:A/B.git', 'github.com:a/b', 'host:/abs/path.git', 'host://x', 'a@b://x', 'a:b@c://x', 'a:b@c:d/e', 'a@b@c:d', 'a@x:p', 'C:\\repo', 'C:/repo', 'c:repo', 'ab:repo', 'я:x', '😀:x',
  'user@host:', 'host:', ':x', '@host:x', 'a/b:c', 'a\\b:c', 'git@host:a/b.git\nmore', 'git@host://x',
  'ssh://git@host/a/b.git', 'ssh://git@Host:2222/a/b.git', 'SSH://host/a.git', 'ssh://host', 'ssh://host/', 'ssh://u:p@host/a', 'ssh://@host/a', 'ssh:///a', 'ssh://host/a\nb', 'ſsh://host/a',
  '/local/path', '../rel', 'file:///c/x', 'git://host/a.git', 'relative', '', '   ',
];
const urlCases = URLS.map((url) => ({
  url,
  target: creds.parseTarget(url),
  path: creds.repoPathOf(url),
  key: creds.repoKeyOf(url),
  ssh: creds.sshUrlFor(url),
}));

const SERVERS = [
  'gitlab.company.ru', 'GitLab.Company.RU', 'gitlab.company.ru:8443', 'http://git.local', 'https://git.company.ru:8443/group/app', 'git@host:group/app.git', 'host:group/app', 'host:8443', 'host:8443/x', 'host:443',
  'ssh://git@host:2222/a', 'SSH://Host/a', 'ssh://host', '  host  ', 'https://host:443', 'http://host:80', '192.168.0.1:3000', '[::1]:3000', 'http://[::1]:3000', 'пример.рф', 'xn--e1afmkfd.xn--p1ai',
  '', '   ', '-bad', 'bad-', '.bad', 'bad.', 'a_b', 'a b', 'a@b', 'https://', 'http://:80', 'host:abc', 'x@y:', 'a:b@c:d', 'a:b@c://d', 'h\u00a0x:y', 'user name@host:x',
];
const serverCases = SERVERS.map((input) => {
  try {
    return { input, ok: creds.parseServer(input) };
  } catch (error) {
    return { input, error: serializeError(error) };
  }
});

const KINDS = ['github.com', 'GITLAB.com', 'bitbucket.org', 'codeberg.org', 'gitlab.x.ru', 'my-github.io', 'gitea.local', 'forgejo.local', 'bitbucket.local', 'plain.host', '', 'gitlabgithub'];
const guessCases = KINDS.map((host) => ({ host, kind: creds.guessKind(host) }));

// ---------- Сценарий: одна и та же последовательность вызовов ----------
// {TMP} в аргументах и результатах — временная папка. Файлы-ключи создаются из keyFiles.
const keyFiles = ['id_key', 'id_other', 'key.pub'];
for (const name of keyFiles) fs.writeFileSync(path.join(userData, name), 'key');
const KEY = '{TMP}/id_key';
const OTHER = '{TMP}/id_other';

const GL = 'https://gitlab.company.ru/group/app.git';
const GL2 = 'https://gitlab.company.ru/group/other.git';
const GH = 'https://github.com/me/repo.git';
const SSH = 'git@gitlab.company.ru:group/app.git';
const SSH2 = 'ssh://git@host.example:2222/x/y.git';
const seedA = {
  hosts: {
    'https://shared.example': { method: 'password', username: 'u', secret: plain('host-pass'), savedAt: 't' },
    'https://shared.example:8443': { method: 'token', username: 'oauth2', secret: plain('glpat-host') },
    'ssh://shared.example': { method: 'ssh', keyPath: KEY, savedAt: 't' },
    'http://plain.example': { method: 'password', username: 'p', secret: UNREADABLE },
    'badkey': { method: 'password', username: 'x', secret: plain('x') },
  },
  repos: {
    'https://gitlab.x/a/b': { method: 'password', url: 'https://gitlab.x/a/b.git', username: 'u', secret: plain('plainpass') },
    'https://gitlab.x/a/c': { method: 'password', url: 'https://gitlab.x/A/C.git', username: 'u', secret: plain('glpat-abc') },
    'https://gitlab.x/a/d': { method: 'token', url: 'https://gitlab.x/a/d', username: 'oauth2', secret: UNREADABLE },
    'https://gitlab.x/a/e': { method: 'password', url: 'https://gitlab.x/a/e', username: 'u', secret: plain('p'), apiToken: plain('api-e') },
    'https://gitlab.x/a/f': { method: 'password', url: 'https://gitlab.x/a/f', username: 'u', secret: plain('p'), apiToken: UNREADABLE },
    'ssh://gitlab.x/a/g': { method: 'ssh', url: 'git@gitlab.x:a/g.git', keyPath: KEY },
    'https://gitlab.x/a/g': { method: 'token', url: 'https://gitlab.x/a/g', username: 'oauth2', secret: plain('tok-g') },
    'ssh://gitlab.x/a/h': { method: 'ssh', url: 'git@gitlab.x:a/h.git', keyPath: KEY, passphrase: plain('pp'), apiToken: plain('api-h') },
    'ssh://gitlab.x/a/i': { method: 'ssh', url: 'git@gitlab.x:a/i.git', keyPath: KEY, passphrase: UNREADABLE },
    // Оба входа годятся для API, SSH записан первым: HTTPS всё равно важнее
    'ssh://gitlab.x/a/j': { method: 'ssh', url: 'git@gitlab.x:a/j.git', keyPath: KEY, apiToken: plain('api-j-ssh') },
    'https://gitlab.x/a/j': { method: 'token', url: 'https://gitlab.x/a/j', username: 'oauth2', secret: plain('tok-j') },
    // Оба для API не годятся, SSH первым: в other попадает HTTPS-вход
    'ssh://gitlab.x/a/l': { method: 'ssh', url: 'git@gitlab.x:a/l.git', keyPath: KEY },
    'https://gitlab.x/a/l': { method: 'password', url: 'https://gitlab.x/a/l', username: 'u', secret: plain('nottoken') },
    // Токен для API у записи другого способа входа наследуется при смене способа
    'https://gitlab.x/a/k': { method: 'token', url: 'https://gitlab.x/a/k', username: 'oauth2', secret: plain('tok-k'), apiToken: plain('api-k') },
  },
  servers: {
    'gitlab.x': { kind: 'gitlab', base: 'https://gitlab.x:8443', savedAt: 't' },
    'only-saved.example': { kind: 'other', base: null },
    'github.com': { kind: 'gitlab' },
  },
};
const SCENARIO = [
  ['describe', GL], ['clear', GL], ['forgetLogin', 'x'], ['forgetServer', 'x'], ['listServers'], ['envFor', [GL]],
  // Проверки save по порядку
  ['save', '/local/path', { method: 'password' }], ['save', GL, {}], ['save', GL, { method: 'nope' }], ['save', GL], ['save', SSH, { method: 'password' }], ['save', SSH, { method: 'token' }], ['save', GL, { method: 'ssh', keyPath: KEY }],
  ['save', 'https://host.example', { method: 'password', kind: 'gitea', username: 'u', secret: 's' }], ['serverKind', 'host.example'], ['serverBase', 'host.example'],
  ['save', GL, { method: 'password' }], ['save', GL, { method: 'password', username: '  ' }], ['save', GL, { method: 'password', username: 'u' }], ['save', GL, { method: 'token', username: 'u' }],
  ['save', GL, { method: 'password', username: 'a\nb', secret: 's' }], ['save', GL, { method: 'password', username: 'u', secret: 'a\rb' }],
  ['save', GL, { method: 'password', username: 'u', secret: 's', apiToken: 'a b' }],
  ['save', SSH, { method: 'ssh' }], ['save', SSH, { method: 'ssh', keyPath: '  ' }], ['save', SSH, { method: 'ssh', keyPath: '{TMP}/none' }], ['save', SSH, { method: 'ssh', keyPath: '{TMP}/key.pub' }],
  // Успешные сохранения и прежние значения
  ['save', GL, { method: 'password', username: ' user ', secret: 'pass1', kind: 'gitlab' }], ['describe', GL], ['describe', 'https://GITLAB.company.ru/GROUP/APP'], ['envFor', [GL]],
  ['save', GL, { method: 'password', username: 'user2' }], ['describe', GL], ['envFor', [GL]],
  ['save', GL, { method: 'token', secret: 'glpat-new' }], ['describe', GL], ['envFor', [GL]],
  ['save', GL, { method: 'password', username: 'user3', secret: 'pass3', apiToken: ' api1 ' }], ['describe', GL], ['apiLoginFor', 'gitlab.company.ru', 'group/app'],
  ['save', GL, { method: 'password', username: 'user3' }], ['apiLoginFor', 'gitlab.company.ru', 'group/app'],
  ['save', GL, { method: 'password', username: 'user3', clearApiToken: true }], ['describe', GL], ['apiLoginFor', 'gitlab.company.ru', 'group/app'],
  ['save', GL2, { method: 'token', username: 'bot', secret: 'tok2' }],
  ['save', GH, { method: 'token', secret: 'ghp_x' }], ['describe', GH], ['save', 'https://bitbucket.org/a/b', { method: 'token', secret: 'x' }], ['describe', 'https://bitbucket.org/a/b'],
  ['save', SSH, { method: 'ssh', keyPath: KEY, passphrase: 'pp1' }], ['describe', SSH], ['envFor', [SSH]],
  ['save', SSH, { method: 'ssh', keyPath: KEY }], ['describe', SSH], ['envFor', [SSH]],
  ['save', SSH, { method: 'ssh', keyPath: OTHER }], ['describe', SSH], ['envFor', [SSH]],
  ['save', SSH, { method: 'ssh', keyPath: OTHER, passphrase: 'pp2', apiToken: 'api-ssh' }], ['save', SSH, { method: 'ssh', keyPath: OTHER, clearPassphrase: true }], ['describe', SSH],
  ['apiLoginFor', 'gitlab.company.ru', 'group/app'], ['listServers'],
  ['envFor', [GL, GL2, SSH, SSH2, GH, '/local', GL]], ['envFor', [GL2, GL]], ['envFor', [SSH2]],
  // Типы серверов
  ['setServer', 'Self.Hosted', { kind: 'gitlab', base: 'https://self.hosted:8443' }], ['serverKind', 'self.hosted:8443'], ['serverBase', 'SELF.hosted'], ['defaultTokenUser', 'self.hosted'], ['describe', 'git@self.hosted:a/b.git'],
  ['setServer', 'self.hosted', { kind: 'bitbucket' }], ['serverBase', 'self.hosted'], ['defaultTokenUser', 'self.hosted:1'], ['setServer', 'self.hosted', { kind: 'bad' }], ['setServer', '', { kind: 'bad' }],
  ['setServer', 'github.com', { kind: 'other' }], ['serverKind', 'github.com'], ['describe', GH], ['setServer', 'github.com', { kind: 'github' }], ['describe', GH], ['serverKind', ''], ['serverKind', 'unknown.host'], ['defaultTokenUser', 'unknown.host'],
  // Удаление
  ['attachApiToken', 'https://gitlab.company.ru/group/other', 'x'], ['attachApiToken', 'ssh://gitlab.company.ru/group/app', 'x'], ['attachApiToken', 'nope', 'x'],
  ['clear', GL2], ['clear', GL2], ['forgetLogin', 'https://github.com/me/repo'], ['forgetLogin', 'https://github.com/me/repo'], ['listServers'],
  ['forgetServer', 'GITLAB.company.ru'], ['forgetServer', 'gitlab.company.ru'], ['forgetServer', 'self.hosted'], ['listServers'],
  // Записи из 1.x: общие входы, нечитаемые секреты, порядок и выбор входа для API
  ['seed', seedA], ['listServers'],
  ['describe', 'https://shared.example/a/b.git'], ['describe', 'https://shared.example:8443/a/b.git'], ['describe', 'git@shared.example:a/b.git'], ['describe', 'http://plain.example/a'], ['describe', 'https://plain.example/a'],
  ['describe', 'https://gitlab.x/a/d'], ['describe', 'git@gitlab.x:a/h.git'], ['describe', 'git@gitlab.x:a/i.git'], ['describe', 'git@gitlab.x:a/zzz.git'],
  ['envFor', ['https://shared.example/a/b', 'https://shared.example:8443/c/d', 'git@shared.example:a/b.git', 'http://plain.example/a']], ['envFor', ['https://gitlab.x/a/d', 'https://gitlab.x/a/b']], ['envFor', ['git@gitlab.x:a/h.git', 'git@gitlab.x:a/g.git']], ['envFor', ['git@gitlab.x:a/i.git']],
  ['save', 'https://gitlab.x/a/k', { method: 'password', username: 'u', secret: 'pw-k' }], ['describe', 'https://gitlab.x/a/k'], ['apiLoginFor', 'gitlab.x', 'a/k'],
  ['save', 'https://gitlab.x/a/k', { method: 'token', username: 'u', secret: 'tok-k2' }], ['describe', 'https://gitlab.x/a/k'],
  ...['a/b', 'A/C.git', '/a/d/', 'a/e', 'a/f', 'a/g', 'a/h', 'a/i', 'a/j', 'a/l', 'a/none'].flatMap((p) => [['apiLoginFor', 'GitLab.x', p], ['apiLoginFor', 'gitlab.x', p, 'gitea'], ['apiLoginFor', 'gitlab.x', p, 'github']]),
  ['apiLoginFor', 'shared.example', 'a/b'], ['apiLoginFor', 'shared.example', 'a/b', 'gitea'], ['apiLoginFor', 'plain.example', 'a/b', 'gitea'],
  // Пустой пароль берётся из общего входа; смена способа входа его не наследует
  ['save', 'https://shared.example/a/b.git', { method: 'password', username: 'u' }], ['envFor', ['https://shared.example/a/b.git']], ['describe', 'https://shared.example/a/b.git'],
  ['save', 'https://shared.example/a/c.git', { method: 'token', username: 'u' }],
  ['clear', 'https://shared.example/a/b.git'], ['describe', 'https://shared.example/a/b.git'], ['clear', 'https://shared.example/a/b.git'], ['describe', 'https://shared.example/a/b.git'], ['clear', 'https://shared.example/a/b.git'],
  ['forgetLogin', 'ssh://shared.example'], ['forgetServer', 'shared.example'], ['forgetServer', 'only-saved.example'], ['attachApiToken', 'https://gitlab.x/a/b', 'new-api'], ['describe', 'https://gitlab.x/a/b'], ['attachApiToken', 'https://gitlab.x/a/b', 'again'], ['attachApiToken', 'https://gitlab.x/a/d', 'x'], ['attachApiToken', 'ssh://gitlab.x/a/h', 'x'], ['listServers'],
];

const sub = (value) => JSON.parse(JSON.stringify(value).replaceAll('{TMP}', userData.replaceAll('\\', '/')));
const unsub = (value) => {
  const tmp = userData.replaceAll('\\', '/');
  const walk = (v) => {
    if (typeof v === 'string') return v.replaceAll(tmp, '{TMP}');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'savedAt' && x !== null ? '<time>' : walk(x)]));
    }
    return v;
  };
  return walk(value === undefined ? null : value);
};
// envFor → что выбрано, независимо от способа передачи в git
function authOf(env) {
  const https = [];
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  for (let n = 0; n < count; n += 2) {
    const i = https.length;
    https.push({ server: env[`GIT_CONFIG_KEY_${n}`].replace(/^credential\.|\.helper$/g, ''), username: env[`GITIDEA_U_${i}`], secret: env[`GITIDEA_P_${i}`] });
  }
  const ssh = env.GIT_SSH_COMMAND ? { command: env.GIT_SSH_COMMAND, passphrase: env.GITIDEA_SSH_PASS ?? null } : null;
  return { https, ssh };
}
function replay(language) {
  setLanguage(language);
  fs.rmSync(credFile, { force: true });
  return SCENARIO.map(([op, ...rawArgs]) => {
    const args = sub(rawArgs);
    if (op === 'seed') {
      fs.writeFileSync(credFile, JSON.stringify(args[0]));
      return { op, args: rawArgs };
    }
    try {
      let result;
      if (op === 'envFor') result = authOf(creds.envFor(args[0]));
      else if (op === 'setServer') result = creds.setServer(args[0], args[1]);
      else if (op === 'apiLoginFor') result = creds.apiLoginFor(...args);
      else result = creds[op](...args);
      return { op, args: rawArgs, result: unsub(result) };
    } catch (error) {
      return { op, args: rawArgs, error: unsub(serializeError(error)) };
    }
  });
}
const scenario = { ru: replay('ru'), en: replay('en') };
setLanguage('ru');

// ---------- Ключи SSH ----------
fs.mkdirSync(sshDir, { recursive: true });
const NOW = 1_700_000_000_000;
const SSH_FILES = [
  ['id_ed25519', 'k', 5], ['id_ed25519.pub', 'ssh-ed25519 AAAA me@host extra  words\n', 5], ['id_rsa', 'k', 9], ['id_rsa.pub', 'ssh-rsa AAAA\n', 9], ['id_nopub', 'k', 1], ['id_ecdsa', 'k', 7], ['id_ecdsa.pub', 'ecdsa-sha2-nistp256 AAAA c', 7],
  ['work', 'k', 20], ['work.pub', 'ssh-ed25519 BBBB work', 20], ['nopub', 'k', 30], ['known_hosts', 'k', 40], ['known_hosts.old', 'k', 40], ['config', 'k', 40], ['authorized_keys', 'k', 40], ['environment', 'k', 40],
  ['.hidden', 'k', 40], ['.hidden.pub', 'x', 40], ['orphan.pub', 'ssh-rsa X', 40], ['empty', 'k', 15], ['empty.pub', '', 15], ['big', 'k'.repeat(64 * 1024 + 1), 40], ['big.pub', 'ssh-rsa X', 40], ['exact', 'k'.repeat(64 * 1024), 12], ['exact.pub', 'ssh-rsa Y', 12],
];
for (const [name, content, minutes] of SSH_FILES) {
  const file = path.join(sshDir, name);
  fs.writeFileSync(file, content);
  fs.utimesSync(file, new Date(NOW + minutes * 60000), new Date(NOW + minutes * 60000));
}
fs.mkdirSync(path.join(sshDir, 'id_dir'));
const sshList = creds.listSshKeys().keys.map(({ name, type, comment, hasPub, mtime }) => ({ name, type, comment, hasPub, mtime }));
const suggest = [['ed25519', null], ['rsa', 'Git.Company.ru'], ['ed25519', 'Git.Company.ru'], ['ed25519', 'Сервер №1'], ['ed25519', '...'], ['ed25519', '__a__b--'], ['rsa', 'a b  c']].map(([type, host]) => ({ type, host, name: creds.suggestKeyName(type, host) }));
const freeDir = path.join(userData, 'free');
const suggestFree = creds.suggestKeyName('rsa', 'h', freeDir);

fs.rmSync(userData, { recursive: true, force: true });
const out = {
  base: baseCases,
  keys: keyCases,
  urls: urlCases,
  servers: serverCases,
  guess: guessCases,
  keyFiles,
  scenario,
  ssh: { files: SSH_FILES.map(([name, content, minutes]) => ({ name, size: content.length, content: content.length > 100 ? null : content, mtime: NOW + minutes * 60000 })), list: sshList, suggest, suggestFree },
};
fs.writeFileSync(path.join(__dirname, 'parity.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`base=${baseCases.length} keys=${keyCases.length} urls=${urlCases.length} servers=${serverCases.length} scenario=${SCENARIO.length} ssh=${sshList.length}`);
