//! GitLab CI: `loadGitlab` и `gitlabJob` из `electron/ci.cjs`.
//!
//! ## Конспект
//! - Обход `include` рекурсивно: сначала подключаемые файлы, затем свои ключи, поэтому основной файл переопределяет. Файл читается один раз,
//!   глубина ≤ 6, разрешается только `local`. Glob: `*`, `**`, `?`, обход ≤ 6 уровней без `.git` и `node_modules`, по `sort()`.
//! - Ключ из `GITLAB_GLOBAL` — глобальный: `variables` и `default` сливаются глубоко, прочие заменяются. Остальное — определение задания;
//!   не словарь задания не создаёт, повтор сливается через `deepMerge`, `source` и `line` — последнего.
//! - `extends`: родители по порядку, свои ключи поверх, кэш по имени; цикл даёт предупреждение и конфиг как есть без кэша.
//! - `!reference`: сначала цель в глобальных (`in`), затем `resolveJob`; глубина ≤ 10; в списке результат-список расплющивается. Нет цели —
//!   предупреждение без повторов, значение остаётся. Глобальные разрешаются первыми, по ещё неразрешённым себе.
//! - Этапы: объявленные (`stages`, иначе `types`) в обрамлении `.pre` и `.post`, иначе `.pre build test deploy .post`. Необъявленный этап —
//!   перед последним, `undeclared` и предупреждение. В пайплайн идут этапы с заданиями и объявленные без точки в начале.
//! - Найдено при переносе: в `inheritKey` проверка `inherit.default` — списка в 1.x никогда не срабатывает: любое значение, кроме `false`,
//!   наследует всё (`inheritDefault === true`). Сохранено.
//!
//! ## Отличия от 1.x
//! - Свойство `__reference`, заданное в файле не тегом и не списком: в 1.x падение или разбор строки посимвольно, здесь обычный словарь.
//! - Цель `!reference` из свойств прототипа JS (`[toString]`, `[constructor]`) и задания с именем `__proto__` не особенны: это обычные имена.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use indexmap::IndexMap;

use super::common::*;
use super::model::*;
use crate::detect::{self, sorted_names};
use crate::js_regex::JsRegex;
use crate::yaml::{JsMap, Value, parse_yaml};
use crate::yaml_write::to_yaml;

const MAX_INCLUDE_DEPTH: usize = 6;
const MAX_GLOB_DEPTH: usize = 6;
const GITLAB_GLOBAL: [&str; 12] =
    ["default", "include", "stages", "types", "variables", "workflow", "image", "services", "cache", "before_script", "after_script", "spec"];
const DEFAULT_STAGES: [&str; 5] = [".pre", "build", "test", "deploy", ".post"];
const SIMPLE_RULE_KEYS: [&str; 3] = ["if", "when", "allow_failure"];

/// Итог всех определений задания.
#[derive(Debug, Clone)]
pub struct JobEntry {
    pub config: Value,
    pub source: String,
    pub line: Option<u32>,
}

/// Одно определение задания в файле, для проверки повторов.
#[derive(Debug, Clone)]
pub struct JobDef {
    pub name: String,
    pub source: String,
    pub line: Option<u32>,
    pub value: Value,
}

/// Глобальный ключ в файле.
#[derive(Debug, Clone)]
pub struct GlobalDef {
    pub key: String,
    pub source: String,
    pub line: Option<u32>,
}

/// Результат `resolveJob`.
#[derive(Debug, Clone)]
pub struct ResolvedJob {
    pub config: Value,
    pub chain: Vec<String>,
}

/// То, что 1.x держал в `_raw`: нужно проверке конфигурации и в интерфейс не уходит.
#[derive(Debug)]
pub struct GitlabModel {
    pub jobs: IndexMap<String, JobEntry>,
    pub job_defs: Vec<JobDef>,
    pub global_defs: Vec<GlobalDef>,
    pub globals: Value,
    pub declared_stages: Vec<String>,
    pub stage_names: Vec<String>,
    pub includes: Vec<CiInclude>,
    pub(crate) resolved: RefCell<HashMap<String, Rc<ResolvedJob>>>,
    pub(crate) warnings: RefCell<Vec<String>>,
    language: gorynych_core::Language,
}

