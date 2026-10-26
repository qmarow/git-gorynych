import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  WandSparkles,
  Cherry,
  Cloud,
  Copy,
  Eraser,
  FileText,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  FastForward,
  FolderPlus,
  ArchiveRestore,
  CloudOff,
  Check,
  Minus,
  Plus,
  FileDiff,
  Flag,
  GitCommitHorizontal,
  GitMerge,
  History,
  CloudDownload,
  Link2,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  ArrowUpToLine,
  ArrowUpFromLine,
  Keyboard,
  Info,
  Palette,
  Plug,
  Redo2,
  Search,
  Undo2,
  PackageOpen,
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
import ConflictView from './components/ConflictView.jsx';
import CiView from './components/CiView.jsx';
import RebaseView from './components/RebaseView.jsx';
import CompareView from './components/CompareView.jsx';
import GuideDialog from './components/GuideDialog.jsx';
import ActionBuilder, { ACTION_ICONS } from './components/ActionBuilder.jsx';
import { RunDialog, RunnerCard } from './components/ActionRunner.jsx';
import { GuardDialog } from './components/Guard.jsx';
import { activeRules, guardOnFor, readGuard, writeGuard } from './lib/guardRules.js';
import { STEP_TYPES, defaultBranchOf, expandParams, hotkeyFromEvent, inputsOf, readActions, validateAction, writeActions } from './lib/actions.js';
import SettingsDialog from './components/SettingsDialog.jsx';
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  cacheAppearance,
  normalizeAppearance,
  readCachedAppearance,
  themeById,
} from './lib/appearance.js';
import { ACTIVE_STATUSES } from './components/PipelineStatus.jsx';
import StatusBar from './components/StatusBar.jsx';
import InitRepoDialog, { plural } from './components/InitRepoDialog.jsx';
import CloneDialog from './components/CloneDialog.jsx';
import RevertToDialog from './components/RevertToDialog.jsx';
import SearchBar, { EMPTY_FILTER, isFilterActive, matchCommit } from './components/SearchBar.jsx';
import { GraphLoader, LoadingOverlay, Splash } from './components/Loader.jsx';
import AppLogo from './components/AppLogo.jsx';
import { ResizeHandle, useStoredWidth } from './components/Resizer.jsx';
import {
  AccessDialog,
  BranchDialog,
  Button,
  ConfirmDialog,
  DeleteRemoteDialog,
  ErrorDialog,
  Modal,
  PushRejectedDialog,
  TagDialog,
} from './components/Dialogs.jsx';

const api = window.api;

