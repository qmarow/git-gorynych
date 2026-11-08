//! Эндпоинты GitLab в форме каналов `gitlab:*`: пайплайны, задания, действия, переменные, раннеры, CI Lint, расписания, merge request.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::LazyLock;

use futures_util::future::join_all;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use regex::Regex;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::http::masked_hint;
use super::{GlCtx, GlProject};
use crate::http::Opts;
use crate::json::{Json, JsonType, field, flag, items, number, raw, strings, text};
use crate::models::{ActionRequest, CiActor, CiId, JobArtifactFile, aggregate};
use crate::service::CicdService;

fn bad_args(message: String) -> GorynychError {
    GorynychError::new(ErrorCode::BadArgs, message)
}

/// Пайплайн в списке.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlPipelineSummary {
    pub id: Option<CiId>,
    pub iid: Option<CiId>,
    pub sha: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub name: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub web_url: Option<String>,
}

fn pipeline_summary(p: &Value) -> GlPipelineSummary {
    GlPipelineSummary {
        id: CiId::field(p, "id"),
        iid: CiId::field(p, "iid"),
        sha: text(p, "sha"),
        reference: text(p, "ref"),
        status: text(p, "status"),
        source: text(p, "source"),
        name: text(p, "name"),
        created_at: text(p, "created_at"),
        updated_at: text(p, "updated_at"),
        web_url: text(p, "web_url"),
    }
}

/// Значок пайплайна в графе.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlShaBadge {
    pub id: Option<CiId>,
    pub status: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub web_url: Option<String>,
}

/// `listPipelines`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlPipelineList {
    pub project: GlProject,
    pub can_write: bool,
    pub pipelines: Vec<GlPipelineSummary>,
    pub by_sha: BTreeMap<String, GlShaBadge>,
}

/// Пользователь в подробностях пайплайна.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlUser {
    pub name: Option<String>,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

/// Подробности пайплайна.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlPipelineFull {
    #[serde(flatten)]
    pub summary: GlPipelineSummary,
    pub user: Option<GlUser>,
    #[specta(type = Option<f64>)]
    pub duration: Option<serde_json::Number>,
    #[specta(type = Option<f64>)]
    pub queued_duration: Option<serde_json::Number>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub coverage: Option<Json>,
    #[specta(type = Option<JsonType>)]
    pub yaml_errors: Option<Json>,
    pub detailed_status: Option<String>,
    pub before_sha: Option<String>,
}

/// Раннер задания.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlJobRunner {
    pub id: Option<CiId>,
    pub description: Option<String>,
    pub shared: Option<bool>,
}

/// Дочерний пайплайн.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlDownstream {
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub web_url: Option<String>,
    pub project_id: Option<CiId>,
}

/// Задание.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlJob {
    pub id: Option<CiId>,
    pub kind: String,
    pub name: Option<String>,
    pub stage: Option<String>,
    pub status: Option<String>,
    pub allow_failure: bool,
    pub when: Option<String>,
    #[specta(type = Option<f64>)]
    pub duration: Option<serde_json::Number>,
    #[specta(type = Option<f64>)]
    pub queued_duration: Option<serde_json::Number>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub web_url: Option<String>,
    pub failure_reason: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub coverage: Option<Json>,
    pub tags: Vec<String>,
    pub runner: Option<GlJobRunner>,
    pub user: Option<CiActor>,
    pub artifacts: Vec<JobArtifactFile>,
    pub downstream: Option<GlDownstream>,
}

fn job_summary(j: &Value, kind: &str) -> GlJob {
    GlJob {
        id: CiId::field(j, "id"),
        kind: kind.to_owned(),
        name: text(j, "name"),
        stage: text(j, "stage"),
        status: text(j, "status"),
        allow_failure: flag(j, "allow_failure"),
        when: text(j, "when"),
        duration: number(j, "duration"),
        queued_duration: number(j, "queued_duration"),
        created_at: text(j, "created_at"),
        started_at: text(j, "started_at"),
        finished_at: text(j, "finished_at"),
        web_url: text(j, "web_url"),
        failure_reason: text(j, "failure_reason"),
        coverage: raw(j, "coverage"),
        tags: strings(j, "tag_list"),
        runner: field(j, "runner").filter(|r| crate::json::truthy(r)).map(|r| GlJobRunner { id: CiId::field(r, "id"), description: text(r, "description"), shared: crate::json::opt_bool(r, "is_shared") }),
        user: field(j, "user").filter(|u| crate::json::truthy(u)).map(|u| CiActor { name: text(u, "name"), username: text(u, "username") }),
        artifacts: items(j, "artifacts")
            .iter()
            .filter(|a| text(a, "file_type").as_deref() != Some("trace"))
            .map(|a| JobArtifactFile { kind: text(a, "file_type"), size: number(a, "size") })
            .collect(),
        downstream: field(j, "downstream_pipeline")
            .filter(|d| crate::json::truthy(d))
            .map(|d| GlDownstream { id: CiId::field(d, "id"), status: text(d, "status"), web_url: text(d, "web_url"), project_id: CiId::field(d, "project_id") }),
    }
}

