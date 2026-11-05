//! Паритет с 1.x: `fixtures/yaml-parity.json` записан настоящими `parseYaml` и `Positions` (см. `fixtures/gen-yaml-parity.cjs`).
//!
//! Внешний корпус (настоящие CI-файлы, YAML Test Suite) в репозиторий не входит:
//! `node crates/gorynych-ci-linter/tests/fixtures/gen-yaml-parity.cjs <выход.json> <папка>…`, затем
//! `GORYNYCH_YAML_CORPUS=<выход.json> cargo test -p gorynych-ci-linter --test yaml_parity -- --ignored --nocapture`.

use std::collections::HashMap;
use std::sync::LazyLock;

use gorynych_ci_linter::yaml::{Document, PathItem, Schema, Value, parse_yaml};
use serde_json::{Value as Json, json};

static FIXTURE: LazyLock<Json> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/yaml-parity.json")).expect("корректный JSON"));

/// Как `JSON.stringify` с особыми числами из эталона.
fn to_json(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(value) => json!(value),
        Value::Number(value) if value.is_nan() => json!("$nan"),
        Value::Number(value) if value.is_infinite() => json!(if *value > 0.0 { "$inf" } else { "$-inf" }),
        Value::Number(value) => json!(value),
        Value::String(value) => json!(value),
        Value::Seq(items) => Json::Array(items.iter().map(to_json).collect()),
        Value::Map(map) => Json::Object(map.iter().map(|(key, value)| (key.clone(), to_json(value))).collect()),
    }
}

/// Сравнение с учётом порядка ключей; числа — как f64 (в JSON `1` и `1.0` одно и то же).
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(a), Json::Number(b)) => a.as_f64() == b.as_f64(),
        (Json::Array(a), Json::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b)),
        (Json::Object(a), Json::Object(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|((ka, va), (kb, vb))| ka == kb && same(va, vb))
        }
        _ => a == b,
    }
}

fn path_of(items: &Json) -> Vec<PathItem> {
    items
        .as_array()
        .unwrap()
        .iter()
        .map(|item| match item {
            Json::String(key) => PathItem::Key(key.clone()),
            other => PathItem::Index(other.as_f64().unwrap() as usize),
        })
        .collect()
}

#[derive(Default)]
struct Report {
    total: usize,
    error_flag: Vec<String>,
    semantic: Vec<String>,
    data: Vec<String>,
    plain: Vec<String>,
    lines: Vec<String>,
    paths: Vec<String>,
    duplicates: Vec<String>,
    known: usize,
    with_error: usize,
    warnings: usize,
    broken_keys_1x: usize,
    broken_keys: usize,
}

fn cut(text: &str) -> String {
    text.chars().take(170).collect()
}

/// Случаи YAML Test Suite с намеренными отличиями, см. шапку `yaml.rs`: повтор `%YAML`, пустой ключ `?` в строчной записи, `!!omap`.
const EXOTIC: [&str; 4] = ["SF5V", "DFF7", "FRK4", "J7PZ"];

fn check(case: &Json, report: &mut Report, strict: bool) {
    let (name, text) = (case["name"].as_str().unwrap(), case["text"].as_str().unwrap());
    if !strict && EXOTIC.iter().any(|exotic| name.contains(exotic)) {
        return;
    }
    report.total += 1;
    report.warnings += usize::from(case["warnings"].as_u64().unwrap() > 0);
    let parsed = parse_yaml(text);
    let has_error = case["hasError"].as_bool().unwrap();
    if !parsed.errors.is_empty() != has_error {
        report.error_flag.push(format!("{name}: 1.x ошибка={has_error}, 2.0: {:?}", parsed.errors));
    }
    if let Some(expected) = case["semanticError"].as_object() {
        let message = expected["message"].as_str().unwrap();
        let line = expected["line"].as_u64().map(|line| line as u32);
        let found = parsed.errors.iter().any(|issue| issue.message == message && issue.line == line);
        // Неизвестный алиас `saphyr` находит ещё при разборе: важно, что ошибка есть
        let multi_documents = message.starts_with("Source contains multiple documents");
        if !found && !message.starts_with("Unresolved alias") && (strict || !multi_documents || parsed.errors.is_empty()) {
            report.semantic.push(format!("{name}: 1.x {expected:?}, 2.0 {:?}", parsed.errors));
        }
    }
    if has_error {
        report.with_error += 1;
        report.broken_keys_1x += case["data"].as_object().map_or(0, serde_json::Map::len);
        report.broken_keys += parsed.data.as_map().map_or(0, |map| map.len());
        return;
    }
    if !parsed.errors.is_empty() {
        return;
    }
    let document = Document::parse(text);
    // Намеренные отличия касаются только данных, позиции сравниваются всегда
    if case["known"].is_string() {
        report.known += 1;
    } else {
        let actual = to_json(&parsed.data);
        if !same(&actual, &case["data"]) {
            report.data.push(format!("{name}: 1.x {} | 2.0 {}", cut(&case["data"].to_string()), cut(&actual.to_string())));
        }
        let plain = document.to_value(Schema::Plain, text).map(|value| to_json(&value));
        match (plain, case["plain"].get("$error")) {
            (Ok(actual), None) if same(&actual, &case["plain"]) => {}
            (Err(_), Some(_)) => {}
            (actual, _) => report.plain.push(format!("{name}: 1.x {} | 2.0 {}", cut(&case["plain"].to_string()), cut(&format!("{actual:?}")))),
        }
    }
    let lines: HashMap<String, u32> = parsed.lines(text);
    let mut expected_lines: HashMap<String, u32> =
        case["lines"].as_object().unwrap().iter().map(|(key, line)| (key.clone(), line.as_u64().unwrap() as u32)).collect();
    // В 1.x ключ слияния — символ: на поиск заданий он не влияет
    if let Some(line) = expected_lines.remove("Symbol(<<)") {
        expected_lines.insert("<<".to_owned(), line);
    }
    if lines != expected_lines {
        report.lines.push(format!("{name}: 1.x {expected_lines:?} | 2.0 {lines:?}"));
    }
    for item in case["paths"].as_array().unwrap() {
        let path = path_of(&item["path"]);
        let actual = document.line(&path, text).map(u64::from);
        if actual != item["line"].as_u64() {
            report.paths.push(format!("{name}: {} 1.x {} | 2.0 {actual:?}", item["path"], item["line"]));
        }
    }
    let duplicates = serde_json::to_value(document.duplicates(text)).unwrap();
    if !same(&duplicates, &case["duplicates"]) {
        report.duplicates.push(format!("{name}: 1.x {} | 2.0 {duplicates}", case["duplicates"]));
    }
}

