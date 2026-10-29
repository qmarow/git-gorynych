import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, FileSearch, Loader2, Search, User, X } from 'lucide-react';
import { avatarColor, initials } from '../lib/format.js';

export const EMPTY_FILTER = { query: '', authors: [], period: 'all', from: '', to: '' };

const PERIODS = [
  { id: 'all', label: 'Всё время' },
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'range', label: 'Период…' },
];

export function isFilterActive(f) {
  return Boolean(f.query.trim() || f.authors.length || f.period !== 'all');
}

// Совпадает ли коммит с фильтром: текст (сообщение, описание, SHA, автор, ветки/теги), авторы, даты
export function matchCommit(c, f) {
  if (c.wip) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [c.message, c.description, c.hash, c.author?.name, c.author?.email, ...(c.refs ?? []).map((r) => r.name)]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  if (f.authors.length && !f.authors.includes(c.author?.name)) return false;
  if (f.period !== 'all') {
    const t = new Date(c.date).getTime();
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

export default function SearchBar({ commits, filter, onChange, matches, current, onPrev, onNext, onClose, totalLoaded, truncated, inFiles = false, onToggleInFiles, content = null }) {
  const inputRef = useRef(null);
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState('');
  const authorsRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!authorsOpen) return undefined;
    const close = (e) => !authorsRef.current?.contains(e.target) && setAuthorsOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [authorsOpen]);

  // Авторы с количеством коммитов
  const authors = useMemo(() => {
    const map = new Map();
    for (const c of commits) if (!c.wip && c.author?.name) map.set(c.author.name, (map.get(c.author.name) ?? 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1]);
  }, [commits]);

  const set = (patch) => onChange({ ...filter, ...patch });
  const toggleAuthor = (name) =>
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
          placeholder={inFiles ? 'Сообщение, SHA, автор, ветка или текст в файлах…' : 'Сообщение, SHA, автор, ветка…'}
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
          data-tip={inFiles ? 'Ищется и текст в изменениях файлов: найденный коммит, файл и строка подсвечиваются. Клик — искать только в описании коммитов' : 'Искать и в изменениях файлов'}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 transition-colors ${
            inFiles ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'text-gk-muted ring-gk-border hover:text-gk-text'
          }`}
        >
          {content?.loading ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
          В файлах
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
            ? 'Все авторы'
            : filter.authors.length === 1
              ? filter.authors[0]
              : `Авторы: ${filter.authors.length}`}
          <ChevronDown size={12} />
        </button>
        {authorsOpen && (
          <div className="glass-strong absolute left-0 top-full z-30 mt-1 w-72 origin-top-left animate-pop-in rounded-lg border border-gk-border bg-gk-panel-2 p-1.5">
            <input
              autoFocus
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
              placeholder="Найти автора"
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
              {shownAuthors.length === 0 && <div className="px-2 py-1.5 text-xs text-gk-dim">Никого не нашли</div>}
            </div>
            {filter.authors.length > 0 && (
              <button onClick={() => set({ authors: [] })} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-gk-blue hover:bg-gk-hover">
                Сбросить авторов
              </button>
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
          с
          <input
            type="date"
            value={filter.from}
            onChange={(e) => set({ from: e.target.value })}
            className="rounded bg-gk-bg px-2 py-1 text-xs text-gk-text outline-none ring-1 ring-gk-border [color-scheme:dark] focus:ring-gk-blue"
          />
          по
          <input
            type="date"
            value={filter.to}
            onChange={(e) => set({ to: e.target.value })}
            className="rounded bg-gk-bg px-2 py-1 text-xs text-gk-text outline-none ring-1 ring-gk-border [color-scheme:dark] focus:ring-gk-blue"
          />
        </div>
      )}

      {/* Результаты */}
      <div className="ml-auto flex items-center gap-1">
        {active && (
          <span
            className={`mr-1 text-xs ${matches.length ? 'text-gk-text' : 'text-gk-red'}`}
            title={truncated ? `Поиск по последним ${totalLoaded} коммитам` : undefined}
          >
            {matches.length ? `${current + 1} из ${matches.length}` : content?.loading ? 'Ищем…' : 'Ничего не найдено'}
            {truncated && <span className="text-gk-dim"> · в {totalLoaded} посл.</span>}
          </span>
        )}
        {active && content && !content.loading && content.commits > 0 && (
          <span data-testid="search-file-count" className="mr-1 flex items-center gap-1 text-[11px] text-gk-dim" data-tip="Коммиты, в изменениях которых найден текст">
            <FileSearch size={11} /> в файлах: {content.commits}
            {content.truncated ? '+' : ''}
          </span>
        )}
        {active && content?.error && (
          <span className="mr-1 text-[11px] text-gk-red" data-tip={content.error.hint ?? undefined}>
            {content.error.message}
          </span>
        )}
        <IconBtn title="Предыдущий (Shift+Enter)" disabled={!matches.length} onClick={onPrev}>
          <ChevronUp size={15} />
        </IconBtn>
        <IconBtn title="Следующий (Enter)" disabled={!matches.length} onClick={onNext}>
          <ChevronDown size={15} />
        </IconBtn>
        {active && (
          <button onClick={() => onChange(EMPTY_FILTER)} className="rounded px-2 py-1 text-xs text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Сбросить
          </button>
        )}
        <IconBtn title="Закрыть поиск (Esc)" onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, disabled, ...props }) {
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
