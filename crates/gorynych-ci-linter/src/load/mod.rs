//! Просмотр настроек CI/CD из самого репозитория: `loadCi` и `previewCi` из `electron/ci.cjs`. Только чтение, без сети и токенов.
//!
//! ## Конспект
//! - Файл: `requestedFile`, если он среди найденных, иначе первый файл первой системы. Система по файлу, иначе первая.
//! - Падение загрузчика становится одной ошибкой файла с пустым результатом и без `triggersTitle`.
//! - `previewCi`: черновики (путь нормализуется: `\` → `/`, срез `./` и `/`) вместо файлов, без истории и `dirty`. Отпечаток `hash` — всегда файла на
//!   диске, `draft` — есть ли черновик. Включения ищутся на диске, поэтому черновик файла, которого там нет, через `include` не подключится.
//! - История: `git log -n 50` по файлам всех систем и загруженным файлам; ошибка git — пустой список. `dirty`: `status --porcelain -z`, записи короче
//!   4 единиц пропускаются, статус пустой — `M`.
//! - Проверка конфигурации (`check`) переносится отдельно: [`CiLoaded::gitlab`] — то, что ей нужно от загрузчика GitLab.

mod actions;
mod common;
pub mod gitlab;
mod jenkins;
pub mod model;
mod pipelines;

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use gorynych_core::Language;
use gorynych_core::error::Result;
use gorynych_core::paths;
use sha1::{Digest, Sha1};

use self::common::{Ctx, norm_rel};
use self::gitlab::GitlabModel;
use self::model::*;
use crate::detect::detect_ci;
use crate::repo::RepoView;

const FIELD_SEPARATOR: char = '\u{1f}';

/// Формат `git log` для [`RepoView::ci_log`].
pub const CI_LOG_ARGS: [&str; 4] = ["log", "-n", "50", "--format=%H\u{1f}%s\u{1f}%an\u{1f}%aI"];
/// Аргументы `git status` для [`RepoView::ci_status`].
pub const CI_STATUS_ARGS: [&str; 3] = ["status", "--porcelain", "-z"];
/// Третий аргумент `git status`: все неотслеживаемые файлы.
pub const CI_STATUS_UNTRACKED: &str = "--untracked-files=all";

/// Результат `loadCi` и то, что нужно проверке конфигурации.
#[derive(Debug)]
pub struct CiLoaded {
    pub load: CiLoad,
    pub gitlab: Option<GitlabModel>,
}

/// Отпечаток файла на диске: `hash(readRaw(full))`. Файла нет — `None`.
pub(crate) fn disk_hash(root: &Path, rel: &str, language: Language) -> Result<Option<String>> {
    let full = paths::safe_relative(root, rel, language)?;
    let Ok(bytes) = fs::read(&full) else { return Ok(None) };
    let text = String::from_utf8_lossy(&bytes);
    let digest = Sha1::digest(text.as_bytes());
    Ok(Some(digest.iter().map(|byte| format!("{byte:02x}")).collect()))
}

fn run_loader(ctx: &Ctx<'_>, system: &str, file: &str) -> common::LoadResult<(CiConfig, Option<GitlabModel>)> {
    let plain = |config: CiConfig| (config, None);
    match system {
        "gitlab" => gitlab::load_gitlab(ctx, file).map(|(config, model)| (config, Some(model))),
        "github" | "gitea" | "forgejo" => actions::load_github(ctx, file).map(plain),
        "bitbucket" => pipelines::load_bitbucket(ctx, file).map(plain),
        "circleci" => pipelines::load_circle(ctx, file).map(plain),
        "azure" => pipelines::load_azure(ctx, file).map(plain),
        "jenkins" => jenkins::load_jenkins(ctx, file).map(plain),
        _ => pipelines::load_generic(ctx, file).map(plain),
    }
}

fn parse_history(output: &str) -> Vec<CiCommit> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FIELD_SEPARATOR).map(str::to_owned);
            let mut next = || fields.next().unwrap_or_default();
            CiCommit { hash: next(), message: next(), author: next(), date: next() }
        })
        .collect()
}

fn parse_dirty(output: &str) -> Vec<CiDirtyFile> {
    output
        .split('\0')
        .filter(|entry| gorynych_core::js::utf16_len(entry) > 3)
        .map(|entry| {
            let status: String = entry.chars().take(2).collect();
            let status = gorynych_core::js::trim(&status);
            CiDirtyFile {
                path: entry.chars().skip(3).collect(),
                status: if status.is_empty() { "M".to_owned() } else { status.to_owned() },
            }
        })
        .collect()
}

fn load(root: &Path, requested: &str, language: Language, drafts: Option<&HashMap<String, String>>, repo: Option<&dyn RepoView>) -> CiLoaded {
    let systems = detect_ci(root);
    let Some(system) = systems.iter().find(|system| system.files.iter().any(|file| file == requested)).or(systems.first()) else {
        return CiLoaded { load: CiLoad { systems, current: None }, gitlab: None };
    };
    let system = system.clone();
    let file = if system.files.iter().any(|file| file == requested) { requested.to_owned() } else { system.files[0].clone() };
    let ctx = Ctx { root, language, drafts };
    let (mut config, gitlab) = run_loader(&ctx, &system.id, &file).unwrap_or_else(|message| {
        let error = CiFileError { file: file.clone(), message, line: None, severity: CiSeverity::Error };
        (CiConfig { errors: vec![error], ..CiConfig::default() }, None)
    });

    let (history, dirty) = match repo {
        None => (Vec::new(), Vec::new()),
        Some(repo) => {
            let mut tracked: Vec<String> = Vec::new();
            for path in systems.iter().flat_map(|system| system.files.iter()).chain(config.files.iter().map(|file| &file.path)) {
                if !tracked.contains(path) {
                    tracked.push(path.clone());
                }
            }
            if tracked.is_empty() {
                (Vec::new(), Vec::new())
            } else {
                (parse_history(&repo.ci_log(&tracked).unwrap_or_default()), parse_dirty(&repo.ci_status(&tracked).unwrap_or_default()))
            }
        }
    };
    for item in &mut config.files {
        item.hash = disk_hash(root, &item.path, language).ok().flatten();
        item.draft = drafts.is_some_and(|drafts| drafts.contains_key(&norm_rel(&item.path)));
    }
    let job_count = config.pipelines.iter().flat_map(|pipeline| &pipeline.stages).map(|stage| stage.jobs.len()).sum::<usize>() as u32;
    let current = CiCurrent { system: system.id, title: system.title, file, job_count, config, history, dirty };
    CiLoaded { load: CiLoad { systems, current: Some(current) }, gitlab }
}

/// `loadCi`: разбор файла CI и подключённых к нему локальных файлов.
pub fn load_ci(root: &Path, requested: &str, language: Language, repo: &dyn RepoView) -> CiLoaded {
    load(root, requested, language, None, Some(repo))
}

/// `previewCi`: разбор с черновиками вместо файлов на диске, для живого предпросмотра.
pub fn preview_ci(root: &Path, requested: &str, language: Language, drafts: &HashMap<String, String>) -> CiLoaded {
    let normalized: HashMap<String, String> = drafts.iter().map(|(path, text)| (norm_rel(path), text.clone())).collect();
    load(root, requested, language, Some(&normalized), None)
}
