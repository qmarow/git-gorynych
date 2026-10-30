import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Trash2, X } from 'lucide-react';

const WHEN_OPTIONS = [
  ['on_success', 'Если предыдущие этапы успешны (по умолчанию)'],
  ['manual', 'Вручную — кнопкой в GitLab'],
  ['always', 'Всегда, даже если что-то упало'],
  ['on_failure', 'Только если что-то упало'],
  ['delayed', 'С задержкой'],
  ['never', 'Не запускать'],
];
const RULE_WHEN = [
  ['on_success', 'запускать'],
  ['manual', 'вручную'],
  ['always', 'всегда'],
  ['never', 'не запускать'],
  ['delayed', 'с задержкой'],
];

const lines = (v) => (v ?? []).join('\n');
const splitList = (v) =>
  String(v ?? '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Форма задания GitLab CI: создание и правка без ручного YAML.
 * Пустое поле = «как унаследовано» (из default, extends или глобальных настроек).
 */
export default function JobForm({ job, stages, allJobs, mode, presetStage, busy, onSubmit, onDelete, onCancel }) {
  const own = new Set(job?.own ?? []);
  const initial = useMemo(
    () => ({
      name: job?.name ?? '',
      stage: job?.stage ?? presetStage ?? stages[0] ?? 'test',
      image: own.has('image') ? job?.image ?? '' : '',
      script: own.has('script') ? lines(job?.scriptRaw) : '',
      before_script: own.has('before_script') ? lines(job?.beforeScript?.lines) : '',
      after_script: own.has('after_script') ? lines(job?.afterScript?.lines) : '',
      when: own.has('when') ? job?.when ?? 'on_success' : 'on_success',
      allow_failure: own.has('allow_failure') ? Boolean(job?.allowFailure) : false,
      needs: own.has('needs') ? job?.needsRaw ?? [] : null,
      tags: own.has('tags') ? (job?.tags ?? []).join(', ') : '',
      environment: own.has('environment') ? job?.environment?.name ?? '' : '',
      timeout: own.has('timeout') ? job?.timeout ?? '' : '',
      rules: own.has('rules') ? (job?.rulesRaw ?? []).map((r) => ({ ...r })) : [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, mode],
  );
  const [f, setF] = useState(initial);
  const [extra, setExtra] = useState(Boolean(initial.before_script || initial.after_script || initial.timeout));
  const [armDelete, setArmDelete] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  const rulesEditable = mode === 'create' || job?.rulesEditable !== false;
  const otherJobs = allJobs.filter((j) => j.name !== job?.name).map((j) => j.name);
  const stageOptions = [...new Set([...stages, f.stage].filter(Boolean))];

  // Что поменялось — только эти поля и записываем в файл
  const changes = () => {
    const out = {};
    const cmp = (key, value, initValue, toYaml) => {
      if (JSON.stringify(value) !== JSON.stringify(initValue)) out[key] = toYaml(value);
    };
    cmp('stage', f.stage, initial.stage, (v) => v.trim());
    cmp('image', f.image, initial.image, (v) => v.trim() || null);
    cmp('script', f.script, initial.script, (v) => (v.trim() ? v.split('\n') : null));
    cmp('before_script', f.before_script, initial.before_script, (v) => (v.trim() ? v.split('\n') : null));
    cmp('after_script', f.after_script, initial.after_script, (v) => (v.trim() ? v.split('\n') : null));
    cmp('when', f.when, initial.when, (v) => (v === 'on_success' ? null : v));
    cmp('allow_failure', f.allow_failure, initial.allow_failure, (v) => (v ? true : null));
    cmp('needs', f.needs, initial.needs, (v) => v);
    cmp('tags', f.tags, initial.tags, (v) => splitList(v));
    cmp('environment', f.environment, initial.environment, (v) => v.trim() || null);
    cmp('timeout', f.timeout, initial.timeout, (v) => String(v).trim() || null);
    if (rulesEditable) cmp('rules', f.rules, initial.rules, (v) => (v.length ? v : null));
    return out;
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!f.name.trim()) return;
    if (mode === 'create') {
      onSubmit([
        { type: 'addJob', name: f.name.trim(), stage: f.stage, image: f.image, script: f.script.split('\n') },
        ...(() => {
          const rest = changes();
          delete rest.stage;
          delete rest.image;
          delete rest.script;
          return Object.keys(rest).length ? [{ type: 'setJob', name: f.name.trim(), fields: rest }] : [];
        })(),
      ]);
      return;
    }
    const ops = [];
    const name = f.name.trim();
    if (name !== job.name) ops.push({ type: 'renameJob', from: job.name, to: name });
    const fields = changes();
    if (Object.keys(fields).length) ops.push({ type: 'setJob', name, fields });
    onSubmit(ops, name);
  };

  const inherited = (label, value) => (value ? `унаследовано: ${value}` : label);

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3 text-[12.5px]">
        <Field label="Имя задания">
          <input
            autoFocus={mode === 'create'}
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="например, unit-tests"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Этап">
            <input list="ci-stage-options" value={f.stage} onChange={(e) => set({ stage: e.target.value })} className={inputCls} />
            <datalist id="ci-stage-options">
              {stageOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Docker-образ">
            <input
              value={f.image}
              onChange={(e) => set({ image: e.target.value })}
              placeholder={inherited('node:20', job?.imageInherited ? job.image : null)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Команды (script) — по одной на строку">
          <textarea
            value={f.script}
            onChange={(e) => set({ script: e.target.value })}
            rows={Math.min(10, Math.max(3, f.script.split('\n').length + 1))}
            placeholder={job?.script?.lines?.length && !own.has('script') ? `унаследовано:\n${job.script.lines.join('\n')}` : 'npm ci\nnpm test'}
            spellCheck={false}
            className={`${inputCls} resize-y font-mono text-[12px] leading-5`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Когда запускать">
            <select value={f.when} onChange={(e) => set({ when: e.target.value })} className={inputCls}>
              {WHEN_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Окружение (environment)">
            <input value={f.environment} onChange={(e) => set({ environment: e.target.value })} placeholder="production" className={inputCls} />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-gk-text">
          <input type="checkbox" checked={f.allow_failure} onChange={(e) => set({ allow_failure: e.target.checked })} className="accent-[var(--color-gk-green)]" />
          Может упасть — ошибка не остановит пайплайн
        </label>

        {/* needs */}
        <Field label="Запускать после (needs)">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.needs === null ? (
              <span className="text-[11.5px] text-gk-dim">по порядку этапов</span>
            ) : f.needs.length === 0 ? (
              <span className="text-[11.5px] text-gk-dim">сразу, не дожидаясь этапов</span>
            ) : (
              f.needs.map((n) => (
                <span key={n} className="flex items-center gap-1 rounded bg-gk-blue/15 px-1.5 py-0.5 font-mono text-[11px] text-gk-blue">
                  {n}
                  <button type="button" onClick={() => set({ needs: f.needs.filter((x) => x !== n) })} className="hover:text-gk-strong">
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__stage') set({ needs: null });
                else if (v === '__now') set({ needs: [] });
                else if (v) set({ needs: [...(f.needs ?? []), v] });
              }}
              className="rounded bg-gk-hover px-1.5 py-0.5 text-[11px] text-gk-muted outline-none"
            >
              <option value="">+ добавить…</option>
              {otherJobs
                .filter((n) => !(f.needs ?? []).includes(n))
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              <option value="__stage">— по порядку этапов (без needs)</option>
              <option value="__now">— сразу (needs: [])</option>
            </select>
          </div>
        </Field>

        <Field label="Теги раннера — через запятую">
          <input
            value={f.tags}
            onChange={(e) => set({ tags: e.target.value })}
            placeholder={job?.tags?.length && !own.has('tags') ? `унаследовано: ${job.tags.join(', ')}` : 'docker, linux'}
            className={inputCls}
          />
        </Field>

        {/* rules */}
        <Field label="Правила запуска (rules) — срабатывает первое подходящее">
          {!rulesEditable ? (
            <p className="text-[11.5px] text-gk-dim">Здесь сложные правила (changes, exists, variables) — правьте их во вкладке «Файл».</p>
          ) : (
            <div className="space-y-1.5">
              {f.rules.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={r.if}
                    onChange={(e) => set({ rules: f.rules.map((x, k) => (k === i ? { ...x, if: e.target.value } : x)) })}
                    placeholder='$CI_COMMIT_BRANCH == "main" (пусто — всегда)'
                    spellCheck={false}
                    className={`${inputCls} min-w-0 flex-1 font-mono text-[11.5px]`}
                  />
                  <select
                    value={r.when}
                    onChange={(e) => set({ rules: f.rules.map((x, k) => (k === i ? { ...x, when: e.target.value } : x)) })}
                    className={`${inputCls} w-32`}
                  >
                    {RULE_WHEN.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => set({ rules: f.rules.filter((_, k) => k !== i) })}
                    className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-red"
                    title="Удалить правило"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => set({ rules: [...f.rules, { if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH', when: 'on_success', allow_failure: false }] })}
                className="flex items-center gap-1 text-[11.5px] text-gk-blue hover:underline"
              >
                <Plus size={11} /> правило
              </button>
              {f.rules.length > 0 && <p className="text-[11px] text-gk-dim">Если ни одно правило не подошло — задание не запускается.</p>}
            </div>
          )}
        </Field>

        <button type="button" onClick={() => setExtra((v) => !v)} className="flex items-center gap-1 text-[11.5px] text-gk-muted hover:text-gk-text">
          {extra ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Дополнительно: before_script, after_script, timeout
        </button>
        {extra && (
          <div className="animate-fade-in space-y-3">
            <Field label="before_script">
              <textarea
                value={f.before_script}
                onChange={(e) => set({ before_script: e.target.value })}
                rows={3}
                placeholder={job?.beforeScript?.inherited ? `унаследовано:\n${job.beforeScript.lines.join('\n')}` : ''}
                spellCheck={false}
                className={`${inputCls} resize-y font-mono text-[12px]`}
              />
            </Field>
            <Field label="after_script">
              <textarea
                value={f.after_script}
                onChange={(e) => set({ after_script: e.target.value })}
                rows={2}
                spellCheck={false}
                className={`${inputCls} resize-y font-mono text-[12px]`}
              />
            </Field>
            <Field label="Таймаут">
              <input value={f.timeout} onChange={(e) => set({ timeout: e.target.value })} placeholder="30 minutes" className={inputCls} />
            </Field>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-gk-border px-4 py-2.5">
        {mode === 'edit' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!armDelete) {
                setArmDelete(true);
                setTimeout(() => setArmDelete(false), 4000);
              } else onDelete();
            }}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] transition-colors ${
              armDelete ? 'bg-gk-red text-white' : 'text-gk-red hover:bg-gk-red/10'
            }`}
          >
            <Trash2 size={13} /> {armDelete ? 'Точно удалить?' : 'Удалить'}
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          Отмена
        </button>
        <button
          type="submit"
          disabled={busy || !f.name.trim() || (mode === 'create' && !f.script.trim())}
          className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {mode === 'create' ? 'Добавить задание' : 'Применить'}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-md bg-gk-bg px-2.5 py-1.5 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-gk-muted">{label}</div>
      {children}
    </div>
  );
}
