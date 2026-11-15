/**
 * ÐÐ¾Ð²Ð¾Ðµ Ð² 2.0: ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ° Ð·Ð°Ð´Ð°Ñ‡Ð¸ â€” ÑˆÐ°Ð¿ÐºÐ° (`IssueTitleBar`: Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº, ÑÐ¾ÑÑ‚Ð¾ÑÐ½Ð¸Ðµ, Ð¼ÐµÐ½ÑŽ), Ð¿Ñ€Ð¾ÐºÑ€ÑƒÑ‡Ð¸Ð²Ð°ÐµÐ¼Ð°Ñ Ð»ÐµÐ½Ñ‚Ð° Ñ Ð¾Ð¿Ð¸ÑÐ°Ð½Ð¸ÐµÐ¼
 * (`IssueDescription`), Ð¿Ñ€Ð¸ÐºÐ»ÐµÐµÐ½Ð½Ð¾Ðµ ÑÐ½Ð¸Ð·Ñƒ Ð¿Ð¾Ð»Ðµ ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ñ Ð¸ Ð¿Ð°Ð½ÐµÐ»ÑŒ ÑÐ²Ð¾Ð¹ÑÑ‚Ð² (`IssueMetaPanel`: ÑÐ¿Ñ€Ð°Ð²Ð°, Ð° Ð² ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐµ
 * ÑƒÐ¶Ðµ 720 px â€” Ð½Ð°Ð´ Ð»ÐµÐ½Ñ‚Ð¾Ð¹).
 *
 * ÐŸÐ¾ÐºÐ° Ð¸Ð´Ñ‘Ñ‚ Ð·Ð°Ð¿Ñ€Ð¾Ñ, Ð²Ð¸Ð´Ð½Ñ‹ Ð´Ð°Ð½Ð½Ñ‹Ðµ Ð¸Ð· ÑÐ¿Ð¸ÑÐºÐ°. ÐšÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¹ (`commentAdd`) Ð¿Ð¾ÑÐ²Ð»ÑÐµÑ‚ÑÑ Ð² Ð»ÐµÐ½Ñ‚Ðµ ÑÑ€Ð°Ð·Ñƒ Ð¿Ð¾Ð»ÑƒÐ¿Ñ€Ð¾Ð·Ñ€Ð°Ñ‡Ð½Ñ‹Ð¼; Ð¿Ð¾Ð»Ðµ
 * Ð¾Ñ‡Ð¸Ñ‰Ð°ÐµÑ‚ÑÑ, Ð° Ð¿Ñ€Ð¸ Ð¾ÑˆÐ¸Ð±ÐºÐµ Ñ‚ÐµÐºÑÑ‚ Ð²Ð¾Ð·Ð²Ñ€Ð°Ñ‰Ð°ÐµÑ‚ÑÑ Ð¸ Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÑ‚ÑÑ ÑƒÐ²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ðµ; Ð¿Ð¾ÑÐ»Ðµ Ð¾Ñ‚Ð²ÐµÑ‚Ð° Ð»ÐµÐ½Ñ‚Ð° Ð¿Ñ€Ð¾ÐºÑ€ÑƒÑ‡Ð¸Ð²Ð°ÐµÑ‚ÑÑ Ðº Ð½ÐµÐ¼Ñƒ.
 * Â«ÐžÑ‚Ð¿Ñ€Ð°Ð²Ð¸Ñ‚ÑŒ Ð¸ Ð·Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ Ð·Ð°Ð´Ð°Ñ‡ÑƒÂ» (Ctrl+Shift+Enter): ÑÐ½Ð°Ñ‡Ð°Ð»Ð° ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¹, Ð¿Ð¾ÑÐ»Ðµ ÑƒÑÐ¿ÐµÑ…Ð° â€” ÑÐ¼ÐµÐ½Ð° ÑÐ¾ÑÑ‚Ð¾ÑÐ½Ð¸Ñ; Ð¾ÑˆÐ¸Ð±ÐºÐ°
 * ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ñ ÐµÑ‘ Ð¾Ñ‚Ð¼ÐµÐ½ÑÐµÑ‚. Ð—Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ â€” ÑƒÐ²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ðµ Â«Ð—Ð°Ð´Ð°Ñ‡Ð° #N Ð·Ð°ÐºÑ€Ñ‹Ñ‚Ð°Â» Ñ Â«ÐžÑ‚Ð¼ÐµÐ½Ð¸Ñ‚ÑŒÂ». Ð¡Ð²Ð¾Ð¹ÑÑ‚Ð²Ð°, Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº, Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²ÐºÐ° â€”
 * `update` (Ð¾Ñ‚ÐºÐ°Ñ‚ Ð¸ Â«ÐŸÐ¾Ð²Ñ‚Ð¾Ñ€Ð¸Ñ‚ÑŒÂ» Ð¿Ñ€Ð¸ Ð¾ÑˆÐ¸Ð±ÐºÐµ); ÑƒÐ´Ð°Ð»ÐµÐ½Ð¸Ðµ â€” `remove`. Ð‘ÐµÐ· `caps.edit` ÑÐ»ÐµÐ¼ÐµÐ½Ñ‚Ð¾Ð² Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ Ð½ÐµÑ‚. ÐŸÐ¾Ð»Ñ
 * ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ñ Ð½ÐµÑ‚ Ð¿Ñ€Ð¸ `caps.comment === false`; Ð² Ð·Ð°Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ð¾Ð¼ Ð¾Ð±ÑÑƒÐ¶Ð´ÐµÐ½Ð¸Ð¸ Ð±ÐµÐ· Ð¿Ñ€Ð°Ð²Ð° Ð¿Ñ€Ð°Ð²ÐºÐ¸ â€” Â«ÐžÐ±ÑÑƒÐ¶Ð´ÐµÐ½Ð¸Ðµ
 * Ð·Ð°Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð¾Â». ÐšÐ»ÑŽÑ‡ ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½Ñ‚Ð° â€” Ð½Ð¾Ð¼ÐµÑ€ Ð·Ð°Ð´Ð°Ñ‡Ð¸: Ð¿Ñ€Ð¸ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚Ð¸Ð¸ ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ° Ð²Ð²ÐµÑ€Ñ…Ñƒ. ÐšÐ»Ð°Ð²Ð¸ÑˆÐ¸ Ñ€Ð°Ð·Ð´ÐµÐ»Ð° (E, R, L, A, M) â€”
 * Ñ‡ÐµÑ€ÐµÐ· `IssueDetailHandle`.
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
import { notifyWriteError } from './issueErrors.ts';
import IssueGitPanel, { type GitTarget } from './IssueGitPanel.tsx';

const COMPACT = 720;
const NO_MEMBERS: never[] = [];

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
  /** Ð—Ð°Ð´Ð°Ñ‡Ð¸ Ð´Ð»Ñ Ð¿Ð¾Ð´ÑÐºÐ°Ð·ÐºÐ¸ `#`. */
  issues: readonly Issue[];
  onBack?: () => void;
  onOpenIssue: (number: number) => void;
  onOpenWeb: (url: string) => void;
  onCopy: (text: string, what: string) => void;
  notify: Notify;
  /** ÐšÐ½Ð¾Ð¿ÐºÐ¸ ÑˆÐ°Ð¿ÐºÐ¸ Ð¿ÐµÑ€ÐµÐ´ ÐºÐ½Ð¾Ð¿ÐºÐ¾Ð¹ ÑÐ¾ÑÑ‚Ð¾ÑÐ½Ð¸Ñ (Â«Ð¡Ð¾Ð·Ð´Ð°Ñ‚ÑŒ Ð²ÐµÑ‚ÐºÑƒÂ»). */
  extra?: ReactNode;
  /** Ð’ÐµÑ‚ÐºÐ¸ Ð¸ ÐºÐ¾Ð¼Ð¼Ð¸Ñ‚Ñ‹ Ð·Ð°Ð´Ð°Ñ‡Ð¸: Ðº ÐºÐ¾Ð¼Ð¼Ð¸Ñ‚Ñƒ Ð² Ð³Ñ€Ð°Ñ„Ðµ, checkout, Ð²ÐµÑ‚ÐºÐ° Ð¸Ð· Ð·Ð°Ð´Ð°Ñ‡Ð¸. */
  onLocate: (hash: string) => void;
  onCheckout?: (target: GitTarget) => void;
  onCreateBranch?: () => void;
}

