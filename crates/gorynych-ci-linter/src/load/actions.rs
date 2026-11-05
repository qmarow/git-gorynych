//! GitHub Actions, Gitea, Forgejo: `loadGithub` и `githubTriggers` из `electron/ci.cjs`.
//!
//! ## Конспект
//! - `on` или `data[true]` (YAML 1.1). Значение: строка, список или словарь событий с деталями (фильтры, `inputs`, `workflows`, `cron`).
//! - `needs` ссылается на id задания: предупреждение ищется по id, а в интерфейс уходит `name`, по нему же считаются колонки.
//! - Метки раннера: строка, список или `{labels, group}`.

use super::common::*;
use super::model::*;
use crate::yaml::{PathItem, Value, parse_yaml};
use crate::yaml_write::to_yaml;

const FILTER_KEYS: [&str; 7] = ["branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore", "types"];

fn github_triggers(ctx: &Ctx<'_>, on: Option<&Value>) -> Vec<CiRule> {
    let Some(on) = non_null(on) else { return Vec::new() };
    match on {
        Value::String(text) => vec![CiRule::text(text.clone())],
        Value::Seq(items) => items.iter().map(|item| CiRule::text(item.js_string())).collect(),
        Value::Map(map) => map
            .iter()
            .map(|(event, cfg)| {
                let mut details = Vec::new();
                if matches!(cfg, Value::Map(_)) {
                    for key in FILTER_KEYS {
                        if let Some(value) = truthy(cfg.get(key)) {
                            details.push(format!("{key}: {}", joined(Some(value), ", ")));
                        }
                    }
                    if let Some(Value::Map(inputs)) = cfg.get("inputs") {
                        let names: Vec<&str> = inputs.keys().map(String::as_str).collect();
                        details.push(ctx.t("параметры: {0}", &[&names.join(", ")]));
                    }
                    if let Some(workflows) = truthy(cfg.get("workflows")) {
                        details.push(ctx.t("после: {0}", &[&joined(Some(workflows), ", ")]));
                    }
                }
                if let Value::Seq(items) = cfg {
                    for item in items {
                        if let Some(cron) = truthy(item.get("cron")) {
                            details.push(format!("cron: {}", cron.js_string()));
                        }
                    }
                }
                let suffix = if details.is_empty() { String::new() } else { format!(" — {}", details.join("; ")) };
                CiRule::text(format!("{event}{suffix}"))
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn steps(ctx: &Ctx<'_>, cfg: &Value) -> Vec<CiStep> {
    as_array(cfg.get("steps"))
        .into_iter()
        .enumerate()
        .map(|(index, step)| {
            let uses = truthy(step.get("uses"));
            let run = truthy(step.get("run"));
            let name = non_null(step.get("name")).cloned().unwrap_or_else(|| match (uses, run) {
                (Some(uses), _) => uses.clone(),
                (None, Some(run)) => first_line(run),
                (None, None) => Value::String(ctx.t("Шаг {0}", &[&(index + 1)])),
            });
            let with_args = match step.get("with") {
                Some(Value::Map(map)) => map
                    .iter()
                    .map(|(key, value)| match value {
                        Value::String(text) => format!("{key}: {text}"),
                        other => format!("{key}: {}", other.json_string()),
                    })
                    .collect(),
                _ => Vec::new(),
            };
            CiStep {
                name,
                uses: non_null(step.get("uses")).cloned(),
                run: non_null(step.get("run")).map(|run| Value::String(run.js_string())),
                condition: non_null(step.get("if")).map(Value::js_string),
                with_args: Some(with_args),
            }
        })
        .collect()
}

fn job(ctx: &Ctx<'_>, id: &str, raw_cfg: &Value, file: &str, line: Option<u32>) -> CiJob {
    let empty = Value::Map(crate::yaml::JsMap::new());
    let cfg = if matches!(raw_cfg, Value::Map(_)) { raw_cfg } else { &empty };
    let matrix: Vec<String> = match cfg.get("strategy").and_then(|strategy| strategy.get("matrix")) {
        Some(Value::Map(map)) => {
            map.iter().filter(|(key, _)| *key != "include" && *key != "exclude").map(|(key, value)| format!("{key}: {}", joined(Some(value), ", "))).collect()
        }
        _ => Vec::new(),
    };
    let runs_on = cfg.get("runs-on");
    let uses = truthy(cfg.get("uses"));
    let runs_on_map = is_map(runs_on);
    let runs_on_text = truthy(runs_on).map(|value| {
        if runs_on_map {
            joined(non_null(value.get("labels")).or_else(|| value.get("group")), ", ")
        } else {
            joined(Some(value), ", ")
        }
    });
    let labels = non_null(runs_on).map(|value| strings(if runs_on_map { value.get("labels") } else { Some(value) }));
    CiJob {
        id: id.to_owned(),
        name: truthy(cfg.get("name")).map_or_else(|| id.to_owned(), Value::js_string),
        job_id: Some(id.to_owned()),
        source: file.to_owned(),
        line,
        kind: if uses.is_some() { CiJobKind::Trigger } else { CiJobKind::Job },
        runs_on: runs_on_text,
        runs_on_labels: labels,
        runs_on_group: if runs_on_map { truthy(runs_on.and_then(|value| value.get("group"))).map(Value::js_string) } else { None },
        image: truthy(cfg.get("container")).and_then(|container| image_name(Some(container))),
        condition: non_null(cfg.get("if")).map(|condition| Value::String(condition.js_string())),
        needs: truthy(cfg.get("needs")).map(|needs| strings(Some(needs)).into_iter().map(CiNeed::named).collect()),
        allow_failure: Some(matches!(cfg.get("continue-on-error"), Some(Value::Bool(true)))),
        manual: false,
        environment: environment(cfg.get("environment"), false),
        steps: Some(steps(ctx, cfg)),
        trigger: uses.map(|uses| Value::String(uses.js_string())),
        variables: variables_list(cfg.get("env")),
        services: Some(match cfg.get("services") {
            Some(Value::Map(map)) => map
                .iter()
                .map(|(key, value)| Value::String(format!("{key} ({})", image_name(Some(value)).map_or_else(|| "?".to_owned(), |image| image.js_string()))))
                .collect(),
            _ => Vec::new(),
        }),
        parallel: (!matrix.is_empty()).then(|| format!("matrix: {}", matrix.join("; "))),
        timeout: non_null(cfg.get("timeout-minutes")).map(|timeout| Value::String(ctx.t("{0} мин", &[&Ctx::arg(timeout)]))),
        permissions: truthy(cfg.get("permissions")).map(to_yaml),
        outputs: Some(match cfg.get("outputs") {
            Some(Value::Map(map)) => map.keys().cloned().collect(),
            _ => Vec::new(),
        }),
        raw: to_yaml(cfg),
        ..CiJob::default()
    }
}

/// `loadGithub`.
pub(crate) fn load_github(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let text = ctx.read_text(file).map_err(|error| error.message)?;
    let parsed = parse_yaml(&text);
    let job_lines = parsed.nested_lines(&[PathItem::Key("jobs".to_owned())], &text);
    let data = &parsed.data;
    let mut warnings = Vec::new();
    if truthy(data.get("jobs")).is_none() {
        warnings.push(ctx.t("В файле нет раздела jobs", &[]));
    }
    let mut jobs: Vec<CiJob> = match data.get("jobs") {
        Some(Value::Map(map)) => map.iter().map(|(id, cfg)| job(ctx, id, cfg, file, job_lines.get(id).copied())).collect(),
        _ => Vec::new(),
    };
    for job in &jobs {
        for need in job.needs.iter().flatten() {
            let wanted = need.job.as_str().unwrap_or_default();
            if !jobs.iter().any(|other| other.job_id.as_deref() == Some(wanted)) {
                warnings.push(ctx.t("«{0}»: needs ссылается на «{1}», которого нет", &[&job.id, &wanted]));
            }
        }
    }
    let names: Vec<(String, String)> = jobs.iter().rev().map(|job| (job.id.clone(), job.name.clone())).collect();
    for job in &mut jobs {
        for need in job.needs.iter_mut().flatten() {
            if let Some((_, name)) = names.iter().find(|(id, _)| need.job.as_str() == Some(id)) {
                need.job = Value::String(name.clone());
            }
        }
    }

    let mut info = Vec::new();
    if let Some(name) = truthy(data.get("name")) {
        info.push(CiInfo { label: "Workflow".to_owned(), value: Value::String(name.js_string()) });
    }
    if let Some(name) = truthy(data.get("run-name")) {
        info.push(CiInfo { label: ctx.t("Имя запуска", &[]), value: Value::String(name.js_string()) });
    }
    if let Some(concurrency) = truthy(data.get("concurrency")) {
        let value = match concurrency {
            Value::String(_) => concurrency.clone(),
            other => non_null(other.get("group")).cloned().unwrap_or_else(|| Value::String(to_yaml(other))),
        };
        info.push(CiInfo { label: "Concurrency".to_owned(), value });
    }
    if let Some(permissions) = truthy(data.get("permissions")) {
        let value = match permissions {
            Value::String(_) => permissions.clone(),
            other => {
                let parts: Vec<String> = other.js_entries().iter().map(|(key, value)| format!("{key}: {}", value.js_string())).collect();
                Value::String(parts.join(", "))
            }
        };
        info.push(CiInfo { label: ctx.t("Права токена", &[]), value });
    }

    let title = truthy(data.get("name")).map_or_else(|| file.to_owned(), Value::js_string);
    Ok(CiConfig {
        errors: Ctx::file_errors(&parsed, file),
        warnings,
        info,
        triggers: github_triggers(ctx, non_null(data.get("on")).or_else(|| data.get("true"))),
        triggers_title: Some(ctx.t("Когда запускается (on)", &[])),
        variables: variables_list(data.get("env")),
        pipelines: vec![CiPipeline { id: "main".to_owned(), title, stages: levelize(ctx, jobs) }],
        files: vec![CiFile { path: file.to_owned(), text, hash: None, draft: false }],
        ..CiConfig::default()
    })
}

