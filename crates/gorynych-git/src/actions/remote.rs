//! Проверка доступа, fetch, pull, push, удаление ветки на сервере, обновление ветки из upstream.

use std::path::Path;
use std::sync::LazyLock;

use chrono::{SecondsFormat, Utc};
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::state::{State, current_state, pick_remote, require_branch, require_no_operation};
use crate::common::{any_line, branch_tip, commit_of, filled, lenient, or_undefined, trimmed};
use crate::network::Network;
use crate::run::git;

static SSH_HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^ssh://(?:[^@/]+@)?([^:/]+)").expect("корректный шаблон"));
static SCP_HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:[^@/\\]+@)?([^:/\\]+):").expect("корректный шаблон"));
static HTTP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https?://").expect("корректный шаблон"));
static DEFAULT_BRANCH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)refusing to delete the current branch|deletion of the current branch prohibited|default branch").expect("корректный шаблон"));
static PROTECTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)protected|only delete protected branches|GH006|cannot delete").expect("корректный шаблон"));
static OVERWRITTEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)overwritten|would be overwritten|untracked working tree").expect("корректный шаблон"));
static NON_FF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)non-fast-forward|rejected").expect("корректный шаблон"));
static IN_USE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)checked out|refusing to fetch into").expect("корректный шаблон"));

/// Адрес без логина и токена.
struct UrlInfo {
    protocol: &'static str,
    host: Option<String>,
    url: String,
}

fn describe_url(url: &str) -> UrlInfo {
    if HTTP.is_match(url) {
        return match url::Url::parse(url) {
            Ok(parsed) => {
                let host = parsed.host_str().map(|host| match parsed.port() {
                    Some(port) => format!("{host}:{port}"),
                    None => host.to_owned(),
                });
                let shown = format!("{}://{}{}", parsed.scheme(), host.as_deref().unwrap_or_default(), parsed.path());
                UrlInfo { protocol: "https", host, url: shown }
            }
            Err(_) => UrlInfo { protocol: "https", host: None, url: url.to_owned() },
        };
    }
    if url.get(..6).is_some_and(|start| start.eq_ignore_ascii_case("ssh://")) {
        return UrlInfo { protocol: "ssh", host: SSH_HOST.captures(url).map(|caps| caps[1].to_owned()), url: url.to_owned() };
    }
    // scp-синтаксис: user@host:path (но не C:\path)
    if let Some(caps) = SCP_HOST.captures(url) {
        let rest = &url[caps.get(0).expect("всё совпадение").end()..];
        if !rest.starts_with("//") && caps[1].chars().count() > 1 {
            return UrlInfo { protocol: "ssh", host: Some(caps[1].to_owned()), url: url.to_owned() };
        }
    }
    UrlInfo { protocol: "local", host: None, url: url.to_owned() }
}

/// Параметры `checkAccess`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CheckAccess {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub write: Option<bool>,
}

/// Результат `checkAccess`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AccessInfo {
    pub remote: String,
    pub protocol: String,
    pub host: Option<String>,
    pub url: String,
    pub branch: Option<String>,
    pub target_ref: Option<String>,
    pub has_upstream: bool,
    pub can_read: bool,
    pub can_write: Option<bool>,
    pub branch_exists: Option<bool>,
    pub diverged: bool,
    pub error: Option<GorynychError>,
    pub write_error: Option<GorynychError>,
    pub checked_at: String,
}

