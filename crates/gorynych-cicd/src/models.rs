//! Единые модели CI/CD для интерфейса: `electron/cicd/models.cjs`. Ответы всех провайдеров приводятся к ним.
//!
//! ## Конспект
//! - `NO_CAPS` (22 флага) и `reasons`: почему функции нет — подсказка на выключенной кнопке.
//! - `githubStatus(status, conclusion)` и `bitbucketStatus(state)` — единый статус. `aggregate`: порядок важности, `failed` с `allowFailure` считается успехом, все `skipped` — `skipped`.
//! - `bySha`: последний пайплайн коммита. `platformFromLabels`: архитектура и ОС по меткам раннера.
//! - `runner(fields)`: имя по умолчанию `#id`, метки без повторов, `editable = editable !== false && !virtual`.
//!
//! Ответ сервера с `id: null` в 1.x превращался в запрос `/runners/null`; здесь такой запрос не отправляется: номера нет. Настоящие серверы так не отвечают.
//! Обязательное поле с `null` от сервера вообще (полная сверка: 36 из 4056 подмен): в тексте команд и адресов будет `undefined`, а не `null` (`--token undefined`, ключ `bySha`, `undefined.zip`); `readOnlyLabels` без `null`; неверный ключ секрета — `UNKNOWN` «Некорректный открытый ключ», а не `ERR_INVALID_ARG_TYPE`; задание без имени сортируется как пустая строка.
//!
//! Статусы остаются строками: GitLab передаётся как есть и может добавить новые значения. `null` и отсутствие поля на проводе не различаются: интерфейс 1.x сравнивает эти поля без учёта разницы.

use std::collections::BTreeMap;

use gorynych_core::i18n::t;
use gorynych_storage::credentials::{AuthMethod, LegacyCiUser, ServerKind};
use gorynych_storage::repo_providers::CiProvider;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json::{Json, JsonType, text};

/// Номер пайплайна, задания или раннера: у GitLab и GitHub число, у Bitbucket и виртуальных раннеров строка.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, specta::Type)]
#[serde(untagged)]
pub enum CiId {
    #[specta(type = f64)]
    Number(i64),
    Text(String),
}

impl<'de> Deserialize<'de> for CiId {
    /// Дробное число остаётся текстом: `Number(id)` даст то же значение, а проверка целого его отвергнет.
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        match &value {
            Value::Number(number) => Ok(number.as_i64().map_or_else(|| Self::Text(crate::json::js_string(&value)), Self::Number)),
            Value::String(text) => Ok(Self::Text(text.clone())),
            _ => Err(serde::de::Error::custom("ожидался номер или строка")),
        }
    }
}

impl CiId {
    pub fn from_json(value: &Value) -> Option<Self> {
        match value {
            Value::Number(number) => number.as_i64().map(Self::Number),
            Value::String(text) => Some(Self::Text(text.clone())),
            _ => None,
        }
    }

    pub fn field(value: &Value, key: &str) -> Option<Self> {
        value.get(key).and_then(Self::from_json)
    }

    /// `Number(id)`.
    pub fn number(&self) -> f64 {
        match self {
            Self::Number(number) => *number as f64,
            Self::Text(text) => {
                let trimmed = gorynych_core::js::trim(text);
                if trimmed.is_empty() { 0.0 } else { trimmed.parse().unwrap_or(f64::NAN) }
            }
        }
    }

    /// `${Number(id)}` для пути запроса.
    pub fn number_text(&self) -> String {
        gorynych_core::js::number_to_string(self.number())
    }

    /// `Number.isInteger(n) && n > 0`.
    pub fn is_positive_integer(&self) -> bool {
        let number = self.number();
        number.is_finite() && number.fract() == 0.0 && number > 0.0
    }
}

impl std::fmt::Display for CiId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(number) => write!(f, "{number}"),
            Self::Text(text) => f.write_str(text),
        }
    }
}

