//! Адаптер GitHub Actions: `electron/cicd/github.cjs` (github.com и GitHub Enterprise Server). Gitea наследует отсюда разбор запуска и задания.
//!
//! ## Конспект
//! - Права: `push` или `admin` — запуск и отмена; `admin` — раннеры и секреты. Нет `permissions` в ответе — разрешено.
//! - `workflow_dispatch` не возвращает номер запуска: до 4 раз ищем свежий запуск (младше минуты) этого workflow.
//! - Метки раннера: `read-only` не отправляются; пустой список — `DELETE`. Облачные раннеры github.com добавляются виртуальными: API их не перечисляет, а `runs-on` на них ссылается.
//! - Что делает занятый раннер: задания запусков `in_progress`, только когда есть занятые.
//! - Секрет шифруется `crypto_box_seal` ключом репозитория. Смена имени или типа — запись новой и удаление старой, ошибка удаления не мешает.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_storage::credentials::LegacyCiUser;
use gorynych_storage::repo_providers::CiProvider;
use reqwest::Method;
use serde_json::{Value, json};

use super::{CapsInput, CiCdProvider, Ctx, DetailData, RegistrationRequest};
use crate::http::{Downloaded, LogChunk, MAX_LOG, Opts, download, request, request_text};
use crate::json::{age_millis, field, flag, items, iso, iso_field, js_string, non_empty, number, seconds_between, strings, text};
use crate::models::*;

pub struct GithubProvider;

const HOSTED: [(&str, &str, &str); 13] = [
    ("ubuntu-latest", "linux", "x64"),
    ("ubuntu-24.04", "linux", "x64"),
    ("ubuntu-22.04", "linux", "x64"),
    ("ubuntu-24.04-arm", "linux", "arm64"),
    ("ubuntu-22.04-arm", "linux", "arm64"),
    ("windows-latest", "windows", "x64"),
    ("windows-2025", "windows", "x64"),
    ("windows-2022", "windows", "x64"),
    ("windows-11-arm", "windows", "arm64"),
    ("macos-latest", "macos", "arm64"),
    ("macos-15", "macos", "arm64"),
    ("macos-14", "macos", "arm64"),
    ("macos-13", "macos", "x64"),
];

/// Первая строка текста: `split('\n')[0]`.
pub(crate) fn first_line(text: &str) -> &str {
    text.split('\n').next().unwrap_or_default()
}

/// `run(r)`.
pub(crate) fn run(r: &Value) -> Result<PipelineRun> {
    let status = text(r, "status");
    let completed = status.as_deref() == Some("completed");
    let started = field(r, "run_started_at").or_else(|| field(r, "created_at"));
    let actor = field(r, "triggering_actor").filter(|item| crate::json::truthy(item)).or_else(|| field(r, "actor").filter(|item| crate::json::truthy(item)));
    Ok(PipelineRun {
        id: CiId::field(r, "id"),
        number: CiId::field(r, "run_number"),
        name: non_empty(r, "display_title").or_else(|| non_empty(r, "name")).or_else(|| r.get("head_commit").and_then(|commit| text(commit, "message")).map(|message| first_line(&message).to_owned()).filter(|line| !line.is_empty())),
        workflow: text(r, "name"),
        workflow_path: non_empty(r, "path").map(|path| path.split_once('@').map_or(path.as_str(), |(head, _)| head).to_owned()),
        workflow_id: CiId::field(r, "workflow_id"),
        status: Some(github_status(status.as_deref(), text(r, "conclusion").as_deref()).to_owned()),
        branch: text(r, "head_branch"),
        sha: text(r, "head_sha"),
        created_at: iso_field(r, "created_at")?,
        started_at: iso(started)?,
        finished_at: if completed { iso_field(r, "updated_at")? } else { None },
        duration: if completed { seconds_between(started, field(r, "updated_at")).map(serde_json::Number::from) } else { None },
        url: text(r, "html_url").or_else(|| text(r, "url")),
        triggered_by: actor.map(|item| CiActor { name: text(item, "login"), username: text(item, "login") }),
        source: text(r, "event"),
        attempt: Some(number(r, "run_attempt").and_then(|attempt| attempt.as_i64()).unwrap_or(1)),
        ..PipelineRun::default()
    })
}

