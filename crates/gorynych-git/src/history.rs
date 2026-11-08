//! История одного файла через переименования и построчное авторство. Перенос `electron/fileHistory.cjs`.
//!
//! ## Конспект
//! - `checkRev`: `null` или `HEAD` как есть, иначе только хэш (`BAD_ARGS`).
//! - `fileHistory`: `log --follow -M --numstat -p`; запрашивается на один коммит больше предела, чтобы узнать `truncated`. Предел 1…2000, по умолчанию 300. Patch коммита разбирается, только если он не длиннее 3000 строк и общий бюджет 60000 не исчерпан; иначе `diff: null`, подгрузится при выборе.
//!   Пустой репозиторий или файла нет в истории — пустой результат. Имя и статус берутся из первых 12 строк patch.
//! - `blame`: `rev` не передан — `HEAD`; `null` — рабочая папка. Не больше 30000 строк. Нулевой sha — незакоммиченные строки. Нет файла — `NOT_FOUND`.
//! - `commitInfo`: полное сообщение и статистика; путь с переименованием (`a => b`, `dir/{a => b}/x`) приводится к новому имени.
//!
//! **Отличие от 1.x:** `unquote` работает с целыми символами, 1.x портил символ за пределами BMP в пути, взятом в кавычки.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use gorynych_core::paths::safe_relative;
use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::diff::{ParsedDiff, parse_unified_diff};
use crate::read::{is_hash, resolve_repo_root};
use crate::run::{FS, RS, git};

const MAX_COMMITS: f64 = 300.0;
const MAX_PATCH_LINES: usize = 3000;
const MAX_TOTAL_PATCH: i64 = 60_000;
const MAX_BLAME_LINES: usize = 30_000;

static NUMSTAT: LazyLock<Regex> = LazyLock::new(|| Regex::new("^([0-9]+|-)\t([0-9]+|-)\t").expect("корректный шаблон"));
static NUMSTAT_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new("^([0-9]+|-)\t([0-9]+|-)\t([^\r\u{2028}\u{2029}]+)$").expect("корректный шаблон"));
static DIFF_NAMES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^diff --git a/(.+) b/(.+)$").expect("корректный шаблон"));
static BLAME_HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9a-f]{40}) ([0-9]+) ([0-9]+)(?: [0-9]+)?$").expect("корректный шаблон"));
static PREVIOUS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9a-f]{40}) (.+)$").expect("корректный шаблон"));
static RENAME_BRACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{[^}]* => ([^}]*)\}").expect("корректный шаблон"));
static RENAME_PLAIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^.* => ").expect("корректный шаблон"));
static NO_HISTORY: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)does not have any commits|unknown revision|bad revision").expect("корректный шаблон"));
static NO_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)no such path|does not exist|no such file").expect("корректный шаблон"));

/// Путь из заголовка diff: `b/путь` или в кавычках с восьмеричными кодами.
pub(crate) fn unquote(raw: &str) -> String {
    let path = raw.strip_suffix('\t').unwrap_or(raw);
    if !path.starts_with('"') {
        return path.to_owned();
    }
    let body: Vec<char> = path[1..].chars().collect();
    let body = &body[..body.len().saturating_sub(1)];
    let mut bytes = Vec::new();
    let mut index = 0;
    let mut buffer = [0u8; 4];
    while index < body.len() {
        let current = body[index];
        index += 1;
        if current != '\\' {
            bytes.extend_from_slice(current.encode_utf8(&mut buffer).as_bytes());
            continue;
        }
        let Some(next) = body.get(index).copied() else {
            break;
        };
        if ('0'..='7').contains(&next) {
            let digits: String = body[index..].iter().take(3).collect();
            let value = digits.chars().take_while(|digit| ('0'..='7').contains(digit)).fold(0u32, |acc, digit| acc * 8 + digit.to_digit(8).unwrap_or(0));
            bytes.push(value as u8);
            index += 3;
        } else {
            index += 1;
            match next {
                'n' => bytes.push(10),
                't' => bytes.push(9),
                'r' => bytes.push(13),
                other => bytes.extend_from_slice(other.encode_utf8(&mut buffer).as_bytes()),
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn check_rev(rev: Option<&Value>) -> Result<Option<String>> {
    match rev {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text == "HEAD" || is_hash(text) => Ok(Some(text.clone())),
        Some(_) => Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[]))),
    }
}

/// Diff коммита в истории файла.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDiff {
    #[serde(flatten)]
    pub parsed: ParsedDiff,
    pub path: String,
    pub old_path: Option<String>,
}

