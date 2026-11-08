//! Подключение раннера: `electron/cicd/runnerSetup.cjs`. Готовые команды (Docker, Linux, macOS, Windows) и локальный Docker-раннер в один клик.
//!
//! ## Конспект
//! - `forContainer`: внутри контейнера адрес своего компьютера — `host.docker.internal`, а не `localhost`.
//! - Docker: нет программы — `NO_DOCKER`; демон недоступен — `NO_DOCKER`; прочее — `DOCKER` с последней строкой stderr в подсказке (≤300 символов).
//! - Контейнеры помечены метками `ru.gorynych.runner{,.provider,.repo,.labels}`. Имя `gorynych-<провайдер>-<репозиторий>-xxxx`, останов и запуск принимают только `/^gorynych-[a-z0-9-]+$/`.
//! - Образы `gitlab/gitlab-runner`, `myoung34/github-runner`, `gitea/act_runner`. Сбой регистрации GitLab удаляет контейнер.
//! - `GK_DOCKER_BIN` из 1.x заменён на [`Docker::with_command`].

use std::ffi::OsString;
use std::sync::LazyLock;
use std::time::Duration;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use regex::Regex;
use serde::Serialize;

use crate::json::{js_string, text};
use crate::models::RunnerCommand;

const LABEL: &str = "ru.gorynych.runner";

static LOCALHOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(https?://)(?:localhost|127\.0\.0\.1|\[::1\])(?P<rest>[:/].*|$)").expect("корректный шаблон"));
static RUNNER_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new("^gorynych-[a-z0-9-]+$").expect("корректный шаблон"));
static NOT_RUNNING: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)Cannot connect to the Docker daemon|error during connect|daemon is not running|pipe/docker_engine").expect("корректный шаблон"));
static NOT_SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new("[^a-z0-9]+").expect("корректный шаблон"));

/// Адрес для контейнера.
pub fn for_container(url: &str) -> String {
    LOCALHOST.replace(url, "${1}host.docker.internal$rest").into_owned()
}

fn slug(text: &str) -> String {
    let lower = text.to_lowercase();
    let dashed = NOT_SLUG.replace_all(&lower, "-");
    let trimmed: String = dashed.trim_matches('-').chars().take(40).collect();
    if trimmed.is_empty() { "repo".to_owned() } else { trimmed }
}

/// `Date.now().toString(36).slice(-4)`.
pub(crate) fn time_suffix() -> String {
    let mut value = chrono::Utc::now().timestamp_millis().unsigned_abs();
    let mut digits = Vec::new();
    while value > 0 {
        digits.push(char::from_digit((value % 36) as u32, 36).expect("меньше основания"));
        value /= 36;
    }
    digits.into_iter().take(4).rev().collect()
}

fn command(id: &str, label: &str, shell: &str, lines: &[String]) -> RunnerCommand {
    RunnerCommand { id: id.to_owned(), label: label.to_owned(), shell: shell.to_owned(), text: lines.join("\n") }
}

macro_rules! lines {
    ($($line:expr),+ $(,)?) => { &[$(String::from($line)),+] };
}

