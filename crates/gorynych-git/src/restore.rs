//! Откат файла или фрагмента без коммита: меняется только рабочая папка или индекс. Перенос `electron/restore.cjs`.
//!
//! ## Конспект
//! - Перед изменением рабочего файла запоминается его содержимое для Undo. Файл больше 20 МБ (до или после) не запоминается: `snapshot` пуст, операция не отменяется.
//! - `restoreFile`: `side = before` берёт первого родителя, `sourcePath` — имя файла в той версии. Файла нет в версии — удаляется из папки. Нет нигде или совпал — `UP_TO_DATE`.
//! - `restoreFromStash`: отслеживаемые из самого stash, новые из третьего родителя. Сперва проверяется наличие всех файлов, чтобы не применить половину. Индекс не трогается.
//! - `applyHunks`: патч собирается из выбранных фрагментов и применяется `git apply`. Фрагменты сравниваются по заголовку без описания функции. Изменившийся diff — `HUNK_STALE`, не применился — `PATCH_FAILED` с текстом по действию.
//! - `writeSnapshot`: файл должен совпасть с ожидаемым, иначе `HISTORY_STALE`: чужие правки не затираются.
//!
//! Текст diff здесь, как и в 1.x, читается как UTF-8: фрагменты файла в другой кодировке не применятся и дадут `PATCH_FAILED`.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use gorynych_core::paths::safe_relative;
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::Deserialize;

use crate::common::{fs_error, lenient, remove_file_force, succeeds, trimmed, write_creating_dirs};
use crate::read::{is_hash, resolve_repo_root};
use crate::run::{git, git_bytes, GitOptions};

const MAX_SNAPSHOT: usize = 20 * 1024 * 1024;
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

static HUNK_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^@@ -[0-9]+(?:,[0-9]+)? \+[0-9]+(?:,[0-9]+)? @@").expect("корректный шаблон"));
static BINARY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^(?:Binary files |GIT binary patch)").expect("корректный шаблон"));

/// Содержимое файла до и после операции. `None` — файла не было.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub path: String,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

fn read_file_or_null(full: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::read(full) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(fs_error(error)),
    }
}

fn safe(root: &Path, rel: &str) -> Result<std::path::PathBuf> {
    safe_relative(root, rel, i18n::language())
}

fn require_hash(hash: Option<&str>) -> Result<&str> {
    hash.filter(|hash| is_hash(hash)).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[])))
}

async fn first_parent(cwd: &Path, hash: &str) -> Result<Option<String>> {
    let out = trimmed(cwd, &["rev-list", "--parents", "-n", "1", hash]).await?;
    Ok(out.split(' ').nth(1).map(str::to_owned))
}

async fn exists_in(cwd: &Path, rev: &str, file: &str) -> bool {
    succeeds(cwd, &["cat-file", "-e", &format!("{rev}:{file}")]).await
}

fn snapshot(root: &Path, file: &str, before: Option<Vec<u8>>) -> Result<Option<Snapshot>> {
    let after = read_file_or_null(&safe(root, file)?)?;
    let size = before.as_ref().map_or(0, Vec::len).max(after.as_ref().map_or(0, Vec::len));
    Ok((size <= MAX_SNAPSHOT).then(|| Snapshot { path: file.to_owned(), before, after }))
}

/// Параметры `restoreFile`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct RestoreFile {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub path: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub side: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub source_path: Option<String>,
}

/// Результат `restoreFile`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredFile {
    pub path: String,
    pub source: String,
    pub side: String,
    pub deleted: bool,
    pub snapshot: Option<Snapshot>,
}

/// `restoreFile`.
pub async fn restore_file(cwd: &Path, request: &RestoreFile) -> Result<RestoredFile> {
    let hash = require_hash(request.hash.as_deref())?;
    let root = resolve_repo_root(cwd).await?;
    let file = request.path.as_deref().unwrap_or_default();
    let full = safe(&root, file)?;
    let from = request.source_path.as_deref().filter(|source| !source.is_empty() && *source != file).unwrap_or(file);
    if from != file {
        safe(&root, from)?;
    }
    let side = request.side.as_deref().unwrap_or("after");
    let source = if side == "before" { first_parent(&root, hash).await? } else { Some(hash.to_owned()) };
    let before = read_file_or_null(&full)?;
    let present = match &source {
        Some(source) => exists_in(&root, source, from).await,
        None => false,
    };
    if present && from != file {
        let spec = format!("{}:{from}", source.as_deref().unwrap_or_default());
        let bytes = git_bytes(&root, &["cat-file", "blob", &spec], GitOptions::default()).await?;
        write_creating_dirs(&full, &bytes)?;
    } else if present {
        let flag = format!("--source={}", source.as_deref().unwrap_or_default());
        git(&root, &["restore", &flag, "--worktree", "--", file]).await?;
    } else if before.is_some() {
        remove_file_force(&full)?;
    } else {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Файла нет ни в рабочей папке, ни в той версии — менять нечего", &[])));
    }
    let snap = snapshot(&root, file, before)?;
    if snap.as_ref().is_some_and(|snap| snap.before.is_some() && snap.before == snap.after) {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Файл уже совпадает с этой версией", &[])));
    }
    Ok(RestoredFile { path: file.to_owned(), source: source.unwrap_or_else(|| EMPTY_TREE.to_owned()), side: side.to_owned(), deleted: !present, snapshot: snap })
}

