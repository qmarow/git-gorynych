import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { RefKindIcon, RefsPopover, refKindLabel, useHoverPopover } from './RefBadge.jsx';
import {
  NODE_RADIUS,
  ROW_HEIGHT,
  edgePath,
  graphWidth,
  laneColor,
  laneX,
  layoutGraph,
  rowY,
} from '../lib/graphLayout.js';
import { StatusIcon, statusInfo } from './PipelineStatus.jsx';
import { fullDate, initials, relativeTime, shortDate } from '../lib/format.js';
import { ResizeHandle, useStoredWidth } from './Resizer.jsx';
import { avatarUrl, isFailed, markFailed } from '../lib/avatars.js';
import { hasRefDrag, readRefDrag, startRefDrag } from '../lib/dnd.js';
import { isMod, kb } from '../lib/platform.js';

const HEADER_HEIGHT = 30;
const OVERSCAN = 15; // запас строк выше и ниже видимой области
const MAX_AUTO_GRAPH_WIDTH = 400; // авто-ширина графа; вручную можно растянуть шире
const MESSAGE_MIN_WIDTH = 140;
const DATE_MIN_WIDTH = 118;
const INTRO_MS = 1300; // длительность анимации появления графа

export default function CommitGraph({
  commits,
  introKey,
  selectedHash,
  onSelect,
  onActivate,
  onContextMenu,
  wipCount,
  truncated,
  matchSet = null, // Set хэшей, подходящих под поиск; остальные приглушаются
  pipelines = null, // { [sha]: { id, status } } — статусы пайплайнов GitLab
  onPipelineClick,
  onCompare, // Ctrl+клик: сравнить выбранный коммит с этим
  compareMark = null, // коммит, отмеченный для сравнения
  dragSource = null, // что сейчас перетаскивают (коммит или ветку)
  onDragSource, // начало/конец перетаскивания
  onDropOnBranch, // (ветки строки, x, y, что перетащили) — бросили на строку с веткой
  currentBranch = null,
  refActions = null, // { checkout(ref), deleteRemote(fullName), menu(ref, x, y) } — для поповера «+N»
}) {
  const [dropHash, setDropHash] = useState(null);
  useEffect(() => {
    if (!dragSource) setDropHash(null);
  }, [dragSource]);
  const { nodes, edges, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const [view, setView] = useState({ top: 0, height: 800, width: 1000 });

  // Ширины колонок: тянутся мышью за разделители в заголовке и запоминаются
  const [refsW, setRefsW, saveRefsW] = useStoredWidth('graph.refs', 150, 60, 480);
  const [graphW, setGraphW, saveGraphW] = useStoredWidth('graph.graph', null, 40, 1400); // null = авто
  const [authorW, setAuthorW, saveAuthorW] = useStoredWidth('graph.author', 140, 60, 420);
  // Дата не уже DATE_MIN_WIDTH: «26.10.26 22:58» должна помещаться целиком
  const [dateW, setDateW, saveDateW] = useStoredWidth('graph.date.v2', 142, DATE_MIN_WIDTH, 260);
  // Авто-ширина графа: по числу дорожек, но не больше, чем позволяет место,
  // чтобы колонки Author и Date оставались видны без горизонтальной прокрутки
  const roomForGraph = view.width - refsW - authorW - dateW - MESSAGE_MIN_WIDTH;
  const autoGraphWidth = Math.max(
    90,
    Math.min(graphWidth(laneCount), MAX_AUTO_GRAPH_WIDTH, Math.max(120, roomForGraph)),
  );
  // Ширина графа, заданная вручную, не должна выталкивать колонки Author и Date за правый край
  // (под панель деталей): если места не хватает, граф ужимается, а сообщение — до минимума
  const width = Math.max(40, Math.min(graphW ?? autoGraphWidth, view.width - refsW - authorW - dateW - MESSAGE_MIN_WIDTH));
  const cols = { refs: refsW, graph: width, author: authorW, date: dateW };
  const height = nodes.length * ROW_HEIGHT;

  const scrollRef = useRef(null);
  const [hoverHash, setHoverHash] = useState(null);
  const [intro, setIntro] = useState(true);

  // Анимация появления — при открытии репозитория
  useEffect(() => {
    setIntro(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [introKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes.length === 0]);

  // Прокручиваем к выбранному коммиту, если он вне экрана
  useEffect(() => {
    const el = scrollRef.current;
    const node = nodes.find((n) => n.hash === selectedHash);
    if (!el || !node) return;
    const top = node.row * ROW_HEIGHT;
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight - HEADER_HEIGHT) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash]);

  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(nodes.length - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);
  const visibleNodes = nodes.slice(first, last + 1);
  const visibleEdges = edges.filter((e) => e.minRow <= last && e.maxRow >= first);

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const index = nodes.findIndex((n) => n.hash === selectedHash);
    const next = nodes[Math.min(nodes.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) onSelect(next.hash);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 animate-fade-in items-center justify-center text-gk-muted">
        В репозитории ещё нет коммитов
      </div>
    );
  }

  const introDelay = (row) => `${Math.min(Math.max(row - first, 0), 30) * 20}ms`;

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        const el = e.currentTarget;
        setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
      }}
      onMouseLeave={() => setHoverHash(null)}
      className="relative min-h-0 flex-1 overflow-auto bg-gk-bg outline-none"
    >
      {/* Заголовки колонок */}
      <div
        style={{ height: HEADER_HEIGHT }}
        className="glass sticky top-0 z-10 flex min-w-max items-center border-b border-gk-border bg-gk-panel text-[10px] font-semibold uppercase tracking-wider text-gk-dim"
      >
        <HeaderCell width={refsW}>
          <span className="truncate">Ветка / тег</span>
          <ResizeHandle
            width={refsW}
            onResize={setRefsW}
            onCommit={saveRefsW}
            onReset={() => {
              setRefsW(null);
              saveRefsW(null);
            }}
            className="-right-1"
          />
        </HeaderCell>
        <HeaderCell width={width}>
          <span className="truncate">Граф</span>
          <ResizeHandle
            width={width}
            onResize={setGraphW}
            onCommit={saveGraphW}
            onReset={() => {
              setGraphW(null);
              saveGraphW(null);
            }}
            title="Потяните, чтобы изменить ширину графа. Двойной клик — авто"
            className="-right-1"
          />
        </HeaderCell>
        <div style={{ minWidth: MESSAGE_MIN_WIDTH }} className="flex-1 truncate px-4">Сообщение коммита</div>
        <HeaderCell width={authorW}>
          <ResizeHandle
            width={authorW}
            direction={-1}
            onResize={setAuthorW}
            onCommit={saveAuthorW}
            onReset={() => {
              setAuthorW(null);
              saveAuthorW(null);
            }}
            className="-left-1"
          />
          <span className="truncate">Автор</span>
        </HeaderCell>
        <HeaderCell width={dateW}>
          <ResizeHandle
            width={dateW}
            direction={-1}
            onResize={setDateW}
            onCommit={saveDateW}
            onReset={() => {
              setDateW(null);
              saveDateW(null);
            }}
            className="-left-1"
          />
          <span className="truncate">Дата / время</span>
        </HeaderCell>
      </div>

      <div className="relative" style={{ height }}>
        {visibleNodes.map((node) => (
          <Row
            key={node.hash}
            node={node}
            pipeline={pipelines?.[node.hash] ?? null}
            onPipelineClick={onPipelineClick}
            selected={node.hash === selectedHash}
            hovered={node.hash === hoverHash}
            dim={Boolean(matchSet) && !matchSet.has(node.hash)}
            intro={intro}
            delay={introDelay(node.row)}
            cols={cols}
            wipCount={wipCount}
            onHover={() => setHoverHash(node.hash)}
            marked={node.hash === compareMark}
            dropTarget={dropHash === node.hash}
            onDragStartRef={(e, payload) => {
              startRefDrag(e, payload);
              onDragSource?.(payload);
            }}
            onDragEndRef={() => onDragSource?.(null)}
            onDragOverRow={(e) => {
              if (!hasRefDrag(e) || !dragSource) return;
              const locals = node.refs.filter((r) => r.type === 'local').map((r) => r.name);
              if (!locals.length || dragSource.hash === node.hash) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dropHash !== node.hash) setDropHash(node.hash);
            }}
            onDragLeaveRow={() => setDropHash((h) => (h === node.hash ? null : h))}
            currentBranch={currentBranch}
            refActions={refActions}
            onDropRow={(e) => {
              e.preventDefault();
              setDropHash(null);
              const payload = readRefDrag(e);
              onDragSource?.(null);
              if (!payload) return;
              const locals = node.refs.filter((r) => r.type === 'local').map((r) => r.name);
              onDropOnBranch?.(locals.map((name) => ({ name, hash: node.hash })), e.clientX, e.clientY, payload);
            }}
            onSelect={(e) => {
              if (isMod(e) && onCompare && !node.wip) onCompare(node.hash);
              else onSelect(node.hash);
            }}
            onDoubleClick={() => onActivate?.(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(node.hash);
              onContextMenu?.(node, e.clientX, e.clientY);
            }}
          />
        ))}

        <svg
          className="pointer-events-none absolute top-0 overflow-visible"
          style={{ left: refsW }}
          width={width}
          height={height}
        >
          <defs>
            <clipPath id="avatar-clip" clipPathUnits="objectBoundingBox">
              <circle cx="0.5" cy="0.5" r="0.5" />
            </clipPath>
          </defs>

          {/* Линии от меток веток к узлам */}
          {visibleNodes
            .filter((n) => n.refs.length > 0)
            .map((n) => (
              <line
                key={`ref-${n.hash}`}
                x1={0}
                x2={laneX(n.lane) - NODE_RADIUS}
                y1={rowY(n.row)}
                y2={rowY(n.row)}
                stroke={laneColor(n.lane)}
                strokeWidth={2}
                strokeOpacity={0.85}
              />
            ))}

          {visibleEdges.map((edge) => (
            <path
              key={edge.id}
              d={edgePath(edge)}
              pathLength={edge.dashed ? undefined : 1}
              className={`graph-edge ${intro && !edge.dashed ? 'is-intro' : ''}`}
              style={intro ? { animationDelay: introDelay(edge.from.row) } : undefined}
              fill="none"
              stroke={edge.color}
              strokeOpacity={matchSet ? 0.3 : 1}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={edge.dashed ? '4 4' : undefined}
            />
          ))}

          {visibleNodes.map((node) => (
            <Node
              key={node.hash}
              node={node}
              dim={Boolean(matchSet) && !matchSet.has(node.hash)}
              selected={node.hash === selectedHash}
              hovered={node.hash === hoverHash}
              intro={intro}
              delay={introDelay(node.row)}
            />
          ))}
        </svg>
      </div>

      {truncated && (
        <div className="py-3 text-center text-xs text-gk-dim">
          Показаны последние {commits.length.toLocaleString('ru-RU')} коммитов
        </div>
      )}
    </div>
  );
}