/// Возможности провайдера: что интерфейс показывает, а что прячет или выключает с подсказкой.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub can_list_pipelines: bool,
    pub can_run_pipeline: bool,
    pub can_run_with_inputs: bool,
    pub can_run_with_variables: bool,
    pub can_cancel: bool,
    pub can_retry: bool,
    pub can_retry_failed: bool,
    pub can_rerun_single_job: bool,
    pub can_cancel_job: bool,
    pub can_play_manual_job: bool,
    pub can_download_artifacts: bool,
    pub can_list_runners: bool,
    pub can_edit_runner_labels: bool,
    pub can_pause_runner: bool,
    pub can_edit_runner_settings: bool,
    pub can_delete_runner: bool,
    pub can_create_runner_token: bool,
    pub can_manage_secrets: bool,
    pub can_manage_variables: bool,
    pub has_schedules: bool,
    pub has_stages: bool,
    pub local_runner: bool,
    /// Почему функции нет: ключ — имя флага.
    pub why: Option<BTreeMap<String, String>>,
}

impl Capabilities {
    /// Подсказка для выключенной функции.
    pub fn reason(&self, cap: &str) -> Option<&str> {
        self.why.as_ref()?.get(cap).map(String::as_str)
    }
}

/// `reasons`: одна подсказка на несколько флагов.
pub fn reasons(label: &str, list: &[&str]) -> BTreeMap<String, String> {
    list.iter().map(|key| ((*key).to_owned(), t("{0} не даёт этого сделать через API", &[&label]))).collect()
}

/// Тот, кто запустил.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiActor {
    pub name: Option<String>,
    pub username: Option<String>,
}

/// Запуск пайплайна.
#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRun {
    pub id: Option<CiId>,
    pub number: Option<CiId>,
    pub iid: Option<CiId>,
    pub uuid: Option<String>,
    pub name: Option<String>,
    pub workflow: Option<String>,
    pub workflow_path: Option<String>,
    pub workflow_id: Option<CiId>,
    pub workflow_file: Option<String>,
    pub status: Option<String>,
    pub branch: Option<String>,
    pub sha: Option<String>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[specta(type = Option<f64>)]
    pub duration: Option<serde_json::Number>,
    #[specta(type = Option<f64>)]
    pub queued_duration: Option<serde_json::Number>,
    pub url: Option<String>,
    pub triggered_by: Option<CiActor>,
    pub source: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub coverage: Option<Json>,
    #[specta(type = Option<JsonType>)]
    pub yaml_errors: Option<Json>,
    #[specta(type = Option<f64>)]
    pub attempt: Option<i64>,
}

/// Шаг задания.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStep {
    #[specta(type = Option<f64>)]
    pub number: Option<serde_json::Number>,
    pub name: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    #[specta(type = Option<f64>)]
    pub duration: Option<u64>,
}

/// Дочерний пайплайн задания-триггера.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Downstream {
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub web_url: Option<String>,
    pub project_id: Option<CiId>,
    pub url: Option<String>,
}

/// Файл артефакта задания GitLab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct JobArtifactFile {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[specta(type = Option<f64>)]
    pub size: Option<serde_json::Number>,
}

/// Задание.
#[derive(Debug, Clone, PartialEq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineJob {
    pub id: Option<CiId>,
    pub kind: String,
    pub name: Option<String>,
    pub stage: Option<String>,
    pub status: Option<String>,
    pub runner_name: Option<String>,
    pub runner_id: Option<CiId>,
    pub runner_tags: Vec<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[specta(type = Option<f64>)]
    pub duration: Option<serde_json::Number>,
    #[specta(type = Option<f64>)]
    pub queued_duration: Option<serde_json::Number>,
    pub url: Option<String>,
    pub logs_url: Option<String>,
    pub allow_failure: bool,
    pub failure_reason: Option<String>,
    pub steps: Vec<PipelineStep>,
    pub manual: bool,
    pub when: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub coverage: Option<Json>,
    pub triggered_by: Option<CiActor>,
    pub downstream: Option<Downstream>,
    pub artifacts: Option<Vec<JobArtifactFile>>,
    pub run_id: Option<CiId>,
    pub pipeline_id: Option<CiId>,
    pub log_unavailable: Option<bool>,
}

