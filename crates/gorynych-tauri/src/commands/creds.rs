//! Команды `creds:*`: авторизация на remote-сервере. Перенос раздела «Авторизация на remote-сервере» из `electron/main.cjs`
//! (`credTarget`, `describeTarget`, `apiState`, `serversWithCi` и обработчики `ipcMain`).
//!
//! # Конспект исходника
//! - `credTarget(dir, url)`: непустой после `trim` `url` → `{url, remote: null}`. Иначе корень репозитория и тот же remote, что у
//!   Pull/Push: upstream текущей ветки (`for-each-ref --format=%(upstream:remotename)`), иначе `origin`, иначе первый. Ошибки этих
//!   вызовов git — пустой вывод. Адрес — `remote get-url`; нет ни remote, ни адреса → `NO_REMOTE` «У репозитория нет remote».
//! - `describeTarget`: `NO_REMOTE` при заданном `dir` и пустом `url` — не ошибка, а `{noRemote: true, …}`: окно входа предложит
//!   указать адрес. Иначе `credentials.describe` + `remote`, `noRemote: false`, `defaultTokenUser(host)`, `api`.
//! - `apiState` (только GitLab с путём репозитория, без сети): состояние последней проверки; иначе `{state: null}`, если вход
//!   годится для API, `{state: 'none', method}`, если вход есть, но не годится, или `null`. Любая ошибка → `null`.
//! - `creds:save`: при `dir`, пустом `url` и непустом `remoteUrl` сначала проверка адреса (`BAD_ARGS` «Укажите полный адрес
//!   репозитория» с примером), потом **сначала вход** (он проверяет данные: с ошибкой в пароле remote не меняется), потом
//!   `remote add origin` или `remote set-url` → `remoteChange {remote, from, to}`. Затем `describeTarget` и проверка по сети:
//!   GitLab — `checkLoginApi` (ошибка → `api: null`); GitHub, Gitea, Bitbucket при `dir` — `cicd.checkLogin` не дольше 8 с, иначе
//!   `{state: 'unknown', reason: 'сервер не ответил'}`.
//! - `creds:check-url`: адрес без ключа репозитория → `BAD_ARGS`; `ls-remote --heads` из домашней папки с сетевым окружением
//!   для этого адреса и таймаутом 60 с.
//! - `creds:forget-login(key)`: ключ `ci:…` — старый токен CI/CD. Иначе вместе со входом репозитория забывается и его старый
//!   отдельный токен CI/CD. `creds:forget-server`: входы и токены сервера, `removed` — хоть что-то удалено.
//! - `serversWithCi`: для серверов GitLab у каждого входа `ci {source, state, reason, user, scopes, viaApiToken}`
//!   (`source: 'login'`, если вход токеном или с токеном для пайплайнов; иначе `state: 'none'`). Старые токены репозиториев —
//!   `ci.legacy` у всех строк с тем же путём (без учёта регистра), иначе отдельная строка `{protocol: 'ci', ciOnly: true}`;
//!   общие токены — `sharedCi` сервера. Сервер, известный только по токену: `kind` — сохранённый или догадка, иначе `gitlab`;
//!   `kindSaved` — есть ли хоть какой-то тип, включая догадку (так в 1.x). Строки сортируются по `path` (`localeCompare`).
//! - `creds:key-defaults`: имя файла ключа по хосту адреса (явного или remote, ошибка → пустой адрес), комментарий —
//!   `user.email` из git репозитория или домашней папки.
//! - `creds:generate-key`, `creds:copy-public-key`: открытый ключ кладётся в буфер обмена; нет `.pub` → `NOT_FOUND`.
//! - `creds:switch-to-ssh`: `https://` → `git@host:path.git`; адрес уже не https или remote не определён → `BAD_ARGS`.
//!
//! # Отличия от 1.x
//! - Пустой `dir` (без `url`) — сразу `NOT_A_REPO`. В 1.x `resolveRepoRoot(undefined)` запускал git в текущей папке процесса и
//!   мог найти совсем другой репозиторий.
//! - `creds:key-defaults(dir, url, keyType)`: третий аргумент назван `keyType`, а не `type` (ключевое слово Rust).
//! - `copied` в ответах `creds:generate-key` и `creds:copy-public-key` — удалась ли запись в буфер обмена (в 1.x всегда `true`, а у
//!   `copy-public-key` поля не было).
//! - Не перенесён `creds:pick-key`: нужен плагин диалогов, он появится вместе с `repo:open-dialog`.
//!
//! База и Keyring — блокирующие вызовы: они идут через [`blocking`].

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use gorynych_cicd::detect_server::{DetectedServer, detect_server};
use gorynych_cicd::gitlab::GlTokenRow;
use gorynych_cicd::models::LoginCheckResult;
use gorynych_cicd::service::CicdService;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_git::read::resolve_repo_root;
use gorynych_git::run::{git, git_info, git_with};
use gorynych_storage::credentials::{
    AuthMethod, ClearResult, Credentials, ForgetResult, LegacyCiUser, LoginInput, RemoteProtocol, RepoLogin, SavedLogin, ServerKind, SharedLogin, TargetInfo,
    parse_target, repo_key_of, ssh_url_for,
};
use gorynych_storage::ssh_keys::{GenerateKeyOptions, GeneratedKey, SshKeyList, generate_ssh_key, list_ssh_keys, public_key_of, suggest_key_name};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::repo::blocking;
use crate::{AppState, Services};

