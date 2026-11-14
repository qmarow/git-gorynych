//! Новое в 2.0: задачи Gitea и Forgejo (`/repos/:o/:r/issues`, номер — `index`, в ответе — `number`).
//!
//! Сверено со swagger (`gitea.com/swagger.v1.json`, 29.0.0+dev): список — `state`, `type=issues`, `labels` (любая из),
//! `q`, `milestones`, `assigned_by`, `created_by`, `page`, `limit`; сортировки и фильтра «без исполнителя» нет. Метки задачи
//! меняются отдельно (`PUT /issues/:index/labels`, `id` меток). Лента — `GET /issues/:index/timeline` (`type`: `comment`,
//! `close`, `reopen`, `label` с телом `"1"` — добавлена, `assignees` с `removed_assignee`, `change_title`, `milestone`,
//! `*_ref`, `lock`, `unlock`). Сервер ограничивает страницу (`MAX_RESPONSE_ITEMS`, по умолчанию 50) — больше 50 не просим.
//! Счётчиков нет (`open_issues_count` репозитория есть, закрытых нет — `counts: None`).

use async_trait::async_trait;
use gorynych_core::error::Result;
use reqwest::Method;
use serde_json::{Value, json};

use super::*;
use crate::http::{Opts, request};
use crate::json::{field, flag, non_empty, text};
use crate::providers::Ctx;

pub struct GiteaIssues;

/// Сколько элементов Gitea отдаёт на страницу по умолчанию (`MAX_RESPONSE_ITEMS`).
pub const GITEA_PAGE: u32 = 50;
/// Лента и справочники: 6 страниц по 50 = 300.
const GITEA_PAGES: u32 = 6;

/* ---------- Разбор ---------- */

pub fn milestone_from(value: &Value) -> Option<IssueMilestone> {
    if !value.is_object() {
        return None;
    }
    Some(IssueMilestone { id: id_text(value, "id"), number: None, title: string(value, "title"), due_date: non_empty(value, "due_on"), closed: text(value, "state").as_deref() == Some("closed") })
}

pub fn issue_from(value: &Value) -> Issue {
    let mut assignees = users_at(value, "assignees");
    if assignees.is_empty() {
        assignees.extend(user_at(value, "assignee"));
    }
    Issue {
        id: id_text(value, "id"),
        number: uint(value, "number"),
        title: string(value, "title"),
        body: string(value, "body"),
        body_html: String::new(),
        state: if text(value, "state").as_deref() == Some("closed") { IssueState::Closed } else { IssueState::Open },
        state_reason: None,
        author: user_at(value, "user"),
        assignees,
        labels: labels_at(value, "labels"),
        milestone: milestone_from(object(value, "milestone")),
        comments_count: u32::try_from(uint(value, "comments")).unwrap_or(u32::MAX),
        created_at: string(value, "created_at"),
        updated_at: string(value, "updated_at"),
        closed_at: non_empty(value, "closed_at"),
        due_date: non_empty(value, "due_date"),
        confidential: false,
        locked: flag(value, "is_locked"),
        web_url: string(value, "html_url"),
    }
}

/// Комментарий; править может автор и тот, у кого есть запись в репозиторий.
pub fn comment_from(value: &Value, me: Option<&str>, write: bool) -> IssueComment {
    let author = user_at(value, "user");
    let own = me.is_some_and(|me| author.as_ref().is_some_and(|user| user.login == me));
    IssueComment {
        id: id_text(value, "id"),
        body: string(value, "body"),
        body_html: String::new(),
        author,
        created_at: string(value, "created_at"),
        updated_at: non_empty(value, "updated_at"),
        can_edit: own || write,
        web_url: non_empty(value, "html_url"),
    }
}

