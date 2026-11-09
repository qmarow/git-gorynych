//! Единый слой CI/CD: `electron/cicd/index.cjs`. Определяет провайдера репозитория, берёт авторизацию репозитория (ту же, что для Pull и Push) и отдаёт нормализованные модели.
//!
//! ## Конспект
//! - `resolveRemote`: провайдер из настроек → `serverKind` → `.gitea|.forgejo/workflows` → неизвестен. Адрес сайта для SSH — из окна входа.
//! - `apiBaseFor`: github.com → api.github.com, иначе `/api/v3`; Gitea `/api/v1`; bitbucket.org → api.bitbucket.org/2.0, иначе `/rest/api/1.0`; свой адрес дополняется суффиксом.
//! - Заголовки: GitHub `Bearer` и `X-GitHub-Api-Version`; Gitea `token …` или Basic; Bitbucket `Bearer` или Basic (кроме `x-token-auth`).
//! - `verify`: `whoami` (при `NOT_FOUND` и `FORBIDDEN` пользователь неизвестен), затем `init`. `ok` хранится до смены токена, `bad` — 10 минут, `NETWORK` и `RATE_LIMIT` не хранятся. `setSettings` сбрасывает проверки.
//! - `require_` проверяет возможность и даёт `UNSUPPORTED` с подсказкой из `why`. `runnersPrune` удаляет только `offline`, не общие, не виртуальные, изменяемые.
//! - `stagesOf`: GitLab — этапы пайплайна; Bitbucket — шаги по порядку; GitHub и Gitea — уровни по `needs` из файла workflow в этом коммите или в рабочей папке.
//! - Форма запуска: `workflow_dispatch.inputs`, custom-пайплайны Bitbucket, `spec:inputs` и переменные с `description` у GitLab.
//!
//! ## Отличия от 1.x
//! - Сверка тегов всегда разбирает файлы через `preview_ci`: это `loadCi` без истории, которую `skipHistory` и так отключал.
//! - Порядок меток и заданий с кириллицей другой: `localeCompare` зависит от локали системы, а [`gorynych_core::js::locale_cmp`] ставит латиницу первой.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use gorynych_ci_linter::check::tags::{RunnerInfo, check_runner_tags};
use gorynych_ci_linter::detect::detect_ci;
use gorynych_ci_linter::load::preview_ci;
use gorynych_ci_linter::yaml::{Value as Yaml, parse_yaml};
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use gorynych_storage::credentials::{ApiLogin, AuthMethod, Credentials, LegacyCiUser, ServerKind, UnusableLogin};
use gorynych_storage::db::Db;
use gorynych_storage::repo_providers::{CiProvider, RepoProvider};
use indexmap::IndexMap;
use regex::Regex;
use serde::Deserialize;
use tokio::sync::watch;

use crate::gitlab::{GlProject, GlRemoteStatus};
use crate::http::{Downloaded, HttpCtx};
use crate::json::Json;
use crate::models::*;
use crate::providers::{CapsInput, CiCdProvider, Ctx, DetailData, RegistrationRequest, adapter};
use crate::remote::{CicdGit, is_http_url, parse_remote_url, parse_remotes, pick_remote, site_base};
use crate::runner_setup::{Docker, DockerStatus, LocalRunner, clean_labels, commands, time_suffix};

/// Что делать с итогом проверки.
pub(crate) enum CheckFlow<O> {
    Keep(O),
    /// Сервер недоступен: проверим в следующий раз.
    Forget(O),
}

struct CheckEntry<O> {
    started: Instant,
    rx: watch::Receiver<Option<Arc<O>>>,
}

/// Проверки входов: одна проверка на отпечаток, одновременные вызовы ждут её же.
pub(crate) struct Checks<O> {
    map: Arc<Mutex<HashMap<String, Arc<CheckEntry<O>>>>>,
}

impl<O: Send + Sync + 'static> Checks<O> {
    fn new() -> Self {
        Self { map: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// `None` — не проверялся; `Some(None)` — проверка идёт.
    pub(crate) fn state(&self, key: &str) -> Option<Option<Arc<O>>> {
        self.map.lock().expect("проверки").get(key).map(|entry| entry.rx.borrow().clone())
    }

    fn clear(&self) {
        self.map.lock().expect("проверки").clear();
    }

    /// Итог проверки: готовый, если он ещё годен, иначе новая проверка.
    pub(crate) async fn run<F, Fut>(&self, key: String, valid: impl Fn(Option<&O>, Instant) -> bool, work: F, lost: impl Fn() -> O) -> Arc<O>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = CheckFlow<O>> + Send + 'static,
    {
        let mut rx = {
            let mut map = self.map.lock().expect("проверки");
            match map.get(&key).filter(|entry| valid(entry.rx.borrow().as_deref(), entry.started)) {
                Some(entry) => entry.rx.clone(),
                None => {
                    let (tx, rx) = watch::channel(None);
                    let entry = Arc::new(CheckEntry { started: Instant::now(), rx: rx.clone() });
                    map.insert(key.clone(), entry.clone());
                    let fut = work();
                    let shared = self.map.clone();
                    tokio::spawn(async move {
                        let (outcome, keep) = match fut.await {
                            CheckFlow::Keep(outcome) => (outcome, true),
                            CheckFlow::Forget(outcome) => (outcome, false),
                        };
                        if !keep {
                            let mut map = shared.lock().expect("проверки");
                            if map.get(&key).is_some_and(|current| Arc::ptr_eq(current, &entry)) {
                                map.remove(&key);
                            }
                        }
                        let _ = tx.send(Some(Arc::new(outcome)));
                    });
                    rx
                }
            }
        };
        match rx.wait_for(Option::is_some).await {
            Ok(value) => value.clone().expect("дождались значения"),
            Err(_) => Arc::new(lost()),
        }
    }
}

/// Итог `verify` для GitHub, Gitea и Bitbucket.
#[derive(Debug, Clone)]
pub struct ForgeCheck {
    pub state: &'static str,
    pub user: Option<LegacyCiUser>,
    pub reason: Option<String>,
    pub hint: Option<String>,
    pub flags: ForgeFlags,
    pub at: Instant,
}

/// Что `init` узнал о репозитории.
#[derive(Debug, Clone, Default)]
pub struct ForgeFlags {
    pub can_write: Option<bool>,
    pub is_admin: Option<bool>,
    pub default_branch: Option<String>,
    pub web_url: Option<String>,
}

pub(crate) struct Inner {
    pub(crate) db: Arc<Db>,
    pub(crate) creds: Arc<Credentials>,
    pub(crate) git: Arc<dyn CicdGit>,
    pub(crate) client: reqwest::Client,
    pub(crate) docker: Docker,
    pub(crate) checks: Checks<ForgeCheck>,
    pub(crate) login_checks: Checks<crate::gitlab::GlCheck>,
    pub(crate) project_cache: Mutex<HashMap<String, (Instant, GlProject)>>,
    pub(crate) etag_cache: Mutex<IndexMap<String, crate::gitlab::EtagEntry>>,
}

/// Служба CI/CD. Клонируется дёшево.
#[derive(Clone)]
pub struct CicdService {
    pub(crate) inner: Arc<Inner>,
}

/// Remote и провайдер.
#[derive(Debug, Clone)]
pub struct ResolvedRemote {
    pub name: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub site_base: String,
    pub kind: Option<CiProvider>,
    pub conf: Option<RepoProvider>,
    pub protocol: &'static str,
}

fn label_of(kind: CiProvider) -> &'static str {
    adapter(kind).label()
}

