//! Операции, меняющие репозиторий или работающие с сетью, и история Undo/Redo. Перенос `electron/actions.cjs`.
//!
//! ## Конспект
//! - Вход один: [`RepoEngine::run`] с [`RepoAction`]. Неизвестное действие — `BAD_ARGS`.
//! - Действие пишет запись истории только после успеха; новая запись очищает redo. `stashApplyAt`, `stashPopAt`, `gitRaw`, `discardAll`, `stashPop` не отменяются и лишь очищают redo.
//! - Undo и Redo: обработчик выполняется, и только при успехе запись переходит в другой стек. Устаревшая запись — `HISTORY_STALE`.
//! - `trackConflicts`: `pull`, `cherryPick`, `revert`, `merge`, `rebase`, `rebaseStart` при `CONFLICT` запоминают исходный HEAD, и после «Продолжить» операцию можно отменить целиком.
//! - Занятость: пока идёт действие пользователя, фоновая задача не запускается; действие дожидается уже идущей фоновой задачи, чтобы два процесса git не боролись за `.git/index.lock`.
//!
//! ## Отличия от 1.x
//! - История лежит в базе и переживает перезапуск. Устаревшие записи ловят те же проверки `HISTORY_STALE`, что и в 1.x: состояние репозитория сверяется перед каждой отменой.
//! - Снимки файлов на диске ограничены: см. `gorynych-storage::undo` (`UNDO_BLOBS_LIMIT`). Сверх предела пропадают самые старые записи, а не текущая.
//! - Ошибка записи в базу не отменяет успешную операцию git: коммит сделан, просто не попал в историю.
//! - Поле запроса неверного типа считается отсутствующим и даёт ту же ошибку, что `typeof` в 1.x.
//! - Действия одного репозитория не становятся в очередь, как и в 1.x: долгий push не должен блокировать работу с файлами, а от двойного запуска защищает интерфейс (`busyRef`). Поэтому вместо актора из плана — [`RepoEngine`] с общим состоянием.

mod checkout;
mod history;
mod ops;
mod remote;
mod state;

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use gorynych_core::error::{ErrorCode, GorynychError, Result, WipConflict};
use gorynych_core::i18n::t;
use gorynych_storage::db::Db;
use gorynych_storage::undo::{HistorySummary, NewUndoEntry, UndoEntry};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::watch;

pub use checkout::{AutoStash, Checkout, CheckoutRequest, CreatedBranch, DiscardedChanges, MovedChanges, RemoteBranchRef, RestoredStash};
pub use ops::{
    BranchCreated, BranchDeleted, BranchRenamed, CreateBranch, CreateTag, DeleteBranch, DeleteTag, Discarded, FastForward, FastForwarded, GitRaw, GitRawResult, HashRequest, HeadMoved, OperationResult, PreviewCommit, PreviewTarget, RefMoved, RefRequest, RenameBranch, ResetRequest, ResetResult, RevertPreview, RevertTo, RevertedTo, StashAt, StashPopped, StashPush, StashPushed, StashRef, TagInfo, split_args,
};
pub use remote::{AccessInfo, BranchUpdated, CheckAccess, DeleteRemoteBranch, FetchResult, PullRequest, PullResult, PushRequest, PushResult, RemoteBranchDeleted, UpdateBranch, check_access};
pub use state::Position;

use self::checkout::{CheckoutKind, checkout_commit, checkout_with_strategy, inspect_wip};
use self::history::Entry;
use self::state::{current_state, require_hash};
use crate::common::{head_hash, lenient, or_undefined, quiet, short};
use crate::conflicts::{ConflictInfo, MarkResolved, ResolveResult, ResolveWhole, SaveResolution, get_conflict, mark_resolved, resolve_whole, save_resolution};
use crate::network::Network;
use crate::rebase::{RebaseApply, RebaseDone, RebaseRequest, RebaseSessions};
use crate::restore::{ApplyHunks, RestoreFile, RestoreFromStash, apply_hunks, restore_file, restore_from_stash};
use crate::write::{CommitResult, PathsArg, commit, stage, unstage};

/// Действие без параметров. Лишние поля игнорируются.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
pub struct NoParams {}

/// Параметры `stage` и `unstage`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct PathsRequest {
    pub paths: Option<PathsArg>,
}

