import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  ArrowDownToLine,
  Archive,
  BookOpen,
  WandSparkles,
  Cherry,
  Cloud,
  Copy,
  Eraser,
  FileText,
  FileClock,
  FileUser,
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
  RotateCcw,
  Tag,
  Trash2,
  X,
  SquareTerminal,
  Star,
  FolderSync,
  Pencil,
} from 'lucide-react';
import ContextMenu, { type MenuEntry, type MenuItem } from './components/ContextMenu.tsx';
import TitleBar, { type TabInfo } from './components/TitleBar.tsx';
import Toolbar from './components/Toolbar.tsx';
import Sidebar from './components/Sidebar.tsx';
import CommitGraph, { type GraphRow } from './components/CommitGraph.tsx';
import CommitDetails, { type CommitHits, type HitFile, type RowFile, type SelectedRow } from './components/CommitDetails.tsx';
import Toasts, { type ToastData } from './components/Toasts.tsx';
import TooltipLayer from './components/TooltipLayer.tsx';
import DiffView, { type DiffData, type DiffEditor, type DiffTarget, type FileAction, type HunkAction } from './components/DiffView.tsx';
import ConflictView, { type RunAction } from './components/ConflictView.tsx';
import CiView from './components/CiView.tsx';
import RebaseView, { type RebaseSession } from './components/RebaseView.tsx';
import CompareView, { type CompareSearchJump } from './components/CompareView.tsx';
import FileView, { type FileViewState } from './components/FileView.tsx';
import GuideDialog from './components/GuideDialog.tsx';
import ActionBuilder, { ACTION_ICONS } from './components/ActionBuilder.tsx';
import { RunDialog, RunnerCard, type ActionRun } from './components/ActionRunner.tsx';
import { GuardDialog } from './components/Guard.tsx';
import { activeRules, guardOnFor, readGuard, writeGuard, type GuardConfig } from './lib/guardRules.ts';
import { STEP_TYPES, defaultBranchOf, expandParams, hotkeyFromEvent, inputsOf, readActions, validateAction, writeActions } from './lib/actions.ts';
import type { ActionInput, CustomAction, ExpandContext, StepTypeId } from './lib/actions.ts';
import SettingsDialog, { type Workflow } from './components/SettingsDialog.tsx';
import {
  DEFAULT_APPEARANCE,
  AUTO_THEME,
  applyAppearance,
  cacheAppearance,
  nativeAppearance,
  normalizeAppearance,
  readCachedAppearance,
  syncScheme,
  type Appearance,
} from './lib/appearance.ts';
import StatusBar from './components/StatusBar.tsx';
import { IS_MAC, isMod, kb, openFolderLabel, openTerminalLabel } from './lib/platform.ts';
import InitRepoDialog, { plural } from './components/InitRepoDialog.tsx';
import CloneDialog from './components/CloneDialog.tsx';
import AuthDialog, { type AuthSubmit, type AuthTarget } from './components/AuthDialog.tsx';
import NewTabPage from './components/NewTabPage.tsx';
import { describeStash } from './lib/stashName.ts';
import RevertToDialog from './components/RevertToDialog.tsx';
import SearchBar, { EMPTY_FILTER, isFilterActive, matchCommit, type CommitFilter } from './components/SearchBar.tsx';
import { GraphLoader, LoadingOverlay, Splash } from './components/Loader.tsx';
import AppLogo from './components/AppLogo.tsx';
import { ResizeHandle, useStoredWidth } from './components/Resizer.tsx';
import {
  AccessDialog,
  BranchDialog,
  Button,
  ConfirmDialog,
  DeleteRemoteDialog,
  ErrorDialog,
  Modal,
  PushRejectedDialog,
  CheckoutWipDialog,
  RenameBranchDialog,
  SwitchToDialog,
  TagDialog,
  type AccessState,
  type DialogError,
  type GitFlowConfig,
  type WipChoice,
  type WipConflict,
} from './components/Dialogs.tsx';
import { t as tr, tj } from './i18n/index.ts';
import { MAX_HISTORY, repoStore, useRepoStore, type LoadError, type RepoData, type RepoStatus } from './state/repoStore.ts';
import { gitBusy, syncStore, useSyncStore } from './state/syncStore.ts';
import { ciStore, useCiStore } from './state/ciStore.ts';
import { withStashes, type StashData } from './lib/graphStash.ts';
import { MAX_MAIN_BRANCHES, useMainBranches } from './lib/mainBranches.ts';
import type { RefDragPayload } from './lib/dnd.ts';
import type { ActionOutput, ActionPayload, RepoActionName } from './state/repoActions.ts';
import type { ApiError, ApiResult } from './platform/tauri.ts';
import type {
  AppearanceInfo_Serialize,
  BranchLog,
  ClearResult,
  CommitFile_Serialize,
  CommitRef_Serialize,
  ConnectOptions_Deserialize,
  ConnectResult_Serialize,
  CredSaved_Serialize,
  CredTarget_Serialize,
  FileDiff_Serialize,
  FolderInfo_Serialize,
  ForgeStatus_Serialize,
  ForgetResult,
  GlMergeRequest_Serialize,
  GuardScan_Serialize,
  HistorySearch_Serialize,
  InitOptions_Deserialize,
  InitResult_Serialize,
  KeyDefaults_Serialize,
  LightCheck_Serialize,
  LocalBranch_Serialize,
  MenuInvoke_Serialize,
  OpenedPath,
  OpenedTerminal,
  PipelineDetailWithCaps_Serialize,
  PipelineListWithCaps_Serialize,
  PipelineRun_Serialize,
  RemoteProbe_Serialize,
  RepoChanged,
  RepoIndexSynced,
  Stash_Serialize,
  StashDetails_Serialize,
  TabsState_Serialize,
  UrlChecked,
  WorktreeSave,
  WorktreeSaved,
  WorktreeText,
} from '../crates/gorynych-tauri/bindings/commands.ts';

/* ---------- Типы ---------- */

/** Ошибка, которую показывает интерфейс: ответ команды или придуманная здесь (`BUSY`, `STOPPED`, `CANCELED`) */
type UiError = Partial<ApiError> & { code: string };
/** Ответ, как его читает интерфейс: ошибка может быть неполной */
type UiResult<T> = { ok: true; data: T } | { ok: false; error: UiError };

/** Ответ `repo:action` с известным типом результата */
type ActionResult<N extends RepoActionName> = UiResult<ActionOutput<N>>;

/** Та часть `window.api`, которой пользуется App (форма `electron/preload.cjs` и `platform/tauri.ts`) */
interface AppApi {
  platform?: string;
  window: { close: () => void; onFocus: (cb: () => void) => () => void };
  menu?: { set: (model: unknown) => void; onInvoke?: (cb: (value: MenuInvoke_Serialize) => void) => () => void };
  tabs?: { get: () => Promise<TabsState_Serialize>; save: (tabs: string[], active: string | null) => Promise<boolean> };
  openExternal: (url: string) => Promise<boolean>;
  openFolder?: (dir: string) => Promise<ApiResult<OpenedPath>>;
  openTerminal?: (dir: string) => Promise<ApiResult<OpenedTerminal>>;
  appearance?: {
    get: () => Promise<Omit<AppearanceInfo_Serialize, 'appearance'> & { appearance: unknown }>;
    set: (value: unknown) => Promise<boolean>;
    pickImage: () => Promise<{ ok: boolean; canceled?: boolean; name?: string | null; error?: { message: string } }>;
    image: () => Promise<string | null>;
  };
  creds?: {
    describe: (dir: string | null, url: string | null) => Promise<ApiResult<CredTarget_Serialize>>;
    save: (dir: string | null, url: string | null, data: AuthSubmit) => Promise<ApiResult<CredSaved_Serialize>>;
    clear: (dir: string | null, url: string | null) => Promise<ApiResult<ClearResult>>;
    checkUrl: (url: string) => Promise<ApiResult<UrlChecked>>;
    servers?: () => Promise<ApiResult>;
    forgetLogin: (key: string) => Promise<ApiResult<ForgetResult>>;
    forgetServer: (hostname: string) => Promise<ApiResult<ForgetResult>>;
    keyDefaults: (dir: string | null, url: string | null, type: string) => Promise<ApiResult<KeyDefaults_Serialize>>;
  };
  cicd?: {
    status: (dir: string, opts: { remote?: string | null }) => Promise<ApiResult<ForgeStatus_Serialize | null>>;
    pipelines: (dir: string, opts: { remote?: string | null }) => Promise<ApiResult<PipelineListWithCaps_Serialize>>;
    pipeline: (dir: string, id: string | number, opts: { remote?: string | null }) => Promise<ApiResult<PipelineDetailWithCaps_Serialize>>;
  };
  gitlab: {
    createMergeRequest: (dir: string, mr: { source: string; target: unknown; title: unknown; draft: boolean }, opts: { remote?: string | null }) => Promise<ApiResult<GlMergeRequest_Serialize>>;
  };
  repo: {
    /** Догрузка истории (новое в 2.0); под Electron её нет */
    loadMore?: unknown;
    openDialog: (title?: string) => Promise<string | null>;
    inspect: (dir: string) => Promise<ApiResult<FolderInfo_Serialize>>;
    init: (dir: string, options: InitOptions_Deserialize) => Promise<ApiResult<InitResult_Serialize>>;
    probeRemote: (dir: string | undefined, options: { url: string; branch?: string | null }) => Promise<ApiResult<RemoteProbe_Serialize>>;
    connect: (dir: string, options: ConnectOptions_Deserialize) => Promise<ApiResult<ConnectResult_Serialize>>;
    status?: (dir: string) => Promise<ApiResult<RepoStatus>>;
    getLast: () => Promise<string | null>;
    commitFiles: (dir: string, hash: string, parent: string | undefined) => Promise<ApiResult<CommitFile_Serialize[]>>;
    stashDetails: (dir: string, hash: string) => Promise<ApiResult<StashDetails_Serialize>>;
    fileDiff: (dir: string, params: Record<string, unknown>) => Promise<ApiResult<FileDiff_Serialize>>;
    readFile?: (dir: string, path: string) => Promise<ApiResult<WorktreeText>>;
    saveFile?: (dir: string, params: WorktreeSave) => Promise<ApiResult<WorktreeSaved>>;
    searchHistory?: (dir: string, params: { hashes: string[]; query: string }) => Promise<ApiResult<HistorySearch_Serialize>>;
    gitflowConfig?: (dir: string) => Promise<ApiResult<GitFlowConfig>>;
    guardScan?: (dir: string, params: { rules: unknown; exclude: unknown }) => Promise<ApiResult<GuardScan_Serialize>>;
    remoteCheck?: (dir: string) => Promise<ApiResult<LightCheck_Serialize>>;
    branchLog: (dir: string, params: { branch: string; direction: string }) => Promise<ApiResult<BranchLog>>;
    watch?: (dir: string | null, opts?: { syncIndex: boolean }) => void;
    onIndexSynced?: (cb: (ev: RepoIndexSynced) => void) => () => void;
    onChanged?: (cb: (ev: RepoChanged) => void) => () => void;
    action: <N extends RepoActionName>(dir: string, name: N, payload: ActionPayload<N>) => Promise<ApiResult<ActionOutput<N>>>;
  };
}

/** Пункт главного меню: `id` нужен системному меню macOS */
type AppMenuItem = MenuItem & { id?: string };

/** Вкладка: репозиторий или «Новая вкладка» */
type Tab = TabInfo;

/** Узел графа, как его читает App: коммит, stash или WIP */
type GraphEntry = GraphRow & { stash?: StashData | null; description?: string };
/** Ветка или тег на коммите */
type CommitRef = { type: CommitRef_Serialize['type'] | (string & {}); name: string };

/** Ветка как «группа»: локальная и её серверная копия на одном коммите — одно целое (`refGroup`) */
interface BranchGroup {
  tag?: string;
  local?: string | null;
  remote?: string | null;
  upstream?: string | null;
  synced?: boolean;
  info?: LocalBranch_Serialize | null;
  tracker?: LocalBranch_Serialize | null;
}

/** Цель checkout: локальная ветка или серверная (тогда создаётся локальная) */
interface CheckoutTarget {
  branch?: string;
  remoteBranch?: { name: string; fullName: string };
}

/** Тост без `id`: его даёт `notify` */
type Toast = Omit<ToastData, 'id'>;
type Notify = (toast: Toast) => void;

/** Подтверждение (`confirm`) */
interface ConfirmOptions {
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** Открытое окно (одновременно не больше одного) */
type Dialog =
  | { type: 'init'; info: FolderInfo_Serialize; reason: 'open' | 'create'; mode?: 'init' | 'connect'; error: DialogError | null }
  | { type: 'clone' }
  | { type: 'settings'; tab: string }
  | { type: 'integrations' }
  | { type: 'guide'; section?: string }
  | { type: 'about' }
  | { type: 'access' }
  | { type: 'actions'; id?: string }
  | { type: 'error'; action: ReactNode; error: DialogError }
  | { type: 'rejected'; branch: string | null | undefined; remote: string }
  | { type: 'checkoutWip'; target: CheckoutTarget; wip: WipConflict; resolve: (res: UiResult<unknown>) => void }
  | { type: 'branch'; startHash: string | null; startLabel: string; error: DialogError | null; flow: GitFlowConfig | null }
  | { type: 'tag'; hash: string; label: string; error?: DialogError | null }
  | ({ type: 'confirm' } & ConfirmOptions)
  | { type: 'renameBranch'; from: string; upstream: string | null | undefined; busy: boolean; error: DialogError | null }
  | { type: 'deleteRemote'; remote: string; branch: string; fullName: string; locals: string[]; busy: boolean; error: DialogError | null }
  | { type: 'guard'; mode: 'commit' | 'view'; result: GuardScan_Serialize; resolve?: (ok: boolean) => void }
  | { type: 'actionConfirm'; title: ReactNode; body: ReactNode; onYes: () => void; onNo: () => void }
  | { type: 'switchTo'; node: GraphEntry; locals: CommitRef[]; remotes: CommitRef[] }
  | { type: 'revertTo'; commit: GraphEntry };

type DialogOf<T extends Dialog['type']> = Extract<Dialog, { type: T }>;

/** Окно «Авторизация репозитория» */
interface AuthState {
  dir: string | null;
  url: string | null;
  verify: boolean;
  target: AuthTarget;
  error: DialogError | null;
  retry: (() => Promise<UiResult<unknown>>) | null;
  actionLabel: string | null;
  forCi: boolean;
  formError: ApiError | null;
  notice: { message: string; hint: string | null | undefined } | null;
  busy: boolean;
  nonce: number;
}
interface AuthOptions {
  url?: string | null;
  verify?: boolean;
  error?: DialogError | null;
  retry?: (() => Promise<UiResult<unknown>>) | null;
  actionLabel?: string | null;
  forCi?: boolean;
}

/** Параметры `run` */
interface RunOptions<N extends RepoActionName> {
  label?: string;
  success?: string | ((data: ActionOutput<N>) => string) | null;
  onError?: (error: UiError) => boolean;
  progress?: string;
  authRetry?: boolean;
}

/** Просмотр CI/CD в центре */
interface CiViewState {
  file: string | null;
  mode: string;
  pipelineId?: string | number | null;
  focusFailed?: boolean;
  n: number;
}
/** Сравнение двух коммитов */
interface CompareViewState {
  a: string;
  b: string;
}
/** Поиск по изменённым строкам коммитов */
interface ContentSearch {
  query: string;
  loading: boolean;
  data: HistorySearch_Serialize | null;
  error: ApiError | null;
}
/** Шаг действия из конструктора: результат одного шага */
type StepResult = { ok: boolean; data?: unknown; error?: (Partial<UiError> & { message?: string }) | null; skipped?: boolean; note?: string | null };
/** Ход выполнения действия вместе с контекстом подстановок */
type RunState = ActionRun & { ctx: ExpandContext & { inputs: Record<string, string | undefined> } };
/** Что перетаскивают на ветку */
type DragSource = RefDragPayload;
/** Открытый diff: файл из списка коммита, stash, рабочей копии или сравнения */
type AppDiffTarget = DiffTarget & { file: RowFile; list: RowFile[]; hash?: string; parent?: string | null };
/** Выбранная строка: коммит или WIP из графа либо stash из боковой панели */
type SelectedEntry =
  | (GraphEntry & { isStash?: undefined; key?: undefined; id?: undefined })
  | (Stash_Serialize & { isStash: true; key: string; wip?: undefined; parents?: undefined; stash?: undefined });
/** Stash из списка репозитория (или строки графа) */
type StashLike = Pick<Stash_Serialize, 'id' | 'hash' | 'message'> & Partial<Stash_Serialize>;
/** Меню файла stash из панели: свой stash и своё восстановление */
interface FileMenuExtra {
  stash?: StashLike;
  restore?: () => void;
}
/** Тип списка файлов у diff */
type FileKind = 'commit' | 'stash' | 'staged' | 'unstaged' | 'compare';
/** Файл, у которого бывает версия из stash */
type AnyFile = RowFile & Partial<Pick<CommitFile_Serialize, 'diffHash' | 'diffParent'>>;
/** Значения шага действия после подстановок (поля задаёт конструктор действий, `STEP_TYPES`) */
interface StepValues {
  mode?: string;
  force?: boolean;
  name?: string;
  from?: string;
  checkout?: boolean;
  branch?: string;
  onto?: string;
  ref?: string;
  message?: string;
  stageAll?: boolean;
  target?: string;
  title?: string;
  draft?: boolean;
  open?: boolean;
  text?: string;
  command?: string;
}
type PropsOf<C extends (props: never) => ReactNode, K extends keyof Parameters<C>[0]> = Parameters<C>[0][K];
/** Откуда открыть историю файла и blame */
type FileViewBase = Pick<FileViewState, 'path' | 'rev' | 'focus' | 'blameRev'>;
/** История и blame файла: что доступно и почему нет */
interface FileViews {
  history: FileViewBase | null;
  blame: FileViewBase | null;
  reason?: string;
}

const api = window.api as unknown as AppApi;

// Сеттеры хранилища стабильны: функции созданы один раз вместе с ним
const { setSelectedHash, setFilesByHash, setLoadError } = repoStore.getState();
// Всегда текущие значения хранилища (раньше — useRef, обновлявшийся при отрисовке)
const repoRef = {
  get current() {
    return repoStore.getState().repo;
  },
};
const activeRef = {
  get current() {
    return repoStore.getState().activePath;
  },
};

// Ошибки, которые показываем модальным окном с подсказкой, а не всплывашкой
// Пустые вкладки («Новая вкладка») — path с этим префиксом вместо пути к репозиторию
const NEW_TAB = 'new-tab:';
const isNewTab = (p: unknown) => typeof p === 'string' && p.startsWith(NEW_TAB);

const ACCESS_CODES = new Set(['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'PROTECTED', 'HOOK_DECLINED', 'HOST_KEY']);
// Оверлей поверх графа для долгих операций: что показывать, пока операция идёт
const PROGRESS_TEXT: Record<string, string> = {
  checkout: tr('switching-branch'),
  checkoutCommit: tr('switching-to-commit'),
  pull: tr('pulling-changes-from-server'),
  push: tr('pushing-to-server'),
  fetch: tr('fetching-from-server'),
  merge: tr('merging-branches'),
  rebase: tr('rebasing'),
  rebaseApply: tr('applying-rebase'),
  rebaseStart: tr('rebasing'),
  cherryPick: 'Cherry-pick…',
  revert: tr('creating-revert-commit'),
  revertTo: tr('restoring-project-files'),
  reset: tr('moving-branch'),
  stash: tr('stashing-changes'),
  stashPop: tr('applying-stash'),
  stashApplyAt: tr('applying-stash'),
  stashPopAt: tr('applying-stash'),
  undo: tr('undoing'),
  redo: tr('redoing'),
  createBranch: tr('creating-branch'),
  continueOperation: tr('continuing'),
  abortOperation: tr('aborting'),
};


const OPERATION_LABELS: Record<string, string> = { rebase: 'rebase', merge: 'merge', 'cherry-pick': 'cherry-pick', revert: 'revert' };

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
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
  // Состояние репозитория — в хранилище `state/repoStore.ts`
  const repo = useRepoStore((s) => s.repo);
  const loading = useRepoStore((s) => s.loading);
  const loadingLabel = useRepoStore((s) => s.loadingLabel);
  const loadError = useRepoStore((s) => s.loadError);
  const selectedHash = useRepoStore((s) => s.selectedHash);
  const filesByHash = useRepoStore((s) => s.filesByHash);
  const activePath = useRepoStore((s) => s.activePath);
  const loadingMore = useRepoStore((s) => s.loadingMore);
  const loadMoreError = useRepoStore((s) => s.loadMoreError);
  const [booting, setBooting] = useState(true);
  const [sidebarW, setSidebarW, saveSidebarW] = useStoredWidth('panel.sidebar', 256, 170, 480);
  const [detailsW, setDetailsW, saveDetailsW] = useStoredWidth('panel.details', 300, 250, 680);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyText, setBusyText] = useState<string | null>(null); // текст оверлея для долгих операций (checkout, pull…)
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [pullMode, setPullMode] = useState(readPullMode);
  // Поведение: что делать с незакоммиченными изменениями при переключении ветки
  // ('ask' — спросить, 'stash' — спрятать под именем ветки, 'merge' — перенести) и синхронизация индекса
  const [workflow, setWorkflow] = useState<Workflow>(() => ({
    checkoutWip: ['ask', 'stash', 'merge'].includes(readPref('checkoutWip', 'ask')) ? readPref('checkoutWip', 'ask') : 'ask',
    syncIndex: readPref('syncIndex', '1') !== '0',
  }));
  const updateWorkflow = (next: Workflow) => {
    setWorkflow(next);
    writePref('checkoutWip', next.checkoutWip);
    writePref('syncIndex', next.syncIndex ? '1' : '0');
  };
  // Перейти к коммиту в графе: выделить и плавно прокрутить, чтобы он оказался по центру (после checkout — новый HEAD)
  const [graphFocus, setGraphFocus] = useState<{ hash: string; n: number } | null>(null); // { hash, n }
  useEffect(() => {
    if (graphFocus?.hash) setSelectedHash(graphFocus.hash);
  }, [graphFocus]);
  const [fsTick, setFsTick] = useState(0); // счётчик изменений файлов на диске — для повторной проверки перед коммитом
  // Pre-commit Guard: правила и последняя проверка staged-изменений
  const [guardCfg, setGuardCfg] = useState(readGuard);
  const updateGuard = (next: GuardConfig) => {
    setGuardCfg(next);
    writeGuard(next);
  };
  const [guardResult, setGuardResult] = useState<GuardScan_Serialize | null>(null);
  // Конструктор действий
  const [userActions, setUserActions] = useState(readActions);
  const updateActions = (list: CustomAction[]) => {
    setUserActions(list);
    writeActions(list);
  };
  const [actionRun, setActionRun] = useState<RunState | null>(null); // ход выполнения
  const [dragSource, setDragSource] = useState<DragSource | null>(null); // перетаскиваемый коммит/ветка
  const [runPrompt, setRunPrompt] = useState<{ action: CustomAction; inputs: ActionInput[] } | null>(null); // { action, inputs } — спросить значения перед запуском
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null); // { x, y, node }
  const [diffTarget, setDiffTarget] = useState<AppDiffTarget | null>(null); // { kind, mode, hash, parent, file, list, index, commitHash }
  const [ciView, setCiViewRaw] = useState<CiViewState | null>(null); // { file, mode, pipelineId } — открыт просмотр CI/CD
  const [compareView, setCompareViewRaw] = useState<CompareViewState | null>(null); // { a, b } — сравнение двух коммитов
  const [rebaseView, setRebaseViewRaw] = useState<RebaseSession | null>(null); // { upstream, onto?, nonce } — интерактивный rebase
  const [fileView, setFileViewRaw] = useState<FileViewState | null>(null); // { path, rev, mode, blameRev, blamePath, blameStack, focus } — история файла / blame
  const [compareMark, setCompareMark] = useState<string | null>(null); // коммит, отмеченный для сравнения
  // В центре одновременно открыта только одна большая панель
  const setCiView = (v: CiViewState | null) => {
    setCiViewRaw(v);
    if (v) {
      setCompareViewRaw(null);
      setRebaseViewRaw(null);
      setFileViewRaw(null);
    }
  };
  const setCompareView = (v: CompareViewState | null) => {
    setCompareViewRaw(v);
    if (v) {
      setCiViewRaw(null);
      setRebaseViewRaw(null);
      setFileViewRaw(null);
      setDiffTarget(null);
    }
  };
  const setRebaseView = (v: RebaseSession | null) => {
    setRebaseViewRaw(v);
    if (v) {
      setCiViewRaw(null);
      setCompareViewRaw(null);
      setFileViewRaw(null);
      setDiffTarget(null);
    }
  };
  const setFileView = (v: FileViewState | null) => {
    setFileViewRaw(v);
    if (v) {
      setCiViewRaw(null);
      setCompareViewRaw(null);
      setRebaseViewRaw(null);
      setDiffTarget(null);
    }
  };
  // Оформление: тема, фон, прозрачность. Кэш в localStorage — чтобы не мигало при запуске
  const [appearance, setAppearance] = useState<Appearance>(readCachedAppearance);
  const [appearanceMeta, setAppearanceMeta] = useState({ supportsMaterial: false, hasImage: false });
  const [bgImage, setBgImage] = useState<string | null>(null);
  const saveAppearanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // статусы пайплайнов GitLab: { bySha, pipelines, error }
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [diffView, setDiffView] = useState(() => readPref('diffView', 'unified'));
  const [ignoreWs, setIgnoreWs] = useState(() => readPref('ignoreWs', '0') === '1');
  // Показывать весь файл, а не только места изменений: выбор запоминается (localStorage → в 2.0 ещё и SQLite)
  const [diffFullFile, setDiffFullFile] = useState(() => readPref('diff.fullFile', '0') === '1');
  const [diffNonce, setDiffNonce] = useState(0); // файл сохранён из редактора — перечитать diff

