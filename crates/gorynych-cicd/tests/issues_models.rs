//! Новое в 2.0: разбор ответов серверов о задачах (`gorynych_cicd::issues`) и параметры запросов.
//!
//! Образцы ответов (`tests/fixtures/issues/<сервер>/`) — дословно из официальной документации, придуманных нет:
//! - GitLab — блоки «Example response» из исходников документации API (`gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/…`):
//!   `issues.md` («List all project issues» → `issues.json`, «Retrieve a project issue» → `issue.json`), `notes.md`
//!   («List all issue notes» → `notes.json`), `labels.md` («List all project labels»), `milestones.md`
//!   («List all project milestones»), `project_members.md` («List all members of a project»), `issues_statistics.md`
//!   («Retrieve issues statistics for a project»).
//! - GitHub — примеры `components.examples` описания REST API (`github/rest-api-description`,
//!   `descriptions/api.github.com/api.github.com.json`): `issue`, `issue-items`, `issue-comment`, `issue-comment-items`,
//!   `timeline-issue-events`, `label`, `label-items`, `milestone-items`, `simple-user-items`, `issue-search-result-item-paginated`.
//! - Gitea — в swagger примеров нет, поэтому это настоящие ответы официального сервера `gitea.com` (репозиторий `gitea/tea`,
//!   13.11.2026): `GET /api/v1/repos/gitea/tea/issues?type=issues&state=all&limit=3`, `…/issues/1129`,
//!   `…/issues/1129/timeline`, `…/issues/1129/comments`, `…/labels?limit=3`, `…/milestones?state=all&limit=2`, `…/repos/gitea/tea`.
//! - Bitbucket — образцов нет: API трекера задач удалён (см. шапку `issues/mod.rs`).

use std::path::Path;

use gorynych_cicd::http::HttpCtx;
use gorynych_cicd::issues::templates::{self, Layout};
use gorynych_cicd::issues::{self, *};
use gorynych_cicd::providers::Ctx;
use gorynych_core::error::{ErrorCode, GorynychError};
use gorynych_storage::repo_providers::CiProvider;
use serde_json::{Value, json};

fn fixture(path: &str) -> Value {
    let full = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/issues").join(path);
    serde_json::from_str(&std::fs::read_to_string(&full).unwrap_or_else(|error| panic!("{}: {error}", full.display()))).unwrap()
}

fn list(value: &Value) -> &[Value] {
    value.as_array().unwrap()
}

fn query() -> IssueQuery {
    IssueQuery::default()
}

fn pairs(list: &[(String, String)]) -> Vec<(&str, &str)> {
    list.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}

/* ---------- Общее ---------- */

#[test]
fn label_color_is_always_rrggbb() {
    assert_eq!(label_color(Some("#D9534F")), "#d9534f");
    assert_eq!(label_color(Some("f29513")), "#f29513");
    assert_eq!(label_color(Some("#abc")), "#aabbcc");
    assert_eq!(label_color(Some("red")), DEFAULT_LABEL_COLOR);
    assert_eq!(label_color(Some("")), DEFAULT_LABEL_COLOR);
    assert_eq!(label_color(None), DEFAULT_LABEL_COLOR);
}

#[test]
fn empty_objects_parse_without_panic() {
    let empty = json!({});
    for issue in [issues::gitlab::issue_from(&empty), issues::github::issue_from(&empty), issues::gitea::issue_from(&empty)] {
        assert_eq!(issue, Issue::default());
    }
    assert!(user_from(&empty).is_none());
    assert_eq!(label_from(&empty).map(|label| label.color), Some(DEFAULT_LABEL_COLOR.to_owned()));
    assert!(issues::gitlab::milestone_from(&empty).is_some());
    assert!(matches!(issues::gitlab::note_from(&empty, None), TimelineItem::Comment(_)));
    assert!(matches!(issues::github::timeline_from(&empty, None, false), TimelineItem::Event(IssueEvent { kind: IssueEventKind::Other, .. })));
    assert!(matches!(issues::gitea::timeline_from(&empty, None, false), TimelineItem::Event(IssueEvent { kind: IssueEventKind::Other, .. })));
    assert_eq!(issues::gitlab::counts_from(&empty), None);
    // Не объект — тоже без паники
    assert_eq!(issues::github::issue_from(&json!(null)), Issue::default());
    assert!(user_from(&json!("x")).is_none());
}