/// Коммит в истории файла.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub subject: String,
    pub body: String,
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    #[specta(type = Option<f64>)]
    pub additions: Option<u64>,
    #[specta(type = Option<f64>)]
    pub deletions: Option<u64>,
    pub binary: bool,
    pub diff: Option<HistoryDiff>,
}

/// `fileHistory`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FileHistory {
    pub path: String,
    pub commits: Vec<HistoryCommit>,
    pub renamed: bool,
    pub truncated: bool,
}

/// Параметры `fileHistory`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct FileHistoryRequest {
    #[specta(type = Option<String>)]
    pub path: Option<Value>,
    #[specta(type = Option<String>)]
    pub rev: Option<Value>,
    pub limit: Option<f64>,
}

fn file_arg(path: Option<&Value>) -> Result<&str> {
    path.and_then(Value::as_str).filter(|file| !file.is_empty()).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Не указан файл", &[])))
}

fn error_text(error: &GorynychError) -> &str {
    if error.details.is_empty() { &error.message } else { &error.details }
}

/// `fileHistory`.
pub async fn file_history(dir: &Path, request: &FileHistoryRequest) -> Result<FileHistory> {
    let root = resolve_repo_root(dir).await?;
    let file = file_arg(request.path.as_ref())?;
    safe_relative(&root, file, i18n::language())?;
    let start = check_rev(request.rev.as_ref())?.unwrap_or_else(|| "HEAD".to_owned());
    let wanted = request.limit.filter(|limit| *limit != 0.0 && !limit.is_nan()).unwrap_or(MAX_COMMITS);
    let n = wanted.clamp(1.0, 2000.0);
    let format = format!("--format={RS}%H{FS}%P{FS}%an{FS}%ae{FS}%aI{FS}%s{FS}%b{FS}");
    let count = format!("-n{}", js::number_to_string(n + 1.0));
    let out = match git(&root, &["log", "--follow", "-M", "--numstat", "-p", "--no-color", "--no-ext-diff", &format, &count, &start, "--", file]).await {
        Ok(out) => out,
        // Пустой репозиторий или файла нет в истории
        Err(error) if NO_HISTORY.is_match(error_text(&error)) => return Ok(FileHistory { path: file.to_owned(), commits: Vec::new(), renamed: false, truncated: false }),
        Err(error) => return Err(error),
    };

    let mut commits = Vec::new();
    let mut budget = MAX_TOTAL_PATCH;
    for record in out.split(RS) {
        if js::trim(record).is_empty() {
            continue;
        }
        let parts: Vec<&str> = record.split(FS).collect();
        if parts.len() < 8 {
            continue;
        }
        let rest = parts[7..].join(&FS.to_string());
        let (head, patch) = match rest.find("diff --git ") {
            Some(at) => rest.split_at(at),
            None => (rest.as_str(), ""),
        };
        // --numstat: «доб.\tудал.\tпуть», у двоичных «-\t-»
        let (mut additions, mut deletions, mut binary) = (0u64, 0u64, false);
        for line in head.split('\n') {
            let Some(caps) = NUMSTAT.captures(line) else {
                continue;
            };
            if &caps[1] == "-" {
                binary = true;
            } else {
                additions += caps[1].parse().unwrap_or(0);
                deletions += caps[2].parse().unwrap_or(0);
            }
        }
        // Имя файла в коммите и переименование — из заголовков patch
        let mut status = "M";
        let (mut new_path, mut old_path): (Option<String>, Option<String>) = (None, None);
        for line in patch.split('\n').take(12) {
            if line.starts_with("new file mode") {
                status = "A";
            } else if line.starts_with("deleted file mode") {
                status = "D";
            } else if let Some(name) = line.strip_prefix("rename from ") {
                status = "R";
                old_path = Some(unquote(name));
            } else if let Some(name) = line.strip_prefix("rename to ") {
                new_path = Some(unquote(name));
            } else if let Some(name) = line.strip_prefix("copy from ") {
                status = "C";
                old_path = Some(unquote(name));
            } else if let Some(name) = line.strip_prefix("copy to ") {
                new_path = Some(unquote(name));
            } else if line.starts_with("+++ ") && new_path.is_none() {
                if line != "+++ /dev/null" {
                    let name = unquote(&line[4..]);
                    new_path = Some(name.strip_prefix("b/").unwrap_or(&name).to_owned());
                }
            } else if line.starts_with("--- ") && old_path.is_none() && status == "D" {
                let name = unquote(&line[4..]);
                old_path = Some(name.strip_prefix("a/").unwrap_or(&name).to_owned());
            } else if line.starts_with("diff --git ")
                && new_path.is_none()
                && let Some(caps) = DIFF_NAMES.captures(line)
            {
                new_path = Some(caps[2].to_owned());
            }
        }
        let path_here = new_path.or_else(|| old_path.clone()).unwrap_or_else(|| file.to_owned());
        let shown_old = if matches!(status, "R" | "C") { old_path } else { None };
        let lines = if patch.is_empty() { 0 } else { patch.split('\n').count() };
        let mut diff = None;
        if !patch.is_empty() && lines <= MAX_PATCH_LINES && budget > 0 {
            budget -= lines as i64;
            diff = Some(HistoryDiff { parsed: parse_unified_diff(patch), path: path_here.clone(), old_path: shown_old.clone() });
        }
        commits.push(HistoryCommit {
            hash: parts[0].to_owned(),
            parents: parts[1].split(' ').filter(|parent| !parent.is_empty()).map(str::to_owned).collect(),
            author: parts[2].to_owned(),
            email: parts[3].to_owned(),
            date: parts[4].to_owned(),
            subject: parts[5].to_owned(),
            body: js::trim(parts[6]).to_owned(),
            path: path_here,
            old_path: shown_old,
            status: status.to_owned(),
            additions: (!binary).then_some(additions),
            deletions: (!binary).then_some(deletions),
            binary,
            diff,
        });
    }
    let truncated = commits.len() as f64 > n;
    if truncated {
        commits.truncate(n as usize);
    }
    let renamed = commits.iter().any(|commit| commit.status == "R");
    Ok(FileHistory { path: file.to_owned(), commits, renamed, truncated })
}

