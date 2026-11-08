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
            self.job_issue(name, &[], draft!("job-name-long", Error, title = tr!("Слишком длинное имя задания"), how = rejected("job name is too long (maximum is 255 characters)"), why = tr!("Имя задания ограничено 255 символами."), fix = tr!("Сократите имя.")));
        }

        for (key, _) in cfg.js_entries() {
            if JOB_KEYS.contains(&key.as_str()) {
                continue;
            }
            let near = suggest(&key, JOB_KEYS);
            let suffix = near.map_or_else(String::new, |near| tr!(" — опечатка в {0}?", q(near)));
            let why = match near {
                Some(near) => tr!("GitLab не знает ключа {0}; ближайший допустимый — {1}.", q(&key), q(near)),
                None => tr!("GitLab проверяет все ключи задания; {0} среди них нет.{1}", q(&key), if own.get(&key).is_some() { String::new() } else { tr!(" Ключ пришёл из шаблона в extends.") }),
            };
            let fix = match near {
                Some(near) => tr!("Переименуйте {0} в {1}.", q(&key), q(near)),
                None => tr!("Удалите ключ или вынесите данные в variables."),
            };
            self.job_issue(name, &kp![&key], draft!("job-unknown-key", Error, title = tr!("{0}: неизвестный ключ {1}{2}", q(name), q(&key), suffix), how = rejected(format!("jobs:{name} config contains unknown keys: {key}")), why = why, fix = fix));
        }

        let (has_script, has_trigger, has_run) = (cfg.get("script").is_some(), cfg.get("trigger").is_some(), cfg.get("run").is_some());
        if !has_script && !has_trigger && !has_run {
            let near = suggest(name, GLOBAL_KEYS);
            let id = if near.is_some() { "global-typo" } else { "job-no-script" };
            let title = match near {
                Some(near) => tr!("{0} — опечатка в {1}?", q(name), q(near)),
                None => tr!("{0}: нет script", q(name)),
            };
            let why = if near.is_some() {
                tr!("Раздел {0} не служебный, поэтому GitLab считает его заданием, а у задания нет script.", q(name))
            } else {
                let from_templates = cfg.get("extends").is_some_and(Value::truthy) || !self.chain_of(name).is_empty();
                tr!("У задания нет команд для выполнения{0}.", if from_templates { tr!(" — и шаблоны в extends их не добавляют") } else { String::new() })
            };
            let fix = match near {
                Some(near) => tr!("Переименуйте в {0}.", q(near)),
                None => tr!("Добавьте script, например:\n{0}:\n  script:\n    - echo \"…\"", name),
            };
            self.job_issue(name, &[], draft!(id, Error, title = title, how = rejected(format!("jobs:{name} config should implement the script:, run:, or trigger: keyword")), why = why, fix = fix));
        }
        if has_script && has_trigger {
            self.job_issue(name, &kp!["trigger"], draft!("trigger-with-script", Error, title = tr!("{0}: trigger и script одновременно", q(name)), how = rejected(format!("jobs:{name} config key may not be used with `trigger`: script")), why = tr!("Задание с trigger само ничего не выполняет — оно запускает другой пайплайн."), fix = tr!("Разделите на два задания: одно со script, другое с trigger.")));
        }
        if has_script {
            let script = cfg.get("script");
            let lines = flat10(arr(script));
            let blank = matches!(script, Some(Value::Null)) || script.and_then(Value::as_str) == Some("") || (matches!(script, Some(Value::Seq(_))) && lines.is_empty());
            if blank {
                self.job_issue(name, &kp!["script"], draft!("script-empty", Error, title = tr!("{0}: пустой script", q(name)), how = rejected(format!("jobs:{name}:script config can't be blank")), why = tr!("В script должна быть хотя бы одна команда."), fix = tr!("Добавьте команду или удалите задание.")));
            }
            for key in ["script", "before_script", "after_script"] {
                for (index, item) in flat10(arr(cfg.get(key))).into_iter().enumerate() {
                    match item {
                        Value::Map(map) if crate::load::common::reference_of(item).is_none() => {
                            let first = map.keys().next().cloned();
                            let value = first.as_deref().and_then(|first| map.get(first));
                            let shown = format!("{}: {}", first.clone().unwrap_or_else(|| "undefined".to_owned()), js_str(value));
                            self.job_issue(name, &kp![key, index], draft!("script-colon", Error, title = tr!("{0}: строка {1} прочитана как «ключ: значение»", q(name), key), how = rejected(format!("jobs:{name}:{key} config should be a string or a nested array of strings up to 10 levels deep")), why = tr!("В строке {0} есть «: » — YAML считает это картой, а не командой.", q(shown)), fix = tr!("Возьмите строку в кавычки: - '{0}: {1}'", first.unwrap_or_default(), arg_opt(value))));
                        }
                        Value::Bool(_) | Value::Number(_) => {
                            self.job_issue(name, &kp![key, index], draft!("script-scalar", Warning, title = tr!("{0}: в {1} значение {2}", q(name), key, arg(item)), how = tr!("Выполнится команда {0} — скорее всего «command not found».", q(item.js_string())), why = tr!("YAML прочитал строку как число/логическое значение."), fix = tr!("Проверьте строку и возьмите её в кавычки.")));
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
            self.job_issue(name, &kp!["stage"], draft!("stage-type", Error, title = tr!("{0}: stage должен быть строкой", q(name)), how = rejected(format!("jobs:{name}:stage config should be a string")), why = tr!("Задание относится к одному этапу."), fix = "stage: test"));
        } else if !stage_names.contains(&stage) {
            let near = suggest(&stage, stage_names.iter().map(String::as_str));
            let why = if declared.is_empty() {
                tr!("stages не объявлен, поэтому доступны только build, test, deploy (+ .pre, .post).{0}", near.map_or_else(String::new, |near| tr!(" Возможно, {0}.", q(near))))
            } else {
                tr!("Объявлены этапы: {0}.{1}", declared.join(", "), near.map_or_else(String::new, |near| tr!(" Возможно, имелось в виду {0}.", q(near))))
            };
            let fix = match near {
                Some(near) => tr!("Исправьте на stage: {0} или добавьте {1} в stages.", near, q(&stage)),
                None => tr!("Добавьте {0} в stages.", q(&stage)),
            };
            self.job_issue(name, &kp!["stage"], draft!("stage-undeclared", Error, title = tr!("{0}: этапа {1} нет в stages", q(name), q(&stage)), how = rejected(format!("{name} job: chosen stage {stage} does not exist; available stages are {}", stage_names.join(", "))), why = why, fix = fix));
        }

        // when / start_in
        let when = cfg.get("when");
        let when_text = when.and_then(Value::as_str);
        if let Some(value) = when
            && !when_text.is_some_and(|text| JOB_WHEN.contains(&text))
        {
            let allowed: Vec<&str> = JOB_WHEN.iter().copied().filter(|item| *item != "never").collect();
            self.job_issue(name, &kp!["when"], draft!("when-invalid", Error, title = format!("{}: when: {}", q(name), value.js_string()), how = rejected(format!("jobs:{name} when should be one of: {}", allowed.join(", "))), why = tr!("Неизвестное значение.{0}", did_you_mean(&value.js_string(), JOB_WHEN)), fix = tr!("Используйте одно из: {0}.", JOB_WHEN.join(", "))));
        }
        if when_text == Some("never") {
            self.job_issue(name, &kp!["when"], draft!("when-never", Warning, title = tr!("{0}: when: never — задание никогда не запустится", q(name)), how = tr!("Задания не будет ни в одном пайплайне."), why = tr!("when: never на уровне задания отключает его полностью (обычно never пишут внутри rules)."), fix = tr!("Удалите задание или перенесите условие в rules.")));
        }
        let start_in = cfg.get("start_in");
        if when_text == Some("delayed") && start_in.is_none() {
            self.job_issue(name, &kp!["when"], draft!("delayed-no-start", Error, title = tr!("{0}: when: delayed без start_in", q(name)), how = rejected(format!("jobs:{name} start in should be specified for delayed job")), why = tr!("Отложенному заданию нужно знать, через сколько стартовать."), fix = "start_in: 30 minutes"));
        }
        if start_in.is_some() && when_text != Some("delayed") && !arr(cfg.get("rules")).iter().any(|rule| rule.get("when").and_then(Value::as_str) == Some("delayed")) {
            self.job_issue(name, &kp!["start_in"], draft!("start-in-not-delayed", Error, title = tr!("{0}: start_in без when: delayed", q(name)), how = rejected(format!("jobs:{name} start in must be blank when not delayed")), why = tr!("start_in имеет смысл только для отложенных заданий."), fix = tr!("Добавьте when: delayed или уберите start_in.")));
        }
        if let Some(value) = start_in {
            match duration_seconds(Some(value)) {
                None => self.job_issue(name, &kp!["start_in"], draft!("start-in-format", Error, title = tr!("{0}: не разобрать start_in: {1}", q(name), arg(value)), how = rejected(format!("jobs:{name}:start_in config should be a duration")), why = tr!("Длительность пишется как «30 minutes», «1 hour», «2 days»."), fix = "start_in: 30 minutes")),
                Some(seconds) if seconds > 7.0 * 86400.0 => self.job_issue(name, &kp!["start_in"], draft!("start-in-limit", Error, title = tr!("{0}: start_in больше недели", q(name)), how = rejected(format!("jobs:{name} start in should not exceed the limit")), why = tr!("Максимальная задержка — 1 неделя."), fix = tr!("Уменьшите start_in или используйте расписание."))),
                Some(_) => {}
            }
        }

        // rules / only / except
        if let Some(rules) = cfg.get("rules") {
            self.check_rules(rules, super::rules::RuleOwner::Job { name, cfg: &cfg })?;
            for key in ["only", "except"] {
                if cfg.get(key).is_some() {
                    let from_template = if own.get(key).is_some() { String::new() } else { tr!(" ({0} пришёл из шаблона)", key) };
                    self.job_issue(name, &kp![key], draft!("rules-with-only", Error, title = tr!("{0}: rules вместе с {1}", q(name), key), how = rejected(format!("jobs:{name} config key may not be used with `rules`: {key}")), why = tr!("rules заменяет {0}; вместе их использовать нельзя{1}.", key, from_template), fix = tr!("Перенесите условие из {0} в rules.", key)));
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
                self.job_issue(name, &kp!["needs"], draft!("needs-limit", Error, title = tr!("{0}: needs больше 50", q(name)), how = rejected(format!("{name} job: one job can only need 50 others")), why = tr!("Ограничение GitLab."), fix = tr!("Сократите список или объедините задания.")));
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
                    self.job_issue(name, &path, draft!("dependencies-unknown", Error, title = tr!("{0}: dependencies на несуществующее {1}", q(name), q(&text)), how = rejected(format!("{name} job: undefined dependency: {text}")), why = tr!("Задания {0} нет.{1}", q(&text), did_you_mean(&text, self.visible.iter().map(String::as_str))), fix = tr!("Поправьте имя.")));
                } else if let Some(names) = &need_names {
                    if !names.iter().any(|item| item.as_ref() == Some(dep)) {
                        self.job_issue(name, &path, draft!("dependencies-not-in-needs", Error, title = tr!("{0}: {1} в dependencies, но не в needs", q(name), q(&text)), how = rejected(format!("{name} job: dependencies the {text} should be part of needs")), why = tr!("Когда задан needs, dependencies может ссылаться только на задания из needs."), fix = tr!("Добавьте {0} в needs.", q(&text))));
                    }
                } else if self.stage_index(&text) >= self.stage_index(name) {
                    self.job_issue(name, &path, draft!("dependencies-later-stage", Error, title = tr!("{0}: {1} не из предыдущего этапа", q(name), q(&text)), how = rejected(format!("{name} job: dependency {text} is not defined in current or prior stages")), why = tr!("Артефакты можно брать только у заданий из предыдущих этапов, а {0} — в этапе {1}.", q(&text), q(self.stage_of(&text))), fix = tr!("Перенесите задание или используйте needs.")));
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
                self.job_issue(name, &kp!["services", index], draft!("service-no-name", Error, title = tr!("{0}: у сервиса нет name", q(name)), how = rejected(format!("jobs:{name}:services:service config must have a name")), why = tr!("Сервис — это образ Docker."), fix = "services:\n  - name: postgres:16\n    alias: db"));
                if let Some(alias) = service.get("alias").filter(|value| value.truthy()) {
                    self.check_service_alias(name, index, alias);
                }
                continue;
            };
            self.check_image_name(&service_name, Some(name), &kp!["services", index], &tr!("сервис"));
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
            self.job_issue(name, &kp!["services", index, "alias"], draft!("service-alias", Error, title = tr!("{0}: недопустимый alias сервиса {1}", q(name), q(alias.js_string())), how = tr!("Задание упадёт при запуске сервиса: имя хоста недопустимо."), why = tr!("alias становится именем хоста: только буквы, цифры, точка, дефис."), fix = tr!("Например alias: db")));
        }
    }

    fn check_need(&mut self, name: &str, index: usize, need: &Value, stage: &str) {
        if matches!(need, Value::Map(_)) && (need.get("pipeline").is_some_and(Value::truthy) || need.get("project").is_some_and(Value::truthy)) {
            return;
        }
        let path = kp!["needs", index];
        let Some(target) = job_of(need).filter(|value| !value.is_null()) else {
            self.job_issue(name, &path, draft!("needs-format", Error, title = tr!("{0}: в needs запись без job", q(name)), how = rejected(format!("jobs:{name}:needs config contains unknown keys")), why = tr!("Каждая запись needs — имя задания или { job: имя }."), fix = "needs:\n  - job: build\n    artifacts: true"));
            return;
        };
        let text = target.js_string();
        let optional = matches!(need.get("optional"), Some(Value::Bool(true)));
        let known = target.as_str().is_some_and(|value| self.raw.jobs.contains_key(value));
        if target.as_str() == Some(name) {
            self.job_issue(name, &path, draft!("needs-self", Error, title = tr!("{0} зависит само от себя", q(name)), how = rejected(format!("{name} job: needs itself (circular dependency)")), why = tr!("Задание не может ждать завершения самого себя."), fix = tr!("Уберите себя из needs.")));
        } else if !known || text.starts_with('.') {
            if !optional {
                let why = if text.starts_with('.') { tr!("{0} — скрытое задание (шаблон), оно не выполняется и не может быть в needs.", q(&text)) } else { tr!("Задания {0} нет.{1}", q(&text), did_you_mean(&text, self.visible.iter().map(String::as_str))) };
                let mut item = draft!("needs-unknown", Error, title = tr!("{0}: needs на несуществующее {1}", q(name), q(&text)), how = rejected(format!("'{name}' job needs '{text}' job, but '{text}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.")), why = why, fix = tr!("Исправьте имя или добавьте optional: true."));
                if !self.offline.is_empty() && !known {
                    item.severity = CiSeverity::Warning;
                }
                self.job_issue(name, &path, item);
            }
        } else if self.stage_index(&text) > self.stage_index(name) {
            let target_stage = self.stage_of(&text);
            self.job_issue(name, &path, draft!("needs-later-stage", Error, title = tr!("{0} ждёт {1} из более позднего этапа", q(name), q(&text)), how = rejected(format!("{name} job: need {text} is not defined in current or prior stages")), why = tr!("{0} в этапе {1}, который идёт после {2}.", q(&text), q(&target_stage), q(stage)), fix = tr!("Перенесите {0} в этап не раньше {1} или {2} — раньше.", q(name), q(&target_stage), q(&text))));
        }
        if let Value::Map(map) = need {
            for key in map.keys() {
                if !matches!(key.as_str(), "job" | "artifacts" | "optional" | "pipeline" | "project" | "ref" | "parallel") {
                    self.job_issue(name, &extend(&path, kp![key]), draft!("needs-unknown-key", Error, title = tr!("{0}: needs — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:needs:need config contains unknown keys: {key}")), why = tr!("Допустимы: job, artifacts, optional, pipeline, project, ref, parallel.{0}", did_you_mean(key, ["job", "artifacts", "optional"])), fix = tr!("Уберите ключ.")));
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
                        self.job_issue(name, &kp!["parallel"], draft!("parallel-range", Error, title = format!("{}: parallel: {}", q(name), parallel.js_string()), how = rejected(format!("jobs:{name}:parallel config must be {limit}")), why = tr!("parallel — целое число от 1 до 200."), fix = "parallel: 5"));
                    }
                }
                Value::Map(_) if parallel.get("matrix").is_some() => {
                    let mut total = 0f64;
                    for (index, entry) in arr(parallel.get("matrix")).into_iter().enumerate() {
                        let Value::Map(map) = entry else {
                            self.job_issue(name, &kp!["parallel", "matrix", index], draft!("matrix-format", Error, title = tr!("{0}: запись parallel:matrix не карта", q(name)), how = rejected(format!("jobs:{name}:parallel:matrix config should be an array of hashes")), why = tr!("Каждая запись матрицы — набор «ПЕРЕМЕННАЯ: [значения]»."), fix = "parallel:\n  matrix:\n    - NODE: [\"18\", \"20\"]"));
                            continue;
                        };
                        total += map.iter().fold(1f64, |product, (_, value)| product * (arr(Some(value)).len().max(1) as f64));
                        for (key, value) in map.iter() {
                            if arr(Some(value)).iter().any(|item| matches!(item, Value::Map(_) | Value::Seq(_))) {
                                self.job_issue(name, &kp!["parallel", "matrix", index, key], draft!("matrix-value", Error, title = tr!("{0}: в матрице {1} — вложенная структура", q(name), key), how = rejected(format!("jobs:{name}:parallel:matrix config should be an array of hashes with arrays of strings")), why = tr!("Значения матрицы — строки или числа."), fix = tr!("Перечислите значения списком строк.")));
                            }
                        }
                    }
                    if total > 200.0 {
                        self.job_issue(name, &kp!["parallel", "matrix"], draft!("matrix-limit", Error, title = tr!("{0}: матрица даёт {1} заданий", q(name), js::number_to_string(total)), how = rejected(format!("jobs:{name}:parallel:matrix config generates too many jobs (maximum is 200)")), why = tr!("Не более 200 комбинаций на задание."), fix = tr!("Сократите число значений.")));
                    }
                }
                _ => self.job_issue(name, &kp!["parallel"], draft!("parallel-format", Error, title = tr!("{0}: непонятный parallel", q(name)), how = rejected(format!("jobs:{name}:parallel config should be an integer or a hash")), why = tr!("parallel — число или { matrix: [...] }."), fix = "parallel: 3")),
            }
        }
        if let Some(retry) = cfg.get("retry") {
            let max = if matches!(retry, Value::Map(_)) { retry.get("max") } else { Some(retry) };
            if let Some(max) = max {
                let out_of_range = !is_integer(max) || matches!(max, Value::Number(number) if *number < 0.0 || *number > 2.0);
                if out_of_range {
                    self.job_issue(name, &kp!["retry"], draft!("retry-range", Error, title = format!("{}: retry {}", q(name), max.js_string()), how = rejected(format!("jobs:{name}:retry config must be between 0 and 2")), why = tr!("GitLab повторяет задание не более 2 раз."), fix = "retry: 2"));
                }
            }
            if let Value::Map(map) = retry {
                for reason in arr(retry.get("when")) {
                    if !reason.as_str().is_some_and(|text| RETRY_WHEN.contains(&text)) {
                        let text = reason.js_string();
                        self.job_issue(name, &kp!["retry", "when"], draft!("retry-when", Error, title = format!("{}: retry:when {}", q(name), q(&text)), how = rejected(format!("jobs:{name}:retry when unknown value: {text}")), why = tr!("Неизвестная причина повтора.{0}", did_you_mean(&text, RETRY_WHEN)), fix = tr!("Допустимы: {0}…", RETRY_WHEN[..6].join(", "))));
                    }
                }
                for key in map.keys() {
                    if !matches!(key.as_str(), "max" | "when" | "exit_codes") {
                        self.job_issue(name, &kp!["retry", key], draft!("retry-key", Error, title = tr!("{0}: retry — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:retry config contains unknown keys: {key}")), why = tr!("Допустимы max, when, exit_codes."), fix = tr!("Уберите ключ.")));
                    }
                }
            }
        }
        if let Some(timeout) = cfg.get("timeout") {
            match duration_seconds(Some(timeout)) {
                None => self.job_issue(name, &kp!["timeout"], draft!("timeout-format", Error, title = tr!("{0}: не разобрать timeout: {1}", q(name), arg(timeout)), how = rejected(format!("jobs:{name}:timeout config should be a duration")), why = tr!("Длительность пишется как «1h 30m», «90 minutes»."), fix = "timeout: 1h 30m")),
                Some(seconds) if seconds > 30.0 * 86400.0 => self.job_issue(name, &kp!["timeout"], draft!("timeout-limit", Error, title = tr!("{0}: timeout больше месяца", q(name)), how = rejected(format!("jobs:{name}:timeout config should not exceed the limit")), why = tr!("Максимум — 1 месяц."), fix = tr!("Уменьшите timeout."))),
                Some(_) => {}
            }
        }
        if let Some(allow) = cfg.get("allow_failure")
            && !matches!(allow, Value::Bool(_))
        {
            let ok = matches!(allow, Value::Map(map) if map.keys().all(|key| key == "exit_codes")) && arr(allow.get("exit_codes")).into_iter().all(is_integer);
            if !ok {
                self.job_issue(name, &kp!["allow_failure"], draft!("allow-failure-format", Error, title = format!("{}: allow_failure: {}", q(name), allow.json_string()), how = rejected(format!("jobs:{name}:allow_failure config should be a hash or a boolean value")), why = tr!("allow_failure — true/false или { exit_codes: [коды] }."), fix = "allow_failure: true"));
            }
        }
        if let Some(coverage) = cfg.get("coverage") {
            match re!(r"^\/(.+)\/([a-z]*)$").exec(&coverage.js_string()) {
                None => self.job_issue(name, &kp!["coverage"], draft!("coverage-format", Error, title = tr!("{0}: coverage не регулярное выражение", q(name)), how = rejected(format!("jobs:{name}:coverage config must be a regular expression")), why = tr!("coverage пишется между слэшами."), fix = "coverage: '/Lines:\\s+(\\d+\\.?\\d*)%/'")),
                Some(groups) => {
                    if let Err(error) = crate::js_regex::JsRegex::new(groups[1].as_deref().unwrap_or_default(), "") {
                        self.job_issue(name, &kp!["coverage"], draft!("coverage-regex", Error, title = tr!("{0}: ошибка в регулярке coverage", q(name)), how = rejected(format!("jobs:{name}:coverage config must be a regular expression")), why = error, fix = tr!("Исправьте выражение.")));
                    }
                }
            }
        }
        if let Some(interruptible) = cfg.get("interruptible")
            && !matches!(interruptible, Value::Bool(_))
        {
            self.job_issue(name, &kp!["interruptible"], draft!("interruptible-type", Error, title = tr!("{0}: interruptible должен быть true/false", q(name)), how = rejected(format!("jobs:{name} interruptible should be a boolean value")), why = tr!("Сейчас: {0}.", interruptible.json_string()), fix = "interruptible: true"));
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
                _ => self.job_issue(name, &kp!["tags"], draft!("tags-type", Error, title = tr!("{0}: tags должен быть списком строк", q(name)), how = rejected(format!("jobs:{name}:tags config should be an array of strings")), why = tr!("Теги перечисляются списком."), fix = "tags:\n  - docker")),
            }
        }
        if let Some(inherit) = cfg.get("inherit") {
            match inherit {
                Value::Map(map) => {
                    for key in map.keys() {
                        if !matches!(key.as_str(), "default" | "variables") {
                            self.job_issue(name, &kp!["inherit", key], draft!("inherit-key", Error, title = tr!("{0}: inherit — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:inherit config contains unknown keys: {key}")), why = tr!("Допустимы default и variables."), fix = tr!("Уберите ключ.")));
                        }
                    }
                }
                _ => self.job_issue(name, &kp!["inherit"], draft!("inherit-type", Error, title = tr!("{0}: inherit должен быть картой", q(name)), how = rejected(format!("jobs:{name}:inherit config should be a hash")), why = "inherit: { default: …, variables: … }.", fix = "inherit:\n  default: false")),
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
                self.job_issue(name, &kp!["trigger"], draft!("trigger-both", Error, title = tr!("{0}: trigger с project и include одновременно", q(name)), how = rejected(format!("jobs:{name}:trigger config contains unknown keys")), why = tr!("Либо дочерний пайплайн (include), либо пайплайн другого проекта (project)."), fix = tr!("Оставьте одно.")));
            }
            if let Some(strategy) = trigger.get("strategy")
                && !matches!(strategy.as_str(), Some("depend" | "mirror"))
            {
                self.job_issue(name, &kp!["trigger", "strategy"], draft!("trigger-strategy", Error, title = format!("{}: trigger:strategy {}", q(name), strategy.js_string()), how = rejected(format!("jobs:{name}:trigger:strategy should be one of: depend, mirror")), why = tr!("Допустимы depend и mirror."), fix = "strategy: depend"));
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
                    self.job_issue(name, &kp!["trigger", "include"], draft!("trigger-include-missing", Error, title = tr!("{0}: дочерний пайплайн {1} не найден", q(name), text), when = tr!("Когда дойдёт очередь до задания {0}", q(name)), how = tr!("Дочерний пайплайн не создастся, задание {0} упадёт: «Included file `{1}` is empty or does not exist!».", q(name), text), why = tr!("Файла нет в репозитории."), fix = tr!("Проверьте путь от корня репозитория.")));
                }
            }
        }
        if name == "pages" || cfg.get("pages").is_some() {
            let publish = non_null(cfg.get("pages").and_then(|pages| pages.get("publish"))).or_else(|| non_null(cfg.get("publish"))).map_or_else(|| "public".to_owned(), Value::js_string);
            let paths: Vec<String> = arr(cfg.get("artifacts").and_then(|artifacts| artifacts.get("paths"))).into_iter().map(Value::js_string).collect();
            let wanted = publish.trim_end_matches('/');
            if !paths.iter().any(|path| path.trim_end_matches('/') == wanted) {
                let at: Vec<PathItem> = if paths.is_empty() { Vec::new() } else { kp!["artifacts", "paths"] };
                self.job_issue(name, &at, draft!("pages-no-public", Warning, title = tr!("{0}: в артефактах нет папки {1}", q(name), publish), when = tr!("После задания {0}", q(name)), how = tr!("Сайт не опубликуется: задание pages:deploy упадёт — «pages:deploy … The {0} folder is missing from the artifacts».", publish), why = tr!("GitLab Pages публикует содержимое папки {0} из артефактов задания.", q(&publish)), fix = format!("artifacts:\n  paths:\n    - {publish}")));
            }
        }
        if let Some(release) = cfg.get("release") {
            let is_map = matches!(release, Value::Map(_));
            if !is_map || !release.get("tag_name").is_some_and(Value::truthy) {
                self.job_issue(name, &kp!["release"], draft!("release-no-tag", Error, title = tr!("{0}: release без tag_name", q(name)), how = rejected(format!("jobs:{name}:release tag name can't be blank")), why = tr!("Релиз привязан к тегу."), fix = "release:\n  tag_name: $CI_COMMIT_TAG\n  description: \"…\""));
            }
            if is_map && !release.get("description").is_some_and(Value::truthy) {
                self.job_issue(name, &kp!["release"], draft!("release-no-description", Error, title = tr!("{0}: release без description", q(name)), how = rejected(format!("jobs:{name}:release description can't be blank")), why = tr!("Описание релиза обязательно."), fix = tr!("description: \"Релиз $CI_COMMIT_TAG\"")));
            }
            let image = match cfg.get("image") {
                Some(Value::String(text)) => text.clone(),
                Some(other) => non_null(other.get("name")).map_or_else(String::new, Value::js_string),
                None => String::new(),
            };
            if !re!(r"release-cli|glab|cli").test(&image) {
                self.job_issue(name, &kp!["release"], draft!("release-image", Warning, title = tr!("{0}: release в образе без release-cli", q(name)), when = tr!("При выполнении задания {0}", q(name)), how = tr!("Задание упадёт: «release-cli: command not found» (или «glab: not found»)."), why = tr!("Ключ release выполняется утилитой release-cli / glab, которой нет в обычных образах."), fix = "image: registry.gitlab.com/gitlab-org/release-cli:latest"));
            }
        }
        Ok(())
    }

    /// То, что после цикла по заданиям.
    pub(super) fn after_jobs(&mut self) {
        for stage in self.raw.declared_stages.clone() {
            if !self.used_stages.contains(&stage) && stage != ".pre" && stage != ".post" {
                self.glob_issue(&kp!["stages"], draft!("stage-unused", Info, title = tr!("Этап {0} объявлен, но в нём нет заданий", q(&stage)), how = tr!("Ничего не сломается — пустой этап просто не показывается."), why = format!("{}{stage}.", tr!("Ни одно задание не указывает stage: ")), fix = tr!("Уберите этап или проверьте stage у заданий (опечатка?).")));
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
            self.cx.add(draft!("only-deprecated", Info, title = tr!("only/except устарели ({0} задан.)", count), when = config_when(), how = tr!("Сейчас работает, но новые возможности (needs, variables, changes:compare_to в правилах) доступны только через rules."), why = tr!("only/except больше не развиваются. Используются в: {0}{1}.", list.join(", "), if count > 6 { "…" } else { "" }), fix = tr!("Например, only: [main] →\nrules:\n  - if: $CI_COMMIT_BRANCH == \"main\""), file = file, line = line, job = first_name));
        }
        for (tags, (jobs, file, line)) in self.tag_sets.clone() {
            let list: Vec<String> = jobs.iter().take(4).map(q).collect();
            self.cx.add(draft!("tags-runner", Info, title = tr!("Нужен раннер с тегами: {0}", tags), when = tr!("При запуске заданий {0}{1}", list.join(", "), if jobs.len() > 4 { "…" } else { "" }), how = tr!("Если такого раннера нет, задание повиснет в pending: «This job is stuck because you don’t have any active runners online … with any of these tags assigned to them»."), why = tr!("Задание берёт только раннер, у которого есть все перечисленные теги."), fix = tr!("Проверьте Settings → CI/CD → Runners."), file = file, line = line, job = jobs[0].clone()));
        }
        if let Some((file, line, job)) = self.dind_at.clone() {
            self.cx.add(draft!("dind-privileged", Info, title = tr!("docker:dind требует privileged-раннер"), when = tr!("При выполнении задания {0}", q(&job)), how = tr!("На раннере без privileged = true сервис не стартует: «mount: permission denied» / «Cannot connect to the Docker daemon»."), why = tr!("Docker-in-Docker запускает свой демон внутри контейнера, а это нужно разрешить в настройках раннера."), fix = tr!("Проверьте, что у раннера privileged = true (config.toml), или используйте kaniko/buildah."), file = file, line = line, job = job));
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
                self.job_issue(&cycle[0], &kp!["needs"], draft!("needs-cycle", Error, title = tr!("Задания ждут друг друга по кругу: {0}", cycle.join(" → ")), how = rejected("circular dependency detected in `needs`"), why = tr!("Ни одно из заданий не может стартовать первым."), fix = tr!("Уберите одну из зависимостей.")));
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
