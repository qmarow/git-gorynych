//! `rules`, сравнения в условиях, `only`/`except` и имена переменных из `checkGitlab`.

use super::catalog::*;
use super::{Gl, config_when, rejected};
use crate::check::base::*;
use crate::load::model::CiSeverity;
use crate::load_common_as_array as arr;
use crate::yaml::{PathItem, Value};

/// Чьи правила проверяются.
#[derive(Clone, Copy)]
pub(super) enum RuleOwner<'a> {
    Workflow,
    Job { name: &'a str, cfg: &'a Value },
}

/// `typeof value`.
fn js_typeof(value: &Value) -> &'static str {
    match value {
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Null | Value::Seq(_) | Value::Map(_) => "object",
    }
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

impl Gl<'_, '_> {
    /// `checkVarName`.
    pub(super) fn check_var_name(&mut self, variable: &str, file: Option<String>, line: Option<u32>, job: Option<String>, in_script: bool) -> Result<(), String> {
        if PREDEFINED.contains(variable) || self.yaml_vars.contains(variable) {
            return Ok(());
        }
        let when = if in_script { tr!("when-job-runs-2", q(job.clone().unwrap_or_default())) } else { config_when() };
        if let Some(replacement) = old_var(variable) {
            let how = tr!("variable-will-be-empty", if in_script { tr!("command-will-get-empty-string") } else { tr!("condition-will-never-work-as") });
            self.cx.add(draft!("var-removed", Error, title = tr!("no-longer-exists", variable), when = when, how = how, why = tr!("ci-build-variables-were-removed", replacement), fix = tr!("replace-with", replacement), file = file, line = line, job = job));
            return Ok(());
        }
        let near = suggest(variable, predefined_ordered());
        let mut item = draft!(
            "var-unknown-predefined",
            Info,
            title = tr!("theres-no-such-predefined-variable", variable),
            when = when,
            how = if in_script { tr!("there-will-be-no-error-but") } else { tr!("there-will-be-no-error-but-variable") },
            why = match near {
                Some(near) => tr!("looks-like-typo-theres", near),
                None => tr!("names-with-ci-gitlab-are"),
            },
            fix = match near {
                Some(near) => tr!("replace-with", near),
                None => tr!("check-name"),
            },
            file = file,
            line = line,
            job = job,
        );
        if near.is_some() {
            item.severity = CiSeverity::Warning;
        }
        self.cx.add(item);
        Ok(())
    }

    fn rule_at(&self, owner: RuleOwner<'_>, path: Vec<PathItem>) -> (String, Option<u32>) {
        match owner {
            RuleOwner::Workflow => self.global_loc(&super::extend(&kp!["workflow", "rules"], path)),
            RuleOwner::Job { name, .. } => self.locate(name, &super::extend(&kp!["rules"], path)),
        }
    }

