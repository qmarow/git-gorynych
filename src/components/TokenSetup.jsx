import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, LogOut, Plug, ShieldCheck } from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.jsx';

const api = window.api;

const SCOPE_LABELS = {
  api: 'просмотр и действия',
  read_api: 'только просмотр',
};

const createTokenUrl = (base, scope) =>
  `${base}/-/user_settings/personal_access_tokens?name=${encodeURIComponent('GitKraken Clone')}&scopes=${scope}`;

/**
 * Подключение GitLab по личному токену доступа. Токен уходит в main-процесс,
 * там проверяется, шифруется и больше никогда не возвращается в интерфейс.
 */
export function TokenSetup({ repoPath, forge, remoteName, onChanged, autoFocus = false }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const [saved, setSaved] = useState(null);
  const inputRef = useRef(null);

  const configured = forge?.token?.configured && !replacing;
  useEffect(() => {
    if ((autoFocus || replacing) && !configured) inputRef.current?.focus();
  }, [autoFocus, replacing, configured]);

  if (!forge) {
    return <p className="text-[13px] text-gk-muted">У репозитория нет remote — подключать нечего.</p>;
  }
  const host = forge.host;

  const save = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.gitlab.setToken(repoPath, token, { remote: remoteName });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setToken('');
    setReplacing(false);
    setSaved(res.data);
    const st = await api.gitlab.status(repoPath, { remote: remoteName });
    if (st.ok) onChanged?.(st.data);
  };

  const disconnect = async () => {
    setBusy(true);
    await api.gitlab.clearToken(repoPath, { remote: remoteName });
    setBusy(false);
    setSaved(null);
    const st = await api.gitlab.status(repoPath, { remote: remoteName });
    if (st.ok) onChanged?.(st.data);
  };

  if (configured) {
    const t = forge.token;
    return (
      <div className="animate-fade-in space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-gk-green/25 bg-gk-green/[0.06] px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fc6d26]/20 text-[13px] font-bold text-[#fc6d26]">
            {(t.user?.name ?? t.user?.username ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] text-white">
              <ShieldCheck size={14} className="shrink-0 text-gk-green" />
              <span className="truncate">{t.user?.name ?? 'Подключено'}</span>
              {t.user?.username && <span className="truncate text-gk-muted">@{t.user.username}</span>}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-gk-dim">
              {host}
              {t.scopes ? ` · ${t.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ')}` : ''}
              {t.expiresAt ? ` · действует до ${new Date(t.expiresAt).toLocaleDateString('ru-RU')}` : ''}
            </div>
          </div>
        </div>
        {saved && !saved.projectAccess && (
          <ErrorBox
            error={{
              message: 'Токен сохранён, но проект не найден',
              hint: `У пользователя @${saved.user?.username} нет доступа к ${forge.path} — пайплайны показать не получится`,
            }}
          />
        )}
        {t.scopes && !t.scopes.includes('api') && (
          <p className="text-[12px] leading-relaxed text-gk-muted">
            Токен только для чтения: пайплайны и логи видны, но запускать, перезапускать и отменять нельзя. Для действий нужен токен
            со scope «api».
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => setReplacing(true)} disabled={busy}>
            <KeyRound size={13} /> Заменить токен
          </Button>
          <Button onClick={disconnect} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Отключить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-3 text-[13px]">
      {forge.kind !== 'gitlab' && (
        <p className="text-[12px] text-gk-muted">
          Адрес <span className="font-mono text-gk-text">{host}</span> не похож на gitlab.com. Если это GitLab на своём сервере —
          подключите его токеном.
        </p>
      )}
      <ol className="space-y-3">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <div className="text-gk-text">Создайте личный токен доступа в GitLab</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button variant="blue" onClick={() => api.openExternal(createTokenUrl(forge.base, 'api'))}>
                <ExternalLink size={13} /> Создать токен
              </Button>
              <button
                onClick={() => api.openExternal(createTokenUrl(forge.base, 'read_api'))}
                className="text-[12px] text-gk-blue hover:underline"
              >
                или только для просмотра (read_api)
              </button>
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-gk-dim">
              Откроется страница {host}, где уже выбраны имя и права. Нажмите там «Create token» и скопируйте его.
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="min-w-0 flex-1">
            <div className="text-gk-text">Вставьте токен</div>
            <div className="mt-1.5 flex items-center gap-1 rounded-md bg-gk-bg px-2 ring-1 ring-gk-border focus-within:ring-gk-blue">
              <KeyRound size={13} className="shrink-0 text-gk-dim" />
              <input
                ref={inputRef}
                type={show ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="glpat-…"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-[12.5px] outline-none placeholder:text-gk-dim"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                title={show ? 'Скрыть' : 'Показать'}
                className="rounded p-1 text-gk-dim hover:text-gk-text"
              >
                {show ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
        </li>
      </ol>

      <ErrorBox error={error} />

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!token.trim() || busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Проверить и сохранить
        </Button>
        {replacing && (
          <Button onClick={() => setReplacing(false)} disabled={busy}>
            Отмена
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-gk-dim">
        Токен шифруется средствами Windows и хранится только на этом компьютере. Приложение отправляет его только на {host}.
      </p>
    </div>
  );
}

function Step({ n }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gk-blue/20 text-[11px] font-semibold text-gk-blue">
      {n}
    </span>
  );
}

/** Окно настроек интеграций (шестерёнка в тулбаре) */
export function IntegrationsDialog({ repo, onForgeChanged, onClose }) {
  const current = repo?.localBranches.find((b) => b.name === repo.currentBranch);
  return (
    <Modal title="Подключения" icon={Plug} onClose={onClose} width={520}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#fc6d26]" />
          <span className="text-[13px] font-semibold text-white">GitLab</span>
          {repo?.forge?.path && <span className="truncate font-mono text-[11px] text-gk-dim">{repo.forge.path}</span>}
        </div>
        <p className="text-[12px] leading-relaxed text-gk-muted">
          Статусы пайплайнов в графе, логи заданий, перезапуск и отмена, переменные CI/CD и раннеры проекта.
        </p>
        <div className="pt-1">
          <TokenSetup repoPath={repo?.path} forge={repo?.forge} remoteName={current?.upstreamRemote} onChanged={onForgeChanged} autoFocus />
        </div>
      </div>
    </Modal>
  );
}
