//! Ветки, теги, stash, операции над коммитом, возврат к коммиту, незавершённые операции, своя команда git.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::checkout::drop_older_duplicates;
use super::state::{Position, current_position, current_state, require_branch, require_hash, require_head, require_no_operation, unique_paths};
use crate::common::{branch_tip, commit_of, filled, head_hash, lenient, or_undefined, quiet, short, succeeds, trimmed};
use crate::read::{detect_operation, has_head, read_status};
use crate::run::{FS, GitOptions, git, git_with};

static NOT_MERGED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)not fully merged").expect("корректный шаблон"));
static STASH_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^stash@\{[0-9]+\}$").expect("корректный шаблон"));
static GIT_PREFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^[{0}]*git[{0}]+", js::WHITESPACE_CLASS)).expect("корректный шаблон"));
static FILES_CHANGED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([0-9]+) files? changed").expect("корректный шаблон"));
static INSERTIONS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([0-9]+) insertions?").expect("корректный шаблон"));
static DELETIONS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([0-9]+) deletions?").expect("корректный шаблон"));

/// `NO_EDITOR`: git не должен открывать редактор.
pub(crate) fn no_editor() -> GitOptions {
    GitOptions { env: vec![("GIT_EDITOR".to_owned(), "true".to_owned()), ("GIT_SEQUENCE_EDITOR".to_owned(), "true".to_owned())], ..GitOptions::default() }
}

async fn is_ancestor(cwd: &Path, a: &str, b: &str) -> bool {
    succeeds(cwd, &["merge-base", "--is-ancestor", a, b]).await
}

async fn parents_of(cwd: &Path, hash: &str) -> Result<usize> {
    Ok(trimmed(cwd, &["rev-list", "--parents", "-n", "1", hash]).await?.split(' ').count().saturating_sub(1))
}

async fn validate_branch_name(cwd: &Path, name: Option<&str>) -> Result<String> {
    let raw = name.unwrap_or_default();
    let name = js::trim(raw);
    if name.is_empty() {
        return Err(GorynychError::new(ErrorCode::InvalidName, t("Введите имя ветки", &[])));
    }
    if !succeeds(cwd, &["check-ref-format", "--branch", name]).await {
        return Err(GorynychError::new(ErrorCode::InvalidName, t("Недопустимое имя ветки: «{0}»", &[&raw])).with_hint(t("Нельзя использовать пробелы, «..», «~», «^», «:», «?», «*», «[» и «\\».", &[])));
    }
    if succeeds(cwd, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")]).await {
        return Err(GorynychError::new(ErrorCode::BranchExists, t("Ветка «{0}» уже существует", &[&raw])));
    }
    Ok(name.to_owned())
}

/// Параметры `createBranch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CreateBranch {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub start: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub checkout: Option<bool>,
}

/// Результат `createBranch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreated {
    pub name: String,
    pub hash: String,
    pub checked_out: bool,
    pub previous: Position,
}

/// `createBranch`.
pub async fn create_branch(cwd: &Path, request: &CreateBranch) -> Result<BranchCreated> {
    let checkout = request.checkout != Some(false);
    if !has_head(cwd).await {
        return Err(GorynychError::new(ErrorCode::NoCommits, t("Сначала сделайте первый коммит", &[])));
    }
    if checkout {
        require_no_operation(&current_state(cwd).await?, "checkout")?;
    }
    let name = validate_branch_name(cwd, request.name.as_deref()).await?;
    // Начало ветки: хэш или любая ссылка (main, origin/main, тег). Проверяем, что она существует
    let mut start_point = "HEAD".to_owned();
    if let Some(start) = filled(request.start.as_deref()) {
        if start.starts_with('-') {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[])));
        }
        let Some(found) = commit_of(cwd, start).await else {
            return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Не найдено: {0}", &[&start])).with_hint(t("Проверьте имя ветки или сделайте Fetch.", &[])));
        };
        start_point = found;
    }
    let previous = current_position(cwd).await?;
    if checkout {
        git(cwd, &["switch", "--create", &name, &start_point]).await?;
    } else {
        git(cwd, &["branch", &name, &start_point]).await?;
    }
    let hash = trimmed(cwd, &["rev-parse", &name]).await?;
    Ok(BranchCreated { name, hash, checked_out: checkout, previous })
}

