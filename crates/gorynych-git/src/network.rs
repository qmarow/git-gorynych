//! Сетевое окружение git: `networkOptions` и `remoteUrls` из `electron/actions.cjs`.
//!
//! ## Конспект
//! - `GIT_TERMINAL_PROMPT=0`: git не ждёт логин в невидимой консоли. Окно входа Git Credential Manager продолжает работать.
//! - `BatchMode` включается, только если пользователь не настроил ssh сам (`GIT_SSH_COMMAND`, `GIT_SSH`, `core.sshCommand`).
//! - Учётные данные подбираются по адресам remote: сперва remote текущей ветки, потом `origin`, потом остальные. Хранилище недоступно — работаем через системные средства входа.
//! - Таймаут 5 минут: запас на окно входа.
//!
//! `core.sshCommand` и адреса remote читаются одним вызовом `git config` вместо двух (см. [`NetConfig`]): это каждая сетевая
//! команда и каждый тик фоновой проверки сервера.
//!
//! Секреты отдаёт брокер из `gorynych-storage::askpass`. [`NetOptions`] держит его сессию: пока объект жив, помощник git может получить секрет, поэтому он живёт до конца команды.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use gorynych_core::error::Result;
use gorynych_core::js;
use gorynych_storage::askpass::{AuthBroker, AuthSession};
use gorynych_storage::credentials::Credentials;
use regex::Regex;

use crate::common::quiet;
use crate::run::{git, git_with, GitOptions};

const NETWORK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

static REMOTE_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^remote\.(.+)\.url (.+)$").expect("корректный шаблон"));

/// Откуда брать учётные данные. Без них git работает через системные средства входа.
#[derive(Clone, Default)]
pub struct Network {
    auth: Option<(Arc<Credentials>, Arc<AuthBroker>)>,
}

/// Окружение сетевой команды.
pub struct NetOptions {
    pub options: GitOptions,
    _session: Option<AuthSession>,
}

impl Network {
    /// С учётными данными из хранилища.
    pub fn new(credentials: Arc<Credentials>, broker: Arc<AuthBroker>) -> Self {
        Self { auth: Some((credentials, broker)) }
    }

    async fn session(&self, urls: Vec<String>) -> Option<AuthSession> {
        let (credentials, broker) = self.auth.clone()?;
        // База и Keyring — блокирующие вызовы
        tokio::task::spawn_blocking(move || broker.session(credentials.git_auth(&urls)).ok()).await.ok().flatten()
    }

    /// `networkOptions`. `url` — адрес, с которым будет работать git; без него берутся адреса remote репозитория.
    pub async fn options(&self, cwd: &Path, url: Option<&str>) -> NetOptions {
        let mut env = vec![("GIT_TERMINAL_PROMPT".to_owned(), "0".to_owned())];
        let config = NetConfig::read(cwd).await;
        if std::env::var_os("GIT_SSH_COMMAND").is_none_or(|value| value.is_empty()) && std::env::var_os("GIT_SSH").is_none_or(|value| value.is_empty()) && config.ssh_command.is_empty() {
            env.push(("GIT_SSH_COMMAND".to_owned(), "ssh -o BatchMode=yes -o ConnectTimeout=20".to_owned()));
        }
        let urls = match url {
            Some(url) => vec![url.to_owned()],
            None => ordered_urls(cwd, config.remotes).await,
        };
        let session = self.session(urls).await;
        if let Some(session) = &session {
            env.extend(session.env().iter().cloned());
        }
        NetOptions { options: GitOptions { env, timeout: Some(NETWORK_TIMEOUT), input: None }, _session: session }
    }

    /// `net`: команда с сетевым окружением.
    pub async fn git<S: AsRef<OsStr>>(&self, cwd: &Path, args: &[S]) -> Result<String> {
        self.git_at(cwd, None, args).await
    }

    /// Команда с окружением для заданного адреса.
    pub async fn git_at<S: AsRef<OsStr>>(&self, cwd: &Path, url: Option<&str>, args: &[S]) -> Result<String> {
        let net = self.options(cwd, url).await;
        // `net` живёт до конца команды: его `Drop` отзывает секреты
        git_with(cwd, args, net.options.clone()).await
    }
}

