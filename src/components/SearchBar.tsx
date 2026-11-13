import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, FileSearch, ListFilter, Loader2, Search, User, X } from 'lucide-react';
import { avatarColor, initials } from '../lib/format.ts';
import { t as tr, tj } from '../i18n/index.ts';
import { searchWords } from '../lib/searchMarks.ts';

export type Period = 'all' | 'today' | '7d' | '30d' | 'range';

/** Фильтр графа: текст, авторы, период (`from`/`to` — даты YYYY-MM-DD для «Период…») */
export interface CommitFilter {
  query: string;
  authors: string[];
  period: Period;
  from: string;
  to: string;
}

/** То, что фильтру нужно от строки графа (коммит, WIP или stash) */
export interface FilterableCommit {
  wip?: boolean;
  hash: string;
  message?: string;
  description?: string;
  date?: string;
  author?: { name?: string; email?: string } | null;
  refs?: { name: string }[];
}

export const EMPTY_FILTER: CommitFilter = { query: '', authors: [], period: 'all', from: '', to: '' };

const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: tr('all-time') },
  { id: 'today', label: tr('today') },
  { id: '7d', label: tr('n-7-days') },
  { id: '30d', label: tr('n-30-days') },
  { id: 'range', label: tr('period') },
];

export function isFilterActive(f: CommitFilter): boolean {
  return Boolean(f.query.trim() || f.authors.length || f.period !== 'all');
}

// Совпадает ли коммит с фильтром: текст (сообщение, описание, SHA, автор, ветки/теги), авторы, даты
export function matchCommit(c: FilterableCommit, f: CommitFilter): boolean {
  if (c.wip) return false;
  // Слова запроса — те же, что подсвечивает граф (`searchMarks.ts`)
  const words = searchWords(f.query);
  if (words.length) {
    const hay = [c.message, c.description, c.hash, c.author?.name, c.author?.email, ...(c.refs ?? []).map((r) => r.name)]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!words.every((word) => hay.includes(word))) return false;
  }
  if (f.authors.length && !f.authors.includes(c.author?.name as string)) return false;
  if (f.period !== 'all') {
    const t = new Date(c.date as string).getTime();
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    if (f.period === 'today' && t < startOfDay.getTime()) return false;
    if (f.period === '7d' && t < now - 7 * 864e5) return false;
    if (f.period === '30d' && t < now - 30 * 864e5) return false;
    if (f.period === 'range') {
      if (f.from && t < new Date(`${f.from}T00:00:00`).getTime()) return false;
      if (f.to && t > new Date(`${f.to}T23:59:59`).getTime()) return false;
    }
  }
  return true;
}

/** Поиск по изменениям файлов (`repo:search-content`): ход и итог */
interface ContentSearch {
  loading: boolean;
  error: { message?: ReactNode; hint?: string | null } | null;
  commits: number;
  partial?: boolean;
  truncated?: boolean;
}

interface SearchBarProps {
  commits: readonly FilterableCommit[];
  filter: CommitFilter;
  onChange: (filter: CommitFilter) => void;
  matches: readonly unknown[];
  current: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  totalLoaded: number;
  truncated?: boolean;
  inFiles?: boolean;
  onToggleInFiles?: () => void;
  /** «Только совпадения»: граф показывает лишь найденные коммиты (новое в 2.0) */
  onlyMatches?: boolean;
  onToggleOnlyMatches?: () => void;
  content?: ContentSearch | null;
}