/// Разбирает командную строку без shell: кавычки группируют, спецсимволы оболочки ничего не делают.
pub fn split_args(line: &str) -> Result<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut has = false;
    for ch in line.chars() {
        if let Some(open) = quote {
            if ch == open {
                quote = None;
            } else {
                current.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
            has = true;
        } else if js::is_whitespace(ch) {
            if !current.is_empty() || has {
                args.push(std::mem::take(&mut current));
            }
            has = false;
        } else {
            current.push(ch);
        }
    }
    if quote.is_some() {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Незакрытая кавычка в команде", &[])));
    }
    if !current.is_empty() || has {
        args.push(current);
    }
    Ok(args)
}

/// Параметры `gitRaw`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GitRaw {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub command: Option<String>,
}

/// Результат `gitRaw`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GitRawResult {
    pub command: String,
    pub output: String,
}

/// `gitRaw`.
pub async fn git_raw(cwd: &Path, request: &GitRaw) -> Result<GitRawResult> {
    let command = request.command.as_deref().unwrap_or_default();
    let args = split_args(&GIT_PREFIX.replace(command, ""))?;
    if args.is_empty() {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Пустая команда", &[])));
    }
    let out = git_with(cwd, &args, no_editor()).await?;
    Ok(GitRawResult { command: format!("git {}", args.join(" ")), output: js::trim(&out).chars().take(4000).collect() })
}

/// Параметры `stash`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct StashPush {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub message: Option<String>,
}

/// Результат `stash`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct StashPushed {
    pub hash: String,
    #[specta(type = f64)]
    pub files: usize,
    #[specta(type = f64)]
    pub duplicates: usize,
}

/// `stashPush`.
pub(crate) async fn stash_push(cwd: &Path, message: Option<&str>) -> Result<StashPushed> {
    let files = read_status(cwd, false).await?;
    if files.is_empty() {
        return Err(GorynychError::new(ErrorCode::NothingToStash, t("Нет изменений для stash", &[])));
    }
    if !has_head(cwd).await {
        return Err(GorynychError::new(ErrorCode::NoCommits, t("Stash недоступен до первого коммита", &[])));
    }
    let mut args = vec!["stash", "push", "--include-untracked"];
    if let Some(text) = message.map(js::trim).filter(|text| !text.is_empty()) {
        args.extend(["-m", text]);
    }
    git(cwd, &args).await?;
    // Повторный Stash тех же правок: старая копия не нужна
    let duplicates = drop_older_duplicates(cwd, None).await.unwrap_or(0);
    Ok(StashPushed { hash: trimmed(cwd, &["rev-parse", "stash@{0}"]).await?, files: files.len(), duplicates })
}

/// Результат `stashPop`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct StashPopped {
    pub hash: String,
}

/// `stashPop`.
pub(crate) async fn stash_pop(cwd: &Path) -> Result<StashPopped> {
    let top = quiet(cwd, &["rev-parse", "--verify", "--quiet", "stash@{0}"]).await;
    if top.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoStash, t("Нет сташей", &[])));
    }
    git(cwd, &["stash", "pop"]).await?; // при конфликте stash остаётся в списке, ошибка = CONFLICT
    Ok(StashPopped { hash: top })
}

/// Параметры `stashApplyAt`, `stashPopAt`, `stashDrop`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct StashAt {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub id: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
}

/// Найденный stash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct StashRef {
    pub id: String,
    pub hash: String,
    pub message: String,
}

