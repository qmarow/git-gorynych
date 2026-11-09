//! Паритет проверки конфигурации с 1.x: `fixtures/check-parity.json` записан настоящим `checkCi` (см. `fixtures/gen-check-parity.cjs`).
//!
//! Подмены значений и настоящие файлы: `node crates/gorynych-ci-linter/tests/fixtures/gen-check-parity.cjs <выход.json> [папка]`, затем
//! `GORYNYCH_CHECK_CORPUS=<выход.json> cargo test -p gorynych-ci-linter --test check_parity -- --ignored --nocapture`.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::LazyLock;

use gorynych_ci_linter::load::{LS_FILES_ARGS, ORIGIN_HEAD_ARGS, REFS_ARGS, preview_ci};
use gorynych_ci_linter::repo::RepoView;
use gorynych_core::Language;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use serde_json::{Value as Json, json};

static FIXTURE: LazyLock<Json> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/check-parity.json")).expect("корректный JSON"));

struct NoRepo;

impl RepoView for NoRepo {
    fn staged_diff(&self) -> Result<String> {
        Ok(String::new())
    }
    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }
    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }
    fn ls_files(&self) -> Result<String> {
        Ok(String::new())
    }
    fn refs(&self) -> Result<String> {
        Ok(String::new())
    }
    fn origin_head(&self) -> Result<String> {
        Ok(String::new())
    }
    fn verify_branch(&self, _branch: &str) -> Result<String> {
        Ok(String::new())
    }
}

fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
        .args(args)
        .output()
        .unwrap()
}

struct RealRepo<'a>(&'a Path);

impl RealRepo<'_> {
    fn run(&self, args: &[&str]) -> Result<String> {
        let output = git(self.0, args);
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        Err(GorynychError::new(ErrorCode::Git, "git"))
    }
}

impl RepoView for RealRepo<'_> {
    fn staged_diff(&self) -> Result<String> {
        unreachable!()
    }
    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        unreachable!()
    }
    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        unreachable!()
    }
    fn ls_files(&self) -> Result<String> {
        self.run(&LS_FILES_ARGS)
    }
    fn refs(&self) -> Result<String> {
        self.run(&REFS_ARGS)
    }
    fn origin_head(&self) -> Result<String> {
        self.run(&ORIGIN_HEAD_ARGS)
    }
    fn verify_branch(&self, branch: &str) -> Result<String> {
        self.run(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
    }
}

fn decode_base64(text: &str) -> Vec<u8> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut bits, mut count) = (0u32, 0);
    for byte in text.bytes().filter(|byte| *byte != b'=') {
        bits = (bits << 6) | TABLE.iter().position(|item| *item == byte).unwrap() as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    out
}

fn write_files(repo: &Path, files: &serde_json::Map<String, Json>) {
    for (rel, content) in files {
        let full = repo.join(rel);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        match content {
            Json::String(text) => fs::write(&full, text).unwrap(),
            other => {
                if let Some(size) = other["big"].as_u64() {
                    fs::write(&full, format!("# {}\n", "x".repeat(size as usize - 3))).unwrap();
                } else {
                    fs::write(&full, decode_base64(other["base64"].as_str().unwrap())).unwrap();
                }
            }
        }
    }
}

/// Отличие от 1.x, см. шапку `check/base.rs`: текст ошибки регулярки от `regress`, а не от V8.
fn same_issue_text(expected: &str, actual: &str) -> bool {
    expected == actual || expected.contains("Invalid regular expression:")
}

/// Отличие от 1.x, см. шапку `check/other.rs`: лимит алиасов у CircleCI и Azure.
fn hits_alias_limit(check: &Json) -> bool {
    check["issues"].as_array().is_some_and(|issues| issues.iter().any(|issue| issue["id"] == "check-failed" && issue["why"].as_str().is_some_and(|why| why.contains("Excessive alias count"))))
}

/// Исправлено в 2.x по решению пользователя, см. шапку `check/gitlab/mod.rs`: 1.x прерывал проверку GitLab на переменной из файла в
/// `workflow:rules` (`ReferenceError` про `yamlVars`). Сравнивать в таких случаях не с чем: 2.0 обязан пройти проверку до конца.
fn hits_yaml_vars_bug(check: &Json) -> bool {
    check["issues"].as_array().is_some_and(|issues| issues.iter().any(|issue| issue["id"] == "check-failed" && issue["why"].as_str().is_some_and(|why| why.contains("yamlVars"))))
}