/// Параметры `commit`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CommitRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub summary: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub description: Option<String>,
}

/// Параметры `getConflict`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ConflictRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub path: Option<String>,
}

/// Параметры `mergeInto`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct MergeInto {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub target: Option<String>,
    #[serde(rename = "ref", deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub reference: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub smart: Option<bool>,
}

/// Параметры `cherryPickInto`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CherryPickInto {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub target: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub smart: Option<bool>,
}

/// Действие с репозиторием. На проводе — `{ name, payload }`, имена как в 1.x.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "name", content = "payload", rename_all = "camelCase")]
pub enum RepoAction {
    CheckAccess(CheckAccess),
    Fetch(NoParams),
    Pull(PullRequest),
    Push(PushRequest),
    Undo(NoParams),
    Redo(NoParams),
    ContinueOperation(NoParams),
    AbortOperation(NoParams),
    Stage(PathsRequest),
    Unstage(PathsRequest),
    Commit(CommitRequest),
    Checkout(CheckoutRequest),
    CheckoutPreview(CheckoutRequest),
    CreateBranch(CreateBranch),
    Stash(StashPush),
    StashApplyAt(StashAt),
    StashPopAt(StashAt),
    StashDrop(StashAt),
    RevertToPreview(HashRequest),
    GetConflict(ConflictRequest),
    SaveResolution(SaveResolution),
    ResolveWhole(ResolveWhole),
    MarkResolved(MarkResolved),
    RevertTo(RevertTo),
    CheckoutCommit(HashRequest),
    CreateTag(CreateTag),
    DeleteTag(DeleteTag),
    DeleteRemoteBranch(DeleteRemoteBranch),
    RenameBranch(RenameBranch),
    DeleteBranch(DeleteBranch),
    CherryPick(HashRequest),
    Revert(HashRequest),
    Reset(ResetRequest),
    Merge(RefRequest),
    Rebase(RefRequest),
    RebaseApply(RebaseApply),
    RebaseStart(RebaseRequest),
    RestoreFile(RestoreFile),
    RestoreFromStash(RestoreFromStash),
    ApplyHunks(ApplyHunks),
    MergeInto(MergeInto),
    CherryPickInto(CherryPickInto),
    UpdateBranch(UpdateBranch),
    FastForward(FastForward),
    GitRaw(GitRaw),
    DiscardAll(NoParams),
    StashPop(NoParams),
}

impl RepoAction {
    /// Разбор имени и параметров. Неизвестное имя — `BAD_ARGS`, как `runAction`.
    pub fn parse(name: &str, payload: Value) -> Result<Self> {
        let payload = if payload.is_null() { json!({}) } else { payload };
        serde_json::from_value(json!({ "name": name, "payload": payload })).map_err(|error| {
            if error.to_string().contains("unknown variant") {
                return GorynychError::new(ErrorCode::BadArgs, t("Неизвестное действие: {0}", &[&name]));
            }
            GorynychError::new(ErrorCode::BadArgs, error.to_string())
        })
    }
}

/// Результат `checkoutPreview`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CheckoutPreview {
    pub wip: Option<WipConflict>,
}

/// Результат `undo` и `redo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct HistoryLabel {
    pub label: String,
}

/// Результат `restoreFile`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FileRestored {
    pub path: String,
    pub deleted: bool,
    pub side: String,
    pub undoable: bool,
}

/// Результат `restoreFromStash`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct StashFilesRestored {
    #[specta(type = f64)]
    pub files: usize,
    #[specta(type = f64)]
    pub changed: usize,
    pub undoable: bool,
}

/// Результат `applyHunks`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct HunksApplied {
    pub op: String,
    pub path: String,
    #[specta(type = f64)]
    pub hunks: usize,
    #[specta(type = f64)]
    pub total: usize,
    pub undoable: bool,
}

