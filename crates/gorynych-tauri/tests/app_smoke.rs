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
        .env("GIT_CONFIG_GLOBAL", root.join("нет-такого"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
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
    let ready: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(ready["report"]["error"], Value::Null, "страница не прошла команды: {ready}");
    (status, ready)
}

/// git теста: без глобальных и системных настроек пользователя.
fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git").current_dir(dir).args(args).env("GIT_CONFIG_GLOBAL", dir.join("нет-такого")).env("GIT_CONFIG_NOSYSTEM", "1").output().unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).into_owned()
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

/// Команды git через настоящий WebView: страница-заглушка проходит их на последнем репозитории (см. `ui/app.js`).
/// Репозиторий попадает в «последний» через перенос профиля 1.x, как у пользователя после обновления.
#[test]
fn git_commands_work_through_the_page() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("Репозиторий с пробелом");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["config", "user.name", "Тест"]);
    git(&repo, &["config", "user.email", "t@example.com"]);
    git(&repo, &["config", "gitflow.branch.develop", "develop"]);
    fs::write(repo.join(".gitlab-ci.yml"), "build:
  stage: build
  script: [echo 1]
").unwrap();
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "Начало"]);
    fs::write(repo.join("gorynych-smoke.txt"), "строка
секрет-123
").unwrap();

    let profile = dir.path().join("git-Gorynych");
    fs::create_dir_all(&profile).unwrap();
    let path = repo.to_str().unwrap();
    fs::write(profile.join("settings.json"), json!({ "lastRepo": path }).to_string()).unwrap();

    let (status, ready) = launch(dir.path());
    assert!(status.success(), "{status:?}");
    let report = &ready["report"]["repo"];
    assert!(report.is_object(), "страница не дошла до команд git: {ready}");
    assert_eq!(report["loaded"]["name"], json!("Репозиторий с пробелом"), "{report}");
    assert_eq!(report["loaded"]["commits"], json!(1));
    assert_eq!(report["loaded"]["currentBranch"], json!("main"));
    assert_eq!(report["loaded"]["ci"][0]["id"], json!("gitlab"), "{report}");
    assert_eq!(report["loaded"]["forge"], Value::Null, "remote нет");
    assert_eq!(ready["report"]["recent"][0]["path"], json!(path), "repo:load запомнил недавний: {ready}");
    assert_eq!(report["watching"], json!(true));
    assert_eq!(report["change"]["git"], json!(true), "stage меняет .git/index: {report}");
    assert_eq!(report["guard"]["blocked"], json!(true), "{report}");
    assert_eq!(report["guard"]["findings"][0]["line"], json!(2), "{report}");
    assert!(!report["guard"]["findings"][0]["text"].as_str().unwrap().contains("123"), "секрет замаскирован: {report}");
    assert!(report["committed"]["hash"].is_string(), "{report}");
    assert!(report["undone"]["label"].is_string(), "{report}");
    assert_eq!(report["after"], json!([["gorynych-smoke.txt", true]]), "отмена коммита вернула файл в индекс: {report}");
    assert_eq!(report["ci"]["current"], json!("gitlab"));
    assert_eq!(report["ci"]["jobs"], json!(1));
    assert_eq!(report["remote"], json!({ "status": "ok", "remotes": [], "fetched": false }), "remote нет — проверять нечего: {report}");
    assert_eq!(report["gitflow"]["develop"], json!("develop"));
    assert_eq!(report["gitflow"]["configured"], json!(true));
    assert_eq!(report["fileDiff"]["additions"], json!(2), "{report}");
    assert!(report["unknownAction"].as_str().is_some_and(|text| text.contains("unknown variant")), "неизвестное действие отклоняет сам Tauri: {report}");
    assert_eq!(report["badCompare"]["code"], json!("BAD_ARGS"), "{report}");
    assert_eq!(report["cancelled"], json!(false));
    assert_eq!(report["unwatched"], json!(false));
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]).trim(), "1", "коммит отменён в самом git");

    // Вход на сервер (`creds:*`), см. `credsSmoke` в `ui/app.js`
    let creds = &report["creds"];
    assert_eq!(creds["noRemote"]["noRemote"], json!(true), "{creds}");
    assert_eq!(creds["badRemote"]["code"], json!("BAD_ARGS"), "{creds}");
    assert!(creds["badRemote"]["hint"].as_str().is_some_and(|hint| hint.contains("project.git")), "{creds}");
    let url = "https://gitlab.example.invalid/group/project.git";
    assert_eq!(creds["saved"]["remoteChange"], json!({ "remote": "origin", "from": null, "to": url }), "сначала вход, потом remote: {creds}");
    assert_eq!(creds["saved"]["method"], json!("token"));
    assert_eq!(creds["saved"]["kind"], json!("gitlab"), "тип по имени хоста");
    assert!(matches!(creds["saved"]["api"]["state"].as_str(), Some("unknown" | "bad")), "сервера нет — проверка API не удалась: {creds}");
    assert_eq!(creds["described"]["remote"], json!("origin"));
    assert_eq!(creds["described"]["url"], json!(url));
    assert_eq!(creds["described"]["defaultTokenUser"], json!("oauth2"));
    assert_eq!(creds["described"]["readable"], json!(true), "секрет читается из Keyring: {creds}");
    assert_eq!(creds["server"]["repos"], json!([{ "path": "group/project", "method": "token", "ciSource": "login" }]), "{creds}");
    assert_eq!(creds["cleared"], json!({ "removed": true, "shared": false }), "вход удалён вместе с записью Keyring");
    assert_eq!(creds["afterClear"], Value::Null);
    assert_eq!(creds["switched"]["to"], json!("git@gitlab.example.invalid:group/project.git"), "{creds}");
    assert_eq!(creds["switched"]["protocol"], json!("ssh"));
    assert_eq!(git(&repo, &["remote", "get-url", "origin"]).trim(), "git@gitlab.example.invalid:group/project.git");
    assert_eq!(creds["switchedAgain"]["code"], json!("BAD_ARGS"));
    assert_eq!(creds["kind"], json!({ "kind": "gitea" }));
    assert_eq!(creds["badKind"]["code"], json!("BAD_ARGS"));
    assert_eq!(creds["forgotServer"], json!({ "removed": true }));
    assert_eq!(creds["defaults"]["comment"], json!("t@example.com"), "email из git config репозитория");
    let ssh_dir = dir.path().join(".ssh");
    assert_eq!(creds["defaults"]["dir"], json!(ssh_dir.to_str().unwrap()), "ключи — в папке теста, не в ~/.ssh");
    assert_eq!(creds["generated"]["type"], json!("ed25519"));
    assert_eq!(creds["generated"]["copied"], json!(true));
    let public_key = creds["generated"]["publicKey"].as_str().unwrap();
    assert!(public_key.starts_with("ssh-ed25519 ") && public_key.ends_with(" t@example.com"), "{creds}");
    assert!(ssh_dir.join(creds["generated"]["name"].as_str().unwrap()).exists());
    assert_eq!(creds["keys"], json!([creds["generated"]["name"]]));
    assert_eq!(creds["copied"]["publicKey"], json!(public_key));
    assert_eq!(fs::read_to_string(dir.path().join("clipboard.txt")).unwrap(), public_key, "открытый ключ в буфере обмена");
    assert_eq!(creds["noPub"]["code"], json!("NOT_FOUND"));
    assert_eq!(creds["badUrl"]["code"], json!("BAD_ARGS"));

    // CI/CD (`cicd:*`, `gitlab:*`), см. `cicdSmoke` в `ui/app.js`
    let cicd = &report["cicd"];
    let site = "https://gitlab.example.invalid";
    assert_eq!(
        cicd["status"],
        json!({ "kind": "gitlab", "host": "gitlab.example.invalid", "path": "group/project", "protocol": "ssh", "base": site, "configured": false }),
        "адрес сайта для SSH-remote: {cicd}"
    );
    assert_eq!(cicd["gitlab"], json!({ "kind": "gitlab", "remote": "origin", "path": "group/project", "configured": false }), "{cicd}");
    assert_eq!(cicd["settings"]["effective"], json!("gitlab"), "{cicd}");
    assert_eq!(cicd["settings"]["detected"], json!("gitlab"));
    assert_eq!(cicd["savedSettings"]["provider"], json!("gitea"), "{cicd}");
    assert_eq!(cicd["savedSettings"]["apiBase"], json!("https://gitea.example.invalid"), "хвостовая / срезана: {cicd}");
    assert_eq!(cicd["savedSettings"]["effective"], json!("gitea"));
    assert_eq!(cicd["savedSettings"]["defaultApiBase"], json!(format!("{site}/api/v1")));
    assert_eq!(cicd["resetSettings"], cicd["settings"], "пустые provider и apiBase удаляют запись: {cicd}");
    assert_eq!(cicd["runForm"], json!({ "kind": "gitlab", "workflows": [], "inputs": [], "variables": [], "allowCustomVariables": true }), "{cicd}");
    assert_eq!(cicd["localRunners"]["runners"], json!([]), "{cicd}");
    assert_eq!(cicd["noToken"]["code"], json!("NO_TOKEN"), "входа нет — API не вызывается: {cicd}");
    assert_eq!(cicd["glNoToken"]["code"], json!("NO_TOKEN"), "{cicd}");
    assert_eq!(cicd["badAction"]["code"], json!("BAD_ARGS"));
    assert_eq!(cicd["badRun"]["code"], json!("BAD_ARGS"));
    assert_eq!(cicd["badSecret"]["code"], json!("INVALID_NAME"));
    assert_eq!(cicd["badRunner"]["code"], json!("BAD_ARGS"), "чужой контейнер не трогаем: {cicd}");
    assert_eq!(cicd["notRepo"]["code"], json!("NOT_A_REPO"));
}