/// Файл из списка файлов stash.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct StashFile {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub path: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub old_path: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub status: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub untracked: Option<bool>,
}

/// Параметры `restoreFromStash`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RestoreFromStash {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<Vec<Option<StashFile>>>)]
    pub files: Option<Vec<Option<StashFile>>>,
    /// Только для подписи в истории.
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub id: Option<String>,
}

/// Результат `restoreFromStash`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredStashFiles {
    pub files: usize,
    pub changed: usize,
    pub snapshots: Vec<Snapshot>,
    pub complete: bool,
}

#[derive(PartialEq, Eq)]
enum Step {
    Source(String),
    Remove,
}

/// `restoreFromStash`.
pub async fn restore_from_stash(cwd: &Path, request: &RestoreFromStash) -> Result<RestoredStashFiles> {
    let hash = require_hash(request.hash.as_deref())?;
    let files = request.files.as_deref().filter(|files| !files.is_empty()).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Не выбраны файлы", &[])))?;
    let root = resolve_repo_root(cwd).await?;
    let out = trimmed(&root, &["rev-list", "--parents", "-n", "1", hash]).await?;
    let parents: Vec<&str> = out.split(' ').skip(1).collect();
    if parents.len() < 2 {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Это не stash", &[])));
    }
    let untracked_commit = parents.get(2).copied();

    let mut plan: IndexMap<String, Step> = IndexMap::new();
    for file in files {
        let Some((file, path)) = file.as_ref().and_then(|file| Some((file, file.path.as_deref()?))) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный файл", &[])));
        };
        safe(&root, path)?;
        if file.status.as_deref() == Some("D") {
            plan.insert(path.to_owned(), Step::Remove);
        } else {
            let source = if file.untracked == Some(true) { untracked_commit } else { Some(hash) };
            let Some(source) = source else {
                return Err(GorynychError::new(ErrorCode::NotFound, t("Файла {0} нет в stash", &[&path])));
            };
            plan.insert(path.to_owned(), Step::Source(source.to_owned()));
        }
        if let Some(old) = file.old_path.as_deref().filter(|old| !old.is_empty() && *old != path) {
            safe(&root, old)?;
            plan.entry(old.to_owned()).or_insert(Step::Remove);
        }
    }

    let mut before: IndexMap<&str, Option<Vec<u8>>> = IndexMap::new();
    for file in plan.keys() {
        before.insert(file, read_file_or_null(&safe(&root, file)?)?);
    }

    // Сначала проверяем, что всё есть в stash, чтобы не применить половину
    let mut by_source: IndexMap<&str, Vec<&str>> = IndexMap::new();
    for (file, step) in &plan {
        let Step::Source(source) = step else {
            continue;
        };
        if !exists_in(&root, source, file).await {
            return Err(GorynychError::new(ErrorCode::NotFound, t("Файла {0} нет в stash", &[file])));
        }
        by_source.entry(source).or_default().push(file);
    }
    for (source, list) in by_source {
        let flag = format!("--source={source}");
        for part in list.chunks(100) {
            let mut args = vec!["restore", &flag, "--worktree", "--"];
            args.extend_from_slice(part);
            git(&root, &args).await?;
        }
    }
    for (file, step) in &plan {
        if *step == Step::Remove {
            remove_file_force(&safe(&root, file)?)?;
        }
    }

    let (mut snapshots, mut changed) = (Vec::new(), 0);
    for (file, previous) in before {
        let after = read_file_or_null(&safe(&root, file)?)?;
        let same = previous == after;
        if !same {
            changed += 1;
        }
        if let Some(snap) = snapshot(&root, file, previous)?
            && !same
        {
            snapshots.push(snap);
        }
    }
    if changed == 0 {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Эти файлы в рабочей папке уже такие же, как в stash", &[])));
    }
    let complete = snapshots.len() == changed;
    Ok(RestoredStashFiles { files: files.len(), changed, snapshots, complete })
}

