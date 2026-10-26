import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusIcon, statusInfo } from './PipelineStatus.jsx';
import { hasRefDrag, readRefDrag, startRefDrag } from '../lib/dnd.js';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Filter,
  Folder,
  FolderOpen,
  FolderTree,
  Laptop,
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
  const match = (name) => name.toLowerCase().includes(filter.toLowerCase());
  const folders = useFolders();
  // Правки, спрятанные «умным переключением» под именем ветки
  const autoStash = (msg) => /gitidea-auto: (.+)$/.exec(msg ?? '')?.[1]?.trim() ?? null;
  const waiting = new Map();
  for (const st of repo.stashes) {
    const b = autoStash(st.message);
    if (b) waiting.set(b, (waiting.get(b) ?? 0) + 1);
  }
  const remoteCount = repo.remotes.reduce((n, r) => n + r.branches.length, 0);
  const ciSystems = repo.ci ?? [];
  const ciCount = ciSystems.reduce((n, s) => n + s.files.length, 0);

  return (
    <aside className="glass flex w-full min-w-0 flex-col border-r border-gk-border bg-gk-panel">
      <div className="border-b border-gk-border p-2">
        <label className="flex items-center gap-2 rounded bg-gk-bg px-2 py-1.5 ring-1 ring-gk-border focus-within:ring-gk-blue">
          <Filter size={13} className="text-gk-dim" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter (Ctrl + Alt + F)"
            className="w-full bg-transparent text-xs outline-none placeholder:text-gk-dim"
          />
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
        <Section title="Local" icon={Laptop} count={repo.localBranches.length}>
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
                dropTarget={dropName === branch.name}
                title={`${branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}${
                  branch.gone ? ' (remote-ветка удалена)' : ''
                }\nДвойной клик — checkout`}
                current={branch.name === repo.currentBranch}
                selected={branch.hash === selectedHash}
                onClick={() => onSelect(branch.hash)}
                onDoubleClick={() => branch.name !== repo.currentBranch && onCheckout({ branch: branch.name })}
              >
                <span className="w-3.5 shrink-0">
                  {branch.name === repo.currentBranch && <Check size={13} className="text-gk-green" />}
                </span>
                <span className="truncate">{label}</span>
                <span className="ml-auto flex gap-1.5 text-[11px] text-gk-muted">
                  {waiting.has(branch.name) && (
                    <span title="Здесь ждут спрятанные правки — вернутся, когда вы переключитесь на эту ветку" className="flex items-center text-gk-yellow/90">
                      <Archive size={11} />
                    </span>
                  )}
                  {branch.behind > 0 && (
                    <span className="flex items-center">
                      {branch.behind}
                      <ArrowDown size={11} />
                    </span>
                  )}
                  {branch.ahead > 0 && (
                    <span className="flex items-center">
                      {branch.ahead}
                      <ArrowUp size={11} />
                    </span>
                  )}
                </span>
              </Item>
            )}
          />
          {repo.localBranches.length === 0 && <Empty>Нет коммитов</Empty>}
        </Section>

        <Section title="Remote" icon={Cloud} count={remoteCount}>
          {repo.remotes.map((remote) => (
            <RemoteGroup
              key={remote.name}
              remote={remote}
              match={match}
              dragProps={dragProps}
              folders={folders}
              filtering={Boolean(filter)}
              selectedHash={selectedHash}
              onSelect={onSelect}
              onCheckout={onCheckout}
            />
          ))}
          {repo.remotes.length === 0 && <Empty>Remote не настроен</Empty>}
        </Section>

        <Section title="Stashes" icon={Archive} count={repo.stashes.length}>
          {repo.stashes.filter((s) => match(s.message)).map((stash) => (
            <Item
              key={stash.hash}
              title={`${stash.id}: ${stash.message}\nКлик — посмотреть изменения, правый клик — действия`}
              selected={selectedHash === `stash:${stash.hash}`}
              onClick={() => onSelect(`stash:${stash.hash}`)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(`stash:${stash.hash}`);
                onStashMenu?.(stash, e.clientX, e.clientY);
              }}
            >
              <Archive size={13} className="shrink-0 text-gk-yellow/80" />
              {autoStash(stash.message) ? (
                <>
                  <span className="truncate">{autoStash(stash.message)}</span>
                  <span
                    title="Спрятано умным переключением — вернётся само, когда вы переключитесь на эту ветку"
                    className="ml-auto shrink-0 rounded bg-gk-yellow/10 px-1.5 text-[10px] text-gk-yellow"
                  >
                    авто
                  </span>
                </>
              ) : (
                <span className="truncate">{stash.message.replace(/^(WIP on|On) [^:]+:\s*/, '')}</span>
              )}
            </Item>
          ))}
          {repo.stashes.length === 0 && <Empty>Нет сташей</Empty>}
        </Section>

        <Section title="Tags" icon={Tag} count={repo.tags.length}>
          {repo.tags.filter((t) => match(t.name)).map((tag) => (
            <Item key={tag.name} selected={tag.hash === selectedHash} onClick={() => onSelect(tag.hash)}>
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
                  ? 'Подключите GitLab, чтобы видеть статусы пайплайнов'
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
                {!forge.token?.configured ? 'подключить' : pipelinesError ? 'ошибка' : 'GitLab'}
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
        className={`pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/35 to-transparent transition-opacity duration-200 ${
          edges.top ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-black/40 to-transparent transition-opacity duration-200 ${
          edges.bottom ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}

function RemoteGroup({ remote, match, dragProps, folders, filtering, selectedHash, onSelect, onCheckout }) {
  const key = `remote:${remote.name}`;
  const open = filtering || !folders.isCollapsed(key);
  return (
    <div>
      <Item onClick={() => folders.toggle(key)}>
        {open ? <ChevronDown size={13} className="text-gk-muted" /> : <ChevronRight size={13} className="text-gk-muted" />}
        <Folder size={13} className="text-gk-blue" />
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
              title={`${branch.fullName}\nДвойной клик — checkout (создаст локальную ветку)`}
              selected={branch.hash === selectedHash}
              onClick={() => onSelect(branch.hash)}
              onDoubleClick={() => onCheckout({ remoteBranch: { name: branch.name, fullName: branch.fullName } })}
            >
              <span className="truncate">{label}</span>
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
              <span className="ml-auto shrink-0 rounded bg-white/5 px-1.5 text-[10.5px] text-gk-dim">{g.items.length}</span>
            </Item>
            {open && g.items.map((x) => renderBranch(x.branch, x.label, depth + 1))}
          </div>
        );
      })}
    </>
  );
}

function Item({ children, current, selected, indent, depth, dropTarget, ...props }) {
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
      style={depth !== undefined ? { paddingLeft: 24 + depth * 20 } : undefined}
      className={`flex h-7 cursor-pointer items-center gap-2 pr-3 text-[13px] transition-colors ${
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
