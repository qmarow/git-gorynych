//! Инициализация Git в папке и подключение к удалённому репозитерию. Перенос `electron/init.cjs`.
//!
//! ## Конспект
//! - `inspectFolder`: что за папка (корень репозитория, внутри чужого, пустая), типы проекта по файлам-маркерам, шаблоны `.gitignore`, размер (обход не больше 50 000 записей), тяжёлые папки верхнего уровня.
//! - `initRepository`: шаги с подписями; при сбое `message` начинается с подписи шага. Проверки имени ветки, автора (только если нужен коммит) и email идут до первого изменения. Git старше 2.28 не знает `init -b`.
//! - `validateUrl`: `BAD_REMOTE`. `remoteHeads`: `ls-remote --symref`; ветка по умолчанию — `HEAD`, затем main, master, develop, затем первая. На `AUTH`, `FORBIDDEN`, `NOT_FOUND` подсказка заменяется подсказкой хоста.
//! - `probeRemote`: ничего не меняет в папке: одна ветка на глубину 1 во временный репозиторий, сравнение файлов по SHA-1 блоба (CRLF и LF считаются одинаковыми).
//! - `connectRepository`: локальные файлы не теряются: при различиях остаётся локальная версия, файлы только с сервера добавляются. Ошибка push не считается провалом: репозиторий уже подключён, она возвращается полем `pushError`.
//!
//! Сбой записи файла в 1.x — исключение Node с кодом ошибки ОС (`UNKNOWN` на проводе). Здесь код тот же, текст — от Rust.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::common::{fs_error, lenient, quiet, succeeds, trimmed};
use crate::network::Network;
use crate::read::normalize_root;
use crate::run::{git, git_with, FS};

const SCAN_LIMIT: u64 = 50_000;
const HEAVY_DIRS: [&str; 11] = ["node_modules", ".venv", "venv", "__pycache__", "target", "bin", "obj", "dist", "build", "Library", ".next"];

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    let space = js::WHITESPACE_CLASS;
    Regex::new(&format!("^[^{space}@]+@[^{space}@]+$")).expect("корректный шаблон")
});
static README: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^readme(\.(md|txt|rst))?$").expect("корректный шаблон"));
static URL_FORM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(https?://|ssh://|git://|file://|git@[^:]+:|[a-z0-9_.-]+@[a-z0-9_.-]+:)").expect("корректный шаблон"));
static SYM_HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ref: refs/heads/(\S+)\s+HEAD$").expect("корректный шаблон"));
static HEAD_REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9a-f]{40,64})\s+refs/heads/(.+)$").expect("корректный шаблон"));

/// Шаблон `.gitignore`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct GitignoreTemplate {
    pub label: String,
    pub lines: Vec<String>,
}

fn template(label: &str, lines: &[&str]) -> GitignoreTemplate {
    GitignoreTemplate { label: label.to_owned(), lines: lines.iter().map(|line| (*line).to_owned()).collect() }
}

/// `TEMPLATES`. Подписи и комментарии первого шаблона зависят от языка.
pub fn templates() -> IndexMap<&'static str, GitignoreTemplate> {
    let common = GitignoreTemplate {
        label: t("Общий (ОС и редакторы)", &[]),
        lines: [t("# ОС", &[]).as_str(), ".DS_Store", "Thumbs.db", "desktop.ini", "", t("# Редакторы", &[]).as_str(), ".idea/", ".vscode/*", "!.vscode/extensions.json", "*.swp", "", t("# Логи и секреты", &[]).as_str(), "*.log", ".env", ".env.*", "!.env.example"]
            .iter()
            .map(|line| (*line).to_owned())
            .collect(),
    };
    IndexMap::from([
        ("common", common),
        ("node", template("Node.js", &["# Node.js", "node_modules/", "dist/", "build/", "out/", "release/", "coverage/", ".cache/", ".next/", ".nuxt/", "npm-debug.log*", "yarn-error.log*", "pnpm-debug.log*"])),
        ("python", template("Python", &["# Python", "__pycache__/", "*.py[cod]", ".venv/", "venv/", "env/", ".pytest_cache/", ".mypy_cache/", "*.egg-info/", "dist/", "build/"])),
        ("java", template("Java / Kotlin", &["# Java", "target/", "build/", ".gradle/", "*.class", "*.jar", "out/"])),
        ("dotnet", template(".NET / C#", &["# .NET", "bin/", "obj/", ".vs/", "*.user", "*.suo", "packages/"])),
        ("go", template("Go", &["# Go", "bin/", "vendor/", "*.exe", "*.test", "*.out"])),
        ("rust", template("Rust", &["# Rust", "target/"])),
        ("unity", template("Unity", &["# Unity", "[Ll]ibrary/", "[Tt]emp/", "[Oo]bj/", "[Bb]uild/", "[Bb]uilds/", "[Ll]ogs/", "[Uu]ser[Ss]ettings/", "*.csproj", "*.sln"])),
    ])
}

