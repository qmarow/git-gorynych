/**
 * Новое в 2.0: раздел «Задачи» — шапка, список слева (`IssueList`, ширина `issues.list`, 320…720), карточка справа,
 * клавиши раздела, таймеры обновления.
 *
 * Данные — `issuesStore` (по пути репозитория): фильтр, выбор и прокрутка переживают переключение вкладок.
 * Обновление: при открытии и смене фильтра, по F5, при возврате фокуса в окно (если прошло больше 60 с) и каждые
 * 120 с, пока раздел открыт; в скрытом окне запрос пропускается. Фоновое обновление тихое (`silent`): прокрутка,
 * выбор и текст поиска остаются. С клавиатуры карточка загружается через 150 мс после последней смены выбора.
 * Клавиши — один обработчик на корне раздела; буквенные проверяются по `event.code` (русская раскладка) и не
 * работают в полях ввода. Уже 640 px видна одна панель: список или карточка с «Назад к списку».
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CircleDot, FilePen, Inbox, KeyRound, Keyboard, Plus, Plug, SearchX } from 'lucide-react';
import { rowMenu } from './issueRowMenu.ts';
import { Button } from '../Dialogs.tsx';
import ContextMenu, { type MenuEntry } from '../ContextMenu.tsx';
import { ResizeHandle, useStoredWidth } from '../Resizer.tsx';
import { isDefaultQuery, type IssueQuery } from '../../lib/issues.ts';
import { issuesStore, useIssuesStore } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { ForgeStatus_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssuesHeader from './IssuesHeader.tsx';
import IssueFilters from './IssueFilters.tsx';
import IssueList from './IssueList.tsx';
import IssueDetail, { type IssueDetailHandle } from './IssueDetail.tsx';
import IssueForm from './IssueForm.tsx';
import { loadDraft } from '../../lib/issueDrafts.ts';
import { EmptyState, ErrorBar, Skeleton } from './IssueBits.tsx';
import { KeyHelp, KeyList } from './IssueKeys.tsx';

const REFRESH_EVERY = 120_000;
const REFRESH_ON_FOCUS_AFTER = 60_000;
const SELECT_DELAY = 150;
const NARROW = 640;

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

interface IssuesViewProps {
  repoPath: string;
  remote: string | null;
  forge: ForgeStatus_Serialize | null;
  currentBranch?: string | null;
  onClose: () => void;
  onLogin: () => void;
  onServerSettings: () => void;
  onOpenWeb: (url: string) => void;
  onCopy: (text: string, what: string) => void;
  notify: Notify;
  /** Этап 6: ветка из задачи. */
  onCreateBranch?: (name: string) => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
const visible = () => document.visibilityState === 'visible';
const LOGIN_CODES = new Set(['NO_TOKEN', 'AUTH']);
const NO_SERVER_CODES = new Set(['NO_REMOTE', 'NO_PROVIDER']);

/** Настройки задач на сервере: GitLab — «Общие», GitHub и Gitea — настройки репозитория. */
function serverSettingsUrl(forge: ForgeStatus_Serialize | null): string | null {
  if (!forge?.webUrl) return null;
  return forge.provider === 'gitlab' ? `${forge.webUrl}/edit` : `${forge.webUrl}/settings`;
}

