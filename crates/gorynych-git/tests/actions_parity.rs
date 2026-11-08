//! Сверка с настоящими `electron/actions.cjs`, `rebase.cjs`, `restore.cjs`, `init.cjs`, `clone.cjs`. Эталон: `node crates/gorynych-git/tests/fixtures/gen-actions-parity.cjs`.
//! Сверяются ответ и состояние git после шага. `null` и отсутствие поля считаются одним и тем же, `checkedAt` не сравнивается.
//!
//! Свой `main` (`harness = false`): git запускает этот же файл как редактор rebase, как в приложении запускает его основной файл.
//! Выбрать сценарии: `GORYNYCH_GIT_CASE=<часть имени>`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use gorynych_core::error::Result;
use gorynych_core::i18n;
use gorynych_git::actions::{RepoAction, RepoEngine};
use gorynych_git::clone::{CloneRequest, cancel_clone, clone_repository, probe_clone};
use gorynych_git::init::{ConnectOptions, InitOptions, ProbeRemote, connect_repository, init_repository, inspect_folder, probe_remote};
use gorynych_git::network::Network;
use gorynych_git::rebase::{RebaseRequest, run_editor_helper, simulate};
use gorynych_storage::db::Db;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn run(cwd: &Path, args: &[&str], allow_fail: bool) -> std::process::Output {
    let output = Command::new("git").current_dir(cwd).args(args).output().unwrap();
    assert!(allow_fail || output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    output
}

fn write_file(path: &Path, data: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, data).unwrap();
}

fn prepare(case: &Value, tmp: &Path, root: &Path) {
    if case.get("noGit").is_none() {
        run(root, &["init", "-q", "-b", "main"], false);
    }
    for op in case["setup"].as_array().unwrap() {
        let op = op.as_array().unwrap();
        let args: Vec<&str> = op[1..].iter().filter_map(Value::as_str).collect();
        match op[0].as_str().unwrap() {
            "git" => {
                run(root, &args, false);
            }
            "gitIn" => {
                run(&root.join(args[0]), &args[1..], false);
            }
            "write" => write_file(&root.join(args[0]), args[1].as_bytes()),
            "writeOther" => write_file(&tmp.join("other").join(args[0]), args[1].as_bytes()),
            "writeOther2" => write_file(&tmp.join(args[0]).join(args[1]), args[2].as_bytes()),
            "writeBytes" => write_file(&root.join(args[0]), &op[2].as_array().unwrap().iter().map(|byte| byte.as_u64().unwrap() as u8).collect::<Vec<u8>>()),
            "writeRepeat" => write_file(&root.join(args[0]), args[1].repeat(op[3].as_u64().unwrap() as usize).as_bytes()),
            "mkdir" => std::fs::create_dir_all(root.join(args[0])).unwrap(),
            "rm" => std::fs::remove_file(root.join(args[0])).unwrap(),
            other => panic!("нет операции {other}"),
        }
    }
}

fn to_json<T: Serialize>(result: Result<T>) -> Value {
    match result {
        Ok(value) => json!({ "ok": serde_json::to_value(value).unwrap() }),
        Err(error) => json!({ "error": { "code": error.code.as_str(), "message": error.message, "hint": error.hint, "details": error.details } }),
    }
}