impl GitlabModel {
    fn t(&self, msg: &str, args: &[&dyn std::fmt::Display]) -> String {
        gorynych_core::i18n::tr(self.language, msg, args)
    }

    /// `resolveJob`: наследование через `extends`.
    pub fn resolve_job(&self, name: &str) -> Option<Rc<ResolvedJob>> {
        self.resolve_job_inner(name, &mut Vec::new())
    }

    fn resolve_job_inner(&self, name: &str, stack: &mut Vec<String>) -> Option<Rc<ResolvedJob>> {
        if let Some(found) = self.resolved.borrow().get(name) {
            return Some(found.clone());
        }
        let entry = self.jobs.get(name)?;
        if stack.iter().any(|item| item == name) {
            let path: Vec<&str> = stack.iter().map(String::as_str).chain([name]).collect();
            self.warnings.borrow_mut().push(self.t("Циклическое наследование: {0}", &[&path.join(" → ")]));
            return Some(Rc::new(ResolvedJob { config: entry.config.clone(), chain: Vec::new() }));
        }
        let mut merged = Value::Map(JsMap::new());
        let mut chain: Vec<String> = Vec::new();
        for parent in as_array(entry.config.get("extends")) {
            stack.push(name.to_owned());
            let found = parent.as_str().and_then(|parent| self.resolve_job_inner(parent, stack));
            stack.pop();
            let Some(found) = found else {
                self.warnings.borrow_mut().push(self.t("«{0}»: extends ссылается на неизвестное задание «{1}»", &[&name, &Ctx::arg(parent)]));
                continue;
            };
            let parent = parent.as_str().unwrap_or_default();
            let added: Vec<String> =
                found.chain.iter().filter(|item| !chain.contains(item) && *item != name && *item != parent).cloned().collect();
            chain.push(parent.to_owned());
            chain.extend(added);
            merged = deep_merge(&merged, &found.config);
        }
        let mut own = JsMap::new();
        if let Value::Map(config) = &entry.config {
            for (key, value) in config.iter().filter(|(key, _)| *key != "extends") {
                own.insert(key.clone(), value.clone());
            }
        }
        let result = Rc::new(ResolvedJob { config: deep_merge(&merged, &Value::Map(own)), chain });
        self.resolved.borrow_mut().insert(name.to_owned(), result.clone());
        Some(result)
    }

    /// `resolveReferences`: подстановка `!reference`.
    pub fn resolve_references(&self, value: &Value) -> Value {
        self.references_inner(value, 0)
    }

    fn references_inner(&self, value: &Value, depth: usize) -> Value {
        if depth > 10 {
            return value.clone();
        }
        match value {
            Value::Seq(items) => {
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    let resolved = self.references_inner(item, depth + 1);
                    match resolved {
                        Value::Seq(inner) if reference_of(item).is_some() => out.extend(inner),
                        other => out.push(other),
                    }
                }
                Value::Seq(out)
            }
            Value::Map(map) => {
                if let Some(reference) = reference_of(value) {
                    return self.reference_target(reference, depth).unwrap_or_else(|| {
                        let message = self.t("!reference [{0}] ссылается на то, чего нет", &[&crate::yaml::js_join(reference.iter(), ", ")]);
                        let mut warnings = self.warnings.borrow_mut();
                        if !warnings.contains(&message) {
                            warnings.push(message);
                        }
                        value.clone()
                    });
                }
                let mut out = JsMap::new();
                for (key, item) in map.iter() {
                    out.insert(key.clone(), self.references_inner(item, depth + 1));
                }
                Value::Map(out)
            }
            other => other.clone(),
        }
    }

    fn reference_target(&self, reference: &[Value], depth: usize) -> Option<Value> {
        let (first, keys) = reference.split_first()?;
        let global = self.globals.get(&first.js_string());
        let mut target = match global {
            Some(value) => Some(value.clone()),
            None => first.as_str().and_then(|name| self.resolve_job(name)).map(|job| job.config.clone()),
        };
        for key in keys {
            target = target.and_then(|target| property(&target, &key.js_string()));
        }
        Some(self.references_inner(&target?, depth + 1))
    }
}

