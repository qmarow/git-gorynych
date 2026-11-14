/**
 * Новое в 2.0: панель свойств задачи — исполнители, метки, веха, срок, конфиденциальность; в карточке ещё блокировка,
 * автор и даты.
 *
 * Изменение — через `IssuePicker` (срок — `DatePopover`), у каждого блока заголовок и шестерёнка, клик по ним открывает
 * выбор. Быстрые клики в одном выборе объединяются: интерфейс меняется сразу (`pending`), а `onChange` с полным новым
 * значением уходит через 400 мс после последнего клика или при закрытии выбора. Откат при ошибке — у вызывающего
 * (`issuesStore.update` возвращает прежнее). Без права правки (`editable === false`) шестерёнок и быстрых ссылок нет.
 * Та же панель — в форме новой задачи: там `onChange` меняет черновик, а не сервер. Клавиши L / A / M открывают выбор
 * через `open(kind)`.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, ExternalLink, Flag, Lock, Settings, ShieldAlert } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import { isOverdue, localDate, type Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps, IssueLabel_Serialize, IssueMeta_Serialize, IssueMilestone_Serialize, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssuePicker from './IssuePicker.tsx';
import DatePopover from './DatePopover.tsx';
import { LabelChip, UserAvatar, userName } from './IssueBits.tsx';

const COMMIT_DELAY = 400;

export interface MetaValues {
  assignees: IssueUser_Serialize[];
  labels: IssueLabel_Serialize[];
  milestone: IssueMilestone_Serialize | null;
  dueDate: string | null;
  confidential: boolean;
}

export type MetaChange = Partial<MetaValues>;
export type MetaPicker = 'assignees' | 'labels' | 'milestone' | 'due';

export interface MetaPanelHandle {
  open: (kind: MetaPicker) => void;
}

interface IssueMetaPanelProps {
  values: MetaValues;
  caps: IssueCaps | null;
  meta: IssueMeta_Serialize | null;
  editable: boolean;
  onChange: (change: MetaChange) => void;
  onCreateLabel?: (name: string) => Promise<IssueLabel_Serialize | null>;
  /** Карточка: блокировка, автор, даты и «Открыть на сервере». В форме новой задачи — нет. */
  issue?: Issue;
  onOpenWeb?: (url: string) => void;
  compact?: boolean;
}

const sameUser = (a: IssueUser_Serialize, b: IssueUser_Serialize) => (a.id && b.id ? a.id === b.id : a.login === b.login);
const userId = (u: IssueUser_Serialize) => u.login || u.id;
const labelId = (l: IssueLabel_Serialize) => l.id || l.name;
const milestoneId = (m: IssueMilestone_Serialize) => m.id || m.title;

