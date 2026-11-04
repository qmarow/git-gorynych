//! Таблица `workspaces`: вкладки и недавние репозитории. Перенос `settings.json` из `electron/main.cjs`.
//!
//! # Конспект исходника
//! - `recentRepos`: свежие сверху, максимум 30. Сначала отбрасываются повторы, причём на Windows без учёта регистра,
//!   и папки, которых нет на диске; лимит применяется после фильтра. Пустой список заполняется из `[...tabs, lastRepo]`
//!   с `openedAt: null` (в том числе после удаления последней записи). `name || basename(path)`.
//! - `rememberRecent(dir, name)`: убрать запись `dir` (на Windows без учёта регистра), поставить в начало, `openedAt` = сейчас.
//! - `recent:remove`: сравнение **с учётом регистра**, в отличие от `rememberRecent`, — оставлено как в 1.x.
//! - `repo:get-last`: `lastRepo`, если папка существует, иначе `null`.
//! - `tabs:get`: пустые вкладки заменяются на `[lastRepo]`; без повторов (с учётом регистра); только существующие папки.
//!   `active` = `activeTab`, если она среди вкладок, иначе первая вкладка или `null`.
//! - `tabs:save`: не строковый `active` → `null`. Повторы вкладок при записи отбрасываются, остаётся первая: при чтении
//!   1.x получалось то же самое.
//!
//! `lastRepo` и `activeTab` лежат в `app_preferences`.

use std::collections::HashSet;
use std::path::Path;

use gorynych_core::error::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::db::{Db, NOW};
use crate::preferences::{keys, read_pref, remove_pref, write_pref};

const RECENT_MAX: usize = 30;
const KIND_RECENT: &str = "recent";
const KIND_TAB: &str = "tab";

/// Недавний репозиторий.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub opened_at: Option<String>,
}

/// Открытые вкладки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct TabsState {
    pub tabs: Vec<String>,
    pub active: Option<String>,
}

struct Row {
    path: String,
    name: Option<String>,
    opened_at: Option<String>,
}

/// Аналог `path.basename`. Для пути без имени (корень диска) — пустая строка.
fn basename(path: &str) -> String {
    Path::new(path).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Ключ сравнения путей: на Windows регистр не важен.
fn path_key(path: &str) -> String {
    if cfg!(windows) { path.to_lowercase() } else { path.to_owned() }
}

fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

fn read_rows(conn: &Connection, kind: &str) -> rusqlite::Result<Vec<Row>> {
    conn.prepare_cached("SELECT path, name, opened_at FROM workspaces WHERE kind = ?1 ORDER BY position")?
        .query_map([kind], |row| Ok(Row { path: row.get(0)?, name: row.get(1)?, opened_at: row.get(2)? }))?
        .collect()
}

fn read_tab_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    Ok(read_rows(conn, KIND_TAB)?.into_iter().map(|row| row.path).collect())
}

fn read_recent(conn: &Connection) -> rusqlite::Result<Vec<RecentRepo>> {
    let mut rows = read_rows(conn, KIND_RECENT)?;
    if rows.is_empty() {
        let mut seed = read_tab_paths(conn)?;
        seed.extend(read_pref::<String>(conn, keys::LAST_REPO)?);
        let mut seen = HashSet::new();
        rows = seed
            .into_iter()
            .filter(|path| seen.insert(path.clone()))
            .map(|path| Row { path, name: None, opened_at: None })
            .collect();
    }
    let mut seen = HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|row| seen.insert(path_key(&row.path)) && exists(&row.path))
        .take(RECENT_MAX)
        .map(|row| {
            let name = row.name.filter(|name| !name.is_empty()).unwrap_or_else(|| basename(&row.path));
            RecentRepo { path: row.path, name, opened_at: row.opened_at }
        })
        .collect())
}

fn write_recent(conn: &Connection, list: &[RecentRepo]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM workspaces WHERE kind = ?1", [KIND_RECENT])?;
    let mut insert = conn.prepare_cached(
        "INSERT OR IGNORE INTO workspaces (kind, path, position, name, opened_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (position, repo) in list.iter().enumerate() {
        insert.execute(params![KIND_RECENT, repo.path, position as i64, repo.name, repo.opened_at])?;
    }
    Ok(())
}

impl Db {
    /// Недавние репозитории: свежие сверху, только существующие папки.
    pub fn recent_repos(&self) -> Result<Vec<RecentRepo>> {
        self.with(read_recent)
    }

    /// Поднимает репозиторий в начало списка недавних. `name = None` — взять имя папки.
    pub fn remember_recent(&self, dir: &str, name: Option<&str>) -> Result<()> {
        self.transaction(|tx| {
            let key = path_key(dir);
            let opened_at: String = tx.query_row(&format!("SELECT {NOW}"), [], |row| row.get(0))?;
            let name = name.filter(|name| !name.is_empty()).map_or_else(|| basename(dir), str::to_owned);
            let mut list = vec![RecentRepo { path: dir.to_owned(), name, opened_at: Some(opened_at) }];
            list.extend(read_recent(tx)?.into_iter().filter(|repo| path_key(&repo.path) != key));
            list.truncate(RECENT_MAX);
            write_recent(tx, &list)
        })
    }

