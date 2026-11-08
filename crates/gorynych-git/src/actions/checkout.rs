//! Переключение веток: обычное, умное (изменения прячутся и возвращаются), с переносом и с выбрасыванием изменений.
//!
//! Без стратегии и с изменениями возвращается `WIP_CONFLICT` с подробностями, и интерфейс спрашивает, что с ними делать.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, ErrorData, GorynychError, Result, WipConflict, WipFile};
use gorynych_core::i18n::t;
use gorynych_core::js;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::state::{Position, current_position, current_state, require_no_operation, unique_paths};
use crate::common::{commit_of, filled, lenient, or_undefined, quiet, short, succeeds, trimmed};
use crate::read::{WipEntry, read_status};
use crate::run::{FS, git};

pub(crate) const AUTO_STASH: &str = "gorynych-auto: ";
const MOVE_STASH: &str = "gorynych-move: ";
const DISCARD_STASH: &str = "gorynych-discard: ";

static AUTO_SUBJECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:gorynych|gitidea)-auto: (.+)$").expect("корректный шаблон"));

/// Ветка удалённого репозитория в запросе.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct RemoteBranchRef {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub full_name: Option<String>,
}

/// Цель переключения.
#[derive(Debug, Clone, Default)]
pub(crate) struct Target {
    pub branch: Option<String>,
    pub remote_branch: Option<RemoteBranchRef>,
}

impl Target {
    pub(crate) fn branch(name: &str) -> Self {
        Self { branch: Some(name.to_owned()), remote_branch: None }
    }

    pub(crate) fn remote(name: &str, full_name: &str) -> Self {
        Self { branch: None, remote_branch: Some(RemoteBranchRef { name: Some(name.to_owned()), full_name: Some(full_name.to_owned()) }) }
    }

    fn name(&self) -> Option<&str> {
        self.branch.as_deref().or_else(|| self.remote_branch.as_ref().and_then(|remote| remote.name.as_deref()))
    }
}

/// Созданная при переключении локальная ветка.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CreatedBranch {
    pub name: String,
    pub hash: String,
    pub track: String,
}

/// Изменения, спрятанные под именем ветки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct AutoStash {
    pub branch: String,
    pub hash: String,
    #[specta(type = f64)]
    pub files: usize,
}

/// Изменения, вернувшиеся из stash ветки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RestoredStash {
    pub branch: String,
    pub hash: String,
    pub conflict: bool,
    #[specta(type = f64)]
    pub more: usize,
    pub message: Option<String>,
}

/// Изменения, перенесённые в новую ветку.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct MovedChanges {
    #[specta(type = f64)]
    pub files: usize,
    pub conflict: bool,
    pub stash: Option<String>,
    pub message: Option<String>,
}

/// Выброшенные изменения.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DiscardedChanges {
    #[specta(type = f64)]
    pub files: usize,
    pub backup: String,
}

/// Результат переключения.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Checkout {
    pub previous: Position,
    pub to: Position,
    pub created: Option<CreatedBranch>,
    pub auto_stash: Option<AutoStash>,
    pub restored: Option<RestoredStash>,
    pub moved: Option<MovedChanges>,
    pub discarded: Option<DiscardedChanges>,
    pub strategy: Option<String>,
    pub head: Option<String>,
}

/// Как было выполнено переключение.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CheckoutKind {
    Plain,
    Smart,
    Move,
    Discard,
}

