//! Адаптер Bitbucket Pipelines: `electron/cicd/bitbucket.cjs` (bitbucket.org, API 2.0). Шаги идут по порядку, каждый показывается этапом.
//! Раннеры и артефакты в публичном API недоступны. Bitbucket Data Center без своего адреса API — `UNSUPPORTED`: Pipelines там нет.

use std::sync::LazyLock;

use async_trait::async_trait;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use gorynych_storage::credentials::LegacyCiUser;
use gorynych_storage::repo_providers::CiProvider;
use regex::Regex;
use reqwest::Method;
use serde_json::{Map, Value, json};

use super::github::first_line;
use super::{CapsInput, CiCdProvider, Ctx, DetailData};
use crate::http::{LogChunk, MAX_LOG, Opts, request, request_text};
use crate::json::{field, flag, items, iso_field, js_string, number, strings, template, text};
use crate::models::*;

pub struct BitbucketProvider;

static VAR_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[A-Za-z_][A-Za-z0-9_]*$").expect("корректный шаблон"));

fn repo_api(ctx: &Ctx) -> String {
    format!("/repositories/{}/{}", ctx.owner, ctx.repo)
}

fn run_of(p: &Value, ctx: &Ctx) -> Result<PipelineRun> {
    let empty = json!({});
    let target = field(p, "target").unwrap_or(&empty);
    let selector = target.get("selector");
    let pattern = selector.and_then(|item| text(item, "pattern"));
    let build = CiId::field(p, "build_number");
    let build_text = build.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string);
    let web = ctx.web_url.as_deref().unwrap_or("undefined");
    Ok(PipelineRun {
        id: build.clone(),
        uuid: text(p, "uuid"),
        number: build,
        name: target.get("commit").and_then(|commit| text(commit, "message")).map(|message| first_line(&message).to_owned()).or_else(|| pattern.clone()),
        workflow: if selector.and_then(|item| text(item, "type")).as_deref() == Some("custom") { Some(format!("custom: {}", template(selector, "pattern"))) } else { pattern },
        status: Some(bitbucket_status(field(p, "state")).to_owned()),
        branch: text(target, "ref_name"),
        sha: target.get("commit").and_then(|commit| text(commit, "hash")),
        created_at: iso_field(p, "created_on")?,
        started_at: iso_field(p, "created_on")?,
        finished_at: iso_field(p, "completed_on")?,
        duration: number(p, "duration_in_seconds").or_else(|| number(p, "build_seconds_used")),
        url: Some(format!("{web}/pipelines/results/{build_text}")),
        triggered_by: field(p, "creator").filter(|item| crate::json::truthy(item)).map(|creator| CiActor { name: text(creator, "display_name"), username: text(creator, "nickname").or_else(|| text(creator, "username")) }),
        source: p.get("trigger").and_then(|trigger| text(trigger, "type")).filter(|kind| !kind.is_empty()).map(|kind| kind.strip_prefix("pipeline_trigger_").unwrap_or(&kind).to_owned()),
        ..PipelineRun::default()
    })
}

#[async_trait]
impl CiCdProvider for BitbucketProvider {
    fn id(&self) -> CiProvider {
        CiProvider::Bitbucket
    }

