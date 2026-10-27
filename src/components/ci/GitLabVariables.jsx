import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, Eye, EyeOff, FileText, Loader2, Lock, Pencil, Plus, Save, Trash2, Variable, X } from 'lucide-react';

const api = window.api;

/**
 * Переменные CI/CD проекта в GitLab: просмотр, добавление, изменение, удаление.
 * Значения запрашиваются по одному и только по явному действию.
 */
export default function GitLabVariables({ repoPath, opts, canWrite, notify }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [revealed, setRevealed] = useState({}); // key|scope -> { value, hidden } | 'loading'
  const [form, setForm] = useState(null); // { original: {key, scope} | null, initial }
  const [armDelete, setArmDelete] = useState(null);

  const load = useCallback(() => {
    api.gitlab.variables(repoPath, opts).then((res) =>
      setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error }),
    );
  }, [repoPath, opts]);
  useEffect(load, [load]);

  const reveal = async (v) => {
    const id = `${v.key}|${v.scope}`;
    if (revealed[id] && revealed[id] !== 'loading') {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealed((r) => ({ ...r, [id]: 'loading' }));
    const res = await api.gitlab.variableValue(repoPath, { key: v.key, scope: v.scope }, opts);
    setRevealed((r) => ({ ...r, [id]: res.ok ? res.data : { error: res.error.message } }));
  };

  const remove = async (v) => {
    const id = `${v.key}|${v.scope}`;
    if (armDelete !== id) {
      setArmDelete(id);
      setTimeout(() => setArmDelete((x) => (x === id ? null : x)), 4000);
      return;
    }
    setArmDelete(null);
    const res = await api.gitlab.deleteVariable(repoPath, { key: v.key, scope: v.scope }, opts);
    if (!res.ok) notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    else notify?.({ type: 'success', title: `Переменная ${v.key} удалена` });
    load();
  };

  if (state.loading) return <Center><Loader2 size={14} className="animate-spin" /> Загружаем переменные…</Center>;
  if (state.error) {
    const forbidden = state.error.code === 'FORBIDDEN';
    return (
      <div className="m-4 rounded-lg border border-gk-red/30 bg-gk-red/10 px-3 py-2.5 text-[12px]">
        <div className="flex items-center gap-1.5 font-medium text-gk-text">
          <AlertTriangle size={13} className="text-gk-red" />
          {forbidden ? 'Переменные CI/CD видят только Maintainer и Owner проекта' : state.error.message}
        </div>
        {state.error.hint && <div className="mt-1 pl-5 text-gk-muted">{state.error.hint}</div>}
      </div>
    );
  }
  const vars = state.data.variables;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-start gap-3">
        <p className="flex-1 text-[12px] leading-relaxed text-gk-dim">
          Переменные из настроек проекта (Settings → CI/CD → Variables). Значение запрашивается у GitLab, только когда вы нажимаете на
          глаз, и нигде не сохраняется.
        </p>
        <button
          disabled={!canWrite}
          title={canWrite ? 'Добавить переменную' : 'Нужен токен со scope «api»'}
          onClick={() => setForm({ original: null, initial: null })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-gk-green/15 px-2.5 py-1.5 text-[12px] font-medium text-gk-green transition-colors enabled:hover:bg-gk-green/25 disabled:opacity-35"
        >
          <Plus size={13} /> Переменная
        </button>
      </div>

      {vars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-dim">В проекте нет переменных</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gk-border">
          <div className={`${GRID} border-b border-gk-border bg-gk-fg/[0.03] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim`}>
            <span>Имя</span>
            <span>Значение</span>
            <span>Окружение</span>
            <span>Флаги</span>
            <span />
          </div>
          {vars.map((v, i) => {
            const id = `${v.key}|${v.scope}`;
            const r = revealed[id];
            return (
              <div
                key={id}
                className={`${GRID} group animate-fade-in items-center border-b border-gk-border/60 px-3 py-2 text-[12px] last:border-0`}
                style={{ animationDelay: `${Math.min(i, 20) * 15}ms` }}
                title={v.description ?? undefined}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {v.type === 'file' ? <FileText size={12} className="shrink-0 text-gk-dim" /> : <Variable size={12} className="shrink-0 text-gk-dim" />}
                  <span className="truncate font-mono text-gk-blue">{v.key}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {v.hidden ? (
                    <span className="italic text-gk-dim">скрыто в GitLab — значение не выдаётся</span>
                  ) : r && r !== 'loading' ? (
                    r.error ? (
                      <span className="text-gk-red">{r.error}</span>
                    ) : r.hidden ? (
                      <span className="italic text-gk-dim">скрыто в GitLab</span>
                    ) : (
                      <span className="min-w-0 flex-1 break-all font-mono text-gk-text">{r.value === '' ? <i className="text-gk-dim">пусто</i> : r.value}</span>
                    )
                  ) : (
                    <span className="flex-1 font-mono tracking-widest text-gk-dim">{v.empty ? '—' : '••••••••'}</span>
                  )}
                  {!v.hidden && !v.empty && (
                    <button
                      onClick={() => reveal(v)}
                      title={r && r !== 'loading' ? 'Скрыть' : 'Показать значение'}
                      className="shrink-0 rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text"
                    >
                      {r === 'loading' ? <Loader2 size={12} className="animate-spin" /> : r ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                  {r && r !== 'loading' && !r.error && !r.hidden && (
                    <button onClick={() => navigator.clipboard?.writeText(r.value)} title="Скопировать" className="shrink-0 rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
                      <Copy size={12} />
                    </button>
                  )}
                </span>
                <span className="truncate font-mono text-[11px] text-gk-muted">{v.scope}</span>
                <span className="flex flex-wrap gap-1">
                  {v.protected && <Flag icon={Lock} title="Только для защищённых веток и тегов">protected</Flag>}
                  {v.masked && <Flag title="Скрывается в логах заданий">masked</Flag>}
                  {v.hidden && <Flag title="Значение нельзя посмотреть после сохранения">hidden</Flag>}
                  {v.raw && <Flag title="Без подстановки $ПЕРЕМЕННЫХ">raw</Flag>}
                  {v.type === 'file' && <Flag title="Передаётся в задание как путь к файлу">file</Flag>}
                </span>
                <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {canWrite && (
                    <>
                      <button
                        title="Изменить"
                        onClick={() => setForm({ original: { key: v.key, scope: v.scope }, initial: { ...v, value: r && r !== 'loading' && !r.error && !r.hidden ? r.value : undefined } })}
                        className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        title={armDelete === id ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'}
                        onClick={() => remove(v)}
                        className={`rounded p-1 ${armDelete === id ? 'bg-gk-red text-white opacity-100' : 'text-gk-dim hover:bg-gk-red/15 hover:text-gk-red'}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <VariableForm
          repoPath={repoPath}
          opts={opts}
          original={form.original}
          initial={form.initial}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            setRevealed({});
            notify?.({ type: 'success', title: msg });
            load();
          }}
        />
      )}
    </div>
  );
}

const GRID = 'grid grid-cols-[minmax(150px,1.2fr)_minmax(180px,2fr)_100px_minmax(130px,1fr)_56px] gap-3';

function VariableForm({ repoPath, opts, original, initial, onClose, onSaved }) {
  const editing = Boolean(original);
  const [v, setV] = useState({
    key: initial?.key ?? '',
    value: initial?.value ?? '',
    type: initial?.type ?? 'env_var',
    scope: initial?.scope ?? '*',
    protected: initial?.protected ?? false,
    masked: initial?.masked ?? false,
    hidden: initial?.hidden ?? false,
    raw: initial?.raw ?? false,
    description: initial?.description ?? '',
  });
  // При правке значение можно не трогать: если поле не меняли — останется прежнее
  const [valueTouched, setValueTouched] = useState(!editing || initial?.value !== undefined);
  const [showValue, setShowValue] = useState(!editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const maskProblem = v.masked && valueTouched && (v.value.length < 8 || /\s/.test(v.value) || /[^A-Za-z0-9@:.~\-_+/=]/.test(v.value));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const variable = { ...v, key: v.key.trim(), scope: v.scope.trim() || '*' };
    if (!valueTouched) delete variable.value;
    const res = await api.gitlab.saveVariable(repoPath, { original, variable }, opts);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(editing ? `Переменная ${variable.key} сохранена` : `Переменная ${variable.key} добавлена`);
  };

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[10vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="glass-strong w-[520px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex items-center gap-2 border-b border-gk-border px-4 py-3">
          <Variable size={16} className="text-gk-blue" />
          <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">{editing ? `Переменная ${original.key}` : 'Новая переменная'}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-[12.5px]">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="Имя">
              <input
                autoFocus={!editing}
                value={v.key}
                onChange={(e) => set({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                placeholder="DEPLOY_TOKEN"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field label="Тип">
              <select value={v.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>
                <option value="env_var">Переменная</option>
                <option value="file">Файл</option>
              </select>
            </Field>
          </div>
          <Field label={editing && !valueTouched ? 'Значение (не меняется, пока не начнёте вводить)' : 'Значение'}>
            <div className="relative">
              <textarea
                value={valueTouched ? v.value : ''}
                onChange={(e) => {
                  setValueTouched(true);
                  set({ value: e.target.value });
                }}
                rows={v.type === 'file' ? 5 : 2}
                placeholder={editing && !valueTouched ? (initial?.hidden ? 'скрытое значение — введите новое' : '•••••••• (прежнее значение)') : ''}
                spellCheck={false}
                className={`${inputCls} resize-y pr-8 font-mono text-[12px] ${showValue ? '' : '[-webkit-text-security:disc]'}`}
              />
              <button
                type="button"
                onClick={() => setShowValue((s) => !s)}
                title={showValue ? 'Скрыть' : 'Показать'}
                className="absolute right-1.5 top-1.5 rounded p-1 text-gk-dim hover:text-gk-text"
              >
                {showValue ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            {maskProblem && (
              <div className="mt-1 text-[11px] text-gk-yellow">
                Для masked: одна строка, не короче 8 символов, только буквы, цифры и @ : . ~ - _ + / =
              </div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Окружение">
              <input value={v.scope} onChange={(e) => set({ scope: e.target.value })} placeholder="* (все)" className={`${inputCls} font-mono`} />
            </Field>
            <Field label="Описание">
              <input value={v.description} onChange={(e) => set({ description: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
            <Check checked={v.protected} onChange={(x) => set({ protected: x })} label="Protected" hint="Только для защищённых веток и тегов" />
            <Check checked={v.masked} onChange={(x) => set({ masked: x, hidden: x ? v.hidden : false })} label="Masked" hint="Скрывать значение в логах" />
            <Check checked={v.raw} onChange={(x) => set({ raw: x })} label="Raw" hint="Не подставлять $ПЕРЕМЕННЫЕ внутри" />
            <Check
              checked={v.hidden}
              disabled={editing}
              onChange={(x) => set({ hidden: x, masked: x || v.masked })}
              label="Hidden"
              hint={editing ? 'Задаётся только при создании' : 'Значение потом нельзя будет посмотреть'}
            />
          </div>
          {error && (
            <div className="rounded-md border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px]">
              <div className="font-medium text-gk-text">{error.message}</div>
              {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
            </div>
          )}
          {editing && (original.key !== v.key || (original.scope ?? '*') !== (v.scope.trim() || '*')) && (
            <div className="text-[11px] text-gk-dim">Имя или окружение изменились — GitLab создаст новую переменную и удалит старую.</div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gk-border px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || !v.key.trim() || (!editing && !v.value)}
            className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {editing ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </div>
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

function Check({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--color-gk-green)]" />
      <span>
        <span className="text-gk-text">{label}</span>
        <span className="block text-[11px] text-gk-dim">{hint}</span>
      </span>
    </label>
  );
}

function Flag({ children, title, icon: Icon }) {
  return (
    <span title={title} className="flex items-center gap-0.5 rounded bg-gk-fg/5 px-1.5 text-[10px] text-gk-muted">
      {Icon && <Icon size={9} />}
      {children}
    </span>
  );
}

function Center({ children }) {
  return <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-gk-muted">{children}</div>;
}
