//! Паритет правок с 1.x: `fixtures/edit-parity.json` записан настоящим `electron/ciEdit.cjs` (см. `fixtures/gen-edit-parity.cjs`).
//!
//! Сравниваются коды и тексты ошибок, заметки и данные результата. Текст результата может отличаться: см. шапку `edit/ops.rs`. Отказ там, где 1.x справился, допустим только в [`allowed_refusal`].
//!
//! Настоящие файлы: `node crates/gorynych-ci-linter/tests/fixtures/gen-edit-parity.cjs <выход.json> <папка>`, затем
//! `GORYNYCH_EDIT_CORPUS=<выход.json> cargo test -p gorynych-ci-linter --test edit_parity -- --ignored --nocapture`.

use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_ci_linter::edit::file::{CiSaveRequest, create_from_template, diff_draft, read_file, save_file};
use gorynych_ci_linter::edit::{CiEditOp, apply_edit};
use gorynych_ci_linter::yaml::{Document, Schema, Value};
use gorynych_core::Language;
use serde_json::{Value as Json, json};

static FIXTURE: LazyLock<Json> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/edit-parity.json")).expect("корректный JSON"));

fn language_of(case: &Json) -> Language {
    if case["language"] == "en" { Language::En } else { Language::Ru }
}

fn to_json(value: &Value) -> Json {
    serde_json::to_value(value).unwrap()
}

/// Числа как f64; порядок ключей значим.
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(a), Json::Number(b)) => a.as_f64() == b.as_f64(),
        (Json::Array(a), Json::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b)),
        (Json::Object(a), Json::Object(b)) => a.len() == b.len() && a.iter().zip(b).all(|((ka, va), (kb, vb))| ka == kb && same(va, vb)),
        _ => a == b,
    }
}

fn data_of(text: &str) -> Json {
    let document = Document::parse(text);
    assert!(document.errors().is_empty(), "{:?}\n{text}", document.errors());
    to_json(&document.to_value(Schema::Plain, text).unwrap())
}

/// Пустой файл и `{}`: удаление единственного задания.
fn same_data(expected: &Json, actual: &Json) -> bool {
    let empty = |json: &Json| json.is_null() || json.as_object().is_some_and(serde_json::Map::is_empty);
    same(expected, actual) || (empty(expected) && empty(actual))
}

#[derive(Default)]
struct Report {
    total: usize,
    same_text: usize,
    refused: Vec<String>,
    failures: Vec<String>,
}

fn show(content: &str, op: &Json) -> String {
    format!("{op}\n--- файл\n{content}")
}

fn check(content: &str, case: &Json, report: &mut Report) {
    report.total += 1;
    let op: CiEditOp = serde_json::from_value(case["op"].clone()).unwrap_or_else(|error| panic!("{}: {error}", case["op"]));
    let result = apply_edit(content, &op, language_of(case));
    let name = case["name"].as_str().unwrap();
    if let Some(expected) = case.get("error").filter(|error| !error.is_null()) {
        match result {
            Err(error) => {
                // Падение 1.x без кода: здесь это отказ с кодом
                if !expected["code"].is_null() {
                    let actual = json!({"code": error.code, "message": error.message, "hint": error.hint});
                    let is_yaml_details = expected["code"] == "YAML_ERROR";
                    if actual["code"] != expected["code"] || actual["message"] != expected["message"] || (!is_yaml_details && actual["hint"] != expected["hint"]) {
                        report.failures.push(format!("{name}: ошибка 1.x {expected}, 2.0 {actual}\n{}", show(content, &case["op"])));
                    }
                }
            }
            // 1.x падал на `Unresolved alias`, если правка убирала якорь. Здесь якорь на месте, и правка возможна
            Ok(_) if expected["code"].is_null() => {}
            Ok(ok) => report.failures.push(format!("{name}: 1.x ошибка {expected}, 2.0 успех\n{}\n--- результат\n{}", show(content, &case["op"]), ok.content)),
        }
        return;
    }
    let expected = &case["ok"];
    match result {
        Err(error) => {
            let line = format!("{name}: {} — {} {}", case["op"], error.message, error.details);
            if error.code.to_string() == "YAML_ERROR" {
                report.refused.push(line);
            } else {
                report.failures.push(format!("{line}\n{}", show(content, &case["op"])));
            }
        }
        Ok(ok) => {
            if ok.notes.iter().map(|note| json!(note)).collect::<Vec<_>>() != *expected["notes"].as_array().unwrap() {
                report.failures.push(format!("{name}: заметки 1.x {}, 2.0 {:?}\n{}", expected["notes"], ok.notes, case["op"]));
            }
            if ok.content == expected["content"].as_str().unwrap() {
                report.same_text += 1;
            }
            let actual = data_of(&ok.content);
            if !same_data(&expected["data"], &actual) {
                report.failures.push(format!(
                    "{name}: данные\n  1.x {}\n  2.0 {actual}\n{}\n--- результат\n{}",
                    expected["data"],
                    show(content, &case["op"]),
                    ok.content
                ));
            }
        }
    }
}

