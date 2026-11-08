//! Сравнение двух коммитов и поиск по изменениям. Перенос `electron/compare.cjs`.
//!
//! ## Конспект
//! - `compareCommits`: файлы, число коммитов в обе стороны (журналы ≤200), база слияния, `relation`.
//! - `searchChanges` и `searchHistory`: обычный текст отбирает сам git через `-G`; регулярка JS в git не передаётся, синтаксис другой. Кириллица без учёта регистра в `searchChanges` фильтруется только здесь, а в `searchHistory` идёт как `(П|п)(р|Р)`.
//! - Поиск по истории смотрит не больше 5000 коммитов, с регуляркой — 400 (`partial`). Лимиты: 2000 совпадений и 50 строк на файл, либо 300 коммитов, 30 файлов и 8 строк.
//! - Диапазоны — в единицах UTF-16, интерфейс передаёт их в `String.slice`. Длинная строка обрезается вокруг первого совпадения (`cut`).
//!
//! **Отличие от 1.x:** подсказка у неверной регулярки — текст `regress`, а не V8.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_core::js_regex::JsRegex;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::history::unquote;
use crate::read::{CommitFile, get_commit_files, is_hash, lacks_flag};
use crate::run::{FS, GitOptions, RS, git, git_with};

const MAX_LOG: &str = "200";
const MAX_MATCHES: u32 = 2000;
const MAX_LINES_PER_FILE: usize = 50;
const MAX_LINE_TEXT: usize = 400;
const HIST_MAX_COMMITS: usize = 300;
const HIST_MAX_FILES: usize = 30;
const HIST_MAX_LINES: usize = 8;
const HIST_MAX_HASHES: usize = 5000;

static HUNK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@").expect("корректный шаблон"));
static NO_DIFF_MERGES: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)diff-merges|unknown option|unrecognized").expect("корректный шаблон"));

fn bad_args(message: String) -> GorynychError {
    GorynychError::new(ErrorCode::BadArgs, message)
}

/// Кратко о коммите.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct CommitBrief {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

fn brief(line: &str) -> CommitBrief {
    let mut fields = line.split(FS).map(str::to_owned);
    let mut next = || fields.next().unwrap_or_default();
    CommitBrief { hash: next(), subject: next(), author: next(), date: next() }
}

fn brief_format() -> String {
    format!("--format=%H{FS}%s{FS}%an{FS}%aI")
}

async fn info(cwd: &Path, hash: &str) -> Result<CommitBrief> {
    let format = brief_format();
    let out = git(cwd, &["log", "-1", &format, hash]).await?;
    Ok(brief(js::trim(&out)))
}

async fn log(cwd: &Path, range: String) -> Result<Vec<CommitBrief>> {
    let format = brief_format();
    let out = git(cwd, &["log", "-n", MAX_LOG, &format, &range]).await?;
    Ok(out.split('\n').filter(|line| !line.is_empty()).map(brief).collect())
}

/// `compareCommits`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub a: CommitBrief,
    pub b: CommitBrief,
    pub merge_base: Option<String>,
    pub relation: String,
    #[specta(type = f64)]
    pub only_a: u32,
    #[specta(type = f64)]
    pub only_b: u32,
    pub commits_a: Vec<CommitBrief>,
    pub commits_b: Vec<CommitBrief>,
    pub files: Vec<CommitFile>,
    #[specta(type = f64)]
    pub additions: u64,
    #[specta(type = f64)]
    pub deletions: u64,
}

/// Параметры `repo:compare`. Поле не строкой считается отсутствующим, как `a ?? ''` в 1.x.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CompareRequest {
    #[serde(deserialize_with = "crate::common::lenient")]
    #[specta(type = Option<String>)]
    pub a: Option<String>,
    #[serde(deserialize_with = "crate::common::lenient")]
    #[specta(type = Option<String>)]
    pub b: Option<String>,
}

