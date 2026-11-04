//! Входы на remote-серверы. Перенос `electron/credentials.cjs`.
//!
//! # Конспект исходника
//! - Запись `{method, url, username, secret, keyPath, passphrase, apiToken, savedAt}`; `repos[ключ репозитория]` и старые
//!   `hosts[ключ сервера]` (новые в них не пишутся). `entryFor`: своя запись репозитория, иначе общая запись сервера.
//! - `describeEntry`: без секретов; `readable` — для SSH «нет пароля ключа или он читается», иначе «читается secret».
//! - `save`: порядок проверок значим, включая то, что `setServer` срабатывает **до** проверки ключа репозитория. Пустой
//!   `secret` берёт прежний из записи того же способа входа, в том числе из общей записи сервера. `passphrase` сохраняется,
//!   только если тот же `keyPath` и нет `clearPassphrase`. `apiToken` берётся из действующей записи любого способа входа, а
//!   у входа токеном не хранится.
//! - `clear`: своя запись, иначе общая (`shared: true`). `forgetLogin`: по ключу, сначала `repos`, потом `hosts`.
//! - `forgetServer`: все репозитории хоста, общие входы с любым портом и сохранённый тип.
//! - `apiLoginFor`: свой вход (HTTPS раньше SSH) и общий вход. Для GitLab пароль годится только с префиксом токена
//!   `glpat-|gloas-|glsoat-`; deploy-токены (`gldt-`) API не дают.
//! - `envFor`: на один https-сервер — вход первого адреса; для SSH — ключ первого адреса, где он сохранён.
//! - `sshCommand`: `accept-new`, `ConnectTimeout=20`; без пароля ключа `BatchMode=yes`, с паролем вход по паролю и
//!   клавиатуре выключен, чтобы ssh не завис.
//!
//! # Отличия от 1.x
//! - Секреты лежат в Keyring под случайным идентификатором; в базе только идентификатор. Пустой пароль при сохранении
//!   ссылается на ту же запись Keyring, что и прежний вход (в 1.x копировался шифротекст). Поэтому секрет удаляется
//!   только когда на него не осталось ссылок: см. `release`.
//! - Запись нечитаемого секрета из 1.x — идентификатор без записи в Keyring: `hasSecret: true`, `readable: false`. UI
//!   просит ввести заново, как и раньше.
//! - `envFor` разделён: здесь только выбор входа ([`Credentials::git_auth`]), передача в git — в `askpass`.
//! - `detectServer` делает HTTP-запросы и переносится в `gorynych-cicd`; здесь остаётся [`parse_server`].
//! - Сбой чтения базы в `serverKind` и `serverBase` не ошибка: как `try/catch` в 1.x.

pub mod target;

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::{Db, NOW};
use crate::secrets::{SecretStore, new_account};

pub use target::{ParsedServer, RemoteProtocol, RemoteTarget, parse_server, parse_target, repo_key_of, repo_path_of, ssh_url_for};
use target::{server_key, strip_repo_path};

/// Способ входа.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    Token,
    Ssh,
}

impl AuthMethod {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "password" => Some(Self::Password),
            "token" => Some(Self::Token),
            "ssh" => Some(Self::Ssh),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Token => "token",
            Self::Ssh => "ssh",
        }
    }
}

/// Тип сервера.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ServerKind {
    Github,
    Gitlab,
    Gitea,
    Bitbucket,
    Other,
}

impl ServerKind {
    /// Разбирает тип; неизвестный — `None`.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "github" => Some(Self::Github),
            "gitlab" => Some(Self::Gitlab),
            "gitea" => Some(Self::Gitea),
            "bitbucket" => Some(Self::Bitbucket),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
            Self::Gitea => "gitea",
            Self::Bitbucket => "bitbucket",
            Self::Other => "other",
        }
    }
}

/// Облачный сервис: тип известен по домену.
pub fn cloud_kind(hostname: &str) -> Option<ServerKind> {
    match hostname {
        "github.com" => Some(ServerKind::Github),
        "gitlab.com" => Some(ServerKind::Gitlab),
        "bitbucket.org" => Some(ServerKind::Bitbucket),
        "codeberg.org" => Some(ServerKind::Gitea),
        _ => None,
    }
}

/// Тип сервера по имени хоста, без сети.
pub fn guess_kind(hostname: &str) -> Option<ServerKind> {
    let host = hostname.to_lowercase();
    if let Some(kind) = cloud_kind(&host) {
        return Some(kind);
    }
    if host.contains("gitlab") {
        Some(ServerKind::Gitlab)
    } else if host.contains("github") {
        Some(ServerKind::Github)
    } else if host.contains("gitea") || host.contains("forgejo") {
        Some(ServerKind::Gitea)
    } else if host.contains("bitbucket") {
        Some(ServerKind::Bitbucket)
    } else {
        None
    }
}

/// Данные формы входа. Секреты не попадают в `Debug`.
#[derive(Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct LoginInput {
    pub method: Option<String>,
    pub username: Option<String>,
    pub secret: Option<String>,
    pub key_path: Option<String>,
    pub passphrase: Option<String>,
    pub clear_passphrase: bool,
    pub api_token: Option<String>,
    pub clear_api_token: bool,
    pub kind: Option<String>,
}

impl fmt::Debug for LoginInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LoginInput")
            .field("method", &self.method)
            .field("username", &self.username)
            .field("key_path", &self.key_path)
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// Сохранённый вход без секретов.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LoginInfo {
    pub method: AuthMethod,
    pub username: Option<String>,
    pub key_path: Option<String>,
    pub has_secret: bool,
    pub has_passphrase: bool,
    /// Токен для API сервера (пайплайны) — к входу паролем или SSH-ключом, которые API не принимает.
    pub has_api_token: bool,
    pub saved_at: Option<String>,
    pub readable: bool,
}

/// Действующий вход для адреса.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SavedLogin {
    #[serde(flatten)]
    pub info: LoginInfo,
    /// Вход общий для сервера: сохранён до привязки к репозиториям.
    pub shared: bool,
}

/// Что известно об адресе. Секретов нет.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    pub protocol: RemoteProtocol,
    pub scheme: Option<String>,
    pub host: Option<String>,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub url: String,
    pub kind: Option<ServerKind>,
    pub kind_saved: bool,
    pub cloud: bool,
    /// Адрес сайта: для HTTPS — как в remote, для SSH — сохранённый или `https://имя-хоста`.
    pub base: Option<String>,
    pub repo_path: Option<String>,
    pub repo_key: Option<String>,
    pub saved: Option<SavedLogin>,
}

