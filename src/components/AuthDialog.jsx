import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, CircleCheck, Cloud, Copy, Eye, EyeOff, ExternalLink, FileKey, FolderGit2, FolderOpen, KeyRound, Loader2, Lock, Server, Sparkles, Trash2, UserRound, Workflow } from 'lucide-react';
import { Button, Modal } from './Dialogs.jsx';
import { secretStorageText } from '../lib/platform.js';
import { CLOUD_SERVERS, SERVER_KINDS, kindInfo, kindLabel, prefersToken, sshKeysPage, tokenPage, tokenPlaceholder, tokenScopes } from '../lib/servers.js';

const api = typeof window !== 'undefined' ? window.api : null;

const TABS = [
  { id: 'password', label: 'Логин и пароль', icon: UserRound, https: true },
  { id: 'token', label: 'Токен доступа', icon: KeyRound, https: true },
  { id: 'ssh', label: 'SSH-ключ', icon: FileKey, https: false },
];

/* ---------- Адрес репозитория: сервер + путь ---------- */

/** → { protocol: 'https' | 'ssh' | null, scheme, host (с портом), hostname, user, path } */
export function parseRepoUrl(raw) {
  const u = String(raw ?? '').trim();
  if (/^https?:\/\//i.test(u)) {
    try {
      const x = new URL(u);
      return { protocol: 'https', scheme: x.protocol.slice(0, -1), host: x.host.toLowerCase(), hostname: x.hostname.toLowerCase(), user: x.username || null, path: decodeURIComponent(x.pathname).replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') };
    } catch {
      return { protocol: 'https', scheme: 'https', host: null, hostname: null, user: null, path: '' };
    }
  }
  const ssh = /^ssh:\/\/(?:([^@/]+)@)?([^:/]+)(?::\d+)?(\/.*)?$/i.exec(u);
  if (ssh) return { protocol: 'ssh', scheme: null, host: ssh[2].toLowerCase(), hostname: ssh[2].toLowerCase(), user: ssh[1] ?? null, path: (ssh[3] ?? '').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, ''), sshUrl: true };
  const scp = /^(?:([^@/\\\s]+)@)?([^:/\\\s]+):(?!\/\/)(.*)$/.exec(u);
  if (scp && scp[2].length > 1) return { protocol: 'ssh', scheme: null, host: scp[2].toLowerCase(), hostname: scp[2].toLowerCase(), user: scp[1] ?? null, path: scp[3].replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') };
  return { protocol: null, scheme: null, host: null, hostname: null, user: null, path: '' };
}

/**
 * Адрес репозитория на сервере domain («host», «host:порт», «http://host») с протоколом и путём from.
 * Пустой домен — пустой адрес (путь хранится отдельно и вернётся, когда домен введут).
 */
export function buildRepoUrl(domain, { protocol = 'https', user = null, path = '' } = {}) {
  const d = String(domain ?? '').trim().replace(/\/+$/, '');
  const host = d.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!host) return '';
  const tail = path ? `${path}.git` : '';
  if (protocol === 'ssh') return `${user ?? 'git'}@${host.replace(/:\d+$/, '')}:${tail}`;
  return `${/^http:\/\//i.test(d) ? 'http' : 'https'}://${host}/${tail}`;
}

/** https ↔ SSH для того же репозитория */
const toSsh = (raw) => {
  const p = parseRepoUrl(raw);
  return p.hostname && p.path ? `git@${p.hostname}:${p.path}.git` : null;
};
const toHttps = (raw) => {
  const p = parseRepoUrl(raw);
  return p.hostname && p.path ? `https://${p.hostname}/${p.path}.git` : null;
};
const sameUrl = (a, b) => String(a ?? '').trim().replace(/\/+$/, '') === String(b ?? '').trim().replace(/\/+$/, '');
const choiceOfHost = (hostname) => (!hostname ? null : CLOUD_SERVERS.some((c) => c.host === hostname) ? hostname : 'self');
const domainOfUrl = (raw) => {
  const p = parseRepoUrl(raw);
  return p.scheme === 'http' ? `http://${p.host}` : p.host ?? '';
};

