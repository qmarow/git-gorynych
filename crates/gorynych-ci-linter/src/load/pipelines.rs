//! Bitbucket Pipelines, CircleCI, Azure Pipelines и `loadGeneric` из `electron/ci.cjs`.
//!
//! ## Конспект
//! - **Bitbucket:** `default`, затем `branches tags bookmarks pull-requests custom`. Элемент: `parallel` (список или `{steps}`), `stage` или шаг;
//!   шаг лежит в `step` или сам элемент. Нумерация `s1…` сквозная.
//! - **CircleCI:** `workflows` с колонками по `requires`; нет потоков, но есть задания — один пайплайн `jobs`. Неизвестная ссылка без
//!   `type: approval` — орб (`kind: trigger`). Шаг: строка, `run` (строка или `{name, command}`) или первый ключ.
//! - **Azure:** `stages`, либо `jobs` (колонки по `dependsOn`, ссылки по `job`/`deployment` переводятся в показываемое имя), либо `steps`.
//! - **Прочие системы** (`loadGeneric`): только файл, разделы и `schemeUnsupported`.
//!
//! ## Отличие от 1.x
//! Имя задания CircleCI или переменной Azure не строкой (`name: 1`) здесь становится строкой. На вид в интерфейсе это не влияет.

use std::collections::HashMap;

use super::common::*;
use super::model::*;
use crate::yaml::{JsMap, PathItem, Value, parse_yaml};
use crate::yaml_write::to_yaml;

fn string_value(text: impl Into<String>) -> Value {
    Value::String(text.into())
}

/* ------------------------------- Bitbucket ------------------------------- */

struct Bitbucket<'a, 'b> {
    ctx: &'a Ctx<'b>,
    file: &'a str,
    default_image: Option<Value>,
    counter: usize,
}

impl Bitbucket<'_, '_> {
    fn step_job(&mut self, step: &Value, index: usize) -> CiJob {
        let ctx = self.ctx;
        let empty = Value::Map(JsMap::new());
        let s = match step.get("step") {
            Some(inner @ Value::Map(_)) => inner,
            _ if matches!(step, Value::Map(_)) => step,
            _ => &empty,
        };
        self.counter += 1;
        let manual = s.get("trigger").and_then(Value::as_str) == Some("manual");
        let lines_of = |key: &str| truthy(s.get(key)).map(|value| CiScript { lines: script_lines(Some(value)), inherited: None });
        CiJob {
            id: format!("s{}", self.counter),
            name: truthy(s.get("name")).map_or_else(|| ctx.t("Шаг {0}", &[&(index + 1)]), Value::js_string),
            source: self.file.to_owned(),
            kind: CiJobKind::Job,
            image: image_name(s.get("image")).or_else(|| self.default_image.clone()),
            image_inherited: if truthy(s.get("image")).is_some() {
                None
            } else if self.default_image.as_ref().is_some_and(Value::truthy) {
                Some(ctx.t("глобально", &[]))
            } else {
                None
            },
            manual,
            when: Some(string_value(if manual { "manual" } else { "on_success" })),
            runs_on_labels: truthy(s.get("runs-on")).map(|value| strings(Some(value))),
            script: lines_of("script"),
            after_script: lines_of("after-script"),
            environment: truthy(s.get("deployment")).map(|name| CiEnvironment { name: Some(name.clone()), ..CiEnvironment::default() }),
            services: Some(as_array(s.get("services")).into_iter().map(|service| string_value(service.js_string())).collect()),
            artifacts: truthy(s.get("artifacts")).map(|artifacts| CiArtifacts {
                paths: strings(if is_map(Some(artifacts)) { artifacts.get("paths") } else { Some(artifacts) }),
                ..CiArtifacts::default()
            }),
            cache: truthy(s.get("caches")).map(|caches| joined(Some(caches), ", ")),
            rules: match s.get("condition").and_then(|condition| truthy(condition.get("changesets"))) {
                Some(changesets) => vec![CiRule::text(ctx.t("изменены {0}", &[&joined(changesets.get("includePaths"), ", ")]))],
                None => Vec::new(),
            },
            raw: to_yaml(s),
            ..CiJob::default()
        }
    }

