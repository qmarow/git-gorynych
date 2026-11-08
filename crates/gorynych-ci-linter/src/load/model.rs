//! Что загрузчики отдают интерфейсу. Имена полей — как в 1.x.
//!
//! Поле типа [`Value`] — значение из файла как есть: 1.x передавал его без преобразования, и это может быть что угодно (например,
//! `timeout: 3600` или `timeout: 1h`). Поля, которых нет у данной системы, и `null` из 1.x здесь оба отсутствуют: интерфейс 1.x их не
//! различает. По той же причине `inherited: false` из 1.x здесь тоже отсутствует.

use serde::Serialize;

use crate::detect::CiSystem;
use crate::yaml::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CiSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiFileError {
    pub file: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub severity: CiSeverity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiFile {
    pub path: String,
    pub text: String,
    /// sha1 файла на диске; `None`, если файла нет.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiInclude {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiInfo {
    pub label: String,
    pub value: Value,
}

/// Правило или строка в списке триггеров: у триггера заполнен только `text`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiRule {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_failure: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Vec<String>>,
}

impl CiRule {
    pub(crate) fn text(text: impl Into<String>) -> Self {
        Self { text: text.into(), ..Self::default() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiRuleRaw {
    #[serde(rename = "if")]
    pub condition: Value,
    pub when: Value,
    pub allow_failure: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
pub struct CiVariable {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct CiScript {
    pub lines: Vec<String>,
    /// Откуда унаследовано: `default` или переведённое «глобально».
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiNeed {
    pub job: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
}

impl CiNeed {
    pub(crate) fn named(job: impl Into<String>) -> Self {
        Self { job: Value::String(job.into()), optional: None, artifacts: None, external: None }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
pub struct CiEnvironment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
pub struct CiArtifacts {
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expire: Option<Value>,
    pub reports: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiStep {
    pub name: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    #[serde(rename = "with", skip_serializing_if = "Option::is_none")]
    pub with_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CiJobKind {
    #[default]
    Job,
    Trigger,
}

/// Задание любой системы: набор заполненных полей зависит от загрузчика.
#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiJob {
    pub id: String,
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub kind: CiJobKind,
    pub manual: bool,
    pub rules: Vec<CiRule>,
    pub variables: Vec<CiVariable>,
    pub extends: Vec<String>,
    pub raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<Vec<CiNeed>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_inherited: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<CiScript>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_script: Option<CiScript>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<CiEnvironment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub services: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<CiArtifacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs_on_labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_failure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<CiStep>>,

    // GitLab
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_in: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_script: Option<CiScript>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub except: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruptible: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_group: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub own: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules_editable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules_raw: Option<Vec<CiRuleRaw>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_raw: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_raw: Option<Vec<Value>>,

    // GitHub
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs_on_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outputs: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiTemplate {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub source: String,
    pub raw: String,
    pub used_by: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiStage {
    pub name: Value,
    pub jobs: Vec<CiJob>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undeclared: Option<bool>,
}

impl CiStage {
    pub(crate) fn new(name: impl Into<String>, jobs: Vec<CiJob>) -> Self {
        Self { name: Value::String(name.into()), jobs, undeclared: None }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiPipeline {
    pub id: String,
    pub title: String,
    pub stages: Vec<CiStage>,
}

/// Результат загрузчика.
#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiConfig {
    pub files: Vec<CiFile>,
    pub errors: Vec<CiFileError>,
    pub warnings: Vec<String>,
    pub includes: Vec<CiInclude>,
    pub info: Vec<CiInfo>,
    pub triggers: Vec<CiRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggers_title: Option<String>,
    pub variables: Vec<CiVariable>,
    pub pipelines: Vec<CiPipeline>,
    pub templates: Vec<CiTemplate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme_unsupported: Option<bool>,
}

/// Коммит в истории файлов CI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Файл CI с незакоммиченными изменениями.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiDirtyFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiCurrent {
    pub system: String,
    pub title: String,
    pub file: String,
    pub job_count: u32,
    #[serde(flatten)]
    pub config: CiConfig,
    pub history: Vec<CiCommit>,
    pub dirty: Vec<CiDirtyFile>,
    pub check: crate::check::CiCheck,
}

/// Результат `loadCi`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct CiLoad {
    pub systems: Vec<CiSystem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<CiCurrent>,
}
