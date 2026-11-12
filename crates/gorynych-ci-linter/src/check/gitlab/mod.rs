//! Проверка `.gitlab-ci.yml`: `electron/ciCheckGitlab.cjs`. То, что GitLab отклонит при создании пайплайна, то, что упадёт при выполнении заданий,
//! и прогон типичных событий (push, merge request, тег, расписание, ручной запуск).
//!
//! ## Конспект
//! Тексты `how` строятся через [`rejected`]: сообщение GitLab в кавычках остаётся английским дословно.
//! - [`Gl::top_level`]: повторы ключей, не словари, нет заданий, типы служебных разделов, `default`.
//! - [`Gl::check_workflow`], [`Gl::check_includes`], [`Gl::check_redefined`], [`Gl::check_extends`]: см. `extends.rs`.
//! - `jobs.rs`: ключи заданий; `rules.rs`: `rules`, `only`; `values.rs`: переменные, образы, артефакты, кэш, окружения; `simulate.rs`: сценарии.
//!
//! ## Отличия от 1.x
//! **Исправлено по решению пользователя:** в 1.x `workflow:rules` проверялись раньше, чем инициализирован `const yamlVars`, и непредопределённая
//! переменная в условии (`if: $MY_VAR`) давала `ReferenceError`: проверка прерывалась с `check-failed`, без заданий и сценариев (2 из 40 настоящих
//! файлов). Теперь `yaml_vars` вычисляются до `workflow`, и такая переменная проверяется как в заданиях. Сравнение с эталоном — `FIXED_IN_2X` в
//! `tests/check_parity.rs`.

mod catalog;
mod extends;
mod jobs;
mod rules;
pub mod simulate;
mod values;

use std::collections::HashSet;

use self::catalog::*;
use super::CheckContext;
use super::base::*;
use crate::load::gitlab::GitlabModel;
use crate::load::model::{CiConfig, CiInclude};
use crate::yaml::{JsMap, PathItem, Value};

pub(super) fn extend(base: &[PathItem], more: Vec<PathItem>) -> Vec<PathItem> {
    base.iter().cloned().chain(more).collect()
}

pub(super) fn config_when() -> String {
    tr!("right-on-push-gitlab-checks")
}

pub(super) fn rejected(message: impl std::fmt::Display) -> String {
    tr!("gitlab-wont-create-pipeline-and", message)
}

/// `has`: есть ли значение по пути.
fn has(value: &Value, path: &[PathItem]) -> bool {
    let mut current = value;
    for item in path {
        let next = match (current, item) {
            (Value::Map(map), PathItem::Key(key)) => map.get(key),
            (Value::Map(map), PathItem::Index(index)) => map.get(&index.to_string()),
            (Value::Seq(items), PathItem::Index(index)) => items.get(*index),
            (Value::Seq(items), PathItem::Key(key)) => key.parse::<usize>().ok().and_then(|index| items.get(index)),
            _ => None,
        };
        match next {
            Some(found) => current = found,
            None => return false,
        }
    }
    true
}

/// Состояние проверки: замыкания `checkGitlab` в 1.x.
pub(super) struct Gl<'a, 'b> {
    pub cx: &'a mut CheckContext<'b>,
    pub config: &'a CiConfig,
    pub raw: &'a GitlabModel,
    pub main: String,
    pub globals: Value,
    pub defaults: Value,
    pub default_branch: String,
    pub branches: HashSet<String>,
    /// Подключения из сети.
    pub offline: Vec<CiInclude>,
    pub workflow: Option<Value>,
    pub visible: Vec<String>,
    pub resolved: indexmap::IndexMap<String, Value>,
    pub used_stages: HashSet<String>,
    pub only_jobs: Vec<(String, String, Option<u32>)>,
    pub tag_sets: indexmap::IndexMap<String, (Vec<String>, String, Option<u32>)>,
    pub dind_at: Option<(String, Option<u32>, String)>,
    pub yaml_vars: HashSet<String>,
}

