//! Запросы к API GitLab: `request`, `validationMessage`, `fetchAll` из `gitlab.cjs`. Отличия от общего [`crate::http`]: свои тексты, код `GITLAB_ERROR`,
//! перевод ошибок проверки и пустой ответ 200 считается ошибкой (`res.json()`).

use std::sync::LazyLock;
use std::time::Duration;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use regex::{NoExpand, Regex};
use serde_json::Value;
use url::Url;

use crate::http::{LogChunk, Opts, build_url, host_of, log_tail, send_following};
use crate::json::js_string;

pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Токен: личный идёт в `PRIVATE-TOKEN`, OAuth — в `Authorization: Bearer`.
#[derive(Clone, PartialEq, Eq)]
pub enum GlToken {
    Private(String),
    Bearer(String),
}

impl GlToken {
    pub fn value(&self) -> &str {
        match self {
            Self::Private(value) | Self::Bearer(value) => value,
        }
    }

    pub(crate) fn header(&self) -> (String, String) {
        match self {
            Self::Private(value) => ("PRIVATE-TOKEN".to_owned(), value.clone()),
            Self::Bearer(value) => ("Authorization".to_owned(), format!("Bearer {value}")),
        }
    }
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("корректный шаблон")
}

static PHRASES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (regex("(?i)has already been taken"), "уже существует"),
        (regex("(?i)can't be blank|is missing"), "не может быть пустым"),
        (regex("(?i)is invalid"), "недопустимое значение"),
        (regex("(?i)is too long"), "слишком длинное"),
        (regex("(?i)is too short"), "слишком короткое"),
        (regex("(?i)cannot be masked|must be masked|unable to be masked"), "нельзя замаскировать"),
    ]
});

fn field_name(key: &str) -> String {
    let ru = match key {
        "key" => "Имя",
        "value" => "Значение",
        "cron" => "Расписание (cron)",
        "cron_timezone" => "Часовой пояс",
        "ref" => "Ветка",
        "description" => "Описание",
        "environment_scope" => "Окружение",
        other => return other.to_owned(),
    };
    t(ru, &[])
}

fn translate(text: &str) -> String {
    PHRASES.iter().fold(text.to_owned(), |text, (pattern, ru)| pattern.replace(&text, NoExpand(&t(ru, &[]))).into_owned())
}

/// `[].concat(v).map(translate).join(', ')`.
fn field_text(value: &Value) -> String {
    match value {
        Value::Array(list) => list.iter().map(|item| translate(&js_string(item))).collect::<Vec<_>>().join(", "),
        other => translate(&js_string(other)),
    }
}

fn validation_message(fields: Option<&Value>, message: &str) -> String {
    let parts: Vec<String> = match fields {
        Some(Value::Object(map)) => map.iter().map(|(key, value)| format!("{}: {}", field_name(key), field_text(value))).collect(),
        Some(Value::Array(list)) => list.iter().enumerate().map(|(index, value)| format!("{index}: {}", field_text(value))).collect(),
        _ => Vec::new(),
    };
    if !parts.is_empty() {
        return parts.join("; ");
    }
    if message.is_empty() { t("GitLab отклонил запрос", &[]) } else { translate(message) }
}

fn validation_hint(fields: Option<&Value>, message: &str) -> Option<String> {
    let all = format!("{} {message}", fields.map_or_else(|| "{}".to_owned(), Value::to_string)).to_lowercase();
    if all.contains("mask") {
        return Some(masked_hint());
    }
    if all.contains("cron") {
        return Some(t("Формат cron: «минуты часы день месяц день_недели», например «0 3 * * *» — каждый день в 3:00", &[]));
    }
    if all.contains("key") {
        return Some(t("Имя переменной: латинские буквы, цифры и _", &[]));
    }
    None
}

/// Подсказка про маскированное значение.
pub(crate) fn masked_hint() -> String {
    t("Маскированное значение: одна строка, не короче 8 символов, только буквы, цифры и символы @ : . ~ - _ + / =", &[])
}

