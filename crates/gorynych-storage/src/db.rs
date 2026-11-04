//! Соединение с `state.db`, схема и её версии.
//!
//! # Конспект
//! - В 1.x запись настроек глотала ошибки (`console.error`), а отсутствие файла означало пустые настройки.
//!   Здесь сбой базы — `NO_STORAGE` («Хранилище настроек недоступно»): этот код UI уже знает из `cicd/settings.cjs`.
//!   Текст ошибки SQLite — в `details`.
//! - Режимы: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`.
//! - Версия схемы — `meta.schema_version`. Миграции применяются по порядку в одной транзакции.
//!   База новее приложения не открывается, чтобы старая версия её не испортила.
//! - Путь передаётся явно: каталог данных знает только `gorynych-tauri`.

use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

/// Текущее время в формате `Date.prototype.toISOString()`.
pub(crate) const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SCHEMA_VERSION_KEY: &str = "schema_version";

/// Миграции по порядку; индекс + 1 — номер версии. Уже выпущенные не меняются.
const MIGRATIONS: &[&str] = &[r#"
    CREATE TABLE app_preferences (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE workspaces (
        kind      TEXT NOT NULL CHECK (kind IN ('tab', 'recent')),
        path      TEXT NOT NULL,
        position  INTEGER NOT NULL,
        name      TEXT,
        opened_at TEXT,
        PRIMARY KEY (kind, path)
    ) WITHOUT ROWID;

    CREATE TABLE repo_providers (
        repo_key TEXT PRIMARY KEY,
        provider TEXT CHECK (provider IN ('gitlab', 'github', 'gitea', 'bitbucket')),
        api_base TEXT,
        saved_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE undo_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_path  TEXT NOT NULL,
        stack      TEXT NOT NULL CHECK (stack IN ('undo', 'redo')),
        seq        INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        label      TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX undo_history_top ON undo_history (repo_path, stack, seq);

    CREATE TABLE undo_blobs (
        entry_id INTEGER NOT NULL REFERENCES undo_history (id) ON DELETE CASCADE,
        idx      INTEGER NOT NULL,
        data     BLOB NOT NULL,
        PRIMARY KEY (entry_id, idx)
    ) WITHOUT ROWID;

    CREATE TABLE custom_actions (
        id       TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        name     TEXT NOT NULL,
        icon     TEXT NOT NULL,
        steps    TEXT NOT NULL,
        hotkey   TEXT,
        toolbar  INTEGER NOT NULL
    ) WITHOUT ROWID;
"#];

/// Ошибка хранилища для UI.
pub(crate) fn storage_error(error: impl Display) -> GorynychError {
    GorynychError::new(ErrorCode::NoStorage, t("Хранилище настроек недоступно", &[])).with_details(error.to_string())
}

/// Ошибка сериализации значения перед записью в базу.
pub(crate) fn json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

/// База состояния приложения. Потокобезопасна: запросы идут по одному через мьютекс.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Открывает базу (при необходимости создаёт вместе с каталогом) и применяет миграции.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        Self::init(Connection::open(path).map_err(storage_error)?)
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> Self {
        Self::init(Connection::open_in_memory().expect("база в памяти")).expect("схема применяется")
    }

    fn init(mut conn: Connection) -> Result<Self> {
        configure(&conn).map_err(storage_error)?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        // Незавершённая транзакция откатывается при панике, так что база остаётся согласованной.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Выполняет запросы на соединении.
    pub(crate) fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        f(&self.lock()).map_err(storage_error)
    }

    /// Выполняет запросы в одной транзакции.
    pub(crate) fn transaction<T>(&self, f: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>) -> Result<T> {
        let mut conn = self.lock();
        let run = || {
            let tx = conn.transaction()?;
            let value = f(&tx)?;
            tx.commit()?;
            Ok(value)
        };
        run().map_err(|error: rusqlite::Error| storage_error(error))
    }

    /// Значение служебной таблицы (версия схемы, маркер миграции 1.x).
    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        self.with(|conn| read_meta(conn, key))
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.with(|conn| write_meta(conn, key, value))
    }
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    // journal_mode возвращает итоговый режим; у базы в памяти он останется `memory`.
    let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")
}

fn read_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0)).optional()
}

fn write_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(storage_error)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;")
        .map_err(storage_error)?;
    let stored = read_meta(&tx, SCHEMA_VERSION_KEY).map_err(storage_error)?;
    let version = match stored {
        None => 0,
        Some(text) => text
            .parse::<usize>()
            .map_err(|_| storage_error(format!("schema_version: некорректное значение «{text}»")))?,
    };
    if version > MIGRATIONS.len() {
        return Err(storage_error(format!(
            "версия схемы базы {version} новее поддерживаемой {}",
            MIGRATIONS.len()
        )));
    }
    for sql in &MIGRATIONS[version..] {
        tx.execute_batch(sql).map_err(storage_error)?;
    }
    write_meta(&tx, SCHEMA_VERSION_KEY, &MIGRATIONS.len().to_string()).map_err(storage_error)?;
    tx.commit().map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pragma(db: &Db, name: &str) -> String {
        db.with(|conn| {
            conn.query_row(&format!("PRAGMA {name}"), [], |row| {
                let value: rusqlite::types::Value = row.get(0)?;
                Ok(match value {
                    rusqlite::types::Value::Integer(n) => n.to_string(),
                    rusqlite::types::Value::Text(s) => s,
                    other => format!("{other:?}"),
                })
            })
        })
        .unwrap()
    }

    #[test]
    fn opens_file_with_required_pragmas_and_creates_parents() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("a/b/state.db")).unwrap();
        assert_eq!(pragma(&db, "journal_mode"), "wal");
        assert_eq!(pragma(&db, "synchronous"), "1");
        assert_eq!(pragma(&db, "foreign_keys"), "1");
    }

    #[test]
    fn reopening_keeps_data_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        Db::open(&path).unwrap().set_meta("marker", "x").unwrap();
        let db = Db::open(&path).unwrap();
        assert_eq!(db.meta("marker").unwrap().as_deref(), Some("x"));
        assert_eq!(db.meta(SCHEMA_VERSION_KEY).unwrap(), Some(MIGRATIONS.len().to_string()));
        assert_eq!(db.meta("missing").unwrap(), None);
    }

    #[test]
    fn newer_database_is_refused_and_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let future = (MIGRATIONS.len() + 1).to_string();
        Db::open(&path).unwrap().set_meta(SCHEMA_VERSION_KEY, &future).unwrap();

        let error = Db::open(&path).err().expect("новая база не открывается");
        assert_eq!(error.code, ErrorCode::NoStorage);
        assert!(error.details.contains("новее"), "{}", error.details);

        let conn = Connection::open(&path).unwrap();
        assert_eq!(read_meta(&conn, SCHEMA_VERSION_KEY).unwrap(), Some(future));
    }

    #[test]
    fn corrupt_schema_version_is_an_error_not_a_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        Db::open(&path).unwrap().set_meta(SCHEMA_VERSION_KEY, "abc").unwrap();
        assert_eq!(Db::open(&path).err().unwrap().code, ErrorCode::NoStorage);
    }

    #[test]
    fn failed_transaction_rolls_back() {
        let db = Db::open_in_memory();
        let result = db.transaction(|tx| {
            write_meta(tx, "k", "v")?;
            Err::<(), _>(rusqlite::Error::QueryReturnedNoRows)
        });
        assert_eq!(result.unwrap_err().code, ErrorCode::NoStorage);
        assert_eq!(db.meta("k").unwrap(), None);
    }
}
