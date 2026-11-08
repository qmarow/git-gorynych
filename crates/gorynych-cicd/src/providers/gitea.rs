//! Адаптер Gitea / Forgejo Actions: `electron/cicd/gitea.cjs`. API похоже на GitHub, но умеет меньше: нет отмены и перезапуска, метки раннера задаются при регистрации.
//!
//! ## Конспект
//! - Старые версии (1.22–1.23) не отдают список запусков: при 404 берутся задания `/actions/tasks` и группируются по номеру запуска.
//! - Метка `ubuntu-latest:docker://node:20` — имя до двоеточия. Раннер с меткой `docker://` без другой ОС — `os: docker`.
//! - Запись токена раннера: `POST`, при `NOT_FOUND`, `VALIDATION` или `API_ERROR` — `GET`.
//! - Секреты: `PUT {data}`; новая переменная — `POST /variables/:key {value}`, изменение — `PUT {name, value}`.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_storage::credentials::LegacyCiUser;
use gorynych_storage::repo_providers::CiProvider;
use regex::Regex;
use reqwest::Method;
use serde_json::{Value, json};

use super::github::{artifacts_of, delete_actions_secret, init_repo, inputs_as_text, job, run};
use super::{CapsInput, CiCdProvider, Ctx, DetailData, RegistrationRequest};
use crate::http::{Downloaded, MAX_LOG, Opts, download, request, request_text};
use crate::json::{field, flag, items, iso, js_string, non_empty, text};
use crate::models::*;

pub struct GiteaProvider;

static JOB_SUFFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/jobs/[0-9]+$").expect("корректный шаблон"));

fn gitea_run(r: &Value) -> Result<PipelineRun> {
    Ok(PipelineRun { workflow_file: text(r, "workflow_id"), ..run(r)? })
}

async fn legacy_tasks(ctx: &Ctx) -> Result<Vec<Value>> {
    let data = request(&ctx.http, Method::GET, format!("{}/actions/tasks", ctx.repo_api()), Opts::query(&[("limit", Some("50".into()))])).await?;
    Ok(items(&data, "workflow_runs").to_vec())
}

fn task_key(task: &Value) -> Option<CiId> {
    CiId::field(task, "run_number").or_else(|| CiId::field(task, "id"))
}

async fn legacy_runs(ctx: &Ctx, reference: Option<&str>) -> Result<Vec<PipelineRun>> {
    let tasks = legacy_tasks(ctx).await?;
    let mut runs: Vec<(Option<CiId>, PipelineRun, Vec<Value>)> = Vec::new();
    for task in tasks {
        if reference.is_some_and(|name| !name.is_empty() && text(&task, "head_branch").as_deref() != Some(name)) {
            continue;
        }
        let key = task_key(&task);
        match runs.iter_mut().find(|(id, _, _)| *id == key) {
            Some((_, _, jobs)) => jobs.push(task),
            None => {
                let run = PipelineRun { id: key.clone(), number: key.clone(), ..gitea_run(&task)? };
                runs.push((key, run, vec![task]));
            }
        }
    }
    Ok(runs
        .into_iter()
        .map(|(_, run, jobs)| {
            let statuses: Vec<&'static str> = jobs.iter().map(|task| github_status(text(task, "status").as_deref(), None)).collect();
            let url = jobs.first().and_then(|task| text(task, "url")).map(|url| JOB_SUFFIX.replace(&url, "").into_owned());
            PipelineRun { status: Some(aggregate(statuses.iter().map(|status| (Some(*status), false)))), url: url.or(run.url.clone()), ..run }
        })
        .collect())
}

#[async_trait]
impl CiCdProvider for GiteaProvider {
    fn id(&self) -> CiProvider {
        CiProvider::Gitea
    }

