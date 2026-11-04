//! Исполняемый файл приложения. Зависимость `tauri` и окно подключаются в конце Фазы 1.
//!
//! Тот же файл запускается git и ssh как помощник входа, поэтому проверка режима идёт первой, до инициализации Tauri.
//! Подсистема Windows GUI нужна и для этого: иначе при каждом обращении git к помощнику мелькало бы окно консоли.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    if let Some(code) = gorynych_storage::askpass::run_helper() {
        std::process::exit(code);
    }
}
