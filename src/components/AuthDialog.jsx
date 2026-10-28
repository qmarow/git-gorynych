import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, Cloud, Copy, Eye, EyeOff, ExternalLink, FileKey, FolderOpen, KeyRound, Loader2, Lock, Server, Sparkles, Trash2, UserRound } from 'lucide-react';
import { Button, Modal } from './Dialogs.jsx';
import { secretStorageText } from '../lib/platform.js';
import { CLOUD_SERVERS, SERVER_KINDS, kindInfo, kindLabel, prefersToken, sshKeysPage, tokenPage, tokenPlaceholder, tokenScopes } from '../lib/servers.js';

const api = typeof window !== 'undefined' ? window.api : null;

const TABS = [
  { id: 'password', label: 'Логин и пароль', icon: UserRound, https: true },
  { id: 'token', label: 'Токен доступа', icon: KeyRound, https: true },
  { id: 'ssh', label: 'SSH-ключ', icon: FileKey, https: false },
];

/** Что ввести в поле адреса для уже известного сервера: без https:// и без слэша */
const domainOf = (srv) => (srv?.scheme === 'http' ? `http://${srv.host}` : srv?.host ?? '');
const choiceOf = (srv) => (!srv?.hostname ? null : CLOUD_SERVERS.some((c) => c.host === srv.hostname) ? srv.hostname : 'self');

/**
 * Авторизация на сервере: логин и пароль (HTTPS), токен (HTTPS) или SSH-ключ.
 * Секреты уходят в main-процесс и шифруются там; назад приходит только «что сохранено».
 *
 * Два режима:
 *  - remote (target — ответ api.creds.describe): сервер известен из адреса remote или ссылки для клонирования.
 *    Для своего сервера с незнакомым доменом можно выбрать тип (GitLab, GitHub Enterprise, Gitea…) — он определяется
 *    по API сервера и запоминается для домена.
 *  - server (target.mode === 'server'): репозитория ещё нет — пользователь выбирает, где он хранит код:
 *    GitHub, GitLab или свой (Self-Managed) сервер по домену. Данные сохраняются для этого сервера.
 * error — ошибка, из-за которой окно открылось; onSubmit(data) — сохранить и повторить операцию.
 */
