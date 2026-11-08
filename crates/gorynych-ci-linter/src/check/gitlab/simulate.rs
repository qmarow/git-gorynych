//! Прогон сценариев: `simulate`, `runScenario`, `evalRules`, `evalOnlySpec` из `checkGitlab`.
//!
//! ## Конспект
//! Сценарии `push-default`, `push-branch`, `mr` (отсоединённый MR !12), `tag` (`v1.0.0`), `schedule`, `web` и скрытый `push-branch-mr` с `CI_OPEN_MERGE_REQUESTS`. `workflow:rules`: первое подходящее
//! правило, его переменные применяются; иначе блокировка. Задание: `rules` — первое совпадение (`when: manual` в `rules` по умолчанию `allow_failure: false`); иначе `when: never`; иначе `only`/`except`,
//! по умолчанию `only: [branches, tags]`; без `only` и `except` задание попадает в пайплайн MR, только если его разрешил `workflow`. Пайплайн создан, если есть задания вне `.pre` и `.post`.

use std::collections::HashMap;

use serde::Serialize;

use super::catalog::*;
use super::Gl;
use crate::check::base::*;
use crate::load_common_as_array as arr;
use crate::load_common_non_null as non_null;
use crate::yaml::Value;

const NO_SHA: &str = "0000000000000000000000000000000000000000";
const PICKED: [&str; 6] = ["CI_PIPELINE_SOURCE", "CI_COMMIT_BRANCH", "CI_COMMIT_TAG", "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME", "CI_MERGE_REQUEST_TARGET_BRANCH_NAME", "CI_OPEN_MERGE_REQUESTS"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiScenarioRef {
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiScenarioJob {
    pub name: String,
    pub stage: String,
    pub when: Value,
    pub allow_failure: Value,
    pub why: String,
    pub uncertain: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiScenarioExcluded {
    pub name: String,
    pub why: String,
    pub uncertain: Option<String>,
}

/// Результат прогона сценария.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiScenario {
    pub id: String,
    pub title: String,
    #[serde(rename = "ref")]
    pub reference: CiScenarioRef,
    pub vars: std::collections::BTreeMap<String, String>,
    pub created: bool,
    pub reason: String,
    pub uncertain: Option<String>,
    pub jobs: Vec<CiScenarioJob>,
    pub excluded: Vec<CiScenarioExcluded>,
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_blocked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_rule: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_only: Option<Vec<String>>,
}

struct Scenario {
    id: &'static str,
    title: String,
    kind: &'static str,
    name: String,
    vars: HashMap<String, Value>,
}

impl Scenario {
    fn var(&self, name: &str) -> Option<&str> {
        self.vars.get(name).and_then(Value::as_str)
    }
}

struct RuleMatch {
    rule: Option<Value>,
    index: usize,
    uncertain: Vec<String>,
}

fn push_unique(list: &mut Vec<String>, item: String) {
    if !list.contains(&item) {
        list.push(item);
    }
}

fn unique(list: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for item in list {
        push_unique(&mut out, item);
    }
    out
}

fn joined_uncertain(list: &[String]) -> Option<String> {
    if list.is_empty() { None } else { Some(list.join(", ")) }
}

fn string_map(pairs: &[(&str, &str)]) -> HashMap<String, Value> {
    pairs.iter().map(|(key, value)| ((*key).to_owned(), Value::String((*value).to_owned()))).collect()
}

fn slug(text: &str) -> String {
    let lower = text.to_lowercase();
    let dashed = re!(r"[^a-z0-9]+").replace_all(&lower, "-");
    let trimmed = dashed.strip_prefix('-').unwrap_or(&dashed);
    let trimmed = trimmed.strip_suffix('-').unwrap_or(trimmed);
    trimmed.chars().take(63).collect()
}

/// `parseExpr(String(src ?? ''))`.
fn parse_value(value: &Value) -> Result<(Expr, Vec<String>), String> {
    parse_expr(&if value.is_null() { String::new() } else { value.js_string() })
}

impl Gl<'_, '_> {
    fn eval_rules(&self, rules: &[Value], vars: &HashMap<String, Value>, scenario: &Scenario) -> RuleMatch {
        let mut uncertain = Vec::new();
        for (index, rule) in rules.iter().enumerate() {
            if !matches!(rule, Value::Map(_)) {
                continue;
            }
            let mut ok = true;
            if let Some(condition) = rule.get("if") {
                match parse_value(condition) {
                    Err(_) => ok = false,
                    Ok((ast, names)) => {
                        for name in names {
                            let content = is_content_var(&name);
                            if (vars.contains_key(&name) && !content) || (PREDEFINED.contains(name.as_str()) && !content) {
                                continue;
                            }
                            uncertain.push(format!("${name}"));
                        }
                        ok = eval_expr(&ast, vars);
                    }
                }
            }
            if ok && let Some(exists) = rule.get("exists") {
                let source = if matches!(exists, Value::Map(_)) { exists.get("paths") } else { Some(exists) };
                let paths: Vec<String> = arr(source).into_iter().map(Value::js_string).collect();
                if paths.iter().any(|path| path.contains('$')) {
                    uncertain.push("exists".to_owned());
                } else {
                    ok = paths.iter().any(|path| self.cx.repo.glob(path) || self.cx.repo.has_file(path));
                }
            }
            if ok && rule.get("changes").is_some() {
                let source = scenario.var("CI_PIPELINE_SOURCE");
                if (source == Some("push") && !scenario.var("CI_COMMIT_TAG").is_some_and(|tag| !tag.is_empty())) || source == Some("merge_request_event") {
                    uncertain.push(tr!("изменённые файлы (changes)"));
                }
            }
            if ok {
                return RuleMatch { rule: Some(rule.clone()), index, uncertain: unique(uncertain) };
            }
        }
        RuleMatch { rule: None, index: 0, uncertain: unique(uncertain) }
    }

    fn refs_match(refs: Option<&Value>, scenario: &Scenario) -> bool {
        arr(refs).into_iter().any(|reference| {
            let text = re!(r"@.*$").replace_all(&reference.js_string(), "");
            let source = scenario.var("CI_PIPELINE_SOURCE").unwrap_or_default();
            match text.as_str() {
                "branches" => scenario.kind == "branch",
                "tags" => scenario.kind == "tag",
                "merge_requests" => source == "merge_request_event",
                "schedules" => source == "schedule",
                "web" => source == "web",
                "pushes" => source == "push",
                "api" | "triggers" | "pipelines" | "external" | "chat" | "external_pull_requests" => source == text.strip_suffix('s').unwrap_or(&text) || source == text,
                other if other.starts_with('/') => {
                    let Some(groups) = re!(r"^\/(.*)\/([a-z]*)$").exec(other) else { return false };
                    ExprRegex::new(groups[1].as_deref().unwrap_or_default(), groups[2].as_deref().unwrap_or_default()).is_ok_and(|regex| regex.test(&scenario.name) && scenario.kind != "mr")
                }
                other => scenario.kind != "mr" && other == scenario.name,
            }
        })
    }

    fn eval_only(spec: &Value, scenario: &Scenario, vars: &HashMap<String, Value>) -> (bool, Vec<String>) {
        let mut uncertain = Vec::new();
        if !matches!(spec, Value::Map(_)) {
            return (Self::refs_match(Some(spec), scenario), uncertain);
        }
        let mut matched = true;
        if spec.get("refs").is_some() {
            matched = Self::refs_match(spec.get("refs"), scenario);
        }
        if spec.get("variables").is_some() && matched {
            matched = arr(spec.get("variables")).into_iter().any(|expression| {
                let Ok((ast, names)) = parse_value(expression) else { return false };
                for name in names {
                    if !vars.contains_key(&name) && (!PREDEFINED.contains(name.as_str()) || is_content_var(&name)) {
                        uncertain.push(format!("${name}"));
                    }
                }
                eval_expr(&ast, vars)
            });
        }
        if spec.get("changes").is_some() && matched && scenario.var("CI_PIPELINE_SOURCE") == Some("push") && !scenario.var("CI_COMMIT_TAG").is_some_and(|tag| !tag.is_empty()) {
            uncertain.push(tr!("изменённые файлы (changes)"));
        }
        (matched, uncertain)
    }

    fn workflow_line(&self) -> Option<u32> {
        if self.workflow.is_some() { self.global_loc(&kp!["workflow"]).1 } else { Some(1) }
    }

    fn run_scenario(&mut self, scenario: &Scenario, global_vars: &HashMap<String, Value>) -> CiScenario {
        let mut vars = global_vars.clone();
        vars.extend(scenario.vars.iter().map(|(key, value)| (key.clone(), value.clone())));
        let picked = PICKED.iter().filter_map(|key| scenario.var(key).map(|value| ((*key).to_owned(), value.to_owned()))).collect();
        let mut result = CiScenario {
            id: scenario.id.to_owned(),
            title: scenario.title.clone(),
            reference: CiScenarioRef { kind: scenario.kind.to_owned(), name: scenario.name.clone() },
            vars: picked,
            created: false,
            reason: String::new(),
            uncertain: None,
            jobs: Vec::new(),
            excluded: Vec::new(),
            problems: Vec::new(),
            workflow_blocked: None,
            workflow_rule: None,
            default_only: None,
        };

        if let Some(Value::Seq(rules)) = self.workflow.as_ref().and_then(|workflow| workflow.get("rules")) {
            let matched = self.eval_rules(rules, &vars, scenario);
            let blocked = matched.rule.as_ref().is_none_or(|rule| rule.get("when").and_then(Value::as_str) == Some("never"));
            if blocked {
                result.workflow_blocked = Some(true);
                result.reason = if matched.rule.is_none() { tr!("ни одно правило workflow:rules не подошло") } else { tr!("workflow:rules, правило {0}: when: never", matched.index + 1) };
                result.uncertain = joined_uncertain(&matched.uncertain);
                return result;
            }
            if let Some(Value::Map(rule_vars)) = matched.rule.as_ref().and_then(|rule| rule.get("variables")) {
                for (key, value) in rule_vars.iter() {
                    vars.insert(key.clone(), Value::String(value.js_string()));
                }
            }
            result.workflow_rule = Some(matched.index as u32 + 1);
        }

        for name in self.visible.clone() {
            let cfg = self.resolved(&name).cloned().unwrap_or(Value::Null);
            let mut job_vars = vars.clone();
            if let Some(Value::Map(own_vars)) = cfg.get("variables") {
                for (key, value) in own_vars.iter() {
                    let text = match value {
                        Value::Map(_) => non_null(value.get("value")).map_or_else(String::new, Value::js_string),
                        Value::Null => String::new(),
                        other => other.js_string(),
                    };
                    job_vars.insert(key.clone(), Value::String(text));
                }
            }
            let included;
            let why;
            let mut when = non_null(cfg.get("when")).cloned().unwrap_or_else(|| Value::String("on_success".to_owned()));
            let mut allow_failure = Value::Bool(matches!(cfg.get("allow_failure"), Some(Value::Bool(true) | Value::Map(_))));
            let mut uncertain = Vec::new();
            let cfg_when = cfg.get("when").and_then(Value::as_str);
            if let Some(Value::Seq(rules)) = cfg.get("rules") {
                let matched = self.eval_rules(rules, &job_vars, scenario);
                uncertain = matched.uncertain;
                match &matched.rule {
                    None => {
                        included = false;
                        why = tr!("ни одно правило rules не подошло");
                    }
                    Some(rule) if rule.get("when").and_then(Value::as_str) == Some("never") => {
                        included = false;
                        why = tr!("правило {0}: when: never", matched.index + 1);
                    }
                    Some(rule) => {
                        included = true;
                        if let Some(value) = non_null(rule.get("when")) {
                            when = value.clone();
                        }
                        allow_failure = match non_null(rule.get("allow_failure")) {
                            Some(value) => value.clone(),
                            None if rule.get("when").and_then(Value::as_str) == Some("manual") => Value::Bool(false),
                            None => allow_failure,
                        };
                        why = tr!("правило {0}", matched.index + 1);
                    }
                }
            } else if cfg_when == Some("never") {
                included = false;
                why = "when: never".to_owned();
            } else {
                let only_truthy = cfg.get("only").is_some_and(Value::truthy);
                let except_truthy = cfg.get("except").is_some_and(Value::truthy);
                let default_only = Value::Seq(vec![Value::String("branches".to_owned()), Value::String("tags".to_owned())]);
                let only = non_null(cfg.get("only")).unwrap_or(&default_only);
                let (only_match, only_uncertain) = if !only_truthy && !except_truthy && scenario.kind == "mr" && result.workflow_rule.is_some() { (true, Vec::new()) } else { Self::eval_only(only, scenario, &job_vars) };
                let (except_match, except_uncertain) = match cfg.get("except") {
                    Some(except) => Self::eval_only(except, scenario, &job_vars),
                    None => (false, Vec::new()),
                };
                uncertain = only_uncertain.into_iter().chain(except_uncertain).collect();
                included = only_match && !except_match;
                if cfg_when == Some("manual") {
                    allow_failure = non_null(cfg.get("allow_failure")).cloned().unwrap_or(Value::Bool(true));
                }
                why = if !only_match {
                    if only_truthy { tr!("не подходит под only") } else { tr!("без rules задание по умолчанию только для веток и тегов (only: branches, tags)") }
                } else if except_match {
                    tr!("исключено except")
                } else if only_truthy {
                    tr!("подходит под only")
                } else {
                    tr!("без условий")
                };
                let default_list = result.default_only.get_or_insert_with(Vec::new);
                if !only_truthy && !except_truthy && !only_match {
                    default_list.push(name.clone());
                }
            }
            let uncertain_text = joined_uncertain(&uncertain);
            if included {
                let stage = self.stage_of(&name);
                result.jobs.push(CiScenarioJob { name, stage, when, allow_failure, why, uncertain: uncertain_text });
            } else {
                result.excluded.push(CiScenarioExcluded { name, why, uncertain: uncertain_text });
            }
        }

        let real_jobs = result.jobs.iter().filter(|job| job.stage != ".pre" && job.stage != ".post").count();
        result.created = real_jobs > 0;
        result.reason = if result.jobs.is_empty() {
            tr!("ни одно задание не подошло под условия")
        } else if real_jobs == 0 {
            tr!("есть только задания этапов .pre/.post")
        } else if let Some(rule) = result.workflow_rule {
            tr!("workflow:rules, правило {0}", rule)
        } else {
            tr!("есть подходящие задания")
        };
        let mut all_uncertain = Vec::new();
        for item in result.jobs.iter().filter_map(|job| job.uncertain.clone()).chain(result.excluded.iter().filter_map(|job| job.uncertain.clone())) {
            push_unique(&mut all_uncertain, item);
        }
        result.uncertain = joined_uncertain(&all_uncertain);
        if !result.created {
            if scenario.id == "web" || scenario.id == "push-default" {
                let web = scenario.id == "web";
                let mut item = draft!(
                    "scenario-empty",
                    Info,
                    title = tr!("{0}: пайплайн не создастся", scenario.title),
                    when = scenario.title.clone(),
                    how = if web { tr!("При нажатии «Run pipeline» GitLab ответит: «Pipeline will not run for the selected trigger. The rules configuration prevented any jobs from being added to the pipeline.»") } else { tr!("Пайплайн просто не появится.") },
                    why = format!("{}{}", result.reason, if result.jobs.is_empty() { "." } else { "" }),
                    fix = if web { tr!("Если ручной запуск нужен — добавьте правило: - if: $CI_PIPELINE_SOURCE == \"web\"") } else { tr!("Проверьте rules заданий.") },
                    file = self.main.clone(),
                    line = self.workflow_line(),
                    scenario = scenario.id.to_owned(),
                );
                if web {
                    item.severity = crate::load::model::CiSeverity::Warning;
                }
                self.cx.add(item);
            }
            if scenario.id == "mr" && result.default_only.as_ref().is_some_and(|list| !list.is_empty()) {
                result.reason.push_str(&tr!(" (задания без rules попадают в пайплайн MR, только если его разрешает workflow:rules)"));
            }
            return result;
        }

        self.scenario_problems(scenario, &mut result);
        result
    }

    /// Зависимости от заданий, которых нет в этом пайплайне.
    fn scenario_problems(&mut self, scenario: &Scenario, result: &mut CiScenario) {
        let in_pipe: Vec<String> = result.jobs.iter().map(|job| job.name.clone()).collect();
        let title = scenario.title.clone();
        let id = scenario.id.to_owned();
        for job in result.jobs.clone() {
            let cfg = self.resolved(&job.name).cloned().unwrap_or(Value::Null);
            let name = job.name.as_str();
            for need in arr(cfg.get("needs")) {
                let target = match need {
                    Value::String(_) => Some(need),
                    other => other.get("job"),
                };
                let Some(target) = target.filter(|value| value.truthy()) else { continue };
                if matches!(need, Value::Map(_)) && ["optional", "pipeline", "project"].iter().any(|key| need.get(key).is_some_and(Value::truthy)) {
                    continue;
                }
                let Some(target) = target.as_str().filter(|target| self.visible.iter().any(|item| item == target) && !in_pipe.iter().any(|item| item == target)) else { continue };
                let excluded = result.excluded.iter().find(|item| item.name == target);
                let message = format!("'{name}' job needs '{target}' job, but '{target}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.");
                result.problems.push(message.clone());
                let why = tr!("{0} попадает в пайплайн ({1}), а {2} — нет ({3}).", q(name), job.why, q(target), excluded.map_or_else(|| tr!("исключено"), |item| item.why.clone()));
                let mut item = draft!("scenario-needs-missing", Error, title = tr!("{0}: {1} ждёт {2}, которого не будет", title, q(name), q(target)), when = title.clone(), how = tr!("GitLab не создаст пайплайн: «{0}»", message), why = why, fix = tr!("Сделайте условия {0} и {1} одинаковыми или добавьте optional: true:\nneeds:\n  - job: {2}\n    optional: true", q(name), q(target), target), scenario = id.clone());
                if job.uncertain.is_some() || excluded.is_some_and(|item| item.uncertain.is_some()) {
                    item.severity = crate::load::model::CiSeverity::Warning;
                }
                self.job_issue(name, &kp!["needs"], item);
            }
            if cfg.get("needs").is_none() {
                for dep in arr(cfg.get("dependencies")) {
                    let Some(dep) = dep.as_str().filter(|dep| self.visible.iter().any(|item| item == dep) && !in_pipe.iter().any(|item| item == dep)) else { continue };
                    result.problems.push(format!("{name} job: undefined dependency: {dep}"));
                    let reason = result.excluded.iter().find(|item| item.name == dep).map_or_else(|| "—".to_owned(), |item| item.why.clone());
                    self.job_issue(name, &kp!["dependencies"], draft!("scenario-dependency-missing", Error, title = tr!("{0}: {1} берёт артефакты у {2}, которого не будет", title, q(name), q(dep)), when = title.clone(), how = tr!("GitLab не создаст пайплайн: «{0} job: undefined dependency: {1}»", name, dep), why = tr!("{0} исключено в этом пайплайне ({1}).", q(dep), reason), fix = tr!("Согласуйте условия заданий или уберите зависимость."), scenario = id.clone()));
                }
            }
            if let Some(on_stop) = cfg.get("environment").filter(|env| matches!(env, Value::Map(_))).and_then(|env| env.get("on_stop")).filter(|value| value.truthy()) {
                let stop = on_stop.js_string();
                if self.visible.contains(&stop) && !in_pipe.contains(&stop) {
                    result.problems.push(format!("{name} job: on_stop job {stop} is not defined"));
                    self.job_issue(name, &kp!["environment", "on_stop"], draft!("scenario-on-stop-missing", Error, title = tr!("{0}: задание остановки {1} не попадает в пайплайн", title, q(&stop)), when = title.clone(), how = tr!("GitLab не создаст пайплайн: «{0} job: on_stop job {1} is not defined»", name, stop), why = tr!("{0} есть в пайплайне, а {1} — нет.", q(name), q(&stop)), fix = tr!("Дайте {0} те же rules, что у {1} (с when: manual).", q(&stop), q(name)), scenario = id.clone()));
                }
            }
            if let Some(release @ Value::Map(_)) = cfg.get("release")
                && re!(r"\$CI_COMMIT_TAG\b").test(&js_str(release.get("tag_name")))
                && scenario.kind != "tag"
            {
                self.job_issue(name, &kp!["release", "tag_name"], draft!("scenario-release-no-tag", Warning, title = tr!("{0}: {1} создаёт релиз без тега", title, q(name)), when = title.clone(), how = tr!("Задание упадёт: $CI_COMMIT_TAG пустой — «tag_name is missing» / «release tag name can't be blank»."), why = tr!("Задание с release: tag_name: $CI_COMMIT_TAG попадает в пайплайн без тега."), fix = "rules:\n  - if: $CI_COMMIT_TAG", scenario = id.clone()));
            }
            if job.when.as_str() == Some("manual") && job.allow_failure == Value::Bool(false) {
                let own_stage = self.stage_index(name);
                let later: Vec<String> = result
                    .jobs
                    .iter()
                    .filter(|other| self.stage_index(&other.name) > own_stage && self.resolved(&other.name).is_none_or(|config| config.get("needs").is_none()))
                    .take(4)
                    .map(|other| q(&other.name))
                    .collect();
                let has_rules = cfg.get("rules").is_some_and(Value::truthy);
                let path = if has_rules { kp!["rules"] } else { kp!["when"] };
                let tail = if later.is_empty() { String::new() } else { tr!("; задания {0} не стартуют до этого", later.join(", ")) };
                self.job_issue(name, &path, draft!("manual-blocking", Info, title = tr!("{0} — ручное и блокирующее", q(name)), when = title.clone(), how = tr!("Пайплайн остановится в статусе «blocked» и будет ждать нажатия ▶{0}.", tail), why = if has_rules { tr!("У when: manual внутри rules allow_failure по умолчанию false (в отличие от when: manual у самого задания).") } else { tr!("allow_failure: false у ручного задания.") }, fix = tr!("Если ждать не нужно — добавьте allow_failure: true рядом с when: manual."), scenario = id.clone()));
            }
        }
    }

    /// `simulate`.
    pub(super) fn simulate(&mut self) -> Vec<CiScenario> {
        let default = if self.default_branch.is_empty() { "main".to_owned() } else { self.default_branch.clone() };
        let feature = "feature/example";
        let base = |extra: &[(&str, &str)]| {
            let mut vars = string_map(&[
                ("CI", "true"),
                ("GITLAB_CI", "true"),
                ("CI_DEFAULT_BRANCH", &default),
                ("CI_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567"),
                ("CI_COMMIT_SHORT_SHA", "01234567"),
                ("CI_PIPELINE_ID", "1001"),
                ("CI_PIPELINE_IID", "1"),
                ("CI_PROJECT_NAME", "project"),
                ("CI_PROJECT_PATH", "group/project"),
                ("CI_SERVER_HOST", "gitlab.example.com"),
            ]);
            vars.extend(string_map(extra));
            vars
        };
        let branch = |name: &str, source: &str, extra: &[(&str, &str)]| {
            let name_slug = slug(name);
            let mut vars = base(&[
                ("CI_PIPELINE_SOURCE", source),
                ("CI_COMMIT_BRANCH", name),
                ("CI_COMMIT_REF_NAME", name),
                ("CI_COMMIT_REF_SLUG", &name_slug),
                ("CI_COMMIT_REF_PROTECTED", if name == default { "true" } else { "false" }),
                ("CI_COMMIT_BEFORE_SHA", if source == "push" { "fedcba9876543210fedcba9876543210fedcba98" } else { NO_SHA }),
            ]);
            vars.extend(string_map(extra));
            vars
        };
        let feature_slug = slug(feature);
        let list = vec![
            Scenario { id: "push-default", title: tr!("Push в {0}", default), kind: "branch", name: default.clone(), vars: branch(&default, "push", &[]) },
            Scenario { id: "push-branch", title: tr!("Push в {0}", feature), kind: "branch", name: feature.to_owned(), vars: branch(feature, "push", &[]) },
            Scenario {
                id: "mr",
                title: format!("Merge request {feature} → {default}"),
                kind: "mr",
                name: feature.to_owned(),
                vars: base(&[
                    ("CI_PIPELINE_SOURCE", "merge_request_event"),
                    ("CI_COMMIT_REF_NAME", feature),
                    ("CI_COMMIT_REF_SLUG", &feature_slug),
                    ("CI_MERGE_REQUEST_ID", "501"),
                    ("CI_MERGE_REQUEST_IID", "12"),
                    ("CI_MERGE_REQUEST_SOURCE_BRANCH_NAME", feature),
                    ("CI_MERGE_REQUEST_TARGET_BRANCH_NAME", &default),
                    ("CI_MERGE_REQUEST_EVENT_TYPE", "detached"),
                    ("CI_MERGE_REQUEST_REF_PATH", "refs/merge-requests/12/head"),
                    ("CI_MERGE_REQUEST_TARGET_BRANCH_PROTECTED", "true"),
                    ("CI_COMMIT_REF_PROTECTED", "false"),
                    ("CI_COMMIT_BEFORE_SHA", NO_SHA),
                ]),
            },
            Scenario {
                id: "tag",
                title: tr!("Тег v1.0.0"),
                kind: "tag",
                name: "v1.0.0".to_owned(),
                vars: base(&[("CI_PIPELINE_SOURCE", "push"), ("CI_COMMIT_TAG", "v1.0.0"), ("CI_COMMIT_REF_NAME", "v1.0.0"), ("CI_COMMIT_REF_SLUG", "v1-0-0"), ("CI_COMMIT_REF_PROTECTED", "false"), ("CI_COMMIT_BEFORE_SHA", NO_SHA)]),
            },
            Scenario { id: "schedule", title: tr!("Расписание ({0})", default), kind: "branch", name: default.clone(), vars: branch(&default, "schedule", &[]) },
            Scenario { id: "web", title: tr!("Запуск вручную ({0})", default), kind: "branch", name: default.clone(), vars: branch(&default, "web", &[]) },
        ];
        let hidden = Scenario { id: "push-branch-mr", title: tr!("Push в {0} с открытым MR", feature), kind: "branch", name: feature.to_owned(), vars: branch(feature, "push", &[("CI_OPEN_MERGE_REQUESTS", "group/project!12")]) };

        let global_vars: HashMap<String, Value> = match self.globals.get("variables") {
            Some(Value::Map(map)) => map
                .iter()
                .map(|(key, value)| {
                    let text = match value {
                        Value::Map(_) => non_null(value.get("value")).map_or_else(String::new, Value::js_string),
                        Value::Null => String::new(),
                        other => other.js_string(),
                    };
                    (key.clone(), Value::String(text))
                })
                .collect(),
            _ => HashMap::new(),
        };

        let out: Vec<CiScenario> = list.iter().map(|scenario| self.run_scenario(scenario, &global_vars)).collect();
        let open_mr = self.run_scenario(&hidden, &global_vars);
        let find = |id: &str| out.iter().find(|run| run.id == id).expect("сценарий из списка");

        let merge_request = find("mr").clone();
        if merge_request.created && !merge_request.jobs.is_empty() && open_mr.created && !open_mr.jobs.is_empty() {
            let (file, line) = if self.workflow.is_some() { let (file, line) = self.global_loc(&kp!["workflow"]); (file, line) } else { (self.main.clone(), Some(1)) };
            self.cx.add(draft!("duplicate-pipelines", Warning, title = tr!("Двойные пайплайны: для ветки и для merge request"), when = tr!("При каждом push в ветку с открытым merge request"), how = tr!("Запустятся два пайплайна на один коммит: «branch» ({0} задан.) и «merge request» ({1} задан.) — раннеры заняты вдвое, статус MR может зависеть от любого из них.", open_mr.jobs.len(), merge_request.jobs.len()), why = tr!("Правила допускают и push-пайплайны для любой ветки, и пайплайны merge request, а условие «если MR уже открыт — не создавать пайплайн ветки» не задано."), fix = "workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"\n    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS\n      when: never\n    - if: $CI_COMMIT_BRANCH", file = file, line = line));
        }
        if find("push-branch").created && !open_mr.created && !merge_request.created {
            self.cx.add(draft!("mr-nothing-runs", Warning, title = tr!("При открытом merge request не запускается ничего"), when = tr!("При push в ветку, по которой открыт merge request"), how = tr!("Пайплайн ветки не создаётся ({0}), а пайплайн merge request пустой ({1}) — изменения уходят без проверок.", open_mr.reason, merge_request.reason), why = tr!("Правила запрещают пайплайн ветки при открытом MR, но задания не настроены для пайплайнов MR."), fix = tr!("Добавьте заданиям правило - if: $CI_PIPELINE_SOURCE == \"merge_request_event\" или разрешите MR в workflow:rules."), file = self.main.clone(), line = self.workflow_line()));
        }
        let main_runs: Vec<&CiScenario> = out.iter().filter(|run| matches!(run.id.as_str(), "push-default" | "push-branch" | "mr" | "tag")).collect();
        if !self.visible.is_empty() && main_runs.iter().all(|run| !run.created) && !main_runs.iter().any(|run| run.uncertain.is_some()) {
            let why: Vec<String> = main_runs.iter().map(|run| format!("{}: {}", run.title, run.reason)).collect();
            self.cx.add(draft!("pipeline-never", Warning, title = tr!("Пайплайн не создаётся ни при push, ни для MR, ни для тега"), when = tr!("При push, merge request и теге"), how = tr!("Ничего не будет запускаться — GitLab молча не создаст пайплайн."), why = why.join("; "), fix = tr!("Проверьте workflow:rules и rules заданий."), file = self.main.clone(), line = self.workflow_line()));
        }
        for name in self.visible.clone() {
            if out.iter().any(|run| run.jobs.iter().any(|job| job.name == name) || run.excluded.iter().any(|item| item.name == name && item.uncertain.is_some())) {
                continue;
            }
            if out.iter().all(|run| !run.created && run.workflow_blocked == Some(true)) {
                continue;
            }
            let cfg = self.resolved(&name).cloned().unwrap_or(Value::Null);
            let rules = cfg.get("rules").and_then(Value::as_seq);
            if cfg.get("when").and_then(Value::as_str) == Some("never") || rules.is_some_and(|rules| rules.iter().filter(|rule| matches!(rule, Value::Map(_))).all(|rule| rule.get("when").and_then(Value::as_str) == Some("never"))) {
                continue;
            }
            if rules.is_some_and(|rules| rules.iter().any(|rule| matches!(rule, Value::Map(_)) && rule.get("if").and_then(Value::as_str).is_some_and(|text| parse_expr(text).is_err()))) {
                continue;
            }
            let path = if cfg.get("rules").is_some_and(Value::truthy) {
                kp!["rules"]
            } else if cfg.get("only").is_some_and(Value::truthy) {
                kp!["only"]
            } else {
                Vec::new()
            };
            let titles: Vec<&str> = out.iter().map(|run| run.title.as_str()).collect();
            let why = out.iter().find_map(|run| run.excluded.iter().find(|item| item.name == name).map(|item| item.why.clone()).filter(|why| !why.is_empty())).unwrap_or_else(|| tr!("Условия rules/only не выполняются."));
            self.job_issue(&name, &path, draft!("job-never-runs", Info, title = tr!("{0} не попадает ни в один типичный пайплайн", q(&name)), when = titles.join(", "), how = tr!("Задание не запустится при push, MR, теге, по расписанию и при ручном запуске."), why = why, fix = tr!("Если задание запускается через API/триггер или по особой переменной — всё в порядке; иначе проверьте условия.")));
        }
        out
    }
}
