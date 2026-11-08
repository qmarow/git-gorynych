//! Переменные, образы, артефакты, кэш и окружения из `checkGitlab`.

use super::catalog::*;
use super::{Gl, config_when, extend, rejected};
use crate::check::base::*;
use crate::load_common_as_array as arr;
use crate::load_common_non_null as non_null;
use crate::yaml::{JsMap, PathItem, Value, js_join};

/// Чьи переменные проверяются.
#[derive(Clone, Copy)]
pub(super) enum VarOwner<'a> {
    Global,
    Job(&'a str),
}

impl Gl<'_, '_> {
    /// `checkVariables`.
    pub(super) fn check_variables(&mut self, vars: Option<&Value>, owner: VarOwner<'_>) {
        let (job, place): (Option<&str>, String) = match owner {
            VarOwner::Global => (None, "variables".to_owned()),
            VarOwner::Job(name) => (Some(name), format!("jobs:{name}:variables")),
        };
        let at = |gl: &Self, path: Vec<PathItem>| match owner {
            VarOwner::Global => gl.global_loc(&extend(&kp!["variables"], path)),
            VarOwner::Job(name) => gl.locate(name, &extend(&kp!["variables"], path)),
        };
        let job_text = job.map(str::to_owned);
        let Some(vars) = non_null(vars) else { return };
        let Value::Map(map) = vars else {
            if let Some(name) = job {
                let (file, line) = at(self, Vec::new());
                self.cx.add(draft!("variables-not-hash", Error, title = tr!("{0}: variables должен быть набором «ИМЯ: значение»", q(name)), when = config_when(), how = rejected(format!("{place} config should be a hash of key value pairs")), why = if matches!(vars, Value::Seq(_)) { tr!("Сейчас это список (через «- »).") } else { tr!("Сейчас это не карта.") }, fix = "variables:\n  NAME: value", file = file, line = line, job = job_text));
            }
            return;
        };
        for (key, value) in map.iter() {
            let (file, line) = at(self, kp![key]);
            macro_rules! add_at {
                ($id:expr, $severity:ident $(, $field:ident = $item:expr)* $(,)?) => {
                    self.cx.add(draft!($id, $severity, file = file.clone(), line = line, job = job_text.clone() $(, $field = $item)*))
                };
            }
            if !re!(r"^[A-Za-z_][A-Za-z0-9_]*$").test(key) {
                let cleaned = re!(r"[^A-Za-z0-9_]").replace_all(key, "_");
                let fixed = if cleaned.starts_with(|c: char| c.is_ascii_digit()) { format!("_{cleaned}") } else { cleaned };
                add_at!("variable-name", Warning, title = tr!("Имя переменной {0} недоступно в shell", q(key)), when = job.map_or_else(|| tr!("При выполнении заданий"), |name| tr!("При выполнении задания {0}", q(name))), how = tr!("В скрипте ${0} не раскроется ({1} в имени не допускается shell).", key, if key.contains('-') { tr!("дефис") } else { tr!("символ") }), why = tr!("Имена переменных окружения — латинские буквы, цифры и «_», не с цифры."), fix = tr!("Переименуйте, например {0}.", fixed));
            }
            let rejected_type = rejected(format!("{place} config should be a hash of key value pairs, value can be a hash"));
            match value {
                Value::Bool(flag) => add_at!("variable-boolean", Error, title = tr!("{0}: {1} — логическое значение без кавычек", key, flag), when = config_when(), how = rejected_type, why = tr!("Значения переменных — строки; YAML прочитал true/false/yes/no как логическое значение."), fix = format!("{key}: \"{flag}\"")),
                Value::Seq(_) => add_at!("variable-array", Error, title = tr!("{0}: значение — список", key), when = config_when(), how = rejected_type, why = tr!("Переменная не может быть списком."), fix = format!("{key}: \"a b c\"")),
                Value::Map(inner) => {
                    for inner_key in inner.keys() {
                        if !matches!(inner_key.as_str(), "value" | "description" | "options" | "expand") {
                            add_at!("variable-key", Error, title = tr!("{0}: неизвестный ключ {1}", key, q(inner_key)), when = config_when(), how = rejected(format!("{place}:{key} config uses invalid data keys: {inner_key}")), why = tr!("Допустимы value, description, options, expand."), fix = tr!("Уберите ключ."));
                        }
                    }
                    if let (Some(options), Some(current)) = (value.get("options"), value.get("value"))
                        && !arr(Some(options)).iter().any(|option| option.js_string() == current.js_string())
                    {
                        add_at!("variable-options", Error, title = tr!("{0}: значение {1} не входит в options", key, q(current.js_string())), when = config_when(), how = rejected(format!("{place}:{key} config value must be present in options")), why = format!("options: {}.", js_join(arr(Some(options)).into_iter(), ", ")), fix = tr!("Добавьте значение в options или исправьте value."));
                    }
                    if value.get("options").is_some() && job.is_some() {
                        add_at!("variable-options-job", Warning, title = tr!("{0}: options в переменной задания", key), when = config_when(), how = tr!("options работают только у глобальных переменных (форма ручного запуска)."), why = tr!("Здесь они ничего не дадут."), fix = tr!("Перенесите переменную в глобальный variables."));
                    }
                }
                _ => {}
            }
            let current = if matches!(value, Value::Map(_)) { value.get("value") } else { Some(value) };
            if let Some(current @ (Value::String(_) | Value::Number(_))) = current {
                let text = current.js_string();
                if let Some((_, what)) = SECRET_VALUE.iter().find(|(regex, _)| regex.is_match(&text)) {
                    add_at!("secret-value", Error, title = tr!("{0}: в файле открытым текстом {1}", key, tr!(what)), when = tr!("Уже сейчас — файл в истории Git"), how = tr!("Любой, у кого есть доступ к репозиторию (или к его копии), получит этот ключ; в логах заданий значение тоже не скрывается."), why = tr!("Переменные из .gitlab-ci.yml не маскируются и не защищены."), fix = tr!("Отзовите ключ, создайте новый и сохраните его в Settings → CI/CD → Variables (Masked, Protected); в файле оставьте только имя."));
                } else if is_secret_name(key)
                    && gorynych_core::js::utf16_len(&text) >= 6
                    && !looks_like_var_ref(&Value::String(text.clone()))
                    && !re!(r"^(true|false|none|null|changeme|example|placeholder|\*+|x+)$", "i").test(&text)
                    && !text.contains('$')
                {
                    add_at!("secret-name", Warning, title = tr!("{0}: похоже на секрет в открытом виде", key), when = tr!("Уже сейчас — файл в истории Git"), how = tr!("Значение видно всем, у кого есть доступ к репозиторию, и не маскируется в логах."), why = tr!("Имя {0} похоже на пароль/токен, а значение задано прямо в файле.", q(key)), fix = tr!("Перенесите значение в Settings → CI/CD → Variables (Masked) и удалите из файла."));
                }
            }
        }
    }

