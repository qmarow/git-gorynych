import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { t, tj } from '../../i18n/index.ts';

/** Правило rules, которое форма умеет править (только if/when/allow_failure) */
interface RuleRow {
  if: string;
  when: string;
  allow_failure?: boolean;
}

/** Скрипт задания: строки и унаследован ли он */
interface Script {
  lines: string[];
  inherited?: boolean;
}

/** Задание GitLab из загрузчика CI (`gorynych-ci-linter::load`): то, что читает форма */
export interface FormJob {
  id?: string;
  name: string;
  stage?: string;
  /** Ключи, заданные в самом задании (не унаследованные) */
  own?: string[];
  image?: string | null;
  imageInherited?: string | null;
  script?: Script | null;
  scriptRaw?: string[] | null;
  beforeScript?: Script | null;
  afterScript?: Script | null;
  when?: string | null;
  allowFailure?: boolean;
  needsRaw?: string[] | null;
  tags?: string[] | null;
  environment?: { name?: string } | null;
  timeout?: string | number | null;
  rulesRaw?: RuleRow[] | null;
  rulesEditable?: boolean;
}

interface FormState {
  name: string;
  stage: string;
  image: string;
  script: string;
  before_script: string;
  after_script: string;
  when: string;
  allow_failure: boolean;
  needs: string[] | null;
  tags: string;
  environment: string;
  timeout: string | number;
  rules: RuleRow[];
}

/** Операция правки файла (`gorynych-ci-linter::edit::ops`) */
export type EditOp = Record<string, unknown> & { type: string };