fn run(cases: &[Json], strict: bool) -> Report {
    let mut report = Report::default();
    for case in cases.iter().filter(|case| case.get("skipped").is_none()) {
        check(case, &mut report, strict);
    }
    report
}

fn assert_clean(report: &Report) {
    let sections = [
        ("наличие ошибки", &report.error_flag),
        ("смысловая ошибка", &report.semantic),
        ("данные", &report.data),
        ("данные без слияния", &report.plain),
        ("строки ключей", &report.lines),
        ("Positions.line", &report.paths),
        ("Positions.duplicates", &report.duplicates),
    ];
    let mut text = String::new();
    for (name, items) in sections {
        if !items.is_empty() {
            text.push_str(&format!("\n--- {name}: {}\n{}", items.len(), items.iter().take(25).cloned().collect::<Vec<_>>().join("\n")));
        }
    }
    assert!(text.is_empty(), "расхождения из {} случаев:{text}", report.total);
}

#[test]
fn matches_electron_on_written_cases() {
    let report = run(FIXTURE["cases"].as_array().unwrap(), true);
    assert!(report.total > 400, "{}", report.total);
    assert!(report.with_error > 10, "{}", report.with_error);
    assert_clean(&report);
}

#[test]
fn alias_limit_and_merge_errors_match_exactly() {
    let cases = FIXTURE["cases"].as_array().unwrap();
    let find = |name: &str| cases.iter().find(|case| case["name"] == name).unwrap();
    for name in ["бомба", "много алиасов выше лимита", "слияние не словарь", "несколько документов"] {
        assert!(find(name)["semanticError"].is_object(), "{name}: эталон не считает это ошибкой");
    }
    assert!(!find("много алиасов ниже лимита")["hasError"].as_bool().unwrap());
}

#[test]
fn broken_file_keeps_data_before_the_error() {
    let text = "stages: [build]\nbuild:\n  stage: build\ntest:\n  stage: \"незакрытая\n  script: x\n";
    let parsed = parse_yaml(text);
    assert_eq!(parsed.errors.len(), 1, "{:?}", parsed.errors);
    assert!(parsed.errors[0].line.is_some());
    let data = parsed.data.as_map().unwrap();
    assert!(data.contains_key("stages") && data.contains_key("build"), "{:?}", parsed.data);
    assert_eq!(parsed.lines(text)["build"], 2);
}

#[test]
#[ignore = "нужен внешний корпус, см. шапку файла"]
fn yaml_corpus() {
    let file = std::env::var("GORYNYCH_YAML_CORPUS").expect("GORYNYCH_YAML_CORPUS");
    let corpus: Json = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let report = run(corpus["cases"].as_array().unwrap(), false);
    eprintln!(
        "файлов {}, с ошибкой {}, намеренных отличий {}, с предупреждениями 1.x {}, ключей в сломанных файлах: 1.x {}, 2.0 {}",
        report.total, report.with_error, report.known, report.warnings, report.broken_keys_1x, report.broken_keys
    );
    assert_clean(&report);
}
