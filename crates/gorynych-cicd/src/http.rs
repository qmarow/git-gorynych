//! HTTP для API провайдеров: `electron/cicd/http.cjs`.
//!
//! ## Конспект
//! - `request(ctx, method, path, opts)`: абсолютный адрес берётся как есть, иначе `apiBase + path`. Пустые значения запроса не передаются.
//! - Авторизация — только своему серверу (`url.host === apiBase.host`): ссылки на логи и артефакты уводят на хранилище с подписанным адресом.
//! - `Accept`: свой, `text/plain, */*` для текста, иначе `application/json`. `Content-Type` — только с телом. `User-Agent: git-Gorynych`.
//! - Таймаут 20 с — до получения заголовков ответа, как `clearTimeout` в 1.x; у артефактов 10 минут. Сбой сети и таймаут — `NETWORK`.
//! - Сообщение ошибки: `message ?? error.message ?? error ?? errors[0].message`, не строка — `JSON.stringify`, не JSON — пусто.
//! - 401 `AUTH`; 403 `RATE_LIMIT` при `x-ratelimit-remaining: 0`, иначе `FORBIDDEN` с `scopeHint`; 404 `NOT_FOUND`; 400/409/422 `VALIDATION`; 429 `RATE_LIMIT`; прочее `API_ERROR`.
//! - Текст: хвост не больше `MAX_LOG` и исходный `size`. JSON: пустое тело — `null`; при 202 и 204 нечитаемое тело — тоже `null`.
//!
//! ## Отличия от 1.x
//! - Нечитаемый JSON в успешном ответе остаётся кодом `UNKNOWN`, но текст ошибки другой: в 1.x это сообщение `SyntaxError` из V8.
//! - `details` у `NETWORK` — текст ошибки `reqwest`, а не `fetch`.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use serde::Serialize;
use serde_json::Value;
use url::Url;

use crate::json::js_string;

pub const TIMEOUT: Duration = Duration::from_secs(20);
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
/// 1,5 МБ.
pub const MAX_LOG: usize = 1_572_864;

/// HTTP-клиент для всего приложения: один на процесс, потому что сборка читает корневые сертификаты ОС.
pub fn client() -> reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        // Ошибка значит, что провайдер уже выбран: это тоже подходит.
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder().build().expect("настройки клиента корректны")
    });
    CLIENT.clone()
}

/// Кому и с какой авторизацией отправлять запросы.
#[derive(Clone)]
pub struct HttpCtx {
    pub client: reqwest::Client,
    pub api_base: String,
    pub headers: Vec<(String, String)>,
    /// «GitHub», «Gitea», «Bitbucket» для сообщений.
    pub label: String,
    pub scope_hint: Option<String>,
}

/// Параметры запроса.
#[derive(Default)]
pub struct Opts {
    pub query: Vec<(String, String)>,
    pub body: Option<Value>,
    pub not_found: Option<String>,
    pub accept: Option<String>,
    pub timeout: Option<Duration>,
}

impl Opts {
    pub fn query(pairs: &[(&str, Option<String>)]) -> Self {
        let mut opts = Self::default();
        opts.add_query(pairs);
        opts
    }

    /// Пустые значения пропускаются: `v != null && v !== ''`.
    pub fn add_query(&mut self, pairs: &[(&str, Option<String>)]) {
        for (key, value) in pairs {
            if let Some(value) = value.as_ref().filter(|value| !value.is_empty()) {
                self.query.push(((*key).to_owned(), value.clone()));
            }
        }
    }

    pub fn body(body: Value) -> Self {
        Self { body: Some(body), ..Self::default() }
    }

    pub fn not_found(message: String) -> Self {
        Self { not_found: Some(message), ..Self::default() }
    }

    pub fn with_not_found(mut self, message: String) -> Self {
        self.not_found = Some(message);
        self
    }
}

/// Текст лога.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LogChunk {
    pub text: String,
    pub size: u64,
}

/// Скачанный файл.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Downloaded {
    pub path: String,
    pub size: u64,
}

/// `new URL(...)` с параметрами запроса.
pub(crate) fn build_url(address: &str, query: &[(String, String)]) -> Result<Url> {
    let mut url = Url::parse(address).map_err(|_| GorynychError::unknown("Invalid URL"))?;
    if !query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            pairs.append_pair(key, value);
        }
    }
    Ok(url)
}

/// `url.host`: имя и порт.
pub(crate) fn host_of(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    url.port().map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"))
}

fn is_http(address: &str) -> bool {
    address.starts_with("http://") || address.starts_with("https://")
}