    /// `checkRules`.
    pub(super) fn check_rules(&mut self, rules: &Value, owner: RuleOwner<'_>) -> Result<(), String> {
        let workflow = matches!(owner, RuleOwner::Workflow);
        let (job, cfg, who, place): (Option<String>, Option<&Value>, String, String) = match owner {
            RuleOwner::Workflow => (None, None, "workflow".to_owned(), "workflow:rules".to_owned()),
            RuleOwner::Job { name, cfg } => (Some(name.to_owned()), Some(cfg), q(name), format!("jobs:{name}:rules")),
        };
        macro_rules! add_at {
            ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {{
                let (file, line) = self.rule_at(owner, $path);
                self.cx.add(draft!($id, $severity, file = file, line = line, job = job.clone() $(, $field = $value)*));
            }};
        }
        let Value::Seq(list) = rules else {
            add_at!(Vec::new(), "rules-not-list", Error, title = tr!("rules-must-be-list", who), when = config_when(), how = rejected(format!("{place} config should be an array of hashes")), why = tr!("each-rule-is-separate-list"), fix = "rules:\n  - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH");
            return Ok(());
        };
        let keys: &[&str] = if workflow { &WORKFLOW_RULE_KEYS } else { &RULE_KEYS };
        let allowed_when: &[&str] = if workflow { &["always", "never"] } else { &RULE_WHEN };
        // Как `catchAll` в 1.x: индекс правила без условий, после первого сообщения — бесконечность
        let mut catch_all: f64 = -1.0;
        for (index, rule) in list.iter().enumerate() {
            let number = index + 1;
            if matches!(rule, Value::Seq(_)) {
                continue;
            }
            let Value::Map(map) = rule else {
                let shown = if let Value::String(text) = rule { tr!("string-2", q(text)) } else { rule.json_string() };
                let fix = if let Value::String(text) = rule { format!("- if: {text}") } else { "- if: …".to_owned() };
                add_at!(kp![index], "rule-not-hash", Error, title = tr!("rule-isnt-map", who, number), when = config_when(), how = rejected(format!("{place}:rule config should be a hash")), why = tr!("rule-is-currently", shown), fix = fix);
                continue;
            };
            for key in map.keys() {
                if !keys.contains(&key.as_str()) {
                    let hint = if workflow && matches!(key.as_str(), "allow_failure" | "needs" | "start_in") { tr!("works-only-in-job-rules", q(key)) } else { String::new() };
                    add_at!(kp![index, key], "rule-unknown-key", Error, title = tr!("rule-has-unknown-key", who, number, q(key)), when = config_when(), how = rejected(format!("{place}:rule config contains unknown keys: {key}")), why = tr!("allowed-2", keys.join(", "), did_you_mean(key, keys.iter().copied()), hint), fix = tr!("fix-or-remove-key"));
                }
            }
            let when = rule.get("when");
            if let Some(value) = when
                && !value.as_str().is_some_and(|text| allowed_when.contains(&text))
            {
                let why = if workflow { tr!("only-always-and-never-are") } else { tr!("allowed", RULE_WHEN.join(", "), did_you_mean(&value.js_string(), RULE_WHEN)) };
                add_at!(kp![index, "when"], "rule-when", Error, title = tr!("rule-when", who, number, arg(value)), when = config_when(), how = rejected(format!("{place}:rule when unknown value: {}", value.js_string())), why = why, fix = if workflow { "when: always" } else { "when: on_success" });
            }
            if when.and_then(Value::as_str) == Some("delayed") && rule.get("start_in").is_none() && cfg.is_none_or(|cfg| cfg.get("start_in").is_none()) {
                add_at!(kp![index], "rule-delayed", Error, title = tr!("rule-delayed-without-start-in", who, number), when = config_when(), how = rejected(format!("{place}:rule start in should be specified for delayed job")), why = tr!("delay-must-be-specified"), fix = "start_in: 10 minutes");
            }
            if let Some(condition) = rule.get("if") {
                let if_path = kp![index, "if"];
                match condition {
                    Value::String(text) => match parse_expr(text) {
                        Err(error) => {
                            add_at!(if_path, "rule-if-syntax", Error, title = tr!("error-in-condition", who, q(text)), when = config_when(), how = rejected(format!("{place}:rule if invalid expression syntax")), why = format!("{}.", capitalize(&error)), fix = tr!("example-if-ci-commit-branch"));
                        }
                        Ok((ast, vars)) => {
                            let (file, line) = self.rule_at(owner, if_path);
                            for variable in vars {
                                self.check_var_name(&variable, Some(file.clone()), line, job.clone(), false)?;
                            }
                            self.check_comparisons(&ast, &file, line, job.clone(), &who);
                        }
                    },
                    other => {
                        add_at!(if_path, "rule-if-type", Error, title = tr!("rule-if-must-be-string", who, number), when = config_when(), how = rejected(format!("{place}:rule if should be a string")), why = tr!("yaml-read-value-as", js_typeof(other)), fix = tr!("quote-expression-if-var-x"));
                    }
                }
            }
            if let Some(exists) = rule.get("exists") {
                let is_map = matches!(exists, Value::Map(_));
                let source = if is_map { exists.get("paths") } else { Some(exists) };
                let paths: Vec<String> = arr(source).into_iter().map(Value::js_string).collect();
                let has_project = is_map && exists.get("project").is_some_and(Value::truthy);
                if !paths.is_empty() && !has_project && paths.iter().all(|path| !path.contains('$') && !self.cx.repo.glob(path) && !self.cx.repo.has_file(path)) {
                    let list_text: Vec<String> = paths.iter().map(q).collect();
                    add_at!(kp![index, "exists"], "rule-exists-none", Warning, title = tr!("rule-exists-no-such-files", who, number), when = config_when(), how = tr!("rule-will-never-fire-until"), why = tr!("no-repository-file-matches", list_text.join(", ")), fix = tr!("check-path-pattern-from-repository"));
                }
            }
            if let Some(changes) = rule.get("changes") {
                let source = if let Value::Map(change_map) = changes {
                    for key in change_map.keys() {
                        if !matches!(key.as_str(), "paths" | "compare_to") {
                            add_at!(kp![index, "changes", key], "rule-changes-key", Error, title = tr!("rule-changes-unknown-key", who, number, q(key)), when = config_when(), how = rejected(format!("{place}:rule:changes config contains unknown keys: {key}")), why = tr!("allowed-paths-and-compare-to"), fix = "changes:\n  paths:\n    - src/**/*");
                        }
                    }
                    changes.get("paths")
                } else {
                    Some(changes)
                };
                let paths: Vec<String> = arr(source).into_iter().map(Value::js_string).collect();
                if !paths.is_empty() && paths.iter().all(|path| !path.contains('$') && !self.cx.repo.glob(path) && !self.cx.repo.has_file(path) && !self.cx.repo.has_dir(path)) {
                    let list_text: Vec<String> = paths.iter().map(q).collect();
                    add_at!(kp![index, "changes"], "rule-changes-none", Info, title = tr!("rule-changes-no-such-files", who, number), when = tr!("on-push-and-in-merge"), how = tr!("rule-wont-fire-on-regular"), why = tr!("no-file-currently-matches", list_text.join(", ")), fix = tr!("check-pattern-src-all-files"));
                }
            }
            let is_catch_all = rule.get("if").is_none() && rule.get("changes").is_none() && rule.get("exists").is_none();
            if catch_all >= 0.0 {
                add_at!(kp![index], "rule-unreachable", Warning, title = tr!("rule-is-never-checked", who, number), when = config_when(), how = tr!("there-will-be-no-error-but-this"), why = tr!("rule-has-no-conditions-and", gorynych_core::js::number_to_string(catch_all + 1.0)), fix = tr!("move-rule-without-conditions-to"));
                catch_all = f64::INFINITY;
            } else if is_catch_all && number < list.len() {
                catch_all = index as f64;
            }
        }
        let real: Vec<&Value> = list.iter().filter(|rule| matches!(rule, Value::Map(_))).collect();
        let all_never = !real.is_empty() && real.iter().all(|rule| rule.get("when").and_then(Value::as_str) == Some("never"));
        if all_never && !workflow {
            add_at!(Vec::new(), "rules-all-never", Warning, title = tr!("all-rules-are-when-never", who), when = config_when(), how = tr!("job-wont-be-in-any-pipeline"), why = tr!("if-no-rule-includes-job"), fix = tr!("add-rule-when-on-success"));
        }
        if all_never && workflow {
            add_at!(Vec::new(), "workflow-all-never", Error, title = tr!("workflow-rules-all-rules-are"), when = config_when(), how = tr!("pipeline-will-never-be-created"), why = tr!("if-no-workflow-rule-fires"), fix = tr!("add-when-always-at-end"));
        }
        Ok(())
    }