/// `buildGitignore`.
pub fn build_gitignore<S: AsRef<str>>(types: &[S]) -> String {
    let all = templates();
    let blocks: Vec<String> = std::iter::once("common").chain(types.iter().map(AsRef::as_ref).filter(|kind| all.contains_key(*kind))).map(|kind| all[kind].lines.join("\n")).collect();
    format!("{}\n", blocks.join("\n\n"))
}

#[derive(Default)]
struct Scan {
    files: u64,
    dirs: u64,
    bytes: u64,
    truncated: bool,
    heavy: HashMap<String, u64>,
}

fn scan_folder(root: &Path) -> Scan {
    let mut scan = Scan::default();
    let mut stack: Vec<(PathBuf, Option<String>)> = vec![(root.to_path_buf(), None)];
    while let Some((dir, heavy_root)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                scan.dirs += 1;
                let is_heavy = heavy_root.is_none() && dir == root && HEAVY_DIRS.contains(&name.as_str());
                let key = heavy_root.clone().or(is_heavy.then_some(name));
                if let Some(key) = &key {
                    scan.heavy.entry(key.clone()).or_insert(0);
                }
                if scan.files + scan.dirs < SCAN_LIMIT {
                    stack.push((entry.path(), key));
                } else {
                    scan.truncated = true;
                }
            } else if kind.is_file() {
                scan.files += 1;
                if let Some(key) = &heavy_root {
                    *scan.heavy.entry(key.clone()).or_insert(0) += 1;
                }
                // Файл мог исчезнуть: это не важно
                scan.bytes += entry.metadata().map_or(0, |meta| meta.len());
            }
        }
        if scan.files + scan.dirs >= SCAN_LIMIT {
            scan.truncated = true;
            break;
        }
    }
    scan
}

fn detect_types(names: &[String]) -> Vec<String> {
    let has = |name: &str| names.iter().any(|item| item == name);
    let ends = |ext: &str| names.iter().any(|item| item.to_lowercase().ends_with(ext));
    let found = [
        ("node", has("package.json")),
        ("python", ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"].into_iter().any(has) || ends(".py")),
        ("java", ["pom.xml", "build.gradle", "build.gradle.kts"].into_iter().any(has)),
        ("dotnet", [".csproj", ".sln", ".fsproj"].into_iter().any(ends)),
        ("go", has("go.mod")),
        ("rust", has("Cargo.toml")),
        ("unity", has("Assets") && has("ProjectSettings")),
    ];
    found.into_iter().filter(|(_, present)| *present).map(|(kind, _)| kind.to_owned()).collect()
}

/// Автор из настроек git.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderIdentity {
    pub name: String,
    pub email: String,
    pub default_branch: String,
}

/// `inspectFolder`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub path: String,
    pub name: String,
    pub is_repo_root: bool,
    pub parent_repo: Option<String>,
    pub empty: bool,
    pub types: Vec<String>,
    pub type_labels: Vec<String>,
    pub has_gitignore: bool,
    pub has_readme: bool,
    pub gitignore_preview: String,
    pub templates: HashMap<String, GitignoreTemplate>,
    pub identity: FolderIdentity,
    #[specta(type = f64)]
    pub files: u64,
    #[specta(type = f64)]
    pub dirs: u64,
    #[specta(type = f64)]
    pub bytes: u64,
    pub truncated: bool,
    #[specta(type = HashMap<String, f64>)]
    pub heavy: HashMap<String, u64>,
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) { a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase() } else { a == b }
}

