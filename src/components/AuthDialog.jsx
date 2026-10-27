import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Eye, EyeOff, ExternalLink, FileKey, FolderOpen, KeyRound, Loader2, Lock, Sparkles, Trash2, UserRound } from 'lucide-react';
import { Button, Modal } from './Dialogs.jsx';
import { secretStorageText } from '../lib/platform.js';

const api = typeof window !== 'undefined' ? window.api : null;

const TABS = [
  { id: 'password', label: 'Логин и пароль', icon: UserRound, https: true },
  { id: 'token', label: 'Токен доступа', icon: KeyRound, https: true },
  { id: 'ssh', label: 'SSH-ключ', icon: FileKey, https: false },
];

const isGitLab = (host) => /gitlab/i.test(host ?? '');
const isGitHub = (host) => /(^|\.)github\.com$/i.test(host ?? '');

/** Страница создания токена на сервере — чтобы не искать её в настройках */
function tokenPage(target) {
  if (!target?.host || target.protocol !== 'https') return null;
  if (isGitHub(target.hostname)) return 'https://github.com/settings/tokens';
  if (isGitLab(target.hostname)) return `${target.scheme}://${target.host}/-/user_settings/personal_access_tokens`;
  return null;
}
function sshKeysPage(target) {
  if (!target?.hostname) return null;
  if (isGitHub(target.hostname)) return 'https://github.com/settings/keys';
  if (isGitLab(target.hostname)) return `https://${target.hostname}/-/user_settings/ssh_keys`;
  return null;
}

/**
 * Авторизация на remote-сервере: логин и пароль (HTTPS), токен (HTTPS) или SSH-ключ.
 * Секреты уходят в main-процесс и шифруются там; назад приходит только «что сохранено».
 * target — ответ api.creds.describe; error — ошибка, из-за которой окно открылось;
 * onSubmit(data) — сохранить и повторить операцию.
 */
