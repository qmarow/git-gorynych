/**
 * Новое в 2.0: панель фильтров списка задач — поиск, вкладки состояния, «Назначены мне» / «Созданы мной», чипы
 * «Метки», «Исполнитель», «Автор», «Веха», сортировка, «Сбросить фильтры».
 *
 * Поиск уходит в `setQuery` через 300 мс после ввода, Enter — сразу; `#123` и Enter открывают задачу, не меняя
 * фильтр. Сервер без текстового поиска (`caps.textSearch === false`): поле фильтрует загруженные задачи у себя
 * (`onLocalSearch`). Особые значения фильтра — как в адаптерах (`issues/*.rs`): `@me` — я, `@none` — без значения.
 * Gitea фильтра «без исполнителя» не умеет — пункта нет.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { isDefaultQuery, parseIssueNumber, type IssueQuery } from '../../lib/issues.ts';
import type { RepoIssues } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueLabel_Serialize, IssueMilestone_Serialize, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssuePicker from './IssuePicker.tsx';
import { LabelChip, UserAvatar, userName } from './IssueBits.tsx';

const SEARCH_DELAY = 300;
const ME = '@me';
const NONE = '@none';

const SORTS = [
  { id: 'updated-desc', sort: 'updated', ascending: false, label: () => t('issues-sort-updated') },
  { id: 'created-desc', sort: 'created', ascending: false, label: () => t('issues-sort-newest') },
  { id: 'created-asc', sort: 'created', ascending: true, label: () => t('issues-sort-oldest') },
  { id: 'comments-desc', sort: 'comments', ascending: false, label: () => t('issues-sort-comments') },
] as const;

type Picker = 'labels' | 'assignee' | 'author' | 'milestone';

interface IssueFiltersProps {
  repo: RepoIssues;
  onQuery: (patch: Partial<IssueQuery>) => void;
  onOpenNumber: (number: number) => void;
  onLocalSearch: (text: string) => void;
  searchRef: (el: HTMLInputElement | null) => void;
}

export default function IssueFilters({ repo, onQuery, onOpenNumber, onLocalSearch, searchRef }: IssueFiltersProps) {
  const { query, caps, meta, counts, provider } = repo;
  const serverSearch = caps?.textSearch !== false;
  const [text, setText] = useState(query.search ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [picker, setPicker] = useState<{ kind: Picker; anchor: HTMLElement } | null>(null);

  // Фильтр сменился снаружи (сброс, другая вкладка) — поле показывает его
  useEffect(() => {
    if (serverSearch) setText(query.search ?? '');
  }, [query.search, serverSearch]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const applySearch = (value: string) => {
    clearTimeout(timer.current);
    if (!serverSearch) onLocalSearch(value);
    else if ((value.trim() || null) !== (query.search?.trim() || null)) onQuery({ search: value.trim() || null });
  };
  const onText = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    if (!serverSearch) onLocalSearch(value);
    else timer.current = setTimeout(() => applySearch(value), SEARCH_DELAY);
  };

  const me = meta?.me ?? null;
  const togglePicker = (kind: Picker) => (e: React.MouseEvent<HTMLElement>) => {
    const anchor = e.currentTarget;
    setPicker((p) => (p?.kind === kind ? null : { kind, anchor }));
  };
  const sortId = `${query.sort}-${query.ascending ? 'asc' : 'desc'}`;
  const userLabel = (value: string | null) => (value === ME ? userName(me) || ME : value === NONE ? t('issues-no-assignee') : value);

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-gk-border px-2 py-1.5">
      <div className="flex h-7 items-center gap-1.5">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-gk-border bg-gk-sink/25 px-2 focus-within:border-gk-blue" data-tip={t('issues-search-tip')}>
          <Search size={13} className="shrink-0 text-gk-dim" />
          <input
            ref={searchRef}
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const number = parseIssueNumber(text);
                if (number != null) onOpenNumber(number);
                else applySearch(text);
              } else if (e.key === 'Escape' && text) {
                e.preventDefault();
                e.stopPropagation();
                onText('');
                applySearch('');
              }
            }}
            placeholder={t('issues-search-placeholder')}
            className="min-w-0 flex-1 bg-transparent text-xs text-gk-text outline-none placeholder:text-gk-dim"
          />
          {text && (
            <button type="button" aria-label={t('issues-search-clear')} onClick={() => (onText(''), applySearch(''))} className="text-gk-dim hover:text-gk-text">
              <X size={13} />
            </button>
          )}
        </label>
        <select
          value={sortId}
          aria-label={t('issues-sort-label')}
          onChange={(e) => {
            const s = SORTS.find((x) => x.id === e.target.value);
            if (s) onQuery({ sort: s.sort, ascending: s.ascending });
          }}
          className="h-7 shrink-0 rounded border border-gk-border bg-gk-panel-2 px-1 text-xs text-gk-text outline-none focus:border-gk-blue"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label()}
            </option>
          ))}
        </select>
      </div>
      {!serverSearch && <div className="px-0.5 text-[11px] text-gk-dim">{t('issues-search-loaded-only')}</div>}

      <div className="flex flex-wrap items-center gap-1">
        <div role="tablist" className="flex items-center rounded border border-gk-border p-px">
          {([
            ['open', t('issues-state-open'), counts?.open],
            ['closed', t('issues-state-closed'), counts?.closed],
            [null, t('issues-state-all'), null],
          ] as const).map(([state, label, count]) => (
            <button
              key={String(state)}
              type="button"
              role="tab"
              aria-selected={query.state === state}
              onClick={() => onQuery({ state })}
              className={`flex h-6 items-center gap-1 rounded-sm px-2 text-xs ${query.state === state ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted hover:text-gk-text'}`}
            >
              {label}
              {counts !== null && count != null && <span className="text-[11px] text-gk-dim">{count}</span>}
            </button>
          ))}
        </div>
        {me && (
          <>
            <Toggle active={query.assignee === ME} onClick={() => onQuery({ assignee: query.assignee === ME ? null : ME })}>
              {t('issues-assigned-to-me')}
            </Toggle>
            <Toggle active={query.author === ME} onClick={() => onQuery({ author: query.author === ME ? null : ME })}>
              {t('issues-created-by-me')}
            </Toggle>
          </>
        )}
        {caps?.labels !== false && (
          <Chip label={t('issues-filter-labels')} value={query.labels.length ? query.labels.join(', ') : null} onOpen={togglePicker('labels')} onClear={() => onQuery({ labels: [] })} />
        )}
        <Chip label={t('issues-filter-assignee')} value={query.assignee && query.assignee !== ME ? userLabel(query.assignee) : null} onOpen={togglePicker('assignee')} onClear={() => onQuery({ assignee: null })} />
        <Chip label={t('issues-filter-author')} value={query.author && query.author !== ME ? userLabel(query.author) : null} onOpen={togglePicker('author')} onClear={() => onQuery({ author: null })} />
        {caps?.milestones !== false && (
          <Chip
            label={t('issues-filter-milestone')}
            value={query.milestone === NONE ? t('issues-no-milestone') : query.milestone}
            onOpen={togglePicker('milestone')}
            onClear={() => onQuery({ milestone: null })}
          />
        )}
        {!isDefaultQuery(query) && (
          <button type="button" onClick={() => (setText(''), onLocalSearch(''), onQuery(resetQuery()))} className="px-1 text-xs text-gk-blue hover:underline">
            {t('issues-reset-filters')}
          </button>
        )}
      </div>

      {picker?.kind === 'labels' && (
        <IssuePicker<IssueLabel_Serialize>
          anchor={picker.anchor}
          items={meta?.labels ?? []}
          getId={(l) => l.name}
          selectedIds={query.labels}
          multiple
          getSearchText={(l) => `${l.name} ${l.description ?? ''}`}
          renderItem={(l) => (
            <span className="flex min-w-0 flex-col">
              <span className="flex"><LabelChip label={l} /></span>
              {l.description && <span className="truncate text-[11px] text-gk-dim">{l.description}</span>}
            </span>
          )}
          onToggle={(id) => id && onQuery({ labels: query.labels.includes(id) ? query.labels.filter((x) => x !== id) : [...query.labels, id] })}
          onClose={() => setPicker(null)}
        />
      )}
      {(picker?.kind === 'assignee' || picker?.kind === 'author') && (
        <IssuePicker<IssueUser_Serialize>
          key={picker.kind}
          anchor={picker.anchor}
          items={meta?.members ?? []}
          getId={(u) => u.login}
          selectedIds={[(picker.kind === 'assignee' ? query.assignee : query.author) ?? '']}
          getSearchText={(u) => `${u.name ?? ''} ${u.login}`}
          renderItem={(u) => <UserItem user={u} />}
          noneLabel={picker.kind === 'assignee' && provider !== 'gitea' ? t('issues-no-assignee') : undefined}
          noneSelected={query.assignee === NONE}
          onToggle={(id) => onQuery(picker.kind === 'assignee' ? { assignee: id ?? NONE } : { author: id })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === 'milestone' && (
        <IssuePicker<IssueMilestone_Serialize>
          anchor={picker.anchor}
          items={meta?.milestones ?? []}
          getId={(m) => m.title}
          selectedIds={[query.milestone ?? '']}
          getSearchText={(m) => m.title}
          renderItem={(m) => <span className={`truncate ${m.closed ? 'text-gk-muted' : ''}`}>{m.title}</span>}
          noneLabel={t('issues-no-milestone')}
          noneSelected={query.milestone === NONE}
          onToggle={(id) => onQuery({ milestone: id ?? NONE })}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Сброс к умолчанию — с полями `null`, а не пропусками: `setQuery` сливает изменение с текущим фильтром. */
