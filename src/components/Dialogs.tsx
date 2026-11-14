import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Archive,
  Check,
  Cloud,
  GitCommitHorizontal,
  Laptop,
  ChevronDown,
  ChevronRight,
  CloudOff,
  GitBranch,
  KeyRound,
  Loader2,
  Lock,
  MoveRight,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { kb } from '../lib/platform.ts';
import { t as tr, tj } from '../i18n/index.ts';

/** Ошибка в форме `GitError.toJSON()` (у части окон — только `message`) */
export interface DialogError {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string;
  data?: unknown;
}

interface ModalProps {
  title: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  iconClass?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/* =================== Базовое модальное окно =================== */

export function Modal({ title, icon: Icon, iconClass = 'text-gk-blue', onClose, children, footer, width = 460 }: ModalProps) {
  useEffect(() => {
    // Esc закрывает только это окно: помечаем событие, чтобы панели под окном (CI/CD, diff) не закрылись следом
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // В портале на body: окно из панели (CI/CD, история файла) не попадает под её контекст наложения и анимации
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width }} className="glass-strong flex max-h-[84vh] max-w-[calc(100vw-2rem)] animate-pop-in flex-col rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-border px-4 py-3">
          {Icon && <Icon size={16} className={iconClass} />}
          <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={15} />
          </button>
        </div>
        {/* Длинное содержимое прокручивается, заголовок и кнопки всегда видны */}
        <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4 text-[13px]">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-gk-border px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export type ButtonVariant = 'default' | 'primary' | 'blue' | 'danger';

export function Button({ variant = 'default', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    default: 'bg-gk-hover text-gk-text hover:bg-gk-fg/10',
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

function Details({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-0.5 text-xs text-gk-dim hover:text-gk-muted">
        {tj('gits-response', [open ? <ChevronDown size={12} /> : <ChevronRight size={12} />])}</button>
      {open && (
        <pre className="mt-1.5 max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-gk-bg p-2.5 font-mono text-[11px] text-gk-muted">
          {text}
        </pre>
      )}
    </div>
  );
}

export function ErrorBox({ error }: { error: DialogError | null | undefined }) {
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

const ERROR_ICONS: Record<string, LucideIcon> = { AUTH: KeyRound, FORBIDDEN: Lock, PROTECTED: ShieldAlert, HOOK_DECLINED: ShieldAlert };
const ERROR_TITLES: Record<string, string> = {
  AUTH: tr('authorization-required'),
  FORBIDDEN: tr('no-write-access'),
  PROTECTED: tr('branch-is-protected'),
  HOOK_DECLINED: tr('push-rejected-by-server'),
  NOT_FOUND: tr('repository-is-unavailable'),
  HOST_KEY: tr('ssh-unknown-server'),
};

export function ErrorDialog({ action, error, onClose, onCheckAccess }: { action: ReactNode; error: DialogError; onClose: () => void; onCheckAccess?: () => void }) {
  return (
    <Modal
      title={`${action}: ${ERROR_TITLES[error.code!] ?? tr('error')}`}
      icon={ERROR_ICONS[error.code!] ?? AlertTriangle}
      iconClass="text-gk-red"
      onClose={onClose}
      footer={
        <>
          {onCheckAccess && (
            <Button onClick={onCheckAccess}>
              {tj('check-access', [<RefreshCw size={13} />])}</Button>
          )}
          <Button variant="blue" onClick={onClose}>
            {tr('got-it')}</Button>
        </>
      }
    >
      <ErrorBox error={error} />
    </Modal>
  );
}

/* =================== Состояние доступа к remote =================== */

function StatusRow({ label, state, note }: { label: ReactNode; state: boolean | null | undefined; note?: ReactNode }) {
  const view =
    state === true
      ? { icon: <Check size={14} className="text-gk-green" />, text: tr('yes'), cls: 'text-gk-green' }
      : state === false
        ? { icon: <X size={14} className="text-gk-red" />, text: tr('no'), cls: 'text-gk-red' }
        : { icon: <span className="block h-3.5 w-3.5 text-center text-gk-dim">—</span>, text: tr('not-checked'), cls: 'text-gk-dim' };
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-gk-muted">{label}</span>
      {view.icon}
      <span className={view.cls}>{view.text}</span>
      {note && <span className="text-xs text-gk-dim">{note}</span>}
    </div>
  );
}

/** Проверка доступа к remote (`repo:access`): ход проверки и её итог */
export interface AccessState {
  status?: string;
  error?: DialogError | null;
  data?: {
    remote?: string;
    protocol?: string;
    url?: string;
    branch?: string | null;
    targetRef?: string | null;
    canRead?: boolean | null;
    canWrite?: boolean | null;
    branchExists?: boolean | null;
    diverged?: boolean;
    error?: DialogError | null;
    writeError?: DialogError | null;
  } | null;
}

export function AccessDialog({ access, onClose, onRecheck, onCredentials }: { access: AccessState | null; onClose: () => void; onRecheck: () => void; onCredentials?: () => void }) {
  const checking = access?.status === 'checking';
  const data = access?.data;
  const error = access?.error ?? data?.error ?? data?.writeError ?? null;
  const ok = data?.canRead && data?.canWrite !== false;

  return (
    <Modal
      title={tr('remote-access')}
      icon={ok ? ShieldCheck : ShieldAlert}
      iconClass={ok ? 'text-gk-green' : 'text-gk-red'}
      onClose={onClose}
      width={620}
      footer={
        <>
          {onCredentials && data?.protocol !== 'local' && (
            <Button onClick={onCredentials} disabled={checking} className="mr-auto whitespace-nowrap" data-testid="access-credentials">
              <KeyRound size={13} /> {data?.canRead === false && error?.code === 'AUTH' ? tr('enter-credentials-2') : tr('enter-credentials-change-token')}
            </Button>
          )}
          <Button onClick={onRecheck} disabled={checking} className="whitespace-nowrap">
            {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {checking ? tr('checking-2') : tr('check-again')}
          </Button>
          <Button variant="blue" onClick={onClose}>
            {tr('close')}</Button>
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
                {tj('branch-7', [<span className="w-28 text-gk-muted" />, <span className="font-mono" />, data.branch, data.targetRef?.replace('refs/heads/', `${data.remote}/`)])}
              </div>
            )}
          </div>

          <div className="space-y-1.5 px-1">
            <StatusRow label={tr('read-fetch')} state={data.canRead} />
            <StatusRow label={tr('write-push')} state={data.canWrite} />
            {data.canRead && data.branch && (
              <StatusRow
                label={tr('branch-on-remote')}
                state={data.branchExists}
                note={data.branchExists === false ? tr('will-be-created-on-first') : null}
              />
            )}
          </div>

          {data.diverged && (
            <div className="flex items-start gap-2 rounded-md border border-gk-yellow/30 bg-gk-yellow/10 p-3 text-xs">
              {tj('remote-has-commits-you-dont', [<AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-yellow" />])}</div>
          )}

          {error && <ErrorBox error={error} />}

          <p className="text-[11px] leading-relaxed text-gk-dim">
            {tj('permissions-are-checked-safely-git', [<code />, <code />])}</p>
        </>
      ) : checking ? (
        <div className="flex items-center gap-2 text-gk-muted">
          {tj('checking-access', [<Loader2 size={14} className="animate-spin" />])}</div>
      ) : (
        <ErrorBox error={error ?? { message: tr('access-hasnt-been-checked-yet') }} />
      )}
    </Modal>
  );
}

/* =================== Push отклонён: remote ушёл вперёд =================== */

export function PushRejectedDialog({ branch, remote, onClose, onPull, onForce }: { branch: string; remote: string; onClose: () => void; onPull: () => void; onForce: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal
      title={tr('push-rejected')}
      icon={AlertTriangle}
      iconClass="text-gk-yellow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          {confirm ? (
            <Button variant="danger" onClick={onForce}>
              {tj('yes-overwrite', [remote, branch])}
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Force Push
            </Button>
          )}
          <Button variant="primary" onClick={onPull}>
            {tr('pull-rebase-and-push')}</Button>
        </>
      }
    >
      <p>
        {tj('has-commits-in-branch-that', [<b />, remote, <b />, branch])}</p>
      <p className="text-xs text-gk-muted">
        {tr('recommended-get-changes-with-pull')}</p>
      {confirm && (
        <div className="rounded-md border border-gk-red/30 bg-gk-red/10 p-3 text-xs leading-relaxed">
          {tj('force-push-with-force-with', [<code />])}</div>
      )}
    </Modal>
  );
}

/* =================== Подтверждение =================== */

export function ConfirmDialog({ title, children, confirmLabel = tr('confirm'), danger = false, onConfirm, onClose }: { title: ReactNode; children?: ReactNode; confirmLabel?: ReactNode; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      icon={AlertTriangle}
      iconClass={danger ? 'text-gk-red' : 'text-gk-yellow'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
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

/* =================== Удаление ветки на сервере =================== */

export function DeleteRemoteDialog({ remote, branch, locals = [], busy, error, onConfirm, onClose }: { remote: string; branch: string; locals?: string[]; busy?: boolean; error?: DialogError | null; onConfirm: () => void; onClose: () => void }) {
  const close = () => !busy && onClose();
  return (
    <Modal
      title={tr('delete-branch-from-server')}
      icon={CloudOff}
      iconClass="text-gk-red"
      onClose={close}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {tr('cancel')}</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CloudOff size={13} />}
            {busy ? tr('deleting-on-server') : tr('delete-from-server-4')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] leading-relaxed">
        <p>
          {tj('branch-will-be-deleted-on', [<b className="font-mono font-medium text-gk-strong" />, branch, <b className="font-medium text-gk-strong" />, remote, <code className="font-mono text-[12px] text-gk-muted" />, remote, branch])}</p>
        <div className="rounded-lg border border-gk-red/30 bg-gk-red/[0.07] px-3 py-2 text-[12.5px] text-gk-text">
          {tr('nobody-working-with-repository-will')}</div>
        <ul className="space-y-1 text-[12.5px] text-gk-muted">
          <li>
            {locals.length
              ? <>{tj('local-branch-stays-with-you', [locals.map((l, i) => <span key={l}>{i ? ', ' : ''}<b className="font-medium text-gk-text">{l}</b></span>)])}</>
              : tr('you-have-no-local-copy')}
          </li>
          <li>{tj('undo-will-publish-branch-back', [kb('Ctrl+Z')])}</li>
        </ul>
        {error && (
          <div className="rounded-lg border border-gk-red/40 bg-gk-red/10 px-3 py-2 text-[12.5px]">
            <div className="font-medium text-gk-red">{error.message ?? tr('app-is-busy-with-another')}</div>
            {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* =================== Создание тега =================== */

export function TagDialog({ hash, label, busy, error, onClose, onSubmit }: { hash: string; label: ReactNode; busy?: boolean; error?: DialogError | null; onClose: () => void; onSubmit: (tag: { name: string; hash: string; message: string }) => void }) {
  const [name, setName] = useState('');
  const [annotated, setAnnotated] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const valid = name.trim() && (!annotated || message.trim());
  const submit = () => valid && !busy && onSubmit({ name: name.trim(), hash, message: annotated ? message : '' });

  return (
    <Modal
      title={tr('new-tag')}
      icon={Tag}
      iconClass="text-gk-yellow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            {tj('create-tag', [busy && <Loader2 size={13} className="animate-spin" />])}</Button>
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
        {tj('on-commit', [<span className="font-mono text-gk-text" />, label])}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        {tj('annotated-tag-with-message', [<input type="checkbox" checked={annotated} onChange={(e) => setAnnotated(e.target.checked)} className="accent-gk-green" />])}</label>
      {annotated && (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder={tr('tag-message')}
          className="w-full resize-none rounded bg-gk-bg px-3 py-2 outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
      )}
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}

/* =================== Создание ветки =================== */

// Типы веток git flow: приписка, от какой ветки создаётся, пример имени
export interface FlowType {
  id: string;
  label: string;
  hint: string;
  base: 'develop' | 'master';
  placeholder: string;
}

export const FLOW_TYPES: FlowType[] = [
  { id: 'feature', label: 'feature', hint: tr('new-functionality'), base: 'develop', placeholder: 'login-form' },
  { id: 'bugfix', label: 'bugfix', hint: tr('fix-before-release'), base: 'develop', placeholder: 'crash-on-save' },
  { id: 'release', label: 'release', hint: tr('release-preparation'), base: 'develop', placeholder: '1.4.0' },
  { id: 'hotfix', label: 'hotfix', hint: tr('urgent-fix-in-production-version'), base: 'master', placeholder: '1.3.1' },
  { id: 'support', label: 'support', hint: tr('support-of-old-version'), base: 'master', placeholder: '1.x' },
];
const NO_PREFIX = 'none';
const readPrefType = () => {
  try {
    return localStorage.getItem('branchFlowType') || 'feature';
  } catch {
    return 'feature';
  }
};

/**
 * Новая ветка. Тип по git flow добавляет приписку (feature/, bugfix/, release/, hotfix/, support/) —
 * её берут из настроек git flow репозитория (git flow init), если они есть. Подсказывает, от какой ветки создавать.
 * branches — [{ name, hash }] локальные и remote-ветки (для «создать от develop / main»).
 */
/** Настройки git flow репозитория (`repo:gitflow-config`) */
export interface GitFlowConfig {
  configured?: boolean;
  develop?: string | null;
  master?: string | null;
  prefixes?: Record<string, string>;
}

export interface BranchRef {
  name: string;
  hash: string;
  remote?: boolean;
}

interface BranchDialogProps {
  startHash: string;
  startLabel: ReactNode;
  busy?: boolean;
  error?: DialogError | null;
  onClose: () => void;
  onSubmit: (branch: { name: string; start: string; checkout: boolean }) => void;
  branches?: BranchRef[];
  flow?: GitFlowConfig | null;
  /** Новое в 2.0: начальное имя (ветка из задачи); без него поле пустое, как раньше. */
  initialName?: string;
}

export function BranchDialog({ startHash, startLabel, busy, error, onClose, onSubmit, branches = [], flow = null, initialName = '' }: BranchDialogProps) {
  const [type, setTypeRaw] = useState(() => {
    const t = readPrefType();
    return t === NO_PREFIX || FLOW_TYPES.some((x) => x.id === t) ? t : 'feature';
  });
  const [name, setName] = useState(initialName);
  const [checkout, setCheckout] = useState(true);
  const [base, setBase] = useState<BranchRef | null>(null); // { name, hash } — выбранная основа вместо коммита из графа
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const prefixOf = (id: string) => (id === NO_PREFIX ? '' : flow?.prefixes?.[id] ?? `${id}/`);
  const setType = (id: string) => {
    setTypeRaw(id);
    setBase(null);
    try {
      localStorage.setItem('branchFlowType', id);
    } catch {
      /* без хранилища — просто не запоминаем */
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  // Вставили имя уже с припиской («feature/x» или «hotfix/1.2.1») — переключаем тип, приписку убираем из поля
  const onNameChange = (raw: string) => {
    let v = raw.replace(/\s/g, '-');
    for (const t of FLOW_TYPES) {
      const p = prefixOf(t.id);
      if (p && v.toLowerCase().startsWith(p.toLowerCase()) && v.length > p.length - 1) {
        if (t.id !== type) setType(t.id);
        v = v.slice(p.length);
        break;
      }
    }
    setName(v);
  };

  const flowType = FLOW_TYPES.find((t) => t.id === type) ?? null;
  const prefix = prefixOf(type);
  const full = name.trim() ? `${prefix}${name.trim()}` : '';

  // Основа по git flow: develop для feature/bugfix/release, master (main) для hotfix/support.
  // Передаём хэш, а не имя: от origin/develop новая ветка иначе начала бы следить за develop
  const find = (names: (string | null | undefined)[]) => {
    for (const n of names.filter(Boolean) as string[]) {
      const b = branches.find((x) => x.name === n) ?? branches.find((x) => x.name.replace(/^[^/]+\//, '') === n && x.remote);
      if (b) return b;
    }
    return null;
  };
  const flowBase = !flowType
    ? null
    : flowType.base === 'develop'
      ? find([flow?.develop, 'develop', 'dev'])
      : find([flow?.master, 'main', 'master']);
  const wantName = flowType ? (flowType.base === 'develop' ? flow?.develop ?? 'develop' : flow?.master ?? 'main / master') : null;
  const startOk = !flowBase || (base ?? { hash: startHash }).hash === flowBase.hash;

  const submit = () => full && !busy && onSubmit({ name: full, start: base?.hash ?? startHash, checkout });

  return (
    <Modal
      title={tr('new-branch-3')}
      icon={GitBranch}
      iconClass="text-gk-green"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button variant="primary" disabled={!full || busy} onClick={submit} data-testid="branch-create">
            {tj('create-branch-3', [busy && <Loader2 size={13} className="animate-spin" />])}</Button>
        </>
      }
    >
      {/* Тип ветки по git flow */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-gk-muted">
          {tj('branch-type-git-flow', [flow?.configured && <span className="text-gk-dim">{tr('prefixes-from-repositorys-git-flow')}</span>])}
        </div>
        <div role="radiogroup" className="flex flex-wrap gap-1.5" data-testid="branch-types">
          {FLOW_TYPES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={type === t.id}
              data-type={t.id}
              onClick={() => setType(t.id)}
              data-tip={tr('by-git-flow-its-created', prefixOf(t.id), t.hint, t.base === 'develop' ? flow?.develop ?? 'develop' : flow?.master ?? 'main / master')}
              className={`rounded-full px-2.5 py-1 font-mono text-[12px] transition-colors ${
                type === t.id ? 'bg-gk-green/20 text-gk-green ring-1 ring-gk-green/45' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
              }`}
            >
              {prefixOf(t.id)}
            </button>
          ))}
          <button
            role="radio"
            aria-checked={type === NO_PREFIX}
            data-type={NO_PREFIX}
            onClick={() => setType(NO_PREFIX)}
            className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
              type === NO_PREFIX ? 'bg-gk-green/20 text-gk-green ring-1 ring-gk-green/45' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
            }`}
          >
            {tr('no-prefix')}</button>
        </div>
      </div>

      {/* Имя: приписка + своя часть */}
      <div className="flex items-center rounded bg-gk-bg ring-1 ring-gk-border focus-within:ring-gk-blue">
        {prefix && (
          <span data-testid="branch-prefix" className="shrink-0 select-none pl-3 font-mono text-gk-green">
            {prefix}
          </span>
        )}
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={flowType?.placeholder ?? 'my-branch'}
          aria-label={tr('branch-name')}
          className={`min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono outline-none placeholder:text-gk-dim ${prefix ? 'pl-0' : 'pl-3'}`}
        />
      </div>
      {full && (
        <div className="text-xs text-gk-muted">
          {tj('branch-will-be-created', [<span data-testid="branch-full" className="font-mono text-gk-text" />, full])}
        </div>
      )}

      <div className="text-xs text-gk-muted">
        {tj('from-5', [base ? tr('branch-8') : tr('commits'), <span className="font-mono text-gk-text" />, base ? base.name : startLabel, base && (
          <button onClick={() => setBase(null)} className="ml-2 text-gk-blue hover:underline">
            {tr('go-back-to-selected-commit')}</button>
        )])}
      </div>
      {flowType && (
        <div
          data-testid="branch-flow-base"
          className={`rounded-md px-3 py-2 text-[12px] leading-relaxed ${startOk ? 'bg-gk-fg/[0.03] text-gk-muted' : 'bg-gk-yellow/10 text-gk-text'}`}
        >
          {tj('by-git-flow-branches-are', [<span className="font-mono" />, prefix, <span className="font-mono text-gk-text" />, wantName, !flowBase && <> {tr('theres-no-such-branch-in')}</>, flowBase && !startOk && (
            <button
              onClick={() => setBase(flowBase)}
              data-testid="branch-use-flow-base"
              className="ml-1 inline-flex items-center gap-1 rounded bg-gk-blue/15 px-1.5 py-0.5 text-gk-blue hover:bg-gk-blue/25"
            >
              {tj('create-from', [<GitBranch size={11} />, flowBase.name])}
            </button>
          ), flowBase && startOk && <span className="text-gk-green"> ✓</span>])}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        {tj('switch-to-new-branch', [<input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} className="accent-gk-green" />])}</label>
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}

/* =================== Двойной клик по коммиту: куда переключиться =================== */

/**
 * На коммите несколько веток — выбрать, на какую переключиться.
 * Веток нет — предупредить о detached HEAD и предложить сначала создать ветку.
 */
interface SwitchToProps {
  node: { hash: string; message?: ReactNode };
  locals?: { name: string }[];
  remotes?: { name: string }[];
  onBranch: (ref: { name: string }) => void;
  onCreateBranch: () => void;
  onDetached: () => void;
  onClose: () => void;
}

export function SwitchToDialog({ node, locals = [], remotes = [], onBranch, onCreateBranch, onDetached, onClose }: SwitchToProps) {
  const short = node.hash.slice(0, 7);
  const none = !locals.length && !remotes.length;
  // Remote-ветки, у которых уже есть локальная с тем же именем на этом коммите, не дублируем
  const localNames = new Set(locals.map((r) => r.name));
  const remoteOnly = remotes.filter((r) => !localNames.has(r.name.slice(r.name.indexOf('/') + 1)));
  return (
    <Modal
      title={none ? tr('commit-isnt-on-branch', short) : tr('switch-to', short)}
      icon={none ? AlertTriangle : GitBranch}
      iconClass={none ? 'text-gk-yellow' : 'text-gk-blue'}
      onClose={onClose}
      width={none ? 560 : 460}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button onClick={onDetached} data-testid="switch-detached" className="whitespace-nowrap">
            {tj('switch-head-detached', [<GitCommitHorizontal size={13} />])}</Button>
          {none && (
            <Button variant="blue" onClick={onCreateBranch} autoFocus className="whitespace-nowrap">
              {tj('create-branch-here-2', [<GitBranch size={13} />])}</Button>
          )}
        </>
      }
    >
      <div className="truncate rounded-md bg-gk-bg px-3 py-2 text-xs text-gk-muted">
        <span className="font-mono text-gk-text">{short}</span> · {node.message}
      </div>
      {none ? (
        <p className="text-[12.5px] leading-relaxed text-gk-muted">
          {tj('theres-no-branch-on-this', [<b className="text-gk-text" />])}</p>
      ) : (
        <div className="space-y-1">
          <p className="pb-1 text-[12.5px] text-gk-muted">{tr('there-are-several-branches-on')}</p>
          {locals.map((r) => (
            <button
              key={r.name}
              onClick={() => onBranch(r)}
              className="flex w-full items-center gap-2 rounded-md border border-gk-border bg-gk-bg/60 px-3 py-2 text-left hover:border-gk-blue/60 hover:bg-gk-hover"
            >
              {tj('local-3', [<Laptop size={13} className="shrink-0 text-gk-green" />, <span className="flex-1 truncate font-medium text-gk-text" />, r.name, <span className="text-[11px] text-gk-dim" />])}
            </button>
          ))}
          {remoteOnly.map((r) => (
            <button
              key={r.name}
              onClick={() => onBranch(r)}
              className="flex w-full items-center gap-2 rounded-md border border-gk-border bg-gk-bg/60 px-3 py-2 text-left hover:border-gk-blue/60 hover:bg-gk-hover"
            >
              {tj('create-local-and-track', [<Cloud size={13} className="shrink-0 text-gk-blue" />, <span className="flex-1 truncate font-medium text-gk-text" />, r.name, <span className="text-[11px] text-gk-dim" />])}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* =================== Переименование ветки =================== */

export function RenameBranchDialog({ from, upstream, busy, error, onClose, onSubmit }: { from: string; upstream?: string | null; busy?: boolean; error?: DialogError | null; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(from);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const next = name.trim();
  const valid = next && next !== from;
  const submit = () => valid && !busy && onSubmit(next);
  return (
    <Modal
      title={tr('rename-branch', from)}
      icon={GitBranch}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            {tj('rename-4', [busy && <Loader2 size={13} className="animate-spin" />])}</Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        aria-label={tr('new-branch-name')}
        spellCheck={false}
        className="w-full rounded bg-gk-bg px-3 py-2 font-mono outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <p className="text-xs leading-relaxed text-gk-muted">
        {tj('only-local-branch-changes-git', [<span className="font-mono" />, upstream && (
          <>
            {tj('branch-on-server-keeps-its', [<span className="font-mono text-gk-text" />, upstream])}</>
        )])}
      </p>
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}

/* =================== Checkout с незакоммиченными изменениями =================== */

const WIP_STATUS: Record<string, [string, string]> = { M: ['M', '#f2ca33'], A: ['A', '#3cf0a0'], D: ['D', '#f25d5d'], R: ['R', '#2f9bff'], U: ['U', '#ff8c3a'] };

/**
 * Что сделать с незакоммиченными изменениями перед переключением ветки (как в GitKraken):
 * спрятать (вернутся при возврате), перенести в новую ветку или выбросить.
 * wip — данные WIP_CONFLICT из main-процесса: { from, to, files, list, untracked, overlap, conflicted, detached }
 */
/** Данные `WIP_CONFLICT` из `actions::inspect_wip` */
export interface WipConflict {
  from?: string | null;
  to: string;
  files: number;
  list?: { path: string; status: string; untracked?: boolean; staged?: boolean }[];
  untracked?: number;
  conflicted?: string[];
  overlap?: string[];
  detached?: boolean;
}

export type WipChoice = 'stash' | 'merge' | 'force';

export function CheckoutWipDialog({ wip, busy, onChoose, onClose }: { wip: WipConflict; busy?: boolean; onChoose: (choice: WipChoice, remember: boolean) => void; onClose: () => void }) {
  const overlap = wip.overlap ?? [];
  const blocked = (wip.conflicted ?? []).length > 0;
  // Рекомендация: без пересечений — перенести (как обычный git switch), с пересечениями — спрятать
  const recommended: WipChoice = blocked ? 'force' : overlap.length ? 'stash' : 'merge';
  const [choice, setChoice] = useState<WipChoice>(recommended);
  const [remember, setRemember] = useState(false);
  const from = wip.from ?? 'detached HEAD';
  const options: { id: WipChoice; icon: LucideIcon; title: string; term: string; text: string; disabled?: string | null; tone: string; danger?: boolean }[] = [
    {
      id: 'stash',
      icon: Archive,
      title: tr('stash-and-switch'),
      term: 'Stash',
      text: wip.detached
        ? tr('changes-go-to-stash-you')
        : tr('changes-will-be-stashed-as', from, from),
      disabled: blocked ? tr('resolve-conflicts-in-files-marked') : null,
      tone: 'text-gk-yellow',
    },
    {
      id: 'merge',
      icon: MoveRight,
      title: tr('bring-changes-to', wip.to),
      term: 'Move changes',
      text: overlap.length
        ? tr('and-in-conflict-is-possible', overlap.length, overlap.length === 1 ? tr('file-changed') : tr('files-changed-2'), wip.to)
        : tr('changes-will-come-with-you', wip.to),
      disabled: blocked ? tr('resolve-conflicts-in-files-marked') : null,
      tone: 'text-gk-blue',
    },
    {
      id: 'force',
      icon: Trash2,
      title: tr('discard-changes-and-switch'),
      term: 'Discard',
      text: tr('working-folder-will-be-as'),
      tone: 'text-gk-red',
      danger: true,
    },
  ];
  const submit = (id: WipChoice = choice) => !busy && onChoose(id, remember && id !== 'force');
  return (
    <Modal
      title={tr('switch-to', wip.to)}
      icon={GitBranch}
      onClose={onClose}
      width={540}
      footer={
        <>
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px] text-gk-muted" data-tip={tr('remember-choice-for-future-switches')}>
            {tj('dont-ask-again', [<input type="checkbox" checked={remember && choice !== 'force'} disabled={choice === 'force'} onChange={(e) => setRemember(e.target.checked)} className="accent-gk-blue" data-testid="wip-remember" />])}</label>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button variant={choice === 'force' ? 'danger' : 'primary'} disabled={busy} onClick={() => submit()} data-testid="wip-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {choice === 'stash' ? tr('stash-and-switch') : choice === 'merge' ? tr('bring-and-switch') : tr('discard-and-switch')}
          </Button>
        </>
      }
    >
      <div data-testid="wip-dialog" data-recommended={recommended} className="space-y-3">
        <p className="text-gk-muted">
          {tj('has-uncommitted-changes-what-to', [<span className="font-medium text-gk-text" />, from, wip.files, wip.files === 1 ? tr('file') : wip.files < 5 ? tr('files-2') : tr('files'), wip.untracked ? tr('new-among-them', wip.untracked) : ''])}</p>
        <div className="max-h-28 overflow-y-auto rounded-md border border-gk-border bg-gk-fg/[0.02] px-2 py-1 font-mono text-[11.5px]" data-testid="wip-files">
          {(wip.list ?? []).map((f) => {
            const [letter, color] = WIP_STATUS[f.untracked ? 'A' : f.status] ?? WIP_STATUS.M;
            const hit = overlap.includes(f.path);
            return (
              <div key={f.path} className="flex items-center gap-2 py-0.5" data-overlap={hit ? 'true' : undefined}>
                <span className="w-3 shrink-0 text-center font-bold" style={{ color }}>
                  {letter}
                </span>
                <span className="min-w-0 flex-1 truncate text-gk-text">{f.path}</span>
                {hit && <span className="shrink-0 font-sans text-[10.5px] text-gk-yellow" data-tip={tr('changed-in-too', wip.to)}>{tj('also-in', [wip.to])}</span>}
              </div>
            );
          })}
          {wip.files > (wip.list ?? []).length && <div className="py-0.5 font-sans text-gk-dim">{tj('and-more-4', [wip.files - wip.list!.length])}</div>}
        </div>
        <div className="space-y-1.5" role="radiogroup">
          {options.map((o) => {
            const on = choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={Boolean(o.disabled)}
                data-testid={`wip-${o.id}`}
                data-tip={o.disabled ?? undefined}
                onClick={() => setChoice(o.id)}
                onDoubleClick={() => !o.disabled && submit(o.id)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? (o.danger ? 'border-gk-red/50 bg-gk-red/[0.07]' : 'border-gk-blue/50 bg-gk-blue/[0.08]') : 'border-gk-border hover:bg-gk-hover'
                }`}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? (o.danger ? 'border-gk-red' : 'border-gk-blue') : 'border-gk-dim'}`}>
                  {on && <span className={`h-2 w-2 rounded-full ${o.danger ? 'bg-gk-red' : 'bg-gk-blue'}`} />}
                </span>
                <o.icon size={15} className={`mt-0.5 shrink-0 ${o.tone}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-gk-strong">
                    {o.title}
                    <span className="text-[11px] font-normal text-gk-dim">{o.term}</span>
                    {o.id === recommended && <span className="rounded bg-gk-green/15 px-1.5 text-[10.5px] font-normal text-gk-green">{tr('recommended-2')}</span>}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-gk-muted">{o.text}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
