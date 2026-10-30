import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, Loader2 } from 'lucide-react';
import { relativeTime } from '../lib/format.js';
import { useHoverPopover } from './RefBadge.jsx';

/**
 * Бейджи синхронизации ветки в списке Local:
 *   ↓Y (синий) — придёт при Pull, ↑X (зелёный) — уйдёт при Push, gone — ветку на сервере удалили.
 * Наведение на ↓/↑ — список этих коммитов; при наведении на строку — кнопка Update (Pull).
 * actions: { update(name), push(), log(name, direction), select(hash) }
 */
export function SyncBadges({ branch, current, busy, actions }) {
  const canUpdate = branch.behind > 0 && !branch.gone && (current || branch.ahead === 0);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {branch.behind > 0 && !branch.gone && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (canUpdate && !busy) actions?.update?.(branch.name);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={canUpdate ? `Обновить ${branch.name} (Pull)${current ? '' : ' без переключения'}` : `${branch.name} разошлась с сервером — переключитесь и сделайте Pull`}
          aria-label={`Обновить ${branch.name}`}
          className={`hidden rounded p-0.5 text-gk-blue hover:bg-gk-blue/15 ${canUpdate && !busy ? 'group-hover:inline-flex' : ''}`}
        >
          <ArrowDownToLine size={12} />
        </span>
      )}
      {branch.gone && (
        <span title={`${branch.upstream} удалена на сервере`} className="rounded bg-gk-red/10 px-1 text-[10px] leading-4 text-gk-red/80">
          gone
        </span>
      )}
      {branch.behind > 0 && !branch.gone && <CountBadge branch={branch} direction="in" current={current} busy={busy} actions={actions} />}
      {branch.ahead > 0 && !branch.gone && <CountBadge branch={branch} direction="out" current={current} busy={busy} actions={actions} />}
    </span>
  );
}

function CountBadge({ branch, direction, current, busy, actions }) {
  const pop = useHoverPopover();
  const ref = useRef(null);
  const incoming = direction === 'in';
  const n = incoming ? branch.behind : branch.ahead;
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={() => pop.show(180)}
        onMouseLeave={() => pop.hide()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={incoming ? `Входящие коммиты: ${n}` : `Исходящие коммиты: ${n}`}
        className={`flex h-4 cursor-default items-center rounded px-1 font-mono text-[10.5px] font-semibold tabular-nums ${
          incoming ? 'bg-gk-blue/15 text-gk-blue' : 'bg-gk-green/15 text-gk-green'
        }`}
      >
        {incoming ? <ArrowDown size={10} strokeWidth={2.6} /> : <ArrowUp size={10} strokeWidth={2.6} />}
        {n}
      </span>
      {pop.open && (
        <CommitsPopover
          anchor={ref.current}
          branch={branch}
          direction={direction}
          current={current}
          busy={busy}
          actions={actions}
          onEnter={pop.keep}
          onLeave={() => pop.hide()}
          onDone={pop.close}
        />
      )}
    </>
  );
}

// Кэш списков: ветка|направление|хэш ветки|хэш upstream не изменились — тот же ответ
const logCache = new Map();

