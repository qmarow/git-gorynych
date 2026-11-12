import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { syncLanguageToMain } from './i18n/index.ts';
import './index.css';
import { applyAppearance, readCachedAppearance } from './lib/appearance.ts';
import { t } from './i18n/index.ts';
import { notifyReady } from './platform/tauri.ts';
import { reportError, startupErrors } from './platform/errors.ts';

// Тему и фон применяем до первой отрисовки — без вспышки стандартных цветов
try {
  applyAppearance(readCachedAppearance());
} catch {
  /* оформление по умолчанию из CSS */
}

// Если интерфейс упал — показываем ошибку вместо пустого окна
class ErrorBoundary extends Component<{ children?: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('UI crash:', error, info?.componentStack);
    reportError(`UI crash: ${(error as Error | null)?.stack || error}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="app-backdrop" />
        <div className="glass-strong w-full max-w-xl rounded-xl border border-gk-border bg-gk-panel-2 p-5">
          <div className="text-[15px] font-semibold text-gk-strong">{t('interface-crashed-with-error')}</div>
          <pre className="mt-3 max-h-72 select-text overflow-auto whitespace-pre-wrap rounded bg-gk-sink/30 p-3 font-mono text-xs text-gk-red">
            {String((error as Error | null)?.stack || error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded bg-gk-green px-3 py-1.5 text-[13px] font-semibold text-gk-ink"
            >
              {t('reload')}</button>
            <button
              onClick={() => navigator.clipboard?.writeText(String((error as Error | null)?.stack || error))}
              className="rounded bg-gk-fg/10 px-3 py-1.5 text-[13px] text-gk-text"
            >
              {t('copy-error')}</button>
          </div>
        </div>
      </div>
    );
  }
}

// Main-процесс переводит свои сообщения на язык окна
syncLanguageToMain();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Окно 2.0 скрыто до первой отрисовки, как `ready-to-show` в 1.x. Отчёт (ошибки запуска) нужен только отладочной проверке окна
notifyReady({ ui: 'mounted', errors: startupErrors() });
