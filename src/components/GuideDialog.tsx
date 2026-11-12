import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { installGitHint, kb, openFolderLabel } from '../lib/platform.ts';
import {
  Archive,
  BookOpen,
  Cloud,
  FileClock,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitMerge,
  Keyboard,
  Laptop,
  Layers,
  LayoutPanelLeft,
  LifeBuoy,
  Move,
  Palette,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
  ShieldCheck,
  WandSparkles,
  SquareSplitHorizontal,
  Workflow,
  X,
  LayoutTemplate,
  Ticket,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';
import { t, tj } from '../i18n/index.ts';

/** Группа горячих клавиш: название и пары «сочетание — что делает» */
export type ShortcutGroup = [string, [string, string][]];

/** Раздел руководства */
interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  keywords: string;
  body: ComponentType;
}

type WithChildren = { children?: ReactNode };

/* ---------------- Горячие клавиши (используются и в разделе руководства) ---------------- */

export const SHORTCUTS: ShortcutGroup[] = [
  [t('repositories'), [
    ['Ctrl+O', t('open-repository-3')],
    ['Ctrl+Shift+O', t('clone-2')],
    ['Ctrl+N', t('create-repository-2')],
    ['Ctrl+Tab / Ctrl+Shift+Tab', t('next-previous-tab')],
    ['Ctrl+T', t('new-tab-open-clone-create')],
    ['Ctrl+W', t('close-tab')],
  ]],
  [t('work'), [
    ['Ctrl+Z / Ctrl+Y', t('undo-redo-action')],
    ['Ctrl+F', t('commit-search-in-open-diff')],
    ['Ctrl+Alt+F', t('filter-branches-and-tags-on')],
    ['Ctrl+B', t('switch-branch-2')],
    ['Ctrl+Enter', t('commit-in-message-field')],
    [t('click-feat-fix-chip'), t('conventional-commits-prefix-second-click')],
    [t('double-click-commit'), t('switch-to-its-branch-without')],
    [t('double-click-branch-label'), t('switch-to-exactly-that-branch')],
    [t('right-click-commit'), t('action-menu')],
    [t('ctrl-click-commit'), t('compare-with-selected-one')],
    [t('drag-commit-or-branch-onto'), t('merge-cherry-pick-fast-forward')],
    [t('hover-over-n-next-to'), t('all-branches-and-tags-of')],
    [t('hover-over-next-to-branch'), t('incoming-outgoing-commits-update-branch')],
    [t('custom-shortcuts'), t('running-actions-from-builder-actions')],
    [t('right-click-file'), t('restore-file-discard-edits')],
  ]],
  [t('viewing-changes'), [
    ['Ctrl+F', t('search-in-files-changes')],
    ['Enter / Shift+Enter, F3 / Shift+F3', t('next-previous-match')],
    ['Alt+C / Alt+R', t('search-match-case-regular-expression')],
    ['F7 / Shift+F7', t('next-previous-change')],
    ['Alt+↑ / Alt+↓', t('previous-next-file')],
    ['Esc', t('close')],
  ]],
  [t('interactive-rebase'), [
    ['↑ / ↓', t('select-commit-2')],
    ['Alt+↑ / Alt+↓', t('move-commit')],
    ['P R S F D', t('pick-reword-squash-fixup-drop')],
  ]],
  [t('conflicts-3'), [
    ['Ctrl+S', t('save-resolution-and-move-on')],
    ['Alt+↑ / Alt+↓', t('to-previous-next-conflict')],
  ]],
  ['CI/CD', [
    ['Ctrl+S', t('save-ci-file')],
    ['Ctrl+/', t('comment-out-line')],
    ['Tab / Shift+Tab', t('indent')],
  ]],
  [t('window'), [
    ['Ctrl+,', t('settings-and-appearance')],
    ['F1', t('guide')],
    ['F12', t('developer-tools')],
  ]],
];

/* ---------------- Кирпичики текста ---------------- */

