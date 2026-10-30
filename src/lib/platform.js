/**
 * Платформа, на которой запущено приложение, и всё, что от неё зависит в интерфейсе:
 * шорткаты (⌘ вместо Ctrl на macOS), модификатор в обработчиках клавиш, тексты про хранилище ключей.
 */

const detect = () => {
  if (typeof window === 'undefined') return 'other';
  const fromApi = window.api?.platform;
  if (fromApi) return fromApi;
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('mac')) return 'darwin';
  if (p.includes('win')) return 'win32';
  if (p.includes('linux')) return 'linux';
  return 'other';
};

export const PLATFORM = detect();
export const IS_MAC = PLATFORM === 'darwin';
export const IS_WINDOWS = PLATFORM === 'win32';

/**
 * «Основной» модификатор: ⌘ на macOS, Ctrl на Windows/Linux.
 * На Mac Ctrl+клик — это правый клик, а Ctrl+буква — системные сочетания терминала, поэтому смотрим на metaKey.
 */
export const isMod = (e) => Boolean(IS_MAC ? e?.metaKey : e?.ctrlKey);

const MAC_KEYS = { Ctrl: '⌘', Cmd: '⌘', Alt: '⌥', Option: '⌥', Shift: '⇧', Enter: '↩', Esc: '⎋', Backspace: '⌫', Delete: '⌦' };

/**
 * Шорткат для показа в интерфейсе: «Ctrl+Shift+O» → «⌘⇧O» на macOS, без изменений на остальных.
 * Работает и с текстом, где шорткат встречается внутри: «Сохранить (Ctrl+S)», «Ctrl+клик», «Filter (Ctrl + Alt + F)».
 * Переключение вкладок Ctrl+Tab на Mac остаётся на Control (⌃): ⌘Tab занят системой.
 */
export function kb(text, mac = IS_MAC) {
  if (!mac || text == null) return text;
  // Клавиша после «+»: слово/символы до пробела или знака препинания — либо одиночный знак (Ctrl+, или Ctrl+/)
  return String(text).replace(/\b(?:(?:Ctrl|Cmd|Alt|Option|Shift)\s*\+\s*)+(?:[^\s,.;)»"']+|[,./;])/g, (combo) => {
    const parts = combo.split(/\s*\+\s*/);
    const key = parts.pop();
    if (parts.includes('Ctrl') && /^Tab$/i.test(key)) {
      return `⌃${parts.filter((p) => p !== 'Ctrl').map((p) => MAC_KEYS[p] ?? p).join('')}Tab`;
    }
    const mods = parts.map((p) => MAC_KEYS[p] ?? p).join('');
    // Слово после модификатора («клик», «колесо») пишем через «+»: ⌘+клик
    if (/^[а-яё]/i.test(key)) return `${mods}+${key}`;
    return `${mods}${MAC_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key)}`;
  });
}

/** Где хранится зашифрованный токен — по-честному для каждой ОС. subject — что шифруется (по умолчанию «Токен») */
export function secretStorageText(platform = PLATFORM, subject = 'Токен') {
  const plural = /ые$|и$/.test(subject); // «Данные шифруются», «Токен шифруется»
  const verb = plural ? 'шифруются' : 'шифруется';
  const kept = plural ? 'хранятся' : 'хранится';
  if (platform === 'darwin') return `${subject} ${verb} в Связке ключей macOS (Keychain) и ${kept} только на этом компьютере.`;
  if (platform === 'win32') return `${subject} ${verb} средствами Windows (DPAPI) и ${kept} только на этом компьютере.`;
  return `${subject} ${verb} системным хранилищем ключей (GNOME Keyring / KWallet) и ${kept} только на этом компьютере.`;
}

/** Как установить Git — для подсказок «Git не найден» */
export function installGitHint(platform = PLATFORM) {
  if (platform === 'darwin') return 'установите Git: в Терминале выполните xcode-select --install (или brew install git)';
  if (platform === 'win32') return 'установите Git for Windows (git-scm.com)';
  return 'установите Git из менеджера пакетов (например, sudo apt install git)';
}

/** Подпись пункта «открыть папку» в системном файловом менеджере */
export function openFolderLabel(platform = PLATFORM) {
  if (platform === 'darwin') return 'Показать в Finder';
  if (platform === 'win32') return 'Открыть в Проводнике';
  return 'Открыть в файловом менеджере';
}

/** Подпись пункта «открыть терминал» */
export function openTerminalLabel(platform = PLATFORM) {
  if (platform === 'darwin') return 'Открыть в Терминале';
  if (platform === 'win32') return 'Открыть в терминале (командной строке)';
  return 'Открыть в терминале';
}
