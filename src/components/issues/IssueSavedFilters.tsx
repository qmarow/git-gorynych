/**
 * Новое в 2.0: сохранённые наборы фильтров — кнопка слева от поиска с именем текущего набора и стрелкой.
 *
 * Встроенные (не удаляются): «Все открытые», «Назначены мне», «Созданы мной», «Без исполнителя», «Недавно закрытые».
 * «Сохранить текущий фильтр…» спрашивает имя прямо в меню; свои наборы переименовываются и удаляются. Хранение —
 * `localStorage['issues.filters.v1:<путь>']`, массив `{ id, name, query }`, не больше 20. Клавиши 1–9 при фокусе в
 * списке включают наборы по порядку (`filterSets`) — их обрабатывает `IssuesView`.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Pencil, Save, Trash2 } from 'lucide-react';
import { DEFAULT_QUERY, normalizeQuery, queryKey, type IssueQuery } from '../../lib/issues.ts';
import { t, type MessageId } from '../../i18n/index.ts';

export const FILTERS_PREFIX = 'issues.filters.v1:';
export const MAX_SAVED_FILTERS = 20;

export interface FilterSet {
  id: string;
  name: string;
  query: Partial<IssueQuery>;
  builtin?: boolean;
}

const BUILTIN: { id: string; name: MessageId; query: Partial<IssueQuery> }[] = [
  { id: 'open', name: 'issues-filter-all-open', query: {} },
  { id: 'mine', name: 'issues-filter-assigned-me', query: { assignee: '@me' } },
  { id: 'created', name: 'issues-filter-created-me', query: { author: '@me' } },
  { id: 'unassigned', name: 'issues-filter-unassigned', query: { assignee: '@none' } },
  { id: 'closed', name: 'issues-filter-recent-closed', query: { state: 'closed', sort: 'updated', ascending: false } },
];

/** Полный фильтр набора: всё, чего нет в наборе, — по умолчанию (поиск и метки сбрасываются). */
export const fullQuery = (query: Partial<IssueQuery>): IssueQuery => normalizeQuery({ ...DEFAULT_QUERY, ...query, page: 1 });

export function readSavedFilters(path: string): FilterSet[] {
  try {
    const raw = localStorage.getItem(FILTERS_PREFIX + path);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value
      .filter((x): x is FilterSet => Boolean(x) && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.query === 'object' && x.query !== null)
      .slice(0, MAX_SAVED_FILTERS)
      .map((x) => ({ id: x.id, name: x.name, query: x.query }));
  } catch {
    return [];
  }
}

function writeSavedFilters(path: string, sets: readonly FilterSet[]): void {
  try {
    if (sets.length) localStorage.setItem(FILTERS_PREFIX + path, JSON.stringify(sets.slice(0, MAX_SAVED_FILTERS).map(({ id, name, query }) => ({ id, name, query }))));
    else localStorage.removeItem(FILTERS_PREFIX + path);
  } catch {
    /* хранилище недоступно */
  }
}

/** Все наборы по порядку: встроенные, затем свои. */
export function filterSets(path: string): FilterSet[] {
  return [...BUILTIN.map((b) => ({ id: b.id, name: t(b.name), query: b.query, builtin: true })), ...readSavedFilters(path)];
}

/** Набор, совпадающий с фильтром (без страницы), или `null`. */
export function currentSet(path: string, query: IssueQuery): FilterSet | null {
  const key = queryKey({ ...query, page: 1 });
  return filterSets(path).find((set) => queryKey(fullQuery(set.query)) === key) ?? null;
}

interface IssueSavedFiltersProps {
  repoPath: string;
  query: IssueQuery;
  onApply: (query: IssueQuery) => void;
}

