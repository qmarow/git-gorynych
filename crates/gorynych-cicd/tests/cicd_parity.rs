//! Сверка с настоящими `electron/gitlab.cjs` и `electron/cicd/*`: те же сценарии против такого же локального сервера.
//! Совпасть обязаны результат или ошибка каждого шага и множество отправленных запросов: метод, адрес, заголовки и тело.
//! `null` и отсутствие поля считаются одним и тем же.
//!
//! Эталон: `node crates/gorynych-cicd/tests/fixtures/gen-cicd-parity.cjs`. Все подмены значений вне репозитория:
//! `node .../gen-cicd-parity.cjs <файл.json> 1`, затем `GORYNYCH_CICD_PARITY=<файл.json> cargo test -p gorynych-cicd --test cicd_parity`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gorynych_ci_linter::repo::RepoView;
use gorynych_cicd::detect_server::detect_server;
use gorynych_cicd::gitlab::*;
use gorynych_cicd::models::*;
use gorynych_cicd::remote::CicdGit;
use gorynych_cicd::runner_setup::Docker;
use gorynych_cicd::service::{CicdService, RunnerTagRequest, SettingsInput};
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n;
use gorynych_storage::credentials::{Credentials, LegacyCiMeta, LegacyLogin, LegacySecret, LoginInput, LoginScope};
use gorynych_storage::db::Db;
use gorynych_storage::secrets::SecretStore;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

/* ---------- Секреты в памяти и настоящий git ---------- */

#[derive(Default)]
struct Memory(Mutex<HashMap<String, String>>);

