import { DEFAULT_LANES, laneColors } from './scheme.ts';

export const GRAPH_PADDING = 10;

export type DensityId = 'compact' | 'standard' | 'relaxed';

/** Размеры одной плотности строк. */
export interface Density {
  id: DensityId;
  rowH: number;
  nodeR: number;
  dotR: number;
  laneW: number;
}

/** Плотность, подогнанная под ширину колонки ([`fitMetrics`]): правый край и сколько дорожек за ним. */
export interface Metrics extends Density {
  maxX?: number;
  visibleLanes?: number;
  hiddenLanes?: number;
  fitted?: boolean;
  /** Шаг дорожек ужат (`squeeze`): узлы-аватары перекрывались бы — рисовать точки */
  forceDots?: boolean;
}

/**
 * Размеры графа для каждой плотности строк: высота строки, радиус узла-аватара,
 * радиус узла-точки и шаг дорожек. Всё рисование графа берёт числа отсюда,
 * поэтому смена плотности синхронно меняет и строки, и узлы, и линии.
 */
export const DENSITIES: Record<DensityId, Density> = {
  compact: { id: 'compact', rowH: 26, nodeR: 9, dotR: 4.5, laneW: 22 },
  standard: { id: 'standard', rowH: 34, nodeR: 13, dotR: 5.5, laneW: 28 },
  relaxed: { id: 'relaxed', rowH: 42, nodeR: 15, dotR: 6.5, laneW: 32 },
};
export const DEFAULT_METRICS: Metrics = DENSITIES.standard;
/** Неизвестная плотность (старая настройка, не строка) — стандартная. */
export const metricsFor = (density: unknown): Metrics => DENSITIES[density as DensityId] ?? DEFAULT_METRICS;

// Для старого кода: размеры стандартной плотности
export const ROW_HEIGHT = DEFAULT_METRICS.rowH;
export const LANE_WIDTH = DEFAULT_METRICS.laneW;
export const NODE_RADIUS = DEFAULT_METRICS.nodeR;

// Цвета дорожек зависят от темы (scheme.ts): в светлой — темнее, чтобы линии не терялись на белом
export const LANE_COLORS = DEFAULT_LANES;

export const laneColor = (lane: number): string => {
  const lanes = laneColors();
  return lanes[lane % lanes.length];
};
// maxX — правый край узкой колонки (см. fitMetrics): дорожки, которые не помещаются, прижимаются к нему, как в GitKraken
export const laneX = (lane: number, m: Metrics = DEFAULT_METRICS): number => Math.min(GRAPH_PADDING + lane * m.laneW + m.laneW / 2, m.maxX ?? Infinity);
export const rowY = (row: number, m: Metrics = DEFAULT_METRICS): number => row * m.rowH + m.rowH / 2;

/** То, что раскладке нужно от коммита: `Commit` из 2.0 и строка WIP интерфейса (`wip: true`). */
export interface LayoutCommit {
  hash: string;
  parents: readonly string[];
  wip?: boolean;
  /** Строка stash (`graphStash.ts`): линия к её коммиту пунктирная, как у WIP */
  stash?: unknown;
}

export type GraphNode<T extends LayoutCommit> = T & { row: number; lane: number };

export interface GraphEdge<T extends LayoutCommit> {
  id: string;
  from: GraphNode<T>;
  to: GraphNode<T>;
  /** Дорожка, по которой ребро идёт вниз. */
  travel: number;
  minRow: number;
  maxRow: number;
  dashed: boolean;
  color: string;
}

/** «Хвост» — линия к родителю за пределами загруженной истории: от узла по дорожке travel до нижнего края графа. */
export interface GraphTail<T extends LayoutCommit> {
  id: string;
  from: GraphNode<T>;
  travel: number;
  color: string;
  dashed: boolean;
}

