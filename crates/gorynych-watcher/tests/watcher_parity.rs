//! Сверка с настоящими `electron/watch.cjs`, `indexSync.cjs`, `remoteWatch.cjs`. Эталон: `node crates/gorynych-watcher/tests/fixtures/gen-watcher-parity.cjs`.
//! `null` и отсутствие поля считаются одним и тем же, `ms` не сравнивается.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_git::actions::{RepoAction, RepoEngine};
use gorynych_git::network::Network;
use gorynych_storage::db::Db;
use gorynych_watcher::index_sync::{IndexSync, StepKind, parse_status, plan};
use gorynych_watcher::remote_watch::{BranchHeadsApi, RemoteRepoWatcher};
use gorynych_watcher::watch::{ChangeKind, classify};
use indexmap::IndexMap;
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

#[derive(Default)]
struct FakeApi {
    answer: Mutex<Value>,
    calls: AtomicU32,
}

#[async_trait]
impl BranchHeadsApi for FakeApi {
    async fn branch_heads(&self, _root: &Path, _remote: &str) -> Result<Option<IndexMap<String, String>>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let answer = self.answer.lock().unwrap().clone();
        if let Some(error) = answer.get("error") {
            let code = serde_json::from_value::<ErrorCode>(error["code"].clone()).unwrap();
            return Err(GorynychError::new(code, error["message"].as_str().unwrap()).with_details(error["retryAfter"].as_u64().map_or_else(String::new, |seconds| format!("retry-after: {seconds}"))));
        }
        Ok(answer.get("heads").map(|heads| heads.as_object().unwrap().iter().map(|(name, hash)| (name.clone(), hash.as_str().unwrap().to_owned())).collect()))
    }

    fn retry_after(&self, error: &GorynychError) -> Option<u64> {
        error.details.strip_prefix("retry-after: ")?.parse().ok()
    }
}

fn set_environment() {
    // SAFETY: тест один на файл, окружение меняется до запуска дочерних процессов.
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
        ] {
            std::env::set_var(key, value);
        }
        std::env::remove_var("GIT_SSH_COMMAND");
        std::env::remove_var("GIT_SSH");
        std::env::set_var("GIT_CONFIG_GLOBAL", std::env::temp_dir().join("gorynych-no-gitconfig"));
    }
}

struct Fixture {
    sync: IndexSync,
    watcher: RemoteRepoWatcher,
    api: Arc<FakeApi>,
    _store: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let store = tempfile::tempdir().unwrap();
    let db = Arc::new(Db::open(&store.path().join("state.db")).unwrap());
    let engine = Arc::new(RepoEngine::new(db, Network::default(), std::env::current_exe().unwrap()));
    let api = Arc::new(FakeApi::default());
    let dyn_api: Arc<dyn BranchHeadsApi> = api.clone();
    Fixture { sync: IndexSync::new(Arc::clone(&engine)), watcher: RemoteRepoWatcher::new(engine, Some(dyn_api)), api, _store: store }
}

