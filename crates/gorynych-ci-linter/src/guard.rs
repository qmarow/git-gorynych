//! Pre-commit Guard, перенос `electron/guard.cjs`: поиск забытой отладки и секретов в добавленных строках staged-изменений.
//!
//! ## Конспект
//! - `scanStaged(cwd, {rules, exclude})`: `git diff --cached --no-color --no-ext-diff -U0 --diff-filter=ACMR`. Ошибка git с
//!   `unknown revision` или `ambiguous argument 'HEAD'` в `details` (без учёта регистра) = пустой diff, прочие пробрасываются.
//!   Результат — как у `scanDiff`, плюс `ms`.
//! - `compile`: правило без шаблона или с пустым шаблоном пропускается молча; флаги фильтруются до `imsu`, повтор флага делает
//!   правило недействительным; невалидные попадают в `invalid {id, label, error}`. `files` — расширения: разделитель
//!   `[,\s]+`, срез `^\*?\.`, нижний регистр. Пусто = все файлы.
//! - `extOf`: после последней точки имени, нижний регистр. Точка в начале или её отсутствие = всё имя (`.env`, `Makefile`).
//! - `globToRe`: trim, `\` → `/`, срез `./`; пустой шаблон = `null`. Хвост `/` → `**`; `**/` → `(?:.*/)?`, `**` → `.*`, `*` →
//!   `[^/]*`, `?` → `[^/]`. Шаблон без `/` (проверяется до добавления `**`) совпадает с именем в любой папке. Без учёта регистра.
//! - `scanDiff`: строки проверяются по порядку.
//!   - `diff --git ` сбрасывает файл.
//!   - `+++ ` задаёт файл: trim, `/dev/null` = нет файла, срез `b/` или `"b/` и закрывающей `"`. Исключённый файл увеличивает
//!     `skippedFiles` и не считается в `files`.
//!   - `--- ` и `Binary files ` пропускаются. `@@ ` задаёт номер строки: первое `+N`, иначе 0.
//!   - Без файла строка пропускается. `+`: считается в `addedLines`, срез `\r` в конце. Метка
//!     `gorynych-ignore|gitidea-ignore|guard-ignore` (без учёта регистра, по всей строке) отменяет проверку. Номер строки растёт
//!     у `+` и ` `.
//!   - Проверяются первые 4000 единиц UTF-16. На строку одна находка: самое строгое правило (`block` = 2, остальные = 1), при
//!     равенстве — первое; на `block` перебор прекращается.
//!   - `text`: trim, не больше 240. `start = index − длина отступа`, `end = start + длина совпадения`. У `category = secret`
//!     совпадение маскируется, только если `start >= 0` и `end <= длины text`. Маска: до 8 символов `••••••••`, иначе 4 первых,
//!     `•` × min(12, длина − 6), 2 последних. На выходе `start = max(0, start)`, `end = min(длина text, max(0, end))`.
//!   - На 300 находках `truncated = true` и остановка. `blocked` — есть ли находка `block`. `level` на выходе — `block` или `warn`;
//!     `category` по умолчанию `other`.
//!
//! ## Отличия от 1.x
//! - **Исправлено.** Добавленная строка, начинающаяся с `++ `, в diff выглядит как `+++ `. В 1.x она считалась заголовком файла:
//!   сама не проверялась, а следующие находки приписывались «файлу» с таким именем. Теперь заголовком считается только `+++ `
//!   вне тела блока, длина которого берётся из `@@ … +N,M @@`.
//! - **Исправлено.** Секрет маскируется всегда, когда его видно в `text`. В 1.x маска пропускалась, если совпадение выходило за
//!   границы `text`: пересекало предел 240 символов либо захватывало отступ или пробелы в конце строки. Новый `text` тоже
//!   не длиннее 240.
//! - **Исправлено.** На показанной строке маскируются все совпадения всех секретных правил (подходящих по расширению файла), а не
//!   только сработавшего. В 1.x оставались открытыми второй секрет на строке и секрет, когда находку дало более строгое
//!   несекретное правило. Число находок и их правила от этого не меняются.
//! - Правило приходит типизированным: шаблон не строкой (возможен только при ручной правке `localStorage`) даёт ошибку вызова,
//!   а не пропуск правила.
//! - Проверка `typeof diff !== 'string'` не нужна: тип гарантирует строку.
//! - Половина суррогатной пары на границе среза становится U+FFFD: тоже одна единица UTF-16, поэтому `start` и `end` не сдвигаются.
//! - Текст в `invalid[].error` другой, см. [`crate::js_regex`].

