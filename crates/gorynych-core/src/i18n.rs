//! Локализация. Перенос `electron/i18n.cjs`.
//!
//! # Конспект исходника
//! - Языки только `ru`/`en`, по умолчанию `ru`. Ключ — русский текст; `en.json` — плоский словарь.
//! - `t(msg, ...args)`: для `ru` — сам ключ, для `en` — `dict[msg] ?? msg`. Без аргументов подстановки нет.
//!   С аргументами `/\{(\d+)\}/g`: индекс вне диапазона оставляет `{N}` как есть, `null`/`undefined` → ''
//!   (здесь вызывающий передаёт `""`). Подстановка однопроходная: `{1}` внутри аргумента не раскрывается.
//! - `setLanguage`: неизвестный язык игнорируется и возвращается текущий; слушатели вызываются только
//!   при реальной смене, уже после смены языка.
//! - `locale()` → `en-GB` / `ru-RU`.
//!
//! # Отличия от 1.x
//! - Запись `language.json` убрана из ядра: язык хранит `gorynych-storage`, который при старте вызывает
//!   [`set_language`], а изменения получает через [`on_language_change`].
//! - Функции с явным языком ([`translate`], [`tr`], [`fluent_message`]) не зависят от глобального состояния.
//!   Глобальные [`t`] и [`language`] работают поверх экземпляра [`I18n`].
//!
//! Fluent (`i18n/{ru,en}/main.ftl`) — цель постепенного перехода на семантические ключи.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::Display;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use fluent_bundle::concurrent::FluentBundle;
use fluent_bundle::{FluentArgs, FluentResource};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use unic_langid::LanguageIdentifier;

/// Язык интерфейса и сообщений.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Ru,
    En,
}

impl Language {
    /// Разбирает код языка; всё, кроме `ru` и `en`, — `None`.
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ru" => Some(Self::Ru),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ru => "ru",
            Self::En => "en",
        }
    }

    /// Локаль для форматирования дат и чисел.
    pub fn locale(self) -> &'static str {
        match self {
            Self::Ru => "ru-RU",
            Self::En => "en-GB",
        }
    }
}

static EN_DICT: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../electron/i18n/en.json"))
        .expect("electron/i18n/en.json — плоский словарь строк")
});

static PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{([0-9]+)\}").expect("корректное регулярное выражение"));

/// Перевод по русскому ключу, без подстановки аргументов.
pub fn translate(language: Language, msg: &str) -> &str {
    match language {
        Language::Ru => msg,
        Language::En => EN_DICT.get(msg).map_or(msg, String::as_str),
    }
}

/// Подставляет аргументы в `{N}`. Без аргументов шаблон возвращается как есть.
pub fn format_message<'a>(template: &'a str, args: &[&dyn Display]) -> Cow<'a, str> {
    if args.is_empty() {
        return Cow::Borrowed(template);
    }
    PLACEHOLDER.replace_all(template, |caps: &Captures<'_>| {
        // Индекс, не влезающий в usize, заведомо вне диапазона: как и в 1.x, оставляем `{N}`.
        match caps[1].parse::<usize>().ok().and_then(|i| args.get(i)) {
            Some(arg) => arg.to_string(),
            None => caps[0].to_owned(),
        }
    })
}

/// Перевод с подстановкой на явно указанном языке.
pub fn tr(language: Language, msg: &str, args: &[&dyn Display]) -> String {
    format_message(translate(language, msg), args).into_owned()
}

/// Идентификатор подписки из [`I18n::on_change`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListenerId(u64);

type Listener = Arc<dyn Fn(Language) + Send + Sync>;

struct State {
    language: Language,
    listeners: Vec<(u64, Listener)>,
    next_id: u64,
}

/// Текущий язык и подписчики на его смену.
pub struct I18n {
    state: Mutex<State>,
}