// stash@{n} сдвигаются при каждом изменении списка: проверяем, что по индексу всё ещё нужный stash
async fn resolve_stash(cwd: &Path, request: &StashAt) -> Result<StashRef> {
    let Some(id) = request.id.as_deref().filter(|id| STASH_ID.is_match(id)) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный stash", &[])));
    };
    let actual = quiet(cwd, &["rev-parse", "--verify", "--quiet", id]).await;
    if actual.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoStash, t("Stash не найден — список изменился", &[])));
    }
    if filled(request.hash.as_deref()).is_some_and(|hash| hash != actual) {
        return Err(GorynychError::new(ErrorCode::HistoryStale, t("Список stash изменился — обновите и повторите", &[])));
    }
    let message = quiet(cwd, &["log", "-1", "--format=%gs", "-g", id]).await;
    Ok(StashRef { id: id.to_owned(), hash: actual, message })
}

/// `stashApplyAt`.
pub async fn stash_apply_at(cwd: &Path, request: &StashAt) -> Result<StashRef> {
    require_no_operation(&current_state(cwd).await?, "apply")?;
    let stash = resolve_stash(cwd, request).await?;
    git(cwd, &["stash", "apply", &stash.id]).await?;
    Ok(stash)
}

/// `stashPopAt`.
pub async fn stash_pop_at(cwd: &Path, request: &StashAt) -> Result<StashRef> {
    require_no_operation(&current_state(cwd).await?, "pop")?;
    let stash = resolve_stash(cwd, request).await?;
    git(cwd, &["stash", "pop", &stash.id]).await?;
    Ok(stash)
}

/// `stashDropAt`.
pub async fn stash_drop_at(cwd: &Path, request: &StashAt) -> Result<StashRef> {
    let stash = resolve_stash(cwd, request).await?;
    git(cwd, &["stash", "drop", "-q", &stash.id]).await?;
    Ok(stash)
}

/// Параметры действий над коммитом.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct HashRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
}

/// Параметры `createTag`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CreateTag {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub message: Option<String>,
}

/// Результат `createTag` и `deleteTag`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct TagInfo {
    pub name: String,
    pub hash: String,
    pub message: Option<String>,
}

/// `createTag`.
pub async fn create_tag(cwd: &Path, request: &CreateTag) -> Result<TagInfo> {
    let hash = require_hash(request.hash.as_deref())?;
    let tag = js::trim(request.name.as_deref().unwrap_or_default());
    if tag.is_empty() {
        return Err(GorynychError::new(ErrorCode::InvalidName, t("Введите имя тега", &[])));
    }
    let full = format!("refs/tags/{tag}");
    if !succeeds(cwd, &["check-ref-format", &full]).await {
        return Err(GorynychError::new(ErrorCode::InvalidName, t("Недопустимое имя тега: «{0}»", &[&tag])));
    }
    if succeeds(cwd, &["show-ref", "--verify", "--quiet", &full]).await {
        return Err(GorynychError::new(ErrorCode::TagExists, t("Тег «{0}» уже существует", &[&tag])));
    }
    let message = request.message.as_deref().map(js::trim).filter(|text| !text.is_empty());
    match message {
        Some(text) => git(cwd, &["tag", "-a", tag, hash, "-m", text]).await?,
        None => git(cwd, &["tag", tag, hash]).await?,
    };
    Ok(TagInfo { name: tag.to_owned(), hash: hash.to_owned(), message: message.map(str::to_owned) })
}

/// Параметры `deleteTag`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct DeleteTag {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
}

/// `deleteTag`.
pub async fn delete_tag(cwd: &Path, request: &DeleteTag) -> Result<TagInfo> {
    let name = or_undefined(request.name.as_deref());
    let format = format!("--format=%(objecttype){FS}%(*objectname){FS}%(objectname){FS}%(contents)");
    let info = git(cwd, &["for-each-ref", &format, &format!("refs/tags/{name}")]).await?;
    if js::trim(&info).is_empty() {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Тег «{0}» не найден", &[&request.name.as_deref().unwrap_or_default()])));
    }
    let mut fields = info.split(FS);
    let mut next = || fields.next().unwrap_or_default();
    let (kind, peeled, object, contents) = (next(), next(), next(), next());
    git(cwd, &["tag", "-d", name]).await?;
    let annotated = kind == "tag";
    Ok(TagInfo { name: name.to_owned(), hash: if annotated { peeled.to_owned() } else { js::trim(object).to_owned() }, message: annotated.then(|| js::trim(contents).to_owned()) })
}