    fn build(&mut self, title: String, list: &Value) -> CiPipeline {
        let mut stages = Vec::new();
        for (index, item) in as_array(Some(list)).into_iter().enumerate() {
            if let Some(parallel) = truthy(item.get("parallel")) {
                let steps = if matches!(parallel, Value::Seq(_)) { as_array(Some(parallel)) } else { as_array(parallel.get("steps")) };
                let jobs = steps.into_iter().enumerate().map(|(at, step)| self.step_job(step, at)).collect();
                stages.push(CiStage::new(self.ctx.t("Параллельно", &[]), jobs));
            } else if let Some(stage) = truthy(item.get("stage")) {
                let jobs = as_array(stage.get("steps")).into_iter().enumerate().map(|(at, step)| self.step_job(step, at)).collect();
                let name = non_null(stage.get("name")).cloned().unwrap_or_else(|| string_value(format!("Stage {}", index + 1)));
                stages.push(CiStage { name, jobs, undeclared: None });
            } else {
                let job = self.step_job(item, index);
                stages.push(CiStage::new(job.name.clone(), vec![job]));
            }
        }
        CiPipeline { id: title.clone(), title, stages }
    }
}

/// `loadBitbucket`.
pub(crate) fn load_bitbucket(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let text = ctx.read_text(file).map_err(|error| error.message)?;
    let parsed = parse_yaml(&text);
    let data = &parsed.data;
    let empty = Value::Map(JsMap::new());
    let pipelines_cfg = data.get("pipelines").filter(|value| is_map(Some(value))).unwrap_or(&empty);
    let definitions = data.get("definitions").filter(|value| is_map(Some(value))).unwrap_or(&empty);
    let default_image = image_name(data.get("image"));
    let mut builder = Bitbucket { ctx, file, default_image: default_image.clone(), counter: 0 };
    let mut pipelines = Vec::new();
    if let Some(list) = truthy(pipelines_cfg.get("default")) {
        pipelines.push(builder.build(ctx.t("default — все ветки", &[]), list));
    }
    for group in ["branches", "tags", "bookmarks", "pull-requests", "custom"] {
        if let Some(Value::Map(map)) = pipelines_cfg.get(group) {
            for (pattern, list) in map.iter() {
                pipelines.push(builder.build(format!("{group}: {pattern}"), list));
            }
        }
    }
    let mut info = Vec::new();
    if let Some(image) = default_image {
        info.push(CiInfo { label: ctx.t("Образ по умолчанию", &[]), value: image });
    }
    if let Some(services) = truthy(definitions.get("services")) {
        let names: Vec<String> = services.js_entries().into_iter().map(|(key, _)| key).collect();
        info.push(CiInfo { label: ctx.t("Сервисы", &[]), value: string_value(names.join(", ")) });
    }
    Ok(CiConfig {
        errors: Ctx::file_errors(&parsed, file),
        warnings: if pipelines.is_empty() { vec![ctx.t("Не найден раздел pipelines", &[])] } else { Vec::new() },
        info,
        triggers: pipelines.iter().map(|pipeline| CiRule::text(pipeline.title.clone())).collect(),
        triggers_title: Some(ctx.t("Пайплайны", &[])),
        pipelines,
        files: vec![CiFile { path: file.to_owned(), text, hash: None, draft: false }],
        ..CiConfig::default()
    })
}

/* -------------------------------- CircleCI ------------------------------- */

fn circle_steps(cfg: &Value) -> Vec<CiStep> {
    as_array(cfg.get("steps"))
        .into_iter()
        .map(|step| {
            let plain = |name: Value, uses: Option<Value>, run: Option<Value>| CiStep { name, uses, run, condition: None, with_args: None };
            if matches!(step, Value::String(_)) {
                return plain(step.clone(), None, None);
            }
            if let Some(run) = truthy(step.get("run")) {
                return match run {
                    Value::String(_) => plain(first_line(run), None, Some(run.clone())),
                    other => plain(
                        non_null(other.get("name")).cloned().unwrap_or_else(|| string_value("run")),
                        None,
                        non_null(other.get("command")).cloned(),
                    ),
                };
            }
            let first = step.js_entries().into_iter().next().map(|(key, _)| key);
            plain(string_value(first.clone().unwrap_or_else(|| "step".to_owned())), first.map(string_value), None)
        })
        .collect()
}

