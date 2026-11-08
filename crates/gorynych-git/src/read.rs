//! Чтение репозитория: ветки, теги, stash, история, рабочая копия, незавершённые операции, файлы коммита, содержимое stash. Перенос `electron/git.cjs`.
//!
//! ## Конспект
//! - `readRefs`: независимые запросы параллельно; ошибка `stash list` — нет сташей. `upstream:track` даёт `ahead N`, `behind N`, `gone`. В пустом репозитории текущая ветка берётся из `symbolic-ref`.
//!   Удалённые без веток тоже показываются. `<remote>/HEAD` пропускается.
//! - `readCommits`: `--date-order`, а не `--topo-order`: topo выводит каждую линию целиком и граф становится лесенкой. В пустом репозитории — пусто. Украшения: сперва HEAD, затем локальные, удалённые, теги.
//! - `readStatus`: `R`/`C` забирают следующее поле как старый путь. `U` в любой колонке, `AA`, `DD` — конфликт. `stats`: числа из `--numstat`, новый файл считается по строкам, не больше 400 файлов и 1 МБ, с нулём в первых 8000 байт — без счётчика.
//! - `getCommitFiles`: `C` показывается как новый файл. `moved`: сходство 100 или нет изменённых строк.
//! - `getStashDetails`: отслеживаемые файлы относительно базы и неотслеживаемые из третьего родителя.
//!
//! Ошибка `Некорректный хэш коммита` в 1.x без кода, поэтому здесь `UNKNOWN`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use futures_util::future::join_all;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use regex::Regex;
use serde::Serialize;

use crate::run::{FS, RS, git};

const DEFAULT_LIMIT: u32 = 2000;
const MAX_COUNTED_UNTRACKED: usize = 400;
const MAX_COUNT_BYTES: u64 = 1024 * 1024;

static HASH: LazyLock<Regex> = LazyLock::new(|| Regex::new("(?i)^[0-9a-f]{4,64}$").expect("корректный шаблон"));
static AHEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"ahead ([0-9]+)").expect("корректный шаблон"));
static BEHIND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"behind ([0-9]+)").expect("корректный шаблон"));

/// `HASH_RE`.
pub fn is_hash(text: &str) -> bool {
    HASH.is_match(text)
}

fn non_empty(text: Option<&str>) -> Option<String> {
    text.filter(|item| !item.is_empty()).map(str::to_owned)
}

/// `path.normalize` для вывода `rev-parse --show-toplevel`: на Windows `C:/x` становится `C:\x`.
pub(crate) fn normalize_root(text: &str) -> PathBuf {
    if cfg!(windows) { PathBuf::from(text.replace('/', "\\")) } else { PathBuf::from(text) }
}

/// `resolveRepoRoot`.
pub async fn resolve_repo_root(dir: &Path) -> Result<PathBuf> {
    match git(dir, &["rev-parse", "--show-toplevel"]).await {
        Ok(out) => Ok(normalize_root(gorynych_core::js::trim(&out))),
        Err(error) if error.code == ErrorCode::GitMissing => Err(error),
        Err(_) => Err(GorynychError::new(ErrorCode::NotARepo, t("Папка не является Git-репозиторием: {0}", &[&dir.display()]))),
    }
}

/// `hasHead`.
pub async fn has_head(cwd: &Path) -> bool {
    git(cwd, &["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_ok()
}

/// Локальная ветка.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    pub name: String,
    pub hash: String,
    pub upstream: Option<String>,
    pub upstream_remote: Option<String>,
    /// Например `refs/heads/main`.
    pub upstream_ref: Option<String>,
    pub gone: bool,
    #[specta(type = f64)]
    pub ahead: u32,
    #[specta(type = f64)]
    pub behind: u32,
    pub date: Option<String>,
}

/// Ветка удалённого репозитория.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    pub name: String,
    pub full_name: String,
    pub hash: String,
    pub date: Option<String>,
}

/// Удалённый репозиторий.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Remote {
    pub name: String,
    pub branches: Vec<RemoteBranch>,
}

