//! Связка крейтов, которые по графу зависимостей не знают друг о друге.
//!
//! - [`GitView`] — `RepoView` линтера поверх настоящего `git` (`gorynych_git::run::git_blocking`).
//! - [`GitForCicd`] — `CicdGit` для `CicdService`.
//! - [`GitlabHeads`] — `BranchHeadsApi` наблюдателя поверх `CicdService::gitlab_branch_heads`.
//!
//! Методы `RepoView` синхронные: вызывать линтер только из `spawn_blocking`, иначе процесс git занял бы рабочий поток tokio.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use gorynych_ci_linter::guard::STAGED_DIFF_ARGS;
use gorynych_ci_linter::load::{CI_LOG_ARGS, CI_STATUS_ARGS, CI_STATUS_UNTRACKED, LS_FILES_ARGS, ORIGIN_HEAD_ARGS, REFS_ARGS};
use gorynych_ci_linter::repo::RepoView;
use gorynych_cicd::gitlab::retry_after;
use gorynych_cicd::remote::CicdGit;
use gorynych_cicd::service::CicdService;
use gorynych_core::error::{GorynychError, Result};
use gorynych_git::run::git_blocking;
use gorynych_watcher::remote_watch::BranchHeadsApi;
use indexmap::IndexMap;

/// Аргументы, затем `--` и пути.
fn with_paths(args: &[&str], extra: &[&str], paths: &[String]) -> Vec<String> {
    args.iter().chain(extra).map(|arg| (*arg).to_owned()).chain(std::iter::once("--".to_owned())).chain(paths.iter().cloned()).collect()
}

/// Чтение репозитория для линтера.
pub struct GitView(pub PathBuf);

impl RepoView for GitView {
    fn staged_diff(&self) -> Result<String> {
        git_blocking(&self.0, &STAGED_DIFF_ARGS)
    }

    fn ci_log(&self, paths: &[String]) -> Result<String> {
        git_blocking(&self.0, &with_paths(&CI_LOG_ARGS, &[], paths))
    }

    fn ci_status(&self, paths: &[String]) -> Result<String> {
        git_blocking(&self.0, &with_paths(&CI_STATUS_ARGS, &[CI_STATUS_UNTRACKED], paths))
    }

    fn ls_files(&self) -> Result<String> {
        git_blocking(&self.0, &LS_FILES_ARGS)
    }

    fn refs(&self) -> Result<String> {
        git_blocking(&self.0, &REFS_ARGS)
    }

    fn origin_head(&self) -> Result<String> {
        git_blocking(&self.0, &ORIGIN_HEAD_ARGS)
    }

    fn verify_branch(&self, branch: &str) -> Result<String> {
        git_blocking(&self.0, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
    }
}

/// `git` для службы CI/CD.
pub struct GitForCicd;

impl CicdGit for GitForCicd {
    fn remote_verbose(&self, root: &Path) -> Result<String> {
        git_blocking(root, &["remote", "-v"])
    }

    fn show(&self, root: &Path, spec: &str) -> Option<String> {
        git_blocking(root, &["show", spec]).ok()
    }

    fn view(&self, root: &Path) -> Box<dyn RepoView + Send> {
        Box::new(GitView(root.to_path_buf()))
    }
}

/// Ветки на сервере через API GitLab.
pub struct GitlabHeads(pub CicdService);

#[async_trait]
impl BranchHeadsApi for GitlabHeads {
    async fn branch_heads(&self, root: &Path, remote: &str) -> Result<Option<IndexMap<String, String>>> {
        self.0.gitlab_branch_heads(root, remote).await
    }

    fn retry_after(&self, error: &GorynychError) -> Option<u64> {
        retry_after(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_follow_double_dash() {
        let args = with_paths(&["status", "-z"], &["--untracked-files=all"], &[".gitlab-ci.yml".to_owned()]);
        assert_eq!(args, ["status", "-z", "--untracked-files=all", "--", ".gitlab-ci.yml"]);
    }
}
