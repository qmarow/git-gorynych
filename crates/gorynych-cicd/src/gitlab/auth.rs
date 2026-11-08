//! Чем авторизоваться в API GitLab: `authOptions`, `verifyLogin`, `pickSync`, `pickVerified`, `loginProblem`, `tokenStatus`, список и удаление старых токенов.

use std::sync::Arc;
use std::time::{Duration, Instant};

use gorynych_core::error::{ErrorCode, Result};
use gorynych_core::i18n::t;
use gorynych_storage::credentials::{ApiLogin, AuthMethod, LegacyCiMeta, LegacyCiToken, LegacyCiUser, LoginScope, ServerKind, UnusableLogin};
use serde::Serialize;
use url::Url;

use super::{GlMeta, GlRemoteStatus, GlToken, api_key, fingerprint, http};
use crate::http::Opts;
use crate::json::{strings, text};
use crate::models::{LoginCheckResult, LoginProblem, TokenLogin, TokenStatus};
use crate::service::{CheckFlow, CicdService};

const BAD_TTL: Duration = Duration::from_secs(600);

/// Сведения о токене.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GlTokenInfo {
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub token_name: Option<String>,
}

/// Состояние проверки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckState {
    Ok,
    Bad,
    Unknown,
}

impl CheckState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Bad => "bad",
            Self::Unknown => "unknown",
        }
    }
}

/// Итог `verifyLogin`.
#[derive(Debug, Clone)]
pub struct GlCheck {
    pub state: CheckState,
    pub info: Option<GlTokenInfo>,
    pub bearer: bool,
    pub reason: Option<String>,
    pub at: Instant,
}

