//! Паритет с `electron/credentials.cjs`: сценарий из `fixtures/parity.json` воспроизводится на Rust шаг за шагом.
//! Все проверки сценария идут в одном тесте: они меняют язык процесса.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use gorynych_core::GorynychError;
use gorynych_core::i18n::set_language;
use gorynych_storage::Db;
use gorynych_storage::credentials::{
    ApiLogin, AuthMethod, Credentials, GITHUB_TOKEN_PREFIXES, LegacyLogin, LegacySecret, LoginInput, LoginScope, ServerKind, guess_kind, parse_server, parse_target,
    repo_key_of, repo_path_of, ssh_command, ssh_url_for,
};
use gorynych_storage::secrets::SecretStore;
use gorynych_storage::ssh_keys::{list_ssh_keys, suggest_key_name};
use serde::Serialize;
use serde_json::{Map, Value, json};

static FIXTURE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/parity.json")).expect("корректный JSON"));

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

/// Заменяет `{TMP}` в строках и обратно, а `savedAt` приводит к `<time>`.
fn map_strings(value: &Value, f: &dyn Fn(&str) -> String) -> Value {
    match value {
        Value::String(text) => Value::String(f(text)),
        Value::Array(items) => Value::Array(items.iter().map(|item| map_strings(item, f)).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| {
                    let mapped = if key == "savedAt" && !item.is_null() { json!("<time>") } else { map_strings(item, f) };
                    (key.clone(), mapped)
                })
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

fn to_json(value: impl Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

fn outcome<T: Serialize>(result: Result<T, GorynychError>) -> (Option<Value>, Option<Value>) {
    match result {
        Ok(value) => (Some(to_json(value)), None),
        Err(error) => (None, Some(to_json(error))),
    }
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn api_login(login: Option<ApiLogin>) -> Value {
    login.map_or(Value::Null, |login| {
        json!({
            "secret": login.secret, "method": login.method, "viaApiToken": login.via_api_token, "username": login.username,
            "key": login.key, "url": login.url, "savedAt": login.saved_at, "shared": login.shared,
        })
    })
}

fn legacy_secret(value: Option<&Value>) -> LegacySecret {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return LegacySecret::Absent;
    };
    match value.get("plain").and_then(Value::as_str) {
        Some(encoded) => LegacySecret::Value(decode_base64(encoded)),
        None => LegacySecret::Unreadable,
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

fn seed(creds: &Credentials, data: &Value) {
    for (scope, section) in [(LoginScope::Host, "hosts"), (LoginScope::Repo, "repos")] {
        for (key, entry) in data[section].as_object().unwrap() {
            let method = match text(&entry["method"]) {
                "password" => AuthMethod::Password,
                "token" => AuthMethod::Token,
                _ => AuthMethod::Ssh,
            };
            creds
                .import_login(&LegacyLogin {
                    scope,
                    key: key.clone(),
                    method,
                    url: entry["url"].as_str().map(str::to_owned),
                    username: entry["username"].as_str().map(str::to_owned),
                    key_path: entry["keyPath"].as_str().map(str::to_owned),
                    secret: legacy_secret(entry.get("secret")),
                    passphrase: legacy_secret(entry.get("passphrase")),
                    api_token: legacy_secret(entry.get("apiToken")),
                    saved_at: entry["savedAt"].as_str().map(str::to_owned),
                })
                .unwrap();
        }
    }
    for (hostname, server) in data["servers"].as_object().unwrap() {
        let kind = ServerKind::parse(text(&server["kind"])).unwrap();
        creds.import_server(hostname, kind, server["base"].as_str(), server["savedAt"].as_str()).unwrap();
    }
}

fn run_op(creds: &Credentials, op: &str, args: &[Value]) -> (Option<Value>, Option<Value>) {
    let arg = |i: usize| args.get(i).map_or("", text);
    match op {
        "describe" => outcome(creds.describe(arg(0))),
        "save" => {
            let input: LoginInput = args.get(1).map_or_else(LoginInput::default, |data| serde_json::from_value(data.clone()).unwrap());
            outcome(creds.save(arg(0), &input))
        }
        "clear" => outcome(creds.clear(arg(0))),
        "forgetLogin" => outcome(creds.forget_login(arg(0))),
        "forgetServer" => outcome(creds.forget_server(arg(0))),
        "listServers" => outcome(creds.list_servers()),
        "serverKind" => (Some(to_json(creds.server_kind(arg(0)))), None),
        "serverBase" => (Some(to_json(creds.server_base(arg(0)))), None),
        "defaultTokenUser" => (Some(to_json(creds.default_token_user(arg(0)))), None),
        "setServer" => outcome(creds.set_server(arg(0), text(&args[1]["kind"]), args[1]["base"].as_str()).map(|()| Value::Null)),
        "attachApiToken" => outcome(creds.attach_api_token(arg(0), arg(1))),
        "apiLoginFor" => {
            let kind = args.get(2).map_or(Some(ServerKind::Gitlab), |value| ServerKind::parse(text(value)));
            let logins = creds.api_login_for(arg(0), arg(1), kind).unwrap();
            let other = logins.other.map_or(Value::Null, |other| json!({ "method": other.method, "key": other.key, "unreadable": other.unreadable }));
            (Some(json!({ "repo": api_login(logins.repo), "shared": api_login(logins.shared), "other": other })), None)
        }
        "envFor" => {
            let urls: Vec<&str> = args[0].as_array().unwrap().iter().map(text).collect();
            let auth = creds.git_auth(&urls);
            let https: Vec<Value> = auth.https.iter().map(|h| json!({ "server": h.server, "username": h.username, "secret": h.secret })).collect();
            let ssh = auth.ssh.as_ref().map_or(Value::Null, |s| {
                json!({ "command": ssh_command(&s.key_path, s.passphrase.is_some()), "passphrase": s.passphrase })
            });
            (Some(json!({ "https": https, "ssh": ssh })), None)
        }
        other => panic!("неизвестная операция {other}"),
    }
}

/// Вход по паролю, который не похож на токен GitHub.
fn github_password(login: &Value) -> bool {
    login["method"] == "password"
        && login["viaApiToken"] == false
        && !GITHUB_TOKEN_PREFIXES.iter().any(|prefix| login["secret"].as_str().is_some_and(|secret| secret.starts_with(prefix)))
}

/// Исправлено в 2.0: для API GitHub 1.x брал пароль учётной записи и отправлял его как `Bearer`. Расхождение допустимо, только
/// если 1.x выбрал такой пароль, а Rust — нет.
fn github_password_fixed(op: &str, args: &[Value], actual: &Value, expected: &Value) -> bool {
    let is_github = op == "apiLoginFor" && args.get(2).and_then(Value::as_str) == Some("github");
    let picked = |result: &Value| ["repo", "shared"].iter().any(|slot| github_password(&result[*slot]));
    is_github && picked(expected) && !picked(actual)
}

/// Первое отличие двух значений: иначе в выводе теста его не найти.
fn first_difference(actual: &Value, expected: &Value, path: &str) -> Option<String> {
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
            keys.into_iter().find_map(|key| {
                let missing = Value::String("<нет поля>".to_owned());
                first_difference(a.get(key).unwrap_or(&missing), b.get(key).unwrap_or(&missing), &format!("{path}.{key}"))
            })
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            a.iter().zip(b).enumerate().find_map(|(i, (x, y))| first_difference(x, y, &format!("{path}[{i}]")))
        }
        _ => (actual != expected).then(|| format!("{path}:\n  Rust: {actual}\n  1.x:  {expected}")),
    }
}

fn replay_scenario(language: &str) {
    set_language(language);
    let dir = tempfile::tempdir().unwrap();
    let tmp = dir.path().to_string_lossy().replace('\\', "/");
    for name in FIXTURE["keyFiles"].as_array().unwrap() {
        fs::write(dir.path().join(text(name)), "key").unwrap();
    }
    let fill = |value: &Value| {
        let tmp = tmp.clone();
        // В аргументах `savedAt` есть только в данных seed, там значение не важно.
        map_strings(value, &move |s| s.replace("{TMP}", &tmp))
    };
    let blank = |value: &Value| {
        let tmp = tmp.clone();
        map_strings(value, &move |s| s.replace(&tmp, "{TMP}"))
    };

    let mut creds = Credentials::new(Arc::new(Db::open(&dir.path().join("a.db")).unwrap()), Arc::new(Memory::default()));
    let mut seed_index = 0;
    let mut fixed_steps = 0;
    for (step, case) in FIXTURE["scenario"][language].as_array().unwrap().iter().enumerate() {
        let op = text(&case["op"]);
        let args: Vec<Value> = case["args"].as_array().unwrap().iter().map(&fill).collect();
        if op == "seed" {
            // В 1.x seed заменяет файл целиком: начинаем с пустой базы
            seed_index += 1;
            let db = Db::open(&dir.path().join(format!("seed{seed_index}.db"))).unwrap();
            creds = Credentials::new(Arc::new(db), Arc::new(Memory::default()));
            seed(&creds, &args[0]);
            continue;
        }
        let (result, error) = run_op(&creds, op, &args);
        let where_ = format!("шаг {step} [{language}] {op} {:?}", case["args"]);
        match (case.get("error"), error) {
            (Some(expected), Some(actual)) => assert_eq!(&blank(&actual), expected, "{where_}"),
            (Some(expected), None) => panic!("{where_}: ждали ошибку {expected}, получили {result:?}"),
            (None, Some(actual)) => panic!("{where_}: неожиданная ошибка {actual}"),
            (None, None) => {
                let actual = blank(&result.unwrap());
                if let Some(difference) = first_difference(&actual, &case["result"], "") {
                    if github_password_fixed(op, &args, &actual, &case["result"]) {
                        fixed_steps += 1;
                        continue;
                    }
                    panic!("{where_}\n{difference}");
                }
            }
        }
    }
    // Сценарий содержит такие шаги: если их не стало, правило выше больше ничего не проверяет
    assert!(fixed_steps > 0, "[{language}] нет шагов с паролем для API GitHub");
}

#[test]
fn scenario_matches_electron_in_both_languages() {
    replay_scenario("ru");
    replay_scenario("en");
    set_language("ru");

    // parse_server использует глобальный язык, поэтому проверяется здесь же
    for case in FIXTURE["servers"].as_array().unwrap() {
        let input = text(&case["input"]);
        let (ok, error) = outcome(parse_server(input));
        assert_eq!(ok.as_ref(), case.get("ok"), "{input:?}");
        assert_eq!(error.as_ref(), case.get("error"), "{input:?}");
    }
}

#[test]
fn url_parsing_matches_electron() {
    for case in FIXTURE["urls"].as_array().unwrap() {
        let url = text(&case["url"]);
        assert_eq!(to_json(parse_target(url)), case["target"], "parse_target({url:?})");
        assert_eq!(repo_path_of(url), text(&case["path"]), "repo_path_of({url:?})");
        assert_eq!(to_json(repo_key_of(url)), case["key"], "repo_key_of({url:?})");
        assert_eq!(to_json(ssh_url_for(url)), case["ssh"], "ssh_url_for({url:?})");
    }
}

#[test]
fn guess_kind_matches_electron() {
    for case in FIXTURE["guess"].as_array().unwrap() {
        assert_eq!(to_json(guess_kind(text(&case["host"]))), case["kind"], "{case}");
    }
}

#[test]
fn ssh_listing_and_names_match_electron() {
    let dir = tempfile::tempdir().unwrap();
    let ssh = &FIXTURE["ssh"];
    for file in ssh["files"].as_array().unwrap() {
        let path = dir.path().join(text(&file["name"]));
        let content = file["content"].as_str().map_or_else(|| "k".repeat(file["size"].as_u64().unwrap() as usize), str::to_owned);
        fs::write(&path, content).unwrap();
        let time = UNIX_EPOCH + Duration::from_millis(file["mtime"].as_u64().unwrap());
        fs::File::options().write(true).open(&path).unwrap().set_modified(time).unwrap();
    }
    fs::create_dir(dir.path().join("id_dir")).unwrap();

    let list = list_ssh_keys(dir.path());
    let actual: Vec<Value> = list
        .keys
        .iter()
        .map(|key| json!({ "name": key.name, "type": key.kind, "comment": key.comment, "hasPub": key.has_pub, "mtime": key.mtime as u64 }))
        .collect();
    assert_eq!(Value::Array(actual), ssh["list"]);

    for case in ssh["suggest"].as_array().unwrap() {
        let name = suggest_key_name(text(&case["type"]), case["host"].as_str(), dir.path());
        assert_eq!(name, text(&case["name"]), "{case}");
    }
    assert_eq!(suggest_key_name("rsa", Some("h"), Path::new("нет/такой/папки")), text(&ssh["suggestFree"]));
    assert!(list_ssh_keys(Path::new("нет/такой/папки")).keys.is_empty());
}
