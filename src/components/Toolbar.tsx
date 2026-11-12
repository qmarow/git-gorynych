import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CloudDownload,
  FolderGit2,
  GitBranch,
  Loader2,
  ArchiveRestore,
  Redo2,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Undo2,
} from 'lucide-react';
import BranchPicker, { type CheckoutTarget } from './BranchPicker.tsx';
import { isMod, kb } from '../lib/platform.ts';
import { t, tj } from '../i18n/index.ts';
import type { RepoData } from '../state/repoStore.ts';
import type { AccessState } from './Dialogs.tsx';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** Кнопка своего действия на панели (готовит App) */
interface ToolbarAction {
  id: string;
  name: string;
  icon: Icon;
  title?: string;
  running?: boolean;
}

interface ToolbarProps {
  repo: RepoData;
  loading?: boolean;
  busyAction?: string | null;
  access?: AccessState | null;
  pullMode: string;
  onOpenRepository?: () => void;
  onRepoMenu?: (x: number, y: number) => void;
  onRefresh?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPull: (mode?: string) => void;
  onFetch: () => void;
  onPush: () => void;
  onBranch?: () => void;
  onCheckout: (target: CheckoutTarget) => void;
  onCreateBranch: (name: string) => void;
  onLocate: (hash: string) => void;
  onStash?: () => void;
  onPop?: () => void;
  onAccessClick?: () => void;
  onSettings?: () => void;
  onSearch?: () => void;
  searchOpen?: boolean;
  customActions?: ToolbarAction[];
  onRunAction?: (id: string) => void;
  onOpenActions?: () => void;
}

export const PULL_MODES = [
  { id: 'merge', label: t('pull-fast-forward-otherwise-merge') },
  { id: 'ff-only', label: t('pull-fast-forward-only') },
  { id: 'rebase', label: t('pull-rebase') },
];

