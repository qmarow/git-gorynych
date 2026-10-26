import { useEffect, useState } from 'react';
import { Archive, Check, GitBranch, Image as ImageIcon, Loader2, Palette, Plug, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { BACKGROUNDS, THEMES, themeById } from '../lib/appearance.js';
import { TokenSetup } from './TokenSetup.jsx';
import { GuardSettings, Switch } from './Guard.jsx';

const TABS = [
  { id: 'appearance', label: 'Оформление', icon: Palette },
  { id: 'branches', label: 'Ветки', icon: GitBranch },
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
  guard,
  onGuardChange,
  onClose,
}) {
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-black/40 pt-[7vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-strong flex max-h-[84vh] w-[760px] max-w-[calc(100vw-2rem)] animate-pop-in overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2">
        {/* Разделы */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-gk-border bg-black/10 p-2">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">Настройки</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                tab === t.id ? 'bg-gk-hover text-white' : 'text-gk-muted hover:bg-gk-hover/60 hover:text-gk-text'
              }`}
            >
              <t.icon size={14} className={tab === t.id ? 'text-gk-green' : ''} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-gk-border px-4 py-3">
            <h2 className="flex-1 text-[14px] font-semibold text-white">{TABS.find((t) => t.id === tab)?.label}</h2>
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
            ) : tab === 'guard' ? (
              <GuardSettings cfg={guard} onChange={onGuardChange} />
            ) : (
              <IntegrationsTab repo={repo} onForgeChanged={onForgeChanged} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================== Оформление =================== */

function AppearanceTab({ appearance: a, meta, imageUrl, onChange, onPickImage }) {
  const theme = themeById(a.theme);
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
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => onChange({ theme: t.id })}
              className={`group rounded-lg p-1.5 text-left transition-all duration-200 ${
                a.theme === t.id ? 'bg-white/[0.06] ring-2 ring-gk-green' : 'ring-1 ring-gk-border hover:-translate-y-0.5 hover:ring-white/20'
              }`}
            >
              <ThemePreview theme={t} />
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
                  a.background === b.id ? 'bg-white/[0.06] ring-2 ring-gk-green' : 'ring-1 ring-gk-border enabled:hover:ring-white/20'
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
          <div className="mt-3 animate-fade-in space-y-3 rounded-lg border border-gk-border bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={pick}
                disabled={picking}
                className="flex items-center gap-1.5 rounded-md bg-gk-hover px-3 py-1.5 text-[12.5px] text-gk-text hover:bg-white/10 disabled:opacity-50"
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
          <div className="mt-3 animate-fade-in rounded-lg border border-gk-border bg-white/[0.02] p-3">
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
                    a.material === m.id ? 'bg-gk-green/15 text-gk-green ring-1 ring-gk-green/40' : 'bg-gk-hover text-gk-text hover:bg-white/10'
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
        <div className="space-y-3 rounded-lg border border-gk-border bg-white/[0.02] p-3">
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
      <div className="ml-11 rounded-lg border border-gk-border bg-white/[0.02] p-3 text-gk-muted">
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
        checked ? 'bg-gk-green' : 'bg-white/15'
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
      backgroundImage: `radial-gradient(ellipse at 50% -20%, ${glowA}, transparent 60%), linear-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.07) 1px, transparent 1px)`,
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
    <div className="relative h-[54px] overflow-hidden rounded-md ring-1 ring-black/30" style={style}>
      {inner}
    </div>
  );
}

/* =================== Подключения =================== */

function IntegrationsTab({ repo, onForgeChanged }) {
  if (!repo) return <p className="text-[13px] text-gk-muted">Откройте репозиторий, чтобы подключить GitLab для него.</p>;
  const current = repo.localBranches.find((b) => b.name === repo.currentBranch);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fc6d26]" />
        <span className="text-[13px] font-semibold text-white">GitLab</span>
        {repo.forge?.path && <span className="truncate font-mono text-[11px] text-gk-dim">{repo.forge.path}</span>}
      </div>
      <p className="text-[12px] leading-relaxed text-gk-muted">
        Статусы пайплайнов в графе, логи заданий, перезапуск и отмена, переменные CI/CD и раннеры проекта.
      </p>
      <div className="pt-1">
        <TokenSetup repoPath={repo.path} forge={repo.forge} remoteName={current?.upstreamRemote} onChanged={onForgeChanged} />
      </div>
    </div>
  );
}
