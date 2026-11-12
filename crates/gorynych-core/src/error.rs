//! Ошибки и классификатор stderr git. Перенос `electron/errors.cjs`.
//!
//! # Конспект исходника
//! - `GitError { message, code='GIT', hint=null, details='', stdout='', data=null }`;
//!   `toJSON()` → `{code, message, hint, details, data?}`: `stdout` не сериализуется, `data` — только если задан.
//! - `classify(stderr, stdout)` ищет в `${stderr}\n${stdout}`; 11 правил (все `/i`), побеждает первое **по порядку
//!   правил**, а не по месту в тексте. Поэтому [`RegexSet`] даёт минимальный индекс.
//! - `fromProcessError`: `ENOENT` → `GIT_MISSING` (без details); `killed` → `TIMEOUT`; правило → его code/message/hint;
//!   иначе `GIT`: первая непустая строка details без префикса `fatal:|error:` (нет такой — «Ошибка Git»).
//!   `details = (stderr || error.message || '').trim()`. Строка берётся без trim: хвостовой `\r` остаётся, как в 1.x.
//! - `serializeError(не GitError)` → `{code:'UNKNOWN', message, hint:null, details:''}` — см. [`GorynychError::unknown`].
//! - Единственная структура `data` — `WIP_CONFLICT` из `actions.cjs::inspectWip`, см. [`WipConflict`].
//!
//! # Отличия регулярных выражений от JS
//! - `.` в JS не совпадает ещё и с `\r`, U+2028, U+2029 — в шаблоне это выписано явно ([`JS_DOT`]).
//! - `trim` и `\s` в JS и Rust различаются (U+FEFF, U+0085) — используется [`crate::js`].
//! - **Известное расхождение:** Unicode-флаг `(?i)` в `regex` дополнительно сближает `s`/`ſ` (U+017F) и `k`/`K` (U+212A),
//!   а `/i` в JS — нет. В выводе git этих символов в ключевых словах не бывает.
//! - Код `BUSY` создаётся только в UI (`App.jsx`) и в [`ErrorCode`] не входит.

use std::sync::LazyLock;

use regex::{Regex, RegexSet};
use serde::{Deserialize, Serialize};

use crate::i18n::{Language, translate, tr};
use crate::js::{is_whitespace as is_js_whitespace, trim as js_trim};

macro_rules! error_codes {
    ($($variant:ident => $wire:literal,)+) => {
        /// Код ошибки на проводе — ровно те же строки, что в 1.x: UI сравнивает `error.code === '…'`.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
        pub enum ErrorCode {
            $(#[serde(rename = $wire)] $variant,)+
        }

        impl ErrorCode {
            pub const ALL: &'static [ErrorCode] = &[$(ErrorCode::$variant,)+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(ErrorCode::$variant => $wire,)+
                }
            }
        }
    };
}

