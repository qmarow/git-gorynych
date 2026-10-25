import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Cloud, Laptop, Pencil, Tag } from 'lucide-react';
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
import { avatarColor, fullDate, initials, relativeTime, shortDate } from '../lib/format.js';
import { ResizeHandle, useStoredWidth } from './Resizer.jsx';
import { avatarUrl, isFailed, markFailed } from '../lib/avatars.js';

const HEADER_HEIGHT = 30;
const OVERSCAN = 15; // запас строк выше и ниже видимой области
const MAX_AUTO_GRAPH_WIDTH = 400; // авто-ширина графа; вручную можно растянуть шире
const MESSAGE_MIN_WIDTH = 140;
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
}) {
  const { nodes, edges, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const [view, setView] = useState({ top: 0, height: 800, width: 1000 });

  // Ширины колонок: тянутся мышью за разделители в заголовке и запоминаются
  const [refsW, setRefsW, saveRefsW] = useStoredWidth('graph.refs', 150, 60, 480);
  const [graphW, setGraphW, saveGraphW] = useStoredWidth('graph.graph', null, 40, 1400); // null = авто
  const [authorW, setAuthorW, saveAuthorW] = useStoredWidth('graph.author', 140, 60, 420);
  const [dateW, setDateW, saveDateW] = useStoredWidth('graph.date', 126, 64, 260);
  // Авто-ширина графа: по числу дорожек, но не больше, чем позволяет место,
  // чтобы колонки Author и Date оставались видны без горизонтальной прокрутки
  const roomForGraph = view.width - refsW - authorW - dateW - MESSAGE_MIN_WIDTH;
  const autoGraphWidth = Math.max(
    90,
    Math.min(graphWidth(laneCount), MAX_AUTO_GRAPH_WIDTH, Math.max(120, roomForGraph)),
  );
  const width = graphW ?? autoGraphWidth;
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

  const introDelay = (row) => `${Math.min(Math.max(row - first, 0), 40) * 14}ms`;

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
          <span className="truncate">Branch / Tag</span>
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
          <span className="truncate">Graph</span>
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
        <div style={{ minWidth: MESSAGE_MIN_WIDTH }} className="flex-1 truncate px-4">Commit message</div>
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
          <span className="truncate">Author</span>
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
          <span className="truncate">Date / Time</span>
        </HeaderCell>
      </div>

      <div className="relative" style={{ height }}>
        {visibleNodes.map((node) => (
          <Row
            key={node.hash}
            node={node}
            selected={node.hash === selectedHash}
            hovered={node.hash === hoverHash}
            intro={intro}
            delay={introDelay(node.row)}
            cols={cols}
            wipCount={wipCount}
            onHover={() => setHoverHash(node.hash)}
            onSelect={() => onSelect(node.hash)}
            onDoubleClick={() => onActivate?.(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(node.hash);
              onContextMenu?.(node, e.clientX, e.clientY);
            }}
          />
        ))}

        <svg
          className="pointer-events-none absolute top-0 overflow-hidden"
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

function Row({ node, selected, hovered, intro, delay, cols, wipCount, onHover, onSelect, onDoubleClick, onContextMenu }) {
  const color = laneColor(node.lane);
  const bandAlpha = selected ? '42' : hovered ? '2a' : '14';

  return (
    <div
      onMouseDown={(e) => e.button === 0 && onSelect()}
      onMouseEnter={onHover}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      style={{ top: node.row * ROW_HEIGHT, height: ROW_HEIGHT, animationDelay: intro ? delay : undefined }}
      className={`absolute inset-x-0 flex min-w-max cursor-default items-center text-[13px] ${intro ? 'animate-row-in' : ''}`}
    >
      {/* Цветная полоса от узла через всю строку, как в GitKraken */}
      <div
        style={{ left: cols.refs + Math.min(laneX(node.lane), cols.graph), backgroundColor: `${color}${bandAlpha}` }}
        className="pointer-events-none absolute inset-y-[3px] right-0 rounded-l-full transition-colors duration-150"
      />

      <div style={{ width: cols.refs }} className="relative flex shrink-0 items-center justify-end gap-1 overflow-hidden pl-2">
        {node.isHead && !node.refs.some((r) => r.head) && <HeadPill detached />}
        <RefLabels refs={node.refs} color={color} />
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
            className="relative flex shrink-0 items-center gap-2 overflow-hidden px-3 text-xs text-gk-text/85"
          >
            <MiniAvatar author={node.author} />
            <span className="truncate">{node.author.name}</span>
          </div>
          <div
            style={{ width: cols.date }}
            title={`${fullDate(node.date)} · ${relativeTime(node.date)}`}
            className="relative shrink-0 truncate px-3 text-right font-mono text-[11px] tabular-nums text-gk-muted"
          >
            {shortDate(node.date)}
          </div>
        </>
      )}
    </div>
  );
}

