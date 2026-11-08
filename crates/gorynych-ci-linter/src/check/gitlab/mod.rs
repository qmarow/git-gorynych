//! Проверка `.gitlab-ci.yml`: `electron/ciCheckGitlab.cjs`. То, что GitLab отклонит при создании пайплайна, то, что упадёт при выполнении заданий,
//! и прогон типичных событий (push, merge request, тег, расписание, ручной запуск).
//!
//! ## Конспект
//! Тексты `how` строятся через [`rejected`]: сообщение GitLab в кавычках остаётся английским дословно.
//! - [`Gl::top_level`]: повторы ключей, не словари, нет заданий, типы служебных разделов, `default`.
//! - [`Gl::check_workflow`], [`Gl::check_includes`], [`Gl::check_redefined`], [`Gl::check_extends`]: см. `extends.rs`.
//! - `jobs.rs`: ключи заданий; `rules.rs`: `rules`, `only`; `values.rs`: переменные, образы, артефакты, кэш, окружения; `simulate.rs`: сценарии.
//!
//! ## Ошибка 1.x, воспроизведена намеренно
//! `workflow:rules` проверяются раньше, чем инициализирован `const yamlVars`: непредопределённая переменная в условии (`if: $MY_VAR`) даёт `ReferenceError`, и проверка прерывается с `check-failed`,
//! без заданий и сценариев. Исправление — убрать `Gl::yaml_vars_ready` и вычислять `yaml_vars` до `workflow`; решение за пользователем.

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
    tr!("Сразу при push — GitLab проверяет весь файл ещё до создания пайплайна")
}