impl SecretStore for Memory {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().unwrap().get(account).cloned()
    }

    fn set(&self, account: &str, secret: &str) -> Result<()> {
        self.0.lock().unwrap().insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn git_command(dir: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(dir)
        .args(["-c", "core.autocrlf=false"])
        .envs([("GIT_AUTHOR_NAME", "a"), ("GIT_AUTHOR_EMAIL", "a@x"), ("GIT_COMMITTER_NAME", "a"), ("GIT_COMMITTER_EMAIL", "a@x"), ("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z"), ("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z"), ("GIT_CONFIG_NOSYSTEM", "1")]);
    command
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = git_command(dir).args(args).output().unwrap();
    assert!(output.status.success(), "{args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn plain_git(dir: &Path, args: &[&str]) -> Result<String> {
    let output = git_command(dir).args(args).output().unwrap();
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    Err(GorynychError::new(ErrorCode::Git, "git"))
}

struct RealView(PathBuf);

impl RepoView for RealView {
    fn staged_diff(&self) -> Result<String> {
        unreachable!("сверка тегов это не вызывает")
    }

    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }

    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }

    fn ls_files(&self) -> Result<String> {
        plain_git(&self.0, &gorynych_ci_linter::load::LS_FILES_ARGS)
    }

    fn refs(&self) -> Result<String> {
        plain_git(&self.0, &gorynych_ci_linter::load::REFS_ARGS)
    }

    fn origin_head(&self) -> Result<String> {
        plain_git(&self.0, &gorynych_ci_linter::load::ORIGIN_HEAD_ARGS)
    }

    fn verify_branch(&self, branch: &str) -> Result<String> {
        plain_git(&self.0, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
    }
}

struct RealGit;

impl CicdGit for RealGit {
    fn remote_verbose(&self, root: &Path) -> Result<String> {
        plain_git(root, &["remote", "-v"])
    }

    fn show(&self, root: &Path, spec: &str) -> Option<String> {
        plain_git(root, &["show", spec]).ok()
    }

    fn view(&self, root: &Path) -> Box<dyn RepoView + Send> {
        Box::new(RealView(root.to_path_buf()))
    }
}

/* ---------- Тестовый сервер ---------- */

#[derive(Default)]
struct ServerState {
    routes: serde_json::Map<String, Value>,
    counters: HashMap<String, usize>,
    requests: Vec<Value>,
    expand: HashMap<String, String>,
}

struct MockServer {
    state: Arc<Mutex<ServerState>>,
    in_flight: Arc<AtomicUsize>,
    port: u16,
}

fn expand(text: &str, map: &HashMap<String, String>) -> String {
    let mut out = text.replace("{{NOW}}", &chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    for (from, to) in map {
        out = out.replace(from, to);
    }
    out
}

fn serve(mut stream: TcpStream, state: &Mutex<ServerState>, in_flight: &AtomicUsize) {
    in_flight.fetch_add(1, Ordering::SeqCst);
    let mut raw = Vec::new();
    let mut buffer = [0u8; 8192];
    let head_end = loop {
        let Ok(count) = stream.read(&mut buffer) else {
            in_flight.fetch_sub(1, Ordering::SeqCst);
            return;
        };
        if count == 0 {
            in_flight.fetch_sub(1, Ordering::SeqCst);
            return;
        }
        raw.extend_from_slice(&buffer[..count]);
        if let Some(at) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
            break at;
        }
    };
    let head = String::from_utf8_lossy(&raw[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let start = lines.next().unwrap_or_default();
    let mut parts = start.split(' ');
    let (method, url) = (parts.next().unwrap_or_default().to_owned(), parts.next().unwrap_or_default().to_owned());
    let headers: HashMap<String, String> = lines.filter_map(|line| line.split_once(':')).map(|(name, value)| (name.to_lowercase(), value.trim().to_owned())).collect();
    let length: usize = headers.get("content-length").and_then(|value| value.parse().ok()).unwrap_or(0);
    let mut body = raw[head_end + 4..].to_vec();
    while body.len() < length {
        let count = stream.read(&mut buffer).unwrap_or(0);
        if count == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..count]);
    }

    let mut kept = serde_json::Map::new();
    for name in ["authorization", "private-token", "accept", "content-type", "x-github-api-version", "if-none-match", "user-agent"] {
        if let Some(value) = headers.get(name) {
            kept.insert(name.to_owned(), json!(value));
        }
    }
    let body_json = if body.is_empty() { Value::Null } else { serde_json::from_slice(&body).unwrap() };

    let (status, extra, answer) = {
        let mut state = state.lock().unwrap();
        state.requests.push(json!({ "method": method, "url": url, "host": headers.get("host"), "headers": kept, "body": body_json }));
        let key = format!("{method} {}", url.split('?').next().unwrap_or_default());
        let mut route = state.routes.get(&key).cloned();
        if let Some(Value::Array(list)) = &route {
            let n = *state.counters.get(&key).unwrap_or(&0);
            state.counters.insert(key.clone(), n + 1);
            route = list.get(n.min(list.len().saturating_sub(1))).cloned();
        }
        if let Some(by_auth) = route.as_ref().and_then(|item| item.get("byAuth")).cloned() {
            let auth = headers.get("authorization").cloned().unwrap_or_default().to_lowercase();
            route = by_auth.get(&auth).or_else(|| by_auth.get("default")).cloned();
        }
        let route = route.filter(|item| !item.is_null()).unwrap_or_else(|| json!({ "status": 404, "json": { "message": "404 Not Found" } }));
        let status = route["status"].as_u64().unwrap_or(200);
        let mut extra = String::new();
        if let Some(map) = route.get("headers").and_then(Value::as_object) {
            for (name, value) in map {
                extra.push_str(&format!("{name}: {}\r\n", expand(value.as_str().unwrap_or_default(), &state.expand)));
            }
        }
        let answer = match (route.get("json"), route.get("text")) {
            (Some(value), _) => Some(expand(&value.to_string(), &state.expand)),
            (_, Some(Value::String(text))) => Some(expand(text, &state.expand)),
            _ => None,
        };
        (status, extra, answer)
    };
    let body = answer.unwrap_or_default();
    let length_header = if status == 204 || status == 304 { String::new() } else { format!("content-length: {}\r\n", body.len()) };
    let reply = format!("HTTP/1.1 {status} X\r\n{extra}{length_header}connection: close\r\n\r\n{body}");
    let _ = stream.write_all(reply.as_bytes());
    let _ = stream.flush();
    drop(stream);
    in_flight.fetch_sub(1, Ordering::SeqCst);
}

impl MockServer {
    fn start(routes: &Value) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(ServerState { routes: routes.as_object().cloned().unwrap_or_default(), ..ServerState::default() }));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let (shared, counter) = (state.clone(), in_flight.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (state, counter) = (shared.clone(), counter.clone());
                std::thread::spawn(move || serve(stream, &state, &counter));
            }
        });
        Self { state, in_flight, port }
    }

    async fn settle(&self) {
        let mut quiet = 0;
        while quiet < 3 {
            tokio::time::sleep(Duration::from_millis(15)).await;
            quiet = if self.in_flight.load(Ordering::SeqCst) == 0 { quiet + 1 } else { 0 };
        }
    }
}