/// `job(j)`.
pub(crate) fn job(j: &Value) -> Result<PipelineJob> {
    let mut steps = Vec::new();
    for s in items(j, "steps") {
        steps.push(PipelineStep {
            number: number(s, "number"),
            name: text(s, "name"),
            status: github_status(text(s, "status").as_deref(), text(s, "conclusion").as_deref()).to_owned(),
            started_at: iso_field(s, "started_at")?,
            duration: seconds_between(field(s, "started_at"), field(s, "completed_at")),
        });
    }
    Ok(PipelineJob {
        id: CiId::field(j, "id"),
        kind: "job".to_owned(),
        name: text(j, "name"),
        status: Some(github_status(text(j, "status").as_deref(), text(j, "conclusion").as_deref()).to_owned()),
        runner_name: non_empty(j, "runner_name"),
        runner_tags: strings(j, "labels"),
        started_at: iso_field(j, "started_at")?,
        finished_at: iso_field(j, "completed_at")?,
        duration: seconds_between(field(j, "started_at"), field(j, "completed_at")).map(serde_json::Number::from),
        url: text(j, "html_url"),
        logs_url: text(j, "html_url"),
        steps,
        run_id: CiId::field(j, "run_id"),
        ..PipelineJob::default()
    })
}

/// Запуски из `workflow_runs`.
pub(crate) fn runs_of(data: &Value) -> Result<Vec<PipelineRun>> {
    items(data, "workflow_runs").iter().map(run).collect()
}

/// `init`: права в репозитории.
pub(crate) async fn init_repo(ctx: &mut Ctx) -> Result<()> {
    let opts = Opts::not_found(t("Репозиторий {0}/{1} не найден или у токена нет к нему доступа", &[&ctx.owner, &ctx.repo]));
    let r = request(&ctx.http, Method::GET, &ctx.repo_api(), opts).await?;
    let perms = field(&r, "permissions").filter(|item| crate::json::truthy(item));
    ctx.can_write = Some(perms.is_none_or(|perms| flag(perms, "push") || flag(perms, "admin")));
    ctx.is_admin = Some(perms.is_none_or(|perms| flag(perms, "admin")));
    ctx.default_branch = text(&r, "default_branch");
    if let Some(url) = text(&r, "html_url") {
        ctx.web_url = Some(url);
    }
    Ok(())
}

fn artifact_of(ctx: &Ctx, a: &Value) -> Result<CiArtifact> {
    let id = CiId::field(a, "id");
    let name = text(a, "name");
    Ok(CiArtifact {
        download_url: Some(format!("{}/actions/artifacts/{}/zip", ctx.repo_api(), id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string))),
        file_name: Some(format!("{}.zip", name.as_deref().unwrap_or("undefined"))),
        id,
        job_id: None,
        job_name: None,
        name,
        size: number(a, "size_in_bytes"),
        expired: flag(a, "expired"),
        created_at: iso_field(a, "created_at")?,
    })
}

/// Артефакты из ответа.
pub(crate) fn artifacts_of(ctx: &Ctx, data: &Value) -> Result<Vec<CiArtifact>> {
    items(data, "artifacts").iter().map(|a| artifact_of(ctx, a)).collect()
}

/// `{ k: String(v ?? '') }`.
pub(crate) fn inputs_as_text(input: &RunInput) -> Value {
    let map: serde_json::Map<String, Value> = input.inputs.iter().map(|(key, value)| (key.clone(), json!(if value.is_null() { String::new() } else { js_string(value) }))).collect();
    Value::Object(map)
}

fn runner_of(r: &Value, busy: &HashMap<String, RunnerJob>) -> CiRunner {
    let labels: Vec<String> = items(r, "labels").iter().map(|label| field(label, "name").map_or_else(|| js_string(label), js_string)).collect();
    let read_only: Vec<String> = items(r, "labels").iter().filter(|label| matches!(text(label, "type").as_deref(), Some("read-only" | "default"))).filter_map(|label| text(label, "name")).collect();
    let (os, architecture) = platform_from_labels(&labels, text(r, "os").as_deref());
    let name = text(r, "name");
    let job = name.as_ref().and_then(|name| busy.get(name)).cloned();
    let is_busy = flag(r, "busy");
    let status = if text(r, "status").as_deref() == Some("online") {
        if is_busy { "busy" } else { "online" }
    } else if is_busy {
        "busy"
    } else {
        "offline"
    };
    crate::models::runner(RunnerFields {
        id: CiId::field(r, "id"),
        name,
        status: Some(status.to_owned()),
        editable: None,
        runner: CiRunner {
            os,
            architecture: architecture.map(str::to_owned),
            labels,
            read_only_labels: read_only,
            version: text(r, "version"),
            kind: Some("self-hosted".to_owned()),
            current_job_id: job.as_ref().and_then(|job| job.id.clone()),
            current_job: job,
            ..CiRunner::default()
        },
    })
}

