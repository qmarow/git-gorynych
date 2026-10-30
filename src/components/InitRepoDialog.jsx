import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { Button, ErrorBox, Modal } from './Dialogs.jsx';

export const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

function formatBytes(b) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

/**
 * Мастер «Новый Git-репозиторий» для существующей папки.
 * info — результат repo.inspect(dir); reason — почему открыт мастер ('open' | 'create').
 */
export default function InitRepoDialog({
  info,
  reason,
  initialMode = 'init',
  busy,
  error,
  onClose,
  onSubmit,
  onSubmitConnect,
  onProbe,
  onChangeFolder,
  onOpenParent,
}) {
  const needIdentity = !info.identity.name || !info.identity.email;

  // 'init' — новый репозиторий, 'connect' — подключить уже созданный на GitLab/GitHub
  const [mode, setMode] = useState(initialMode);
  const connect = mode === 'connect';
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState({ status: 'idle' }); // idle | loading | ok | error
  const [remoteBranch, setRemoteBranch] = useState('');
  const [push, setPush] = useState(true);
  const [connectMessage, setConnectMessage] = useState('Add project files');

  const runProbe = async (branchName) => {
    const target = url.trim();
    if (!target) return;
    setProbe({ status: 'loading', url: target });
    const res = await onProbe(target, branchName);
    if (res.ok) {
      setProbe({ status: 'ok', url: target, data: res.data });
      setRemoteBranch(res.data.branch ?? '');
    } else {
      setProbe({ status: 'error', url: target, error: res.error });
    }
  };
  const probeData = probe.status === 'ok' && probe.url === url.trim() ? probe.data : null;

  const [branch, setBranch] = useState(info.identity.defaultBranch || 'main');
  const [useGitignore, setUseGitignore] = useState(!info.hasGitignore);
  const [templates, setTemplates] = useState(() => ['common', ...info.types]);
  const [customIgnore, setCustomIgnore] = useState(null); // текст, если правили вручную
  const [showIgnore, setShowIgnore] = useState(false);
  const [readme, setReadme] = useState(!info.hasReadme && info.empty);
  const [commit, setCommit] = useState(!info.empty || !info.hasReadme);
  const [message, setMessage] = useState('Initial commit');
  const [editIdentity, setEditIdentity] = useState(needIdentity);
  const [name, setName] = useState(info.identity.name);
  const [email, setEmail] = useState(info.identity.email);
  const [globalIdentity, setGlobalIdentity] = useState(needIdentity && !info.identity.name && !info.identity.email);
  const [remote, setRemote] = useState('');

  const generatedIgnore = useMemo(
    () => templates.map((k) => info.templates[k]?.lines.join('\n')).filter(Boolean).join('\n\n') + '\n',
    [templates, info.templates],
  );
  const ignoreText = customIgnore ?? generatedIgnore;
  const remoteIgnore = connect && probeData?.remoteHasGitignore;
  const ignoreBlocked = info.hasGitignore || remoteIgnore;

  // Тяжёлые папки: попадут ли они в коммит
  const ignoreLines = new Set(ignoreText.split('\n').map((l) => l.trim().replace(/\/$/, '')));
  const heavy = Object.entries(info.heavy ?? {}).map(([dir, files]) => ({
    dir,
    files,
    ignored: (useGitignore || ignoreBlocked) && (ignoreBlocked || ignoreLines.has(dir) || ignoreLines.has(`[${dir[0].toUpperCase()}${dir[0].toLowerCase()}]${dir.slice(1)}`)),
  }));
  const heavyIncluded = heavy.filter((h) => !h.ignored && h.files > 0);

  const identityMissing = commit && (!name.trim() || !email.trim());
  const emailBad = email.trim() && !/^[^\s@]+@[^\s@]+$/.test(email.trim());
  const canSubmit =
    !busy && !identityMissing && !emailBad && (connect ? Boolean(probeData) && (!probeData.empty || branch.trim()) : branch.trim());

  const submit = () => {
    if (!canSubmit) return;
    const identityChanged = name.trim() !== info.identity.name || email.trim() !== info.identity.email;
    const identity = identityChanged ? { name: name.trim(), email: email.trim(), global: globalIdentity } : null;
    if (connect) {
      onSubmitConnect({
        url: url.trim(),
        branch: probeData.empty ? branch.trim() : remoteBranch,
        gitignore: useGitignore && !ignoreBlocked ? ignoreText : null,
        commit: commit ? { message: connectMessage.trim() || 'Add project files' } : null,
        identity,
        push: commit && push,
      });
      return;
    }
    onSubmit({
      branch: branch.trim(),
      gitignore: useGitignore && !info.hasGitignore ? ignoreText : null,
      readme: readme && !info.hasReadme,
      commit: commit ? { message: message.trim() || 'Initial commit' } : null,
      identity: identityChanged ? { name: name.trim(), email: email.trim(), global: globalIdentity } : null,
      remote: remote.trim() || null,
    });
  };

  const plan = connect
    ? [
        'git init',
        'remote origin',
        probeData && !probeData.empty && `загрузка ${remoteBranch}`,
        useGitignore && !ignoreBlocked && '.gitignore',
        commit && 'коммит',
        commit && push && 'push',
      ].filter(Boolean)
    : [
    'git init',
    useGitignore && !info.hasGitignore && '.gitignore',
    readme && !info.hasReadme && 'README',
    commit && 'первый коммит',
    remote.trim() && 'remote',
  ].filter(Boolean);
  const connectHint = connect && !probeData ? (probe.status === 'loading' ? 'Проверяем репозиторий…' : 'Вставьте адрес и нажмите «Проверить»') : null;

  return (
    <Modal
      title={connect ? 'Подключить к удалённому репозиторию' : 'Новый Git-репозиторий'}
      icon={FolderGit2}
      iconClass="text-gk-green"
      onClose={busy ? () => {} : onClose}
      width={620}
      footer={
        <div className="flex w-full items-center gap-3">
          {identityMissing || emailBad ? (
            <button
              onClick={() => {
                setEditIdentity(true);
                setTimeout(() => document.getElementById('init-identity')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
              }}
              className="min-w-0 flex-1 truncate text-left text-[11px] text-gk-yellow hover:underline"
            >
              {emailBad ? 'Проверьте email автора ↓' : 'Укажите имя и email автора коммита ↓'}
            </button>
          ) : connectHint ? (
            <span className="min-w-0 flex-1 truncate text-[11px] text-gk-muted">{connectHint}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-gk-dim" title={plan.join(' → ')}>
              {plan.join(' → ')}
            </span>
          )}
          <Button onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            {busy ? (connect ? 'Подключаем…' : 'Создаём…') : connect ? (commit && push ? 'Подключить и отправить' : 'Подключить') : 'Создать репозиторий'}
          </Button>
        </div>
      }
    >
      <div className="-mx-4 -my-4 max-h-[62vh] space-y-4 overflow-y-auto px-4 py-4">
        {/* Папка */}
        <div className="flex items-start gap-3 rounded-lg bg-gk-fg/[0.04] p-3 ring-1 ring-gk-border">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gk-green/10 text-gk-green">
            <FolderOpen size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-gk-strong">{info.name}</span>
              {info.typeLabels.map((t) => (
                <span key={t} className="shrink-0 rounded bg-gk-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-gk-blue">
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-gk-dim" title={info.path}>
              {info.path}
            </div>
            <div className="mt-1 text-xs text-gk-muted">
              {info.empty
                ? 'Пустая папка'
                : `${info.files.toLocaleString('ru-RU')}${info.truncated ? '+' : ''} ${plural(info.files, 'файл', 'файла', 'файлов')} · ${info.dirs.toLocaleString('ru-RU')} ${plural(info.dirs, 'папка', 'папки', 'папок')} · ${formatBytes(info.bytes)}`}
            </div>
          </div>
          <button onClick={onChangeFolder} disabled={busy} className="shrink-0 text-xs text-gk-blue hover:underline">
            Другая папка
          </button>
        </div>

        {/* Подсказки */}
        {/* Режим */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gk-sink/20 p-1 ring-1 ring-gk-border">
          {[
            { id: 'init', icon: FolderGit2, title: 'Новый репозиторий', sub: 'git init с нуля' },
            { id: 'connect', icon: Link2, title: 'Подключить существующий', sub: 'уже создан на GitLab / GitHub' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={busy}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
                mode === m.id ? 'bg-gk-fg/10 text-gk-strong ring-1 ring-gk-fg/10' : 'text-gk-muted hover:bg-gk-fg/5 hover:text-gk-text'
              }`}
            >
              <m.icon size={16} className={mode === m.id ? 'text-gk-green' : ''} />
              <span>
                <span className="block text-[13px] font-medium">{m.title}</span>
                <span className="block text-[11px] text-gk-dim">{m.sub}</span>
              </span>
            </button>
          ))}
        </div>

        {connect && (
          <ConnectSection
            url={url}
            setUrl={setUrl}
            probe={probe}
            probeData={probeData}
            onProbe={runProbe}
            remoteBranch={remoteBranch}
            onBranchChange={(b) => {
              setRemoteBranch(b);
              runProbe(b);
            }}
            busy={busy}
          />
        )}

        {!connect && reason === 'open' && !info.parentRepo && (
          <Notice icon={Info} tone="blue">
            В этой папке ещё нет Git. Создадим репозиторий прямо здесь — файлы проекта останутся на месте.
          </Notice>
        )}
        {info.parentRepo && (
          <Notice icon={AlertTriangle} tone="yellow">
            Папка уже находится внутри репозитория <b className="break-all">{info.parentRepo}</b>. Новый репозиторий
            будет вложенным — обычно это не нужно.
            <button onClick={onOpenParent} className="ml-1 font-medium text-gk-blue hover:underline">
              Открыть его
            </button>
          </Notice>
        )}
        {heavyIncluded.length > 0 && (
          <Notice icon={AlertTriangle} tone="yellow">
            В коммит попадут служебные папки:{' '}
            {heavyIncluded.map((h) => `${h.dir} (${h.files.toLocaleString('ru-RU')})`).join(', ')}. Включите
            .gitignore, чтобы их исключить.
          </Notice>
        )}
        {heavy.some((h) => h.ignored && h.files > 0) && (
          <Notice icon={ShieldCheck} tone="green">
            Исключены через .gitignore:{' '}
            {heavy
              .filter((h) => h.ignored && h.files > 0)
              .map((h) => `${h.dir} (${h.files.toLocaleString('ru-RU')} ${plural(h.files, 'файл', 'файла', 'файлов')})`)
              .join(', ')}
          </Notice>
        )}

        {/* Ветка */}
        {(!connect || probeData?.empty) && (
        <Field icon={GitBranch} label={connect ? 'Ветка для первого push' : 'Основная ветка'}>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value.replace(/\s/g, '-'))}
            className="w-48 rounded bg-gk-bg px-2.5 py-1.5 font-mono text-[13px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
          />
        </Field>
        )}

        {/* .gitignore */}
        <Field
          icon={ShieldCheck}
          label=".gitignore"
          hint={
            info.hasGitignore
              ? 'Уже есть в проекте — оставим без изменений'
              : remoteIgnore
                ? 'Уже есть в репозитории на сервере — возьмём его'
                : 'Какие файлы Git будет игнорировать'
          }
        >
          <Switch checked={useGitignore && !ignoreBlocked} disabled={ignoreBlocked} onChange={setUseGitignore} />
        </Field>
        {useGitignore && !ignoreBlocked && (
          <div className="-mt-2 ml-8 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(info.templates).map(([key, t]) => {
                const on = templates.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setCustomIgnore(null);
                      setTemplates((list) => (on ? list.filter((k) => k !== key) : [...list, key]));
                    }}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                      on ? 'bg-gk-green/20 text-gk-green ring-1 ring-gk-green/40' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
                    }`}
                  >
                    {on && '✓ '}
                    {t.label}
                    {info.types.includes(key) && <span className="ml-1 opacity-70">· найден</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowIgnore((v) => !v)} className="flex items-center gap-1 text-xs text-gk-muted hover:text-gk-text">
              {showIgnore ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showIgnore ? 'Скрыть' : 'Показать и отредактировать'} ({ignoreText.split('\n').filter((l) => l && !l.startsWith('#')).length} правил)
            </button>
            {showIgnore && (
              <textarea
                value={ignoreText}
                onChange={(e) => setCustomIgnore(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full resize-y rounded bg-gk-bg px-3 py-2 font-mono text-[11px] leading-relaxed outline-none ring-1 ring-gk-border focus:ring-gk-blue"
              />
            )}
          </div>
        )}

        {/* README */}
        {!connect && (
        <Field icon={FileText} label="README.md" hint={info.hasReadme ? 'Уже есть в проекте' : 'Файл с названием проекта'}>
          <Switch checked={readme && !info.hasReadme} disabled={info.hasReadme} onChange={setReadme} />
        </Field>
        )}

        {/* Первый коммит */}
        <Field
          icon={GitCommitHorizontal}
          label={connect ? 'Коммит файлов проекта' : 'Первый коммит'}
          hint={
            connect
              ? probeData && !probeData.empty
                ? `Поверх последнего коммита с сервера «${probeData.lastCommit?.message ?? ''}»`
                : 'Ваши файлы станут первым коммитом репозитория'
              : info.empty && !readme
                ? 'Папка пуста — коммитить пока нечего'
                : 'Сохранить текущее состояние всех файлов'
          }
        >
          <Switch checked={commit} onChange={setCommit} />
        </Field>
        {commit && (
          <div className="-mt-2 ml-8 space-y-3">
            <input
              value={connect ? connectMessage : message}
              onChange={(e) => (connect ? setConnectMessage(e.target.value) : setMessage(e.target.value))}
              placeholder={connect ? 'Add project files' : 'Initial commit'}
              className="w-full rounded bg-gk-bg px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
            />

            {/* Автор */}
            {!editIdentity ? (
              <div className="flex items-center gap-2 text-xs text-gk-muted">
                <User size={13} />
                Автор: <span className="text-gk-text">{info.identity.name}</span>
                <span>&lt;{info.identity.email}&gt;</span>
                <button onClick={() => setEditIdentity(true)} className="text-gk-blue hover:underline">
                  изменить
                </button>
              </div>
            ) : (
              <div id="init-identity" className="space-y-2 rounded-lg bg-gk-fg/[0.03] p-3 ring-1 ring-gk-border">
                {needIdentity && (
                  <div className="flex items-start gap-2 text-xs text-gk-yellow">
                    <User size={13} className="mt-0.5 shrink-0" />
                    Git ещё не знает, кто вы. Имя и email будут указаны в коммитах.
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Имя"
                    className="min-w-0 flex-1 rounded bg-gk-bg px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
                  />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className={`min-w-0 flex-1 rounded bg-gk-bg px-2.5 py-1.5 text-[13px] outline-none ring-1 focus:ring-gk-blue ${
                      emailBad ? 'ring-gk-red' : 'ring-gk-border'
                    }`}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-gk-muted">
                  <input
                    type="checkbox"
                    checked={globalIdentity}
                    onChange={(e) => setGlobalIdentity(e.target.checked)}
                    className="accent-gk-green"
                  />
                  Использовать для всех репозиториев на этом компьютере
                </label>
              </div>
            )}
          </div>
        )}

        {connect && commit && (
          <Field
            icon={CloudUpload}
            label="Сразу отправить на сервер (push)"
            hint={probeData ? `в ${probeData.empty ? branch || 'main' : remoteBranch} на ${probeData.host ?? 'сервере'}` : 'После подключения'}
          >
            <Switch checked={push} onChange={setPush} />
          </Field>
        )}

        {/* Remote */}
        {!connect && (
        <Field icon={Globe} label="Remote origin" hint="Необязательно — можно добавить позже">
          <input
            value={remote}
            onChange={(e) => setRemote(e.target.value.trim())}
            placeholder="https://github.com/user/repo.git"
            className="w-72 rounded bg-gk-bg px-2.5 py-1.5 font-mono text-[12px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
          />
        </Field>
        )}

        {error && <ErrorBox error={error} />}
      </div>
    </Modal>
  );
}

/* ---------- Подключение к существующему репозиторию ---------- */

function FileList({ files, max = 6 }) {
  const shown = files.slice(0, max);
  return (
    <span className="font-mono text-[11px]">
      {shown.join(', ')}
      {files.length > max && ` и ещё ${files.length - max}`}
    </span>
  );
}

function ConnectSection({ url, setUrl, probe, probeData, onProbe, remoteBranch, onBranchChange, busy }) {
  const loading = probe.status === 'loading';
  const stale = probe.status === 'ok' && probe.url !== url.trim();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="shrink-0 text-gk-muted" />
        <input
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && onProbe()}
          placeholder="https://gitlab.com/user/project.git"
          className="min-w-0 flex-1 rounded bg-gk-bg px-3 py-2 font-mono text-[12px] outline-none ring-1 ring-gk-border placeholder:text-gk-dim focus:ring-gk-blue"
        />
        <Button variant="blue" onClick={() => onProbe()} disabled={!url.trim() || loading || busy}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Проверить
        </Button>
      </div>
      <p className="-mt-1 ml-6 text-[11px] text-gk-dim">
        Скопируйте адрес на странице проекта в GitLab: кнопка «Code» → «Clone with HTTPS» или «Clone with SSH». Проверка
        ничего не меняет ни в папке, ни на сервере.
      </p>

      {loading && (
        <div className="ml-6 flex items-center gap-2 text-xs text-gk-muted">
          <Loader2 size={13} className="animate-spin" /> Подключаемся к серверу… Если появится окно входа — авторизуйтесь в нём.
        </div>
      )}
      {probe.status === 'error' && (
        <div className="ml-6">
          <ErrorBox error={probe.error} />
        </div>
      )}
      {stale && (
        <div className="ml-6 text-xs text-gk-yellow">Адрес изменился — нажмите «Проверить» ещё раз.</div>
      )}

      {probeData && (
        <div className="ml-6 space-y-2 rounded-lg bg-gk-fg/[0.04] p-3 text-xs ring-1 ring-gk-border">
          <div className="flex items-center gap-2 text-gk-green">
            <Check size={14} />
            <span className="font-medium">Доступ есть{probeData.host ? ` · ${probeData.host}` : ''}</span>
          </div>

          {probeData.empty ? (
            <div className="leading-relaxed text-gk-text">
              Репозиторий пустой. Ваши файлы станут первым коммитом и будут отправлены на сервер.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-gk-text">
                <GitBranch size={13} className="text-gk-muted" />
                Ветка
                <select
                  value={remoteBranch}
                  onChange={(e) => onBranchChange(e.target.value)}
                  className="rounded bg-gk-bg px-2 py-1 font-mono text-[12px] outline-none ring-1 ring-gk-border focus:ring-gk-blue"
                >
                  {probeData.branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.name === probeData.headBranch ? ' (по умолчанию)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {probeData.lastCommit && (
                <div className="text-gk-muted">
                  Последний коммит: <span className="text-gk-text">«{probeData.lastCommit.message}»</span> ·{' '}
                  {probeData.lastCommit.author} · {probeData.remoteFiles}{' '}
                  {plural(probeData.remoteFiles, 'файл', 'файла', 'файлов')}
                </div>
              )}
              <div className="space-y-1 border-t border-gk-border pt-2">
                <div className="text-gk-muted">Что будет с файлами:</div>
                {probeData.same.length > 0 && (
                  <Row tone="text-gk-dim" mark="=">
                    Совпадают ({probeData.same.length}) — ничего не меняется
                  </Row>
                )}
                {probeData.differ.length > 0 && (
                  <Row tone="text-gk-yellow" mark="≠">
                    Различаются ({probeData.differ.length}): <FileList files={probeData.differ} /> — останется{' '}
                    <b>ваша</b> версия, разница попадёт в коммит
                  </Row>
                )}
                {probeData.remoteOnly.length > 0 && (
                  <Row tone="text-gk-blue" mark="+">
                    Есть только на сервере ({probeData.remoteOnly.length}): <FileList files={probeData.remoteOnly} /> —
                    появятся в папке
                  </Row>
                )}
                <Row tone="text-gk-green" mark="↑">
                  Остальные ваши файлы добавятся новым коммитом поверх истории сервера
                </Row>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ tone, mark, children }) {
  return (
    <div className="flex items-start gap-2 leading-relaxed">
      <span className={`w-3 shrink-0 text-center font-mono font-bold ${tone}`}>{mark}</span>
      <span className="min-w-0 text-gk-text">{children}</span>
    </div>
  );
}

function Field({ icon: Icon, label, hint, children }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} className="shrink-0 text-gk-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-gk-text">{label}</div>
        {hint && <div className="text-[11px] text-gk-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, disabled, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-gk-green' : 'bg-gk-fg/15'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-150 ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

function Notice({ icon: Icon, tone, children }) {
  const tones = {
    blue: 'border-gk-blue/30 bg-gk-blue/10 [&>svg]:text-gk-blue',
    yellow: 'border-gk-yellow/30 bg-gk-yellow/10 [&>svg]:text-gk-yellow',
    green: 'border-gk-green/25 bg-gk-green/10 [&>svg]:text-gk-green',
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-relaxed text-gk-text ${tones[tone]}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