error_codes! {
    AlreadyInBranch => "ALREADY_IN_BRANCH",
    AlreadyRepo => "ALREADY_REPO",
    ApiError => "API_ERROR",
    Auth => "AUTH",
    BadArgs => "BAD_ARGS",
    BadEmail => "BAD_EMAIL",
    BadPlan => "BAD_PLAN",
    BadRemote => "BAD_REMOTE",
    Binary => "BINARY",
    BranchExists => "BRANCH_EXISTS",
    BranchInUse => "BRANCH_IN_USE",
    Cancelled => "CANCELLED",
    ChangedOnDisk => "CHANGED_ON_DISK",
    Conflict => "CONFLICT",
    CurrentBranch => "CURRENT_BRANCH",
    DefaultBranch => "DEFAULT_BRANCH",
    Detached => "DETACHED",
    Dirty => "DIRTY",
    Diverged => "DIVERGED",
    Docker => "DOCKER",
    EmptyMessage => "EMPTY_MESSAGE",
    Exists => "EXISTS",
    Forbidden => "FORBIDDEN",
    Git => "GIT",
    GitlabError => "GITLAB_ERROR",
    GitMissing => "GIT_MISSING",
    GitTooOld => "GIT_TOO_OLD",
    HistoryEmpty => "HISTORY_EMPTY",
    HistoryPushed => "HISTORY_PUSHED",
    HistoryRoot => "HISTORY_ROOT",
    HistoryStale => "HISTORY_STALE",
    HookDeclined => "HOOK_DECLINED",
    HostKey => "HOST_KEY",
    HunkStale => "HUNK_STALE",
    InvalidName => "INVALID_NAME",
    JobExists => "JOB_EXISTS",
    KeygenFailed => "KEYGEN_FAILED",
    LocalChanges => "LOCAL_CHANGES",
    MarkersLeft => "MARKERS_LEFT",
    Network => "NETWORK",
    NothingToDiscard => "NOTHING_TO_DISCARD",
    NothingToStash => "NOTHING_TO_STASH",
    NotADir => "NOT_A_DIR",
    NotARepo => "NOT_A_REPO",
    NotFastForward => "NOT_FAST_FORWARD",
    NotFound => "NOT_FOUND",
    NotFoundPath => "NOT_FOUND_PATH",
    NotFoundRef => "NOT_FOUND_REF",
    NotGitlab => "NOT_GITLAB",
    NotMerged => "NOT_MERGED",
    NoCommits => "NO_COMMITS",
    NoDocker => "NO_DOCKER",
    NoEncryption => "NO_ENCRYPTION",
    NoIdentity => "NO_IDENTITY",
    NoOperation => "NO_OPERATION",
    NoProvider => "NO_PROVIDER",
    NoRemote => "NO_REMOTE",
    NoSshKeygen => "NO_SSH_KEYGEN",
    NoStash => "NO_STASH",
    NoStorage => "NO_STORAGE",
    NoTerminal => "NO_TERMINAL",
    NoToken => "NO_TOKEN",
    NoUpstream => "NO_UPSTREAM",
    OpenFailed => "OPEN_FAILED",
    OperationInProgress => "OPERATION_IN_PROGRESS",
    PatchFailed => "PATCH_FAILED",
    PlanStale => "PLAN_STALE",
    Protected => "PROTECTED",
    RateLimit => "RATE_LIMIT",
    RejectedNonFf => "REJECTED_NON_FF",
    RootCommit => "ROOT_COMMIT",
    StageExists => "STAGE_EXISTS",
    StageNotEmpty => "STAGE_NOT_EMPTY",
    TagExists => "TAG_EXISTS",
    TargetExists => "TARGET_EXISTS",
    Timeout => "TIMEOUT",
    TooLarge => "TOO_LARGE",
    TooMany => "TOO_MANY",
    Unknown => "UNKNOWN",
    Unsupported => "UNSUPPORTED",
    UpstreamGone => "UPSTREAM_GONE",
    UpToDate => "UP_TO_DATE",
    Validation => "VALIDATION",
    WipConflict => "WIP_CONFLICT",
    YamlError => "YAML_ERROR",
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Файл из подробностей `WIP_CONFLICT`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct WipFile {
    pub path: String,
    pub status: String,
    pub untracked: bool,
    pub staged: bool,
}

/// Подробности `WIP_CONFLICT`: незакоммиченные изменения мешают переключиться.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct WipConflict {
    pub from: Option<String>,
    /// В 1.x при отсутствии имени поле не попадает в JSON (`undefined`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub files: u32,
    /// Не больше 50 записей.
    pub list: Vec<WipFile>,
    pub untracked: u32,
    pub conflicted: Vec<String>,
    /// Не больше 50 путей: файлы, изменённые и в целевой ветке.
    pub overlap: Vec<String>,
    pub detached: bool,
}

/// Структурированные подробности ошибки. На проводе — сама структура, без обёртки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum ErrorData {
    WipConflict(WipConflict),
}

/// Ошибка, пересекающая IPC. JSON совпадает с `GitError.toJSON()` из 1.x.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, specta::Type)]
#[error("{message}")]
pub struct GorynychError {
    pub code: ErrorCode,
    pub message: String,
    pub hint: Option<String>,
    pub details: String,
    /// Только для кода, который разбирает вывод упавшей команды. В UI не передаётся.
    #[serde(skip)]
    pub stdout: String,
    /// В `Box`: данные редки и большие, а `Result` с этой ошибкой возвращает почти каждая функция.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Box<ErrorData>>,
}

pub type Result<T, E = GorynychError> = std::result::Result<T, E>;

impl GorynychError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            hint: None,
            details: String::new(),
            stdout: String::new(),
            data: None,
        }
    }

    /// Ошибка не из домена git — аналог ветки `UNKNOWN` в `serializeError`.
    pub fn unknown(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::Unknown, error.to_string())
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = details.into();
        self
    }

    pub fn with_stdout(mut self, stdout: impl Into<String>) -> Self {
        self.stdout = stdout.into();
        self
    }

    pub fn with_data(mut self, data: ErrorData) -> Self {
        self.data = Some(Box::new(data));
        self
    }
}

