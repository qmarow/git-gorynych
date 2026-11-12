//! Каждый ключ перевода в исходниках есть в `gorynych-core/i18n/ru/main.ftl`: опечатка в ключе показала бы сам ключ вместо текста.

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
    let call = regex::Regex::new(r#"\bt\(\s*"((?:[^"\\]|\\.)*)""#).unwrap();
    // Таблицы, из которых ключ попадает в `t` переменной: фразы GitLab (`regex("…"), "ключ"`)
    let table = regex::Regex::new(r#"regex\("[^"]*"\), "([a-z0-9-]+)""#).unwrap();
    let mut files = Vec::new();
    rust_files(&manifest.join("src"), &mut files);
    let (mut checked, mut missing) = (0, Vec::new());
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for caps in call.captures_iter(&text).chain(table.captures_iter(&text)) {
            let key = caps[1].replace("\\\"", "\"").replace("\\n", "\n");
            checked += 1;
            if !gorynych_core::i18n::has_message(&key) {
                missing.push(format!("{}: {key}", file.display()));
            }
        }
    }
    assert!(checked > 150, "шаблон перестал находить ключи: {checked}");
    assert!(missing.is_empty(), "нет в словаре:\n{}", missing.join("\n"));
}