/// Параметры `renameBranch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RenameBranch {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub from: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub to: Option<String>,
}

/// Результат `renameBranch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchRenamed {
    pub from: String,
    pub to: String,
}

/// `renameBranch`. Ветка на сервере не трогается, upstream сохраняется.
pub async fn rename_branch(cwd: &Path, request: &RenameBranch) -> Result<BranchRenamed> {
    let next = js::trim(request.to.as_deref().unwrap_or_default());
    let Some(from) = filled(request.from.as_deref()).filter(|_| !next.is_empty()) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Укажите новое имя ветки", &[])));
    };
    if next == from {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Имя не изменилось", &[])));
    }
    if branch_tip(cwd, from).await.is_none() {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Ветка «{0}» не найдена", &[&from])));
    }
    if !succeeds(cwd, &["check-ref-format", "--branch", next]).await {
        return Err(GorynychError::new(ErrorCode::InvalidName, t("Недопустимое имя ветки: «{0}»", &[&next])).with_hint(t("Без пробелов, «..», «~», «^», «:», «?», «*», «[» и «\\».", &[])));
    }
    if branch_tip(cwd, next).await.is_some() {
        return Err(GorynychError::new(ErrorCode::BranchExists, t("Ветка «{0}» уже есть", &[&next])));
    }
    git(cwd, &["branch", "-m", from, next]).await?;
    Ok(BranchRenamed { from: from.to_owned(), to: next.to_owned() })
}

/// Параметры `deleteBranch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct DeleteBranch {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub force: Option<bool>,
}

/// Результат `deleteBranch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchDeleted {
    pub name: String,
    pub hash: String,
}

/// `deleteBranch`.
pub async fn delete_branch(cwd: &Path, request: &DeleteBranch) -> Result<BranchDeleted> {
    let name = or_undefined(request.name.as_deref());
    let state = current_state(cwd).await?;
    if state.branch_name.as_deref() == request.name.as_deref() && state.branch_name.is_some() {
        return Err(GorynychError::new(ErrorCode::CurrentBranch, t("Нельзя удалить текущую ветку", &[])).with_hint(t("Сначала переключитесь на другую ветку.", &[])));
    }
    let Some(hash) = branch_tip(cwd, name).await else {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Ветка «{0}» не найдена", &[&request.name.as_deref().unwrap_or_default()])));
    };
    let flag = if request.force == Some(true) { "-D" } else { "-d" };
    if let Err(error) = git(cwd, &["branch", flag, name]).await {
        if NOT_MERGED.is_match(&error.details) {
            return Err(GorynychError::new(ErrorCode::NotMerged, t("Ветка «{0}» не слита с текущей", &[&name])).with_hint(t("Коммиты, которые есть только в этой ветке, станут недоступны (их можно вернуть через Undo).", &[])));
        }
        return Err(error);
    }
    Ok(BranchDeleted { name: name.to_owned(), hash })
}

/// Результат `cherryPick` и `revert`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct HeadMoved {
    pub hash: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// `cherryPick`.
pub async fn cherry_pick(cwd: &Path, request: &HashRequest) -> Result<HeadMoved> {
    let hash = require_hash(request.hash.as_deref())?;
    let state = current_state(cwd).await?;
    require_head(&state, "cherry-pick")?;
    if is_ancestor(cwd, hash, "HEAD").await {
        return Err(GorynychError::new(ErrorCode::AlreadyInBranch, t("Этот коммит уже есть в текущей ветке", &[])));
    }
    let mut args = vec!["cherry-pick"];
    if parents_of(cwd, hash).await? > 1 {
        args.extend(["-m", "1"]); // мердж: относительно 1-го родителя
    }
    args.push(hash);
    git_with(cwd, &args, no_editor()).await?;
    Ok(HeadMoved { hash: hash.to_owned(), from: state.head_hash, to: head_hash(cwd).await })
}

