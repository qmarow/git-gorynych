//! Новое в 2.0: задачи GitLab (`/projects/:id/issues`). Запросы — через `GlCtx::request`, как в `crate::gitlab`.
//!
//! Сверено с документацией (`doc/api/issues.md`, `notes.md`, `labels.md`, `milestones.md`, `project_members.md`,
//! `issues_statistics.md`): номер задачи — `iid`, тело — `description`, закрытие — `state_event=close|reopen`, блокировка —
//! `discussion_locked`. Цвет меток в задаче — только с `with_labels_details=true`. Системные заметки (`system: true`) — события.

use async_trait::async_trait;
use gorynych_core::error::{GorynychError, Result};
use gorynych_core::i18n::t;
use reqwest::Method;
use serde_json::{Value, json};

use super::*;
use crate::gitlab::GlCtx;
use crate::http::Opts;
use crate::json::{field, flag, non_empty, text};
use crate::providers::Ctx;

pub struct GitlabIssues;

fn gl(ctx: &Ctx) -> Result<&GlCtx> {
    ctx.gitlab.as_ref().ok_or_else(|| GorynychError::unknown(t("issues-not-supported", &[])))
}

/* ---------- Разбор ---------- */

pub fn milestone_from(value: &Value) -> Option<IssueMilestone> {
    if !value.is_object() {
        return None;
    }
    Some(IssueMilestone {
        id: id_text(value, "id"),
        number: field(value, "iid").and_then(Value::as_u64),
        title: string(value, "title"),
        due_date: non_empty(value, "due_date"),
        closed: text(value, "state").as_deref() == Some("closed"),
    })
}

pub fn issue_from(value: &Value) -> Issue {
    let mut assignees = users_at(value, "assignees");
    if assignees.is_empty() {
        assignees.extend(user_at(value, "assignee"));
    }
    Issue {
        id: id_text(value, "id"),
        number: uint(value, "iid"),
        title: string(value, "title"),
        body: string(value, "description"),
        body_html: String::new(),
        state: if text(value, "state").as_deref() == Some("closed") { IssueState::Closed } else { IssueState::Open },
        state_reason: None,
        author: user_at(value, "author"),
        assignees,
        labels: labels_at(value, "labels"),
        milestone: milestone_from(object(value, "milestone")),
        comments_count: u32::try_from(uint(value, "user_notes_count")).unwrap_or(u32::MAX),
        created_at: string(value, "created_at"),
        updated_at: string(value, "updated_at"),
        closed_at: non_empty(value, "closed_at"),
        due_date: non_empty(value, "due_date"),
        confidential: flag(value, "confidential"),
        locked: flag(value, "discussion_locked"),
        web_url: string(value, "web_url"),
    }
}

/// Заметка: обычная — комментарий (править может автор), системная (`system: true`) — событие `Other` с текстом сервера.
pub fn note_from(value: &Value, me: Option<&str>) -> TimelineItem {
    let author = user_at(value, "author");
    if flag(value, "system") {
        return TimelineItem::Event(IssueEvent {
            id: id_text(value, "id"),
            kind: IssueEventKind::Other,
            actor: author,
            created_at: string(value, "created_at"),
            text: Some(string(value, "body")),
            ..IssueEvent::default()
        });
    }
    TimelineItem::Comment(comment_from(value, me))
}

pub fn comment_from(value: &Value, me: Option<&str>) -> IssueComment {
    let author = user_at(value, "author");
    let can_edit = me.is_some_and(|me| author.as_ref().is_some_and(|user| user.login == me));
    IssueComment { id: id_text(value, "id"), body: string(value, "body"), body_html: String::new(), author, created_at: string(value, "created_at"), updated_at: non_empty(value, "updated_at"), can_edit, web_url: None }
}

pub fn counts_from(value: &Value) -> Option<IssueCounts> {
    let counts = object(object(value, "statistics"), "counts");
    if !counts.is_object() {
        return None;
    }
    let get = |key: &str| u32::try_from(uint(counts, key)).unwrap_or(u32::MAX);
    Some(IssueCounts { open: get("opened"), closed: get("closed") })
}

/* ---------- Запросы ---------- */

