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
                self.cx.add(draft!("variables-not-hash", Error, title = tr!("variables-must-be-set-of-name", q(name)), when = config_when(), how = rejected(format!("{place} config should be a hash of key value pairs")), why = if matches!(vars, Value::Seq(_)) { tr!("its-currently-list-with") } else { tr!("its-currently-not-map") }, fix = "variables:\n  NAME: value", file = file, line = line, job = job_text));
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
                add_at!("variable-name", Warning, title = tr!("variable-name-isnt-usable-in", q(key)), when = job.map_or_else(|| tr!("when-jobs-run-2"), |name| tr!("when-job-runs-2", q(name))), how = tr!("wont-expand-in-script-shell", key, if key.contains('-') { tr!("hyphen") } else { tr!("character") }), why = tr!("environment-variable-names-are-latin"), fix = tr!("rename-it-for-example-to", fixed));
            }
            let rejected_type = rejected(format!("{place} config should be a hash of key value pairs, value can be a hash"));
            match value {
                Value::Bool(flag) => add_at!("variable-boolean", Error, title = tr!("unquoted-boolean", key, flag), when = config_when(), how = rejected_type, why = tr!("variable-values-are-strings-yaml"), fix = format!("{key}: \"{flag}\"")),
                Value::Seq(_) => add_at!("variable-array", Error, title = tr!("value-is-list", key), when = config_when(), how = rejected_type, why = tr!("variable-cant-be-list"), fix = format!("{key}: \"a b c\"")),
                Value::Map(inner) => {
                    for inner_key in inner.keys() {
                        if !matches!(inner_key.as_str(), "value" | "description" | "options" | "expand") {
                            add_at!("variable-key", Error, title = tr!("unknown-key", key, q(inner_key)), when = config_when(), how = rejected(format!("{place}:{key} config uses invalid data keys: {inner_key}")), why = tr!("allowed-value-description-options-expand"), fix = tr!("remove-key"));
                        }
                    }
                    if let (Some(options), Some(current)) = (value.get("options"), value.get("value"))
                        && !arr(Some(options)).iter().any(|option| option.js_string() == current.js_string())
                    {
                        add_at!("variable-options", Error, title = tr!("value-isnt-in-options", key, q(current.js_string())), when = config_when(), how = rejected(format!("{place}:{key} config value must be present in options")), why = format!("options: {}.", js_join(arr(Some(options)).into_iter(), ", ")), fix = tr!("add-value-to-options-or"));
                    }
                    if value.get("options").is_some() && job.is_some() {
                        add_at!("variable-options-job", Warning, title = tr!("options-in-job-variable", key), when = config_when(), how = tr!("options-only-work-for-global"), why = tr!("they-do-nothing-here"), fix = tr!("move-variable-to-global-variables"));
                    }
                }
                _ => {}
            }
            let current = if matches!(value, Value::Map(_)) { value.get("value") } else { Some(value) };
            if let Some(current @ (Value::String(_) | Value::Number(_))) = current {
                let text = current.js_string();
                if let Some((_, what)) = SECRET_VALUE.iter().find(|(regex, _)| regex.is_match(&text)) {
                    add_at!("secret-value", Error, title = tr!("in-plain-text-in-file", key, tr!(what)), when = tr!("right-now-file-is-in"), how = tr!("anyone-with-access-to-repository"), why = tr!("variables-from-gitlab-ci-yml"), fix = tr!("revoke-key-create-new-one"));
                } else if is_secret_name(key)
                    && gorynych_core::js::utf16_len(&text) >= 6
                    && !looks_like_var_ref(&Value::String(text.clone()))
                    && !re!(r"^(true|false|none|null|changeme|example|placeholder|\*+|x+)$", "i").test(&text)
                    && !text.contains('$')
                {
                    add_at!("secret-name", Warning, title = tr!("looks-like-plain-text-secret", key), when = tr!("right-now-file-is-in"), how = tr!("value-is-visible-to-anyone"), why = tr!("name-looks-like-password-token", q(key)), fix = tr!("move-value-to-settings-ci"));
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
        let run_when = job.map_or_else(|| tr!("when-each-job-with-this"), |name| tr!("when-job-runs", q(name)));
        if text.is_empty() {
            let prefix = job.map_or_else(|| "default".to_owned(), |name| format!("jobs:{name}"));
            self.image_issue(job, path, draft!("image-empty", Error, title = tr!("empty", who, what), how = rejected(format!("{prefix}:image config should be a hash or a string")), why = tr!("image-name-isnt-set"), fix = "image: node:20"));
            return;
        }
        if text.contains(gorynych_core::js::is_whitespace) {
            self.image_issue(job, path, draft!("image-space", Error, title = tr!("space-in-image-name", who, q(&text)), when = run_when, how = tr!("job-will-fail-invalid-reference"), why = tr!("image-name-cant-contain-spaces"), fix = tr!("check-name")));
            return;
        }
        let no_digest = re!(r"@sha256:.*$").replace_all(&text, "");
        let repo_part = re!(r":[^/:]+$").replace_all(&no_digest, "");
        if text.contains('$') {
            let variable = re!(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)").match_all(&text).into_iter().filter_map(|groups| groups[1].clone()).find(|name| !PREDEFINED.contains(name.as_str()) && !self.yaml_vars.contains(name));
            if let Some(variable) = variable {
                self.image_issue(job, path, draft!("image-variable", Info, title = tr!("depends-on", who, what, text, variable), when = run_when, how = tr!("if-isnt-set-in-project", variable), why = tr!("variable-isnt-declared-in-file"), fix = tr!("declare-default-value-in-variables", variable)));
            }
            return;
        }
        if repo_part.bytes().any(|byte| byte.is_ascii_uppercase()) {
            self.image_issue(job, path, draft!("image-uppercase", Error, title = tr!("uppercase-letters-in-image-name", who, q(&text)), when = run_when, how = tr!("job-will-fail-invalid-reference-format"), why = tr!("docker-image-names-are-lowercase"), fix = format!("image: {}{}", repo_part.to_lowercase(), &text[repo_part.len()..])));
        } else if !re!(r"^[^/]+:\d+\/").replace_all(&text, "").contains([':', '@']) || text.ends_with(":latest") {
            self.image_issue(job, path, draft!("image-latest", Info, title = tr!("without-version-2", who, what, text), when = run_when, how = tr!("it-works-today-but-job"), why = tr!("without-tag-latest-is-used"), fix = tr!("specify-version-version", repo_part)));
        }
    }

    /// `checkImage`.
    pub(super) fn check_image(&mut self, image: &Value, job: Option<&str>, path: &[PathItem]) {
        let who = job.map_or_else(|| "default".to_owned(), q);
        let prefix = job.map_or_else(|| "default".to_owned(), |name| format!("jobs:{name}"));
        let what = tr!("image");
        match image {
            Value::Null => self.check_image_name(&Value::String(String::new()), job, path, &what),
            Value::String(text) if text.is_empty() => self.check_image_name(image, job, path, &what),
            Value::String(_) => self.check_image_name(image, job, path, &what),
            Value::Map(map) => {
                for key in map.keys() {
                    if !matches!(key.as_str(), "name" | "entrypoint" | "docker" | "pull_policy" | "kubernetes") {
                        self.image_issue(job, &extend(path, kp![key]), draft!("image-key", Error, title = tr!("image-unknown-key", who, q(key)), how = rejected(format!("{prefix}:image config contains unknown keys: {key}")), why = tr!("allowed-name-entrypoint-docker-pull"), fix = tr!("remove-key")));
                    }
                }
                match image.get("name").filter(|value| value.truthy()) {
                    None => self.image_issue(job, path, draft!("image-no-name", Error, title = tr!("image-has-no-name", who), how = rejected(format!("{prefix}:image config must have a name")), why = tr!("image-must-be-specified"), fix = "image:\n  name: node:20")),
                    Some(name) => self.check_image_name(name, job, &extend(path, kp!["name"]), &what),
                }
            }
            other => self.image_issue(job, path, draft!("image-type", Error, title = tr!("image-must-be-string", who), how = rejected(format!("{prefix}:image config should be a hash or a string")), why = tr!("currently", other.json_string()), fix = "image: node:20")),
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
            ji!(Vec::new(), "artifacts-type", Error, title = tr!("artifacts-must-be-map", q(name)), how = rejected(format!("jobs:{name}:artifacts config should be a hash")), why = tr!("artifacts-contains-paths-expire-in"), fix = "artifacts:\n  paths:\n    - dist/");
            return;
        };
        for key in map.keys() {
            if !ARTIFACT_KEYS.contains(&key.as_str()) {
                ji!(kp![key], "artifacts-unknown-key", Error, title = tr!("artifacts-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts config contains unknown keys: {key}")), why = tr!("allowed", ARTIFACT_KEYS.join(", "), did_you_mean(key, ARTIFACT_KEYS)), fix = tr!("fix-key"));
            }
        }
        let paths = artifacts.get("paths");
        if let Some(value) = paths
            && !matches!(value, Value::Seq(_))
        {
            ji!(kp!["paths"], "artifacts-paths-type", Error, title = tr!("artifacts-paths-must-be-list", q(name)), how = rejected(format!("jobs:{name}:artifacts:paths config should be an array of strings")), why = tr!("even-single-path-is-written"), fix = format!("paths:\n  - {}", value.js_string()));
        }
        for (index, path) in arr(paths).into_iter().enumerate() {
            let text = path.js_string();
            if text.starts_with('/') || text.starts_with("../") || text == ".." || text.starts_with('~') {
                ji!(kp!["paths", index], "artifacts-outside", Warning, title = tr!("artifact-path-is-outside-project", q(name), q(&text)), when = tr!("at-end-of-job", q(name)), how = tr!("files-wont-be-saved-warning", text), why = tr!("artifacts-can-only-be-taken-inside"), fix = tr!("copy-files-into-project-folder"));
            }
        }
        if paths.is_none() && !artifacts.get("untracked").is_some_and(Value::truthy) && !matches!(artifacts.get("reports"), Some(Value::Map(_))) {
            ji!(Vec::new(), "artifacts-empty", Warning, title = tr!("artifacts-doesnt-say-what-to", q(name)), when = tr!("at-end-of-job", q(name)), how = tr!("runner-wont-upload-anything-warning"), why = tr!("there-are-no-paths-reports"), fix = "artifacts:\n  paths:\n    - dist/");
        }
        if let Some(expire) = artifacts.get("expire_in")
            && expire.js_string() != "never"
            && duration_seconds(Some(expire)).is_none()
        {
            ji!(kp!["expire_in"], "artifacts-expire", Error, title = tr!("cant-parse-expire-in", q(name), arg(expire)), how = rejected(format!("jobs:{name}:artifacts expire in should be a duration")), why = tr!("written-as-1-week-30"), fix = "expire_in: 1 week");
        }
        if let Some(when) = artifacts.get("when")
            && !when.as_str().is_some_and(|text| SIMPLE_WHEN.contains(&text))
        {
            let text = when.js_string();
            ji!(kp!["when"], "artifacts-when", Error, title = format!("{}: artifacts:when {text}", q(name)), how = rejected(format!("jobs:{name}:artifacts when should be on_success, on_failure or always")), why = tr!("unknown-value", did_you_mean(&text, SIMPLE_WHEN)), fix = "when: always");
        }
        if let Some(Value::Map(reports)) = artifacts.get("reports") {
            for (key, value) in reports.iter() {
                if let Some(replacement) = removed_report(key) {
                    ji!(kp!["reports", key], "report-removed", Error, title = tr!("report-is-no-longer-supported", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts:reports config contains unknown keys: {key}")), why = tr!("report-type-was-removed-from"), fix = tr!("use", replacement));
                } else if !REPORTS.contains(&key.as_str()) {
                    ji!(kp!["reports", key], "report-unknown", Error, title = tr!("unknown-report-type", q(name), q(key)), how = rejected(format!("jobs:{name}:artifacts:reports config contains unknown keys: {key}")), why = tr!("unknown-type", did_you_mean(key, REPORTS)), fix = tr!("check-report-name"));
                }
                if key == "coverage_report" {
                    let format = value.get("coverage_format").filter(|item| item.truthy());
                    if format.is_none() || !value.get("path").is_some_and(Value::truthy) {
                        ji!(kp!["reports", key], "coverage-report-format", Error, title = tr!("coverage-report-without-coverage-format", q(name)), how = rejected(format!("jobs:{name}:artifacts:reports:coverage_report config must have coverage_format and path")), why = tr!("both-keys-are-required"), fix = "coverage_report:\n  coverage_format: cobertura\n  path: coverage/cobertura-coverage.xml");
                    }
                    if let Some(format) = format
                        && !matches!(format.as_str(), Some("cobertura" | "jacoco"))
                    {
                        ji!(kp!["reports", key, "coverage_format"], "coverage-format-value", Error, title = format!("{}: coverage_format {}", q(name), format.js_string()), how = rejected("coverage_format must be cobertura or jacoco"), why = tr!("cobertura-and-jacoco-are-supported"), fix = "coverage_format: cobertura");
                    }
                }
            }
        }
    }

    /// `checkCache`.
    pub(super) fn check_cache(&mut self, name: &str, cache: &Value, base: &[PathItem]) {
        let list = arr(Some(cache));
        if list.len() > 4 {
            self.job_issue(name, base, draft!("cache-limit", Error, title = tr!("more-than-4-caches", q(name)), how = rejected(format!("jobs:{name}:cache config no more than 4 caches can be created")), why = tr!("gitlab-limit"), fix = tr!("merge-caches")));
        }
        for (index, entry) in list.into_iter().enumerate() {
            let entry_path = if matches!(cache, Value::Seq(_)) { extend(base, kp![index]) } else { base.to_vec() };
            macro_rules! ji {
                ($path:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
                    self.job_issue(name, &extend(&entry_path, $path), draft!($id, $severity $(, $field = $value)*))
                };
            }
            let Value::Map(map) = entry else {
                ji!(Vec::new(), "cache-type", Error, title = tr!("cache-must-be-map", q(name)), how = rejected(format!("jobs:{name}:cache config should be a hash")), why = tr!("cache-contains-key-paths-policy"), fix = "cache:\n  key: $CI_COMMIT_REF_SLUG\n  paths:\n    - node_modules/");
                continue;
            };
            for key in map.keys() {
                if !CACHE_KEYS.contains(&key.as_str()) {
                    ji!(kp![key], "cache-unknown-key", Error, title = tr!("cache-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:cache config contains unknown keys: {key}")), why = tr!("allowed", CACHE_KEYS.join(", "), did_you_mean(key, CACHE_KEYS)), fix = tr!("fix-key"));
                }
            }
            match entry.get("key") {
                Some(key @ (Value::String(_) | Value::Number(_))) => {
                    let text = key.js_string();
                    if re!(r"\/|%2F", "i").test(&text) || text == "." || text == ".." || re!(r"%2E", "i").test(&text) {
                        ji!(kp!["key"], "cache-key-slash", Error, title = tr!("cache-key-contains-or-is", q(name)), how = rejected(format!("jobs:{name}:cache:key config cannot contain the \"/\" character or be \".\"")), why = tr!("cache-key-becomes-part-of"), fix = tr!("use-ci-commit-ref-slug"));
                    }
                    if re!(r"\$CI_COMMIT_REF_NAME|\$CI_COMMIT_BRANCH").test(&text) {
                        ji!(kp!["key"], "cache-key-refname", Warning, title = tr!("cache-key-with-branch-name", q(name)), when = tr!("in-branches-with-in-name"), how = tr!("cache-wont-be-saved-branch"), why = tr!("ci-commit-ref-name-may"), fix = tr!("use-ci-commit-ref-slug-2"));
                    }
                }
                Some(key @ Value::Map(key_map)) => {
                    let files = arr(key.get("files"));
                    if files.len() > 2 {
                        ji!(kp!["key", "files"], "cache-key-files", Error, title = tr!("more-than-two-cache-key", q(name)), how = rejected(format!("jobs:{name}:cache:key:files config has too many entries (maximum 2)")), why = tr!("key-can-be-built-from"), fix = tr!("keep-1-2-files-usually"));
                    }
                    for file in files {
                        let text = file.js_string();
                        if !text.contains(['$', '*']) && !self.cx.repo.has_file(&text) {
                            ji!(kp!["key", "files"], "cache-key-file-missing", Warning, title = tr!("cache-key-files-no-file", q(name), arg(file)), when = tr!("when-job-runs-2", q(name)), how = tr!("cache-will-be-shared-under"), why = tr!("file-isnt-in-repository-2", q(&text)), fix = tr!("specify-existing-lock-file"));
                        }
                    }
                    for inner in key_map.keys() {
                        if !matches!(inner.as_str(), "files" | "prefix" | "files_commits") {
                            ji!(kp!["key", inner], "cache-key-key", Error, title = tr!("cache-key-unknown-key", q(name), q(inner)), how = rejected(format!("jobs:{name}:cache:key config contains unknown keys: {inner}")), why = tr!("allowed-files-and-prefix"), fix = tr!("remove-key"));
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
                ji!(kp!["policy"], "cache-policy", Error, title = format!("{}: cache:policy {text}", q(name)), how = rejected(format!("jobs:{name}:cache policy should be pull-push, push, or pull")), why = tr!("unknown-value", did_you_mean(&text, ["pull", "push", "pull-push"])), fix = "policy: pull");
            }
            if let Some(when) = entry.get("when")
                && !when.as_str().is_some_and(|text| SIMPLE_WHEN.contains(&text))
            {
                ji!(kp!["when"], "cache-when", Error, title = format!("{}: cache:when {}", q(name), when.js_string()), how = rejected(format!("jobs:{name}:cache when should be on_success, on_failure or always")), why = tr!("unknown-value-2"), fix = "when: on_success");
            }
            let paths = entry.get("paths");
            if let Some(value) = paths
                && !matches!(value, Value::Seq(_))
            {
                ji!(kp!["paths"], "cache-paths-type", Error, title = tr!("cache-paths-must-be-list", q(name)), how = rejected(format!("jobs:{name}:cache:paths config should be an array of strings")), why = tr!("even-single-path-is-written"), fix = format!("paths:\n  - {}", value.js_string()));
            }
            if arr(paths).is_empty() && !entry.get("untracked").is_some_and(Value::truthy) {
                ji!(Vec::new(), "cache-empty", Warning, title = tr!("cache-doesnt-say-what-to", q(name)), when = tr!("at-end-of-job", q(name)), how = tr!("cache-wont-be-created-runner"), why = tr!("there-are-no-paths-or"), fix = "paths:\n  - node_modules/");
            }
            for (at, path) in arr(paths).into_iter().enumerate() {
                let text = path.js_string();
                if text.starts_with('/') || text.starts_with("../") || text.starts_with('~') {
                    ji!(kp!["paths", at], "cache-outside", Warning, title = tr!("cache-path-is-outside-project", q(name), q(&text)), when = tr!("at-end-of-job", q(name)), how = tr!("warning-not-supported-outside-build", arg(path)), why = tr!("only-paths-inside-project-folder"), fix = tr!("move-cache-inside-project-for"));
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
            ji!(Vec::new(), "env-type", Error, title = tr!("environment-must-be-string-or", q(name)), how = rejected(format!("jobs:{name}:environment config should be a hash or a string")), why = tr!("set-environment-name"), fix = "environment: production");
            return;
        };
        for key in map.keys() {
            if !ENV_KEYS.contains(&key.as_str()) {
                ji!(kp![key], "env-unknown-key", Error, title = tr!("environment-unknown-key", q(name), q(key)), how = rejected(format!("jobs:{name}:environment config contains unknown keys: {key}")), why = tr!("allowed", ENV_KEYS.join(", "), did_you_mean(key, ENV_KEYS)), fix = tr!("fix-key"));
            }
        }
        match env.get("name").filter(|value| value.truthy()) {
            None => ji!(Vec::new(), "env-no-name", Error, title = tr!("environment-has-no-name", q(name)), how = rejected(format!("jobs:{name}:environment name can't be blank")), why = tr!("environment-is-identified-by-its"), fix = "environment:\n  name: production"),
            Some(env_name) => {
                if !re!(r"^[A-Za-z0-9 _\-/${}.]+$").test(&env_name.js_string()) {
                    ji!(kp!["name"], "env-name", Error, title = tr!("invalid-environment-name", q(name), q(env_name.js_string())), how = rejected(format!("jobs:{name}:environment name can contain only letters, digits, '-', '_', '/', '$', '{{', '}}', '.', and spaces")), why = tr!("name-contains-forbidden-characters"), fix = tr!("for-example-review-ci-commit"));
                }
            }
        }
        if let Some(url) = env.get("url") {
            let text = url.js_string();
            if !re!(r"^https?:\/\/", "i").test(&text) && !text.starts_with('$') {
                ji!(kp!["url"], "env-url", Error, title = tr!("environment-url-isnt-address", q(name), arg(url)), how = rejected(format!("jobs:{name}:environment url must be a valid url")), why = tr!("url-must-start-with-http"), fix = format!("url: https://{text}"));
            }
        }
        if let Some(action) = env.get("action")
            && !action.as_str().is_some_and(|text| ENV_ACTIONS.contains(&text))
        {
            let text = action.js_string();
            ji!(kp!["action"], "env-action", Error, title = format!("{}: environment:action {text}", q(name)), how = rejected(format!("jobs:{name}:environment action should be start, stop, prepare, verify, or access")), why = tr!("unknown-value", did_you_mean(&text, ENV_ACTIONS)), fix = "action: stop");
        }
        if let Some(tier) = env.get("deployment_tier")
            && !tier.as_str().is_some_and(|text| TIERS.contains(&text))
        {
            let text = tier.js_string();
            ji!(kp!["deployment_tier"], "env-tier", Error, title = format!("{}: deployment_tier {text}", q(name)), how = rejected(format!("jobs:{name}:environment deployment_tier must be one of: {}", TIERS.join(", "))), why = tr!("unknown-value", did_you_mean(&text, TIERS)), fix = "deployment_tier: production");
        }
        if let Some(stop_in) = env.get("auto_stop_in")
            && stop_in.js_string() != "never"
            && duration_seconds(Some(stop_in)).is_none()
        {
            ji!(kp!["auto_stop_in"], "env-auto-stop", Error, title = tr!("cant-parse-auto-stop-in", q(name), arg(stop_in)), how = rejected(format!("jobs:{name}:environment auto stop in should be a duration")), why = tr!("written-as-1-week-2"), fix = "auto_stop_in: 1 week");
        }
        let Some(on_stop) = env.get("on_stop") else { return };
        let stop_job = on_stop.js_string();
        let stop_config = self.resolved(&stop_job).cloned();
        let Some(stop_config) = stop_config.filter(|_| !stop_job.starts_with('.')) else {
            ji!(kp!["on_stop"], "env-on-stop-missing", Error, title = tr!("on-stop-refers-to-nonexistent", q(name), q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} is not defined")), why = tr!("theres-no-job", q(&stop_job), did_you_mean(&stop_job, self.visible.iter().map(String::as_str))), fix = tr!("add-environment-stop-job-or"));
            return;
        };
        let stop_env = stop_config.get("environment").map(as_map);
        let is_stop = stop_env.as_ref().is_some_and(|value| matches!(value, Value::Map(_)) && value.get("action").and_then(Value::as_str) == Some("stop"));
        let env_name_text = js_str(env.get("name"));
        if !is_stop {
            self.job_issue(&stop_job, &kp!["environment"], draft!("env-stop-action", Error, title = tr!("no-environment-action-stop", q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} is not defined as a stop job (environment:action: stop is missing)")), why = tr!("is-listed-in-on-stop", q(&stop_job), q(name)), fix = format!("{stop_job}:\n  environment:\n    name: {env_name_text}\n    action: stop")));
        } else if stop_env.as_ref().and_then(|value| value.get("name")) != env.get("name") {
            let stop_name = stop_env.as_ref().and_then(|value| value.get("name"));
            self.job_issue(&stop_job, &kp!["environment", "name"], draft!("env-stop-name", Error, title = tr!("different-environment-name", q(&stop_job)), how = rejected(format!("{name} job: on_stop job {stop_job} has different environment name")), why = tr!("environment-is-and-has", q(name), q_opt(env.get("name")), q(&stop_job), q_opt(stop_name)), fix = tr!("use-one-name", arg_opt(env.get("name")))));
        }
        let manual = stop_config.get("when").and_then(Value::as_str) == Some("manual") || arr(stop_config.get("rules")).iter().any(|rule| rule.get("when").and_then(Value::as_str) == Some("manual"));
        if !manual {
            self.job_issue(&stop_job, &[], draft!("env-stop-auto", Warning, title = tr!("will-run-automatically", q(&stop_job)), when = tr!("in-every-pipeline-with-this"), how = tr!("environment-will-be-stopped-right"), why = tr!("stop-job-without-when-manual"), fix = "when: manual"));
        }
    }
}