/// Результат действия. На проводе — сама структура, как в 1.x.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(untagged)]
pub enum ActionOutput {
    Access(AccessInfo),
    Fetch(FetchResult),
    Pull(PullResult),
    Push(PushResult),
    Label(HistoryLabel),
    Operation(OperationResult),
    Text(String),
    Commit(CommitResult),
    Checkout(Box<Checkout>),
    CheckoutPreview(CheckoutPreview),
    BranchCreated(BranchCreated),
    StashPushed(StashPushed),
    StashRef(StashRef),
    StashPopped(StashPopped),
    RevertPreview(RevertPreview),
    Conflict(ConflictInfo),
    Resolved(ResolveResult),
    RevertedTo(RevertedTo),
    Tag(TagInfo),
    RemoteBranchDeleted(RemoteBranchDeleted),
    BranchRenamed(BranchRenamed),
    BranchDeleted(BranchDeleted),
    HeadMoved(HeadMoved),
    Reset(ResetResult),
    RefMoved(RefMoved),
    Rebase(RebaseDone),
    FileRestored(FileRestored),
    StashFilesRestored(StashFilesRestored),
    HunksApplied(HunksApplied),
    BranchUpdated(BranchUpdated),
    FastForwarded(FastForwarded),
    GitRaw(GitRawResult),
    Discarded(Discarded),
}

#[derive(Clone)]
struct Pending {
    from: String,
    label: String,
}

#[derive(Default)]
struct Activity {
    busy: HashMap<PathBuf, usize>,
    background: HashMap<PathBuf, watch::Receiver<bool>>,
}

/// Исполнитель действий. Один на приложение; состояние разделено по репозиториям.
pub struct RepoEngine {
    db: Arc<Db>,
    network: Network,
    rebase: RebaseSessions,
    /// Операции, остановившиеся на конфликте.
    pending: Mutex<HashMap<PathBuf, Pending>>,
    activity: Arc<Mutex<Activity>>,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn repo_key(cwd: &Path) -> String {
    cwd.to_string_lossy().into_owned()
}

/// Снимает отметку занятости, даже если действие бросили на полпути.
struct BusyGuard {
    activity: Arc<Mutex<Activity>>,
    cwd: PathBuf,
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        let mut activity = locked(&self.activity);
        let count = activity.busy.get(&self.cwd).copied().unwrap_or(1) - 1;
        if count > 0 {
            activity.busy.insert(self.cwd.clone(), count);
        } else {
            activity.busy.remove(&self.cwd);
        }
    }
}

/// Снимает отметку фоновой задачи и будит тех, кто её ждёт.
struct BackgroundGuard {
    activity: Arc<Mutex<Activity>>,
    cwd: PathBuf,
    done: watch::Sender<bool>,
}

impl Drop for BackgroundGuard {
    fn drop(&mut self) {
        locked(&self.activity).background.remove(&self.cwd);
        let _ = self.done.send(true);
    }
}

impl RepoEngine {
    /// `editor_helper` — исполняемый файл, вызывающий `rebase::run_editor_helper` в начале `main`.
    pub fn new(db: Arc<Db>, network: Network, editor_helper: impl Into<PathBuf>) -> Self {
        Self { db, network, rebase: RebaseSessions::new(editor_helper), pending: Mutex::default(), activity: Arc::default() }
    }

    /// Учётные данные и окружение сетевых команд.
    pub fn network(&self) -> &Network {
        &self.network
    }

    /// `historySummary`.
    pub fn history_summary(&self, cwd: &Path) -> Result<HistorySummary> {
        self.db.history_summary(&repo_key(cwd))
    }

    /// `isBusy`.
    pub fn is_busy(&self, cwd: &Path) -> bool {
        locked(&self.activity).busy.get(cwd).is_some_and(|count| *count > 0)
    }

    /// `runBackground`: задача, если репозиторий свободен, иначе `None`. Занятость отмечается сразу, а работа начинается при первом опросе.
    pub fn run_background<T, F: Future<Output = T>>(&self, cwd: &Path, work: F) -> Option<impl Future<Output = T> + use<T, F>> {
        let (done, wait) = watch::channel(false);
        {
            let mut activity = locked(&self.activity);
            if activity.busy.get(cwd).is_some_and(|count| *count > 0) || activity.background.contains_key(cwd) {
                return None;
            }
            activity.background.insert(cwd.to_path_buf(), wait);
        }
        let guard = BackgroundGuard { activity: Arc::clone(&self.activity), cwd: cwd.to_path_buf(), done };
        Some(async move {
            let _guard = guard;
            work.await
        })
    }