    fn image_issue(&mut self, job: Option<&str>, path: &[PathItem], draft: Draft) {
        match job {
            Some(name) => self.job_issue(name, path, draft),
            None => self.glob_issue(path, draft),
        }
    }

    /// `checkImageName`.
    pub(super) fn check_image_name(&mut self, image: &Value, job: Option<&str>, path: &[PathItem], what: &str) {
        let full = image.js_string();
        let text = gorynych_core::js::trim(&full).to_owned();
        let who = job.map_or_else(|| "default".to_owned(), q);
        let run_when = job.map_or_else(|| tr!("При запуске каждого задания с этим образом"), |name| tr!("При запуске задания {0}", q(name)));
        if text.is_empty() {
            let prefix = job.map_or_else(|| "default".to_owned(), |name| format!("jobs:{name}"));
            self.image_issue(job, path, draft!("image-empty", Error, title = tr!("{0}: пустой {1}", who, what), how = rejected(format!("{prefix}:image config should be a hash or a string")), why = tr!("Имя образа не задано."), fix = "image: node:20"));
            return;
        }
        if text.contains(gorynych_core::js::is_whitespace) {
            self.image_issue(job, path, draft!("image-space", Error, title = tr!("{0}: пробел в имени образа {1}", who, q(&text)), when = run_when, how = tr!("Задание упадёт: «invalid reference format»."), why = tr!("В имени образа не может быть пробелов."), fix = tr!("Проверьте имя.")));
            return;
        }
        let no_digest = re!(r"@sha256:.*$").replace_all(&text, "");
        let repo_part = re!(r":[^/:]+$").replace_all(&no_digest, "");
        if text.contains('$') {
            let variable = re!(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)").match_all(&text).into_iter().filter_map(|groups| groups[1].clone()).find(|name| !PREDEFINED.contains(name.as_str()) && !self.yaml_vars.contains(name));
            if let Some(variable) = variable {
                self.image_issue(job, path, draft!("image-variable", Info, title = tr!("{0}: {1} {2} зависит от ${3}", who, what, text, variable), when = run_when, how = tr!("Если ${0} не задана в настройках проекта, задание упадёт: «invalid reference format» или «pull access denied».", variable), why = tr!("Переменная не объявлена в файле."), fix = tr!("Объявите значение по умолчанию в variables: {0}: …", variable)));
            }
            return;
        }
        if repo_part.bytes().any(|byte| byte.is_ascii_uppercase()) {
            self.image_issue(job, path, draft!("image-uppercase", Error, title = tr!("{0}: заглавные буквы в имени образа {1}", who, q(&text)), when = run_when, how = tr!("Задание упадёт: «invalid reference format: repository name must be lowercase»."), why = tr!("Имена образов Docker — только строчные."), fix = format!("image: {}{}", repo_part.to_lowercase(), &text[repo_part.len()..])));
        } else if !re!(r"^[^/]+:\d+\/").replace_all(&text, "").contains([':', '@']) || text.ends_with(":latest") {
            self.image_issue(job, path, draft!("image-latest", Info, title = tr!("{0}: {1} {2} без версии", who, what, text), when = run_when, how = tr!("Сегодня работает, а после выхода новой версии образа задание может внезапно сломаться."), why = tr!("Без тега берётся :latest — он меняется со временем."), fix = tr!("Укажите версию: {0}:<версия>", repo_part)));
        }
    }