    /// `checkComparisons`: сравнения с `CI_PIPELINE_SOURCE` и с ветками.
    fn check_comparisons(&mut self, ast: &Expr, file: &str, line: Option<u32>, job: Option<String>, who: &str) {
        match ast {
            Expr::And(left, right) | Expr::Or(left, right) => {
                self.check_comparisons(left, file, line, job.clone(), who);
                self.check_comparisons(right, file, line, job, who);
            }
            Expr::Cmp { op: op @ ("==" | "!="), left, right } => {
                let (variable, text) = match (&**left, &**right) {
                    (Expr::Var(variable), Expr::Str(text)) | (Expr::Str(text), Expr::Var(variable)) => (variable.as_str(), text.as_str()),
                    _ => return,
                };
                if variable == "CI_PIPELINE_SOURCE" && !PIPELINE_SOURCES.contains(&text) {
                    let near = suggest(text, PIPELINE_SOURCES);
                    let how = tr!("condition", if *op == "==" { tr!("will-never-be-true") } else { tr!("will-always-be-true") });
                    let why = tr!("possible-values", PIPELINE_SOURCES[..10].join(", "), near.map_or_else(String::new, |near| tr!("perhaps-you-meant", q(near))));
                    let fix = near.map_or_else(|| tr!("check-value"), |near| tr!("replace-with-2", near));
                    self.cx.add(draft!("pipeline-source-value", Warning, title = tr!("ci-pipeline-source-is-never", who, q(text)), when = config_when(), how = how, why = why, fix = fix, file = file.to_owned(), line = line, job = job.clone()));
                }
                let is_branch_var = matches!(variable, "CI_COMMIT_BRANCH" | "CI_COMMIT_REF_NAME" | "CI_MERGE_REQUEST_TARGET_BRANCH_NAME" | "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" | "CI_DEFAULT_BRANCH");
                if is_branch_var && !self.branches.is_empty() && !self.branches.contains(text) {
                    let default = self.default_branch.clone();
                    let swapped = (text == "master" && default == "main") || (text == "main" && default == "master");
                    let mut item = draft!(
                        if swapped { "branch-main-master" } else { "branch-missing" },
                        Info,
                        title = tr!("branch-isnt-in-repository", who, q(text)),
                        when = config_when(),
                        how = if swapped { tr!("condition-with-will-never-fire", q(text), q(&default)) } else { tr!("condition-will-fire-only-when", q(text)) },
                        why = tr!("is-compared-with-and-repository", variable, q(text), if swapped { tr!("main-branch-is", q(&default)) } else { tr!("no-such-branch-neither-local") }),
                        fix = if swapped { tr!("use-ci-default-branch-instead", text) } else { tr!("if-its-typo-fix-it") },
                        file = file.to_owned(),
                        line = line,
                        job = job,
                    );
                    if swapped {
                        item.severity = CiSeverity::Warning;
                    }
                    self.cx.add(item);
                }
            }
            _ => {}
        }
    }

