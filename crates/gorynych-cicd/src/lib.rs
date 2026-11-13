//! Провайдеры CI/CD: GitLab, GitHub, Gitea/Forgejo, Bitbucket. Перенос `electron/gitlab.cjs` и `electron/cicd/*`.
//!
//! - [`service::CicdService`] — единый слой (`cicd/index.cjs`): определяет провайдера, проверяет авторизацию, отдаёт нормализованные модели.
//! - [`gitlab`] — API GitLab в форме `gitlab:*` (`gitlab.cjs`): этим каналом пользуются панель пайплайнов, переменные, расписания, CI Lint и MR.
//! - [`providers`] — адаптеры на трейте [`providers::CiCdProvider`].
//! - [`runner_setup`] — команды подключения раннера и локальный Docker-раннер.
//! - [`issues`] — задачи сервера репозитория (новое в 2.0).

pub mod detect_server;
pub mod gitlab;
pub mod http;
pub mod issues;
pub mod json;
pub mod models;
pub mod providers;
pub mod remote;
pub mod runner_setup;
pub mod seal;
pub mod service;