    /// `checkImage`.
    pub(super) fn check_image(&mut self, image: &Value, job: Option<&str>, path: &[PathItem]) {
        let who = job.map_or_else(|| "default".to_owned(), q);
        let prefix = job.map_or_else(|| "default".to_owned(), |name| format!("jobs:{name}"));
        let what = tr!("образ");
        match image {
            Value::Null => self.check_image_name(&Value::String(String::new()), job, path, &what),
            Value::String(text) if text.is_empty() => self.check_image_name(image, job, path, &what),
            Value::String(_) => self.check_image_name(image, job, path, &what),
            Value::Map(map) => {
                for key in map.keys() {
                    if !matches!(key.as_str(), "name" | "entrypoint" | "docker" | "pull_policy" | "kubernetes") {
                        self.image_issue(job, &extend(path, kp![key]), draft!("image-key", Error, title = tr!("{0}: image — неизвестный ключ {1}", who, q(key)), how = rejected(format!("{prefix}:image config contains unknown keys: {key}")), why = tr!("Допустимы name, entrypoint, docker, pull_policy, kubernetes."), fix = tr!("Уберите ключ.")));
                    }
                }
                match image.get("name").filter(|value| value.truthy()) {
                    None => self.image_issue(job, path, draft!("image-no-name", Error, title = tr!("{0}: у image нет name", who), how = rejected(format!("{prefix}:image config must have a name")), why = tr!("Нужно указать образ."), fix = "image:\n  name: node:20")),
                    Some(name) => self.check_image_name(name, job, &extend(path, kp!["name"]), &what),
                }
            }
            other => self.image_issue(job, path, draft!("image-type", Error, title = tr!("{0}: image должен быть строкой", who), how = rejected(format!("{prefix}:image config should be a hash or a string")), why = tr!("Сейчас: {0}.", other.json_string()), fix = "image: node:20")),
        }
    }

