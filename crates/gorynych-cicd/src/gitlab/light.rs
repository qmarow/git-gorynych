//! `branchHeads`: хэши веток через API GitLab с ETag, для фонового опроса `remoteWatch` (Фаза 3). Ответ 304 почти ничего не стоит серверу.

use std::path::Path;
use std::time::Duration;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_storage::repo_providers::CiProvider;
use indexmap::IndexMap;

use crate::json::text;
use crate::service::CicdService;

const LIGHT_TIMEOUT: Duration = Duration::from_secs(8);
const LIGHT_MAX_PAGES: u32 = 20;
const MAX_CACHE: usize = 300;

/// Закэшированная страница.
#[derive(Clone)]
pub(crate) struct EtagEntry {
    etag: Option<String>,
    list: Vec<(String, String)>,
    next: Option<String>,
}

/// Сколько секунд просит подождать сервер: у ошибки `RATE_LIMIT` из `branchHeads` (`err.retryAfter` в 1.x).
pub fn retry_after(error: &GorynychError) -> Option<u64> {
    error.details.strip_prefix("retry-after: ")?.parse().ok()
}

impl CicdService {
    /// Ветки на сервере: имя → хэш. `None` — для этого remote нет токена GitLab, вызывающий идёт в `ls-remote`.
    pub async fn gitlab_branch_heads(&self, root: &Path, remote_name: &str) -> Result<Option<IndexMap<String, String>>> {
        let Some(remote) = self.gitlab_detect_remote(root, Some(remote_name)).await? else {
            return Ok(None);
        };
        if remote.kind != Some(CiProvider::Gitlab) || remote.remote != remote_name {
            return Ok(None);
        }
        let Some(token) = self.gitlab_token_for_remote(&remote) else {
            return Ok(None);
        };
        let mut heads = IndexMap::new();
        let mut page: f64 = 1.0;
        for _ in 0..LIGHT_MAX_PAGES {
            let url = format!("{}/api/v4/projects/{}/repository/branches?per_page=100&page={}", remote.base, js::encode_uri_component(&remote.path), js::number_to_string(page));
            let cached = self.inner.etag_cache.lock().expect("кэш ETag").get(&url).cloned();
            let (name, value) = token.header();
            let mut request = self.inner.client.get(&url).header(name, value).header("Accept", "application/json");
            if let Some(etag) = cached.as_ref().and_then(|entry| entry.etag.as_deref()) {
                request = request.header("If-None-Match", etag);
            }
            let network = |details: String| GorynychError::new(ErrorCode::Network, t("Нет связи с {0}", &[&remote.host])).with_details(details);
            let response = match tokio::time::timeout(LIGHT_TIMEOUT, request.send()).await {
                Err(_) => return Err(network("This operation was aborted".to_owned())),
                Ok(Err(error)) => return Err(network(error.to_string())),
                Ok(Ok(response)) => response,
            };
            let status = response.status().as_u16();
            let header = |name: &str| response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned);
            let unchanged = if status == 304 { cached } else { None };
            let entry = if let Some(entry) = unchanged {
                entry
            } else if response.status().is_success() {
                let (etag, next) = (header("etag"), header("x-next-page").filter(|next| !next.is_empty()));
                let body = response.text().await.map_err(GorynychError::unknown)?;
                let data: serde_json::Value = serde_json::from_str(&body).map_err(GorynychError::unknown)?;
                let list = data
                    .as_array()
                    .map_or(&[][..], Vec::as_slice)
                    .iter()
                    .filter_map(|branch| {
                        let name = text(branch, "name").filter(|name| !name.is_empty())?;
                        let hash = branch.get("commit").and_then(|commit| text(commit, "id")).filter(|hash| !hash.is_empty())?;
                        Some((name, hash))
                    })
                    .collect();
                let entry = EtagEntry { etag, list, next };
                if entry.etag.is_some() {
                    let mut cache = self.inner.etag_cache.lock().expect("кэш ETag");
                    cache.insert(url, entry.clone());
                    if cache.len() > MAX_CACHE {
                        cache.shift_remove_index(0);
                    }
                }
                entry
            } else if status == 429 {
                let wait = header("retry-after").and_then(|value| value.parse::<f64>().ok()).filter(|value| *value != 0.0 && !value.is_nan());
                let details = wait.map_or_else(String::new, |value| format!("retry-after: {}", js::number_to_string(value)));
                return Err(GorynychError::new(ErrorCode::RateLimit, t("GitLab ограничил частоту запросов", &[])).with_details(details));
            } else {
                // 401, 403, 404 и прочее: токен не подходит для этого проекта; вызывающий перейдёт на ls-remote
                let code = match status {
                    401 => ErrorCode::Auth,
                    403 => ErrorCode::Forbidden,
                    _ => ErrorCode::GitlabError,
                };
                return Err(GorynychError::new(code, t("GitLab вернул {0}", &[&status])));
            };
            for (name, hash) in entry.list {
                heads.insert(name, hash);
            }
            let Some(next) = entry.next else {
                break;
            };
            page = next.parse().unwrap_or(f64::NAN);
        }
        Ok(Some(heads))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_is_read_from_details() {
        let error = GorynychError::new(ErrorCode::RateLimit, "x").with_details("retry-after: 30");
        assert_eq!(retry_after(&error), Some(30));
        assert_eq!(retry_after(&GorynychError::new(ErrorCode::RateLimit, "x")), None);
    }
}