fn assert_clean(report: &Report, allowed_refusals: &[&str]) {
    let shown: Vec<&String> = report.failures.iter().take(12).collect();
    let unexpected: Vec<&String> = report.refused.iter().filter(|line| !allowed_refusals.iter().any(|allowed| line.starts_with(allowed))).collect();
    let refused: Vec<&&String> = unexpected.iter().take(30).collect();
    eprintln!("правок {}, текст совпал {}, отказов {} (неожиданных {}), расхождений {}", report.total, report.same_text, report.refused.len(), unexpected.len(), report.failures.len());
    assert!(report.failures.is_empty() && unexpected.is_empty(), "расхождения:\n{shown:#?}\nотказы:\n{refused:#?}");
}

fn run_cases(fixture: &Json) -> Report {
    let documents = fixture["documents"].as_object().unwrap();
    let mut report = Report::default();
    for case in fixture["cases"].as_array().unwrap() {
        let content = documents[case["name"].as_str().unwrap()].as_str().unwrap();
        check(content, case, &mut report);
    }
    report
}

/// Отказы там, где 1.x справлялся: разбор — в шапке `edit/ops.rs`.
const ALLOWED_REFUSALS: [&str; 1] = ["повтор ключа задания"];

/// Для чтения глазами: где текст результата отличается от 1.x и в каких строках.
fn text_differences(fixture: &Json) -> String {
    let documents = fixture["documents"].as_object().unwrap();
    let mut out = String::new();
    for case in fixture["cases"].as_array().unwrap() {
        let Some(expected) = case["ok"]["content"].as_str() else { continue };
        let content = documents[case["name"].as_str().unwrap()].as_str().unwrap();
        let op: CiEditOp = serde_json::from_value(case["op"].clone()).unwrap();
        let Ok(actual) = apply_edit(content, &op, language_of(case)) else { continue };
        if actual.content == expected {
            continue;
        }
        let (old, new): (Vec<&str>, Vec<&str>) = (expected.split('\n').collect(), actual.content.split('\n').collect());
        let only_old: Vec<&&str> = old.iter().filter(|line| !new.contains(line)).take(8).collect();
        let only_new: Vec<&&str> = new.iter().filter(|line| !old.contains(line)).take(8).collect();
        out.push_str(&format!("{} {}\n  1.x: {only_old:?}\n  2.0: {only_new:?}\n", case["name"], case["op"]));
        // Те же строки в другом порядке: нужно видеть текст целиком
        if only_old.is_empty() && only_new.is_empty() && expected.len() < 1500 {
            out.push_str(&format!("=== 1.x\n{expected}\n=== 2.0\n{}\n=== конец\n", actual.content));
        }
    }
    out
}

#[test]
fn written_text_differences_can_be_dumped() {
    if let Ok(path) = std::env::var("GORYNYCH_EDIT_TEXT_DIFFS") {
        fs::write(path, text_differences(&FIXTURE)).unwrap();
    }
}

#[test]
fn matches_electron_on_written_cases() {
    let report = run_cases(&FIXTURE);
    assert!(report.total > 2000, "{}", report.total);
    assert_clean(&report, &ALLOWED_REFUSALS);
}

#[test]
#[ignore = "нужен внешний корпус, см. шапку файла"]
fn edit_corpus() {
    let file = std::env::var("GORYNYCH_EDIT_CORPUS").expect("GORYNYCH_EDIT_CORPUS");
    let corpus: Json = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    let report = run_cases(&corpus);
    if let Ok(path) = std::env::var("GORYNYCH_EDIT_TEXT_DIFFS") {
        fs::write(path, text_differences(&corpus)).unwrap();
    }
    assert_clean(&report, &ALLOWED_REFUSALS);
}