/// `inspectFolder`.
pub async fn inspect_folder(dir: Option<&str>) -> Result<FolderInfo> {
    let dir = dir.filter(|dir| !dir.is_empty()).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Не указана папка", &[])))?;
    let full = std::path::absolute(dir).map_err(fs_error)?;
    let Ok(meta) = std::fs::metadata(&full) else {
        return Err(GorynychError::new(ErrorCode::NotFoundPath, t("Папка не найдена: {0}", &[&full.display()])));
    };
    if !meta.is_dir() {
        return Err(GorynychError::new(ErrorCode::NotADir, t("Это не папка", &[])));
    }

    let repo_root = git(&full, &["rev-parse", "--show-toplevel"]).await.ok().map(|out| normalize_root(js::trim(&out)));
    let is_repo_root = repo_root.as_deref().is_some_and(|root| same_path(root, &full));

    let names = std::fs::read_dir(&full).map_err(fs_error)?.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect::<Vec<_>>();
    let types = detect_types(&names);
    let (name, email, default_branch) = tokio::join!(quiet(&full, &["config", "--get", "user.name"]), quiet(&full, &["config", "--get", "user.email"]), quiet(&full, &["config", "--get", "init.defaultBranch"]));
    let scan = scan_folder(&full);
    let all = templates();

    Ok(FolderInfo {
        path: full.display().to_string(),
        name: full.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        is_repo_root,
        parent_repo: repo_root.filter(|_| !is_repo_root).map(|root| root.display().to_string()),
        empty: names.iter().all(|name| name == ".git"),
        type_labels: types.iter().map(|kind| all.get(kind.as_str()).map_or_else(|| kind.clone(), |template| template.label.clone())).collect(),
        gitignore_preview: build_gitignore(&types),
        types,
        has_gitignore: names.iter().any(|name| name == ".gitignore"),
        has_readme: names.iter().any(|name| README.is_match(name)),
        templates: all.into_iter().map(|(key, value)| (key.to_owned(), value)).collect(),
        identity: FolderIdentity { name, email, default_branch },
        files: scan.files,
        dirs: scan.dirs,
        bytes: scan.bytes,
        truncated: scan.truncated,
        heavy: scan.heavy,
    })
}

/// Автор в запросе.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct IdentityOption {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub email: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub global: Option<bool>,
}

/// Первый коммит в запросе.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct CommitOption {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub message: Option<String>,
}

/// Параметры `initRepository`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct InitOptions {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<IdentityOption>)]
    pub identity: Option<IdentityOption>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub gitignore: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub readme: Option<bool>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<CommitOption>)]
    pub commit: Option<CommitOption>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub remote: Option<String>,
}

/// Шаг операции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct InitStep {
    pub label: String,
    pub ok: bool,
}

/// Созданный коммит.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct InitCommit {
    #[specta(type = f64)]
    pub files: usize,
    pub hash: Option<String>,
}

/// Результат `initRepository`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct InitResult {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub commit: Option<InitCommit>,
    pub remote: Option<String>,
    pub steps: Vec<InitStep>,
}

async fn step<T>(steps: &mut Vec<InitStep>, label: &str, work: impl Future<Output = Result<T>>) -> Result<T> {
    match work.await {
        Ok(value) => {
            steps.push(InitStep { label: label.to_owned(), ok: true });
            Ok(value)
        }
        Err(mut error) => {
            steps.push(InitStep { label: label.to_owned(), ok: false });
            error.message = format!("{label}: {}", error.message);
            Err(error)
        }
    }
}

fn trimmed_option(value: Option<&String>) -> &str {
    value.map_or("", |text| js::trim(text))
}

fn check_email(email: &str) -> Result<()> {
    if !email.is_empty() && !EMAIL.is_match(email) {
        return Err(GorynychError::new(ErrorCode::BadEmail, t("Некорректный email: «{0}»", &[&email])));
    }
    Ok(())
}

async fn check_branch(cwd: &Path, branch: &str) -> Result<()> {
    if succeeds(cwd, &["check-ref-format", "--branch", branch]).await {
        return Ok(());
    }
    Err(GorynychError::new(ErrorCode::InvalidName, t("Недопустимое имя ветки: «{0}»", &[&branch])))
}