/// `loadCircle`.
pub(crate) fn load_circle(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let text = ctx.read_text(file).map_err(|error| error.message)?;
    let parsed = parse_yaml(&text);
    let job_lines = parsed.nested_lines(&[PathItem::Key("jobs".to_owned())], &text);
    let data = &parsed.data;
    let empty = Value::Map(JsMap::new());
    let job_defs = data.get("jobs").filter(|value| is_map(Some(value))).unwrap_or(&empty);

    let make_job = |name: String, reference: &str, opts: &Value| -> CiJob {
        let definition = job_defs.get(reference);
        let cfg = definition.filter(|value| is_map(Some(value))).unwrap_or(&empty);
        let docker = as_array(cfg.get("docker"));
        let approval = opts.get("type").and_then(Value::as_str) == Some("approval");
        let is_job = definition.is_some_and(Value::truthy) || approval;
        CiJob {
            id: name.clone(),
            name,
            source: file.to_owned(),
            line: job_lines.get(reference).copied(),
            kind: if is_job { CiJobKind::Job } else { CiJobKind::Trigger },
            trigger: (!is_job).then(|| string_value(format!("orb: {reference}"))),
            image: match docker.first().filter(|first| first.truthy()) {
                Some(first) => image_name(Some(first)),
                None if truthy(cfg.get("machine")).is_some() => Some(string_value("machine")),
                None if truthy(cfg.get("macos")).is_some() => Some(string_value("macos")),
                None => None,
            },
            manual: approval,
            when: Some(string_value(if approval { "manual" } else { "on_success" })),
            steps: Some(circle_steps(cfg)),
            needs: truthy(opts.get("requires")).map(|requires| strings(Some(requires)).into_iter().map(CiNeed::named).collect()),
            rules: truthy(opts.get("filters")).map_or_else(Vec::new, |filters| vec![CiRule::text(compact(filters))]),
            variables: variables_list(cfg.get("environment")),
            raw: to_yaml(cfg),
            ..CiJob::default()
        }
    };

    let mut pipelines = Vec::new();
    if let Some(Value::Map(workflows)) = data.get("workflows") {
        for (name, workflow) in workflows.iter() {
            if !matches!(workflow, Value::Map(_)) {
                continue;
            }
            let mut jobs = Vec::new();
            for entry in as_array(workflow.get("jobs")) {
                if let Value::String(reference) = entry {
                    jobs.push(make_job(reference.clone(), reference, &empty));
                    continue;
                }
                if entry.is_null() {
                    return Err("Cannot convert undefined or null to object".to_owned());
                }
                let first = entry.js_entries().into_iter().next();
                let (reference, opts) = first.unwrap_or_else(|| ("?".to_owned(), empty.clone()));
                let job_name = non_null(opts.get("name")).map_or_else(|| reference.clone(), Value::js_string);
                jobs.push(make_job(job_name, &reference, &opts));
            }
            pipelines.push(CiPipeline { id: name.clone(), title: name.clone(), stages: levelize(ctx, jobs) });
        }
    }
    if pipelines.is_empty() && !job_defs.as_map().is_none_or(JsMap::is_empty) {
        let jobs = job_defs.as_map().map_or_else(Vec::new, |map| map.keys().map(|key| make_job(key.clone(), key, &empty)).collect());
        pipelines.push(CiPipeline { id: "jobs".to_owned(), title: "jobs".to_owned(), stages: vec![CiStage::new(ctx.t("Задания", &[]), jobs)] });
    }
    let includes = truthy(data.get("orbs")).map_or_else(Vec::new, |orbs| {
        orbs.js_entries()
            .into_iter()
            .map(|(key, value)| CiInclude {
                kind: "orb".to_owned(),
                value: string_value(format!("{key}: {}", value.js_string())),
                rules: None,
                from: None,
                resolved: false,
                files: None,
                error: None,
            })
            .collect()
    });
    Ok(CiConfig {
        errors: Ctx::file_errors(&parsed, file),
        includes,
        info: truthy(data.get("version")).map_or_else(Vec::new, |version| {
            vec![CiInfo { label: ctx.t("Версия конфига", &[]), value: string_value(version.js_string()) }]
        }),
        triggers: pipelines.iter().map(|pipeline| CiRule::text(format!("workflow {}", pipeline.title))).collect(),
        triggers_title: Some("Workflows".to_owned()),
        pipelines,
        files: vec![CiFile { path: file.to_owned(), text, hash: None, draft: false }],
        ..CiConfig::default()
    })
}

