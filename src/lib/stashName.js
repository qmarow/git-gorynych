import { relativeTime } from './format.js';
import { t } from '../i18n/index.js';

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
  if (auto) return { auto: true, branch, title: auto, detail: t('спрятано при переключении ветки') };
  if (m?.[1] === 'WIP on') {
    const [sha, ...rest] = m[3].split(' ');
    return { auto: false, branch, title: t('Правки в {0}', branch), detail: t('на {0}{1}', sha, rest.length ? ` ${rest.join(' ')}` : '') };
  }
  if (m) return { auto: false, branch, title: m[3] || t('Правки в {0}', branch), detail: t('ветка {0}', branch) };
  return { auto: false, branch: null, title: msg || st?.id || 'stash', detail: '' };
}

/** «5 мин», «3 ч», «вчера» — коротко, для правого края строки */
export function shortAgo(iso) {
  if (!iso) return '';
  return relativeTime(iso).replace(t(' назад'), '');
}
