//! Новое в 2.0: модели задач (issues) сервера репозитория — одинаковые для GitLab, GitHub, Gitea/Forgejo и Bitbucket.
//!
//! Даты — строки ISO 8601, как их отдал сервер. Идентификаторы — строки, даже если у сервера они числа: у одних серверов
//! это числа, у других строки, а интерфейсу нужен один тип. Номер задачи в репозитории (`number`) — число: его пишут в
//! `#123`. В TypeScript поля `u64` описаны как `u32` (`#[specta(type = u32)]`) и становятся `number`: `specta` запрещает
//! `bigint`, а `f64` он описывает как `number | null`. Номеров задач больше 4 млрд не бывает.

use serde::{Deserialize, Serialize};

/// Цвет метки, если сервер его не отдал.
pub const DEFAULT_LABEL_COLOR: &str = "#8a92a2";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueUser {
    pub id: String,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueLabel {
    pub id: String,
    pub name: String,
    /// Всегда `#rrggbb`; нет цвета — [`DEFAULT_LABEL_COLOR`].
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueMilestone {
    pub id: String,
    #[specta(type = Option<u32>)]
    pub number: Option<u64>,
    pub title: String,
    pub due_date: Option<String>,
    pub closed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    #[default]
    Open,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    /// Номер в репозитории: `iid` у GitLab, `number` у GitHub, `index` у Gitea (в ответе — `number`), `id` у Bitbucket.
    #[specta(type = u32)]
    pub number: u64,
    pub title: String,
    /// Исходный Markdown; пустая строка вместо `null`.
    pub body: String,
    pub state: IssueState,
    pub state_reason: Option<String>,
    pub author: Option<IssueUser>,
    pub assignees: Vec<IssueUser>,
    pub labels: Vec<IssueLabel>,
    pub milestone: Option<IssueMilestone>,
    pub comments_count: u32,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub due_date: Option<String>,
    pub confidential: bool,
    pub locked: bool,
    pub web_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub id: String,
    pub body: String,
    pub author: Option<IssueUser>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub can_edit: bool,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum IssueEventKind {
    Closed,
    Reopened,
    Labeled,
    Unlabeled,
    Assigned,
    Unassigned,
    Renamed,
    Milestoned,
    Demilestoned,
    Referenced,
    Locked,
    Unlocked,
    #[default]
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueEvent {
    pub id: String,
    pub kind: IssueEventKind,
    pub actor: Option<IssueUser>,
    pub created_at: String,
    pub label: Option<IssueLabel>,
    pub user: Option<IssueUser>,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Готовый текст сервера для `Other` (системная заметка GitLab).
    pub text: Option<String>,
}

/// Элемент ленты задачи: комментарий или событие.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TimelineItem {
    Comment(IssueComment),
    Event(IssueEvent),
}

impl TimelineItem {
    pub fn created_at(&self) -> &str {
        match self {
            TimelineItem::Comment(comment) => &comment.created_at,
            TimelineItem::Event(event) => &event.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub issue: Issue,
    /// По возрастанию времени.
    pub timeline: Vec<TimelineItem>,
    pub timeline_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum IssueSort {
    #[default]
    Updated,
    Created,
    Comments,
}

/// Запрос списка. Особые значения: `assignee` — `"@me"` (текущий пользователь) или `"@none"` (без исполнителя),
/// `author` — `"@me"`, `milestone` — `"@none"` (без вехи).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct IssueQuery {
    /// `None` — все.
    pub state: Option<IssueState>,
    pub search: Option<String>,
    /// Имена меток.
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub author: Option<String>,
    pub milestone: Option<String>,
    pub sort: IssueSort,
    pub ascending: bool,
    /// С 1.
    pub page: u32,
    /// По умолчанию 30, не больше 100.
    pub per_page: u32,
}

impl Default for IssueQuery {
    fn default() -> Self {
        Self { state: Some(IssueState::Open), search: None, labels: Vec::new(), assignee: None, author: None, milestone: None, sort: IssueSort::Updated, ascending: false, page: 1, per_page: 30 }
    }
}

impl IssueQuery {
    /// Страница не меньше 1.
    pub fn page(&self) -> u32 {
        self.page.max(1)
    }

    /// Размер страницы: 1…100, ноль — 30.
    pub fn per_page(&self) -> u32 {
        if self.per_page == 0 { 30 } else { self.per_page.min(100) }
    }

    /// Непустой текст поиска.
    pub fn search_text(&self) -> Option<&str> {
        self.search.as_deref().map(str::trim).filter(|text| !text.is_empty())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueCounts {
    pub open: u32,
    pub closed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueList {
    pub items: Vec<Issue>,
    pub page: u32,
    pub has_more: bool,
    pub counts: Option<IssueCounts>,
}

/// Метка в запросе: адаптер берёт то, что нужно его API (GitLab и GitHub — имя, Gitea — `id`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct LabelRef {
    pub id: String,
    pub name: String,
}

/// Пользователь в запросе: GitLab — `id`, GitHub и Gitea — `login`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct UserRef {
    pub id: String,
    pub login: String,
}

/// Веха в запросе: GitLab и Gitea — `id`, GitHub — номер (`number`, в нём же `id`-строка не нужна).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct MilestoneRef {
    pub id: String,
    #[specta(type = Option<u32>)]
    pub number: Option<u64>,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct IssueInput {
    pub title: String,
    pub body: String,
    pub labels: Vec<LabelRef>,
    pub assignees: Vec<UserRef>,
    pub milestone: Option<MilestoneRef>,
    pub due_date: Option<String>,
    pub confidential: bool,
}

/// Изменение задачи: меняются только заданные поля. Снять веху и срок — `clear_milestone`, `clear_due_date`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct IssuePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub state: Option<IssueState>,
    pub state_reason: Option<String>,
    pub labels: Option<Vec<LabelRef>>,
    pub assignees: Option<Vec<UserRef>>,
    pub milestone: Option<MilestoneRef>,
    pub due_date: Option<String>,
    pub confidential: Option<bool>,
    pub locked: Option<bool>,
    pub clear_milestone: bool,
    pub clear_due_date: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueTemplate {
    pub name: String,
    pub title: Option<String>,
    pub body: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueMeta {
    pub labels: Vec<IssueLabel>,
    /// Только открытые.
    pub milestones: Vec<IssueMilestone>,
    pub members: Vec<IssueUser>,
    pub me: Option<IssueUser>,
    pub templates: Vec<IssueTemplate>,
}

/// Что сервер умеет и что разрешено пользователю: чего нет, того нет в интерфейсе.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueCaps {
    pub create: bool,
    pub edit: bool,
    pub comment: bool,
    pub edit_comments: bool,
    pub delete_comments: bool,
    pub close: bool,
    pub labels: bool,
    pub create_label: bool,
    pub multiple_assignees: bool,
    pub milestones: bool,
    pub due_date: bool,
    pub confidential: bool,
    pub lock: bool,
    pub delete: bool,
    pub events: bool,
    pub text_search: bool,
    pub counts: bool,
    /// Причины закрытия (GitHub: `completed`, `not_planned`).
    pub close_reasons: Vec<String>,
}

/// Ответ `issues_list`: страница, возможности, сервер и адрес списка задач на нём.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssuesListResponse {
    pub list: IssueList,
    pub caps: IssueCaps,
    /// `gitlab`, `github`, `gitea`, `bitbucket`.
    pub provider: String,
    /// «GitLab», «GitHub»…
    pub label: String,
    pub web_url: Option<String>,
}