/// Настройки, нужные сетевой команде. В 1.x это были два вызова git (`config --get core.sshCommand` и
/// `config --get-regexp ^remote\..*\.url$`); здесь один, с тем же результатом: имена в выводе `--get-regexp` приведены к
/// нижнему регистру, кроме имени remote, а у повторённого `core.sshCommand` действует последнее значение, как у `--get`.
struct NetConfig {
    ssh_command: String,
    remotes: Vec<(String, String)>,
}

impl NetConfig {
    async fn read(cwd: &Path) -> Self {
        let out = git(cwd, &["config", "--get-regexp", r"^(core\.sshcommand|remote\..*\.url)$"]).await.unwrap_or_default();
        Self::parse(&out)
    }

    fn parse(out: &str) -> Self {
        let mut config = Self { ssh_command: String::new(), remotes: Vec::new() };
        for line in out.split('\n') {
            let line = js::trim(line);
            if line == "core.sshcommand" {
                config.ssh_command.clear();
            } else if let Some(value) = line.strip_prefix("core.sshcommand ") {
                config.ssh_command = js::trim(value).to_owned();
            } else if let Some(caps) = REMOTE_URL.captures(line) {
                config.remotes.push((caps[1].to_owned(), caps[2].to_owned()));
            }
        }
        config
    }
}

/// `remoteUrls`.
pub async fn remote_urls(cwd: &Path) -> Vec<String> {
    ordered_urls(cwd, NetConfig::read(cwd).await.remotes).await
}

/// Адреса по порядку: remote текущей ветки, `origin`, остальные.
async fn ordered_urls(cwd: &Path, mut list: Vec<(String, String)>) -> Vec<String> {
    if list.is_empty() {
        return Vec::new();
    }
    let upstream = quiet(cwd, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).await;
    let first = upstream.split_once('/').map_or("origin", |(remote, _)| remote);
    list.sort_by_key(|(name, _)| (name != first, name != "origin"));
    list.into_iter().map(|(_, url)| url).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_config_call_gives_both_settings() {
        let config = NetConfig::parse("remote.origin.url https://h/a.git\ncore.sshcommand ssh -i k\nremote.My Fork.url git@h:b.git\n");
        assert_eq!(config.ssh_command, "ssh -i k");
        assert_eq!(config.remotes, [("origin".to_owned(), "https://h/a.git".to_owned()), ("My Fork".to_owned(), "git@h:b.git".to_owned())]);
        assert_eq!(NetConfig::parse("core.sshcommand ssh -i k\ncore.sshcommand \n").ssh_command, "", "последнее значение, как у --get");
        assert_eq!(NetConfig::parse("core.sshcommand a\ncore.sshcommand\n").ssh_command, "", "ключ без значения");
        assert_eq!(NetConfig::parse("").remotes, []);
    }

    /// Настоящий git: результат совпадает с двумя отдельными вызовами из 1.x.
    #[tokio::test]
    async fn matches_separate_calls_of_1x() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q"]).await.unwrap();
        for (key, value) in [("remote.origin.url", "https://h/a.git"), ("remote.Up.url", "git@h:b.git"), ("core.sshCommand", "ssh -i ключ")] {
            git(root, &["config", "--add", key, value]).await.unwrap();
        }
        let config = NetConfig::read(root).await;
        assert_eq!(config.ssh_command, quiet(root, &["config", "--get", "core.sshCommand"]).await);
        let separate = git(root, &["config", "--get-regexp", r"^remote\..*\.url$"]).await.unwrap();
        let separate: Vec<(String, String)> = separate.lines().filter_map(|line| REMOTE_URL.captures(js::trim(line))).map(|caps| (caps[1].to_owned(), caps[2].to_owned())).collect();
        assert_eq!(config.remotes, separate);
        assert_eq!(config.remotes[1].0, "Up", "имя remote сохраняет регистр");
    }
}