/// Фильтры списка без состояния и страницы — общие для списка и `issues_statistics`.
fn filters(query: &IssueQuery, me: Option<&str>, out: &mut Query) {
    out.push("labels", query.labels.join(","));
    let mut scope = None;
    match query.assignee.as_deref() {
        Some("@me") => scope = Some("assigned_to_me"),
        Some("@none") => out.push("assignee_id", "None"),
        Some(login) => out.push("assignee_username", login),
        None => {}
    }
    match query.author.as_deref() {
        // Один `scope`: если он уже «мне назначено», автор — по логину
        Some("@me") if scope.is_none() => scope = Some("created_by_me"),
        Some("@me") => out.push("author_username", me.unwrap_or_default()),
        Some(login) => out.push("author_username", login),
        None => {}
    }
    match query.milestone.as_deref() {
        Some("@none") => out.push("milestone", "None"),
        Some(title) => out.push("milestone", title),
        None => {}
    }
    out.push("search", query.search_text().unwrap_or_default());
    if let Some(scope) = scope {
        out.push("scope", scope);
    }
}

/// Параметры `GET /projects/:id/issues`.
pub fn list_query(query: &IssueQuery, me: Option<&str>) -> Vec<(String, String)> {
    let mut out = Query::default();
    out.push(
        "state",
        match query.state {
            Some(IssueState::Open) => "opened",
            Some(IssueState::Closed) => "closed",
            None => "all",
        },
    );
    filters(query, me, &mut out);
    // Сортировки по числу комментариев у GitLab нет — по обновлению
    out.push("order_by", if query.sort == IssueSort::Created { "created_at" } else { "updated_at" });
    out.push("sort", if query.ascending { "asc" } else { "desc" });
    out.push("with_labels_details", "true");
    out.push("page", query.page().to_string());
    out.push("per_page", query.per_page().to_string());
    out.0
}

/// Параметры `GET /projects/:id/issues_statistics`: те же фильтры, без состояния, сортировки и страницы.
pub fn counts_query(query: &IssueQuery, me: Option<&str>) -> Vec<(String, String)> {
    let mut out = Query::default();
    filters(query, me, &mut out);
    out.0
}

fn opts(query: Vec<(String, String)>) -> Opts {
    Opts { query, ..Opts::default() }
}

fn me_of(glc: &GlCtx) -> Option<&str> {
    glc.meta.user.as_ref().and_then(|user| user.username.as_deref())
}

/// Страницы по 100, пока страница полная, не больше `MAX_PAGES`; `true` — данных, возможно, больше.
async fn pages(glc: &GlCtx, path: &str, extra: &[(&str, &str)]) -> Result<(Vec<Value>, bool)> {
    let mut out = Vec::new();
    for page in 1..=MAX_PAGES {
        let mut query: Vec<(String, String)> = extra.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        query.push(("per_page".into(), PAGE_SIZE.to_string()));
        query.push(("page".into(), page.to_string()));
        let data = glc.request(Method::GET, path, opts(query)).await?;
        let list = array(&data).to_vec();
        let full = list.len() >= PAGE_SIZE as usize;
        out.extend(list);
        if !full {
            return Ok((out, false));
        }
    }
    Ok((out, true))
}

fn label_names(labels: &[LabelRef]) -> String {
    labels.iter().map(|label| label.name.as_str()).collect::<Vec<_>>().join(",")
}

fn user_ids(users: &[UserRef]) -> Vec<Value> {
    users.iter().map(|user| user.id.parse::<u64>().map_or_else(|_| json!(user.id), |id| json!(id))).collect()
}

fn milestone_id(milestone: &MilestoneRef) -> Value {
    milestone.id.parse::<u64>().map_or_else(|_| json!(milestone.id), |id| json!(id))
}

/// Тело `PUT /projects/:id/issues/:iid`.
pub fn patch_body(patch: &IssuePatch) -> Value {
    let mut body = serde_json::Map::new();
    if let Some(title) = &patch.title {
        body.insert("title".into(), json!(title));
    }
    if let Some(text) = &patch.body {
        body.insert("description".into(), json!(text));
    }
    if let Some(state) = patch.state {
        body.insert("state_event".into(), json!(if state == IssueState::Closed { "close" } else { "reopen" }));
    }
    if let Some(labels) = &patch.labels {
        body.insert("labels".into(), json!(label_names(labels)));
    }
    if let Some(users) = &patch.assignees {
        // Пустой список снимает всех исполнителей
        body.insert("assignee_ids".into(), if users.is_empty() { json!([0]) } else { Value::Array(user_ids(users)) });
    }
    if patch.clear_milestone {
        body.insert("milestone_id".into(), json!(0));
    } else if let Some(milestone) = &patch.milestone {
        body.insert("milestone_id".into(), milestone_id(milestone));
    }
    if patch.clear_due_date {
        body.insert("due_date".into(), json!(""));
    } else if let Some(date) = &patch.due_date {
        body.insert("due_date".into(), json!(date));
    }
    if let Some(confidential) = patch.confidential {
        body.insert("confidential".into(), json!(confidential));
    }
    if let Some(locked) = patch.locked {
        body.insert("discussion_locked".into(), json!(locked));
    }
    Value::Object(body)
}

