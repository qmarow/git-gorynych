//! Перенос настоящего профиля Electron: настоящие `safeStorage`, `Local State` и LevelDB.
//! Запускает окно Electron из `node_modules` и шифрует ключом текущего пользователя, поэтому тест помечен `ignored`:
//! `cargo test -p gorynych-storage --test electron_migration -- --ignored`
//! Повторять при обновлении версии Electron в 1.x: формат принадлежит Chromium.
#![cfg(windows)]

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use gorynych_core::i18n::Language;
use gorynych_storage::Db;
use gorynych_storage::credentials::{Credentials, LoginScope};
use gorynych_storage::migrator::{MigrationIssue, MigrationPaths, migrate_from_1x};
use gorynych_storage::secrets::SecretStore;

#[derive(Default)]
struct Memory(Mutex<HashMap<String, String>>);

impl SecretStore for Memory {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().unwrap().get(account).cloned()
    }

    fn set(&self, account: &str, secret: &str) -> gorynych_core::Result<()> {
        self.0.lock().unwrap().insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> gorynych_core::Result<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn create_profile(profile: &Path) {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let electron = manifest.join("../../node_modules/electron/dist/electron.exe");
    assert!(electron.exists(), "нет Electron: выполните npm install");
    fs::create_dir_all(profile).unwrap();
    let output = Command::new(electron)
        .arg(manifest.join("tests/fixtures/electron-profile"))
        .arg(profile)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .output()
        .unwrap();
    assert!(profile.join("done").exists(), "Electron не создал профиль: {}", String::from_utf8_lossy(&output.stderr));
}

#[test]
#[ignore = "запускает настоящий Electron"]
fn real_electron_profile_is_migrated_with_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let app_data = dir.path().join("appdata");
    let profile = app_data.join("git-Gorynych");
    create_profile(&profile);
    assert!(profile.join("Local Storage").join("leveldb").is_dir());

    let db = Arc::new(Db::open(&dir.path().join("state.db")).unwrap());
    let creds = Credentials::new(Arc::clone(&db), Arc::new(Memory::default()));
    let paths = MigrationPaths { app_data, data_dir: dir.path().join("data") };
    let report = migrate_from_1x(&db, &creds, &paths).unwrap();
    println!("{report:#?}");

    // Секреты расшифрованы настоящим ключом
    let url = "https://gitlab.x/a/b.git";
    let auth = creds.git_auth(&[url, "git@gitlab.x:a/c.git", "https://shared.x/any/repo"]);
    assert_eq!(auth.https[0].username, "пользователь");
    assert_eq!(auth.https[0].secret, "пароль с пробелом 🔑");
    assert_eq!(auth.https[1].secret, "host-токен");
    assert_eq!(auth.ssh.unwrap().passphrase.as_deref(), Some("пароль ключа"));
    let api = creds.api_login_for("gitlab.x", "a/b", None).unwrap().repo.unwrap();
    assert_eq!((api.secret.as_str(), api.via_api_token), ("glpat-пайплайн", true));
    assert_eq!(creds.legacy_ci_token(LoginScope::Repo, "https://gitlab.x/a/b").unwrap().unwrap().value.as_deref(), Some("ci-репозиторий"));
    assert_eq!(creds.legacy_ci_token(LoginScope::Host, "https://gitlab.x").unwrap().unwrap().value.as_deref(), Some("ci-сервер"));

    // Подделанный шифротекст не читается, остальному не мешает
    assert!(!creds.describe("https://gitlab.x/a/d").unwrap().saved.unwrap().info.readable);
    assert_eq!(report.issues, [MigrationIssue::SecretNeedsReentry { key: "https://gitlab.x/a/d".into() }]);

    // localStorage из настоящей LevelDB
    let text = |key: &str| db.preference::<String>(key).unwrap();
    assert_eq!(text("pullMode").as_deref(), Some("rebase"));
    assert_eq!(text("latin").as_deref(), Some("plain ascii"), "Latin-1");
    assert_eq!(text("clone.parent").as_deref(), Some(r"C:\Проекты"), "UTF-16");
    assert_eq!(text("width:sidebar").as_deref(), Some("320"));
    assert_eq!(text("длинный").map(|value| value.chars().count()), Some(20000), "ключ и значение на кириллице");
    assert_eq!(text("изменён").as_deref(), Some("новое"), "последнее значение");
    assert_eq!(text("удалён"), None, "удалённое не воскресло");
    assert!(text("guard.v1").unwrap().contains("секрет"));
    let actions = db.custom_actions().unwrap();
    assert_eq!((actions.len(), actions[0].name.as_str(), actions[0].hotkey.as_deref(), actions[0].toolbar), (1, "Убрать ветку", Some("Ctrl+K"), false));
    assert_eq!(actions[0].steps[1].kind, "push");

    // Файлы настроек
    assert_eq!(db.language().unwrap(), Some(Language::En));
    assert_eq!(db.appearance().unwrap().unwrap().base.as_deref(), Some("#0e1117"));
    assert_eq!(db.repo_provider("gitlab.x", "a/b").unwrap().unwrap().api_base.as_deref(), Some("https://gitlab.x/api"));
    assert_eq!(fs::read_to_string(dir.path().join("data/backgrounds/current.png")).unwrap(), "картинка");
    assert_eq!((report.tabs, report.recent_repos), (2, 1));

    // Старые файлы на месте, LevelDB цела
    let again = gorynych_storage::local_storage::read_local_storage(&profile, &dir.path().join("again")).unwrap();
    assert!(again.iter().any(|(key, _)| key == "pullMode"));
    assert!(profile.join("remote-credentials.json").exists());
}
