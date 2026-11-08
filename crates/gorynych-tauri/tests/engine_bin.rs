//! Сквозная проверка исполнителя действий с настоящим бинарём: git запускает его редактором rebase и помощником входа.
//! Бинарь всегда запускается с флагом: без него это настоящее приложение с настоящим профилем.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use gorynych_git::actions::{ActionOutput, RepoAction, RepoEngine};
use gorynych_git::network::Network;
use gorynych_storage::askpass::AuthBroker;
use gorynych_storage::credentials::{Credentials, LoginInput};
use gorynych_storage::db::Db;
use gorynych_storage::secrets::SecretStore;
use serde_json::json;

const HELPER: &str = env!("CARGO_BIN_EXE_gorynych-tauri");

#[derive(Default)]
struct Memory(Mutex<HashMap<String, String>>);

impl SecretStore for Memory {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().unwrap().get(account).cloned()
    }

    fn set(&self, account: &str, secret: &str) -> gorynych_core::Result<()> {
        self.0.lock().unwrap().insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> gorynych_core::Result<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "a")
        .env("GIT_AUTHOR_EMAIL", "a@x")
        .env("GIT_COMMITTER_NAME", "a")
        .env("GIT_COMMITTER_EMAIL", "a@x")
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn commit(cwd: &Path, file: &str, message: &str) {
    std::fs::write(cwd.join(file), message).unwrap();
    git(cwd, &["add", "-A"]);
    git(cwd, &["commit", "-q", "-m", message]);
}

/// Каталог с кириллицей и пробелом: на них чаще всего ломается запуск через оболочку git.
fn repo_in(temp: &Path) -> std::path::PathBuf {
    let root = temp.join("Папка с пробелом");
    std::fs::create_dir(&root).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    root
}

fn engine(temp: &Path, network: Network) -> RepoEngine {
    RepoEngine::new(Arc::new(Db::open(&temp.join("state.db")).unwrap()), network, HELPER)
}

#[tokio::test(flavor = "multi_thread")]
async fn rebase_editor_runs_from_the_real_binary() {
    let temp = tempfile::tempdir().unwrap();
    let root = repo_in(temp.path());
    commit(&root, "a.txt", "Основа");
    commit(&root, "b.txt", "Первый");
    commit(&root, "c.txt", "Второй");
    commit(&root, "d.txt", "Третий");
    let hash = |rev: &str| git(&root, &["rev-parse", rev]).trim().to_owned();
    let plan = json!([
        { "hash": hash("HEAD~2"), "action": "reword", "message": "Новая тема: кириллица \"и кавычки\"" },
        { "hash": hash("HEAD~1"), "action": "squash" },
        { "hash": hash("HEAD"), "action": "drop" },
    ]);
    let engine = engine(temp.path(), Network::default());
    let action = RepoAction::parse("rebaseStart", json!({ "upstream": "HEAD~3", "plan": plan })).unwrap();
    let result = engine.run(&root, action).await.unwrap();
    assert!(matches!(result, ActionOutput::Rebase(_)));
    assert_eq!(git(&root, &["log", "--format=%s"]).trim().replace('\r', ""), "Новая тема: кириллица \"и кавычки\"\nОснова");
    assert!(!root.join("d.txt").exists(), "drop подействовал");
    assert!(root.join("c.txt").exists(), "squash подействовал");
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

/// Сервер требует вход и запоминает, что прислал git.
fn auth_server() -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let received = Arc::clone(&seen);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream);
            let (mut authorization, mut line) = (None, String::new());
            while reader.read_line(&mut line).is_ok_and(|size| size > 0) && line != "\r\n" {
                if line.to_ascii_lowercase().starts_with("authorization: basic ") {
                    authorization = line.trim_end().rsplit(' ').next().map(str::to_owned);
                }
                line.clear();
            }
            let response = match authorization {
                Some(value) => {
                    received.lock().unwrap().push(decode_base64(&value));
                    "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                }
                None => "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            };
            let _ = reader.get_mut().write_all(response.as_bytes());
        }
    });
    (port, seen)
}

#[tokio::test(flavor = "multi_thread")]
async fn saved_login_reaches_git_through_the_broker() {
    let temp = tempfile::tempdir().unwrap();
    let root = repo_in(temp.path());
    commit(&root, "a.txt", "Основа");
    let (port, seen) = auth_server();
    let url = format!("http://127.0.0.1:{port}/group/app.git");
    git(&root, &["remote", "add", "origin", &url]);

    let db = Arc::new(Db::open(&temp.path().join("creds.db")).unwrap());
    let credentials = Arc::new(Credentials::new(db, Arc::new(Memory::default())));
    let input = LoginInput { method: Some("password".into()), username: Some("пользователь".into()), secret: Some("с3кр%т 'пароль'".into()), ..LoginInput::default() };
    credentials.save(&url, &input).unwrap();
    let broker = Arc::new(AuthBroker::start(HELPER).unwrap());
    let network = Network::new(credentials, broker);

    // SAFETY: других тестов, читающих эти переменные, здесь нет: `git` выше получает окружение явно.
    unsafe {
        std::env::set_var("GCM_INTERACTIVE", "never");
        std::env::set_var("NO_PROXY", "127.0.0.1");
    }
    let engine = engine(temp.path(), network);
    let result = engine.run(&root, RepoAction::parse("checkAccess", json!({ "write": false })).unwrap()).await.unwrap();
    let ActionOutput::Access(access) = result else {
        panic!("другой результат");
    };
    assert!(!access.can_read, "сервер ответил 403");
    assert_eq!(seen.lock().unwrap().as_slice(), ["пользователь:с3кр%т 'пароль'"], "git получил сохранённый вход, ответ: {:?}", access.error);
}