/// Этап пайплайна.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct PipelineStage {
    pub name: Option<String>,
    pub status: String,
    pub jobs: Vec<PipelineJob>,
}

/// Артефакт.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiArtifact {
    pub id: Option<CiId>,
    pub job_id: Option<CiId>,
    pub job_name: Option<String>,
    pub name: Option<String>,
    pub file_name: Option<String>,
    #[specta(type = Option<f64>)]
    pub size: Option<serde_json::Number>,
    pub expired: bool,
    pub download_url: Option<String>,
    pub created_at: Option<String>,
}

/// Текущее задание раннера.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RunnerJob {
    pub id: Option<CiId>,
    pub name: Option<String>,
    pub pipeline_id: Option<CiId>,
    pub url: Option<String>,
}

/// Раннер.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiRunner {
    pub id: Option<CiId>,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub is_shared: bool,
    pub os: Option<String>,
    pub architecture: Option<String>,
    pub labels: Vec<String>,
    pub read_only_labels: Vec<String>,
    pub version: Option<String>,
    pub ip_address: Option<String>,
    pub current_job_id: Option<CiId>,
    pub current_job: Option<RunnerJob>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(rename = "virtual")]
    pub is_virtual: bool,
    pub run_untagged: Option<bool>,
    pub locked: Option<bool>,
    #[specta(type = Option<f64>)]
    pub maximum_timeout: Option<serde_json::Number>,
    pub contacted_at: Option<String>,
    pub stale: bool,
    pub editable: bool,
}

/// Поля раннера до нормализации: `editable: None` — как отсутствие поля.
#[derive(Debug, Clone, Default)]
pub struct RunnerFields {
    pub id: Option<CiId>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub editable: Option<bool>,
    pub runner: CiRunner,
}

/// `runner(fields)`.
pub fn runner(fields: RunnerFields) -> CiRunner {
    let RunnerFields { id, name, status, editable, mut runner } = fields;
    let mut labels: Vec<String> = Vec::with_capacity(runner.labels.len());
    for label in std::mem::take(&mut runner.labels) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    runner.name = name.unwrap_or_else(|| format!("#{}", id.as_ref().map_or_else(|| "undefined".to_owned(), ToString::to_string)));
    runner.id = id;
    runner.status = status.unwrap_or_else(|| "offline".to_owned());
    runner.labels = labels;
    runner.editable = editable != Some(false) && !runner.is_virtual;
    runner
}

/// Секрет или переменная.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiSecretVariable {
    pub key: Option<String>,
    pub uuid: Option<String>,
    pub secret: bool,
    pub masked: bool,
    pub environment_scope: Option<String>,
    pub value: Option<String>,
    pub updated_at: Option<String>,
    pub protected: Option<bool>,
}

/// Значок пайплайна в графе коммитов.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ShaBadge {
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub name: Option<String>,
}

/// `bySha`.
pub fn by_sha(pipelines: &[PipelineRun]) -> BTreeMap<String, ShaBadge> {
    let mut out = BTreeMap::new();
    for pipeline in pipelines {
        if let Some(sha) = pipeline.sha.as_ref().filter(|sha| !sha.is_empty()) {
            out.entry(sha.clone()).or_insert_with(|| ShaBadge {
                id: pipeline.id.clone(),
                status: pipeline.status.clone(),
                branch: pipeline.branch.clone(),
                url: pipeline.url.clone(),
                name: pipeline.name.clone(),
            });
        }
    }
    out
}

/// Список пайплайнов.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineList {
    pub pipelines: Vec<PipelineRun>,
    pub by_sha: BTreeMap<String, ShaBadge>,
    pub can_write: bool,
}

