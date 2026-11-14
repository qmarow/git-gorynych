/**
 * Новое в 2.0: комментарий в ленте задачи — просмотр, меню («Цитировать», «Изменить», «Удалить», ссылка), режим правки.
 *
 * Ещё не подтверждённый сервером комментарий (`tmp-…`) полупрозрачный и без меню; пока нет `bodyHtml` (отправка,
 * правка до ответа), текст показывается как есть. «Цитировать» берёт выделенный в комментарии фрагмент, иначе весь текст.
 * Правка — `MarkdownEditor` без черновика: «Сохранить» / «Отмена», Esc — отмена; при ошибке текст остаётся в поле.
 */
import { memo, useRef, useState } from 'react';
import { Copy, ExternalLink, MoreHorizontal, Pencil, Quote, Trash2 } from 'lucide-react';
import ContextMenu, { type MenuEntry } from '../ContextMenu.tsx';
import { relativeTime, shortDate } from '../../lib/format.ts';
import { isTemporaryId } from '../../lib/issues.ts';
import type { ApiResult } from '../../platform/tauri.ts';
import { t } from '../../i18n/index.ts';
import type { IssueComment_Serialize, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import Markdown from './Markdown.tsx';
import MarkdownEditor from './MarkdownEditor.tsx';
import { UserAvatar, userName } from './IssueBits.tsx';

export interface CommentActions {
  canQuote: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onQuote: (text: string) => void;
  /** `null` — сохранено; иначе текст ошибки. */
  onSave: (id: string, body: string) => Promise<string | null>;
  onDelete: (comment: IssueComment_Serialize) => void;
  onIssueClick: (number: number) => void;
  onOpenLink: (url: string) => void;
  onCopy: (text: string, what: string) => void;
  render: (text: string) => Promise<ApiResult<string>>;
  issues: readonly { number: number; title: string }[];
  members: readonly IssueUser_Serialize[];
}

interface IssueCommentItemProps {
  comment: IssueComment_Serialize;
  /** Описание задачи — тот же вид, без меню правки комментария. */
  description?: boolean;
  /** Флажки списка задач в описании (при праве правки). */
  onTaskToggle?: (index: number, checked: boolean) => void;
  /** Меняется — HTML вставляется заново (флажок после отказа сервера). */
  revision?: number;
  actions: CommentActions;
}

const edited = (comment: IssueComment_Serialize) =>
  Boolean(comment.updatedAt && Math.abs(Date.parse(comment.updatedAt) - Date.parse(comment.createdAt)) > 60_000);

function IssueCommentItem({ comment, description = false, onTaskToggle, revision = 0, actions }: IssueCommentItemProps) {
  const bodyEl = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const temporary = isTemporaryId(comment.id);

  /** Выделение внутри этого комментария или весь текст. */
  const quoteSource = () => {
    const sel = window.getSelection();
    const root = bodyEl.current;
    if (sel && root && !sel.isCollapsed && sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const text = sel.toString().trim();
      if (text) return text;
    }
    return comment.body;
  };

  const save = async () => {
    if (editing == null) return;
    setSaving(true);
    const error = await actions.onSave(comment.id, editing);
    setSaving(false);
    if (error == null) setEditing(null);
  };

  const items: MenuEntry[] = [
    actions.canQuote && { label: t('issues-comment-quote'), icon: Quote, onClick: () => actions.onQuote(quoteSource()) },
    !description && comment.canEdit && actions.canEdit && { label: t('issues-comment-edit'), icon: Pencil, onClick: () => setEditing(comment.body) },
    !description && comment.canEdit && actions.canDelete && { label: t('issues-comment-delete'), icon: Trash2, danger: true, onClick: () => actions.onDelete(comment) },
    comment.webUrl && { separator: true },
    comment.webUrl && { label: t('issues-menu-copy-link'), icon: Copy, onClick: () => actions.onCopy(comment.webUrl!, t('issues-what-link')) },
    comment.webUrl && { label: t('issues-open-on-server'), icon: ExternalLink, onClick: () => actions.onOpenLink(comment.webUrl!) },
  ].filter(Boolean) as MenuEntry[];

  const author = comment.author;
  return (
    <li
      data-testid={description ? 'issue-description' : 'issue-comment'}
      data-comment-id={description ? undefined : comment.id}
      className={`flex gap-3 py-2 ${temporary ? 'opacity-50' : ''}`}
      aria-busy={temporary || undefined}
    >
      <span className="w-7 shrink-0 pt-1">{author ? <UserAvatar user={author} size={28} /> : <span className="block h-7 w-7 rounded-full bg-gk-hover" />}</span>
      <div className="min-w-0 flex-1 rounded-md border border-gk-border bg-gk-panel">
        <div className="flex items-center gap-2 border-b border-gk-border bg-gk-hover/50 px-3 py-1.5 text-xs">
          <span className="truncate font-semibold text-gk-strong">{author ? userName(author) : t('issues-someone')}</span>
          {author?.name && <span className="truncate text-gk-dim">@{author.login}</span>}
          <span className="shrink-0 text-gk-dim" data-tip={shortDate(comment.createdAt)}>
            {relativeTime(comment.createdAt)}
          </span>
          {edited(comment) && (
            <span className="shrink-0 text-gk-dim" data-tip={shortDate(comment.updatedAt!)}>
              · {t('issues-comment-edited')}
            </span>
          )}
          <span className="flex-1" />
          {!temporary && items.length > 0 && editing == null && (
            <button
              type="button"
              data-testid="comment-menu"
              aria-label={t('issues-comment-actions')}
              data-tip={t('issues-comment-actions')}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.right - 4, y: rect.bottom + 2 });
              }}
              className="flex h-5 w-6 items-center justify-center rounded text-gk-muted hover:bg-gk-hover hover:text-gk-text"
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        {editing != null ? (
          <div className="p-2">
            <MarkdownEditor
              value={editing}
              onChange={setEditing}
              onSubmit={() => void save()}
              onCancel={() => setEditing(null)}
              autoFocus
              busy={saving}
              submitLabel={t('issues-comment-save')}
              render={actions.render}
              issues={actions.issues}
              members={actions.members}
            />
          </div>
        ) : (
          <div ref={bodyEl} className="px-3 py-2">
            {!comment.body.trim() ? (
              <span className="text-xs text-gk-dim italic">{description ? t('issues-no-description') : t('issues-comment-empty')}</span>
            ) : comment.bodyHtml ? (
              <Markdown key={revision} html={comment.bodyHtml} onTaskToggle={onTaskToggle} onIssueClick={actions.onIssueClick} onOpenLink={actions.onOpenLink} />
            ) : (
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-gk-text">{comment.body}</div>
            )}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </li>
  );
}

export default memo(IssueCommentItem);
