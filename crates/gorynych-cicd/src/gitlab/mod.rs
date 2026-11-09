//! Интеграция с GitLab API: `electron/gitlab.cjs`. Каналы `gitlab:*`: их используют панель пайплайнов, переменные, расписания, CI Lint и создание MR.
//!
//! ## Конспект
//! - Авторизация по порядку (`authOptions`): `login` (вход репозитория) → `legacy` (старый токен репозитория) → `legacy-shared` (старый токен сервера) → `login-shared`.
//! - `verifyLogin`: `/user` и `/personal_access_tokens/self`; при `AUTH` повтор как Bearer (OAuth); `FORBIDDEN` → права токена, чтобы назвать, чего не хватает; нужен `api` или `read_api`.
//!   Результат запоминается, `bad` — на 10 минут; `NETWORK` и `RATE_LIMIT` не запоминаются (`unknown`). Отпечаток — первые 24 символа sha256(`base␤secret`).
//! - `migrateLegacy`: старый токен становится `apiToken` входа с паролем или SSH-ключом, запись старого токена удаляется.
//! - Проект кэшируется на 10 минут по `base|path|последние 6 символов токена`; `accessLevel` = max(project, group).
//! - `branchHeads`: ветки через API с ETag (≤20 страниц, таймаут 8 с, кэш ≤300 адресов); `null` — токена нет, вызывающий идёт в `ls-remote`.
//!
//! ## Отличия от 1.x
//! - **Исправлено по решению пользователя:** в 1.x `PRIVATE-TOKEN` уходил на чужой сервер при редиректе (`fetch` снимает при смене хоста только
//!   `Authorization`), например в объектное хранилище за артефактом. Теперь переходы идут через [`crate::http::send_following`], и при смене
//!   источника авторизация снимается. Сценарий «артефакт редиректом на другой сервер» сверяется с этой поправкой (`cicd_parity.rs`).
//! - **`setToken` и `clearToken` не перенесены**: у каналов `gitlab:set-token` и `gitlab:clear-token` нет вызовов в `src/`, авторизация в приложении одна.
//! - `listTokens` — в порядке ключей, а не добавления записей. Интерфейс сортирует репозитории сам.
//! - Лишних запросов `git remote -v` нет: адаптер использует готовый контекст, а не собирает его заново для каждого вызова.

mod api;
mod auth;
pub mod http;
mod light;

use std::path::Path;
use std::time::Instant;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_storage::credentials::{LegacyCiUser, LoginScope, ServerKind};
use gorynych_storage::repo_providers::CiProvider;
use serde::Serialize;
use sha2::{Digest, Sha256};

pub use api::*;
pub use auth::*;
pub use http::GlToken;
pub(crate) use light::EtagEntry;
pub use light::retry_after;

use crate::http::Opts;
use crate::json::{field, number, text};
use crate::models::{CiId, TokenStatus};
use crate::remote::{is_http_url, parse_remote_url, parse_remotes, pick_remote, site_base};
use crate::service::CicdService;

pub(crate) const PROJECT_CACHE_MS: u128 = 10 * 60 * 1000;

/// Remote и, если это GitLab, состояние авторизации: `detectRemote`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlRemoteStatus {
    pub kind: Option<CiProvider>,
    pub remote: String,
    pub url: String,
    pub protocol: String,
    pub host: String,
    pub base: String,
    pub path: String,
    pub web_url: String,
    pub token: TokenStatus,
}

/// Проект GitLab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlProject {
    pub id: Option<CiId>,
    pub name: Option<String>,
    pub path: Option<String>,
    pub web_url: Option<String>,
    pub default_branch: Option<String>,
    #[specta(type = f64)]
    pub access_level: i64,
}

/// Сведения о токене для запросов.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GlMeta {
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
}

/// Контекст запросов к проекту.
#[derive(Clone)]
pub struct GlCtx {
    pub client: reqwest::Client,
    pub remote: GlRemoteStatus,
    pub token: GlToken,
    pub project: GlProject,
    pub meta: GlMeta,
    pub source: String,
}