impl Gl<'_, '_> {
    pub fn global_loc(&self, path: &[PathItem]) -> (String, Option<u32>) {
        let first = match path.first() {
            Some(PathItem::Key(key)) => key.as_str(),
            _ => "",
        };
        let definition = self.raw.global_defs.iter().rev().find(|item| item.key == first);
        let file = definition.map_or_else(|| self.main.clone(), |item| item.source.clone());
        let line = self.cx.pos.line(&file, path).or_else(|| definition.and_then(|item| item.line));
        (file, line)
    }

    pub fn chain_of(&self, name: &str) -> Vec<String> {
        self.raw.resolve_job(name).map_or_else(Vec::new, |job| job.chain.clone())
    }

    /// `locate`: файл и строка, где у задания или его родителя задан ключ.
    pub fn locate(&self, name: &str, path: &[PathItem]) -> (String, Option<u32>) {
        let mut chain = vec![name.to_owned()];
        chain.extend(self.chain_of(name));
        for item in &chain {
            for definition in self.raw.job_defs.iter().filter(|definition| definition.name == *item).rev() {
                if has(&definition.value, path) {
                    let full = extend(&[PathItem::from(item)], path.to_vec());
                    return (definition.source.clone(), self.cx.pos.line(&definition.source, &full).or(definition.line));
                }
            }
        }
        if !path.is_empty() {
            if has(&self.defaults, path) {
                return self.global_loc(&extend(&kp!["default"], path.to_vec()));
            }
            if let Some(PathItem::Key(first)) = path.first()
                && self.globals.get(first).is_some()
            {
                return self.global_loc(path);
            }
        }
        match self.raw.jobs.get(name) {
            Some(entry) => (entry.source.clone(), entry.line),
            None => (self.main.clone(), None),
        }
    }

    /// `jobIssue`.
    pub fn job_issue(&mut self, name: &str, path: &[PathItem], mut draft: Draft) {
        let (file, line) = self.locate(name, path);
        draft.when = draft.when.or_else(|| Some(config_when()));
        draft.file = draft.file.or(Some(file));
        draft.line = draft.line.or(line);
        draft.job = draft.job.or_else(|| Some(name.to_owned()));
        self.cx.add(draft);
    }

    /// `globIssue`.
    pub fn glob_issue(&mut self, path: &[PathItem], mut draft: Draft) {
        let (file, line) = self.global_loc(path);
        draft.when = draft.when.or_else(|| Some(config_when()));
        draft.file = draft.file.or(Some(file));
        draft.line = draft.line.or(line);
        self.cx.add(draft);
    }