    /// `runAction`.
    pub async fn run(&self, cwd: &Path, action: RepoAction) -> Result<ActionOutput> {
        let background = {
            let mut activity = locked(&self.activity);
            *activity.busy.entry(cwd.to_path_buf()).or_insert(0) += 1;
            activity.background.get(cwd).cloned()
        };
        let _busy = BusyGuard { activity: Arc::clone(&self.activity), cwd: cwd.to_path_buf() };
        if let Some(mut done) = background {
            let _ = done.wait_for(|finished| *finished).await;
        }
        // В куче: состояние всех действий занимает мегабайты и переполнило бы стек потока
        Box::pin(self.dispatch(cwd, action)).await
    }

    async fn store<R: Send + 'static>(&self, work: impl FnOnce(&Db) -> Result<R> + Send + 'static) -> Result<R> {
        let db = Arc::clone(&self.db);
        tokio::task::spawn_blocking(move || work(&db)).await.map_err(GorynychError::unknown)?
    }

    /// `record`. Сбой базы не отменяет уже сделанную операцию git.
    async fn record_with_blobs(&self, cwd: &Path, entry: &Entry, label: &str, blobs: Vec<Vec<u8>>) {
        let Ok(payload) = serde_json::to_string(entry) else {
            return;
        };
        let (repo, kind, label) = (repo_key(cwd), entry.kind(), label.to_owned());
        let _ = self
            .store(move |db| {
                let slices: Vec<&[u8]> = blobs.iter().map(Vec::as_slice).collect();
                db.record_undo(&repo, NewUndoEntry { kind: &kind, label: &label, payload: &payload, blobs: &slices })
            })
            .await;
    }

    async fn record(&self, cwd: &Path, entry: Entry, label: &str) {
        self.record_with_blobs(cwd, &entry, label, Vec::new()).await;
    }

    async fn clear_redo(&self, cwd: &Path) {
        let repo = repo_key(cwd);
        let _ = self.store(move |db| db.clear_redo(&repo)).await;
    }

    fn decode(top: &UndoEntry) -> Result<Entry> {
        serde_json::from_str(&top.payload).map_err(|error| GorynychError::new(ErrorCode::HistoryStale, error.to_string()))
    }

    async fn undo(&self, cwd: &Path) -> Result<HistoryLabel> {
        let repo = repo_key(cwd);
        let Some(top) = self.store(move |db| db.top_undo(&repo)).await? else {
            return Err(GorynychError::new(ErrorCode::HistoryEmpty, t("Нечего отменять", &[])));
        };
        state::require_no_operation(&current_state(cwd).await?, "undo")?;
        history::undo(&self.network, cwd, &Self::decode(&top)?, &top.blobs).await?;
        let id = top.id;
        self.store(move |db| db.complete_undo(id, None)).await?;
        Ok(HistoryLabel { label: top.label })
    }

    async fn redo(&self, cwd: &Path) -> Result<HistoryLabel> {
        let repo = repo_key(cwd);
        let Some(top) = self.store(move |db| db.top_redo(&repo)).await? else {
            return Err(GorynychError::new(ErrorCode::HistoryEmpty, t("Нечего повторять", &[])));
        };
        state::require_no_operation(&current_state(cwd).await?, "redo")?;
        let mut entry = Self::decode(&top)?;
        history::redo(&self.network, cwd, &mut entry, &top.blobs).await?;
        let payload = serde_json::to_string(&entry).map_err(GorynychError::unknown)?;
        let id = top.id;
        self.store(move |db| db.complete_redo(id, Some(&payload))).await?;
        Ok(HistoryLabel { label: top.label })
    }

    /// `trackConflicts`: если операция встала на конфликте, запоминаем исходный HEAD.
    async fn track<T>(&self, cwd: &Path, label: &str, work: impl Future<Output = Result<T>>) -> Result<T> {
        let from = head_hash(cwd).await;
        let result = work.await;
        if let (Err(error), Some(from)) = (&result, from)
            && error.code == ErrorCode::Conflict
        {
            locked(&self.pending).insert(cwd.to_path_buf(), Pending { from, label: label.to_owned() });
        }
        result
    }

    async fn checkout_action(&self, cwd: &Path, request: &CheckoutRequest) -> Result<Checkout> {
        let (kind, mut result) = checkout_with_strategy(cwd, request).await?;
        if result.previous.branch != result.to.branch || result.created.is_some() {
            let label = format!("Checkout {}", result.to.label());
            let (previous, to, created) = (result.previous.clone(), result.to.clone(), result.created.clone());
            match kind {
                CheckoutKind::Smart => self.record(cwd, Entry::SmartCheckout { previous, to, created }, &label).await,
                CheckoutKind::Move => {
                    let label = t("Checkout {0} с переносом изменений", &[&result.to.label()]);
                    self.record(cwd, Entry::MoveCheckout { previous, to, created }, &label).await;
                }
                CheckoutKind::Discard => {
                    let backup = result.discarded.as_ref().map(|discarded| discarded.backup.clone());
                    let label = t("Checkout {0} без изменений", &[&result.to.label()]);
                    self.record(cwd, Entry::DiscardCheckout { previous, to, created, backup }, &label).await;
                }
                CheckoutKind::Plain => self.record(cwd, Entry::Checkout { previous, to, created }, &label).await,
            }
        }
        // Новый HEAD: чтобы интерфейс сразу выделил коммит и прокрутил к нему
        let head = quiet(cwd, &["rev-parse", "HEAD"]).await;
        result.head = (!head.is_empty()).then_some(head);
        result.strategy = match kind {
            CheckoutKind::Plain => None,
            CheckoutKind::Smart => Some("smart".to_owned()),
            CheckoutKind::Move => Some("move".to_owned()),
            CheckoutKind::Discard => Some("discard".to_owned()),
        };
        Ok(result)
    }

    async fn merge_action(&self, cwd: &Path, request: &RefRequest) -> Result<RefMoved> {
        let label = format!("Merge {}", or_undefined(request.reference.as_deref()));
        let result = self.track(cwd, &label, ops::merge_ref(cwd, request)).await?;
        self.record(cwd, Entry::HeadMove { from: result.from.clone(), to: result.to.clone() }, &label).await;
        Ok(result)
    }

    async fn cherry_pick_action(&self, cwd: &Path, request: &HashRequest) -> Result<HeadMoved> {
        let label = format!("Cherry-pick {}", short(or_undefined(request.hash.as_deref())));
        let result = self.track(cwd, &label, ops::cherry_pick(cwd, request)).await?;
        self.record(cwd, Entry::HeadMove { from: result.from.clone(), to: result.to.clone() }, &label).await;
        Ok(result)
    }

    /// Перетаскивание на ветку: при необходимости переключиться на неё.
    async fn switch_for_drop(&self, cwd: &Path, target: Option<&String>, smart: Option<bool>) -> Result<()> {
        if current_state(cwd).await?.branch_name.as_ref() != target {
            self.checkout_action(cwd, &CheckoutRequest { branch: target.cloned(), smart, ..CheckoutRequest::default() }).await?;
        }
        Ok(())
    }

    async fn continue_action(&self, cwd: &Path) -> Result<OperationResult> {
        let result = ops::continue_operation(cwd, self.rebase.continue_env(cwd)).await?;
        if result.finished == Some(true) {
            // Операция с конфликтами завершена: теперь её можно отменить целиком
            let mut pending = locked(&self.pending).remove(cwd);
            if pending.is_none() && (result.operation == "merge" || result.operation == "rebase") {
                let orig = quiet(cwd, &["rev-parse", "--verify", "--quiet", "ORIG_HEAD"]).await;
                if !orig.is_empty() {
                    pending = Some(Pending { from: orig, label: if result.operation == "merge" { "Merge".to_owned() } else { "Rebase".to_owned() } });
                }
            }
            self.rebase.cleanup(cwd);
            let to = head_hash(cwd).await;
            if let Some(pending) = pending.filter(|pending| Some(&pending.from) != to.as_ref()) {
                let label = t("{0} (с решением конфликтов)", &[&pending.label]);
                self.record(cwd, Entry::HeadMove { from: Some(pending.from), to }, &label).await;
            }
        }
        Ok(result)
    }

    #[allow(clippy::too_many_lines, reason = "список действий: как таблица ACTIONS в 1.x")]
    async fn dispatch(&self, cwd: &Path, action: RepoAction) -> Result<ActionOutput> {
        use ActionOutput as Out;
        Ok(match action {
            RepoAction::CheckAccess(request) => Out::Access(check_access(&self.network, cwd, request.write != Some(false)).await?),
            RepoAction::Fetch(_) => Out::Fetch(remote::fetch_all(&self.network, cwd).await?),
            RepoAction::Pull(request) => Out::Pull(self.track(cwd, "Pull", remote::pull(&self.network, cwd, &request)).await?),
            RepoAction::Push(request) => Out::Push(remote::push(&self.network, cwd, &request).await?),
            RepoAction::Undo(_) => Out::Label(self.undo(cwd).await?),
            RepoAction::Redo(_) => Out::Label(self.redo(cwd).await?),
            RepoAction::ContinueOperation(_) => Out::Operation(self.continue_action(cwd).await?),
            RepoAction::AbortOperation(_) => {
                locked(&self.pending).remove(cwd);
                self.rebase.cleanup(cwd);
                Out::Operation(ops::abort_operation(cwd).await?)
            }
            RepoAction::Stage(request) => Out::Text(stage(cwd, &request.paths.unwrap_or(PathsArg::Invalid)).await?),
            RepoAction::Unstage(request) => Out::Text(unstage(cwd, &request.paths.unwrap_or(PathsArg::Invalid)).await?),
            RepoAction::Commit(request) => {
                let result = commit(cwd, request.summary.as_deref().unwrap_or_default(), request.description.as_deref()).await?;
                self.record(cwd, Entry::Commit { hash: result.hash.clone(), parent: result.parent.clone() }, &format!("Commit «{}»", result.summary)).await;
                Out::Commit(result)
            }
            RepoAction::Checkout(request) => Out::Checkout(Box::new(self.checkout_action(cwd, &request).await?)),
            RepoAction::CheckoutPreview(request) => Out::CheckoutPreview(CheckoutPreview { wip: inspect_wip(cwd, &request.target()).await? }),
            RepoAction::CreateBranch(request) => {
                let result = ops::create_branch(cwd, &request).await?;
                let entry = Entry::Branch { name: result.name.clone(), hash: result.hash.clone(), checked_out: result.checked_out, previous: result.previous.clone() };
                let label = t("Создание ветки {0}", &[&result.name]);
                self.record(cwd, entry, &label).await;
                Out::BranchCreated(result)
            }
            RepoAction::Stash(request) => {
                let result = ops::stash_push(cwd, request.message.as_deref()).await?;
                self.record(cwd, Entry::Stash { hash: result.hash.clone(), message: request.message }, "Stash").await;
                Out::StashPushed(result)
            }
            RepoAction::StashApplyAt(request) => {
                let result = ops::stash_apply_at(cwd, &request).await?;
                self.clear_redo(cwd).await;
                Out::StashRef(result)
            }
            RepoAction::StashPopAt(request) => {
                let result = ops::stash_pop_at(cwd, &request).await?;
                self.clear_redo(cwd).await;
                Out::StashRef(result)
            }
            RepoAction::StashDrop(request) => {
                let result = ops::stash_drop_at(cwd, &request).await?;
                let label = t("Удаление {0}", &[&result.id]);
                self.record(cwd, Entry::StashDrop { hash: result.hash.clone(), message: result.message.clone() }, &label).await;
                Out::StashRef(result)
            }
            RepoAction::RevertToPreview(request) => Out::RevertPreview(ops::revert_to_preview(cwd, &request).await?),
            RepoAction::GetConflict(request) => Out::Conflict(get_conflict(cwd, request.path.as_deref().unwrap_or_default()).await?),
            RepoAction::SaveResolution(request) => Out::Resolved(save_resolution(cwd, &request).await?),
            RepoAction::ResolveWhole(request) => Out::Resolved(resolve_whole(cwd, &request).await?),
            RepoAction::MarkResolved(request) => Out::Resolved(mark_resolved(cwd, &request).await?),
            RepoAction::RevertTo(request) => {
                let result = ops::revert_to(cwd, &request).await?;
                let label = t("Возврат к {0}", &[&short(&result.hash)]);
                self.record(cwd, Entry::HeadMove { from: Some(result.from.clone()), to: Some(result.to.clone()) }, &label).await;
                Out::RevertedTo(result)
            }
            RepoAction::CheckoutCommit(request) => {
                let hash = require_hash(request.hash.as_deref())?;
                let result = checkout_commit(cwd, hash).await?;
                let entry = Entry::Checkout { previous: result.previous.clone(), to: result.to.clone(), created: None };
                self.record(cwd, entry, &format!("Checkout {}", short(hash))).await;
                Out::Checkout(Box::new(result))
            }
            RepoAction::CreateTag(request) => {
                let result = ops::create_tag(cwd, &request).await?;
                let label = t("Тег {0}", &[&result.name]);
                self.record(cwd, Entry::Tag { name: result.name.clone(), hash: result.hash.clone(), message: result.message.clone() }, &label).await;
                Out::Tag(result)
            }
            RepoAction::DeleteTag(request) => {
                let result = ops::delete_tag(cwd, &request).await?;
                let label = t("Удаление тега {0}", &[&result.name]);
                self.record(cwd, Entry::DeleteTag { name: result.name.clone(), hash: result.hash.clone(), message: result.message.clone() }, &label).await;
                Out::Tag(result)
            }
            RepoAction::DeleteRemoteBranch(request) => {
                let result = remote::delete_remote_branch(&self.network, cwd, &request).await?;
                let entry = Entry::DeleteRemoteBranch { remote: result.remote.clone(), branch: result.branch.clone(), hash: result.hash.clone() };
                let label = t("Удаление {0}/{1} с сервера", &[&result.remote, &result.branch]);
                self.record(cwd, entry, &label).await;
                Out::RemoteBranchDeleted(result)
            }
            RepoAction::RenameBranch(request) => {
                let result = ops::rename_branch(cwd, &request).await?;
                let label = t("Переименование {0} → {1}", &[&result.from, &result.to]);
                self.record(cwd, Entry::RenameBranch { from: result.from.clone(), to: result.to.clone() }, &label).await;
                Out::BranchRenamed(result)
            }
            RepoAction::DeleteBranch(request) => {
                let result = ops::delete_branch(cwd, &request).await?;
                let label = t("Удаление ветки {0}", &[&result.name]);
                self.record(cwd, Entry::DeleteBranch { name: result.name.clone(), hash: result.hash.clone() }, &label).await;
                Out::BranchDeleted(result)
            }
            RepoAction::CherryPick(request) => Out::HeadMoved(self.cherry_pick_action(cwd, &request).await?),
            RepoAction::Revert(request) => {
                let label = format!("Revert {}", short(or_undefined(request.hash.as_deref())));
                let result = self.track(cwd, &label, ops::revert_commit(cwd, &request)).await?;
                self.record(cwd, Entry::HeadMove { from: result.from.clone(), to: result.to.clone() }, &label).await;
                Out::HeadMoved(result)
            }
            RepoAction::Reset(request) => {
                let result = ops::reset_to(cwd, &request).await?;
                if result.from != result.to {
                    let label = format!("Reset --{} → {}", result.mode, short(&result.hash));
                    self.record(cwd, Entry::Reset { mode: result.mode.clone(), from: result.from.clone(), to: result.to.clone() }, &label).await;
                }
                Out::Reset(result)
            }
            RepoAction::Merge(request) => Out::RefMoved(self.merge_action(cwd, &request).await?),
            RepoAction::Rebase(request) => {
                let label = t("Rebase на {0}", &[&request.reference.as_deref().unwrap_or_default()]);
                let result = self.track(cwd, &label, ops::rebase_onto(cwd, &request)).await?;
                self.record(cwd, Entry::HeadMove { from: result.from.clone(), to: result.to.clone() }, &label).await;
                Out::RefMoved(result)
            }
            RepoAction::RebaseApply(request) => {
                let result = crate::rebase::apply(cwd, &request).await?;
                self.record(cwd, Entry::HeadMove { from: Some(result.from.clone()), to: result.to.clone() }, &format!("Rebase {}", result.branch)).await;
                Out::Rebase(result)
            }
            RepoAction::RebaseStart(request) => {
                let result = self.track(cwd, "Rebase", self.rebase.start(cwd, &request)).await?;
                if Some(&result.from) != result.to.as_ref() {
                    self.record(cwd, Entry::HeadMove { from: Some(result.from.clone()), to: result.to.clone() }, &format!("Rebase {}", result.branch)).await;
                }
                Out::Rebase(result)
            }
            RepoAction::RestoreFile(request) => {
                let result = restore_file(cwd, &request).await?;
                let undoable = result.snapshot.is_some();
                if let Some(snapshot) = result.snapshot {
                    let what = if request.side.as_deref() == Some("before") { t("до", &[]) } else { t("из", &[]) };
                    let label = t("Файл {0} → версия {1} {2}", &[&result.path, &what, &short(or_undefined(request.hash.as_deref()))]);
                    let (entry, blobs) = Entry::from_snapshots(vec![snapshot]);
                    self.record_with_blobs(cwd, &entry, &label, blobs).await;
                } else {
                    self.clear_redo(cwd).await;
                }
                Out::FileRestored(FileRestored { path: result.path, deleted: result.deleted, side: result.side, undoable })
            }
            RepoAction::RestoreFromStash(request) => {
                let result = restore_from_stash(cwd, &request).await?;
                if !result.snapshots.is_empty() {
                    let unit = if result.changed == 1 { t("файл", &[]) } else { t("файлов", &[]) };
                    let label = t("Из {0}: {1} {2}", &[&request.id.as_deref().unwrap_or("stash"), &result.changed, &unit]);
                    let (entry, blobs) = Entry::from_snapshots(result.snapshots);
                    self.record_with_blobs(cwd, &entry, &label, blobs).await;
                }
                Out::StashFilesRestored(StashFilesRestored { files: result.files, changed: result.changed, undoable: result.complete })
            }
            RepoAction::ApplyHunks(request) => {
                let result = apply_hunks(cwd, &request).await?;
                let kind = match result.op.as_str() {
                    "revert" => Some(t("Откат фрагмента коммита", &[])),
                    "discard" => Some(t("Удаление правок", &[])),
                    "apply" => Some(t("Фрагмент из stash", &[])),
                    _ => None,
                };
                let undoable = result.snapshot.is_some();
                if let Some(snapshot) = result.snapshot {
                    let label = t("{0} в {1}", &[&kind.unwrap_or_else(|| "undefined".to_owned()), &result.path]);
                    let (entry, blobs) = Entry::from_snapshots(vec![snapshot]);
                    self.record_with_blobs(cwd, &entry, &label, blobs).await;
                } else if kind.is_some() {
                    self.clear_redo(cwd).await;
                }
                Out::HunksApplied(HunksApplied { op: result.op, path: result.path, hunks: result.hunks, total: result.total, undoable })
            }
            RepoAction::MergeInto(request) => {
                self.switch_for_drop(cwd, request.target.as_ref(), request.smart).await?;
                Out::RefMoved(self.merge_action(cwd, &RefRequest { reference: request.reference }).await?)
            }
            RepoAction::CherryPickInto(request) => {
                self.switch_for_drop(cwd, request.target.as_ref(), request.smart).await?;
                Out::HeadMoved(self.cherry_pick_action(cwd, &HashRequest { hash: request.hash }).await?)
            }
            RepoAction::UpdateBranch(request) => {
                let result = remote::update_branch(&self.network, cwd, &request).await?;
                if Some(&result.from) != result.to.as_ref() {
                    let label = t("Обновление {0}", &[&result.branch]);
                    self.record(cwd, Entry::BranchMove { branch: result.branch.clone(), from: result.from.clone(), to: result.to.clone() }, &label).await;
                }
                Out::BranchUpdated(result)
            }
            RepoAction::FastForward(request) => {
                let result = ops::fast_forward(cwd, &request).await?;
                self.record(cwd, Entry::BranchMove { branch: result.branch.clone(), from: result.from.clone(), to: Some(result.to.clone()) }, &format!("Fast-forward {}", result.branch)).await;
                Out::FastForwarded(result)
            }
            RepoAction::GitRaw(request) => {
                let result = ops::git_raw(cwd, &request).await?;
                self.clear_redo(cwd).await;
                Out::GitRaw(result)
            }
            RepoAction::DiscardAll(_) => {
                let result = ops::discard_all(cwd).await?;
                self.clear_redo(cwd).await;
                Out::Discarded(result)
            }
            RepoAction::StashPop(_) => {
                let result = ops::stash_pop(cwd).await?;
                self.clear_redo(cwd).await;
                Out::StashPopped(result)
            }
        })
    }
}