    /// Убирает запись из недавних. Путь сравнивается точно, с учётом регистра.
    pub fn remove_recent(&self, dir: &str) -> Result<()> {
        self.transaction(|tx| {
            let mut list = read_recent(tx)?;
            list.retain(|repo| repo.path != dir);
            write_recent(tx, &list)
        })
    }

    /// Переносит вкладки и недавние из `settings.json`, если соответствующий список ещё пуст.
    /// Возвращает, сколько записей каждого вида добавлено.
    pub(crate) fn import_workspaces(&self, tabs: &[String], active: Option<&str>, recents: &[RecentRepo]) -> Result<(u32, u32)> {
        self.transaction(|tx| {
            let is_empty = |kind: &str| -> rusqlite::Result<bool> {
                tx.query_row("SELECT NOT EXISTS (SELECT 1 FROM workspaces WHERE kind = ?1)", [kind], |row| row.get(0))
            };
            let (mut imported_tabs, mut imported_recents) = (0, 0);
            if !tabs.is_empty() && is_empty(KIND_TAB)? {
                let mut insert = tx.prepare_cached("INSERT OR IGNORE INTO workspaces (kind, path, position) VALUES (?1, ?2, ?3)")?;
                for (position, path) in tabs.iter().enumerate() {
                    imported_tabs += insert.execute(params![KIND_TAB, path, position as i64])? as u32;
                }
                if let Some(path) = active {
                    write_pref(tx, keys::ACTIVE_TAB, path)?;
                }
            }
            if !recents.is_empty() && is_empty(KIND_RECENT)? {
                write_recent(tx, recents)?;
                imported_recents = tx.query_row("SELECT COUNT(*) FROM workspaces WHERE kind = ?1", [KIND_RECENT], |row| row.get(0))?;
            }
            Ok((imported_tabs, imported_recents))
        })
    }

    /// Последний открытый репозиторий, если его папка существует.
    pub fn last_repo(&self) -> Result<Option<String>> {
        let last: Option<String> = self.with(|conn| read_pref(conn, keys::LAST_REPO))?;
        Ok(last.filter(|path| exists(path)))
    }

    pub fn set_last_repo(&self, path: &str) -> Result<()> {
        self.with(|conn| write_pref(conn, keys::LAST_REPO, path))
    }

    /// Открытые вкладки, только существующие папки.
    pub fn tabs(&self) -> Result<TabsState> {
        self.with(|conn| {
            let mut tabs = read_tab_paths(conn)?;
            if tabs.is_empty() {
                tabs.extend(read_pref::<String>(conn, keys::LAST_REPO)?);
            }
            tabs.retain(|path| exists(path));
            let saved: Option<String> = read_pref(conn, keys::ACTIVE_TAB)?;
            let active = saved.filter(|path| tabs.contains(path)).or_else(|| tabs.first().cloned());
            Ok(TabsState { tabs, active })
        })
    }

