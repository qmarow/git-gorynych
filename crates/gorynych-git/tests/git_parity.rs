//! Сверка с настоящим `electron/git.cjs` на настоящих репозиториях. Эталон: `node crates/gorynych-git/tests/fixtures/gen-git-parity.cjs`.
//! Даты в окружении фиксированы, поэтому хэши на обеих сторонах одинаковы. `null` и отсутствие поля считаются одним и тем же.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use gorynych_core::error::Result;
use gorynych_core::i18n;
use gorynych_git::compare::*;
use gorynych_git::conflicts::*;
use gorynych_git::diff::{FileDiffRequest, get_file_diff, parse_unified_diff};
use gorynych_git::history::*;
use gorynych_git::read::*;
use gorynych_git::write::*;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn run(cwd: &Path, args: &[&str], allow_fail: bool) -> String {
    let output = Command::new("git").current_dir(cwd).args(args).output().unwrap();
    assert!(allow_fail || output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn text_of(value: &Value) -> &str {
    value.as_str().unwrap()
}

fn prepare(case: &Value, root: &Path) {
    if case.get("noGit").is_none() {
        run(root, &["init", "-q", "-b", "main"], false);
    }
    for op in case["setup"].as_array().unwrap() {
        let op = op.as_array().unwrap();
        let args: Vec<&str> = op[1..].iter().filter_map(Value::as_str).collect();
        let write = |rel: &str, bytes: &[u8]| {
            let full = root.join(rel);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, bytes).unwrap();
        };
        match text_of(&op[0]) {
            "git" => {
                run(root, &args, false);
            }
            "gitFail" => {
                run(root, &args, true);
            }
            "gitIn" => {
                run(&root.join(args[0]), &args[1..], false);
            }
            "write" => write(args[0], args[1].as_bytes()),
            "writeBytes" => write(args[0], &op[2].as_array().unwrap().iter().map(|byte| byte.as_u64().unwrap() as u8).collect::<Vec<u8>>()),
            "writeRepeat" => write(args[0], args[1].repeat(op[3].as_u64().unwrap() as usize).as_bytes()),
            "writeMany" => {
                for index in 0..op[2].as_u64().unwrap() {
                    write(&format!("{}/f{index:04}.txt", args[0]), b"a\nb\n");
                }
            }
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

fn paths(step: &Value) -> PathsArg {
    serde_json::from_value(step["paths"].clone()).unwrap()
}

async fn call(step: &Value, root: &Path) -> Value {
    let hash = step["hash"].as_str().unwrap_or_default();
    match step["call"].as_str().unwrap() {
        "root" => to_json(resolve_repo_root(root).await.map(|path| path.display().to_string())),
        "hasHead" => json!({ "ok": has_head(root).await }),
        "op" => json!({ "ok": detect_operation(root).await }),
        "refs" => to_json(read_refs(root).await),
        "load" => to_json(load_repository(root, step["limit"].as_u64().map(|limit| limit as u32)).await),
        "quick" => to_json(quick_status(root).await),
        "status" => to_json(read_status(root, step["stats"] == json!(true)).await),
        "commitFiles" => to_json(get_commit_files(root, hash, step["parent"].as_str()).await),
        "stash" => to_json(get_stash_details(root, hash).await),
        "fileDiff" => to_json(get_file_diff(root, &arg::<FileDiffRequest>(step, "params")).await),
        "stage" => to_json(stage(root, &paths(step)).await),
        "unstage" => to_json(unstage(root, &paths(step)).await),
        "commit" => to_json(commit(root, step["summary"].as_str().unwrap_or_default(), step["description"].as_str()).await),
        "template" => json!({ "ok": read_commit_template(root).await }),
        "configThenTemplate" => {
            run(root, &["config", text_of(&step["key"]), text_of(&step["value"])], false);
            run(root, &["config", "commit.template", text_of(&step["file"])], false);
            json!({ "ok": read_commit_template(root).await })
        }
        "branchLog" => to_json(branch_log(root, &arg::<BranchLogRequest>(step, "params")).await),
        "getConflict" => to_json(get_conflict(root, step["file"].as_str().unwrap_or_default()).await),
        "parseConflict" => json!({ "ok": parse_conflict_text(text_of(&step["text"])) }),
        "saveResolution" => to_json(save_resolution(root, &arg::<SaveResolution>(step, "params")).await),
        "resolveWhole" => to_json(resolve_whole(root, &arg::<ResolveWhole>(step, "params")).await),
        "markResolved" => to_json(mark_resolved(root, &arg::<MarkResolved>(step, "params")).await),
        "fileHistory" => to_json(file_history(root, &arg::<FileHistoryRequest>(step, "params")).await),
        "blame" => to_json(blame(root, &arg::<BlameRequest>(step, "params")).await),
        "commitInfo" => to_json(commit_info(root, &arg::<CommitInfoRequest>(step, "params")).await),
        "compare" => to_json(compare_commits(root, step["params"]["a"].as_str(), step["params"]["b"].as_str()).await),
        "searchChanges" => to_json(search_changes(root, &arg::<SearchChanges>(step, "params")).await),
        "searchHistory" => to_json(search_history(root, &arg::<SearchHistory>(step, "params")).await),
        "parseDiff" => json!({ "ok": parse_unified_diff(text_of(&step["text"])) }),
        "parseNumstat" => json!({ "ok": parse_numstat(text_of(&step["text"])) }),
        "cleanTemplate" => {
            let (body, hint) = clean_commit_template(text_of(&step["text"]), text_of(&step["comment"]).chars().next());
            json!({ "ok": { "body": body, "hint": hint } })
        }
        other => panic!("нет вызова {other}"),
    }
}

fn canon(value: &Value) -> Value {
    match value {
        // У незакоммиченных строк blame git подставляет текущее время
        Value::Object(map) => {
            let now = map.get("uncommitted") == Some(&json!(true));
            Value::Object(map.iter().filter(|(key, item)| !item.is_null() && !(now && *key == "time")).map(|(key, item)| (key.clone(), canon(item))).collect())
        }
        Value::Array(list) => Value::Array(list.iter().map(canon).collect()),
        Value::Number(number) => json!(number.as_f64().unwrap_or(0.0)),
        other => other.clone(),
    }
}

fn expand_revs(step: &Value, root: &Path) -> Value {
    let pattern = regex::Regex::new(r#"\{\{rev:([^"]*?)\}\}"#).unwrap();
    let text = step.to_string();
    let out = pattern.replace_all(&text, |caps: &regex::Captures<'_>| run(root, &["rev-parse", &caps[1]], false).trim().to_owned());
    serde_json::from_str(&out).unwrap()
}

async fn run_case(case: Value) -> Vec<String> {
    let temp = tempfile::Builder::new().prefix("git-parity-").tempdir().unwrap();
    let tmp: PathBuf = temp.path().to_path_buf();
    let root = tmp.join("репо");
    std::fs::create_dir(&root).unwrap();
    prepare(&case, &root);
    std::fs::create_dir_all(root.join("папка")).unwrap();
    let mut failures = Vec::new();
    for (index, (step, want)) in case["steps"].as_array().unwrap().iter().zip(case["expected"].as_array().unwrap()).enumerate() {
        let args = expand_revs(step, &root);
        let got = call(&args, &root).await;
        let text = got.to_string().replace(&tmp.display().to_string().replace('\\', "\\\\"), "{{TMP}}").replace(&tmp.display().to_string().replace('\\', "/"), "{{TMP}}");
        let (mut a, mut b) = (canon(&serde_json::from_str(&text).unwrap()), canon(want));
        if step.get("looseError") == Some(&json!(true)) {
            for out in [&mut a, &mut b] {
                if let Some(message) = out.pointer_mut("/error/message") {
                    *message = json!("");
                }
            }
        }
        if step.get("codeOnly") == Some(&json!(true)) {
            for out in [&mut a, &mut b] {
                for key in ["/error/message", "/error/details"] {
                    if let Some(text) = out.pointer_mut(key) {
                        *text = json!("");
                    }
                }
            }
        }
        if step.get("looseHint") == Some(&json!(true)) {
            for out in [&mut a, &mut b] {
                if let Some(hint) = out.pointer_mut("/error/hint") {
                    *hint = json!("");
                }
            }
        }
        if a != b {
            let (x, y) = (a.to_string(), b.to_string());
            let at = x.chars().zip(y.chars()).take_while(|(l, r)| l == r).count();
            let window = |s: &str| s.chars().skip(at.saturating_sub(80)).take(420).collect::<String>();
            failures.push(format!("{} [{}] шаг {index} {}\n  rust: {}\n  1.x:  {}", case["name"], case["language"], step.to_string().chars().take(160).collect::<String>(), window(&x), window(&y)));
        }
    }
    failures
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn matches_the_real_1x_module() {
    // SAFETY: в этом файле один тест, и окружение меняется до запуска дочерних задач и процессов.
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
        // Файла нет: git считает конфигурацию пустой
        std::env::set_var("GIT_CONFIG_GLOBAL", std::env::temp_dir().join("gorynych-no-gitconfig"));
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/git-parity.json");
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let filter = std::env::var("GORYNYCH_GIT_CASE").unwrap_or_default();
    let mut failures = Vec::new();
    for language in ["ru", "en"] {
        i18n::set_language(language);
        let limit = Arc::new(tokio::sync::Semaphore::new(6));
        let mut tasks = tokio::task::JoinSet::new();
        for case in data["cases"].as_array().unwrap().iter().filter(|case| case["language"] == language && case["name"].as_str().unwrap().contains(&filter)) {
            let (case, limit) = (case.clone(), limit.clone());
            tasks.spawn(async move {
                let _slot = limit.acquire_owned().await.unwrap();
                run_case(case).await
            });
        }
        while let Some(found) = tasks.join_next().await {
            failures.extend(found.unwrap());
        }
    }
    i18n::set_language("ru");
    let shown: Vec<&str> = failures.iter().take(25).map(String::as_str).collect();
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), shown.join("\n\n"));
}
