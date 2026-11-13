//! Новое в 2.0: задачи (issues) сервера репозитория — список, карточка с лентой, создание и правка, комментарии, метки.
//!
//! Модуль живёт в `gorynych-cicd`, потому что ему нужен [`crate::service::CicdService::context`]: определение сервера,
//! авторизация и [`crate::http::HttpCtx`] уже собраны там. Адаптеры — на трейте [`IssueProvider`], по одному на сервер:
//! [`gitlab`], [`github`], [`gitea`], [`bitbucket`]. Все отдают одинаковые структуры из [`models`].
//!
//! ## Правила
//! - Запросы — только через `crate::http::request` с `ctx.http` (GitLab — `GlCtx::request`, как в `crate::gitlab`).
//! - Разбор ответа — чистые функции `issue_from`, `comment_from`, `label_from`… Отсутствующее поле не ошибка: строка — пустая,
//!   список — пустой, число — 0.
//! - Постраничность — `page` и размер страницы; `has_more = items.len() == per_page`.
//! - Лента в `get` — не больше 300 элементов (3 страницы по 100), иначе `timeline_truncated`.
//! - `meta`: метки, открытые вехи и участники — до 300 каждого вида, параллельно; сбой одного — пустой список.
//! - Чего у сервера нет — `issues-not-supported` (`UNKNOWN`), а флаг в [`IssueCaps`] — `false`.
//! - 404 на список задач при найденном репозитории и явный признак отключённого трекера — `ISSUES_DISABLED`.
//!
//! ## Расхождения плана с документацией API (сверено 13.11.2026)
//! - GitLab: цвет меток в задаче приходит только с `with_labels_details=true`; «мне назначено» и «создано мной» — `scope`
//!   (`assigned_to_me`, `created_by_me`), а не имя пользователя; «без исполнителя» — `assignee_id=None`, «без вехи» —
//!   `milestone=None`. Сортировки по числу комментариев нет (ближайшая — `popularity`, это голоса, а не комментарии) —
//!   берётся `updated_at`. `assignee_ids` при создании — только Premium и Ultimate, в Free — `assignee_id`: при отказе
//!   запрос повторяется с первым исполнителем. Участники — `GET /projects/:id/members/all` (страница документации
//!   переехала в `project_members.md`).
//! - GitHub: в списке задач нет текстового поиска — `GET /search/issues` (`q=repo:o/r is:issue …`), у которого свои параметры
//!   сортировки (`sort`, `order`). `assignee` принимает `none`, `creator` — только логин: `@me` переводится в логин из `GET /user`.
//! - Gitea: в списке нет сортировки (сервер отдаёт новые сверху, `sort` и `ascending` не применяются); фильтр меток —
//!   «любая из», а не «все»; фильтра «без исполнителя» в API нет (`@none` не применяется); размер страницы — `limit`.
//!   Блокировка обсуждения в текущей версии есть (`/issues/{index}/lock`), но в выпущенных версиях её может не быть — `lock`
//!   оставлен `false`, как в плане. Метки в ленте: `type: label`, тело `"1"` — добавлена, пустое — снята.
//! - Bitbucket Cloud: трекер задач и его API удалены 20.08.2026 (журнал изменений Atlassian) — все флаги `false`, список —
//!   `ISSUES_DISABLED`; Bitbucket Data Center трекера не имеет.

pub mod bitbucket;
pub mod gitea;
pub mod github;
pub mod gitlab;
pub mod models;
pub mod templates;

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_storage::repo_providers::CiProvider;
use serde_json::Value;

use crate::json::{field, items, non_empty, text};
use crate::providers::Ctx;
pub use models::*;

/// Сколько элементов ленты и справочников читается: 3 страницы по 100.
pub const MAX_PAGES: u32 = 3;
pub const PAGE_SIZE: u32 = 100;

/// Задачи одного сервера.
#[async_trait]
pub trait IssueProvider: Send + Sync {
    /// Что сервер умеет и что разрешено пользователю.
    fn caps(&self, ctx: &Ctx) -> IssueCaps;
    /// Адрес списка задач на сервере — для «Открыть на сервере».
    fn web_url(&self, ctx: &Ctx) -> Option<String>;
    async fn list(&self, ctx: &Ctx, query: &IssueQuery) -> Result<IssueList>;
    async fn get(&self, ctx: &Ctx, number: u64) -> Result<IssueDetail>;
    async fn meta(&self, ctx: &Ctx) -> Result<IssueMeta>;
    async fn create(&self, ctx: &Ctx, input: &IssueInput) -> Result<Issue>;
    async fn update(&self, ctx: &Ctx, number: u64, patch: &IssuePatch) -> Result<Issue>;
    async fn comment_add(&self, ctx: &Ctx, number: u64, body: &str) -> Result<IssueComment>;
    async fn comment_update(&self, ctx: &Ctx, number: u64, id: &str, body: &str) -> Result<IssueComment>;
    async fn comment_delete(&self, ctx: &Ctx, number: u64, id: &str) -> Result<()>;
    async fn label_create(&self, ctx: &Ctx, name: &str, color: &str) -> Result<IssueLabel>;
    async fn delete(&self, ctx: &Ctx, number: u64) -> Result<()>;
}

/// Адаптер задач для сервера.
pub fn issue_adapter(kind: CiProvider) -> &'static dyn IssueProvider {
    match kind {
        CiProvider::Gitlab => &gitlab::GitlabIssues,
        CiProvider::Github => &github::GithubIssues,
        CiProvider::Gitea => &gitea::GiteaIssues,
        CiProvider::Bitbucket => &bitbucket::BitbucketIssues,
    }
}

