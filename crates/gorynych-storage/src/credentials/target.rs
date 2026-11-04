//! Разбор адресов remote и серверов. Перенос чистых функций `electron/credentials.cjs`.
//!
//! # Конспект исходника
//! - `parseTarget`: `https?://` разбирается как URL. Если разбор или `decodeURIComponent(username)` падают, то `host: null`.
//!   Дальше `ssh://[user@]host[:port]`, затем scp-вид `[user@]host:путь`, где путь не начинается с `//`, а имя хоста
//!   длиннее одного символа (иначе это диск Windows). Всё остальное — `local`.
//! - `keyOf`: `схема://host[:порт]` для HTTPS, `ssh://имя` для SSH.
//! - `repoPathOf`: для HTTPS — декодированный путь URL, для прочих — как написан. Срез `/` по краям, затем `.git`.
//! - `repoKeyOf`: `ключ сервера/путь в нижнем регистре`; нет хоста или пути — `null`.
//! - `parseServer`: принимает имя, адрес, ссылку на проект или `git@host:group/app.git`. Ошибки — `BAD_ARGS`.
//! - `sshUrlFor`: `https://host/group/app(.git)` → `git@host:group/app.git`; путь не декодируется, порт отбрасывается.
//!
//! # Заметка о регулярных выражениях
//! В исходнике есть опережающие проверки `(?!…)`, которых нет в крейте `regex`. Поэтому [`scp_parts`] перебирает варианты
//! в том же порядке, что и откат в JS: сначала с `user@`, затем без него. Это важно, например, для `a:b@c://x`.

use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

/// Способ доступа к remote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RemoteProtocol {
    Https,
    Ssh,
    Local,
}

/// Разобранный адрес remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteTarget {
    pub protocol: RemoteProtocol,
    /// `https` или `http`; у SSH и локальных адресов `null`.
    pub scheme: Option<String>,
    /// Для HTTPS — с портом.
    pub host: Option<String>,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub url: String,
}

/// Разобранный адрес сервера.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ParsedServer {
    pub base: String,
    pub scheme: String,
    pub host: String,
    pub hostname: String,
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("корректный шаблон")
}

/// `/^https?:\/\//i`.
pub(crate) fn has_http_scheme(text: &str) -> bool {
    ["http://", "https://"]
        .iter()
        .any(|scheme| text.get(..scheme.len()).is_some_and(|head| head.eq_ignore_ascii_case(scheme)))
}

/// `host[:порт]` из URL, как `URL.host`.
fn url_host(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    url.port().map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"))
}

/// Аналог `decodeURIComponent`: `None` на неполной `%`-последовательности или не UTF-8.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Вариант разбора `[user@]host:остаток`.
struct ScpParts<'a> {
    user: Option<&'a str>,
    host: &'a str,
    rest: &'a str,
}

/// Первый подходящий вариант: сначала с `user@`, затем без него.
fn scp_parts<'a>(raw: &'a str, with_user: &Regex, plain: &Regex, accept: impl Fn(&str) -> bool) -> Option<ScpParts<'a>> {
    if let Some(caps) = with_user.captures(raw) {
        let rest = &raw[caps.get(0)?.end()..];
        if accept(rest) {
            return Some(ScpParts { user: caps.get(1).map(|m| m.as_str()), host: caps.get(2)?.as_str(), rest });
        }
    }
    let caps = plain.captures(raw)?;
    let rest = &raw[caps.get(0)?.end()..];
    accept(rest).then(|| ScpParts { user: None, host: caps.get(1).map_or("", |m| m.as_str()), rest })
}

static SCP_WITH_USER: LazyLock<Regex> = LazyLock::new(|| regex(r"^([^@/\\]+)@([^:/\\]+):"));
static SCP_PLAIN: LazyLock<Regex> = LazyLock::new(|| regex(r"^([^:/\\]+):"));
static SSH_TARGET: LazyLock<Regex> = LazyLock::new(|| regex(r"^(?i-u:ssh)://(?:([^@/]+)@)?([^:/]+)"));
static SSH_PATH: LazyLock<Regex> =
    LazyLock::new(|| regex(r"^(?i-u:ssh)://[^/]+(/[^\n\r\x{2028}\x{2029}]*)$"));

fn not_double_slash(rest: &str) -> bool {
    !rest.starts_with("//")
}

fn parse_http_target(raw: &str) -> RemoteTarget {
    let failed = || RemoteTarget {
        protocol: RemoteProtocol::Https,
        scheme: Some("https".to_owned()),
        host: None,
        hostname: None,
        user: None,
        url: raw.to_owned(),
    };
    let Ok(url) = Url::parse(raw) else {
        return failed();
    };
    let Some(user) = decode_uri_component(url.username()) else {
        return failed();
    };
    let host = url_host(&url);
    RemoteTarget {
        protocol: RemoteProtocol::Https,
        scheme: Some(url.scheme().to_lowercase()),
        url: format!("{}://{host}{}", url.scheme(), url.path()),
        hostname: Some(url.host_str().unwrap_or_default().to_lowercase()),
        host: Some(host.to_lowercase()),
        user: (!user.is_empty()).then_some(user),
    }
}

