//! Синхронизация индекса с правками из других программ (WebStorm, VS Code, терминал). Перенос `electron/indexSync.cjs`.
//!
//! ## Конспект
//! Файл добавлен в индекс, а потом во внешней IDE изменён или откатан к HEAD. Git показывает две версии, и проверка перед коммитом ругается на старую, которой на диске уже нет. Поэтому после изменения файлов:
//! 1. Файл на диске снова совпадает с HEAD, а в индексе осталась правка: `git reset -- <file>`, изменение исчезает целиком. Так же для «удалён в индексе, но файл вернули» и «новый добавлен, а потом удалён».
//! 2. Файл был застейджен целиком, а затем его поправили снаружи: `git add <file>`. Частично застейдженные файлы не трогаем: там расхождение намеренное.
//!
//! Ничего не делаем во время merge, rebase, cherry-pick и пока идёт действие пользователя. Переименования не трогаем. `act = false` только запоминает статус: после изменений в `.git`, в том числе собственных stage и unstage.
//!
//! `syncRetrying` — цикл из `repo:watch` в `main.cjs`: занятый репозиторий проверяется ещё 12 раз через 400 мс.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gorynych_core::error::Result;
use gorynych_core::js;
use gorynych_git::actions::RepoEngine;
use gorynych_git::read::detect_operation;
use gorynych_git::run::git;
use indexmap::IndexMap;
use serde::Serialize;

const RETRIES: usize = 12;
const RETRY_PAUSE: Duration = Duration::from_millis(400);

/// `parseStatus`: путь → `XY` и неотслеживаемые файлы.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedStatus {
    pub entries: IndexMap<String, String>,
    pub untracked: HashSet<String>,
}

/// `parseStatus`.
pub fn parse_status(out: &str) -> ParsedStatus {
    let mut status = ParsedStatus::default();
    let mut parts = out.split('\0');
    while let Some(entry) = parts.next() {
        if js::utf16_len(entry) < 4 {
            continue;
        }
        let xy: String = entry.chars().take(2).collect();
        let file: String = entry.chars().skip(3).collect();
        if xy.starts_with(['R', 'C']) {
            parts.next(); // исходный путь переименования: переименования не трогаем
        } else if xy == "??" {
            status.untracked.insert(file);
        } else {
            status.entries.insert(file, xy);
        }
    }
    status
}

/// Что сделать с файлом.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepKind {
    CompareReset,
    Reset,
    AddOrReset,
    Add,
}

/// `plan`: чистое решение по статусу сейчас и после прошлой проверки.
pub fn plan(entries: &IndexMap<String, String>, untracked: &HashSet<String>, previous: Option<&IndexMap<String, String>>) -> Vec<(String, StepKind)> {
    let mut todo = Vec::new();
    for (file, xy) in entries {
        let mut chars = xy.chars();
        let (x, y) = (chars.next().unwrap_or(' '), chars.next().unwrap_or(' '));
        if x == 'U' || y == 'U' || xy == "AA" || xy == "DD" {
            continue; // конфликт: не наше дело
        }
        let before = previous.and_then(|map| map.get(file));
        if matches!(x, 'M' | 'T') && matches!(y, 'M' | 'T') {
            // Правка в индексе и другая правка на диске: откат к HEAD или новая версия целиком застейдженного файла
            let fully_staged = before.is_some_and(|old| {
                let mut old = old.chars();
                let (a, b) = (old.next(), old.next());
                b == Some(' ') && a != Some(' ')
            });
            todo.push((file.clone(), if fully_staged { StepKind::AddOrReset } else { StepKind::CompareReset }));
        } else if x == 'A' && y == 'M' {
            if before.is_some_and(|old| old == "A ") {
                todo.push((file.clone(), StepKind::Add));
            }
        } else if x == 'A' && y == 'D' {
            todo.push((file.clone(), StepKind::Reset)); // новый файл добавили, а потом удалили
        } else if x == 'D' && y == ' ' && untracked.contains(file) {
            todo.push((file.clone(), StepKind::CompareReset)); // удаление застейджено, но файл вернули
        }
    }
    todo
}

/// Что сделано с файлом.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SyncedFile {
    pub file: String,
    pub action: String,
}

/// Результат синхронизации.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct IndexSynced {
    pub synced: Vec<SyncedFile>,
}

