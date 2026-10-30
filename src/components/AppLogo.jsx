// Знак GitIdea: ветка Git и «идея» — светящийся узел. Тот же рисунок, что в иконке приложения (build/icon.svg).
export default function AppLogo({ size = 18, plate = true, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gi-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c2434" />
          <stop offset="1" stopColor="#0b0e14" />
        </linearGradient>
        <linearGradient id="gi-line" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3cf0a0" />
          <stop offset="1" stopColor="#2f9bff" />
        </linearGradient>
      </defs>
      {plate && <rect x="40" y="40" width="944" height="944" rx="216" fill="url(#gi-bg)" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />}
      <g fill="none" strokeLinecap="round">
        <path d="M372 776 V268" stroke="#3cf0a0" strokeWidth="72" />
        <path d="M372 650 C372 520 470 470 610 452" stroke="url(#gi-line)" strokeWidth="72" />
        <circle cx="372" cy="776" r="72" fill="#0f1217" stroke="#3cf0a0" strokeWidth="52" />
        <circle cx="372" cy="268" r="72" fill="#0f1217" stroke="#3cf0a0" strokeWidth="52" />
      </g>
      <circle cx="676" cy="440" r="100" fill="#ffd84d" />
      <g stroke="#ffd84d" strokeWidth="44" strokeLinecap="round">
        <path d="M676 286 V226" />
        <path d="M800 318 L842 276" />
        <path d="M832 440 H892" />
        <path d="M552 318 L510 276" />
      </g>
    </svg>
  );
}