async fn busy_jobs(ctx: &Ctx) -> HashMap<String, RunnerJob> {
    let mut map = HashMap::new();
    let api = ctx.repo_api();
    let runs = request(&ctx.http, Method::GET, format!("{api}/actions/runs"), Opts::query(&[("status", Some("in_progress".into())), ("per_page", Some("10".into()))])).await.unwrap_or(Value::Null);
    for r in items(&runs, "workflow_runs") {
        let run_id = CiId::field(r, "id");
        let id_text = run_id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
        let jobs = request(&ctx.http, Method::GET, format!("{api}/actions/runs/{id_text}/jobs"), Opts::query(&[("per_page", Some("100".into()))])).await.unwrap_or(Value::Null);
        for j in items(&jobs, "jobs") {
            if let Some(runner_name) = non_empty(j, "runner_name")
                && text(j, "status").as_deref() == Some("in_progress")
            {
                map.insert(runner_name, RunnerJob { id: CiId::field(j, "id"), name: text(j, "name"), pipeline_id: run_id.clone(), url: text(j, "html_url") });
            }
        }
    }
    map
}

fn hosted_runners(ctx: &Ctx) -> Vec<CiRunner> {
    if ctx.host != "github.com" {
        return Vec::new();
    }
    HOSTED
        .iter()
        .map(|(name, os, arch)| {
            crate::models::runner(RunnerFields {
                id: Some(CiId::Text(format!("hosted:{name}"))),
                name: Some((*name).to_owned()),
                status: Some("online".to_owned()),
                editable: None,
                runner: CiRunner { is_shared: true, os: Some((*os).to_owned()), architecture: Some((*arch).to_owned()), labels: vec![(*name).to_owned()], kind: Some("github-hosted".to_owned()), is_virtual: true, ..CiRunner::default() },
            })
        })
        .collect()
}

/// Название файла workflow: `path.posix.basename`.
fn base_name(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or_default()
}

#[async_trait]
impl CiCdProvider for GithubProvider {
    fn id(&self) -> CiProvider {
        CiProvider::Github
    }

