import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, FileCode, LayoutTemplate, Pencil, Plus, RotateCcw, Save, Settings2, Ticket, Trash2, X } from 'lucide-react';
import {
  CC_TYPES,
  DEFAULT_TEMPLATES as BUILTIN_TEMPLATES,
  TICKET_FORMATS,
  attachTicket,
  extractTicket,
  fillTemplate,
  hasTicket,
  insertTemplate,
  parseSummary,
  setScope,
  subjectOf,
  suggestScopes,
  toggleBreaking,
  toggleTicket,
  toggleType,
} from '../lib/commitMsg.js';
import { DEFAULT_COMMIT_PREFS, setCommitPrefs, useCommitPrefs } from '../lib/commitPrefs.js';
import { Switch } from './Guard.jsx';
import { isMod, kb } from '../lib/platform.js';
import { plural } from '../lib/format.js';
import { readable } from '../lib/scheme.js';

/*
 * Черновик сообщения живёт вне компонента: панель WIP пересоздаётся при выборе другого коммита,
 * а набранный текст терять нельзя. Ключ — путь репозитория.
 */
const drafts = new Map();
const EMPTY = { summary: '', description: '', auto: null };

function useDraft(key) {
  const [draft, setState] = useState(() => drafts.get(key) ?? EMPTY);
  const set = (next) =>
    setState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      drafts.set(key, v);
      return v;
    });
  return [draft, set];
}

// Черновик не трогали — его можно пересобрать (сменилась ветка, подгрузился шаблон, поменяли настройки)
const untouched = (d) => (!d.summary && !d.description) || (d.auto && d.summary === d.auto.summary && d.description === d.auto.description);

const inputCls =
  'w-full rounded bg-gk-bg px-2.5 py-2 text-[13px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';