/// Тег.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Tag {
    pub name: String,
    pub hash: String,
}

/// Запись stash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Stash {
    pub id: String,
    pub hash: String,
    pub message: String,
    pub date: String,
    pub base: Option<String>,
    pub untracked: Option<String>,
}

/// `readRefs`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RefsInfo {
    pub local_branches: Vec<LocalBranch>,
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
    pub current_branch: Option<String>,
}

fn count_of(pattern: &Regex, text: &str) -> u32 {
    pattern.captures(text).and_then(|caps| caps[1].parse().ok()).unwrap_or(0)
}

/// `readRefs`.
pub async fn read_refs(cwd: &Path) -> Result<RefsInfo> {
    let branch_format = format!(
        "--format=%(refname){FS}%(refname:short){FS}%(objectname){FS}%(upstream:short){FS}%(upstream:track){FS}%(HEAD){FS}%(upstream:remotename){FS}%(upstream:remoteref){FS}%(committerdate:iso-strict)"
    );
    let tag_format = format!("--format=%(refname:short){FS}%(objectname){FS}%(*objectname)");
    let stash_format = format!("--format=%gd{FS}%H{FS}%gs{FS}%aI{FS}%P");
    let branch_args = ["for-each-ref", &branch_format, "refs/heads", "refs/remotes"];
    let tag_args = ["for-each-ref", "--sort=-creatordate", &tag_format, "refs/tags"];
    let stash_args = ["stash", "list", &stash_format];
    let (out, remote_out, tags_out, stash_out) = tokio::join!(git(cwd, &branch_args), git(cwd, &["remote"]), git(cwd, &tag_args), git(cwd, &stash_args));
    let (out, remote_out, tags_out) = (out?, remote_out?, tags_out?);
    let stash_out = stash_out.unwrap_or_default();

    let mut local_branches = Vec::new();
    let mut remotes: Vec<Remote> = Vec::new();
    let mut current_branch = None;
    for line in out.split('\n').filter(|line| !line.is_empty()) {
        let fields: Vec<&str> = line.split(FS).collect();
        let field = |index: usize| fields.get(index).copied().unwrap_or_default();
        let (full, short, hash, track, date) = (field(0), field(1), field(2), field(4), non_empty(fields.get(8).copied()));
        if full.starts_with("refs/heads/") {
            local_branches.push(LocalBranch {
                name: short.to_owned(),
                hash: hash.to_owned(),
                upstream: non_empty(Some(field(3))),
                upstream_remote: non_empty(Some(field(6))),
                upstream_ref: non_empty(Some(field(7))),
                gone: track.contains("gone"),
                ahead: count_of(&AHEAD, track),
                behind: count_of(&BEHIND, track),
                date,
            });
            if field(5) == "*" {
                current_branch = Some(short.to_owned());
            }
        } else if let Some(rest) = full.strip_prefix("refs/remotes/") {
            let Some((remote, branch)) = rest.split_once('/') else {
                continue;
            };
            if branch == "HEAD" {
                continue;
            }
            let item = RemoteBranch { name: branch.to_owned(), full_name: format!("{remote}/{branch}"), hash: hash.to_owned(), date };
            match remotes.iter_mut().find(|known| known.name == remote) {
                Some(known) => known.branches.push(item),
                None => remotes.push(Remote { name: remote.to_owned(), branches: vec![item] }),
            }
        }
    }

    // В пустом репозитории веток ещё нет, но HEAD уже указывает на ветку
    if current_branch.is_none() {
        current_branch = git(cwd, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await.ok().map(|out| gorynych_core::js::trim(&out).to_owned()).filter(|name| !name.is_empty());
    }
    // Удалённые без веток (только что добавленные) тоже показываем
    for name in remote_out.split('\n').filter(|line| !line.is_empty()) {
        if !remotes.iter().any(|known| known.name == name) {
            remotes.push(Remote { name: name.to_owned(), branches: Vec::new() });
        }
    }
    let tags = tags_out
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FS);
            let name = fields.next().unwrap_or_default().to_owned();
            let object = fields.next().unwrap_or_default();
            let peeled = fields.next().filter(|hash| !hash.is_empty());
            Tag { name, hash: peeled.unwrap_or(object).to_owned() }
        })
        .collect();
    let stashes = stash_out
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split(FS).map(str::to_owned);
            let mut next = || fields.next().unwrap_or_default();
            let (id, hash, message, date, parents) = (next(), next(), next(), next(), next());
            let parts: Vec<&str> = parents.split(' ').collect();
            Stash { id, hash, message, date, base: non_empty(parts.first().copied()), untracked: non_empty(parts.get(2).copied()) }
        })
        .collect();
    Ok(RefsInfo { local_branches, remotes, tags, stashes, current_branch })
}

