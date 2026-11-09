//! Нативное меню macOS: перенос `buildMacMenu` и обработчика `menu:set` из `electron/main.cjs`.
//!
//! # Конспект исходника
//! - Пункты (подписи, доступность, подсказки клавиш) строит интерфейс — у него вся логика и состояние; здесь из них собирается
//!   системное меню, а клик уходит обратно событием `menu:invoke {menu, index, id}`.
//! - `menu:set(model)` работает только на macOS; модель без изменений (тот же JSON) меню не пересобирает; ошибка сборки — в журнал.
//! - Пункт модели: `separator` → разделитель; `header` → недоступный пункт-заголовок; иначе `{label, enabled: !disabled}` и клик
//!   `send(menu, index, id ?? null)`.
//! - Меню приложения: «О программе git-Горыныч» (с моделью — свой пункт `id: 'about'`, иначе системный), «Настройки…»
//!   (`Cmd+,`, доступен только с моделью, `id: 'settings'`), «Службы», «Скрыть…», «Скрыть остальные», «Показать все», «Завершить…».
//!   Затем «Файл», «Правка» (пункты модели + «Вырезать», «Копировать», «Вставить», «Выбрать всё» — без них на macOS не работают
//!   ⌘C/⌘V/⌘A в полях ввода), «Вид» (+ «Полноэкранный режим»), «Действия», «Окно» (системное), «Справка». Пустое подменю
//!   получает недоступный пункт «Нет действий»: пустые macOS не показывает.
//!
//! # Отличия от 1.x
//! - **Сочетания клавиш в меню не показываются.** В 1.x они были только подписью (`registerAccelerator: false`), а клавиши
//!   обрабатывал интерфейс. У меню Tauri (`muda`) подписи без перехвата нет: macOS забирал бы сочетание себе, и, например, ⌘Z в поле
//!   ввода выполнял бы пункт меню вместо отмены набора. Поэтому `toAccelerator` не перенесён, клавиши по-прежнему у интерфейса.
//! - Пункты системного меню «Окно» подписаны `muda` (по-английски), а не локализованы системой, как в Electron.
//! - Событие называется `menu-invoke` (имя структуры для `tauri-specta`).
//!
//! **Не проверено на macOS**: код собирается и выполняется на Windows (в отладке с подменой путей меню собирается без установки,
//! см. `desktop.log`), но само меню macOS не запускалось.

use std::collections::BTreeMap;
use std::sync::Mutex;

use gorynych_core::error::GorynychError;
use gorynych_core::i18n::t;
use serde::{Deserialize, Serialize};
use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_specta::Event;

use crate::AppState;

const APP_NAME: &str = "git-Горыныч";
/// Префикс своих пунктов: события системных пунктов (копировать, скрыть…) приходят с другими идентификаторами.
const ID_PREFIX: &str = "gm|";
/// Меню модели в порядке строки меню.
const MODEL_MENUS: [&str; 5] = ["File", "Edit", "View", "Actions", "Help"];

/// Пункт модели. Поля разбираются как проверки в 1.x: `separator`, затем `header`, иначе обычный пункт.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct MenuEntry {
    pub separator: bool,
    pub header: Option<String>,
    pub id: Option<String>,
    pub label: Option<String>,
    /// Подсказка сочетания клавиш: в нативном меню не показывается, см. шапку.
    pub hint: Option<String>,
    pub disabled: bool,
}

/// Модель меню от интерфейса: имя меню → пункты.
pub type MenuModel = BTreeMap<String, Vec<MenuEntry>>;

/// Клик по пункту: `menu:invoke`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, tauri_specta::Event)]
pub struct MenuInvoke {
    /// Имя меню модели; `None` — пункт меню приложения («О программе», «Настройки»).
    pub menu: Option<String>,
    /// Номер пункта в меню модели, `-1` для меню приложения.
    #[specta(type = f64)]
    pub index: i64,
    pub id: Option<String>,
}

/// Последняя применённая модель (JSON): та же — меню не пересобирается.
#[derive(Default)]
pub struct MenuState {
    last: Mutex<String>,
}

/// Идентификатор пункта для системы: меню, номер и `id` модели.
fn encode_id(menu: Option<&str>, index: i64, id: Option<&str>) -> String {
    format!("{ID_PREFIX}{}|{index}|{}", menu.unwrap_or_default(), id.unwrap_or_default())
}