/// `revertCommit`.
pub async fn revert_commit(cwd: &Path, request: &HashRequest) -> Result<HeadMoved> {
    let hash = require_hash(request.hash.as_deref())?;
    let state = current_state(cwd).await?;
    require_head(&state, "revert")?;
    let mut args = vec!["revert", "--no-edit"];
    if parents_of(cwd, hash).await? > 1 {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    git_with(cwd, &args, no_editor()).await?;
    Ok(HeadMoved { hash: hash.to_owned(), from: state.head_hash, to: head_hash(cwd).await })
}

/// Параметры `reset`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ResetRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub mode: Option<String>,
}

/// Результат `reset`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ResetResult {
    pub hash: String,
    pub mode: String,
    pub branch: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// `resetTo`.
pub async fn reset_to(cwd: &Path, request: &ResetRequest) -> Result<ResetResult> {
    let hash = require_hash(request.hash.as_deref())?;
    let mode = request.mode.as_deref().unwrap_or("mixed");
    if !matches!(mode, "soft" | "mixed" | "hard") {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестный режим reset", &[])));
    }
    let state = current_state(cwd).await?;
    require_head(&state, "reset")?;
    git(cwd, &["reset", &format!("--{mode}"), hash]).await?;
    Ok(ResetResult { hash: hash.to_owned(), mode: mode.to_owned(), branch: state.branch_name, from: state.head_hash, to: head_hash(cwd).await })
}

/// Параметры `merge` и `rebase`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RefRequest {
    #[serde(rename = "ref", deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub reference: Option<String>,
}

/// Результат `merge` и `rebase`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RefMoved {
    #[serde(rename = "ref")]
    pub reference: String,
    pub branch: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// `mergeRef`.
pub async fn merge_ref(cwd: &Path, request: &RefRequest) -> Result<RefMoved> {
    let reference = or_undefined(request.reference.as_deref());
    let state = current_state(cwd).await?;
    require_branch(&state, "merge")?;
    if commit_of(cwd, reference).await.is_none() {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Не найдено: {0}", &[&request.reference.as_deref().unwrap_or_default()])));
    }
    let branch = state.branch_name.clone().unwrap_or_default();
    if is_ancestor(cwd, reference, "HEAD").await {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("{0} уже слита в {1}", &[&reference, &branch])));
    }
    git_with(cwd, &["merge", "--no-edit", reference], no_editor()).await?;
    Ok(RefMoved { reference: reference.to_owned(), branch: Some(branch), from: state.head_hash, to: head_hash(cwd).await })
}

/// `rebaseOnto`.
pub async fn rebase_onto(cwd: &Path, request: &RefRequest) -> Result<RefMoved> {
    let reference = or_undefined(request.reference.as_deref());
    let state = current_state(cwd).await?;
    require_branch(&state, "rebase")?;
    let branch = state.branch_name.clone().unwrap_or_default();
    if is_ancestor(cwd, reference, "HEAD").await {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("{0} уже содержит {1}", &[&branch, &reference])));
    }
    git_with(cwd, &["rebase", reference], no_editor()).await?;
    Ok(RefMoved { reference: reference.to_owned(), branch: Some(branch), from: state.head_hash, to: head_hash(cwd).await })
}

/// Параметры `fastForward`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct FastForward {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub to: Option<String>,
}

/// Результат `fastForward`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FastForwarded {
    pub branch: String,
    pub from: String,
    pub to: String,
    pub current: bool,
}

