//! Интерактивный rebase с предпросмотром. Перенос `electron/rebase.cjs`.
//!
//! ## Конспект
//! - План (`pick`, `reword`, `squash`, `fixup`, `drop` + порядок) сперва проигрывается в памяти: `git merge-tree` считает результат шага, `git commit-tree` создаёт коммиты. Рабочая папка, индекс и ветки не трогаются.
//! - `scope`: как сам `git rebase`: коммиты ветки, которых нет в upstream, без слияний и уже перенесённых изменений, от старых к новым. Больше 300 — `TOO_MANY`.
//! - `simulate`: коммит на своём месте переиспользуется как есть; результат без изменений пропускается (`reason: empty`), как у git. Конфликт останавливает проигрывание.
//! - `apply`: «Применить» лишь переводит ветку на посчитанный результат (`reset --keep`). Изменившаяся ветка — `PLAN_STALE`, задетые незакоммиченные правки — `DIRTY`.
//! - `start`: настоящий `git rebase -i`, когда конфликты нужно решать вручную. Редакторы подставляют список действий и новые сообщения. Сессия нужна и при «Продолжить» после конфликта.
//!
//! ## Отличия от 1.x
//! - Редактор git — не скрипт под `ELECTRON_RUN_AS_NODE`, а сам исполняемый файл с флагом `--internal-rebase-editor`, поэтому [`run_editor_helper`] стоит в начале `main`, рядом с `askpass::run_helper`. Логика та же.
//! - Как и везде в этом крейте, симуляция идёт через `git merge-tree`, а не `git2::merge_trees` из плана: поведение закреплено эталоном.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;
use gorynych_core::js;
use indexmap::IndexSet;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use crate::common::{commit_of, filled, fs_error, head_hash, lenient, or_undefined, quiet, sh_quote, succeeds, trimmed};
use crate::read::{CommitFile, detect_operation, get_commit_files, is_hash, read_status};
use crate::run::{FS, GitOptions, RS, git, git_with};

const MAX_COMMITS: usize = 300;
const EDITOR_FLAG: &str = "--internal-rebase-editor";

static TREE_HASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-f]{40,64}$").expect("корректный шаблон"));
static OLD_GIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)merge-base|write-tree|usage|unknown").expect("корректный шаблон"));
static DIRTY_TEXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)not uptodate|would be overwritten|cannot merge|local changes").expect("корректный шаблон"));

/// `mergeTreeChecked`: `merge-tree` уже срабатывал, значит Git достаточно новый.
static MERGE_TREE_CHECKED: AtomicBool = AtomicBool::new(false);

/// Автор коммита.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseAuthor {
    pub name: String,
    pub email: String,
    pub date: String,
}

#[derive(Debug, Clone)]
struct PlanCommit {
    hash: String,
    parents: Vec<String>,
    author: RebaseAuthor,
    message: String,
    subject: String,
}

/// Коммит в ответе.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseCommit {
    pub hash: String,
    pub subject: String,
    pub message: String,
    pub author: RebaseAuthor,
}

fn brief(commit: &PlanCommit) -> RebaseCommit {
    RebaseCommit { hash: commit.hash.clone(), subject: commit.subject.clone(), message: commit.message.clone(), author: commit.author.clone() }
}

