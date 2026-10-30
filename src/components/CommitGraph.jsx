import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileSearch, Pencil, SlidersHorizontal } from 'lucide-react';
import { RefKindIcon, RefsPopover, refKindLabel, useHoverPopover } from './RefBadge.jsx';
import { edgePath, graphWidth, laneColor, laneX, layoutGraph, metricsFor, rowY } from '../lib/graphLayout.js';
import { StatusIcon, statusInfo } from './PipelineStatus.jsx';
import { fullDate, initials, relativeTime, shortDate } from '../lib/format.js';
import { ResizeHandle, useStoredWidth } from './Resizer.jsx';
import { avatarUrl, isFailed, markFailed } from '../lib/avatars.js';
import { hasRefDrag, readRefDrag, startRefDrag } from '../lib/dnd.js';
import { isMod, kb } from '../lib/platform.js';
import { CC_TYPES, parseSummary } from '../lib/commitMsg.js';
import { DEFAULT_VIEW, columnById, moveColumn, useGraphView } from '../lib/graphView.js';
import GraphViewMenu from './GraphViewMenu.jsx';
import { isLight, readable } from '../lib/scheme.js';

const HEADER_HEIGHT = 30;
const OVERSCAN = 15; // запас строк выше и ниже видимой области
const MAX_AUTO_GRAPH_WIDTH = 400; // авто-ширина графа; вручную можно растянуть шире
const MESSAGE_MIN_WIDTH = 140;
const DATE_MIN_WIDTH = 132; // «22.09.2021 01:59» целиком
const INTRO_MS = 1300; // длительность анимации появления графа
const COLUMN_DRAG_TYPE = 'application/x-gitidea-column';
const FIT_SAMPLE = 3000; // сколько строк смотреть при подгонке ширины под содержимое

// Цвета бейджей Conventional Commits: те же, что у чипсов в форме коммита
const CC_COLORS = { ...Object.fromEntries(CC_TYPES.map((t) => [t.id, t.color])), build: '#9aa3b2', ci: '#15a0bf', revert: '#f25d2e' };

/* Ширина текста — для подгонки колонки под содержимое по двойному клику */
let measureCtx = null;
function textWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
const sansFont = () => getComputedStyle(document.body).fontFamily || 'sans-serif';
const monoFont = () => getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';

/** Ширина колонки по содержимому (px) или null, если мерить нечего */
function measureColumn(id, sample, gv) {
  const sans = sansFont();
  const mono = monoFont();
  const real = sample.filter((n) => !n.wip);
  if (id === 'refs') {
    const labelFont = `500 ${gv.density === 'compact' ? 11.5 : 12}px ${sans}`;
    let best = 0;
    for (const n of sample) {
      if (!n.refs.length) continue;
      const [g, ...rest] = groupRefs(n.refs);
      if (!g) continue;
      const w = textWidth(g.name, labelFont) + 16 + 26 + (g.head ? 19 : 0) + (rest.length ? 36 : 0) + (n.isHead && !n.refs.some((r) => r.head) ? 60 : 0);
      best = Math.max(best, w);
    }
    return best ? Math.ceil(best + 8 + 6 + 8) : null;
  }
  if (id === 'author') {
    const font = `13.5px ${sans}`;
    const names = new Set(real.map((n) => n.author.name));
    let best = 0;
    for (const name of names) best = Math.max(best, textWidth(name, font));
    return best ? Math.ceil(best + 24 + 4) : null;
  }
  if (id === 'date') {
    const font = `12.5px ${mono}`;
    let best = 0;
    for (const n of real) best = Math.max(best, textWidth(gv.dateFormat === 'relative' ? relativeTime(n.date) : shortDate(n.date), font));
    return best ? Math.ceil(best + 20 + 4) : null;
  }
  if (id === 'sha') return Math.max(90, Math.ceil(textWidth('0000000', `12px ${mono}`) + 20 + 8 + 16));
  return null; // граф — авто по числу дорожек
}

