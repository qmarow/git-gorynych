//! Адаптеры провайдеров: `electron/cicd/{gitlab,github,gitea,bitbucket}.cjs`.
//!
//! В 1.x адаптер — объект: чего у него нет, вызов падает с `TypeError` (`adapter.saveSecret is not a function`). Такой вызов возможен, например, у GitLab: `canManageSecrets` включён, а
//! сохранения в едином слое нет (редактор переменных работает через `gitlab:*`). Методы по умолчанию здесь дают тот же текст и код `UNKNOWN`.

pub mod bitbucket;
pub mod gitea;
pub mod github;
pub mod gitlab;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use gorynych_core::error::{GorynychError, Result};
use gorynych_storage::credentials::LegacyCiUser;
use gorynych_storage::repo_providers::CiProvider;

use crate::gitlab::GlCtx;
use crate::http::{Downloaded, HttpCtx};
use crate::models::*;

/// Контекст запросов к репозитории.
#[derive(Clone)]
pub struct Ctx {
    pub http: HttpCtx,
    pub host: String,
    pub api_override: bool,
    pub owner: String,
    pub repo: String,
    pub site_base: String,
    pub web_url: Option<String>,
    pub can_write: Option<bool>,
    pub is_admin: Option<bool>,
    pub default_branch: Option<String>,
    pub root: PathBuf,
    /// Есть только у GitLab.
    pub gitlab: Option<GlCtx>,
}

impl Ctx {
    /// `/repos/owner/repo`.
    pub(crate) fn repo_api(&self) -> String {
        format!("/repos/{}/{}", self.owner, self.repo)
    }

    pub(crate) fn write_allowed(&self) -> bool {
        self.can_write != Some(false)
    }

    pub(crate) fn caps_input(&self) -> CapsInput {
        match &self.gitlab {
            Some(gitlab) => CapsInput { can_write: Some(gitlab.can_write()), is_admin: None, access_level: Some(gitlab.project.access_level) },
            None => CapsInput { can_write: self.can_write, is_admin: self.is_admin, access_level: None },
        }
    }
}

/// Откуда адаптер узнаёт права для `capabilities`.
#[derive(Debug, Clone, Copy, Default)]
pub struct CapsInput {
    pub can_write: Option<bool>,
    pub is_admin: Option<bool>,
    /// `ctx.project?.accessLevel`: у GitLab.
    pub access_level: Option<i64>,
}

/// Кому принадлежит вход.
pub type WhoAmI = Option<LegacyCiUser>;

/// Что отдаёт `pipelineDetail` адаптера.
#[derive(Debug, Clone, Default)]
pub struct DetailData {
    pub pipeline: Option<PipelineRun>,
    pub jobs: Vec<PipelineJob>,
    /// GitLab: порядок этапов.
    pub stage_order: Option<Vec<Option<String>>>,
    /// Bitbucket: шаги по порядку.
    pub sequential: bool,
    pub artifacts: Vec<CiArtifact>,
    pub can_write: bool,
}

/// Новый раннер.
#[derive(Debug, Clone, Default)]
pub struct RegistrationRequest {
    pub labels: Vec<String>,
    pub description: Option<String>,
    pub run_untagged: bool,
    pub locked: Option<bool>,
    pub paused: bool,
}

fn missing(name: &str) -> GorynychError {
    GorynychError::unknown(format!("adapter.{name} is not a function"))
}

/// `ICiCdProvider`.
#[async_trait]
pub trait CiCdProvider: Send + Sync {
    fn id(&self) -> CiProvider;
    fn label(&self) -> &'static str;
    fn capabilities(&self, input: CapsInput) -> Capabilities;

    async fn init(&self, _ctx: &mut Ctx) -> Result<()> {
        Err(missing("init"))
    }
    async fn whoami(&self, _ctx: &Ctx) -> Result<WhoAmI> {
        Err(missing("whoami"))
    }
    async fn list_pipelines(&self, ctx: &Ctx, reference: Option<&str>) -> Result<PipelineList>;
    async fn pipeline_detail(&self, ctx: &Ctx, id: &CiId) -> Result<DetailData>;
    async fn job_log(&self, ctx: &Ctx, id: &CiId, pipeline_id: Option<&CiId>) -> Result<JobLog>;
    async fn action(&self, ctx: &Ctx, action: &ActionRequest) -> Result<ActionResult>;
    async fn run_pipeline(&self, ctx: &Ctx, input: &RunInput) -> Result<RunResult>;
    async fn list_runners(&self, ctx: &Ctx) -> Result<Vec<CiRunner>>;
    async fn update_runner(&self, _ctx: &Ctx, _id: &CiId, _patch: &RunnerPatch) -> Result<RunnerResult> {
        Err(missing("updateRunner"))
    }
    async fn delete_runner(&self, _ctx: &Ctx, _id: &CiId) -> Result<RunnerResult> {
        Err(missing("deleteRunner"))
    }
    async fn registration_token(&self, _ctx: &Ctx, _request: &RegistrationRequest) -> Result<RegistrationToken> {
        Err(missing("registrationToken"))
    }
    async fn download_artifact(&self, _ctx: &Ctx, _artifact: &ArtifactRef, _dest: &Path) -> Result<Downloaded> {
        Err(missing("downloadArtifact"))
    }
    async fn list_secrets(&self, ctx: &Ctx) -> Result<Vec<CiSecretVariable>>;
    async fn save_secret(&self, _ctx: &Ctx, _secret: &SecretInput) -> Result<SecretResult> {
        Err(missing("saveSecret"))
    }
    async fn delete_secret(&self, _ctx: &Ctx, _secret: &SecretRef) -> Result<SecretResult> {
        Err(missing("deleteSecret"))
    }
}

/// Адаптер провайдера.
pub fn adapter(kind: CiProvider) -> &'static dyn CiCdProvider {
    match kind {
        CiProvider::Gitlab => &gitlab::GitlabProvider,
        CiProvider::Github => &github::GithubProvider,
        CiProvider::Gitea => &gitea::GiteaProvider,
        CiProvider::Bitbucket => &bitbucket::BitbucketProvider,
    }
}
