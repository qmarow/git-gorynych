import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react';
import { BookOpen, CloudDownload, FolderGit2, FolderOpen, Keyboard, Link2, Loader2, Plus, Search, Settings, X } from 'lucide-react';
import AppLogo from './AppLogo.tsx';
import { relativeTime } from '../lib/format.ts';
import { kb } from '../lib/platform.ts';
import { t, tj } from '../i18n/index.ts';

/** Недавний репозиторий (`recent:list`) */
interface RecentRepo {
  path: string;
  name: string;
  openedAt?: string | null;
}

/** `window.api.recent` */
interface RecentApi {
  recent?: { list?: () => Promise<unknown>; remove: (dir: string) => Promise<unknown> };
}

const api = (typeof window !== 'undefined' ? window.api : null) as RecentApi | null | undefined;

interface NewTabPageProps {
  loading?: boolean;
  loadingPath?: string | null;
  openPaths?: string[];
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onClone: () => void;
  onCreate: () => void;
  onConnect: () => void;
  onGuide: () => void;
  onShortcuts: () => void;
  onSettings: () => void;
}

/**
 * Страница «Новая вкладка» — как в GitKraken: слева репозитории (Открыть / Клонировать / Создать и недавние),
 * справа — коротко о возможностях и ссылки на справку. Клик по недавнему открывает его в этой же вкладке.
 */