// Клавиши: на macOS Ctrl → ⌘, Alt → ⌥ (kb)
const K = ({ children }: WithChildren) => (
  <kbd className="mx-0.5 inline-block whitespace-nowrap rounded border border-gk-border bg-gk-fg/[0.06] px-1.5 py-px font-mono text-[11px] text-gk-text shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
    {typeof children === 'string' ? kb(children) : children}
  </kbd>
);
const B = ({ children }: WithChildren) => <b className="font-medium text-gk-strong">{children}</b>;
const H = ({ children }: WithChildren) => <h3 className="mb-2 mt-6 text-[14px] font-semibold text-gk-strong first:mt-0">{children}</h3>;
const P = ({ children }: WithChildren) => <p className="mb-2.5 leading-relaxed">{children}</p>;
const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="mb-3 space-y-1.5">
    {items.map((it, i) => (
      <li key={i} className="flex gap-2.5 leading-relaxed">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gk-blue/15 text-[11px] font-semibold text-gk-blue">{i + 1}</span>
        <span>{it}</span>
      </li>
    ))}
  </ol>
);
const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="mb-3 space-y-1">
    {items.map((it, i) => (
      <li key={i} className="flex gap-2 leading-relaxed">
        <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gk-dim" />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);
const Tip = ({ children, tone = 'blue' }: WithChildren & { tone?: 'blue' | 'yellow' | 'green' }) => (
  <div
    className={`mb-3 rounded-lg border px-3 py-2 leading-relaxed ${
      tone === 'yellow' ? 'border-gk-yellow/30 bg-gk-yellow/[0.06]' : tone === 'green' ? 'border-gk-green/30 bg-gk-green/[0.06]' : 'border-gk-blue/30 bg-gk-blue/[0.06]'
    }`}
  >
    {children}
  </div>
);

/* ---------------- Разделы ---------------- */

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: t('getting-started'),
    icon: Rocket,
    keywords: t('open-create-clone-connect-tabs'),
    body: () => (
      <>
        <P>
          {tj('git-gorynych-is-app-for', [<B />])}</P>
        <H>{t('open-project')}</H>
        <List
          items={[
            <>
              {tj('open-repository-ctrl-o-choose', [<B />, <K />])}</>,
            <>
              {tj('clone-ctrl-shift-o-paste', [<B />, <K />])}</>,
            <>
              {tj('create-repository-ctrl-n-make', [<B />, <K />])}</>,
            <>
              {tj('connect-folder-to-gitlab-github-you', [<B />])}</>,
          ]}
        />
        <P>{tj('all-of-this-is-on', [<B />])}</P>
        <H>{t('tabs')}</H>
        <P>
          {tj('each-repository-opens-in-its', [<K />, <K />])}</P>
        <Tip tone="green">
          {tj('almost-any-action-can-be', [<K />, <B />])}</Tip>
      </>
    ),
  },
  {
    id: 'ui',
    title: t('how-window-is-laid-out'),
    icon: LayoutPanelLeft,
    keywords: t('interface-panel-graph-left-right'),
    body: () => (
      <>
        <H>{t('top-toolbar')}</H>
        <List
          items={[
            <>
              {tj('on-left-current-repository-and', [<B />, <B />, <K />])}</>,
            <>
              {tj('undo-redo-pull-arrow-next', [<B />, <B />, <B />, <B />, <B />])}</>,
            <>{t('on-right-server-access-status')}</>,
          ]}
        />
        <H>{t('tabs')}</H>
        <P>
          {tj('each-repository-is-separate-tab', [<B />, <K />, <B />])}</P>
        <H>{t('on-left-branches-and-everything')}</H>
        <P>
          {tj('local-your-branches-on-server', [<B />, <B />, <B />, <B />, <B />, <K />])}</P>
        <H>{t('in-center-commit-graph')}</H>
        <P>
          {tj('each-row-is-commit-branches', [<B />])}</P>
        <H>{t('commit-table-settings')}</H>
        <List
          items={[
            <>
              {tj('right-click-table-header-or', [<B />, <B />, <B />, <B />, <B />, <B />, <B />, <B />, <B />])}</>,
            <>
              {tj('columns-are-reordered-by-dragging', [<B />])}</>,
            <>
              {tj('columns-width-is-dragged-by', [<B />])}</>,
            <>
              {tj('conventional-commits-prefixes-feat-fix', [<B />, <B />, <B />])}</>,
          ]}
        />
        <H>{t('on-right-details')}</H>
        <P>
          {t('for-commit-message-author-parents')}</P>
        <H>{t('at-bottom-status-bar')}</H>
        <P>
          {tj('current-branch-and-how-far', [<B />, openFolderLabel().replace(/^(Открыть|Показать) в /, '')])}</P>
        <Tip>{t('panel-borders-can-be-dragged')}</Tip>
      </>
    ),
  },
  {
    id: 'commit',
    title: t('changes-and-commits'),
    icon: GitCommitHorizontal,
    keywords: t('stage-unstage-commit-wip-hunk'),
    body: () => (
      <>
        <Steps
          items={[
            <>
              {tj('select-wip-row-in-graph', [<B />])}</>,
            <>
              {tj('click-file-to-see-changes', [<B />, <B />])}</>,
            <>
              {tj('you-can-add-only-part', [<B />, <B />])}</>,
            <>
              {tj('write-commit-title-and-description', [<B />, <K />])}</>,
          ]}
        />
        <P>
          {tj('on-right-of-each-file', [<span className="font-mono text-gk-green" />, <span className="font-mono text-gk-red" />, <span className="text-gk-dim" />, <B />, <span className="rounded bg-gk-blue/10 px-1 text-[11px] text-gk-blue" />])}</P>
        <P>
          {tj('made-mistake-ctrl-z-undoes', [<K />, <B />])}</P>
      </>
    ),
  },
  {
    id: 'message',
    title: t('commit-message-2'),
    icon: MessageSquareText,
    keywords: t('conventional-commits-feat-fix-refactor'),
    body: () => (
      <>
        <H>{t('commit-type-in-one-click')}</H>
        <P>
          {tj('above-commit-title-there-are', [<B />, <B />, <B />, <B />, <B />, <B />, <B />, <B />, <code className="font-mono text-gk-text" />])}</P>
        <List
          items={[
            <>
              {tj('scope-area-of-changes-feat-api', [<B />, <code className="font-mono text-gk-text" />])}</>,
            <>
              {tj('breaking-change-feat', [<B />, <code className="font-mono text-gk-text" />])}</>,
            <>{t('on-right-of-field-title')}</>,
          ]}
        />
        <H>{t('issue-number-from-branch-name')}</H>
        <P>
          {tj('if-branch-is-named-for', [<code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />, <Ticket size={12} className="inline align-[-2px]" />, <B />, <B />])}</P>
        <P>{t('arrow-next-to-button-where')}</P>
        <List
          items={[
            <>
              {tj('proj-123-feat-at-start', [<code className="font-mono text-gk-text" />])}</>,
            <>
              {tj('feat-proj-123-instead-of', [<code className="font-mono text-gk-text" />])}</>,
            <>
              {tj('feat-proj-123-at-end', [<code className="font-mono text-gk-text" />])}</>,
            <>
              {tj('refs-proj-123-on-separate', [<code className="font-mono text-gk-text" />])}</>,
          ]}
        />
        <P>
          {tj('theres-also-add-issue-number', [<B />, <B />])}</P>
        <H>{t('description-templates')}</H>
        <P>
          {tj('templates-button-above-commit-form', [<LayoutTemplate size={12} className="inline align-[-2px]" />, <B />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />])}</P>
        <List
          items={[
            <>
              {tj('save-current-description-as-template-2', [<B />, <code className="font-mono text-gk-text" />])}</>,
            <>{t('edit-or-delete-template-buttons')}</>,
            <>
              {tj('if-repository-has-git-config', [<code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />])}</>,
          ]}
        />
        <Tip tone="green">
          {t('typed-message-isnt-lost-if')}</Tip>
      </>
    ),
  },
  {
    id: 'branches',
    title: t('branches-2'),
    icon: GitBranch,
    keywords: t('branch-git-flow-gitflow-feature'),
    body: () => (
      <>
        <H>{t('create-and-switch')}</H>
        <List
          items={[
            <>
              {tj('branch-on-toolbar-new-branch', [<B />])}</>,
            <>
              {tj('right-click-commit-create-branch', [<B />])}</>,
            <>
              {tj('in-new-branch-window-you', [<B />, <B />, <B />, <B />, <B />, <B />, <B />, <B />])}</>,
            <>
              {tj('to-switch-double-click-branch', [<K />])}</>,
            <>
              {tj('double-clicking-commit-works-as', [<B />, <B />, <B />])}</>,
          ]}
        />
        <H>{t('merge-and-delete')}</H>
        <P>
          {tj('right-click-branch-label-in', [<B />, <B />, <B />, <B />, <B />, <B />, <B />, <K />])}</P>
        <P>
          {tj('right-click-commit-row-commit', [<B />])}</P>
        <P>
          {t('faster-with-mouse-drag-branch')}</P>
        <H>{t('where-branch-is-on-your')}</H>
        <List
          items={[
            <>
              {tj('branch-is-only-on-your', [<Laptop size={12} className="inline align-[-1px]" />])}</>,
            <>
              {tj('branch-on-server-origin-in', [<Cloud size={12} className="inline align-[-1px]" />])}</>,
            <>
              {tj('local-and-server-branches-are', [<span className="relative inline-block h-3 w-[18px] align-[-1px]" />, <Laptop size={12} className="absolute left-0 top-0" />, <Cloud size={9} strokeWidth={2.6} className="absolute -top-[3px] right-0" />])}</>,
          ]}
        />
        <P>
          {tj('if-commit-has-several-branches', [<B />])}</P>
        <H>{t('incoming-and-outgoing-commits')}</H>
        <P>
          {t('each-local-branch-in-local')}</P>
        <List
          items={[
            <>
              {tj('n-3-server-has-3', [<span className="rounded bg-gk-blue/15 px-1 font-mono text-[11px] font-semibold text-gk-blue" />])}</>,
            <>
              {tj('n-2-2-of-your', [<span className="rounded bg-gk-green/15 px-1 font-mono text-[11px] font-semibold text-gk-green" />])}</>,
            <>
              {tj('gone-branch-on-server-was', [<span className="rounded bg-gk-red/10 px-1 text-[11px] text-gk-red" />])}</>,
          ]}
        />
        <P>
          {tj('hover-over-or-list-of', [<B />, <B />, <K />])}</P>
        <H>{t('delete-branch-on-server')}</H>
        <P>
          {tj('right-click-remote-branch-on', [<B />, <K />])}</P>
        <H>{t('branch-folders')}</H>
        <P>
          {tj('branches-with-in-name-are', [<B />])}</P>
        <H>{t('switching-with-uncommitted-changes')}</H>
        <P>
          {t('if-working-folder-has-edits')}</P>
        <List
          items={[
            <>
              {tj('stash-and-switch-stash-edits', [<B />])}</>,
            <>
              {tj('move-changes-edits-go-with', [<B />])}</>,
            <>
              {tj('discard-changes-discard-folder-becomes', [<B />, <K />])}</>,
          ]}
        />
        <P>
          {tj('app-suggests-whats-better-move', [<B />, <K />])}</P>
        <H>Detached HEAD</H>
        <P>
          {tj('if-you-switch-to-commit', [<K />])}</P>
        <H>{t('tags-2')}</H>
        <P>
          {tj('right-click-commit-create-tag', [<B />])}</P>
      </>
    ),
  },
  {
    id: 'dnd',
    title: t('drag-and-drop'),
    icon: Move,
    keywords: t('drag-drop-mouse-merge-cherry'),
    body: () => (
      <>
        <P>{t('you-can-merge-branch-or')}</P>
        <Steps
          items={[
            <>
              {tj('take-commit-row-in-graph', [<B />, <B />, <B />])}</>,
            <>
              {tj('drag-it-onto-branch-you', [<B />])}</>,
            <>{t('release-it-menu-with-suitable')}</>,
          ]}
        />
        <H>{t('whats-offered')}</H>
        <List
          items={[
            <>
              {tj('fast-forward-if-target-branch', [<B />])}</>,
            <>
              {tj('merge-into-merge-regular-merge', [<B />])}</>,
            <>
              {tj('cherry-pick-commit-into-cherry', [<B />])}</>,
            <>
              {tj('rebase-onto-opens-interactive-rebase', [<B />])}</>,
          ]}
        />
        <P>
          {t('if-target-branch-isnt-current')}</P>
        <Tip tone="green">
          {tj('everything-is-undone-with-ctrl', [<K />])}</Tip>
      </>
    ),
  },
  {
    id: 'sync',
    title: t('syncing-with-server'),
    icon: RefreshCw,
    keywords: t('repository-sign-in-self-managed'),
    body: () => (
      <>
        <List
          items={[
            <>
              {tj('fetch-find-out-whats-new', [<B />, <B />])}</>,
            <>
              {tj('pull-bring-changes-into-current', [<B />])}</>,
            <>
              {tj('push-send-your-commits-for', [<B />])}</>,
          ]}
        />
        <P>
          {tj('if-server-rejected-push-because', [<B />])}</P>
        <Tip>
          {t('if-theres-no-access-app')}</Tip>
        <H>{t('repository-sign-in-2')}</H>
        <P>
          {tj('if-server-refused-on-fetch', [<B />, <B />, <B />, <B />, <B />])}</P>
        <P>
          {tj('at-top-of-window-where', [<B />, <B />, <B />, <B />, <B />])}</P>
        <P>
          {tj('no-key-on-ssh-key', [<B />, <B />, <B />])}</P>
        <P>
          {tj('sign-in-and-retry-saves', [<B />, <B />])}</P>
        <H>{t('background-server-check')}</H>
        <P>
          {tj('while-auto-is-on-app', [<B />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />])}</P>
        <List
          items={[
            <>{t('only-open-tab-is-checked')}</>,
            <>{t('while-you-commit-checkout-rebase')}</>,
            <>
              {t('no-connection-no-connection-appears')}</>,
            <>
              {tj('frequency-settings-sync-or-right', [<B />])}</>,
            <>{t('app-sees-fetch-or-pull')}</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'guard',
    title: t('pre-commit-check'),
    icon: ShieldAlert,
    keywords: t('guard-pre-commit-console-log'),
    body: () => (
      <>
        <P>
          {tj('before-each-commit-app-scans', [<B />])}</P>
        <List
          items={[
            <>{t('forgotten-debug-code-console-log')}</>, // gorynych-ignore
            <>{t('things-that-look-like-secrets')}</>,
          ]}
        />
        <P>
          {tj('while-you-prepare-commit-banner', [<B />, <B />, <B />, <B />])}</P>
        <H>{t('everything-is-configurable')}</H>
        <P>
          {tj('settings-pre-commit-check-or', [<B />])}</P>
        <List
          items={[
            <>
              {tj('check-before-committing-main-switch', [<B />, <B />])}</>,
            <>
              {tj('for-this-repository-turn-off', [<B />])}</>,
            <>
              {tj('each-rule-has-three-levels', [<B />, <B />, <B />])}</>,
            <>
              {tj('your-own-rules-regular-expression', [<B />])}</>,
            <>
              {tj('dont-check-files-path-patterns', [<B />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />, <code className="font-mono text-gk-text" />])}</>,
          ]}
        />
        <P>
          {tj('check-skips-single-line-if', [<code className="font-mono text-gk-text" />])}</P>
        <H>{t('if-you-edit-files-in')}</H>
        <P>
          {t('you-staged-file-and-then')}</P>
        <Tip tone="yellow">{t('key-that-once-got-into')}</Tip>
      </>
    ),
  },
  {
    id: 'actions',
    title: t('action-builder-3'),
    icon: WandSparkles,
    keywords: t('action-button-hotkey-shortcut-chain'),
    body: () => (
      <>
        <P>
          {t('builds-chain-of-commands-for')}</P>
        <Steps
          items={[
            <>
              {tj('actions-action-builder-menu', [<B />])}
            </>,
            <>
              {t('take-ready-made-template-on')}</>,
            <>
              {tj('add-steps-with-add-step', [<B />])}</>,
            <>
              {tj('assign-keyboard-shortcut-for-example', [<B />, <K />, <B />])}</>,
          ]}
        />
        <H>{t('variables-in-fields')}</H>
        <List
          items={[
            <>
              {tj('default-main-branch-main-master', [<code className="font-mono text-gk-blue" />, <code className="font-mono text-gk-blue" />, <code className="font-mono text-gk-blue" />, <code className="font-mono text-gk-blue" />])}</>,
            <>
              {tj('input-task-name-ask-at', [<code className="font-mono text-gk-blue" />, <code className="font-mono text-gk-blue" />])}</>,
          ]}
        />
        <H>{t('running-2')}</H>
        <P>
          {tj('bottom-right-shows-which-step', [<B />, <K />])}</P>
        <Tip>
          {t('merge-request-is-created-via')}</Tip>
      </>
    ),
  },
  {
    id: 'diff',
    title: t('viewing-changes'),
    icon: SquareSplitHorizontal,
    keywords: t('diff-split-unified-whitespace-syntax'),
    body: () => (
      <>
        <P>{t('clicking-file-in-right-panel')}</P>
        <List
          items={[
            <>
              {tj('toggles-at-top-unified-one', [<B />, <B />])}</>,
            <>
              {tj('f7-shift-f7-to-next', [<K />, <K />, <K />, <K />, <K />])}</>,
            <>
              {tj('syntax-highlighting-language-is-detected', [<B />, <B />])}</>,
            <>
              {tj('search-in-changes-ctrl-f-or', [<B />, <K />, <K />, <K />, <K />, <K />, <K />, <K />])}</>,
            <>
              {tj('each-hunk-has-action-buttons', [<B />, <B />, <B />, <B />])}</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'safety',
    title: t('undo-and-safety'),
    icon: ShieldCheck,
    keywords: t('undo-redo-revert-rollback-file'),
    body: () => (
      <>
        <H>Undo / Redo</H>
        <P>
          {tj('ctrl-z-ctrl-y-undo', [<K />, <K />])}</P>
        <H>{t('restore-file-or-part-of')}</H>
        <P>{t('right-click-file-in-commits')}</P>
        <List
          items={[
            <>
              {tj('restore-file-to-its-version-in', [<B />])}</>,
            <>
              {tj('restore-file-to-its-version-before-this', [<B />])}</>,
            <>
              {tj('revert-this-commits-changes-in-file', [<B />])}</>,
          ]}
        />
        <P>
          {tj('same-for-single-hunk-revert', [<B />, <B />])}</P>
        <H>{t('whole-project')}</H>
        <List
          items={[
            <>
              {tj('restore-files-from-commit-commit', [<B />])}</>,
            <>
              {tj('revert-commit-changes-revert-new', [<B />])}</>,
            <>
              {tj('reset-to-this-commit-reset', [<B />])}</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'rebase',
    title: t('interactive-rebase'),
    icon: Layers,
    keywords: t('rebase-squash-fixup-reword-drop'),
    body: () => (
      <>
        <P>{t('lets-you-tidy-up-branchs')}</P>
        <Steps
          items={[
            <>
              {tj('right-click-branch-commit-interactive', [<B />, <B />])}</>,
            <>
              {tj('on-left-plan-new-commits', [<K />, <K />, <K />, <K />, <K />, <K />, <K />])}</>,
            <>
              {tj('on-right-you-see-preview', [<B />])}</>,
            <>
              {tj('click-apply-rebase-branch-will', [<B />, <K />])}</>,
          ]}
        />
        <Tip tone="green">{t('until-you-click-apply-nothing')}</Tip>
        <P>
          {tj('if-preview-shows-conflict-change', [<B />, <B />, <B />])}</P>
        <Tip tone="yellow">{t('preview-needs-git-2-40')}</Tip>
      </>
    ),
  },
  {
    id: 'compare',
    title: t('comparing-commits'),
    icon: GitCompareArrows,
    keywords: t('compare-comparison-diff-two-commits'),
    body: () => (
      <>
        <P>{t('shows-how-any-two-commits')}</P>
        <List
          items={[
            <>
              {tj('select-commit-and-second-one', [<B />, kb(t('ctrl-click'))])}</>,
            <>
              {tj('or-right-click-compare-with', [<B />])}</>,
            <>
              {tj('or-right-click-mark-for', [<B />, <B />])}</>,
          ]}
        />
        <P>
          {tj('at-top-summary-how-many', [<K />])}</P>
        <P>
          {tj('content-search-path-content-switch', [<B />, <B />, <K />, <K />])}</P>
      </>
    ),
  },
  {
    id: 'filehistory',
    title: t('file-history-and-blame'),
    icon: FileClock,
    keywords: t('file-history-log-blame-authorship'),
    body: () => (
      <>
        <P>
          {tj('for-any-file-in-commit', [<B />, <B />])}</P>
        <P>
          {tj('file-history-all-commits-that', [<B />, <B />, <K />, <K />])}</P>
        <List
          items={[
            <>
              {tj('compare-two-versions-second-commit', [<B />, kb(t('ctrl-click'))])}</>,
            <>
              {tj('restore-file-to-this-version-file', [<B />, <K />])}</>,
            <>{t('click-hash-show-commit-in')}</>,
          ]}
        />
        <P>
          {tj('blame-to-left-of-each', [<B />])}</P>
        <List
          items={[
            <>{t('hover-over-block-full-commit')}</>,
            <>{t('click-hash-graph-goes-to')}</>,
            <>
              {tj('blame-before-this-commit-arrow', [<B />, <B />, <K />])}</>,
            <>
              {tj('ignore-whitespace-git-blame-w-2', [<B />])}</>,
            <>{t('for-wip-file-blame-is')}</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'conflicts',
    title: t('conflicts-3'),
    icon: GitMerge,
    keywords: t('conflict-merge-rebase-pull-mine'),
    body: () => (
      <>
        <P>
          {t('if-changes-overlapped-during-merge')}</P>
        <Steps
          items={[
            <>
              {tj('click-resolve-conflicts-editor-opens', [<B />])}</>,
            <>
              {tj('for-each-conflict-block-choose', [<B />])}</>,
            <>
              {tj('save-and-next-ctrl-s', [<B />, <K />])}</>,
            <>
              {tj('when-everything-is-resolved-continue', [<B />, <B />])}</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'stash',
    title: 'Stash',
    icon: Archive,
    keywords: t('stash-hide-pop-apply-drop'),
    body: () => (
      <>
        <P>{t('stash-temporarily-hides-uncommitted')}</P>
        <List
          items={[
            <>
              {tj('stash-on-toolbar-stash-everything', [<B />, <B />])}</>,
            <>
              {tj('names-in-list-follow-one', [<B />])}</>,
            <>
              {tj('stash-section-on-left-click', [<B />, <B />, <B />, <B />, <K />])}</>,
          ]}
        />
        <H>{t('take-only-part-of-stash')}</H>
        <List
          items={[
            <>
              {tj('individual-files-check-them-in', [<B />, <B />])}</>,
            <>
              {tj('one-file-restore-button-when', [<B />, <B />])}</>,
            <>
              {tj('individual-pieces-of-code-open', [<B />, <B />])}</>,
          ]}
        />
        <P>
          {tj('files-go-to-working-folder', [<K />])}</P>
      </>
    ),
  },
  {
    id: 'search',
    title: t('search'),
    icon: Search,
    keywords: t('search-find-commit-filter-author'),
    body: () => (
      <>
        <P>
          {tj('ctrl-f-commit-search-message', [<K />, <B />, <K />, <K />, <K />])}</P>
        <P>
          {t('if-text-is-found-in')}</P>
      </>
    ),
  },
  {
    id: 'ci',
    title: t('ci-cd-pipelines-and-runners'),
    icon: Workflow,
    keywords: t('ci-cd-gitlab-pipeline-token'),
    body: () => (
      <>
        <H>{t('ci-cd-settings-in-repository')}</H>
        <P>
          {tj('ci-cd-section-on-left', [<B />])}</P>
        <List
          items={[
            <>
              {tj('diagram-stages-and-jobs-at', [<B />, <B />, <B />, <B />])}</>,
            <>
              {tj('check-what-will-break-in', [<B />, <B />, <B />, <B />, <B />])}</>,
            <>
              {tj('file-editor-with-on-fly', [<B />, <K />])}</>,
            <>
              {tj('history-commits-that-changed-ci', [<B />])}</>,
          ]}
        />
        <List
          items={[
            <>
              {tj('execution-graph-dag-switch-above', [<B />])}</>,
            <>
              {tj('next-to-cron-in-schedule', [<B />])}</>,
            <>
              {tj('in-editor-step-template-insert', [<B />, <B />, <B />])}</>,
          ]}
        />
        <P>
          {tj('while-changes-arent-saved-theres', [<B />])}</P>
        <H>{t('configuration-check')}</H>
        <P>
          {t('check-runs-right-away-on')}</P>
        <List
          items={[
            <>
              {tj('syntax-and-keys-yaml-errors', [<B />])}</>,
            <>
              {tj('links-needs-and-dependencies-on', [<B />])}</>,
            <>
              {tj('scripts-against-repository-missing-file', [<B />])}</>,
            <>
              {tj('security-and-deprecations-tokens-and', [<B />])}</>,
          ]}
        />
        <P>
          {t('for-gitlab-rules-are-evaluated')}</P>
        <Tip>
          {t('network-includes-include-remote-project')}</Tip>
        <H>{t('pipelines-gitlab-github-gitea-forgejo')}</H>
        <P>
          {tj('service-is-detected-by-itself', [<B />, <B />])}</P>
        <P>
          {tj('repository-has-one-sign-in', [<B />])}</P>
        <Steps
          items={[
            <>
              {tj('open-ci-cd-pipelines-and', [<B />, <B />])}</>,
            <>
              {tj('for-gitlab-access-token-with', [<B />, <B />])}</>,
            <>
              {tj('if-you-sign-in-with', [<B />])}</>,
          ]}
        />
        <P>
          {tj('after-that-pipeline-statuses-are', [<B />, <B />, <B />])}</P>
        <Tip>{t('read-only-token-read-api-lets')}</Tip>
        <List
          items={[
            <>
              {tj('run-window-with-branch-and', [<B />])}</>,
            <>
              {tj('cancel-running-pipeline-retry-failed', [<B />, <B />])}</>,
            <>
              {tj('job-log-ansi-colors-collapsible', [<B />, <K />, <B />])}</>,
            <>
              {tj('artifacts-of-finished-pipeline-with', [<B />])}</>,
            <>
              {tj('secrets-and-variables-list-of', [<B />])}</>,
            <>
              {t('whats-unavailable-for-particular-service')}</>,
          ]}
        />
        <H>{t('runners')}</H>
        <P>
          {tj('runners-tab-self-hosted-project', [<B />, <B />])}</P>
        <List
          items={[
            <>
              {tj('click-runner-editor-labels-as', [<B />])}</>,
            <>
              {tj('connect-runner-gets-registration-token', [<B />, <B />])}</>,
            <>
              {tj('insert-into-config-on-runner', [<B />])}</>,
          ]}
        />
        <P>
          {t('configuration-check-matches-tags-and')}</P>
        <H>{t('statuses-in-graph-and-notifications')}</H>
        <P>
          {tj('commits-in-graph-have-pipeline', [<B />])}</P>
        <P>
          {tj('in-settings-connections-each-repositorys', [<B />])}</P>
      </>
    ),
  },
  {
    id: 'look',
    title: t('appearance-2'),
    icon: Palette,
    keywords: t('theme-light-dark-white-system'),
    body: () => (
      <>
        <P>
          {tj('ctrl-or-gear-at-top', [<K />, <B />])}</P>
        <P>
          {tj('light-theme-white-panels-and', [<B />, <B />])}</P>
          <P>{tj('interface-language-russkiy-or-english', [<B />])}</P>
      </>
    ),
  },
  {
    id: 'keys',
    title: t('keyboard-shortcuts'),
    icon: Keyboard,
    keywords: SHORTCUTS.flatMap(([g, items]) => [g, ...items.flat()]).join(' '),
    body: () => (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {SHORTCUTS.map(([group, items]) => (
          <section key={group}>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{group}</h4>
            <ul className="space-y-1">
              {items.map(([keys, label]) => (
                <li key={keys + label} className="flex items-start justify-between gap-3 text-[12.5px]">
                  <span className="text-gk-text">{label}</span>
                  <K>{keys}</K>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    ),
  },
  {
    id: 'faq',
    title: t('if-somethings-wrong'),
    icon: LifeBuoy,
    keywords: t('error-problem-git-not-found'),
    body: () => (
      <>
        <List
          items={[
            <>
              {tj('git-not-found-and-fully', [<B />, installGitHint()])}</>,
            <>
              {tj('no-access-to-server-repository', [<B />])}</>,
            <>
              {tj('action-is-unavailable-gray-hover', [<B />])}</>,
            <>
              {tj('branch-cant-be-deleted-from', [<B />])}</>,
            <>
              {tj('no-connection-in-status-bar', [<B />])}</>,
            <>
              {tj('did-something-by-mistake-ctrl', [<B />, <K />, <B />])}</>,
            <>
              {tj('new-features-arent-visible-after', [<B />])}</>,
            <>
              {tj('pre-commit-check-gets-in', [<B />])}</>,
            <>
              {tj('graph-didnt-update-after-working', [<B />])}</>,
          ]}
        />
      </>
    ),
  },
];

/**
 * Руководство пользователя: разделы слева (с поиском), текст справа.
 */
export default function GuideDialog({ initialSection = 'start', onClose }: { initialSection?: string; onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS.some((s) => s.id === initialSection) ? initialSection : 'start');
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (shown.length && !shown.some((s) => s.id === active)) setActive(shown[0].id);
  }, [shown, active]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target as HTMLElement | null)?.tagName !== 'INPUT') {
        e.preventDefault();
        const i = shown.findIndex((s) => s.id === active);
        const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setActive(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, shown, active]);

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const index = SECTIONS.indexOf(section);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-gk-scrim p-6 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong flex h-[min(760px,88vh)] w-[min(980px,100%)] animate-pop-in overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2 shadow-2xl">
        {/* Разделы */}
        <nav className="flex w-60 shrink-0 flex-col border-r border-gk-border bg-gk-sink/10">
          <div className="flex items-center gap-2 px-4 pb-2 pt-4">
            {tj('guide-2', [<BookOpen size={16} className="text-gk-green" />, <span className="text-[14px] font-semibold text-gk-strong" />])}
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 rounded-md bg-gk-bg px-2 ring-1 ring-gk-border focus-within:ring-gk-blue">
              <Search size={12} className="shrink-0 text-gk-dim" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search-guide')}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-gk-text outline-none placeholder:text-gk-dim"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {shown.length === 0 && <div className="px-2 py-3 text-[12px] text-gk-dim">{t('nothing-found')}</div>}
            {shown.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  s.id === active ? 'bg-gk-blue/15 text-gk-strong' : 'text-gk-muted hover:bg-gk-hover hover:text-gk-text'
                }`}
              >
                <s.icon size={14} className={`shrink-0 ${s.id === active ? 'text-gk-blue' : ''}`} />
                {s.title}
              </button>
            ))}
          </div>
        </nav>

        {/* Текст раздела */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-gk-border px-5">
            <section.icon size={17} className="text-gk-blue" />
            <h2 className="flex-1 text-[15px] font-semibold text-gk-strong">{section.title}</h2>
            <button onClick={onClose} title={t('close-esc')} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
              <X size={16} />
            </button>
          </div>
          <div ref={contentRef} key={section.id} className="scroll-fade min-h-0 flex-1 animate-fade-in overflow-y-auto px-6 text-[13px] text-gk-muted">
            <section.body />
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-gk-border px-5 py-2.5 text-[12px]">
            <button
              disabled={index === 0}
              onClick={() => setActive(SECTIONS[index - 1].id)}
              className="rounded px-2 py-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text disabled:invisible"
            >
              ← {SECTIONS[index - 1]?.title}
            </button>
            <span className="text-gk-dim">
              {index + 1} / {SECTIONS.length}
            </span>
            <button
              disabled={index === SECTIONS.length - 1}
              onClick={() => setActive(SECTIONS[index + 1].id)}
              className="rounded px-2 py-1 text-gk-muted hover:bg-gk-hover hover:text-gk-text disabled:invisible"
            >
              {SECTIONS[index + 1]?.title} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