/* ---------------- Строка ---------------- */

function HeaderCell({ width, children }) {
  return (
    <div style={{ width }} className="relative flex h-full shrink-0 items-center border-r border-gk-border/60 px-3 last:border-r-0">
      {children}
    </div>
  );
}

function Row({
  node,
  selected,
  hovered,
  dim,
  intro,
  delay,
  cols,
  wipCount,
  pipeline,
  onPipelineClick,
  onHover,
  onSelect,
  onDoubleClick,
  onContextMenu,
  marked,
  dropTarget,
  onDragStartRef,
  onDragEndRef,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  currentBranch,
  refActions,
}) {
  const color = laneColor(node.lane);
  const bandAlpha = selected ? '42' : hovered ? '2a' : '14';

  return (
    <div
      onMouseDown={(e) => e.button === 0 && onSelect(e)}
      onMouseEnter={onHover}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      draggable={!node.wip}
      onDragStart={(e) =>
        onDragStartRef(e, { kind: 'commit', hash: node.hash, label: `${node.hash.slice(0, 7)} ${node.message}`, message: node.message })
      }
      onDragEnd={onDragEndRef}
      onDragOver={onDragOverRow}
      onDragLeave={onDragLeaveRow}
      onDrop={onDropRow}
      style={{ top: node.row * ROW_HEIGHT, height: ROW_HEIGHT, animationDelay: intro ? delay : undefined }}
      className={`absolute inset-x-0 flex min-w-max cursor-default items-center text-[13px] transition-opacity duration-150 ${
        intro ? 'animate-row-in' : ''
      } ${dim && !selected ? 'opacity-30' : ''} ${dropTarget ? 'z-10 rounded-md bg-gk-green/10 outline-dashed outline-2 -outline-offset-2 outline-gk-green' : ''}`}
    >
      {/* Цветная полоса от узла через всю строку, как в GitKraken */}
      <div
        style={{ left: cols.refs + Math.min(laneX(node.lane), cols.graph), backgroundColor: `${color}${bandAlpha}` }}
        className="pointer-events-none absolute inset-y-[3px] right-0 rounded-l-full transition-colors duration-150"
      />

      <div style={{ width: cols.refs }} className="@container relative flex shrink-0 items-center justify-end gap-1 overflow-hidden pl-2">
        {marked && (
          <span title={kb('Отмечен для сравнения — Ctrl+клик по другому коммиту')} className="shrink-0 rounded bg-gk-blue/20 px-1.5 text-[10px] font-medium text-gk-blue">
            A
          </span>
        )}
        {node.isHead && !node.refs.some((r) => r.head) && <HeadPill detached />}
        <RefLabels
          refs={node.refs}
          color={color}
          currentBranch={currentBranch}
          actions={refActions}
          onDragStart={(e, g) => {
            e.stopPropagation();
            const remote = g.all.find((r) => r.type === 'remote');
            onDragStartRef(e, g.local ? { kind: 'branch', name: g.name, hash: node.hash, label: g.name } : { kind: 'remote', name: remote?.name ?? g.name, hash: node.hash, label: g.name });
          }}
        />
      </div>

      <div style={{ width: cols.graph }} className="shrink-0" />

      <div
        style={{ borderColor: color, minWidth: MESSAGE_MIN_WIDTH }}
        className="relative flex h-[26px] flex-1 items-center border-l-[3px] px-3"
      >
        {node.wip ? (
          <span className="flex items-center gap-2 italic text-gk-muted">
            {node.message}
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] not-italic text-gk-text">
              <Pencil size={11} />
              {wipCount}
            </span>
          </span>
        ) : (
          <>
            {node.isHead && <HeadPill />}
            <span
              title={`${node.message}\n${node.author.name} · ${relativeTime(node.date)}`}
              className={`w-0 flex-1 truncate ${selected || node.isHead ? 'text-white' : ''} ${node.isHead ? 'font-medium' : ''}`}
            >
              {node.message}
            </span>
            {pipeline && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => onPipelineClick?.(pipeline)}
                title={`Пайплайн #${pipeline.id}: ${statusInfo(pipeline.status).label}\nКлик — подробности`}
                className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-125"
              >
                <StatusIcon status={pipeline.status} size={15} title={`Пайплайн #${pipeline.id}: ${statusInfo(pipeline.status).label}`} />
              </button>
            )}
          </>
        )}
      </div>

      {node.wip ? (
        <div style={{ width: cols.author + cols.date }} className="shrink-0" />
      ) : (
        <>
          <div
            style={{ width: cols.author }}
            title={`${node.author.name} <${node.author.email}>`}
            className="relative flex shrink-0 items-center overflow-hidden px-3 text-[13.5px] text-gk-text/90"
          >
            <span className="truncate">{node.author.name}</span>
          </div>
          <div
            style={{ width: cols.date }}
            title={`${fullDate(node.date)} · ${relativeTime(node.date)}`}
            className="relative shrink-0 overflow-hidden whitespace-nowrap px-2.5 text-right font-mono text-[12.5px] tabular-nums text-gk-muted"
          >
            {shortDate(node.date)}
          </div>
        </>
      )}
    </div>
  );
}


