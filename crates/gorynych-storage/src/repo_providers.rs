//! Таблица `repo_providers`: провайдер CI/CD и адрес API. Перенос `electron/cicd/settings.cjs`.
//!
//! # Конспект исходника
//! - Ключ: `host/path` в нижнем регистре; у пути срезаны `/` по краям, затем `.git` на конце.
//! - `normalizeBase`: trim и срез `/` на конце; пусто → `null`. Схема вида `xxx://`, кроме http(s), → `BAD_ARGS`
//!   «Адрес API должен начинаться с https://». Без схемы дописывается `https://`. Не разбирается → `BAD_ARGS`
//!   «Некорректный адрес API» с подсказкой. Итог: `протокол//host[:порт]путь` без `/` на конце (запрос, фрагмент
//!   и логин отбрасываются). Разбор URL по WHATWG: крейт `url`, как `new URL` в Node.
//! - `set`: сначала проверка провайдера (`BAD_ARGS` «Неизвестный провайдер CI/CD», пустая строка = нет провайдера),
//!   затем адреса. Без провайдера и адреса запись удаляется и возвращается `null`.
//! - Код `NO_STORAGE` при отсутствии каталога данных больше не нужен: сбой базы даёт тот же код из [`crate::db`].

use std::str::FromStr;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, Language, tr};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::credentials::target::has_http_scheme;
use crate::db::{Db, NOW};

/// Провайдер CI/CD.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CiProvider {
    Gitlab,
    Github,
    Gitea,
    Bitbucket,
}

impl CiProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gitlab => "gitlab",
            Self::Github => "github",
            Self::Gitea => "gitea",
            Self::Bitbucket => "bitbucket",
        }
    }
}

impl FromStr for CiProvider {
    type Err = ();

    fn from_str(text: &str) -> std::result::Result<Self, ()> {
        match text {
            "gitlab" => Ok(Self::Gitlab),
            "github" => Ok(Self::Github),
            "gitea" => Ok(Self::Gitea),
            "bitbucket" => Ok(Self::Bitbucket),
            _ => Err(()),
        }
    }
}

/// Настройки CI/CD репозитория.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoProvider {
    pub provider: Option<CiProvider>,
    pub api_base: Option<String>,
    pub saved_at: String,
}

/// Ключ записи: host и путь без учёта регистра.
pub fn repo_key(host: &str, repo_path: &str) -> String {
    let path = repo_path.to_lowercase();
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    format!("{}/{path}", host.to_lowercase())
}