/// `hunkKey`: заголовок фрагмента без описания функции.
pub fn hunk_key(header: &str) -> Option<String> {
    HUNK_KEY.find(js::trim(header)).map(|found| found.as_str().to_owned())
}

/// Фрагмент diff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    pub key: Option<String>,
    pub lines: Vec<String>,
}

/// `splitHunks`.
pub fn split_hunks(diff: &str) -> Vec<Hunk> {
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut open = false;
    for line in diff.split('\n') {
        if line.starts_with("@@ ") {
            hunks.push(Hunk { key: hunk_key(line), lines: vec![line.to_owned()] });
            open = true;
        } else if open && (line.is_empty() || line.starts_with([' ', '+', '-', '\\'])) {
            let current = hunks.last_mut().expect("фрагмент открыт");
            if line.is_empty() && current.lines.last().is_some_and(String::is_empty) {
                continue;
            }
            current.lines.push(line.to_owned());
        } else if open && line.starts_with("diff --git") {
            open = false;
        }
    }
    for hunk in &mut hunks {
        while hunk.lines.last().is_some_and(String::is_empty) {
            hunk.lines.pop();
        }
    }
    hunks
}

fn build_patch(file: &str, hunks: &[&Hunk]) -> String {
    let name = file.replace('\\', "/");
    let body: Vec<String> = hunks.iter().map(|hunk| hunk.lines.join("\n")).collect();
    format!("diff --git a/{name} b/{name}\n--- a/{name}\n+++ b/{name}\n{}\n", body.join("\n"))
}

/// Параметры `applyHunks`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct ApplyHunks {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub op: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub mode: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub path: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub old_path: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<Vec<String>>)]
    pub hunks: Option<Vec<String>>,
}

/// Результат `applyHunks`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedHunks {
    pub op: String,
    pub path: String,
    pub hunks: usize,
    pub total: usize,
    pub snapshot: Option<Snapshot>,
}

async fn raw_diff(root: &Path, mode: &str, hash: Option<&str>, file: &str, old_path: Option<&str>) -> Result<String> {
    let old = old_path.filter(|old| !old.is_empty() && *old != file);
    let mut paths = vec!["--"];
    paths.extend(old);
    paths.push(file);
    let base = ["--no-color", "--no-ext-diff", "-U3"];
    let mut args: Vec<&str> = vec!["diff"];
    let parent;
    match mode {
        "commit" => {
            let hash = require_hash(hash)?;
            parent = first_parent(root, hash).await?.unwrap_or_else(|| EMPTY_TREE.to_owned());
            args.extend(base);
            args.extend(["-M", &parent, hash]);
        }
        "staged" => {
            args.push("--cached");
            args.extend(base);
        }
        "unstaged" => args.extend(base),
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестный режим", &[]))),
    }
    args.extend(paths);
    git(root, &args).await
}

async fn apply_patch(root: &Path, patch: &str, args: &[&str]) -> Result<()> {
    let dir = tempfile::Builder::new().prefix("gk-patch-").tempdir().map_err(fs_error)?;
    let file = dir.path().join("hunk.patch");
    std::fs::write(&file, patch).map_err(fs_error)?;
    let mut command: Vec<&OsStr> = vec![OsStr::new("apply"), OsStr::new("--whitespace=nowarn")];
    command.extend(args.iter().map(OsStr::new));
    command.push(file.as_os_str());
    git(root, &command).await.map(|_| ())
}

