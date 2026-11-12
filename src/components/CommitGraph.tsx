import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { Archive, Check, Copy, FileSearch, Pencil, SlidersHorizontal } from 'lucide-react';
import { RefKindIcon, RefsPopover, refKindLabel, useHoverPopover, type RefActions, type RefGroup, type RefItem } from './RefBadge.tsx';
import { edgePath, fitMetrics, graphWidth, laneColor, laneX, layoutGraph, metricsFor, rowY, type GraphNode, type LayoutCommit, type Metrics } from '../lib/graphLayout.ts';
import { StatusIcon, statusInfo } from './PipelineStatus.tsx';
import { fullDate, initials, relativeTime, shortDate } from '../lib/format.ts';
import { ResizeHandle, useStoredWidth } from './Resizer.tsx';
import { avatarUrl, isFailed, markFailed } from '../lib/avatars.ts';
import { hasRefDrag, readRefDrag, startRefDrag, type RefDragPayload } from '../lib/dnd.ts';
import { isMod, kb } from '../lib/platform.ts';
import { CC_TYPES, parseSummary } from '../lib/commitMsg.ts';
import { DEFAULT_VIEW, columnById, moveColumn, useGraphView, type ColumnId, type GraphView } from '../lib/graphView.ts';
import GraphViewMenu from './GraphViewMenu.tsx';
import { isLight, readable } from '../lib/scheme.ts';
import { t as tr, tj, locale } from '../i18n/index.ts';

/** Ссылка на коммите (`CommitRef`): ветка, серверная ветка или тег */
type GraphRef = RefItem & { head?: boolean | null };

/**
 * Строка графа (готовит App): коммит, WIP или stash (`graphStash.ts`). У WIP нет автора и даты — эти поля
 * читаются только под проверкой `!node.wip`.
 */
export interface GraphRow extends LayoutCommit {
  hash: string;
  parents: string[];
  message: string;
  description?: string;
  refs: GraphRef[];
  author: { name: string; email: string };
  date: string;
  isHead?: boolean;
  wip?: boolean;
  stash?: { id: string } | null;
}
type GraphItem = GraphNode<GraphRow>;

/** Пайплайн коммита (`pipelineMap.bySha`) и сводка по его заданиям */
export type PipelineMark = { id: string | number; status: string };
type PipelineTip = { status: string; text: string };
/** Текст поиска найден в изменениях этих файлов */
type FileHit = { files: { path: string; count: number }[]; moreFiles?: number };
/** Ширина колонки: значение, «потянуть» (возвращает итог) и сохранить */
type WidthApi = [number | null, (value: number | null) => number, (value: number | null) => void];
type DragPayload = RefDragPayload & { message?: string };

interface CommitGraphProps {
  commits: GraphRow[];
  introKey: string;
  focus?: { hash: string; n: number } | null;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  onActivate?: (node: GraphItem) => void;
  onContextMenu?: (node: GraphItem, x: number, y: number) => void;
  wipCount: number;
  truncated: boolean;
  matchSet?: Set<string> | null;
  fileHits?: Map<string, FileHit> | null;
  pipelines?: Record<string, PipelineMark> | null;
  pipelineTips?: Record<string, PipelineTip> | null;
  onPipelineHover?: (pipeline: PipelineMark) => void;
  onPipelineClick?: (pipeline: PipelineMark) => void;
  onCompare?: (hash: string) => void;
  compareMark?: string | null;
  dragSource?: RefDragPayload | null;
  onDragSource?: (payload: RefDragPayload | null) => void;
  onDropOnBranch?: (branches: { name: string; hash: string }[], x: number, y: number, payload: RefDragPayload) => void;
  currentBranch?: string | null;
  refActions?: RefActions | null;
  onCopySha?: (hash: string) => void;
}

