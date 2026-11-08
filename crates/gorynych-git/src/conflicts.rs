//! Разрешение конфликтов: разбор файла с маркерами, подписи сторон, сохранение результата. Перенос `electron/conflicts.cjs`.
//!
//! ## Конспект
//! - Во время rebase стороны перевёрнуты: ours — то, на что перебазируем, theirs — ваш коммит (`swapped`). Конфликт после `stash apply/pop` идёт без операции.
//! - `parseConflictText`: маркеры ровно из 7 символов; незакрытый блок становится обычным текстом, чтобы ничего не потерять. Номера строк с единицы.
//! - `getConflict`: `resolved` (записей в индексе нет), `both-deleted`, `deleted` (с какой стороны и какую оставить), `no-markers`, `binary` (ноль в первых 8000 байт), `text`.
//! - `saveResolution`: маркеры в результате — `MARKERS_LEFT`. `resolveWhole`: сторона, где файл удалён, означает удаление. `markResolved`: нет файла — снять из индекса.
//!
//! Проверка маркеров многострочная, как `/m` в JS: строки делятся ещё и по `\r`, U+2028, U+2029.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use gorynych_core::paths::safe_relative;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::read::{detect_operation, resolve_repo_root};
use crate::run::git;

static NAME_TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"~[0-9]+$|\^[0-9]+$").expect("корректный шаблон"));
static STAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]+) ([0-9a-f]+) ([0-9])\t").expect("корректный шаблон"));

struct RevInfo {
    short: String,
    subject: String,
    name: Option<String>,
}

async fn rev_info(cwd: &Path, reference: &str) -> Option<RevInfo> {
    let out = git(cwd, &["rev-parse", "--verify", "--quiet", reference]).await.unwrap_or_default();
    let hash = js::trim(&out);
    if hash.is_empty() {
        return None;
    }
    let subject = git(cwd, &["log", "-1", "--format=%s", hash]).await.unwrap_or_default();
    let name = git(cwd, &["name-rev", "--name-only", "--no-undefined", "--refs=refs/heads/*", "--refs=refs/remotes/*", hash]).await.unwrap_or_default();
    let name = NAME_TAIL.replace(js::trim(&name), "").into_owned();
    Some(RevInfo { short: hash.chars().take(7).collect(), subject: js::trim(&subject).to_owned(), name: (!name.is_empty()).then_some(name) })
}

async fn current_branch(cwd: &Path) -> Option<String> {
    let out = git(cwd, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await.unwrap_or_default();
    let name = js::trim(&out);
    (!name.is_empty()).then(|| name.to_owned())
}

/// Подпись стороны.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Side {
    pub title: String,
    pub sub: String,
    pub hint: String,
}

/// Кто есть «моё» и «их».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SideLabels {
    pub operation: Option<String>,
    pub ours: Side,
    pub theirs: Side,
    pub swapped: Option<bool>,
}