/* ---------- Сравнение ---------- */

/// Убирает `null` из объектов; числа приводит к `f64`; сортирует перечисленные списки.
fn canon(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(_, item)| !item.is_null())
                // Время сохранения входа зависит от прогона; время из данных сценария сравнивается
                .map(|(key, item)| (key.clone(), if key == "savedAt" && !item.as_str().is_some_and(|at| at.starts_with("2024-")) { json!("<сейчас>") } else { canon(item) }))
                .collect(),
        ),
        Value::Array(list) => Value::Array(list.iter().map(canon).collect()),
        Value::Number(number) => json!(number.as_f64().unwrap_or(0.0)),
        other => other.clone(),
    }
}

fn sorted_requests(list: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = list
        .iter()
        .map(|request| {
            let mut request = canon(request);
            // Шифротекст случаен, и тот же fetch в Node добавляет свой User-Agent
            if let Some(sealed) = request.pointer_mut("/body/encrypted_value") {
                *sealed = json!("<sealed>");
            }
            if request.pointer("/headers/user-agent").and_then(Value::as_str) == Some("node")
                && let Some(headers) = request.get_mut("headers").and_then(Value::as_object_mut)
            {
                headers.remove("user-agent");
            }
            request
        })
        .collect();
    out.sort_by_key(ToString::to_string);
    out
}

fn normalize_names(text: &str) -> String {
    // Суффиксы имён раннеров зависят от времени.
    let pattern = regex::Regex::new(r"(gorynych-(?:gitlab|github|gitea)-[a-z0-9-]*?-|git-gorynych-)[0-9a-z]{4}\b").unwrap();
    let text = pattern.replace_all(text, "${1}xxxx");
    let port = regex::Regex::new(r"host\.docker\.internal:[0-9]+").unwrap();
    port.replace_all(&text, "host.docker.internal:PORT").into_owned()
}

fn lists_sorted(value: &Value, names: &[String]) -> Value {
    let mut value = value.clone();
    for name in names {
        if let Some(Value::Array(list)) = value.pointer_mut(&format!("/ok/{name}")) {
            list.sort_by_key(ToString::to_string);
        }
    }
    value
}

/* ---------- Прогон сценария ---------- */

fn to_json<T: Serialize>(result: Result<T>) -> Value {
    match result {
        Ok(value) => json!({ "ok": serde_json::to_value(value).unwrap() }),
        Err(error) => json!({ "error": { "code": error.code.as_str(), "message": error.message, "hint": error.hint, "details": error.details } }),
    }
}

fn arg<T: DeserializeOwned + Default>(step: &Value, key: &str) -> T {
    step.get(key).filter(|value| !value.is_null()).map(|value| serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{key}: {error}: {value}"))).unwrap_or_default()
}

fn opt_id(step: &Value, key: &str) -> Option<CiId> {
    step.get(key).filter(|value| !value.is_null()).map(|value| serde_json::from_value(value.clone()).unwrap())
}

fn text_arg<'a>(step: &'a Value, key: &str) -> Option<&'a str> {
    step.get(key).and_then(Value::as_str)
}