    fn label(&self) -> &'static str {
        "GitHub Actions"
    }

    fn capabilities(&self, input: CapsInput) -> Capabilities {
        let write = input.can_write != Some(false);
        let admin = input.is_admin != Some(false);
        let mut why: BTreeMap<String, String> = reasons("GitHub", &["canPauseRunner", "canEditRunnerSettings", "canRunWithVariables", "canCancelJob", "canPlayManualJob"]);
        why.insert("canRunWithVariables".into(), t("GitHub запускает workflow только с входными параметрами (inputs) — переменные окружения задаются в самом workflow", &[]));
        why.insert("canPauseRunner".into(), t("У GitHub нет паузы раннера — остановите службу раннера на сервере", &[]));
        if !admin {
            why.insert("canListRunners".into(), t("Раннеры и секреты видны только администраторам репозитория", &[]));
        }
        Capabilities {
            can_list_pipelines: true,
            can_run_pipeline: write,
            can_run_with_inputs: write,
            can_cancel: write,
            can_retry: write,
            can_retry_failed: write,
            can_rerun_single_job: write,
            can_download_artifacts: true,
            can_list_runners: admin,
            can_edit_runner_labels: admin,
            can_delete_runner: admin,
            can_create_runner_token: admin,
            can_manage_secrets: admin,
            can_manage_variables: admin,
            local_runner: admin,
            why: Some(why),
            ..Capabilities::default()
        }
    }

    async fn init(&self, ctx: &mut Ctx) -> Result<()> {
        init_repo(ctx).await
    }

    async fn whoami(&self, ctx: &Ctx) -> Result<Option<LegacyCiUser>> {
        let u = request(&ctx.http, Method::GET, "/user", Opts::default()).await?;
        Ok(Some(LegacyCiUser { username: text(&u, "login"), name: text(&u, "name").or_else(|| text(&u, "login")), avatar_url: text(&u, "avatar_url") }))
    }

    async fn list_pipelines(&self, ctx: &Ctx, reference: Option<&str>) -> Result<PipelineList> {
        let opts = Opts::query(&[("per_page", Some("60".into())), ("branch", reference.map(str::to_owned))]);
        let data = request(&ctx.http, Method::GET, format!("{}/actions/runs", ctx.repo_api()), opts).await?;
        let pipelines = runs_of(&data)?;
        Ok(PipelineList { by_sha: by_sha(&pipelines), pipelines, can_write: ctx.write_allowed() })
    }

    async fn pipeline_detail(&self, ctx: &Ctx, id: &CiId) -> Result<DetailData> {
        let run_id = id.number_text();
        let api = ctx.repo_api();
        let (r, jobs, arts) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{run_id}"), Opts::not_found(t("Запуск #{0} не найден — возможно, его удалили", &[&run_id]))),
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{run_id}/jobs"), Opts::query(&[("per_page", Some("100".into())), ("filter", Some("latest".into()))])),
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{run_id}/artifacts"), Opts::query(&[("per_page", Some("100".into()))])),
        );
        let (r, jobs) = (r?, jobs?);
        let artifacts = arts.and_then(|data| artifacts_of(ctx, &data)).unwrap_or_default();
        Ok(DetailData { pipeline: Some(run(&r)?), jobs: items(&jobs, "jobs").iter().map(job).collect::<Result<_>>()?, artifacts, can_write: ctx.write_allowed(), ..DetailData::default() })
    }

    async fn job_log(&self, ctx: &Ctx, id: &CiId, _pipeline_id: Option<&CiId>) -> Result<JobLog> {
        let n = id.number_text();
        let api = ctx.repo_api();
        let (j, log) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/actions/jobs/{n}"), Opts::not_found(t("Задание #{0} не найдено", &[&n]))),
            request_text(&ctx.http, Method::GET, format!("{api}/actions/jobs/{n}/logs"), Opts::default()),
        );
        let j = j?;
        let log = match log {
            Err(error) if matches!(error.code, ErrorCode::NotFound | ErrorCode::Validation) => LogChunk::default(),
            other => other?,
        };
        Ok(JobLog { job: Some(job(&j)?), truncated: log.size > MAX_LOG as u64, text: log.text, size: log.size, unavailable: None })
    }

    async fn action(&self, ctx: &Ctx, a: &ActionRequest) -> Result<ActionResult> {
        let base = ctx.repo_api();
        let id = a.id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
        let path = match a.kind.as_deref().unwrap_or_default() {
            "pipeline.cancel" => format!("{base}/actions/runs/{id}/cancel"),
            "pipeline.retry" => format!("{base}/actions/runs/{id}/rerun"),
            "pipeline.retry-failed" => format!("{base}/actions/runs/{id}/rerun-failed-jobs"),
            "job.retry" => format!("{base}/actions/jobs/{id}/rerun"),
            _ => return Err(GorynychError::new(ErrorCode::Unsupported, t("GitHub не поддерживает это действие", &[]))),
        };
        request(&ctx.http, Method::POST, &path, Opts::body(json!({}))).await?;
        Ok(ActionResult { kind: a.kind.clone().unwrap_or_default(), id: a.id.clone(), status: None, web_url: None })
    }

    async fn run_pipeline(&self, ctx: &Ctx, input: &RunInput) -> Result<RunResult> {
        let Some(workflow) = input.workflow.as_deref().filter(|workflow| !workflow.is_empty()) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Выберите workflow для запуска", &[])));
        };
        let file = base_name(workflow);
        let encoded = js::encode_uri_component(file);
        let api = ctx.repo_api();
        let body = json!({ "ref": input.reference, "inputs": inputs_as_text(input) });
        let opts = Opts::body(body).with_not_found(t("Workflow {0} не найден на сервере — он закоммичен и отправлен в ветку по умолчанию?", &[&file]));
        request(&ctx.http, Method::POST, format!("{api}/actions/workflows/{encoded}/dispatches"), opts).await?;
        // GitHub не возвращает номер запуска: ищем свежий запуск этого workflow
        for attempt in 0..4 {
            tokio::time::sleep(Duration::from_millis(if attempt == 0 { 600 } else { 1500 })).await;
            let query = Opts::query(&[("per_page", Some("1".into())), ("branch", Some(input.reference.clone())), ("event", Some("workflow_dispatch".into()))]);
            let data = request(&ctx.http, Method::GET, format!("{api}/actions/workflows/{encoded}/runs"), query).await.unwrap_or(Value::Null);
            if let Some(found) = items(&data, "workflow_runs").first().filter(|found| age_millis(field(found, "created_at")).is_some_and(|age| age < 60_000)) {
                return Ok(RunResult { id: CiId::field(found, "id"), url: text(found, "html_url") });
            }
        }
        Ok(RunResult { id: None, url: None })
    }

    async fn list_runners(&self, ctx: &Ctx) -> Result<Vec<CiRunner>> {
        let data = request(&ctx.http, Method::GET, format!("{}/actions/runners", ctx.repo_api()), Opts::query(&[("per_page", Some("100".into()))])).await?;
        let list = items(&data, "runners");
        let busy = if list.iter().any(|r| flag(r, "busy")) { busy_jobs(ctx).await } else { HashMap::new() };
        let mut out: Vec<CiRunner> = list.iter().map(|r| runner_of(r, &busy)).collect();
        out.extend(hosted_runners(ctx));
        Ok(out)
    }

    async fn update_runner(&self, ctx: &Ctx, id: &CiId, patch: &RunnerPatch) -> Result<RunnerResult> {
        let path = format!("{}/actions/runners/{id}", ctx.repo_api());
        if let Some(labels) = &patch.labels {
            let current = request(&ctx.http, Method::GET, &path, Opts::default()).await?;
            let read_only: Vec<String> = items(&current, "labels").iter().filter(|label| text(label, "type").as_deref() == Some("read-only")).filter_map(|label| text(label, "name")).map(|name| name.to_lowercase()).collect();
            let mut custom: Vec<String> = Vec::new();
            for label in labels {
                let label = js::trim(&js_string(label)).to_owned();
                if !label.is_empty() && !read_only.contains(&label.to_lowercase()) && !custom.contains(&label) {
                    custom.push(label);
                }
            }
            if custom.is_empty() {
                request(&ctx.http, Method::DELETE, format!("{path}/labels"), Opts::default()).await?;
            } else {
                request(&ctx.http, Method::PUT, format!("{path}/labels"), Opts::body(json!({ "labels": custom }))).await?;
            }
        }
        let unsupported: Vec<&str> = [
            ("paused", patch.paused.is_some()),
            ("runUntagged", patch.run_untagged.is_some()),
            ("locked", patch.locked.is_some()),
            ("description", patch.description.is_some()),
            ("maximumTimeout", patch.maximum_timeout.is_some()),
        ]
        .iter()
        .filter(|(_, present)| *present)
        .map(|(name, _)| *name)
        .collect();
        if !unsupported.is_empty() {
            return Err(GorynychError::new(ErrorCode::Unsupported, t("GitHub не позволяет менять эти настройки раннера", &[])).with_hint(unsupported.join(", ")));
        }
        Ok(RunnerResult { id: Some(id.clone()) })
    }

    async fn delete_runner(&self, ctx: &Ctx, id: &CiId) -> Result<RunnerResult> {
        request(&ctx.http, Method::DELETE, format!("{}/actions/runners/{id}", ctx.repo_api()), Opts::not_found(t("Раннер уже удалён", &[]))).await?;
        Ok(RunnerResult { id: Some(id.clone()) })
    }

    async fn registration_token(&self, ctx: &Ctx, _request: &RegistrationRequest) -> Result<RegistrationToken> {
        let res = request(&ctx.http, Method::POST, format!("{}/actions/runners/registration-token", ctx.repo_api()), Opts::body(json!({}))).await?;
        Ok(RegistrationToken { token: text(&res, "token"), runner_id: None, expires_at: text(&res, "expires_at"), kind: "registration".to_owned(), url: ctx.web_url.clone() })
    }

    async fn download_artifact(&self, ctx: &Ctx, artifact: &ArtifactRef, dest: &Path) -> Result<Downloaded> {
        let id = artifact.id.as_ref().map_or_else(|| "NaN".to_owned(), CiId::number_text);
        download(&ctx.http, &format!("{}/actions/artifacts/{id}/zip", ctx.repo_api()), dest, Opts::default()).await
    }

    async fn list_secrets(&self, ctx: &Ctx) -> Result<Vec<CiSecretVariable>> {
        let api = ctx.repo_api();
        let (s, v) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/actions/secrets"), Opts::query(&[("per_page", Some("100".into()))])),
            request(&ctx.http, Method::GET, format!("{api}/actions/variables"), Opts::query(&[("per_page", Some("30".into()))])),
        );
        let s = s?;
        let v = v.unwrap_or(Value::Null);
        let mut out = Vec::new();
        for x in items(&s, "secrets") {
            out.push(CiSecretVariable { key: text(x, "name"), secret: true, masked: true, environment_scope: Some("*".into()), updated_at: iso(field(x, "updated_at").or_else(|| field(x, "created_at")))?, ..CiSecretVariable::default() });
        }
        for x in items(&v, "variables") {
            out.push(CiSecretVariable { key: text(x, "name"), environment_scope: Some("*".into()), value: Some(text(x, "value").unwrap_or_default()), updated_at: iso(field(x, "updated_at").or_else(|| field(x, "created_at")))?, ..CiSecretVariable::default() });
        }
        Ok(out)
    }

    async fn save_secret(&self, ctx: &Ctx, input: &SecretInput) -> Result<SecretResult> {
        let base = ctx.repo_api();
        let key = js::encode_uri_component(&input.key);
        let unchanged_variable = input.original.as_ref().is_some_and(|original| original.key.as_deref() == Some(&input.key) && !original.secret);
        if input.secret {
            let pk = request(&ctx.http, Method::GET, format!("{base}/actions/secrets/public-key"), Opts::default()).await?;
            let sealed = crate::seal::seal(text(&pk, "key").as_deref().unwrap_or_default(), &input.value)?;
            let body = json!({ "encrypted_value": sealed, "key_id": pk.get("key_id") });
            request(&ctx.http, Method::PUT, format!("{base}/actions/secrets/{key}"), Opts::body(body)).await?;
        } else if unchanged_variable {
            request(&ctx.http, Method::PATCH, format!("{base}/actions/variables/{key}"), Opts::body(json!({ "name": input.key, "value": input.value }))).await?;
        } else {
            request(&ctx.http, Method::POST, format!("{base}/actions/variables"), Opts::body(json!({ "name": input.key, "value": input.value }))).await?;
        }
        if let Some(original) = input.original.as_ref().filter(|original| original.key.as_deref() != Some(&input.key) || original.secret != input.secret) {
            let _ = self.delete_secret(ctx, original).await;
        }
        Ok(SecretResult { key: Some(input.key.clone()) })
    }

    async fn delete_secret(&self, ctx: &Ctx, secret: &SecretRef) -> Result<SecretResult> {
        delete_actions_secret(ctx, secret).await
    }
}

/// Удаление секрета или переменной: одинаково у GitHub и Gitea.
pub(crate) async fn delete_actions_secret(ctx: &Ctx, secret: &SecretRef) -> Result<SecretResult> {
    let section = if secret.secret { "secrets" } else { "variables" };
    let key = js::encode_uri_component(secret.key.as_deref().unwrap_or("undefined"));
    request(&ctx.http, Method::DELETE, format!("{}/actions/{section}/{key}", ctx.repo_api()), Opts::default()).await?;
    Ok(SecretResult { key: secret.key.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_name_like_posix() {
        assert_eq!(base_name(".github/workflows/ci.yml"), "ci.yml");
        assert_eq!(base_name("ci.yml"), "ci.yml");
        assert_eq!(base_name("a/b/"), "b");
    }

    #[test]
    fn hosted_runners_are_virtual_and_read_only() {
        let runner = crate::models::runner(RunnerFields { id: Some(CiId::Text("x".into())), runner: CiRunner { is_virtual: true, ..CiRunner::default() }, ..RunnerFields::default() });
        assert!(!runner.editable);
    }
}
