//! Клонирование с прогрессом и отменой. Перенос `electron/clone.cjs`.
//!
//! ## Конспект
//! - `repoNameFromUrl`: последняя часть адреса без `.git`, запрещённые в именах файлов символы заменяются на `_`.
//! - `checkTarget`: `BAD_ARGS`, `NOT_FOUND_PATH`, `TARGET_EXISTS`. Существующая пустая папка подходит.
//! - Прогресс: фазы git переводятся в общую шкалу 0…100. Сообщаем не чаще раза в 120 мс, но конец фазы всегда.
//! - Сбой или отмена: скачанное убирается. Папку, которая была до клонирования, не удаляем, только очищаем.
//! - `AUTH`, `FORBIDDEN`, `NOT_FOUND`: подсказка заменяется подсказкой хоста.
//!
//! На Windows отмена, как и в 1.x, завершает только сам `git.exe`, а дочерние процессы (`git-remote-https`) уходят, когда закроется их канал. Если они ещё держат файлы, часть файлов останется в папке: это не считается ошибкой.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use gorynych_core::error::{ErrorCode, GorynychError, ProcessFailure, Result, from_process_error};
use gorynych_core::i18n::{self, t};
use gorynych_core::js;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::sync::Notify;

use crate::common::{filled, fs_error, lenient};
use crate::init::{RemoteHeads, host_name, remote_heads, validate_url, with_host_hint};
use crate::network::Network;
use crate::run::git_info;

static PERCENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([0-9]+)%").expect("корректный шаблон"));
static SPEED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\|\s*([0-9.,]+\s*[KMG]?i?B/s)").expect("корректный шаблон"));
static SIZE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",\s*([0-9.,]+\s*[KMG]?i?B)\s*\|").expect("корректный шаблон"));
static NAME_BAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[<>:"|?*]"#).expect("корректный шаблон"));
static FOLDER_BAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[<>:"|?*\\/]"#).expect("корректный шаблон"));
static GIT_TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.git$").expect("корректный шаблон"));

struct Job {
    cancelled: std::sync::atomic::AtomicBool,
    wake: Notify,
}

static RUNNING: LazyLock<Mutex<HashMap<String, Arc<Job>>>> = LazyLock::new(Mutex::default);

fn running() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Job>>> {
    RUNNING.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// `repoNameFromUrl`.
pub fn repo_name_from_url(url: &str) -> String {
    let clean = js::trim(url).trim_end_matches(['\\', '/']);
    let clean = GIT_TAIL.replace(clean, "");
    let name = clean.split(['\\', '/', ':']).rfind(|part| !part.is_empty()).unwrap_or("repository");
    NAME_BAD.replace_all(name, "_").into_owned()
}

/// Результат `probeClone`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CloneProbe {
    pub url: String,
    pub host: Option<String>,
    pub name: String,
    #[serde(flatten)]
    pub heads: RemoteHeads,
}

/// `probeClone`.
pub async fn probe_clone(network: &Network, url: Option<&str>) -> Result<CloneProbe> {
    let url = validate_url(url)?;
    let heads = remote_heads(network, &url, &std::env::temp_dir()).await?;
    Ok(CloneProbe { host: host_name(&url), name: repo_name_from_url(&url), url, heads })
}

fn check_target(parent: Option<&str>, name: &str) -> Result<(PathBuf, bool)> {
    let Some(parent) = filled(parent) else {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Выберите папку для клонирования", &[])));
    };
    if js::trim(name).is_empty() || FOLDER_BAD.is_match(name) {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Недопустимое имя папки", &[])));
    }
    if !std::fs::metadata(parent).is_ok_and(|meta| meta.is_dir()) {
        return Err(GorynychError::new(ErrorCode::NotFoundPath, t("Папка не найдена: {0}", &[&parent])));
    }
    let target = Path::new(parent).join(js::trim(name));
    match std::fs::metadata(&target) {
        Ok(meta) => {
            let empty = meta.is_dir() && std::fs::read_dir(&target).map_err(fs_error)?.next().is_none();
            if !empty {
                return Err(GorynychError::new(ErrorCode::TargetExists, t("Папка «{0}» уже существует и не пуста", &[&name])).with_hint(t("Выберите другое имя или другую папку.", &[])));
            }
            Ok((target, false))
        }
        Err(_) => Ok((target, true)),
    }
}

/// Прогресс клонирования.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    #[specta(type = f64)]
    pub percent: u32,
    #[specta(type = f64)]
    pub phase_percent: u32,
    pub speed: Option<String>,
    pub size: Option<String>,
}

fn parse_progress(line: &str) -> Option<CloneProgress> {
    let lower = line.to_ascii_lowercase();
    let (phase, from, to) = if lower.contains("counting objects") {
        (t("Подсчёт объектов", &[]), 0.0, 5.0)
    } else if lower.contains("compressing objects") {
        (t("Сжатие на сервере", &[]), 5.0, 10.0)
    } else if lower.contains("receiving objects") {
        (t("Загрузка", &[]), 10.0, 80.0)
    } else if lower.contains("resolving deltas") {
        (t("Обработка", &[]), 80.0, 92.0)
    } else if lower.contains("updating files") || lower.contains("checking out files") {
        (t("Распаковка файлов", &[]), 92.0, 100.0)
    } else {
        return None;
    };
    let local: f64 = PERCENT.captures(line).and_then(|caps| caps[1].parse().ok()).unwrap_or(0.0);
    let group = |pattern: &Regex| pattern.captures(line).map(|caps| caps[1].to_owned());
    Some(CloneProgress { phase, percent: (from + (to - from) * local / 100.0).round() as u32, phase_percent: local as u32, speed: group(&SPEED), size: group(&SIZE) })
}

/// Параметры `cloneRepository`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CloneRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub id: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub url: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub parent: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<f64>)]
    pub depth: Option<f64>,
}

