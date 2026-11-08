//! Записи истории Undo/Redo и их обработчики.
//!
//! Запись лежит в `undo_history` как JSON, а содержимое снимков файлов — отдельно в `undo_blobs` (поле снимка хранит номер данных).

use std::path::Path;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use serde::{Deserialize, Serialize};

use super::checkout::{CreatedBranch, Target, apply_backup, discard_checkout, move_checkout, smart_checkout, switch_to};
use super::ops::{CreateTag, stash_pop, stash_push};
use super::remote::{DeleteRemoteBranch, delete_remote_branch, republish_branch};
use super::state::{Position, current_state};
use crate::common::{branch_tip, commit_of, head_hash, quiet, succeeds, trimmed};
use crate::network::Network;
use crate::read::read_status;
use crate::restore::{Snapshot, SnapshotSide, write_snapshot};
use crate::run::git;

/// Снимок файла в записи: номера данных в `undo_blobs`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SnapshotRef {
    path: String,
    before: Option<usize>,
    after: Option<usize>,
}

/// Запись истории.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Entry {
    Commit { hash: String, parent: Option<String> },
    BranchMove { branch: String, from: String, to: Option<String> },
    SmartCheckout { previous: Position, to: Position, created: Option<CreatedBranch> },
    MoveCheckout { previous: Position, to: Position, created: Option<CreatedBranch> },
    DiscardCheckout { previous: Position, to: Position, created: Option<CreatedBranch>, backup: Option<String> },
    Checkout { previous: Position, to: Position, created: Option<CreatedBranch> },
    Branch { name: String, hash: String, checked_out: bool, previous: Position },
    HeadMove { from: Option<String>, to: Option<String> },
    Reset { mode: String, from: Option<String>, to: Option<String> },
    Tag { name: String, hash: String, message: Option<String> },
    DeleteTag { name: String, hash: String, message: Option<String> },
    FileSnapshot { snapshots: Vec<SnapshotRef> },
    StashDrop { hash: String, message: String },
    RenameBranch { from: String, to: String },
    DeleteBranch { name: String, hash: String },
    DeleteRemoteBranch { remote: String, branch: String, hash: String },
    Stash { hash: String, message: Option<String> },
}

impl Entry {
    /// Значение столбца `kind`: то же имя, что в JSON.
    pub(crate) fn kind(&self) -> String {
        serde_json::to_value(self).ok().and_then(|value| value["type"].as_str().map(str::to_owned)).unwrap_or_default()
    }

    /// Запись снимков и данные для `undo_blobs`.
    pub(crate) fn from_snapshots(snapshots: Vec<Snapshot>) -> (Self, Vec<Vec<u8>>) {
        let mut blobs = Vec::new();
        let mut store = |data: Option<Vec<u8>>| {
            data.map(|data| {
                blobs.push(data);
                blobs.len() - 1
            })
        };
        let snapshots = snapshots.into_iter().map(|snap| SnapshotRef { path: snap.path, before: store(snap.before), after: store(snap.after) }).collect();
        (Self::FileSnapshot { snapshots }, blobs)
    }
}

fn stale(what: &str) -> GorynychError {
    GorynychError::new(ErrorCode::HistoryStale, t("Нельзя отменить: {0} изменилось после операции", &[&what])).with_hint(t("Репозиторий изменился вне приложения или другой операцией.", &[]))
}

fn stale_branch(name: &str) -> GorynychError {
    stale(&t("ветка {0}", &[&name]))
}

fn stale_stashes() -> GorynychError {
    stale(&t("список сташей", &[]))
}

fn no_way_back() -> GorynychError {
    GorynychError::new(ErrorCode::HistoryStale, t("Нельзя вернуться: до переключения был detached HEAD", &[]))
}

