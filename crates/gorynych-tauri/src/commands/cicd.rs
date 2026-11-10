//! Команды `cicd:*` и `gitlab:*`: перенос раздела «GitLab API» и «CI/CD любого провайдера» из `electron/main.cjs`.
//!
//! # Конспект исходника
//! - Почти все обработчики обёрнуты в `gl`: `resolveRepoRoot(dir)`, затем функция `cicd/index.cjs` или `gitlab.cjs`.
//!   Исключения — `cicd:local-runner-stop` и `cicd:local-runner-resume` (принимают только имя контейнера) и `cicd:show-file`.
//! - `remoteOpt(opts)`: `opts.remote` — строка, иначе `undefined`. `cicd:pipelines` и `gitlab:pipelines` дополнительно берут
//!   `opts.ref`, `cicd:job-log` — `opts.pipelineId`; `gitlab:job-log` номер пайплайна не принимает.
//! - Тело запроса: `data ?? {}` (`settings-save`, `run`, `runner-*`, `local-runner-start`, `secret-*`, `variable-*`, `schedule-*`,
//!   `create-mr`, `lint`). `runner-update` — `{id, patch}`, `runner-delete` — `{id}`, `runners-prune` — `{ids = null}`,
//!   `local-runner-start` — `{labels = []}`. Номер без значения в 1.x доходил до адаптера как `undefined`: здесь это строка `undefined`,
//!   как в эталоне `gorynych-cicd`.
//! - `cicd:artifact-download`: имя файла `fileName` или `<name>.zip` с заменой `[\\/:*?"<>|]+` на `_`, диалог сохранения в «Загрузки»
//!   (отмена → `{canceled: true}`), затем `artifactDownload` и `{...out, name}`.
//!
//! # Отличия от 1.x
//! - Ошибка — отклонённый promise, а не `{ok:false, error}` (см. шапку `lib.rs`); форму аргументов проверяет Tauri.
//! - Не перенесены `gitlab:set-token` и `gitlab:clear-token`: в `src/` их не вызывают, функций нет и в `gorynych-cicd`
//!   (шапка `gitlab/mod.rs`).
//! - `cicd:artifact-download` и `cicd:show-file` — в `commands::desktop`: им нужны диалог сохранения и Проводник.
//! - Ответы с возможностями провайдера (`withCaps`) — шесть конкретных типов [`ForgeInfoWithCaps`] и т. п. той же формы, что
//!   `models::WithCaps<T>`: `specta` rc.26 не подставляет `T` в обобщённую структуру с `flatten`, и в `bindings/commands.ts` оставалось `WithCaps<T>`.

use std::path::{Path, PathBuf};

use gorynych_cicd::gitlab::{
    GlActionResult, GlJobLog, GlLintRequest, GlLintResult, GlMergeRequest, GlMergeRequestInput, GlPipelineDetail, GlPipelineList, GlRemoteStatus, GlRunnerList, GlSchedule,
    GlScheduleAction, GlScheduleActionResult, GlScheduleInput, GlScheduleList, GlVariableList, GlVariableRef, GlVariableSave, GlVariableSaved, GlVariableValue,
};
use gorynych_cicd::json::{Json, JsonType};
use gorynych_cicd::models::{
    ActionRequest, ActionResult, Capabilities, CiId, CicdSettingsView, ForgeInfo, ForgeStatus, JobLog, PipelineDetail, PipelineList, PruneResult, RunForm, RunParams, RunResult, RunnerPatch,
    RunnerRegisterOptions, RunnerRegistration, RunnerResult, RunnerTagReport, SecretRef, SecretResult, SecretSave, WithCaps,
};
use gorynych_cicd::service::{LocalRunnerName, LocalRunnerStarted, LocalRunners, RunnerTagRequest, RunnersData, SecretsData, SettingsInput};
use gorynych_core::error::Result;
use gorynych_git::read::resolve_repo_root;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

/* ---------- Ответы с возможностями провайдера ---------- */

/// Конкретный тип вместо `WithCaps<T>` для `bindings/commands.ts` (см. шапку). Поля и порядок — как у `models::WithCaps`.
macro_rules! with_caps {
    ($($name:ident($inner:ty);)+) => {$(
        #[doc = concat!("`WithCaps<", stringify!($inner), ">`: данные и возможности провайдера.")]
        #[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
        pub struct $name {
            #[serde(flatten)]
            pub data: $inner,
            pub provider: String,
            pub label: String,
            pub capabilities: Capabilities,
        }

        impl From<WithCaps<$inner>> for $name {
            fn from(value: WithCaps<$inner>) -> Self {
                Self { data: value.data, provider: value.provider, label: value.label, capabilities: value.capabilities }
            }
        }
    )+};
}

