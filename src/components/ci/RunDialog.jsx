// Запуск пайплайна с параметрами: ветка, workflow (GitHub/Gitea), inputs из workflow_dispatch / spec:inputs,
// переменные с описанием из .gitlab-ci.yml, custom-пайплайны Bitbucket и свои KEY=VALUE.
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Loader2, Play, Plus, Trash2, Zap } from 'lucide-react';
import { Button, ErrorBox, Modal } from '../Dialogs.jsx';
import { Toggle } from './common.jsx';
import { t as tr, tj } from '../../i18n/index.js';

const api = window.api;

function Field({ input, value, onChange }) {
  const label = (
    <span className="mb-1 flex items-baseline gap-1.5">
      <span className="font-mono text-[12px] text-gk-text">{input.key}</span>
      {input.required && <span className="text-[11px] text-gk-red">{tr('обязательно')}</span>}
      {input.description && <span className="truncate text-[11.5px] text-gk-dim">— {input.description}</span>}
    </span>
  );
  if (input.type === 'boolean') {
    return <Toggle checked={value === true || value === 'true'} onChange={onChange} label={input.key} hint={input.description} testid={`run-input-${input.key}`} />;
  }
  if (input.options?.length) {
    return (
      <label className="block" data-testid={`run-input-${input.key}`}>
        {label}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue">
          {input.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block" data-testid={`run-input-${input.key}`}>
      {label}
      <input
        type={input.type === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={input.default ? String(input.default) : ''}
        className="w-full rounded-md bg-gk-bg px-2 py-1.5 font-mono text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
      />
    </label>
  );
}

const initValues = (inputs) => Object.fromEntries((inputs ?? []).map((i) => [i.key, i.default ?? (i.type === 'boolean' ? false : '')]));

export default function RunDialog({ repoPath, opts, caps, providerLabel, branches = [], currentBranch, defaultWorkflow, onClose, onStarted }) {
  const [form, setForm] = useState({ loading: true, data: null, error: null });
  const [ref, setRef] = useState(currentBranch ?? '');
  const [workflow, setWorkflow] = useState(null);
  const [values, setValues] = useState({});
  const [vars, setVars] = useState({}); // переменные с описанием (GitLab)
  const [custom, setCustom] = useState([]); // [{ key, value }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.cicd.runForm(repoPath, opts).then((res) => {
      if (!res.ok) return setForm({ loading: false, data: null, error: res.error });
      const d = res.data;
      setForm({ loading: false, data: d, error: null });
      const wfs = d.workflows ?? [];
      const first = wfs.find((w) => w.dispatchable && (!defaultWorkflow || w.path === defaultWorkflow)) ?? wfs.find((w) => w.dispatchable) ?? null;
      setWorkflow(first);
      setValues(initValues(first?.inputs ?? d.inputs));
      setVars(Object.fromEntries((d.variables ?? []).map((v) => [v.key, v.default ?? ''])));
    });
  }, [repoPath, opts, defaultWorkflow]);

  const d = form.data;
  const inputs = d?.kind === 'gitlab' ? d.inputs ?? [] : workflow?.inputs ?? [];
  const missing = inputs.filter((i) => i.required && i.type !== 'boolean' && !String(values[i.key] ?? '').trim()).map((i) => i.key);
  const needsWorkflow = d && (d.kind === 'github' || d.kind === 'gitea');
  const branchList = useMemo(() => [...new Set([currentBranch, ...branches].filter(Boolean))], [branches, currentBranch]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const params = { ref: ref.trim() };
    if (needsWorkflow) params.workflow = workflow?.path ?? null;
    if (d.kind === 'bitbucket') {
      params.workflow = workflow?.value ?? null;
      params.variables = [...Object.entries(values).map(([key, value]) => ({ key, value: String(value) })), ...custom];
    } else if (d.kind === 'gitlab') {
      params.inputs = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
      params.variables = [...Object.entries(vars).map(([key, value]) => ({ key, value })), ...custom];
    } else {
      params.inputs = values;
    }
    params.variables = (params.variables ?? []).filter((v) => String(v.key ?? '').trim());
    const res = await api.cicd.run(repoPath, params, opts);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onStarted(res.data, params);
  };

  const canSubmit = d && ref.trim() && !missing.length && (!needsWorkflow || workflow) && !busy;

  return (
    <Modal
      title={tr('Запустить пайплайн · {0}', providerLabel)}
      icon={Zap}
      iconClass="text-gk-green"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{tr('Отмена')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit} data-testid="run-submit">
            {tj('{0} Запустить', [busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />])}</Button>
        </>
      }
    >
      {form.loading && (
        <div className="flex items-center gap-2 text-gk-muted">
          {tj('{0} Читаем параметры запуска из конфига…', [<Loader2 size={13} className="animate-spin" />])}</div>
      )}
      {form.error && <ErrorBox error={form.error} />}
      {d && (
        <div className="space-y-3" data-testid="run-dialog">
          <label className="block">
            {tj('<0>{1} Ветка</0>{2}{3}', [<span className="mb-1 flex items-center gap-1 text-[12px] text-gk-muted" />, <GitBranch size={12} />, <input
              list="run-branches"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              data-testid="run-ref"
              className="w-full rounded-md bg-gk-bg px-2 py-1.5 font-mono text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
            />, <datalist id="run-branches">
              {branchList.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>])}
          </label>

          {(needsWorkflow || d.kind === 'bitbucket') && (
            <label className="block">
              <span className="mb-1 block text-[12px] text-gk-muted">{d.kind === 'bitbucket' ? tr('Пайплайн') : 'Workflow'}</span>
              <select
                data-testid="run-workflow"
                value={workflow ? workflow.path ?? workflow.value ?? '' : ''}
                onChange={(e) => {
                  const w = d.workflows.find((x) => (x.path ?? x.value ?? '') === e.target.value);
                  setWorkflow(w);
                  setValues(initValues(w?.inputs));
                }}
                className="w-full rounded-md bg-gk-bg px-2 py-1.5 text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
              >
                {d.workflows.map((w) => (
                  <option key={w.path ?? w.value ?? 'default'} value={w.path ?? w.value ?? ''} disabled={!w.dispatchable}>
                    {w.name}
                    {w.path ? ` — ${w.path}` : ''}
                    {!w.dispatchable ? tr(' (нет on: workflow_dispatch)') : ''}
                  </option>
                ))}
              </select>
              {needsWorkflow && !d.workflows.some((w) => w.dispatchable) && (
                <p className="mt-1 text-[11.5px] text-gk-yellow" data-testid="run-no-dispatch">
                  {tr('Ни в одном workflow нет «on: workflow_dispatch» — вручную их не запустить. Добавьте этот триггер в файл и отправьте его на сервер.')}</p>
              )}
            </label>
          )}

          {inputs.length > 0 && (
            <div className="space-y-2.5 rounded-lg border border-gk-border p-3" data-testid="run-inputs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{d.kind === 'bitbucket' ? tr('Переменные пайплайна') : tr('Входные параметры (inputs)')}</div>
              {inputs.map((i) => (
                <Field key={i.key} input={i} value={values[i.key]} onChange={(v) => setValues((s) => ({ ...s, [i.key]: v }))} />
              ))}
            </div>
          )}

          {d.kind === 'gitlab' && d.variables?.length > 0 && (
            <div className="space-y-2.5 rounded-lg border border-gk-border p-3" data-testid="run-prefilled">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gk-dim">{tr('Переменные из .gitlab-ci.yml')}</div>
              {d.variables.map((v) => (
                <Field key={v.key} input={{ ...v, type: 'string' }} value={vars[v.key]} onChange={(x) => setVars((s) => ({ ...s, [v.key]: x }))} />
              ))}
            </div>
          )}

          {d.allowCustomVariables && caps?.canRunWithVariables && (
            <div className="space-y-1.5" data-testid="run-custom">
              <div className="flex items-center">
                {tj('<0>Свои переменные окружения (KEY=VALUE)</0>{1}', [<span className="flex-1 text-[12px] text-gk-muted" />, <button onClick={() => setCustom((c) => [...c, { key: '', value: '' }])} className="flex items-center gap-1 text-[12px] text-gk-blue hover:underline" data-testid="run-add-var">
                  {tj('{0} Переменная', [<Plus size={12} />])}</button>])}
              </div>
              {custom.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={v.key}
                    placeholder="KEY"
                    onChange={(e) => setCustom((c) => c.map((x, k) => (k === i ? { ...x, key: e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() } : x)))}
                    onPaste={(e) => {
                      // Вставка «KEY=VALUE» сразу в оба поля
                      const t = e.clipboardData.getData('text');
                      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(t);
                      if (m) {
                        e.preventDefault();
                        setCustom((c) => c.map((x, k) => (k === i ? { key: m[1], value: m[2] } : x)));
                      }
                    }}
                    className="w-40 rounded-md bg-gk-bg px-2 py-1 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
                  />
                  <span className="text-gk-dim">=</span>
                  <input
                    value={v.value}
                    placeholder={tr('значение')}
                    onChange={(e) => setCustom((c) => c.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}
                    className="min-w-0 flex-1 rounded-md bg-gk-bg px-2 py-1 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
                  />
                  <button onClick={() => setCustom((c) => c.filter((_, k) => k !== i))} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-red" aria-label={tr('Убрать')}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!caps?.canRunWithVariables && caps?.why?.canRunWithVariables && <p className="text-[11.5px] leading-snug text-gk-dim">{caps.why.canRunWithVariables}</p>}
          {missing.length > 0 && <p className="text-[11.5px] text-gk-yellow">{tj('Заполните: {0}', [missing.join(', ')])}</p>}
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}
