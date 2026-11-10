import { t } from '../i18n/index.ts';
/**
 * Платформа, на которой запущено приложение, и всё, что от неё зависит в интерфейсе:
 * шорткаты (⌘ вместо Ctrl на macOS), модификатор в обработчиках клавиш, тексты про хранилище ключей.
 */

/** Как `process.platform`; мост может прислать и другое значение — оно идёт дальше как есть. */
export type Platform = 'darwin' | 'win32' | 'linux' | 'other' | (string & {});

const detect = (): Platform => {
  if (typeof window === 'undefined') return 'other';
  const fromApi = window.api?.platform as Platform | undefined;
  if (fromApi) return fromApi;
  // `userAgentData` есть в Chromium (WebView2, Electron), в типах DOM его пока нет
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = (nav.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('mac')) return 'darwin';
  if (p.includes('win')) return 'win32';
  if (p.includes('linux')) return 'linux';
  return 'other';
};

export const PLATFORM: Platform = detect();
export const IS_MAC = PLATFORM === 'darwin';
export const IS_WINDOWS = PLATFORM === 'win32';

/**
 * «Основной» модификатор: ⌘ на macOS, Ctrl на Windows/Linux.
 * На Mac Ctrl+клик — это правый клик, а Ctrl+буква — системные сочетания терминала, поэтому смотрим на metaKey.
 */
export const isMod = (e: { metaKey?: boolean; ctrlKey?: boolean } | null | undefined): boolean => Boolean(IS_MAC ? e?.metaKey : e?.ctrlKey);

const MAC_KEYS: Record<string, string> = { Ctrl: '⌘', Cmd: '⌘', Alt: '⌥', Option: '⌥', Shift: '⇧', Enter: '↩', Esc: '⎋', Backspace: '⌫', Delete: '⌦' };

/**
 * Шорткат для показа в интерфейсе: «Ctrl+Shift+O» → «⌘⇧O» на macOS, без изменений на остальных.
 * Работает и с текстом, где шорткат встречается внутри: «Сохранить (Ctrl+S)», «Ctrl+клик», «Filter (Ctrl + Alt + F)».
 * Переключение вкладок Ctrl+Tab на Mac остаётся на Control (⌃): ⌘Tab занят системой.
 * Не на Mac и для `null`/`undefined` текст возвращается как есть (не строкой).
 */
export function kb<T>(text: T, mac: boolean = IS_MAC): T | string {
  if (!mac || text == null) return text;
  // Клавиша после «+»: слово/символы до пробела или знака препинания — либо одиночный знак (Ctrl+, или Ctrl+/)
  return String(text).replace(/\b(?:(?:Ctrl|Cmd|Alt|Option|Shift)\s*\+\s*)+(?:[^\s,.;)»"']+|[,./;])/g, (combo) => {
    const parts = combo.split(/\s*\+\s*/);
    const key = parts.pop()!;
    if (parts.includes('Ctrl') && /^Tab$/i.test(key)) {
      return `⌃${parts.filter((p) => p !== 'Ctrl').map((p) => MAC_KEYS[p] ?? p).join('')}Tab`;
    }
    const mods = parts.map((p) => MAC_KEYS[p] ?? p).join('');
    // Слово после модификатора («клик», «колесо») пишем через «+»: ⌘+клик
    if (/^[а-яё]/i.test(key) || /^(click|wheel|drag|scroll)$/i.test(key)) return `${mods}+${key}`;
    return `${mods}${MAC_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key)}`;
  });
}

/** Где хранится зашифрованный токен — по-честному для каждой ОС. subject — что шифруется (по умолчанию «Токен») */
export function secretStorageText(platform: Platform = PLATFORM, subject: string = t('Токен')): string {
  const plural = /ые$|и$/.test(subject); // «Данные шифруются», «Токен шифруется»
  const verb = plural ? t('шифруются') : t('шифруется');
  const kept = plural ? t('хранятся') : t('хранится');
  if (platform === 'darwin') return t('{0} {1} в Связке ключей macOS (Keychain) и {2} только на этом компьютере.', subject, verb, kept);
  if (platform === 'win32') return t('{0} {1} средствами Windows (DPAPI) и {2} только на этом компьютере.', subject, verb, kept);
  return t('{0} {1} системным хранилищем ключей (GNOME Keyring / KWallet) и {2} только на этом компьютере.', subject, verb, kept);
}

/** Как установить Git — для подсказок «Git не найден» */
export function installGitHint(platform: Platform = PLATFORM): string {
  if (platform === 'darwin') return t('установите Git: в Терминале выполните xcode-select --install (или brew install git)');
  if (platform === 'win32') return t('установите Git for Windows (git-scm.com)');
  return t('установите Git из менеджера пакетов (например, sudo apt install git)');
}

/** Подпись пункта «открыть папку» в системном файловом менеджере */
export function openFolderLabel(platform: Platform = PLATFORM): string {
  if (platform === 'darwin') return t('Показать в Finder');
  if (platform === 'win32') return t('Открыть в Проводнике');
  return t('Открыть в файловом менеджере');
}

/** Подпись пункта «открыть терминал» */
export function openTerminalLabel(platform: Platform = PLATFORM): string {
  if (platform === 'darwin') return t('Открыть в Терминале');
  if (platform === 'win32') return t('Открыть в терминале (командной строке)');
  return t('Открыть в терминале');
}