/// `compareCommits`: `a` — было, `b` — стало.
pub async fn compare_commits(cwd: &Path, a: Option<&str>, b: Option<&str>) -> Result<Comparison> {
    let (a, b) = (a.unwrap_or_default(), b.unwrap_or_default());
    if !is_hash(a) || !is_hash(b) {
        return Err(bad_args(t("Некорректный коммит", &[])));
    }
    if a == b {
        return Err(bad_args(t("Выбран один и тот же коммит", &[])));
    }
    let symmetric = format!("{a}...{b}");
    let count_args = ["rev-list", "--left-right", "--count", &symmetric];
    let base_args = ["merge-base", a, b];
    let (info_a, info_b, files, counts, base) = tokio::join!(info(cwd, a), info(cwd, b), get_commit_files(cwd, b, Some(a)), git(cwd, &count_args), git(cwd, &base_args));
    let (info_a, info_b, files, counts) = (info_a?, info_b?, files?, counts?);
    let base = base.ok().map(|out| js::trim(&out).to_owned());
    let mut numbers = counts.split(js::is_whitespace).filter(|item| !item.is_empty()).map(|item| item.parse::<u32>().unwrap_or(0));
    let (only_a, only_b) = (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0));
    let (commits_b, commits_a) = tokio::join!(
        async { if only_b > 0 { log(cwd, format!("{a}..{b}")).await } else { Ok(Vec::new()) } },
        async { if only_a > 0 { log(cwd, format!("{b}..{a}")).await } else { Ok(Vec::new()) } },
    );
    let relation = if base.as_deref() == Some(a) {
        "a-before-b"
    } else if base.as_deref() == Some(b) {
        "b-before-a"
    } else {
        "diverged"
    };
    Ok(Comparison {
        a: info_a,
        b: info_b,
        merge_base: base,
        relation: relation.to_owned(),
        only_a,
        only_b,
        commits_a: commits_a?,
        commits_b: commits_b?,
        additions: files.iter().filter_map(|file| file.additions).sum(),
        deletions: files.iter().filter_map(|file| file.deletions).sum(),
        files,
    })
}

/* ---------- Поиск ---------- */

fn escape_with(text: &str, special: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if special.contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn escape_ere(text: &str) -> String {
    escape_with(text, ".[]{}()*+?^$|\\")
}

fn is_printable_ascii(text: &str) -> bool {
    text.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

/// Текст в ERE для `git -G` без учёта регистра и для кириллицы: «При» → «(П|п)(р|Р)(и|И)».
fn case_free_ere(text: &str) -> String {
    let mut out = String::new();
    let mut buffer = [0u8; 4];
    for c in text.chars() {
        let lower: Vec<char> = c.to_lowercase().collect();
        let upper: Vec<char> = c.to_uppercase().collect();
        if lower != upper && lower.len() == 1 && upper.len() == 1 {
            out.push_str(&format!("({}|{})", escape_ere(lower[0].encode_utf8(&mut buffer)), escape_ere(upper[0].encode_utf8(&mut [0u8; 4]))));
        } else {
            out.push_str(&escape_ere(c.encode_utf8(&mut buffer)));
        }
    }
    out
}

fn compile(query: &str, regex: bool, case_sensitive: bool) -> Result<JsRegex> {
    let pattern = if regex { query.to_owned() } else { escape_with(query, ".*+?^${}()|[]\\") };
    let compiled = JsRegex::new(&pattern, if case_sensitive { "" } else { "i" }).map_err(|error| bad_args(t("Неверное регулярное выражение", &[])).with_hint(error))?;
    if compiled.is_match("") {
        return Err(bad_args(t("Выражение совпадает с пустой строкой", &[])));
    }
    Ok(compiled)
}

/// Совпадения в строке, без пустых, не больше `limit`.
fn ranges_in(regex: &JsRegex, text: &[u16], limit: usize) -> Vec<(usize, usize)> {
    regex.find_all(text).into_iter().filter(|range| !range.is_empty()).take(limit).map(|range| (range.start, range.end)).collect()
}

/// Показанный участок строки: длинная обрезается вокруг первого совпадения.
struct Shown {
    text: String,
    cut: bool,
    ranges: Vec<[u32; 2]>,
}

fn show(text: &[u16], ranges: &[(usize, usize)], width: usize, before: usize) -> Shown {
    let shift = if text.len() > width { ranges[0].0.saturating_sub(before) } else { 0 };
    let end = if text.len() > width { (shift + width).min(text.len()) } else { text.len() };
    let part = &text[shift..end];
    Shown {
        text: String::from_utf16_lossy(part),
        cut: shift > 0 || shift + part.len() < text.len(),
        ranges: ranges.iter().filter(|(from, to)| *from >= shift && to - shift <= part.len()).map(|(from, to)| [(from - shift) as u32, (to - shift) as u32]).collect(),
    }
}

fn old_name(line: &str) -> Option<String> {
    (line != "--- /dev/null").then(|| {
        let name = unquote(&line[4..]);
        name.strip_prefix("a/").unwrap_or(&name).to_owned()
    })
}

fn new_name(line: &str) -> Option<String> {
    (line != "+++ /dev/null").then(|| {
        let name = unquote(&line[4..]);
        name.strip_prefix("b/").unwrap_or(&name).to_owned()
    })
}

/// Строка с совпадениями.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct MatchLine {
    pub t: String,
    #[specta(type = f64)]
    pub line: u64,
    pub text: String,
    pub cut: bool,
    #[specta(type = Vec<[f64; 2]>)]
    pub ranges: Vec<[u32; 2]>,
}

/// Файл с совпадениями.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchFile {
    pub path: Option<String>,
    pub old_path: Option<String>,
    #[specta(type = f64)]
    pub count: u32,
    pub lines: Vec<MatchLine>,
}