async fn call(service: &CicdService, root: &Path, tmp: &Path, step: &Value) -> Value {
    let remote = text_arg(step, "remote");
    let id = opt_id(step, "id");
    let any_id = || id.clone().unwrap_or(CiId::Text("undefined".to_owned()));
    match step["call"].as_str().unwrap() {
        "cicd.detect" => to_json(service.detect(root, remote).await),
        "cicd.checkLogin" => to_json(service.check_login(root, remote).await),
        "cicd.info" => to_json(service.info(root, remote).await),
        "cicd.pipelines" => to_json(service.pipelines(root, text_arg(step, "ref"), remote).await),
        "cicd.pipeline" => to_json(service.pipeline(root, &any_id(), remote).await),
        "cicd.jobLog" => to_json(service.job_log(root, &any_id(), opt_id(step, "pipelineId").as_ref(), remote).await),
        "cicd.action" => to_json(service.action(root, &arg::<ActionRequest>(step, "action"), remote).await),
        "cicd.run" => to_json(service.run(root, &arg::<RunParams>(step, "params"), remote).await),
        "cicd.runForm" => to_json(Ok(service.run_form(root, remote).await)),
        "cicd.runners" => to_json(service.runners(root, remote).await),
        "cicd.runnerUpdate" => to_json(service.runner_update(root, &any_id(), &arg::<RunnerPatch>(step, "patch"), remote).await),
        "cicd.runnerDelete" => to_json(service.runner_delete(root, &any_id(), remote).await),
        "cicd.runnersPrune" => {
            let ids: Option<Vec<CiId>> = step.get("ids").map(|value| serde_json::from_value(value.clone()).unwrap());
            to_json(service.runners_prune(root, ids.as_deref(), remote).await)
        }
        "cicd.runnerRegister" => to_json(service.runner_register(root, &arg::<RunnerRegisterOptions>(step, "options"), remote).await),
        "cicd.runnerTagCheck" => {
            let request = RunnerTagRequest { file: text_arg(step, "file").map(str::to_owned), drafts: step.get("drafts").map(|value| serde_json::from_value(value.clone()).unwrap()) };
            to_json(service.runner_tag_check(root, &request, remote).await)
        }
        "cicd.localRunners" => to_json(service.local_runners(root, remote).await),
        "cicd.localRunnerStart" => to_json(service.local_runner_start(root, &arg::<Vec<Value>>(step, "labels"), remote).await),
        "cicd.localRunnerStop" => to_json(service.local_runner_stop(text_arg(step, "name").unwrap()).await),
        "cicd.localRunnerResume" => to_json(service.local_runner_resume(text_arg(step, "name").unwrap()).await),
        "cicd.dockerStatus" => to_json(Ok(service.docker_status().await)),
        "cicd.artifactDownload" => {
            let artifact: Option<ArtifactRef> = step.get("artifact").map(|value| serde_json::from_value(value.clone()).unwrap());
            let dest = text_arg(step, "dest").map(|name| tmp.join(name));
            to_json(service.artifact_download(root, artifact.as_ref(), dest.as_deref(), remote).await)
        }
        "cicd.secrets" => to_json(service.secrets(root, remote).await),
        "cicd.secretSave" => to_json(service.secret_save(root, &arg::<SecretSave>(step, "data"), remote).await),
        "cicd.secretDelete" => to_json(service.secret_delete(root, &arg::<SecretRef>(step, "data"), remote).await),
        "cicd.getSettings" => to_json(Ok(service.get_settings(root, remote).await)),
        "cicd.setSettings" => to_json(service.set_settings(root, &arg::<SettingsInput>(step, "data"), remote).await),
        "gitlab.status" => to_json(service.gitlab_detect_remote(root, remote).await),
        "gitlab.pipelines" => to_json(service.gitlab_pipelines(root, text_arg(step, "ref"), remote).await),
        "gitlab.pipeline" => to_json(service.gitlab_pipeline(root, &any_id(), remote).await),
        "gitlab.jobLog" => to_json(service.gitlab_job_log(root, &any_id(), remote).await),
        "gitlab.action" => to_json(service.gitlab_action(root, &arg::<ActionRequest>(step, "action"), remote).await),
        "gitlab.variables" => to_json(service.gitlab_variables(root, remote).await),
        "gitlab.variableValue" => to_json(service.gitlab_variable_value(root, &arg::<GlVariableRef>(step, "variable"), remote).await),
        "gitlab.runners" => to_json(service.gitlab_runners(root, remote).await),
        "gitlab.lint" => to_json(service.gitlab_lint(root, &arg::<GlLintRequest>(step, "draft"), remote).await),
        "gitlab.saveVariable" => to_json(service.gitlab_save_variable(root, &arg::<GlVariableSave>(step, "data"), remote).await),
        "gitlab.deleteVariable" => to_json(service.gitlab_delete_variable(root, &arg::<GlVariableRef>(step, "variable"), remote).await),
        "gitlab.schedules" => to_json(service.gitlab_schedules(root, remote).await),
        "gitlab.saveSchedule" => to_json(service.gitlab_save_schedule(root, &arg::<GlScheduleInput>(step, "schedule"), remote).await),
        "gitlab.scheduleAction" => to_json(service.gitlab_schedule_action(root, &arg::<GlScheduleAction>(step, "action"), remote).await),
        "gitlab.createMr" => to_json(service.gitlab_create_merge_request(root, &arg::<GlMergeRequestInput>(step, "mr"), remote).await),
        "gitlab.checkLoginApi" => to_json(service.gitlab_check_login_api(text_arg(step, "hostname").unwrap(), text_arg(step, "path").unwrap(), text_arg(step, "base").unwrap()).await),
        "gitlab.loginApiState" => to_json(service.gitlab_login_api_state(text_arg(step, "hostname").unwrap(), text_arg(step, "path").unwrap(), text_arg(step, "base"))),
        "gitlab.listTokens" => to_json(service.gitlab_list_tokens()),
        "gitlab.forgetToken" => to_json(service.gitlab_forget_token(text_arg(step, "key").unwrap())),
        "gitlab.forgetRepoToken" => to_json(service.gitlab_forget_repo_token(text_arg(step, "hostname").unwrap(), text_arg(step, "path").unwrap())),
        "gitlab.forgetHost" => to_json(service.gitlab_forget_host(text_arg(step, "hostname").unwrap())),
        "gitlab.branchHeads" => to_json(service.gitlab_branch_heads(root, text_arg(step, "name").unwrap()).await.map(|heads| heads.map(|heads| heads.into_iter().collect::<std::collections::BTreeMap<_, _>>()))),
        "credentials.detectServer" => to_json(detect_server(service.client(), text_arg(step, "input").unwrap()).await),
        other => panic!("нет вызова {other}"),
    }
}