fn arg<T: DeserializeOwned + Default>(step: &Value, key: &str) -> T {
    step.get(key).filter(|value| !value.is_null()).map(|value| serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{key}: {error}: {value}"))).unwrap_or_default()
}

async fn call(engine: &RepoEngine, network: &Network, step: &Value, root: &Path) -> Value {
    if let Some(name) = step["action"].as_str() {
        return match RepoAction::parse(name, step["payload"].clone()) {
            Ok(action) => to_json(engine.run(root, action).await),
            Err(error) => to_json::<()>(Err(error)),
        };
    }
    if let Some(args) = step["git"].as_array() {
        let args: Vec<&str> = args.iter().filter_map(Value::as_str).collect();
        let output = run(root, &args, true);
        if !output.status.success() && step["allowFail"] != json!(true) {
            let message = format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr));
            return json!({ "error": { "code": "UNKNOWN", "message": message, "hint": null, "details": "" } });
        }
        return json!({ "ok": { "stdout": String::from_utf8_lossy(&output.stdout), "status": output.status.code() } });
    }
    if let Some(item) = step["write"].as_array() {
        write_file(&root.join(item[0].as_str().unwrap()), item[1].as_str().unwrap().as_bytes());
        return json!({ "ok": null });
    }
    if let Some(file) = step["rm"].as_str() {
        std::fs::remove_file(root.join(file)).unwrap();
        return json!({ "ok": null });
    }
    if let Some(file) = step["read"].as_str() {
        return json!({ "ok": std::fs::read(root.join(file)).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned()) });
    }
    if let Some(file) = step["readBytes"].as_str() {
        return json!({ "ok": std::fs::read(root.join(file)).unwrap() });
    }
    if let Some(file) = step["exists"].as_str() {
        return json!({ "ok": root.join(file).exists() });
    }
    let dir = step["dir"].as_str();
    match step["call"].as_str().unwrap() {
        "summary" => to_json(engine.history_summary(root)),
        "simulate" => to_json(simulate(root, &arg::<RebaseRequest>(step, "params")).await),
        "simulateApply" => {
            let preview = match simulate(root, &arg::<RebaseRequest>(step, "params")).await {
                Ok(preview) => preview,
                Err(error) => return to_json::<()>(Err(error)),
            };
            let payload = json!({ "oldHead": preview.old_head, "newHead": preview.new_head, "branch": preview.branch, "onto": preview.onto.hash });
            to_json(engine.run(root, RepoAction::parse("rebaseApply", payload).unwrap()).await)
        }
        "inspect" => {
            let own = root.display().to_string();
            to_json(inspect_folder(if step.get("dir").is_some() { dir } else { Some(&own) }).await)
        }
        "init" => to_json(init_repository(dir, &arg::<InitOptions>(step, "options")).await),
        "probeRemote" => to_json(probe_remote(network, dir, &arg::<ProbeRemote>(step, "options")).await),
        "connect" => to_json(connect_repository(network, dir, &arg::<ConnectOptions>(step, "options")).await),
        "probeClone" => to_json(probe_clone(network, step["url"].as_str()).await),
        "clone" => {
            let events = std::sync::Mutex::new(Vec::new());
            let result = clone_repository(network, &arg::<CloneRequest>(step, "options"), |event| events.lock().unwrap().push(event)).await;
            let last = events.lock().unwrap().last().cloned();
            match result {
                Ok(done) => json!({ "ok": { "path": done.path, "name": done.name, "last": last } }),
                Err(error) => to_json::<()>(Err(error)),
            }
        }
        "cancel" => json!({ "ok": cancel_clone(step["id"].as_str().unwrap()) }),
        other => panic!("нет вызова {other}"),
    }
}

fn canon(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(map.iter().filter(|(key, item)| !item.is_null() && *key != "checkedAt").map(|(key, item)| (key.clone(), canon(item))).collect()),
        Value::Array(list) => Value::Array(list.iter().map(canon).collect()),
        Value::Number(number) => json!(number.as_f64().unwrap_or(0.0)),
        // Время из сообщения curl
        Value::String(text) => {
            let elapsed = regex::Regex::new(r"after [0-9]+ ms").unwrap();
            json!(elapsed.replace_all(text, "after N ms"))
        }
        other => other.clone(),
    }
}