#[test]
fn disabled_tracker_is_a_separate_code() {
    let not_found = GorynychError::new(ErrorCode::NotFound, "нет");
    assert_eq!(list_error(not_found, "GitHub").code, ErrorCode::IssuesDisabled);
    // GitHub отвечает 410 «Issues are disabled for this repo»: в `http.rs` это API_ERROR с текстом в details
    let gone = GorynychError::new(ErrorCode::ApiError, "410").with_details("Issues are disabled for this repo");
    assert_eq!(list_error(gone, "GitHub").code, ErrorCode::IssuesDisabled);
    let other = GorynychError::new(ErrorCode::ApiError, "500").with_details("boom");
    assert_eq!(list_error(other, "GitHub").code, ErrorCode::ApiError);
    assert_eq!(list_error(GorynychError::new(ErrorCode::Auth, "x"), "GitHub").code, ErrorCode::Auth);
}

#[test]
fn query_page_bounds() {
    let mut q = query();
    q.per_page = 500;
    q.page = 0;
    assert_eq!((q.per_page(), q.page()), (100, 1));
    q.per_page = 0;
    assert_eq!(q.per_page(), 30);
    q.search = Some("   ".into());
    assert_eq!(q.search_text(), None);
    // Пустой JSON — значения по умолчанию: открытые, по обновлению, 30 на страницу
    let parsed: IssueQuery = serde_json::from_value(json!({})).unwrap();
    assert_eq!(parsed, IssueQuery::default());
    assert_eq!((parsed.state, parsed.sort, parsed.per_page), (Some(IssueState::Open), IssueSort::Updated, 30));
}

#[test]
fn wire_names_are_camel_case_and_lowercase_enums() {
    let item = TimelineItem::Event(IssueEvent { kind: IssueEventKind::Demilestoned, ..IssueEvent::default() });
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["type"], "event");
    assert_eq!(json["kind"], "demilestoned");
    let issue = serde_json::to_value(Issue { state: IssueState::Closed, ..Issue::default() }).unwrap();
    assert_eq!(issue["state"], "closed");
    assert!(issue.get("commentsCount").is_some() && issue.get("webUrl").is_some());
    let caps = serde_json::to_value(IssueCaps::default()).unwrap();
    assert!(caps.get("createLabel").is_some() && caps.get("closeReasons").is_some());
}

/* ---------- GitLab ---------- */

#[test]
fn gitlab_issue() {
    let issue = issues::gitlab::issue_from(&fixture("gitlab/issue.json"));
    assert_eq!((issue.number, issue.id.as_str(), issue.state), (1, "41", IssueState::Closed));
    assert_eq!(issue.title, "Ut commodi ullam eos dolores perferendis nihil sunt.");
    assert_eq!(issue.author.as_ref().map(|user| user.login.as_str()), Some("root"));
    assert_eq!(issue.assignees.iter().map(|user| user.login.as_str()).collect::<Vec<_>>(), ["lennie"]);
    assert_eq!(issue.comments_count, 1);
    assert_eq!(issue.web_url, "http://gitlab.example.com/my-group/my-project/issues/1");
    assert!(!issue.locked && !issue.confidential && issue.due_date.is_none());
    let milestone = issue.milestone.unwrap();
    assert_eq!((milestone.id.as_str(), milestone.number, milestone.title.as_str(), milestone.closed), ("11", Some(3), "v3.0", true));
    let all = fixture("gitlab/issues.json");
    let parsed: Vec<Issue> = list(&all).iter().map(issues::gitlab::issue_from).collect();
    assert_eq!(parsed.iter().map(|issue| issue.number).collect::<Vec<_>>(), [1]);
    // Метки без `with_labels_details` — строки: цвет по умолчанию
    assert!(parsed[0].labels.iter().all(|label| label.color == DEFAULT_LABEL_COLOR && label.id == label.name));
    assert_eq!(parsed[0].labels.iter().map(|label| label.name.as_str()).collect::<Vec<_>>(), ["foo", "bar"]);
}