async fn git_init(cwd: &Path, branch: &str) -> Result<()> {
    if git(cwd, &["init", "-b", branch]).await.is_ok() {
        return Ok(());
    }
    // Git старше 2.28 не знает -b
    git(cwd, &["init"]).await?;
    git(cwd, &["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")]).await?;
    Ok(())
}

async fn set_identity(cwd: &Path, global: bool, name: &str, email: &str) -> Result<()> {
    let scope: &[&str] = if global { &["config", "--global"] } else { &["config"] };
    for (key, value) in [("user.name", name), ("user.email", email)] {
        if !value.is_empty() {
            let mut args = scope.to_vec();
            args.extend([key, value]);
            git(cwd, &args).await?;
        }
    }
    Ok(())
}

async fn commit_everything(cwd: &Path, message: &str) -> Result<InitCommit> {
    git(cwd, &["add", "-A"]).await?;
    let staged = git(cwd, &["diff", "--cached", "--name-only", "-z"]).await?;
    let files = staged.split('\0').filter(|name| !name.is_empty()).count();
    if files == 0 {
        return Ok(InitCommit { files: 0, hash: None });
    }
    git(cwd, &["commit", "-q", "-m", js::trim(message)]).await?;
    Ok(InitCommit { files, hash: Some(trimmed(cwd, &["rev-parse", "HEAD"]).await?) })
}

fn commit_message<'a>(commit: &'a CommitOption, fallback: &'a str) -> &'a str {
    commit.message.as_deref().filter(|text| !text.is_empty()).unwrap_or(fallback)
}

/// `initRepository`.
pub async fn init_repository(dir: Option<&str>, options: &InitOptions) -> Result<InitResult> {
    let info = inspect_folder(dir).await?;
    if info.is_repo_root {
        return Err(GorynychError::new(ErrorCode::AlreadyRepo, t("Эта папка уже является Git-репозиторием", &[])));
    }
    let cwd = PathBuf::from(&info.path);
    let mut steps = Vec::new();

    let branch = options.branch.as_deref().filter(|text| !text.is_empty()).or(Some(info.identity.default_branch.as_str()).filter(|text| !text.is_empty())).unwrap_or("main");
    let branch = js::trim(branch).to_owned();
    check_branch(&cwd, &branch).await?;

    let identity = options.identity.as_ref();
    let name = trimmed_option(identity.and_then(|item| item.name.as_ref()));
    let email = trimmed_option(identity.and_then(|item| item.email.as_ref()));
    let global = identity.and_then(|item| item.global) == Some(true);
    if options.commit.is_some() && name.is_empty() && info.identity.name.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoIdentity, t("Укажите имя автора для первого коммита", &[])));
    }
    if options.commit.is_some() && email.is_empty() && info.identity.email.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoIdentity, t("Укажите email автора для первого коммита", &[])));
    }
    check_email(email)?;
    let remote = trimmed_option(options.remote.as_ref());
    if remote.chars().any(js::is_whitespace) {
        return Err(GorynychError::new(ErrorCode::BadRemote, t("Адрес remote не должен содержать пробелов", &[])));
    }

    step(&mut steps, "git init", git_init(&cwd, &branch)).await?;
    if !name.is_empty() || !email.is_empty() {
        let label = if global { t("Имя и email (для всех репозиториев)", &[]) } else { t("Имя и email (для этого репозитория)", &[]) };
        step(&mut steps, &label, set_identity(&cwd, global, name, email)).await?;
    }
    if let Some(text) = options.gitignore.as_deref().filter(|text| !text.is_empty() && !info.has_gitignore) {
        step(&mut steps, ".gitignore", async { std::fs::write(cwd.join(".gitignore"), text).map_err(fs_error) }).await?;
    }
    if options.readme == Some(true) && !info.has_readme {
        step(&mut steps, "README.md", async { std::fs::write(cwd.join("README.md"), format!("# {}\n", info.name)).map_err(fs_error) }).await?;
    }
    let mut commit = None;
    if let Some(option) = &options.commit {
        let label = t("Первый коммит", &[]);
        commit = Some(step(&mut steps, &label, commit_everything(&cwd, commit_message(option, "Initial commit"))).await?);
    }
    if !remote.is_empty() {
        let label = format!("Remote origin → {remote}");
        step(&mut steps, &label, async { git(&cwd, &["remote", "add", "origin", remote]).await.map(|_| ()) }).await?;
    }
    Ok(InitResult { path: info.path.clone(), name: info.name, branch, commit, remote: (!remote.is_empty()).then(|| remote.to_owned()), steps })
}

