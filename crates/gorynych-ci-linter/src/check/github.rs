//! Проверка GitHub Actions, Gitea и Forgejo: `checkGithub` и `cronProblem` из `electron/ciCheckOther.cjs`.
//!
//! ## Конспект
//! Данные: разбор без `<<` (`Schema::Plain`); ошибка данных прерывает проверку молча. Разделы: верхний уровень, события (`on` или `true`), фильтры, `inputs`, расписания, права,
//! незакрытые `${{`, задания (id, ключи, `needs`, `uses`, `runs-on`, таймаут, матрица), шаги (ключи, действия, команды, ссылки `steps.`, `matrix.`, `needs.`), проверка скриптов (только после
//! checkout и не на Windows или macOS), циклы `needs`. Каталог id: `gh-*`, `secret-in-script`.

use std::collections::HashSet;

use super::CheckContext;
use super::base::*;
use super::scripts::{ScriptJob, ScriptLine, check_scripts};
use crate::load_common_non_null as non_null;
use crate::yaml::{JsMap, PathItem, Schema, Value};

const GH_TOP: [&str; 8] = ["name", "run-name", "on", "permissions", "env", "defaults", "concurrency", "jobs"];
const GH_EVENTS: [&str; 33] = [
    "branch_protection_rule", "check_run", "check_suite", "create", "delete", "deployment", "deployment_status", "discussion", "discussion_comment", "fork", "gollum", "image_version", "issue_comment", "issues", "label",
    "merge_group", "milestone", "page_build", "public", "pull_request", "pull_request_review", "pull_request_review_comment", "pull_request_target", "push", "registry_package", "release", "repository_dispatch", "schedule",
    "status", "watch", "workflow_call", "workflow_dispatch", "workflow_run",
];
const GH_FILTERS: [&str; 7] = ["branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore", "types"];
const GH_JOB: [&str; 20] = ["name", "permissions", "needs", "if", "runs-on", "environment", "concurrency", "outputs", "env", "defaults", "steps", "timeout-minutes", "strategy", "continue-on-error", "container", "services", "uses", "with", "secrets", "snapshot"];
const GH_STEP: [&str; 11] = ["id", "if", "name", "uses", "run", "shell", "with", "env", "continue-on-error", "timeout-minutes", "working-directory"];
const GH_PERMS: [&str; 15] = ["actions", "attestations", "checks", "contents", "deployments", "discussions", "id-token", "issues", "models", "packages", "pages", "pull-requests", "repository-projects", "security-events", "statuses"];
const GH_INPUT_TYPES: [&str; 5] = ["string", "boolean", "choice", "number", "environment"];

fn retired_runner(label: &str) -> Option<String> {
    Some(match label {
        "ubuntu-16.04" => tr!("september-2021"),
        "ubuntu-18.04" => tr!("april-2023"),
        "ubuntu-20.04" => tr!("april-2025"),
        "macos-10.15" => tr!("august-2022"),
        "macos-11" => tr!("june-2024"),
        "macos-12" => tr!("december-2024"),
        "macos-13" => tr!("december-2025"),
        "windows-2016" => tr!("march-2022"),
        "windows-2019" => tr!("june-2025"),
        _ => return None,
    })
}

/// Действие, последняя устаревшая версия, серьёзность, ключ перевода, рекомендуемая версия.
const OLD_ACTIONS: [(&str, f64, bool, &str, &str); 9] = [
    ("actions/upload-artifact", 3.0, true, "job-will-fail-right-away", "v4"),
    ("actions/download-artifact", 3.0, true, "job-will-fail-right-away-this", "v4"),
    ("actions/cache", 2.0, true, "job-will-fail-since-february", "v4"),
    ("actions/checkout", 3.0, false, "works-with-warning-node-js", "v5"),
    ("actions/setup-node", 3.0, false, "works-with-deprecated-node-js", "v5"),
    ("actions/setup-python", 4.0, false, "works-with-deprecated-node-js-warning", "v6"),
    ("actions/setup-java", 3.0, false, "works-with-deprecated-node-js-warning", "v5"),
    ("actions/setup-go", 4.0, false, "works-with-deprecated-node-js-warning", "v6"),
    ("actions/github-script", 6.0, false, "works-with-deprecated-node-js-warning", "v8"),
];

fn gh_rejected(message: impl std::fmt::Display) -> String {
    tr!("github-wont-run-workflow-invalid", message)
}

enum Cron {
    Error(String),
    Frequent,
    Fine,
}

/// `cronProblem`.
fn cron_problem(cron: &str) -> Cron {
    let fields: Vec<&str> = gorynych_core::js::trim(cron).split(gorynych_core::js::is_whitespace).filter(|part| !part.is_empty()).collect();
    let count = if gorynych_core::js::trim(cron).is_empty() { 1 } else { fields.len() };
    if count != 5 {
        return Cron::Error(tr!("n-5-fields-are-needed", count));
    }
    let ranges = [(0.0, 59.0), (0.0, 23.0), (1.0, 31.0), (1.0, 12.0), (0.0, 6.0)];
    let names = [tr!("minutes"), tr!("hours"), tr!("day-of-month"), tr!("month"), tr!("day-of-week")];
    for index in 0..5 {
        let mut value = fields[index].to_uppercase();
        for (at, month) in ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].iter().enumerate() {
            value = value.replace(month, &(at + 1).to_string());
        }
        for (at, day) in ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].iter().enumerate() {
            value = value.replace(day, &at.to_string());
        }
        for part in value.split(',') {
            let Some(groups) = re!(r"^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$").exec(part) else {
                return Cron::Error(tr!("field-unrecognized-value", names[index], q(fields[index])));
            };
            for number in [&groups[2], &groups[3]].into_iter().flatten() {
                let number = number_of_text(number);
                let (low, high) = ranges[index];
                if number < low || number > high + if index == 4 { 1.0 } else { 0.0 } {
                    return Cron::Error(tr!("field-is-out-of-range", names[index], gorynych_core::js::number_to_string(number), low, high));
                }
            }
            if groups[4].as_deref() == Some("0") {
                return Cron::Error(tr!("field-step-0", names[index]));
            }
        }
    }
    let minute = fields[0];
    let every = if minute == "*" {
        1.0
    } else if let Some(groups) = re!(r"^\*\/(\d+)$").exec(minute) {
        number_of_text(groups[1].as_deref().unwrap_or_default())
    } else if minute.contains(',') {
        let mut parts: Vec<f64> = minute.split(',').map(number_of_text).collect();
        if parts.iter().any(|part| part.is_nan()) {
            f64::NAN
        } else {
            parts.sort_by(f64::total_cmp);
            let last = parts[parts.len() - 1];
            let first = parts[0];
            let gaps = parts.iter().enumerate().map(|(at, value)| if at == 0 { 60.0 - last + first } else { value - parts[at - 1] });
            gaps.fold(f64::INFINITY, f64::min)
        }
    } else {
        60.0
    };
    if every < 5.0 && fields[1] == "*" && every != 0.0 { Cron::Frequent } else { Cron::Fine }
}

