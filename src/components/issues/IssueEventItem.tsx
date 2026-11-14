/**
 * Новое в 2.0: строка ленты с событиями задачи — одно событие или несколько подряд одного автора за минуту
 * (`mergeTimeline`). Тексты — ключи `issues-ev-*` (имя автора и значение); глаголы по роду не склоняются, поэтому
 * русские тексты построены как «{имя} — задача закрыта». Время — `relativeTime`, полная дата в подсказке.
 */
import { memo, type ReactNode } from 'react';
import { CheckCircle2, CircleDot, Dot, Flag, Link as LinkIcon, Lock, Pencil, Tag, Unlock, User, type LucideIcon } from 'lucide-react';
import { relativeTime, shortDate } from '../../lib/format.ts';
import { t } from '../../i18n/index.ts';
import type { IssueEvent_Serialize, IssueEventKind, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import { LabelChip, UserAvatar, userName } from './IssueBits.tsx';

const ICONS: Record<IssueEventKind, [LucideIcon, string]> = {
  closed: [CheckCircle2, 'text-gk-purple'],
  reopened: [CircleDot, 'text-gk-green'],
  labeled: [Tag, 'text-gk-muted'],
  unlabeled: [Tag, 'text-gk-muted'],
  assigned: [User, 'text-gk-muted'],
  unassigned: [User, 'text-gk-muted'],
  renamed: [Pencil, 'text-gk-muted'],
  milestoned: [Flag, 'text-gk-muted'],
  demilestoned: [Flag, 'text-gk-muted'],
  referenced: [LinkIcon, 'text-gk-muted'],
  locked: [Lock, 'text-gk-yellow'],
  unlocked: [Unlock, 'text-gk-muted'],
  other: [Dot, 'text-gk-muted'],
};

const sameUser = (a: IssueUser_Serialize | null, b: IssueUser_Serialize | null) => Boolean(a && b && (a.id ? a.id === b.id : a.login === b.login));

/** Текст события и то, что идёт после него (метка чипом, ссылка). */
export function eventText(event: IssueEvent_Serialize, onOpenLink?: (url: string) => void): { text: string; extra: ReactNode } {
  const who = event.actor ? userName(event.actor) : t('issues-someone');
  const whom = event.user ? userName(event.user) : '';
  const self = sameUser(event.actor, event.user);
  switch (event.kind) {
    case 'closed':
      return { text: t('issues-ev-closed', who), extra: null };
    case 'reopened':
      return { text: t('issues-ev-reopened', who), extra: null };
    case 'labeled':
    case 'unlabeled':
      return { text: t(event.kind === 'labeled' ? 'issues-ev-labeled' : 'issues-ev-unlabeled', who), extra: event.label ? <LabelChip label={event.label} /> : null };
    case 'assigned':
      return { text: self ? t('issues-ev-self-assigned', who) : t('issues-ev-assigned', who, whom), extra: null };
    case 'unassigned':
      return { text: self ? t('issues-ev-self-unassigned', who) : t('issues-ev-unassigned', who, whom), extra: null };
    case 'renamed':
      return { text: t('issues-ev-renamed', who, event.from ?? '', event.to ?? ''), extra: null };
    case 'milestoned':
    case 'demilestoned': {
      const name = event.to ?? event.from ?? '';
      return { text: t(event.kind === 'milestoned' ? 'issues-ev-milestoned' : 'issues-ev-demilestoned', who, name), extra: null };
    }
    case 'referenced': {
      const url = event.text && /^https?:\/\//i.test(event.text) ? event.text : null;
      return {
        text: t('issues-ev-referenced', who),
        extra:
          url && onOpenLink ? (
            <button type="button" onClick={() => onOpenLink(url)} className="max-w-64 truncate text-gk-blue hover:underline" data-tip={url}>
              {url.replace(/^https?:\/\//, '')}
            </button>
          ) : event.text && !url ? (
            <span className="text-gk-muted">{event.text}</span>
          ) : null,
      };
    }
    case 'locked':
      return { text: t('issues-ev-locked', who), extra: null };
    case 'unlocked':
      return { text: t('issues-ev-unlocked', who), extra: null };
    default:
      return { text: event.text ? `${who} ${event.text}` : who, extra: null };
  }
}

interface IssueEventItemProps {
  events: readonly IssueEvent_Serialize[];
  actor: IssueUser_Serialize | null;
  createdAt: string;
  onOpenLink?: (url: string) => void;
}

function IssueEventItem({ events, actor, createdAt, onOpenLink }: IssueEventItemProps) {
  return (
    <li data-testid="issue-event" className="relative flex gap-3 py-1.5 pl-1 text-xs text-gk-muted">
      <span className="flex w-7 shrink-0 justify-center pt-0.5">
        {actor ? <UserAvatar user={actor} size={18} /> : <span className="h-[18px] w-[18px] rounded-full bg-gk-hover" />}
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {events.map((event, i) => {
          const [Icon, color] = ICONS[event.kind] ?? ICONS.other;
          const { text, extra } = eventText(event, onOpenLink);
          return (
            <li key={event.id || i} data-kind={event.kind} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Icon size={13} className={`shrink-0 ${color}`} />
              <span className="min-w-0 break-words text-gk-text">{text}</span>
              {extra}
              {i === 0 && (
                <span className="text-gk-dim" data-tip={shortDate(createdAt)}>
                  · {relativeTime(createdAt)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export default memo(IssueEventItem);