/// Вход репозитория в списке серверов.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RepoLogin {
    pub key: String,
    pub url: Option<String>,
    pub path: String,
    pub protocol: RemoteProtocol,
    #[serde(flatten)]
    pub info: LoginInfo,
}

/// Общий вход сервера в списке серверов.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SharedLogin {
    pub key: String,
    pub protocol: RemoteProtocol,
    #[serde(flatten)]
    pub info: LoginInfo,
}

/// Сервер и привязанные к нему входы.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub hostname: String,
    pub base: String,
    pub repos: Vec<RepoLogin>,
    pub shared: Vec<SharedLogin>,
    pub kind: Option<ServerKind>,
    pub kind_saved: bool,
    pub cloud: bool,
}

/// Итог `clear`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub struct ClearResult {
    pub removed: bool,
    pub shared: bool,
}

/// Итог `forgetLogin` и `forgetServer`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub struct ForgetResult {
    pub removed: bool,
}

/// Вход для API сервера. Содержит секрет и в UI не передаётся.
#[derive(Clone, PartialEq, Eq)]
pub struct ApiLogin {
    pub secret: String,
    pub method: AuthMethod,
    pub via_api_token: bool,
    pub username: Option<String>,
    pub key: String,
    pub url: Option<String>,
    pub saved_at: Option<String>,
    pub shared: bool,
}

impl fmt::Debug for ApiLogin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApiLogin").field("method", &self.method).field("key", &self.key).finish_non_exhaustive()
    }
}

/// Вход есть, но для API не годится.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnusableLogin {
    pub method: AuthMethod,
    pub key: String,
    pub unreadable: bool,
}

/// Итог `apiLoginFor`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ApiLogins {
    pub repo: Option<ApiLogin>,
    pub shared: Option<ApiLogin>,
    pub other: Option<UnusableLogin>,
}

/// HTTPS-вход для git.
#[derive(Clone, PartialEq, Eq)]
pub struct HttpsAuth {
    /// Ключ сервера: `https://host[:порт]`.
    pub server: String,
    pub username: String,
    pub secret: String,
}

impl fmt::Debug for HttpsAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpsAuth").field("server", &self.server).field("username", &self.username).finish_non_exhaustive()
    }
}

/// SSH-вход для git.
#[derive(Clone, PartialEq, Eq)]
pub struct SshAuth {
    pub key_path: String,
    pub passphrase: Option<String>,
}

impl fmt::Debug for SshAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshAuth").field("key_path", &self.key_path).finish_non_exhaustive()
    }
}

/// Что передать git для набора адресов репозитория.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GitAuth {
    pub https: Vec<HttpsAuth>,
    pub ssh: Option<SshAuth>,
}

/// Секрет записи из 1.x при переносе.
#[derive(Clone, Default, PartialEq, Eq)]
pub enum LegacySecret {
    #[default]
    Absent,
    /// Значение известно и будет записано в Keyring.
    Value(String),
    /// Секрет был, но расшифровать его нельзя: пользователь введёт его заново.
    Unreadable,
}

impl fmt::Debug for LegacySecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Absent => "Absent",
            Self::Value(_) => "Value(…)",
            Self::Unreadable => "Unreadable",
        })
    }
}

/// Область записи.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginScope {
    /// Вход репозитория: ключ из [`repo_key_of`].
    Repo,
    /// Общий вход сервера из старых версий: ключ сервера.
    Host,
}

impl LoginScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Repo => "repo",
            Self::Host => "host",
        }
    }
}

/// Запись `remote-credentials.json` при переносе.
#[derive(Debug, Clone)]
pub struct LegacyLogin {
    pub scope: LoginScope,
    pub key: String,
    pub method: AuthMethod,
    pub url: Option<String>,
    pub username: Option<String>,
    pub key_path: Option<String>,
    pub secret: LegacySecret,
    pub passphrase: LegacySecret,
    pub api_token: LegacySecret,
    pub saved_at: Option<String>,
}

#[derive(Debug, Clone)]
struct Entry {
    key: String,
    method: AuthMethod,
    url: Option<String>,
    username: Option<String>,
    key_path: Option<String>,
    secret: Option<String>,
    passphrase: Option<String>,
    api_token: Option<String>,
    saved_at: Option<String>,
}

impl Entry {
    fn accounts(self) -> [Option<String>; 3] {
        [self.secret, self.passphrase, self.api_token]
    }
}

#[derive(Debug, Clone)]
struct Server {
    hostname: String,
    kind: ServerKind,
    base: Option<String>,
}

#[derive(Debug, Default)]
struct Store {
    repos: Vec<Entry>,
    hosts: Vec<Entry>,
    servers: Vec<Server>,
}

impl Store {
    fn repo(&self, key: Option<&str>) -> Option<&Entry> {
        let key = key?;
        self.repos.iter().find(|entry| entry.key == key)
    }

    fn host(&self, key: &str) -> Option<&Entry> {
        self.hosts.iter().find(|entry| entry.key == key)
    }

    fn server(&self, hostname: &str) -> Option<&Server> {
        self.servers.iter().find(|server| server.hostname == hostname)
    }

    /// Действующая запись адреса и признак общего входа.
    fn entry_for(&self, url: &str) -> (Option<&Entry>, bool) {
        let target = parse_target(url);
        if target.host.is_none() {
            return (None, false);
        }
        if let Some(own) = self.repo(repo_key_of(url).as_deref()) {
            return (Some(own), false);
        }
        match self.host(&server_key(&target)) {
            Some(host) => (Some(host), true),
            None => (None, false),
        }
    }

    fn server_kind(&self, hostname: &str) -> Option<ServerKind> {
        let host = strip_port(&hostname.to_lowercase()).to_owned();
        if host.is_empty() {
            return None;
        }
        self.server(&host).map(|server| server.kind).or_else(|| guess_kind(&host))
    }
}

fn token_user_for(kind: Option<ServerKind>) -> &'static str {
    match kind {
        Some(ServerKind::Gitlab) => "oauth2",
        Some(ServerKind::Bitbucket) => "x-token-auth",
        _ => "git",
    }
}