with_caps! {
    ForgeInfoWithCaps(ForgeInfo);
    PipelineListWithCaps(PipelineList);
    PipelineDetailWithCaps(PipelineDetail);
    JobLogWithCaps(JobLog);
    RunnersWithCaps(RunnersData);
    SecretsWithCaps(SecretsData);
}

/* ---------- Параметры ---------- */

/// `opts` большинства команд: remote, к которому обращаться (иначе — upstream текущей ветки или `origin`).
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RemoteOptions {
    pub remote: Option<String>,
}

/// `opts` команд `cicd:pipelines` и `gitlab:pipelines`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct PipelinesOptions {
    pub remote: Option<String>,
    /// Только пайплайны этой ветки.
    #[serde(rename = "ref")]
    pub reference: Option<String>,
}

/// `opts` команды `cicd:job-log`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct JobLogOptions {
    pub remote: Option<String>,
    /// Bitbucket и Gitea находят шаг только вместе с пайплайном.
    pub pipeline_id: Option<CiId>,
}

/// Тело `cicd:runner-update`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunnerUpdateRequest {
    pub id: Option<CiId>,
    pub patch: Option<RunnerPatch>,
}

/// Тело `cicd:runner-delete`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunnerDeleteRequest {
    pub id: Option<CiId>,
}

/// Тело `cicd:runners-prune`: без `ids` — все подходящие раннеры не в сети.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RunnersPruneRequest {
    pub ids: Option<Vec<CiId>>,
}

/// Тело `cicd:local-runner-start`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct LocalRunnerStartRequest {
    #[specta(type = Vec<JsonType>)]
    pub labels: Vec<Json>,
}

/* ---------- Вспомогательное ---------- */

async fn root_of(dir: &str) -> Result<PathBuf> {
    resolve_repo_root(Path::new(dir)).await
}

/// Номер, которого нет: в 1.x он доходил до адаптера как `undefined`.
fn id_or_undefined(id: Option<CiId>) -> CiId {
    id.unwrap_or_else(|| CiId::Text("undefined".to_owned()))
}

fn remote(opts: &Option<RemoteOptions>) -> Option<&str> {
    opts.as_ref().and_then(|opts| opts.remote.as_deref())
}

/* ---------- cicd:* ---------- */

