import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
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
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';
import { kb } from '../lib/platform.js';

/* =================== Базовое модальное окно =================== */

export function Modal({ title, icon: Icon, iconClass = 'text-gk-blue', onClose, children, footer, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
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
    </div>
  );
}

export function Button({ variant = 'default', className = '', ...props }) {
  const styles = {
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

export function AccessDialog({ access, onClose, onRecheck, onCredentials }) {
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
      width={620}
      footer={
        <>
          {onCredentials && data?.protocol !== 'local' && (
            <Button onClick={onCredentials} disabled={checking} className="mr-auto whitespace-nowrap" data-testid="access-credentials">
              <KeyRound size={13} /> {data?.canRead === false && error?.code === 'AUTH' ? 'Ввести учётные данные' : 'Ввести учётные данные / Сменить токен'}
            </Button>
          )}
          <Button onClick={onRecheck} disabled={checking} className="whitespace-nowrap">
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

/* =================== Удаление ветки на сервере =================== */

export function DeleteRemoteDialog({ remote, branch, locals = [], busy, error, onConfirm, onClose }) {
  const close = () => !busy && onClose();
  return (
    <Modal
      title="Удалить ветку с сервера"
      icon={CloudOff}
      iconClass="text-gk-red"
      onClose={close}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CloudOff size={13} />}
            {busy ? 'Удаляем на сервере…' : 'Удалить с сервера'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] leading-relaxed">
        <p>
          Ветка <b className="font-mono font-medium text-gk-strong">{branch}</b> будет удалена на сервере{' '}
          <b className="font-medium text-gk-strong">{remote}</b> (<code className="font-mono text-[12px] text-gk-muted">git push {remote} --delete {branch}</code>).
        </p>
        <div className="rounded-lg border border-gk-red/30 bg-gk-red/[0.07] px-3 py-2 text-[12.5px] text-gk-text">
          Её больше не увидят все, кто работает с репозиторием. Открытые merge request из этой ветки закроются или станут недоступны.
        </div>
        <ul className="space-y-1 text-[12.5px] text-gk-muted">
          <li>
            {locals.length
              ? <>Локальная ветка {locals.map((l, i) => <span key={l}>{i ? ', ' : ''}<b className="font-medium text-gk-text">{l}</b></span>)} останется у вас — её можно отправить снова (Push).</>
              : 'Локальной копии этой ветки у вас нет.'}
          </li>
          <li>Undo ({kb('Ctrl+Z')}) опубликует ветку обратно на тот же коммит.</li>
        </ul>
        {error && (
          <div className="rounded-lg border border-gk-red/40 bg-gk-red/10 px-3 py-2 text-[12.5px]">
            <div className="font-medium text-gk-red">{error.message ?? 'Программа занята другой операцией — повторите через секунду'}</div>
            {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
          </div>
        )}
      </div>
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
        <input type="checkbox" checked={annotated} onChange={(e) => setAnnotated(e.target.checked)} className="accent-gk-green" />
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

// Типы веток git flow: приписка, от какой ветки создаётся, пример имени
export const FLOW_TYPES = [
  { id: 'feature', label: 'feature', hint: 'новая функциональность', base: 'develop', placeholder: 'login-form' },
  { id: 'bugfix', label: 'bugfix', hint: 'исправление ошибки до релиза', base: 'develop', placeholder: 'crash-on-save' },
  { id: 'release', label: 'release', hint: 'подготовка релиза', base: 'develop', placeholder: '1.4.0' },
  { id: 'hotfix', label: 'hotfix', hint: 'срочное исправление в рабочей версии', base: 'master', placeholder: '1.3.1' },
  { id: 'support', label: 'support', hint: 'поддержка старой версии', base: 'master', placeholder: '1.x' },
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
export function BranchDialog({ startHash, startLabel, busy, error, onClose, onSubmit, branches = [], flow = null }) {
  const [type, setTypeRaw] = useState(() => {
    const t = readPrefType();
    return t === NO_PREFIX || FLOW_TYPES.some((x) => x.id === t) ? t : 'feature';
  });
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [base, setBase] = useState(null); // { name, hash } — выбранная основа вместо коммита из графа
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const prefixOf = (id) => (id === NO_PREFIX ? '' : flow?.prefixes?.[id] ?? `${id}/`);
  const setType = (id) => {
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
  const onNameChange = (raw) => {
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
  const find = (names) => {
    for (const n of names.filter(Boolean)) {
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
      title="Новая ветка"
      icon={GitBranch}
      iconClass="text-gk-green"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!full || busy} onClick={submit} data-testid="branch-create">
            {busy && <Loader2 size={13} className="animate-spin" />} Создать ветку
          </Button>
        </>
      }
    >
      {/* Тип ветки по git flow */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-gk-muted">
          Тип ветки (git flow)
          {flow?.configured && <span className="text-gk-dim">· приписки из настроек git flow репозитория</span>}
        </div>
        <div role="radiogroup" className="flex flex-wrap gap-1.5" data-testid="branch-types">
          {FLOW_TYPES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={type === t.id}
              data-type={t.id}
              onClick={() => setType(t.id)}
              data-tip={`${prefixOf(t.id)}… — ${t.hint}\nПо git flow создаётся от ${t.base === 'develop' ? flow?.develop ?? 'develop' : flow?.master ?? 'main / master'}`}
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
            без приписки
          </button>
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
          aria-label="Имя ветки"
          className={`min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono outline-none placeholder:text-gk-dim ${prefix ? 'pl-0' : 'pl-3'}`}
        />
      </div>
      {full && (
        <div className="text-xs text-gk-muted">
          Будет создана ветка <span data-testid="branch-full" className="font-mono text-gk-text">{full}</span>
        </div>
      )}

      <div className="text-xs text-gk-muted">
        От {base ? 'ветки' : 'коммита'} <span className="font-mono text-gk-text">{base ? base.name : startLabel}</span>
        {base && (
          <button onClick={() => setBase(null)} className="ml-2 text-gk-blue hover:underline">
            вернуть выбранный коммит
          </button>
        )}
      </div>
      {flowType && (
        <div
          data-testid="branch-flow-base"
          className={`rounded-md px-3 py-2 text-[12px] leading-relaxed ${startOk ? 'bg-gk-fg/[0.03] text-gk-muted' : 'bg-gk-yellow/10 text-gk-text'}`}
        >
          По git flow ветки <span className="font-mono">{prefix}</span> создаются от <span className="font-mono text-gk-text">{wantName}</span>.
          {!flowBase && <> Такой ветки в репозитории нет — ветка будет создана от выбранного коммита.</>}
          {flowBase && !startOk && (
            <button
              onClick={() => setBase(flowBase)}
              data-testid="branch-use-flow-base"
              className="ml-1 inline-flex items-center gap-1 rounded bg-gk-blue/15 px-1.5 py-0.5 text-gk-blue hover:bg-gk-blue/25"
            >
              <GitBranch size={11} /> Создать от {flowBase.name}
            </button>
          )}
          {flowBase && startOk && <span className="text-gk-green"> ✓</span>}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} className="accent-gk-green" />
        Переключиться на новую ветку
      </label>
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}

/* =================== Двойной клик по коммиту: куда переключиться =================== */

/**
 * На коммите несколько веток — выбрать, на какую переключиться.
 * Веток нет — предупредить о detached HEAD и предложить сначала создать ветку.
 */
export function SwitchToDialog({ node, locals = [], remotes = [], onBranch, onCreateBranch, onDetached, onClose }) {
  const short = node.hash.slice(0, 7);
  const none = !locals.length && !remotes.length;
  // Remote-ветки, у которых уже есть локальная с тем же именем на этом коммите, не дублируем
  const localNames = new Set(locals.map((r) => r.name));
  const remoteOnly = remotes.filter((r) => !localNames.has(r.name.slice(r.name.indexOf('/') + 1)));
  return (
    <Modal
      title={none ? `Коммит ${short} не на ветке` : `Переключиться на ${short}`}
      icon={none ? AlertTriangle : GitBranch}
      iconClass={none ? 'text-gk-yellow' : 'text-gk-blue'}
      onClose={onClose}
      width={none ? 560 : 460}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button onClick={onDetached} data-testid="switch-detached" className="whitespace-nowrap">
            <GitCommitHorizontal size={13} /> Переключить HEAD (Detached)
          </Button>
          {none && (
            <Button variant="blue" onClick={onCreateBranch} autoFocus className="whitespace-nowrap">
              <GitBranch size={13} /> Создать ветку здесь…
            </Button>
          )}
        </>
      }
    >
      <div className="truncate rounded-md bg-gk-bg px-3 py-2 text-xs text-gk-muted">
        <span className="font-mono text-gk-text">{short}</span> · {node.message}
      </div>
      {none ? (
        <p className="text-[12.5px] leading-relaxed text-gk-muted">
          На этом коммите нет ни одной ветки. Если переключить HEAD прямо на коммит, вы окажетесь в состоянии <b className="text-gk-text">detached HEAD</b>:
          новые коммиты не попадут ни в одну ветку. Удобнее сначала создать здесь ветку.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="pb-1 text-[12.5px] text-gk-muted">На коммите несколько веток — на какую переключиться?</p>
          {locals.map((r) => (
            <button
              key={r.name}
              onClick={() => onBranch(r)}
              className="flex w-full items-center gap-2 rounded-md border border-gk-border bg-gk-bg/60 px-3 py-2 text-left hover:border-gk-blue/60 hover:bg-gk-hover"
            >
              <Laptop size={13} className="shrink-0 text-gk-green" />
              <span className="flex-1 truncate font-medium text-gk-text">{r.name}</span>
              <span className="text-[11px] text-gk-dim">локальная</span>
            </button>
          ))}
          {remoteOnly.map((r) => (
            <button
              key={r.name}
              onClick={() => onBranch(r)}
              className="flex w-full items-center gap-2 rounded-md border border-gk-border bg-gk-bg/60 px-3 py-2 text-left hover:border-gk-blue/60 hover:bg-gk-hover"
            >
              <Cloud size={13} className="shrink-0 text-gk-blue" />
              <span className="flex-1 truncate font-medium text-gk-text">{r.name}</span>
              <span className="text-[11px] text-gk-dim">создать локальную и следить</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* =================== Переименование ветки =================== */

export function RenameBranchDialog({ from, upstream, busy, error, onClose, onSubmit }) {
  const [name, setName] = useState(from);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const next = name.trim();
  const valid = next && next !== from;
  const submit = () => valid && !busy && onSubmit(next);
  return (
    <Modal
      title={`Переименовать ветку ${from}`}
      icon={GitBranch}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 size={13} className="animate-spin" />} Переименовать
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        aria-label="Новое имя ветки"
        spellCheck={false}
        className="w-full rounded bg-gk-bg px-3 py-2 font-mono outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
      />
      <p className="text-xs leading-relaxed text-gk-muted">
        Меняется только локальная ветка (<span className="font-mono">git branch -m</span>), Undo вернёт прежнее имя.
        {upstream && (
          <>
            {' '}
            Ветка на сервере <span className="font-mono text-gk-text">{upstream}</span> останется с прежним именем, а локальная продолжит за ней следить.
          </>
        )}
      </p>
      {error && <ErrorBox error={error} />}
    </Modal>
  );
}
