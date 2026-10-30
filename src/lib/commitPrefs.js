import { useSyncExternalStore } from 'react';
import { DEFAULT_TEMPLATES } from './commitMsg.js';

/** Настройки формы коммита: чипсы, номер задачи, шаблоны. Общие для всех репозиториев. */

const KEY = 'commitForm.v1';

export const DEFAULT_COMMIT_PREFS = {
  chips: true, // панель Conventional Commits над Summary
  ticketAuto: true, // сам подставлять номер задачи из имени ветки
  ticketFormat: 'prefix', // prefix | scope | suffix | footer
  ticketPattern: '', // своё регулярное выражение (пусто — встроенное распознавание)
  useGitTemplate: true, // предзаполнять Description из git config commit.template
  templates: DEFAULT_TEMPLATES,
};

const FORMATS = new Set(['prefix', 'scope', 'suffix', 'footer']);

function normalize(v) {
  if (!v || typeof v !== 'object') return DEFAULT_COMMIT_PREFS;
  const templates = Array.isArray(v.templates)
    ? v.templates
        .filter((t) => t && typeof t.name === 'string' && typeof t.body === 'string')
        .map((t, i) => ({ id: String(t.id ?? `tpl-${Date.now()}-${i}`), name: t.name.slice(0, 80), body: t.body.slice(0, 8000) }))
    : DEFAULT_TEMPLATES;
  return {
    chips: v.chips !== false,
    ticketAuto: v.ticketAuto !== false,
    ticketFormat: FORMATS.has(v.ticketFormat) ? v.ticketFormat : 'prefix',
    ticketPattern: typeof v.ticketPattern === 'string' ? v.ticketPattern.slice(0, 300) : '',
    useGitTemplate: v.useGitTemplate !== false,
    templates,
  };
}

let current = (() => {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_COMMIT_PREFS;
  }
})();
const listeners = new Set();

export function getCommitPrefs() {
  return current;
}

export function setCommitPrefs(patch) {
  current = normalize({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* хранилище недоступно — действует до перезапуска */
  }
  for (const l of listeners) l();
}

export function resetCommitPrefs() {
  setCommitPrefs(DEFAULT_COMMIT_PREFS);
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCommitPrefs() {
  return useSyncExternalStore(subscribe, getCommitPrefs);
}