impl I18n {
    pub const fn new(language: Language) -> Self {
        Self {
            state: Mutex::new(State {
                language,
                listeners: Vec::new(),
                next_id: 0,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Состояние не становится несогласованным при панике слушателя: их вызывают вне блокировки.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn language(&self) -> Language {
        self.lock().language
    }

    /// Устанавливает язык по коду; неизвестный код игнорируется. Возвращает действующий язык.
    pub fn set_language(&self, code: &str) -> Language {
        let Some(next) = Language::parse(code) else {
            return self.language();
        };
        let listeners: Vec<Listener> = {
            let mut state = self.lock();
            if state.language == next {
                return next;
            }
            state.language = next;
            state.listeners.iter().map(|(_, f)| Arc::clone(f)).collect()
        };
        // Вне блокировки: слушатель может обратиться к языку или отписаться.
        for listener in listeners {
            listener(next);
        }
        next
    }

    pub fn on_change(&self, listener: impl Fn(Language) + Send + Sync + 'static) -> ListenerId {
        let mut state = self.lock();
        let id = state.next_id;
        state.next_id += 1;
        state.listeners.push((id, Arc::new(listener)));
        ListenerId(id)
    }

    pub fn off(&self, id: ListenerId) {
        self.lock().listeners.retain(|(i, _)| *i != id.0);
    }

    pub fn t(&self, msg: &str, args: &[&dyn Display]) -> String {
        tr(self.language(), msg, args)
    }
}

static GLOBAL: I18n = I18n::new(Language::Ru);

/// Текущий язык процесса.
pub fn language() -> Language {
    GLOBAL.language()
}

/// См. [`I18n::set_language`].
pub fn set_language(code: &str) -> Language {
    GLOBAL.set_language(code)
}

/// См. [`I18n::on_change`].
pub fn on_language_change(listener: impl Fn(Language) + Send + Sync + 'static) -> ListenerId {
    GLOBAL.on_change(listener)
}

/// Снимает подписку, полученную из [`on_language_change`].
pub fn off_language_change(id: ListenerId) {
    GLOBAL.off(id);
}

/// Перевод на текущем языке процесса — аналог `t()` из 1.x.
pub fn t(msg: &str, args: &[&dyn Display]) -> String {
    GLOBAL.t(msg, args)
}

type Bundle = FluentBundle<FluentResource>;

fn bundle(tag: &str, source: &str) -> Bundle {
    let id: LanguageIdentifier = tag.parse().expect("корректный тег языка");
    let resource = FluentResource::try_new(source.to_owned())
        .unwrap_or_else(|(_, errors)| panic!("ошибка в main.ftl ({tag}): {errors:?}"));
    let mut bundle = FluentBundle::new_concurrent(vec![id]);
    bundle.set_use_isolating(false); // иначе в текст попадают символы U+2068/U+2069
    bundle
        .add_resource(resource)
        .unwrap_or_else(|errors| panic!("повторы в main.ftl ({tag}): {errors:?}"));
    bundle
}

static FLUENT_RU: LazyLock<Bundle> =
    LazyLock::new(|| bundle("ru", include_str!("../i18n/ru/main.ftl")));
static FLUENT_EN: LazyLock<Bundle> =
    LazyLock::new(|| bundle("en", include_str!("../i18n/en/main.ftl")));

/// Сообщение Fluent по семантическому ключу; `None`, если ключа нет или он без значения.
pub fn fluent_message(language: Language, id: &str, args: &[(&str, &str)]) -> Option<String> {
    let bundle: &Bundle = match language {
        Language::Ru => &FLUENT_RU,
        Language::En => &FLUENT_EN,
    };
    let pattern = bundle.get_message(id)?.value()?;
    let mut fluent_args = FluentArgs::new();
    for (name, value) in args {
        fluent_args.set(*name, *value);
    }
    let mut errors = Vec::new();
    let text = bundle.format_pattern(pattern, Some(&fluent_args), &mut errors);
    Some(text.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn unknown_language_is_ignored() {
        let i18n = I18n::new(Language::Ru);
        assert_eq!(i18n.set_language("de"), Language::Ru);
        assert_eq!(i18n.set_language("en"), Language::En);
        assert_eq!(i18n.set_language("RU"), Language::En);
    }

    #[test]
    fn listeners_fire_only_on_real_change() {
        static CALLS: AtomicUsize = AtomicUsize::new(0);
        let i18n = I18n::new(Language::Ru);
        let id = i18n.on_change(|language| {
            assert_eq!(language, Language::En);
            CALLS.fetch_add(1, Ordering::SeqCst);
        });
        i18n.set_language("ru");
        i18n.set_language("de");
        assert_eq!(CALLS.load(Ordering::SeqCst), 0);
        i18n.set_language("en");
        i18n.set_language("en");
        assert_eq!(CALLS.load(Ordering::SeqCst), 1);
        i18n.off(id);
        i18n.set_language("ru");
        i18n.set_language("en");
        assert_eq!(CALLS.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn listener_may_reenter() {
        let i18n: &'static I18n = Box::leak(Box::new(I18n::new(Language::Ru)));
        i18n.on_change(move |language| assert_eq!(i18n.language(), language));
        assert_eq!(i18n.set_language("en"), Language::En);
    }

    #[test]
    fn fluent_has_no_isolation_marks_and_reports_missing_keys() {
        let text = fluent_message(Language::En, "error-auth", &[]).expect("ключ есть");
        assert!(!text.contains(['\u{2068}', '\u{2069}']));
        assert_eq!(fluent_message(Language::Ru, "no-such-key", &[]), None);
    }
}
