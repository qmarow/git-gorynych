/**
 * Новое в 2.0: подсказка задач по `#` (номер или слово заголовка) и участников по `@` (логин или имя) — общая для
 * редактора Markdown раздела «Задачи» и формы коммита.
 *
 * `useIssueSuggest(issues, members)`: `track(el)` — после ввода и смены курсора (ищет `#`/`@` перед курсором,
 * `lib/markdownEdit.ts::findTrigger`); `onKeyDown(e, apply)` — стрелки, Enter / Tab (вставка), Esc (закрыть), `true` —
 * клавиша обработана; `popup(apply)` — список под полем (родитель — `relative`). `apply(value, caret)` — вызывающий
 * ставит новый текст поля и курсор.
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { applyTrigger, findTrigger, type Trigger } from '../../lib/markdownEdit.ts';
import type { IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import { UserAvatar, userName } from './IssueBits.tsx';

const MAX_SUGGESTIONS = 8;

export type Suggestion = { key: string; insert: string; label: ReactNode };
type Field = HTMLInputElement | HTMLTextAreaElement;
export type ApplyText = (value: string, caret: number) => void;

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

export function useIssueSuggest(issues: readonly { number: number; title: string }[], members: readonly IssueUser_Serialize[] = []) {
  const [state, setState] = useState<{ trigger: Trigger; el: Field } | null>(null);
  const [active, setActive] = useState(0);
  const items = useMemo(() => buildSuggestions(state?.trigger ?? null, issues, members), [state?.trigger, issues, members]);

  const track = (el: Field) => {
    const caret = el.selectionStart ?? 0;
    const next = caret === el.selectionEnd ? findTrigger(el.value, caret) : null;
    setState((prev) => {
      if (!next) return null;
      if (prev && prev.el === el && prev.trigger.at === next.at && prev.trigger.kind === next.kind && prev.trigger.query === next.query) return prev;
      if (prev?.trigger.at !== next.at) setActive(0);
      return { trigger: next, el };
    });
  };

  const pick = (item: Suggestion, apply: ApplyText) => {
    if (!state) return;
    const { el, trigger } = state;
    const edit = applyTrigger(el.value, el.selectionStart ?? el.value.length, trigger, item.insert);
    setState(null);
    apply(edit.value, edit.start);
  };

  const open = Boolean(state && items.length);

  const onKeyDown = (e: KeyboardEvent<Field>, apply: ApplyText): boolean => {
    if (!open || state?.el !== e.currentTarget) return false;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      stop();
      pick(items[Math.min(active, items.length - 1)], apply);
      return true;
    }
    if (e.key === 'Escape') {
      stop();
      setState(null);
      return true;
    }
    return false;
  };

  /** Список под полем `el` (или под любым, если `el` не задан). */
  const popup = (apply: ApplyText, el?: Field | null): ReactNode =>
    open && (!el || state?.el === el) ? (
      <div role="listbox" data-testid="md-suggestions" className="absolute left-2 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-gk-border bg-gk-panel-2 py-1 shadow-xl backdrop-blur">
        {items.map((item, i) => (
          <div
            key={item.key}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(item, apply);
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs ${i === active ? 'bg-gk-hover text-gk-strong' : 'text-gk-text'}`}
          >
            {item.label}
          </div>
        ))}
      </div>
    ) : null;

  return { track, onKeyDown, popup, open, close: () => setState(null) };
}