fn first_difference(path: &str, expected: &Json, actual: &Json) -> Option<String> {
    match (expected, actual) {
        (Json::Object(a), Json::Object(b)) => {
            for (key, value) in a {
                let other = b.get(key).unwrap_or(&Json::Null);
                if let Some(found) = first_difference(&format!("{path}.{key}"), value, other) {
                    return Some(found);
                }
            }
            b.iter().find(|(key, value)| !a.contains_key(*key) && !value.is_null()).map(|(key, value)| format!("{path}.{key}: 1.x нет, 2.0 {value}"))
        }
        (Json::Array(a), Json::Array(b)) => {
            for (index, (x, y)) in a.iter().zip(b).enumerate() {
                if let Some(found) = first_difference(&format!("{path}[{index}]"), x, y) {
                    return Some(found);
                }
            }
            (a.len() != b.len()).then(|| {
                let longer = if a.len() > b.len() { a } else { b };
                let extra: Vec<String> = longer.iter().skip(a.len().min(b.len())).take(4).map(|item| format!("{} / {}", item["id"], item["title"])).collect();
                format!("{path}: длина 1.x {}, 2.0 {}; лишние: {extra:?}", a.len(), b.len())
            })
        }
        (Json::Number(a), Json::Number(b)) if a.as_f64() == b.as_f64() => None,
        (Json::String(a), Json::String(b)) if same_issue_text(a, b) => None,
        _ if expected == actual => None,
        _ => Some(format!("{path}:\n    1.x {expected}\n    2.0 {actual}")),
    }
}

fn run_case(case: &Json) -> Option<String> {
    if hits_alias_limit(&case["check"]) && matches!(case["system"].as_str(), Some("circleci" | "azure")) {
        return None;
    }
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    write_files(&repo, case["files"].as_object().unwrap());
    let language = if case["language"] == "en" { Language::En } else { Language::Ru };
    let drafts: HashMap<String, String> = case
        .get("drafts")
        .and_then(Json::as_object)
        .map(|map| map.iter().map(|(key, value)| (key.clone(), value.as_str().unwrap().to_owned())).collect())
        .unwrap_or_default();
    let request = case["request"].as_str().unwrap_or_default();
    let loaded = if case["git"].is_object() {
        let setup = &case["git"];
        git(&repo, &["init", "-q", "-b", setup["branch"].as_str().unwrap_or("main")]);
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-q", "--allow-empty", "-m", "x"]);
        for rel in setup["executable"].as_array().into_iter().flatten() {
            git(&repo, &["update-index", "--chmod=+x", rel.as_str().unwrap()]);
        }
        for name in setup["branches"].as_array().into_iter().flatten() {
            git(&repo, &["branch", name.as_str().unwrap()]);
        }
        preview_ci(&repo, request, language, &drafts, &RealRepo(&repo))
    } else {
        preview_ci(&repo, request, language, &drafts, &NoRepo)
    };
    let name = format!("{} [{}]", case["name"].as_str().unwrap(), case["language"]);
    let Some(current) = loaded.load.current else {
        return (!case["check"].is_null()).then(|| format!("{name}: нет результата"));
    };
    let mut actual = serde_json::to_value(&current.check).unwrap();
    actual.as_object_mut().unwrap().remove("ms");
    if hits_yaml_vars_bug(&case["check"]) {
        let failed = actual["issues"].as_array().unwrap().iter().any(|issue| issue["id"] == "check-failed");
        return failed.then(|| format!("{name}: проверка прервалась, а в 2.x ошибка 1.x исправлена: {actual}"));
    }
    if case["loose"] == json!(true) {
        // Текст ошибки YAML другой, а данные только до неё: см. шапку `yaml.rs`
        let has_yaml = |json: &Json| json["issues"].as_array().unwrap().iter().any(|issue| issue["id"] == "yaml-syntax");
        return (!has_yaml(&actual)).then(|| format!("{name}: нет yaml-syntax"));
    }
    first_difference("", &case["check"], &actual).map(|found| format!("{name}{found}"))
}

fn run_all(cases: &[Json]) -> usize {
    let failures: Vec<String> = cases.iter().filter_map(run_case).collect();
    let shown: Vec<String> = failures.iter().take(30).cloned().collect();
    assert!(failures.is_empty(), "расхождений {} из {}:\n{}", failures.len(), cases.len(), shown.join("\n"));
    cases.len()
}

/// Исправленная ошибка 1.x: переменная из файла в `workflow:rules` больше не прерывает проверку, а неизвестная разбирается как в заданиях.
#[test]
fn workflow_rules_see_file_variables() {
    let temp = tempfile::tempdir().unwrap();
    let text = "variables:\n  DEPLOY: \"1\"\nworkflow:\n  rules:\n    - if: $DEPLOY == \"1\"\n    - if: $CI_COMMIT_BRANH\nbuild:\n  script: [make]\n";
    fs::write(temp.path().join(".gitlab-ci.yml"), text).unwrap();
    let loaded = preview_ci(temp.path(), "", Language::Ru, &HashMap::new(), &NoRepo);
    let check = serde_json::to_value(&loaded.load.current.unwrap().check).unwrap();
    let ids: Vec<&str> = check["issues"].as_array().unwrap().iter().map(|issue| issue["id"].as_str().unwrap()).collect();
    assert!(!ids.contains(&"check-failed"), "{check}");
    let unknown: Vec<&Json> = check["issues"].as_array().unwrap().iter().filter(|issue| issue["id"] == "var-unknown-predefined").collect();
    assert_eq!(unknown.len(), 1, "$DEPLOY объявлена в файле, $CI_COMMIT_BRANH — опечатка: {check}");
    assert!(unknown[0]["title"].as_str().unwrap().contains("CI_COMMIT_BRANH"), "{check}");
    assert!(check["scenarios"].as_array().is_some_and(|list| !list.is_empty()), "сценарии посчитаны: {check}");
}