/// Сколько ждать проверки входа GitHub, Gitea и Bitbucket после сохранения.
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
/// Таймаут `creds:check-url`.
const CHECK_URL_TIMEOUT: Duration = Duration::from_secs(60);

/* ---------- Типы ---------- */

/// Вход годится для API, но ещё не проверялся (`state: null`), или есть, но не годится (`state: 'none'`).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct UncheckedApi {
    pub state: Option<String>,
    pub method: Option<AuthMethod>,
}

/// Работают ли пайплайны от авторизации репозитория.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(untagged)]
pub enum ApiState {
    Checked(LoginCheckResult),
    Unchecked(UncheckedApi),
}

/// У репозитория нет remote: окно входа предложит указать адрес.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoRemoteTarget {
    pub no_remote: bool,
    pub remote: Option<String>,
    pub url: Option<String>,
    pub protocol: RemoteProtocol,
    pub host: Option<String>,
    pub hostname: Option<String>,
    pub saved: Option<SavedLogin>,
    pub kind: Option<ServerKind>,
    pub cloud: bool,
}

/// Адрес, к которому нужен доступ, и сохранённый для него вход.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCredTarget {
    #[serde(flatten)]
    pub info: TargetInfo,
    pub remote: Option<String>,
    pub no_remote: bool,
    pub default_token_user: String,
    pub api: Option<ApiState>,
}

/// Ответ `creds:describe`. Различаются по `noRemote`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(untagged)]
pub enum CredTarget {
    NoRemote(NoRemoteTarget),
    Remote(Box<RemoteCredTarget>),
}

/// Данные окна входа для `creds:save`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct CredSaveInput {
    #[serde(flatten)]
    pub login: LoginInput,
    /// В окне входа выбрали другой адрес: remote репозитория меняется (или добавляется) после сохранения входа.
    pub remote_url: Option<String>,
}

/// Как изменился remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteChange {
    pub remote: String,
    pub from: Option<String>,
    pub to: String,
}

/// Ответ `creds:save`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CredSaved {
    #[serde(flatten)]
    pub target: CredTarget,
    pub remote_change: Option<RemoteChange>,
}

/// Ответ `creds:check-url`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct UrlChecked {
    pub ok: bool,
}

/// Ответ `creds:set-kind`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ServerKindSet {
    pub kind: Option<ServerKind>,
}

/// Старый токен CI/CD при входе репозитория.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LegacyCiRef {
    pub key: String,
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
}

/// CI/CD от авторизации репозитория.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoCi {
    pub source: Option<String>,
    pub state: Option<String>,
    pub reason: Option<String>,
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub via_api_token: Option<bool>,
    pub readable: Option<bool>,
    pub legacy: Option<LegacyCiRef>,
}

/// Вход репозитория в списке серверов.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RepoWithCi {
    #[serde(flatten)]
    pub login: RepoLogin,
    pub ci: Option<RepoCi>,
}

/// Репозиторий, у которого есть только старый токен CI/CD.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiOnlyRepo {
    pub key: String,
    pub url: Option<String>,
    pub path: String,
    /// Всегда `ci`.
    pub protocol: String,
    pub ci_only: bool,
    pub ci: RepoCi,
}

/// Строка репозитория сервера. Различаются по `ciOnly`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(untagged)]
pub enum ServerRepo {
    Login(RepoWithCi),
    CiOnly(CiOnlyRepo),
}

