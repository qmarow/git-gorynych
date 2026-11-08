//! Слежение за репозиторием: изменения в `.git` (коммиты, ветки, stash, fetch) и в рабочих файлах. Перенос `electron/watch.cjs`.
//!
//! ## Конспект
//! - `classify`: объекты, lock-файлы, журналы и служебное в `.git` — шум, сами изменения видны по refs, HEAD и index. В рабочей папке пропускаются тяжёлые папки (`node_modules`, `target`, …) на любой глубине.
//! - Первое событие запускает таймер, и через `delay` приходит одно уведомление `{ git, worktree }`. Таймер не перезапускается: при непрерывных событиях уведомления всё равно идут.
//! - Рекурсивное слежение не удалось — следим хотя бы за корнем, `.git`, `refs/heads`, `refs/remotes` и папками remote.
//! - Остановка отменяет и ожидающее уведомление.
//!
//! ## Отличия от 1.x и плана
//! - Только `notify`, без `notify-debouncer-full`: он откладывает событие до затишья, а 1.x уведомляет через `delay` после первого события. Разделения на три наблюдателя из плана тоже нет: разбор один, как в 1.x, а `.git/index` входит в `git`.
//! - `notify` на Linux сообщает и о чтении файлов; такие события отброшены, иначе собственные запросы приложения вызывали бы обновление. Потеря событий (`need_rescan`) считается изменением и `.git`, и рабочей папки.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use gorynych_core::error::{GorynychError, Result};
use notify::event::{AccessKind, AccessMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

const IGNORED_DIRS: [&str; 13] = ["node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", "dist", "build", "out", "target", "bin", "obj"];

/// Что изменилось.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct RepoChanges {
    pub git: bool,
    pub worktree: bool,
}

/// К чему относится путь.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Git,
    Worktree,
}

/// `classify`. `None` — шум.
pub fn classify(rel: &str) -> Option<ChangeKind> {
    if rel.is_empty() {
        return Some(ChangeKind::Worktree);
    }
    let mut parts = rel.split(['\\', '/']);
    if parts.next() == Some(".git") {
        let sub = parts.next().unwrap_or_default();
        if sub.is_empty() || matches!(sub, "objects" | "lfs" | "fsmonitor--daemon" | "logs" | "COMMIT_EDITMSG" | "gk") || rel.ends_with(".lock") {
            return None;
        }
        return Some(ChangeKind::Git);
    }
    if rel.split(['\\', '/']).any(|part| IGNORED_DIRS.contains(&part)) {
        return None;
    }
    Some(ChangeKind::Worktree)
}

fn is_write(kind: EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

fn note(event: &Event, root: &Path, pending: &mut RepoChanges) {
    if event.need_rescan() {
        *pending = RepoChanges { git: true, worktree: true };
        return;
    }
    if !is_write(event.kind) {
        return;
    }
    let mut add = |rel: &str| match classify(rel) {
        Some(ChangeKind::Git) => pending.git = true,
        Some(ChangeKind::Worktree) => pending.worktree = true,
        None => {}
    };
    if event.paths.is_empty() {
        add("");
    }
    for path in &event.paths {
        // Путь вне корня: как событие без имени файла
        add(&path.strip_prefix(root).map_or_else(|_| String::new(), |rel| rel.to_string_lossy().into_owned()));
    }
}

fn fallback_dirs(root: &Path) -> Vec<PathBuf> {
    let remotes = root.join(".git").join("refs").join("remotes");
    let mut dirs = vec![root.to_path_buf(), root.join(".git"), root.join(".git").join("refs").join("heads"), remotes.clone()];
    if let Ok(entries) = std::fs::read_dir(&remotes) {
        dirs.extend(entries.flatten().filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir())).map(|entry| entry.path()));
    }
    dirs
}

/// Наблюдение за репозиторием. `Drop` останавливает его и отменяет ожидающее уведомление.
pub struct RepoWatch {
    _watcher: RecommendedWatcher,
}