/// `searchChanges`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct ChangeSearch {
    pub files: Vec<MatchFile>,
    #[specta(type = f64)]
    pub total: u32,
    pub truncated: bool,
}

/// Параметры `searchChanges`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchChanges {
    pub a: Option<String>,
    pub b: Option<String>,
    pub query: Option<String>,
    pub regex: bool,
    pub case_sensitive: bool,
}

fn renamed_from(old: Option<&String>, new: Option<&String>) -> Option<String> {
    old.filter(|old| new.is_some_and(|new| new != *old)).cloned()
}

/// `searchChanges`.
pub async fn search_changes(cwd: &Path, request: &SearchChanges) -> Result<ChangeSearch> {
    let (a, b) = (request.a.as_deref().unwrap_or_default(), request.b.as_deref().unwrap_or_default());
    if !is_hash(a) || !is_hash(b) {
        return Err(bad_args(t("Некорректный коммит", &[])));
    }
    let query = request.query.as_deref().unwrap_or_default();
    if js::trim(query).is_empty() {
        return Ok(ChangeSearch::default());
    }
    if js::utf16_len(query) > 500 {
        return Err(bad_args(t("Слишком длинный запрос", &[])));
    }
    let regex = compile(query, request.regex, request.case_sensitive)?;

    // Без учёта регистра — только для ASCII: регистр кириллицы движок регулярок git сравнивает ненадёжно
    let mut args: Vec<String> = ["-c", "core.quotepath=false", "diff", "--no-color", "--no-ext-diff", "-M", "-U0", "--ignore-cr-at-eol"].map(str::to_owned).to_vec();
    if !request.regex && (request.case_sensitive || is_printable_ascii(query)) {
        args.push(format!("-G{}", escape_ere(query)));
        if !request.case_sensitive {
            args.push("--regexp-ignore-case".to_owned());
        }
    }
    args.extend([a.to_owned(), b.to_owned()]);
    let out = match git(cwd, &args).await {
        Ok(out) => out,
        Err(error) if lacks_flag(&error) => {
            args.retain(|arg| arg != "--ignore-cr-at-eol");
            git(cwd, &args).await?
        }
        Err(error) => return Err(error),
    };

    let mut files: Vec<MatchFile> = Vec::new();
    let mut open = false;
    let (mut old_line, mut new_line, mut total) = (0u64, 0u64, 0u32);
    let mut truncated = false;
    let mut pending: Option<String> = None;
    for raw in out.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.starts_with("diff --git ") {
            open = false;
            pending = None;
            continue;
        }
        if line.starts_with("--- ") {
            pending = old_name(line);
            continue;
        }
        if line.starts_with("+++ ") {
            let next = new_name(line);
            let old_path = renamed_from(pending.as_ref(), next.as_ref());
            files.push(MatchFile { path: next.or_else(|| pending.clone()), old_path, count: 0, lines: Vec::new() });
            open = true;
            continue;
        }
        if let Some(caps) = HUNK.captures(line) {
            old_line = caps[1].parse().unwrap_or(0);
            new_line = caps[2].parse().unwrap_or(0);
            continue;
        }
        if !open || !(line.starts_with('+') || line.starts_with('-')) {
            continue;
        }
        let added = line.starts_with('+');
        let number = if added { &mut new_line } else { &mut old_line };
        let current = *number;
        *number += 1;
        if truncated {
            continue;
        }
        let text: Vec<u16> = line[1..].encode_utf16().collect();
        let ranges = ranges_in(&regex, &text, 50);
        if ranges.is_empty() {
            continue;
        }
        let file = files.last_mut().expect("файл открыт");
        file.count += ranges.len() as u32;
        total += ranges.len() as u32;
        if file.lines.len() < MAX_LINES_PER_FILE {
            let shown = show(&text, &ranges, MAX_LINE_TEXT, 80);
            file.lines.push(MatchLine { t: line[..1].to_owned(), line: current, text: shown.text, cut: shown.cut, ranges: shown.ranges });
        }
        if total >= MAX_MATCHES {
            truncated = true;
        }
    }
    files.retain(|file| file.count > 0);
    Ok(ChangeSearch { files, total, truncated })
}

