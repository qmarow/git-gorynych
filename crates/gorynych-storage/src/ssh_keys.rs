//! SSH-ключи пользователя. Перенос раздела «SSH-ключи» из `electron/credentials.cjs`.
//!
//! # Конспект исходника
//! - `listSshKeys`: приватные ключи — файлы до 64 КБ с парным `.pub` или с именем `id_*`, кроме `known_hosts`, `config` и
//!   других служебных, `.pub` и скрытых. Тип и комментарий — из `.pub`. Сортировка: `id_*` раньше, внутри — свежие сверху.
//!   Каталог не читается → пустой список.
//! - `suggestKeyName`: `id_ed25519`/`id_rsa`; занято (ключ или `.pub`) → с именем сервера.
//! - `generateSshKey`: `ed25519` или `rsa` 4096. Имя без папок, точки в начале и `.pub` на конце, прочие символы → `_`.
//!   Занято → `_2`, `_3`, … Комментарий: заданный или `пользователь@компьютер`, без переводов строк, до 200 символов.
//!   Кандидаты `ssh-keygen`: PATH, затем на Windows комплект Git и системный OpenSSH; следующий пробуется только
//!   при «программа не найдена». Таймаут 60 с. `NO_SSH_KEYGEN` с подсказкой или `KEYGEN_FAILED`.
//! - `publicKeyOf`: содержимое `<ключ>.pub` или `null`.
//!
//! # Отличия от 1.x
//! - Каталог передаётся явно вместо `GK_TEST_SSH_DIR`.
//! - Пароль ключа по-прежнему идёт в аргументе `-N`: у `ssh-keygen` нет другого неинтерактивного способа. Но в `details`
//!   при ошибке теперь нет командной строки: в 1.x сообщение Node могло показать пароль.
//! - При равном времени порядок определяется именем, а не порядком чтения каталога.

use std::ffi::OsStr;
use std::fmt;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use serde::{Deserialize, Serialize};

const NOT_KEYS: [&str; 5] = ["known_hosts", "known_hosts.old", "config", "authorized_keys", "environment"];
const MAX_KEY_SIZE: u64 = 64 * 1024;
const KEYGEN_TIMEOUT: Duration = Duration::from_secs(60);

/// Приватный ключ в каталоге SSH.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub comment: Option<String>,
    pub has_pub: bool,
    pub mtime: f64,
}

/// Содержимое каталога SSH.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct SshKeyList {
    pub dir: String,
    pub keys: Vec<SshKeyInfo>,
}

/// Параметры нового ключа. Пароль не попадает в `Debug`.
#[derive(Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GenerateKeyOptions {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub comment: Option<String>,
    pub passphrase: Option<String>,
    pub name: Option<String>,
    pub host: Option<String>,
}

impl fmt::Debug for GenerateKeyOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GenerateKeyOptions")
            .field("kind", &self.kind)
            .field("name", &self.name)
            .field("host", &self.host)
            .finish_non_exhaustive()
    }
}

/// Созданный ключ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    pub path: String,
    pub name: String,
    pub public_key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub fingerprint: Option<String>,
}

/// Каталог `~/.ssh`.
pub fn default_ssh_dir() -> PathBuf {
    std::env::home_dir().unwrap_or_default().join(".ssh")
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Тип и комментарий из первой строки `.pub`.
fn read_pub_info(path: &Path) -> Option<(Option<String>, Option<String>)> {
    let bytes = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut parts = js::trim(&text).split(js::is_whitespace).filter(|part| !part.is_empty());
    let kind = parts.next().unwrap_or_default();
    let kind = kind.strip_prefix("ssh-").unwrap_or(kind).to_owned();
    let _body = parts.next();
    let comment = parts.collect::<Vec<_>>().join(" ");
    Some((Some(kind), (!comment.is_empty()).then_some(comment)))
}

/// Приватные ключи в каталоге.
pub fn list_ssh_keys(dir: &Path) -> SshKeyList {
    let mut keys = Vec::new();
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    names.sort();
    for name in &names {
        if name.ends_with(".pub") || NOT_KEYS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let file = dir.join(name);
        let Ok(stat) = fs::metadata(&file) else {
            continue;
        };
        if !stat.is_file() || stat.len() > MAX_KEY_SIZE {
            continue;
        }
        let pub_name = format!("{name}.pub");
        let has_pub = names.contains(&pub_name);
        if !has_pub && !name.starts_with("id_") {
            continue;
        }
        let (kind, comment) = if has_pub {
            read_pub_info(&dir.join(&pub_name)).unwrap_or((None, None))
        } else {
            (None, None)
        };
        let mtime = stat
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0);
        keys.push(SshKeyInfo { path: path_text(&file), name: name.clone(), kind, comment, has_pub, mtime });
    }
    keys.sort_by(|a, b| {
        let (a_id, b_id) = (a.name.starts_with("id_"), b.name.starts_with("id_"));
        b_id.cmp(&a_id).then_with(|| b.mtime.total_cmp(&a.mtime))
    });
    SshKeyList { dir: path_text(dir), keys }
}

