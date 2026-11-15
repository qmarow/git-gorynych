/**
 * Новое в 2.0: панель массовых действий над списком задач — вместо панели фильтров, пока выделена хотя бы одна задача.
 *
 * «Выбрано N», «Закрыть», «Открыть заново», «Метки» (выбранная метка добавляется или снимается у каждой задачи, остальные
 * метки не трогаются), «Исполнитель», «Веха», «Снять выделение» (Esc). Выполнение — `issuesStore.bulkUpdate` (по 4
 * запроса); во время работы — «Готово 7 из 20» и «Остановить». По окончании — уведомление «Изменено N, ошибок M»;
 * задачи с ошибками остаются выделенными, «Повторить для неудавшихся». Закрытие больше 10 задач — через подтверждение.
 */
import { useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Flag, RotateCcw, Square, Tag, User, X } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs.tsx';
import { plural } from '../../lib/format.ts';
import type { Issue, IssuePatch } from '../../lib/issues.ts';
import { issuesStore, type RepoIssues } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueLabel_Serialize, IssueMilestone_Serialize, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssuePicker from './IssuePicker.tsx';
import { LabelChip, UserAvatar, userName } from './IssueBits.tsx';

const CONFIRM_CLOSE = 10;

/** «21 задачу», «3 задачи», «5 задач». */
const issuesCount = (n: number) => plural(n, t('issues-count-one', n), t('issues-count-few', n), t('issues-count-many', n));

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

interface IssueBulkBarProps {
  repoPath: string;
  repo: RepoIssues;
  selected: ReadonlySet<number>;
  onSelection: (next: Set<number>) => void;
  notify: Notify;
}

const labelRefs = (labels: readonly IssueLabel_Serialize[]) => labels.map((l) => ({ id: l.id, name: l.name }));

