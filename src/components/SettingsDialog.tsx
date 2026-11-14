import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Archive, Check, Cloud, FileKey, FolderGit2, GitBranch, GitCommitHorizontal, KeyRound, LogIn, RefreshCw, Image as ImageIcon, Loader2, Palette, Pencil, Plug, RotateCcw, Server, ShieldCheck, Sparkles, Trash2, UserRound, Workflow, X, type LucideIcon } from 'lucide-react';
import { AUTO_THEME, BACKGROUNDS, THEMES, resolveThemeId, themeById, type Appearance, type Material, type Theme } from '../lib/appearance.ts';
import { GuardSettings, Switch } from './Guard.tsx';
import { CommitSettings } from './CommitForm.tsx';
import { BACKGROUND_SEC, BACKOFF_SEC, SYNC_MODES, useSyncStatus } from '../lib/syncStatus.ts';
import { kindInfo, kindLabel } from '../lib/servers.ts';
import { t as tr, tj, locale, LANGUAGES, getLanguage, setLanguage } from '../i18n/index.ts';
import BranchTemplateSetting from './issues/BranchTemplateSetting.tsx';
import type { GuardConfig } from '../lib/guardRules.ts';
import type { ApiResult } from '../platform/tauri.ts';
import type { RepoData } from '../state/repoStore.ts';
import type { LoginInfo_Serialize, RepoCi_Serialize, RepoWithCi_Serialize, ServerWithCi_Serialize } from '../../crates/gorynych-tauri/bindings/commands.ts';

/** Строка репозитория у сервера; у строки «только CI/CD» (`ciOnly`) полей входа нет, и они не читаются */
type RepoRow = RepoWithCi_Serialize & { ciOnly?: boolean };
type ServerRow = Omit<ServerWithCi_Serialize, 'repos'> & { repos: RepoRow[] };

type SettingsApi = { creds?: { servers?: () => Promise<ApiResult<ServerRow[]> | undefined> } };

const api = (typeof window !== 'undefined' ? window.api : null) as SettingsApi | null | undefined;

/** Настройки работы с ветками (App: `workflow`) */
export interface Workflow {
  checkoutWip: string;
  syncIndex: boolean;
  [extra: string]: unknown;
}

/** Автообновление (App) */
export interface SyncSettings {
  enabled: boolean;
  mode: string;
  onMode: (mode: string) => void;
  onToggle: (enabled: boolean) => void;
}

/** Действия раздела «Подключения» (App) */
export interface ServersProps {
  tick: number;
  repoOpen: boolean;
  onAuthCurrent: () => void;
  onEdit: (url: string) => void;
  onForgetLogin: (key: string, label: string) => void;
  onForgetServer: (hostname: string) => void;
}

type PickResult = { ok: boolean; canceled?: boolean; error?: { message?: string } } | null | undefined;

interface SettingsDialogProps {
  initialTab?: string;
  appearance: Appearance;
  meta: { supportsMaterial: boolean; hasImage: boolean };
  imageUrl: string | null;
  onChange: (patch: Partial<Appearance>) => void;
  onReset: () => void;
  onPickImage: () => Promise<PickResult>;
  repo: RepoData | null;
  onForgeChanged?: () => void;
  workflow: Workflow;
  onWorkflowChange: (workflow: Workflow) => void;
  sync: SyncSettings;
  guard: GuardConfig;
  onGuardChange: (cfg: GuardConfig) => void;
  repoPath?: string | null;
  servers: ServersProps | null;
  paused?: boolean;
  onClose: () => void;
}

const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'appearance', label: tr('appearance-2'), icon: Palette },
  { id: 'branches', label: tr('branches-2'), icon: GitBranch },
  { id: 'sync', label: tr('sync-2'), icon: RefreshCw },
  { id: 'commit', label: tr('commit-message-2'), icon: GitCommitHorizontal },
  { id: 'guard', label: tr('pre-commit-check'), icon: ShieldCheck },
  { id: 'integrations', label: tr('connections'), icon: Plug },
];

/**
 * Настройки: оформление (тема, фон, прозрачность) и подключения (GitLab).
 * Изменения оформления применяются сразу — без кнопки «Сохранить».
 */