    /// Повторяющиеся ключи, верхний уровень, типы служебных разделов. Возвращает имена видимых заданий.
    fn top_level(&mut self) -> Vec<String> {
        for file in &self.config.files {
            for duplicate in self.cx.pos.duplicates(&file.path) {
                let place = if duplicate.path.is_empty() { tr!("at-top-level") } else { tr!("in", q(duplicate.path.join(" → "))) };
                let how = format!("{}{}{}", tr!("there-will-be-no-error"), duplicate.first, tr!("is-lost-entirely"));
                self.cx.add(draft!(
                    "yaml-duplicate-key",
                    Warning,
                    title = tr!("key-is-repeated", q(&duplicate.key), place),
                    when = config_when(),
                    how = how,
                    why = tr!("key-may-appear-only-once"),
                    fix = tr!("remove-extra-block-or-merge"),
                    file = file.path.clone(),
                    line = Some(duplicate.line),
                ));
            }
        }

        let mut visible = Vec::new();
        let mut seen = HashSet::new();
        for definition in &self.raw.job_defs {
            if !seen.insert(definition.name.clone()) {
                continue;
            }
            if !self.raw.jobs.contains_key(&definition.name) {
                let near = suggest(&definition.name, GLOBAL_KEYS);
                let name = &definition.name;
                let id = if near.is_some() { "global-typo" } else { "job-not-hash" };
                let title = match near {
                    Some(near) => tr!("unknown-section-looks-like", q(name), q(near)),
                    None => tr!("job-must-be-set-of", q(name)),
                };
                let why = match near {
                    Some(near) => tr!("anything-that-isnt-reserved-section", near, if matches!(definition.value, Value::Seq(_)) { tr!("list") } else { tr!("string") }),
                    None => tr!("at-top-level-all-keys"),
                };
                let fix = match near {
                    Some(near) => tr!("rename-to", q(name), q(near)),
                    None => tr!("write-it-as-job-script", name, definition.value.as_str().unwrap_or("…")),
                };
                self.cx.add(draft!(id, Error, title = title, when = config_when(), how = rejected(format!("jobs:{name} config should be a hash")), why = why, fix = fix, file = definition.source.clone(), line = definition.line));
                continue;
            }
            if !definition.name.starts_with('.') {
                visible.push(definition.name.clone());
            }
        }
        if visible.is_empty() && self.config.errors.is_empty() {
            self.cx.add(draft!(
                "no-visible-jobs",
                Error,
                title = tr!("configuration-has-no-jobs"),
                when = config_when(),
                how = rejected("jobs config should contain at least one visible job"),
                why = if self.raw.jobs.is_empty() { tr!("file-has-only-reserved-sections") } else { tr!("there-are-only-hidden-jobs") },
                fix = tr!("add-job-whose-name-doesnt"),
                file = self.main.clone(),
                line = Some(1u32),
            ));
        }

        let globals = self.globals.clone();
        if globals.get("stages").is_some_and(|value| !matches!(value, Value::Seq(_))) {
            self.glob_issue(&kp!["stages"], draft!("stages-not-list", Error, title = tr!("stages-must-be-list"), how = rejected("stages config should be an array of strings"), why = tr!("stages-are-listed-in-order"), fix = "stages:\n  - build\n  - test\n  - deploy"));
        }
        if globals.get("types").is_some() {
            self.glob_issue(&kp!["types"], draft!("types-removed", Warning, title = tr!("types-section-is-deprecated"), how = tr!("in-newer-gitlab-versions-17"), why = tr!("types-is-old-name-of"), fix = tr!("rename-types-to-stages")));
        }
        if globals.get("variables").is_some_and(|value| !matches!(value, Value::Map(_))) {
            self.glob_issue(&kp!["variables"], draft!("variables-not-hash", Error, title = tr!("variables-must-be-set-of"), how = rejected("variables config should be a hash of key value pairs"), why = tr!("variables-are-given-as-map"), fix = "variables:\n  NODE_ENV: production"));
        }
        for key in ["image", "services", "cache", "before_script", "after_script"] {
            if globals.get(key).is_some() && self.raw.global_defs.iter().any(|item| item.key == key) {
                self.glob_issue(&kp![key], draft!("global-deprecated", Info, title = tr!("global-is-deprecated-use-default", key), how = tr!("it-works-for-now-but-gitlab"), why = tr!("top-level-job-keys-were", key), fix = format!("default:\n  {key}: …")));
            }
        }
        if let Some(Value::Map(default)) = globals.get("default") {
            for key in default.keys() {
                if !DEFAULT_KEYS.contains(&key.as_str()) {
                    let hint = if matches!(key.as_str(), "stage" | "variables" | "rules" | "only") { tr!("is-set-in-each-job", q(key)) } else { String::new() };
                    self.glob_issue(&kp!["default", key], draft!("default-unknown-key", Error, title = tr!("default-unknown-key", q(key)), how = rejected(format!("default config contains unknown keys: {key}")), why = tr!("only-these-are-allowed-in", DEFAULT_KEYS.join(", "), hint, did_you_mean(key, DEFAULT_KEYS)), fix = tr!("remove-key-from-default-or")));
                }
            }
        }
        visible
    }

