//! Таблица `custom_actions`: конструктор действий. Перенос `localStorage['actions.v1']` из `src/lib/actions.js`.
//!
//! # Конспект исходника
//! - `readActions`: нечитаемые данные → `[]`, записи без `id` или массива `steps` отбрасываются.
//! - `writeActions(list)`: список записывается целиком, порядок значим.
//! - Действие: `{id, name, icon, steps[{id, type, params}], hotkey: string|null, toolbar: bool}`.
//!   Параметры шага — поля `STEP_TYPES`, типы `text|branch|select|textarea` (строка) и `bool`.
//! - Проверка (`validateAction`) и значения по умолчанию остаются в UI.
//!
//! `id` создаётся случайно в UI (`uid()`). При повторе остаётся первая запись: это первичный ключ.

use std::collections::BTreeMap;

use gorynych_core::error::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::{Db, json_error};

/// Значение параметра шага.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum StepParam {
    Bool(bool),
    Text(String),
}

/// Шаг действия.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ActionStep {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub params: BTreeMap<String, StepParam>,
}

/// Пользовательское действие.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CustomAction {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub steps: Vec<ActionStep>,
    pub hotkey: Option<String>,
    pub toolbar: bool,
}

impl Db {
    /// Действия в сохранённом порядке. Запись с нечитаемыми шагами пропускается.
    pub fn custom_actions(&self) -> Result<Vec<CustomAction>> {
        self.with(|conn| {
            let mut query =
                conn.prepare_cached("SELECT id, name, icon, steps, hotkey, toolbar FROM custom_actions ORDER BY position")?;
            let rows = query.query_map([], |row| {
                let steps: String = row.get(3)?;
                let Ok(steps) = serde_json::from_str(&steps) else {
                    return Ok(None);
                };
                Ok(Some(CustomAction {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    steps,
                    hotkey: row.get(4)?,
                    toolbar: row.get(5)?,
                }))
            })?;
            rows.filter_map(|row| row.transpose()).collect()
        })
    }

    /// Заменяет весь список.
    pub fn set_custom_actions(&self, actions: &[CustomAction]) -> Result<()> {
        self.transaction(|tx| {
            tx.execute("DELETE FROM custom_actions", [])?;
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO custom_actions (id, position, name, icon, steps, hotkey, toolbar)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for (position, action) in actions.iter().enumerate() {
                let steps = serde_json::to_string(&action.steps).map_err(json_error)?;
                insert.execute(params![
                    action.id,
                    position as i64,
                    action.name,
                    action.icon,
                    steps,
                    action.hotkey,
                    action.toolbar
                ])?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTION_JSON: &str = r#"{"id":"abc","name":"Убрать","icon":"Trash2","steps":[{"id":"s1","type":"pull","params":{"mode":"ff-only"}},{"id":"s2","type":"deleteBranch","params":{"force":false,"name":"{start}"}}],"hotkey":"Ctrl+Shift+K","toolbar":false}"#;

    fn action(id: &str) -> CustomAction {
        CustomAction { id: id.into(), name: id.into(), icon: "Zap".into(), steps: vec![], hotkey: None, toolbar: true }
    }

    #[test]
    fn json_round_trips_exactly_as_1x() {
        let parsed: CustomAction = serde_json::from_str(ACTION_JSON).unwrap();
        assert_eq!(parsed.steps[1].params["force"], StepParam::Bool(false));
        assert_eq!(serde_json::to_string(&parsed).unwrap(), ACTION_JSON);
    }

    #[test]
    fn list_is_replaced_and_keeps_order() {
        let db = Db::open_in_memory();
        assert!(db.custom_actions().unwrap().is_empty());

        let full: CustomAction = serde_json::from_str(ACTION_JSON).unwrap();
        let list = [action("z"), full, action("a")];
        db.set_custom_actions(&list).unwrap();
        assert_eq!(db.custom_actions().unwrap(), list);

        db.set_custom_actions(&list[2..]).unwrap();
        assert_eq!(db.custom_actions().unwrap(), &list[2..]);
    }

    #[test]
    fn duplicate_id_keeps_first() {
        let db = Db::open_in_memory();
        let mut second = action("x");
        second.name = "второе".into();
        db.set_custom_actions(&[action("x"), second]).unwrap();
        let saved = db.custom_actions().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].name, "x");
    }

    #[test]
    fn unreadable_row_is_skipped() {
        let db = Db::open_in_memory();
        db.set_custom_actions(&[action("good")]).unwrap();
        db.with(|conn| {
            conn.execute(
                "INSERT INTO custom_actions (id, position, name, icon, steps, toolbar) VALUES ('bad', 1, 'n', 'i', 'not json', 1)",
                [],
            )
        })
        .unwrap();
        let saved = db.custom_actions().unwrap();
        assert_eq!(saved.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["good"]);
    }
}
