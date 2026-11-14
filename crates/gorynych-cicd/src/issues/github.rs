//! Новое в 2.0: задачи GitHub (`/repos/:o/:r/issues`).
//!
//! Сверено с описанием REST API (`github/rest-api-description`, `api.github.com.json`): список — `state`, `labels`, `assignee`
//! (`none` — без исполнителя), `creator`, `milestone` (номер или `none`), `sort` (`created|updated|comments`), `direction`;
//! в ответе бывают pull request'ы (ключ `pull_request`) — они отбрасываются. Текстовый поиск и счётчики — `GET /search/issues`
//! (`q=repo:o/r is:issue …`, `total_count`). Лента — `GET /issues/:n/timeline`, блокировка — `PUT`/`DELETE /issues/:n/lock`.
//! Удаления задачи, срока и конфиденциальности в API нет.

use async_trait::async_trait;
use gorynych_core::error::{GorynychError, Result};
use reqwest::Method;
use serde_json::{Value, json};

use super::*;
use crate::http::{Opts, request};
use crate::json::{field, flag, items, non_empty, text};
use crate::providers::Ctx;

pub struct GithubIssues;

/* ---------- Разбор ---------- */

pub fn milestone_from(value: &Value) -> Option<IssueMilestone> {
    if !value.is_object() {
        return None;
    }
    Some(IssueMilestone {
        id: id_text(value, "id"),
        number: field(value, "number").and_then(Value::as_u64),
        title: string(value, "title"),
        due_date: non_empty(value, "due_on"),
        closed: text(value, "state").as_deref() == Some("closed"),
    })
}

/// Pull request в ответе списка задач.
pub fn is_pull_request(value: &Value) -> bool {
    field(value, "pull_request").is_some()
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
        state_reason: non_empty(value, "state_reason"),
        author: user_at(value, "user"),
        assignees,
        labels: labels_at(value, "labels"),
        milestone: milestone_from(object(value, "milestone")),
        comments_count: u32::try_from(uint(value, "comments")).unwrap_or(u32::MAX),
        created_at: string(value, "created_at"),
        updated_at: string(value, "updated_at"),
        closed_at: non_empty(value, "closed_at"),
        due_date: None,
        confidential: false,
        locked: flag(value, "locked"),
        web_url: string(value, "html_url"),
    }
}

/// Комментарий; править может автор и тот, у кого есть запись в репозиторий.
pub fn comment_from(value: &Value, me: Option<&str>, write: bool) -> IssueComment {
    let author = user_at(value, "user").or_else(|| user_at(value, "actor"));
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

/// Элемент ленты `GET /issues/:n/timeline`.
pub fn timeline_from(value: &Value, me: Option<&str>, write: bool) -> TimelineItem {
    let event = string(value, "event");
    if event == "commented" {
        return TimelineItem::Comment(comment_from(value, me, write));
    }
    let kind = match event.as_str() {
        "closed" => IssueEventKind::Closed,
        "reopened" => IssueEventKind::Reopened,
        "labeled" => IssueEventKind::Labeled,
        "unlabeled" => IssueEventKind::Unlabeled,
        "assigned" => IssueEventKind::Assigned,
        "unassigned" => IssueEventKind::Unassigned,
        "renamed" => IssueEventKind::Renamed,
        "milestoned" => IssueEventKind::Milestoned,
        "demilestoned" => IssueEventKind::Demilestoned,
        "referenced" | "cross-referenced" | "connected" => IssueEventKind::Referenced,
        "locked" => IssueEventKind::Locked,
        "unlocked" => IssueEventKind::Unlocked,
        _ => IssueEventKind::Other,
    };
    let rename = object(value, "rename");
    let milestone = text(object(value, "milestone"), "title");
    let (from, to) = match kind {
        IssueEventKind::Renamed => (text(rename, "from"), text(rename, "to")),
        IssueEventKind::Milestoned => (None, milestone),
        IssueEventKind::Demilestoned => (milestone, None),
        IssueEventKind::Locked => (None, non_empty(value, "lock_reason")),
        _ => (None, None),
    };
    TimelineItem::Event(IssueEvent {
        id: [id_text(value, "id"), id_text(value, "node_id")].into_iter().find(|id| !id.is_empty()).unwrap_or_default(),
        kind,
        actor: user_at(value, "actor"),
        created_at: string(value, "created_at"),
        label: field(value, "label").and_then(label_from),
        user: user_at(value, "assignee"),
        from,
        to,
        text: (kind == IssueEventKind::Other).then_some(event),
    })
}

/* ---------- Запросы ---------- */

fn me_or_value(value: &str, me: Option<&str>) -> String {
    if value == "@me" { me.unwrap_or_default().to_owned() } else { value.to_owned() }
}

/// Параметры `GET /repos/:o/:r/issues` (без текста поиска: его в этом списке нет). `milestone` — уже номер.
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
    out.push("labels", query.labels.join(","));
    match query.assignee.as_deref() {
        Some("@none") => out.push("assignee", "none"),
        Some(login) => out.push("assignee", me_or_value(login, me)),
        None => {}
    }
    if let Some(author) = query.author.as_deref() {
        out.push("creator", me_or_value(author, me));
    }
    match query.milestone.as_deref() {
        Some("@none") => out.push("milestone", "none"),
        Some(number) => out.push("milestone", number),
        None => {}
    }
    out.push(
        "sort",
        match query.sort {
            IssueSort::Updated => "updated",
            IssueSort::Created => "created",
            IssueSort::Comments => "comments",
        },
    );
    out.push("direction", if query.ascending { "asc" } else { "desc" });
    out.push("per_page", query.per_page().to_string());
    out.push("page", query.page().to_string());
    out.0
}

