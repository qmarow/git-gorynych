//! Команды каркаса. Семантика — как у одноимённых обработчиков `ipcMain` в `electron/main.cjs`; см. шапку `lib.rs`.
//! Команды git — в [`repo`], авторизация на серверах — в [`creds`].

pub mod creds;
pub mod repo;

use std::fs;
use std::path::Path;

use gorynych_core::error::{GorynychError, Result};
use gorynych_core::i18n::{self, Language};
use gorynych_storage::migrator::MigrationReport;
use gorynych_storage::preferences::Appearance;
use gorynych_storage::workspaces::{RecentRepo, TabsState};
use serde::Serialize;
use tauri::{State, WebviewWindow};

use crate::{AppState, apply_appearance, supports_material};

/// Как прошёл запуск.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub version: String,
    pub data_dir: String,
    /// Хранилище не открылось: команды вернут эту же ошибку.
    pub storage_error: Option<GorynychError>,
    pub migration: Option<MigrationReport>,
    /// Перенос отложен, например из-за недоступного Keyring: повторится при следующем запуске.
    pub migration_error: Option<GorynychError>,
}

/// Ответ `appearance:get`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceInfo {
    pub appearance: Option<Appearance>,
    pub supports_material: bool,
    pub has_image: bool,
}

fn status_of(state: &AppState) -> StartupStatus {
    StartupStatus {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        storage_error: state.services.as_ref().err().cloned(),
        migration: state.migration.as_ref().ok().cloned(),
        migration_error: state.migration.as_ref().err().cloned(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn startup_status(state: State<'_, AppState>) -> StartupStatus {
    status_of(&state)
}

/// Страница отрисована: как `ready-to-show`, окно показывается только теперь.
// Обычный комментарий: `specta` встраивает doc-комментарии команд в бинарь и в типы для интерфейса.
// В debug-сборке с GORYNYCH_DEV_READY_FILE вместо показа записывает состояние в файл и завершает приложение: это
// проверка, что настоящий WebView2 загрузил страницу, она прошла CSP и все команды отработали. `report` — JSON от страницы
// (сквозная проверка команд), попадает в тот же файл полем `report`. В релизе не используется.
#[tauri::command]
#[specta::specta]
pub fn frontend_ready(window: WebviewWindow, state: State<'_, AppState>, report: Option<String>) {
    #[cfg(debug_assertions)]
    if let Some(file) = std::env::var_os("GORYNYCH_DEV_READY_FILE") {
        use tauri::Manager;
        let mut status = serde_json::to_value(status_of(&state)).unwrap_or_default();
        status["report"] = report.and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        let _ = fs::write(file, status.to_string());
        window.app_handle().exit(0);
        return;
    }
    let _ = (&state, report);
    let _ = window.show();
}

#[tauri::command]
#[specta::specta]
pub fn window_show(window: WebviewWindow) {
    let _ = window.show();
}

#[tauri::command]
#[specta::specta]
pub fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
#[specta::specta]
pub fn window_toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
#[specta::specta]
pub fn window_close(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
#[specta::specta]
pub fn window_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
#[specta::specta]
pub fn app_get_language() -> Language {
    i18n::language()
}

/// `setLanguage`: неизвестный язык игнорируется; действующий язык возвращается всегда.
#[tauri::command]
#[specta::specta]
pub fn app_set_language(state: State<'_, AppState>, language: String) -> Result<Language> {
    let current = i18n::set_language(&language);
    if Language::parse(&language).is_some() {
        state.services()?.db.set_language(current)?;
    }
    Ok(current)
}

#[tauri::command]
#[specta::specta]
pub fn tabs_get(state: State<'_, AppState>) -> Result<TabsState> {
    state.services()?.db.tabs()
}

#[tauri::command]
#[specta::specta]
pub fn tabs_save(state: State<'_, AppState>, tabs: Vec<String>, active: Option<String>) -> Result<()> {
    state.services()?.db.save_tabs(&tabs, active.as_deref())
}

#[tauri::command]
#[specta::specta]
pub fn recent_list(state: State<'_, AppState>) -> Result<Vec<RecentRepo>> {
    state.services()?.db.recent_repos()
}

#[tauri::command]
#[specta::specta]
pub fn recent_remove(state: State<'_, AppState>, dir: String) -> Result<()> {
    state.services()?.db.remove_recent(&dir)
}

#[tauri::command]
#[specta::specta]
pub fn repo_get_last(state: State<'_, AppState>) -> Result<Option<String>> {
    state.services()?.db.last_repo()
}

/// `storedImage`: есть ли файл `current.*` в папке фонов.
fn has_stored_image(data_dir: &Path) -> bool {
    fs::read_dir(data_dir.join("backgrounds"))
        .map(|entries| entries.flatten().any(|entry| entry.file_name().to_string_lossy().starts_with("current.")))
        .unwrap_or(false)
}

#[tauri::command]
#[specta::specta]
pub fn appearance_get(state: State<'_, AppState>) -> Result<AppearanceInfo> {
    let services = state.services()?;
    Ok(AppearanceInfo {
        appearance: services.db.appearance()?,
        supports_material: supports_material(),
        has_image: has_stored_image(&services.data_dir),
    })
}

/// Сохраняет оформление и применяет к окну. Возвращает, включён ли системный материал.
#[tauri::command]
#[specta::specta]
pub fn appearance_set(window: WebviewWindow, state: State<'_, AppState>, value: Appearance) -> Result<bool> {
    state.services()?.db.set_appearance(&value)?;
    Ok(apply_appearance(&window, &value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_image_is_found_by_prefix() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_stored_image(dir.path()), "нет папки");
        fs::create_dir_all(dir.path().join("backgrounds")).unwrap();
        fs::write(dir.path().join("backgrounds").join("other.png"), "x").unwrap();
        assert!(!has_stored_image(dir.path()));
        fs::write(dir.path().join("backgrounds").join("current.webp"), "x").unwrap();
        assert!(has_stored_image(dir.path()));
    }
}