/// Текст ошибки из тела ответа.
fn error_message(body: &str) -> String {
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return String::new();
    };
    let present = |value: Option<&Value>| value.filter(|item| !item.is_null()).cloned();
    let message = present(data.get("message"))
        .or_else(|| present(data.get("error").and_then(|error| error.get("message"))))
        .or_else(|| present(data.get("error")))
        .or_else(|| present(data.get("errors").and_then(|errors| errors.get(0)).and_then(|first| first.get("message"))));
    match message {
        None => String::new(),
        Some(Value::String(text)) => text,
        Some(other) => other.to_string(),
    }
}

async fn send(ctx: &HttpCtx, method: reqwest::Method, api_path: &str, opts: &Opts, text: bool) -> Result<reqwest::Response> {
    let address = if is_http(api_path) { api_path.to_owned() } else { format!("{}{api_path}", ctx.api_base) };
    let url = build_url(&address, &opts.query)?;
    let same_host = Url::parse(&ctx.api_base).is_ok_and(|base| host_of(&base) == host_of(&url));
    let timeout = opts.timeout.unwrap_or(TIMEOUT);
    let host = host_of(&url);

    let mut request = ctx.client.request(method, url);
    if same_host {
        for (name, value) in &ctx.headers {
            request = request.header(name, value);
        }
    }
    let accept = opts.accept.as_deref().unwrap_or(if text { "text/plain, */*" } else { "application/json" });
    request = request.header("Accept", accept).header("User-Agent", "git-Gorynych");
    if let Some(body) = &opts.body {
        request = request.header("Content-Type", "application/json").body(body.to_string());
    }

    let network = |message: String, details: String| {
        GorynychError::new(ErrorCode::Network, message).with_hint(t("Проверьте интернет, VPN и адрес API {0}", &[&ctx.label])).with_details(details)
    };
    let response = match tokio::time::timeout(timeout, request.send()).await {
        Err(_) => return Err(network(t("{0} не ответил за {1} с", &[&ctx.label, &timeout.as_secs()]), "This operation was aborted".to_owned())),
        Ok(Err(error)) => return Err(network(t("Нет связи с {0}", &[&host]), error.to_string())),
        Ok(Ok(response)) => response,
    };
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status().as_u16();
    let limited = response.headers().get("x-ratelimit-remaining").is_some_and(|value| value == "0");
    let message = error_message(&response.text().await.unwrap_or_default());
    Err(match status {
        401 => GorynychError::new(ErrorCode::Auth, t("{0} не принял авторизацию репозитория", &[&ctx.label]))
            .with_hint(t("Токен неверный, отозван или истёк — обновите авторизацию репозитория", &[]))
            .with_details(message),
        403 if limited => GorynychError::new(ErrorCode::RateLimit, t("{0} ограничил частоту запросов — попробуйте позже", &[&ctx.label])).with_details(message),
        403 => GorynychError::new(ErrorCode::Forbidden, t("Недостаточно прав", &[]))
            .with_hint(ctx.scope_hint.clone().unwrap_or_else(|| t("У токена нет нужного права или ваша роль в репозитории не позволяет это действие", &[])))
            .with_details(message),
        404 => match &opts.not_found {
            Some(text) => GorynychError::new(ErrorCode::NotFound, text.clone()).with_details(message),
            None => GorynychError::new(ErrorCode::NotFound, t("Не найдено в {0}", &[&ctx.label]))
                .with_hint(t("Репозиторий не существует, у токена нет к нему доступа или {0} не поддерживает этот запрос", &[&ctx.label]))
                .with_details(message),
        },
        400 | 409 | 422 => {
            let text = if message.is_empty() { t("{0} отклонил запрос", &[&ctx.label]) } else { format!("{}: {message}", ctx.label) };
            GorynychError::new(ErrorCode::Validation, text).with_details(message)
        }
        429 => GorynychError::new(ErrorCode::RateLimit, t("{0} ограничил частоту запросов — попробуйте через минуту", &[&ctx.label])),
        _ => GorynychError::new(ErrorCode::ApiError, t("{0} вернул ошибку {1}", &[&ctx.label, &status])).with_details(message),
    })
}

/// Запрос с ответом в JSON; пустое тело — `null`.
pub async fn request(ctx: &HttpCtx, method: reqwest::Method, api_path: impl AsRef<str>, opts: Opts) -> Result<Value> {
    let response = send(ctx, method, api_path.as_ref(), &opts, false).await?;
    let lenient = matches!(response.status().as_u16(), 202 | 204);
    let body = response.text().await.unwrap_or_default();
    if body.is_empty() {
        return Ok(Value::Null);
    }
    match serde_json::from_str(&body) {
        Ok(value) => Ok(value),
        Err(_) if lenient => Ok(Value::Null),
        Err(error) => Err(GorynychError::unknown(error)),
    }
}

