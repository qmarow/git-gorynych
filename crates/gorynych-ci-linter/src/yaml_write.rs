//! Запись YAML: `YAML.stringify(value, { lineWidth: 0 })` из `electron/vendor/yaml.cjs` (`toYaml` в `ci.cjs`) и его `stringifyString`.
//!
//! ## Конспект
//! - При `lineWidth: 0` `foldFlowLines` ничего не делает, а многострочная строка всегда становится блоком `|` (не `>`).
//! - Строка, контекст плоский: управляющие символы (кроме `\t`, `\n`) — в двойных кавычках. Иначе [`plain_string`]: ключ с переводом строки — в
//!   кавычках; опасное начало или содержимое — в кавычках, если это ключ или в строке нет перевода, иначе блок; `---`, `...`, `%` в начале
//!   строки — блок на верхнем уровне и кавычки у ключа на отступе одного шага; строка, которая читается как другой тип, — в кавычках.
//! - Кавычки (`quotedString`): есть `"` и нет `'` — одинарные; иначе двойные. Одинарные невозможны при пробеле рядом с переводом строки.
//! - Двойные: `JSON.stringify`, затем `\u00XX` → `\xXX` и `\0 \a \v \e`; `\n` внутри длинной строки (от 40 единиц UTF-16) разворачивается в
//!   настоящие переводы строки; пробел перед `\n` экранируется.
//! - Блочная коллекция: элементы списка `- ` с отступом, словарь без отступа в списке, пустые — `[]` и `{}`. Значение-коллекция — с новой
//!   строки, скаляр — через пробел. Ключ длиннее 1024 единиц UTF-16 — явный `? ключ`.
//! - `Document`: у результата перевод строки в конце, `toYaml` снимает его `trimEnd`.
//!
//! ## Отличие от 1.x
//! `aliasDuplicateObjects`: 1.x записывал один и тот же объект JS (алиас YAML, повторённый в одном задании) как `&a1` и `*a1`. У
//! [`Value`] нет идентичности, поэтому здесь значение записывается целиком. Текст показывается в интерфейсе (`raw`) и не читается обратно.

use gorynych_core::js;

use crate::yaml::{Value, resolve_plain};

const INDENT_STEP: &str = "  ";
const DOUBLE_QUOTED_MIN_MULTI_LINE: usize = 40;
const MAX_IMPLICIT_KEY: usize = 1024;

/// `toYaml`: `YAML.stringify(value, { lineWidth: 0 }).trimEnd()`.
pub fn to_yaml(value: &Value) -> String {
    let text = stringify(value, "", false);
    text.trim_end_matches(js::is_whitespace).to_owned()
}

fn stringify(value: &Value, indent: &str, implicit_key: bool) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => number(*value),
        Value::String(text) => string(text, indent, implicit_key),
        Value::Seq(items) => sequence(items, indent),
        Value::Map(map) if map.is_empty() => "{}".to_owned(),
        Value::Map(map) => {
            let pairs: Vec<String> = map.iter().map(|(key, value)| pair(key, value, indent)).collect();
            pairs.join(&format!("\n{indent}"))
        }
    }
}

/// `stringifyNumber`.
fn number(value: f64) -> String {
    if value.is_nan() {
        ".nan".to_owned()
    } else if value.is_infinite() {
        if value < 0.0 { "-.inf" } else { ".inf" }.to_owned()
    } else if value == 0.0 && value.is_sign_negative() {
        "-0".to_owned()
    } else {
        js::number_to_string(value)
    }
}

fn sequence(items: &[Value], indent: &str) -> String {
    if items.is_empty() {
        return "[]".to_owned();
    }
    let item_indent = format!("{indent}{INDENT_STEP}");
    let lines: Vec<String> = items.iter().map(|item| format!("- {}", stringify(item, &item_indent, false))).collect();
    lines.join(&format!("\n{indent}"))
}