/// `applyHunks`. Пустой список фрагментов означает все фрагменты файла.
pub async fn apply_hunks(cwd: &Path, request: &ApplyHunks) -> Result<AppliedHunks> {
    let op = request.op.as_deref().unwrap_or_default();
    let mode = request.mode.as_deref().unwrap_or_default();
    let (modes, args, worktree): (&str, &[&str], bool) = match op {
        "revert" => ("commit", &["-R"], true),
        "discard" => ("unstaged", &["-R"], true),
        "apply" => ("commit", &[], true),
        "stage" => ("unstaged", &["--cached"], false),
        "unstage" => ("staged", &["-R", "--cached"], false),
        _ => ("", &[], false),
    };
    if modes.is_empty() || modes != mode {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестное действие с фрагментом", &[])));
    }
    let root = resolve_repo_root(cwd).await?;
    let file = request.path.as_deref().unwrap_or_default();
    let full = safe(&root, file)?;
    if let Some(old) = request.old_path.as_deref().filter(|old| !old.is_empty()) {
        safe(&root, old)?;
    }

    let diff = raw_diff(&root, mode, request.hash.as_deref(), file, request.old_path.as_deref()).await?;
    if BINARY.is_match(&diff) {
        let mut error = GorynychError::new(ErrorCode::Binary, t("Бинарный файл — по фрагментам не меняется", &[]));
        if op == "revert" {
            error = error.with_hint(t("Используйте «Вернуть файл к версии…» для всего файла.", &[]));
        }
        return Err(error);
    }
    let all = split_hunks(&diff);
    if all.is_empty() {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("В файле нет изменений", &[])));
    }

    let mut chosen: Vec<&Hunk> = all.iter().collect();
    if let Some(wanted) = request.hunks.as_deref().filter(|wanted| !wanted.is_empty()) {
        let keys: IndexSet<Option<String>> = wanted.iter().map(|header| hunk_key(header)).collect();
        chosen.retain(|hunk| keys.contains(&hunk.key));
        if chosen.len() != keys.len() {
            return Err(GorynychError::new(ErrorCode::HunkStale, t("Фрагмент не найден — diff изменился", &[]))
                .with_hint(t("Обновите просмотр. Если включено «игнорировать пробелы», выключите его: фрагменты считаются по точному тексту.", &[])));
        }
    }

    if worktree && !full.exists() {
        let mut error = GorynychError::new(ErrorCode::NotFound, t("Файла нет в рабочей папке", &[]));
        if op == "revert" {
            error = error.with_hint(t("Используйте «Вернуть файл к версии до этого коммита» — он создаст файл заново.", &[]));
        } else if op == "apply" {
            error = error.with_hint(t("Восстановите файл из stash целиком.", &[]));
        }
        return Err(error);
    }
    let before = if worktree { read_file_or_null(&full)? } else { None };
    if let Err(error) = apply_patch(&root, &build_patch(file, &chosen), args).await {
        let (message, hint) = match op {
            "apply" => (t("Фрагмент не применяется: эти строки в рабочей папке уже другие", &[]), t("Восстановите файл из stash целиком (он заменит текущую версию; Undo вернёт).", &[])),
            "revert" => (t("Этот фрагмент уже изменён в рабочей папке — автоматически отменить нельзя", &[]), t("Строки вокруг него поменялись после коммита. Можно вернуть файл целиком к версии до этого коммита.", &[])),
            _ => (t("Фрагмент не применяется — файл изменился", &[]), t("Обновите просмотр и повторите.", &[])),
        };
        return Err(GorynychError::new(ErrorCode::PatchFailed, message).with_hint(hint).with_details(error.details));
    }
    let snapshot = if worktree { snapshot(&root, file, before)? } else { None };
    Ok(AppliedHunks { op: op.to_owned(), path: file.to_owned(), hunks: chosen.len(), total: all.len(), snapshot })
}

/// Какую версию снимка записать.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotSide {
    Before,
    After,
}

/// `writeSnapshot`.
pub async fn write_snapshot(cwd: &Path, snap: &Snapshot, which: SnapshotSide) -> Result<()> {
    let root = resolve_repo_root(cwd).await?;
    let full = safe(&root, &snap.path)?;
    let (expected, data) = match which {
        SnapshotSide::Before => (&snap.after, &snap.before),
        SnapshotSide::After => (&snap.before, &snap.after),
    };
    if read_file_or_null(&full)? != *expected {
        return Err(GorynychError::new(ErrorCode::HistoryStale, t("Нельзя отменить: файл {0} изменился после операции", &[&snap.path]))
            .with_hint(t("Файл правили после отката — верните его вручную или через diff.", &[])));
    }
    match data {
        None => remove_file_force(&full),
        Some(data) => write_creating_dirs(&full, data),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunk_keys() {
        assert_eq!(hunk_key("  @@ -1,4 +1,6 @@ fn main()").as_deref(), Some("@@ -1,4 +1,6 @@"));
        assert_eq!(hunk_key("@@ -1 +1 @@").as_deref(), Some("@@ -1 +1 @@"));
        assert_eq!(hunk_key("не заголовок"), None);
    }

    #[test]
    fn hunks_are_split_without_trailing_blanks() {
        let diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@ a\n-x\n+y\n@@ -5 +5 @@\n z\n\\ No newline at end of file\n\n\ndiff --git a/g b/g\n--- a/g\n";
        let hunks = split_hunks(diff);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].lines, ["@@ -1 +1 @@ a", "-x", "+y"]);
        assert_eq!(hunks[1].lines, ["@@ -5 +5 @@", " z", "\\ No newline at end of file"]);
    }

    #[test]
    fn patch_uses_forward_slashes() {
        let hunk = Hunk { key: None, lines: vec!["@@ -1 +1 @@".into(), "-a".into(), "+b".into()] };
        assert_eq!(build_patch(r"п\f", &[&hunk]), "diff --git a/п/f b/п/f\n--- a/п/f\n+++ b/п/f\n@@ -1 +1 @@\n-a\n+b\n");
    }
}