function Section({ title, onEdit, editRef, children, testId }: { title: ReactNode; onEdit?: () => void; editRef?: (el: HTMLButtonElement | null) => void; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="border-b border-gk-border py-2.5 last:border-b-0">
      {onEdit ? (
        <button ref={editRef} type="button" onClick={onEdit} className="group mb-1.5 flex w-full items-center text-[11px] font-semibold tracking-wide text-gk-dim uppercase hover:text-gk-text">
          <span className="flex-1 text-left">{title}</span>
          <Settings size={12} className="opacity-60 group-hover:opacity-100" aria-label={t('issues-meta-change')} />
        </button>
      ) : (
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-gk-dim uppercase">{title}</h3>
      )}
      <div className="text-xs text-gk-text">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => <span className="text-gk-dim">{children}</span>;

const IssueMetaPanel = forwardRef<MetaPanelHandle, IssueMetaPanelProps>(function IssueMetaPanel(
  { values, caps, meta, editable, onChange, onCreateLabel, issue, onOpenWeb, compact = false },
  ref,
) {
  const [pending, setPending] = useState<MetaChange>({});
  const [picker, setPicker] = useState<MetaPicker | null>(null);
  const anchors = useRef<Partial<Record<MetaPicker, HTMLButtonElement | null>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<MetaChange>({});
  const live = useRef(onChange);
  live.current = onChange;

  const shown: MetaValues = { ...values, ...pending };

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    const change = pendingRef.current;
    pendingRef.current = {};
    setPending({});
    if (Object.keys(change).length) live.current(change);
  }, []);

  useEffect(() => () => commit(), [commit]);

  const stage = (change: MetaChange, now = false) => {
    pendingRef.current = { ...pendingRef.current, ...change };
    setPending(pendingRef.current);
    clearTimeout(timer.current);
    if (now) commit();
    else timer.current = setTimeout(commit, COMMIT_DELAY);
  };

  const close = useCallback(() => {
    setPicker(null);
    commit();
  }, [commit]);

  const openPicker = (kind: MetaPicker) => {
    if (!editable) return;
    if (kind === 'labels' && caps?.labels === false) return;
    if (kind === 'milestone' && caps?.milestones === false) return;
    if (kind === 'due' && !caps?.dueDate) return;
    if (anchors.current[kind]) setPicker(kind);
  };
  useImperativeHandle(ref, () => ({ open: openPicker }));

  const me = meta?.me ?? null;
  const members = me ? [me, ...(meta?.members ?? []).filter((u) => !sameUser(u, me))] : (meta?.members ?? []);
  const assignedMe = Boolean(me && shown.assignees.some((u) => sameUser(u, me)));
  const today = localDate(new Date());
  const overdue = isOverdue({ state: issue?.state ?? 'open', dueDate: shown.dueDate }, today);
  const anchor = (kind: MetaPicker) => (el: HTMLButtonElement | null) => {
    anchors.current[kind] = el;
  };
  const edit = (kind: MetaPicker) => (editable ? () => setPicker((p) => (p === kind ? null : kind)) : undefined);

  const toggleAssignee = (id: string | null) => {
    const user = members.find((u) => userId(u) === id) ?? shown.assignees.find((u) => userId(u) === id);
    if (!user) return;
    const has = shown.assignees.some((u) => sameUser(u, user));
    if (caps?.multipleAssignees) stage({ assignees: has ? shown.assignees.filter((u) => !sameUser(u, user)) : [...shown.assignees, user] });
    else stage({ assignees: has ? [] : [user] }, true);
  };
  const toggleLabel = (id: string | null) => {
    const label = (meta?.labels ?? []).find((l) => labelId(l) === id) ?? shown.labels.find((l) => labelId(l) === id);
    if (!label) return;
    const has = shown.labels.some((l) => labelId(l) === labelId(label) || l.name === label.name);
    stage({ labels: has ? shown.labels.filter((l) => !(labelId(l) === labelId(label) || l.name === label.name)) : [...shown.labels, label] });
  };

  return (
    <aside data-testid="issue-meta" className={compact ? 'grid grid-cols-2 gap-x-4 border-b border-gk-border px-4 pb-1' : 'flex flex-col px-4 py-1'}>
      <Section title={t('issues-meta-assignees')} onEdit={edit('assignees')} editRef={anchor('assignees')} testId="meta-assignees">
        {shown.assignees.length ? (
          <ul className="flex flex-col gap-1.5">
            {shown.assignees.map((user) => (
              <li key={userId(user)} className="flex min-w-0 items-center gap-2">
                <UserAvatar user={user} size={18} tip={false} />
                <span className="truncate">{userName(user)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <None>{t('issues-meta-no-assignees')}</None>
        )}
        {editable && me && !assignedMe && (
          <button
            type="button"
            data-testid="assign-me"
            onClick={() => stage({ assignees: caps?.multipleAssignees ? [...shown.assignees, me] : [me] }, true)}
            className="mt-1 block text-gk-blue hover:underline"
          >
            {t('issues-meta-assign-me')}
          </button>
        )}
      </Section>
      {caps?.labels !== false && (
        <Section title={t('issues-meta-labels')} onEdit={edit('labels')} editRef={anchor('labels')} testId="meta-labels">
          {shown.labels.length ? (
            <div className="flex flex-wrap gap-1">
              {shown.labels.map((label) => (
                <LabelChip key={labelId(label)} label={label} />
              ))}
            </div>
          ) : (
            <None>{t('issues-meta-no-labels')}</None>
          )}
        </Section>
      )}
      {caps?.milestones !== false && (
        <Section title={t('issues-meta-milestone')} onEdit={edit('milestone')} editRef={anchor('milestone')} testId="meta-milestone">
          {shown.milestone ? (
            <span className="flex items-center gap-1.5">
              <Flag size={13} className="shrink-0 text-gk-muted" />
              <span className="truncate">{shown.milestone.title}</span>
              {shown.milestone.dueDate && <span className="shrink-0 text-gk-dim">· {shown.milestone.dueDate.slice(0, 10)}</span>}
            </span>
          ) : (
            <None>{t('issues-meta-no-milestone')}</None>
          )}
        </Section>
      )}
      {caps?.dueDate && (
        <Section title={t('issues-meta-due')} onEdit={edit('due')} editRef={anchor('due')} testId="meta-due">
          {shown.dueDate ? (
            <span className={`flex items-center gap-1.5 ${overdue ? 'text-gk-red' : ''}`} data-overdue={overdue || undefined}>
              <CalendarClock size={13} className="shrink-0" />
              {shown.dueDate.slice(0, 10)}
              {overdue && <span>· {t('issues-meta-overdue')}</span>}
            </span>
          ) : (
            <None>{t('issues-meta-no-due')}</None>
          )}
        </Section>
      )}
      {(caps?.confidential || shown.confidential || issue?.locked) && (
        <Section title={t('issues-meta-access')}>
          <div className="flex flex-col gap-1">
            {editable && caps?.confidential ? (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  data-testid="meta-confidential"
                  checked={shown.confidential}
                  onChange={(e) => stage({ confidential: e.target.checked }, true)}
                  className="accent-gk-yellow"
                />
                <ShieldAlert size={13} className={shown.confidential ? 'text-gk-yellow' : 'text-gk-muted'} />
                {t('issues-confidential')}
              </label>
            ) : (
              shown.confidential && (
                <span className="flex items-center gap-1.5 text-gk-yellow">
                  <ShieldAlert size={13} /> {t('issues-confidential')}
                </span>
              )
            )}
            {issue?.locked && (
              <span className="flex items-center gap-1.5">
                <Lock size={13} className="text-gk-muted" /> {t('issues-meta-locked')}
              </span>
            )}
          </div>
        </Section>
      )}
      {issue && (
        <Section title={t('issues-meta-info')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            {issue.author && (
              <>
                <dt className="text-gk-dim">{t('issues-meta-author')}</dt>
                <dd className="truncate">{userName(issue.author)}</dd>
              </>
            )}
            <dt className="text-gk-dim">{t('issues-meta-created')}</dt>
            <dd data-tip={shortDate(issue.createdAt)}>{relativeTime(issue.createdAt)}</dd>
            <dt className="text-gk-dim">{t('issues-meta-updated')}</dt>
            <dd data-tip={shortDate(issue.updatedAt)}>{relativeTime(issue.updatedAt)}</dd>
            {issue.closedAt && (
              <>
                <dt className="text-gk-dim">{t('issues-meta-closed')}</dt>
                <dd data-tip={shortDate(issue.closedAt)}>{relativeTime(issue.closedAt)}</dd>
              </>
            )}
          </dl>
          {onOpenWeb && (
            <button type="button" onClick={() => onOpenWeb(issue.webUrl)} className="mt-2 flex items-center gap-1 text-gk-blue hover:underline">
              <ExternalLink size={12} />
              {t('issues-open-on-server')}
            </button>
          )}
        </Section>
      )}

      {picker === 'assignees' && anchors.current.assignees && (
        <IssuePicker<IssueUser_Serialize>
          anchor={anchors.current.assignees}
          items={members}
          getId={userId}
          selectedIds={shown.assignees.map(userId)}
          multiple={Boolean(caps?.multipleAssignees)}
          getSearchText={(u) => `${u.name ?? ''} ${u.login}`}
          renderItem={(u) => (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar user={u} size={18} tip={false} />
              <span className="truncate">{userName(u)}</span>
              <span className="shrink-0 text-gk-dim">@{u.login}</span>
            </span>
          )}
          onToggle={toggleAssignee}
          onClose={close}
        />
      )}
      {picker === 'labels' && anchors.current.labels && (
        <IssuePicker<IssueLabel_Serialize>
          anchor={anchors.current.labels}
          items={meta?.labels ?? []}
          getId={labelId}
          selectedIds={shown.labels.map(labelId)}
          multiple
          getSearchText={(l) => `${l.name} ${l.description ?? ''}`}
          renderItem={(l) => (
            <span className="flex min-w-0 flex-col">
              <span className="flex"><LabelChip label={l} /></span>
              {l.description && <span className="truncate text-[11px] text-gk-dim">{l.description}</span>}
            </span>
          )}
          onToggle={toggleLabel}
          onCreate={
            caps?.createLabel && onCreateLabel
              ? (name) =>
                  void onCreateLabel(name).then((label) => {
                    if (label) stage({ labels: [...pendingRef.current.labels ?? values.labels, label] });
                  })
              : undefined
          }
          onClose={close}
        />
      )}
      {picker === 'milestone' && anchors.current.milestone && (
        <IssuePicker<IssueMilestone_Serialize>
          anchor={anchors.current.milestone}
          items={meta?.milestones ?? []}
          getId={milestoneId}
          selectedIds={shown.milestone ? [milestoneId(shown.milestone)] : []}
          getSearchText={(m) => m.title}
          renderItem={(m) => (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{m.title}</span>
              {m.dueDate && <span className="shrink-0 text-gk-dim">{m.dueDate.slice(0, 10)}</span>}
            </span>
          )}
          noneLabel={t('issues-no-milestone')}
          noneSelected={!shown.milestone}
          onToggle={(id) => stage({ milestone: id == null ? null : ((meta?.milestones ?? []).find((m) => milestoneId(m) === id) ?? null) }, true)}
          onClose={close}
        />
      )}
      {picker === 'due' && anchors.current.due && (
        <DatePopover anchor={anchors.current.due} value={shown.dueDate} onChange={(date) => stage({ dueDate: date }, true)} onClose={close} />
      )}
    </aside>
  );
});

export default memo(IssueMetaPanel);
