/**
 * Stash, применённый с конфликтом (новое в 2.0).
 *
 * `git stash pop` удаляет stash только без конфликтов: с конфликтом изменения уже в рабочей папке, а stash остаётся в
 * списке. Интерфейс запоминает такой stash на репозиторий: «Забрать» (`drop: true`) — удалить его, когда все конфликты
 * решены и решение есть среди изменений (`resolvedKeepsChanges`); «Отменить применение» — вернуть рабочую папку как было (в том числе убрать новые файлы stash) и оставить stash.
 * Хранится в `localStorage['stash.conflict.v1:<путь>']`, поэтому переживает перезапуск, пока конфликты не решены.
 */
export interface StashConflict {
  hash: string;
  title: string;
  /** «Забрать»: удалить stash после решения конфликтов */
  drop: boolean;
  /** Файлы с конфликтом сразу после применения: если к решению ни одного из них нет среди изменений (изменения
   *  отменили, а не решили), stash не удаляется */
  paths: string[];
}

const KEY = 'stash.conflict.v1:';

export function readStashConflict(path: string): StashConflict | null {
  try {
    const raw = localStorage.getItem(KEY + path);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StashConflict> | null;
    return v && typeof v.hash === 'string' && v.hash ? { hash: v.hash, title: typeof v.title === 'string' ? v.title : '', drop: v.drop === true, paths: Array.isArray(v.paths) ? v.paths.filter((x): x is string => typeof x === 'string') : [] } : null;
  } catch {
    return null;
  }
}

export function writeStashConflict(path: string, value: StashConflict | null): void {
  try {
    if (value) localStorage.setItem(KEY + path, JSON.stringify(value));
    else localStorage.removeItem(KEY + path);
  } catch {
    /* хранилище недоступно — stash просто не удалится сам */
  }
}

/**
 * Аргументы `git clean` для новых файлов stash (вывод `ls-tree -r -z --name-only <stash>^3`): каждый путь в кавычках,
 * как их разбирает `split_args` своей команды. Путь с обеими кавычками не передать — тогда `null`, файлы не трогаются.
 */
export function cleanArgs(lsTree: string): string | null {
  const paths = lsTree.split('\0').filter(Boolean);
  if (!paths.length) return null;
  const quoted: string[] = [];
  for (const p of paths) {
    if (!p.includes('"')) quoted.push(`"${p}"`);
    else if (!p.includes("'")) quoted.push(`'${p}'`);
    else return null;
  }
  return `clean -f -q -- ${quoted.join(' ')}`;
}

/**
 * Конфликты исчезли, потому что их решили, а не потому что изменения отменили: хотя бы один бывший конфликтный файл
 * есть среди изменений рабочей папки (решение застейджено или нет). Отмена всех изменений — stash удалять нельзя.
 */
export function resolvedKeepsChanges(pending: StashConflict, changed: readonly { path: string }[]): boolean {
  return pending.paths.some((p) => changed.some((f) => f.path === p));
}