fn expand(step: &Value, tmp: &Path, root: &Path) -> Value {
    let pattern = regex::Regex::new(r#"\{\{rev:([^"]*?\}?)\}\}"#).unwrap();
    let text = step.to_string();
    let text = pattern.replace_all(&text, |caps: &regex::Captures<'_>| String::from_utf8_lossy(&run(root, &["rev-parse", &caps[1]], false).stdout).trim().to_owned());
    let escaped = |path: &Path| path.display().to_string().replace('\\', "\\\\");
    let posix = tmp.display().to_string().replace('\\', "/");
    let text = text.replace("{{TMPURL}}", &format!("file:///{}", posix.trim_start_matches('/'))).replace("{{ROOT}}", &escaped(root)).replace("{{TMP}}", &escaped(tmp));
    serde_json::from_str(&text).unwrap()
}

async fn run_case(case: Value, helper: PathBuf) -> Vec<String> {
    let temp = tempfile::Builder::new().prefix("act-parity-").tempdir().unwrap();
    let tmp: PathBuf = temp.path().to_path_buf();
    let root = tmp.join("репо");
    std::fs::create_dir(&root).unwrap();
    prepare(&case, &tmp, &root);
    let store = tempfile::tempdir().unwrap();
    let db = Arc::new(Db::open(&store.path().join("state.db")).unwrap());
    let network = Network::default();
    let engine = RepoEngine::new(db, network.clone(), helper);

    let posix = tmp.display().to_string().replace('\\', "/");
    let native = tmp.display().to_string().replace('\\', "\\\\");
    let mut failures = Vec::new();
    for (index, (step, want)) in case["steps"].as_array().unwrap().iter().zip(case["expected"].as_array().unwrap()).enumerate() {
        let args = expand(step, &tmp, &root);
        let got = call(&engine, &network, &args, &root).await;
        let text = got.to_string().replace(&native, "{{TMP}}").replace(&posix, "{{TMP}}");
        let (mut a, mut b) = (canon(&serde_json::from_str(&text).unwrap()), canon(want));
        if step.get("looseError") == Some(&json!(true)) {
            for out in [&mut a, &mut b] {
                for key in ["/error/message", "/error/details", "/error/hint"] {
                    if let Some(item) = out.pointer_mut(key) {
                        *item = json!("");
                    }
                }
            }
        }
        if a != b {
            let (x, y) = (a.to_string(), b.to_string());
            let at = x.chars().zip(y.chars()).take_while(|(l, r)| l == r).count();
            let window = |s: &str| s.chars().skip(at.saturating_sub(100)).take(500).collect::<String>();
            failures.push(format!("{} [{}] шаг {index} {}\n  rust: {}\n  1.x:  {}", case["name"], case["language"], step.to_string().chars().take(160).collect::<String>(), window(&x), window(&y)));
        }
    }
    failures
}

fn set_environment() {
    // SAFETY: вызывается в начале `main`, других потоков ещё нет.
    unsafe {
        for (key, value) in [
            ("GIT_AUTHOR_NAME", "Автор"),
            ("GIT_AUTHOR_EMAIL", "a@x"),
            ("GIT_COMMITTER_NAME", "Автор"),
            ("GIT_COMMITTER_EMAIL", "a@x"),
            ("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z"),
            ("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z"),
            ("GIT_CONFIG_NOSYSTEM", "1"),
            ("GIT_EDITOR", "true"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ] {
            std::env::set_var(key, value);
        }
        std::env::remove_var("GIT_SSH_COMMAND");
        std::env::remove_var("GIT_SSH");
        std::env::set_var("GIT_CONFIG_GLOBAL", std::env::temp_dir().join("gorynych-no-gitconfig"));
    }
}

async fn parity() -> Vec<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/actions-parity.json");
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let filter = std::env::var("GORYNYCH_GIT_CASE").unwrap_or_default();
    let helper = std::env::current_exe().unwrap();
    let mut failures = Vec::new();
    for language in ["ru", "en"] {
        i18n::set_language(language);
        let limit = Arc::new(tokio::sync::Semaphore::new(6));
        let mut tasks = tokio::task::JoinSet::new();
        for case in data["cases"].as_array().unwrap().iter().filter(|case| case["language"] == language && case["name"].as_str().unwrap().contains(&filter)) {
            let (case, limit, helper) = (case.clone(), limit.clone(), helper.clone());
            tasks.spawn(async move {
                let _slot = limit.acquire_owned().await.unwrap();
                run_case(case, helper).await
            });
        }
        while let Some(found) = tasks.join_next().await {
            failures.extend(found.unwrap());
        }
    }
    i18n::set_language("ru");
    failures
}

/// История переживает перезапуск: новый исполнитель над той же базой.
async fn history_survives_restart() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("репо");
    std::fs::create_dir(&root).unwrap();
    let helper = std::env::current_exe().unwrap();
    let db_path = temp.path().join("state.db");
    run(&root, &["init", "-q", "-b", "main"], false);
    for (name, text) in [("a.txt", "1\n"), ("a.txt", "2\n")] {
        std::fs::write(root.join(name), text).unwrap();
        run(&root, &["add", "-A"], false);
        run(&root, &["commit", "-q", "-m", text], false);
    }
    let action = |name: &str, payload: Value| RepoAction::parse(name, payload).unwrap();
    let hash = String::from_utf8_lossy(&run(&root, &["rev-parse", "HEAD~1"], false).stdout).trim().to_owned();
    {
        let engine = RepoEngine::new(Arc::new(Db::open(&db_path).unwrap()), Network::default(), helper.clone());
        engine.run(&root, action("restoreFile", json!({ "hash": hash, "path": "a.txt" }))).await.unwrap();
    }
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap().replace('\r', ""), "1\n");

    let engine = RepoEngine::new(Arc::new(Db::open(&db_path).unwrap()), Network::default(), helper);
    assert!(engine.history_summary(&root).unwrap().undo.is_some(), "запись пережила перезапуск");
    engine.run(&root, action("undo", json!({}))).await.unwrap();
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "2\n", "снимок файла тоже");
    engine.run(&root, action("redo", json!({}))).await.unwrap();
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap().replace('\r', ""), "1\n");
}