function MiniAvatar({ author }) {
  const [url, onError] = useAvatar(author.email);
  return (
    <span
      style={{ backgroundColor: avatarColor(author.name) }}
      className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full text-[8px] font-bold text-white"
    >
      {initials(author.name)}
      {url && <img src={url} alt="" onError={onError} className="absolute inset-0 h-full w-full object-cover" />}
    </span>
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
      const remote = refs.find((r) => r.type === 'remote' && r.name.slice(r.name.indexOf('/') + 1) === ref.name);
      if (remote) used.add(remote);
      groups.push({ name: ref.name, head: ref.head, local: true, remote: Boolean(remote), tag: false, all: [ref, remote].filter(Boolean) });
    } else if (ref.type === 'remote') {
      groups.push({ name: ref.name, local: false, remote: true, tag: false, all: [ref] });
    } else {
      groups.push({ name: ref.name, local: false, remote: false, tag: true, all: [ref] });
    }
    used.add(ref);
  }
  return groups;
}

function RefLabels({ refs, color }) {
  if (!refs.length) return null;
  const groups = groupRefs(refs);
  const [first, ...rest] = groups;
  return (
    <>
      <span
        title={refs.map((r) => r.name).join('\n')}
        style={{ backgroundColor: `${color}55`, boxShadow: `inset 0 0 0 1px ${color}aa` }}
        className="flex h-[22px] min-w-0 items-center gap-1.5 rounded-l px-2 text-[12px] font-medium text-white"
      >
        {first.head && <Check size={13} strokeWidth={3} className="shrink-0 text-white" />}
        <span className="truncate">{first.name}</span>
        <span className="flex shrink-0 items-center gap-1 opacity-80">
          {first.local && <Laptop size={12} />}
          {first.remote && <Cloud size={12} />}
          {first.tag && <Tag size={12} />}
        </span>
      </span>
      {rest.length > 0 && (
        <span
          title={rest.map((g) => g.name).join('\n')}
          style={{ backgroundColor: `${color}33`, boxShadow: `inset 0 0 0 1px ${color}77` }}
          className="flex h-[22px] shrink-0 items-center rounded px-1.5 text-[11px] text-white/80"
        >
          +{rest.length}
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

function Node({ node, selected, hovered, intro, delay }) {
  const x = laneX(node.lane);
  const y = rowY(node.row);
  const color = laneColor(node.lane);
  const cls = `graph-node ${intro ? 'is-intro' : ''} ${hovered ? 'is-hover' : ''}`;
  const style = intro ? { animationDelay: delay } : undefined;

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
        {node.isHead && <HeadRing x={x} y={y} r={11} />}
        {selected && <circle className="graph-pulse" cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={2} />}
        <circle cx={x} cy={y} r={6.5} fill={color} stroke="#0e1117" strokeWidth={2} />
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
      {node.isHead && <HeadRing x={x} y={y} r={r + 6} />}
      {selected && <circle className="graph-pulse" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2} />}
      {selected && <circle cx={x} cy={y} r={r + 3.5} fill="none" stroke={color} strokeWidth={2} />}
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r - 2} fill="rgb(0 0 0 / 0.18)" />
      <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff" letterSpacing="0.2">
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