async fn require_branch_state(cwd: &Path) -> Result<(String, String)> {
    if detect_operation(cwd).await.is_some() {
        return Err(GorynychError::new(ErrorCode::OperationInProgress, t("Сначала завершите текущую операцию (merge / rebase / cherry-pick)", &[])).with_hint(t("Продолжите или прервите её в жёлтой панели сверху.", &[])));
    }
    let Some(head) = head_hash(cwd).await else {
        return Err(GorynychError::new(ErrorCode::NoCommits, t("В репозитории ещё нет коммитов", &[])));
    };
    let branch = quiet(cwd, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await;
    if branch.is_empty() {
        return Err(GorynychError::new(ErrorCode::Detached, t("Rebase делается для ветки, а сейчас detached HEAD", &[])).with_hint(t("Переключитесь на ветку, историю которой хотите изменить.", &[])));
    }
    Ok((head, branch))
}

async fn resolve_commit(cwd: &Path, reference: Option<&str>, what: &str) -> Result<String> {
    let reference = reference.filter(|text| !js::trim(text).is_empty() && !text.starts_with('-')).ok_or_else(|| GorynychError::new(ErrorCode::BadArgs, t("Не указан {0}", &[&what])))?;
    commit_of(cwd, reference).await.ok_or_else(|| GorynychError::new(ErrorCode::NotFoundRef, t("Не найдено: {0}", &[&reference])))
}

fn read_commit_list(out: &str) -> Vec<PlanCommit> {
    out.split(RS)
        .map(|record| record.strip_prefix('\n').unwrap_or(record))
        .filter(|record| !record.is_empty())
        .map(|record| {
            let mut fields = record.split(FS);
            let mut next = || fields.next().unwrap_or_default();
            let (hash, parents, name, email, date, body) = (next(), next(), next(), next(), next(), next());
            let message = body.trim_end_matches(js::is_whitespace).to_owned();
            PlanCommit {
                hash: hash.to_owned(),
                parents: if parents.is_empty() { Vec::new() } else { parents.split(' ').map(str::to_owned).collect() },
                author: RebaseAuthor { name: name.to_owned(), email: email.to_owned(), date: date.to_owned() },
                subject: message.split('\n').next().unwrap_or_default().to_owned(),
                message,
            }
        })
        .collect()
}

fn log_format() -> String {
    format!("--format=%H{FS}%P{FS}%an{FS}%ae{FS}%aI{FS}%B{RS}")
}

async fn commit_info(cwd: &Path, hash: &str) -> Result<PlanCommit> {
    let out = git(cwd, &["log", "-1", &log_format(), hash]).await?;
    read_commit_list(&out).into_iter().next().ok_or_else(|| GorynychError::new(ErrorCode::NotFoundRef, t("Не найдено: {0}", &[&hash])))
}

struct Scope {
    head: String,
    branch: String,
    upstream: String,
    onto: String,
    commits: Vec<PlanCommit>,
    merges: u64,
    is_ancestor: bool,
}

async fn scope(cwd: &Path, upstream: Option<&str>, onto: Option<&str>) -> Result<Scope> {
    let (head, branch) = require_branch_state(cwd).await?;
    let what = t("коммит", &[]);
    let upstream = resolve_commit(cwd, upstream, &what).await?;
    let onto = match filled(onto) {
        Some(onto) => resolve_commit(cwd, Some(onto), &what).await?,
        None => upstream.clone(),
    };
    if upstream == head {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Это и есть последний коммит ветки — после него нечего менять", &[])));
    }
    let range = format!("{upstream}...{head}");
    let out = git(cwd, &["log", "--reverse", "--topo-order", "--no-merges", "--cherry-pick", "--right-only", &log_format(), &range]).await?;
    let commits = read_commit_list(&out);
    let merges = trimmed(cwd, &["rev-list", "--count", "--merges", &format!("{upstream}..{head}")]).await?.parse().unwrap_or(0);
    let is_ancestor = succeeds(cwd, &["merge-base", "--is-ancestor", &upstream, &head]).await;
    if commits.len() > MAX_COMMITS {
        return Err(GorynychError::new(ErrorCode::TooMany, t("Слишком много коммитов для rebase: {0}", &[&commits.len()])).with_hint(t("Выберите точку поближе (не больше {0} коммитов).", &[&MAX_COMMITS])));
    }
    Ok(Scope { head, branch, upstream, onto, commits, merges, is_ancestor })
}

async fn tree_of(cwd: &Path, commit: &str) -> Result<String> {
    trimmed(cwd, &["rev-parse", &format!("{commit}^{{tree}}")]).await
}

enum Merge {
    Clean(String),
    Conflict { files: Vec<String>, messages: Vec<String> },
}

/// Результат «cherry-pick» коммита `theirs` поверх `ours` в памяти. `base` — родитель переносимого коммита.
async fn merge_tree(cwd: &Path, base: &str, ours: &str, theirs: &str) -> Result<Merge> {
    let error = match git(cwd, &["merge-tree", "--write-tree", "--name-only", &format!("--merge-base={base}"), ours, theirs]).await {
        Ok(out) => {
            MERGE_TREE_CHECKED.store(true, Ordering::SeqCst);
            return Ok(Merge::Clean(js::trim(out.split('\n').next().unwrap_or_default()).to_owned()));
        }
        Err(error) => error,
    };
    let first = js::trim(error.stdout.split('\n').next().unwrap_or_default());
    if TREE_HASH.is_match(first) {
        // Конфликт: дальше идут имена файлов, пустая строка, затем пояснения git
        let rest = error.stdout.get(first.len() + 1..).unwrap_or_default();
        let mut parts = rest.split("\n\n");
        let (names, messages) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        let files: IndexSet<String> = names.split('\n').map(js::trim).filter(|item| !item.is_empty()).map(str::to_owned).collect();
        let messages = messages.split('\n').map(js::trim).filter(|item| !item.is_empty()).take(20).map(str::to_owned).collect();
        return Ok(Merge::Conflict { files: files.into_iter().collect(), messages });
    }
    if !MERGE_TREE_CHECKED.load(Ordering::SeqCst) && OLD_GIT.is_match(&error.details) {
        return Err(GorynychError::new(ErrorCode::GitTooOld, t("Для предпросмотра rebase нужен Git 2.40 или новее", &[])).with_hint(t("Обновите Git for Windows (git-scm.com) и перезапустите приложение.", &[])).with_details(error.details));
    }
    Err(error)
}

async fn commit_tree(cwd: &Path, tree: &str, parent: &str, author: &RebaseAuthor, message: &str) -> Result<String> {
    let env = [("GIT_AUTHOR_NAME", &author.name), ("GIT_AUTHOR_EMAIL", &author.email), ("GIT_AUTHOR_DATE", &author.date)].map(|(key, value)| (key.to_owned(), value.clone())).to_vec();
    let out = git_with(cwd, &["commit-tree", tree, "-p", parent, "-m", message], GitOptions { env, ..GitOptions::default() }).await?;
    Ok(js::trim(&out).to_owned())
}

/// Строка плана.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct PlanItem {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub action: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<String>)]
    pub message: Option<String>,
}

