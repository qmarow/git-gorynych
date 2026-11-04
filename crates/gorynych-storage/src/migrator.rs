//! Однократный перенос данных 1.x в `state.db` и Keyring. Старые файлы не удаляются и не меняются.
//!
//! # Конспект исходников
//! - Профиль: `%APPDATA%\git-Gorynych`, раньше `GitIdea` и `GitKraken Clone`. `main.cjs::migrateUserData` сам копирует старые
//!   папки в новую при запуске 1.x, поэтому берётся первая существующая.
//! - `settings.json`: `lastRepo`, `tabs`, `activeTab`, `recentRepos[{path,name,openedAt}]`, `appearance`.
//! - `language.json`: `{language}`, только `ru|en`; приоритетнее одноимённого значения `localStorage`.
//! - `cicd-settings.json`: `{repos: {ключ: {provider, apiBase, savedAt}}}`.
//! - `remote-credentials.json`: `{hosts, repos, servers}`; см. `credentials.rs`.
//! - `gitlab-tokens.json`: `{hosts, repos}` — старые токены CI/CD. В 1.x это отдельный запасной вариант для API
//!   (`authOptions`: login → legacy → legacy-shared → login-shared), для git они не используются. Поэтому они остаются
//!   отдельно, см. [`crate::credentials::Credentials::legacy_ci_token`], а не становятся входами: иначе токен только
//!   с `read_api` перехватил бы git и сломал push через Git Credential Manager. `migrateLegacy` переезжает с `gitlab.cjs`.
//! - `backgrounds/current.*`: картинка фона.
//! - `localStorage`: `actions.v1` → `custom_actions`; `appearance` и `language` по своим типам; остальное в `app_preferences`
//!   строкой как есть. UI 2.0 читает те же ключи.
//!
//! # Правила
//! - Маркер в `meta`, поэтому перенос один раз. Он ставится в конце: прерванный перенос повторится, а уже перенесённое
//!   не перезапишется и не задвоится. Новые данные всегда важнее старых.
//! - Повреждённый файл не мешает остальным: как `JSON.parse` в `try/catch` в 1.x, но с записью в [`MigrationReport`].
//! - Если Keyring недоступен совсем, перенос не начинается и не отмечается выполненным: иначе секреты пришлось бы
//!   объявить нечитаемыми, хотя через час они прочитались бы. Отдельный слишком длинный секрет — «ввести заново».
//! - В отчёте нет секретов: только адреса и ключи.

use std::fs;
use std::path::{Path, PathBuf};

use gorynych_core::error::{ErrorCode, Result};
use gorynych_core::i18n::Language;
use serde::Serialize;
use serde_json::Value;

use crate::credentials::{AuthMethod, Credentials, LegacyLogin, LegacySecret, LoginScope, ServerKind};
use crate::custom_actions::CustomAction;
use crate::db::{Db, storage_error};
use crate::legacy_crypto::LegacyDecryptor;
use crate::local_storage::read_local_storage;
use crate::preferences::{Appearance, keys};
use crate::repo_providers::CiProvider;
use crate::secrets::random_hex;
use crate::workspaces::RecentRepo;

/// Ключ маркера в `meta`: имя папки-источника или пустая строка, если профиля 1.x не было.
pub const MARKER: &str = "migrated_from_1x";

const PROFILE_NAMES: [&str; 3] = ["git-Gorynych", "GitIdea", "GitKraken Clone"];

/// Что осталось не перенесённым полностью.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MigrationIssue {
    /// Файл повреждён и пропущен.
    BrokenFile { file: String },
    /// Секрет не расшифровался или не поместился в Keyring: вход надо ввести заново.
    SecretNeedsReentry { key: String },
    /// Запись неизвестного вида пропущена.
    SkippedEntry { file: String, key: String },
}

/// Итог переноса.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    /// Перенос уже был сделан раньше: остальные поля пусты.
    pub already_done: bool,
    /// Папка профиля 1.x; `null`, если его нет.
    pub source: Option<String>,
    pub preferences: u32,
    pub tabs: u32,
    pub recent_repos: u32,
    pub repo_providers: u32,
    pub logins: u32,
    pub servers: u32,
    pub ci_tokens: u32,
    pub custom_actions: u32,
    pub backgrounds: u32,
    pub issues: Vec<MigrationIssue>,
}