/// Лог задания.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct JobLog {
    pub job: Option<PipelineJob>,
    pub text: String,
    #[specta(type = f64)]
    pub size: u64,
    pub truncated: bool,
    pub unavailable: Option<bool>,
}

/// Результат действия.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Option<CiId>,
    pub status: Option<String>,
    pub web_url: Option<String>,
}

/// Новый запуск.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RunResult {
    pub id: Option<CiId>,
    pub url: Option<String>,
}

/// Результат изменения раннера.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RunnerResult {
    pub id: Option<CiId>,
}

/// Результат изменения секрета.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SecretResult {
    pub key: Option<String>,
}

/// Токен для нового раннера.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationToken {
    pub token: Option<String>,
    pub runner_id: Option<CiId>,
    pub expires_at: Option<String>,
    pub kind: String,
    pub url: Option<String>,
}

/// Команда для копирования.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RunnerCommand {
    pub id: String,
    pub label: String,
    pub shell: String,
    pub text: String,
}

/// Новый раннер с готовыми командами.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RunnerRegistration {
    #[serde(flatten)]
    pub token: RegistrationToken,
    pub labels: Vec<String>,
    pub name: String,
    pub provider: String,
    pub commands: Vec<RunnerCommand>,
}

/// Данные и то, что про них нужно знать интерфейсу: `withCaps`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct WithCaps<T> {
    #[serde(flatten)]
    pub data: T,
    pub provider: String,
    pub label: String,
    pub capabilities: Capabilities,
}

/// Вход репозитория в статусе токена.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TokenLogin {
    pub method: AuthMethod,
    pub username: Option<String>,
    pub shared: bool,
    pub via_api_token: bool,
}

/// Почему вход не подходит.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct LoginProblem {
    pub method: Option<AuthMethod>,
    pub reason: Option<String>,
}

/// Чем авторизован API: без секретов.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub configured: bool,
    pub source: Option<String>,
    pub pending: Option<bool>,
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub saved_at: Option<String>,
    pub login: Option<TokenLogin>,
    pub repo_login: Option<LoginProblem>,
    pub unreadable: Option<bool>,
    pub repo_key: Option<String>,
}

/// Настройки CI/CD репозитория в статусе.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForgeSettings {
    pub provider: Option<CiProvider>,
    pub api_base: Option<String>,
}

/// Провайдер CI/CD репозитория и состояние авторизации.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatus {
    pub kind: Option<CiProvider>,
    pub provider: Option<CiProvider>,
    pub label: Option<String>,
    pub remote: String,
    pub url: String,
    pub protocol: String,
    pub host: String,
    pub base: String,
    pub path: String,
    pub web_url: Option<String>,
    pub api_base: Option<String>,
    pub token: TokenStatus,
    pub capabilities: Capabilities,
    pub settings: Option<ForgeSettings>,
    pub detected_kind: Option<ServerKind>,
}

/// Итог проверки входа.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LoginCheckResult {
    pub state: String,
    pub reason: Option<String>,
    pub user: Option<LegacyCiUser>,
    pub scopes: Option<Vec<String>>,
    pub method: Option<AuthMethod>,
    pub via_api_token: Option<bool>,
}

/// `info`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForgeInfo {
    pub web_url: Option<String>,
    pub default_branch: Option<String>,
}

/// Подробности запуска.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDetail {
    pub pipeline: Option<PipelineRun>,
    pub stages: Vec<PipelineStage>,
    pub artifacts: Vec<CiArtifact>,
    pub can_write: bool,
}

/// Удаление раннеров не в сети.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PruneResult {
    pub removed: Vec<PrunedRunner>,
    pub failed: Vec<PrunedRunner>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PrunedRunner {
    pub id: Option<CiId>,
    pub name: String,
    pub error: Option<String>,
}

