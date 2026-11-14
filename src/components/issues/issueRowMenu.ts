/**
 * Новое в 2.0: контекстное меню строки списка задач — открыть, закрыть или открыть заново, назначить мне, скопировать
 * ссылку и номер, открыть на сервере.
 */
import { CheckCircle2, CircleDot, Copy, ExternalLink, RotateCcw, UserPlus } from 'lucide-react';
import type { MenuEntry } from '../ContextMenu.tsx';
import type { Issue, IssuePatch } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps, IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';

interface RowMenuActions {
  open: () => void;
  change: (patch: IssuePatch) => void;
  onCopy: (text: string, what: string) => void;
  onOpenWeb: (url: string) => void;
}

export function rowMenu(issue: Issue, caps: IssueCaps | null, me: IssueUser_Serialize | null, actions: RowMenuActions): MenuEntry[] {
  const assigned = Boolean(me && issue.assignees.some((u) => u.login === me.login));
  return [
    { header: `#${issue.number}` },
    { label: t('issues-menu-open'), icon: CircleDot, onClick: actions.open },
    caps?.close && issue.state === 'open' && { label: t('issues-menu-close'), icon: CheckCircle2, onClick: () => actions.change({ state: 'closed' }) },
    caps?.close && issue.state === 'closed' && { label: t('issues-menu-reopen'), icon: RotateCcw, onClick: () => actions.change({ state: 'open' }) },
    caps?.edit && me && !assigned && {
      label: t('issues-menu-assign-me'),
      icon: UserPlus,
      onClick: () => {
        const others = caps.multipleAssignees ? issue.assignees.map((u) => ({ id: u.id, login: u.login })) : [];
        actions.change({ assignees: [...others, { id: me.id, login: me.login }] });
      },
    },
    { separator: true },
    { label: t('issues-menu-copy-link'), icon: Copy, onClick: () => actions.onCopy(issue.webUrl, t('issues-what-link')) },
    { label: t('issues-menu-copy-number', issue.number), icon: Copy, onClick: () => actions.onCopy(`#${issue.number}`, t('issues-what-number')) },
    { label: t('issues-open-on-server'), icon: ExternalLink, onClick: () => actions.onOpenWeb(issue.webUrl) },
  ];
}
