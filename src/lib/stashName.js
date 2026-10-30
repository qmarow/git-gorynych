import { relativeTime } from './format.js';

/**
 * Единый вид названий stash в интерфейсе. Git хранит их по-разному:
 *  - «On <ветка>: gorynych-auto: <ветка>» (или прежнее gitidea-auto) — спрятано умным переключением (авто);
 *  - «On <ветка>: <своё сообщение>»      — Stash с сообщением;
 *  - «WIP on <ветка>: <sha> <коммит>»    — Stash без сообщения (как git stash).
 * → { auto, branch, title, detail }
 */
export function describeStash(st) {
  const msg = String(st?.message ?? '');
  const auto = /(?:gorynych|gitidea)-auto: (.+)$/.exec(msg)?.[1]?.trim() ?? null;
  const m = /^(WIP on|On) ([^:]+):\s*(.*)$/.exec(msg);
  const branch = auto ?? m?.[2] ?? null;
  if (auto) return { auto: true, branch, title: auto, detail: 'спрятано при переключении ветки' };
  if (m?.[1] === 'WIP on') {
    const [sha, ...rest] = m[3].split(' ');
    return { auto: false, branch, title: `Правки в ${branch}`, detail: `на ${sha}${rest.length ? ` ${rest.join(' ')}` : ''}` };
  }
  if (m) return { auto: false, branch, title: m[3] || `Правки в ${branch}`, detail: `ветка ${branch}` };
  return { auto: false, branch: null, title: msg || st?.id || 'stash', detail: '' };
}

/** «5 мин», «3 ч», «вчера» — коротко, для правого края строки */
export function shortAgo(iso) {
  if (!iso) return '';
  return relativeTime(iso).replace(' назад', '');
}
