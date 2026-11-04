//! Передача секретов в git без переменных окружения. Заменяет `envFor` и `askpassScript` из `electron/credentials.cjs`.
//!
//! # Конспект исходника
//! - На каждый https-сервер — два значения `credential.<сервер>.helper` через `GIT_CONFIG_*`: пустое сбрасывает чужие
//!   helpers (Git Credential Manager), затем свой. Нумерация продолжает `GIT_CONFIG_COUNT` из окружения процесса.
//! - Helper отвечает только на `get`: `username=…\npassword=…\n`. Какой хост, решает сам git по адресу в ключе настройки.
//! - SSH: `GIT_SSH_COMMAND`; при пароле ключа ещё `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, `DISPLAY` (свой или `:0`).
//! - Сами секреты лежали в `GITIDEA_P_i` и `GITIDEA_SSH_PASS`: их видели все дочерние процессы, включая хуки.
//!
//! # Как здесь
//! Приложение держит [`AuthBroker`] — локальный канал со случайным именем. На операцию git создаётся [`AuthSession`] со
//! случайным токеном; `Drop` его отзывает. В окружении git только адрес канала и токен. Git запускает исполняемый файл
//! приложения в режиме помощника ([`run_helper`]), тот по токену получает секрет и печатает его.
//!
//! Что это даёт: секретов нет в окружении, а значит, в дампах окружения и в логах сборки хуков. Токен живёт одну операцию.
//! Чего это **не** даёт: хук, работающий во время той же операции и под тем же пользователем, может обратиться к каналу
//! с тем же токеном. От кода с правами пользователя локальными средствами не защититься.
//!
//! # Отличие от плана: `--internal-askpass`
//! `ssh` запускает `SSH_ASKPASS` как программу с единственным аргументом-подсказкой, добавить флаг нельзя. Поэтому режим
//! определяется переменной [`ENV_ASKPASS`]; флаг `--internal-askpass` тоже работает. Для git-helper флаг есть:
//! `--internal-cred-helper <номер> <действие>`, значение `credential.*.helper` — команда оболочки.
//!
//! # Канал
//! Имя случайное; Named Pipe на Windows, abstract socket на Linux, файл во временной папке на macOS (проверено только
//! на Windows). Доступ решает токен: 256 случайных бит. Ответ на неверный токен такой же, как на неизвестный запрос.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use gorynych_core::error::{GorynychError, Result};
use interprocess::local_socket::prelude::*;
use interprocess::local_socket::{GenericFilePath, GenericNamespaced, ListenerOptions, Name, Stream};
use serde::{Deserialize, Serialize};

use crate::credentials::{GitAuth, sh_quote, ssh_command};
use crate::secrets::random_hex;

/// Адрес канала брокера.
pub const ENV_ENDPOINT: &str = "GORYNYCH_AUTH_ENDPOINT";
/// Токен сессии.
pub const ENV_TOKEN: &str = "GORYNYCH_AUTH_TOKEN";
/// Признак режима `SSH_ASKPASS`: `ssh` не может передать флаг.
pub const ENV_ASKPASS: &str = "GORYNYCH_ASKPASS";

/// Флаг режима git credential helper.
pub const FLAG_CRED_HELPER: &str = "--internal-cred-helper";
/// Флаг режима askpass.
pub const FLAG_ASKPASS: &str = "--internal-askpass";

/// Запрос больше этого размера не бывает: токен и номер.
const MAX_REQUEST: u64 = 4 * 1024;
/// Ответ ограничен размером записи Keyring с запасом на JSON.
const MAX_RESPONSE: u64 = 256 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AuthRequest {
    Https(usize),
    Passphrase,
}

#[derive(Serialize, Deserialize)]
struct RequestLine {
    token: String,
    request: AuthRequest,
}

/// Без `Debug`: содержит секреты.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AuthResponse {
    Https { username: String, password: String },
    Passphrase { passphrase: String },
    Denied,
}

type Sessions = Mutex<HashMap<String, GitAuth>>;

fn lock(sessions: &Sessions) -> MutexGuard<'_, HashMap<String, GitAuth>> {
    sessions.lock().unwrap_or_else(PoisonError::into_inner)
}