/// `fastForward`: перемотать ветку вперёд без переключения на неё.
pub async fn fast_forward(cwd: &Path, request: &FastForward) -> Result<FastForwarded> {
    let (Some(branch), Some(to)) = (filled(request.branch.as_deref()), filled(request.to.as_deref()).filter(|to| !to.starts_with('-'))) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
    };
    let Some(tip) = branch_tip(cwd, branch).await else {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Ветка «{0}» не найдена", &[&branch])));
    };
    let Some(target) = commit_of(cwd, to).await else {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Не найдено: {0}", &[&to])));
    };
    if tip == target {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("{0} уже указывает на этот коммит", &[&branch])));
    }
    if !is_ancestor(cwd, &tip, &target).await {
        let shown = if js::utf16_len(to) == 40 { short(to) } else { to.to_owned() };
        return Err(GorynychError::new(ErrorCode::NotFastForward, t("Перемотать {0} нельзя: в ней есть коммиты, которых нет в {1}", &[&branch, &shown])).with_hint(t("Используйте слияние (merge) или rebase.", &[])));
    }
    let state = current_state(cwd).await?;
    let current = state.branch_name.as_deref() == Some(branch);
    if current {
        require_no_operation(&state, "fast-forward")?;
        git(cwd, &["merge", "--ff-only", &target]).await?;
    } else {
        git(cwd, &["update-ref", "-m", &format!("fast-forward: {branch}"), &format!("refs/heads/{branch}"), &target, &tip]).await?;
    }
    Ok(FastForwarded { branch: branch.to_owned(), from: tip, to: target, current })
}

/// Результат `discardAll`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Discarded {
    #[specta(type = f64)]
    pub files: usize,
}

/// `discardAll`.
pub async fn discard_all(cwd: &Path) -> Result<Discarded> {
    require_no_operation(&current_state(cwd).await?, "discard")?;
    let files = read_status(cwd, false).await?;
    if files.is_empty() {
        return Err(GorynychError::new(ErrorCode::NothingToDiscard, t("Нет изменений", &[])));
    }
    if has_head(cwd).await {
        git(cwd, &["reset", "--hard", "-q", "HEAD"]).await?;
    } else {
        git(cwd, &["rm", "-r", "-q", "--cached", "--ignore-unmatch", "."]).await?;
    }
    git(cwd, &["clean", "-fd", "-q"]).await?;
    Ok(Discarded { files: unique_paths(&files) })
}

/// Коммит в предпросмотре возврата.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PreviewCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Коммит, к которому возвращаемся.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PreviewTarget {
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Результат `revertToPreview`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RevertPreview {
    pub hash: String,
    pub target: PreviewTarget,
    pub branch: Option<String>,
    pub ancestor: bool,
    #[specta(type = f64)]
    pub count: u64,
    pub commits: Vec<PreviewCommit>,
    #[specta(type = f64)]
    pub files_changed: u64,
    #[specta(type = f64)]
    pub insertions: u64,
    #[specta(type = f64)]
    pub deletions: u64,
    pub identical: bool,
    #[specta(type = f64)]
    pub dirty_count: usize,
    pub collisions: Vec<String>,
    #[specta(type = f64)]
    pub pushed_count: u64,
    pub has_upstream: bool,
}

fn number_in(pattern: &Regex, text: &str) -> u64 {
    pattern.captures(text).and_then(|caps| caps[1].parse().ok()).unwrap_or(0)
}