interface JobFormProps {
  job?: FormJob | null;
  stages: string[];
  allJobs: { name: string }[];
  mode: 'create' | 'edit';
  presetStage?: string | null;
  busy?: boolean;
  onSubmit: (ops: EditOp[], name?: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const WHEN_OPTIONS: [string, string][] = [
  ['on_success', t('if-previous-stages-succeed-default')],
  ['manual', t('manually-with-button-in-gitlab')],
  ['always', t('always-even-if-something-failed')],
  ['on_failure', t('only-if-something-failed')],
  ['delayed', t('delayed')],
  ['never', t('dont-run')],
];
const RULE_WHEN: [string, string][] = [
  ['on_success', t('run-4')],
  ['manual', t('manually')],
  ['always', t('always')],
  ['never', t('dont-run-2')],
  ['delayed', t('delayed-2')],
];

const lines = (v: string[] | null | undefined) => (v ?? []).join('\n');
const splitList = (v: unknown) =>
  String(v ?? '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Форма задания GitLab CI: создание и правка без ручного YAML.
 * Пустое поле = «как унаследовано» (из default, extends или глобальных настроек).
 */
export default function JobForm({ job, stages, allJobs, mode, presetStage, busy, onSubmit, onDelete, onCancel }: JobFormProps) {
  const own = new Set(job?.own ?? []);
  const initial = useMemo(
    (): FormState => ({
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
  const set = (patch: Partial<FormState>) => setF((v) => ({ ...v, ...patch }));

  const rulesEditable = mode === 'create' || job?.rulesEditable !== false;
  const otherJobs = allJobs.filter((j) => j.name !== job?.name).map((j) => j.name);
  const stageOptions = [...new Set([...stages, f.stage].filter(Boolean))];

  // Что поменялось — только эти поля и записываем в файл
  const changes = () => {
    const out: Record<string, unknown> = {};
    const cmp = <V,>(key: string, value: V, initValue: V, toYaml: (v: V) => unknown) => {
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

  const submit = (e?: FormEvent) => {
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
    const ops: EditOp[] = [];
    const name = f.name.trim();
    if (name !== job!.name) ops.push({ type: 'renameJob', from: job!.name, to: name });
    const fields = changes();
    if (Object.keys(fields).length) ops.push({ type: 'setJob', name, fields });
    onSubmit(ops, name);
  };

  const inherited = (label: string, value: unknown) => (value ? t('inherited', value) : label);

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3 text-[12.5px]">
        <Field label={t('job-name')}>
          <input
            autoFocus={mode === 'create'}
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t('for-example-unit-tests')}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('stage-5')}>
            <input list="ci-stage-options" value={f.stage} onChange={(e) => set({ stage: e.target.value })} className={inputCls} />
            <datalist id="ci-stage-options">
              {stageOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={t('docker-image')}>
            <input
              value={f.image}
              onChange={(e) => set({ image: e.target.value })}
              placeholder={inherited('node:20', job?.imageInherited ? job.image : null)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label={t('commands-script-one-per-line')}>
          <textarea
            value={f.script}
            onChange={(e) => set({ script: e.target.value })}
            rows={Math.min(10, Math.max(3, f.script.split('\n').length + 1))}
            placeholder={job?.script?.lines?.length && !own.has('script') ? t('inherited-2', job.script.lines.join('\n')) : 'npm ci\nnpm test'}
            spellCheck={false}
            className={`${inputCls} resize-y font-mono text-[12px] leading-5`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('when-to-run')}>
            <select value={f.when} onChange={(e) => set({ when: e.target.value })} className={inputCls}>
              {WHEN_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('environment-environment')}>
            <input value={f.environment} onChange={(e) => set({ environment: e.target.value })} placeholder="production" className={inputCls} />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-gk-text">
          {tj('may-fail-error-wont-stop', [<input type="checkbox" checked={f.allow_failure} onChange={(e) => set({ allow_failure: e.target.checked })} className="accent-[var(--color-gk-green)]" />])}</label>

        {/* needs */}
        <Field label={t('run-after-needs')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {f.needs === null ? (
              <span className="text-[11.5px] text-gk-dim">{t('in-stage-order')}</span>
            ) : f.needs.length === 0 ? (
              <span className="text-[11.5px] text-gk-dim">{t('right-away-without-waiting-for')}</span>
            ) : (
              f.needs.map((n) => (
                <span key={n} className="flex items-center gap-1 rounded bg-gk-blue/15 px-1.5 py-0.5 font-mono text-[11px] text-gk-blue">
                  {n}
                  <button type="button" onClick={() => set({ needs: f.needs!.filter((x) => x !== n) })} className="hover:text-gk-strong">
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
              <option value="">{t('add-3')}</option>
              {otherJobs
                .filter((n) => !(f.needs ?? []).includes(n))
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              <option value="__stage">{t('in-stage-order-no-needs')}</option>
              <option value="__now">{t('right-away-needs')}</option>
            </select>
          </div>
        </Field>

        <Field label={t('runner-tags-comma-separated')}>
          <input
            value={f.tags}
            onChange={(e) => set({ tags: e.target.value })}
            placeholder={job?.tags?.length && !own.has('tags') ? t('inherited', job.tags.join(', ')) : 'docker, linux'}
            className={inputCls}
          />
        </Field>

        {/* rules */}
        <Field label={t('run-rules-rules-first-matching')}>
          {!rulesEditable ? (
            <p className="text-[11.5px] text-gk-dim">{t('there-are-complex-rules-here')}</p>
          ) : (
            <div className="space-y-1.5">
              {f.rules.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={r.if}
                    onChange={(e) => set({ rules: f.rules.map((x, k) => (k === i ? { ...x, if: e.target.value } : x)) })}
                    placeholder={t('ci-commit-branch-main-empty')}
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
                    title={t('delete-rule')}
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
                {tj('rule-2', [<Plus size={11} />])}</button>
              {f.rules.length > 0 && <p className="text-[11px] text-gk-dim">{t('if-no-rule-matches-job')}</p>}
            </div>
          )}
        </Field>

        <button type="button" onClick={() => setExtra((v) => !v)} className="flex items-center gap-1 text-[11.5px] text-gk-muted hover:text-gk-text">
          {tj('more-before-script-after-script', [extra ? <ChevronDown size={12} /> : <ChevronRight size={12} />])}</button>
        {extra && (
          <div className="animate-fade-in space-y-3">
            <Field label="before_script">
              <textarea
                value={f.before_script}
                onChange={(e) => set({ before_script: e.target.value })}
                rows={3}
                placeholder={job?.beforeScript?.inherited ? t('inherited-2', job.beforeScript.lines.join('\n')) : ''}
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
            <Field label={t('timeout')}>
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
            <Trash2 size={13} /> {armDelete ? t('delete-for-sure') : t('delete-2')}
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
          {t('cancel')}</button>
        <button
          type="submit"
          disabled={busy || !f.name.trim() || (mode === 'create' && !f.script.trim())}
          className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {mode === 'create' ? t('add-job') : t('apply')}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-md bg-gk-bg px-2.5 py-1.5 text-[12.5px] text-gk-text outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue';

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-gk-muted">{label}</div>
      {children}
    </div>
  );
}
