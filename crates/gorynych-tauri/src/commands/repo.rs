//! Команды `repo:*` и `clone:*`: перенос обработчиков git из `electron/main.cjs` (раздел «Git»).
//!
//! # Конспект исходника
//! - Все команды, кроме `repo:watch`, `repo:open-dialog`, `repo:get-last` и `repo:clone-cancel`, обёрнуты в `safe`: ошибка → `{ok:false, error}`.
//! - Большинство принимает `dir` как есть и сами модули находят корень. Через `resolveRepoRoot(dir)` идут: `repo:ci*` (кроме
//!   `repo:ci-edit`), `repo:remote-check`, `repo:branch-log`, `repo:commit-template`, `repo:gitflow-config`, `repo:action`.
//! - `repo:load`: `loadRepository` + `history` (`historySummary`) + `ci` (`detectCi`) + `forge` (`cicd.detect` по upstream-remote текущей
//!   ветки, ошибка → `null`); затем `lastRepo` и «недавние». Ошибки записи настроек не мешают ответу.
//! - `repo:status`: `quickStatus` + `ci` (файл CI мог появиться или исчезнуть).
//! - `repo:ci`, `repo:ci-preview`: `file` не строкой → `null`. `repo:ci-diff`, `repo:ci-save`, `repo:ci-create`: `draft ?? {}`.
//! - `repo:clone`: прогресс событием `clone:progress` `{ id, ...progress }`; `repo:clone-cancel` → `cancelClone(id)` без `safe`.
//! - `repo:watch(dir, {syncIndex})`: прежнее слежение окна останавливается; `dir` не строка, пусто или папки нет → `false`.
//!   С `syncIndex` сначала запоминается состояние индекса (`sync(false)`), затем на каждое изменение: синхронизация индекса
//!   (`act = worktree`), при непустом `synced` событие `repo:index-synced {path, synced}`, затем `repo:changed {path, git, worktree}`.
//!   Корень ищется лениво и повторно, пока не найден. Задержка слежения 120 мс.
//!
//! # Отличия от 1.x
//! - Ошибка — отклонённый promise `{code, message, hint, details}`, а не `{ok:false, error}` (см. шапку `lib.rs`).
//! - `repo:action(dir, {name, payload})` — один типизированный аргумент [`RepoAction`] вместо `(dir, name, payload)`: интерфейс
//!   получает размеченное объединение. Аргумент неверной формы отклоняется самим Tauri строкой, а не `BAD_ARGS`; поля внутри
//!   параметров по-прежнему снисходительны (`lenient`), как `typeof` в 1.x. То же для остальных команд: форму аргументов
//!   гарантируют типы `bindings/commands.ts`.
//! - События называются по имени структуры (`repo-changed`, `repo-index-synced`, `clone-progress-event`) — так их называет `tauri-specta`.
//! - Не перенесены: `repo:open-dialog`, `repo:open-path` (нужны плагины диалогов и открытия файлов — вместе с `shell:*`).
//!
//! Линтер CI синхронный и запускает `git` сам: он идёт в `spawn_blocking`, чтобы не занимать рабочий поток tokio.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gorynych_ci_linter::detect::{CiSystem, detect_ci};
use gorynych_ci_linter::edit::file::{CiDraftDiff, CiSaveRequest, CiSaved, create_from_template, diff_draft, save_file};
use gorynych_ci_linter::edit::{CiEditOp, CiEditResult, apply_edit};
use gorynych_ci_linter::guard::{GuardParams, GuardScan, scan_staged};
use gorynych_ci_linter::load::model::CiLoad;
use gorynych_ci_linter::load::{load_ci, preview_ci};
use gorynych_cicd::models::ForgeStatus;
use gorynych_core::error::{GorynychError, Result};
use gorynych_core::i18n;
use gorynych_git::actions::{ActionOutput, RepoAction};
use gorynych_git::clone::{CloneProbe, CloneProgress, CloneRequest, Cloned, cancel_clone, clone_repository, probe_clone};
use gorynych_git::compare::{ChangeSearch, CompareRequest, Comparison, HistorySearch, SearchChanges, SearchHistory, compare_commits, search_changes, search_history};
use gorynych_git::diff::{FileDiff, FileDiffRequest, get_file_diff};
use gorynych_git::gitflow::{GitflowConfig, gitflow_config};
use gorynych_git::history::{Blame, BlameRequest, CommitInfo, CommitInfoRequest, FileHistory, FileHistoryRequest, blame, commit_info, file_history};
use gorynych_git::init::{ConnectOptions, ConnectResult, FolderInfo, InitOptions, InitResult, ProbeRemote, RemoteProbe, connect_repository, init_repository, inspect_folder, probe_remote};
use gorynych_git::read::{CommitFile, QuickStatus, Repository, StashDetails, get_commit_files, get_stash_details, load_repository, quick_status, resolve_repo_root};
use gorynych_git::rebase::{RebasePreview, RebaseRequest, simulate};
use gorynych_git::write::{BranchLog, BranchLogRequest, CommitTemplate, branch_log, read_commit_template};
use gorynych_storage::undo::HistorySummary;
use gorynych_watcher::index_sync::{IndexSync, SyncedFile};
use gorynych_watcher::remote_watch::LightCheck;
use gorynych_watcher::watch::{RepoWatch, watch_repository};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::AppState;
use crate::bridge::GitView;