impl ServerRepo {
    fn path(&self) -> &str {
        match self {
            Self::Login(repo) => &repo.login.path,
            Self::CiOnly(repo) => &repo.path,
        }
    }

    fn ci_mut(&mut self) -> &mut RepoCi {
        match self {
            Self::Login(repo) => repo.ci.get_or_insert_with(RepoCi::default),
            Self::CiOnly(repo) => &mut repo.ci,
        }
    }
}

/// Сервер в окне «Серверы и входы».
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerWithCi {
    pub hostname: String,
    pub base: String,
    pub repos: Vec<ServerRepo>,
    pub shared: Vec<SharedLogin>,
    pub kind: Option<ServerKind>,
    pub kind_saved: bool,
    pub cloud: bool,
    pub shared_ci: Option<Vec<GlTokenRow>>,
}

/// Ответ `creds:key-defaults`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct KeyDefaults {
    pub name: String,
    pub comment: Option<String>,
    pub dir: String,
}

/// Ответ `creds:generate-key`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GeneratedKeyCopied {
    #[serde(flatten)]
    pub key: GeneratedKey,
    pub copied: bool,
}

/// Ответ `creds:copy-public-key`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyCopied {
    pub public_key: String,
    pub copied: bool,
}

/// Ответ `creds:switch-to-ssh`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SwitchedToSsh {
    pub remote: String,
    pub from: String,
    pub to: String,
    pub target: CredTarget,
}

/* ---------- Адрес и описание ---------- */

/// Строка не пустая: проверка `if (url)` в 1.x.
fn given(text: Option<&str>) -> Option<&str> {
    text.filter(|text| !text.is_empty())
}

fn bad_args(message: &str) -> GorynychError {
    GorynychError::new(ErrorCode::BadArgs, t(message, &[]))
}

async fn repo_root(dir: Option<&str>) -> Result<PathBuf> {
    match given(dir) {
        Some(dir) => resolve_repo_root(Path::new(dir)).await,
        None => Err(GorynychError::new(ErrorCode::NotARepo, t("Папка не является Git-репозиторием: {0}", &[&""]))),
    }
}

/// `git(...).catch(() => '')` с `trim`.
async fn quiet(root: &Path, args: &[&str]) -> String {
    js::trim(&git(root, args).await.unwrap_or_default()).to_owned()
}

fn home() -> PathBuf {
    std::env::home_dir().unwrap_or_default()
}

/// Адрес и remote, к которым нужен доступ.
struct Target {
    url: String,
    remote: Option<String>,
}

/// `credTarget`.
async fn cred_target(dir: Option<&str>, url: Option<&str>) -> Result<Target> {
    if let Some(url) = url.map(js::trim).filter(|url| !url.is_empty()) {
        return Ok(Target { url: url.to_owned(), remote: None });
    }
    let root = repo_root(dir).await?;
    let listed = git(&root, &["remote"]).await.unwrap_or_default();
    let remotes: Vec<&str> = listed.split('\n').map(js::trim).filter(|remote| !remote.is_empty()).collect();
    let branch = quiet(&root, &["branch", "--show-current"]).await;
    let upstream = if branch.is_empty() { String::new() } else { quiet(&root, &["for-each-ref", "--format=%(upstream:remotename)", &format!("refs/heads/{branch}")]).await };
    let remote = if remotes.contains(&upstream.as_str()) {
        Some(upstream.as_str())
    } else if remotes.contains(&"origin") {
        Some("origin")
    } else {
        remotes.first().copied()
    };
    if let Some(remote) = remote {
        let raw = quiet(&root, &["remote", "get-url", remote]).await;
        if !raw.is_empty() {
            return Ok(Target { url: raw, remote: Some(remote.to_owned()) });
        }
    }
    Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])))
}

/// `apiState`: состояние проверки без сети. Любая ошибка — `None`.
fn api_state(cicd: &CicdService, creds: &Credentials, info: &TargetInfo, repo_path: &str) -> Option<ApiState> {
    let hostname = info.hostname.as_deref().unwrap_or_default();
    if let Some(state) = cicd.gitlab_login_api_state(hostname, repo_path, info.base.as_deref()).ok()? {
        return Some(ApiState::Checked(state));
    }
    let login = creds.api_login_for(hostname, repo_path, Some(ServerKind::Gitlab)).ok()?;
    if login.repo.is_some() {
        return Some(ApiState::Unchecked(UncheckedApi { state: None, method: None }));
    }
    login.other.map(|other| ApiState::Unchecked(UncheckedApi { state: Some("none".to_owned()), method: Some(other.method) }))
}

