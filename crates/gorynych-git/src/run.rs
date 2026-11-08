//! Запуск `git`: начало `electron/git.cjs`.
//!
//! ## Конспект
//! - Windows передаёт новый PATH только программам, запущенным после установки Git, поэтому `git.exe` ищется сам: PATH процесса → PATH из реестра (`reg query`, HKLM, затем HKCU) →
//!   стандартные папки (`Git\cmd`, `Git\bin`, scoop). Не нашли — `git`, ошибку покажет запуск. Найденное запоминается; после `ENOENT` поиск повторится: Git могли уже установить.
//! - Все вызовы идут с `-c core.quotepath=false -c color.ui=never` и `GIT_OPTIONAL_LOCKS=0`: чтение не перезаписывает `.git/index`, иначе слежение за папкой видело бы собственные запросы.
//! - Нет программы — `GIT_MISSING`, в `details` список папок. Таймаут — `TIMEOUT`. Остальное классифицирует [`from_process_error`].
//!
//! ## Отличия от 1.x
//! - Предела вывода 256 МБ нет: `maxBuffer` в 1.x обрывал такую команду с ошибкой.
//! - Stdin закрыт, если данных для него нет: команда не может зависнуть, ожидая ввода.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use gorynych_core::error::{GorynychError, ProcessFailure, Result, from_process_error};
use gorynych_core::i18n::{self, t};
use tokio::io::AsyncWriteExt;

/// Разделитель полей.
pub const FS: char = '\x1f';
/// Разделитель записей.
pub const RS: char = '\x1e';

/// Дополнительные параметры запуска.
#[derive(Debug, Clone, Default)]
pub struct GitOptions {
    pub env: Vec<(String, String)>,
    pub timeout: Option<Duration>,
    pub input: Option<Vec<u8>>,
}

#[derive(Default)]
struct Located {
    binary: Option<PathBuf>,
    searched: Vec<PathBuf>,
}

static LOCATED: LazyLock<Mutex<Located>> = LazyLock::new(Mutex::default);

