//! Сверка конфигурации CI с живыми раннерами: `electron/cicd/tagCheck.cjs`. Задание, которое не возьмёт ни один раннер в сети, повиснет в очереди.
//!
//! ## Конспект
//! - `requirements`: GitLab — все задания, кроме `trigger`, без тегов — `untagged`; GitHub, Gitea, Forgejo — `runsOnLabels`, с `${{` пропускаются; Bitbucket — `runs-on`. Повтор `source|id` не считается.
//! - Группы по отсортированному набору меток в нижнем регистре. Живой раннер — `online` или `busy`.
//! - `runner-untagged`: нет живого раннера с `runUntagged !== false`. `runner-tags-missing`: нет живого раннера со всеми метками; `missing` — метки, которых нет ни у кого в сети. Три варианта `why`: есть, но не в сети;
//!   каждая метка есть, но не все у одного; метки нет ни у кого.

use gorynych_core::{Language, js};
use serde::Serialize;

use super::base::*;
use crate::load::model::{CiCurrent, CiSeverity};
use crate::yaml::PathItem;

/// Раннер для сверки.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RunnerInfo {
    pub name: String,
    pub status: String,
    pub labels: Vec<String>,
    /// `None` — не указано: как `runUntagged !== false`.
    pub run_untagged: Option<bool>,
}

/// Проблема сверки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiRunnerIssue {
    pub id: String,
    pub severity: CiSeverity,
    pub title: String,
    pub when: String,
    pub how: String,
    pub why: String,
    pub fix: String,
    pub file: String,
    pub line: Option<u32>,
    pub job: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<Vec<String>>,
}

struct Requirement {
    job: String,
    tags: Vec<String>,
    file: String,
    key_path: Option<Vec<PathItem>>,
    line: Option<u32>,
    untagged: bool,
    text: Option<&'static str>,
}

