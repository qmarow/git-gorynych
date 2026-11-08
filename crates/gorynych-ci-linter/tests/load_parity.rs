//! Паритет загрузчиков с 1.x: `fixtures/load-parity.json` записан настоящими `previewCi` и `YAML.stringify` (см. `fixtures/gen-load-parity.cjs`).
//!
//! Все подмены значений (их в 40 раз больше, чем в репозитории):
//! `node crates/gorynych-ci-linter/tests/fixtures/gen-load-parity.cjs <выход.json>`, затем
//! `GORYNYCH_LOAD_MUTATIONS=<выход.json> cargo test -p gorynych-ci-linter --test load_parity -- --ignored --nocapture`.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_ci_linter::load::preview_ci;
use gorynych_ci_linter::repo::RepoView;
use gorynych_ci_linter::yaml::{JsMap, Value};
use gorynych_ci_linter::yaml_write::to_yaml;
use gorynych_core::Language;
use gorynych_core::error::Result;
use serde_json::{Value as Json, json};

static FIXTURE: LazyLock<Json> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/load-parity.json")).expect("корректный JSON"));

fn to_value(json: &Json) -> Value {
    match json {
        Json::Null => Value::Null,
        Json::Bool(value) => Value::Bool(*value),
        Json::Number(value) => Value::Number(value.as_f64().unwrap()),
        Json::String(value) => Value::String(value.clone()),
        Json::Array(items) => Value::Seq(items.iter().map(to_value).collect()),
        Json::Object(map) => {
            let mut out = JsMap::new();
            for (key, value) in map {
                out.insert(key.clone(), to_value(value));
            }
            Value::Map(out)
        }
    }
}

/// `null` и отсутствие поля, `inherited: false` и его отсутствие для интерфейса одинаковы: см. шапку `load/model.rs`.
fn normalize(json: &Json) -> Json {
    match json {
        Json::Object(map) => Json::Object(
            map.iter()
                .filter(|(key, value)| !value.is_null() && !(matches!(key.as_str(), "inherited" | "imageInherited") && **value == json!(false)))
                .map(|(key, value)| (key.clone(), normalize(value)))
                .collect(),
        ),
        Json::Array(items) => Json::Array(items.iter().map(normalize).collect()),
        other => other.clone(),
    }
}

fn is_coerced_name(path: &str) -> bool {
    (path.contains(".jobs[") && (path.ends_with(".id") || path.ends_with(".name"))) || (path.contains(".variables[") && path.ends_with(".name"))
}

/// Первое расхождение с путём. Порядок свойств в структурах не значим, порядок ключей данных проверяется текстом `raw`.
fn first_difference(path: &str, expected: &Json, actual: &Json) -> Option<String> {
    match (expected, actual) {
        (Json::Number(a), Json::Number(b)) if a.as_f64() == b.as_f64() => None,
        (Json::Object(a), Json::Object(b)) => {
            for (key, value) in a {
                match b.get(key) {
                    Some(other) => {
                        if let Some(found) = first_difference(&format!("{path}.{key}"), value, other) {
                            return Some(found);
                        }
                    }
                    None => return Some(format!("{path}.{key}: 1.x {value}, 2.0 нет")),
                }
            }
            b.iter().find(|(key, _)| !a.contains_key(*key)).map(|(key, value)| format!("{path}.{key}: 1.x нет, 2.0 {value}"))
        }
        (Json::Array(a), Json::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path}: длина 1.x {}, 2.0 {}\n  1.x {expected}\n  2.0 {actual}", a.len(), b.len()));
            }
            a.iter().zip(b).enumerate().find_map(|(index, (x, y))| first_difference(&format!("{path}[{index}]"), x, y))
        }
        _ if expected == actual => None,
        // Отличие от 1.x, см. шапку `load/pipelines.rs`: такие имена здесь становятся строкой
        (expected, Json::String(actual)) if is_coerced_name(path) && to_value(expected).js_string() == *actual => None,
        _ => Some(format!("{path}:\n  1.x {expected}\n  2.0 {actual}")),
    }
}

