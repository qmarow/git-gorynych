// Аватары авторов, как в GitKraken: GitHub (для noreply-адресов) или Gravatar.
// Если картинки нет — остаются инициалы на цвете ветки.
// Чтобы ничего не запрашивать из сети, поставьте ENABLE_REMOTE_AVATARS = false.

export const ENABLE_REMOTE_AVATARS: boolean = true;

const cache = new Map<string, Promise<string | null>>(); // email -> адрес картинки или null
const resolved = new Map<string, string | null>(); // email -> готовый адрес (промис из cache уже завершился)
const failed = new Set<string>(); // url, которые не загрузились

const keyOf = (email: string) => email.trim().toLowerCase();

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function githubAvatar(email: string): string | null {
  // 12345+login@users.noreply.github.com или login@users.noreply.github.com
  const m = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email);
  if (!m) return null;
  return m[1] ? `https://avatars.githubusercontent.com/u/${m[1]}?s=64&v=4` : `https://github.com/${m[2]}.png?size=64`;
}

export function avatarUrl(email: string | null | undefined): Promise<string | null> {
  if (!ENABLE_REMOTE_AVATARS || !email) return Promise.resolve(null);
  const key = keyOf(email);
  if (!cache.has(key)) {
    const pending = (async () => {
      const gh = githubAvatar(key);
      if (gh) return gh;
      if (!crypto?.subtle) return null;
      // Gravatar поддерживает SHA-256; d=404 — если аватара нет, вернётся ошибка, и мы оставим инициалы
      return `https://gravatar.com/avatar/${await sha256Hex(key)}?s=64&d=404`;
    })();
    cache.set(key, pending);
    pending.then((url) => resolved.set(key, url));
  }
  return cache.get(key)!;
}

/**
 * Адрес без ожидания: строка или null, если он уже известен (тот же ответ, что дал бы `avatarUrl`), и undefined,
 * если ещё нет — тогда нужен `avatarUrl`. Узел графа, снова появившийся при прокрутке, сразу рисует картинку.
 */
export function avatarUrlSync(email: string | null | undefined): string | null | undefined {
  if (!ENABLE_REMOTE_AVATARS || !email) return null;
  return resolved.get(keyOf(email));
}

export const markFailed = (url: string): Set<string> => failed.add(url);
export const isFailed = (url: string): boolean => failed.has(url);