/* --------------------------------- Azure --------------------------------- */

fn pool_name(pool: &Value) -> Option<Value> {
    match pool {
        Value::String(_) => Some(pool.clone()),
        other => non_null(other.get("vmImage")).or_else(|| non_null(other.get("name"))).cloned(),
    }
}

struct Azure<'a> {
    file: &'a str,
    counter: usize,
}

impl Azure<'_> {
    fn make_job(&mut self, raw_cfg: &Value) -> CiJob {
        let empty = Value::Map(JsMap::new());
        let cfg = if matches!(raw_cfg, Value::Map(_)) { raw_cfg } else { &empty };
        self.counter += 1;
        let name = ["displayName", "job", "deployment", "template"]
            .into_iter()
            .find_map(|key| non_null(cfg.get(key)))
            .map_or_else(|| format!("Job {}", self.counter), Value::js_string);
        let template = truthy(cfg.get("template"));
        let deploy_steps = || {
            cfg.get("strategy").and_then(|strategy| strategy.get("runOnce")).and_then(|once| once.get("deploy")).and_then(|deploy| deploy.get("steps"))
        };
        let steps_source = non_null(cfg.get("steps")).or_else(deploy_steps);
        let steps = as_array(steps_source)
            .into_iter()
            .map(|step| {
                let name = non_null(step.get("displayName")).or_else(|| non_null(step.get("task"))).cloned().unwrap_or_else(|| {
                    match truthy(step.get("script")).or_else(|| truthy(step.get("bash"))) {
                        Some(script) => first_line(script),
                        None => string_value("step"),
                    }
                });
                CiStep {
                    name,
                    uses: non_null(step.get("task")).or_else(|| non_null(step.get("template"))).cloned(),
                    run: ["script", "bash", "powershell", "pwsh"].into_iter().find_map(|key| non_null(step.get(key))).cloned(),
                    condition: None,
                    with_args: None,
                }
            })
            .collect();
        CiJob {
            id: format!("j{}", self.counter),
            name,
            source: self.file.to_owned(),
            kind: if template.is_some() { CiJobKind::Trigger } else { CiJobKind::Job },
            trigger: template.map(|template| string_value(format!("template: {}", template.js_string()))),
            image: image_name(cfg.get("container")).or_else(|| truthy(cfg.get("pool")).and_then(pool_name)),
            condition: non_null(cfg.get("condition")).cloned(),
            needs: truthy(cfg.get("dependsOn")).map(|deps| strings(Some(deps)).into_iter().map(CiNeed::named).collect()),
            environment: truthy(cfg.get("environment")).map(|env| CiEnvironment {
                name: if matches!(env, Value::String(_)) { Some(env.clone()) } else { env.get("name").cloned() },
                ..CiEnvironment::default()
            }),
            steps: Some(steps),
            variables: azure_variables(cfg.get("variables")),
            manual: false,
            raw: to_yaml(cfg),
            ..CiJob::default()
        }
    }
}

fn azure_variables(variables: Option<&Value>) -> Vec<CiVariable> {
    match variables {
        Some(Value::Seq(items)) => name_value_list(items),
        other => variables_list(other),
    }
}

/// Значение `${x}` в шаблоне: отсутствие — `undefined`.
fn template_text(value: Option<&Value>) -> String {
    value.map_or_else(|| "undefined".to_owned(), Value::js_string)
}

