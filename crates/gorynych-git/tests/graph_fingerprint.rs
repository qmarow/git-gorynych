//! `read::graph_fingerprint` и `read::load_repository_since` на настоящем git: что меняет отпечаток графа, а что нет,
//! и что пропуск `git log` не меняет остальной ответ.

use std::path::Path;
use std::process::Command;

use gorynych_git::read::{graph_fingerprint, load_repository, load_repository_since, locate_repo};

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", dir.join("нет-такого-файла"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Тест")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Тест")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

async fn fingerprint(dir: &Path) -> String {
    let location = locate_repo(dir).await.unwrap();
    graph_fingerprint(&location.git_dir, 2000).unwrap()
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    std::fs::write(dir.path().join("a.txt"), "1\n").unwrap();
    git(dir.path(), &["add", "a.txt"]);
    git(dir.path(), &["commit", "-q", "-m", "первый"]);
    dir
}

#[tokio::test]
async fn fingerprint_follows_refs_only() {
    let dir = repo();
    let root = dir.path();
    let start = fingerprint(root).await;
    assert_eq!(start, fingerprint(root).await, "повторное чтение");

    // Рабочая копия, индекс и stash на список коммитов не влияют
    std::fs::write(root.join("a.txt"), "2\n").unwrap();
    git(root, &["add", "a.txt"]);
    assert_eq!(start, fingerprint(root).await, "индекс");
    git(root, &["stash", "-q"]);
    assert_eq!(start, fingerprint(root).await, "stash");

    let mut seen = vec![start];
    let mut changed = |label: &str, value: String| {
        assert!(!seen.contains(&value), "{label}: отпечаток не изменился");
        seen.push(value);
    };
    git(root, &["branch", "dev"]);
    changed("ветка", fingerprint(root).await);
    git(root, &["tag", "v1"]);
    changed("тег", fingerprint(root).await);
    git(root, &["checkout", "-q", "dev"]);
    changed("HEAD", fingerprint(root).await);
    git(root, &["commit", "-q", "--allow-empty", "-m", "второй"]);
    changed("коммит", fingerprint(root).await);
    git(root, &["pack-refs", "--all"]);
    changed("packed-refs", fingerprint(root).await);
    git(root, &["update-ref", "refs/remotes/origin/main", "main"]);
    changed("удалённая ветка", fingerprint(root).await);
    git(root, &["checkout", "-q", "--detach"]);
    changed("отсоединённый HEAD", fingerprint(root).await);
}

#[tokio::test]
async fn worktree_has_its_own_head_and_shared_refs() {
    let dir = repo();
    let main = dir.path();
    let other = tempfile::tempdir().unwrap();
    let wt = other.path().join("wt");
    git(main, &["worktree", "add", "-q", "-b", "side", wt.to_str().unwrap()]);
    let (main_print, wt_print) = (fingerprint(main).await, fingerprint(&wt).await);
    assert_ne!(main_print, wt_print, "у worktree другой HEAD");

    git(main, &["branch", "extra"]);
    assert_ne!(wt_print, fingerprint(&wt).await, "ветка из основной копии видна в worktree");
}

#[tokio::test]
async fn known_fingerprint_skips_log_and_keeps_the_rest() {
    let dir = repo();
    let root = dir.path();
    let first = load_repository_since(root, None, None).await.unwrap();
    assert!(!first.commits_unchanged);
    assert_eq!(first.repository.commits.len(), 1);
    let known = first.fingerprint.clone().unwrap();

    // Изменения, которые граф не трогают: файлы, stash
    std::fs::write(root.join("a.txt"), "2\n").unwrap();
    git(root, &["stash", "-q"]);
    std::fs::write(root.join("b.txt"), "новый\n").unwrap();
    let skipped = load_repository_since(root, None, Some(&known)).await.unwrap();
    assert!(skipped.commits_unchanged);
    assert!(skipped.repository.commits.is_empty());
    assert_eq!(skipped.fingerprint.as_deref(), Some(known.as_str()));
    let full = load_repository(root, None).await.unwrap();
    assert_eq!(skipped.repository.stashes, full.stashes);
    assert_eq!(skipped.repository.wip_files, full.wip_files);
    assert_eq!(skipped.repository.local_branches, full.local_branches);
    assert_eq!(skipped.repository.head_hash, full.head_hash);
    assert_eq!(skipped.repository, gorynych_git::read::Repository { commits: Vec::new(), truncated: false, ..full.clone() });

    // Новый коммит — граф перечитывается целиком
    git(root, &["add", "b.txt"]);
    git(root, &["commit", "-q", "-m", "второй"]);
    let reread = load_repository_since(root, None, Some(&known)).await.unwrap();
    assert!(!reread.commits_unchanged);
    assert_eq!(reread.repository.commits.len(), 2);
    assert_ne!(reread.fingerprint.as_deref(), Some(known.as_str()));

    // Чужой предел — другой отпечаток
    let limited = load_repository_since(root, Some(1), reread.fingerprint.as_deref()).await.unwrap();
    assert!(!limited.commits_unchanged);
    assert_eq!(limited.repository.commits.len(), 1);
}

#[tokio::test]
async fn empty_repository() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    let first = load_repository_since(dir.path(), None, None).await.unwrap();
    assert!(first.repository.commits.is_empty());
    let again = load_repository_since(dir.path(), None, first.fingerprint.as_deref()).await.unwrap();
    assert!(again.commits_unchanged);
}
