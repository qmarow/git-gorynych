/**
 * Новое в 2.0: шапка раздела «Задачи», 44 px — «Задачи · владелец/репозиторий», «Обновить», «Открыть на сервере»,
 * «Закрыть», переключатель «Список / Доска» (если задан `onView`) и дополнительные кнопки (`extra`).
 */
import type { ReactNode } from 'react';
import { CircleDot, ExternalLink, KanbanSquare, List, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { t } from '../../i18n/index.ts';

interface IssuesHeaderProps {
  repoName: string | null;
  refreshing: boolean;
  webUrl: string | null;
  onRefresh: () => void;
  onOpenWeb: (url: string) => void;
  onClose: () => void;
  extra?: ReactNode;
  view?: 'list' | 'board';
  onView?: (view: 'list' | 'board') => void;
}

export default function IssuesHeader({ repoName, refreshing, webUrl, onRefresh, onOpenWeb, onClose, extra, view = 'list', onView }: IssuesHeaderProps) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
      <CircleDot size={16} className="shrink-0 text-gk-green" />
      <h2 className="min-w-0 truncate text-sm font-semibold text-gk-strong">{repoName ? t('issues-title-repo', repoName) : t('issues-title')}</h2>
      {onView && (
        <div role="tablist" data-testid="issues-view-switch" className="ml-2 flex items-center rounded border border-gk-border p-px text-xs">
          {([
            ['list', List, t('issues-view-list')],
            ['board', KanbanSquare, t('issues-view-board')],
          ] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-view={id}
              aria-selected={view === id}
              onClick={() => onView(id)}
              className={`flex items-center gap-1 rounded-sm px-2 py-0.5 ${view === id ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted hover:text-gk-text'}`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1" />
      {extra}
      <HeaderButton icon={RefreshCw} title={t('issues-refresh')} onClick={onRefresh} iconClass={refreshing ? 'animate-spin' : ''} />
      {webUrl && <HeaderButton icon={ExternalLink} title={t('issues-open-on-server')} onClick={() => onOpenWeb(webUrl)} />}
      <HeaderButton icon={X} title={t('issues-close-section')} onClick={onClose} />
    </div>
  );
}

function HeaderButton({ icon: Icon, title, onClick, iconClass = '' }: { icon: LucideIcon; title: string; onClick: () => void; iconClass?: string }) {
  return (
    <button
      type="button"
      data-tip={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
    >
      <Icon size={15} strokeWidth={1.75} className={iconClass} />
    </button>
  );
}