/// Откуда и куда переносить.
#[derive(Debug, Clone)]
pub struct MigrationPaths {
    /// `%APPDATA%`: родительская папка профиля 1.x.
    pub app_data: PathBuf,
    /// Папка данных 2.0: сюда копируются фоны и временная копия LevelDB.
    pub data_dir: PathBuf,
}

struct Migration<'a> {
    db: &'a Db,
    creds: &'a Credentials,
    profile: PathBuf,
    decrypt: &'a dyn Fn(&str) -> Option<String>,
    report: MigrationReport,
}

/// Переносит данные 1.x, если это ещё не сделано.
pub fn migrate_from_1x(db: &Db, creds: &Credentials, paths: &MigrationPaths) -> Result<MigrationReport> {
    let profile = find_profile(&paths.app_data);
    let decryptor = profile.as_deref().map(LegacyDecryptor::for_profile);
    let decrypt = |encoded: &str| decryptor.as_ref().and_then(|d| d.decrypt(encoded));
    migrate_with(db, creds, paths, profile, &decrypt)
}

fn find_profile(app_data: &Path) -> Option<PathBuf> {
    PROFILE_NAMES.iter().map(|name| app_data.join(name)).find(|path| path.is_dir())
}

fn migrate_with(
    db: &Db,
    creds: &Credentials,
    paths: &MigrationPaths,
    profile: Option<PathBuf>,
    decrypt: &dyn Fn(&str) -> Option<String>,
) -> Result<MigrationReport> {
    if db.meta(MARKER)?.is_some() {
        return Ok(MigrationReport { already_done: true, ..MigrationReport::default() });
    }
    let Some(profile) = profile else {
        db.set_meta(MARKER, "")?;
        return Ok(MigrationReport::default());
    };
    creds.check_secret_store()?;

    let name = profile.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let mut migration = Migration {
        db,
        creds,
        profile,
        decrypt,
        report: MigrationReport { source: Some(name.clone()), ..MigrationReport::default() },
    };
    migration.language()?;
    migration.settings()?;
    migration.repo_providers()?;
    migration.logins()?;
    migration.ci_tokens()?;
    migration.local_storage(&paths.data_dir)?;
    migration.backgrounds(&paths.data_dir);
    db.set_meta(MARKER, &name)?;
    Ok(migration.report)
}