fn answer(sessions: &Sessions, line: &RequestLine) -> AuthResponse {
    let guard = lock(sessions);
    let Some(auth) = guard.get(&line.token) else {
        return AuthResponse::Denied;
    };
    match line.request {
        AuthRequest::Https(index) => auth.https.get(index).map_or(AuthResponse::Denied, |login| AuthResponse::Https {
            username: login.username.clone(),
            password: login.secret.clone(),
        }),
        AuthRequest::Passphrase => auth
            .ssh
            .as_ref()
            .and_then(|ssh| ssh.passphrase.clone())
            .map_or(AuthResponse::Denied, |passphrase| AuthResponse::Passphrase { passphrase }),
    }
}

fn serve_connection(stream: Stream, sessions: &Sessions) -> io::Result<()> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    (&mut reader).take(MAX_REQUEST).read_line(&mut line)?;
    let response = match serde_json::from_str::<RequestLine>(&line) {
        Ok(request) => answer(sessions, &request),
        Err(_) => AuthResponse::Denied,
    };
    let stream = reader.get_mut();
    serde_json::to_writer(&mut *stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn endpoint_name(endpoint: &str) -> io::Result<Name<'_>> {
    if GenericNamespaced::is_supported() {
        endpoint.to_ns_name::<GenericNamespaced>()
    } else {
        endpoint.to_fs_name::<GenericFilePath>()
    }
}

fn new_endpoint() -> Result<String> {
    let name = format!("gorynych-auth-{}", random_hex()?);
    if GenericNamespaced::is_supported() {
        return Ok(name);
    }
    Ok(std::env::temp_dir().join(format!("{name}.sock")).to_string_lossy().into_owned())
}

fn broker_error(error: impl std::fmt::Display) -> GorynychError {
    crate::db::storage_error(error)
}

/// Брокер секретов: один на приложение.
pub struct AuthBroker {
    endpoint: String,
    helper: PathBuf,
    sessions: Arc<Sessions>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl AuthBroker {
    /// Запускает брокер. `helper` — исполняемый файл, вызывающий [`run_helper`] в начале `main`.
    pub fn start(helper: impl Into<PathBuf>) -> Result<Self> {
        let endpoint = new_endpoint()?;
        let listener = ListenerOptions::new()
            .name(endpoint_name(&endpoint).map_err(broker_error)?)
            .create_sync()
            .map_err(broker_error)?;
        let sessions: Arc<Sessions> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let thread = std::thread::Builder::new().name("gorynych-auth".to_owned()).spawn({
            let (sessions, stop) = (Arc::clone(&sessions), Arc::clone(&stop));
            move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else {
                        continue;
                    };
                    let sessions = Arc::clone(&sessions);
                    // Клиент может не дописать запрос: он не должен задерживать остальных
                    std::thread::spawn(move || {
                        let _ = serve_connection(stream, &sessions);
                    });
                }
            }
        });
        Ok(Self {
            endpoint,
            helper: helper.into(),
            sessions,
            stop,
            thread: Some(thread.map_err(broker_error)?),
        })
    }

    /// Сессия для одной операции git. Пока она жива, помощник может получить её секреты.
    pub fn session(&self, auth: GitAuth) -> Result<AuthSession> {
        let token = random_hex()?;
        let env = session_env(&self.helper, &self.endpoint, &token, &auth, config_base());
        let registered = !auth.https.is_empty() || auth.ssh.as_ref().is_some_and(|ssh| ssh.passphrase.is_some());
        if registered {
            lock(&self.sessions).insert(token.clone(), auth);
        }
        Ok(AuthSession { sessions: Arc::clone(&self.sessions), token, env })
    }
}

impl Drop for AuthBroker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Поток ждёт подключения: будим его своим. Соединение держим до конца потока: если клиент уйдёт раньше,
        // чем сервер примет его, `interprocess` сочтёт его мёртвым (ERROR_NO_DATA) и продолжит ждать следующего.
        let wake = endpoint_name(&self.endpoint).and_then(Stream::connect);
        if wake.is_ok()
            && let Some(thread) = self.thread.take()
        {
            let _ = thread.join();
        }
    }
}

/// Сессия операции git. `Drop` отзывает токен.
pub struct AuthSession {
    sessions: Arc<Sessions>,
    token: String,
    env: Vec<(String, String)>,
}

impl AuthSession {
    /// Переменные окружения для процесса git. Секретов в них нет.
    pub fn env(&self) -> &[(String, String)] {
        &self.env
    }
}

impl Drop for AuthSession {
    fn drop(&mut self) {
        lock(&self.sessions).remove(&self.token);
    }
}

/// `Number(process.env.GIT_CONFIG_COUNT) || 0`.
fn config_base() -> usize {
    std::env::var("GIT_CONFIG_COUNT").ok().and_then(|text| text.trim().parse().ok()).unwrap_or(0)
}