export default function CommitForm({ repoPath, branch, stagedFiles, busy, onCommit, banner, onOpenSettings }) {
  const prefs = useCommitPrefs();
  const [draft, setDraft] = useDraft(repoPath);
  const { summary, description } = draft;
  const [gitTpl, setGitTpl] = useState(null);
  const [pop, setPop] = useState(null); // { kind: 'scope'|'ticket'|'templates', anchor }
  const summaryRef = useRef(null);
  const descRef = useRef(null);

  const ticket = useMemo(() => extractTicket(branch, prefs.ticketPattern), [branch, prefs.ticketPattern]);
  const parts = parseSummary(summary);
  const ctx = { ticket, format: prefs.ticketFormat };
  const ticketOn = Boolean(ticket) && hasTicket(summary, description, ticket);
  const stagedPaths = useMemo(() => stagedFiles.map((f) => f.path), [stagedFiles]);

  const loadGitTemplate = () => {
    if (!repoPath || !window.api?.repo?.commitTemplate) return;
    window.api.repo.commitTemplate(repoPath).then((res) => {
      if (res?.ok) setGitTpl(res.data ?? null);
    });
  };
  useEffect(loadGitTemplate, [repoPath]);

  const fresh = () => {
    let s = '';
    let d = prefs.useGitTemplate && gitTpl?.body ? fillTemplate(gitTpl.body, { ticket: ticket ?? '', branch: branch ?? '' }) : '';
    if (ticket && prefs.ticketAuto) ({ summary: s, description: d } = attachTicket(s, d, ticket, prefs.ticketFormat));
    return { summary: s, description: d, auto: s || d ? { summary: s, description: d } : null };
  };

  // Автоподстановка номера задачи и шаблона — только в нетронутый черновик
  useEffect(() => {
    setDraft((d) => (untouched(d) ? fresh() : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket, prefs.ticketAuto, prefs.ticketFormat, prefs.useGitTemplate, gitTpl?.body]);

  const subject = subjectOf(summary);
  const canCommit = !busy && stagedFiles.length > 0 && subject.length > 0;

  const caretTo = (ref, pos) =>
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });

  const applySummary = (res) => {
    setDraft((d) => ({ ...d, summary: res.summary, description: res.description ?? d.description }));
    caretTo(summaryRef, res.caret);
  };

  const submit = async () => {
    if (!canCommit) return;
    const ok = await onCommit(summary.trim(), description);
    if (ok) setDraft(fresh());
  };

  const insertTpl = (body) => {
    const res = insertTemplate(description, fillTemplate(body, { ticket: ticket ?? '', branch: branch ?? '' }));
    setDraft((d) => ({ ...d, description: res.description }));
    setPop(null);
    caretTo(descRef, res.caret);
  };

  const len = summary.trim().length;
  const showChips = prefs.chips || ticket;

  return (
    <div className="space-y-2 border-t border-gk-border p-3">
      <div className="flex items-center gap-1">
        <div className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-gk-muted">Коммит</div>
        <button
          onClick={(e) => {
            loadGitTemplate();
            setPop(pop?.kind === 'templates' ? null : { kind: 'templates', anchor: e.currentTarget });
          }}
          title="Шаблоны описания коммита"
          aria-label="Шаблоны"
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] transition-colors hover:bg-gk-hover hover:text-gk-text ${
            pop?.kind === 'templates' ? 'bg-gk-hover text-gk-text' : 'text-gk-muted'
          }`}
        >
          <LayoutTemplate size={13} /> Шаблоны
        </button>
        <button onClick={onOpenSettings} title="Настройки формы коммита" className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
          <Settings2 size={13} />
        </button>
      </div>
      {banner}

      {showChips && (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Тип коммита">
          {prefs.chips &&
            CC_TYPES.map((t) => (
              <Chip
                key={t.id}
                color={readable(t.color)}
                active={parts.type === t.id}
                title={`${t.id}: ${t.hint}${parts.type === t.id ? ' — клик уберёт' : ''}`}
                onClick={() => applySummary(toggleType(summary, t.id, ctx))}
              >
                {t.id}
              </Chip>
            ))}
          {prefs.chips && (
            <>
              <button
                disabled={!parts.type}
                onClick={(e) => setPop(pop?.kind === 'scope' ? null : { kind: 'scope', anchor: e.currentTarget })}
                title={parts.type ? 'Scope — область изменений: feat(api): …' : 'Сначала выберите тип коммита'}
                className={`h-[22px] rounded-md px-1.5 font-mono text-[11px] ring-1 transition-colors disabled:opacity-35 ${
                  parts.scope && parts.scope !== ticket
                    ? 'bg-gk-fg/[0.06] text-gk-text ring-gk-fg/20'
                    : 'text-gk-dim ring-gk-border enabled:hover:text-gk-text'
                }`}
              >
                ({parts.scope && parts.scope !== ticket ? parts.scope : 'scope'})
              </button>
              {parts.type && (
                <button
                  onClick={() => applySummary(toggleBreaking(summary, ctx))}
                  title="Несовместимое изменение (BREAKING CHANGE): feat!: …"
                  className={`h-[22px] w-[22px] rounded-md font-mono text-[11px] font-bold ring-1 transition-colors ${
                    parts.breaking ? 'bg-gk-red/15 text-gk-red ring-gk-red/40' : 'text-gk-dim ring-gk-border hover:text-gk-red'
                  }`}
                >
                  !
                </button>
              )}
            </>
          )}
          {ticket && (
            <span className="ml-auto flex items-center">
              <button
                onClick={() => {
                  const res = toggleTicket(summary, description, ticket, prefs.ticketFormat);
                  applySummary(res);
                }}
                title={ticketOn ? `Убрать ${ticket} из сообщения` : `Добавить номер задачи из ветки ${branch}`}
                className={`flex h-[22px] items-center gap-1 rounded-l-md border pl-1.5 pr-1 font-mono text-[11px] transition-colors ${
                  ticketOn ? 'border-gk-blue/40 bg-gk-blue/15 text-gk-blue' : 'border-dashed border-gk-fg/20 text-gk-muted hover:border-gk-blue/50 hover:text-gk-blue'
                }`}
              >
                {ticketOn ? <Check size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={3} />}
                {ticketOn ? ticket : `[${ticket}]`}
              </button>
              <button
                onClick={(e) => setPop(pop?.kind === 'ticket' ? null : { kind: 'ticket', anchor: e.currentTarget })}
                title="Как добавлять номер задачи"
                aria-label="Формат номера задачи"
                className={`flex h-[22px] items-center rounded-r-md border border-l-0 px-0.5 transition-colors ${
                  ticketOn ? 'border-gk-blue/40 text-gk-blue hover:bg-gk-blue/10' : 'border-gk-fg/20 text-gk-dim hover:text-gk-text'
                }`}
              >
                <ChevronDown size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <input
          ref={summaryRef}
          value={summary}
          onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && isMod(e) && submit()}
          onFocus={(e) => {
            // Курсор в конце, а номер стоит в конце — встаём перед « (PROJ-1)»
            const el = e.currentTarget;
            requestAnimationFrame(() => {
              const p = parseSummary(el.value);
              if (p.suffix && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
                const pos = el.value.length - ` (${p.suffix})`.length;
                el.setSelectionRange(pos, pos);
              }
            });
          }}
          maxLength={200}
          placeholder={parts.type ? 'Кратко: что сделано' : 'Заголовок коммита'}
          aria-label="Заголовок коммита"
          className={`${inputCls} pr-10`}
        />
        {len > 0 && (
          <span
            title="Git советует укладывать заголовок в 50 символов, максимум — 72"
            className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10.5px] ${
              len > 72 ? 'text-gk-red' : len > 50 ? 'text-gk-yellow' : 'text-gk-dim'
            }`}
          >
            {len}
          </span>
        )}
      </div>
      <textarea
        ref={descRef}
        value={description}
        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        onKeyDown={(e) => e.key === 'Enter' && isMod(e) && submit()}
        rows={description.split('\n').length > 3 ? 6 : 3}
        placeholder={gitTpl?.hint && prefs.useGitTemplate ? gitTpl.hint : 'Описание'}
        aria-label="Описание"
        className={`${inputCls} resize-y`}
      />
      <button
        onClick={submit}
        disabled={!canCommit}
        title={kb('Ctrl+Enter')}
        className="w-full rounded py-2 text-[13px] font-semibold transition-colors enabled:bg-gk-green enabled:text-gk-ink enabled:shadow-lg enabled:shadow-gk-green/20 enabled:hover:brightness-110 disabled:bg-gk-hover disabled:text-gk-dim"
      >
        {stagedFiles.length === 0
          ? 'Добавьте файлы в индекс, чтобы закоммитить'
          : !subject
            ? 'Введите сообщение коммита'
            : `Закоммитить ${stagedFiles.length} ${plural(stagedFiles.length, 'файл', 'файла', 'файлов')}`}
      </button>

      {pop?.kind === 'scope' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={240}>
          <ScopePicker
            value={parts.scope && parts.scope !== ticket ? parts.scope : ''}
            suggestions={suggestScopes(stagedPaths)}
            onPick={(s) => {
              setPop(null);
              applySummary(setScope(summary, s, ctx));
            }}
          />
        </Popover>
      )}
      {pop?.kind === 'ticket' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={290}>
          <TicketOptions
            ticket={ticket}
            branch={branch}
            prefs={prefs}
            onFormat={(f) => {
              // Номер уже стоит — переставляем его в новом формате
              if (ticketOn) {
                const off = toggleTicket(summary, description, ticket, prefs.ticketFormat);
                const on = attachTicket(off.summary, off.description, ticket, f);
                setDraft((d) => ({ ...d, summary: on.summary, description: on.description }));
              }
              setCommitPrefs({ ticketFormat: f });
            }}
            onOpenSettings={() => {
              setPop(null);
              onOpenSettings?.();
            }}
          />
        </Popover>
      )}
      {pop?.kind === 'templates' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={320}>
          <TemplatesMenu
            prefs={prefs}
            gitTpl={gitTpl}
            ticket={ticket}
            description={description}
            onInsert={insertTpl}
          />
        </Popover>
      )}
    </div>
  );
}

