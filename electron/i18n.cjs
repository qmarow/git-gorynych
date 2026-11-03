// Перевод сообщений main-процесса (ошибки git, проверки CI, меню). Ключ — русский текст, словарь общий с интерфейсом.
// Язык хранится в userData/language.json; интерфейс сообщает его при запуске и при смене (IPC app:set-language).
const fs = require('node:fs');
const path = require('node:path');

const DICTS = { en: require('./i18n/en.json') };
let lang = null;
let file = null;

function settingsFile() {
  if (file) return file;
  try {
    const { app } = require('electron');
    file = path.join(process.env.GK_TEST_USERDATA || app.getPath('userData'), 'language.json');
  } catch {
    file = null;
  }
  return file;
}

function getLanguage() {
  if (lang) return lang;
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).language;
    if (saved === 'ru' || saved === 'en') lang = saved;
  } catch {
    /* нет файла — по языку системы */
  }
  if (!lang) lang = 'ru'; // по умолчанию — русский; интерфейс сообщает выбранный язык при запуске
  return lang;
}

function setLanguage(next) {
  if (next !== 'ru' && next !== 'en') return getLanguage();
  const changed = next !== getLanguage();
  lang = next;
  try {
    const f = settingsFile();
    if (f) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ language: next }));
    }
  } catch {
    /* не сохранилось — до следующего запуска */
  }
  if (changed) for (const fn of listeners) fn(next);
  return lang;
}

const listeners = new Set();
const onLanguageChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function t(msg, ...args) {
  const l = getLanguage();
  const s = l === 'ru' ? msg : DICTS[l]?.[msg] ?? msg;
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)] ?? '') : m));
}

const locale = () => (getLanguage() === 'en' ? 'en-GB' : 'ru-RU');

module.exports = { t, locale, getLanguage, setLanguage, onLanguageChange };
