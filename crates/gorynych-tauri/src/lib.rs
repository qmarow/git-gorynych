//! Каркас приложения Tauri v2. Перенос каркасной части `electron/main.cjs`.
//!
//! # Конспект исходника
//! - Окно 1200×800, минимум 960×600, без рамки (macOS — нативный «светофор» поверх заголовка), скрыто до готовности страницы.
//! - Цвет подложки `appearance.base` или `#0e1117`; при `background: 'system'` на Windows 11 22H2+ — материал Mica/Acrylic.
//! - Команды `window:*`, `tabs:*`, `recent:*`, `repo:get-last`, `app:*-language`, `appearance:get/set`.
//! - События: `window:maximized-changed`, `window:focus`.
//!
//! # Отличия от 1.x
//! - Порядок запуска: база → перенос данных 1.x → язык → брокер входа → окно. Сбой не прячется: окно откроется, а команды
//!   вернут `NO_STORAGE`, причина будет в `startup_status`. В подсистеме GUI иначе пользователь не увидел бы вообще ничего.
//! - Ошибки команд приходят как отклонённый promise с `{code, message, hint, details}`, а не как `{ok, error}`.
//! - Внешние ссылки: переход внутри окна запрещён. Открыть в браузере — команда `shell_open_external`; перехват
//!   `target=_blank` (`setWindowOpenHandler`) появится вместе с интерфейсом.
//! - Плагины (буфер обмена, диалоги) подключены только со стороны Rust: разрешений у страницы нет. Открытие файлов — свободные
//!   функции `tauri_plugin_opener`, без самого плагина. Картинку фона отдаёт протокол `gorynych-bg` (см. `commands::desktop`).
//!
//! # Не перенесено в каркасе
//! Меню macOS (`menu:set`), автоперезапуск разработки.
//!
//! # Подмена путей
//! Только в debug-сборке, `GORYNYCH_DEV_ROOT`: все данные и профиль WebView2 лежат во временной папке, чтобы тесты не касались
//! настоящего профиля. Там же папка SSH-ключей (`<папка>/.ssh`) и «буфер обмена» (`<папка>/clipboard.txt`), а секреты идут в
//! Keyring под сервисом `com.ironxenot.gitgorynych.dev`: это всё ещё настоящее системное хранилище, поэтому тест удаляет
//! свои записи сам. Диалоги отвечают из `<папка>/dialog-answers.txt`, а открытия и терминал пишутся в `<папка>/desktop.log`. `GORYNYCH_DEV_READY_FILE`: проверка окна, см. [`commands::frontend_ready`].
//! `GORYNYCH_DEV_EXPORT_BINDINGS`: экспорт типов для интерфейса. В релизе этого кода нет, это проверено по содержимому exe.

mod bridge;
pub mod commands;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

