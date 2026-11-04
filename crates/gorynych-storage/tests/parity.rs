//! Паритет с 1.x: `fixtures/parity.json` записан настоящим `electron/cicd/settings.cjs` (см. `fixtures/gen-parity.cjs`).

use std::sync::LazyLock;

use gorynych_core::i18n::Language;
use gorynych_storage::repo_providers::{normalize_base, repo_key};
use serde_json::Value;

static FIXTURE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/parity.json")).expect("корректный JSON"));

#[test]
fn normalize_base_matches_electron() {
    let cases = FIXTURE["base"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let language = Language::parse(case["language"].as_str().unwrap()).unwrap();
        let result = normalize_base(case["input"].as_str(), language);
        match case.get("error") {
            Some(expected) => {
                let actual = serde_json::to_value(result.expect_err(&case.to_string())).unwrap();
                assert_eq!(&actual, expected, "{case}");
            }
            None => {
                let actual = result.unwrap_or_else(|error| panic!("{case}: {error:?}"));
                assert_eq!(actual.as_deref(), case["ok"].as_str(), "{case}");
            }
        }
    }
}

#[test]
fn repo_key_matches_electron() {
    let cases = FIXTURE["keys"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let key = repo_key(case["host"].as_str().unwrap(), case["repoPath"].as_str().unwrap());
        assert_eq!(key, case["key"].as_str().unwrap(), "{case}");
    }
}