/// Поле формы запуска.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct InputField {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub description: Option<String>,
    pub required: bool,
    pub default: gorynych_ci_linter::yaml::Value,
    pub options: Option<Vec<String>>,
}

/// Что можно запустить.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct RunWorkflow {
    pub path: Option<String>,
    pub name: String,
    pub value: Option<String>,
    pub dispatchable: bool,
    pub inputs: Vec<InputField>,
}

/// Переменная GitLab, которую предлагают при ручном запуске.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RunVariableField {
    pub key: String,
    pub description: String,
    pub default: String,
    pub options: Option<Vec<String>>,
}

/// Форма запуска.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RunForm {
    pub kind: String,
    pub workflows: Vec<RunWorkflow>,
    pub inputs: Option<Vec<InputField>>,
    pub variables: Vec<RunVariableField>,
    pub allow_custom_variables: bool,
}

/// Настройки CI/CD для интерфейса.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CicdSettingsView {
    pub host: String,
    pub path: String,
    pub detected: Option<String>,
    pub provider: Option<CiProvider>,
    pub api_base: Option<String>,
    pub effective: Option<CiProvider>,
    pub default_api_base: Option<String>,
}

/// Сверка тегов с раннерами.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RunnerTagReport {
    pub available: bool,
    pub reason: Option<String>,
    pub issues: Vec<gorynych_ci_linter::check::tags::CiRunnerIssue>,
    pub labels: Vec<String>,
    #[specta(type = Option<f64>)]
    pub runners: Option<u32>,
    #[specta(type = Option<f64>)]
    pub live: Option<u32>,
    pub provider: Option<String>,
}

/* ---------- Что присылает интерфейс ---------- */

/// `{ type, id, ref }`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ActionRequest {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub id: Option<CiId>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
}

/// Переменная запуска.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunVariable {
    pub key: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub value: Option<Json>,
    pub file: bool,
    pub secured: bool,
}

/// Параметры запуска.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunParams {
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub workflow: Option<String>,
    #[specta(type = Option<BTreeMap<String, JsonType>>)]
    pub inputs: Option<serde_json::Map<String, Json>>,
    pub variables: Option<Vec<RunVariable>>,
}

/// Различает отсутствие поля и `null`.
pub(crate) fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Что меняется в раннере.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct RunnerPatch {
    #[specta(type = Option<Vec<JsonType>>)]
    pub labels: Option<Vec<Json>>,
    pub paused: Option<bool>,
    pub run_untagged: Option<bool>,
    pub locked: Option<bool>,
    pub description: Option<String>,
    /// `None` — поля нет, `Some(None)` — сбросить.
    #[serde(deserialize_with = "double_option")]
    #[specta(type = Option<Option<JsonType>>)]
    pub maximum_timeout: Option<Option<Json>>,
}

/// Параметры нового раннера.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct RunnerRegisterOptions {
    #[specta(type = Vec<JsonType>)]
    pub labels: Vec<Json>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub run_untagged: Option<bool>,
    pub locked: Option<bool>,
    pub paused: Option<bool>,
}

/// Артефакт для скачивания.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct ArtifactRef {
    pub id: Option<CiId>,
    pub job_id: Option<CiId>,
}

/// Секрет при сохранении и удалении.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct SecretRef {
    pub key: Option<String>,
    pub secret: bool,
    pub uuid: Option<String>,
}

/// Сохранение секрета.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct SecretSave {
    pub key: Option<String>,
    #[specta(type = Option<JsonType>)]
    pub value: Option<Json>,
    pub secret: bool,
    pub original: Option<SecretRef>,
}

/// Секрет после проверки.
#[derive(Debug, Clone)]
pub struct SecretInput {
    pub key: String,
    pub value: String,
    pub secret: bool,
    pub original: Option<SecretRef>,
}

/// Новая задача запуска.
#[derive(Debug, Clone, Default)]
pub struct RunInput {
    pub reference: String,
    pub workflow: Option<String>,
    pub inputs: serde_json::Map<String, Json>,
    pub variables: Vec<RunVariable>,
}