/// Разбирает адрес remote.
pub fn parse_target(url: &str) -> RemoteTarget {
    let raw = js::trim(url);
    if has_http_scheme(raw) {
        return parse_http_target(raw);
    }
    let ssh = |user: Option<&str>, host: &str| RemoteTarget {
        protocol: RemoteProtocol::Ssh,
        scheme: None,
        host: Some(host.to_lowercase()),
        hostname: Some(host.to_lowercase()),
        user: user.map(str::to_owned),
        url: raw.to_owned(),
    };
    if let Some(caps) = SSH_TARGET.captures(raw) {
        return ssh(caps.get(1).map(|m| m.as_str()), &caps[2]);
    }
    if let Some(parts) = scp_parts(raw, &SCP_WITH_USER, &SCP_PLAIN, not_double_slash)
        && parts.host.encode_utf16().count() > 1
    {
        return ssh(parts.user, parts.host);
    }
    RemoteTarget {
        protocol: RemoteProtocol::Local,
        scheme: None,
        host: None,
        hostname: None,
        user: None,
        url: raw.to_owned(),
    }
}

/// Ключ сервера. Вызывается только для адреса с хостом.
pub fn server_key(target: &RemoteTarget) -> String {
    if target.protocol == RemoteProtocol::Https {
        format!("{}://{}", target.scheme.as_deref().unwrap_or_default(), target.host.as_deref().unwrap_or_default())
    } else {
        format!("ssh://{}", target.hostname.as_deref().unwrap_or_default())
    }
}

/// Срезает `/` по краям, затем `.git` на конце (без учёта регистра).
pub(crate) fn strip_repo_path(path: &str) -> &str {
    let path = path.trim_matches('/');
    let cut = path.len().wrapping_sub(4);
    match path.get(cut..) {
        Some(tail) if tail.eq_ignore_ascii_case(".git") => &path[..cut],
        _ => path,
    }
}

/// Путь репозитория из адреса, регистр сохраняется; без `.git` и `/` по краям.
pub fn repo_path_of(url: &str) -> String {
    let raw = js::trim(url);
    let path = if has_http_scheme(raw) {
        Url::parse(raw).ok().and_then(|parsed| decode_uri_component(parsed.path())).unwrap_or_default()
    } else if let Some(caps) = SSH_PATH.captures(raw) {
        caps[1].to_owned()
    } else {
        let no_line_breaks = |rest: &str| not_double_slash(rest) && !rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']);
        scp_parts(raw, &SCP_WITH_USER, &SCP_PLAIN, no_line_breaks).map_or_else(String::new, |parts| parts.rest.to_owned())
    };
    strip_repo_path(&path).to_owned()
}

/// Ключ входа репозитория; `None`, если в адресе нет хоста или пути.
pub fn repo_key_of(url: &str) -> Option<String> {
    let target = parse_target(url);
    let path = repo_path_of(url);
    if target.host.is_none() || path.is_empty() {
        return None;
    }
    Some(format!("{}/{}", server_key(&target), path.to_lowercase()))
}

/// SSH-вариант адреса: `git@host:group/app.git`. `None`, если адрес не HTTPS или в нём нет пути.
pub fn ssh_url_for(url: &str) -> Option<String> {
    let target = parse_target(url);
    if target.protocol != RemoteProtocol::Https {
        return None;
    }
    let hostname = target.hostname?;
    let parsed = Url::parse(js::trim(url)).ok()?;
    let path = strip_repo_path(parsed.path());
    (!path.is_empty()).then(|| format!("git@{hostname}:{path}.git"))
}

static SERVER_SCP_WITH_USER: LazyLock<Regex> = LazyLock::new(|| {
    let ws = js::WHITESPACE_CLASS;
    regex(&format!(r"^([^@/\\{ws}]+)@([^:/\\{ws}]+):"))
});
static SERVER_SCP_PLAIN: LazyLock<Regex> = LazyLock::new(|| regex(&format!(r"^([^:/\\{}]+):", js::WHITESPACE_CLASS)));
static SERVER_SSH: LazyLock<Regex> = LazyLock::new(|| regex(r"^(?i-u:ssh)://(?:[^@/]+@)?([^:/]+)"));
static SERVER_PORT_TAIL: LazyLock<Regex> = LazyLock::new(|| regex(r"^[0-9]+(?:/|$)"));
static SERVER_HOSTNAME: LazyLock<Regex> = LazyLock::new(|| regex(r"^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$"));

/// Разбирает адрес сервера, как его ввёл пользователь.
pub fn parse_server(input: &str) -> Result<ParsedServer> {
    let not_server = |hint: &str| GorynychError::new(ErrorCode::BadArgs, t("Не похоже на адрес сервера", &[])).with_hint(t(hint, &[]));

    let mut raw = js::trim(input).to_owned();
    if raw.is_empty() {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Укажите адрес сервера", &[]))
            .with_hint(t("Например: gitlab.company.ru", &[])));
    }
    let accept = |rest: &str| not_double_slash(rest) && !SERVER_PORT_TAIL.is_match(rest);
    if let Some(parts) = scp_parts(&raw, &SERVER_SCP_WITH_USER, &SERVER_SCP_PLAIN, accept) {
        raw = parts.host.to_owned();
    }
    if let Some(caps) = SERVER_SSH.captures(&raw) {
        raw = caps[1].to_owned();
    }
    if !has_http_scheme(&raw) {
        raw = format!("https://{raw}");
    }
    let url = Url::parse(&raw).map_err(|_| not_server("Например: gitlab.company.ru или https://git.company.ru:8443"))?;
    let hostname = url.host_str().unwrap_or_default().to_lowercase();
    if !SERVER_HOSTNAME.is_match(&hostname) || hostname.starts_with(['.', '-']) || hostname.ends_with(['.', '-']) {
        return Err(not_server("Например: gitlab.company.ru"));
    }
    let scheme = url.scheme().to_lowercase();
    let host = url_host(&url).to_lowercase();
    Ok(ParsedServer { base: format!("{scheme}://{host}"), scheme, host, hostname })
}
