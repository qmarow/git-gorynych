// Сквозная проверка команд в настоящем окне (tests/app_smoke.rs). Подставляется только в отладочной сборке скриптом
// инициализации (`GORYNYCH_DEV_SMOKE_SCRIPT`) вместо интерфейса и выполняется после разбора страницы. Любая ошибка
// попадает в отчёт `frontend_ready`.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const status = document.createElement('pre');
document.body.append(status);

// Метка сквозной проверки команд git (tests/app_smoke.rs). Без неё в последнем репозитории ничего не меняется:
// заглушку можно открыть и на настоящем профиле
const SMOKE_FILE = 'gorynych-smoke.txt';

// CSP должна запрещать eval: иначе политика не применилась, и дальше идти нельзя
function assertCspEnforced() {
  let evaluated = false;
  try {
    evaluated = new Function('return true')();
  } catch {
    return;
  }
  if (evaluated) throw new Error('CSP не действует');
}

function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`нет ${what} за ${ms} мс`)), ms))]);
}

async function rejected(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

// Команды git на настоящем репозитории: чтение, действие, слежение, линтер, проверка сервера
async function smoke(dir) {
  const before = await invoke('repo_status', { dir });
  if (!before.wipFiles.some((file) => file.path === SMOKE_FILE)) return null;
  const loaded = await invoke('repo_load', { dir });
  const changed = new Promise((resolve) => listen('repo-changed', (event) => resolve(event.payload)));
  const watching = await invoke('repo_watch', { dir, opts: { syncIndex: true } });
  const staged = await invoke('repo_action', { dir, action: { name: 'stage', payload: { paths: [SMOKE_FILE] } } });
  const change = await withTimeout(changed, 20000, 'repo-changed');
  const guard = await invoke('repo_guard_scan', {
    dir,
    params: { rules: [{ id: 'secret', label: 'Секрет', pattern: 'секрет-\\d+', flags: 'i', level: 'block', category: 'secret' }] },
  });
  const committed = await invoke('repo_action', { dir, action: { name: 'commit', payload: { summary: 'Из окна' } } });
  const afterCommit = await invoke('repo_load', { dir, known: loaded.graphFingerprint });
  const undone = await invoke('repo_action', { dir, action: { name: 'undo', payload: {} } });
  // Отмена вернула ветку на прежний коммит: граф тот же, git log не нужен
  const afterUndo = await invoke('repo_load', { dir, known: loaded.graphFingerprint });
  const after = await invoke('repo_status', { dir });
  const ci = await invoke('repo_ci', { dir, file: null });
  // `skipped` — временно (идёт действие, внешний git держит index.lock): интерфейс 1.x повторяет через 2 с, здесь так же
  let remote = await invoke('repo_remote_check', { dir });
  const skippedReasons = [];
  for (let attempt = 0; remote.status === 'skipped' && attempt < 10; attempt += 1) {
    skippedReasons.push(remote.reason);
    await new Promise((resolve) => setTimeout(resolve, 500));
    remote = await invoke('repo_remote_check', { dir });
  }
  const gitflow = await invoke('repo_gitflow_config', { dir });
  const fileDiff = await invoke('repo_file_diff', { dir, params: { mode: 'staged', path: SMOKE_FILE } });
  const unknownAction = await rejected(invoke('repo_action', { dir, action: { name: 'нетТакого', payload: {} } }));
  const badCompare = await rejected(invoke('repo_compare', { dir, params: { a: 'не хэш', b: null } }));
  const cancelled = await invoke('repo_clone_cancel', { id: 'нет' });
  const unwatched = await invoke('repo_watch', { dir: null, opts: null });
  const creds = await credsSmoke(dir);
  const cicd = await cicdSmoke(dir);
  const desktop = await desktopSmoke(dir);
  return {
    creds,
    cicd,
    desktop,
    loaded: { name: loaded.name, commits: loaded.commits.length, currentBranch: loaded.currentBranch, history: loaded.history, ci: loaded.ci, forge: loaded.forge },
    watching,
    staged,
    change,
    guard: { blocked: guard.blocked, findings: guard.findings },
    committed,
    undone,
    reload: [afterCommit, afterUndo].map((r) => ({ unchanged: r.commitsUnchanged, commits: r.commits.length, same: r.graphFingerprint === loaded.graphFingerprint })),
    after: after.wipFiles.map((file) => [file.path, file.staged]),
    ci: { systems: ci.systems.map((system) => system.id), current: ci.current && ci.current.system, jobs: ci.current && ci.current.jobCount },
    remote: { status: remote.status, remotes: remote.remotes, fetched: remote.fetched },
    skippedReasons,
    gitflow,
    fileDiff: { additions: fileDiff.additions },
    unknownAction,
    badCompare,
    cancelled,
    unwatched,
  };
}

// Вход на сервер: у репозитория нет remote, окно входа добавляет его вместе со входом. Секрет уходит в Keyring
// (сервис `.dev`), поэтому вход в конце удаляется. Ключ SSH и «буфер обмена» — в папке теста
async function credsSmoke(dir) {
  const remoteUrl = 'https://gitlab.example.invalid/group/project.git';
  const noRemote = await invoke('creds_describe', { dir, url: null });
  const badRemote = await rejected(invoke('creds_save', { dir, url: null, data: { remoteUrl: 'не адрес', method: 'token', secret: 'glpat-x' } }));
  const saved = await invoke('creds_save', { dir, url: null, data: { remoteUrl, method: 'token', secret: 'glpat-проверка' } });
  const described = await invoke('creds_describe', { dir, url: null });
  const servers = await invoke('creds_servers');
  const server = servers.find((s) => s.hostname === 'gitlab.example.invalid');
  const cleared = await invoke('creds_clear', { dir, url: null });
  const afterClear = await invoke('creds_describe', { dir, url: null });
  const switched = await invoke('creds_switch_to_ssh', { dir });
  const switchedAgain = await rejected(invoke('creds_switch_to_ssh', { dir }));
  const kind = await invoke('creds_set_kind', { hostname: 'git.example.invalid', kind: 'gitea' });
  const badKind = await rejected(invoke('creds_set_kind', { hostname: 'git.example.invalid', kind: 'нет' }));
  const forgotServer = await invoke('creds_forget_server', { hostname: 'git.example.invalid' });
  const defaults = await invoke('creds_key_defaults', { dir, url: null, keyType: 'ed25519' });
  const generated = await invoke('creds_generate_key', { options: { type: 'ed25519', comment: defaults.comment, name: defaults.name } });
  const keys = await invoke('creds_ssh_keys');
  const copied = await invoke('creds_copy_public_key', { keyPath: generated.path });
  const noPub = await rejected(invoke('creds_copy_public_key', { keyPath: `${generated.path}.нет` }));
  const badUrl = await rejected(invoke('creds_check_url', { url: 'не адрес' }));
  return {
    noRemote,
    badRemote,
    saved: { remoteChange: saved.remoteChange, method: saved.saved && saved.saved.method, kind: saved.kind, api: saved.api },
    described: { remote: described.remote, url: described.url, kind: described.kind, defaultTokenUser: described.defaultTokenUser, method: described.saved && described.saved.method, readable: described.saved && described.saved.readable, api: described.api },
    server: server && { kind: server.kind, repos: server.repos.map((r) => ({ path: r.path, method: r.method, ciSource: r.ci && r.ci.source })) },
    cleared,
    afterClear: afterClear.saved,
    switched: { remote: switched.remote, from: switched.from, to: switched.to, protocol: switched.target.protocol },
    switchedAgain,
    kind,
    badKind,
    forgotServer,
    defaults,
    generated: { name: generated.name, type: generated.type, copied: generated.copied, publicKey: generated.publicKey },
    keys: keys.keys.map((k) => k.name),
    copied,
    noPub,
    badUrl,
  };
}

// CI/CD после `credsSmoke`: remote — `git@gitlab.example.invalid:group/project.git`, входа нет. Ни одна команда здесь не идёт
// в сеть: без входа API не вызывается, а ошибки аргументов проверяются раньше
async function cicdSmoke(dir) {
  const status = await invoke('cicd_status', { dir, opts: null });
  const gitlab = await invoke('gitlab_status', { dir, opts: { remote: 'origin' } });
  const settings = await invoke('cicd_settings', { dir, opts: null });
  const savedSettings = await invoke('cicd_settings_save', { dir, data: { provider: 'gitea', apiBase: 'https://gitea.example.invalid/' }, opts: null });
  const resetSettings = await invoke('cicd_settings_save', { dir, data: { provider: null, apiBase: null }, opts: null });
  const runForm = await invoke('cicd_run_form', { dir, opts: null });
  const localRunners = await invoke('cicd_local_runners', { dir, opts: null });
  const noToken = await rejected(invoke('cicd_pipelines', { dir, opts: { ref: 'main' } }));
  const glNoToken = await rejected(invoke('gitlab_variables', { dir, opts: null }));
  const badAction = await rejected(invoke('cicd_action', { dir, action: { type: 'нет', id: 1 }, opts: null }));
  const badRun = await rejected(invoke('cicd_run', { dir, params: { ref: ' ' }, opts: null }));
  const badSecret = await rejected(invoke('cicd_secret_save', { dir, data: { key: '1x', value: 'v' }, opts: null }));
  const badRunner = await rejected(invoke('cicd_local_runner_stop', { name: 'не-горыныч' }));
  const notRepo = await rejected(invoke('cicd_info', { dir: `${dir}\\нет-такой-папки`, opts: null }));
  return {
    status: status && { kind: status.kind, host: status.host, path: status.path, protocol: status.protocol, base: status.base, configured: status.token.configured },
    gitlab: gitlab && { kind: gitlab.kind, remote: gitlab.remote, path: gitlab.path, configured: gitlab.token.configured },
    settings,
    savedSettings,
    resetSettings,
    runForm,
    localRunners: { available: localRunners.docker.available, runners: localRunners.runners },
    noToken,
    glNoToken,
    badAction,
    badRun,
    badSecret,
    badRunner,
    notRepo,
  };
}

// Ширина загруженной картинки, -1 — не загрузилась (протокол или CSP)
function imageWidth(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth);
    image.onerror = () => resolve(-1);
    image.src = src;
  });
}

