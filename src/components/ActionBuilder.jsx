import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Archive,
  Check,
  Copy,
  Download,
  Flag,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Keyboard,
  Layers,
  LogIn,
  MessageCircleQuestionMark,
  ArchiveRestore,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  SquareTerminal,
  Star,
  Trash2,
  WandSparkles,
  Wrench,
  X,
  Zap,
  GitCommitHorizontal,
} from 'lucide-react';
import {
  STEP_GROUPS,
  STEP_TYPES,
  TEMPLATES,
  VARIABLES,
  hotkeyFromEvent,
  hotkeyProblem,
  inputsOf,
  newStep,
  uid,
  validateAction,
} from '../lib/actions.js';

// Иконки, которые можно выбрать для действия (имя → компонент)
export const ACTION_ICONS = { Zap, Rocket, Send, RefreshCw, Download, GitBranch, GitMerge, GitPullRequest, Layers, Sparkles, Wrench, Star, Flag, Trash2, WandSparkles, Play };

export const STEP_ICONS = {
  fetch: RefreshCw,
  pull: ArrowDownToLine,
  push: ArrowUpFromLine,
  createBranch: GitBranch,
  checkout: LogIn,
  rebase: Layers,
  merge: GitMerge,
  deleteBranch: Trash2,
  stash: Archive,
  stashPop: ArchiveRestore,
  commit: GitCommitHorizontal,
  mergeRequest: GitPullRequest,
  confirm: MessageCircleQuestionMark,
  git: SquareTerminal,
};

/**
 * Конструктор действий: список действий слева, редактор цепочки шагов справа. Сохраняется сразу.
 */