fn requirements(current: &CiCurrent) -> Vec<Requirement> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for pipeline in &current.config.pipelines {
        for stage in &pipeline.stages {
            for job in &stage.jobs {
                if !seen.insert(format!("{}|{}", job.source, job.id)) || job.kind == crate::load::model::CiJobKind::Trigger {
                    continue;
                }
                let labels = job.runs_on_labels.as_deref().unwrap_or_default();
                match current.system.as_str() {
                    "gitlab" => {
                        let tags = job.tags.clone().unwrap_or_default();
                        let untagged = tags.is_empty();
                        out.push(Requirement { job: job.name.clone(), tags, file: job.source.clone(), key_path: Some(kp![&job.name, "tags"]), line: job.line, untagged, text: None });
                    }
                    "github" | "gitea" | "forgejo" => {
                        if labels.is_empty() || labels.iter().any(|label| label.contains("${{")) {
                            continue;
                        }
                        let id = job.job_id.as_ref().unwrap_or(&job.id);
                        out.push(Requirement { job: job.name.clone(), tags: labels.to_vec(), file: job.source.clone(), key_path: Some(kp!["jobs", id, "runs-on"]), line: job.line, untagged: false, text: None });
                    }
                    "bitbucket" if !labels.is_empty() => {
                        out.push(Requirement { job: job.name.clone(), tags: labels.to_vec(), file: job.source.clone(), key_path: None, line: job.line, untagged: false, text: Some("runs-on") });
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

fn low(text: &str) -> String {
    js::trim(text).to_lowercase()
}

fn is_live(runner: &RunnerInfo) -> bool {
    matches!(runner.status.as_str(), "online" | "busy")
}

fn status_text(status: &str) -> String {
    match status {
        "online" => tr!("в сети"),
        "busy" => tr!("занят"),
        "offline" => tr!("не в сети"),
        "paused" => tr!("на паузе"),
        other => other.to_owned(),
    }
}

/// `checkRunnerTags`.
pub fn check_runner_tags(current: &CiCurrent, runners: &[RunnerInfo], language: Language) -> Vec<CiRunnerIssue> {
    let _scope = LanguageScope::enter(language);
    let pos = Positions::new(&current.config.files);
    let mut groups: indexmap::IndexMap<String, (Requirement, Vec<String>)> = indexmap::IndexMap::new();
    for requirement in requirements(current) {
        let key = if requirement.untagged {
            "\u{0}".to_owned()
        } else {
            let mut tags: Vec<String> = requirement.tags.iter().map(|tag| low(tag)).collect();
            tags.sort_by(|a, b| js::utf16_cmp(a, b));
            tags.join("|")
        };
        let job = requirement.job.clone();
        groups.entry(key).or_insert_with(|| (requirement, Vec::new())).1.push(job);
    }
    let mut issues = Vec::new();
    for (group, jobs) in groups.values() {
        let shown: Vec<String> = jobs.iter().take(4).map(q).collect();
        let jobs_text = format!("{}{}", shown.join(", "), if jobs.len() > 4 { tr!(" и ещё {0}", jobs.len() - 4) } else { String::new() });
        let line = group.key_path.as_ref().and_then(|path| pos.line(&group.file, path)).or_else(|| group.text.and_then(|text| pos.find(&group.file, text, 1))).or(group.line);
        if group.untagged {
            let any: Vec<&RunnerInfo> = runners.iter().filter(|runner| runner.run_untagged != Some(false)).collect();
            if any.iter().any(|runner| is_live(runner)) {
                continue;
            }
            let list: Vec<String> = any.iter().map(|runner| format!("{} ({})", runner.name, status_text(&runner.status))).collect();
            issues.push(CiRunnerIssue {
                id: "runner-untagged".to_owned(),
                severity: CiSeverity::Warning,
                title: if any.is_empty() { tr!("Нет раннера, который берёт задания без тегов") } else { tr!("Все раннеры для заданий без тегов не в сети или на паузе") },
                when: tr!("При запуске {0}", jobs_text),
                how: tr!("Задание повиснет в очереди (Pending): «This job is stuck because the project doesn’t have any runners online assigned to it»."),
                why: if any.is_empty() { tr!("У всех раннеров проекта выключено «Run untagged jobs».") } else { tr!("Подходят: {0}", list.join(", ")) },
                fix: tr!("Добавьте заданию tags: [<тег живого раннера>] или включите раннеру «Брать задания без тегов»."),
                file: group.file.clone(),
                line,
                job: jobs[0].clone(),
                source: "runners".to_owned(),
                tags: None,
                missing: None,
            });
            continue;
        }
        let need: Vec<String> = group.tags.iter().map(|tag| low(tag)).collect();
        let fit: Vec<&RunnerInfo> = runners.iter().filter(|runner| need.iter().all(|tag| runner.labels.iter().any(|label| low(label) == *tag))).collect();
        if fit.iter().any(|runner| is_live(runner)) {
            continue;
        }
        let live_labels: Vec<String> = runners.iter().filter(|runner| is_live(runner)).flat_map(|runner| runner.labels.iter().map(|label| low(label))).collect();
        let missing: Vec<String> = group.tags.iter().filter(|tag| !live_labels.contains(&low(tag))).cloned().collect();
        let quoted = |list: &[String]| list.iter().map(|tag| format!("\"{tag}\"")).collect::<Vec<_>>().join(", ");
        let what = match missing.as_slice() {
            [single] => tr!("тегом \"{0}\"", single),
            [] => tr!("набором тегов {0}", quoted(&group.tags)),
            several => tr!("тегами {0}", quoted(several)),
        };
        let why = if !fit.is_empty() {
            let list: Vec<String> = fit.iter().map(|runner| format!("{} — {}", runner.name, status_text(&runner.status))).collect();
            tr!("Раннеры с этими тегами есть, но {0}.", list.join(", "))
        } else if missing.is_empty() {
            tr!("Каждый тег есть у какого-то раннера в сети, но ни у одного — все сразу: задание берёт только раннер, у которого есть все перечисленные теги.")
        } else {
            tr!("Ни у одного раннера в сети нет {0}.", if missing.len() == 1 { tr!("этого тега") } else { tr!("этих тегов") })
        };
        issues.push(CiRunnerIssue {
            id: "runner-tags-missing".to_owned(),
            severity: CiSeverity::Warning,
            title: tr!("Нет активных раннеров с {0} — пайплайн зависнет в очереди (Pending)!", what),
            when: tr!("При запуске {0}", jobs_text),
            how: if current.system == "gitlab" { "GitLab: «This job is stuck because you don’t have any active runners online … with any of these tags assigned to them».".to_owned() } else { tr!("Задание будет ждать в статусе Queued, пока не появится подходящий раннер (до 24 часов), затем отменится.") },
            why,
            fix: if fit.is_empty() { tr!("Проверьте опечатки в тегах или подключите раннер с этими тегами (вкладка «Раннеры» → «Подключить раннер»).") } else { tr!("Запустите или снимите с паузы подходящий раннер (вкладка «Раннеры»).") },
            file: group.file.clone(),
            line,
            job: jobs[0].clone(),
            source: "runners".to_owned(),
            tags: Some(group.tags.clone()),
            missing: Some(missing),
        });
    }
    issues
}
