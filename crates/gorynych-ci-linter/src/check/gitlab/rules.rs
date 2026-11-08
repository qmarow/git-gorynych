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
    /// `checkVarName`. В 1.x `workflow:rules` проверялись до инициализации `yamlVars`: непредопределённая переменная прерывала всю проверку.
    pub(super) fn check_var_name(&mut self, variable: &str, file: Option<String>, line: Option<u32>, job: Option<String>, in_script: bool) -> Result<(), String> {
        if PREDEFINED.contains(variable) {
            return Ok(());
        }
        if !self.yaml_vars_ready {
            return Err("Cannot access 'yamlVars' before initialization".to_owned());
        }
        if self.yaml_vars.contains(variable) {
            return Ok(());
        }
        let when = if in_script { tr!("При выполнении задания {0}", q(job.clone().unwrap_or_default())) } else { config_when() };
        if let Some(replacement) = old_var(variable) {
            let how = tr!("Переменная будет пустой: {0}.", if in_script { tr!("команда получит пустую строку") } else { tr!("условие никогда не сработает так, как задумано") });
            self.cx.add(draft!("var-removed", Error, title = tr!("${0} больше не существует", variable), when = when, how = how, why = tr!("Переменные CI_BUILD_* удалены в GitLab 9.0; теперь это ${0}.", replacement), fix = tr!("Замените на ${0}.", replacement), file = file, line = line, job = job));
            return Ok(());
        }
        let near = suggest(variable, predefined_ordered());
        let mut item = draft!(
            "var-unknown-predefined",
            Info,
            title = tr!("${0} — нет такой предопределённой переменной", variable),
            when = when,
            how = if in_script { tr!("Ошибки не будет, но на месте переменной окажется пустая строка.") } else { tr!("Ошибки не будет, но переменная всегда пустая — условие будет вести себя так, будто её нет.") },
            why = match near {
                Some(near) => tr!("Похоже на опечатку: есть ${0}.", near),
                None => tr!("Имена с CI_ / GITLAB_ зарезервированы GitLab, а такой среди них нет (если это переменная из настроек проекта — всё в порядке)."),
            },
            fix = match near {
                Some(near) => tr!("Замените на ${0}.", near),
                None => tr!("Проверьте имя."),
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
            add_at!(Vec::new(), "rules-not-list", Error, title = tr!("{0}: rules должен быть списком", who), when = config_when(), how = rejected(format!("{place} config should be an array of hashes")), why = tr!("Каждое правило — отдельный элемент списка, начинается с «- »."), fix = "rules:\n  - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH");
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
                let shown = if let Value::String(text) = rule { tr!("строка {0}", q(text)) } else { rule.json_string() };
                let fix = if let Value::String(text) = rule { format!("- if: {text}") } else { "- if: …".to_owned() };
                add_at!(kp![index], "rule-not-hash", Error, title = tr!("{0}: правило {1} — не карта", who, number), when = config_when(), how = rejected(format!("{place}:rule config should be a hash")), why = tr!("Сейчас правило — {0}.", shown), fix = fix);
                continue;
            };
            for key in map.keys() {
                if !keys.contains(&key.as_str()) {
                    let hint = if workflow && matches!(key.as_str(), "allow_failure" | "needs" | "start_in") { tr!(" {0} работает только в rules заданий.", q(key)) } else { String::new() };
                    add_at!(kp![index, key], "rule-unknown-key", Error, title = tr!("{0}: в правиле {1} неизвестный ключ {2}", who, number, q(key)), when = config_when(), how = rejected(format!("{place}:rule config contains unknown keys: {key}")), why = tr!("Допустимы: {0}.{1}{2}", keys.join(", "), did_you_mean(key, keys.iter().copied()), hint), fix = tr!("Исправьте или уберите ключ."));
                }
            }
            let when = rule.get("when");
            if let Some(value) = when
                && !value.as_str().is_some_and(|text| allowed_when.contains(&text))
            {
                let why = if workflow { tr!("В workflow:rules допустимы только always и never.") } else { tr!("Допустимы: {0}.{1}", RULE_WHEN.join(", "), did_you_mean(&value.js_string(), RULE_WHEN)) };
                add_at!(kp![index, "when"], "rule-when", Error, title = tr!("{0}: правило {1}: when: {2}", who, number, arg(value)), when = config_when(), how = rejected(format!("{place}:rule when unknown value: {}", value.js_string())), why = why, fix = if workflow { "when: always" } else { "when: on_success" });
            }
            if when.and_then(Value::as_str) == Some("delayed") && rule.get("start_in").is_none() && cfg.is_none_or(|cfg| cfg.get("start_in").is_none()) {
                add_at!(kp![index], "rule-delayed", Error, title = tr!("{0}: правило {1}: delayed без start_in", who, number), when = config_when(), how = rejected(format!("{place}:rule start in should be specified for delayed job")), why = tr!("Нужно указать задержку."), fix = "start_in: 10 minutes");
            }
            if let Some(condition) = rule.get("if") {
                let if_path = kp![index, "if"];
                match condition {
                    Value::String(text) => match parse_expr(text) {
                        Err(error) => {
                            add_at!(if_path, "rule-if-syntax", Error, title = tr!("{0}: ошибка в условии {1}", who, q(text)), when = config_when(), how = rejected(format!("{place}:rule if invalid expression syntax")), why = format!("{}.", capitalize(&error)), fix = tr!("Пример: if: '$CI_COMMIT_BRANCH == \"main\" && $CI_PIPELINE_SOURCE == \"push\"'"));
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
                        add_at!(if_path, "rule-if-type", Error, title = tr!("{0}: правило {1}: if должен быть строкой", who, number), when = config_when(), how = rejected(format!("{place}:rule if should be a string")), why = tr!("YAML прочитал значение как {0}.", js_typeof(other)), fix = tr!("Возьмите выражение в кавычки: if: '$VAR == \"x\"'"));
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
                    add_at!(kp![index, "exists"], "rule-exists-none", Warning, title = tr!("{0}: правило {1}: exists — таких файлов нет", who, number), when = config_when(), how = tr!("Правило никогда не сработает, пока такие файлы не появятся в репозитории."), why = tr!("Под {0} не подходит ни один файл репозитория.", list_text.join(", ")), fix = tr!("Проверьте путь/шаблон (от корня репозитория, регистр букв)."));
                }
            }
            if let Some(changes) = rule.get("changes") {
                let source = if let Value::Map(change_map) = changes {
                    for key in change_map.keys() {
                        if !matches!(key.as_str(), "paths" | "compare_to") {
                            add_at!(kp![index, "changes", key], "rule-changes-key", Error, title = tr!("{0}: правило {1}: changes — неизвестный ключ {2}", who, number, q(key)), when = config_when(), how = rejected(format!("{place}:rule:changes config contains unknown keys: {key}")), why = tr!("Допустимы paths и compare_to."), fix = "changes:\n  paths:\n    - src/**/*");
                        }
                    }
                    changes.get("paths")
                } else {
                    Some(changes)
                };
                let paths: Vec<String> = arr(source).into_iter().map(Value::js_string).collect();
                if !paths.is_empty() && paths.iter().all(|path| !path.contains('$') && !self.cx.repo.glob(path) && !self.cx.repo.has_file(path) && !self.cx.repo.has_dir(path)) {
                    let list_text: Vec<String> = paths.iter().map(q).collect();
                    add_at!(kp![index, "changes"], "rule-changes-none", Info, title = tr!("{0}: правило {1}: changes — сейчас таких файлов нет", who, number), when = tr!("При push и в merge request"), how = tr!("Правило не сработает при обычных изменениях (только если такие файлы добавят)."), why = tr!("Под {0} сейчас не подходит ни один файл.", list_text.join(", ")), fix = tr!("Проверьте шаблон: «src/**/*» — все файлы в src, «*.md» — только в корне."));
                }
            }
            let is_catch_all = rule.get("if").is_none() && rule.get("changes").is_none() && rule.get("exists").is_none();
            if catch_all >= 0.0 {
                add_at!(kp![index], "rule-unreachable", Warning, title = tr!("{0}: правило {1} никогда не проверяется", who, number), when = config_when(), how = tr!("Ошибки не будет, но это правило ни на что не влияет."), why = tr!("Правило {0} без условий срабатывает всегда, а GitLab берёт первое подходящее правило.", gorynych_core::js::number_to_string(catch_all + 1.0)), fix = tr!("Переставьте правило без условий в конец списка."));
                catch_all = f64::INFINITY;
            } else if is_catch_all && number < list.len() {
                catch_all = index as f64;
            }
        }
        let real: Vec<&Value> = list.iter().filter(|rule| matches!(rule, Value::Map(_))).collect();
        let all_never = !real.is_empty() && real.iter().all(|rule| rule.get("when").and_then(Value::as_str) == Some("never"));
        if all_never && !workflow {
            add_at!(Vec::new(), "rules-all-never", Warning, title = tr!("{0}: все правила — when: never", who), when = config_when(), how = tr!("Задание не попадёт ни в один пайплайн."), why = tr!("Если ни одно правило не включает задание, оно исключается; здесь все правила только исключают."), fix = tr!("Добавьте в конец правило «- when: on_success» (или нужное условие)."));
        }
        if all_never && workflow {
            add_at!(Vec::new(), "workflow-all-never", Error, title = tr!("workflow:rules: все правила — when: never"), when = config_when(), how = tr!("Пайплайн не будет создаваться никогда."), why = tr!("Если ни одно правило workflow не сработало с when: always, пайплайн не создаётся."), fix = tr!("Добавьте в конец «- when: always» или правило с нужным условием."));
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
                    let how = tr!("Условие {0}.", if *op == "==" { tr!("никогда не выполнится") } else { tr!("выполнится всегда") });
                    let why = tr!("Возможные значения: {0}…{1}", PIPELINE_SOURCES[..10].join(", "), near.map_or_else(String::new, |near| tr!(" Возможно, имелось в виду {0}.", q(near))));
                    let fix = near.map_or_else(|| tr!("Проверьте значение."), |near| tr!("Замените на \"{0}\".", near));
                    self.cx.add(draft!("pipeline-source-value", Warning, title = tr!("{0}: CI_PIPELINE_SOURCE никогда не равен {1}", who, q(text)), when = config_when(), how = how, why = why, fix = fix, file = file.to_owned(), line = line, job = job.clone()));
                }
                let is_branch_var = matches!(variable, "CI_COMMIT_BRANCH" | "CI_COMMIT_REF_NAME" | "CI_MERGE_REQUEST_TARGET_BRANCH_NAME" | "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" | "CI_DEFAULT_BRANCH");
                if is_branch_var && !self.branches.is_empty() && !self.branches.contains(text) {
                    let default = self.default_branch.clone();
                    let swapped = (text == "master" && default == "main") || (text == "main" && default == "master");
                    let mut item = draft!(
                        if swapped { "branch-main-master" } else { "branch-missing" },
                        Info,
                        title = tr!("{0}: ветки {1} нет в репозитории", who, q(text)),
                        when = config_when(),
                        how = if swapped { tr!("Условие с {0} никогда не сработает — основная ветка здесь {1}.", q(text), q(&default)) } else { tr!("Условие сработает, только когда появится ветка {0}.", q(text)) },
                        why = tr!("Сравнивается ${0} с {1}, а в репозитории {2}.", variable, q(text), if swapped { tr!("основная ветка — {0}", q(&default)) } else { tr!("такой ветки нет (ни локально, ни на удалённом сервере)") }),
                        fix = if swapped { tr!("Используйте $CI_DEFAULT_BRANCH вместо \"{0}\" — так условие не зависит от названия ветки.", text) } else { tr!("Если это опечатка — исправьте; для основной ветки лучше $CI_DEFAULT_BRANCH.") },
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
                    add_at!(kp![inner], "only-unknown-key", Error, title = tr!("{0}: {1} — неизвестный ключ {2}", q(name), key, q(inner)), how = rejected(format!("jobs:{name}:{key} config contains unknown keys: {inner}")), why = tr!("Допустимы: {0}.{1}", ONLY_KEYS.join(", "), did_you_mean(inner, ONLY_KEYS)), fix = tr!("Исправьте ключ (а лучше перейдите на rules)."));
                }
            }
            for (index, expression) in arr(spec.get("variables")).into_iter().enumerate() {
                let source = if expression.is_null() { String::new() } else { expression.js_string() };
                if let Err(error) = parse_expr(&source) {
                    add_at!(kp!["variables", index], "only-variables-syntax", Error, title = tr!("{0}: ошибка в {1}:variables {2}", q(name), key, q(expression.js_string())), how = rejected(format!("jobs:{name}:{key}:variables invalid expression syntax")), why = format!("{error}."), fix = tr!("Пример: - $CI_COMMIT_MESSAGE =~ /deploy/"));
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
                add_at!(path, "only-keyword-typo", Warning, title = tr!("{0}: {1}: {2} — это имя ветки, а не {3}", q(name), key, text, q(near)), how = tr!("GitLab поймёт {0} как название ветки или тега и {1}.", q(&text), if key == "only" { tr!("будет запускать задание только для неё") } else { tr!("исключит только её") }), why = tr!("Ключевое слово пишется {0}.", q(near)), fix = tr!("Замените на {0}.", near));
            }
        }
        if !self.only_jobs.iter().any(|item| item.0 == name) {
            let (file, line) = self.locate(name, &kp![key]);
            self.only_jobs.push((name.to_owned(), file, line));
        }
    }
}