fn all_strings(value: &Value, path: &[PathItem], out: &mut Vec<(String, Vec<PathItem>)>) {
    match value {
        Value::String(text) => out.push((text.clone(), path.to_vec())),
        Value::Seq(items) => {
            for (index, item) in items.iter().enumerate() {
                all_strings(item, &extend(path, kp![index]), out);
            }
        }
        Value::Map(map) => {
            for (key, item) in map.iter() {
                all_strings(item, &extend(path, kp![key]), out);
            }
        }
        _ => {}
    }
}

fn extend(base: &[PathItem], more: Vec<PathItem>) -> Vec<PathItem> {
    base.iter().cloned().chain(more).collect()
}

struct Github<'a, 'b, 'c> {
    cx: &'a mut CheckContext<'b>,
    file: &'c str,
    when: String,
}

impl Github<'_, '_, '_> {
    fn line(&self, path: &[PathItem]) -> Option<u32> {
        self.cx.pos.line(self.file, path)
    }

    fn issue(&mut self, path: &[PathItem], mut draft: Draft) {
        draft.when = draft.when.or_else(|| Some(self.when.clone()));
        draft.file = Some(self.file.to_owned());
        draft.line = self.line(path);
        self.cx.add(draft);
    }

    fn job_issue(&mut self, path: &[PathItem], job: &str, mut draft: Draft) {
        draft.job = draft.job.or_else(|| Some(job.to_owned()));
        self.issue(path, draft);
    }

    fn check_perms(&mut self, perms: Option<&Value>, path: &[PathItem]) {
        let Some(perms) = perms else { return };
        if let Value::String(text) = perms {
            if !matches!(text.as_str(), "read-all" | "write-all" | "{}") {
                self.issue(path, draft!("gh-perms-value", Error, title = format!("permissions: {text}"), how = gh_rejected(format!("Unexpected value '{text}'")), why = tr!("as-string-only-read-all"), fix = "permissions:\n  contents: read"));
            } else if text == "write-all" {
                self.issue(path, draft!("gh-perms-write-all", Info, title = "permissions: write-all", when = tr!("on-every-run"), how = tr!("github-token-will-get-write"), why = tr!("broad-permissions-without-need"), fix = tr!("list-only-needed-permissions-contents")));
            }
            return;
        }
        let Value::Map(map) = perms else { return };
        for (key, value) in map.iter() {
            let sub = extend(path, kp![key]);
            if !GH_PERMS.contains(&key.as_str()) {
                self.issue(&sub, draft!("gh-perms-scope", Error, title = tr!("permissions-unknown-permission", q(key)), how = gh_rejected(format!("Unexpected value '{key}'")), why = tr!("permissions", GH_PERMS.join(", "), did_you_mean(key, GH_PERMS)), fix = tr!("fix-permission-name")));
            } else if !matches!(value.as_str(), Some("read" | "write" | "none")) || (key == "id-token" && value.as_str() == Some("read")) || (key == "models" && value.as_str() == Some("write")) {
                self.issue(&sub, draft!("gh-perms-level", Error, title = format!("permissions: {key}: {}", value.js_string()), how = gh_rejected(format!("Unexpected value '{}'", value.js_string())), why = if key == "id-token" { tr!("id-token-allows-only-write") } else { tr!("value-is-read-write-or") }, fix = format!("{key}: {}", if key == "id-token" { "write" } else { "read" })));
            }
        }
    }

    fn check_if(&mut self, condition: &Value, path: &[PathItem], job: &str, job_level: bool) {
        let text = condition.js_string();
        if re!(r"\bsecrets\.").test(&text) {
            let fix = format!("{}{}.", tr!("move-secret-to-env-and"), if job_level { tr!("at-step-level") } else { String::new() });
            self.issue(path, draft!("gh-if-secrets", Error, title = tr!("secrets-in-if-condition", q(job)), how = gh_rejected("Unrecognized named-value: 'secrets'"), why = tr!("secrets-context-isnt-available-in"), fix = fix, job = job.to_owned()));
        }
        if let Some(groups) = re!(r"^\s*\$\{\{([\s\S]*?)\}\}\s*(\S[\s\S]*)$").exec(&text) {
            let inner = groups[1].clone().unwrap_or_default();
            let rest = groups[2].clone().unwrap_or_default();
            self.issue(path, draft!("gh-if-always-true", Warning, title = tr!("condition-is-always-true", q(job), q(&text)), when = tr!("on-every-run"), how = tr!("step-job-will-always-run"), why = tr!("if-doesnt-cover-whole-condition"), fix = tr!("remove-or-wrap-whole-condition", gorynych_core::js::trim(&inner), rest), job = job.to_owned()));
        }
    }
}