fn base_key_name(kind: &str) -> &'static str {
    if kind == "rsa" { "id_rsa" } else { "id_ed25519" }
}

/// `.replace(/[^a-z0-9.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '')`.
fn host_tag(host: &str) -> String {
    let mut tag = String::new();
    let mut in_gap = false;
    for c in host.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-') {
            tag.push(c);
            in_gap = false;
        } else if !in_gap {
            tag.push('_');
            in_gap = true;
        }
    }
    tag.trim_matches(['.', '_', '-']).to_owned()
}

/// Имя файла по умолчанию: стандартное, а если занято — с именем сервера.
pub fn suggest_key_name(kind: &str, host: Option<&str>, dir: &Path) -> String {
    let base = base_key_name(kind);
    let taken = |name: &str| dir.join(name).exists();
    if !taken(base) && !taken(&format!("{base}.pub")) {
        return base.to_owned();
    }
    let tag = host_tag(host.unwrap_or("gorynych"));
    format!("{base}_{}", if tag.is_empty() { "gorynych" } else { &tag })
}

/// Где искать `ssh-keygen`: PATH, а на Windows ещё комплект Git for Windows.
fn keygen_candidates(git_binary: Option<&Path>) -> Vec<PathBuf> {
    let mut list = vec![PathBuf::from("ssh-keygen")];
    if cfg!(windows) {
        // …\Git\cmd\git.exe → …\Git
        if let Some(root) = git_binary.and_then(Path::parent).and_then(Path::parent) {
            list.push(root.join("usr").join("bin").join("ssh-keygen.exe"));
        }
        list.push(PathBuf::from(r"C:\Program Files\Git\usr\bin\ssh-keygen.exe"));
        list.push(PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh-keygen.exe"));
    }
    list
}

enum RunError {
    NotFound,
    Failed(String),
}

impl From<io::Error> for RunError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::NotFound { Self::NotFound } else { Self::Failed(error.to_string()) }
    }
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn read_all(stream: Option<impl Read>) -> String {
    let mut bytes = Vec::new();
    if let Some(mut stream) = stream {
        let _ = stream.read_to_end(&mut bytes);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Запускает программу с таймаутом. Вывод `ssh-keygen` мал и в буфер канала умещается.
fn run(program: &Path, args: &[&OsStr]) -> std::result::Result<String, RunError> {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command.spawn()?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > KEYGEN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunError::Failed("ssh-keygen: timeout".to_owned()));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let stdout = read_all(child.stdout.take());
    let stderr = read_all(child.stderr.take());
    if status.success() {
        return Ok(stdout);
    }
    // Командная строка не показывается: в ней может быть пароль ключа
    let details = js::trim(&stderr);
    Err(RunError::Failed(if details.is_empty() { format!("ssh-keygen: {status}") } else { details.to_owned() }))
}

/// `.replace(/[^\w.-]/g, '_')`: как в JS без флага `u`, символ вне BMP даёт два подчёркивания.
fn sanitize_key_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
            out.push(c);
        } else {
            out.extend(std::iter::repeat_n('_', c.len_utf16()));
        }
    }
    out
}