/// Этап.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct GlStage {
    pub name: Option<String>,
    pub status: String,
    pub jobs: Vec<GlJob>,
}

/// `pipelineDetail`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlPipelineDetail {
    pub project: GlProject,
    pub can_write: bool,
    pub pipeline: GlPipelineFull,
    pub stages: Vec<GlStage>,
}

/// `jobLog`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct GlJobLog {
    pub job: GlJob,
    pub text: String,
    #[specta(type = f64)]
    pub size: u64,
    pub truncated: bool,
}

/// Результат действия.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlActionResult {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub web_url: Option<String>,
}

/// Переменная в списке: значения идут только по явному запросу.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlVariable {
    pub key: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub protected: bool,
    pub masked: bool,
    pub hidden: bool,
    pub raw: bool,
    pub scope: String,
    pub description: Option<String>,
    pub empty: bool,
}

/// `listVariables`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlVariableList {
    pub project: GlProject,
    pub variables: Vec<GlVariable>,
}

/// `variableValue`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlVariableValue {
    pub key: String,
    pub hidden: bool,
    pub value: Option<String>,
}

/// Раннер в простом списке.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlRunner {
    pub id: Option<CiId>,
    pub description: String,
    pub status: String,
    pub paused: bool,
    pub shared: bool,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

/// `listRunners`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlRunnerList {
    pub project: GlProject,
    pub runners: Vec<GlRunner>,
}

/// Задание в ответе CI Lint.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlLintJob {
    pub name: Option<String>,
    pub stage: Option<String>,
    pub when: String,
    pub allow_failure: bool,
    pub tags: Vec<String>,
    #[specta(type = Option<JsonType>)]
    pub environment: Option<Json>,
}

/// Подключённый файл в ответе CI Lint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlLintInclude {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub location: Option<String>,
    pub blob: Option<String>,
}

/// `lintCi`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct GlLintResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub jobs: Vec<GlLintJob>,
    pub includes: Vec<GlLintInclude>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
}

/// Запрос CI Lint.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlLintRequest {
    #[specta(type = Option<JsonType>)]
    pub content: Option<Json>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
}

/// Переменная, как её присылает форма.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlVariableInput {
    pub key: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub protected: bool,
    pub masked: bool,
    pub hidden: bool,
    pub raw: bool,
    pub scope: Option<String>,
    pub description: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub value: Option<Json>,
}

/// Что изменяется.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlVariableOriginal {
    pub key: Option<String>,
    pub scope: Option<String>,
}

/// `gitlab:variable-save`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlVariableSave {
    pub original: Option<GlVariableOriginal>,
    pub variable: Option<GlVariableInput>,
}

/// Результат сохранения.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct GlVariableSaved {
    pub key: Option<String>,
    pub scope: Option<String>,
    pub created: Option<bool>,
    pub renamed: Option<bool>,
    pub updated: Option<bool>,
    pub deleted: Option<bool>,
}

/// Имя и окружение переменной.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlVariableRef {
    #[specta(type = Option<JsonType>)]
    pub key: Option<Json>,
    pub scope: Option<String>,
}

/// Последний запуск расписания.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlLastPipeline {
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub web_url: Option<String>,
}

/// Расписание.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlSchedule {
    pub id: Option<CiId>,
    pub description: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub cron: Option<String>,
    pub timezone: String,
    pub next_run_at: Option<String>,
    pub active: bool,
    pub owner: Option<CiActor>,
    pub last_pipeline: Option<GlLastPipeline>,
    pub web_url: Option<String>,
}

fn schedule_summary(s: &Value) -> GlSchedule {
    GlSchedule {
        id: CiId::field(s, "id"),
        description: text(s, "description").unwrap_or_default(),
        reference: { let reference = text(s, "ref").unwrap_or_default(); reference.strip_prefix("refs/heads/").unwrap_or(&reference).to_owned() },
        cron: text(s, "cron"),
        timezone: text(s, "cron_timezone").unwrap_or_else(|| "UTC".to_owned()),
        next_run_at: text(s, "next_run_at"),
        active: flag(s, "active"),
        owner: field(s, "owner").filter(|o| crate::json::truthy(o)).map(|o| CiActor { name: text(o, "name"), username: text(o, "username") }),
        last_pipeline: field(s, "last_pipeline").filter(|p| crate::json::truthy(p)).map(|p| GlLastPipeline { id: CiId::field(p, "id"), status: text(p, "status"), web_url: text(p, "web_url") }),
        web_url: None,
    }
}

