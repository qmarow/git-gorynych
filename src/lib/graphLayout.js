export const ROW_HEIGHT = 34;
export const LANE_WIDTH = 26;
export const GRAPH_PADDING = 10;
export const NODE_RADIUS = 12;

// Цвета дорожек в духе GitKraken
export const LANE_COLORS = [
  '#15a0bf',
  '#0669f7',
  '#8e00c2',
  '#c517b6',
  '#d90171',
  '#cd0101',
  '#f25d2e',
  '#f2ca33',
  '#7bd938',
  '#2ece9d',
];

export const laneColor = (lane) => LANE_COLORS[lane % LANE_COLORS.length];
export const laneX = (lane) => GRAPH_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
export const rowY = (row) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

function takeFreeLane(lanes) {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
}

/**
 * Раскладывает коммиты (от новых к старым, topo-order) по дорожкам.
 * Каждая дорожка «ждёт» хэш следующего коммита. Каждое ребро запоминает
 * дорожку, по которой оно идёт вниз (travel), поэтому линии не пересекают
 * чужие узлы.
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
    lanes[lane] = firstParent ?? null;
    if (firstParent) pending.push({ from: commit.hash, to: firstParent, travel: lane, primary: true });

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
export function edgePath(edge) {
  const x1 = laneX(edge.from.lane);
  const y1 = rowY(edge.from.row);
  const x2 = laneX(edge.to.lane);
  const y2 = rowY(edge.to.row);
  const xt = laneX(edge.travel);

  if (x1 === x2 && x1 === xt) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const radius = (dx) => Math.min(10, Math.abs(dx) / 2, (y2 - y1) / 2);
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

export function graphWidth(laneCount) {
  return GRAPH_PADDING * 2 + laneCount * LANE_WIDTH;
}