/**
 * «Рельс» главной ветки: её дорожка продолжается ниже точки, где цепочка ветки ушла в общую историю с другой главной
 * веткой (ветвление, перемотка или одна вершина у двух веток). От узла `from` (на чужой дорожке) линия уходит в дорожку
 * `lane` и идёт вниз до корня `to` (поворачивает к нему) или, если история загружена не вся (`to` — null), до края графа.
 * Так главные ветки не сливаются в одну линию: у каждой своя дорожка на всю высоту.
 */
export interface GraphRail<T extends LayoutCommit> {
  id: string;
  lane: number;
  from: GraphNode<T>;
  to: GraphNode<T> | null;
  color: string;
}

export interface GraphLayout<T extends LayoutCommit> {
  nodes: GraphNode<T>[];
  edges: GraphEdge<T>[];
  /** Линии к незагруженным родителям (рёбер для них нет, дорожка занята до конца графа) */
  tails: GraphTail<T>[];
  laneCount: number;
  /** Только при непустом `pinned`: дорожка каждой главной ветки по порядку `pinned` (-1 — вершина не загружена) */
  pinnedLanes?: number[];
  /** Только при непустом `pinned`: продолжения дорожек главных веток ниже общей истории (`GraphRail`) */
  rails?: GraphRail<T>[];
}

interface PendingEdge {
  from: string;
  to: string;
  travel: number;
  primary: boolean;
}

/** Параметры раскладки. Без них (или с пустым `pinned`) результат прежний. */
export interface LayoutOptions {
  /** Хэши вершин главных веток по порядку дорожек (`mainBranches.ts`): каждая получает свою дорожку слева на всю высоту */
  pinned?: readonly string[];
}

// Первая свободная дорожка, не левее from (дорожки левее from закреплены за главными ветками)
function takeFreeLane(lanes: (string | null)[], from = 0): number {
  const free = lanes.indexOf(null, from);
  return free === -1 ? Math.max(lanes.length, from) : free;
}

/**
 * Цепочки главных веток. Каждая загруженная вершина получает свою дорожку — по порядку `pinned`, даже если у двух веток
 * одна вершина или одна ветка — предок другой: главные ветки не сливаются в одну линию, место каждой задаёт пользователь.
 * Незагруженная вершина дорожку не получает, следующие сдвигаются.
 *
 * Коммит, общий для нескольких цепочек первых родителей, стоит на одной дорожке. Цепочки занимают коммиты по очереди:
 * ветка, чья вершина лежит на цепочке другой (отстала от неё или влита в неё перемоткой), идёт раньше этой другой, —
 * тогда у неё остаётся своя история, а у ушедшей вперёд — только новые коммиты, и её линия поворачивает к вершине
 * отставшей. В остальном очередь — порядок `pinned`: ниже точки ветвления общая история достаётся ветке левее.
 *
 * `tips[i]` — вершина дорожки i, `lanes[j]` — дорожка j-го элемента `pinned`.
 */
function pinnedChains(commits: readonly LayoutCommit[], pinned: readonly string[] | undefined) {
  const chainLane = new Map<string, number>();
  const tips: string[] = [];
  const lanes: number[] = [];
  if (!pinned?.length) return { chainLane, tips, lanes };
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  for (const tip of pinned) {
    lanes.push(byHash.has(tip) ? tips.length : -1);
    if (byHash.has(tip)) tips.push(tip);
  }
  // Полная цепочка каждой вершины — чтобы узнать, чья вершина лежит на чьей цепочке
  const chainOf = tips.map((tip) => {
    const set = new Set<string>();
    for (let hash: string | undefined = tip; hash !== undefined && byHash.has(hash) && !set.has(hash); hash = byHash.get(hash)!.parents[0]) set.add(hash);
    return set;
  });
  // Очередь: первая по порядку дорожка, на цепочке которой нет вершины другой ещё не вставшей в очередь дорожки
  const waiting = tips.map((_, i) => i);
  while (waiting.length) {
    const at = waiting.findIndex((i) => !waiting.some((j) => j !== i && tips[j] !== tips[i] && chainOf[i].has(tips[j])));
    const [lane] = waiting.splice(at === -1 ? 0 : at, 1);
    for (let hash: string | undefined = tips[lane]; hash !== undefined && byHash.has(hash) && !chainLane.has(hash); hash = byHash.get(hash)!.parents[0]) {
      chainLane.set(hash, lane);
    }
  }
  return { chainLane, tips, lanes };
}