function Chip({ color, active, title, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={active ? { backgroundColor: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}66` } : { '--c': color }}
      className={`h-[22px] rounded-md px-1.5 font-mono text-[11px] transition-colors ${
        active ? 'font-semibold' : 'text-gk-muted ring-1 ring-gk-border hover:bg-gk-fg/[0.04] hover:text-[var(--c)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- Поповер ---------------- */

function Popover({ anchor, onClose, width = 280, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8));
    // Форма коммита внизу панели — по умолчанию открываемся вверх
    let top = a.top - r.height - 6;
    if (top < 8) top = Math.max(8, Math.min(a.bottom + 6, window.innerHeight - r.height - 8));
    if (Math.abs(top - pos.top) > 0.5 || Math.abs(left - pos.left) > 0.5) setPos({ left, top });
  });

  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose();
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      style={{ left: pos.left, top: pos.top, width }}
      className="glass-strong fixed z-50 animate-pop-in overflow-hidden rounded-lg border border-gk-border bg-gk-panel-2 text-[12.5px] shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}

function PopTitle({ children, right }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gk-dim">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  );
}

/* ---------------- Scope ---------------- */

function ScopePicker({ value, suggestions, onPick }) {
  const [text, setText] = useState(value);
  return (
    <div className="pb-2">
      <PopTitle>Scope — что затронуто</PopTitle>
      <div className="px-3">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[()\n]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && onPick(text)}
          placeholder="api, ui, auth…"
          className="w-full rounded-md bg-gk-bg px-2 py-1 font-mono text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
      </div>
      {suggestions.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-2 text-[10.5px] text-gk-dim">По папкам staged-файлов</div>
          <div className="flex flex-wrap gap-1 px-3">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onPick(s)}
                className={`rounded-md px-1.5 py-0.5 font-mono text-[11.5px] ring-1 transition-colors ${
                  s === value ? 'bg-gk-blue/15 text-gk-blue ring-gk-blue/40' : 'text-gk-muted ring-gk-border hover:text-gk-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-2 flex items-center gap-1 border-t border-gk-border px-3 pt-2">
        <button onClick={() => onPick(text)} className="rounded-md bg-gk-blue/15 px-2 py-1 text-[12px] font-medium text-gk-blue hover:bg-gk-blue/25">
          Применить
        </button>
        {value && (
          <button onClick={() => onPick('')} className="rounded-md px-2 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Убрать scope
          </button>
        )}
        <span className="ml-auto text-[10.5px] text-gk-dim">Enter</span>
      </div>
    </div>
  );
}

/* ---------------- Номер задачи ---------------- */

function TicketOptions({ ticket, branch, prefs, onFormat, onOpenSettings }) {
  return (
    <div className="pb-2">
      <PopTitle>
        Номер задачи <span className="font-mono normal-case tracking-normal text-gk-blue">{ticket}</span>
      </PopTitle>
      <div className="px-3 pb-1.5 text-[11px] leading-snug text-gk-dim">
        Найден в имени ветки <span className="font-mono text-gk-muted">{branch}</span>
      </div>
      {TICKET_FORMATS.map((f) => (
        <button
          key={f.id}
          onClick={() => onFormat(f.id)}
          title={f.hint}
          className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-gk-hover"
        >
          <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-1 ${prefs.ticketFormat === f.id ? 'ring-gk-blue' : 'ring-gk-border'}`}>
            {prefs.ticketFormat === f.id && <span className="h-1.5 w-1.5 rounded-full bg-gk-blue" />}
          </span>
          <span className="truncate font-mono text-[11.5px] text-gk-text">{f.label.replaceAll('PROJ-123', ticket)}</span>
        </button>
      ))}
      <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-gk-border px-3 pt-2">
        <Switch small checked={prefs.ticketAuto} onChange={(v) => setCommitPrefs({ ticketAuto: v })} />
        <span className="text-gk-text">Автоматически добавлять номер задачи</span>
      </label>
      <button onClick={onOpenSettings} className="mt-1.5 px-3 text-[11px] text-gk-dim hover:text-gk-text">
        Своё правило распознавания — в настройках →
      </button>
    </div>
  );
}