/// Тело `POST /projects/:id/issues`; `assignee_ids` — только Premium и Ultimate, при отказе запрос повторяется с первым.
pub fn create_body(input: &IssueInput, all_assignees: bool) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("title".into(), json!(input.title));
    body.insert("description".into(), json!(input.body));
    if !input.labels.is_empty() {
        body.insert("labels".into(), json!(label_names(&input.labels)));
    }
    if !input.assignees.is_empty() {
        let ids = user_ids(&input.assignees);
        if all_assignees {
            body.insert("assignee_ids".into(), Value::Array(ids));
        } else if let Some(first) = ids.into_iter().next() {
            body.insert("assignee_id".into(), first);
        }
    }
    if let Some(milestone) = &input.milestone {
        body.insert("milestone_id".into(), milestone_id(milestone));
    }
    if let Some(date) = input.due_date.as_deref().filter(|date| !date.is_empty()) {
        body.insert("due_date".into(), json!(date));
    }
    if input.confidential {
        body.insert("confidential".into(), json!(true));
    }
    Value::Object(body)
}

#[async_trait]
impl IssueProvider for GitlabIssues {
    fn caps(&self, ctx: &Ctx) -> IssueCaps {
        let write = ctx.gitlab.as_ref().is_some_and(GlCtx::can_write);
        // Отчитываться и менять задачи может Reporter (20) и выше; удалять — владелец (50)
        let level = ctx.gitlab.as_ref().map_or(0, |glc| glc.project.access_level);
        let manage = write && level >= 20;
        IssueCaps {
            create: write,
            edit: manage,
            comment: write,
            edit_comments: write,
            delete_comments: manage,
            close: manage,
            labels: manage,
            create_label: manage,
            multiple_assignees: manage,
            milestones: manage,
            due_date: manage,
            confidential: manage,
            lock: manage,
            delete: write && level >= 50,
            events: true,
            text_search: true,
            counts: true,
            close_reasons: Vec::new(),
        }
    }

    fn web_url(&self, ctx: &Ctx) -> Option<String> {
        ctx.web_url.as_ref().map(|url| format!("{}/-/issues", url.trim_end_matches('/')))
    }

    async fn list(&self, ctx: &Ctx, query: &IssueQuery) -> Result<IssueList> {
        let glc = gl(ctx)?;
        let me = me_of(glc);
        let path = format!("{}/issues", glc.project_path());
        let stats_path = format!("{}/issues_statistics", glc.project_path());
        let (data, stats) = tokio::join!(glc.request(Method::GET, &path, opts(list_query(query, me))), glc.request(Method::GET, &stats_path, opts(counts_query(query, me))));
        let data = data.map_err(|error| list_error(error, "GitLab"))?;
        let items: Vec<Issue> = array(&data).iter().map(issue_from).collect();
        Ok(IssueList { has_more: items.len() == query.per_page() as usize, page: query.page(), counts: stats.ok().as_ref().and_then(counts_from), items })
    }

    async fn get(&self, ctx: &Ctx, number: u64) -> Result<IssueDetail> {
        let glc = gl(ctx)?;
        let me = me_of(glc);
        let path = format!("{}/issues/{number}", glc.project_path());
        let notes_path = format!("{path}/notes");
        let (issue, notes) = tokio::join!(
            glc.request(Method::GET, &path, Opts::not_found(not_found_text(number))),
            pages(glc, &notes_path, &[("sort", "asc"), ("order_by", "created_at")])
        );
        let (notes, truncated) = notes?;
        let mut timeline: Vec<TimelineItem> = notes.iter().map(|note| note_from(note, me)).collect();
        sort_timeline(&mut timeline);
        Ok(IssueDetail { issue: issue_from(&issue?), timeline, timeline_truncated: truncated })
    }