/// Чтение: `ls-remote`. Запись: `push --dry-run`. Защиту веток сервер применяет только при настоящем push, поэтому она распознаётся по его ответу.
pub async fn check_access(network: &Network, cwd: &Path, write: bool) -> Result<AccessInfo> {
    let state = current_state(cwd).await?;
    let Some(remote) = pick_remote(&state) else {
        return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])).with_hint(t("Добавьте remote: git remote add origin <url>", &[])));
    };
    let raw_url = trimmed(cwd, &["remote", "get-url", &remote]).await?;
    let upstream_ref = state.branch.as_ref().and_then(|branch| branch.upstream_ref.clone()).filter(|text| !text.is_empty());
    let target_ref = upstream_ref.or_else(|| state.branch_name.as_ref().map(|name| format!("refs/heads/{name}")));
    let info = describe_url(&raw_url);
    let mut result = AccessInfo {
        remote: remote.clone(),
        protocol: info.protocol.to_owned(),
        host: info.host,
        url: info.url,
        branch: state.branch_name.clone(),
        target_ref: target_ref.clone(),
        has_upstream: state.branch.as_ref().is_some_and(|branch| branch.upstream.is_some()),
        can_read: false,
        can_write: None,
        branch_exists: None,
        diverged: false,
        error: None,
        write_error: None,
        checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    };

    match network.git(cwd, &["ls-remote", "--heads", &remote]).await {
        Ok(out) => {
            result.can_read = true;
            if let Some(target) = &target_ref {
                result.branch_exists = Some(out.split('\n').any(|line| line.split('\t').nth(1) == Some(target)));
            }
        }
        Err(error) => {
            result.error = Some(error);
            return Ok(result);
        }
    }

    if write
        && let (Some(branch), Some(_)) = (&state.branch_name, &state.head_hash)
    {
        let spec = format!("refs/heads/{branch}:{}", or_undefined(target_ref.as_deref()));
        match network.git(cwd, &["push", "--dry-run", "--porcelain", &remote, &spec]).await {
            Ok(_) => result.can_write = Some(true),
            Err(error) if error.code == ErrorCode::RejectedNonFf || any_line(&error.stdout, |line| line.starts_with("!\t")) => {
                // Сервер ответил и пустил нас: права на запись есть, но remote ушёл вперёд
                result.can_write = Some(true);
                result.diverged = true;
            }
            Err(error) => {
                if matches!(error.code, ErrorCode::Auth | ErrorCode::Forbidden | ErrorCode::NotFound | ErrorCode::Protected | ErrorCode::HookDeclined) {
                    result.can_write = Some(false);
                }
                result.write_error = Some(error);
            }
        }
    }
    Ok(result)
}

fn rebuilt(source: Option<&GorynychError>, code: ErrorCode, message: impl FnOnce() -> String) -> GorynychError {
    match source {
        Some(error) => {
            let mut out = GorynychError::new(error.code, error.message.clone()).with_details(error.details.clone());
            out.hint.clone_from(&error.hint);
            out
        }
        None => GorynychError::new(code, message()),
    }
}

/// `accessError`.
fn access_error(access: &AccessInfo, push: bool) -> Option<GorynychError> {
    if !access.can_read {
        return Some(rebuilt(access.error.as_ref(), ErrorCode::Auth, || t("Нет доступа к {0}", &[&access.remote])));
    }
    if push && access.can_write == Some(false) {
        return Some(rebuilt(access.write_error.as_ref(), ErrorCode::Forbidden, || t("Нет прав на запись", &[])));
    }
    None
}

/// Результат `fetchAll`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FetchResult {
    pub remotes: Vec<String>,
}

/// `fetchAll`.
pub async fn fetch_all(network: &Network, cwd: &Path) -> Result<FetchResult> {
    let state = current_state(cwd).await?;
    if state.remotes.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoRemote, t("У репозитория нет remote", &[])));
    }
    network.git(cwd, &["fetch", "--all", "--prune", "--tags"]).await?;
    Ok(FetchResult { remotes: state.remotes })
}

/// Параметры `pull`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct PullRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub mode: Option<String>,
}

/// Результат `pull`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PullResult {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub updated: bool,
    pub mode: String,
}

