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

/// Аналог `String(number)`: кратчайшая запись, экспонента от 1e21 и ниже 1e-6.
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("формат {:e} содержит e");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().expect("показатель степени — целое");
    let count = digits.len() as i32;
    let point = exponent + 1;
    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        format!("{}.{}", &digits[..point as usize], &digits[point as usize..])
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat(-point as usize))
    } else {
        let sign = if exponent < 0 { '-' } else { '+' };
        let rest = if count == 1 { String::new() } else { format!(".{}", &digits[1..]) };
        format!("{}{rest}e{sign}{}", &digits[..1], exponent.abs())
    };
    if value < 0.0 { format!("-{body}") } else { body }
}

/// Аналог `JSON.stringify(string)`.
pub fn json_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Длина строки в JS: единицы UTF-16.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Порядок `Array.prototype.sort()` без функции сравнения: по единицам UTF-16.
pub fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_quote_matches_json_stringify() {
        assert_eq!(json_quote("a\"b\\c\n\t\r\u{8}\u{C}\u{1}\u{1f}\u{7f}ж😀"), "\"a\\\"b\\\\c\\n\\t\\r\\b\\f\\u0001\\u001f\u{7f}ж😀\"");
    }

    #[test]
    fn utf16_order_differs_from_code_points() {
        assert_eq!(utf16_len("ж😀"), 3);
        // U+FF5E меньше эмодзи по кодовой точке, но больше по единицам UTF-16 (суррогаты D800..DFFF)
        assert_eq!(utf16_cmp("\u{FF5E}", "😀"), Ordering::Greater);
    }

    #[test]
    fn number_to_string_matches_js() {
        let cases: [(f64, &str); 16] = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (1.1, "1.1"),
            (100.0, "100"),
            (123456.789, "123456.789"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (value, expected) in cases {
            assert_eq!(number_to_string(value), expected);
        }
        assert_eq!(number_to_string(123456789012345680000.0), "123456789012345680000");
    }
}