/* ---------------- Метки веток ---------------- */

// Локальная и удалённая ветка с одним именем показываются одной меткой с двумя иконками
function groupRefs(refs) {
  const groups = [];
  const used = new Set();
  for (const ref of refs) {
    if (used.has(ref)) continue;
    if (ref.type === 'local') {
      // Серверная ветка с тем же именем на этом же коммите — значит, синхронизированы
      const remote = refs.find((r) => r.type === 'remote' && !used.has(r) && r.name.slice(r.name.indexOf('/') + 1) === ref.name);
      if (remote) used.add(remote);
      groups.push({ name: ref.name, head: ref.head, local: true, remote: Boolean(remote), remoteName: remote?.name ?? null, tag: false, all: [ref, remote].filter(Boolean) });
    } else if (ref.type === 'remote') {
      groups.push({ name: ref.name, local: false, remote: true, remoteName: ref.name, tag: false, all: [ref] });
    } else {
      groups.push({ name: ref.name, local: false, remote: false, tag: true, all: [ref] });
    }
    used.add(ref);
  }
  return groups;
}

function RefLabels({ refs, color, onDragStart, currentBranch, actions }) {
  const pop = useHoverPopover();
  const badgeRef = useRef(null);
  if (!refs.length) return null;
  const groups = groupRefs(refs);
  const [first, ...rest] = groups;
  const draggable = !first.tag;
  const remoteOnly = first.remote && !first.local;
  // Локальная — заливка цветом ветки; только на сервере — контур пунктиром; тег — приглушённая заливка
  const style = remoteOnly
    ? { backgroundColor: `${color}1a`, borderColor: `${color}cc` }
    : first.tag
      ? { backgroundColor: `${color}30`, boxShadow: `inset 0 0 0 1px ${color}88` }
      : { backgroundColor: `${color}55`, boxShadow: `inset 0 0 0 1px ${color}aa` };
  return (
    <>
      <span
        draggable={draggable}
        onDragStart={draggable ? (e) => onDragStart(e, first) : undefined}
        title={`${first.remoteName && !first.local ? first.remoteName : first.name} — ${refKindLabel(first)}${rest.length ? `\nЕщё ${rest.length}: наведите на «+${rest.length}»` : ''}${draggable ? '\nПеретащите на другую ветку: слить, перемотать, rebase' : ''}`}
        style={style}
        className={`flex h-[22px] min-w-0 items-center gap-1.5 rounded-l px-2 text-[12px] font-medium ${remoteOnly ? 'border border-dashed text-white/90' : 'text-white'}`}
      >
        {first.head && <Check size={13} strokeWidth={3} className="shrink-0 text-white" />}
        {/* Где живёт ветка: ноутбук — у вас, облако — на сервере, вместе — синхронизированы */}
        <span className="hidden shrink-0 opacity-85 @[96px]:flex">
          <RefKindIcon local={first.local} remote={first.remote} tag={first.tag} size={12} />
        </span>
        <span className="truncate">{first.name}</span>
      </span>
      {rest.length > 0 && (
        <span
          ref={badgeRef}
          onMouseEnter={() => pop.show()}
          onMouseLeave={() => pop.hide()}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) (pop.open ? pop.close() : pop.show(0));
          }}
          style={{ backgroundColor: pop.open ? `${color}66` : `${color}33`, boxShadow: `inset 0 0 0 1px ${color}77` }}
          className="flex h-[22px] shrink-0 cursor-pointer items-center rounded px-1.5 text-[11px] text-white/85 transition-colors"
        >
          +{rest.length}
        </span>
      )}
      {pop.open && rest.length > 0 && (
        <span
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
        >
          <RefsPopover
            anchor={badgeRef.current}
            groups={groups}
            color={color}
            currentBranch={currentBranch}
            actions={
              actions && {
                checkout: (r) => {
                  pop.close();
                  actions.checkout(r);
                },
                deleteRemote: (n) => {
                  pop.close();
                  actions.deleteRemote(n);
                },
                menu: (r, x, y) => {
                  pop.close();
                  actions.menu(r, x, y);
                },
              }
            }
            onEnter={pop.keep}
            onLeave={() => pop.hide()}
          />
        </span>
      )}
      <span style={{ backgroundColor: color }} className="h-[2px] w-1 shrink-0 opacity-85" />
    </>
  );
}