fn plan_stale() -> GorynychError {
    GorynychError::new(ErrorCode::PlanStale, t("План устарел — список коммитов изменился", &[])).with_hint(t("Откройте rebase заново.", &[]))
}

fn validate_plan(commits: &[PlanCommit], plan: Option<&[PlanItem]>) -> Result<()> {
    let plan = plan.filter(|plan| plan.len() == commits.len()).ok_or_else(plan_stale)?;
    let mut seen = IndexSet::new();
    for item in plan {
        let hash = item.hash.as_deref().unwrap_or_default();
        if !is_hash(hash) || !commits.iter().any(|commit| commit.hash == hash) || seen.contains(hash) {
            return Err(plan_stale());
        }
        if !matches!(item.action.as_deref(), Some("pick" | "reword" | "squash" | "fixup" | "drop")) {
            return Err(GorynychError::new(ErrorCode::BadArgs, t("Неизвестное действие: {0}", &[&item.action.as_deref().unwrap_or_default()])));
        }
        if item.message.as_deref().is_some_and(|text| js::trim(text).is_empty()) {
            return Err(GorynychError::new(ErrorCode::EmptyMessage, t("Сообщение коммита не может быть пустым", &[])));
        }
        seen.insert(hash);
    }
    if plan.iter().find(|item| item.action.as_deref() != Some("drop")).is_some_and(|item| matches!(item.action.as_deref(), Some("squash" | "fixup"))) {
        return Err(GorynychError::new(ErrorCode::BadPlan, t("Первый коммит не с чем объединить", &[])).with_hint(t("Squash и fixup присоединяют коммит к предыдущему — у самого первого предыдущего нет.", &[])));
    }
    Ok(())
}

struct Member<'a> {
    item: &'a PlanItem,
    commit: &'a PlanCommit,
}

/// Коммит и присоединённые к нему squash и fixup. Первый участник — голова группы.
struct Group<'a> {
    members: Vec<Member<'a>>,
}

impl Group<'_> {
    fn head(&self) -> &Member<'_> {
        &self.members[0]
    }

    fn has_squash(&self) -> bool {
        self.members[1..].iter().any(|member| member.item.action.as_deref() == Some("squash"))
    }

    /// `groupMessage`: явное (если пользователь его правил) или как сделал бы git.
    fn message(&self) -> String {
        let head = self.head();
        if let Some(text) = filled(head.item.message.as_deref()) {
            return text.trim_end_matches(js::is_whitespace).to_owned();
        }
        let mut parts = vec![head.commit.message.as_str()];
        parts.extend(self.members[1..].iter().filter(|member| member.item.action.as_deref() == Some("squash")).map(|member| member.commit.message.as_str()));
        parts.join("\n\n")
    }
}

