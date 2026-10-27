import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  CircleX,
  Combine,
  GitBranch,
  GripVertical,
  Info,
  Layers,
  Loader2,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { FILE_STATUS, plural, relativeTime } from '../lib/format.js';
import { isMod, kb } from '../lib/platform.js';
import { readable } from '../lib/scheme.js';

const api = window.api;

export const REBASE_ACTIONS = [
  { id: 'pick', key: 'P', label: 'Оставить', hint: 'Коммит остаётся как есть', icon: Check, cls: 'text-gk-text', active: 'bg-gk-fg/15 text-gk-strong' },
  { id: 'reword', key: 'R', label: 'Изменить сообщение', hint: 'Коммит остаётся, меняется только текст', icon: Pencil, cls: 'text-gk-yellow', active: 'bg-gk-yellow/20 text-gk-yellow' },
  { id: 'squash', key: 'S', label: 'Объединить с коммитом ниже', hint: 'Изменения и текст присоединяются к коммиту ниже', icon: Combine, cls: 'text-gk-purple', active: 'bg-gk-purple/20 text-gk-purple' },
  { id: 'fixup', key: 'F', label: 'Влить в коммит ниже без текста', hint: 'Изменения присоединяются к коммиту ниже, его текст не меняется', icon: ArrowDownToLine, cls: 'text-gk-purple', active: 'bg-gk-purple/20 text-gk-purple' },
  { id: 'drop', key: 'D', label: 'Удалить', hint: 'Коммит и его изменения пропадут из истории', icon: Trash2, cls: 'text-gk-red', active: 'bg-gk-red/20 text-gk-red' },
];
const ACTION = Object.fromEntries(REBASE_ACTIONS.map((a) => [a.id, a]));

/**
 * Интерактивный rebase с предпросмотром.
 * session: { upstream, onto?, title } — коммиты после upstream переносятся на onto (по умолчанию на upstream).
 */