/* ---------- Статусы ---------- */

/// `githubStatus`: GitHub и Gitea.
pub fn github_status(status: Option<&str>, conclusion: Option<&str>) -> &'static str {
    let s = status.unwrap_or_default().to_lowercase();
    let c = conclusion.unwrap_or_default().to_lowercase();
    if s == "completed" || !c.is_empty() {
        match c.as_str() {
            "success" | "neutral" => return "success",
            "failure" | "timed_out" | "startup_failure" => return "failed",
            "cancelled" | "stale" => return "canceled",
            "skipped" => return "skipped",
            "action_required" => return "manual",
            _ if s == "completed" => return "success",
            _ => {}
        }
    }
    match s.as_str() {
        "success" => "success",
        "failure" | "failed" => "failed",
        "cancelled" | "canceled" => "canceled",
        "skipped" => "skipped",
        "in_progress" | "running" => "running",
        "blocked" => "manual",
        _ => "pending",
    }
}

/// `bitbucketStatus`.
pub fn bitbucket_status(state: Option<&Value>) -> &'static str {
    let name = |value: Option<&Value>| value.and_then(|item| text(item, "name")).unwrap_or_default().to_uppercase();
    let n = name(state);
    let r = name(state.and_then(|item| item.get("result")));
    let st = name(state.and_then(|item| item.get("stage")));
    match n.as_str() {
        "COMPLETED" => match r.as_str() {
            "FAILED" | "ERROR" => "failed",
            "STOPPED" | "EXPIRED" => "canceled",
            "NOT_RUN" | "SKIPPED" => "skipped",
            _ => "success",
        },
        "IN_PROGRESS" | "RUNNING" => {
            if st == "PAUSED" || st == "HALTED" {
                "manual"
            } else {
                "running"
            }
        }
        "HALTED" | "PAUSED" => "manual",
        _ => "pending",
    }
}

const ORDER: [&str; 12] = ["failed", "running", "pending", "preparing", "waiting_for_resource", "scheduled", "manual", "canceling", "canceled", "created", "success", "skipped"];

/// `aggregate`: статус этапа по заданиям `(status, allowFailure)`.
pub fn aggregate<'a>(jobs: impl Iterator<Item = (Option<&'a str>, bool)>) -> String {
    let statuses: Vec<Option<&str>> = jobs.map(|(status, allow)| if status == Some("failed") && allow { Some("success") } else { status }).collect();
    if !statuses.is_empty() && statuses.iter().all(|status| *status == Some("skipped")) {
        return "skipped".to_owned();
    }
    for candidate in ORDER {
        if statuses.contains(&Some(candidate)) {
            return if candidate == "skipped" { "success" } else { candidate }.to_owned();
        }
    }
    "created".to_owned()
}

