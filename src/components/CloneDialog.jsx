import { useEffect, useRef, useState } from 'react';
import { Check, CloudDownload, FolderOpen, GitBranch, KeyRound, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.jsx';

const api = window.api;

function readLastParent() {
  try {
    return localStorage.getItem('clone.parent') || '';
  } catch {
    return '';
  }
}

const nameFromUrl = (url) =>
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
export default function CloneDialog({ onClose, onCloned, onAuth }) {
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState({ status: 'idle' });
  const [branch, setBranch] = useState('');
  const [parent, setParent] = useState(readLastParent);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [shallow, setShallow] = useState(false);
  const [job, setJob] = useState(null); // { id, phase, percent, speed, size }
  const [error, setError] = useState(null);
  const jobId = useRef(null);

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
    const res = await api.repo.cloneProbe(target);
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
  const retryProbe = (target) => async () => {
    setProbe({ status: 'loading', url: target });
    const res = await api.repo.cloneProbe(target);
    if (res.ok) {
      setProbe({ status: 'ok', url: target, data: res.data });
      setBranch(res.data.defaultBranch ?? '');
    } else setProbe({ status: 'error', url: target, error: res.error });
    return res;
  };

  const chooseParent = async () => {
    const dir = await api.repo.openDialog('Куда сохранить репозиторий');
    if (dir) setParent(dir);
  };

  const start = async () => {
    if (!canStart) return;
    setError(null);
    const id = `clone-${Date.now()}`;
    jobId.current = id;
    setJob({ id, phase: 'Подключение', percent: 0 });
    try {
      localStorage.setItem('clone.parent', parent);
    } catch {
      /* не запомним папку — не страшно */
    }
    const res = await api.repo.clone({
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
    if (jobId.current) api.repo.cloneCancel(jobId.current);
  };

  const sep = parent.includes('\\') ? '\\' : '/';
  const targetPath = parent && name.trim() ? `${parent.replace(/[\\/]+$/, '')}${sep}${name.trim()}` : '';
  const canStart = !running && probeData && parent && name.trim() && !/[<>:"|?*\\/]/.test(name);

  return (
    <Modal
      title="Клонировать репозиторий"
      icon={CloudDownload}
      iconClass="text-gk-blue"
      onClose={running ? () => {} : onClose}
      width={600}
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim" title={targetPath}>
            {running ? '' : !probeData ? 'Вставьте адрес и нажмите «Проверить»' : targetPath ? `→ ${targetPath}` : 'Выберите папку'}
          </span>
          {running ? (
            <Button onClick={cancel}>
              <X size={13} /> Отменить
            </Button>
          ) : (
            <>
              <Button onClick={onClose}>Закрыть</Button>
              <Button variant="primary" onClick={start} disabled={!canStart}>
                <CloudDownload size={14} /> Клонировать
              </Button>
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
          {probe.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Проверить
        </Button>
      </div>
      <p className="ml-6 text-[11px] text-gk-dim">
        HTTPS или SSH-адрес из кнопки «Code» / «Clone» на странице проекта. Если репозиторий приватный, появится окно входа.
      </p>

      {probe.status === 'error' && probe.url === url.trim() && <ErrorBox error={probe.error} />}
      {onAuth && ((probe.status === 'error' && probe.url === url.trim() && probe.error.code === 'AUTH') || error?.code === 'AUTH') && (
        <Button
          onClick={() => (error?.code === 'AUTH' ? onAuth(url.trim(), error, start) : onAuth(url.trim(), probe.error, retryProbe(url.trim())))}
          data-testid="clone-auth"
        >
          <KeyRound size={13} /> Ввести учётные данные
        </Button>
      )}

      {probeData && (
        <div className="ml-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-gk-fg/[0.04] p-3 text-xs ring-1 ring-gk-border">
          <span className="flex items-center gap-1.5 text-gk-green">
            <Check size={14} /> Доступ есть{probeData.host ? ` · ${probeData.host}` : ''}
          </span>
          {probeData.empty ? (
            <span className="text-gk-muted">Репозиторий пустой — склонируется без файлов</span>
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
                    {b.name === probeData.defaultBranch ? ' (по умолчанию)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-gk-dim">
                {probeData.branches.length} {probeData.branches.length === 1 ? 'ветка' : 'веток'}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Куда */}
      <div className="space-y-2 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gk-dim">Куда</div>
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="shrink-0 text-gk-muted" />
          <button
            onClick={chooseParent}
            disabled={running}
            className="min-w-0 flex-1 truncate rounded bg-gk-bg px-3 py-2 text-left font-mono text-[12px] ring-1 ring-gk-border hover:ring-gk-blue disabled:opacity-60"
            title={parent}
          >
            {parent || <span className="text-gk-dim">Выберите папку…</span>}
          </button>
          <span className="text-gk-dim">{sep}</span>
          <input
            value={name}
            disabled={running}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            placeholder="имя-папки"
            className="w-44 rounded bg-gk-bg px-3 py-2 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />
        </div>
        <label className="ml-6 flex cursor-pointer items-center gap-2 text-xs text-gk-muted">
          <input type="checkbox" checked={shallow} disabled={running} onChange={(e) => setShallow(e.target.checked)} className="accent-gk-green" />
          Только последние 50 коммитов — быстрее для больших репозиториев
        </label>
      </div>

      {/* Прогресс */}
      {job && (
        <div className="space-y-2 rounded-lg bg-gk-fg/[0.04] p-3 ring-1 ring-gk-border">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-gk-text">
              <Loader2 size={13} className="animate-spin text-gk-blue" />
              {job.phase}
              {job.phasePercent != null && job.phase !== 'Подключение' && <span className="text-gk-dim">{job.phasePercent}%</span>}
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