function CommitsPopover({ anchor, branch, direction, current, busy, actions, onEnter, onLeave, onDone }) {
  const incoming = direction === 'in';
  const key = `${branch.name}|${direction}|${branch.hash}|${branch.behind}|${branch.ahead}`;
  const [data, setData] = useState(() => logCache.get(key) ?? null);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    if (logCache.has(key) || !actions?.log) return undefined;
    let alive = true;
    actions.log(branch.name, direction).then((res) => {
      if (!alive) return;
      if (res?.ok) {
        logCache.set(key, res.data);
        if (logCache.size > 100) logCache.delete(logCache.keys().next().value);
        setData(res.data);
      } else setError(res?.error?.message ?? 'Не удалось получить список коммитов');
    });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    const a = anchor.getBoundingClientRect();
    const r = box.current.getBoundingClientRect();
    let left = a.right + 8; // справа от боковой панели
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, a.left - r.width - 8);
    let top = a.top - 10;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    if (Math.abs(left - pos.left) > 0.5 || Math.abs(top - pos.top) > 0.5) setPos({ left, top });
  });

  const canUpdate = incoming && (current || branch.ahead === 0);
  const n = incoming ? branch.behind : branch.ahead;

  return createPortal(
    <div
      ref={box}
      role="dialog"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ left: pos.left, top: pos.top }}
      className="glass-strong fixed z-50 w-[360px] animate-pop-in overflow-hidden rounded-lg border border-gk-border bg-gk-panel-2 text-[12.5px] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-gk-border px-3 py-2">
        <span className={`flex h-5 items-center rounded px-1.5 font-mono text-[11px] font-semibold ${incoming ? 'bg-gk-blue/15 text-gk-blue' : 'bg-gk-green/15 text-gk-green'}`}>
          {incoming ? <ArrowDown size={11} strokeWidth={2.6} /> : <ArrowUp size={11} strokeWidth={2.6} />}
          {n}
        </span>
        <span className="min-w-0 flex-1 truncate text-gk-text">
          {incoming ? 'Придут при Pull' : 'Уйдут при Push'}
          <span className="text-gk-dim"> · {incoming ? `${branch.upstream} → ${branch.name}` : `${branch.name} → ${branch.upstream}`}</span>
        </span>
      </div>
      <div className="max-h-[300px] overflow-y-auto py-1">
        {error ? (
          <div className="px-3 py-2 text-gk-red">{error}</div>
        ) : !data ? (
          <div className="flex items-center gap-2 px-3 py-2 text-gk-dim">
            <Loader2 size={13} className="animate-spin" /> Загружаем…
          </div>
        ) : (
          data.commits.map((c) => (
            <button
              key={c.hash}
              onClick={() => {
                actions?.select?.(c.hash);
                onDone();
              }}
              title={`${c.hash}\n${c.subject}\nКлик — показать в графе`}
              className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-gk-hover"
            >
              <span className={`mt-px shrink-0 font-mono text-[11px] ${incoming ? 'text-gk-blue' : 'text-gk-green'}`}>{c.short}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gk-text">{c.subject}</span>
                <span className="block truncate text-[10.5px] text-gk-dim">
                  {c.author} · {relativeTime(c.date)}
                </span>
              </span>
            </button>
          ))
        )}
        {data && data.total > data.commits.length && <div className="px-3 py-1 text-[11px] text-gk-dim">…и ещё {data.total - data.commits.length}</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-gk-border px-3 py-2">
        {incoming ? (
          canUpdate ? (
            <button
              disabled={busy}
              onClick={() => {
                onDone();
                actions?.update?.(branch.name);
              }}
              className="flex items-center gap-1.5 rounded-md bg-gk-blue/15 px-2 py-1 text-[12px] font-medium text-gk-blue hover:bg-gk-blue/25 disabled:opacity-40"
            >
              <ArrowDownToLine size={13} /> Обновить (Pull)
            </button>
          ) : (
            <span className="text-[11.5px] leading-snug text-gk-yellow">
              В ветке есть свои коммиты (↑{branch.ahead}) — переключитесь на неё и сделайте Pull.
            </span>
          )
        ) : current ? (
          <button
            disabled={busy}
            onClick={() => {
              onDone();
              actions?.push?.();
            }}
            className="flex items-center gap-1.5 rounded-md bg-gk-green/15 px-2 py-1 text-[12px] font-medium text-gk-green hover:bg-gk-green/25 disabled:opacity-40"
          >
            <ArrowUpFromLine size={13} /> Push
          </button>
        ) : (
          <span className="text-[11.5px] text-gk-dim">Чтобы отправить — переключитесь на ветку и сделайте Push.</span>
        )}
        {incoming && canUpdate && <span className="ml-auto text-[10.5px] text-gk-dim">{current ? 'fast-forward' : 'без переключения ветки'}</span>}
      </div>
    </div>,
    document.body,
  );
}