const HEADER_HEIGHT = 30;
const OVERSCAN = 15; // запас строк выше и ниже видимой области
const MAX_AUTO_GRAPH_WIDTH = 400; // авто-ширина графа; вручную можно растянуть шире
const MESSAGE_MIN_WIDTH = 140;
const DATE_MIN_WIDTH = 132; // «22.09.2021 01:59» целиком
const INTRO_MS = 1300; // длительность анимации появления графа
const COLUMN_DRAG_TYPE = 'application/x-gitidea-column';
const FIT_SAMPLE = 3000; // сколько строк смотреть при подгонке ширины под содержимое

// Цвета бейджей Conventional Commits: те же, что у чипсов в форме коммита
const CC_COLORS: Record<string, string> = { ...Object.fromEntries(CC_TYPES.map((t) => [t.id, t.color])), build: '#9aa3b2', ci: '#15a0bf', revert: '#f25d2e' };

/* Ширина текста — для подгонки колонки под содержимое по двойному клику */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
const sansFont = () => getComputedStyle(document.body).fontFamily || 'sans-serif';
const monoFont = () => getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';

/** Ширина колонки по содержимому (px) или null, если мерить нечего */
function measureColumn(id: string, sample: GraphItem[], gv: GraphView): number | null {
  const sans = sansFont();
  const mono = monoFont();
  const real = sample.filter((n) => !n.wip && !n.stash);
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

const clampW = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function CommitGraph({
  commits,
  introKey,
  focus = null, // { hash, n } — плавно прокрутить так, чтобы коммит оказался по центру (новый HEAD после checkout)
  selectedHash,
  onSelect,
  onActivate,
  onContextMenu,
  wipCount,
  truncated,
  matchSet = null, // Set хэшей, подходящих под поиск; остальные приглушаются
  fileHits = null, // Map хэш → { files, count } — текст поиска найден в изменениях этих файлов
  pipelines = null, // { [sha]: { id, status } } — статусы пайплайнов CI/CD
  pipelineTips = null, // { [id]: { status, text } } — сводка по заданиям для подсказки
  onPipelineHover,
  onPipelineClick,
  onCompare, // Ctrl+клик: сравнить выбранный коммит с этим
  compareMark = null, // коммит, отмеченный для сравнения
  dragSource = null, // что сейчас перетаскивают (коммит или ветку)
  onDragSource, // начало/конец перетаскивания
  onDropOnBranch, // (ветки строки, x, y, что перетащили) — бросили на строку с веткой
  currentBranch = null,
  refActions = null, // { checkout(ref), deleteRemote(fullName), menu(ref, x, y) } — для поповера «+N»
  onCopySha, // клик по хэшу в колонке SHA
}: CommitGraphProps) {
  const [dropHash, setDropHash] = useState<string | null>(null);
  useEffect(() => {
    if (!dragSource) setDropHash(null);
  }, [dragSource]);
  const { nodes, edges, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const [view, setView] = useState({ top: 0, height: 800, width: 1000 });

  // Вид таблицы: колонки, порядок, плотность, формат даты, стиль узлов
  const [gv, setGv] = useGraphView();
  const m = metricsFor(gv.density);
  const dots = gv.nodeStyle === 'dots';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); // { x, y }
  const closeMenu = useCallback(() => setMenu(null), []);

  // Ширины колонок: тянутся мышью за разделители в заголовке и запоминаются
  const [refsStoredW, setRefsW, saveRefsW, refsStored] = useStoredWidth('graph.refs', 190, 60, 480);
  const [graphW, setGraphW, saveGraphW] = useStoredWidth('graph.graph', null!, 40, 1400); // null = авто
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
  const widthApi: Partial<Record<string, WidthApi>> = {
    refs: [refsW, setRefsW, saveRefsW],
    graph: [graphW, setGraphW, saveGraphW],
    author: [authorW, setAuthorW, saveAuthorW],
    date: [dateW, setDateW, saveDateW],
    sha: [shaW, setShaW, saveShaW],
  };

  // Видимые колонки в выбранном порядке; «Сообщение» видно всегда
  const columns = gv.order.filter((id) => id === 'message' || !gv.hidden.includes(id));
  const has = (id: ColumnId) => columns.includes(id);
  const fixed: Record<string, number> = { refs: refsW, author: authorW, date: dateW, sha: shaW };
  const fixedSum = columns.reduce((sum, id) => sum + (fixed[id] ?? 0), 0);
  // Авто-ширина графа: по числу дорожек, но не больше, чем позволяет место,
  // чтобы остальные колонки оставались видны без горизонтальной прокрутки
  const roomForGraph = view.width - fixedSum - MESSAGE_MIN_WIDTH;
  const autoGraphWidth = Math.max(90, Math.min(graphWidth(laneCount, m), MAX_AUTO_GRAPH_WIDTH, Math.max(120, roomForGraph)));
  // Ширина графа, заданная вручную, не должна выталкивать соседние колонки за правый край
  const width = has('graph') ? Math.max(40, Math.min(graphW ?? autoGraphWidth, roomForGraph)) : 0;
  // Сообщение забирает всё оставшееся место — в том числе от скрытых колонок
  const messageW = Math.max(MESSAGE_MIN_WIDTH, view.width - fixedSum - width);
  const cols: Record<string, number> = { ...fixed, graph: width, message: messageW };
  const offsets: Record<string, number> = {};
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

  // Фактическая ширина колонки «Граф» (ResizeObserver на её заголовке) — по ней пересчитываются x дорожек и узлов:
  // когда колонку сужают, дорожки, которые не помещаются, прижимаются к правому краю (узлы того же размера),
  // и граф не залезает на сообщения коммитов
  const [graphBoxW, graphCellRef] = useElementWidth();
  // Пока колонку тянут, измерение может отстать на кадр — берём меньшее из двух, чтобы граф не вылез за край
  const graphW_ = has('graph') ? Math.min(graphBoxW || width, width) : 0;
  const gm = useMemo(() => fitMetrics(m, laneCount, graphW_, dots ? m.dotR : m.nodeR), [m, laneCount, graphW_, dots]);
  const dotsEff = dots;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoverHash, setHoverHash] = useState<string | null>(null);
  const [intro, setIntro] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [colDrag, setColDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null); // { id, over, after }

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

  // Переход к коммиту (после checkout — к новому HEAD): плавно, по центру видимой области
  const focusDone = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !focus?.hash || focusDone.current === focus.n) return;
    const node = nodes.find((n) => n.hash === focus.hash);
    if (!node) return;
    focusDone.current = focus.n;
    const center = node.row * m.rowH + m.rowH / 2;
    const visible = el.clientHeight - HEADER_HEIGHT;
    el.scrollTo({ top: Math.max(0, center - visible / 2), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, nodes]);

  // Прокручиваем к выбранному коммиту, если он вне экрана
  useEffect(() => {
    const el = scrollRef.current;
    const node = nodes.find((n) => n.hash === selectedHash);
    if (!el || !node) return;
    if (focus?.hash === selectedHash) return; // к нему уже едем по центру (focus)
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const index = nodes.findIndex((n) => n.hash === selectedHash);
    const next = nodes[Math.min(nodes.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) onSelect(next.hash);
  };

  // Двойной клик по разделителю: ширина под содержимое колонки (граф — снова авто)
  const fitWidth = (id: string) => measureColumn(id, nodes.length > FIT_SAMPLE ? nodes.slice(0, FIT_SAMPLE) : nodes, gv);

  const resetLayout = () => {
    for (const [, set, save] of Object.values(widthApi) as WidthApi[]) {
      set(null);
      save(null);
    }
    setGv({ order: DEFAULT_VIEW.order, hidden: DEFAULT_VIEW.hidden });
  };

  const copySha = (hash: string) => {
    onCopySha?.(hash);
    setCopied(hash);
    setTimeout(() => setCopied((h) => (h === hash ? null : h)), 1200);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 animate-fade-in items-center justify-center text-gk-muted">
        {tr('repository-has-no-commits-yet')}</div>
    );
  }

  const introDelay = (row: number) => `${Math.min(Math.max(row - first, 0), 30) * 20}ms`;
  const nodeR = dotsEff ? gm.dotR : gm.nodeR;

  /* Перестановка колонок: перетаскиваем заголовок */
  const headerDrag = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData(COLUMN_DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = 'move';
      setColDrag({ id, over: null, after: false });
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      setColDrag((d) => (d && (d.over !== id || d.after !== after) ? { ...d, over: id, after } : d));
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      const from = e.dataTransfer.getData(COLUMN_DRAG_TYPE);
      if (!from) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      setColDrag(null);
      if (from !== id) setGv((v) => ({ order: moveColumn(v.order, from as ColumnId, id as ColumnId, after) as ColumnId[] }));
    },
    onDragEnd: () => setColDrag(null),
  });

  const openMenuAt = (x: number, y: number) => setMenu({ x, y });

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
            const [, set, save] = api!;
            const w = fitWidth(id);
            save(w === null ? null : set(w));
            if (w === null) set(null);
          };
          return (
            <HeaderCell
              key={id}
              id={id}
              width={cols[id]}
              cellRef={id === 'graph' ? graphCellRef : undefined}
              last={i === columns.length - 1}
              dropSide={colDrag && colDrag.over === id && colDrag.id !== id ? (colDrag.after ? 'after' : 'before') : null}
              dragging={colDrag?.id === id}
              {...headerDrag(id)}
            >
              <span className={`truncate ${id === 'date' ? 'tabular-nums' : ''}`}>{columnById(id)!.label}</span>
              {api && (
                <ResizeHandle
                  width={cols[id]}
                  direction={before ? 1 : -1}
                  onResize={api[1]}
                  onCommit={api[2]}
                  onReset={fit}
                  title={
                    id === 'graph'
                      ? tr('drag-to-change-graph-width')
                      : tr('drag-to-change-width-double')
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
          aria-label={tr('table-view')}
          data-tip={tr('table-view-columns-row-density')}
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
            m={gm}
            columns={columns}
            cols={cols}
            offsets={offsets}
            refsSide={refsSide}
            dateFormat={gv.dateFormat}
            pipeline={pipelines?.[node.hash] ?? null}
            pipelineTip={pipelines?.[node.hash] ? pipelineTips?.[pipelines[node.hash].id] ?? null : null}
            fileHit={fileHits?.get(node.hash) ?? null}
            onPipelineHover={onPipelineHover}
            onPipelineClick={onPipelineClick}
            selected={node.hash === selectedHash}
            hovered={node.hash === hoverHash}
            dim={Boolean(matchSet) && !matchSet!.has(node.hash)}
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
              if (isMod(e) && onCompare && !node.wip && !node.stash) onCompare(node.hash);
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
            className="pointer-events-none absolute top-0 overflow-hidden"
            style={{ left: offsets.graph, width, height }}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMinYMin meet"
            data-testid="graph-svg"
            data-width={Math.round(graphW_)}
            data-hidden-lanes={gm.hiddenLanes ?? 0}
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
                    x1={refsSide === 'left' ? 0 : laneX(n.lane, gm) + nodeR}
                    x2={refsSide === 'left' ? laneX(n.lane, gm) - nodeR : graphW_}
                    y1={rowY(n.row, gm)}
                    y2={rowY(n.row, gm)}
                    stroke={laneColor(n.lane)}
                    strokeWidth={2}
                    strokeOpacity={0.85}
                  />
                ))}

            {visibleEdges.map((edge) => (
              <path
                key={edge.id}
                d={edgePath(edge, gm)}
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

            {/* Справа есть прижатые дорожки — край колонки чуть затенён, узлы поверх */}
            {gm.fitted && (
              <>
                <defs>
                  <linearGradient id="graph-edge-fade" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="var(--gk-base)" stopOpacity="0" />
                    <stop offset="1" stopColor="var(--gk-base)" stopOpacity="0.85" />
                  </linearGradient>
                </defs>
                <rect data-testid="graph-edge-fade" x={gm.maxX! - gm.laneW} y={0} width={graphW_ - gm.maxX! + gm.laneW} height={height} fill="url(#graph-edge-fade)" />
              </>
            )}

            {visibleNodes.map((node) => (
              <Node
                key={node.hash}
                node={node}
                m={gm}
                dots={dotsEff}
                dim={Boolean(matchSet) && !matchSet!.has(node.hash)}
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
          {tj('showing-last-commits', [commits.length.toLocaleString(locale())])}</div>
      )}

      {menu && (
        <GraphViewMenu x={menu.x} y={menu.y} view={gv} onChange={setGv} onResetLayout={resetLayout} onClose={closeMenu} />
      )}
    </div>
  );
}

/* ---------------- Строка ---------------- */

/**
 * Ширина элемента по ResizeObserver: [ширина, callback-ref]. Новое значение применяется синхронно (flushSync),
 * в том же кадре, что и изменение раскладки, — граф не отстаёт от колонки, пока её тянут.
 */
function useElementWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = (entry: ResizeObserverEntry | undefined) => entry?.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width;
    ro.current = new ResizeObserver((entries) => {
      const next = Math.round(read(entries[entries.length - 1]) * 100) / 100;
      flushSync(() => setW((prev) => (Math.abs(prev - next) < 0.5 ? prev : next)));
    });
    ro.current.observe(el);
    setW(Math.round(el.getBoundingClientRect().width * 100) / 100);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [w, ref];
}

type HeaderCellProps = HTMLAttributes<HTMLDivElement> & {
  id: string;
  width: number;
  last: boolean;
  dropSide: 'before' | 'after' | null;
  dragging: boolean;
  cellRef?: (el: HTMLDivElement | null) => void;
};

function HeaderCell({ id, width, last, dropSide, dragging, cellRef, children, ...drag }: HeaderCellProps) {
  return (
    <div
      {...drag}
      ref={cellRef}
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
function MessageText({ node, strong }: { node: GraphItem; strong: boolean | undefined }) {
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
          style={{ color: color!, backgroundColor: `${color}1c`, boxShadow: `inset 0 0 0 1px ${color}55` }}
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
  pipelineTip,
  fileHit,
  onPipelineHover,
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
}: {
  node: GraphItem;
  m: Metrics;
  columns: ColumnId[];
  cols: Record<string, number>;
  offsets: Record<string, number>;
  refsSide: 'left' | 'right' | null;
  dateFormat: string;
  selected: boolean;
  hovered: boolean;
  dim: boolean;
  intro: boolean;
  delay: string;
  wipCount: number;
  pipeline: PipelineMark | null;
  pipelineTip: PipelineTip | null;
  fileHit: FileHit | null;
  onPipelineHover?: (pipeline: PipelineMark) => void;
  onPipelineClick?: (pipeline: PipelineMark) => void;
  onHover: () => void;
  onSelect: (e: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  marked: boolean;
  dropTarget: boolean;
  copied: boolean;
  onCopySha: (hash: string) => void;
  onDragStartRef: (e: DragEvent<HTMLElement>, payload: DragPayload) => void;
  onDragEndRef: () => void;
  onDragOverRow: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeaveRow: () => void;
  onDropRow: (e: DragEvent<HTMLDivElement>) => void;
  currentBranch: string | null | undefined;
  refActions: RefActions | null | undefined;
}) {
  const color = laneColor(node.lane);
  const bandAlpha = isLight() ? (selected ? '30' : hovered ? '1e' : '0c') : selected ? '42' : hovered ? '2a' : '14';
  const compact = m.id === 'compact';
  const bandLeft = columns.includes('graph') ? offsets.graph + Math.min(laneX(node.lane, m), cols.graph) : offsets.message;

  const cell = (id: string) => {
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
              <span data-tip={kb(tr('marked-for-comparison-ctrl-click'))} className="shrink-0 rounded bg-gk-blue/20 px-1.5 text-[10px] font-medium text-gk-blue">
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
            {node.stash ? (
              <span className="flex min-w-0 items-center gap-2 text-gk-muted" data-testid="graph-stash" data-tip={node.description}>
                <span className="flex shrink-0 items-center gap-1 rounded bg-gk-fg/[0.07] border border-dashed border-gk-fg/30 px-1.5 text-[11px] text-gk-text">
                  <Archive size={11} />
                  Stash
                </span>
                <span className="truncate italic">{node.message}</span>
              </span>
            ) : node.wip ? (
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
                    data-tip={tr('found-in-changes', fileHit.files
                      .slice(0, 8)
                      .map((f) => `${f.path} — ${f.count}`)
                      .join('\n'), fileHit.files.length > 8 || fileHit.moreFiles ? '\n…' : '')}
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
                    onMouseEnter={() => onPipelineHover?.(pipeline)}
                    data-testid="pipeline-badge"
                    data-status={pipeline.status}
                    data-tip={tr('pipeline-click', pipeline.id, statusInfo(pipeline.status).label, pipelineTip && pipelineTip.status === pipeline.status && pipelineTip.text ? `\n${pipelineTip.text}` : '', pipeline.status === 'failed' ? tr('log-of-failed-job') : tr('details'))}
                    data-tip-wide
                    className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-125"
                  >
                    <StatusIcon status={pipeline.status} size={15} title="" />
                  </button>
                )}
              </>
            )}
          </div>
        );
      case 'sha':
        return (
          <div key={id} data-col="sha" style={{ width: cols.sha }} className="relative flex shrink-0 items-center overflow-hidden px-2.5">
            {node.stash ? (
              <span className="truncate px-1 font-mono text-[12px] text-gk-dim">{node.stash.id}</span>
            ) : !node.wip && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => onCopySha(node.hash)}
                data-tip={tr('click-copy', node.hash)}
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
            data-tip={node.wip || node.stash ? undefined : `${node.author.name} <${node.author.email}>`}
            className={`relative flex shrink-0 items-center overflow-hidden px-3 text-gk-text/90 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}
          >
            {!node.wip && !node.stash && <span className="truncate">{node.author.name}</span>}
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
      draggable={!node.wip && !node.stash}
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
function groupRefs(refs: GraphRef[]): RefGroup[] {
  const groups: RefGroup[] = [];
  const used = new Set<GraphRef>();
  // Сначала локальные ветки: иначе origin/x, стоящий в списке раньше x, не склеится с ней («x +1»)
  const order = (r: GraphRef) => (r.type === 'local' ? 0 : r.type === 'remote' ? 1 : 2);
  const sorted = refs.filter((r) => !(r.type === 'remote' && r.name.endsWith('/HEAD'))).sort((a, b) => order(a) - order(b) || (b.head ? 1 : 0) - (a.head ? 1 : 0));
  for (const ref of sorted) {
    if (used.has(ref)) continue;
    if (ref.type === 'local') {
      // Серверная ветка с тем же именем на этом же коммите — значит, синхронизированы
      const remote = refs.find((r) => r.type === 'remote' && !used.has(r) && r.name.slice(r.name.indexOf('/') + 1) === ref.name);
      if (remote) used.add(remote);
      groups.push({ name: ref.name, head: ref.head as boolean, local: true, remote: Boolean(remote), remoteName: (remote?.name ?? null) as string, tag: false, all: [ref, remote].filter(Boolean) as GraphRef[] });
    } else if (ref.type === 'remote') {
      groups.push({ name: ref.name, local: false, remote: true, remoteName: ref.name, tag: false, all: [ref] });
    } else {
      groups.push({ name: ref.name, local: false, remote: false, tag: true, all: [ref] });
    }
    used.add(ref);
  }
  return groups;
}

interface RefLabelsProps {
  refs: GraphRef[];
  color: string;
  onDragStart: (e: DragEvent<HTMLSpanElement>, group: RefGroup) => void;
  currentBranch: string | null | undefined;
  actions: RefActions | null | undefined;
  compact?: boolean;
  connector?: boolean;
}

function RefLabels({ refs, color, onDragStart, currentBranch, actions, compact = false, connector = true }: RefLabelsProps) {
  const pop = useHoverPopover();
  const [expanded, setExpanded] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
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
          actions.menu(first.tag ? { type: 'tag', name: first.name } : first.local ? { type: 'local', name: first.name } : { type: 'remote', name: first.remoteName! }, e.clientX, e.clientY);
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
          actions.checkout(first.local ? { type: 'local', name: first.name } : { type: 'remote', name: first.remoteName! });
        }}
        data-tip={`${first.remoteName && !first.local ? first.remoteName : first.name} — ${refKindLabel(first)}${rest.length ? tr('more-hover-over', rest.length, rest.length) : ''}${draggable ? tr('double-click-drag-onto-another', first.local ? tr('switch-to-branch') : tr('create-local-branch-and-switch')) : ''}`}
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
            currentBranch={currentBranch as string | null}
            actions={
              (actions && {
                checkout: (r) => {
                  pop.close();
                  actions.checkout!(r);
                },
                deleteRemote: (n) => {
                  pop.close();
                  actions.deleteRemote!(n);
                },
                menu: (r, x, y) => {
                  pop.close();
                  actions.menu!(r, x, y);
                },
              }) as RefActions | undefined
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

function useAvatar(email: string): [string | null, () => void] {
  const [url, setUrl] = useState<string | null>(null);
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
function HeadRing({ x, y, r }: { x: number; y: number; r: number }) {
  return <circle cx={x} cy={y} r={r - 1} fill="none" style={{ stroke: 'var(--color-gk-green)' }} strokeOpacity={0.85} strokeWidth={1.5} />;
}

function HeadPill({ detached = false, compact = false }: { detached?: boolean; compact?: boolean }) {
  return (
    <span
      data-tip={detached ? tr('head-detached-current-commit-without') : tr('head-current-commit')}
      className={`mr-2 flex shrink-0 items-center rounded bg-gk-green/20 px-1.5 text-[10px] font-bold tracking-wider text-gk-green ring-1 ring-gk-green/50 ${
        compact ? 'h-[16px]' : 'h-[18px]'
      }`}
    >
      HEAD{detached ? ' ⚠' : ''}
    </span>
  );
}

function Node({ node, m, dots, selected, hovered, dim, intro, delay }: { node: GraphItem; m: Metrics; dots: boolean; selected: boolean; hovered: boolean; dim: boolean; intro: boolean; delay: string }) {
  const x = laneX(node.lane, m);
  const y = rowY(node.row, m);
  const color = laneColor(node.lane);
  const cls = `graph-node ${intro ? 'is-intro' : ''} ${hovered ? 'is-hover' : ''}`;
  const style = { ...(intro ? { animationDelay: delay } : null), opacity: dim && !selected ? 0.3 : 1, transition: 'opacity 150ms' };

  // Stash — пунктирный квадрат с «коробкой» внутри (как в GitKraken)
  if (node.stash) {
    const h = dots ? m.dotR + 1.5 : m.nodeR - 2;
    return (
      <g className={cls} style={style} data-node="stash">
        {selected && <rect x={x - h - 2.5} y={y - h - 2.5} width={(h + 2.5) * 2} height={(h + 2.5) * 2} rx={4} fill="none" stroke={color} strokeWidth={1.5} />}
        <rect x={x - h} y={y - h} width={h * 2} height={h * 2} rx={3} style={{ fill: 'var(--gk-solid)' }} stroke={color} strokeWidth={2} strokeDasharray={dots ? '2 2' : '3 2.5'} />
        {!dots && (
          <g stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <rect x={x - h * 0.5} y={y - h * 0.45} width={h} height={h * 0.32} rx={0.8} />
            <path d={`M ${x - h * 0.4} ${y - h * 0.13} V ${y + h * 0.5} H ${x + h * 0.4} V ${y - h * 0.13} M ${x - h * 0.15} ${y + h * 0.12} H ${x + h * 0.15}`} />
          </g>
        )}
      </g>
    );
  }

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

function AvatarNode({ node, x, y, r, color, selected, cls, style }: { node: GraphItem; x: number; y: number; r: number; color: string; selected: boolean; cls: string; style: CSSProperties }) {
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
