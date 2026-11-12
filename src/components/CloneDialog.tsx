import { useEffect, useRef, useState } from 'react';
import { Check, CloudDownload, FolderOpen, GitBranch, KeyRound, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.tsx';
import { t, tj } from '../i18n/index.ts';
import type { ApiError, ApiResult } from '../platform/tauri.ts';
import type { CloneProbe_Serialize, CloneProgressEvent_Serialize, CloneRequest_Deserialize, Cloned } from '../../crates/gorynych-tauri/bindings/commands.ts';

/** Каналы клонирования из `window.api.repo` */
interface CloneApi {
  repo: {
    onCloneProgress?: (callback: (progress: CloneProgressEvent_Serialize) => void) => () => void;
    cloneProbe: (url: string) => Promise<ApiResult<CloneProbe_Serialize>>;
    clone: (options: CloneRequest_Deserialize) => Promise<ApiResult<Cloned>>;
    cloneCancel: (id: string) => void;
    openDialog: (title?: string) => Promise<string | null>;
  };
}

const api = window.api as unknown as CloneApi | undefined;

type Probe =
  | { status: 'idle' }
  | { status: 'loading'; url: string }
  | { status: 'ok'; url: string; data: CloneProbe_Serialize }
  | { status: 'error'; url: string; error: ApiError };

type Job = { id: string | null; phase: string; percent: number | null; phasePercent?: number | null; speed?: string | null; size?: string | null };

/** Повтор после входа: окно авторизации ждёт его итог */
type Retry = () => Promise<ApiResult<unknown> | undefined>;

interface CloneDialogProps {
  onClose: () => void;
  onCloned: (cloned: Cloned) => void;
  onAuth?: (url: string, error: ApiError | undefined, retry: Retry) => void;
}

function readLastParent() {
  try {
    return localStorage.getItem('clone.parent') || '';
  } catch {
    return '';
  }
}

const nameFromUrl = (url: string) =>
  url
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/i, '')
    .split(/[\\/:]/)
    .filter(Boolean)
    .pop() ?? '';

/**
 * Клонирование: адрес → проверка → куда положить → прогресс → открыть во вкладке.
 */
