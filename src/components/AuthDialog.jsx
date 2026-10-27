import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, Copy, Eye, EyeOff, ExternalLink, FileKey, FolderOpen, KeyRound, Loader2, Lock, Sparkles, Trash2, UserRound } from 'lucide-react';
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
export default function AuthDialog({ target, error, formError, busy, actionLabel, onSubmit, onForget, onClose, onKeyDefaults, onSwitchToSsh }) {
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
  const [sshMode, setSshMode] = useState(null); // 'existing' | 'new' — по умолчанию решается по наличию ключей
  const [created, setCreated] = useState(null); // только что созданный ключ: { path, name, publicKey, type, fingerprint }
  const [switching, setSwitching] = useState(false);

  const tabInfo = TABS.find((t) => t.id === tab);
  const wrongProtocol = proto !== 'local' && tabInfo.https !== (proto === 'https');

  useEffect(() => {
    if (tab !== 'ssh' || keys || !api?.creds) return;
    api.creds.sshKeys().then((res) => {
      if (!res.ok) return setKeys({ dir: '', keys: [] });
      setKeys(res.data);
      if (!keyPath && res.data.keys[0]) setKeyPath(res.data.keys[0].path);
      // Ключей нет — сразу форма создания нового
      setSshMode((m) => m ?? (res.data.keys.length ? 'existing' : 'new'));
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
        : Boolean(keyPath) && (sshMode !== 'new' || Boolean(created)));

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

  // Новый ключ создан: выбрать его, передать пароль ключа, перечитать список
  const onCreated = (res, pass) => {
    setCreated(res);
    setKeyPath(res.path);
    setPassphrase(pass);
    setKeys(null);
    setKeyNote(null);
  };

  const switchToSsh = async () => {
    setSwitching(true);
    const res = await onSwitchToSsh();
    setSwitching(false);
    if (!res?.ok) setKeyNote({ type: 'error', text: res?.error?.message ?? 'Не удалось сменить адрес remote', hint: res?.error?.hint });
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
          <span className="block truncate font-mono text-[13px] text-gk-strong" data-testid="auth-host">
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
      <div role="tablist" className="flex gap-1 rounded-lg bg-gk-sink/20 p-1">
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
                tab === t.id ? 'bg-gk-hover text-gk-strong shadow' : 'text-gk-muted hover:text-gk-text'
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
            ? 'Адрес remote начинается с https:// — SSH-ключ для него не используется. Войдите логином и паролем или токеном, либо переведите remote на SSH.'
            : 'Адрес remote — SSH (git@…): для него нужен SSH-ключ. Логин, пароль и токен работают только с адресами https://.'}
          {proto === 'https' && tab === 'ssh' && onSwitchToSsh && sshUrl(target) && (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gk-muted" data-tip={sshUrl(target)}>
                → {sshUrl(target)}
              </span>
              <Button onClick={switchToSsh} disabled={switching || busy} className="shrink-0 py-1 text-[12px]" data-testid="switch-to-ssh">
                {switching ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />} Перевести remote на SSH
              </Button>
            </div>
          )}
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
          {/* Выбрать имеющийся ключ или создать новый */}
          <div role="radiogroup" className="flex gap-1 text-[12px]">
            {[
              ['existing', 'Существующий ключ', FileKey],
              ['new', 'Создать новый ключ', Sparkles],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                role="radio"
                aria-checked={(sshMode ?? 'existing') === id}
                onClick={() => {
                  setSshMode(id);
                  if (id === 'existing') setCreated(null); // созданный ключ уже выбран в списке
                }}
                data-testid={`ssh-mode-${id}`}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                  (sshMode ?? 'existing') === id ? 'border-gk-blue/70 bg-gk-blue/10 text-gk-strong' : 'border-gk-border text-gk-muted hover:text-gk-text'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {sshMode === 'new' && !created && (
            <KeyGenerator host={target?.hostname} onDefaults={onKeyDefaults} onCreated={onCreated} />
          )}

          {created && (
            <CreatedKey
              keyInfo={created}
              submitLabel={actionLabel ?? 'Войти и повторить'}
              page={sshKeysPage(target)}
              host={target?.hostname}
              onAnother={() => {
                setCreated(null);
                setSshMode('new');
              }}
            />
          )}

          {sshMode !== 'new' && !created && (
            <>
              <Field label="Приватный ключ">
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  {keys === null ? (
                    <div className="flex items-center gap-2 text-[12px] text-gk-dim">
                      <Loader2 size={12} className="animate-spin" /> Ищем ключи в ~/.ssh…
                    </div>
                  ) : keys.keys.length === 0 ? (
                    <div className="text-[12px] text-gk-dim">
                      В {keys.dir || '~/.ssh'} ключей не найдено — выберите файл или{' '}
                      <button onClick={() => setSshMode('new')} className="text-gk-blue hover:underline">
                        создайте новый ключ
                      </button>
                      .
                    </div>
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
                        {k.type && <span className="shrink-0 rounded bg-gk-fg/5 px-1.5 font-mono text-[10.5px] text-gk-muted">{k.type}</span>}
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
            </>
          )}

          {keyNote && (
            <div className={`rounded-md px-3 py-2 text-[11.5px] leading-relaxed ${keyNote.type === 'ok' ? 'bg-gk-green/10 text-gk-text' : 'bg-gk-red/10 text-gk-text'}`}>
              {keyNote.text}
              {keyNote.hint && <span className="block text-gk-muted">{keyNote.hint}</span>}
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

/** SSH-вариант https-адреса: https://host/group/app.git → git@host:group/app.git */
function sshUrl(target) {
  if (target?.protocol !== 'https' || !target.url) return null;
  try {
    const p = new URL(target.url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    return p ? `git@${target.hostname}:${p}.git` : null;
  } catch {
    return null;
  }
}

const KEY_TYPES = [
  { id: 'ed25519', label: 'Ed25519', hint: 'рекомендуется' },
  { id: 'rsa', label: 'RSA 4096', hint: 'для старых серверов' },
];

/** Форма нового SSH-ключа: тип, имя файла, комментарий, пароль ключа с повтором */
function KeyGenerator({ host, onDefaults, onCreated }) {
  const [type, setType] = useState('ed25519');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [comment, setComment] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Имя файла и комментарий по умолчанию: стандартное имя (или с именем сервера, если занято) и email из git config
  useEffect(() => {
    if (!onDefaults) return undefined;
    let alive = true;
    onDefaults(type).then((res) => {
      if (!alive || !res?.ok) return;
      if (!nameTouched) setName(res.data.name ?? '');
      if (!commentTouched && res.data.comment) setComment(res.data.comment);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const mismatch = pass && pass2 !== pass;
  const badName = /[\\/]|^\.|\.pub$/i.test(name.trim());
  const canCreate = !busy && !mismatch && !badName;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setErr(null);
    const res = await api.creds.generateKey({ type, name: name.trim(), comment: comment.trim(), passphrase: pass, host });
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else onCreated(res.data, pass);
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3" data-testid="key-generator">
      <div className="flex gap-1">
        {KEY_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            aria-pressed={type === t.id}
            className={`flex flex-1 flex-col items-center rounded-md border px-2 py-1 ${
              type === t.id ? 'border-gk-blue/70 bg-gk-blue/10 text-gk-strong' : 'border-gk-border text-gk-muted hover:text-gk-text'
            }`}
          >
            <span className="font-mono text-[12px]">{t.label}</span>
            <span className="text-[10.5px] text-gk-dim">{t.hint}</span>
          </button>
        ))}
      </div>
      <Field label="Имя файла">
        <div className={`flex items-center rounded-md border bg-gk-bg ${badName ? 'border-gk-red/60' : 'border-gk-border focus-within:border-gk-blue/70'}`}>
          <span className="pl-2.5 font-mono text-[12px] text-gk-dim">~/.ssh/</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            aria-label="Имя файла ключа"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 font-mono text-[12.5px] text-gk-text outline-none"
          />
        </div>
      </Field>
      <Field label="Комментарий" hint="обычно email — чтобы узнать ключ в списке на сервере">
        <input
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setCommentTouched(true);
          }}
          aria-label="Комментарий ключа"
          spellCheck={false}
          className={INPUT}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Пароль ключа" hint="необязательно">
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              aria-label="Пароль нового ключа"
              className={`${INPUT} pr-9`}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Скрыть' : 'Показать'}
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gk-dim hover:bg-gk-hover hover:text-gk-text"
            >
              {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </Field>
        <Field label="Повтор пароля">
          <input
            type={showPass ? 'text' : 'password'}
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            disabled={!pass}
            aria-label="Повтор пароля ключа"
            className={`${INPUT} ${mismatch && pass2 ? 'border-gk-red/60' : ''} disabled:opacity-40`}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] leading-relaxed text-gk-dim">
          {mismatch ? (
            <span className="text-gk-red">Пароли не совпадают</span>
          ) : badName ? (
            <span className="text-gk-red">Только имя файла — без папок и .pub</span>
          ) : pass ? (
            'Пароль ключа сохранится зашифрованным — вводить его при каждой операции не придётся.'
          ) : (
            'Без пароля ключ защищён только правами на файл. Существующие ключи не перезаписываются.'
          )}
        </span>
        <Button variant="blue" onClick={create} disabled={!canCreate} className="shrink-0 whitespace-nowrap py-1 text-[12px]" data-testid="key-create">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Создать ключ
        </Button>
      </div>
      {err && (
        <div className="rounded-md bg-gk-red/10 px-3 py-2 text-[11.5px] text-gk-text">
          {err.message}
          {err.hint && <span className="block text-gk-muted">{err.hint}</span>}
          {err.details && <span className="block font-mono text-[10.5px] text-gk-dim">{err.details.split('\n').filter(Boolean).pop()}</span>}
        </div>
      )}
    </div>
  );
}

/** Ключ создан: публичная часть, копирование и куда её добавить */
function CreatedKey({ keyInfo, page, host, onAnother, submitLabel }) {
  const [copied, setCopied] = useState(true); // при создании ключ уже скопирован в буфер
  const copy = async () => {
    const res = await api.creds.copyPublicKey(keyInfo.path);
    setCopied(res.ok);
  };
  return (
    <div className="space-y-2 rounded-lg border border-gk-green/30 bg-gk-green/[0.06] p-3" data-testid="key-created">
      <div className="flex items-center gap-2 text-[12.5px] text-gk-text">
        <Check size={14} className="shrink-0 text-gk-green" />
        <span className="min-w-0 flex-1 truncate">
          Ключ <b className="font-mono">{keyInfo.name}</b> создан
          <span className="text-gk-dim"> · {keyInfo.type === 'rsa' ? 'RSA 4096' : 'Ed25519'}</span>
        </span>
        <button onClick={onAnother} className="shrink-0 text-[11px] text-gk-dim hover:text-gk-text">
          ещё один
        </button>
      </div>
      <textarea
        readOnly
        value={keyInfo.publicKey}
        onFocus={(e) => e.target.select()}
        rows={3}
        aria-label="Публичный ключ"
        className="w-full resize-none rounded-md border border-gk-border bg-gk-bg px-2.5 py-1.5 font-mono text-[11px] leading-snug text-gk-muted outline-none [overflow-wrap:anywhere]"
      />
      {keyInfo.fingerprint && <div className="font-mono text-[10.5px] text-gk-dim">{keyInfo.fingerprint}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy} className="py-1 text-[12px]">
          {copied ? <Check size={12} className="text-gk-green" /> : <Copy size={12} />} {copied ? 'Скопирован в буфер' : 'Скопировать'}
        </Button>
        {page && (
          <Button onClick={() => api?.openExternal(page)} className="py-1 text-[12px]" data-testid="open-ssh-keys">
            <ExternalLink size={12} /> Открыть SSH Keys на {host}
          </Button>
        )}
      </div>
      <ol className="list-decimal space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-gk-muted">
        <li>Добавьте публичный ключ на сервере: {page ? 'кнопка выше' : 'настройки профиля → SSH Keys'} → вставьте из буфера → Add key.</li>
        <li>
          Нажмите <b className="text-gk-text">«{submitLabel}»</b> — программа запомнит ключ для {host ?? 'этого сервера'}.
        </li>
      </ol>
    </div>
  );
}
