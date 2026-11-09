//! Лёгкая фоновая проверка сервера: «изменилось ли что-нибудь?» — и fetch только если да. Перенос `electron/remoteWatch.cjs`.
//!
//! ## Конспект
//! 1. Хэши веток на сервере: API GitLab с ETag (если есть токен) или `git ls-remote --heads --tags`.
//! 2. Сравнение с локальными `refs/remotes/<remote>/*` и тегами. Только новые теги: изменённый на сервере тег Git без `--force` не заберёт, а свои локальные теги — не «удалённые».
//! 3. Только при расхождении — `git fetch --prune <remote>`. То же расхождение, что после прошлого fetch, не вызывает нового: сервер не опрашивается по кругу.
//!
//! - Ничего не пишет в `.git`, пока сервер не изменился, и не запускается вместе с действием пользователя. Есть `index.lock` — внешний git что-то делает, не мешаем.
//! - Фоновые команды без окон входа: `GCM_INTERACTIVE=never`, пустые `GIT_ASKPASS` и `SSH_ASKPASS`.
//! - `RATE_LIMIT` и `NETWORK` от API — ошибка тика; прочие ошибки API выключают его на 10 минут, дальше через git.
//! - Ошибки не бросаются: `status: error`. Паузу между тиками (15 с → 5 мин) решает интерфейс (`src/lib/syncStatus.js`), как и в 1.x.
//!
//! ## Отличия от плана
//! API GitLab подключается трейтом [`BranchHeadsApi`]: граф зависимостей `git ← watcher` и `cicd` раздельны, реализацию даёт `gorynych-tauri`. Цифры паузы в плане (60 с → 10 мин) не совпадают с 1.x (15 с → 5 мин): оставлено как в 1.x.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::js;
use gorynych_git::actions::RepoEngine;
use gorynych_git::network::NetOptions;
use gorynych_git::run::{git, git_with, FS};
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::Serialize;

const LS_REMOTE_TIMEOUT: Duration = Duration::from_secs(8);
const FETCH_TIMEOUT: Duration = Duration::from_secs(2 * 60);
const API_COOLDOWN: Duration = Duration::from_secs(10 * 60);
const MAX_REMOTES: usize = 3;

static CLOBBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)would clobber existing tag|\[rejected\].*\(would clobber").expect("корректный шаблон"));

/// Хэши веток через API хостинга.
#[async_trait]
pub trait BranchHeadsApi: Send + Sync {
    /// Ветка → хэш. `None` — токена нет, проверка идёт через `ls-remote`.
    async fn branch_heads(&self, root: &Path, remote: &str) -> Result<Option<IndexMap<String, String>>>;

    /// Сколько секунд просит подождать сервер.
    fn retry_after(&self, _error: &GorynychError) -> Option<u64> {
        None
    }
}

/// Что сервер сообщил о ветках и тегах.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerRefs {
    pub heads: IndexMap<String, String>,
    pub tags: Option<IndexMap<String, String>>,
}

/// `parseLsRemote`.
pub fn parse_ls_remote(out: &str) -> ServerRefs {
    let (mut heads, mut tags) = (IndexMap::new(), IndexMap::new());
    for line in out.split('\n') {
        let Some((hash, reference)) = line.split_once('\t') else {
            continue;
        };
        let (hash, reference) = (js::trim(hash), js::trim(reference));
        if let Some(name) = reference.strip_prefix("refs/heads/") {
            heads.insert(name.to_owned(), hash.to_owned());
        } else if let Some(name) = reference.strip_prefix("refs/tags/").filter(|name| !name.ends_with("^{}")) {
            tags.insert(name.to_owned(), hash.to_owned());
        }
    }
    ServerRefs { heads, tags: Some(tags) }
}

/// Локальное состояние remote.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalRefs {
    pub heads: IndexMap<String, String>,
    pub tags: HashSet<String>,
}

/// Расхождение с сервером.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteChanges {
    pub updated: Vec<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub tags: Vec<String>,
}

impl RemoteChanges {
    fn is_empty(&self) -> bool {
        self.updated.is_empty() && self.added.is_empty() && self.removed.is_empty() && self.tags.is_empty()
    }
}

/// `diff`.
pub fn diff(server: &ServerRefs, local: &LocalRefs) -> RemoteChanges {
    let mut changes = RemoteChanges::default();
    for (name, hash) in &server.heads {
        match local.heads.get(name) {
            None => changes.added.push(name.clone()),
            Some(mine) if mine != hash => changes.updated.push(name.clone()),
            Some(_) => {}
        }
    }
    changes.removed = local.heads.keys().filter(|name| !server.heads.contains_key(*name)).cloned().collect();
    if let Some(tags) = &server.tags {
        changes.tags = tags.keys().filter(|name| !local.tags.contains(*name)).cloned().collect();
    }
    changes
}

