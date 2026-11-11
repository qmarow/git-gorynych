/**
 * Stash в графе коммитов, как в GitKraken (нового в 2.0, в 1.x stash был только в боковой панели).
 *
 * Каждый stash — отдельная строка графа: узел в своей дорожке и пунктирная линия к коммиту, на котором его сделали
 * (`base` — первый родитель коммита stash). Строка встаёт по времени создания среди коммитов, но всегда выше своего
 * коммита: так линия идёт вниз, как у ветки. Stash, чей коммит не загружен (за пределом истории), в граф не попадает —
 * он по-прежнему есть в боковой панели.
 *
 * Хэш строки — `stash:<хэш stash>`: тот же ключ выбора, что у боковой панели, поэтому выделение, детали и диффы stash
 * работают без отдельной ветки кода.
 */
import type { Commit_Serialize, Stash_Serialize } from '../../crates/gorynych-tauri/bindings/commands.ts';

export type StashData = Pick<Stash_Serialize, 'id' | 'hash' | 'message' | 'date' | 'base'>;
export type GraphCommit = Pick<Commit_Serialize, 'hash' | 'parents' | 'date'> & Record<string, unknown>;

/** Строка графа для stash: поля коммита, которые читает граф, плюс сам stash. */
export interface StashRow {
  hash: string;
  parents: string[];
  date: string;
  message: string;
  description: string;
  author: { name: string; email: string };
  refs: never[];
  isHead: false;
  stash: StashData;
}

export const stashKey = (st: Pick<StashData, 'hash'>): string => `stash:${st.hash}`;

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? -Infinity : t;
};

/** Коммиты (от новых к старым) со строками stash на своих местах. Без stash — тот же массив. */
export function withStashes<C extends GraphCommit>(commits: readonly C[], stashes: readonly StashData[] | null | undefined, title: (st: StashData) => string): (C | StashRow)[] | readonly C[] {
  if (!stashes?.length || !commits.length) return commits;
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  // Место строки: перед первым коммитом старше stash, но не ниже его коммита
  const at = new Map<number, { row: StashRow; t: number; order: number }[]>();
  stashes.forEach((st, order) => {
    const base = st.base ? index.get(st.base) : undefined;
    if (base === undefined) return;
    const t = time(st.date);
    let pos = commits.findIndex((c) => time(c.date) < t);
    if (pos === -1 || pos > base) pos = base;
    const row: StashRow = {
      hash: stashKey(st),
      parents: [st.base!],
      date: st.date,
      message: title(st),
      description: st.message,
      author: { name: '', email: '' },
      refs: [],
      isHead: false,
      stash: st,
    };
    const list = at.get(pos) ?? [];
    list.push({ row, t, order });
    at.set(pos, list);
  });
  if (!at.size) return commits;
  const out: (C | StashRow)[] = [];
  commits.forEach((c, i) => {
    // Несколько stash на одном месте: новые выше, при равном времени — в порядке списка (stash@{0} первым)
    const here = at.get(i);
    if (here) out.push(...here.sort((a, b) => b.t - a.t || a.order - b.order).map((x) => x.row));
    out.push(c);
  });
  return out;
}
