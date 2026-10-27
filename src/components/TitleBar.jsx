import { useEffect, useState } from 'react';
import { Copy, FolderGit2, Loader2, Minus, Plus, Square, X } from 'lucide-react';
import AppLogo from './AppLogo.jsx';
import { IS_MAC, kb } from '../lib/platform.js';

// Подписи — по-русски, ключи — имена меню в App (appMenus)
const MENU = [
  ['File', 'Файл'],
  ['Edit', 'Правка'],
  ['View', 'Вид'],
  ['Actions', 'Действия'],
  ['Help', 'Справка'],
];

/**
 * Заголовок окна: меню, вкладки репозиториев, кнопки окна.
 * macOS: меню — в системной строке меню, кнопки окна — нативный «светофор» слева (под него отступ).
 */
export default function TitleBar({ tabs, activePath, loadingPath, onSelectTab, onCloseTab, onOpenRepository, onNewTab, onMenu }) {
  const [maximized, setMaximized] = useState(false);
  const win = window.api?.window;

  useEffect(() => {
    if (!win) return undefined;
    win.isMaximized().then(setMaximized);
    return win.onMaximizedChange(setMaximized);
  }, [win]);

  return (
    <header
      className="app-drag glass relative z-30 flex h-9 shrink-0 items-stretch border-b border-gk-border bg-gk-titlebar"
      onDoubleClick={() => win?.toggleMaximize()}
    >
      {/* Логотип + меню (на macOS меню в системной строке, а слева — место под «светофор») */}
      {IS_MAC ? (
        <div className="flex shrink-0 items-center" style={{ paddingLeft: 78 }} data-testid="mac-traffic-lights-space">
          <AppLogo size={18} className="mr-1 shrink-0 opacity-80" />
        </div>
      ) : (
        <div className="flex items-center gap-1 pl-3 pr-2">
          <AppLogo size={20} className="mr-2 shrink-0" />
          {MENU.map(([key, label]) => (
            <button
              key={key}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onMenu?.(key, r.left, r.bottom + 4);
              }}
              className="app-no-drag rounded px-2 py-1 text-xs text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Вкладки репозиториев */}
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-hidden pl-2">
        {tabs.map((tab) => (
          <Tab
            key={tab.path}
            tab={tab}
            active={tab.path === activePath}
            // Репозиторий открывается из «Новой вкладки» — крутилка на ней самой
            loading={tab.path === loadingPath || (tab.isNew && tab.path === activePath && Boolean(loadingPath))}
            onSelect={() => onSelectTab(tab.path)}
            onClose={() => onCloseTab(tab.path)}
          />
        ))}
        <button
          title={kb('Новая вкладка (Ctrl+T)')}
          aria-label="Новая вкладка"
          onClick={onNewTab ?? onOpenRepository}
          className="app-no-drag mb-1 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
        >
          {loadingPath && !tabs.some((t) => t.path === loadingPath || (t.isNew && t.path === activePath)) ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
        </button>
      </div>

      {/* Кнопки управления окном (Windows/Linux; на macOS — нативные) */}
      {!IS_MAC && <div className="app-no-drag flex" onDoubleClick={(e) => e.stopPropagation()}>
        <WindowButton title="Свернуть" onClick={() => win?.minimize()}>
          <Minus size={15} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton title={maximized ? 'Восстановить' : 'Развернуть'} onClick={() => win?.toggleMaximize()}>
          {maximized ? (
            <Copy size={12} strokeWidth={1.5} className="-scale-x-100" />
          ) : (
            <Square size={12} strokeWidth={1.5} />
          )}
        </WindowButton>
        <WindowButton title="Закрыть" danger onClick={() => win?.close()}>
          <X size={16} strokeWidth={1.5} />
        </WindowButton>
      </div>}
    </header>
  );
}

function Tab({ tab, active, loading, onSelect, onClose }) {
  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.isNew ? 'Новая вкладка — открыть, клонировать или создать репозиторий' : tab.path}
      onMouseDown={(e) => e.button === 0 && onSelect()}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`app-no-drag group relative flex h-8 min-w-0 max-w-52 shrink animate-pop-in cursor-default items-center gap-2 rounded-t-md px-3 text-xs transition-colors ${
        active
          ? 'border-x border-t border-gk-border bg-gk-bg text-gk-text'
          : 'text-gk-muted hover:bg-gk-hover hover:text-gk-text'
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 rounded-t bg-gk-green" />}
      {loading ? (
        <Loader2 size={13} className="shrink-0 animate-spin text-gk-green" />
      ) : (
        !tab.isNew && <FolderGit2 size={13} className={`shrink-0 ${active ? 'text-gk-green' : ''}`} />
      )}
      <span className={`truncate ${active ? 'font-medium' : ''}`}>{tab.name}</span>
      <button
        title={kb('Закрыть вкладку (Ctrl+W)')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={`-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-gk-dim transition hover:bg-gk-fg/10 hover:text-gk-text ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function WindowButton({ children, danger, ...props }) {
  return (
    <button
      {...props}
      className={`flex w-12 items-center justify-center text-gk-muted transition-colors ${
        danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-gk-hover hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}