/// Занятость: фоновая задача не стартует во время действия, а действие ждёт идущую фоновую.
async fn busy_and_background() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("репо");
    std::fs::create_dir(&root).unwrap();
    run(&root, &["init", "-q", "-b", "main"], false);
    let store = temp.path().join("state.db");
    let engine = Arc::new(RepoEngine::new(Arc::new(Db::open(&store).unwrap()), Network::default(), std::env::current_exe().unwrap()));

    let (release, wait) = tokio::sync::oneshot::channel::<()>();
    let job = engine.run_background(&root, async move { wait.await.unwrap() }).expect("репозиторий свободен");
    assert!(engine.run_background(&root, async {}).is_none(), "вторая фоновая не запускается");
    let job = tokio::spawn(job);

    let (other, path) = (Arc::clone(&engine), root.clone());
    let mut action = tokio::spawn(async move { other.run(&path, RepoAction::parse("stash", json!({})).unwrap()).await });
    tokio::time::timeout(std::time::Duration::from_millis(200), &mut action).await.expect_err("действие ждёт фоновую задачу");
    assert!(engine.is_busy(&root));
    assert!(engine.run_background(&root, async {}).is_none(), "занято действием");

    release.send(()).unwrap();
    job.await.unwrap();
    action.await.unwrap().unwrap_err();
    assert!(!engine.is_busy(&root));
    assert!(engine.run_background(&root, async {}).is_some(), "снова свободен");
}

fn main() {
    if let Some(code) = run_editor_helper() {
        std::process::exit(code);
    }
    set_environment();
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(8).enable_all().build().unwrap();
    // На рабочем потоке, а не в `block_on`: как команды Tauri. Заодно проверяется, что стека 2 МБ хватает в отладочной сборке
    let work = runtime.spawn(async {
        history_survives_restart().await;
        busy_and_background().await;
        parity().await
    });
    let failures = runtime.block_on(work).unwrap();
    let shown: Vec<&str> = failures.iter().take(25).map(String::as_str).collect();
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), shown.join("\n\n"));
    println!("actions_parity: совпало");
}