/// `stringifyPair` для ключа-строки без комментариев.
fn pair(key: &str, value: &Value, indent: &str) -> String {
    let value_indent = format!("{indent}{INDENT_STEP}");
    let key_text = string(key, &value_indent, true);
    let explicit = js::utf16_len(&key_text) > MAX_IMPLICIT_KEY;
    let head = if explicit { format!("? {key_text}\n{indent}:") } else { format!("{key_text}:") };
    let body = stringify(value, &value_indent, false);
    let non_empty_collection = match value {
        Value::Seq(items) => !items.is_empty(),
        Value::Map(map) => !map.is_empty(),
        _ => false,
    };
    let gap = if !explicit && non_empty_collection {
        format!("\n{value_indent}")
    } else if body.is_empty() || body.starts_with('\n') {
        String::new()
    } else {
        " ".to_owned()
    };
    format!("{head}{gap}{body}")
}

/// `stringifyString` для узла без исходного стиля.
pub fn string(text: &str, indent: &str, implicit_key: bool) -> String {
    let control = text.chars().any(|c| matches!(c as u32, 0x00..=0x08 | 0x0B..=0x1F | 0x7F..=0x9F));
    if control { double_quoted(text, indent, implicit_key) } else { plain_string(text, indent, implicit_key) }
}

/// `/^(%|---|\.\.\.)/m`.
fn has_document_marker(text: &str) -> bool {
    let marker = |at: &str| at.starts_with('%') || at.starts_with("---") || at.starts_with("...");
    marker(text) || text.char_indices().any(|(at, c)| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') && marker(&text[at + c.len_utf8()..]))
}

/// Начало или содержимое, которое нельзя записать без кавычек.
fn needs_quoting(text: &str) -> bool {
    let bytes = text.as_bytes();
    let starts = matches!(
        bytes.first(),
        Some(b'\n' | b'\t' | b' ' | b',' | b'[' | b']' | b'{' | b'}' | b'#' | b'&' | b'*' | b'!' | b'|' | b'>' | b'\'' | b'"' | b'%' | b'@' | b'`')
    );
    let indicator = matches!(bytes.first(), Some(b'?' | b'-')) && (bytes.len() == 1 || matches!(bytes[1], b' ' | b'\t'));
    let inside = bytes.windows(2).any(|pair| {
        matches!(pair[0], b'\n' | b':') && matches!(pair[1], b' ' | b'\t')
            || matches!(pair[0], b' ' | b'\t') && pair[1] == b'\n'
            || matches!(pair[0], b'\n' | b'\t' | b' ') && pair[1] == b'#'
    });
    starts || indicator || inside || matches!(bytes.last(), Some(b'\n' | b'\t' | b' ' | b':'))
}

fn plain_string(text: &str, indent: &str, implicit_key: bool) -> String {
    let multi_line = text.contains('\n');
    if implicit_key && multi_line {
        return quoted(text, indent, implicit_key);
    }
    if needs_quoting(text) {
        return if implicit_key || !multi_line { quoted(text, indent, implicit_key) } else { block(text, indent, false) };
    }
    if !implicit_key && multi_line {
        return block(text, indent, false);
    }
    if has_document_marker(text) {
        if indent.is_empty() {
            return block(text, indent, true);
        }
        if implicit_key && indent == INDENT_STEP {
            return quoted(text, indent, implicit_key);
        }
    }
    if matches!(resolve_plain(text), Value::String(_)) { text.to_owned() } else { quoted(text, indent, implicit_key) }
}

/// `quotedString`.
fn quoted(text: &str, indent: &str, implicit_key: bool) -> String {
    if text.contains('"') && !text.contains('\'') {
        single_quoted(text, indent, implicit_key)
    } else {
        double_quoted(text, indent, implicit_key)
    }
}

/// После каждой серии переводов строки дописывает `suffix`, как `.replace(/\n+/g, "$&" + suffix)`.
fn after_line_breaks(text: &str, suffix: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        out.push(c);
        if c == '\n' && chars.peek() != Some(&'\n') {
            out.push_str(suffix);
        }
    }
    out
}

fn single_quoted(text: &str, indent: &str, implicit_key: bool) -> String {
    let space_near_break = text.contains(" \n") || text.contains("\t\n") || text.contains("\n ") || text.contains("\n\t");
    if (implicit_key && text.contains('\n')) || space_near_break {
        return double_quoted(text, indent, implicit_key);
    }
    let line_indent = if !indent.is_empty() {
        indent
    } else if has_document_marker(text) {
        INDENT_STEP
    } else {
        ""
    };
    format!("'{}'", after_line_breaks(&text.replace('\'', "''"), &format!("\n{line_indent}")))
}