impl GlCtx {
    pub(crate) async fn request(&self, method: reqwest::Method, api_path: impl AsRef<str>, opts: Opts) -> Result<serde_json::Value> {
        http::request(&self.client, &self.remote.base, &self.token, method, api_path.as_ref(), opts).await
    }

    pub(crate) async fn fetch_all(&self, api_path: impl AsRef<str>, max_pages: u32) -> Result<Vec<serde_json::Value>> {
        http::fetch_all(&self.client, &self.remote.base, &self.token, api_path.as_ref(), max_pages).await
    }

    pub(crate) fn project_path(&self) -> String {
        format!("/projects/{}", self.project.id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string))
    }

    /// `canWrite`.
    pub fn can_write(&self) -> bool {
        scopes_allow_write(self.meta.scopes.as_deref())
    }

    pub(crate) fn require_write(&self) -> Result<()> {
        if self.can_write() {
            return Ok(());
        }
        Err(GorynychError::new(ErrorCode::Forbidden, t("Токен только для чтения", &[])).with_hint(t("Для изменений нужен токен со scope «api» — создайте новый и сохраните его в настройках", &[])))
    }
}

/// Нет сведений о правах или есть `api`.
pub fn scopes_allow_write(scopes: Option<&[String]>) -> bool {
    scopes.is_none_or(|scopes| scopes.iter().any(|scope| scope == "api"))
}

