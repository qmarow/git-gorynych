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

fs.rmSync(userData, { recursive: true, force: true });
const out = { base: baseCases, keys: keyCases };
fs.writeFileSync(path.join(__dirname, 'parity.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`base=${baseCases.length} (errors=${baseCases.filter((c) => c.error).length}) keys=${keyCases.length}`);
