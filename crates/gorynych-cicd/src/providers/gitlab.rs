//! Адаптер GitLab CI: `electron/cicd/gitlab.cjs`. Поверх [`crate::gitlab`] — раннеры, артефакты и запуск с переменными.
//!
//! ## Конспект
//! - Возможности: действия при scope `api`, раннеры — от роли Maintainer (уровень 40), если роль неизвестна — разрешено.
//! - Статус раннера: `paused` или `active === false` → `paused`; иначе `status` (или `online`), всё, кроме `online`, — `offline`; выполняющий задание раннер — `busy`.
//! - Подробности раннера: `/runners/:id`, `/managers`, `/jobs?status=running`; ошибка любого запроса не мешает. Последний менеджер — по `contacted_at`. Пачками по 8.
//! - `editable`: `project_type` всегда; иначе только если подробности получены и это не `instance_type`.
//! - `registrationToken`: `POST /user/runners`, при 404 (старый GitLab) — `runners_token` проекта.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use async_trait::async_trait;
use futures_util::future::join_all;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_storage::repo_providers::CiProvider;
use regex::Regex;
use reqwest::Method;
use serde_json::{Map, Value, json};

use super::{CapsInput, CiCdProvider, Ctx, DetailData, RegistrationRequest};
use crate::gitlab::{GlCtx, GlJob, GlPipelineFull, GlPipelineSummary, check_action, check_job_id, check_pipeline_id, gl_action, gl_job_log, gl_list_pipelines, gl_list_variables, gl_pipeline_detail, valid_var_key};
use crate::http::{Downloaded, HttpCtx, Opts, download};
use crate::json::{field, flag, iso, js_string, non_empty, number, opt_bool, strings, text, truthy};
use crate::models::*;

pub struct GitlabProvider;

fn gl(ctx: &Ctx) -> &GlCtx {
    ctx.gitlab.as_ref().expect("контекст GitLab собирает сервис")
}

fn pipeline_from_summary(p: &GlPipelineSummary) -> PipelineRun {
    PipelineRun {
        id: p.id.clone(),
        number: None,
        iid: p.iid.clone(),
        name: p.name.clone(),
        status: p.status.clone(),
        branch: p.reference.clone(),
        sha: p.sha.clone(),
        created_at: p.created_at.clone(),
        url: p.web_url.clone(),
        source: p.source.clone(),
        ..PipelineRun::default()
    }
}

fn pipeline_from_full(p: &GlPipelineFull) -> PipelineRun {
    PipelineRun {
        started_at: p.started_at.clone(),
        finished_at: p.finished_at.clone(),
        duration: p.duration.clone(),
        queued_duration: p.queued_duration.clone(),
        triggered_by: p.user.as_ref().map(|user| CiActor { name: user.name.clone(), username: user.username.clone() }),
        coverage: p.coverage.clone(),
        yaml_errors: p.yaml_errors.clone(),
        ..pipeline_from_summary(&p.summary)
    }
}

fn norm_job(j: &GlJob) -> PipelineJob {
    PipelineJob {
        id: j.id.clone(),
        kind: j.kind.clone(),
        name: j.name.clone(),
        stage: j.stage.clone(),
        status: j.status.clone(),
        runner_name: j.runner.as_ref().and_then(|runner| runner.description.clone()),
        runner_id: j.runner.as_ref().and_then(|runner| runner.id.clone()),
        runner_tags: j.tags.clone(),
        started_at: j.started_at.clone(),
        finished_at: j.finished_at.clone(),
        duration: j.duration.clone(),
        queued_duration: j.queued_duration.clone(),
        url: j.web_url.clone(),
        logs_url: j.web_url.clone(),
        allow_failure: j.allow_failure,
        failure_reason: j.failure_reason.clone(),
        steps: Vec::new(),
        manual: j.status.as_deref() == Some("manual"),
        when: j.when.clone(),
        coverage: j.coverage.clone(),
        triggered_by: j.user.clone(),
        downstream: j.downstream.as_ref().map(|down| Downstream { id: down.id.clone(), status: down.status.clone(), web_url: down.web_url.clone(), project_id: down.project_id.clone(), url: down.web_url.clone() }),
        artifacts: Some(j.artifacts.clone()),
        ..PipelineJob::default()
    }
}

