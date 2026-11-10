// Статусы пайплайнов и заданий (GitLab, GitHub, Gitea, Bitbucket — после нормализации): иконки в духе GitLab, подписи, форматирование времени
import { readable } from '../lib/scheme.ts';
import { t } from '../i18n/index.ts';

export const STATUS = {
  success: { label: t('успешно'), color: '#3cf0a0' },
  failed: { label: t('ошибка'), color: '#f25d5d' },
  running: { label: t('выполняется'), color: '#5aa2ff' },
  pending: { label: t('в очереди'), color: '#f5c451' },
  preparing: { label: t('подготовка'), color: '#f5c451' },
  waiting_for_resource: { label: t('ждёт ресурс'), color: '#f5c451' },
  created: { label: t('создан'), color: '#8b93a7' },
  manual: { label: t('ждёт ручного запуска'), color: '#c0c6d4' },
  scheduled: { label: t('запланирован'), color: '#c0c6d4' },
  canceled: { label: t('отменён'), color: '#8b93a7' },
  canceling: { label: t('отменяется'), color: '#8b93a7' },
  skipped: { label: t('пропущен'), color: '#6b7385' },
  warning: { label: t('успешно, с предупреждениями'), color: '#f5c451' },
};

export const ACTIVE_STATUSES = new Set(['running', 'pending', 'preparing', 'waiting_for_resource', 'created', 'canceling']);

export const SOURCE_LABELS = {
  push: 'push',
  merge_request_event: 'merge request',
  schedule: t('по расписанию'),
  web: t('запущен вручную'),
  api: t('через API'),
  trigger: t('триггер'),
  parent_pipeline: t('дочерний'),
  pipeline: t('из другого проекта'),
  chat: t('из чата'),
  external: t('внешний'),
  // GitHub, Gitea, Bitbucket
  pull_request: 'pull request',
  pull_request_target: 'pull request',
  workflow_dispatch: t('запущен вручную'),
  repository_dispatch: t('через API'),
  release: t('релиз'),
  workflow_run: t('после другого workflow'),
  workflow_call: t('вызван workflow'),
  manual: t('запущен вручную'),
  pullrequest: 'pull request',
  commit: 'push',
};

export const FAILURE_REASONS = {
  script_failure: t('ошибка в скрипте (команда завершилась с ненулевым кодом)'),
  runner_system_failure: t('сбой раннера'),
  stuck_or_timeout_failure: t('превышено время ожидания'),
  job_execution_timeout: t('задание выполнялось дольше таймаута'),
  missing_dependency_failure: t('не найдены артефакты из зависимостей'),
  runner_unsupported: t('раннер не поддерживает задание'),
  archived_failure: t('проект в архиве'),
  unmet_prerequisites: t('не выполнены предварительные условия'),
  scheduler_failure: t('ошибка планировщика'),
  data_integrity_failure: t('нарушена целостность данных'),
  api_failure: t('ошибка API'),
  unknown_failure: t('неизвестная причина'),
};

export function statusInfo(status) {
  const info = STATUS[status] ?? { label: status ?? '—', color: '#8b93a7' };
  return { ...info, color: readable(info.color) };
}

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return null;
  const s = Math.round(sec);
  if (s < 60) return t('{0} с', s);
  const m = Math.floor(s / 60);
  if (m < 60) return t('{0} мин{1}', m, s % 60 ? t(' {0} с', s % 60) : '');
  return t('{0} ч{1}', Math.floor(m / 60), m % 60 ? t(' {0} мин', m % 60) : '');
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