/// `validateUrl`.
pub fn validate_url(url: Option<&str>) -> Result<String> {
    let url = js::trim(url.unwrap_or_default());
    if url.is_empty() {
        return Err(GorynychError::new(ErrorCode::BadRemote, t("Укажите адрес репозитория", &[])));
    }
    if url.chars().any(js::is_whitespace) {
        return Err(GorynychError::new(ErrorCode::BadRemote, t("Адрес не должен содержать пробелов", &[])));
    }
    if !URL_FORM.is_match(url) {
        return Err(GorynychError::new(ErrorCode::BadRemote, t("Не похоже на адрес Git-репозитория", &[])).with_hint(t("Пример: https://gitlab.com/user/project.git или git@gitlab.com:user/project.git", &[])));
    }
    Ok(url.to_owned())
}

fn mentions(url: &str, name: &str) -> bool {
    url.to_ascii_lowercase().contains(name)
}

/// `hostHint`.
pub fn host_hint(url: &str) -> Option<String> {
    if mentions(url, "gitlab") {
        return Some(t("GitLab по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token (scope: read_repository и write_repository) вместо пароля. По SSH: добавьте публичный ключ в GitLab → Preferences → SSH Keys.", &[]));
    }
    if mentions(url, "github") {
        return Some(t("GitHub по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token. По SSH: добавьте ключ в Settings → SSH and GPG keys.", &[]));
    }
    None
}

/// Название хостинга по адресу.
pub(crate) fn host_name(url: &str) -> Option<String> {
    let name = if mentions(url, "gitlab") {
        "GitLab"
    } else if mentions(url, "github") {
        "GitHub"
    } else if mentions(url, "bitbucket") {
        "Bitbucket"
    } else {
        return None;
    };
    Some(name.to_owned())
}

/// Ветка на сервере.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteHead {
    pub name: String,
    pub hash: String,
}

/// `remoteHeads`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHeads {
    pub empty: bool,
    pub branches: Vec<RemoteHead>,
    pub default_branch: Option<String>,
    pub head_branch: Option<String>,
}

/// Подсказка хоста вместо общей, когда сервер отказал.
pub(crate) fn with_host_hint(mut error: GorynychError, url: &str) -> GorynychError {
    if matches!(error.code, ErrorCode::Auth | ErrorCode::Forbidden | ErrorCode::NotFound)
        && let Some(hint) = host_hint(url)
    {
        error.hint = Some(hint);
    }
    error
}

/// `remoteHeads`.
pub async fn remote_heads(network: &Network, url: &str, cwd: &Path) -> Result<RemoteHeads> {
    let out = network.git_at(cwd, Some(url), &["ls-remote", "--symref", url]).await.map_err(|error| with_host_hint(error, url))?;
    let mut head = None;
    let mut branches = Vec::new();
    for line in out.split('\n') {
        if let Some(caps) = SYM_HEAD.captures(line) {
            head = Some(caps[1].to_owned());
        }
        if let Some(caps) = HEAD_REF.captures(line) {
            branches.push(RemoteHead { name: caps[2].to_owned(), hash: caps[1].to_owned() });
        }
    }
    let has = |name: &str| branches.iter().any(|branch| branch.name == name);
    let default_branch = head.clone().filter(|name| has(name)).or_else(|| ["main", "master", "develop"].iter().find(|name| has(name)).map(|name| (*name).to_owned())).or_else(|| branches.first().map(|branch| branch.name.clone()));
    Ok(RemoteHeads { empty: branches.is_empty(), branches, default_branch, head_branch: head })
}