static BAD_FILE_CHARS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[\\/:*?"<>|]+"#).expect("корректный шаблон"));

fn runner_status(r: &Value) -> &'static str {
    if flag(r, "paused") || r.get("active").and_then(Value::as_bool) == Some(false) {
        return "paused";
    }
    let online = match field(r, "status") {
        Some(status) => status.as_str() == Some("online"),
        None => flag(r, "online"),
    };
    if online { "online" } else { "offline" }
}

async fn runner_detail(ctx: &GlCtx, r: &Value) -> Result<CiRunner> {
    let id = CiId::field(r, "id");
    let id_text = id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
    let running_query = async {
        if runner_status(r) == "online" {
            ctx.request(Method::GET, format!("/runners/{id_text}/jobs"), Opts::query(&[("status", Some("running".into())), ("per_page", Some("1".into()))])).await.ok()
        } else {
            None
        }
    };
    let (detail, managers, jobs) = tokio::join!(ctx.request(Method::GET, format!("/runners/{id_text}"), Opts::default()), ctx.request(Method::GET, format!("/runners/{id_text}/managers"), Opts::default()), running_query);
    let detail = detail.ok();
    let d = detail.as_ref().unwrap_or(r);
    let manager = managers.ok().and_then(|list| {
        let mut list = list.as_array()?.clone();
        // Стабильная сортировка по `String(contacted_at)`: `null` становится словом, как в JS
        let stamp = |item: &Value| item.get("contacted_at").map_or_else(|| "undefined".to_owned(), js_string);
        list.sort_by(|a, b| gorynych_core::js::locale_cmp(&stamp(b), &stamp(a)));
        list.into_iter().next()
    });
    let m = manager.as_ref();
    let running = jobs.as_ref().and_then(|list| list.get(0)).filter(|item| truthy(item));
    let mut status = runner_status(d);
    if status == "online" && running.is_some() {
        status = "busy";
    }
    let either = |key: &str| m.and_then(|item| text(item, key)).or_else(|| text(d, key));
    let platform = either("platform");
    let architecture = either("architecture");
    let runner_type = text(d, "runner_type");
    let is_project = runner_type.as_deref() == Some("project_type");
    let is_instance = runner_type.as_deref() == Some("instance_type");
    Ok(crate::models::runner(RunnerFields {
        name: non_empty(d, "description").or_else(|| non_empty(d, "name")).or_else(|| Some(format!("#{id_text}"))),
        status: Some(status.to_owned()),
        editable: Some(is_project || (detail.is_some() && !is_instance)),
        id,
        runner: CiRunner {
            description: text(d, "description"),
            is_shared: flag(d, "is_shared") || is_instance,
            os: if platform.as_deref() == Some("darwin") { Some("macos".to_owned()) } else { platform },
            architecture: if architecture.as_deref() == Some("amd64") { Some("x64".to_owned()) } else { architecture },
            labels: strings(d, "tag_list"),
            version: either("version"),
            ip_address: either("ip_address"),
            current_job_id: running.and_then(|item| CiId::field(item, "id")),
            current_job: running.map(|item| RunnerJob { id: CiId::field(item, "id"), name: text(item, "name"), pipeline_id: item.get("pipeline").and_then(|pipeline| CiId::field(pipeline, "id")), url: text(item, "web_url") }),
            kind: runner_type,
            run_untagged: opt_bool(d, "run_untagged"),
            locked: opt_bool(d, "locked"),
            maximum_timeout: number(d, "maximum_timeout"),
            contacted_at: iso(m.and_then(|item| field(item, "contacted_at")).or_else(|| field(d, "contacted_at")))?,
            stale: text(d, "status").as_deref() == Some("stale") || text(r, "status").as_deref() == Some("stale"),
            ..CiRunner::default()
        },
    }))
}