fn provider_of(kind: Option<ServerKind>) -> Option<CiProvider> {
    match kind? {
        ServerKind::Gitlab => Some(CiProvider::Gitlab),
        ServerKind::Github => Some(CiProvider::Github),
        ServerKind::Gitea => Some(CiProvider::Gitea),
        ServerKind::Bitbucket => Some(CiProvider::Bitbucket),
        ServerKind::Other => None,
    }
}

fn has_dir(root: &Path, rel: &str) -> bool {
    std::fs::metadata(root.join(rel)).is_ok_and(|meta| meta.is_dir())
}

/// `kindFromFiles`.
fn kind_from_files(root: &Path) -> Option<CiProvider> {
    (has_dir(root, ".gitea/workflows") || has_dir(root, ".forgejo/workflows")).then_some(CiProvider::Gitea)
}

/// `apiBaseFor`.
pub fn api_base_for(kind: CiProvider, host: &str, site: &str, override_base: Option<&str>) -> Option<String> {
    if let Some(base) = override_base.filter(|base| !base.is_empty()) {
        if kind == CiProvider::Github && !base.ends_with("/api/v3") && base != "https://api.github.com" && !base.starts_with("https://api.") && !base.starts_with("http://api.") {
            return Some(format!("{base}/api/v3"));
        }
        if kind == CiProvider::Gitea && !base.ends_with("/api/v1") {
            return Some(format!("{base}/api/v1"));
        }
        return Some(base.to_owned());
    }
    match kind {
        CiProvider::Github => Some(if host == "github.com" { "https://api.github.com".to_owned() } else { format!("{site}/api/v3") }),
        CiProvider::Gitea => Some(format!("{site}/api/v1")),
        CiProvider::Bitbucket => Some(if host == "bitbucket.org" { "https://api.bitbucket.org/2.0".to_owned() } else { format!("{site}/rest/api/1.0") }),
        CiProvider::Gitlab => None,
    }
}

fn basic(user: &str, secret: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("{user}:{secret}")))
}

fn login_problem_text(r: &ResolvedRemote, other: Option<&UnusableLogin>, bad: Option<&ForgeCheck>) -> Option<String> {
    let label = r.kind.map_or("", label_of);
    if let Some(bad) = bad {
        let reason = bad.reason.as_deref().unwrap_or("undefined");
        let hint = bad.hint.as_ref().map_or_else(String::new, |hint| format!(" — {hint}"));
        return Some(t("Авторизация репозитория не подходит для {0}: {1}{2}", &[&label, &reason, &hint]));
    }
    if other.is_some_and(|other| other.method == AuthMethod::Ssh) {
        return Some(t("Репозиторий авторизован SSH-ключом — его принимает git, но не API {0}. Добавьте в авторизацию репозитория токен для пайплайнов.", &[&label]));
    }
    None
}

fn require(caps: &Capabilities, enabled: bool, cap: &str, provider_label: &str, what: &str) -> Result<()> {
    if enabled {
        return Ok(());
    }
    let message = caps.reason(cap).map_or_else(|| t("{0}: {1} недоступно", &[&provider_label, &what]), str::to_owned);
    Err(GorynychError::new(ErrorCode::Unsupported, message))
}

fn with_caps<T>(provider: &dyn CiCdProvider, ctx: &Ctx, data: T) -> WithCaps<T> {
    WithCaps { data, provider: provider.id().as_str().to_owned(), label: provider.label().to_owned(), capabilities: provider.capabilities(ctx.caps_input()) }
}

static SPLIT_EXPR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\$\{\{[^}]*\}\}").expect("корректный шаблон"));
static DOC_SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"(?m)^---[{}]*$", js::WHITESPACE_CLASS)).expect("корректный шаблон"));
static SECRET_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[A-Za-z_][A-Za-z0-9_]*$").expect("корректный шаблон"));
static NOT_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^0-9A-Za-z_.-]+").expect("корректный шаблон"));

/// Уровни заданий workflow по `needs`.
struct Levels {
    level: HashMap<String, usize>,
    patterns: Vec<(String, String, Option<Regex>)>,
}

impl Levels {
    fn level_of(&self, name: &str) -> usize {
        let hit = self
            .patterns
            .iter()
            .find(|(_, display, _)| display == name)
            .or_else(|| self.patterns.iter().find(|(_, _, pattern)| pattern.as_ref().is_some_and(|pattern| pattern.is_match(name))))
            .or_else(|| self.patterns.iter().find(|(id, _, _)| name == id || name.strip_prefix(id.as_str()).is_some_and(|rest| rest.starts_with(' '))));
        hit.and_then(|(id, _, _)| self.level.get(id)).copied().unwrap_or(0)
    }

    fn from_text(text: &str) -> Option<Self> {
        let data = parse_yaml(text).data;
        let jobs = data.get("jobs")?.as_map()?.clone();
        let ids: Vec<String> = jobs.keys().cloned().collect();
        let needs_of = |id: &str| -> Vec<String> {
            match jobs.get(id).and_then(|job| job.get("needs")) {
                None | Some(Yaml::Null) => Vec::new(),
                Some(Yaml::Seq(list)) => list.iter().map(Yaml::js_string).filter(|need| jobs.contains_key(need)).collect(),
                Some(other) => Some(other.js_string()).into_iter().filter(|need| jobs.contains_key(need)).collect(),
            }
        };
        fn visit(id: &str, stack: &mut Vec<String>, level: &mut HashMap<String, usize>, needs_of: &dyn Fn(&str) -> Vec<String>) -> usize {
            if let Some(found) = level.get(id) {
                return *found;
            }
            if stack.iter().any(|item| item == id) {
                return 0;
            }
            stack.push(id.to_owned());
            let lv = needs_of(id).iter().map(|need| visit(need, stack, level, needs_of) + 1).max().unwrap_or(0);
            stack.pop();
            level.insert(id.to_owned(), lv);
            lv
        }
        let mut level = HashMap::new();
        for id in &ids {
            visit(id, &mut Vec::new(), &mut level, &needs_of);
        }
        let patterns = ids
            .iter()
            .map(|id| {
                let display = jobs.get(id).and_then(|job| job.get("name")).filter(|name| !name.is_null()).map_or_else(|| id.clone(), Yaml::js_string);
                let body = SPLIT_EXPR.split(&display).map(regex::escape).collect::<Vec<_>>().join(".*");
                (id.clone(), display, Regex::new(&format!(r"^{body}(?: \(.*\))?(?: / .*)?$")).ok())
            })
            .collect();
        Some(Self { level, patterns })
    }
}

fn input_field(key: String, spec: Option<&Yaml>) -> InputField {
    let empty = Yaml::Map(Default::default());
    let s = spec.filter(|spec| matches!(spec, Yaml::Map(_))).unwrap_or(&empty);
    let type_of = s.get("type").and_then(Yaml::as_str);
    let options = s.get("options").and_then(Yaml::as_seq);
    let kind = match type_of {
        Some("boolean") => "boolean",
        Some("choice") => "choice",
        _ if options.is_some() => "choice",
        Some("number") => "number",
        Some("environment") => "environment",
        _ => "string",
    };
    let default = s.get("default").filter(|value| !value.is_null()).cloned().unwrap_or_else(|| match kind {
        "boolean" => Yaml::Bool(false),
        "choice" => options.and_then(|list| list.first()).filter(|value| !value.is_null()).cloned().unwrap_or_else(|| Yaml::String(String::new())),
        _ => Yaml::String(String::new()),
    });
    InputField {
        key,
        kind: kind.to_owned(),
        description: s.get("description").filter(|value| !value.is_null()).map(Yaml::js_string),
        required: s.get("required").is_some_and(Yaml::truthy),
        default,
        options: options.map(|list| list.iter().map(Yaml::js_string).collect()),
    }
}

