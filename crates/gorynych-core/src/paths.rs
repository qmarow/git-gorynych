//! Пути относительно репозитория.
//!
//! ## Конспект `safeRelative` (`electron/git.cjs`)
//! Абсолютный или пустой путь: `BAD_ARGS` «Некорректный путь». После `path.resolve` и `path.relative` результат с началом `..` (в том числе
//! файл `..имя`) или абсолютный: `BAD_ARGS` «Путь вне репозитория». Проверка только по тексту пути, без обращения к диску. На Windows `path.relative`
//! не учитывает регистр.
//!
//! **Отличие от 1.x:** путь вида `C:имя` на Windows `path.resolve` считал относительно текущей папки диска, здесь это «Путь вне репозитория».

use std::path::{Component, Path, PathBuf};

use crate::error::{ErrorCode, GorynychError, Result};
use crate::i18n::{self, Language};

fn normalize(path: &Path) -> Vec<Component<'_>> {
    let mut out: Vec<Component<'_>> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.last(), Some(Component::Normal(_))) {
                    out.pop();
                } else if !matches!(out.last(), Some(Component::RootDir | Component::Prefix(_))) {
                    out.push(component);
                }
            }
            other => out.push(other),
        }
    }
    out
}

fn same_component(a: &Component<'_>, b: &Component<'_>) -> bool {
    if cfg!(windows) {
        a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// `safeRelative`: полный путь внутри `root`, иначе `BAD_ARGS`.
pub fn safe_relative(root: &Path, rel: &str, language: Language) -> Result<PathBuf> {
    let relative = Path::new(rel);
    if rel.is_empty() || relative.is_absolute() || relative.has_root() {
        return Err(GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Некорректный путь", &[])));
    }
    let outside = || GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Путь вне репозитория", &[]));
    if matches!(relative.components().next(), Some(Component::Prefix(_))) {
        return Err(outside());
    }
    let full = root.join(relative);
    let base = normalize(root);
    let resolved = normalize(&full);
    let inside = resolved.len() >= base.len() && base.iter().zip(&resolved).all(|(a, b)| same_component(a, b));
    if !inside {
        return Err(outside());
    }
    if let Some(first) = resolved.get(base.len())
        && first.as_os_str().to_string_lossy().starts_with("..")
    {
        return Err(outside());
    }
    Ok(resolved.iter().collect())
}

/// Как `path.relative(root, full)` для пути из [`safe_relative`], разделитель `/`.
pub fn relative_inside(root: &Path, full: &Path) -> String {
    let base = normalize(root).len();
    let parts: Vec<String> = normalize(full).iter().skip(base).map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(rel: &str) -> std::result::Result<PathBuf, ErrorCode> {
        safe_relative(Path::new("repo/root"), rel, Language::Ru).map_err(|error| error.code)
    }

    #[test]
    fn accepts_paths_inside() {
        assert_eq!(check("a/b.yml").unwrap(), Path::new("repo/root/a/b.yml"));
        assert_eq!(check("a/../b.yml").unwrap(), Path::new("repo/root/b.yml"));
        assert_eq!(check("./b.yml").unwrap(), Path::new("repo/root/b.yml"));
        assert_eq!(check(".").unwrap(), Path::new("repo/root"));
        assert_eq!(check("...").unwrap_err(), ErrorCode::BadArgs, "как в 1.x: начало «..»");
    }

    #[test]
    fn rejects_paths_outside() {
        for rel in ["", "/etc/passwd", "../x", "a/../../x", "..имя"] {
            assert_eq!(check(rel).unwrap_err(), ErrorCode::BadArgs, "{rel}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths() {
        assert_eq!(check("C:/x").unwrap_err(), ErrorCode::BadArgs);
        assert_eq!(check("C:x").unwrap_err(), ErrorCode::BadArgs);
        assert_eq!(check(r"\x").unwrap_err(), ErrorCode::BadArgs);
        assert!(safe_relative(Path::new("C:/Repo"), r"..\REPO\x", Language::Ru).is_ok());
    }
}