/// Первые 24 символа sha256.
pub(crate) fn fingerprint(parts: &[&str]) -> String {
    let digest = Sha256::digest(parts.join("\n").as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()[..24].to_owned()
}

/// Ключ репозитория для API: сервер и путь без учёта регистра.
pub(crate) fn api_key(base: &str, path: &str) -> String {
    format!("{base}/{}", path.to_lowercase())
}

impl CicdService {
    /// `detectRemote`.
    pub async fn gitlab_detect_remote(&self, root: &Path, preferred: Option<&str>) -> Result<Option<GlRemoteStatus>> {
        let output = self.remote_verbose(root).await;
        self.gitlab_detect_from(preferred, &output)
    }

    /// `detectRemote` по готовому выводу `git remote -v`.
    pub(crate) fn gitlab_detect_from(&self, preferred: Option<&str>, output: &str) -> Result<Option<GlRemoteStatus>> {
        let remotes = parse_remotes(output);
        let Some((name, url)) = pick_remote(&remotes, preferred) else {
            return Ok(None);
        };
        let Some(parsed) = parse_remote_url(url) else {
            return Ok(None);
        };
        let is_http = is_http_url(url);
        let site = site_base(&parsed, is_http, if is_http { None } else { self.inner.creds.server_base(&parsed.host) });
        let conf = self.inner.db.repo_provider(&parsed.host, &parsed.path).ok().flatten();
        let base = match conf.as_ref().filter(|conf| conf.provider.is_none() || conf.provider == Some(CiProvider::Gitlab)).and_then(|conf| conf.api_base.as_deref()) {
            Some(api_base) if !api_base.is_empty() => strip_api_suffix(api_base).to_owned(),
            _ => site.clone(),
        };
        let mut status = GlRemoteStatus {
            kind: None,
            remote: name.to_owned(),
            url: url.to_owned(),
            protocol: if is_http { "https" } else { "ssh" }.to_owned(),
            host: parsed.host.clone(),
            base: base.clone(),
            path: parsed.path.clone(),
            web_url: format!("{site}/{}", parsed.path),
            token: TokenStatus::default(),
        };
        self.migrate_legacy(&status);
        let key = api_key(&base, &parsed.path);
        let has_ci_token = self.legacy_token(LoginScope::Repo, &key).is_some() || self.legacy_token(LoginScope::Host, &base).is_some();
        let kind = self.inner.creds.server_kind(&parsed.host);
        let looks_like_gitlab = match conf.as_ref().and_then(|conf| conf.provider) {
            Some(provider) => provider == CiProvider::Gitlab,
            None => kind == Some(ServerKind::Gitlab) || has_ci_token || (kind.is_none() && parsed.host.to_lowercase().contains("gitlab")),
        };
        if looks_like_gitlab {
            status.kind = Some(CiProvider::Gitlab);
            status.token = self.gitlab_token_status(&status);
        }
        Ok(Some(status))
    }

    /// Контекст запросов: remote, авторизация и проект.
    pub async fn gitlab_context(&self, root: &Path, preferred: Option<&str>) -> Result<GlCtx> {
        let output = self.remote_verbose(root).await;
        self.gitlab_context_from(preferred, &output).await
    }

    /// Контекст по готовому выводу `git remote -v`.
    pub(crate) async fn gitlab_context_from(&self, preferred: Option<&str>, output: &str) -> Result<GlCtx> {
        let Some(remote) = self.gitlab_detect_from(preferred, output)? else {
            return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])));
        };
        if remote.kind != Some(CiProvider::Gitlab) {
            return Err(GorynychError::new(ErrorCode::NotGitlab, t("Remote не похож на GitLab", &[])).with_hint(t("Если это свой сервер GitLab — сохраните для него токен в настройках", &[])));
        }
        let auth = self.gitlab_pick_verified(&remote).await;
        let Some(token) = auth.token else {
            let problem = login_problem(&auth.rejected, auth.other.as_ref());
            let message = if problem.is_some() { t("Авторизация репозитория не подходит для пайплайнов", &[]) } else { t("Репозиторий не авторизован", &[]) };
            let hint = problem.and_then(|problem| problem.reason).unwrap_or_else(|| t("Авторизуйте репозиторий — эта же авторизация работает и для пайплайнов", &[]));
            return Err(GorynychError::new(ErrorCode::NoToken, message).with_hint(hint));
        };

        let value = token.value();
        let tail: String = value.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
        let key = format!("{}|{}|{tail}", remote.base, remote.path);
        let cached = self.inner.project_cache.lock().expect("кэш проектов").get(&key).filter(|(at, _)| at.elapsed().as_millis() < PROJECT_CACHE_MS).map(|(_, project)| project.clone());
        let client = self.inner.client.clone();
        let project = match cached {
            Some(project) => project,
            None => {
                let api_path = format!("/projects/{}", js::encode_uri_component(&remote.path));
                let data = http::request(&client, &remote.base, &token, reqwest::Method::GET, &api_path, Opts::default()).await?;
                let level = |key: &str| data.get("permissions").and_then(|perms| field(perms, key)).and_then(|access| number(access, "access_level")).and_then(|level| level.as_i64()).unwrap_or(0);
                let project = GlProject {
                    id: CiId::field(&data, "id"),
                    name: text(&data, "name_with_namespace").or_else(|| text(&data, "name")),
                    path: text(&data, "path_with_namespace"),
                    web_url: text(&data, "web_url"),
                    default_branch: text(&data, "default_branch"),
                    access_level: level("project_access").max(level("group_access")),
                };
                self.inner.project_cache.lock().expect("кэш проектов").insert(key, (Instant::now(), project.clone()));
                project
            }
        };
        Ok(GlCtx { client, remote, token, project, meta: auth.meta, source: auth.source })
    }
}

/// `apiBase.replace(/\/api\/v4$/i, '')`.
fn strip_api_suffix(base: &str) -> &str {
    let suffix = "/api/v4";
    match base.len().checked_sub(suffix.len()).and_then(|at| base.get(at..).map(|tail| (at, tail))) {
        Some((at, tail)) if tail.eq_ignore_ascii_case(suffix) => &base[..at],
        _ => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suffix_is_removed_without_regard_to_case() {
        assert_eq!(strip_api_suffix("https://x/API/v4"), "https://x");
        assert_eq!(strip_api_suffix("https://x/gl"), "https://x/gl");
        assert_eq!(strip_api_suffix(""), "");
    }

    #[test]
    fn fingerprint_is_stable() {
        assert_eq!(fingerprint(&["a", "b"]).len(), 24);
        assert_ne!(fingerprint(&["a", "b"]), fingerprint(&["a", "c"]));
    }

    #[test]
    fn write_needs_api_scope() {
        assert!(scopes_allow_write(None));
        assert!(scopes_allow_write(Some(&["read_api".to_owned(), "api".to_owned()])));
        assert!(!scopes_allow_write(Some(&["read_api".to_owned()])));
    }
}