const WATCH_DELAY: Duration = Duration::from_millis(120);

/* ---------- Типы ответов и событий ---------- */

/// Ответ `repo:load`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LoadedRepository {
    #[serde(flatten)]
    pub repository: Repository,
    pub history: HistorySummary,
    pub ci: Vec<CiSystem>,
    pub forge: Option<ForgeStatus>,
}

/// Ответ `repo:status`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StatusWithCi {
    #[serde(flatten)]
    pub status: QuickStatus,
    pub ci: Vec<CiSystem>,
}

/// Черновик для `repo:ci-diff`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CiDraft {
    pub path: String,
    /// `String(content ?? '')`.
    pub content: Option<String>,
}

/// Параметры `repo:ci-create`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CiCreate {
    pub system: String,
}

/// Параметры `repo:watch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct WatchOptions {
    pub sync_index: bool,
}

/// Событие `repo:changed`.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct RepoChanged {
    pub path: String,
    pub git: bool,
    pub worktree: bool,
}

/// Событие `repo:index-synced`.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct RepoIndexSynced {
    pub path: String,
    pub synced: Vec<SyncedFile>,
}

/// Событие `clone:progress`.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct CloneProgressEvent {
    pub id: Option<String>,
    #[serde(flatten)]
    pub progress: CloneProgress,
}

/* ---------- Вспомогательное ---------- */

pub(crate) async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(GorynychError::unknown)?
}

async fn root_of(dir: &str) -> Result<PathBuf> {
    resolve_repo_root(Path::new(dir)).await
}

/// `ci.detectCi(path)` вне рабочего потока: обход папок.
async fn detect(path: String) -> Result<Vec<CiSystem>> {
    blocking(move || Ok(detect_ci(Path::new(&path)))).await
}

/* ---------- Чтение ---------- */

#[tauri::command]
#[specta::specta]
pub async fn repo_load(state: State<'_, AppState>, dir: String) -> Result<LoadedRepository> {
    let services = state.services()?;
    let repository = load_repository(Path::new(&dir), None).await?;
    let root = PathBuf::from(&repository.path);
    let history = services.engine.history_summary(&root)?;
    let ci = detect(repository.path.clone()).await?;
    let upstream = repository.local_branches.iter().find(|branch| Some(&branch.name) == repository.current_branch.as_ref()).and_then(|branch| branch.upstream_remote.clone());
    let forge = services.cicd.detect(&root, upstream.as_deref()).await.ok().flatten();
    // Как `writeSettings` в 1.x: сбой записи только в журнал, ответ не меняется
    let _ = services.db.set_last_repo(&repository.path);
    let _ = services.db.remember_recent(&repository.path, Some(&repository.name));
    Ok(LoadedRepository { repository, history, ci, forge })
}