fn expand_vars(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                out.push_str(&rest[..start]);
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str(&rest[..=start]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Разбирает список папок как `addPathList`.
fn path_list(list: &str) -> Vec<PathBuf> {
    list.split(';')
        .map(|item| {
            let item = gorynych_core::js::trim(item);
            let item = item.strip_prefix('"').unwrap_or(item);
            expand_vars(item.strip_suffix('"').unwrap_or(item))
        })
        .filter(|item| !item.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
fn registry_path(key: &str) -> String {
    use std::os::windows::process::CommandExt;
    static VALUE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*)").expect("корректный шаблон"));
    let Ok(output) = std::process::Command::new("reg").args(["query", key, "/v", "Path"]).creation_flags(CREATE_NO_WINDOW).output() else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    VALUE.captures(&text).map_or_else(String::new, |caps| gorynych_core::js::trim(&caps[1]).to_owned())
}

#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn locate(state: &mut Located) -> PathBuf {
    let mut dirs: Vec<PathBuf> = path_list(&std::env::var("PATH").unwrap_or_default());
    dirs.extend(path_list(&registry_path(r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment")));
    dirs.extend(path_list(&registry_path(r"HKCU\Environment")));
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).map(PathBuf::from);
    let bases = [var("ProgramW6432"), var("ProgramFiles"), var("ProgramFiles(x86)"), var("LOCALAPPDATA").map(|dir| dir.join("Programs")), Some(PathBuf::from(r"C:\Program Files"))];
    for base in bases.into_iter().flatten() {
        dirs.push(base.join("Git").join("cmd"));
        dirs.push(base.join("Git").join("bin"));
    }
    if let Some(home) = var("USERPROFILE") {
        dirs.push(home.join("scoop").join("apps").join("git").join("current").join("cmd"));
    }
    let mut unique: Vec<PathBuf> = Vec::with_capacity(dirs.len());
    for dir in dirs {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    state.searched = unique;
    for dir in &state.searched {
        let candidate = dir.join("git.exe");
        if std::fs::metadata(&candidate).is_ok_and(|meta| meta.is_file()) {
            state.binary = Some(candidate.clone());
            return candidate;
        }
    }
    PathBuf::from("git")
}

#[cfg(not(windows))]
fn locate(state: &mut Located) -> PathBuf {
    state.binary = Some(PathBuf::from("git"));
    PathBuf::from("git")
}

/// `findGit`.
fn find_git() -> PathBuf {
    let mut state = LOCATED.lock().expect("поиск git");
    if let Some(binary) = &state.binary {
        return binary.clone();
    }
    locate(&mut state)
}

/// `gitInfo`: какая программа используется и где её искали.
pub fn git_info() -> (PathBuf, Vec<PathBuf>) {
    let binary = find_git();
    (binary, LOCATED.lock().expect("поиск git").searched.clone())
}

fn full_args<S: AsRef<OsStr>>(args: &[S]) -> Vec<std::ffi::OsString> {
    let mut out: Vec<std::ffi::OsString> = ["-c", "core.quotepath=false", "-c", "color.ui=never"].iter().map(Into::into).collect();
    out.extend(args.iter().map(|arg| arg.as_ref().to_owned()));
    out
}

fn command_line(binary: &Path, args: &[std::ffi::OsString]) -> String {
    let joined: Vec<String> = args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
    format!("Command failed: {} {}", binary.display(), joined.join(" "))
}

fn not_found() -> GorynychError {
    let mut state = LOCATED.lock().expect("поиск git");
    state.binary = None; // при следующем вызове поищем снова: вдруг Git уже установили
    let list: Vec<String> = state.searched.iter().map(|dir| dir.display().to_string()).collect();
    let shown = if list.is_empty() { "(PATH)".to_owned() } else { list.join("\n") };
    from_process_error(ProcessFailure::NotFound, "", "", i18n::language()).with_details(t("Искали git.exe в:\n{0}", &[&shown]))
}

fn finish(output: Output, binary: &Path, args: &[std::ffi::OsString]) -> Result<Vec<u8>> {
    if output.status.success() {
        return Ok(output.stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = format!("{}\n{stderr}", command_line(binary, args));
    Err(from_process_error(ProcessFailure::Exited { message: &message }, &stdout, &stderr, i18n::language()))
}

/// Запуск с выводом как есть: содержимое файлов может быть двоичным.
pub async fn git_bytes<S: AsRef<OsStr>>(cwd: &Path, args: &[S], options: GitOptions) -> Result<Vec<u8>> {
    let binary = find_git();
    let args = full_args(args);
    let mut command = tokio::process::Command::new(&binary);
    command.args(&args).current_dir(cwd).env("GIT_OPTIONAL_LOCKS", "0").envs(options.env.iter().map(|(key, value)| (key, value))).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    command.stdin(if options.input.is_some() { Stdio::piped() } else { Stdio::null() });
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let failed = |error: std::io::Error| {
        if error.kind() == std::io::ErrorKind::NotFound && !cwd.exists() {
            // Несуществующая папка: как `spawn ... ENOENT` в Node, но это не отсутствие Git
            let message = error.to_string();
            return from_process_error(ProcessFailure::Exited { message: &message }, "", "", i18n::language());
        }
        if error.kind() == std::io::ErrorKind::NotFound {
            return not_found();
        }
        let message = error.to_string();
        from_process_error(ProcessFailure::Exited { message: &message }, "", "", i18n::language())
    };
    let mut child = command.spawn().map_err(failed)?;
    if let Some(input) = options.input
        && let Some(mut stdin) = child.stdin.take()
    {
        tokio::spawn(async move {
            // Процесс мог завершиться, не прочитав: как `stdin.on('error')` в 1.x
            let _ = stdin.write_all(&input).await;
        });
    }
    let work = child.wait_with_output();
    let output = match options.timeout {
        None => work.await.map_err(failed)?,
        Some(limit) => match tokio::time::timeout(limit, work).await {
            Ok(result) => result.map_err(failed)?,
            Err(_) => {
                let message = command_line(&binary, &args);
                return Err(from_process_error(ProcessFailure::TimedOut { message: &message }, "", "", i18n::language()));
            }
        },
    };
    finish(output, &binary, &args)
}

/// Запуск с выводом-текстом.
pub async fn git_with<S: AsRef<OsStr>>(cwd: &Path, args: &[S], options: GitOptions) -> Result<String> {
    Ok(String::from_utf8_lossy(&git_bytes(cwd, args, options).await?).into_owned())
}

/// `git(cwd, args)`.
pub async fn git<S: AsRef<OsStr>>(cwd: &Path, args: &[S]) -> Result<String> {
    git_with(cwd, args, GitOptions::default()).await
}

/// То же без асинхронности: для синхронных трейтов чтения, например `RepoView` линтера.
pub fn git_blocking<S: AsRef<OsStr>>(cwd: &Path, args: &[S]) -> Result<String> {
    let binary = find_git();
    let args = full_args(args);
    let mut command = std::process::Command::new(&binary);
    command.args(&args).current_dir(cwd).env("GIT_OPTIONAL_LOCKS", "0").stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound && cwd.exists() {
            return not_found();
        }
        let message = error.to_string();
        from_process_error(ProcessFailure::Exited { message: &message }, "", "", i18n::language())
    })?;
    Ok(String::from_utf8_lossy(&finish(output, &binary, &args)?).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_list_cleans_items() {
        // SAFETY: другие тесты этого модуля эту переменную не читают.
        unsafe { std::env::set_var("GORYNYCH_TEST_DIR", "C:/x") };
        assert_eq!(path_list(r#" "C:\a" ;;%GORYNYCH_TEST_DIR%\b;%НЕТ%;"#), [PathBuf::from(r"C:\a"), PathBuf::from(r"C:/x\b"), PathBuf::from("%НЕТ%")]);
        assert_eq!(expand_vars("%%a%"), "%%a%");
        assert_eq!(expand_vars("100%"), "100%");
    }

    #[tokio::test]
    async fn missing_folder_is_not_a_missing_git() {
        let error = git(Path::new("нет-такой-папки"), &["status"]).await.unwrap_err();
        assert_ne!(error.code, gorynych_core::ErrorCode::GitMissing);
    }

    #[tokio::test]
    async fn timeout_gives_timeout_code() {
        let dir = std::env::temp_dir();
        // `git hash-object --stdin` без данных ждал бы ввода вечно, если бы stdin был открыт; проверяем сам таймаут через крошечный предел
        let options = GitOptions { timeout: Some(Duration::from_nanos(1)), ..GitOptions::default() };
        let error = git_with(&dir, &["--version"], options).await.unwrap_err();
        assert_eq!(error.code, gorynych_core::ErrorCode::Timeout);
    }

    #[tokio::test]
    async fn input_reaches_stdin() {
        let options = GitOptions { input: Some(b"abc".to_vec()), ..GitOptions::default() };
        let out = git_with(&std::env::temp_dir(), &["hash-object", "--stdin"], options).await.unwrap();
        assert_eq!(out.trim(), "f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f");
    }
}
