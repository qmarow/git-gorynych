// Ошибки первых секунд работы интерфейса: попадают в отчёт `frontend_ready` для отладочной проверки окна (tests/app_smoke.rs).
declare global {
  interface Window {
    /** Ошибки первых секунд работы: читает отладочный зонд окна (`GORYNYCH_DEV_UI_PROBE`). */
    __gorynychErrors?: string[];
  }
}

const errors: string[] = [];
const LIMIT = 20;

export function reportError(text: unknown): void {
  if (errors.length < LIMIT) errors.push(String(text));
}

export const startupErrors = (): string[] => [...errors];

if (typeof window !== 'undefined') {
  // Для отладочного зонда окна (`GORYNYCH_DEV_UI_PROBE`): он читает ошибки позже первой отрисовки
  window.__gorynychErrors = errors;
  window.addEventListener('error', (e) => reportError(e.error?.stack || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.stack || e.reason));
}