export default function CloneDialog({ onClose, onCloned, onAuth }: CloneDialogProps) {
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState<Probe>({ status: 'idle' });
  const [branch, setBranch] = useState('');
  const [parent, setParent] = useState(readLastParent);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [shallow, setShallow] = useState(false);
  const [job, setJob] = useState<Job | null>(null); // { id, phase, percent, speed, size }
  const [error, setError] = useState<ApiError | null>(null);
  const jobId = useRef<string | null>(null);

  useEffect(() => {
    if (!nameTouched) setName(nameFromUrl(url));
  }, [url, nameTouched]);

  useEffect(() => {
    if (!api?.repo.onCloneProgress) return undefined;
    return api.repo.onCloneProgress((p) => {
      if (p.id === jobId.current) setJob((j) => (j ? { ...j, ...p } : j));
    });
  }, []);

  const running = Boolean(job);
  const probeData = probe.status === 'ok' && probe.url === url.trim() ? probe.data : null;

  const runProbe = async () => {
    const target = url.trim();
    if (!target) return;
    setProbe({ status: 'loading', url: target });
    const res = await api!.repo.cloneProbe(target);
    if (res.ok) {
      setProbe({ status: 'ok', url: target, data: res.data });
      setBranch(res.data.defaultBranch ?? '');
    } else {
      setProbe({ status: 'error', url: target, error: res.error });
      // Сервер просит войти — сразу окно авторизации; после входа проверка адреса повторится
      if (res.error.code === 'AUTH' && onAuth) onAuth(target, res.error, retryProbe(target));
    }
  };

  // Повтор проверки адреса после ввода учётных данных → { ok, error } для окна авторизации
  const retryProbe = (target: string) => async () => {
    setProbe({ status: 'loading', url: target });
    const res = await api!.repo.cloneProbe(target);
    if (res.ok) {
      setProbe({ status: 'ok', url: target, data: res.data });
      setBranch(res.data.defaultBranch ?? '');
    } else setProbe({ status: 'error', url: target, error: res.error });
    return res;
  };

  const chooseParent = async () => {
    const dir = await api!.repo.openDialog(t('where-to-save-repository'));
    if (dir) setParent(dir);
  };

  const start = async (): Promise<ApiResult<Cloned> | undefined> => {
    if (!canStart) return;
    setError(null);
    const id = `clone-${Date.now()}`;
    jobId.current = id;
    setJob({ id, phase: t('connection'), percent: 0 });
    try {
      localStorage.setItem('clone.parent', parent);
    } catch {
      /* не запомним папку — не страшно */
    }
    const res = await api!.repo.clone({
      id,
      url: url.trim(),
      parent,
      name: name.trim(),
      branch: probeData && !probeData.empty && branch !== probeData.defaultBranch ? branch : undefined,
      depth: shallow ? 50 : undefined,
    });
    jobId.current = null;
    setJob(null);
    if (res.ok) onCloned(res.data);
    else if (res.error.code !== 'CANCELLED') {
      setError(res.error);
      if (res.error.code === 'AUTH' && onAuth) onAuth(url.trim(), res.error, start);
    }
    return res;
  };

  const cancel = () => {
    if (jobId.current) api!.repo.cloneCancel(jobId.current);
  };

  const sep = parent.includes('\\') ? '\\' : '/';
  const targetPath = parent && name.trim() ? `${parent.replace(/[\\/]+$/, '')}${sep}${name.trim()}` : '';
  const canStart = !running && probeData && parent && name.trim() && !/[<>:"|?*\\/]/.test(name);

  return (
    <Modal
      title={t('clone-repository-2')}
      icon={CloudDownload}
      iconClass="text-gk-blue"
      onClose={running ? () => {} : onClose}
      width={600}
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim" title={targetPath}>
            {running ? '' : !probeData ? t('paste-address-and-click-check') : targetPath ? `→ ${targetPath}` : t('choose-folder')}
          </span>
          {running ? (
            <Button onClick={cancel}>
              {tj('cancel-2', [<X size={13} />])}</Button>
          ) : (
            <>
              <Button onClick={onClose}>{t('close')}</Button>
              <Button variant="primary" onClick={start} disabled={!canStart}>
                {tj('clone', [<CloudDownload size={14} />])}</Button>
            </>
          )}
        </div>
      }
    >
      {/* Адрес */}
      <div className="flex items-center gap-2">
        <Link2 size={16} className="shrink-0 text-gk-muted" />
        <input
          value={url}
          autoFocus
          disabled={running}
          onChange={(e) => setUrl(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && runProbe()}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (text) setTimeout(() => setProbe({ status: 'idle' }), 0);
          }}
          placeholder="https://gitlab.com/user/project.git"
          className="min-w-0 flex-1 rounded bg-gk-bg px-3 py-2 font-mono text-[12px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
        <Button variant="blue" onClick={runProbe} disabled={!url.trim() || probe.status === 'loading' || running}>
          {tj('check-2', [probe.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />])}</Button>
      </div>
      <p className="ml-6 text-[11px] text-gk-dim">
        {t('https-or-ssh-address-from')}</p>

      {probe.status === 'error' && probe.url === url.trim() && <ErrorBox error={probe.error} />}
      {onAuth && ((probe.status === 'error' && probe.url === url.trim() && probe.error.code === 'AUTH') || error?.code === 'AUTH') && (
        <Button
          onClick={() => (error?.code === 'AUTH' ? onAuth!(url.trim(), error, start) : onAuth!(url.trim(), (probe as { error?: ApiError }).error, retryProbe(url.trim())))}
          data-testid="clone-auth"
        >
          {tj('enter-credentials', [<KeyRound size={13} />])}</Button>
      )}

      {probeData && (
        <div className="ml-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-gk-fg/[0.04] p-3 text-xs ring-1 ring-gk-border">
          {tj('access-granted', [<span className="flex items-center gap-1.5 text-gk-green" />, <Check size={14} />, probeData.host ? ` · ${probeData.host}` : '', probeData.empty ? (
            <span className="text-gk-muted">{t('repository-is-empty-it-will')}</span>
          ) : (
            <span className="flex items-center gap-2 text-gk-text">
              <GitBranch size={13} className="text-gk-muted" />
              <select
                value={branch}
                disabled={running}
                onChange={(e) => setBranch(e.target.value)}
                className="rounded bg-gk-bg px-2 py-1 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
              >
                {probeData.branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.name === probeData.defaultBranch ? t('default-2') : ''}
                  </option>
                ))}
              </select>
              <span className="text-gk-dim">
                {probeData.branches.length} {probeData.branches.length === 1 ? t('branch-5') : t('branches')}
              </span>
            </span>
          )])}
        </div>
      )}

      {/* Куда */}
      <div className="space-y-2 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{t('where')}</div>
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="shrink-0 text-gk-muted" />
          <button
            onClick={chooseParent}
            disabled={running}
            className="min-w-0 flex-1 truncate rounded bg-gk-bg px-3 py-2 text-left font-mono text-[12px] ring-1 ring-gk-border hover:ring-gk-blue disabled:opacity-60"
            title={parent}
          >
            {parent || <span className="text-gk-dim">{t('choose-folder-2')}</span>}
          </button>
          <span className="text-gk-dim">{sep}</span>
          <input
            value={name}
            disabled={running}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            placeholder={t('folder-name')}
            className="w-44 rounded bg-gk-bg px-3 py-2 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />
        </div>
        <label className="ml-6 flex cursor-pointer items-center gap-2 text-xs text-gk-muted">
          {tj('only-last-50-commits-faster', [<input type="checkbox" checked={shallow} disabled={running} onChange={(e) => setShallow(e.target.checked)} className="accent-gk-green" />])}</label>
      </div>

      {/* Прогресс */}
      {job && (
        <div className="space-y-2 rounded-lg bg-gk-fg/[0.04] p-3 ring-1 ring-gk-border">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-gk-text">
              <Loader2 size={13} className="animate-spin text-gk-blue" />
              {job.phase}
              {job.phasePercent != null && job.phase !== t('connection') && <span className="text-gk-dim">{job.phasePercent}%</span>}
            </span>
            <span className="font-mono text-[11px] text-gk-muted">
              {[job.size, job.speed].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gk-fg/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gk-blue to-gk-green transition-[width] duration-200"
              style={{ width: `${Math.max(3, job.percent ?? 0)}%` }}
            />
          </div>
        </div>
      )}

      {error && <ErrorBox error={error} />}
    </Modal>
  );
}
