//! Новое в 2.0: шаблоны задач из рабочей копии, без сети.
//!
//! - GitLab: `.gitlab/issue_templates/*.md` — имя файла без расширения становится именем шаблона.
//! - GitHub и Gitea: `.github/ISSUE_TEMPLATE/*.md`, `.gitea/ISSUE_TEMPLATE/*.md`, `.gitea/issue_template/*.md`. В начале
//!   файла может быть блок YAML между `---`: из него берутся `name`, `title`, `labels` (список или строка через запятую),
//!   остальное — тело. Формы `.yml` пропускаются.
//!
//! Не больше [`MAX_TEMPLATES`] шаблонов, каждый не больше [`MAX_TEMPLATE_BYTES`]; файлы — по имени. Папки нет — пустой список.

use std::path::Path;

use gorynych_ci_linter::yaml::{Value as Yaml, parse_yaml};

use super::models::IssueTemplate;

pub const MAX_TEMPLATES: usize = 20;
pub const MAX_TEMPLATE_BYTES: u64 = 64 * 1024;

/// Раскладка папок с шаблонами.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Gitlab,
    /// GitHub, Gitea и Forgejo: папки обоих видов.
    Github,
}

fn dirs(layout: Layout) -> &'static [&'static str] {
    match layout {
        Layout::Gitlab => &[".gitlab/issue_templates"],
        Layout::Github => &[".github/ISSUE_TEMPLATE", ".gitea/ISSUE_TEMPLATE", ".gitea/issue_template"],
    }
}

/// Шаблоны задач рабочей копии `root`.
pub fn read(root: &Path, layout: Layout) -> Vec<IssueTemplate> {
    let mut out = Vec::new();
    // На Windows и macOS `.gitea/ISSUE_TEMPLATE` и `.gitea/issue_template` — одна папка: файл читается один раз
    let mut seen = std::collections::HashSet::new();
    for dir in dirs(layout) {
        let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
            continue;
        };
        let mut files: Vec<_> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")))
            .filter(|entry| entry.metadata().is_ok_and(|meta| meta.len() <= MAX_TEMPLATE_BYTES))
            .map(|entry| entry.path())
            .collect();
        files.sort();
        for file in files {
            if out.len() >= MAX_TEMPLATES {
                return out;
            }
            if !seen.insert(std::fs::canonicalize(&file).unwrap_or_else(|_| file.clone())) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let stem = file.file_stem().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            out.push(parse(&stem, &text, layout));
        }
    }
    out
}

/// Шаблон из текста файла `stem.md`.
pub fn parse(stem: &str, text: &str, layout: Layout) -> IssueTemplate {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let fallback = IssueTemplate { name: stem.to_owned(), title: None, body: text.to_owned(), labels: Vec::new() };
    if layout == Layout::Gitlab {
        return fallback;
    }
    let Some((front, body)) = front_matter(text) else {
        return fallback;
    };
    let data = parse_yaml(front).data;
    // Значения как есть: у заголовка-префикса («[BUG] ») пробел в конце значим
    let field = |key: &str| data.get(key).and_then(Yaml::as_str).filter(|value| !value.trim().is_empty()).map(str::to_owned);
    let labels = match data.get("labels") {
        Some(Yaml::Seq(items)) => items.iter().filter_map(Yaml::as_str).map(str::trim).filter(|name| !name.is_empty()).map(str::to_owned).collect(),
        Some(Yaml::String(list)) => list.split(',').map(str::trim).filter(|name| !name.is_empty()).map(str::to_owned).collect(),
        _ => Vec::new(),
    };
    IssueTemplate { name: field("name").unwrap_or_else(|| stem.to_owned()), title: field("title"), body: body.to_owned(), labels }
}

/// Блок YAML между строками `---` в начале и остальной текст.
fn front_matter(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---\r\n").or_else(|| text.strip_prefix("---\n"))?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let body = &rest[offset + line.len()..];
            return Some((&rest[..offset], body.strip_prefix("\r\n").or_else(|| body.strip_prefix('\n')).unwrap_or(body)));
        }
        offset += line.len();
    }
    None
}