/// Команды для копирования.
pub fn commands(provider: &str, url: &str, token: &str, labels: &[String], name: &str) -> Vec<RunnerCommand> {
    let joined = labels.join(",");
    let has_labels = !joined.is_empty();
    match provider {
        "gitlab" => {
            let register = format!("gitlab-runner register --non-interactive --url {url} --token {token} --executor");
            vec![
                command("docker", "Docker", "bash", lines![
                    format!("docker run -d --name {name} --restart always \\"),
                    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
                    format!("  -v {name}-config:/etc/gitlab-runner \\"),
                    "  gitlab/gitlab-runner:latest",
                    format!("docker exec {name} gitlab-runner register --non-interactive \\"),
                    format!("  --url {} --token {token} \\", for_container(url)),
                    format!("  --executor docker --docker-image alpine:latest --name {name}"),
                ]),
                command("linux", "Linux", "bash", lines![
                    "sudo curl -L --output /usr/local/bin/gitlab-runner https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-linux-amd64",
                    "sudo chmod +x /usr/local/bin/gitlab-runner",
                    "sudo useradd --comment \"GitLab Runner\" --create-home gitlab-runner --shell /bin/bash || true",
                    "sudo gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner",
                    format!("sudo {register} shell --name {name}"),
                    "sudo gitlab-runner start",
                ]),
                command("macos", "macOS", "bash", lines![
                    "sudo curl -L --output /usr/local/bin/gitlab-runner https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-darwin-arm64",
                    "sudo chmod +x /usr/local/bin/gitlab-runner",
                    format!("{register} shell --name {name}"),
                    "gitlab-runner install && gitlab-runner start",
                ]),
                command("windows", "Windows", "powershell", lines![
                    r"New-Item -Path 'C:\GitLab-Runner' -ItemType Directory -Force | Out-Null",
                    r"Invoke-WebRequest -Uri 'https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-windows-amd64.exe' -OutFile 'C:\GitLab-Runner\gitlab-runner.exe'",
                    r"cd C:\GitLab-Runner",
                    format!(r".\gitlab-runner.exe register --non-interactive --url {url} --token {token} --executor shell --shell pwsh --name {name}"),
                    r".\gitlab-runner.exe install",
                    r".\gitlab-runner.exe start",
                ]),
            ]
        }
        "github" => {
            let label_flag = if has_labels { format!(" --labels {joined}") } else { String::new() };
            let config = |bin: &str| format!("{bin} --url {url} --token {token} --name {name}{label_flag} --unattended");
            let latest = r#"V=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"#;
            vec![
                command("docker", "Docker", "bash", lines![
                    format!("docker run -d --name {name} --restart always \\"),
                    format!("  -e REPO_URL={url} -e RUNNER_TOKEN={token} \\"),
                    format!("  -e RUNNER_NAME={name} -e RUNNER_SCOPE=repo{} \\", if has_labels { format!(" -e LABELS={joined}") } else { String::new() }),
                    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
                    "  myoung34/github-runner:latest",
                ]),
                command("linux", "Linux", "bash", lines![
                    "mkdir -p actions-runner && cd actions-runner",
                    latest,
                    "curl -sL -o runner.tar.gz https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-x64-$V.tar.gz",
                    "tar xzf runner.tar.gz",
                    config("./config.sh"),
                    "sudo ./svc.sh install && sudo ./svc.sh start",
                ]),
                command("macos", "macOS", "bash", lines![
                    "mkdir -p actions-runner && cd actions-runner",
                    latest,
                    "curl -sL -o runner.tar.gz https://github.com/actions/runner/releases/download/v$V/actions-runner-osx-arm64-$V.tar.gz",
                    "tar xzf runner.tar.gz",
                    config("./config.sh"),
                    "./svc.sh install && ./svc.sh start",
                ]),
                command("windows", "Windows", "powershell", lines![
                    r"New-Item -Path C:\actions-runner -ItemType Directory -Force | Out-Null; cd C:\actions-runner",
                    "$v = (Invoke-RestMethod https://api.github.com/repos/actions/runner/releases/latest).tag_name.TrimStart('v')",
                    r#"Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$v/actions-runner-win-x64-$v.zip" -OutFile runner.zip"#,
                    "Expand-Archive runner.zip -DestinationPath . -Force",
                    format!("{} --runasservice", config(r".\config.cmd")),
                ]),
            ]
        }
        "gitea" => {
            let label_flag = if has_labels { format!(" --labels {joined}") } else { String::new() };
            let register = |bin: &str| format!("{bin} register --no-interactive --instance {url} --token {token} --name {name}{label_flag}");
            vec![
                command("docker", "Docker", "bash", lines![
                    format!("docker run -d --name {name} --restart always \\"),
                    format!("  -e GITEA_INSTANCE_URL={} \\", for_container(url)),
                    format!("  -e GITEA_RUNNER_REGISTRATION_TOKEN={token} \\"),
                    format!("  -e GITEA_RUNNER_NAME={name}{} \\", if has_labels { format!(" -e GITEA_RUNNER_LABELS={joined}") } else { String::new() }),
                    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
                    format!("  -v {name}-data:/data \\"),
                    "  gitea/act_runner:latest",
                ]),
                command("linux", "Linux", "bash", lines![
                    t("# Свежая версия act_runner: https://gitea.com/gitea/act_runner/releases", &[]),
                    "curl -L -o act_runner https://dl.gitea.com/act_runner/nightly/act_runner-nightly-linux-amd64 && chmod +x act_runner",
                    register("./act_runner"),
                    "nohup ./act_runner daemon > act_runner.log 2>&1 &",
                ]),
                command("macos", "macOS", "bash", lines![
                    "curl -L -o act_runner https://dl.gitea.com/act_runner/nightly/act_runner-nightly-darwin-arm64 && chmod +x act_runner",
                    register("./act_runner"),
                    "nohup ./act_runner daemon > act_runner.log 2>&1 &",
                ]),
                command("windows", "Windows", "powershell", lines![
                    "Invoke-WebRequest -Uri 'https://dl.gitea.com/act_runner/nightly/act_runner-nightly-windows-amd64.exe' -OutFile act_runner.exe",
                    register(r".\act_runner.exe"),
                    r".\act_runner.exe daemon",
                ]),
            ]
        }
        _ => Vec::new(),
    }
}

