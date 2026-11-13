import { useCallback, useMemo, useState } from 'react';
import { moveColumn } from './graphView.ts';

/**
 * Главные ветки графа (нового в 2.0): пользователь отмечает, какие ветки репозитория главные (например, `main` и
 * `develop`), и каждая получает свою закреплённую дорожку слева (`layoutGraph(commits, { pinned })`).
 *
 * Выбор хранится для каждого репозитория отдельно: `localStorage['graph.mainBranches.v1:<путь>']` — JSON-массив коротких
 * имён в порядке дорожек (`origin/main` хранится как `main`). Ключа нет — режим «авто» (`autoMainBranches`). После любой
 * правки пользователем список записывается явно, в том числе пустой («главных веток нет»).
 */

export const MAX_MAIN_BRANCHES = 5;
const KEY = 'graph.mainBranches.v1:';
const AUTO_GROUPS: readonly (readonly string[])[] = [
  ['main', 'master', 'trunk'],
  ['develop', 'dev'],
];

/** То, что нужно от репозитория: ветки и загруженные коммиты (`Repository` из bindings). */
export interface MainBranchRepo {
  localBranches: readonly { name: string; hash: string }[];
  remotes: readonly { name: string; branches: readonly { name: string; hash: string }[] }[];
  commits: readonly { hash: string; parents: readonly string[] }[];
}

export interface MainTip {
  name: string;
  hash: string;
}

/** Режим «авто»: первая существующая из main, master, trunk и первая существующая из develop, dev. */
export function autoMainBranches(localNames: readonly string[], remoteShortNames: readonly string[]): string[] {
  const exists = new Set([...localNames, ...remoteShortNames]);
  return AUTO_GROUPS.map((group) => group.find((name) => exists.has(name))).filter((name): name is string => name !== undefined);
}

/** Сохранённое → список: только непустые строки, без повторов, не больше MAX_MAIN_BRANCHES. */
export function normalizeMainBranches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((name, i, a): name is string => typeof name === 'string' && name !== '' && a.indexOf(name) === i).slice(0, MAX_MAIN_BRANCHES);
}

// Серверные ветки с этим коротким именем: сначала origin, затем остальные серверы по порядку
function remoteHashes(repo: MainBranchRepo, name: string): string[] {
  const remotes = [...repo.remotes].sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'));
  return remotes.flatMap((r) => r.branches.filter((b) => b.name === name).map((b) => b.hash));
}

/**
 * Вершины главных веток по порядку. Локальная ветка или серверная `<сервер>/<имя>` (сначала origin); есть обе с разными
 * хэшами — серверная, если локальная лежит на цепочке её первых родителей (отстала), иначе локальная. Ветки нет или её
 * вершина не загружена — имя пропускается (в сохранённом списке оно остаётся).
 */
export function resolveMainTips(names: readonly string[], repo: MainBranchRepo | null | undefined): MainTip[] {
  if (!repo) return [];
  const byHash = new Map(repo.commits.map((c) => [c.hash, c]));
  const behind = (local: string, remote: string) => {
    for (let hash: string | undefined = remote; hash !== undefined && byHash.has(hash); hash = byHash.get(hash)!.parents[0]) {
      if (hash === local) return true;
    }
    return false;
  };
  const tips: MainTip[] = [];
  for (const name of names) {
    const local = repo.localBranches.find((b) => b.name === name)?.hash;
    const remote = remoteHashes(repo, name).find((hash) => byHash.has(hash));
    let hash = local !== undefined && byHash.has(local) ? local : remote;
    if (hash === local && remote !== undefined && remote !== local && behind(local!, remote)) hash = remote;
    if (hash !== undefined) tips.push({ name, hash });
  }
  return tips;
}

/** Почему главной ветки нет в графе: нет такой ветки или её вершина не загружена. null — ветка в графе. */
export type MainMissing = 'absent' | 'unloaded' | null;

function read(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : normalizeMainBranches(JSON.parse(raw));
  } catch {
    return null;
  }
}

export interface MainBranches {
  /** Имена в порядке дорожек (в режиме «авто» — найденные автоматически) */
  names: string[];
  auto: boolean;
  /** Вершины тех, что есть в загруженной истории, — это `pinned` раскладки */
  tips: MainTip[];
  missing: Record<string, MainMissing>;
  toggle: (name: string) => void;
  /** Переставляет ветку: from встаёт перед (before) или после target */
  move: (from: string, to: string, after?: boolean) => void;
  reset: () => void;
}

export function useMainBranches(repoPath: string | null | undefined, repo: MainBranchRepo | null | undefined): MainBranches {
  const key = repoPath ? KEY + repoPath : null;
  // Сохранённый список читается заново при смене репозитория (вкладки)
  const [state, setState] = useState(() => ({ key, stored: key ? read(key) : null }));
  const stored = state.key === key ? state.stored : key ? read(key) : null;
  if (state.key !== key) setState({ key, stored });

  const localBranches = repo?.localBranches;
  const remotes = repo?.remotes;
  const commits = repo?.commits;
  const autoNames = useMemo(
    () => autoMainBranches((localBranches ?? []).map((b) => b.name), (remotes ?? []).flatMap((r) => r.branches.map((b) => b.name))),
    [localBranches, remotes],
  );
  const names = stored ?? autoNames;
  const namesKey = names.join('\n');
  const tips = useMemo(
    () => (localBranches && remotes && commits ? resolveMainTips(namesKey ? namesKey.split('\n') : [], { localBranches, remotes, commits }) : []),
    [namesKey, localBranches, remotes, commits],
  );
  const missing = useMemo(() => {
    const out: Record<string, MainMissing> = {};
    for (const name of namesKey ? namesKey.split('\n') : []) {
      const exists = localBranches?.some((b) => b.name === name) || remotes?.some((r) => r.branches.some((b) => b.name === name));
      out[name] = tips.some((tip) => tip.name === name) ? null : exists ? 'unloaded' : 'absent';
    }
    return out;
  }, [namesKey, tips, localBranches, remotes]);

  const write = useCallback(
    (next: string[] | null) => {
      if (!key) return;
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* хранилище недоступно — выбор просто не запомнится */
      }
      setState({ key, stored: next });
    },
    [key],
  );
  const current = useMemo(() => (namesKey ? namesKey.split('\n') : []), [namesKey]);
  const toggle = useCallback(
    (name: string) => {
      if (current.includes(name)) write(current.filter((n) => n !== name));
      else if (current.length < MAX_MAIN_BRANCHES) write([...current, name]);
    },
    [current, write],
  );
  const move = useCallback((from: string, to: string, after = false) => write([...moveColumn(current, from, to, after)]), [current, write]);
  const reset = useCallback(() => write(null), [write]);

  return useMemo(() => ({ names: current, auto: stored === null, tips, missing, toggle, move, reset }), [current, stored, tips, missing, toggle, move, reset]);
}