/* ---------------- Узел ---------------- */

function useAvatar(email) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    avatarUrl(email).then((u) => alive && setUrl(u && !isFailed(u) ? u : null));
    return () => {
      alive = false;
    };
  }, [email]);
  return [url, () => {
    if (url) markFailed(url);
    setUrl(null);
  }];
}

// Текущий коммит (HEAD): спокойное статичное зелёное кольцо
function HeadRing({ x, y, r }) {
  return <circle cx={x} cy={y} r={r - 1} fill="none" stroke="#3cf0a0" strokeOpacity={0.85} strokeWidth={1.5} />;
}

function HeadPill({ detached = false }) {
  return (
    <span
      title={detached ? 'HEAD (detached) — текущий коммит без ветки' : 'HEAD — текущий коммит'}
      className="mr-2 flex h-[18px] shrink-0 items-center rounded bg-gk-green/20 px-1.5 text-[10px] font-bold tracking-wider text-gk-green ring-1 ring-gk-green/50"
    >
      HEAD{detached ? ' ⚠' : ''}
    </span>
  );
}

function Node({ node, selected, hovered, dim, intro, delay }) {
  const x = laneX(node.lane);
  const y = rowY(node.row);
  const color = laneColor(node.lane);
  const cls = `graph-node ${intro ? 'is-intro' : ''} ${hovered ? 'is-hover' : ''}`;
  const style = { ...(intro ? { animationDelay: delay } : null), opacity: dim && !selected ? 0.3 : 1, transition: 'opacity 150ms' };

  if (node.wip) {
    return (
      <g className={cls} style={style}>
        <circle cx={x} cy={y} r={NODE_RADIUS - 1} fill="#141821" stroke={color} strokeWidth={2} strokeDasharray="4 3" />
        <circle cx={x} cy={y} r={2.5} fill={color} />
      </g>
    );
  }

  // Мердж-коммиты — маленькие точки, как в GitKraken
  if (node.parents.length > 1) {
    return (
      <g className={cls} style={style}>
        {node.isHead && <HeadRing x={x} y={y} r={12.5} />}
        {selected && <circle className="graph-pulse" cx={x} cy={y} r={8} fill="none" stroke={color} strokeWidth={2} />}
        <circle cx={x} cy={y} r={7.5} fill={color} stroke="#0e1117" strokeWidth={2} />
      </g>
    );
  }

  return <AvatarNode node={node} x={x} y={y} color={color} selected={selected} cls={cls} style={style} />;
}

function AvatarNode({ node, x, y, color, selected, cls, style }) {
  const [url, onError] = useAvatar(node.author.email);
  const r = NODE_RADIUS;
  return (
    <g className={cls} style={style}>
      {node.isHead && <HeadRing x={x} y={y} r={r + 4} />}
      {selected && <circle className="graph-pulse" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2} />}
      {selected && <circle cx={x} cy={y} r={r + 2.5} fill="none" stroke={color} strokeWidth={1.75} />}
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r - 2} fill="rgb(0 0 0 / 0.18)" />
      <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" letterSpacing="0.2">
        {initials(node.author.name)}
      </text>
      {url && (
        <image
          href={url}
          x={x - (r - 2)}
          y={y - (r - 2)}
          width={(r - 2) * 2}
          height={(r - 2) * 2}
          clipPath="url(#avatar-clip)"
          preserveAspectRatio="xMidYMid slice"
          onError={onError}
        />
      )}
    </g>
  );
}