/**
 * Раскладывает коммиты (от новых к старым) по дорожкам — жадно, с переиспользованием колонок.
 * lanes[col] — хэш коммита, который «ждёт» колонка (null — свободна).
 *  - коммит встаёт в самую левую колонку, которая его ждёт; остальные такие колонки здесь сходятся и освобождаются;
 *  - новая ветка занимает первую свободную колонку слева;
 *  - первый родитель продолжает колонку коммита (ровная линия ветки);
 *  - второй и следующие родители (мердж) идут в колонку, где их уже ждут, иначе — в первую свободную.
 * Каждое ребро запоминает колонку, по которой идёт вниз (travel), поэтому линии не пересекают чужие узлы.
 * Порядок коммитов важен: git log --date-order (родители всегда ниже детей, параллельные ветки
 * перемежаются по времени) — тогда мерджи короткие и колонки быстро освобождаются.
 *
 * Главные ветки (`options.pinned`): дорожки 0…k-1 закреплены за цепочками первых родителей их вершин на всю высоту
 * (`pinnedChains`: у каждой ветки своя дорожка, ветки не сливаются). Коммит цепочки всегда стоит на своей дорожке, остальные ветки берут дорожки начиная с k. Строка WIP встаёт в дорожку,
 * которая уже ждёт её родителя, — над вершиной главной ветки, а не сбоку.
 */
export function layoutGraph<T extends LayoutCommit>(commits: readonly T[], options?: LayoutOptions): GraphLayout<T> {
  if (commits.some((c) => c.stash)) return layoutWithStashes(commits, options);
  const { chainLane, tips, lanes: pinnedLanes } = pinnedChains(commits, options?.pinned);
  const k = tips.length;
  // Закреплённые дорожки с самого верха ждут вершины своих веток
  const lanes: (string | null)[] = [...tips];
  const pending: PendingEdge[] = [];
  let laneCount = Math.max(1, k);

  const nodes = commits.map((commit, row): GraphNode<T> => {
    const chain = chainLane.get(commit.hash);
    let lane = chain ?? lanes.indexOf(commit.hash);
    if (lane === -1 && k && commit.wip && commit.parents[0] !== undefined) lane = lanes.indexOf(commit.parents[0]);
    if (lane === -1) lane = takeFreeLane(lanes, k);

    // Остальные дорожки, ждавшие этот коммит, здесь сходятся и освобождаются
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) lanes[i] = null;
    }

    const [firstParent, ...otherParents] = commit.parents;
    if (!firstParent) {
      lanes[lane] = null; // начальный коммит — дорожка свободна
    } else {
      // Первый родитель продолжает дорожку прямой линией. Исключение: его уже ждёт дорожка левее —
      // тогда ветвь сразу уходит туда, а наша колонка освобождается для других веток ниже.
      // Цепочка главной ветки всегда продолжает свою дорожку (и до коммита другой главной ветки — тоже)
      const waitingLeft = chain === undefined ? lanes.findIndex((h, i) => h === firstParent && i < lane) : -1;
      if (waitingLeft !== -1) {
        lanes[lane] = null;
        pending.push({ from: commit.hash, to: firstParent, travel: waitingLeft, primary: true });
      } else {
        lanes[lane] = firstParent;
        pending.push({ from: commit.hash, to: firstParent, travel: lane, primary: true });
      }
    }

    for (const parent of otherParents) {
      let travel = lanes.indexOf(parent);
      if (travel === -1) {
        travel = takeFreeLane(lanes, k);
        lanes[travel] = parent;
      }
      pending.push({ from: commit.hash, to: parent, travel, primary: false });
    }

    laneCount = Math.max(laneCount, lanes.length, lane + 1);
    while (lanes.length > k && lanes[lanes.length - 1] === null) lanes.pop();

    return { ...commit, row, lane };
  });

  const byHash = new Map(nodes.map((n) => [n.hash, n]));
  const edges: GraphEdge<T>[] = [];
  const tails: GraphTail<T>[] = [];
  for (const p of pending) {
    const from = byHash.get(p.from);
    const to = byHash.get(p.to);
    if (!from) continue;
    if (!to) {
      // Родитель за пределами загруженной истории: линия уходит вниз по своей дорожке до края графа
      tails.push({ id: `${p.from}->${p.to}`, from, travel: p.travel, color: laneColor(p.travel), dashed: Boolean(from.wip || from.stash) });
      continue;
    }
    edges.push({
      id: `${p.from}->${p.to}`,
      from,
      to,
      travel: p.travel,
      minRow: from.row,
      maxRow: to.row,
      dashed: Boolean(from.wip || from.stash),
      color: laneColor(p.travel),
    });
  }

  if (!options?.pinned?.length) return { nodes, edges, tails, laneCount };
  return { nodes, edges, tails, laneCount, pinnedLanes, rails: pinnedRails(tips, chainLane, byHash) };
}

