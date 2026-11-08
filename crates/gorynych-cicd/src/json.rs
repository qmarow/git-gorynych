//! Чтение ответов API с поведением JS: отсутствующее поле — `undefined`, а не ошибка. Значения `serde_json::Value` остаются внутри крейта:
//! через IPC идут типы из [`crate::models`].

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use gorynych_core::error::{GorynychError, Result};
use gorynych_core::js;
use serde_json::Value;

/// Значение из ответа сервера, которое передаётся как есть.
pub type Json = Value;

/// Тип такого значения в TypeScript: тот же JSON, но число без `bigint`, на который `specta` запрещает в `serde_json::Value`.
pub type JsonType = gorynych_ci_linter::yaml::Value;

/// Значение поля, если оно не `null`.
pub fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|item| !item.is_null())
}

/// Строковое поле.
pub fn text(value: &Value, key: &str) -> Option<String> {
    field(value, key).and_then(Value::as_str).map(str::to_owned)
}

/// Непустое строковое поле: `a || b`.
pub fn non_empty(value: &Value, key: &str) -> Option<String> {
    text(value, key).filter(|item| !item.is_empty())
}

/// Значение поля как есть.
pub fn raw(value: &Value, key: &str) -> Option<Json> {
    field(value, key).cloned()
}

/// `Boolean(value.key)`.
pub fn flag(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(truthy)
}

/// Необязательное логическое поле.
pub fn opt_bool(value: &Value, key: &str) -> Option<bool> {
    field(value, key).and_then(Value::as_bool)
}

/// Числовое поле как есть: `12` и `12.5` не меняют записи.
pub fn number(value: &Value, key: &str) -> Option<serde_json::Number> {
    match field(value, key)? {
        Value::Number(number) => Some(number.clone()),
        _ => None,
    }
}

/// Элементы массива; остальное — пусто.
pub fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// Список строк.
pub fn strings(value: &Value, key: &str) -> Vec<String> {
    items(value, key).iter().map(js_string).collect()
}

/// `${value.key}`: нет поля — `undefined`, `null` — `null`.
pub fn template(value: Option<&Value>, key: &str) -> String {
    value.and_then(|item| item.get(key)).map_or_else(|| "undefined".to_owned(), js_string)
}

/// Истинность значения в JS.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|item| item != 0.0 && !item.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(value)`.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.as_f64().map_or_else(|| number.to_string(), js::number_to_string),
        Value::String(text) => text.clone(),
        Value::Array(list) => list.iter().map(|item| if item.is_null() { String::new() } else { js_string(item) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

fn parse_date(text: &str) -> Option<DateTime<Utc>> {
    if let Ok(date) = DateTime::parse_from_rfc3339(text) {
        return Some(date.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return date.and_hms_opt(0, 0, 0).map(|moment| moment.and_utc());
    }
    let local = NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    chrono::Local.from_local_datetime(&local).earliest().map(|date| date.with_timezone(&Utc))
}

fn date_of(value: &Value) -> Option<DateTime<Utc>> {
    match value {
        Value::String(text) => parse_date(text),
        Value::Number(number) => DateTime::from_timestamp_millis(number.as_f64()? as i64),
        _ => None,
    }
}

/// `iso`: `new Date(v).toISOString()`, пустое значение — `None`. Нечитаемая дата — та же ошибка, что в JS.
pub fn iso(value: Option<&Value>) -> Result<Option<String>> {
    let Some(value) = value.filter(|item| truthy(item)) else {
        return Ok(None);
    };
    let date = date_of(value).ok_or_else(|| GorynychError::unknown("Invalid time value"))?;
    Ok(Some(date.to_rfc3339_opts(SecondsFormat::Millis, true)))
}

/// Поле с датой.
pub fn iso_field(value: &Value, key: &str) -> Result<Option<String>> {
    iso(value.get(key))
}

/// `secondsBetween`: целые секунды, не меньше нуля.
pub fn seconds_between(from: Option<&Value>, to: Option<&Value>) -> Option<u64> {
    let (from, to) = (from.filter(|item| truthy(item))?, to.filter(|item| truthy(item))?);
    let millis = date_of(to)?.timestamp_millis() - date_of(from)?.timestamp_millis();
    Some(((millis as f64 / 1000.0).round().max(0.0)) as u64)
}

/// Давность в миллисекундах: `Date.now() - new Date(v).getTime()`.
pub fn age_millis(value: Option<&Value>) -> Option<i64> {
    Some(Utc::now().timestamp_millis() - date_of(value?)?.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn iso_matches_to_iso_string() {
        let cases = [
            ("2024-01-02T03:04:05Z", "2024-01-02T03:04:05.000Z"),
            ("2024-01-02T03:04:05.123456+00:00", "2024-01-02T03:04:05.123Z"),
            ("2024-01-02T06:04:05+03:00", "2024-01-02T03:04:05.000Z"),
            ("2024-01-02", "2024-01-02T00:00:00.000Z"),
        ];
        for (input, expected) in cases {
            assert_eq!(iso(Some(&json!(input))).unwrap().as_deref(), Some(expected));
        }
        assert_eq!(iso(None).unwrap(), None);
        assert_eq!(iso(Some(&json!(""))).unwrap(), None);
        assert_eq!(iso(Some(&json!("вчера"))).unwrap_err().message, "Invalid time value");
    }

    #[test]
    fn seconds_round_and_do_not_go_negative() {
        let at = |text: &str| json!(text);
        assert_eq!(seconds_between(Some(&at("2024-01-01T00:00:00Z")), Some(&at("2024-01-01T00:00:01.500Z"))), Some(2));
        assert_eq!(seconds_between(Some(&at("2024-01-01T00:00:10Z")), Some(&at("2024-01-01T00:00:00Z"))), Some(0));
        assert_eq!(seconds_between(None, Some(&at("2024-01-01T00:00:00Z"))), None);
    }
}