fn quoted(value: &str) -> String {
    if value.contains(char::is_whitespace) { format!("\"{}\"", value.replace('"', "")) } else { value.to_owned() }
}

/// Строка `q` для `GET /search/issues`: репозиторий, только задачи, фильтры и текст. `state` — отдельно, для счётчиков.
pub fn search_q(query: &IssueQuery, owner: &str, repo: &str, me: Option<&str>, state: Option<IssueState>) -> String {
    let mut parts = vec![format!("repo:{owner}/{repo}"), "is:issue".to_owned()];
    match state {
        Some(IssueState::Open) => parts.push("is:open".into()),
        Some(IssueState::Closed) => parts.push("is:closed".into()),
        None => {}
    }
    parts.extend(query.labels.iter().map(|label| format!("label:{}", quoted(label))));
    match query.assignee.as_deref() {
        Some("@none") => parts.push("no:assignee".into()),
        Some(login) => parts.push(format!("assignee:{}", me_or_value(login, me))),
        None => {}
    }
    if let Some(author) = query.author.as_deref() {
        parts.push(format!("author:{}", me_or_value(author, me)));
    }
    match query.milestone.as_deref() {
        Some("@none") => parts.push("no:milestone".into()),
        Some(title) => parts.push(format!("milestone:{}", quoted(title))),
        None => {}
    }
    if let Some(text) = query.search_text() {
        parts.push(text.to_owned());
    }
    parts.join(" ")
}

/// Параметры `GET /search/issues` для страницы списка.
pub fn search_query(query: &IssueQuery, owner: &str, repo: &str, me: Option<&str>) -> Vec<(String, String)> {
    let mut out = Query::default();
    out.push("q", search_q(query, owner, repo, me, query.state));
    out.push(
        "sort",
        match query.sort {
            IssueSort::Updated => "updated",
            IssueSort::Created => "created",
            IssueSort::Comments => "comments",
        },
    );
    out.push("order", if query.ascending { "asc" } else { "desc" });
    out.push("per_page", query.per_page().to_string());
    out.push("page", query.page().to_string());
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

/// Страницы по 100, пока страница полная, не больше `MAX_PAGES`; `true` — данных, возможно, больше.
async fn pages(ctx: &Ctx, path: &str, extra: &[(&str, &str)]) -> Result<(Vec<Value>, bool)> {
    let mut out = Vec::new();
    for page in 1..=MAX_PAGES {
        let mut query: Vec<(String, String)> = extra.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        query.push(("per_page".into(), PAGE_SIZE.to_string()));
        query.push(("page".into(), page.to_string()));
        let data = request(&ctx.http, Method::GET, path, opts(query)).await?;
        let list = array(&data).to_vec();
        let full = list.len() >= PAGE_SIZE as usize;
        out.extend(list);
        if !full {
            return Ok((out, false));
        }
    }
    Ok((out, true))
}

/// Номер вехи для фильтра списка: число — как есть, название — по списку вех (нет такой — фильтр не применяется).
async fn milestone_number(ctx: &Ctx, value: &str) -> Option<String> {
    if value == "@none" || value.parse::<u64>().is_ok() {
        return Some(value.to_owned());
    }
    let (all, _) = pages(ctx, &format!("{}/milestones", ctx.repo_api()), &[("state", "all")]).await.ok()?;
    all.iter().filter_map(milestone_from).find(|milestone| milestone.title == value).and_then(|milestone| milestone.number).map(|number| number.to_string())
}

fn total_count(value: &Value) -> u32 {
    u32::try_from(uint(value, "total_count")).unwrap_or(u32::MAX)
}

fn milestone_number_of(milestone: &MilestoneRef) -> Value {
    milestone.number.map_or_else(|| milestone.id.parse::<u64>().map_or(Value::Null, |n| json!(n)), |n| json!(n))
}

/// Тело `PATCH /repos/:o/:r/issues/:n` (блокировка — отдельными запросами).
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
    if let Some(reason) = &patch.state_reason {
        body.insert("state_reason".into(), json!(reason));
    }
    if let Some(labels) = &patch.labels {
        body.insert("labels".into(), json!(labels.iter().map(|label| label.name.clone()).collect::<Vec<_>>()));
    }
    if let Some(users) = &patch.assignees {
        body.insert("assignees".into(), json!(users.iter().map(|user| user.login.clone()).collect::<Vec<_>>()));
    }
    if patch.clear_milestone {
        body.insert("milestone".into(), Value::Null);
    } else if let Some(milestone) = &patch.milestone {
        body.insert("milestone".into(), milestone_number_of(milestone));
    }
    Value::Object(body)
}

