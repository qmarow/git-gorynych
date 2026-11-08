//! Проверка конфигурации CI/CD: собирает проблемы всех проверок в один список, `electron/ciCheck.cjs`.
//!
//! ## Конспект
//! - Проблема: `{id, severity, title, when, how, why, fix, file, line, job, scenario}`, повтор по `id|file|line|title` отбрасывается.
//! - Ошибки YAML — первыми (`yaml-syntax`). Маршрут по системе; исключение проверки — `check-failed` (info). Прочие системы: `loader-warning` из предупреждений загрузчика.
//! - Сортировка устойчивая: серьёзность, файл (`localeCompare`), строка.
//!
//! Код проверок — построчный перенос: `kp![…]` оставлен единообразным и там, где хватило бы массива.
#![allow(clippy::useless_vec)]

pub(crate) mod base;
mod github;
mod gitlab;
mod other;
mod scripts;
pub mod tags;

use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use gorynych_core::Language;
use gorynych_core::js;
use serde::Serialize;

use self::base::*;
use crate::load::gitlab::GitlabModel;
use crate::load::model::{CiConfig, CiSeverity};
use crate::repo::RepoView;

pub use self::gitlab::simulate::{CiScenario, CiScenarioExcluded, CiScenarioJob, CiScenarioRef};

/// Проблема.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiIssue {
    pub id: String,
    pub severity: CiSeverity,
    pub title: String,
    pub when: String,
    pub how: String,
    pub why: String,
    pub fix: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub job: Option<String>,
    pub scenario: Option<String>,
}

/// Счётчики по серьёзности.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, specta::Type)]
pub struct CiCheckStats {
    pub error: u32,
    pub warning: u32,
    pub info: u32,
}

/// Результат `checkCi`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiCheck {
    pub issues: Vec<CiIssue>,
    pub scenarios: Vec<CiScenario>,
    pub stats: CiCheckStats,
    pub default_branch: Option<String>,
    pub ms: u32,
}

/// То, что есть у всех проверок: `ctx` в 1.x.
pub(crate) struct CheckContext<'a> {
    pub pos: Positions,
    pub repo: RepoIndex<'a>,
    issues: Vec<CiIssue>,
    seen: HashSet<String>,
}

impl CheckContext<'_> {
    /// `add`: повтор отбрасывается.
    pub fn add(&mut self, draft: Draft) {
        let show = |value: Option<String>| value.unwrap_or_else(|| "null".to_owned());
        let key = format!("{}|{}|{}|{}", draft.id, show(draft.file.clone()), show(draft.line.map(|line| line.to_string())), draft.title);
        if !self.seen.insert(key) {
            return;
        }
        self.issues.push(CiIssue {
            id: draft.id.to_owned(),
            severity: draft.severity,
            title: draft.title,
            when: draft.when.unwrap_or_default(),
            how: draft.how,
            why: draft.why,
            fix: draft.fix,
            file: draft.file,
            line: draft.line,
            job: draft.job,
            scenario: draft.scenario,
        });
    }
}

const fn severity_rank(severity: CiSeverity) -> u8 {
    match severity {
        CiSeverity::Error => 0,
        CiSeverity::Warning => 1,
        CiSeverity::Info => 2,
    }
}

/// `branchSet`: ветки без имени remote.
fn branch_set(repo: &dyn RepoView) -> HashSet<String> {
    let output = repo.refs().unwrap_or_default();
    let mut set = HashSet::new();
    for line in output.split('\n') {
        let reference = js::trim(line);
        if reference.is_empty() || reference.ends_with("/HEAD") {
            continue;
        }
        if let Some(name) = reference.strip_prefix("refs/heads/") {
            set.insert(name.to_owned());
        } else if let Some(name) = reference.strip_prefix("refs/remotes/") {
            set.insert(name.split_once('/').map_or(name, |(_, rest)| rest).to_owned());
        }
    }
    set
}