#[test]
fn gitlab_system_note_is_an_event() {
    let notes = fixture("gitlab/notes.json");
    let items: Vec<TimelineItem> = list(&notes).iter().map(|note| issues::gitlab::note_from(note, Some("pipin"))).collect();
    let TimelineItem::Event(first) = &items[0] else { panic!("системная заметка должна стать событием: {items:?}") };
    assert_eq!((first.kind, first.text.as_deref(), first.created_at.as_str()), (IssueEventKind::Other, Some("closed"), "2013-10-02T09:22:45Z"));
    assert_eq!(first.actor.as_ref().map(|user| user.login.as_str()), Some("pipin"));
    // Та же заметка без `system` — комментарий; свой — можно править
    let mut plain = list(&notes)[1].clone();
    plain["system"] = json!(false);
    let TimelineItem::Comment(comment) = issues::gitlab::note_from(&plain, Some("pipin")) else { panic!() };
    assert_eq!((comment.id.as_str(), comment.body.as_str(), comment.can_edit), ("305", "Text of the comment\r\n", true));
    assert!(!issues::gitlab::comment_from(&plain, Some("кто-то")).can_edit);
}

#[test]
fn gitlab_labels_milestones_members_counts() {
    let labels: Vec<IssueLabel> = list(&fixture("gitlab/labels.json")).iter().filter_map(label_from).collect();
    assert_eq!(labels.iter().map(|label| (label.name.as_str(), label.color.as_str())).take(2).collect::<Vec<_>>(), [("bug", "#d9534f"), ("confirmed", "#d9534f")]);
    assert_eq!(labels[0].id, "1");
    let milestone = issues::gitlab::milestone_from(&list(&fixture("gitlab/milestones.json"))[0]).unwrap();
    assert_eq!((milestone.id.as_str(), milestone.number, milestone.title.as_str(), milestone.due_date.as_deref(), milestone.closed), ("12", Some(3), "10.0", Some("2013-11-29"), false));
    let members: Vec<IssueUser> = list(&fixture("gitlab/members.json")).iter().filter_map(user_from).collect();
    assert_eq!(members.iter().map(|user| (user.id.as_str(), user.login.as_str())).collect::<Vec<_>>(), [("1", "raymond_smith"), ("2", "john_doe"), ("3", "foo_bar")]);
    assert_eq!(issues::gitlab::counts_from(&fixture("gitlab/issues_statistics.json")), Some(IssueCounts { open: 15, closed: 5 }));
}

#[test]
fn gitlab_list_query() {
    let base = issues::gitlab::list_query(&query(), Some("me"));
    assert_eq!(pairs(&base), [("state", "opened"), ("order_by", "updated_at"), ("sort", "desc"), ("with_labels_details", "true"), ("page", "1"), ("per_page", "30")]);
    let q = IssueQuery { state: None, assignee: Some("@me".into()), author: Some("@me".into()), milestone: Some("@none".into()), labels: vec!["bug".into(), "ui".into()], search: Some(" text ".into()), sort: IssueSort::Created, ascending: true, page: 2, per_page: 50 };
    let built = issues::gitlab::list_query(&q, Some("root"));
    let built = pairs(&built);
    for pair in [("state", "all"), ("labels", "bug,ui"), ("scope", "assigned_to_me"), ("author_username", "root"), ("milestone", "None"), ("search", "text"), ("order_by", "created_at"), ("sort", "asc"), ("page", "2"), ("per_page", "50")] {
        assert!(built.contains(&pair), "{pair:?} в {built:?}");
    }
    let none = IssueQuery { state: Some(IssueState::Closed), assignee: Some("@none".into()), author: Some("@me".into()), sort: IssueSort::Comments, ..query() };
    let built = issues::gitlab::list_query(&none, None);
    let built = pairs(&built);
    for pair in [("state", "closed"), ("assignee_id", "None"), ("scope", "created_by_me"), ("order_by", "updated_at")] {
        assert!(built.contains(&pair), "{pair:?} в {built:?}");
    }
    // Счётчики — те же фильтры без состояния, сортировки и страницы
    let counts = issues::gitlab::counts_query(&none, None);
    assert_eq!(pairs(&counts), [("assignee_id", "None"), ("scope", "created_by_me")]);
}