/// Вариант авторизации.
#[derive(Clone)]
enum AuthOption {
    Login { source: &'static str, login: ApiLogin },
    Legacy { source: &'static str, token: String, stored: LegacyCiToken },
}

struct AuthOptions {
    list: Vec<AuthOption>,
    other: Option<UnusableLogin>,
    unreadable: bool,
}

/// Вход, отвергнутый проверкой.
#[derive(Debug, Clone)]
pub struct Rejected {
    pub source: String,
    pub method: AuthMethod,
    pub via_api_token: bool,
    pub reason: Option<String>,
}

/// Итог `pickVerified`.
pub struct PickedAuth {
    pub token: Option<GlToken>,
    pub meta: GlMeta,
    pub source: String,
    pub rejected: Vec<Rejected>,
    pub other: Option<UnusableLogin>,
}

/// `loginProblem`: почему вход репозитория не подходит для CI/CD.
pub fn login_problem(rejected: &[Rejected], other: Option<&UnusableLogin>) -> Option<LoginProblem> {
    if let Some(item) = rejected.iter().find(|item| item.source != "login-shared").or(rejected.first()) {
        let which = if item.via_api_token { t("Токен для пайплайнов в авторизации репозитория", &[]) } else { t("Токен авторизации репозитория", &[]) };
        let reason = item.reason.clone().unwrap_or_else(|| "undefined".to_owned());
        return Some(LoginProblem { method: Some(item.method), reason: Some(t("{0} не подходит для пайплайнов: {1}.", &[&which, &reason])) });
    }
    match other {
        Some(login) if login.method == AuthMethod::Ssh => Some(LoginProblem {
            method: Some(AuthMethod::Ssh),
            reason: Some(t("Репозиторий авторизован SSH-ключом — его принимает git, но не API GitLab. Добавьте в авторизацию репозитория токен для пайплайнов.", &[])),
        }),
        Some(login) if login.method == AuthMethod::Password => Some(LoginProblem {
            method: Some(AuthMethod::Password),
            reason: Some(if login.unreadable {
                t("Пароль авторизации репозитория не расшифровывается — авторизуйтесь заново.", &[])
            } else {
                t("Репозиторий авторизован логином и паролем — API GitLab принимает только токены. Добавьте в авторизацию репозитория токен для пайплайнов.", &[])
            }),
        }),
        _ => None,
    }
}

fn user_of(data: &serde_json::Value) -> LegacyCiUser {
    LegacyCiUser { username: text(data, "username"), name: text(data, "name"), avatar_url: text(data, "avatar_url") }
}

/// `tokenInfo`.
async fn token_info(client: &reqwest::Client, base: &str, token: &GlToken) -> Result<GlTokenInfo> {
    let user = http::request(client, base, token, reqwest::Method::GET, "/user", Opts::default()).await?;
    // Старый GitLab или токен другого типа: права неизвестны
    let own = http::request(client, base, token, reqwest::Method::GET, "/personal_access_tokens/self", Opts::default()).await.ok();
    let own = own.as_ref();
    Ok(GlTokenInfo {
        user: Some(user_of(&user)),
        scopes: own.and_then(|data| data.get("scopes")).filter(|scopes| !scopes.is_null()).map(|_| strings(own.expect("есть scopes"), "scopes")),
        expires_at: own.and_then(|data| text(data, "expires_at")),
        token_name: own.and_then(|data| text(data, "name")),
    })
}

fn scope_error(scopes: &[String]) -> String {
    t("у токена нет права на API: есть только {0}, а нужен «api» или «read_api»", &[&scopes.join(", ")])
}

fn has_api_scope(scopes: &[String]) -> bool {
    scopes.iter().any(|scope| scope == "api" || scope == "read_api")
}

async fn verify(client: reqwest::Client, base: String, secret: String) -> CheckFlow<GlCheck> {
    let done = |state, info, bearer, reason| GlCheck { state, info, bearer, reason, at: Instant::now() };
    let mut bearer = false;
    let info = match token_info(&client, &base, &GlToken::Private(secret.clone())).await {
        Ok(info) => info,
        Err(error) => {
            let mut info = None;
            if error.code == ErrorCode::Auth
                && let Ok(found) = token_info(&client, &base, &GlToken::Bearer(secret.clone())).await
            {
                info = Some(found);
                bearer = true;
            }
            match info {
                Some(info) => info,
                None => {
                    if matches!(error.code, ErrorCode::Network | ErrorCode::RateLimit) {
                        return CheckFlow::Forget(done(CheckState::Unknown, None, false, Some(error.message)));
                    }
                    let mut scopes = None;
                    if error.code == ErrorCode::Forbidden {
                        scopes = http::request(&client, &base, &GlToken::Private(secret.clone()), reqwest::Method::GET, "/personal_access_tokens/self", Opts::default())
                            .await
                            .ok()
                            .filter(|data| data.get("scopes").is_some_and(|value| !value.is_null()))
                            .map(|data| strings(&data, "scopes"));
                    }
                    let reason = match error.code {
                        ErrorCode::Forbidden => match scopes.filter(|scopes| !scopes.is_empty()) {
                            Some(scopes) => scope_error(&scopes),
                            None => t("у токена нет права на API (нужен scope «api» или «read_api»)", &[]),
                        },
                        ErrorCode::Auth => t("GitLab не принимает этот токен для API — он отозван, истёк или это не личный токен", &[]),
                        _ => error.message,
                    };
                    return CheckFlow::Keep(done(CheckState::Bad, None, false, Some(reason)));
                }
            }
        }
    };
    if let Some(scopes) = info.scopes.as_deref().filter(|scopes| !has_api_scope(scopes)) {
        let reason = scope_error(scopes);
        return CheckFlow::Keep(done(CheckState::Bad, Some(info), false, Some(reason)));
    }
    CheckFlow::Keep(done(CheckState::Ok, Some(info), bearer, None))
}

fn rejected_of(source: &str, login: &ApiLogin, reason: Option<String>) -> Rejected {
    Rejected { source: source.to_owned(), method: login.method, via_api_token: login.via_api_token, reason }
}

fn secret_token(secret: &str, check: Option<&GlCheck>) -> GlToken {
    if check.is_some_and(|check| check.bearer) { GlToken::Bearer(secret.to_owned()) } else { GlToken::Private(secret.to_owned()) }
}

impl CicdService {
    pub(crate) fn legacy_token(&self, scope: LoginScope, key: &str) -> Option<LegacyCiToken> {
        self.inner.creds.legacy_ci_token(scope, key).ok().flatten()
    }

    fn gitlab_login_key(base: &str, secret: &str) -> String {
        fingerprint(&[base, secret])
    }

    /// `loginCheckState`: `None` — не проверялся; `Some(None)` — проверка идёт.
    fn gitlab_check_state(&self, base: &str, secret: &str) -> Option<Option<Arc<GlCheck>>> {
        self.inner.login_checks.state(&Self::gitlab_login_key(base, secret))
    }

    /// `verifyLogin`: результат запоминается.
    pub async fn gitlab_verify_login(&self, base: &str, secret: &str) -> Arc<GlCheck> {
        let client = self.inner.client.clone();
        let (base_owned, secret_owned) = (base.to_owned(), secret.to_owned());
        self.inner
            .login_checks
            .run(
                Self::gitlab_login_key(base, secret),
                |check, started| match check {
                    Some(check) => check.state != CheckState::Bad || check.at.elapsed() < BAD_TTL,
                    None => started.elapsed() < Duration::MAX,
                },
                move || verify(client, base_owned, secret_owned),
                || GlCheck { state: CheckState::Unknown, info: None, bearer: false, reason: None, at: Instant::now() },
            )
            .await
    }

    fn gitlab_verify_in_background(&self, base: &str, secret: &str) {
        let (service, base, secret) = (self.clone(), base.to_owned(), secret.to_owned());
        tokio::spawn(async move { service.gitlab_verify_login(&base, &secret).await });
    }

    fn gitlab_auth_options(&self, remote: &GlRemoteStatus) -> AuthOptions {
        let mut list = Vec::new();
        // Хранилище входов недоступно: как будто входов нет
        let login = self.inner.creds.api_login_for(&remote.host, &remote.path, Some(ServerKind::Gitlab)).unwrap_or_default();
        if let Some(repo) = login.repo {
            list.push(AuthOption::Login { source: "login", login: repo });
        }
        let mut unreadable = false;
        if let Some(own) = self.legacy_token(LoginScope::Repo, &api_key(&remote.base, &remote.path)) {
            match own.value.clone() {
                Some(token) => list.push(AuthOption::Legacy { source: "legacy", token, stored: own }),
                None => unreadable = true,
            }
        }
        if let Some(shared) = self.legacy_token(LoginScope::Host, &remote.base)
            && let Some(token) = shared.value.clone()
        {
            list.push(AuthOption::Legacy { source: "legacy-shared", token, stored: shared });
        }
        if let Some(shared) = login.shared {
            list.push(AuthOption::Login { source: "login-shared", login: shared });
        }
        AuthOptions { list, other: login.other, unreadable }
    }

    /// `migrateLegacy`: старый токен становится токеном для пайплайнов у входа с паролем или SSH-ключом.
    pub(crate) fn migrate_legacy(&self, remote: &GlRemoteStatus) {
        let key = api_key(&remote.base, &remote.path);
        let Some(token) = self.legacy_token(LoginScope::Repo, &key).and_then(|own| own.value) else {
            return;
        };
        let Ok(login) = self.inner.creds.api_login_for(&remote.host, &remote.path, Some(ServerKind::Gitlab)) else {
            return;
        };
        if login.repo.is_none()
            && let Some(other) = login.other
            && self.inner.creds.attach_api_token(&other.key, &token).unwrap_or(false)
        {
            let _ = self.inner.creds.remove_legacy_ci_token(LoginScope::Repo, &key);
        }
    }

    /// `tokenStatus` на основе `pickSync`: без сети, непроверенный вход считается подходящим и проверяется в фоне.
    pub(crate) fn gitlab_token_status(&self, remote: &GlRemoteStatus) -> TokenStatus {
        let repo_key = Some(api_key(&remote.base, &remote.path));
        let options = self.gitlab_auth_options(remote);
        let mut rejected = Vec::new();
        for option in options.list {
            match option {
                AuthOption::Legacy { source, stored, .. } => {
                    let meta = stored.meta;
                    return TokenStatus {
                        configured: true,
                        source: Some(source.to_owned()),
                        user: meta.user,
                        scopes: meta.scopes,
                        expires_at: meta.expires_at,
                        saved_at: stored.saved_at,
                        repo_login: login_problem(&rejected, options.other.as_ref()),
                        repo_key,
                        ..TokenStatus::default()
                    };
                }
                AuthOption::Login { source, login } => {
                    let state = self.gitlab_check_state(&remote.base, &login.secret);
                    if let Some(Some(check)) = &state
                        && check.state == CheckState::Bad
                    {
                        rejected.push(rejected_of(source, &login, check.reason.clone()));
                        continue;
                    }
                    if state.is_none() {
                        self.gitlab_verify_in_background(&remote.base, &login.secret);
                    }
                    let check = state.flatten();
                    let info = check.as_ref().and_then(|check| check.info.clone()).unwrap_or_default();
                    return TokenStatus {
                        configured: true,
                        source: Some(source.to_owned()),
                        pending: Some(check.is_none()),
                        user: info.user,
                        scopes: info.scopes,
                        expires_at: info.expires_at,
                        saved_at: login.saved_at,
                        login: Some(TokenLogin { method: login.method, username: login.username, shared: login.shared, via_api_token: login.via_api_token }),
                        repo_key,
                        ..TokenStatus::default()
                    };
                }
            }
        }
        TokenStatus { configured: false, repo_login: login_problem(&rejected, options.other.as_ref()), unreadable: Some(options.unreadable), repo_key, ..TokenStatus::default() }
    }

    /// `pickVerified`: вход репозитория проверяется по сети.
    pub(crate) async fn gitlab_pick_verified(&self, remote: &GlRemoteStatus) -> PickedAuth {
        let options = self.gitlab_auth_options(remote);
        let mut rejected = Vec::new();
        for option in options.list {
            match option {
                AuthOption::Legacy { source, token, stored } => {
                    let meta = stored.meta;
                    return PickedAuth {
                        token: Some(GlToken::Private(token)),
                        meta: GlMeta { user: meta.user, scopes: meta.scopes, expires_at: meta.expires_at },
                        source: source.to_owned(),
                        rejected,
                        other: options.other,
                    };
                }
                AuthOption::Login { source, login } => {
                    let check = self.gitlab_verify_login(&remote.base, &login.secret).await;
                    if matches!(check.state, CheckState::Ok | CheckState::Unknown) {
                        let info = check.info.clone().unwrap_or_default();
                        return PickedAuth {
                            token: Some(secret_token(&login.secret, Some(&check))),
                            meta: GlMeta { user: info.user, scopes: info.scopes, expires_at: info.expires_at },
                            source: source.to_owned(),
                            rejected,
                            other: options.other,
                        };
                    }
                    rejected.push(rejected_of(source, &login, check.reason.clone()));
                }
            }
        }
        PickedAuth { token: None, meta: GlMeta::default(), source: String::new(), rejected, other: options.other }
    }

    /// `tokenForRemote`: токен для фоновых запросов без ожидания проверки.
    pub(crate) fn gitlab_token_for_remote(&self, remote: &GlRemoteStatus) -> Option<GlToken> {
        for option in self.gitlab_auth_options(remote).list {
            match option {
                AuthOption::Legacy { token, .. } => return Some(GlToken::Private(token)),
                AuthOption::Login { login, .. } => {
                    let state = self.gitlab_check_state(&remote.base, &login.secret);
                    if let Some(Some(check)) = &state
                        && check.state == CheckState::Bad
                    {
                        continue;
                    }
                    if state.is_none() {
                        self.gitlab_verify_in_background(&remote.base, &login.secret);
                    }
                    return Some(secret_token(&login.secret, state.flatten().as_deref()));
                }
            }
        }
        None
    }

    /// `checkLoginApi`: проверка по сети сразу после сохранения входа, не дольше 8 секунд.
    pub async fn gitlab_check_login_api(&self, hostname: &str, repo_path: &str, base: &str) -> Result<LoginCheckResult> {
        let login = self.inner.creds.api_login_for(hostname, repo_path, Some(ServerKind::Gitlab))?;
        let Some(repo) = login.repo else {
            let problem = login_problem(&[], login.other.as_ref());
            return Ok(LoginCheckResult {
                state: "none".to_owned(),
                reason: problem.and_then(|problem| problem.reason),
                user: None,
                scopes: None,
                method: login.other.as_ref().map(|other| other.method),
                via_api_token: None,
            });
        };
        let check = match tokio::time::timeout(Duration::from_secs(8), self.gitlab_verify_login(base, &repo.secret)).await {
            Ok(check) => check,
            Err(_) => {
                return Ok(LoginCheckResult { state: "unknown".to_owned(), reason: Some(t("сервер не ответил", &[])), user: None, scopes: None, method: None, via_api_token: Some(repo.via_api_token) });
            }
        };
        let problem = (check.state == CheckState::Bad).then(|| login_problem(&[rejected_of("login", &repo, check.reason.clone())], None)).flatten();
        let info = check.info.clone().unwrap_or_default();
        Ok(LoginCheckResult {
            state: check.state.as_str().to_owned(),
            reason: problem.and_then(|problem| problem.reason).or_else(|| check.reason.clone()),
            user: info.user,
            scopes: info.scopes,
            method: None,
            via_api_token: Some(repo.via_api_token),
        })
    }

    /// `loginApiState`: состояние проверки без сети.
    pub fn gitlab_login_api_state(&self, hostname: &str, repo_path: &str, base: Option<&str>) -> Result<Option<LoginCheckResult>> {
        let login = self.inner.creds.api_login_for(hostname, repo_path, Some(ServerKind::Gitlab))?;
        let Some(repo) = login.repo else {
            return Ok(None);
        };
        let base = base.map_or_else(|| format!("https://{hostname}"), str::to_owned);
        let Some(Some(check)) = self.gitlab_check_state(&base, &repo.secret) else {
            return Ok(None);
        };
        let info = check.info.clone().unwrap_or_default();
        Ok(Some(LoginCheckResult { state: check.state.as_str().to_owned(), reason: check.reason.clone(), user: info.user, scopes: info.scopes, method: None, via_api_token: Some(repo.via_api_token) }))
    }

    /* ---------- Старые токены в настройках ---------- */

    /// `listTokens`: старые токены CI/CD без секретов.
    pub fn gitlab_list_tokens(&self) -> Result<GlTokenList> {
        let mut out = GlTokenList::default();
        for entry in self.inner.creds.list_legacy_ci_tokens()? {
            let meta = entry.token.meta.clone();
            let readable = entry.token.value.is_some();
            let row = |base: String, path: Option<String>, url: Option<String>, meta: LegacyCiMeta| GlTokenRow {
                key: format!("ci:{}", entry.key),
                hostname: host_of(&base),
                base,
                path,
                url,
                user: meta.user,
                scopes: meta.scopes,
                expires_at: meta.expires_at,
                saved_at: entry.token.saved_at.clone(),
                readable,
            };
            match entry.scope {
                LoginScope::Repo => {
                    let base = meta.base.clone().unwrap_or_else(|| site_part(&entry.key));
                    let path = meta.path.clone().unwrap_or_else(|| path_part(&entry.key));
                    let url = meta.url.clone();
                    out.repos.push(row(base, Some(path), url, meta));
                }
                LoginScope::Host => out.shared.push(row(entry.key.clone(), None, None, meta)),
            }
        }
        Ok(out)
    }

    /// `forgetToken`: ключ из списка.
    pub fn gitlab_forget_token(&self, key: &str) -> Result<GlForgetResult> {
        let key = key.strip_prefix("ci:").unwrap_or(key);
        let mut removed = false;
        for scope in [LoginScope::Repo, LoginScope::Host] {
            if self.legacy_token(scope, key).is_some() {
                self.inner.creds.remove_legacy_ci_token(scope, key)?;
                removed = true;
                break;
            }
        }
        if removed {
            self.inner.project_cache.lock().expect("кэш проектов").clear();
        }
        Ok(GlForgetResult { removed })
    }

    /// `forgetRepoToken`: вместе с авторизацией репозитория.
    pub fn gitlab_forget_repo_token(&self, hostname: &str, repo_path: &str) -> Result<GlForgetResult> {
        let (host, path) = (hostname.to_lowercase(), repo_path.to_lowercase());
        let mut removed = false;
        for entry in self.inner.creds.list_legacy_ci_tokens()? {
            let base = entry.token.meta.base.as_deref().unwrap_or(&entry.key);
            if entry.scope == LoginScope::Repo && host_of(base).as_deref() == Some(&host) && entry.token.meta.path.as_deref().unwrap_or_default().to_lowercase() == path {
                self.inner.creds.remove_legacy_ci_token(LoginScope::Repo, &entry.key)?;
                removed = true;
            }
        }
        if removed {
            self.inner.project_cache.lock().expect("кэш проектов").clear();
        }
        Ok(GlForgetResult { removed })
    }

    /// `forgetHost`: все токены сервера.
    pub fn gitlab_forget_host(&self, hostname: &str) -> Result<GlForgetResult> {
        let host = hostname.to_lowercase();
        let mut removed = false;
        for entry in self.inner.creds.list_legacy_ci_tokens()? {
            let base = entry.token.meta.base.as_deref().filter(|_| entry.scope == LoginScope::Repo).unwrap_or(&entry.key);
            if host_of(base).as_deref() == Some(&host) {
                self.inner.creds.remove_legacy_ci_token(entry.scope, &entry.key)?;
                removed = true;
            }
        }
        if removed {
            self.inner.project_cache.lock().expect("кэш проектов").clear();
        }
        Ok(GlForgetResult { removed })
    }
}

/// Строка списка старых токенов.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlTokenRow {
    pub key: String,
    pub hostname: Option<String>,
    pub base: String,
    pub path: Option<String>,
    pub url: Option<String>,
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub saved_at: Option<String>,
    pub readable: bool,
}

/// `listTokens`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct GlTokenList {
    pub repos: Vec<GlTokenRow>,
    pub shared: Vec<GlTokenRow>,
}

