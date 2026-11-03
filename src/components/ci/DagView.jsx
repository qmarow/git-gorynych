// Граф выполнения пайплайна (DAG): какие задания идут параллельно, а какие ждут других.
// needs — явные зависимости (сплошные стрелки); без needs задание GitLab ждёт весь предыдущий этап (пунктир).
import { useMemo, useState } from 'react';
import { Hand } from 'lucide-react';
import { tj } from '../../i18n/index.js';

const W = 188;
const H = 46;
const GX = 64;
const GY = 12;

function layout(pipeline) {
  const stages = pipeline.stages.filter((s) => !s.name.startsWith('.'));
  const jobs = stages.flatMap((s, si) => s.jobs.map((j) => ({ ...j, si })));
  const byRef = new Map();
  for (const j of jobs) {
    byRef.set(j.name, j);
    if (j.jobId) byRef.set(j.jobId, j);
    byRef.set(j.id, j);
  }
  const level = new Map();
  const deps = new Map(); // id → [{ from, implicit }]
  const visiting = new Set();
  const prevStageJobs = (si) => {
    for (let k = si - 1; k >= 0; k--) {
      const list = jobs.filter((x) => x.si === k);
      if (list.length) return list;
    }
    return [];
  };
  const visit = (j) => {
    if (level.has(j.id)) return level.get(j.id);
    if (visiting.has(j.id)) return 0;
    visiting.add(j.id);
    let lv = 0;
    let d = [];
    if (j.needs) {
      d = j.needs.map((n) => byRef.get(n.job)).filter(Boolean).map((from) => ({ from, implicit: false }));
    } else if (pipeline.implicitStages !== false) {
      d = prevStageJobs(j.si).map((from) => ({ from, implicit: true }));
    }
    for (const { from } of d) lv = Math.max(lv, visit(from) + 1);
    visiting.delete(j.id);
    level.set(j.id, lv);
    deps.set(j.id, d);
    return lv;
  };
  jobs.forEach(visit);
  const columns = [];
  for (const j of jobs) {
    const lv = level.get(j.id);
    (columns[lv] ??= []).push(j);
  }
  const pos = new Map();
  columns.forEach((col, ci) => col?.forEach((j, ri) => pos.set(j.id, { x: ci * (W + GX), y: ri * (H + GY) })));
  const rows = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  return { jobs, columns, pos, deps, width: columns.length * (W + GX) - GX, height: rows * (H + GY) - GY };
}

export default function DagView({ pipeline, selectedJob, onSelectJob, jobIssues }) {
  const [hover, setHover] = useState(null);
  const g = useMemo(() => layout(pipeline), [pipeline]);
  const focus = hover ?? selectedJob;
  // Цепочка выбранного задания: что ему нужно и что ждёт его
  const related = useMemo(() => {
    if (!focus) return null;
    const up = new Set();
    const down = new Set();
    const walkUp = (id) => (g.deps.get(id) ?? []).forEach(({ from }) => !up.has(from.id) && (up.add(from.id), walkUp(from.id)));
    const walkDown = (id) => g.jobs.forEach((j) => (g.deps.get(j.id) ?? []).some((d) => d.from.id === id) && !down.has(j.id) && (down.add(j.id), walkDown(j.id)));
    walkUp(focus);
    walkDown(focus);
    return { up, down };
  }, [focus, g]);

  if (!g.jobs.length) return null;
  const pad = 8;
  return (
    <div className="overflow-auto rounded-lg border border-gk-border bg-gk-fg/[0.015] p-3" data-testid="dag">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gk-dim">
        {tj('<0>Колонка — задания, которые могут идти одновременно</0>{1}{2}', [<span />, <span className="flex items-center gap-1">
          <svg width="22" height="6">
            <path d="M0 3H22" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          needs
        </span>, <span className="flex items-center gap-1">
          {tj('{0}ждёт предыдущий этап', [<svg width="22" height="6">
            <path d="M0 3H22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>])}</span>])}
      </div>
      <div className="relative" style={{ width: g.width + pad * 2, height: g.height + pad * 2 }}>
        <svg className="absolute inset-0" width={g.width + pad * 2} height={g.height + pad * 2} aria-hidden="true">
          {g.jobs.flatMap((j) =>
            (g.deps.get(j.id) ?? []).map(({ from, implicit }) => {
              const a = g.pos.get(from.id);
              const b = g.pos.get(j.id);
              if (!a || !b) return null;
              const x1 = a.x + W + pad;
              const y1 = a.y + H / 2 + pad;
              const x2 = b.x + pad;
              const y2 = b.y + H / 2 + pad;
              const lit = related && (focus === j.id || focus === from.id || (related.up.has(from.id) && (related.up.has(j.id) || focus === j.id)) || (related.down.has(j.id) && (related.down.has(from.id) || focus === from.id)));
              const dim = related && !lit;
              return (
                <path
                  key={`${from.id}->${j.id}`}
                  d={`M${x1} ${y1} C${x1 + GX / 2} ${y1}, ${x2 - GX / 2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={lit ? 'var(--color-gk-blue)' : 'var(--color-gk-muted)'}
                  strokeOpacity={dim ? 0.15 : lit ? 0.95 : 0.45}
                  strokeWidth={lit ? 2 : 1.3}
                  strokeDasharray={implicit ? '4 4' : undefined}
                  data-testid="dag-edge"
                  data-implicit={implicit ? 'true' : undefined}
                />
              );
            }),
          )}
        </svg>
        {g.jobs.map((j) => {
          const p = g.pos.get(j.id);
          const issues = jobIssues?.(j) ?? [];
          const bad = issues.some((i) => i.severity === 'error');
          const warn = !bad && issues.some((i) => i.severity === 'warning');
          const isFocus = focus === j.id;
          const dim = related && !isFocus && !related.up.has(j.id) && !related.down.has(j.id);
          return (
            <button
              key={j.id}
              onClick={() => onSelectJob(j.id)}
              onMouseEnter={() => setHover(j.id)}
              onMouseLeave={() => setHover(null)}
              data-testid="dag-node"
              data-job={j.name}
              style={{ left: p.x + pad, top: p.y + pad, width: W, height: H }}
              className={`absolute flex flex-col justify-center rounded-md border px-2.5 text-left transition-all ${
                isFocus ? 'border-gk-blue bg-gk-blue/15 ring-1 ring-gk-blue/40' : bad ? 'border-gk-red/50 bg-gk-red/[0.06]' : warn ? 'border-gk-yellow/40 bg-gk-yellow/[0.05]' : 'border-gk-border bg-[var(--gk-solid)]'
              } ${dim ? 'opacity-35' : ''} hover:border-gk-blue/60`}
            >
              <span className="flex items-center gap-1 truncate text-[12px] font-medium text-gk-text">
                {j.manual && <Hand size={11} className="shrink-0 text-gk-yellow" />}
                <span className="truncate">{j.name}</span>
              </span>
              <span className="truncate text-[10.5px] text-gk-dim">
                {j.stage}
                {j.needs ? ` · needs: ${j.needs.length ? j.needs.map((n) => n.job).join(', ') : '—'}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