use gorynych_core::error::{GorynychError, Result};
use gorynych_cicd::runner_setup::Docker;
use gorynych_cicd::service::CicdService;
use gorynych_core::i18n;
use gorynych_git::actions::RepoEngine;
use gorynych_git::network::Network;
use gorynych_storage::Db;
use gorynych_storage::askpass::AuthBroker;
use gorynych_storage::credentials::Credentials;
use gorynych_storage::migrator::{MigrationPaths, MigrationReport, migrate_from_1x};
use gorynych_storage::preferences::Appearance;
use gorynych_storage::secrets::{KeyringStore, SERVICE};
use gorynych_storage::ssh_keys::default_ssh_dir;
use gorynych_watcher::index_sync::IndexSync;
use gorynych_watcher::remote_watch::RemoteRepoWatcher;
use serde::Serialize;
use tauri::webview::Color;
use tauri::{App, Manager, Runtime, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_specta::{Builder, Event, collect_commands, collect_events};

const WINDOW_LABEL: &str = "main";
const DEFAULT_BASE: &str = "#0e1117";
const DB_FILE: &str = "state.db";
/// Windows 11 22H2: начиная с этой сборки есть Mica и Acrylic.
#[cfg(windows)]
const MATERIAL_MIN_BUILD: u32 = 22621;

/// Окно развернулось или вернулось к обычному размеру.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct WindowMaximizedChanged(pub bool);

/// Окно получило фокус.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct WindowFocused;

/// Рабочие объекты приложения.
pub struct Services {
    pub db: Arc<Db>,
    pub credentials: Arc<Credentials>,
    pub broker: Arc<AuthBroker>,
    /// Действия с репозиториями. Один на приложение: в нём занятость и незавершённые операции.
    pub engine: Arc<RepoEngine>,
    pub cicd: CicdService,
    pub index_sync: Arc<IndexSync>,
    pub remote_watch: RemoteRepoWatcher,
    pub data_dir: PathBuf,
    /// Папка SSH-ключей: `~/.ssh`.
    pub ssh_dir: PathBuf,
    /// Файл вместо буфера обмена: только при подмене путей.
    pub clipboard_file: Option<PathBuf>,
    /// Папка подмены путей: диалоги отвечают из файла, открытие файлов и запуск терминала пишутся в журнал
    /// (см. `commands::desktop`). Только в debug с `GORYNYCH_DEV_ROOT`.
    pub dev_root: Option<PathBuf>,
}

/// Состояние приложения. `services` — ошибка, если хранилище не открылось.
pub struct AppState {
    pub services: std::result::Result<Services, GorynychError>,
    pub migration: std::result::Result<MigrationReport, GorynychError>,
    pub data_dir: PathBuf,
    maximized: AtomicBool,
    /// Слежение за активным репозиторием (`repo:watch`): в 1.x одно на окно, окно здесь одно.
    pub(crate) watch: Mutex<Option<commands::repo::ActiveWatch>>,
    /// Последняя модель меню macOS (`menu:set`).
    pub(crate) menu: commands::menu::MenuState,
}

impl AppState {
    pub fn services(&self) -> Result<&Services> {
        self.services.as_ref().map_err(Clone::clone)
    }
}

struct Paths {
    /// Родительская папка профиля 1.x (`%APPDATA%`).
    app_data: PathBuf,
    data_dir: PathBuf,
    /// Папка профиля WebView2: задаётся только при подмене путей.
    webview_dir: Option<PathBuf>,
    ssh_dir: PathBuf,
    keyring_service: String,
    clipboard_file: Option<PathBuf>,
    dev_root: Option<PathBuf>,
}

fn resolve_paths<R: Runtime>(app: &App<R>) -> std::result::Result<Paths, tauri::Error> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("GORYNYCH_DEV_ROOT").map(PathBuf::from) {
        return Ok(Paths {
            data_dir: root.join("com.ironxenot.gitgorynych"),
            webview_dir: Some(root.join("webview")),
            ssh_dir: root.join(".ssh"),
            keyring_service: format!("{SERVICE}.dev"),
            clipboard_file: Some(root.join("clipboard.txt")),
            dev_root: Some(root.clone()),
            app_data: root,
        });
    }
    let data_dir = app.path().app_data_dir()?;
    let app_data = data_dir.parent().map(PathBuf::from).unwrap_or_else(|| data_dir.clone());
    Ok(Paths { app_data, data_dir, webview_dir: None, ssh_dir: default_ssh_dir(), keyring_service: SERVICE.to_owned(), clipboard_file: None, dev_root: None })
}

fn open_services(paths: &Paths) -> Result<Services> {
    let db = Arc::new(Db::open(&paths.data_dir.join(DB_FILE))?);
    let credentials = Arc::new(Credentials::new(Arc::clone(&db), Arc::new(KeyringStore::with_service(paths.keyring_service.clone()))));
    // Этот же exe — помощник входа для git и ssh и редактор для `git rebase -i`: см. `main.rs`
    let helper = std::env::current_exe().map_err(GorynychError::unknown)?;
    let broker = Arc::new(AuthBroker::start(helper.clone())?);
    let network = Network::new(Arc::clone(&credentials), Arc::clone(&broker));
    let engine = Arc::new(RepoEngine::new(Arc::clone(&db), network, helper));
    let cicd = CicdService::new(Arc::clone(&db), Arc::clone(&credentials), Arc::new(bridge::GitForCicd), Docker::default());
    let index_sync = Arc::new(IndexSync::new(Arc::clone(&engine)));
    let remote_watch = RemoteRepoWatcher::new(Arc::clone(&engine), Some(Arc::new(bridge::GitlabHeads(cicd.clone()))));
    Ok(Services {
        db,
        credentials,
        broker,
        engine,
        cicd,
        index_sync,
        remote_watch,
        data_dir: paths.data_dir.clone(),
        ssh_dir: paths.ssh_dir.clone(),
        clipboard_file: paths.clipboard_file.clone(),
        dev_root: paths.dev_root.clone(),
    })
}