fn groups_of<'a>(plan: &'a [PlanItem], commits: &'a [PlanCommit]) -> Vec<Group<'a>> {
    let mut groups: Vec<Group<'a>> = Vec::new();
    for item in plan {
        let action = item.action.as_deref();
        if action == Some("drop") {
            continue;
        }
        let commit = commits.iter().find(|commit| Some(commit.hash.as_str()) == item.hash.as_deref()).expect("план проверен");
        let member = Member { item, commit };
        match (action, groups.last_mut()) {
            (Some("squash" | "fixup"), Some(group)) => group.members.push(member),
            _ => groups.push(Group { members: vec![member] }),
        }
    }
    groups
}

/// Параметры `simulate` и `start`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default)]
pub struct RebaseRequest {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub upstream: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub onto: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<Vec<PlanItem>>)]
    pub plan: Option<Vec<PlanItem>>,
}

/// Коммит-результат.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseAfter {
    pub hash: String,
    pub subject: String,
    pub message: String,
    pub author: RebaseAuthor,
    pub action: String,
    pub origs: Vec<String>,
    pub reused: bool,
}

/// Пропущенный коммит.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseSkipped {
    #[serde(flatten)]
    pub commit: RebaseCommit,
    pub reason: String,
}

/// Конфликт в симуляции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseConflict {
    #[serde(flatten)]
    pub commit: RebaseCommit,
    pub action: Option<String>,
    pub files: Vec<String>,
    pub messages: Vec<String>,
    #[specta(type = f64)]
    pub index: usize,
}

/// Результат `simulate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RebasePreview {
    pub branch: String,
    pub old_head: String,
    pub upstream: RebaseCommit,
    pub onto: RebaseCommit,
    pub interactive_from_ancestor: bool,
    #[specta(type = f64)]
    pub merges: u64,
    pub before: Vec<RebaseCommit>,
    pub plan: Vec<PlanItem>,
    pub ok: bool,
    pub conflict: Option<RebaseConflict>,
    pub after: Vec<RebaseAfter>,
    pub skipped: Vec<RebaseSkipped>,
    pub new_head: Option<String>,
    pub unchanged: bool,
    pub diff: Option<Vec<CommitFile>>,
    pub identical_files: Option<bool>,
    #[specta(type = f64)]
    pub pushed: usize,
    #[specta(type = f64)]
    pub dirty: usize,
}

async fn count_pushed(cwd: &Path, hashes: &[&str]) -> Result<usize> {
    if hashes.is_empty() {
        return Ok(0);
    }
    if js::trim(&git(cwd, &["for-each-ref", "--format=%(objectname)", "refs/remotes"]).await?).is_empty() {
        return Ok(0);
    }
    let mut args = vec!["rev-list", "--no-walk=unsorted"];
    args.extend_from_slice(hashes);
    args.extend(["--not", "--remotes"]);
    let out = git(cwd, &args).await.unwrap_or_default();
    let unpushed: IndexSet<&str> = out.split('\n').filter(|line| !line.is_empty()).collect();
    Ok(hashes.iter().filter(|hash| !unpushed.contains(*hash)).count())
}