use std::collections::HashSet;
use std::ops::Range;
use std::time::Instant;

use gorynych_core::error::Result;
use gorynych_core::js;
use serde::{Deserialize, Serialize};

use crate::js_regex::JsRegex;
use crate::repo::RepoView;

/// Аргументы `git`, вывод которых читает [`scan_staged`].
pub const STAGED_DIFF_ARGS: [&str; 6] = ["diff", "--cached", "--no-color", "--no-ext-diff", "-U0", "--diff-filter=ACMR"];

const MAX_LINE: usize = 4000;
const MAX_SHOWN: usize = 240;
const MAX_FINDINGS: usize = 300;
const IGNORE_MARKS: [&str; 3] = ["gorynych-ignore", "gitidea-ignore", "guard-ignore"];

/// Правило проверки. Лишние поля из интерфейса игнорируются.
#[derive(Debug, Clone, Default, Deserialize, Serialize, specta::Type)]
pub struct GuardRule {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub pattern: String,
    #[serde(default)]
    pub flags: Option<String>,
    /// Расширения через запятую или пробел; пусто = все файлы.
    #[serde(default)]
    pub files: Option<String>,
    /// `block`; любое другое значение считается `warn`.
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

/// Параметры `repo:guard-scan`.
#[derive(Debug, Clone, Default, Deserialize, Serialize, specta::Type)]
pub struct GuardParams {
    #[serde(default)]
    pub rules: Vec<GuardRule>,
    /// Glob-шаблоны файлов, которые не проверяются.
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum GuardLevel {
    Warn,
    Block,
}

/// Находка в строке. `start` и `end` — позиции в `text` в единицах UTF-16: интерфейс передаёт их в `String.slice`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GuardFinding {
    pub file: String,
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub category: String,
    pub level: GuardLevel,
    pub text: String,
    pub start: u32,
    pub end: u32,
}

/// Правило с ошибкой в шаблоне или флагах.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct InvalidRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub error: String,
}

/// Результат проверки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GuardScan {
    pub findings: Vec<GuardFinding>,
    pub invalid: Vec<InvalidRule>,
    pub files: u32,
    pub added_lines: u32,
    pub truncated: bool,
    pub skipped_files: u32,
    pub blocked: bool,
    /// Время чтения и проверки; у [`scan_diff`] всегда 0.
    pub ms: u32,
}

struct CompiledRule<'a> {
    rule: &'a GuardRule,
    regex: JsRegex,
    extensions: Vec<String>,
    rank: u8,
}

impl CompiledRule<'_> {
    fn applies_to(&self, extension: &str) -> bool {
        self.extensions.is_empty() || self.extensions.iter().any(|item| item == extension)
    }
}

fn extensions(files: Option<&str>) -> Vec<String> {
    files
        .unwrap_or_default()
        .split(|c| c == ',' || js::is_whitespace(c))
        .map(|item| item.strip_prefix("*.").or_else(|| item.strip_prefix('.')).unwrap_or(item).to_lowercase())
        .filter(|item| !item.is_empty())
        .collect()
}

fn compile(rules: &[GuardRule]) -> (Vec<CompiledRule<'_>>, Vec<InvalidRule>) {
    let mut ok = Vec::new();
    let mut invalid = Vec::new();
    for rule in rules.iter().filter(|rule| !rule.pattern.is_empty()) {
        let flags: String = rule.flags.as_deref().unwrap_or_default().chars().filter(|c| "imsu".contains(*c)).collect();
        match JsRegex::new(&rule.pattern, &flags) {
            Ok(regex) => ok.push(CompiledRule {
                rule,
                regex,
                extensions: extensions(rule.files.as_deref()),
                rank: if rule.level.as_deref() == Some("block") { 2 } else { 1 },
            }),
            Err(error) => invalid.push(InvalidRule { id: rule.id.clone(), label: rule.label.clone(), error }),
        }
    }
    (ok, invalid)
}