/// `blobSha1`: как у `git hash-object`.
fn blob_sha1(bytes: &[u8]) -> String {
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", bytes.len()));
    hash.update(bytes);
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn same_as_remote(local: &Path, remote_sha: &str) -> bool {
    let Ok(bytes) = std::fs::read(local) else {
        return false;
    };
    if blob_sha1(&bytes) == remote_sha {
        return true;
    }
    // На Windows файлы часто с CRLF, а в репозитории LF: считаем такие одинаковыми
    let mut unix = Vec::with_capacity(bytes.len());
    for (index, byte) in bytes.iter().enumerate() {
        if !(*byte == b'\r' && bytes.get(index + 1) == Some(&b'\n')) {
            unix.push(*byte);
        }
    }
    blob_sha1(&unix) == remote_sha
}

/// Параметры `probeRemote`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ProbeRemote {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub url: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
}

/// Последний коммит на сервере.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RemoteCommit {
    pub message: String,
    pub author: String,
    pub date: String,
    pub hash: String,
}

/// Результат `probeRemote`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProbe {
    pub url: String,
    pub host: Option<String>,
    #[serde(flatten)]
    pub heads: RemoteHeads,
    pub branch: Option<String>,
    pub last_commit: Option<RemoteCommit>,
    #[specta(type = f64)]
    pub remote_files: u32,
    pub same: Vec<String>,
    pub differ: Vec<String>,
    pub remote_only: Vec<String>,
    pub remote_has_gitignore: bool,
}

/// `probeRemote`.
pub async fn probe_remote(network: &Network, dir: Option<&str>, request: &ProbeRemote) -> Result<RemoteProbe> {
    let info = inspect_folder(dir).await?;
    let remote_url = validate_url(request.url.as_deref())?;
    let temp = tempfile::Builder::new().prefix("gk-probe-").tempdir().map_err(fs_error)?;
    let tmp = temp.path();
    let heads = remote_heads(network, &remote_url, tmp).await?;
    let mut result = RemoteProbe {
        host: host_name(&remote_url),
        url: remote_url.clone(),
        heads: heads.clone(),
        branch: None,
        last_commit: None,
        remote_files: 0,
        same: Vec::new(),
        differ: Vec::new(),
        remote_only: Vec::new(),
        remote_has_gitignore: false,
    };
    if heads.empty {
        return Ok(result);
    }
    let wanted = request.branch.as_deref().filter(|branch| !branch.is_empty() && heads.branches.iter().any(|item| item.name == *branch));
    let target = wanted.or(heads.default_branch.as_deref()).unwrap_or_default().to_owned();
    result.branch = Some(target.clone());

    // Неглубокая загрузка одной ветки во временный репозиторий: только чтобы увидеть файлы
    git(tmp, &["init", "-q", "--bare"]).await?;
    network.git_at(tmp, Some(&remote_url), &["fetch", "-q", "--depth", "1", &remote_url, &format!("refs/heads/{target}:refs/heads/probe")]).await?;
    let format = format!("--format=%s{FS}%an{FS}%aI{FS}%H");
    let log = trimmed(tmp, &["log", "-1", &format, "refs/heads/probe"]).await?;
    let mut fields = log.split(FS).map(str::to_owned);
    let mut next = || fields.next().unwrap_or_default();
    result.last_commit = Some(RemoteCommit { message: next(), author: next(), date: next(), hash: next() });

    let tree = git(tmp, &["ls-tree", "-r", "-z", "refs/heads/probe"]).await?;
    for entry in tree.split('\0').filter(|entry| !entry.is_empty()) {
        let Some((head, file)) = entry.split_once('\t') else {
            continue;
        };
        let mut parts = head.split(' ').skip(1);
        let (kind, sha) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        if kind != "blob" {
            continue;
        }
        result.remote_files += 1;
        if file == ".gitignore" {
            result.remote_has_gitignore = true;
        }
        let local = file.split('/').fold(PathBuf::from(&info.path), |path, part| path.join(part));
        if !local.exists() {
            result.remote_only.push(file.to_owned());
        } else if same_as_remote(&local, sha) {
            result.same.push(file.to_owned());
        } else {
            result.differ.push(file.to_owned());
        }
    }
    Ok(result)
}

/// Параметры `connectRepository`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct ConnectOptions {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub url: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<IdentityOption>)]
    pub identity: Option<IdentityOption>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub gitignore: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<CommitOption>)]
    pub commit: Option<CommitOption>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<bool>)]
    pub push: Option<bool>,
}