/// `simulate`.
pub async fn simulate(cwd: &Path, request: &RebaseRequest) -> Result<RebasePreview> {
    let sc = scope(cwd, request.upstream.as_deref(), request.onto.as_deref()).await?;
    let plan = request.plan.clone().unwrap_or_else(|| sc.commits.iter().map(|commit| PlanItem { hash: Some(commit.hash.clone()), action: Some("pick".to_owned()), message: None }).collect());
    validate_plan(&sc.commits, Some(&plan))?;
    let groups = groups_of(&plan, &sc.commits);

    let find = |hash: &Option<String>| sc.commits.iter().find(|commit| Some(&commit.hash) == hash.as_ref()).expect("план проверен");
    let mut after = Vec::new();
    let mut skipped: Vec<RebaseSkipped> = plan.iter().filter(|item| item.action.as_deref() == Some("drop")).map(|item| RebaseSkipped { commit: brief(find(&item.hash)), reason: "drop".to_owned() }).collect();
    let mut cur = sc.onto.clone();
    let mut conflict = None;

    'groups: for group in &groups {
        let base = cur.clone();
        let mut work = base.clone();
        let mut tree: Option<String> = None;
        let last = group.members.len() - 1;
        for (index, Member { item, commit }) in group.members.iter().enumerate() {
            let Some(parent) = commit.parents.first() else {
                return Err(GorynychError::new(ErrorCode::RootCommit, t("Нельзя перенести самый первый коммит репозитория", &[])));
            };
            // Коммит остаётся на своём месте без изменений: git переиспользует его как есть
            if group.members.len() == 1 && item.action.as_deref() != Some("reword") && filled(item.message.as_deref()).is_none() && *parent == work {
                tree = None;
                work.clone_from(&commit.hash);
                break;
            }
            match merge_tree(cwd, parent, &work, &commit.hash).await? {
                Merge::Conflict { files, messages } => {
                    let index = plan.iter().position(|step| step.hash.as_deref() == Some(&commit.hash)).unwrap_or(0);
                    conflict = Some(RebaseConflict { commit: brief(commit), action: item.action.clone(), files, messages, index });
                    break 'groups;
                }
                Merge::Clean(result) => {
                    // Промежуточный коммит нужен только как «ours» для следующего шага группы
                    if index < last {
                        work = commit_tree(cwd, &result, &base, &commit.author, "squash step").await?;
                    }
                    tree = Some(result);
                }
            }
        }

        let head = group.head();
        let Some(tree) = tree else {
            // Переиспользован исходный коммит
            let commit = brief(head.commit);
            after.push(RebaseAfter { hash: commit.hash.clone(), subject: commit.subject, message: commit.message, author: commit.author, action: "pick".to_owned(), origs: vec![commit.hash], reused: true });
            cur = work;
            continue;
        };
        if tree == tree_of(cwd, &base).await? {
            // Изменения уже есть в новой основе: git такой коммит пропускает
            skipped.extend(group.members.iter().map(|member| RebaseSkipped { commit: brief(member.commit), reason: "empty".to_owned() }));
            continue;
        }
        let message = group.message();
        let hash = commit_tree(cwd, &tree, &base, &head.commit.author, &message).await?;
        let action = if group.members.len() > 1 {
            if group.has_squash() { "squash".to_owned() } else { "fixup".to_owned() }
        } else {
            head.item.action.clone().unwrap_or_default()
        };
        after.push(RebaseAfter {
            hash: hash.clone(),
            subject: message.split('\n').next().unwrap_or_default().to_owned(),
            message,
            author: head.commit.author.clone(),
            action,
            origs: group.members.iter().map(|member| member.commit.hash.clone()).collect(),
            reused: false,
        });
        cur = hash;
    }

    let ok = conflict.is_none();
    let (diff, identical_files) = if ok {
        let diff = if cur == sc.head { Vec::new() } else { get_commit_files(cwd, &cur, Some(&sc.head)).await? };
        (Some(diff), Some(tree_of(cwd, &cur).await? == tree_of(cwd, &sc.head).await?))
    } else {
        (None, None)
    };
    // Переписанные коммиты, которые уже есть на сервере: после rebase понадобится force push
    let rewritten: Vec<&str> = sc.commits.iter().filter(|commit| !after.iter().any(|item| item.reused && item.hash == commit.hash)).map(|commit| commit.hash.as_str()).collect();
    let pushed = count_pushed(cwd, &rewritten).await?;
    let dirty = read_status(cwd, false).await?.iter().filter(|file| file.untracked != Some(true)).count();
    Ok(RebasePreview {
        upstream: brief(&commit_info(cwd, &sc.upstream).await?),
        onto: brief(&commit_info(cwd, &sc.onto).await?),
        interactive_from_ancestor: sc.is_ancestor && sc.onto == sc.upstream,
        merges: sc.merges,
        before: sc.commits.iter().map(brief).collect(),
        plan: plan.clone(),
        ok,
        conflict,
        after,
        skipped,
        new_head: ok.then(|| cur.clone()),
        unchanged: ok && cur == sc.head,
        diff,
        identical_files,
        pushed,
        dirty,
        branch: sc.branch,
        old_head: sc.head,
    })
}