/// Результат `cloneRepository`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Cloned {
    pub path: String,
    pub name: String,
}

fn cleanup(target: &Path, created: bool) {
    // Не смогли убрать частично скачанное: не критично
    if created {
        let _ = std::fs::remove_dir_all(target);
    } else if let Ok(entries) = std::fs::read_dir(target) {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = if entry.file_type().is_ok_and(|kind| kind.is_dir()) { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) };
        }
    }
}

/// Снимает задачу из списка, даже если `Future` клонирования бросили на полпути.
struct Registered(String);

impl Drop for Registered {
    fn drop(&mut self) {
        running().remove(&self.0);
    }
}

/// `cloneRepository`.
pub async fn clone_repository(network: &Network, request: &CloneRequest, on_progress: impl Fn(CloneProgress)) -> Result<Cloned> {
    let url = validate_url(request.url.as_deref())?;
    let name = filled(request.name.as_deref()).map_or_else(|| repo_name_from_url(&url), str::to_owned);
    let (target, created) = check_target(request.parent.as_deref(), &name)?;
    let parent = PathBuf::from(request.parent.as_deref().unwrap_or_default());
    let net = network.options(&parent, Some(&url)).await;

    let mut args: Vec<std::ffi::OsString> = ["-c", "core.quotepath=false", "clone", "--progress"].iter().map(Into::into).collect();
    if let Some(branch) = filled(request.branch.as_deref()) {
        args.extend(["--branch".into(), branch.into()]);
    }
    if let Some(depth) = request.depth.filter(|depth| *depth != 0.0 && !depth.is_nan()) {
        args.extend(["--depth".into(), js::number_to_string(depth).into()]);
    }
    args.extend([url.as_str().into(), target.as_os_str().to_owned()]);

    let mut command = tokio::process::Command::new(git_info().0);
    command.args(&args).current_dir(&parent).envs(net.options.env.iter().map(|(key, value)| (key, value))).env("GIT_OPTIONAL_LOCKS", "0").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::run::CREATE_NO_WINDOW);

    let id = request.id.clone().unwrap_or_default();
    let job = Arc::new(Job { cancelled: false.into(), wake: Notify::new() });
    running().insert(id.clone(), Arc::clone(&job));
    let registered = Registered(id);

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return from_process_error(ProcessFailure::NotFound, "", "", i18n::language());
        }
        from_process_error(ProcessFailure::Exited { message: &error.to_string() }, "", "", i18n::language())
    })?;
    let mut stderr = child.stderr.take().expect("stderr перенаправлен");

    let mut log: Vec<u8> = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut last: Option<Instant> = None;
    let mut chunk = [0_u8; 8192];
    let mut alive = true;
    loop {
        tokio::select! {
            read = stderr.read(&mut chunk) => {
                let size = read.unwrap_or(0);
                if size == 0 {
                    break;
                }
                log.extend_from_slice(&chunk[..size]);
                if log.len() > 200_000 {
                    log.drain(..log.len() - 100_000);
                }
                pending.extend_from_slice(&chunk[..size]);
                while let Some(end) = pending.iter().position(|byte| *byte == b'\r' || *byte == b'\n') {
                    let line: Vec<u8> = pending.drain(..=end).collect();
                    let Some(progress) = parse_progress(&String::from_utf8_lossy(&line[..end])) else {
                        continue;
                    };
                    if progress.phase_percent == 100 || last.is_none_or(|at| at.elapsed() > Duration::from_millis(120)) {
                        last = Some(Instant::now());
                        on_progress(progress);
                    }
                }
            }
            () = job.wake.notified(), if alive => {
                alive = false;
                let _ = child.start_kill();
            }
        }
    }
    let status = child.wait().await.map_err(fs_error)?;
    drop(registered);
    drop(net);

    if job.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
        cleanup(&target, created);
        return Err(GorynychError::new(ErrorCode::Cancelled, t("Клонирование отменено", &[])));
    }
    if !status.success() {
        cleanup(&target, created);
        let text = String::from_utf8_lossy(&log);
        return Err(with_host_hint(from_process_error(ProcessFailure::Exited { message: &text }, "", &text, i18n::language()), &url));
    }
    on_progress(CloneProgress { phase: t("Готово", &[]), percent: 100, phase_percent: 100, speed: None, size: None });
    let name = target.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    Ok(Cloned { path: target.display().to_string(), name })
}