/// Путь репозитория GitLab, для которого есть смысл спрашивать API.
fn gitlab_repo_path(info: &TargetInfo) -> Option<&str> {
    (info.kind == Some(ServerKind::Gitlab)).then_some(())?;
    given(info.repo_path.as_deref())
}

/// `describeTarget`.
async fn describe_target(services: &Services, dir: Option<&str>, url: Option<&str>) -> Result<CredTarget> {
    let target = match cred_target(dir, url).await {
        Ok(target) => target,
        Err(error) if error.code == ErrorCode::NoRemote && given(dir).is_some() && given(url).is_none() => {
            return Ok(CredTarget::NoRemote(NoRemoteTarget {
                no_remote: true,
                remote: None,
                url: None,
                protocol: RemoteProtocol::Https,
                host: None,
                hostname: None,
                saved: None,
                kind: None,
                cloud: false,
            }));
        }
        Err(error) => return Err(error),
    };
    let (creds, cicd) = (Arc::clone(&services.credentials), services.cicd.clone());
    blocking(move || {
        let info = creds.describe(&target.url)?;
        let api = gitlab_repo_path(&info).and_then(|path| api_state(&cicd, &creds, &info, path));
        let default_token_user = creds.default_token_user(info.host.as_deref().unwrap_or_default()).to_owned();
        Ok(CredTarget::Remote(Box::new(RemoteCredTarget { info, remote: target.remote, no_remote: false, default_token_user, api })))
    })
    .await
}

/// Проверка входа сразу после сохранения: GitLab — `checkLoginApi`, GitHub, Gitea и Bitbucket — `checkLogin` не дольше 8 с.
async fn check_saved(services: &Services, dir: Option<&str>, target: &mut RemoteCredTarget) {
    if let Some(path) = gitlab_repo_path(&target.info) {
        let hostname = target.info.hostname.as_deref().unwrap_or_default();
        let base = target.info.base.as_deref().unwrap_or_default();
        target.api = services.cicd.gitlab_check_login_api(hostname, path, base).await.ok().map(ApiState::Checked);
        return;
    }
    if given(dir).is_none() || !matches!(target.info.kind, Some(ServerKind::Github | ServerKind::Gitea | ServerKind::Bitbucket)) {
        return;
    }
    let Ok(root) = repo_root(dir).await else {
        return;
    };
    // Проверки входа идут в своих задачах (`CicdService::verify`): по таймауту ждать перестаём, а сама проверка завершится
    target.api = match tokio::time::timeout(CHECK_TIMEOUT, services.cicd.check_login(&root, None)).await {
        Ok(result) => result.ok().flatten().map(ApiState::Checked),
        Err(_) => Some(ApiState::Checked(LoginCheckResult {
            state: "unknown".to_owned(),
            reason: Some(t("сервер не ответил", &[])),
            user: None,
            scopes: None,
            method: None,
            via_api_token: None,
        })),
    };
}

async fn save_login(services: &Services, url: String, login: LoginInput) -> Result<()> {
    let creds = Arc::clone(&services.credentials);
    blocking(move || creds.save(&url, &login).map(drop)).await
}

/// Кладёт текст в буфер обмена. В отладке с подменой путей — в файл, чтобы тесты не трогали буфер пользователя.
fn copy_text(app: &AppHandle, services: &Services, text: &str) -> bool {
    if let Some(file) = &services.clipboard_file {
        return std::fs::write(file, text).is_ok();
    }
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text.to_owned()).is_ok()
}

/* ---------- Список серверов ---------- */

/// `serverFor`: сервер, известный только по старому токену, добавляется в конец.
fn server_for<'a>(servers: &'a mut Vec<ServerWithCi>, creds: &Credentials, hostname: &str, base: &str) -> &'a mut ServerWithCi {
    let index = match servers.iter().position(|server| server.hostname == hostname) {
        Some(index) => index,
        None => {
            let kind = creds.server_kind(hostname);
            servers.push(ServerWithCi {
                hostname: hostname.to_owned(),
                base: base.to_owned(),
                repos: Vec::new(),
                shared: Vec::new(),
                kind: kind.or(Some(ServerKind::Gitlab)),
                cloud: hostname == "gitlab.com",
                kind_saved: kind.is_some(),
                shared_ci: None,
            });
            servers.len() - 1
        }
    };
    &mut servers[index]
}

