//! Diff одного файла: `parseUnifiedDiff` и `getFileDiff` из `electron/git.cjs`.
//!
//! ## Конспект
//! - Режимы: `commit` (относительно родителя или корневой), `staged`, `unstaged` (для конфликта — против HEAD, чтобы были видны маркеры), `untracked` (новый файл целиком, ≤2 МБ, с нулём в первых 8000 байт — двоичный).
//! - Показывается не больше 20000 строк: `truncated`. Счётчик и проверка предела — как в 1.x, поэтому пустой хвост после последней строки тоже засчитывает обрыв.
//! - `core.autocrlf` не переопределяется: на Windows рабочие файлы с CRLF, а в репозитории LF, и иначе весь файл выглядел бы изменённым. `--ignore-cr-at-eol` с откатом для очень старого Git.
//! - Пусто, но `--stat` что-то показывает — поменялись только окончания строк: `eolOnly`.
//!
//! **Отличие от 1.x:** ошибка чтения неотслеживаемого файла остаётся `UNKNOWN`, но с текстом ОС, а не Node.
//!
//! **Нового в 2.0:** `fullFile` — контекст на весь файл ([`FULL_CONTEXT`] строк), то есть один фрагмент со всем текстом. Без него запрос
//! тот же, что в 1.x. Предел в 20000 строк действует и здесь: у большого файла показывается начало и `truncated`.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use gorynych_core::paths::safe_relative;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::read::{has_head, is_hash, lacks_flag, resolve_repo_root};
use crate::run::git;

const MAX_DIFF_LINES: u32 = 20_000;
const MAX_UNTRACKED_BYTES: u64 = 2 * 1024 * 1024;
/// Контекст «весь файл»: строк больше, чем показывается ([`MAX_DIFF_LINES`]), поэтому фрагмент всегда один.
const FULL_CONTEXT: &str = "--unified=1000000";

// `.` в JS не совпадает ещё и с \r, U+2028, U+2029
static HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new("^@@ -([0-9]+)(?:,[0-9]+)? \\+([0-9]+)(?:,[0-9]+)? @@ ?([^\r\n\u{2028}\u{2029}]*)$").expect("корректный шаблон"));

/// Строка diff: `t` — `+`, `-`, пробел или `\`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DiffLine {
    pub t: String,
    #[specta(type = Option<f64>)]
    pub o: Option<u64>,
    #[specta(type = Option<f64>)]
    pub n: Option<u64>,
    pub text: String,
}

/// Фрагмент diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DiffHunk {
    pub header: String,
    pub section: String,
    pub lines: Vec<DiffLine>,
}

/// `parseUnifiedDiff`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct ParsedDiff {
    pub hunks: Vec<DiffHunk>,
    pub binary: bool,
    pub truncated: bool,
    #[specta(type = f64)]
    pub additions: u32,
    #[specta(type = f64)]
    pub deletions: u32,
}

/// `parseUnifiedDiff`.
pub fn parse_unified_diff(text: &str) -> ParsedDiff {
    let mut out = ParsedDiff::default();
    let (mut old_line, mut new_line, mut total) = (0u64, 0u64, 0u32);
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            out.binary = true;
            continue;
        }
        if let Some(caps) = HEADER.captures(line) {
            old_line = caps[1].parse().unwrap_or(0);
            new_line = caps[2].parse().unwrap_or(0);
            out.hunks.push(DiffHunk { header: line.to_owned(), section: caps[3].to_owned(), lines: Vec::new() });
            continue;
        }
        let Some(hunk) = out.hunks.last_mut() else {
            continue; // заголовки diff --git, index, ---, +++
        };
        if total >= MAX_DIFF_LINES {
            out.truncated = true;
            break;
        }
        let Some(kind) = line.chars().next() else {
            continue;
        };
        let content = line[kind.len_utf8()..].to_owned();
        let item = match kind {
            '+' => {
                out.additions += 1;
                new_line += 1;
                DiffLine { t: "+".to_owned(), o: None, n: Some(new_line - 1), text: content }
            }
            '-' => {
                out.deletions += 1;
                old_line += 1;
                DiffLine { t: "-".to_owned(), o: Some(old_line - 1), n: None, text: content }
            }
            ' ' => {
                old_line += 1;
                new_line += 1;
                DiffLine { t: " ".to_owned(), o: Some(old_line - 1), n: Some(new_line - 1), text: content }
            }
            // «\ No newline at end of file»
            '\\' => DiffLine { t: "\\".to_owned(), o: None, n: None, text: content.strip_prefix(|_: char| true).unwrap_or_default().to_owned() },
            _ => continue,
        };
        hunk.lines.push(item);
        total += 1;
    }
    out
}

/// Параметры `getFileDiff`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct FileDiffRequest {
    pub mode: Option<String>,
    pub hash: Option<String>,
    pub parent: Option<String>,
    pub path: Option<String>,
    pub old_path: Option<String>,
    pub ignore_whitespace: bool,
    pub conflicted: bool,
    /// Показать весь файл, а не только фрагменты вокруг изменений (нового в 2.0).
    pub full_file: bool,
}

/// Diff файла.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub binary: bool,
    pub truncated: Option<bool>,
    #[specta(type = f64)]
    pub additions: u32,
    #[specta(type = f64)]
    pub deletions: u32,
    pub eol_only: Option<bool>,
    pub too_large: Option<bool>,
    #[specta(type = Option<f64>)]
    pub size: Option<u64>,
}