/* ---------- История ---------- */

/// Автор коммита.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CommitAuthor {
    pub name: String,
    pub email: String,
}

/// Вид ссылки.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

/// Ссылка на коммите.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CommitRef {
    #[serde(rename = "type")]
    pub kind: RefKind,
    pub name: String,
    pub head: Option<bool>,
}

/// Коммит.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: CommitAuthor,
    pub date: String,
    pub message: String,
    pub description: String,
    pub refs: Vec<CommitRef>,
    pub is_head: bool,
}

/// `parseDecorations`.
fn parse_decorations(decor: &str, local: &HashSet<&str>, remote: &HashSet<String>) -> (Vec<CommitRef>, bool) {
    let mut refs = Vec::new();
    let mut is_head = false;
    let plain = |kind, name: &str| CommitRef { kind, name: name.to_owned(), head: None };
    for part in decor.split(", ") {
        let part = gorynych_core::js::trim(part);
        if part.is_empty() {
            continue;
        }
        if part == "HEAD" {
            is_head = true;
        } else if let Some(name) = part.strip_prefix("HEAD -> ") {
            is_head = true;
            refs.push(CommitRef { kind: RefKind::Local, name: name.to_owned(), head: Some(true) });
        } else if let Some(name) = part.strip_prefix("tag: ") {
            refs.push(plain(RefKind::Tag, name));
        } else if part.ends_with("/HEAD") {
        } else if local.contains(part) {
            refs.push(plain(RefKind::Local, part));
        } else if remote.contains(part) || part != "refs/stash" {
            refs.push(plain(RefKind::Remote, part));
        }
    }
    let order = |kind: RefKind| match kind {
        RefKind::Local => 0,
        RefKind::Remote => 1,
        RefKind::Tag => 2,
    };
    refs.sort_by_key(|item| (item.head != Some(true), order(item.kind)));
    (refs, is_head)
}

fn short_decoration(part: &str) -> String {
    let part = part.replacen("HEAD -> refs/heads/", "HEAD -> ", 1);
    if let Some(rest) = part.strip_prefix("tag: refs/tags/") {
        return format!("tag: {rest}");
    }
    let rest = part.strip_prefix("refs/heads/").unwrap_or(&part);
    rest.strip_prefix("refs/remotes/").unwrap_or(rest).to_owned()
}

/// `readCommits`.
pub async fn read_commits(cwd: &Path, refs: &RefsInfo, limit: u32) -> Result<Vec<Commit>> {
    let max_count = format!("--max-count={limit}");
    let format = format!("--format={}%x1e", ["%H", "%P", "%an", "%ae", "%aI", "%s", "%b", "%D"].join("%x1f"));
    let args = ["log", "--branches", "--remotes", "--tags", "HEAD", "--date-order", &max_count, &format, "--decorate=full", "--decorate-refs-exclude=refs/stash"];
    let out = match git(cwd, &args).await {
        Ok(out) => out,
        Err(error) => {
            // Пустой репозиторий без коммитов
            if !has_head(cwd).await {
                return Ok(Vec::new());
            }
            return Err(error);
        }
    };
    let local: HashSet<&str> = refs.local_branches.iter().map(|branch| branch.name.as_str()).collect();
    let remote: HashSet<String> = refs.remotes.iter().flat_map(|item| item.branches.iter().map(|branch| branch.full_name.clone())).collect();
    let mut commits = Vec::new();
    for record in out.split(RS) {
        let record = record.strip_prefix('\n').unwrap_or(record);
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split(FS).collect();
        let field = |index: usize| fields.get(index).copied().unwrap_or_default();
        if field(0).is_empty() {
            continue;
        }
        let decor: Vec<String> = gorynych_core::js::trim(field(7)).split(", ").filter(|part| !part.is_empty()).map(short_decoration).collect();
        let (refs, is_head) = parse_decorations(&decor.join(", "), &local, &remote);
        commits.push(Commit {
            hash: field(0).to_owned(),
            parents: if field(1).is_empty() { Vec::new() } else { field(1).split(' ').map(str::to_owned).collect() },
            author: CommitAuthor { name: field(2).to_owned(), email: field(3).to_owned() },
            date: field(4).to_owned(),
            message: field(5).to_owned(),
            description: gorynych_core::js::trim(field(6)).to_owned(),
            refs,
            is_head,
        });
    }
    Ok(commits)
}

