import { DEFAULT_LANES, laneColors } from './scheme.js';

export const GRAPH_PADDING = 10;

/**
 * Размеры графа для каждой плотности строк: высота строки, радиус узла-аватара,
 * радиус узла-точки и шаг дорожек. Всё рисование графа берёт числа отсюда,
 * поэтому смена плотности синхронно меняет и строки, и узлы, и линии.
 */
export const DENSITIES = {
  compact: { id: 'compact', rowH: 26, nodeR: 9, dotR: 4.5, laneW: 22 },
  standard: { id: 'standard', rowH: 34, nodeR: 13, dotR: 5.5, laneW: 28 },
  relaxed: { id: 'relaxed', rowH: 42, nodeR: 15, dotR: 6.5, laneW: 32 },
};
export const DEFAULT_METRICS = DENSITIES.standard;
export const metricsFor = (density) => DENSITIES[density] ?? DEFAULT_METRICS;

// Для старого кода: размеры стандартной плотности
export const ROW_HEIGHT = DEFAULT_METRICS.rowH;
export const LANE_WIDTH = DEFAULT_METRICS.laneW;
export const NODE_RADIUS = DEFAULT_METRICS.nodeR;

// Цвета дорожек зависят от темы (scheme.js): в светлой — темнее, чтобы линии не терялись на белом
export const LANE_COLORS = DEFAULT_LANES;

export const laneColor = (lane) => {
  const lanes = laneColors();
  return lanes[lane % lanes.length];
};
export const laneX = (lane, m = DEFAULT_METRICS) => GRAPH_PADDING + lane * m.laneW + m.laneW / 2;
export const rowY = (row, m = DEFAULT_METRICS) => row * m.rowH + m.rowH / 2;

function takeFreeLane(lanes) {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
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
 */
export function layoutGraph(commits) {
  const lanes = [];
  const pending = [];
  let laneCount = 1;

  const nodes = commits.map((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) lane = takeFreeLane(lanes);

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
      const waitingLeft = lanes.findIndex((h, i) => h === firstParent && i < lane);
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
        travel = takeFreeLane(lanes);
        lanes[travel] = parent;
      }
      pending.push({ from: commit.hash, to: parent, travel, primary: false });
    }

    laneCount = Math.max(laneCount, lanes.length, lane + 1);
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    return { ...commit, row, lane };
  });

  const byHash = new Map(nodes.map((n) => [n.hash, n]));
  const edges = [];
  for (const p of pending) {
    const from = byHash.get(p.from);
    const to = byHash.get(p.to);
    if (!from || !to) continue; // родитель за пределами загруженной истории
    edges.push({
      id: `${p.from}->${p.to}`,
      from,
      to,
      travel: p.travel,
      minRow: from.row,
      maxRow: to.row,
      dashed: Boolean(from.wip),
      color: laneColor(p.travel),
    });
  }

  return { nodes, edges, laneCount };
}

/**
 * Рёбра в стиле GitKraken: вертикали по дорожкам и горизонтальные «перемычки»
 * на уровне узлов со скруглёнными углами.
 *  - ветка отходит от родителя: идём вниз по своей дорожке, у родителя поворачиваем к нему;
 *  - мердж: от узла сразу уходим вбок в дорожку второго родителя и спускаемся по ней.
 */
export function edgePath(edge, m = DEFAULT_METRICS) {
  const x1 = laneX(edge.from.lane, m);
  const y1 = rowY(edge.from.row, m);
  const x2 = laneX(edge.to.lane, m);
  const y2 = rowY(edge.to.row, m);
  const xt = laneX(edge.travel, m);

  if (x1 === x2 && x1 === xt) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const radius = (dx) => Math.min(m.rowH * 0.3, Math.abs(dx) / 2, (y2 - y1) / 2);
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

export function graphWidth(laneCount, m = DEFAULT_METRICS) {
  return GRAPH_PADDING * 2 + laneCount * m.laneW;
}
