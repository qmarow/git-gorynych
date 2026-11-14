//! Новое в 2.0: Markdown задач и комментариев → безопасный HTML. Один результат для всех серверов и одна точка очистки:
//! интерфейс вставляет только то, что вернула [`render`].
//!
//! 1. Разбор `pulldown-cmark`: таблицы, зачёркивание, списки задач, сноски. Автоссылок в `pulldown-cmark` нет — голые
//!    `http(s)://…` в тексте превращаются в ссылки здесь же (хвостовая пунктуация `.,;:!?)'"` в ссылку не входит).
//! 2. Текст вне кода, ссылок и картинок: `#123` → `<a data-issue="123">#123</a>`, `@login` → `<span data-user="login">`.
//!    Перед `#` и `@` не должно быть буквы, цифры, `_`, `/`, `&`, `#`, `@` — так `path#12`, `a@b.ru` и `&#35;` не
//!    размечаются.
//! 3. Флажок списка задач — `<input type="checkbox" disabled data-task-index="N">`, `N` — номер флажка в тексте с нуля.
//! 4. Выравнивание ячеек таблицы: `pulldown-cmark` пишет `style="text-align: …"`, стилей очистка не пропускает — оно
//!    становится `align="…"`.
//! 5. Очистка `ammonia` с явными списками тегов и атрибутов (см. [`TAGS`], [`tag_attributes`]). Ссылки — `http`, `https`,
//!    `mailto` и якоря `#…`; картинки — только `https`. Относительный адрес дополняется `base_url` (страница репозитория
//!    на сервере): `/uploads/…` — от страницы репозитория, как у GitLab, иной `/…` — от корня сервера, без `/` — от
//!    страницы репозитория. Без `base_url` относительные адреса снимаются. У `class` остаются только `language-*` (у
//!    `code` и `span`). Всем ссылкам — `rel="noopener noreferrer"`. У любого `input` — `type="checkbox"` и `disabled`:
//!    включает флажки сам интерфейс.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use url::Url;

/// Разрешённые теги.
pub const TAGS: &[&str] = &[
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "input", "details",
    "summary", "sup", "sub", "kbd", "span",
];

/// Разрешённые атрибуты по тегам.
fn tag_attributes() -> HashMap<&'static str, HashSet<&'static str>> {
    let set = |names: &[&'static str]| names.iter().copied().collect::<HashSet<_>>();
    HashMap::from([
        ("a", set(&["href", "title", "data-issue"])),
        ("img", set(&["src", "alt", "title", "width", "height"])),
        ("input", set(&["type", "checked", "disabled", "data-task-index"])),
        ("th", set(&["align"])),
        ("td", set(&["align"])),
        ("code", set(&["class"])),
        ("span", set(&["class", "data-user"])),
    ])
}

/// Текст для разметки: ссылка, `#номер`, `@логин`. Группа 1 — символ перед `#`/`@` (или начало).
static MARKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(https?://[^\s<>]+)|(?:^|[^\w/&#@])(?:#(\d+)\b|@([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?))").expect("регулярка разметки")
});

/// Выравнивание ячеек, как его пишет `pulldown-cmark`.
static ALIGN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#" style="text-align: (left|center|right)""#).expect("регулярка выравнивания"));

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Хвостовая пунктуация не входит в голую ссылку.
fn trim_url(url: &str) -> &str {
    url.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', '\'', '"'])
}

