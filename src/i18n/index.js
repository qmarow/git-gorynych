// Перевод интерфейса. Ключ — русский текст (как в gettext): t('Ветка «{0}» уже существует', name).
// Русский — язык исходников, ему словарь не нужен; английский — electron/i18n/en.json (общий с main-процессом).
// Язык меняется в Настройках → Оформление: окно перезагружается, и весь интерфейс строится на новом языке.
import { Fragment, cloneElement, createElement, isValidElement } from 'react';
import en from '../../electron/i18n/en.json';

export const LANGUAGES = [
  { id: 'ru', label: 'Русский', english: 'Russian' },
  { id: 'en', label: 'English', english: 'English' },
];
const KEY = 'language';
const DICTS = { en };

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {
    /* хранилище недоступно */
  }
  return 'ru'; // по умолчанию — русский (язык исходников); английский выбирается в Настройках
}

let lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLanguage = () => lang;
/** Локаль для дат и чисел: toLocaleString(locale()) */
export const locale = () => (lang === 'en' ? 'en-GB' : 'ru-RU');

/** Сменить язык: запоминаем, сообщаем main-процессу (меню, сообщения git) и перерисовываем окно */
export async function setLanguage(next) {
  if (!LANGUAGES.some((l) => l.id === next) || next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* не страшно */
  }
  try {
    await window.api?.app?.setLanguage?.(next);
  } catch {
    /* main-процесс подхватит при следующем запуске */
  }
  window.location.reload();
}

/** Сообщить main-процессу язык окна (при запуске) */
export function syncLanguageToMain() {
  try {
    window.api?.app?.setLanguage?.(lang);
  } catch {
    /* нет моста — тесты, браузер */
  }
}

const lookup = (msg) => (lang === 'ru' ? msg : DICTS[lang]?.[msg] ?? msg);

/** Строка: t('Удалено файлов: {0}', n). Подстановки {0}, {1}… — по порядку аргументов */
export function t(msg, ...args) {
  const s = lookup(msg);
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)] ?? '') : m));
}

/** Сообщение без перевода, если его нет в словаре (для текста, пришедшего из main-процесса) */
export const translateKnown = (msg) => (typeof msg === 'string' && lang !== 'ru' ? DICTS[lang]?.[msg] ?? msg : msg);

/**
 * Текст с разметкой для JSX: tj('Нажмите <0>Сохранить</0> или {1}', [<B />, kbdNode]).
 * <n>…</n> — элемент parts[n] с переведённым содержимым, {n} — значение parts[n] (строка, число или элемент).
 */
export function tj(msg, parts = []) {
  const s = lookup(msg);
  const nodes = parse(s, parts);
  if (nodes.every((n) => typeof n === 'string' || typeof n === 'number')) return nodes.join('');
  return createElement(Fragment, null, ...nodes);
}

function parse(s, parts) {
  const out = [];
  const re = /<(\d+)>|<\/(\d+)>|\{(\d+)\}/g;
  let pos = 0;
  const stack = [{ idx: null, children: out }];
  let m;
  while ((m = re.exec(s))) {
    if (m.index > pos) stack[stack.length - 1].children.push(s.slice(pos, m.index));
    pos = re.lastIndex;
    if (m[1] !== undefined) stack.push({ idx: Number(m[1]), children: [] });
    else if (m[2] !== undefined) {
      if (stack.length > 1) {
        const top = stack.pop();
        const el = parts[top.idx];
        const node = isValidElement(el) ? cloneElement(el, { key: `t${top.idx}` }, ...(top.children.length ? top.children : [])) : top.children.join('');
        stack[stack.length - 1].children.push(node);
      }
    } else {
      const v = parts[Number(m[3])];
      stack[stack.length - 1].children.push(isValidElement(v) ? cloneElement(v, { key: `v${m[3]}` }) : v ?? '');
    }
  }
  if (pos < s.length) stack[stack.length - 1].children.push(s.slice(pos));
  while (stack.length > 1) {
    const top = stack.pop();
    stack[stack.length - 1].children.push(...top.children);
  }
  return out.filter((n) => n !== '' && n !== null && n !== undefined && n !== false);
}