/// `revertToPreview`: что отменится, сколько файлов изменится, можно ли выполнить.
pub async fn revert_to_preview(cwd: &Path, request: &HashRequest) -> Result<RevertPreview> {
    let hash = require_hash(request.hash.as_deref())?;
    let state = current_state(cwd).await?;
    require_head(&state, "revert")?;
    let head = state.head_hash.clone().unwrap_or_default();
    let ancestor = is_ancestor(cwd, hash, &head).await;
    let range = format!("{hash}..{head}");
    let count = trimmed(cwd, &["rev-list", "--count", &range]).await?.parse().unwrap_or(0);
    let format = format!("--format=%H{FS}%s{FS}%an{FS}%aI");
    let log = git(cwd, &["log", "-n", "30", &format, &range]).await?;
    let commits = log
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FS).map(str::to_owned);
            let mut next = || fields.next().unwrap_or_default();
            PreviewCommit { hash: next(), message: next(), author: next(), date: next() }
        })
        .collect();
    let shortstat = trimmed(cwd, &["diff", "--shortstat", &head, hash]).await?;
    let format = format!("--format=%s{FS}%an{FS}%aI");
    let target = trimmed(cwd, &["log", "-1", &format, hash]).await?;
    let mut fields = target.split(FS).map(str::to_owned);
    let mut next = || fields.next().unwrap_or_default();
    let target = PreviewTarget { message: next(), author: next(), date: next() };

    let files = read_status(cwd, false).await?;
    let dirty_count = files.iter().filter(|file| file.untracked != Some(true)).count();
    // Неотслеживаемые файлы, которые совпадают по пути с файлами в целевом коммите, были бы перезаписаны
    let untracked: Vec<&str> = files.iter().filter(|file| file.untracked == Some(true)).map(|file| file.path.as_str()).collect();
    let mut collisions = Vec::new();
    if !untracked.is_empty() {
        let listing = git(cwd, &["ls-tree", "-r", "-z", "--name-only", hash]).await?;
        let in_target: std::collections::HashSet<&str> = listing.split('\0').collect();
        collisions = untracked.into_iter().filter(|path| in_target.contains(path)).map(str::to_owned).collect();
    }
    let upstream = state.branch.as_ref().and_then(|branch| branch.upstream.as_deref());
    let mut pushed_count = 0;
    if let (Some(upstream), true) = (upstream, ancestor) {
        pushed_count = git(cwd, &["rev-list", "--count", &format!("{hash}..{upstream}")]).await.ok().and_then(|out| js::trim(&out).parse().ok()).unwrap_or(0);
    }
    Ok(RevertPreview {
        hash: hash.to_owned(),
        target,
        branch: state.branch_name.clone(),
        ancestor,
        count,
        commits,
        files_changed: number_in(&FILES_CHANGED, &shortstat),
        insertions: number_in(&INSERTIONS, &shortstat),
        deletions: number_in(&DELETIONS, &shortstat),
        identical: shortstat.is_empty(),
        dirty_count,
        collisions,
        pushed_count,
        has_upstream: upstream.is_some(),
    })
}

/// Параметры `revertTo`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RevertTo {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub message: Option<String>,
}

/// Результат `revertTo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RevertedTo {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    #[specta(type = f64)]
    pub count: u64,
    #[specta(type = f64)]
    pub files_changed: u64,
    pub branch: Option<String>,
}

/// `revertTo`: один новый коммит, который делает файлы проекта такими, как в выбранном. История не переписывается.
pub async fn revert_to(cwd: &Path, request: &RevertTo) -> Result<RevertedTo> {
    let preview = revert_to_preview(cwd, &HashRequest { hash: request.hash.clone() }).await?;
    if preview.identical {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Файлы уже совпадают с этим коммитом — откатывать нечего", &[])));
    }
    if preview.dirty_count > 0 {
        return Err(GorynychError::new(ErrorCode::Dirty, t("Есть незакоммиченные изменения ({0})", &[&preview.dirty_count])).with_hint(t("Закоммитьте их или сделайте Stash, затем повторите.", &[])));
    }
    if !preview.collisions.is_empty() {
        let shown = preview.collisions.iter().take(5).map(String::as_str).collect::<Vec<_>>().join(", ");
        let more = if preview.collisions.len() > 5 { "…" } else { "" };
        return Err(GorynychError::new(ErrorCode::Dirty, t("Неотслеживаемые файлы мешают откату", &[])).with_hint(t("Переместите или удалите: {0}{1}", &[&shown, &more])));
    }
    let hash = &preview.hash;
    let from = trimmed(cwd, &["rev-parse", "HEAD"]).await?;
    let subject = request.message.as_deref().map(js::trim).filter(|text| !text.is_empty()).map_or_else(|| format!("Revert to {}: {}", short(hash), preview.target.message), str::to_owned);
    let body = if preview.ancestor {
        let list = preview.commits.iter().map(|commit| format!("- {} {}", short(&commit.hash), commit.message)).collect::<Vec<_>>().join("\n");
        let more = if preview.count > preview.commits.len() as u64 { "\n- …" } else { "" };
        t("Файлы возвращены к состоянию {0}.\nОтменены изменения {1} коммитов:\n{2}{3}", &[hash, &preview.count, &list, &more])
    } else {
        t("Файлы приведены к состоянию {0}.", &[hash])
    };
    // Индекс и рабочие файлы: ровно как в целевом коммите (удалённые там файлы тоже удаляются)
    git(cwd, &["read-tree", "-u", "--reset", hash]).await?;
    git(cwd, &["commit", "-q", "-m", &subject, "-m", &body]).await?;
    let to = trimmed(cwd, &["rev-parse", "HEAD"]).await?;
    Ok(RevertedTo { hash: hash.clone(), from, to, subject, count: preview.count, files_changed: preview.files_changed, branch: preview.branch.clone() })
}