/**
 * Рельсы главных веток (`GraphRail`). Дорожка L занимает коммиты своей цепочки первых родителей, пока они её; первый
 * же коммит цепочки, отданный другой главной ветке (общая история), — точка схода. Ниже неё дорожка L никем не занята
 * (закреплённые дорожки ждут только свои цепочки), поэтому её линия продолжается вниз до корня или до края графа.
 * Цепочка кончилась своим корнем или незагруженным родителем — рельс не нужен: линия и так идёт до конца.
 */
function pinnedRails<T extends LayoutCommit>(tips: readonly string[], chainLane: ReadonlyMap<string, number>, byHash: ReadonlyMap<string, GraphNode<T>>): GraphRail<T>[] {
  const rails: GraphRail<T>[] = [];
  tips.forEach((tip, lane) => {
    let hash: string | undefined = tip;
    while (hash !== undefined && byHash.has(hash) && chainLane.get(hash) === lane) hash = byHash.get(hash)!.parents[0];
    const from = hash === undefined ? undefined : byHash.get(hash);
    if (!from) return;
    // Конец общей истории: корень (рельс поворачивает к нему) или незагруженный родитель (рельс до края графа)
    let end = from;
    const seen = new Set<string>();
    while (end.parents[0] !== undefined && byHash.has(end.parents[0]) && !seen.has(end.hash)) {
      seen.add(end.hash);
      end = byHash.get(end.parents[0])!;
    }
    const to = end.parents[0] === undefined ? end : null;
    if (to === from) return;
    rails.push({ id: `rail:${lane}:${from.hash}`, lane, from, to, color: laneColor(lane) });
  });
  return rails;
}

/**
 * Занятые строки дорожек — для подбора дорожки stash. Интервал [a, b] занимает строки a…b; ребро занимает строки строго
 * между концами ([minRow + 1, maxRow - 1], у соседних строк a > b), хвост — от строки под узлом до конца графа. Пересечение
 * с [top, bottom]: a <= bottom && b >= top — те же границы, что у прежнего перебора всех узлов и рёбер. Интервалы дорожки
 * отсортированы по a, `maxB[i]` — наибольший b среди первых i + 1: проверка — двоичный поиск.
 */
class LaneIntervals {
  private lanes = new Map<number, { a: number[]; maxB: number[] }>();

  constructor(items: Iterable<[lane: number, a: number, b: number]>) {
    const raw = new Map<number, [number, number][]>();
    for (const [lane, a, b] of items) {
      const list = raw.get(lane);
      if (list) list.push([a, b]);
      else raw.set(lane, [[a, b]]);
    }
    for (const [lane, list] of raw) {
      list.sort((x, y) => x[0] - y[0]);
      const a = list.map((x) => x[0]);
      const maxB: number[] = [];
      let best = -Infinity;
      for (const [, b] of list) maxB.push((best = Math.max(best, b)));
      this.lanes.set(lane, { a, maxB });
    }
  }