#[tauri::command]
#[specta::specta]
pub async fn cicd_status(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<Option<ForgeStatus>> {
    let cicd = &state.services()?.cicd;
    cicd.detect(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_info(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<ForgeInfoWithCaps> {
    let cicd = &state.services()?.cicd;
    cicd.info(&root_of(&dir).await?, remote(&opts)).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_settings(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<Option<CicdSettingsView>> {
    let cicd = &state.services()?.cicd;
    Ok(cicd.get_settings(&root_of(&dir).await?, remote(&opts)).await)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_settings_save(state: State<'_, AppState>, dir: String, data: Option<SettingsInput>, opts: Option<RemoteOptions>) -> Result<Option<CicdSettingsView>> {
    let cicd = &state.services()?.cicd;
    cicd.set_settings(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_pipelines(state: State<'_, AppState>, dir: String, opts: Option<PipelinesOptions>) -> Result<PipelineListWithCaps> {
    let cicd = &state.services()?.cicd;
    let opts = opts.unwrap_or_default();
    cicd.pipelines(&root_of(&dir).await?, opts.reference.as_deref(), opts.remote.as_deref()).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_pipeline(state: State<'_, AppState>, dir: String, id: Option<CiId>, opts: Option<RemoteOptions>) -> Result<PipelineDetailWithCaps> {
    let cicd = &state.services()?.cicd;
    cicd.pipeline(&root_of(&dir).await?, &id_or_undefined(id), remote(&opts)).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_job_log(state: State<'_, AppState>, dir: String, id: Option<CiId>, opts: Option<JobLogOptions>) -> Result<JobLogWithCaps> {
    let cicd = &state.services()?.cicd;
    let opts = opts.unwrap_or_default();
    cicd.job_log(&root_of(&dir).await?, &id_or_undefined(id), opts.pipeline_id.as_ref(), opts.remote.as_deref()).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_action(state: State<'_, AppState>, dir: String, action: Option<ActionRequest>, opts: Option<RemoteOptions>) -> Result<ActionResult> {
    let cicd = &state.services()?.cicd;
    cicd.action(&root_of(&dir).await?, &action.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_run(state: State<'_, AppState>, dir: String, params: Option<RunParams>, opts: Option<RemoteOptions>) -> Result<RunResult> {
    let cicd = &state.services()?.cicd;
    cicd.run(&root_of(&dir).await?, &params.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_run_form(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<RunForm> {
    let cicd = &state.services()?.cicd;
    Ok(cicd.run_form(&root_of(&dir).await?, remote(&opts)).await)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_runners(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<RunnersWithCaps> {
    let cicd = &state.services()?.cicd;
    cicd.runners(&root_of(&dir).await?, remote(&opts)).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_runner_update(state: State<'_, AppState>, dir: String, data: Option<RunnerUpdateRequest>, opts: Option<RemoteOptions>) -> Result<RunnerResult> {
    let cicd = &state.services()?.cicd;
    let data = data.unwrap_or_default();
    cicd.runner_update(&root_of(&dir).await?, &id_or_undefined(data.id), &data.patch.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_runner_delete(state: State<'_, AppState>, dir: String, data: Option<RunnerDeleteRequest>, opts: Option<RemoteOptions>) -> Result<RunnerResult> {
    let cicd = &state.services()?.cicd;
    cicd.runner_delete(&root_of(&dir).await?, &id_or_undefined(data.unwrap_or_default().id), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_runners_prune(state: State<'_, AppState>, dir: String, data: Option<RunnersPruneRequest>, opts: Option<RemoteOptions>) -> Result<PruneResult> {
    let cicd = &state.services()?.cicd;
    let ids = data.unwrap_or_default().ids;
    cicd.runners_prune(&root_of(&dir).await?, ids.as_deref(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_runner_register(state: State<'_, AppState>, dir: String, data: Option<RunnerRegisterOptions>, opts: Option<RemoteOptions>) -> Result<RunnerRegistration> {
    let cicd = &state.services()?.cicd;
    cicd.runner_register(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

/// Сверка тегов и меток из файла CI (с черновиками) с живыми раннерами.
#[tauri::command]
#[specta::specta]
pub async fn cicd_runner_tags(state: State<'_, AppState>, dir: String, data: Option<RunnerTagRequest>, opts: Option<RemoteOptions>) -> Result<RunnerTagReport> {
    let cicd = &state.services()?.cicd;
    cicd.runner_tag_check(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_local_runners(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<LocalRunners> {
    let cicd = &state.services()?.cicd;
    cicd.local_runners(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_local_runner_start(state: State<'_, AppState>, dir: String, data: Option<LocalRunnerStartRequest>, opts: Option<RemoteOptions>) -> Result<LocalRunnerStarted> {
    let cicd = &state.services()?.cicd;
    cicd.local_runner_start(&root_of(&dir).await?, &data.unwrap_or_default().labels, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_local_runner_stop(state: State<'_, AppState>, name: String) -> Result<LocalRunnerName> {
    state.services()?.cicd.local_runner_stop(&name).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_local_runner_resume(state: State<'_, AppState>, name: String) -> Result<LocalRunnerName> {
    state.services()?.cicd.local_runner_resume(&name).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_secrets(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<SecretsWithCaps> {
    let cicd = &state.services()?.cicd;
    cicd.secrets(&root_of(&dir).await?, remote(&opts)).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_secret_save(state: State<'_, AppState>, dir: String, data: Option<SecretSave>, opts: Option<RemoteOptions>) -> Result<SecretResult> {
    let cicd = &state.services()?.cicd;
    cicd.secret_save(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cicd_secret_delete(state: State<'_, AppState>, dir: String, data: Option<SecretRef>, opts: Option<RemoteOptions>) -> Result<SecretResult> {
    let cicd = &state.services()?.cicd;
    cicd.secret_delete(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

/* ---------- gitlab:* ---------- */

#[tauri::command]
#[specta::specta]
pub async fn gitlab_status(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<Option<GlRemoteStatus>> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_detect_remote(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_pipelines(state: State<'_, AppState>, dir: String, opts: Option<PipelinesOptions>) -> Result<GlPipelineList> {
    let cicd = &state.services()?.cicd;
    let opts = opts.unwrap_or_default();
    cicd.gitlab_pipelines(&root_of(&dir).await?, opts.reference.as_deref(), opts.remote.as_deref()).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_pipeline(state: State<'_, AppState>, dir: String, id: Option<CiId>, opts: Option<RemoteOptions>) -> Result<GlPipelineDetail> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_pipeline(&root_of(&dir).await?, &id_or_undefined(id), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_job_log(state: State<'_, AppState>, dir: String, id: Option<CiId>, opts: Option<RemoteOptions>) -> Result<GlJobLog> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_job_log(&root_of(&dir).await?, &id_or_undefined(id), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_action(state: State<'_, AppState>, dir: String, action: Option<ActionRequest>, opts: Option<RemoteOptions>) -> Result<GlActionResult> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_action(&root_of(&dir).await?, &action.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_variables(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<GlVariableList> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_variables(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_variable_value(state: State<'_, AppState>, dir: String, variable: Option<GlVariableRef>, opts: Option<RemoteOptions>) -> Result<GlVariableValue> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_variable_value(&root_of(&dir).await?, &variable.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_runners(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<GlRunnerList> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_runners(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_lint(state: State<'_, AppState>, dir: String, draft: Option<GlLintRequest>, opts: Option<RemoteOptions>) -> Result<GlLintResult> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_lint(&root_of(&dir).await?, &draft.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_variable_save(state: State<'_, AppState>, dir: String, data: Option<GlVariableSave>, opts: Option<RemoteOptions>) -> Result<GlVariableSaved> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_save_variable(&root_of(&dir).await?, &data.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_variable_delete(state: State<'_, AppState>, dir: String, variable: Option<GlVariableRef>, opts: Option<RemoteOptions>) -> Result<GlVariableSaved> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_delete_variable(&root_of(&dir).await?, &variable.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_schedules(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<GlScheduleList> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_schedules(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_schedule_save(state: State<'_, AppState>, dir: String, schedule: Option<GlScheduleInput>, opts: Option<RemoteOptions>) -> Result<GlSchedule> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_save_schedule(&root_of(&dir).await?, &schedule.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_schedule_action(state: State<'_, AppState>, dir: String, action: Option<GlScheduleAction>, opts: Option<RemoteOptions>) -> Result<GlScheduleActionResult> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_schedule_action(&root_of(&dir).await?, &action.unwrap_or_default(), remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn gitlab_create_mr(state: State<'_, AppState>, dir: String, mr: Option<GlMergeRequestInput>, opts: Option<RemoteOptions>) -> Result<GlMergeRequest> {
    let cicd = &state.services()?.cicd;
    cicd.gitlab_create_merge_request(&root_of(&dir).await?, &mr.unwrap_or_default(), remote(&opts)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Параметры приходят из интерфейса 1.x в той же форме.
    #[test]
    fn options_and_bodies_accept_1x_shapes() {
        let opts: PipelinesOptions = serde_json::from_str(r#"{"remote":"upstream","ref":"main"}"#).unwrap();
        assert_eq!((opts.remote.as_deref(), opts.reference.as_deref()), (Some("upstream"), Some("main")));
        let opts: JobLogOptions = serde_json::from_str(r#"{"pipelineId":"{a-b}"}"#).unwrap();
        assert_eq!(opts.pipeline_id, Some(CiId::Text("{a-b}".to_owned())));
        let opts: RemoteOptions = serde_json::from_str(r#"{"remote":null,"лишнее":1}"#).unwrap();
        assert_eq!(opts.remote, None);

        let update: RunnerUpdateRequest = serde_json::from_str(r#"{"id":12,"patch":{"paused":true,"maximumTimeout":null}}"#).unwrap();
        assert_eq!(update.id, Some(CiId::Number(12)));
        let patch = update.patch.unwrap();
        assert_eq!(patch.paused, Some(true));
        assert!(matches!(patch.maximum_timeout, Some(None)), "null — сбросить, а не «поля нет»");
        let prune: RunnersPruneRequest = serde_json::from_str("{}").unwrap();
        assert!(prune.ids.is_none(), "без ids — все раннеры не в сети");
        let start: LocalRunnerStartRequest = serde_json::from_str(r#"{"labels":["docker",1]}"#).unwrap();
        assert_eq!(start.labels.len(), 2);
        assert_eq!(id_or_undefined(None), CiId::Text("undefined".to_owned()));
    }
}