export default function IssueBulkBar({ repoPath, repo, selected, onSelection, notify }: IssueBulkBarProps) {
  const store = issuesStore.getState;
  const [picker, setPicker] = useState<{ kind: 'labels' | 'assignee' | 'milestone'; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const caps = repo.caps;
  const numbers = [...selected];
  const items = repo.items.filter((i) => selected.has(i.number));

  const run = async (list: readonly number[], makePatch: (issue: Issue) => IssuePatch | null) => {
    const res = await store().bulkUpdate(repoPath, list, makePatch);
    const retry = () => void run(res.failed, makePatch);
    notify({
      type: res.failed.length ? 'error' : 'success',
      title: t('issues-bulk-done', res.ok.length, res.failed.length),
      action: res.failed.length ? { label: t('issues-bulk-retry'), onClick: retry } : undefined,
    });
    onSelection(new Set(res.failed));
  };

  const close = () => (numbers.length > CONFIRM_CLOSE ? setConfirm(true) : void run(numbers, (i) => (i.state === 'open' ? { state: 'closed' } : null)));
  const toggleLabel = (name: string) => {
    const label = repo.meta?.labels.find((l) => l.name === name);
    if (!label) return;
    // Метка у всех выбранных — снять, иначе — поставить тем, у кого её нет
    const all = items.length > 0 && items.every((i) => i.labels.some((l) => l.name === name));
    void run(numbers, (i) => {
      const has = i.labels.some((l) => l.name === name);
      if (all) return has ? { labels: labelRefs(i.labels.filter((l) => l.name !== name)) } : null;
      return has ? null : { labels: [...labelRefs(i.labels), { id: label.id, name: label.name }] };
    });
  };

  const bulk = repo.bulk;
  const button = (id: string, icon: typeof Tag, label: string, onClick: (el: HTMLButtonElement) => void, show = true) =>
    show && (
      <button
        ref={(el) => {
          buttons.current[id] = el;
        }}
        type="button"
        data-testid={`bulk-${id}`}
        disabled={Boolean(bulk)}
        onClick={(e) => onClick(e.currentTarget)}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-gk-text hover:bg-gk-hover disabled:opacity-40"
      >
        {(() => {
          const Icon = icon;
          return <Icon size={13} />;
        })()}
        {label}
      </button>
    );

  return (
    <div data-testid="issue-bulk-bar" className="flex shrink-0 flex-col gap-1.5 border-b border-gk-border bg-gk-blue/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-semibold text-gk-strong" data-testid="bulk-count">
          {t('issues-bulk-selected', numbers.length)}
        </span>
        {button('close', CheckCircle2, t('issues-bulk-close'), close, Boolean(caps?.close))}
        {button('reopen', RotateCcw, t('issues-bulk-reopen'), () => void run(numbers, (i) => (i.state === 'closed' ? { state: 'open' } : null)), Boolean(caps?.close))}
        {button('labels', Tag, t('issues-meta-labels'), (el) => setPicker({ kind: 'labels', anchor: el }), Boolean(caps?.edit && caps.labels))}
        {button('assignee', User, t('issues-bulk-assignee'), (el) => setPicker({ kind: 'assignee', anchor: el }), Boolean(caps?.edit))}
        {button('milestone', Flag, t('issues-meta-milestone'), (el) => setPicker({ kind: 'milestone', anchor: el }), Boolean(caps?.edit && caps.milestones))}
        <span className="flex-1" />
        <button type="button" data-testid="bulk-clear" onClick={() => onSelection(new Set())} className="flex items-center gap-1 rounded px-1.5 py-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <X size={13} />
          {t('issues-bulk-clear')}
        </button>
      </div>
      {bulk && (
        <div data-testid="bulk-progress" className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gk-hover">
            <div className="h-full bg-gk-blue transition-[width]" style={{ width: `${(bulk.done / Math.max(1, bulk.total)) * 100}%` }} />
          </div>
          <span className="text-gk-muted">{t('issues-bulk-progress', bulk.done, bulk.total)}</span>
          <button type="button" data-testid="bulk-stop" onClick={() => store().stopBulk(repoPath)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-gk-red hover:bg-gk-red/10">
            <Square size={11} />
            {t('issues-bulk-stop')}
          </button>
        </div>
      )}
      {picker?.kind === 'labels' && (
        <IssuePicker<IssueLabel_Serialize>
          anchor={picker.anchor}
          items={repo.meta?.labels ?? []}
          getId={(l) => l.name}
          selectedIds={(repo.meta?.labels ?? []).filter((l) => items.length > 0 && items.every((i) => i.labels.some((x) => x.name === l.name))).map((l) => l.name)}
          getSearchText={(l) => l.name}
          renderItem={(l) => (
            <span className="flex">
              <LabelChip label={l} />
            </span>
          )}
          onToggle={(name) => name && toggleLabel(name)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === 'assignee' && (
        <IssuePicker<IssueUser_Serialize>
          anchor={picker.anchor}
          items={repo.meta?.members ?? []}
          getId={(u) => u.login}
          selectedIds={[]}
          getSearchText={(u) => `${u.name ?? ''} ${u.login}`}
          renderItem={(u) => (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar user={u} size={18} tip={false} />
              <span className="truncate">{userName(u)}</span>
            </span>
          )}
          noneLabel={t('issues-no-assignee')}
          onToggle={(login) => {
            const user = repo.meta?.members.find((u) => u.login === login);
            void run(numbers, () => ({ assignees: user ? [{ id: user.id, login: user.login }] : [] }));
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === 'milestone' && (
        <IssuePicker<IssueMilestone_Serialize>
          anchor={picker.anchor}
          items={repo.meta?.milestones ?? []}
          getId={(m) => m.id || m.title}
          selectedIds={[]}
          getSearchText={(m) => m.title}
          renderItem={(m) => <span className="truncate">{m.title}</span>}
          noneLabel={t('issues-no-milestone')}
          onToggle={(id) => {
            const m = repo.meta?.milestones.find((x) => (x.id || x.title) === id);
            void run(numbers, () => (m ? { milestone: { id: m.id, number: m.number, title: m.title } } : { clearMilestone: true }));
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog title={t('issues-bulk-close-title', issuesCount(numbers.length))} confirmLabel={t('issues-bulk-close')} onConfirm={() => void run(numbers, (i) => (i.state === 'open' ? { state: 'closed' } : null))} onClose={() => setConfirm(false)}>
          {t('issues-bulk-close-text', numbers.length)}
        </ConfirmDialog>
      )}
    </div>
  );
}
