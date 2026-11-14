/**
 * Новое в 2.0: мелкие общие части раздела «Задачи» — значок состояния, метка, аватар, стопка аватаров, пустое
 * состояние, полоса ошибки, строки-заглушки.
 */
import { memo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, CircleSlash, RefreshCw, type LucideIcon } from 'lucide-react';
import { avatarColor, initials } from '../../lib/format.ts';
import { DEFAULT_LABEL_COLOR, parseHex, type Issue } from '../../lib/issues.ts';
import { readable } from '../../lib/scheme.ts';
import { t } from '../../i18n/index.ts';
import type { IssueLabel_Serialize, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';

/** Закрыта как «не планируется»: GitHub — `not_planned`, Gitea и GitLab такой причины не отдают. */
const isNotPlanned = (reason: string | null | undefined) => reason === 'not_planned';

export function stateTitle(issue: Pick<Issue, 'state' | 'stateReason'>): string {
  if (issue.state === 'open') return t('issues-is-open');
  return isNotPlanned(issue.stateReason) ? t('issues-is-not-planned') : t('issues-is-closed');
}

export function StateIcon({ issue, size = 16 }: { issue: Pick<Issue, 'state' | 'stateReason'>; size?: number }) {
  const [Icon, color]: [LucideIcon, string] =
    issue.state === 'open' ? [CircleDot, 'text-gk-green'] : isNotPlanned(issue.stateReason) ? [CircleSlash, 'text-gk-muted'] : [CheckCircle2, 'text-gk-purple'];
  return (
    <span data-tip={stateTitle(issue)} className="flex shrink-0">
      <Icon size={size} strokeWidth={2} className={color} aria-label={stateTitle(issue)} />
    </span>
  );
}

/** Цвет метки с прозрачностью: фон 0.2, рамка 0.5. */
function rgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_LABEL_COLOR)!;
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;
}

export const LabelChip = memo(function LabelChip({ label, onRemove }: { label: Pick<IssueLabel_Serialize, 'name' | 'color' | 'description'>; onRemove?: () => void }) {
  const color = parseHex(label.color) ? label.color : DEFAULT_LABEL_COLOR;
  return (
    <span
      data-tip={label.description || undefined}
      style={{ background: rgba(color, 0.2), borderColor: rgba(color, 0.5), color: readable(color) }}
      className="inline-flex h-[18px] max-w-[140px] shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium"
    >
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={t('issues-remove-filter')} className="opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </span>
  );
});

type User = Pick<IssueUser_Serialize, 'login' | 'name' | 'avatarUrl'>;

export const userName = (user: User | null | undefined): string => (user ? user.name || user.login : '');

export const UserAvatar = memo(function UserAvatar({ user, size = 20, ring = false, tip = true }: { user: User; size?: number; ring?: boolean; tip?: boolean }) {
  const name = userName(user);
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) };
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${ring ? 'ring-2 ring-gk-ink' : ''}`;
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" draggable={false} style={style} className={`${cls} object-cover`} data-tip={tip ? name : undefined} />
  ) : (
    <span style={{ ...style, background: avatarColor(name) }} className={`${cls} font-semibold text-white`} data-tip={tip ? name : undefined}>
      {initials(name) || '?'}
    </span>
  );
});

/** До `max` аватаров внахлёст, подсказка — имена всех. */
export function AvatarStack({ users, max = 3, size = 20 }: { users: readonly User[]; max?: number; size?: number }) {
  if (!users.length) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" data-tip={users.map(userName).join(', ')}>
      {users.slice(0, max).map((user) => (
        <UserAvatar key={user.login} user={user} size={size} ring tip={false} />
      ))}
      {users.length > max && <span className="pl-2 text-[11px] text-gk-muted">+{users.length - max}</span>}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, state }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; state?: string }) {
  return (
    <div data-testid={state ? 'issues-state' : undefined} data-state={state} className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center animate-fade-in">
      <Icon size={40} strokeWidth={1.25} className="text-gk-dim" />
      <div className="max-w-80 text-sm text-gk-text">{title}</div>
      {children}
    </div>
  );
}

export function ErrorBar({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-gk-red/30 bg-gk-red/10 px-3 py-1.5 text-xs text-gk-text">
      <AlertTriangle size={14} className="shrink-0 text-gk-red" />
      <span className="min-w-0 flex-1 truncate" data-tip={typeof message === 'string' ? message : undefined}>
        {message}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-gk-blue hover:bg-gk-hover">
          <RefreshCw size={12} />
          {t('issues-retry')}
        </button>
      )}
    </div>
  );
}

/** Строка-заглушка высотой со строку списка (56 px). */
export function Skeleton({ rows = 1, height = 56 }: { rows?: number; height?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height }} className="flex items-center gap-3 px-3" aria-hidden="true">
          <span className="skeleton h-4 w-4 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="skeleton h-3 rounded" style={{ width: `${60 + ((i * 37) % 30)}%` }} />
            <span className="skeleton h-2.5 w-1/3 rounded" />
          </span>
        </div>
      ))}
    </>
  );
}
