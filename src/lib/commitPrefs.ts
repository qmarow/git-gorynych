import { useSyncExternalStore } from 'react';
import { DEFAULT_TEMPLATES, type CommitTemplate, type TicketFormat } from './commitMsg.ts';

/** Настройки формы коммита: чипсы, номер задачи, шаблоны. Общие для всех репозиториев. */

const KEY = 'commitForm.v1';

export interface CommitPrefs {
  /** Панель Conventional Commits над Summary. */
  chips: boolean;
  /** Сам подставлять номер задачи из имени ветки. */
  ticketAuto: boolean;
  ticketFormat: TicketFormat;
  /** Своё регулярное выражение (пусто — встроенное распознавание). */
  ticketPattern: string;
  /** Предзаполнять Description из git config commit.template. */
  useGitTemplate: boolean;
  templates: readonly CommitTemplate[];
}

export const DEFAULT_COMMIT_PREFS: CommitPrefs = {
  chips: true, // панель Conventional Commits над Summary
  ticketAuto: true, // сам подставлять номер задачи из имени ветки
  ticketFormat: 'prefix', // prefix | scope | suffix | footer
  ticketPattern: '', // своё регулярное выражение (пусто — встроенное распознавание)
  useGitTemplate: true, // предзаполнять Description из git config commit.template
  templates: DEFAULT_TEMPLATES,
};

const FORMATS = new Set<unknown>(['prefix', 'scope', 'suffix', 'footer']);

/** Сохранённое или пришедшее из формы — к допустимому виду (форма не доверяется, как и в 1.x). */
function normalize(v: unknown): CommitPrefs {
  if (!v || typeof v !== 'object') return DEFAULT_COMMIT_PREFS;
  const raw = v as Record<string, unknown>;
  const templates: readonly CommitTemplate[] = Array.isArray(raw.templates)
    ? raw.templates
        .filter((t) => t && typeof t.name === 'string' && typeof t.body === 'string')
        .map((t, i) => ({ id: String(t.id ?? `tpl-${Date.now()}-${i}`), name: t.name.slice(0, 80), body: t.body.slice(0, 8000) }))
    : DEFAULT_TEMPLATES;
  return {
    chips: raw.chips !== false,
    ticketAuto: raw.ticketAuto !== false,
    ticketFormat: FORMATS.has(raw.ticketFormat) ? (raw.ticketFormat as TicketFormat) : 'prefix',
    ticketPattern: typeof raw.ticketPattern === 'string' ? raw.ticketPattern.slice(0, 300) : '',
    useGitTemplate: raw.useGitTemplate !== false,
    templates,
  };
}

let current: CommitPrefs = (() => {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_COMMIT_PREFS;
  }
})();
const listeners = new Set<() => void>();

export function getCommitPrefs(): CommitPrefs {
  return current;
}

export type CommitPrefsPatch = Partial<CommitPrefs> | ((prev: CommitPrefs) => Partial<CommitPrefs>);

export function setCommitPrefs(patch: CommitPrefsPatch): void {
  current = normalize({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* хранилище недоступно — действует до перезапуска */
  }
  for (const l of listeners) l();
}

export function resetCommitPrefs(): void {
  setCommitPrefs(DEFAULT_COMMIT_PREFS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useCommitPrefs(): CommitPrefs {
  return useSyncExternalStore(subscribe, getCommitPrefs);
}