/// Доступность Docker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DockerStatus {
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
    pub hint: Option<String>,
}

/// Контейнер с раннером.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalRunner {
    pub id: Option<String>,
    pub name: Option<String>,
    pub image: Option<String>,
    pub state: String,
    pub status: Option<String>,
    pub provider: Option<String>,
    pub repo: Option<String>,
    pub runner_labels: Vec<String>,
}

/// Вызов `docker`.
#[derive(Debug, Clone)]
pub struct Docker {
    bin: OsString,
    env: Vec<(String, String)>,
}

impl Default for Docker {
    fn default() -> Self {
        Self { bin: "docker".into(), env: Vec::new() }
    }
}

impl Docker {
    /// Другая программа и переменные окружения.
    pub fn with_command(bin: impl Into<OsString>, env: Vec<(String, String)>) -> Self {
        Self { bin: bin.into(), env }
    }

    async fn run(&self, args: &[String], timeout: Duration) -> Result<String> {
        let mut command = tokio::process::Command::new(&self.bin);
        command.args(args).envs(self.env.iter().map(|(key, value)| (key, value))).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: windowsHide
        let shown = format!("{} {}", self.bin.to_string_lossy(), args.join(" "));
        let output = match tokio::time::timeout(timeout, command.output()).await {
            Err(_) => return Err(docker_failure(&format!("Command failed: {shown}"))),
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(GorynychError::new(ErrorCode::NoDocker, t("Docker не установлен", &[])).with_hint(t("Установите Docker Desktop и запустите его", &[])));
            }
            Ok(Err(error)) => return Err(docker_failure(&error.to_string())),
            Ok(Ok(output)) => output,
        };
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let text = if stderr.is_empty() { format!("Command failed: {shown}") } else { stderr.into_owned() };
        Err(docker_failure(&text))
    }

    /// `dockerStatus`.
    pub async fn status(&self) -> DockerStatus {
        let args = ["version", "--format", "{{.Server.Version}}"].map(str::to_owned);
        match self.run(&args, Duration::from_secs(8)).await {
            Ok(version) => {
                let version = gorynych_core::js::trim(&version).to_owned();
                DockerStatus { available: true, version: (!version.is_empty()).then_some(version), reason: None, hint: None }
            }
            Err(error) => DockerStatus { available: false, version: None, reason: Some(error.message), hint: error.hint },
        }
    }

    /// `localRunners`: контейнеры, поднятые приложением.
    pub async fn local_runners(&self, repo_key: Option<&str>) -> Result<Vec<LocalRunner>> {
        let args = ["ps".to_owned(), "-a".to_owned(), "--filter".to_owned(), format!("label={LABEL}=1"), "--format".to_owned(), "{{json .}}".to_owned()];
        let output = self.run(&args, Duration::from_secs(15)).await?;
        let mut out = Vec::new();
        for line in output.split('\n').map(|line| line.trim_end_matches('\r')).filter(|line| !line.is_empty()) {
            let c: serde_json::Value = serde_json::from_str(line).map_err(GorynychError::unknown)?;
            let labels = text(&c, "Labels").unwrap_or_default();
            let label = |name: &str| {
                let wanted = format!("{LABEL}.{name}");
                labels.split(',').filter(|pair| !pair.is_empty()).filter_map(|pair| pair.split_once('=').or(Some((pair, "")))).find(|(key, _)| *key == wanted).map(|(_, value)| value.to_owned())
            };
            let status = text(&c, "Status");
            out.push(LocalRunner {
                id: text(&c, "ID"),
                name: text(&c, "Names"),
                image: text(&c, "Image"),
                state: text(&c, "State").unwrap_or_else(|| if status.as_deref().is_some_and(|status| status.starts_with("Up")) { "running" } else { "exited" }.to_owned()),
                status,
                provider: label("provider"),
                repo: label("repo"),
                runner_labels: label("labels").unwrap_or_default().split(';').filter(|item| !item.is_empty()).map(str::to_owned).collect(),
            });
        }
        out.retain(|runner| repo_key.is_none_or(|key| runner.repo.as_deref() == Some(key)));
        Ok(out)
    }

    /// `startLocal`.
    pub async fn start_local(&self, provider: &str, url: &str, token: &str, labels: &[String], repo_key: &str, repo_name: &str) -> Result<String> {
        let status = self.status().await;
        if !status.available {
            let mut error = GorynychError::new(ErrorCode::NoDocker, status.reason.unwrap_or_default());
            error.hint = status.hint;
            return Err(error);
        }
        let name = format!("gorynych-{provider}-{}-{}", slug(repo_name), time_suffix());
        let long = Duration::from_secs(600);
        let strings = |list: &[&str]| list.iter().map(|item| (*item).to_owned()).collect::<Vec<String>>();
        let meta = vec![
            "--label".to_owned(), format!("{LABEL}=1"),
            "--label".to_owned(), format!("{LABEL}.provider={provider}"),
            "--label".to_owned(), format!("{LABEL}.repo={repo_key}"),
            "--label".to_owned(), format!("{LABEL}.labels={}", labels.join(";")),
        ];
        let sock = strings(&["-v", "/var/run/docker.sock:/var/run/docker.sock"]);
        let container_url = for_container(url);
        let head = [strings(&["run", "-d", "--name"]), vec![name.clone()], strings(&["--restart", "unless-stopped"]), meta].concat();
        match provider {
            "gitlab" => {
                let args = [head, sock, vec!["-v".to_owned(), format!("{name}-config:/etc/gitlab-runner"), "gitlab/gitlab-runner:latest".to_owned()]].concat();
                self.run(&args, long).await?;
                let register = [
                    vec!["exec".to_owned(), name.clone()],
                    strings(&["gitlab-runner", "register", "--non-interactive", "--url"]),
                    vec![container_url, "--token".to_owned(), token.to_owned()],
                    strings(&["--executor", "docker", "--docker-image", "alpine:latest", "--docker-volumes", "/var/run/docker.sock:/var/run/docker.sock", "--name"]),
                    vec![name.clone()],
                ]
                .concat();
                if let Err(error) = self.run(&register, Duration::from_secs(120)).await {
                    let _ = self.run(&["rm".to_owned(), "-f".to_owned(), name.clone()], Duration::from_secs(60)).await;
                    return Err(error);
                }
            }
            "github" => {
                let mut env = vec!["-e".to_owned(), format!("REPO_URL={url}"), "-e".to_owned(), format!("RUNNER_TOKEN={token}"), "-e".to_owned(), format!("RUNNER_NAME={name}"), "-e".to_owned(), "RUNNER_SCOPE=repo".to_owned()];
                if !labels.is_empty() {
                    env.extend(["-e".to_owned(), format!("LABELS={}", labels.join(","))]);
                }
                let args = [head, env, sock, vec!["myoung34/github-runner:latest".to_owned()]].concat();
                self.run(&args, long).await?;
            }
            "gitea" => {
                let mut env = vec!["-e".to_owned(), format!("GITEA_INSTANCE_URL={container_url}"), "-e".to_owned(), format!("GITEA_RUNNER_REGISTRATION_TOKEN={token}"), "-e".to_owned(), format!("GITEA_RUNNER_NAME={name}")];
                if !labels.is_empty() {
                    env.extend(["-e".to_owned(), format!("GITEA_RUNNER_LABELS={}", labels.join(","))]);
                }
                let args = [head, env, sock, vec!["-v".to_owned(), format!("{name}-data:/data"), "gitea/act_runner:latest".to_owned()]].concat();
                self.run(&args, long).await?;
            }
            _ => return Err(GorynychError::new(ErrorCode::Unsupported, t("Локальный раннер для этого провайдера не поддерживается", &[]))),
        }
        Ok(name)
    }

    /// `stopLocal` с удалением контейнера и томов.
    pub async fn stop_local(&self, name: &str) -> Result<()> {
        check_runner_name(name)?;
        self.run(&["rm".to_owned(), "-f".to_owned(), name.to_owned()], Duration::from_secs(60)).await?;
        let _ = self.run(&["volume".to_owned(), "rm".to_owned(), "-f".to_owned(), format!("{name}-config"), format!("{name}-data")], Duration::from_secs(60)).await;
        Ok(())
    }

    /// `resumeLocal`.
    pub async fn resume_local(&self, name: &str) -> Result<()> {
        check_runner_name(name)?;
        self.run(&["start".to_owned(), name.to_owned()], Duration::from_secs(60)).await?;
        Ok(())
    }
}