/// `.replace(/:\d+$/, '')`.
fn strip_port(host: &str) -> &str {
    match host.rsplit_once(':') {
        Some((head, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => host,
    }
}

fn read_entries(conn: &Connection, scope: LoginScope) -> rusqlite::Result<Vec<Entry>> {
    conn.prepare_cached(
        "SELECT key, method, url, username, key_path, secret_account, passphrase_account, api_token_account, saved_at
         FROM credential_logins WHERE scope = ?1 ORDER BY id",
    )?
    .query_map([scope.as_str()], |row| {
        let method: String = row.get(1)?;
        Ok(Entry {
            key: row.get(0)?,
            // Столбец ограничен CHECK теми же значениями.
            method: AuthMethod::parse(&method).unwrap_or(AuthMethod::Password),
            url: row.get(2)?,
            username: row.get(3)?,
            key_path: row.get(4)?,
            secret: row.get(5)?,
            passphrase: row.get(6)?,
            api_token: row.get(7)?,
            saved_at: row.get(8)?,
        })
    })?
    .collect()
}

fn read_store(db: &Db) -> Result<Store> {
    db.with(|conn| {
        let servers = conn
            .prepare_cached("SELECT hostname, kind, base FROM credential_servers")?
            .query_map([], |row| {
                let kind: String = row.get(1)?;
                Ok(Server {
                    hostname: row.get(0)?,
                    kind: ServerKind::parse(&kind).unwrap_or(ServerKind::Other),
                    base: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(Store { repos: read_entries(conn, LoginScope::Repo)?, hosts: read_entries(conn, LoginScope::Host)?, servers })
    })
}

fn delete_entry(db: &Db, scope: LoginScope, key: &str) -> Result<()> {
    db.with(|conn| conn.execute("DELETE FROM credential_logins WHERE scope = ?1 AND key = ?2", params![scope.as_str(), key]))?;
    Ok(())
}

fn bad_args(message: &str) -> GorynychError {
    GorynychError::new(ErrorCode::BadArgs, t(message, &[]))
}

/// `credential_logins` с той же областью и ключом обновляются на месте: id, а значит и порядок, сохраняются.
struct NewEntry<'a> {
    scope: LoginScope,
    key: &'a str,
    method: AuthMethod,
    url: Option<&'a str>,
    username: Option<&'a str>,
    key_path: Option<&'a str>,
    secret: Option<&'a str>,
    passphrase: Option<&'a str>,
    api_token: Option<&'a str>,
    /// `Now` — при сохранении; `Kept` — при переносе: дата из 1.x, возможно отсутствующая.
    saved_at: SavedAt<'a>,
}

#[derive(Clone, Copy)]
enum SavedAt<'a> {
    Now,
    Kept(Option<&'a str>),
}

fn upsert_entry(db: &Db, entry: &NewEntry<'_>) -> Result<()> {
    let (stamp_now, kept) = match entry.saved_at {
        SavedAt::Now => (true, None),
        SavedAt::Kept(value) => (false, value),
    };
    db.with(|conn| {
        conn.execute(
            &format!(
                "INSERT INTO credential_logins
                   (scope, key, method, url, username, key_path, secret_account, passphrase_account, api_token_account, saved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CASE WHEN ?11 THEN {NOW} ELSE ?10 END)
                 ON CONFLICT (scope, key) DO UPDATE SET
                   method = excluded.method, url = excluded.url, username = excluded.username, key_path = excluded.key_path,
                   secret_account = excluded.secret_account, passphrase_account = excluded.passphrase_account,
                   api_token_account = excluded.api_token_account, saved_at = excluded.saved_at"
            ),
            params![
                entry.scope.as_str(),
                entry.key,
                entry.method.as_str(),
                entry.url,
                entry.username,
                entry.key_path,
                entry.secret,
                entry.passphrase,
                entry.api_token,
                kept,
                stamp_now
            ],
        )
    })?;
    Ok(())
}

/// `shQuote`.
pub(crate) fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// Команда ssh для git.
pub fn ssh_command(key_path: &str, with_passphrase: bool) -> String {
    let posix = key_path.replace('\\', "/");
    let mut parts = vec!["ssh", "-i"];
    let quoted = sh_quote(&posix);
    parts.push(&quoted);
    parts.extend(["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20"]);
    if with_passphrase {
        parts.extend(["-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no"]);
    } else {
        parts.extend(["-o", "BatchMode=yes"]);
    }
    parts.join(" ")
}

/// Менеджер входов: база плюс хранилище секретов.
pub struct Credentials {
    db: Arc<Db>,
    secrets: Arc<dyn SecretStore>,
    /// Изменения идут по одному: они читают записи, пишут в Keyring и обновляют базу.
    write: Mutex<()>,
}

impl Credentials {
    pub fn new(db: Arc<Db>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { db, secrets, write: Mutex::new(()) }
    }

    fn lock(&self) -> MutexGuard<'_, ()> {
        self.write.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn decrypt(&self, account: Option<&str>) -> Option<String> {
        self.secrets.get(account?)
    }

    /// Записывает секрет под новым идентификатором.
    fn store_secret(&self, secret: &str, written: &mut Vec<String>) -> Result<String> {
        let account = new_account()?;
        self.secrets.set(&account, secret)?;
        written.push(account.clone());
        Ok(account)
    }

    fn rollback(&self, written: &[String]) {
        for account in written {
            let _ = self.secrets.delete(account);
        }
    }

    /// Удаляет секреты, на которые больше не ссылается ни одна запись. Сбой не страшен: остаётся недостижимая запись.
    fn release(&self, accounts: impl IntoIterator<Item = Option<String>>) {
        for account in accounts.into_iter().flatten() {
            let in_use: Result<bool> = self.db.with(|conn| {
                conn.query_row(
                    "SELECT EXISTS (SELECT 1 FROM credential_logins
                     WHERE secret_account = ?1 OR passphrase_account = ?1 OR api_token_account = ?1)",
                    [&account],
                    |row| row.get(0),
                )
            });
            if matches!(in_use, Ok(false)) {
                let _ = self.secrets.delete(&account);
            }
        }
    }

    fn describe_entry(&self, entry: &Entry) -> LoginInfo {
        let readable = if entry.method == AuthMethod::Ssh {
            entry.passphrase.is_none() || self.decrypt(entry.passphrase.as_deref()).is_some()
        } else {
            self.decrypt(entry.secret.as_deref()).is_some()
        };
        LoginInfo {
            method: entry.method,
            username: entry.username.clone(),
            key_path: entry.key_path.clone(),
            has_secret: entry.secret.is_some(),
            has_passphrase: entry.passphrase.is_some(),
            has_api_token: entry.api_token.is_some(),
            saved_at: entry.saved_at.clone(),
            readable,
        }
    }

    fn describe_with(&self, url: &str, store: &Store) -> TargetInfo {
        let target = parse_target(url);
        let mut info = TargetInfo {
            protocol: target.protocol,
            scheme: target.scheme.clone(),
            host: target.host.clone(),
            hostname: target.hostname.clone(),
            user: target.user.clone(),
            url: target.url.clone(),
            kind: None,
            kind_saved: false,
            cloud: false,
            base: None,
            repo_path: None,
            repo_key: None,
            saved: None,
        };
        let (Some(host), Some(hostname)) = (&target.host, &target.hostname) else {
            return info;
        };
        info.kind = store.server_kind(hostname);
        info.kind_saved = store.server(hostname).is_some();
        info.cloud = cloud_kind(hostname).is_some();
        info.base = Some(if target.protocol == RemoteProtocol::Https {
            format!("{}://{host}", target.scheme.as_deref().unwrap_or_default())
        } else {
            store
                .server(hostname)
                .and_then(|server| server.base.clone())
                .unwrap_or_else(|| format!("https://{hostname}"))
        });
        let path = repo_path_of(url);
        info.repo_path = (!path.is_empty()).then_some(path);
        info.repo_key = repo_key_of(url);
        let (entry, shared) = store.entry_for(url);
        info.saved = entry.map(|entry| SavedLogin { info: self.describe_entry(entry), shared });
        info
    }

    /// Что сохранено для адреса: без секретов.
    pub fn describe(&self, url: &str) -> Result<TargetInfo> {
        Ok(self.describe_with(url, &read_store(&self.db)?))
    }

    /// Тип сервера: выбранный пользователем важнее догадки по имени.
    pub fn server_kind(&self, hostname: &str) -> Option<ServerKind> {
        match read_store(&self.db) {
            Ok(store) => store.server_kind(hostname),
            Err(_) => {
                let host = hostname.to_lowercase();
                let host = strip_port(&host);
                if host.is_empty() { None } else { guess_kind(host) }
            }
        }
    }

    /// Адрес сайта сервера, выбранный в окне входа.
    pub fn server_base(&self, hostname: &str) -> Option<String> {
        let store = read_store(&self.db).ok()?;
        store.server(&hostname.to_lowercase())?.base.clone()
    }

    /// Логин по умолчанию для токена: GitLab — `oauth2`, Bitbucket — `x-token-auth`, остальные — `git`.
    pub fn default_token_user(&self, host: &str) -> &'static str {
        token_user_for(self.server_kind(host))
    }

    fn set_server_locked(&self, hostname: &str, kind: &str, base: Option<&str>) -> Result<()> {
        let host = hostname.to_lowercase();
        if host.is_empty() {
            return Ok(());
        }
        let Some(kind) = ServerKind::parse(kind) else {
            return Err(bad_args("Неизвестный тип сервера"));
        };
        self.db.with(|conn| {
            // Облако не запоминаем: github.com и так GitHub
            if cloud_kind(&host) == Some(kind) {
                conn.execute("DELETE FROM credential_servers WHERE hostname = ?1", [&host])?;
            } else {
                let current: Option<String> = conn
                    .query_row("SELECT base FROM credential_servers WHERE hostname = ?1", [&host], |row| row.get(0))
                    .optional()?
                    .flatten();
                conn.execute(
                    &format!(
                        "INSERT INTO credential_servers (hostname, kind, base, saved_at) VALUES (?1, ?2, ?3, {NOW})
                         ON CONFLICT (hostname) DO UPDATE SET
                           kind = excluded.kind, base = excluded.base, saved_at = excluded.saved_at"
                    ),
                    params![host, kind.as_str(), base.map(str::to_owned).or(current)],
                )?;
            }
            Ok(())
        })
    }

    /// Запоминает тип сервера и адрес сайта.
    pub fn set_server(&self, hostname: &str, kind: &str, base: Option<&str>) -> Result<()> {
        let _guard = self.lock();
        self.set_server_locked(hostname, kind, base)
    }

    /// Серверы и привязанные к ним входы, без секретов.
    pub fn list_servers(&self) -> Result<Vec<ServerInfo>> {
        struct Draft {
            hostname: String,
            base: Option<String>,
            repos: Vec<RepoLogin>,
            shared: Vec<SharedLogin>,
        }
        fn draft<'a>(list: &'a mut Vec<Draft>, hostname: &str) -> &'a mut Draft {
            let index = list.iter().position(|d| d.hostname == hostname).unwrap_or_else(|| {
                list.push(Draft { hostname: hostname.to_owned(), base: None, repos: vec![], shared: vec![] });
                list.len() - 1
            });
            &mut list[index]
        }

        let store = read_store(&self.db)?;
        let mut drafts: Vec<Draft> = Vec::new();
        for entry in &store.repos {
            let url = entry.url.as_deref().unwrap_or_default();
            let target = parse_target(url);
            let Some(hostname) = &target.hostname else {
                continue;
            };
            let srv = draft(&mut drafts, hostname);
            if target.protocol == RemoteProtocol::Https && srv.base.is_none() {
                srv.base = Some(server_key(&target));
            }
            srv.repos.push(RepoLogin {
                key: entry.key.clone(),
                url: entry.url.clone(),
                path: repo_path_of(url),
                protocol: target.protocol,
                info: self.describe_entry(entry),
            });
        }
        for entry in &store.hosts {
            let Some((scheme, rest)) = entry.key.split_once("://") else {
                continue;
            };
            if !matches!(scheme, "http" | "https" | "ssh") || rest.is_empty() {
                continue;
            }
            let ssh = scheme == "ssh";
            let srv = draft(&mut drafts, strip_port(rest));
            if !ssh && srv.base.is_none() {
                srv.base = Some(entry.key.clone());
            }
            srv.shared.push(SharedLogin {
                key: entry.key.clone(),
                protocol: if ssh { RemoteProtocol::Ssh } else { RemoteProtocol::Https },
                info: self.describe_entry(entry),
            });
        }
        for server in &store.servers {
            let srv = draft(&mut drafts, &server.hostname);
            if srv.base.is_none() {
                srv.base.clone_from(&server.base);
            }
        }
        let mut servers: Vec<ServerInfo> = drafts
            .into_iter()
            .map(|mut srv| {
                srv.repos.sort_by(|x, y| js::locale_cmp(&x.path, &y.path));
                ServerInfo {
                    base: srv.base.unwrap_or_else(|| format!("https://{}", srv.hostname)),
                    repos: srv.repos,
                    shared: srv.shared,
                    kind: store.server_kind(&srv.hostname),
                    kind_saved: store.server(&srv.hostname).is_some(),
                    cloud: cloud_kind(&srv.hostname).is_some(),
                    hostname: srv.hostname,
                }
            })
            .collect();
        servers.sort_by(|a, b| b.cloud.cmp(&a.cloud).then_with(|| js::locale_cmp(&a.hostname, &b.hostname)));
        Ok(servers)
    }

    /// Забывает сервер целиком: входы репозиториев, общий вход и выбранный тип.
    pub fn forget_server(&self, hostname: &str) -> Result<ForgetResult> {
        let _guard = self.lock();
        let host = hostname.to_lowercase();
        let store = read_store(&self.db)?;
        let mut removed = false;
        let mut accounts = Vec::new();
        for entry in store.repos {
            if parse_target(entry.url.as_deref().unwrap_or_default()).hostname.as_deref() == Some(&host) {
                delete_entry(&self.db, LoginScope::Repo, &entry.key)?;
                accounts.extend(entry.accounts());
                removed = true;
            }
        }
        for entry in store.hosts {
            let Some((scheme, rest)) = entry.key.split_once("://") else {
                continue;
            };
            if matches!(scheme, "http" | "https" | "ssh") && !rest.is_empty() && strip_port(rest) == host {
                delete_entry(&self.db, LoginScope::Host, &entry.key)?;
                accounts.extend(entry.accounts());
                removed = true;
            }
        }
        if store.servers.iter().any(|server| server.hostname == host) {
            self.db.with(|conn| conn.execute("DELETE FROM credential_servers WHERE hostname = ?1", [&host]))?;
            removed = true;
        }
        self.release(accounts);
        Ok(ForgetResult { removed })
    }

    /// Сохраняет вход для репозитория. Пустой секрет при уже сохранённом значении оставляет прежний.
    pub fn save(&self, url: &str, data: &LoginInput) -> Result<TargetInfo> {
        let _guard = self.lock();
        let target = parse_target(url);
        let Some(host) = target.host.as_deref() else {
            return Err(bad_args("Для локального адреса учётные данные не нужны"));
        };
        let Some(method) = data.method.as_deref().and_then(AuthMethod::parse) else {
            return Err(bad_args("Не выбран способ входа"));
        };
        if method != AuthMethod::Ssh && target.protocol != RemoteProtocol::Https {
            return Err(bad_args("Логин/пароль и токен работают только для адресов https://")
                .with_hint(t("Адрес remote — SSH. Выберите вкладку «SSH-ключ» или смените адрес remote на https://.", &[])));
        }
        if method == AuthMethod::Ssh && target.protocol != RemoteProtocol::Ssh {
            return Err(bad_args("SSH-ключ работает только для адресов SSH (git@host:… или ssh://…)")
                .with_hint(t("Адрес remote — https://. Войдите логином и паролем или токеном, либо смените адрес remote на SSH.", &[])));
        }
        // Тип сервера, выбранный в окне входа, — до логина по умолчанию: он от типа зависит
        if let Some(kind) = data.kind.as_deref().filter(|kind| ServerKind::parse(kind).is_some()) {
            let base = (target.protocol == RemoteProtocol::Https).then(|| server_key(&target));
            self.set_server_locked(target.hostname.as_deref().unwrap_or_default(), kind, base.as_deref())?;
        }
        let Some(key) = repo_key_of(url) else {
            return Err(bad_args("Укажите адрес репозитория").with_hint(t("Например: https://gitlab.com/group/project.git", &[])));
        };

        let store = read_store(&self.db)?;
        let (current, _) = store.entry_for(url);
        let prev = current.filter(|entry| entry.method == method);

        // Сначала все проверки, потом запись: неверные данные не оставляют следов в Keyring.
        let mut username = None;
        let mut key_path = None;
        let mut new_secret = None;
        let mut new_passphrase = None;
        let mut secret_account = None;
        let mut passphrase_account = None;
        match method {
            AuthMethod::Password | AuthMethod::Token => {
                let typed = js::trim(data.username.as_deref().unwrap_or_default());
                let name = if !typed.is_empty() {
                    typed
                } else if method == AuthMethod::Token {
                    token_user_for(store.server_kind(host))
                } else {
                    ""
                };
                if name.is_empty() {
                    return Err(bad_args("Введите имя пользователя"));
                }
                let secret = data.secret.as_deref().unwrap_or_default();
                let prev_secret = prev.and_then(|entry| entry.secret.clone());
                if secret.is_empty() && prev_secret.is_none() {
                    let message = if method == AuthMethod::Token { "Введите токен" } else { "Введите пароль" };
                    return Err(bad_args(message));
                }
                if name.contains(['\r', '\n']) || secret.contains(['\r', '\n']) {
                    return Err(bad_args("Перевод строки в логине или пароле недопустим"));
                }
                username = Some(name.to_owned());
                if secret.is_empty() {
                    secret_account = prev_secret;
                } else {
                    new_secret = Some(secret);
                }
            }
            AuthMethod::Ssh => {
                let path = js::trim(data.key_path.as_deref().unwrap_or_default());
                if path.is_empty() {
                    return Err(bad_args("Выберите файл приватного ключа"));
                }
                if !std::path::Path::new(path).exists() {
                    return Err(bad_args("Файл ключа не найден").with_hint(path));
                }
                if path.ends_with(".pub") {
                    return Err(bad_args("Это публичный ключ (.pub) — выберите приватный, без расширения"));
                }
                key_path = Some(path.to_owned());
                let passphrase = data.passphrase.as_deref().unwrap_or_default();
                if !passphrase.is_empty() {
                    new_passphrase = Some(passphrase);
                } else if !data.clear_passphrase && prev.and_then(|entry| entry.key_path.as_deref()) == Some(path) {
                    passphrase_account = prev.and_then(|entry| entry.passphrase.clone());
                }
            }
        }
        let mut new_api_token = None;
        let mut api_token_account = None;
        if method != AuthMethod::Token {
            let api_token = js::trim(data.api_token.as_deref().unwrap_or_default());
            if !api_token.is_empty() {
                if api_token.contains(js::is_whitespace) {
                    return Err(bad_args("В токене для пайплайнов не должно быть пробелов"));
                }
                new_api_token = Some(api_token);
            } else if !data.clear_api_token {
                api_token_account = current.and_then(|entry| entry.api_token.clone());
            }
        }

        let mut written = Vec::new();
        let result = (|| {
            if let Some(secret) = new_secret {
                secret_account = Some(self.store_secret(secret, &mut written)?);
            }
            if let Some(passphrase) = new_passphrase {
                passphrase_account = Some(self.store_secret(passphrase, &mut written)?);
            }
            if let Some(api_token) = new_api_token {
                api_token_account = Some(self.store_secret(api_token, &mut written)?);
            }
            upsert_entry(
                &self.db,
                &NewEntry {
                    scope: LoginScope::Repo,
                    key: &key,
                    method,
                    url: Some(js::trim(url)),
                    username: username.as_deref(),
                    key_path: key_path.as_deref(),
                    secret: secret_account.as_deref(),
                    passphrase: passphrase_account.as_deref(),
                    api_token: api_token_account.as_deref(),
                    saved_at: SavedAt::Now,
                },
            )
        })();
        if let Err(error) = result {
            self.rollback(&written);
            return Err(error);
        }
        if let Some(old) = store.repo(Some(&key)) {
            self.release(old.clone().accounts());
        }
        self.describe(url)
    }

    /// Добавляет токен для API ко входу репозитория (перенос старого отдельного токена CI/CD).
    pub fn attach_api_token(&self, key: &str, token: &str) -> Result<bool> {
        let _guard = self.lock();
        let store = read_store(&self.db)?;
        let Some(entry) = store.repo(Some(key)) else {
            return Ok(false);
        };
        if entry.method == AuthMethod::Token || entry.api_token.is_some() {
            return Ok(false);
        }
        let mut written = Vec::new();
        let account = self.store_secret(token, &mut written)?;
        let updated = self.db.with(|conn| {
            conn.execute(
                "UPDATE credential_logins SET api_token_account = ?1 WHERE scope = ?2 AND key = ?3",
                params![account, LoginScope::Repo.as_str(), key],
            )
        });
        if let Err(error) = updated {
            self.rollback(&written);
            return Err(error);
        }
        Ok(true)
    }

    /// Забывает вход репозитория; если своего нет, а действует общий вход сервера — забывает его.
    pub fn clear(&self, url: &str) -> Result<ClearResult> {
        let _guard = self.lock();
        let target = parse_target(url);
        let store = read_store(&self.db)?;
        if let Some(entry) = store.repo(repo_key_of(url).as_deref()) {
            delete_entry(&self.db, LoginScope::Repo, &entry.key)?;
            self.release(entry.clone().accounts());
            return Ok(ClearResult { removed: true, shared: false });
        }
        if target.host.is_some()
            && let Some(entry) = store.host(&server_key(&target))
        {
            delete_entry(&self.db, LoginScope::Host, &entry.key)?;
            self.release(entry.clone().accounts());
            return Ok(ClearResult { removed: true, shared: true });
        }
        Ok(ClearResult { removed: false, shared: false })
    }

    /// Забывает одну запись по ключу из списка серверов.
    pub fn forget_login(&self, key: &str) -> Result<ForgetResult> {
        let _guard = self.lock();
        let store = read_store(&self.db)?;
        let found = match store.repo(Some(key)) {
            Some(entry) => Some((LoginScope::Repo, entry)),
            None => store.host(key).map(|entry| (LoginScope::Host, entry)),
        };
        let Some((scope, entry)) = found else {
            return Ok(ForgetResult { removed: false });
        };
        delete_entry(&self.db, scope, key)?;
        self.release(entry.clone().accounts());
        Ok(ForgetResult { removed: true })
    }

    /// Вход для API сервера. `kind` влияет на то, годится ли пароль: GitLab принимает только токены.
    pub fn api_login_for(&self, hostname: &str, repo_path: &str, kind: Option<ServerKind>) -> Result<ApiLogins> {
        let host = hostname.to_lowercase();
        let path_lower = repo_path.to_lowercase();
        let path = strip_repo_path(&path_lower);
        let store = read_store(&self.db)?;

        let password_ok = |entry: &Entry| {
            if kind == Some(ServerKind::Gitlab) {
                self.decrypt(entry.secret.as_deref())
                    .is_some_and(|secret| ["glpat-", "gloas-", "glsoat-"].iter().any(|prefix| secret.starts_with(prefix)))
            } else {
                entry.secret.is_some()
            }
        };
        let usable = |entry: &Entry| {
            entry.api_token.is_some()
                || entry.method == AuthMethod::Token
                || (entry.method == AuthMethod::Password && password_ok(entry))
        };
        let pack = |entry: &Entry, shared: bool| {
            let via_api_token = entry.api_token.is_some();
            let account = if via_api_token { &entry.api_token } else { &entry.secret };
            Some(ApiLogin {
                secret: self.decrypt(account.as_deref())?,
                method: entry.method,
                via_api_token,
                username: entry.username.clone(),
                key: entry.key.clone(),
                url: entry.url.clone(),
                saved_at: entry.saved_at.clone(),
                shared,
            })
        };

        // HTTPS-вход раньше SSH: у одного репозитория могут быть оба (адрес remote меняли)
        let mut own: Vec<&Entry> = store
            .repos
            .iter()
            .filter(|entry| {
                let url = entry.url.as_deref().unwrap_or_default();
                parse_target(url).hostname.as_deref() == Some(&host) && repo_path_of(url).to_lowercase() == path
            })
            .collect();
        own.sort_by_key(|entry| entry.method == AuthMethod::Ssh);

        let mut repo = None;
        let mut other = None;
        for entry in own {
            if usable(entry) {
                repo = pack(entry, false);
                if repo.is_some() {
                    break;
                }
            } else if other.is_none() {
                other = Some(UnusableLogin {
                    method: entry.method,
                    key: entry.key.clone(),
                    unreadable: entry.method != AuthMethod::Ssh && self.decrypt(entry.secret.as_deref()).is_none(),
                });
            }
        }
        let mut shared = None;
        for entry in &store.hosts {
            let Some((scheme, rest)) = entry.key.split_once("://") else {
                continue;
            };
            if matches!(scheme, "http" | "https") && !rest.is_empty() && strip_port(rest) == host && usable(entry) {
                shared = pack(entry, true);
                if shared.is_some() {
                    break;
                }
            }
        }
        let other = if repo.is_some() { None } else { other };
        Ok(ApiLogins { repo, shared, other })
    }

    /// Что передать git для адресов репозитория; remote текущей ветки идёт первым. Сбой базы — пустой итог.
    pub fn git_auth<S: AsRef<str>>(&self, urls: &[S]) -> GitAuth {
        let Ok(store) = read_store(&self.db) else {
            return GitAuth::default();
        };
        let mut auth = GitAuth::default();
        for url in urls {
            let url = url.as_ref();
            let target = parse_target(url);
            if target.host.is_none() {
                continue;
            }
            let (entry, _) = store.entry_for(url);
            let Some(entry) = entry else {
                continue;
            };
            if target.protocol == RemoteProtocol::Https {
                // Один helper на сервер: вход первого адреса
                let server = server_key(&target);
                if auth.https.iter().any(|login| login.server == server) || entry.method == AuthMethod::Ssh {
                    continue;
                }
                let (Some(secret), Some(username)) = (self.decrypt(entry.secret.as_deref()), entry.username.as_deref().filter(|name| !name.is_empty())) else {
                    continue;
                };
                auth.https.push(HttpsAuth { server, username: username.to_owned(), secret });
            } else if target.protocol == RemoteProtocol::Ssh && auth.ssh.is_none() && entry.method == AuthMethod::Ssh {
                let Some(key_path) = entry.key_path.as_deref().filter(|path| !path.is_empty()) else {
                    continue;
                };
                let passphrase = self.decrypt(entry.passphrase.as_deref()).filter(|text| !text.is_empty());
                auth.ssh = Some(SshAuth { key_path: key_path.to_owned(), passphrase });
            }
        }
        auth
    }

    fn import_secret(&self, secret: &LegacySecret, written: &mut Vec<String>) -> Result<Option<String>> {
        match secret {
            LegacySecret::Absent => Ok(None),
            LegacySecret::Value(value) => self.store_secret(value, written).map(Some),
            LegacySecret::Unreadable => new_account().map(Some),
        }
    }

    /// Переносит запись из 1.x. Существующий вход не перезаписывается.
    pub fn import_login(&self, login: &LegacyLogin) -> Result<()> {
        let _guard = self.lock();
        let exists: bool = self.db.with(|conn| {
            conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM credential_logins WHERE scope = ?1 AND key = ?2)",
                params![login.scope.as_str(), login.key],
                |row| row.get(0),
            )
        })?;
        if exists {
            return Ok(());
        }
        let mut written = Vec::new();
        let result = (|| {
            let secret = self.import_secret(&login.secret, &mut written)?;
            let passphrase = self.import_secret(&login.passphrase, &mut written)?;
            let api_token = self.import_secret(&login.api_token, &mut written)?;
            upsert_entry(
                &self.db,
                &NewEntry {
                    scope: login.scope,
                    key: &login.key,
                    method: login.method,
                    url: login.url.as_deref(),
                    username: login.username.as_deref(),
                    key_path: login.key_path.as_deref(),
                    secret: secret.as_deref(),
                    passphrase: passphrase.as_deref(),
                    api_token: api_token.as_deref(),
                    saved_at: SavedAt::Kept(login.saved_at.as_deref()),
                },
            )
        })();
        if result.is_err() {
            self.rollback(&written);
        }
        result
    }

    /// Переносит сохранённый тип сервера из 1.x.
    pub fn import_server(&self, hostname: &str, kind: ServerKind, base: Option<&str>, saved_at: Option<&str>) -> Result<()> {
        let _guard = self.lock();
        self.db.with(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO credential_servers (hostname, kind, base, saved_at) VALUES (?1, ?2, ?3, ?4)",
                params![hostname.to_lowercase(), kind.as_str(), base, saved_at],
            )
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::memory::MemoryStore;
    use std::sync::atomic::Ordering;

    const URL: &str = "https://gitlab.company.ru/group/app.git";

    struct Fixture {
        secrets: Arc<MemoryStore>,
        creds: Credentials,
    }

    fn fixture() -> Fixture {
        let secrets = Arc::new(MemoryStore::default());
        let creds = Credentials::new(Arc::new(Db::open_in_memory()), secrets.clone());
        Fixture { secrets, creds }
    }

    fn login(method: &str, username: &str, secret: &str) -> LoginInput {
        LoginInput {
            method: Some(method.into()),
            username: Some(username.into()),
            secret: Some(secret.into()),
            ..LoginInput::default()
        }
    }

    impl Fixture {
        fn secret_count(&self) -> usize {
            self.secrets.values.lock().unwrap().len()
        }

        fn all_secrets(&self) -> Vec<String> {
            self.secrets.values.lock().unwrap().values().cloned().collect()
        }
    }

    #[test]
    fn database_never_contains_secret_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let creds = Credentials::new(Arc::new(Db::open(&path).unwrap()), Arc::new(MemoryStore::default()));
        let mut input = login("password", "user", "СЕКРЕТ-пароль");
        input.api_token = Some("СЕКРЕТ-токен".into());
        creds.save(URL, &input).unwrap();
        drop(creds);

        let mut bytes = std::fs::read(&path).unwrap();
        for extra in ["state.db-wal", "state.db-shm"] {
            if let Ok(more) = std::fs::read(dir.path().join(extra)) {
                bytes.extend(more);
            }
        }
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("gitlab.company.ru"), "файл базы действительно прочитан");
        assert!(!text.contains("СЕКРЕТ"));
    }

    #[test]
    fn debug_output_hides_secrets() {
        let mut input = login("password", "user", "СЕКРЕТ");
        input.passphrase = Some("СЕКРЕТ".into());
        input.api_token = Some("СЕКРЕТ".into());
        let auth = HttpsAuth { server: "s".into(), username: "u".into(), secret: "СЕКРЕТ".into() };
        let ssh = SshAuth { key_path: "k".into(), passphrase: Some("СЕКРЕТ".into()) };
        let printed = format!("{input:?} {auth:?} {ssh:?} {:?}", LegacySecret::Value("СЕКРЕТ".into()));
        assert!(!printed.contains("СЕКРЕТ"), "{printed}");
    }

    #[test]
    fn replacing_a_secret_removes_the_old_one_from_keyring() {
        let f = fixture();
        f.creds.save(URL, &login("password", "user", "первый")).unwrap();
        f.creds.save(URL, &login("password", "user", "второй")).unwrap();
        assert_eq!(f.all_secrets(), ["второй"]);
    }

    #[test]
    fn empty_secret_keeps_previous_value_without_copying() {
        let f = fixture();
        f.creds.save(URL, &login("password", "user", "пароль")).unwrap();
        f.creds.save(URL, &login("password", "другой", "")).unwrap();
        assert_eq!(f.all_secrets(), ["пароль"], "секрет не удалён и не продублирован");
        assert_eq!(f.creds.describe(URL).unwrap().saved.unwrap().info.username.as_deref(), Some("другой"));
    }

    #[test]
    fn shared_secret_survives_until_last_reference_is_gone() {
        let f = fixture();
        f.creds
            .import_login(&LegacyLogin {
                scope: LoginScope::Host,
                key: "https://gitlab.company.ru".into(),
                method: AuthMethod::Password,
                url: None,
                username: Some("user".into()),
                key_path: None,
                secret: LegacySecret::Value("общий".into()),
                passphrase: LegacySecret::Absent,
                api_token: LegacySecret::Absent,
                saved_at: None,
            })
            .unwrap();
        // Пустой пароль: вход репозитория ссылается на секрет общего входа
        f.creds.save(URL, &login("password", "user", "")).unwrap();
        assert_eq!(f.secret_count(), 1);

        assert!(f.creds.clear(URL).unwrap().removed);
        assert_eq!(f.all_secrets(), ["общий"], "общий вход ещё действует");

        let second = f.creds.clear(URL).unwrap();
        assert!(second.removed && second.shared);
        assert_eq!(f.secret_count(), 0, "ссылок не осталось");
    }

    #[test]
    fn forgetting_removes_secrets() {
        let f = fixture();
        let mut input = login("password", "user", "пароль");
        input.api_token = Some("токен".into());
        f.creds.save(URL, &input).unwrap();
        f.creds.save("https://gitlab.company.ru/group/other.git", &login("token", "", "токен2")).unwrap();
        assert_eq!(f.secret_count(), 3);

        assert!(f.creds.forget_login("https://gitlab.company.ru/group/other").unwrap().removed);
        assert_eq!(f.secret_count(), 2);

        assert!(f.creds.forget_server("gitlab.company.ru").unwrap().removed);
        assert_eq!(f.secret_count(), 0);
        assert!(!f.creds.forget_server("gitlab.company.ru").unwrap().removed);
    }

    #[test]
    fn keyring_failure_saves_nothing_and_leaves_no_partial_secrets() {
        let f = fixture();
        f.creds.save(URL, &login("password", "user", "старый")).unwrap();
        f.secrets.fail_writes.store(true, Ordering::SeqCst);

        let error = f.creds.save(URL, &login("password", "новый-логин", "новый")).unwrap_err();
        assert_eq!(error.code, ErrorCode::NoEncryption);

        assert_eq!(f.all_secrets(), ["старый"]);
        assert_eq!(f.creds.describe(URL).unwrap().saved.unwrap().info.username.as_deref(), Some("user"));
    }

    #[test]
    fn validation_failure_writes_nothing_to_keyring() {
        let f = fixture();
        let mut input = login("password", "user", "пароль");
        input.api_token = Some("с пробелом".into());
        assert_eq!(f.creds.save(URL, &input).unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(f.secret_count(), 0);
    }

    #[test]
    fn unreadable_legacy_secret_asks_to_reenter() {
        let f = fixture();
        f.creds
            .import_login(&LegacyLogin {
                scope: LoginScope::Repo,
                key: repo_key_of(URL).unwrap(),
                method: AuthMethod::Password,
                url: Some(URL.into()),
                username: Some("user".into()),
                key_path: None,
                secret: LegacySecret::Unreadable,
                passphrase: LegacySecret::Absent,
                api_token: LegacySecret::Absent,
                saved_at: Some("2026-01-01T00:00:00.000Z".into()),
            })
            .unwrap();
        let saved = f.creds.describe(URL).unwrap().saved.unwrap().info;
        assert!(saved.has_secret && !saved.readable);
        assert_eq!(saved.saved_at.as_deref(), Some("2026-01-01T00:00:00.000Z"));
        assert_eq!(f.secret_count(), 0);
        assert!(f.creds.git_auth(&[URL]).https.is_empty());
    }

    #[test]
    fn import_is_idempotent_and_never_overwrites() {
        let f = fixture();
        f.creds.save(URL, &login("password", "новый", "новый")).unwrap();
        f.creds
            .import_login(&LegacyLogin {
                scope: LoginScope::Repo,
                key: repo_key_of(URL).unwrap(),
                method: AuthMethod::Password,
                url: Some(URL.into()),
                username: Some("старый".into()),
                key_path: None,
                secret: LegacySecret::Value("старый".into()),
                passphrase: LegacySecret::Absent,
                api_token: LegacySecret::Absent,
                saved_at: None,
            })
            .unwrap();
        assert_eq!(f.all_secrets(), ["новый"]);
        assert_eq!(f.creds.describe(URL).unwrap().saved.unwrap().info.username.as_deref(), Some("новый"));
    }

    #[test]
    fn ssh_command_matches_1x_with_quoting() {
        assert_eq!(
            ssh_command(r"C:\Users\Тимур\it's\key", false),
            r"ssh -i 'C:/Users/Тимур/it'\''s/key' -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes"
        );
        assert_eq!(
            ssh_command("/k", true),
            "ssh -i '/k' -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no"
        );
    }
}