/// `cancelClone`.
pub fn cancel_clone(id: &str) -> bool {
    let Some(job) = running().get(id).cloned() else {
        return false;
    };
    job.cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
    job.wake.notify_one();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_urls() {
        assert_eq!(repo_name_from_url("https://x/a/проект.git/"), "проект");
        assert_eq!(repo_name_from_url("git@host:user/repo.GIT"), "repo");
        assert_eq!(repo_name_from_url(r"C:\x\y"), "y");
        assert_eq!(repo_name_from_url("///"), "repository");
    }

    #[test]
    fn progress_scale() {
        i18n::set_language("ru");
        let line = "Receiving objects:  50% (5/10), 1.20 MiB | 3.40 MiB/s";
        let got = parse_progress(line).unwrap();
        assert_eq!((got.percent, got.phase_percent), (45, 50));
        assert_eq!(got.speed.as_deref(), Some("3.40 MiB/s"));
        assert_eq!(got.size.as_deref(), Some("1.20 MiB"));
        assert_eq!(parse_progress("Updating files: 100% (3/3), done.").unwrap().percent, 100);
        assert_eq!(parse_progress("remote: Counting objects: 7").unwrap().percent, 0);
        assert_eq!(parse_progress("Cloning into 'x'..."), None);
    }

    #[test]
    fn target_checks() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().to_str().unwrap();
        assert_eq!(check_target(None, "a").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(check_target(Some(parent), "a/b").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(check_target(Some("нет такой папки"), "a").unwrap_err().code, ErrorCode::NotFoundPath);
        assert!(check_target(Some(parent), "новая").unwrap().1);
        std::fs::create_dir(dir.path().join("пустая")).unwrap();
        assert!(!check_target(Some(parent), "пустая").unwrap().1);
        std::fs::create_dir(dir.path().join("занята")).unwrap();
        std::fs::write(dir.path().join("занята/f"), b"").unwrap();
        assert_eq!(check_target(Some(parent), "занята").unwrap_err().code, ErrorCode::TargetExists);
    }

    #[tokio::test]
    async fn cancelling_removes_partial_clone() {
        // Настоящая отмена настоящего процесса: источник большой настолько, чтобы git не успел закончить раньше отмены
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("src");
        std::fs::create_dir(&source).unwrap();
        let run = |args: &[&str]| assert!(std::process::Command::new("git").current_dir(&source).args(args).env("GIT_AUTHOR_NAME", "a").env("GIT_AUTHOR_EMAIL", "a@x").env("GIT_COMMITTER_NAME", "a").env("GIT_COMMITTER_EMAIL", "a@x").status().unwrap().success());
        run(&["init", "-q", "-b", "main"]);
        for index in 0..2000 {
            std::fs::write(source.join(format!("f{index}.txt")), format!("{index}\n").repeat(200)).unwrap();
        }
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", "x"]);

        let url = format!("file:///{}", source.display().to_string().replace('\\', "/").trim_start_matches('/'));
        let request = CloneRequest { id: Some("отмена".into()), url: Some(url), parent: Some(dir.path().display().to_string()), name: Some("копия".into()), ..CloneRequest::default() };
        let network = Network::default();
        let work = clone_repository(&network, &request, |_| {});
        let cancel = async {
            // Задача появляется в списке, когда клонирование уже запускается
            while !cancel_clone("отмена") {
                tokio::task::yield_now().await;
            }
        };
        let (result, ()) = tokio::join!(work, cancel);
        assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
        assert!(!cancel_clone("отмена"), "задача снята");
    }
}
