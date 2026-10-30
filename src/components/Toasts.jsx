import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, X } from 'lucide-react';
import { kb } from '../lib/platform.js';

const STYLES = {
  success: { icon: CheckCircle2, accent: 'text-gk-green', bar: 'bg-gk-green' },
  error: { icon: AlertTriangle, accent: 'text-gk-red', bar: 'bg-gk-red' },
  info: { icon: Info, accent: 'text-gk-blue', bar: 'bg-gk-blue' },
};

export default function Toasts({ toasts, onClose }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => onClose(toast.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onClose }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, accent, bar } = STYLES[toast.type] ?? STYLES.info;
  return (
    <div className="glass-strong pointer-events-auto relative animate-slide-in-left overflow-hidden rounded-lg border border-gk-border bg-gk-panel-2">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="flex items-start gap-2.5 py-2.5 pl-4 pr-2">
        <Icon size={16} className={`mt-0.5 shrink-0 ${accent}`} />
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium text-gk-text">{kb(toast.title)}</div>
          {toast.hint && <div className="mt-0.5 text-xs leading-relaxed text-gk-muted">{kb(toast.hint)}</div>}
          {toast.details && (
            <>
              <button
                onClick={() => setOpen((v) => !v)}
                className="mt-1 flex items-center gap-0.5 text-[11px] text-gk-dim hover:text-gk-muted"
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Подробнее
              </button>
              {open && (
                <pre className="mt-1 max-h-40 select-text overflow-auto whitespace-pre-wrap rounded bg-gk-bg p-2 font-mono text-[11px] text-gk-muted">
                  {toast.details}
                </pre>
              )}
            </>
          )}
        </div>
        <button onClick={onClose} className="rounded p-0.5 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