export default function NewTabPage({ loading, loadingPath, openPaths = [], onOpen, onOpenPath, onClone, onCreate, onConnect, onGuide, onShortcuts, onSettings }: NewTabPageProps) {
  const [recent, setRecent] = useState<RecentRepo[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    (api?.recent?.list?.() ?? Promise.resolve([])).then((list) => alive && setRecent(Array.isArray(list) ? (list as RecentRepo[]) : []));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!recent) return [];
    const q = query.trim().toLowerCase();
    return q ? recent.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : recent;
  }, [recent, query]);

  const forget = async (dir: string) => {
    setRecent((list) => list?.filter((r) => r.path !== dir) ?? list);
    await api?.recent?.remove(dir);
  };

  const isOpen = (dir: string) => openPaths.some((p) => p.toLowerCase() === dir.toLowerCase());

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in bg-gk-bg/80" data-testid="new-tab-page">
      {/* Репозитории */}
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-[clamp(24px,6vw,96px)] py-9">
        <h1 className="mb-4 text-[19px] font-medium text-gk-strong">{t('repositories')}</h1>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={FolderOpen} label={t('open')} hint={kb('Ctrl+O')} onClick={onOpen} disabled={loading} />
          <ActionButton icon={CloudDownload} label={t('clone-2')} hint={kb('Ctrl+Shift+O')} onClick={onClone} disabled={loading} />
          <ActionButton icon={Plus} label={t('create')} hint={kb('Ctrl+N')} onClick={onCreate} disabled={loading} />
          <ActionButton icon={Link2} label={t('connect-to-gitlab-github')} onClick={onConnect} disabled={loading} subtle />
        </div>

        <div className="mt-7 flex items-center gap-3">
          <h2 className="text-[13px] font-medium text-gk-text">{t('recent')}</h2>
          {recent && recent.length > 6 && (
            <label className="flex w-56 items-center gap-1.5 rounded-md border border-gk-border bg-gk-sink/20 px-2 py-1 focus-within:border-gk-blue/60">
              <Search size={12} className="shrink-0 text-gk-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('find-repository')}
                aria-label={t('find-repository-2')}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-gk-text outline-none placeholder:text-gk-dim"
              />
            </label>
          )}
        </div>

        <div className="mt-2 min-h-0" data-testid="recent-list">
          {recent === null ? (
            <div className="flex items-center gap-2 py-1 text-[12.5px] text-gk-dim">
              {tj('loading-list', [<Loader2 size={12} className="animate-spin" />])}</div>
          ) : recent.length === 0 ? (
            <p className="py-1 text-[12.5px] leading-relaxed text-gk-dim">
              {t('repositories-youve-opened-will-appear')}</p>
          ) : shown.length === 0 ? (
            <p className="py-1 text-[12.5px] text-gk-dim">{t('nothing-found')}</p>
          ) : (
            <ul className="-mx-2">
              {shown.map((r) => {
                const busy = loading && loadingPath === r.path;
                return (
                  <li key={r.path} className="group flex items-center rounded-md hover:bg-gk-fg/[0.04]">
                    <button
                      onClick={() => onOpenPath(r.path)}
                      disabled={loading}
                      data-tip={`${r.path}${r.openedAt ? t('opened', relativeTime(r.openedAt)) : ''}${isOpen(r.path) ? t('already-open-switch-to-tab') : ''}`}
                      className="flex min-w-0 flex-1 items-baseline gap-2.5 px-2 py-[3px] text-left disabled:cursor-wait"
                    >
                      {busy ? (
                        <Loader2 size={12} className="shrink-0 animate-spin self-center text-gk-green" />
                      ) : (
                        <FolderGit2 size={12} className={`shrink-0 self-center ${isOpen(r.path) ? 'text-gk-green' : 'text-gk-dim'}`} />
                      )}
                      <span className="shrink-0 text-[13px] font-medium text-gk-blue group-hover:underline">{r.name}</span>
                      <span className="min-w-0 truncate text-[12px] text-gk-dim">{r.path}</span>
                    </button>
                    <button
                      onClick={() => forget(r.path)}
                      aria-label={t('remove-from-recent', r.name)}
                      data-tip={t('remove-from-list-repository-itself')}
                      className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gk-dim opacity-0 hover:bg-gk-fg/10 hover:text-gk-text group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* О программе и справка */}
      <aside className="hidden w-[min(42%,520px)] shrink-0 overflow-y-auto border-l border-gk-border/70 px-9 py-9 md:block">
        <div className="mb-3 flex items-center gap-2.5">
          <AppLogo size={26} />
          <h2 className="text-[16px] font-medium text-gk-strong">{t('work-faster-with-git-gorynych')}</h2>
        </div>
        <p className="text-[12.5px] leading-relaxed text-gk-muted">
          {t('drag-branches-onto-branches-to')}</p>
        <button
          onClick={onGuide}
          className="mt-3 flex items-center gap-2 rounded-md bg-gk-fg/[0.06] px-3 py-1.5 text-[13px] text-gk-text ring-1 ring-gk-border transition hover:bg-gk-hover"
        >
          {tj('open-guide', [<BookOpen size={14} className="text-gk-muted" />])}</button>

        <h3 className="mb-1.5 mt-7 text-[13px] font-medium text-gk-text">{t('resources')}</h3>
        <ul className="space-y-1 text-[13px]">
          <li>
            <button onClick={onGuide} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              {t('how-to-use-app-f1-2')}</button>
          </li>
          <li>
            <button onClick={onShortcuts} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              {tj('keyboard-shortcuts-2', [<Keyboard size={12} />])}</button>
          </li>
          <li>
            <button onClick={onSettings} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              {tj('settings-and-appearance-2', [<Settings size={12} />])}</button>
          </li>
        </ul>
      </aside>
    </div>
  );
}

function ActionButton({ icon: Icon, label, hint, subtle, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ComponentType<{ size?: number; className?: string }>; label: ReactNode; hint?: string; subtle?: boolean }) {
  return (
    <button
      {...props}
      data-tip={hint}
      className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-[13.5px] transition disabled:opacity-50 ${
        subtle
          ? 'text-gk-muted ring-1 ring-gk-border hover:bg-gk-hover hover:text-gk-text'
          : 'bg-gk-fg/[0.07] text-gk-text ring-1 ring-gk-fg/[0.06] hover:bg-gk-hover'
      }`}
    >
      <Icon size={15} className={subtle ? '' : 'text-gk-text'} />
      {label}
    </button>
  );
}