async fn call(fixture: &Fixture, step: &Value, root: &Path) -> Value {
    if let Some(args) = step["git"].as_array() {
        let args: Vec<&str> = args.iter().filter_map(Value::as_str).collect();
        let output = run(root, &args, true);
        if !output.status.success() && step["allowFail"] != json!(true) {
            return json!({ "error": { "code": "UNKNOWN", "message": format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr)) } });
        }
        return json!({ "ok": { "stdout": String::from_utf8_lossy(&output.stdout), "status": output.status.code() } });
    }
    if let Some(args) = step["gitIn"].as_array() {
        let args: Vec<&str> = args.iter().filter_map(Value::as_str).collect();
        return json!({ "ok": { "status": run(&root.join(args[0]), &args[1..], false).status.code() } });
    }
    if let Some(item) = step["write"].as_array() {
        write_file(&root.join(item[0].as_str().unwrap()), item[1].as_str().unwrap().as_bytes());
        return json!({ "ok": null });
    }
    if let Some(file) = step["rm"].as_str() {
        std::fs::remove_file(root.join(file)).unwrap();
        return json!({ "ok": null });
    }
    if let Some(answer) = step.get("api") {
        *fixture.api.answer.lock().unwrap() = answer.clone();
        fixture.api.calls.store(0, Ordering::SeqCst);
        return json!({ "ok": null });
    }
    if step.get("apiCalls").is_some() {
        return json!({ "ok": fixture.api.calls.load(Ordering::SeqCst) });
    }
    match step["call"].as_str().unwrap() {
        "sync" => match fixture.sync.sync_index(root, step["act"] == json!(true)).await {
            Ok(value) => json!({ "ok": value }),
            Err(error) => json!({ "error": { "code": error.code.as_str(), "message": error.message } }),
        },
        "light" => json!({ "ok": fixture.watcher.light_check(root).await }),
        "lightAt" => json!({ "ok": fixture.watcher.light_check(&PathBuf::from(step["dir"].as_str().unwrap())).await }),
        other => panic!("нет вызова {other}"),
    }
}

fn canon(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(map.iter().filter(|(key, item)| !item.is_null() && *key != "ms").map(|(key, item)| (key.clone(), canon(item))).collect()),
        Value::Array(list) => Value::Array(list.iter().map(canon).collect()),
        Value::Number(number) => json!(number.as_f64().unwrap_or(0.0)),
        other => other.clone(),
    }
}