/// Элемент ленты `GET /issues/:index/timeline`.
pub fn timeline_from(value: &Value, me: Option<&str>, write: bool) -> TimelineItem {
    let kind_text = string(value, "type");
    if kind_text == "comment" {
        return TimelineItem::Comment(comment_from(value, me, write));
    }
    let added = text(value, "body").as_deref() == Some("1");
    let removed_assignee = flag(value, "removed_assignee");
    let kind = match kind_text.as_str() {
        "close" => IssueEventKind::Closed,
        "reopen" => IssueEventKind::Reopened,
        "label" if added => IssueEventKind::Labeled,
        "label" => IssueEventKind::Unlabeled,
        "assignees" if removed_assignee => IssueEventKind::Unassigned,
        "assignees" => IssueEventKind::Assigned,
        "change_title" => IssueEventKind::Renamed,
        "milestone" if field(value, "milestone").is_some() => IssueEventKind::Milestoned,
        "milestone" => IssueEventKind::Demilestoned,
        "issue_ref" | "commit_ref" | "comment_ref" | "pull_ref" => IssueEventKind::Referenced,
        "lock" => IssueEventKind::Locked,
        "unlock" => IssueEventKind::Unlocked,
        _ => IssueEventKind::Other,
    };
    let (from, to) = match kind {
        IssueEventKind::Renamed => (text(value, "old_title"), text(value, "new_title")),
        IssueEventKind::Milestoned => (text(object(value, "old_milestone"), "title"), text(object(value, "milestone"), "title")),
        IssueEventKind::Demilestoned => (text(object(value, "old_milestone"), "title"), None),
        _ => (None, None),
    };
    TimelineItem::Event(IssueEvent {
        id: id_text(value, "id"),
        kind,
        actor: user_at(value, "user"),
        created_at: string(value, "created_at"),
        label: field(value, "label").and_then(label_from),
        user: user_at(value, "assignee"),
        from,
        to,
        text: (kind == IssueEventKind::Other).then_some(kind_text),
    })
}

/* ---------- Запросы ---------- */

fn me_or_value(value: &str, me: Option<&str>) -> String {
    if value == "@me" { me.unwrap_or_default().to_owned() } else { value.to_owned() }
}

/// Размер страницы списка у Gitea: не больше [`GITEA_PAGE`].
pub fn page_size(query: &IssueQuery) -> u32 {
    query.per_page().min(GITEA_PAGE)
}

/// Параметры `GET /repos/:o/:r/issues`. Сортировки и фильтра «без исполнителя» у Gitea нет.
pub fn list_query(query: &IssueQuery, me: Option<&str>) -> Vec<(String, String)> {
    let mut out = Query::default();
    out.push(
        "state",
        match query.state {
            Some(IssueState::Open) => "open",
            Some(IssueState::Closed) => "closed",
            None => "all",
        },
    );
    out.push("type", "issues");
    out.push("labels", query.labels.join(","));
    out.push("q", query.search_text().unwrap_or_default());
    match query.milestone.as_deref() {
        // «Без вехи» в API нет
        Some("@none") | None => {}
        Some(title) => out.push("milestones", title),
    }
    match query.assignee.as_deref() {
        Some("@none") | None => {}
        Some(login) => out.push("assigned_by", me_or_value(login, me)),
    }
    if let Some(author) = query.author.as_deref() {
        out.push("created_by", me_or_value(author, me));
    }
    out.push("page", query.page().to_string());
    out.push("limit", page_size(query).to_string());
    out.0
}

fn opts(query: Vec<(String, String)>) -> Opts {
    Opts { query, ..Opts::default() }
}

fn needs_me(query: &IssueQuery) -> bool {
    query.assignee.as_deref() == Some("@me") || query.author.as_deref() == Some("@me")
}

async fn me(ctx: &Ctx) -> Option<IssueUser> {
    request(&ctx.http, Method::GET, "/user", Opts::default()).await.ok().as_ref().and_then(user_from)
}

/// Страницы по [`GITEA_PAGE`], пока страница полная, не больше `GITEA_PAGES`; `true` — данных, возможно, больше.
async fn pages(ctx: &Ctx, path: &str, extra: &[(&str, &str)]) -> Result<(Vec<Value>, bool)> {
    let mut out = Vec::new();
    for page in 1..=GITEA_PAGES {
        let mut query: Vec<(String, String)> = extra.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        query.push(("limit".into(), GITEA_PAGE.to_string()));
        query.push(("page".into(), page.to_string()));
        let data = request(&ctx.http, Method::GET, path, opts(query)).await?;
        let list = array(&data).to_vec();
        let full = list.len() >= GITEA_PAGE as usize;
        out.extend(list);
        if !full {
            return Ok((out, false));
        }
    }
    Ok((out, true))
}