fn ext_of(file: &str) -> String {
    let name = file.rsplit('/').next().unwrap_or(file);
    match name.rfind('.') {
        Some(index) if index > 0 => name[index + 1..].to_lowercase(),
        _ => name.to_lowercase(),
    }
}

/// `globToRe`. Пустой шаблон даёт `None`.
pub fn glob_to_regex(glob: &str) -> Option<JsRegex> {
    let normalized = js::trim(glob).replace('\\', "/");
    let mut glob = normalized.strip_prefix("./").unwrap_or(&normalized).to_owned();
    if glob.is_empty() {
        return None;
    }
    let anywhere = !glob.contains('/');
    if glob.ends_with('/') {
        glob.push_str("**");
    }
    let mut pattern = String::from(if anywhere { "^(?:.*/)?" } else { "^" });
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    pattern.push_str("(?:.*/)?");
                } else {
                    pattern.push_str(".*");
                }
            }
            '*' => pattern.push_str("[^/]*"),
            '?' => pattern.push_str("[^/]"),
            _ => {
                if ".+^${}()|[]\\".contains(c) {
                    pattern.push('\\');
                }
                pattern.push(c);
            }
        }
    }
    pattern.push('$');
    Some(JsRegex::new(&pattern, "i").expect("спецсимволы шаблона экранированы"))
}

fn is_whitespace_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(js::is_whitespace)
}

const BULLET: u16 = 0x2022;

/// `mask`: для списка находок секрет показывается замаскированным.
fn mask(text: &[u16]) -> Vec<u16> {
    if text.len() <= 8 {
        return vec![BULLET; 8];
    }
    let mut masked = text[..4].to_vec();
    masked.resize(4 + (text.len() - 6).min(12), BULLET);
    masked.extend_from_slice(&text[text.len() - 2..]);
    masked
}

/// Участок показанной строки, заменённый маской: координаты в `shown` и в итоговом тексте.
struct MaskedPart {
    from: i64,
    to: i64,
    shown_from: i64,
    shown_to: i64,
}