export default function SearchBar({ commits, filter, onChange, matches, current, onPrev, onNext, onClose, totalLoaded, truncated, inFiles = false, onToggleInFiles, onlyMatches = false, onToggleOnlyMatches, content = null }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState('');
  const authorsRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!authorsOpen) return undefined;
    const close = (e: MouseEvent) => !authorsRef.current?.contains(e.target as Node) && setAuthorsOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [authorsOpen]);

  // Авторы с количеством коммитов
  const authors = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commits) if (!c.wip && c.author?.name) map.set(c.author.name, (map.get(c.author.name) ?? 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1]);
  }, [commits]);

  const set = (patch: Partial<CommitFilter>) => onChange({ ...filter, ...patch });
  const toggleAuthor = (name: string) =>
    set({ authors: filter.authors.includes(name) ? filter.authors.filter((a) => a !== name) : [...filter.authors, name] });

  const active = isFilterActive(filter);
  const shownAuthors = authors.filter(([n]) => n.toLowerCase().includes(authorQuery.toLowerCase()));

  return (
    <div className="glass relative z-10 flex shrink-0 animate-slide-up flex-wrap items-center gap-2 border-b border-gk-border bg-gk-panel px-3 py-2">
      {/* Текст */}
      <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md bg-gk-bg px-2.5 py-1.5 ring-1 ring-gk-border focus-within:ring-gk-blue">
        <Search size={14} className="shrink-0 text-gk-muted" />
        <input
          ref={inputRef}
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.shiftKey ? onPrev() : onNext();
            }
            if (e.key === 'Escape') onClose();
          }}
          placeholder={inFiles ? tr('message-sha-author-branch-or') : tr('message-sha-author-branch')}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-gk-dim"
        />
        {filter.query && (
          <button onClick={() => set({ query: '' })} className="text-gk-dim hover:text-gk-text">
            <X size={13} />
          </button>
        )}
      </label>

      {/* Искать ещё и в изменённых строках файлов */}
      {onToggleInFiles && (
        <button
          onClick={onToggleInFiles}
          data-testid="search-in-files"
          aria-pressed={inFiles}
          data-tip={inFiles ? tr('text-in-file-changes-is') : tr('search-in-file-changes-too')}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 transition-colors ${
            inFiles ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'text-gk-muted ring-gk-border hover:text-gk-text'
          }`}
        >
          {tj('in-files', [content?.loading ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />])}</button>
      )}

      {/* Только совпадения: остальные коммиты не показываются вовсе */}
      {onToggleOnlyMatches && (
        <button
          onClick={onToggleOnlyMatches}
          data-testid="search-only-matches"
          aria-pressed={onlyMatches}
          data-tip={onlyMatches ? tr('only-matches-on') : tr('only-matches-off')}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 transition-colors ${
            onlyMatches ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'text-gk-muted ring-gk-border hover:text-gk-text'
          }`}
        >
          <ListFilter size={13} />
          {tr('only-matches')}
        </button>
      )}

      {/* Авторы */}
      <div ref={authorsRef} className="relative">
        <button
          onClick={() => setAuthorsOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 transition-colors ${
            filter.authors.length ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'text-gk-muted ring-gk-border hover:text-gk-text'
          }`}
        >
          <User size={13} />
          {filter.authors.length === 0
            ? tr('all-authors')
            : filter.authors.length === 1
              ? filter.authors[0]
              : tr('authors', filter.authors.length)}
          <ChevronDown size={12} />
        </button>
        {authorsOpen && (
          <div className="glass-strong absolute left-0 top-full z-30 mt-1 w-72 origin-top-left animate-pop-in rounded-lg border border-gk-border bg-gk-panel-2 p-1.5">
            <input
              autoFocus
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
              placeholder={tr('find-author')}
              className="mb-1 w-full rounded bg-gk-bg px-2 py-1.5 text-xs outline-none ring-1 ring-gk-border focus:ring-gk-blue"
            />
            <div className="max-h-64 overflow-y-auto">
              {shownAuthors.map(([name, count]) => {
                const on = filter.authors.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleAuthor(name)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-gk-hover ${on ? 'text-gk-strong' : 'text-gk-text'}`}
                  >
                    <input type="checkbox" readOnly checked={on} className="pointer-events-none accent-gk-blue" />
                    <span
                      style={{ backgroundColor: avatarColor(name) }}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
                    >
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="text-gk-dim">{count}</span>
                  </button>
                );
              })}
              {shownAuthors.length === 0 && <div className="px-2 py-1.5 text-xs text-gk-dim">{tr('nobody-found')}</div>}
            </div>
            {filter.authors.length > 0 && (
              <button onClick={() => set({ authors: [] })} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-gk-blue hover:bg-gk-hover">
                {tr('reset-authors')}</button>
            )}
          </div>
        )}
      </div>

      {/* Даты */}
      <div className="flex items-center gap-1 rounded-md p-0.5 ring-1 ring-gk-border">
        <CalendarDays size={13} className="mx-1 text-gk-muted" />
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => set({ period: p.id })}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              filter.period === p.id ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted hover:text-gk-text'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {filter.period === 'range' && (
        <div className="flex animate-fade-in items-center gap-1.5 text-xs text-gk-muted">
          {tj('from-to', [<input
            type="date"
            value={filter.from}
            onChange={(e) => set({ from: e.target.value })}
            className="rounded bg-gk-bg px-2 py-1 text-xs text-gk-text outline-none ring-1 ring-gk-border [color-scheme:dark] focus:ring-gk-blue"
          />, <input
            type="date"
            value={filter.to}
            onChange={(e) => set({ to: e.target.value })}
            className="rounded bg-gk-bg px-2 py-1 text-xs text-gk-text outline-none ring-1 ring-gk-border [color-scheme:dark] focus:ring-gk-blue"
          />])}
        </div>
      )}

      {/* Результаты */}
      <div className="ml-auto flex items-center gap-1">
        {active && (
          <span
            className={`mr-1 text-xs ${matches.length ? 'text-gk-text' : 'text-gk-red'}`}
            title={truncated ? tr('searching-last-commits', totalLoaded) : undefined}
          >
            {matches.length ? tr('of', current + 1, matches.length) : content?.loading ? tr('searching-2') : tr('nothing-found')}
            {truncated && <span className="text-gk-dim"> {tj('in-last', [totalLoaded])}</span>}
          </span>
        )}
        {active && content && !content.loading && content.commits > 0 && (
          <span data-testid="search-file-count" className="mr-1 flex items-center gap-1 text-[11px] text-gk-dim" data-tip={tr('commits-whose-changes-contain-text')}>
            {tj('in-files-2', [<FileSearch size={11} />, content.commits, content.truncated ? '+' : ''])}
          </span>
        )}
        {active && content?.error && (
          <span className="mr-1 text-[11px] text-gk-red" data-tip={content.error.hint ?? undefined}>
            {content.error.message}
          </span>
        )}
        <IconBtn title={tr('previous-shift-enter-2')} disabled={!matches.length} onClick={onPrev}>
          <ChevronUp size={15} />
        </IconBtn>
        <IconBtn title={tr('next-enter-2')} disabled={!matches.length} onClick={onNext}>
          <ChevronDown size={15} />
        </IconBtn>
        {active && (
          <button onClick={() => onChange(EMPTY_FILTER)} className="rounded px-2 py-1 text-xs text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            {tr('reset-2')}</button>
        )}
        <IconBtn title={tr('close-search-esc')} onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
