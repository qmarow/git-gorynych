//! Паритет с 1.x: `fixtures/guard-parity.json` записан настоящими `electron/guard.cjs` и `RegExp` из V8
//! (см. `fixtures/gen-guard-parity.cjs`). Текст ошибки шаблона не сравнивается, см. `js_regex`.

use std::sync::LazyLock;

use gorynych_ci_linter::guard::{GuardParams, glob_to_regex, scan_diff};
use gorynych_ci_linter::js_regex::JsRegex;
use serde_json::{Value, json};

static FIXTURE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures/guard-parity.json")).expect("корректный JSON"));

fn assert_no_mismatches(mismatches: &[String], total: usize) {
    assert!(total > 0, "эталон пуст");
    let shown = mismatches.iter().take(60).cloned().collect::<Vec<_>>().join("\n");
    assert!(mismatches.is_empty(), "расхождений {} из {total}:\n{shown}", mismatches.len());
}

/// `ı`, `ſ`, `K` (U+212A) с флагом `i` без `u`: известное отличие, см. шапку `js_regex.rs`.
fn known_fold_difference(pattern: &str, flags: &str, text: &[u16]) -> bool {
    const SPECIAL: [u16; 3] = [0x131, 0x17F, 0x212A];
    flags.contains('i')
        && !flags.contains('u')
        && (text.iter().any(|unit| SPECIAL.contains(unit)) || pattern.contains(['ı', 'ſ']))
}

