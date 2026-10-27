// Статусы пайплайнов и заданий GitLab: иконки в духе GitLab, подписи, форматирование времени
import { readable } from '../lib/scheme.js';

export const STATUS = {
  success: { label: 'успешно', color: '#3cf0a0' },
  failed: { label: 'ошибка', color: '#f25d5d' },
  running: { label: 'выполняется', color: '#5aa2ff' },
  pending: { label: 'в очереди', color: '#f5c451' },
  preparing: { label: 'подготовка', color: '#f5c451' },
  waiting_for_resource: { label: 'ждёт ресурс', color: '#f5c451' },
  created: { label: 'создан', color: '#8b93a7' },
  manual: { label: 'ждёт ручного запуска', color: '#c0c6d4' },
  scheduled: { label: 'запланирован', color: '#c0c6d4' },
  canceled: { label: 'отменён', color: '#8b93a7' },
  canceling: { label: 'отменяется', color: '#8b93a7' },
  skipped: { label: 'пропущен', color: '#6b7385' },
  warning: { label: 'успешно, с предупреждениями', color: '#f5c451' },
};

export const ACTIVE_STATUSES = new Set(['running', 'pending', 'preparing', 'waiting_for_resource', 'created', 'canceling']);

export const SOURCE_LABELS = {
  push: 'push',
  merge_request_event: 'merge request',
  schedule: 'по расписанию',
  web: 'запущен вручную',
  api: 'через API',
  trigger: 'триггер',
  parent_pipeline: 'дочерний',
  pipeline: 'из другого проекта',
  chat: 'из чата',
  external: 'внешний',
};

export const FAILURE_REASONS = {
  script_failure: 'ошибка в скрипте (команда завершилась с ненулевым кодом)',
  runner_system_failure: 'сбой раннера',
  stuck_or_timeout_failure: 'превышено время ожидания',
  job_execution_timeout: 'задание выполнялось дольше таймаута',
  missing_dependency_failure: 'не найдены артефакты из зависимостей',
  runner_unsupported: 'раннер не поддерживает задание',
  archived_failure: 'проект в архиве',
  unmet_prerequisites: 'не выполнены предварительные условия',
  scheduler_failure: 'ошибка планировщика',
  data_integrity_failure: 'нарушена целостность данных',
  api_failure: 'ошибка API',
  unknown_failure: 'неизвестная причина',
};

export function statusInfo(status) {
  const info = STATUS[status] ?? { label: status ?? '—', color: '#8b93a7' };
  return { ...info, color: readable(info.color) };
}

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин${s % 60 ? ` ${s % 60} с` : ''}`;
  return `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}`;
}

/** Иконка статуса: круг с символом, «выполняется» — вращающееся кольцо */
export function StatusIcon({ status, size = 16, className = '', title }) {
  const { color, label } = statusInfo(status);
  const common = { width: size, height: size, viewBox: '0 0 16 16', className: `shrink-0 ${className}` };
  const tip = title ?? label;
  const ring = <circle cx="8" cy="8" r="6.6" fill="none" stroke={color} strokeWidth="1.6" />;

  let inner = null;
  switch (status) {
    case 'success':
      inner = <path d="M5.1 8.2l2 2 3.8-4.1" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case 'failed':
      inner = <path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />;
      break;
    case 'running':
      return (
        <svg {...common} aria-label={tip}>
          <title>{tip}</title>
          <circle cx="8" cy="8" r="6.6" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.6" />
          <path d="M8 1.4a6.6 6.6 0 0 1 6.6 6.6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" className="animate-spin" style={{ transformOrigin: '8px 8px', animationDuration: '1.4s' }} />
          <circle cx="8" cy="8" r="2.3" fill={color} />
        </svg>
      );
    case 'pending':
    case 'preparing':
    case 'waiting_for_resource':
      inner = <path d="M6.4 5.5v5M9.6 5.5v5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />;
      break;
    case 'manual':
      inner = <path d="M6.6 5.4v5.2l4.1-2.6z" fill={color} />;
      break;
    case 'scheduled':
      inner = <path d="M8 4.8V8l2.1 1.4" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />;
      break;
    case 'canceled':
    case 'canceling':
      inner = <path d="M5.2 10.8l5.6-5.6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />;
      break;
    case 'skipped':
      inner = <path d="M5.4 5.6L7.8 8l-2.4 2.4M8.6 5.6L11 8l-2.4 2.4" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case 'warning':
      inner = <path d="M8 4.8v3.8M8 10.9v.1" stroke={color} strokeWidth="1.8" strokeLinecap="round" />;
      break;
    default:
      inner = <circle cx="8" cy="8" r="1.6" fill={color} />;
  }
  return (
    <svg {...common} aria-label={tip}>
      <title>{tip}</title>
      {ring}
      {inner}
    </svg>
  );
}

/** Статус-«таблетка» с подписью */
export function StatusPill({ status, big }) {
  const { color, label } = statusInfo(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${big ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]'}`}
      style={{ color, backgroundColor: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <StatusIcon status={status} size={big ? 15 : 13} />
      {label}
    </span>
  );
}