export default function AuthDialog({ target, error, formError, busy, actionLabel, onSubmit, onForget, onClose }) {
  const saved = target?.saved ?? null;
  const proto = target?.protocol ?? 'https';
  const initialTab = saved?.method ?? (proto === 'ssh' ? 'ssh' : isGitLab(target?.hostname) || isGitHub(target?.hostname) ? 'token' : 'password');
  const [tab, setTab] = useState(initialTab);
  const [username, setUsername] = useState(saved?.method === 'password' ? saved.username ?? '' : target?.user ?? '');
  const [password, setPassword] = useState('');
  const [tokenUser, setTokenUser] = useState(saved?.method === 'token' && saved.username !== target?.defaultTokenUser ? saved.username ?? '' : '');
  const [token, setToken] = useState('');
  const [keyPath, setKeyPath] = useState(saved?.keyPath ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [show, setShow] = useState({ password: false, token: false, passphrase: false });
  const [keys, setKeys] = useState(null); // { dir, keys: [...] }
  const [keyNote, setKeyNote] = useState(null); // { type: 'ok' | 'error', text }
  const [generating, setGenerating] = useState(false);

  const tabInfo = TABS.find((t) => t.id === tab);
  const wrongProtocol = proto !== 'local' && tabInfo.https !== (proto === 'https');

  useEffect(() => {
    if (tab !== 'ssh' || keys || !api?.creds) return;
    api.creds.sshKeys().then((res) => {
      if (!res.ok) return setKeys({ dir: '', keys: [] });
      setKeys(res.data);
      if (!keyPath && res.data.keys[0]) setKeyPath(res.data.keys[0].path);
    });
  }, [tab, keys, keyPath]);

  // Сохранённый секрет можно не вводить заново, если меняется только логин
  const reuseSecret = (method) => saved?.method === method && saved.hasSecret;
  const canSubmit =
    !busy &&
    !wrongProtocol &&
    (tab === 'password'
      ? username.trim() && (password || reuseSecret('password'))
      : tab === 'token'
        ? token.trim() || reuseSecret('token')
        : Boolean(keyPath));

  const submit = () => {
    if (!canSubmit) return;
    if (tab === 'password') onSubmit({ method: 'password', username: username.trim(), secret: password });
    else if (tab === 'token') onSubmit({ method: 'token', username: tokenUser.trim(), secret: token.trim() });
    else onSubmit({ method: 'ssh', keyPath, passphrase });
  };

  const pickKey = async () => {
    const file = await api?.creds?.pickKey();
    if (file) setKeyPath(file);
  };

  const generate = async () => {
    setGenerating(true);
    setKeyNote(null);
    const res = await api.creds.generateKey({ passphrase });
    setGenerating(false);
    if (!res.ok) {
      setKeyNote({ type: 'error', text: res.error.message, hint: res.error.hint });
      return;
    }
    setKeys(null); // перечитать список
    setKeyPath(res.data.path);
    setKeyNote({
      type: 'ok',
      text: 'Ключ создан, публичная часть скопирована в буфер обмена. Добавьте её в настройках аккаунта на сервере (SSH Keys) и нажмите «Войти и повторить».',
    });
  };

  const copyPublic = async () => {
    const res = await api.creds.copyPublicKey(keyPath);
    setKeyNote(res.ok ? { type: 'ok', text: 'Публичный ключ скопирован в буфер обмена' } : { type: 'error', text: res.error.message });
  };

  const eye = (field) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => setShow((s) => ({ ...s, [field]: !s[field] }))}
      aria-label={show[field] ? 'Скрыть' : 'Показать'}
      data-tip={show[field] ? 'Скрыть' : 'Показать'}
      className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gk-dim hover:bg-gk-hover hover:text-gk-text"
    >
      {show[field] ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  );

  const page = tab === 'ssh' ? sshKeysPage(target) : tokenPage(target);
  const keyEntry = keys?.keys.find((k) => k.path === keyPath) ?? null;

  return (
    <Modal
      title="Авторизация на сервере"
      icon={Lock}
      iconClass="text-gk-yellow"
      onClose={busy ? () => {} : onClose}
      width={520}
      footer={
        <>
          {saved && onForget && (
            <Button onClick={onForget} disabled={busy} className="mr-auto text-gk-muted" data-tip="Удалить сохранённые данные для этого сервера">
              <Trash2 size={13} /> Забыть
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="blue" onClick={submit} disabled={!canSubmit} data-testid="auth-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {busy ? 'Проверяем…' : actionLabel ?? 'Войти и повторить'}
          </Button>
        </>
      }
    >
      {/* Куда входим */}
      <div className="flex items-center gap-2 rounded-md bg-gk-bg px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] text-white" data-testid="auth-host">
            {target?.hostname ?? target?.host ?? '—'}
          </span>
          <span className="block truncate font-mono text-[11px] text-gk-dim">{target?.url}</span>
        </span>
        <span className="shrink-0 rounded bg-gk-hover px-1.5 text-[10px] uppercase text-gk-muted">{proto === 'ssh' ? 'SSH' : 'HTTPS'}</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px] text-gk-text">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-red" />
          <span>
            {error.message}
            {error.details && <span className="mt-0.5 block font-mono text-[11px] text-gk-muted">{error.details.split('\n').filter(Boolean).pop()}</span>}
          </span>
        </div>
      )}

      {/* Способ входа */}
      <div role="tablist" className="flex gap-1 rounded-lg bg-black/20 p-1">
        {TABS.map((t) => {
          const off = proto !== 'local' && t.https !== (proto === 'https');
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-tip={off ? (t.https ? 'Адрес remote — SSH: логин, пароль и токен для него не используются' : 'Адрес remote — HTTPS: SSH-ключ для него не используется') : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                tab === t.id ? 'bg-gk-hover text-white shadow' : 'text-gk-muted hover:text-gk-text'
              } ${off ? 'opacity-50' : ''}`}
            >
              <t.icon size={13} />
              {t.label}
              {saved?.method === t.id && <Check size={11} className="text-gk-green" />}
            </button>
          );
        })}
      </div>

      {wrongProtocol && (
        <div className="rounded-md border border-gk-yellow/30 bg-gk-yellow/10 px-3 py-2 text-[12px] leading-relaxed text-gk-text">
          {proto === 'https'
            ? 'Адрес remote начинается с https:// — SSH-ключ для него не используется. Войдите логином и паролем или токеном, либо смените адрес remote на SSH (git@…).'
            : 'Адрес remote — SSH (git@…): для него нужен SSH-ключ. Логин, пароль и токен работают только с адресами https://.'}
        </div>
      )}

      {tab === 'password' && (
        <div className="space-y-2.5">
          <Field label="Имя пользователя (Username)">
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="Имя пользователя" className={INPUT} spellCheck={false} />
          </Field>
          <Field label="Пароль (Password)">
            <div className="relative">
              <input
                type={show.password ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={reuseSecret('password') ? '•••••• сохранён — введите, чтобы заменить' : ''}
                aria-label="Пароль"
                className={`${INPUT} pr-9`}
              />
              {eye('password')}
            </div>
          </Field>
          {(isGitLab(target?.hostname) || isGitHub(target?.hostname)) && (
            <p className="text-[11.5px] leading-relaxed text-gk-dim">
              {isGitHub(target?.hostname) ? 'GitHub' : 'GitLab'} с двухфакторной защитой не принимает обычный пароль для Git — используйте вкладку «Токен доступа».
            </p>
          )}
        </div>
      )}

      {tab === 'token' && (
        <div className="space-y-2.5">
          <Field label="Personal Access Token">
            <div className="relative">
              <input
                autoFocus
                type={show.token ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={reuseSecret('token') ? '•••••• сохранён — вставьте, чтобы заменить' : isGitHub(target?.hostname) ? 'ghp_…' : 'glpat-…'}
                aria-label="Токен"
                className={`${INPUT} pr-9 font-mono`}
                spellCheck={false}
              />
              {eye('token')}
            </div>
          </Field>
          <Field label="Имя пользователя" hint="необязательно">
            <input
              value={tokenUser}
              onChange={(e) => setTokenUser(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={`по умолчанию: ${target?.defaultTokenUser ?? 'oauth2'}`}
              aria-label="Имя пользователя для токена"
              className={INPUT}
              spellCheck={false}
            />
          </Field>
          <p className="text-[11.5px] leading-relaxed text-gk-dim">
            Нужны права {isGitHub(target?.hostname) ? <b className="text-gk-muted">repo</b> : <><b className="text-gk-muted">read_repository</b> и <b className="text-gk-muted">write_repository</b></>}.
            {page && (
              <button onClick={() => api?.openExternal(page)} className="ml-1 inline-flex items-center gap-0.5 text-gk-blue hover:underline">
                Создать токен <ExternalLink size={10} />
              </button>
            )}
          </p>
        </div>
      )}

      {tab === 'ssh' && (
        <div className="space-y-2.5">
          <Field label="Приватный ключ">
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {keys === null ? (
                <div className="flex items-center gap-2 text-[12px] text-gk-dim">
                  <Loader2 size={12} className="animate-spin" /> Ищем ключи в ~/.ssh…
                </div>
              ) : keys.keys.length === 0 ? (
                <div className="text-[12px] text-gk-dim">В {keys.dir || '~/.ssh'} ключей не найдено — выберите файл или создайте новый ключ.</div>
              ) : (
                keys.keys.map((k) => (
                  <button
                    key={k.path}
                    onClick={() => setKeyPath(k.path)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                      keyPath === k.path ? 'border-gk-blue/70 bg-gk-blue/10' : 'border-gk-border bg-gk-bg/60 hover:bg-gk-hover'
                    }`}
                  >
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${keyPath === k.path ? 'border-gk-blue' : 'border-gk-border'}`}>
                      {keyPath === k.path && <span className="h-1.5 w-1.5 rounded-full bg-gk-blue" />}
                    </span>
                    <span className="flex-1 truncate font-mono text-[12px] text-gk-text">{k.name}</span>
                    {k.type && <span className="shrink-0 rounded bg-white/5 px-1.5 font-mono text-[10.5px] text-gk-muted">{k.type}</span>}
                    {k.comment && <span className="max-w-[40%] shrink truncate text-[11px] text-gk-dim">{k.comment}</span>}
                  </button>
                ))
              )}
            </div>
          </Field>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gk-dim" data-tip={keyPath || undefined}>
              {keyPath || 'ключ не выбран'}
            </span>
            <Button onClick={pickKey} className="shrink-0 py-1 text-[12px]">
              <FolderOpen size={12} /> Файл…
            </Button>
            {keyEntry?.hasPub && (
              <Button onClick={copyPublic} className="shrink-0 py-1 text-[12px]" data-tip="Скопировать публичную часть (.pub) — для добавления на сервер">
                <Copy size={12} /> .pub
              </Button>
            )}
          </div>
          <Field label="Пароль ключа (Passphrase)" hint="если ключ защищён паролем">
            <div className="relative">
              <input
                type={show.passphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={saved?.method === 'ssh' && saved.hasPassphrase && saved.keyPath === keyPath ? '•••••• сохранён' : ''}
                aria-label="Пароль ключа"
                className={`${INPUT} pr-9`}
              />
              {eye('passphrase')}
            </div>
          </Field>
          <div className="flex items-center gap-2 rounded-md border border-dashed border-gk-border px-3 py-2">
            <Sparkles size={13} className="shrink-0 text-gk-blue" />
            <span className="flex-1 text-[11.5px] leading-relaxed text-gk-muted">
              Нет ключа? Создадим новый ed25519 в ~/.ssh{passphrase ? ' с указанным паролем' : ''} и скопируем публичную часть в буфер.
            </span>
            <Button onClick={generate} disabled={generating} className="shrink-0 py-1 text-[12px]">
              {generating ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Создать ключ
            </Button>
          </div>
          {keyNote && (
            <div className={`rounded-md px-3 py-2 text-[11.5px] leading-relaxed ${keyNote.type === 'ok' ? 'bg-gk-green/10 text-gk-text' : 'bg-gk-red/10 text-gk-text'}`}>
              {keyNote.text}
              {keyNote.hint && <span className="block text-gk-muted">{keyNote.hint}</span>}
              {keyNote.type === 'ok' && page && (
                <button onClick={() => api?.openExternal(page)} className="ml-1 inline-flex items-center gap-0.5 text-gk-blue hover:underline">
                  Открыть SSH Keys <ExternalLink size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {formError && (
        <div className="flex items-start gap-2 rounded-md border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-red" />
          <span>
            {formError.message}
            {formError.hint && <span className="block text-gk-muted">{formError.hint}</span>}
          </span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-gk-dim">
        {secretStorageText(undefined, 'Данные')} Они используются только для {target?.hostname ?? 'этого сервера'}; Git получает их напрямую, без окон входа.
        {saved && <span className="block">Сейчас сохранено: {METHOD_NAMES[saved.method]}{saved.username ? ` (${saved.username})` : ''}{saved.keyPath ? ` — ${saved.keyPath.split(/[\\/]/).pop()}` : ''}.</span>}
      </p>
    </Modal>
  );
}

const METHOD_NAMES = { password: 'логин и пароль', token: 'токен', ssh: 'SSH-ключ' };
const INPUT =
  'w-full rounded-md border border-gk-border bg-gk-bg px-2.5 py-1.5 text-[13px] text-gk-text outline-none placeholder:text-gk-dim focus:border-gk-blue/70';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-[11.5px] font-medium text-gk-muted">
        {label}
        {hint && <span className="font-normal text-gk-dim">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