/* ---------- Рабочая копия ---------- */

fn status_letter(code: char) -> &'static str {
    match code {
        'M' | 'T' => "M",
        'A' | 'C' | '?' => "A",
        'D' => "D",
        'R' => "R",
        'U' => "U",
        _ => "M",
    }
}

/// Счётчики файла из `--numstat`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NumStat {
    #[specta(type = Option<f64>)]
    pub additions: Option<u64>,
    #[specta(type = Option<f64>)]
    pub deletions: Option<u64>,
    pub old_path: Option<String>,
}

/// `parseNumstat`: `add\tdel\tpath\0` или для переименования `add\tdel\t\0old\0new\0`.
pub fn parse_numstat(text: &str) -> HashMap<String, NumStat> {
    let mut stats = HashMap::new();
    let parts: Vec<&str> = text.split('\0').collect();
    let mut index = 0;
    while index < parts.len() {
        let entry = parts[index];
        index += 1;
        if entry.is_empty() {
            continue;
        }
        let mut fields = entry.split('\t');
        let (add, del, path) = (fields.next().unwrap_or_default(), fields.next().unwrap_or_default(), fields.next().unwrap_or_default());
        let (file, old_path) = if path.is_empty() {
            let old = parts.get(index).map(|item| (*item).to_owned());
            let new = parts.get(index + 1).copied().unwrap_or("undefined").to_owned();
            index += 2;
            (new, old)
        } else {
            (path.to_owned(), None)
        };
        let count = |text: &str| if text == "-" { None } else { Some(text.parse().unwrap_or(0)) };
        stats.insert(file, NumStat { additions: count(add), deletions: count(del), old_path });
    }
    stats
}

fn is_old_git_flag_error(error: &GorynychError) -> bool {
    let text = if error.details.is_empty() { &error.message } else { &error.details };
    let lower = text.to_lowercase();
    lower.contains("ignore-cr-at-eol") || lower.contains("unknown option")
}

/// Сообщает, что Git слишком стар для флага: общая проверка с diff файла.
pub(crate) fn lacks_flag(error: &GorynychError) -> bool {
    is_old_git_flag_error(error)
}

async fn diff_numstat(cwd: &Path, extra: &[&str]) -> HashMap<String, NumStat> {
    let mut args: Vec<&str> = vec!["diff"];
    args.extend_from_slice(extra);
    args.extend_from_slice(&["--numstat", "-z", "-M", "--no-color", "--no-ext-diff"]);
    let mut with_flag = args.clone();
    with_flag.push("--ignore-cr-at-eol");
    match git(cwd, &with_flag).await {
        Ok(out) => parse_numstat(&out),
        Err(error) if is_old_git_flag_error(&error) => parse_numstat(&git(cwd, &args).await.unwrap_or_default()),
        Err(_) => HashMap::new(),
    }
}