export default function Toolbar({
  repo,
  loading,
  busyAction,
  access,
  pullMode,
  onOpenRepository,
  onRepoMenu,
  onRefresh,
  onUndo,
  onRedo,
  onPull,
  onFetch,
  onPush,
  onBranch,
  onCheckout,
  onCreateBranch,
  onLocate,
  onStash,
  onPop,
  onAccessClick,
  onSettings,
  onSearch,
  searchOpen,
  customActions = [],
  onRunAction,
  onOpenActions,
}: ToolbarProps) {
  const current = repo.localBranches.find((b) => b.name === repo.currentBranch);
  const hasRemote = repo.remotes.length > 0;
  const onBranchHead = Boolean(repo.currentBranch && repo.headHash);
  const busy = Boolean(busyAction);
  const blocked = busy || Boolean(repo.operation);

  const branchLabel = repo.currentBranch
    ? repo.currentBranch
    : repo.headHash
      ? `HEAD (${repo.headHash.slice(0, 7)})`
      : '—';

  const pullTitle = !hasRemote
    ? t('no-remote')
    : !onBranchHead
      ? t('active-branch-is-required')
      : `${PULL_MODES.find((m) => m.id === pullMode)?.label}${current?.upstream ? t('from-6', current.upstream) : ''}`;
  const pushTitle = !hasRemote
    ? t('no-remote')
    : !onBranchHead
      ? t('active-branch-is-required')
      : current?.upstream
        ? t('push-to', current.upstream)
        : t('push-publish-branch-and-set');

  return (
    <div className="glass relative z-20 flex h-14 shrink-0 items-center border-b border-gk-border bg-gk-panel px-3">
      <div className="flex min-w-0 items-center gap-1">
        <Selector
          label={t('repository-2')}
          value={repo.name}
          data-tip={t('click-open-another-repository-right', repo.path)}
          icon={FolderGit2}
          onClick={onOpenRepository}
          onContextMenu={(e) => {
            if (!onRepoMenu) return;
            e.preventDefault();
            onRepoMenu(e.clientX, e.clientY);
          }}
        />
        <span className="text-gk-dim">/</span>
        <BranchSelector
          repo={repo}
          label={repo.detached ? 'detached HEAD' : t('branch-5')}
          value={branchLabel}
          disabled={busy}
          onCheckout={onCheckout}
          onCreate={onCreateBranch}
          onNewBranchDialog={onBranch!}
          onLocate={onLocate}
        />
      </div>

      <div className="flex flex-1 items-center justify-center gap-1">
        <ActionButton
          icon={Undo2}
          label={t('undo-2')}
          title={repo.history?.undo ? t('undo', repo.history.undo) : t('nothing-to-undo')}
          disabled={blocked || !repo.history?.undo}
          loading={busyAction === 'undo'}
          onClick={onUndo}
        />
        <ActionButton
          icon={Redo2}
          label={t('redo-2')}
          title={repo.history?.redo ? t('redo', repo.history.redo) : t('nothing-to-redo')}
          disabled={blocked || !repo.history?.redo}
          loading={busyAction === 'redo'}
          onClick={onRedo}
        />
        <Divider />
        <PullButton
          title={pullTitle}
          disabled={blocked || !hasRemote}
          pullDisabled={!onBranchHead}
          loading={busyAction === 'pull' || busyAction === 'fetch'}
          badge={current?.behind}
          pullMode={pullMode}
          onPull={onPull}
          onFetch={onFetch}
        />
        <ActionButton
          icon={ArrowUpFromLine}
          label="Push"
          title={pushTitle}
          badge={current?.ahead}
          disabled={blocked || !hasRemote || !onBranchHead}
          loading={busyAction === 'push'}
          onClick={onPush}
        />
        <Divider />
        <ActionButton
          icon={GitBranch}
          label={t('branch')}
          title={t('create-branch-4')}
          disabled={blocked || !repo.headHash}
          loading={busyAction === 'createBranch'}
          onClick={onBranch}
        />
        <ActionButton
          icon={Archive}
          label="Stash"
          title={repo.wipFiles.length ? t('stash-changes-2', repo.wipFiles.length) : t('no-changes')}
          disabled={blocked || repo.wipFiles.length === 0 || !repo.headHash}
          loading={busyAction === 'stash'}
          onClick={onStash}
        />
        <ActionButton
          icon={ArchiveRestore}
          label="Pop"
          title={repo.stashes[0] ? t('apply-3', repo.stashes[0].id, repo.stashes[0].message) : t('no-stashed-changes')}
          disabled={blocked || repo.stashes.length === 0}
          loading={busyAction === 'stashPop'}
          onClick={onPop}
        />
        {customActions.length > 0 && <Divider />}
        {customActions.map((a) => (
          <ActionButton
            key={a.id}
            icon={a.icon}
            label={a.name}
            title={a.title}
            className="w-auto min-w-14 max-w-[110px] px-1.5"
            disabled={blocked}
            loading={a.running}
            onClick={() => onRunAction?.(a.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenActions?.();
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-1">
        <AccessChip repo={repo} access={access} onClick={onAccessClick} />
        <IconButton
          icon={Search}
          title={kb(t('search-commits-ctrl-f'))}
          onClick={onSearch}
          iconClass={searchOpen ? 'text-gk-blue' : ''}
        />
        <IconButton icon={RefreshCw} title={t('refresh')} onClick={onRefresh} iconClass={loading ? 'animate-spin' : ''} />
        <IconButton icon={Settings} title={kb(t('settings-ctrl'))} onClick={onSettings} />
      </div>
    </div>
  );
}

/* ---------- Индикатор доступа к remote ---------- */

function AccessChip({ repo, access, onClick }: { repo: RepoData; access?: AccessState | null; onClick?: () => void }) {
  if (repo.remotes.length === 0) {
    return (
      <span title={t('repository-has-no-remote')} className="mr-1 flex items-center gap-1.5 px-2 text-xs text-gk-dim">
        {tj('has-no-remote', [<Shield size={14} />])}</span>
    );
  }

  let view: { icon: Icon; spin?: boolean; cls: string; text: ReactNode; title?: string };
  const d = access?.data;
  if (!access || (access.status === 'checking' && !d)) {
    view = { icon: Loader2, spin: true, cls: 'text-gk-muted', text: t('checking-3'), title: t('checking-access-to-remote') };
  } else if (access.error || !d?.canRead) {
    view = { icon: ShieldX, cls: 'text-gk-red', text: t('no-access'), title: (access.error ?? d?.error)?.message };
  } else if (d.canWrite === false) {
    view = { icon: ShieldAlert, cls: 'text-gk-yellow', text: t('read-only'), title: d.writeError?.message };
  } else if (d.canWrite === true) {
    view = { icon: ShieldCheck, cls: 'text-gk-green', text: d.remote, title: t('read-and-write', d.remote) };
  } else {
    view = { icon: Shield, cls: 'text-gk-blue', text: d.remote, title: t('read-write-not-checked', d.remote) };
  }
  const Icon = view.icon;
  const spinning = view.spin || access?.status === 'checking';

  return (
    <button
      onClick={onClick}
      title={t('click-for-details', view.title ?? '')}
      className={`mr-1 flex h-8 max-w-40 items-center gap-1.5 rounded px-2 text-xs transition-colors hover:bg-gk-hover ${view.cls}`}
    >
      <Icon size={14} className={`shrink-0 ${spinning ? 'animate-spin' : ''}`} />
      <span className="truncate">{view.text}</span>
    </button>
  );
}

/* ---------- Pull с выпадающим меню ---------- */

function PullButton({ title, disabled, pullDisabled, loading, badge, pullMode, onPull, onFetch }: { title: string; disabled?: boolean; pullDisabled?: boolean; loading?: boolean; badge?: ReactNode; pullMode: string; onPull: (mode?: string) => void; onFetch: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative flex">
      <ActionButton
        icon={ArrowDownToLine}
        label="Pull"
        title={title}
        badge={badge}
        disabled={disabled || pullDisabled}
        loading={loading}
        onClick={() => onPull(pullMode)}
        className="rounded-r-none"
      />
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={t('pull-and-fetch-modes')}
        className="flex w-4 items-end justify-center rounded-r pb-2 text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-35"
      >
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className="glass-strong absolute left-0 top-full z-30 mt-1 w-64 origin-top-left animate-pop-in rounded-lg border border-gk-border bg-gk-panel-2 py-1">
          <MenuItem
            icon={CloudDownload}
            onClick={() => {
              setOpen(false);
              onFetch();
            }}
          >
            Fetch All
          </MenuItem>
          <div className="my-1 h-px bg-gk-border" />
          {PULL_MODES.map((mode) => (
            <MenuItem
              key={mode.id}
              disabled={pullDisabled}
              icon={mode.id === pullMode ? Check : null}
              onClick={() => {
                setOpen(false);
                onPull(mode.id);
              }}
            >
              {mode.label}
            </MenuItem>
          ))}
          <div className="px-3 pb-1 pt-1.5 text-[10px] text-gk-dim">{t('selected-mode-becomes-default')}</div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon | null }) {
  return (
    <button
      {...props}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gk-text enabled:hover:bg-gk-hover disabled:opacity-40"
    >
      <span className="flex w-4 justify-center">{Icon && <Icon size={13} className="text-gk-green" />}</span>
      {children}
    </button>
  );
}

/* ---------- Выбор ветки ---------- */

function BranchSelector({ repo, label, value, disabled, onCheckout, onCreate, onNewBranchDialog, onLocate }: { repo: RepoData; label: ReactNode; value: ReactNode; disabled?: boolean; onCheckout: (target: CheckoutTarget) => void; onCreate: (name: string) => void; onNewBranchDialog: () => void; onLocate: (hash: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // Ctrl+B — открыть список веток откуда угодно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMod(e) && !e.shiftKey && !e.altKey && e.code === 'KeyB')) return;
      if (document.querySelector('.fixed.inset-0')) return; // открыт диалог
      e.preventDefault();
      setOpen((v) => !v);
    };
    // Пункт меню «Переключить ветку…»
    const onOpen = () => !document.querySelector('.fixed.inset-0') && setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('gitidea:branch-picker', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gitidea:branch-picker', onOpen);
    };
  }, []);

  // Во время операции (checkout и т.п.) список закрываем
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={ref} className="relative">
      <Selector
        label={label}
        value={value}
        icon={GitBranch}
        title={kb(t('switch-branch-ctrl-b'))}
        disabled={disabled}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <BranchPicker
          repo={repo}
          onClose={() => setOpen(false)}
          onCheckout={onCheckout}
          onCreate={onCreate}
          onNewBranchDialog={onNewBranchDialog}
          onLocate={onLocate}
        />
      )}
    </div>
  );
}

/* ---------- Общие кнопки ---------- */

function Selector({ label, value, icon: Icon, active, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> & { label: ReactNode; value: ReactNode; icon: Icon; active?: boolean }) {
  return (
    <button
      {...props}
      className={`group flex max-w-56 flex-col items-start rounded px-2 py-1 text-left enabled:hover:bg-gk-hover disabled:opacity-60 ${
        active ? 'bg-gk-hover' : ''
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider text-gk-dim">{label}</span>
      <span className="flex max-w-full items-center gap-1.5 text-[13px] font-medium">
        <Icon size={13} className="shrink-0 text-gk-muted" />
        <span className="truncate">{value}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-gk-dim transition-transform group-hover:text-gk-muted ${active ? 'rotate-180' : ''}`}
        />
      </span>
    </button>
  );
}

function ActionButton({ icon: Icon, label, disabled, loading, badge, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; label: ReactNode; loading?: boolean; badge?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={`group relative flex w-14 flex-col items-center gap-0.5 rounded py-1 text-gk-muted transition-colors enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-35 ${className}`}
    >
      <span className="relative">
        {loading ? (
          <Loader2 size={18} strokeWidth={1.75} className="animate-spin text-gk-green" />
        ) : (
          <Icon size={18} strokeWidth={1.75} />
        )}
        {badge ? (
          <span className="absolute -right-2.5 -top-1.5 min-w-3.5 rounded-full bg-gk-blue px-1 text-center text-[9px] font-semibold leading-3.5 text-white">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate text-[11px]">{label}</span>
    </button>
  );
}

function IconButton({ icon: Icon, title, onClick, iconClass = '' }: { icon: Icon; title: string; onClick?: () => void; iconClass?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
    >
      <Icon size={16} strokeWidth={1.75} className={iconClass} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1.5 h-7 w-px bg-gk-border" />;
}