// Ошибки, которые показываем модальным окном с подсказкой, а не всплывашкой
const ACCESS_CODES = new Set(['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'PROTECTED', 'HOOK_DECLINED', 'HOST_KEY']);
// Оверлей поверх графа для долгих операций: что показывать, пока операция идёт
const PROGRESS_TEXT = {
  checkout: 'Переключаем ветку…',
  checkoutCommit: 'Переключаемся на коммит…',
  pull: 'Получаем изменения с сервера…',
  push: 'Отправляем на сервер…',
  fetch: 'Загружаем данные с сервера…',
  merge: 'Слияние веток…',
  rebase: 'Перебазирование…',
  rebaseApply: 'Применяем rebase…',
  rebaseStart: 'Перебазирование…',
  cherryPick: 'Cherry-pick…',
  revert: 'Создаём revert-коммит…',
  revertTo: 'Возвращаем файлы проекта…',
  reset: 'Перемещаем ветку…',
  stash: 'Прячем изменения…',
  stashPop: 'Применяем stash…',
  stashApplyAt: 'Применяем stash…',
  stashPopAt: 'Применяем stash…',
  undo: 'Отменяем…',
  redo: 'Повторяем…',
  createBranch: 'Создаём ветку…',
  continueOperation: 'Продолжаем…',
  abortOperation: 'Прерываем…',
};

const AUTO_FETCH_MIN = 5; // как часто фоново забирать изменения с сервера

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
  const [busyText, setBusyText] = useState(null); // текст оверлея для долгих операций (checkout, pull…)
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [access, setAccess] = useState(null);
  const [pullMode, setPullMode] = useState(readPullMode);
  // Поведение: умное переключение веток (по умолчанию включено)
  const [workflow, setWorkflow] = useState(() => ({ smartSwitch: readPref('smartSwitch', '1') !== '0' }));
  const updateWorkflow = (next) => {
    setWorkflow(next);
    writePref('smartSwitch', next.smartSwitch ? '1' : '0');
  };
  // Pre-commit Guard: правила и последняя проверка staged-изменений
  const [guardCfg, setGuardCfg] = useState(readGuard);
  const updateGuard = (next) => {
    setGuardCfg(next);
    writeGuard(next);
  };
  const [guardResult, setGuardResult] = useState(null);
  // Конструктор действий
  const [userActions, setUserActions] = useState(readActions);
  const updateActions = (list) => {
    setUserActions(list);
    writeActions(list);
  };
  const [actionRun, setActionRun] = useState(null); // ход выполнения
  const [dragSource, setDragSource] = useState(null); // перетаскиваемый коммит/ветка
  const [runPrompt, setRunPrompt] = useState(null); // { action, inputs } — спросить значения перед запуском
  const [menu, setMenu] = useState(null); // { x, y, node }
  const [diffTarget, setDiffTarget] = useState(null); // { kind, mode, hash, parent, file, list, index, commitHash }
  const [ciView, setCiViewRaw] = useState(null); // { file, mode, pipelineId } — открыт просмотр CI/CD
  const [compareView, setCompareViewRaw] = useState(null); // { a, b } — сравнение двух коммитов
  const [rebaseView, setRebaseViewRaw] = useState(null); // { upstream, onto?, nonce } — интерактивный rebase
  const [compareMark, setCompareMark] = useState(null); // коммит, отмеченный для сравнения
  // В центре одновременно открыта только одна большая панель
  const setCiView = (v) => {
    setCiViewRaw(v);
    if (v) {
      setCompareViewRaw(null);
      setRebaseViewRaw(null);
    }
  };
  const setCompareView = (v) => {
    setCompareViewRaw(v);
    if (v) {
      setCiViewRaw(null);
      setRebaseViewRaw(null);
      setDiffTarget(null);
    }
  };
  const setRebaseView = (v) => {
    setRebaseViewRaw(v);
    if (v) {
      setCiViewRaw(null);
      setCompareViewRaw(null);
      setDiffTarget(null);
    }
  };
  const [pipelineMap, setPipelineMap] = useState(null);
  // Оформление: тема, фон, прозрачность. Кэш в localStorage — чтобы не мигало при запуске
  const [appearance, setAppearance] = useState(readCachedAppearance);
  const [appearanceMeta, setAppearanceMeta] = useState({ supportsMaterial: false, hasImage: false });
  const [bgImage, setBgImage] = useState(null);
  const saveAppearanceTimer = useRef(null); // статусы пайплайнов GitLab: { bySha, pipelines, error }
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
        ((prev === 'WIP' && data.wipFiles.length > 0) ||
          (prev.startsWith('stash:') && data.stashes.some((st) => `stash:${st.hash}` === prev)) ||
          data.commits.some((c) => c.hash === prev));
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
    setCiView(null);
    setCompareView(null);
    setRebaseView(null);
    setCompareMark(null);
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
        { label: 'Клонировать репозиторий…', icon: CloudDownload, hint: 'Ctrl+Shift+O', onClick: () => setDialog({ type: 'clone' }) },
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
        { label: 'Выход', icon: LogOut, onClick: () => api?.window.close() },
      ],
    });

  // Ctrl+O — открыть, Ctrl+W — закрыть вкладку, Ctrl+Tab / Ctrl+Shift+Tab — переключить
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.code === 'Comma' && !e.shiftKey) {
        e.preventDefault();
        setDialog((d) => (d ? d : { type: 'settings', tab: 'appearance' }));
        return;
      }
      if ((key === 'o' || key === 'щ') && e.shiftKey) {
        e.preventDefault();
        setDialog({ type: 'clone' });
      } else if ((key === 'f' || key === 'а') && repoRef.current) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (key === 'o' || key === 'щ') {
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
  const run = async (name, payload = {}, { label, success, onError, progress } = {}) => {
    const current = repoRef.current;
    if (!current || busyRef.current) return { ok: false, error: { code: 'BUSY' } };
    busyRef.current = true;
    setBusyAction(name);
    setBusyText(progress ?? null);
    const res = await api.repo.action(current.path, name, payload);
    busyRef.current = false;
    setBusyAction(null);
    setBusyText(null);
    await loadRepo(current.path, { silent: true });

    if (res.ok) {
      const text = typeof success === 'function' ? success(res.data) : success;
      if (text) notify({ type: 'success', title: text });
      return res;
    }
    if (res.error.code === 'CONFLICT') autoOpenConflict.current = true;
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
  // Актуальные обработчики для глобальных горячих клавиш (эффект регистрируется один раз)
  const hotkeys = useRef({});
  const redo = () => run('redo', {}, { label: 'Redo', success: (d) => `Повторено: ${d.label}` });

  hotkeys.current = { undo, redo, repo, busyAction };

  // Ctrl+Z / Ctrl+Y — отменить/повторить (не в полях ввода), F1 — горячие клавиши
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setDialog((d) => d ?? { type: 'guide' });
        return;
      }
      if (!e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('.fixed.inset-0')) return;
      const { undo: doUndo, redo: doRedo, repo: r, busyAction: busy } = hotkeys.current;
      if (!r || busy) return;
      const isZ = e.code === 'KeyZ';
      const isY = e.code === 'KeyY';
      if (isZ && !e.shiftKey && r.history?.undo) {
        e.preventDefault();
        doUndo();
      } else if ((isY || (isZ && e.shiftKey)) && r.history?.redo) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  const checkout = (target) =>
    run('checkout', { ...target, smart: workflow.smartSwitch }, {
      label: 'Checkout',
      progress: `Переключаемся на ${target.branch ?? target.remoteBranch?.fullName ?? ''}`,
      success: (d) => {
        const parts = [d.created ? `Создана ветка ${d.created.name}, отслеживает ${d.created.track}` : `Checkout: ${d.to.branch}`];
        if (d.autoStash) parts.push(`правки ${d.autoStash.branch} спрятаны (${d.autoStash.files}) — вернутся при возврате`);
        if (d.restored && !d.restored.conflict) parts.push(`правки ${d.restored.branch} восстановлены`);
        if (d.restored?.conflict) {
          notify({
            type: 'error',
            title: `Правки ветки ${d.restored.branch} вернулись с конфликтом`,
            hint: 'Stash сохранён в списке Stashes. Решите конфликты в файлах с пометкой U или откатите их и примените stash позже.',
          });
        }
        return parts.join(' · ');
      },
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

  // Создание ветки прямо из списка веток: от HEAD и сразу переключиться
  const quickCreateBranch = (name) =>
    run('createBranch', { name, checkout: true }, {
      label: 'Branch',
      progress: `Создаём ветку ${name}`,
      success: (d) => `Ветка ${d.name} создана и активна`,
    });

  // Показать коммит в графе: выделить и прокрутить к нему
  const locateCommit = (hash) => {
    if (!hash) return;
    setDiffTarget(null);
    setCiView(null);
    setCompareView(null);
    setRebaseView(null);
    setSelectedHash(hash);
  };

  const openBranchDialog = (node) => {
    const sel = node ?? allCommits.find((c) => c.hash === selectedHash);
    const startHash = sel && !sel.wip ? sel.hash : repo.headHash;
    const label = sel && !sel.wip ? `${sel.hash.slice(0, 7)} — ${sel.message}` : `HEAD (${repo.headHash?.slice(0, 7)})`;
    setDialog({ type: 'branch', startHash, startLabel: label, error: null });
  };

  const stageFiles = (paths) => run('stage', { paths }, { label: 'Stage' });
  const unstageFiles = (paths) => run('unstage', { paths }, { label: 'Unstage' });
  // Pre-commit Guard: проверка добавленных строк; если что-то нашлось — спрашиваем
  const guardCheck = async (path) => {
    if (!guardOnFor(guardCfg, path) || !api.repo.guardScan) return true;
    let scan;
    try {
      scan = await api.repo.guardScan(path, { rules: activeRules(guardCfg), exclude: guardCfg.exclude });
    } catch {
      return true; // сама проверка сломалась — коммиту это мешать не должно
    }
    if (!scan?.ok || !scan.data.findings.length) return true;
    return new Promise((resolve) => setDialog({ type: 'guard', mode: 'commit', result: scan.data, resolve }));
  };

  const commit = async (summary, description) => {
    if (!repoRef.current || busyRef.current) return false;
    if (!(await guardCheck(repoRef.current.path))) return false;
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

  // Пункты меню одной ветки/тега — для меню коммита, поповера «+N» и списка веток слева
  const buildRefItems = (ref) => {
    const cur = repo.currentBranch;
    const curLabel = cur ?? 'HEAD';
    const op = Boolean(repo.operation);
    if (ref.type === 'local') {
      const isCur = ref.name === cur;
      const info = repo.localBranches.find((b) => b.name === ref.name);
      return [
        { header: `Ветка ${ref.name}` },
        { label: `Checkout ${ref.name}`, icon: LogIn, disabled: op || isCur, onClick: () => checkout({ branch: ref.name }) },
        {
          label: `Merge ${ref.name} into ${curLabel}`,
          icon: GitMerge,
          disabled: op || !cur || isCur,
          onClick: () => run('merge', { ref: ref.name }, { label: 'Merge', success: `${ref.name} слита в ${cur}` }),
        },
        {
          label: `Rebase ${curLabel} onto ${ref.name}…`,
          icon: Layers,
          disabled: op || !cur || isCur,
          title: 'С предпросмотром: итоговый граф, конфликты и изменения видны до применения',
          onClick: () => openRebase(ref.name),
        },
        {
          label: `Delete ${ref.name}`,
          icon: Trash2,
          danger: true,
          disabled: isCur,
          title: isCur ? 'Нельзя удалить текущую ветку' : 'Удалить локальную ветку. Ветка на сервере не затрагивается.',
          onClick: () =>
            confirm({
              title: 'Удалить ветку',
              body: `Удалить локальную ветку «${ref.name}»? Remote-ветка не затрагивается.`,
              confirmLabel: 'Удалить',
              danger: true,
              onConfirm: () => deleteBranch(ref.name),
            }),
        },
        ...(info?.upstream && !info.gone
          ? [
              {
                label: `Удалить ${info.upstream} с сервера…`,
                icon: CloudOff,
                danger: true,
                title: 'Удалить ветку на сервере (git push --delete). Локальная ветка останется.',
                onClick: () => askDeleteRemote(info.upstream),
              },
            ]
          : []),
      ];
    }
    if (ref.type === 'remote') {
      const slash = ref.name.indexOf('/');
      const name = ref.name.slice(slash + 1);
      return [
        { header: `На сервере: ${ref.name}` },
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
        {
          label: `Rebase ${curLabel} onto ${ref.name}…`,
          icon: Layers,
          disabled: op || !cur,
          title: 'С предпросмотром: итоговый граф, конфликты и изменения видны до применения',
          onClick: () => openRebase(ref.name),
        },
        {
          label: `Удалить ${ref.name} с сервера…`,
          icon: CloudOff,
          danger: true,
          title: 'Удалить ветку на сервере (git push --delete) — для всех, кто работает с репозиторием',
          onClick: () => askDeleteRemote(ref.name),
        },
      ];
    }
    if (ref.type === 'tag') {
      return [
        { header: `Тег ${ref.name}` },
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
              onConfirm: () => run('deleteTag', { name: ref.name }, { label: 'Удаление тега', success: `Тег ${ref.name} удалён` }),
            }),
        },
      ];
    }
    return [];
  };

  // Удаление ветки на сервере: подтверждение → git push --delete (с индикатором в окне)
  const askDeleteRemote = (fullName) => {
    const slash = fullName.indexOf('/');
    if (slash <= 0) return;
    const remote = fullName.slice(0, slash);
    const branch = fullName.slice(slash + 1);
    const locals = repo.localBranches.filter((b) => b.upstream === fullName).map((b) => b.name);
    setDialog({ type: 'deleteRemote', remote, branch, fullName, locals, busy: false, error: null });
  };
  const confirmDeleteRemote = async () => {
    const d = dialog;
    if (!d || d.type !== 'deleteRemote' || d.busy) return;
    setDialog({ ...d, busy: true, error: null });
    const res = await run('deleteRemoteBranch', { remote: d.remote, branch: d.branch }, {
      label: 'Удаление с сервера',
      progress: `Удаляем ${d.fullName} с сервера…`,
      success: `Ветка ${d.branch} удалена с ${d.remote} — Undo вернёт её на сервер`,
      onError: () => true,
    });
    if (res.ok) setDialog(null);
    else setDialog((cur) => (cur?.type === 'deleteRemote' ? { ...cur, busy: false, error: res.error } : cur));
  };

  const openRefMenu = (ref, x, y) => {
    const items = buildRefItems(ref);
    if (items.length) setMenu({ x, y, items });
  };
  const refActions = {
    checkout: (ref) => {
      if (ref.type === 'local') return ref.name !== repo.currentBranch && checkout({ branch: ref.name });
      if (ref.type === 'remote') {
        const name = ref.name.slice(ref.name.indexOf('/') + 1);
        return checkout({ remoteBranch: { name, fullName: ref.name } });
      }
      return null;
    },
    deleteRemote: askDeleteRemote,
    menu: openRefMenu,
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
        label: 'Вернуть проект к этому коммиту…',
        icon: History,
        disabled: op || isHead || !repo.headHash,
        title: 'Новый коммит, который делает все файлы как в этом коммите. История не переписывается.',
        onClick: () => openRevertTo(node),
      },
      {
        label: `Reset ${curLabel} to this commit`,
        icon: History,
        disabled: op || isHead || !repo.headHash,
        submenu: [
          { label: 'Soft — оставить все изменения в индексе', icon: Archive, onClick: () => resetTo(node, 'soft') },
          { label: 'Mixed — оставить изменения в рабочей папке', icon: FileDiff, onClick: () => resetTo(node, 'mixed') },
          { label: 'Hard — удалить все изменения', icon: Trash2, danger: true, onClick: () => resetTo(node, 'hard') },
        ],
      },
      { separator: true },
      ...rebaseItems(node),
      { separator: true },
      ...compareItems(node),
    );

    for (const ref of node.refs) {
      if (ref.type === 'local' && ref.name === cur) continue;
      const refItems = buildRefItems(ref);
      if (refItems.length) items.push({ separator: true }, ...refItems);
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

  /* ---------- Интерактивный rebase и сравнение ---------- */

  // Коммиты, достижимые из HEAD (среди загруженных) — чтобы понять, «история ветки» это или чужой коммит
  const headAncestors = useMemo(() => {
    const set = new Set();
    if (!repo?.headHash) return set;
    const byHash = new Map(repo.commits.map((c) => [c.hash, c]));
    const stack = [repo.headHash];
    while (stack.length) {
      const h = stack.pop();
      if (set.has(h)) continue;
      set.add(h);
      for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
    }
    return set;
  }, [repo?.commits, repo?.headHash]);

  const openRebase = (upstream, onto) => {
    if (!repo?.currentBranch) {
      notify({ type: 'error', title: 'Rebase делается для ветки', hint: 'Сейчас detached HEAD — переключитесь на ветку.' });
      return;
    }
    setRebaseView({ upstream, onto, nonce: Date.now() });
  };

  const rebaseItems = (node) => {
    const cur = repo.currentBranch;
    const op = Boolean(repo.operation);
    if (!cur || !repo.headHash) return [];
    const isHead = node.hash === repo.headHash;
    if (headAncestors.has(node.hash)) {
      if (isHead) return node.parents[0] ? [{ label: 'Изменить последний коммит (rebase)…', icon: Layers, disabled: op, onClick: () => openRebase(node.parents[0]) }] : [];
      return [
        {
          label: `Интерактивный rebase ${cur}`,
          icon: Layers,
          disabled: op,
          title: 'Изменить порядок, сообщения, объединить или удалить коммиты — с предпросмотром до применения',
          submenu: [
            { label: `Коммиты после ${short(node.hash)}…`, icon: ArrowUpToLine, onClick: () => openRebase(node.hash) },
            ...(node.parents[0] ? [{ label: `Начиная с ${short(node.hash)} (включительно)…`, icon: ArrowUpFromLine, onClick: () => openRebase(node.parents[0]) }] : []),
          ],
        },
      ];
    }
    return [{ label: `Rebase ${cur} на этот коммит…`, icon: Layers, disabled: op, title: 'С предпросмотром результата до применения', onClick: () => openRebase(node.hash) }];
  };

  const commitTime = (h) => Date.parse(allCommits.find((c) => c.hash === h)?.date ?? '') || 0;
  // «Было» — более старый из двух
  const openCompare = (x, y) => {
    if (!x || !y || x === y) return;
    const [a, b] = commitTime(x) <= commitTime(y) ? [x, y] : [y, x];
    setCompareView({ a, b });
  };

  const compareItems = (node) => {
    const items = [];
    if (compareMark && compareMark !== node.hash) {
      items.push({ label: `Сравнить с отмеченным ${short(compareMark)}`, icon: GitCompareArrows, onClick: () => openCompare(compareMark, node.hash) });
    }
    if (repo.headHash && node.hash !== repo.headHash) {
      items.push({ label: 'Сравнить с HEAD', icon: GitCompareArrows, onClick: () => openCompare(node.hash, repo.headHash) });
    }
    items.push({
      label: compareMark === node.hash ? 'Снять отметку для сравнения' : 'Отметить для сравнения',
      icon: Flag,
      hint: 'Ctrl+клик',
      onClick: () => {
        if (compareMark === node.hash) setCompareMark(null);
        else {
          setCompareMark(node.hash);
          notify({ type: 'info', title: `${short(node.hash)} отмечен для сравнения`, hint: 'Ctrl+клик или правый клик по другому коммиту → «Сравнить с отмеченным»' });
        }
      },
    });
    return items;
  };

  /* ---------- Pre-commit Guard: живая проверка staged-изменений ---------- */

  useEffect(() => {
    if (!repo || !guardCfg.live || !guardOnFor(guardCfg, repo.path) || !api.repo.guardScan || !repo.wipFiles.some((f) => f.staged)) {
      setGuardResult(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api.repo
        .guardScan(repo.path, { rules: activeRules(guardCfg), exclude: guardCfg.exclude })
        .then((res) => alive && setGuardResult(res.ok ? res.data : null))
        .catch(() => alive && setGuardResult(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [repo, guardCfg]);

  // Строки staged-файла с находками — для подсветки в diff
  const guardMarkers = useMemo(() => {
    if (!guardResult?.findings?.length || diffTarget?.kind !== 'staged') return null;
    const m = new Map();
    for (const f of guardResult.findings) if (f.file === diffTarget.file.path) m.set(f.line, f);
    return m.size ? m : null;
  }, [guardResult, diffTarget]);

  const openStagedFile = (path) => {
    const staged = repoRef.current?.wipFiles.filter((f) => f.staged) ?? [];
    const file = staged.find((f) => f.path === path);
    if (!file) return;
    setSelectedHash(allCommits.find((c) => c.wip)?.hash ?? selectedHash);
    setTimeout(() => openFile(file, 'staged', staged), 0);
  };

  /* ---------- Конструктор действий: выполнение цепочек ---------- */

  const confirmAsync = (title, text) =>
    new Promise((resolve) =>
      setDialog({ type: 'actionConfirm', title, body: text, onYes: () => resolve(true), onNo: () => setTimeout(() => resolve(false), 0) }),
    );

  // Один шаг: { ok, error?, skipped?, note? }
  const runStep = async (type, p, path) => {
    const act = (name, payload) => api.repo.action(path, name, payload);
    const cur = repoRef.current;
    const skip = (note) => ({ ok: true, skipped: true, note });
    const fail = (message, hint) => ({ ok: false, error: { message, hint } });
    switch (type) {
      case 'fetch':
        return act('fetch', {});
      case 'pull':
        return act('pull', { mode: p.mode || 'merge' });
      case 'push':
        return act('push', { force: Boolean(p.force) });
      case 'createBranch':
        return act('createBranch', { name: p.name, start: p.from || undefined, checkout: p.checkout !== false });
      case 'checkout': {
        if (p.branch === cur.currentBranch) return skip('уже на этой ветке');
        if (cur.localBranches.some((b) => b.name === p.branch)) return act('checkout', { branch: p.branch, smart: workflow.smartSwitch });
        for (const r of cur.remotes) {
          const rb = r.branches.find((b) => b.fullName === p.branch || b.name === p.branch);
          if (rb) return act('checkout', { remoteBranch: { name: rb.name, fullName: rb.fullName }, smart: workflow.smartSwitch });
        }
        return fail(`Ветка ${p.branch} не найдена`, 'Проверьте имя или сделайте Fetch.');
      }
      case 'rebase': {
        const r = await act('rebase', { ref: p.onto });
        return !r.ok && r.error.code === 'UP_TO_DATE' ? skip('уже содержит все коммиты') : r;
      }
      case 'merge': {
        const r = await act('merge', { ref: p.ref });
        return !r.ok && r.error.code === 'UP_TO_DATE' ? skip('уже слита') : r;
      }
      case 'deleteBranch':
        return act('deleteBranch', { name: p.name, force: Boolean(p.force) });
      case 'stash': {
        const r = await act('stash', { message: p.message });
        return !r.ok && r.error.code === 'NOTHING_TO_STASH' ? skip('нечего прятать') : r;
      }
      case 'stashPop': {
        const r = await act('stashPop', {});
        return !r.ok && r.error.code === 'NO_STASH' ? skip('stash пуст') : r;
      }
      case 'commit': {
        if (!p.message?.trim()) return fail('Пустое сообщение коммита');
        if (p.stageAll) {
          if (!cur.wipFiles.length) return fail('Нет изменений для коммита');
          const st = await act('stage', { paths: 'all' });
          if (!st.ok) return st;
        }
        if (!(await guardCheck(path))) return { ok: false, error: { message: 'Коммит отменён после проверки', code: 'STOPPED' } };
        const r = await act('commit', { summary: p.message.trim(), description: '' });
        return r.ok ? { ...r, note: r.data?.hash?.slice(0, 7) } : r;
      }
      case 'mergeRequest': {
        const source = cur.currentBranch;
        if (!source) return fail('Нужна активная ветка');
        const f = cur.forge;
        if (f?.kind === 'gitlab') {
          if (!f.token?.configured) return fail('GitLab не подключён', 'Настройки → Подключения: добавьте токен со scope «api».');
          const r = await api.gitlab.createMergeRequest(path, { source, target: p.target, title: p.title || source, draft: Boolean(p.draft) }, { remote: f.remote });
          if (!r.ok) return r;
          if (p.open !== false && r.data.webUrl) api.openExternal(r.data.webUrl);
          return { ok: true, note: `${r.data.created ? 'создан' : 'уже был'} !${r.data.iid}` };
        }
        if (f?.webUrl && /github/i.test(f.host ?? f.webUrl)) {
          api.openExternal(`${f.webUrl}/compare/${encodeURIComponent(p.target)}...${encodeURIComponent(source)}?expand=1`);
          return { ok: true, note: 'открыта страница pull request' };
        }
        return fail('Не удалось определить сервер для merge request', 'Поддерживаются GitLab (через токен) и GitHub (откроется страница PR).');
      }
      case 'confirm':
        return (await confirmAsync('Продолжить?', p.text || 'Продолжить?')) ? { ok: true } : { ok: false, error: { message: 'Остановлено вами', code: 'STOPPED' } };
      case 'git': {
        const r = await act('gitRaw', { command: p.command });
        return r.ok ? { ...r, note: r.data.output.split('\n')[0] || null } : r;
      }
      default:
        return fail(`Неизвестный шаг: ${type}`);
    }
  };

  const executeAction = async (action, inputs, fromIndex = 0, previous = null) => {
    const path = repoRef.current?.path;
    if (!path) return;
    const ctx = previous?.ctx ?? { inputs, start: repoRef.current.currentBranch, defaultBranch: defaultBranchOf(repoRef.current) };
    const describe = (step) => STEP_TYPES[step.type]?.describe(expandParams(step.params, { ...ctx, branch: repoRef.current?.currentBranch })) ?? step.type;
    let state = {
      action,
      ctx,
      error: null,
      finished: false,
      steps: action.steps.map((step, i) =>
        previous && i < fromIndex ? previous.steps[i] : { id: step.id, type: step.type, label: describe(step), status: 'pending', note: null },
      ),
    };
    const publish = (patch) => {
      state = { ...state, ...patch };
      setActionRun(state);
    };
    const setStep = (i, patch) => publish({ steps: state.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    publish({});
    busyRef.current = true;
    setBusyAction('chain');
    try {
      for (let i = fromIndex; i < action.steps.length; i++) {
        const step = action.steps[i];
        const params = expandParams(step.params, { ...ctx, branch: repoRef.current?.currentBranch });
        setStep(i, { status: 'running', label: STEP_TYPES[step.type]?.describe(params) ?? step.type });
        let res;
        try {
          res = await runStep(step.type, params, path);
        } catch (error) {
          res = { ok: false, error: { message: error.message } };
        }
        await loadRepo(path, { silent: true });
        if (!res.ok) {
          if (res.error?.code === 'CONFLICT') autoOpenConflict.current = true;
          setStep(i, { status: 'failed' });
          publish({ error: res.error, finished: true });
          return;
        }
        setStep(i, { status: res.skipped ? 'skipped' : 'done', note: res.note ?? null });
      }
      publish({ finished: true, summary: 'каждый шаг можно отменить через Undo' });
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  };

  const startAction = (action) => {
    if (!repoRef.current) return;
    const problems = validateAction(action);
    if (problems.length) {
      notify({ type: 'error', title: `«${action.name}»: ${problems[0]}`, hint: 'Откройте конструктор действий и поправьте шаги.' });
      return;
    }
    if (busyRef.current) {
      notify({ type: 'info', title: 'Дождитесь окончания текущей операции' });
      return;
    }
    const inputs = inputsOf(action);
    if (inputs.length || action.confirm) setRunPrompt({ action, inputs });
    else executeAction(action, {});
  };

  // Горячие клавиши действий (не в полях ввода и не поверх диалогов)
  const actionKeys = useRef(null);
  actionKeys.current = { userActions, startAction };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.fixed.inset-0')) return;
      const combo = hotkeyFromEvent(e);
      if (!combo) return;
      const a = actionKeys.current.userActions.find((x) => x.hotkey === combo);
      if (!a) return;
      e.preventDefault();
      actionKeys.current.startAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- Перетаскивание коммитов и веток на ветки ---------- */

  // Достижим ли коммит anc из desc по родителям (среди загруженных коммитов)
  const isAncestorLoaded = (anc, desc) => {
    if (!repo || anc === desc) return anc === desc;
    const byHash = new Map(repo.commits.map((c) => [c.hash, c]));
    const seen = new Set();
    const stack = [desc];
    while (stack.length) {
      const h = stack.pop();
      if (h === anc) return true;
      if (seen.has(h)) continue;
      seen.add(h);
      for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
    }
    return false;
  };

  const dropOnBranch = (targets, x, y, src) => {
    if (!repo || !src) return;
    const op = Boolean(repo.operation) || Boolean(busyAction);
    const cur = repo.currentBranch;
    const ref = src.kind === 'commit' ? src.hash : src.name;
    const srcLabel = src.kind === 'commit' ? short(src.hash) : src.name;
    const items = [];
    for (const t of targets) {
      if (src.kind === 'branch' && src.name === t.name) continue;
      const isCur = t.name === cur;
      items.push({ header: `${srcLabel} → ${t.name}` });
      const contained = isAncestorLoaded(src.hash, t.hash);
      if (contained) {
        items.push({ label: `Уже есть в ${t.name} — сливать нечего`, icon: Check, disabled: true });
        continue;
      }
      if (isAncestorLoaded(t.hash, src.hash)) {
        items.push({
          label: `Перемотать ${t.name} вперёд`,
          icon: FastForward,
          hint: 'fast-forward',
          disabled: op,
          title: 'Ветка просто передвинется вперёд — без merge-коммита и без переключения',
          onClick: () => run('fastForward', { branch: t.name, to: ref }, { label: 'Fast-forward', success: (d) => `${d.branch} перемотана до ${short(d.to)} — Undo вернёт` }),
        });
      }
      items.push({
        label: `Слить в ${t.name}`,
        icon: GitMerge,
        hint: isCur ? 'merge' : 'с переключением',
        disabled: op,
        onClick: () =>
          run('mergeInto', { ref, target: t.name, smart: workflow.smartSwitch }, { label: 'Merge', success: `${srcLabel} слита в ${t.name} — Undo вернёт` }),
      });
      if (src.kind === 'commit') {
        items.push({
          label: `Cherry-pick в ${t.name}`,
          icon: Cherry,
          hint: isCur ? 'один коммит' : 'с переключением',
          disabled: op,
          onClick: () =>
            run('cherryPickInto', { hash: src.hash, target: t.name, smart: workflow.smartSwitch }, {
              label: 'Cherry-pick',
              success: `Коммит ${srcLabel} применён к ${t.name}`,
            }),
        });
      }
      items.push({
        label: `Rebase ${t.name} на ${srcLabel}…`,
        icon: Layers,
        hint: isCur ? 'с предпросмотром' : 'с переключением',
        disabled: op,
        onClick: async () => {
          if (!isCur) {
            const res = await checkout({ branch: t.name });
            if (!res.ok) return;
          }
          setRebaseView({ upstream: ref, nonce: Date.now() });
        },
      });
    }
    if (!items.length) {
      notify({ type: 'info', title: 'Нельзя слить ветку саму в себя' });
      return;
    }
    setMenu({ x, y, items });
  };

  const buildActionsMenu = () => [
    ...(userActions.length ? [{ header: 'Мои действия' }] : []),
    ...userActions.map((a) => ({
      label: a.name || 'Без названия',
      icon: ACTION_ICONS[a.icon] ?? WandSparkles,
      hint: a.hotkey ?? undefined,
      disabled: !repo || Boolean(busyAction),
      onClick: () => startAction(a),
    })),
    ...(userActions.length ? [{ separator: true }] : []),
    { label: 'Конструктор действий…', icon: WandSparkles, onClick: () => setDialog({ type: 'actions' }) },
  ];

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

  /* ---------- Конфликты ---------- */

  const [conflictPath, setConflictPath] = useState(null);
  const autoOpenConflict = useRef(false);
  const resolvingConflict = useRef(false); // пока сохраняем файл — не закрываем редактор между файлами
  // Когда что-то меняется в репозитории — просмотр CI/CD тихо перечитывает файлы
  const ciVersion = repo ? `${repo.headHash}|${JSON.stringify(repo.wipFiles)}|${JSON.stringify(repo.ci ?? null)}` : '';

  const conflictPaths = useMemo(
    () => (repo ? [...new Set(repo.wipFiles.filter((f) => f.status === 'U').map((f) => f.path))] : []),
    [repo],
  );

  const openConflict = (path) => {
    setDiffTarget(null);
    setConflictPath(path);
  };

  // После merge/pull/rebase/cherry-pick с конфликтом — сразу открываем первый файл
  useEffect(() => {
    if (autoOpenConflict.current && conflictPaths.length) {
      autoOpenConflict.current = false;
      setDiffTarget(null);
      setConflictPath(conflictPaths[0]);
      notify({
        type: 'info',
        title: `Конфликтов: ${conflictPaths.length} ${plural(conflictPaths.length, 'файл', 'файла', 'файлов')}`,
        hint: 'Выберите для каждого блока нужную версию и сохраните — затем нажмите «Продолжить».',
      });
    }
    // Файл больше не в конфликте (решили снаружи) — закрываем редактор
    if (conflictPath && !conflictPaths.includes(conflictPath) && !resolvingConflict.current) setConflictPath(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictPaths]);

  const runConflictAction = async (...args) => {
    resolvingConflict.current = true;
    const res = await run(...args);
    if (!res.ok) resolvingConflict.current = false;
    return res;
  };

  const onConflictResolved = async (path) => {
    const res = await api.repo.status(repoRef.current.path);
    resolvingConflict.current = false;
    const rest = res.ok ? [...new Set(res.data.wipFiles.filter((f) => f.status === 'U').map((f) => f.path))] : [];
    if (rest.length) {
      // Следующий файл по порядку после текущего
      const idx = conflictPaths.indexOf(path);
      const next = conflictPaths.slice(idx + 1).find((p) => rest.includes(p)) ?? rest[0];
      notify({ type: 'success', title: `${path.split('/').pop()} — решено`, hint: `Осталось файлов: ${rest.length}` });
      setConflictPath(next);
      return;
    }
    setConflictPath(null);
    const op = repoRef.current?.operation;
    notify({
      type: 'success',
      title: 'Все конфликты решены',
      hint: op
        ? `Нажмите «Продолжить» на жёлтой панели, чтобы завершить ${OPERATION_LABELS[op] ?? op}.`
        : 'Изменения готовы — можно делать коммит.',
    });
  };

  /* ---------- Коммиты и выбор ---------- */

  /* ---------- Оформление ---------- */

  useEffect(() => {
    if (!api?.appearance) return;
    api.appearance.get().then(async (res) => {
      setAppearanceMeta({ supportsMaterial: res.supportsMaterial, hasImage: res.hasImage });
      if (res.appearance) setAppearance(normalizeAppearance(res.appearance));
      if (res.hasImage) setBgImage(await api.appearance.image());
    });
  }, []);

  useEffect(() => {
    applyAppearance(appearance, { imageUrl: bgImage, systemSupported: appearanceMeta.supportsMaterial });
    cacheAppearance(appearance);
  }, [appearance, bgImage, appearanceMeta.supportsMaterial]);

  const persistAppearance = (next) => {
    clearTimeout(saveAppearanceTimer.current);
    saveAppearanceTimer.current = setTimeout(() => {
      api?.appearance?.set({ ...next, base: themeById(next.theme).base });
    }, 250);
  };

  const updateAppearance = (patch) =>
    setAppearance((prev) => {
      const next = normalizeAppearance({ ...prev, ...patch });
      persistAppearance(next);
      return next;
    });

  const resetAppearance = () => {
    const next = normalizeAppearance(DEFAULT_APPEARANCE);
    setAppearance(next);
    persistAppearance(next);
  };

  const pickBackgroundImage = async () => {
    const res = await api.appearance.pickImage();
    if (res?.ok) {
      setBgImage(await api.appearance.image());
      setAppearanceMeta((m) => ({ ...m, hasImage: true }));
    }
    return res;
  };

  const openSettings = (tab = 'appearance') => setDialog({ type: 'settings', tab });

  /* ---------- GitLab: статусы пайплайнов для графа ---------- */

  const forge = repo?.forge ?? null;
  const gitlabReady = forge?.kind === 'gitlab' && Boolean(forge.token?.configured);
  const currentBranchInfo = repo?.localBranches.find((b) => b.name === repo.currentBranch) ?? null;
  // Ветки для форм CI/CD (расписания GitLab): сначала ветки на сервере, затем локальные
  const ciBranches = useMemo(() => {
    if (!repo) return [];
    const remote = repo.remotes?.find((r) => r.name === (currentBranchInfo?.upstreamRemote ?? 'origin')) ?? repo.remotes?.[0];
    return [...new Set([...(remote?.branches ?? []).map((b) => b.name), ...repo.localBranches.map((b) => b.name)])];
  }, [repo, currentBranchInfo?.upstreamRemote]);
  const pipelineKey = gitlabReady
    ? `${repo.path}|${forge.base}|${forge.token.savedAt}|${repo.headHash}|${currentBranchInfo?.ahead}|${currentBranchInfo?.upstream}`
    : null;

  useEffect(() => {
    if (!pipelineKey || !api?.gitlab) {
      setPipelineMap(null);
      return undefined;
    }
    let alive = true;
    let timer = null;
    const path = repoRef.current?.path;
    const remote = currentBranchInfo?.upstreamRemote;
    const tick = async () => {
      let active = false;
      if (document.visibilityState === 'visible') {
        const res = await api.gitlab.pipelines(path, { remote });
        if (!alive) return;
        if (res.ok) {
          active = res.data.pipelines.some((p) => ACTIVE_STATUSES.has(p.status));
          setPipelineMap({ bySha: res.data.bySha, pipelines: res.data.pipelines, error: null });
        } else {
          setPipelineMap((m) => ({ bySha: m?.bySha ?? {}, pipelines: m?.pipelines ?? [], error: res.error }));
        }
      }
      // Пока что-то выполняется — обновляем чаще
      if (alive) timer = setTimeout(tick, active ? 10000 : 60000);
    };
    // Сразу после push пайплайн появляется не мгновенно — небольшая задержка
    timer = setTimeout(tick, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineKey]);

  const onForgeChanged = useCallback((next) => {
    setRepo((r) => (r ? { ...r, forge: next } : r));
  }, []);

  const openPipelines = (pipelineId = null) => {
    setDiffTarget(null);
    setCiView({ file: null, mode: 'pipelines', pipelineId, n: Date.now() });
  };

  const branchPipeline = useMemo(
    () => pipelineMap?.pipelines.find((p) => p.ref === repo?.currentBranch) ?? null,
    [pipelineMap, repo?.currentBranch],
  );

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

  const commitsBySha = useMemo(() => new Map((repo?.commits ?? []).map((c) => [c.hash, c])), [repo?.commits]);

  const selectedStash =
    repo && selectedHash?.startsWith('stash:') ? repo.stashes.find((st) => `stash:${st.hash}` === selectedHash) ?? null : null;
  const selected = selectedStash
    ? { ...selectedStash, isStash: true, key: selectedHash }
    : allCommits.find((c) => c.hash === selectedHash) ?? null;
  const selectedKey = selected ? selected.key ?? selected.hash : null;

  // Файлы выбранного коммита или stash подгружаем лениво
  useEffect(() => {
    if (!repo || !selected || selected.wip || filesByHash[selectedKey]) return undefined;
    let cancelled = false;
    const request = selected.isStash
      ? api.repo.stashDetails(repo.path, selected.hash)
      : api.repo.commitFiles(repo.path, selected.hash, selected.parents[0]);
    request.then((res) => {
      if (cancelled) return;
      setFilesByHash((m) => ({ ...m, [selectedKey]: res.ok ? res.data : { error: res.error.message } }));
    });
    return () => {
      cancelled = true;
    };
  }, [repo, selectedKey, filesByHash]); // eslint-disable-line react-hooks/exhaustive-deps


  /* ---------- Просмотр изменений файла ---------- */

  // kind: 'commit' | 'staged' | 'unstaged'; list — файлы этой группы для навигации ←/→
  const openFile = (file, kind, list) => {
    const index = Math.max(0, list.findIndex((f) => f.path === file.path && Boolean(f.untracked) === Boolean(file.untracked)));
    if (kind === 'stash') {
      setDiffTarget({ kind, mode: 'commit', hash: file.diffHash, parent: file.diffParent, commitHash: selectedHash, stashId: selected?.id, file, list, index });
      return;
    }
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

  // Файл из сравнения двух коммитов (или из предпросмотра rebase): diff между a и b
  const openCompareFile = (file, list, a, b) => {
    const index = Math.max(0, list.findIndex((f) => f.path === file.path));
    setDiffTarget({ kind: 'compare', mode: 'commit', hash: b, parent: a, commitHash: selectedHash, file, list, index });
  };

  const stepFile = (delta) => {
    if (!diffTarget) return null;
    const next = diffTarget.index + delta;
    if (next < 0 || next >= diffTarget.list.length) return null;
    if (diffTarget.kind === 'compare') return () => openCompareFile(diffTarget.list[next], diffTarget.list, diffTarget.parent, diffTarget.hash);
    return () => openFile(diffTarget.list[next], diffTarget.kind, diffTarget.list);
  };

  /* ---------- Откат файла / фрагмента без коммита ---------- */

  const isDirty = (path) => repo.wipFiles.some((f) => f.path === path);

  const restoreFile = (file, hash, side) => {
    const go = () =>
      run('restoreFile', { hash, path: file.path, side }, {
        label: 'Вернуть файл',
        success: (d) =>
          `${d.path}: ${d.deleted ? 'удалён (его не было в той версии)' : `версия ${side === 'before' ? 'до' : 'из'} ${hash.slice(0, 7)}`} — без коммита${d.undoable ? ', Undo вернёт' : ''}`,
      });
    if (!isDirty(file.path)) return go();
    confirm({
      title: 'В файле есть незакоммиченные изменения',
      body: `Файл ${file.path} уже изменён в рабочей папке. Он будет заменён версией ${side === 'before' ? 'до' : 'из'} коммита ${hash.slice(0, 7)}. Undo (Ctrl+Z) вернёт текущее содержимое.`,
      confirmLabel: 'Заменить',
      onConfirm: go,
    });
  };

  const HUNK_TEXT = {
    revert: { label: 'Отмена фрагмента', ok: (d) => `${d.hunks === d.total ? 'Изменения коммита отменены' : 'Фрагмент отменён'} в ${d.path} — без коммита, Undo вернёт` },
    discard: { label: 'Отмена фрагмента', ok: (d) => `${d.hunks === d.total ? 'Изменения' : 'Фрагмент'} в ${d.path} отменён — Undo вернёт` },
    stage: { label: 'Stage фрагмента', ok: null },
    unstage: { label: 'Unstage фрагмента', ok: null },
    apply: { label: 'Фрагмент из stash', ok: (d) => `${d.hunks === d.total ? 'Изменения' : 'Фрагмент'} из stash применён к ${d.path} — Undo вернёт` },
  };
  const applyHunks = (op, mode, file, hash, hunks) =>
    run('applyHunks', { op, mode, hash, path: file.path, oldPath: file.oldPath, hunks }, { label: HUNK_TEXT[op].label, success: HUNK_TEXT[op].ok });

  const hunkActionsFor = (t) => {
    if (!t || t.file.status === 'U' || t.file.untracked) return null;
    if (t.kind === 'commit')
      return [{ id: 'revert', label: 'Отменить в рабочей папке', icon: Undo2, title: 'Убрать изменения этого фрагмента из файла в рабочей папке — без коммита. Undo вернёт.' }];
    if (t.kind === 'unstaged')
      return [
        { id: 'stage', label: 'Stage', icon: Plus, title: 'Добавить только этот фрагмент в коммит' },
        { id: 'discard', label: 'Отменить', icon: Undo2, danger: true, title: 'Выбросить этот фрагмент изменений. Undo вернёт.' },
      ];
    if (t.kind === 'staged') return [{ id: 'unstage', label: 'Unstage', icon: Minus, title: 'Убрать этот фрагмент из коммита (останется в рабочей папке)' }];
    if (t.kind === 'stash' && t.file.status !== 'D')
      return [{ id: 'apply', label: 'Применить', icon: ArchiveRestore, title: 'Перенести только этот фрагмент из stash в файл в рабочей папке. Stash не меняется, Undo вернёт.' }];
    return null;
  };
  const onHunkAction = (id, hunk) => {
    const t = diffTarget;
    if (!t) return null;
    return applyHunks(id, t.mode === 'untracked' ? 'unstaged' : t.mode, t.file, t.hash, [hunk.header]);
  };

  const buildFileMenu = (file, kind, list, extra) => {
    const items = [{ header: file.path }];
    if (kind === 'stash') {
      const st = extra?.stash ?? selected;
      items.push(
        { label: 'Показать изменения', icon: FileDiff, onClick: () => openFile(file, 'stash', list) },
        { separator: true },
        {
          label: 'Восстановить файл из stash',
          icon: ArchiveRestore,
          title: 'Файл в рабочей папке станет таким, как в stash. Stash остаётся в списке. Undo вернёт.',
          onClick: () => (extra?.restore ? extra.restore() : restoreFromStash([file], st)),
        },
      );
    } else if (kind === 'commit') {
      const c = selected;
      if (!c || c.wip) return null;
      items.push(
        { label: 'Показать изменения', icon: FileDiff, onClick: () => openFile(file, 'commit', list) },
        { separator: true },
        {
          label: 'Вернуть файл к версии из этого коммита',
          icon: RotateCcw,
          title: 'Файл в рабочей папке станет таким, как в этом коммите. Коммит не создаётся.',
          onClick: () => restoreFile(file, c.hash, 'after'),
        },
        {
          label: 'Вернуть файл к версии до этого коммита',
          icon: History,
          disabled: !c.parents.length,
          title: 'Файл станет таким, каким был до этого коммита. Коммит не создаётся.',
          onClick: () => restoreFile(file, c.hash, 'before'),
        },
        {
          label: 'Отменить изменения этого коммита в файле',
          icon: Undo2,
          disabled: file.additions === null || !c.parents.length || file.status === 'A' || file.status === 'D',
          title: 'Убрать из рабочего файла только то, что изменил этот коммит, — более поздние правки останутся',
          onClick: () => applyHunks('revert', 'commit', file, c.hash, null),
        },
      );
    } else if (kind === 'unstaged' || kind === 'staged') {
      items.push(
        { label: 'Показать изменения', icon: FileDiff, onClick: () => openFile(file, kind, list) },
        kind === 'unstaged'
          ? { label: 'Stage', icon: Plus, onClick: () => stageFiles([file.path]) }
          : { label: 'Unstage', icon: Minus, onClick: () => unstageFiles(file.oldPath ? [file.path, file.oldPath] : [file.path]) },
      );
      if (kind === 'unstaged' && !file.untracked && file.status !== 'U') {
        items.push({
          label: 'Отменить изменения в файле',
          icon: Undo2,
          danger: true,
          title: 'Выбросить незастейдженные правки этого файла. Undo вернёт.',
          onClick: () => applyHunks('discard', 'unstaged', file, null, null),
        });
      }
    } else return null;
    items.push({ separator: true }, { label: 'Копировать путь', icon: Copy, onClick: () => copy(file.path, 'Путь') });
    return items;
  };
  const openFileContextMenu = (file, kind, list, x, y, extra) => {
    const items = buildFileMenu(file, kind, list, extra);
    if (items) setMenu({ x, y, items });
  };

  // Закрываем diff, если выбран другой коммит
  useEffect(() => {
    if (diffTarget && diffTarget.commitHash !== selectedHash) setDiffTarget(null);
  }, [selectedHash, diffTarget]);

  // Для WIP файл мог уйти из группы (застейджен/закоммичен) — переключаемся или закрываем
  useEffect(() => {
    if (!repo || !diffTarget || (diffTarget.kind !== 'staged' && diffTarget.kind !== 'unstaged')) return;
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
  const diffReload = diffTarget && (diffTarget.kind === 'staged' || diffTarget.kind === 'unstaged') ? repo : null;
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


  /* ---------- Stash: просмотр и действия ---------- */

  const stashTitle = (st) => st.message.replace(/^(WIP on|On) [^:]+:\s*/, '') || st.id;

  const stashAction = (action, st) => {
    if (action === 'drop') {
      return confirm({
        title: 'Удалить stash',
        body: `Удалить «${stashTitle(st)}»? Вернуть его можно кнопкой Undo.`,
        confirmLabel: 'Удалить',
        danger: true,
        onConfirm: () => run('stashDrop', { id: st.id, hash: st.hash }, { label: 'Drop', success: 'Stash удалён — Undo вернёт его' }),
      });
    }
    const pop = action === 'pop';
    return run(pop ? 'stashPopAt' : 'stashApplyAt', { id: st.id, hash: st.hash }, {
      label: pop ? 'Pop' : 'Apply',
      success: pop ? `Stash «${stashTitle(st)}» применён и удалён` : `Stash «${stashTitle(st)}» применён`,
    }).then((res) => {
      if (res.ok) setSelectedHash('WIP');
      return res;
    });
  };

  // Восстановить отдельные файлы из stash (без применения всего stash)
  const restoreFromStash = (list, st) => {
    if (!list?.length || !st) return Promise.resolve({ ok: false });
    const touched = new Set(list.flatMap((f) => [f.path, f.oldPath].filter(Boolean)));
    const dirty = (repo?.wipFiles ?? []).filter((f) => touched.has(f.path));
    const names = list.length === 1 ? list[0].path : `${list.length} ${plural(list.length, 'файл', 'файла', 'файлов')}`;
    const go = () =>
      run('restoreFromStash', { hash: st.hash, id: st.id, files: list.map(({ path, oldPath, status, untracked }) => ({ path, oldPath, status, untracked })) }, {
        label: 'Восстановление из stash',
        success: (d) => `${names} из ${st.id} — в рабочей папке${d.undoable ? '. Undo вернёт' : ''}`,
      });
    if (!dirty.length) return go();
    return new Promise((resolve) =>
      confirm({
        title: 'Заменить изменённые файлы?',
        body: `У вас есть несохранённые правки в ${dirty.length === 1 ? `файле ${dirty[0].path}` : `${dirty.length} файлах`}. Они будут заменены версией из ${st.id}. Undo (Ctrl+Z) вернёт текущее содержимое.`,
        confirmLabel: 'Заменить',
        onConfirm: () => go().then(resolve),
      }),
    );
  };

  const buildStashMenu = (st) => [
    { header: `${st.id} · ${stashTitle(st)}` },
    { label: 'Применить (Apply)', icon: Archive, onClick: () => stashAction('apply', st) },
    { label: 'Применить и удалить (Pop)', icon: Archive, onClick: () => stashAction('pop', st) },
    { separator: true },
    { label: 'Удалить (Drop)', icon: Trash2, danger: true, onClick: () => stashAction('drop', st) },
  ];

  /* ---------- Вернуть проект к коммиту ---------- */

  const openRevertTo = (commitNode) => setDialog({ type: 'revertTo', commit: commitNode });

  const confirmRevertTo = async ({ push: andPush }) => {
    const target = dialog?.commit;
    if (!target) return;
    const res = await run('revertTo', { hash: target.hash }, {
      label: 'Вернуть к коммиту',
      progress: `Возвращаем файлы к ${target.hash.slice(0, 7)}…`,
      success: (d) => `Файлы возвращены к ${target.hash.slice(0, 7)} — создан коммит «${d.subject}». Undo отменит.`,
    });
    if (!res.ok) return;
    setDialog(null);
    setDiffTarget(null);
    setSelectedHash(res.data.to);
    if (andPush) push(false);
  };

  /* ---------- Поиск коммитов ---------- */

  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [matchIndex, setMatchIndex] = useState(0);
  const filterActive = isFilterActive(filter);
  const searchMatches = useMemo(
    () => (repo && searchOpen && filterActive ? repo.commits.filter((c) => matchCommit(c, filter)).map((c) => c.hash) : []),
    [repo, filter, searchOpen, filterActive],
  );
  const matchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  // При изменении фильтра — к первому совпадению
  useEffect(() => {
    setMatchIndex(0);
    if (searchMatches.length) {
      setDiffTarget(null);
      setSelectedHash(searchMatches[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const gotoMatch = (delta) => {
    if (!searchMatches.length) return;
    const i = (matchIndex + delta + searchMatches.length) % searchMatches.length;
    setMatchIndex(i);
    setDiffTarget(null);
    setSelectedHash(searchMatches[i]);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setFilter(EMPTY_FILTER);
  };

  /* ---------- Автообновление ---------- */

  const [autoSync, setAutoSync] = useState(() => readPref('autoSync', '1') === '1');
  const [bgFetching, setBgFetching] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const bgFetchingRef = useRef(false);
  const refreshTimer = useRef(null);
  const accessRef = useRef(null);
  accessRef.current = access;

  // 1) Следим за папкой репозитория: коммиты, ветки, stash, правки файлов — граф обновляется сам
  useEffect(() => {
    if (!api?.repo.watch) return undefined;
    const dir = repo?.path;
    if (!autoSync || !dir) {
      api.repo.watch(null);
      return undefined;
    }
    api.repo.watch(dir);
    return () => api.repo.watch(null);
  }, [repo?.path, autoSync]);

  useEffect(() => {
    if (!api?.repo.onChanged) return undefined;
    let pendingFull = false;
    return api.repo.onChanged((ev) => {
      if (ev.path !== repoRef.current?.path) return;
      // Изменилось что-то в .git (коммит, ветка, stash, fetch) — нужен полный перечит графа;
      // изменились только рабочие файлы — достаточно быстрого git status
      pendingFull = pendingFull || ev.git;
      clearTimeout(refreshTimer.current);
      const tick = async () => {
        // Во время операции не мешаем — после неё граф и так перезагрузится
        if (busyRef.current) {
          refreshTimer.current = setTimeout(tick, 400);
          return;
        }
        if (repoRef.current?.path !== ev.path) return;
        if (pendingFull || !api.repo.status) {
          pendingFull = false;
          loadRepo(ev.path, { silent: true });
          return;
        }
        const res = await api.repo.status(ev.path);
        if (!res.ok || repoRef.current?.path !== res.data.path) return;
        setRepo((r) => {
          if (!r || r.path !== res.data.path) return r;
          const ci = res.data.ci ?? r.ci;
          const same =
            r.operation === res.data.operation &&
            JSON.stringify(r.wipFiles) === JSON.stringify(res.data.wipFiles) &&
            JSON.stringify(r.ci) === JSON.stringify(ci);
          if (same) return r; // ничего не поменялось — не перерисовываем
          return { ...r, wipFiles: res.data.wipFiles, operation: res.data.operation, ci };
        });
      };
      refreshTimer.current = setTimeout(tick, 30);
    });
  }, [loadRepo]);

  // 2) Фоновый fetch: новые коммиты и ветки с сервера
  const backgroundFetch = useCallback(
    async (manual = false) => {
      const current = repoRef.current;
      if (!current || current.remotes.length === 0 || bgFetchingRef.current || busyRef.current) return;
      bgFetchingRef.current = true;
      setBgFetching(true);
      const res = await api.repo.action(current.path, 'fetch', {});
      bgFetchingRef.current = false;
      setBgFetching(false);
      if (res.ok) {
        setLastFetch(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
        setFetchError(null);
        if (repoRef.current?.path === current.path) loadRepo(current.path, { silent: true });
      } else {
        setFetchError(res.error.message);
        if (manual) notify({ type: 'error', title: `Fetch: ${res.error.message}`, hint: res.error.hint });
      }
    },
    [loadRepo, notify],
  );

  useEffect(() => {
    setLastFetch(null);
    setFetchError(null);
    if (!autoSync || !repo?.path || repo.remotes.length === 0) return undefined;
    // Только если доступ на чтение подтверждён — чтобы фоновая проверка не открывала окно входа
    const canFetch = () => accessRef.current?.data?.canRead && document.hasFocus();
    const first = setTimeout(() => canFetch() && backgroundFetch(), 15000);
    const timer = setInterval(() => canFetch() && backgroundFetch(), AUTO_FETCH_MIN * 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path, autoSync, backgroundFetch]);

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
        onEditMenu={(x, y) =>
          setMenu({
            x,
            y,
            items: [
              {
                label: repo?.history?.undo ? `Отменить: ${repo.history.undo}` : 'Отменить',
                icon: Undo2,
                hint: 'Ctrl+Z',
                disabled: !repo?.history?.undo || Boolean(busyAction),
                onClick: undo,
              },
              {
                label: repo?.history?.redo ? `Повторить: ${repo.history.redo}` : 'Повторить',
                icon: Redo2,
                hint: 'Ctrl+Y',
                disabled: !repo?.history?.redo || Boolean(busyAction),
                onClick: redo,
              },
              { separator: true },
              { label: 'Найти коммит…', icon: Search, hint: 'Ctrl+F', disabled: !repo, onClick: () => setSearchOpen(true) },
              {
                label: 'Переключить ветку…',
                icon: GitBranch,
                hint: 'Ctrl+B',
                disabled: !repo,
                onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, code: 'KeyB', key: 'b' })),
              },
              { label: 'Новая ветка…', icon: GitBranch, disabled: !repo?.headHash, onClick: () => openBranchDialog() },
              { separator: true },
              { label: 'Stash — спрятать изменения', icon: Archive, disabled: !repo?.wipFiles.length || Boolean(busyAction), onClick: stash },
              { label: 'Pop — вернуть последний stash', icon: PackageOpen, disabled: !repo?.stashes.length || Boolean(busyAction), onClick: stashPop },
            ],
          })
        }
        onActionsMenu={(x, y) => setMenu({ x, y, items: buildActionsMenu() })}
        onHelpMenu={(x, y) =>
          setMenu({
            x,
            y,
            items: [
              { label: 'Руководство', icon: BookOpen, hint: 'F1', onClick: () => setDialog({ type: 'guide' }) },
              { label: 'Горячие клавиши', icon: Keyboard, onClick: () => setDialog({ type: 'guide', section: 'keys' }) },
              { label: 'О программе', icon: Info, onClick: () => setDialog({ type: 'about' }) },
            ],
          })
        }
        onViewMenu={(x, y) =>
          setMenu({
            x,
            y,
            items: [
              { label: 'Оформление…', icon: Palette, hint: 'Ctrl+,', onClick: () => openSettings('appearance') },
              { label: 'Подключения (GitLab)…', icon: Plug, onClick: () => openSettings('integrations') },
            ],
          })
        }
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
            onCheckout={checkout}
            onCreateBranch={quickCreateBranch}
            onLocate={locateCommit}
            onStash={stash}
            onPop={stashPop}
            onAccessClick={() => setDialog({ type: 'access' })}
            onSettings={() => openSettings('appearance')}
            onSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            searchOpen={searchOpen}
            customActions={userActions
              .filter((a) => a.toolbar)
              .map((a) => ({
                id: a.id,
                name: a.name || 'Действие',
                icon: ACTION_ICONS[a.icon] ?? WandSparkles,
                title: `${a.name}${a.hotkey ? ` (${a.hotkey})` : ''}\n${a.steps.map((st, i) => `${i + 1}. ${STEP_TYPES[st.type]?.describe(st.params) ?? st.type}`).join('\n')}`,
                running: Boolean(actionRun && !actionRun.finished && actionRun.action.id === a.id),
              }))}
            onRunAction={(id) => {
              const a = userActions.find((x) => x.id === id);
              if (a) startAction(a);
            }}
            onOpenActions={() => setDialog({ type: 'actions' })}
          />

          {(repo.operation || conflictPaths.length > 0) && (
            <OperationBanner
              operation={repo.operation}
              conflicts={conflictPaths.length}
              onResolve={() => openConflict(conflictPaths[0])}
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
              <Sidebar
                repo={repo}
                selectedHash={selectedHash}
                onSelect={(h) => {
                  setDiffTarget(null);
                  setSelectedHash(h);
                }}
                onCheckout={checkout}
                dragSource={dragSource}
                onDragSource={setDragSource}
                onDropOnBranch={dropOnBranch}
                refActions={refActions}
                onStashMenu={(st, x, y) => setMenu({ x, y, items: buildStashMenu(st) })}
                onOpenCi={(file) => {
                  setDiffTarget(null);
                  setCiView({ file, mode: 'scheme', n: Date.now() });
                }}
                activeCiFile={ciView && ciView.mode !== 'pipelines' ? ciView.file : null}
                forge={forge}
                branchPipeline={branchPipeline}
                pipelinesError={pipelineMap?.error ?? null}
                pipelinesActive={ciView?.mode === 'pipelines'}
                onOpenPipelines={() => openPipelines(branchPipeline?.id ?? null)}
              />
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
            <main className="relative flex min-w-0 flex-1 flex-col">
              {busyAction && PROGRESS_TEXT[busyAction] && (
                <LoadingOverlay title={busyText ?? PROGRESS_TEXT[busyAction]} label={repo.name} />
              )}
              {searchOpen && !diffTarget && !conflictPath && (
                <SearchBar
                  commits={repo.commits}
                  filter={filter}
                  onChange={setFilter}
                  matches={searchMatches}
                  current={matchIndex}
                  onPrev={() => gotoMatch(-1)}
                  onNext={() => gotoMatch(1)}
                  onClose={closeSearch}
                  totalLoaded={repo.commits.length}
                  truncated={repo.truncated}
                />
              )}
              {conflictPath ? (
                <ConflictView
                  key={conflictPath}
                  repoPath={repo.path}
                  path={conflictPath}
                  fileIndex={Math.max(0, conflictPaths.indexOf(conflictPath))}
                  fileCount={conflictPaths.length}
                  onPrevFile={
                    conflictPaths.indexOf(conflictPath) > 0
                      ? () => setConflictPath(conflictPaths[conflictPaths.indexOf(conflictPath) - 1])
                      : null
                  }
                  onNextFile={
                    conflictPaths.indexOf(conflictPath) < conflictPaths.length - 1
                      ? () => setConflictPath(conflictPaths[conflictPaths.indexOf(conflictPath) + 1])
                      : null
                  }
                  onClose={() => setConflictPath(null)}
                  onResolved={onConflictResolved}
                  runAction={runConflictAction}
                />
              ) : diffTarget ? (
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
                  guardMarkers={guardMarkers}
                  hunkActions={hunkActionsFor(diffTarget)}
                  onHunkAction={onHunkAction}
                  fileActions={
                    diffTarget.kind === 'commit' && selected && !selected.wip
                      ? [
                          {
                            label: 'Вернуть файл…',
                            icon: RotateCcw,
                            title: 'Вернуть этот файл в рабочей папке к версии из коммита или до него — без коммита',
                            onClick: (e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              const items = buildFileMenu(diffTarget.file, 'commit', diffTarget.list);
                              if (items) setMenu({ x: r.left, y: r.bottom + 4, items: items.filter((i) => i.label !== 'Показать изменения') });
                            },
                          },
                        ]
                      : null
                  }
                />
              ) : null}
              {compareView && (
                <CompareView
                  repoPath={repo.path}
                  a={compareView.a}
                  b={compareView.b}
                  hidden={Boolean(conflictPath || diffTarget)}
                  activePath={null}
                  onSwap={() => setCompareView({ a: compareView.b, b: compareView.a })}
                  onClose={() => setCompareView(null)}
                  onOpenFile={(f, list) => openCompareFile(f, list, compareView.a, compareView.b)}
                  onLocate={setSelectedHash}
                />
              )}
              {rebaseView && (
                <RebaseView
                  key={rebaseView.nonce}
                  repoPath={repo.path}
                  session={rebaseView}
                  hidden={Boolean(conflictPath || diffTarget)}
                  busy={Boolean(busyAction)}
                  onClose={() => setRebaseView(null)}
                  onLocate={setSelectedHash}
                  onOpenDiff={(f, list, a, b) => openCompareFile(f, list, a, b)}
                  onApply={async (d) => {
                    const res = await run('rebaseApply', { oldHead: d.oldHead, newHead: d.newHead, branch: d.branch, onto: d.onto.hash }, {
                      label: 'Rebase',
                      success: `Rebase ${d.branch} выполнен — Undo (Ctrl+Z) вернёт как было`,
                    });
                    if (res.ok) {
                      setRebaseView(null);
                      setSelectedHash(d.newHead);
                    } else if (res.error?.code === 'PLAN_STALE') {
                      setRebaseView({ ...rebaseView, nonce: Date.now() });
                    }
                  }}
                  onStart={async (plan) => {
                    const session = rebaseView;
                    setRebaseView(null);
                    await run('rebaseStart', { upstream: session.upstream, onto: session.onto, plan }, {
                      label: 'Rebase',
                      success: 'Rebase выполнен — Undo (Ctrl+Z) вернёт как было',
                    });
                  }}
                />
              )}
              {conflictPath || diffTarget || compareView || rebaseView ? null : ciView ? (
                <CiView
                  repoPath={repo.path}
                  initialFile={ciView.file}
                  initialMode={ciView.mode}
                  initialPipelineId={ciView.pipelineId}
                  version={ciVersion}
                  forge={forge}
                  remoteName={currentBranchInfo?.upstreamRemote}
                  currentBranch={repo.currentBranch}
                  commitsBySha={commitsBySha}
                  branches={ciBranches}
                  onClose={() => setCiView(null)}
                  onLocate={(sha) => {
                    if (!allCommits.some((c) => c.hash === sha)) {
                      notify({ type: 'info', title: 'Коммита нет в загруженной истории', hint: 'Сделайте fetch или pull' });
                      return;
                    }
                    locateCommit(sha);
                  }}
                  onForgeChanged={onForgeChanged}
                  notify={notify}
                />
              ) : (
                <CommitGraph
                  commits={allCommits}
                  introKey={repo.path}
                  selectedHash={selectedHash}
                  onSelect={setSelectedHash}
                  onCompare={(hash) => {
                    // Ctrl+клик: сравнить с отмеченным коммитом, а если его нет — с выбранным
                    const sel = allCommits.find((c) => c.hash === selectedHash);
                    const base = compareMark && compareMark !== hash ? compareMark : sel && !sel.wip && sel.hash !== hash ? sel.hash : null;
                    if (base) openCompare(base, hash);
                    else setSelectedHash(hash);
                  }}
                  compareMark={compareMark}
                  dragSource={dragSource}
                  onDragSource={setDragSource}
                  onDropOnBranch={dropOnBranch}
                  currentBranch={repo.currentBranch}
                  refActions={refActions}
                  onActivate={activateCommit}
                  onContextMenu={openMenu}
                  wipCount={repo.wipFiles.length}
                  truncated={repo.truncated}
                  matchSet={searchOpen && filterActive ? matchSet : null}
                  pipelines={pipelineMap?.bySha ?? null}
                  onPipelineClick={(p) => openPipelines(p.id)}
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
                files={selected && !selected.wip ? filesByHash[selectedKey] : null}
                repo={repo}
                busy={Boolean(busyAction)}
                activeFile={diffTarget ? { kind: diffTarget.kind, path: diffTarget.file.path } : null}
                onOpenFile={openFile}
                onSelectCommit={setSelectedHash}
                onStage={stageFiles}
                onUnstage={unstageFiles}
                onCommit={commit}
                onRevertTo={openRevertTo}
                onStashAction={stashAction}
                onStashRestore={restoreFromStash}
                onOpenConflict={openConflict}
                activeConflict={conflictPath}
                onFileMenu={openFileContextMenu}
                guardResult={guardResult}
                guardState={!guardCfg.enabled ? 'off' : guardCfg.repoOff.includes(repo.path) ? 'repo-off' : 'on'}
                onGuardOpen={() => guardResult && setDialog({ type: 'guard', mode: 'view', result: guardResult })}
                onGuardToggleRepo={() => {
                  const off = guardCfg.repoOff.includes(repo.path);
                  updateGuard({ ...guardCfg, repoOff: off ? guardCfg.repoOff.filter((p) => p !== repo.path) : [...guardCfg.repoOff, repo.path] });
                  notify({ type: 'info', title: off ? 'Проверка перед коммитом включена для этого репозитория' : 'Проверка перед коммитом выключена для этого репозитория', hint: off ? null : 'Включить обратно — в строке над кнопкой Commit или в настройках.' });
                }}
                onGuardSettings={() => setDialog({ type: 'settings', tab: 'guard' })}
                onCommitSettings={() => setDialog({ type: 'settings', tab: 'commit' })}
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
          onClone={() => setDialog({ type: 'clone' })}
          onGuide={() => setDialog({ type: 'guide' })}
        />
      )}

      {repo && (
        <StatusBar
          repo={repo}
          sync={{
            enabled: autoSync,
            intervalMin: AUTO_FETCH_MIN,
            fetching: bgFetching,
            lastFetch: lastFetch,
            error: fetchError,
            onToggle: () =>
              setAutoSync((v) => {
                writePref('autoSync', v ? '0' : '1');
                return !v;
              }),
            onFetchNow: () => backgroundFetch(true),
          }}
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
      {dialog?.type === 'guide' && <GuideDialog initialSection={dialog.section} onClose={() => setDialog(null)} />}
      {dialog?.type === 'about' && (
        <Modal title="О программе" icon={Info} onClose={() => setDialog(null)} width={400}>
          <div className="space-y-2 text-[13px]">
            <div className="text-[15px] font-semibold text-white">GitIdea</div>
            <div className="text-gk-muted">Версия 0.1.0 · Electron + React + Tailwind CSS</div>
            <div className="text-[12px] leading-relaxed text-gk-dim">
              Граф коммитов, ветки, stash, конфликты, CI/CD и пайплайны GitLab — в одном окне.
            </div>
          </div>
        </Modal>
      )}
      {(dialog?.type === 'settings' || dialog?.type === 'integrations') && (
        <SettingsDialog
          initialTab={dialog.type === 'integrations' ? 'integrations' : dialog.tab}
          appearance={appearance}
          meta={appearanceMeta}
          imageUrl={bgImage}
          onChange={updateAppearance}
          onReset={resetAppearance}
          onPickImage={pickBackgroundImage}
          repo={repo}
          onForgeChanged={onForgeChanged}
          workflow={workflow}
          onWorkflowChange={updateWorkflow}
          guard={guardCfg}
          onGuardChange={updateGuard}
          repoPath={repo?.path}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'guard' && (
        <GuardDialog
          result={dialog.result}
          mode={dialog.mode}
          onCancel={() => {
            setDialog(null);
            dialog.resolve?.(false);
          }}
          onCommitAnyway={() => {
            setDialog(null);
            dialog.resolve?.(true);
          }}
          onOpenFile={(path) => {
            setDialog(null);
            dialog.resolve?.(false);
            openStagedFile(path);
          }}
          onSettings={() => {
            dialog.resolve?.(false);
            setDialog({ type: 'settings', tab: 'guard' });
          }}
        />
      )}
      {dialog?.type === 'actionConfirm' && (
        <ConfirmDialog title={dialog.title} confirmLabel="Продолжить" onConfirm={dialog.onYes} onClose={() => {
          setDialog(null);
          dialog.onNo();
        }}>
          <p className="leading-relaxed">{dialog.body}</p>
        </ConfirmDialog>
      )}
      {dialog?.type === 'actions' && (
        <ActionBuilder
          actions={userActions}
          branches={ciBranches}
          initialId={dialog.id}
          onChange={updateActions}
          onRun={(a) => {
            setDialog(null);
            startAction(a);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {runPrompt && (
        <RunDialog
          action={runPrompt.action}
          inputs={runPrompt.inputs}
          branches={ciBranches}
          onClose={() => setRunPrompt(null)}
          onRun={(values) => {
            const a = runPrompt.action;
            setRunPrompt(null);
            executeAction(a, values);
          }}
        />
      )}
      {actionRun && (
        <RunnerCard
          run={actionRun}
          onClose={() => setActionRun(null)}
          onRetry={(index) => executeAction(actionRun.action, actionRun.ctx.inputs, index, actionRun)}
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
      {dialog?.type === 'clone' && (
        <CloneDialog
          onClose={() => setDialog(null)}
          onCloned={(r) => {
            setDialog(null);
            notify({ type: 'success', title: `Репозиторий ${r.name} склонирован`, hint: r.path });
            openTab(r.path);
          }}
        />
      )}
      {dialog?.type === 'revertTo' && repo && (
        <RevertToDialog
          repoPath={repo.path}
          commit={dialog.commit}
          busy={busyAction === 'revertTo' || busyAction === 'stash'}
          onClose={() => setDialog(null)}
          onConfirm={confirmRevertTo}
          onStashFirst={async () => (await run('stash', {}, { label: 'Stash', success: 'Изменения спрятаны в Stash' })).ok}
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
      {dialog?.type === 'deleteRemote' && (
        <DeleteRemoteDialog
          remote={dialog.remote}
          branch={dialog.branch}
          locals={dialog.locals}
          busy={dialog.busy}
          error={dialog.error}
          onConfirm={confirmDeleteRemote}
          onClose={() => setDialog(null)}
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

function OperationBanner({ operation, conflicts, busy, onContinue, onAbort, onResolve }) {
  return (
    <div className="glass flex shrink-0 animate-slide-up items-center gap-3 border-b border-gk-yellow/30 bg-gk-yellow/10 px-3 py-2 text-xs">
      <AlertTriangle size={14} className="shrink-0 text-gk-yellow" />
      <span className="flex-1">
        {operation ? (
          <>
            Идёт <b>{OPERATION_LABELS[operation]}</b>
            {conflicts > 0
              ? ` — осталось решить конфликтов: ${conflicts}. Потом нажмите «Продолжить».`
              : ' — конфликты решены, можно продолжить.'}
          </>
        ) : (
          <>Есть конфликты после применения stash: {conflicts}. Решите их — после этого можно коммитить.</>
        )}
      </span>
      {conflicts > 0 && (
        <Button variant="danger" onClick={onResolve} disabled={busy} className="py-1 text-xs">
          Решить конфликты
        </Button>
      )}
      {operation && (
        <>
          <Button onClick={onAbort} disabled={busy} className="py-1 text-xs" title="Вернуть всё как было до операции">
            Прервать
          </Button>
          <Button variant="primary" onClick={onContinue} disabled={busy || conflicts > 0} className="py-1 text-xs">
            Продолжить
          </Button>
        </>
      )}
    </div>
  );
}

function Welcome({ loading, onOpen, onCreate, onConnect, onClone, onGuide }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5">
      {loading ? (
        <div className="glass-strong flex h-24 w-24 animate-pop-in items-center justify-center rounded-3xl border border-gk-border bg-gk-panel">
          <GraphLoader size={52} />
        </div>
      ) : (
        <AppLogo size={96} className="animate-pop-in drop-shadow-[0_10px_30px_rgba(60,240,160,0.18)]" />
      )}
      <div className="animate-slide-up text-center">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-gk-dim">GitIdea</div>
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
        <FolderPlus size={15} />
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
      <button
        onClick={onClone}
        disabled={loading}
        className="-mt-3 flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        <CloudDownload size={15} />
        Клонировать репозиторий по ссылке
      </button>
      <p className="max-w-sm animate-fade-in text-center text-xs text-gk-dim">
        Ctrl+O — открыть · Ctrl+N — создать. Если в выбранной папке нет Git, приложение предложит его инициализировать.
      </p>
      <button onClick={onGuide} className="-mt-2 flex animate-fade-in items-center gap-1.5 text-[12.5px] text-gk-blue hover:underline">
        <BookOpen size={13} /> Как пользоваться программой (F1)
      </button>
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

/* ---------- Горячие клавиши ---------- */