/// `pull`.
pub async fn pull(network: &Network, cwd: &Path, request: &PullRequest) -> Result<PullResult> {
    let mode = request.mode.as_deref().unwrap_or("merge");
    let args: &[&str] = match mode {
        "merge" => &["pull", "--no-rebase"],
        "ff-only" => &["pull", "--ff-only"],
        "rebase" => &["pull", "--rebase", "--autostash"],
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестный режим pull", &[]))),
    };
    let state = current_state(cwd).await?;
    require_branch(&state, "pull")?;
    let name = state.branch_name.clone().unwrap_or_default();
    let upstream = state.branch.as_ref().and_then(|branch| branch.upstream.clone());
    let Some(upstream) = upstream else {
        return Err(GorynychError::new(ErrorCode::NoUpstream, t("У ветки «{0}» нет upstream", &[&name])).with_hint(t("Сделайте Push — ветка будет опубликована и связана с remote.", &[])));
    };
    if state.branch.as_ref().is_some_and(|branch| branch.gone) {
        return Err(GorynychError::new(ErrorCode::UpstreamGone, t("Remote-ветка {0} удалена", &[&upstream])).with_hint(t("Сделайте Push, чтобы создать её заново, или переключитесь на другую ветку.", &[])));
    }
    let access = check_access(network, cwd, false).await?;
    if let Some(denied) = access_error(&access, false) {
        return Err(denied);
    }
    network.git(cwd, args).await?;
    let after = trimmed(cwd, &["rev-parse", "HEAD"]).await?;
    Ok(PullResult { branch: Some(name), upstream: Some(upstream), updated: state.head_hash.as_deref() != Some(&after), mode: mode.to_owned() })
}

/// Параметры `push`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct PushRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub force: Option<bool>,
}

/// Результат `push`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub branch: Option<String>,
    pub remote: String,
    pub set_upstream: bool,
    pub forced: bool,
}

/// `push`.
pub async fn push(network: &Network, cwd: &Path, request: &PushRequest) -> Result<PushResult> {
    let force = request.force == Some(true);
    let state = current_state(cwd).await?;
    require_branch(&state, "push")?;
    let access = check_access(network, cwd, true).await?;
    if let Some(denied) = access_error(&access, true) {
        return Err(denied);
    }
    if access.diverged && !force {
        return Err(GorynychError::new(ErrorCode::RejectedNonFf, t("На {0} есть коммиты, которых нет в вашей ветке", &[&access.remote])).with_hint(t("Сделайте Pull и повторите Push, либо Force Push (with lease), чтобы перезаписать remote-ветку.", &[])));
    }
    let branch = state.branch_name.clone().unwrap_or_default();
    let set_upstream = state.branch.as_ref().is_none_or(|item| item.upstream.is_none() || item.gone);
    let mut args = vec!["push", "--porcelain"];
    if set_upstream {
        args.push("--set-upstream");
    }
    if force {
        args.push("--force-with-lease");
    }
    let spec = format!("refs/heads/{branch}:{}", or_undefined(access.target_ref.as_deref()));
    args.extend([access.remote.as_str(), &spec]);
    network.git(cwd, &args).await?;
    Ok(PushResult { branch: Some(branch), remote: access.remote.clone(), set_upstream, forced: force })
}

/// Параметры `deleteRemoteBranch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct DeleteRemoteBranch {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub remote: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
}

/// Результат `deleteRemoteBranch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteBranchDeleted {
    pub remote: String,
    pub branch: String,
    pub hash: String,
    pub tracking: Vec<String>,
}