fn dead_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

async fn run_case(case: &Value) -> Vec<String> {
    let name = case["name"].as_str().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let tmp = temp.path().to_path_buf();
    let root = tmp.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(tmp.join("key"), "ключ").unwrap();
    if case.get("noGit").is_none() {
        git(&root, &["init", "-q", "-b", "main"]);
    }

    let write_files = |key: &str| {
        for (rel, text) in case.get(key).and_then(Value::as_object).into_iter().flatten() {
            let full = root.join(rel);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, text.as_str().unwrap()).unwrap();
        }
    };
    write_files("commit");
    let mut head = String::new();
    if case.get("commit").is_some_and(|commit| !commit.is_null()) {
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-q", "-m", "c"]);
        head = git(&root, &["rev-parse", "HEAD"]);
    }
    write_files("files");

    let server = MockServer::start(&case["server"]);
    let host = format!("127.0.0.1:{}", server.port);
    let dead = dead_port();
    let forward_tmp = tmp.to_string_lossy().replace('\\', "/");
    let map: HashMap<String, String> = [
        ("{{BASE}}", format!("http://{host}")),
        ("{{HOST}}", host.clone()),
        ("{{OTHER}}", format!("http://localhost:{}", server.port)),
        ("{{DEAD}}", format!("http://127.0.0.1:{dead}")),
        ("{{HEAD}}", head.clone()),
        ("{{ROOT}}", forward_tmp.clone()),
    ]
    .into_iter()
    .map(|(from, to)| (from.to_owned(), to))
    .collect();
    server.state.lock().unwrap().expand = map.clone();
    let expand_json = |value: &Value| -> Value { serde_json::from_str(&expand(&value.to_string(), &map)).unwrap() };

    if let Some(remote) = case["remote"].as_str() {
        git(&root, &["remote", "add", "origin", &expand(remote, &map)]);
    }
    for (name, url) in case.get("extraRemotes").and_then(Value::as_object).into_iter().flatten() {
        git(&root, &["remote", "add", name, &expand(url.as_str().unwrap(), &map)]);
    }

    let db = Arc::new(Db::open(&tmp.join("state.db")).unwrap());
    let creds = Arc::new(Credentials::new(db.clone(), Arc::new(Memory::default())));
    for op in case.get("setup").and_then(Value::as_array).into_iter().flatten() {
        match op["op"].as_str().unwrap() {
            "login" => {
                let data: LoginInput = serde_json::from_value(expand_json(&op["data"])).unwrap();
                creds.save(&expand(op["url"].as_str().unwrap(), &map), &data).unwrap();
            }
            "server" => creds.set_server(op["host"].as_str().unwrap(), op["kind"].as_str().unwrap(), op["base"].as_str().map(|base| expand(base, &map)).as_deref()).unwrap(),
            "settings" => {
                db.set_repo_provider(op["host"].as_str().unwrap(), op["path"].as_str().unwrap(), op["provider"].as_str(), Some(&expand(op["apiBase"].as_str().unwrap(), &map))).unwrap();
            }
            "legacy" => {
                let entry = expand_json(&op["entry"]);
                let scope = if op["scope"] == "hosts" { LoginScope::Host } else { LoginScope::Repo };
                let meta: LegacyCiMeta = serde_json::from_value(entry.clone()).unwrap();
                creds.import_legacy_ci_token(scope, &expand(op["key"].as_str().unwrap(), &map), &LegacySecret::Value(entry["token"].as_str().unwrap().to_owned()), entry["savedAt"].as_str(), &meta).unwrap();
            }
            "sharedLogin" => {
                let login = LegacyLogin {
                    scope: LoginScope::Host,
                    key: expand(op["key"].as_str().unwrap(), &map),
                    method: serde_json::from_value(op["method"].clone()).unwrap(),
                    url: None,
                    username: op["username"].as_str().map(str::to_owned),
                    key_path: None,
                    secret: LegacySecret::Value(op["secret"].as_str().unwrap().to_owned()),
                    passphrase: LegacySecret::Absent,
                    api_token: LegacySecret::Absent,
                    saved_at: Some("2024-01-01T00:00:00.000Z".to_owned()),
                };
                creds.import_login(&login).unwrap();
            }
            "unreadableLogin" => {
                let url = expand(op["url"].as_str().unwrap(), &map);
                let login = LegacyLogin {
                    scope: LoginScope::Repo,
                    key: gorynych_storage::credentials::repo_key_of(&url).unwrap(),
                    method: serde_json::from_value(op["method"].clone()).unwrap(),
                    url: Some(url),
                    username: Some("u".to_owned()),
                    key_path: None,
                    secret: LegacySecret::Unreadable,
                    passphrase: LegacySecret::Absent,
                    api_token: LegacySecret::Absent,
                    saved_at: Some("2024-01-01T00:00:00.000Z".to_owned()),
                };
                creds.import_login(&login).unwrap();
            }
            "legacyUnreadable" => {
                let entry = expand_json(&op["entry"]);
                let scope = if op["scope"] == "hosts" { LoginScope::Host } else { LoginScope::Repo };
                let meta: LegacyCiMeta = serde_json::from_value(entry.clone()).unwrap();
                creds.import_legacy_ci_token(scope, &expand(op["key"].as_str().unwrap(), &map), &LegacySecret::Unreadable, entry["savedAt"].as_str(), &meta).unwrap();
            }
            other => panic!("нет операции {other}"),
        }
    }

    let docker_log = tmp.join("docker.log");
    let docker = match case.get("docker") {
        Some(conf) if conf.get("missing").is_some() => Docker::with_command("нет-такой-программы-docker", Vec::new()),
        Some(conf) if !conf.is_null() => {
            let file = tmp.join("docker.json");
            std::fs::write(&file, json!({ "log": docker_log, "script": expand_json(&conf["script"]) }).to_string()).unwrap();
            let fake = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-docker.cjs");
            Docker::with_command("node", vec![("NODE_OPTIONS".to_owned(), format!("--require \"{}\"", fake.to_string_lossy().replace('\\', "/"))), ("GORYNYCH_FAKE_DOCKER".to_owned(), file.to_string_lossy().into_owned())])
        }
        _ => Docker::default(),
    };

    let service = CicdService::new(db, creds, Arc::new(RealGit), docker);
    let sort_lists: Vec<String> = case.get("sortLists").map(|value| serde_json::from_value(value.clone()).unwrap()).unwrap_or_default();

    let normalize = |text: String| -> String {
        let quoted_tmp = tmp.to_string_lossy().replace('\\', "\\\\");
        let text = text.replace(&quoted_tmp, "{{TMP}}").replace(&forward_tmp, "{{TMP}}").replace(&host, "{{HOST}}").replace(&format!("127.0.0.1:{dead}"), "{{DEAD_HOST}}").replace(&format!("localhost:{}", server.port), "{{OTHER_HOST}}");
        let text = if head.is_empty() { text } else { text.replace(&head, "{{HEAD}}") };
        normalize_names(&text)
    };

    let mut failures = Vec::new();
    let steps = case["steps"].as_array().unwrap();
    let expected = case["expected"].as_array().unwrap();
    for (index, (step, want)) in steps.iter().zip(expected).enumerate() {
        server.state.lock().unwrap().requests.clear();
        let _ = std::fs::remove_file(&docker_log);
        let args = expand_json(step);
        let got = call(&service, &root, &tmp, &args).await;
        server.settle().await;
        let requests = server.state.lock().unwrap().requests.clone();
        let log: Vec<String> = std::fs::read_to_string(&docker_log).map(|text| text.lines().filter(|line| !line.is_empty()).map(str::to_owned).collect()).unwrap_or_default();

        let got: Value = serde_json::from_str(&normalize(json!({ "out": got, "requests": requests, "log": log }).to_string())).unwrap();
        let want: Value = serde_json::from_str(&normalize_names(&want.to_string())).unwrap();
        let want_out = if let Some(error) = want.get("error") { json!({ "error": error }) } else { json!({ "ok": want.get("ok").cloned().unwrap_or(Value::Null) }) };

        let mut got_out = got["out"].clone();
        let mut want_out = want_out;
        if step.get("noDetails").is_some() {
            for out in [&mut got_out, &mut want_out] {
                if let Some(details) = out.pointer_mut("/error/details") {
                    *details = json!("");
                }
            }
        }
        // Текст ошибки NETWORK зависит от HTTP-клиента
        for out in [&mut got_out, &mut want_out] {
            if out.pointer("/error/code") == Some(&json!("NETWORK"))
                && let Some(details) = out.pointer_mut("/error/details")
            {
                *details = json!("");
            }
        }
        if step.get("looseError") == Some(&json!(true)) {
            for out in [&mut got_out, &mut want_out] {
                if let Some(message) = out.pointer_mut("/error/message") {
                    *message = json!("");
                }
            }
        }
        let (a, b) = (canon(&lists_sorted(&got_out, &sort_lists)), canon(&lists_sorted(&want_out, &sort_lists)));
        if a != b {
            failures.push(format!("{name} [{}] шаг {index} {}\n  rust: {a}\n  1.x:  {b}", case["language"], step));
        }
        let (a, b) = (sorted_requests(got["requests"].as_array().unwrap()), sorted_requests(want["requests"].as_array().unwrap()));
        if a != b {
            failures.push(format!("{name} [{}] шаг {index} {} — запросы\n  rust: {}\n  1.x:  {}", case["language"], step, json!(a), json!(b)));
        }
        if got["log"] != want["dockerLog"] {
            failures.push(format!("{name} [{}] шаг {index} {} — docker\n  rust: {}\n  1.x:  {}", case["language"], step, got["log"], want["dockerLog"]));
        }
    }
    failures
}