const IssueDetail = forwardRef<IssueDetailHandle, IssueDetailProps>(function IssueDetail(
  { repoPath, issue: fromList, entry, caps, meta, issues, onBack, onOpenIssue, onOpenWeb, onCopy, notify, extra, onLocate, onCheckout, onCreateBranch },
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
  // Ð¡Ð²Ð¾Ð¹ ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¹ Ð¿Ð¾ÑÐ»Ðµ Ð¾Ñ‚Ð²ÐµÑ‚Ð° â€” Ð² Ð¿Ð¾Ð»Ðµ Ð·Ñ€ÐµÐ½Ð¸Ñ
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

  /** ÐŸÑ€Ð°Ð²ÐºÐ° Ð·Ð°Ð´Ð°Ñ‡Ð¸; Ð¾ÑˆÐ¸Ð±ÐºÐ° â€” ÑƒÐ²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ðµ Ñ Â«ÐŸÐ¾Ð²Ñ‚Ð¾Ñ€Ð¸Ñ‚ÑŒÂ» (Ð·Ð½Ð°Ñ‡ÐµÐ½Ð¸Ñ ÑƒÐ¶Ðµ Ð²ÐµÑ€Ð½ÑƒÐ» `issuesStore`). */
  const change = useCallback(
    async (patch: IssuePatch, after?: () => void): Promise<boolean> => {
      const res = await store().update(repoPath, number, patch);
      if (res.ok) {
        after?.();
        return true;
      }
      notifyWriteError(notify, repoPath, res.error, 'issues-update-failed', () => void change(patch, after));
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
      members: meta?.members ?? NO_MEMBERS,
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

  // Ð­Ð»ÐµÐ¼ÐµÐ½Ñ‚Ñ‹ Ð´Ð»Ñ `memo`-Ð´ÐµÑ‚ÐµÐ¹ â€” Ñ‚Ðµ Ð¶Ðµ Ð¼ÐµÐ¶Ð´Ñƒ Ñ€ÐµÐ½Ð´ÐµÑ€Ð°Ð¼Ð¸: Ð½Ð°Ð±Ð¾Ñ€ ÐºÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ñ Ð½Ðµ Ð¿ÐµÑ€ÐµÑ€Ð¸ÑÐ¾Ð²Ñ‹Ð²Ð°ÐµÑ‚ Ð»ÐµÐ½Ñ‚Ñƒ Ð¸ Ð¿Ð°Ð½ÐµÐ»ÑŒ ÑÐ²Ð¾Ð¹ÑÑ‚Ð²
  const taskToggle = useMemo(() => (editable ? (i: number, c: boolean) => void onTaskToggle(i, c) : undefined), [editable, onTaskToggle]);
  const description = useMemo(
    () => <IssueDescription repoPath={repoPath} issue={issue} editable={editable} actions={actions} onTaskToggle={taskToggle} revision={revision} notify={notify} />,
    [repoPath, issue, editable, actions, taskToggle, revision, notify],
  );
  const gitPanel = useMemo(
    () => <IssueGitPanel number={number} onLocate={onLocate} onCheckout={onCheckout} onCreateBranch={onCreateBranch} />,
    [number, onLocate, onCheckout, onCreateBranch],
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
      git={gitPanel}
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
              description={description}
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
                members={meta?.members ?? NO_MEMBERS}
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