export default function AuthDialog({ target, error, formError, busy, actionLabel, onSubmit, onForget, onClose, onKeyDefaults, onSwitchToSsh }) {
  const serverMode = target?.mode === 'server';
  const [choice, setChoice] = useState(() => (serverMode ? choiceOf(target) : null)); // 'github.com' | 'gitlab.com' | 'self'
  const [domain, setDomain] = useState(() => (serverMode && choiceOf(target) === 'self' ? domainOf(target) : ''));
  const [server, setServer] = useState(() => (serverMode && target?.hostname ? target : null)); // описание выбранного сервера
  const [serverError, setServerError] = useState(null);
  const srv = serverMode ? server : target;
  const [kind, setKind] = useState(srv?.kind ?? null);
  const [kindTouched, setKindTouched] = useState(false);
  const [detect, setDetect] = useState(null); // { status: 'loading' | 'ok' | 'fail', kind, version, error }
  const proto = srv?.protocol ?? (serverMode ? 'any' : 'https');
  const anyProto = proto === 'any';
  const initialTab = (() => {
    const s0 = srv?.saved;
    if (s0?.method) return s0.method;
    if (proto === 'ssh') return 'ssh';
    return prefersToken(srv?.kind) || serverMode ? 'token' : 'password';
  })();
  const [tab, setTabRaw] = useState(initialTab);
  const tabTouched = useRef(false);
  const setTab = (id, byUser = false) => {
    if (byUser) tabTouched.current = true;
    setTabRaw(id);
  };
  // Для сервера без репозитория сохранённое берём по выбранному способу: https (логин, токен) или SSH
  const saved = anyProto ? (tab === 'ssh' ? srv?.savedSsh : srv?.savedHttps) ?? null : srv?.saved ?? null;
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
  const wrongProtocol = !anyProto && proto !== 'local' && tabInfo.https !== (proto === 'https');

  /* ---------- Выбор сервера (режим без репозитория) ---------- */
  const seq = useRef(0);
  const lookup = async (input, { fresh = true } = {}) => {
    const n = ++seq.current;
    setServerError(null);
    if (!input?.trim()) {
      setServer(null);
      setDetect(null);
      return;
    }
    const res = await api.creds.describeServer(input);
    if (n !== seq.current) return;
    if (!res.ok) {
      setServer(null);
      setDetect(null);
      setServerError(res.error);
      return;
    }
    const d = res.data;
    setServer(d);
    if (fresh) {
      // Подставить сохранённое для этого сервера
      setUsername(d.savedHttps?.method === 'password' ? d.savedHttps.username ?? '' : '');
      setTokenUser(d.savedHttps?.method === 'token' && d.savedHttps.username !== d.defaultTokenUser ? d.savedHttps.username ?? '' : '');
      if (d.savedSsh?.keyPath) setKeyPath(d.savedSsh.keyPath);
      if (d.saved?.method) setTab(d.saved.method);
    }
    if (!kindTouched || d.kindSaved || d.cloud) {
      setKind(d.kind);
      setKindTouched(false);
    }
  };

  const pickChoice = (id) => {
    setChoice(id);
    if (id === 'self') {
      setServer(null);
      setDetect(null);
      setKind(null);
      setKindTouched(false);
      if (domain.trim()) lookup(domain);
    } else lookup(id);
  };

  // Адрес своего сервера: описание — сразу после паузы в наборе
  useEffect(() => {
    if (!serverMode || choice !== 'self') return undefined;
    const timer = setTimeout(() => lookup(domain), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, choice, serverMode]);

  // Тип своего сервера неизвестен (не выбран раньше и не угадан по имени) — спросить у сервера
  const detectFor = srv && !srv.cloud && !srv.kindSaved && srv.base ? srv.base : null;
  useEffect(() => {
    if (!detectFor || !api?.creds?.detectServer) return undefined;
    let alive = true;
    setDetect({ status: 'loading' });
    api.creds.detectServer(detectFor).then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data.kind) {
        setDetect({ status: 'fail', error: res.ok ? res.data.error : res.error?.message });
        return;
      }
      setDetect({ status: 'ok', kind: res.data.kind, version: res.data.version });
      // Догадка по имени уступает ответу сервера; выбор пользователя — нет
      setKindTouched((touched) => {
        if (!touched) setKind(res.data.kind);
        return touched;
      });
    });
    return () => {
      alive = false;
    };
  }, [detectFor]);

  const chooseKind = (k) => {
    setKind(k);
    setKindTouched(true);
  };

  // Тип стал известен после открытия (ответ API, выбор вручную): GitHub/GitLab не пускают по паролю — сразу «Токен»
  useEffect(() => {
    if (tabTouched.current || saved?.method || proto === 'ssh') return;
    setTabRaw(prefersToken(kind) ? 'token' : serverMode ? 'token' : 'password');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

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
  const needServer = serverMode && (!srv?.hostname || (choice === 'self' && !domain.trim()));
  const canSubmit =
    !busy &&
    !wrongProtocol &&
    !needServer &&
    (tab === 'password'
      ? username.trim() && (password || reuseSecret('password'))
      : tab === 'token'
        ? token.trim() || reuseSecret('token')
        : Boolean(keyPath) && (sshMode !== 'new' || Boolean(created)));

  const submit = () => {
    if (!canSubmit) return;
    // Тип сервера уходит вместе с данными: для своего домена он запоминается
    const extra = {};
    if (srv && !srv.cloud && kind) extra.kind = kind;
    if (serverMode) extra.server = srv.base;
    if (tab === 'password') onSubmit({ method: 'password', username: username.trim(), secret: password, ...extra });
    else if (tab === 'token') onSubmit({ method: 'token', username: tokenUser.trim(), secret: token.trim(), ...extra });
    else onSubmit({ method: 'ssh', keyPath, passphrase, ...extra });
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

  const page = !srv ? null : tab === 'ssh' ? sshKeysPage(kind, srv.base, srv.hostname) : tokenPage(kind, srv.base, srv.hostname);
  const scopes = tokenScopes(kind);
  const kindName = kind ? kindLabel(kind, srv?.cloud) : null;
  const keyEntry = keys?.keys.find((k) => k.path === keyPath) ?? null;

  return (
    <Modal
      title={serverMode ? 'Вход на Git-сервер' : 'Авторизация на сервере'}
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
            {busy ? 'Проверяем…' : actionLabel ?? (serverMode ? 'Войти и сохранить' : 'Войти и повторить')}
          </Button>
        </>
      }
    >
      {/* Куда входим */}
      {serverMode ? (
        <ServerPicker
          choice={choice}
          onChoice={pickChoice}
          domain={domain}
          onDomain={setDomain}
          server={srv}
          error={serverError}
          kindRow={
            choice === 'self' && srv ? <KindRow kind={kind} touched={kindTouched} detect={detect} saved={srv.kindSaved} onChange={chooseKind} /> : null
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-md bg-gk-bg px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] text-gk-strong" data-testid="auth-host">
                {target?.hostname ?? target?.host ?? '—'}
              </span>
              <span className="block truncate font-mono text-[11px] text-gk-dim">{target?.url}</span>
            </span>
            {kindName && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-gk-muted" data-testid="auth-kind">
                <span className="h-2 w-2 rounded-full" style={{ background: kindInfo(kind)?.color }} />
                {kindName}
              </span>
            )}
            <span className="shrink-0 rounded bg-gk-hover px-1.5 text-[10px] uppercase text-gk-muted">{proto === 'ssh' ? 'SSH' : 'HTTPS'}</span>
          </div>
          {/* Свой сервер: тип по домену не очевиден — выбрать (или подтвердить определённый по API) */}
          {target?.hostname && !target.cloud && <KindRow kind={kind} touched={kindTouched} detect={detect} saved={target.kindSaved} onChange={chooseKind} />}
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-gk-red/30 bg-gk-red/10 px-3 py-2 text-[12px] text-gk-text">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-red" />
          <span>
            {error.message}
            {error.details && <span className="mt-0.5 block font-mono text-[11px] text-gk-muted">{error.details.split('\n').filter(Boolean).pop()}</span>}
          </span>
        </div>
      )}

      {serverMode && !srv ? null : (
      <>
      {/* Способ входа */}
      <div role="tablist" className="flex gap-1 rounded-lg bg-gk-sink/20 p-1">
        {TABS.map((t) => {
          const off = !anyProto && proto !== 'local' && t.https !== (proto === 'https');
          const savedHere = anyProto ? (t.id === 'ssh' ? srv?.savedSsh?.method === 'ssh' : srv?.savedHttps?.method === t.id) : saved?.method === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id, true)}
              data-tip={off ? (t.https ? 'Адрес remote — SSH: логин, пароль и токен для него не используются' : 'Адрес remote — HTTPS: SSH-ключ для него не используется') : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                tab === t.id ? 'bg-gk-hover text-gk-strong shadow' : 'text-gk-muted hover:text-gk-text'
              } ${off ? 'opacity-50' : ''}`}
            >
              <t.icon size={13} />
              {t.label}
              {savedHere && <Check size={11} className="text-gk-green" />}
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
          {prefersToken(kind) && (
            <p className="text-[11.5px] leading-relaxed text-gk-dim">
              {kindInfo(kind)?.label} с двухфакторной защитой не принимает обычный пароль для Git — используйте вкладку «Токен доступа».
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
                placeholder={reuseSecret('token') ? '•••••• сохранён — вставьте, чтобы заменить' : tokenPlaceholder(kind)}
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
              placeholder={`по умолчанию: ${defaultTokenUserFor(kind, srv?.defaultTokenUser)}`}
              aria-label="Имя пользователя для токена"
              className={INPUT}
              spellCheck={false}
            />
          </Field>
          <p className="text-[11.5px] leading-relaxed text-gk-dim">
            {scopes ? (
              <>
                Нужны права{' '}
                {scopes.map((sc, i) => (
                  <span key={sc}>
                    {i > 0 && ' и '}
                    <b className="text-gk-muted">{sc}</b>
                  </span>
                ))}
                .
              </>
            ) : (
              'Нужен токен с правом записи в репозиторий.'
            )}
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
            <KeyGenerator host={srv?.hostname} onDefaults={onKeyDefaults ? (type) => onKeyDefaults(type, serverMode ? srv?.base : undefined) : null} onCreated={onCreated} />
          )}

          {created && (
            <CreatedKey
              keyInfo={created}
              submitLabel={actionLabel ?? 'Войти и повторить'}
              page={srv ? sshKeysPage(kind, srv.base, srv.hostname) : null}
              host={srv?.hostname}
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

      {anyProto && tab === 'ssh' && srv?.hostname && (
        <p className="text-[11.5px] leading-relaxed text-gk-dim">
          Ключ будет использоваться для репозиториев с адресом <span className="font-mono text-gk-muted">git@{srv.hostname}:…</span>
        </p>
      )}
      </>
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
        {secretStorageText(undefined, 'Данные')} Они используются только для {srv?.hostname ?? 'этого сервера'}; Git получает их напрямую, без окон входа.
        {saved && <span className="block">Сейчас сохранено: {METHOD_NAMES[saved.method]}{saved.username ? ` (${saved.username})` : ''}{saved.keyPath ? ` — ${saved.keyPath.split(/[\\/]/).pop()}` : ''}.</span>}
      </p>
    </Modal>
  );
}

const METHOD_NAMES = { password: 'логин и пароль', token: 'токен', ssh: 'SSH-ключ' };

/** Логин для токена по умолчанию — как в main-процессе (credentials.defaultTokenUser), но по выбранному сейчас типу */
function defaultTokenUserFor(kind, fallback) {
  if (kind === 'gitlab') return 'oauth2';
  if (kind === 'bitbucket') return 'x-token-auth';
  if (kind) return 'git';
  return fallback ?? 'git';
}

/** Где хранится репозиторий: GitHub, GitLab или свой сервер (Self-Managed) по домену */
function ServerPicker({ choice, onChoice, domain, onDomain, server, error, kindRow }) {
  const [known, setKnown] = useState([]);
  useEffect(() => {
    api?.creds?.servers?.().then((res) => res?.ok && setKnown(res.data.filter((s) => !s.cloud)));
  }, []);
  const options = [
    ...CLOUD_SERVERS.map((c) => ({ id: c.id, title: c.label, sub: c.host, icon: Cloud, color: kindInfo(c.kind)?.color })),
    { id: 'self', title: 'Свой сервер', sub: 'Self-Managed', icon: Server, color: null },
  ];
  return (
    <div className="space-y-2" data-testid="server-picker">
      <div className="text-[11.5px] font-medium text-gk-muted">Где хранится репозиторий</div>
      <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={choice === o.id}
            onClick={() => onChoice(o.id)}
            data-testid={`server-${o.id}`}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
              choice === o.id ? 'border-gk-blue/70 bg-gk-blue/10' : 'border-gk-border hover:bg-gk-hover'
            }`}
          >
            <o.icon size={15} className="shrink-0" style={o.color ? { color: o.color } : undefined} />
            <span className="min-w-0">
              <span className={`block truncate text-[12.5px] ${choice === o.id ? 'text-gk-strong' : 'text-gk-text'}`}>{o.title}</span>
              <span className="block truncate font-mono text-[10.5px] text-gk-dim">{o.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {!choice && <p className="text-[11.5px] leading-relaxed text-gk-dim">Выберите сервис или укажите адрес своего сервера — GitLab, GitHub Enterprise, Gitea и другие.</p>}

      {choice === 'self' && (
        <div className="space-y-2 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
          <Field label="Адрес сервера" hint="домен, можно с портом или ссылкой на проект">
            <input
              autoFocus
              value={domain}
              onChange={(e) => onDomain(e.target.value)}
              placeholder="gitlab.company.ru"
              aria-label="Адрес сервера"
              spellCheck={false}
              data-testid="server-domain"
              className={`${INPUT} font-mono ${error ? 'border-gk-red/60' : ''}`}
            />
          </Field>
          {error && (
            <div className="text-[11.5px] text-gk-red">
              {error.message}
              {error.hint && <span className="text-gk-dim"> — {error.hint}</span>}
            </div>
          )}
          {server && !error && (
            <div className="truncate font-mono text-[11px] text-gk-dim" data-testid="server-base">
              {server.base}
            </div>
          )}
          {known.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-gk-dim">
              Ранее:
              {known.slice(0, 6).map((k) => (
                <button
                  key={k.hostname}
                  onClick={() => onDomain(k.base.startsWith('http://') ? k.base : k.base.replace(/^https:\/\//, ''))}
                  className="rounded-full bg-gk-fg/[0.05] px-2 py-0.5 font-mono text-gk-muted ring-1 ring-gk-border hover:bg-gk-hover hover:text-gk-text"
                >
                  {k.hostname}
                </button>
              ))}
            </div>
          )}
          {kindRow}
        </div>
      )}
    </div>
  );
}

/** Тип своего сервера: определён по API, угадан по имени или выбран вручную */
function KindRow({ kind, touched, detect, saved, onChange }) {
  let note = null;
  if (touched) note = <span className="text-gk-dim">выбран вами</span>;
  else if (detect?.status === 'loading')
    note = (
      <span className="flex items-center gap-1 text-gk-dim">
        <Loader2 size={11} className="animate-spin" /> определяем по ответу сервера…
      </span>
    );
  else if (detect?.status === 'ok' && detect.kind === kind)
    note = (
      <span className="flex items-center gap-1 text-gk-green" data-testid="kind-detected">
        <Check size={11} /> определён по ответу сервера{detect.version ? ` · ${detect.version}` : ''}
      </span>
    );
  else if (detect?.status === 'fail') note = <span className="text-gk-yellow">{detect.error ?? 'Сервер не ответил'} — выберите тип вручную</span>;
  else if (saved) note = <span className="text-gk-dim">запомнен для этого сервера</span>;
  else if (kind) note = <span className="text-gk-dim">по адресу сервера</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]" data-testid="kind-row">
      <span className="text-gk-muted">Тип сервера</span>
      <select
        value={kind ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Тип сервера"
        data-testid="server-kind"
        className="rounded-md border border-gk-border bg-gk-bg px-2 py-1 text-[12px] text-gk-text outline-none focus:border-gk-blue/70"
      >
        {!kind && <option value="">не выбран</option>}
        {SERVER_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.self}
          </option>
        ))}
      </select>
      {note}
    </div>
  );
}
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
