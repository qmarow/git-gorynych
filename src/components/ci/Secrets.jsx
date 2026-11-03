// Секреты и переменные репозитория (GitHub Actions, Gitea/Forgejo, Bitbucket): список, создание и обновление через API.
// Значения секретов сервер не отдаёт — их можно только задать заново.
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Lock, Pencil, Plus, Save, Trash2, Variable } from 'lucide-react';
import { relativeTime } from '../../lib/format.js';
import { Button, ErrorBox, Modal } from '../Dialogs.jsx';
import { ActionButton, ConfirmAction, ErrorNote, Loading, Toggle } from './common.jsx';
import { t, tj } from '../../i18n/index.js';

const api = window.api;

export default function Secrets({ repoPath, opts, caps, providerLabel, notify }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    const res = await api.cicd.secrets(repoPath, opts);
    setState(res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: null, error: res.error });
  }, [repoPath, opts]);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (s) => {
    const res = await api.cicd.deleteSecret(repoPath, s, opts);
    if (!res.ok) notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
    else notify?.({ type: 'success', title: s.secret ? t('Секрет {0} удалён', s.key) : t('Переменная {0} удалена', s.key) });
    load();
  };

  if (state.loading) return <Loading text={t('Загружаем секреты и переменные…')} />;
  if (state.error) return <ErrorNote error={state.error} />;
  const list = state.data.secrets;
  const secrets = list.filter((s) => s.secret);
  const variables = list.filter((s) => !s.secret);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="secrets">
      <div className="mb-3 flex items-start gap-3">
        <p className="flex-1 text-[12px] leading-relaxed text-gk-dim">
          {tj('Секреты и переменные репозитория в {0}. Значения секретов сервер не показывает — их можно только заменить. Переменные видны всем, у кого есть доступ к репозиторию.', [providerLabel])}</p>
        <ActionButton icon={Plus} tone="green" onClick={() => setForm({ original: null, secret: true })} data-testid="secret-add">
          {t('Добавить')}</ActionButton>
      </div>
      <Group title={t('Секреты')} icon={Lock} items={secrets} empty={t('Секретов нет')} onEdit={(s) => setForm({ original: s, secret: true })} onDelete={remove} />
      <Group title={t('Переменные')} icon={Variable} items={variables} empty={t('Переменных нет')} onEdit={(s) => setForm({ original: s, secret: false })} onDelete={remove} />
      {form && (
        <SecretForm
          initial={form}
          caps={caps}
          repoPath={repoPath}
          opts={opts}
          onClose={() => setForm(null)}
          onSaved={(key, secret) => {
            notify?.({ type: 'success', title: secret ? t('Секрет {0} сохранён', key) : t('Переменная {0} сохранена', key) });
            setForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Group({ title, icon: Icon, items, empty, onEdit, onDelete }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">
        <Icon size={12} /> {title} <span className="font-normal">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gk-border px-3 py-3 text-[12px] text-gk-dim">{empty}</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gk-border">
          {items.map((s) => (
            <div key={`${s.secret}:${s.key}`} className="group flex items-center gap-2 border-b border-gk-border/60 px-3 py-2 last:border-0" data-testid="secret-row" data-key={s.key}>
              {s.secret ? <KeyRound size={13} className="shrink-0 text-gk-yellow" /> : <Variable size={13} className="shrink-0 text-gk-blue" />}
              <span className="font-mono text-[12.5px] text-gk-text">{s.key}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gk-dim">{s.secret ? '••••••••' : s.value}</span>
              {s.updatedAt && <span className="shrink-0 text-[11px] text-gk-dim">{relativeTime(s.updatedAt)}</span>}
              <button onClick={() => onEdit(s)} className="rounded p-1 text-gk-dim opacity-0 hover:bg-gk-hover hover:text-gk-text group-hover:opacity-100" aria-label={t('Изменить')} data-testid="secret-edit">
                <Pencil size={12} />
              </button>
              <ConfirmAction icon={Trash2} label="" confirmLabel={t('Удалить?')} onConfirm={() => onDelete(s)} testid="secret-delete" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SecretForm({ initial, repoPath, opts, onClose, onSaved }) {
  const o = initial.original;
  const [key, setKey] = useState(o?.key ?? '');
  const [value, setValue] = useState(o && !o.secret ? o.value ?? '' : '');
  const [secret, setSecret] = useState(initial.secret);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (value.length > 0 || !secret);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await api.cicd.saveSecret(repoPath, { key, value, secret, original: o }, opts);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onSaved(key, secret);
  };

  return (
    <Modal
      title={o ? t('Изменить {0}', o.key) : t('Новый секрет или переменная')}
      icon={secret ? KeyRound : Variable}
      onClose={onClose}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>{t('Отмена')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={save} data-testid="secret-save">
            {tj('{0} Сохранить', [busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />])}</Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="secret-form">
        <label className="block">
          {tj('<0>Имя</0>{1}', [<span className="mb-1 block text-[12px] text-gk-muted" />, <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase())}
            placeholder="DEPLOY_TOKEN"
            data-testid="secret-key"
            className="w-full rounded-md bg-gk-bg px-2 py-1.5 font-mono text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />])}
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-gk-muted">{o?.secret ? t('Новое значение (старое сервер не показывает)') : t('Значение')}</span>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            data-testid="secret-value"
            className="w-full resize-y rounded-md bg-gk-bg px-2 py-1.5 font-mono text-[12.5px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />
        </label>
        <Toggle checked={secret} onChange={setSecret} label={t('Секрет (значение скрыто)')} hint={t('Секрет шифруется и не показывается в логах. Переменная видна в настройках и логах.')} testid="secret-kind" />
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