async fn local_exists(cwd: &Path, name: &str) -> bool {
    succeeds(cwd, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")]).await
}

/// `switchTo`.
pub(crate) async fn switch_to(cwd: &Path, position: &Position) -> Result<()> {
    match &position.branch {
        Some(branch) => git(cwd, &["switch", branch]).await?,
        None => git(cwd, &["switch", "--detach", or_undefined(position.detached.as_deref())]).await?,
    };
    Ok(())
}

/// `checkout`.
pub(crate) async fn checkout(cwd: &Path, target: &Target) -> Result<Checkout> {
    require_no_operation(&current_state(cwd).await?, "checkout")?;
    let previous = current_position(cwd).await?;

    if let Some(branch) = filled(target.branch.as_deref()) {
        if previous.branch.as_deref() != Some(branch) {
            git(cwd, &["switch", branch]).await?;
        }
        return Ok(Checkout { previous, to: Position::on_branch(branch), ..Checkout::default() });
    }

    // Remote-ветка: переключаемся на локальную с тем же именем или создаём отслеживающую
    let remote = target.remote_branch.as_ref();
    let (Some(local), Some(full_name)) = (remote.and_then(|item| filled(item.name.as_deref())), remote.and_then(|item| filled(item.full_name.as_deref()))) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
    };
    if local_exists(cwd, local).await {
        if previous.branch.as_deref() != Some(local) {
            git(cwd, &["switch", local]).await?;
        }
        return Ok(Checkout { previous, to: Position::on_branch(local), ..Checkout::default() });
    }
    git(cwd, &["switch", "--create", local, "--track", full_name]).await?;
    let hash = trimmed(cwd, &["rev-parse", local]).await?;
    Ok(Checkout { previous, to: Position::on_branch(local), created: Some(CreatedBranch { name: local.to_owned(), hash, track: full_name.to_owned() }), ..Checkout::default() })
}

struct AutoEntry {
    id: String,
    hash: String,
    branch: String,
}

fn auto_branch_of(subject: &str) -> Option<String> {
    AUTO_SUBJECT.captures(subject).map(|caps| js::trim(&caps[1]).to_owned())
}

async fn auto_stashes(cwd: &Path) -> Vec<AutoEntry> {
    let format = format!("--format=%gd{FS}%H{FS}%gs");
    let out = git(cwd, &["stash", "list", &format]).await.unwrap_or_default();
    out.split('\n')
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut fields = line.split(FS);
            let (id, hash, subject) = (fields.next().unwrap_or_default(), fields.next().unwrap_or_default(), fields.next().unwrap_or_default());
            Some(AutoEntry { id: id.to_owned(), hash: hash.to_owned(), branch: auto_branch_of(subject)? })
        })
        .collect()
}

/// «Отпечаток» stash: базовый коммит и содержимое рабочей папки, индекса и неотслеживаемых файлов. Одинаковый отпечаток — тот же набор правок.
async fn stash_signature(cwd: &Path, reference: &str) -> Option<String> {
    let main = quiet(cwd, &["rev-parse".to_owned(), format!("{reference}^1"), format!("{reference}^{{tree}}"), format!("{reference}^2^{{tree}}")]).await;
    if main.is_empty() {
        return None;
    }
    let untracked = quiet(cwd, &["rev-parse", "--verify", "--quiet", &format!("{reference}^3^{{tree}}")]).await;
    Some(format!("{} {untracked}", main.split(js::is_whitespace).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")))
}

/// Только что созданный `stash@{0}` уже лежит в списке: убираем старые копии. `only_auto_for`: сравниваем только с авто-stash той же ветки, ручные не трогаем.
pub(crate) async fn drop_older_duplicates(cwd: &Path, only_auto_for: Option<&str>) -> Result<usize> {
    let format = format!("--format=%gd{FS}%gs");
    let out = git(cwd, &["stash", "list", &format]).await.unwrap_or_default();
    let list: Vec<(&str, &str)> = out
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FS);
            (fields.next().unwrap_or_default(), fields.next().unwrap_or_default())
        })
        .collect();
    if list.len() < 2 {
        return Ok(0);
    }
    let Some(top) = stash_signature(cwd, "stash@{0}").await else {
        return Ok(0);
    };
    let mut dupes = Vec::new();
    for (id, subject) in list.iter().take(30).skip(1) {
        if let Some(branch) = only_auto_for
            && auto_branch_of(subject).as_deref() != Some(branch)
        {
            continue;
        }
        if stash_signature(cwd, id).await.as_deref() == Some(&top) {
            dupes.push(*id);
        }
    }
    // С конца, чтобы номера stash@{N} не съезжали
    for id in dupes.iter().rev() {
        git(cwd, &["stash", "drop", "-q", id]).await?;
    }
    Ok(dupes.len())
}

