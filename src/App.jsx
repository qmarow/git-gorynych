import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Cherry,
  Cloud,
  Copy,
  Eraser,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  Link2,
  Layers,
  Loader2,
  LogIn,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import ContextMenu from './components/ContextMenu.jsx';
import TitleBar from './components/TitleBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import CommitGraph from './components/CommitGraph.jsx';
import CommitDetails from './components/CommitDetails.jsx';
import Toasts from './components/Toasts.jsx';
import DiffView from './components/DiffView.jsx';
import StatusBar from './components/StatusBar.jsx';
import InitRepoDialog, { plural } from './components/InitRepoDialog.jsx';
import { GraphLoader, LoadingOverlay, Splash } from './components/Loader.jsx';
import { ResizeHandle, useStoredWidth } from './components/Resizer.jsx';
import {
  AccessDialog,
  BranchDialog,
  Button,
  ConfirmDialog,
  ErrorDialog,
  PushRejectedDialog,
  TagDialog,
} from './components/Dialogs.jsx';

const api = window.api;

// Ошибки, которые показываем модальным окном с подсказкой, а не всплывашкой
const ACCESS_CODES = new Set(['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'PROTECTED', 'HOOK_DECLINED', 'HOST_KEY']);
const OPERATION_LABELS = { rebase: 'rebase', merge: 'merge', 'cherry-pick': 'cherry-pick', revert: 'revert' };

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — настройка просто не запомнится */
  }
}

function readPullMode() {
  try {
    return localStorage.getItem('pullMode') || 'merge';
  } catch {
    return 'merge';
  }
}