fn double_quoted(text: &str, indent: &str, implicit_key: bool) -> String {
    let json = js::json_quote(text);
    let bytes = json.as_bytes();
    let line_indent = if !indent.is_empty() {
        indent
    } else if has_document_marker(text) {
        INDENT_STEP
    } else {
        ""
    };
    let at = |index: usize| bytes.get(index).copied();
    let mut out = String::new();
    let mut copied_to = 0;
    let mut index = 0;
    while index < bytes.len() {
        let mut current = bytes[index];
        if current == b' ' && at(index + 1) == Some(b'\\') && at(index + 2) == Some(b'n') {
            out.push_str(&json[copied_to..index]);
            out.push_str("\\ ");
            index += 1;
            copied_to = index;
            current = b'\\';
        }
        if current == b'\\' {
            match at(index + 1) {
                Some(b'u') => {
                    out.push_str(&json[copied_to..index]);
                    let code = &json[index + 2..index + 6];
                    match code {
                        "0000" => out.push_str("\\0"),
                        "0007" => out.push_str("\\a"),
                        "000b" => out.push_str("\\v"),
                        "001b" => out.push_str("\\e"),
                        _ => {
                            out.push_str("\\x");
                            out.push_str(&code[2..]);
                        }
                    }
                    index += 5;
                    copied_to = index + 1;
                }
                Some(b'n') => {
                    if implicit_key || at(index + 2) == Some(b'"') || js::utf16_len(&json) < DOUBLE_QUOTED_MIN_MULTI_LINE {
                        index += 1;
                    } else {
                        out.push_str(&json[copied_to..index]);
                        out.push_str("\n\n");
                        while at(index + 2) == Some(b'\\') && at(index + 3) == Some(b'n') && at(index + 4) != Some(b'"') {
                            out.push('\n');
                            index += 2;
                        }
                        out.push_str(line_indent);
                        if at(index + 2) == Some(b' ') {
                            out.push('\\');
                        }
                        index += 1;
                        copied_to = index + 1;
                    }
                }
                _ => index += 1,
            }
        }
        index += 1;
    }
    if copied_to == 0 {
        return json;
    }
    out.push_str(&json[copied_to..]);
    out
}

/// `blockString` при `lineWidth: 0`: всегда `|`.
fn block(text: &str, indent: &str, force_indent: bool) -> String {
    let tail_spaces = text.trim_end_matches([' ', '\t']);
    if tail_spaces.len() != text.len() && tail_spaces.ends_with('\n') {
        return quoted(text, indent, false);
    }
    let line_indent = if !indent.is_empty() {
        indent
    } else if force_indent || has_document_marker(text) {
        INDENT_STEP
    } else {
        ""
    };
    let content_end = text.trim_end_matches(['\n', '\t', ' ']).len();
    let (body, trailing) = text.split_at(content_end);
    let chomp = match trailing.find('\n') {
        None => "-",
        Some(first) if body.is_empty() || first != trailing.len() - 1 => "+",
        Some(_) => "",
    };
    let trailing = trailing.strip_suffix('\n').unwrap_or(trailing);
    // Отступ дописывается только после серии переводов, за которой что-то ещё есть
    let trailing = {
        let replaced = after_line_breaks(trailing, line_indent);
        if trailing.ends_with('\n') { replaced[..replaced.len() - line_indent.len()].to_owned() } else { replaced }
    };

    let mut has_leading_space = false;
    let mut last_break = None;
    for (position, byte) in body.bytes().enumerate() {
        match byte {
            b' ' => has_leading_space = true,
            b'\n' => last_break = Some(position),
            _ => break,
        }
    }
    let leading_end = last_break.map_or(0, |at| at + 1);
    let (leading, rest) = body.split_at(leading_end);
    let indicator = if has_leading_space {
        if line_indent.is_empty() { "1" } else { "2" }
    } else {
        ""
    };
    format!(
        "|{indicator}{chomp}\n{line_indent}{}{}{trailing}",
        after_line_breaks(leading, line_indent),
        after_line_breaks(rest, line_indent)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_key_becomes_explicit() {
        let mut map = crate::yaml::JsMap::new();
        map.insert("k".repeat(1100), Value::Number(1.0));
        let text = to_yaml(&Value::Map(map));
        assert!(text.starts_with("? kkk") && text.ends_with("\n: 1"), "{text}");
    }
}