/// `serversWithCi`.
fn servers_with_ci(creds: &Credentials, cicd: &CicdService) -> Result<Vec<ServerWithCi>> {
    let mut servers: Vec<ServerWithCi> = creds
        .list_servers()?
        .into_iter()
        .map(|server| ServerWithCi {
            hostname: server.hostname,
            base: server.base,
            repos: server.repos.into_iter().map(|login| ServerRepo::Login(RepoWithCi { login, ci: None })).collect(),
            shared: server.shared,
            kind: server.kind,
            kind_saved: server.kind_saved,
            cloud: server.cloud,
            shared_ci: None,
        })
        .collect();
    let tokens = cicd.gitlab_list_tokens()?;
    for server in servers.iter_mut().filter(|server| server.kind == Some(ServerKind::Gitlab)) {
        for repo in &mut server.repos {
            let ServerRepo::Login(repo) = repo else {
                continue;
            };
            let state = cicd.gitlab_login_api_state(&server.hostname, &repo.login.path, Some(&server.base))?;
            let usable = repo.login.info.method == AuthMethod::Token || repo.login.info.has_api_token;
            repo.ci = Some(RepoCi {
                source: usable.then(|| "login".to_owned()),
                state: state.as_ref().map(|state| state.state.clone()).or_else(|| (!usable).then(|| "none".to_owned())),
                reason: state.as_ref().and_then(|state| state.reason.clone()),
                user: state.as_ref().and_then(|state| state.user.clone()),
                scopes: state.as_ref().and_then(|state| state.scopes.clone()),
                via_api_token: Some(repo.login.info.has_api_token),
                ..RepoCi::default()
            });
        }
    }
    for token in tokens.repos {
        let Some(hostname) = token.hostname.clone().filter(|hostname| !hostname.is_empty()) else {
            continue;
        };
        let server = server_for(&mut servers, creds, &hostname, &token.base);
        let path = token.path.clone().unwrap_or_default();
        let lower = path.to_lowercase();
        let mut matched = false;
        // Как `srv.repos.filter(...)` в 1.x: подходят и строки, добавленные по другим токенам
        for repo in server.repos.iter_mut().filter(|repo| repo.path().to_lowercase() == lower) {
            repo.ci_mut().legacy = Some(LegacyCiRef { key: token.key.clone(), user: token.user.clone(), scopes: token.scopes.clone() });
            matched = true;
        }
        if !matched {
            server.repos.push(ServerRepo::CiOnly(CiOnlyRepo {
                key: token.key,
                url: token.url,
                path,
                protocol: "ci".to_owned(),
                ci_only: true,
                ci: RepoCi { source: Some("legacy".to_owned()), user: token.user, scopes: token.scopes, readable: Some(token.readable), ..RepoCi::default() },
            }));
        }
    }
    for token in tokens.shared {
        let Some(hostname) = token.hostname.clone().filter(|hostname| !hostname.is_empty()) else {
            continue;
        };
        let base = token.base.clone();
        server_for(&mut servers, creds, &hostname, &base).shared_ci.get_or_insert_with(Vec::new).push(token);
    }
    for server in &mut servers {
        server.repos.sort_by(|a, b| js::locale_cmp(a.path(), b.path()));
    }
    Ok(servers)
}

/* ---------- Команды ---------- */