fn id_number(id: &str) -> Value {
    id.parse::<u64>().map_or_else(|_| json!(id), |n| json!(n))
}

/// Дата срока для Gitea: день `YYYY-MM-DD` дополняется до полуночи UTC, полная дата — как есть.
pub fn due_date_value(date: &str) -> String {
    if date.len() == 10 { format!("{date}T00:00:00Z") } else { date.to_owned() }
}

/// Тело `PATCH /repos/:o/:r/issues/:index` (метки — отдельным запросом).
pub fn patch_body(patch: &IssuePatch) -> Value {
    let mut body = serde_json::Map::new();
    if let Some(title) = &patch.title {
        body.insert("title".into(), json!(title));
    }
    if let Some(text) = &patch.body {
        body.insert("body".into(), json!(text));
    }
    if let Some(state) = patch.state {
        body.insert("state".into(), json!(if state == IssueState::Closed { "closed" } else { "open" }));
    }
    if let Some(users) = &patch.assignees {
        body.insert("assignees".into(), json!(users.iter().map(|user| user.login.clone()).collect::<Vec<_>>()));
    }
    if patch.clear_milestone {
        body.insert("milestone".into(), json!(0));
    } else if let Some(milestone) = &patch.milestone {
        body.insert("milestone".into(), id_number(&milestone.id));
    }
    if patch.clear_due_date {
        body.insert("unset_due_date".into(), json!(true));
    } else if let Some(date) = &patch.due_date {
        body.insert("due_date".into(), json!(due_date_value(date)));
    }
    Value::Object(body)
}

/// Тело `POST /repos/:o/:r/issues`.
pub fn create_body(input: &IssueInput) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("title".into(), json!(input.title));
    body.insert("body".into(), json!(input.body));
    if !input.labels.is_empty() {
        body.insert("labels".into(), Value::Array(input.labels.iter().map(|label| id_number(&label.id)).collect()));
    }
    if !input.assignees.is_empty() {
        body.insert("assignees".into(), json!(input.assignees.iter().map(|user| user.login.clone()).collect::<Vec<_>>()));
    }
    if let Some(milestone) = &input.milestone {
        body.insert("milestone".into(), id_number(&milestone.id));
    }
    if let Some(date) = input.due_date.as_deref().filter(|date| !date.is_empty()) {
        body.insert("due_date".into(), json!(due_date_value(date)));
    }
    Value::Object(body)
}

#[async_trait]
impl IssueProvider for GiteaIssues {
    fn caps(&self, ctx: &Ctx) -> IssueCaps {
        let write = ctx.write_allowed();
        IssueCaps {
            create: true,
            edit: write,
            comment: true,
            edit_comments: true,
            delete_comments: true,
            close: write,
            labels: write,
            create_label: write,
            multiple_assignees: true,
            milestones: write,
            due_date: write,
            confidential: false,
            lock: false,
            // Удалять задачу может администратор репозитория
            delete: write && ctx.is_admin != Some(false),
            events: true,
            text_search: true,
            counts: false,
            close_reasons: Vec::new(),
        }
    }

    fn web_url(&self, ctx: &Ctx) -> Option<String> {
        ctx.web_url.as_ref().map(|url| format!("{}/issues", url.trim_end_matches('/')))
    }

    async fn list(&self, ctx: &Ctx, query: &IssueQuery) -> Result<IssueList> {
        let me = if needs_me(query) { me(ctx).await.map(|user| user.login) } else { None };
        let data = request(&ctx.http, Method::GET, format!("{}/issues", ctx.repo_api()), opts(list_query(query, me.as_deref()))).await.map_err(|error| list_error(error, "Gitea"))?;
        let raw = array(&data);
        let items = raw.iter().filter(|item| field(item, "pull_request").is_none()).map(issue_from).collect();
        Ok(IssueList { items, page: query.page(), has_more: raw.len() == page_size(query) as usize, counts: None })
    }