async fn side_labels(cwd: &Path) -> SideLabels {
    let operation = detect_operation(cwd).await;
    let head = rev_info(cwd, "HEAD").await;
    let head_short = head.as_ref().map(|head| head.short.clone());
    let side = |title: String, sub: String, hint: String| Side { title, sub, hint };
    match operation {
        Some("merge") => {
            let other = rev_info(cwd, "MERGE_HEAD").await;
            let sub = current_branch(cwd).await.or(head_short).unwrap_or_else(|| "HEAD".to_owned());
            SideLabels {
                operation: Some("merge".to_owned()),
                ours: side(t("Моё", &[]), sub, t("Ваша текущая ветка", &[])),
                theirs: side(
                    t("Их", &[]),
                    other.as_ref().and_then(|other| other.name.clone().or_else(|| Some(other.short.clone()))).unwrap_or_else(|| "MERGE_HEAD".to_owned()),
                    other.as_ref().map_or_else(|| t("Вливаемая ветка", &[]), |other| t("Вливаемая ветка · «{0}»", &[&other.subject])),
                ),
                swapped: None,
            }
        }
        Some("rebase") => {
            let mine = rev_info(cwd, "REBASE_HEAD").await;
            SideLabels {
                operation: Some("rebase".to_owned()),
                ours: side(t("Их", &[]), head.as_ref().and_then(|head| head.name.clone()).or(head_short).unwrap_or_else(|| "upstream".to_owned()), t("Ветка, на которую вы перебазируете (уже на сервере / в upstream)", &[])),
                theirs: side(t("Моё", &[]), mine.map_or_else(|| t("ваш коммит", &[]), |mine| format!("{} · {}", mine.short, mine.subject)), t("Ваш коммит, который сейчас переносится", &[])),
                swapped: Some(true),
            }
        }
        Some(kind @ ("cherry-pick" | "revert")) => {
            let cherry = kind == "cherry-pick";
            let pick = rev_info(cwd, if cherry { "CHERRY_PICK_HEAD" } else { "REVERT_HEAD" }).await;
            let sub = current_branch(cwd).await.or(head_short).unwrap_or_else(|| "HEAD".to_owned());
            SideLabels {
                operation: Some(kind.to_owned()),
                ours: side(t("Моё", &[]), sub, t("Ваша текущая ветка", &[])),
                theirs: side(
                    if cherry { t("Переносимый коммит", &[]) } else { t("Отмена коммита", &[]) },
                    pick.map_or_else(String::new, |pick| format!("{} · {}", pick.short, pick.subject)),
                    if cherry { t("Изменения из cherry-pick", &[]) } else { t("Изменения revert", &[]) },
                ),
                swapped: None,
            }
        }
        // Конфликт после stash apply/pop: операции нет, но в индексе есть конфликтующие файлы
        _ => SideLabels {
            operation: None,
            ours: side(t("Текущее", &[]), current_branch(cwd).await.unwrap_or_else(|| t("рабочая версия", &[])), t("Файл до применения stash", &[])),
            theirs: side(t("Из stash", &[]), t("спрятанные изменения", &[]), t("Изменения из stash", &[])),
            swapped: None,
        },
    }
}

/// Участок файла.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ConflictSegment {
    Common {
        lines: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        ours: Vec<String>,
        base: Option<Vec<String>>,
        theirs: Vec<String>,
        ours_label: String,
        theirs_label: String,
        base_label: String,
        #[specta(type = f64)]
        start_line: u32,
        #[specta(type = f64)]
        end_line: u32,
    },
}

/// `parseConflictText`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParsedConflict {
    pub segments: Vec<ConflictSegment>,
    pub eol: String,
    pub final_newline: bool,
    #[specta(type = f64)]
    pub conflicts: u32,
}

/// `/^<{7}(?: (.*))?$/`: подпись маркера. `.` в JS не совпадает с `\r`, U+2028, U+2029.
fn marker(line: &str, mark: char) -> Option<String> {
    let rest = line.strip_prefix(&mark.to_string().repeat(7))?;
    if rest.is_empty() {
        return Some(String::new());
    }
    let label = rest.strip_prefix(' ')?;
    (!label.contains(['\r', '\u{2028}', '\u{2029}'])).then(|| label.to_owned())
}

/// `parseConflictText`.
pub fn parse_conflict_text(text: &str) -> ParsedConflict {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let final_newline = text.ends_with('\n');
    let body = text.strip_suffix('\n').map_or(text, |body| body.strip_suffix('\r').unwrap_or(body));

    #[derive(Clone, Copy, PartialEq)]
    enum Part {
        Ours,
        Base,
        Theirs,
    }
    struct Block {
        ours: Vec<String>,
        base: Option<Vec<String>>,
        theirs: Vec<String>,
        ours_label: String,
        base_label: String,
        start_line: u32,
        part: Part,
    }
    let mut segments = Vec::new();
    let mut common: Vec<String> = Vec::new();
    let mut block: Option<Block> = None;
    let flush = |common: &mut Vec<String>, segments: &mut Vec<ConflictSegment>| {
        if !common.is_empty() {
            segments.push(ConflictSegment::Common { lines: std::mem::take(common) });
        }
    };
    for (index, line) in body.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).enumerate() {
        let number = index as u32 + 1;
        let Some(open) = block.as_mut() else {
            if let Some(label) = marker(line, '<') {
                flush(&mut common, &mut segments);
                block = Some(Block { ours: Vec::new(), base: None, theirs: Vec::new(), ours_label: label, base_label: String::new(), start_line: number, part: Part::Ours });
            } else {
                common.push(line.to_owned());
            }
            continue;
        };
        if open.part == Part::Ours
            && let Some(label) = marker(line, '|')
        {
            open.base = Some(Vec::new());
            open.base_label = label;
            open.part = Part::Base;
            continue;
        }
        if matches!(open.part, Part::Ours | Part::Base) && line == "=======" {
            open.part = Part::Theirs;
            continue;
        }
        if open.part == Part::Theirs
            && let Some(label) = marker(line, '>')
        {
            let done = block.take().expect("блок открыт");
            segments.push(ConflictSegment::Conflict { ours: done.ours, base: done.base, theirs: done.theirs, ours_label: done.ours_label, theirs_label: label, base_label: done.base_label, start_line: done.start_line, end_line: number });
            continue;
        }
        match open.part {
            Part::Ours => open.ours.push(line.to_owned()),
            Part::Base => open.base.get_or_insert_with(Vec::new).push(line.to_owned()),
            Part::Theirs => open.theirs.push(line.to_owned()),
        }
    }
    // Незакрытый блок считаем обычным текстом, чтобы ничего не потерять
    if let Some(open) = block {
        common.push(format!("<<<<<<< {}", open.ours_label));
        common.extend(open.ours);
        if let Some(base) = open.base {
            common.push("|||||||".to_owned());
            common.extend(base);
        }
        common.push("=======".to_owned());
        common.extend(open.theirs);
    }
    flush(&mut common, &mut segments);
    let conflicts = segments.iter().filter(|segment| matches!(segment, ConflictSegment::Conflict { .. })).count() as u32;
    ParsedConflict { segments, eol: eol.to_owned(), final_newline, conflicts }
}