/// Результат `abortOperation` и `continueOperation`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct OperationResult {
    pub operation: String,
    pub finished: Option<bool>,
}

fn no_operation() -> GorynychError {
    GorynychError::new(ErrorCode::NoOperation, t("Нет незавершённой операции", &[]))
}

/// `abortOperation`.
pub async fn abort_operation(cwd: &Path) -> Result<OperationResult> {
    let operation = detect_operation(cwd).await.ok_or_else(no_operation)?;
    git(cwd, &[operation, "--abort"]).await?;
    Ok(OperationResult { operation: operation.to_owned(), finished: None })
}

/// `continueOperation`. `rebase_env`: окружение интерактивного rebase из приложения.
pub(crate) async fn continue_operation(cwd: &Path, rebase_env: Option<Vec<(String, String)>>) -> Result<OperationResult> {
    let operation = detect_operation(cwd).await.ok_or_else(no_operation)?;
    let conflicted: Vec<String> = read_status(cwd, false).await?.into_iter().filter(|file| file.status == "U").map(|file| file.path).collect();
    if !conflicted.is_empty() {
        return Err(GorynychError::new(ErrorCode::Conflict, t("Остались неразрешённые конфликты: {0}", &[&conflicted.len()])).with_hint(t("Исправьте файлы с пометкой U и застейджите их (кнопка + в списке файлов).", &[])).with_details(conflicted.join("\n")));
    }
    if operation == "merge" {
        git_with(cwd, &["commit", "--no-edit"], no_editor()).await?;
    } else {
        // Интерактивный rebase из приложения: reword и squash после конфликта получают заранее заданные сообщения
        let options = match rebase_env.filter(|_| operation == "rebase") {
            Some(env) => GitOptions { env, ..GitOptions::default() },
            None => no_editor(),
        };
        git_with(cwd, &[operation, "--continue"], options).await?;
    }
    Ok(OperationResult { operation: operation.to_owned(), finished: Some(detect_operation(cwd).await.is_none()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_split_like_1x() {
        let split = |line: &str| split_args(line).unwrap();
        assert_eq!(split(r#"log --format="%h %s" 'a b' "" x"#), ["log", "--format=%h %s", "a b", "", "x"]);
        assert_eq!(split("  a\t b  "), ["a", "b"]);
        assert_eq!(split("a;b|c"), ["a;b|c"]);
        assert!(split("").is_empty());
        assert_eq!(split_args("a 'b").unwrap_err().code, ErrorCode::BadArgs);
    }

    #[test]
    fn prefix_is_removed_only_with_space() {
        assert_eq!(GIT_PREFIX.replace("  git  log", ""), "log");
        assert_eq!(GIT_PREFIX.replace("gitlog", ""), "gitlog");
        assert_eq!(GIT_PREFIX.replace("git", ""), "git");
    }
}