async fn pop_stash(cwd: &Path, id: &str) -> Result<()> {
    if let Err(error) = git(cwd, &["stash", "pop", "--index", id]).await {
        if !error.details.to_lowercase().contains("index") {
            return Err(error);
        }
        // Индекс восстановить нельзя: хотя бы файлы
        git(cwd, &["stash", "pop", id]).await?;
    }
    Ok(())
}

fn conflicted_error() -> GorynychError {
    GorynychError::new(ErrorCode::Conflict, t("В рабочей папке есть неразрешённые конфликты", &[])).with_hint(t("Сначала решите их, затем переключайтесь.", &[]))
}

fn has_conflict(files: &[WipEntry]) -> bool {
    files.iter().any(|file| file.status == "U")
}

/// `smartCheckout`.
pub(crate) async fn smart_checkout(cwd: &Path, target: &Target) -> Result<Checkout> {
    let state = current_state(cwd).await?;
    require_no_operation(&state, "checkout")?;
    let from = state.branch_name.clone();
    if from.is_some() && from.as_deref() == target.name() {
        return checkout(cwd, target).await;
    }

    // 1. Прячем изменения текущей ветки под её именем
    let mut auto_stash = None;
    let files = read_status(cwd, false).await?;
    if let (false, Some(from), Some(_)) = (files.is_empty(), &from, &state.head_hash) {
        if has_conflict(&files) {
            return Err(conflicted_error());
        }
        git(cwd, &["stash", "push", "--include-untracked", "-m", &format!("{AUTO_STASH}{from}")]).await?;
        // Те же правки уже были спрятаны для этой ветки: не плодим копии
        let _ = drop_older_duplicates(cwd, Some(from)).await;
        let hash = trimmed(cwd, &["rev-parse", "stash@{0}"]).await?;
        auto_stash = Some(AutoStash { branch: from.clone(), hash, files: unique_paths(&files) });
    }

    // 2. Переключаемся; не вышло — возвращаем спрятанное на место
    let mut result = match checkout(cwd, target).await {
        Ok(result) => result,
        Err(error) => {
            if let Some(stash) = &auto_stash
                && quiet(cwd, &["rev-parse", "--verify", "--quiet", "stash@{0}"]).await == stash.hash
            {
                let _ = pop_stash(cwd, "stash@{0}").await;
            }
            return Err(error);
        }
    };

    // 3. Если для новой ветки что-то было спрятано, достаём самое свежее
    let own = auto_stash.as_ref().map(|stash| stash.hash.as_str());
    let waiting: Vec<AutoEntry> = auto_stashes(cwd).await.into_iter().filter(|item| result.to.branch.as_deref() == Some(&item.branch) && Some(item.hash.as_str()) != own).collect();
    if let Some(found) = waiting.first() {
        let more = waiting.len() - 1;
        result.restored = Some(match pop_stash(cwd, &found.id).await {
            Ok(()) => RestoredStash { branch: found.branch.clone(), hash: found.hash.clone(), conflict: false, more, message: None },
            Err(error) => {
                let message = if error.code == ErrorCode::Conflict { t("Изменения вернулись с конфликтами — stash сохранён", &[]) } else { error.message };
                RestoredStash { branch: found.branch.clone(), hash: found.hash.clone(), conflict: true, more, message: Some(message) }
            }
        });
    }
    result.auto_stash = auto_stash;
    Ok(result)
}

/// Коммит, на который указывает цель.
async fn target_commit(cwd: &Path, target: &Target) -> Result<String> {
    let full_name = target.remote_branch.as_ref().and_then(|remote| filled(remote.full_name.as_deref()));
    let reference = if let Some(branch) = filled(target.branch.as_deref()) {
        format!("refs/heads/{branch}")
    } else if let Some(full) = full_name {
        format!("refs/remotes/{full}")
    } else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
    };
    // Remote-ветка, у которой уже есть локальная: переключимся на локальную
    if let Some(remote) = &target.remote_branch {
        let local = quiet(cwd, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", or_undefined(remote.name.as_deref()))]).await;
        if !local.is_empty() {
            return Ok(local);
        }
    }
    commit_of(cwd, &reference).await.ok_or_else(|| {
        let name = target.branch.as_deref().or(full_name).unwrap_or_default();
        GorynychError::new(ErrorCode::NotFound, t("Ветка «{0}» не найдена", &[&name])).with_hint(t("Возможно, её удалили — обновите список (Fetch)", &[]))
    })
}