/// `watchRepository`: `on_change` вызывается не чаще, чем раз в `delay`, из отдельного потока.
pub fn watch_repository(root: &Path, delay: Duration, on_change: impl Fn(RepoChanges) + Send + 'static) -> Result<RepoWatch> {
    let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |event| {
        // Поток уже завершён: наблюдение останавливается
        let _ = sender.send(event);
    })
    .map_err(GorynychError::unknown)?;
    if watcher.watch(root, RecursiveMode::Recursive).is_err() {
        // Запасной вариант: папки может не быть
        for dir in fallback_dirs(root) {
            let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
        }
    }
    let root = root.to_path_buf();
    std::thread::Builder::new()
        .name("gorynych-watch".to_owned())
        .spawn(move || {
            let mut pending = RepoChanges::default();
            let mut deadline: Option<Instant> = None;
            loop {
                let next = match deadline {
                    Some(at) => receiver.recv_timeout(at.saturating_duration_since(Instant::now())),
                    None => receiver.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                };
                match next {
                    // Ошибки наблюдателя не показываем: как `w.on('error', () => {})`
                    Ok(event) => {
                        if let Ok(event) = event {
                            note(&event, &root, &mut pending);
                        }
                        if (pending.git || pending.worktree) && deadline.is_none() {
                            deadline = Some(Instant::now() + delay);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        deadline = None;
                        on_change(std::mem::take(&mut pending));
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .map_err(GorynychError::unknown)?;
    Ok(RepoWatch { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_for(receiver: &mpsc::Receiver<RepoChanges>) -> Option<RepoChanges> {
        receiver.recv_timeout(Duration::from_secs(10)).ok()
    }

    fn drain(receiver: &mpsc::Receiver<RepoChanges>) {
        while receiver.recv_timeout(Duration::from_millis(400)).is_ok() {}
    }

    #[test]
    fn real_events_are_classified_and_grouped() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce_free(dir.path());
        std::fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects/ab")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(root.join("папка")).unwrap();

        let (sender, receiver) = mpsc::channel();
        let watch = watch_repository(&root, Duration::from_millis(100), move |what| sender.send(what).unwrap()).unwrap();
        // На Windows и Linux слежение начинается сразу, но создание папок выше может ещё прийти событием
        drain(&receiver);

        std::fs::write(root.join("папка/файл.txt"), b"1").unwrap();
        std::fs::write(root.join("второй.txt"), b"2").unwrap();
        assert_eq!(wait_for(&receiver), Some(RepoChanges { git: false, worktree: true }), "пачка событий — одно уведомление");
        drain(&receiver);

        std::fs::write(root.join(".git/refs/heads/main"), b"x").unwrap();
        assert_eq!(wait_for(&receiver), Some(RepoChanges { git: true, worktree: false }));
        drain(&receiver);

        std::fs::write(root.join(".git/objects/ab/cd"), b"x").unwrap();
        std::fs::write(root.join("node_modules/x/y.js"), b"x").unwrap();
        std::fs::write(root.join(".git/index.lock"), b"x").unwrap();
        assert_eq!(receiver.recv_timeout(Duration::from_millis(600)).ok(), None, "шум не вызывает уведомлений");

        // Остановка отменяет ожидающее уведомление
        std::fs::write(root.join("третий.txt"), b"3").unwrap();
        drop(watch);
        assert_eq!(receiver.recv_timeout(Duration::from_millis(400)).ok(), None);
    }

    /// `tempdir` на Windows может вернуть короткое имя (8.3): оно не совпало бы с путями событий.
    fn dunce_free(path: &Path) -> PathBuf {
        let full = path.canonicalize().unwrap();
        full.to_str().and_then(|text| text.strip_prefix(r"\\?\")).map_or(full.clone(), PathBuf::from)
    }

    #[test]
    fn reads_are_not_changes() {
        assert!(!is_write(EventKind::Access(AccessKind::Open(AccessMode::Any))));
        assert!(!is_write(EventKind::Access(AccessKind::Close(AccessMode::Read))));
        assert!(is_write(EventKind::Access(AccessKind::Close(AccessMode::Write))));
        assert!(is_write(EventKind::Any));
    }
}