/// `checkGithub`.
pub(crate) fn check_github(files: &[crate::load::model::CiFile], cx: &mut CheckContext<'_>) -> Result<(), String> {
    let Some(file) = files.first().map(|file| file.path.as_str()) else { return Ok(()) };
    let Some((document, text)) = cx.pos.doc(file) else { return Ok(()) };
    let Ok(data) = document.to_value(Schema::Plain, text) else { return Ok(()) };
    let data = if data.is_null() { Value::Map(JsMap::new()) } else { data };
    let Value::Map(top) = &data else { return Ok(()) };
    let mut gh = Github { cx, file, when: tr!("right-on-push-github-checks") };

    for key in top.keys() {
        if !GH_TOP.contains(&key.as_str()) {
            gh.issue(&kp![key], draft!("gh-unknown-top", Error, title = tr!("unknown-section", q(key)), how = gh_rejected(format!("Unexpected value '{key}'")), why = tr!("allowed-at-top-level", GH_TOP.join(", "), did_you_mean(key, GH_TOP)), fix = tr!("fix-or-delete-section")));
        }
    }
    let on = non_null(data.get("on")).or_else(|| data.get("true"));
    if on.is_none() {
        gh.issue(&[], draft!("gh-no-on", Error, title = tr!("when-to-run-isnt-specified"), how = gh_rejected("Required property is missing: on"), why = tr!("without-on-github-doesnt-know"), fix = "on:\n  push:\n    branches: [main]\n  pull_request:"));
    }
    if data.get("jobs").is_none() {
        gh.issue(&[], draft!("gh-no-jobs", Error, title = tr!("no-jobs-section"), how = gh_rejected("Required property is missing: jobs"), why = tr!("workflow-without-jobs-does-nothing"), fix = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5"));
    }

    // События
    let mut events = JsMap::new();
    match on {
        Some(Value::String(name)) => events.insert(name.clone(), Value::Null),
        Some(Value::Seq(items)) => {
            for item in items {
                events.insert(item.js_string(), Value::Null);
            }
        }
        Some(Value::Map(map)) => events = map.clone(),
        _ => {}
    }
    let on_is_list = matches!(on, Some(Value::Seq(_)));
    let on_is_text = matches!(on, Some(Value::String(_)));
    for (position, (event, cfg)) in events.iter().enumerate() {
        let path: Vec<PathItem> = if on_is_list {
            kp!["on", position]
        } else if on_is_text {
            kp!["on"]
        } else {
            kp!["on", event]
        };
        if !GH_EVENTS.contains(&event.as_str()) {
            gh.issue(&path, draft!("gh-event-unknown", Error, title = tr!("unknown-event", q(event)), how = gh_rejected(format!("Unexpected value '{event}'")), why = tr!("github-doesnt-know-this-event", did_you_mean(event, GH_EVENTS)), fix = tr!("fix-event-name")));
            continue;
        }
        if let Value::Map(config) = cfg {
            if matches!(event.as_str(), "push" | "pull_request" | "pull_request_target") {
                for key in config.keys() {
                    if !GH_FILTERS.contains(&key.as_str()) {
                        gh.issue(&extend(&path, kp![key]), draft!("gh-filter-unknown", Error, title = tr!("unknown-filter", event, q(key)), how = gh_rejected(format!("Unexpected value '{key}'")), why = tr!("allowed", GH_FILTERS.join(", "), did_you_mean(key, GH_FILTERS)), fix = tr!("fix-key")));
                    }
                }
                for (a, b) in [("branches", "branches-ignore"), ("tags", "tags-ignore"), ("paths", "paths-ignore")] {
                    if config.contains_key(a) && config.contains_key(b) {
                        gh.issue(&extend(&path, kp![b]), draft!("gh-filter-both", Error, title = tr!("and-together", event, a, b), how = gh_rejected(format!("you may only define one of `{a}` and `{b}` for a single event")), why = tr!("you-cant-include-and-exclude"), fix = tr!("keep-and-add-exclusions-with", a)));
                    }
                }
            }
            if matches!(event.as_str(), "workflow_dispatch" | "workflow_call") {
                let empty = JsMap::new();
                let inputs = config.get("inputs").and_then(Value::as_map).unwrap_or(&empty);
                if inputs.len() > 25 {
                    gh.issue(&extend(&path, kp!["inputs"]), draft!("gh-inputs-limit", Error, title = tr!("more-than-25-inputs", event), how = gh_rejected("you may only define up to 25 `inputs` for a `workflow_dispatch` event"), why = tr!("github-limit"), fix = tr!("combine-inputs-for-example-json")));
                }
                for (name, input) in inputs.iter() {
                    if !matches!(input, Value::Map(_)) {
                        continue;
                    }
                    let types: &[&str] = if event == "workflow_call" { &["string", "boolean", "number"] } else { &GH_INPUT_TYPES };
                    let input_type = input.get("type");
                    let is_type = |wanted: &str| input_type.and_then(Value::as_str) == Some(wanted);
                    if let Some(kind) = input_type
                        && !kind.as_str().is_some_and(|kind| types.contains(&kind))
                    {
                        gh.issue(&extend(&path, kp!["inputs", name, "type"]), draft!("gh-input-type", Error, title = tr!("input-type", q(name), q(kind.js_string())), how = gh_rejected(format!("Unexpected value '{}'", kind.js_string())), why = tr!("allowed-types", types.join(", "), did_you_mean(&kind.js_string(), types.iter().copied())), fix = "type: string"));
                    }
                    let options = crate::load_common_as_array(input.get("options"));
                    if is_type("choice") && options.is_empty() {
                        gh.issue(&extend(&path, kp!["inputs", name]), draft!("gh-choice-no-options", Error, title = tr!("input-choice-without-options", q(name)), how = gh_rejected("Required property is missing: options"), why = tr!("picking-from-list-needs-list"), fix = "options:\n  - staging\n  - production"));
                    }
                    let default = input.get("default");
                    if is_type("choice")
                        && let Some(default_value) = default
                        && !options.is_empty()
                        && !options.iter().any(|option| option.js_string() == default_value.js_string())
                    {
                        let list = crate::yaml::js_join(options.iter().copied(), ", ");
                        gh.issue(&extend(&path, kp!["inputs", name, "default"]), draft!("gh-choice-default", Error, title = tr!("input-default-isnt-in-options", q(name)), how = gh_rejected(format!("Default value '{}' is not in the list of options", default_value.js_string())), why = format!("options: {list}."), fix = tr!("set-default-to-value-from")));
                    }
                    if is_type("boolean")
                        && let Some(default_value) = default
                        && !matches!(default_value, Value::Bool(_))
                    {
                        gh.issue(&extend(&path, kp!["inputs", name, "default"]), draft!("gh-boolean-default", Warning, title = tr!("input-default-for-boolean", q(name), default_value.json_string()), how = tr!("default-value-will-be-treated"), why = tr!("boolean-expects-true-false-without"), fix = "default: false"));
                    }
                }
            }
        }
        if event == "schedule" {
            let list = crate::load_common_as_array(Some(cfg));
            if list.is_empty() {
                gh.issue(&path, draft!("gh-schedule-empty", Error, title = tr!("schedule-without-cron"), how = gh_rejected("Required property is missing: cron"), why = tr!("schedule-is-required"), fix = "schedule:\n  - cron: '0 3 * * *'"));
            }
            for (index, item) in list.into_iter().enumerate() {
                let Some(cron) = item.get("cron") else {
                    gh.issue(&extend(&path, kp![index]), draft!("gh-schedule-format", Error, title = tr!("schedule-entry-without-cron"), how = gh_rejected("Required property is missing: cron"), why = tr!("each-schedule-entry-is-cron"), fix = "- cron: '0 3 * * *'"));
                    continue;
                };
                let cron_text = cron.js_string();
                let sub = extend(&path, kp![index, "cron"]);
                match cron_problem(&cron_text) {
                    Cron::Error(error) => {
                        let mut chars = error.chars();
                        let capital = chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect());
                        gh.issue(&sub, draft!("gh-cron-invalid", Error, title = tr!("invalid-schedule", q(&cron_text)), how = gh_rejected(format!("Invalid cron expression '{cron_text}'")), why = format!("{capital}."), fix = tr!("for-example-30-2-1")));
                    }
                    Cron::Frequent => {
                        gh.issue(&sub, draft!("gh-cron-frequent", Warning, title = tr!("schedule-more-often-than-every", q(&cron_text)), when = tr!("on-schedule"), how = tr!("github-will-still-run-it"), why = tr!("minimum-schedule-interval-in-actions"), fix = tr!("use-5-or-less-often")));
                    }
                    Cron::Fine => {
                        gh.issue(&sub, draft!("gh-cron-utc", Info, title = tr!("schedule-in-utc", q(&cron_text)), when = tr!("on-schedule"), how = tr!("it-will-run-on-utc"), why = tr!("thats-how-schedules-work-in"), fix = tr!("convert-time-to-utc-moscow")));
                    }
                }
            }
        }
    }
    let pr_target = events.contains_key("pull_request_target");

    gh.check_perms(data.get("permissions"), &kp!["permissions"]);

    let empty = JsMap::new();
    let jobs = data.get("jobs").and_then(Value::as_map).unwrap_or(&empty);
    let job_ids: Vec<&str> = jobs.keys().map(String::as_str).collect();

    let mut strings = Vec::new();
    all_strings(&data, &[], &mut strings);
    for (text, path) in strings {
        let mut from = 0;
        while let Some(found) = text[from..].find("${{") {
            let start = from + found;
            match text[start + 3..].find("}}") {
                Some(end) => from = start + 3 + end + 2,
                None => {
                    let shown = if gorynych_core::js::utf16_len(&text) > 60 { format!("{}…", String::from_utf16_lossy(&text.encode_utf16().take(60).collect::<Vec<_>>())) } else { text.clone() };
                    gh.issue(&path, draft!("gh-expr-unclosed", Error, title = tr!("unclosed-expression"), how = gh_rejected("An expression was expected / Unexpected end of expression"), why = tr!("has-no-closing", q(shown)), fix = tr!("add")));
                    break;
                }
            }
        }
    }

    let mut graph: indexmap::IndexMap<String, Vec<String>> = indexmap::IndexMap::new();
    for (id, job) in jobs.iter() {
        let base = kp!["jobs", id];
        if !re!(r"^[A-Za-z_][A-Za-z0-9_-]*$").test(id) {
            let cleaned = re!(r"[^A-Za-z0-9_-]").replace_all(id, "-");
            let fixed = if cleaned.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') { cleaned } else { format!("_{cleaned}") };
            gh.job_issue(&base, id, draft!("gh-job-id", Error, title = tr!("invalid-job-id", q(id)), how = gh_rejected(format!("The identifier '{id}' is invalid. IDs may only contain alphanumeric characters, '_', and '-'. IDs must start with a letter or '_' and and must be less than 100 characters.")), why = tr!("job-id-is-latin-letters"), fix = tr!("rename-it-to-set-human", fixed)));
        }
        let Value::Map(job_map) = job else {
            gh.job_issue(&base, id, draft!("gh-job-type", Error, title = tr!("job-must-be-map", q(id)), how = gh_rejected(format!("Unexpected value '{}'", job.js_string())), why = tr!("job-is-described-by-keys"), fix = format!("{id}:\n  runs-on: ubuntu-latest\n  steps: …")));
            continue;
        };
        for key in job_map.keys() {
            if !GH_JOB.contains(&key.as_str()) {
                let hint = if key == "script" || key == "run" { tr!("commands-are-written-in-steps") } else { String::new() };
                gh.job_issue(&extend(&base, kp![key]), id, draft!("gh-job-key", Error, title = tr!("unknown-key", q(id), q(key)), how = gh_rejected(format!("Unexpected value '{key}'")), why = tr!("allowed-2", GH_JOB.join(", "), did_you_mean(key, GH_JOB), hint), fix = tr!("fix-key")));
            }
        }
        gh.check_perms(job.get("permissions"), &extend(&base, kp!["permissions"]));
        let needs: Vec<String> = crate::load_common_as_array(job.get("needs")).into_iter().map(Value::js_string).collect();
        graph.insert(id.clone(), needs.clone());
        for (index, need) in needs.iter().enumerate() {
            if !job_ids.contains(&need.as_str()) {
                let sub = if matches!(job.get("needs"), Some(Value::Seq(_))) { kp!["needs", index] } else { kp!["needs"] };
                gh.job_issue(&extend(&base, sub), id, draft!("gh-needs-unknown", Error, title = tr!("needs-on-unknown", q(id), q(need)), how = gh_rejected(format!("Job '{id}' depends on unknown job '{need}'.")), why = tr!("theres-no-job-with-id", q(need), did_you_mean(need, job_ids.iter().copied())), fix = tr!("fix-id")));
            }
        }
        if let Some(uses) = job.get("uses") {
            let uses = uses.js_string();
            let sub = extend(&base, kp!["uses"]);
            if job.get("runs-on").is_some() || job.get("steps").is_some() {
                gh.job_issue(&sub, id, draft!("gh-reusable-mixed", Error, title = tr!("uses-together-with-runs-on", q(id)), how = gh_rejected("Unexpected value 'runs-on'"), why = tr!("job-that-calls-reusable-workflow"), fix = tr!("keep-uses-with-secrets-or")));
            }
            if uses.starts_with("./") && !gh.cx.repo.has_file(&re!(r"@.*$").replace_all(&uses, "")) {
                gh.job_issue(&sub, id, draft!("gh-reusable-missing", Error, title = tr!("no-file", q(id), uses), how = gh_rejected(format!("error parsing called workflow \"{uses}\": failed to fetch workflow: workflow was not found.")), why = tr!("file-isnt-in-repository"), fix = tr!("check-path-github-workflows-yml")));
            } else if !uses.starts_with("./") && !uses.contains('@') {
                gh.job_issue(&sub, id, draft!("gh-reusable-ref", Error, title = tr!("uses-without-version", q(id)), how = gh_rejected("invalid value workflow reference: no version specified"), why = tr!("workflow-from-another-repository-needs"), fix = format!("{uses}@main")));
            }
            continue;
        }
        let runs_on = job.get("runs-on");
        if runs_on.is_none() {
            gh.job_issue(&base, id, draft!("gh-no-runs-on", Error, title = tr!("runs-on-isnt-specified", q(id)), how = gh_rejected("Required property is missing: runs-on"), why = tr!("job-must-know-which-machine"), fix = "runs-on: ubuntu-latest"));
        }
        let labels: Vec<String> = match runs_on {
            Some(map @ Value::Map(_)) => crate::load_common_as_array(map.get("labels")).into_iter().map(Value::js_string).collect(),
            other => crate::load_common_as_array(other).into_iter().map(Value::js_string).collect(),
        };
        let when_running = tr!("when-job-runs", q(id));
        let when_executing = tr!("when-job-runs-2", q(id));
        for label in &labels {
            if let Some(date) = retired_runner(label) {
                let replacement = if label.starts_with("ubuntu") {
                    "ubuntu-24.04"
                } else if label.starts_with("macos") {
                    "macos-15"
                } else {
                    "windows-2025"
                };
                gh.job_issue(&extend(&base, kp!["runs-on"]), id, draft!("gh-runner-retired", Error, title = tr!("runner-no-longer-exists", q(id), label), when = when_running.clone(), how = tr!("job-wont-start-this-request", label, date), why = tr!("github-removes-old-runner-images"), fix = tr!("runs-on-or-latest", replacement, label.split('-').next().unwrap_or_default())));
            }
        }
        let windows_or_mac = labels.iter().any(|label| label.starts_with("windows") || label.starts_with("macos"));
        if job.get("container").is_some() && windows_or_mac {
            gh.job_issue(&extend(&base, kp!["container"]), id, draft!("gh-container-os", Error, title = tr!("container-on", q(id), labels.join(", ")), when = when_running.clone(), how = tr!("job-will-fail-on-first"), why = tr!("containers-in-actions-work-only"), fix = "runs-on: ubuntu-latest"));
        }
        if let Some(timeout) = job.get("timeout-minutes")
            && js_number(Some(timeout)) > 360.0
            && !labels.iter().any(|label| label == "self-hosted")
        {
            gh.job_issue(&extend(&base, kp!["timeout-minutes"]), id, draft!("gh-timeout-limit", Info, title = tr!("timeout-minutes-more-than-6", q(id), arg(timeout)), when = when_executing.clone(), how = tr!("on-github-runners-job-will"), why = tr!("github-hosted-runner-limit-is"), fix = tr!("split-work-into-parts-or")));
        }

        // strategy / matrix
        let mut matrix_keys: Vec<String> = Vec::new();
        if let Some(matrix @ Value::Map(matrix_map)) = job.get("strategy").and_then(|strategy| strategy.get("matrix")) {
            let mut total = 1usize;
            for (key, value) in matrix_map.iter() {
                if key == "include" {
                    for item in crate::load_common_as_array(Some(value)) {
                        if let Value::Map(map) = item {
                            for inner in map.keys() {
                                if !matrix_keys.contains(inner) {
                                    matrix_keys.push(inner.clone());
                                }
                            }
                        }
                    }
                } else if key != "exclude" {
                    if !matrix_keys.contains(key) {
                        matrix_keys.push(key.clone());
                    }
                    if let Value::Seq(items) = value {
                        total = total.saturating_mul(items.len().max(1));
                    }
                }
            }
            total = total.saturating_add(crate::load_common_as_array(matrix.get("include")).len());
            if total > 256 {
                gh.job_issue(&extend(&base, kp!["strategy", "matrix"]), id, draft!("gh-matrix-limit", Error, title = tr!("matrix-produces-jobs", q(id), total), how = gh_rejected("Strategy matrix: the maximum of 256 jobs per workflow run was exceeded"), why = tr!("at-most-256-combinations"), fix = tr!("reduce-matrix-values")));
            }
        }

        // Шаги
        let steps = job.get("steps");
        match steps {
            None => gh.job_issue(&base, id, draft!("gh-no-steps", Error, title = tr!("no-steps", q(id)), how = gh_rejected("Required property is missing: steps"), why = tr!("job-has-nothing-to-run"), fix = "steps:\n  - uses: actions/checkout@v5\n  - run: echo ok")),
            Some(Value::Seq(items)) if !items.is_empty() => {}
            Some(_) => gh.job_issue(&extend(&base, kp!["steps"]), id, draft!("gh-steps-empty", Error, title = tr!("steps-is-empty-or-not", q(id)), how = gh_rejected("A sequence was expected"), why = tr!("steps-is-list-of-steps"), fix = "steps:\n  - run: echo ok")),
        }
        let step_list = crate::load_common_as_array(steps);
        let mut step_ids: Vec<String> = Vec::new();
        for step in &step_list {
            if let Some(step_id) = step.get("id").filter(|value| value.truthy()) {
                let text = step_id.js_string();
                if !step_ids.contains(&text) {
                    step_ids.push(text);
                }
            }
        }
        let mut checked_out = false;
        let mut used_repo: Option<(usize, String)> = None;
        let image = match job.get("container") {
            Some(container @ Value::Map(_)) => container.get("image").filter(|value| value.truthy()).map(Value::js_string),
            Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
            _ => None,
        };
        let mut script_job = ScriptJob {
            name: id.clone(),
            file: Some(file.to_owned()),
            line: gh.line(&base),
            image,
            system: "github",
            where_text: Some(tr!("job", q(id))),
            ..ScriptJob::default()
        };
        for (index, step) in step_list.iter().copied().enumerate() {
            let step_path = extend(&base, kp!["steps", index]);
            let label = match step.get("name").filter(|value| value.truthy()) {
                Some(name) => q(name.js_string()),
                None => tr!("step", index + 1),
            };
            let Value::Map(step_map) = step else {
                gh.job_issue(&step_path, id, draft!("gh-step-type", Error, title = tr!("isnt-map", q(id), label), how = gh_rejected("A mapping was expected"), why = tr!("step-is-set-of-keys"), fix = "- run: echo ok"));
                continue;
            };
            for key in step_map.keys() {
                if !GH_STEP.contains(&key.as_str()) {
                    gh.job_issue(&extend(&step_path, kp![key]), id, draft!("gh-step-key", Error, title = tr!("unknown-key-2", q(id), label, q(key)), how = gh_rejected(format!("Unexpected value '{key}'")), why = tr!("allowed", GH_STEP.join(", "), did_you_mean(key, GH_STEP)), fix = tr!("fix-key")));
                }
            }
            let (uses, run) = (step.get("uses"), step.get("run"));
            if uses.is_some() && run.is_some() {
                gh.job_issue(&step_path, id, draft!("gh-step-both", Error, title = tr!("has-both-uses-and-run", q(id), label), how = gh_rejected("a step cannot have both the `uses` and `run` keys"), why = tr!("step-either-calls-action-or"), fix = tr!("split-it-into-two-steps")));
            }
            if uses.is_none() && run.is_none() {
                gh.job_issue(&step_path, id, draft!("gh-step-none", Error, title = tr!("has-neither-uses-nor-run", q(id), label), how = gh_rejected("Required property is missing: uses or run"), why = tr!("step-has-nothing-to-do"), fix = "- run: echo ok"));
            }
            if let Some(condition) = step.get("if") {
                gh.check_if(condition, &extend(&step_path, kp!["if"]), id, false);
            }
            if let Some(uses) = uses {
                let uses_text = uses.js_string();
                let uses_path = extend(&step_path, kp!["uses"]);
                if re!(r"^actions\/checkout(@|$)", "i").test(&uses_text) {
                    checked_out = true;
                    let reference = step.get("with").filter(|with| matches!(with, Value::Map(_))).and_then(|with| non_null(with.get("ref"))).map_or_else(String::new, Value::js_string);
                    if pr_target && re!(r"github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref").test(&reference) {
                        gh.job_issue(&extend(&step_path, kp!["with", "ref"]), id, draft!("gh-pwn-request", Warning, title = tr!("pull-request-target-checkout-of", q(id)), when = tr!("on-pull-request-from-fork"), how = tr!("code-from-someone-elses-pr"), why = tr!("pull-request-target-runs-in"), fix = tr!("use-pull-request-or-dont")));
                    }
                }
                if uses_text.starts_with("./") {
                    let dir = uses_text.trim_end_matches('/');
                    let inner: String = dir.chars().skip(2).collect();
                    if !checked_out {
                        gh.job_issue(&uses_path, id, draft!("gh-local-before-checkout", Error, title = tr!("local-action-before-checkout", q(id), uses_text), when = when_executing.clone(), how = tr!("step-will-fail-cant-find", inner), why = tr!("repository-files-appear-on-runner"), fix = tr!("put-uses-actions-checkout-v5")));
                    } else if !["action.yml", "action.yaml", "Dockerfile"].iter().any(|name| gh.cx.repo.has_file(&format!("{dir}/{name}"))) {
                        gh.job_issue(&uses_path, id, draft!("gh-local-missing", Error, title = tr!("no-action", q(id), uses_text), when = when_executing.clone(), how = tr!("step-will-fail-cant-find-action", inner), why = tr!("has-no-action-yml", q(dir)), fix = tr!("check-path")));
                    }
                } else if !uses_text.starts_with("docker://") {
                    if !uses_text.contains('@') {
                        gh.job_issue(&uses_path, id, draft!("gh-uses-no-ref", Error, title = tr!("without-version", q(id), uses_text), how = gh_rejected("the `uses' attribute must be a path, a Docker image, or owner/repo@ref"), why = tr!("action-from-another-repository-needs"), fix = tr!("v1-better-full-commit-sha", uses_text)));
                    } else {
                        let mut parts = uses_text.split('@');
                        let name = parts.next().unwrap_or_default();
                        let reference = parts.next().unwrap_or_default();
                        let major = re!(r"^v(\d+)").exec(reference).and_then(|groups| groups[1].clone());
                        let lower = name.to_lowercase();
                        if let Some((_, last, is_error, text, fixed)) = OLD_ACTIONS.iter().find(|item| item.0 == lower)
                            && major.as_deref().is_some_and(|major| number_of_text(major) <= *last)
                        {
                            let severity = if *is_error { crate::load::model::CiSeverity::Error } else { crate::load::model::CiSeverity::Warning };
                            let mut item = draft!("gh-action-old", Warning, title = tr!("is-deprecated", q(id), uses_text), when = when_executing.clone(), how = tr!(text), why = tr!("versions-of-before-are-disabled", name, fixed), fix = format!("uses: {name}@{fixed}"));
                            item.severity = severity;
                            gh.job_issue(&uses_path, id, item);
                        }
                        if !name.starts_with("actions/") && matches!(reference, "main" | "master") {
                            gh.job_issue(&uses_path, id, draft!("gh-action-branch", Info, title = tr!("by-branch", q(id), uses_text), when = tr!("on-every-run"), how = tr!("action-can-change-at-any"), why = tr!("branch-reference-to-third-party"), fix = tr!("specify-tag-or-full-commit")));
                        }
                    }
                }
            }
            if let Some(run) = run {
                let text = run.js_string();
                let run_path = extend(&step_path, kp!["run"]);
                if re!(r"::set-output\b|::save-state\b").test(&text) {
                    gh.job_issue(&run_path, id, draft!("gh-set-output", Warning, title = tr!("set-output-is-deprecated", q(id), label), when = when_executing.clone(), how = tr!("it-now-shows-warning-set"), why = tr!("set-output-save-state-commands"), fix = "echo \"name=value\" >> \"$GITHUB_OUTPUT\""));
                }
                if re!(r"::set-env\b|::add-path\b").test(&text) {
                    gh.job_issue(&run_path, id, draft!("gh-set-env", Error, title = tr!("set-env-add-path-are", q(id), label), when = when_executing.clone(), how = tr!("step-will-fail-set-env"), why = tr!("commands-were-disabled-for-security"), fix = "echo \"NAME=value\" >> \"$GITHUB_ENV\"; echo \"/path\" >> \"$GITHUB_PATH\""));
                }
                if let Some(groups) = re!(r"\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|review_comment|discussion|head_commit|commits)[\w.[\]*]*\.(title|body|message|name|email|label|ref)|head_ref)\s*\}\}").exec(&text) {
                    let whole = groups[0].clone().unwrap_or_default();
                    gh.job_issue(&run_path, id, draft!("gh-script-injection", Warning, title = tr!("right-in-command", q(id), label, whole), when = tr!("when-issue-pr-author-is"), how = tr!("text-from-title-description-is"), why = tr!("expressions-are-substituted-before-shell"), fix = format!("env:\n  TITLE: {whole}\nrun: echo \"$TITLE\"")));
                }
                if !checked_out
                    && used_repo.is_none()
                    && re!(r"(^|\s|&&|;)(\.\/|npm (ci|install|run|test)|yarn|pnpm|make\b|mvn|gradle|\.\/gradlew|go (build|test)|cargo|pip install -r|python [\w./-]+\.py|docker build|composer install|bundle install)", "m").test(&text)
                {
                    let suffix = step.get("name").filter(|value| value.truthy()).map_or_else(String::new, |name| format!(" ({})", name.js_string()));
                    used_repo = Some((index, tr!("step-2", index + 1, suffix)));
                }
                let line_base = gh.line(&run_path);
                let multi = text.contains('\n');
                let directory = non_null(step.get("working-directory"))
                    .or_else(|| non_null(job.get("defaults").and_then(|defaults| defaults.get("run")).and_then(|run| run.get("working-directory"))))
                    .or_else(|| non_null(data.get("defaults").and_then(|defaults| defaults.get("run")).and_then(|run| run.get("working-directory"))));
                if checked_out {
                    let cwd = match directory {
                        Some(directory) if !directory.js_string().contains('$') => re!(r"^\.\/?").replace_all(&directory.js_string(), ""),
                        Some(_) => "\u{0}".to_owned(),
                        None => String::new(),
                    };
                    for (at, line_text) in text.split('\n').enumerate() {
                        script_job.lines.push(ScriptLine {
                            text: line_text.to_owned(),
                            line: line_base.map(|base| base + if multi { at as u32 + 1 } else { 0 }),
                            file: None,
                            reset: at == 0,
                            cwd: Some(cwd.clone()),
                        });
                    }
                }
            }
            let mut step_strings = Vec::new();
            all_strings(step, &[], &mut step_strings);
            for (text, sub) in step_strings {
                let path = extend(&step_path, sub);
                for groups in re!(r"\bsteps\.([A-Za-z_][\w-]*)\.").match_all(&text) {
                    let name = groups[1].clone().unwrap_or_default();
                    if !step_ids.contains(&name) {
                        gh.job_issue(&path, id, draft!("gh-step-ref", Warning, title = tr!("steps-no-step-with-this", q(id), name), when = when_executing.clone(), how = tr!("expression-will-give-empty-string"), why = tr!("job-has-no-step-with", name, did_you_mean(&name, step_ids.iter().map(String::as_str))), fix = tr!("add-id-to-right-step", name)));
                    }
                }
                for groups in re!(r"\bmatrix\.([A-Za-z_][\w-]*)").match_all(&text) {
                    let name = groups[1].clone().unwrap_or_default();
                    if !matrix_keys.contains(&name) {
                        let why = if matrix_keys.is_empty() { tr!("job-has-no-strategy-matrix") } else { tr!("matrix-has", matrix_keys.join(", ")) };
                        gh.job_issue(&path, id, draft!("gh-matrix-ref", Warning, title = tr!("matrix-no-such-dimension", q(id), name), when = when_executing.clone(), how = tr!("empty-string-will-be-substituted"), why = why, fix = tr!("fix-name-or-add-it")));
                    }
                }
                for groups in re!(r"\bneeds\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)").match_all(&text) {
                    let (name, output) = (groups[1].clone().unwrap_or_default(), groups[2].clone().unwrap_or_default());
                    if !needs.contains(&name) {
                        let fixed: Vec<&str> = needs.iter().map(String::as_str).chain([name.as_str()]).collect();
                        gh.job_issue(&path, id, draft!("gh-needs-outputs", Warning, title = tr!("needs-outputs-without-needs", q(id), name, name), when = when_executing.clone(), how = tr!("value-will-be-empty-jobs"), why = tr!("isnt-listed-in-needs-of", q(&name), q(id)), fix = format!("needs: [{}]", fixed.join(", "))));
                    } else if let Some(Value::Map(outputs)) = jobs.get(&name).and_then(|other| other.get("outputs"))
                        && !outputs.contains_key(&output)
                    {
                        let list: Vec<&str> = outputs.keys().map(String::as_str).collect();
                        gh.job_issue(&path, id, draft!("gh-output-missing", Warning, title = tr!("has-no-output", q(id), q(&name), q(&output)), when = when_executing.clone(), how = tr!("empty-string-will-be-substituted"), why = tr!("outputs-of-job", q(&name), list.join(", ")), fix = tr!("fix-name-or-declare-output")));
                    }
                }
            }
        }
        if let Some(condition) = job.get("if") {
            gh.check_if(condition, &extend(&base, kp!["if"]), id, true);
        }
        if let Some((index, label)) = used_repo {
            gh.job_issue(&extend(&base, kp!["steps", index]), id, draft!("gh-no-checkout", Warning, title = tr!("no-actions-checkout-before", q(id), label), when = when_executing.clone(), how = tr!("command-will-fail-clean-runner"), why = tr!("repository-code-appears-on-runner"), fix = tr!("as-first-step-uses-actions")));
        }
        if checked_out && !windows_or_mac {
            check_scripts(std::slice::from_ref(&script_job), gh.cx, "github")?;
        } else {
            for line in &script_job.lines {
                for (regex, what) in SECRET_VALUE.iter() {
                    if regex.is_match(&line.text) {
                        gh.cx.add(draft!("secret-in-script", Error, title = tr!("step-of-job-has-in", q(id), tr!(what)), when = tr!("right-now-file-is-in"), how = tr!("everyone-with-access-to-repository"), why = tr!("secrets-must-be-stored-in"), fix = tr!("revoke-key-and-use-secrets"), file = file.to_owned(), line = line.line, job = id.clone()));
                    }
                }
            }
        }
    }

    // Циклы needs
    fn dfs(node: &str, graph: &indexmap::IndexMap<String, Vec<String>>, stack: &mut Vec<String>) -> Option<Vec<String>> {
        if let Some(at) = stack.iter().position(|item| item == node) {
            let mut cycle = stack[at..].to_vec();
            cycle.push(node.to_owned());
            return Some(cycle);
        }
        stack.push(node.to_owned());
        for dep in graph.get(node).into_iter().flatten() {
            if !graph.contains_key(dep) {
                continue;
            }
            if let Some(found) = dfs(dep, graph, stack) {
                return Some(found);
            }
        }
        stack.pop();
        None
    }
    let mut reported: HashSet<String> = HashSet::new();
    for start in &job_ids {
        let Some(cycle) = dfs(start, &graph, &mut Vec::new()) else { continue };
        let mut unique: Vec<&str> = cycle.iter().map(String::as_str).collect::<HashSet<_>>().into_iter().collect();
        unique.sort_by(|a, b| gorynych_core::js::utf16_cmp(a, b));
        if reported.insert(unique.join(",")) {
            gh.issue(&kp!["jobs", &cycle[0], "needs"], draft!("gh-needs-cycle", Error, title = tr!("jobs-wait-for-each-other", cycle.join(" → ")), how = gh_rejected(format!("Job '{}' depends on job '{}' which creates a cycle in the dependency graph.", cycle[0], cycle[1])), why = tr!("none-of-jobs-can-start"), fix = tr!("remove-one-of-dependencies"), job = cycle[0].clone()));
        }
    }
    Ok(())
}