    fn check_includes(&mut self) {
        let includes = self.raw.includes.clone();
        let needle_of = |value: &Value| {
            let text = value.js_string();
            gorynych_core::js::trim(text.split([':', '@']).next().unwrap_or_default()).to_owned()
        };
        for include in &includes {
            let from = include.from.clone().unwrap_or_default();
            let value = include.value.js_string();
            let line = self.cx.pos.find(&from, &needle_of(&include.value), 1).or_else(|| self.cx.pos.line(&from, &kp!["include"]));
            macro_rules! at {
                ($id:expr, $severity:ident $(, $field:ident = $item:expr)* $(,)?) => {
                    self.cx.add(draft!($id, $severity, when = config_when(), file = from.clone(), line = line $(, $field = $item)*))
                };
            }
            match include.kind.as_str() {
                "local" => {
                    if value.contains('$') {
                        at!("include-variable", Info, title = tr!("include-path-with-variable", value), how = tr!("file-cant-be-checked-in"), why = tr!("only-some-variables-are-allowed"), fix = tr!("make-sure-file-exists-for"));
                    } else if !re!(r"\.ya?ml$", "i").test(&value) && !value.ends_with('*') {
                        at!("include-not-yaml", Error, title = tr!("include-not-yaml-file", value), how = rejected(format!("Included file `{value}` does not have YAML extension!")), why = tr!("only-yml-yaml-files-can"), fix = tr!("rename-file-to-yml-or"));
                    } else if let Some(error) = &include.error {
                        if error.contains(&tr!("not-found")) {
                            let hint = if value.contains('*') { tr!("no-file-matches-pattern") } else { String::new() };
                            at!("include-local-missing", Error, title = tr!("include-file-isnt-in-repository", value), how = rejected(format!("Local file `{value}` does not exist!")), why = tr!("file-is-looked-up-from", hint), fix = tr!("check-path-from-root-letter"));
                        } else {
                            at!("include-depth", Error, title = format!("include {value}: {error}"), how = rejected("Maximum of nested includes reached"), why = tr!("gitlab-limits-nesting-of-includes"), fix = tr!("shorten-include-chain"));
                        }
                    }
                }
                "remote" => {
                    if re!(r"^http:\/\/", "i").test(&value) {
                        at!("include-http", Warning, title = tr!("include-over-insecure-http", value), how = tr!("file-can-be-tampered-with"), why = tr!("remote-files-are-downloaded-every"), fix = tr!("use-https-or-keep-file"));
                    }
                    self.offline.push(include.clone());
                }
                "unknown" => {
                    at!("include-unknown", Error, title = tr!("include-unrecognized-entry"), how = rejected("Include config contains unknown keys"), why = tr!("include-must-contain-one-of"), fix = "include:\n  - local: ci/build.yml");
                }
                _ => self.offline.push(include.clone()),
            }
            if include.kind == "project" && !re!(r":\s*\S").test(&value) {
                at!("include-project-no-file", Error, title = tr!("include-project-without-file"), how = rejected("Include config is missing the file key"), why = tr!("including-from-another-project-requires"), fix = "include:\n  - project: group/ci\n    file: /templates/build.yml");
            }
        }
        if let Some(first) = self.offline.first().cloned() {
            let count = self.offline.len();
            let list: Vec<String> = self.offline.iter().take(4).map(|item| format!("{}: {}", item.kind, item.value.js_string())).collect();
            let from = first.from.clone().unwrap_or_default();
            let line = self.cx.pos.find(&from, &needle_of(&first.value), 1);
            self.cx.add(draft!(
                "include-offline",
                Info,
                title = tr!("network-includes-not-checked", count),
                when = config_when(),
                how = tr!("if-such-file-is-unavailable"),
                why = tr!("these-files-are-outside-repository", list.join("; "), if count > 4 { "…" } else { "" }),
                fix = tr!("check-merged-configuration-in-gitlab"),
                file = from,
                line = line,
            ));
        }
    }

    fn check_redefined(&mut self) {
        let mut by_name: indexmap::IndexMap<&str, Vec<&crate::load::gitlab::JobDef>> = indexmap::IndexMap::new();
        for definition in &self.raw.job_defs {
            by_name.entry(&definition.name).or_default().push(definition);
        }
        for (name, definitions) in by_name {
            let mut files: Vec<&str> = Vec::new();
            for definition in &definitions {
                if !files.contains(&definition.source.as_str()) {
                    files.push(&definition.source);
                }
            }
            if files.len() > 1 {
                let last_file = files[files.len() - 1];
                let last = definitions[definitions.len() - 1];
                let others: Vec<String> = files[..files.len() - 1].iter().map(q).collect();
                self.cx.add(draft!(
                    "job-redefined",
                    Info,
                    title = tr!("is-defined-in-several-files", q(name)),
                    when = config_when(),
                    how = tr!("final-job-is-merge-of", if last_file == self.main { tr!("main-file") } else { q(last_file) }, others.join(", ")),
                    why = tr!("thats-how-include-works-jobs"),
                    fix = tr!("if-this-is-intended-all"),
                    file = last.source.clone(),
                    line = last.line,
                    job = name.to_owned(),
                ));
            }
        }
    }

