//! Таблицы `undo_history` и `undo_blobs`: стеки undo/redo. Перенос хранения из `electron/actions.cjs`.
//!
//! # Конспект исходника
//! - `histories: Map<cwd, {undo[], redo[]}>`, ключ — точная строка пути. В 1.x живёт только в памяти, здесь — на диске.
//! - `record`: положить в undo, при длине больше 50 убрать самую старую запись, очистить redo.
//! - `historySummary`: `{undo, redo}` — подписи верхних записей или `null`.
//! - `undo`/`redo`: взять верхнюю запись, выполнить обработчик и **только при успехе** переложить в другой стек.
//!   Обработчик может изменить запись (например, `e.hash` при повторе stash), поэтому при перекладывании можно
//!   передать новый payload. Отсюда разделение на [`Db::top_undo`] и [`Db::complete_undo`].
//! - Перекладывание лимит не проверяет: сумма записей не растёт, так что undo не превысит 50.
//! - `historyFor(cwd).redo = []` вызывается и отдельно — [`Db::clear_redo`].
//!
//! # Что здесь не перенесено
//! Обработчики и коды `HISTORY_EMPTY/STALE/ROOT/PUSHED` работают с git и появятся в `gorynych-git` (Фаза 3). Там же будет
//! типизированная запись: хранилище считает `kind` и `payload` непрозрачными.
//!
//! # Снимки файлов
//! Запись `fileSnapshot` содержит файл до и после операции, до 20 МБ каждый (`restore.cjs::MAX_SNAPSHOT`), причём не
//! текст, а байты. В JSON они раздули бы таблицу, поэтому лежат в `undo_blobs` и читаются только с записью на вершине.
//! Удаляются каскадно вместе с записью.

use gorynych_core::error::Result;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::{Db, NOW};

const UNDO_LIMIT: i64 = 50;
/// Предел снимков файлов на репозиторий. 1.x держал снимки в памяти до выхода, а здесь они остаются на диске: 50 записей по 40 МБ — это 2 ГБ.
/// При превышении пропадают самые старые записи; самая новая остаётся, даже если одна больше предела, иначе операцию нельзя было бы отменить.
const UNDO_BLOBS_LIMIT: i64 = 256 * 1024 * 1024;
const STACK_UNDO: &str = "undo";
const STACK_REDO: &str = "redo";

/// Подписи верхних записей стеков.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct HistorySummary {
    pub undo: Option<String>,
    pub redo: Option<String>,
}

/// Новая запись истории.
#[derive(Debug, Clone, Copy)]
pub struct NewUndoEntry<'a> {
    /// Тип обработчика (`commit`, `headMove`, `fileSnapshot`, …).
    pub kind: &'a str,
    /// Уже переведённая подпись для меню.
    pub label: &'a str,
    /// Данные обработчика в JSON.
    pub payload: &'a str,
    /// Двоичные данные; на них ссылается `payload` по индексу.
    pub blobs: &'a [&'a [u8]],
}

/// Запись истории со всеми данными.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoEntry {
    pub id: i64,
    pub kind: String,
    pub label: String,
    pub payload: String,
    pub blobs: Vec<Vec<u8>>,
}

fn next_seq(conn: &Connection, repo: &str) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM undo_history WHERE repo_path = ?1", [repo], |row| row.get(0))
}

fn delete_redo(conn: &Connection, repo: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM undo_history WHERE repo_path = ?1 AND stack = ?2", params![repo, STACK_REDO])?;
    Ok(())
}

/// Удаляет записи, не поместившиеся в [`UNDO_BLOBS_LIMIT`], считая от самой новой. Стек остаётся непрерывным: всё, что старше первой лишней, тоже удаляется.
fn trim_blobs(conn: &Connection, repo: &str, limit: i64) -> rusqlite::Result<()> {
    let sizes: Vec<(i64, i64)> = conn
        .prepare_cached(
            "SELECT h.seq, COALESCE(SUM(LENGTH(b.data)), 0) FROM undo_history h LEFT JOIN undo_blobs b ON b.entry_id = h.id
             WHERE h.repo_path = ?1 AND h.stack = ?2 GROUP BY h.id ORDER BY h.seq DESC",
        )?
        .query_map(params![repo, STACK_UNDO], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut total = 0;
    for (index, (seq, size)) in sizes.iter().enumerate() {
        total += size;
        if total > limit && index > 0 {
            conn.execute("DELETE FROM undo_history WHERE repo_path = ?1 AND stack = ?2 AND seq <= ?3", params![repo, STACK_UNDO, seq])?;
            break;
        }
    }
    Ok(())
}

fn top_label(conn: &Connection, repo: &str, stack: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT label FROM undo_history WHERE repo_path = ?1 AND stack = ?2 ORDER BY seq DESC LIMIT 1",
        params![repo, stack],
        |row| row.get(0),
    )
    .optional()
}