/// Новый файл: все его строки добавлены. Двоичные и слишком большие — без счётчика.
async fn count_lines(full: PathBuf) -> Option<u64> {
    let meta = tokio::fs::metadata(&full).await.ok()?;
    if !meta.is_file() || meta.len() > MAX_COUNT_BYTES {
        return None;
    }
    let bytes = tokio::fs::read(&full).await.ok()?;
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return None;
    }
    let Some(last) = bytes.last() else {
        return Some(0);
    };
    let lines = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    Some(if *last == b'\n' { lines } else { lines + 1 })
}

/// Файл рабочей копии.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WipEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub untracked: Option<bool>,
    pub old_path: Option<String>,
    #[specta(type = Option<f64>)]
    pub additions: Option<u64>,
    #[specta(type = Option<f64>)]
    pub deletions: Option<u64>,
    pub moved: Option<bool>,
}

/// `readStatus`.
pub async fn read_status(cwd: &Path, stats: bool) -> Result<Vec<WipEntry>> {
    let out = git(cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"]).await?;
    let parts: Vec<&str> = out.split('\0').collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let entry = parts[index];
        index += 1;
        if entry.is_empty() {
            continue;
        }
        let mut chars = entry.chars();
        let (x, y) = (chars.next().unwrap_or(' '), chars.next().unwrap_or(' '));
        let path: String = entry.chars().skip(3).collect();
        let old_path = if x == 'R' || x == 'C' {
            let old = parts.get(index).map(|item| (*item).to_owned());
            index += 1;
            old
        } else {
            None
        };
        if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
            files.push(WipEntry { path, status: "U".to_owned(), ..WipEntry::default() });
            continue;
        }
        if x == '?' {
            files.push(WipEntry { path, status: "A".to_owned(), untracked: Some(true), ..WipEntry::default() });
            continue;
        }
        if x != ' ' {
            files.push(WipEntry { path: path.clone(), status: status_letter(x).to_owned(), staged: true, old_path: old_path.filter(|old| x == 'R' && !old.is_empty()), ..WipEntry::default() });
        }
        if y != ' ' {
            files.push(WipEntry { path, status: status_letter(y).to_owned(), ..WipEntry::default() });
        }
    }
    if !stats || files.is_empty() {
        return Ok(files);
    }

    let (unstaged, staged) = tokio::join!(diff_numstat(cwd, &[]), diff_numstat(cwd, &["--cached"]));
    let untracked: Vec<usize> = files.iter().enumerate().filter(|(_, file)| file.untracked == Some(true)).map(|(index, _)| index).take(MAX_COUNTED_UNTRACKED).collect();
    let counts = join_all(untracked.iter().map(|index| count_lines(cwd.join(&files[*index].path)))).await;
    for (index, count) in untracked.into_iter().zip(counts) {
        files[index].additions = count;
        files[index].deletions = count.map(|_| 0);
    }
    for file in files.iter_mut().filter(|file| file.status != "U" && file.untracked != Some(true)) {
        let Some(stat) = (if file.staged { &staged } else { &unstaged }).get(&file.path) else {
            continue;
        };
        file.additions = stat.additions;
        file.deletions = stat.deletions;
        if let Some(old) = stat.old_path.as_ref().filter(|old| !old.is_empty() && file.old_path.is_none()) {
            file.old_path = Some(old.clone());
            file.status = "R".to_owned();
        }
        if file.old_path.is_some() {
            file.moved = Some(stat.additions == Some(0) && stat.deletions == Some(0));
        }
    }
    Ok(files)
}

/// Незавершённая операция: `rebase`, `merge`, `cherry-pick`, `revert` или `None`.
pub async fn detect_operation(cwd: &Path) -> Option<&'static str> {
    let out = git(cwd, &["rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply", "--git-path", "MERGE_HEAD", "--git-path", "CHERRY_PICK_HEAD", "--git-path", "REVERT_HEAD"]).await.unwrap_or_default();
    let paths: Vec<PathBuf> = out.split('\n').map(gorynych_core::js::trim).filter(|item| !item.is_empty()).map(|item| cwd.join(item)).collect();
    let exists = |index: usize| paths.get(index).is_some_and(|path| path.exists());
    if exists(0) || exists(1) {
        Some("rebase")
    } else if exists(2) {
        Some("merge")
    } else if exists(3) {
        Some("cherry-pick")
    } else if exists(4) {
        Some("revert")
    } else {
        None
    }
}

