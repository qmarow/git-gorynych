export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function relativeTime(iso) {
  const date = new Date(iso);
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU');
}

// Единый вид даты во всём интерфейсе — в таблице коммитов, в панели коммита и в подсказках: 22.09.2021 01:59
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fullDate = shortDate;

// Детерминированный цвет аватара по имени
const AVATAR_COLORS = ['#0669f7', '#8e00c2', '#d90171', '#15a0bf', '#f25d2e', '#2ece9d', '#c517b6'];
export function avatarColor(name = '') {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export const FILE_STATUS = {
  M: { label: 'Modified', color: '#f2ca33' },
  A: { label: 'Added', color: '#3cf0a0' },
  D: { label: 'Deleted', color: '#f25d5d' },
  R: { label: 'Renamed', color: '#2f9bff' },
  U: { label: 'Conflicted', color: '#ff8c3a' },
};

// Склонение по числу: plural(3, 'файл', 'файла', 'файлов') → «файла»
export const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
