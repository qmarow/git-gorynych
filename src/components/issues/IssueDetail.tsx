/**
 * Новое в 2.0: карточка задачи — заголовок, строка состояния, прокручиваемая лента, приклеенное снизу поле комментария
 * и панель свойств (справа, а в карточке уже 720 px — над лентой).
 *
 * Пока идёт запрос, видны данные из списка. Комментарий (`commentAdd`) появляется в ленте сразу полупрозрачным; поле
 * очищается, а при ошибке текст возвращается в него и показывается уведомление; после ответа лента прокручивается к нему.
 * Удаление комментария — через `ConfirmDialog`. Флажки списка задач в описании меняют описание (`update` с `body`) при
 * `caps.edit`; при отказе флажок возвращается. Поля нет при `caps.comment === false`; в заблокированном обсуждении без
 * права правки — строка «Обсуждение заблокировано». Ключ компонента — номер задачи: при открытии карточка вверху.
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Lock, MessageSquare } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs.tsx';
import { relativeTime, shortDate } from '../../lib/format.ts';
import { saveDraft } from '../../lib/issueDrafts.ts';
import { appendQuote, toggleTask } from '../../lib/markdownEdit.ts';
import type { Issue } from '../../lib/issues.ts';
import { issuesStore, type DetailEntry } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps, IssueComment_Serialize, IssueMeta_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssueTimeline from './IssueTimeline.tsx';
import IssueMetaPanel from './IssueMetaPanel.tsx';
import MarkdownEditor from './MarkdownEditor.tsx';
import type { CommentActions } from './IssueCommentItem.tsx';
import { ErrorBar, StateIcon, stateTitle, userName } from './IssueBits.tsx';

const COMPACT = 720;

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

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
}

const IssueDetail = forwardRef<HTMLDivElement, IssueDetailProps>(function IssueDetail(
  { repoPath, issue: fromList, entry, caps, meta, issues, onBack, onOpenIssue, onOpenWeb, onCopy, notify },
  ref,
) {
  const issue = entry?.detail?.issue ?? fromList;
  const number = issue.number;
  const store = issuesStore.getState;
  const rootEl = useRef<HTMLDivElement | null>(null);
  const scrollEl = useRef<HTMLDivElement>(null);
  const commentArea = useRef<HTMLTextAreaElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<IssueComment_Serialize | null>(null);
  const [revision, setRevision] = useState(0);
  const scrollTo = useRef<string | null>(null);

  useEffect(() => {
    const el = rootEl.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  const lockedOut = issue.locked && !caps?.edit;

  const quote = useCallback(
    (text: string) => {
      setComment((cur) => {
        const next = appendQuote(cur, text);
        saveDraft(repoPath, { number, field: 'comment' }, next);
        return next;
      });
      requestAnimationFrame(() => {
        const el = commentArea.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.scrollIntoView({ block: 'nearest' });
      });
    },
    [repoPath, number],
  );

  const send = async () => {
    const body = comment;
    if (!body.trim() || sending) return;
    setSending(true);
    setComment('');
    requestAnimationFrame(() => scrollEl.current?.scrollTo({ top: scrollEl.current.scrollHeight }));
    const res = await store().commentAdd(repoPath, number, body);
    setSending(false);
    if (res.ok) {
      scrollTo.current = res.data.id;
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
      if (body == null) {
        setRevision((r) => r + 1);
        return;
      }
      const res = await store().update(repoPath, number, { body });
      if (!res.ok) {
        setRevision((r) => r + 1);
        notify({ type: 'error', title: t('issues-update-failed'), hint: res.error.message });
      }
    },
    [repoPath, number, issue.body, notify, store],
  );

  const deleteComment = async (target: IssueComment_Serialize) => {
    const res = await store().commentDelete(repoPath, number, target.id);
    if (!res.ok) notify({ type: 'error', title: t('issues-comment-delete-failed'), hint: res.error.message });
  };

  const setRefs = (el: HTMLDivElement | null) => {
    rootEl.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const meta_ = <IssueMetaPanel issue={issue} caps={caps} onOpenWeb={onOpenWeb} compact={compact} />;

  return (
    <div ref={setRefs} tabIndex={-1} data-testid="issue-detail" data-number={number} className="flex min-h-0 flex-1 flex-col outline-none animate-fade-in">
      <header className="shrink-0 border-b border-gk-border px-5 pt-3 pb-2.5">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-gk-blue hover:underline">
            <ArrowLeft size={13} />
            {t('issues-back-to-list')}
          </button>
        )}
        <h1 className="text-lg leading-snug font-semibold break-words text-gk-strong" data-testid="issue-title">
          {issue.title} <span className="font-normal text-gk-dim">#{number}</span>
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gk-muted">
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${issue.state === 'open' ? 'bg-gk-green/15 text-gk-green' : 'bg-gk-purple/15 text-gk-purple'}`}>
            <StateIcon issue={issue} size={13} />
            {stateTitle(issue)}
          </span>
          {issue.author && <span className="font-medium text-gk-text">{userName(issue.author)}</span>}
          <span data-tip={shortDate(issue.createdAt)}>{t('issues-opened-ago', relativeTime(issue.createdAt))}</span>
          <span className="flex items-center gap-1">
            <MessageSquare size={12} />
            {issue.commentsCount}
          </span>
          {issue.locked && (
            <span className="flex items-center gap-1" data-tip={t('issues-meta-locked')}>
              <Lock size={12} />
            </span>
          )}
        </div>
      </header>
      {entry?.status === 'error' && entry.error && (
        <ErrorBar message={`${t('issues-card-failed')}: ${entry.error.message}`} onRetry={() => void store().select(repoPath, number)} />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollEl} data-testid="issue-scroll" className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {compact && <div className="-mx-5 -mt-3 mb-2">{meta_}</div>}
            <IssueTimeline
              issue={issue}
              timeline={timeline}
              truncated={entry?.detail?.timelineTruncated ?? false}
              loading={entry?.status === 'loading'}
              actions={actions}
              onTaskToggle={caps?.edit ? onTaskToggle : undefined}
              descriptionRevision={revision}
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
                minRows={2}
                maxRows={12}
                onSubmit={() => void send()}
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
        {!compact && <div className="w-60 shrink-0 overflow-y-auto border-l border-gk-border">{meta_}</div>}
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