/// `quickStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickStatus {
    pub path: String,
    pub wip_files: Vec<WipEntry>,
    pub operation: Option<String>,
}

/// `quickStatus`: только статус файлов, для мгновенной реакции на правки.
pub async fn quick_status(dir: &Path) -> Result<QuickStatus> {
    let root = resolve_repo_root(dir).await?;
    let (wip, operation) = tokio::join!(read_status(&root, true), detect_operation(&root));
    Ok(QuickStatus { path: root.display().to_string(), wip_files: wip?, operation: operation.map(str::to_owned) })
}

/// `loadRepository`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub path: String,
    pub name: String,
    pub current_branch: Option<String>,
    pub detached: bool,
    pub operation: Option<String>,
    pub head_hash: Option<String>,
    pub local_branches: Vec<LocalBranch>,
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
    pub commits: Vec<Commit>,
    pub truncated: bool,
    pub wip_files: Vec<WipEntry>,
}

/// `loadRepository`; `limit: None` — 2000 коммитов.
pub async fn load_repository(dir: &Path, limit: Option<u32>) -> Result<Repository> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT);
    let root = resolve_repo_root(dir).await?;
    let refs = read_refs(&root).await?;
    let (commits, wip, head, operation) = tokio::join!(read_commits(&root, &refs, limit), read_status(&root, true), git(&root, &["rev-parse", "--verify", "--quiet", "HEAD"]), detect_operation(&root));
    let commits = commits?;
    let wip_files = wip?;
    let head_hash = head.ok().map(|out| gorynych_core::js::trim(&out).to_owned());
    Ok(Repository {
        path: root.display().to_string(),
        name: root.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        detached: refs.current_branch.is_none() && head_hash.as_deref().is_some_and(|hash| !hash.is_empty()),
        current_branch: refs.current_branch,
        operation: operation.map(str::to_owned),
        head_hash,
        local_branches: refs.local_branches,
        remotes: refs.remotes,
        tags: refs.tags,
        stashes: refs.stashes,
        truncated: commits.len() as u64 >= u64::from(limit),
        commits,
        wip_files,
    })
}

/* ---------- Файлы коммита и stash ---------- */

/// Файл коммита.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    #[specta(type = Option<f64>)]
    pub similarity: Option<u32>,
    #[specta(type = Option<f64>)]
    pub additions: Option<u64>,
    #[specta(type = Option<f64>)]
    pub deletions: Option<u64>,
    pub moved: Option<bool>,
    pub untracked: Option<bool>,
    pub diff_hash: Option<String>,
    pub diff_parent: Option<String>,
}

/// `getCommitFiles`.
pub async fn get_commit_files(dir: &Path, hash: &str, parent: Option<&str>) -> Result<Vec<CommitFile>> {
    let parent = parent.filter(|parent| !parent.is_empty());
    if !is_hash(hash) || parent.is_some_and(|parent| !is_hash(parent)) {
        return Err(GorynychError::unknown(t("Некорректный хэш коммита", &[])));
    }
    let range: [&str; 2] = match parent {
        Some(parent) => [parent, hash],
        None => ["--root", hash],
    };
    let base = ["diff-tree", "--no-commit-id", "-r", "-M", "-z", "--ignore-cr-at-eol"];
    let with = |flag: &'static str| {
        let mut args: Vec<&str> = base.to_vec();
        args.push(flag);
        args.extend_from_slice(&range);
        args
    };
    let (numstat_args, names_args) = (with("--numstat"), with("--name-status"));
    let (numstat, names) = tokio::join!(git(dir, &numstat_args), git(dir, &names_args));
    let (numstat, names) = (numstat?, names?);

    // --name-status -z: «M\0path\0» или «R100\0old\0new\0»
    let parts: Vec<&str> = names.split('\0').collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let code = parts[index];
        index += 1;
        let Some(letter) = code.chars().next() else {
            continue;
        };
        if letter == 'R' || letter == 'C' {
            let old = parts.get(index).map(|item| (*item).to_owned());
            let new = parts.get(index + 1).copied().unwrap_or_default().to_owned();
            index += 2;
            if letter == 'R' {
                files.push(CommitFile { path: new, old_path: old, status: "R".to_owned(), similarity: code[1..].parse().ok().filter(|value| *value != 0), ..CommitFile::default() });
            } else {
                files.push(CommitFile { path: new, status: "A".to_owned(), ..CommitFile::default() });
            }
        } else {
            let path = parts.get(index).copied().unwrap_or_default().to_owned();
            index += 1;
            files.push(CommitFile { path, status: status_letter(letter).to_owned(), ..CommitFile::default() });
        }
    }
    let stats = parse_numstat(&numstat);
    for file in &mut files {
        if let Some(stat) = stats.get(&file.path) {
            file.additions = stat.additions;
            file.deletions = stat.deletions;
        }
        if file.old_path.is_some() {
            file.moved = Some(file.similarity == Some(100) || (file.additions == Some(0) && file.deletions == Some(0)));
        }
    }
    Ok(files)
}

