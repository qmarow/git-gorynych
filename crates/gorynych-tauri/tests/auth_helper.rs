//! Сквозная проверка помощника входа: настоящие `git`, `ssh-keygen`, `ssh-agent`, `ssh-add` запускают настоящий бинарь.
//! Главный риск здесь не логика, а запуск: GUI-бинарь на Windows, кириллица и пробелы в пути, разбор кавычек оболочкой git.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};

use gorynych_storage::askpass::{AuthBroker, AuthSession, ENV_ASKPASS, FLAG_CRED_HELPER};
use gorynych_storage::credentials::{GitAuth, HttpsAuth, SshAuth};

const HELPER: &str = env!("CARGO_BIN_EXE_gorynych-tauri");
const USERNAME: &str = "пользователь";
const SECRET: &str = "с3кр%т 'пароль' \"кавычки\" $HOME";

/// Минимальный HTTP-сервер: требует Basic-вход и запоминает, что прислал git.
struct AuthServer {
    port: u16,
    received: Arc<Mutex<Vec<String>>>,
}

impl AuthServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let received: Arc<Mutex<Vec<String>>> = Arc::default();
        let seen = Arc::clone(&received);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream);
                let mut authorization = None;
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("authorization: basic ") {
                        authorization = Some(line[line.len() - value.len()..].trim().to_owned());
                    }
                    line.clear();
                }
                let response = match authorization {
                    Some(value) => {
                        seen.lock().unwrap().push(value);
                        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    }
                    None => "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                };
                let _ = reader.get_mut().write_all(response.as_bytes());
            }
        });
        Self { port, received }
    }

    fn server_key(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn received(&self) -> Vec<String> {
        self.received.lock().unwrap().clone()
    }
}

fn decode_base64(encoded: &str) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let (mut bits, mut count, mut out) = (0u32, 0, Vec::new());
    for byte in encoded.bytes().filter(|byte| *byte != b'=') {
        bits = (bits << 6) | ALPHABET.iter().position(|a| *a == byte).unwrap() as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    String::from_utf8(out).unwrap()
}

fn with_session(command: &mut Command, session: &AuthSession) {
    command.envs(session.env().iter().map(|(key, value)| (key.as_str(), value.as_str())));
}

/// Запускает `git ls-remote`: настройки пользователя (в том числе Git Credential Manager) намеренно остаются.
fn git_ls_remote(server: &AuthServer, session: &AuthSession) -> Output {
    let mut command = Command::new("git");
    command
        .args(["ls-remote", &format!("{}/group/app.git", server.server_key())])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("NO_PROXY", "127.0.0.1")
        .stdin(Stdio::null());
    with_session(&mut command, session);
    command.output().unwrap()
}

fn https_auth(server: &AuthServer) -> GitAuth {
    GitAuth {
        https: vec![HttpsAuth { server: server.server_key(), username: USERNAME.into(), secret: SECRET.into() }],
        ssh: None,
    }
}

fn assert_git_authenticated(helper: &Path) {
    let server = AuthServer::start();
    let broker = AuthBroker::start(helper).unwrap();
    let session = broker.session(https_auth(&server)).unwrap();
    let output = git_ls_remote(&server, &session);

    let received = server.received();
    assert!(
        !received.is_empty(),
        "git не прислал вход.\nstderr: {}\nenv: {:?}",
        String::from_utf8_lossy(&output.stderr),
        session.env().iter().map(|(key, _)| key).collect::<Vec<_>>()
    );
    assert_eq!(decode_base64(&received[0]), format!("{USERNAME}:{SECRET}"));

    for (key, value) in session.env() {
        assert!(!value.contains(SECRET) && !value.contains(USERNAME), "секрет в {key}");
    }
}

#[test]
fn git_gets_credentials_through_real_helper() {
    assert_git_authenticated(Path::new(HELPER));
}

/// Копия бинаря в папке с кириллицей, пробелом и апострофом: так выглядит установка в профиль пользователя.
fn helper_in_hard_path(dir: &Path) -> PathBuf {
    let folder = dir.join("Горыныч Тимур's");
    fs::create_dir_all(&folder).unwrap();
    let copy = folder.join("git-Горыныч.exe");
    fs::copy(HELPER, &copy).unwrap();
    copy
}

#[test]
fn git_helper_works_from_path_with_cyrillic_spaces_and_quotes() {
    let dir = tempfile::tempdir().unwrap();
    assert_git_authenticated(&helper_in_hard_path(dir.path()));
}