fn read_yaml(root: &Path, rel: &str) -> Option<Yaml> {
    let text = std::fs::read_to_string(root.join(rel)).ok()?;
    Some(parse_yaml(&text).data)
}

fn map_of(value: Option<&Yaml>) -> Vec<(String, Yaml)> {
    match value {
        Some(item @ (Yaml::Map(_) | Yaml::Seq(_))) => item.js_entries(),
        _ => Vec::new(),
    }
}

/// `path.posix.basename`.
fn posix_base(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or_default()
}

/// Параметры `runner-tags`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunnerTagRequest {
    pub file: Option<String>,
    pub drafts: Option<HashMap<String, String>>,
}

/// Что вернул запуск локального раннера.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct LocalRunnerStarted {
    pub name: String,
    pub provider: String,
}

/// Имя запущенного или остановленного контейнера.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct LocalRunnerName {
    pub name: String,
}

/// Docker и контейнеры репозитория.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct LocalRunners {
    pub docker: DockerStatus,
    pub runners: Vec<LocalRunner>,
}

/// Список раннеров.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct RunnersData {
    pub runners: Vec<CiRunner>,
}

/// Список секретов.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct SecretsData {
    pub secrets: Vec<CiSecretVariable>,
}

/// Параметры обновления настроек.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct SettingsInput {
    pub provider: Option<String>,
    pub api_base: Option<String>,
}