    /// `checkOnly`.
    pub(super) fn check_only(&mut self, name: &str, key: &str, spec: &Value) {
        let is_map = matches!(spec, Value::Map(_));
        macro_rules! add_at {
            ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {{
                let (file, line) = self.locate(name, &super::extend(&kp![key], $path));
                self.cx.add(draft!($id, $severity, when = config_when(), file = file, line = line, job = name.to_owned() $(, $field = $value)*));
            }};
        }
        if let Value::Map(map) = spec {
            for inner in map.keys() {
                if !ONLY_KEYS.contains(&inner.as_str()) {
                    add_at!(kp![inner], "only-unknown-key", Error, title = tr!("unknown-key-2", q(name), key, q(inner)), how = rejected(format!("jobs:{name}:{key} config contains unknown keys: {inner}")), why = tr!("allowed", ONLY_KEYS.join(", "), did_you_mean(inner, ONLY_KEYS)), fix = tr!("fix-key-or-better-switch"));
                }
            }
            for (index, expression) in arr(spec.get("variables")).into_iter().enumerate() {
                let source = if expression.is_null() { String::new() } else { expression.js_string() };
                if let Err(error) = parse_expr(&source) {
                    add_at!(kp!["variables", index], "only-variables-syntax", Error, title = tr!("error-in-variables", q(name), key, q(expression.js_string())), how = rejected(format!("jobs:{name}:{key}:variables invalid expression syntax")), why = format!("{error}."), fix = tr!("example-ci-commit-message-deploy"));
                }
            }
        }
        let refs = if is_map { spec.get("refs") } else { Some(spec) };
        for (index, reference) in arr(refs).into_iter().enumerate() {
            let text = reference.js_string();
            if ONLY_REFS.contains(&text.as_str()) || text.starts_with('/') || text.contains('@') {
                continue;
            }
            if let Some(near) = suggest(&text, ONLY_REFS)
                && !self.branches.contains(&text)
            {
                let path = if is_map { kp!["refs", index] } else { kp![index] };
                add_at!(path, "only-keyword-typo", Warning, title = tr!("is-branch-name-not", q(name), key, text, q(near)), how = tr!("gitlab-will-read-as-branch", q(&text), if key == "only" { tr!("will-run-job-only-for") } else { tr!("will-exclude-only-it") }), why = tr!("keyword-is-written", q(near)), fix = tr!("replace-with-3", near));
            }
        }
        if !self.only_jobs.iter().any(|item| item.0 == name) {
            let (file, line) = self.locate(name, &kp![key]);
            self.only_jobs.push((name.to_owned(), file, line));
        }
    }
}