/// Текст с разметкой ссылок, `#номеров` и `@логинов`; `None` — размечать нечего.
fn mark_text(text: &str) -> Option<String> {
    let mut out = String::new();
    let mut last = 0;
    for caps in MARKS.captures_iter(text) {
        let (start, end, html) = if let Some(url) = caps.get(1) {
            let trimmed = trim_url(url.as_str());
            if trimmed.len() <= "https://".len() {
                continue;
            }
            let html = format!(r#"<a href="{0}">{0}</a>"#, escape(trimmed));
            (url.start(), url.start() + trimmed.len(), html)
        } else if let Some(number) = caps.get(2) {
            (number.start() - 1, number.end(), format!(r#"<a data-issue="{0}">#{0}</a>"#, number.as_str()))
        } else if let Some(login) = caps.get(3) {
            (login.start() - 1, login.end(), format!(r#"<span data-user="{0}">@{0}</span>"#, escape(login.as_str())))
        } else {
            continue;
        };
        out.push_str(&escape(&text[last..start]));
        out.push_str(&html);
        last = end;
    }
    if last == 0 {
        return None;
    }
    out.push_str(&escape(&text[last..]));
    Some(out)
}

/// Относительный адрес → полный по странице репозитория.
fn resolve(base: &Url, value: &str) -> Option<String> {
    let mut repo = base.clone();
    if !repo.path().ends_with('/') {
        repo.set_path(&format!("{}/", repo.path()));
    }
    let joined = if let Some(rest) = value.strip_prefix("/uploads/") {
        repo.join(&format!("uploads/{rest}"))
    } else if value.starts_with("//") {
        return None;
    } else if value.starts_with('/') {
        base.join(value)
    } else {
        repo.join(value)
    };
    joined.ok().map(String::from)
}

fn is_absolute(value: &str) -> bool {
    Url::parse(value).is_ok()
}

/// Значение атрибута после очистки; `None` — атрибут снимается.
fn filter_attribute<'v>(base: Option<&Url>, element: &str, attribute: &str, value: &'v str) -> Option<Cow<'v, str>> {
    match (element, attribute) {
        ("a", "href") => {
            if value.starts_with('#') || is_absolute(value) {
                Some(value.into())
            } else {
                base.and_then(|base| resolve(base, value)).map(Cow::Owned)
            }
        }
        ("img", "src") => {
            let full = if is_absolute(value) { value.to_owned() } else { base.and_then(|base| resolve(base, value))? };
            full.starts_with("https://").then_some(Cow::Owned(full))
        }
        (_, "class") => {
            let kept: Vec<&str> = value.split_ascii_whitespace().filter(|class| class.strip_prefix("language-").is_some_and(|lang| !lang.is_empty() && lang.chars().all(|c| c.is_ascii_alphanumeric() || "_+#.-".contains(c)))).collect();
            (!kept.is_empty()).then(|| Cow::Owned(kept.join(" ")))
        }
        ("a", "data-issue") | ("input", "data-task-index") => value.chars().all(|c| c.is_ascii_digit()).then_some(value.into()),
        ("th" | "td", "align") => matches!(value, "left" | "center" | "right").then_some(value.into()),
        _ => Some(value.into()),
    }
}

/// Markdown → HTML после разметки и очистки.
pub fn render(markdown: &str, base_url: Option<&str>) -> String {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_FOOTNOTES;
    let mut code = 0usize;
    let mut link = 0usize;
    let mut task = 0usize;
    let events = Parser::new_ext(markdown, options).map(|event| match event {
        Event::Start(Tag::CodeBlock(_)) => {
            code += 1;
            event
        }
        Event::End(TagEnd::CodeBlock) => {
            code = code.saturating_sub(1);
            event
        }
        Event::Start(Tag::Link { .. } | Tag::Image { .. }) => {
            link += 1;
            event
        }
        Event::End(TagEnd::Link | TagEnd::Image) => {
            link = link.saturating_sub(1);
            event
        }
        Event::TaskListMarker(checked) => {
            let html = format!(r#"<input type="checkbox" disabled="" data-task-index="{task}"{}> "#, if checked { r#" checked="""# } else { "" });
            task += 1;
            Event::InlineHtml(CowStr::from(html))
        }
        Event::Text(text) if code == 0 && link == 0 => match mark_text(&text) {
            Some(html) => Event::InlineHtml(CowStr::from(html)),
            None => Event::Text(text),
        },
        other => other,
    });
    let mut html = String::with_capacity(markdown.len() * 3 / 2);
    pulldown_cmark::html::push_html(&mut html, events);
    let html = ALIGN.replace_all(&html, r#" align="$1""#);

    let base = base_url.and_then(|url| Url::parse(url).ok()).filter(|url| matches!(url.scheme(), "http" | "https"));
    ammonia::Builder::default()
        .tags(TAGS.iter().copied().collect())
        .generic_attributes(HashSet::new())
        .tag_attributes(tag_attributes())
        .url_schemes(HashSet::from(["http", "https", "mailto"]))
        .url_relative(ammonia::UrlRelative::PassThrough)
        .link_rel(Some("noopener noreferrer"))
        .set_tag_attribute_value("input", "type", "checkbox")
        .set_tag_attribute_value("input", "disabled", "")
        .attribute_filter(move |element, attribute, value| filter_attribute(base.as_ref(), element, attribute, value))
        .clean(&html)
        .to_string()
}
