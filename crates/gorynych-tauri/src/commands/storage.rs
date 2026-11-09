//! `localStorage` интерфейса 1.x поверх SQLite: слой совместимости (`src/platform/tauri.ts`) заполняет `localStorage` нового
//! WebView из базы при первом запуске и пишет изменения обратно пачками.
//!
//! # Ключи
//! Разбор тот же, что у переноса 1.x (`gorynych-storage::migrator`, `local_storage`):
//! - `language` — свой тип в базе; в `localStorage` строка `ru`/`en`, как писал её 1.x. Записывает его `app_set_language`.
//! - `appearance` — свой тип; в `localStorage` JSON объекта (кэш `readCachedAppearance`). Записывает его `appearance_set`.
//! - `actions.v1` — таблица `custom_actions`; запись с нечитаемой структурой или без `id` пропускается, как при переносе.
//! - `lastRepo`, `activeTab` — их ведёт бэкенд (`repo_load`, `tabs_save`), из интерфейса не принимаются.
//! - Прочие ключи — строки в `app_preferences` под тем же именем.

use std::collections::BTreeMap;

use gorynych_core::error::Result;
use gorynych_storage::custom_actions::CustomAction;
use gorynych_storage::preferences::keys;
use serde::Deserialize;
use tauri::State;

use crate::AppState;

const ACTIONS: &str = "actions.v1";

/// Изменение `localStorage`: `value: null` — ключ удалён.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct PrefChange {
    pub key: String,
    pub value: Option<String>,
}

/// Значения для `localStorage` из строк базы.
fn snapshot_from(raw: Vec<(String, String)>, actions: &[CustomAction]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (key, json) in raw {
        let value = match key.as_str() {
            keys::LAST_REPO | keys::ACTIVE_TAB => None,
            keys::APPEARANCE => Some(json),
            // Язык и прочие значения хранятся JSON-строкой; иной тип в `localStorage` не попадал
            _ => serde_json::from_str::<String>(&json).ok(),
        };
        if let Some(value) = value {
            out.insert(key, value);
        }
    }
    if !actions.is_empty()
        && let Ok(text) = serde_json::to_string(actions)
    {
        out.insert(ACTIONS.to_owned(), text);
    }
    out
}

/// Изменения настроек: ключ и новое значение, `None` — удалить.
type PrefUpdates = Vec<(String, Option<String>)>;

/// Что из изменений записать: настройки и, если менялся, список действий.
fn route(changes: Vec<PrefChange>) -> (PrefUpdates, Option<Vec<CustomAction>>) {
    let mut prefs: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut actions = None;
    for PrefChange { key, value } in changes {
        match key.as_str() {
            keys::LANGUAGE | keys::APPEARANCE | keys::LAST_REPO | keys::ACTIVE_TAB => {}
            ACTIONS => actions = Some(parse_actions(value.as_deref())),
            // Последнее изменение ключа в пачке побеждает
            _ => {
                prefs.insert(key, value);
            }
        }
    }
    (prefs.into_iter().collect(), actions)
}

/// `readActions`: нечитаемые данные — пустой список, записи без `id` или с другой структурой отбрасываются.
fn parse_actions(raw: Option<&str>) -> Vec<CustomAction> {
    let Some(Ok(serde_json::Value::Array(list))) = raw.map(serde_json::from_str::<serde_json::Value>) else {
        return Vec::new();
    };
    list.into_iter().filter_map(|item| serde_json::from_value::<CustomAction>(item).ok()).filter(|action| !action.id.is_empty()).collect()
}

/// Значения для `localStorage`.
#[tauri::command]
#[specta::specta]
pub fn prefs_snapshot(state: State<'_, AppState>) -> Result<BTreeMap<String, String>> {
    let db = &state.services()?.db;
    Ok(snapshot_from(db.preferences_raw()?, &db.custom_actions()?))
}

/// Изменения `localStorage` пачкой, одной транзакцией.
#[tauri::command]
#[specta::specta]
pub fn prefs_write(state: State<'_, AppState>, changes: Vec<PrefChange>) -> Result<()> {
    let db = &state.services()?.db;
    let (prefs, actions) = route(changes);
    if !prefs.is_empty() {
        db.apply_preferences(&prefs)?;
    }
    if let Some(actions) = actions {
        db.set_custom_actions(&actions)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(key: &str, value: Option<&str>) -> PrefChange {
        PrefChange { key: key.to_owned(), value: value.map(str::to_owned) }
    }

    #[test]
    fn snapshot_restores_1x_local_storage_shapes() {
        let raw = vec![
            ("activeTab".to_owned(), "\"C:/r\"".to_owned()),
            ("appearance".to_owned(), r#"{"theme":"light"}"#.to_owned()),
            ("language".to_owned(), "\"en\"".to_owned()),
            ("pullMode".to_owned(), "\"rebase\"".to_owned()),
            ("число".to_owned(), "5".to_owned()),
        ];
        let actions: Vec<CustomAction> = serde_json::from_str(r#"[{"id":"a1","name":"Сборка","icon":"Play","steps":[],"hotkey":null,"toolbar":true}]"#).unwrap();
        let out = snapshot_from(raw, &actions);
        assert_eq!(out.get("language").map(String::as_str), Some("en"), "строка, а не JSON");
        assert_eq!(out.get("appearance").map(String::as_str), Some(r#"{"theme":"light"}"#));
        assert_eq!(out.get("pullMode").map(String::as_str), Some("rebase"));
        assert!(!out.contains_key("activeTab") && !out.contains_key("число"), "{out:?}");
        let listed: serde_json::Value = serde_json::from_str(&out["actions.v1"]).unwrap();
        assert_eq!(listed[0]["id"], "a1");
    }

    #[test]
    fn changes_are_routed_by_key() {
        let (prefs, actions) = route(vec![
            change("pullMode", Some("merge")),
            change("language", Some("en")),
            change("appearance", Some("{}")),
            change("lastRepo", Some("x")),
            change("width:sidebar", Some("200")),
            change("width:sidebar", None),
            change("actions.v1", Some(r#"[{"id":"a","name":"","icon":"","steps":[],"hotkey":null,"toolbar":false},{"name":"без id"},{"id":"","name":"","icon":"","steps":[],"hotkey":null,"toolbar":false}]"#)),
        ]);
        assert_eq!(prefs, [("pullMode".to_owned(), Some("merge".to_owned())), ("width:sidebar".to_owned(), None)], "последнее изменение побеждает");
        assert_eq!(actions.unwrap().len(), 1, "без id и с другой структурой — отброшены");
        assert_eq!(route(vec![change("actions.v1", Some("не json"))]).1, Some(Vec::new()));
    }
}
