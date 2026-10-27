import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CloudDownload, FolderGit2, FolderOpen, Keyboard, Link2, Loader2, Plus, Search, Settings, X } from 'lucide-react';
import AppLogo from './AppLogo.jsx';
import { relativeTime } from '../lib/format.js';
import { kb } from '../lib/platform.js';

const api = typeof window !== 'undefined' ? window.api : null;

/**
 * Страница «Новая вкладка» — как в GitKraken: слева репозитории (Открыть / Клонировать / Создать и недавние),
 * справа — коротко о возможностях и ссылки на справку. Клик по недавнему открывает его в этой же вкладке.
 */
export default function NewTabPage({ loading, loadingPath, openPaths = [], onOpen, onOpenPath, onClone, onCreate, onConnect, onGuide, onShortcuts, onSettings }) {
  const [recent, setRecent] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    (api?.recent?.list?.() ?? Promise.resolve([])).then((list) => alive && setRecent(Array.isArray(list) ? list : []));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!recent) return [];
    const q = query.trim().toLowerCase();
    return q ? recent.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : recent;
  }, [recent, query]);

  const forget = async (dir) => {
    setRecent((list) => list?.filter((r) => r.path !== dir) ?? list);
    await api?.recent?.remove(dir);
  };

  const isOpen = (dir) => openPaths.some((p) => p.toLowerCase() === dir.toLowerCase());

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in bg-gk-bg/80" data-testid="new-tab-page">
      {/* Репозитории */}
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-[clamp(24px,6vw,96px)] py-9">
        <h1 className="mb-4 text-[19px] font-medium text-gk-strong">Репозитории</h1>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={FolderOpen} label="Открыть" hint={kb('Ctrl+O')} onClick={onOpen} disabled={loading} />
          <ActionButton icon={CloudDownload} label="Клонировать" hint={kb('Ctrl+Shift+O')} onClick={onClone} disabled={loading} />
          <ActionButton icon={Plus} label="Создать" hint={kb('Ctrl+N')} onClick={onCreate} disabled={loading} />
          <ActionButton icon={Link2} label="Подключить к GitLab / GitHub" onClick={onConnect} disabled={loading} subtle />
        </div>

        <div className="mt-7 flex items-center gap-3">
          <h2 className="text-[13px] font-medium text-gk-text">Недавние</h2>
          {recent && recent.length > 6 && (
            <label className="flex w-56 items-center gap-1.5 rounded-md border border-gk-border bg-gk-sink/20 px-2 py-1 focus-within:border-gk-blue/60">
              <Search size={12} className="shrink-0 text-gk-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти репозиторий…"
                aria-label="Найти репозиторий"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-gk-text outline-none placeholder:text-gk-dim"
              />
            </label>
          )}
        </div>

        <div className="mt-2 min-h-0" data-testid="recent-list">
          {recent === null ? (
            <div className="flex items-center gap-2 py-1 text-[12.5px] text-gk-dim">
              <Loader2 size={12} className="animate-spin" /> Загружаем список…
            </div>
          ) : recent.length === 0 ? (
            <p className="py-1 text-[12.5px] leading-relaxed text-gk-dim">
              Здесь появятся репозитории, которые вы открывали. Начните с «Открыть» — если в папке нет Git, программа предложит его создать.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-1 text-[12.5px] text-gk-dim">Ничего не найдено</p>
          ) : (
            <ul className="-mx-2">
              {shown.map((r) => {
                const busy = loading && loadingPath === r.path;
                return (
                  <li key={r.path} className="group flex items-center rounded-md hover:bg-gk-fg/[0.04]">
                    <button
                      onClick={() => onOpenPath(r.path)}
                      disabled={loading}
                      data-tip={`${r.path}${r.openedAt ? `\nОткрывали ${relativeTime(r.openedAt)}` : ''}${isOpen(r.path) ? '\nУже открыт — переключиться на вкладку' : ''}`}
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
                      aria-label={`Убрать ${r.name} из недавних`}
                      data-tip="Убрать из списка (сам репозиторий не трогается)"
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
          <h2 className="text-[16px] font-medium text-gk-strong">Работайте быстрее с git-Горынычем</h2>
        </div>
        <p className="text-[12.5px] leading-relaxed text-gk-muted">
          Перетаскивайте ветки на ветки для merge и rebase, переключайтесь без stash вручную, проверяйте коммиты на забытые console.log и
          ключи до отправки, следите за пайплайнами GitLab и правьте .gitlab-ci.yml — всё в одном окне.
        </p>
        <button
          onClick={onGuide}
          className="mt-3 flex items-center gap-2 rounded-md bg-gk-fg/[0.06] px-3 py-1.5 text-[13px] text-gk-text ring-1 ring-gk-border transition hover:bg-gk-hover"
        >
          <BookOpen size={14} className="text-gk-muted" /> Открыть руководство
        </button>

        <h3 className="mb-1.5 mt-7 text-[13px] font-medium text-gk-text">Ресурсы</h3>
        <ul className="space-y-1 text-[13px]">
          <li>
            <button onClick={onGuide} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              Как пользоваться программой (F1)
            </button>
          </li>
          <li>
            <button onClick={onShortcuts} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              <Keyboard size={12} /> Горячие клавиши
            </button>
          </li>
          <li>
            <button onClick={onSettings} className="flex items-center gap-1.5 text-gk-blue hover:underline">
              <Settings size={12} /> Настройки и оформление
            </button>
          </li>
        </ul>
      </aside>
    </div>
  );
}

function ActionButton({ icon: Icon, label, hint, subtle, ...props }) {
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
