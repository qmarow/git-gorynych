import { getLanguage } from '../i18n/index.ts';
import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Check, CloudUpload, History, Info, Loader2, ShieldCheck } from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.tsx';
import { fullDate, relativeTime } from '../lib/format.ts';
import { t, tj } from '../i18n/index.ts';
import type { ApiError, ApiResult } from '../platform/tauri.ts';
import type { ComponentType, ReactNode } from 'react';
import type { CommitAuthor } from '../../crates/gorynych-tauri/bindings/commands.ts';

/** Предпросмотр `revertToPreview` (gorynych-git::actions) */
interface RevertPreview {
  identical: boolean;
  branch?: string | null;
  filesChanged: number;
  insertions: number;
  deletions: number;
  ancestor: boolean;
  count: number;
  commits: { hash: string; message: string; author: string }[];
  pushedCount: number;
  dirtyCount: number;
  collisions: string[];
  hasUpstream: boolean;
}

const api = window.api as { repo: { action: (dir: string, name: string, payload: unknown) => Promise<ApiResult<RevertPreview>> } };

const plural = (n: number, one: string, few: string, many: string) => {
  if (getLanguage() !== 'ru') return n === 1 ? one : many; // в английском две формы: one и many (few = many)
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
interface RevertToProps {
  repoPath: string;
  commit: { hash: string; message: string; date: string; author?: CommitAuthor | null };
  busy?: boolean;
  onClose: () => void;
  onConfirm: (options: { push: boolean }) => void;
  /** Спрятать изменения в stash; true — получилось */
  onStashFirst: () => Promise<boolean>;
}

export default function RevertToDialog({ repoPath, commit, busy, onClose, onConfirm, onStashFirst }: RevertToProps) {
  const [preview, setPreview] = useState<RevertPreview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
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
      title={t('restore-project-to-commit')}
      icon={History}
      iconClass="text-gk-yellow"
      onClose={busy ? () => {} : onClose}
      width={580}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('cancel')}</Button>
          <Button variant="primary" disabled={!preview || blocked || busy} onClick={() => onConfirm({ push })}>
            {tj('restore-to', [busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />, short])}
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
          {tj('computing-what-will-change', [<Loader2 size={13} className="animate-spin" />])}</div>
      )}
      {error && <ErrorBox error={error} />}

      {preview && (
        <>
          {preview.identical ? (
            <Note icon={Info} tone="blue">
              {t('project-files-already-match-this')}</Note>
          ) : (
            <div className="space-y-2 text-[13px] leading-relaxed">
              <p>
                {tj('all-files-will-become-as', [preview.branch ? (
                  <>
                    {tj('on-branch-2', [<b />, preview.branch])}
                  </>
                ) : null, <b />, preview.filesChanged, plural(preview.filesChanged, t('file'), t('files-2'), t('files')), <span className="text-gk-green" />, preview.insertions, <span className="text-gk-red" />, preview.deletions])}</p>

              {preview.ancestor && preview.count > 0 && (
                <div className="rounded-lg bg-gk-sink/20 p-2.5 ring-1 ring-gk-border">
                  <div className="mb-1.5 text-xs text-gk-muted">
                    {tj('changes-of-will-be-undone', [preview.count, plural(preview.count, t('commits'), t('commits-2'), t('commits-2'))])}</div>
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
                      <div className="text-xs text-gk-dim">{tj('and-more-4', [preview.count - preview.commits.length])}</div>
                    )}
                  </div>
                </div>
              )}

              {!preview.ancestor && (
                <Note icon={AlertTriangle} tone="yellow">
                  {t('this-commit-isnt-from-current')}</Note>
              )}

              <Note icon={ShieldCheck} tone="green">
                {tj('safe-history-isnt-rewritten-new', [short, preview.pushedCount > 0 && t('suitable-for-commits-already-pushed')])}
              </Note>
            </div>
          )}

          {preview.dirtyCount > 0 && (
            <Note icon={AlertTriangle} tone="yellow">
              {tj('there-are-uncommitted-changes-they', [preview.dirtyCount, <button
                onClick={async () => {
                  const ok = await onStashFirst();
                  if (ok) setReload((n) => n + 1);
                }}
                disabled={busy}
                className="ml-2 inline-flex items-center gap-1 font-medium text-gk-blue hover:underline"
              >
                {tj('stash-and-continue', [<Archive size={12} />])}</button>])}
            </Note>
          )}
          {preview.collisions.length > 0 && (
            <Note icon={AlertTriangle} tone="yellow">
              {tj('untracked-files-have-same-names', [<span className="font-mono text-[11px]" />, preview.collisions.slice(0, 5).join(', ')])}</Note>
          )}

          {preview.hasUpstream && !blocked && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gk-muted">
              {tj('push-to-server-right-away-2', [<input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="accent-gk-green" />, <CloudUpload size={13} />])}</label>
          )}
        </>
      )}
    </Modal>
  );
}

type Tone = 'blue' | 'yellow' | 'green';

function Note({ icon: Icon, tone, children }: { icon: ComponentType<{ size?: number; className?: string }>; tone: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
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
