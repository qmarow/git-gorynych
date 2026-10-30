// Лоадеры: анимированный мини-граф, заставка при запуске и оверлей при открытии репозитория.

const LANES = ['#15a0bf', '#8e00c2', '#3cf0a0'];

// Маленький граф, который «рисует» себя по кругу
export function GraphLoader({ size = 64 }) {
  const x = (lane) => 14 + lane * 18;
  const y = (row) => 10 + row * 15;
  const edges = [
    { d: `M ${x(0)} ${y(0)} L ${x(0)} ${y(4)}`, c: LANES[0], delay: 0 },
    { d: `M ${x(0)} ${y(1)} L ${x(1) - 6} ${y(1)} Q ${x(1)} ${y(1)} ${x(1)} ${y(1) + 6} L ${x(1)} ${y(3)}`, c: LANES[1], delay: 0.15 },
    { d: `M ${x(1)} ${y(2)} L ${x(2) - 6} ${y(2)} Q ${x(2)} ${y(2)} ${x(2)} ${y(2) + 6} L ${x(2)} ${y(4)}`, c: LANES[2], delay: 0.3 },
  ];
  const nodes = [
    { l: 0, r: 0, delay: 0 },
    { l: 0, r: 1, delay: 0.1 },
    { l: 1, r: 2, delay: 0.25 },
    { l: 1, r: 3, delay: 0.4 },
    { l: 2, r: 4, delay: 0.55 },
    { l: 0, r: 4, delay: 0.5 },
  ];
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 64 72" aria-hidden="true">
      {edges.map((e, i) => (
        <path
          key={i}
          d={e.d}
          pathLength={1}
          className="loader-edge"
          style={{ animationDelay: `${e.delay}s` }}
          fill="none"
          stroke={e.c}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={x(n.l)}
          cy={y(n.r)}
          r={5}
          className="loader-node"
          fill={LANES[n.l]}
          style={{ animationDelay: `${n.delay}s`, stroke: 'var(--gk-base)' }}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

export function Splash({ title = 'git-Горыныч', subtitle }) {
  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center">
      <div className="app-backdrop" />
      <div className="glass-strong flex w-72 animate-pop-in flex-col items-center gap-4 rounded-2xl border border-gk-border bg-gk-panel px-8 py-8">
        <GraphLoader size={72} />
        <div className="text-center">
          <div className="text-[15px] font-semibold tracking-wide text-gk-strong">{title}</div>
          <div className="mt-1 h-4 text-xs text-gk-muted">{subtitle}</div>
        </div>
        <ProgressBar />
      </div>
    </div>
  );
}

export function LoadingOverlay({ label, title = 'Открываем репозиторий' }) {
  return (
    <div className="absolute inset-0 z-20 flex animate-fade-in items-center justify-center bg-[color-mix(in_srgb,var(--gk-base)_40%,transparent)] backdrop-blur-sm">
      <div className="glass-strong flex animate-pop-in items-center gap-4 rounded-xl border border-gk-border bg-gk-panel-2 px-6 py-4">
        <GraphLoader size={40} />
        <div>
          <div className="text-[13px] font-medium text-gk-strong">{title}</div>
          <div className="mt-0.5 max-w-64 truncate text-xs text-gk-muted">{label}</div>
          <ProgressBar className="mt-2 w-48" />
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ className = 'w-full' }) {
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-gk-fg/5 ${className}`}>
      <div className="loader-bar h-full w-1/3 rounded-full bg-gradient-to-r from-gk-green via-gk-blue to-[#8e00c2]" />
    </div>
  );
}
