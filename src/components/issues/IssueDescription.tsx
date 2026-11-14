/**
 * Новое в 2.0: описание задачи в ленте — отрисованный Markdown (флажки списка задач кликабельны при праве правки),
 * «Изменить» — `MarkdownEditor` с черновиком `…:<номер>:body`, «Сохранить» / «Отмена».
 *
 * Защита от затирания чужих правок: перед сохранением задача перечитывается (`fetchDetail`). Если на сервере
 * `updatedAt` новее, чем при начале правки, и описание другое — полоса «Описание изменили на сервере» с
 * «Показать новую версию» (текст сервера в поле, отсчёт заново) и «Сохранить мою». Без выбора ничего не уходит.
 * Пустое описание — «Описания нет» и «Добавить».
 */
import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import type { Issue } from '../../lib/issues.ts';
import { clearDraft, loadDraft } from '../../lib/issueDrafts.ts';
import { issuesStore } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import Markdown from './Markdown.tsx';
import MarkdownEditor from './MarkdownEditor.tsx';
import type { CommentActions } from './IssueCommentItem.tsx';
import { UserAvatar, userName } from './IssueBits.tsx';

export interface DescriptionHandle {
  edit: () => void;
}

interface IssueDescriptionProps {
  repoPath: string;
  issue: Issue;
  editable: boolean;
  actions: CommentActions;
  onTaskToggle?: (index: number, checked: boolean) => void;
  revision: number;
  notify: (toast: { type: string; title: string; hint?: string }) => void;
}

interface Edit {
  text: string;
  /** Состояние сервера на начало правки. */
  baseUpdatedAt: string;
  baseBody: string;
}

const IssueDescription = forwardRef<DescriptionHandle, IssueDescriptionProps>(function IssueDescription(
  { repoPath, issue, editable, actions, onTaskToggle, revision, notify },
  ref,
) {
  const store = issuesStore.getState;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ body: string; updatedAt: string } | null>(null);
  const slot = { number: issue.number, field: 'body' } as const;
  const editRef = useRef(edit);
  editRef.current = edit;

  // Черновик правки (переход к другой задаче, закрытие раздела) возвращается; «Отмена» его удаляет
  const start = () => editable && setEdit({ text: loadDraft(repoPath, slot) ?? issue.body, baseUpdatedAt: issue.updatedAt, baseBody: issue.body });
  useImperativeHandle(ref, () => ({ edit: start }));

  const send = async (text: string) => {
    setSaving(true);
    const res = await store().update(repoPath, issue.number, { body: text });
    setSaving(false);
    if (res.ok) {
      setEdit(null);
      setConflict(null);
    } else notify({ type: 'error', title: t('issues-update-failed'), hint: res.error.message });
  };

  const save = async (force = false) => {
    const current = editRef.current;
    if (!current) return;
    if (!force) {
      setSaving(true);
      const fresh = await store().fetchDetail(repoPath, issue.number);
      setSaving(false);
      if (fresh.ok) {
        const server = fresh.data.issue;
        if (Date.parse(server.updatedAt) > Date.parse(current.baseUpdatedAt) && server.body !== current.baseBody && server.body !== current.text) {
          setConflict({ body: server.body, updatedAt: server.updatedAt });
          return;
        }
      }
    }
    await send(current.text);
  };

  const author = issue.author;
  return (
    <li data-testid="issue-description" className="flex gap-3 py-2">
      <span className="w-7 shrink-0 pt-1">{author ? <UserAvatar user={author} size={28} /> : <span className="block h-7 w-7 rounded-full bg-gk-hover" />}</span>
      <div className="min-w-0 flex-1 rounded-md border border-gk-border bg-gk-panel">
        <div className="flex items-center gap-2 border-b border-gk-border bg-gk-hover/50 px-3 py-1.5 text-xs">
          <span className="truncate font-semibold text-gk-strong">{author ? userName(author) : t('issues-someone')}</span>
          <span className="shrink-0 text-gk-dim" data-tip={shortDate(issue.createdAt)}>
            {relativeTime(issue.createdAt)}
          </span>
          <span className="flex-1" />
          {editable && !edit && (
            <button type="button" data-testid="description-edit" onClick={start} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
              <Pencil size={12} />
              {t('issues-comment-edit')}
            </button>
          )}
        </div>
        {edit ? (
          <div className="p-2">
            {conflict && (
              <div role="alert" data-testid="description-conflict" className="mb-2 flex flex-wrap items-center gap-2 rounded border border-gk-yellow/40 bg-gk-yellow/10 px-2.5 py-1.5 text-xs text-gk-text">
                <AlertTriangle size={13} className="shrink-0 text-gk-yellow" />
                <span className="flex-1">{t('issues-description-conflict')}</span>
                <button
                  type="button"
                  className="text-gk-blue hover:underline"
                  onClick={() => {
                    setEdit({ text: conflict.body, baseUpdatedAt: conflict.updatedAt, baseBody: conflict.body });
                    setConflict(null);
                  }}
                >
                  {t('issues-description-show-new')}
                </button>
                <button type="button" data-testid="description-save-mine" className="text-gk-blue hover:underline" onClick={() => void save(true)}>
                  {t('issues-description-save-mine')}
                </button>
              </div>
            )}
            <MarkdownEditor
              value={edit.text}
              onChange={(text) => setEdit((cur) => (cur ? { ...cur, text } : cur))}
              draft={{ path: repoPath, slot: { number: issue.number, field: 'body' } }}
              minRows={6}
              maxRows={24}
              allowEmpty
              autoFocus
              busy={saving}
              onSubmit={() => void save()}
              onCancel={() => {
                clearDraft(repoPath, slot);
                setEdit(null);
                setConflict(null);
              }}
              submitLabel={t('issues-comment-save')}
              render={actions.render}
              issues={actions.issues}
              members={actions.members}
            />
          </div>
        ) : (
          <div className="px-3 py-2">
            {!issue.body.trim() ? (
              <span className="text-xs text-gk-dim italic">
                {t('issues-no-description')}
                {editable && (
                  <>
                    {' · '}
                    <button type="button" onClick={start} className="text-gk-blue not-italic hover:underline">
                      {t('issues-description-add')}
                    </button>
                  </>
                )}
              </span>
            ) : issue.bodyHtml ? (
              <Markdown key={revision} html={issue.bodyHtml} onTaskToggle={onTaskToggle} onIssueClick={actions.onIssueClick} onOpenLink={actions.onOpenLink} />
            ) : (
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-gk-text">{issue.body}</div>
            )}
          </div>
        )}
      </div>
    </li>
  );
});

export default memo(IssueDescription);
