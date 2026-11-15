/**
 * Новое в 2.0: шапка карточки задачи — заголовок (карандаш или E — поле на месте заголовка с выделенным текстом; Enter
 * сохраняет, Esc и потеря фокуса отменяют; пустой или прежний текст запроса не шлёт), строка состояния («Открыта»,
 * автор, время, комментарии), кнопка состояния и меню «⋯»: скопировать ссылку и номер, открыть на сервере,
 * заблокировать / разблокировать обсуждение (`caps.lock`), удалить задачу (`caps.delete`, с вводом номера).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, ExternalLink, Lock, MessageSquare, MoreHorizontal, Pencil, Trash2, Unlock } from 'lucide-react';
import ContextMenu, { type MenuEntry } from '../ContextMenu.tsx';
import { Button, Modal } from '../Dialogs.tsx';
import { relativeTime, shortDate } from '../../lib/format.ts';
import type { Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssueStateButton from './IssueStateButton.tsx';
import { StateIcon, commentsText, stateTitle, userName } from './IssueBits.tsx';

export interface TitleBarHandle {
  editTitle: () => void;
}

interface IssueTitleBarProps {
  issue: Issue;
  caps: IssueCaps | null;
  onBack?: () => void;
  onRename: (title: string) => void;
  onState: (state: 'open' | 'closed', reason: string | null) => void;
  onLock: (locked: boolean) => void;
  onDelete: () => void;
  onCopy: (text: string, what: string) => void;
  onOpenWeb: (url: string) => void;
  extra?: ReactNode;
}

const IssueTitleBar = forwardRef<TitleBarHandle, IssueTitleBarProps>(function IssueTitleBar(
  { issue, caps, onBack, onRename, onState, onLock, onDelete, onCopy, onOpenWeb, extra },
  ref,
) {
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const canEdit = Boolean(caps?.edit);

  useImperativeHandle(ref, () => ({ editTitle: () => canEdit && setEditing(issue.title) }));

  useEffect(() => {
    if (editing == null) return;
    input.current?.focus();
    input.current?.select();
    // Только при входе в правку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing == null]);

  const save = () => {
    const title = (editing ?? '').trim();
    setEditing(null);
    if (title && title !== issue.title) onRename(title);
  };

  const items: MenuEntry[] = [
    { label: t('issues-menu-copy-link'), icon: Copy, onClick: () => onCopy(issue.webUrl, t('issues-what-link')) },
    { label: t('issues-menu-copy-number', issue.number), icon: Copy, onClick: () => onCopy(`#${issue.number}`, t('issues-what-number')) },
    { label: t('issues-open-on-server'), icon: ExternalLink, onClick: () => onOpenWeb(issue.webUrl) },
    caps?.lock && { separator: true },
    caps?.lock && (issue.locked ? { label: t('issues-unlock'), icon: Unlock, onClick: () => onLock(false) } : { label: t('issues-lock'), icon: Lock, onClick: () => onLock(true) }),
    caps?.delete && { separator: true },
    caps?.delete && { label: t('issues-delete'), icon: Trash2, danger: true, onClick: () => setDeleting(true) },
  ];

  return (
    <header className="shrink-0 border-b border-gk-border px-5 pt-3 pb-2.5">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-gk-blue hover:underline">
          <ArrowLeft size={13} />
          {t('issues-back-to-list')}
        </button>
      )}
      {editing != null ? (
        <input
          ref={input}
          data-testid="issue-title-input"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(null);
            }
          }}
          aria-label={t('issues-title-field')}
          className="w-full rounded border border-gk-blue/60 bg-gk-panel px-2 py-1 text-lg font-semibold text-gk-strong outline-none"
        />
      ) : (
        <div className="group flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[20px] leading-snug font-semibold break-words text-gk-strong" data-testid="issue-title">
            {issue.title} <span className="font-normal text-gk-dim">#{issue.number}</span>
          </h1>
          {canEdit && (
            <button
              type="button"
              data-testid="issue-title-edit"
              data-tip={t('issues-title-edit')}
              aria-label={t('issues-title-edit')}
              onClick={() => setEditing(issue.title)}
              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-gk-muted opacity-60 group-hover:opacity-100 hover:bg-gk-hover hover:text-gk-text"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gk-muted">
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${issue.state === 'open' ? 'bg-gk-green/15 text-gk-green' : 'bg-gk-purple/15 text-gk-purple'}`}>
          <StateIcon issue={issue} size={13} />
          {stateTitle(issue)}
        </span>
        {issue.author && <span className="font-medium text-gk-text">{userName(issue.author)}</span>}
        <span data-tip={shortDate(issue.createdAt)}>{t('issues-opened-ago', relativeTime(issue.createdAt))}</span>
        <span className="flex items-center gap-1" data-tip={commentsText(issue.commentsCount)} aria-label={commentsText(issue.commentsCount)}>
          <MessageSquare size={12} />
          {issue.commentsCount}
        </span>
        {issue.locked && (
          <span className="flex items-center gap-1" data-tip={t('issues-meta-locked')}>
            <Lock size={12} />
          </span>
        )}
        <span className="flex-1" />
        {extra}
        <IssueStateButton issue={issue} caps={caps} onChange={onState} />
        <button
          ref={more}
          type="button"
          data-testid="issue-more"
          aria-label={t('issues-more')}
          data-tip={t('issues-more')}
          onClick={() => {
            const r = more.current!.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 2 });
          }}
          className="flex h-7 w-7 items-center justify-center rounded border border-gk-border bg-gk-hover text-gk-muted hover:text-gk-text"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {deleting && <DeleteIssueDialog number={issue.number} onConfirm={onDelete} onClose={() => setDeleting(false)} />}
    </header>
  );
});

export default IssueTitleBar;

/** Удаление задачи: нужно ввести её номер. */
function DeleteIssueDialog({ number, onConfirm, onClose }: { number: number; onConfirm: () => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const ok = text.trim().replace(/^#/, '') === String(number);
  const confirm = () => {
    if (!ok) return;
    onClose();
    onConfirm();
  };
  return (
    <Modal
      title={t('issues-delete-title', number)}
      icon={Trash2}
      iconClass="text-gk-red"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="danger" data-testid="issue-delete-confirm" disabled={!ok} onClick={confirm}>
            {t('issues-delete')}
          </Button>
        </>
      }
    >
      <p className="text-gk-text">{t('issues-delete-text')}</p>
      <label className="block text-xs text-gk-muted">
        {t('issues-delete-type-number', number)}
        <input
          autoFocus
          data-testid="issue-delete-number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') onClose();
          }}
          className="mt-1 block w-full rounded border border-gk-border bg-gk-panel px-2 py-1.5 font-mono text-sm text-gk-text outline-none focus:border-gk-red/60"
        />
      </label>
    </Modal>
  );
}
