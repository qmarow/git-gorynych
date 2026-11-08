//! Что за сервер по домену: `detectServer` из `electron/credentials.cjs`. Адрес разбирает [`parse_server`], типы облачных сервисов известны без сети.
//!
//! Пробы идут одновременно, таймаут 6 с: GitLab `/api/v4/version` (401 с `401` в `message` или 200 с `version` и `revision`), GitHub `/api/v3/meta`,
//! Gitea `/api/v1/version`, Bitbucket `/rest/api/1.0/application-properties`. Побеждает первая в этом порядке. Ответил, но не узнан — `other`; не ответил никто — `null` и текст ошибки.

use std::time::Duration;

use gorynych_core::error::Result;
use gorynych_core::i18n::t;
use gorynych_storage::credentials::{ParsedServer, ServerKind, cloud_kind, parse_server};
use serde::Serialize;
use serde_json::Value;

use crate::json::{raw, text};
use crate::json::{Json, JsonType};

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// Итог определения.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct DetectedServer {
    pub base: String,
    pub scheme: String,
    pub host: String,
    pub hostname: String,
    pub kind: Option<ServerKind>,
    #[specta(type = Option<JsonType>)]
    pub version: Option<Json>,
    pub reachable: bool,
    pub cloud: Option<bool>,
    pub error: Option<String>,
}

enum Failure {
    Timeout,
    Other,
}

async fn http_get(client: &reqwest::Client, url: String) -> std::result::Result<(u16, Option<Value>), Failure> {
    let work = async {
        let response = client.get(url).header("Accept", "application/json").send().await?;
        let status = response.status().as_u16();
        let body = response.text().await?;
        Ok::<_, reqwest::Error>((status, serde_json::from_str(&body).ok()))
    };
    match tokio::time::timeout(PROBE_TIMEOUT, work).await {
        Err(_) => Err(Failure::Timeout),
        Ok(Err(_)) => Err(Failure::Other),
        Ok(Ok(answer)) => Ok(answer),
    }
}

fn recognized(kind: ServerKind, status: u16, json: Option<&Value>) -> bool {
    let has = |key: &str| json.is_some_and(|data| data.as_object().is_some_and(|map| map.contains_key(key)));
    let message = json.and_then(|data| text(data, "message")).unwrap_or_default();
    match kind {
        ServerKind::Gitlab => (status == 401 && message.contains("401")) || (status == 200 && json.is_some_and(|data| data.get("version").is_some_and(crate::json::truthy)) && has("revision")),
        ServerKind::Github => status == 200 && (has("installed_version") || has("verifiable_password_authentication")),
        ServerKind::Gitea => status == 200 && json.and_then(|data| data.get("version")).is_some_and(Value::is_string),
        ServerKind::Bitbucket => status == 200 && json.and_then(|data| text(data, "displayName")).unwrap_or_default().to_lowercase().contains("bitbucket"),
        ServerKind::Other => false,
    }
}

/// `detectServer`.
pub async fn detect_server(client: &reqwest::Client, input: &str) -> Result<DetectedServer> {
    let parsed = parse_server(input)?;
    let ParsedServer { base, scheme, host, hostname } = parsed;
    let make = |kind, version, reachable, cloud, error| DetectedServer { base: base.clone(), scheme: scheme.clone(), host: host.clone(), hostname: hostname.clone(), kind, version, reachable, cloud, error };
    if let Some(kind) = cloud_kind(&hostname) {
        return Ok(make(Some(kind), None, true, Some(true), None));
    }
    let probe = |kind: ServerKind, path: &'static str| {
        let (client, url) = (client.clone(), format!("{base}{path}"));
        async move {
            let answer = http_get(&client, url).await;
            (kind, answer)
        }
    };
    let (a, b, c, d) = tokio::join!(
        probe(ServerKind::Gitlab, "/api/v4/version"),
        probe(ServerKind::Github, "/api/v3/meta"),
        probe(ServerKind::Gitea, "/api/v1/version"),
        probe(ServerKind::Bitbucket, "/rest/api/1.0/application-properties"),
    );
    let mut reachable = false;
    let mut timed_out = false;
    let mut hit = None;
    for (kind, answer) in [a, b, c, d] {
        match answer {
            Ok((status, json)) => {
                reachable = true;
                if hit.is_none() && recognized(kind, status, json.as_ref()) {
                    let version = json.as_ref().and_then(|data| raw(data, "version").or_else(|| raw(data, "installed_version")));
                    hit = Some((kind, version));
                }
            }
            Err(Failure::Timeout) => timed_out = true,
            Err(Failure::Other) => {}
        }
    }
    if let Some((kind, version)) = hit {
        return Ok(make(Some(kind), version, true, None, None));
    }
    if reachable {
        return Ok(make(Some(ServerKind::Other), None, true, None, None));
    }
    let error = if timed_out { t("{0} не ответил за {1} с", &[&host, &PROBE_TIMEOUT.as_secs()]) } else { t("Нет связи с {0}", &[&host]) };
    Ok(make(None, None, false, None, Some(error)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn probes_recognize_their_servers() {
        assert!(recognized(ServerKind::Gitlab, 401, Some(&json!({"message":"401 Unauthorized"}))));
        assert!(!recognized(ServerKind::Gitlab, 401, Some(&json!({"message":"нет"}))));
        assert!(recognized(ServerKind::Gitlab, 200, Some(&json!({"version":"17","revision":"x"}))));
        assert!(!recognized(ServerKind::Gitlab, 200, Some(&json!({"version":"17"}))));
        assert!(recognized(ServerKind::Github, 200, Some(&json!({"installed_version":"3"}))));
        assert!(recognized(ServerKind::Gitea, 200, Some(&json!({"version":"1"}))));
        assert!(!recognized(ServerKind::Gitea, 200, Some(&json!({"version":1}))));
        assert!(recognized(ServerKind::Bitbucket, 200, Some(&json!({"displayName":"Bitbucket"}))));
        assert!(!recognized(ServerKind::Other, 200, None));
    }
}