async fn stages_of(cwd: &Path, file: &str) -> Result<BTreeMap<String, ()>> {
    let out = git(cwd, &["ls-files", "-u", "-z", "--", file]).await?;
    Ok(out.split('\0').filter_map(|entry| STAGE.captures(entry).map(|caps| (caps[3].to_owned(), ()))).collect())
}

/// `getConflict`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub path: String,
    pub labels: SideLabels,
    pub stages: Vec<String>,
    pub kind: String,
    pub deleted_side: Option<String>,
    pub keep_side: Option<String>,
    pub exists: Option<bool>,
    #[serde(flatten)]
    pub parsed: Option<ParsedConflict>,
}

/// `getConflict`.
pub async fn get_conflict(dir: &Path, file: &str) -> Result<ConflictInfo> {
    let root = resolve_repo_root(dir).await?;
    let full = safe_relative(&root, file, i18n::language())?;
    let stages = stages_of(&root, file).await?;
    let labels = side_labels(&root).await;
    let mut info = ConflictInfo { path: file.to_owned(), labels, stages: stages.keys().cloned().collect(), kind: String::new(), deleted_side: None, keep_side: None, exists: None, parsed: None };
    let (ours, theirs) = (stages.contains_key("2"), stages.contains_key("3"));
    let set = |info: &mut ConflictInfo, kind: &str| info.kind = kind.to_owned();
    if !ours && !theirs {
        set(&mut info, if stages.is_empty() { "resolved" } else { "both-deleted" });
        return Ok(info);
    }
    // keepSide: с какой стороны файл остался, для кнопки «Оставить файл»
    if !ours || !theirs {
        set(&mut info, "deleted");
        info.deleted_side = Some(if ours { "theirs" } else { "ours" }.to_owned());
        info.keep_side = Some(if ours { "ours" } else { "theirs" }.to_owned());
        info.exists = Some(full.exists());
        return Ok(info);
    }
    if !full.exists() {
        set(&mut info, "no-markers");
        info.exists = Some(false);
        return Ok(info);
    }
    let bytes = std::fs::read(&full).map_err(GorynychError::unknown)?;
    if bytes[..bytes.len().min(8000)].contains(&0) {
        set(&mut info, "binary");
        return Ok(info);
    }
    let parsed = parse_conflict_text(&String::from_utf8_lossy(&bytes));
    if parsed.conflicts == 0 {
        set(&mut info, "no-markers");
        info.exists = Some(true);
        return Ok(info);
    }
    set(&mut info, "text");
    info.parsed = Some(parsed);
    Ok(info)
}

/// Есть ли строка, начинающаяся маркером: `/^<{7}( |$)/m`.
fn has_marker(text: &str, mark: char) -> bool {
    let prefix = mark.to_string().repeat(7);
    text.split(['\n', '\r', '\u{2028}', '\u{2029}']).any(|line| line.strip_prefix(prefix.as_str()).is_some_and(|rest| rest.is_empty() || rest.starts_with(' ')))
}