/// Параметры `apply`.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct RebaseApply {
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub old_head: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub new_head: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub branch: Option<String>,
    #[serde(deserialize_with = "lenient")]
    #[specta(type = Option<String>)]
    pub onto: Option<String>,
}

/// Результат `apply` и `start`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RebaseDone {
    pub branch: String,
    pub from: String,
    pub to: Option<String>,
}

/// `apply`: перевести ветку на посчитанный результат.
pub async fn apply(cwd: &Path, request: &RebaseApply) -> Result<RebaseDone> {
    let bad = || GorynychError::new(ErrorCode::BadArgs, t("Некорректный предпросмотр", &[]));
    let hash = |value: &Option<String>| value.as_deref().filter(|text| is_hash(text)).map(str::to_owned);
    let (old_head, new_head, onto) = (hash(&request.old_head).ok_or_else(bad)?, hash(&request.new_head).ok_or_else(bad)?, hash(&request.onto).ok_or_else(bad)?);
    let (head, branch) = require_branch_state(cwd).await?;
    if head != old_head || Some(&branch) != request.branch.as_ref() {
        return Err(GorynychError::new(ErrorCode::PlanStale, t("Ветка изменилась после предпросмотра", &[])).with_hint(t("Предпросмотр обновится — проверьте его и примените снова.", &[])));
    }
    if new_head == old_head {
        return Err(GorynychError::new(ErrorCode::UpToDate, t("Ничего не меняется", &[])));
    }
    // Результат должен быть посчитан поверх выбранной основы
    if !succeeds(cwd, &["merge-base", "--is-ancestor", &onto, &new_head]).await {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Некорректный результат предпросмотра", &[])));
    }
    // --keep переносит ветку и обновляет файлы, но не трогает несвязанные локальные правки
    let env = vec![("GIT_REFLOG_ACTION".to_owned(), t("rebase (предпросмотр): {0}", &[&branch]))];
    if let Err(error) = git_with(cwd, &["reset", "--keep", &new_head], GitOptions { env, ..GitOptions::default() }).await {
        if DIRTY_TEXT.is_match(&error.details) {
            return Err(GorynychError::new(ErrorCode::Dirty, t("Незакоммиченные правки в файлах, которые меняет rebase", &[])).with_hint(t("Закоммитьте их или сделайте Stash, затем примените rebase.", &[])).with_details(error.details));
        }
        return Err(error);
    }
    let _ = git(cwd, &["update-ref", "ORIG_HEAD", &old_head]).await;
    Ok(RebaseDone { branch, from: old_head, to: Some(new_head) })
}

#[derive(Debug, Serialize, Deserialize)]
struct EditorMessage {
    r#match: String,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct EditorData {
    todo: String,
    messages: Vec<EditorMessage>,
}

fn editor_run(mode: &str, data_file: &Path, target: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut data: EditorData = serde_json::from_slice(&std::fs::read(data_file)?)?;
    if mode == "todo" {
        std::fs::write(target, data.todo)?;
        return Ok(());
    }
    let text = String::from_utf8_lossy(&std::fs::read(target)?).into_owned();
    let lines: Vec<&str> = text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).filter(|line| !line.starts_with('#')).collect();
    let joined = lines.join("\n");
    let plain = js::trim(&joined);
    let found = data.messages.iter().position(|item| plain == item.r#match || plain.starts_with(&format!("{}\n", item.r#match)));
    if let Some(index) = found {
        std::fs::write(target, format!("{}\n", data.messages[index].message))?;
        // Одинаковые сообщения у разных коммитов: по очереди
        data.messages.remove(index);
        std::fs::write(data_file, serde_json::to_vec(&data)?)?;
    }
    Ok(())
}

/// Режим редактора для git. Вызывать первой строкой `main`: `Some(код)` означает, что процесс запущен как редактор и должен завершиться.
pub fn run_editor_helper() -> Option<i32> {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.get(1).is_none_or(|flag| flag != EDITOR_FLAG) {
        return None;
    }
    let (Some(mode), Some(data), Some(target)) = (args.get(2), args.get(3), args.get(4)) else {
        return Some(2);
    };
    Some(i32::from(editor_run(&mode.to_string_lossy(), Path::new(data), Path::new(target)).is_err()))
}