/// Строка в поиске по истории.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct HistoryLine {
    pub t: String,
    #[specta(type = Option<f64>)]
    pub o: Option<u64>,
    #[specta(type = Option<f64>)]
    pub n: Option<u64>,
    pub text: String,
    pub cut: bool,
    #[specta(type = Vec<[f64; 2]>)]
    pub ranges: Vec<[u32; 2]>,
}

/// Файл в поиске по истории.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFile {
    pub path: Option<String>,
    pub old_path: Option<String>,
    pub status: String,
    #[specta(type = f64)]
    pub count: u32,
    pub lines: Vec<HistoryLine>,
}

/// Коммит в поиске по истории.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHit {
    pub hash: String,
    pub files: Vec<HistoryFile>,
    #[specta(type = f64)]
    pub more_files: u32,
    #[specta(type = f64)]
    pub count: u32,
}

/// `searchHistory`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct HistorySearch {
    pub commits: Vec<HistoryHit>,
    #[specta(type = f64)]
    pub total: u32,
    pub truncated: bool,
    #[specta(type = Option<f64>)]
    pub scanned: Option<u32>,
    pub partial: Option<bool>,
}

/// Параметры `searchHistory`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchHistory {
    pub hashes: Option<Vec<String>>,
    pub query: Option<String>,
    pub regex: bool,
    pub case_sensitive: bool,
}

