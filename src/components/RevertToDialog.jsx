import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Check, CloudUpload, History, Info, Loader2, ShieldCheck } from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.jsx';
import { fullDate, relativeTime } from '../lib/format.js';

const api = window.api;

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/**
 * «Вернуть проект к этому коммиту»: предпросмотр → подтверждение.
 * Создаёт один новый коммит, файлы становятся как в выбранном коммите; история не переписывается.
 */
export default function RevertToDialog({ repoPath, commit, busy, onClose, onConfirm, onStashFirst }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [push, setPush] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError(null);
    api.repo.action(repoPath, 'revertToPreview', { hash: commit.hash }).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setPreview(res.data);
        setPush(res.data.hasUpstream && res.data.pushedCount > 0);
      } else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [repoPath, commit.hash, reload]);

  const short = commit.hash.slice(0, 7);
  const blocked = preview && (preview.identical || preview.dirtyCount > 0 || preview.collisions.length > 0);

  return (
    <Modal
      title="Вернуть проект к коммиту"
      icon={History}
      iconClass="text-gk-yellow"
      onClose={busy ? () => {} : onClose}
      width={580}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!preview || blocked || busy} onClick={() => onConfirm({ push })}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            Вернуть к {short}
          </Button>
        </>
      }
    >
      {/* Целевой коммит */}
      <div className="flex items-start gap-3 rounded-lg bg-gk-fg/[0.04] p-3 ring-1 ring-gk-border">
        <span className="mt-0.5 rounded bg-gk-yellow/15 px-1.5 py-0.5 font-mono text-[11px] text-gk-yellow">{short}</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-gk-strong">{commit.message}</div>
          <div className="text-xs text-gk-muted">
            {commit.author?.name} · {fullDate(commit.date)} ({relativeTime(commit.date)})
          </div>
        </div>
      </div>

      {!preview && !error && (
        <div className="flex items-center gap-2 text-xs text-gk-muted">
          <Loader2 size={13} className="animate-spin" /> Считаем, что изменится…
        </div>
      )}
      {error && <ErrorBox error={error} />}

      {preview && (
        <>
          {preview.identical ? (
            <Note icon={Info} tone="blue">
              Файлы проекта уже совпадают с этим коммитом — откатывать нечего.
            </Note>
          ) : (
            <div className="space-y-2 text-[13px] leading-relaxed">
              <p>
                Все файлы станут такими, как в этом коммите
                {preview.branch ? (
                  <>
                    {' '}на ветке <b>{preview.branch}</b>
                  </>
                ) : null}
                . Изменится{' '}
                <b>
                  {preview.filesChanged} {plural(preview.filesChanged, 'файл', 'файла', 'файлов')}
                </b>{' '}
                (<span className="text-gk-green">+{preview.insertions}</span>{' '}
                <span className="text-gk-red">−{preview.deletions}</span>).
              </p>

              {preview.ancestor && preview.count > 0 && (
                <div className="rounded-lg bg-gk-sink/20 p-2.5 ring-1 ring-gk-border">
                  <div className="mb-1.5 text-xs text-gk-muted">
                    Будут отменены изменения {preview.count} {plural(preview.count, 'коммита', 'коммитов', 'коммитов')}:
                  </div>
                  <div className="max-h-36 space-y-0.5 overflow-y-auto">
                    {preview.commits.map((c) => (
                      <div key={c.hash} className="flex items-center gap-2 text-xs">
                        <span className="text-gk-red">↶</span>
                        <span className="font-mono text-gk-dim">{c.hash.slice(0, 7)}</span>
                        <span className="min-w-0 flex-1 truncate text-gk-text">{c.message}</span>
                        <span className="shrink-0 text-gk-dim">{c.author}</span>
                      </div>
                    ))}
                    {preview.count > preview.commits.length && (
                      <div className="text-xs text-gk-dim">… и ещё {preview.count - preview.commits.length}</div>
                    )}
                  </div>
                </div>
              )}

              {!preview.ancestor && (
                <Note icon={AlertTriangle} tone="yellow">
                  Этот коммит не из истории текущей ветки. Файлы всё равно станут как в нём — убедитесь, что это нужно.
                </Note>
              )}

              <Note icon={ShieldCheck} tone="green">
                Безопасно: история не переписывается. Сверху появится новый коммит «Revert to {short}», старые коммиты
                останутся. Передумали — нажмите Undo.
                {preview.pushedCount > 0 && ' Подходит и для уже отправленных на сервер коммитов.'}
              </Note>
            </div>
          )}

          {preview.dirtyCount > 0 && (
            <Note icon={AlertTriangle} tone="yellow">
              Есть незакоммиченные изменения ({preview.dirtyCount}). Их нужно убрать перед откатом.
              <button
                onClick={async () => {
                  const ok = await onStashFirst();
                  if (ok) setReload((n) => n + 1);
                }}
                disabled={busy}
                className="ml-2 inline-flex items-center gap-1 font-medium text-gk-blue hover:underline"
              >
                <Archive size={12} /> Спрятать в Stash и продолжить
              </button>
            </Note>
          )}
          {preview.collisions.length > 0 && (
            <Note icon={AlertTriangle} tone="yellow">
              Неотслеживаемые файлы совпадают по имени с файлами коммита и будут мешать:{' '}
              <span className="font-mono text-[11px]">{preview.collisions.slice(0, 5).join(', ')}</span>. Переместите их или
              спрячьте в Stash.
            </Note>
          )}

          {preview.hasUpstream && !blocked && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gk-muted">
              <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="accent-gk-green" />
              <CloudUpload size={13} />
              Сразу отправить на сервер (push)
            </label>
          )}
        </>
      )}
    </Modal>
  );
}

function Note({ icon: Icon, tone, children }) {
  const tones = {
    blue: 'border-gk-blue/30 bg-gk-blue/10 [&>svg]:text-gk-blue',
    yellow: 'border-gk-yellow/30 bg-gk-yellow/10 [&>svg]:text-gk-yellow',
    green: 'border-gk-green/25 bg-gk-green/10 [&>svg]:text-gk-green',
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-relaxed text-gk-text ${tones[tone]}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