#[test]
fn matches_electron_on_written_cases() {
    assert!(run_all(FIXTURE["cases"].as_array().unwrap()) > 100);
}

#[test]
fn matches_electron_on_odd_values() {
    assert!(run_all(FIXTURE["mutated"].as_array().unwrap()) > 100);
}

#[test]
#[ignore = "нужен внешний корпус, см. шапку файла"]
fn check_corpus() {
    let file = std::env::var("GORYNYCH_CHECK_CORPUS").expect("GORYNYCH_CHECK_CORPUS");
    let corpus: Json = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    run_all(corpus["cases"].as_array().unwrap());
}

#[test]
fn runner_tags_match_electron() {
    use gorynych_ci_linter::check::tags::{RunnerInfo, check_runner_tags};
    let cases = FIXTURE["tags"].as_array().unwrap();
    assert!(cases.len() > 50, "{}", cases.len());
    let mut seen = std::collections::HashSet::new();
    let mut failures = Vec::new();
    for case in cases {
        let temp = tempfile::tempdir().unwrap();
        write_files(temp.path(), case["files"].as_object().unwrap());
        let language = if case["language"] == "en" { Language::En } else { Language::Ru };
        let loaded = preview_ci(temp.path(), "", language, &HashMap::new(), &NoRepo);
        let runners: Vec<RunnerInfo> = case["runners"]
            .as_array()
            .unwrap()
            .iter()
            .map(|runner| RunnerInfo {
                name: runner["name"].as_str().unwrap().to_owned(),
                status: runner["status"].as_str().unwrap().to_owned(),
                labels: runner["labels"].as_array().unwrap().iter().map(|label| label.as_str().unwrap().to_owned()).collect(),
                run_untagged: runner["runUntagged"].as_bool(),
            })
            .collect();
        let issues = check_runner_tags(loaded.load.current.as_ref().unwrap(), &runners, language);
        let actual = serde_json::to_value(&issues).unwrap();
        for issue in actual.as_array().unwrap() {
            seen.insert(issue["id"].as_str().unwrap().to_owned());
        }
        if let Some(found) = first_difference("", &case["issues"], &actual) {
            failures.push(format!("{} [{}]{found}", case["name"], case["language"]));
        }
    }
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), failures.iter().take(12).cloned().collect::<Vec<_>>().join("\n"));
    assert!(seen.contains("runner-untagged") && seen.contains("runner-tags-missing"), "{seen:?}");
}

/// Ключи, которых нет в словаре и в 1.x: там такие строки тоже показываются по-русски.
const ALLOWED_MISSING_KEYS: [&str; 0] = [];

/// Каждый ключ перевода в коде проверки есть в словаре: опечатка в русском тексте иначе дала бы молча непереведённую строку.
#[test]
fn every_translation_key_exists() {
    let dictionary: Json = serde_json::from_str(include_str!("../../../electron/i18n/en.json")).unwrap();
    let dictionary = dictionary.as_object().unwrap();
    let source_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/check");
    let mut missing = Vec::new();
    let mut sources = Vec::new();
    for entry in fs::read_dir(&source_dir).unwrap().flatten().chain(fs::read_dir(source_dir.join("gitlab")).unwrap().flatten()) {
        if entry.path().is_file() {
            sources.push(fs::read_to_string(entry.path()).unwrap());
        }
    }
    for text in &sources {
        let mut rest = text.as_str();
        while let Some(at) = rest.find("tr!(\"") {
            rest = &rest[at + 5..];
            let mut key = String::new();
            let mut chars = rest.chars();
            while let Some(c) = chars.next() {
                match c {
                    '"' => break,
                    '\\' => match chars.next() {
                        Some('n') => key.push('\n'),
                        Some(other) => key.push(other),
                        None => {}
                    },
                    other => key.push(other),
                }
            }
            if !dictionary.contains_key(&key) {
                missing.push(key);
            }
        }
    }
    missing.retain(|key| !ALLOWED_MISSING_KEYS.contains(&key.as_str()));
    assert!(missing.is_empty(), "нет в словаре ({}):\n{}", missing.len(), missing.join("\n"));
}