/// Диапазоны секретов на строке: все непустые совпадения всех секретных правил плюс сработавшее правило, если оно секретное.
/// Пересечения объединяются, иначе маска открыла бы края одного секрета внутри другого.
fn secret_ranges(rules: &[CompiledRule<'_>], extension: &str, sample: &[u16], primary: Option<Range<usize>>) -> Vec<Range<usize>> {
    let mut ranges: Vec<Range<usize>> = rules
        .iter()
        .filter(|rule| rule.rule.category.as_deref() == Some("secret") && rule.applies_to(extension))
        .flat_map(|rule| rule.regex.find_all(sample))
        .filter(|range| !range.is_empty())
        .chain(primary)
        .collect();
    ranges.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.start < last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    merged
}

/// Находка в строке `sample` по сработавшему правилу.
fn finding(
    file: &str,
    line: u32,
    best: &CompiledRule<'_>,
    rules: &[CompiledRule<'_>],
    extension: &str,
    sample: &[u16],
    matched: Range<usize>,
) -> GuardFinding {
    let rule = best.rule;
    let offset = sample.iter().take_while(|unit| is_whitespace_unit(**unit)).count();
    let trimmed_end = sample.iter().rposition(|unit| !is_whitespace_unit(*unit)).map_or(offset, |last| last + 1);
    let trimmed = &sample[offset..trimmed_end.max(offset)];
    let shown = &trimmed[..trimmed.len().min(MAX_SHOWN)];
    let length = shown.len() as i64;

    let is_secret = rule.category.as_deref() == Some("secret");
    let mut display = Vec::with_capacity(shown.len());
    let mut parts: Vec<MaskedPart> = Vec::new();
    let mut cursor = 0;
    for range in secret_ranges(rules, extension, sample, is_secret.then(|| matched.clone())) {
        let (start, end) = (range.start as i64 - offset as i64, range.end as i64 - offset as i64);
        let visible = start.max(0) < end.min(length);
        if !visible && !(start >= 0 && end <= length) {
            continue;
        }
        let (from, to) = (start.max(0) as usize, end.min(length) as usize);
        display.extend_from_slice(&shown[cursor..from]);
        let shown_from = display.len() as i64;
        display.extend_from_slice(&mask(&sample[range]));
        parts.push(MaskedPart { from: from as i64, to: to as i64, shown_from, shown_to: display.len() as i64 });
        cursor = to;
    }
    display.extend_from_slice(&shown[cursor..]);
    display.truncate(MAX_SHOWN);

    // Позиция совпадения в итоговом тексте: внутри маски выделяется вся маска
    let (raw_start, raw_end) = (matched.start as i64 - offset as i64, matched.end as i64 - offset as i64);
    let locate = |position: i64, is_end: bool| {
        let mut shift = 0;
        for part in &parts {
            let inside = if is_end { part.from < position && position <= part.to } else { part.from <= position && position < part.to };
            if inside || (part.from == part.to && part.from == position) {
                return if is_end { part.shown_to } else { part.shown_from };
            }
            if position <= part.from {
                break;
            }
            shift = part.shown_to - part.to;
        }
        position + shift
    };
    let start = locate(raw_start.max(0), false);
    let end = locate(raw_end.max(0), true);
    GuardFinding {
        file: file.to_owned(),
        line,
        rule: rule.id.clone(),
        label: rule.label.clone(),
        category: rule.category.clone().unwrap_or_else(|| "other".to_owned()),
        level: if rule.level.as_deref() == Some("block") { GuardLevel::Block } else { GuardLevel::Warn },
        start: start.max(0) as u32,
        end: end.max(0).min(display.len() as i64) as u32,
        text: String::from_utf16_lossy(&display),
    }
}

/// Самое строгое сработавшее правило для строки.
fn best_match<'r, 'a>(
    rules: &'r [CompiledRule<'a>],
    extension: &str,
    sample: &[u16],
) -> Option<(&'r CompiledRule<'a>, Range<usize>)> {
    let mut best: Option<(&CompiledRule, Range<usize>)> = None;
    for rule in rules.iter().filter(|rule| rule.applies_to(extension)) {
        let Some(matched) = rule.regex.find(sample) else { continue };
        if best.as_ref().is_none_or(|(current, _)| rule.rank > current.rank) {
            best = Some((rule, matched));
        }
        if rule.rank == 2 {
            break;
        }
    }
    best
}

/// Имя файла из строки `+++ …`.
fn file_from_header(header: &str) -> Option<&str> {
    let path = js::trim(header);
    if path == "/dev/null" {
        return None;
    }
    let path = path.strip_prefix("b/").unwrap_or(path);
    let path = path.strip_prefix("\"b/").unwrap_or(path);
    Some(path.strip_suffix('"').unwrap_or(path))
}

/// Из заголовка `@@`: номер строки (первое `+N`) и число строк нового файла в блоке (`,M`, по умолчанию 1).
fn hunk_range(header: &str) -> (u32, u32) {
    let digits_end = |text: &str| text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    let Some(part) = header.split('+').skip(1).find(|part| digits_end(part) > 0) else { return (0, 0) };
    let (digits, rest) = part.split_at(digits_end(part));
    let count = rest.strip_prefix(',').map_or(1, |rest| rest[..digits_end(rest)].parse().unwrap_or(0));
    (digits.parse().unwrap_or(u32::MAX), count)
}

fn has_ignore_mark(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    IGNORE_MARKS.iter().any(|mark| lower.contains(mark))
}

/// `scanDiff`: проверка готового вывода `git diff -U0`.
pub fn scan_diff(diff: &str, params: &GuardParams) -> GuardScan {
    let (rules, invalid) = compile(&params.rules);
    let excluded: Vec<JsRegex> = params.exclude.iter().filter_map(|glob| glob_to_regex(glob)).collect();

    let mut skipped = 0;
    let mut findings = Vec::new();
    let mut file: Option<&str> = None;
    let mut line = 0u32;
    // Сколько строк нового файла ещё осталось в блоке: внутри него `+++ ` — это содержимое, а не заголовок
    let mut hunk_left = 0u32;
    let mut added_lines = 0;
    let mut files = HashSet::new();
    let mut truncated = false;

    for raw in diff.split('\n') {
        if raw.starts_with("diff --git ") {
            file = None;
            hunk_left = 0;
            continue;
        }
        if let Some(header) = raw.strip_prefix("+++ ").filter(|_| hunk_left == 0) {
            file = file_from_header(header);
            if file.is_some_and(|name| excluded.iter().any(|regex| regex.is_match(name))) {
                skipped += 1;
                file = None;
            }
            if let Some(name) = file {
                files.insert(name);
            }
            continue;
        }
        if raw.starts_with("--- ") || raw.starts_with("Binary files ") {
            continue;
        }
        if raw.starts_with("@@ ") {
            (line, hunk_left) = hunk_range(raw);
            continue;
        }
        if raw.starts_with(['+', ' ']) {
            hunk_left = hunk_left.saturating_sub(1);
        }
        let Some(name) = file else { continue };
        if let Some(added) = raw.strip_prefix('+') {
            added_lines += 1;
            let text = added.strip_suffix('\r').unwrap_or(added);
            if !has_ignore_mark(text) {
                let sample: Vec<u16> = text.encode_utf16().take(MAX_LINE).collect();
                let extension = ext_of(name);
                if let Some((best, matched)) = best_match(&rules, &extension, &sample) {
                    findings.push(finding(name, line, best, &rules, &extension, &sample, matched));
                    truncated = findings.len() >= MAX_FINDINGS;
                }
            }
            line = line.saturating_add(1);
        } else if raw.starts_with(' ') {
            line = line.saturating_add(1);
        }
        if truncated {
            break;
        }
    }
    let blocked = findings.iter().any(|item| item.level == GuardLevel::Block);
    GuardScan {
        findings,
        invalid,
        files: files.len() as u32,
        added_lines,
        truncated,
        skipped_files: skipped,
        blocked,
        ms: 0,
    }
}

/// `scanStaged`: проверка того, что войдёт в коммит.
pub fn scan_staged(repo: &impl RepoView, params: &GuardParams) -> Result<GuardScan> {
    let started = Instant::now();
    let diff = match repo.staged_diff() {
        Ok(diff) => diff,
        Err(error) => {
            let details = error.details.to_ascii_lowercase();
            if !details.contains("unknown revision") && !details.contains("ambiguous argument 'head'") {
                return Err(error);
            }
            String::new()
        }
    };
    let mut scan = scan_diff(&diff, params);
    scan.ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    Ok(scan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_keeps_utf16_length_rules() {
        let units = |text: &str| text.encode_utf16().collect::<Vec<_>>();
        assert_eq!(String::from_utf16_lossy(&mask(&units("short"))), "••••••••");
        assert_eq!(String::from_utf16_lossy(&mask(&units("123456789"))), "1234•••89");
        assert_eq!(String::from_utf16_lossy(&mask(&units(&"a".repeat(40)))), format!("aaaa{}aa", "•".repeat(12)));
    }

    #[test]
    fn hunk_header_takes_first_plus_number() {
        assert_eq!(hunk_range("@@ -1,2 +30,4 @@ context +99"), (30, 4));
        assert_eq!(hunk_range("@@ -1 @@ a+b +7"), (7, 1));
        assert_eq!(hunk_range("@@ -1 +5,0 @@"), (5, 0));
        assert_eq!(hunk_range("@@ broken"), (0, 0));
        assert_eq!(hunk_range("@@ -1 +99999999999999 @@").0, u32::MAX);
    }

    fn scan_lines(rules: Vec<GuardRule>, lines: &[&str]) -> GuardScan {
        let body: String = lines.iter().map(|line| format!("+{line}\n")).collect();
        let diff = format!("diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,{} @@\n{body}", lines.len());
        scan_diff(&diff, &GuardParams { rules, exclude: Vec::new() })
    }

    fn rule(pattern: &str, category: Option<&str>) -> GuardRule {
        GuardRule { pattern: pattern.to_owned(), category: category.map(str::to_owned), ..GuardRule::default() }
    }

    const TOKEN: &str = "glpat-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn line_starting_with_plus_plus_is_content_not_a_header() {
        let scan = scan_lines(vec![rule("glpat-", None)], &["ok", &format!("++ {TOKEN}"), TOKEN, "+++ x"]);
        let found: Vec<_> = scan.findings.iter().map(|item| (item.file.as_str(), item.line)).collect();
        assert_eq!(found, [("a.txt", 2), ("a.txt", 3)]);
        assert_eq!((scan.files, scan.added_lines), (1, 4));
    }

    #[test]
    fn removed_dashes_then_added_pluses_stay_content() {
        let diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- old\n+++ q new\n";
        let scan = scan_diff(diff, &GuardParams { rules: vec![rule("q", None)], exclude: Vec::new() });
        assert_eq!(scan.findings[0].file, "a");
        assert_eq!(scan.findings[0].line, 1);
    }

    #[test]
    fn plus_plus_line_in_excluded_file_does_not_start_a_new_file() {
        let diff = format!(
            "diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -0,0 +1,2 @@\n+++ fake\n+{TOKEN}\n\
             diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -0,0 +7 @@\n+{TOKEN}\n"
        );
        let params = GuardParams { rules: vec![rule("glpat", None)], exclude: vec!["*.md".to_owned()] };
        let scan = scan_diff(&diff, &params);
        assert_eq!(scan.files, 1);
        assert_eq!((scan.findings.len(), scan.findings[0].file.as_str(), scan.findings[0].line), (1, "b", 7));
    }

    #[test]
    fn next_file_header_works_after_a_full_hunk() {
        let diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+x\n--- a/b\n+++ b/b\n@@ -0,0 +4 @@\n+q\n";
        let scan = scan_diff(diff, &GuardParams { rules: vec![rule("q", None)], exclude: Vec::new() });
        assert_eq!((scan.findings[0].file.as_str(), scan.findings[0].line), ("b", 4));
    }

    #[test]
    fn context_lines_count_towards_the_hunk() {
        let diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n ctx\n+x\n--- a/b\n+++ b/b\n@@ -0,0 +4 @@\n+q\n";
        let scan = scan_diff(diff, &GuardParams { rules: vec![rule("q", None)], exclude: Vec::new() });
        assert_eq!((scan.findings[0].file.as_str(), scan.findings[0].line), ("b", 4));
    }

    #[test]
    fn new_file_resets_an_unfinished_hunk() {
        let diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,5 @@\n+x\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -0,0 +4 @@\n+q\n";
        let scan = scan_diff(diff, &GuardParams { rules: vec![rule("q", None)], exclude: Vec::new() });
        assert_eq!((scan.findings[0].file.as_str(), scan.findings[0].line), ("b", 4));
    }

    #[test]
    fn mask_bounds_are_exact_when_the_match_covers_the_indent() {
        let scan = scan_lines(vec![rule(r"\s+glpat-[a-z]+", Some("secret"))], &[&format!("    {TOKEN} tail")]);
        let found = &scan.findings[0];
        // Совпадение с отступом начинается с четырёх пробелов: маска показывает их вместо начала секрета
        assert_eq!(found.text, format!("    {}aa tail", "•".repeat(12)));
        assert_eq!((found.start, found.end), (0, 18));
    }

    #[test]
    fn every_secret_on_the_line_is_masked() {
        let other = "glpat-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let scan = scan_lines(vec![rule("glpat-[a-z]+", Some("secret"))], &[&format!("x={TOKEN} y={other} z")]);
        let found = &scan.findings[0];
        assert_eq!(found.text, format!("x=glpa{0}aa y=glpa{0}bb z", "•".repeat(12)));
        assert_eq!((found.start, found.end), (2, 20));
        assert_eq!(scan.findings.len(), 1);
    }

    #[test]
    fn secret_is_masked_when_a_stricter_plain_rule_wins() {
        let debug = GuardRule { level: Some("block".to_owned()), id: Some("d".to_owned()), ..rule("DEBUG", Some("debug")) };
        let secret = rule("glpat-[a-z]+", Some("secret"));
        // Маска секрета сдвигает всё, что стоит после него
        let scan = scan_lines(vec![secret, debug], &[&format!("{TOKEN} DEBUG")]);
        let found = &scan.findings[0];
        assert_eq!(found.rule.as_deref(), Some("d"));
        assert_eq!(found.text, format!("glpa{}aa DEBUG", "•".repeat(12)));
        assert_eq!((found.start, found.end), (19, 24));
    }

    #[test]
    fn plain_match_covering_a_secret_highlights_through_the_mask() {
        let debug = GuardRule { level: Some("block".to_owned()), ..rule("x=.* end", None) };
        let scan = scan_lines(vec![rule("glpat-[a-z]+", Some("secret")), debug], &[&format!("x={TOKEN} end")]);
        let found = &scan.findings[0];
        assert_eq!(found.text, format!("x=glpa{}aa end", "•".repeat(12)));
        assert_eq!((found.start, found.end), (0, found.text.encode_utf16().count() as u32));
    }

    #[test]
    fn overlapping_secrets_merge_into_one_mask() {
        let scan = scan_lines(vec![rule("glpat-[a-z]+", Some("secret")), rule("t-a+ tail", Some("secret"))], &[&format!("{TOKEN} tail")]);
        assert_eq!(scan.findings[0].text, format!("glpa{}il", "•".repeat(12)));
    }

    #[test]
    fn secret_nested_in_a_longer_one_does_not_shrink_the_mask() {
        let scan = scan_lines(vec![rule("glpat-[a-z]+", Some("secret")), rule("glpat", Some("secret"))], &[TOKEN]);
        assert_eq!(scan.findings[0].text, format!("glpa{}aa", "•".repeat(12)));
    }

    #[test]
    fn secret_rule_of_another_file_type_does_not_mask() {
        let scoped = GuardRule { files: Some("py".to_owned()), ..rule("secretword", Some("secret")) };
        let scan = scan_lines(vec![rule("q", None), scoped], &["q secretword"]);
        assert_eq!(scan.findings[0].text, "q secretword");
    }

    fn assert_no_token_part(finding: &GuardFinding) {
        // Маска оставляет 4 первых символа и 2 последних, длиннее ничего от секрета видно быть не должно
        assert!(!finding.text.contains("glpat-"), "{}", finding.text);
        assert!(!finding.text.contains("aaa"), "{}", finding.text);
    }

    #[test]
    fn secret_is_masked_whenever_visible() {
        let cases = [
            (format!("{}{TOKEN}", "x".repeat(230)), "glpat-[a-z]+"),
            (format!("{}{TOKEN}", "x".repeat(239)), "glpat-[a-z]+"),
            (format!("{}{TOKEN}z", "x".repeat(205)), "glpat-[a-z]+"),
            (format!("    {TOKEN}"), r"\s+glpat-[a-z]+"),
            (format!("{TOKEN}    "), r"glpat-[a-z]+\s+"),
            (format!("   {TOKEN}   "), r"\s+glpat-[a-z]+\s+"),
        ];
        for (line, pattern) in &cases {
            let scan = scan_lines(vec![rule(pattern, Some("secret"))], &[line]);
            let found = &scan.findings[0];
            assert_no_token_part(found);
            let units: Vec<u16> = found.text.encode_utf16().collect();
            assert!(units.len() <= MAX_SHOWN, "{}", units.len());
            assert!(found.start < found.end && found.end as usize <= units.len(), "{found:?}");
        }
    }

    #[test]
    fn secret_past_the_visible_part_changes_nothing() {
        let line = format!("{}{TOKEN}", "x".repeat(300));
        let scan = scan_lines(vec![rule("glpat-[a-z]+", Some("secret"))], &[&line]);
        assert_eq!(scan.findings[0].text, "x".repeat(240));
    }

    #[test]
    fn match_only_in_indent_changes_nothing() {
        let scan = scan_lines(vec![rule(r"^\s+", Some("secret"))], &["    code"]);
        assert_eq!(scan.findings[0].text, "code");
        assert_eq!((scan.findings[0].start, scan.findings[0].end), (0, 0));
    }
}