export default function IssuesView({ repoPath, remote, forge, onClose, onLogin, onServerSettings, onOpenWeb, onCopy, notify }: IssuesViewProps) {
  const repo = useIssuesStore((s) => s.byRepo[repoPath]);
  const store = issuesStore.getState;
  const rootRef = useRef<HTMLDivElement>(null);
  const listEl = useRef<HTMLDivElement | null>(null);
  const searchEl = useRef<HTMLInputElement | null>(null);
  const cardEl = useRef<IssueDetailHandle | null>(null);
  const lastFetch = useRef(0);
  const selectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cursor, setCursor] = useState<number | null>(null);
  const [localSearch, setLocalSearch] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [help, setHelp] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [listW, setListW, persistListW] = useStoredWidth('issues.list', 420, 320, 720);

  // Открытие раздела и смена репозитория
  useEffect(() => {
    lastFetch.current = Date.now();
    setCursor(null);
    setLocalSearch('');
    void store().open(repoPath, remote);
  }, [repoPath, remote, store]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(selectTimer.current);
  }, []);

  const refresh = useCallback(
    (silent: boolean) => {
      lastFetch.current = Date.now();
      void store().refresh(repoPath, { silent });
    },
    [repoPath, store],
  );

  // Таймеры: каждые 120 с и при возврате фокуса, только в видимом окне
  useEffect(() => {
    const timer = setInterval(() => visible() && refresh(true), REFRESH_EVERY);
    const onFocus = () => visible() && Date.now() - lastFetch.current > REFRESH_ON_FOCUS_AFTER && refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const items = useMemo(() => {
    const all = repo?.items ?? [];
    const needle = repo?.caps?.textSearch === false ? localSearch.trim().toLocaleLowerCase() : '';
    if (!needle) return all;
    return all.filter((issue) => issue.title.toLocaleLowerCase().includes(needle) || `#${issue.number}`.includes(needle.replace(/^#?/, '#')));
  }, [repo?.items, repo?.caps?.textSearch, localSearch]);

  const selected = typeof repo?.selected === 'number' ? repo.selected : null;
  const formOpen = repo?.selected === 'new';
  const openForm = () => {
    clearTimeout(selectTimer.current);
    setCursor(null);
    setHelp(false);
    void store().select(repoPath, 'new');
  };
  const hasDraft = Boolean(repo && !formOpen && repo.caps?.create && loadDraft(repoPath, 'new'));
  const shown = cursor ?? selected;

  const onQuery = useCallback(
    (patch: Partial<IssueQuery>) => {
      lastFetch.current = Date.now();
      void store().setQuery(repoPath, patch);
    },
    [repoPath, store],
  );
  const selectNow = useCallback(
    (number: number | null) => {
      clearTimeout(selectTimer.current);
      setCursor(null);
      void store().select(repoPath, number);
    },
    [repoPath, store],
  );
  const loadMore = useCallback(() => void store().loadMore(repoPath), [repoPath, store]);

  const move = (delta: number) => {
    if (!items.length) return;
    const index = items.findIndex((issue) => issue.number === shown);
    const next = items[index < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, index + delta))].number;
    setCursor(next);
    clearTimeout(selectTimer.current);
    selectTimer.current = setTimeout(() => selectNow(next), SELECT_DELAY);
  };

  const changeIssue = async (number: number, patch: Parameters<ReturnType<typeof store>['update']>[2]) => {
    const res = await store().update(repoPath, number, patch);
    if (!res.ok) notify({ type: 'error', title: t('issues-update-failed'), hint: res.error.message, action: { label: t('issues-retry'), onClick: () => void changeIssue(number, patch) } });
  };

  const openMenu = useCallback(
    (number: number, x: number, y: number) => {
      const cur = issuesStore.getState().byRepo[repoPath];
      const issue = cur?.items.find((i) => i.number === number);
      if (!cur || !issue) return;
      setMenu({
        x,
        y,
        items: rowMenu(issue, cur.caps, cur.meta?.me ?? null, { open: () => selectNow(number), change: (patch) => void changeIssue(number, patch), onCopy, onOpenWeb }),
      });
    },
    [repoPath, selectNow, onCopy, onOpenWeb],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'F5') {
      e.preventDefault();
      refresh(false);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) setMenu(null);
      else if (help) setHelp(false);
      else if (listEl.current && document.activeElement !== listEl.current) listEl.current.focus();
      else onClose();
      return;
    }
    if (isTyping(e.target)) return;
    if (e.key === 'ArrowDown' || e.code === 'KeyJ') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || e.code === 'KeyK') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' && shown != null) {
      e.preventDefault();
      if (cursor != null) selectNow(cursor);
      cardEl.current?.focus();
    } else if (e.code === 'KeyC' && !e.shiftKey) {
      if (!repo?.caps?.create) return;
      e.preventDefault();
      openForm();
    } else if (e.code === 'KeyR' && !e.shiftKey && cardEl.current) {
      e.preventDefault();
      cardEl.current.focusComment();
    } else if (e.code === 'KeyE' && !e.shiftKey && cardEl.current) {
      e.preventDefault();
      cardEl.current.editTitle();
    } else if ((e.code === 'KeyL' || e.code === 'KeyA' || e.code === 'KeyM') && !e.shiftKey && cardEl.current) {
      e.preventDefault();
      cardEl.current.openPicker(e.code === 'KeyL' ? 'labels' : e.code === 'KeyA' ? 'assignees' : 'milestone');
    } else if (e.code === 'Slash' || e.key === '/') {
      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      e.preventDefault();
      searchEl.current?.focus();
      searchEl.current?.select();
    } else if (e.key === '?') {
      e.preventDefault();
      setHelp((h) => !h);
    }
  };

  const code = repo?.listError?.code ?? null;
  const fatal = repo?.listStatus === 'error' && code && (LOGIN_CODES.has(code) || NO_SERVER_CODES.has(code) || code === 'ISSUES_DISABLED') ? code : null;
  const caps = repo?.caps ?? null;
  const readOnly = Boolean(caps && !caps.create && !caps.edit && !caps.close && !caps.comment);
  // Задача не из списка (ссылка #номер в тексте) — из загруженной карточки
  const shownIssue = shown != null ? (repo?.items.find((i) => i.number === shown) ?? repo?.details[shown]?.detail?.issue ?? null) : null;
  const shownEntry = shown != null ? repo?.details[shown] : undefined;
  const showList = !narrow || (shown == null && !formOpen);
  const showCard = !narrow || shown != null || formOpen;

  let body: ReactNode;
  if (fatal && LOGIN_CODES.has(fatal)) {
    body = (
      <EmptyState state="login" icon={KeyRound} title={t('issues-login-needed', forge?.host ?? '')}>
        <Button variant="primary" onClick={onLogin}>{t('issues-login')}</Button>
      </EmptyState>
    );
  } else if (fatal && NO_SERVER_CODES.has(fatal)) {
    body = (
      <EmptyState state="no-server" icon={Plug} title={t('issues-no-server')}>
        <button type="button" onClick={onServerSettings} className="text-xs text-gk-blue hover:underline">{t('issues-server-settings')}</button>
      </EmptyState>
    );
  } else if (fatal === 'ISSUES_DISABLED') {
    const url = serverSettingsUrl(forge);
    body = (
      <EmptyState state="disabled" icon={Inbox} title={t('issues-tracker-off')}>
        {url && <Button onClick={() => onOpenWeb(url)}>{t('issues-open-server-settings')}</Button>}
      </EmptyState>
    );
  } else {
    const filtered = repo ? !isDefaultQuery(repo.query) || Boolean(localSearch.trim()) : false;
    const listBody =
      !repo || (repo.listStatus === 'loading' && !repo.items.length) ? (
        <div className="min-h-0 flex-1 overflow-hidden"><Skeleton rows={8} /></div>
      ) : items.length ? (
        <IssueList
          scrollKey={repoPath}
          items={items}
          selected={shown}
          seenAt={repo.seenAt}
          hasMore={repo.hasMore && !localSearch.trim()}
          listStatus={repo.listStatus}
          stateFilter={repo.query.state ?? null}
          onLoadMore={loadMore}
          onSelect={selectNow}
          onContextMenu={openMenu}
          listRef={(el) => (listEl.current = el)}
        />
      ) : repo.listStatus === 'error' ? (
        <div className="flex-1" />
      ) : filtered ? (
        <EmptyState state="empty-filter" icon={SearchX} title={t('issues-empty-filter')}>
          <button
            type="button"
            onClick={() => (setLocalSearch(''), onQuery({ state: 'open', search: null, labels: [], assignee: null, author: null, milestone: null, sort: 'updated', ascending: false }))}
            className="text-xs text-gk-blue hover:underline"
          >
            {t('issues-reset-filters')}
          </button>
        </EmptyState>
      ) : (
        <EmptyState state="empty-repo" icon={Inbox} title={t('issues-empty-repo')}>
          {repo.caps?.create && (
            <Button variant="primary" onClick={openForm}>
              {t('issues-create-first')}
            </Button>
          )}
        </EmptyState>
      );
    body = (
      <div className="flex min-h-0 flex-1">
        {showList && (
          <div style={narrow ? undefined : { width: listW }} className={`relative flex min-h-0 flex-col border-r border-gk-border ${narrow ? 'flex-1' : 'shrink-0'}`}>
            {repo && (
              <IssueFilters
                key={repoPath}
                repo={repo}
                onQuery={onQuery}
                onOpenNumber={(n) => selectNow(n)}
                onLocalSearch={setLocalSearch}
                searchRef={(el) => (searchEl.current = el)}
              />
            )}
            {repo?.listStatus === 'error' && repo.listError && <ErrorBar message={repo.listError.message} onRetry={() => refresh(false)} />}
            {listBody}
            {!narrow && <ResizeHandle width={listW} onResize={setListW} onCommit={persistListW} onReset={() => persistListW(setListW(null))} className="-right-1" />}
          </div>
        )}
        {showCard && (
          <div className="relative flex min-w-0 flex-1 flex-col">
            {help ? (
              <KeyHelp />
            ) : formOpen && repo ? (
              <IssueForm key={repoPath} repoPath={repoPath} caps={repo.caps} meta={repo.meta} issues={repo.items} notify={notify} onCancel={() => selectNow(null)} />
            ) : shownIssue && repo ? (
              <IssueDetail
                ref={cardEl}
                key={shownIssue.number}
                repoPath={repoPath}
                issue={shownIssue}
                entry={shownEntry}
                caps={repo.caps}
                meta={repo.meta}
                issues={repo.items}
                onBack={narrow ? () => selectNow(null) : undefined}
                onOpenIssue={selectNow}
                onOpenWeb={onOpenWeb}
                onCopy={onCopy}
                notify={notify}
              />
            ) : shown != null && shownEntry?.status === 'error' ? (
              <EmptyState state="card-error" icon={SearchX} title={`${t('issues-card-failed')}: ${shownEntry.error?.message ?? ''}`}>
                <button type="button" onClick={() => selectNow(shown)} className="text-xs text-gk-blue hover:underline">{t('issues-retry')}</button>
              </EmptyState>
            ) : shown != null ? (
              <div className="min-h-0 flex-1 overflow-hidden pt-3" aria-label={t('issues-card-loading')}><Skeleton rows={4} /></div>
            ) : (
              <EmptyState icon={CircleDot} title={t('issues-no-selection')}>
                <KeyList />
              </EmptyState>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} data-testid="issues-view" tabIndex={-1} onKeyDown={onKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col bg-gk-bg outline-none animate-fade-in">
      <IssuesHeader
        repoName={forge?.path ?? null}
        refreshing={repo?.listStatus === 'refreshing'}
        webUrl={repo?.webUrl ?? null}
        onRefresh={() => refresh(false)}
        onOpenWeb={onOpenWeb}
        onClose={onClose}
        extra={
          <>
          {hasDraft && (
            <button type="button" data-testid="issues-draft-link" onClick={openForm} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gk-blue hover:bg-gk-hover">
              <FilePen size={13} />
              {t('issues-draft-link')}
            </button>
          )}
          {caps?.create && !fatal && (
            <Button variant="primary" data-testid="issues-new" onClick={openForm} className="h-7 py-0 text-xs">
              <Plus size={13} />
              {t('issues-new')}
            </Button>
          )}
          <button type="button" data-tip={t('issues-key-help')} aria-label={t('issues-key-help')} onClick={() => setHelp((h) => !h)} className="flex h-7 w-7 items-center justify-center rounded text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            <Keyboard size={15} strokeWidth={1.75} />
          </button>
          </>
        }
      />
      {readOnly && !fatal && <div className="shrink-0 border-b border-gk-border bg-gk-yellow/10 px-3 py-1 text-xs text-gk-muted">{t('issues-read-only')}</div>}
      {body}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