  // Вкладки: [{ path, name }], активная — по path
  const [tabs, setTabs] = useState<Tab[]>([]);
  const tabsLoaded = useRef(false);

  const busyRef = gitBusy; // идёт действие пользователя (`state/syncStore.ts`)

  // Загрузка показала другой репозиторий — права доступа проверяются заново
  useEffect(() => repoStore.getState().onSwitch(() => setAccess(null)), []);

  /* ---------- Уведомления ---------- */

  const closeToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify: Notify = useCallback(
    (toast: Toast) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t.slice(-4), { ...toast, id }]);
      if (toast.type !== 'error') setTimeout(() => closeToast(id), 4500);
    },
    [closeToast],
  );

  /* ---------- Загрузка репозитория ---------- */

  // Загрузка: побеждает последний запрос, устаревшие ответы только кладутся в кэш вкладки (`repoStore.load`)
  const loadRepo = repoStore.getState().load;

  /* ---------- Вкладки ---------- */

  const rememberActiveTab = () => repoStore.getState().rememberActive();

  // Пустая вкладка («Новая вкладка») или ни одной: репозитория нет, показываем стартовую страницу
  const showBlank = (path: string | null) => {
    repoStore.getState().showBlank(path); // заодно отменяет ответы на ещё идущие загрузки
    setDiffTarget(null);
    setCiView(null);
    setCompareView(null);
    setRebaseView(null);
    setFileView(null);
    setCompareMark(null);
    setMenu(null);
    setAccess(null);
  };

  // «+» рядом с вкладками и Ctrl+T — новая вкладка со списком репозиториев
  const newTab = () => {
    rememberActiveTab();
    const id = `${NEW_TAB}${Date.now()}`;
    setTabs((t) => [...t, { path: id, name: tr('new-tab'), isNew: true }]);
    showBlank(id);
  };

  const showTab = (path: string) => {
    if (isNewTab(path)) {
      rememberActiveTab();
      showBlank(path);
      return;
    }
    rememberActiveTab();
    setDiffTarget(null);
    setCiView(null);
    setCompareView(null);
    setRebaseView(null);
    setFileView(null);
    setCompareMark(null);
    setMenu(null);
    setAccess(null);
    // Мгновенно показываем сохранённое состояние, затем тихо обновляем
    repoStore.getState().showCached(path);
  };

  const openTab = async (dir: string) => {
    // Открываем из «Новой вкладки» — репозиторий займёт её место, как в GitKraken
    const replacing = isNewTab(activeRef.current) ? activeRef.current : null;
    rememberActiveTab();
    const data = await loadRepo(dir);
    if (!data) return;
    setTabs((t) => {
      const entry = { path: data.path, name: data.name };
      // Уже открыт в другой вкладке — пустую просто закрываем
      if (t.some((x) => x.path === data.path)) return replacing ? t.filter((x) => x.path !== replacing) : t;
      if (replacing && t.some((x) => x.path === replacing)) return t.map((x) => (x.path === replacing ? entry : x));
      return [...t, entry];
    });
    repoStore.getState().setActivePath(data.path);
  };

  const closeTab = (path: string) => {
    const index = tabs.findIndex((t) => t.path === path);
    if (index === -1) return;
    const rest = tabs.filter((t) => t.path !== path);
    repoStore.getState().forgetTab(path);
    setTabs(rest);
    if (path !== activePath) return;
    if (rest.length) {
      showTab(rest[Math.min(index, rest.length - 1)].path);
    } else {
      showBlank(null);
    }
  };

  const cycleTab = (delta: number) => {
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.path === activePath);
    showTab(tabs[(index + delta + tabs.length) % tabs.length].path);
  };

  // Сохраняем список вкладок
  useEffect(() => {
    // «Новые вкладки» не сохраняем — после перезапуска открываются только репозитории
    if (tabsLoaded.current) api?.tabs?.save(tabs.filter((t) => !t.isNew).map((t) => t.path), isNewTab(activePath) ? null : activePath);
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
          repoStore.getState().setActivePath(saved.active);
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
      if (repoRef.current && !busyRef.current) loadRepo(repoRef.current!.path, { silent: true });
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
  const createRepository = async (presetDir?: string | null, mode: 'init' | 'connect' = 'init') => {
    const dir =
      presetDir ??
      (await api?.repo.openDialog(
        mode === 'connect' ? tr('choose-project-folder-to-connect') : tr('choose-project-folder-for-new'),
      ));
    if (!dir) return;
    const res = await api.repo.inspect(dir);
    if (!res.ok) return notify({ type: 'error', title: res.error.message, hint: res.error.hint });
    if (res.data.isRepoRoot) {
      notify({ type: 'info', title: tr('is-already-git-repository-opening', res.data.name) });
      return openTab(res.data.path);
    }
    setDialog({ type: 'init', info: res.data, reason: 'create', mode, error: null });
  };

  const probeRemote = (url: string, branch?: string | null) => api.repo.probeRemote((dialog as DialogOf<'init'> | null)?.info?.path, { url, branch });

  const submitConnect = async (options: ConnectOptions_Deserialize) => {
    const info = (dialog as DialogOf<'init'> | null)?.info;
    if (!info) return;
    setInitBusy(true);
    setDialog((d) => ({ ...d, error: null }) as Dialog);
    const res = await api.repo.connect(info.path, options);
    setInitBusy(false);
    if (!res.ok) {
      setDialog((d) => (d?.type === 'init' ? { ...d, error: res.error } : d));
      return;
    }
    const r = res.data;
    setDialog(null);
    const parts = [
      tr('branch-2', r.branch),
      !r.remoteWasEmpty && tr('history-loaded-from-server'),
      r.restored! > 0 && tr('added-from-server', r.restored, plural(r.restored!, tr('file'), tr('files-2'), tr('files'))),
      r.commit?.hash && tr('commit-2', r.commit.hash.slice(0, 7), r.commit.files, plural(r.commit.files!, tr('file'), tr('files-2'), tr('files'))),
      r.pushed && tr('pushed-to-server'),
    ].filter(Boolean);
    notify({ type: 'success', title: tr('connected-to', r.name, r.url), hint: parts.join(' · ') });
    if (r.pushError) {
      notify({
        type: 'error',
        title: tr('repository-is-connected-but-push', r.pushError.message),
        hint: tr('commit-is-saved-locally-you', r.pushError.hint ?? '').trim(),
        details: r.pushError.details,
      });
    }
    openTab(r.path);
  };

  const [initBusy, setInitBusy] = useState(false);
  const submitInit = async (options: InitOptions_Deserialize) => {
    const info = (dialog as DialogOf<'init'> | null)?.info;
    if (!info) return;
    setInitBusy(true);
    setDialog((d) => ({ ...d, error: null }) as Dialog);
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
      title: tr('repository-created', r.name),
      hint: [
        tr('branch-2', r.branch),
        r.commit?.hash &&
          tr('commit-2', r.commit.hash.slice(0, 7), r.commit.files, plural(r.commit.files!, tr('file'), tr('files-2'), tr('files'))),
        r.commit && !r.commit.hash && tr('commit-skipped-no-files'),
        r.remote && `origin → ${r.remote}`,
      ]
        .filter(Boolean)
        .join(' · '),
    });
    openTab(r.path);
  };

  /* ---------- Папка репозитория: Проводник / Finder и терминал ---------- */

  const openRepoFolder = async (dir: string | null | undefined = repoRef.current?.path) => {
    if (!dir || !api?.openFolder) return;
    const res = await api.openFolder(dir);
    if (!res.ok) notify({ type: 'error', title: res.error.message, hint: res.error.hint, details: res.error.details });
  };
  const openRepoTerminal = async (dir: string | null | undefined = repoRef.current?.path) => {
    if (!dir || !api?.openTerminal) return;
    const res = await api.openTerminal(dir);
    if (!res.ok) notify({ type: 'error', title: res.error.message, hint: res.error.hint, details: res.error.details });
  };
  const repoFolderItems = (dir: string | null | undefined = repoRef.current?.path): AppMenuItem[] => [
    { id: 'reveal', label: openFolderLabel(), icon: FolderOpen, disabled: !dir, onClick: () => openRepoFolder(dir) },
    { id: 'terminal', label: openTerminalLabel(), icon: SquareTerminal, disabled: !dir, onClick: () => openRepoTerminal(dir) },
  ];

  const fileMenuItems = (): AppMenuItem[] => [
    { id: 'new-tab', label: tr('new-tab'), icon: Plus, hint: 'Ctrl+T', onClick: newTab },
    { id: 'open', label: tr('open-repository'), icon: FolderOpen, hint: 'Ctrl+O', onClick: openRepository },
    { id: 'init', label: tr('create-repository'), icon: GitBranch, hint: 'Ctrl+N', onClick: () => createRepository() },
    { id: 'clone', label: tr('clone-repository'), icon: CloudDownload, hint: 'Ctrl+Shift+O', onClick: () => setDialog({ type: 'clone' }) },
    {
      id: 'connect',
      label: tr('connect-folder-to-gitlab-github'),
      icon: Link2,
      onClick: () => createRepository(undefined, 'connect'),
    },
    { separator: true },
    ...repoFolderItems(activePath),
    { separator: true },
    {
      id: 'close-tab',
      label: tr('close-tab'),
      icon: X,
      hint: 'Ctrl+W',
      disabled: !activePath,
      onClick: () => activePath && closeTab(activePath),
    },
    // На macOS «Завершить» — в меню приложения (⌘Q)
    ...(IS_MAC ? [] : [{ id: 'quit', label: tr('exit'), icon: LogOut, onClick: () => api?.window.close() }]),
  ];

  // Ctrl+O — открыть, Ctrl+W — закрыть вкладку, Ctrl+Tab / Ctrl+Shift+Tab — переключить
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Tab — и на Mac Control: ⌘Tab занят системой
      if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      // Ctrl+Alt+F (⌘⌥F) — фильтр веток и тегов слева
      if (isMod(e) && e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        window.dispatchEvent(new Event('gitidea:focus-filter'));
        return;
      }
      if (!isMod(e) || e.altKey) return;
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
      } else if ((key === 't' || key === 'е') && !e.shiftKey) {
        e.preventDefault();
        newTab();
      } else if ((key === 'w' || key === 'ц') && activePath) {
        e.preventDefault();
        closeTab(activePath);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refresh = () => repo && loadRepo(repo!.path, { silent: true });

  /* ---------- Проверка доступа к remote ---------- */

  const checkAccess = useCallback(async (): Promise<AccessState | null> => {
    const current = repoRef.current;
    if (!current || current.remotes.length === 0) return null;
    setAccess((a) => ({ status: 'checking', data: a?.data ?? null, error: null }));
    const res = await api.repo.action(current.path, 'checkAccess', { write: true });
    if (repoRef.current?.path !== current.path) return null;
    const next: AccessState = { status: 'done', data: res.ok ? res.data : null, error: res.ok ? null : res.error };
    setAccess(next);
    return next;
  }, []);

  // Проверяем доступ при открытии репозитория и при смене текущей ветки
  const accessKey = repo && repo!.remotes.length ? `${repo!.path}|${repo!.currentBranch}` : null;
  useEffect(() => {
    if (accessKey) checkAccess();
  }, [accessKey, checkAccess]);

  /* ---------- Авторизация на remote-сервере ---------- */

  // { dir, url, target, error, formError, busy, retry } — окно «Авторизация репозитория»
  const [auth, setAuth] = useState<AuthState | null>(null);
  const authRef = useRef<AuthState | null>(null);
  authRef.current = auth;

  // Список серверов и репозиториев в настройках перечитывается после входа
  const [serversTick, setServersTick] = useState(0);

  // Авторизация CI/CD привязана к репозиторию и может браться из его входа — после смены входа перечитываем (`state/ciStore.ts`)
  const refreshForge = ciStore.getState().refreshForge;

  /**
   * Открыть окно входа — вход привязан к репозиторию.
   * Без url — открытый репозиторий (его remote; без remote окно предложит указать, где он хранится);
   * url — клонирование или репозиторий из списка в настройках (verify: проверить доступ git ls-remote).
   * retry() → { ok, error } — операция, которую повторить после входа (без retry — проверить доступ).
   */
  const openAuth = useCallback(async ({ url = null, verify = false, error = null, retry = null, actionLabel = null, forCi = false }: AuthOptions = {}) => {
    if (!api?.creds || authRef.current) return;
    const dir = url ? null : repoRef.current?.path ?? null;
    if (!url && !dir) return;
    const res = await api.creds.describe(dir, url);
    if (!res.ok) {
      if (error) setDialog({ type: 'error', action: tr('sign-in'), error });
      else notify({ type: 'error', title: res.error.message, hint: res.error.hint });
      return;
    }
    setAuth({ dir, url, verify, target: res.data as AuthTarget, error, retry, actionLabel, forCi, formError: null, notice: null, busy: false, nonce: Date.now() });
  }, []);

  const submitAuth = async (data: AuthSubmit) => {
    const a = authRef.current;
    if (!a) return;
    setAuth({ ...a, busy: true, formError: null, notice: null });
    const saved = await api.creds!.save(a.dir, a.url, data);
    if (!saved.ok) {
      setAuth((cur) => cur && { ...cur, busy: false, formError: saved.error });
      return;
    }
    setServersTick((n) => n + 1);
    if (a.dir) refreshForge();
    const moved = saved.data.remoteChange;
    if (moved) {
      notify({
        type: 'info',
        title: moved.from ? tr('remote-now-points-to', moved.remote, saved.data.hostname) : tr('added-remote', moved.remote),
        hint: moved.from ? `${moved.from} → ${moved.to}` : moved.to,
      });
      if (a.dir) await loadRepo(a.dir, { silent: true });
    }
    // Повторяем прерванную операцию; без неё — проверяем доступ (git ls-remote / push --dry-run)
    let result: { ok: boolean; error?: DialogError | null };
    if (a.retry) result = await a.retry();
    else if (a.verify && a.url) result = await api.creds!.checkUrl(a.url);
    else {
      const acc = await checkAccess();
      const err = acc?.error ?? acc?.data?.error ?? null;
      result = err ? { ok: false, error: err } : { ok: true };
    }
    if (result?.ok === false && ['AUTH', 'HOST_KEY', 'NOT_FOUND', 'FORBIDDEN'].includes(result.error?.code as string)) {
      // Сервер снова не пустил — окно остаётся (уже с сохранённым входом), показываем свежую ошибку
      setAuth((cur) => cur && { ...cur, busy: false, target: saved.data as AuthTarget, error: result.error! });
      return;
    }
    // Авторизация одна: та же должна открывать пайплайны. Не открывает — окно остаётся и объясняет почему
    const apiRes = (saved.data as AuthTarget).api;
    if (result?.ok !== false && apiRes && (apiRes.state === 'bad' || (a.forCi && apiRes.state === 'none'))) {
      setAuth((cur) => cur && { ...cur, busy: false, target: saved.data as AuthTarget, error: null, notice: { message: tr('pull-and-push-work-but'), hint: apiRes.reason } });
      return;
    }
    setAuth(null);
    const where = (saved.data as AuthTarget).repoPath ? `${(saved.data as AuthTarget).repoPath} (${(saved.data as AuthTarget).hostname})` : (saved.data as AuthTarget).hostname ?? (saved.data as AuthTarget).host;
    if (result?.ok !== false) {
      notify({ type: 'success', title: tr('signed-in-to-credentials-saved', where), hint: apiRes?.state === 'ok' ? tr('same-sign-in-also-works') : undefined });
      if (repoRef.current?.remotes?.length && a.retry) checkAccess();
    } else if (result?.error && result.error.code !== 'BUSY') {
      notify({ type: 'error', title: result.error.message, hint: result.error.hint, details: result.error.details });
    }
  };

  const forgetAuth = async () => {
    const a = authRef.current;
    if (!a) return;
    const res = await api.creds!.clear(a.dir, a.url);
    if (res.ok) {
      const fresh = await api.creds!.describe(a.dir, a.url);
      setAuth((cur) => cur && { ...cur, target: fresh.ok ? (fresh.data as AuthTarget) : { ...cur.target, saved: null } });
      setServersTick((n) => n + 1);
      refreshForge();
      notify({
        type: 'info',
        title: res.data.shared ? tr('shared-sign-in-for-removed', a.target?.hostname ?? tr('server')) : tr('sign-in-for-removed', a.target?.repoPath ?? tr('repository')),
      });
    }
  };

  /* ---------- Запуск действий ---------- */

  /**
   * label   — название действия для сообщений об ошибке
   * success — текст (или функция от data) для уведомления об успехе
   * onError — вернуть true, если ошибка обработана сама
   */
  const run = async <N extends RepoActionName>(name: N, payload: ActionPayload<N> = {} as ActionPayload<N>, options: RunOptions<N> = {}): Promise<ActionResult<N>> => {
    const { label, success, onError, progress, authRetry = false } = options;
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
    // Повтор из окна авторизации: ошибку покажет само окно
    if (authRetry) return res;
    if (onError?.(res.error)) return res;
    // Сервер не пустил — сразу окно входа; «Войти и повторить» перезапустит эту же операцию
    if (res.error.code === 'AUTH' && api?.creds) {
      openAuth({ error: res.error, retry: () => run<N>(name, payload, { ...options, authRetry: true }) });
      return res;
    }
    if (ACCESS_CODES.has(res.error.code)) {
      setDialog({ type: 'error', action: label ?? name, error: res.error });
      if (['AUTH', 'FORBIDDEN', 'NOT_FOUND', 'HOST_KEY'].includes(res.error.code)) checkAccess();
    } else {
      notify({ type: 'error', title: `${label ?? name}: ${res.error.message}`, hint: res.error.hint, details: res.error.details });
    }
    return res;
  };

  const pull = (mode: string = pullMode) => {
    setPullMode(mode);
    try {
      localStorage.setItem('pullMode', mode);
    } catch {
      /* хранилище недоступно — не страшно */
    }
    return run('pull', { mode }, {
      label: 'Pull',
      success: (d) => (d.updated ? tr('pull-updated-from', d.branch, d.upstream) : tr('is-already-up-to-date', d.branch)),
    });
  };

  const fetchAll = () =>
    run('fetch', {}, { label: 'Fetch', success: (d) => tr('fetch-updated', d.remotes.join(', ')) });

  const push = (force = false) =>
    run('push', { force }, {
      label: force ? 'Force Push' : 'Push',
      success: (d) =>
        `${d.forced ? 'Force push' : 'Push'}: ${d.branch} → ${d.remote}${d.setUpstream ? tr('upstream-set') : ''}`,
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

  const undo = () => run('undo', {}, { label: 'Undo', success: (d) => tr('undone', d.label) });
  // Актуальные обработчики для глобальных горячих клавиш (эффект регистрируется один раз)
  const hotkeys = useRef({} as { undo: () => void; redo: () => void; repo: RepoData | null; busyAction: string | null });
  const redo = () => run('redo', {}, { label: 'Redo', success: (d) => tr('redone', d.label) });

  hotkeys.current = { undo, redo, repo, busyAction };

  // Ctrl+Z / Ctrl+Y — отменить/повторить (не в полях ввода), F1 — горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setDialog((d) => d ?? { type: 'guide' });
        return;
      }
      if (!isMod(e) || e.altKey) return;
      const t = e.target as HTMLElement | null;
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


  /**
   * Checkout ветки (локальной или удалённой — тогда создаётся локальная, отслеживающая её).
   * Если в рабочей папке есть изменения, main-процесс отвечает WIP_CONFLICT — спрашиваем, что с ними делать
   * (спрятать / перенести / выбросить), и повторяем с выбранной стратегией. Промис завершается после выбора:
   * вызывающий код (например, «переключиться и перебазировать») продолжит только после успешного checkout.
   */
  const checkout = (target: CheckoutTarget, strategy?: WipChoice): Promise<UiResult<unknown>> =>
    new Promise((resolve) => {
      const auto = workflow.checkoutWip !== 'ask' ? (workflow.checkoutWip as WipChoice) : undefined;
      let deferred = false;
      run('checkout', { ...target, strategy: strategy ?? auto }, {
        label: 'Checkout',
        progress: tr('switching-to', target.branch ?? target.remoteBranch?.fullName ?? ''),
        success: (d) => {
          const parts = [d.created ? tr('created-branch-tracking', d.created.name, d.created.track) : `Checkout: ${d.to.branch}`];
          if (d.autoStash) parts.push(tr('changes-in-stashed-theyll-come', d.autoStash.branch, d.autoStash.files));
          if (d.restored && !d.restored.conflict) parts.push(tr('changes-in-restored', d.restored.branch));
          if (d.moved && !d.moved.conflict) parts.push(tr('changes-moved', d.moved.files));
          if (d.discarded) parts.push(tr('changes-discarded-ctrl-z-brings', d.discarded.files));
          if (d.restored?.conflict) {
            notify({
              type: 'error',
              title: tr('changes-of-branch-came-back', d.restored.branch),
              hint: tr('stash-is-kept-in-stashes'),
            });
          }
          if (d.moved?.conflict) {
            notify({
              type: 'error',
              title: tr('changes-moved-to-with-conflict', d.to.branch),
              hint: tr('copy-of-changes-remains-in'),
            });
          }
          return parts.join(' · ');
        },
        onError: (error) => {
          if (error.code !== 'WIP_CONFLICT' || !error.data) return false;
          deferred = true;
          setDialog({ type: 'checkoutWip', target, wip: error.data as WipConflict, resolve });
          return true;
        },
      }).then((res) => {
        if (res.ok && res.data?.head) setGraphFocus({ hash: res.data.head, n: Date.now() });
        if (!deferred) resolve(res);
      });
    });
  // Выбор в окне «незакоммиченные изменения»: повторяем checkout со стратегией; «Больше не спрашивать» — в настройки
  const chooseCheckoutWip = async (strategy: WipChoice, remember: boolean) => {
    const d = dialog;
    if (!d || d.type !== 'checkoutWip') return;
    if (remember) updateWorkflow({ ...workflow, checkoutWip: strategy });
    setDialog(null);
    const res = await checkout(d.target, strategy);
    d.resolve?.(res);
  };

  const stash = () =>
    run('stash', {}, {
      label: 'Stash',
      success: (d) => tr('stashed-changes-2', d.files, d.duplicates ? tr('older-copy-with-same-changes') : ''),
    });
  const stashPop = () => run('stashPop', {}, { label: 'Pop', success: tr('stash-applied') });

  const createBranch = async (params: ActionPayload<'createBranch'>) => {
    setDialog((d) => ({ ...d, error: null }) as Dialog);
    const res = await run('createBranch', params, {
      label: 'Branch',
      success: (d) => tr('branch-created', d.name, d.checkedOut ? tr('and-checked-out') : ''),
      onError: (error) => {
        if (!['INVALID_NAME', 'BRANCH_EXISTS'].includes(error.code)) return false;
        setDialog((d) => (d?.type === 'branch' ? { ...d, error } : d));
        return true;
      },
    });
    if (res.ok) setDialog(null);
  };

  // Создание ветки прямо из списка веток: от HEAD и сразу переключиться
  const quickCreateBranch = (name: string) =>
    run('createBranch', { name, checkout: true }, {
      label: 'Branch',
      progress: tr('creating-branch-2', name),
      success: (d) => tr('branch-created-and-checked-out', d.name),
    });

  // Показать коммит в графе: выделить и прокрутить к нему
  const locateCommit = (hash: string | null | undefined) => {
    if (!hash) return;
    setDiffTarget(null);
    setCiView(null);
    setCompareView(null);
    setRebaseView(null);
    setFileView(null);
    setSelectedHash(hash);
  };

  const openBranchDialog = (node?: GraphEntry) => {
    const sel = node ?? allCommits.find((c) => c.hash === selectedHash);
    const startHash = sel && !sel.wip ? sel.hash : repo!.headHash;
    const label = sel && !sel.wip ? `${sel.hash.slice(0, 7)} — ${sel.message}` : `HEAD (${repo!.headHash?.slice(0, 7)})`;
    setDialog({ type: 'branch', startHash, startLabel: label, error: null, flow: null });
    // Приписки git flow из настроек репозитория (git flow init), если они есть
    const path = repo!.path;
    api?.repo?.gitflowConfig?.(path).then((res) => {
      if (res?.ok) setDialog((d) => (d?.type === 'branch' && repoRef.current?.path === path ? { ...d, flow: res.data } : d));
    });
  };
  // Ветки для подсказки «создать от develop / main»: локальные и на сервере
  const branchBases = useMemo(
    () =>
      repo
        ? [
            ...repo.localBranches.map((b) => ({ name: b.name, hash: b.hash })),
            ...(repo!.remotes ?? []).flatMap((r) => r.branches.map((b) => ({ name: b.fullName, hash: b.hash, remote: true }))),
          ]
        : [],
    [repo],
  );

  const stageFiles = (paths: string[] | 'all') => run('stage', { paths }, { label: 'Stage' });
  const unstageFiles = (paths: string[] | 'all') => run('unstage', { paths }, { label: 'Unstage' });
  // Pre-commit Guard: проверка добавленных строк; если что-то нашлось — спрашиваем
  const guardCheck = async (path: string): Promise<boolean> => {
    if (!guardOnFor(guardCfg, path) || !api.repo.guardScan) return true;
    let scan: ApiResult<GuardScan_Serialize>;
    try {
      scan = await api.repo.guardScan(path, { rules: activeRules(guardCfg), exclude: guardCfg.exclude });
    } catch {
      return true; // сама проверка сломалась — коммиту это мешать не должно
    }
    if (!scan?.ok || !scan.data.findings.length) return true;
    return new Promise((resolve) => setDialog({ type: 'guard', mode: 'commit', result: scan.data, resolve }));
  };

  const commit = async (summary: string, description: string) => {
    if (!repoRef.current || busyRef.current) return false;
    if (!(await guardCheck(repoRef.current!.path))) return false;
    const res = await run('commit', { summary, description }, {
      label: 'Commit',
      success: (d) => tr('commit-created', d.hash.slice(0, 7)),
    });
    return res.ok;
  };


  /* ---------- Контекстное меню коммита ---------- */

  const short = (h: string) => h.slice(0, 7);
  const confirm = (opts: ConfirmOptions) => setDialog({ type: 'confirm', ...opts });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify({ type: 'success', title: tr('copied', what) });
    } catch {
      notify({ type: 'error', title: tr('couldnt-copy-to-clipboard') });
    }
  };

  const createTag = async (params: ActionPayload<'createTag'>) => {
    setDialog((d) => ({ ...d, error: null }) as Dialog);
    const res = await run('createTag', params, {
      label: 'Tag',
      success: (d) => tr('tag-created-on', d.name, short(d.hash)),
      onError: (error) => {
        if (!['INVALID_NAME', 'TAG_EXISTS'].includes(error.code)) return false;
        setDialog((d) => (d?.type === 'tag' ? { ...d, error } : d));
        return true;
      },
    });
    if (res.ok) setDialog(null);
  };

  const deleteBranch = (name: string, force = false): Promise<ActionResult<'deleteBranch'>> =>
    run('deleteBranch', { name, force }, {
      label: tr('delete-branch-2'),
      success: (d) => tr('branch-deleted-undo-brings-it', d.name),
      onError: (error) => {
        if (error.code !== 'NOT_MERGED') return false;
        confirm({
          title: tr('branch-not-merged'),
          body: `${error.message}. ${error.hint}`,
          confirmLabel: tr('force-delete', name),
          danger: true,
          onConfirm: () => deleteBranch(name, true),
        });
        return true;
      },
    });

  const resetTo = (node: { hash: string; message: string }, mode: string) => {
    const doReset = () =>
      run('reset', { hash: node.hash, mode }, {
        label: 'Reset',
        success: (d) => tr('reset-to', d.branch ?? 'HEAD', short(d.hash), d.mode),
      });
    if (mode !== 'hard') return doReset();
    const lost = repo!.wipFiles.length;
    confirm({
      title: 'Reset --hard',
      body: tr('branch-will-be-moved-to', repo!.currentBranch ?? 'HEAD', short(node.hash), node.message, lost ? tr('uncommitted-changes-will-be-lost', lost) : ''),
      confirmLabel: 'Reset --hard',
      danger: true,
      onConfirm: doReset,
    });
  };

  /**
   * Ветка как «группа», как в GitKraken: локальная и её серверная копия на том же коммите — одно целое.
   * ref: { type: 'local' | 'remote' | 'tag', name } → { local, remote, synced, info, tracker } | { tag }
   */
  const refGroup = (ref: CommitRef): BranchGroup | null => {
    const remoteHash = (full: string) => repo!.remotes.flatMap((r) => r.branches).find((b) => b.fullName === full)?.hash ?? null;
    if (ref.type === 'tag') return { tag: ref.name };
    if (ref.type === 'local') {
      const info = repo!.localBranches.find((b) => b.name === ref.name) ?? null;
      const up = info?.upstream && !info.gone ? info.upstream : null;
      const synced = Boolean(up && remoteHash(up) === info!.hash);
      return { local: ref.name, remote: synced ? up : null, upstream: up, synced, info };
    }
    if (ref.name.endsWith('/HEAD')) return null;
    const tracker = repo!.localBranches.find((b) => b.upstream === ref.name) ?? null;
    if (tracker && tracker.hash === remoteHash(ref.name)) {
      return { local: tracker.name, remote: ref.name, upstream: ref.name, synced: true, info: tracker };
    }
    return { local: null, remote: ref.name, upstream: ref.name, synced: false, tracker };
  };

  // Группы веток на коммите: без дублей local + origin, текущая ветка — первой
  const refGroupsOf = (node: GraphEntry) => {
    const seen = new Set<string>();
    const groups: BranchGroup[] = [];
    const ordered = [...node.refs].sort((a, b) => (a.type === 'local' ? 0 : a.type === 'remote' ? 1 : 2) - (b.type === 'local' ? 0 : b.type === 'remote' ? 1 : 2));
    for (const ref of ordered) {
      const g = refGroup(ref);
      if (!g) continue;
      const key = g.tag ? `t:${g.tag}` : g.local ? `l:${g.local}` : `r:${g.remote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push(g);
    }
    return groups;
  };

  // «Сделать главной веткой» / «Убрать из главных веток» (`mainBranches.ts`): имя — короткое, origin/main → main
  const mainBranchItem = (name: string): MenuItem => {
    const isMain = mainBranches.names.includes(name);
    const full = !isMain && mainBranches.names.length >= MAX_MAIN_BRANCHES;
    return {
      label: isMain ? tr('remove-from-main-branches') : tr('make-main-branch'),
      icon: Star,
      disabled: full,
      title: full ? tr('main-branches-limit', MAX_MAIN_BRANCHES) : tr('main-branch-pinned'),
      onClick: () => mainBranches.toggle(name),
    };
  };

  /**
   * Меню одной ветки или тега. inCommit — подменю внутри меню коммита: там уже есть Rebase и Reset к этому коммиту,
   * поэтому их не повторяем.
   */
  const buildRefItems = (ref: CommitRef | { group: BranchGroup; type?: undefined; name?: undefined }, { inCommit = false } = {}): MenuEntry[] => {
    const g = (ref as { group?: BranchGroup }).group ?? refGroup(ref as CommitRef);
    if (!g) return [];
    const cur = repo!.currentBranch;
    const curLabel = cur ?? 'HEAD';
    const op = Boolean(repo!.operation);
    const copyName = (name: string): MenuItem => ({ label: tr('copy-name'), icon: Copy, onClick: () => copy(name, tr('name-2')) });

    if (g.tag) {
      return [
        ...(inCommit ? [] : [{ header: tr('tag-3', g.tag) }]),
        copyName(g.tag),
        { separator: true },
        {
          label: tr('delete-tag-2', g.tag),
          icon: Trash2,
          danger: true,
          onClick: () =>
            confirm({
              title: tr('delete-tag-3'),
              body: tr('delete-local-tag', g.tag),
              confirmLabel: tr('delete-2'),
              danger: true,
              onConfirm: () => run('deleteTag', { name: g.tag }, { label: tr('delete-tag-4'), success: tr('tag-deleted', g.tag) }),
            }),
        },
      ];
    }

    if (g.local) {
      const name = g.local;
      const isCur = name === cur;
      const info = g.info;
      const items: MenuEntry[] = [];
      if (!inCommit) items.push({ header: g.synced ? tr('branch-3', name, g.remote) : tr('branch-4', name) });
      // Для текущей ветки «переключиться», «влить в себя» и «перебазировать на себя» не имеют смысла — не показываем
      if (!isCur) items.push({ label: tr('switch-to', name), icon: LogIn, hint: 'Checkout', disabled: op, onClick: () => checkout({ branch: name }) });
      if (g.upstream) {
        items.push({
          label: info?.behind ? tr('update-branch', info.behind) : tr('update-branch-2'),
          icon: ArrowDownToLine,
          hint: 'Pull',
          disabled: (isCur && op) || !info?.behind || (!isCur && info.ahead! > 0),
          title: !info?.behind
            ? tr('no-new-commits-in', g.upstream)
            : !isCur && info.ahead! > 0
              ? tr('has-its-own-commits-switch', name, info.ahead)
              : isCur
                ? tr('pull-from', info.behind, plural(info.behind, tr('commit'), tr('commits'), tr('commits-2')), g.upstream)
                : tr('fast-forward-to-without-switching', name, g.upstream),
          onClick: () => updateBranch(name),
        });
      }
      if (!isCur) {
        items.push({
          label: tr('merge-into', name, curLabel),
          icon: GitMerge,
          hint: 'Merge',
          disabled: op || !cur,
          onClick: () => run('merge', { ref: name }, { label: 'Merge', success: tr('merged-into', name, cur) }),
        });
      }
      if (!inCommit && !isCur) {
        items.push({
          label: tr('rebase-onto-2', curLabel, name),
          icon: Layers,
          hint: 'Rebase',
          disabled: op || !cur,
          title: tr('with-preview-resulting-graph-conflicts'),
          onClick: () => openRebase(name),
        });
        if (info?.hash) {
          const target = { hash: info.hash, message: name };
          items.push({
            label: tr('reset-to-2', curLabel, name),
            icon: History,
            hint: 'Reset',
            disabled: op || !cur || !repo!.headHash || info.hash === repo!.headHash,
            submenu: resetSubmenu(target),
          });
        }
      }
      items.push(
        { separator: true },
        {
          label: tr('rename-2'),
          icon: Pencil,
          hint: 'Rename',
          disabled: op,
          onClick: () => setDialog({ type: 'renameBranch', from: name, upstream: g.upstream, busy: false, error: null }),
        },
        copyName(name),
        mainBranchItem(name),
        { separator: true },
        {
          label: tr('delete-branch-3', name),
          icon: Trash2,
          danger: true,
          disabled: isCur,
          title: isCur ? tr('cant-delete-current-branch') : tr('delete-local-branch-branch-on'),
          onClick: () =>
            confirm({
              title: tr('delete-branch-4'),
              body: tr('delete-local-branch-undo-can', name, g.upstream ? tr('branch-on-server-is-not', g.upstream) : ''),
              confirmLabel: tr('delete-2'),
              danger: true,
              onConfirm: () => deleteBranch(name),
            }),
        },
      );
      // Серверная копия — один пункт, без отдельной секции «На сервере»
      if (g.upstream) {
        items.push({
          label: tr('delete-from-server-2', g.upstream),
          icon: CloudOff,
          danger: true,
          title: tr('delete-branch-on-server-git'),
          onClick: () => askDeleteRemote(g.upstream!),
        });
      }
      return items;
    }

    // Только на сервере: переключение создаёт локальную ветку (или переходит на уже существующую) — без detached HEAD
    const full = g.remote!;
    const short = full.slice(full.indexOf('/') + 1);
    const existing = g.tracker ?? repo!.localBranches.find((b) => b.name === short) ?? null;
    return [
      ...(inCommit ? [] : [{ header: tr('on-server', full) }]),
      existing
        ? {
            label: tr('switch-to', existing.name),
            icon: LogIn,
            hint: 'Checkout',
            disabled: op || existing.name === cur,
            title: tr('local-branch-already-exists-but', existing.name),
            onClick: () => checkout({ branch: existing.name }),
          }
        : {
            label: tr('create-local-and-switch-to', short),
            icon: LogIn,
            hint: 'Checkout',
            disabled: op,
            title: `git switch --track ${full}`,
            onClick: () => checkout({ remoteBranch: { name: short, fullName: full } }),
          },
      {
        label: tr('merge-into', full, curLabel),
        icon: GitMerge,
        hint: 'Merge',
        disabled: op || !cur,
        onClick: () => run('merge', { ref: full }, { label: 'Merge', success: tr('merged-into', full, cur) }),
      },
      ...(inCommit
        ? []
        : [
            {
              label: tr('rebase-onto-2', curLabel, full),
              icon: Layers,
              hint: 'Rebase',
              disabled: op || !cur,
              title: tr('with-preview-resulting-graph-conflicts'),
              onClick: () => openRebase(full),
            },
          ]),
      copyName(full),
      mainBranchItem(short),
      { separator: true },
      {
        label: tr('delete-from-server-2', full),
        icon: CloudOff,
        danger: true,
        title: tr('delete-branch-on-server-git-push'),
        onClick: () => askDeleteRemote(full),
      },
    ];
  };

  // Сброс текущей ветки к коммиту: три режима; Hard — с подтверждением (поэтому «…»)
  const resetSubmenu = (node: { hash: string; message: string }): MenuEntry[] => [
    { label: tr('soft-keep-all-changes-in'), icon: Archive, hint: 'soft', onClick: () => resetTo(node, 'soft') },
    { label: tr('mixed-keep-changes-in-working'), icon: FileDiff, hint: 'mixed', onClick: () => resetTo(node, 'mixed') },
    { label: tr('hard-discard-all-changes'), icon: Trash2, hint: 'hard', danger: true, onClick: () => resetTo(node, 'hard') },
  ];

  const renameBranch = async (to: string) => {
    const d = dialog;
    if (d?.type !== 'renameBranch') return;
    setDialog({ ...d, busy: true, error: null });
    const res = await run('renameBranch', { from: d.from, to }, {
      label: tr('rename-3'),
      success: (r) => tr('branch-renamed-to-undo-reverts', r.from, r.to),
      onError: (error) => {
        if (!['INVALID_NAME', 'BRANCH_EXISTS', 'BAD_ARGS'].includes(error.code)) return false;
        setDialog((cur) => (cur?.type === 'renameBranch' ? { ...cur, busy: false, error } : cur));
        return true;
      },
    });
    if (res.ok) setDialog(null);
  };

  // Удаление ветки на сервере: подтверждение → git push --delete (с индикатором в окне)
  const askDeleteRemote = (fullName: string) => {
    const slash = fullName.indexOf('/');
    if (slash <= 0) return;
    const remote = fullName.slice(0, slash);
    const branch = fullName.slice(slash + 1);
    const locals = repo!.localBranches.filter((b) => b.upstream === fullName).map((b) => b.name);
    setDialog({ type: 'deleteRemote', remote, branch, fullName, locals, busy: false, error: null });
  };
  const confirmDeleteRemote = async () => {
    const d = dialog;
    if (!d || d.type !== 'deleteRemote' || d.busy) return;
    setDialog({ ...d, busy: true, error: null });
    const res = await run('deleteRemoteBranch', { remote: d.remote, branch: d.branch }, {
      label: tr('delete-from-server-3'),
      progress: tr('deleting-from-server', d.fullName),
      success: tr('branch-deleted-from-undo-restores', d.branch, d.remote),
      onError: () => true,
    });
    if (res.ok) setDialog(null);
    else setDialog((cur) => (cur?.type === 'deleteRemote' ? { ...cur, busy: false, error: res.error } : cur));
  };

  const openRefMenu = (ref: CommitRef, x: number, y: number) => {
    const items = buildRefItems(ref);
    if (items.length) setMenu({ x, y, items });
  };
  // Update (Pull) ветки из списка: не текущая — fast-forward без переключения; текущая — тоже fast-forward,
  // а если в ней есть свои коммиты — обычный Pull в выбранном режиме
  const updateBranch = (name: string) => {
    const info = repoRef.current?.localBranches.find((b) => b.name === name);
    if (!info) return null;
    if (name === repoRef.current!.currentBranch && info.ahead! > 0) return pull();
    return run('updateBranch', { branch: name }, {
      label: tr('update', name),
      progress: tr('updating', name),
      success: (d) =>
        d.count ? tr('from-3', d.branch, d.count, plural(d.count, tr('commit'), tr('commits'), tr('commits-2')), d.upstream, d.current ? '' : tr('without-switching')) : tr('is-already-up-to-date', d.branch),
    });
  };

  const refActions = {
    update: updateBranch,
    push: () => push(false),
    log: (branch: string, direction: string) => api.repo.branchLog(repoRef.current!.path, { branch, direction }),
    checkout: (ref: CommitRef) => {
      if (ref.type === 'local') return ref.name !== repo!.currentBranch && checkout({ branch: ref.name });
      if (ref.type === 'remote') {
        const name = ref.name.slice(ref.name.indexOf('/') + 1);
        return checkout({ remoteBranch: { name, fullName: ref.name } });
      }
      return null;
    },
    deleteRemote: askDeleteRemote,
    menu: openRefMenu,
  };

  const buildCommitMenu = (node: GraphEntry) => {
    const cur = repo!.currentBranch;
    const curLabel = cur ?? 'HEAD';
    const isHead = node.hash === repo!.headHash;
    const op = Boolean(repo!.operation);
    // Шапка «abc1234 · сообщение» — клик копирует хэш
    const items: MenuEntry[] = [{ header: node.message, code: short(node.hash), onCopy: () => copy(node.hash, tr('commit-hash')), copyTip: tr('copy-commit-hash-sha') }];

    // Ветки на коммите: каждая — подменю «Ветка X ›», local + origin на одном коммите — одна группа
    const groups = refGroupsOf(node);
    const others = groups.filter((g) => !(g.local && g.local === cur));
    const branchOnly = others.filter((g) => !g.tag);
    // Быстрый переход на ветку этого коммита — если она одна (вместо detached HEAD)
    if (branchOnly.length === 1 && !(groups.some((g) => g.local === cur))) {
      const g = branchOnly[0];
      const target = g.local ?? g.remote!.slice(g.remote!.indexOf('/') + 1);
      items.push({
        label: tr('switch-to', target),
        icon: g.local ? LogIn : Cloud,
        // Только на сервере — создастся локальная ветка, а не detached HEAD
        hint: g.local ? 'Checkout' : tr('new-local'),
        disabled: op,
        onClick: () => (g.local ? checkout({ branch: g.local }) : refActions.checkout({ type: 'remote', name: g.remote! })),
      });
    }

    items.push(
      {
        label: tr('check-out-this-commit'),
        icon: GitCommitHorizontal,
        hint: 'detached',
        disabled: op || (isHead && repo!.detached),
        onClick: () =>
          run('checkoutCommit', { hash: node.hash }, {
            label: 'Checkout',
            success: tr('head-at-detached-undo-returns', short(node.hash)),
          }),
      },
      { label: tr('create-branch-here'), icon: GitBranch, onClick: () => openBranchDialog(node) },
      {
        label: tr('create-tag-here'),
        icon: Tag,
        onClick: () => setDialog({ type: 'tag', hash: node.hash, label: `${short(node.hash)} — ${node.message}` }),
      },
      { separator: true },
      {
        label: tr('cherry-pick-commit-into', curLabel),
        icon: Cherry,
        hint: 'Cherry-pick',
        disabled: op || isHead || !repo!.headHash,
        onClick: () =>
          run('cherryPick', { hash: node.hash }, { label: 'Cherry-pick', success: tr('commit-applied-to', short(node.hash), curLabel) }),
      },
      {
        label: tr('revert-commit-changes'),
        icon: RotateCcw,
        hint: 'Revert',
        disabled: op || !repo!.headHash,
        onClick: () =>
          run('revert', { hash: node.hash }, { label: 'Revert', success: tr('created-revert-commit-for', short(node.hash)) }),
      },
      {
        label: tr('restore-files-from-commit'),
        icon: FolderSync,
        hint: 'checkout files',
        disabled: op || isHead || !repo!.headHash,
        title: tr('new-commit-in-which-all'),
        onClick: () => openRevertTo(node),
      },
      {
        label: tr('reset-to-this-commit', curLabel),
        icon: History,
        hint: 'Reset',
        disabled: op || isHead || !repo!.headHash,
        submenu: resetSubmenu(node),
      },
      { separator: true },
      ...rebaseItems(node),
      { separator: true },
      ...compareItems(node),
    );

    if (others.length) {
      items.push({ separator: true });
      for (const g of others) {
        const sub = buildRefItems({ group: g }, { inCommit: true });
        if (!sub.length) continue;
        items.push({
          label: g.tag ? tr('tag-3', g.tag) : g.local ? tr('branch-4', g.local) : tr('branch-4', g.remote),
          icon: g.tag ? Tag : g.local ? GitBranch : Cloud,
          hint: g.tag ? null : g.synced ? `= ${g.remote!.slice(0, g.remote!.indexOf('/'))}` : g.local ? tr('local') : tr('on-server-2'),
          submenu: sub,
        });
      }
    }

    items.push(
      { separator: true },
      { label: tr('copy-commit-hash'), icon: Copy, hint: 'SHA', onClick: () => copy(node.hash, tr('commit-hash')) },
      {
        label: tr('copy-commit-message'),
        icon: FileText,
        onClick: () => copy(node.description ? `${node.message}\n\n${node.description}` : node.message, tr('commit-message')),
      },
    );
    return items;
  };

  /* ---------- Интерактивный rebase и сравнение ---------- */

  // Коммиты, достижимые из HEAD (среди загруженных) — чтобы понять, «история ветки» это или чужой коммит
  const headAncestors = useMemo(() => {
    const set = new Set<string>();
    if (!repo?.headHash) return set;
    const byHash = new Map(repo!.commits.map((c) => [c.hash, c]));
    const stack = [repo!.headHash];
    while (stack.length) {
      const h = stack.pop()!;
      if (set.has(h)) continue;
      set.add(h);
      for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
    }
    return set;
  }, [repo?.commits, repo?.headHash]);

  const openRebase = (upstream: string, onto?: string) => {
    if (!repo?.currentBranch) {
      notify({ type: 'error', title: tr('rebase-works-on-branch'), hint: tr('youre-on-detached-head-switch') });
      return;
    }
    setRebaseView({ upstream, onto, nonce: Date.now() });
  };

  const rebaseItems = (node: GraphEntry): MenuEntry[] => {
    const cur = repo!.currentBranch;
    const op = Boolean(repo!.operation);
    if (!cur || !repo!.headHash) return [];
    const isHead = node.hash === repo!.headHash;
    if (headAncestors.has(node.hash)) {
      if (isHead) return node.parents[0] ? [{ label: tr('amend-last-commit'), icon: Layers, hint: 'Rebase', disabled: op, onClick: () => openRebase(node.parents[0]) }] : [];
      return [
        {
          label: tr('edit-commits-of-branch', cur),
          icon: Layers,
          hint: 'Rebase -i',
          disabled: op,
          title: tr('reorder-reword-squash-or-drop'),
          submenu: [
            { label: tr('commits-after', short(node.hash)), icon: ArrowUpToLine, onClick: () => openRebase(node.hash) },
            ...(node.parents[0] ? [{ label: tr('starting-from-inclusive', short(node.hash)), icon: ArrowUpFromLine, onClick: () => openRebase(node.parents[0]) }] : []),
          ],
        },
      ];
    }
    return [{ label: tr('rebase-onto-this-commit', cur), icon: Layers, hint: 'Rebase', disabled: op, title: tr('with-preview-of-result-before'), onClick: () => openRebase(node.hash) }];
  };

  const commitTime = (h: string) => Date.parse(allCommits.find((c) => c.hash === h)?.date ?? '') || 0;
  // «Было» — более старый из двух
  const openCompare = (x: string | null | undefined, y: string | null | undefined) => {
    if (!x || !y || x === y) return;
    const [a, b] = commitTime(x) <= commitTime(y) ? [x, y] : [y, x];
    setCompareView({ a, b });
  };

  const compareItems = (node: GraphEntry) => {
    const items: MenuEntry[] = [];
    if (compareMark && compareMark !== node.hash) {
      items.push({ label: tr('compare-with-marked', short(compareMark)), icon: GitCompareArrows, onClick: () => openCompare(compareMark, node.hash) });
    }
    if (repo!.headHash && node.hash !== repo!.headHash) {
      items.push({ label: tr('compare-with-head'), icon: GitCompareArrows, onClick: () => openCompare(node.hash, repo!.headHash) });
    }
    items.push({
      label: compareMark === node.hash ? tr('unmark-for-comparison') : tr('mark-for-comparison'),
      icon: Flag,
      hint: kb(tr('ctrl-click')),
      onClick: () => {
        if (compareMark === node.hash) setCompareMark(null);
        else {
          setCompareMark(node.hash);
          notify({ type: 'info', title: tr('marked-for-comparison', short(node.hash)), hint: kb(tr('ctrl-click-or-right-click')) });
        }
      },
    });
    return items;
  };

  /* ---------- Pre-commit Guard: живая проверка staged-изменений ---------- */

  useEffect(() => {
    if (!repo || !guardCfg.live || !guardOnFor(guardCfg, repo!.path) || !api.repo.guardScan || !repo!.wipFiles.some((f) => f.staged)) {
      setGuardResult(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api.repo
        .guardScan!(repo!.path, { rules: activeRules(guardCfg), exclude: guardCfg.exclude })
        .then((res) => alive && setGuardResult(res.ok ? res.data : null))
        .catch(() => alive && setGuardResult(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [repo, guardCfg, fsTick]);

  // Строки staged-файла с находками — для подсветки в diff
  const guardMarkers = useMemo(() => {
    if (!guardResult?.findings?.length || diffTarget?.kind !== 'staged') return null;
    const m = new Map<number, GuardScan_Serialize['findings'][number]>();
    for (const f of guardResult.findings) if (f.file === diffTarget.file.path) m.set(f.line, f);
    return m.size ? m : null;
  }, [guardResult, diffTarget]);

  const openStagedFile = (path: string) => {
    const staged = repoRef.current?.wipFiles.filter((f) => f.staged) ?? [];
    const file = staged.find((f) => f.path === path);
    if (!file) return;
    setSelectedHash(allCommits.find((c) => c.wip)?.hash ?? selectedHash);
    setTimeout(() => openFile(file, 'staged', staged), 0);
  };

  /* ---------- Конструктор действий: выполнение цепочек ---------- */

  const confirmAsync = (title: string, text: string) =>
    new Promise<boolean>((resolve) =>
      setDialog({ type: 'actionConfirm', title, body: text, onYes: () => resolve(true), onNo: () => setTimeout(() => resolve(false), 0) }),
    );

  // Один шаг: { ok, error?, skipped?, note? }
  const runStep = async (type: string, p: StepValues, path: string): Promise<StepResult> => {
    const act = <N extends RepoActionName>(name: N, payload: ActionPayload<N>) => api.repo.action(path, name, payload);
    const cur = repoRef.current!;
    const skip = (note: string) => ({ ok: true, skipped: true, note });
    const fail = (message: string, hint?: string) => ({ ok: false, error: { message, hint } });
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
        if (p.branch === cur.currentBranch) return skip(tr('already-on-this-branch'));
        if (cur.localBranches.some((b) => b.name === p.branch)) return act('checkout', { branch: p.branch, strategy: workflow.checkoutWip === 'merge' ? 'merge' : 'stash' });
        for (const r of cur.remotes) {
          const rb = r.branches.find((b) => b.fullName === p.branch || b.name === p.branch);
          if (rb) return act('checkout', { remoteBranch: { name: rb.name, fullName: rb.fullName }, strategy: workflow.checkoutWip === 'merge' ? 'merge' : 'stash' });
        }
        return fail(tr('branch-not-found-2', p.branch), tr('check-name-or-fetch'));
      }
      case 'rebase': {
        const r = await act('rebase', { ref: p.onto });
        return !r.ok && r.error.code === 'UP_TO_DATE' ? skip(tr('already-contains-all-commits')) : r;
      }
      case 'merge': {
        const r = await act('merge', { ref: p.ref });
        return !r.ok && r.error.code === 'UP_TO_DATE' ? skip(tr('already-merged')) : r;
      }
      case 'deleteBranch':
        return act('deleteBranch', { name: p.name, force: Boolean(p.force) });
      case 'stash': {
        const r = await act('stash', { message: p.message });
        return !r.ok && r.error.code === 'NOTHING_TO_STASH' ? skip(tr('nothing-to-stash')) : r;
      }
      case 'stashPop': {
        const r = await act('stashPop', {});
        return !r.ok && r.error.code === 'NO_STASH' ? skip(tr('stash-is-empty')) : r;
      }
      case 'commit': {
        if (!p.message?.trim()) return fail(tr('empty-commit-message'));
        if (p.stageAll) {
          if (!cur.wipFiles.length) return fail(tr('no-changes-to-commit'));
          const st = await act('stage', { paths: 'all' });
          if (!st.ok) return st;
        }
        if (!(await guardCheck(path))) return { ok: false, error: { message: tr('commit-cancelled-after-check'), code: 'STOPPED' } };
        const r = await act('commit', { summary: p.message.trim(), description: '' });
        return r.ok ? { ...r, note: r.data?.hash?.slice(0, 7) } : r;
      }
      case 'mergeRequest': {
        const source = cur.currentBranch;
        if (!source) return fail(tr('active-branch-is-required'));
        const f = cur.forge;
        if (f?.kind === 'gitlab') {
          if (!f.token?.configured) return fail(tr('gitlab-is-not-connected'), tr('settings-connections-add-token-with'));
          const r = await api.gitlab.createMergeRequest(path, { source, target: p.target, title: p.title || source, draft: Boolean(p.draft) }, { remote: f.remote });
          if (!r.ok) return r;
          if (p.open !== false && r.data.webUrl) api.openExternal(r.data.webUrl);
          return { ok: true, note: `${r.data.created ? tr('created') : tr('already-existed')} !${r.data.iid}` };
        }
        if (f?.webUrl && /github/i.test(f.host ?? f.webUrl)) {
          api.openExternal(`${f.webUrl}/compare/${encodeURIComponent(p.target!)}...${encodeURIComponent(source)}?expand=1`);
          return { ok: true, note: tr('pull-request-page-opened') };
        }
        return fail(tr('couldnt-determine-server-for-merge'), tr('gitlab-via-token-and-github'));
      }
      case 'confirm':
        return (await confirmAsync(tr('continue'), p.text || tr('continue'))) ? { ok: true } : { ok: false, error: { message: tr('stopped-by-you'), code: 'STOPPED' } };
      case 'git': {
        const r = await act('gitRaw', { command: p.command });
        return r.ok ? { ...r, note: r.data.output.split('\n')[0] || null } : r;
      }
      default:
        return fail(tr('unknown-step', type));
    }
  };

  const executeAction = async (action: CustomAction, inputs: Record<string, string | undefined>, fromIndex = 0, previous: RunState | null = null) => {
    const path = repoRef.current?.path;
    if (!path) return;
    const ctx = previous?.ctx ?? { inputs, start: repoRef.current!.currentBranch, defaultBranch: defaultBranchOf(repoRef.current) };
    const describe = (step: CustomAction['steps'][number]) => STEP_TYPES[step.type as StepTypeId]?.describe(expandParams(step.params, { ...ctx, branch: repoRef.current?.currentBranch })) ?? step.type;
    let state: RunState = {
      action,
      ctx,
      error: null,
      finished: false,
      steps: action.steps.map((step, i) =>
        previous && i < fromIndex ? previous.steps[i] : { id: step.id, type: step.type, label: describe(step), status: 'pending', note: null },
      ),
    };
    const publish = (patch: Partial<RunState>) => {
      state = { ...state, ...patch };
      setActionRun(state);
    };
    const setStep = (i: number, patch: Partial<RunState['steps'][number]>) => publish({ steps: state.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    publish({});
    busyRef.current = true;
    setBusyAction('chain');
    try {
      for (let i = fromIndex; i < action.steps.length; i++) {
        const step = action.steps[i];
        const params = expandParams(step.params, { ...ctx, branch: repoRef.current?.currentBranch });
        setStep(i, { status: 'running', label: STEP_TYPES[step.type as StepTypeId]?.describe(params) ?? step.type });
        let res: StepResult;
        try {
          res = await runStep(step.type, params as StepValues, path);
        } catch (error) {
          res = { ok: false, error: { message: (error as Error).message } };
        }
        await loadRepo(path, { silent: true });
        if (!res.ok) {
          if (res.error?.code === 'CONFLICT') autoOpenConflict.current = true;
          setStep(i, { status: 'failed' });
          publish({ error: res.error as ActionRun['error'], finished: true });
          return;
        }
        setStep(i, { status: res.skipped ? 'skipped' : 'done', note: res.note ?? null });
      }
      publish({ finished: true, summary: tr('each-step-can-be-undone') });
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  };

  const startAction = (action: CustomAction) => {
    if (!repoRef.current) return;
    const problems = validateAction(action);
    if (problems.length) {
      notify({ type: 'error', title: `«${action.name}»: ${problems[0]}`, hint: tr('open-action-builder-and-fix') });
      return;
    }
    if (busyRef.current) {
      notify({ type: 'info', title: tr('wait-for-current-operation-to') });
      return;
    }
    const inputs = inputsOf(action);
    if (inputs.length || action.confirm) setRunPrompt({ action, inputs });
    else executeAction(action, {});
  };

  // Горячие клавиши действий (не в полях ввода и не поверх диалогов)
  const actionKeys = useRef<{ userActions: CustomAction[]; startAction: (action: CustomAction) => void } | null>(null);
  actionKeys.current = { userActions, startAction };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.fixed.inset-0')) return;
      const combo = hotkeyFromEvent(e);
      if (!combo) return;
      const a = actionKeys.current!.userActions.find((x) => x.hotkey === combo);
      if (!a) return;
      e.preventDefault();
      actionKeys.current!.startAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- Перетаскивание коммитов и веток на ветки ---------- */

  // Достижим ли коммит anc из desc по родителям (среди загруженных коммитов)
  const isAncestorLoaded = (anc: string, desc: string) => {
    if (!repo || anc === desc) return anc === desc;
    const byHash = new Map(repo!.commits.map((c) => [c.hash, c]));
    const seen = new Set<string>();
    const stack = [desc];
    while (stack.length) {
      const h = stack.pop()!;
      if (h === anc) return true;
      if (seen.has(h)) continue;
      seen.add(h);
      for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
    }
    return false;
  };

  const dropOnBranch = (targets: { name: string; hash: string }[], x: number, y: number, src: DragSource | null) => {
    if (!repo || !src) return;
    const op = Boolean(repo!.operation) || Boolean(busyAction);
    const cur = repo!.currentBranch;
    const ref = src.kind === 'commit' ? src.hash : src.name;
    const srcLabel = src.kind === 'commit' ? short(src.hash) : src.name;
    const items: MenuEntry[] = [];
    for (const t of targets) {
      if (src.kind === 'branch' && src.name === t.name) continue;
      const isCur = t.name === cur;
      items.push({ header: `${srcLabel} → ${t.name}` });
      const contained = isAncestorLoaded(src.hash, t.hash);
      if (contained) {
        items.push({ label: tr('already-in-nothing-to-merge', t.name), icon: Check, disabled: true });
        continue;
      }
      if (isAncestorLoaded(t.hash, src.hash)) {
        items.push({
          label: tr('fast-forward', t.name),
          icon: FastForward,
          disabled: op,
          title: tr('branch-simply-moves-forward-no'),
          onClick: () => run('fastForward', { branch: t.name, to: ref }, { label: 'Fast-forward', success: (d) => tr('fast-forwarded-to-undo-reverts', d.branch, short(d.to)) }),
        });
      }
      items.push({
        label: tr('merge-into-2', t.name),
        icon: GitMerge,
        hint: isCur ? undefined : tr('switches-branch'),
        disabled: op,
        onClick: () =>
          run('mergeInto', { ref, target: t.name, smart: true }, { label: 'Merge', success: tr('merged-into-undo-reverts-it', srcLabel, t.name) }),
      });
      if (src.kind === 'commit') {
        items.push({
          label: tr('cherry-pick-commit-into-2', t.name),
          icon: Cherry,
          hint: isCur ? tr('one-commit') : tr('switches-branch'),
          disabled: op,
          onClick: () =>
            run('cherryPickInto', { hash: src.hash, target: t.name, smart: true }, {
              label: 'Cherry-pick',
              success: tr('commit-applied-to', srcLabel, t.name),
            }),
        });
      }
      items.push({
        label: tr('rebase-onto-3', t.name, srcLabel),
        icon: Layers,
        hint: isCur ? tr('with-preview') : tr('switches-branch'),
        disabled: op,
        onClick: async () => {
          if (!isCur) {
            const res = await checkout({ branch: t.name });
            if (!res.ok) return;
          }
          setRebaseView({ upstream: ref!, nonce: Date.now() });
        },
      });
    }
    if (!items.length) {
      notify({ type: 'info', title: tr('cant-merge-branch-into-itself') });
      return;
    }
    setMenu({ x, y, items });
  };

  const buildActionsMenu = (): AppMenuItem[] => [
    ...(userActions.length ? [{ header: tr('my-actions') }] : []),
    ...userActions.map((a) => ({
      label: a.name || tr('untitled'),
      icon: ACTION_ICONS[a.icon as string] ?? WandSparkles,
      hint: a.hotkey ?? undefined,
      disabled: !repo || Boolean(busyAction),
      onClick: () => startAction(a),
    })),
    ...(userActions.length ? [{ separator: true }] : []),
    { label: tr('action-builder'), icon: WandSparkles, onClick: () => setDialog({ type: 'actions' }) },
  ];

  const buildWipMenu = (): MenuEntry[] => {
    const op = Boolean(repo!.operation);
    return [
      { header: tr('changes', repo!.wipFiles.length) },
      { label: tr('stash-all-changes'), icon: Archive, disabled: op || !repo!.headHash, onClick: stash },
      { label: tr('stage-all-changes'), icon: GitCommitHorizontal, onClick: () => stageFiles('all') },
      { separator: true },
      {
        label: tr('discard-all-changes'),
        icon: Eraser,
        danger: true,
        disabled: op,
        onClick: () =>
          confirm({
            title: tr('discard-all-changes-2'),
            body: tr('all-uncommitted-changes-including-new'),
            confirmLabel: tr('discard-changes-2'),
            danger: true,
            onConfirm: () => run('discardAll', {}, { label: 'Discard', success: (d) => tr('discarded-changes-in-files', d.files) }),
          }),
      },
    ];
  };

  // Главное меню: в своём заголовке (Windows/Linux) и в системной строке меню (macOS)
  const appMenus = (): Record<string, AppMenuItem[]> => ({
    File: fileMenuItems(),
    Edit: [
      {
        id: 'undo',
        label: repo?.history?.undo ? tr('undo', repo!.history.undo) : tr('undo-2'),
        icon: Undo2,
        hint: 'Ctrl+Z',
        disabled: !repo?.history?.undo || Boolean(busyAction),
        onClick: undo,
      },
      {
        id: 'redo',
        label: repo?.history?.redo ? tr('redo', repo!.history.redo) : tr('redo-2'),
        icon: Redo2,
        hint: IS_MAC ? 'Ctrl+Shift+Z' : 'Ctrl+Y',
        disabled: !repo?.history?.redo || Boolean(busyAction),
        onClick: redo,
      },
      { separator: true },
      { id: 'find', label: tr('find-commit'), icon: Search, hint: 'Ctrl+F', disabled: !repo, onClick: () => setSearchOpen(true) },
      {
        id: 'switch-branch',
        label: tr('switch-branch'),
        icon: GitBranch,
        hint: 'Ctrl+B',
        disabled: !repo,
        onClick: () => window.dispatchEvent(new Event('gitidea:branch-picker')),
      },
      { id: 'new-branch', label: tr('new-branch'), icon: GitBranch, disabled: !repo?.headHash, onClick: () => openBranchDialog() },
      { separator: true },
      { id: 'stash', label: tr('stash-changes'), icon: Archive, disabled: !repo?.wipFiles.length || Boolean(busyAction), onClick: stash },
      { id: 'pop', label: tr('pop-last-stash'), icon: ArchiveRestore, disabled: !repo?.stashes.length || Boolean(busyAction), onClick: stashPop },
    ],
    View: [
      { id: 'settings', label: tr('appearance'), icon: Palette, hint: 'Ctrl+,', onClick: () => openSettings('appearance') },
      { id: 'sync-settings', label: tr('sync'), icon: RefreshCw, onClick: () => openSettings('sync') },
      { id: 'integrations', label: tr('connections-git-servers-and-gitlab'), icon: Plug, onClick: () => openSettings('integrations') },
      ...(api?.creds ? [{ id: 'repo-login', label: tr('repository-sign-in'), icon: LogIn, disabled: !repo, onClick: () => openAuth({ actionLabel: tr('save-and-check') }) }] : []),
    ],
    Actions: buildActionsMenu(),
    Help: [
      { id: 'guide', label: tr('guide'), icon: BookOpen, hint: 'F1', onClick: () => setDialog({ type: 'guide' }) },
      { id: 'keys', label: tr('keyboard-shortcuts'), icon: Keyboard, onClick: () => setDialog({ type: 'guide', section: 'keys' }) },
      { id: 'about', label: tr('about-2'), icon: Info, onClick: () => setDialog({ type: 'about' }) },
    ],
  });
  const appMenusRef = useRef(appMenus);
  appMenusRef.current = appMenus;

  // macOS: системное меню. Отправляем только подписи/состояние, и только когда что-то поменялось
  const sentMenu = useRef('');
  useEffect(() => {
    if (!IS_MAC || !api?.menu) return;
    const plain = (items: AppMenuItem[]) =>
      items.map((it) =>
        it.separator ? { separator: true } : it.header ? { header: it.header } : { id: it.id ?? null, label: it.label, hint: it.hint ?? null, disabled: Boolean(it.disabled) },
      );
    const model = Object.fromEntries(Object.entries(appMenus()).map(([k, v]) => [k, plain(v)]));
    const json = JSON.stringify(model);
    if (json === sentMenu.current) return;
    sentMenu.current = json;
    api.menu.set(model);
  });
  useEffect(() => {
    if (!api?.menu?.onInvoke) return undefined;
    return api.menu.onInvoke(({ menu, index, id }) => {
      const menus = appMenusRef.current();
      const item = id ? Object.values(menus).flat().find((x) => x.id === id) : menus[menu!]?.[index!];
      if (item && !item.disabled) item.onClick?.();
    });
  }, []);

  const openMenu = (node: GraphEntry, x: number, y: number) => setMenu({ x, y, items: node.wip ? buildWipMenu() : node.stash ? buildStashMenu(node.stash) : buildCommitMenu(node) });
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDiff = useCallback(() => setDiffTarget(null), []);

  /* ---------- Конфликты ---------- */

  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const autoOpenConflict = useRef(false);
  const resolvingConflict = useRef(false); // пока сохраняем файл — не закрываем редактор между файлами
  // Когда что-то меняется в репозитории — просмотр CI/CD тихо перечитывает файлы
  const ciVersion = repo ? `${repo!.headHash}|${JSON.stringify(repo!.wipFiles)}|${JSON.stringify(repo!.ci ?? null)}` : '';

  const conflictPaths = useMemo(
    () => (repo ? [...new Set(repo!.wipFiles.filter((f) => f.status === 'U').map((f) => f.path))] : []),
    [repo],
  );

  const openConflict = (path: string) => {
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
        title: tr('conflicts', conflictPaths.length, plural(conflictPaths.length, tr('file'), tr('files-2'), tr('files'))),
        hint: tr('pick-version-you-need-for'),
      });
    }
    // Файл больше не в конфликте (решили снаружи) — закрываем редактор
    if (conflictPath && !conflictPaths.includes(conflictPath) && !resolvingConflict.current) setConflictPath(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictPaths]);

  const runConflictAction = async (...args: Parameters<RunAction>) => {
    resolvingConflict.current = true;
    const res = await run(...(args as [RepoActionName, never, RunOptions<RepoActionName>?]));
    if (!res.ok) resolvingConflict.current = false;
    return res;
  };

  const onConflictResolved = async (path: string) => {
    const res = await api.repo.status!(repoRef.current!.path);
    resolvingConflict.current = false;
    const rest = res.ok ? [...new Set(res.data.wipFiles.filter((f) => f.status === 'U').map((f) => f.path))] : [];
    if (rest.length) {
      // Следующий файл по порядку после текущего
      const idx = conflictPaths.indexOf(path);
      const next = conflictPaths.slice(idx + 1).find((p) => rest.includes(p)) ?? rest[0];
      notify({ type: 'success', title: tr('resolved', path.split('/').pop()), hint: tr('files-left', rest.length) });
      setConflictPath(next);
      return;
    }
    setConflictPath(null);
    const op = repoRef.current?.operation;
    notify({
      type: 'success',
      title: tr('all-conflicts-resolved'),
      hint: op
        ? tr('click-continue-in-yellow-bar', OPERATION_LABELS[op] ?? op)
        : tr('changes-are-ready-you-can'),
    });
  };

  /* ---------- Коммиты и выбор ---------- */

  /* ---------- Оформление ---------- */

  useEffect(() => {
    if (!api?.appearance) return;
    api.appearance.get().then(async (res) => {
      setAppearanceMeta({ supportsMaterial: res.supportsMaterial, hasImage: res.hasImage });
      if (res.appearance) setAppearance(normalizeAppearance(res.appearance));
      if (res.hasImage) setBgImage(await api.appearance!.image());
    });
  }, []);

  // «Как в системе»: следим за светлой/тёмной темой Windows/macOS и перерисовываемся при её смене
  const [systemSchemeTick, setSystemSchemeTick] = useState(0);
  // Цвета графа и бейджей для этого же рендера (scheme.js) — до того, как отрисуются дочерние компоненты
  syncScheme(appearance);
  useEffect(() => {
    if (appearance.theme !== AUTO_THEME.id || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemSchemeTick((n) => n + 1);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appearance.theme]);

  useEffect(() => {
    applyAppearance(appearance, { imageUrl: bgImage, systemSupported: appearanceMeta.supportsMaterial });
    cacheAppearance(appearance);
  }, [appearance, bgImage, appearanceMeta.supportsMaterial, systemSchemeTick]);

  const persistAppearance = (next: Appearance) => {
    clearTimeout(saveAppearanceTimer.current!);
    saveAppearanceTimer.current = setTimeout(() => {
      api?.appearance?.set(nativeAppearance(next));
    }, 250);
  };

  const updateAppearance = (patch: Partial<Appearance>) =>
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
    const res = await api.appearance!.pickImage();
    if (res?.ok) {
      setBgImage(await api.appearance!.image());
      setAppearanceMeta((m) => ({ ...m, hasImage: true }));
    }
    return res;
  };

  const openSettings = (tab: string = 'appearance') => setDialog({ type: 'settings', tab });

  /* ---------- CI/CD: статусы пайплайнов для графа (GitLab, GitHub, Gitea, Bitbucket) ---------- */

  const forge = repo?.forge ?? null;
  const ciReady = Boolean(forge?.provider && forge.token?.configured && forge.capabilities?.canListPipelines !== false);
  const currentBranchInfo = repo?.localBranches.find((b) => b.name === repo!.currentBranch) ?? null;
  // Ветки для форм CI/CD (расписания GitLab): сначала ветки на сервере, затем локальные
  const ciBranches = useMemo(() => {
    if (!repo) return [];
    const remote = repo!.remotes?.find((r) => r.name === (currentBranchInfo?.upstreamRemote ?? 'origin')) ?? repo!.remotes?.[0];
    return [...new Set([...(remote?.branches ?? []).map((b) => b.name), ...repo.localBranches.map((b) => b.name)])];
  }, [repo, currentBranchInfo?.upstreamRemote]);
  const pipelineKey = ciReady
    ? `${repo!.path}|${forge!.provider}|${forge!.apiBase}|${forge!.token!.savedAt ?? forge!.token!.user?.username ?? ''}|${repo!.headHash}|${currentBranchInfo?.ahead}|${currentBranchInfo?.upstream}`
    : null;
  const pipelineMap = useCiStore((s) => s.pipelineMap);
  const pipelineTips = useCiStore((s) => s.pipelineTips);

  // Опрос пайплайнов (`ciStore.startPipelines`): ключ меняется с репозиторием, провайдером, входом, HEAD и веткой на сервере
  useEffect(
    () => ciStore.getState().startPipelines(pipelineKey, currentBranchInfo?.upstreamRemote, announceFinished),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipelineKey],
  );

  const onForgeChanged = ciStore.getState().setForge;

  // Токен входа репозитория проверяется в фоне — пока идёт проверка, перечитываем состояние
  const forgePending = Boolean(forge?.token?.pending);
  useEffect(() => (forgePending ? ciStore.getState().pollForge() : undefined), [forgePending]);

  // focusFailed — открыть сразу лог упавшего задания (клик по красному значку в графе)
  const openPipelines = (pipelineId: string | number | null = null, focusFailed = false) => {
    setDiffTarget(null);
    setCiView({ file: null, mode: 'pipelines', pipelineId, focusFailed, n: Date.now() });
  };

  /** Пайплайн, который шёл и закончился успехом или ошибкой, — уведомление ОС и в приложении */
  function announceFinished(path: string, list: PipelineRun_Serialize[], label: string) {
    for (const p of ciStore.getState().finishedPipelines(path, list)) {
      const ok = p.status === 'success';
      const title = tr('pipeline-2', ok ? '✓' : p.status === 'failed' ? '✕' : '⊘', p.number ?? p.id, ok ? tr('passed') : p.status === 'failed' ? tr('failed') : tr('canceled'));
      const body = [p.branch, p.name].filter(Boolean).join(' · ');
      notify({ type: ok ? 'success' : p.status === 'failed' ? 'error' : 'info', title, hint: `${body}${label ? ` · ${label}` : ''}`, action: { label: tr('open'), onClick: () => openPipelines(p.id, p.status === 'failed') } });
      try {
        const show = () => {
          const n = new window.Notification(title, { body: body || label || '', silent: ok, tag: `pipeline-${p.id}` });
          n.onclick = () => {
            window.focus();
            openPipelines(p.id, p.status === 'failed');
          };
        };
        if (window.Notification?.permission === 'granted') show();
        else if (window.Notification && window.Notification.permission !== 'denied') window.Notification.requestPermission().then((perm) => perm === 'granted' && show());
      } catch {
        /* уведомления ОС недоступны */
      }
    }
  }

  const branchPipeline = useMemo(
    () => pipelineMap?.pipelines.find((p) => p.branch === repo?.currentBranch) ?? null,
    [pipelineMap, repo?.currentBranch],
  );

  // Подсказка значка пайплайна в графе: сводка по заданиям (загружается при наведении, `ciStore.loadPipelineTip`)
  const loadPipelineTip = ciStore.getState().loadPipelineTip;

  // Граф: WIP сверху, stash — строками над коммитами, на которых их сделали (как в GitKraken)
  // Зависит только от коммитов, stash, HEAD и наличия изменений: правка файла (новый repo из `applyStatus`) граф не
  // пересчитывает — число файлов в строке WIP приходит отдельно (`wipCount`)
  const hasWip = (repo?.wipFiles.length ?? 0) > 0;
  const allCommits = useMemo((): GraphEntry[] => {
    if (!repo) return [];
    const commits = withStashes(repo!.commits, repo!.stashes, (st) => describeStash(st).title);
    if (!hasWip) return commits as GraphEntry[];
    const wip = {
      hash: 'WIP',
      wip: true,
      parents: repo!.headHash ? [repo!.headHash] : [],
      message: '// WIP',
      refs: [],
    };
    return [wip, ...commits] as GraphEntry[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.commits, repo?.stashes, repo?.headHash, hasWip]);

  const commitsBySha = useMemo(() => new Map((repo?.commits ?? []).map((c) => [c.hash, c])), [repo?.commits]);

  // Главные ветки графа: свои закреплённые дорожки слева, выбор — для каждого репозитория (`mainBranches.ts`)
  const mainBranches = useMainBranches(repo?.path, repo);
  const branchNames = useMemo(
    () => [...new Set([...(repo?.localBranches ?? []).map((b) => b.name), ...(repo?.remotes ?? []).flatMap((r) => r.branches.map((b) => b.name)).filter((n) => n !== 'HEAD')])],
    [repo?.localBranches, repo?.remotes],
  );

  const selectedStash =
    repo && selectedHash?.startsWith('stash:') ? repo!.stashes.find((st) => `stash:${st.hash}` === selectedHash) ?? null : null;
  const selected: SelectedEntry | null = selectedStash
    ? { ...selectedStash, isStash: true, key: selectedHash! }
    : (allCommits.find((c) => c.hash === selectedHash && !c.stash) as SelectedEntry | undefined) ?? null;
  const selectedKey = selected ? selected.key ?? selected.hash : null;

  // Файлы выбранного коммита или stash подгружаем лениво — через 100 мс после выбора: зажатая стрелка в графе не шлёт
  // запрос на каждую строку, файлы приходят, когда выбор остановился
  useEffect(() => {
    if (!repo || !selected || selected.wip || filesByHash[selectedKey!]) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      const request = selected.isStash
        ? api.repo.stashDetails(repo!.path, selected.hash)
        : api.repo.commitFiles(repo!.path, selected.hash, selected.parents[0]);
      request.then((res) => {
        if (cancelled) return;
        setFilesByHash((m) => ({ ...m, [selectedKey!]: res.ok ? res.data : { error: res.error.message } }));
      });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repo, selectedKey, filesByHash]); // eslint-disable-line react-hooks/exhaustive-deps


  /* ---------- Просмотр изменений файла ---------- */

  // kind: 'commit' | 'staged' | 'unstaged'; list — файлы этой группы для навигации ←/→
  const openFile = (file: AnyFile, kind: FileKind, list: AnyFile[]) => {
    const index = Math.max(0, list.findIndex((f) => f.path === file.path && Boolean(f.untracked) === Boolean(file.untracked)));
    if (kind === 'stash') {
      setDiffTarget({ kind, mode: 'commit', hash: file.diffHash!, parent: file.diffParent, commitHash: selectedHash!, stashId: selected?.id, file, list, index });
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
  // search — открыть файл сразу с поиском (из поиска по содержимому в сравнении) и на нужной строке
  const openCompareFile = (file: AnyFile, list: AnyFile[], a: string | null | undefined, b: string | null | undefined, search: CompareSearchJump | null = null) => {
    const index = Math.max(0, list.findIndex((f) => f.path === file.path));
    setDiffTarget({ kind: 'compare', mode: 'commit', hash: b!, parent: a, commitHash: selectedHash!, file, list, index, search: search ? { ...search, nonce: Date.now() } : null });
  };

  const stepFile = (delta: number) => {
    if (!diffTarget) return null;
    const next = diffTarget.index + delta;
    if (next < 0 || next >= diffTarget.list.length) return null;
    if (diffTarget.kind === 'compare') return () => openCompareFile(diffTarget.list[next], diffTarget.list, diffTarget.parent, diffTarget.hash);
    return () => openFile(diffTarget.list[next], diffTarget.kind as FileKind, diffTarget.list);
  };

  /* ---------- Откат файла / фрагмента без коммита ---------- */

  const isDirty = (path: string) => repo!.wipFiles.some((f) => f.path === path);

  // sourcePath — имя файла в той версии (из истории файла: до переименования он назывался иначе)
  const restoreFile = (file: { path: string }, hash: string, side: 'before' | 'after', sourcePath: string | null = null) => {
    const go = () =>
      run('restoreFile', { hash, path: file.path, side, ...(sourcePath && sourcePath !== file.path ? { sourcePath } : {}) }, {
        label: tr('restore-file'),
        success: (d) =>
          tr('no-commit', d.path, d.deleted ? tr('deleted-it-didnt-exist-in') : tr('version', side === 'before' ? tr('before') : tr('from'), hash.slice(0, 7)), d.undoable ? tr('undo-reverts-it') : ''),
      });
    if (!isDirty(file.path)) return go();
    confirm({
      title: tr('file-has-uncommitted-changes'),
      body: tr('file-is-already-changed-in', file.path, side === 'before' ? tr('before') : tr('from'), hash.slice(0, 7)),
      confirmLabel: tr('replace'),
      onConfirm: go,
    });
  };

  const HUNK_TEXT: Record<string, { label: string; ok: ((d: ActionOutput<'applyHunks'>) => string) | null }> = {
    revert: { label: tr('revert-hunk'), ok: (d) => tr('in-no-commit-undo-reverts', d.hunks === d.total ? tr('commit-changes-reverted') : tr('hunk-reverted'), d.path) },
    discard: { label: tr('revert-hunk'), ok: (d) => tr('in-discarded-undo-brings-it', d.hunks === d.total ? tr('changes-2') : tr('hunk'), d.path) },
    stage: { label: tr('stage-hunk'), ok: null },
    unstage: { label: tr('unstage-hunk'), ok: null },
    apply: { label: tr('hunk-from-stash'), ok: (d) => tr('from-stash-applied-to-undo', d.hunks === d.total ? tr('changes-2') : tr('hunk'), d.path) },
  };
  const applyHunks = (op: string, mode: string, file: AnyFile, hash: string | null | undefined, hunks: string[] | null) =>
    run('applyHunks', { op, mode, hash, path: file.path, oldPath: file.oldPath, hunks }, { label: HUNK_TEXT[op].label, success: HUNK_TEXT[op].ok });

  const hunkActionsFor = (t: AppDiffTarget | null): HunkAction[] | null => {
    if (!t || t.file.status === 'U' || t.file.untracked) return null;
    if (t.kind === 'commit')
      return [{ id: 'revert', label: tr('revert-in-working-folder'), icon: Undo2, title: tr('remove-this-hunks-changes-from') }];
    if (t.kind === 'unstaged')
      return [
        { id: 'stage', label: tr('stage-2'), icon: Plus, title: tr('add-only-this-hunk-to') },
        { id: 'discard', label: tr('undo-2'), icon: Undo2, danger: true, title: tr('discard-this-hunk-of-changes') },
      ];
    if (t.kind === 'staged') return [{ id: 'unstage', label: tr('unstage'), icon: Minus, title: tr('remove-this-hunk-from-commit') }];
    if (t.kind === 'stash' && t.file.status !== 'D')
      return [{ id: 'apply', label: tr('apply'), icon: ArchiveRestore, title: tr('move-only-this-hunk-from') }];
    return null;
  };
  const onHunkAction = (id: string, hunk: { header: string }) => {
    const t = diffTarget;
    if (!t) return null;
    return applyHunks(id, t.mode === 'untracked' ? 'unstaged' : t.mode, t.file, t.hash, [hunk.header]);
  };

  /* ---------- История файла и Blame ---------- */

  // Откуда строить историю и blame для файла из коммита, stash, WIP или сравнения.
  // → { history: view | null, blame: view | null, reason } (reason — почему недоступно)
  const fileViewsFor = (file: AnyFile, kind: FileKind, ctx: { hash?: string | null; parent?: string | null } = {}): FileViews => {
    if (!file || file.status === 'U') return { history: null, blame: null, reason: tr('resolve-conflict-first') };
    if (kind === 'unstaged' || kind === 'staged') {
      if (file.untracked || file.status === 'A') return { history: null, blame: null, reason: tr('file-isnt-committed-yet-it') };
      // Переименованный или удалённый в рабочей папке — история и blame под прежним именем из HEAD
      const old = file.status === 'R' || file.status === 'D' ? file.oldPath ?? file.path : null;
      const path = old ?? file.path;
      return { history: { path, rev: null }, blame: { path, rev: null, blameRev: old ? 'HEAD' : null } };
    }
    const hash = kind === 'stash' ? file.diffHash : ctx.hash;
    const parent = kind === 'stash' ? file.diffParent : ctx.parent;
    if (!hash) return { history: null, blame: null, reason: tr('no-commit-2') };
    if (file.status === 'D') {
      const old = file.oldPath ?? file.path;
      return { history: { path: old, rev: hash, focus: hash }, blame: parent ? { path: old, rev: hash, blameRev: parent } : null, reason: tr('file-was-deleted-in-this') };
    }
    return { history: { path: file.path, rev: hash, focus: hash }, blame: { path: file.path, rev: hash, blameRev: hash } };
  };
  const openFileView = (base: FileViewBase | null, mode: FileViewState['mode']) => {
    if (!base) return;
    setMenu(null);
    setFileView({ ...base, mode, blameRev: base.blameRev === undefined ? 'HEAD' : base.blameRev, blamePath: null, blameStack: [] });
  };
  const fileViewItems = (file: AnyFile, kind: FileKind, ctx?: { hash?: string | null; parent?: string | null }): MenuItem[] => {
    const v = fileViewsFor(file, kind, ctx);
    return [
      {
        label: tr('file-history-log'),
        icon: FileClock,
        disabled: !v.history,
        title: v.history ? tr('all-commits-that-changed-this') : v.reason,
        onClick: () => openFileView(v.history, 'history'),
      },
      {
        label: 'Blame',
        icon: FileUser,
        disabled: !v.blame,
        title: v.blame ? tr('who-last-changed-each-line') : v.reason,
        onClick: () => openFileView(v.blame, 'blame'),
      },
    ];
  };

  const buildFileMenu = (file: AnyFile, kind: FileKind, list: AnyFile[], extra?: FileMenuExtra): MenuEntry[] | null => {
    const items: MenuEntry[] = [{ header: file.path }];
    if (kind === 'stash') {
      const st = (extra?.stash ?? selected) as StashLike;
      items.push(
        { label: tr('show-changes'), icon: FileDiff, onClick: () => openFile(file, 'stash', list) },
        ...fileViewItems(file, 'stash'),
        { separator: true },
        {
          label: tr('restore-file-from-stash'),
          icon: ArchiveRestore,
          title: tr('file-in-working-folder-will'),
          onClick: () => (extra?.restore ? extra.restore() : restoreFromStash([file], st)),
        },
      );
    } else if (kind === 'commit') {
      const c = selected as GraphEntry | null;
      if (!c || c.wip) return null;
      items.push(
        { label: tr('show-changes'), icon: FileDiff, onClick: () => openFile(file, 'commit', list) },
        ...fileViewItems(file, 'commit', { hash: c.hash, parent: c.parents[0] ?? null }),
        { separator: true },
        {
          label: tr('restore-file-to-its-version'),
          icon: RotateCcw,
          title: tr('file-in-working-folder-will-become'),
          onClick: () => restoreFile(file, c.hash, 'after'),
        },
        {
          label: tr('restore-file-to-its-version-before'),
          icon: History,
          disabled: !c.parents.length,
          title: tr('file-will-become-as-it'),
          onClick: () => restoreFile(file, c.hash, 'before'),
        },
        {
          label: tr('revert-this-commits-changes-in'),
          icon: Undo2,
          disabled: file.additions === null || !c.parents.length || file.status === 'A' || file.status === 'D',
          title: tr('remove-from-working-file-only'),
          onClick: () => applyHunks('revert', 'commit', file, c.hash, null),
        },
      );
    } else if (kind === 'unstaged' || kind === 'staged') {
      items.push(
        { label: tr('show-changes'), icon: FileDiff, onClick: () => openFile(file, kind, list) },
        ...fileViewItems(file, kind),
        kind === 'unstaged'
          ? { label: tr('stage-3'), icon: Plus, onClick: () => stageFiles([file.path]) }
          : { label: tr('unstage-2'), icon: Minus, onClick: () => unstageFiles(file.oldPath ? [file.path, file.oldPath] : [file.path]) },
      );
      if (kind === 'unstaged' && !file.untracked && file.status !== 'U') {
        items.push({
          label: tr('discard-changes-in-file'),
          icon: Undo2,
          danger: true,
          title: tr('discard-unstaged-changes-of-this'),
          onClick: () => applyHunks('discard', 'unstaged', file, null, null),
        });
      }
    } else return null;
    items.push({ separator: true }, { label: tr('copy-path'), icon: Copy, onClick: () => copy(file.path, tr('path')) });
    return items;
  };
  const openFileContextMenu = (file: AnyFile, kind: FileKind, list: AnyFile[], x: number, y: number, extra?: FileMenuExtra) => {
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
    const group = repo!.wipFiles.filter((f) => f.staged === staged);
    const still = group.find((f) => f.path === diffTarget.file.path);
    if (still) {
      if (group.length !== diffTarget.list.length || still.status !== diffTarget.file.status) {
        openFile(still, diffTarget.kind, group);
      }
      return;
    }
    const other = repo!.wipFiles.find((f) => f.path === diffTarget.file.path);
    if (other) openFile(other, other.staged ? 'staged' : 'unstaged', repo!.wipFiles.filter((f) => f.staged === other.staged));
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
      .fileDiff(repoRef.current!.path, {
        mode: t.mode,
        hash: t.hash,
        parent: t.parent,
        path: t.file.path,
        oldPath: t.file.oldPath,
        conflicted: t.file.status === 'U',
        ignoreWhitespace: ignoreWs,
        fullFile: diffFullFile,
      })
      .then((res) => {
        if (cancelled) return;
        setDiffData(res.ok ? { ...res.data, mode: t.mode } : ({ error: res.error.message, path: t.file.path, mode: t.mode } as DiffData));
      });
    return () => {
      cancelled = true;
    };
  }, [diffTarget, ignoreWs, diffFullFile, diffReload, diffNonce]);

  // Редактирование в окне изменений: файл рабочей копии (unstaged или новый), команды есть только в 2.0
  const editorFor = (t: AppDiffTarget): DiffEditor | null => {
    if (!api?.repo.readFile || !api.repo.saveFile || !repoRef.current) return null;
    if (t.mode !== 'unstaged' && t.mode !== 'untracked') return null;
    const dir = repoRef.current!.path;
    const path = t.file.path;
    return {
      key: `${dir}\0${path}`,
      read: () => api.repo.readFile!(dir, path),
      save: (text, baseHash) => api.repo.saveFile!(dir, { path, text, baseHash: baseHash! }),
      saved: () => {
        setDiffNonce((n) => n + 1);
        refresh();
      },
    };
  };

  /* ---------- Двойной клик по коммиту ---------- */

  // Как в GitKraken — двойной клик ведёт на ветку, а не в detached HEAD:
  //  - ровно одна локальная ветка на коммите — checkout этой ветки;
  //  - локальной нет, есть одна remote — создать локальную отслеживающую (git switch --track);
  //  - веток несколько или ни одной — спросить (выбор ветки / «Создать ветку здесь» / detached)
  const activateCommit = (node: GraphEntry) => {
    if (node.wip || node.stash || busyRef.current) return null;
    const cur = repo!.currentBranch;
    const locals = node.refs.filter((r) => r.type === 'local');
    if (locals.some((r) => r.name === cur)) return null; // уже на этой ветке
    const remotes = node.refs.filter((r) => r.type === 'remote' && !r.name.endsWith('/HEAD'));
    if (locals.length === 1) return checkout({ branch: locals[0].name });
    if (!locals.length && remotes.length === 1) return refActions.checkout(remotes[0]);
    if (!locals.length && !remotes.length && node.hash === repo!.headHash) return null; // HEAD уже здесь
    setDialog({ type: 'switchTo', node, locals, remotes });
    return null;
  };

  // HEAD прямо на коммит (detached) — только по явному выбору
  const checkoutDetached = (node: GraphEntry) =>
    run('checkoutCommit', { hash: node.hash }, {
      label: 'Checkout',
      success: tr('head-at-detached-undo-returns', node.hash.slice(0, 7)),
    });


  /* ---------- Stash: просмотр и действия ---------- */

  const stashTitle = (st: StashLike) => describeStash(st).title;

  const stashAction = (action: string, st: StashLike) => {
    if (action === 'drop') {
      return confirm({
        title: tr('delete-stash'),
        body: tr('delete-undo-can-bring-it', stashTitle(st)),
        confirmLabel: tr('delete-2'),
        danger: true,
        onConfirm: () => run('stashDrop', { id: st.id, hash: st.hash }, { label: 'Drop', success: tr('stash-deleted-undo-brings-it') }),
      });
    }
    const pop = action === 'pop';
    return run(pop ? 'stashPopAt' : 'stashApplyAt', { id: st.id, hash: st.hash }, {
      label: pop ? 'Pop' : 'Apply',
      success: pop ? tr('stash-applied-and-deleted', stashTitle(st)) : tr('stash-applied-2', stashTitle(st)),
    }).then((res) => {
      if (res.ok) setSelectedHash('WIP');
      return res;
    });
  };

  // Восстановить отдельные файлы из stash (без применения всего stash)
  const restoreFromStash = (list: AnyFile[] | null | undefined, st: StashLike | null | undefined): Promise<UiResult<unknown>> => {
    if (!list?.length || !st) return Promise.resolve({ ok: false } as UiResult<unknown>);
    const touched = new Set(list.flatMap((f) => [f.path, f.oldPath].filter(Boolean)));
    const dirty = (repo?.wipFiles ?? []).filter((f) => touched.has(f.path));
    const names = list.length === 1 ? list[0].path : `${list.length} ${plural(list.length, tr('file'), tr('files-2'), tr('files'))}`;
    const go = () =>
      run('restoreFromStash', { hash: st.hash, id: st.id, files: list.map(({ path, oldPath, status, untracked }) => ({ path, oldPath, status, untracked })) }, {
        label: tr('restore-from-stash'),
        success: (d) => tr('from-in-working-folder', names, st.id, d.undoable ? tr('undo-reverts-it-2') : ''),
      });
    if (!dirty.length) return go();
    return new Promise((resolve) =>
      confirm({
        title: tr('replace-changed-files'),
        body: tr('you-have-unsaved-changes-in', dirty.length === 1 ? tr('file-3', dirty[0].path) : tr('files-3', dirty.length), st.id),
        confirmLabel: tr('replace'),
        onConfirm: () => go().then(resolve),
      }),
    );
  };

  const buildStashMenu = (st: StashLike): MenuEntry[] => [
    { header: `${st.id} · ${stashTitle(st)}` },
    { label: tr('apply-2'), icon: Archive, onClick: () => stashAction('apply', st) },
    { label: tr('apply-and-delete-pop'), icon: Archive, onClick: () => stashAction('pop', st) },
    { separator: true },
    { label: tr('delete-drop'), icon: Trash2, danger: true, onClick: () => stashAction('drop', st) },
  ];

  /* ---------- Вернуть проект к коммиту ---------- */

  const openRevertTo = (commitNode: GraphEntry) => setDialog({ type: 'revertTo', commit: commitNode });

  const confirmRevertTo = async ({ push: andPush }: { push: boolean }) => {
    const target = (dialog as DialogOf<'revertTo'> | null)?.commit;
    if (!target) return;
    const res = await run('revertTo', { hash: target.hash }, {
      label: tr('revert-to-commit'),
      progress: tr('restoring-files-to', target.hash.slice(0, 7)),
      success: (d) => tr('files-restored-to-created-commit', target.hash.slice(0, 7), d.subject),
    });
    if (!res.ok) return;
    setDialog(null);
    setDiffTarget(null);
    setSelectedHash(res.data.to);
    if (andPush) push(false);
  };

  /* ---------- Поиск коммитов ---------- */

  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<CommitFilter>(EMPTY_FILTER);
  const [matchIndex, setMatchIndex] = useState(0);
  const filterActive = isFilterActive(filter);
  // Поиск ещё и в изменённых строках файлов (git log -G по коммитам графа): где именно найдено
  const [inFiles, setInFiles] = useState(() => readPref('searchInFiles', '1') !== '0');
  const [contentSearch, setContentSearch] = useState<ContentSearch | null>(null); // { query, loading, data: { commits, … }, error }
  const contentQuery = searchOpen && inFiles && repo ? filter.query.trim() : '';
  useEffect(() => {
    if (contentQuery.length < 2 || !api?.repo?.searchHistory) {
      setContentSearch(null);
      return undefined;
    }
    let alive = true;
    setContentSearch((cur) => ({ query: contentQuery, loading: true, data: cur?.query === contentQuery ? cur.data : null, error: null }));
    const t = setTimeout(async () => {
      const r = repoRef.current;
      if (!r) return;
      const hashes = r.commits.filter((c) => !(c as { wip?: boolean }).wip && !(c as { isStash?: boolean }).isStash).map((c) => c.hash);
      const res = await api.repo.searchHistory!(r.path, { hashes, query: contentQuery });
      if (!alive) return;
      setContentSearch(res.ok ? { query: contentQuery, loading: false, data: res.data, error: null } : { query: contentQuery, loading: false, data: null, error: res.error });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [contentQuery, repo?.headHash, repo?.commits?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Хэш → где найдено (файлы и строки)
  const fileHits = useMemo(() => {
    if (!contentSearch?.data || contentSearch.query !== contentQuery) return null;
    return new Map(contentSearch.data.commits.map((c) => [c.hash, c]));
  }, [contentSearch, contentQuery]);
  const noQueryFilter = useMemo(() => ({ ...filter, query: '' }), [filter]);
  const searchMatches = useMemo(
    () =>
      repo && searchOpen && filterActive
        ? repo!.commits.filter((c) => matchCommit(c, filter) || (fileHits?.has(c.hash) && matchCommit(c, noQueryFilter))).map((c) => c.hash)
        : [],
    [repo, filter, searchOpen, filterActive, fileHits, noQueryFilter],
  );
  const matchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  // При изменении фильтра — к первому совпадению; пришли совпадения в файлах, а по описанию ничего — тоже к первому
  const lastJump = useRef<CommitFilter | null>(null);
  useEffect(() => {
    setMatchIndex(0);
    if (searchMatches.length) {
      setDiffTarget(null);
      setSelectedHash(searchMatches[0]);
      lastJump.current = filter;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => {
    if (!fileHits || !searchMatches.length || lastJump.current === filter) return;
    lastJump.current = filter;
    setMatchIndex(0);
    setDiffTarget(null);
    setSelectedHash(searchMatches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileHits]);

  const gotoMatch = (delta: number) => {
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
  const toggleInFiles = () => {
    setInFiles((v) => {
      writePref('searchInFiles', v ? '0' : '1');
      return !v;
    });
  };
  // Открыть файл коммита на месте совпадения: diff сразу с поиском этого текста и прокруткой к строке
  const openSearchHit = (hash: string, hitFile: HitFile, line?: HitFile['lines'][number] | null) => {
    const commit = allCommits.find((c) => c.hash === hash);
    if (!commit) return;
    const loaded = Array.isArray(filesByHash[hash]) ? filesByHash[hash] : null;
    const list = loaded ?? (fileHits?.get(hash)?.files ?? [hitFile]).map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status }));
    const file = list.find((f) => f.path === hitFile.path) ?? { path: hitFile.path, oldPath: hitFile.oldPath, status: hitFile.status };
    const first = line ?? hitFile.lines?.[0] ?? null;
    setSelectedHash(hash);
    setDiffTarget({
      kind: 'commit',
      mode: 'commit',
      hash,
      parent: commit.parents[0] ?? null,
      commitHash: hash,
      file,
      list,
      index: Math.max(0, list.indexOf(file)),
      search: { open: true, query: contentQuery || filter.query.trim(), caseSensitive: false, regex: false, changedOnly: false, line: first ? { t: first.t, o: first.o, n: first.n } : null, nonce: Date.now() },
    });
  };

  /* ---------- Автообновление ---------- */

  const autoSync = useSyncStore((s) => s.autoSync);
  const syncMode = useSyncStore((s) => s.syncMode);
  const bgFetching = useSyncStore((s) => s.bgFetching);
  const lastFetch = useSyncStore((s) => s.lastFetch);
  const fetchError = useSyncStore((s) => s.fetchError);
  const accessRef = useRef<AccessState | null>(null);
  accessRef.current = access;

  // 1) Следим за папкой репозитория: коммиты, ветки, stash, правки файлов — граф обновляется сам
  useEffect(() => {
    if (!api?.repo.watch) return undefined;
    const dir = repo?.path;
    if (!autoSync || !dir) {
      api.repo.watch(null);
      return undefined;
    }
    api.repo.watch(dir, { syncIndex: workflow.syncIndex });
    return () => api.repo.watch!(null);
  }, [repo?.path, autoSync, workflow.syncIndex]);

  // Индекс подправлен под правки из внешней программы — коротко сообщаем, что произошло
  useEffect(() => {
    if (!api?.repo.onIndexSynced) return undefined;
    return api.repo.onIndexSynced((ev) => {
      if (ev.path !== repoRef.current?.path || !ev.synced?.length) return;
      const reset = ev.synced.filter((f) => f.action === 'reset').map((f) => f.file);
      const added = ev.synced.filter((f) => f.action === 'add').map((f) => f.file);
      const names = (list: string[]) => list.slice(0, 3).map((f) => f.split('/').pop()).join(', ') + (list.length > 3 ? tr('and-more', list.length - 3) : '');
      notify({
        type: 'info',
        title: reset.length
          ? tr('reverted-to-last-commit-by', names(reset))
          : tr('changes-from-another-program-added', names(added)),
        hint: reset.length && added.length ? tr('updated-in-index', names(added)) : tr('turn-off-settings-sync'),
      });
    });
  }, [notify]);

  // Изменения на диске: быстрый git status или полный перечит графа
  useEffect(() => syncStore.getState().watchChanges(() => setFsTick((n) => n + 1)), []);

  // 2) Фоновый fetch — `syncStore.backgroundFetch` (кнопка в строке состояния)
  // 3) Лёгкая проверка сервера — `syncStore.startRemoteSync`
  useEffect(
    () => syncStore.getState().startRemoteSync(repo?.path, repo?.remotes.length ?? 0, () => accessRef.current),
    [repo?.path, autoSync, repo?.remotes.length],
  );

  // CI/CD занимает центр (а не diff, конфликт, сравнение или rebase поверх него)
  const ciCentered = Boolean(ciView) && !(conflictPath || diffTarget || compareView || rebaseView || fileView);

  /* ---------- Разметка ---------- */

  return (
    <div className="flex h-full flex-col text-gk-text">
      <div className="app-backdrop" />
      {booting && <Splash subtitle={loading ? tr('loading-repository') : tr('starting')} />}
      <TitleBar
        tabs={tabs}
        activePath={activePath}
        loadingPath={loading ? loadingLabel : null}
        onSelectTab={(path) => path !== activePath && showTab(path)}
        onCloseTab={closeTab}
        onOpenRepository={openRepository}
        onNewTab={newTab}
        onMenu={(name, x, y) => setMenu({ x, y, items: appMenus()[name] ?? [] })}
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
            onRepoMenu={(x, y) =>
              setMenu({
                x,
                y,
                items: [
                  { header: repo!.path },
                  ...repoFolderItems(repo!.path),
                  { label: tr('copy-path-2'), icon: Copy, onClick: () => copy(repo!.path, tr('path')) },
                  { separator: true },
                  { label: tr('open-another-repository'), icon: FolderOpen, hint: 'Ctrl+O', onClick: openRepository },
                ],
              })
            }
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
                name: a.name || tr('action-2'),
                icon: ACTION_ICONS[a.icon as string] ?? WandSparkles,
                title: `${a.name}${a.hotkey ? ` (${a.hotkey})` : ''}\n${a.steps.map((st, i) => `${i + 1}. ${STEP_TYPES[st.type as StepTypeId]?.describe(st.params) ?? st.type}`).join('\n')}`,
                running: Boolean(actionRun && !actionRun.finished && actionRun.action.id === a.id),
              }))}
            onRunAction={(id) => {
              const a = userActions.find((x) => x.id === id);
              if (a) startAction(a);
            }}
            onOpenActions={() => setDialog({ type: 'actions' })}
          />

          {(repo!.operation || conflictPaths.length > 0) && (
            <OperationBanner
              operation={repo!.operation}
              conflicts={conflictPaths.length}
              onResolve={() => openConflict(conflictPaths[0])}
              busy={Boolean(busyAction)}
              onContinue={() =>
                run('continueOperation', {}, {
                  label: tr('continue-2'),
                  success: (d) => (d.finished ? tr('finished', OPERATION_LABELS[d.operation]) : tr('next-step')),
                })
              }
              onAbort={() =>
                run('abortOperation', {}, {
                  label: tr('abort'),
                  success: (d) => tr('aborted-state-restored', OPERATION_LABELS[d.operation]),
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
                refActions={refActions as PropsOf<typeof Sidebar, 'refActions'>}
                busy={Boolean(busyAction)}
                onStashMenu={(st, x, y) => setMenu({ x, y, items: buildStashMenu(st) })}
                onOpenCi={(file) => {
                  setDiffTarget(null);
                  setCiView({ file, mode: 'scheme', n: Date.now() });
                }}
                activeCiFile={ciView && ciView.mode !== 'pipelines' ? ciView.file : null}
                forge={forge}
                branchPipeline={branchPipeline as PropsOf<typeof Sidebar, 'branchPipeline'>}
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
                <LoadingOverlay title={busyText ?? PROGRESS_TEXT[busyAction]} label={repo!.name} />
              )}
              {searchOpen && !diffTarget && !conflictPath && (
                <SearchBar
                  commits={repo!.commits}
                  filter={filter}
                  onChange={setFilter}
                  matches={searchMatches}
                  current={matchIndex}
                  onPrev={() => gotoMatch(-1)}
                  onNext={() => gotoMatch(1)}
                  onClose={closeSearch}
                  totalLoaded={repo!.commits.length}
                  truncated={repo!.truncated}
                  inFiles={inFiles}
                  onToggleInFiles={toggleInFiles}
                  content={(contentQuery.length >= 2 ? { loading: Boolean(contentSearch?.loading), error: contentSearch?.error ?? null, commits: fileHits?.size ?? 0, partial: contentSearch?.data?.partial, truncated: contentSearch?.data?.truncated } : null) as PropsOf<typeof SearchBar, 'content'>}
                />
              )}
              {conflictPath ? (
                <ConflictView
                  key={conflictPath}
                  repoPath={repo!.path}
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
                  key={`${diffTarget.kind}:${diffTarget.file.path}:${diffTarget.search?.nonce ?? ''}`}
                  target={diffTarget}
                  initialSearch={diffTarget.search}
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
                  fullFile={diffFullFile}
                  onToggleFullFile={() => {
                    setDiffFullFile((v) => {
                      writePref('diff.fullFile', v ? '0' : '1');
                      return !v;
                    });
                  }}
                  editor={editorFor(diffTarget)}
                  onPrev={stepFile(-1)}
                  onNext={stepFile(1)}
                  onClose={closeDiff}
                  guardMarkers={guardMarkers}
                  hunkActions={hunkActionsFor(diffTarget)}
                  onHunkAction={onHunkAction}
                  fileActions={[
                    ...fileViewItems(diffTarget.file, diffTarget.kind === 'compare' ? 'commit' : (diffTarget.kind as FileKind), { hash: diffTarget.hash, parent: diffTarget.parent }).map((it) => ({
                      ...it,
                      label: it.label === 'Blame' ? 'Blame' : tr('file-history'),
                    })),
                    ...(diffTarget.kind === 'commit' && selected && !selected.wip
                      ? [
                          {
                            label: tr('restore-file-2'),
                            icon: RotateCcw,
                            title: tr('restore-this-file-in-working'),
                            onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              const items = buildFileMenu(diffTarget.file, 'commit', diffTarget.list);
                              if (items) setMenu({ x: r.left, y: r.bottom + 4, items: items.filter((i) => (i as MenuItem).label !== tr('show-changes') && (i as MenuItem).icon !== FileClock && (i as MenuItem).icon !== FileUser) });
                            },
                          },
                        ]
                      : []),
                  ] as FileAction[]}
                />
              ) : null}
              {compareView && (
                <CompareView
                  repoPath={repo!.path}
                  a={compareView.a}
                  b={compareView.b}
                  hidden={Boolean(conflictPath || diffTarget)}
                  activePath={null}
                  onSwap={() => setCompareView({ a: compareView.b, b: compareView.a })}
                  onClose={() => setCompareView(null)}
                  onOpenFile={(f, list, search) => openCompareFile(f, list, compareView.a, compareView.b, search)}
                  onLocate={setSelectedHash}
                  onFileMenu={(f, list, x, y) =>
                    setMenu({
                      x,
                      y,
                      items: [
                        { header: f.path },
                        { label: tr('show-changes'), icon: FileDiff, onClick: () => openCompareFile(f, list, compareView.a, compareView.b) },
                        ...fileViewItems(f, 'commit', { hash: compareView.b, parent: compareView.a }),
                        { separator: true },
                        { label: tr('copy-path'), icon: Copy, onClick: () => copy(f.path, tr('path')) },
                      ],
                    })
                  }
                />
              )}
              {fileView && (
                <FileView
                  repoPath={repo!.path}
                  view={fileView}
                  hidden={Boolean(conflictPath || diffTarget)}
                  onChange={(patch) => setFileView({ ...fileView, ...patch })}
                  onClose={() => setFileView(null)}
                  onLocate={locateCommit}
                  isLoaded={(hash) => allCommits.some((c) => c.hash === hash)}
                  notify={notify}
                  onRestore={(c) =>
                    c.status === 'D'
                      ? restoreFile({ path: fileView.path }, c.hash, 'before', c.path)
                      : restoreFile({ path: fileView.path }, c.hash, 'after', c.path)
                  }
                />
              )}
              {rebaseView && (
                <RebaseView
                  key={rebaseView.nonce}
                  repoPath={repo!.path}
                  session={rebaseView}
                  hidden={Boolean(conflictPath || diffTarget)}
                  busy={Boolean(busyAction)}
                  onClose={() => setRebaseView(null)}
                  onLocate={setSelectedHash}
                  onOpenDiff={(f, list, a, b) => openCompareFile(f, list, a, b)}
                  onApply={async (d) => {
                    const res = await run('rebaseApply', { oldHead: d.oldHead, newHead: d.newHead, branch: d.branch, onto: d.onto.hash }, {
                      label: 'Rebase',
                      success: tr('rebase-of-done-undo-ctrl', d.branch),
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
                      success: tr('rebase-done-undo-ctrl-z'),
                    });
                  }}
                />
              )}
              {conflictPath || diffTarget || compareView || rebaseView || fileView ? null : ciView ? (
                <CiView
                  repoPath={repo!.path}
                  onEditLogin={() => openAuth({ actionLabel: tr('save-and-check'), forCi: true })}
                  initialFile={ciView.file}
                  initialMode={ciView.mode}
                  initialPipelineId={ciView.pipelineId}
                  focusFailed={Boolean(ciView.focusFailed)}
                  version={ciVersion}
                  forge={forge}
                  remoteName={currentBranchInfo?.upstreamRemote}
                  currentBranch={repo!.currentBranch}
                  commitsBySha={commitsBySha}
                  branches={ciBranches}
                  onClose={() => setCiView(null)}
                  onLocate={(sha) => {
                    if (!allCommits.some((c) => c.hash === sha)) {
                      notify({ type: 'info', title: tr('commit-isnt-in-loaded-history'), hint: tr('fetch-or-pull') });
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
                  introKey={repo!.path}
                  focus={graphFocus}
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
                  currentBranch={repo!.currentBranch}
                  refActions={refActions}
                  onActivate={activateCommit as (node: GraphRow) => void}
                  onContextMenu={openMenu as (node: GraphRow, x: number, y: number) => void}
                  wipCount={repo!.wipFiles.length}
                  truncated={repo!.truncated}
                  onLoadMore={api.repo.loadMore && repo!.commits.length < MAX_HISTORY ? repoStore.getState().loadMore : undefined}
                  loadingMore={loadingMore}
                  loadMoreError={loadMoreError?.message ?? null}
                  matchSet={searchOpen && filterActive ? matchSet : null}
                  fileHits={(searchOpen && filterActive ? fileHits : null) as PropsOf<typeof CommitGraph, 'fileHits'>}
                  pipelines={pipelineMap?.bySha ?? null}
                  pipelineTips={pipelineTips}
                  onPipelineHover={loadPipelineTip}
                  onPipelineClick={(p) => openPipelines(p.id, p.status === 'failed')}
                  onCopySha={(hash) => copy(hash, tr('commit-hash'))}
                  mainBranches={mainBranches}
                  branchNames={branchNames}
                />
              )}
            </main>
            {/* Пока в центре CI/CD — у него свой инспектор задания справа; панель коммита прячем, чтобы не было двух правых панелей */}
            {!ciCentered && <div style={{ width: detailsW }} className="relative flex shrink-0">
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
                commit={selected as SelectedRow | null}
                files={(selected && !selected.wip ? filesByHash[selectedKey!] : null) as PropsOf<typeof CommitDetails, 'files'>}
                searchHits={(searchOpen && selected && !selected.wip ? fileHits?.get(selected.hash) ?? null : null) as CommitHits | null}
                searchQuery={contentQuery}
                onOpenSearchHit={openSearchHit}
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
                guardState={!guardCfg.enabled ? 'off' : guardCfg.repoOff.includes(repo!.path) ? 'repo-off' : 'on'}
                onGuardOpen={() => guardResult && setDialog({ type: 'guard', mode: 'view', result: guardResult })}
                onGuardToggleRepo={() => {
                  const off = guardCfg.repoOff.includes(repo!.path);
                  updateGuard({ ...guardCfg, repoOff: off ? guardCfg.repoOff.filter((p) => p !== repo!.path) : [...guardCfg.repoOff, repo!.path] });
                  notify({ type: 'info', title: off ? tr('pre-commit-check-enabled-for') : tr('pre-commit-check-disabled-for'), hint: off ? null : tr('turn-it-back-on-in') });
                }}
                onGuardSettings={() => setDialog({ type: 'settings', tab: 'guard' })}
                onCommitSettings={() => setDialog({ type: 'settings', tab: 'commit' })}
              />
            </div>}
          </div>
        </>
      ) : (
        activePath && !isNewTab(activePath) ? (
          // Вкладка репозитория ещё загружается
          <Welcome loading onOpen={openRepository} onCreate={() => createRepository()} onConnect={() => createRepository(undefined, 'connect')} onClone={() => setDialog({ type: 'clone' })} onGuide={() => setDialog({ type: 'guide' })} />
        ) : (
          <NewTabPage
            key={activePath ?? 'none'}
            loading={loading}
            loadingPath={loading ? loadingLabel : null}
            openPaths={tabs.filter((t) => !t.isNew).map((t) => t.path)}
            onOpen={openRepository}
            onOpenPath={(dir) => {
              const open = tabs.find((t) => !t.isNew && t.path.toLowerCase() === dir.toLowerCase());
              if (!open) return openTab(dir);
              // Уже открыт в другой вкладке — переключаемся на неё, пустую закрываем
              const blank = activePath;
              setTabs((t) => t.filter((x) => x.path !== blank));
              showTab(open.path);
              return null;
            }}
            onCreate={() => createRepository()}
            onConnect={() => createRepository(undefined, 'connect')}
            onClone={() => setDialog({ type: 'clone' })}
            onGuide={() => setDialog({ type: 'guide' })}
            onShortcuts={() => setDialog({ type: 'guide', section: 'keys' })}
            onSettings={() => setDialog({ type: 'settings', tab: 'appearance' })}
          />
        )
      )}

      {repo && (
        <StatusBar
          repo={repo}
          sync={{
            enabled: autoSync,
            mode: syncMode,
            onSettings: () => setDialog({ type: 'settings', tab: 'sync' }),
            fetching: bgFetching,
            lastFetch: lastFetch,
            error: fetchError,
            onToggle: () => syncStore.getState().setAutoSync(!syncStore.getState().autoSync),
            onFetchNow: () => syncStore.getState().backgroundFetch(true, notify),
          }}
          onJumpToHead={() => {
            setDiffTarget(null);
            setSelectedHash(repo!.headHash);
          }}
          onOpenFolder={api?.openFolder ? () => openRepoFolder(repo!.path) : null}
          onOpenTerminal={api?.openTerminal ? () => openRepoTerminal(repo!.path) : null}
          pipeline={(ciReady ? branchPipeline : null) as PropsOf<typeof StatusBar, 'pipeline'>}
          pipelineLabel={forge?.label ?? null}
          onOpenPipeline={(p) => openPipelines(p.id, p.status === 'failed')}
          onPathMenu={(x, y) =>
            setMenu({ x, y, items: [...repoFolderItems(repo!.path), { separator: true }, { label: tr('copy-path-2'), icon: Copy, onClick: () => copy(repo!.path, tr('path')) }] })
          }
        />
      )}

      {dialog?.type === 'error' && (
        <ErrorDialog
          action={dialog.action}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onCheckAccess={(repo?.remotes.length ? () => setDialog({ type: 'access' }) : null) as PropsOf<typeof ErrorDialog, 'onCheckAccess'>}
        />
      )}
      {dialog?.type === 'guide' && <GuideDialog initialSection={dialog.section} onClose={() => setDialog(null)} />}
      {dialog?.type === 'about' && (
        <Modal title={tr('about-2')} icon={Info} onClose={() => setDialog(null)} width={400}>
          <div className="space-y-2 text-[13px]">
            <div className="text-[15px] font-semibold text-gk-strong">{tr('git-gorynych')}</div>
            <div className="text-gk-muted">{tr('about-version')}</div>
            <div className="text-[12px] leading-relaxed text-gk-dim">
              {tr('commit-graph-branches-stash-conflicts')}</div>
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
          sync={{
            enabled: autoSync,
            mode: syncMode,
            onMode: syncStore.getState().changeSyncMode,
            onToggle: syncStore.getState().setAutoSync,
          }}
          guard={guardCfg}
          onGuardChange={updateGuard}
          repoPath={repo?.path}
          servers={
            api?.creds?.servers
              ? {
                  tick: serversTick,
                  repoOpen: Boolean(repo),
                  onAuthCurrent: () => openAuth({ actionLabel: tr('save-and-check') }),
                  onEdit: (url) => openAuth({ url, verify: true, actionLabel: tr('save-and-check') }),
                  onForgetLogin: async (login, label) => {
                    const res = await api.creds!.forgetLogin(login);
                    if (res.ok) {
                      setServersTick((n) => n + 1);
                      refreshForge();
                      notify({ type: 'info', title: String(login).startsWith('ci:') ? tr('ci-cd-token-for-removed', label.replace(/^CI\/CD /, '')) : tr('sign-in-for-removed', label) });
                    }
                  },
                  onForgetServer: async (hostname) => {
                    const res = await api.creds!.forgetServer(hostname);
                    if (res.ok) {
                      setServersTick((n) => n + 1);
                      refreshForge();
                      notify({ type: 'info', title: tr('all-sign-ins-for-removed', hostname) });
                    }
                  },
                }
              : null
          }
          paused={Boolean(auth)}
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
        <ConfirmDialog title={dialog.title} confirmLabel={tr('continue-2')} onConfirm={dialog.onYes} onClose={() => {
          setDialog(null);
          dialog.onNo();
        }}>
          <p className="leading-relaxed">{typeof dialog.body === 'string' ? kb(dialog.body) : dialog.body}</p>
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
        <AccessDialog
          access={access}
          onClose={() => setDialog(null)}
          onRecheck={checkAccess}
          onCredentials={(api?.creds ? () => openAuth({ actionLabel: tr('save-and-check') }) : null) as PropsOf<typeof AccessDialog, 'onCredentials'>}
        />
      )}
      {dialog?.type === 'renameBranch' && (
        <RenameBranchDialog
          from={dialog.from}
          upstream={dialog.upstream}
          busy={dialog.busy}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onSubmit={renameBranch}
        />
      )}
      {dialog?.type === 'switchTo' && (
        <SwitchToDialog
          node={dialog.node}
          locals={dialog.locals}
          remotes={dialog.remotes}
          onClose={() => setDialog(null)}
          onBranch={(ref) => {
            setDialog(null);
            refActions.checkout(ref as CommitRef);
          }}
          onCreateBranch={() => openBranchDialog(dialog.node)}
          onDetached={() => {
            const node = dialog.node;
            setDialog(null);
            checkoutDetached(node);
          }}
        />
      )}
      {dialog?.type === 'checkoutWip' && (
        <CheckoutWipDialog
          wip={dialog.wip}
          busy={Boolean(busyAction)}
          onChoose={chooseCheckoutWip}
          onClose={() => {
            dialog.resolve?.({ ok: false, error: { code: 'CANCELED' } });
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === 'rejected' && (
        <PushRejectedDialog
          branch={dialog.branch!}
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
          startHash={dialog.startHash!}
          startLabel={dialog.startLabel}
          branches={branchBases}
          flow={dialog.flow}
          busy={busyAction === 'createBranch'}
          error={dialog.error}
          onClose={() => setDialog(null)}
          onSubmit={createBranch}
        />
      )}

      {dialog?.type === 'init' && (
        <InitRepoDialog
          key={dialog.info.path}
          info={dialog.info as PropsOf<typeof InitRepoDialog, 'info'>}
          reason={dialog.reason}
          initialMode={dialog.mode ?? 'init'}
          busy={initBusy}
          error={dialog.error as PropsOf<typeof InitRepoDialog, 'error'>}
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
            openTab(parent!);
          }}
        />
      )}
      {dialog?.type === 'clone' && (
        <CloneDialog
          onAuth={(api?.creds ? (url, error, retry) => openAuth({ url, error, retry: retry as AuthOptions['retry'] }) : null) as PropsOf<typeof CloneDialog, 'onAuth'>}
          onClose={() => setDialog(null)}
          onCloned={(r) => {
            setDialog(null);
            notify({ type: 'success', title: tr('repository-cloned', r.name), hint: r.path });
            openTab(r.path);
          }}
        />
      )}
      {dialog?.type === 'revertTo' && repo && (
        <RevertToDialog
          repoPath={repo!.path}
          commit={dialog.commit}
          busy={busyAction === 'revertTo' || busyAction === 'stash'}
          onClose={() => setDialog(null)}
          onConfirm={confirmRevertTo}
          onStashFirst={async () => (await run('stash', {}, { label: 'Stash', success: tr('changes-stashed') })).ok}
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
      {auth && (
        <AuthDialog
          key={`${auth.url ?? auth.dir ?? ''}:${auth.nonce}`}
          target={auth.target}
          error={auth.error as PropsOf<typeof AuthDialog, 'error'>}
          formError={auth.formError}
          notice={auth.notice}
          busy={auth.busy}
          actionLabel={auth.actionLabel}
          onSubmit={submitAuth}
          onForget={auth.target?.saved ? forgetAuth : null}
          onClose={() => setAuth(null)}
          onKeyDefaults={(type, url) => api.creds!.keyDefaults(auth.dir, url ?? auth.url, type)}
          canEditRemote={Boolean(auth.dir && !auth.url)}
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
          <p className="leading-relaxed">{typeof dialog.body === 'string' ? kb(dialog.body) : dialog.body}</p>
        </ConfirmDialog>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      <Toasts toasts={toasts} onClose={closeToast} />
      <TooltipLayer />
    </div>
  );
}

function OperationBanner({ operation, conflicts, busy, onContinue, onAbort, onResolve }: { operation: string | null; conflicts: number; busy: boolean; onContinue: () => void; onAbort: () => void; onResolve: () => void }) {
  return (
    <div className="glass flex shrink-0 animate-slide-up items-center gap-3 border-b border-gk-yellow/30 bg-gk-yellow/10 px-3 py-2 text-xs">
      <AlertTriangle size={14} className="shrink-0 text-gk-yellow" />
      <span className="flex-1">
        {operation ? (
          <>
            {tj('in-progress', [<b />, OPERATION_LABELS[operation], conflicts > 0
              ? tr('conflicts-left-to-resolve-then', conflicts)
              : tr('conflicts-resolved-you-can-continue')])}
          </>
        ) : (
          <>{tj('there-are-conflicts-after-applying', [conflicts])}</>
        )}
      </span>
      {conflicts > 0 && (
        <Button variant="danger" onClick={onResolve} disabled={busy} className="py-1 text-xs">
          {tr('resolve-conflicts')}</Button>
      )}
      {operation && (
        <>
          <Button onClick={onAbort} disabled={busy} className="py-1 text-xs" title={tr('restore-everything-as-it-was')}>
            {tr('abort')}</Button>
          <Button variant="primary" onClick={onContinue} disabled={busy || conflicts > 0} className="py-1 text-xs">
            {tr('continue-2')}</Button>
        </>
      )}
    </div>
  );
}

function Welcome({ loading, onOpen, onCreate, onConnect, onClone, onGuide }: { loading?: boolean; onOpen: () => void; onCreate: () => void; onConnect: () => void; onClone: () => void; onGuide: () => void }) {
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
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-gk-dim">{tr('git-gorynych')}</div>
        <h1 className="text-lg font-semibold text-gk-strong">{tr('open-repository-2')}</h1>
        <p className="mt-1 text-gk-muted">{tr('choose-folder-with-local-git')}</p>
      </div>
      <button
        onClick={onOpen}
        disabled={loading}
        className="flex animate-slide-up items-center gap-2 rounded-lg bg-gk-green px-5 py-2.5 font-semibold text-gk-ink shadow-lg shadow-gk-green/20 transition hover:shadow-gk-green/40 hover:brightness-110 disabled:opacity-60"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
        {loading ? tr('loading') : tr('open-repository-3')}
      </button>
      <button
        onClick={onCreate}
        disabled={loading}
        className="flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        {tj('create-repository-in-project-folder', [<FolderPlus size={15} />])}</button>
      <button
        onClick={onConnect}
        disabled={loading}
        className="-mt-3 flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        {tj('connect-project-folder-to-gitlab', [<Link2 size={15} />])}</button>
      <button
        onClick={onClone}
        disabled={loading}
        className="-mt-3 flex animate-slide-up items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-gk-muted ring-1 ring-gk-border transition hover:bg-gk-hover hover:text-gk-text disabled:opacity-60"
      >
        {tj('clone-repository-from-link', [<CloudDownload size={15} />])}</button>
      <p className="max-w-sm animate-fade-in text-center text-xs text-gk-dim">
        {tj('if-chosen-folder-has-no', [kb(tr('ctrl-o-open-ctrl-n'))])}</p>
      <button onClick={onGuide} className="-mt-2 flex animate-fade-in items-center gap-1.5 text-[12.5px] text-gk-blue hover:underline">
        {tj('how-to-use-app-f1', [<BookOpen size={13} />])}</button>
    </div>
  );
}

function ErrorBanner({ error, onClose }: { error: LoadError; onClose: () => void }) {
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

