// Аватары авторов, как в GitKraken: GitHub (для noreply-адресов) или Gravatar.
// Если картинки нет — остаются инициалы на цвете ветки.
// Чтобы ничего не запрашивать из сети, поставьте ENABLE_REMOTE_AVATARS = false.

export const ENABLE_REMOTE_AVATARS = true;

const cache = new Map(); // email -> Promise<string|null>
const failed = new Set(); // url, которые не загрузились

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function githubAvatar(email) {
  // 12345+login@users.noreply.github.com или login@users.noreply.github.com
  const m = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email);
  if (!m) return null;
  return m[1] ? `https://avatars.githubusercontent.com/u/${m[1]}?s=64&v=4` : `https://github.com/${m[2]}.png?size=64`;
}

export function avatarUrl(email) {
  if (!ENABLE_REMOTE_AVATARS || !email) return Promise.resolve(null);
  const key = email.trim().toLowerCase();
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const gh = githubAvatar(key);
        if (gh) return gh;
        if (!crypto?.subtle) return null;
        // Gravatar поддерживает SHA-256; d=404 — если аватара нет, вернётся ошибка, и мы оставим инициалы
        return `https://gravatar.com/avatar/${await sha256Hex(key)}?s=64&d=404`;
      })(),
    );
  }
  return cache.get(key);
}

export const markFailed = (url) => failed.add(url);
export const isFailed = (url) => failed.has(url);