fn untracked_diff(file: &str, full: &Path) -> Result<FileDiff> {
    let meta = std::fs::metadata(full).map_err(GorynychError::unknown)?;
    if meta.len() > MAX_UNTRACKED_BYTES {
        return Ok(FileDiff { path: file.to_owned(), too_large: Some(true), size: Some(meta.len()), ..FileDiff::default() });
    }
    let bytes = std::fs::read(full).map_err(GorynychError::unknown)?;
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return Ok(FileDiff { path: file.to_owned(), binary: true, ..FileDiff::default() });
    }
    let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let count = lines.len() as u32;
    let shown = lines.iter().take(MAX_DIFF_LINES as usize).enumerate().map(|(index, line)| DiffLine { t: "+".to_owned(), o: None, n: Some(index as u64 + 1), text: (*line).to_owned() }).collect();
    Ok(FileDiff {
        path: file.to_owned(),
        hunks: vec![DiffHunk { header: format!("@@ -0,0 +1,{count} @@"), section: String::new(), lines: shown }],
        truncated: Some(count > MAX_DIFF_LINES),
        additions: count,
        ..FileDiff::default()
    })
}

/// `getFileDiff`.
pub async fn get_file_diff(dir: &Path, request: &FileDiffRequest) -> Result<FileDiff> {
    let language = i18n::language();
    let root = resolve_repo_root(dir).await?;
    let file = request.path.as_deref().unwrap_or_default();
    let full = safe_relative(&root, file, language)?;
    let old_path = request.old_path.as_deref().filter(|old| !old.is_empty());
    if let Some(old) = old_path {
        safe_relative(&root, old, language)?;
    }
    let mode = request.mode.as_deref().unwrap_or_default();
    if mode == "untracked" {
        return untracked_diff(file, &full);
    }

    let mut ws: Vec<&str> = if request.ignore_whitespace { vec!["--ignore-all-space"] } else { Vec::new() };
    if request.full_file {
        ws.push(FULL_CONTEXT);
    }
    let ws = ws.as_slice();
    let mut args: Vec<&str> = Vec::new();
    match mode {
        "commit" => {
            let hash = request.hash.as_deref().unwrap_or_default();
            let parent = request.parent.as_deref().filter(|parent| !parent.is_empty());
            if !is_hash(hash) || parent.is_some_and(|parent| !is_hash(parent)) {
                return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[])));
            }
            args.extend_from_slice(&["diff-tree", "-p", "-M", "--no-commit-id", "--no-color"]);
            args.extend_from_slice(ws);
            args.push(parent.unwrap_or("--root"));
            args.push(hash);
        }
        "staged" => {
            args.extend_from_slice(&["diff", "--cached", "-M", "--no-color"]);
            args.extend_from_slice(ws);
        }
        "unstaged" => {
            args.push("diff");
            if request.conflicted && has_head(&root).await {
                args.push("HEAD");
            }
            args.push("--no-color");
            args.extend_from_slice(ws);
        }
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестный режим diff", &[]))),
    }

    let mut paths: Vec<&str> = vec!["--"];
    if let Some(old) = old_path.filter(|old| *old != file) {
        paths.push(old);
    }
    paths.push(file);
    let build = |extra: &[&'static str]| -> Vec<String> { args.iter().copied().chain(extra.iter().copied()).chain(paths.iter().copied()).map(str::to_owned).collect() };

    let out = match git(&root, &build(&["--ignore-cr-at-eol"])).await {
        Ok(out) => out,
        Err(error) if lacks_flag(&error) => git(&root, &build(&[])).await?, // очень старый Git без этого флага
        Err(error) => return Err(error),
    };
    let result = parse_unified_diff(&out);
    // Пусто, но файл в списке изменённых: значит, поменялись только окончания строк
    let mut eol_only = false;
    if !result.binary && result.hunks.is_empty() {
        let raw = git(&root, &build(&["--stat"])).await.unwrap_or_default();
        eol_only = !js::trim(&raw).is_empty();
    }
    Ok(FileDiff {
        path: file.to_owned(),
        old_path: old_path.map(str::to_owned),
        hunks: result.hunks,
        binary: result.binary,
        truncated: Some(result.truncated),
        additions: result.additions,
        deletions: result.deletions,
        eol_only: Some(eol_only),
        ..FileDiff::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_lines_and_counts() {
        let text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,3 +2,3 @@ секция\n контекст\r\n-старая\n+новая\n\\ No newline at end of file\n";
        let diff = parse_unified_diff(text);
        assert_eq!((diff.additions, diff.deletions, diff.binary, diff.truncated), (1, 1, false, false));
        let hunk = &diff.hunks[0];
        assert_eq!(hunk.section, "секция");
        assert_eq!(hunk.lines[0], DiffLine { t: " ".into(), o: Some(2), n: Some(2), text: "контекст".into() });
        assert_eq!(hunk.lines[1].o, Some(3));
        assert_eq!(hunk.lines[2].n, Some(3));
        assert_eq!(hunk.lines[3], DiffLine { t: "\\".into(), o: None, n: None, text: "No newline at end of file".into() });
    }

    #[test]
    fn binary_and_truncation() {
        assert!(parse_unified_diff("Binary files a/x and b/x differ\n").binary);
        let mut text = String::from("@@ -1 +1,20001 @@\n");
        for _ in 0..20001 {
            text.push_str("+x\n");
        }
        let diff = parse_unified_diff(&text);
        assert!(diff.truncated);
        assert_eq!(diff.additions, 20000);
    }
}