const clampW = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  fileHits = null, // Map хэш → { files, count } — текст поиска найден в изменениях этих файлов
  pipelines = null, // { [sha]: { id, status } } — статусы пайплайнов GitLab
  onPipelineClick,
  onCompare, // Ctrl+клик: сравнить выбранный коммит с этим
  compareMark = null, // коммит, отмеченный для сравнения
  dragSource = null, // что сейчас перетаскивают (коммит или ветку)
  onDragSource, // начало/конец перетаскивания
  onDropOnBranch, // (ветки строки, x, y, что перетащили) — бросили на строку с веткой
  currentBranch = null,
  refActions = null, // { checkout(ref), deleteRemote(fullName), menu(ref, x, y) } — для поповера «+N»
  onCopySha, // клик по хэшу в колонке SHA
}) {
  const [dropHash, setDropHash] = useState(null);
  useEffect(() => {
    if (!dragSource) setDropHash(null);
  }, [dragSource]);
  const { nodes, edges, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const [view, setView] = useState({ top: 0, height: 800, width: 1000 });

  // Вид таблицы: колонки, порядок, плотность, формат даты, стиль узлов
  const [gv, setGv] = useGraphView();
  const m = metricsFor(gv.density);
  const dots = gv.nodeStyle === 'dots';
  const [menu, setMenu] = useState(null); // { x, y }
  const closeMenu = useCallback(() => setMenu(null), []);

  // Ширины колонок: тянутся мышью за разделители в заголовке и запоминаются
  const [refsStoredW, setRefsW, saveRefsW, refsStored] = useStoredWidth('graph.refs', 190, 60, 480);
  const [graphW, setGraphW, saveGraphW] = useStoredWidth('graph.graph', null, 40, 1400); // null = авто
  const [authorStoredW, setAuthorW, saveAuthorW, authorStored] = useStoredWidth('graph.author', 160, 60, 420);
  // Дата не уже DATE_MIN_WIDTH: «26.10.26 22:58» должна помещаться целиком
  const [dateW, setDateW, saveDateW] = useStoredWidth('graph.date.v3', 150, DATE_MIN_WIDTH, 260);
  const [shaW, setShaW, saveShaW] = useStoredWidth('graph.sha', 104, 90, 180);
  // Пока ширину не меняли руками — подбираем по содержимому, чтобы имена веток и авторов не обрезались
  const head = nodes.length > 400 ? nodes.slice(0, 400) : nodes;
  const autoRefs = useMemo(() => clampW(measureColumn('refs', head, gv) ?? 190, 140, 260), [nodes, gv.density]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoAuthor = useMemo(() => clampW(measureColumn('author', head, gv) ?? 160, 110, 220), [nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const refsW = refsStored ? refsStoredW : autoRefs;
  const authorW = authorStored ? authorStoredW : autoAuthor;
  const widthApi = {
    refs: [refsW, setRefsW, saveRefsW],
    graph: [graphW, setGraphW, saveGraphW],
    author: [authorW, setAuthorW, saveAuthorW],
    date: [dateW, setDateW, saveDateW],
    sha: [shaW, setShaW, saveShaW],
  };

  // Видимые колонки в выбранном порядке; «Сообщение» видно всегда
  const columns = gv.order.filter((id) => id === 'message' || !gv.hidden.includes(id));
  const has = (id) => columns.includes(id);
  const fixed = { refs: refsW, author: authorW, date: dateW, sha: shaW };
  const fixedSum = columns.reduce((sum, id) => sum + (fixed[id] ?? 0), 0);
  // Авто-ширина графа: по числу дорожек, но не больше, чем позволяет место,
  // чтобы остальные колонки оставались видны без горизонтальной прокрутки
  const roomForGraph = view.width - fixedSum - MESSAGE_MIN_WIDTH;
  const autoGraphWidth = Math.max(90, Math.min(graphWidth(laneCount, m), MAX_AUTO_GRAPH_WIDTH, Math.max(120, roomForGraph)));
  // Ширина графа, заданная вручную, не должна выталкивать соседние колонки за правый край
  const width = has('graph') ? Math.max(40, Math.min(graphW ?? autoGraphWidth, roomForGraph)) : 0;
  // Сообщение забирает всё оставшееся место — в том числе от скрытых колонок
  const messageW = Math.max(MESSAGE_MIN_WIDTH, view.width - fixedSum - width);
  const cols = { ...fixed, graph: width, message: messageW };
  const offsets = {};
  columns.reduce((left, id) => {
    offsets[id] = left;
    return left + cols[id];
  }, 0);
  const graphAt = columns.indexOf('graph');
  const refsAt = columns.indexOf('refs');
  // С какой стороны от меток веток стоит граф — туда тянется соединительная линия
  const refsSide = graphAt !== -1 && refsAt !== -1 ? (refsAt === graphAt - 1 ? 'left' : refsAt === graphAt + 1 ? 'right' : null) : null;
  const msgAt = columns.indexOf('message');
  const height = nodes.length * m.rowH;

  const scrollRef = useRef(null);
  const [hoverHash, setHoverHash] = useState(null);
  const [intro, setIntro] = useState(true);
  const [copied, setCopied] = useState(null);
  const [colDrag, setColDrag] = useState(null); // { id, over, after }

  // Анимация появления — при открытии репозитория
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // Окно не на экране (свёрнуто, за другими окнами) или включено «меньше движения» — без анимации:
    // браузер может не проиграть её, и узлы с линиями остались бы невидимыми до перерисовки
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (document.visibilityState !== 'visible' || reduce) {
      setIntro(false);
      return undefined;
    }
    setIntro(true);
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    const stop = () => document.visibilityState !== 'visible' && setIntro(false);
    document.addEventListener('visibilitychange', stop);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', stop);
    };
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
    const top = node.row * m.rowH;
    if (top < el.scrollTop || top + m.rowH > el.scrollTop + el.clientHeight - HEADER_HEIGHT) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash]);

  // Смена плотности: держим на месте выбранный коммит (или верх списка)
  const prevRowH = useRef(m.rowH);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prevRowH.current !== m.rowH) el.scrollTop = Math.round((el.scrollTop / prevRowH.current) * m.rowH);
    prevRowH.current = m.rowH;
  }, [m.rowH]);

  const first = Math.max(0, Math.floor(view.top / m.rowH) - OVERSCAN);
  const last = Math.min(nodes.length - 1, Math.ceil((view.top + view.height) / m.rowH) + OVERSCAN);
  const visibleNodes = nodes.slice(first, last + 1);
  const visibleEdges = edges.filter((e) => e.minRow <= last && e.maxRow >= first);

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const index = nodes.findIndex((n) => n.hash === selectedHash);
    const next = nodes[Math.min(nodes.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) onSelect(next.hash);
  };

  // Двойной клик по разделителю: ширина под содержимое колонки (граф — снова авто)
  const fitWidth = (id) => measureColumn(id, nodes.length > FIT_SAMPLE ? nodes.slice(0, FIT_SAMPLE) : nodes, gv);

  const resetLayout = () => {
    for (const [, set, save] of Object.values(widthApi)) {
      set(null);
      save(null);
    }
    setGv({ order: DEFAULT_VIEW.order, hidden: DEFAULT_VIEW.hidden });
  };

  const copySha = (hash) => {
    onCopySha?.(hash);
    setCopied(hash);
    setTimeout(() => setCopied((h) => (h === hash ? null : h)), 1200);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 animate-fade-in items-center justify-center text-gk-muted">
        В репозитории ещё нет коммитов
      </div>
    );
  }

  const introDelay = (row) => `${Math.min(Math.max(row - first, 0), 30) * 20}ms`;
  const nodeR = dots ? m.dotR : m.nodeR;

  /* Перестановка колонок: перетаскиваем заголовок */
  const headerDrag = (id) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(COLUMN_DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = 'move';
      setColDrag({ id, over: null, after: false });
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      setColDrag((d) => (d && (d.over !== id || d.after !== after) ? { ...d, over: id, after } : d));
    },
    onDrop: (e) => {
      const from = e.dataTransfer.getData(COLUMN_DRAG_TYPE);
      if (!from) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      setColDrag(null);
      if (from !== id) setGv((v) => ({ order: moveColumn(v.order, from, id, after) }));
    },
    onDragEnd: () => setColDrag(null),
  });

  const openMenuAt = (x, y) => setMenu({ x, y });

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
      {/* Заголовки колонок. Правый клик — настройка вида */}
      <div
        style={{ height: HEADER_HEIGHT }}
        data-testid="graph-header"
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        }}
        className="glass sticky top-0 z-10 flex min-w-max items-stretch border-b border-gk-border bg-gk-panel text-[10px] font-semibold uppercase leading-none tracking-wider text-gk-dim"
      >
        {columns.map((id, i) => {
          const before = i < msgAt; // колонки левее сообщения тянутся за правый край, правее — за левый
          const api = widthApi[id];
          const fit = () => {
            const [, set, save] = api;
            const w = fitWidth(id);
            save(w === null ? null : set(w));
            if (w === null) set(null);
          };
          return (
            <HeaderCell
              key={id}
              id={id}
              width={cols[id]}
              last={i === columns.length - 1}
              dropSide={colDrag && colDrag.over === id && colDrag.id !== id ? (colDrag.after ? 'after' : 'before') : null}
              dragging={colDrag?.id === id}
              {...headerDrag(id)}
            >
              <span className={`truncate ${id === 'date' ? 'tabular-nums' : ''}`}>{columnById(id).label}</span>
              {api && (
                <ResizeHandle
                  width={cols[id]}
                  direction={before ? 1 : -1}
                  onResize={api[1]}
                  onCommit={api[2]}
                  onReset={fit}
                  title={
                    id === 'graph'
                      ? 'Потяните, чтобы изменить ширину графа. Двойной клик — авто'
                      : 'Потяните, чтобы изменить ширину. Двойной клик — по содержимому'
                  }
                  className={before ? '-right-1' : '-left-1'}
                />
              )}
            </HeaderCell>
          );
        })}
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            menu ? closeMenu() : openMenuAt(r.right - 320, r.bottom + 4);
          }}
          onMouseDown={(e) => menu && e.stopPropagation()}
          aria-label="Вид таблицы"
          data-tip="Вид таблицы: колонки, плотность строк, формат даты, узлы графа"
          className={`absolute right-1 top-1/2 z-30 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded transition-colors ${
            menu ? 'bg-gk-hover text-gk-text' : 'text-gk-dim hover:bg-gk-hover hover:text-gk-text'
          }`}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>

      <div className="relative" style={{ height }}>
        {visibleNodes.map((node) => (
          <Row
            key={node.hash}
            node={node}
            m={m}
            columns={columns}
            cols={cols}
            offsets={offsets}
            refsSide={refsSide}
            dateFormat={gv.dateFormat}
            pipeline={pipelines?.[node.hash] ?? null}
            fileHit={fileHits?.get(node.hash) ?? null}
            onPipelineClick={onPipelineClick}
            selected={node.hash === selectedHash}
            hovered={node.hash === hoverHash}
            dim={Boolean(matchSet) && !matchSet.has(node.hash)}
            intro={intro}
            delay={introDelay(node.row)}
            wipCount={wipCount}
            onHover={() => setHoverHash(node.hash)}
            marked={node.hash === compareMark}
            dropTarget={dropHash === node.hash}
            copied={copied === node.hash}
            onCopySha={copySha}
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

        {has('graph') && (
          <svg
            className="pointer-events-none absolute top-0 overflow-visible"
            style={{ left: offsets.graph }}
            width={width}
            height={height}
            data-testid="graph-svg"
            data-density={gv.density}
            data-nodes={gv.nodeStyle}
          >
            <defs>
              <clipPath id="avatar-clip" clipPathUnits="objectBoundingBox">
                <circle cx="0.5" cy="0.5" r="0.5" />
              </clipPath>
            </defs>

            {/* Линии от меток веток к узлам */}
            {refsSide &&
              visibleNodes
                .filter((n) => n.refs.length > 0)
                .map((n) => (
                  <line
                    key={`ref-${n.hash}`}
                    x1={refsSide === 'left' ? 0 : laneX(n.lane, m) + nodeR}
                    x2={refsSide === 'left' ? laneX(n.lane, m) - nodeR : width}
                    y1={rowY(n.row, m)}
                    y2={rowY(n.row, m)}
                    stroke={laneColor(n.lane)}
                    strokeWidth={2}
                    strokeOpacity={0.85}
                  />
                ))}

            {visibleEdges.map((edge) => (
              <path
                key={edge.id}
                d={edgePath(edge, m)}
                pathLength={edge.dashed ? undefined : 1}
                className={`graph-edge ${intro && !edge.dashed ? 'is-intro' : ''}`}
                style={intro ? { animationDelay: introDelay(edge.from.row) } : undefined}
                fill="none"
                stroke={laneColor(edge.travel)}
                strokeOpacity={matchSet ? 0.3 : 1}
                strokeWidth={gv.density === 'compact' ? 2 : 2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={edge.dashed ? '4 4' : undefined}
              />
            ))}

            {visibleNodes.map((node) => (
              <Node
                key={node.hash}
                node={node}
                m={m}
                dots={dots}
                dim={Boolean(matchSet) && !matchSet.has(node.hash)}
                selected={node.hash === selectedHash}
                hovered={node.hash === hoverHash}
                intro={intro}
                delay={introDelay(node.row)}
              />
            ))}
          </svg>
        )}
      </div>

      {truncated && (
        <div className="py-3 text-center text-xs text-gk-dim">
          Показаны последние {commits.length.toLocaleString('ru-RU')} коммитов
        </div>
      )}

      {menu && (
        <GraphViewMenu x={menu.x} y={menu.y} view={gv} onChange={setGv} onResetLayout={resetLayout} onClose={closeMenu} />
      )}
    </div>
  );
}

/* ---------------- Строка ---------------- */

function HeaderCell({ id, width, last, dropSide, dragging, children, ...drag }) {
  return (
    <div
      {...drag}
      data-col={id}
      style={{ width }}
      className={`relative flex h-full shrink-0 cursor-grab items-center border-r border-gk-border/60 px-3 last-of-type:border-r-0 active:cursor-grabbing ${
        last ? 'pr-8' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {children}
      {dropSide && (
        <span className={`pointer-events-none absolute inset-y-1 z-30 w-[2px] rounded-full bg-gk-blue ${dropSide === 'before' ? '-left-px' : '-right-px'}`} />
      )}
    </div>
  );
}

/** Сообщение коммита: префикс Conventional Commits — отдельным бейджем */
function MessageText({ node, strong }) {
  const cc = useMemo(() => parseSummary(node.message), [node.message]);
  // Подсказка: заголовок и описание (пустые строки сжаты, длинное описание укорочено)
  const desc = (node.description ?? '').replace(/\n{3,}/g, '\n\n').trim();
  const full = desc ? `${node.message}\n\n${desc.length > 500 ? `${desc.slice(0, 500)}…` : desc}` : node.message;
  const text = cc.type ? `${cc.subject}${cc.suffix ? ` (${cc.suffix})` : ''}` : node.message;
  const color = cc.type ? readable(CC_COLORS[cc.type] ?? '#9aa3b2') : null;
  return (
    <>
      {cc.type && cc.prefix && <span className="mr-1.5 shrink-0 text-gk-muted">[{cc.prefix}]</span>}
      {cc.type && (
        <span
          data-testid="cc-badge"
          style={{ color, backgroundColor: `${color}1c`, boxShadow: `inset 0 0 0 1px ${color}55` }}
          className="mr-2 max-w-[45%] shrink-0 truncate rounded px-1.5 font-mono text-[10.5px] font-medium leading-[17px]"
        >
          {cc.type}
          {cc.scope && <span className="opacity-75">({cc.scope})</span>}
          {cc.breaking && '!'}
        </span>
      )}
      <span
        data-tip={full}
        data-tip-overflow=""
        data-tip-wide=""
        className={`w-0 flex-1 truncate ${strong ? 'text-gk-strong' : ''} ${node.isHead ? 'font-medium' : ''}`}
      >
        {text}
      </span>
    </>
  );
}

function Row({
  node,
  m,
  columns,
  cols,
  offsets,
  refsSide,
  dateFormat,
  selected,
  hovered,
  dim,
  intro,
  delay,
  wipCount,
  pipeline,
  fileHit,
  onPipelineClick,
  onHover,
  onSelect,
  onDoubleClick,
  onContextMenu,
  marked,
  dropTarget,
  copied,
  onCopySha,
  onDragStartRef,
  onDragEndRef,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  currentBranch,
  refActions,
}) {
  const color = laneColor(node.lane);
  const bandAlpha = isLight() ? (selected ? '30' : hovered ? '1e' : '0c') : selected ? '42' : hovered ? '2a' : '14';
  const compact = m.id === 'compact';
  const bandLeft = columns.includes('graph') ? offsets.graph + Math.min(laneX(node.lane, m), cols.graph) : offsets.message;

  const cell = (id) => {
    switch (id) {
      case 'refs':
        return (
          <div
            key={id}
            style={{ width: cols.refs }}
            className={`@container relative flex shrink-0 items-center gap-1 overflow-hidden hover:overflow-visible ${
              refsSide === 'left' ? 'justify-end pl-2' : 'justify-start pr-2'
            } ${refsSide === 'right' ? '' : refsSide ? '' : 'pl-2'}`}
          >
            {refsSide === 'right' && node.refs.length > 0 && <span style={{ backgroundColor: color }} className="h-[2px] w-1 shrink-0 opacity-85" />}
            {marked && (
              <span data-tip={kb('Отмечен для сравнения — Ctrl+клик по другому коммиту')} className="shrink-0 rounded bg-gk-blue/20 px-1.5 text-[10px] font-medium text-gk-blue">
                A
              </span>
            )}
            {node.isHead && !node.refs.some((r) => r.head) && <HeadPill detached compact={compact} />}
            <RefLabels
              refs={node.refs}
              color={color}
              compact={compact}
              connector={refsSide === 'left'}
              currentBranch={currentBranch}
              actions={refActions}
              onDragStart={(e, g) => {
                e.stopPropagation();
                const remote = g.all.find((r) => r.type === 'remote');
                onDragStartRef(e, g.local ? { kind: 'branch', name: g.name, hash: node.hash, label: g.name } : { kind: 'remote', name: remote?.name ?? g.name, hash: node.hash, label: g.name });
              }}
            />
          </div>
        );
      case 'graph':
        return <div key={id} style={{ width: cols.graph }} className="shrink-0" />;
      case 'message':
        return (
          <div
            key={id}
            data-col="message"
            style={{ borderColor: color, width: cols.message, height: m.rowH - 8 }}
            className="relative flex shrink-0 items-center overflow-hidden border-l-[3px] px-3"
          >
            {node.wip ? (
              <span className="flex min-w-0 items-center gap-2 italic text-gk-muted">
                <span className="truncate">{node.message}</span>
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-fg/10 px-2 py-0.5 text-[11px] not-italic text-gk-text">
                  <Pencil size={11} />
                  {wipCount}
                </span>
              </span>
            ) : (
              <>
                {node.isHead && <HeadPill compact={compact} />}
                <MessageText node={node} strong={selected || node.isHead} />
                {fileHit && (
                  <span
                    data-testid="row-file-hits"
                    data-tip={`Найдено в изменениях:\n${fileHit.files
                      .slice(0, 8)
                      .map((f) => `${f.path} — ${f.count}`)
                      .join('\n')}${fileHit.files.length > 8 || fileHit.moreFiles ? '\n…' : ''}`}
                    className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-gk-yellow/20 px-1.5 py-px text-[10.5px] font-medium text-gk-yellow"
                  >
                    <FileSearch size={10} />
                    {fileHit.files.length + (fileHit.moreFiles ?? 0)}
                  </span>
                )}
                {pipeline && (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => onPipelineClick?.(pipeline)}
                    data-tip={`Пайплайн #${pipeline.id}: ${statusInfo(pipeline.status).label}\nКлик — подробности`}
                    className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-125"
                  >
                    <StatusIcon status={pipeline.status} size={15} title={`Пайплайн #${pipeline.id}: ${statusInfo(pipeline.status).label}`} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      case 'sha':
        return (
          <div key={id} data-col="sha" style={{ width: cols.sha }} className="relative flex shrink-0 items-center overflow-hidden px-2.5">
            {!node.wip && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => onCopySha(node.hash)}
                data-tip={`${node.hash}\nКлик — скопировать`}
                className="group/sha flex min-w-0 items-center gap-1 rounded px-1 font-mono text-[12px] tabular-nums text-gk-muted hover:bg-gk-fg/5 hover:text-gk-text"
              >
                <span className="truncate">{node.hash.slice(0, 7)}</span>
                {copied ? (
                  <Check size={11} className="shrink-0 text-gk-green" />
                ) : (
                  <Copy size={11} className="shrink-0 opacity-0 transition-opacity group-hover/sha:opacity-70" />
                )}
              </button>
            )}
          </div>
        );
      case 'author':
        return (
          <div
            key={id}
            data-col="author"
            style={{ width: cols.author }}
            data-tip={node.wip ? undefined : `${node.author.name} <${node.author.email}>`}
            className={`relative flex shrink-0 items-center overflow-hidden px-3 text-gk-text/90 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}
          >
            {!node.wip && <span className="truncate">{node.author.name}</span>}
          </div>
        );
      case 'date':
        return (
          <div
            key={id}
            data-col="date"
            style={{ width: cols.date }}
            data-tip={node.wip ? undefined : dateFormat === 'relative' ? fullDate(node.date) : `${fullDate(node.date)} · ${relativeTime(node.date)}`}
            className="relative shrink-0 overflow-hidden whitespace-nowrap px-2.5 text-right font-mono text-[12.5px] tabular-nums text-gk-muted [font-variant-numeric:tabular-nums]"
          >
            {!node.wip && (dateFormat === 'relative' ? relativeTime(node.date) : shortDate(node.date))}
          </div>
        );
      default:
        return null;
    }
  };

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
      style={{ top: node.row * m.rowH, height: m.rowH, animationDelay: intro ? delay : undefined }}
      className={`absolute inset-x-0 flex min-w-max cursor-default items-center transition-opacity duration-150 ${compact ? 'text-[12.5px]' : 'text-[13px]'} ${
        intro ? 'animate-row-in' : ''
      } ${dim && !selected ? 'opacity-30' : ''} ${dropTarget ? 'z-10 rounded-md bg-gk-green/10 outline-dashed outline-2 -outline-offset-2 outline-gk-green' : ''}`}
    >
      {/* Цветная полоса от узла через всю строку, как в GitKraken */}
      <div
        style={{ left: bandLeft, backgroundColor: `${color}${bandAlpha}`, top: compact ? 2 : 3, bottom: compact ? 2 : 3 }}
        className="pointer-events-none absolute right-0 rounded-l-full transition-colors duration-150"
      />
      {columns.map(cell)}
    </div>
  );
}

/* ---------------- Метки веток ---------------- */

// Локальная и удалённая ветка с одним именем показываются одной меткой с двумя иконками
function groupRefs(refs) {
  const groups = [];
  const used = new Set();
  // Сначала локальные ветки: иначе origin/x, стоящий в списке раньше x, не склеится с ней («x +1»)
  const order = (r) => (r.type === 'local' ? 0 : r.type === 'remote' ? 1 : 2);
  const sorted = refs.filter((r) => !(r.type === 'remote' && r.name.endsWith('/HEAD'))).sort((a, b) => order(a) - order(b) || (b.head ? 1 : 0) - (a.head ? 1 : 0));
  for (const ref of sorted) {
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

function RefLabels({ refs, color, onDragStart, currentBranch, actions, compact = false, connector = true }) {
  const pop = useHoverPopover();
  const [expanded, setExpanded] = useState(false);
  const badgeRef = useRef(null);
  const groups = groupRefs(refs);
  if (!groups.length) return null;
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
        onContextMenu={(e) => {
          // Правый клик по метке — меню только этой ветки (а не всего коммита)
          if (!actions?.menu) return;
          e.preventDefault();
          e.stopPropagation();
          actions.menu(first.tag ? { type: 'tag', name: first.name } : first.local ? { type: 'local', name: first.name } : { type: 'remote', name: first.remoteName }, e.clientX, e.clientY);
        }}
        onMouseEnter={(e) => {
          const label = e.currentTarget.querySelector('[data-ref-name]');
          setExpanded(Boolean(label && label.scrollWidth > label.clientWidth + 1));
        }}
        onMouseLeave={() => setExpanded(false)}
        onDoubleClick={(e) => {
          // Двойной клик по метке — checkout именно этой ветки (remote — создать локальную и следить)
          if (first.tag || !actions?.checkout) return;
          e.stopPropagation();
          actions.checkout(first.local ? { type: 'local', name: first.name } : { type: 'remote', name: first.remoteName });
        }}
        data-tip={`${first.remoteName && !first.local ? first.remoteName : first.name} — ${refKindLabel(first)}${rest.length ? `\nЕщё ${rest.length}: наведите на «+${rest.length}»` : ''}${draggable ? `\nДвойной клик — ${first.local ? 'переключиться на ветку' : 'создать локальную ветку и переключиться'}\nПеретащите на другую ветку: слить, перемотать, rebase` : ''}`}
        style={style}
        className={`relative flex min-w-0 items-center gap-1.5 rounded-l px-2 font-medium ${compact ? 'h-[18px] text-[11.5px]' : 'h-[22px] text-[12px]'} ${remoteOnly ? 'border border-dashed text-gk-strong/90' : 'text-gk-strong'}`}
      >
        {first.head && <Check size={13} strokeWidth={3} className="shrink-0 text-gk-strong" />}
        {/* Где живёт ветка: ноутбук — у вас, облако — на сервере, вместе — синхронизированы */}
        <span className="hidden shrink-0 opacity-85 @[96px]:flex">
          <RefKindIcon local={first.local} remote={first.remote} tag={first.tag} size={12} />
        </span>
        <span className="truncate" data-ref-name="">
          {first.name}
        </span>
        {/* Имя не влезло — при наведении метка раскрывается целиком поверх соседних колонок */}
        {expanded && (
          <span
            aria-hidden
            data-testid="ref-expanded"
            style={
              remoteOnly
                ? { backgroundColor: 'var(--gk-solid)', borderColor: `${color}cc`, boxShadow: `inset 0 0 0 999px ${color}1a` }
                : { backgroundColor: 'var(--gk-solid)', boxShadow: `inset 0 0 0 999px ${first.tag ? `${color}30` : `${color}55`}, inset 0 0 0 1px ${color}aa` }
            }
            className={`pointer-events-none absolute left-0 top-0 z-40 flex h-full items-center gap-1.5 whitespace-nowrap rounded px-2 font-medium shadow-lg shadow-gk-sink/40 ${remoteOnly ? 'border border-dashed text-gk-strong/90' : 'text-gk-strong'} ${compact ? 'text-[11.5px]' : 'text-[12px]'}`}
          >
            {first.head && <Check size={13} strokeWidth={3} className="shrink-0 text-gk-strong" />}
            <RefKindIcon local={first.local} remote={first.remote} tag={first.tag} size={12} />
            {first.name}
          </span>
        )}
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
          className={`flex shrink-0 cursor-pointer items-center rounded px-1.5 text-[11px] text-gk-strong/85 transition-colors ${compact ? 'h-[18px]' : 'h-[22px]'}`}
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
      {connector && <span style={{ backgroundColor: color }} className="h-[2px] w-1 shrink-0 opacity-85" />}
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
  return <circle cx={x} cy={y} r={r - 1} fill="none" style={{ stroke: 'var(--color-gk-green)' }} strokeOpacity={0.85} strokeWidth={1.5} />;
}

function HeadPill({ detached = false, compact = false }) {
  return (
    <span
      data-tip={detached ? 'HEAD (detached) — текущий коммит без ветки' : 'HEAD — текущий коммит'}
      className={`mr-2 flex shrink-0 items-center rounded bg-gk-green/20 px-1.5 text-[10px] font-bold tracking-wider text-gk-green ring-1 ring-gk-green/50 ${
        compact ? 'h-[16px]' : 'h-[18px]'
      }`}
    >
      HEAD{detached ? ' ⚠' : ''}
    </span>
  );
}

function Node({ node, m, dots, selected, hovered, dim, intro, delay }) {
  const x = laneX(node.lane, m);
  const y = rowY(node.row, m);
  const color = laneColor(node.lane);
  const cls = `graph-node ${intro ? 'is-intro' : ''} ${hovered ? 'is-hover' : ''}`;
  const style = { ...(intro ? { animationDelay: delay } : null), opacity: dim && !selected ? 0.3 : 1, transition: 'opacity 150ms' };

  if (node.wip) {
    const r = dots ? m.dotR + 1.5 : m.nodeR - 1;
    return (
      <g className={cls} style={style}>
        <circle cx={x} cy={y} r={r} style={{ fill: 'var(--gk-solid)' }} stroke={color} strokeWidth={2} strokeDasharray={dots ? '3 2' : '4 3'} />
        <circle cx={x} cy={y} r={dots ? 1.75 : 2.5} fill={color} />
      </g>
    );
  }

  // Мердж-коммиты и режим «точек» — маленькие цветные кружки без текста
  if (dots || node.parents.length > 1) {
    const r = dots ? (node.parents.length > 1 ? m.dotR - 1 : m.dotR) : Math.round(m.nodeR * 0.54 * 2) / 2;
    return (
      <g className={cls} style={style} data-node={dots ? 'dot' : 'merge'}>
        {node.isHead && <HeadRing x={x} y={y} r={r + 5} />}
        {selected && <circle className="graph-pulse" cx={x} cy={y} r={r + 0.5} fill="none" stroke={color} strokeWidth={2} />}
        {selected && dots && <circle cx={x} cy={y} r={r + 2.5} fill="none" stroke={color} strokeWidth={1.5} />}
        <circle cx={x} cy={y} r={r} fill={color} style={{ stroke: 'var(--gk-base)' }} strokeWidth={dots ? 1.5 : 2} />
      </g>
    );
  }

  return <AvatarNode node={node} x={x} y={y} r={m.nodeR} color={color} selected={selected} cls={cls} style={style} />;
}

function AvatarNode({ node, x, y, r, color, selected, cls, style }) {
  const [url, onError] = useAvatar(node.author.email);
  // В компактной плотности влезает одна буква
  const letters = initials(node.author.name).slice(0, r < 11 ? 1 : 2);
  return (
    <g className={cls} style={style} data-node="avatar">
      {node.isHead && <HeadRing x={x} y={y} r={r + 4} />}
      {selected && <circle className="graph-pulse" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2} />}
      {selected && <circle cx={x} cy={y} r={r + 2.5} fill="none" stroke={color} strokeWidth={1.75} />}
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r - 2} fill="rgb(0 0 0 / 0.18)" />
      <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={Math.round(r * 0.8)} fontWeight="700" fill="#fff" letterSpacing="0.2">
        {letters}
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