export default function SettingsDialog({
  initialTab = 'appearance',
  appearance,
  meta,
  imageUrl,
  onChange,
  onReset,
  onPickImage,
  repo,
  workflow,
  onWorkflowChange,
  sync,
  guard,
  onGuardChange,
  repoPath,
  servers,
  paused = false,
  onClose,
}: SettingsDialogProps) {
  const [tab, setTab] = useState(initialTab);

  // Поверх настроек открыто окно входа — Esc закрывает только его
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !paused && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, paused]);

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[7vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-strong flex max-h-[84vh] w-[760px] max-w-[calc(100vw-2rem)] animate-pop-in overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2">
        {/* Разделы */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-gk-border bg-gk-sink/10 p-2">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{tr('settings-2')}</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                tab === t.id ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted hover:bg-gk-hover/60 hover:text-gk-text'
              }`}
            >
              <t.icon size={14} className={tab === t.id ? 'text-gk-green' : ''} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-gk-border px-4 py-3">
            <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">{TABS.find((t) => t.id === tab)?.label}</h2>
            {tab === 'appearance' && (
              <button
                onClick={onReset}
                className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text"
                title={tr('restore-default-appearance')}
              >
                {tj('default-3', [<RotateCcw size={12} />])}</button>
            )}
            <button onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text" title={tr('close-esc')}>
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {tab === 'appearance' ? (
              <AppearanceTab appearance={appearance} meta={meta} imageUrl={imageUrl} onChange={onChange} onPickImage={onPickImage} />
            ) : tab === 'branches' ? (
              <BranchesTab workflow={workflow} onChange={onWorkflowChange} />
            ) : tab === 'sync' ? (
              <SyncTab sync={sync} hasRemotes={Boolean(repo?.remotes?.length)} workflow={workflow} onWorkflowChange={onWorkflowChange} />
            ) : tab === 'commit' ? (
              <CommitSettings repoPath={repoPath} branch={repo?.currentBranch} />
            ) : tab === 'guard' ? (
              <GuardSettings cfg={guard} onChange={onGuardChange} repoPath={repoPath} />
            ) : (
              <IntegrationsTab servers={servers} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================== Оформление =================== */

function AppearanceTab({ appearance: a, meta, imageUrl, onChange, onPickImage }: Pick<SettingsDialogProps, 'meta' | 'imageUrl' | 'onChange' | 'onPickImage'> & { appearance: Appearance }) {
  const theme = themeById(resolveThemeId(a.theme));
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const pick = async () => {
    setPicking(true);
    setPickError(null);
    const res = await onPickImage();
    setPicking(false);
    if (res && !res.ok && !res.canceled) setPickError(res.error?.message ?? tr('couldnt-load-image'));
    return res;
  };

  return (
    <div className="space-y-6">
      {/* Язык интерфейса: смена перерисовывает окно на новом языке */}
      <section data-testid="language-setting">
        <SectionTitle>{tr('language')}{getLanguage() === 'ru' ? ' · Language' : ''}</SectionTitle>
        <div className="flex gap-2" role="radiogroup">
          {LANGUAGES.map((l) => {
            const on = getLanguage() === l.id;
            return (
              <button
                key={l.id}
                role="radio"
                aria-checked={on}
                data-lang={l.id}
                onClick={() => !on && setLanguage(l.id)}
                className={`flex min-w-[130px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                  on ? 'border-gk-blue/60 bg-gk-blue/10 text-gk-strong' : 'border-gk-border text-gk-text hover:bg-gk-hover'
                }`}
              >
                <span className="font-mono text-[11px] uppercase text-gk-muted">{l.id}</span>
                <span className="flex-1">{l.label}</span>
                {on && <Check size={13} className="text-gk-blue" />}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-gk-dim">{tr('window-will-redraw-in-selected')}</p>
      </section>

      {/* Тема */}
      <section>
        <SectionTitle>{tr('theme')}</SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {[AUTO_THEME, ...THEMES].map((t) => (
            <button
              key={t.id}
              data-theme-id={t.id}
              onClick={() => onChange({ theme: t.id })}
              title={t.id === AUTO_THEME.id ? tr('light-or-dark-per-windows') : (t as { hint?: string }).hint}
              className={`group rounded-lg p-1.5 text-left transition-all duration-200 ${
                a.theme === t.id ? 'bg-gk-fg/[0.06] ring-2 ring-gk-green' : 'ring-1 ring-gk-border hover:-translate-y-0.5 hover:ring-gk-fg/20'
              }`}
            >
              {t.id === AUTO_THEME.id ? (
                <div className="relative h-[72px] overflow-hidden rounded-md">
                  <ThemePreview theme={themeById(AUTO_THEME.dark)} />
                  <div className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
                    <ThemePreview theme={themeById(AUTO_THEME.light)} />
                  </div>
                </div>
              ) : (
                <ThemePreview theme={t as Theme} />
              )}
              <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
                <span className="flex-1 truncate text-[12.5px] text-gk-text">{t.name}</span>
                {a.theme === t.id && <Check size={13} className="text-gk-green" />}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Фон */}
      <section>
        <SectionTitle>{tr('background')}</SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
          {BACKGROUNDS.map((b) => {
            const disabled = b.id === 'system' && !meta.supportsMaterial;
            return (
              <button
                key={b.id}
                disabled={disabled}
                title={disabled ? tr('requires-windows-11-version-22h2') : b.hint}
                onClick={() => {
                  if (b.id === 'image' && !meta.hasImage) pick().then((res) => res?.ok && onChange({ background: 'image' }));
                  else onChange({ background: b.id });
                }}
                className={`rounded-lg p-1.5 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                  a.background === b.id ? 'bg-gk-fg/[0.06] ring-2 ring-gk-green' : 'ring-1 ring-gk-border enabled:hover:ring-gk-fg/20'
                }`}
              >
                <BackgroundPreview id={b.id} theme={theme} imageUrl={imageUrl} />
                <div className="mt-1.5 truncate px-0.5 text-[12px] text-gk-text">{b.name}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-gk-dim">{BACKGROUNDS.find((b) => b.id === a.background)?.hint}</p>

        {a.background === 'image' && (
          <div className="mt-3 animate-fade-in space-y-3 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={pick}
                disabled={picking}
                className="flex items-center gap-1.5 rounded-md bg-gk-hover px-3 py-1.5 text-[12.5px] text-gk-text hover:bg-gk-fg/10 disabled:opacity-50"
              >
                {picking ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                {meta.hasImage ? tr('choose-another-image') : tr('choose-image')}
              </button>
              {pickError && <span className="text-[12px] text-gk-red">{pickError}</span>}
            </div>
            <Slider label={tr('image-blur')} value={a.imageBlur} min={0} max={40} unit="px" onChange={(v) => onChange({ imageBlur: v })} />
            <Slider label={tr('dimming')} value={a.imageDim} min={0} max={90} unit="%" onChange={(v) => onChange({ imageDim: v })} />
          </div>
        )}

        {a.background === 'system' && (
          <div className="mt-3 animate-fade-in rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
            <div className="mb-2 text-[12px] text-gk-muted">{tr('window-material')}</div>
            <div className="flex gap-2">
              {[
                { id: 'acrylic', name: 'Acrylic', hint: tr('strong-blur-desktop-is-barely') },
                { id: 'mica', name: 'Mica', hint: tr('light-tint-of-wallpaper-calmer') },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => onChange({ material: m.id as Material })}
                  title={m.hint}
                  className={`flex-1 rounded-md px-3 py-2 text-left text-[12.5px] transition-colors ${
                    a.material === m.id ? 'bg-gk-green/15 text-gk-green ring-1 ring-gk-green/40' : 'bg-gk-hover text-gk-text hover:bg-gk-fg/10'
                  }`}
                >
                  <div className="font-medium">{m.name}</div>
                  <div className="mt-0.5 text-[11px] text-gk-dim">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Прозрачность */}
      <section>
        <SectionTitle>{tr('transparency-and-glass')}</SectionTitle>
        <div className="space-y-3 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
          <Slider
            label={tr('panel-transparency')}
            value={a.transparency}
            min={0}
            max={100}
            unit="%"
            hint={a.transparency === 0 ? tr('opaque-panels') : a.transparency >= 80 ? tr('almost-pure-glass') : null}
            onChange={(v) => onChange({ transparency: v })}
          />
          <Slider label={tr('blur-under-glass')} value={a.blur} min={0} max={40} unit="px" onChange={(v) => onChange({ blur: v })} />
          <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-[12.5px] text-gk-text">
            {tj('background-animation-smooth-movement-of', [<Toggle checked={a.motion} onChange={(v) => onChange({ motion: v })} />, <Sparkles size={13} className="text-gk-muted" />, <span className="text-[11px] text-gk-dim" />])}
          </label>
        </div>
      </section>
    </div>
  );
}

function BranchesTab({ workflow, onChange }: { workflow: Workflow; onChange: (workflow: Workflow) => void }) {
  return (
    <div className="space-y-4 text-[12.5px]">
      <div>
        <div className="font-medium text-gk-text">{tr('uncommitted-changes-when-switching')}</div>
        <div className="mt-0.5 text-gk-muted">{tr('what-to-do-with-edits')}</div>
        <div className="mt-2 space-y-1.5" role="radiogroup" data-testid="checkout-wip-setting">
          {[
            ['ask', tr('ask-every-time'), tr('window-with-choice-stash-move')],
            ['stash', tr('stash-automatically-smart-switching'), tr('edits-are-stashed-under-current')],
            ['merge', tr('move-to-new-branch'), tr('like-regular-git-switch-edits')],
          ].map(([id, title, hint]) => (
            <label key={id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-gk-hover">
              <input
                type="radio"
                name="checkoutWip"
                value={id}
                checked={workflow.checkoutWip === id}
                onChange={() => onChange({ ...workflow, checkoutWip: id })}
                className="mt-0.5 accent-gk-blue"
              />
              <span>
                <span className="block text-gk-text">{title}</span>
                <span className="block text-[11.5px] leading-snug text-gk-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="ml-6 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3 text-gk-muted">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-gk-text">
          {tj('how-stash-works', [<Archive size={13} className="text-gk-yellow" />])}</div>
        <ol className="list-decimal space-y-0.5 pl-4 leading-relaxed">
          <li>{tr('youre-working-in-feature-and')}</li>
          <li>{tr('feature-edits-are-stashed-stash')}</li>
          <li>{tr('back-on-feature-edits-are')}</li>
        </ol>
        <div className="mt-2 text-[11.5px] text-gk-dim">
          {tr('works-for-all-switches-from')}</div>
      </div>
      <BranchTemplateSetting />

    </div>
  );
}

function SyncTab({ sync, hasRemotes, workflow, onWorkflowChange }: { sync: SyncSettings; hasRemotes: boolean; workflow: Workflow; onWorkflowChange: (workflow: Workflow) => void }) {
  const st = useSyncStatus();
  if (!sync) return null;
  const via: Record<string, string> = { api: tr('gitlab-api-with-etag-not'), 'ls-remote': tr('git-ls-remote-no-token') };
  return (
    <div className="space-y-5 text-[12.5px]">
      <label className="flex cursor-pointer items-start gap-3">
        {tj('auto-update-graph-and-branches', [<Switch checked={sync.enabled} onChange={sync.onToggle} />, <span />, <span className="block font-medium text-gk-text" />, <span className="mt-0.5 block leading-relaxed text-gk-muted" />])}
      </label>

      {workflow && (
        <label className={`flex cursor-pointer items-start gap-3 ${sync.enabled ? '' : 'pointer-events-none opacity-40'}`}>
          {tj('sync-index-with-edits-from', [<Switch checked={workflow.syncIndex} onChange={(v) => onWorkflowChange({ ...workflow, syncIndex: v })} />, <span />, <span className="block font-medium text-gk-text" />, <span className="mt-0.5 block leading-relaxed text-gk-muted" />])}
        </label>
      )}

      <section className={sync.enabled ? '' : 'pointer-events-none opacity-40'}>
        <SectionTitle>{tr('how-often-to-check-server')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {SYNC_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => sync.onMode(m.id)}
              className={`rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                sync.mode === m.id ? 'bg-gk-green/10 ring-gk-green/60' : 'ring-gk-border hover:bg-gk-fg/[0.03] hover:ring-gk-fg/20'
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium text-gk-text">
                {m.label}
                {sync.mode === m.id && <Check size={12} className="text-gk-green" />}
              </span>
              <span className="block text-[11.5px] text-gk-dim">{m.hint}</span>
            </button>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-4 leading-relaxed text-gk-muted">
          <li>{tj('only-open-tab-is-checked-and', [BACKGROUND_SEC])}</li>
          <li>
            {tj('first-we-ask-server-only', [<code className="font-mono text-gk-text" />])}</li>
          <li>{tr('while-you-commit-checkout-rebase-or')}</li>
          <li>
            {tj('no-connection-or-server-asks', [BACKOFF_SEC.map((x) => (x < 60 ? tr('s-2', x) : tr('min', x / 60))).join(' → ')])}</li>
          <li>{tr('for-gitlab-with-saved-token')}</li>
        </ul>
      </section>

      {sync.enabled && hasRemotes && (
        <section className="rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3 text-[12px]">
          <div className="mb-1 font-medium text-gk-text">{tr('now')}</div>
          {st.error ? (
            <div className="text-gk-yellow">
              {tj('server-is-unavailable-errors-in', [st.error, st.failures])}</div>
          ) : st.at ? (
            <div className="text-gk-muted">
              {tj('last-check-at-method', [new Date(st.at).toLocaleTimeString(locale()), st.ms != null ? tr('ms', st.ms) : '', via[st.via as string] ?? st.via ?? '—'])}</div>
          ) : (
            <div className="text-gk-dim">{tr('not-checked-yet-first-check')}</div>
          )}
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children?: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{children}</h3>;
}

function Slider({ label, value, min, max, unit, hint, onChange }: { label: string; value: number; min: number; max: number; unit: string; hint?: string | null; onChange: (value: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center text-[12.5px]">
        <span className="flex-1 text-gk-text">{label}</span>
        {hint && <span className="mr-2 text-[11px] text-gk-dim">{hint}</span>}
        <span className="w-12 text-right font-mono text-[11.5px] text-gk-muted">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gk-range w-full"
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  // Кнопка центрирует содержимое, поэтому бегунок позиционируем явно от левого края
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={`relative block h-[18px] w-8 shrink-0 rounded-full p-0 transition-colors duration-200 ${
        checked ? 'bg-gk-green' : 'bg-gk-fg/15'
      }`}
    >
      <span
        className="absolute left-0 top-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: `translateX(${checked ? 16 : 2}px)` }}
      />
    </button>
  );
}

/* Мини-превью темы: заголовок, боковая панель, граф с тремя коммитами */
function ThemePreview({ theme: t }: { theme: Theme }) {
  const rgb = (c: readonly number[], a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
  return (
    <div className="relative h-[72px] overflow-hidden rounded-md" style={{ background: t.base }}>
      <div
        className="absolute -left-4 -top-6 h-16 w-16 rounded-full blur-xl"
        style={{ background: t.glow[0], opacity: 0.35 }}
      />
      <div
        className="absolute -bottom-8 -right-4 h-20 w-20 rounded-full blur-xl"
        style={{ background: t.glow[1], opacity: 0.35 }}
      />
      <div className="absolute inset-x-0 top-0 h-2.5" style={{ background: rgb(t.titlebar, 0.8) }} />
      <div className="absolute bottom-0 left-0 top-2.5 w-7" style={{ background: rgb(t.panel, 0.75) }}>
        <div className="mx-1.5 mt-2 h-1 rounded" style={{ background: t.muted, opacity: 0.6 }} />
        <div className="mx-1.5 mt-1 h-1 rounded" style={{ background: t.green, opacity: 0.8 }} />
        <div className="mx-1.5 mt-1 h-1 rounded" style={{ background: t.muted, opacity: 0.4 }} />
      </div>
      <div className="absolute bottom-0 right-0 top-2.5 w-8" style={{ background: rgb(t.panel, 0.75) }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="absolute flex items-center gap-1.5" style={{ left: 38 + (i === 1 ? 8 : 0), top: 18 + i * 17 }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: [t.glow[0], t.blue, t.glow[2]][i] }} />
          <span className="h-1 rounded" style={{ width: 34 - i * 6, background: t.text, opacity: 0.55 }} />
        </div>
      ))}
    </div>
  );
}

