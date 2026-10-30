import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { applyAppearance, readCachedAppearance } from './lib/appearance.js';

// Тему и фон применяем до первой отрисовки — без вспышки стандартных цветов
try {
  applyAppearance(readCachedAppearance());
} catch {
  /* оформление по умолчанию из CSS */
}

// Если интерфейс упал — показываем ошибку вместо пустого окна
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crash:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="app-backdrop" />
        <div className="glass-strong w-full max-w-xl rounded-xl border border-gk-border bg-gk-panel-2 p-5">
          <div className="text-[15px] font-semibold text-gk-strong">Интерфейс упал с ошибкой</div>
          <pre className="mt-3 max-h-72 select-text overflow-auto whitespace-pre-wrap rounded bg-gk-sink/30 p-3 font-mono text-xs text-gk-red">
            {String(error?.stack || error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded bg-gk-green px-3 py-1.5 text-[13px] font-semibold text-gk-ink"
            >
              Перезагрузить
            </button>
            <button
              onClick={() => navigator.clipboard?.writeText(String(error?.stack || error))}
              className="rounded bg-gk-fg/10 px-3 py-1.5 text-[13px] text-gk-text"
            >
              Скопировать ошибку
            </button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