/// `platformFromLabels`: `(os, architecture)`.
pub fn platform_from_labels(labels: &[String], os: Option<&str>) -> (Option<String>, Option<&'static str>) {
    let low: Vec<String> = labels.iter().map(|label| label.to_lowercase()).collect();
    let any = |test: &dyn Fn(&str) -> bool| low.iter().any(|label| test(label));
    let arch = if any(&|l| matches!(l, "x64" | "amd64" | "x86_64")) {
        Some("x64")
    } else if any(&|l| matches!(l, "arm64" | "aarch64") || l.ends_with("-arm")) {
        Some("arm64")
    } else if any(&|l| l == "arm") {
        Some("arm")
    } else {
        None
    };
    let mut platform = os.filter(|item| !item.is_empty()).map(str::to_lowercase);
    if platform.is_none() {
        if any(&|l| l.contains("windows")) {
            platform = Some("windows".to_owned());
        } else if any(&|l| l.contains("macos") || l.contains("osx") || l.contains("darwin")) {
            platform = Some("macos".to_owned());
        } else if any(&|l| ["linux", "ubuntu", "debian", "alpine", "docker"].iter().any(|word| l.contains(word))) {
            platform = Some("linux".to_owned());
        }
    }
    if matches!(platform.as_deref(), Some("darwin" | "osx")) {
        platform = Some("macos".to_owned());
    }
    (platform, arch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn github_status_table() {
        let cases = [
            (Some("completed"), Some("success"), "success"),
            (Some("completed"), Some("neutral"), "success"),
            (Some("completed"), Some("timed_out"), "failed"),
            (Some("completed"), Some("stale"), "canceled"),
            (Some("completed"), Some("action_required"), "manual"),
            (Some("completed"), Some("что-то"), "success"),
            (Some("in_progress"), None, "running"),
            (Some("failure"), None, "failed"),
            (Some("blocked"), None, "manual"),
            (Some("queued"), None, "pending"),
            (None, Some("странный"), "pending"),
        ];
        for (status, conclusion, expected) in cases {
            assert_eq!(github_status(status, conclusion), expected, "{status:?} {conclusion:?}");
        }
    }

    #[test]
    fn bitbucket_status_table() {
        let cases = [
            (json!({"name":"COMPLETED","result":{"name":"SUCCESSFUL"}}), "success"),
            (json!({"name":"COMPLETED","result":{"name":"ERROR"}}), "failed"),
            (json!({"name":"COMPLETED","result":{"name":"EXPIRED"}}), "canceled"),
            (json!({"name":"COMPLETED"}), "success"),
            (json!({"name":"IN_PROGRESS","stage":{"name":"HALTED"}}), "manual"),
            (json!({"name":"RUNNING"}), "running"),
            (json!({"name":"READY"}), "pending"),
        ];
        for (state, expected) in cases {
            assert_eq!(bitbucket_status(Some(&state)), expected, "{state}");
        }
        assert_eq!(bitbucket_status(None), "pending");
    }

    #[test]
    fn aggregate_follows_priority() {
        let run = |jobs: &[(&'static str, bool)]| aggregate(jobs.iter().map(|(status, allow)| (Some(*status), *allow)));
        assert_eq!(run(&[("failed", true)]), "success");
        assert_eq!(run(&[("failed", false), ("running", false)]), "failed");
        assert_eq!(run(&[("skipped", false), ("skipped", false)]), "skipped");
        assert_eq!(run(&[("skipped", false), ("success", false)]), "success");
        assert_eq!(run(&[("неизвестный", false)]), "created");
        assert_eq!(run(&[]), "created");
    }

    #[test]
    fn platform_by_labels() {
        let labels = |list: &[&str]| list.iter().map(|item| (*item).to_owned()).collect::<Vec<_>>();
        assert_eq!(platform_from_labels(&labels(&["self-hosted", "Linux", "X64"]), None), (Some("linux".into()), Some("x64")));
        assert_eq!(platform_from_labels(&labels(&["ubuntu-24.04-arm"]), None), (Some("linux".into()), Some("arm64")));
        assert_eq!(platform_from_labels(&labels(&["osx"]), Some("Darwin")), (Some("macos".into()), None));
    }

    #[test]
    fn id_converts_like_number() {
        assert!(CiId::Text("12".into()).is_positive_integer());
        assert!(!CiId::Text("1.5".into()).is_positive_integer());
        assert!(!CiId::Number(0).is_positive_integer());
        assert_eq!(CiId::Text("abc".into()).number_text(), "NaN");
    }

    #[test]
    fn runner_defaults() {
        let built = runner(RunnerFields { id: Some(CiId::Number(5)), runner: CiRunner { labels: vec!["a".into(), "a".into(), "b".into()], is_virtual: true, ..CiRunner::default() }, ..RunnerFields::default() });
        assert_eq!(built.name, "#5");
        assert_eq!(built.status, "offline");
        assert_eq!(built.labels, ["a", "b"]);
        assert!(!built.editable);
    }
}