/// Обратно из идентификатора; чужие пункты — `None`.
fn decode_id(raw: &str) -> Option<MenuInvoke> {
    let mut parts = raw.strip_prefix(ID_PREFIX)?.splitn(3, '|');
    let (menu, index, id) = (parts.next()?, parts.next()?.parse().ok()?, parts.next()?);
    let present = |text: &str| (!text.is_empty()).then(|| text.to_owned());
    Some(MenuInvoke { menu: present(menu), index, id: present(id) })
}

/// Что делать с пунктом модели.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Planned {
    Separator,
    Header(String),
    Item { id: String, label: String, enabled: bool },
}

/// `fromModel`: пункты одного меню.
fn plan(menu: &str, items: &[MenuEntry]) -> Vec<Planned> {
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            if item.separator {
                return Planned::Separator;
            }
            if let Some(header) = item.header.as_ref().filter(|header| !header.is_empty()) {
                return Planned::Header(header.clone());
            }
            Planned::Item { id: encode_id(Some(menu), index as i64, item.id.as_deref()), label: item.label.clone().unwrap_or_default(), enabled: !item.disabled }
        })
        .collect()
}

type Items<R> = Vec<Box<dyn IsMenuItem<R>>>;

fn built<R: Runtime>(app: &AppHandle<R>, planned: &[Planned]) -> tauri::Result<Items<R>> {
    let mut items: Items<R> = Vec::new();
    for entry in planned {
        match entry {
            Planned::Separator => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
            Planned::Header(text) => items.push(Box::new(MenuItem::new(app, text, false, None::<&str>)?)),
            Planned::Item { id, label, enabled } => items.push(Box::new(MenuItem::with_id(app, id.as_str(), label, *enabled, None::<&str>)?)),
        }
    }
    Ok(items)
}

fn submenu<R: Runtime>(app: &AppHandle<R>, title: &str, mut items: Items<R>) -> tauri::Result<Submenu<R>> {
    if items.is_empty() {
        items.push(Box::new(MenuItem::new(app, t("Нет действий", &[]), false, None::<&str>)?));
    }
    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|item| item.as_ref()).collect();
    Submenu::with_items(app, title, true, &refs)
}

