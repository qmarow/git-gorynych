//! Контракт типов для интерфейса: всё, что идёт через IPC, экспортируется в TypeScript с именами полей как в 1.x.

use gorynych_cicd::detect_server::DetectedServer;
use gorynych_cicd::gitlab::*;
use gorynych_cicd::models::*;
use gorynych_cicd::runner_setup::{DockerStatus, LocalRunner};
use gorynych_cicd::service::{LocalRunnerName, LocalRunnerStarted, LocalRunners, RunnerTagRequest, RunnersData, SecretsData, SettingsInput};
use specta::Types;
use specta_typescript::Typescript;

#[test]
fn everything_crossing_ipc_exports_to_typescript() {
    let types = Types::default()
        // Ответы единого слоя
        .register::<ForgeStatus>()
        .register::<LoginCheckResult>()
        .register::<WithCaps<ForgeInfo>>()
        .register::<WithCaps<PipelineList>>()
        .register::<WithCaps<PipelineDetail>>()
        .register::<WithCaps<JobLog>>()
        .register::<WithCaps<RunnersData>>()
        .register::<WithCaps<SecretsData>>()
        .register::<ActionResult>()
        .register::<RunResult>()
        .register::<RunForm>()
        .register::<RunnerResult>()
        .register::<PruneResult>()
        .register::<RunnerRegistration>()
        .register::<RunnerTagReport>()
        .register::<SecretResult>()
        .register::<CicdSettingsView>()
        .register::<LocalRunners>()
        .register::<LocalRunnerStarted>()
        .register::<LocalRunnerName>()
        .register::<DockerStatus>()
        .register::<LocalRunner>()
        .register::<DetectedServer>()
        // Каналы gitlab:*
        .register::<GlRemoteStatus>()
        .register::<GlPipelineList>()
        .register::<GlPipelineDetail>()
        .register::<GlJobLog>()
        .register::<GlActionResult>()
        .register::<GlVariableList>()
        .register::<GlVariableValue>()
        .register::<GlVariableSaved>()
        .register::<GlRunnerList>()
        .register::<GlLintResult>()
        .register::<GlScheduleList>()
        .register::<GlSchedule>()
        .register::<GlScheduleActionResult>()
        .register::<GlMergeRequest>()
        .register::<GlTokenList>()
        .register::<GlForgetResult>()
        // Что присылает интерфейс
        .register::<ActionRequest>()
        .register::<RunParams>()
        .register::<RunnerPatch>()
        .register::<RunnerRegisterOptions>()
        .register::<ArtifactRef>()
        .register::<SecretSave>()
        .register::<SecretRef>()
        .register::<RunnerTagRequest>()
        .register::<SettingsInput>()
        .register::<GlLintRequest>()
        .register::<GlVariableSave>()
        .register::<GlVariableRef>()
        .register::<GlScheduleInput>()
        .register::<GlScheduleAction>()
        .register::<GlMergeRequestInput>();

    let text = Typescript::default().export(&types, specta_serde::PhasesFormat).unwrap();
    for field in [
        "canListPipelines",
        "canManageVariables",
        "localRunner",
        "bySha",
        "canWrite",
        "runnerTags",
        "readOnlyLabels",
        "virtual",
        "detectedKind",
        "webUrl",
        "apiBase",
        "viaApiToken",
        "repoLogin",
        "allowCustomVariables",
        "maximumTimeout",
        "defaultApiBase",
        "lastPipeline",
        "nextRunAt",
    ] {
        assert!(text.contains(field), "нет поля {field} в типах");
    }
    assert!(!text.contains("can_list_pipelines"));
    assert!(!text.contains("web_url"));
}