  busy(lane: number, top: number, bottom: number): boolean {
    const l = this.lanes.get(lane);
    if (!l) return false;
    // Последний интервал с a <= bottom
    let lo = 0;
    let hi = l.a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (l.a[mid] <= bottom) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && l.maxB[lo - 1] >= top;
  }
}

/**
 * Раскладка со строками stash (`graphStash.ts`), как в GitKraken: коммиты раскладываются как обычно (stash не сдвигает
 * ветки), затем каждый stash получает первую дорожку правее своего коммита, свободную на всём пути от строки stash до
 * коммита: там нет ни узла, ни вертикали чужого ребра, ни другого stash. Пунктир идёт вниз по этой дорожке и у коммита
 * поворачивает к нему.
 */
function layoutWithStashes<T extends LayoutCommit>(commits: readonly T[], options?: LayoutOptions): GraphLayout<T> {
  const real = commits.filter((c) => !c.stash);
  const base = layoutGraph(real, options);
  // Закреплённые дорожки главных веток stash не занимает
  const k = pinnedChains(real, options?.pinned).tips.length;
  const rowOf = new Map(commits.map((c, i) => [c.hash, i]));
  const byHash = new Map(base.nodes.map((n): [string, GraphNode<T>] => [n.hash, { ...n, row: rowOf.get(n.hash)! }]));
  const edges: GraphEdge<T>[] = base.edges.map((e) => {
    const from = byHash.get(e.from.hash)!;
    const to = byHash.get(e.to.hash)!;
    return { ...e, from, to, minRow: from.row, maxRow: to.row };
  });
  const tails: GraphTail<T>[] = base.tails.map((t) => ({ ...t, from: byHash.get(t.from.hash)! }));
  const rails = base.rails?.map((r): GraphRail<T> => ({ ...r, from: byHash.get(r.from.hash)!, to: r.to && byHash.get(r.to.hash)! }));
  const nodes = [...byHash.values()];
  // Занятость дорожек строится один раз; размещённые stash (их единицы) проверяются перебором
  const taken = new LaneIntervals(
    (function* () {
      for (const n of nodes) yield [n.lane, n.row, n.row] as [number, number, number];
      for (const e of edges) yield [e.travel, e.minRow + 1, e.maxRow - 1] as [number, number, number];
      for (const t of tails) yield [t.travel, t.from.row + 1, Infinity] as [number, number, number];
    })(),
  );
  const side: { lane: number; top: number; bottom: number }[] = [];
  const busy = (lane: number, top: number, bottom: number) =>
    taken.busy(lane, top, bottom) || side.some((x) => x.lane === lane && x.bottom >= top && x.top <= bottom);

  let laneCount = base.laneCount;
  const out = commits.map((commit, row): GraphNode<T> => {
    if (!commit.stash) return byHash.get(commit.hash)!;
    const target = byHash.get(commit.parents[0]);
    let lane = Math.max(target ? target.lane + 1 : 0, k);
    const bottom = target?.row ?? row;
    while (busy(lane, row, bottom)) lane++;
    side.push({ lane, top: row, bottom });
    laneCount = Math.max(laneCount, lane + 1);
    const node: GraphNode<T> = { ...commit, row, lane };
    if (target) {
      edges.push({ id: `${commit.hash}->${target.hash}`, from: node, to: target, travel: lane, minRow: row, maxRow: target.row, dashed: true, color: laneColor(lane) });
    }
    return node;
  });
  return { ...base, nodes: out, edges, tails, laneCount, ...(rails ? { rails } : null) };
}

/** Ребру для пути нужны только положения концов и дорожка. */
export interface EdgeGeometry {
  from: { lane: number; row: number };
  to: { lane: number; row: number };
  travel: number;
}

