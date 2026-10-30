import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusIcon, statusInfo } from './PipelineStatus.jsx';
import { hasRefDrag, readRefDrag, startRefDrag } from '../lib/dnd.js';
import { SyncBadges } from './BranchSync.jsx';
import { kb } from '../lib/platform.js';
import { RefKindIcon } from './RefBadge.jsx';
import { describeStash, shortAgo } from '../lib/stashName.js';
import { fullDate, relativeTime } from '../lib/format.js';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Filter,
  Folder,
  FolderOpen,
  FolderTree,
  Laptop,
  Link2,
  Server,
  Tag,
  Workflow,
} from 'lucide-react';

const CI_COLORS = {
  gitlab: '#fc6d26',
  github: '#8b9cff',
  jenkins: '#d24939',
  bitbucket: '#2684ff',
  circleci: '#3cf0a0',
  azure: '#0a84ff',
  travis: '#cd3f41',
  drone: '#7bc8ff',
  woodpecker: '#4caf50',
};

export default function Sidebar({
  repo,
  selectedHash,
  onSelect,
  onCheckout,
  onStashMenu,
  onOpenCi,
  activeCiFile,
  forge,
  branchPipeline,
  pipelinesError,
  pipelinesActive,
  onOpenPipelines,
  dragSource,
  onDragSource,
  onDropOnBranch,
  refActions,
  busy,
}) {
  // Перетаскивание: ветки можно тащить (на другие ветки — слить, перемотать, rebase), локальные ветки принимают
  const [dropName, setDropName] = useState(null);
  useEffect(() => {
    if (!dragSource) setDropName(null);
  }, [dragSource]);
  const dragProps = (payload) => ({
    draggable: true,
    onDragStart: (e) => {
      startRefDrag(e, payload);
      onDragSource?.(payload);
    },
    onDragEnd: () => onDragSource?.(null),
  });
  const dropProps = (branch) => ({
    onDragOver: (e) => {
      if (!hasRefDrag(e) || !dragSource) return;
      if ((dragSource.kind === 'branch' && dragSource.name === branch.name) || dragSource.hash === branch.hash) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (dropName !== branch.name) setDropName(branch.name);
    },
    onDragLeave: () => setDropName((n) => (n === branch.name ? null : n)),
    onDrop: (e) => {
      e.preventDefault();
      setDropName(null);
      const payload = readRefDrag(e);
      onDragSource?.(null);
      if (payload) onDropOnBranch?.([{ name: branch.name, hash: branch.hash }], e.clientX, e.clientY, payload);
    },
  });
  const [filter, setFilter] = useState('');
  const filterRef = useRef(null);
  // Ctrl+Alt+F (⌘⌥F на macOS) — сюда
  useEffect(() => {
    const focus = () => {
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    window.addEventListener('gitidea:focus-filter', focus);
    return () => window.removeEventListener('gitidea:focus-filter', focus);
  }, []);
  const match = (name) => name.toLowerCase().includes(filter.toLowerCase());
  const folders = useFolders();
  // Правки, спрятанные «умным переключением» под именем ветки
  const autoStash = (msg) => /(?:gorynych|gitidea)-auto: (.+)$/.exec(msg ?? '')?.[1]?.trim() ?? null;
  const waiting = new Map();
  const waitingAt = new Map(); // ветка → когда спрятано последний раз
  for (const st of repo.stashes) {
    const ab = autoStash(st.message);
    if (ab && st.date && !(waitingAt.get(ab) > st.date)) waitingAt.set(ab, st.date);
    const b = autoStash(st.message);
    if (b) waiting.set(b, (waiting.get(b) ?? 0) + 1);
  }
  const remoteCount = repo.remotes.reduce((n, r) => n + r.branches.length, 0);
  // Где какая ветка: серверные хэши и какие локальные ветки за ними следят
  const remoteHash = new Map(repo.remotes.flatMap((r) => r.branches.map((b) => [b.fullName, b.hash])));
  const trackedBy = new Map();
  for (const b of repo.localBranches) if (b.upstream) trackedBy.set(b.upstream, b);
  const syncedLocal = (b) => Boolean(b.upstream && !b.gone && remoteHash.get(b.upstream) === b.hash);
  const menuProps = (ref) => ({
    onContextMenu: (e) => {
      e.preventDefault();
      refActions?.menu?.(ref, e.clientX, e.clientY);
    },
  });
  const syncActions = { update: refActions?.update, push: refActions?.push, log: refActions?.log, select: onSelect };
  const ciSystems = repo.ci ?? [];
  const ciCount = ciSystems.reduce((n, s) => n + s.files.length, 0);

  return (
    <aside className="glass flex w-full min-w-0 flex-col border-r border-gk-border bg-gk-panel">
      <div className="border-b border-gk-border p-2">
        <label className="@container flex items-center gap-1.5 rounded bg-gk-bg px-2 py-1.5 ring-1 ring-gk-border focus-within:ring-gk-blue">
          <Filter size={13} className="text-gk-dim" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            ref={filterRef}
            placeholder="Фильтр веток и тегов…"
            title={kb('Фильтр веток и тегов (Ctrl+Alt+F)')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('');
                e.currentTarget.blur();
              }
            }}
            className="peer min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gk-dim"
          />
          {/* Сочетание клавиш — отдельным бейджем, пока поле пустое и не в фокусе */}
          {!filter && (
            <kbd
              data-testid="filter-kbd"
              className="pointer-events-none hidden shrink-0 rounded border border-gk-border bg-gk-fg/[0.04] px-1 font-sans text-[10px] leading-[16px] text-gk-dim @[220px]:inline peer-focus:!hidden"
            >
              {kb('Ctrl+Alt+F')}
            </kbd>
          )}
          <button
            type="button"
            onClick={folders.toggleGrouping}
            title={folders.grouping ? 'Ветки сгруппированы по папкам (feature/, bugfix/…) — показать списком' : 'Сгруппировать ветки по папкам до «/»'}
            className={`shrink-0 rounded p-0.5 transition-colors ${folders.grouping ? 'text-gk-blue hover:bg-gk-blue/15' : 'text-gk-dim hover:bg-gk-hover hover:text-gk-text'}`}
          >
            <FolderTree size={13} />
          </button>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <Section title="Локальные" icon={Laptop} count={repo.localBranches.length}>
          <BranchTree
            branches={repo.localBranches.filter((b) => match(b.name))}
            folderKey="local"
            folders={folders}
            filtering={Boolean(filter)}
            depth={0}
            isCurrent={(b) => b.name === repo.currentBranch}
            renderBranch={(branch, label, depth) => (
              <Item
                key={branch.name}
                depth={depth}
                {...dragProps({ kind: 'branch', name: branch.name, hash: branch.hash, label: branch.name })}
                {...dropProps(branch)}
                {...menuProps({ type: 'local', name: branch.name })}
                dropTarget={dropName === branch.name}
                title={`${branch.name}\n${
                  !branch.upstream
                    ? 'Только у вас — на сервер ещё не отправлена'
                    : branch.gone
                      ? `${branch.upstream} удалена на сервере`
                      : syncedLocal(branch)
                        ? `Синхронизирована с ${branch.upstream}`
                        : `Следит за ${branch.upstream}${branch.ahead ? ` · впереди на ${branch.ahead}` : ''}${branch.behind ? ` · позади на ${branch.behind}` : ''}`
                }\nДвойной клик — checkout, правый клик — действия`}
                current={branch.name === repo.currentBranch}
                selected={branch.hash === selectedHash}
                onClick={() => onSelect(branch.hash)}
                onDoubleClick={() => branch.name !== repo.currentBranch && onCheckout({ branch: branch.name })}
              >
                <span className="w-3.5 shrink-0">
                  {branch.name === repo.currentBranch && <Check size={13} className="text-gk-green" />}
                </span>
                <span className="flex w-[25px] shrink-0">
                  <RefKindIcon local remote={syncedLocal(branch)} size={12} className={syncedLocal(branch) ? 'text-gk-muted' : 'text-gk-dim'} />
                </span>
                <span className="truncate">{label}</span>
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-gk-muted">
                  {waiting.has(branch.name) && (
                    <span
                      data-tip={`Спрятанные правки ветки ${branch.name}${waiting.get(branch.name) > 1 ? ` (${waiting.get(branch.name)})` : ''}${
                        waitingAt.get(branch.name) ? ` · ${relativeTime(waitingAt.get(branch.name))}` : ''
                      }\nВернутся сами, когда вы переключитесь на эту ветку (stash «${branch.name}» с пометкой «авто»)`}
                      data-testid="waiting-stash"
                      className="flex items-center text-gk-yellow/90"
                    >
                      <Archive size={11} />
                    </span>
                  )}
                  <SyncBadges branch={branch} current={branch.name === repo.currentBranch} busy={busy} actions={syncActions} />
                </span>
              </Item>
            )}
          />
          {repo.localBranches.length === 0 && <Empty>Нет коммитов</Empty>}
        </Section>

        <Section title="На сервере" icon={Cloud} count={remoteCount}>
          {repo.remotes.map((remote) => (
            <RemoteGroup
              key={remote.name}
              remote={remote}
              match={match}
              dragProps={dragProps}
              menuProps={menuProps}
              trackedBy={trackedBy}
              onDeleteRemote={refActions?.deleteRemote}
              folders={folders}
              filtering={Boolean(filter)}
              selectedHash={selectedHash}
              onSelect={onSelect}
              onCheckout={onCheckout}
            />
          ))}
          {repo.remotes.length === 0 && <Empty>Remote не настроен</Empty>}
        </Section>

        <Section title="Stash" icon={Archive} count={repo.stashes.length}>
          {repo.stashes.filter((s) => match(s.message) || match(describeStash(s).title)).map((stash) => {
            const d = describeStash(stash);
            return (
              <Item
                key={stash.hash}
                title={`${d.title}${d.detail ? ` — ${d.detail}` : ''}\n${stash.id} · ${stash.date ? fullDate(stash.date) : ''}\n${
                  d.auto ? 'Вернётся само, когда вы переключитесь на эту ветку\n' : ''
                }Клик — посмотреть изменения, правый клик — действия`}
                selected={selectedHash === `stash:${stash.hash}`}
                onClick={() => onSelect(`stash:${stash.hash}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(`stash:${stash.hash}`);
                  onStashMenu?.(stash, e.clientX, e.clientY);
                }}
              >
                <Archive size={13} className="shrink-0 text-gk-yellow/80" />
                <span className="truncate" data-testid="stash-title">{d.title}</span>
                {d.auto && (
                  <span className="shrink-0 rounded bg-gk-yellow/10 px-1.5 text-[10px] text-gk-yellow">авто</span>
                )}
                <span className="ml-auto shrink-0 pl-1 text-[10.5px] text-gk-dim">{shortAgo(stash.date)}</span>
              </Item>
            );
          })}
          {repo.stashes.length === 0 && <Empty>Нет спрятанных изменений</Empty>}
        </Section>

        <Section title="Теги" icon={Tag} count={repo.tags.length}>
          {repo.tags.filter((t) => match(t.name)).map((tag) => (
            <Item key={tag.name} title={`Тег ${tag.name}\n${tag.hash.slice(0, 10)}`} selected={tag.hash === selectedHash} onClick={() => onSelect(tag.hash)}>
              <Tag size={13} className="shrink-0 text-gk-muted" />
              <span className="truncate">{tag.name}</span>
            </Item>
          ))}
          {repo.tags.length === 0 && <Empty>Нет тегов</Empty>}
        </Section>

        <Section title="CI/CD" icon={Workflow} count={ciCount + (forge?.kind === 'gitlab' ? 1 : 0)}>
          {ciSystems.map((sys) =>
            sys.files.map((file) => (
              <Item
                key={file}
                title={`${sys.title}: ${file}\nКлик — посмотреть настройки`}
                selected={activeCiFile === file}
                onClick={() => onOpenCi?.(file)}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CI_COLORS[sys.id] ?? '#8b93a7' }} />
                <span className="truncate">{file.split('/').pop()}</span>
                <span className="ml-auto shrink-0 truncate text-[11px] text-gk-dim">{sys.title}</span>
              </Item>
            )),
          )}
          {forge?.kind === 'gitlab' && (
            <Item
              title={
                !forge.token?.configured
                  ? 'Авторизуйте репозиторий — эта же авторизация откроет пайплайны'
                  : pipelinesError
                    ? pipelinesError.message
                    : branchPipeline
                      ? `Последний пайплайн ветки ${repo.currentBranch}: #${branchPipeline.id} — ${statusInfo(branchPipeline.status).label}`
                      : 'Пайплайны GitLab'
              }
              selected={pipelinesActive}
              onClick={onOpenPipelines}
            >
              {branchPipeline && !pipelinesError ? (
                <StatusIcon status={branchPipeline.status} size={13} />
              ) : (
                <span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
                  <span className={`h-2 w-2 rounded-full ${pipelinesError ? 'bg-gk-red' : 'bg-[#fc6d26]'}`} />
                </span>
              )}
              <span className="truncate">Пайплайны</span>
              <span className={`ml-auto shrink-0 truncate text-[11px] ${forge.token?.configured ? 'text-gk-dim' : 'text-gk-blue'}`}>
                {!forge.token?.configured ? 'авторизовать' : pipelinesError ? 'ошибка' : 'GitLab'}
              </span>
            </Item>
          )}
          {ciCount === 0 && forge?.kind !== 'gitlab' && (
            <div title="Ищем .gitlab-ci.yml, .github/workflows, Jenkinsfile, bitbucket-pipelines.yml и другие">
              <Empty>Не найдено</Empty>
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, icon: Icon, count, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-muted hover:text-gk-text"
      >
        <ChevronRight size={13} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <Icon size={13} />
        <span>{title}</span>
        <span className="ml-auto rounded bg-gk-hover px-1.5 text-[10px] font-medium normal-case text-gk-muted">
          {count}
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <ScrollArea>{children}</ScrollArea>
        </div>
      </div>
    </section>
  );
}

/**
 * Свой скролл у каждого раздела: длинный список веток или тегов не выталкивает остальные разделы.
 * Тени сверху и снизу подсказывают, что список можно прокрутить.
 */
function ScrollArea({ children }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Содержимое меняется (фильтр, новые ветки) — пересчитываем тени
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [update]);

  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className="sidebar-scroll max-h-[min(280px,38vh)] overflow-y-auto overscroll-contain">
        {children}
      </div>
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-gk-sink/35 to-transparent transition-opacity duration-200 ${
          edges.top ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-gk-sink/40 to-transparent transition-opacity duration-200 ${
          edges.bottom ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}

function RemoteGroup({ remote, match, dragProps, menuProps, trackedBy, onDeleteRemote, folders, filtering, selectedHash, onSelect, onCheckout }) {
  const key = `remote:${remote.name}`;
  const open = filtering || !folders.isCollapsed(key);
  return (
    <div>
      <Item onClick={() => folders.toggle(key)}>
        {open ? <ChevronDown size={13} className="text-gk-muted" /> : <ChevronRight size={13} className="text-gk-muted" />}
        <Server size={13} className="text-gk-blue" />
        <span className="font-medium">{remote.name}</span>
        <span className="ml-auto text-[10.5px] text-gk-dim">{remote.branches.length}</span>
      </Item>
      {open && (
        <BranchTree
          branches={remote.branches.filter((b) => match(b.name))}
          folderKey={key}
          folders={folders}
          filtering={filtering}
          depth={1}
          renderBranch={(branch, label, depth) => (
            <Item
              key={branch.fullName}
              depth={depth}
              {...dragProps({ kind: 'remote', name: branch.fullName, hash: branch.hash, label: branch.fullName })}
              {...menuProps({ type: 'remote', name: branch.fullName })}
              title={`${branch.fullName} — на сервере${
                trackedBy.get(branch.fullName)
                  ? trackedBy.get(branch.fullName).hash === branch.hash
                    ? `\nЛокальная ${trackedBy.get(branch.fullName).name} на том же коммите`
                    : `\nЛокальная ${trackedBy.get(branch.fullName).name} отличается`
                  : '\nЛокальной копии нет'
              }\nДвойной клик — checkout, правый клик — действия`}
              selected={branch.hash === selectedHash}
              onClick={() => onSelect(branch.hash)}
              onDoubleClick={() => onCheckout({ remoteBranch: { name: branch.name, fullName: branch.fullName } })}
            >
              <RemoteIcon tracker={trackedBy.get(branch.fullName)} hash={branch.hash} />
              <span className="truncate">{label}</span>
              {onDeleteRemote && (
                <button
                  title={`Удалить ${branch.fullName} с сервера…`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRemote(branch.fullName);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="ml-auto hidden shrink-0 rounded p-0.5 text-gk-dim hover:bg-gk-red/15 hover:text-gk-red group-hover:flex"
                >
                  <CloudOff size={12} />
                </button>
              )}
            </Item>
          )}
        />
      )}
    </div>
  );
}

/* ---------- Группировка веток по папкам: feature/x, feature/y → папка feature ---------- */

const FOLDERS_KEY = 'sidebar.collapsedFolders';
const GROUPING_KEY = 'sidebar.groupBranches';

function readJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно — состояние просто не запомнится */
  }
}

// Свёрнутые папки и режим группировки запоминаются между запусками
function useFolders() {
  const [collapsed, setCollapsed] = useState(() => new Set(readJson(FOLDERS_KEY, [])));
  const [grouping, setGrouping] = useState(() => readJson(GROUPING_KEY, true) !== false);
  return {
    grouping,
    isCollapsed: (key) => collapsed.has(key),
    toggle: (key) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        writeJson(FOLDERS_KEY, [...next]);
        return next;
      }),
    toggleGrouping: () =>
      setGrouping((v) => {
        writeJson(GROUPING_KEY, !v);
        return !v;
      }),
  };
}

// Ветки без «/» — сверху, затем папки по алфавиту; внутри папки — остаток имени после «/»
export function groupBranches(branches) {
  const plain = [];
  const map = new Map();
  for (const b of branches) {
    const i = b.name.indexOf('/');
    if (i <= 0 || i === b.name.length - 1) plain.push(b);
    else {
      const folder = b.name.slice(0, i);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push({ branch: b, label: b.name.slice(i + 1) });
    }
  }
  const folders = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, items }));
  return { plain, folders };
}