/// `loadAzure`.
pub(crate) fn load_azure(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let text = ctx.read_text(file).map_err(|error| error.message)?;
    let parsed = parse_yaml(&text);
    let data = &parsed.data;
    let mut azure = Azure { file, counter: 0 };

    let stages = if let Some(Value::Seq(list)) = data.get("stages") {
        list.iter()
            .enumerate()
            .map(|(index, stage)| {
                let name = non_null(stage.get("displayName"))
                    .or_else(|| non_null(stage.get("stage")))
                    .cloned()
                    .unwrap_or_else(|| string_value(format!("Stage {}", index + 1)));
                CiStage { name, jobs: as_array(stage.get("jobs")).into_iter().map(|job| azure.make_job(job)).collect(), undeclared: None }
            })
            .collect()
    } else if let Some(Value::Seq(list)) = data.get("jobs") {
        let mut jobs: Vec<CiJob> = list.iter().map(|job| azure.make_job(job)).collect();
        let mut name_of: HashMap<&str, String> = HashMap::new();
        for (item, job) in list.iter().zip(&jobs) {
            if let Some(Value::String(key)) = non_null(item.get("job")).or_else(|| non_null(item.get("deployment"))) {
                name_of.insert(key, job.name.clone());
            }
        }
        for job in &mut jobs {
            for need in job.needs.iter_mut().flatten() {
                if let Some(name) = need.job.as_str().and_then(|key| name_of.get(key)) {
                    need.job = string_value(name.clone());
                }
            }
        }
        levelize(ctx, jobs)
    } else {
        let mut cfg = JsMap::new();
        cfg.insert("displayName".to_owned(), string_value(ctx.t("Задание", &[])));
        for key in ["steps", "pool"] {
            if let Some(value) = data.get(key) {
                cfg.insert(key.to_owned(), value.clone());
            }
        }
        vec![CiStage::new(ctx.t("Шаги", &[]), vec![azure.make_job(&Value::Map(cfg))])]
    };

    let switch_text = |value: &Value| if value.as_str() == Some("none") { ctx.t("выключен", &[]) } else { compact(value) };
    let mut triggers = Vec::new();
    if let Some(trigger) = data.get("trigger") {
        triggers.push(CiRule::text(format!("push: {}", switch_text(trigger))));
    }
    if let Some(pr) = data.get("pr") {
        triggers.push(CiRule::text(format!("pull request: {}", switch_text(pr))));
    }
    for schedule in as_array(data.get("schedules")) {
        if let Some(cron) = truthy(schedule.get("cron")) {
            let suffix = truthy(schedule.get("displayName")).map_or_else(String::new, |name| format!(" ({})", name.js_string()));
            triggers.push(CiRule::text(format!("cron: {}{suffix}", cron.js_string())));
        }
    }
    let mut includes = Vec::new();
    for repository in as_array(data.get("resources").and_then(|resources| resources.get("repositories"))) {
        if repository.is_null() {
            return Err(null_read("repository"));
        }
        includes.push(CiInclude {
            kind: "repository".to_owned(),
            value: string_value(format!("{}: {}", template_text(repository.get("repository")), template_text(repository.get("name")))),
            rules: None,
            from: None,
            resolved: false,
            files: None,
            error: None,
        });
    }
    let info = truthy(data.get("pool")).map_or_else(Vec::new, |pool| {
        let value = pool_name(pool).unwrap_or_else(|| string_value(to_yaml(pool)));
        vec![CiInfo { label: ctx.t("Пул", &[]), value }]
    });
    Ok(CiConfig {
        errors: Ctx::file_errors(&parsed, file),
        includes,
        info,
        triggers,
        triggers_title: Some(ctx.t("Когда запускается", &[])),
        variables: azure_variables(data.get("variables")),
        pipelines: vec![CiPipeline { id: "main".to_owned(), title: ctx.t("Пайплайн", &[]), stages }],
        files: vec![CiFile { path: file.to_owned(), text, hash: None, draft: false }],
        ..CiConfig::default()
    })
}

/* ---------------------------------- Прочие --------------------------------- */

/// `loadGeneric`.
pub(crate) fn load_generic(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let text = ctx.read_text(file).map_err(|error| error.message)?;
    let parsed = parse_yaml(&text);
    let info = match parsed.data.as_map() {
        Some(map) if !map.is_empty() => {
            let keys: Vec<&str> = map.keys().map(String::as_str).collect();
            vec![CiInfo { label: ctx.t("Разделы", &[]), value: string_value(keys.join(", ")) }]
        }
        _ => Vec::new(),
    };
    Ok(CiConfig {
        errors: Ctx::file_errors(&parsed, file),
        info,
        triggers_title: Some(String::new()),
        scheme_unsupported: Some(true),
        files: vec![CiFile { path: file.to_owned(), text, hash: None, draft: false }],
        ..CiConfig::default()
    })
}