/// Хвост большого текста: нарезка может попасть внутрь символа, тогда он заменяется, как `toString('utf8')`.
pub(crate) fn log_tail(bytes: &[u8]) -> LogChunk {
    LogChunk { text: String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(MAX_LOG)..]).into_owned(), size: bytes.len() as u64 }
}

/// Запрос с ответом-текстом.
pub async fn request_text(ctx: &HttpCtx, method: reqwest::Method, api_path: impl AsRef<str>, opts: Opts) -> Result<LogChunk> {
    let response = send(ctx, method, api_path.as_ref(), &opts, true).await?;
    let bytes = response.bytes().await.map_err(GorynychError::unknown)?;
    Ok(log_tail(&bytes))
}

/// Скачивает файл на диск потоком.
pub async fn download(ctx: &HttpCtx, api_path: &str, dest: &Path, mut opts: Opts) -> Result<Downloaded> {
    use tokio::io::AsyncWriteExt;
    opts.accept = Some("*/*".to_owned());
    opts.timeout = Some(DOWNLOAD_TIMEOUT);
    let mut response = send(ctx, reqwest::Method::GET, api_path, &opts, false).await?;
    let mut file = tokio::fs::File::create(dest).await.map_err(GorynychError::unknown)?;
    let mut size = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(GorynychError::unknown)? {
        size += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(GorynychError::unknown)?;
    }
    file.flush().await.map_err(GorynychError::unknown)?;
    Ok(Downloaded { path: dest.to_string_lossy().into_owned(), size })
}

/// Текст значения для пути URL: `${value}`.
pub fn path_text(value: &Value) -> String {
    js_string(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn error_message_follows_the_order_of_1x() {
        assert_eq!(error_message(r#"{"message":"m","error":"e"}"#), "m");
        assert_eq!(error_message(r#"{"error":{"message":"вложенное"}}"#), "вложенное");
        assert_eq!(error_message(r#"{"error":"e"}"#), "e");
        assert_eq!(error_message(r#"{"errors":[{"message":"первое"}]}"#), "первое");
        assert_eq!(error_message(r#"{"message":{"b":1,"a":[2]}}"#), r#"{"b":1,"a":[2]}"#);
        assert_eq!(error_message("<html>"), "");
        assert_eq!(error_message("null"), "");
    }

    #[tokio::test]
    async fn timeout_gives_network_error_with_the_label() {
        // Сервер принимает соединение и молчит
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let ctx = HttpCtx { client: client(), api_base: base, headers: Vec::new(), label: "GitHub".to_owned(), scope_hint: None };
        let opts = Opts { timeout: Some(Duration::from_secs(1)), ..Opts::default() };
        let error = request(&ctx, reqwest::Method::GET, "/x", opts).await.unwrap_err();
        drop(listener);
        assert_eq!(error.code, ErrorCode::Network);
        assert_eq!(error.message, "GitHub не ответил за 1 с");
        assert_eq!(error.hint.as_deref(), Some("Проверьте интернет, VPN и адрес API GitHub"));
    }

    #[tokio::test]
    async fn authorization_goes_only_to_own_host() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let count = stream.read(&mut buffer).unwrap();
            let head = String::from_utf8_lossy(&buffer[..count]).to_lowercase();
            stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}").unwrap();
            head
        });
        let ctx = HttpCtx { client: client(), api_base: "https://api.example".to_owned(), headers: vec![("Authorization".to_owned(), "Bearer секрет".replace("секрет", "s"))], label: "GitHub".to_owned(), scope_hint: None };
        request(&ctx, reqwest::Method::GET, format!("http://127.0.0.1:{port}/signed"), Opts::default()).await.unwrap();
        let head = server.join().unwrap();
        assert!(!head.contains("authorization"), "{head}");
        assert!(head.contains("user-agent: git-gorynych"), "{head}");
    }

    #[test]
    fn empty_query_values_are_skipped() {
        let opts = Opts::query(&[("a", Some("1".into())), ("b", None), ("c", Some(String::new()))]);
        assert_eq!(opts.query, [("a".to_owned(), "1".to_owned())]);
        let url = build_url("https://x/y", &[("filter[scope]".into(), "a b".into())]).unwrap();
        assert_eq!(url.as_str(), "https://x/y?filter%5Bscope%5D=a+b");
    }

    #[test]
    fn log_keeps_the_tail_and_the_original_size() {
        let bytes = vec![b'x'; MAX_LOG + 5];
        let chunk = log_tail(&bytes);
        assert_eq!((chunk.text.len(), chunk.size), (MAX_LOG, MAX_LOG as u64 + 5));
        assert_eq!(path_text(&json!(12)), "12");
    }
}