/// `.slice(0, 200)` по единицам UTF-16, но без разрыва символа вне BMP.
fn truncate_utf16(text: &str, limit: usize) -> String {
    let mut used = 0;
    text.chars()
        .take_while(|c| {
            used += c.len_utf16();
            used <= limit
        })
        .collect()
}

fn default_comment() -> String {
    let var = |names: [&str; 2]| names.iter().find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()));
    let user = var(["USERNAME", "USER"]).unwrap_or_else(|| "user".to_owned());
    let host = var(["COMPUTERNAME", "HOSTNAME"]).unwrap_or_else(|| "localhost".to_owned());
    format!("{user}@{host}")
}

fn pair_exists(file: &Path) -> bool {
    file.exists() || PathBuf::from(format!("{}.pub", file.display())).exists()
}

/// Создаёт новый ключ в `dir`. Существующие ключи не перезаписываются.
pub fn generate_ssh_key(options: &GenerateKeyOptions, dir: &Path, git_binary: Option<&Path>) -> Result<GeneratedKey> {
    generate_with(options, dir, &keygen_candidates(git_binary))
}

fn generate_with(options: &GenerateKeyOptions, dir: &Path, candidates: &[PathBuf]) -> Result<GeneratedKey> {
    let kind = options.kind.as_deref().unwrap_or("ed25519");
    let type_args: &[&str] = match kind {
        "ed25519" => &["-t", "ed25519"],
        "rsa" => &["-t", "rsa", "-b", "4096"],
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестный тип ключа", &[]))),
    };
    create_private_dir(dir).map_err(|error| keygen_error(false, &error.to_string()))?;

    let wanted = js::trim(options.name.as_deref().unwrap_or_default());
    if !wanted.is_empty() && (wanted.contains(['\\', '/']) || wanted.starts_with('.') || wanted.ends_with(".pub")) {
        return Err(GorynychError::new(
            ErrorCode::BadArgs,
            t("Имя файла ключа — без папок, точки в начале и .pub на конце", &[]),
        ));
    }
    let sanitized = sanitize_key_name(wanted);
    let base = if sanitized.is_empty() { suggest_key_name(kind, options.host.as_deref(), dir) } else { sanitized };
    let mut file = dir.join(&base);
    let mut n = 2;
    while pair_exists(&file) {
        file = dir.join(format!("{base}_{n}"));
        n += 1;
    }

    let comment = options.comment.as_deref().filter(|text| !text.is_empty()).map_or_else(default_comment, str::to_owned);
    let label = truncate_utf16(&comment.replace(['\r', '\n'], " "), 200);
    let passphrase = options.passphrase.as_deref().unwrap_or_default();
    let pub_file = PathBuf::from(format!("{}.pub", file.display()));

    let mut args: Vec<&OsStr> = type_args.iter().map(OsStr::new).collect();
    args.extend([OsStr::new("-f"), file.as_os_str(), OsStr::new("-N"), OsStr::new(passphrase), OsStr::new("-C"), OsStr::new(&label), OsStr::new("-q")]);

    let mut last_error = RunError::NotFound;
    for program in candidates {
        let attempt = run(program, &args).and_then(|_| {
            restrict_key_file(&file);
            Ok(fs::read_to_string(&pub_file)?)
        });
        match attempt {
            Ok(public_key) => {
                let fingerprint = run(program, &[OsStr::new("-l"), OsStr::new("-f"), pub_file.as_os_str()])
                    .ok()
                    .and_then(|output| js::trim(&output).split(js::is_whitespace).filter(|p| !p.is_empty()).nth(1).map(str::to_owned));
                return Ok(GeneratedKey {
                    path: path_text(&file),
                    name: file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
                    public_key: js::trim(&public_key).to_owned(),
                    kind: kind.to_owned(),
                    fingerprint,
                });
            }
            Err(RunError::NotFound) => last_error = RunError::NotFound,
            Err(error) => {
                last_error = error;
                break;
            }
        }
    }
    Err(match last_error {
        RunError::NotFound => keygen_error(true, ""),
        RunError::Failed(details) => keygen_error(false, &details),
    })
}

