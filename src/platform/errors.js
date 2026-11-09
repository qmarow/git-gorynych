// Ошибки первых секунд работы интерфейса: попадают в отчёт `frontend_ready` для отладочной проверки окна (tests/app_smoke.rs).
const errors = [];
const LIMIT = 20;

export function reportError(text) {
  if (errors.length < LIMIT) errors.push(String(text));
}

export const startupErrors = () => [...errors];

if (typeof window !== 'undefined') {
  // Для отладочного зонда окна (`GORYNYCH_DEV_UI_PROBE`): он читает ошибки позже первой отрисовки
  window.__gorynychErrors = errors;
  window.addEventListener('error', (e) => reportError(e.error?.stack || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.stack || e.reason));
}