/// `deleteRemoteBranch`. Перед удалением запоминаем, на каком коммите была ветка: Undo публикует её обратно.
pub async fn delete_remote_branch(network: &Network, cwd: &Path, request: &DeleteRemoteBranch) -> Result<RemoteBranchDeleted> {
    let usable = |value: &Option<String>| value.clone().filter(|text| !text.is_empty() && !text.starts_with('-'));
    let (Some(remote), Some(branch)) = (usable(&request.remote), usable(&request.branch)) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
    };
    let state = current_state(cwd).await?;
    if !state.remotes.contains(&remote) {
        return Err(GorynychError::new(ErrorCode::NoRemote, t("Remote «{0}» не найден", &[&remote])));
    }
    // Узнаём реальное состояние сервера: ветку могли уже удалить или передвинуть
    let full = format!("refs/heads/{branch}");
    let tracking_ref = format!("refs/remotes/{remote}/{branch}");
    let out = network.git(cwd, &["ls-remote", "--heads", &remote, &full]).await?;
    let Some(line) = out.split('\n').find(|line| line.split('\t').nth(1) == Some(&full)) else {
        let _ = git(cwd, &["update-ref", "-d", &tracking_ref]).await;
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Ветки {0} уже нет на {1}", &[&branch, &remote])).with_hint(t("Её удалили раньше — список веток обновлён.", &[])));
    };
    let hash = gorynych_core::js::trim(line.split('\t').next().unwrap_or_default()).to_owned();
    if let Err(error) = network.git(cwd, &["push", "--porcelain", &remote, "--delete", &full]).await {
        let text = format!("{}\n{}", error.details, error.message);
        if DEFAULT_BRANCH.is_match(&text) {
            return Err(GorynychError::new(ErrorCode::DefaultBranch, t("Нельзя удалить {0}: это основная ветка репозитория на сервере", &[&branch])).with_hint(t("Сначала смените ветку по умолчанию в настройках проекта на GitLab/GitHub.", &[])).with_details(error.details));
        }
        if PROTECTED.is_match(&text) {
            return Err(GorynychError::new(ErrorCode::Protected, t("Ветка {0} защищена на сервере — удалить её нельзя", &[&branch])).with_hint(t("Снимите защиту ветки в настройках проекта (Settings → Repository → Protected branches) или удалите её в веб-интерфейсе.", &[])).with_details(error.details));
        }
        return Err(error);
    }
    let _ = git(cwd, &["update-ref", "-d", &tracking_ref]).await;
    let wanted = format!("{remote}/{branch}");
    let tracking = state.refs.local_branches.iter().filter(|item| item.upstream.as_deref() == Some(&wanted)).map(|item| item.name.clone()).collect();
    Ok(RemoteBranchDeleted { remote, branch, hash, tracking })
}

/// Параметры `updateBranch`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct UpdateBranch {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
}

/// Результат `updateBranch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchUpdated {
    pub branch: String,
    pub from: String,
    pub to: Option<String>,
    pub current: bool,
    #[specta(type = f64)]
    pub count: u64,
    pub upstream: Option<String>,
}

fn is_ahead(state: &State, branch: &str) -> u32 {
    state.refs.local_branches.iter().find(|item| item.name == branch).map_or(0, |item| item.ahead)
}

