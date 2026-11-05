//! Общие части загрузчиков: чтение файлов с черновиками и преобразования значений из `electron/ci.cjs`.

use std::collections::HashMap;
use std::fmt::Display;
use std::fs;
use std::path::Path;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, Language};
use gorynych_core::paths;

use super::model::{CiEnvironment, CiFileError, CiJob, CiRule, CiSeverity, CiStage, CiVariable};
use crate::yaml::{ParsedYaml, Value, js_join};

const MAX_FILE_SIZE: u64 = 512 * 1024;

/// Текст ошибки, которую в 1.x бросал сам JS: загрузчик прерывается, и текст показывается как ошибка файла.
pub(crate) type LoadResult<T> = std::result::Result<T, String>;

/// Обращение к свойству `null`, как `TypeError` в V8.
pub(crate) fn null_read(property: &str) -> String {
    format!("Cannot read properties of null (reading '{property}')")
}

pub(crate) fn norm_rel(rel: &str) -> String {
    let path = rel.replace('\\', "/");
    let mut rest = path.as_str();
    loop {
        if let Some(next) = rest.strip_prefix("./").or_else(|| rest.strip_prefix('/')) {
            rest = next;
        } else {
            return rest.to_owned();
        }
    }
}

/// Папка репозитория, язык и черновики редактора.
pub(crate) struct Ctx<'a> {
    pub root: &'a Path,
    pub language: Language,
    pub drafts: Option<&'a HashMap<String, String>>,
}

impl Ctx<'_> {
    pub fn t(&self, msg: &str, args: &[&dyn Display]) -> String {
        i18n::tr(self.language, msg, args)
    }

    /// Аргумент `t()`: `null` становится пустой строкой.
    pub fn arg(value: &Value) -> String {
        if value.is_null() { String::new() } else { value.js_string() }
    }

    /// `readText`: черновик приоритетнее диска, файл больше 512 КБ — `TOO_LARGE`, BOM срезается.
    pub fn read_text(&self, rel: &str) -> Result<String> {
        if let Some(draft) = self.drafts.and_then(|drafts| drafts.get(&norm_rel(rel))) {
            return Ok(draft.strip_prefix('\u{FEFF}').unwrap_or(draft).to_owned());
        }
        let full = paths::safe_relative(self.root, rel, self.language)?;
        let io_error = |error: std::io::Error| GorynychError::new(ErrorCode::Unknown, error.to_string());
        let size = fs::metadata(&full).map_err(io_error)?.len();
        if size > MAX_FILE_SIZE {
            let kilobytes = (size as f64 / 1024.0).round();
            return Err(GorynychError::new(ErrorCode::TooLarge, self.t("Файл {0} слишком большой ({1} КБ)", &[&rel, &kilobytes])));
        }
        let bytes = fs::read(&full).map_err(io_error)?;
        let text = String::from_utf8_lossy(&bytes);
        Ok(text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_owned())
    }

    /// `errors` у `parseYaml`.
    pub fn file_errors(parsed: &ParsedYaml, file: &str) -> Vec<CiFileError> {
        parsed
            .errors
            .iter()
            .map(|issue| CiFileError { file: file.to_owned(), message: issue.message.clone(), line: issue.line, severity: CiSeverity::Error })
            .collect()
    }
}

/// `asArray`.
pub(crate) fn as_array(value: Option<&Value>) -> Vec<&Value> {
    match value {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Seq(items)) => items.iter().collect(),
        Some(other) => vec![other],
    }
}

/// `asArray(value).join(separator)`.
pub(crate) fn joined(value: Option<&Value>, separator: &str) -> String {
    js_join(as_array(value).into_iter(), separator)
}

/// `asArray(value).map(String)`.
pub(crate) fn strings(value: Option<&Value>) -> Vec<String> {
    as_array(value).into_iter().map(Value::js_string).collect()
}

/// `value ?? fallback`: `null` и отсутствие равны.
pub(crate) fn non_null(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| !value.is_null())
}

pub(crate) fn truthy(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| value.truthy())
}

pub(crate) fn is_map(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Map(_)))
}

/// Первая строка `String(value)`.
pub(crate) fn first_line(value: &Value) -> Value {
    let text = value.js_string();
    Value::String(text.split('\n').next().unwrap_or_default().to_owned())
}

/// `imageName`.
pub(crate) fn image_name(image: Option<&Value>) -> Option<Value> {
    let image = truthy(image)?;
    match image {
        Value::String(_) => Some(image.clone()),
        Value::Map(_) => non_null(image.get("name")).cloned(),
        _ => None,
    }
}

/// `deepMerge`: словари сливаются, всё остальное заменяется.
pub(crate) fn deep_merge(base: &Value, over: &Value) -> Value {
    let (Value::Map(base_map), Value::Map(over_map)) = (base, over) else { return over.clone() };
    let mut out = base_map.clone();
    for (key, value) in over_map.iter() {
        let merged = match base_map.get(key) {
            Some(existing) => deep_merge(existing, value),
            None => value.clone(),
        };
        out.insert(key.clone(), merged);
    }
    Value::Map(out)
}

/// Список `!reference`, если значение — настоящая ссылка. В 1.x свойство `__reference` со строкой или числом вело к падению (см. шапку `gitlab.rs`).
pub(crate) fn reference_of(value: &Value) -> Option<&[Value]> {
    value.get("__reference").and_then(Value::as_seq)
}

/// `scriptLines`.
pub(crate) fn script_lines(value: Option<&Value>) -> Vec<String> {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Null => {}
            Value::Seq(items) => items.iter().for_each(|item| walk(item, out)),
            _ => match reference_of(value) {
                Some(reference) => out.push(format!("!reference [{}]", js_join(reference.iter(), ", "))),
                None => out.push(value.js_string()),
            },
        }
    }
    let mut out = Vec::new();
    if let Some(value) = value {
        walk(value, &mut out);
    }
    out
}