#[test]
fn gitlab_bodies() {
    let patch = IssuePatch { state: Some(IssueState::Closed), labels: Some(vec![LabelRef { id: "1".into(), name: "bug".into() }]), assignees: Some(Vec::new()), clear_milestone: true, clear_due_date: true, locked: Some(true), ..IssuePatch::default() };
    assert_eq!(issues::gitlab::patch_body(&patch), json!({ "state_event": "close", "labels": "bug", "assignee_ids": [0], "milestone_id": 0, "due_date": "", "discussion_locked": true }));
    let input = IssueInput { title: "T".into(), body: "B".into(), assignees: vec![UserRef { id: "5".into(), login: "a".into() }, UserRef { id: "6".into(), login: "b".into() }], milestone: Some(MilestoneRef { id: "12".into(), ..MilestoneRef::default() }), due_date: Some("2026-12-01".into()), ..IssueInput::default() };
    assert_eq!(issues::gitlab::create_body(&input, true), json!({ "title": "T", "description": "B", "assignee_ids": [5, 6], "milestone_id": 12, "due_date": "2026-12-01" }));
    assert_eq!(issues::gitlab::create_body(&input, false)["assignee_id"], json!(5));
}

/* ---------- GitHub ---------- */

#[test]
fn github_issue_and_pull_requests() {
    let raw = fixture("github/issue.json");
    let issue = issues::github::issue_from(&raw);
    assert_eq!((issue.number, issue.id.as_str(), issue.title.as_str(), issue.state), (1347, "1", "Found a bug", IssueState::Open));
    assert_eq!((issue.state_reason.as_deref(), issue.comments_count, issue.locked), (Some("completed"), 0, true));
    assert_eq!(issue.author.as_ref().map(|user| user.login.as_str()), Some("octocat"));
    assert_eq!(issue.web_url, "https://github.com/octocat/Hello-World/issues/1347");
    assert_eq!(issue.labels.iter().map(|label| (label.name.as_str(), label.color.as_str())).collect::<Vec<_>>(), [("bug", "#f29513")]);
    let milestone = issue.milestone.unwrap();
    assert_eq!((milestone.number, milestone.title.as_str(), milestone.due_date.as_deref()), (Some(1), "v1.0", Some("2012-10-09T23:39:01Z")));
    // В примере списка задач единственный элемент — pull request: он отбрасывается
    let items = fixture("github/issue-items.json");
    assert!(list(&items).iter().all(issues::github::is_pull_request));
    assert!(list(&items).iter().filter(|item| !issues::github::is_pull_request(item)).count() == 0);
    // Найденные поиском
    let search = fixture("github/issue-search-result-item-paginated.json");
    let found: Vec<u64> = search["items"].as_array().unwrap().iter().map(|item| issues::github::issue_from(item).number).collect();
    assert_eq!(found, [132]);
    assert_eq!(search["total_count"], 280);
}

#[test]
fn github_timeline_comments_labels() {
    let events = fixture("github/timeline-issue-events.json");
    let items: Vec<TimelineItem> = list(&events).iter().map(|event| issues::github::timeline_from(event, Some("octocat"), false)).collect();
    let kinds: Vec<String> = items
        .iter()
        .map(|item| match item {
            TimelineItem::Comment(_) => "comment".to_owned(),
            TimelineItem::Event(event) => format!("{:?}", event.kind),
        })
        .collect();
    assert_eq!(kinds, ["Locked", "Labeled", "Renamed", "comment"]);
    let TimelineItem::Event(labeled) = &items[1] else { panic!() };
    assert_eq!(labeled.label.as_ref().map(|label| (label.name.as_str(), label.color.as_str())), Some(("beta", "#99dd88")));
    let TimelineItem::Event(renamed) = &items[2] else { panic!() };
    assert_eq!(renamed.to.as_deref(), Some("Secret scanning: dry-runs for enterprise-level custom patterns"));
    let TimelineItem::Comment(comment) = &items[3] else { panic!() };
    assert!(comment.can_edit, "свой комментарий");
    let comment = issues::github::comment_from(&fixture("github/issue-comment.json"), Some("другой"), false);
    assert_eq!((comment.id.as_str(), comment.body.as_str(), comment.can_edit), ("1", "Me too", false));
    assert_eq!(comment.web_url.as_deref(), Some("https://github.com/octocat/Hello-World/issues/1347#issuecomment-1"));
    assert_eq!(list(&fixture("github/issue-comment-items.json")).len(), 1);
    let labels: Vec<String> = list(&fixture("github/label-items.json")).iter().filter_map(label_from).map(|label| label.color).collect();
    assert_eq!(labels, ["#f29513", "#a2eeef"]);
    assert_eq!(label_from(&fixture("github/label.json")).map(|label| label.name), Some("bug".to_owned()));
    let milestone = issues::github::milestone_from(&list(&fixture("github/milestone-items.json"))[0]).unwrap();
    assert_eq!((milestone.number, milestone.title.as_str()), (Some(1), "v1.0"));
    let users: Vec<String> = list(&fixture("github/simple-user-items.json")).iter().filter_map(user_from).map(|user| user.login).collect();
    assert_eq!(users, ["octocat"]);
}

