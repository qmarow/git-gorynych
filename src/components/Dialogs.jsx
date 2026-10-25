import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';

/* =================== Базовое модальное окно =================== */

export function Modal({ title, icon: Icon, iconClass = 'text-gk-blue', onClose, children, footer, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-[#0b0d12]/55 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width }} className="glass-strong max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex items-center gap-2 border-b border-gk-border px-4 py-3">
          {Icon && <Icon size={16} className={iconClass} />}
          <h2 className="flex-1 text-[14px] font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-[13px]">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gk-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Button({ variant = 'default', className = '', ...props }) {
  const styles = {
    default: 'bg-gk-hover text-gk-text hover:bg-[#343a47]',
    primary: 'bg-gk-green text-gk-ink font-semibold shadow-lg shadow-gk-green/20 hover:brightness-110',
    blue: 'bg-gk-blue text-white font-semibold hover:brightness-110',
    danger: 'bg-gk-red/90 text-white font-semibold hover:bg-gk-red',
  };
  return (
    <button
      {...props}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}

function Details({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-0.5 text-xs text-gk-dim hover:text-gk-muted">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Ответ Git
      </button>
      {open && (
        <pre className="mt-1.5 max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-gk-bg p-2.5 font-mono text-[11px] text-gk-muted">
          {text}
        </pre>
      )}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="space-y-2 rounded-md border border-gk-red/30 bg-gk-red/10 p-3">
      <div className="flex items-start gap-2 font-medium text-gk-text">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-gk-red" />
        {error.message}
      </div>
      {error.hint && <p className="text-xs leading-relaxed text-gk-muted">{error.hint}</p>}
      <Details text={error.details} />
    </div>
  );
}

/* =================== Ошибка авторизации / доступа =================== */

const ERROR_ICONS = { AUTH: KeyRound, FORBIDDEN: Lock, PROTECTED: ShieldAlert, HOOK_DECLINED: ShieldAlert };
const ERROR_TITLES = {
  AUTH: 'Требуется авторизация',
  FORBIDDEN: 'Нет прав на запись',
  PROTECTED: 'Ветка защищена',
  HOOK_DECLINED: 'Push отклонён сервером',
  NOT_FOUND: 'Репозиторий недоступен',
  HOST_KEY: 'SSH: неизвестный сервер',
};

export function ErrorDialog({ action, error, onClose, onCheckAccess }) {
  return (
    <Modal
      title={`${action}: ${ERROR_TITLES[error.code] ?? 'ошибка'}`}
      icon={ERROR_ICONS[error.code] ?? AlertTriangle}
      iconClass="text-gk-red"
      onClose={onClose}
      footer={
        <>
          {onCheckAccess && (
            <Button onClick={onCheckAccess}>
              <RefreshCw size={13} /> Проверить доступ
            </Button>
          )}
          <Button variant="blue" onClick={onClose}>
            Понятно
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
    </Modal>
  );
}

/* =================== Состояние доступа к remote =================== */

function StatusRow({ label, state, note }) {
  const view =
    state === true
      ? { icon: <Check size={14} className="text-gk-green" />, text: 'есть', cls: 'text-gk-green' }
      : state === false
        ? { icon: <X size={14} className="text-gk-red" />, text: 'нет', cls: 'text-gk-red' }
        : { icon: <span className="block h-3.5 w-3.5 text-center text-gk-dim">—</span>, text: 'не проверено', cls: 'text-gk-dim' };
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-gk-muted">{label}</span>
      {view.icon}
      <span className={view.cls}>{view.text}</span>
      {note && <span className="text-xs text-gk-dim">{note}</span>}
    </div>
  );
}

export function AccessDialog({ access, onClose, onRecheck }) {
  const checking = access?.status === 'checking';
  const data = access?.data;
  const error = access?.error ?? data?.error ?? data?.writeError ?? null;
  const ok = data?.canRead && data?.canWrite !== false;

  return (
    <Modal
      title="Доступ к remote"
      icon={ok ? ShieldCheck : ShieldAlert}
      iconClass={ok ? 'text-gk-green' : 'text-gk-red'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onRecheck} disabled={checking}>
            {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {checking ? 'Проверка…' : 'Проверить снова'}
          </Button>
          <Button variant="blue" onClick={onClose}>
            Закрыть
          </Button>
        </>
      }
    >
      {data ? (
        <>
          <div className="space-y-1.5 rounded-md bg-gk-bg p-3 text-xs">
            <div className="flex gap-2">
              <span className="w-28 text-gk-muted">Remote</span>
              <span className="font-medium">{data.remote}</span>
              <span className="rounded bg-gk-hover px-1.5 text-[10px] uppercase text-gk-muted">{data.protocol}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-gk-muted">URL</span>
              <span className="select-text break-all font-mono">{data.url}</span>
            </div>
            {data.branch && (
              <div className="flex gap-2">
                <span className="w-28 text-gk-muted">Ветка</span>
                <span className="font-mono">
                  {data.branch} → {data.targetRef?.replace('refs/heads/', `${data.remote}/`)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5 px-1">
            <StatusRow label="Чтение (fetch)" state={data.canRead} />
            <StatusRow label="Запись (push)" state={data.canWrite} />
            {data.canRead && data.branch && (
              <StatusRow
                label="Ветка на remote"
                state={data.branchExists}
                note={data.branchExists === false ? '— будет создана при первом Push' : null}
              />
            )}
          </div>

          {data.diverged && (
            <div className="flex items-start gap-2 rounded-md border border-gk-yellow/30 bg-gk-yellow/10 p-3 text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-yellow" />
              На remote есть коммиты, которых нет у вас: перед Push нужен Pull.
            </div>
          )}

          {error && <ErrorBox error={error} />}

          <p className="text-[11px] leading-relaxed text-gk-dim">
            Права проверяются безопасно: <code>git ls-remote</code> и <code>git push --dry-run</code> ничего не меняют
            на сервере. Правила защиты веток (protected branches) сервер применяет только при настоящем push — если
            ветка защищена, это будет сообщено после попытки.
          </p>
        </>
      ) : checking ? (
        <div className="flex items-center gap-2 text-gk-muted">
          <Loader2 size={14} className="animate-spin" /> Проверяем доступ…
        </div>
      ) : (
        <ErrorBox error={error ?? { message: 'Доступ ещё не проверялся' }} />
      )}
    </Modal>
  );
}

/* =================== Push отклонён: remote ушёл вперёд =================== */

export function PushRejectedDialog({ branch, remote, onClose, onPull, onForce }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal
      title="Push отклонён"
      icon={AlertTriangle}
      iconClass="text-gk-yellow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          {confirm ? (
            <Button variant="danger" onClick={onForce}>
              Да, перезаписать {remote}/{branch}
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Force Push
            </Button>
          )}
          <Button variant="primary" onClick={onPull}>
            Pull (rebase) и Push
          </Button>
        </>
      }
    >
      <p>
        На <b>{remote}</b> в ветке <b>{branch}</b> есть коммиты, которых нет у вас. Обычный push перезаписал бы их,
        поэтому сервер его не примет.
      </p>
      <p className="text-xs text-gk-muted">
        Рекомендуется: получить изменения через Pull (rebase), затем отправить свои коммиты.
      </p>
      {confirm && (
        <div className="rounded-md border border-gk-red/30 bg-gk-red/10 p-3 text-xs leading-relaxed">
          Force Push (с <code>--force-with-lease</code>) удалит с remote чужие коммиты, которых нет у вас. Защищённые
          ветки сервер всё равно не даст перезаписать.
        </div>
      )}
    </Modal>
  );
}

/* =================== Подтверждение =================== */

export function ConfirmDialog({ title, children, confirmLabel = 'Подтвердить', danger = false, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      icon={AlertTriangle}
      iconClass={danger ? 'text-gk-red' : 'text-gk-yellow'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant={danger ? 'danger' : 'blue'}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* =================== Создание тега =================== */

export function TagDialog({ hash, label, busy, error, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [annotated, setAnnotated] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const valid = name.trim() && (!annotated || message.trim());
  const submit = () => valid && !busy && onSubmit({ name: name.trim(), hash, message: annotated ? message : '' });

  return (
    <Modal
      title="Новый тег"
      icon={Tag}
      iconClass="text-gk-yellow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 size={13} className="animate-spin" />} Создать тег
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
        onKeyDown={(e) => e.key === 'Enter' && !annotated && submit()}
        placeholder="v1.0.0"
        className="w-full rounded bg-gk-bg px-3 py-2 font-mono outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <div className="text-xs text-gk-muted">
        На коммите <span className="font-mono text-gk-text">{label}</span>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={annotated} onChange={(e) => setAnnotated(e.target.checked)} className="accent-[#3cf0a0]" />
        Аннотированный тег (с сообщением)
      </label>
      {annotated && (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Сообщение тега"
          className="w-full resize-none rounded bg-gk-bg px-3 py-2 outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
      )}
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}

/* =================== Создание ветки =================== */

export function BranchDialog({ startHash, startLabel, busy, error, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submit = () => name.trim() && !busy && onSubmit({ name: name.trim(), start: startHash, checkout });

  return (
    <Modal
      title="Новая ветка"
      icon={GitBranch}
      iconClass="text-gk-green"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>
            {busy && <Loader2 size={13} className="animate-spin" />} Создать ветку
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="feature/my-branch"
        className="w-full rounded bg-gk-bg px-3 py-2 font-mono outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <div className="text-xs text-gk-muted">
        От коммита <span className="font-mono text-gk-text">{startLabel}</span>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} className="accent-[#3cf0a0]" />
        Переключиться на новую ветку
      </label>
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}