async fn run_case(case: &Value) -> Vec<String> {
    let temp = tempfile::Builder::new().prefix("wat-parity-").tempdir().unwrap();
    let tmp = temp.path().to_path_buf();
    let root = tmp.join("репо");
    std::fs::create_dir(&root).unwrap();
    if case.get("noGit").is_none() {
        run(&root, &["init", "-q", "-b", "main"], false);
    }
    for op in case["setup"].as_array().unwrap() {
        let op = op.as_array().unwrap();
        let args: Vec<&str> = op[1..].iter().filter_map(Value::as_str).collect();
        match op[0].as_str().unwrap() {
            "git" => {
                run(&root, &args, false);
            }
            "gitIn" => {
                run(&root.join(args[0]), &args[1..], false);
            }
            "write" => write_file(&root.join(args[0]), args[1].as_bytes()),
            other => panic!("нет операции {other}"),
        }
    }
    let fixture = fixture();
    let pattern = regex::Regex::new(r#"\{\{rev:([^"]*?)\}\}"#).unwrap();
    let native = tmp.display().to_string().replace('\\', "\\\\");
    let posix = tmp.display().to_string().replace('\\', "/");
    let mut failures = Vec::new();
    for (index, (step, want)) in case["steps"].as_array().unwrap().iter().zip(case["expected"].as_array().unwrap()).enumerate() {
        let text = step.to_string();
        let text = pattern.replace_all(&text, |caps: &regex::Captures<'_>| String::from_utf8_lossy(&run(&root, &["rev-parse", &caps[1]], false).stdout).trim().to_owned());
        let args: Value = serde_json::from_str(&text.replace("{{TMP}}", &native)).unwrap();
        let got = call(&fixture, &args, &root).await;
        let text = got.to_string().replace(&native, "{{TMP}}").replace(&posix, "{{TMP}}");
        let (mut a, mut b) = (canon(&serde_json::from_str(&text).unwrap()), canon(want));
        if step.get("loose") == Some(&json!(true)) {
            for out in [&mut a, &mut b] {
                if let Some(message) = out.pointer_mut("/error/message") {
                    *message = json!("");
                }
            }
        }
        if a != b {
            failures.push(format!("{} шаг {index} {}\n  rust: {a}\n  1.x:  {b}", case["name"], step.to_string().chars().take(160).collect::<String>()));
        }
    }
    failures
}

fn data() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/watcher-parity.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn pure_functions_match() {
    let data = data();
    for item in data["classify"].as_array().unwrap() {
        let want = item[1].as_str();
        let got = classify(item[0].as_str().unwrap()).map(|kind| match kind {
            ChangeKind::Git => "git",
            ChangeKind::Worktree => "worktree",
        });
        assert_eq!(got, want, "{}", item[0]);
    }
    let map = |value: &Value| -> IndexMap<String, String> { value.as_object().unwrap().iter().map(|(key, item)| (key.clone(), item.as_str().unwrap().to_owned())).collect() };
    for item in data["plans"].as_array().unwrap() {
        let untracked: HashSet<String> = item["untracked"].as_array().unwrap().iter().map(|name| name.as_str().unwrap().to_owned()).collect();
        let previous = item["prev"].is_object().then(|| map(&item["prev"]));
        let got: Vec<Value> = plan(&map(&item["entries"]), &untracked, previous.as_ref())
            .into_iter()
            .map(|(file, kind)| {
                let kind = match kind {
                    StepKind::CompareReset => "compare-reset",
                    StepKind::Reset => "reset",
                    StepKind::AddOrReset => "add-or-reset",
                    StepKind::Add => "add",
                };
                json!({ "file": file, "kind": kind })
            })
            .collect();
        assert_eq!(json!(got), item["expected"], "{item}");
    }
    for item in data["parses"].as_array().unwrap() {
        let got = parse_status(item["text"].as_str().unwrap());
        let entries: Vec<Value> = got.entries.iter().map(|(file, xy)| json!([file, xy])).collect();
        assert_eq!(json!(entries), item["entries"], "{item}");
        let want: HashSet<&str> = item["untracked"].as_array().unwrap().iter().map(|name| name.as_str().unwrap()).collect();
        assert_eq!(got.untracked.iter().map(String::as_str).collect::<HashSet<_>>(), want, "{item}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scenarios_match_the_real_1x_modules() {
    set_environment();
    let data = data();
    let mut failures = Vec::new();
    for case in data["cases"].as_array().unwrap() {
        failures.extend(run_case(case).await);
    }
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), failures.iter().take(20).cloned().collect::<Vec<_>>().join("\n\n"));
    busy_repository_is_skipped().await;
}

/// В 1.x эти ветки зависят от гонки по времени, поэтому проверяются только здесь: занятость настоящего исполнителя.
async fn busy_repository_is_skipped() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("репо");
    std::fs::create_dir(&root).unwrap();
    run(&root, &["init", "-q", "-b", "main"], false);
    let store = temp.path().join("state.db");
    let engine = Arc::new(RepoEngine::new(Arc::new(Db::open(&store).unwrap()), Network::default(), std::env::current_exe().unwrap()));
    let watcher = RemoteRepoWatcher::new(Arc::clone(&engine), None);
    let sync = IndexSync::new(Arc::clone(&engine));

    let (release, wait) = tokio::sync::oneshot::channel::<()>();
    let background = engine.run_background(&root, async move { wait.await.unwrap() }).unwrap();
    assert_eq!(sync.sync_index(&root, true).await.unwrap(), None, "занято другой фоновой задачей");
    assert_eq!(watcher.light_check(&root).await.reason.as_deref(), Some("busy"));
    let stopped = std::sync::atomic::AtomicBool::new(true);
    assert_eq!(sync.sync_retrying(&root, true, &stopped).await, None, "остановлено: повторов нет");

    let running = tokio::spawn(background);
    let (other, path) = (Arc::clone(&engine), root.clone());
    let mut action = tokio::spawn(async move { other.run(&path, RepoAction::parse("stash", json!({})).unwrap()).await });
    tokio::time::timeout(std::time::Duration::from_millis(100), &mut action).await.expect_err("действие ждёт");
    assert_eq!(watcher.light_check(&root).await.reason.as_deref(), Some("busy"), "занято действием");
    release.send(()).unwrap();
    running.await.unwrap();
    action.await.unwrap().unwrap_err();

    stopped.store(false, Ordering::SeqCst);
    assert_eq!(sync.sync_retrying(&root, false, &stopped).await.unwrap().synced.len(), 0);
}