/// Тело `POST /repos/:o/:r/issues`.
pub fn create_body(input: &IssueInput) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("title".into(), json!(input.title));
    body.insert("body".into(), json!(input.body));
    if !input.labels.is_empty() {
        body.insert("labels".into(), json!(input.labels.iter().map(|label| label.name.clone()).collect::<Vec<_>>()));
    }
    if !input.assignees.is_empty() {
        body.insert("assignees".into(), json!(input.assignees.iter().map(|user| user.login.clone()).collect::<Vec<_>>()));
    }
    if let Some(milestone) = &input.milestone {
        body.insert("milestone".into(), milestone_number_of(milestone));
    }
    Value::Object(body)
}

#[async_trait]
impl IssueProvider for GithubIssues {
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
            due_date: false,
            confidential: false,
            lock: write,
            delete: false,
            events: true,
            text_search: true,
            counts: true,
            close_reasons: vec!["completed".to_owned(), "not_planned".to_owned()],
        }
    }

    fn web_url(&self, ctx: &Ctx) -> Option<String> {
        ctx.web_url.as_ref().map(|url| format!("{}/issues", url.trim_end_matches('/')))
    }

    async fn list(&self, ctx: &Ctx, query: &IssueQuery) -> Result<IssueList> {
        let me = if needs_me(query) { me(ctx).await.map(|user| user.login) } else { None };
        let me = me.as_deref();
        let counts_of = |state| opts(vec![("q".to_owned(), search_q(query, &ctx.owner, &ctx.repo, me, Some(state))), ("per_page".to_owned(), "1".to_owned())]);
        let (open, closed) = (counts_of(IssueState::Open), counts_of(IssueState::Closed));
        let page = async {
            if query.search_text().is_some() {
                let data = request(&ctx.http, Method::GET, "/search/issues", opts(search_query(query, &ctx.owner, &ctx.repo, me))).await?;
                return Ok::<_, GorynychError>(items(&data, "items").to_vec());
            }
            let mut filter = query.clone();
            if let Some(value) = query.milestone.as_deref() {
                filter.milestone = milestone_number(ctx, value).await;
            }
            let data = request(&ctx.http, Method::GET, format!("{}/issues", ctx.repo_api()), opts(list_query(&filter, me))).await?;
            Ok(array(&data).to_vec())
        };
        let (page, open, closed) = tokio::join!(page, request(&ctx.http, Method::GET, "/search/issues", open), request(&ctx.http, Method::GET, "/search/issues", closed));
        let raw = page.map_err(|error| list_error(error, "GitHub"))?;
        // Полнота страницы — по ответу сервера: pull request'ы, отброшенные ниже, тоже занимают место
        let has_more = raw.len() == query.per_page() as usize;
        let items = raw.iter().filter(|item| !is_pull_request(item)).map(issue_from).collect();
        let counts = match (open, closed) {
            (Ok(open), Ok(closed)) => Some(IssueCounts { open: total_count(&open), closed: total_count(&closed) }),
            _ => None,
        };
        Ok(IssueList { items, page: query.page(), has_more, counts })
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
            pages(ctx, &members_path, &[]),
            me(ctx)
        );
        let list = |result: Result<(Vec<Value>, bool)>| result.map(|(items, _)| items).unwrap_or_default();
        Ok(IssueMeta {
            labels: list(labels).iter().filter_map(label_from).collect(),
            milestones: list(milestones).iter().filter_map(milestone_from).collect(),
            members: list(members).iter().filter_map(user_from).collect(),
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
        if let Some(locked) = patch.locked {
            let method = if locked { Method::PUT } else { Method::DELETE };
            request(&ctx.http, method, format!("{path}/lock"), Opts::not_found(not_found_text(number))).await?;
        }
        let body = patch_body(patch);
        let data = if body.as_object().is_some_and(serde_json::Map::is_empty) {
            request(&ctx.http, Method::GET, &path, Opts::not_found(not_found_text(number))).await?
        } else {
            request(&ctx.http, Method::PATCH, &path, Opts::body(body).with_not_found(not_found_text(number))).await?
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
        // Цвет у GitHub — шесть цифр без решётки
        let color = label_color(Some(color)).trim_start_matches('#').to_owned();
        let data = request(&ctx.http, Method::POST, format!("{}/labels", ctx.repo_api()), Opts::body(json!({ "name": name, "color": color }))).await?;
        label_from(&data).ok_or_else(not_supported)
    }

    async fn delete(&self, _ctx: &Ctx, _number: u64) -> Result<()> {
        Err(not_supported())
    }
}