fn object<'a>(value: &'a Value, key: &str) -> impl Iterator<Item = (&'a String, &'a Value)> {
    value.get(key).and_then(Value::as_object).into_iter().flatten()
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

/// JS считает эти значения ложными: `if (entry.secret)`.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

impl Migration<'_> {
    /// Читает JSON-файл профиля; отсутствие файла — норма, повреждение попадает в отчёт.
    fn read_json(&mut self, file: &str) -> Option<Value> {
        let path = self.profile.join(file);
        let bytes = fs::read(&path).ok()?;
        match serde_json::from_slice(&bytes) {
            Ok(value) => Some(value),
            Err(_) => {
                self.report.issues.push(MigrationIssue::BrokenFile { file: file.to_owned() });
                None
            }
        }
    }

    fn language(&mut self) -> Result<()> {
        let Some(data) = self.read_json("language.json") else {
            return Ok(());
        };
        if let Some(language) = text(&data, "language").and_then(Language::parse)
            && self.db.preference_if_absent(keys::LANGUAGE, &language)?
        {
            self.report.preferences += 1;
        }
        Ok(())
    }

    fn settings(&mut self) -> Result<()> {
        let Some(data) = self.read_json("settings.json") else {
            return Ok(());
        };
        if let Some(last) = text(&data, "lastRepo").filter(|path| !path.is_empty())
            && self.db.preference_if_absent(keys::LAST_REPO, last)?
        {
            self.report.preferences += 1;
        }
        if let Some(raw) = data.get("appearance").filter(|value| value.is_object()) {
            match serde_json::from_value::<Appearance>(raw.clone()) {
                Ok(appearance) => {
                    if self.db.preference_if_absent(keys::APPEARANCE, &appearance)? {
                        self.report.preferences += 1;
                    }
                }
                Err(_) => self.report.issues.push(MigrationIssue::SkippedEntry { file: "settings.json".to_owned(), key: "appearance".to_owned() }),
            }
        }
        let tabs: Vec<String> = data
            .get("tabs")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let recents: Vec<RecentRepo> = data
            .get("recentRepos")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                Some(RecentRepo {
                    path: text(item, "path")?.to_owned(),
                    name: text(item, "name").unwrap_or_default().to_owned(),
                    opened_at: text(item, "openedAt").map(str::to_owned),
                })
            })
            .collect();
        let (imported_tabs, imported_recents) = self.db.import_workspaces(&tabs, text(&data, "activeTab"), &recents)?;
        self.report.tabs += imported_tabs;
        self.report.recent_repos += imported_recents;
        Ok(())
    }

    fn repo_providers(&mut self) -> Result<()> {
        let Some(data) = self.read_json("cicd-settings.json") else {
            return Ok(());
        };
        for (key, entry) in object(&data, "repos") {
            let provider = text(entry, "provider").and_then(|value| value.parse::<CiProvider>().ok());
            let api_base = text(entry, "apiBase");
            if provider.is_none() && api_base.is_none() {
                self.report.issues.push(MigrationIssue::SkippedEntry { file: "cicd-settings.json".to_owned(), key: key.clone() });
                continue;
            }
            if self.db.import_repo_provider(key, provider, api_base, text(entry, "savedAt"))? {
                self.report.repo_providers += 1;
            }
        }
        Ok(())
    }

    /// Секрет записи 1.x. `{enc}` расшифровывается; всё прочее истинное значение прочитать нельзя, как и в 1.x.
    fn secret(&self, entry: &Value, field: &str) -> LegacySecret {
        let Some(value) = entry.get(field).filter(|value| is_truthy(value)) else {
            return LegacySecret::Absent;
        };
        match text(value, "enc").and_then(self.decrypt).filter(|plain| !plain.is_empty()) {
            Some(plain) => LegacySecret::Value(plain),
            None => LegacySecret::Unreadable,
        }
    }

    fn logins(&mut self) -> Result<()> {
        const FILE: &str = "remote-credentials.json";
        let Some(data) = self.read_json(FILE) else {
            return Ok(());
        };
        for (scope, section) in [(LoginScope::Host, "hosts"), (LoginScope::Repo, "repos")] {
            for (key, entry) in object(&data, section) {
                let method = match text(entry, "method") {
                    Some("password") => AuthMethod::Password,
                    Some("token") => AuthMethod::Token,
                    Some("ssh") => AuthMethod::Ssh,
                    _ => {
                        self.report.issues.push(MigrationIssue::SkippedEntry { file: FILE.to_owned(), key: key.clone() });
                        continue;
                    }
                };
                let login = LegacyLogin {
                    scope,
                    key: key.clone(),
                    method,
                    url: text(entry, "url").map(str::to_owned),
                    username: text(entry, "username").map(str::to_owned),
                    key_path: text(entry, "keyPath").map(str::to_owned),
                    secret: self.secret(entry, "secret"),
                    passphrase: self.secret(entry, "passphrase"),
                    api_token: self.secret(entry, "apiToken"),
                    saved_at: text(entry, "savedAt").map(str::to_owned),
                };
                self.import_login(login)?;
            }
        }
        for (hostname, server) in object(&data, "servers") {
            let Some(kind) = text(server, "kind").and_then(ServerKind::parse) else {
                self.report.issues.push(MigrationIssue::SkippedEntry { file: FILE.to_owned(), key: hostname.clone() });
                continue;
            };
            if self.creds.import_server(hostname, kind, text(server, "base"), text(server, "savedAt"))? {
                self.report.servers += 1;
            }
        }
        Ok(())
    }

    fn import_login(&mut self, mut login: LegacyLogin) -> Result<()> {
        let needs_reentry = |login: &LegacyLogin| {
            [&login.secret, &login.passphrase, &login.api_token].iter().any(|secret| matches!(secret, LegacySecret::Unreadable))
        };
        let added = match self.creds.import_login(&login) {
            Err(error) if error.code == ErrorCode::NoEncryption => {
                // Хранилище проверено в начале, значит, не поместился этот секрет
                for secret in [&mut login.secret, &mut login.passphrase, &mut login.api_token] {
                    if matches!(secret, LegacySecret::Value(_)) {
                        *secret = LegacySecret::Unreadable;
                    }
                }
                self.creds.import_login(&login)?
            }
            other => other?,
        };
        // Вход уже есть в новой базе: он важнее, спрашивать нечего
        if !added {
            return Ok(());
        }
        if needs_reentry(&login) {
            self.report.issues.push(MigrationIssue::SecretNeedsReentry { key: login.key.clone() });
        }
        self.report.logins += 1;
        Ok(())
    }

    fn ci_tokens(&mut self) -> Result<()> {
        let Some(data) = self.read_json("gitlab-tokens.json") else {
            return Ok(());
        };
        for (scope, section) in [(LoginScope::Host, "hosts"), (LoginScope::Repo, "repos")] {
            for (key, entry) in object(&data, section) {
                let mut secret = self.secret_of(entry);
                let saved_at = text(entry, "savedAt");
                let added = match self.creds.import_legacy_ci_token(scope, key, &secret, saved_at) {
                    Err(error) if error.code == ErrorCode::NoEncryption => {
                        secret = LegacySecret::Unreadable;
                        self.creds.import_legacy_ci_token(scope, key, &secret, saved_at)?
                    }
                    other => other?,
                };
                if !added {
                    continue;
                }
                if matches!(secret, LegacySecret::Unreadable) {
                    self.report.issues.push(MigrationIssue::SecretNeedsReentry { key: key.clone() });
                }
                self.report.ci_tokens += 1;
            }
        }
        Ok(())
    }

    /// Сама запись `gitlab-tokens.json` — `{enc}`.
    fn secret_of(&self, entry: &Value) -> LegacySecret {
        match text(entry, "enc").and_then(self.decrypt).filter(|plain| !plain.is_empty()) {
            Some(plain) => LegacySecret::Value(plain),
            None => LegacySecret::Unreadable,
        }
    }

    fn local_storage(&mut self, data_dir: &Path) -> Result<()> {
        fs::create_dir_all(data_dir).map_err(storage_error)?;
        let work = data_dir.join(format!("migration-{}", random_hex()?));
        let items = match read_local_storage(&self.profile, &work) {
            Ok(items) => items,
            Err(_) => {
                self.report.issues.push(MigrationIssue::BrokenFile { file: "Local Storage".to_owned() });
                return Ok(());
            }
        };
        for (key, value) in items {
            let added = match key.as_str() {
                "actions.v1" => {
                    self.custom_actions(&value)?;
                    false
                }
                keys::LANGUAGE => match Language::parse(&value) {
                    Some(language) => self.db.preference_if_absent(keys::LANGUAGE, &language)?,
                    None => false,
                },
                keys::APPEARANCE => match serde_json::from_str::<Appearance>(&value) {
                    Ok(appearance) => self.db.preference_if_absent(keys::APPEARANCE, &appearance)?,
                    Err(_) => false,
                },
                // Эти ключи бэкенд заполняет из settings.json
                keys::LAST_REPO | keys::ACTIVE_TAB => false,
                _ => self.db.preference_if_absent(&key, &value)?,
            };
            if added {
                self.report.preferences += 1;
            }
        }
        Ok(())
    }

    /// `readActions`: нечитаемые данные → пусто, записи без `id` или `steps` отбрасываются.
    fn custom_actions(&mut self, raw: &str) -> Result<()> {
        const FILE: &str = "Local Storage";
        if !self.db.custom_actions()?.is_empty() {
            return Ok(());
        }
        let Ok(Value::Array(list)) = serde_json::from_str(raw) else {
            self.report.issues.push(MigrationIssue::SkippedEntry { file: FILE.to_owned(), key: "actions.v1".to_owned() });
            return Ok(());
        };
        let mut actions = Vec::new();
        for item in list {
            let id = text(&item, "id").unwrap_or_default().to_owned();
            match serde_json::from_value::<CustomAction>(item) {
                Ok(action) if !action.id.is_empty() => actions.push(action),
                _ => self.report.issues.push(MigrationIssue::SkippedEntry { file: FILE.to_owned(), key: format!("actions.v1/{id}") }),
            }
        }
        self.db.set_custom_actions(&actions)?;
        self.report.custom_actions = self.db.custom_actions()?.len() as u32;
        Ok(())
    }

    /// Копирует картинки фона. Существующие файлы не заменяются.
    fn backgrounds(&mut self, data_dir: &Path) {
        let Ok(entries) = fs::read_dir(self.profile.join("backgrounds")) else {
            return;
        };
        let target = data_dir.join("backgrounds");
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let destination = target.join(entry.file_name());
            if destination.exists() {
                continue;
            }
            let copied = fs::create_dir_all(&target).and_then(|()| fs::copy(entry.path(), &destination));
            match copied {
                Ok(_) => self.report.backgrounds += 1,
                Err(_) => self.report.issues.push(MigrationIssue::BrokenFile { file: format!("backgrounds/{}", entry.file_name().to_string_lossy()) }),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::memory::MemoryStore;
    use crate::workspaces::TabsState;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::sync::atomic::Ordering;

    const URL: &str = "https://gitlab.x/a/b.git";

    struct Fixture {
        dir: tempfile::TempDir,
        db: Arc<Db>,
        secrets: Arc<MemoryStore>,
        creds: Credentials,
    }

    fn fixture() -> Fixture {
        let secrets = Arc::new(MemoryStore::default());
        let db = Arc::new(Db::open_in_memory());
        let creds = Credentials::new(Arc::clone(&db), secrets.clone());
        Fixture { dir: tempfile::tempdir().unwrap(), db, secrets, creds }
    }

    /// В тестах расшифровка — снятие префикса; без него — как чужой ключ.
    fn fake_decrypt(encoded: &str) -> Option<String> {
        encoded.strip_prefix("ok:").map(str::to_owned)
    }

    fn enc(text: &str) -> Value {
        json!({ "enc": format!("ok:{text}") })
    }

    impl Fixture {
        fn profile(&self) -> PathBuf {
            let path = self.dir.path().join("appdata").join("git-Gorynych");
            fs::create_dir_all(&path).unwrap();
            path
        }

        fn write(&self, file: &str, value: &Value) {
            fs::write(self.profile().join(file), value.to_string()).unwrap();
        }

        fn run(&self) -> Result<MigrationReport> {
            let paths = MigrationPaths { app_data: self.dir.path().join("appdata"), data_dir: self.dir.path().join("data") };
            migrate_with(&self.db, &self.creds, &paths, find_profile(&paths.app_data), &fake_decrypt)
        }

        fn secret_values(&self) -> Vec<String> {
            let mut values: Vec<String> = self.secrets.values.lock().unwrap().values().cloned().collect();
            values.sort();
            values
        }
    }

    #[test]
    fn no_profile_is_marked_done_and_nothing_happens() {
        let f = fixture();
        let report = f.run().unwrap();
        assert_eq!(report, MigrationReport::default());
        assert_eq!(f.db.meta(MARKER).unwrap().as_deref(), Some(""));
        assert!(f.run().unwrap().already_done);
    }

    #[test]
    fn all_json_files_are_migrated() {
        let f = fixture();
        let repo = f.dir.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let repo = repo.to_string_lossy().into_owned();
        f.write("language.json", &json!({ "language": "en" }));
        f.write(
            "settings.json",
            &json!({
                "lastRepo": repo, "tabs": [repo, 5, "C:/нет"], "activeTab": repo,
                "recentRepos": [{ "path": repo, "name": "Имя", "openedAt": "2026-01-01T00:00:00.000Z" }, { "name": "без пути" }, null],
                "appearance": { "theme": "kraken", "imageBlur": 8, "scheme": "dark", "unknown": true },
            }),
        );
        f.write(
            "cicd-settings.json",
            &json!({ "repos": {
                "h/a/b": { "provider": "gitlab", "apiBase": "https://h/api", "savedAt": "t1" },
                "h/only-base": { "provider": null, "apiBase": "https://z" },
                "h/empty": { "provider": "jenkins", "apiBase": null },
            }}),
        );
        f.write(
            "remote-credentials.json",
            &json!({
                "hosts": { "https://shared.x": { "method": "token", "username": "oauth2", "secret": enc("host-secret") } },
                "repos": {
                    "https://gitlab.x/a/b": { "method": "password", "url": URL, "username": "u", "secret": enc("pass"), "apiToken": enc("api"), "savedAt": "t2" },
                    "ssh://gitlab.x/a/c": { "method": "ssh", "url": "git@gitlab.x:a/c.git", "keyPath": "C:/k", "passphrase": enc("pp") },
                    "https://gitlab.x/a/d": { "method": "password", "url": "https://gitlab.x/a/d", "username": "u", "secret": { "enc": "чужой ключ" } },
                    "https://gitlab.x/a/e": { "method": "странный", "url": "https://gitlab.x/a/e" },
                },
                "servers": { "gitlab.x": { "kind": "gitlab", "base": "https://gitlab.x:8443", "savedAt": "t3" }, "bad.x": { "kind": "zzz" } },
            }),
        );
        f.write(
            "gitlab-tokens.json",
            &json!({ "hosts": { "https://gitlab.x": enc("ci-host") }, "repos": { "https://gitlab.x/a/b": enc("ci-repo"), "https://gitlab.x/a/z": { "enc": "чужой" } } }),
        );
        fs::create_dir_all(f.profile().join("backgrounds")).unwrap();
        fs::write(f.profile().join("backgrounds").join("current.png"), b"png").unwrap();

        let report = f.run().unwrap();
        assert_eq!(report.source.as_deref(), Some("git-Gorynych"));
        assert_eq!((report.tabs, report.recent_repos), (2, 1));
        assert_eq!(report.repo_providers, 2);
        assert_eq!((report.logins, report.servers, report.ci_tokens, report.backgrounds), (4, 1, 3, 1));
        assert_eq!(
            report.issues,
            [
                MigrationIssue::SkippedEntry { file: "cicd-settings.json".into(), key: "h/empty".into() },
                MigrationIssue::SecretNeedsReentry { key: "https://gitlab.x/a/d".into() },
                MigrationIssue::SkippedEntry { file: "remote-credentials.json".into(), key: "https://gitlab.x/a/e".into() },
                MigrationIssue::SkippedEntry { file: "remote-credentials.json".into(), key: "bad.x".into() },
                MigrationIssue::SecretNeedsReentry { key: "https://gitlab.x/a/z".into() },
            ]
        );

        assert_eq!(f.db.language().unwrap(), Some(Language::En));
        assert_eq!(f.db.appearance().unwrap().unwrap().image_blur, Some(8.0));
        assert_eq!(f.db.tabs().unwrap(), TabsState { tabs: vec![repo.clone()], active: Some(repo.clone()) });
        assert_eq!(f.db.last_repo().unwrap(), Some(repo.clone()));
        let recent = f.db.recent_repos().unwrap();
        assert_eq!((recent[0].name.as_str(), recent[0].opened_at.as_deref()), ("Имя", Some("2026-01-01T00:00:00.000Z")));

        let provider = f.db.repo_provider("h", "a/b").unwrap().unwrap();
        assert_eq!((provider.provider, provider.saved_at.as_str()), (Some(CiProvider::Gitlab), "t1"));
        let only_base = f.db.repo_provider("h", "only-base").unwrap().unwrap();
        assert!(!only_base.saved_at.is_empty(), "дата обязательна");

        let saved = f.creds.describe(URL).unwrap().saved.unwrap().info;
        assert!(saved.readable && saved.has_api_token);
        assert_eq!(saved.saved_at.as_deref(), Some("t2"));
        let auth = f.creds.git_auth(&[URL]);
        assert_eq!(auth.https[0].secret, "pass");
        assert_eq!(f.creds.git_auth(&["git@gitlab.x:a/c.git"]).ssh.unwrap().passphrase.as_deref(), Some("pp"));
        assert!(!f.creds.describe("https://gitlab.x/a/d").unwrap().saved.unwrap().info.readable);
        assert_eq!(f.creds.server_base("gitlab.x").as_deref(), Some("https://gitlab.x:8443"));

        // Токены CI/CD не становятся входами git
        assert_eq!(f.creds.legacy_ci_token(LoginScope::Repo, "https://gitlab.x/a/b").unwrap().unwrap().value.as_deref(), Some("ci-repo"));
        assert_eq!(f.creds.legacy_ci_token(LoginScope::Host, "https://gitlab.x").unwrap().unwrap().value.as_deref(), Some("ci-host"));
        assert_eq!(f.creds.legacy_ci_token(LoginScope::Repo, "https://gitlab.x/a/z").unwrap().unwrap().value, None, "нечитаемый");
        assert_eq!(f.creds.legacy_ci_token(LoginScope::Repo, "нет").unwrap(), None);
        assert!(f.creds.git_auth(&["https://gitlab.x/a/z"]).https.is_empty());

        assert_eq!(fs::read(f.dir.path().join("data").join("backgrounds").join("current.png")).unwrap(), b"png");
        assert_eq!(f.secret_values(), ["api", "ci-host", "ci-repo", "host-secret", "pass", "pp"]);
    }

    fn profile_files(f: &Fixture) -> BTreeMap<String, Vec<u8>> {
        fs::read_dir(f.profile()).unwrap().flatten().filter(|entry| entry.path().is_file()).map(|entry| (entry.file_name().to_string_lossy().into_owned(), fs::read(entry.path()).unwrap())).collect()
    }

    #[test]
    fn old_files_are_never_changed() {
        let f = fixture();
        f.write("settings.json", &json!({ "lastRepo": "x" }));
        f.write("gitlab-tokens.json", &json!({ "repos": { "k": enc("t") } }));
        let before = profile_files(&f);
        f.run().unwrap();
        assert_eq!(profile_files(&f), before);
    }

    #[test]
    fn runs_once_and_later_changes_in_old_files_are_ignored() {
        let f = fixture();
        f.write("language.json", &json!({ "language": "en" }));
        assert_eq!(f.run().unwrap().preferences, 1);
        assert_eq!(f.db.meta(MARKER).unwrap().as_deref(), Some("git-Gorynych"));

        f.write("language.json", &json!({ "language": "ru" }));
        assert!(f.run().unwrap().already_done);
        assert_eq!(f.db.language().unwrap(), Some(Language::En));
    }

    #[test]
    fn new_data_wins_over_old_files() {
        let f = fixture();
        f.db.set_language(Language::Ru).unwrap();
        f.db.save_tabs(&["новая".to_owned()], None).unwrap();
        f.creds.import_server("gitlab.x", ServerKind::Other, None, None).unwrap();
        f.creds
            .save(URL, &crate::credentials::LoginInput { method: Some("token".into()), secret: Some("новый".into()), ..Default::default() })
            .unwrap();

        f.write("language.json", &json!({ "language": "en" }));
        f.write("settings.json", &json!({ "tabs": ["старая"] }));
        f.write(
            "remote-credentials.json",
            &json!({ "hosts": {}, "repos": { "https://gitlab.x/a/b": { "method": "token", "url": URL, "username": "старый", "secret": { "enc": "нечитаемый" } } }, "servers": { "gitlab.x": { "kind": "gitlab" } } }),
        );
        let report = f.run().unwrap();
        assert_eq!((report.logins, report.servers, report.preferences), (0, 0, 0), "ничего не добавлено: {report:?}");
        assert!(report.issues.is_empty(), "вход уже есть — вводить заново нечего: {:?}", report.issues);
        assert_eq!(f.db.language().unwrap(), Some(Language::Ru));
        assert_eq!(f.creds.git_auth(&[URL]).https[0].secret, "новый");
        assert_eq!(f.secret_values(), ["новый"], "старый секрет не записан");
        assert_eq!(f.creds.server_kind("gitlab.x"), Some(ServerKind::Other));
    }

    #[test]
    fn interrupted_run_repeats_without_duplicates() {
        let f = fixture();
        f.write("remote-credentials.json", &json!({ "hosts": {}, "repos": { "https://gitlab.x/a/b": { "method": "token", "url": URL, "username": "u", "secret": enc("s") } } }));
        f.write("gitlab-tokens.json", &json!({ "hosts": {}, "repos": { "k": enc("t") } }));
        f.run().unwrap();
        f.db.with(|conn| conn.execute("DELETE FROM meta WHERE key = ?1", [MARKER])).unwrap();

        f.run().unwrap();
        assert_eq!(f.secret_values(), ["s", "t"], "секреты не задвоились");
        assert_eq!(f.creds.list_servers().unwrap()[0].repos.len(), 1);
    }

    #[test]
    fn broken_file_does_not_stop_the_rest() {
        let f = fixture();
        fs::write(f.profile().join("settings.json"), "{ не json").unwrap();
        f.write("language.json", &json!({ "language": "en" }));
        let report = f.run().unwrap();
        assert_eq!(report.issues, [MigrationIssue::BrokenFile { file: "settings.json".into() }]);
        assert_eq!(f.db.language().unwrap(), Some(Language::En));
        assert!(f.db.meta(MARKER).unwrap().is_some());
    }

    #[test]
    fn unavailable_keyring_postpones_migration() {
        let f = fixture();
        f.write("remote-credentials.json", &json!({ "hosts": {}, "repos": { "https://gitlab.x/a/b": { "method": "token", "url": URL, "username": "u", "secret": enc("s") } } }));
        f.secrets.fail_writes.store(true, Ordering::SeqCst);
        assert_eq!(f.run().unwrap_err().code, ErrorCode::NoEncryption);
        assert_eq!(f.db.meta(MARKER).unwrap(), None, "повторим при следующем запуске");
        assert!(f.creds.describe(URL).unwrap().saved.is_none());

        f.secrets.fail_writes.store(false, Ordering::SeqCst);
        f.run().unwrap();
        assert_eq!(f.creds.git_auth(&[URL]).https[0].secret, "s");
    }

    #[test]
    fn report_has_no_secrets() {
        let f = fixture();
        f.write("remote-credentials.json", &json!({ "hosts": {}, "repos": { "https://gitlab.x/a/b": { "method": "password", "url": URL, "username": "u", "secret": enc("СЕКРЕТ") } } }));
        let report = f.run().unwrap();
        assert!(!format!("{report:?} {}", serde_json::to_string(&report).unwrap()).contains("СЕКРЕТ"));
    }

    #[test]
    fn older_profile_names_are_found_in_order() {
        let f = fixture();
        let app_data = f.dir.path().join("appdata");
        fs::create_dir_all(app_data.join("GitKraken Clone")).unwrap();
        assert!(find_profile(&app_data).unwrap().ends_with("GitKraken Clone"));
        fs::create_dir_all(app_data.join("GitIdea")).unwrap();
        assert!(find_profile(&app_data).unwrap().ends_with("GitIdea"));
        fs::create_dir_all(app_data.join("git-Gorynych")).unwrap();
        assert!(find_profile(&app_data).unwrap().ends_with("git-Gorynych"));
    }

    #[test]
    fn actions_created_in_new_version_are_not_overwritten() {
        use rusty_leveldb::{DB, Options};
        let f = fixture();
        let ldb = f.profile().join("Local Storage").join("leveldb");
        fs::create_dir_all(&ldb).unwrap();
        {
            let mut db = DB::open(&ldb, Options::default()).unwrap();
            let mut value = vec![1u8];
            value.extend(br#"[{"id":"old","name":"old","icon":"Zap","steps":[],"hotkey":null,"toolbar":true}]"#);
            db.put(b"_file://\0\x01actions.v1", &value).unwrap();
            db.flush().unwrap();
        }
        let new = CustomAction { id: "new".into(), name: "новое".into(), icon: "Zap".into(), steps: vec![], hotkey: None, toolbar: true };
        f.db.set_custom_actions(std::slice::from_ref(&new)).unwrap();

        assert_eq!(f.run().unwrap().custom_actions, 0);
        assert_eq!(f.db.custom_actions().unwrap(), [new]);
    }

    #[test]
    fn existing_background_is_kept() {
        let f = fixture();
        fs::create_dir_all(f.profile().join("backgrounds")).unwrap();
        fs::write(f.profile().join("backgrounds").join("current.png"), b"old").unwrap();
        let target = f.dir.path().join("data").join("backgrounds");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("current.png"), b"new").unwrap();
        assert_eq!(f.run().unwrap().backgrounds, 0);
        assert_eq!(fs::read(target.join("current.png")).unwrap(), b"new");
    }

    #[test]
    fn local_storage_values_are_routed_by_key() {
        use rusty_leveldb::{DB, Options};
        let f = fixture();
        let ldb = f.profile().join("Local Storage").join("leveldb");
        fs::create_dir_all(&ldb).unwrap();
        {
            let mut db = DB::open(&ldb, Options::default()).unwrap();
            let mut put = |key: &str, value: &str| {
                let mut k = b"_file://\0\x01".to_vec();
                k.extend(key.as_bytes());
                let mut v = vec![0u8];
                v.extend(value.encode_utf16().flat_map(u16::to_le_bytes));
                db.put(&k, &v).unwrap();
            };
            put("pullMode", "rebase");
            put("language", "en");
            put("lastRepo", "не отсюда");
            put("appearance", r#"{"theme":"из-кэша"}"#);
            put(
                "actions.v1",
                r#"[{"id":"a","name":"Имя","icon":"Zap","steps":[{"id":"s","type":"pull","params":{"force":false,"mode":"merge"}}],"hotkey":null,"toolbar":true},{"name":"без id","steps":[]},{"id":"bad"}]"#,
            );
            db.flush().unwrap();
        }
        let report = f.run().unwrap();
        assert_eq!(report.custom_actions, 1);
        assert_eq!(f.db.custom_actions().unwrap()[0].name, "Имя");
        assert_eq!(report.issues.len(), 2, "{:?}", report.issues);
        assert_eq!(f.db.preference::<String>("pullMode").unwrap().as_deref(), Some("rebase"));
        assert_eq!(f.db.language().unwrap(), Some(Language::En));
        assert_eq!(f.db.preference::<String>(keys::LAST_REPO).unwrap(), None);
        assert_eq!(f.db.appearance().unwrap().unwrap().theme.as_deref(), Some("из-кэша"));
        assert!(fs::read_dir(f.dir.path().join("data")).unwrap().next().is_none(), "временная копия удалена");
    }
}
