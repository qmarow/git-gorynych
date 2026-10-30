import { useEffect, useState } from 'react';
import { Archive, Check, Cloud, FileKey, FolderGit2, GitBranch, GitCommitHorizontal, KeyRound, LogIn, RefreshCw, Image as ImageIcon, Loader2, Palette, Pencil, Plug, RotateCcw, Server, ShieldCheck, Sparkles, Trash2, UserRound, Workflow, X } from 'lucide-react';
import { AUTO_THEME, BACKGROUNDS, THEMES, resolveThemeId, themeById } from '../lib/appearance.js';
import { GuardSettings, Switch } from './Guard.jsx';
import { CommitSettings } from './CommitForm.jsx';
import { BACKGROUND_SEC, BACKOFF_SEC, SYNC_MODES, useSyncStatus } from '../lib/syncStatus.js';
import { kindInfo, kindLabel } from '../lib/servers.js';

const api = typeof window !== 'undefined' ? window.api : null;

const TABS = [
  { id: 'appearance', label: 'Оформление', icon: Palette },
  { id: 'branches', label: 'Ветки', icon: GitBranch },
  { id: 'sync', label: 'Синхронизация', icon: RefreshCw },
  { id: 'commit', label: 'Сообщение коммита', icon: GitCommitHorizontal },
  { id: 'guard', label: 'Проверка перед коммитом', icon: ShieldCheck },
  { id: 'integrations', label: 'Подключения', icon: Plug },
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
  onForgeChanged,
  workflow,
  onWorkflowChange,
  sync,
  guard,
  onGuardChange,
  repoPath,
  servers,
  paused = false,
  onClose,
}) {
  const [tab, setTab] = useState(initialTab);

  // Поверх настроек открыто окно входа — Esc закрывает только его
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !paused && onClose();
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
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">Настройки</div>
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
                title="Вернуть оформление по умолчанию"
              >
                <RotateCcw size={12} /> По умолчанию
              </button>
            )}
            <button onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text" title="Закрыть (Esc)">
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