/* ------------------------------------- Файлы ------------------------------------- */

fn seed(repo: &Path) {
    fs::write(repo.join("lf.yml"), "a: 1\nb: 2\n").unwrap();
    fs::write(repo.join("crlf.yml"), "a: 1\r\nb: 2\r\n").unwrap();
    fs::write(repo.join("bom.yml"), "\u{FEFF}a: 1\n").unwrap();
    fs::write(repo.join("bad.yml"), [0x61, 0xff, 0x0a]).unwrap();
}

fn listing(repo: &Path, rel: &str, out: &mut Vec<(String, Vec<u8>)>) {
    for entry in fs::read_dir(repo.join(rel)).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        if entry.file_type().unwrap().is_dir() {
            listing(repo, &child, out);
        } else {
            out.push((child.clone(), fs::read(repo.join(&child)).unwrap()));
        }
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

fn sha1_of(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    Sha1::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn file_operations_match_electron() {
    let scenarios = FIXTURE["scenarios"].as_object().unwrap();
    let mut failures = Vec::new();
    for case in FIXTURE["files"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let language = language_of(case);
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        seed(&repo);
        let actual: Result<Json, gorynych_core::GorynychError> = if name == "template существует" {
            fs::write(repo.join(".gitlab-ci.yml"), "x").unwrap();
            create_from_template(&repo, "gitlab", language).map(|saved| serde_json::to_value(saved).unwrap())
        } else {
            let scenario = &scenarios[name];
            if let Some(rel) = scenario["read"].as_str() {
                read_file(&repo, rel, language).map(|file| serde_json::to_value(file).unwrap())
            } else if let Some(system) = scenario["template"].as_str() {
                create_from_template(&repo, system, language).map(|saved| serde_json::to_value(saved).unwrap())
            } else if scenario["diff"].is_object() {
                diff_draft(&repo, scenario["diff"]["path"].as_str().unwrap(), scenario["diff"]["content"].as_str().unwrap(), language).map(|diff| serde_json::to_value(diff).unwrap())
            } else {
                let mut save = scenario["save"].clone();
                if let Some(count) = save.get("repeat").and_then(Json::as_u64) {
                    let text = save["char"].as_str().unwrap().repeat(count as usize);
                    save["content"] = json!(text);
                }
                let request: CiSaveRequest = serde_json::from_value(save).unwrap();
                save_file(&repo, &request, language).map(|saved| serde_json::to_value(saved).unwrap())
            }
        };
        let label = format!("{name} [{}]", case["language"]);
        match (actual, case.get("error").filter(|error| !error.is_null())) {
            (Ok(actual), None) => {
                if actual != case["ok"] {
                    failures.push(format!("{label}:\n  1.x {}\n  2.0 {actual}", case["ok"]));
                }
            }
            (Err(error), Some(expected)) => {
                let actual = json!({"code": error.code, "message": error.message, "hint": error.hint});
                if actual != *expected {
                    failures.push(format!("{label}:\n  1.x {expected}\n  2.0 {actual}"));
                }
            }
            (actual, expected) => failures.push(format!("{label}: 1.x {expected:?} {}, 2.0 {:?}", case["ok"], actual.map_err(|error| error.message))),
        }
        let mut files = Vec::new();
        listing(&repo, "", &mut files);
        let after = case["after"].as_object().unwrap();
        if files.len() != after.len() {
            failures.push(format!("{label}: файлы 1.x {:?}, 2.0 {:?}", after.keys().collect::<Vec<_>>(), files.iter().map(|file| &file.0).collect::<Vec<_>>()));
        }
        for (path, bytes) in files {
            let matches = match &after.get(&path) {
                Some(Json::String(text)) => decode_base64(text) == bytes,
                Some(other) => other["sha"].as_str() == Some(sha1_of(&bytes).as_str()),
                None => false,
            };
            if !matches {
                failures.push(format!("{label}: содержимое {path}"));
            }
        }
    }
    assert!(failures.is_empty(), "расхождений {}:\n{}", failures.len(), failures.join("\n"));
}

/* ------------------------------- Форма результата --------------------------------- */

fn edit(content: &str, op: Json) -> String {
    apply_edit(content, &serde_json::from_value(op).unwrap(), Language::Ru).unwrap().content
}

#[test]
fn untouched_lines_and_comments_survive() {
    let file = "# шапка\nstages: [ a , b ]  # этапы\n\n# о задании\nj: # у ключа\n    stage: a # этап\n    script:\n        - x # шаг\n";
    assert_eq!(
        edit(file, json!({"type": "renameJob", "from": "j", "to": "k"})),
        "# шапка\nstages: [ a , b ]  # этапы\n\n# о задании\nk: # у ключа\n    stage: a # этап\n    script:\n        - x # шаг\n"
    );
    assert_eq!(
        edit(file, json!({"type": "setJob", "name": "j", "fields": {"stage": "b"}})),
        "# шапка\nstages: [ a , b ]  # этапы\n\n# о задании\nj: # у ключа\n    stage: b # этап\n    script:\n        - x # шаг\n"
    );
    assert_eq!(
        edit(file, json!({"type": "setJob", "name": "j", "fields": {"image": "i"}})),
        "# шапка\nstages: [ a , b ]  # этапы\n\n# о задании\nj: # у ключа\n    stage: a # этап\n    script:\n        - x # шаг\n    image: i\n"
    );
    assert_eq!(
        edit(file, json!({"type": "addStage", "name": "c"})),
        "# шапка\nstages: [ a , b, c ]  # этапы\n\n# о задании\nj: # у ключа\n    stage: a # этап\n    script:\n        - x # шаг\n"
    );
}

#[test]
fn file_comment_stays_apart_from_a_new_key() {
    assert_eq!(edit("# о файле\n", json!({"type": "addJob", "name": "j", "script": "x"})), "# о файле\n\nj:\n  stage: test\n  script:\n    - x\n");
}

#[test]
fn refusal_is_translated() {
    let file = ".t: &t\n  script: x\nj:\n  <<: *t\n";
    let error = apply_edit(file, &serde_json::from_value(json!({"type": "deleteJob", "name": ".t"})).unwrap(), Language::En).unwrap_err();
    assert_eq!(error.message, "Couldn't apply the edit without rewriting the file");
    assert_eq!(error.hint.as_deref(), Some("Make this change by hand in the File tab"));
}

#[test]
fn types_export_with_1x_field_names() {
    use gorynych_ci_linter::edit::CiEditResult;
    use gorynych_ci_linter::edit::file::{CiDraftDiff, CiFileContent, CiSaved};
    let types = specta::Types::default()
        .register::<CiEditOp>()
        .register::<CiEditResult>()
        .register::<CiSaveRequest>()
        .register::<CiSaved>()
        .register::<CiFileContent>()
        .register::<CiDraftDiff>();
    let ts = specta_typescript::Typescript::default().export(&types, specta_serde::PhasesFormat).expect("типы экспортируются в TypeScript");
    for field in ["addJob", "setJob", "moveStage", "baseHash", "notes", "exists", "hunks"] {
        assert!(ts.contains(field), "нет {field} в\n{ts}");
    }
}

#[test]
fn deleting_a_job_takes_its_comment_and_blank_line() {
    let file = "a:\n  script: x\n\n# о b\nb:\n  script: y\n  needs: [a]\n\n# о c\nc:\n  needs: [b, a]\n  script: z\n";
    assert_eq!(edit(file, json!({"type": "deleteJob", "name": "b"})), "a:\n  script: x\n\n# о c\nc:\n  needs: [a]\n  script: z\n");
}

#[test]
fn deleting_an_anchored_job_with_aliases_is_refused_with_a_code() {
    let file = ".t: &t\n  script: x\nj:\n  <<: *t\n";
    let error = apply_edit(file, &serde_json::from_value(json!({"type": "deleteJob", "name": ".t"})).unwrap(), Language::Ru).unwrap_err();
    assert_eq!(error.code.to_string(), "YAML_ERROR");
    assert!(error.hint.is_some());
}

#[test]
fn editing_an_anchored_template_keeps_aliases() {
    let file = ".t: &t\n  script: x\nj:\n  <<: *t\n";
    assert_eq!(edit(file, json!({"type": "setJob", "name": ".t", "fields": {"script": ["y"]}})), ".t: &t\n  script:\n    - y\nj:\n  <<: *t\n");
}