    /// `checkArtifacts`.
    pub(super) fn check_artifacts(&mut self, name: &str, artifacts: &Value) {
        macro_rules! ji {
            ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
                self.job_issue(name, &extend(&kp!["artifacts"], $path), draft!($id, $severity $(, $field = $value)*))
            };
        }
        let Value::Map(map) = artifacts else {
            ji!(Vec::new(), "artifacts-type", Error, title = tr!("{0}: artifacts должен быть картой", q(name)), how = rejected(format!("jobs:{name}:artifacts config should be a hash")), why = tr!("artifacts содержит paths, expire_in и т.д."), fix = "artifacts:\n  paths:\n    - dist/");
            return;
        };
        for key in map.keys() {
            if !ARTIFACT_KEYS.contains(&key.as_str()) {
                ji!(kp![key], "artifacts-unknown-key", Error, title = tr!("{0}: artifacts — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts config contains unknown keys: {key}")), why = tr!("Допустимы: {0}.{1}", ARTIFACT_KEYS.join(", "), did_you_mean(key, ARTIFACT_KEYS)), fix = tr!("Исправьте ключ."));
            }
        }
        let paths = artifacts.get("paths");
        if let Some(value) = paths
            && !matches!(value, Value::Seq(_))
        {
            ji!(kp!["paths"], "artifacts-paths-type", Error, title = tr!("{0}: artifacts:paths должен быть списком", q(name)), how = rejected(format!("jobs:{name}:artifacts:paths config should be an array of strings")), why = tr!("Даже один путь пишется списком."), fix = format!("paths:\n  - {}", value.js_string()));
        }
        for (index, path) in arr(paths).into_iter().enumerate() {
            let text = path.js_string();
            if text.starts_with('/') || text.starts_with("../") || text == ".." || text.starts_with('~') {
                ji!(kp!["paths", index], "artifacts-outside", Warning, title = tr!("{0}: путь артефакта {1} вне папки проекта", q(name), q(&text)), when = tr!("В конце задания {0}", q(name)), how = tr!("Файлы не сохранятся: «WARNING: {0}: not supported: outside build directory» и «ERROR: No files to upload».", text), why = tr!("Артефакты можно брать только внутри $CI_PROJECT_DIR."), fix = tr!("Копируйте файлы в папку проекта и указывайте относительный путь."));
            }
        }
        if paths.is_none() && !artifacts.get("untracked").is_some_and(Value::truthy) && !matches!(artifacts.get("reports"), Some(Value::Map(_))) {
            ji!(Vec::new(), "artifacts-empty", Warning, title = tr!("{0}: в artifacts не указано, что сохранять", q(name)), when = tr!("В конце задания {0}", q(name)), how = tr!("Раннер ничего не загрузит: «WARNING: No files to upload»."), why = tr!("Нет ни paths, ни reports, ни untracked."), fix = "artifacts:\n  paths:\n    - dist/");
        }
        if let Some(expire) = artifacts.get("expire_in")
            && expire.js_string() != "never"
            && duration_seconds(Some(expire)).is_none()
        {
            ji!(kp!["expire_in"], "artifacts-expire", Error, title = tr!("{0}: не разобрать expire_in: {1}", q(name), arg(expire)), how = rejected(format!("jobs:{name}:artifacts expire in should be a duration")), why = tr!("Пишется как «1 week», «30 days» или «never»."), fix = "expire_in: 1 week");
        }
        if let Some(when) = artifacts.get("when")
            && !when.as_str().is_some_and(|text| SIMPLE_WHEN.contains(&text))
        {
            let text = when.js_string();
            ji!(kp!["when"], "artifacts-when", Error, title = format!("{}: artifacts:when {text}", q(name)), how = rejected(format!("jobs:{name}:artifacts when should be on_success, on_failure or always")), why = tr!("Неизвестное значение.{0}", did_you_mean(&text, SIMPLE_WHEN)), fix = "when: always");
        }
        if let Some(Value::Map(reports)) = artifacts.get("reports") {
            for (key, value) in reports.iter() {
                if let Some(replacement) = removed_report(key) {
                    ji!(kp!["reports", key], "report-removed", Error, title = tr!("{0}: отчёт {1} больше не поддерживается", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts:reports config contains unknown keys: {key}")), why = tr!("Тип отчёта удалён из GitLab."), fix = tr!("Используйте {0}.", replacement));
                } else if !REPORTS.contains(&key.as_str()) {
                    ji!(kp!["reports", key], "report-unknown", Error, title = tr!("{0}: неизвестный тип отчёта {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts:reports config contains unknown keys: {key}")), why = tr!("Неизвестный тип.{0}", did_you_mean(key, REPORTS)), fix = tr!("Проверьте название отчёта."));
                }
                if key == "coverage_report" {
                    let format = value.get("coverage_format").filter(|item| item.truthy());
                    if format.is_none() || !value.get("path").is_some_and(Value::truthy) {
                        ji!(kp!["reports", key], "coverage-report-format", Error, title = tr!("{0}: coverage_report без coverage_format/path", q(name)), how = rejected(format!("jobs:{name}:artifacts:reports:coverage_report config must have coverage_format and path")), why = tr!("Нужны оба ключа."), fix = "coverage_report:\n  coverage_format: cobertura\n  path: coverage/cobertura-coverage.xml");
                    }
                    if let Some(format) = format
                        && !matches!(format.as_str(), Some("cobertura" | "jacoco"))
                    {
                        ji!(kp!["reports", key, "coverage_format"], "coverage-format-value", Error, title = format!("{}: coverage_format {}", q(name), format.js_string()), how = rejected("coverage_format must be cobertura or jacoco"), why = tr!("Поддерживаются cobertura и jacoco."), fix = "coverage_format: cobertura");
                    }
                }
            }
        }
    }

    /// `checkCache`.
    pub(super) fn check_cache(&mut self, name: &str, cache: &Value, base: &[PathItem]) {
        let list = arr(Some(cache));
        if list.len() > 4 {
            self.job_issue(name, base, draft!("cache-limit", Error, title = tr!("{0}: больше 4 кэшей", q(name)), how = rejected(format!("jobs:{name}:cache config no more than 4 caches can be created")), why = tr!("Ограничение GitLab."), fix = tr!("Объедините кэши.")));
        }
        for (index, entry) in list.into_iter().enumerate() {
            let entry_path = if matches!(cache, Value::Seq(_)) { extend(base, kp![index]) } else { base.to_vec() };
            macro_rules! ji {
                ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
                    self.job_issue(name, &extend(&entry_path, $path), draft!($id, $severity $(, $field = $value)*))
                };
            }
            let Value::Map(map) = entry else {
                ji!(Vec::new(), "cache-type", Error, title = tr!("{0}: cache должен быть картой", q(name)), how = rejected(format!("jobs:{name}:cache config should be a hash")), why = tr!("cache содержит key, paths, policy."), fix = "cache:\n  key: $CI_COMMIT_REF_SLUG\n  paths:\n    - node_modules/");
                continue;
            };
            for key in map.keys() {
                if !CACHE_KEYS.contains(&key.as_str()) {
                    ji!(kp![key], "cache-unknown-key", Error, title = tr!("{0}: cache — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:cache config contains unknown keys: {key}")), why = tr!("Допустимы: {0}.{1}", CACHE_KEYS.join(", "), did_you_mean(key, CACHE_KEYS)), fix = tr!("Исправьте ключ."));
                }
            }
            match entry.get("key") {
                Some(key @ (Value::String(_) | Value::Number(_))) => {
                    let text = key.js_string();
                    if re!(r"\/|%2F", "i").test(&text) || text == "." || text == ".." || re!(r"%2E", "i").test(&text) {
                        ji!(kp!["key"], "cache-key-slash", Error, title = tr!("{0}: в cache:key есть «/» или это «.»", q(name)), how = rejected(format!("jobs:{name}:cache:key config cannot contain the \"/\" character or be \".\"")), why = tr!("Ключ кэша становится частью имени файла."), fix = tr!("Используйте $CI_COMMIT_REF_SLUG вместо $CI_COMMIT_REF_NAME (в нём нет «/»)."));
                    }
                    if re!(r"\$CI_COMMIT_REF_NAME|\$CI_COMMIT_BRANCH").test(&text) {
                        ji!(kp!["key"], "cache-key-refname", Warning, title = tr!("{0}: cache:key с именем ветки", q(name)), when = tr!("В ветках со «/» в имени (feature/x)"), how = tr!("Кэш не сохранится: имя ветки со слэшем недопустимо в ключе."), why = tr!("$CI_COMMIT_REF_NAME может содержать «/»."), fix = tr!("Используйте $CI_COMMIT_REF_SLUG."));
                    }
                }
                Some(key @ Value::Map(key_map)) => {
                    let files = arr(key.get("files"));
                    if files.len() > 2 {
                        ji!(kp!["key", "files"], "cache-key-files", Error, title = tr!("{0}: cache:key:files больше двух", q(name)), how = rejected(format!("jobs:{name}:cache:key:files config has too many entries (maximum 2)")), why = tr!("Ключ можно строить максимум по двум файлам."), fix = tr!("Оставьте 1–2 файла (обычно lock-файл)."));
                    }
                    for file in files {
                        let text = file.js_string();
                        if !text.contains(['$', '*']) && !self.cx.repo.has_file(&text) {
                            ji!(kp!["key", "files"], "cache-key-file-missing", Warning, title = tr!("{0}: cache:key:files — нет файла {1}", q(name), arg(file)), when = tr!("При выполнении задания {0}", q(name)), how = tr!("Кэш будет общим с ключом «default» для всех веток и не будет сбрасываться при изменении зависимостей."), why = tr!("Файла {0} нет в репозитории.", q(&text)), fix = tr!("Укажите существующий lock-файл."));
                        }
                    }
                    for inner in key_map.keys() {
                        if !matches!(inner.as_str(), "files" | "prefix" | "files_commits") {
                            ji!(kp!["key", inner], "cache-key-key", Error, title = tr!("{0}: cache:key — неизвестный ключ {1}", q(name), q(inner)), how = rejected(format!("jobs:{name}:cache:key config contains unknown keys: {inner}")), why = tr!("Допустимы files и prefix."), fix = tr!("Уберите ключ."));
                        }
                    }
                }
                _ => {}
            }
            if let Some(policy) = entry.get("policy")
                && !matches!(policy.as_str(), Some("pull" | "push" | "pull-push"))
                && !policy.js_string().contains('$')
            {
                let text = policy.js_string();
                ji!(kp!["policy"], "cache-policy", Error, title = format!("{}: cache:policy {text}", q(name)), how = rejected(format!("jobs:{name}:cache policy should be pull-push, push, or pull")), why = tr!("Неизвестное значение.{0}", did_you_mean(&text, ["pull", "push", "pull-push"])), fix = "policy: pull");
            }
            if let Some(when) = entry.get("when")
                && !when.as_str().is_some_and(|text| SIMPLE_WHEN.contains(&text))
            {
                ji!(kp!["when"], "cache-when", Error, title = format!("{}: cache:when {}", q(name), when.js_string()), how = rejected(format!("jobs:{name}:cache when should be on_success, on_failure or always")), why = tr!("Неизвестное значение."), fix = "when: on_success");
            }
            let paths = entry.get("paths");
            if let Some(value) = paths
                && !matches!(value, Value::Seq(_))
            {
                ji!(kp!["paths"], "cache-paths-type", Error, title = tr!("{0}: cache:paths должен быть списком", q(name)), how = rejected(format!("jobs:{name}:cache:paths config should be an array of strings")), why = tr!("Даже один путь пишется списком."), fix = format!("paths:\n  - {}", value.js_string()));
            }
            if arr(paths).is_empty() && !entry.get("untracked").is_some_and(Value::truthy) {
                ji!(Vec::new(), "cache-empty", Warning, title = tr!("{0}: в cache не указано, что кэшировать", q(name)), when = tr!("В конце задания {0}", q(name)), how = tr!("Кэш не будет создан: раннер пропустит шаг сохранения кэша."), why = tr!("Нет ни paths, ни untracked."), fix = "paths:\n  - node_modules/");
            }
            for (at, path) in arr(paths).into_iter().enumerate() {
                let text = path.js_string();
                if text.starts_with('/') || text.starts_with("../") || text.starts_with('~') {
                    ji!(kp!["paths", at], "cache-outside", Warning, title = tr!("{0}: путь кэша {1} вне папки проекта", q(name), q(&text)), when = tr!("В конце задания {0}", q(name)), how = tr!("«WARNING: {0}: not supported: outside build directory» — путь не попадёт в кэш.", arg(path)), why = tr!("Кэшировать можно только внутри папки проекта."), fix = tr!("Перенесите кэш внутрь проекта (например, npm_config_cache: .npm)."));
                }
            }
        }
    }

    /// `checkEnvironment`.
    pub(super) fn check_environment(&mut self, name: &str, environment: &Value) {
        macro_rules! ji {
            ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
                self.job_issue(name, &extend(&kp!["environment"], $path), draft!($id, $severity $(, $field = $value)*))
            };
        }
        let as_map = |value: &Value| -> Value {
            if matches!(value, Value::String(_)) {
                let mut map = JsMap::new();
                map.insert("name".to_owned(), value.clone());
                Value::Map(map)
            } else {
                value.clone()
            }
        };
        let env = as_map(environment);
        let Value::Map(map) = &env else {
            ji!(Vec::new(), "env-type", Error, title = tr!("{0}: environment должен быть строкой или картой", q(name)), how = rejected(format!("jobs:{name}:environment config should be a hash or a string")), why = tr!("Задайте имя окружения."), fix = "environment: production");
            return;
        };
        for key in map.keys() {
            if !ENV_KEYS.contains(&key.as_str()) {
                ji!(kp![key], "env-unknown-key", Error, title = tr!("{0}: environment — неизвестный ключ {1}", q(name), q(key)), how = rejected(format!("jobs:{name}:environment config contains unknown keys: {key}")), why = tr!("Допустимы: {0}.{1}", ENV_KEYS.join(", "), did_you_mean(key, ENV_KEYS)), fix = tr!("Исправьте ключ."));
            }
        }
        match env.get("name").filter(|value| value.truthy()) {
            None => ji!(Vec::new(), "env-no-name", Error, title = tr!("{0}: у окружения нет name", q(name)), how = rejected(format!("jobs:{name}:environment name can't be blank")), why = tr!("Окружение определяется именем."), fix = "environment:\n  name: production"),
            Some(env_name) => {
                if !re!(r"^[A-Za-z0-9 _\-/${}.]+$").test(&env_name.js_string()) {
                    ji!(kp!["name"], "env-name", Error, title = tr!("{0}: недопустимое имя окружения {1}", q(name), q(env_name.js_string())), how = rejected(format!("jobs:{name}:environment name can contain only letters, digits, '-', '_', '/', '$', '{{', '}}', '.', and spaces")), why = tr!("В имени есть запрещённые символы."), fix = tr!("Например: review/$CI_COMMIT_REF_SLUG"));
                }
            }
        }
        if let Some(url) = env.get("url") {
            let text = url.js_string();
            if !re!(r"^https?:\/\/", "i").test(&text) && !text.starts_with('$') {
                ji!(kp!["url"], "env-url", Error, title = tr!("{0}: environment:url {1} — не адрес", q(name), arg(url)), how = rejected(format!("jobs:{name}:environment url must be a valid url")), why = tr!("URL должен начинаться с http:// или https://."), fix = format!("url: https://{text}"));
            }
        }
        if let Some(action) = env.get("action")
            && !action.as_str().is_some_and(|text| ENV_ACTIONS.contains(&text))
        {
            let text = action.js_string();
            ji!(kp!["action"], "env-action", Error, title = format!("{}: environment:action {text}", q(name)), how = rejected(format!("jobs:{name}:environment action should be start, stop, prepare, verify, or access")), why = tr!("Неизвестное значение.{0}", did_you_mean(&text, ENV_ACTIONS)), fix = "action: stop");
        }
        if let Some(tier) = env.get("deployment_tier")
            && !tier.as_str().is_some_and(|text| TIERS.contains(&text))
        {
            let text = tier.js_string();
            ji!(kp!["deployment_tier"], "env-tier", Error, title = format!("{}: deployment_tier {text}", q(name)), how = rejected(format!("jobs:{name}:environment deployment_tier must be one of: {}", TIERS.join(", "))), why = tr!("Неизвестное значение.{0}", did_you_mean(&text, TIERS)), fix = "deployment_tier: production");
        }
        if let Some(stop_in) = env.get("auto_stop_in")
            && stop_in.js_string() != "never"
            && duration_seconds(Some(stop_in)).is_none()
        {
            ji!(kp!["auto_stop_in"], "env-auto-stop", Error, title = tr!("{0}: не разобрать auto_stop_in: {1}", q(name), arg(stop_in)), how = rejected(format!("jobs:{name}:environment auto stop in should be a duration")), why = tr!("Пишется как «1 week», «2 days»."), fix = "auto_stop_in: 1 week");
        }
        let Some(on_stop) = env.get("on_stop") else { return };
        let stop_job = on_stop.js_string();
        let stop_config = self.resolved(&stop_job).cloned();
        let Some(stop_config) = stop_config.filter(|_| !stop_job.starts_with('.')) else {
            ji!(kp!["on_stop"], "env-on-stop-missing", Error, title = tr!("{0}: on_stop ссылается на несуществующее {1}", q(name), q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} is not defined")), why = tr!("Задания {0} нет.{1}", q(&stop_job), did_you_mean(&stop_job, self.visible.iter().map(String::as_str))), fix = tr!("Добавьте задание остановки окружения или поправьте имя."));
            return;
        };
        let stop_env = stop_config.get("environment").map(as_map);
        let is_stop = stop_env.as_ref().is_some_and(|value| matches!(value, Value::Map(_)) && value.get("action").and_then(Value::as_str) == Some("stop"));
        let env_name_text = js_str(env.get("name"));
        if !is_stop {
            self.job_issue(&stop_job, &kp!["environment"], draft!("env-stop-action", Error, title = tr!("{0}: нет environment:action: stop", q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} is not defined as a stop job (environment:action: stop is missing)")), why = tr!("{0} указан в on_stop у {1}, значит должен останавливать окружение.", q(&stop_job), q(name)), fix = format!("{stop_job}:\n  environment:\n    name: {env_name_text}\n    action: stop")));
        } else if stop_env.as_ref().and_then(|value| value.get("name")) != env.get("name") {
            let stop_name = stop_env.as_ref().and_then(|value| value.get("name"));
            self.job_issue(&stop_job, &kp!["environment", "name"], draft!("env-stop-name", Error, title = tr!("{0}: другое имя окружения", q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} has different environment name")), why = tr!("Окружение {0} — {1}, а у {2} — {3}.", q(name), q_opt(env.get("name")), q(&stop_job), q_opt(stop_name)), fix = tr!("Используйте одно имя: {0}.", arg_opt(env.get("name")))));
        }
        let manual = stop_config.get("when").and_then(Value::as_str) == Some("manual") || arr(stop_config.get("rules")).iter().any(|rule| rule.get("when").and_then(Value::as_str) == Some("manual"));
        if !manual {
            self.job_issue(&stop_job, &[], draft!("env-stop-auto", Warning, title = tr!("{0} запустится автоматически", q(&stop_job)), when = tr!("В каждом пайплайне с этим заданием"), how = tr!("Окружение будет остановлено сразу после развёртывания."), why = tr!("Задание остановки без when: manual выполняется как обычное."), fix = "when: manual"));
        }
    }
}
