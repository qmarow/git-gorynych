//! `scan_staged` на настоящем git и контракт типов для интерфейса.

use std::fs;
use std::path::Path;
use std::process::Command;

use gorynych_ci_linter::guard::{GuardLevel, GuardParams, GuardRule, GuardScan, STAGED_DIFF_ARGS, scan_staged};
use gorynych_ci_linter::repo::RepoView;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use specta::Types;
use specta_typescript::Typescript;

/// Как `git()` из `electron/git.cjs`, но без личных настроек пользователя.
fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "core.autocrlf=false"])
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"])
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", dir.join("нет-такого-конфига"))
        .output()
        .unwrap()
}

fn run(dir: &Path, args: &[&str]) {
    let output = git(dir, args);
    assert!(output.status.success(), "{args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

struct RealRepo<'a>(&'a Path);

impl RepoView for RealRepo<'_> {
    fn staged_diff(&self) -> Result<String> {
        let output = git(self.0, &STAGED_DIFF_ARGS);
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        Err(GorynychError::new(ErrorCode::Git, "git").with_details(String::from_utf8_lossy(&output.stderr)))
    }

    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        unreachable!("Guard это не вызывает")
    }

    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        unreachable!("Guard это не вызывает")
    }
}

struct FailingRepo(&'static str);

impl RepoView for FailingRepo {
    fn staged_diff(&self) -> Result<String> {
        Err(GorynychError::new(ErrorCode::Git, "git").with_details(self.0))
    }

    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        unreachable!("Guard это не вызывает")
    }

    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        unreachable!("Guard это не вызывает")
    }
}

fn params() -> GuardParams {
    GuardParams {
        rules: vec![GuardRule {
            id: Some("q".to_owned()),
            pattern: "FORGOTTEN".to_owned(),
            level: Some("block".to_owned()),
            ..GuardRule::default()
        }],
        exclude: vec!["*.md".to_owned()],
    }
}

fn scan(dir: &Path) -> GuardScan {
    scan_staged(&RealRepo(dir), &params()).unwrap()
}

fn locations(scan: &GuardScan) -> Vec<(&str, u32)> {
    scan.findings.iter().map(|item| (item.file.as_str(), item.line)).collect()
}

#[test]
fn scans_staged_changes_of_a_real_repository() {
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path();
    run(dir, &["init", "-q"]);

    // Первый коммит: HEAD ещё нет
    fs::write(dir.join("a.txt"), "ok\nFORGOTTEN\n").unwrap();
    run(dir, &["add", "a.txt"]);
    let first = scan(dir);
    assert_eq!(locations(&first), [("a.txt", 2)]);
    assert!(first.blocked);
    assert_eq!(first.findings[0].level, GuardLevel::Block);
    run(dir, &["commit", "-qm", "1"]);
    assert_eq!(scan(dir).files, 0, "после коммита проверять нечего");

    // Правка посреди файла, кириллица и пробел в имени, исключённый файл, незастейдженное не считается
    fs::write(dir.join("a.txt"), "ok\nFORGOTTEN\nmore\nFORGOTTEN\n").unwrap();
    fs::write(dir.join("имя с пробелом.txt"), "FORGOTTEN\r\n").unwrap();
    fs::write(dir.join("note.md"), "FORGOTTEN\n").unwrap();
    fs::write(dir.join("unstaged.txt"), "FORGOTTEN\n").unwrap();
    run(dir, &["add", "a.txt", "имя с пробелом.txt", "note.md"]);
    let second = scan(dir);
    assert_eq!(locations(&second), [("a.txt", 4), ("имя с пробелом.txt", 1)]);
    assert_eq!((second.files, second.skipped_files, second.added_lines), (2, 1, 3));
    assert_eq!(second.findings[1].text, "FORGOTTEN");
    run(dir, &["commit", "-qm", "2"]);

    // Удаление и двоичный файл: находок нет. Переименование без правок: нечего проверять
    fs::remove_file(dir.join("a.txt")).unwrap();
    fs::write(dir.join("bin.dat"), b"FORGOTTEN\0\xFF").unwrap();
    run(dir, &["mv", "note.md", "renamed.txt"]);
    run(dir, &["add", "-A", "a.txt", "bin.dat"]);
    assert!(scan(dir).findings.is_empty());
}

#[test]
fn only_missing_head_errors_become_an_empty_diff() {
    for details in ["fatal: bad revision: Unknown Revision x", "fatal: ambiguous argument 'HEAD': unknown"] {
        let scan = scan_staged(&FailingRepo(details), &params()).unwrap();
        assert_eq!(scan.added_lines, 0);
    }
    let error = scan_staged(&FailingRepo("fatal: not a git repository"), &params()).unwrap_err();
    assert_eq!(error.code, ErrorCode::Git);

    // Настоящий git вне репозитория
    let outside = tempfile::tempdir().unwrap();
    assert!(scan_staged(&RealRepo(outside.path()), &params()).is_err());
}

#[test]
fn types_export_with_1x_field_names() {
    let types = Types::default().register::<GuardParams>().register::<GuardScan>();
    let ts = Typescript::default().export(&types, specta_serde::PhasesFormat).expect("типы экспортируются в TypeScript");
    for field in ["addedLines", "skippedFiles", "blocked", "invalid", "\"block\"", "exclude", "pattern"] {
        assert!(ts.contains(field), "нет «{field}» в:\n{ts}");
    }
}