impl CicdService {
    /// Служба. `docker` — обычно [`Docker::default`].
    pub fn new(db: Arc<Db>, creds: Arc<Credentials>, git: Arc<dyn CicdGit>, docker: Docker) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                creds,
                git,
                client: crate::http::client(),
                docker,
                checks: Checks::new(),
                login_checks: Checks::new(),
                project_cache: Mutex::new(HashMap::new()),
                etag_cache: Mutex::new(IndexMap::new()),
            }),
        }
    }

    /// HTTP-клиент: его использует окно входа для `detect_server`.
    pub fn client(&self) -> &reqwest::Client {
        &self.inner.client
    }

    /// `git remote -v`; ошибка — пусто.
    pub(crate) async fn remote_verbose(&self, root: &Path) -> String {
        let (git, root) = (self.inner.git.clone(), root.to_path_buf());
        tokio::task::spawn_blocking(move || git.remote_verbose(&root)).await.ok().and_then(std::result::Result::ok).unwrap_or_default()
    }

    /// `resolveRemote`.
    pub async fn resolve_remote(&self, root: &Path, preferred: Option<&str>) -> Option<ResolvedRemote> {
        let output = self.remote_verbose(root).await;
        self.resolve_remote_from(root, preferred, &output)
    }

    /// `resolveRemote` по готовому выводу `git remote -v`: [`Self::detect`] и [`Self::context`] нужен он же и для GitLab, а
    /// процесс git на Windows стоит десятки миллисекунд.
    fn resolve_remote_from(&self, root: &Path, preferred: Option<&str>, output: &str) -> Option<ResolvedRemote> {
        let remotes = parse_remotes(output);
        let (name, url) = pick_remote(&remotes, preferred)?;
        let parsed = parse_remote_url(url)?;
        let is_http = is_http_url(url);
        let site = site_base(&parsed, is_http, if is_http { None } else { self.inner.creds.server_base(&parsed.host) });
        let conf = self.inner.db.repo_provider(&parsed.host, &parsed.path).ok().flatten();
        let kind = conf.as_ref().and_then(|conf| conf.provider).or_else(|| provider_of(self.inner.creds.server_kind(&parsed.host))).or_else(|| kind_from_files(root));
        Some(ResolvedRemote { name: name.to_owned(), url: url.to_owned(), host: parsed.host, path: parsed.path, site_base: site, kind, conf, protocol: if is_http { "https" } else { "ssh" } })
    }

    fn http_ctx(&self, r: &ResolvedRemote, kind: CiProvider, login: &ApiLogin, root: &Path) -> Ctx {
        let is_token = login.via_api_token || login.method == AuthMethod::Token;
        let secret = &login.secret;
        let headers: Vec<(String, String)> = match kind {
            CiProvider::Github => vec![("Authorization".into(), format!("Bearer {secret}")), ("X-GitHub-Api-Version".into(), "2022-11-28".into())],
            CiProvider::Gitea => vec![("Authorization".into(), if is_token { format!("token {secret}") } else { basic(login.username.as_deref().unwrap_or_default(), secret) })],
            _ => {
                let user = login.username.as_deref().filter(|user| !user.is_empty() && *user != "x-token-auth");
                vec![("Authorization".into(), match user.filter(|_| !is_token) { Some(user) => basic(user, secret), None => format!("Bearer {secret}") })]
            }
        };
        let (label, scope_hint) = match kind {
            CiProvider::Github => ("GitHub", t("Токену нужны права repo и workflow (классический) или Actions, Administration и Secrets (fine-grained)", &[])),
            CiProvider::Gitea => ("Gitea", t("Токену нужны права write:repository (и read:user)", &[])),
            _ => ("Bitbucket", t("Паролю приложения нужны права Pipelines: Read/Write и Repositories: Read", &[])),
        };
        let conf_base = r.conf.as_ref().and_then(|conf| conf.api_base.as_deref());
        let (owner, repo) = r.path.split_once('/').map_or((r.path.as_str(), ""), |(owner, rest)| (owner, rest));
        Ctx {
            http: HttpCtx { client: self.inner.client.clone(), api_base: api_base_for(kind, &r.host, &r.site_base, conf_base).unwrap_or_default(), headers, label: label.to_owned(), scope_hint: Some(scope_hint) },
            host: r.host.clone(),
            api_override: conf_base.is_some_and(|base| !base.is_empty()),
            owner: owner.to_owned(),
            repo: repo.to_owned(),
            site_base: r.site_base.clone(),
            web_url: Some(format!("{}/{}", r.site_base, r.path)),
            can_write: None,
            is_admin: None,
            default_branch: None,
            root: root.to_path_buf(),
            gitlab: None,
        }
    }

    fn check_key(r: &ResolvedRemote, kind: CiProvider, login: &ApiLogin) -> String {
        crate::gitlab::fingerprint(&[kind.as_str(), &r.host, &r.path, r.conf.as_ref().and_then(|conf| conf.api_base.as_deref()).unwrap_or_default(), &login.secret])
    }

    /// `verify`: проверка авторизации для API.
    async fn verify(&self, r: &ResolvedRemote, kind: CiProvider, login: &ApiLogin, root: &Path) -> Arc<ForgeCheck> {
        let ctx = self.http_ctx(r, kind, login, root);
        self.inner
            .checks
            .run(
                Self::check_key(r, kind, login),
                |check, started| match check {
                    Some(check) => check.state == "ok" || check.at.elapsed() < Duration::from_secs(600),
                    None => started.elapsed() < Duration::from_secs(600),
                },
                move || async move {
                    let mut ctx = ctx;
                    let provider = adapter(kind);
                    let bad = |error: GorynychError| {
                        if matches!(error.code, ErrorCode::Network | ErrorCode::RateLimit) {
                            CheckFlow::Forget(ForgeCheck { state: "unknown", user: None, reason: Some(error.message), hint: None, flags: ForgeFlags::default(), at: Instant::now() })
                        } else {
                            CheckFlow::Keep(ForgeCheck { state: "bad", user: None, reason: Some(error.message), hint: error.hint, flags: ForgeFlags::default(), at: Instant::now() })
                        }
                    };
                    let user = match provider.whoami(&ctx).await {
                        Ok(user) => user,
                        Err(error) if matches!(error.code, ErrorCode::NotFound | ErrorCode::Forbidden) => None,
                        Err(error) => return bad(error),
                    };
                    if let Err(error) = provider.init(&mut ctx).await {
                        return bad(error);
                    }
                    let flags = ForgeFlags { can_write: ctx.can_write, is_admin: ctx.is_admin, default_branch: ctx.default_branch, web_url: ctx.web_url };
                    CheckFlow::Keep(ForgeCheck { state: "ok", user, reason: None, hint: None, flags, at: Instant::now() })
                },
                || ForgeCheck { state: "unknown", user: None, reason: None, hint: None, flags: ForgeFlags::default(), at: Instant::now() },
            )
            .await
    }

    /// `detect`: провайдер и состояние авторизации, без ожидания сети.
    pub async fn detect(&self, root: &Path, preferred: Option<&str>) -> Result<Option<ForgeStatus>> {
        let output = self.remote_verbose(root).await;
        let Some(r) = self.resolve_remote_from(root, preferred, &output) else {
            return Ok(None);
        };
        let settings = r.conf.as_ref().map(|conf| ForgeSettings { provider: conf.provider, api_base: conf.api_base.clone() });
        let detected_kind = self.inner.creds.server_kind(&r.host);
        let kind = r.kind.filter(|kind| *kind != CiProvider::Gitlab);
        let Some(kind) = kind else {
            let Some(g) = self.gitlab_detect_from(preferred, &output)? else {
                return Ok(None);
            };
            let is_gitlab = g.kind == Some(CiProvider::Gitlab);
            let GlRemoteStatus { remote, url, protocol, host, base, path, web_url, token, .. } = g;
            let (capabilities, api_base, provider, label) = if is_gitlab {
                let write = crate::gitlab::scopes_allow_write(token.scopes.as_deref());
                (adapter(CiProvider::Gitlab).capabilities(CapsInput { can_write: Some(write), ..CapsInput::default() }), Some(format!("{base}/api/v4")), Some(CiProvider::Gitlab), Some(label_of(CiProvider::Gitlab).to_owned()))
            } else {
                (Capabilities::default(), None, None, None)
            };
            return Ok(Some(ForgeStatus { kind: provider, provider, label, remote, url, protocol, host, base, path, web_url: Some(web_url), api_base, token, capabilities, settings, detected_kind }));
        };
        let make = |token: TokenStatus, capabilities: Capabilities, web_url: Option<String>| ForgeStatus {
            kind: Some(kind),
            provider: Some(kind),
            label: Some(label_of(kind).to_owned()),
            remote: r.name.clone(),
            url: r.url.clone(),
            protocol: r.protocol.to_owned(),
            host: r.host.clone(),
            base: r.site_base.clone(),
            path: r.path.clone(),
            web_url: web_url.or_else(|| Some(format!("{}/{}", r.site_base, r.path))),
            api_base: api_base_for(kind, &r.host, &r.site_base, r.conf.as_ref().and_then(|conf| conf.api_base.as_deref())),
            token,
            capabilities,
            settings: settings.clone(),
            detected_kind,
        };
        let logins = self.inner.creds.api_login_for(&r.host, &r.path, Some(server_kind_of(kind)))?;
        let Some(login) = logins.repo.or(logins.shared) else {
            let other = logins.other.as_ref();
            let repo_login = other.map(|other| LoginProblem { method: Some(other.method), reason: login_problem_text(&r, Some(other), None) });
            return Ok(Some(make(TokenStatus { repo_login, ..TokenStatus::default() }, Capabilities::default(), None)));
        };
        let state = self.inner.checks.state(&Self::check_key(&r, kind, &login));
        let settled = state.clone().flatten();
        if let Some(check) = settled.as_ref().filter(|check| check.state == "bad") {
            let repo_login = Some(LoginProblem { method: Some(login.method), reason: login_problem_text(&r, None, Some(check)) });
            return Ok(Some(make(TokenStatus { repo_login, ..TokenStatus::default() }, Capabilities::default(), None)));
        }
        if state.is_none() {
            let (service, r2, login2, root2) = (self.clone(), r.clone(), login.clone(), root.to_path_buf());
            tokio::spawn(async move { service.verify(&r2, kind, &login2, &root2).await });
        }
        let flags = settled.as_ref().map(|check| check.flags.clone()).unwrap_or_default();
        let token = TokenStatus {
            configured: true,
            source: Some("login".to_owned()),
            pending: Some(settled.is_none()),
            user: settled.as_ref().and_then(|check| check.user.clone()),
            login: Some(TokenLogin { method: login.method, username: login.username.clone(), shared: login.shared, via_api_token: login.via_api_token }),
            ..TokenStatus::default()
        };
        let capabilities = adapter(kind).capabilities(CapsInput { can_write: flags.can_write, is_admin: flags.is_admin, access_level: None });
        Ok(Some(make(token, capabilities, flags.web_url)))
    }

    /// `checkLogin`: проверка сейчас, после сохранения входа.
    pub async fn check_login(&self, root: &Path, preferred: Option<&str>) -> Result<Option<LoginCheckResult>> {
        let Some(r) = self.resolve_remote(root, preferred).await else {
            return Ok(None);
        };
        let Some(kind) = r.kind.filter(|kind| *kind != CiProvider::Gitlab) else {
            return Ok(None);
        };
        let logins = self.inner.creds.api_login_for(&r.host, &r.path, Some(server_kind_of(kind)))?;
        let Some(login) = logins.repo.or(logins.shared) else {
            return Ok(Some(LoginCheckResult { state: "none".to_owned(), reason: login_problem_text(&r, logins.other.as_ref(), None), user: None, scopes: None, method: None, via_api_token: None }));
        };
        let check = self.verify(&r, kind, &login, root).await;
        let reason = if check.state == "bad" { login_problem_text(&r, None, Some(&check)) } else { check.reason.clone() };
        Ok(Some(LoginCheckResult { state: check.state.to_owned(), reason, user: check.user.clone(), scopes: None, method: None, via_api_token: None }))
    }

    /// `context`.
    async fn context(&self, root: &Path, preferred: Option<&str>) -> Result<(&'static dyn CiCdProvider, Ctx)> {
        let output = self.remote_verbose(root).await;
        let Some(r) = self.resolve_remote_from(root, preferred, &output) else {
            return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])));
        };
        let Some(kind) = r.kind.filter(|kind| *kind != CiProvider::Gitlab) else {
            let glc = self.gitlab_context_from(preferred, &output).await.map_err(|error| {
                if error.code == ErrorCode::NotGitlab {
                    GorynychError::new(ErrorCode::NoProvider, t("Не удалось определить сервис CI/CD", &[])).with_hint(t("Укажите провайдера (GitLab, GitHub, Gitea, Bitbucket) и адрес API в настройках CI/CD репозитория", &[]))
                } else {
                    error
                }
            })?;
            let (name, value) = glc.token.header();
            let ctx = Ctx {
                http: HttpCtx { client: glc.client.clone(), api_base: format!("{}/api/v4", glc.remote.base), headers: vec![(name, value)], label: "GitLab".to_owned(), scope_hint: None },
                host: r.host.clone(),
                api_override: false,
                owner: String::new(),
                repo: String::new(),
                site_base: glc.remote.base.clone(),
                web_url: glc.project.web_url.clone(),
                can_write: None,
                is_admin: None,
                default_branch: glc.project.default_branch.clone(),
                root: root.to_path_buf(),
                gitlab: Some(glc),
            };
            return Ok((adapter(CiProvider::Gitlab), ctx));
        };
        let logins = self.inner.creds.api_login_for(&r.host, &r.path, Some(server_kind_of(kind)))?;
        let Some(login) = logins.repo.or(logins.shared) else {
            let hint = login_problem_text(&r, logins.other.as_ref(), None).unwrap_or_else(|| t("Авторизуйте репозиторий — эта же авторизация работает и для {0}", &[&label_of(kind)]));
            return Err(GorynychError::new(ErrorCode::NoToken, t("Репозиторий не авторизован", &[])).with_hint(hint));
        };
        let check = self.verify(&r, kind, &login, root).await;
        if check.state == "bad" {
            let mut error = GorynychError::new(ErrorCode::NoToken, t("Авторизация репозитория не подходит для CI/CD", &[]));
            error.hint = login_problem_text(&r, None, Some(&check));
            return Err(error);
        }
        let mut ctx = self.http_ctx(&r, kind, &login, root);
        ctx.can_write = check.flags.can_write;
        ctx.is_admin = check.flags.is_admin;
        ctx.default_branch = check.flags.default_branch.clone();
        if let Some(url) = &check.flags.web_url {
            ctx.web_url = Some(url.clone());
        }
        Ok((adapter(kind), ctx))
    }

    /// `info`.
    pub async fn info(&self, root: &Path, preferred: Option<&str>) -> Result<WithCaps<ForgeInfo>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let data = ForgeInfo { web_url: ctx.web_url.clone(), default_branch: ctx.default_branch.clone() };
        Ok(with_caps(provider, &ctx, data))
    }

    /// `pipelines`.
    pub async fn pipelines(&self, root: &Path, reference: Option<&str>, preferred: Option<&str>) -> Result<WithCaps<PipelineList>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let data = provider.list_pipelines(&ctx, reference.filter(|name| !name.is_empty())).await?;
        Ok(with_caps(provider, &ctx, data))
    }

    /// `workflowLevels`.
    async fn workflow_levels(&self, root: &Path, pipeline: Option<&PipelineRun>) -> Option<Levels> {
        let pipeline = pipeline?;
        let file = pipeline.workflow_path.clone().or_else(|| {
            let name = pipeline.workflow_file.as_deref().filter(|name| !name.is_empty())?;
            [".gitea/workflows", ".forgejo/workflows", ".github/workflows"].iter().map(|dir| format!("{dir}/{name}")).find(|candidate| root.join(candidate).exists())
        })?;
        let sha = pipeline.sha.clone().unwrap_or_else(|| "undefined".to_owned());
        let spec = format!("{sha}:{file}");
        let (git, root_owned) = (self.inner.git.clone(), root.to_path_buf());
        let shown = tokio::task::spawn_blocking(move || git.show(&root_owned, &spec)).await.ok().flatten();
        let text = match shown {
            Some(text) => text,
            None => std::fs::read_to_string(root.join(&file)).ok()?,
        };
        Levels::from_text(&text)
    }

    /// `stagesOf`.
    async fn stages_of(&self, root: &Path, data: &DetailData) -> Vec<PipelineStage> {
        if let Some(order) = &data.stage_order {
            return order
                .iter()
                .map(|name| {
                    let mut jobs: Vec<PipelineJob> = data.jobs.iter().filter(|job| job.stage == *name).cloned().collect();
                    jobs.sort_by(|a, b| js::locale_cmp_numeric(a.name.as_deref().unwrap_or_default(), b.name.as_deref().unwrap_or_default()));
                    PipelineStage { name: name.clone(), status: aggregate_jobs(&jobs), jobs }
                })
                .collect();
        }
        if data.sequential {
            return data.jobs.iter().map(|job| PipelineStage { name: job.stage.clone().or_else(|| job.name.clone()), status: job.status.clone().unwrap_or_default(), jobs: vec![job.clone()] }).collect();
        }
        let workflow = data.pipeline.as_ref().and_then(|pipeline| pipeline.workflow.clone());
        let default_name = || workflow.clone().unwrap_or_else(|| t("Задания", &[]));
        if let Some(levels) = self.workflow_levels(root, data.pipeline.as_ref()).await {
            let job_levels: Vec<usize> = data.jobs.iter().map(|job| levels.level_of(job.name.as_deref().unwrap_or_default())).collect();
            let max = job_levels.iter().copied().max().unwrap_or(0);
            let stage_name = |index: usize| if index == 0 { t("Старт", &[]) } else { t("После шага {0}", &[&index]) };
            return (0..=max)
                .filter_map(|index| {
                    let jobs: Vec<PipelineJob> = data.jobs.iter().zip(&job_levels).filter(|(_, level)| **level == index).map(|(job, _)| PipelineJob { stage: Some(stage_name(index)), ..job.clone() }).collect();
                    if jobs.is_empty() {
                        return None;
                    }
                    Some(PipelineStage { name: Some(if max == 0 { default_name() } else { stage_name(index) }), status: aggregate_jobs(&jobs), jobs })
                })
                .collect();
        }
        if data.jobs.is_empty() {
            return Vec::new();
        }
        let name = default_name();
        let jobs: Vec<PipelineJob> = data.jobs.iter().map(|job| PipelineJob { stage: Some(name.clone()), ..job.clone() }).collect();
        vec![PipelineStage { name: Some(name), status: aggregate_jobs(&data.jobs), jobs }]
    }

    /// `pipeline`.
    pub async fn pipeline(&self, root: &Path, id: &CiId, preferred: Option<&str>) -> Result<WithCaps<PipelineDetail>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let data = provider.pipeline_detail(&ctx, id).await?;
        let stages = self.stages_of(root, &data).await;
        Ok(with_caps(provider, &ctx, PipelineDetail { pipeline: data.pipeline, stages, artifacts: data.artifacts, can_write: data.can_write }))
    }

    /// `jobLog`.
    pub async fn job_log(&self, root: &Path, id: &CiId, pipeline_id: Option<&CiId>, preferred: Option<&str>) -> Result<WithCaps<JobLog>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let data = provider.job_log(&ctx, id, pipeline_id).await?;
        Ok(with_caps(provider, &ctx, data))
    }

    /// `action`.
    pub async fn action(&self, root: &Path, a: &ActionRequest, preferred: Option<&str>) -> Result<ActionResult> {
        let cap: fn(&Capabilities) -> bool;
        let cap_name;
        match a.kind.as_deref() {
            Some("pipeline.cancel") => (cap, cap_name) = (|c: &Capabilities| c.can_cancel, "canCancel"),
            Some("pipeline.retry") => (cap, cap_name) = (|c: &Capabilities| c.can_retry, "canRetry"),
            Some("pipeline.retry-failed") => (cap, cap_name) = (|c: &Capabilities| c.can_retry_failed, "canRetryFailed"),
            Some("job.retry") => (cap, cap_name) = (|c: &Capabilities| c.can_rerun_single_job, "canRerunSingleJob"),
            Some("job.cancel") => (cap, cap_name) = (|c: &Capabilities| c.can_cancel_job, "canCancelJob"),
            Some("job.play") => (cap, cap_name) = (|c: &Capabilities| c.can_play_manual_job, "canPlayManualJob"),
            _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестное действие", &[]))),
        }
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, cap(&caps), cap_name, provider.label(), &t("действие", &[]))?;
        provider.action(&ctx, a).await
    }

    /// `run`: запуск пайплайна.
    pub async fn run(&self, root: &Path, params: &RunParams, preferred: Option<&str>) -> Result<RunResult> {
        let reference = js::trim(params.reference.as_deref().unwrap_or_default()).to_owned();
        if reference.is_empty() {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
        }
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_run_pipeline, "canRunPipeline", provider.label(), &t("запуск", &[]))?;
        let variables: Vec<RunVariable> = params
            .variables
            .iter()
            .flatten()
            .filter_map(|v| {
                let key = js::trim(v.key.as_deref().unwrap_or_default());
                (!key.is_empty()).then(|| RunVariable { key: Some(key.to_owned()), ..v.clone() })
            })
            .collect();
        if !variables.is_empty() && !caps.can_run_with_variables {
            let message = caps.reason("canRunWithVariables").map_or_else(|| t("Переменные при запуске не поддерживаются", &[]), str::to_owned);
            return Err(GorynychError::new(ErrorCode::Unsupported, message));
        }
        provider.run_pipeline(&ctx, &RunInput { reference, workflow: params.workflow.clone(), inputs: params.inputs.clone().unwrap_or_default(), variables }).await
    }

    /// `runForm`.
    pub async fn run_form(&self, root: &Path, preferred: Option<&str>) -> RunForm {
        let kind = self.resolve_remote(root, preferred).await.and_then(|r| r.kind).unwrap_or(CiProvider::Gitlab);
        let systems = detect_ci(root);
        match kind {
            CiProvider::Github | CiProvider::Gitea => {
                let dirs: &[&str] = if kind == CiProvider::Github { &["github"] } else { &["gitea", "forgejo", "github"] };
                let mut workflows = Vec::new();
                for system in systems.iter().filter(|system| dirs.contains(&system.id.as_str())) {
                    for file in &system.files {
                        let Some(data) = read_yaml(root, file) else {
                            continue;
                        };
                        let name = data.get("name").filter(|name| name.truthy()).map_or_else(|| posix_base(file).to_owned(), Yaml::js_string);
                        let on = data.get("on").filter(|on| !on.is_null()).or_else(|| data.get("true"));
                        let dispatch: Option<Option<&Yaml>> = match on {
                            Some(Yaml::Map(map)) => map.get("workflow_dispatch").map(Some),
                            Some(Yaml::Seq(list)) => list.iter().any(|item| item.as_str() == Some("workflow_dispatch")).then_some(None),
                            Some(Yaml::String(text)) if text == "workflow_dispatch" => Some(None),
                            _ => None,
                        };
                        let Some(dispatch) = dispatch else {
                            workflows.push(RunWorkflow { path: Some(file.clone()), name, value: None, dispatchable: false, inputs: Vec::new() });
                            continue;
                        };
                        let inputs = map_of(dispatch.and_then(|dispatch| dispatch.get("inputs")));
                        workflows.push(RunWorkflow { path: Some(file.clone()), name, value: None, dispatchable: true, inputs: inputs.into_iter().map(|(key, value)| input_field(key, Some(&value))).collect() });
                    }
                }
                RunForm { kind: kind.as_str().to_owned(), workflows, inputs: None, variables: Vec::new(), allow_custom_variables: false }
            }
            CiProvider::Bitbucket => {
                let data = systems.iter().find(|system| system.id == "bitbucket").and_then(|system| read_yaml(root, &system.files[0]));
                let custom = map_of(data.as_ref().and_then(|data| data.get("pipelines")).and_then(|pipelines| pipelines.get("custom")));
                let mut workflows = vec![RunWorkflow { path: None, name: t("По ветке (branches / default)", &[]), value: None, dispatchable: true, inputs: Vec::new() }];
                for (name, steps) in custom {
                    let list: Vec<Yaml> = match steps {
                        Yaml::Null => Vec::new(),
                        Yaml::Seq(list) => list,
                        other => vec![other],
                    };
                    let vars = list.iter().find_map(|step| step.get("variables").and_then(Yaml::as_seq).map(<[Yaml]>::to_vec)).unwrap_or_default();
                    let inputs = vars
                        .iter()
                        .map(|v| {
                            let mut spec = gorynych_ci_linter::yaml::JsMap::new();
                            for (from, to) in [("description", "description"), ("default", "default"), ("allowed-values", "options")] {
                                if let Some(value) = v.get(from) {
                                    spec.insert(to.to_owned(), value.clone());
                                }
                            }
                            input_field(v.get("name").map_or_else(|| "undefined".to_owned(), Yaml::js_string), Some(&Yaml::Map(spec)))
                        })
                        .collect();
                    let value = format!("custom: {name}");
                    workflows.push(RunWorkflow { path: None, value: Some(value.clone()), name: value, dispatchable: true, inputs });
                }
                RunForm { kind: kind.as_str().to_owned(), workflows, inputs: None, variables: Vec::new(), allow_custom_variables: true }
            }
            CiProvider::Gitlab => {
                let mut variables = Vec::new();
                let mut inputs = Vec::new();
                if let Some(system) = systems.iter().find(|system| system.id == "gitlab") {
                    let text = std::fs::read_to_string(root.join(&system.files[0])).unwrap_or_default();
                    let docs: Vec<&str> = DOC_SPLIT.split(&text).collect();
                    if docs.len() > 1 {
                        let header = parse_yaml(docs[0]).data;
                        inputs = map_of(header.get("spec").and_then(|spec| spec.get("inputs")).filter(|spec| matches!(spec, Yaml::Map(_) | Yaml::Seq(_)))).into_iter().map(|(key, value)| input_field(key, Some(&value))).collect();
                    }
                    let body = if docs.len() > 1 { docs[1..].join("---\n") } else { text.clone() };
                    let data = parse_yaml(&body).data;
                    for (key, value) in map_of(data.get("variables")) {
                        if let Yaml::Map(_) = value
                            && let Some(description) = value.get("description").filter(|item| !item.is_null())
                        {
                            variables.push(RunVariableField {
                                key,
                                description: description.js_string(),
                                default: value.get("value").filter(|item| !item.is_null()).map_or_else(String::new, Yaml::js_string),
                                options: value.get("options").and_then(Yaml::as_seq).map(|list| list.iter().map(Yaml::js_string).collect()),
                            });
                        }
                    }
                }
                RunForm { kind: "gitlab".to_owned(), workflows: Vec::new(), inputs: Some(inputs), variables, allow_custom_variables: true }
            }
        }
    }

    /// `runners`.
    pub async fn runners(&self, root: &Path, preferred: Option<&str>) -> Result<WithCaps<RunnersData>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        if !caps.can_list_runners {
            let message = caps.reason("canListRunners").map_or_else(|| t("Раннеры недоступны", &[]), str::to_owned);
            return Err(GorynychError::new(ErrorCode::Unsupported, message));
        }
        let runners = provider.list_runners(&ctx).await?;
        Ok(with_caps(provider, &ctx, RunnersData { runners }))
    }

    /// `runnerUpdate`.
    pub async fn runner_update(&self, root: &Path, id: &CiId, patch: &RunnerPatch, preferred: Option<&str>) -> Result<RunnerResult> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        if patch.labels.is_some() {
            require(&caps, caps.can_edit_runner_labels, "canEditRunnerLabels", provider.label(), &t("изменение меток", &[]))?;
        }
        if patch.paused.is_some() {
            require(&caps, caps.can_pause_runner, "canPauseRunner", provider.label(), &t("пауза", &[]))?;
        }
        if patch.run_untagged.is_some() || patch.locked.is_some() || patch.description.is_some() || patch.maximum_timeout.is_some() {
            require(&caps, caps.can_edit_runner_settings, "canEditRunnerSettings", provider.label(), &t("настройки раннера", &[]))?;
        }
        provider.update_runner(&ctx, id, patch).await
    }

    /// `runnerDelete`.
    pub async fn runner_delete(&self, root: &Path, id: &CiId, preferred: Option<&str>) -> Result<RunnerResult> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_delete_runner, "canDeleteRunner", provider.label(), &t("удаление раннера", &[]))?;
        provider.delete_runner(&ctx, id).await
    }

    /// `runnersPrune`: удалить раннеры не в сети, кроме общих.
    pub async fn runners_prune(&self, root: &Path, ids: Option<&[CiId]>, preferred: Option<&str>) -> Result<PruneResult> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_delete_runner, "canDeleteRunner", provider.label(), &t("удаление раннеров", &[]))?;
        let list = provider.list_runners(&ctx).await?;
        let (mut removed, mut failed) = (Vec::new(), Vec::new());
        for runner in list.iter().filter(|r| r.status == "offline" && !r.is_shared && !r.is_virtual && r.editable) {
            let Some(id) = runner.id.as_ref().filter(|id| ids.is_none_or(|ids| ids.contains(id))) else {
                continue;
            };
            match provider.delete_runner(&ctx, id).await {
                Ok(_) => removed.push(PrunedRunner { id: Some(id.clone()), name: runner.name.clone(), error: None }),
                Err(error) => failed.push(PrunedRunner { id: Some(id.clone()), name: runner.name.clone(), error: Some(error.message) }),
            }
        }
        Ok(PruneResult { removed, failed })
    }

    /// `runnerRegister`: токен и готовые команды.
    pub async fn runner_register(&self, root: &Path, options: &RunnerRegisterOptions, preferred: Option<&str>) -> Result<RunnerRegistration> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_create_runner_token, "canCreateRunnerToken", provider.label(), &t("регистрация раннера", &[]))?;
        let labels = clean_labels(&options.labels);
        let request = RegistrationRequest { labels: labels.clone(), description: options.description.clone(), run_untagged: options.run_untagged.unwrap_or(false), locked: options.locked, paused: options.paused.unwrap_or(false) };
        let token = provider.registration_token(&ctx, &request).await?;
        let raw_name = options.name.clone().filter(|name| !name.is_empty()).unwrap_or_else(|| format!("git-gorynych-{}", time_suffix()));
        let name = NOT_NAME.replace_all(&raw_name, "-").into_owned();
        let id = provider.id().as_str();
        let commands = commands(id, token.url.as_deref().unwrap_or("undefined"), token.token.as_deref().unwrap_or("undefined"), &labels, &name);
        Ok(RunnerRegistration { token, labels, name, provider: id.to_owned(), commands })
    }

    /* ---------- Локальный Docker-раннер ---------- */

    /// `localRunners`.
    pub async fn local_runners(&self, root: &Path, preferred: Option<&str>) -> Result<LocalRunners> {
        let docker = self.inner.docker.status().await;
        if !docker.available {
            return Ok(LocalRunners { docker, runners: Vec::new() });
        }
        let key = self.resolve_remote(root, preferred).await.map(|r| format!("{}/{}", r.host, r.path).to_lowercase());
        let runners = self.inner.docker.local_runners(key.as_deref()).await?;
        Ok(LocalRunners { docker, runners })
    }

    /// `localRunnerStart`.
    pub async fn local_runner_start(&self, root: &Path, labels: &[Json], preferred: Option<&str>) -> Result<LocalRunnerStarted> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.local_runner, "localRunner", provider.label(), &t("локальный раннер", &[]))?;
        let Some(r) = self.resolve_remote(root, preferred).await else {
            return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])));
        };
        let clean = clean_labels(labels);
        let request = RegistrationRequest { labels: clean.clone(), description: Some(t("git-Горыныч (локальный Docker)", &[])), run_untagged: clean.is_empty(), locked: None, paused: false };
        let reg = provider.registration_token(&ctx, &request).await?;
        let id = provider.id().as_str();
        let repo_key = format!("{}/{}", r.host, r.path).to_lowercase();
        let repo_name = r.path.rsplit('/').next().unwrap_or_default();
        match self.inner.docker.start_local(id, reg.url.as_deref().unwrap_or("undefined"), reg.token.as_deref().unwrap_or("undefined"), &clean, &repo_key, repo_name).await {
            Ok(name) => Ok(LocalRunnerStarted { name, provider: id.to_owned() }),
            Err(error) => {
                // Раннер GitLab уже создан на сервере: убираем, чтобы не висел мёртвым
                if let Some(runner) = &reg.runner_id {
                    let _ = provider.delete_runner(&ctx, runner).await;
                }
                Err(error)
            }
        }
    }

    /// `localRunnerStop`.
    pub async fn local_runner_stop(&self, name: &str) -> Result<LocalRunnerName> {
        self.inner.docker.stop_local(name).await?;
        Ok(LocalRunnerName { name: name.to_owned() })
    }

    /// `localRunnerResume`.
    pub async fn local_runner_resume(&self, name: &str) -> Result<LocalRunnerName> {
        self.inner.docker.resume_local(name).await?;
        Ok(LocalRunnerName { name: name.to_owned() })
    }

    /// `dockerStatus`.
    pub async fn docker_status(&self) -> DockerStatus {
        self.inner.docker.status().await
    }

    /* ---------- Артефакты ---------- */

    /// `artifactDownload`.
    pub async fn artifact_download(&self, root: &Path, artifact: Option<&ArtifactRef>, dest: Option<&Path>, preferred: Option<&str>) -> Result<Downloaded> {
        let (Some(artifact), Some(dest)) = (artifact, dest.filter(|dest| !dest.as_os_str().is_empty())) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указан артефакт или файл", &[])));
        };
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_download_artifacts, "canDownloadArtifacts", provider.label(), &t("скачивание артефактов", &[]))?;
        provider.download_artifact(&ctx, artifact, dest).await
    }

    /* ---------- Секреты и переменные ---------- */

    /// `secrets`.
    pub async fn secrets(&self, root: &Path, preferred: Option<&str>) -> Result<WithCaps<SecretsData>> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_manage_secrets, "canManageSecrets", provider.label(), &t("секреты", &[]))?;
        let secrets = provider.list_secrets(&ctx).await?;
        Ok(with_caps(provider, &ctx, SecretsData { secrets }))
    }

    /// `secretSave`.
    pub async fn secret_save(&self, root: &Path, data: &SecretSave, preferred: Option<&str>) -> Result<SecretResult> {
        let key = js::trim(data.key.as_deref().unwrap_or_default()).to_owned();
        if !SECRET_KEY.is_match(&key) {
            return Err(GorynychError::new(ErrorCode::InvalidName, t("Имя: латинские буквы, цифры и _, не с цифры", &[])));
        }
        if key.get(..7).is_some_and(|head| head.eq_ignore_ascii_case("GITHUB_")) {
            return Err(GorynychError::new(ErrorCode::InvalidName, t("Имена с GITHUB_ зарезервированы", &[])));
        }
        let Some(value) = data.value.as_ref().and_then(Json::as_str) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Введите значение", &[])));
        };
        if js::utf16_len(value) > 48 * 1024 {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Значение больше 48 КБ", &[])));
        }
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_manage_secrets, "canManageSecrets", provider.label(), &t("секреты", &[]))?;
        provider.save_secret(&ctx, &SecretInput { key, value: value.to_owned(), secret: data.secret, original: data.original.clone() }).await
    }

    /// `secretDelete`.
    pub async fn secret_delete(&self, root: &Path, data: &SecretRef, preferred: Option<&str>) -> Result<SecretResult> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        require(&caps, caps.can_manage_secrets, "canManageSecrets", provider.label(), &t("секреты", &[]))?;
        provider.delete_secret(&ctx, data).await
    }

    /* ---------- Настройки и проверка тегов ---------- */

    /// `getSettings`.
    pub async fn get_settings(&self, root: &Path, preferred: Option<&str>) -> Option<CicdSettingsView> {
        let r = self.resolve_remote(root, preferred).await?;
        let detected = self.inner.creds.server_kind(&r.host).map(|kind| kind.as_str().to_owned()).or_else(|| kind_from_files(root).map(|kind| kind.as_str().to_owned()));
        let default_api_base = r.kind.and_then(|kind| api_base_for(kind, &r.host, &r.site_base, None));
        Some(CicdSettingsView {
            detected,
            provider: r.conf.as_ref().and_then(|conf| conf.provider),
            api_base: r.conf.as_ref().and_then(|conf| conf.api_base.clone()),
            effective: r.kind,
            default_api_base,
            host: r.host,
            path: r.path,
        })
    }

    /// `setSettings`.
    pub async fn set_settings(&self, root: &Path, data: &SettingsInput, preferred: Option<&str>) -> Result<Option<CicdSettingsView>> {
        let Some(r) = self.resolve_remote(root, preferred).await else {
            return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])));
        };
        self.inner.db.set_repo_provider(&r.host, &r.path, data.provider.as_deref(), data.api_base.as_deref())?;
        self.inner.checks.clear();
        Ok(self.get_settings(root, preferred).await)
    }

    /// `runnerTagCheck`: сверка тегов и меток из конфигурации с живыми раннерами.
    pub async fn runner_tag_check(&self, root: &Path, request: &RunnerTagRequest, preferred: Option<&str>) -> Result<RunnerTagReport> {
        let (provider, ctx) = self.context(root, preferred).await?;
        let caps = provider.capabilities(ctx.caps_input());
        if !caps.can_list_runners {
            return Ok(RunnerTagReport { available: false, reason: caps.reason("canListRunners").map(str::to_owned), issues: Vec::new(), labels: Vec::new(), runners: None, live: None, provider: None });
        }
        let list = provider.list_runners(&ctx).await?;
        let (git, root_path): (Arc<dyn CicdGit>, PathBuf) = (self.inner.git.clone(), root.to_path_buf());
        let file = request.file.clone().unwrap_or_default();
        let drafts = request.drafts.clone().unwrap_or_default();
        let language = i18n::language();
        let current = tokio::task::spawn_blocking(move || preview_ci(&root_path, &file, language, &drafts, &*git.view(&root_path)).load.current).await.map_err(GorynychError::unknown)?;
        let infos: Vec<RunnerInfo> = list.iter().map(|runner| RunnerInfo { name: runner.name.clone(), status: runner.status.clone(), labels: runner.labels.clone(), run_untagged: runner.run_untagged }).collect();
        let issues = current.as_ref().map_or_else(Vec::new, |current| check_runner_tags(current, &infos, language));
        let is_live = |runner: &&CiRunner| matches!(runner.status.as_str(), "online" | "busy");
        let live: Vec<&CiRunner> = list.iter().filter(is_live).collect();
        // Метки своих раннеров — первыми, затем облачных; без повторов с точностью до регистра
        let mut labels: Vec<String> = Vec::new();
        for is_virtual in [false, true] {
            let mut group: Vec<&String> = live.iter().filter(|runner| runner.is_virtual == is_virtual).flat_map(|runner| &runner.labels).collect();
            group.sort_by(|a, b| js::locale_cmp(a, b));
            group.dedup();
            for label in group {
                if !labels.iter().any(|known| known.to_lowercase() == label.to_lowercase()) {
                    labels.push(label.clone());
                }
            }
        }
        Ok(RunnerTagReport { available: true, reason: None, issues, labels, runners: Some(list.len() as u32), live: Some(live.len() as u32), provider: Some(provider.id().as_str().to_owned()) })
    }
}