    pub fn check_workflow_part(&mut self) -> Option<Value> {
        let workflow_value = self.globals.get("workflow").cloned();
        let workflow = workflow_value.clone().filter(|value| matches!(value, Value::Map(_)));
        if workflow_value.is_some() && workflow.is_none() {
            self.glob_issue(&kp!["workflow"], draft!("workflow-not-hash", Error, title = tr!("workflow-must-be-map"), how = rejected("workflow config should be a hash"), why = tr!("workflow-contains-rules-name-auto"), fix = "workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH"));
        }
        if let Some(Value::Map(map)) = &workflow {
            for key in map.keys() {
                if !WORKFLOW_KEYS.contains(&key.as_str()) {
                    self.glob_issue(&kp!["workflow", key], draft!("workflow-unknown-key", Error, title = tr!("workflow-unknown-key", q(key)), how = rejected(format!("workflow config contains unknown keys: {key}")), why = tr!("allowed", WORKFLOW_KEYS.join(", "), did_you_mean(key, WORKFLOW_KEYS)), fix = tr!("remove-or-rename-key")));
                }
            }
        }
        workflow
    }
}

/// `checkGitlab`.
pub(super) fn check_gitlab(config: &CiConfig, raw: &GitlabModel, cx: &mut CheckContext<'_>, default_branch: String, branches: HashSet<String>) -> Result<Vec<simulate::CiScenario>, String> {
    let globals = raw.globals.clone();
    let defaults = globals.get("default").filter(|value| matches!(value, Value::Map(_))).cloned().unwrap_or_else(|| Value::Map(JsMap::new()));
    let main = config.files.first().map_or_else(|| ".gitlab-ci.yml".to_owned(), |file| file.path.clone());
    let mut gl = Gl {
        cx,
        config,
        raw,
        main,
        globals,
        defaults,
        default_branch,
        branches,
        offline: Vec::new(),
        workflow: None,
        visible: Vec::new(),
        resolved: indexmap::IndexMap::new(),
        used_stages: HashSet::new(),
        only_jobs: Vec::new(),
        tag_sets: indexmap::IndexMap::new(),
        dind_at: None,
        yaml_vars: HashSet::new(),
    };
    gl.visible = gl.top_level();
    // Переменные из файла нужны уже условиям `workflow:rules` (см. «Отличия от 1.x»). Разрешение заданий проблем не создаёт
    for name in raw.jobs.keys() {
        let config = raw.resolve_job(name).map_or_else(|| raw.jobs[name].config.clone(), |job| job.config.clone());
        gl.resolved.insert(name.clone(), raw.resolve_references(&config));
    }
    if let Some(Value::Map(map)) = gl.globals.get("variables") {
        gl.yaml_vars.extend(map.keys().cloned());
    }
    for name in &gl.visible {
        if let Some(Value::Map(map)) = gl.resolved.get(name).and_then(|cfg| cfg.get("variables")) {
            gl.yaml_vars.extend(map.keys().cloned());
        }
    }

    gl.workflow = gl.check_workflow_part();
    if let Some(rules) = gl.workflow.clone().as_ref().and_then(|workflow| workflow.get("rules").cloned()) {
        gl.check_rules(&rules, rules::RuleOwner::Workflow)?;
    }
    gl.check_includes();
    gl.check_redefined();
    gl.check_extends();

    for name in gl.visible.clone() {
        gl.check_job(&name)?;
    }
    gl.after_jobs();
    gl.check_needs_cycles();
    gl.check_job_scripts()?;
    Ok(gl.simulate())
}