#[async_trait]
impl CiCdProvider for GitlabProvider {
    fn id(&self) -> CiProvider {
        CiProvider::Gitlab
    }

    fn label(&self) -> &'static str {
        "GitLab CI"
    }

    fn capabilities(&self, input: CapsInput) -> Capabilities {
        let write = input.can_write.unwrap_or(true);
        let maintainer = input.access_level.unwrap_or(40) >= 40;
        let manage = write && maintainer;
        let why: BTreeMap<String, String> = if !write {
            ["canRunPipeline", "canCancel", "canRetry", "canRetryFailed", "canEditRunnerLabels", "canPauseRunner", "canDeleteRunner", "canCreateRunnerToken"]
                .iter()
                .map(|key| ((*key).to_owned(), t("Токен только для чтения (read_api) — для действий нужен scope «api»", &[])))
                .collect()
        } else if !maintainer {
            ["canEditRunnerLabels", "canPauseRunner", "canEditRunnerSettings", "canDeleteRunner", "canCreateRunnerToken"].iter().map(|key| ((*key).to_owned(), t("Раннеры проекта меняет роль Maintainer и выше", &[]))).collect()
        } else {
            BTreeMap::new()
        };
        Capabilities {
            can_list_pipelines: true,
            can_run_pipeline: write,
            can_run_with_inputs: write,
            can_run_with_variables: write,
            can_cancel: write,
            can_retry: write,
            can_retry_failed: write,
            can_rerun_single_job: write,
            can_cancel_job: write,
            can_play_manual_job: write,
            can_download_artifacts: true,
            can_list_runners: true,
            can_edit_runner_labels: manage,
            can_pause_runner: manage,
            can_edit_runner_settings: manage,
            can_delete_runner: manage,
            can_create_runner_token: manage,
            can_manage_secrets: true,
            can_manage_variables: true,
            has_schedules: true,
            has_stages: true,
            local_runner: manage,
            why: Some(why),
        }
    }

    async fn list_pipelines(&self, ctx: &Ctx, reference: Option<&str>) -> Result<PipelineList> {
        let data = gl_list_pipelines(gl(ctx), reference).await?;
        let pipelines: Vec<PipelineRun> = data.pipelines.iter().map(pipeline_from_summary).collect();
        Ok(PipelineList { by_sha: by_sha(&pipelines), pipelines, can_write: data.can_write })
    }

    async fn pipeline_detail(&self, ctx: &Ctx, id: &CiId) -> Result<DetailData> {
        check_pipeline_id(id)?;
        let glc = gl(ctx);
        let data = gl_pipeline_detail(glc, id).await?;
        let project = glc.project_path();
        let artifacts = data
            .stages
            .iter()
            .flat_map(|stage| &stage.jobs)
            .filter(|job| job.kind == "job" && job.artifacts.iter().any(|file| file.kind.as_deref() == Some("archive")))
            .map(|job| {
                let name = job.name.clone().unwrap_or_default();
                let job_id = job.id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
                CiArtifact {
                    id: job.id.clone(),
                    job_id: job.id.clone(),
                    job_name: job.name.clone(),
                    file_name: Some(format!("{}-artifacts.zip", BAD_FILE_CHARS.replace_all(&name, "_"))),
                    name: Some(name),
                    size: job.artifacts.iter().find(|file| file.kind.as_deref() == Some("archive")).and_then(|file| file.size.clone()),
                    expired: false,
                    download_url: Some(format!("{project}/jobs/{job_id}/artifacts")),
                    created_at: None,
                }
            })
            .collect();
        Ok(DetailData {
            pipeline: Some(pipeline_from_full(&data.pipeline)),
            jobs: data.stages.iter().flat_map(|stage| stage.jobs.iter().map(norm_job)).collect(),
            stage_order: Some(data.stages.iter().map(|stage| stage.name.clone()).collect()),
            sequential: false,
            artifacts,
            can_write: data.can_write,
        })
    }

    async fn job_log(&self, ctx: &Ctx, id: &CiId, _pipeline_id: Option<&CiId>) -> Result<JobLog> {
        check_job_id(id)?;
        let data = gl_job_log(gl(ctx), id).await?;
        Ok(JobLog { job: Some(norm_job(&data.job)), text: data.text, size: data.size, truncated: data.truncated, unavailable: None })
    }

    async fn action(&self, ctx: &Ctx, action: &ActionRequest) -> Result<ActionResult> {
        let mut request = action.clone();
        if request.kind.as_deref() == Some("pipeline.retry-failed") {
            request.kind = Some("pipeline.retry".to_owned());
        }
        check_action(&request)?;
        let result = gl_action(gl(ctx), &request).await?;
        Ok(ActionResult { kind: result.kind.unwrap_or_default(), id: result.id, status: result.status, web_url: result.web_url })
    }

    async fn run_pipeline(&self, ctx: &Ctx, input: &RunInput) -> Result<RunResult> {
        let glc = gl(ctx);
        if !glc.can_write() {
            return Err(GorynychError::new(ErrorCode::Forbidden, t("Токен только для чтения", &[])).with_hint(t("Для запуска нужен токен со scope «api»", &[])));
        }
        let vars: Vec<&RunVariable> = input.variables.iter().filter(|v| v.key.as_deref().is_some_and(|key| !key.is_empty())).collect();
        if let Some(bad) = vars.iter().find(|v| !valid_var_key(v.key.as_deref().unwrap_or_default())) {
            let key = bad.key.as_deref().unwrap_or_default();
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректное имя переменной: {0}", &[&key])).with_hint(t("Только латинские буквы, цифры и _", &[])));
        }
        let mut body = Map::new();
        body.insert("ref".into(), json!(input.reference));
        if !vars.is_empty() {
            let list: Vec<Value> = vars
                .iter()
                .map(|v| json!({ "key": v.key, "value": v.value.as_ref().filter(|value| !value.is_null()).map_or_else(String::new, js_string), "variable_type": if v.file { "file" } else { "env_var" } }))
                .collect();
            body.insert("variables".into(), Value::Array(list));
        }
        if !input.inputs.is_empty() {
            body.insert("inputs".into(), Value::Object(input.inputs.clone()));
        }
        let res = glc.request(Method::POST, format!("{}/pipeline", glc.project_path()), Opts::body(Value::Object(body))).await?;
        Ok(RunResult { id: CiId::field(&res, "id"), url: text(&res, "web_url") })
    }

    async fn list_runners(&self, ctx: &Ctx) -> Result<Vec<CiRunner>> {
        let glc = gl(ctx);
        let list = glc.fetch_all(format!("{}/runners", glc.project_path()), 1).await?;
        let mut out = Vec::with_capacity(list.len());
        for chunk in list.chunks(8) {
            for runner in join_all(chunk.iter().map(|r| runner_detail(glc, r))).await {
                out.push(runner?);
            }
        }
        Ok(out)
    }

    async fn update_runner(&self, ctx: &Ctx, id: &CiId, patch: &RunnerPatch) -> Result<RunnerResult> {
        let mut body = Map::new();
        if let Some(labels) = &patch.labels {
            let names: Vec<String> = labels.iter().map(|tag| gorynych_core::js::trim(&js_string(tag)).to_owned()).filter(|tag| !tag.is_empty()).collect();
            body.insert("tag_list".into(), json!(names.join(",")));
        }
        if let Some(paused) = patch.paused {
            body.insert("paused".into(), json!(paused));
        }
        if let Some(value) = patch.run_untagged {
            body.insert("run_untagged".into(), json!(value));
        }
        if let Some(value) = patch.locked {
            body.insert("locked".into(), json!(value));
        }
        if let Some(value) = &patch.description {
            body.insert("description".into(), json!(value));
        }
        if let Some(timeout) = &patch.maximum_timeout {
            let number = match timeout {
                None => None,
                Some(Value::String(text)) if text.is_empty() => None,
                Some(Value::Number(number)) => number.as_f64(),
                Some(Value::String(text)) => Some(text.trim().parse().unwrap_or(f64::NAN)),
                Some(_) => Some(f64::NAN),
            };
            if number.is_some_and(|value| !value.is_finite() || value.fract() != 0.0 || value < 600.0) {
                return Err(GorynychError::new(ErrorCode::BadArgs, t("Максимальный тайм-аут — не меньше 600 секунд (10 минут)", &[])));
            }
            body.insert("maximum_timeout".into(), number.map_or(Value::Null, |value| json!(value as i64)));
        }
        if body.get("run_untagged") == Some(&json!(false)) && body.get("tag_list") == Some(&json!("")) {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Раннер без тегов должен брать задания без тегов", &[])).with_hint(t("Добавьте тег или включите «Брать задания без тегов»", &[])));
        }
        let opts = Opts::body(Value::Object(body)).with_not_found(t("Раннер не найден или у вас нет прав его менять", &[]));
        gl(ctx).request(Method::PUT, format!("/runners/{}", id.number_text()), opts).await?;
        Ok(RunnerResult { id: Some(id.clone()) })
    }

    async fn delete_runner(&self, ctx: &Ctx, id: &CiId) -> Result<RunnerResult> {
        gl(ctx).request(Method::DELETE, format!("/runners/{}", id.number_text()), Opts::not_found(t("Раннер не найден — возможно, его уже удалили", &[]))).await?;
        Ok(RunnerResult { id: Some(id.clone()) })
    }

    async fn registration_token(&self, ctx: &Ctx, request: &RegistrationRequest) -> Result<RegistrationToken> {
        let glc = gl(ctx);
        let description = request.description.clone().filter(|text| !text.is_empty()).unwrap_or_else(|| t("git-Горыныч", &[]));
        let body = json!({
            "runner_type": "project_type",
            "project_id": glc.project.id,
            "description": description,
            "tag_list": request.labels.join(","),
            "run_untagged": request.run_untagged || request.labels.is_empty(),
            "locked": request.locked.unwrap_or(true),
            "paused": request.paused,
        });
        let url = Some(glc.remote.base.clone());
        match glc.request(Method::POST, "/user/runners", Opts::body(body)).await {
            Ok(res) => Ok(RegistrationToken { token: text(&res, "token"), runner_id: CiId::field(&res, "id"), expires_at: text(&res, "token_expires_at"), kind: "auth".to_owned(), url }),
            Err(error) if error.code == ErrorCode::NotFound => {
                let project = glc.request(Method::GET, &glc.project_path(), Opts::default()).await?;
                let Some(token) = non_empty(&project, "runners_token") else {
                    return Err(GorynychError::new(ErrorCode::Forbidden, t("Не удалось получить токен раннера", &[])).with_hint(t("Нужна роль Maintainer в проекте", &[])));
                };
                Ok(RegistrationToken { token: Some(token), runner_id: None, expires_at: None, kind: "registration".to_owned(), url })
            }
            Err(error) => Err(error),
        }
    }

    async fn download_artifact(&self, ctx: &Ctx, artifact: &ArtifactRef, dest: &Path) -> Result<Downloaded> {
        let glc = gl(ctx);
        let (name, value) = glc.token.header();
        let http = HttpCtx { client: glc.client.clone(), api_base: format!("{}/api/v4", glc.remote.base), headers: vec![(name, value)], label: "GitLab".to_owned(), scope_hint: None };
        let id = artifact.job_id.as_ref().or(artifact.id.as_ref()).map_or_else(|| "NaN".to_owned(), CiId::number_text);
        download(&http, &format!("{}/jobs/{id}/artifacts", glc.project_path()), dest, Opts::not_found(t("Артефакты задания удалены или истекли", &[]))).await
    }

    async fn list_secrets(&self, ctx: &Ctx) -> Result<Vec<CiSecretVariable>> {
        let data = gl_list_variables(gl(ctx)).await?;
        Ok(data
            .variables
            .into_iter()
            .map(|v| CiSecretVariable { key: v.key, secret: v.masked || v.hidden, masked: v.masked, environment_scope: Some(v.scope), protected: Some(v.protected), ..CiSecretVariable::default() })
            .collect())
    }
}