fn expand(snapshots: &[SnapshotRef], blobs: &[Vec<u8>]) -> Vec<Snapshot> {
    let data = |index: Option<usize>| index.and_then(|index| blobs.get(index).cloned());
    snapshots.iter().map(|snap| Snapshot { path: snap.path.clone(), before: data(snap.before), after: data(snap.after) }).collect()
}

async fn require_head_at(cwd: &Path, expected: Option<&String>) -> Result<()> {
    if head_hash(cwd).await.as_ref() != expected {
        return Err(stale("HEAD"));
    }
    Ok(())
}

async fn require_tip(cwd: &Path, branch: &str, expected: Option<&String>) -> Result<()> {
    if branch_tip(cwd, branch).await.as_ref() != expected {
        return Err(stale_branch(branch));
    }
    Ok(())
}

async fn move_branch(cwd: &Path, branch: &str, target: &str, expected_old: &str) -> Result<()> {
    if current_state(cwd).await?.branch_name.as_deref() == Some(branch) {
        git(cwd, &["reset", "--keep", target]).await?;
    } else {
        git(cwd, &["update-ref", &format!("refs/heads/{branch}"), target, expected_old]).await?;
    }
    Ok(())
}

async fn delete_created(cwd: &Path, created: Option<&CreatedBranch>) -> Result<()> {
    if let Some(created) = created
        && branch_tip(cwd, &created.name).await.as_deref() == Some(&created.hash)
    {
        git(cwd, &["branch", "-D", &created.name]).await?;
    }
    Ok(())
}

fn redo_target(to: &Position, created: Option<&CreatedBranch>) -> Target {
    match created {
        Some(created) => Target::remote(&created.name, &created.track),
        None => Target::branch(to.branch.as_deref().unwrap_or_default()),
    }
}

fn previous_branch(previous: &Position) -> Result<&str> {
    previous.branch.as_deref().ok_or_else(no_way_back)
}

async fn create_tag_again(cwd: &Path, name: &str, hash: &str, message: Option<&String>) -> Result<()> {
    super::ops::create_tag(cwd, &CreateTag { name: Some(name.to_owned()), hash: Some(hash.to_owned()), message: message.cloned() }).await.map(|_| ())
}

fn reset_flag(mode: &str) -> String {
    if mode == "hard" { "--keep".to_owned() } else { format!("--{mode}") }
}

