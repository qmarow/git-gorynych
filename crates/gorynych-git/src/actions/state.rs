//! Текущее состояние репозитория и проверки перед операциями.

use std::path::Path;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use serde::{Deserialize, Serialize};

use crate::common::head_hash;
use crate::read::{LocalBranch, RefsInfo, detect_operation, is_hash, read_refs};

/// `currentState`.
pub(crate) struct State {
    pub refs: RefsInfo,
    pub branch_name: Option<String>,
    pub branch: Option<LocalBranch>,
    pub remotes: Vec<String>,
    pub head_hash: Option<String>,
    pub operation: Option<&'static str>,
}

pub(crate) async fn current_state(cwd: &Path) -> Result<State> {
    let refs = read_refs(cwd).await?;
    let branch = refs.local_branches.iter().find(|branch| Some(&branch.name) == refs.current_branch.as_ref()).cloned();
    let remotes = refs.remotes.iter().map(|remote| remote.name.clone()).collect();
    let head_hash = head_hash(cwd).await;
    let operation = detect_operation(cwd).await;
    Ok(State { branch_name: refs.current_branch.clone(), refs, branch, remotes, head_hash, operation })
}

pub(crate) fn require_no_operation(state: &State, action: &str) -> Result<()> {
    if let Some(operation) = state.operation {
        return Err(GorynychError::new(ErrorCode::OperationInProgress, t("Нельзя сделать {0}: не завершён {1}", &[&action, &operation])).with_hint(t("Разрешите конфликты и нажмите «Продолжить» в жёлтой панели сверху, либо «Прервать».", &[])));
    }
    Ok(())
}

pub(crate) fn pick_remote(state: &State) -> Option<String> {
    if let Some(remote) = state.branch.as_ref().and_then(|branch| branch.upstream_remote.as_ref()).filter(|remote| state.remotes.contains(remote)) {
        return Some(remote.clone());
    }
    if state.remotes.iter().any(|remote| remote == "origin") {
        return Some("origin".to_owned());
    }
    state.remotes.first().cloned()
}

pub(crate) fn require_branch(state: &State, action: &str) -> Result<()> {
    require_no_operation(state, action)?;
    if state.head_hash.is_none() {
        return Err(GorynychError::new(ErrorCode::NoCommits, t("Нельзя сделать {0}: в репозитории ещё нет коммитов", &[&action])));
    }
    if state.branch_name.is_none() {
        return Err(GorynychError::new(ErrorCode::Detached, t("Нельзя сделать {0} из состояния detached HEAD", &[&action])).with_hint(t("Переключитесь на ветку (двойной клик по ветке в списке слева) или создайте новую.", &[])));
    }
    Ok(())
}

pub(crate) fn require_head(state: &State, action: &str) -> Result<()> {
    require_no_operation(state, action)?;
    if state.head_hash.is_none() {
        return Err(GorynychError::new(ErrorCode::NoCommits, t("Нельзя сделать {0}: нет коммитов", &[&action])));
    }
    Ok(())
}

pub(crate) fn require_hash(hash: Option<&str>) -> Result<&str> {
    hash.filter(|hash| is_hash(hash)).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[])))
}

/// Где находится HEAD: ветка или отдельный коммит.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Position {
    pub branch: Option<String>,
    pub detached: Option<String>,
}

impl Position {
    pub(crate) fn on_branch(name: &str) -> Self {
        Self { branch: Some(name.to_owned()), detached: None }
    }

    /// `posLabel`.
    pub(crate) fn label(&self) -> String {
        match (&self.branch, &self.detached) {
            (Some(branch), _) => branch.clone(),
            (None, Some(hash)) => format!("{} (detached)", crate::common::short(hash)),
            (None, None) => "undefined (detached)".to_owned(),
        }
    }
}

/// `currentPosition`.
pub(crate) async fn current_position(cwd: &Path) -> Result<Position> {
    let state = current_state(cwd).await?;
    Ok(match state.branch_name {
        Some(name) => Position { branch: Some(name), detached: None },
        None => Position { branch: None, detached: state.head_hash },
    })
}

/// Сколько разных путей: одна запись `readStatus` на файл, но файл бывает и в индексе, и в рабочей папке.
pub(crate) fn unique_paths(files: &[crate::read::WipEntry]) -> usize {
    files.iter().map(|file| file.path.as_str()).collect::<std::collections::HashSet<_>>().len()
}
