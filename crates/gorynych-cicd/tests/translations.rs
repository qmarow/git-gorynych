//! Каждый русский ключ перевода в исходниках есть в словаре `electron/i18n/en.json`: опечатка в ключе молча показала бы русский текст в английском интерфейсе.

use std::path::{Path, PathBuf};

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn every_translation_key_exists() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dictionary: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(manifest.join("../../electron/i18n/en.json")).unwrap()).unwrap();
    let call = regex::Regex::new(r#"\bt\(\s*"((?:[^"\\]|\\.)*)""#).unwrap();
    // Таблицы, из которых ключ попадает в `t` переменной
    let table = regex::Regex::new(r#"(?:regex\("[^"]*"\), |"[a-z_]+" => )"([^"]*[а-яё][^"]*)""#).unwrap();
    let mut files = Vec::new();
    rust_files(&manifest.join("src"), &mut files);
    let (mut checked, mut missing) = (0, Vec::new());
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for caps in call.captures_iter(&text).chain(table.captures_iter(&text)) {
            let key = caps[1].replace("\\\"", "\"").replace("\\n", "\n");
            checked += 1;
            if !dictionary.contains_key(&key) {
                missing.push(format!("{}: {key}", file.display()));
            }
        }
    }
    assert!(checked > 150, "шаблон перестал находить ключи: {checked}");
    assert!(missing.is_empty(), "нет в словаре:\n{}", missing.join("\n"));
}
