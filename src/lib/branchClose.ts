/**
 * «Закрыть ветку в …» (новое в 2.0): влить ветку в цель коммитом слияния (`--no-ff`) и удалить её. Коммит слияния
 * обязателен: при перемотке коммиты ветки легли бы на цепочку первых родителей цели, и в графе история ветки слилась
 * бы с ней. С коммитом слияния ветка остаётся в графе отдельной линией, впадающей в цель.
 *
 * Слияние с конфликтом закончится позже («Продолжить» в жёлтой панели) — ветку удалять тогда. Запись об этом —
 * `localStorage['branch.close.v1:<путь>']`, она переживает перезапуск, пока слияние не завершено или не прервано.
 */
export interface BranchClose {
  branch: string;
  target: string;
  /** Серверная копия ветки на момент закрытия: предложить удалить и её */
  upstream: string | null;
}

const KEY = 'branch.close.v1:';

export function readBranchClose(path: string): BranchClose | null {
  try {
    const raw = localStorage.getItem(KEY + path);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BranchClose> | null;
    if (!v || typeof v.branch !== 'string' || typeof v.target !== 'string' || !v.branch || !v.target) return null;
    return { branch: v.branch, target: v.target, upstream: typeof v.upstream === 'string' ? v.upstream : null };
  } catch {
    return null;
  }
}

export function writeBranchClose(path: string, value: BranchClose | null): void {
  try {
    if (value) localStorage.setItem(KEY + path, JSON.stringify(value));
    else localStorage.removeItem(KEY + path);
  } catch {
    /* хранилище недоступно — ветку после конфликта придётся удалить вручную */
  }
}

/**
 * Цели закрытия ветки `name`: сначала главные ветки (по порядку дорожек), затем остальные локальные по алфавиту;
 * без самой ветки и без повторов.
 */
export function closeTargets(name: string, mainNames: readonly string[], locals: readonly string[]): { main: string[]; other: string[] } {
  const exists = new Set(locals);
  const main = mainNames.filter((n, i) => n !== name && exists.has(n) && mainNames.indexOf(n) === i);
  const taken = new Set([name, ...main]);
  const other = [...new Set(locals)].filter((n) => !taken.has(n)).sort((a, b) => a.localeCompare(b));
  return { main, other };
}

/** Аргумент `git config`/`git merge`, как его разбирает `split_args` своей команды: в кавычках */
export const quoteArg = (value: string): string => (value.includes('"') ? `'${value}'` : `"${value}"`);