/// `target?.[key]` для значения любого типа.
pub(crate) fn property(target: &Value, key: &str) -> Option<Value> {
    match target {
        Value::Map(map) => map.get(key).cloned(),
        Value::Seq(items) if key == "length" => Some(Value::Number(items.len() as f64)),
        Value::Seq(items) => key.parse::<usize>().ok().and_then(|index| items.get(index)).cloned(),
        Value::String(text) if key == "length" => Some(Value::Number(gorynych_core::js::utf16_len(text) as f64)),
        Value::String(text) => key.parse::<usize>().ok().and_then(|index| text.chars().nth(index)).map(|c| Value::String(c.to_string())),
        _ => None,
    }
}

/// `normalizeInclude`.
fn normalize_include(entry: &Value) -> CiInclude {
    let include = |kind: &str, value: Value| CiInclude {
        kind: kind.to_owned(),
        value,
        rules: None,
        from: None,
        resolved: false,
        files: None,
        error: None,
    };
    if let Value::String(text) = entry {
        let remote = text.get(..7).is_some_and(|start| start.eq_ignore_ascii_case("http://")) || text.get(..8).is_some_and(|start| start.eq_ignore_ascii_case("https://"));
        return include(if remote { "remote" } else { "local" }, entry.clone());
    }
    if !matches!(entry, Value::Map(_)) {
        return include("unknown", Value::String(entry.json_string()));
    }
    if let Some(local) = truthy(entry.get("local")) {
        return CiInclude { rules: non_null(entry.get("rules")).cloned(), ..include("local", local.clone()) };
    }
    if let Some(project) = truthy(entry.get("project")) {
        let reference = truthy(entry.get("ref")).map_or_else(String::new, |reference| format!("@{}", reference.js_string()));
        let text = format!("{}{reference}: {}", project.js_string(), joined(entry.get("file"), ", "));
        return include("project", Value::String(text));
    }
    if let Some(remote) = truthy(entry.get("remote")) {
        return include("remote", remote.clone());
    }
    if let Some(template) = truthy(entry.get("template")) {
        return include("template", template.clone());
    }
    if let Some(component) = truthy(entry.get("component")) {
        return include("component", component.clone());
    }
    include("unknown", Value::String(to_yaml(entry)))
}