function AppearanceTab({ appearance: a, meta, imageUrl, onChange, onPickImage }) {
  const theme = themeById(resolveThemeId(a.theme));
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState(null);

  const pick = async () => {
    setPicking(true);
    setPickError(null);
    const res = await onPickImage();
    setPicking(false);
    if (res && !res.ok && !res.canceled) setPickError(res.error?.message ?? 'Не удалось загрузить картинку');
    return res;
  };

  return (
    <div className="space-y-6">
      {/* Тема */}
      <section>
        <SectionTitle>Тема</SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {[AUTO_THEME, ...THEMES].map((t) => (
            <button
              key={t.id}
              data-theme-id={t.id}
              onClick={() => onChange({ theme: t.id })}
              title={t.id === AUTO_THEME.id ? 'Светлая или тёмная — как в настройках Windows/macOS, переключается сама' : t.hint}
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
                <ThemePreview theme={t} />
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
        <SectionTitle>Фон</SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
          {BACKGROUNDS.map((b) => {
            const disabled = b.id === 'system' && !meta.supportsMaterial;
            return (
              <button
                key={b.id}
                disabled={disabled}
                title={disabled ? 'Нужна Windows 11 (версия 22H2 или новее)' : b.hint}
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
                {meta.hasImage ? 'Выбрать другую картинку…' : 'Выбрать картинку…'}
              </button>
              {pickError && <span className="text-[12px] text-gk-red">{pickError}</span>}
            </div>
            <Slider label="Размытие картинки" value={a.imageBlur} min={0} max={40} unit="px" onChange={(v) => onChange({ imageBlur: v })} />
            <Slider label="Затемнение" value={a.imageDim} min={0} max={90} unit="%" onChange={(v) => onChange({ imageDim: v })} />
          </div>
        )}

        {a.background === 'system' && (
          <div className="mt-3 animate-fade-in rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
            <div className="mb-2 text-[12px] text-gk-muted">Материал окна</div>
            <div className="flex gap-2">
              {[
                { id: 'acrylic', name: 'Acrylic', hint: 'Сильное размытие — рабочий стол едва угадывается' },
                { id: 'mica', name: 'Mica', hint: 'Лёгкий тон обоев, спокойнее и экономнее' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => onChange({ material: m.id })}
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
        <SectionTitle>Прозрачность и стекло</SectionTitle>
        <div className="space-y-3 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
          <Slider
            label="Прозрачность панелей"
            value={a.transparency}
            min={0}
            max={100}
            unit="%"
            hint={a.transparency === 0 ? 'панели непрозрачные' : a.transparency >= 80 ? 'почти одно стекло' : null}
            onChange={(v) => onChange({ transparency: v })}
          />
          <Slider label="Размытие под стеклом" value={a.blur} min={0} max={40} unit="px" onChange={(v) => onChange({ blur: v })} />
          <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-[12.5px] text-gk-text">
            <Toggle checked={a.motion} onChange={(v) => onChange({ motion: v })} />
            <Sparkles size={13} className="text-gk-muted" />
            Анимация фона
            <span className="text-[11px] text-gk-dim">— плавное движение пятен и сияния</span>
          </label>
        </div>
      </section>
    </div>
  );
}

function BranchesTab({ workflow, onChange }) {
  return (
    <div className="space-y-4 text-[12.5px]">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch checked={workflow.smartSwitch} onChange={(v) => onChange({ ...workflow, smartSwitch: v })} />
        <span>
          <span className="block font-medium text-gk-text">Умное переключение веток</span>
          <span className="mt-0.5 block leading-relaxed text-gk-muted">
            При переключении на другую ветку незакоммиченные изменения сами прячутся в stash с именем текущей ветки, а когда вы вернётесь
            на неё — так же сами достаются обратно. Больше не нужно помнить, какой stash@{'{3}'} к чему относился.
          </span>
        </span>
      </label>
      <div className="ml-11 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3 text-gk-muted">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-gk-text">
          <Archive size={13} className="text-gk-yellow" /> Как это выглядит
        </div>
        <ol className="list-decimal space-y-0.5 pl-4 leading-relaxed">
          <li>Работаете в feature-A, есть правки. Двойной клик по hotfix.</li>
          <li>Правки feature-A спрятаны (stash «feature-A (авто)»), вы на чистой hotfix.</li>
          <li>Вернулись на feature-A — правки на месте, в том числе staged.</li>
        </ol>
        <div className="mt-2 text-[11.5px] text-gk-dim">
          Работает для всех переключений из программы. Если при возврате будет конфликт, stash не удаляется. Ctrl+Z переключает обратно вместе с
          правками.
        </div>
      </div>
      <p className="text-[11.5px] text-gk-dim">
        Когда выключено — как в обычном Git: правки переезжают вместе с вами на новую ветку, а если мешают переключению, Git сообщит об ошибке.
      </p>
    </div>
  );
}

function SyncTab({ sync, hasRemotes, workflow, onWorkflowChange }) {
  const st = useSyncStatus();
  if (!sync) return null;
  const via = { api: 'GitLab API с ETag — ответ «не изменилось» почти ничего не стоит серверу', 'ls-remote': 'git ls-remote — без токена, работает с любым сервером' };
  return (
    <div className="space-y-5 text-[12.5px]">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch checked={sync.enabled} onChange={sync.onToggle} />
        <span>
          <span className="block font-medium text-gk-text">Автообновление</span>
          <span className="mt-0.5 block leading-relaxed text-gk-muted">
            Граф и ветки обновляются сами: при изменениях в папке (в том числе fetch/pull из терминала) и при новых коммитах на сервере. То же
            переключает «авто» в строке состояния.
          </span>
        </span>
      </label>

      {workflow && (
        <label className={`flex cursor-pointer items-start gap-3 ${sync.enabled ? '' : 'pointer-events-none opacity-40'}`}>
          <Switch checked={workflow.syncIndex} onChange={(v) => onWorkflowChange({ ...workflow, syncIndex: v })} />
          <span>
            <span className="block font-medium text-gk-text">Синхронизировать индекс с правками из других программ</span>
            <span className="mt-0.5 block leading-relaxed text-gk-muted">
              Откатили застейдженный файл в WebStorm или VS Code к последнему коммиту — изменение исчезнет целиком, без «призрака» в
              Staged и устаревших предупреждений проверки перед коммитом. Поправили снаружи файл, застейдженный целиком, — в индекс попадёт
              новая версия. Частично застейдженные файлы (по кускам) не трогаются.
            </span>
          </span>
        </label>
      )}

      <section className={sync.enabled ? '' : 'pointer-events-none opacity-40'}>
        <SectionTitle>Как часто проверять сервер</SectionTitle>
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
          <li>Проверяется только открытая вкладка и только пока окно программы активно. Окно свёрнуто или в фоне — раз в {BACKGROUND_SEC} секунд.</li>
          <li>
            Сначала спрашиваем у сервера только хэши веток — это быстро и почти бесплатно. Настоящий <code className="font-mono text-gk-text">git fetch --prune</code>{' '}
            запускается, только если что-то изменилось.
          </li>
          <li>Пока вы делаете коммит, checkout, rebase или другое действие, проверка ждёт — она никогда не мешает вашим командам.</li>
          <li>
            Нет связи или сервер просит подождать (429) — без всплывающих ошибок, паузы растут: {BACKOFF_SEC.map((x) => (x < 60 ? `${x} с` : `${x / 60} мин`)).join(' → ')}.
          </li>
          <li>Для GitLab с сохранённым токеном используется API с ETag, иначе — git ls-remote.</li>
        </ul>
      </section>

      {sync.enabled && hasRemotes && (
        <section className="rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3 text-[12px]">
          <div className="mb-1 font-medium text-gk-text">Сейчас</div>
          {st.error ? (
            <div className="text-gk-yellow">
              Сервер недоступен: {st.error}. Ошибок подряд: {st.failures}.
            </div>
          ) : st.at ? (
            <div className="text-gk-muted">
              Последняя проверка в {new Date(st.at).toLocaleTimeString('ru-RU')}
              {st.ms != null ? ` (${st.ms} мс)` : ''}. Способ: {via[st.via] ?? st.via ?? '—'}.
            </div>
          ) : (
            <div className="text-gk-dim">Ещё не проверяли — первая проверка через пару секунд после открытия репозитория.</div>
          )}
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{children}</h3>;
}

function Slider({ label, value, min, max, unit, hint, onChange }) {
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
        style={{ '--pct': `${pct}%` }}
      />
    </div>
  );
}

function Toggle({ checked, onChange }) {
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
function ThemePreview({ theme: t }) {
  const rgb = (c, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
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

function BackgroundPreview({ id, theme: t, imageUrl }) {
  const base = { backgroundColor: t.base };
  const glowA = `${t.glow[0]}88`;
  const glowB = `${t.glow[1]}88`;
  const glowC = `${t.glow[2]}66`;
  const line = t.scheme === 'light' ? 'rgb(16 24 40 / 0.09)' : 'rgb(255 255 255 / 0.07)';
  let style = base;
  let inner = null;
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

function IntegrationsTab({ servers }) {
  // Одна авторизация на репозиторий — для Pull, Push и пайплайнов CI/CD; отдельного входа для CI/CD нет
  return <div className="space-y-6">{servers ? <ServersSection {...servers} /> : <p className="text-[12px] text-gk-dim">Авторизация недоступна.</p>}</div>;
}

const SCOPE_SHORT = { api: 'просмотр и действия', read_api: 'только просмотр' };

/** Работают ли пайплайны CI/CD от авторизации репозитория (GitLab) */
function CiText({ ci, method }) {
  if (!ci) return null;
  const who = ci.user?.username ? ` · @${ci.user.username}` : '';
  const scope = ci.scopes ? ci.scopes.map((x) => SCOPE_SHORT[x]).filter(Boolean)[0] : null;
  let text;
  let tone = 'text-gk-muted';
  let state = 'ok';
  if (ci.source === 'legacy') {
    text = `Пайплайны: токен из прежней версии${who} — авторизуйте репозиторий, чтобы была одна авторизация`;
    tone = 'text-gk-yellow';
    state = 'legacy';
  } else if (ci.state === 'bad') {
    text = 'Пайплайны: эта авторизация не подходит для API — откройте «Изменить»';
    tone = 'text-gk-yellow';
    state = 'bad';
  } else if (ci.state === 'none' || !ci.source) {
    text = ci.legacy
      ? 'Пайплайны: пока по токену из прежней версии'
      : `Пайплайны: ${method === 'ssh' ? 'SSH-ключ' : 'пароль'} не подходит для API — добавьте токен в «Изменить»`;
    tone = 'text-gk-yellow';
    state = 'none';
  } else {
    text = `Пайплайны: та же авторизация${ci.viaApiToken ? ' (с токеном для API)' : ''}${who}${scope ? ` · ${scope}` : ''}${ci.state ? '' : ' — проверится при первом обращении'}`;
  }
  return (
    <span data-testid="ci-line" data-state={state} className={`flex min-w-0 items-center gap-1 text-[11px] ${tone}`} data-tip={ci.reason ?? undefined}>
      <Workflow size={11} className="shrink-0 opacity-80" />
      <span className="truncate">{text}</span>
    </span>
  );
}

const LOGIN_ICONS = { password: UserRound, token: KeyRound, ssh: FileKey };
const LOGIN_NAMES = { password: 'логин и пароль', token: 'токен', ssh: 'SSH-ключ' };

function LoginText({ login }) {
  const Icon = LOGIN_ICONS[login.method] ?? KeyRound;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] text-gk-muted">
      <Icon size={11} className={`shrink-0 ${login.readable === false ? 'text-gk-yellow' : 'text-gk-dim'}`} />
      <span className="truncate">
        {LOGIN_NAMES[login.method]}
        {login.username && login.method !== 'ssh' ? ` · ${login.username}` : ''}
        {login.keyPath ? ` · ${login.keyPath.split(/[\\/]/).pop()}` : ''}
      </span>
      {login.readable === false && <span className="shrink-0 text-gk-yellow">— введите заново</span>}
    </span>
  );
}

/**
 * Git-серверы и привязанные к ним репозитории: у каждого репозитория свой вход (логин, токен или SSH-ключ).
 * «Общий вход» — сохранённый раньше на весь сервер; действует для репозиториев без своего.
 */
function ServersSection({ tick, repoOpen, onAuthCurrent, onEdit, onForgetLogin, onForgetServer }) {
  const [list, setList] = useState(null);
  const [confirm, setConfirm] = useState(null); // ключ записи или «server:<host>», который подтверждаем удалить

  useEffect(() => {
    let alive = true;
    api?.creds?.servers?.().then((res) => alive && setList(res?.ok ? res.data : []));
    return () => {
      alive = false;
    };
  }, [tick]);

  const confirmBox = (id, onYes) => (
    <span className="flex shrink-0 items-center gap-1.5 text-[11.5px]">
      <span className="text-gk-muted">Забыть?</span>
      <button
        onClick={() => {
          setConfirm(null);
          onYes();
        }}
        data-testid="login-forget-confirm"
        className="rounded bg-gk-red px-2 py-0.5 font-semibold text-white"
      >
        Да
      </button>
      <button onClick={() => setConfirm(null)} className="rounded px-1.5 py-0.5 text-gk-muted hover:bg-gk-hover">
        Нет
      </button>
    </span>
  );
  const iconBtn = (props, Icon, hover = 'hover:text-gk-text') => (
    <button {...props} className={`rounded p-1 text-gk-dim hover:bg-gk-hover ${hover}`}>
      <Icon size={13} />
    </button>
  );

  return (
    <section className="space-y-2" data-testid="servers-section">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-gk-muted" />
        <span className="flex-1 text-[13px] font-semibold text-gk-strong">Авторизация репозиториев</span>
        {repoOpen && (
          <button
            onClick={onAuthCurrent}
            data-testid="repo-auth"
            className="flex items-center gap-1.5 rounded-md bg-gk-blue px-2.5 py-1 text-[12px] font-semibold text-white hover:brightness-110"
          >
            <LogIn size={12} /> Авторизовать открытый репозиторий…
          </button>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-gk-muted">
        Авторизация сохраняется для конкретного репозитория и одна на всё: Pull, Push, клонирование и пайплайны CI/CD. На одном сервере у
        разных репозиториев могут быть разные учётные записи. В окне авторизации выбирается, где хранится репозиторий: GitHub, GitLab или
        свой сервер (Self-Managed).
      </p>
      {list === null ? (
        <div className="flex items-center gap-2 text-[12px] text-gk-dim">
          <Loader2 size={12} className="animate-spin" /> Загружаем…
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gk-border px-3 py-2.5 text-[12px] text-gk-dim">
          Пока ни одного. Вход сохраняется сам, когда сервер впервые попросит авторизацию при Pull, Push или клонировании.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((srv) => (
            <div key={srv.hostname} className="overflow-hidden rounded-lg border border-gk-border" data-testid="server-row">
              <div className="group flex items-center gap-2.5 bg-gk-fg/[0.03] px-3 py-1.5">
                {srv.cloud ? <Cloud size={14} className="shrink-0" style={{ color: kindInfo(srv.kind)?.color }} /> : <Server size={14} className="shrink-0" style={{ color: kindInfo(srv.kind)?.color ?? undefined }} />}
                <span className="truncate font-mono text-[12.5px] text-gk-strong">{srv.hostname}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim">{srv.kind ? kindLabel(srv.kind, srv.cloud) : 'тип не выбран'}</span>
                {confirm === `server:${srv.hostname}`
                  ? confirmBox(srv.hostname, () => onForgetServer(srv.hostname))
                  : iconBtn(
                      {
                        onClick: () => setConfirm(`server:${srv.hostname}`),
                        'data-tip': 'Забыть сервер: входы всех его репозиториев, общий вход и выбранный тип',
                        'aria-label': `Забыть ${srv.hostname}`,
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
                            { onClick: () => onEdit(r.url), 'data-tip': r.ciOnly ? 'Авторизовать репозиторий' : 'Изменить авторизацию (Pull/Push и пайплайны)', 'aria-label': `Изменить ${r.path}`, 'data-testid': 'repo-edit' },
                            Pencil,
                          )}
                        {iconBtn({ onClick: () => setConfirm(r.key), 'data-tip': 'Забыть авторизацию этого репозитория', 'aria-label': `Забыть ${r.path}`, 'data-testid': 'repo-forget' }, Trash2, 'hover:text-gk-red')}
                      </span>
                    )}
                  </li>
                ))}
                {(srv.sharedCi ?? []).map((l) => (
                  <li key={l.key} className="group flex items-center gap-2.5 py-1.5 pl-8 pr-3" data-testid="shared-ci-row">
                    <Workflow size={13} className="shrink-0 text-gk-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-gk-muted">Токен пайплайнов для всего сервера (из прежней версии)</div>
                      <span className="text-[11px] text-gk-dim">
                        {l.user?.username ? `@${l.user.username}` : 'токен'}
                        {' · действует для репозиториев, чья авторизация не открывает пайплайны'}
                      </span>
                    </div>
                    {confirm === l.key
                      ? confirmBox(l.key, () => onForgetLogin(l.key, `CI/CD всех репозиториев ${srv.hostname}`))
                      : iconBtn({ onClick: () => setConfirm(l.key), 'data-tip': 'Забыть общий токен CI/CD (сохранён раньше, до привязки к репозиториям)', 'aria-label': 'Забыть общий токен CI/CD' }, Trash2, 'hover:text-gk-red')}
                  </li>
                ))}
                {srv.shared.map((l) => (
                  <li key={l.key} className="group flex items-center gap-2.5 py-1.5 pl-8 pr-3" data-testid="shared-row">
                    <Server size={13} className="shrink-0 text-gk-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-gk-muted">Общий вход для всех репозиториев сервера</div>
                      <LoginText login={l} />
                    </div>
                    {confirm === l.key
                      ? confirmBox(l.key, () => onForgetLogin(l.key, `всех репозиториев ${srv.hostname}`))
                      : iconBtn({ onClick: () => setConfirm(l.key), 'data-tip': 'Забыть общий вход (сохранён раньше, до привязки к репозиториям)', 'aria-label': 'Забыть общий вход' }, Trash2, 'hover:text-gk-red')}
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
