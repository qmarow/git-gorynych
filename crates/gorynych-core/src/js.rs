//! Поведение JS, от которого зависит паритет с 1.x: `trim`, `\s`, `localeCompare`.
//!
//! [`locale_cmp`] — приближение `String.prototype.localeCompare` без библиотеки ICU. Порядок символов взят из корневой
//! таблицы CLDR: пробелы и пунктуация, цифры, латиница (без учёта регистра; при равенстве строчная раньше прописной).
//! **Известное расхождение:** прочие алфавиты идут по коду символа (в кириллице `ё` окажется после `я`), а в `ru` у ICU
//! кириллица стоит раньше латиницы. На порядок адресов и путей с латиницей это не влияет.

use std::cmp::Ordering;

/// Пробельные символы `String.prototype.trim` и `\s` в JS.
pub fn is_whitespace(c: char) -> bool {
    matches!(c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
        | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// Аналог `String.prototype.trim`: набор пробелов отличается от `str::trim` (U+FEFF, U+0085).
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_whitespace)
}

/// Содержимое класса символов для `\s` из JS: подставляется в шаблоны `regex`, где `\s` шире.
pub const WHITESPACE_CLASS: &str =
    r"\t\n\x0B\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// Порядок пунктуации в корневой таблице CLDR.
const PUNCTUATION: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary_rank(c: char) -> u32 {
    if let Some(index) = PUNCTUATION.chars().position(|p| p == c) {
        return index as u32;
    }
    let lower = c.to_lowercase().next().unwrap_or(c);
    match lower {
        '0'..='9' => 100 + lower as u32,
        'a'..='z' => 1000 + lower as u32,
        _ => 10_000 + lower as u32,
    }
}

/// Сравнение строк как `a.localeCompare(b)`, см. шапку модуля.
pub fn locale_cmp(a: &str, b: &str) -> Ordering {
    let primary = a.chars().map(primary_rank).cmp(b.chars().map(primary_rank));
    primary.then_with(|| {
        // Строки равны без учёта регистра: решает первое различие, строчная идёт раньше прописной.
        a.chars()
            .zip(b.chars())
            .find(|(x, y)| x != y)
            .map_or(Ordering::Equal, |(x, y)| x.is_uppercase().cmp(&y.is_uppercase()))
    })
}
