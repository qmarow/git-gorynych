//! Каталог сообщений Fluent (`i18n/{ru,en}/{main,ui}.ftl`): разбирается без ошибок, у английского нет ключей, которых
//! нет в русском, аргументы `{ $aN }` в переводе те же, что в русском, а ключ, общий для Rust и интерфейса, везде с
//! одним текстом.

use std::collections::{BTreeMap, BTreeSet};

use fluent_bundle::{FluentArgs, FluentBundle, FluentResource};

const FILES: [(&str, &str, &str); 4] = [
    ("ru", "main", include_str!("../i18n/ru/main.ftl")),
    ("en", "main", include_str!("../i18n/en/main.ftl")),
    ("ru", "ui", include_str!("../i18n/ru/ui.ftl")),
    ("en", "ui", include_str!("../i18n/en/ui.ftl")),
];

/// Сообщения файла, раскрытые с аргументами «{0}», «{1}»…
fn messages(language: &str, source: &str) -> BTreeMap<String, String> {
    let resource = FluentResource::try_new(source.to_owned()).unwrap_or_else(|(_, errors)| panic!("{language}: {errors:?}"));
    let ids: Vec<String> = resource
        .entries()
        .filter_map(|entry| match entry {
            fluent_syntax::ast::Entry::Message(message) => Some(message.id.name.to_owned()),
            _ => None,
        })
        .collect();
    let mut bundle = FluentBundle::new(vec![language.parse().unwrap()]);
    bundle.set_use_isolating(false);
    bundle.add_resource(resource).unwrap_or_else(|errors| panic!("повторы ключей ({language}): {errors:?}"));
    let values: Vec<(String, String)> = (0..30).map(|i| (format!("a{i}"), format!("{{{i}}}"))).collect();
    let mut args = FluentArgs::new();
    for (name, value) in &values {
        args.set(name.as_str(), value.as_str());
    }
    ids.into_iter()
        .map(|id| {
            let pattern = bundle.get_message(&id).and_then(|m| m.value()).unwrap_or_else(|| panic!("{id} без значения"));
            let mut errors = Vec::new();
            let text = bundle.format_pattern(pattern, Some(&args), &mut errors).into_owned();
            assert!(errors.is_empty(), "{language} {id}: {errors:?}");
            (id, text)
        })
        .collect()
}

fn placeholders(text: &str) -> BTreeSet<String> {
    regex::Regex::new(r"\{[0-9]+\}").unwrap().find_iter(text).map(|m| m.as_str().to_owned()).collect()
}

#[test]
fn catalog_is_consistent() {
    let all: BTreeMap<(&str, &str), BTreeMap<String, String>> = FILES.iter().map(|(lang, file, source)| ((*lang, *file), messages(lang, source))).collect();
    for file in ["main", "ui"] {
        let ru = &all[&("ru", file)];
        let en = &all[&("en", file)];
        assert!(ru.len() > 1000, "{file}: {}", ru.len());
        for (id, text) in en {
            let Some(ru_text) = ru.get(id) else { panic!("{file}.ftl: ключ {id} есть только в английском") };
            assert_eq!(placeholders(text), placeholders(ru_text), "{file}.ftl {id}: аргументы перевода");
        }
    }
    for lang in ["ru", "en"] {
        let (main, ui) = (&all[&(lang, "main")], &all[&(lang, "ui")]);
        for (id, text) in main {
            if let Some(other) = ui.get(id) {
                assert_eq!(text, other, "{lang}: ключ {id} в main.ftl и ui.ftl с разным текстом");
            }
        }
    }
}

#[test]
fn templates_follow_1x_substitution() {
    use gorynych_core::i18n::{Language, has_message, tr, translate};
    // Ключ без аргументов, с аргументами, с нехваткой аргументов и неизвестный ключ
    assert!(has_message("git-not-found"));
    assert_eq!(tr(Language::En, "git-not-found", &[]), translate(Language::En, "git-not-found"));
    assert_ne!(translate(Language::En, "git-not-found"), translate(Language::Ru, "git-not-found"));
    assert_eq!(translate(Language::Ru, "no-such-key"), "no-such-key");
    assert_eq!(tr(Language::En, "Ключа нет {0}", &[&"x"]), "Ключа нет x");
}