/**
 * Рёбра в стиле GitKraken: вертикали по дорожкам и горизонтальные «перемычки»
 * на уровне узлов со скруглёнными углами.
 *  - ветка отходит от родителя: идём вниз по своей дорожке, у родителя поворачиваем к нему;
 *  - мердж: от узла сразу уходим вбок в дорожку второго родителя и спускаемся по ней.
 */
export function edgePath(edge: EdgeGeometry, m: Metrics = DEFAULT_METRICS): string {
  const x1 = laneX(edge.from.lane, m);
  const y1 = rowY(edge.from.row, m);
  const x2 = laneX(edge.to.lane, m);
  const y2 = rowY(edge.to.row, m);
  const xt = laneX(edge.travel, m);

  if (x1 === x2 && x1 === xt) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const radius = (dx: number) => Math.min(m.rowH * 0.3, Math.abs(dx) / 2, (y2 - y1) / 2);
  let d = `M ${x1} ${y1}`;

  // 1) горизонталь на уровне дочернего узла до дорожки ребра
  if (xt !== x1) {
    const r = radius(xt - x1);
    const dir = Math.sign(xt - x1);
    d += ` L ${xt - dir * r} ${y1} Q ${xt} ${y1} ${xt} ${y1 + r}`;
  }

  // 2) вертикаль по дорожке и 3) горизонталь на уровне родителя
  if (xt !== x2) {
    const r = radius(x2 - xt);
    const dir = Math.sign(x2 - xt);
    d += ` L ${xt} ${y2 - r} Q ${xt} ${y2} ${xt + dir * r} ${y2} L ${x2} ${y2}`;
  } else {
    d += ` L ${x2} ${y2}`;
  }
  return d;
}

export function graphWidth(laneCount: number, m: Metrics = DEFAULT_METRICS): number {
  return GRAPH_PADDING * 2 + laneCount * m.laneW;
}

/**
 * Метрики графа под фактическую ширину колонки «Граф». Размер узлов и шаг дорожек не меняются:
 * если все дорожки не помещаются, те, что правее края, прижимаются к нему и двигаются вместе с границей колонки
 * (узлы и линии), как в GitKraken. maxX — x прижатых узлов (узел с кольцом HEAD целиком виден).
 */
export function fitMetrics(m: Metrics, laneCount: number, width: number, nodeR: number = m.nodeR, options?: { squeeze?: boolean }): Metrics {
  const lanes = Math.max(1, laneCount);
  if (!(width > 0) || graphWidth(lanes, m) <= width) return m;
  if (options?.squeeze) {
    // Сначала ужимается шаг дорожек — до того, при котором видны все, но не меньше 2 * dotR + 4; к краю прижимаются,
    // только если и этого мало. Аватары при узком шаге перекрывались бы — тогда точки (forceDots)
    const minLaneW = 2 * m.dotR + 4;
    const laneW = Math.max(minLaneW, (width - GRAPH_PADDING * 2) / lanes);
    const squeezed: Metrics = { ...m, laneW, ...(laneW < 2 * m.nodeR + 2 ? { forceDots: true } : null) };
    if (graphWidth(lanes, squeezed) <= width) return squeezed;
    return fitMetrics(squeezed, lanes, width, squeezed.forceDots ? Math.min(nodeR, m.dotR) : nodeR);
  }
  const first = GRAPH_PADDING + m.laneW / 2;
  // Край колонки «толкает» дорожки плавно: x прижатых дорожек следует за границей пиксель в пиксель,
  // а дорожки левее края остаются на своих местах, пока граница до них не дойдёт
  const maxX = Math.max(first, width - Math.max(nodeR + 5, m.laneW / 2));
  const visibleLanes = Math.max(1, Math.floor((maxX - first) / m.laneW) + 1);
  return { ...m, maxX, visibleLanes, hiddenLanes: lanes - visibleLanes, fitted: true };
}