#[test]
fn github_list_and_search_query() {
    let base = issues::github::list_query(&query(), None);
    assert_eq!(pairs(&base), [("state", "open"), ("sort", "updated"), ("direction", "desc"), ("per_page", "30"), ("page", "1")]);
    let q = IssueQuery { state: None, assignee: Some("@me".into()), author: Some("@me".into()), milestone: Some("@none".into()), labels: vec!["bug".into()], sort: IssueSort::Comments, ascending: true, ..query() };
    let built = issues::github::list_query(&q, Some("octocat"));
    assert_eq!(pairs(&built), [("state", "all"), ("labels", "bug"), ("assignee", "octocat"), ("creator", "octocat"), ("milestone", "none"), ("sort", "comments"), ("direction", "asc"), ("per_page", "30"), ("page", "1")]);
    let none = IssueQuery { assignee: Some("@none".into()), ..query() };
    assert!(pairs(&issues::github::list_query(&none, None)).contains(&("assignee", "none")));
    let text = IssueQuery { search: Some("crash on start".into()), labels: vec!["good first issue".into()], assignee: Some("@none".into()), milestone: Some("v1.0".into()), ..query() };
    assert_eq!(issues::github::search_q(&text, "o", "r", None, Some(IssueState::Open)), "repo:o/r is:issue is:open label:\"good first issue\" no:assignee milestone:v1.0 crash on start");
    let search = issues::github::search_query(&text, "o", "r", None);
    assert_eq!(pairs(&search)[1..], [("sort", "updated"), ("order", "desc"), ("per_page", "30"), ("page", "1")]);
    assert_eq!(issues::github::search_q(&query(), "o", "r", Some("me"), None), "repo:o/r is:issue");
}

#[test]
fn github_bodies() {
    let patch = IssuePatch { state: Some(IssueState::Closed), state_reason: Some("not_planned".into()), clear_milestone: true, assignees: Some(vec![UserRef { id: "1".into(), login: "octocat".into() }]), locked: Some(true), ..IssuePatch::default() };
    // Блокировка — отдельным запросом, в теле её нет
    assert_eq!(issues::github::patch_body(&patch), json!({ "state": "closed", "state_reason": "not_planned", "assignees": ["octocat"], "milestone": null }));
    let input = IssueInput { title: "T".into(), labels: vec![LabelRef { id: "9".into(), name: "bug".into() }], milestone: Some(MilestoneRef { id: "1002604".into(), number: Some(1), title: "v1.0".into() }), ..IssueInput::default() };
    assert_eq!(issues::github::create_body(&input), json!({ "title": "T", "body": "", "labels": ["bug"], "milestone": 1 }));
}

/* ---------- Gitea ---------- */

#[test]
fn gitea_issue_list_and_labels() {
    let issue = issues::gitea::issue_from(&fixture("gitea/issue.json"));
    assert_eq!((issue.number, issue.id.as_str(), issue.state), (1129, "509070", IssueState::Closed));
    assert_eq!(issue.title, "我怎么列出所有 assignee 为空的 issues");
    assert_eq!((issue.comments_count, issue.locked, issue.web_url.as_str()), (4, false, "https://gitea.com/gitea/tea/issues/1129"));
    assert_eq!(issue.author.as_ref().map(|user| user.login.as_str()), Some("mfk1"));
    assert_eq!(issue.labels.iter().map(|label| (label.name.as_str(), label.color.as_str())).collect::<Vec<_>>(), [("upstream/gitea", "#089c5c"), ("upstream/sdk", "#0db56c")]);
    assert_eq!(issue.closed_at.as_deref(), Some("2026-10-29T17:34:32Z"));
    let all = fixture("gitea/issues.json");
    assert_eq!(list(&all).iter().map(|item| issues::gitea::issue_from(item).number).collect::<Vec<_>>(), [1150, 1149, 1129]);
    let labels: Vec<String> = list(&fixture("gitea/labels.json")).iter().filter_map(label_from).map(|label| label.color).collect();
    assert_eq!(labels, ["#fbca04", "#fc2929", "#ff925c"]);
    let milestone = issues::gitea::milestone_from(&list(&fixture("gitea/milestones.json"))[0]).unwrap();
    assert_eq!((milestone.id.as_str(), milestone.title.as_str(), milestone.closed, milestone.number), ("59", "v0.1.0", true, None));
    let comments = fixture("gitea/comments.json");
    let first = issues::gitea::comment_from(&list(&comments)[0], None, false);
    assert!(!first.id.is_empty() && !first.body.is_empty() && first.author.is_some());
    // В образце репозитория счётчик открытых задач — число (закрытых нет, поэтому counts: None)
    assert!(fixture("gitea/repository.json")["open_issues_count"].is_number());
}

