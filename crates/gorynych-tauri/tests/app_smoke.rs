//! Запуск настоящего приложения: окно, WebView2, CSP, команды, база. Все данные — во временной папке: настоящий профиль и
//! папка данных пользователя не затрагиваются (см. `GORYNYCH_DEV_ROOT` в `lib.rs`). Окно при этом не показывается.

use std::fs;
use std::path::Path;
use std::process::{Command, ExitStatus};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const APP: &str = env!("CARGO_BIN_EXE_gorynych-tauri");
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(90);

/// Запускает приложение и ждёт, пока страница отработает. Зависшее приложение завершается.
fn launch(root: &Path) -> (ExitStatus, Value) {
    let ready = root.join("ready.json");
    let mut child = Command::new(APP)
        .env("GORYNYCH_DEV_ROOT", root)
        .env("GORYNYCH_DEV_READY_FILE", &ready)
        .spawn()
        .unwrap();
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if started.elapsed() > LAUNCH_TIMEOUT {
            child.kill().unwrap();
            panic!("приложение не завершилось за {LAUNCH_TIMEOUT:?}: страница не загрузилась или команда упала");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let text = fs::read_to_string(&ready).unwrap_or_else(|error| panic!("нет файла готовности ({error}), код {status:?}"));
    (status, serde_json::from_str(&text).unwrap())
}

/// Типы для интерфейса лежат в репозитории и не должны отставать от команд.
/// Обновить: `GORYNYCH_BLESS=1 cargo test -p gorynych-tauri --test app_smoke bindings`.
#[test]
fn bindings_are_up_to_date() {
    let dir = tempfile::tempdir().unwrap();
    let generated = dir.path().join("commands.ts");
    let status = Command::new(APP).env("GORYNYCH_DEV_EXPORT_BINDINGS", &generated).status().unwrap();
    assert!(status.success(), "{status:?}");
    let actual = fs::read_to_string(&generated).unwrap().replace("\r\n", "\n");

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("bindings").join("commands.ts");
    if std::env::var_os("GORYNYCH_BLESS").is_some() {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &actual).unwrap();
    }
    let committed = fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(actual == committed, "команды изменились: обновите bindings/commands.ts");
    for expected in ["tabsSave", "appearanceSet", "windowMaximizedChanged", "\"NO_STORAGE\"", "imageBlur", "openedAt"] {
        assert!(actual.contains(expected), "нет «{expected}» в:\n{actual}");
    }
}

#[test]
fn fresh_start_creates_database_and_page_passes_all_commands() {
    let dir = tempfile::tempdir().unwrap();
    let (status, ready) = launch(dir.path());
    assert!(status.success(), "{status:?}");
    assert_eq!(ready["storageError"], Value::Null, "{ready}");
    assert_eq!(ready["migrationError"], Value::Null, "{ready}");
    assert_eq!(ready["migration"]["source"], Value::Null, "профиля 1.x нет");
    assert!(ready["version"].as_str().unwrap().starts_with("2."));
    assert!(ready["dataDir"].as_str().unwrap().contains(dir.path().file_name().unwrap().to_str().unwrap()), "{ready}");
    assert!(dir.path().join("com.ironxenot.gitgorynych").join("state.db").exists());

    // Повторный запуск: перенос уже отмечен
    let (status, again) = launch(dir.path());
    assert!(status.success());
    assert_eq!(again["migration"]["alreadyDone"], json!(true));
}

#[test]
fn profile_1x_is_migrated_on_first_start_and_language_applied() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("git-Gorynych");
    fs::create_dir_all(&profile).unwrap();
    fs::write(profile.join("language.json"), r#"{"language":"en"}"#).unwrap();
    fs::write(
        profile.join("settings.json"),
        json!({ "tabs": ["C:/нет"], "appearance": { "background": "glow", "base": "#101010", "scheme": "dark" } }).to_string(),
    )
    .unwrap();

    let (status, ready) = launch(dir.path());
    assert!(status.success());
    assert_eq!(ready["migration"]["source"], json!("git-Gorynych"), "{ready}");
    assert_eq!(ready["migration"]["tabs"], json!(1), "{ready}");
    assert!(ready["migration"]["preferences"].as_u64().unwrap() >= 2, "{ready}");
    assert_eq!(fs::read_to_string(profile.join("language.json")).unwrap(), r#"{"language":"en"}"#, "старый файл не менялся");
}

#[test]
fn broken_storage_does_not_stop_the_window() {
    let dir = tempfile::tempdir().unwrap();
    // На месте папки данных — файл: база не откроется
    fs::write(dir.path().join("com.ironxenot.gitgorynych"), "мешаю").unwrap();

    let (status, ready) = launch(dir.path());
    assert!(status.success(), "сбой хранилища не должен ронять приложение");
    assert_eq!(ready["storageError"]["code"], json!("NO_STORAGE"), "{ready}");
    assert_eq!(ready["migrationError"]["code"], json!("NO_STORAGE"), "{ready}");
}
