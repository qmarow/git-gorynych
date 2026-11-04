//! Паритет с 1.x: `fixtures/parity.json` записан настоящими `electron/*.cjs` (см. `fixtures/gen-parity.cjs`).

use std::collections::BTreeSet;
use std::fmt::Display;
use std::sync::LazyLock;

use gorynych_core::error::{ProcessFailure, classify, from_process_error, rules};
use gorynych_core::i18n::{Language, tr};
use gorynych_core::line_diff::{DEFAULT_CONTEXT, diff_lines, to_hunks};
use gorynych_core::{ErrorCode, GorynychError};
use serde_json::Value;

static FIXTURE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/parity.json")).expect("корректный JSON"));

fn cases(name: &str) -> &'static Vec<Value> {
    FIXTURE[name].as_array().expect("массив случаев")
}

fn str_of<'a>(case: &'a Value, key: &str) -> &'a str {
    case[key].as_str().unwrap_or_else(|| panic!("нет строки {key}: {case}"))
}

fn language_of(case: &Value) -> Language {
    Language::parse(str_of(case, "language")).expect("ru или en")
}

fn string_list(value: &Value) -> Vec<String> {
    value.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_owned()).collect()
}

#[test]
fn every_code_from_electron_is_in_the_enum() {
    let electron: BTreeSet<String> = string_list(&FIXTURE["codes"]).into_iter().collect();
    let ours: BTreeSet<String> = ErrorCode::ALL.iter().map(|c| c.as_str().to_owned()).collect();
    assert_eq!(ours, electron);
}

#[test]
fn classify_matches_electron() {
    for case in cases("classify") {
        let actual = classify(str_of(case, "stderr"), str_of(case, "stdout")).map(|rule| rule.code.as_str());
        assert_eq!(actual, case["code"].as_str(), "{case}");
    }
}

#[test]
fn every_rule_is_exercised_with_exact_texts() {
    let table = FIXTURE["rules"].as_object().unwrap();
    assert_eq!(table.len(), rules().count());
    for rule in rules() {
        for language in [Language::Ru, Language::En] {
            let expected = &table[rule.code.as_str()][language.as_str()];
            assert_eq!(rule.message(language), expected["message"].as_str().unwrap());
            assert_eq!(rule.hint(language), expected["hint"].as_str().unwrap());
        }
    }
}

#[test]
fn from_process_error_matches_electron() {
    for case in cases("process") {
        let message = str_of(case, "message");
        let failure = match str_of(case, "kind") {
            "not_found" => ProcessFailure::NotFound,
            "timed_out" => ProcessFailure::TimedOut { message },
            "exited" => ProcessFailure::Exited { message },
            other => panic!("неизвестный вид: {other}"),
        };
        let error: GorynychError = from_process_error(failure, str_of(case, "stdout"), str_of(case, "stderr"), language_of(case));
        assert_eq!(serde_json::to_value(&error).unwrap(), case["json"], "{case}");
        assert_eq!(error.stdout, str_of(case, "keptStdout"), "{case}");
    }
}

#[test]
fn t_matches_electron() {
    for case in cases("t") {
        let args: Vec<String> = case["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|arg| match arg {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect();
        let refs: Vec<&dyn Display> = args.iter().map(|s| s as &dyn Display).collect();
        assert_eq!(tr(language_of(case), str_of(case, "msg"), &refs), str_of(case, "out"), "{case}");
    }
}

#[test]
fn locale_matches_electron() {
    for language in [Language::Ru, Language::En] {
        assert_eq!(language.locale(), FIXTURE["locales"][language.as_str()].as_str().unwrap());
    }
}

#[test]
fn line_diff_matches_electron() {
    for case in cases("diff") {
        let a = string_list(&case["a"]);
        let b = string_list(&case["b"]);
        let ops = diff_lines(&a, &b);
        assert_eq!(serde_json::to_value(&ops).unwrap(), case["ops"], "{case}");
        let context = case["context"].as_u64().map_or(DEFAULT_CONTEXT, |c| c as usize);
        assert_eq!(serde_json::to_value(to_hunks(&a, &b, &ops, context)).unwrap(), case["result"], "{case}");
    }
}

#[test]
fn fixture_is_not_empty() {
    for name in ["classify", "process", "t", "diff"] {
        assert!(!cases(name).is_empty(), "{name}");
    }
}