/// `expandLocalGlob`. `pattern` — не строка: падение, как в 1.x.
fn expand_local_glob(ctx: &Ctx<'_>, pattern: &Value) -> LoadResult<Vec<String>> {
    let Value::String(pattern) = pattern else { return Err("pattern.replace is not a function".to_owned()) };
    let rel = pattern.trim_start_matches('/');
    if !rel.contains(['*', '?']) {
        return Ok(vec![rel.to_owned()]);
    }
    let mut escaped = String::with_capacity(rel.len() + 8);
    for c in rel.chars() {
        if matches!(c, '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    // Порядок замен как в 1.x: `***/` сначала отдаёт `**/`
    let source = escaped
        .replace("**/", "\u{0}")
        .replace("**", "\u{1}")
        .replace('*', "[^/]*")
        .replace('?', "[^/]")
        .replace('\u{0}', "(?:.*/)?")
        .replace('\u{1}', ".*");
    let regex = JsRegex::new(&format!("^{source}$"), "")?;
    let mut found = Vec::new();
    walk_glob(ctx, "", 0, &regex, &mut found);
    found.sort_by(|a, b| gorynych_core::js::utf16_cmp(a, b));
    Ok(found)
}

fn walk_glob(ctx: &Ctx<'_>, dir: &str, depth: usize, regex: &JsRegex, found: &mut Vec<String>) {
    if depth > MAX_GLOB_DEPTH {
        return;
    }
    let full = if dir.is_empty() { ctx.root.to_path_buf() } else { detect::join(ctx.root, dir) };
    for name in sorted_names(&full) {
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let rel = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
        // Как `Dirent.isDirectory()`: ссылка на папку папкой не считается
        let is_dir = std::fs::symlink_metadata(full.join(&name)).is_ok_and(|meta| meta.is_dir());
        if is_dir {
            walk_glob(ctx, &rel, depth + 1, regex, found);
        } else if regex.is_match(&rel) {
            found.push(rel);
        }
    }
}

/// Сбор файлов и определений: `visit`.
struct Collector<'a, 'b> {
    ctx: &'a Ctx<'b>,
    files: Vec<CiFile>,
    errors: Vec<CiFileError>,
    includes: Vec<CiInclude>,
    jobs: IndexMap<String, JobEntry>,
    job_defs: Vec<JobDef>,
    global_defs: Vec<GlobalDef>,
    globals: JsMap,
    seen: HashSet<String>,
}

impl Collector<'_, '_> {
    fn visit(&mut self, rel: &str, depth: usize, via: &str) -> LoadResult<()> {
        if !self.seen.insert(rel.to_owned()) {
            return Ok(());
        }
        let text = match self.ctx.read_text(rel) {
            Ok(text) => text,
            Err(error) => {
                let message = self.ctx.t("Не удалось прочитать {0}: {1}", &[&rel, &error.message]);
                self.errors.push(CiFileError { file: via.to_owned(), message, line: None, severity: CiSeverity::Error });
                return Ok(());
            }
        };
        let parsed = parse_yaml(&text);
        let lines = parsed.lines(&text);
        self.errors.extend(Ctx::file_errors(&parsed, rel));
        self.files.push(CiFile { path: rel.to_owned(), text, hash: None, draft: false });
        let data = parsed.data;

        for raw in as_array(data.get("include")) {
            let mut include = normalize_include(raw);
            include.from = Some(rel.to_owned());
            include.files = Some(Vec::new());
            let at = self.includes.len();
            self.includes.push(include);
            if self.includes[at].kind != "local" {
                continue;
            }
            if depth >= MAX_INCLUDE_DEPTH {
                self.includes[at].error = Some(self.ctx.t("Слишком глубокая вложенность include", &[]));
                continue;
            }
            let matched = expand_local_glob(self.ctx, &self.includes[at].value)?;
            let files: Vec<String> = matched.into_iter().filter(|file| detect::is_file(&detect::join(self.ctx.root, file))).collect();
            self.includes[at].files = Some(files.clone());
            if files.is_empty() {
                self.includes[at].error = Some(self.ctx.t("Файл не найден в репозитории", &[]));
                continue;
            }
            self.includes[at].resolved = true;
            for file in &files {
                self.visit(file, depth + 1, rel)?;
            }
        }

        let Value::Map(data) = &data else { return Ok(()) };
        for (key, value) in data.iter() {
            let line = lines.get(key).copied();
            if GITLAB_GLOBAL.contains(&key.as_str()) {
                self.global_defs.push(GlobalDef { key: key.clone(), source: rel.to_owned(), line });
                let merged = if key == "variables" || key == "default" {
                    let empty = Value::Map(JsMap::new());
                    let base = non_null(self.globals.get(key)).unwrap_or(&empty);
                    deep_merge(base, if value.is_null() { &empty } else { value })
                } else {
                    value.clone()
                };
                self.globals.insert(key.clone(), merged);
                continue;
            }
            self.job_defs.push(JobDef { name: key.clone(), source: rel.to_owned(), line, value: value.clone() });
            if !matches!(value, Value::Map(_)) {
                continue;
            }
            let config = match self.jobs.get(key) {
                Some(previous) => deep_merge(&previous.config, value),
                None => value.clone(),
            };
            self.jobs.insert(key.clone(), JobEntry { config, source: rel.to_owned(), line });
        }
        Ok(())
    }
}

/// `loadGitlab`.
pub(crate) fn load_gitlab(ctx: &Ctx<'_>, main_file: &str) -> LoadResult<(CiConfig, GitlabModel)> {
    let mut collector = Collector {
        ctx,
        files: Vec::new(),
        errors: Vec::new(),
        includes: Vec::new(),
        jobs: IndexMap::new(),
        job_defs: Vec::new(),
        global_defs: Vec::new(),
        globals: JsMap::new(),
        seen: HashSet::new(),
    };
    collector.visit(main_file, 0, main_file)?;
    let Collector { files, errors, includes, jobs, job_defs, global_defs, globals, .. } = collector;

    let mut model = GitlabModel {
        jobs,
        job_defs,
        global_defs,
        globals: Value::Map(globals),
        declared_stages: Vec::new(),
        stage_names: Vec::new(),
        includes: includes.clone(),
        resolved: RefCell::new(HashMap::new()),
        warnings: RefCell::new(Vec::new()),
        language: ctx.language,
    };
    model.globals = model.resolve_references(&model.globals);
    let empty = Value::Map(JsMap::new());
    let defaults = model.globals.get("default").filter(|value| matches!(value, Value::Map(_))).unwrap_or(&empty).clone();
    let globals = model.globals.clone();
    model.declared_stages = strings(non_null(globals.get("stages")).or_else(|| globals.get("types")));
    model.stage_names = if model.declared_stages.is_empty() {
        DEFAULT_STAGES.iter().map(|name| (*name).to_owned()).collect()
    } else {
        let inner = model.declared_stages.iter().filter(|name| *name != ".pre" && *name != ".post").cloned();
        [".pre".to_owned()].into_iter().chain(inner).chain([".post".to_owned()]).collect()
    };

    let mut visible = Vec::new();
    let mut templates = Vec::new();
    for (name, entry) in &model.jobs {
        let resolved = model.resolve_job(name);
        let (config, chain) = resolved.map_or_else(|| (entry.config.clone(), Vec::new()), |job| (job.config.clone(), job.chain.clone()));
        let config = model.resolve_references(&config);
        if name.starts_with('.') {
            templates.push(CiTemplate {
                id: name.clone(),
                name: name.clone(),
                line: entry.line,
                source: entry.source.clone(),
                raw: to_yaml(&entry.config),
                used_by: Vec::new(),
            });
            continue;
        }
        visible.push(gitlab_job(ctx, name, &config, entry, chain, &globals, &defaults)?);
    }
    for template in &mut templates {
        template.used_by = visible.iter().filter(|job: &&CiJob| job.extends.contains(&template.name)).map(|job| job.name.clone()).collect();
    }

    let mut warnings = Vec::new();
    let needs_warnings: Vec<String> = visible
        .iter()
        .flat_map(|job| job.needs.iter().flatten().map(move |need| (job, need)))
        .filter(|(_, need)| need.optional != Some(true) && need.external != Some(true) && !visible.iter().any(|other| need.job.as_str() == Some(other.name.as_str())))
        .map(|(job, need)| ctx.t("«{0}»: needs ссылается на задание «{1}», которого нет", &[&job.name, &Ctx::arg(&need.job)]))
        .collect();

    let mut stages: Vec<(String, Vec<CiJob>, bool)> = model.stage_names.iter().map(|name| (name.clone(), Vec::new(), false)).collect();
    for job in visible {
        let stage_name = job.stage.clone().unwrap_or_default();
        let at = match stages.iter().position(|stage| stage.0 == stage_name) {
            Some(at) => at,
            None => {
                warnings.push(ctx.t("«{0}»: этап «{1}» не объявлен в stages — GitLab не запустит пайплайн", &[&job.name, &stage_name]));
                let at = stages.len() - 1;
                stages.insert(at, (stage_name, Vec::new(), true));
                at
            }
        };
        stages[at].1.push(job);
    }
    warnings.extend(needs_warnings);
    let used: Vec<CiStage> = stages
        .into_iter()
        .filter(|(name, jobs, _)| !jobs.is_empty() || (!name.starts_with('.') && model.declared_stages.contains(name)))
        .map(|(name, jobs, undeclared)| CiStage { name: Value::String(name), jobs, undeclared: undeclared.then_some(true) })
        .collect();

    let workflow = globals.get("workflow").filter(|value| matches!(value, Value::Map(_)));
    let mut info = Vec::new();
    if let Some(name) = workflow.and_then(|workflow| truthy(workflow.get("name"))) {
        info.push(CiInfo { label: ctx.t("Название пайплайна", &[]), value: Value::String(name.js_string()) });
    }
    if let Some(image) = image_name(non_null(defaults.get("image")).or_else(|| globals.get("image"))) {
        info.push(CiInfo { label: ctx.t("Образ по умолчанию", &[]), value: image });
    }
    if let Some(tags) = truthy(defaults.get("tags")) {
        info.push(CiInfo { label: ctx.t("Теги раннеров", &[]), value: Value::String(joined(Some(tags), ", ")) });
    }
    let triggers = workflow
        .and_then(|workflow| truthy(workflow.get("rules")))
        .map_or_else(Vec::new, |rules| as_array(Some(rules)).into_iter().map(|rule| rule_text(ctx, rule)).collect());

    // Предупреждения в порядке 1.x: сначала наследование и ссылки, затем этапы, затем needs
    let mut all_warnings = model.warnings.borrow().clone();
    all_warnings.extend(warnings);
    let config = CiConfig {
        files,
        errors,
        warnings: all_warnings,
        includes,
        info,
        triggers,
        triggers_title: Some(ctx.t("Когда создаётся пайплайн (workflow:rules)", &[])),
        variables: variables_list(globals.get("variables")),
        pipelines: vec![CiPipeline { id: "main".to_owned(), title: ctx.t("Пайплайн", &[]), stages: used }],
        templates,
        scheme_unsupported: None,
    };
    Ok((config, model))
}

fn only_except_text(value: Option<&Value>) -> Option<String> {
    let value = non_null(value)?;
    Some(match value {
        Value::String(_) | Value::Seq(_) => joined(Some(value), ", "),
        Value::Map(map) => map.iter().map(|(key, item)| format!("{key}: {}", joined(Some(item), ", "))).collect::<Vec<_>>().join("; "),
        other => other.js_string(),
    })
}

/// `gitlabJob`.
fn gitlab_job(ctx: &Ctx<'_>, name: &str, cfg: &Value, entry: &JobEntry, chain: Vec<String>, globals: &Value, defaults: &Value) -> LoadResult<CiJob> {
    // В 1.x `inheritKey` истинна для всего, кроме `inherit: {default: false}`: см. шапку
    let inherit_default = !matches!(cfg.get("inherit").and_then(|inherit| inherit.get("default")), Some(Value::Bool(false)));
    let from_default = |key: &str| -> (Option<&Value>, Option<String>) {
        if let Some(own) = cfg.get(key) {
            return (Some(own), None);
        }
        if inherit_default {
            if let Some(value) = defaults.get(key) {
                return (Some(value), Some("default".to_owned()));
            }
            if let Some(value) = globals.get(key) {
                return (Some(value), Some(ctx.t("глобально", &[])));
            }
        }
        (None, None)
    };
    let (image, image_inherited) = from_default("image");
    let script_of = |(value, inherited): (Option<&Value>, Option<String>)| value.map(|value| CiScript { lines: script_lines(Some(value)), inherited });

    let needs = match cfg.get("needs") {
        None => None,
        needs => Some(
            as_array(needs)
                .into_iter()
                .map(|need| match need {
                    Value::String(_) => Ok(CiNeed { job: need.clone(), optional: None, artifacts: None, external: None }),
                    Value::Null => Err(null_read("job")),
                    _ => Ok(CiNeed {
                        job: non_null(need.get("job"))
                            .or_else(|| non_null(need.get("pipeline")))
                            .cloned()
                            .unwrap_or_else(|| Value::String("?".to_owned())),
                        optional: Some(need.get("optional").is_some_and(Value::truthy)),
                        artifacts: need.get("artifacts").cloned(),
                        external: Some(truthy(need.get("pipeline")).or_else(|| truthy(need.get("project"))).is_some()),
                    }),
                })
                .collect::<LoadResult<Vec<_>>>()?,
        ),
    };

    let artifacts = cfg.get("artifacts").filter(|value| matches!(value, Value::Map(_)));
    let trigger_config = cfg.get("trigger");
    let trigger = match trigger_config {
        None => None,
        Some(value @ Value::String(_)) => Some(value.clone()),
        Some(Value::Null) => return Err(null_read("project")),
        Some(value) => Some(non_null(value.get("project")).cloned().unwrap_or_else(|| {
            Value::String(to_yaml(non_null(value.get("include")).unwrap_or(value)))
        })),
    };
    let when = non_null(cfg.get("when")).cloned().unwrap_or_else(|| Value::String("on_success".to_owned()));
    let rules = as_array(cfg.get("rules"));
    let manual = when.as_str() == Some("manual") || rules.iter().any(|rule| rule.get("when").and_then(Value::as_str) == Some("manual"));
    let services_source = non_null(cfg.get("services"))
        .or_else(|| if inherit_default { non_null(defaults.get("services")).or_else(|| globals.get("services")) } else { None });
    let tags_source = non_null(cfg.get("tags")).or_else(|| if inherit_default { defaults.get("tags") } else { None });
    let times = |count: &Value| ctx.t("{0} раз", &[&Ctx::arg(count)]);

    Ok(CiJob {
        id: name.to_owned(),
        name: name.to_owned(),
        stage: Some(non_null(cfg.get("stage")).map_or_else(|| "test".to_owned(), Value::js_string)),
        source: entry.source.clone(),
        line: entry.line,
        kind: if trigger_config.is_some() { CiJobKind::Trigger } else { CiJobKind::Job },
        when: Some(when),
        start_in: non_null(cfg.get("start_in")).cloned(),
        manual,
        allow_failure: Some(matches!(cfg.get("allow_failure"), Some(Value::Bool(true) | Value::Map(_)))),
        image: image_name(image),
        image_inherited,
        services: Some(as_array(services_source).into_iter().map(|service| image_name(Some(service)).unwrap_or_else(|| Value::String(service.js_string()))).collect()),
        tags: Some(strings(tags_source)),
        before_script: script_of(from_default("before_script")),
        script: cfg.get("script").map(|script| CiScript { lines: script_lines(Some(script)), inherited: None }),
        after_script: script_of(from_default("after_script")),
        rules: if truthy(cfg.get("rules")).is_some() { rules.iter().map(|rule| rule_text(ctx, rule)).collect() } else { Vec::new() },
        only: only_except_text(cfg.get("only")),
        except: only_except_text(cfg.get("except")),
        needs,
        dependencies: truthy(cfg.get("dependencies")).map(|value| strings(Some(value))),
        environment: environment(cfg.get("environment"), true),
        artifacts: artifacts.map(|artifacts| CiArtifacts {
            paths: strings(artifacts.get("paths")),
            expire: non_null(artifacts.get("expire_in")).cloned(),
            reports: match artifacts.get("reports") {
                Some(Value::Map(map)) => map.keys().cloned().collect(),
                _ => Vec::new(),
            },
            when: non_null(artifacts.get("when")).cloned(),
        }),
        cache: truthy(cfg.get("cache")).map(to_yaml),
        variables: variables_list(cfg.get("variables")),
        parallel: non_null(cfg.get("parallel")).map(|parallel| match parallel {
            Value::Map(_) => format!("matrix × {}", as_array(parallel.get("matrix")).len()),
            other => format!("× {}", other.js_string()),
        }),
        trigger,
        extends: chain,
        timeout: non_null(cfg.get("timeout")).cloned(),
        retry: non_null(cfg.get("retry")).map(|retry| match retry {
            Value::Map(_) => times(non_null(retry.get("max")).unwrap_or(&Value::String("?".to_owned()))),
            other => times(other),
        }),
        interruptible: non_null(cfg.get("interruptible")).cloned(),
        resource_group: non_null(cfg.get("resource_group")).cloned(),
        coverage: non_null(cfg.get("coverage")).cloned(),
        raw: to_yaml(cfg),
        own: Some(entry.config.as_map().map_or_else(Vec::new, |map| map.keys().cloned().collect())),
        rules_editable: Some(rules.iter().all(|rule| rule.as_map().is_some_and(|map| map.keys().all(|key| SIMPLE_RULE_KEYS.contains(&key.as_str()))))),
        rules_raw: Some(
            rules
                .iter()
                .filter(|rule| matches!(rule, Value::Map(_)))
                .map(|rule| CiRuleRaw {
                    condition: non_null(rule.get("if")).cloned().unwrap_or_else(|| Value::String(String::new())),
                    when: non_null(rule.get("when")).cloned().unwrap_or_else(|| Value::String("on_success".to_owned())),
                    allow_failure: matches!(rule.get("allow_failure"), Some(Value::Bool(true))),
                })
                .collect(),
        ),
        script_raw: cfg.get("script").map(|script| script_lines(Some(script))),
        needs_raw: cfg.get("needs").map(|needs| {
            as_array(Some(needs))
                .into_iter()
                .filter_map(|need| match need {
                    Value::String(_) => Some(need),
                    other => non_null(other.get("job")),
                })
                .filter(|job| job.truthy())
                .cloned()
                .collect()
        }),
        ..CiJob::default()
    })
}