#[test]
fn gitea_timeline_kinds() {
    let timeline = fixture("gitea/timeline.json");
    let items: Vec<TimelineItem> = list(&timeline).iter().map(|event| issues::gitea::timeline_from(event, Some("bircni"), false)).collect();
    let kinds: Vec<String> = items
        .iter()
        .map(|item| match item {
            TimelineItem::Comment(comment) => format!("comment:{}", comment.can_edit),
            TimelineItem::Event(event) => format!("{:?}", event.kind),
        })
        .collect();
    assert_eq!(kinds, ["comment:true", "Closed", "comment:false", "Reopened", "Labeled", "Labeled", "Referenced", "comment:true", "comment:true", "Closed"]);
    let TimelineItem::Event(label) = &items[4] else { panic!() };
    assert_eq!(label.label.as_ref().map(|label| label.name.as_str()), Some("upstream/gitea"));
    // Пустое тело метки — снята
    let mut removed = list(&timeline)[4].clone();
    removed["body"] = json!("");
    assert!(matches!(issues::gitea::timeline_from(&removed, None, false), TimelineItem::Event(IssueEvent { kind: IssueEventKind::Unlabeled, .. })));
}

#[test]
fn gitea_list_query_and_bodies() {
    let base = issues::gitea::list_query(&query(), None);
    assert_eq!(pairs(&base), [("state", "open"), ("type", "issues"), ("page", "1"), ("limit", "30")]);
    let q = IssueQuery { state: None, assignee: Some("@me".into()), author: Some("bircni".into()), milestone: Some("v1.0".into()), labels: vec!["a".into(), "b".into()], search: Some("crash".into()), per_page: 100, ..query() };
    assert_eq!(pairs(&issues::gitea::list_query(&q, Some("lunny"))), [("state", "all"), ("type", "issues"), ("labels", "a,b"), ("q", "crash"), ("milestones", "v1.0"), ("assigned_by", "lunny"), ("created_by", "bircni"), ("page", "1"), ("limit", "50")]);
    // «Без исполнителя» и «без вехи» у Gitea не выражаются — фильтр не уходит
    let none = IssueQuery { assignee: Some("@none".into()), milestone: Some("@none".into()), ..query() };
    assert_eq!(pairs(&issues::gitea::list_query(&none, None)), [("state", "open"), ("type", "issues"), ("page", "1"), ("limit", "30")]);
    let patch = IssuePatch { title: Some("T".into()), clear_due_date: true, clear_milestone: true, ..IssuePatch::default() };
    assert_eq!(issues::gitea::patch_body(&patch), json!({ "title": "T", "milestone": 0, "unset_due_date": true }));
    let input = IssueInput { title: "T".into(), labels: vec![LabelRef { id: "431".into(), name: "kind/breaking".into() }], due_date: Some("2026-12-01".into()), ..IssueInput::default() };
    assert_eq!(issues::gitea::create_body(&input), json!({ "title": "T", "body": "", "labels": [431], "due_date": "2026-12-01T00:00:00Z" }));
}

/* ---------- Bitbucket и возможности ---------- */

fn ctx(can_write: Option<bool>) -> Ctx {
    Ctx {
        http: HttpCtx { client: gorynych_cicd::http::client(), api_base: "https://invalid.example".into(), headers: Vec::new(), label: "Test".into(), scope_hint: None },
        host: "invalid.example".into(),
        api_override: false,
        owner: "o".into(),
        repo: "r".into(),
        site_base: "https://invalid.example".into(),
        web_url: Some("https://invalid.example/o/r/".into()),
        can_write,
        is_admin: None,
        default_branch: None,
        root: std::env::temp_dir(),
        gitlab: None,
    }
}

