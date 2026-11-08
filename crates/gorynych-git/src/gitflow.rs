//! Настройки git flow репозитория (`git flow init`). Перенос обработчика `repo:gitflow-config` из `electron/main.cjs`.
//!
//! ## Конспект
//! - `git config --get-regexp ^gitflow\.`; ошибка (ключей нет — git выходит с кодом 1) — пустой вывод.
//! - Строка обрезается (`trim`) и разбирается `/^gitflow\.(prefix\.(\w+)|branch\.(\w+))\s+(.*)$/`; любая подходящая строка ставит `configured`.
//! - `prefix.<имя>` → `prefixes[имя]`; `branch.develop` → `develop`; `branch.master` и `branch.main` → `master`. Значение обрезается.
//! - Повтор ключа: побеждает последняя строка, как присваивание в 1.x. Порядок `prefixes` — порядок первого появления, как у объекта JS
//!   (ключи-числа JS ставит первыми, но имена приписок не бывают числами).
//!
//! `\w` в JS — только ASCII, поэтому в шаблоне явный класс `[A-Za-z0-9_]`: у `regex` `\w` понимает Unicode.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::js;
use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;

use crate::run::git;

static LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^gitflow\.(prefix\.([A-Za-z0-9_]+)|branch\.([A-Za-z0-9_]+))\s+(.*)$").expect("корректный шаблон"));

/// Результат `repo:gitflow-config`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct GitflowConfig {
    pub prefixes: IndexMap<String, String>,
    pub develop: Option<String>,
    pub master: Option<String>,
    pub configured: bool,
}

/// Разбор вывода `git config --get-regexp ^gitflow\.`.
pub fn parse_gitflow_config(out: &str) -> GitflowConfig {
    let mut config = GitflowConfig::default();
    for line in out.split('\n') {
        let Some(caps) = LINE.captures(js::trim(line)) else { continue };
        config.configured = true;
        let value = js::trim(&caps[4]).to_owned();
        if let Some(name) = caps.get(2) {
            config.prefixes.insert(name.as_str().to_owned(), value);
        } else if let Some(name) = caps.get(3) {
            match name.as_str() {
                "develop" => config.develop = Some(value),
                "master" | "main" => config.master = Some(value),
                _ => {}
            }
        }
    }
    config
}

/// `repo:gitflow-config` для корня репозитория.
pub async fn gitflow_config(root: &Path) -> GitflowConfig {
    parse_gitflow_config(&git(root, &["config", "--get-regexp", r"^gitflow\."]).await.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_main_cjs() {
        let out = "gitflow.branch.master main\ngitflow.branch.develop develop\ngitflow.prefix.feature feature/\ngitflow.prefix.release release/ \n\
                   gitflow.prefix.versiontag \ngitflow.prefix.feature feat/\ngitflow.branch.main trunk\ngitflow.branch.other x\nother.key v\n";
        let config = parse_gitflow_config(out);
        assert!(config.configured);
        assert_eq!(config.develop.as_deref(), Some("develop"));
        assert_eq!(config.master.as_deref(), Some("trunk"), "последняя строка побеждает, main — тоже master");
        let prefixes: Vec<(&str, &str)> = config.prefixes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        // `versiontag` с пустым значением: после trim строки пробела нет и `\s+` не совпадает — строка пропускается, как в 1.x
        assert_eq!(prefixes, [("feature", "feat/"), ("release", "release/")]);
    }

    #[test]
    fn empty_and_unicode_names() {
        assert_eq!(parse_gitflow_config(""), GitflowConfig::default());
        let config = parse_gitflow_config("gitflow.prefix.фича x\n");
        assert!(!config.configured, "\\w в JS — только ASCII");
        let config = parse_gitflow_config("gitflow.branch.other x\n");
        assert!(config.configured, "неизвестная ветка тоже отмечает настройку");
        assert_eq!(config.master, None);
    }
}