fn session_env(helper: &Path, endpoint: &str, token: &str, auth: &GitAuth, base: usize) -> Vec<(String, String)> {
    let posix = helper.to_string_lossy().replace('\\', "/");
    let quoted = sh_quote(&posix);
    let mut env = Vec::new();

    for (index, login) in auth.https.iter().enumerate() {
        let key = format!("credential.{}.helper", login.server);
        let first = base + index * 2;
        // Пусто — сбросить helpers (Git Credential Manager и т.п.) для этого хоста; затем наш
        env.push((format!("GIT_CONFIG_KEY_{first}"), key.clone()));
        env.push((format!("GIT_CONFIG_VALUE_{first}"), String::new()));
        env.push((format!("GIT_CONFIG_KEY_{}", first + 1), key));
        env.push((format!("GIT_CONFIG_VALUE_{}", first + 1), format!("!{quoted} {FLAG_CRED_HELPER} {index}")));
    }
    if !auth.https.is_empty() {
        env.push(("GIT_CONFIG_COUNT".to_owned(), (base + auth.https.len() * 2).to_string()));
    }

    let mut with_passphrase = false;
    if let Some(ssh) = &auth.ssh {
        with_passphrase = ssh.passphrase.is_some();
        env.push(("GIT_SSH_COMMAND".to_owned(), ssh_command(&ssh.key_path, with_passphrase)));
        if with_passphrase {
            env.push(("SSH_ASKPASS".to_owned(), posix.clone()));
            env.push(("SSH_ASKPASS_REQUIRE".to_owned(), "force".to_owned()));
            env.push(("DISPLAY".to_owned(), std::env::var("DISPLAY").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| ":0".to_owned())));
            env.push((ENV_ASKPASS.to_owned(), "1".to_owned()));
        }
    }
    if !auth.https.is_empty() || with_passphrase {
        env.push((ENV_ENDPOINT.to_owned(), endpoint.to_owned()));
        env.push((ENV_TOKEN.to_owned(), token.to_owned()));
    }
    env
}

fn ask(endpoint: &str, token: &str, request: AuthRequest) -> io::Result<AuthResponse> {
    let mut stream = Stream::connect(endpoint_name(endpoint)?)?;
    let line = RequestLine { token: token.to_owned(), request };
    serde_json::to_writer(&mut stream, &line)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    let mut reader = BufReader::new(stream).take(MAX_RESPONSE);
    let mut answer = String::new();
    reader.read_line(&mut answer)?;
    Ok(serde_json::from_str(&answer)?)
}

fn ask_from_env(request: AuthRequest) -> io::Result<AuthResponse> {
    let var = |name: &str| std::env::var(name).map_err(|error| io::Error::new(io::ErrorKind::NotFound, error));
    ask(&var(ENV_ENDPOINT)?, &var(ENV_TOKEN)?, request)
}

/// Режим credential helper. Нет ответа брокера — ничего не печатаем: git сообщит об ошибке входа сам.
fn run_cred_helper(args: &[String], out: &mut impl Write) -> i32 {
    // git дописывает действие последним аргументом: get, store или erase
    let [index, action] = args else {
        return 1;
    };
    if action != "get" {
        return 0;
    }
    // Запрос git не нужен (сервер выбран настройкой), но канал надо дочитать: git в него пишет
    let _ = io::copy(&mut io::stdin().lock(), &mut io::sink());
    let Ok(index) = index.parse() else {
        return 1;
    };
    if let Ok(AuthResponse::Https { username, password }) = ask_from_env(AuthRequest::Https(index)) {
        return i32::from(write!(out, "username={username}\npassword={password}\n").is_err());
    }
    0
}

/// Режим `SSH_ASKPASS`: печатает пароль ключа. Подсказку `ssh` не разбираем, как и в 1.x.
fn run_askpass(out: &mut impl Write) -> i32 {
    match ask_from_env(AuthRequest::Passphrase) {
        Ok(AuthResponse::Passphrase { passphrase }) => i32::from(writeln!(out, "{passphrase}").is_err()),
        _ => 1,
    }
}

fn dispatch(args: &[OsString], askpass_env: bool, out: &mut impl Write) -> Option<i32> {
    let text: Vec<String> = args.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    match text.first().map(String::as_str) {
        Some(FLAG_CRED_HELPER) => Some(run_cred_helper(&text[1..], out)),
        Some(FLAG_ASKPASS) => Some(run_askpass(out)),
        _ if askpass_env => Some(run_askpass(out)),
        _ => None,
    }
}

