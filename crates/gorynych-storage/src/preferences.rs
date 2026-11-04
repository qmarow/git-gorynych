//! Таблица `app_preferences`: `language.json`, `appearance` из `settings.json` и настройки `localStorage`.
//!
//! # Конспект исходников
//! - `i18n.cjs`: язык `{language}`; значение вне `ru|en` считается отсутствующим (`getLanguage` падает на `ru`).
//! - `main.cjs`: `appearance:get` → значение или `null`, `appearance:set` принимает объект и пишет целиком.
//!   Нормализует и подставляет значения по умолчанию сам UI (`normalizeAppearance`), поэтому все поля необязательны.
//!   Окно читает `background`, `material`, `scheme`, `base` (их добавляет `nativeAppearance`).
//! - `localStorage` (строки или JSON): `pullMode`, `ciSchemeView`, `clone.parent`, `branchFlowType`, `commitForm.v1`,
//!   `graph.view.v1`, `guard.v1`, `sidebar.*`, `width:*` и другие. Читает всегда с запасным значением.
//!
//! Повреждённое значение равносильно отсутствующему: так же вёл себя `JSON.parse` в `try/catch` в 1.x.

use gorynych_core::error::Result;
use gorynych_core::i18n::Language;
use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::db::{Db, NOW, json_error};

/// Ключи настроек, которые использует сам бэкенд.
pub mod keys {
    pub const LANGUAGE: &str = "language";
    pub const APPEARANCE: &str = "appearance";
    pub const LAST_REPO: &str = "lastRepo";
    pub const ACTIVE_TAB: &str = "activeTab";
}

/// Оформление (`DEFAULT_APPEARANCE` + `base`, `scheme` из `nativeAppearance`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_blur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_dim: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
}

pub(crate) fn read_pref<T: DeserializeOwned>(conn: &Connection, key: &str) -> rusqlite::Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM app_preferences WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    Ok(raw.and_then(|text| serde_json::from_str(&text).ok()))
}

pub(crate) fn write_pref<T: Serialize + ?Sized>(conn: &Connection, key: &str, value: &T) -> rusqlite::Result<()> {
    let text = serde_json::to_string(value).map_err(json_error)?;
    conn.execute(
        &format!(
            "INSERT INTO app_preferences (key, value, updated_at) VALUES (?1, ?2, {NOW})
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        ),
        params![key, text],
    )?;
    Ok(())
}

pub(crate) fn remove_pref(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM app_preferences WHERE key = ?1", [key])?;
    Ok(())
}

impl Db {
    /// Настройка по ключу; `None`, если её нет или значение другого типа.
    pub fn preference<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        self.with(|conn| read_pref(conn, key))
    }

    pub fn set_preference<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<()> {
        self.with(|conn| write_pref(conn, key, value))
    }

    pub fn remove_preference(&self, key: &str) -> Result<()> {
        self.with(|conn| remove_pref(conn, key))
    }

    /// Сохранённый язык. Значение по умолчанию выбирает `gorynych_core::i18n`.
    pub fn language(&self) -> Result<Option<Language>> {
        self.preference(keys::LANGUAGE)
    }

    pub fn set_language(&self, language: Language) -> Result<()> {
        self.set_preference(keys::LANGUAGE, &language)
    }

    pub fn appearance(&self) -> Result<Option<Appearance>> {
        self.preference(keys::APPEARANCE)
    }

    pub fn set_appearance(&self, appearance: &Appearance) -> Result<()> {
        self.set_preference(keys::APPEARANCE, appearance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_and_overwrite() {
        let db = Db::open_in_memory();
        assert_eq!(db.preference::<String>("pullMode").unwrap(), None);
        db.set_preference("pullMode", "rebase").unwrap();
        db.set_preference("pullMode", "merge").unwrap();
        assert_eq!(db.preference::<String>("pullMode").unwrap().as_deref(), Some("merge"));
        db.remove_preference("pullMode").unwrap();
        assert_eq!(db.preference::<String>("pullMode").unwrap(), None);
    }

    #[test]
    fn wrong_or_corrupt_value_reads_as_missing() {
        let db = Db::open_in_memory();
        db.set_preference(keys::LANGUAGE, "de").unwrap();
        assert_eq!(db.language().unwrap(), None);
        db.with(|conn| {
            conn.execute(
                "INSERT INTO app_preferences (key, value, updated_at) VALUES ('broken', '{not json', '')",
                [],
            )
        })
        .unwrap();
        assert_eq!(db.preference::<String>("broken").unwrap(), None);
    }

    #[test]
    fn language_uses_wire_codes() {
        let db = Db::open_in_memory();
        assert_eq!(db.language().unwrap(), None);
        db.set_language(Language::En).unwrap();
        assert_eq!(db.language().unwrap(), Some(Language::En));
        assert_eq!(db.preference::<String>(keys::LANGUAGE).unwrap().as_deref(), Some("en"));
    }

    #[test]
    fn appearance_reads_1x_json_shape() {
        let db = Db::open_in_memory();
        let saved: Appearance = serde_json::from_str(
            r##"{"theme":"kraken","background":"system","transparency":50,"imageBlur":8,"imageDim":45,"hasImage":false,"material":"mica","base":"#0e1117","scheme":"dark","motion":true,"blur":18}"##,
        )
        .unwrap();
        db.set_appearance(&saved).unwrap();
        let back = db.appearance().unwrap().unwrap();
        assert_eq!(back, saved);
        assert_eq!(back.image_blur, Some(8.0));
        let json = serde_json::to_value(&back).unwrap();
        assert_eq!(json["imageDim"], 45.0);
        assert_eq!(serde_json::to_value(Appearance::default()).unwrap(), serde_json::json!({}));
    }
}