fn top_entry(conn: &Connection, repo: &str, stack: &str) -> rusqlite::Result<Option<UndoEntry>> {
    let entry = conn
        .query_row(
            "SELECT id, kind, label, payload FROM undo_history
             WHERE repo_path = ?1 AND stack = ?2 ORDER BY seq DESC LIMIT 1",
            params![repo, stack],
            |row| {
                Ok(UndoEntry {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    label: row.get(2)?,
                    payload: row.get(3)?,
                    blobs: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut entry) = entry else {
        return Ok(None);
    };
    entry.blobs = conn
        .prepare_cached("SELECT data FROM undo_blobs WHERE entry_id = ?1 ORDER BY idx")?
        .query_map([entry.id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(entry))
}

impl Db {
    /// Добавляет запись: старше 50-й удаляются, redo очищается. Возвращает id записи.
    pub fn record_undo(&self, repo: &str, entry: NewUndoEntry<'_>) -> Result<i64> {
        self.transaction(|tx| {
            let seq = next_seq(tx, repo)?;
            tx.execute(
                &format!(
                    "INSERT INTO undo_history (repo_path, stack, seq, kind, label, payload, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, {NOW})"
                ),
                params![repo, STACK_UNDO, seq, entry.kind, entry.label, entry.payload],
            )?;
            let id = tx.last_insert_rowid();
            let mut insert = tx.prepare_cached("INSERT INTO undo_blobs (entry_id, idx, data) VALUES (?1, ?2, ?3)")?;
            for (idx, data) in entry.blobs.iter().enumerate() {
                insert.execute(params![id, idx as i64, data])?;
            }
            tx.execute(
                "DELETE FROM undo_history WHERE repo_path = ?1 AND stack = ?2 AND seq NOT IN (
                     SELECT seq FROM undo_history WHERE repo_path = ?1 AND stack = ?2 ORDER BY seq DESC LIMIT ?3
                 )",
                params![repo, STACK_UNDO, UNDO_LIMIT],
            )?;
            delete_redo(tx, repo)?;
            if !entry.blobs.is_empty() {
                trim_blobs(tx, repo, UNDO_BLOBS_LIMIT)?;
            }
            Ok(id)
        })
    }

    /// Подписи для меню. Данные снимков не читаются.
    pub fn history_summary(&self, repo: &str) -> Result<HistorySummary> {
        self.with(|conn| {
            Ok(HistorySummary { undo: top_label(conn, repo, STACK_UNDO)?, redo: top_label(conn, repo, STACK_REDO)? })
        })
    }

    /// Запись, которую отменит следующий Undo. Стек не меняется.
    pub fn top_undo(&self, repo: &str) -> Result<Option<UndoEntry>> {
        self.with(|conn| top_entry(conn, repo, STACK_UNDO))
    }

    /// Запись, которую вернёт следующий Redo. Стек не меняется.
    pub fn top_redo(&self, repo: &str) -> Result<Option<UndoEntry>> {
        self.with(|conn| top_entry(conn, repo, STACK_REDO))
    }

    /// Undo удался: перекладывает запись в redo. `payload` — новые данные, если обработчик их изменил.
    pub fn complete_undo(&self, entry_id: i64, payload: Option<&str>) -> Result<()> {
        self.move_entry(entry_id, STACK_REDO, payload)
    }

    /// Redo удался: перекладывает запись в undo. `payload` — новые данные, если обработчик их изменил.
    pub fn complete_redo(&self, entry_id: i64, payload: Option<&str>) -> Result<()> {
        self.move_entry(entry_id, STACK_UNDO, payload)
    }

    fn move_entry(&self, entry_id: i64, stack: &str, payload: Option<&str>) -> Result<()> {
        self.transaction(|tx| {
            let repo: String =
                tx.query_row("SELECT repo_path FROM undo_history WHERE id = ?1", [entry_id], |row| row.get(0))?;
            let seq = next_seq(tx, &repo)?;
            tx.execute(
                "UPDATE undo_history SET stack = ?1, seq = ?2, payload = COALESCE(?3, payload) WHERE id = ?4",
                params![stack, seq, payload, entry_id],
            )?;
            Ok(())
        })
    }

    /// Очищает redo: операция изменила репозиторий, но не попала в историю.
    pub fn clear_redo(&self, repo: &str) -> Result<()> {
        self.with(|conn| delete_redo(conn, repo))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gorynych_core::error::ErrorCode;

    const REPO: &str = "C:/repo";

    fn entry(label: &str) -> NewUndoEntry<'_> {
        NewUndoEntry { kind: "headMove", label, payload: "{}", blobs: &[] }
    }

    fn undo_once(db: &Db, repo: &str) -> UndoEntry {
        let top = db.top_undo(repo).unwrap().expect("есть что отменять");
        db.complete_undo(top.id, None).unwrap();
        top
    }

    fn redo_once(db: &Db, repo: &str) -> UndoEntry {
        let top = db.top_redo(repo).unwrap().expect("есть что возвращать");
        db.complete_redo(top.id, None).unwrap();
        top
    }

    fn summary(db: &Db) -> (Option<String>, Option<String>) {
        let s = db.history_summary(REPO).unwrap();
        (s.undo, s.redo)
    }

    fn some(text: &str) -> Option<String> {
        Some(text.to_owned())
    }

    #[test]
    fn empty_history() {
        let db = Db::open_in_memory();
        assert_eq!(db.history_summary(REPO).unwrap(), HistorySummary::default());
        assert_eq!(db.top_undo(REPO).unwrap(), None);
        assert_eq!(db.top_redo(REPO).unwrap(), None);
    }

    #[test]
    fn lifo_across_stacks() {
        let db = Db::open_in_memory();
        db.record_undo(REPO, entry("a")).unwrap();
        db.record_undo(REPO, entry("b")).unwrap();
        assert_eq!(summary(&db), (some("b"), None));

        assert_eq!(undo_once(&db, REPO).label, "b");
        assert_eq!(summary(&db), (some("a"), some("b")));
        assert_eq!(undo_once(&db, REPO).label, "a");
        assert_eq!(summary(&db), (None, some("a")));

        assert_eq!(redo_once(&db, REPO).label, "a");
        assert_eq!(redo_once(&db, REPO).label, "b");
        assert_eq!(summary(&db), (some("b"), None));
    }

    #[test]
    fn peeking_does_not_consume_so_failed_handler_keeps_entry() {
        let db = Db::open_in_memory();
        db.record_undo(REPO, entry("a")).unwrap();
        assert_eq!(db.top_undo(REPO).unwrap().unwrap().label, "a");
        assert_eq!(summary(&db), (some("a"), None));
    }

    #[test]
    fn new_record_clears_redo() {
        let db = Db::open_in_memory();
        db.record_undo(REPO, entry("a")).unwrap();
        undo_once(&db, REPO);
        db.record_undo(REPO, entry("b")).unwrap();
        assert_eq!(summary(&db), (some("b"), None));
    }

    #[test]
    fn clear_redo_leaves_undo() {
        let db = Db::open_in_memory();
        db.record_undo(REPO, entry("a")).unwrap();
        db.record_undo(REPO, entry("b")).unwrap();
        undo_once(&db, REPO);
        db.clear_redo(REPO).unwrap();
        assert_eq!(summary(&db), (some("a"), None));
    }

    #[test]
    fn limit_drops_oldest_only() {
        let db = Db::open_in_memory();
        for i in 0..55 {
            db.record_undo(REPO, entry(&format!("e{i}"))).unwrap();
        }
        let mut labels = Vec::new();
        while let Some(top) = db.top_undo(REPO).unwrap() {
            db.complete_undo(top.id, None).unwrap();
            labels.push(top.label);
        }
        assert_eq!(labels.len(), 50);
        assert_eq!(labels.first().map(String::as_str), Some("e54"));
        assert_eq!(labels.last().map(String::as_str), Some("e5"));
    }

    #[test]
    fn repositories_are_separate_and_keyed_exactly() {
        let db = Db::open_in_memory();
        db.record_undo("C:/a", entry("a")).unwrap();
        db.record_undo("C:/b", entry("b")).unwrap();
        undo_once(&db, "C:/b");
        assert_eq!(db.history_summary("C:/a").unwrap().undo, some("a"));
        assert_eq!(db.history_summary("C:/A").unwrap(), HistorySummary::default());
    }

    #[test]
    fn handler_may_replace_payload_when_moving() {
        let db = Db::open_in_memory();
        let id = db.record_undo(REPO, NewUndoEntry { kind: "stash", label: "Stash", payload: r#"{"hash":"old"}"#, blobs: &[] }).unwrap();
        db.complete_undo(id, Some(r#"{"hash":"new"}"#)).unwrap();
        assert_eq!(db.top_redo(REPO).unwrap().unwrap().payload, r#"{"hash":"new"}"#);
        db.complete_redo(id, None).unwrap();
        assert_eq!(db.top_undo(REPO).unwrap().unwrap().payload, r#"{"hash":"new"}"#, "None сохраняет данные");
    }

    #[test]
    fn moving_unknown_entry_is_an_error() {
        let db = Db::open_in_memory();
        assert_eq!(db.complete_undo(999, None).unwrap_err().code, ErrorCode::NoStorage);
    }

    fn blob_rows(db: &Db) -> i64 {
        db.with(|conn| conn.query_row("SELECT COUNT(*) FROM undo_blobs", [], |row| row.get(0))).unwrap()
    }

    #[test]
    fn blobs_keep_bytes_and_order_and_follow_their_entry() {
        let db = Db::open_in_memory();
        let binary: &[u8] = &[0, 255, 0, 10, 13];
        let id = db
            .record_undo(REPO, NewUndoEntry { kind: "fileSnapshot", label: "f", payload: "{}", blobs: &[binary, b"after", b""] })
            .unwrap();
        assert_eq!(db.top_undo(REPO).unwrap().unwrap().blobs, [binary.to_vec(), b"after".to_vec(), Vec::new()]);

        db.complete_undo(id, None).unwrap();
        assert_eq!(db.top_redo(REPO).unwrap().unwrap().blobs.len(), 3, "снимок едет вместе с записью");

        db.clear_redo(REPO).unwrap();
        assert_eq!(blob_rows(&db), 0, "каскадное удаление");
    }

    #[test]
    fn trimming_the_stack_frees_blobs() {
        let db = Db::open_in_memory();
        db.record_undo(REPO, NewUndoEntry { kind: "fileSnapshot", label: "old", payload: "{}", blobs: &[b"x"] }).unwrap();
        for i in 0..50 {
            db.record_undo(REPO, entry(&format!("e{i}"))).unwrap();
        }
        assert_eq!(blob_rows(&db), 0);
    }

    #[test]
    fn blob_limit_drops_oldest_and_keeps_newest() {
        let db = Db::open_in_memory();
        let snap = |label| NewUndoEntry { kind: "fileSnapshot", label, payload: "{}", blobs: &[b"12345"] };
        db.record_undo(REPO, snap("старая")).unwrap();
        db.record_undo(REPO, entry("без снимка")).unwrap();
        db.record_undo(REPO, snap("средняя")).unwrap();
        db.record_undo(REPO, snap("новая")).unwrap();

        db.with(|conn| trim_blobs(conn, REPO, 10)).unwrap();
        let mut labels = Vec::new();
        while let Some(top) = db.top_undo(REPO).unwrap() {
            db.complete_undo(top.id, None).unwrap();
            labels.push(top.label);
        }
        assert_eq!(labels, ["новая", "средняя", "без снимка"], "старше первой лишней не остаётся ничего");

        let db = Db::open_in_memory();
        db.record_undo(REPO, snap("новая")).unwrap();
        db.with(|conn| trim_blobs(conn, REPO, 1)).unwrap();
        assert_eq!(summary(&db).0.as_deref(), Some("новая"), "самая новая остаётся, даже если больше предела");
    }

    #[test]
    fn history_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        {
            let db = Db::open(&path).unwrap();
            db.record_undo(REPO, NewUndoEntry { kind: "commit", label: "a", payload: "{}", blobs: &[b"x"] }).unwrap();
            db.record_undo(REPO, entry("b")).unwrap();
            undo_once(&db, REPO);
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(summary(&db), (some("a"), some("b")));
        assert_eq!(db.top_undo(REPO).unwrap().unwrap().blobs, [b"x".to_vec()]);
    }
}