/// Есть ли в начале схема вида `xxx://`: `/^[a-z][a-z0-9+.-]*:\/\//i`.
fn has_any_scheme(text: &str) -> bool {
    let Some((scheme, _)) = text.split_once("://") else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// Приводит адрес API к виду `https://host[:порт]/путь`; пустой адрес — `None`.
pub fn normalize_base(input: Option<&str>, language: Language) -> Result<Option<String>> {
    let raw = gorynych_core::js::trim(input.unwrap_or_default()).trim_end_matches('/');
    if raw.is_empty() {
        return Ok(None);
    }
    let http = has_http_scheme(raw);
    if has_any_scheme(raw) && !http {
        return Err(GorynychError::new(ErrorCode::BadArgs, tr(language, "Адрес API должен начинаться с https://", &[])));
    }
    let parsed = if http { Url::parse(raw) } else { Url::parse(&format!("https://{raw}")) };
    let url = parsed.ok().filter(Url::has_host).ok_or_else(|| {
        GorynychError::new(ErrorCode::BadArgs, tr(language, "Некорректный адрес API", &[]))
            .with_hint(tr(language, "Например: https://gitlab.company.ru или https://github.company.ru/api/v3", &[]))
    })?;
    let host = url.host_str().unwrap_or_default();
    let port = url.port().map(|port| format!(":{port}")).unwrap_or_default();
    Ok(Some(format!("{}://{host}{port}{}", url.scheme(), url.path().trim_end_matches('/'))))
}

fn provider_from_column(text: Option<String>) -> Option<CiProvider> {
    // Столбец ограничен CHECK, так что неизвестных значений в нём нет.
    text.and_then(|text| text.parse().ok())
}

impl Db {
    /// Настройки репозитория.
    pub fn repo_provider(&self, host: &str, repo_path: &str) -> Result<Option<RepoProvider>> {
        self.with(|conn| {
            conn.query_row(
                "SELECT provider, api_base, saved_at FROM repo_providers WHERE repo_key = ?1",
                [repo_key(host, repo_path)],
                |row| {
                    Ok(RepoProvider {
                        provider: provider_from_column(row.get(0)?),
                        api_base: row.get(1)?,
                        saved_at: row.get(2)?,
                    })
                },
            )
            .optional()
        })
    }

    /// Сохраняет настройки. Без провайдера и адреса запись удаляется.
    pub fn set_repo_provider(
        &self,
        host: &str,
        repo_path: &str,
        provider: Option<&str>,
        api_base: Option<&str>,
    ) -> Result<Option<RepoProvider>> {
        let language = i18n::language();
        let provider = match provider.filter(|text| !text.is_empty()) {
            None => None,
            Some(text) => Some(text.parse::<CiProvider>().map_err(|()| {
                GorynychError::new(ErrorCode::BadArgs, tr(language, "Неизвестный провайдер CI/CD", &[]))
            })?),
        };
        let base = normalize_base(api_base, language)?;
        let key = repo_key(host, repo_path);
        if provider.is_none() && base.is_none() {
            self.with(|conn| conn.execute("DELETE FROM repo_providers WHERE repo_key = ?1", [&key]))?;
            return Ok(None);
        }
        self.with(|conn| {
            conn.execute(
                &format!(
                    "INSERT INTO repo_providers (repo_key, provider, api_base, saved_at) VALUES (?1, ?2, ?3, {NOW})
                     ON CONFLICT (repo_key) DO UPDATE SET
                       provider = excluded.provider, api_base = excluded.api_base, saved_at = excluded.saved_at"
                ),
                params![key, provider.map(CiProvider::as_str), base],
            )
        })?;
        self.repo_provider(host, repo_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_and_delete() {
        let db = Db::open_in_memory();
        assert_eq!(db.repo_provider("h", "a/b").unwrap(), None);

        let saved = db.set_repo_provider("H", "/A/B.git/", Some("gitlab"), Some("gitlab.x/api/")).unwrap().unwrap();
        assert_eq!(saved.provider, Some(CiProvider::Gitlab));
        assert_eq!(saved.api_base.as_deref(), Some("https://gitlab.x/api"));
        assert_eq!(db.repo_provider("h", "a/b").unwrap().as_ref(), Some(&saved));

        let only_base = db.set_repo_provider("h", "a/b", Some(""), Some("https://y")).unwrap().unwrap();
        assert_eq!(only_base.provider, None);

        assert_eq!(db.set_repo_provider("h", "a/b", None, Some("  ")).unwrap(), None);
        assert_eq!(db.repo_provider("h", "a/b").unwrap(), None);
    }

    #[test]
    fn invalid_input_changes_nothing() {
        let db = Db::open_in_memory();
        db.set_repo_provider("h", "p", Some("github"), None).unwrap();

        let error = db.set_repo_provider("h", "p", Some("jenkins"), Some("ftp://x")).unwrap_err();
        assert_eq!(error.code, ErrorCode::BadArgs);
        assert!(error.message.contains("провайдер"), "провайдер проверяется раньше адреса: {}", error.message);

        assert_eq!(db.set_repo_provider("h", "p", None, Some("ftp://x")).unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(db.repo_provider("h", "p").unwrap().unwrap().provider, Some(CiProvider::Github));
    }

    #[test]
    fn json_matches_1x_shape() {
        let row = RepoProvider { provider: Some(CiProvider::Gitea), api_base: None, saved_at: "t".into() };
        assert_eq!(serde_json::to_string(&row).unwrap(), r#"{"provider":"gitea","apiBase":null,"savedAt":"t"}"#);
    }
}