/* ---------- Ошибки ---------- */

/// Действия нет у этого сервера.
pub fn not_supported() -> GorynychError {
    GorynychError::unknown(t("issues-not-supported", &[]))
}

/// «Задача #N не найдена»: текст готовится до запроса (аргументы `t` не держатся через `.await`).
pub fn not_found_text(number: u64) -> String {
    t("issues-not-found", &[&number])
}

/// Трекер задач выключен в репозитории (или у сервера его нет).
pub fn disabled(label: &str) -> GorynychError {
    GorynychError::new(ErrorCode::IssuesDisabled, t("issues-disabled", &[&label])).with_hint(t("issues-disabled-hint", &[]))
}

/// Ошибка запроса списка задач: 404 при найденном репозитории или «Issues are disabled» (GitHub отвечает 410) — трекер выключен.
pub fn list_error(error: GorynychError, label: &str) -> GorynychError {
    let disabled_text = error.details.to_lowercase().contains("disabled");
    if error.code == ErrorCode::NotFound || (error.code == ErrorCode::ApiError && disabled_text) {
        return disabled(label);
    }
    error
}

/* ---------- Разбор ответов ---------- */

/// Идентификатор строкой: число или строка; нет — пустая строка.
pub fn id_text(value: &Value, key: &str) -> String {
    match field(value, key) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

/// Неотрицательное целое; нет или не число — 0.
pub fn uint(value: &Value, key: &str) -> u64 {
    field(value, key).and_then(|item| item.as_u64().or_else(|| item.as_str().and_then(|text| text.parse().ok()))).unwrap_or(0)
}

/// Строка; нет — пустая.
pub fn string(value: &Value, key: &str) -> String {
    text(value, key).unwrap_or_default()
}

/// Цвет метки `#rrggbb`: `#RGB`, `RRGGBB` без решётки и регистр приводятся; иное — [`DEFAULT_LABEL_COLOR`].
pub fn label_color(raw: Option<&str>) -> String {
    let Some(raw) = raw.map(str::trim) else {
        return DEFAULT_LABEL_COLOR.to_owned();
    };
    let hex = raw.strip_prefix('#').unwrap_or(raw);
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return DEFAULT_LABEL_COLOR.to_owned();
    }
    match hex.len() {
        6 => format!("#{}", hex.to_ascii_lowercase()),
        3 => format!("#{}", hex.chars().flat_map(|c| [c, c]).collect::<String>().to_ascii_lowercase()),
        _ => DEFAULT_LABEL_COLOR.to_owned(),
    }
}

/// Пользователь любого из серверов: `login` (GitHub, Gitea) или `username` (GitLab); имя — `name` или `full_name`;
/// страница — `web_url` или `html_url`. Пустой объект — `None`.
pub fn user_from(value: &Value) -> Option<IssueUser> {
    if !value.is_object() {
        return None;
    }
    let login = non_empty(value, "login").or_else(|| non_empty(value, "username")).unwrap_or_default();
    let id = id_text(value, "id");
    if login.is_empty() && id.is_empty() {
        return None;
    }
    Some(IssueUser {
        id,
        login,
        name: non_empty(value, "name").or_else(|| non_empty(value, "full_name")),
        avatar_url: non_empty(value, "avatar_url"),
        web_url: non_empty(value, "web_url").or_else(|| non_empty(value, "html_url")),
    })
}

/// Пользователь из поля.
pub fn user_at(value: &Value, key: &str) -> Option<IssueUser> {
    field(value, key).and_then(user_from)
}

/// Список пользователей из поля.
pub fn users_at(value: &Value, key: &str) -> Vec<IssueUser> {
    items(value, key).iter().filter_map(user_from).collect()
}

/// Метка: объект (`id`, `name`, `color`, `description`) или строка-имя (GitLab без `with_labels_details`).
pub fn label_from(value: &Value) -> Option<IssueLabel> {
    if let Some(name) = value.as_str() {
        return Some(IssueLabel { id: name.to_owned(), name: name.to_owned(), color: DEFAULT_LABEL_COLOR.to_owned(), description: None });
    }
    if !value.is_object() {
        return None;
    }
    let name = string(value, "name");
    let id = id_text(value, "id");
    Some(IssueLabel { id: if id.is_empty() { name.clone() } else { id }, name, color: label_color(text(value, "color").as_deref()), description: non_empty(value, "description") })
}

/// Метки из поля.
pub fn labels_at(value: &Value, key: &str) -> Vec<IssueLabel> {
    items(value, key).iter().filter_map(label_from).collect()
}

/// Лента по возрастанию времени; одинаковое время — в порядке ответа.
pub fn sort_timeline(items: &mut [TimelineItem]) {
    items.sort_by(|a, b| a.created_at().cmp(b.created_at()));
}

/// Поле-объект как `Value`; нет — `Null`.
pub fn object<'a>(value: &'a Value, key: &str) -> &'a Value {
    field(value, key).unwrap_or(&Value::Null)
}

/// Ответ-массив: элементы; иное — пусто.
pub fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

/// Набор параметров запроса: пустые значения не добавляются.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Query(pub Vec<(String, String)>);

impl Query {
    pub fn push(&mut self, key: &str, value: impl Into<String>) {
        let value = value.into();
        if !value.is_empty() {
            self.0.push((key.to_owned(), value));
        }
    }
}