/* ---------- Авторство ---------- */

/// Строка авторства.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub text: String,
    pub sha: String,
    #[specta(type = f64)]
    pub orig_line: u32,
}

/// Откуда пришла строка.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BlamePrevious {
    pub sha: String,
    pub path: String,
}

/// Коммит авторства.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct BlameCommit {
    pub uncommitted: bool,
    pub author: Option<String>,
    pub email: Option<String>,
    #[specta(type = Option<f64>)]
    pub time: Option<i64>,
    pub summary: Option<String>,
    pub filename: Option<String>,
    pub boundary: Option<bool>,
    pub previous: Option<BlamePrevious>,
}

/// `blame`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub path: String,
    pub rev: Option<String>,
    pub ignore_whitespace: bool,
    pub lines: Vec<BlameLine>,
    pub commits: BTreeMap<String, BlameCommit>,
    pub truncated: bool,
}

/// Различает отсутствие поля и `null`.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

/// Параметры `blame`: `rev` нет — `HEAD`, `null` — рабочая папка.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct BlameRequest {
    #[specta(type = Option<String>)]
    pub path: Option<Value>,
    #[serde(deserialize_with = "present")]
    #[specta(type = Option<String>)]
    pub rev: Option<Value>,
    pub ignore_whitespace: bool,
}

/// `blame`.
pub async fn blame(dir: &Path, request: &BlameRequest) -> Result<Blame> {
    let root = resolve_repo_root(dir).await?;
    let file = file_arg(request.path.as_ref())?;
    safe_relative(&root, file, i18n::language())?;
    let head = Value::String("HEAD".to_owned());
    let rev = check_rev(Some(request.rev.as_ref().unwrap_or(&head)))?;
    let mut args = vec!["blame", "--porcelain"];
    if request.ignore_whitespace {
        args.push("-w");
    }
    if let Some(rev) = &rev {
        args.push(rev);
    }
    args.extend_from_slice(&["--", file]);
    let out = match git(&root, &args).await {
        Ok(out) => out,
        Err(error) if NO_FILE.is_match(error_text(&error)) => {
            let message = match &rev {
                Some(rev) => t("Файла {0} нет в версии {1}", &[&file, &rev.chars().take(7).collect::<String>()]),
                None => t("Файла {0} нет", &[&file]),
            };
            return Err(GorynychError::new(ErrorCode::NotFound, message).with_hint(t("Возможно, файл был создан позже или переименован", &[])));
        }
        Err(error) => return Err(error),
    };

    let mut commits: BTreeMap<String, BlameCommit> = BTreeMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(String, u32)> = None;
    let mut truncated = false;
    for row in out.split('\n') {
        if let Some(text) = row.strip_prefix('\t') {
            if lines.len() >= MAX_BLAME_LINES {
                truncated = true;
                break;
            }
            let Some((sha, orig)) = &current else {
                continue;
            };
            lines.push(BlameLine { text: text.strip_suffix('\r').unwrap_or(text).to_owned(), sha: sha.clone(), orig_line: *orig });
            continue;
        }
        if let Some(caps) = BLAME_HEAD.captures(row) {
            let sha = caps[1].to_owned();
            commits.entry(sha.clone()).or_insert_with(|| BlameCommit { uncommitted: sha.bytes().all(|byte| byte == b'0'), ..BlameCommit::default() });
            current = Some((sha, caps[2].parse().unwrap_or(0)));
            continue;
        }
        let Some(commit) = current.as_ref().and_then(|(sha, _)| commits.get_mut(sha)) else {
            continue;
        };
        let (key, value) = row.split_once(' ').unwrap_or((row, ""));
        match key {
            "author" => commit.author = Some(value.to_owned()),
            "author-mail" => {
                let value = value.strip_prefix('<').unwrap_or(value);
                commit.email = Some(value.strip_suffix('>').unwrap_or(value).to_owned());
            }
            "author-time" => commit.time = Some(value.parse::<i64>().unwrap_or(0) * 1000),
            "summary" => commit.summary = Some(value.to_owned()),
            "filename" => commit.filename = Some(value.to_owned()),
            "boundary" => commit.boundary = Some(true),
            "previous" => {
                if let Some(caps) = PREVIOUS.captures(value) {
                    commit.previous = Some(BlamePrevious { sha: caps[1].to_owned(), path: caps[2].to_owned() });
                }
            }
            _ => {}
        }
    }
    Ok(Blame { path: file.to_owned(), rev, ignore_whitespace: request.ignore_whitespace, lines, commits, truncated })
}