/// Вызывается первой строкой `main`. `Some(код)` — процесс запущен как помощник и должен завершиться с этим кодом.
pub fn run_helper() -> Option<i32> {
    let args: Vec<OsString> = std::env::args_os().collect();
    let askpass_env = std::env::var_os(ENV_ASKPASS).is_some_and(|value| value == "1");
    let mut out = io::stdout().lock();
    let code = dispatch(&args, askpass_env, &mut out)?;
    let _ = out.flush();
    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::{HttpsAuth, SshAuth};

    fn https(server: &str, username: &str, secret: &str) -> HttpsAuth {
        HttpsAuth { server: server.into(), username: username.into(), secret: secret.into() }
    }

    fn broker() -> AuthBroker {
        AuthBroker::start(r"C:\Program Files\Горыныч\it's.exe").unwrap()
    }

    fn value<'a>(env: &'a [(String, String)], name: &str) -> Option<&'a str> {
        env.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }

    fn session_token(session: &AuthSession) -> String {
        value(session.env(), ENV_TOKEN).expect("есть токен").to_owned()
    }

    fn ask_https(broker: &AuthBroker, token: &str, index: usize) -> Option<(String, String)> {
        match ask(&broker.endpoint, token, AuthRequest::Https(index)).unwrap() {
            AuthResponse::Https { username, password } => Some((username, password)),
            _ => None,
        }
    }

    fn ask_passphrase(broker: &AuthBroker, token: &str) -> Option<String> {
        match ask(&broker.endpoint, token, AuthRequest::Passphrase).unwrap() {
            AuthResponse::Passphrase { passphrase } => Some(passphrase),
            _ => None,
        }
    }

    #[test]
    fn env_matches_1x_layout_without_secrets() {
        let auth = GitAuth {
            https: vec![https("https://a.example", "u0", "СЕКРЕТ0"), https("http://b.example:8080", "u1", "СЕКРЕТ1")],
            ssh: Some(SshAuth { key_path: r"C:\k\id".into(), passphrase: Some("СЕКРЕТ2".into()) }),
        };
        let env = session_env(Path::new(r"C:\Program Files\Горыныч\it's.exe"), "pipe", "TOKEN", &auth, 3);

        assert_eq!(value(&env, "GIT_CONFIG_COUNT"), Some("7"), "продолжает номера из окружения");
        assert_eq!(value(&env, "GIT_CONFIG_KEY_3"), Some("credential.https://a.example.helper"));
        assert_eq!(value(&env, "GIT_CONFIG_VALUE_3"), Some(""), "сброс чужих helpers");
        assert_eq!(value(&env, "GIT_CONFIG_KEY_4"), Some("credential.https://a.example.helper"));
        assert_eq!(
            value(&env, "GIT_CONFIG_VALUE_4"),
            Some(r"!'C:/Program Files/Горыныч/it'\''s.exe' --internal-cred-helper 0")
        );
        assert_eq!(value(&env, "GIT_CONFIG_KEY_5"), Some("credential.http://b.example:8080.helper"));
        assert_eq!(
            value(&env, "GIT_CONFIG_VALUE_6"),
            Some(r"!'C:/Program Files/Горыныч/it'\''s.exe' --internal-cred-helper 1")
        );
        assert_eq!(value(&env, "SSH_ASKPASS"), Some("C:/Program Files/Горыныч/it's.exe"));
        assert_eq!(value(&env, "SSH_ASKPASS_REQUIRE"), Some("force"));
        assert_eq!(value(&env, ENV_ASKPASS), Some("1"));
        assert_eq!(value(&env, "GIT_SSH_COMMAND"), Some(ssh_command(r"C:\k\id", true).as_str()));
        assert!(value(&env, "DISPLAY").is_some_and(|display| !display.is_empty()));
        assert_eq!(value(&env, ENV_ENDPOINT), Some("pipe"));
        assert_eq!(value(&env, ENV_TOKEN), Some("TOKEN"));

        let printed = format!("{env:?}");
        assert!(!printed.contains("СЕКРЕТ"), "{printed}");
        assert!(!printed.contains("u0"), "логин тоже не в окружении: {printed}");
    }

    #[test]
    fn nothing_to_pass_gives_empty_env() {
        assert!(session_env(Path::new("x"), "p", "t", &GitAuth::default(), 0).is_empty());
    }

    #[test]
    fn ssh_key_without_passphrase_needs_no_channel() {
        let auth = GitAuth { https: vec![], ssh: Some(SshAuth { key_path: "/k".into(), passphrase: None }) };
        let env = session_env(Path::new("x"), "p", "t", &auth, 0);
        assert_eq!(env.len(), 1);
        assert_eq!(value(&env, "GIT_SSH_COMMAND"), Some(ssh_command("/k", false).as_str()));
    }

    #[test]
    fn session_serves_its_secrets_until_dropped() {
        let broker = broker();
        let session = broker
            .session(GitAuth {
                https: vec![https("https://a", "u0", "p0"), https("https://b", "u1", "p1")],
                ssh: Some(SshAuth { key_path: "/k".into(), passphrase: Some("pp".into()) }),
            })
            .unwrap();
        let token = session_token(&session);
        assert_eq!(ask_https(&broker, &token, 0), Some(("u0".into(), "p0".into())));
        assert_eq!(ask_https(&broker, &token, 1), Some(("u1".into(), "p1".into())));
        assert_eq!(ask_https(&broker, &token, 2), None);
        assert_eq!(ask_passphrase(&broker, &token).as_deref(), Some("pp"));

        drop(session);
        assert_eq!(ask_https(&broker, &token, 0), None, "после операции токен не действует");
        assert_eq!(ask_passphrase(&broker, &token), None);
    }

    #[test]
    fn wrong_token_and_other_sessions_get_nothing() {
        let broker = broker();
        let first = broker.session(GitAuth { https: vec![https("https://a", "u0", "p0")], ssh: None }).unwrap();
        let second = broker.session(GitAuth { https: vec![https("https://b", "u1", "p1")], ssh: None }).unwrap();
        assert_ne!(session_token(&first), session_token(&second));
        assert_eq!(ask_https(&broker, "", 0), None);
        assert_eq!(ask_https(&broker, "неверный", 0), None);
        assert_eq!(ask_https(&broker, &session_token(&second), 0), Some(("u1".into(), "p1".into())));
        drop(first);
        assert_eq!(ask_https(&broker, &session_token(&second), 0), Some(("u1".into(), "p1".into())), "другая сессия жива");
    }

    #[test]
    fn broken_request_is_denied_and_broker_survives() {
        let broker = broker();
        let session = broker.session(GitAuth { https: vec![https("https://a", "u", "p")], ssh: None }).unwrap();
        for garbage in ["не json\n".to_owned(), "{}\n".to_owned(), format!("{}\n", "x".repeat(MAX_REQUEST as usize * 2))] {
            let mut stream = Stream::connect(endpoint_name(&broker.endpoint).unwrap()).unwrap();
            stream.write_all(garbage.as_bytes()).unwrap();
            let mut answer = String::new();
            BufReader::new(stream).read_line(&mut answer).unwrap();
            assert!(answer.contains("denied"), "{answer}");
        }
        assert!(ask_https(&broker, &session_token(&session), 0).is_some());
    }

    #[test]
    fn silent_client_does_not_block_others() {
        let broker = broker();
        let session = broker.session(GitAuth { https: vec![https("https://a", "u", "p")], ssh: None }).unwrap();
        let _silent = Stream::connect(endpoint_name(&broker.endpoint).unwrap()).unwrap();
        assert!(ask_https(&broker, &session_token(&session), 0).is_some());
    }

    /// Регрессия: остановка сразу после запуска зависала, если пробуждение успевало уйти раньше `accept`.
    #[test]
    fn stopping_right_after_start_never_hangs() {
        let (done, finished) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..500 {
                drop(broker());
            }
            let _ = done.send(());
        });
        finished.recv_timeout(std::time::Duration::from_secs(30)).expect("брокер завис при остановке");
    }

    #[test]
    fn dispatch_recognizes_modes() {
        let args = |list: &[&str]| -> Vec<OsString> { list.iter().map(OsString::from).collect() };
        let mut out = Vec::new();
        assert_eq!(dispatch(&args(&["app"]), false, &mut out), None, "обычный запуск приложения");
        assert_eq!(dispatch(&args(&["app", "--flag"]), false, &mut out), None);
        assert_eq!(dispatch(&args(&["app", FLAG_CRED_HELPER, "0", "store"]), false, &mut out), Some(0), "store и erase не наши");
        assert_eq!(dispatch(&args(&["app", FLAG_CRED_HELPER, "0", "erase"]), false, &mut out), Some(0));
        assert_eq!(dispatch(&args(&["app", FLAG_CRED_HELPER]), false, &mut out), Some(1));
        assert!(out.is_empty());
    }
}
