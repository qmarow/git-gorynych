// Перевод интерфейса: семантический ключ Fluent — t('branch-already-exists', name).
// Сообщения — crates/gorynych-core/i18n/{ru,en}/ui.ftl; аргументы t()/tj() по порядку — переменные { $a0 }, { $a1 }…
// Нет английского текста — показывается русский; нет ключа вовсе — сам ключ (так старый код с русским текстом
// вместо ключа показывает его как есть).
// Язык меняется в Настройках → Оформление: окно перезагружается, и весь интерфейс строится на новом языке.
//
// Подстановка — как в 1.x: сообщение раскрывается Fluent один раз с аргументами «{0}», «{1}»… и кэшируется, дальше
// /\{(\d+)\}/g заменяет их значениями (однопроходно; без аргументов и при нехватке аргументов «{N}» остаётся как есть).
import { Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import ruFtl from '../../crates/gorynych-core/i18n/ru/ui.ftl?raw';
import enFtl from '../../crates/gorynych-core/i18n/en/ui.ftl?raw';
import type { MessageId } from './messages.ts';

export type { MessageId };

export type Language = 'ru' | 'en';

export const LANGUAGES: readonly { id: Language; label: string; english: string }[] = [
  { id: 'ru', label: 'Русский', english: 'Russian' },
  { id: 'en', label: 'English', english: 'English' },
];
const KEY = 'language';
const SOURCES: Record<Language, string> = { ru: ruFtl, en: enFtl };

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

// Аргументы Fluent для раскрытия шаблона: $aN → «{N}»
const PLACEHOLDERS = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`a${i}`, `{${i}}`]));

interface Catalog {
  bundle: FluentBundle;
  cache: Map<string, string | null>;
}
const catalogs: Partial<Record<Language, Catalog>> = {};

function catalog(language: Language): Catalog {
  let c = catalogs[language];
  if (!c) {
    const bundle = new FluentBundle(language, { useIsolating: false });
    bundle.addResource(new FluentResource(SOURCES[language]));
    c = catalogs[language] = { bundle, cache: new Map() };
  }
  return c;
}

/** Шаблон сообщения с «{N}» на местах аргументов; null — ключа нет. */
function template(language: Language, id: string): string | null {
  const c = catalog(language);
  let s = c.cache.get(id);
  if (s === undefined) {
    const value = c.bundle.getMessage(id)?.value;
    s = value ? c.bundle.formatPattern(value, PLACEHOLDERS) : null;
    c.cache.set(id, s);
  }
  return s;
}

const lookup = (id: string): string => (lang === 'ru' ? null : template(lang, id)) ?? template('ru', id) ?? id;

/** Строка: t('files-deleted', n). Подстановки { $a0 }, { $a1 }… — по порядку аргументов */
export function t(msg: MessageId, ...args: unknown[]): string {
  const s = lookup(msg);
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)] ?? '') : m));
}

/** Часть разметки `tj`: элемент (для `<n>…</n>` и `{n}`) или значение для `{n}`. */
export type TjPart = ReactNode;

/**
 * Текст с разметкой для JSX: tj('press-save-or', [<B />, kbdNode]) для «Нажмите <0>Сохранить</0> или {1}».
 * <n>…</n> — элемент parts[n] с переведённым содержимым, {n} — значение parts[n] (строка, число или элемент).
 */
export function tj(msg: MessageId, parts: readonly TjPart[] = []): ReactNode {
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