export default function App() {
  const [repo, setRepo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [booting, setBooting] = useState(true);
  const [sidebarW, setSidebarW, saveSidebarW] = useStoredWidth('panel.sidebar', 240, 170, 480);
  const [detailsW, setDetailsW, saveDetailsW] = useStoredWidth('panel.details', 300, 250, 680);
  const [loadError, setLoadError] = useState(null);
  const [selectedHash, setSelectedHash] = useState(null);
  const [filesByHash, setFilesByHash] = useState({});
  const [busyAction, setBusyAction] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [access, setAccess] = useState(null);
  const [pullMode, setPullMode] = useState(readPullMode);
  const [menu, setMenu] = useState(null); // { x, y, node }
  const [diffTarget, setDiffTarget] = useState(null); // { kind, mode, hash, parent, file, list, index, commitHash }
  const [diffData, setDiffData] = useState(null);
  const [diffView, setDiffView] = useState(() => readPref('diffView', 'unified'));
  const [ignoreWs, setIgnoreWs] = useState(() => readPref('ignoreWs', '0') === '1');

  // Вкладки: [{ path, name }], активная — по path
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const tabsLoaded = useRef(false);

  const repoRef = useRef(null);
  const busyRef = useRef(false);
  const loadSeq = useRef(0);
  const activeRef = useRef(null);
  const tabCache = useRef(new Map()); // path -> { repo, selectedHash, filesByHash }
  const selectedRef = useRef(null);
  const filesRef = useRef({});
  repoRef.current = repo;
  activeRef.current = activePath;
  selectedRef.current = selectedHash;
  filesRef.current = filesByHash;

  /* ---------- Уведомления ---------- */

  const closeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t.slice(-4), { ...toast, id }]);
      if (toast.type !== 'error') setTimeout(() => closeToast(id), 4500);
    },
    [closeToast],
  );

  /* ---------- Загрузка репозитория ---------- */

  // Загрузка: побеждает последний запрос, устаревшие ответы только кладутся в кэш вкладки
  const loadRepo = useCallback(async (dir, { silent = false } = {}) => {
    if (!api) {
      setLoadError({ message: 'window.api недоступен — запустите приложение через Electron (npm run electron:dev).' });
      return null;
    }
    const seq = ++loadSeq.current;
    if (!silent) {
      setLoading(true);
      setLoadingLabel(dir);
    }

    const res = await api.repo.load(dir);
    const stale = seq !== loadSeq.current;
    if (!stale) setLoading(false);

    if (!res.ok) {
      if (!silent && !stale) setLoadError(res.error);
      return null;
    }

    const data = res.data;
    const cached = tabCache.current.get(data.path);
    tabCache.current.set(data.path, { ...(cached ?? {}), repo: data });
    if (stale || (activeRef.current && activeRef.current !== data.path && silent)) return data;

    const samePath = repoRef.current?.path === data.path;
    if (!samePath) {
      setFilesByHash({});
      setAccess(null);
    }
    setRepo(data);
    setLoadError(null);

    setSelectedHash((prev) => {
      const keep =
        samePath &&
        prev &&
        ((prev === 'WIP' && data.wipFiles.length > 0) || data.commits.some((c) => c.hash === prev));
      if (keep) return prev;
      return data.wipFiles.length > 0 ? 'WIP' : data.headHash;
    });
    return data;
  }, []);

  /* ---------- Вкладки ---------- */

  const rememberActiveTab = () => {
    const current = repoRef.current;
    if (!current) return;
    tabCache.current.set(current.path, {
      repo: current,
      selectedHash: selectedRef.current,
      filesByHash: filesRef.current,
    });
  };

  const showTab = (path) => {
    rememberActiveTab();
    setDiffTarget(null);
    setMenu(null);
    setAccess(null);
    setActivePath(path);
    activeRef.current = path;
    const cached = tabCache.current.get(path);
    if (cached?.repo) {
      // Мгновенно показываем сохранённое состояние, затем тихо обновляем
      repoRef.current = cached.repo;
      setRepo(cached.repo);
      setSelectedHash(cached.selectedHash ?? (cached.repo.wipFiles.length ? 'WIP' : cached.repo.headHash));
      setFilesByHash(cached.filesByHash ?? {});
      loadRepo(path, { silent: true });
    } else {
      loadRepo(path);
    }
  };

  const openTab = async (dir) => {
    rememberActiveTab();
    const data = await loadRepo(dir);
    if (!data) return;
    setTabs((t) => (t.some((x) => x.path === data.path) ? t : [...t, { path: data.path, name: data.name }]));
    setActivePath(data.path);
    activeRef.current = data.path;
  };

  const closeTab = (path) => {
    const index = tabs.findIndex((t) => t.path === path);
    if (index === -1) return;
    const rest = tabs.filter((t) => t.path !== path);
    tabCache.current.delete(path);
    setTabs(rest);
    if (path !== activePath) return;
    if (rest.length) {
      showTab(rest[Math.min(index, rest.length - 1)].path);
    } else {
      loadSeq.current++; // отменяем ответы на ещё идущие загрузки
      setActivePath(null);
      activeRef.current = null;
      setRepo(null);
      repoRef.current = null;
      setDiffTarget(null);
      setSelectedHash(null);
      setLoading(false);
    }
  };

  const cycleTab = (delta) => {
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.path === activePath);
    showTab(tabs[(index + delta + tabs.length) % tabs.length].path);
  };

  // Сохраняем список вкладок
  useEffect(() => {
    if (tabsLoaded.current) api?.tabs?.save(tabs.map((t) => t.path), activePath);
  }, [tabs, activePath]);

  // Заставка при запуске: восстанавливаем вкладки, показываем лоадер хотя бы ~0.8 с
  useEffect(() => {
    let alive = true;
    const started = Date.now();
    (async () => {
      try {
        // Старый preload без tabs — откатываемся к последнему открытому репозиторию
        const saved = api?.tabs
          ? await api.tabs.get()
          : await api?.repo.getLast().then((last) => ({ tabs: last ? [last] : [], active: last }));
        if (!saved) return;
        if (!alive) return;
        setTabs(saved.tabs.map((path) => ({ path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? path })));
        if (saved.active) {
          setActivePath(saved.active);
          activeRef.current = saved.active;
          await loadRepo(saved.active);
        }
      } finally {
        tabsLoaded.current = true;
        const rest = Math.max(0, 800 - (Date.now() - started));
        setTimeout(() => alive && setBooting(false), rest);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadRepo]);

  useEffect(() => {
    if (!api) return undefined;
    return api.window.onFocus(() => {
      if (repoRef.current && !busyRef.current) loadRepo(repoRef.current.path, { silent: true });
    });
  }, [loadRepo]);

  /* ---------- Открытие и создание репозитория ---------- */

  // Открыть: если в папке нет Git — предлагаем мастер инициализации вместо ошибки
  const openRepository = async () => {
    const dir = await api?.repo.openDialog();
    if (!dir) return;
    const res = await api.repo.inspect(dir);
    if (!res.ok) return notify({ type: 'error', title: res.error.message, hint: res.error.hint });
    if (res.data.isRepoRoot || res.data.parentRepo) return openTab(dir);
    setDialog({ type: 'init', info: res.data, reason: 'open', error: null });
  };

  // Создать или подключить: выбрать папку проекта и открыть мастер (mode: 'init' | 'connect')
  const createRepository = async (presetDir, mode = 'init') => {
    const dir =
      presetDir ??
      (await api?.repo.openDialog(
        mode === 'connect' ? 'Выберите папку проекта для подключения к репозиторию' : 'Выберите папку проекта для нового репозитория',
      ));
    if (!dir) return;
    const res = await api.repo.inspect(dir);
    if (!res.ok) return notify({ type: 'error', title: res.error.message, hint: res.error.hint });
    if (res.data.isRepoRoot) {
      notify({ type: 'info', title: `${res.data.name} уже Git-репозиторий — открываем` });
      return openTab(res.data.path);
    }
    setDialog({ type: 'init', info: res.data, reason: 'create', mode, error: null });
  };

  const probeRemote = (url, branch) => api.repo.probeRemote(dialog?.info?.path, { url, branch });

  const submitConnect = async (options) => {
    const info = dialog?.info;
    if (!info) return;
    setInitBusy(true);
    setDialog((d) => ({ ...d, error: null }));
    const res = await api.repo.connect(info.path, options);
    setInitBusy(false);
    if (!res.ok) {
      setDialog((d) => (d?.type === 'init' ? { ...d, error: res.error } : d));
      return;
    }
    const r = res.data;
    setDialog(null);
    const parts = [
      `ветка ${r.branch}`,
      !r.remoteWasEmpty && 'история загружена с сервера',
      r.restored > 0 && `добавлено с сервера: ${r.restored} ${plural(r.restored, 'файл', 'файла', 'файлов')}`,
      r.commit?.hash && `коммит ${r.commit.hash.slice(0, 7)} (${r.commit.files} ${plural(r.commit.files, 'файл', 'файла', 'файлов')})`,
      r.pushed && 'отправлено на сервер',
    ].filter(Boolean);
    notify({ type: 'success', title: `${r.name} подключён к ${r.url}`, hint: parts.join(' · ') });
    if (r.pushError) {
      notify({
        type: 'error',
        title: `Репозиторий подключён, но push не прошёл: ${r.pushError.message}`,
        hint: `${r.pushError.hint ?? ''} Коммит сохранён локально — его можно отправить позже кнопкой Push.`.trim(),
        details: r.pushError.details,
      });
    }
    openTab(r.path);
  };

  const [initBusy, setInitBusy] = useState(false);
  const submitInit = async (options) => {
    const info = dialog?.info;
    if (!info) return;
    setInitBusy(true);
    setDialog((d) => ({ ...d, error: null }));
    const res = await api.repo.init(info.path, options);
    setInitBusy(false);
    if (!res.ok) {
      setDialog((d) => (d?.type === 'init' ? { ...d, error: res.error } : d));
      return;
    }
    const r = res.data;
    setDialog(null);
    notify({
      type: 'success',
      title: `Репозиторий ${r.name} создан`,
      hint: [
        `ветка ${r.branch}`,
        r.commit?.hash &&
          `коммит ${r.commit.hash.slice(0, 7)} (${r.commit.files} ${plural(r.commit.files, 'файл', 'файла', 'файлов')})`,
        r.commit && !r.commit.hash && 'коммит пропущен — нет файлов',
        r.remote && `origin → ${r.remote}`,
      ]
        .filter(Boolean)
        .join(' · '),
    });
    openTab(r.path);
  };

  const openFileMenu = (x, y) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Открыть репозиторий…', icon: FolderOpen, hint: 'Ctrl+O', onClick: openRepository },
        { label: 'Создать репозиторий…', icon: GitBranch, hint: 'Ctrl+N', onClick: () => createRepository() },
        {
          label: 'Подключить папку к GitLab / GitHub…',
          icon: Link2,
          onClick: () => createRepository(undefined, 'connect'),
        },
        { separator: true },
        {
          label: 'Закрыть вкладку',
          icon: X,
          hint: 'Ctrl+W',
          disabled: !activePath,
          onClick: () => activePath && closeTab(activePath),
        },
        { label: 'Выход', onClick: () => api?.window.close() },
      ],
    });

  // Ctrl+O — открыть, Ctrl+W — закрыть вкладку, Ctrl+Tab / Ctrl+Shift+Tab — переключить
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'o' || key === 'щ') {
        e.preventDefault();
        openRepository();
      } else if (key === 'n' || key === 'т') {
        e.preventDefault();
        createRepository();
      } else if ((key === 'w' || key === 'ц') && activePath) {
        e.preventDefault();
        closeTab(activePath);
      } else if (key === 'tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refresh = () => repo && loadRepo(repo.path, { silent: true });

  /* ---------- Проверка доступа к remote ---------- */

  const checkAccess = useCallback(async () => {
    const current = repoRef.current;
    if (!current || current.remotes.length === 0) return null;
    setAccess((a) => ({ status: 'checking', data: a?.data ?? null, error: null }));
    const res = await api.repo.action(current.path, 'checkAccess', { write: true });
    if (repoRef.current?.path !== current.path) return null;
    const next = { status: 'done', data: res.ok ? res.data : null, error: res.ok ? null : res.error };
    setAccess(next);
    return next;
  }, []);

  // Проверяем доступ при открытии репозитория и при смене текущей ветки
  const accessKey = repo && repo.remotes.length ? `${repo.path}|${repo.currentBranch}` : null;
  useEffect(() => {
    if (accessKey) checkAccess();
  }, [accessKey, checkAccess]);

  /* ---------- Запуск действий ---------- */

  /**
   * label   — название действия для сообщений об ошибке
   * success — текст (или функция от data) для уведомления об успехе
   * onError — вернуть true, если ошибка обработана сама
   */
  const run = async (name, payload = {}, { label, success, onError } = {}) => {
    const current = repoRef.current;
    if (!current || busyRef.current) return { ok: false, error: { code: 'BUSY' } };
    busyRef.current = true;
    setBusyAction(name);
    const res = await api.repo.action(current.path, name, payload);
    busyRef.current = false;
    setBusyAction(null);
    await loadRepo(current.path, { silent: true });

    if (res.ok) {
      const text = typeof success === 'function' ? success(res.data) : success;
      if (text) notify({ type: 'success', title: text });
      return res;
    }
    if (onError?.(res.error)) return res;
    if (ACCESS_CODES.has(res.error.code)) {
      setDialog({ type: 'error', action: label ?? name, error: res.error });
      if (['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'HOST_KEY'].includes(res.error.code)) checkAccess();
    } else {
      notify({ type: 'error', title: `${label ?? name}: ${res.error.message}`, hint: res.error.hint, details: res.error.details });
    }
    return res;
  };

  const pull = (mode = pullMode) => {
    setPullMode(mode);
    try {
      localStorage.setItem('pullMode', mode);
    } catch {
      /* хранилище недоступно — не страшно */
    }
    return run('pull', { mode }, {
      label: 'Pull',
      success: (d) => (d.updated ? `Pull: ${d.branch} обновлена из ${d.upstream}` : `${d.branch} уже актуальна`),
    });
  };

  const fetchAll = () =>
    run('fetch', {}, { label: 'Fetch', success: (d) => `Fetch: обновлены ${d.remotes.join(', ')}` });

  const push = (force = false) =>
    run('push', { force }, {
      label: force ? 'Force Push' : 'Push',
      success: (d) =>
        `${d.forced ? 'Force push' : 'Push'}: ${d.branch} → ${d.remote}${d.setUpstream ? ' (upstream установлен)' : ''}`,
      onError: (error) => {
        if (error.code !== 'REJECTED_NON_FF') return false;
        const branch = repoRef.current?.currentBranch;
        setDialog({ type: 'rejected', branch, remote: access?.data?.remote ?? 'origin' });
        return true;
      },
    }).then((res) => {
      if (res.ok) checkAccess();
      return res;
    });

  const pullRebaseThenPush = async () => {
    setDialog(null);
    const res = await run('pull', { mode: 'rebase' }, { label: 'Pull (rebase)' });
    if (res.ok) await push(false);
  };

  const undo = () => run('undo', {}, { label: 'Undo', success: (d) => `Отменено: ${d.label}` });
  const redo = () => run('redo', {}, { label: 'Redo', success: (d) => `Повторено: ${d.label}` });

  const checkout = (target) =>
    run('checkout', target, {
      label: 'Checkout',
      success: (d) =>
        d.created ? `Создана ветка ${d.created.name}, отслеживает ${d.created.track}` : `Checkout: ${d.to.branch}`,
    });

  const stash = () => run('stash', {}, { label: 'Stash', success: (d) => `Спрятано изменений: ${d.files}` });
  const stashPop = () => run('stashPop', {}, { label: 'Pop', success: 'Stash применён' });

  const createBranch = async (params) => {
    setDialog((d) => ({ ...d, error: null }));
    const res = await run('createBranch', params, {
      label: 'Branch',
      success: (d) => `Ветка ${d.name} создана${d.checkedOut ? ' и активна' : ''}`,
      onError: (error) => {
        if (!['INVALID_NAME', 'BRANCH_EXISTS'].includes(error.code)) return false;
        setDialog((d) => (d?.type === 'branch' ? { ...d, error } : d));
        return true;
      },
    });
    if (res.ok) setDialog(null);
  };

  const openBranchDialog = (node) => {
    const sel = node ?? allCommits.find((c) => c.hash === selectedHash);
    const startHash = sel && !sel.wip ? sel.hash : repo.headHash;
    const label = sel && !sel.wip ? `${sel.hash.slice(0, 7)} — ${sel.message}` : `HEAD (${repo.headHash?.slice(0, 7)})`;
    setDialog({ type: 'branch', startHash, startLabel: label, error: null });
  };

  const stageFiles = (paths) => run('stage', { paths }, { label: 'Stage' });
  const unstageFiles = (paths) => run('unstage', { paths }, { label: 'Unstage' });
  const commit = async (summary, description) => {
    const res = await run('commit', { summary, description }, {
      label: 'Commit',
      success: (d) => `Коммит ${d.hash.slice(0, 7)} создан`,
    });
    return res.ok;
  };


  /* ---------- Контекстное меню коммита ---------- */

  const short = (h) => h.slice(0, 7);
  const confirm = (opts) => setDialog({ type: 'confirm', ...opts });

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      notify({ type: 'success', title: `${what} скопирован` });
    } catch {
      notify({ type: 'error', title: 'Не удалось скопировать в буфер обмена' });
    }
  };

  const createTag = async (params) => {
    setDialog((d) => ({ ...d, error: null }));
    const res = await run('createTag', params, {
      label: 'Tag',
      success: (d) => `Тег ${d.name} создан на ${short(d.hash)}`,
      onError: (error) => {
        if (!['INVALID_NAME', 'TAG_EXISTS'].includes(error.code)) return false;
        setDialog((d) => (d?.type === 'tag' ? { ...d, error } : d));
        return true;
      },
    });
    if (res.ok) setDialog(null);
  };

  const deleteBranch = (name, force = false) =>
    run('deleteBranch', { name, force }, {
      label: 'Удаление ветки',
      success: (d) => `Ветка ${d.name} удалена (Undo вернёт её)`,
      onError: (error) => {
        if (error.code !== 'NOT_MERGED') return false;
        confirm({
          title: 'Ветка не слита',
          body: `${error.message}. ${error.hint}`,
          confirmLabel: `Удалить ${name} принудительно`,
          danger: true,
          onConfirm: () => deleteBranch(name, true),
        });
        return true;
      },
    });

  const resetTo = (node, mode) => {
    const doReset = () =>
      run('reset', { hash: node.hash, mode }, {
        label: 'Reset',
        success: (d) => `${d.branch ?? 'HEAD'} сброшена на ${short(d.hash)} (--${d.mode})`,
      });
    if (mode !== 'hard') return doReset();
    const lost = repo.wipFiles.length;
    confirm({
      title: 'Reset --hard',
      body: `Ветка ${repo.currentBranch ?? 'HEAD'} будет перемещена на ${short(node.hash)} «${node.message}».${
        lost ? ` Незакоммиченные изменения (${lost}) будут удалены безвозвратно.` : ''
      } Коммиты после этой точки можно вернуть через Undo.`,
      confirmLabel: 'Reset --hard',
      danger: true,
      onConfirm: doReset,
    });
  };

  const buildCommitMenu = (node) => {
    const cur = repo.currentBranch;
    const curLabel = cur ?? 'HEAD';
    const isHead = node.hash === repo.headHash;
    const op = Boolean(repo.operation);
    const items = [{ header: `${short(node.hash)} · ${node.message}` }];

    items.push(
      {
        label: 'Checkout this commit',
        icon: GitCommitHorizontal,
        hint: 'detached',
        disabled: op || (isHead && repo.detached),
        onClick: () =>
          run('checkoutCommit', { hash: node.hash }, {
            label: 'Checkout',
            success: `HEAD на ${short(node.hash)} (detached) — Undo вернёт на ветку`,
          }),
      },
      { label: 'Create branch here…', icon: GitBranch, onClick: () => openBranchDialog(node) },
      {
        label: 'Create tag here…',
        icon: Tag,
        onClick: () => setDialog({ type: 'tag', hash: node.hash, label: `${short(node.hash)} — ${node.message}` }),
      },
      { separator: true },
      {
        label: `Cherry pick commit`,
        icon: Cherry,
        disabled: op || isHead || !repo.headHash,
        onClick: () =>
          run('cherryPick', { hash: node.hash }, { label: 'Cherry-pick', success: `Коммит ${short(node.hash)} применён к ${curLabel}` }),
      },
      {
        label: 'Revert commit',
        icon: RotateCcw,
        disabled: op || !repo.headHash,
        onClick: () =>
          run('revert', { hash: node.hash }, { label: 'Revert', success: `Создан revert-коммит для ${short(node.hash)}` }),
      },
      {
        label: `Reset ${curLabel} to this commit`,
        icon: History,
        disabled: op || isHead || !repo.headHash,
        submenu: [
          { label: 'Soft — оставить все изменения в индексе', onClick: () => resetTo(node, 'soft') },
          { label: 'Mixed — оставить изменения в рабочей папке', onClick: () => resetTo(node, 'mixed') },
          { label: 'Hard — удалить все изменения', danger: true, onClick: () => resetTo(node, 'hard') },
        ],
      },
    );

    for (const ref of node.refs) {
      if (ref.type === 'local') {
        if (ref.name === cur) continue;
        items.push(
          { separator: true },
          { header: `Ветка ${ref.name}` },
          { label: `Checkout ${ref.name}`, icon: LogIn, disabled: op, onClick: () => checkout({ branch: ref.name }) },
          {
            label: `Merge ${ref.name} into ${curLabel}`,
            icon: GitMerge,
            disabled: op || !cur,
            onClick: () =>
              run('merge', { ref: ref.name }, { label: 'Merge', success: `${ref.name} слита в ${cur}` }),
          },
          {
            label: `Rebase ${curLabel} onto ${ref.name}`,
            icon: Layers,
            disabled: op || !cur,
            onClick: () =>
              run('rebase', { ref: ref.name }, { label: 'Rebase', success: `${cur} перебазирована на ${ref.name}` }),
          },
          {
            label: `Delete ${ref.name}`,
            icon: Trash2,
            danger: true,
            onClick: () =>
              confirm({
                title: 'Удалить ветку',
                body: `Удалить локальную ветку «${ref.name}»? Remote-ветка не затрагивается.`,
                confirmLabel: 'Удалить',
                danger: true,
                onConfirm: () => deleteBranch(ref.name),
              }),
          },
        );
      } else if (ref.type === 'remote') {
        const slash = ref.name.indexOf('/');
        const name = ref.name.slice(slash + 1);
        items.push(
          { separator: true },
          { header: `Remote ${ref.name}` },
          {
            label: `Checkout ${ref.name}`,
            icon: Cloud,
            disabled: op,
            onClick: () => checkout({ remoteBranch: { name, fullName: ref.name } }),
          },
          {
            label: `Merge ${ref.name} into ${curLabel}`,
            icon: GitMerge,
            disabled: op || !cur,
            onClick: () => run('merge', { ref: ref.name }, { label: 'Merge', success: `${ref.name} слита в ${cur}` }),
          },
        );
      } else if (ref.type === 'tag') {
        items.push(
          { separator: true },
          {
            label: `Delete tag ${ref.name}`,
            icon: Trash2,
            danger: true,
            onClick: () =>
              confirm({
                title: 'Удалить тег',
                body: `Удалить локальный тег «${ref.name}»?`,
                confirmLabel: 'Удалить',
                danger: true,
                onConfirm: () =>
                  run('deleteTag', { name: ref.name }, { label: 'Удаление тега', success: `Тег ${ref.name} удалён` }),
              }),
          },
        );
      }
    }

    items.push(
      { separator: true },
      { label: 'Copy commit SHA', icon: Copy, onClick: () => copy(node.hash, 'SHA') },
      {
        label: 'Copy commit message',
        icon: FileText,
        onClick: () => copy(node.description ? `${node.message}\n\n${node.description}` : node.message, 'Текст коммита'),
      },
    );
    return items;
  };

  const buildWipMenu = () => {
    const op = Boolean(repo.operation);
    return [
      { header: `Изменения: ${repo.wipFiles.length}` },
      { label: 'Stash all changes', icon: Archive, disabled: op || !repo.headHash, onClick: stash },
      { label: 'Stage all changes', icon: GitCommitHorizontal, onClick: () => stageFiles('all') },
      { separator: true },
      {
        label: 'Discard all changes',
        icon: Eraser,
        danger: true,
        disabled: op,
        onClick: () =>
          confirm({
            title: 'Отменить все изменения',
            body: 'Все незакоммиченные изменения, включая новые неотслеживаемые файлы, будут удалены без возможности восстановления.',
            confirmLabel: 'Удалить изменения',
            danger: true,
            onConfirm: () => run('discardAll', {}, { label: 'Discard', success: (d) => `Отменены изменения в ${d.files} файлах` }),
          }),
      },
    ];
  };

  const openMenu = (node, x, y) => setMenu({ x, y, items: node.wip ? buildWipMenu() : buildCommitMenu(node) });
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDiff = useCallback(() => setDiffTarget(null), []);

  /* ---------- Коммиты и выбор ---------- */

  const allCommits = useMemo(() => {
    if (!repo) return [];
    if (repo.wipFiles.length === 0) return repo.commits;
    const wip = {
      hash: 'WIP',
      wip: true,
      parents: repo.headHash ? [repo.headHash] : [],
      message: '// WIP',
      refs: [],
    };
    return [wip, ...repo.commits];
  }, [repo]);

  const selected = allCommits.find((c) => c.hash === selectedHash) ?? null;

  useEffect(() => {
    if (!repo || !selected || selected.wip || filesByHash[selected.hash]) return undefined;
    let cancelled = false;
    api.repo.commitFiles(repo.path, selected.hash, selected.parents[0]).then((res) => {
      if (cancelled) return;
      setFilesByHash((m) => ({ ...m, [selected.hash]: res.ok ? res.data : { error: res.error.message } }));
    });
    return () => {
      cancelled = true;
    };
  }, [repo, selected, filesByHash]);


  /* ---------- Просмотр изменений файла ---------- */

  // kind: 'commit' | 'staged' | 'unstaged'; list — файлы этой группы для навигации ←/→
  const openFile = (file, kind, list) => {
    const index = Math.max(0, list.findIndex((f) => f.path === file.path));
    const commit = kind === 'commit' ? allCommits.find((c) => c.hash === selectedHash) : null;
    const mode = kind === 'commit' ? 'commit' : kind === 'staged' ? 'staged' : file.untracked ? 'untracked' : 'unstaged';
    setDiffTarget({
      kind,
      mode,
      hash: commit?.hash,
      parent: commit?.parents[0] ?? null,
      commitHash: commit?.hash ?? 'WIP',
      file,
      list,
      index,
    });
  };

  const stepFile = (delta) => {
    if (!diffTarget) return null;
    const next = diffTarget.index + delta;
    if (next < 0 || next >= diffTarget.list.length) return null;
    return () => openFile(diffTarget.list[next], diffTarget.kind, diffTarget.list);
  };

  // Закрываем diff, если выбран другой коммит
  useEffect(() => {
    if (diffTarget && diffTarget.commitHash !== selectedHash) setDiffTarget(null);
  }, [selectedHash, diffTarget]);

  // Для WIP файл мог уйти из группы (застейджен/закоммичен) — переключаемся или закрываем
  useEffect(() => {
    if (!repo || !diffTarget || diffTarget.kind === 'commit') return;
    const staged = diffTarget.kind === 'staged';
    const group = repo.wipFiles.filter((f) => f.staged === staged);
    const still = group.find((f) => f.path === diffTarget.file.path);
    if (still) {
      if (group.length !== diffTarget.list.length || still.status !== diffTarget.file.status) {
        openFile(still, diffTarget.kind, group);
      }
      return;
    }
    const other = repo.wipFiles.find((f) => f.path === diffTarget.file.path);
    if (other) openFile(other, other.staged ? 'staged' : 'unstaged', repo.wipFiles.filter((f) => f.staged === other.staged));
    else setDiffTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // Загрузка diff (для WIP — заново при каждом обновлении репозитория)
  const diffReload = diffTarget && diffTarget.kind !== 'commit' ? repo : null;
  useEffect(() => {
    if (!diffTarget || !repoRef.current) {
      setDiffData(null);
      return undefined;
    }
    let cancelled = false;
    const t = diffTarget;
    setDiffData((d) => (d && d.path === t.file.path && d.mode === t.mode ? d : null));
    api.repo
      .fileDiff(repoRef.current.path, {
        mode: t.mode,
        hash: t.hash,
        parent: t.parent,
        path: t.file.path,
        oldPath: t.file.oldPath,
        conflicted: t.file.status === 'U',
        ignoreWhitespace: ignoreWs,
      })
      .then((res) => {
        if (cancelled) return;
        setDiffData(res.ok ? { ...res.data, mode: t.mode } : { error: res.error.message, path: t.file.path, mode: t.mode });
      });
    return () => {
      cancelled = true;
    };
  }, [diffTarget, ignoreWs, diffReload]);

  /* ---------- Двойной клик по коммиту ---------- */

  // Как в GitKraken: есть локальная ветка — checkout ветки, есть только remote — создать локальную,
  // иначе — checkout самого коммита (detached HEAD)
  const activateCommit = (node) => {
    if (node.wip || busyRef.current) return;
    const cur = repo.currentBranch;
    const local = node.refs.find((r) => r.type === 'local' && r.name !== cur);
    if (local) return checkout({ branch: local.name });
    if (node.refs.some((r) => r.type === 'local' && r.name === cur)) return null; // уже на этой ветке
    const remote = node.refs.find((r) => r.type === 'remote');
    if (remote) {
      const name = remote.name.slice(remote.name.indexOf('/') + 1);
      return checkout({ remoteBranch: { name, fullName: remote.name } });
    }
    if (node.hash === repo.headHash) return null;
    return run('checkoutCommit', { hash: node.hash }, {
      label: 'Checkout',
      success: `HEAD на ${node.hash.slice(0, 7)} (detached) — Undo вернёт на ветку`,
    });
  };

  /* ---------- Разметка ---------- */

  return (
    <div className="flex h-full flex-col text-gk-text">
      <div className="app-backdrop" />
      {booting && <Splash subtitle={loading ? 'Загружаем репозиторий…' : 'Запуск…'} />}
      <TitleBar
        tabs={tabs}
        activePath={activePath}
        loadingPath={loading ? loadingLabel : null}
        onSelectTab={(path) => path !== activePath && showTab(path)}
        onCloseTab={closeTab}
        onOpenRepository={openRepository}
        onFileMenu={openFileMenu}
      />

      {loadError && <ErrorBanner error={loadError} onClose={() => setLoadError(null)} />}

      {repo ? (
        <>
          <Toolbar
            repo={repo}
            loading={loading}
            busyAction={busyAction}
            access={access}
            pullMode={pullMode}
            onOpenRepository={openRepository}
            onRefresh={refresh}
            onUndo={undo}
            onRedo={redo}
            onPull={pull}
            onFetch={fetchAll}
            onPush={() => push(false)}
            onBranch={() => openBranchDialog()}
            onStash={stash}
            onPop={stashPop}
            onAccessClick={() => setDialog({ type: 'access' })}
          />

          {repo.operation && (
            <OperationBanner
              operation={repo.operation}
              conflicts={repo.wipFiles.filter((f) => f.status === 'U').length}
              busy={Boolean(busyAction)}
              onContinue={() =>
                run('continueOperation', {}, {
                  label: 'Продолжить',
                  success: (d) => (d.finished ? `${OPERATION_LABELS[d.operation]} завершён` : 'Следующий шаг'),
                })
              }
              onAbort={() =>
                run('abortOperation', {}, {
                  label: 'Прервать',
                  success: (d) => `${OPERATION_LABELS[d.operation]} прерван, состояние восстановлено`,
                })
              }
            />
          )}

          <div className="relative flex min-h-0 flex-1 animate-fade-in">
            {loading && !booting && <LoadingOverlay label={loadingLabel} />}
            <div style={{ width: sidebarW }} className="relative flex shrink-0">
              <Sidebar repo={repo} selectedHash={selectedHash} onSelect={setSelectedHash} onCheckout={checkout} />
              <ResizeHandle
                width={sidebarW}
                onResize={setSidebarW}
                onCommit={saveSidebarW}
                onReset={() => {
                  setSidebarW(null);
                  saveSidebarW(null);
                }}
                className="-right-1"
              />
            </div>
            <main className="flex min-w-0 flex-1 flex-col">
              {diffTarget ? (
                <DiffView
                  key={`${diffTarget.kind}:${diffTarget.file.path}`}
                  target={diffTarget}
                  data={diffData && diffData.path === diffTarget.file.path && diffData.mode === diffTarget.mode ? diffData : null}
                  view={diffView}
                  ignoreWhitespace={ignoreWs}
                  onViewChange={(v) => {
                    setDiffView(v);
                    writePref('diffView', v);
                  }}
                  onToggleWhitespace={() => {
                    setIgnoreWs((v) => {
                      writePref('ignoreWs', v ? '0' : '1');
                      return !v;
                    });
                  }}
                  onPrev={stepFile(-1)}
                  onNext={stepFile(1)}
                  onClose={closeDiff}
                />
              ) : (
                <CommitGraph
                  commits={allCommits}
                  introKey={repo.path}
                  selectedHash={selectedHash}
                  onSelect={setSelectedHash}
                  onActivate={activateCommit}
                  onContextMenu={openMenu}
                  wipCount={repo.wipFiles.length}
                  truncated={repo.truncated}
                />
              )}
            </main>
            <div style={{ width: detailsW }} className="relative flex shrink-0">
              <ResizeHandle
                width={detailsW}
                direction={-1}
                onResize={setDetailsW}
                onCommit={saveDetailsW}
                onReset={() => {
                  setDetailsW(null);
                  saveDetailsW(null);
                }}
                className="-left-1"
              />
              <CommitDetails
                commit={selected}
                files={selected && !selected.wip ? filesByHash[selected.hash] : null}
                repo={repo}
                busy={Boolean(busyAction)}
                activeFile={diffTarget ? { kind: diffTarget.kind, path: diffTarget.file.path } : null}
                onOpenFile={openFile}
                onSelectCommit={setSelectedHash}
                onStage={stageFiles}
                onUnstage={unstageFiles}
                onCommit={commit}
              />
            </div>
          </div>
        </>
      ) : (
        <Welcome
          loading={loading}
          onOpen={openRepository}
          onCreate={() => createRepository()}
          onConnect={() => createRepository(undefined, 'connect')}
        />
      )}

      {repo && (
        <StatusBar
          repo={repo}
          onJumpToHead={() => {
            setDiffTarget(null);
            setSelectedHash(repo.headHash);
          }}
        />
      )}

      {dialog?.type === 'error' && (
        <ErrorDialog
          action={dialog.action}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onCheckAccess={repo?.remotes.length ? () => setDialog({ type: 'access' }) : null}
        />
      )}
      {dialog?.type === 'access' && (
        <AccessDialog access={access} onClose={() => setDialog(null)} onRecheck={checkAccess} />
      )}
      {dialog?.type === 'rejected' && (
        <PushRejectedDialog
          branch={dialog.branch}
          remote={dialog.remote}
          onClose={() => setDialog(null)}
          onPull={pullRebaseThenPush}
          onForce={() => {
            setDialog(null);
            push(true);
          }}
        />
      )}
      {dialog?.type === 'branch' && (
        <BranchDialog
          startHash={dialog.startHash}
          startLabel={dialog.startLabel}
          busy={busyAction === 'createBranch'}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onSubmit={createBranch}
        />
      )}

      {dialog?.type === 'init' && (
        <InitRepoDialog
          key={dialog.info.path}
          info={dialog.info}
          reason={dialog.reason}
          initialMode={dialog.mode ?? 'init'}
          busy={initBusy}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onSubmit={submitInit}
          onSubmitConnect={submitConnect}
          onProbe={probeRemote}
          onChangeFolder={() => {
            setDialog(null);
            createRepository();
          }}
          onOpenParent={() => {
            const parent = dialog.info.parentRepo;
            setDialog(null);
            openTab(parent);
          }}
        />
      )}
      {dialog?.type === 'tag' && (
        <TagDialog
          hash={dialog.hash}
          label={dialog.label}
          busy={busyAction === 'createTag'}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onSubmit={createTag}
        />
      )}
      {dialog?.type === 'confirm' && (
        <ConfirmDialog
          title={dialog.title}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.onConfirm}
          onClose={() => setDialog(null)}
        >
          <p className="leading-relaxed">{dialog.body}</p>
        </ConfirmDialog>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      <Toasts toasts={toasts} onClose={closeToast} />
    </div>
  );
}

function OperationBanner({ operation, conflicts, busy, onContinue, onAbort }) {
  return (
    <div className="glass flex shrink-0 animate-slide-up items-center gap-3 border-b border-gk-yellow/30 bg-gk-yellow/10 px-3 py-2 text-xs">
      <AlertTriangle size={14} className="shrink-0 text-gk-yellow" />
      <span className="flex-1">
        Идёт <b>{OPERATION_LABELS[operation]}</b>
        {conflicts > 0
          ? ` — конфликтов: ${conflicts}. Исправьте файлы, застейджите их и нажмите «Продолжить».`
          : ' — конфликтов нет, можно продолжить.'}
      </span>
      <Button onClick={onAbort} disabled={busy} className="py-1 text-xs">
        Прервать
      </Button>
      <Button variant="primary" onClick={onContinue} disabled={busy || conflicts > 0} className="py-1 text-xs">
        Продолжить
      </Button>
    </div>
  );
}

function Welcome({ loading, onOpen, onCreate, onConnect }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5">
      <div className="glass-strong flex h-24 w-24 animate-pop-in items-center justify-center rounded-3xl border border-gk-border bg-gk-panel">
        {loading ? <GraphLoader size={52} /> : <GitBranch size={38} className="text-gk-green" />}
      </div>
      <div className="animate-slide-up text-center">
        <h1 className="text-lg font-semibold text-white">Откройте репозиторий</h1>
        <p className="mt-1 text-gk-muted">Выберите папку с локальным Git-репозиторием</p>
      </div>
      <button
        onClick={onOpen}
        disabled={loading}
        className="flex animate-slide-up items-center gap-2 rounded-lg bg-gk-green px-5 py-2.5 font-semibold text-gk-ink shadow-lg shadow-gk-green/20 transition hover:shadow-gk-green/40 hover:brightness-110 disabled:opacity-60"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
        {loading ? 'Загрузка…' : 'Открыть репозиторий'}
      </button>
      <button
        onClick={onCreate}
        disabled={loading}
        className="flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        <GitBranch size={15} />
        Создать репозиторий в папке проекта
      </button>
      <button
        onClick={onConnect}
        disabled={loading}
        className="-mt-3 flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        <Link2 size={15} />
        Подключить папку проекта к GitLab / GitHub
      </button>
      <p className="max-w-sm animate-fade-in text-center text-xs text-gk-dim">
        Ctrl+O — открыть · Ctrl+N — создать. Если в выбранной папке нет Git, приложение предложит его инициализировать.
      </p>
    </div>
  );
}

function ErrorBanner({ error, onClose }) {
  return (
    <div className="glass flex shrink-0 animate-slide-up items-start gap-2 border-b border-gk-red/40 bg-gk-red/10 px-3 py-2 text-xs text-gk-text">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-red" />
      <div className="min-w-0 flex-1 select-text">
        <div>{error.message}</div>
        {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
      </div>
      <button onClick={onClose} className="rounded p-0.5 text-gk-muted hover:bg-gk-hover hover:text-gk-text">
        <X size={14} />
      </button>
    </div>
  );
}
