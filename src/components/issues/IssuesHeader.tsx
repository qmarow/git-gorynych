/**
 * Новое в 2.0: шапка раздела «Задачи», 44 px — «Задачи · владелец/репозиторий», «Обновить», «Открыть на сервере»,
 * «Закрыть». Переключатель «Список / Доска» и «Новая задача» появятся вместе со своими экранами (этапы 7 и 5):
 * кнопок без действия в интерфейсе нет.
 */
import type { ReactNode } from 'react';
import { CircleDot, ExternalLink, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { t } from '../../i18n/index.ts';

interface IssuesHeaderProps {
  repoName: string | null;
  refreshing: boolean;
  webUrl: string | null;
  onRefresh: () => void;
  onOpenWeb: (url: string) => void;
  onClose: () => void;
  extra?: ReactNode;
}

export default function IssuesHeader({ repoName, refreshing, webUrl, onRefresh, onOpenWeb, onClose, extra }: IssuesHeaderProps) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
      <CircleDot size={16} className="shrink-0 text-gk-green" />
      <h2 className="min-w-0 truncate text-sm font-semibold text-gk-strong">{repoName ? t('issues-title-repo', repoName) : t('issues-title')}</h2>
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