    async fn meta(&self, ctx: &Ctx) -> Result<IssueMeta> {
        let glc = gl(ctx)?;
        let base = glc.project_path();
        let (labels_path, milestones_path, members_path) = (format!("{base}/labels"), format!("{base}/milestones"), format!("{base}/members/all"));
        let (labels, milestones, members) = tokio::join!(
            pages(glc, &labels_path, &[]),
            pages(glc, &milestones_path, &[("state", "active")]),
            pages(glc, &members_path, &[])
        );
        let list = |result: Result<(Vec<Value>, bool)>| result.map(|(items, _)| items).unwrap_or_default();
        let me = glc.meta.user.as_ref().map(|user| IssueUser { id: String::new(), login: user.username.clone().unwrap_or_default(), name: user.name.clone(), avatar_url: user.avatar_url.clone(), web_url: None });
        Ok(IssueMeta {
            labels: list(labels).iter().filter_map(label_from).collect(),
            milestones: list(milestones).iter().filter_map(milestone_from).collect(),
            members: list(members).iter().filter_map(user_from).collect(),
            me,
            templates: templates::read(&ctx.root, templates::Layout::Gitlab),
        })
    }

    async fn create(&self, ctx: &Ctx, input: &IssueInput) -> Result<Issue> {
        let glc = gl(ctx)?;
        let path = format!("{}/issues", glc.project_path());
        match glc.request(Method::POST, &path, Opts::body(create_body(input, true))).await {
            Ok(data) => Ok(issue_from(&data)),
            // Несколько исполнителей — платная функция: в Free запрос повторяется с первым
            Err(_) if input.assignees.len() > 1 => Ok(issue_from(&glc.request(Method::POST, &path, Opts::body(create_body(input, false))).await?)),
            Err(error) => Err(error),
        }
    }

    async fn update(&self, ctx: &Ctx, number: u64, patch: &IssuePatch) -> Result<Issue> {
        let glc = gl(ctx)?;
        let path = format!("{}/issues/{number}", glc.project_path());
        let body = patch_body(patch);
        match glc.request(Method::PUT, &path, Opts::body(body.clone()).with_not_found(not_found_text(number))).await {
            Ok(data) => Ok(issue_from(&data)),
            Err(_) if patch.assignees.as_ref().is_some_and(|users| users.len() > 1) => {
                let mut single = body;
                if let Some(first) = patch.assignees.as_ref().and_then(|users| users.first()) {
                    single["assignee_ids"] = Value::Array(user_ids(std::slice::from_ref(first)));
                }
                Ok(issue_from(&glc.request(Method::PUT, &path, Opts::body(single)).await?))
            }
            Err(error) => Err(error),
        }
    }

    async fn comment_add(&self, ctx: &Ctx, number: u64, body: &str) -> Result<IssueComment> {
        let glc = gl(ctx)?;
        let data = glc.request(Method::POST, format!("{}/issues/{number}/notes", glc.project_path()), Opts::body(json!({ "body": body }))).await?;
        Ok(comment_from(&data, me_of(glc)))
    }

    async fn comment_update(&self, ctx: &Ctx, number: u64, id: &str, body: &str) -> Result<IssueComment> {
        let glc = gl(ctx)?;
        let data = glc.request(Method::PUT, format!("{}/issues/{number}/notes/{id}", glc.project_path()), Opts::body(json!({ "body": body }))).await?;
        Ok(comment_from(&data, me_of(glc)))
    }

    async fn comment_delete(&self, ctx: &Ctx, number: u64, id: &str) -> Result<()> {
        let glc = gl(ctx)?;
        glc.request(Method::DELETE, format!("{}/issues/{number}/notes/{id}", glc.project_path()), Opts::default()).await?;
        Ok(())
    }

    async fn label_create(&self, ctx: &Ctx, name: &str, color: &str) -> Result<IssueLabel> {
        let glc = gl(ctx)?;
        let data = glc.request(Method::POST, format!("{}/labels", glc.project_path()), Opts::body(json!({ "name": name, "color": label_color(Some(color)) }))).await?;
        label_from(&data).ok_or_else(|| GorynychError::unknown(t("issues-not-supported", &[])))
    }

    async fn delete(&self, ctx: &Ctx, number: u64) -> Result<()> {
        let glc = gl(ctx)?;
        glc.request(Method::DELETE, format!("{}/issues/{number}", glc.project_path()), Opts::not_found(not_found_text(number))).await?;
        Ok(())
    }
}

