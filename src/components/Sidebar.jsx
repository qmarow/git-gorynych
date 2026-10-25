import { useState } from 'react';
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
  Laptop,
  Tag,
} from 'lucide-react';

export default function Sidebar({ repo, selectedHash, onSelect, onCheckout }) {
  const [filter, setFilter] = useState('');
  const match = (name) => name.toLowerCase().includes(filter.toLowerCase());
  const remoteCount = repo.remotes.reduce((n, r) => n + r.branches.length, 0);

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
        </label>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <Section title="Local" icon={Laptop} count={repo.localBranches.length}>
          {repo.localBranches.filter((b) => match(b.name)).map((branch) => (
            <Item
              key={branch.name}
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
              <span className="truncate">{branch.name}</span>
              <span className="ml-auto flex gap-1.5 text-[11px] text-gk-muted">
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
          ))}
          {repo.localBranches.length === 0 && <Empty>Нет коммитов</Empty>}
        </Section>

        <Section title="Remote" icon={Cloud} count={remoteCount}>
          {repo.remotes.map((remote) => (
            <RemoteGroup
              key={remote.name}
              remote={remote}
              match={match}
              selectedHash={selectedHash}
              onSelect={onSelect}
              onCheckout={onCheckout}
            />
          ))}
          {repo.remotes.length === 0 && <Empty>Remote не настроен</Empty>}
        </Section>

        <Section title="Stashes" icon={Archive} count={repo.stashes.length}>
          {repo.stashes.filter((s) => match(s.message)).map((stash) => (
            <Item key={stash.id} title={`${stash.id}: ${stash.message}`}>
              <Archive size={13} className="shrink-0 text-gk-muted" />
              <span className="truncate">{stash.message}</span>
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
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

function RemoteGroup({ remote, match, selectedHash, onSelect, onCheckout }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Item onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} className="text-gk-muted" /> : <ChevronRight size={13} className="text-gk-muted" />}
        <Folder size={13} className="text-gk-blue" />
        <span className="font-medium">{remote.name}</span>
      </Item>
      {open &&
        remote.branches.filter((b) => match(b.name)).map((branch) => (
          <Item
            key={branch.fullName}
            indent
            title={`${branch.fullName}\nДвойной клик — checkout (создаст локальную ветку)`}
            selected={branch.hash === selectedHash}
            onClick={() => onSelect(branch.hash)}
            onDoubleClick={() => onCheckout({ remoteBranch: { name: branch.name, fullName: branch.fullName } })}
          >
            <span className="truncate">{branch.name}</span>
          </Item>
        ))}
    </div>
  );
}

function Item({ children, current, selected, indent, ...props }) {
  const state = selected
    ? 'bg-gk-blue/15 text-gk-text'
    : current
      ? 'bg-gk-green/10 text-gk-text'
      : 'text-gk-text/85 hover:bg-gk-hover';
  return (
    <div
      {...props}
      className={`flex h-7 cursor-pointer items-center gap-2 pr-3 text-[13px] transition-colors ${
        indent ? 'pl-12' : 'pl-6'
      } ${state}`}
    >
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="py-1 pl-8 text-xs italic text-gk-dim">{children}</div>;
}