/* ---------------- Шаблоны ---------------- */

function TemplatesMenu({ prefs, gitTpl, ticket, description, onInsert }) {
  const [edit, setEdit] = useState(null); // { id?, name, body }

  const save = (t) => {
    const list = prefs.templates;
    const next = t.id && list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [...list, { ...t, id: `tpl-${Date.now()}` }];
    setCommitPrefs({ templates: next });
    setEdit(null);
  };

  if (edit) return <TemplateEditor value={edit} onSave={save} onCancel={() => setEdit(null)} />;

  const current = description.trim();
  return (
    <div className="pb-1.5">
      {gitTpl && (
        <>
          <PopTitle>Из git config</PopTitle>
          {gitTpl.error ? (
            <div className="flex items-start gap-1.5 px-3 pb-1.5 text-[11.5px] leading-snug text-gk-yellow">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {gitTpl.error}
            </div>
          ) : (
            <button
              onClick={() => onInsert(gitTpl.body || gitTpl.hint)}
              disabled={!gitTpl.body && !gitTpl.hint}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gk-hover disabled:opacity-40"
              title={gitTpl.body || gitTpl.hint}
            >
              <FileCode size={13} className="shrink-0 text-gk-green" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gk-text">commit.template</span>
                <span className="block truncate font-mono text-[10.5px] text-gk-dim">{gitTpl.path}</span>
              </span>
            </button>
          )}
        </>
      )}
      <PopTitle
        right={
          <button
            onClick={() => setEdit({ name: '', body: '' })}
            title="Новый шаблон"
            className="flex items-center gap-0.5 rounded px-1 normal-case tracking-normal text-gk-muted hover:bg-gk-hover hover:text-gk-text"
          >
            <Plus size={11} /> новый
          </button>
        }
      >
        Мои шаблоны
      </PopTitle>
      {prefs.templates.length === 0 && <div className="px-3 pb-1 text-[11.5px] text-gk-dim">Пока пусто — сохраните описание как шаблон.</div>}
      <div className="max-h-64 overflow-y-auto">
        {prefs.templates.map((t) => (
          <div key={t.id} className="group flex items-center hover:bg-gk-hover">
            <button onClick={() => onInsert(t.body)} title={t.body} className="min-w-0 flex-1 px-3 py-1.5 text-left">
              <span className="block truncate text-gk-text">{t.name || 'Без названия'}</span>
              <span className="block truncate text-[10.5px] text-gk-dim">{t.body.replace(/\s*\n\s*/g, ' · ')}</span>
            </button>
            <span className="flex shrink-0 gap-0.5 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button onClick={() => setEdit(t)} title="Изменить" className="rounded p-1 text-gk-muted hover:bg-gk-fg/10 hover:text-gk-text">
                <Pencil size={12} />
              </button>
              <button
                onClick={() => setCommitPrefs({ templates: prefs.templates.filter((x) => x.id !== t.id) })}
                title="Удалить"
                className="rounded p-1 text-gk-muted hover:bg-gk-red/15 hover:text-gk-red"
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-gk-border px-1.5 pt-1.5">
        <button
          disabled={!current}
          onClick={() => {
            // Номер текущей задачи в шаблоне меняем на {ticket} — подставится свой в следующий раз
            const body = ticket ? current.split(ticket).join('{ticket}') : current;
            setEdit({ name: current.split('\n')[0].slice(0, 40), body });
          }}
          title={current ? 'Сохранить то, что сейчас в описании' : 'Сначала напишите описание'}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-gk-muted hover:bg-gk-hover hover:text-gk-text disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Save size={13} /> Сохранить текущее описание как шаблон
        </button>
        <div className="px-1.5 pb-0.5 pt-1 text-[10.5px] leading-snug text-gk-dim">
          <span className="font-mono">{'{ticket}'}</span> и <span className="font-mono">{'{branch}'}</span> подставятся при вставке
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({ value, onSave, onCancel, inline }) {
  const [name, setName] = useState(value.name ?? '');
  const [body, setBody] = useState(value.body ?? '');
  const ok = name.trim() && body.trim();
  return (
    <div className={inline ? 'space-y-1.5' : 'space-y-1.5 p-3'}>
      {!inline && <div className="text-[10px] font-semibold uppercase tracking-wider text-gk-dim">{value.id ? 'Изменить шаблон' : 'Новый шаблон'}</div>}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Название"
        maxLength={80}
        className="w-full rounded-md bg-gk-bg px-2 py-1 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && isMod(e) && ok && onSave({ ...value, name: name.trim(), body })}
        rows={6}
        placeholder={'Что сделано:\n- \n\nКак проверить:\n\nЗадача: {ticket}'}
        className="w-full resize-y rounded-md bg-gk-bg px-2 py-1 font-mono text-[12px] leading-relaxed text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <div className="flex items-center gap-1">
        <button
          disabled={!ok}
          onClick={() => onSave({ ...value, name: name.trim(), body })}
          className="rounded-md bg-gk-green/15 px-2 py-1 text-[12px] font-medium text-gk-green hover:bg-gk-green/25 disabled:opacity-40"
        >
          Сохранить
        </button>
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          Отмена
        </button>
        <span className="ml-auto text-[10.5px] text-gk-dim">{'{ticket} {branch}'}</span>
      </div>
    </div>
  );
}

/* ---------------- Настройки → Коммиты ---------------- */

export function CommitSettings({ repoPath, branch }) {
  const prefs = useCommitPrefs();
  const [gitTpl, setGitTpl] = useState(undefined);
  const [testBranch, setTestBranch] = useState(branch || 'feature/PROJ-123-login-form');
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    if (!repoPath || !window.api?.repo?.commitTemplate) return setGitTpl(null);
    window.api.repo.commitTemplate(repoPath).then((res) => setGitTpl(res?.ok ? (res.data ?? null) : null));
  }, [repoPath]);

  let patternError = null;
  if (prefs.ticketPattern.trim()) {
    try {
      new RegExp(prefs.ticketPattern.trim());
    } catch (e) {
      patternError = e.message;
    }
  }
  const found = extractTicket(testBranch, prefs.ticketPattern);
  const sample = found ?? 'PROJ-123';

  const saveTpl = (t) => {
    const list = prefs.templates;
    setCommitPrefs({
      templates: t.id && list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [...list, { ...t, id: `tpl-${Date.now()}` }],
    });
    setEdit(null);
  };

  return (
    <div className="space-y-6 text-[12.5px]">
      <section className="space-y-3">
        <H3>Conventional Commits</H3>
        <label className="flex cursor-pointer items-start gap-3">
          <Switch checked={prefs.chips} onChange={(v) => setCommitPrefs({ chips: v })} />
          <span>
            <span className="block font-medium text-gk-text">Панель типов над заголовком коммита</span>
            <span className="mt-0.5 block leading-relaxed text-gk-muted">
              Чипсы <Mono>feat</Mono> <Mono>fix</Mono> <Mono>refactor</Mono> и др. ставят префикс в начало заголовка, повторный клик убирает его.
              Рядом — <Mono>(scope)</Mono> с подсказками по папкам staged-файлов и <Mono>!</Mono> для несовместимых изменений.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <H3>Номер задачи из имени ветки</H3>
        <label className="flex cursor-pointer items-start gap-3">
          <Switch checked={prefs.ticketAuto} onChange={(v) => setCommitPrefs({ ticketAuto: v })} />
          <span>
            <span className="block font-medium text-gk-text">Автоматически добавлять номер задачи</span>
            <span className="mt-0.5 block leading-relaxed text-gk-muted">
              Если в имени ветки есть номер (<Mono>feature/PROJ-123-…</Mono>, <Mono>bugfix/1234-…</Mono>, <Mono>issue-42</Mono>), он сразу
              появится в новом сообщении. Выключено — номер добавляется кликом по кнопке <Mono>+ [PROJ-123]</Mono>.
            </span>
          </span>
        </label>
        <div className="ml-11 space-y-1">
          <div className="text-[11.5px] text-gk-muted">Куда ставить</div>
          {TICKET_FORMATS.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 py-0.5">
              <input type="radio" name="ticketFormat" checked={prefs.ticketFormat === f.id} onChange={() => setCommitPrefs({ ticketFormat: f.id })} className="accent-[var(--color-gk-blue)]" />
              <span className="w-48 font-mono text-[12px] text-gk-text">{f.label.replaceAll('PROJ-123', sample)}</span>
              <span className="text-[11.5px] text-gk-dim">{f.hint}</span>
            </label>
          ))}
        </div>
        <div className="ml-11 space-y-1.5 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
          <div className="text-[11.5px] text-gk-muted">
            Своё правило — регулярное выражение, номер берётся из первой группы. Пусто — встроенное распознавание.
          </div>
          <input
            value={prefs.ticketPattern}
            onChange={(e) => setCommitPrefs({ ticketPattern: e.target.value })}
            placeholder="например: (TASK-\d+)  или  /(\d+)-"
            spellCheck={false}
            className={`w-full rounded-md bg-gk-bg px-2 py-1 font-mono text-[12px] text-gk-text outline-none ring-1 placeholder:text-gk-dim focus:ring-gk-blue ${patternError ? 'ring-gk-red/60' : 'ring-gk-border'}`}
          />
          {patternError && <div className="text-[11px] text-gk-red">Ошибка в выражении — используется встроенное распознавание</div>}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11.5px] text-gk-dim">Проверить на ветке</span>
            <input
              value={testBranch}
              onChange={(e) => setTestBranch(e.target.value)}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md bg-gk-bg px-2 py-1 font-mono text-[12px] text-gk-text outline-none ring-1 ring-gk-border focus:ring-gk-blue"
            />
            <span className={`shrink-0 font-mono text-[12px] ${found ? 'text-gk-blue' : 'text-gk-dim'}`}>
              {found ? (
                <>
                  <Ticket size={12} className="mr-1 inline align-[-2px]" />
                  {found}
                </>
              ) : (
                'не найдено'
              )}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <H3>Шаблоны описания</H3>
        <label className="flex cursor-pointer items-start gap-3">
          <Switch checked={prefs.useGitTemplate} onChange={(v) => setCommitPrefs({ useGitTemplate: v })} />
          <span>
            <span className="block font-medium text-gk-text">Брать шаблон из git config (commit.template)</span>
            <span className="mt-0.5 block leading-relaxed text-gk-muted">
              Как в обычном <Mono>git commit</Mono>: текст шаблона предзаполняет описание, строки с <Mono>#</Mono> становятся подсказкой.
            </span>
            <span className="mt-1 block text-[11.5px]">
              {gitTpl === undefined ? (
                <span className="text-gk-dim">Проверяем…</span>
              ) : !repoPath ? (
                <span className="text-gk-dim">Откройте репозиторий, чтобы увидеть его шаблон.</span>
              ) : gitTpl?.error ? (
                <span className="text-gk-yellow">{gitTpl.error}</span>
              ) : gitTpl ? (
                <span className="text-gk-green">
                  В этом репозитории: <span className="font-mono">{gitTpl.path}</span>
                </span>
              ) : (
                <span className="text-gk-dim">
                  В этом репозитории не задан. Задать: <Mono>git config commit.template .gitmessage</Mono>
                </span>
              )}
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <div className="flex items-center">
            <span className="flex-1 text-[11.5px] text-gk-muted">Мои шаблоны — вставляются кнопкой «Шаблоны» над формой коммита</span>
            <button
              onClick={() => setCommitPrefs({ templates: BUILTIN_TEMPLATES })}
              title="Вернуть стандартные шаблоны (свои будут удалены)"
              className="mr-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-gk-dim hover:bg-gk-hover hover:text-gk-text"
            >
              <RotateCcw size={11} /> По умолчанию
            </button>
            <button
              onClick={() => setEdit({ name: '', body: '' })}
              className="flex items-center gap-1 rounded bg-gk-hover px-1.5 py-0.5 text-[11.5px] text-gk-text hover:bg-gk-fg/10"
            >
              <Plus size={11} /> Новый
            </button>
          </div>
          {edit && !edit.id && (
            <div className="rounded-lg border border-gk-blue/30 bg-gk-fg/[0.02] p-2.5">
              <TemplateEditor inline value={edit} onSave={saveTpl} onCancel={() => setEdit(null)} />
            </div>
          )}
          {prefs.templates.map((t) =>
            edit?.id === t.id ? (
              <div key={t.id} className="rounded-lg border border-gk-blue/30 bg-gk-fg/[0.02] p-2.5">
                <TemplateEditor inline value={edit} onSave={saveTpl} onCancel={() => setEdit(null)} />
              </div>
            ) : (
              <div key={t.id} className="group flex items-start gap-2 rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gk-text">{t.name}</div>
                  <pre className="mt-0.5 max-h-20 overflow-hidden whitespace-pre-wrap font-mono text-[11px] leading-snug text-gk-dim">{t.body}</pre>
                </div>
                <button onClick={() => setEdit(t)} title="Изменить" className="rounded p-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => setCommitPrefs({ templates: prefs.templates.filter((x) => x.id !== t.id) })}
                  title="Удалить"
                  className="rounded p-1 text-gk-muted hover:bg-gk-red/15 hover:text-gk-red"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ),
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => setCommitPrefs({ ...DEFAULT_COMMIT_PREFS, templates: prefs.templates })}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11.5px] text-gk-dim hover:bg-gk-hover hover:text-gk-text"
        >
          <X size={11} /> Сбросить настройки (шаблоны останутся)
        </button>
      </div>
    </div>
  );
}

function H3({ children }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{children}</h3>;
}

function Mono({ children }) {
  return <code className="rounded bg-gk-fg/[0.06] px-1 font-mono text-[11.5px] text-gk-text">{children}</code>;
}