/// `listSchedules`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlScheduleList {
    pub project: GlProject,
    pub can_write: bool,
    pub me: Option<String>,
    pub schedules: Vec<GlSchedule>,
}

/// Форма расписания.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlScheduleInput {
    pub id: Option<CiId>,
    pub description: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub cron: Option<String>,
    pub timezone: Option<String>,
    pub active: Option<bool>,
}

/// Действие с расписанием.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct GlScheduleAction {
    pub id: Option<CiId>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

/// Результат действия с расписанием.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GlScheduleActionResult {
    #[specta(type = f64)]
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
}

/// Форма merge request.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GlMergeRequestInput {
    pub source: Option<String>,
    pub target: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub draft: bool,
    pub remove_source: bool,
}

/// Созданный или уже существующий merge request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlMergeRequest {
    pub iid: Option<CiId>,
    pub web_url: Option<String>,
    pub created: bool,
    pub title: Option<String>,
}

/* ---------- Пайплайны по контексту: их использует и адаптер ---------- */

pub(crate) async fn gl_list_pipelines(ctx: &GlCtx, reference: Option<&str>) -> Result<GlPipelineList> {
    let opts = Opts::query(&[("per_page", Some("60".into())), ("order_by", Some("id".into())), ("sort", Some("desc".into())), ("ref", reference.map(str::to_owned))]);
    let list = ctx.request(Method::GET, format!("{}/pipelines", ctx.project_path()), opts).await?;
    let pipelines: Vec<GlPipelineSummary> = list.as_array().ok_or_else(|| GorynychError::unknown("items.map is not a function"))?.iter().map(pipeline_summary).collect();
    let mut by_sha = BTreeMap::new();
    for pipeline in &pipelines {
        by_sha.entry(pipeline.sha.clone().unwrap_or_else(|| "undefined".to_owned())).or_insert_with(|| GlShaBadge {
            id: pipeline.id.clone(),
            status: pipeline.status.clone(),
            reference: pipeline.reference.clone(),
            web_url: pipeline.web_url.clone(),
        });
    }
    Ok(GlPipelineList { project: ctx.project.clone(), can_write: ctx.can_write(), pipelines, by_sha })
}

pub(crate) fn check_pipeline_id(id: &CiId) -> Result<()> {
    if id.is_positive_integer() { Ok(()) } else { Err(bad_args(t("Некорректный номер пайплайна", &[]))) }
}

pub(crate) async fn gl_pipeline_detail(ctx: &GlCtx, id: &CiId) -> Result<GlPipelineDetail> {
    let n = id.number_text();
    let pid = ctx.project_path();
    let (p, jobs, bridges) = tokio::join!(
        ctx.request(Method::GET, format!("{pid}/pipelines/{n}"), Opts::not_found(t("Пайплайн #{0} не найден — возможно, его удалили", &[&n]))),
        ctx.fetch_all(format!("{pid}/pipelines/{n}/jobs"), 3),
        ctx.fetch_all(format!("{pid}/pipelines/{n}/bridges"), 1),
    );
    let p = p?;
    let jobs = jobs?;
    let bridges = bridges.unwrap_or_default();
    let all: Vec<GlJob> = jobs.iter().map(|j| job_summary(j, "job")).chain(bridges.iter().map(|b| job_summary(b, "bridge"))).collect();
    // Порядок этапов — по самому раннему заданию этапа: GitLab создаёт задания по порядку этапов
    let mut order: Vec<Option<String>> = Vec::new();
    let mut first: HashMap<Option<String>, f64> = HashMap::new();
    for job in &all {
        let id = job.id.as_ref().map_or(f64::INFINITY, CiId::number);
        match first.get_mut(&job.stage) {
            Some(current) => *current = current.min(id),
            None => {
                first.insert(job.stage.clone(), id);
                order.push(job.stage.clone());
            }
        }
    }
    order.sort_by(|a, b| first[a].total_cmp(&first[b]));
    let stages = order
        .into_iter()
        .map(|name| {
            let mut list: Vec<GlJob> = all.iter().filter(|job| job.stage == name).cloned().collect();
            list.sort_by(|a, b| js::locale_cmp_numeric(a.name.as_deref().unwrap_or_default(), b.name.as_deref().unwrap_or_default()));
            GlStage { status: aggregate(list.iter().map(|job| (job.status.as_deref(), job.allow_failure))), name, jobs: list }
        })
        .collect();
    let pipeline = GlPipelineFull {
        summary: pipeline_summary(&p),
        user: field(&p, "user").filter(|u| crate::json::truthy(u)).map(|u| GlUser { name: text(u, "name"), username: text(u, "username"), avatar_url: text(u, "avatar_url") }),
        duration: number(&p, "duration"),
        queued_duration: number(&p, "queued_duration"),
        started_at: text(&p, "started_at"),
        finished_at: text(&p, "finished_at"),
        coverage: raw(&p, "coverage"),
        yaml_errors: raw(&p, "yaml_errors"),
        detailed_status: p.get("detailed_status").and_then(|status| text(status, "text")),
        before_sha: text(&p, "before_sha"),
    };
    Ok(GlPipelineDetail { project: ctx.project.clone(), can_write: ctx.can_write(), pipeline, stages })
}