pub(super) fn rejected(message: impl std::fmt::Display) -> String {
    tr!("GitLab не создаст пайплайн и покажет ошибку: «{0}». Ни одно задание не запустится.", message)
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
    /// См. [`Gl::check_var_name`].
    pub yaml_vars_ready: bool,
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
                let place = if duplicate.path.is_empty() { tr!("на верхнем уровне") } else { tr!("в {0}", q(duplicate.path.join(" → "))) };
                let how = format!("{}{}{}", tr!("Ошибки не будет: YAML молча возьмёт последнее значение, а первое (строка "), duplicate.first, tr!(") будет потеряно целиком."));
                self.cx.add(draft!(
                    "yaml-duplicate-key",
                    Warning,
                    title = tr!("Ключ {0} повторяется {1}", q(&duplicate.key), place),
                    when = config_when(),
                    how = how,
                    why = tr!("В одном блоке YAML ключ может встречаться только один раз; повтор обычно — результат копирования."),
                    fix = tr!("Удалите лишний блок или объедините их в один."),
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
                    Some(near) => tr!("Неизвестный раздел {0} — похоже на {1}", q(name), q(near)),
                    None => tr!("{0}: задание должно быть набором ключей", q(name)),
                };
                let why = match near {
                    Some(near) => tr!("Всё, что не является служебным разделом ({0} и др.), GitLab считает заданием, а задание не может быть {1}.", near, if matches!(definition.value, Value::Seq(_)) { tr!("списком") } else { tr!("строкой") }),
                    None => tr!("На верхнем уровне все ключи, кроме служебных (stages, variables, default…), — это задания; задание описывается картой с script/stage и т.д."),
                };
                let fix = match near {
                    Some(near) => tr!("Переименуйте {0} в {1}.", q(name), q(near)),
                    None => tr!("Оформите как задание:\n{0}:\n  script:\n    - {1}", name, definition.value.as_str().unwrap_or("…")),
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
                title = tr!("В конфигурации нет ни одного задания"),
                when = config_when(),
                how = rejected("jobs config should contain at least one visible job"),
                why = if self.raw.jobs.is_empty() { tr!("В файле только служебные разделы.") } else { tr!("Есть только скрытые задания (имя начинается с точки) — они служат шаблонами и сами не запускаются.") },
                fix = tr!("Добавьте задание без точки в начале имени, например:\nbuild:\n  script:\n    - echo \"ok\""),
                file = self.main.clone(),
                line = Some(1u32),
            ));
        }

        let globals = self.globals.clone();
        if globals.get("stages").is_some_and(|value| !matches!(value, Value::Seq(_))) {
            self.glob_issue(&kp!["stages"], draft!("stages-not-list", Error, title = tr!("stages должен быть списком"), how = rejected("stages config should be an array of strings"), why = tr!("Этапы перечисляются списком в порядке выполнения."), fix = "stages:\n  - build\n  - test\n  - deploy"));
        }
        if globals.get("types").is_some() {
            self.glob_issue(&kp!["types"], draft!("types-removed", Warning, title = tr!("Раздел types устарел"), how = tr!("В новых версиях GitLab (17.0+) ключ удалён — файл перестанет проходить проверку."), why = tr!("types — старое название stages."), fix = tr!("Переименуйте types в stages.")));
        }
        if globals.get("variables").is_some_and(|value| !matches!(value, Value::Map(_))) {
            self.glob_issue(&kp!["variables"], draft!("variables-not-hash", Error, title = tr!("variables должен быть набором «ИМЯ: значение»"), how = rejected("variables config should be a hash of key value pairs"), why = tr!("Переменные задаются картой, а не списком."), fix = "variables:\n  NODE_ENV: production"));
        }
        for key in ["image", "services", "cache", "before_script", "after_script"] {
            if globals.get(key).is_some() && self.raw.global_defs.iter().any(|item| item.key == key) {
                self.glob_issue(&kp![key], draft!("global-deprecated", Info, title = tr!("Глобальный {0} устарел — используйте default:", key), how = tr!("Сейчас работает, но GitLab пометил такую запись устаревшей и может убрать её."), why = tr!("Ключи заданий на верхнем уровне ({0}) заменены разделом default.", key), fix = format!("default:\n  {key}: …")));
            }
        }
        if let Some(Value::Map(default)) = globals.get("default") {
            for key in default.keys() {
                if !DEFAULT_KEYS.contains(&key.as_str()) {
                    let hint = if matches!(key.as_str(), "stage" | "variables" | "rules" | "only") { tr!(" {0} задаётся в каждом задании (variables — на верхнем уровне).", q(key)) } else { String::new() };
                    self.glob_issue(&kp!["default", key], draft!("default-unknown-key", Error, title = tr!("default: неизвестный ключ {0}", q(key)), how = rejected(format!("default config contains unknown keys: {key}")), why = tr!("В default допустимы только: {0}.{1}{2}", DEFAULT_KEYS.join(", "), hint, did_you_mean(key, DEFAULT_KEYS)), fix = tr!("Уберите ключ из default или перенесите в задания.")));
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
                        at!("include-variable", Info, title = tr!("include {0}: путь с переменной", value), how = tr!("Проверить файл заранее нельзя: он определяется переменной в момент создания пайплайна."), why = tr!("В include разрешены только некоторые переменные (проекта, группы, предопределённые)."), fix = tr!("Убедитесь, что при всех значениях переменной файл существует."));
                    } else if !re!(r"\.ya?ml$", "i").test(&value) && !value.ends_with('*') {
                        at!("include-not-yaml", Error, title = tr!("include {0}: не YAML-файл", value), how = rejected(format!("Included file `{value}` does not have YAML extension!")), why = tr!("Подключать можно только файлы .yml / .yaml."), fix = tr!("Переименуйте файл в .yml или укажите правильный."));
                    } else if let Some(error) = &include.error {
                        if error.contains(&tr!("не найден")) {
                            let hint = if value.contains('*') { tr!("; под шаблон не подходит ни один файл") } else { String::new() };
                            at!("include-local-missing", Error, title = tr!("include {0}: файла нет в репозитории", value), how = rejected(format!("Local file `{value}` does not exist!")), why = tr!("Файл ищется от корня репозитория в той же ветке/коммите{0}.", hint), fix = tr!("Проверьте путь (от корня, регистр букв) и что файл закоммичен."));
                        } else {
                            at!("include-depth", Error, title = format!("include {value}: {error}"), how = rejected("Maximum of nested includes reached"), why = tr!("GitLab ограничивает вложенность подключений."), fix = tr!("Сократите цепочку include."));
                        }
                    }
                }
                "remote" => {
                    if re!(r"^http:\/\/", "i").test(&value) {
                        at!("include-http", Warning, title = tr!("include {0}: по незащищённому http", value), how = tr!("Файл может быть подменён по дороге — и подменённые задания выполнятся с вашими переменными и токенами."), why = tr!("remote-файлы скачиваются при каждом создании пайплайна."), fix = tr!("Используйте https:// или храните файл в репозитории (include: local / project)."));
                    }
                    self.offline.push(include.clone());
                }
                "unknown" => {
                    at!("include-unknown", Error, title = tr!("include: непонятная запись"), how = rejected("Include config contains unknown keys"), why = tr!("Подключение должно содержать один из ключей: local, project (+ file), remote, template, component."), fix = "include:\n  - local: ci/build.yml");
                }
                _ => self.offline.push(include.clone()),
            }
            if include.kind == "project" && !re!(r":\s*\S").test(&value) {
                at!("include-project-no-file", Error, title = tr!("include project без file"), how = rejected("Include config is missing the file key"), why = tr!("Для подключения из другого проекта нужно указать file."), fix = "include:\n  - project: group/ci\n    file: /templates/build.yml");
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
                title = tr!("Не проверены подключения из сети: {0}", count),
                when = config_when(),
                how = tr!("Если такой файл недоступен или в нём ошибка, GitLab не создаст пайплайн."),
                why = tr!("{0}{1} — эти файлы лежат вне репозитория, без сети их не проверить; задания из них в проверке не учтены.", list.join("; "), if count > 4 { "…" } else { "" }),
                fix = tr!("Проверьте итоговую конфигурацию в GitLab: CI/CD → Editor → Full configuration (или Validate)."),
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
                    title = tr!("{0} описано в нескольких файлах", q(name)),
                    when = config_when(),
                    how = tr!("Итоговое задание — слияние описаний: ключи из {0} перекрывают ключи из {1}; списки (script, rules) заменяются целиком.", if last_file == self.main { tr!("основного файла") } else { q(last_file) }, others.join(", ")),
                    why = tr!("Так работает include: одноимённые задания объединяются."),
                    fix = tr!("Если это сделано намеренно — всё в порядке; иначе переименуйте одно из заданий."),
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
            self.glob_issue(&kp!["workflow"], draft!("workflow-not-hash", Error, title = tr!("workflow должен быть картой"), how = rejected("workflow config should be a hash"), why = tr!("workflow содержит rules / name / auto_cancel."), fix = "workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH"));
        }
        if let Some(Value::Map(map)) = &workflow {
            for key in map.keys() {
                if !WORKFLOW_KEYS.contains(&key.as_str()) {
                    self.glob_issue(&kp!["workflow", key], draft!("workflow-unknown-key", Error, title = tr!("workflow: неизвестный ключ {0}", q(key)), how = rejected(format!("workflow config contains unknown keys: {key}")), why = tr!("Допустимы: {0}.{1}", WORKFLOW_KEYS.join(", "), did_you_mean(key, WORKFLOW_KEYS)), fix = tr!("Уберите или переименуйте ключ.")));
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
        yaml_vars_ready: false,
    };
    gl.visible = gl.top_level();
    gl.workflow = gl.check_workflow_part();
    if let Some(rules) = gl.workflow.clone().as_ref().and_then(|workflow| workflow.get("rules").cloned()) {
        gl.check_rules(&rules, rules::RuleOwner::Workflow)?;
    }
    gl.check_includes();
    gl.check_redefined();
    gl.check_extends();

    for name in raw.jobs.keys() {
        let config = raw.resolve_job(name).map_or_else(|| raw.jobs[name].config.clone(), |job| job.config.clone());
        gl.resolved.insert(name.clone(), raw.resolve_references(&config));
    }
    if let Some(Value::Map(map)) = gl.globals.get("variables") {
        gl.yaml_vars.extend(map.keys().cloned());
    }
    for name in gl.visible.clone() {
        if let Some(Value::Map(map)) = gl.resolved.get(&name).and_then(|cfg| cfg.get("variables")) {
            gl.yaml_vars.extend(map.keys().cloned());
        }
    }
    gl.yaml_vars_ready = true;

    for name in gl.visible.clone() {
        gl.check_job(&name)?;
    }
    gl.after_jobs();
    gl.check_needs_cycles();
    gl.check_job_scripts()?;
    Ok(gl.simulate())
}