    fn label(&self) -> &'static str {
        "Bitbucket Pipelines"
    }

    fn capabilities(&self, input: CapsInput) -> Capabilities {
        let write = input.can_write != Some(false);
        let mut why = reasons("Bitbucket", &["canRetryFailed", "canRerunSingleJob", "canCancelJob", "canPlayManualJob", "canRunWithInputs"]);
        why.insert("canListRunners".into(), t("Bitbucket не открывает раннеры в публичном API — управляйте ими в настройках репозитория (Repository settings → Runners)", &[]));
        why.insert("canDownloadArtifacts".into(), t("Bitbucket не отдаёт артефакты пайплайна через публичный API", &[]));
        why.insert("canCreateRunnerToken".into(), t("Раннер Bitbucket регистрируется в настройках репозитория — команда запуска показывается там", &[]));
        Capabilities {
            can_list_pipelines: true,
            can_run_pipeline: write,
            can_run_with_variables: write,
            can_cancel: write,
            can_retry: write,
            can_manage_secrets: write,
            can_manage_variables: write,
            why: Some(why),
            ..Capabilities::default()
        }
    }

    async fn init(&self, ctx: &mut Ctx) -> Result<()> {
        if ctx.host != "bitbucket.org" && !ctx.api_override {
            return Err(GorynychError::new(ErrorCode::Unsupported, t("Bitbucket Data Center не поддерживает Pipelines", &[])).with_hint(t("На своём сервере Bitbucket сборки обычно идут в Bamboo или Jenkins", &[])));
        }
        let opts = Opts::not_found(t("Репозиторий {0}/{1} не найден или у входа нет к нему доступа", &[&ctx.owner, &ctx.repo]));
        let r = request(&ctx.http, Method::GET, &repo_api(ctx), opts).await?;
        ctx.default_branch = r.get("mainbranch").and_then(|branch| text(branch, "name"));
        if let Some(url) = r.get("links").and_then(|links| links.get("html")).and_then(|html| text(html, "href")) {
            ctx.web_url = Some(url);
        }
        ctx.can_write = Some(true);
        Ok(())
    }

    async fn whoami(&self, ctx: &Ctx) -> Result<Option<LegacyCiUser>> {
        let u = request(&ctx.http, Method::GET, "/user", Opts::default()).await?;
        Ok(Some(LegacyCiUser {
            username: text(&u, "username").or_else(|| text(&u, "nickname")),
            name: text(&u, "display_name").or_else(|| text(&u, "username")),
            avatar_url: u.get("links").and_then(|links| links.get("avatar")).and_then(|avatar| text(avatar, "href")),
        }))
    }

    async fn list_pipelines(&self, ctx: &Ctx, reference: Option<&str>) -> Result<PipelineList> {
        let reference = reference.filter(|name| !name.is_empty());
        let opts = Opts::query(&[("sort", Some("-created_on".into())), ("pagelen", Some("50".into())), ("target.ref_name", reference.map(str::to_owned))]);
        let data = request(&ctx.http, Method::GET, format!("{}/pipelines/", repo_api(ctx)), opts).await?;
        let mut pipelines = Vec::new();
        for p in items(&data, "values") {
            let run = run_of(p, ctx)?;
            if reference.is_none() || run.branch.as_deref() == reference {
                pipelines.push(run);
            }
        }
        Ok(PipelineList { by_sha: by_sha(&pipelines), pipelines, can_write: ctx.write_allowed() })
    }

    async fn pipeline_detail(&self, ctx: &Ctx, id: &CiId) -> Result<DetailData> {
        let n = id.number_text();
        let api = repo_api(ctx);
        let (p, steps) = tokio::join!(
            request(&ctx.http, Method::GET, format!("{api}/pipelines/{n}"), Opts::not_found(t("Пайплайн #{0} не найден", &[id]))),
            request(&ctx.http, Method::GET, format!("{api}/pipelines/{n}/steps/"), Opts::query(&[("pagelen", Some("100".into()))])),
        );
        let (p, steps) = (p?, steps?);
        let pipeline = run_of(&p, ctx)?;
        let mut jobs = Vec::new();
        for (index, s) in items(&steps, "values").iter().enumerate() {
            let name = text(s, "name").unwrap_or_else(|| t("Шаг {0}", &[&(index + 1)]));
            let runs_on = strings(s, "runs_on");
            jobs.push(PipelineJob {
                id: CiId::field(s, "uuid"),
                kind: "job".to_owned(),
                name: Some(name.clone()),
                stage: Some(name),
                status: Some(bitbucket_status(field(s, "state")).to_owned()),
                runner_name: (!runs_on.is_empty()).then(|| runs_on.join(", ")),
                runner_tags: runs_on,
                started_at: iso_field(s, "started_on")?,
                finished_at: iso_field(s, "completed_on")?,
                duration: number(s, "duration_in_seconds"),
                url: pipeline.url.clone(),
                logs_url: pipeline.url.clone(),
                failure_reason: s.get("state").and_then(|state| state.get("result")).and_then(|result| result.get("error")).and_then(|error| text(error, "message")),
                manual: s.get("trigger").and_then(|trigger| text(trigger, "type")).as_deref() == Some("pipeline_step_trigger_manual"),
                pipeline_id: pipeline.id.clone(),
                ..PipelineJob::default()
            });
        }
        Ok(DetailData { pipeline: Some(pipeline), jobs, sequential: true, can_write: ctx.write_allowed(), ..DetailData::default() })
    }

    async fn job_log(&self, ctx: &Ctx, id: &CiId, pipeline_id: Option<&CiId>) -> Result<JobLog> {
        let Some(pipeline) = pipeline_id.filter(|pipeline| pipeline.number() != 0.0 && !matches!(pipeline, CiId::Text(text) if text.is_empty())) else {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указан пайплайн шага", &[])));
        };
        let path = format!("{}/pipelines/{}/steps/{}/log", repo_api(ctx), pipeline.number_text(), js::encode_uri_component(&id.to_string()));
        let log = match request_text(&ctx.http, Method::GET, &path, Opts::default()).await {
            Err(error) if error.code == ErrorCode::NotFound => LogChunk::default(),
            other => other?,
        };
        Ok(JobLog { job: None, truncated: log.size > MAX_LOG as u64, text: log.text, size: log.size, unavailable: None })
    }

    async fn action(&self, ctx: &Ctx, a: &ActionRequest) -> Result<ActionResult> {
        let api = repo_api(ctx);
        let n = a.id.as_ref().map_or_else(|| "NaN".to_owned(), CiId::number_text);
        let kind = a.kind.clone().unwrap_or_default();
        match kind.as_str() {
            "pipeline.cancel" => {
                request(&ctx.http, Method::POST, format!("{api}/pipelines/{n}/stopPipeline"), Opts::body(json!({}))).await?;
                Ok(ActionResult { kind, id: a.id.clone(), status: None, web_url: None })
            }
            "pipeline.retry" => {
                // Повтор: новый пайплайн для той же ветки и коммита
                let p = request(&ctx.http, Method::GET, format!("{api}/pipelines/{n}"), Opts::default()).await?;
                let mut body = Map::new();
                if let Some(target) = p.get("target") {
                    body.insert("target".into(), target.clone());
                }
                let res = request(&ctx.http, Method::POST, format!("{api}/pipelines/"), Opts::body(Value::Object(body))).await?;
                Ok(ActionResult { kind, id: CiId::field(&res, "build_number"), status: None, web_url: None })
            }
            _ => Err(GorynychError::new(ErrorCode::Unsupported, t("Bitbucket не поддерживает это действие", &[]))),
        }
    }

    async fn run_pipeline(&self, ctx: &Ctx, input: &RunInput) -> Result<RunResult> {
        let mut target = json!({ "type": "pipeline_ref_target", "ref_type": "branch", "ref_name": input.reference });
        // «custom: name»: пайплайн из раздела pipelines.custom
        if let Some(rest) = input.workflow.as_deref().and_then(|workflow| workflow.strip_prefix("custom:")) {
            let pattern = rest.trim_start_matches(js::is_whitespace);
            if !pattern.is_empty() && !pattern.contains('\n') {
                target["selector"] = json!({ "type": "custom", "pattern": js::trim(pattern) });
            }
        }
        let vars: Vec<&RunVariable> = input.variables.iter().filter(|v| v.key.as_deref().is_some_and(|key| !key.is_empty())).collect();
        if let Some(bad) = vars.iter().find(|v| !VAR_KEY.is_match(v.key.as_deref().unwrap_or_default())) {
            let key = bad.key.as_deref().unwrap_or_default();
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректное имя переменной: {0}", &[&key])));
        }
        let mut body = Map::new();
        body.insert("target".into(), target);
        if !vars.is_empty() {
            let list: Vec<Value> = vars.iter().map(|v| json!({ "key": v.key, "value": v.value.as_ref().filter(|value| !value.is_null()).map_or_else(String::new, js_string), "secured": v.secured })).collect();
            body.insert("variables".into(), Value::Array(list));
        }
        let res = request(&ctx.http, Method::POST, format!("{}/pipelines/", repo_api(ctx)), Opts::body(Value::Object(body))).await?;
        Ok(RunResult { id: CiId::field(&res, "build_number"), url: None })
    }

    async fn list_runners(&self, _ctx: &Ctx) -> Result<Vec<CiRunner>> {
        Err(GorynychError::new(ErrorCode::Unsupported, t("Bitbucket не открывает раннеры в публичном API", &[])).with_hint("Repository settings → Runners"))
    }

    async fn list_secrets(&self, ctx: &Ctx) -> Result<Vec<CiSecretVariable>> {
        let data = request(&ctx.http, Method::GET, format!("{}/pipelines_config/variables/", repo_api(ctx)), Opts::query(&[("pagelen", Some("100".into()))])).await?;
        Ok(items(&data, "values")
            .iter()
            .map(|v| {
                let secured = flag(v, "secured");
                CiSecretVariable { key: text(v, "key"), uuid: text(v, "uuid"), secret: secured, masked: secured, environment_scope: Some("*".into()), value: if secured { None } else { Some(text(v, "value").unwrap_or_default()) }, ..CiSecretVariable::default() }
            })
            .collect())
    }

    async fn save_secret(&self, ctx: &Ctx, input: &SecretInput) -> Result<SecretResult> {
        if !VAR_KEY.is_match(&input.key) {
            return Err(GorynychError::new(ErrorCode::InvalidName, t("Имя переменной: латинские буквы, цифры и _", &[])));
        }
        let body = json!({ "key": input.key, "value": input.value, "secured": input.secret });
        let api = format!("{}/pipelines_config/variables/", repo_api(ctx));
        match input.original.as_ref().and_then(|original| original.uuid.as_deref()).filter(|uuid| !uuid.is_empty()) {
            Some(uuid) => request(&ctx.http, Method::PUT, format!("{api}{}", js::encode_uri_component(uuid)), Opts::body(body)).await?,
            None => request(&ctx.http, Method::POST, &api, Opts::body(body)).await?,
        };
        Ok(SecretResult { key: Some(input.key.clone()) })
    }

    async fn delete_secret(&self, ctx: &Ctx, secret: &SecretRef) -> Result<SecretResult> {
        let Some(uuid) = secret.uuid.as_deref().filter(|uuid| !uuid.is_empty()) else {
            let key = secret.key.as_deref().unwrap_or("undefined");
            return Err(GorynychError::new(ErrorCode::NotFound, t("Переменная {0} не найдена", &[&key])));
        };
        request(&ctx.http, Method::DELETE, format!("{}/pipelines_config/variables/{}", repo_api(ctx), js::encode_uri_component(uuid)), Opts::default()).await?;
        Ok(SecretResult { key: secret.key.clone() })
    }
}