/// Обработчик Undo.
pub(crate) async fn undo(network: &Network, cwd: &Path, entry: &Entry, blobs: &[Vec<u8>]) -> Result<()> {
    match entry {
        Entry::Commit { hash, parent } => {
            require_head_at(cwd, Some(hash)).await?;
            let Some(parent) = parent else {
                return Err(GorynychError::new(ErrorCode::HistoryRoot, t("Первый коммит репозитория отменить нельзя", &[])));
            };
            if !trimmed(cwd, &["branch", "-r", "--contains", hash]).await?.is_empty() {
                return Err(GorynychError::new(ErrorCode::HistoryPushed, t("Коммит уже отправлен на remote — отмена переписала бы общую историю", &[])).with_hint(t("Используйте revert (будет добавлен позже).", &[])));
            }
            git(cwd, &["reset", "--soft", parent]).await?; // изменения остаются застейдженными
        }
        Entry::BranchMove { branch, from, to } => {
            require_tip(cwd, branch, to.as_ref()).await?;
            move_branch(cwd, branch, from, to.as_deref().unwrap_or_default()).await?;
        }
        // Отмена умного переключения — такое же умное переключение обратно
        Entry::SmartCheckout { previous, created, .. } => {
            smart_checkout(cwd, &Target::branch(previous_branch(previous)?)).await?;
            delete_created(cwd, created.as_ref()).await?;
        }
        Entry::MoveCheckout { previous, created, .. } => {
            move_checkout(cwd, &Target::branch(previous_branch(previous)?)).await?;
            delete_created(cwd, created.as_ref()).await?;
        }
        Entry::DiscardCheckout { previous, created, backup, .. } => {
            if !read_status(cwd, false).await?.is_empty() {
                return Err(GorynychError::new(ErrorCode::HistoryStale, t("В рабочей папке уже есть изменения", &[])).with_hint(t("Закоммитьте или спрячьте их, затем повторите Undo.", &[])));
            }
            switch_to(cwd, previous).await?;
            delete_created(cwd, created.as_ref()).await?;
            if let Some(backup) = backup {
                apply_backup(cwd, backup).await?;
            }
        }
        Entry::Checkout { previous, created, .. } => {
            switch_to(cwd, previous).await?;
            delete_created(cwd, created.as_ref()).await?;
        }
        Entry::Branch { name, hash, checked_out, previous } => {
            require_tip(cwd, name, Some(hash)).await?;
            if *checked_out {
                switch_to(cwd, previous).await?;
            }
            git(cwd, &["branch", "-D", name]).await?;
        }
        Entry::HeadMove { from, to } => {
            require_head_at(cwd, to.as_ref()).await?;
            git(cwd, &["reset", "--keep", from.as_deref().unwrap_or_default()]).await?; // --keep не трогает несвязанные локальные правки
        }
        Entry::Reset { mode, from, to } => {
            require_head_at(cwd, to.as_ref()).await?;
            git(cwd, &["reset", &reset_flag(mode), from.as_deref().unwrap_or_default()]).await?;
        }
        Entry::Tag { name, hash, .. } => {
            if commit_of(cwd, &format!("refs/tags/{name}")).await.as_ref() != Some(hash) {
                return Err(stale(&t("тег {0}", &[name])));
            }
            git(cwd, &["tag", "-d", name]).await?;
        }
        Entry::DeleteTag { name, hash, message } => create_tag_again(cwd, name, hash, message.as_ref()).await?,
        Entry::FileSnapshot { snapshots } => {
            for snap in expand(snapshots, blobs).iter().rev() {
                write_snapshot(cwd, snap, SnapshotSide::Before).await?;
            }
        }
        Entry::StashDrop { hash, message } => {
            let text = if message.is_empty() { "restored stash" } else { message };
            git(cwd, &["stash", "store", "-m", text, hash]).await?;
        }
        Entry::RenameBranch { from, to } => {
            git(cwd, &["branch", "-m", to, from]).await?;
        }
        Entry::DeleteBranch { name, hash } => {
            git(cwd, &["branch", name, hash]).await?;
        }
        Entry::DeleteRemoteBranch { remote, branch, hash } => {
            if hash.is_empty() {
                return Err(GorynychError::new(ErrorCode::HistoryStale, t("Не известно, на каком коммите была ветка", &[])));
            }
            if !succeeds(cwd, &["cat-file", "-e", &format!("{hash}^{{commit}}")]).await {
                return Err(GorynychError::new(ErrorCode::HistoryStale, t("Коммита ветки нет локально — вернуть на сервер нельзя", &[])).with_hint(t("Сделайте fetch у коллеги или восстановите ветку на сервере.", &[])));
            }
            republish_branch(network, cwd, remote, branch, hash).await?;
        }
        Entry::Stash { hash, .. } => {
            if quiet(cwd, &["rev-parse", "--verify", "--quiet", "stash@{0}"]).await != *hash {
                return Err(stale_stashes());
            }
            stash_pop(cwd).await?;
        }
    }
    Ok(())
}