async fn local_state(root: &Path, remote: &str) -> Result<LocalRefs> {
    let prefix = format!("refs/remotes/{remote}/");
    let out = git(root, &["for-each-ref", &format!("--format=%(objectname){FS}%(refname)"), &prefix, "refs/tags/"]).await?;
    let mut local = LocalRefs::default();
    for line in out.split('\n').filter(|line| !line.is_empty()) {
        let mut fields = line.split(FS);
        let (hash, reference) = (fields.next().unwrap_or_default(), fields.next().unwrap_or_default());
        if let Some(name) = reference.strip_prefix(&prefix) {
            if name != "HEAD" {
                local.heads.insert(name.to_owned(), hash.to_owned());
            }
        } else if let Some(name) = reference.strip_prefix("refs/tags/") {
            local.tags.insert(name.to_owned());
        }
    }
    Ok(local)
}

/// Какие remote проверять: за которыми следят локальные ветки, плюс origin.
async fn remotes_to_check(root: &Path) -> Result<Vec<String>> {
    let out = git(root, &["remote"]).await?;
    let all: Vec<&str> = out.split('\n').filter(|name| !name.is_empty()).collect();
    if all.is_empty() {
        return Ok(Vec::new());
    }
    let tracked = git(root, &["for-each-ref", "--format=%(upstream:remotename)", "refs/heads"]).await?;
    let mut order: IndexSet<&str> = tracked.split('\n').filter(|name| !name.is_empty() && all.contains(name)).collect();
    if all.contains(&"origin") {
        order.insert("origin");
    }
    order.insert(all[0]);
    Ok(order.into_iter().take(MAX_REMOTES).map(str::to_owned).collect())
}

struct RemoteResult {
    remote: String,
    via: &'static str,
    changes: RemoteChanges,
    fetched: bool,
}

/// Ошибка тика.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct LightError {
    pub code: ErrorCode,
    pub message: String,
}

/// Результат тика.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LightCheck {
    pub status: String,
    pub reason: Option<String>,
    pub fetched: Option<bool>,
    pub via: Option<String>,
    pub remotes: Option<Vec<String>>,
    pub changes: Option<RemoteChanges>,
    pub error: Option<LightError>,
    #[specta(type = Option<f64>)]
    pub retry_after: Option<u64>,
    #[specta(type = f64)]
    pub ms: u64,
}

fn skipped(reason: &str) -> LightCheck {
    LightCheck { status: "skipped".to_owned(), reason: Some(reason.to_owned()), ..LightCheck::default() }
}

#[derive(Default)]
struct WatchState {
    git_dirs: HashMap<PathBuf, PathBuf>,
    api_off: HashMap<(PathBuf, String), Instant>,
    last_sig: HashMap<(PathBuf, String), RemoteChanges>,
}

/// Фоновая проверка сервера. Одна на приложение.
pub struct RemoteRepoWatcher {
    engine: Arc<RepoEngine>,
    api: Option<Arc<dyn BranchHeadsApi>>,
    state: Mutex<WatchState>,
}

