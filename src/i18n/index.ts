// Перевод интерфейса. Ключ — русский текст (как в gettext): t('Ветка «{0}» уже существует', name).
// Русский — язык исходников, ему словарь не нужен; английский — electron/i18n/en.json (общий с main-процессом).
// Язык меняется в Настройках → Оформление: окно перезагружается, и весь интерфейс строится на новом языке.
import { Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import enJson from '../../electron/i18n/en.json';

export type Language = 'ru' | 'en';

export const LANGUAGES: readonly { id: Language; label: string; english: string }[] = [
  { id: 'ru', label: 'Русский', english: 'Russian' },
  { id: 'en', label: 'English', english: 'English' },
];
const KEY = 'language';
// Плоский словарь «русский текст → перевод»; тип общий, а не выведенный из 4 тыс. ключей
const DICTS: Partial<Record<Language, Record<string, string>>> = { en: enJson as Record<string, string> };

const isLanguage = (value: unknown): value is Language => LANGUAGES.some((l) => l.id === value);

function detect(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* хранилище недоступно */
  }
  return 'ru'; // по умолчанию — русский (язык исходников); английский выбирается в Настройках
}

let lang: Language = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** `app.setLanguage` моста: в Electron — preload, в 2.0 — слой совместимости. В тестах и браузере моста нет. */
const appBridge = () => window.api?.app as { setLanguage?: (language: Language) => unknown } | undefined;

export const getLanguage = (): Language => lang;
/** Локаль для дат и чисел: toLocaleString(locale()) */
export const locale = (): string => (lang === 'en' ? 'en-GB' : 'ru-RU');

/** Сменить язык: запоминаем, сообщаем main-процессу (меню, сообщения git) и перерисовываем окно */
export async function setLanguage(next: unknown): Promise<void> {
  if (!isLanguage(next) || next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* не страшно */
  }
  try {
    await appBridge()?.setLanguage?.(next);
  } catch {
    /* main-процесс подхватит при следующем запуске */
  }
  window.location.reload();
}

/** Сообщить main-процессу язык окна (при запуске) */
export function syncLanguageToMain(): void {
  try {
    appBridge()?.setLanguage?.(lang);
  } catch {
    /* нет моста — тесты, браузер */
  }
}

const lookup = (msg: string): string => (lang === 'ru' ? msg : DICTS[lang]?.[msg] ?? msg);

/** Строка: t('Удалено файлов: {0}', n). Подстановки {0}, {1}… — по порядку аргументов */
export function t(msg: string, ...args: unknown[]): string {
  const s = lookup(msg);
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)] ?? '') : m));
}

/** Сообщение без перевода, если его нет в словаре (для текста, пришедшего из main-процесса) */
export function translateKnown<T>(msg: T): T | string {
  return typeof msg === 'string' && lang !== 'ru' ? DICTS[lang]?.[msg] ?? msg : msg;
}

/** Часть разметки `tj`: элемент (для `<n>…</n>` и `{n}`) или значение для `{n}`. */
export type TjPart = ReactNode;

/**
 * Текст с разметкой для JSX: tj('Нажмите <0>Сохранить</0> или {1}', [<B />, kbdNode]).
 * <n>…</n> — элемент parts[n] с переведённым содержимым, {n} — значение parts[n] (строка, число или элемент).
 */
export function tj(msg: string, parts: readonly TjPart[] = []): ReactNode {
  const s = lookup(msg);
  const nodes = parse(s, parts);
  if (nodes.every((n) => typeof n === 'string' || typeof n === 'number')) return nodes.join('');
  return createElement(Fragment, null, ...nodes);
}

interface Frame {
  idx: number | null;
  children: ReactNode[];
}

function parse(s: string, parts: readonly TjPart[]): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\d+)>|<\/(\d+)>|\{(\d+)\}/g;
  let pos = 0;
  const stack: Frame[] = [{ idx: null, children: out }];
  const top = () => stack[stack.length - 1];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > pos) top().children.push(s.slice(pos, m.index));
    pos = re.lastIndex;
    if (m[1] !== undefined) stack.push({ idx: Number(m[1]), children: [] });
    else if (m[2] !== undefined) {
      if (stack.length > 1) {
        const frame = stack.pop()!;
        const el = parts[frame.idx!];
        const node = isValidElement(el) ? cloneElement(el as ReactElement, { key: `t${frame.idx}` }, ...(frame.children.length ? frame.children : [])) : frame.children.join('');
        top().children.push(node);
      }
    } else {
      const v = parts[Number(m[3])];
      top().children.push(isValidElement(v) ? cloneElement(v as ReactElement, { key: `v${m[3]}` }) : v ?? '');
    }
  }
  if (pos < s.length) top().children.push(s.slice(pos));
  while (stack.length > 1) {
    const frame = stack.pop()!;
    top().children.push(...frame.children);
  }
  return out.filter((n) => n !== '' && n !== null && n !== undefined && n !== false);
}
