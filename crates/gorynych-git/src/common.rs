//! Общие мелочи модулей записи.

use std::ffi::OsStr;
use std::path::Path;

use gorynych_core::error::{GorynychError, Result};
use gorynych_core::js;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::run::git;

/// Поле запроса неверного типа считается отсутствующим: 1.x проверяет `typeof` и отвечает своей ошибкой, а не ошибкой разбора.
pub(crate) fn lenient<'de, D: Deserializer<'de>, T: DeserializeOwned>(deserializer: D) -> std::result::Result<Option<T>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(deserializer)?).ok())
}

/// Обрезанный вывод команды; ошибка считается пустым выводом (`.catch(() => '')`).
pub(crate) async fn quiet<S: AsRef<OsStr>>(cwd: &Path, args: &[S]) -> String {
    git(cwd, args).await.map(|out| js::trim(&out).to_owned()).unwrap_or_default()
}

/// Обрезанный вывод команды.
pub(crate) async fn trimmed<S: AsRef<OsStr>>(cwd: &Path, args: &[S]) -> Result<String> {
    Ok(js::trim(&git(cwd, args).await?).to_owned())
}

/// Команда завершилась успешно.
pub(crate) async fn succeeds<S: AsRef<OsStr>>(cwd: &Path, args: &[S]) -> bool {
    git(cwd, args).await.is_ok()
}

fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

/// `headHash`.
pub(crate) async fn head_hash(cwd: &Path) -> Option<String> {
    non_empty(quiet(cwd, &["rev-parse", "--verify", "--quiet", "HEAD"]).await)
}

/// `branchTip`.
pub(crate) async fn branch_tip(cwd: &Path, name: &str) -> Option<String> {
    non_empty(quiet(cwd, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")]).await)
}

/// Хэш коммита по любой ссылке.
pub(crate) async fn commit_of(cwd: &Path, reference: &str) -> Option<String> {
    non_empty(quiet(cwd, &["rev-parse", "--verify", "--quiet", &format!("{reference}^{{commit}}")]).await)
}

/// Ошибка файловой системы. В 1.x это исключение Node, которое `serializeError` превращает в `UNKNOWN`.
pub(crate) fn fs_error(error: std::io::Error) -> GorynychError {
    GorynychError::unknown(error)
}

/// `fs.rmSync(file, { force: true })`.
pub(crate) fn remove_file_force(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(fs_error(error)),
        _ => Ok(()),
    }
}

/// `fs.mkdirSync(dirname, { recursive: true })` + `fs.writeFileSync`.
pub(crate) fn write_creating_dirs(path: &Path, data: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(fs_error)?;
    }
    std::fs::write(path, data).map_err(fs_error)
}

/// `hash.slice(0, 7)`.
pub(crate) fn short(hash: &str) -> String {
    hash.chars().take(7).collect()
}

/// Значение как в шаблонной строке JS: отсутствующее поле выводится как `undefined`.
pub(crate) fn or_undefined(value: Option<&str>) -> &str {
    value.unwrap_or("undefined")
}

/// Непустая строка: проверка `if (value)` из JS.
pub(crate) fn filled(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// Кавычки для команды, которую git передаёт `sh`.
pub(crate) fn sh_quote(path: &str) -> String {
    format!("'{}'", path.replace('\\', "/").replace('\'', r"'\''"))
}

/// Подходит ли строка под `/^…/m`: строки JS делятся ещё и по `\r`, U+2028, U+2029.
pub(crate) fn any_line(text: &str, test: impl Fn(&str) -> bool) -> bool {
    text.split(['\n', '\r', '\u{2028}', '\u{2029}']).any(test)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_for_sh() {
        assert_eq!(sh_quote(r"C:\Папка с пробелом\it's"), r"'C:/Папка с пробелом/it'\''s'");
    }

    #[test]
    fn lines_split_like_js_multiline() {
        assert!(any_line("a\r!\tb", |line| line.starts_with("!\t")));
        assert!(!any_line("a!\tb", |line| line.starts_with("!\t")));
    }
}