async fn send(client: &reqwest::Client, base: &str, token: &GlToken, method: reqwest::Method, api_path: &str, opts: &Opts, text: bool) -> Result<reqwest::Response> {
    let url = build_url(&format!("{base}/api/v4{api_path}"), &opts.query)?;
    let auth = [token.header()];
    let headers = [("Accept", if text { "text/plain" } else { "application/json" })];
    let body = opts.body.as_ref().map(Value::to_string);
    let network = |message: String, details: String| {
        GorynychError::new(ErrorCode::Network, message).with_hint(t("Проверьте интернет, VPN и адрес сервера GitLab", &[])).with_details(details)
    };
    let response = match tokio::time::timeout(REQUEST_TIMEOUT, send_following(client, method, url, &auth, &headers, body)).await {
        Err(_) => return Err(network(t("GitLab не ответил за {0} с", &[&REQUEST_TIMEOUT.as_secs()]), "This operation was aborted".to_owned())),
        Ok(Err(error)) => {
            let host = Url::parse(base).map(|url| host_of(&url)).unwrap_or_default();
            return Err(network(t("Нет связи с {0}", &[&host]), error.to_string()));
        }
        Ok(Ok(response)) => response,
    };
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status().as_u16();
    let data: Option<Value> = serde_json::from_str(&response.text().await.unwrap_or_default()).ok();
    let message_field = data.as_ref().and_then(|data| data.get("message")).filter(|value| crate::json::truthy(value));
    let fields = message_field.filter(|value| value.is_object() || value.is_array());
    let message = match message_field {
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
        None => data.as_ref().and_then(|data| data.get("error")).filter(|value| !value.is_null()).map(js_string).unwrap_or_default(),
    };
    Err(match status {
        401 => GorynychError::new(ErrorCode::Auth, t("GitLab отклонил токен", &[]))
            .with_hint(t("Токен неверный, отозван или истёк — создайте новый и сохраните его заново", &[]))
            .with_details(message),
        403 => GorynychError::new(ErrorCode::Forbidden, t("Недостаточно прав", &[]))
            .with_hint(if message.to_lowercase().contains("scope") {
                t("У токена нет нужного права (scope). Для действий нужен scope «api», для просмотра — «read_api»", &[])
            } else {
                t("Ваша роль в проекте не позволяет это действие", &[])
            })
            .with_details(message),
        404 => match &opts.not_found {
            Some(text) => GorynychError::new(ErrorCode::NotFound, text.clone()).with_details(message),
            None => GorynychError::new(ErrorCode::NotFound, t("Не найдено в GitLab", &[])).with_hint(t("Проект не существует или у токена нет к нему доступа", &[])).with_details(message),
        },
        400 | 409 | 422 => {
            let mut error = GorynychError::new(ErrorCode::Validation, validation_message(fields, &message)).with_details(message.clone());
            if let Some(hint) = validation_hint(fields, &message) {
                error = error.with_hint(hint);
            }
            error
        }
        429 => GorynychError::new(ErrorCode::RateLimit, t("GitLab ограничил частоту запросов — попробуйте через минуту", &[])),
        _ => GorynychError::new(ErrorCode::GitlabError, t("GitLab вернул ошибку {0}", &[&status])).with_details(message),
    })
}

/// Запрос с ответом в JSON; 204 — `null`.
pub(crate) async fn request(client: &reqwest::Client, base: &str, token: &GlToken, method: reqwest::Method, api_path: &str, opts: Opts) -> Result<Value> {
    let response = send(client, base, token, method, api_path, &opts, false).await?;
    if response.status().as_u16() == 204 {
        return Ok(Value::Null);
    }
    let body = response.text().await.map_err(GorynychError::unknown)?;
    serde_json::from_str(&body).map_err(GorynychError::unknown)
}

/// Запрос с ответом-текстом: хвост лога.
pub(crate) async fn request_text(client: &reqwest::Client, base: &str, token: &GlToken, api_path: impl AsRef<str>) -> Result<LogChunk> {
    let response = send(client, base, token, reqwest::Method::GET, api_path.as_ref(), &Opts::default(), true).await?;
    let bytes = response.bytes().await.map_err(GorynychError::unknown)?;
    Ok(log_tail(&bytes))
}

/// `fetchAll`: по 100 записей, пока страница полная.
pub(crate) async fn fetch_all(client: &reqwest::Client, base: &str, token: &GlToken, api_path: &str, max_pages: u32) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for page in 1..=max_pages {
        let opts = Opts::query(&[("per_page", Some("100".to_owned())), ("page", Some(page.to_string()))]);
        let items = request(client, base, token, reqwest::Method::GET, api_path, opts).await?;
        let items = match items {
            Value::Array(list) => list,
            other => return Err(GorynychError::unknown(format!("items is not iterable: {other}"))),
        };
        let full = items.len() >= 100;
        out.extend(items);
        if !full {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validation_is_translated_by_field() {
        let fields = json!({"key": ["has already been taken"], "cron": "is invalid", "свое": ["is too long", "is too short"]});
        assert_eq!(validation_message(Some(&fields), "x"), "Имя: уже существует; Расписание (cron): недопустимое значение; свое: слишком длинное, слишком короткое");
        assert_eq!(validation_message(None, "value is invalid"), "value недопустимое значение");
        assert_eq!(validation_message(None, ""), "GitLab отклонил запрос");
    }

    #[test]
    fn hint_depends_on_text() {
        assert!(validation_hint(None, "cannot be MASKED").unwrap().contains("Маскированное"));
        assert!(validation_hint(Some(&json!({"cron": ["bad"]})), "").unwrap().contains("cron"));
        assert!(validation_hint(Some(&json!({"key": ["bad"]})), "").unwrap().contains("Имя"));
        assert_eq!(validation_hint(None, "другое"), None);
    }
}