/// `checkCi`.
pub fn check_ci(root: &Path, system: &str, config: &CiConfig, gitlab_model: Option<&GitlabModel>, repo: &dyn RepoView, language: Language) -> CiCheck {
    let _scope = LanguageScope::enter(language);
    let started = Instant::now();
    let mut cx = CheckContext { pos: Positions::new(&config.files), repo: RepoIndex::new(root, repo), issues: Vec::new(), seen: HashSet::new() };

    for error in &config.errors {
        let is_error = error.severity == CiSeverity::Error;
        let mut item = draft!(
            if is_error { "yaml-syntax" } else { "yaml-warning" },
            Warning,
            title = if is_error { tr!("Ошибка синтаксиса YAML: {0}", error.message) } else { error.message.clone() },
            when = tr!("Сразу при push — файл не читается"),
            how = if is_error { tr!("Сервер CI не сможет прочитать файл и не запустит ни одного задания.") } else { tr!("Файл прочитается, но, возможно, не так, как задумано.") },
            why = if is_error { tr!("Нарушена структура YAML: отступы, двоеточия, кавычки или табуляция вместо пробелов.") } else { tr!("Неоднозначная запись в YAML.") },
            fix = tr!("Проверьте отступы (только пробелы, одинаковое число на уровне) и кавычки вокруг строк с «: » или «#»."),
            file = error.file.clone(),
            line = error.line,
        );
        if is_error {
            item.severity = CiSeverity::Error;
        }
        cx.add(item);
    }

    let mut default_branch_name = None;
    let mut scenarios = Vec::new();
    let outcome = match system {
        "gitlab" => match gitlab_model {
            Some(model) => {
                let branch = default_branch(repo);
                default_branch_name = Some(branch.clone());
                gitlab::check_gitlab(config, model, &mut cx, branch, branch_set(repo)).map(|found| scenarios = found)
            }
            None => Ok(()),
        },
        "github" | "gitea" | "forgejo" => github::check_github(&config.files, &mut cx),
        "bitbucket" => other::check_bitbucket(&config.files, &mut cx),
        "jenkins" => other::check_jenkins(&config.files, &mut cx),
        "circleci" => other::check_circle(&config.files, &mut cx),
        "azure" => other::check_azure(&config.files, &mut cx),
        _ => Ok(()),
    };
    if let Err(message) = outcome {
        cx.add(draft!("check-failed", Info, title = tr!("Проверка прервалась"), when = "—".to_owned(), how = tr!("Часть проверок не выполнена."), why = message, fix = tr!("Сообщите об ошибке — проверка конфигурации не должна падать.")));
    }
    if !matches!(system, "gitlab" | "github" | "gitea" | "forgejo" | "bitbucket" | "jenkins") {
        for warning in &config.warnings {
            cx.add(draft!("loader-warning", Warning, title = warning.clone(), when = "—".to_owned(), how = tr!("Схема пайплайна может быть показана неполно."), why = warning.clone(), fix = tr!("Проверьте файл."), file = config.files.first().map(|file| file.path.clone())));
        }
    }

    let mut issues = cx.issues;
    issues.sort_by(|a, b| {
        let file = |issue: &CiIssue| issue.file.clone().unwrap_or_else(|| "null".to_owned());
        severity_rank(a.severity).cmp(&severity_rank(b.severity)).then_with(|| js::locale_cmp(&file(a), &file(b))).then_with(|| a.line.unwrap_or(0).cmp(&b.line.unwrap_or(0)))
    });
    let mut stats = CiCheckStats::default();
    for issue in &issues {
        match issue.severity {
            CiSeverity::Error => stats.error += 1,
            CiSeverity::Warning => stats.warning += 1,
            CiSeverity::Info => stats.info += 1,
        }
    }
    CiCheck { issues, scenarios, stats, default_branch: default_branch_name, ms: started.elapsed().as_millis() as u32 }
}