/// Результат `connectRepository`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub url: String,
    pub remote_was_empty: bool,
    #[specta(type = f64)]
    pub restored: usize,
    pub commit: Option<InitCommit>,
    pub pushed: bool,
    pub push_error: Option<GorynychError>,
    pub steps: Vec<InitStep>,
}

async fn overlay_server_history(cwd: &Path, branch: &str) -> Result<usize> {
    // Ветка указывает на коммит сервера, рабочие файлы остаются как есть
    let origin = format!("origin/{branch}");
    git(cwd, &["reset", "-q", "--mixed", &origin]).await?;
    git(cwd, &["branch", &format!("--set-upstream-to={origin}"), branch]).await?;
    // Файлы, которые есть только на сервере, возвращаем в папку
    let deleted = git(cwd, &["ls-files", "--deleted", "-z"]).await?;
    let deleted: Vec<&str> = deleted.split('\0').filter(|name| !name.is_empty()).collect();
    for part in deleted.chunks(100) {
        let mut args = vec!["checkout", "--"];
        args.extend_from_slice(part);
        git(cwd, &args).await?;
    }
    Ok(deleted.len())
}

/// `connectRepository`.
pub async fn connect_repository(network: &Network, dir: Option<&str>, options: &ConnectOptions) -> Result<ConnectResult> {
    let info = inspect_folder(dir).await?;
    if info.is_repo_root {
        return Err(GorynychError::new(ErrorCode::AlreadyRepo, t("В этой папке уже есть Git-репозиторий", &[])));
    }
    let url = validate_url(options.url.as_deref())?;
    let cwd = PathBuf::from(&info.path);

    let identity = options.identity.as_ref();
    let name = trimmed_option(identity.and_then(|item| item.name.as_ref()));
    let email = trimmed_option(identity.and_then(|item| item.email.as_ref()));
    if options.commit.is_some() && name.is_empty() && info.identity.name.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoIdentity, t("Укажите имя автора для коммита", &[])));
    }
    if options.commit.is_some() && email.is_empty() && info.identity.email.is_empty() {
        return Err(GorynychError::new(ErrorCode::NoIdentity, t("Укажите email автора для коммита", &[])));
    }
    check_email(email)?;

    let heads = remote_heads(network, &url, &cwd).await?;
    let wanted = options.branch.as_deref().filter(|text| !text.is_empty());
    let branch = if heads.empty {
        wanted.or(Some(info.identity.default_branch.as_str()).filter(|text| !text.is_empty())).unwrap_or("main")
    } else {
        wanted.or(heads.default_branch.as_deref()).unwrap_or_default()
    };
    let branch = js::trim(branch).to_owned();
    if !heads.empty && !heads.branches.iter().any(|item| item.name == branch) {
        return Err(GorynychError::new(ErrorCode::NotFoundRef, t("На сервере нет ветки «{0}»", &[&branch])));
    }
    check_branch(&cwd, &branch).await?;

    let mut steps = Vec::new();
    let net = network.options(&cwd, Some(&url)).await;

    step(&mut steps, "git init", git_init(&cwd, &branch)).await?;
    if !name.is_empty() || !email.is_empty() {
        let label = t("Имя и email автора", &[]);
        step(&mut steps, &label, set_identity(&cwd, identity.and_then(|item| item.global) == Some(true), name, email)).await?;
    }
    step(&mut steps, "remote origin", async { git(&cwd, &["remote", "add", "origin", &url]).await.map(|_| ()) }).await?;

    let mut restored = 0;
    let mut remote_has_gitignore = false;
    if !heads.empty {
        let label = t("Загрузка {0} с сервера", &[&branch]);
        step(&mut steps, &label, async { git_with(&cwd, &["fetch", "origin", &branch], net.options.clone()).await.map(|_| ()) }).await?;
        let label = t("Наложение истории сервера", &[]);
        restored = step(&mut steps, &label, overlay_server_history(&cwd, &branch)).await?;
        remote_has_gitignore = cwd.join(".gitignore").exists() && !info.has_gitignore;
    }
    if let Some(text) = options.gitignore.as_deref().filter(|text| !text.is_empty() && !info.has_gitignore && !remote_has_gitignore) {
        step(&mut steps, ".gitignore", async { std::fs::write(cwd.join(".gitignore"), text).map_err(fs_error) }).await?;
    }
    let mut commit = None;
    if let Some(option) = &options.commit {
        let label = t("Коммит файлов проекта", &[]);
        commit = Some(step(&mut steps, &label, commit_everything(&cwd, commit_message(option, "Add project files"))).await?);
    }

    // Push: ошибку не считаем провалом всей операции, репозиторий уже подключён
    let (mut pushed, mut push_error) = (false, None);
    let has_commit_hash = commit.as_ref().is_some_and(|item: &InitCommit| item.hash.is_some());
    if options.push == Some(true) && (has_commit_hash || !heads.empty) {
        let has_commits = succeeds(&cwd, &["rev-parse", "--verify", "--quiet", "HEAD"]).await;
        let ahead = if heads.empty {
            has_commits
        } else {
            let count = git(&cwd, &["rev-list", "--count", &format!("origin/{branch}..HEAD")]).await.unwrap_or_else(|_| "0".to_owned());
            js::trim(&count).parse::<u64>().unwrap_or(0) > 0
        };
        if ahead {
            let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
            let label = format!("push → origin/{branch}");
            match git_with(&cwd, &["push", "--porcelain", "--set-upstream", "origin", &spec], net.options.clone()).await {
                Ok(_) => {
                    pushed = true;
                    steps.push(InitStep { label, ok: true });
                }
                Err(mut error) => {
                    if error.code == ErrorCode::Protected && mentions(&url, "gitlab") {
                        error.hint = Some(t("В GitLab основная ветка защищена: пушить в неё могут только Maintainer. Попросите роль Maintainer, снимите защиту (Settings → Repository → Protected branches) или отправьте изменения в отдельную ветку.", &[]));
                    }
                    push_error = Some(error);
                    steps.push(InitStep { label, ok: false });
                }
            }
        }
    }

    Ok(ConnectResult { path: info.path.clone(), name: info.name, branch, url, remote_was_empty: heads.empty, restored, commit, pushed, push_error, steps })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_like_git_hash_object() {
        assert_eq!(blob_sha1(b"abc"), "f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f");
    }

    #[test]
    fn crlf_counts_as_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        std::fs::write(&file, b"a\r\nb\r\n").unwrap();
        assert!(same_as_remote(&file, &blob_sha1(b"a\nb\n")));
        assert!(!same_as_remote(&file, &blob_sha1(b"a\nc\n")));
        assert!(!same_as_remote(&dir.path().join("нет"), "x"));
    }

    #[test]
    fn url_forms() {
        for good in ["https://x/y.git", "SSH://x/y", "git://x/y", "file:///c/y", "git@host:a/b", "user.name@host-1:a"] {
            assert_eq!(validate_url(Some(good)).unwrap(), good);
        }
        for bad in ["", "   ", "a b", "/local/path", "C:\\x", "host:a"] {
            assert_eq!(validate_url(Some(bad)).unwrap_err().code, ErrorCode::BadRemote, "{bad}");
        }
    }

    #[test]
    fn project_types_by_markers() {
        let names = |list: &[&str]| list.iter().map(|name| (*name).to_owned()).collect::<Vec<_>>();
        assert_eq!(detect_types(&names(&["package.json", "main.PY", "App.csproj"])), ["node", "python", "dotnet"]);
        assert_eq!(detect_types(&names(&["Assets"])), Vec::<String>::new());
        assert_eq!(detect_types(&names(&["Assets", "ProjectSettings"])), ["unity"]);
    }

    #[test]
    fn scan_counts_heavy_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/a")).unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::create_dir_all(dir.path().join("src/target")).unwrap();
        std::fs::write(dir.path().join("node_modules/a/f"), b"12").unwrap();
        std::fs::write(dir.path().join("src/target/f"), b"123").unwrap();
        std::fs::write(dir.path().join(".git/f"), b"1234").unwrap();
        let scan = scan_folder(dir.path());
        assert_eq!((scan.files, scan.dirs, scan.bytes), (2, 4, 5));
        assert_eq!(scan.heavy.get("node_modules"), Some(&1));
        assert_eq!(scan.heavy.get("target"), None, "только верхний уровень");
    }
}