#[tokio::test]
async fn bitbucket_has_no_issues() {
    let adapter = issue_adapter(CiProvider::Bitbucket);
    let ctx = ctx(Some(true));
    assert_eq!(adapter.caps(&ctx), IssueCaps::default());
    assert_eq!(adapter.web_url(&ctx), None);
    assert_eq!(adapter.list(&ctx, &query()).await.unwrap_err().code, ErrorCode::IssuesDisabled);
    assert_eq!(adapter.get(&ctx, 1).await.unwrap_err().code, ErrorCode::IssuesDisabled);
    assert_eq!(adapter.create(&ctx, &IssueInput::default()).await.unwrap_err().code, ErrorCode::Unknown);
}

#[test]
fn caps_follow_write_access() {
    let read_only = ctx(Some(false));
    let github = issue_adapter(CiProvider::Github).caps(&read_only);
    assert!(github.create && github.comment, "комментировать и создавать можно и без записи");
    assert!(!github.edit && !github.close && !github.labels && !github.lock);
    assert!(!github.delete && !github.due_date && !github.confidential);
    assert_eq!(github.close_reasons, ["completed", "not_planned"]);
    let github = issue_adapter(CiProvider::Github).caps(&ctx(Some(true)));
    assert!(github.edit && github.close && github.labels && github.lock && github.counts);
    let gitea = issue_adapter(CiProvider::Gitea).caps(&ctx(Some(true)));
    assert!(gitea.due_date && !gitea.lock && !gitea.counts && !gitea.confidential && gitea.delete);
    assert_eq!(issue_adapter(CiProvider::Gitea).web_url(&ctx(None)).as_deref(), Some("https://invalid.example/o/r/issues"));
    // GitLab без `GlCtx` — ничего нельзя
    assert_eq!(issue_adapter(CiProvider::Gitlab).caps(&ctx(Some(true))), IssueCaps { events: true, text_search: true, counts: true, ..IssueCaps::default() });
}

/* ---------- Шаблоны ---------- */

#[test]
fn templates_from_all_layouts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let write = |path: &str, text: &str| {
        let full = root.join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, text).unwrap();
    };
    write(".gitlab/issue_templates/Bug.md", "## Шаги\n\n1. …\n");
    write(".gitlab/issue_templates/notes.txt", "не шаблон");
    write(".github/ISSUE_TEMPLATE/bug_report.md", "---\nname: Bug report\ntitle: '[BUG] '\nlabels: bug, triage\n---\n\nОпишите ошибку\n");
    write(".github/ISSUE_TEMPLATE/form.yml", "name: Форма\nbody: []\n");
    write(".github/ISSUE_TEMPLATE/plain.md", "Просто текст\n");
    write(".gitea/ISSUE_TEMPLATE/feature.md", "---\r\nname: Feature\r\nlabels:\r\n  - enhancement\r\n---\r\nИдея\r\n");
    write(".gitea/issue_template/old.md", "\u{feff}---\nabout: без имени\n---\nСтарая раскладка\n");
    write(".github/ISSUE_TEMPLATE/huge.md", &"x".repeat(64 * 1024 + 1));

    let gitlab = templates::read(root, Layout::Gitlab);
    assert_eq!(gitlab, vec![IssueTemplate { name: "Bug".into(), title: None, body: "## Шаги\n\n1. …\n".into(), labels: Vec::new() }]);

    let github = templates::read(root, Layout::Github);
    let names: Vec<&str> = github.iter().map(|template| template.name.as_str()).collect();
    assert_eq!(names, ["Bug report", "plain", "Feature", "old"], "формы .yml и файлы больше 64 КБ пропускаются");
    assert_eq!(github[0], IssueTemplate { name: "Bug report".into(), title: Some("[BUG] ".into()), body: "Опишите ошибку\n".into(), labels: vec!["bug".into(), "triage".into()] });
    assert_eq!(github[1].body, "Просто текст\n");
    assert_eq!((github[2].labels.clone(), github[2].body.as_str()), (vec!["enhancement".to_owned()], "Идея\r\n"));
    assert_eq!(github[3].body, "Старая раскладка\n");

    // Нет папок — пусто; больше 20 — первые 20
    assert!(templates::read(&root.join("нет"), Layout::Github).is_empty());
    for n in 0..25 {
        write(&format!("many/.gitlab/issue_templates/t{n:02}.md"), "x");
    }
    assert_eq!(templates::read(&root.join("many"), Layout::Gitlab).len(), templates::MAX_TEMPLATES);
}
