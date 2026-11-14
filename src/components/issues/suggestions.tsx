/**
 * Новое в 2.0: подсказки редактора Markdown — задачи по `#` (номер или слово заголовка) и участники по `@` (логин или имя).
 */
import type { ReactNode } from 'react';
import type { Trigger } from '../../lib/markdownEdit.ts';
import type { IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import { UserAvatar, userName } from './IssueBits.tsx';

const MAX_SUGGESTIONS = 8;

export type Suggestion = { key: string; insert: string; label: ReactNode };

export function buildSuggestions(trigger: Trigger | null, issues: readonly { number: number; title: string }[], members: readonly IssueUser_Serialize[]): Suggestion[] {
  if (!trigger) return [];
  const q = trigger.query.toLocaleLowerCase();
  if (trigger.kind === '#') {
    return issues
      .filter((issue) => !q || String(issue.number).startsWith(q) || issue.title.toLocaleLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((issue) => ({
        key: `#${issue.number}`,
        insert: String(issue.number),
        label: (
          <>
            <span className="shrink-0 text-gk-dim">#{issue.number}</span>
            <span className="truncate">{issue.title}</span>
          </>
        ),
      }));
  }
  return members
    .filter((user) => !q || user.login.toLocaleLowerCase().includes(q) || (user.name ?? '').toLocaleLowerCase().includes(q))
    .slice(0, MAX_SUGGESTIONS)
    .map((user) => ({
      key: `@${user.login}`,
      insert: user.login,
      label: (
        <>
          <UserAvatar user={user} size={16} tip={false} />
          <span className="truncate">{userName(user)}</span>
          <span className="shrink-0 text-gk-dim">@{user.login}</span>
        </>
      ),
    }));
}