    fn label(&self) -> &'static str {
        "Gitea / Forgejo Actions"
    }

    fn capabilities(&self, input: CapsInput) -> Capabilities {
        let write = input.can_write != Some(false);
        let admin = input.is_admin != Some(false);
        let mut why: BTreeMap<String, String> = reasons("Gitea", &["canCancel", "canRetry", "canRetryFailed", "canRerunSingleJob", "canCancelJob", "canPlayManualJob", "canRunWithVariables"]);
        why.insert("canEditRunnerLabels".into(), t("В Gitea метки раннера задаются при регистрации (act_runner register --labels) или в его config.yaml", &[]));
        why.insert("canPauseRunner".into(), t("В Gitea нет паузы раннера — остановите act_runner на сервере", &[]));
        why.insert("canEditRunnerSettings".into(), t("Gitea не даёт менять настройки раннера через API", &[]));
        Capabilities {
            can_list_pipelines: true,
            can_run_pipeline: write,
            can_run_with_inputs: write,
            can_download_artifacts: true,
            can_list_runners: admin,
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
        let username = text(&u, "login").or_else(|| text(&u, "username"));
        let name = non_empty(&u, "full_name").or_else(|| non_empty(&u, "login")).or_else(|| text(&u, "username"));
        Ok(Some(LegacyCiUser { username, name, avatar_url: text(&u, "avatar_url") }))
    }

    async fn list_pipelines(&self, ctx: &Ctx, reference: Option<&str>) -> Result<PipelineList> {
        let opts = Opts::query(&[("limit", Some("50".into())), ("branch", reference.map(str::to_owned))]);
        let pipelines = match request(&ctx.http, Method::GET, format!("{}/actions/runs", ctx.repo_api()), opts).await {
            Ok(data) => items(&data, "workflow_runs").iter().map(gitea_run).collect::<Result<Vec<_>>>()?,
            Err(error) if error.code == ErrorCode::NotFound => legacy_runs(ctx, reference).await?,
            Err(error) => return Err(error),
        };
        Ok(PipelineList { by_sha: by_sha(&pipelines), pipelines, can_write: ctx.write_allowed() })
    }

    async fn pipeline_detail(&self, ctx: &Ctx, id: &CiId) -> Result<DetailData> {
        let n = id.number_text();
        let api = ctx.repo_api();
        let (r, jobs, arts) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{n}"), Opts::not_found(t("Запуск #{0} не найден", &[id]))),
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{n}/jobs"), Opts::query(&[("limit", Some("100".into()))])),
            request(&ctx.http, Method::GET, format!("{api}/actions/runs/{n}/artifacts"), Opts::default()),
        );
        let error = match r {
            Ok(r) => {
                let jobs = jobs.unwrap_or(Value::Null);
                let artifacts = arts.and_then(|data| artifacts_of(ctx, &data)).unwrap_or_default();
                return Ok(DetailData { pipeline: Some(gitea_run(&r)?), jobs: items(&jobs, "jobs").iter().map(job).collect::<Result<_>>()?, artifacts, can_write: ctx.write_allowed(), ..DetailData::default() });
            }
            Err(error) if error.code == ErrorCode::NotFound => error,
            Err(error) => return Err(error),
        };
        // Старая Gitea: собираем запуск из заданий
        let target = id.number();
        let tasks: Vec<Value> = legacy_tasks(ctx).await?.into_iter().filter(|task| task_key(task).is_some_and(|key| matches!(key, CiId::Number(_)) && key.number() == target)).collect();
        if tasks.is_empty() {
            return Err(error);
        }
        let pipeline = legacy_runs(ctx, None).await?.into_iter().find(|p| matches!(p.id, Some(CiId::Number(_))) && p.id.as_ref().is_some_and(|key| key.number() == target));
        let mut list = Vec::with_capacity(tasks.len());
        for task in &tasks {
            let shaped = json!({ "id": task.get("id"), "name": task.get("name"), "status": task.get("status"), "started_at": task.get("run_started_at"), "completed_at": task.get("updated_at"), "html_url": task.get("url") });
            list.push(PipelineJob { log_unavailable: Some(true), ..job(&shaped)? });
        }
        Ok(DetailData { pipeline, jobs: list, can_write: ctx.write_allowed(), ..DetailData::default() })
    }

    async fn job_log(&self, ctx: &Ctx, id: &CiId, _pipeline_id: Option<&CiId>) -> Result<JobLog> {
        let n = id.number_text();
        let api = ctx.repo_api();
        let found = request(&ctx.http, Method::GET, format!("{api}/actions/jobs/{n}"), Opts::default()).await.ok();
        let (log, missing) = match request_text(&ctx.http, Method::GET, format!("{api}/actions/jobs/{n}/logs"), Opts::default()).await {
            Ok(log) => (log, false),
            Err(error) if error.code == ErrorCode::NotFound => (crate::http::LogChunk::default(), true),
            Err(error) => return Err(error),
        };
        let job_value = found.as_ref().filter(|value| crate::json::truthy(value)).map(job).transpose()?;
        let unavailable = Some(missing && job_value.is_none());
        Ok(JobLog { job: job_value, truncated: log.size > MAX_LOG as u64, text: log.text, size: log.size, unavailable })
    }

    async fn action(&self, _ctx: &Ctx, _action: &ActionRequest) -> Result<ActionResult> {
        Err(GorynychError::new(ErrorCode::Unsupported, t("Gitea не даёт отменять и перезапускать запуски через API", &[])).with_hint(t("Откройте запуск в браузере", &[])))
    }

    async fn run_pipeline(&self, ctx: &Ctx, input: &RunInput) -> Result<RunResult> {
        let Some(workflow) = input.workflow.as_deref().filter(|workflow| !workflow.is_empty()) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Выберите workflow для запуска", &[])));
        };
        let file = workflow.rsplit('/').next().unwrap_or_default();
        let opts = Opts::body(json!({ "ref": input.reference, "inputs": inputs_as_text(input) })).with_not_found(t("Запуск workflow по API поддерживается в Gitea 1.23 и новее (и workflow должен быть отправлен на сервер)", &[]));
        request(&ctx.http, Method::POST, format!("{}/actions/workflows/{}/dispatches", ctx.repo_api(), js::encode_uri_component(file)), opts).await?;
        Ok(RunResult { id: None, url: None })
    }

    async fn list_runners(&self, ctx: &Ctx) -> Result<Vec<CiRunner>> {
        let mut opts = Opts::query(&[("limit", Some("100".into()))]);
        opts.not_found = Some(t("Список раннеров по API есть в Gitea 1.24 и новее", &[]));
        let data = request(&ctx.http, Method::GET, format!("{}/actions/runners", ctx.repo_api()), opts).await?;
        let list = match (field(&data, "runners"), data.as_array()) {
            (Some(Value::Array(list)), _) => list.as_slice(),
            (_, Some(list)) => list.as_slice(),
            _ => &[],
        };
        let mut out = Vec::with_capacity(list.len());
        for r in list {
            let labels: Vec<String> = items(r, "labels").iter().map(|label| label.as_str().map_or_else(|| text(label, "name").unwrap_or_default(), str::to_owned)).collect();
            let names: Vec<String> = labels.iter().map(|label| label.split(':').next().unwrap_or_default().to_owned()).collect();
            let (os, architecture) = platform_from_labels(&labels, None);
            let status = text(r, "status").unwrap_or_default().to_lowercase();
            let state = if flag(r, "busy") || status == "active" || status == "busy" {
                "busy"
            } else if status == "online" || status == "idle" {
                "online"
            } else {
                "offline"
            };
            out.push(crate::models::runner(RunnerFields {
                id: CiId::field(r, "id"),
                name: text(r, "name"),
                status: Some(state.to_owned()),
                editable: None,
                runner: CiRunner {
                    os: os.or_else(|| labels.iter().any(|label| label.contains("docker://")).then(|| "docker".to_owned())),
                    architecture: architecture.map(str::to_owned),
                    labels: names,
                    version: text(r, "version"),
                    kind: Some(if flag(r, "ephemeral") { "ephemeral" } else { "repository" }.to_owned()),
                    contacted_at: iso(field(r, "last_online"))?,
                    ..CiRunner::default()
                },
            }));
        }
        Ok(out)
    }

    async fn update_runner(&self, _ctx: &Ctx, _id: &CiId, _patch: &RunnerPatch) -> Result<RunnerResult> {
        Err(GorynychError::new(ErrorCode::Unsupported, t("Gitea не даёт менять раннер через API", &[])).with_hint(t("Метки задаются в config.yaml раннера или при регистрации", &[])))
    }

    async fn delete_runner(&self, ctx: &Ctx, id: &CiId) -> Result<RunnerResult> {
        request(&ctx.http, Method::DELETE, format!("{}/actions/runners/{id}", ctx.repo_api()), Opts::not_found(t("Раннер уже удалён или Gitea не поддерживает удаление по API", &[]))).await?;
        Ok(RunnerResult { id: Some(id.clone()) })
    }

    async fn registration_token(&self, ctx: &Ctx, _request: &RegistrationRequest) -> Result<RegistrationToken> {
        let path = format!("{}/actions/runners/registration-token", ctx.repo_api());
        let res = match request(&ctx.http, Method::POST, &path, Opts::body(json!({}))).await {
            Ok(res) => res,
            Err(error) if matches!(error.code, ErrorCode::NotFound | ErrorCode::Validation | ErrorCode::ApiError) => request(&ctx.http, Method::GET, &path, Opts::default()).await?,
            Err(error) => return Err(error),
        };
        Ok(RegistrationToken { token: text(&res, "token"), runner_id: None, expires_at: None, kind: "registration".to_owned(), url: Some(ctx.site_base.clone()) })
    }

    async fn download_artifact(&self, ctx: &Ctx, artifact: &ArtifactRef, dest: &Path) -> Result<Downloaded> {
        let id = artifact.id.as_ref().map_or_else(|| "NaN".to_owned(), CiId::number_text);
        download(&ctx.http, &format!("{}/actions/artifacts/{id}/zip", ctx.repo_api()), dest, Opts::default()).await
    }

    async fn list_secrets(&self, ctx: &Ctx) -> Result<Vec<CiSecretVariable>> {
        let api = ctx.repo_api();
        let (s, v) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/actions/secrets"), Opts::query(&[("limit", Some("100".into()))])),
            request(&ctx.http, Method::GET, format!("{api}/actions/variables"), Opts::query(&[("limit", Some("100".into()))])),
        );
        let or_empty = |result: Result<Value>| match result {
            Err(error) if error.code == ErrorCode::NotFound => Ok(Value::Array(Vec::new())),
            other => other,
        };
        let (s, v) = (or_empty(s)?, or_empty(v)?);
        let list = |value: &Value, key: &str| value.as_array().cloned().unwrap_or_else(|| items(value, key).to_vec());
        let mut out = Vec::new();
        for x in list(&s, "secrets") {
            out.push(CiSecretVariable { key: text(&x, "name"), secret: true, masked: true, environment_scope: Some("*".into()), updated_at: iso(field(&x, "created_at").or_else(|| field(&x, "created")))?, ..CiSecretVariable::default() });
        }
        for x in list(&v, "variables") {
            let value = field(&x, "data").or_else(|| field(&x, "value")).map_or_else(String::new, js_string);
            out.push(CiSecretVariable { key: text(&x, "name"), environment_scope: Some("*".into()), value: Some(value), ..CiSecretVariable::default() });
        }
        Ok(out)
    }

    async fn save_secret(&self, ctx: &Ctx, input: &SecretInput) -> Result<SecretResult> {
        let base = ctx.repo_api();
        let key = js::encode_uri_component(&input.key);
        let unchanged_variable = input.original.as_ref().is_some_and(|original| original.key.as_deref() == Some(&input.key) && !original.secret);
        if input.secret {
            request(&ctx.http, Method::PUT, format!("{base}/actions/secrets/{key}"), Opts::body(json!({ "data": input.value }))).await?;
        } else if unchanged_variable {
            request(&ctx.http, Method::PUT, format!("{base}/actions/variables/{key}"), Opts::body(json!({ "name": input.key, "value": input.value }))).await?;
        } else {
            request(&ctx.http, Method::POST, format!("{base}/actions/variables/{key}"), Opts::body(json!({ "value": input.value }))).await?;
        }
        if let Some(original) = input.original.as_ref().filter(|original| original.key.as_deref() != Some(&input.key) || original.secret != input.secret) {
            let _ = delete_actions_secret(ctx, original).await;
        }
        Ok(SecretResult { key: Some(input.key.clone()) })
    }

    async fn delete_secret(&self, ctx: &Ctx, secret: &SecretRef) -> Result<SecretResult> {
        delete_actions_secret(ctx, secret).await
    }
}