    async fn get(&self, ctx: &Ctx, number: u64) -> Result<IssueDetail> {
        let api = ctx.repo_api();
        let timeline_path = format!("{api}/issues/{number}/timeline");
        let (issue, timeline, me) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/issues/{number}"), Opts::not_found(not_found_text(number))),
            pages(ctx, &timeline_path, &[]),
            me(ctx)
        );
        let me = me.map(|user| user.login);
        let write = ctx.write_allowed();
        let (events, truncated) = timeline?;
        let mut timeline: Vec<TimelineItem> = events.iter().map(|event| timeline_from(event, me.as_deref(), write)).collect();
        sort_timeline(&mut timeline);
        Ok(IssueDetail { issue: issue_from(&issue?), timeline, timeline_truncated: truncated })
    }

    async fn meta(&self, ctx: &Ctx) -> Result<IssueMeta> {
        let api = ctx.repo_api();
        let (labels_path, milestones_path, members_path) = (format!("{api}/labels"), format!("{api}/milestones"), format!("{api}/assignees"));
        let (labels, milestones, members, me) = tokio::join!(
            pages(ctx, &labels_path, &[]),
            pages(ctx, &milestones_path, &[("state", "open")]),
            request(&ctx.http, Method::GET, &members_path, Opts::default()),
            me(ctx)
        );
        let list = |result: Result<(Vec<Value>, bool)>| result.map(|(items, _)| items).unwrap_or_default();
        let members = members.unwrap_or(Value::Null);
        Ok(IssueMeta {
            labels: list(labels).iter().filter_map(label_from).collect(),
            milestones: list(milestones).iter().filter_map(milestone_from).collect(),
            members: array(&members).iter().filter_map(user_from).take(300).collect(),
            me,
            templates: templates::read(&ctx.root, templates::Layout::Github),
        })
    }

    async fn create(&self, ctx: &Ctx, input: &IssueInput) -> Result<Issue> {
        let data = request(&ctx.http, Method::POST, format!("{}/issues", ctx.repo_api()), Opts::body(create_body(input))).await?;
        Ok(issue_from(&data))
    }

    async fn update(&self, ctx: &Ctx, number: u64, patch: &IssuePatch) -> Result<Issue> {
        let path = format!("{}/issues/{number}", ctx.repo_api());
        let not_found = || not_found_text(number);
        if let Some(labels) = &patch.labels {
            let ids: Vec<Value> = labels.iter().map(|label| id_number(&label.id)).collect();
            request(&ctx.http, Method::PUT, format!("{path}/labels"), Opts::body(json!({ "labels": ids })).with_not_found(not_found())).await?;
        }
        let body = patch_body(patch);
        let data = if body.as_object().is_some_and(serde_json::Map::is_empty) {
            request(&ctx.http, Method::GET, &path, Opts::not_found(not_found())).await?
        } else {
            request(&ctx.http, Method::PATCH, &path, Opts::body(body).with_not_found(not_found())).await?
        };
        Ok(issue_from(&data))
    }

    async fn comment_add(&self, ctx: &Ctx, number: u64, body: &str) -> Result<IssueComment> {
        let data = request(&ctx.http, Method::POST, format!("{}/issues/{number}/comments", ctx.repo_api()), Opts::body(json!({ "body": body }))).await?;
        Ok(comment_from(&data, None, true))
    }

    async fn comment_update(&self, ctx: &Ctx, _number: u64, id: &str, body: &str) -> Result<IssueComment> {
        let data = request(&ctx.http, Method::PATCH, format!("{}/issues/comments/{id}", ctx.repo_api()), Opts::body(json!({ "body": body }))).await?;
        Ok(comment_from(&data, None, true))
    }

    async fn comment_delete(&self, ctx: &Ctx, _number: u64, id: &str) -> Result<()> {
        request(&ctx.http, Method::DELETE, format!("{}/issues/comments/{id}", ctx.repo_api()), Opts::default()).await?;
        Ok(())
    }

    async fn label_create(&self, ctx: &Ctx, name: &str, color: &str) -> Result<IssueLabel> {
        let data = request(&ctx.http, Method::POST, format!("{}/labels", ctx.repo_api()), Opts::body(json!({ "name": name, "color": label_color(Some(color)) }))).await?;
        label_from(&data).ok_or_else(not_supported)
    }

    async fn delete(&self, ctx: &Ctx, number: u64) -> Result<()> {
        request(&ctx.http, Method::DELETE, format!("{}/issues/{number}", ctx.repo_api()), Opts::not_found(not_found_text(number))).await?;
        Ok(())
    }
}