/// Запускает перенос и применяет сохранённый язык. Перенос может отложиться, но запуску не мешает.
fn prepare(services: &Services, paths: &Paths) -> std::result::Result<MigrationReport, GorynychError> {
    let migration = migrate_from_1x(
        &services.db,
        &services.credentials,
        &MigrationPaths { app_data: paths.app_data.clone(), data_dir: paths.data_dir.clone() },
    );
    if let Ok(Some(language)) = services.db.language() {
        i18n::set_language(language.as_str());
    }
    migration
}

/// `supportsMaterial`.
pub(crate) fn supports_material() -> bool {
    #[cfg(windows)]
    {
        windows_version::OsVersion::current().build >= MATERIAL_MIN_BUILD
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// `windowMaterial`: материал окна для оформления или `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Material {
    Mica,
    Acrylic,
}

pub(crate) fn window_material(appearance: &Appearance, supported: bool) -> Option<Material> {
    if !supported || appearance.background.as_deref() != Some("system") {
        return None;
    }
    Some(if appearance.material.as_deref() == Some("mica") { Material::Mica } else { Material::Acrylic })
}

/// Разбирает цвет `#rrggbb`; всё остальное — цвет по умолчанию.
pub(crate) fn parse_base(base: Option<&str>) -> Color {
    let parse = |text: &str| -> Option<Color> {
        let hex = text.strip_prefix('#').filter(|hex| hex.len() == 6 && hex.is_ascii())?;
        let channel = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16).ok();
        Some(Color(channel(0..2)?, channel(2..4)?, channel(4..6)?, 255))
    };
    base.and_then(parse).or_else(|| parse(DEFAULT_BASE)).unwrap_or(Color(14, 17, 23, 255))
}

fn theme_of(appearance: &Appearance) -> Option<Theme> {
    match appearance.scheme.as_deref() {
        Some("light") => Some(Theme::Light),
        Some("system") => None,
        _ => Some(Theme::Dark),
    }
}

/// `applyWindowMaterial`: тема, подложка и материал окна. Возвращает, включён ли материал.
pub(crate) fn apply_appearance<R: Runtime>(window: &WebviewWindow<R>, appearance: &Appearance) -> bool {
    let _ = window.set_theme(theme_of(appearance));
    let material = window_material(appearance, supports_material());
    let background = if material.is_some() { Color(0, 0, 0, 0) } else { parse_base(appearance.base.as_deref()) };
    let _ = window.set_background_color(Some(background));
    #[cfg(windows)]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::Effect;
        let effects = material.map(|material| WindowEffectsConfig {
            effects: vec![match material {
                Material::Mica => Effect::Mica,
                Material::Acrylic => Effect::Acrylic,
            }],
            ..WindowEffectsConfig::default()
        });
        let _ = window.set_effects(effects);
    }
    material.is_some()
}

fn create_window<R: Runtime>(app: &App<R>, paths: &Paths, appearance: &Appearance) -> tauri::Result<WebviewWindow<R>> {
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("git-Горыныч")
        .inner_size(1200.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .visible(false)
        .on_navigation(|url| matches!(url.scheme(), "tauri") || url.host_str() == Some("tauri.localhost"))
        // `target=_blank` и `window.open`: новых окон нет, веб-ссылка открывается в браузере (`setWindowOpenHandler` в 1.x)
        .on_new_window({
            let dev_root = paths.dev_root.clone();
            move |url, _features| {
                commands::desktop::open_link(&url, dev_root.as_deref());
                tauri::webview::NewWindowResponse::Deny
            }
        });
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 11.0));
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }
    // Прозрачность задаётся при создании окна, а материал можно включить и позже
    #[cfg(windows)]
    {
        builder = builder.transparent(supports_material());
    }
    if let Some(dir) = &paths.webview_dir {
        builder = builder.data_directory(dir.clone());
    }
    // Сквозная проверка окна (`tests/app_smoke.rs`): сценарий из файла выполняется вместо интерфейса. Только в отладке
    #[cfg(debug_assertions)]
    if let Some(script) = std::env::var_os("GORYNYCH_DEV_SMOKE_SCRIPT").and_then(|path| std::fs::read_to_string(path).ok()) {
        builder = builder.initialization_script(format!("window.__GORYNYCH_SMOKE__ = true;\ndocument.addEventListener('DOMContentLoaded', () => {{\n{script}\n}});"));
    }
    // Зонд настоящего интерфейса (`tests/ui-probe.js`): интерфейс работает, а зонд решает, когда сообщить о готовности
    #[cfg(debug_assertions)]
    if let Some(script) = std::env::var_os("GORYNYCH_DEV_UI_PROBE").and_then(|path| std::fs::read_to_string(path).ok()) {
        builder = builder.initialization_script(script);
    }
    let window = builder.build()?;
    apply_appearance(&window, appearance);
    Ok(window)
}