export default function RebaseView({ repoPath, session, hidden, busy, onClose, onApply, onStart, onOpenDiff, onLocate }) {
  const [plan, setPlan] = useState(null); // от старых к новым: [{ hash, action, message? }]
  const [preview, setPreview] = useState({ loading: true, data: null, error: null });
  const [selected, setSelected] = useState(0); // индекс в отображаемом списке (новые сверху)
  const [editing, setEditing] = useState(null); // hash коммита, чьё сообщение правим
  const [hoverAfter, setHoverAfter] = useState(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const meta = useRef(new Map()); // hash → { subject, message, author }
  const reqId = useRef(0);
  const firstPlan = useRef(true);

  // Первый запрос — без плана: backend вернёт список коммитов и план «всё pick»
  const load = useCallback(
    (p) => {
      const id = ++reqId.current;
      setPreview((s) => ({ ...s, loading: true }));
      api.repo.rebasePreview(repoPath, { upstream: session.upstream, onto: session.onto, plan: p ?? undefined }).then((res) => {
        if (id !== reqId.current) return;
        if (!res.ok) {
          setPreview((s) => ({ loading: false, data: s.data, error: res.error }));
          return;
        }
        for (const c of res.data.before) meta.current.set(c.hash, c);
        if (!p) setPlan(res.data.plan);
        setPreview({ loading: false, data: res.data, error: null });
      });
    },
    [repoPath, session.upstream, session.onto],
  );

  useEffect(() => {
    firstPlan.current = true;
    setPlan(null);
    load(null);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Каждое изменение плана — новый предпросмотр (с небольшой задержкой, пока пользователь кликает)
  useEffect(() => {
    if (!plan) return undefined;
    if (firstPlan.current) {
      firstPlan.current = false;
      return undefined;
    }
    const t = setTimeout(() => load(plan), 220);
    return () => clearTimeout(t);
  }, [plan, load]);

  const rows = useMemo(() => (plan ? [...plan].reverse() : []), [plan]); // новые сверху, как в графе
  const n = rows.length;
  const toPlanIndex = (rowIndex) => n - 1 - rowIndex;

  const update = (rowIndex, patch) =>
    setPlan((p) => {
      const next = [...p];
      const i = p.length - 1 - rowIndex;
      next[i] = { ...next[i], ...patch };
      if (patch.action && patch.action !== 'reword' && !('message' in patch) && next[i].action !== 'pick') delete next[i].message;
      return next;
    });

  const setAction = (rowIndex, action) => {
    const item = rows[rowIndex];
    if (!item) return;
    if (action === 'reword') {
      update(rowIndex, { action, message: item.message ?? meta.current.get(item.hash)?.message ?? '' });
      setEditing(item.hash);
    } else {
      update(rowIndex, { action, message: undefined });
      if (editing === item.hash) setEditing(null);
    }
  };

  const move = (rowIndex, dir) => {
    const to = rowIndex + dir;
    if (to < 0 || to >= n) return;
    setPlan((p) => {
      const next = [...p];
      const a = toPlanIndex(rowIndex);
      const b = toPlanIndex(to);
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    setSelected(to);
  };

  const moveTo = (from, to) => {
    if (from === to) return;
    setPlan((p) => {
      const r = [...p].reverse();
      const [item] = r.splice(from, 1);
      r.splice(to, 0, item);
      return r.reverse();
    });
    setSelected(to);
  };

  const reset = () => {
    const d = preview.data;
    if (!d) return;
    setPlan(d.before.map((c) => ({ hash: c.hash, action: 'pick' })));
    setEditing(null);
  };

  // Группы для отображения: коммит + присоединённые к нему squash/fixup (они выше него в списке)
  const groupInfo = useMemo(() => {
    const info = new Map(); // hash → { target: hash }  для squash/fixup
    const heads = new Map(); // hash головы → [hash участников]
    if (!plan) return { info, heads };
    let head = null;
    for (const item of plan) {
      if (item.action === 'drop') continue;
      if (item.action === 'squash' || item.action === 'fixup') {
        if (head) {
          info.set(item.hash, { target: head });
          heads.get(head).push(item.hash);
        }
      } else {
        head = item.hash;
        heads.set(head, []);
      }
    }
    return { info, heads };
  }, [plan]);

  // Сообщение группы со squash: если пользователь не правил — как сделает git
  const defaultGroupMessage = (headHash) => {
    const parts = [meta.current.get(headHash)?.message ?? ''];
    for (const h of groupInfo.heads.get(headHash) ?? []) {
      const item = plan.find((p) => p.hash === h);
      if (item?.action === 'squash') parts.push(meta.current.get(h)?.message ?? '');
    }
    return parts.join('\n\n');
  };

  const firstKeptIsSquash = (() => {
    const kept = plan?.filter((p) => p.action !== 'drop') ?? [];
    return kept[0] && (kept[0].action === 'squash' || kept[0].action === 'fixup');
  })();

  // Клавиатура: ↑/↓ — выбор, Alt+↑/↓ — переместить, P R S F D — действие, Esc — закрыть
  useEffect(() => {
    if (hidden) return undefined;
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (!n) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) move(selected, dir);
        else setSelected((s) => Math.max(0, Math.min(n - 1, s + dir)));
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const a = REBASE_ACTIONS.find((x) => x.key === e.key.toUpperCase() || x.key === e.code.replace('Key', ''));
      if (a) {
        e.preventDefault();
        setAction(selected, a.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const d = preview.data;
  const changedCount = plan && d ? plan.filter((p) => p.action !== 'pick' || p.message).length + (plan.some((p, i) => p.hash !== d.before[i]?.hash) ? 1 : 0) : 0;
  const ontoMode = d && !d.interactiveFromAncestor;
  const canApply = d && d.ok && !d.unchanged && !preview.loading && !preview.error && !busy && !firstKeptIsSquash;

  return (
    <div className={`flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg ${hidden ? 'hidden' : ''}`}>
      {/* Заголовок */}
      <div className="glass flex h-11 shrink-0 items-center gap-2.5 border-b border-gk-border bg-gk-panel px-3">
        <Layers size={16} className="shrink-0 text-gk-blue" />
        <div className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-semibold text-gk-strong">Интерактивный rebase</span>
          {d && (
            <span className="ml-2 text-gk-muted">
              ветка <span className="font-medium text-gk-text">{d.branch}</span>
              {ontoMode ? (
                <>
                  {' '}→ на <button className="font-mono text-gk-blue hover:underline" onClick={() => onLocate(d.onto.hash)}>{d.onto.hash.slice(0, 7)}</button>{' '}
                  <span className="text-gk-dim">«{d.onto.subject}»</span>
                </>
              ) : (
                <>
                  , коммиты после{' '}
                  <button className="font-mono text-gk-blue hover:underline" onClick={() => onLocate(d.upstream.hash)}>
                    {d.upstream.hash.slice(0, 7)}
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        <span className="hidden shrink-0 text-[11px] text-gk-dim xl:inline">{kb('↑↓ выбор · Alt+↑↓ двигать · P R S F D — действие')}</span>
        <button onClick={onClose} title="Закрыть без изменений (Esc)" className="rounded p-1.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <X size={15} />
        </button>
      </div>

      {preview.error && !d ? (
        <div className="m-6 max-w-xl rounded-lg border border-gk-red/30 bg-gk-red/10 px-4 py-3 text-[13px]">
          <div className="font-medium text-gk-text">{preview.error.message}</div>
          {preview.error.hint && <div className="mt-1 text-gk-muted">{preview.error.hint}</div>}
        </div>
      ) : !plan ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">
          <Loader2 size={15} className="animate-spin" /> Собираем коммиты…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* План */}
          <div className="flex min-w-0 flex-1 flex-col border-r border-gk-border">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-[12px] text-gk-muted">
              <span>
                {n} {plural(n, 'коммит', 'коммита', 'коммитов')} · новые сверху
              </span>
              <div className="flex-1" />
              {changedCount > 0 && (
                <button onClick={reset} className="rounded px-2 py-0.5 text-[11.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
                  Сбросить план
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
              {rows.map((item, ri) => (
                <PlanRow
                  key={item.hash}
                  item={item}
                  index={ri}
                  meta={meta.current.get(item.hash)}
                  selected={selected === ri}
                  editing={editing === item.hash}
                  joinedInto={groupInfo.info.get(item.hash)?.target}
                  groupMembers={groupInfo.heads.get(item.hash) ?? []}
                  isLast={ri === n - 1}
                  conflict={d?.conflict?.hash === item.hash}
                  highlighted={hoverAfter?.includes(item.hash)}
                  groupMessage={item.message ?? (groupInfo.heads.get(item.hash)?.length ? defaultGroupMessage(item.hash) : null)}
                  onSelect={() => setSelected(ri)}
                  onAction={(a) => {
                    setSelected(ri);
                    setAction(ri, a);
                  }}
                  onMove={(dir) => move(ri, dir)}
                  onDrop={(from) => moveTo(from, ri)}
                  onEdit={() => {
                    setSelected(ri);
                    if (item.action === 'pick' && !groupInfo.heads.get(item.hash)?.length) setAction(ri, 'reword');
                    else setEditing(item.hash);
                  }}
                  onMessage={(message) => update(ri, { message })}
                  onDoneEditing={() => setEditing(null)}
                />
              ))}
              <div className="mx-3 mt-1 flex items-center gap-2 rounded-md border border-dashed border-gk-border px-3 py-2 text-[12px] text-gk-dim">
                <GitBranch size={13} />
                {ontoMode ? 'новая основа:' : 'основа (не меняется):'}
                <span className="font-mono text-gk-muted">{d?.onto.hash.slice(0, 7)}</span>
                <span className="truncate">{d?.onto.subject}</span>
              </div>
            </div>
          </div>

          {/* Предпросмотр */}
          <PreviewPanel
            data={d}
            error={preview.error}
            loading={preview.loading}
            invalid={firstKeptIsSquash}
            hoverAfter={hoverAfter}
            onHoverAfter={setHoverAfter}
            onOpenDiff={onOpenDiff}
            onLocate={onLocate}
          />
        </div>
      )}

      {/* Низ */}
      {plan && (
        <div className="flex shrink-0 items-center gap-2 border-t border-gk-border bg-gk-panel/60 px-4 py-2.5">
          <div className="min-w-0 flex-1 text-[12px] text-gk-muted">
            {firstKeptIsSquash ? (
              <span className="text-gk-yellow">Самый нижний коммит не с чем объединить — выберите для него другое действие</span>
            ) : d?.unchanged ? (
              'План ничего не меняет'
            ) : d?.ok ? (
              <>
                Ветка <b className="font-medium text-gk-text">{d.branch}</b> перейдёт на новую историю. Undo ({kb('Ctrl+Z')}) вернёт как было.
              </>
            ) : d?.conflict ? (
              'Применить автоматически нельзя — будет конфликт'
            ) : null}
          </div>
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Отмена
          </button>
          {d?.conflict && !preview.loading && !preview.error ? (
            confirmStart ? (
              <button
                disabled={busy}
                onClick={() => onStart(plan)}
                className="flex items-center gap-1.5 rounded-md bg-gk-yellow px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-50"
              >
                Точно начать — я решу конфликты
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => setConfirmStart(true)}
                title="Запустить настоящий git rebase: он остановится на конфликте, вы решите его и нажмёте «Продолжить». «Прервать» вернёт всё как было."
                className="flex items-center gap-1.5 rounded-md bg-gk-yellow/15 px-3 py-1.5 text-[12.5px] font-medium text-gk-yellow ring-1 ring-gk-yellow/40 hover:bg-gk-yellow/25 disabled:opacity-50"
              >
                <AlertTriangle size={13} /> Начать и решить конфликты вручную
              </button>
            )
          ) : (
            <button
              disabled={!canApply}
              onClick={() => onApply(d)}
              className="flex items-center gap-1.5 rounded-md bg-gk-green px-3.5 py-1.5 text-[12.5px] font-semibold text-gk-ink shadow-lg shadow-gk-green/20 transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              {busy || (preview.loading && d) ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Применить rebase
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Строка плана ---------------- */

function PlanRow({
  item,
  index,
  meta,
  selected,
  editing,
  joinedInto,
  groupMembers,
  isLast,
  conflict,
  highlighted,
  groupMessage,
  onSelect,
  onAction,
  onMove,
  onDrop,
  onEdit,
  onMessage,
  onDoneEditing,
}) {
  const [dragOver, setDragOver] = useState(false);
  const a = ACTION[item.action];
  const dropped = item.action === 'drop';
  const joined = item.action === 'squash' || item.action === 'fixup';
  const subject = (item.message ?? meta?.message ?? '').split('\n')[0];
  const showMessageEditor = editing && (item.action === 'reword' || groupMembers.length > 0);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/rebase-row', String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('text/rebase-row')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const from = Number(e.dataTransfer.getData('text/rebase-row'));
        if (!Number.isNaN(from)) onDrop(from);
      }}
      onMouseDown={onSelect}
      className={`group relative mx-2 my-0.5 rounded-md border transition-colors ${
        selected ? 'border-gk-blue/50 bg-gk-blue/[0.08]' : 'border-transparent hover:bg-gk-fg/[0.03]'
      } ${dragOver ? 'border-t-2 border-t-gk-blue' : ''} ${highlighted ? 'ring-1 ring-gk-blue/60' : ''} ${conflict ? 'bg-gk-red/[0.08]' : ''}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <GripVertical size={14} className="shrink-0 cursor-grab text-gk-dim opacity-50 group-hover:opacity-100" />
        {/* Действие */}
        <div className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-gk-border">
          {REBASE_ACTIONS.map((x) => (
            <button
              key={x.id}
              title={`${x.label} (${x.key}) — ${x.hint}`}
              disabled={isLast && (x.id === 'squash' || x.id === 'fixup')}
              onClick={() => onAction(x.id)}
              className={`flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-25 ${
                item.action === x.id ? x.active : 'text-gk-dim enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
              }`}
            >
              <x.icon size={12} />
            </button>
          ))}
        </div>
        <span className={`w-14 shrink-0 font-mono text-[11.5px] ${dropped ? 'text-gk-dim line-through' : 'text-gk-muted'}`}>{item.hash.slice(0, 7)}</span>
        <div className={`min-w-0 flex-1 ${joined ? 'pl-4' : ''}`}>
          <div className="flex min-w-0 items-center gap-1.5">
            {joined && <ArrowDown size={12} className="shrink-0 text-gk-purple" />}
            <button
              onDoubleClick={onEdit}
              title="Двойной клик — изменить сообщение"
              className={`min-w-0 truncate text-left text-[13px] ${dropped ? 'text-gk-dim line-through' : item.action === 'reword' && item.message !== meta?.message ? 'text-gk-yellow' : 'text-gk-text'}`}
            >
              {subject || <i className="text-gk-dim">пустое сообщение</i>}
            </button>
            {groupMembers.length > 0 && (
              <span className="shrink-0 rounded bg-gk-purple/15 px-1.5 text-[10.5px] text-gk-purple" title="Сколько коммитов будет объединено с этим">
                +{groupMembers.length}
              </span>
            )}
            {conflict && (
              <span className="shrink-0 rounded bg-gk-red/20 px-1.5 text-[10.5px] text-gk-red">конфликт</span>
            )}
          </div>
          <div className="truncate text-[11px] text-gk-dim">
            {meta?.author?.name} · {meta?.author?.date ? relativeTime(meta.author.date) : ''}
            {joined && joinedInto && <span className="ml-1.5 text-gk-purple/80">→ в {joinedInto.slice(0, 7)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100">
          <button title={kb('Выше (Alt+↑)')} onClick={() => onMove(-1)} className="rounded text-gk-dim hover:text-gk-text">
            <ArrowUp size={12} />
          </button>
          <button title={kb('Ниже (Alt+↓)')} onClick={() => onMove(1)} className="rounded text-gk-dim hover:text-gk-text">
            <ArrowDown size={12} />
          </button>
        </div>
        {(item.action === 'reword' || groupMembers.length > 0) && !editing && (
          <button title="Изменить сообщение" onClick={onEdit} className="shrink-0 rounded p-1 text-gk-dim hover:bg-gk-fg/10 hover:text-gk-text">
            <Pencil size={12} />
          </button>
        )}
      </div>
      {showMessageEditor && (
        <div className="px-3 pb-2.5 pl-[5.25rem]">
          <div className="mb-1 text-[11px] text-gk-muted">
            {groupMembers.length > 0 ? `Сообщение объединённого коммита (${groupMembers.length + 1} шт.)` : 'Новое сообщение коммита'}
          </div>
          <textarea
            autoFocus
            value={groupMessage ?? item.message ?? ''}
            onChange={(e) => onMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isMod(e)) onDoneEditing();
              e.stopPropagation();
            }}
            rows={Math.min(8, Math.max(2, (groupMessage ?? item.message ?? '').split('\n').length + 1))}
            spellCheck={false}
            className="w-full resize-y rounded-md bg-gk-bg px-2.5 py-1.5 font-mono text-[12px] leading-5 text-gk-text outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gk-dim">
            {!(groupMessage ?? item.message ?? '').trim() && <span className="text-gk-red">Сообщение не может быть пустым</span>}
            <div className="flex-1" />
            <button onClick={onDoneEditing} className="rounded px-2 py-0.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
              Готово ({kb('Ctrl+Enter')})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Предпросмотр ---------------- */

function PreviewPanel({ data: d, error, loading, invalid, hoverAfter, onHoverAfter, onOpenDiff, onLocate }) {
  return (
    <div className="relative flex w-[46%] min-w-[380px] max-w-[640px] shrink-0 flex-col bg-gk-panel/30">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-gk-border px-3 text-[12px] font-medium text-gk-text">
        Предпросмотр
        {loading && <Loader2 size={12} className="animate-spin text-gk-muted" />}
        <span className="font-normal text-gk-dim">— посчитан заранее, рабочая папка не тронута</span>
      </div>
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {error && d && (
          <Banner tone="red" icon={CircleX} title={error.message}>
            {error.hint}
          </Banner>
        )}
        {invalid ? (
          <Banner tone="yellow" icon={AlertTriangle} title="Нижний коммит нельзя объединить">
            Squash и fixup присоединяют коммит к тому, что ниже. Для самого нижнего выберите «Оставить» или «Удалить».
          </Banner>
        ) : d && !error ? (
          <>
            {d.conflict ? (
              <Banner tone="red" icon={CircleX} title={`Конфликт на коммите ${d.conflict.hash.slice(0, 7)} «${d.conflict.subject}»`}>
                <div>
                  {d.conflict.files.length === 1 ? 'Файл' : 'Файлы'}:{' '}
                  <span className="font-mono text-gk-text">{d.conflict.files.join(', ')}</span>
                </div>
                <div className="mt-1">
                  Его изменения не ложатся на коммиты ниже в новом порядке. Поменяйте план (например, верните порядок) или начните rebase и решите конфликт вручную.
                </div>
              </Banner>
            ) : d.unchanged ? (
              <Banner tone="blue" icon={Info} title="План ничего не меняет">
                Выберите действия для коммитов слева: изменить порядок, сообщение, объединить или удалить.
              </Banner>
            ) : (
              <Banner tone="green" icon={ShieldCheck} title="Пройдёт без конфликтов">
                {d.identicalFiles ? 'Итоговые файлы не изменятся — меняется только история.' : `Итоговые файлы изменятся: ${d.diff.length} ${plural(d.diff.length, 'файл', 'файла', 'файлов')} (список ниже).`}
              </Banner>
            )}

            {d.pushed > 0 && !d.unchanged && (
              <Banner tone="yellow" icon={AlertTriangle} title={`${d.pushed} ${plural(d.pushed, 'коммит', 'коммита', 'коммитов')} уже на сервере`}>
                После rebase ветку придётся отправить через Force Push — это перепишет её и у коллег.
              </Banner>
            )}
            {d.merges > 0 && (
              <Banner tone="blue" icon={Info} title={`Merge-коммиты (${d.merges}) будут выпрямлены`}>
                Как и обычный git rebase, он переносит только обычные коммиты — история станет линейной.
              </Banner>
            )}
            {d.dirty > 0 && !d.unchanged && (
              <Banner tone="blue" icon={Info} title={`Незакоммиченные изменения: ${d.dirty}`}>
                Они сохранятся. Если rebase меняет те же файлы, приложение попросит сначала сделать Commit или Stash.
              </Banner>
            )}

            <MiniGraph data={d} hoverAfter={hoverAfter} onHoverAfter={onHoverAfter} onLocate={onLocate} />

            {d.ok && !d.unchanged && !d.identicalFiles && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-muted">Как изменятся файлы ветки</div>
                <div className="overflow-hidden rounded-lg border border-gk-border">
                  {d.diff.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => onOpenDiff(f, d.diff, d.oldHead, d.newHead)}
                      className="flex w-full items-center gap-2 border-b border-gk-border/60 px-2.5 py-1.5 text-left text-[12.5px] last:border-0 hover:bg-gk-hover"
                    >
                      <StatusBadge status={f.status} />
                      <span className="min-w-0 flex-1 truncate text-gk-text">{f.path}</span>
                      {f.additions !== null ? (
                        <span className="shrink-0 font-mono text-[11px]">
                          <span className="text-gk-green">+{f.additions}</span> <span className="text-gk-red">−{f.deletions}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-gk-dim">bin</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

const NODE = {
  reused: { dot: 'bg-gk-dim', ring: 'ring-gk-dim/40', label: 'без изменений' },
  pick: { dot: 'bg-gk-blue', ring: 'ring-gk-blue/40', label: 'перенесён' },
  reword: { dot: 'bg-gk-yellow', ring: 'ring-gk-yellow/40', label: 'новое сообщение' },
  squash: { dot: 'bg-gk-purple', ring: 'ring-gk-purple/40', label: 'объединён' },
  fixup: { dot: 'bg-gk-purple', ring: 'ring-gk-purple/40', label: 'объединён' },
};

// Граф «сейчас → после»: два столбика коммитов над общей основой
function MiniGraph({ data: d, hoverAfter, onHoverAfter, onLocate }) {
  const before = [...d.before].reverse();
  const after = d.ok ? [...d.after].reverse() : null;
  const dropped = new Set(d.skipped.filter((s) => s.reason === 'drop').map((s) => s.hash));
  const empty = new Set(d.skipped.filter((s) => s.reason === 'empty').map((s) => s.hash));
  // Что станет с каждым исходным коммитом
  const fate = new Map();
  for (const c of d.after) {
    c.origs.forEach((h, i) => {
      if (i > 0) fate.set(h, `вливается в ${c.origs[0].slice(0, 7)}`);
      else if (c.action === 'reword' || (c.origs.length > 1 && c.message !== d.before.find((b) => b.hash === h)?.message)) fate.set(h, 'новое сообщение');
    });
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Column title="Сейчас" branch={d.branch}>
        {before.map((c) => (
          <Node
            key={c.hash}
            hash={c.hash}
            subject={c.subject}
            dot={dropped.has(c.hash) || empty.has(c.hash) ? 'bg-gk-red/70' : 'bg-gk-muted'}
            strike={dropped.has(c.hash) || empty.has(c.hash)}
            note={dropped.has(c.hash) ? 'удаляется' : empty.has(c.hash) ? 'станет пустым — пропустится' : fate.get(c.hash) ?? null}
            highlighted={hoverAfter?.includes(c.hash)}
            conflict={d.conflict?.hash === c.hash}
            onClick={() => onLocate(c.hash)}
          />
        ))}
        {d.interactiveFromAncestor ? <Base hash={d.upstream.hash} subject={d.upstream.subject} /> : <Base subject="прежняя основа ветки" />}
      </Column>
      <Column title="После" branch={d.branch} accent>
        {after ? (
          after.length ? (
            after.map((c) => {
              const kind = c.reused ? NODE.reused : NODE[c.action] ?? NODE.pick;
              return (
                <Node
                  key={c.hash}
                  hash={c.hash}
                  subject={c.subject}
                  dot={kind.dot}
                  note={c.origs.length > 1 ? `${kind.label}: ${c.origs.length} ${plural(c.origs.length, 'коммит', 'коммита', 'коммитов')}` : kind.label}
                  badge={!c.reused ? 'новый' : null}
                  onEnter={() => onHoverAfter(c.origs)}
                  onLeave={() => onHoverAfter(null)}
                />
              );
            })
          ) : (
            <div className="py-3 text-center text-[11.5px] italic text-gk-dim">коммитов не останется</div>
          )
        ) : (
          <div className="flex items-center gap-1.5 py-3 text-[11.5px] text-gk-red">
            <CircleX size={12} /> остановится на конфликте
          </div>
        )}
        <Base hash={d.onto.hash} subject={d.onto.subject} />
      </Column>
    </div>
  );
}

function Column({ title, branch, accent, children }) {
  return (
    <div className={`rounded-lg border p-2 ${accent ? 'border-gk-blue/30 bg-gk-blue/[0.03]' : 'border-gk-border bg-gk-fg/[0.015]'}`}>
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-gk-muted">
        {title}
        <span className="ml-auto truncate rounded bg-gk-green/15 px-1.5 font-mono text-[10px] normal-case tracking-normal text-gk-green">{branch}</span>
      </div>
      <div className="relative">
        <span className="absolute bottom-3 left-[11px] top-3 w-px bg-gk-border" />
        {children}
      </div>
    </div>
  );
}

function Node({ hash, subject, dot, note, badge, strike, highlighted, conflict, onClick, onEnter, onLeave }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`relative flex items-start gap-2 rounded px-1 py-1 ${onClick ? 'cursor-pointer' : ''} ${
        highlighted ? 'bg-gk-blue/15' : conflict ? 'bg-gk-red/10' : 'hover:bg-gk-fg/[0.04]'
      }`}
    >
      <span className={`relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-gk-bg ${dot}`} style={{ marginLeft: 4 }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12px] ${strike ? 'text-gk-dim line-through' : 'text-gk-text'}`}>{subject}</div>
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[10.5px] text-gk-dim">
          <span className="shrink-0 font-mono">{hash.slice(0, 7)}</span>
          {note && <span className={`min-w-0 truncate ${strike ? 'text-gk-red/80' : ''}`} title={note}>{note}</span>}
          {badge && <span className="shrink-0 rounded bg-gk-blue/15 px-1 text-gk-blue">{badge}</span>}
        </div>
      </div>
    </div>
  );
}

function Base({ hash, subject }) {
  return (
    <div className="relative flex items-center gap-2 px-1 py-1 text-[11px] text-gk-dim">
      <span className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-gk-dim bg-gk-bg" style={{ marginLeft: 4 }} />
      {hash && <span className="font-mono">{hash.slice(0, 7)}</span>}
      <span className="truncate">{subject}</span>
    </div>
  );
}

function Banner({ tone, icon: Icon, title, children }) {
  const tones = {
    green: 'border-gk-green/30 bg-gk-green/[0.07] text-gk-green',
    red: 'border-gk-red/30 bg-gk-red/[0.07] text-gk-red',
    yellow: 'border-gk-yellow/30 bg-gk-yellow/[0.07] text-gk-yellow',
    blue: 'border-gk-blue/30 bg-gk-blue/[0.06] text-gk-blue',
  };
  return (
    <div className={`animate-fade-in rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Icon size={14} className="shrink-0" /> {title}
      </div>
      {children && <div className="mt-1 pl-5 text-[12px] leading-relaxed text-gk-muted">{children}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const { color: raw, label } = FILE_STATUS[status] ?? FILE_STATUS.M;
  const color = readable(raw);
  return (
    <span
      title={label}
      style={{ color, backgroundColor: `${color}22` }}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
    >
      {status}
    </span>
  );
}