export default function IssueSavedFilters({ repoPath, query, onApply }: IssueSavedFiltersProps) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [, setVersion] = useState(0);
  const current = currentSet(repoPath, query);
  const sets = filterSets(repoPath);
  const own = readSavedFilters(repoPath);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const store = (next: FilterSet[]) => {
    writeSavedFilters(repoPath, next);
    setVersion((v) => v + 1);
  };
  const save = () => {
    const name = (saving ?? '').trim();
    if (!name || own.length >= MAX_SAVED_FILTERS) return;
    const { page: _page, ...rest } = query;
    store([...own, { id: `f${Date.now().toString(36)}`, name, query: rest }]);
    setSaving(null);
  };
  const rect = button.current?.getBoundingClientRect();
  const stopKeys = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <>
      <button
        ref={button}
        type="button"
        data-testid="saved-filters"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 max-w-[130px] shrink-0 items-center gap-1 rounded border border-gk-border bg-gk-panel-2 px-2 text-xs text-gk-text hover:bg-gk-hover"
      >
        <span className="truncate">{current?.name ?? t('issues-filter-custom')}</span>
        <ChevronDown size={12} className="shrink-0 text-gk-muted" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            data-testid="saved-filters-menu"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
            }}
            style={{ left: rect.left, top: rect.bottom + 4 }}
            className="fixed z-50 w-64 rounded-lg border border-gk-border bg-gk-panel-2 py-1 text-xs shadow-2xl backdrop-blur-xl animate-pop-in"
          >
            {sets.map((set, i) =>
              renaming?.id === set.id ? (
                <div key={set.id} className="px-2 py-1">
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: set.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      stopKeys(e);
                      if (e.key === 'Enter' && renaming.name.trim()) {
                        store(own.map((x) => (x.id === set.id ? { ...x, name: renaming.name.trim() } : x)));
                        setRenaming(null);
                      } else if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="w-full rounded border border-gk-blue/60 bg-gk-panel px-1.5 py-0.5 text-gk-text outline-none"
                  />
                </div>
              ) : (
                <div key={set.id} role="menuitem" data-set={set.id} className="group flex items-center gap-1.5 px-2 py-1 hover:bg-gk-hover">
                  <span className="flex w-3.5 shrink-0 justify-center">{current?.id === set.id && <Check size={12} className="text-gk-blue" />}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(fullQuery(set.query));
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-gk-text"
                  >
                    {set.name}
                  </button>
                  {i < 9 && <kbd className="font-mono text-[10px] text-gk-dim">{i + 1}</kbd>}
                  {!set.builtin && (
                    <>
                      <button type="button" aria-label={t('issues-filter-rename')} data-tip={t('issues-filter-rename')} onClick={() => setRenaming({ id: set.id, name: set.name })} className="hidden text-gk-muted group-hover:block hover:text-gk-text">
                        <Pencil size={11} />
                      </button>
                      <button type="button" aria-label={t('issues-filter-delete')} data-tip={t('issues-filter-delete')} onClick={() => store(own.filter((x) => x.id !== set.id))} className="hidden text-gk-muted group-hover:block hover:text-gk-red">
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
            <div className="my-1 border-t border-gk-border" />
            {saving == null ? (
              <button
                type="button"
                data-testid="saved-filters-save"
                disabled={own.length >= MAX_SAVED_FILTERS}
                onClick={() => setSaving('')}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-gk-blue hover:bg-gk-hover disabled:text-gk-dim"
              >
                <Save size={12} />
                {t('issues-filter-save')}
              </button>
            ) : (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  data-testid="saved-filters-name"
                  value={saving}
                  placeholder={t('issues-filter-name')}
                  onChange={(e) => setSaving(e.target.value)}
                  onKeyDown={(e) => {
                    stopKeys(e);
                    if (e.key === 'Enter') save();
                    else if (e.key === 'Escape') setSaving(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-gk-blue/60 bg-gk-panel px-1.5 py-0.5 text-gk-text outline-none"
                />
                <button type="button" onClick={save} className="rounded px-1.5 py-0.5 text-gk-blue hover:bg-gk-hover">
                  {t('issues-comment-save')}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