fn watch_window<R: Runtime>(window: &WebviewWindow<R>) {
    let watched = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            let _ = WindowFocused.emit(&watched);
        }
        WindowEvent::Resized(_) => {
            let maximized = watched.is_maximized().unwrap_or(false);
            let state = watched.state::<AppState>();
            if state.maximized.swap(maximized, Ordering::SeqCst) != maximized {
                let _ = WindowMaximizedChanged(maximized).emit(&watched);
            }
        }
        WindowEvent::Destroyed => commands::repo::stop_watch(watched.app_handle()),
        _ => {}
    });
}

/// Команды и события приложения. Отсюда же экспортируются типы для интерфейса.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::startup_status,
            commands::frontend_ready,
            commands::window_show,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_is_maximized,
            commands::app_get_language,
            commands::app_set_language,
            commands::tabs_get,
            commands::tabs_save,
            commands::recent_list,
            commands::recent_remove,
            commands::repo_get_last,
            commands::appearance_get,
            commands::appearance_set,
            commands::repo::repo_load,
            commands::repo::repo_inspect,
            commands::repo::repo_status,
            commands::repo::repo_stash_details,
            commands::repo::repo_commit_files,
            commands::repo::repo_file_diff,
            commands::repo::repo_read_file,
            commands::repo::repo_save_file,
            commands::repo::repo_compare,
            commands::repo::repo_compare_search,
            commands::repo::repo_search_history,
            commands::repo::repo_file_history,
            commands::repo::repo_blame,
            commands::repo::repo_commit_info,
            commands::repo::repo_gitflow_config,
            commands::repo::repo_rebase_preview,
            commands::repo::repo_branch_log,
            commands::repo::repo_commit_template,
            commands::repo::repo_guard_scan,
            commands::repo::repo_remote_check,
            commands::repo::repo_init,
            commands::repo::repo_probe_remote,
            commands::repo::repo_connect,
            commands::repo::repo_ci,
            commands::repo::repo_ci_preview,
            commands::repo::repo_ci_diff,
            commands::repo::repo_ci_save,
            commands::repo::repo_ci_create,
            commands::repo::repo_ci_edit,
            commands::repo::repo_clone_probe,
            commands::repo::repo_clone,
            commands::repo::repo_clone_cancel,
            commands::repo::repo_action,
            commands::repo::repo_watch,
            commands::creds::creds_describe,
            commands::creds::creds_save,
            commands::creds::creds_clear,
            commands::creds::creds_check_url,
            commands::creds::creds_detect_server,
            commands::creds::creds_servers,
            commands::creds::creds_forget_login,
            commands::creds::creds_forget_server,
            commands::creds::creds_set_kind,
            commands::creds::creds_ssh_keys,
            commands::creds::creds_key_defaults,
            commands::creds::creds_generate_key,
            commands::creds::creds_switch_to_ssh,
            commands::creds::creds_copy_public_key,
            commands::cicd::cicd_status,
            commands::cicd::cicd_info,
            commands::cicd::cicd_settings,
            commands::cicd::cicd_settings_save,
            commands::cicd::cicd_pipelines,
            commands::cicd::cicd_pipeline,
            commands::cicd::cicd_job_log,
            commands::cicd::cicd_action,
            commands::cicd::cicd_run,
            commands::cicd::cicd_run_form,
            commands::cicd::cicd_runners,
            commands::cicd::cicd_runner_update,
            commands::cicd::cicd_runner_delete,
            commands::cicd::cicd_runners_prune,
            commands::cicd::cicd_runner_register,
            commands::cicd::cicd_runner_tags,
            commands::cicd::cicd_local_runners,
            commands::cicd::cicd_local_runner_start,
            commands::cicd::cicd_local_runner_stop,
            commands::cicd::cicd_local_runner_resume,
            commands::cicd::cicd_secrets,
            commands::cicd::cicd_secret_save,
            commands::cicd::cicd_secret_delete,
            commands::cicd::gitlab_status,
            commands::cicd::gitlab_pipelines,
            commands::cicd::gitlab_pipeline,
            commands::cicd::gitlab_job_log,
            commands::cicd::gitlab_action,
            commands::cicd::gitlab_variables,
            commands::cicd::gitlab_variable_value,
            commands::cicd::gitlab_runners,
            commands::cicd::gitlab_lint,
            commands::cicd::gitlab_variable_save,
            commands::cicd::gitlab_variable_delete,
            commands::cicd::gitlab_schedules,
            commands::cicd::gitlab_schedule_save,
            commands::cicd::gitlab_schedule_action,
            commands::cicd::gitlab_create_mr,
            commands::desktop::repo_open_dialog,
            commands::desktop::repo_open_path,
            commands::desktop::creds_pick_key,
            commands::desktop::appearance_pick_image,
            commands::desktop::appearance_image,
            commands::desktop::cicd_artifact_download,
            commands::desktop::cicd_show_file,
            commands::desktop::shell_open_external,
            commands::desktop::shell_open_folder,
            commands::desktop::shell_open_terminal,
            commands::menu::menu_set,
            commands::storage::prefs_snapshot,
            commands::storage::prefs_write,
        ])
        .events(collect_events![
            WindowMaximizedChanged,
            WindowFocused,
            commands::repo::RepoChanged,
            commands::repo::RepoIndexSynced,
            commands::repo::CloneProgressEvent,
            commands::menu::MenuInvoke,
        ])
}