#[tauri::command]
#[specta::specta]
pub async fn creds_describe(state: State<'_, AppState>, dir: Option<String>, url: Option<String>) -> Result<CredTarget> {
    describe_target(state.services()?, dir.as_deref(), url.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_save(state: State<'_, AppState>, dir: Option<String>, url: Option<String>, data: Option<CredSaveInput>) -> Result<CredSaved> {
    let services = state.services()?;
    let (dir, url) = (dir.as_deref(), url.as_deref());
    let CredSaveInput { login, remote_url } = data.unwrap_or_default();
    let mut remote_change = None;
    match given(remote_url.as_deref()).filter(|_| given(dir).is_some() && given(url).is_none()) {
        Some(remote_url) => {
            let next = js::trim(remote_url).to_owned();
            if parse_target(&next).host.is_none() || repo_key_of(&next).is_none() {
                return Err(bad_args("Укажите полный адрес репозитория").with_hint(t("Например: https://gitlab.company.ru/group/project.git", &[])));
            }
            let root = repo_root(dir).await?;
            let current = cred_target(dir, None).await.ok();
            // Сначала вход: он проверяет данные, и с ошибкой в пароле remote не меняется
            save_login(services, next.clone(), login).await?;
            match current {
                None => {
                    git(&root, &["remote", "add", "origin", &next]).await?;
                    remote_change = Some(RemoteChange { remote: "origin".to_owned(), from: None, to: next });
                }
                Some(current) if current.url != next => {
                    let remote = current.remote.unwrap_or_default();
                    git(&root, &["remote", "set-url", &remote, &next]).await?;
                    remote_change = Some(RemoteChange { remote, from: Some(current.url), to: next });
                }
                Some(_) => {}
            }
        }
        None => {
            let target = cred_target(dir, url).await?;
            save_login(services, target.url, login).await?;
        }
    }
    let mut target = describe_target(services, dir, url).await?;
    if let CredTarget::Remote(described) = &mut target {
        check_saved(services, dir, described).await;
    }
    Ok(CredSaved { target, remote_change })
}

#[tauri::command]
#[specta::specta]
pub async fn creds_clear(state: State<'_, AppState>, dir: Option<String>, url: Option<String>) -> Result<ClearResult> {
    let creds = Arc::clone(&state.services()?.credentials);
    let target = cred_target(dir.as_deref(), url.as_deref()).await?;
    blocking(move || creds.clear(&target.url)).await
}

/// Доступ к репозиторию, который сейчас не открыт: `git ls-remote` с сохранённым входом.
#[tauri::command]
#[specta::specta]
pub async fn creds_check_url(state: State<'_, AppState>, url: Option<String>) -> Result<UrlChecked> {
    let services = state.services()?;
    let url = url.unwrap_or_default();
    if repo_key_of(&url).is_none() {
        return Err(bad_args("Укажите адрес репозитория"));
    }
    let home = home();
    let net = services.engine.network().options(&home, Some(&url)).await;
    let options = gorynych_git::run::GitOptions { timeout: Some(CHECK_URL_TIMEOUT), ..net.options.clone() };
    // `net` живёт до конца команды: его `Drop` отзывает секреты
    git_with(&home, &["ls-remote", "--heads", "--", &url], options).await?;
    drop(net);
    Ok(UrlChecked { ok: true })
}

/// Тип своего сервера (GitLab, GitHub Enterprise, Gitea…) по адресу.
#[tauri::command]
#[specta::specta]
pub async fn creds_detect_server(state: State<'_, AppState>, input: Option<String>) -> Result<DetectedServer> {
    detect_server(state.services()?.cicd.client(), &input.unwrap_or_default()).await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_servers(state: State<'_, AppState>) -> Result<Vec<ServerWithCi>> {
    let services = state.services()?;
    let (creds, cicd) = (Arc::clone(&services.credentials), services.cicd.clone());
    blocking(move || servers_with_ci(&creds, &cicd)).await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_forget_login(state: State<'_, AppState>, key: String) -> Result<ForgetResult> {
    let services = state.services()?;
    let (creds, cicd) = (Arc::clone(&services.credentials), services.cicd.clone());
    blocking(move || {
        if key.starts_with("ci:") {
            return cicd.gitlab_forget_token(&key).map(|result| ForgetResult { removed: result.removed });
        }
        // Авторизация одна: вместе со входом репозитория забываем и его старый отдельный токен CI/CD
        let servers = creds.list_servers()?;
        let row = servers.iter().find_map(|server| server.repos.iter().find(|repo| repo.key == key).map(|repo| (&server.hostname, &repo.path)));
        if let Some((hostname, path)) = row {
            cicd.gitlab_forget_repo_token(hostname, path)?;
        }
        creds.forget_login(&key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_forget_server(state: State<'_, AppState>, hostname: String) -> Result<ForgetResult> {
    let services = state.services()?;
    let (creds, cicd) = (Arc::clone(&services.credentials), services.cicd.clone());
    blocking(move || {
        let logins = creds.forget_server(&hostname)?;
        let tokens = cicd.gitlab_forget_host(&hostname)?;
        Ok(ForgetResult { removed: logins.removed || tokens.removed })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_set_kind(state: State<'_, AppState>, hostname: String, kind: Option<String>) -> Result<ServerKindSet> {
    let creds = Arc::clone(&state.services()?.credentials);
    blocking(move || {
        creds.set_server(&hostname, kind.as_deref().unwrap_or_default(), None)?;
        Ok(ServerKindSet { kind: creds.server_kind(&hostname) })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_ssh_keys(state: State<'_, AppState>) -> Result<SshKeyList> {
    let dir = state.services()?.ssh_dir.clone();
    blocking(move || Ok(list_ssh_keys(&dir))).await
}

/// Подсказки для формы нового ключа: имя файла и email автора из git config — как комментарий ключа.
#[tauri::command]
#[specta::specta]
pub async fn creds_key_defaults(state: State<'_, AppState>, dir: Option<String>, url: Option<String>, key_type: Option<String>) -> Result<KeyDefaults> {
    let ssh_dir = state.services()?.ssh_dir.clone();
    let dir = dir.as_deref();
    let target = match given(url.as_deref()) {
        Some(url) => parse_target(url),
        None => parse_target(&cred_target(dir, None).await.map(|target| target.url).unwrap_or_default()),
    };
    let root = match given(dir) {
        Some(_) => repo_root(dir).await.ok(),
        None => None,
    };
    let email = quiet(&root.unwrap_or_else(home), &["config", "user.email"]).await;
    let kind = if key_type.as_deref() == Some("rsa") { "rsa" } else { "ed25519" };
    blocking(move || {
        Ok(KeyDefaults {
            name: suggest_key_name(kind, target.hostname.as_deref(), &ssh_dir),
            comment: (!email.is_empty()).then_some(email),
            dir: list_ssh_keys(&ssh_dir).dir,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn creds_generate_key(app: AppHandle, state: State<'_, AppState>, options: Option<GenerateKeyOptions>) -> Result<GeneratedKeyCopied> {
    let services = state.services()?;
    let dir = services.ssh_dir.clone();
    let (binary, _) = git_info();
    let key = blocking(move || generate_ssh_key(&options.unwrap_or_default(), &dir, Some(&binary))).await?;
    let copied = copy_text(&app, services, &key.public_key);
    Ok(GeneratedKeyCopied { key, copied })
}

/// Перевести remote с `https://` на SSH (`git@host:path.git`), чтобы входить по ключу.
#[tauri::command]
#[specta::specta]
pub async fn creds_switch_to_ssh(state: State<'_, AppState>, dir: Option<String>) -> Result<SwitchedToSsh> {
    let services = state.services()?;
    let dir = dir.as_deref();
    let current = cred_target(dir, None).await?;
    let (Some(next), Some(remote)) = (ssh_url_for(&current.url), current.remote) else {
        return Err(bad_args("Адрес remote уже не https:// — менять нечего"));
    };
    let root = repo_root(dir).await?;
    git(&root, &["remote", "set-url", &remote, &next]).await?;
    let target = describe_target(services, dir, None).await?;
    Ok(SwitchedToSsh { remote, from: current.url, to: next, target })
}

#[tauri::command]
#[specta::specta]
pub async fn creds_copy_public_key(app: AppHandle, state: State<'_, AppState>, key_path: Option<String>) -> Result<PublicKeyCopied> {
    let services = state.services()?;
    let path = key_path.unwrap_or_default();
    let Some(public_key) = blocking(move || Ok(public_key_of(&path))).await? else {
        return Err(GorynychError::new(ErrorCode::NotFound, t("Рядом с ключом нет файла .pub", &[])));
    };
    let copied = copy_text(&app, services, &public_key);
    Ok(PublicKeyCopied { public_key, copied })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use gorynych_cicd::runner_setup::Docker;
    use gorynych_storage::Db;
    use gorynych_storage::credentials::{LegacyCiMeta, LegacySecret, LoginScope};
    use gorynych_storage::secrets::SecretStore;
    use serde_json::{Value, json};

    use super::*;

    #[derive(Default)]
    struct Memory(Mutex<HashMap<String, String>>);

    impl SecretStore for Memory {
        fn get(&self, account: &str) -> Option<String> {
            self.0.lock().unwrap().get(account).cloned()
        }

        fn set(&self, account: &str, secret: &str) -> Result<()> {
            self.0.lock().unwrap().insert(account.to_owned(), secret.to_owned());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<()> {
            self.0.lock().unwrap().remove(account);
            Ok(())
        }
    }

    fn login(method: &str, secret: &str) -> LoginInput {
        LoginInput { method: Some(method.to_owned()), username: Some("u".to_owned()), secret: Some(secret.to_owned()), ..LoginInput::default() }
    }

    fn legacy(creds: &Credentials, scope: LoginScope, key: &str, base: &str, path: Option<&str>) {
        let meta = LegacyCiMeta { base: Some(base.to_owned()), path: path.map(str::to_owned), scopes: Some(vec!["api".to_owned()]), ..LegacyCiMeta::default() };
        assert!(creds.import_legacy_ci_token(scope, key, &LegacySecret::Value("glpat-старый".to_owned()), None, &meta).unwrap());
    }

    /// Старые токены CI/CD из 1.x приклеиваются к входам, становятся отдельными строками и общими токенами сервера.
    #[test]
    fn servers_merge_logins_and_legacy_ci_tokens_like_1x() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open(&dir.path().join("state.db")).unwrap());
        let creds = Arc::new(Credentials::new(Arc::clone(&db), Arc::new(Memory::default())));
        let cicd = CicdService::new(db, Arc::clone(&creds), Arc::new(crate::bridge::GitForCicd), Docker::default());

        creds.save("https://gitlab.example.com/grp/b.git", &login("password", "пароль")).unwrap();
        creds.save("https://gitlab.example.com/grp/a.git", &login("token", "glpat-новый")).unwrap();
        creds.save("https://github.com/o/r.git", &login("token", "ghp_x")).unwrap();
        // Путь в другом регистре: приклеивается ко входу grp/b
        legacy(&creds, LoginScope::Repo, "https://gitlab.example.com/GRP/B", "https://gitlab.example.com", Some("GRP/B"));
        // Входа нет: отдельная строка
        legacy(&creds, LoginScope::Repo, "https://gitlab.example.com/grp/c", "https://gitlab.example.com", Some("grp/c"));
        // Сервер известен только по токену
        legacy(&creds, LoginScope::Repo, "https://ci.corp.test/x/y", "https://ci.corp.test", Some("x/y"));
        legacy(&creds, LoginScope::Host, "https://gitlab.example.com", "https://gitlab.example.com", None);

        let servers = serde_json::to_value(servers_with_ci(&creds, &cicd).unwrap()).unwrap();
        let by_host = |host: &str| servers.as_array().unwrap().iter().find(|s| s["hostname"] == json!(host)).cloned().unwrap_or(Value::Null);

        let gitlab = by_host("gitlab.example.com");
        let paths: Vec<&Value> = gitlab["repos"].as_array().unwrap().iter().map(|r| &r["path"]).collect();
        assert_eq!(paths, [&json!("grp/a"), &json!("grp/b"), &json!("grp/c")], "сортировка по пути: {gitlab}");
        let repos = &gitlab["repos"];
        assert_eq!(repos[0]["ci"]["source"], json!("login"), "вход токеном годится для API");
        assert_eq!(repos[0]["ci"]["state"], Value::Null, "ещё не проверялся");
        assert_eq!(repos[0]["ci"]["legacy"], Value::Null);
        assert_eq!(repos[1]["ci"]["source"], Value::Null, "пароль API GitLab не принимает");
        assert_eq!(repos[1]["ci"]["state"], json!("none"));
        assert_eq!(repos[1]["ci"]["legacy"]["key"], json!("ci:https://gitlab.example.com/GRP/B"), "{gitlab}");
        assert_eq!(repos[1]["ci"]["legacy"]["scopes"], json!(["api"]));
        assert_eq!(repos[2]["ciOnly"], json!(true), "{gitlab}");
        assert_eq!(repos[2]["protocol"], json!("ci"));
        assert_eq!(repos[2]["ci"]["source"], json!("legacy"));
        assert_eq!(repos[2]["ci"]["readable"], json!(true));
        assert_eq!(gitlab["sharedCi"][0]["key"], json!("ci:https://gitlab.example.com"), "{gitlab}");

        let github = by_host("github.com");
        assert_eq!(github["repos"][0]["ci"], Value::Null, "не GitLab: сведений о CI/CD нет");
        assert_eq!(github["sharedCi"], Value::Null);

        let only_token = by_host("ci.corp.test");
        assert_eq!(only_token["kind"], json!("gitlab"), "тип неизвестен — считается GitLab: {only_token}");
        assert_eq!(only_token["kindSaved"], json!(false));
        assert_eq!(only_token["base"], json!("https://ci.corp.test"));
        assert_eq!(only_token["repos"][0]["ciOnly"], json!(true));
        assert_eq!(servers.as_array().unwrap().last().unwrap()["hostname"], json!("ci.corp.test"), "такие серверы — в конце");
    }
}
