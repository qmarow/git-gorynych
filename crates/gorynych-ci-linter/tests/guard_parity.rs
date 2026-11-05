//! Паритет с 1.x: `fixtures/guard-parity.json` записан настоящими `electron/guard.cjs` и `RegExp` из V8
//! (см. `fixtures/gen-guard-parity.cjs`). Текст ошибки шаблона не сравнивается, см. `js_regex`.

use std::collections::HashMap;
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
    let mut leaks = 0;
    for case in cases.iter().filter(|case| !FIXED_IN_2X.contains(&case["name"].as_str().unwrap())) {
        let params: GuardParams = serde_json::from_value(case["params"].clone()).unwrap();
        let mut actual = serde_json::to_value(scan_diff(case["diff"].as_str().unwrap(), &params)).unwrap();
        actual.as_object_mut().unwrap().remove("ms");
        let actual = without_error_text(actual);
        let mut expected = without_error_text(case["result"].clone());
        let secrets = secret_rules(&params);
        leaks += exempt_extra_secrets(&mut expected, &actual, case["diff"].as_str().unwrap(), &secrets);
        assert_no_secret_shown(&actual, &secrets, case["name"].as_str().unwrap());
        if actual != expected {
            mismatches.push(format!("{}:\n  1.x: {expected}\n  2.0: {actual}", case["name"]));
        }
    }
    assert_no_mismatches(&mismatches, cases.len());
    assert!(leaks > 0, "в эталоне нет строк, где 1.x показывает секрет: проверка ничего не проверяет");
}

/// Правила секретов сценария с их расширениями.
fn secret_rules(params: &GuardParams) -> Vec<(JsRegex, Vec<String>)> {
    params
        .rules
        .iter()
        .filter(|rule| rule.category.as_deref() == Some("secret") && !rule.pattern.is_empty())
        .filter_map(|rule| {
            let flags: String = rule.flags.as_deref().unwrap_or_default().chars().filter(|c| "imsu".contains(*c)).collect();
            let files = rule.files.as_deref().unwrap_or_default();
            let extensions = files.split([',', ' ']).filter(|item| !item.is_empty()).map(str::to_lowercase).collect();
            Some((JsRegex::new(&rule.pattern, &flags).ok()?, extensions))
        })
        .collect()
}

fn extension_of(file: &str) -> String {
    file.rsplit('/').next().unwrap().rsplit_once('.').map_or(file, |(_, extension)| extension).to_lowercase()
}

/// Непустые совпадения секретных правил в тексте.
fn secret_matches(text: &str, file: &str, secrets: &[(JsRegex, Vec<String>)]) -> Vec<(Vec<u16>, std::ops::Range<usize>)> {
    let extension = extension_of(file);
    let units: Vec<u16> = text.encode_utf16().collect();
    secrets
        .iter()
        .filter(|(_, extensions)| extensions.is_empty() || extensions.contains(&extension))
        .flat_map(|(regex, _)| regex.find_all(&units))
        .filter(|range| !range.is_empty())
        .map(|range| (units.clone(), range))
        .collect()
}

/// Добавленные строки diff: (файл, номер) → текст.
fn added_lines(diff: &str) -> HashMap<(String, u64), String> {
    let mut lines = HashMap::new();
    let (mut file, mut line) = (String::new(), 0u64);
    for raw in diff.split('\n') {
        if let Some(header) = raw.strip_prefix("+++ ") {
            let name = header.trim().trim_start_matches('"').trim_end_matches('"');
            file = name.strip_prefix("b/").unwrap_or(name).to_owned();
        } else if raw.starts_with("@@ ") {
            let digits = raw.split('+').nth(1).unwrap_or_default();
            line = digits.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0);
        } else if let Some(text) = raw.strip_prefix('+') {
            lines.insert((file.clone(), line), text.trim_end_matches('\r').to_owned());
            line += 1;
        } else if raw.starts_with(' ') {
            line += 1;
        }
    }
    lines
}

/// Намеренное отличие от 1.x: в 1.x открыты второй секрет на строке и секрет рядом с находкой несекретного правила. На таких
/// строках текст сравнить нельзя, поэтому берём из 2.0 только поля, зависящие от маски. На остальных строках сравнение точное.
fn exempt_extra_secrets(expected: &mut Value, actual: &Value, diff: &str, secrets: &[(JsRegex, Vec<String>)]) -> usize {
    let lines = added_lines(diff);
    let mut exempt = 0;
    let findings = expected["findings"].as_array_mut().unwrap();
    for (finding, ours) in findings.iter_mut().zip(actual["findings"].as_array().unwrap()) {
        let file = finding["file"].as_str().unwrap().to_owned();
        let source = lines.get(&(file.clone(), finding["line"].as_u64().unwrap()));
        let count = source.map_or(0, |text| secret_matches(text, &file, secrets).len());
        let allowed = if finding["category"] == "secret" { 1 } else { 0 };
        if count > allowed {
            exempt += 1;
            for field in ["text", "start", "end"] {
                finding[field] = ours[field].clone();
            }
        }
    }
    exempt
}

/// Маска оставляет края секрета, поэтому совпадение, примыкающее к её точкам, — это не утечка.
fn assert_no_secret_shown(actual: &Value, secrets: &[(JsRegex, Vec<String>)], name: &str) {
    const BULLET: u16 = 0x2022;
    for finding in actual["findings"].as_array().unwrap() {
        let leak = secret_matches(finding["text"].as_str().unwrap(), finding["file"].as_str().unwrap(), secrets).into_iter().any(
            |(units, range)| {
                let before = range.start.checked_sub(1).and_then(|at| units.get(at));
                before != Some(&BULLET) && units.get(range.end) != Some(&BULLET)
            },
        );
        assert!(!leak, "{name}: секрет виден в 2.0: {finding}");
    }
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
