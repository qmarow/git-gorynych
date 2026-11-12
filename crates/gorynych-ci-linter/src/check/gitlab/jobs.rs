//! Разбор заданий, циклы `needs` и команды скриптов из `checkGitlab`.

use gorynych_core::js;

use super::catalog::*;
use super::{Gl, config_when, extend, rejected};
use crate::check::base::*;
use crate::check::scripts::{ScriptJob, ScriptLine, check_scripts};
use crate::load::model::CiSeverity;
use crate::load_common_as_array as arr;
use crate::load_common_non_null as non_null;
use crate::yaml::{PathItem, Value};

/// `array.flat(10)`.
pub(super) fn flat10(items: Vec<&Value>) -> Vec<&Value> {
    fn walk<'a>(value: &'a Value, depth: usize, out: &mut Vec<&'a Value>) {
        match value {
            Value::Seq(items) if depth > 0 => items.iter().for_each(|item| walk(item, depth - 1, out)),
            other => out.push(other),
        }
    }
    let mut out = Vec::new();
    for item in items {
        walk(item, 10, &mut out);
    }
    out
}

fn is_integer(value: &Value) -> bool {
    matches!(value, Value::Number(number) if number.is_finite() && number.fract() == 0.0)
}

fn name_of(item: &Value) -> Option<Value> {
    match item {
        Value::String(_) => Some(item.clone()),
        other => non_null(other.get("name")).cloned(),
    }
}

fn job_of(item: &Value) -> Option<Value> {
    match item {
        Value::String(_) => Some(item.clone()),
        other => other.get("job").cloned(),
    }
}

/// `String(value).replace(/\/\*\*?$/, '')`.
fn artifact_root(path: &Value) -> String {
    re!(r"\/\*\*?$").replace_all(&path.js_string(), "")
}

impl Gl<'_, '_> {
    pub(super) fn resolved(&self, name: &str) -> Option<&Value> {
        self.resolved.get(name)
    }

    pub(super) fn stage_of(&self, name: &str) -> String {
        self.resolved(name).and_then(|cfg| non_null(cfg.get("stage"))).map_or_else(|| "test".to_owned(), Value::js_string)
    }

    pub(super) fn stage_index(&self, name: &str) -> usize {
        let stage = self.stage_of(name);
        self.raw.stage_names.iter().position(|item| *item == stage).unwrap_or(self.raw.stage_names.len().saturating_sub(1))
    }