/// `getStashDetails`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct StashDetails {
    pub hash: String,
    pub base: Option<String>,
    pub untracked: Option<String>,
    pub files: Vec<CommitFile>,
    pub date: Option<String>,
    pub author: Option<String>,
    pub subject: String,
}

/// `getStashDetails`.
pub async fn get_stash_details(dir: &Path, hash: &str) -> Result<StashDetails> {
    if !is_hash(hash) {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный stash", &[])));
    }
    let listed = git(dir, &["rev-list", "--parents", "-n", "1", hash]).await?;
    let parents: Vec<&str> = gorynych_core::js::trim(&listed).split(' ').skip(1).collect();
    let base = parents.first().copied();
    let untracked = parents.get(2).copied();
    let mut files: Vec<CommitFile> = get_commit_files(dir, hash, base).await?.into_iter().map(|file| CommitFile { diff_hash: Some(hash.to_owned()), diff_parent: base.map(str::to_owned), ..file }).collect();
    if let Some(extra) = untracked {
        files.extend(get_commit_files(dir, extra, None).await?.into_iter().map(|file| CommitFile { status: "A".to_owned(), untracked: Some(true), diff_hash: Some(extra.to_owned()), ..file }));
    }
    let info = git(dir, &["log", "-1", "--format=%s%x1f%aI%x1f%an", hash]).await.unwrap_or_default();
    let mut fields = gorynych_core::js::trim(&info).split(FS);
    let subject = fields.next().unwrap_or_default().to_owned();
    let (date, author) = (non_empty(fields.next()), non_empty(fields.next()));
    Ok(StashDetails { hash: hash.to_owned(), base: base.map(str::to_owned), untracked: untracked.map(str::to_owned), files, date, author, subject })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_pattern() {
        assert!(is_hash("abcd"));
        assert!(is_hash("ABCDEF0123"));
        assert!(!is_hash("abc"));
        assert!(!is_hash("xyzt"));
        assert!(!is_hash(&"a".repeat(65)));
    }

    #[test]
    fn numstat_parts() {
        let stats = parse_numstat("1\t2\ta.txt\0-\t-\tb.bin\x000\t0\t\0old.txt\0new.txt\0");
        assert_eq!(stats["a.txt"], NumStat { additions: Some(1), deletions: Some(2), old_path: None });
        assert_eq!(stats["b.bin"], NumStat::default());
        assert_eq!(stats["new.txt"].old_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn decorations_order() {
        let local = HashSet::from(["main", "dev"]);
        let remote = HashSet::from(["origin/main".to_owned()]);
        let (refs, is_head) = parse_decorations("tag: v1, origin/main, dev, HEAD -> main, origin/HEAD, неизвестная", &local, &remote);
        assert!(is_head);
        let names: Vec<&str> = refs.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, ["main", "dev", "origin/main", "неизвестная", "v1"]);
    }
}