export default function ActionBuilder({ actions, branches, initialId, onChange, onRun, onClose }) {
  const [selectedId, setSelectedId] = useState(initialId ?? actions[0]?.id ?? null);
  const [palette, setPalette] = useState(false);
  const selected = actions.find((a) => a.id === selectedId) ?? null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (palette) setPalette(false);
      else if (!e.target?.dataset?.hotkey) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, palette]);

  const update = (patch) => onChange(actions.map((a) => (a.id === selectedId ? { ...a, ...patch } : a)));
  const updateStep = (stepId, patch) => update({ steps: selected.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) });
  const moveStep = (i, dir) => {
    const to = i + dir;
    if (to < 0 || to >= selected.steps.length) return;
    const steps = [...selected.steps];
    [steps[i], steps[to]] = [steps[to], steps[i]];
    update({ steps });
  };

  const create = (base) => {
    const a = { id: uid(), name: 'Новое действие', icon: 'Zap', steps: [], hotkey: null, toolbar: true, ...(base ?? {}) };
    onChange([...actions, a]);
    setSelectedId(a.id);
    if (!base) setPalette(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-gk-scrim p-6 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong flex h-[min(820px,90vh)] w-[min(1080px,100%)] animate-pop-in overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2 shadow-2xl">
        {/* Список действий */}
        <nav className="flex w-64 shrink-0 flex-col border-r border-gk-border bg-gk-sink/10">
          <div className="flex items-center gap-2 px-4 pb-3 pt-4">
            <WandSparkles size={16} className="text-gk-green" />
            <span className="text-[14px] font-semibold text-gk-strong">Конструктор действий</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {actions.length > 0 && <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim">Мои действия</div>}
            {actions.map((a) => {
              const Icon = ACTION_ICONS[a.icon] ?? Zap;
              const bad = validateAction(a).length > 0;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    a.id === selectedId ? 'bg-gk-blue/15 text-gk-strong' : 'text-gk-muted hover:bg-gk-hover hover:text-gk-text'
                  }`}
                >
                  <Icon size={14} className={`shrink-0 ${a.id === selectedId ? 'text-gk-blue' : ''}`} />
                  <span className="min-w-0 flex-1 truncate">{a.name || 'Без названия'}</span>
                  {bad && <AlertTriangle size={12} className="shrink-0 text-gk-yellow" />}
                  {a.hotkey && <span className="shrink-0 font-mono text-[10px] text-gk-dim">{a.hotkey}</span>}
                </button>
              );
            })}
            <button
              onClick={() => create()}
              className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-gk-border px-2.5 py-1.5 text-[12.5px] text-gk-muted hover:border-gk-blue/50 hover:text-gk-blue"
            >
              <Plus size={13} /> Новое действие
            </button>
            <div className="px-2 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim">Готовые шаблоны</div>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => create(t.make())}
                title={t.description}
                className="group flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-gk-hover"
              >
                <span className="flex items-center gap-1.5 text-[12.5px] text-gk-text">
                  <Plus size={11} className="text-gk-dim group-hover:text-gk-green" /> {t.title}
                </span>
                <span className="pl-[18px] text-[11px] leading-snug text-gk-dim">{t.description}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Редактор */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gk-border px-4">
            <span className="flex-1 text-[12px] text-gk-dim">Изменения сохраняются сразу</span>
            <button onClick={onClose} title="Закрыть (Esc)" className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
              <X size={16} />
            </button>
          </div>
          {!selected ? (
            <EmptyState onCreate={() => create()} onTemplate={(t) => create(t.make())} />
          ) : (
            <Editor
              key={selected.id}
              action={selected}
              actions={actions}
              branches={branches}
              palette={palette}
              setPalette={setPalette}
              onUpdate={update}
              onUpdateStep={updateStep}
              onMoveStep={moveStep}
              onDuplicate={() => create({ ...selected, id: uid(), name: `${selected.name} (копия)`, hotkey: null, steps: selected.steps.map((s) => ({ ...s, id: uid() })) })}
              onDelete={() => {
                onChange(actions.filter((a) => a.id !== selected.id));
                setSelectedId(actions.find((a) => a.id !== selected.id)?.id ?? null);
              }}
              onRun={() => onRun(selected)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, onTemplate }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gk-green/10">
        <WandSparkles size={28} className="text-gk-green" />
      </div>
      <div>
        <div className="text-[15px] font-semibold text-gk-strong">Свои кнопки для частых дел</div>
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-gk-muted">
          Соберите цепочку шагов — например, «создать ветку от main, rebase, push, merge request» — и запускайте её одной кнопкой на панели
          или сочетанием клавиш.
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-2 gap-2">
        {TEMPLATES.slice(0, 4).map((t) => (
          <button key={t.id} onClick={() => onTemplate(t)} className="rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3 text-left hover:border-gk-blue/40 hover:bg-gk-blue/[0.05]">
            <div className="text-[13px] font-medium text-gk-text">{t.title}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-gk-dim">{t.description}</div>
          </button>
        ))}
      </div>
      <button onClick={onCreate} className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[13px] font-semibold text-gk-ink hover:brightness-110">
        <Plus size={14} /> Пустое действие
      </button>
    </div>
  );
}

function Editor({ action: a, actions, branches, palette, setPalette, onUpdate, onUpdateStep, onMoveStep, onDuplicate, onDelete, onRun }) {
  const [armDelete, setArmDelete] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);
  const problems = validateAction(a);
  const inputs = useMemo(() => inputsOf(a), [a]);
  const Icon = ACTION_ICONS[a.icon] ?? Zap;
  const [dragIndex, setDragIndex] = useState(null);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Название, иконка */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setIconsOpen((v) => !v)}
              title="Иконка"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-gk-blue/15 text-gk-blue ring-1 ring-gk-blue/30 hover:bg-gk-blue/25"
            >
              <Icon size={17} />
            </button>
            {iconsOpen && (
              <div className="absolute left-0 top-11 z-10 grid w-56 animate-pop-in grid-cols-8 gap-1 rounded-lg border border-gk-border bg-gk-panel-2 p-2 shadow-xl">
                {Object.entries(ACTION_ICONS).map(([name, I]) => (
                  <button
                    key={name}
                    onClick={() => {
                      onUpdate({ icon: name });
                      setIconsOpen(false);
                    }}
                    className={`flex h-6 w-6 items-center justify-center rounded ${a.icon === name ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-muted hover:bg-gk-fg/10 hover:text-gk-text'}`}
                  >
                    <I size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={a.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Название действия"
            className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 text-[16px] font-semibold text-gk-strong outline-none ring-1 ring-transparent placeholder:text-gk-dim hover:ring-gk-border focus:ring-gk-blue"
          />
        </div>

        {/* Как запускать */}
        <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3">
          <HotkeyField action={a} actions={actions} onChange={(hotkey) => onUpdate({ hotkey })} />
          <div className="space-y-2 pt-0.5">
            <Check2 checked={a.toolbar} onChange={(v) => onUpdate({ toolbar: v })}>
              Кнопка на панели сверху
            </Check2>
            <Check2 checked={Boolean(a.confirm)} onChange={(v) => onUpdate({ confirm: v })}>
              Спрашивать подтверждение перед запуском
            </Check2>
          </div>
        </div>

        {/* Шаги */}
        <div className="mt-5 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gk-muted">Шаги</h3>
          <span className="text-[11px] text-gk-dim">выполняются по порядку; ошибка останавливает цепочку</span>
        </div>
        <div className="relative mt-2">
          {a.steps.length > 1 && <span className="absolute bottom-6 left-[15px] top-6 w-px bg-gk-border" />}
          {a.steps.map((step, i) => (
            <StepCard
              key={step.id}
              step={step}
              index={i}
              count={a.steps.length}
              branches={branches}
              dragging={dragIndex === i}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              onDropOn={() => {
                if (dragIndex === null || dragIndex === i) return;
                const steps = [...a.steps];
                const [s] = steps.splice(dragIndex, 1);
                steps.splice(i, 0, s);
                onUpdate({ steps });
                setDragIndex(null);
              }}
              onChange={(params) => onUpdateStep(step.id, { params: { ...step.params, ...params } })}
              onMove={(dir) => onMoveStep(i, dir)}
              onRemove={() => onUpdate({ steps: a.steps.filter((s) => s.id !== step.id) })}
            />
          ))}
          {palette ? (
            <StepPalette
              onPick={(type) => {
                onUpdate({ steps: [...a.steps, newStep(type)] });
                setPalette(false);
              }}
              onClose={() => setPalette(false)}
            />
          ) : (
            <button
              onClick={() => setPalette(true)}
              className="relative ml-0 mt-1 flex items-center gap-2 rounded-lg border border-dashed border-gk-border px-3 py-2 text-[12.5px] text-gk-muted hover:border-gk-green/50 hover:text-gk-green"
            >
              <Plus size={14} /> Добавить шаг
            </button>
          )}
        </div>

        {/* Переменные */}
        <div className="mt-5 rounded-lg border border-gk-border bg-gk-fg/[0.015] p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-muted">Переменные в полях</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {VARIABLES.map(([v, d]) => (
              <button
                key={v}
                onClick={() => navigator.clipboard?.writeText(v)}
                title="Скопировать"
                className="flex items-baseline gap-2 rounded px-1 text-left text-[12px] hover:bg-gk-fg/5"
              >
                <code className="shrink-0 font-mono text-gk-blue">{v}</code>
                <span className="truncate text-gk-dim">{d}</span>
              </button>
            ))}
          </div>
          {inputs.length > 0 && (
            <div className="mt-2 text-[11.5px] text-gk-muted">
              При запуске спросит: {inputs.map((x) => `«${x.label}»`).join(', ')}
            </div>
          )}
        </div>
      </div>

      {/* Низ */}
      <div className="flex shrink-0 items-center gap-2 border-t border-gk-border px-4 py-2.5">
        <button
          onClick={() => {
            if (!armDelete) {
              setArmDelete(true);
              setTimeout(() => setArmDelete(false), 3000);
            } else onDelete();
          }}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] transition-colors ${armDelete ? 'bg-gk-red text-white' : 'text-gk-red hover:bg-gk-red/10'}`}
        >
          <Trash2 size={13} /> {armDelete ? 'Точно удалить?' : 'Удалить'}
        </button>
        <button onClick={onDuplicate} className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          <Copy size={13} /> Копия
        </button>
        <div className="min-w-0 flex-1 truncate text-right text-[12px] text-gk-yellow" title={problems.join('\n')}>
          {problems[0] ?? ''}
          {problems.length > 1 ? ` (+${problems.length - 1})` : ''}
        </div>
        <button
          disabled={problems.length > 0}
          onClick={onRun}
          className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-40"
        >
          <Play size={13} /> Запустить
        </button>
      </div>
    </>
  );
}

function StepCard({ step, index, count, branches, dragging, onDragStart, onDragEnd, onDropOn, onChange, onMove, onRemove }) {
  const t = STEP_TYPES[step.type];
  const Icon = STEP_ICONS[step.type] ?? Zap;
  const [over, setOver] = useState(false);
  if (!t) return null;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false);
        onDropOn();
      }}
      className={`group relative mb-2 flex gap-3 ${dragging ? 'opacity-40' : ''}`}
    >
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Перетащите, чтобы изменить порядок"
        className="relative z-10 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-full bg-gk-panel-2 text-[12px] font-semibold text-gk-muted ring-1 ring-gk-border"
      >
        {index + 1}
      </div>
      <div className={`min-w-0 flex-1 rounded-lg border bg-gk-fg/[0.02] px-3 py-2.5 transition-colors ${over ? 'border-gk-blue' : 'border-gk-border'}`}>
        <div className="flex items-center gap-2">
          <Icon size={14} className="shrink-0 text-gk-blue" />
          <span className="text-[13px] font-medium text-gk-text">{t.label}</span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-gk-dim">{t.hint}</span>
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <SmallBtn title="Выше" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={12} />
            </SmallBtn>
            <SmallBtn title="Ниже" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={12} />
            </SmallBtn>
            <SmallBtn title="Убрать шаг" danger onClick={onRemove}>
              <X size={12} />
            </SmallBtn>
          </div>
        </div>
        {t.fields.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            {t.fields.map((f) =>
              f.type === 'bool' ? (
                <div key={f.key} className="col-span-2">
                  <Check2 checked={Boolean(step.params[f.key])} onChange={(v) => onChange({ [f.key]: v })}>
                    {f.label}
                  </Check2>
                </div>
              ) : f.type === 'select' ? (
                <label key={f.key} className="block">
                  <span className="mb-0.5 block text-[11px] text-gk-muted">{f.label}</span>
                  <select value={step.params[f.key] ?? f.def} onChange={(e) => onChange({ [f.key]: e.target.value })} className={inputCls}>
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={f.key} className={`block ${f.key === 'command' || f.key === 'text' || f.key === 'message' || f.key === 'title' ? 'col-span-2' : ''}`}>
                  <span className="mb-0.5 block text-[11px] text-gk-muted">{f.label}</span>
                  <input
                    value={step.params[f.key] ?? ''}
                    onChange={(e) => onChange({ [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    list={f.type === 'branch' ? 'action-branches' : undefined}
                    spellCheck={false}
                    className={`${inputCls} ${f.type === 'branch' || f.key === 'command' || f.key === 'name' ? 'font-mono' : ''}`}
                  />
                </label>
              ),
            )}
          </div>
        )}
        <datalist id="action-branches">
          {['{default}', 'origin/{default}', '{branch}', '{start}', ...branches].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {step.type === 'git' && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-gk-dim">
            <AlertTriangle size={11} className="text-gk-yellow" /> Выполняется как есть — Undo для своих команд не работает
          </div>
        )}
      </div>
    </div>
  );
}

function StepPalette({ onPick, onClose }) {
  return (
    <div className="relative mt-1 animate-pop-in rounded-lg border border-gk-blue/40 bg-gk-panel-2 p-3 shadow-xl">
      <div className="mb-2 flex items-center">
        <span className="flex-1 text-[12px] font-medium text-gk-text">Какой шаг добавить?</span>
        <SmallBtn title="Закрыть (Esc)" onClick={onClose}>
          <X size={13} />
        </SmallBtn>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {STEP_GROUPS.map(([group, title]) => (
          <div key={group}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim">{title}</div>
            {Object.entries(STEP_TYPES)
              .filter(([, t]) => t.group === group)
              .map(([type, t]) => {
                const Icon = STEP_ICONS[type] ?? Zap;
                return (
                  <button
                    key={type}
                    onClick={() => onPick(type)}
                    title={t.hint}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] text-gk-text hover:bg-gk-blue/15"
                  >
                    <Icon size={12} className="shrink-0 text-gk-blue" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HotkeyField({ action, actions, onChange }) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(null);
  const ref = useRef(null);
  const problem = hotkeyProblem(pending ?? action.hotkey, actions, action.id);
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gk-muted">
        <Keyboard size={12} /> Горячая клавиша
      </div>
      <div className="flex items-center gap-1.5">
        <button
          ref={ref}
          data-hotkey="1"
          onClick={() => {
            setRecording(true);
            setPending(null);
          }}
          onBlur={() => {
            setRecording(false);
            setPending(null);
          }}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') {
              setRecording(false);
              setPending(null);
              ref.current?.blur();
              return;
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
              onChange(null);
              setRecording(false);
              ref.current?.blur();
              return;
            }
            const combo = hotkeyFromEvent(e);
            if (!combo) return;
            setPending(combo);
            if (!hotkeyProblem(combo, actions, action.id)) {
              onChange(combo);
              setRecording(false);
              setPending(null);
              ref.current?.blur();
            }
          }}
          className={`flex h-8 min-w-0 flex-1 items-center rounded-md px-2.5 text-left font-mono text-[12.5px] ring-1 transition ${
            recording ? 'bg-gk-blue/10 text-gk-blue ring-gk-blue' : 'bg-gk-bg text-gk-text ring-gk-border hover:ring-gk-muted'
          }`}
        >
          {recording ? pending ?? 'Нажмите сочетание… (Esc — отмена, Backspace — убрать)' : action.hotkey ?? <span className="font-sans text-gk-dim">Нет — нажмите, чтобы назначить</span>}
        </button>
        {action.hotkey && !recording && (
          <SmallBtn title="Убрать сочетание" onClick={() => onChange(null)}>
            <X size={13} />
          </SmallBtn>
        )}
      </div>
      {problem && recording && <div className="mt-1 text-[11px] text-gk-yellow">{problem}</div>}
    </div>
  );
}

function Check2({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gk-text">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked ? 'border-gk-green bg-gk-green text-gk-ink' : 'border-gk-border bg-gk-bg'
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function SmallBtn({ children, danger, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        danger ? 'text-gk-dim hover:bg-gk-red/15 hover:text-gk-red' : 'text-gk-dim enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

const inputCls =
  'w-full rounded-md bg-gk-bg px-2 py-1 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';