/// `updateBranch`: перемотка из upstream без переключения. Не текущая ветка обновляется через `fetch`, рабочая папка не трогается.
pub async fn update_branch(network: &Network, cwd: &Path, request: &UpdateBranch) -> Result<BranchUpdated> {
    let Some(branch) = request.branch.clone().filter(|text| !text.is_empty() && !text.starts_with('-')) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Не указана ветка", &[])));
    };
    let state = current_state(cwd).await?;
    let Some(item) = state.refs.local_branches.iter().find(|item| item.name == branch).cloned() else {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("Ветка «{0}» не найдена", &[&branch])));
    };
    let parts = (filled(item.upstream.as_deref()), filled(item.upstream_remote.as_deref()), filled(item.upstream_ref.as_deref()));
    let (Some(upstream), Some(remote), Some(upstream_ref)) = parts else {
        return Err(no_server_branch(&branch));
    };
    if remote == "." {
        return Err(no_server_branch(&branch));
    }
    if item.gone {
        return Err(GorynychError::new(ErrorCode::UpstreamGone, t("{0} удалена на сервере", &[&upstream])).with_hint(t("Обновлять неоткуда: ветку на сервере удалили.", &[])));
    }
    if !state.remotes.iter().any(|name| name == remote) {
        return Err(GorynychError::new(ErrorCode::NoRemote, t("Remote «{0}» не найден", &[&remote])));
    }
    let current = state.branch_name.as_deref() == Some(&branch);
    let from = item.hash.clone();

    if current {
        require_no_operation(&state, &t("обновление", &[]))?;
        let tracking = format!("refs/remotes/{upstream}");
        network.git(cwd, &["fetch", "--no-tags", remote, &format!("+{upstream_ref}:{tracking}")]).await?;
        let target = commit_of(cwd, &tracking).await;
        let Some(target) = target.filter(|target| *target != from) else {
            return Ok(BranchUpdated { to: Some(from.clone()), from, branch, current, count: 0, upstream: None });
        };
        if !crate::common::succeeds(cwd, &["merge-base", "--is-ancestor", &from, &target]).await {
            return Err(GorynychError::new(ErrorCode::NotFastForward, t("В {0} есть свои коммиты — перемотать нельзя", &[&branch])).with_hint(t("Используйте Pull (merge или rebase), чтобы объединить изменения.", &[])));
        }
        if let Err(error) = git(cwd, &["merge", "--ff-only", "-q", &target]).await {
            if OVERWRITTEN.is_match(&error.details) {
                return Err(GorynychError::new(ErrorCode::LocalChanges, t("Обновление затронет файлы с вашими незакоммиченными правками", &[])).with_hint(t("Закоммитьте или спрячьте правки (Stash) и повторите.", &[])).with_details(error.details));
            }
            return Err(error);
        }
    } else {
        let ahead = is_ahead(&state, &branch);
        if ahead > 0 {
            return Err(GorynychError::new(ErrorCode::NotFastForward, t("В {0} есть неотправленные коммиты ({1})", &[&branch, &ahead])).with_hint(t("Без переключения обновить нельзя: переключитесь на ветку и сделайте Pull (merge или rebase).", &[])));
        }
        // Без «+»: Git сам откажется, если это не перемотка вперёд
        if let Err(error) = network.git(cwd, &["fetch", "--no-tags", remote, &format!("{upstream_ref}:refs/heads/{branch}")]).await {
            let text = format!("{}\n{}", error.message, error.details);
            if NON_FF.is_match(&text) {
                return Err(GorynychError::new(ErrorCode::NotFastForward, t("{0} разошлась с {1}", &[&branch, &upstream])).with_hint(t("Переключитесь на ветку и сделайте Pull (merge или rebase).", &[])).with_details(error.details));
            }
            if IN_USE.is_match(&text) {
                return Err(GorynychError::new(ErrorCode::BranchInUse, t("{0} открыта в другой рабочей папке (worktree)", &[&branch])).with_details(error.details));
            }
            return Err(error);
        }
        // Ссылку origin/… Git обновляет сам (opportunistic update), но на старых версиях — нет
        let tip = branch_tip(cwd, &branch).await.unwrap_or_default();
        let _ = git(cwd, &["update-ref", &format!("refs/remotes/{upstream}"), &tip]).await;
    }
    let to = branch_tip(cwd, &branch).await;
    let count = match &to {
        Some(to) if *to != from => trimmed(cwd, &["rev-list", "--count", &format!("{from}..{to}")]).await?.parse().unwrap_or(0),
        _ => 0,
    };
    Ok(BranchUpdated { upstream: Some(upstream.to_owned()), branch, from, to, current, count })
}

fn no_server_branch(branch: &str) -> GorynychError {
    GorynychError::new(ErrorCode::NoUpstream, t("У ветки «{0}» нет ветки на сервере", &[&branch])).with_hint(t("Сделайте Push, чтобы опубликовать её.", &[]))
}

/// Вернуть удалённую ветку на сервер: Undo `deleteRemoteBranch`.
pub(crate) async fn republish_branch(network: &Network, cwd: &Path, remote: &str, branch: &str, hash: &str) -> Result<()> {
    network.git(cwd, &["push", "--porcelain", remote, &format!("{hash}:refs/heads/{branch}")]).await?;
    git(cwd, &["update-ref", &format!("refs/remotes/{remote}/{branch}"), hash]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_described_without_secrets() {
        let info = describe_url("https://user:token@Git.Example.com:8443/a/b.git?x=1");
        assert_eq!((info.protocol, info.host.as_deref(), info.url.as_str()), ("https", Some("git.example.com:8443"), "https://git.example.com:8443/a/b.git"));
        assert_eq!(describe_url("http://x:80/a").url, "http://x/a");
        assert_eq!(describe_url("ssh://git@host:22/a").host.as_deref(), Some("host"));
        let scp = describe_url("git@gitlab.com:a/b.git");
        assert_eq!((scp.protocol, scp.host.as_deref()), ("ssh", Some("gitlab.com")));
        assert_eq!(describe_url(r"C:\repo").protocol, "local");
        assert_eq!(describe_url("../origin.git").protocol, "local");
        assert_eq!(describe_url("file:///x").protocol, "local");
    }
}