/// `buildMacMenu`. На других системах меню тоже собирается (в отладке — для проверки), но не устанавливается.
fn build_menu<R: Runtime>(app: &AppHandle<R>, model: Option<&MenuModel>) -> tauri::Result<(Menu<R>, usize)> {
    let empty = Vec::new();
    let section = |name: &str| plan(name, model.and_then(|model| model.get(name)).unwrap_or(&empty));
    let app_item = |id: &str, label: String, enabled: bool| MenuItem::with_id(app, encode_id(None, -1, Some(id)), label, enabled, None::<&str>);

    let mut app_items: Items<R> = Vec::new();
    match model {
        Some(_) => app_items.push(Box::new(app_item("about", t("О программе {0}", &[&APP_NAME]), true)?)),
        None => app_items.push(Box::new(PredefinedMenuItem::about(app, None, None)?)),
    }
    app_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    app_items.push(Box::new(app_item("settings", t("Настройки…", &[]), model.is_some())?));
    app_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    app_items.push(Box::new(PredefinedMenuItem::services(app, None)?));
    app_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    app_items.push(Box::new(PredefinedMenuItem::hide(app, Some(&t("Скрыть {0}", &[&APP_NAME])))?));
    app_items.push(Box::new(PredefinedMenuItem::hide_others(app, Some(&t("Скрыть остальные", &[])))?));
    app_items.push(Box::new(PredefinedMenuItem::show_all(app, Some(&t("Показать все", &[])))?));
    app_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    app_items.push(Box::new(PredefinedMenuItem::quit(app, Some(&t("Завершить {0}", &[&APP_NAME])))?));

    let mut edit = built(app, &section("Edit"))?;
    edit.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit.push(Box::new(PredefinedMenuItem::cut(app, Some(&t("Вырезать", &[])))?));
    edit.push(Box::new(PredefinedMenuItem::copy(app, Some(&t("Копировать", &[])))?));
    edit.push(Box::new(PredefinedMenuItem::paste(app, Some(&t("Вставить", &[])))?));
    edit.push(Box::new(PredefinedMenuItem::select_all(app, Some(&t("Выбрать всё", &[])))?));

    let mut view = built(app, &section("View"))?;
    view.push(Box::new(PredefinedMenuItem::separator(app)?));
    view.push(Box::new(PredefinedMenuItem::fullscreen(app, Some(&t("Полноэкранный режим", &[])))?));

    let window_items: Items<R> = vec![
        Box::new(PredefinedMenuItem::minimize(app, None)?),
        Box::new(PredefinedMenuItem::maximize(app, None)?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(PredefinedMenuItem::bring_all_to_front(app, None)?),
    ];

    let submenus = [
        submenu(app, APP_NAME, app_items)?,
        submenu(app, &t("Файл", &[]), built(app, &section("File"))?)?,
        submenu(app, &t("Правка", &[]), edit)?,
        submenu(app, &t("Вид", &[]), view)?,
        submenu(app, &t("Действия", &[]), built(app, &section("Actions"))?)?,
        submenu(app, &t("Окно", &[]), window_items)?,
        submenu(app, &t("Справка", &[]), built(app, &section("Help"))?)?,
    ];
    #[cfg(target_os = "macos")]
    {
        submenus[5].set_as_windows_menu_for_nsapp()?;
        submenus[6].set_as_help_menu_for_nsapp()?;
    }
    let refs: Vec<&dyn IsMenuItem<R>> = submenus.iter().map(|item| item as &dyn IsMenuItem<R>).collect();
    let count = MODEL_MENUS.iter().map(|name| section(name).len()).sum();
    Ok((Menu::with_items(app, &refs)?, count))
}

/// Модель от интерфейса. Ответа нет, как у `ipcRenderer.send` в 1.x.
#[tauri::command]
#[specta::specta]
pub fn menu_set(app: AppHandle, state: State<'_, AppState>, model: Option<MenuModel>) {
    #[cfg(debug_assertions)]
    let dev = state.services.as_ref().ok().and_then(|services| services.dev_root.clone());
    #[cfg(not(debug_assertions))]
    let dev: Option<std::path::PathBuf> = None;
    if !cfg!(target_os = "macos") && dev.is_none() {
        return;
    }
    // Ключи BTreeMap упорядочены: одна и та же модель даёт один и тот же текст
    let json = serde_json::to_string(&model).unwrap_or_default();
    {
        let mut last = state.menu.last.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if *last == json {
            return;
        }
        *last = json;
    }
    match build_menu(&app, model.as_ref()) {
        Ok((menu, count)) => {
            if cfg!(target_os = "macos") {
                if let Err(error) = app.set_menu(menu) {
                    eprintln!("menu:set {error}");
                }
            } else if let Some(root) = dev {
                // Отладка на других системах: меню собрано, но не установлено
                use std::io::Write;
                if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(root.join("desktop.log")) {
                    let _ = writeln!(file, "menu built {count}");
                }
            }
        }
        Err(error) => eprintln!("menu:set {}", GorynychError::unknown(error).message),
    }
}

/// Клик по своему пункту меню — событие для интерфейса.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if let Some(invoke) = decode_id(event.id().as_ref())
        && let Some(window) = app.get_webview_window(crate::WINDOW_LABEL)
    {
        let _ = invoke.emit(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(json: &str) -> MenuEntry {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn model_items_follow_from_model_of_1x() {
        let items = [entry(r#"{"separator":true}"#), entry(r#"{"header":"Ветки"}"#), entry(r#"{"id":"push","label":"Push","hint":"Ctrl+Shift+P","disabled":true}"#), entry(r#"{"label":"Без id","header":""}"#)];
        let planned = plan("Actions", &items);
        assert_eq!(planned[0], Planned::Separator);
        assert_eq!(planned[1], Planned::Header("Ветки".to_owned()));
        assert_eq!(planned[2], Planned::Item { id: "gm|Actions|2|push".to_owned(), label: "Push".to_owned(), enabled: false });
        assert_eq!(planned[3], Planned::Item { id: "gm|Actions|3|".to_owned(), label: "Без id".to_owned(), enabled: true }, "пустой header — обычный пункт, как `it.header` в JS");
    }

    #[test]
    fn ids_round_trip() {
        assert_eq!(decode_id("gm|File|4|open|с чертой"), Some(MenuInvoke { menu: Some("File".to_owned()), index: 4, id: Some("open|с чертой".to_owned()) }));
        assert_eq!(decode_id(&encode_id(None, -1, Some("about"))), Some(MenuInvoke { menu: None, index: -1, id: Some("about".to_owned()) }));
        assert_eq!(decode_id(&encode_id(Some("Help"), 0, None)), Some(MenuInvoke { menu: Some("Help".to_owned()), index: 0, id: None }));
        assert_eq!(decode_id("copy"), None, "системные пункты не наши");
        assert_eq!(decode_id("gm|File|x|"), None);
    }
}