/// `inspectWip`: незакоммиченные изменения и их пересечение с тем, что отличается в целевой ветке.
pub(crate) async fn inspect_wip(cwd: &Path, target: &Target) -> Result<Option<WipConflict>> {
    let files = read_status(cwd, false).await?;
    if files.is_empty() {
        return Ok(None);
    }
    let state = current_state(cwd).await?;
    let to = target_commit(cwd, target).await?;
    let mut changed = std::collections::HashSet::new();
    let diff = match &state.head_hash {
        Some(head) => git(cwd, &["diff", "--name-only", "-z", head, &to]).await.unwrap_or_default(),
        None => String::new(),
    };
    changed.extend(diff.split('\0').filter(|name| !name.is_empty()));
    let paths: indexmap::IndexSet<&str> = files.iter().map(|file| file.path.as_str()).collect();
    Ok(Some(WipConflict {
        from: state.branch_name.clone(),
        to: target.name().map(str::to_owned),
        files: paths.len() as u32,
        list: files.iter().take(50).map(|file| WipFile { path: file.path.clone(), status: file.status.clone(), untracked: file.untracked == Some(true), staged: file.staged }).collect(),
        untracked: files.iter().filter(|file| file.untracked == Some(true)).count() as u32,
        conflicted: files.iter().filter(|file| file.status == "U").map(|file| file.path.clone()).collect(),
        overlap: paths.iter().filter(|path| changed.contains(*path)).take(50).map(|path| (*path).to_owned()).collect(),
        detached: state.branch_name.is_none(),
    }))
}

/// `moveCheckout`: stash → switch → pop. При конфликте stash остаётся в списке.
pub(crate) async fn move_checkout(cwd: &Path, target: &Target) -> Result<Checkout> {
    let state = current_state(cwd).await?;
    require_no_operation(&state, "checkout")?;
    let files = read_status(cwd, false).await?;
    if has_conflict(&files) {
        return Err(conflicted_error());
    }
    let mut stash_hash = None;
    if !files.is_empty() {
        let name = state.branch_name.clone().unwrap_or_else(|| short(state.head_hash.as_deref().unwrap_or("undefined")));
        git(cwd, &["stash", "push", "--include-untracked", "-m", &format!("{MOVE_STASH}{name}")]).await?;
        stash_hash = Some(trimmed(cwd, &["rev-parse", "stash@{0}"]).await?);
    }
    let mut result = match checkout(cwd, target).await {
        Ok(result) => result,
        Err(error) => {
            if stash_hash.is_some() {
                let _ = pop_stash(cwd, "stash@{0}").await;
            }
            return Err(error);
        }
    };
    if let Some(stash) = stash_hash {
        let count = unique_paths(&files);
        result.moved = Some(match pop_stash(cwd, "stash@{0}").await {
            Ok(()) => MovedChanges { files: count, conflict: false, stash: None, message: None },
            Err(error) => MovedChanges { files: count, conflict: true, stash: Some(stash), message: Some(error.message) },
        });
    }
    Ok(result)
}

/// Применить копию изменений: сперва с индексом, не вышло — только файлы.
pub(crate) async fn apply_backup(cwd: &Path, backup: &str) -> Result<()> {
    if git(cwd, &["stash", "apply", "--index", backup]).await.is_err() {
        git(cwd, &["stash", "apply", backup]).await?;
    }
    Ok(())
}