/* ---------- Поповер коммита ---------- */

/// Статистика файла в коммите.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FileStat {
    #[specta(type = f64)]
    pub additions: u64,
    #[specta(type = f64)]
    pub deletions: u64,
}

/// `commitInfo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub committer: String,
    pub subject: String,
    pub body: String,
    #[specta(type = f64)]
    pub files: u32,
    #[specta(type = f64)]
    pub additions: u64,
    #[specta(type = f64)]
    pub deletions: u64,
    pub file_stat: Option<FileStat>,
}

/// Параметры `commitInfo`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CommitInfoRequest {
    pub hash: Option<String>,
    pub path: Option<String>,
}

/// `commitInfo`.
pub async fn commit_info(dir: &Path, request: &CommitInfoRequest) -> Result<CommitInfo> {
    let root = resolve_repo_root(dir).await?;
    let hash = request.hash.as_deref().filter(|hash| is_hash(hash)).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Некорректный коммит", &[])))?;
    let format = format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%aI{FS}%cn{FS}%s{FS}%b{RS}");
    let out = git(&root, &["show", "--numstat", "-M", "--no-color", &format, hash]).await?;
    let (meta, stat) = out.split_once(RS).unwrap_or((&out, ""));
    let fields: Vec<&str> = meta.split(FS).collect();
    let field = |index: usize| fields.get(index).copied().unwrap_or_default();
    let wanted = request.path.as_deref().filter(|file| !file.is_empty());
    let (mut files, mut additions, mut deletions, mut file_stat) = (0, 0u64, 0u64, None);
    for line in stat.split('\n') {
        let Some(caps) = NUMSTAT_PATH.captures(line) else {
            continue;
        };
        files += 1;
        let count = |text: &str| if text == "-" { 0 } else { text.parse::<u64>().unwrap_or(0) };
        let (added, deleted) = (count(&caps[1]), count(&caps[2]));
        additions += added;
        deletions += deleted;
        // «старое => новое» и «dir/{a => b}/x» при переименовании
        let name = RENAME_BRACES.replace(&caps[3], "$1");
        let name = RENAME_PLAIN.replace(&name, "").replace("//", "/");
        if wanted == Some(name.as_str()) {
            file_stat = Some(FileStat { additions: added, deletions: deleted });
        }
    }
    Ok(CommitInfo {
        hash: field(0).to_owned(),
        parents: if field(1).is_empty() { Vec::new() } else { field(1).split(' ').map(str::to_owned).collect() },
        author: field(2).to_owned(),
        email: field(3).to_owned(),
        date: field(4).to_owned(),
        committer: field(5).to_owned(),
        subject: field(6).to_owned(),
        body: js::trim(field(7)).to_owned(),
        files,
        additions,
        deletions,
        file_stat,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquote_paths() {
        assert_eq!(unquote("b/простой\t"), "b/простой");
        assert_eq!(unquote(r#""b/\320\266 \"a\"\t\\.txt""#), "b/ж \"a\"\t\\.txt");
    }
}
