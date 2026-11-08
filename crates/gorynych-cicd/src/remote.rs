//! Remote репозитория: разбор адреса (`parseRemoteUrl` из `gitlab.cjs`) и вывода `git remote -v`. `gorynych-git` появится в Фазе 3 и не входит в зависимости
//! этого крейта, поэтому git приходит через [`CicdGit`].
//!
//! ## Конспект `parseRemoteUrl`
//! - `user@host:path(.git)(/)`, причём путь не начинается с `/` → протокол `https`, порт `null`.
//! - URL `http`/`https` → свой протокол и порт; `ssh`/`git+ssh` → протокол `https`, порт `null`. Путь без `/` по краям и `.git`; пустой путь — `null`.

use std::path::Path;
use std::sync::LazyLock;

use gorynych_ci_linter::repo::RepoView;
use gorynych_core::error::Result;
use gorynych_core::js;
use indexmap::IndexMap;
use regex::Regex;
use url::Url;

/// Что нужно от git.
pub trait CicdGit: Send + Sync + 'static {
    /// Вывод `git remote -v`.
    fn remote_verbose(&self, root: &Path) -> Result<String>;

    /// Вывод `git show <spec>`; `None`, если такого объекта нет.
    fn show(&self, root: &Path, spec: &str) -> Option<String>;

    /// Чтение репозитория для линтера.
    fn view(&self, root: &Path) -> Box<dyn RepoView + Send>;
}

/// Разобранный адрес.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRemote {
    pub protocol: String,
    pub host: String,
    pub port: Option<String>,
    pub path: String,
}

static SCP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9A-Za-z_.-]+@([^:/]+):(.+?)(?:\.git)?/?$").expect("корректный шаблон"));

/// `parseRemoteUrl`.
pub fn parse_remote_url(url: &str) -> Option<ParsedRemote> {
    if url.is_empty() {
        return None;
    }
    if let Some(caps) = SCP.captures(url).filter(|caps| !caps[2].starts_with('/')) {
        return Some(ParsedRemote { protocol: "https".to_owned(), host: caps[1].to_owned(), port: None, path: caps[2].to_owned() });
    }
    let parsed = Url::parse(url).ok()?;
    let path = parsed.path().trim_start_matches('/');
    let path = path.strip_suffix(".git/").or_else(|| path.strip_suffix(".git")).unwrap_or(path).trim_end_matches('/');
    if path.is_empty() {
        return None;
    }
    let host = parsed.host_str().unwrap_or_default().to_owned();
    match parsed.scheme() {
        scheme @ ("http" | "https") => Some(ParsedRemote { protocol: scheme.to_owned(), host, port: parsed.port().map(|port| port.to_string()), path: path.to_owned() }),
        "ssh" | "git+ssh" => Some(ParsedRemote { protocol: "https".to_owned(), host, port: None, path: path.to_owned() }),
        _ => None,
    }
}

/// `/^(\S+)\s+(\S+)\s+\(fetch\)/` по строкам вывода: имя → адрес, в порядке появления.
pub fn parse_remotes(output: &str) -> IndexMap<String, String> {
    let mut remotes = IndexMap::new();
    for line in output.split('\n') {
        let mut parts = line.split(js::is_whitespace).filter(|part| !part.is_empty());
        let (Some(name), Some(url), Some(kind)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if !line.starts_with(js::is_whitespace) && kind.starts_with("(fetch)") {
            remotes.insert(name.to_owned(), url.to_owned());
        }
    }
    remotes
}

/// `[preferred, 'origin', ...keys].find(...)`.
pub fn pick_remote<'a>(remotes: &'a IndexMap<String, String>, preferred: Option<&str>) -> Option<(&'a str, &'a str)> {
    let name = preferred.filter(|name| !name.is_empty() && remotes.contains_key(*name)).or_else(|| remotes.contains_key("origin").then_some("origin"));
    match name {
        Some(name) => remotes.get_key_value(name).map(|(key, url)| (key.as_str(), url.as_str())),
        None => remotes.first().map(|(key, url)| (key.as_str(), url.as_str())),
    }
}

/// `/^https?:\/\//i`.
pub fn is_http_url(url: &str) -> bool {
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Адрес сайта по адресу remote: сохранённый адрес сервера для SSH, иначе из самого адреса.
pub fn site_base(parsed: &ParsedRemote, is_http: bool, saved: Option<String>) -> String {
    if !is_http && let Some(base) = saved.as_deref().map(|base| base.trim_end_matches('/')).filter(|base| !base.is_empty()) {
        return base.to_owned();
    }
    let port = parsed.port.as_ref().map(|port| format!(":{port}")).unwrap_or_default();
    format!("{}://{}{port}", parsed.protocol, parsed.host)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triple(url: &str) -> Option<(String, String, Option<String>, String)> {
        parse_remote_url(url).map(|p| (p.protocol, p.host, p.port, p.path))
    }

    #[test]
    fn scp_form() {
        assert_eq!(triple("git@host.ru:group/app.git"), Some(("https".into(), "host.ru".into(), None, "group/app".into())));
        assert_eq!(triple("git@host.ru:group/app.git/"), Some(("https".into(), "host.ru".into(), None, "group/app".into())));
        assert_eq!(triple("git@host:.git"), Some(("https".into(), "host".into(), None, ".git".into())));
        assert_eq!(triple("git@host:/abs/app.git"), None);
    }

    #[test]
    fn url_form() {
        assert_eq!(triple("https://Host:8443/a/b.git"), Some(("https".into(), "host".into(), Some("8443".into()), "a/b".into())));
        assert_eq!(triple("http://h/a/b/"), Some(("http".into(), "h".into(), None, "a/b".into())));
        assert_eq!(triple("ssh://git@h:2222/a/b.git"), Some(("https".into(), "h".into(), None, "a/b".into())));
        assert_eq!(triple("git+ssh://h/a"), Some(("https".into(), "h".into(), None, "a".into())));
        assert_eq!(triple("https://h/"), None);
        assert_eq!(triple("ftp://h/a"), None);
        assert_eq!(triple(r"C:\repo"), None);
        assert_eq!(triple(""), None);
    }

    #[test]
    fn remotes_keep_order_and_only_fetch() {
        let out = "up\thttps://a (fetch)\nup\thttps://b (push)\norigin\tgit@h:x (fetch)\n\nбитая строка\n";
        let map = parse_remotes(out);
        assert_eq!(map.keys().collect::<Vec<_>>(), ["up", "origin"]);
        assert_eq!(pick_remote(&map, Some("нет")), Some(("origin", "git@h:x")));
        assert_eq!(pick_remote(&map, Some("up")), Some(("up", "https://a")));
        let only = parse_remotes("x\ty (fetch)");
        assert_eq!(pick_remote(&only, None), Some(("x", "y")));
    }
}
