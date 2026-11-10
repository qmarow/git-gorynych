//! Просмотр всего файла (`FileDiffRequest::full_file`) и редактор файла рабочей копии (`worktree_file`) на настоящем git.

use std::fs;
use std::path::Path;
use std::process::Command;

use gorynych_core::error::ErrorCode;
use gorynych_git::diff::{FileDiffRequest, get_file_diff};
use gorynych_git::worktree_file::{WorktreeSave, read_worktree_file, save_worktree_file};

fn git(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Файл из 40 строк, в коммите; затем правка 20-й строки в рабочей копии.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "core.autocrlf", "false"]);
    let lines: Vec<String> = (1..=40).map(|n| format!("строка {n}")).collect();
    fs::write(root.join("a.txt"), lines.join("\n") + "\n").unwrap();
    git(root, &["add", "a.txt"]);
    git(root, &["commit", "-q", "-m", "первый"]);
    let edited: Vec<String> = (1..=40).map(|n| if n == 20 { "строка 20 правка".to_owned() } else { format!("строка {n}") }).collect();
    fs::write(root.join("a.txt"), edited.join("\n") + "\n").unwrap();
    dir
}

fn request(mode: &str, full_file: bool) -> FileDiffRequest {
    FileDiffRequest { mode: Some(mode.into()), path: Some("a.txt".into()), full_file, ..FileDiffRequest::default() }
}

#[tokio::test]
async fn full_file_shows_every_line_in_one_hunk() {
    let dir = repo();
    let root = dir.path();
    let part = get_file_diff(root, &request("unstaged", false)).await.unwrap();
    let full = get_file_diff(root, &request("unstaged", true)).await.unwrap();
    assert!(part.hunks[0].lines.len() < 10, "по умолчанию — только окрестность правки");
    assert_eq!(full.hunks.len(), 1);
    let lines = &full.hunks[0].lines;
    assert_eq!(lines.iter().filter(|l| l.t == " ").count(), 39);
    assert_eq!((lines.first().unwrap().n, lines.last().unwrap().n), (Some(1), Some(40)));
    assert_eq!((full.additions, full.deletions), (part.additions, part.deletions), "счётчики те же");

    // staged и коммит — так же
    git(root, &["add", "a.txt"]);
    let staged = get_file_diff(root, &request("staged", true)).await.unwrap();
    assert_eq!(staged.hunks[0].lines.len(), 41);
    git(root, &["commit", "-q", "-m", "второй"]);
    let head = git(root, &["rev-parse", "HEAD"]).trim().to_owned();
    let parent = git(root, &["rev-parse", "HEAD~1"]).trim().to_owned();
    let commit = FileDiffRequest { hash: Some(head), parent: Some(parent), ..request("commit", true) };
    assert_eq!(get_file_diff(root, &commit).await.unwrap().hunks[0].lines.len(), 41);
}

#[tokio::test]
async fn edit_round_trip_through_the_repository() {
    let dir = repo();
    let root = dir.path();
    let sub = root.join("папка");
    fs::create_dir(&sub).unwrap();
    // Путь — от корня репозитория, даже если dir — вложенная папка
    let file = read_worktree_file(&sub, "a.txt").await.unwrap();
    assert!(file.text.contains("строка 20 правка\n"));
    assert_eq!((file.eol.as_str(), file.bom, file.mixed_eol), ("\n", false, false));

    let text = file.text.replace("строка 1\n", "строка 1 из редактора\n");
    let saved = save_worktree_file(root, &WorktreeSave { path: "a.txt".into(), text, base_hash: file.hash.clone() }).await.unwrap();
    assert!(fs::read_to_string(root.join("a.txt")).unwrap().starts_with("строка 1 из редактора\n"));
    let diff = get_file_diff(root, &request("unstaged", false)).await.unwrap();
    assert_eq!((diff.additions, diff.deletions), (2, 2), "правка видна в diff");

    // Повторное сохранение со старым отпечатком отклоняется, с новым — проходит
    let stale = save_worktree_file(root, &WorktreeSave { path: "a.txt".into(), text: "x\n".into(), base_hash: file.hash }).await.unwrap_err();
    assert_eq!(stale.code, ErrorCode::ChangedOnDisk);
    save_worktree_file(root, &WorktreeSave { path: "a.txt".into(), text: "x\n".into(), base_hash: saved.hash }).await.unwrap();
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "x\n");

    assert_eq!(read_worktree_file(root, ".git/HEAD").await.unwrap_err().code, ErrorCode::BadArgs);
    assert_eq!(read_worktree_file(root, "../a.txt").await.unwrap_err().code, ErrorCode::BadArgs);
    assert_eq!(read_worktree_file(root, "нет.txt").await.unwrap_err().code, ErrorCode::NotFoundPath);
    fs::write(root.join("bin.dat"), b"\x00\x01").unwrap();
    assert_eq!(read_worktree_file(root, "bin.dat").await.unwrap_err().code, ErrorCode::Binary);
}

#[tokio::test]
async fn crlf_file_keeps_its_line_endings() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("win.txt"), "один\r\nдва\r\n").unwrap();
    let file = read_worktree_file(root, "win.txt").await.unwrap();
    assert_eq!((file.text.as_str(), file.eol.as_str()), ("один\nдва\n", "\r\n"));
    save_worktree_file(root, &WorktreeSave { path: "win.txt".into(), text: "один\nтри\n".into(), base_hash: file.hash }).await.unwrap();
    assert_eq!(fs::read(root.join("win.txt")).unwrap(), "один\r\nтри\r\n".as_bytes());
}