/// `searchHistory`: в каких коммитах графа текст встречается в изменённых строках.
pub async fn search_history(cwd: &Path, request: &SearchHistory) -> Result<HistorySearch> {
    let query = request.query.as_deref().unwrap_or_default();
    if js::trim(query).is_empty() {
        return Ok(HistorySearch::default());
    }
    if js::utf16_len(query) > 500 {
        return Err(bad_args(t("Слишком длинный запрос", &[])));
    }
    let list: Vec<&str> = request.hashes.iter().flatten().map(String::as_str).filter(|hash| is_hash(hash)).take(HIST_MAX_HASHES).collect();
    if list.is_empty() {
        return Ok(HistorySearch::default());
    }
    let regex = compile(query, request.regex, request.case_sensitive)?;

    // Регулярку JS в git не передаём: тогда отбираем сами, но смотрим меньше коммитов
    let ascii = is_printable_ascii(query);
    let pre = (!request.regex).then(|| if request.case_sensitive || ascii { escape_ere(query) } else { case_free_ere(query) });
    let scan: &[&str] = if request.regex { &list[..list.len().min(400)] } else { &list };
    let mut base: Vec<String> = ["log", "--no-walk=unsorted", "--stdin", "--format=%x1e%H", "-p", "-U0", "--no-color", "--no-ext-diff", "-M"].map(str::to_owned).to_vec();
    if let Some(pre) = pre {
        base.push(format!("-G{pre}"));
        if !request.case_sensitive && ascii {
            base.push("--regexp-ignore-case".to_owned());
        }
    }
    let input = format!("{}\n", scan.join("\n")).into_bytes();
    let options = || GitOptions { input: Some(input.clone()), ..GitOptions::default() };
    let mut first = base.clone();
    first.push("--diff-merges=first-parent".to_owned());
    let out = match git_with(cwd, &first, options()).await {
        Ok(out) => out,
        Err(error) if NO_DIFF_MERGES.is_match(if error.details.is_empty() { &error.message } else { &error.details }) => git_with(cwd, &base, options()).await?,
        Err(error) => return Err(error),
    };

    let mut commits = Vec::new();
    let (mut total, mut truncated) = (0u32, false);
    for record in out.split(RS) {
        let (first_line, rest) = record.split_once('\n').unwrap_or((record, record));
        let hash = js::trim(first_line);
        if !is_hash(hash) {
            continue;
        }
        let mut files: Vec<HistoryFile> = Vec::new();
        let mut open = false;
        let (mut old_line, mut new_line) = (0u64, 0u64);
        let mut pending: Option<String> = None;
        let mut status = "M";
        for raw in rest.split('\n') {
            let line = raw.strip_suffix('\r').unwrap_or(raw);
            if line.starts_with("diff --git ") {
                open = false;
                pending = None;
                status = "M";
                continue;
            }
            if !open {
                if line.starts_with("new file mode") {
                    status = "A";
                } else if line.starts_with("deleted file mode") {
                    status = "D";
                } else if line.starts_with("rename from ") {
                    status = "R";
                }
            }
            if line.starts_with("--- ") {
                pending = old_name(line);
                continue;
            }
            if line.starts_with("+++ ") {
                let next = new_name(line);
                let old_path = renamed_from(pending.as_ref(), next.as_ref());
                files.push(HistoryFile { path: next.or_else(|| pending.clone()), old_path, status: status.to_owned(), count: 0, lines: Vec::new() });
                open = true;
                continue;
            }
            if let Some(caps) = HUNK.captures(line) {
                old_line = caps[1].parse().unwrap_or(0);
                new_line = caps[2].parse().unwrap_or(0);
                continue;
            }
            if !open || !(line.starts_with('+') || line.starts_with('-')) {
                continue;
            }
            let added = line.starts_with('+');
            let (o, n) = if added {
                new_line += 1;
                (None, Some(new_line - 1))
            } else {
                old_line += 1;
                (Some(old_line - 1), None)
            };
            let text: Vec<u16> = line[1..].encode_utf16().collect();
            let ranges = ranges_in(&regex, &text, 20);
            if ranges.is_empty() {
                continue;
            }
            let file = files.last_mut().expect("файл открыт");
            file.count += ranges.len() as u32;
            if file.lines.len() < HIST_MAX_LINES {
                let shown = show(&text, &ranges, 240, 60);
                file.lines.push(HistoryLine { t: line[..1].to_owned(), o, n, text: shown.text, cut: shown.cut, ranges: shown.ranges });
            }
        }
        files.retain(|file| file.count > 0);
        if files.is_empty() {
            continue;
        }
        let count: u32 = files.iter().map(|file| file.count).sum();
        total += count;
        let more_files = files.len().saturating_sub(HIST_MAX_FILES) as u32;
        files.truncate(HIST_MAX_FILES);
        commits.push(HistoryHit { hash: hash.to_owned(), files, more_files, count });
        if commits.len() >= HIST_MAX_COMMITS {
            truncated = true;
            break;
        }
    }
    Ok(HistorySearch { commits, total, truncated, scanned: Some(scan.len() as u32), partial: Some(scan.len() < list.len()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_free_pattern() {
        assert_eq!(case_free_ere("Пр1."), "(п|П)(р|Р)1\\.");
    }

    #[test]
    fn long_line_is_cut_around_first_match() {
        let text: Vec<u16> = format!("{}ИСКОМОЕ{}", "x".repeat(500), "y".repeat(500)).encode_utf16().collect();
        let shown = show(&text, &[(500, 507)], 400, 80);
        assert!(shown.cut);
        assert_eq!(shown.ranges, [[80, 87]]);
        assert_eq!(js::utf16_len(&shown.text), 400);
    }
}