/// Правило классификатора.
#[derive(Debug)]
pub struct Rule {
    pub code: ErrorCode,
    /// Ключ Fluent: сообщение `error-…` и подсказка `error-…-hint` (в 1.x подсказка `AUTH` склеивалась из двух
    /// переводимых частей, в `main.ftl` она записана целиком). Тексты сверяет эталон `tests/parity.rs` (`classify`).
    pub fluent_id: &'static str,
}

impl Rule {
    pub fn message(&self, language: Language) -> String {
        translate(language, self.fluent_id).to_owned()
    }

    pub fn hint(&self, language: Language) -> String {
        translate(language, &format!("{}-hint", self.fluent_id)).to_owned()
    }
}

/// Аналог `.` из JS без флага `s`.
const JS_DOT: &str = r"[^\n\r\x{2028}\x{2029}]";

/// Порядок значим: более конкретные шаблоны идут раньше общих.
static RULES: [(Rule, &str); 11] = [
    (
        Rule {
            code: ErrorCode::Protected,
            fluent_id: "error-protected",
        },
        r"protected branch|GH006|GH013|not allowed to (push|force push) (code )?to protected|cannot force-push to a protected|push declined due to repository rule|branch is protected",
    ),
    (
        Rule {
            code: ErrorCode::HookDeclined,
            fluent_id: "error-hook-declined",
        },
        r"pre-receive hook declined|hook declined",
    ),
    (
        Rule {
            code: ErrorCode::Forbidden,
            fluent_id: "error-forbidden",
        },
        r"The requested URL returned error: 403|Permission to \S+ denied|You don't have permission|write access to repository not granted|not allowed to push|insufficient permission|HTTP 403|access forbidden|You are not allowed to push",
    ),
    (
        Rule {
            code: ErrorCode::HostKey,
            fluent_id: "error-host-key",
        },
        r"Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED",
    ),
    (
        Rule {
            code: ErrorCode::Auth,
            fluent_id: "error-auth",
        },
        r"Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or password|HTTP Basic: Access denied|Permission denied \(publickey|returned error: 401|Bad credentials|invalid credentials|logon failed|unable to get password|SSH_AUTH_SOCK|passphrase",
    ),
    (
        Rule {
            code: ErrorCode::NotFound,
            fluent_id: "error-not-found",
        },
        r"Repository not found|does not appear to be a git repository|repository '{DOT}*' not found|returned error: 404|project you were looking for could not be found|No such remote",
    ),
    (
        Rule {
            code: ErrorCode::RejectedNonFf,
            fluent_id: "error-rejected-non-ff",
        },
        r"\[rejected\]{DOT}*(non-fast-forward|fetch first)|Updates were rejected because|stale info|\[rejected\]",
    ),
    (
        Rule {
            code: ErrorCode::Diverged,
            fluent_id: "error-diverged",
        },
        r"Not possible to fast-forward|diverging branches|Need to specify how to reconcile",
    ),
    (
        Rule {
            code: ErrorCode::Conflict,
            fluent_id: "error-conflict",
        },
        r"CONFLICT|Automatic merge failed|could not apply|Merge conflict|fix conflicts",
    ),
    (
        Rule {
            code: ErrorCode::Dirty,
            fluent_id: "error-dirty",
        },
        r"would be overwritten|Please commit your changes or stash them|cannot (pull|rebase) with uncommitted|You have unstaged changes|contains uncommitted changes",
    ),
    (
        Rule {
            code: ErrorCode::Network,
            fluent_id: "error-network",
        },
        r"Could not resolve host|Failed to connect|Connection (timed out|refused|reset)|Network is unreachable|unable to access|Operation timed out|SSL|TLS|early EOF|The remote end hung up|Could not read from remote repository",
    ),
];

static RULE_SET: LazyLock<RegexSet> = LazyLock::new(|| {
    let patterns = RULES
        .iter()
        .map(|(_, pattern)| format!("(?i){}", pattern.replace("{DOT}", JS_DOT)));
    RegexSet::new(patterns).expect("корректные шаблоны правил")
});

