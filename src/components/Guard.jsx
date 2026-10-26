import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileText, KeyRound, Pencil, Plus, RotateCcw, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react';
import { CATEGORY_LABELS, DEFAULT_GUARD, DEFAULT_RULES, validatePattern } from '../lib/guardRules.js';
import { plural } from '../lib/format.js';

const TONE = {
  secret: { chip: 'bg-gk-red/15 text-gk-red', mark: 'bg-gk-red/30 text-white', icon: KeyRound },
  debug: { chip: 'bg-gk-yellow/15 text-gk-yellow', mark: 'bg-gk-yellow/30 text-white', icon: AlertTriangle },
  other: { chip: 'bg-gk-blue/15 text-gk-blue', mark: 'bg-gk-blue/30 text-white', icon: ShieldAlert },
};

export function summarize(findings) {
  const by = new Map();
  for (const f of findings) by.set(f.label, (by.get(f.label) ?? 0) + 1);
  return [...by.entries()].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ');
}

/** Мягкое предупреждение над кнопкой Commit */
export function GuardBanner({ result, onOpen }) {
  if (!result?.findings?.length) return null;
  const secrets = result.findings.some((f) => f.category === 'secret');
  return (
    <button
      onClick={onOpen}
      title="Показать, что нашлось"
      className={`flex w-full animate-fade-in items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
        secrets ? 'border-gk-red/35 bg-gk-red/[0.08] hover:bg-gk-red/[0.12]' : 'border-gk-yellow/35 bg-gk-yellow/[0.07] hover:bg-gk-yellow/[0.11]'
      }`}
    >
      {secrets ? <KeyRound size={13} className="mt-0.5 shrink-0 text-gk-red" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-gk-yellow" />}
      <span className="min-w-0">
        <span className="font-medium text-gk-text">
          {result.findings.length} {plural(result.findings.length, 'подозрительное место', 'подозрительных места', 'подозрительных мест')} в коммите
        </span>
        <span className="block truncate text-gk-muted">{summarize(result.findings)}</span>
      </span>
    </button>
  );
}

/** Список находок. mode: 'commit' — перед коммитом (можно закоммитить всё равно), 'view' — просто посмотреть */
export function GuardDialog({ result, mode, onCancel, onCommitAnyway, onOpenFile, onSettings }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const f of result.findings) {
      if (!m.has(f.file)) m.set(f.file, []);
      m.get(f.file).push(f);
    }
    return [...m.entries()];
  }, [result]);
  const secrets = result.findings.filter((f) => f.category === 'secret').length;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/45 pt-[8vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="glass-strong flex max-h-[80vh] w-[720px] max-w-[calc(100vw-2rem)] animate-pop-in flex-col overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-border px-4 py-3">
          {secrets ? <KeyRound size={16} className="text-gk-red" /> : <AlertTriangle size={16} className="text-gk-yellow" />}
          <h2 className="flex-1 text-[14px] font-semibold text-white">
            {mode === 'commit' ? 'Проверьте перед коммитом' : 'Pre-commit Guard'}
          </h2>
          <button onClick={onCancel} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={16} />
          </button>
        </div>
        <div className="shrink-0 border-b border-gk-border px-4 py-2.5 text-[12.5px] leading-relaxed text-gk-muted">
          В добавленных строках нашлось {result.findings.length}{' '}
          {plural(result.findings.length, 'подозрительное место', 'подозрительных места', 'подозрительных мест')}
          {secrets > 0 && (
            <>
              , из них <b className="font-medium text-gk-red">{secrets} похоже на секреты</b> — ключи и токены в истории Git остаются навсегда, даже
              если потом удалить файл
            </>
          )}
          . Строку можно пометить комментарием <code className="font-mono text-gk-text">gitidea-ignore</code>, чтобы проверка её пропускала.
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.map(([file, items]) => (
            <div key={file} className="mb-1">
              <button
                onClick={() => onOpenFile?.(file, items[0].line)}
                title="Открыть изменения файла"
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12.5px] hover:bg-gk-hover"
              >
                <FileText size={13} className="shrink-0 text-gk-dim" />
                <span className="min-w-0 flex-1 truncate font-medium text-gk-text">{file}</span>
                <span className="shrink-0 text-[11px] text-gk-dim">{items.length}</span>
              </button>
              {items.map((f, i) => {
                const tone = TONE[f.category] ?? TONE.other;
                return (
                  <div key={i} className="flex items-start gap-2 py-1 pl-9 pr-4 text-[12px]">
                    <span className="w-10 shrink-0 pt-px text-right font-mono text-[11px] text-gk-dim">{f.line}</span>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] ${tone.chip}`}>{f.label}</span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-gk-muted" title={f.text}>
                      {f.text.slice(0, f.start)}
                      <mark className={`rounded-[3px] px-0.5 ${tone.mark}`}>{f.text.slice(f.start, f.end) || ' '}</mark>
                      {f.text.slice(f.end)}
                    </code>
                  </div>
                );
              })}
            </div>
          ))}
          {result.truncated && <div className="px-4 py-1 text-[11.5px] text-gk-dim">Показаны первые находки — их слишком много</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-gk-border px-4 py-2.5">
          <button onClick={onSettings} className="rounded px-2 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Настроить правила…
          </button>
          <div className="flex-1" />
          {mode === 'commit' ? (
            <>
              <button
                autoFocus
                onClick={onCancel}
                className="rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110"
              >
                Вернуться и исправить
              </button>
              <button
                onClick={onCommitAnyway}
                className={`rounded-md px-3 py-1.5 text-[12.5px] ring-1 transition ${
                  secrets ? 'text-gk-red ring-gk-red/40 hover:bg-gk-red/10' : 'text-gk-text ring-gk-border hover:bg-white/10'
                }`}
              >
                Всё равно закоммитить
              </button>
            </>
          ) : (
            <button onClick={onCancel} className="rounded-md bg-white/10 px-3 py-1.5 text-[12.5px] text-gk-text hover:bg-white/15">
              Закрыть
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Настройки правил ---------------- */

export function GuardSettings({ cfg, onChange }) {
  const [editing, setEditing] = useState(null); // правило в форме (новое или своё)
  const off = new Set(cfg.disabled);
  const toggle = (id) =>
    onChange({ ...cfg, disabled: off.has(id) ? cfg.disabled.filter((x) => x !== id) : [...cfg.disabled, id] });

  const groups = [
    ['secret', DEFAULT_RULES.filter((r) => r.category === 'secret')],
    ['debug', DEFAULT_RULES.filter((r) => r.category === 'debug')],
  ];

  return (
    <div className="space-y-5 text-[12.5px]">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch checked={cfg.enabled} onChange={(v) => onChange({ ...cfg, enabled: v })} />
        <span>
          <span className="block font-medium text-gk-text">Проверять перед коммитом</span>
          <span className="block text-gk-muted">
            Перед каждым коммитом программа смотрит добавленные строки и предупреждает о забытой отладке и похожих на секреты строках.
            Коммит не блокируется — решаете вы.
          </span>
        </span>
      </label>

      <div className={cfg.enabled ? '' : 'pointer-events-none opacity-45'}>
        {groups.map(([cat, rules]) => (
          <section key={cat} className="mb-4">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{CATEGORY_LABELS[cat]}</h4>
            <div className="overflow-hidden rounded-lg border border-gk-border">
              {rules.map((r) => (
                <RuleRow key={r.id} rule={r} enabled={!off.has(r.id)} onToggle={() => toggle(r.id)} />
              ))}
            </div>
          </section>
        ))}

        <section>
          <div className="mb-1.5 flex items-center">
            <h4 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">Свои правила</h4>
            {!editing && (
              <button
                onClick={() => setEditing({ id: null, label: '', pattern: '', flags: 'i', files: '', category: 'debug' })}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-gk-blue hover:bg-gk-blue/10"
              >
                <Plus size={12} /> Добавить
              </button>
            )}
          </div>
          {cfg.custom.length === 0 && !editing && (
            <div className="rounded-lg border border-dashed border-gk-border px-3 py-3 text-gk-dim">
              Например, запретить «fit(» в тестах или внутренние адреса серверов. Правило — регулярное выражение.
            </div>
          )}
          {cfg.custom.length > 0 && (
            <div className="mb-2 overflow-hidden rounded-lg border border-gk-border">
              {cfg.custom.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  enabled={!off.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  onEdit={() => setEditing({ ...r })}
                  onDelete={() => onChange({ ...cfg, custom: cfg.custom.filter((x) => x.id !== r.id), disabled: cfg.disabled.filter((x) => x !== r.id) })}
                />
              ))}
            </div>
          )}
          {editing && (
            <RuleForm
              rule={editing}
              onCancel={() => setEditing(null)}
              onSave={(rule) => {
                const exists = cfg.custom.some((x) => x.id === rule.id);
                onChange({ ...cfg, custom: exists ? cfg.custom.map((x) => (x.id === rule.id ? rule : x)) : [...cfg.custom, rule] });
                setEditing(null);
              }}
            />
          )}
        </section>
      </div>

      <button
        onClick={() => onChange(DEFAULT_GUARD)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text"
      >
        <RotateCcw size={12} /> Вернуть правила по умолчанию
      </button>
    </div>
  );
}

function RuleRow({ rule, enabled, onToggle, onEdit, onDelete }) {
  const tone = TONE[rule.category] ?? TONE.other;
  return (
    <div className={`group flex items-center gap-2.5 border-b border-gk-border/60 px-3 py-1.5 last:border-0 ${enabled ? '' : 'opacity-50'}`}>
      <Switch small checked={enabled} onChange={onToggle} />
      <tone.icon size={12} className={`shrink-0 ${tone.chip.split(' ').pop()}`} />
      <span className="w-44 shrink-0 truncate text-gk-text">{rule.label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-gk-dim" title={rule.pattern}>
        {rule.pattern}
      </code>
      {rule.files && <span className="shrink-0 rounded bg-white/5 px-1.5 text-[10.5px] text-gk-muted" title="Только в этих файлах">.{rule.files.split(/[,\s]+/).join(' .')}</span>}
      {onEdit && (
        <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} title="Изменить" className="rounded p-1 text-gk-dim hover:bg-white/10 hover:text-gk-text">
            <Pencil size={12} />
          </button>
          <button onClick={onDelete} title="Удалить" className="rounded p-1 text-gk-dim hover:bg-gk-red/15 hover:text-gk-red">
            <Trash2 size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

function RuleForm({ rule, onSave, onCancel }) {
  const [r, setR] = useState(rule);
  const [sample, setSample] = useState('');
  const error = r.pattern ? validatePattern(r.pattern, r.flags) : null;
  let hit = null;
  if (!error && r.pattern && sample) {
    try {
      const m = new RegExp(r.pattern, r.flags).exec(sample);
      hit = m ? { start: m.index, end: m.index + m[0].length } : false;
    } catch {
      hit = null;
    }
  }
  const set = (patch) => setR((x) => ({ ...x, ...patch }));
  const valid = r.label.trim() && r.pattern && !error;
  return (
    <div className="animate-fade-in space-y-2.5 rounded-lg border border-gk-blue/40 bg-gk-blue/[0.04] p-3">
      <div className="grid grid-cols-[1fr_140px] gap-2">
        <Field label="Название">
          <input autoFocus value={r.label} onChange={(e) => set({ label: e.target.value })} placeholder="Например: внутренний адрес" className={inputCls} />
        </Field>
        <Field label="Тип">
          <select value={r.category} onChange={(e) => set({ category: e.target.value })} className={inputCls}>
            <option value="debug">Отладка</option>
            <option value="secret">Секрет (скрывать текст)</option>
            <option value="other">Другое</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_70px] gap-2">
        <Field label="Регулярное выражение">
          <input value={r.pattern} onChange={(e) => set({ pattern: e.target.value })} spellCheck={false} placeholder="10\.0\.\d+\.\d+" className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Флаги">
          <input value={r.flags ?? ''} onChange={(e) => set({ flags: e.target.value.replace(/[^imsu]/g, '') })} placeholder="i" className={`${inputCls} font-mono`} />
        </Field>
      </div>
      {error && <div className="text-[11.5px] text-gk-red">Ошибка в выражении: {error}</div>}
      <Field label="Только в файлах (расширения через запятую, пусто — во всех)">
        <input value={r.files ?? ''} onChange={(e) => set({ files: e.target.value })} placeholder="js, ts, py" className={`${inputCls} font-mono`} />
      </Field>
      <Field label="Проверить на строке">
        <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Вставьте строку кода" className={`${inputCls} font-mono`} />
      </Field>
      {sample && hit !== null && (
        <div className="font-mono text-[11.5px]">
          {hit ? (
            <>
              <span className="mr-2 font-sans text-gk-green">
                <Check size={11} className="inline" /> сработает:
              </span>
              {sample.slice(0, hit.start)}
              <mark className="rounded-[3px] bg-gk-yellow/30 px-0.5 text-white">{sample.slice(hit.start, hit.end)}</mark>
              {sample.slice(hit.end)}
            </>
          ) : (
            <span className="font-sans text-gk-dim">не сработает на этой строке</span>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded px-3 py-1 text-[12px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          Отмена
        </button>
        <button
          disabled={!valid}
          onClick={() => onSave({ ...r, id: r.id ?? `custom-${Math.random().toString(36).slice(2, 8)}`, label: r.label.trim() })}
          className="rounded-md bg-gk-green px-3 py-1 text-[12px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-40"
        >
          Сохранить правило
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-gk-muted">{label}</span>
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, small }) {
  const w = small ? 26 : 32;
  const k = small ? 12 : 14;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      style={{ width: w, height: k + 4 }}
      className={`relative block shrink-0 rounded-full p-0 transition-colors duration-200 ${checked ? 'bg-gk-green' : 'bg-white/15'}`}
    >
      <span
        className="absolute left-0 top-[2px] block rounded-full bg-white shadow transition-transform duration-200"
        style={{ width: k, height: k, transform: `translateX(${checked ? w - k - 2 : 2}px)` }}
      />
    </button>
  );
}

export function GuardIcon({ ok }) {
  return ok ? <ShieldCheck size={13} className="text-gk-green" /> : <ShieldAlert size={13} className="text-gk-yellow" />;
}

const inputCls =
  'w-full rounded-md bg-gk-bg px-2 py-1 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';
