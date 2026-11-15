/**
 * Новое в 2.0: граница ошибок раздела «Задачи» — исключение внутри раздела не роняет окно: вместо раздела сообщение и
 * «Перезагрузить раздел» (заново монтирует раздел). Общая граница `boot.tsx` ловит всё окно и перезагрузки раздела не
 * умеет, поэтому здесь своя.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { t } from '../../i18n/index.ts';

interface IssuesBoundaryState {
  error: unknown;
  attempt: number;
}

export default class IssuesBoundary extends Component<{ children: (attempt: number) => ReactNode }, IssuesBoundaryState> {
  state: IssuesBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<IssuesBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Issues crash:', error, info?.componentStack);
  }

  render() {
    const { error, attempt } = this.state;
    if (!error) return this.props.children(attempt);
    return (
      <div data-testid="issues-crashed" role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle size={36} strokeWidth={1.25} className="text-gk-red" />
        <div className="text-sm text-gk-text">{t('issues-crashed')}</div>
        <pre className="max-h-40 max-w-xl overflow-auto rounded bg-gk-sink/30 p-2 text-left font-mono text-[11px] whitespace-pre-wrap text-gk-muted">{String((error as Error | null)?.message ?? error)}</pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null, attempt: attempt + 1 })}
          className="flex items-center gap-1.5 rounded bg-gk-hover px-3 py-1.5 text-xs text-gk-text hover:bg-gk-fg/10"
        >
          <RotateCcw size={13} />
          {t('issues-reload-section')}
        </button>
      </div>
    );
  }
}