    /// Проверки одного задания.
    pub(super) fn check_job(&mut self, name: &str) -> Result<(), String> {
        let cfg = self.resolved(name).cloned().unwrap_or(Value::Null);
        let own = self.raw.jobs[name].config.clone();
        let declared = self.raw.declared_stages.clone();
        let stage_names = self.raw.stage_names.clone();

        if js::utf16_len(name) > 255 {
            self.job_issue(name, &[], draft!("job-name-long", Error, title = tr!("job-name-too-long"), how = rejected("job name is too long (maximum is 255 characters)"), why = tr!("job-name-is-limited-to"), fix = tr!("shorten-name")));
        }

        for (key, _) in cfg.js_entries() {
            if JOB_KEYS.contains(&key.as_str()) {
                continue;
            }
            let near = suggest(&key, JOB_KEYS);
            let suffix = near.map_or_else(String::new, |near| tr!("typo-in", q(near)));
            let why = match near {
                Some(near) => tr!("gitlab-doesnt-know-key-closest", q(&key), q(near)),
                None => tr!("gitlab-checks-all-job-keys", q(&key), if own.get(&key).is_some() { String::new() } else { tr!("key-came-from-template-in") }),
            };
            let fix = match near {
                Some(near) => tr!("rename-to", q(&key), q(near)),
                None => tr!("remove-key-or-move-data"),
            };
            self.job_issue(name, &kp![&key], draft!("job-unknown-key", Error, title = tr!("unknown-key-3", q(name), q(&key), suffix), how = rejected(format!("jobs:{name} config contains unknown keys: {key}")), why = why, fix = fix));
        }

        let (has_script, has_trigger, has_run) = (cfg.get("script").is_some(), cfg.get("trigger").is_some(), cfg.get("run").is_some());
        if !has_script && !has_trigger && !has_run {
            let near = suggest(name, GLOBAL_KEYS);
            let id = if near.is_some() { "global-typo" } else { "job-no-script" };
            let title = match near {
                Some(near) => tr!("typo-in-2", q(name), q(near)),
                None => tr!("no-script", q(name)),
            };
            let why = if near.is_some() {
                tr!("section-isnt-reserved-so-gitlab", q(name))
            } else {
                let from_templates = cfg.get("extends").is_some_and(Value::truthy) || !self.chain_of(name).is_empty();
                tr!("job-has-no-commands-to", if from_templates { tr!("and-templates-in-extends-dont") } else { String::new() })
            };
            let fix = match near {
                Some(near) => tr!("rename-to-2", q(near)),
                None => tr!("add-script-for-example-script", name),
            };
            self.job_issue(name, &[], draft!(id, Error, title = title, how = rejected(format!("jobs:{name} config should implement the script:, run:, or trigger: keyword")), why = why, fix = fix));
        }
        if has_script && has_trigger {
            self.job_issue(name, &kp!["trigger"], draft!("trigger-with-script", Error, title = tr!("trigger-and-script-together", q(name)), how = rejected(format!("jobs:{name} config key may not be used with `trigger`: script")), why = tr!("job-with-trigger-doesnt-run"), fix = tr!("split-it-into-two-jobs")));
        }
        if has_script {
            let script = cfg.get("script");
            let lines = flat10(arr(script));
            let blank = matches!(script, Some(Value::Null)) || script.and_then(Value::as_str) == Some("") || (matches!(script, Some(Value::Seq(_))) && lines.is_empty());
            if blank {
                self.job_issue(name, &kp!["script"], draft!("script-empty", Error, title = tr!("empty-script", q(name)), how = rejected(format!("jobs:{name}:script config can't be blank")), why = tr!("script-must-have-at-least"), fix = tr!("add-command-or-delete-job")));
            }
            for key in ["script", "before_script", "after_script"] {
                for (index, item) in flat10(arr(cfg.get(key))).into_iter().enumerate() {
                    match item {
                        Value::Map(map) if crate::load::common::reference_of(item).is_none() => {
                            let first = map.keys().next().cloned();
                            let value = first.as_deref().and_then(|first| map.get(first));
                            let shown = format!("{}: {}", first.clone().unwrap_or_else(|| "undefined".to_owned()), js_str(value));
                            self.job_issue(name, &kp![key, index], draft!("script-colon", Error, title = tr!("line-was-read-as-key", q(name), key), how = rejected(format!("jobs:{name}:{key} config should be a string or a nested array of strings up to 10 levels deep")), why = tr!("line-contains-yaml-treats-it", q(shown)), fix = tr!("quote-line", first.unwrap_or_default(), arg_opt(value))));
                        }
                        Value::Bool(_) | Value::Number(_) => {
                            self.job_issue(name, &kp![key, index], draft!("script-scalar", Warning, title = tr!("in-value-is", q(name), key, arg(item)), how = tr!("command-will-run-most-likely", q(item.js_string())), why = tr!("yaml-read-string-as-number"), fix = tr!("check-string-and-quote-it")));
                        }
                        _ => {}
                    }
                }
            }
        }

        // Этап
        let stage = self.stage_of(name);
        self.used_stages.insert(stage.clone());
        if cfg.get("stage").is_some_and(|value| !matches!(value, Value::String(_))) {
            self.job_issue(name, &kp!["stage"], draft!("stage-type", Error, title = tr!("stage-must-be-string", q(name)), how = rejected(format!("jobs:{name}:stage config should be a string")), why = tr!("job-belongs-to-one-stage"), fix = "stage: test"));
        } else if !stage_names.contains(&stage) {
            let near = suggest(&stage, stage_names.iter().map(String::as_str));
            let why = if declared.is_empty() {
                tr!("stages-isnt-declared-so-only", near.map_or_else(String::new, |near| tr!("perhaps", q(near))))
            } else {
                tr!("declared-stages", declared.join(", "), near.map_or_else(String::new, |near| tr!("perhaps-you-meant", q(near))))
            };
            let fix = match near {
                Some(near) => tr!("change-it-to-stage-or", near, q(&stage)),
                None => tr!("add-to-stages", q(&stage)),
            };
            self.job_issue(name, &kp!["stage"], draft!("stage-undeclared", Error, title = tr!("stage-isnt-in-stages", q(name), q(&stage)), how = rejected(format!("{name} job: chosen stage {stage} does not exist; available stages are {}", stage_names.join(", "))), why = why, fix = fix));
        }

        // when / start_in
        let when = cfg.get("when");
        let when_text = when.and_then(Value::as_str);
        if let Some(value) = when
            && !when_text.is_some_and(|text| JOB_WHEN.contains(&text))
        {
            let allowed: Vec<&str> = JOB_WHEN.iter().copied().filter(|item| *item != "never").collect();
            self.job_issue(name, &kp!["when"], draft!("when-invalid", Error, title = format!("{}: when: {}", q(name), value.js_string()), how = rejected(format!("jobs:{name} when should be one of: {}", allowed.join(", "))), why = tr!("unknown-value", did_you_mean(&value.js_string(), JOB_WHEN)), fix = tr!("use-one-of", JOB_WHEN.join(", "))));
        }
        if when_text == Some("never") {
            self.job_issue(name, &kp!["when"], draft!("when-never", Warning, title = tr!("when-never-job-will-never", q(name)), how = tr!("job-wont-be-in-any"), why = tr!("when-never-at-job-level"), fix = tr!("delete-job-or-move-condition")));
        }
        let start_in = cfg.get("start_in");
        if when_text == Some("delayed") && start_in.is_none() {
            self.job_issue(name, &kp!["when"], draft!("delayed-no-start", Error, title = tr!("when-delayed-without-start-in", q(name)), how = rejected(format!("jobs:{name} start in should be specified for delayed job")), why = tr!("delayed-job-needs-to-know"), fix = "start_in: 30 minutes"));
        }
        if start_in.is_some() && when_text != Some("delayed") && !arr(cfg.get("rules")).iter().any(|rule| rule.get("when").and_then(Value::as_str) == Some("delayed")) {
            self.job_issue(name, &kp!["start_in"], draft!("start-in-not-delayed", Error, title = tr!("start-in-without-when-delayed", q(name)), how = rejected(format!("jobs:{name} start in must be blank when not delayed")), why = tr!("start-in-only-makes-sense"), fix = tr!("add-when-delayed-or-remove")));
        }
        if let Some(value) = start_in {
            match duration_seconds(Some(value)) {
                None => self.job_issue(name, &kp!["start_in"], draft!("start-in-format", Error, title = tr!("cant-parse-start-in", q(name), arg(value)), how = rejected(format!("jobs:{name}:start_in config should be a duration")), why = tr!("duration-is-written-as-30"), fix = "start_in: 30 minutes")),
                Some(seconds) if seconds > 7.0 * 86400.0 => self.job_issue(name, &kp!["start_in"], draft!("start-in-limit", Error, title = tr!("start-in-is-longer-than", q(name)), how = rejected(format!("jobs:{name} start in should not exceed the limit")), why = tr!("maximum-delay-is-1-week"), fix = tr!("reduce-start-in-or-use"))),
                Some(_) => {}
            }
        }

        // rules / only / except
        if let Some(rules) = cfg.get("rules") {
            self.check_rules(rules, super::rules::RuleOwner::Job { name, cfg: &cfg })?;
            for key in ["only", "except"] {
                if cfg.get(key).is_some() {
                    let from_template = if own.get(key).is_some() { String::new() } else { tr!("came-from-template", key) };
                    self.job_issue(name, &kp![key], draft!("rules-with-only", Error, title = tr!("rules-together-with", q(name), key), how = rejected(format!("jobs:{name} config key may not be used with `rules`: {key}")), why = tr!("rules-replaces-they-cant-be", key, from_template), fix = tr!("move-condition-from-to-rules", key)));
                }
            }
        } else {
            for key in ["only", "except"] {
                if let Some(value) = cfg.get(key) {
                    self.check_only(name, key, value);
                }
            }
        }

        // needs
        if cfg.get("needs").is_some() {
            let needs = arr(cfg.get("needs"));
            if needs.len() > 50 {
                self.job_issue(name, &kp!["needs"], draft!("needs-limit", Error, title = tr!("more-than-50-needs", q(name)), how = rejected(format!("{name} job: one job can only need 50 others")), why = tr!("gitlab-limit"), fix = tr!("shorten-list-or-merge-jobs")));
            }
            for (index, need) in needs.iter().enumerate() {
                self.check_need(name, index, need, &stage);
            }
        }

        // dependencies
        if cfg.get("dependencies").is_some() {
            let need_names: Option<Vec<Option<Value>>> = cfg.get("needs").map(|needs| arr(Some(needs)).into_iter().map(job_of).collect());
            for (index, dep) in arr(cfg.get("dependencies")).into_iter().enumerate() {
                let text = dep.js_string();
                let path = kp!["dependencies", index];
                let known = dep.as_str().is_some_and(|dep| self.raw.jobs.contains_key(dep));
                if !known || text.starts_with('.') {
                    self.job_issue(name, &path, draft!("dependencies-unknown", Error, title = tr!("dependencies-on-nonexistent", q(name), q(&text)), how = rejected(format!("{name} job: undefined dependency: {text}")), why = tr!("theres-no-job", q(&text), did_you_mean(&text, self.visible.iter().map(String::as_str))), fix = tr!("fix-name")));
                } else if let Some(names) = &need_names {
                    if !names.iter().any(|item| item.as_ref() == Some(dep)) {
                        self.job_issue(name, &path, draft!("dependencies-not-in-needs", Error, title = tr!("in-dependencies-but-not-in", q(name), q(&text)), how = rejected(format!("{name} job: dependencies the {text} should be part of needs")), why = tr!("when-needs-is-set-dependencies"), fix = tr!("add-to-needs", q(&text))));
                    }
                } else if self.stage_index(&text) >= self.stage_index(name) {
                    self.job_issue(name, &path, draft!("dependencies-later-stage", Error, title = tr!("isnt-from-previous-stage", q(name), q(&text)), how = rejected(format!("{name} job: dependency {text} is not defined in current or prior stages")), why = tr!("artifacts-can-only-be-taken", q(&text), q(self.stage_of(&text))), fix = tr!("move-job-or-use-needs")));
                }
            }
        }

        // variables
        self.check_variables(cfg.get("variables"), super::values::VarOwner::Job(name));

        // image / services
        if let Some(image) = cfg.get("image") {
            self.check_image(image, Some(name), &kp!["image"]);
        }
        let services_source = non_null(cfg.get("services")).or_else(|| non_null(self.defaults.get("services"))).or_else(|| self.globals.get("services")).cloned();
        for (index, service) in arr(services_source.as_ref()).into_iter().enumerate() {
            let service_name = name_of(service).filter(Value::truthy);
            let Some(service_name) = service_name else {
                self.job_issue(name, &kp!["services", index], draft!("service-no-name", Error, title = tr!("service-has-no-name", q(name)), how = rejected(format!("jobs:{name}:services:service config must have a name")), why = tr!("service-is-docker-image"), fix = "services:\n  - name: postgres:16\n    alias: db"));
                if let Some(alias) = service.get("alias").filter(|value| value.truthy()) {
                    self.check_service_alias(name, index, alias);
                }
                continue;
            };
            self.check_image_name(&service_name, Some(name), &kp!["services", index], &tr!("service"));
            if let Some(alias) = service.get("alias").filter(|value| value.truthy()) {
                self.check_service_alias(name, index, alias);
            }
        }
        if self.dind_at.is_none() {
            let dind_source = non_null(cfg.get("services")).or_else(|| self.defaults.get("services")).cloned();
            let uses_dind = arr(dind_source.as_ref()).iter().any(|service| {
                let text = match service {
                    Value::String(text) => text.clone(),
                    other => non_null(other.get("name")).map_or_else(String::new, Value::js_string),
                };
                re!(r"docker.*dind", "i").test(&text)
            });
            if uses_dind {
                let (file, line) = self.locate(name, &kp!["services"]);
                self.dind_at = Some((file, line, name.to_owned()));
            }
        }

        // artifacts и cache
        if let Some(artifacts) = cfg.get("artifacts") {
            self.check_artifacts(name, artifacts);
        }
        if let Some(cache) = cfg.get("cache") {
            self.check_cache(name, cache, &kp!["cache"]);
        }

        self.check_limits(name, &cfg);
        self.check_job_tail(name, &cfg, has_trigger)
    }