/// Подмены значений: падение 1.x с `TypeError` не обязано совпасть, это ошибка в данных сервера. Rust при этом не должен падать.
fn drop_crashes(case: &mut Value) {
    let Some(expected) = case.get("expected").and_then(Value::as_array).cloned() else {
        return;
    };
    let keep: Vec<bool> = expected.iter().map(|want| !(want.pointer("/error/code") == Some(&json!("UNKNOWN")))).collect();
    let steps = case["steps"].as_array().cloned().unwrap_or_default();
    let filtered_steps: Vec<Value> = steps.iter().zip(&keep).map(|(step, keep)| { let mut step = step.clone(); if !*keep { step["skipCompare"] = json!(true); } step }).collect();
    case["steps"] = Value::Array(filtered_steps);
}

fn fixture() -> Value {
    let path = std::env::var("GORYNYCH_CICD_PARITY").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cicd-parity.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Сценарии идут параллельно, но язык у процесса один, поэтому сначала все русские, затем все английские.
async fn run_all(cases: &[Value], post: fn(&Value, Vec<String>) -> Vec<String>) -> Vec<String> {
    static LANGUAGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _exclusive = LANGUAGE.lock().await;
    let mut failures = Vec::new();
    for language in ["ru", "en"] {
        i18n::set_language(language);
        let limit = Arc::new(tokio::sync::Semaphore::new(12));
        let mut tasks = tokio::task::JoinSet::new();
        for case in cases.iter().filter(|case| case["language"] == language) {
            let (case, limit) = (case.clone(), limit.clone());
            tasks.spawn(async move {
                let _slot = limit.acquire_owned().await.unwrap();
                let found = run_case(&case).await;
                post(&case, found)
            });
        }
        while let Some(found) = tasks.join_next().await {
            failures.extend(found.unwrap());
        }
    }
    i18n::set_language("ru");
    failures
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn matches_the_real_1x_modules() {
    let data = fixture();
    let filter = std::env::var("GORYNYCH_CICD_CASE").unwrap_or_default();
    let cases: Vec<Value> = data["cases"].as_array().unwrap().iter().filter(|case| case["name"].as_str().unwrap().contains(&filter)).cloned().collect();
    let failures = run_all(&cases, |_, found| found).await;
    let limit = 12;
    let shown: Vec<&String> = failures.iter().take(limit).collect();
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), shown.iter().map(|item| item.as_str()).collect::<Vec<_>>().join("\n\n"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn survives_null_fields_like_the_real_1x_modules() {
    let data = fixture();
    let filter = std::env::var("GORYNYCH_CICD_CASE").unwrap_or_default();
    let cases: Vec<Value> = data["mutants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["name"].as_str().unwrap().contains(&filter))
        .cloned()
        .map(|mut case| {
            drop_crashes(&mut case);
            case
        })
        .collect();
    assert!(!cases.is_empty() || !filter.is_empty(), "подмен нет");
    let failures = run_all(&cases, |case, found| {
        let skipped: Vec<usize> = case["steps"].as_array().unwrap().iter().enumerate().filter(|(_, step)| step.get("skipCompare").is_some()).map(|(index, _)| index).collect();
        found.into_iter().filter(|failure| !skipped.iter().any(|index| failure.contains(&format!("шаг {index} ")))).collect()
    })
    .await;
    let shown: Vec<&String> = failures.iter().take(40).collect();
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), shown.iter().map(|item| item.as_str()).collect::<Vec<_>>().join("\n\n"));
}