impl RemoteRepoWatcher {
    pub fn new(engine: Arc<RepoEngine>, api: Option<Arc<dyn BranchHeadsApi>>) -> Self {
        Self { engine, api, state: Mutex::default() }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, WatchState> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Окружение фоновых сетевых команд: никаких окон входа и вопросов. Сессия секретов живёт вместе с результатом.
    async fn quiet_env(&self, root: &Path, timeout: Duration) -> NetOptions {
        let mut net = self.engine.network().options(root, None).await;
        net.options.env.extend([("GCM_INTERACTIVE", "never"), ("GIT_ASKPASS", ""), ("SSH_ASKPASS", "")].map(|(key, value)| (key.to_owned(), value.to_owned())));
        net.options.timeout = Some(timeout);
        net
    }

    async fn git_dir(&self, root: &Path) -> Result<PathBuf> {
        if let Some(dir) = self.state().git_dirs.get(root) {
            return Ok(dir.clone());
        }
        let out = git(root, &["rev-parse", "--absolute-git-dir"]).await?;
        let dir = PathBuf::from(js::trim(&out));
        self.state().git_dirs.insert(root.to_path_buf(), dir.clone());
        Ok(dir)
    }

    async fn server_state(&self, root: &Path, remote: &str) -> Result<(ServerRefs, &'static str)> {
        let key = (root.to_path_buf(), remote.to_owned());
        let cooling = self.state().api_off.get(&key).is_some_and(|until| *until >= Instant::now());
        if let (Some(api), false) = (&self.api, cooling) {
            match api.branch_heads(root, remote).await {
                Ok(Some(heads)) => return Ok((ServerRefs { heads, tags: None }, "api")),
                Ok(None) => {}
                Err(error) if matches!(error.code, ErrorCode::RateLimit | ErrorCode::Network) => return Err(error),
                // Токен не подходит: дальше через git
                Err(_) => {
                    self.state().api_off.insert(key, Instant::now() + API_COOLDOWN);
                }
            }
        }
        let net = self.quiet_env(root, LS_REMOTE_TIMEOUT).await;
        let out = git_with(root, &["ls-remote", "--heads", "--tags", remote], net.options.clone()).await?;
        Ok((parse_ls_remote(&out), "ls-remote"))
    }

    async fn check_remote(&self, root: &Path, remote: &str) -> Result<RemoteResult> {
        // Сервер и локальные ссылки — одновременно: ответ сервера ждём, а процесс git для своих ссылок можно запустить сразу
        let (server, local) = tokio::join!(self.server_state(root, remote), local_state(root, remote));
        let (server, via) = server?;
        let changes = diff(&server, &local?);
        let key = (root.to_path_buf(), remote.to_owned());
        let result = |changes: RemoteChanges, fetched: bool| RemoteResult { remote: remote.to_owned(), via, changes, fetched };
        if changes.is_empty() {
            self.state().last_sig.remove(&key);
            return Ok(result(changes, false));
        }
        // То же расхождение, что после прошлого fetch: не опрашиваем сервер по кругу
        if self.state().last_sig.get(&key) == Some(&changes) {
            return Ok(result(changes, false));
        }
        let mut args = vec!["fetch", "--prune"];
        if !changes.tags.is_empty() {
            args.push("--tags");
        }
        args.push(remote);
        let net = self.quiet_env(root, FETCH_TIMEOUT).await;
        if let Err(error) = git_with(root, &args, net.options.clone()).await {
            // Ветки уже скачаны, ругается только на изменённый тег: это не ошибка связи
            if !CLOBBER.is_match(&error.details) {
                return Err(error);
            }
        }
        let after = diff(&server, &local_state(root, remote).await?);
        if after.is_empty() {
            self.state().last_sig.remove(&key);
        } else {
            self.state().last_sig.insert(key, after);
        }
        Ok(result(changes, true))
    }

    async fn check_all(&self, root: &Path) -> Result<Vec<RemoteResult>> {
        let mut results = Vec::new();
        for remote in remotes_to_check(root).await? {
            results.push(self.check_remote(root, &remote).await?);
        }
        Ok(results)
    }

    /// `lightCheck`: один тик. Ошибки возвращаются значением, фон не показывает окон.
    pub async fn light_check(&self, root: &Path) -> LightCheck {
        let started = Instant::now();
        if self.engine.is_busy(root) {
            return skipped("busy");
        }
        let Ok(dir) = self.git_dir(root).await else {
            return skipped("no-repo");
        };
        // Внешний git (терминал, IDE) сейчас что-то делает: не мешаем
        if dir.join("index.lock").exists() {
            return skipped("locked");
        }
        let Some(job) = self.engine.run_background(root, self.check_all(root)) else {
            return skipped("busy");
        };
        let ms = |started: Instant| u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        match job.await {
            Ok(results) => {
                let mut changes = RemoteChanges::default();
                let prefixed = |remote: &str, names: &[String]| names.iter().map(|name| format!("{remote}/{name}")).collect::<Vec<_>>();
                for item in &results {
                    changes.updated.extend(prefixed(&item.remote, &item.changes.updated));
                    changes.added.extend(prefixed(&item.remote, &item.changes.added));
                    changes.removed.extend(prefixed(&item.remote, &item.changes.removed));
                    changes.tags.extend(item.changes.tags.iter().cloned());
                }
                let via: IndexSet<&str> = results.iter().map(|item| item.via).collect();
                LightCheck {
                    status: "ok".to_owned(),
                    fetched: Some(results.iter().any(|item| item.fetched)),
                    via: (!via.is_empty()).then(|| via.into_iter().collect::<Vec<_>>().join("+")),
                    remotes: Some(results.iter().map(|item| item.remote.clone()).collect()),
                    changes: Some(changes),
                    ms: ms(started),
                    ..LightCheck::default()
                }
            }
            Err(error) => LightCheck {
                status: "error".to_owned(),
                retry_after: self.api.as_ref().and_then(|api| api.retry_after(&error)),
                error: Some(LightError { code: error.code, message: error.message }),
                ms: ms(started),
                ..LightCheck::default()
            },
        }
    }
}