pub(crate) fn check_job_id(id: &CiId) -> Result<()> {
    if id.is_positive_integer() { Ok(()) } else { Err(bad_args(t("Некорректный номер задания", &[]))) }
}

pub(crate) async fn gl_job_log(ctx: &GlCtx, id: &CiId) -> Result<GlJobLog> {
    let n = id.number_text();
    let pid = ctx.project_path();
    let (job, trace) = tokio::join!(
        ctx.request(Method::GET, format!("{pid}/jobs/{n}"), Opts::not_found(t("Задание #{0} не найдено — возможно, его удалили", &[&n]))),
        super::http::request_text(&ctx.client, &ctx.remote.base, &ctx.token, format!("{pid}/jobs/{n}/trace")),
    );
    let job = job?;
    let trace = match trace {
        Ok(trace) => trace,
        Err(error) if error.code == ErrorCode::NotFound => crate::http::LogChunk::default(),
        Err(error) => return Err(error),
    };
    Ok(GlJobLog { job: job_summary(&job, "job"), truncated: trace.size > crate::http::MAX_LOG as u64, text: trace.text, size: trace.size })
}

pub(crate) fn check_action(action: &ActionRequest) -> Result<()> {
    let known = matches!(action.kind.as_deref(), Some("job.retry" | "job.cancel" | "job.play" | "pipeline.retry" | "pipeline.cancel" | "pipeline.create"));
    if !known {
        return Err(bad_args(t("Неизвестное действие", &[])));
    }
    if action.kind.as_deref() == Some("pipeline.create") {
        if action.reference.as_deref().is_none_or(|reference| js::trim(reference).is_empty()) {
            return Err(bad_args(t("Не указана ветка", &[])));
        }
    } else if !action.id.as_ref().is_some_and(CiId::is_positive_integer) {
        return Err(bad_args(t("Некорректный номер", &[])));
    }
    Ok(())
}

pub(crate) async fn gl_action(ctx: &GlCtx, action: &ActionRequest) -> Result<GlActionResult> {
    if !ctx.can_write() {
        return Err(GorynychError::new(ErrorCode::Forbidden, t("Токен только для чтения", &[])).with_hint(t("Для запуска и отмены нужен токен со scope «api» — создайте новый и сохраните его", &[])));
    }
    let pid = ctx.project_path();
    let id = action.id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
    let (path, body) = match action.kind.as_deref().unwrap_or_default() {
        "job.retry" => (format!("{pid}/jobs/{id}/retry"), None),
        "job.cancel" => (format!("{pid}/jobs/{id}/cancel"), None),
        "job.play" => (format!("{pid}/jobs/{id}/play"), None),
        "pipeline.retry" => (format!("{pid}/pipelines/{id}/retry"), None),
        "pipeline.cancel" => (format!("{pid}/pipelines/{id}/cancel"), None),
        _ => (format!("{pid}/pipeline"), Some(json!({ "ref": action.reference }))),
    };
    let result = ctx.request(Method::POST, &path, Opts { body, ..Opts::default() }).await?;
    Ok(GlActionResult { kind: action.kind.clone(), id: CiId::field(&result, "id").or_else(|| action.id.clone()), status: text(&result, "status"), web_url: text(&result, "web_url") })
}

pub(crate) async fn gl_list_variables(ctx: &GlCtx) -> Result<GlVariableList> {
    let vars = ctx.fetch_all(format!("{}/variables", ctx.project_path()), 3).await?;
    let variables = vars
        .iter()
        .map(|v| GlVariable {
            key: text(v, "key"),
            kind: text(v, "variable_type"),
            protected: flag(v, "protected"),
            masked: flag(v, "masked"),
            hidden: flag(v, "hidden"),
            raw: flag(v, "raw"),
            scope: text(v, "environment_scope").unwrap_or_else(|| "*".to_owned()),
            description: text(v, "description"),
            empty: match v.get("value") {
                None | Some(Value::Null) => true,
                Some(Value::String(value)) => value.is_empty(),
                _ => false,
            },
        })
        .collect();
    Ok(GlVariableList { project: ctx.project.clone(), variables })
}