#[test]
fn regex_engine_matches_v8() {
    let texts: Vec<Vec<u16>> = FIXTURE["texts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|text| text.as_array().unwrap().iter().map(|unit| unit.as_u64().unwrap() as u16).collect())
        .collect();
    let mut mismatches = Vec::new();
    let mut total = 0;
    for case in FIXTURE["regex"].as_array().unwrap() {
        let (pattern, flags) = (case["pattern"].as_str().unwrap(), case["flags"].as_str().unwrap());
        let compiled = JsRegex::new(pattern, flags);
        total += 1;
        match (&compiled, case["hits"].as_array()) {
            (Err(_), None) => {}
            (Ok(_), None) => mismatches.push(format!("/{pattern}/{flags}: V8 отвергает, regress принимает")),
            (Err(error), Some(_)) => mismatches.push(format!("/{pattern}/{flags}: V8 принимает, regress: {error}")),
            (Ok(regex), Some(hits)) => {
                for (text, hit) in texts.iter().zip(hits) {
                    total += 1;
                    let actual = regex.find(text).map_or(Value::Null, |range| json!([range.start, range.end]));
                    if &actual != hit && !known_fold_difference(pattern, flags, text) {
                        let shown = String::from_utf16_lossy(text);
                        mismatches.push(format!("/{pattern}/{flags} на {shown:?}: V8 {hit}, regress {actual}"));
                    }
                }
            }
        }
    }
    assert_no_mismatches(&mismatches, total);
}

#[test]
fn case_folding_differs_from_v8_only_in_known_characters() {
    // Обновление `regress` может изменить этот список: тогда поправить и шапку `js_regex.rs`
    let is_known = |code: u16| {
        matches!(code, 0x131 | 0x17F | 0x1F88..=0x1F8F | 0x1F98..=0x1F9F | 0x1FA8..=0x1FAF | 0x1FBC | 0x1FCC | 0x1FFC)
    };
    let mut differs = Vec::new();
    let mut known = 0;
    let cases = FIXTURE["fold"].as_array().unwrap();
    assert!(cases.len() > 2000, "{}", cases.len());
    for case in cases {
        let (code, variant) = (case[0].as_u64().unwrap() as u16, case[1].as_u64().unwrap() as u16);
        let pattern = format!("\\u{code:04x}");
        for (flags, expected) in [("i", &case[2]), ("iu", &case[3])] {
            let actual = JsRegex::new(&pattern, flags).unwrap().find(&[variant]).is_some();
            if actual != expected.as_bool().unwrap() {
                if flags == "i" && is_known(code) {
                    known += 1;
                } else {
                    differs.push(format!("{flags}:{code:04X}/{variant:04X}"));
                }
            }
        }
    }
    assert!(differs.is_empty(), "{}", differs.join(" "));
    assert_eq!(known, 31, "список известных отличий изменился");
}

#[test]
fn glob_matches_electron() {
    let paths: Vec<&str> = FIXTURE["paths"].as_array().unwrap().iter().map(|path| path.as_str().unwrap()).collect();
    let mut mismatches = Vec::new();
    let mut total = 0;
    for case in FIXTURE["globs"].as_array().unwrap() {
        let glob = case["glob"].as_str().unwrap();
        let regex = glob_to_regex(glob);
        total += 1;
        match (&regex, case["hits"].as_array()) {
            (None, None) => {}
            (Some(_), None) | (None, Some(_)) => mismatches.push(format!("{glob:?}: разное отношение к пустому шаблону")),
            (Some(regex), Some(hits)) => {
                for (path, hit) in paths.iter().zip(hits) {
                    total += 1;
                    if regex.is_match(path) != hit.as_bool().unwrap() {
                        mismatches.push(format!("{glob:?} на {path:?}: в 1.x {hit}"));
                    }
                }
            }
        }
    }
    assert_no_mismatches(&mismatches, total);
}

/// Убирает текст ошибки: он отличается намеренно.
fn without_error_text(mut scan: Value) -> Value {
    for item in scan["invalid"].as_array_mut().unwrap() {
        item["error"] = json!("");
    }
    scan
}

#[test]
fn scan_diff_matches_electron() {
    let cases = FIXTURE["scans"].as_array().unwrap();
    // Исправленные ошибки 1.x, см. «Отличия от 1.x» в шапке `guard.rs`. Новое поведение проверяют модульные тесты `guard.rs`
    const FIXED_IN_2X: [&str; 3] =
        ["секрет на границе 240", "совпадение в отступе", "добавленная строка с ++ считается заголовком"];
    let mut mismatches = Vec::new();
    for case in cases.iter().filter(|case| !FIXED_IN_2X.contains(&case["name"].as_str().unwrap())) {
        let params: GuardParams = serde_json::from_value(case["params"].clone()).unwrap();
        let mut actual = serde_json::to_value(scan_diff(case["diff"].as_str().unwrap(), &params)).unwrap();
        actual.as_object_mut().unwrap().remove("ms");
        let actual = without_error_text(actual);
        let expected = without_error_text(case["result"].clone());
        if actual != expected {
            mismatches.push(format!("{}:\n  1.x: {expected}\n  2.0: {actual}", case["name"]));
        }
    }
    assert_no_mismatches(&mismatches, cases.len());
}

#[test]
fn default_rules_find_russian_markers_at_word_boundaries() {
    let case = FIXTURE["scans"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "русские и английские метки в правилах по умолчанию")
        .unwrap();
    let params: GuardParams = serde_json::from_value(case["params"].clone()).unwrap();
    let scan = scan_diff(case["diff"].as_str().unwrap(), &params);
    let lines: Vec<u32> = scan.findings.iter().map(|item| item.line).collect();
    // 1-3 и 13-15: русские метки. 4-8 и 19: граница слова внутри кириллицы и латиницы, находок быть не должно
    assert_eq!(lines, [1, 2, 3, 9, 10, 13, 14, 15, 16, 21, 22]);
}

#[test]
fn fixture_covers_the_important_paths() {
    let scans = FIXTURE["scans"].as_array().unwrap();
    let all: Vec<&Value> = scans.iter().flat_map(|scan| scan["result"]["findings"].as_array().unwrap()).collect();
    assert!(all.iter().any(|item| item["level"] == "block"));
    assert!(all.iter().any(|item| item["text"].as_str().unwrap().contains('•')), "маска секрета");
    assert!(scans.iter().any(|scan| scan["result"]["truncated"] == true));
    assert!(scans.iter().any(|scan| !scan["result"]["invalid"].as_array().unwrap().is_empty()));
    assert!(scans.iter().any(|scan| scan["result"]["skippedFiles"].as_u64().unwrap() > 0));
    assert!(all.iter().any(|item| item["text"].as_str().unwrap().contains('\u{FFFD}')), "половина эмодзи");
}
