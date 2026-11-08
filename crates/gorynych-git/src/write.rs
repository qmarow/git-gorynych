//! Индекс и коммит, шаблон сообщения, журнал ветки: конец `electron/git.cjs`.
//!
//! ## Конспект
//! - `stage`: `add -A`, весь репозиторий или пути. `unstage`: `reset -q`; без коммитов — `rm --cached`.
//! - `commit`: сводка и описание обрезаются; пустая сводка — ошибка без кода (`UNKNOWN`).
//! - `cleanCommitTemplate`: комментарии (`core.commentChar`, по умолчанию `#`) Git сам вырезает только при коммите из редактора, с `-m` оставил бы, поэтому они отдаются отдельно как подсказка.
//! - `readCommitTemplate`: файл из `commit.template`, не больше 64 КБ. Ошибка чтения возвращается полем `error`, а не исключением.
//! - `branchLog`: что придёт при Pull (`in`) и уйдёт при Push (`out`). Upstream через `for-each-ref` по полному имени, чтобы не спутать с одноимённым тегом. Предел 1…200, по умолчанию 50.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::read::has_head;
use crate::run::{FS, git};

const TEMPLATE_MAX: u64 = 64 * 1024;

static BAD_BRANCH: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"[{}~^:?*\[\\]|\.\.|@\{{", js::WHITESPACE_CLASS)).expect("корректный шаблон"));

/// Какие файлы: все, список или неверный аргумент (ошибка появится при вызове, как в 1.x).
#[derive(Debug, Clone, PartialEq, Eq, specta::Type)]
pub enum PathsArg {
    All,
    List(Vec<String>),
    Invalid,
}

impl<'de> Deserialize<'de> for PathsArg {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(match Value::deserialize(deserializer)? {
            Value::String(text) if text == "all" => Self::All,
            Value::Array(list) if list.iter().all(|item| item.as_str().is_some_and(|text| !text.is_empty())) => Self::List(list.iter().filter_map(Value::as_str).map(str::to_owned).collect()),
            _ => Self::Invalid,
        })
    }
}

fn invalid_paths() -> GorynychError {
    GorynychError::unknown(t("Некорректный список файлов", &[]))
}

/// `stage`.
pub async fn stage(dir: &Path, paths: &PathsArg) -> Result<String> {
    match paths {
        PathsArg::All => git(dir, &["add", "-A"]).await,
        PathsArg::Invalid => Err(invalid_paths()),
        PathsArg::List(list) => {
            let mut args = vec!["add", "-A", "--"];
            args.extend(list.iter().map(String::as_str));
            git(dir, &args).await
        }
    }
}

/// `unstage`.
pub async fn unstage(dir: &Path, paths: &PathsArg) -> Result<String> {
    let head = has_head(dir).await;
    match paths {
        PathsArg::All if head => git(dir, &["reset", "-q"]).await,
        PathsArg::All => git(dir, &["rm", "-r", "-q", "--cached", "."]).await,
        PathsArg::Invalid => Err(invalid_paths()),
        PathsArg::List(list) => {
            let mut args: Vec<&str> = if head { vec!["reset", "-q", "--"] } else { vec!["rm", "-q", "--cached", "--"] };
            args.extend(list.iter().map(String::as_str));
            git(dir, &args).await
        }
    }
}

/// Новый коммит.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CommitResult {
    pub hash: String,
    pub parent: Option<String>,
    pub summary: String,
}

/// `commit`.
pub async fn commit(dir: &Path, summary: &str, description: Option<&str>) -> Result<CommitResult> {
    let summary = js::trim(summary);
    if summary.is_empty() {
        return Err(GorynychError::unknown(t("Пустое сообщение коммита", &[])));
    }
    let mut args = vec!["commit", "-m", summary];
    if let Some(text) = description.map(js::trim).filter(|text| !text.is_empty()) {
        args.extend_from_slice(&["-m", text]);
    }
    git(dir, &args).await?;
    let hash = git(dir, &["rev-parse", "HEAD"]).await?;
    let parent = git(dir, &["rev-parse", "--verify", "--quiet", "HEAD^"]).await.unwrap_or_default();
    let parent = js::trim(&parent);
    Ok(CommitResult { hash: js::trim(&hash).to_owned(), parent: (!parent.is_empty()).then(|| parent.to_owned()), summary: summary.to_owned() })
}

/// Шаблон сообщения.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct CommitTemplate {
    pub path: String,
    pub body: String,
    pub hint: String,
    pub error: Option<String>,
}

fn trim_lines(lines: &[String]) -> String {
    let is_blank = |line: &String| js::trim(line).is_empty();
    let start = lines.iter().position(|line| !is_blank(line)).unwrap_or(lines.len());
    let end = lines.iter().rposition(|line| !is_blank(line)).map_or(start, |at| at + 1);
    lines[start..end].join("\n")
}

/// `cleanCommitTemplate`: `(body, hint)`.
pub fn clean_commit_template(text: &str, comment: Option<char>) -> (String, String) {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let (mut body, mut hint) = (Vec::new(), Vec::new());
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        match comment.and_then(|mark| line.strip_prefix(mark)) {
            Some(rest) => hint.push(rest.strip_prefix(' ').unwrap_or(rest).to_owned()),
            None => body.push(line.trim_end_matches(js::is_whitespace).to_owned()),
        }
    }
    (trim_lines(&body), trim_lines(&hint))
}