#[tauri::command]
#[specta::specta]
pub async fn repo_inspect(dir: Option<String>) -> Result<FolderInfo> {
    inspect_folder(dir.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_status(dir: String) -> Result<StatusWithCi> {
    let status = quick_status(Path::new(&dir)).await?;
    let ci = detect(status.path.clone()).await?;
    Ok(StatusWithCi { status, ci })
}

#[tauri::command]
#[specta::specta]
pub async fn repo_stash_details(dir: String, hash: String) -> Result<StashDetails> {
    get_stash_details(Path::new(&dir), &hash).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_commit_files(dir: String, hash: String, parent: Option<String>) -> Result<Vec<CommitFile>> {
    get_commit_files(Path::new(&dir), &hash, parent.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_file_diff(dir: String, params: FileDiffRequest) -> Result<FileDiff> {
    get_file_diff(Path::new(&dir), &params).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_compare(dir: String, params: CompareRequest) -> Result<Comparison> {
    compare_commits(Path::new(&dir), params.a.as_deref(), params.b.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_compare_search(dir: String, params: SearchChanges) -> Result<ChangeSearch> {
    search_changes(Path::new(&dir), &params).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_search_history(dir: String, params: Option<SearchHistory>) -> Result<HistorySearch> {
    search_history(Path::new(&dir), &params.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_file_history(dir: String, params: Option<FileHistoryRequest>) -> Result<FileHistory> {
    file_history(Path::new(&dir), &params.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_blame(dir: String, params: Option<BlameRequest>) -> Result<Blame> {
    blame(Path::new(&dir), &params.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_commit_info(dir: String, params: Option<CommitInfoRequest>) -> Result<CommitInfo> {
    commit_info(Path::new(&dir), &params.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_gitflow_config(dir: String) -> Result<GitflowConfig> {
    Ok(gitflow_config(&root_of(&dir).await?).await)
}

#[tauri::command]
#[specta::specta]
pub async fn repo_rebase_preview(dir: String, params: RebaseRequest) -> Result<RebasePreview> {
    simulate(Path::new(&dir), &params).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_branch_log(dir: String, params: Option<BranchLogRequest>) -> Result<BranchLog> {
    branch_log(&root_of(&dir).await?, &params.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_commit_template(dir: String) -> Result<Option<CommitTemplate>> {
    Ok(read_commit_template(&root_of(&dir).await?).await)
}

/// `rules` — правила Pre-commit Guard: правила по умолчанию живут в интерфейсе.
#[tauri::command]
#[specta::specta]
pub async fn repo_guard_scan(dir: String, params: Option<GuardParams>) -> Result<GuardScan> {
    let params = params.unwrap_or_default();
    blocking(move || scan_staged(&GitView(PathBuf::from(dir)), &params)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_remote_check(state: State<'_, AppState>, dir: String) -> Result<LightCheck> {
    let services = state.services()?;
    Ok(services.remote_watch.light_check(&root_of(&dir).await?).await)
}

/* ---------- Инициализация и подключение ---------- */

#[tauri::command]
#[specta::specta]
pub async fn repo_init(dir: Option<String>, options: Option<InitOptions>) -> Result<InitResult> {
    init_repository(dir.as_deref(), &options.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_probe_remote(state: State<'_, AppState>, dir: Option<String>, options: Option<ProbeRemote>) -> Result<RemoteProbe> {
    probe_remote(state.services()?.engine.network(), dir.as_deref(), &options.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_connect(state: State<'_, AppState>, dir: Option<String>, options: Option<ConnectOptions>) -> Result<ConnectResult> {
    connect_repository(state.services()?.engine.network(), dir.as_deref(), &options.unwrap_or_default()).await
}

/* ---------- CI в файлах репозитория ---------- */

#[tauri::command]
#[specta::specta]
pub async fn repo_ci(dir: String, file: Option<String>) -> Result<CiLoad> {
    let root = root_of(&dir).await?;
    let language = i18n::language();
    blocking(move || Ok(load_ci(&root, file.as_deref().unwrap_or_default(), language, &GitView(root.clone())).load)).await
}

/// `drafts`: путь → текст. Разбор черновиков без сохранения.
#[tauri::command]
#[specta::specta]
pub async fn repo_ci_preview(dir: String, file: Option<String>, drafts: Option<HashMap<String, String>>) -> Result<CiLoad> {
    let root = root_of(&dir).await?;
    let language = i18n::language();
    let drafts = drafts.unwrap_or_default();
    blocking(move || Ok(preview_ci(&root, file.as_deref().unwrap_or_default(), language, &drafts, &GitView(root.clone())).load)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_ci_diff(dir: String, draft: Option<CiDraft>) -> Result<CiDraftDiff> {
    let root = root_of(&dir).await?;
    let draft = draft.unwrap_or_default();
    let language = i18n::language();
    blocking(move || diff_draft(&root, &draft.path, draft.content.as_deref().unwrap_or_default(), language)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_ci_save(dir: String, draft: CiSaveRequest) -> Result<CiSaved> {
    let root = root_of(&dir).await?;
    let language = i18n::language();
    blocking(move || save_file(&root, &draft, language)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_ci_create(dir: String, opts: Option<CiCreate>) -> Result<CiSaved> {
    let root = root_of(&dir).await?;
    let system = opts.unwrap_or_default().system;
    let language = i18n::language();
    blocking(move || create_from_template(&root, &system, language)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_ci_edit(content: String, op: CiEditOp) -> Result<CiEditResult> {
    let language = i18n::language();
    blocking(move || apply_edit(&content, &op, language)).await
}

/* ---------- Клонирование ---------- */

#[tauri::command]
#[specta::specta]
pub async fn repo_clone_probe(state: State<'_, AppState>, url: Option<String>) -> Result<CloneProbe> {
    probe_clone(state.services()?.engine.network(), url.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_clone(app: AppHandle, state: State<'_, AppState>, options: CloneRequest) -> Result<Cloned> {
    let id = options.id.clone();
    clone_repository(state.services()?.engine.network(), &options, |progress| {
        let _ = CloneProgressEvent { id: id.clone(), progress }.emit(&app);
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn repo_clone_cancel(id: String) -> bool {
    cancel_clone(&id)
}

/* ---------- Действия ---------- */

/// Все изменяющие и сетевые операции. См. `gorynych_git::actions`.
#[tauri::command]
#[specta::specta]
pub async fn repo_action(state: State<'_, AppState>, dir: String, action: RepoAction) -> Result<ActionOutput> {
    let engine = Arc::clone(&state.services()?.engine);
    let root = root_of(&dir).await?;
    engine.run(&root, action).await
}

/* ---------- Слежение ---------- */

/// Действующее слежение. `Drop` останавливает и его, и повторы синхронизации индекса.
pub struct ActiveWatch {
    _watch: RepoWatch,
    stopped: Arc<AtomicBool>,
}

impl Drop for ActiveWatch {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
    }
}

/// Синхронизация индекса для слежения. Корень ищется, пока не найдётся: `root = root ?? await resolveRepoRoot(dir)`.
struct Syncer {
    dir: PathBuf,
    root: Mutex<Option<PathBuf>>,
    index_sync: Arc<IndexSync>,
    stopped: Arc<AtomicBool>,
}

impl Syncer {
    async fn sync(&self, act: bool) -> Option<Vec<SyncedFile>> {
        let known = self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let root = match known {
            Some(root) => root,
            None => {
                let root = resolve_repo_root(&self.dir).await.ok()?;
                *self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(root.clone());
                root
            }
        };
        self.index_sync.sync_retrying(&root, act, &self.stopped).await.map(|result| result.synced)
    }
}

#[tauri::command]
#[specta::specta]
pub fn repo_watch(app: AppHandle, state: State<'_, AppState>, dir: Option<String>, opts: Option<WatchOptions>) -> Result<bool> {
    let mut active = state.watch.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    *active = None;
    let Some(dir) = dir.filter(|dir| !dir.is_empty() && Path::new(dir).exists()) else {
        return Ok(false);
    };
    let services = state.services()?;
    let do_sync = opts.unwrap_or_default().sync_index;
    let stopped = Arc::new(AtomicBool::new(false));
    let syncer = Arc::new(Syncer { dir: PathBuf::from(&dir), root: Mutex::new(None), index_sync: Arc::clone(&services.index_sync), stopped: Arc::clone(&stopped) });
    if do_sync {
        let syncer = Arc::clone(&syncer);
        tauri::async_runtime::spawn(async move { syncer.sync(false).await });
    }
    let watched = PathBuf::from(&dir);
    let watch = watch_repository(&watched, WATCH_DELAY, move |what| {
        let (app, syncer, path) = (app.clone(), Arc::clone(&syncer), dir.clone());
        tauri::async_runtime::spawn(async move {
            if do_sync
                && let Some(synced) = syncer.sync(what.worktree).await.filter(|synced| !synced.is_empty())
            {
                let _ = RepoIndexSynced { path: path.clone(), synced }.emit(&app);
            }
            let _ = RepoChanged { path, git: what.git, worktree: what.worktree }.emit(&app);
        });
    })?;
    *active = Some(ActiveWatch { _watch: watch, stopped });
    Ok(true)
}

/// Останавливает слежение при закрытии окна, как `event.sender.once('destroyed')`.
pub(crate) fn stop_watch<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<AppState>() {
        *state.watch.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
}