/// Ищет правило для вывода git. Первое совпавшее по порядку правил выигрывает.
pub fn classify(stderr: &str, stdout: &str) -> Option<&'static Rule> {
    let text = format!("{stderr}\n{stdout}");
    let index = RULE_SET.matches(&text).iter().next()?;
    Some(&RULES[index].0)
}

/// Все правила в порядке проверки.
pub fn rules() -> impl Iterator<Item = &'static Rule> {
    RULES.iter().map(|(rule, _)| rule)
}

/// Как завершился процесс git. Заменяет поля `error.code` и `error.killed` из Node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessFailure<'a> {
    /// Исполняемый файл не найден (`ENOENT`).
    NotFound,
    /// Процесс снят по таймауту; `message` — текст ошибки запуска.
    TimedOut { message: &'a str },
    /// Процесс завершился с ошибкой.
    Exited { message: &'a str },
}

static LEADING_LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:fatal|error):").expect("корректный шаблон"));

/// Строит ошибку по завершению процесса git и его выводу.
pub fn from_process_error(failure: ProcessFailure<'_>, stdout: &str, stderr: &str, language: Language) -> GorynychError {
    let message = match failure {
        ProcessFailure::NotFound => {
            let hint = format!(
                "{}{}",
                translate(language, "install-git-for-windows-git"),
                translate(language, "app-was-started-from-and"),
            );
            return GorynychError::new(ErrorCode::GitMissing, tr(language, "git-not-found", &[])).with_hint(hint);
        }
        ProcessFailure::TimedOut { message } | ProcessFailure::Exited { message } => message,
    };

    let details = js_trim(if stderr.is_empty() { message } else { stderr });

    if matches!(failure, ProcessFailure::TimedOut { .. }) {
        return GorynychError::new(ErrorCode::Timeout, tr(language, "operation-timed-out", &[]))
            .with_hint(tr(language, "server-didnt-respond-in-time", &[]))
            .with_details(details)
            .with_stdout(stdout);
    }

    if let Some(rule) = classify(stderr, stdout) {
        return GorynychError::new(rule.code, rule.message(language))
            .with_hint(rule.hint(language))
            .with_details(details)
            .with_stdout(stdout);
    }

    let first_line = details
        .split('\n')
        .find(|line| !js_trim(line).is_empty())
        .map_or_else(|| tr(language, "git-error", &[]), str::to_owned);
    let message = match LEADING_LABEL.find(&first_line) {
        Some(label) => first_line[label.end()..].trim_start_matches(is_js_whitespace).to_owned(),
        None => first_line,
    };
    GorynychError::new(ErrorCode::Git, message).with_details(details).with_stdout(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format_matches_to_json() {
        let error = GorynychError::new(ErrorCode::Auth, "m").with_stdout("скрытый вывод");
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"code":"AUTH","message":"m","hint":null,"details":""}"#
        );
    }

    #[test]
    fn wip_conflict_data_has_no_wrapper() {
        let data = WipConflict {
            from: None,
            to: None,
            files: 1,
            list: vec![WipFile { path: "a".into(), status: "M".into(), untracked: false, staged: true }],
            untracked: 0,
            conflicted: vec![],
            overlap: vec!["a".into()],
            detached: true,
        };
        let error = GorynychError::new(ErrorCode::WipConflict, "m").with_data(ErrorData::WipConflict(data));
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["data"]["from"], serde_json::Value::Null);
        assert!(json["data"].get("to").is_none(), "undefined в 1.x не попадает в JSON");
        assert_eq!(json["data"]["list"][0]["status"], "M");
        let back: GorynychError = serde_json::from_value(json).unwrap();
        assert_eq!(back, error);
    }

    #[test]
    fn code_strings_match_serde() {
        for code in ErrorCode::ALL {
            let json = serde_json::to_string(code).unwrap();
            assert_eq!(json, format!("\"{}\"", code.as_str()));
            assert_eq!(serde_json::from_str::<ErrorCode>(&json).unwrap(), *code);
        }
    }

    #[test]
    fn unknown_wraps_foreign_errors() {
        let json = serde_json::to_string(&GorynychError::unknown("сбой")).unwrap();
        assert_eq!(json, r#"{"code":"UNKNOWN","message":"сбой","hint":null,"details":""}"#);
    }

    #[test]
    fn rule_order_wins_over_text_order() {
        let rule = classify("Could not resolve host\nprotected branch", "").unwrap();
        assert_eq!(rule.code, ErrorCode::Protected);
    }
}
