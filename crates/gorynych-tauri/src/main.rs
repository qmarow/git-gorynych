//! Исполняемый файл приложения.
//!
//! Тот же файл запускается git и ssh как помощник входа, поэтому проверка режима идёт первой, до инициализации Tauri.
//! Подсистема Windows GUI нужна и для этого: иначе при каждом обращении git к помощнику мелькало бы окно консоли.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    if let Some(code) = gorynych_storage::askpass::run_helper() {
        std::process::exit(code);
    }
    if let Some(code) = gorynych_git::rebase::run_editor_helper() {
        std::process::exit(code);
    }
    gorynych_tauri_lib::run();
}