/// Результат удаления.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlForgetResult {
    pub removed: bool,
}

fn host_of(base: &str) -> Option<String> {
    Url::parse(base).ok().and_then(|url| url.host_str().map(str::to_lowercase))
}

fn split_key(key: &str) -> Option<(&str, &str)> {
    let rest_at = key.find("://")? + 3;
    let slash = key[rest_at..].find('/')? + rest_at;
    Some((&key[..slash], &key[slash + 1..]))
}

/// `key.replace(/^(https?:\/\/[^/]+).*$/, '$1')`.
fn site_part(key: &str) -> String {
    split_key(key).map_or(key, |(site, _)| site).to_owned()
}

/// `key.replace(/^https?:\/\/[^/]+\//, '')`.
fn path_part(key: &str) -> String {
    split_key(key).map_or(key, |(_, path)| path).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_parts() {
        assert_eq!(site_part("https://h:1/a/b"), "https://h:1");
        assert_eq!(path_part("https://h:1/a/b"), "a/b");
        assert_eq!(path_part("странно"), "странно");
    }

    #[test]
    fn problem_prefers_own_login() {
        let rejected = [
            Rejected { source: "login-shared".into(), method: AuthMethod::Token, via_api_token: false, reason: Some("общий".into()) },
            Rejected { source: "login".into(), method: AuthMethod::Password, via_api_token: true, reason: Some("свой".into()) },
        ];
        let problem = login_problem(&rejected, None).unwrap();
        assert_eq!(problem.method, Some(AuthMethod::Password));
        assert!(problem.reason.unwrap().contains("свой"));
        assert_eq!(login_problem(&[], None), None);
    }
}