/// Запускает приложение.
pub fn run() {
    let builder = specta_builder();
    // Экспорт идёт из настоящего бинаря: тестовый exe со ссылками на Tauri на Windows не стартует без манифеста comctl
    // (0xc0000139). Поэтому модульные тесты этого крейта не должны вызывать код Tauri.
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("GORYNYCH_DEV_EXPORT_BINDINGS") {
        builder
            .export(specta_typescript::Typescript::default(), PathBuf::from(path))
            .expect("типы экспортируются в TypeScript");
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // Картинка фона отдаётся протоколом, а не строкой base64 через IPC: см. `commands::desktop`
        .register_asynchronous_uri_scheme_protocol(commands::desktop::BACKGROUND_SCHEME, commands::desktop::serve_background)
        .on_menu_event(commands::menu::on_menu_event)
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let paths = resolve_paths(app)?;
            let services = open_services(&paths);
            let migration = match &services {
                Ok(services) => prepare(services, &paths),
                Err(error) => Err(error.clone()),
            };
            let appearance = services.as_ref().ok().and_then(|s| s.db.appearance().ok().flatten()).unwrap_or_default();
            app.manage(AppState { services, migration, data_dir: paths.data_dir.clone(), maximized: AtomicBool::new(false), watch: Mutex::new(None), menu: Default::default() });
            let window = create_window(app, &paths, &appearance)?;
            watch_window(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn appearance(background: &str, material: Option<&str>) -> Appearance {
        Appearance { background: Some(background.into()), material: material.map(str::to_owned), ..Appearance::default() }
    }

    #[test]
    fn material_rules_match_1x() {
        assert_eq!(window_material(&appearance("system", Some("mica")), true), Some(Material::Mica));
        assert_eq!(window_material(&appearance("system", Some("acrylic")), true), Some(Material::Acrylic));
        assert_eq!(window_material(&appearance("system", None), true), Some(Material::Acrylic), "по умолчанию Acrylic");
        assert_eq!(window_material(&appearance("system", Some("mica")), false), None, "старая Windows");
        assert_eq!(window_material(&appearance("glow", Some("mica")), true), None, "другой фон");
        assert_eq!(window_material(&Appearance::default(), true), None);
    }

    #[test]
    fn base_color_falls_back_to_default() {
        assert_eq!(parse_base(Some("#ff0080")), Color(255, 0, 128, 255));
        for bad in [None, Some(""), Some("red"), Some("#ff"), Some("#gggggg"), Some("#ффф")] {
            assert_eq!(parse_base(bad), Color(14, 17, 23, 255), "{bad:?}");
        }
    }

    #[test]
    fn scheme_maps_to_theme_like_native_theme() {
        let with = |scheme: Option<&str>| Appearance { scheme: scheme.map(str::to_owned), ..Appearance::default() };
        assert_eq!(theme_of(&with(Some("light"))), Some(Theme::Light));
        assert_eq!(theme_of(&with(Some("dark"))), Some(Theme::Dark));
        assert_eq!(theme_of(&with(Some("system"))), None);
        assert_eq!(theme_of(&with(None)), Some(Theme::Dark), "как themeSource = 'dark' в 1.x");
    }
}