function BackgroundPreview({ id, theme: t, imageUrl }: { id: string; theme: Theme; imageUrl: string | null }) {
  const base = { backgroundColor: t.base };
  const glowA = `${t.glow[0]}88`;
  const glowB = `${t.glow[1]}88`;
  const glowC = `${t.glow[2]}66`;
  const line = t.scheme === 'light' ? 'rgb(16 24 40 / 0.09)' : 'rgb(255 255 255 / 0.07)';
  let style: CSSProperties = base;
  let inner: ReactNode = null;
  if (id === 'glow') {
    inner = (
      <>
        <div className="absolute -left-3 -top-5 h-12 w-12 rounded-full blur-lg" style={{ background: glowA }} />
        <div className="absolute -bottom-6 -right-3 h-14 w-14 rounded-full blur-lg" style={{ background: glowB }} />
      </>
    );
  } else if (id === 'aurora') {
    style = {
      ...base,
      backgroundImage: `linear-gradient(115deg, transparent 15%, ${glowA} 35%, transparent 50%), linear-gradient(100deg, transparent 40%, ${glowB} 58%, transparent 72%), linear-gradient(130deg, transparent 62%, ${glowC} 78%, transparent 92%)`,
      filter: 'saturate(1.2)',
    };
  } else if (id === 'grid') {
    style = {
      ...base,
      backgroundImage: `radial-gradient(ellipse at 50% -20%, ${glowA}, transparent 60%), linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
      backgroundSize: '100% 100%, 9px 9px, 9px 9px',
    };
  } else if (id === 'gradient') {
    style = {
      ...base,
      backgroundImage: `radial-gradient(ellipse at 0% 0%, ${t.glow[0]}33, transparent 60%), radial-gradient(ellipse at 100% 100%, ${t.glow[1]}40, transparent 65%)`,
    };
  } else if (id === 'image') {
    style = imageUrl ? { ...base, backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : base;
    if (!imageUrl) {
      inner = (
        <div className="absolute inset-0 flex items-center justify-center text-gk-dim">
          <ImageIcon size={18} />
        </div>
      );
    }
  } else if (id === 'system') {
    style = {
      backgroundImage:
        'linear-gradient(135deg, rgb(120 160 220 / 0.35), rgb(200 140 200 / 0.25)), repeating-linear-gradient(45deg, rgb(255 255 255 / 0.05) 0 6px, transparent 6px 12px)',
      backdropFilter: 'blur(4px)',
    };
  }
  return (
    <div className="relative h-[54px] overflow-hidden rounded-md ring-1 ring-gk-sink/30" style={style}>
      {inner}
    </div>
  );
}

/* =================== Подключения =================== */

function IntegrationsTab({ servers }: { servers: ServersProps | null }) {
  // Одна авторизация на репозиторий — для Pull, Push и пайплайнов CI/CD; отдельного входа для CI/CD нет
  return <div className="space-y-6">{servers ? <ServersSection {...servers} /> : <p className="text-[12px] text-gk-dim">{tr('sign-in-unavailable')}</p>}</div>;
}

const SCOPE_SHORT: Record<string, string> = { api: tr('view-and-actions'), read_api: tr('view-only-2') };

/** Работают ли пайплайны CI/CD от авторизации репозитория (GitLab) */
function CiText({ ci, method }: { ci: RepoCi_Serialize | null; method?: string }) {
  if (!ci) return null;
  const who = ci.user?.username ? ` · @${ci.user.username}` : '';
  const scope = ci.scopes ? ci.scopes.map((x) => SCOPE_SHORT[x]).filter(Boolean)[0] : null;
  let text: string;
  let tone = 'text-gk-muted';
  let state = 'ok';
  if (ci.source === 'legacy') {
    text = tr('pipelines-token-from-previous-version', who);
    tone = 'text-gk-yellow';
    state = 'legacy';
  } else if (ci.state === 'bad') {
    text = tr('pipelines-this-sign-in-doesnt');
    tone = 'text-gk-yellow';
    state = 'bad';
  } else if (ci.state === 'none' || !ci.source) {
    text = ci.legacy
      ? tr('pipelines-still-using-token-from')
      : tr('pipelines-doesnt-work-for-api', method === 'ssh' ? tr('ssh-key') : tr('password-3'));
    tone = 'text-gk-yellow';
    state = 'none';
  } else {
    text = tr('pipelines-same-sign-in', ci.viaApiToken ? tr('with-api-token') : '', who, scope ? ` · ${scope}` : '', ci.state ? '' : tr('will-be-checked-on-first'));
  }
  return (
    <span data-testid="ci-line" data-state={state} className={`flex min-w-0 items-center gap-1 text-[11px] ${tone}`} data-tip={ci.reason ?? undefined}>
      <Workflow size={11} className="shrink-0 opacity-80" />
      <span className="truncate">{text}</span>
    </span>
  );
}

const LOGIN_ICONS: Record<string, LucideIcon> = { password: UserRound, token: KeyRound, ssh: FileKey };
const LOGIN_NAMES: Record<string, string> = { password: tr('username-and-password-2'), token: tr('token-2'), ssh: tr('ssh-key') };

function LoginText({ login }: { login: Pick<LoginInfo_Serialize, 'method' | 'username' | 'keyPath' | 'readable'> }) {
  const Icon = LOGIN_ICONS[login.method] ?? KeyRound;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] text-gk-muted">
      <Icon size={11} className={`shrink-0 ${login.readable === false ? 'text-gk-yellow' : 'text-gk-dim'}`} />
      <span className="truncate">
        {LOGIN_NAMES[login.method]}
        {login.username && login.method !== 'ssh' ? ` · ${login.username}` : ''}
        {login.keyPath ? ` · ${login.keyPath.split(/[\\/]/).pop()}` : ''}
      </span>
      {login.readable === false && <span className="shrink-0 text-gk-yellow">{tr('enter-it-again')}</span>}
    </span>
  );
}

/**
 * Git-серверы и привязанные к ним репозитории: у каждого репозитория свой вход (логин, токен или SSH-ключ).
 * «Общий вход» — сохранённый раньше на весь сервер; действует для репозиториев без своего.
 */
function ServersSection({ tick, repoOpen, onAuthCurrent, onEdit, onForgetLogin, onForgetServer }: ServersProps) {
  const [list, setList] = useState<ServerRow[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // ключ записи или «server:<host>», который подтверждаем удалить

  useEffect(() => {
    let alive = true;
    api?.creds?.servers?.().then((res) => alive && setList(res?.ok ? res.data : []));
    return () => {
      alive = false;
    };
  }, [tick]);

  const confirmBox = (_id: string, onYes: () => void) => (
    <span className="flex shrink-0 items-center gap-1.5 text-[11.5px]">
      {tj('forget-2', [<span className="text-gk-muted" />, <button
        onClick={() => {
          setConfirm(null);
          onYes();
        }}
        data-testid="login-forget-confirm"
        className="rounded bg-gk-red px-2 py-0.5 font-semibold text-white"
      >
        {tr('yes-2')}</button>, <button onClick={() => setConfirm(null)} className="rounded px-1.5 py-0.5 text-gk-muted hover:bg-gk-hover">
        {tr('no-2')}</button>])}
    </span>
  );
  const iconBtn = (props: ButtonHTMLAttributes<HTMLButtonElement> & { [data: `data-${string}`]: string }, Icon: LucideIcon, hover = 'hover:text-gk-text') => (
    <button {...props} className={`rounded p-1 text-gk-dim hover:bg-gk-hover ${hover}`}>
      <Icon size={13} />
    </button>
  );

  return (
    <section className="space-y-2" data-testid="servers-section">
      <div className="flex items-center gap-2">
        {tj('repository-sign-ins', [<Server size={14} className="text-gk-muted" />, <span className="flex-1 text-[13px] font-semibold text-gk-strong" />, repoOpen && (
          <button
            onClick={onAuthCurrent}
            data-testid="repo-auth"
            className="flex items-center gap-1.5 rounded-md bg-gk-blue px-2.5 py-1 text-[12px] font-semibold text-white hover:brightness-110"
          >
            {tj('sign-in-to-open-repository', [<LogIn size={12} />])}</button>
        )])}
      </div>
      <p className="text-[12px] leading-relaxed text-gk-muted">
        {tr('sign-in-is-saved-for')}</p>
      {list === null ? (
        <div className="flex items-center gap-2 text-[12px] text-gk-dim">
          {tj('loading-2', [<Loader2 size={12} className="animate-spin" />])}</div>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gk-border px-3 py-2.5 text-[12px] text-gk-dim">
          {tr('none-yet-sign-in-is')}</p>
      ) : (
        <div className="space-y-2">
          {list.map((srv) => (
            <div key={srv.hostname} className="overflow-hidden rounded-lg border border-gk-border" data-testid="server-row">
              <div className="group flex items-center gap-2.5 bg-gk-fg/[0.03] px-3 py-1.5">
                {srv.cloud ? <Cloud size={14} className="shrink-0" style={{ color: kindInfo(srv.kind)?.color }} /> : <Server size={14} className="shrink-0" style={{ color: kindInfo(srv.kind)?.color ?? undefined }} />}
                <span className="truncate font-mono text-[12.5px] text-gk-strong">{srv.hostname}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim">{srv.kind ? kindLabel(srv.kind, srv.cloud) : tr('type-not-selected')}</span>
                {confirm === `server:${srv.hostname}`
                  ? confirmBox(srv.hostname, () => onForgetServer(srv.hostname))
                  : iconBtn(
                      {
                        onClick: () => setConfirm(`server:${srv.hostname}`),
                        'data-tip': tr('forget-server-sign-ins-of'),
                        'aria-label': tr('forget-3', srv.hostname),
                        'data-testid': 'server-forget',
                      },
                      Trash2,
                      'hover:text-gk-red',
                    )}
              </div>
              <ul className="divide-y divide-gk-border/70">
                {srv.repos.map((r) => (
                  <li key={r.key} className="group flex items-center gap-2.5 py-1.5 pl-8 pr-3" data-testid="repo-row">
                    <FolderGit2 size={13} className="shrink-0 text-gk-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-[12.5px] text-gk-text" data-tip={r.url}>
                          {r.path}
                        </span>
                        <span className="shrink-0 rounded bg-gk-hover px-1 text-[9.5px] uppercase text-gk-dim">
                          {r.ciOnly ? 'CI/CD' : r.protocol === 'ssh' ? 'SSH' : 'HTTPS'}
                        </span>
                      </div>
                      {!r.ciOnly && <LoginText login={r} />}
                      <CiText ci={r.ci} method={r.method} />
                    </div>
                    {confirm === r.key ? (
                      confirmBox(r.key, () => onForgetLogin(r.key, r.path))
                    ) : (
                      <span className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
                        {r.url &&
                          iconBtn(
                            { onClick: () => onEdit(r.url!), 'data-tip': r.ciOnly ? tr('sign-in-to-repository') : tr('edit-sign-in-pull-push'), 'aria-label': tr('edit-3', r.path), 'data-testid': 'repo-edit' },
                            Pencil,
                          )}
                        {iconBtn({ onClick: () => setConfirm(r.key), 'data-tip': tr('forget-this-repositorys-sign-in'), 'aria-label': tr('forget-3', r.path), 'data-testid': 'repo-forget' }, Trash2, 'hover:text-gk-red')}
                      </span>
                    )}
                  </li>
                ))}
                {(srv.sharedCi ?? []).map((l) => (
                  <li key={l.key} className="group flex items-center gap-2.5 py-1.5 pl-8 pr-3" data-testid="shared-ci-row">
                    <Workflow size={13} className="shrink-0 text-gk-dim" />
                    <div className="min-w-0 flex-1">
                      {tj('applies-to-repositories-whose-sign', [<div className="text-[12.5px] text-gk-muted">{tr('pipeline-token-for-whole-server')}</div>, <span className="text-[11px] text-gk-dim" />, l.user?.username ? `@${l.user.username}` : tr('token-2')])}
                    </div>
                    {confirm === l.key
                      ? confirmBox(l.key, () => onForgetLogin(l.key, tr('ci-cd-of-all-repositories', srv.hostname)))
                      : iconBtn({ onClick: () => setConfirm(l.key), 'data-tip': tr('forget-shared-ci-cd-token'), 'aria-label': tr('forget-shared-ci-cd-token-2') }, Trash2, 'hover:text-gk-red')}
                  </li>
                ))}
                {srv.shared.map((l) => (
                  <li key={l.key} className="group flex items-center gap-2.5 py-1.5 pl-8 pr-3" data-testid="shared-row">
                    <Server size={13} className="shrink-0 text-gk-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-gk-muted">{tr('shared-sign-in-for-all-repositories')}</div>
                      <LoginText login={l} />
                    </div>
                    {confirm === l.key
                      ? confirmBox(l.key, () => onForgetLogin(l.key, tr('all-repositories-on', srv.hostname)))
                      : iconBtn({ onClick: () => setConfirm(l.key), 'data-tip': tr('forget-shared-sign-in-saved'), 'aria-label': tr('forget-shared-sign-in') }, Trash2, 'hover:text-gk-red')}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