async fn status_of(root: &Path) -> Result<ParsedStatus> {
    Ok(parse_status(&git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"]).await?))
}

async fn quiet(root: &Path, args: &[&str]) -> Option<String> {
    let out = git(root, args).await.ok()?;
    let text = js::trim(&out);
    (!text.is_empty()).then(|| text.to_owned())
}

/// Синхронизация индекса. Одна на приложение: помнит статус каждого репозитория.
pub struct IndexSync {
    engine: Arc<RepoEngine>,
    snapshots: Mutex<HashMap<PathBuf, IndexMap<String, String>>>,
}

impl IndexSync {
    pub fn new(engine: Arc<RepoEngine>) -> Self {
        Self { engine, snapshots: Mutex::default() }
    }

    fn snapshots(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, IndexMap<String, String>>> {
        self.snapshots.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// `forget`.
    pub fn forget(&self, root: &Path) {
        self.snapshots().remove(root);
    }

    async fn work(&self, root: &Path, act: bool) -> Result<IndexSynced> {
        let before = status_of(root).await?;
        let previous = self.snapshots().insert(root.to_path_buf(), before.entries.clone());
        if !act || detect_operation(root).await.is_some() {
            return Ok(IndexSynced::default());
        }
        let todo = plan(&before.entries, &before.untracked, previous.as_ref());
        if todo.is_empty() {
            return Ok(IndexSynced::default());
        }

        let has_head = quiet(root, &["rev-parse", "-q", "--verify", "HEAD"]).await.is_some();
        let (mut to_reset, mut to_add) = (Vec::new(), Vec::new());
        for (file, kind) in &todo {
            match kind {
                StepKind::Reset => to_reset.push(file.as_str()),
                StepKind::Add => to_add.push(file.as_str()),
                StepKind::CompareReset | StepKind::AddOrReset => {
                    let head = if has_head { quiet(root, &["rev-parse", "-q", "--verify", &format!("HEAD:{file}")]).await } else { None };
                    // Хэш файла так, как его сохранил бы git: с учётом autocrlf и фильтров
                    let disk = if root.join(file).exists() { quiet(root, &["hash-object", "--", file]).await } else { None };
                    if head.is_some() && head == disk {
                        to_reset.push(file.as_str()); // на диске снова версия из HEAD
                    } else if *kind == StepKind::AddOrReset && disk.is_some() {
                        to_add.push(file.as_str());
                    }
                }
            }
        }

        let mut synced = Vec::new();
        let report = |list: &[&str], action: &str| list.iter().map(|file| SyncedFile { file: (*file).to_owned(), action: action.to_owned() }).collect::<Vec<_>>();
        if !to_reset.is_empty() {
            let mut args = if has_head { vec!["reset", "-q", "HEAD", "--"] } else { vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"] };
            args.extend_from_slice(&to_reset);
            git(root, &args).await?;
            synced.extend(report(&to_reset, "reset"));
        }
        if !to_add.is_empty() {
            let mut args = vec!["add", "--"];
            args.extend_from_slice(&to_add);
            git(root, &args).await?;
            synced.extend(report(&to_add, "add"));
        }
        if !synced.is_empty() {
            let entries = status_of(root).await?.entries;
            self.snapshots().insert(root.to_path_buf(), entries);
        }
        Ok(IndexSynced { synced })
    }

    /// `syncIndex`. `Ok(None)` — репозиторий занят.
    pub async fn sync_index(&self, root: &Path, act: bool) -> Result<Option<IndexSynced>> {
        match self.engine.run_background(root, self.work(root, act)) {
            Some(job) => job.await.map(Some),
            None => Ok(None),
        }
    }

    /// Цикл из `repo:watch`: занятый репозиторий проверяется ещё раз позже. Ошибка считается «ничего не сделано».
    pub async fn sync_retrying(&self, root: &Path, act: bool, stopped: &AtomicBool) -> Option<IndexSynced> {
        for _ in 0..RETRIES {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            match self.sync_index(root, act).await {
                Ok(Some(result)) => return Some(result),
                Err(_) => return Some(IndexSynced::default()),
                Ok(None) => tokio::time::sleep(RETRY_PAUSE).await,
            }
        }
        None
    }
}