struct Session {
    _dir: TempDir,
    env: Vec<(String, String)>,
}

/// Сессии настоящего `git rebase -i`: нужны и при «Продолжить» после конфликта.
pub struct RebaseSessions {
    helper: PathBuf,
    sessions: Mutex<HashMap<PathBuf, Session>>,
}

impl RebaseSessions {
    /// `helper` — исполняемый файл, вызывающий [`run_editor_helper`] в начале `main`.
    pub fn new(helper: impl Into<PathBuf>) -> Self {
        Self { helper: helper.into(), sessions: Mutex::default() }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Session>> {
        self.sessions.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn editor_env(&self, data: &Path) -> Vec<(String, String)> {
        let exe = sh_quote(&self.helper.to_string_lossy());
        let data = sh_quote(&data.to_string_lossy());
        vec![("GIT_SEQUENCE_EDITOR".to_owned(), format!("{exe} {EDITOR_FLAG} todo {data}")), ("GIT_EDITOR".to_owned(), format!("{exe} {EDITOR_FLAG} msg {data}"))]
    }

    /// `continueEnv`: окружение для `git rebase --continue`, чтобы reword и squash после конфликта получили нужные сообщения.
    pub fn continue_env(&self, cwd: &Path) -> Option<Vec<(String, String)>> {
        self.lock().get(cwd).map(|session| session.env.clone())
    }

    /// `cleanup`.
    pub fn cleanup(&self, cwd: &Path) {
        self.lock().remove(cwd);
    }

    /// `start`: настоящий `git rebase -i`.
    pub async fn start(&self, cwd: &Path, request: &RebaseRequest) -> Result<RebaseDone> {
        let sc = scope(cwd, request.upstream.as_deref(), request.onto.as_deref()).await?;
        validate_plan(&sc.commits, request.plan.as_deref())?;
        let plan = request.plan.as_deref().unwrap_or_default();

        let (mut lines, mut messages) = (Vec::new(), Vec::new());
        for group in groups_of(plan, &sc.commits) {
            let head = group.head();
            let custom = filled(head.item.message.as_deref()).is_some() || (head.item.action.as_deref() == Some("reword") && !head.commit.message.is_empty());
            let has_squash = group.has_squash();
            // Новое сообщение спрашивается редактором в конце группы: reword (без squash) или последний squash
            lines.push(format!("{} {}", if custom && !has_squash { "reword" } else { "pick" }, head.commit.hash));
            for member in &group.members[1..] {
                lines.push(format!("{} {}", if member.item.action.as_deref() == Some("squash") { "squash" } else { "fixup" }, member.commit.hash));
            }
            if custom || has_squash {
                messages.push(EditorMessage { r#match: js::trim(&head.commit.message).to_owned(), message: group.message() });
            }
        }
        lines.extend(plan.iter().filter(|item| item.action.as_deref() == Some("drop")).map(|item| format!("drop {}", or_undefined(item.hash.as_deref()))));

        let dir = tempfile::Builder::new().prefix("gk-rebase-").tempdir().map_err(fs_error)?;
        let data_file = dir.path().join("plan.json");
        let data = EditorData { todo: format!("{}\n", lines.join("\n")), messages };
        std::fs::write(&data_file, serde_json::to_vec(&data).map_err(GorynychError::unknown)?).map_err(fs_error)?;
        let env = self.editor_env(&data_file);
        self.lock().insert(cwd.to_path_buf(), Session { _dir: dir, env: env.clone() });

        let mut args = vec!["rebase", "-i", "--empty=drop", "--no-autosquash"];
        if sc.onto != sc.upstream {
            args.extend(["--onto", &sc.onto]);
        }
        args.push(&sc.upstream);
        let mut run_env = env;
        run_env.push(("GIT_REFLOG_ACTION".to_owned(), "rebase (interactive)".to_owned()));
        if let Err(error) = git_with(cwd, &args, GitOptions { env: run_env, ..GitOptions::default() }).await {
            if detect_operation(cwd).await.is_some() {
                return Err(GorynychError::new(ErrorCode::Conflict, t("Rebase остановился на конфликте", &[]))
                    .with_hint(t("Разрешите конфликты в файлах и нажмите «Продолжить» в жёлтой панели сверху. «Прервать» вернёт всё как было.", &[]))
                    .with_details(error.details));
            }
            self.cleanup(cwd);
            return Err(error);
        }
        self.cleanup(cwd);
        Ok(RebaseDone { branch: sc.branch, from: sc.head, to: head_hash(cwd).await })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(hash: &str) -> PlanCommit {
        PlanCommit { hash: hash.to_owned(), parents: vec![], author: RebaseAuthor { name: String::new(), email: String::new(), date: String::new() }, message: "m".to_owned(), subject: "m".to_owned() }
    }

    fn item(hash: &str, action: &str) -> PlanItem {
        PlanItem { hash: Some(hash.to_owned()), action: Some(action.to_owned()), message: None }
    }

    #[test]
    fn plan_checks() {
        let commits = [commit("aaaa"), commit("bbbb")];
        let code = |plan: &[PlanItem]| validate_plan(&commits, Some(plan)).unwrap_err().code;
        assert_eq!(validate_plan(&commits, None).unwrap_err().code, ErrorCode::PlanStale);
        assert_eq!(code(&[item("aaaa", "pick")]), ErrorCode::PlanStale);
        assert_eq!(code(&[item("aaaa", "pick"), item("aaaa", "pick")]), ErrorCode::PlanStale);
        assert_eq!(code(&[item("aaaa", "pick"), item("cccc", "pick")]), ErrorCode::PlanStale);
        assert_eq!(code(&[item("aaaa", "x"), item("bbbb", "pick")]), ErrorCode::BadArgs);
        assert_eq!(code(&[item("aaaa", "drop"), item("bbbb", "fixup")]), ErrorCode::BadPlan);
        let empty = PlanItem { message: Some("  ".to_owned()), ..item("aaaa", "reword") };
        assert_eq!(code(&[empty, item("bbbb", "pick")]), ErrorCode::EmptyMessage);
        assert!(validate_plan(&commits, Some(&[item("bbbb", "pick"), item("aaaa", "squash")])).is_ok());
    }

    #[test]
    fn message_of_a_group() {
        let (a, b, c) = (PlanCommit { message: "A".into(), ..commit("aaaa") }, PlanCommit { message: "B".into(), ..commit("bbbb") }, PlanCommit { message: "C".into(), ..commit("cccc") });
        let (commits, plan) = ([a, b, c], [item("aaaa", "pick"), item("bbbb", "squash"), item("cccc", "fixup")]);
        let groups = groups_of(&plan, &commits);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].message(), "A\n\nB");
        let plan = [PlanItem { message: Some("Новое \n".into()), ..item("aaaa", "pick") }, item("bbbb", "squash"), item("cccc", "pick")];
        assert_eq!(groups_of(&plan, &commits)[0].message(), "Новое");
    }

    #[test]
    fn commit_list_keeps_multiline_body() {
        let text = format!("h{FS}p1 p2{FS}a{FS}e{FS}d{FS}Тема\n\nТело\n \n{RS}\nh2{FS}{FS}a{FS}e{FS}d{FS}T{RS}\n");
        let list = read_commit_list(&text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].parents, ["p1", "p2"]);
        assert_eq!(list[0].message, "Тема\n\nТело");
        assert_eq!(list[0].subject, "Тема");
        assert!(list[1].parents.is_empty());
    }

    #[test]
    fn editor_writes_todo_and_messages_in_turn() {
        let dir = tempfile::tempdir().unwrap();
        let (data, target) = (dir.path().join("plan.json"), dir.path().join("MSG"));
        let plan = EditorData { todo: "pick a\n".into(), messages: vec![EditorMessage { r#match: "Тема".into(), message: "Первое".into() }, EditorMessage { r#match: "Тема".into(), message: "Второе".into() }] };
        std::fs::write(&data, serde_json::to_vec(&plan).unwrap()).unwrap();

        editor_run("todo", &data, &target).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "pick a\n");

        for want in ["Первое\n", "Второе\n"] {
            std::fs::write(&target, "# комментарий\r\nТема\r\nещё строка\r\n").unwrap();
            editor_run("msg", &data, &target).unwrap();
            assert_eq!(std::fs::read_to_string(&target).unwrap(), want);
        }
        // Сообщения кончились: файл не меняется
        std::fs::write(&target, "Тема\n").unwrap();
        editor_run("msg", &data, &target).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "Тема\n");
    }
}
