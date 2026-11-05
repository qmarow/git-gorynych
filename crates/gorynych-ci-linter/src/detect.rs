//! Какие системы CI есть в репозитории: `SYSTEMS` и `detectCi` из `electron/ci.cjs`.
//!
//! ## Конспект
//! Порядок систем значим: при загрузке берётся первая. Точные файлы идут раньше файлов из папки; файлы папки — по `sort()` (единицы UTF-16),
//! расширение `/\.ya?ml$/i`, только настоящие файлы (ссылка на файл считается). Система без файлов не показывается. Только файловая система.

use std::fs;
use std::path::Path;

use gorynych_core::js;
use serde::Serialize;

struct System {
    id: &'static str,
    title: &'static str,
    files: &'static [&'static str],
    dir: Option<&'static str>,
}

const SYSTEMS: [System; 11] = [
    System { id: "gitlab", title: "GitLab CI", files: &[".gitlab-ci.yml", ".gitlab-ci.yaml"], dir: None },
    System { id: "github", title: "GitHub Actions", files: &[], dir: Some(".github/workflows") },
    System { id: "gitea", title: "Gitea Actions", files: &[], dir: Some(".gitea/workflows") },
    System { id: "forgejo", title: "Forgejo Actions", files: &[], dir: Some(".forgejo/workflows") },
    System { id: "jenkins", title: "Jenkins", files: &["Jenkinsfile"], dir: None },
    System { id: "bitbucket", title: "Bitbucket Pipelines", files: &["bitbucket-pipelines.yml"], dir: None },
    System { id: "circleci", title: "CircleCI", files: &[".circleci/config.yml", ".circleci/config.yaml"], dir: None },
    System { id: "azure", title: "Azure Pipelines", files: &["azure-pipelines.yml", "azure-pipelines.yaml"], dir: None },
    System { id: "travis", title: "Travis CI", files: &[".travis.yml"], dir: None },
    System { id: "drone", title: "Drone CI", files: &[".drone.yml"], dir: None },
    System { id: "woodpecker", title: "Woodpecker CI", files: &[".woodpecker.yml"], dir: Some(".woodpecker") },
];

/// Найденная система CI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiSystem {
    pub id: String,
    pub title: String,
    pub files: Vec<String>,
}

pub(crate) fn is_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// Как `path.join(root, rel)`: `rel` дописывается к корню, даже если похож на абсолютный путь.
pub(crate) fn join(root: &Path, rel: &str) -> std::path::PathBuf {
    let mut joined = root.as_os_str().to_owned();
    joined.push("/");
    joined.push(rel);
    joined.into()
}

fn is_yaml_name(name: &str) -> bool {
    let lower = name.as_bytes();
    let ends_with = |suffix: &[u8]| lower.len() >= suffix.len() && lower[lower.len() - suffix.len()..].eq_ignore_ascii_case(suffix);
    ends_with(b".yml") || ends_with(b".yaml")
}

/// Имена в папке по `sort()`; папки нет — пусто.
pub(crate) fn sorted_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    names.sort_by(|a, b| js::utf16_cmp(a, b));
    names
}

/// `detectCi`.
pub fn detect_ci(root: &Path) -> Vec<CiSystem> {
    let mut systems = Vec::new();
    for system in &SYSTEMS {
        let mut files: Vec<String> = system.files.iter().filter(|rel| is_file(&join(root, rel))).map(|rel| (*rel).to_owned()).collect();
        if let Some(dir) = system.dir {
            for name in sorted_names(&join(root, dir)) {
                let rel = format!("{dir}/{name}");
                if is_yaml_name(&name) && is_file(&join(root, &rel)) {
                    files.push(rel);
                }
            }
        }
        if !files.is_empty() {
            systems.push(CiSystem { id: system.id.to_owned(), title: system.title.to_owned(), files });
        }
    }
    systems
}