fn write_files(repo: &Path, files: &serde_json::Map<String, Json>) {
    for (rel, content) in files {
        let full = repo.join(rel);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        match content {
            Json::String(text) => fs::write(&full, text).unwrap(),
            other => {
                if let Some(size) = other["big"].as_u64() {
                    // Хватает комментария нужной длины: так же устроены большие файлы в генераторе
                    fs::write(&full, format!("# {}\n", "x".repeat(size as usize - 3))).unwrap();
                } else {
                    fs::write(&full, decode_base64(other["base64"].as_str().unwrap())).unwrap();
                }
            }
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

/// Папка не репозиторий: все команды git дают пустой вывод, как `.catch(() => '')` в 1.x.
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

fn run_case(case: &Json) -> Option<String> {
    let name = case["name"].as_str().unwrap();
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
    let loaded = preview_ci(&repo, case["request"].as_str().unwrap_or_default(), language, &drafts, &NoRepo);
    let mut actual = serde_json::to_value(&loaded.load).unwrap();
    // Проверка сверяется в check_parity.rs
    if let Some(current) = actual.get_mut("current").and_then(Json::as_object_mut) {
        current.remove("check");
    }
    if case["dropFileText"] == json!(true) {
        for file in actual["current"]["files"].as_array_mut().unwrap() {
            if file["text"].as_str().unwrap().len() > 1000 {
                file["text"] = Json::Null;
            }
        }
    }
    // У `current` история и список изменений в предпросмотре всегда пусты
    let expected = normalize(&case["result"]);
    let actual = normalize(&actual);
    if case["loose"] == json!(true) {
        let errors = |json: &Json| json["current"]["errors"].as_array().map_or(0, Vec::len);
        return (errors(&actual) == 0 || errors(&expected) == 0).then(|| format!("{name}: нет ошибки\n  1.x {expected}\n  2.0 {actual}"));
    }
    first_difference("", &expected, &actual).map(|found| format!("{name} [{}]{found}", case["language"]))
}

fn run_all(cases: &[Json]) {
    let failures: Vec<String> = cases.iter().filter_map(run_case).collect();
    let shown: Vec<String> = failures.iter().take(25).cloned().collect();
    assert!(failures.is_empty(), "расхождений {} из {}:\n{}", failures.len(), cases.len(), shown.join("\n"));
}

#[test]
fn matches_electron_on_written_cases() {
    let cases = FIXTURE["cases"].as_array().unwrap();
    assert!(cases.len() > 70, "{}", cases.len());
    run_all(cases);
}

#[test]
fn matches_electron_on_odd_values() {
    let cases = FIXTURE["mutated"].as_array().unwrap();
    assert!(cases.len() > 150, "{}", cases.len());
    run_all(cases);
}

#[test]
#[ignore = "нужен полный список подмен, см. шапку файла"]
fn load_mutations_full() {
    let file = std::env::var("GORYNYCH_LOAD_MUTATIONS").expect("GORYNYCH_LOAD_MUTATIONS");
    let corpus: Json = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    run_all(corpus["cases"].as_array().unwrap());
}

#[test]
fn yaml_stringify_matches_electron() {
    let cases = FIXTURE["stringify"].as_array().unwrap();
    assert!(cases.len() > 7_000, "{}", cases.len());
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let actual = to_yaml(&to_value(&case["value"]));
            let expected = case["text"].as_str().unwrap();
            (actual != expected).then(|| format!("{}:\n  1.x {expected:?}\n  2.0 {actual:?}", case["value"]))
        })
        .collect();
    let shown: Vec<String> = failures.iter().take(25).cloned().collect();
    assert!(failures.is_empty(), "расхождений {} из {}:\n{}", failures.len(), cases.len(), shown.join("\n"));
}

#[test]
fn repeated_object_is_written_in_full_not_as_alias() {
    // Отличие от 1.x, см. шапку `yaml_write.rs`: там второе вхождение стало бы `*a1`
    let list = json!(["a"]);
    let value = to_value(&json!({"before": list, "after": list}));
    assert_eq!(to_yaml(&value), "before:\n  - a\nafter:\n  - a");
}