/// Обработчик Redo. Может изменить запись: новая копия изменений, новый хэш stash.
pub(crate) async fn redo(network: &Network, cwd: &Path, entry: &mut Entry, blobs: &[Vec<u8>]) -> Result<()> {
    match entry {
        Entry::Commit { hash, parent } => {
            require_head_at(cwd, parent.as_ref()).await?;
            git(cwd, &["reset", "--soft", hash]).await?;
        }
        Entry::BranchMove { branch, from, to } => {
            require_tip(cwd, branch, Some(from)).await?;
            move_branch(cwd, branch, to.as_deref().unwrap_or_default(), from).await?;
        }
        Entry::SmartCheckout { to, created, .. } => {
            smart_checkout(cwd, &redo_target(to, created.as_ref())).await?;
        }
        Entry::MoveCheckout { to, created, .. } => {
            move_checkout(cwd, &redo_target(to, created.as_ref())).await?;
        }
        Entry::DiscardCheckout { to, created, backup, .. } => {
            let result = discard_checkout(cwd, &redo_target(to, created.as_ref())).await?;
            if let Some(discarded) = result.discarded {
                *backup = Some(discarded.backup);
            }
        }
        Entry::Checkout { to, created, .. } => match created {
            Some(created) => {
                git(cwd, &["switch", "--create", &created.name, "--track", &created.track]).await?;
            }
            None => switch_to(cwd, to).await?,
        },
        Entry::Branch { name, hash, checked_out, .. } => {
            if *checked_out {
                git(cwd, &["switch", "--create", name, hash]).await?;
            } else {
                git(cwd, &["branch", name, hash]).await?;
            }
        }
        Entry::HeadMove { from, to } => {
            require_head_at(cwd, from.as_ref()).await?;
            git(cwd, &["reset", "--keep", to.as_deref().unwrap_or_default()]).await?;
        }
        Entry::Reset { mode, from, to } => {
            require_head_at(cwd, from.as_ref()).await?;
            git(cwd, &["reset", &reset_flag(mode), to.as_deref().unwrap_or_default()]).await?;
        }
        Entry::Tag { name, hash, message } => create_tag_again(cwd, name, hash, message.as_ref()).await?,
        Entry::DeleteTag { name, .. } => {
            git(cwd, &["tag", "-d", name]).await?;
        }
        Entry::FileSnapshot { snapshots } => {
            for snap in &expand(snapshots, blobs) {
                write_snapshot(cwd, snap, SnapshotSide::After).await?;
            }
        }
        Entry::StashDrop { hash, .. } => {
            if quiet(cwd, &["rev-parse", "--verify", "--quiet", "stash@{0}"]).await != *hash {
                return Err(stale_stashes());
            }
            git(cwd, &["stash", "drop", "-q", "stash@{0}"]).await?;
        }
        Entry::RenameBranch { from, to } => {
            git(cwd, &["branch", "-m", from, to]).await?;
        }
        Entry::DeleteBranch { name, hash } => {
            require_tip(cwd, name, Some(hash)).await?;
            git(cwd, &["branch", "-D", name]).await?;
        }
        Entry::DeleteRemoteBranch { remote, branch, .. } => {
            delete_remote_branch(network, cwd, &DeleteRemoteBranch { remote: Some(remote.clone()), branch: Some(branch.clone()) }).await?;
        }
        Entry::Stash { hash, message } => {
            *hash = stash_push(cwd, message.as_deref()).await?.hash;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_match_1x_names() {
        assert_eq!(Entry::HeadMove { from: None, to: None }.kind(), "headMove");
        assert_eq!(Entry::DeleteRemoteBranch { remote: String::new(), branch: String::new(), hash: String::new() }.kind(), "deleteRemoteBranch");
    }

    #[test]
    fn snapshots_round_trip_through_blobs() {
        let source = vec![
            Snapshot { path: "a".into(), before: Some(vec![0, 255]), after: None },
            Snapshot { path: "b".into(), before: None, after: Some(Vec::new()) },
        ];
        let (entry, blobs) = Entry::from_snapshots(source.clone());
        assert_eq!(blobs, [vec![0, 255], Vec::new()]);
        let saved: Entry = serde_json::from_str(&serde_json::to_string(&entry).unwrap()).unwrap();
        let Entry::FileSnapshot { snapshots } = saved else {
            panic!("другая запись");
        };
        assert_eq!(expand(&snapshots, &blobs), source);
    }
}
