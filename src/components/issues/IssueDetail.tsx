/**
 * Новое в 2.0: карточка задачи — шапка (`IssueTitleBar`: заголовок, состояние, меню), прокручиваемая лента с описанием
 * (`IssueDescription`), приклеенное снизу поле комментария и панель свойств (`IssueMetaPanel`: справа, а в карточке
 * уже 720 px — над лентой).
 *
 * Пока идёт запрос, видны данные из списка. Комментарий (`commentAdd`) появляется в ленте сразу полупрозрачным; поле
 * очищается, а при ошибке текст возвращается и показывается уведомление; после ответа лента прокручивается к нему.
 * «Отправить и закрыть задачу» (Ctrl+Shift+Enter): сначала комментарий, после успеха — смена состояния; ошибка
 * комментария её отменяет. Закрытие — уведомление «Задача #N закрыта» с «Отменить». Свойства, заголовок, блокировка —
 * `update` (откат и «Повторить» при ошибке); удаление — `remove`. Без `caps.edit` элементов изменения нет. Поля
 * комментария нет при `caps.comment === false`; в заблокированном обсуждении без права правки — «Обсуждение
 * заблокировано». Ключ компонента — номер задачи: при открытии карточка вверху. Клавиши раздела (E, R, L, A, M) —
 * через `IssueDetailHandle`.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs.tsx';
import { saveDraft } from '../../lib/issueDrafts.ts';
import { appendQuote } from '../../lib/markdownEdit.ts';
import { nextLabelColor, propsPatch, toggleTask, type Issue, type IssuePatch } from '../../lib/issues.ts';
import { issuesStore, type DetailEntry } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps, IssueComment_Serialize, IssueMeta_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssueTimeline from './IssueTimeline.tsx';
import IssueMetaPanel, { type MetaChange, type MetaPanelHandle, type MetaPicker } from './IssueMetaPanel.tsx';
import IssueTitleBar, { type TitleBarHandle } from './IssueTitleBar.tsx';
import IssueDescription from './IssueDescription.tsx';
import MarkdownEditor from './MarkdownEditor.tsx';
import type { CommentActions } from './IssueCommentItem.tsx';
import { ErrorBar } from './IssueBits.tsx';

const COMPACT = 720;

export type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

export interface IssueDetailHandle {
  focus: () => void;
  editTitle: () => void;
  focusComment: () => void;
  openPicker: (kind: MetaPicker) => void;
}

interface IssueDetailProps {
  repoPath: string;
  issue: Issue;
  entry: DetailEntry | undefined;
  caps: IssueCaps | null;
  meta: IssueMeta_Serialize | null;
  /** Задачи для подсказки `#`. */
  issues: readonly Issue[];
  onBack?: () => void;
  onOpenIssue: (number: number) => void;
  onOpenWeb: (url: string) => void;
  onCopy: (text: string, what: string) => void;
  notify: Notify;
  /** Кнопки шапки перед кнопкой состояния (этап 6: «Создать ветку»). */
  extra?: ReactNode;
}

