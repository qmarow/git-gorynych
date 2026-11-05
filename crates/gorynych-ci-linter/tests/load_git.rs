//! `load_ci` на настоящем git, модель для проверки конфигурации и контракт типов для интерфейса.

use std::fs;
use std::path::Path;
use std::process::Command;

use gorynych_ci_linter::load::model::{CiLoad, CiSeverity};
use gorynych_ci_linter::load::{CI_LOG_ARGS, CI_STATUS_ARGS, CI_STATUS_UNTRACKED, load_ci};
use gorynych_ci_linter::repo::RepoView;
use gorynych_ci_linter::yaml::Value;
use gorynych_core::Language;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use specta::Types;
use specta_typescript::Typescript;

fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "core.autocrlf=false"])
        .args(["-c", "user.name=Автор", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"])
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

impl RealRepo<'_> {
    fn with_paths(&self, base: &[&str], paths: &[String]) -> Result<String> {
        let mut args: Vec<&str> = base.to_vec();
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
        let output = git(self.0, &args);
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        Err(GorynychError::new(ErrorCode::Git, "git"))
    }
}

impl RepoView for RealRepo<'_> {
    fn staged_diff(&self) -> Result<String> {
        unreachable!("загрузка это не вызывает")
    }

    fn ci_log(&self, paths: &[String]) -> Result<String> {
        self.with_paths(&CI_LOG_ARGS, paths)
    }

    fn ci_status(&self, paths: &[String]) -> Result<String> {
        let args: Vec<&str> = CI_STATUS_ARGS.iter().copied().chain([CI_STATUS_UNTRACKED]).collect();
        self.with_paths(&args, paths)
    }
}

fn current(load: &CiLoad) -> &gorynych_ci_linter::load::model::CiCurrent {
    load.current.as_ref().unwrap()
}

#[test]
fn history_and_dirty_cover_all_systems_and_includes() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path();
    run(repo, &["init", "-q"]);
    fs::write(repo.join(".gitlab-ci.yml"), "include: ci/подключён.yml\nj:\n  script: x\n").unwrap();
    fs::create_dir(repo.join("ci")).unwrap();
    fs::write(repo.join("ci/подключён.yml"), "k:\n  script: y\n").unwrap();
    fs::write(repo.join(".travis.yml"), "a: 1\n").unwrap();
    fs::write(repo.join("README.md"), "x\n").unwrap();
    run(repo, &["add", "."]);
    run(repo, &["commit", "-q", "-m", "первый коммит"]);
    fs::write(repo.join("README.md"), "y\n").unwrap();
    run(repo, &["add", "."]);
    run(repo, &["commit", "-q", "-m", "только README"]);
    fs::write(repo.join("ci/подключён.yml"), "k:\n  script: z\n").unwrap();
    fs::write(repo.join("README.md"), "z\n").unwrap();
    fs::create_dir_all(repo.join(".github/workflows")).unwrap();
    fs::write(repo.join(".github/workflows/новый.yml"), "jobs: {}\n").unwrap();

    let view = RealRepo(repo);
    let loaded = load_ci(repo, ".gitlab-ci.yml", Language::Ru, &view);
    let current = current(&loaded.load);

    assert_eq!(current.history.len(), 1, "коммит только с README не считается: {:?}", current.history);
    let commit = &current.history[0];
    assert_eq!((commit.message.as_str(), commit.author.as_str()), ("первый коммит", "Автор"));
    assert_eq!(commit.hash.len(), 40);
    assert!(commit.date.contains('T'), "{}", commit.date);

    let mut dirty: Vec<(&str, &str)> = current.dirty.iter().map(|file| (file.path.as_str(), file.status.as_str())).collect();
    dirty.sort_unstable();
    assert_eq!(dirty, [(".github/workflows/новый.yml", "??"), ("ci/подключён.yml", "M")]);

    assert_eq!(current.job_count, 2);
    let hash = current.config.files[0].hash.as_deref().unwrap();
    assert_eq!(hash.len(), 40);
    assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
    assert!(!current.config.files[0].draft);

    let model = loaded.gitlab.as_ref().expect("модель GitLab для проверки конфигурации");
    assert_eq!(model.jobs.keys().collect::<Vec<_>>(), ["k", "j"]);
    assert_eq!(model.includes.len(), 1);
    assert_eq!(model.resolve_job("j").unwrap().config.get("script"), Some(&Value::String("x".to_owned())));
    assert!(model.resolve_job("нет").is_none());
}

#[test]
fn repository_without_commits_has_empty_history() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path();
    run(repo, &["init", "-q"]);
    fs::write(repo.join(".gitlab-ci.yml"), "j:\n  script: x\n").unwrap();
    let view = RealRepo(repo);
    let loaded = load_ci(repo, "", Language::Ru, &view);
    let current = current(&loaded.load);
    assert!(current.history.is_empty());
    assert_eq!(current.dirty[0].status, "??");
}

#[test]
fn git_failure_does_not_break_loading() {
    struct Broken;
    impl RepoView for Broken {
        fn staged_diff(&self) -> Result<String> {
            unreachable!()
        }
        fn ci_log(&self, _paths: &[String]) -> Result<String> {
            Err(GorynychError::new(ErrorCode::Git, "git"))
        }
        fn ci_status(&self, _paths: &[String]) -> Result<String> {
            Err(GorynychError::new(ErrorCode::Git, "git"))
        }
    }
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join(".drone.yml"), "a: 1\n").unwrap();
    let loaded = load_ci(temp.path(), "", Language::Ru, &Broken);
    let current = current(&loaded.load);
    assert!(current.history.is_empty() && current.dirty.is_empty());
    assert_eq!(current.config.scheme_unsupported, Some(true));
    assert!(loaded.gitlab.is_none());
}

#[test]
fn yaml_error_is_reported_with_severity() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join(".gitlab-ci.yml"), "j:\n  script: \"незакрытая\n").unwrap();
    let loaded = load_ci(temp.path(), "", Language::Ru, &Broken2);
    let errors = &current(&loaded.load).config.errors;
    assert_eq!((errors.len(), errors[0].severity), (1, CiSeverity::Error));
    assert_eq!(errors[0].file, ".gitlab-ci.yml");
}

struct Broken2;
impl RepoView for Broken2 {
    fn staged_diff(&self) -> Result<String> {
        unreachable!()
    }
    fn ci_log(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }
    fn ci_status(&self, _paths: &[String]) -> Result<String> {
        Ok(String::new())
    }
}

#[test]
fn types_export_with_1x_field_names() {
    let types = Types::default().register::<CiLoad>();
    let ts = Typescript::default().export(&types, specta_serde::PhasesFormat).expect("типы экспортируются в TypeScript");
    for field in ["triggersTitle", "schemeUnsupported", "jobCount", "imageInherited", "runsOnLabels", "rulesEditable", "needsRaw", "usedBy", "beforeScript", "with", "type"] {
        assert!(ts.contains(field), "нет поля {field} в\n{ts}");
    }
    // `Value`: значение из файла, как есть
    assert!(ts.contains("Value") && ts.contains("null"), "{ts}");
}