/// Параметры `saveResolution`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct SaveResolution {
    pub path: Option<String>,
    #[specta(type = Option<String>)]
    pub content: Option<Value>,
}

/// Результат действия с файлом конфликта.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct ResolveResult {
    pub path: String,
    pub side: Option<String>,
    pub deleted: Option<bool>,
}

/// `saveResolution`.
pub async fn save_resolution(dir: &Path, request: &SaveResolution) -> Result<ResolveResult> {
    let Some(content) = request.content.as_ref().and_then(Value::as_str) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Нет содержимого", &[])));
    };
    let root = resolve_repo_root(dir).await?;
    let file = request.path.as_deref().unwrap_or_default();
    let full = safe_relative(&root, file, i18n::language())?;
    if has_marker(content, '<') || has_marker(content, '>') {
        return Err(GorynychError::new(ErrorCode::MarkersLeft, t("В результате остались маркеры конфликта", &[])).with_hint(t("Решите все блоки конфликта.", &[])));
    }
    std::fs::write(&full, content).map_err(GorynychError::unknown)?;
    git(&root, &["add", "--", file]).await?;
    Ok(ResolveResult { path: file.to_owned(), ..ResolveResult::default() })
}

/// Параметры `resolveWhole`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ResolveWhole {
    pub path: Option<String>,
    pub side: Option<String>,
}

/// `resolveWhole`: файл целиком с одной стороны или удаление.
pub async fn resolve_whole(dir: &Path, request: &ResolveWhole) -> Result<ResolveResult> {
    let root = resolve_repo_root(dir).await?;
    let file = request.path.as_deref().unwrap_or_default();
    safe_relative(&root, file, i18n::language())?;
    let stages = stages_of(&root, file).await?;
    let remove = || async { git(&root, &["rm", "-q", "--force", "--", file]).await };
    let done = |side: &str| ResolveResult { path: file.to_owned(), side: Some(side.to_owned()), deleted: None };
    let side = request.side.as_deref().unwrap_or_default();
    if side == "delete" {
        remove().await?;
        return Ok(done("delete"));
    }
    let stage = match side {
        "ours" => "2",
        "theirs" => "3",
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректная сторона", &[]))),
    };
    if !stages.contains_key(stage) {
        // С этой стороны файл удалён: выбрать её значит удалить файл
        remove().await?;
        return Ok(done("delete"));
    }
    git(&root, &["checkout", &format!("--{side}"), "--", file]).await?;
    git(&root, &["add", "--", file]).await?;
    Ok(done(side))
}

/// Параметры `markResolved`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct MarkResolved {
    pub path: Option<String>,
    pub force: bool,
}

/// `markResolved`.
pub async fn mark_resolved(dir: &Path, request: &MarkResolved) -> Result<ResolveResult> {
    let root = resolve_repo_root(dir).await?;
    let file = request.path.as_deref().unwrap_or_default();
    let full = safe_relative(&root, file, i18n::language())?;
    if !full.exists() {
        git(&root, &["rm", "-q", "--cached", "--ignore-unmatch", "--", file]).await?;
        return Ok(ResolveResult { path: file.to_owned(), side: None, deleted: Some(true) });
    }
    let bytes = std::fs::read(&full).map_err(GorynychError::unknown)?;
    let text = String::from_utf8_lossy(&bytes);
    if !request.force && has_marker(&text, '<') && has_marker(&text, '>') {
        return Err(GorynychError::new(ErrorCode::MarkersLeft, t("В файле ещё есть маркеры конфликта", &[])).with_hint(t("Решите конфликт в редакторе или отметьте принудительно.", &[])));
    }
    git(&root, &["add", "--", file]).await?;
    Ok(ResolveResult { path: file.to_owned(), ..ResolveResult::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_needs_exactly_seven() {
        assert_eq!(marker("<<<<<<< HEAD", '<').as_deref(), Some("HEAD"));
        assert_eq!(marker("<<<<<<<", '<').as_deref(), Some(""));
        assert_eq!(marker("<<<<<<<<", '<'), None);
        assert_eq!(marker("<<<<<<", '<'), None);
        assert_eq!(marker("<<<<<<<x", '<'), None);
    }

    #[test]
    fn multiline_marker_search() {
        assert!(has_marker("a\n<<<<<<< x\nb", '<'));
        assert!(has_marker("a\r>>>>>>>", '>'));
        assert!(!has_marker("a <<<<<<< x", '<'));
    }
}