/// `discardCheckout`: копия изменений — висячий stash-коммит, Undo применит её обратно.
pub(crate) async fn discard_checkout(cwd: &Path, target: &Target) -> Result<Checkout> {
    let state = current_state(cwd).await?;
    require_no_operation(&state, "checkout")?;
    let files = read_status(cwd, false).await?;
    let mut backup = None;
    if !files.is_empty() {
        // Конфликтные файлы спрятать нельзя: сначала сбрасываем индекс
        if has_conflict(&files) {
            git(cwd, &["reset", "-q"]).await?;
        }
        git(cwd, &["stash", "push", "--include-untracked", "-m", &format!("{DISCARD_STASH}{}", state.branch_name.as_deref().unwrap_or_default())]).await?;
        let hash = trimmed(cwd, &["rev-parse", "stash@{0}"]).await?;
        git(cwd, &["stash", "drop", "-q", "stash@{0}"]).await?; // из списка убираем, коммит остаётся для Undo
        backup = Some(hash);
    }
    match checkout(cwd, target).await {
        Ok(mut result) => {
            result.discarded = backup.map(|backup| DiscardedChanges { files: unique_paths(&files), backup });
            Ok(result)
        }
        Err(error) => {
            if let Some(backup) = &backup {
                let _ = apply_backup(cwd, backup).await;
            }
            Err(error)
        }
    }
}

/// Параметры действий `checkout` и `checkoutPreview`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct CheckoutRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<RemoteBranchRef>)]
    pub remote_branch: Option<RemoteBranchRef>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub strategy: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub smart: Option<bool>,
}

impl CheckoutRequest {
    pub(crate) fn target(&self) -> Target {
        match filled(self.branch.as_deref()) {
            Some(branch) => Target::branch(branch),
            None => Target { branch: None, remote_branch: self.remote_branch.clone() },
        }
    }
}

/// `checkoutWithStrategy`.
pub(crate) async fn checkout_with_strategy(cwd: &Path, request: &CheckoutRequest) -> Result<(CheckoutKind, Checkout)> {
    let target = request.target();
    let state = current_state(cwd).await?;
    require_no_operation(&state, "checkout")?;
    let target_name = target.name().map(str::to_owned);
    if state.branch_name.is_some() && state.branch_name == target_name {
        return Ok((CheckoutKind::Plain, checkout(cwd, &target).await?));
    }
    let strategy = request.strategy.as_deref().or(if request.smart == Some(true) { Some("stash") } else { None });
    match strategy {
        Some("stash") => return Ok((CheckoutKind::Smart, smart_checkout(cwd, &target).await?)),
        Some("merge") => return Ok((CheckoutKind::Move, move_checkout(cwd, &target).await?)),
        Some("force") => return Ok((CheckoutKind::Discard, discard_checkout(cwd, &target).await?)),
        Some(other) if !other.is_empty() && other != "none" => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестная стратегия: {0}", &[&other]))),
        _ => {}
    }
    let wip = inspect_wip(cwd, &target).await?;
    let Some(wip) = wip else {
        // Папка чистая, но для целевой ветки что-то спрятано раньше: вернём при переходе
        if auto_stashes(cwd).await.iter().any(|item| target_name.as_deref() == Some(&item.branch)) {
            return Ok((CheckoutKind::Smart, smart_checkout(cwd, &target).await?));
        }
        return Ok((CheckoutKind::Plain, checkout(cwd, &target).await?));
    };
    Err(GorynychError::new(ErrorCode::WipConflict, t("В рабочей папке есть незакоммиченные изменения ({0})", &[&wip.files]))
        .with_hint(t("Выберите, что с ними сделать: спрятать, перенести в новую ветку или выбросить.", &[]))
        .with_data(ErrorData::WipConflict(wip)))
}

/// Перемотка назад через `checkoutCommit`.
pub(crate) async fn checkout_commit(cwd: &Path, hash: &str) -> Result<Checkout> {
    require_no_operation(&current_state(cwd).await?, "checkout")?;
    let previous = current_position(cwd).await?;
    git(cwd, &["switch", "--detach", hash]).await?;
    Ok(Checkout { previous, to: Position { branch: None, detached: Some(hash.to_owned()) }, ..Checkout::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_stash_subjects() {
        assert_eq!(auto_branch_of("On main: gorynych-auto: main").as_deref(), Some("main"));
        assert_eq!(auto_branch_of("On dev: gitidea-auto: ветка/1 ").as_deref(), Some("ветка/1"));
        assert_eq!(auto_branch_of("On main: gorynych-move: main"), None);
    }
}