fn keygen_error(not_found: bool, details: &str) -> GorynychError {
    let error = GorynychError::new(
        if not_found { ErrorCode::NoSshKeygen } else { ErrorCode::KeygenFailed },
        t("Не удалось создать SSH-ключ", &[]),
    )
    .with_details(details);
    if not_found {
        error.with_hint(t("Не найдена программа ssh-keygen. Установите OpenSSH или Git for Windows.", &[]))
    } else {
        error
    }
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

/// На Windows права выставляет сам `ssh-keygen` через ACL.
fn restrict_key_file(file: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(file, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = file;
}

/// Публичная часть ключа.
pub fn public_key_of(key_path: &str) -> Option<String> {
    let text = fs::read_to_string(format!("{key_path}.pub")).ok()?;
    Some(js::trim(&text).to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_keygen_gives_hint_and_tries_all_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let candidates = [PathBuf::from("нет-такой-программы-1"), PathBuf::from("нет-такой-программы-2")];
        let error = generate_with(&GenerateKeyOptions::default(), dir.path(), &candidates).unwrap_err();
        assert_eq!(error.code, ErrorCode::NoSshKeygen);
        assert!(error.hint.is_some());
    }

    #[test]
    fn bad_arguments_are_rejected_before_running_anything() {
        let dir = tempfile::tempdir().unwrap();
        let bad_type = GenerateKeyOptions { kind: Some("dsa".into()), ..Default::default() };
        assert_eq!(generate_with(&bad_type, dir.path(), &[]).unwrap_err().code, ErrorCode::BadArgs);
        for name in ["a/b", r"a\b", ".hidden", "key.pub"] {
            let options = GenerateKeyOptions { name: Some(name.into()), ..Default::default() };
            assert_eq!(generate_with(&options, dir.path(), &[]).unwrap_err().code, ErrorCode::BadArgs, "{name}");
        }
    }

    #[test]
    fn key_names_are_sanitized_like_1x() {
        assert_eq!(sanitize_key_name("мой key_1.a-b"), "____key_1.a-b");
        assert_eq!(sanitize_key_name("🔑"), "__");
        assert_eq!(truncate_utf16(&"ж".repeat(300), 200).chars().count(), 200);
    }

    #[test]
    fn debug_hides_passphrase() {
        let options = GenerateKeyOptions { passphrase: Some("СЕКРЕТ".into()), ..Default::default() };
        assert!(!format!("{options:?}").contains("СЕКРЕТ"));
    }

    /// Настоящий `ssh-keygen`: создаёт ключ во временной папке. Если программы нет, тест ничего не проверяет.
    #[test]
    fn real_keygen_creates_key_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let options = GenerateKeyOptions {
            passphrase: Some("пароль ключа".into()),
            comment: Some("строка1\nстрока2".into()),
            ..Default::default()
        };
        let first = match generate_ssh_key(&options, dir.path(), None) {
            Ok(key) => key,
            Err(error) if error.code == ErrorCode::NoSshKeygen => {
                eprintln!("ssh-keygen не найден: пропуск");
                return;
            }
            Err(error) => panic!("{error:?}: {}", error.details),
        };
        assert_eq!(first.name, "id_ed25519");
        assert_eq!(first.kind, "ed25519");
        assert!(first.public_key.starts_with("ssh-ed25519 "), "{}", first.public_key);
        assert!(first.public_key.ends_with("строка1 строка2"), "{}", first.public_key);
        assert!(first.fingerprint.as_deref().is_some_and(|f| f.starts_with("SHA256:")), "{:?}", first.fingerprint);
        assert_eq!(public_key_of(&first.path).as_deref(), Some(first.public_key.as_str()));

        let second = generate_ssh_key(&GenerateKeyOptions { host: Some("Git.Company.ru".into()), ..options }, dir.path(), None).unwrap();
        assert_eq!(second.name, "id_ed25519_git.company.ru");

        let listed = list_ssh_keys(dir.path());
        assert_eq!(listed.keys.len(), 2);
        assert_eq!(listed.keys[0].kind.as_deref(), Some("ed25519"));
    }
}