    fn check_service_alias(&mut self, name: &str, index: usize, alias: &Value) {
        if !re!(r"^[a-z0-9][a-z0-9.,-]*$", "i").test(&alias.js_string()) {
            self.job_issue(name, &kp!["services", index, "alias"], draft!("service-alias", Error, title = tr!("invalid-service-alias", q(name), q(alias.js_string())), how = tr!("job-will-fail-when-starting"), why = tr!("alias-becomes-host-name-only"), fix = tr!("for-example-alias-db")));
        }
    }

    fn check_need(&mut self, name: &str, index: usize, need: &Value, stage: &str) {
        if matches!(need, Value::Map(_)) && (need.get("pipeline").is_some_and(Value::truthy) || need.get("project").is_some_and(Value::truthy)) {
            return;
        }
        let path = kp!["needs", index];
        let Some(target) = job_of(need).filter(|value| !value.is_null()) else {
            self.job_issue(name, &path, draft!("needs-format", Error, title = tr!("needs-entry-without-job", q(name)), how = rejected(format!("jobs:{name}:needs config contains unknown keys")), why = tr!("each-needs-entry-is-job"), fix = "needs:\n  - job: build\n    artifacts: true"));
            return;
        };
        let text = target.js_string();
        let optional = matches!(need.get("optional"), Some(Value::Bool(true)));
        let known = target.as_str().is_some_and(|value| self.raw.jobs.contains_key(value));
        if target.as_str() == Some(name) {
            self.job_issue(name, &path, draft!("needs-self", Error, title = tr!("depends-on-itself", q(name)), how = rejected(format!("{name} job: needs itself (circular dependency)")), why = tr!("job-cant-wait-for-itself"), fix = tr!("remove-job-itself-from-needs")));
        } else if !known || text.starts_with('.') {
            if !optional {
                let why = if text.starts_with('.') { tr!("is-hidden-job-template-it", q(&text)) } else { tr!("theres-no-job", q(&text), did_you_mean(&text, self.visible.iter().map(String::as_str))) };
                let mut item = draft!("needs-unknown", Error, title = tr!("needs-on-nonexistent", q(name), q(&text)), how = rejected(format!("'{name}' job needs '{text}' job, but '{text}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.")), why = why, fix = tr!("fix-name-or-add-optional"));
                if !self.offline.is_empty() && !known {
                    item.severity = CiSeverity::Warning;
                }
                self.job_issue(name, &path, item);
            }
        } else if self.stage_index(&text) > self.stage_index(name) {
            let target_stage = self.stage_of(&text);
            self.job_issue(name, &path, draft!("needs-later-stage", Error, title = tr!("waits-for-from-later-stage", q(name), q(&text)), how = rejected(format!("{name} job: need {text} is not defined in current or prior stages")), why = tr!("is-in-stage-which-comes", q(&text), q(&target_stage), q(stage)), fix = tr!("move-to-stage-no-earlier", q(name), q(&target_stage), q(&text))));
        }
        if let Value::Map(map) = need {
            for key in map.keys() {
                if !matches!(key.as_str(), "job" | "artifacts" | "optional" | "pipeline" | "project" | "ref" | "parallel") {
                    self.job_issue(name, &extend(&path, kp![key]), draft!("needs-unknown-key", Error, title = tr!("needs-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:needs:need config contains unknown keys: {key}")), why = tr!("allowed-job-artifacts-optional-pipeline", did_you_mean(key, ["job", "artifacts", "optional"])), fix = tr!("remove-key")));
                }
            }
        }
    }

    /// `parallel`, `retry`, `timeout`, `allow_failure`, `coverage`, `interruptible`, `tags`, `inherit`.
    fn check_limits(&mut self, name: &str, cfg: &Value) {
        if let Some(parallel) = cfg.get("parallel") {
            match parallel {
                Value::Number(number) => {
                    if !is_integer(parallel) || *number < 1.0 || *number > 200.0 {
                        let limit = if *number > 200.0 { "less than or equal to 200" } else { "greater than or equal to 1" };
                        self.job_issue(name, &kp!["parallel"], draft!("parallel-range", Error, title = format!("{}: parallel: {}", q(name), parallel.js_string()), how = rejected(format!("jobs:{name}:parallel config must be {limit}")), why = tr!("parallel-is-integer-from-1"), fix = "parallel: 5"));
                    }
                }
                Value::Map(_) if parallel.get("matrix").is_some() => {
                    let mut total = 0f64;
                    for (index, entry) in arr(parallel.get("matrix")).into_iter().enumerate() {
                        let Value::Map(map) = entry else {
                            self.job_issue(name, &kp!["parallel", "matrix", index], draft!("matrix-format", Error, title = tr!("parallel-matrix-entry-isnt-map", q(name)), how = rejected(format!("jobs:{name}:parallel:matrix config should be an array of hashes")), why = tr!("each-matrix-entry-is-set"), fix = "parallel:\n  matrix:\n    - NODE: [\"18\", \"20\"]"));
                            continue;
                        };
                        total += map.iter().fold(1f64, |product, (_, value)| product * (arr(Some(value)).len().max(1) as f64));
                        for (key, value) in map.iter() {
                            if arr(Some(value)).iter().any(|item| matches!(item, Value::Map(_) | Value::Seq(_))) {
                                self.job_issue(name, &kp!["parallel", "matrix", index, key], draft!("matrix-value", Error, title = tr!("nested-structure-in-matrix", q(name), key), how = rejected(format!("jobs:{name}:parallel:matrix config should be an array of hashes with arrays of strings")), why = tr!("matrix-values-are-strings-or"), fix = tr!("list-values-as-list-of")));
                            }
                        }
                    }
                    if total > 200.0 {
                        self.job_issue(name, &kp!["parallel", "matrix"], draft!("matrix-limit", Error, title = tr!("matrix-produces-jobs", q(name), js::number_to_string(total)), how = rejected(format!("jobs:{name}:parallel:matrix config generates too many jobs (maximum is 200)")), why = tr!("at-most-200-combinations-per"), fix = tr!("reduce-number-of-values")));
                    }
                }
                _ => self.job_issue(name, &kp!["parallel"], draft!("parallel-format", Error, title = tr!("unrecognized-parallel", q(name)), how = rejected(format!("jobs:{name}:parallel config should be an integer or a hash")), why = tr!("parallel-is-number-or-matrix"), fix = "parallel: 3")),
            }
        }
        if let Some(retry) = cfg.get("retry") {
            let max = if matches!(retry, Value::Map(_)) { retry.get("max") } else { Some(retry) };
            if let Some(max) = max {
                let out_of_range = !is_integer(max) || matches!(max, Value::Number(number) if *number < 0.0 || *number > 2.0);
                if out_of_range {
                    self.job_issue(name, &kp!["retry"], draft!("retry-range", Error, title = format!("{}: retry {}", q(name), max.js_string()), how = rejected(format!("jobs:{name}:retry config must be between 0 and 2")), why = tr!("gitlab-retries-job-at-most"), fix = "retry: 2"));
                }
            }
            if let Value::Map(map) = retry {
                for reason in arr(retry.get("when")) {
                    if !reason.as_str().is_some_and(|text| RETRY_WHEN.contains(&text)) {
                        let text = reason.js_string();
                        self.job_issue(name, &kp!["retry", "when"], draft!("retry-when", Error, title = format!("{}: retry:when {}", q(name), q(&text)), how = rejected(format!("jobs:{name}:retry when unknown value: {text}")), why = tr!("unknown-retry-reason", did_you_mean(&text, RETRY_WHEN)), fix = tr!("allowed-3", RETRY_WHEN[..6].join(", "))));
                    }
                }
                for key in map.keys() {
                    if !matches!(key.as_str(), "max" | "when" | "exit_codes") {
                        self.job_issue(name, &kp!["retry", key], draft!("retry-key", Error, title = tr!("retry-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:retry config contains unknown keys: {key}")), why = tr!("allowed-max-when-exit-codes"), fix = tr!("remove-key")));
                    }
                }
            }
        }
        if let Some(timeout) = cfg.get("timeout") {
            match duration_seconds(Some(timeout)) {
                None => self.job_issue(name, &kp!["timeout"], draft!("timeout-format", Error, title = tr!("cant-parse-timeout", q(name), arg(timeout)), how = rejected(format!("jobs:{name}:timeout config should be a duration")), why = tr!("duration-is-written-as-1h"), fix = "timeout: 1h 30m")),
                Some(seconds) if seconds > 30.0 * 86400.0 => self.job_issue(name, &kp!["timeout"], draft!("timeout-limit", Error, title = tr!("timeout-longer-than-month", q(name)), how = rejected(format!("jobs:{name}:timeout config should not exceed the limit")), why = tr!("maximum-is-1-month"), fix = tr!("reduce-timeout"))),
                Some(_) => {}
            }
        }
        if let Some(allow) = cfg.get("allow_failure")
            && !matches!(allow, Value::Bool(_))
        {
            let ok = matches!(allow, Value::Map(map) if map.keys().all(|key| key == "exit_codes")) && arr(allow.get("exit_codes")).into_iter().all(is_integer);
            if !ok {
                self.job_issue(name, &kp!["allow_failure"], draft!("allow-failure-format", Error, title = format!("{}: allow_failure: {}", q(name), allow.json_string()), how = rejected(format!("jobs:{name}:allow_failure config should be a hash or a boolean value")), why = tr!("allow-failure-is-true-false"), fix = "allow_failure: true"));
            }
        }
        if let Some(coverage) = cfg.get("coverage") {
            match re!(r"^\/(.+)\/([a-z]*)$").exec(&coverage.js_string()) {
                None => self.job_issue(name, &kp!["coverage"], draft!("coverage-format", Error, title = tr!("coverage-isnt-regular-expression", q(name)), how = rejected(format!("jobs:{name}:coverage config must be a regular expression")), why = tr!("coverage-is-written-between-slashes"), fix = "coverage: '/Lines:\\s+(\\d+\\.?\\d*)%/'")),
                Some(groups) => {
                    if let Err(error) = crate::js_regex::JsRegex::new(groups[1].as_deref().unwrap_or_default(), "") {
                        self.job_issue(name, &kp!["coverage"], draft!("coverage-regex", Error, title = tr!("error-in-coverage-regex", q(name)), how = rejected(format!("jobs:{name}:coverage config must be a regular expression")), why = error, fix = tr!("fix-expression")));
                    }
                }
            }
        }
        if let Some(interruptible) = cfg.get("interruptible")
            && !matches!(interruptible, Value::Bool(_))
        {
            self.job_issue(name, &kp!["interruptible"], draft!("interruptible-type", Error, title = tr!("interruptible-must-be-true-false", q(name)), how = rejected(format!("jobs:{name} interruptible should be a boolean value")), why = tr!("currently", interruptible.json_string()), fix = "interruptible: true"));
        }
        if let Some(tags) = cfg.get("tags") {
            match tags {
                Value::Seq(items) if items.iter().all(|item| matches!(item, Value::String(_) | Value::Number(_))) => {
                    if !items.is_empty() {
                        let key = crate::yaml::js_join(items.iter(), ", ");
                        let (file, line) = self.locate(name, &kp!["tags"]);
                        self.tag_sets.entry(key).or_insert_with(|| (Vec::new(), file, line)).0.push(name.to_owned());
                    }
                }
                _ => self.job_issue(name, &kp!["tags"], draft!("tags-type", Error, title = tr!("tags-must-be-list-of", q(name)), how = rejected(format!("jobs:{name}:tags config should be an array of strings")), why = tr!("tags-are-given-as-list"), fix = "tags:\n  - docker")),
            }
        }
        if let Some(inherit) = cfg.get("inherit") {
            match inherit {
                Value::Map(map) => {
                    for key in map.keys() {
                        if !matches!(key.as_str(), "default" | "variables") {
                            self.job_issue(name, &kp!["inherit", key], draft!("inherit-key", Error, title = tr!("inherit-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:inherit config contains unknown keys: {key}")), why = tr!("allowed-default-and-variables"), fix = tr!("remove-key")));
                        }
                    }
                }
                _ => self.job_issue(name, &kp!["inherit"], draft!("inherit-type", Error, title = tr!("inherit-must-be-map", q(name)), how = rejected(format!("jobs:{name}:inherit config should be a hash")), why = "inherit: { default: …, variables: … }.", fix = "inherit:\n  default: false")),
            }
        }
    }

    /// `environment`, `trigger`, `pages`, `release`.
    fn check_job_tail(&mut self, name: &str, cfg: &Value, has_trigger: bool) -> Result<(), String> {
        if let Some(environment) = cfg.get("environment") {
            self.check_environment(name, environment);
        }
        if has_trigger && let Some(trigger @ Value::Map(_)) = cfg.get("trigger") {
            if trigger.get("project").is_some_and(Value::truthy) && trigger.get("include").is_some_and(Value::truthy) {
                self.job_issue(name, &kp!["trigger"], draft!("trigger-both", Error, title = tr!("trigger-with-both-project-and", q(name)), how = rejected(format!("jobs:{name}:trigger config contains unknown keys")), why = tr!("either-child-pipeline-include-or"), fix = tr!("keep-one")));
            }
            if let Some(strategy) = trigger.get("strategy")
                && !matches!(strategy.as_str(), Some("depend" | "mirror"))
            {
                self.job_issue(name, &kp!["trigger", "strategy"], draft!("trigger-strategy", Error, title = format!("{}: trigger:strategy {}", q(name), strategy.js_string()), how = rejected(format!("jobs:{name}:trigger:strategy should be one of: depend, mirror")), why = tr!("allowed-depend-and-mirror"), fix = "strategy: depend"));
            }
            for include in arr(trigger.get("include")) {
                let local = match include {
                    Value::String(_) => Some(include),
                    other => other.get("local"),
                };
                let Some(local) = local.filter(|value| value.truthy()) else { continue };
                let text = local.js_string();
                if text.contains('$') || self.cx.repo.has_file(&text) {
                    continue;
                }
                let Value::String(path) = local else { return Err("local.replace is not a function".to_owned()) };
                let stripped = path.strip_prefix('/').unwrap_or(path);
                if !self.config.files.iter().any(|file| file.path == stripped) {
                    self.job_issue(name, &kp!["trigger", "include"], draft!("trigger-include-missing", Error, title = tr!("child-pipeline-not-found", q(name), text), when = tr!("when-job-gets-its-turn", q(name)), how = tr!("child-pipeline-wont-be-created", q(name), text), why = tr!("file-isnt-in-repository"), fix = tr!("check-path-from-repository-root")));
                }
            }
        }
        if name == "pages" || cfg.get("pages").is_some() {
            let publish = non_null(cfg.get("pages").and_then(|pages| pages.get("publish"))).or_else(|| non_null(cfg.get("publish"))).map_or_else(|| "public".to_owned(), Value::js_string);
            let paths: Vec<String> = arr(cfg.get("artifacts").and_then(|artifacts| artifacts.get("paths"))).into_iter().map(Value::js_string).collect();
            let wanted = publish.trim_end_matches('/');
            if !paths.iter().any(|path| path.trim_end_matches('/') == wanted) {
                let at: Vec<PathItem> = if paths.is_empty() { Vec::new() } else { kp!["artifacts", "paths"] };
                self.job_issue(name, &at, draft!("pages-no-public", Warning, title = tr!("folder-isnt-in-artifacts", q(name), publish), when = tr!("after-job", q(name)), how = tr!("site-wont-be-published-pages", publish), why = tr!("gitlab-pages-publishes-contents-of", q(&publish)), fix = format!("artifacts:\n  paths:\n    - {publish}")));
            }
        }
        if let Some(release) = cfg.get("release") {
            let is_map = matches!(release, Value::Map(_));
            if !is_map || !release.get("tag_name").is_some_and(Value::truthy) {
                self.job_issue(name, &kp!["release"], draft!("release-no-tag", Error, title = tr!("release-without-tag-name", q(name)), how = rejected(format!("jobs:{name}:release tag name can't be blank")), why = tr!("release-is-tied-to-tag"), fix = "release:\n  tag_name: $CI_COMMIT_TAG\n  description: \"…\""));
            }
            if is_map && !release.get("description").is_some_and(Value::truthy) {
                self.job_issue(name, &kp!["release"], draft!("release-no-description", Error, title = tr!("release-without-description", q(name)), how = rejected(format!("jobs:{name}:release description can't be blank")), why = tr!("release-description-is-required"), fix = tr!("description-release-ci-commit-tag")));
            }
            let image = match cfg.get("image") {
                Some(Value::String(text)) => text.clone(),
                Some(other) => non_null(other.get("name")).map_or_else(String::new, Value::js_string),
                None => String::new(),
            };
            if !re!(r"release-cli|glab|cli").test(&image) {
                self.job_issue(name, &kp!["release"], draft!("release-image", Warning, title = tr!("release-in-image-without-release", q(name)), when = tr!("when-job-runs-2", q(name)), how = tr!("job-will-fail-release-cli"), why = tr!("release-key-is-run-by"), fix = "image: registry.gitlab.com/gitlab-org/release-cli:latest"));
            }
        }
        Ok(())
    }

    /// То, что после цикла по заданиям.
    pub(super) fn after_jobs(&mut self) {
        for stage in self.raw.declared_stages.clone() {
            if !self.used_stages.contains(&stage) && stage != ".pre" && stage != ".post" {
                self.glob_issue(&kp!["stages"], draft!("stage-unused", Info, title = tr!("stage-is-declared-but-has", q(&stage)), how = tr!("nothing-will-break-empty-stage"), why = format!("{}{stage}.", tr!("no-job-specifies-stage")), fix = tr!("remove-stage-or-check-jobs")));
            }
        }
        let globals = self.globals.clone();
        let defaults = self.defaults.clone();
        self.check_variables(globals.get("variables"), super::values::VarOwner::Global);
        if let Some(image) = defaults.get("image") {
            self.check_image(image, None, &kp!["default", "image"]);
        } else if let Some(image) = globals.get("image") {
            self.check_image(image, None, &kp!["image"]);
        }
        if let Some((first_name, file, line)) = self.only_jobs.first().cloned() {
            let count = self.only_jobs.len();
            let list: Vec<String> = self.only_jobs.iter().take(6).map(|item| q(&item.0)).collect();
            self.cx.add(draft!("only-deprecated", Info, title = tr!("only-except-are-deprecated-set", count), when = config_when(), how = tr!("it-works-for-now-but"), why = tr!("only-except-are-no-longer", list.join(", "), if count > 6 { "…" } else { "" }), fix = tr!("for-example-only-main-rules"), file = file, line = line, job = first_name));
        }
        for (tags, (jobs, file, line)) in self.tag_sets.clone() {
            let list: Vec<String> = jobs.iter().take(4).map(q).collect();
            self.cx.add(draft!("tags-runner", Info, title = tr!("needs-runner-with-tags", tags), when = tr!("when-jobs-run", list.join(", "), if jobs.len() > 4 { "…" } else { "" }), how = tr!("if-theres-no-such-runner"), why = tr!("job-is-picked-up-only"), fix = tr!("check-settings-ci-cd-runners"), file = file, line = line, job = jobs[0].clone()));
        }
        if let Some((file, line, job)) = self.dind_at.clone() {
            self.cx.add(draft!("dind-privileged", Info, title = tr!("docker-dind-requires-privileged-runner"), when = tr!("when-job-runs-2", q(&job)), how = tr!("on-runner-without-privileged-true"), why = tr!("docker-in-docker-runs-its"), fix = tr!("check-that-runner-has-privileged"), file = file, line = line, job = job));
        }
    }

    /// Циклы `needs`.
    pub(super) fn check_needs_cycles(&mut self) {
        let graph: indexmap::IndexMap<String, Vec<String>> = self
            .visible
            .iter()
            .map(|name| {
                let deps = arr(self.resolved(name).and_then(|cfg| cfg.get("needs")))
                    .into_iter()
                    .filter_map(job_of)
                    .filter(Value::truthy)
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .filter(|dep| self.visible.contains(dep) && dep != name)
                    .collect();
                (name.clone(), deps)
            })
            .collect();
        fn dfs(node: &str, graph: &indexmap::IndexMap<String, Vec<String>>, stack: &mut Vec<String>) -> Option<Vec<String>> {
            if let Some(at) = stack.iter().position(|item| item == node) {
                let mut cycle = stack[at..].to_vec();
                cycle.push(node.to_owned());
                return Some(cycle);
            }
            stack.push(node.to_owned());
            for dep in graph.get(node).into_iter().flatten() {
                if let Some(found) = dfs(dep, graph, stack) {
                    return Some(found);
                }
            }
            stack.pop();
            None
        }
        let mut seen = std::collections::HashSet::new();
        for start in self.visible.clone() {
            let Some(cycle) = dfs(&start, &graph, &mut Vec::new()) else { continue };
            let mut unique: Vec<&str> = cycle.iter().map(String::as_str).collect::<std::collections::HashSet<_>>().into_iter().collect();
            unique.sort_by(|a, b| js::utf16_cmp(a, b));
            if seen.insert(unique.join("|")) {
                self.job_issue(&cycle[0], &kp!["needs"], draft!("needs-cycle", Error, title = tr!("jobs-wait-for-each-other", cycle.join(" → ")), how = rejected("circular dependency detected in `needs`"), why = tr!("none-of-jobs-can-start-first"), fix = tr!("remove-one-of-dependencies")));
            }
        }
    }

    fn locate_job_key_prefix(&self, name: &str, key: &str) -> Option<String> {
        let mut chain = vec![name.to_owned()];
        chain.extend(self.chain_of(name));
        chain.into_iter().find(|item| self.raw.jobs.get(item).is_some_and(|entry| entry.config.get(key).is_some()))
    }

    fn script_lines_for(&self, name: &str, cfg: &Value, key: &str, inherit_default: bool) -> Vec<ScriptLine> {
        let (value, file, prefix): (&Value, String, Vec<PathItem>) = if let Some(value) = cfg.get(key) {
            let owner = self.locate_job_key_prefix(name, key).unwrap_or_else(|| name.to_owned());
            (value, self.locate(name, &kp![key]).0, kp![owner, key])
        } else if let Some(value) = self.defaults.get(key).filter(|_| inherit_default) {
            (value, self.global_loc(&kp!["default", key]).0, kp!["default", key])
        } else if let Some(value) = self.globals.get(key).filter(|_| inherit_default) {
            (value, self.global_loc(&kp![key]).0, kp![key])
        } else {
            return Vec::new();
        };
        flat10(arr(Some(value)))
            .into_iter()
            .filter_map(Value::as_str)
            .enumerate()
            .map(|(index, text)| ScriptLine {
                text: text.to_owned(),
                file: Some(file.clone()),
                line: self.cx.pos.line(&file, &extend(&prefix, kp![index])).or_else(|| self.cx.pos.line(&file, &prefix)),
                ..ScriptLine::default()
            })
            .collect()
    }

    /// Скрипты и неизвестные предопределённые переменные в них.
    pub(super) fn check_job_scripts(&mut self) -> Result<(), String> {
        let visible = self.visible.clone();
        let mut jobs = Vec::with_capacity(visible.len());
        for name in &visible {
            let cfg = self.resolved(name).cloned().unwrap_or(Value::Null);
            let inherit_default = !matches!(cfg.get("inherit").and_then(|inherit| inherit.get("default")), Some(Value::Bool(false)));
            let mut artifacts_from = Vec::new();
            let dependency_names: Vec<Option<Value>> = if cfg.get("dependencies").is_some() {
                arr(cfg.get("dependencies")).into_iter().cloned().map(Some).collect()
            } else if cfg.get("needs").is_some() {
                arr(cfg.get("needs"))
                    .into_iter()
                    .filter(|need| !(matches!(need, Value::Map(_)) && matches!(need.get("artifacts"), Some(Value::Bool(false)))))
                    .map(job_of)
                    .collect()
            } else {
                let own_stage = self.stage_index(name);
                visible.iter().filter(|other| self.stage_index(other) < own_stage).map(|other| Some(Value::String(other.clone()))).collect()
            };
            for dependency in dependency_names.iter().flatten() {
                let Some(dependency) = dependency.as_str() else { continue };
                let paths = self.resolved(dependency).and_then(|other| other.get("artifacts")).and_then(|artifacts| artifacts.get("paths"));
                artifacts_from.extend(arr(paths).into_iter().map(artifact_root));
            }
            let cache_source = non_null(cfg.get("cache")).or_else(|| self.defaults.get("cache"));
            for cache in arr(cache_source) {
                artifacts_from.extend(arr(cache.get("paths")).into_iter().map(artifact_root));
            }
            let image_value = non_null(cfg.get("image")).or_else(|| if inherit_default { non_null(self.defaults.get("image")).or_else(|| self.globals.get("image")) } else { None });
            let image = match image_value {
                Some(Value::String(text)) => Some(text.clone()).filter(|text| !text.is_empty()),
                Some(other) => other.get("name").filter(|value| value.truthy()).map(Value::js_string),
                None => None,
            };
            let services_value = non_null(cfg.get("services")).or_else(|| if inherit_default { non_null(self.defaults.get("services")).or_else(|| self.globals.get("services")) } else { None });
            let services = arr(services_value)
                .into_iter()
                .map(|service| match service {
                    Value::String(text) => text.clone(),
                    other => non_null(other.get("name")).map_or_else(String::new, Value::js_string),
                })
                .collect();
            let mut lines = self.script_lines_for(name, &cfg, "before_script", inherit_default);
            lines.extend(self.script_lines_for(name, &cfg, "script", inherit_default));
            let (file, line) = self.locate(name, &kp!["script"]);
            jobs.push(ScriptJob { name: name.clone(), file: Some(file), line, lines, image, services, vars: self.yaml_vars.clone(), artifacts_from, system: "gitlab", ..ScriptJob::default() });
        }
        check_scripts(&jobs, self.cx, "gitlab")?;
        for job in &jobs {
            for line in &job.lines {
                for groups in re!(r"\$\{?((?:CI|GITLAB)_[A-Z0-9_]+)").match_all(&line.text) {
                    let variable = groups[1].clone().unwrap_or_default();
                    let file = line.file.clone().or_else(|| job.file.clone());
                    self.check_var_name(&variable, file, line.line, Some(job.name.clone()), true)?;
                }
            }
        }
        Ok(())
    }
}