function resetQuery(): Partial<IssueQuery> {
  return { state: 'open', search: null, labels: [], assignee: null, author: null, milestone: null, sort: 'updated', ascending: false };
}

function UserItem({ user }: { user: IssueUser_Serialize }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar user={user} size={18} tip={false} />
      <span className="truncate">{userName(user)}</span>
      {user.name && <span className="truncate text-gk-dim">{user.login}</span>}
    </span>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-6 rounded border px-2 text-xs ${active ? 'border-gk-blue/60 bg-gk-blue/15 text-gk-strong' : 'border-gk-border text-gk-muted hover:text-gk-text'}`}
    >
      {children}
    </button>
  );
}

function Chip({ label, value, onOpen, onClear }: { label: ReactNode; value: ReactNode | null; onOpen: (e: React.MouseEvent<HTMLElement>) => void; onClear: () => void }) {
  return (
    <span className={`flex h-6 max-w-[180px] items-center rounded border text-xs ${value ? 'border-gk-blue/60 bg-gk-blue/15 text-gk-strong' : 'border-gk-border text-gk-muted'}`}>
      <button type="button" aria-haspopup="listbox" onClick={onOpen} className="flex min-w-0 items-center gap-1 px-2 hover:text-gk-text">
        <span className="shrink-0">{label}</span>
        {value ? <span className="truncate">: {value}</span> : <ChevronDown size={12} className="shrink-0" />}
      </button>
      {value && (
        <button type="button" aria-label={t('issues-remove-filter')} onClick={onClear} className="pr-1.5 text-gk-muted hover:text-gk-text">
          <X size={12} />
        </button>
      )}
    </span>
  );
}