/// `variablesList`.
pub(crate) fn variables_list(vars: Option<&Value>) -> Vec<CiVariable> {
    let Some(Value::Map(vars)) = vars else { return Vec::new() };
    vars.iter()
        .map(|(name, value)| {
            let text = |value: Option<&Value>| non_null(value).map_or_else(String::new, Value::js_string);
            match value {
                Value::Map(_) => CiVariable {
                    name: name.clone(),
                    value: text(value.get("value")),
                    description: non_null(value.get("description")).cloned(),
                    options: non_null(value.get("options")).cloned(),
                },
                other => CiVariable { name: name.clone(), value: text(Some(other)), ..CiVariable::default() },
            }
        })
        .collect()
}

/// Переменные Azure списком: элементы с истинным `name`.
pub(crate) fn name_value_list(items: &[Value]) -> Vec<CiVariable> {
    items
        .iter()
        .filter_map(|item| {
            let name = truthy(item.get("name"))?;
            let value = non_null(item.get("value")).map_or_else(String::new, Value::js_string);
            Some(CiVariable { name: name.js_string(), value, ..CiVariable::default() })
        })
        .collect()
}

/// `compact`.
pub(crate) fn compact(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Seq(items) => items.iter().map(compact).collect::<Vec<_>>().join(", "),
        Value::Map(map) => map
            .iter()
            .map(|(key, value)| if matches!(value, Value::Map(_)) { format!("{key} {}", compact(value)) } else { format!("{key}: {}", compact(value)) })
            .collect::<Vec<_>>()
            .join("; "),
        other => other.js_string(),
    }
}

/// `ruleText`.
pub(crate) fn rule_text(ctx: &Ctx<'_>, rule: &Value) -> CiRule {
    if !matches!(rule, Value::Map(_)) {
        return CiRule::text(rule.js_string());
    }
    let mut parts = Vec::new();
    if let Some(condition) = truthy(rule.get("if")) {
        parts.push(ctx.t("если {0}", &[&Ctx::arg(condition)]));
    }
    if let Some(changes) = truthy(rule.get("changes")) {
        let list = if is_map(Some(changes)) { joined(changes.get("paths"), ", ") } else { joined(Some(changes), ", ") };
        parts.push(ctx.t("изменены {0}", &[&list]));
    }
    if let Some(exists) = truthy(rule.get("exists")) {
        let list = if is_map(Some(exists)) { joined(exists.get("paths"), ", ") } else { joined(Some(exists), ", ") };
        parts.push(ctx.t("существует {0}", &[&list]));
    }
    if parts.is_empty() {
        parts.push(ctx.t("во всех остальных случаях", &[]));
    }
    let variables = match rule.get("variables") {
        Some(Value::Map(map)) => map.keys().cloned().collect(),
        _ => Vec::new(),
    };
    CiRule {
        text: parts.join(&ctx.t(" и ", &[])),
        when: Some(non_null(rule.get("when")).cloned().unwrap_or_else(|| Value::String("on_success".to_owned()))),
        allow_failure: non_null(rule.get("allow_failure")).cloned(),
        variables: Some(variables),
    }
}

/// Запись окружения в любом виде: у GitHub нет `action`, поэтому поле заполняет вызывающий.
pub(crate) fn environment(env: Option<&Value>, with_action: bool) -> Option<CiEnvironment> {
    let env = truthy(env)?;
    if matches!(env, Value::String(_)) {
        return Some(CiEnvironment { name: Some(env.clone()), ..CiEnvironment::default() });
    }
    Some(CiEnvironment {
        name: env.get("name").cloned(),
        url: non_null(env.get("url")).cloned(),
        action: if with_action { non_null(env.get("action")).cloned() } else { None },
    })
}

/// `levelize`: колонки по зависимостям, задания без зависимостей — в первой. Цикл даёт уровень 0.
pub(crate) fn levelize(ctx: &Ctx<'_>, jobs: Vec<CiJob>) -> Vec<CiStage> {
    fn deps(job: &CiJob) -> Vec<String> {
        job.needs.iter().flatten().map(|need| need.job.js_string()).collect()
    }
    fn visit(index: usize, jobs: &[CiJob], levels: &mut HashMap<String, usize>, stack: &mut Vec<String>) -> usize {
        let name = &jobs[index].name;
        if let Some(level) = levels.get(name) {
            return *level;
        }
        if stack.contains(name) {
            return 0;
        }
        let mut level = 0;
        stack.push(name.clone());
        for dep in deps(&jobs[index]) {
            if let Some(found) = jobs.iter().position(|job| job.name == dep) {
                level = level.max(visit(found, jobs, levels, stack) + 1);
            }
        }
        stack.pop();
        levels.insert(name.clone(), level);
        level
    }

    let mut levels = HashMap::new();
    for index in 0..jobs.len() {
        visit(index, &jobs, &mut levels, &mut Vec::new());
    }
    let max = levels.values().copied().max().unwrap_or(0);
    let mut columns: Vec<Vec<CiJob>> = vec![Vec::new(); max + 1];
    for job in jobs {
        let level = levels[&job.name];
        columns[level].push(job);
    }
    columns
        .into_iter()
        .enumerate()
        .filter(|(_, jobs)| !jobs.is_empty())
        .map(|(index, jobs)| {
            let name = if index == 0 { ctx.t("Старт", &[]) } else { ctx.t("После шага {0}", &[&index]) };
            CiStage::new(name, jobs)
        })
        .collect()
}