/// `readCommitTemplate`: `None`, если шаблон не задан.
pub async fn read_commit_template(cwd: &Path) -> Option<CommitTemplate> {
    // git config выходит с кодом 1, если значения нет
    let out = git(cwd, &["config", "--path", "--get", "commit.template"]).await.ok()?;
    let file = js::trim(&out).to_owned();
    if file.is_empty() {
        return None;
    }
    let absolute = Path::new(&file);
    let full = if absolute.is_absolute() { absolute.to_path_buf() } else { cwd.join(absolute) };
    let failed = |error: String| CommitTemplate { path: file.clone(), error: Some(error), ..CommitTemplate::default() };
    let not_found = || failed(t("Файл шаблона не найден: {0}", &[&full.display()]));
    let Ok(meta) = std::fs::metadata(&full) else {
        return Some(not_found());
    };
    if !meta.is_file() {
        return Some(not_found());
    }
    if meta.len() > TEMPLATE_MAX {
        return Some(failed(t("Файл шаблона слишком большой (больше 64 КБ)", &[])));
    }
    let Ok(bytes) = std::fs::read(&full) else {
        return Some(not_found());
    };
    let raw = String::from_utf8_lossy(&bytes);
    let mut comment = Some('#');
    if let Ok(value) = git(cwd, &["config", "--get", "core.commentChar"]).await {
        let value = js::trim(&value);
        if !value.is_empty() && value != "auto" {
            comment = value.chars().next();
        }
    }
    let (body, hint) = clean_commit_template(&raw, comment);
    Some(CommitTemplate { path: file, body, hint, error: None })
}

/// Коммит в журнале ветки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchCommit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

/// `branchLog`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchLog {
    pub commits: Vec<BranchCommit>,
    #[specta(type = f64)]
    pub total: u32,
    pub upstream: String,
}

/// Параметры `branchLog`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct BranchLogRequest {
    pub branch: Option<String>,
    pub direction: Option<String>,
    pub limit: Option<f64>,
}

/// `branchLog`.
pub async fn branch_log(cwd: &Path, request: &BranchLogRequest) -> Result<BranchLog> {
    let branch = request.branch.as_deref().unwrap_or_default();
    if branch.is_empty() || branch.starts_with('-') || BAD_BRANCH.is_match(branch) {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректное имя ветки", &[])));
    }
    let local = format!("refs/heads/{branch}");
    let found = git(cwd, &["for-each-ref", "--format=%(upstream)", &local]).await.unwrap_or_default();
    let upstream = js::trim(&found);
    if upstream.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoUpstream, t("У ветки «{0}» нет upstream", &[&branch])));
    }
    let range = if request.direction.as_deref() == Some("out") { format!("{upstream}..{local}") } else { format!("{local}..{upstream}") };
    let wanted = request.limit.filter(|limit| *limit != 0.0 && !limit.is_nan()).unwrap_or(50.0);
    let limit = format!("-n{}", js::number_to_string(wanted.clamp(1.0, 200.0)));
    let format = format!("--format=%H{FS}%h{FS}%an{FS}%aI{FS}%s");
    let log_args = ["log", &format, &limit, &range, "--"];
    let count_args = ["rev-list", "--count", &range, "--"];
    let (out, count) = tokio::join!(git(cwd, &log_args), git(cwd, &count_args));
    let (out, count) = (out?, count?);
    let commits: Vec<BranchCommit> = out
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FS).map(str::to_owned);
            let mut next = || fields.next().unwrap_or_default();
            BranchCommit { hash: next(), short: next(), author: next(), date: next(), subject: next() }
        })
        .collect();
    let total = js::trim(&count).parse().ok().filter(|value| *value != 0).unwrap_or(commits.len() as u32);
    let short = upstream.strip_prefix("refs/remotes/").or_else(|| upstream.strip_prefix("refs/heads/")).unwrap_or(upstream);
    Ok(BranchLog { commits, total, upstream: short.to_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_splits_comments() {
        let (body, hint) = clean_commit_template("\u{FEFF}\n# подсказка\r\nТема  \n\n#без пробела\nТело\n\n", Some('#'));
        assert_eq!(body, "Тема\n\nТело");
        assert_eq!(hint, "подсказка\nбез пробела");
    }

    #[test]
    fn branch_name_checks() {
        for bad in ["a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "a..b", "a@{u}"] {
            assert!(BAD_BRANCH.is_match(bad), "{bad}");
        }
        assert!(!BAD_BRANCH.is_match("feature/ветка-1.2"));
    }

    #[test]
    fn paths_argument_forms() {
        let parse = |text: &str| serde_json::from_str::<PathsArg>(text).unwrap();
        assert_eq!(parse(r#""all""#), PathsArg::All);
        assert_eq!(parse(r#"["a","b"]"#), PathsArg::List(vec!["a".into(), "b".into()]));
        assert_eq!(parse(r#"["a",""]"#), PathsArg::Invalid);
        assert_eq!(parse(r#""другое""#), PathsArg::Invalid);
        assert_eq!(parse("5"), PathsArg::Invalid);
    }
}