fn aggregate_jobs(jobs: &[PipelineJob]) -> String {
    aggregate(jobs.iter().map(|job| (job.status.as_deref(), job.allow_failure)))
}

fn server_kind_of(kind: CiProvider) -> ServerKind {
    match kind {
        CiProvider::Gitlab => ServerKind::Gitlab,
        CiProvider::Github => ServerKind::Github,
        CiProvider::Gitea => ServerKind::Gitea,
        CiProvider::Bitbucket => ServerKind::Bitbucket,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_base_table() {
        let api = |kind, host, over| api_base_for(kind, host, "https://site", over);
        assert_eq!(api(CiProvider::Github, "github.com", None).unwrap(), "https://api.github.com");
        assert_eq!(api(CiProvider::Github, "ghe.x", None).unwrap(), "https://site/api/v3");
        assert_eq!(api(CiProvider::Gitea, "g", None).unwrap(), "https://site/api/v1");
        assert_eq!(api(CiProvider::Bitbucket, "bitbucket.org", None).unwrap(), "https://api.bitbucket.org/2.0");
        assert_eq!(api(CiProvider::Bitbucket, "b", None).unwrap(), "https://site/rest/api/1.0");
        assert_eq!(api(CiProvider::Gitlab, "g", None), None);
        assert_eq!(api(CiProvider::Github, "g", Some("https://x")).unwrap(), "https://x/api/v3");
        assert_eq!(api(CiProvider::Github, "g", Some("https://x/api/v3")).unwrap(), "https://x/api/v3");
        assert_eq!(api(CiProvider::Github, "g", Some("https://api.x")).unwrap(), "https://api.x");
        assert_eq!(api(CiProvider::Gitea, "g", Some("https://x")).unwrap(), "https://x/api/v1");
        assert_eq!(api(CiProvider::Bitbucket, "g", Some("https://x")).unwrap(), "https://x");
    }

    #[test]
    fn levels_follow_needs_and_names() {
        let text = "jobs:\n  a:\n    runs-on: x\n  b:\n    name: Сборка ${{ matrix.os }}\n    needs: a\n  c:\n    needs: [a, b, нет]\n  d:\n    needs: [e]\n  e:\n    needs: [d]\n";
        let levels = Levels::from_text(text).unwrap();
        assert_eq!(levels.level_of("a"), 0);
        assert_eq!(levels.level_of("Сборка ubuntu"), 1);
        assert_eq!(levels.level_of("Сборка ubuntu (1, 2) / x"), 1);
        assert_eq!(levels.level_of("c"), 2);
        assert_eq!(levels.level_of("c (x)"), 2);
        assert_eq!(levels.level_of("неизвестное"), 0);
        assert!(Levels::from_text("a: 1").is_none());
    }

    #[test]
    fn input_field_types() {
        let doc = parse_yaml("a: {type: boolean}\nb: {options: [x, y]}\nc: {type: number, default: 5, description: d, required: true}\nd: {type: environment}\ne: строка\n").data;
        let field = |key: &str| input_field(key.to_owned(), doc.get(key));
        assert_eq!((field("a").kind.as_str(), field("a").default), ("boolean", Yaml::Bool(false)));
        assert_eq!((field("b").kind.as_str(), field("b").default), ("choice", Yaml::String("x".into())));
        assert_eq!(field("c").kind, "number");
        assert!(field("c").required);
        assert_eq!(field("d").kind, "environment");
        assert_eq!(field("e").kind, "string");
    }
}