/**
 * Авторизация репозитория: логин и пароль (HTTPS), токен (HTTPS) или SSH-ключ — для этого репозитория,
 * а не для всего сервера. Секреты уходят в main-процесс и шифруются там; назад приходит только «что сохранено».
 *
 * Вверху — где хранится репозиторий: GitHub, GitLab или свой (Self-Managed) сервер с доменом и типом.
 * Выбор сервера меняет адрес remote (сменится при сохранении); у репозитория без remote — он будет добавлен.
 * canEditRemote — адрес можно менять (открытый репозиторий); при клонировании адрес задан в окне клонирования.
 * target — ответ api.creds.describe; error — ошибка, из-за которой окно открылось; onSubmit(data) — сохранить и повторить.
 */
export default function AuthDialog({ target, error, formError, notice, busy, actionLabel, canEditRemote = false, onSubmit, onForget, onClose, onKeyDefaults }) {
  const originalUrl = target?.url ?? '';
  const [url, setUrl] = useState(originalUrl);
  const parsed = parseRepoUrl(url);
  const [choice, setChoice] = useState(() => choiceOfHost(parseRepoUrl(originalUrl).hostname));
  const [domain, setDomain] = useState(() => (choiceOfHost(parseRepoUrl(originalUrl).hostname) === 'self' ? domainOfUrl(originalUrl) : ''));
  // Описание текущего адреса: сохранённый вход этого репозитория, тип сервера; для исходного адреса — из target
  const [described, setDescribed] = useState(() => (target?.url ? target : null));
  // Окно получило свежее описание (после «Забыть» или неудачной попытки) — показать его
  useEffect(() => {
    if (target?.url) setDescribed(target);
  }, [target]);
  // Протокол и путь проекта — переживают смену сервера (в т. ч. пока домен своего сервера не введён)
  const last = useRef((() => {
    const p0 = parseRepoUrl(originalUrl);
    return { protocol: p0.protocol ?? 'https', user: p0.user, path: p0.path };
  })());
  const srv = described && sameUrl(described.url, url) ? described : null;
  const changed = canEditRemote && !sameUrl(url, originalUrl);
  const validUrl = Boolean(parsed.hostname && parsed.path);
  const [kind, setKind] = useState(target?.kind ?? null);
  const [kindTouched, setKindTouched] = useState(false);
  const [detect, setDetect] = useState(null); // { status: 'loading' | 'ok' | 'fail', kind, version, error }
  const proto = parsed.protocol ?? 'https';
  const cloud = CLOUD_SERVERS.some((c) => c.host === parsed.hostname);
  const base = parsed.hostname ? (parsed.protocol === 'https' ? `${parsed.scheme}://${parsed.host}` : srv?.base ?? `https://${parsed.hostname}`) : null;
  const initialTab = (() => {
    const s0 = target?.saved;
    if (s0?.method) return s0.method;
    if (proto === 'ssh') return 'ssh';
    return prefersToken(target?.kind) ? 'token' : 'password';
  })();
  const [tab, setTabRaw] = useState(initialTab);
  const tabTouched = useRef(false);
  const setTab = (id, byUser = false) => {
    if (byUser) tabTouched.current = true;
    setTabRaw(id);
  };
  const saved = srv?.saved ?? null;
  const [username, setUsername] = useState(saved?.method === 'password' ? saved.username ?? '' : target?.user ?? '');
  const [password, setPassword] = useState('');
  const [tokenUser, setTokenUser] = useState(saved?.method === 'token' && saved.username !== target?.defaultTokenUser ? saved.username ?? '' : '');
  const [token, setToken] = useState('');
  const [keyPath, setKeyPath] = useState(saved?.keyPath ?? '');
  const [passphrase, setPassphrase] = useState('');
  // Пароль и SSH-ключ API GitLab не принимает — токен для пайплайнов хранится в этой же авторизации
  const [apiToken, setApiToken] = useState('');
  const [show, setShow] = useState({ password: false, token: false, passphrase: false });
  const [keys, setKeys] = useState(null); // { dir, keys: [...] }
  const [keyNote, setKeyNote] = useState(null); // { type: 'ok' | 'error', text }
  const [sshMode, setSshMode] = useState(null); // 'existing' | 'new' — по умолчанию решается по наличию ключей
  const [created, setCreated] = useState(null); // только что созданный ключ: { path, name, publicKey, type, fingerprint }

  /* ---------- Адрес изменился (другой сервер, домен, путь): что сохранено для него, тип сервера ---------- */
  useEffect(() => {
    if (!validUrl || (described && sameUrl(described.url, url))) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      const res = await api.creds.describe(null, url.trim());
      if (!alive || !res.ok) return;
      const d = res.data;
      setDescribed(d);
      // Подставить сохранённое для этого репозитория
      if (d.saved?.method === 'password') setUsername(d.saved.username ?? '');
      if (d.saved?.method === 'token') setTokenUser(d.saved.username !== d.defaultTokenUser ? d.saved.username ?? '' : '');
      if (d.saved?.keyPath) setKeyPath(d.saved.keyPath);
      if (d.saved?.method && !tabTouched.current) setTabRaw(d.saved.method);
      setKindTouched((touched) => {
        if (!touched || d.kindSaved || d.cloud) {
          setKind(d.kind);
          setDetect(null);
          return false;
        }
        return touched;
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, validUrl]);

  // Где хранится: облако — сразу адрес на нём; свой сервер — домен вводится ниже
  const pickChoice = (id) => {
    if (!canEditRemote && id !== choice) return;
    setChoice(id);
    setDetect(null);
    setKindTouched(false);
    if (id === 'self') {
      const own = choiceOfHost(parsed.hostname) === 'self' ? domainOfUrl(url) : '';
      setDomain(own);
      setKind(own ? srv?.kind ?? null : null);
      if (!own) setUrl('');
    } else {
      setUrl(buildRepoUrl(id, last.current));
      setKind(CLOUD_SERVERS.find((c) => c.host === id)?.kind ?? null);
    }
  };
  const changeDomain = (d) => {
    setDomain(d);
    setUrl(buildRepoUrl(d, last.current));
  };
  // Адрес правят целиком — выбор сервера подстраивается
  const changeUrl = (next) => {
    setUrl(next);
    const p = parseRepoUrl(next);
    if (p.protocol) last.current = { protocol: p.protocol, user: p.user, path: p.path || last.current.path };
    const c = choiceOfHost(p.hostname);
    if (c) setChoice(c);
    if (c === 'self') setDomain(domainOfUrl(next));
  };

const tabInfo = TABS.find((t) => t.id === tab);
  const wrongProtocol = proto !== 'local' && tabInfo.https !== (proto === 'https');

  // Тип своего сервера неизвестен (не выбран раньше) — спросить у сервера
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

  // Адрес сменился на SSH / HTTPS — подходящая вкладка (если пользователь сам вкладку не выбирал)
  useEffect(() => {
    if (tabTouched.current || !parsed.protocol) return;
    if (proto === 'ssh') setTabRaw('ssh');
    else setTabRaw((t) => (t === 'ssh' ? (prefersToken(kind) ? 'token' : 'password') : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proto]);

  // Тип стал известен после открытия (ответ API, выбор вручную): GitHub/GitLab не пускают по паролю — сразу «Токен»
  useEffect(() => {
    if (tabTouched.current || saved?.method || proto === 'ssh') return;
    setTabRaw(prefersToken(kind) ? 'token' : 'password');
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
  const canSubmit =
    !busy &&
    !wrongProtocol &&
    validUrl &&
    (tab === 'password'
      ? username.trim() && (password || reuseSecret('password'))
      : tab === 'token'
        ? token.trim() || reuseSecret('token')
        : Boolean(keyPath) && (sshMode !== 'new' || Boolean(created)));

  const submit = () => {
    if (!canSubmit) return;
    // Тип сервера уходит вместе с данными: для своего домена он запоминается
    const extra = {};
    if (!cloud && kind) extra.kind = kind;
    // Другой сервер / адрес — remote репозитория сменится (или добавится, если его не было)
    if (canEditRemote && (changed || !originalUrl)) extra.remoteUrl = url.trim();
    if (kind === 'gitlab' && apiToken.trim()) extra.apiToken = apiToken.trim();
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

  const page = !base ? null : tab === 'ssh' ? sshKeysPage(kind, base, parsed.hostname) : tokenPage(kind, base, parsed.hostname);
  const scopes = tokenScopes(kind);
  const kindName = kind ? kindLabel(kind, cloud) : null;
  const repoName = parsed.path ? parsed.path.split('/').pop() : null;
  const keyEntry = keys?.keys.find((k) => k.path === keyPath) ?? null;

  return (
    <Modal
      title="Авторизация репозитория"
      icon={Lock}
      iconClass="text-gk-yellow"
      onClose={busy ? () => {} : onClose}
      width={520}
      footer={
        <>
          {saved && onForget && !changed && (
            <Button
              onClick={onForget}
              disabled={busy}
              className="mr-auto text-gk-muted"
              data-tip={saved.shared ? `Удалить общий вход для всех репозиториев на ${parsed.hostname}` : 'Удалить сохранённый вход этого репозитория'}
            >
              <Trash2 size={13} /> Забыть
            </Button>
          )}
          <Button onClick={onClose} disabled={busy} data-testid="auth-cancel">
            {notice ? 'Готово' : 'Отмена'}
          </Button>
          <Button variant="blue" onClick={submit} disabled={!canSubmit} data-testid="auth-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {busy ? 'Проверяем…' : actionLabel ?? 'Войти и повторить'}
          </Button>
        </>
      }
    >
      {/* Репозиторий */}
      <div className="flex items-center gap-2.5 rounded-md bg-gk-bg px-3 py-2" data-testid="auth-repo">
        <FolderGit2 size={16} className="shrink-0 text-gk-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            {parsed.hostname ? (
              <span className="truncate font-mono text-[13px] text-gk-strong" data-testid="auth-host">
                {parsed.hostname}
              </span>
            ) : (
              <span className="truncate text-[13px] text-gk-muted">{originalUrl ? 'Сервер не указан' : 'Репозиторий без remote'}</span>
            )}
            {repoName && <span className="truncate text-[12px] text-gk-muted" data-testid="auth-repo-path">{parsed.path}</span>}
          </span>
          <span className={`block truncate text-[11px] text-gk-dim ${url ? 'font-mono' : ''}`}>
            {url || (originalUrl ? 'введите адрес своего сервера ниже' : 'укажите, где он хранится — remote origin будет добавлен')}
          </span>
        </span>
        {kindName && choice !== 'self' && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-gk-muted" data-testid="auth-kind">
            <span className="h-2 w-2 rounded-full" style={{ background: kindInfo(kind)?.color }} />
            {kindName}
          </span>
        )}
        {parsed.protocol && <span className="shrink-0 rounded bg-gk-hover px-1.5 text-[10px] uppercase text-gk-muted">{proto === 'ssh' ? 'SSH' : 'HTTPS'}</span>}
      </div>

      {/* Где хранится: GitHub / GitLab / свой сервер */}
      <ServerPicker
        choice={choice}
        onChoice={pickChoice}
        locked={!canEditRemote}
        domain={domain}
        onDomain={changeDomain}
        kindRow={
          choice === 'self' && parsed.hostname ? (
            <KindRow kind={kind} touched={kindTouched} detect={detect} saved={Boolean(srv?.kindSaved)} onChange={chooseKind} />
          ) : null
        }
      />

      {canEditRemote && (
        <div className="space-y-1.5">
          <Field label="Адрес репозитория" hint={target?.remote ? `remote ${target.remote}` : 'будет добавлен как origin'}>
            <input
              value={url}
              onChange={(e) => changeUrl(e.target.value)}
              placeholder="https://gitlab.company.ru/group/project.git"
              aria-label="Адрес репозитория"
              spellCheck={false}
              data-testid="auth-url"
              className={`${INPUT} font-mono text-[12px] ${url.trim() && !validUrl ? 'border-gk-red/60' : ''}`}
            />
          </Field>
          {url.trim() && parsed.hostname && !parsed.path && (
            <div className="text-[11.5px] text-gk-yellow">
              Добавьте путь проекта: <span className="font-mono">{buildRepoUrl(domainOfUrl(url), { ...last.current, path: 'группа/проект' })}</span>
            </div>
          )}
          {changed && validUrl && (
            <div className="rounded-md border border-gk-blue/30 bg-gk-blue/[0.07] px-3 py-1.5 text-[11.5px] leading-relaxed text-gk-text" data-testid="auth-remote-change">
              {originalUrl ? `При сохранении remote ${target?.remote ?? 'origin'} сменится:` : 'При сохранении будет добавлен remote origin:'}
              {originalUrl && <span className="block truncate font-mono text-[11px] text-gk-dim">{originalUrl}</span>}
              <span className="block truncate font-mono text-[11px] text-gk-blue">→ {url.trim()}</span>
            </div>
          )}
        </div>
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

      {notice && (
        <div data-testid="auth-notice" className="flex items-start gap-2 rounded-md border border-gk-yellow/35 bg-gk-yellow/10 px-3 py-2 text-[12px] leading-relaxed">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-yellow" />
          <span className="text-gk-text">
            {notice.message}
            {notice.hint && <span className="block text-gk-muted">{notice.hint}</span>}
          </span>
        </div>
      )}

      {/* Способ входа — виден сразу, даже пока адрес своего сервера не введён */}
      <div role="tablist" className="flex gap-1 rounded-lg bg-gk-sink/20 p-1">
        {TABS.map((t) => {
          const off = parsed.protocol && t.https !== (proto === 'https');
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id, true)}
              data-tip={off ? (t.https ? 'Адрес — SSH: логин, пароль и токен для него не используются' : 'Адрес — HTTPS: SSH-ключ для него не используется') : undefined}
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

      {wrongProtocol && parsed.protocol && (
        <div className="rounded-md border border-gk-yellow/30 bg-gk-yellow/10 px-3 py-2 text-[12px] leading-relaxed text-gk-text">
          {proto === 'https'
            ? 'Адрес начинается с https:// — SSH-ключ для него не используется. Войдите логином и паролем или токеном, либо переведите адрес на SSH.'
            : 'Адрес — SSH (git@…): для него нужен SSH-ключ. Логин, пароль и токен работают только с адресами https://.'}
          {canEditRemote && (proto === 'https' ? toSsh(url) : toHttps(url)) && (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gk-muted" data-tip={proto === 'https' ? toSsh(url) : toHttps(url)}>
                → {proto === 'https' ? toSsh(url) : toHttps(url)}
              </span>
              <Button onClick={() => changeUrl(proto === 'https' ? toSsh(url) : toHttps(url))} disabled={busy} className="shrink-0 py-1 text-[12px]" data-testid="switch-to-ssh">
                <ArrowRightLeft size={12} /> {proto === 'https' ? 'Перевести адрес на SSH' : 'Перевести адрес на HTTPS'}
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
          {kind === 'gitlab' && (
            <p data-testid="auth-ci-hint" className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gk-dim">
              <Workflow size={12} className="mt-0.5 shrink-0" />
              <span>Эта же авторизация работает и для пайплайнов CI/CD — отдельно входить не нужно. Права api хватает на всё.</span>
            </p>
          )}
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
            <KeyGenerator host={parsed.hostname} onDefaults={onKeyDefaults ? (type) => onKeyDefaults(type, validUrl ? url.trim() : undefined) : null} onCreated={onCreated} />
          )}

          {created && (
            <CreatedKey
              keyInfo={created}
              submitLabel={actionLabel ?? 'Войти и повторить'}
              page={base ? sshKeysPage(kind, base, parsed.hostname) : null}
              host={parsed.hostname}
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

      {kind === 'gitlab' && tab !== 'token' && (
        <div data-testid="auth-api-token" className="space-y-1.5 rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-gk-text">
            <Workflow size={13} className="text-gk-muted" /> Пайплайны CI/CD
            <span className="font-normal text-gk-dim">— необязательно</span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-gk-dim">
            {tab === 'ssh' ? 'SSH-ключ' : 'Пароль'} GitLab принимает для Pull/Push, но не для API. Чтобы эта же авторизация открывала и
            пайплайны, добавьте токен с правом api или read_api — он сохранится вместе с ней.
            {base && (
              <button
                onClick={() => api?.openExternal(tokenPage('gitlab', base, parsed.hostname))}
                className="ml-1 inline-flex items-center gap-0.5 text-gk-blue hover:underline"
              >
                Создать токен <ExternalLink size={10} />
              </button>
            )}
          </p>
          <div className="relative">
            <input
              type={show.apiToken ? 'text' : 'password'}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={saved?.hasApiToken && saved.method === tab ? '•••••• сохранён — введите, чтобы заменить' : 'glpat-…'}
              aria-label="Токен для пайплайнов"
              spellCheck={false}
              className={`${INPUT} pr-9 font-mono`}
            />
            {eye('apiToken')}
          </div>
        </div>
      )}

      {srv?.api && kind === 'gitlab' && !notice && <ApiLine api={srv.api} />}

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
        {secretStorageText(undefined, 'Данные')} Они привязаны к репозиторию{' '}
        <span className="font-mono text-gk-muted">{parsed.path || '…'}</span> на {parsed.hostname ?? 'сервере'} — другие репозитории этого сервера их не получат.
        Git получает их напрямую, без окон входа.
        {saved && !saved.shared && (
          <span className="block" data-testid="auth-saved">
            Сейчас сохранено: {METHOD_NAMES[saved.method]}
            {saved.username ? ` (${saved.username})` : ''}
            {saved.keyPath ? ` — ${saved.keyPath.split(/[\\/]/).pop()}` : ''}.
          </span>
        )}
        {saved?.shared && (
          <span className="block text-gk-yellow" data-testid="auth-saved-shared">
            Сейчас действует общий вход для всего {parsed.hostname} ({METHOD_NAMES[saved.method]}
            {saved.username ? `, ${saved.username}` : ''}), сохранённый раньше. После сохранения у этого репозитория будет свой.
          </span>
        )}
      </p>
    </Modal>
  );
}

const METHOD_NAMES = { password: 'логин и пароль', token: 'токен', ssh: 'SSH-ключ' };

/** Работают ли пайплайны от сохранённой авторизации (последняя проверка) */
function ApiLine({ api: a }) {
  if (!a) return null;
  if (a.state === 'ok') {
    return (
      <p data-testid="auth-api-state" data-state="ok" className="flex items-center gap-1.5 text-[11.5px] text-gk-green">
        <CircleCheck size={12} /> Пайплайны CI/CD работают от этой авторизации{a.user?.username ? ` (@${a.user.username})` : ''}.
      </p>
    );
  }
  if (a.state === 'bad' || a.state === 'none') {
    return (
      <p data-testid="auth-api-state" data-state={a.state} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gk-yellow">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>{a.reason ?? 'Пайплайны CI/CD от этой авторизации не открываются — нужен токен.'}</span>
      </p>
    );
  }
  return null;
}

/** Логин для токена по умолчанию — как в main-процессе (credentials.defaultTokenUser), но по выбранному сейчас типу */
function defaultTokenUserFor(kind, fallback) {
  if (kind === 'gitlab') return 'oauth2';
  if (kind === 'bitbucket') return 'x-token-auth';
  if (kind) return 'git';
  return fallback ?? 'git';
}

/** Где хранится репозиторий: GitHub, GitLab или свой сервер (Self-Managed) по домену. locked — адрес менять нельзя (клонирование) */
function ServerPicker({ choice, onChoice, locked, domain, onDomain, kindRow }) {
  const [known, setKnown] = useState([]);
  useEffect(() => {
    if (locked) return;
    api?.creds?.servers?.().then((res) => res?.ok && setKnown(res.data.filter((s) => !s.cloud)));
  }, [locked]);
  const options = [
    ...CLOUD_SERVERS.map((c) => ({ id: c.id, title: c.label, sub: c.host, icon: Cloud, color: kindInfo(c.kind)?.color })),
    { id: 'self', title: 'Свой сервер', sub: 'Self-Managed', icon: Server, color: null },
  ];
  return (
    <div className="space-y-2" data-testid="server-picker">
      <div className="text-[11.5px] font-medium text-gk-muted">Где хранится репозиторий</div>
      <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
        {options.map((o) => {
          const off = locked && choice !== o.id;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={choice === o.id}
              disabled={off}
              onClick={() => onChoice(o.id)}
              data-testid={`server-${o.id}`}
              data-tip={off ? 'Адрес задан в окне клонирования' : undefined}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${
                choice === o.id ? 'border-gk-blue/70 bg-gk-blue/10' : 'border-gk-border enabled:hover:bg-gk-hover'
              }`}
            >
              <o.icon size={15} className="shrink-0" style={o.color ? { color: o.color } : undefined} />
              <span className="min-w-0">
                <span className={`block truncate text-[12.5px] ${choice === o.id ? 'text-gk-strong' : 'text-gk-text'}`}>{o.title}</span>
                <span className="block truncate font-mono text-[10.5px] text-gk-dim">{o.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {choice === 'self' && (
        <div className="space-y-2 rounded-lg border border-gk-border bg-gk-fg/[0.02] p-3">
          <Field label="Адрес сервера" hint={locked ? 'из ссылки на репозиторий' : 'домен, можно с портом'}>
            <input
              value={domain}
              onChange={(e) => onDomain(e.target.value)}
              readOnly={locked}
              placeholder="gitlab.company.ru"
              aria-label="Адрес сервера"
              spellCheck={false}
              data-testid="server-domain"
              className={`${INPUT} font-mono ${locked ? 'opacity-70' : ''}`}
            />
          </Field>
          {!locked && known.length > 0 && (
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