/* ---------- Проверка входных данных ---------- */

static VAR_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[A-Za-z0-9_]+$").expect("корректный шаблон"));
static CRON: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!("^(?:[^{0}]+[{0}]+){{4}}[^{0}]+$", js::WHITESPACE_CLASS)).expect("корректный шаблон"));
static MR_EXISTS: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)already exists|уже существует").expect("корректный шаблон"));
static MR_NO_BRANCH: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)source.?branch|does not exist|не существует").expect("корректный шаблон"));

/// Имя переменной годится: `/^[A-Za-z0-9_]+$/`, причём JS-шаблон допускает перевод строки только внутри запрещённых символов.
pub(crate) fn valid_var_key(key: &str) -> bool {
    VAR_KEY.is_match(key)
}

fn scope_query(scope: Option<&str>) -> Opts {
    Opts::query(&[("filter[environment_scope]", scope.filter(|scope| *scope != "*").map(str::to_owned))])
}

fn str_value(value: Option<&Json>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_owned)
}

fn variable_body(v: &GlVariableInput, value: Option<String>) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("key".into(), json!(v.key));
    body.insert("variable_type".into(), json!(if v.kind.as_deref() == Some("file") { "file" } else { "env_var" }));
    body.insert("protected".into(), json!(v.protected));
    body.insert("masked".into(), json!(v.masked || v.hidden));
    body.insert("raw".into(), json!(v.raw));
    body.insert("environment_scope".into(), json!(body_scope(v)));
    body.insert("description".into(), json!(v.description.clone().unwrap_or_default()));
    if let Some(value) = value {
        body.insert("value".into(), json!(value));
    }
    body
}

fn body_scope(v: &GlVariableInput) -> String {
    v.scope.as_deref().map(js::trim).filter(|scope| !scope.is_empty()).unwrap_or("*").to_owned()
}

impl CicdService {
    /// `listPipelines`.
    pub async fn gitlab_pipelines(&self, root: &Path, reference: Option<&str>, preferred: Option<&str>) -> Result<GlPipelineList> {
        gl_list_pipelines(&self.gitlab_context(root, preferred).await?, reference).await
    }

    /// `pipelineDetail`.
    pub async fn gitlab_pipeline(&self, root: &Path, id: &CiId, preferred: Option<&str>) -> Result<GlPipelineDetail> {
        check_pipeline_id(id)?;
        gl_pipeline_detail(&self.gitlab_context(root, preferred).await?, id).await
    }

    /// `jobLog`.
    pub async fn gitlab_job_log(&self, root: &Path, id: &CiId, preferred: Option<&str>) -> Result<GlJobLog> {
        check_job_id(id)?;
        gl_job_log(&self.gitlab_context(root, preferred).await?, id).await
    }

    /// `runPipelineAction`.
    pub async fn gitlab_action(&self, root: &Path, action: &ActionRequest, preferred: Option<&str>) -> Result<GlActionResult> {
        check_action(action)?;
        gl_action(&self.gitlab_context(root, preferred).await?, action).await
    }

    /// `listVariables`.
    pub async fn gitlab_variables(&self, root: &Path, preferred: Option<&str>) -> Result<GlVariableList> {
        gl_list_variables(&self.gitlab_context(root, preferred).await?).await
    }

    /// `variableValue`.
    pub async fn gitlab_variable_value(&self, root: &Path, variable: &GlVariableRef, preferred: Option<&str>) -> Result<GlVariableValue> {
        let key = variable.key.as_ref().and_then(Value::as_str).filter(|key| valid_var_key(key)).ok_or_else(|| bad_args(t("Некорректное имя переменной", &[])))?;
        let ctx = self.gitlab_context(root, preferred).await?;
        let opts = scope_query(variable.scope.as_deref()).with_not_found(t("Переменная {0} не найдена — возможно, её удалили", &[&key]));
        let v = ctx.request(Method::GET, format!("{}/variables/{key}", ctx.project_path()), opts).await?;
        let value = field(&v, "value").filter(|_| !crate::json::flag(&v, "hidden"));
        Ok(GlVariableValue { key: key.to_owned(), hidden: value.is_none(), value: value.map(crate::json::js_string) })
    }

