import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Cloud,
  CornerDownLeft,
  Crosshair,
  GitBranch,
  Plus,
  Search,
} from 'lucide-react';
import { relativeTime } from '../lib/format.js';

// Имя ветки, которое git точно не примет — чтобы не предлагать «Создать» заведомо зря
const INVALID_NAME = /(^[-./])|(\.\.)|([\s~^:?*[\\])|(@\{)|(\/$)|(\.lock$)|(\.$)/;

function matches(name, query) {
  if (!query) return true;
  const n = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => n.includes(part));
}

function Highlight({ text, query }) {
  const q = query.trim().toLowerCase().split(/\s+/)[0];
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="rounded-sm bg-gk-green/20 text-gk-green">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

const byDate = (a, b) => (b.date ?? '').localeCompare(a.date ?? '');

/**
 * Выпадающий список веток: поиск, переключение (локальные и удалённые), создание новой.
 * Управление с клавиатуры: ↑/↓ — выбор, Enter — переключиться/создать, Esc — закрыть.
 */
export default function BranchPicker({ repo, onClose, onCheckout, onCreate, onNewBranchDialog, onLocate }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const operation = repo.operation;
  const q = query.trim();

  const { locals, remotes } = useMemo(() => {
    const localNames = new Set(repo.localBranches.map((b) => b.name));
    const tracked = new Set(repo.localBranches.map((b) => b.upstream).filter(Boolean));
    const locals = repo.localBranches
      .filter((b) => matches(b.name, q))
      .sort((a, b) => (a.name === repo.currentBranch ? -1 : b.name === repo.currentBranch ? 1 : byDate(a, b)));
    // Удалённые, у которых уже есть локальная ветка-двойник, не дублируем
    const remotes = repo.remotes
      .flatMap((r) => r.branches)
      .filter((b) => !tracked.has(b.fullName) && !localNames.has(b.name))
      .filter((b) => matches(b.fullName, q))
      .sort(byDate);
    return { locals, remotes };
  }, [repo, q]);

  const exact = repo.localBranches.some((b) => b.name === q);
  const canCreate = Boolean(q) && !exact && !INVALID_NAME.test(q) && Boolean(repo.headHash);

  // Плоский список строк для навигации стрелками
  const rows = useMemo(() => {
    const list = [
      ...locals.map((b) => ({ kind: 'local', key: `l:${b.name}`, branch: b })),
      ...remotes.map((b) => ({ kind: 'remote', key: `r:${b.fullName}`, branch: b })),
    ];
    if (canCreate) list.push({ kind: 'create', key: 'create' });
    return list;
  }, [locals, remotes, canCreate]);

  // При вводе — выделяем первое совпадение (или «Создать», если совпадений нет)
  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (row) => {
    if (!row) return;
    const isCurrent = row.kind === 'local' && row.branch.name === repo.currentBranch;
    if (operation && !isCurrent) return; // переключение заблокировано незавершённой операцией
    if (row.kind === 'create') {
      onCreate(q);
      onClose();
      return;
    }
    if (row.kind === 'local') {
      if (row.branch.name === repo.currentBranch) onLocate(row.branch.hash);
      else onCheckout({ branch: row.branch.name });
    } else {
      onCheckout({ remoteBranch: { name: row.branch.name, fullName: row.branch.fullName } });
    }
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const switchBlocked = Boolean(operation);
  let index = -1;
  const rowProps = (row) => {
    index += 1;
    const i = index;
    return {
      'data-index': i,
      active: i === active,
      onMouseMove: () => i !== active && setActive(i),
      onClick: () => choose(row),
    };
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className="absolute left-0 top-full z-40 mt-1 flex max-h-[min(560px,75vh)] w-[380px] origin-top-left animate-pop-in flex-col overflow-hidden rounded-lg border border-gk-fg/10 bg-[var(--gk-solid-2)] shadow-2xl shadow-gk-sink/60 ring-1 ring-gk-sink/40"
    >
      {/* Поиск */}
      <div className="flex items-center gap-2 border-b border-gk-border px-3 py-2">
        <Search size={14} className="shrink-0 text-gk-dim" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти ветку или ввести имя новой…"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-gk-text outline-none placeholder:text-gk-dim"
        />
        <kbd className="rounded border border-gk-border px-1 text-[10px] text-gk-dim">Esc</kbd>
      </div>

      {switchBlocked && (
        <div className="flex items-start gap-2 border-b border-gk-border bg-gk-yellow/10 px-3 py-2 text-[12px] text-gk-yellow">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Идёт {operation} — переключение веток недоступно, пока операция не завершена или не прервана.
        </div>
      )}
      {!switchBlocked && repo.wipFiles.length > 0 && (
        <div
          className="border-b border-gk-border px-3 py-1.5 text-[11px] text-gk-dim"
          title="Если изменения конфликтуют с выбранной веткой, git остановится и попросит сначала сделать commit или stash"
        >
          Незакоммиченные изменения ({repo.wipFiles.length}) перейдут вместе с вами в выбранную ветку
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {locals.length > 0 && <SectionTitle count={locals.length}>Локальные</SectionTitle>}
        {locals.map((b) => {
          const isCurrent = b.name === repo.currentBranch;
          const row = rows.find((r) => r.key === `l:${b.name}`);
          return (
            <Row
              key={b.name}
              {...rowProps(row)}
              disabled={switchBlocked && !isCurrent}
              title={isCurrent ? 'Текущая ветка — показать в графе' : `Переключиться на ${b.name}`}
              icon={isCurrent ? <Check size={13} className="text-gk-green" /> : <GitBranch size={13} className="text-gk-muted" />}
              name={<Highlight text={b.name} query={q} />}
              current={isCurrent}
              meta={
                <>
                  {b.ahead > 0 && (
                    <span className="flex items-center text-gk-blue" title={`Впереди ${b.upstream} на ${b.ahead}`}>
                      <ArrowUp size={11} />
                      {b.ahead}
                    </span>
                  )}
                  {b.behind > 0 && (
                    <span className="flex items-center text-gk-yellow" title={`Позади ${b.upstream} на ${b.behind}`}>
                      <ArrowDown size={11} />
                      {b.behind}
                    </span>
                  )}
                  {b.gone && <span className="text-gk-red" title="Ветка на remote удалена">gone</span>}
                  {!b.upstream && <span title="Нет upstream — ветка только локальная">local</span>}
                </>
              }
              date={b.date}
              onLocate={() => {
                onLocate(b.hash);
                onClose();
              }}
            />
          );
        })}

        {remotes.length > 0 && <SectionTitle count={remotes.length}>Удалённые</SectionTitle>}
        {remotes.map((b) => {
          const row = rows.find((r) => r.key === `r:${b.fullName}`);
          return (
            <Row
              key={b.fullName}
              {...rowProps(row)}
              disabled={switchBlocked}
              title={`Создать локальную ветку ${b.name}, отслеживающую ${b.fullName}, и переключиться`}
              icon={<Cloud size={13} className="text-gk-blue" />}
              name={<Highlight text={b.fullName} query={q} />}
              meta={<span className="hidden group-data-[active=true]:inline">создать локальную</span>}
              date={b.date}
              onLocate={() => {
                onLocate(b.hash);
                onClose();
              }}
            />
          );
        })}

        {canCreate && (
          <Row
            {...rowProps(rows[rows.length - 1])}
            disabled={switchBlocked}
            title={`Создать ветку ${q} от текущего HEAD и переключиться на неё`}
            icon={<Plus size={13} className="text-gk-green" />}
            name={
              <span>
                Создать ветку <span className="font-semibold text-gk-green">{q}</span>
              </span>
            }
            meta={<span>от HEAD</span>}
          />
        )}

        {rows.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-gk-dim">
            {q && INVALID_NAME.test(q) ? `«${q}» — недопустимое имя ветки` : 'Ничего не найдено'}
          </div>
        )}
      </div>

      {/* Низ: подсказки и создание от выбранного коммита */}
      <div className="flex items-center gap-3 border-t border-gk-border px-3 py-1.5 text-[11px] text-gk-dim">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-gk-border px-1">↑↓</kbd> выбор
        </span>
        <span className="flex items-center gap-1">
          <kbd className="flex items-center rounded border border-gk-border px-1">
            <CornerDownLeft size={10} />
          </kbd>
          переключиться
        </span>
        <button
          disabled={!repo.headHash}
          onClick={() => {
            onClose();
            onNewBranchDialog();
          }}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-40"
        >
          <Plus size={12} /> Новая ветка…
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children, count }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
      {children}
      <span className="font-normal">{count}</span>
    </div>
  );
}

function Row({ icon, name, meta, date, current, active, disabled, onLocate, title, ...props }) {
  return (
    <div
      {...props}
      role="option"
      aria-selected={active}
      aria-disabled={disabled}
      data-active={active}
      title={title}
      onClick={disabled ? undefined : props.onClick}
      className={`group mx-1 flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] ${
        active ? 'bg-gk-hover' : ''
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${current ? 'text-gk-strong' : 'text-gk-text'}`}
    >
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className={`min-w-0 flex-1 truncate ${current ? 'font-semibold' : ''}`}>{name}</span>
      {current && (
        <span className="shrink-0 rounded bg-gk-green/15 px-1.5 text-[10px] font-medium text-gk-green">текущая</span>
      )}
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-gk-dim">{meta}</span>
      {date && <span className="w-[74px] shrink-0 text-right text-[10px] text-gk-dim">{relativeTime(date)}</span>}
      {onLocate && (
        <button
          title="Показать в графе"
          onClick={(e) => {
            e.stopPropagation();
            onLocate();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gk-dim opacity-0 hover:bg-gk-fg/10 hover:text-gk-text group-hover:opacity-100"
        >
          <Crosshair size={12} />
        </button>
      )}
    </div>
  );
}