    pub fn save_tabs(&self, tabs: &[String], active: Option<&str>) -> Result<()> {
        self.transaction(|tx| {
            tx.execute("DELETE FROM workspaces WHERE kind = ?1", [KIND_TAB])?;
            let mut insert =
                tx.prepare_cached("INSERT OR IGNORE INTO workspaces (kind, path, position) VALUES (?1, ?2, ?3)")?;
            for (position, path) in tabs.iter().enumerate() {
                insert.execute(params![KIND_TAB, path, position as i64])?;
            }
            match active {
                Some(path) => write_pref(tx, keys::ACTIVE_TAB, path),
                None => remove_pref(tx, keys::ACTIVE_TAB),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        db: Db,
        dir: tempfile::TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self { db: Db::open_in_memory(), dir: tempfile::tempdir().unwrap() }
        }

        /// Создаёт папку и возвращает её путь.
        fn folder(&self, name: &str) -> String {
            let path = self.dir.path().join(name);
            fs::create_dir_all(&path).unwrap();
            path.to_string_lossy().into_owned()
        }

        fn missing(&self, name: &str) -> String {
            self.dir.path().join(name).to_string_lossy().into_owned()
        }

        fn recent_paths(&self) -> Vec<String> {
            self.db.recent_repos().unwrap().into_iter().map(|repo| repo.path).collect()
        }
    }

    #[test]
    fn newest_first_and_reopen_moves_to_top() {
        let f = Fixture::new();
        let (a, b) = (f.folder("a"), f.folder("b"));
        f.db.remember_recent(&a, Some("Репо А")).unwrap();
        f.db.remember_recent(&b, None).unwrap();
        f.db.remember_recent(&a, Some("Репо А")).unwrap();
        let list = f.db.recent_repos().unwrap();
        assert_eq!(list.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), [a.as_str(), b.as_str()]);
        assert_eq!(list[0].name, "Репо А");
        assert_eq!(list[1].name, "b");
        let opened = list[0].opened_at.as_deref().unwrap();
        assert!(opened.ends_with('Z') && opened.len() == "2026-11-04T13:02:00.000Z".len(), "{opened}");
    }

    #[test]
    fn limit_is_thirty() {
        let f = Fixture::new();
        for i in 0..35 {
            f.db.remember_recent(&f.folder(&format!("r{i}")), None).unwrap();
        }
        let list = f.recent_paths();
        assert_eq!(list.len(), RECENT_MAX);
        assert_eq!(list[0], f.missing("r34"));
    }

    #[test]
    fn missing_folders_are_hidden_and_do_not_use_up_the_limit() {
        let f = Fixture::new();
        let kept = f.folder("kept");
        f.db.remember_recent(&kept, None).unwrap();
        f.db.remember_recent(&f.missing("gone"), None).unwrap();
        assert_eq!(f.recent_paths(), [kept]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_dedupe_ignoring_case_but_remove_is_exact() {
        let f = Fixture::new();
        let a = f.folder("repo");
        let upper = a.to_uppercase();
        f.db.remember_recent(&a, None).unwrap();
        f.db.remember_recent(&upper, None).unwrap();
        assert_eq!(f.recent_paths(), std::slice::from_ref(&upper));
        f.db.remove_recent(&a).unwrap();
        assert_eq!(f.recent_paths(), std::slice::from_ref(&upper), "remove сравнивает с учётом регистра");
        f.db.remove_recent(&upper).unwrap();
        assert!(f.recent_paths().is_empty());
    }

    #[test]
    fn empty_recents_are_seeded_from_tabs_and_last_repo() {
        let f = Fixture::new();
        let (a, b) = (f.folder("a"), f.folder("b"));
        f.db.save_tabs(&[a.clone(), a.clone()], None).unwrap();
        f.db.set_last_repo(&b).unwrap();
        let list = f.db.recent_repos().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].path.as_str(), list[0].name.as_str()), (a.as_str(), "a"));
        assert_eq!(list[1].path, b);
        assert_eq!(list[1].opened_at, None);

        // Удаление последней записи снова открывает посев — поведение 1.x
        f.db.remember_recent(&b, None).unwrap();
        f.db.remove_recent(&b).unwrap();
        f.db.remove_recent(&a).unwrap();
        assert_eq!(f.recent_paths(), [a, b]);
    }

    #[test]
    fn last_repo_requires_existing_folder() {
        let f = Fixture::new();
        assert_eq!(f.db.last_repo().unwrap(), None);
        f.db.set_last_repo(&f.missing("gone")).unwrap();
        assert_eq!(f.db.last_repo().unwrap(), None);
        let a = f.folder("a");
        f.db.set_last_repo(&a).unwrap();
        assert_eq!(f.db.last_repo().unwrap(), Some(a));
    }

    #[test]
    fn tabs_fall_back_like_1x() {
        let f = Fixture::new();
        assert_eq!(f.db.tabs().unwrap(), TabsState { tabs: vec![], active: None });

        let (a, b) = (f.folder("a"), f.folder("b"));
        f.db.set_last_repo(&a).unwrap();
        assert_eq!(f.db.tabs().unwrap(), TabsState { tabs: vec![a.clone()], active: Some(a.clone()) });

        let gone = f.missing("gone");
        let saved = [gone.clone(), b.clone(), a.clone(), b.clone()];
        f.db.save_tabs(&saved, Some(&a)).unwrap();
        assert_eq!(f.db.tabs().unwrap(), TabsState { tabs: vec![b.clone(), a.clone()], active: Some(a.clone()) });

        f.db.save_tabs(&saved, Some(&gone)).unwrap();
        assert_eq!(f.db.tabs().unwrap().active, Some(b.clone()), "активная вкладка исчезла — берём первую");

        f.db.save_tabs(&saved, None).unwrap();
        assert_eq!(f.db.tabs().unwrap().active, Some(b));
    }

    #[test]
    fn tabs_and_recents_are_independent_lists() {
        let f = Fixture::new();
        let a = f.folder("a");
        f.db.remember_recent(&a, Some("Имя")).unwrap();
        f.db.save_tabs(std::slice::from_ref(&a), Some(&a)).unwrap();
        f.db.save_tabs(&[], None).unwrap();
        assert_eq!(f.db.recent_repos().unwrap()[0].name, "Имя");
    }

    #[test]
    fn recent_repo_json_matches_1x() {
        let repo = RecentRepo { path: "p".into(), name: "n".into(), opened_at: None };
        assert_eq!(serde_json::to_string(&repo).unwrap(), r#"{"path":"p","name":"n","openedAt":null}"#);
    }
}