fn docker_failure(text: &str) -> GorynychError {
    let text = gorynych_core::js::trim(text);
    if NOT_RUNNING.is_match(text) {
        return GorynychError::new(ErrorCode::NoDocker, t("Docker не запущен", &[])).with_hint(t("Запустите Docker Desktop и попробуйте снова", &[]));
    }
    let last: String = text.rsplit('\n').next().unwrap_or_default().chars().take(300).collect();
    GorynychError::new(ErrorCode::Docker, t("Docker вернул ошибку", &[])).with_details(text).with_hint(last)
}

fn check_runner_name(name: &str) -> Result<()> {
    if RUNNER_NAME.is_match(name) { Ok(()) } else { Err(GorynychError::new(ErrorCode::BadArgs, t("Это не раннер приложения", &[]))) }
}

/// `String(v)` для меток.
pub(crate) fn clean_labels(labels: &[serde_json::Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for label in labels {
        let label = gorynych_core::js::trim(&js_string(label)).to_owned();
        if !label.is_empty() && !out.contains(&label) {
            out.push(label);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_address() {
        assert_eq!(for_container("http://localhost:8080/x"), "http://host.docker.internal:8080/x");
        assert_eq!(for_container("https://127.0.0.1"), "https://host.docker.internal");
        assert_eq!(for_container("http://[::1]/a"), "http://host.docker.internal/a");
        assert_eq!(for_container("http://localhost.ru/"), "http://localhost.ru/");
        assert_eq!(for_container("https://gitlab.x"), "https://gitlab.x");
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Мой Repo_1"), "repo-1");
        assert_eq!(slug("---"), "repo");
        assert_eq!(slug(&"a".repeat(50)).len(), 40);
    }

    #[test]
    fn suffix_has_four_base36_digits() {
        let suffix = time_suffix();
        assert_eq!(suffix.len(), 4);
        assert!(suffix.chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()));
    }

    #[test]
    fn name_check_and_failure_classes() {
        assert!(check_runner_name("gorynych-gitlab-a-1b2c").is_ok());
        assert_eq!(check_runner_name("gorynych-A").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(check_runner_name("rm -rf").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(docker_failure("error during connect: x").code, ErrorCode::NoDocker);
        let failure = docker_failure("первая\nпоследняя");
        assert_eq!((failure.code, failure.hint.as_deref()), (ErrorCode::Docker, Some("последняя")));
    }

    #[test]
    fn unknown_provider_has_no_commands() {
        assert!(commands("bitbucket", "u", "t", &[], "n").is_empty());
    }
}