const IssueDetail = forwardRef<IssueDetailHandle, IssueDetailProps>(function IssueDetail(
  { repoPath, issue: fromList, entry, caps, meta, issues, onBack, onOpenIssue, onOpenWeb, onCopy, notify, extra },
  ref,
) {
  const issue = entry?.detail?.issue ?? fromList;
  const number = issue.number;
  const store = issuesStore.getState;
  const rootEl = useRef<HTMLDivElement>(null);
  const scrollEl = useRef<HTMLDivElement>(null);
  const commentArea = useRef<HTMLTextAreaElement | null>(null);
  const titleBar = useRef<TitleBarHandle>(null);
  const metaPanel = useRef<MetaPanelHandle>(null);
  const [compact, setCompact] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<IssueComment_Serialize | null>(null);
  const [revision, setRevision] = useState(0);
  const scrollTo = useRef<string | null>(null);
  const editable = Boolean(caps?.edit);

  useEffect(() => {
    const el = rootEl.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const focusComment = () => {
    const el = commentArea.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: 'nearest' });
  };

  useImperativeHandle(ref, () => ({
    focus: () => rootEl.current?.focus(),
    editTitle: () => titleBar.current?.editTitle(),
    focusComment,
    openPicker: (kind) => metaPanel.current?.open(kind),
  }));

  const timeline = entry?.detail?.timeline ?? null;
  // Свой комментарий после ответа — в поле зрения
  useEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    const el = scrollEl.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id)}"]`);
    if (!el) return;
    scrollTo.current = null;
    el.scrollIntoView({ block: 'nearest' });
  }, [timeline]);

  const render = useCallback((text: string) => store().renderMarkdown(repoPath, text), [repoPath, store]);
  const canComment = caps?.comment !== false && Boolean(caps);
  const lockedOut = issue.locked && !editable;

  /** Правка задачи; ошибка — уведомление с «Повторить» (значения уже вернул `issuesStore`). */
  const change = useCallback(
    async (patch: IssuePatch, after?: () => void): Promise<boolean> => {
      const res = await store().update(repoPath, number, patch);
      if (res.ok) {
        after?.();
        return true;
      }
      notify({ type: 'error', title: t('issues-update-failed'), hint: res.error.message, action: { label: t('issues-retry'), onClick: () => void change(patch, after) } });
      return false;
    },
    [repoPath, number, notify, store],
  );

  const setState = useCallback(
    (state: 'open' | 'closed', reason: string | null) =>
      change({ state, stateReason: state === 'closed' ? reason : null }, () => {
        if (state === 'closed') {
          notify({ type: 'success', title: t('issues-closed-toast', number), action: { label: t('issues-undo'), onClick: () => void change({ state: 'open', stateReason: null }) } });
        }
      }),
    [change, notify, number],
  );

  const quote = useCallback(
    (text: string) => {
      setComment((cur) => {
        const next = appendQuote(cur, text);
        saveDraft(repoPath, { number, field: 'comment' }, next);
        return next;
      });
      requestAnimationFrame(focusComment);
    },
    [repoPath, number],
  );

  const send = async (thenState?: 'open' | 'closed') => {
    const body = comment;
    if (!body.trim() || sending) return;
    setSending(true);
    setComment('');
    requestAnimationFrame(() => scrollEl.current?.scrollTo({ top: scrollEl.current.scrollHeight }));
    const res = await store().commentAdd(repoPath, number, body);
    setSending(false);
    if (res.ok) {
      scrollTo.current = res.data.id;
      if (thenState) void setState(thenState, thenState === 'closed' && caps?.closeReasons.includes('completed') ? 'completed' : null);
      return;
    }
    setComment((cur) => (cur ? `${body}\n\n${cur}` : body));
    notify({ type: 'error', title: t('issues-comment-failed'), hint: res.error.message });
    requestAnimationFrame(() => commentArea.current?.focus());
  };

  const actions: CommentActions = useMemo(
    () => ({
      canQuote: canComment && !lockedOut,
      canEdit: caps?.editComments ?? false,
      canDelete: caps?.deleteComments ?? false,
      onQuote: quote,
      onSave: async (id, body) => {
        const res = await store().commentUpdate(repoPath, number, id, body);
        if (res.ok) return null;
        notify({ type: 'error', title: t('issues-comment-save-failed'), hint: res.error.message });
        return res.error.message;
      },
      onDelete: setConfirm,
      onIssueClick: onOpenIssue,
      onOpenLink: onOpenWeb,
      onCopy,
      render,
      issues,
      members: meta?.members ?? [],
    }),
    [canComment, lockedOut, caps?.editComments, caps?.deleteComments, quote, repoPath, number, notify, onOpenIssue, onOpenWeb, onCopy, render, issues, meta?.members, store],
  );

  const onTaskToggle = useCallback(
    async (index: number, checked: boolean) => {
      const current = issuesStore.getState().byRepo[repoPath]?.details[number]?.detail?.issue.body ?? issue.body;
      const body = toggleTask(current, index, checked);
      if (body == null || !(await change({ body }))) setRevision((r) => r + 1);
    },
    [repoPath, number, issue.body, change],
  );

  const onMeta = useCallback((next: MetaChange) => void change(propsPatch(next)), [change]);
  const onCreateLabel = useCallback(
    async (name: string) => {
      const res = await store().labelCreate(repoPath, name, nextLabelColor(meta?.labels.length ?? 0));
      if (res.ok) return res.data;
      notify({ type: 'error', title: t('issues-label-create-failed'), hint: res.error.message });
      return null;
    },
    [repoPath, meta?.labels.length, notify, store],
  );

  const remove = async () => {
    const res = await store().remove(repoPath, number);
    if (res.ok) notify({ type: 'success', title: t('issues-deleted-toast', number) });
    else notify({ type: 'error', title: t('issues-delete-failed'), hint: res.error.message });
  };

  const deleteComment = async (target: IssueComment_Serialize) => {
    const res = await store().commentDelete(repoPath, number, target.id);
    if (!res.ok) notify({ type: 'error', title: t('issues-comment-delete-failed'), hint: res.error.message });
  };

  const values = useMemo(
    () => ({ assignees: issue.assignees, labels: issue.labels, milestone: issue.milestone, dueDate: issue.dueDate, confidential: issue.confidential }),
    [issue.assignees, issue.labels, issue.milestone, issue.dueDate, issue.confidential],
  );
  const metaPanelNode = (
    <IssueMetaPanel
      ref={metaPanel}
      values={values}
      caps={caps}
      meta={meta}
      editable={editable}
      onChange={onMeta}
      onCreateLabel={onCreateLabel}
      issue={issue}
      onOpenWeb={onOpenWeb}
      compact={compact}
    />
  );
  const otherState = issue.state === 'open' ? 'closed' : 'open';

  return (
    <div ref={rootEl} tabIndex={-1} data-testid="issue-detail" data-number={number} className="flex min-h-0 flex-1 flex-col outline-none animate-fade-in">
      <IssueTitleBar
        ref={titleBar}
        issue={issue}
        caps={caps}
        onBack={onBack}
        onRename={(title) => void change({ title })}
        onState={(state, reason) => void setState(state, reason)}
        onLock={(locked) => void change({ locked })}
        onDelete={() => void remove()}
        onCopy={onCopy}
        onOpenWeb={onOpenWeb}
        extra={extra}
      />
      {entry?.status === 'error' && entry.error && (
        <ErrorBar message={`${t('issues-card-failed')}: ${entry.error.message}`} onRetry={() => void store().select(repoPath, number)} />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollEl} data-testid="issue-scroll" className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {compact && <div className="-mx-5 -mt-3 mb-2">{metaPanelNode}</div>}
            <IssueTimeline
              issue={issue}
              timeline={timeline}
              truncated={entry?.detail?.timelineTruncated ?? false}
              loading={entry?.status === 'loading'}
              actions={actions}
              description={
                <IssueDescription
                  repoPath={repoPath}
                  issue={issue}
                  editable={editable}
                  actions={actions}
                  onTaskToggle={editable ? (i, c) => void onTaskToggle(i, c) : undefined}
                  revision={revision}
                  notify={notify}
                />
              }
            />
          </div>
          {lockedOut ? (
            <div data-testid="issue-locked" className="flex shrink-0 items-center gap-2 border-t border-gk-border px-5 py-2.5 text-xs text-gk-muted">
              <Lock size={13} />
              {t('issues-discussion-locked')}
            </div>
          ) : canComment ? (
            <div className="shrink-0 border-t border-gk-border px-5 py-2.5">
              <MarkdownEditor
                value={comment}
                onChange={setComment}
                draft={{ path: repoPath, slot: { number, field: 'comment' } }}
                placeholder={t('issues-comment-placeholder')}
                minRows={3}
                maxRows={12}
                onSubmit={() => void send()}
                secondaryLabel={caps?.close ? (otherState === 'closed' ? t('issues-send-and-close') : t('issues-send-and-reopen')) : undefined}
                onSecondarySubmit={caps?.close ? () => void send(otherState) : undefined}
                busy={sending}
                submitLabel={t('issues-comment-send')}
                render={render}
                issues={issues}
                members={meta?.members ?? []}
                textareaRef={(el) => (commentArea.current = el)}
              />
            </div>
          ) : null}
        </div>
        {!compact && <div className="w-[260px] shrink-0 overflow-y-auto border-l border-gk-border">{metaPanelNode}</div>}
      </div>
      {confirm && (
        <ConfirmDialog title={t('issues-comment-delete')} danger confirmLabel={t('issues-comment-delete')} onConfirm={() => void deleteComment(confirm)} onClose={() => setConfirm(null)}>
          {t('issues-comment-delete-confirm')}
        </ConfirmDialog>
      )}
    </div>
  );
});

export default IssueDetail;
