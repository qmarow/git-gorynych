//! Дата коммита (`commitDate`, новое в 2.0) рядом с датой автора: после rebase и cherry-pick они расходятся, а граф упорядочен
//! по дате коммита (`--date-order`).

use std::path::Path;
use std::process::Command;

use gorynych_git::read::load_repository;

fn git(dir: &Path, args: &[&str], author_date: &str, commit_date: &str) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", dir.join("нет-такого-файла"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Тест")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Тест")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .env("GIT_AUTHOR_DATE", author_date)
        .env("GIT_COMMITTER_DATE", commit_date)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

#[tokio::test]
async fn commit_date_comes_from_committer_and_differs_from_author() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"], "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    std::fs::write(root.join("a.txt"), "1\n").unwrap();
    git(root, &["add", "a.txt"], "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    git(root, &["commit", "-q", "-m", "первый"], "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    std::fs::write(root.join("a.txt"), "2\n").unwrap();
    // Как после rebase: автор месяц назад, коммит — сейчас
    git(root, &["commit", "-q", "-am", "перенесённый"], "2024-02-01T00:00:00Z", "2024-03-01T12:00:00Z");

    let repo = load_repository(root, None).await.unwrap();
    let [top, first] = &repo.commits[..] else { panic!("два коммита: {:?}", repo.commits) };
    assert_eq!(top.message, "перенесённый");
    assert!(top.date.starts_with("2024-02-01"), "{}", top.date);
    assert!(top.commit_date.starts_with("2024-03-01T12:00:00"), "{}", top.commit_date);
    assert_eq!(first.commit_date, first.date);

    let json = serde_json::to_value(top).unwrap();
    assert!(json.get("commitDate").is_some(), "в JSON поле называется commitDate: {json}");
}