fn helper_get(session: &AuthSession, index: &str) -> Output {
    let mut command = Command::new(HELPER);
    command.args([FLAG_CRED_HELPER, index, "get"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    with_session(&mut command, session);
    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(b"protocol=https\nhost=example\n\n").unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn helper_prints_git_credential_format_and_stops_after_revocation() {
    let server = AuthServer::start();
    let broker = AuthBroker::start(HELPER).unwrap();
    let session = broker.session(https_auth(&server)).unwrap();

    let output = helper_get(&session, "0");
    assert_eq!(String::from_utf8(output.stdout).unwrap(), format!("username={USERNAME}\npassword={SECRET}\n"));
    assert!(output.status.success());

    let out_of_range = helper_get(&session, "5");
    assert!(out_of_range.stdout.is_empty());
    assert!(out_of_range.status.success(), "нет ответа — git решает сам");

    // Токен из окружения уже завершённой операции
    let env: Vec<(String, String)> = session.env().to_vec();
    drop(session);
    let mut command = Command::new(HELPER);
    command.args([FLAG_CRED_HELPER, "0", "get"]).stdin(Stdio::null()).envs(env);
    let revoked = command.output().unwrap();
    assert!(revoked.stdout.is_empty(), "после операции секрет не выдаётся");
    assert!(revoked.stderr.is_empty());
}

#[test]
fn helper_without_broker_is_silent() {
    let output = Command::new(HELPER)
        .args([FLAG_CRED_HELPER, "0", "get"])
        .env_remove("GORYNYCH_AUTH_ENDPOINT")
        .env_remove("GORYNYCH_AUTH_TOKEN")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
}

fn git_usr_bin() -> Option<PathBuf> {
    let path = PathBuf::from(r"C:\Program Files\Git\usr\bin");
    if cfg!(windows) && path.join("ssh-agent.exe").exists() {
        return Some(path);
    }
    None
}

/// Значение `NAME=value;` из вывода `ssh-agent -s`.
fn agent_var(output: &str, name: &str) -> String {
    let start = output.find(&format!("{name}=")).expect("переменная агента") + name.len() + 1;
    output[start..].split(';').next().unwrap().to_owned()
}

fn assert_ssh_add_uses_passphrase(helper: &Path) {
    let Some(bin) = git_usr_bin() else {
        eprintln!("нет ssh из Git for Windows: пропуск");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let key = dir.path().join("id_test");
    let passphrase = "пароль ключа 'с кавычками'";
    let keygen = Command::new(bin.join("ssh-keygen.exe"))
        .args(["-q", "-t", "ed25519", "-N", passphrase, "-C", "test", "-f"])
        .arg(&key)
        .output()
        .unwrap();
    assert!(keygen.status.success(), "{}", String::from_utf8_lossy(&keygen.stderr));

    let broker = AuthBroker::start(helper).unwrap();
    let session = broker
        .session(GitAuth { https: vec![], ssh: Some(SshAuth { key_path: key.to_string_lossy().into_owned(), passphrase: Some(passphrase.into()) }) })
        .unwrap();

    let agent = Command::new(bin.join("ssh-agent.exe")).arg("-s").stdin(Stdio::null()).output().unwrap();
    let agent_text = String::from_utf8_lossy(&agent.stdout).into_owned();
    let (sock, pid) = (agent_var(&agent_text, "SSH_AUTH_SOCK"), agent_var(&agent_text, "SSH_AGENT_PID"));

    let run_add = |args: &[&str]| {
        let mut command = Command::new(bin.join("ssh-add.exe"));
        command.args(args).env("SSH_AUTH_SOCK", &sock).stdin(Stdio::null());
        with_session(&mut command, &session);
        command.output().unwrap()
    };
    let added = run_add(&[&key.to_string_lossy()]);
    let listed = run_add(&["-l"]);

    let _ = Command::new(bin.join("ssh-agent.exe")).arg("-k").env("SSH_AGENT_PID", &pid).env("SSH_AUTH_SOCK", &sock).output();

    assert!(added.status.success(), "ssh-add: {}", String::from_utf8_lossy(&added.stderr));
    assert!(String::from_utf8_lossy(&listed.stdout).contains("test"), "{}", String::from_utf8_lossy(&listed.stdout));
    assert!(session.env().iter().any(|(key, _)| key == ENV_ASKPASS));
    for (key, value) in session.env() {
        assert!(!value.contains(passphrase), "пароль ключа в {key}");
    }
}

#[test]
fn ssh_gets_passphrase_through_askpass_mode() {
    assert_ssh_add_uses_passphrase(Path::new(HELPER));
}

#[test]
fn ssh_askpass_works_from_path_with_cyrillic_spaces_and_quotes() {
    let dir = tempfile::tempdir().unwrap();
    assert_ssh_add_uses_passphrase(&helper_in_hard_path(dir.path()));
}

#[test]
fn normal_launch_is_not_a_helper_and_reads_no_stdin() {
    let mut child = Command::new(HELPER).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let status = child.wait().unwrap();
    let mut out = String::new();
    child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
    assert!(status.success());
    assert!(out.is_empty());
}