// Диалоги, открытие и терминал. В отладке с подменой путей диалоги отвечают из `dialog-answers.txt` (порядок задаёт тест),
// а открытия только пишутся в `desktop.log`: окна на машине не появляются
async function desktopSmoke(dir) {
  const picked = await invoke('repo_open_dialog', { title: null });
  const canceled = await invoke('repo_open_dialog', { title: 'Свой заголовок' });
  const key = await invoke('creds_pick_key');
  const image = await invoke('appearance_pick_image');
  const imageUrl = await invoke('appearance_image');
  const width = imageUrl ? await imageWidth(imageUrl) : null;
  const appearance = await invoke('appearance_get');
  const badImage = await rejected(invoke('appearance_pick_image'));
  const artifact = await invoke('cicd_artifact_download', { dir, artifact: { jobId: 7, name: 'build:x' }, opts: null });
  const opened = await invoke('repo_open_path', { dir, rel: SMOKE_FILE });
  const outside = await rejected(invoke('repo_open_path', { dir, rel: '../вне' }));
  const folder = await invoke('shell_open_folder', { dir });
  const noFolder = await rejected(invoke('shell_open_folder', { dir: `${dir}\\нет-такой` }));
  const terminal = await invoke('shell_open_terminal', { dir });
  const external = await invoke('shell_open_external', { url: 'https://example.com/путь' });
  const notWeb = await invoke('shell_open_external', { url: 'file:///C:/Windows' });
  const shown = await invoke('cicd_show_file', { file: `${dir}\\${SMOKE_FILE}` });
  // Меню macOS: на Windows в отладке собирается без установки; та же модель второй раз не пересобирается
  const model = { File: [{ id: 'open', label: 'Открыть…', hint: 'Ctrl+O' }, { separator: true }, { header: 'Недавние' }], Actions: [{ label: 'Push', disabled: true }] };
  await invoke('menu_set', { model });
  await invoke('menu_set', { model });
  // `target=_blank`: окно не открывается, ссылка уходит в браузер
  const link = document.createElement('a');
  link.href = 'https://example.com/blank';
  link.target = '_blank';
  document.body.append(link);
  link.click();
  link.remove();
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { picked, canceled, key, image, imageUrl, width, hasImage: appearance.hasImage, badImage, artifact, opened, outside, folder, noFolder, terminal, external, notWeb, shown };
}

async function main() {
  assertCspEnforced();
  const startup = await invoke('startup_status');
  if (startup.storageError) {
    status.textContent = JSON.stringify(startup, null, 2);
    return null;
  }
  const language = await invoke('app_get_language');
  const tabs = await invoke('tabs_get');
  const recent = await invoke('recent_list');
  const last = await invoke('repo_get_last');
  const appearance = await invoke('appearance_get');
  const maximized = await invoke('window_is_maximized');
  const repo = last ? await smoke(last) : null;
  status.textContent = JSON.stringify({ startup, language, tabs, recent, last, appearance, maximized, repo }, null, 2);
  return repo && { repo, recent };
}

main()
  .then((report) => invoke('frontend_ready', { report: report ? JSON.stringify(report) : null }))
  .catch((error) => {
    status.textContent = `Ошибка: ${error && error.message ? error.message : JSON.stringify(error)}`;
    invoke('frontend_ready', { report: JSON.stringify({ error: status.textContent }) }).catch(() => invoke('window_show'));
  });