function BranchTree({ branches, folderKey, folders, filtering, depth, isCurrent, renderBranch }) {
  if (!folders.grouping) return branches.map((b) => renderBranch(b, b.name, depth));
  const { plain, folders: groups } = groupBranches(branches);
  return (
    <>
      {plain.map((b) => renderBranch(b, b.name, depth))}
      {groups.map((g) => {
        const key = `${folderKey}/${g.name}`;
        const open = filtering || !folders.isCollapsed(key);
        const hasCurrent = isCurrent && g.items.some((x) => isCurrent(x.branch));
        return (
          <div key={key}>
            <Item depth={depth} onClick={() => folders.toggle(key)} title={`${g.name}/ — ${g.items.length}`}>
              <ChevronRight size={13} className={`shrink-0 text-gk-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
              {open ? <FolderOpen size={13} className="shrink-0 text-gk-yellow/80" /> : <Folder size={13} className="shrink-0 text-gk-yellow/80" />}
              <span className="truncate font-medium">{g.name}</span>
              {hasCurrent && !open && <span title="Здесь текущая ветка" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gk-green" />}
              <span className="ml-auto shrink-0 rounded bg-gk-fg/5 px-1.5 text-[10.5px] text-gk-dim">{g.items.length}</span>
            </Item>
            {open && g.items.map((x) => renderBranch(x.branch, x.label, depth + 1))}
          </div>
        );
      })}
    </>
  );
}

// title превращается в data-tip: длинные подсказки (сообщения stash, ветки) показывает TooltipLayer —
// с переносом строк и без обрезания краем окна
function Item({ children, current, selected, indent, depth, dropTarget, title, ...props }) {
  const state = dropTarget
    ? 'bg-gk-green/15 text-gk-text outline-dashed outline-2 -outline-offset-2 outline-gk-green'
    : selected
    ? 'bg-gk-blue/15 text-gk-text'
    : current
      ? 'bg-gk-green/10 text-gk-text'
      : 'text-gk-text/85 hover:bg-gk-hover';
  return (
    <div
      {...props}
      data-tip={title || undefined}
      style={depth !== undefined ? { paddingLeft: 24 + depth * 20 } : undefined}
      className={`group flex h-7 cursor-pointer items-center gap-2 pr-3 text-[13px] transition-colors ${
        depth !== undefined ? '' : indent ? 'pl-12' : 'pl-6'
      } ${state}`}
    >
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="py-1 pl-8 text-xs italic text-gk-dim">{children}</div>;
}

/**
 * Иконка серверной ветки: всегда облако (папка — только для группировки по «/»).
 * Цвет — есть ли у неё локальная копия: зелёная — на том же коммите, жёлтая — локальная отличается, серая — локальной нет.
 */
function RemoteIcon({ tracker, hash }) {
  const state = !tracker ? 'none' : tracker.hash === hash ? 'synced' : 'diverged';
  const cls = state === 'synced' ? 'text-gk-green/80' : state === 'diverged' ? 'text-gk-yellow/80' : 'text-gk-dim';
  return (
    <span className="relative flex w-[25px] shrink-0 items-center" data-remote-state={state}>
      <Cloud size={13} className={cls} />
      {state !== 'none' && <Link2 size={9} strokeWidth={2.6} className={`absolute left-[13px] top-[5px] ${cls}`} />}
    </span>
  );
}