    /// `listRunners`: простой список панели GitLab.
    pub async fn gitlab_runners(&self, root: &Path, preferred: Option<&str>) -> Result<GlRunnerList> {
        let ctx = self.gitlab_context(root, preferred).await?;
        let runners = ctx.fetch_all(format!("{}/runners", ctx.project_path()), 1).await?;
        let runners = runners
            .iter()
            .map(|r| {
                let id = CiId::field(r, "id");
                let fallback = format!("#{}", id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string));
                GlRunner {
                    description: crate::json::non_empty(r, "description").or_else(|| crate::json::non_empty(r, "name")).unwrap_or(fallback),
                    status: text(r, "status").unwrap_or_else(|| if flag(r, "online") { "online" } else { "offline" }.to_owned()),
                    paused: crate::json::opt_bool(r, "paused").unwrap_or(r.get("active").and_then(Value::as_bool) == Some(false)),
                    shared: flag(r, "is_shared"),
                    kind: text(r, "runner_type"),
                    id,
                }
            })
            .collect();
        Ok(GlRunnerList { project: ctx.project.clone(), runners })
    }

    /// `lintCi`.
    pub async fn gitlab_lint(&self, root: &Path, draft: &GlLintRequest, preferred: Option<&str>) -> Result<GlLintResult> {
        let content = draft.content.as_ref().and_then(Value::as_str).ok_or_else(|| bad_args(t("Нет содержимого", &[])))?;
        let ctx = self.gitlab_context(root, preferred).await?;
        let mut body = json!({ "content": content, "dry_run": true, "include_jobs": true });
        if let Some(reference) = draft.reference.as_deref().filter(|reference| !reference.is_empty()) {
            body["ref"] = json!(reference);
        }
        let opts = Opts::body(body).with_not_found(t("Этот сервер GitLab не поддерживает проверку CI по API (нужен GitLab 13.6 или новее)", &[]));
        let res = ctx.request(Method::POST, format!("{}/ci/lint", ctx.project_path()), opts).await?;
        Ok(GlLintResult {
            valid: flag(&res, "valid"),
            errors: strings(&res, "errors"),
            warnings: strings(&res, "warnings"),
            jobs: items(&res, "jobs")
                .iter()
                .map(|j| GlLintJob {
                    name: text(j, "name"),
                    stage: text(j, "stage"),
                    when: text(j, "when").unwrap_or_else(|| "on_success".to_owned()),
                    allow_failure: flag(j, "allow_failure"),
                    tags: strings(j, "tag_list"),
                    environment: raw(j, "environment"),
                })
                .collect(),
            includes: items(&res, "includes").iter().map(|i| GlLintInclude { kind: text(i, "type"), location: text(i, "location"), blob: text(i, "blob") }).collect(),
            reference: draft.reference.clone(),
        })
    }

    /// `saveVariable`.
    pub async fn gitlab_save_variable(&self, root: &Path, args: &GlVariableSave, preferred: Option<&str>) -> Result<GlVariableSaved> {
        let empty = GlVariableInput::default();
        let v = args.variable.as_ref().unwrap_or(&empty);
        self.save_variable_raw(root, args.original.as_ref(), v, preferred).await.map_err(|mut error| {
            // GitLab отвечает на неподходящее значение просто «value is invalid»: подсказываем, в чём дело
            if error.code == ErrorCode::Validation && (v.masked || v.hidden) && error.details.to_lowercase().contains("value") && error.hint.is_none() {
                error.hint = Some(masked_hint());
            }
            error
        })
    }

    async fn save_variable_raw(&self, root: &Path, original: Option<&GlVariableOriginal>, v: &GlVariableInput, preferred: Option<&str>) -> Result<GlVariableSaved> {
        if !v.key.as_deref().is_some_and(valid_var_key) {
            return Err(GorynychError::new(ErrorCode::InvalidName, t("Имя переменной: только латинские буквы, цифры и _", &[])));
        }
        let new_value = str_value(v.value.as_ref());
        if new_value.as_deref().is_some_and(|value| js::utf16_len(value) > 10_000) {
            return Err(bad_args(t("Значение слишком длинное", &[])));
        }
        let ctx = self.gitlab_context(root, preferred).await?;
        ctx.require_write()?;
        let base = format!("{}/variables", ctx.project_path());
        let scope = Some(body_scope(v));

        let Some(original) = original else {
            let Some(value) = new_value else {
                return Err(bad_args(t("Введите значение", &[])));
            };
            let mut body = variable_body(v, Some(value));
            if v.hidden {
                body.insert("masked_and_hidden".into(), json!(true));
            }
            ctx.request(Method::POST, &base, Opts::body(Value::Object(body))).await?;
            return Ok(GlVariableSaved { key: v.key.clone(), scope, created: Some(true), ..GlVariableSaved::default() });
        };

        let original_key = original.key.as_deref().unwrap_or("undefined");
        // Значение не меняли, но GitLab всё равно требует его в запросе: берём текущее
        let value = match new_value {
            Some(value) => value,
            None => {
                let current = ctx.request(Method::GET, format!("{base}/{original_key}"), scope_query(original.scope.as_deref())).await?;
                match field(&current, "value").filter(|_| !flag(&current, "hidden")) {
                    Some(value) => crate::json::js_string(value),
                    None => return Err(bad_args(t("Значение скрытой переменной нельзя прочитать — введите его заново", &[]))),
                }
            }
        };
        let body = Value::Object(variable_body(v, Some(value)));
        // Имя или окружение поменялись: GitLab не умеет переименовывать, поэтому создаём новую и удаляем старую
        if Some(original_key) != v.key.as_deref() || original.scope.as_deref().unwrap_or("*") != body_scope(v) {
            ctx.request(Method::POST, &base, Opts::body(body)).await?;
            ctx.request(Method::DELETE, format!("{base}/{original_key}"), scope_query(original.scope.as_deref())).await?;
            return Ok(GlVariableSaved { key: v.key.clone(), scope, renamed: Some(true), ..GlVariableSaved::default() });
        }
        let mut opts = scope_query(original.scope.as_deref());
        opts.body = Some(body);
        ctx.request(Method::PUT, format!("{base}/{original_key}"), opts).await?;
        Ok(GlVariableSaved { key: v.key.clone(), scope, updated: Some(true), ..GlVariableSaved::default() })
    }

    /// `deleteVariable`.
    pub async fn gitlab_delete_variable(&self, root: &Path, variable: &GlVariableRef, preferred: Option<&str>) -> Result<GlVariableSaved> {
        let key = variable.key.as_ref().and_then(Value::as_str).filter(|key| valid_var_key(key)).ok_or_else(|| bad_args(t("Некорректное имя переменной", &[])))?;
        let ctx = self.gitlab_context(root, preferred).await?;
        ctx.require_write()?;
        let opts = scope_query(variable.scope.as_deref()).with_not_found(t("Переменная {0} уже удалена", &[&key]));
        ctx.request(Method::DELETE, format!("{}/variables/{key}", ctx.project_path()), opts).await?;
        Ok(GlVariableSaved { key: Some(key.to_owned()), scope: Some(variable.scope.clone().unwrap_or_else(|| "*".to_owned())), deleted: Some(true), ..GlVariableSaved::default() })
    }

    /// `listSchedules`.
    pub async fn gitlab_schedules(&self, root: &Path, preferred: Option<&str>) -> Result<GlScheduleList> {
        let ctx = self.gitlab_context(root, preferred).await?;
        let base = format!("{}/pipeline_schedules", ctx.project_path());
        let list = ctx.fetch_all(&base, 1).await?;
        // В списке нет последнего запуска: подгружаем подробности, их обычно немного
        let detailed = join_all(list.iter().take(30).map(|s| {
            let (ctx, base) = (&ctx, &base);
            async move {
                let id = CiId::field(s, "id").map_or_else(|| "undefined".to_owned(), |id| id.to_string());
                ctx.request(Method::GET, format!("{base}/{id}"), Opts::default()).await.unwrap_or_else(|_| s.clone())
            }
        }))
        .await;
        let web_url = format!("{}/-/pipeline_schedules", ctx.project.web_url.as_deref().unwrap_or("undefined"));
        let schedules = detailed.iter().map(|s| GlSchedule { web_url: Some(web_url.clone()), ..schedule_summary(s) }).collect();
        Ok(GlScheduleList { project: ctx.project.clone(), can_write: ctx.can_write(), me: ctx.meta.user.as_ref().and_then(|user| user.username.clone()), schedules })
    }

    /// `saveSchedule`.
    pub async fn gitlab_save_schedule(&self, root: &Path, s: &GlScheduleInput, preferred: Option<&str>) -> Result<GlSchedule> {
        let trimmed = |value: &Option<String>| js::trim(value.as_deref().unwrap_or_default()).to_owned();
        let (description, reference, cron) = (trimmed(&s.description), trimmed(&s.reference), trimmed(&s.cron));
        if description.is_empty() {
            return Err(bad_args(t("Введите описание расписания", &[])));
        }
        if reference.is_empty() {
            return Err(bad_args(t("Выберите ветку", &[])));
        }
        if !CRON.is_match(&cron) {
            return Err(bad_args(t("Неверный формат cron", &[])).with_hint(t("Пять полей через пробел: минуты часы день месяц день_недели, например «0 3 * * *»", &[])));
        }
        let ctx = self.gitlab_context(root, preferred).await?;
        ctx.require_write()?;
        let body = json!({
            "description": description,
            "ref": reference,
            "cron": cron,
            "cron_timezone": s.timezone.as_deref().filter(|zone| !zone.is_empty()).unwrap_or("UTC"),
            "active": s.active != Some(false),
        });
        let base = format!("{}/pipeline_schedules", ctx.project_path());
        let existing = s.id.as_ref().filter(|id| id.number() != 0.0 && !id.number().is_nan() && !matches!(id, CiId::Text(text) if text.is_empty()));
        let res = match existing {
            Some(id) => ctx.request(Method::PUT, format!("{base}/{}", id.number_text()), Opts::body(body).with_not_found(t("Расписание не найдено — возможно, его удалили", &[]))).await?,
            None => ctx.request(Method::POST, &base, Opts::body(body)).await?,
        };
        Ok(schedule_summary(&res))
    }

    /// `scheduleAction`.
    pub async fn gitlab_schedule_action(&self, root: &Path, action: &GlScheduleAction, preferred: Option<&str>) -> Result<GlScheduleActionResult> {
        let id = action.id.as_ref().filter(|id| id.is_positive_integer()).ok_or_else(|| bad_args(t("Некорректный номер расписания", &[])))?;
        let n = id.number() as i64;
        let ctx = self.gitlab_context(root, preferred).await?;
        ctx.require_write()?;
        let base = format!("{}/pipeline_schedules/{n}", ctx.project_path());
        let not_found = || Opts::not_found(t("Расписание не найдено — возможно, его удалили", &[]));
        let kind = action.kind.as_deref().unwrap_or_default();
        match kind {
            "delete" => ctx.request(Method::DELETE, &base, not_found()).await?,
            "play" => ctx.request(Method::POST, format!("{base}/play"), not_found()).await?,
            "own" => ctx.request(Method::POST, format!("{base}/take_ownership"), not_found()).await?,
            _ => return Err(bad_args(t("Неизвестное действие", &[]))),
        };
        Ok(GlScheduleActionResult { id: n, kind: kind.to_owned() })
    }

    /// `createMergeRequest`.
    pub async fn gitlab_create_merge_request(&self, root: &Path, mr: &GlMergeRequestInput, preferred: Option<&str>) -> Result<GlMergeRequest> {
        for (value, what) in [(&mr.source, t("исходная ветка", &[])), (&mr.target, t("целевая ветка", &[]))] {
            if value.as_deref().is_none_or(|value| js::trim(value).is_empty() || value.starts_with('-')) {
                return Err(bad_args(t("Не указана {0}", &[&what])));
            }
        }
        let (source, target) = (mr.source.as_deref().unwrap_or_default(), mr.target.as_deref().unwrap_or_default());
        if source == target {
            return Err(bad_args(t("Исходная и целевая ветки совпадают", &[])));
        }
        let ctx = self.gitlab_context(root, preferred).await?;
        ctx.require_write()?;
        let trimmed = js::trim(mr.title.as_deref().unwrap_or_default());
        let title = if trimmed.is_empty() { source } else { trimmed };
        let is_draft = title.get(..6).is_some_and(|head| head.eq_ignore_ascii_case("draft:"));
        let base = format!("{}/merge_requests", ctx.project_path());
        let body = json!({
            "source_branch": source,
            "target_branch": target,
            "title": if mr.draft && !is_draft { format!("Draft: {title}") } else { title.to_owned() },
            "description": mr.description.clone().unwrap_or_default(),
            "remove_source_branch": mr.remove_source,
        });
        match ctx.request(Method::POST, &base, Opts::body(body)).await {
            Ok(created) => Ok(GlMergeRequest { iid: CiId::field(&created, "iid"), web_url: text(&created, "web_url"), created: true, title: text(&created, "title") }),
            Err(mut error) => {
                // MR для этой ветки уже есть: просто открываем его
                if error.code == ErrorCode::Validation && MR_EXISTS.is_match(&format!("{} {}", error.details, error.message)) {
                    let opts = Opts::query(&[("state", Some("opened".into())), ("source_branch", Some(source.to_owned())), ("target_branch", Some(target.to_owned()))]);
                    let list = ctx.request(Method::GET, &base, opts).await.unwrap_or(Value::Array(Vec::new()));
                    if let Some(first) = list.get(0) {
                        return Ok(GlMergeRequest { iid: CiId::field(first, "iid"), web_url: text(first, "web_url"), created: false, title: text(first, "title") });
                    }
                }
                if error.code == ErrorCode::Validation && MR_NO_BRANCH.is_match(&error.details) {
                    error.hint = Some(t("Сначала отправьте ветку на сервер (Push).", &[]));
                }
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cron_has_five_fields() {
        assert!(CRON.is_match("0 3 * * *"));
        assert!(CRON.is_match("0  3\t* * MON"));
        assert!(!CRON.is_match("0 3 * *"));
        assert!(!CRON.is_match("0 3 * * * *"));
        assert!(!CRON.is_match(""));
    }

    #[test]
    fn variable_key() {
        assert!(valid_var_key("A_1"));
        assert!(!valid_var_key("a-b"));
        assert!(!valid_var_key(""));
        assert!(!valid_var_key("ключ"));
    }
}
