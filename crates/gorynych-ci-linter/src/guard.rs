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
//! ## Особенности 1.x, сохранённые ради паритета
//! - Добавленная строка, начинающаяся с `++ `, в diff выглядит как `+++ `, поэтому считается заголовком файла: дальнейшие находки
//!   приписываются «файлу» с таким именем, а сама строка не проверяется.
//! - Секрет, пересекающий границу 240 символов, не маскируется: `end` больше длины `text`, и его начало видно в `text`.
//!
//! ## Отличия от 1.x
//! - Правило приходит типизированным: шаблон не строкой (возможен только при ручной правке `localStorage`) даёт ошибку вызова,
//!   а не пропуск правила.
//! - Проверка `typeof diff !== 'string'` не нужна: тип гарантирует строку.
//! - Половина суррогатной пары на границе среза становится U+FFFD: тоже одна единица UTF-16, поэтому `start` и `end` не сдвигаются.
//! - Текст в `invalid[].error` другой, см. [`crate::js_regex`].

use std::collections::HashSet;
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

/// Находка в строке `sample` по сработавшему правилу.
fn finding(file: &str, line: u32, rule: &GuardRule, sample: &[u16], matched: std::ops::Range<usize>) -> GuardFinding {
    let offset = sample.iter().take_while(|unit| is_whitespace_unit(**unit)).count();
    let trimmed_end = sample.iter().rposition(|unit| !is_whitespace_unit(*unit)).map_or(offset, |last| last + 1);
    let trimmed = &sample[offset..trimmed_end.max(offset)];
    let shown = &trimmed[..trimmed.len().min(MAX_SHOWN)];

    let matched_text = &sample[matched.clone()];
    let start = matched.start as i64 - offset as i64;
    let mut end = start + matched_text.len() as i64;
    let mut display = shown.to_vec();
    if rule.category.as_deref() == Some("secret") && start >= 0 && end <= shown.len() as i64 {
        let masked = mask(matched_text);
        let (from, to) = (start as usize, end as usize);
        display = [&shown[..from], &masked, &shown[to..]].concat();
        end = start + masked.len() as i64;
    }
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
) -> Option<(&'r CompiledRule<'a>, std::ops::Range<usize>)> {
    let mut best: Option<(&CompiledRule, std::ops::Range<usize>)> = None;
    for rule in rules {
        if !rule.extensions.is_empty() && !rule.extensions.iter().any(|item| item == extension) {
            continue;
        }
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

/// Номер строки из заголовка `@@`: первое `+N`.
fn hunk_start(header: &str) -> u32 {
    header
        .split('+')
        .skip(1)
        .map(|part| &part[..part.find(|c: char| !c.is_ascii_digit()).unwrap_or(part.len())])
        .find(|digits| !digits.is_empty())
        .map_or(0, |digits| digits.parse().unwrap_or(u32::MAX))
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
    let mut added_lines = 0;
    let mut files = HashSet::new();
    let mut truncated = false;

    for raw in diff.split('\n') {
        if raw.starts_with("diff --git ") {
            file = None;
            continue;
        }
        if let Some(header) = raw.strip_prefix("+++ ") {
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
            line = hunk_start(raw);
            continue;
        }
        let Some(name) = file else { continue };
        if let Some(added) = raw.strip_prefix('+') {
            added_lines += 1;
            let text = added.strip_suffix('\r').unwrap_or(added);
            if !has_ignore_mark(text) {
                let sample: Vec<u16> = text.encode_utf16().take(MAX_LINE).collect();
                if let Some((best, matched)) = best_match(&rules, &ext_of(name), &sample) {
                    findings.push(finding(name, line, best.rule, &sample, matched));
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
        assert_eq!(hunk_start("@@ -1,2 +30,4 @@ context +99"), 30);
        assert_eq!(hunk_start("@@ -1 @@ a+b +7"), 7);
        assert_eq!(hunk_start("@@ broken"), 0);
        assert_eq!(hunk_start("@@ -1 +99999999999999 @@"), u32::MAX);
    }
}
