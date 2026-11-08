//! Общие части проверки: `electron/ciCheckBase.cjs`.
//!
//! ## Конспект
//! - `distance`: Дамерау — Левенштейн без учёта регистра, разница длин больше 3 — 99. `suggest`: без `-` и `_`, порог `min(2, max(1, ⌊длина/3⌋))`, первый из лучших.
//! - `Positions`: разбор как у `Schema::Plain`, см. `yaml.rs`.
//! - `repoIndex`: режимы из `ls-files -s -z`, папки из них; файл или папка — также по диску. `norm`: `posix.normalize`, срез `./` или `/` в начале и `/` в конце.
//! - `defaultBranch`: `origin/HEAD` без имени remote, затем `main`, `master`, иначе `main`.
//! - `parseExpr`: токены и приоритеты GitLab (`||` < `&&` < сравнение), тексты ошибок как причина отказа GitLab. `evalExpr`: неизвестная переменная — `null`, пустая строка — ложь,
//!   `=~` принимает регулярку или переменную со строкой `/…/флаги`.
//! - `durationSeconds`: `1 week 2 days`, `30m`, `3600`; `and` и запятые игнорируются; месяц — 30 дней, год — 365.
//!
//! ## Отличия от 1.x
//! - Текст причины неверной регулярки в выражении другой: это текст `regress`, а не V8 (см. `js_regex.rs`).
//! - Флаг `v` и `d` в регулярке из переменной считаются неверными: `JsRegex` их не знает.
//! - Свойства прототипа JS не особенны: переменная `$constructor` не задана, а команда `toString` не считается инструментом.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use gorynych_core::Language;
use gorynych_core::i18n;
use gorynych_core::js;
use indexmap::IndexMap;

use crate::detect;
use crate::js_regex::JsRegex;
use crate::load::model::{CiFile, CiSeverity};
use crate::repo::RepoView;
use crate::yaml::{Document, DuplicateKey, PathItem, Value};

/// Регулярка JS, скомпилированная один раз.
macro_rules! re {
    ($pattern:literal) => {{
        static REGEX: std::sync::LazyLock<$crate::js_regex::JsRegex> =
            std::sync::LazyLock::new(|| $crate::js_regex::JsRegex::new($pattern, "").expect("шаблон из кода"));
        &*REGEX
    }};
    ($pattern:literal, $flags:literal) => {{
        static REGEX: std::sync::LazyLock<$crate::js_regex::JsRegex> =
            std::sync::LazyLock::new(|| $crate::js_regex::JsRegex::new($pattern, $flags).expect("шаблон из кода"));
        &*REGEX
    }};
}
pub(crate) use re;

/// Перевод на языке текущей проверки, как `t()` в 1.x.
macro_rules! tr {
    ($message:expr $(, $arg:expr)* $(,)?) => {
        $crate::check::base::translate($message, &[$(&$arg as &dyn std::fmt::Display),*])
    };
}
pub(crate) use tr;

/// Проблема без значений по умолчанию. Незаполненные поля — пустые.
macro_rules! draft {
    ($id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
        $crate::check::base::Draft {
            id: $id,
            severity: $crate::load::model::CiSeverity::$severity,
            $($field: ($value).into(),)*
            ..$crate::check::base::Draft::default()
        }
    };
}
pub(crate) use draft;

/// Путь в документе.
macro_rules! kp {
    ($($item:expr),* $(,)?) => { vec![$($crate::yaml::PathItem::from($item)),*] };
}
pub(crate) use kp;

thread_local! {
    static LANGUAGE: Cell<Language> = const { Cell::new(Language::Ru) };
}

/// Язык на время проверки: тексты проверок передаются через десятки функций.
pub(crate) struct LanguageScope(Language);

impl LanguageScope {
    pub fn enter(language: Language) -> Self {
        Self(LANGUAGE.with(|current| current.replace(language)))
    }
}

impl Drop for LanguageScope {
    fn drop(&mut self) {
        LANGUAGE.with(|current| current.set(self.0));
    }
}

pub(crate) fn translate(message: &str, args: &[&dyn Display]) -> String {
    i18n::tr(LANGUAGE.with(Cell::get), message, args)
}

/// Аргумент `t()`: `null` становится пустой строкой.
pub(crate) fn arg(value: &Value) -> String {
    if value.is_null() { String::new() } else { value.js_string() }
}

/// То же для значения, которого может не быть.
pub(crate) fn arg_opt(value: Option<&Value>) -> String {
    value.map_or_else(String::new, arg)
}

pub(crate) fn q(text: impl Display) -> String {
    format!("«{text}»")
}

/// `q(String(value))`, где значения может не быть.
pub(crate) fn q_opt(value: Option<&Value>) -> String {
    q(value.map_or_else(|| "undefined".to_owned(), Value::js_string))
}

/// `String(value)`, где значения может не быть.
pub(crate) fn js_str(value: Option<&Value>) -> String {
    value.map_or_else(|| "undefined".to_owned(), Value::js_string)
}

pub(crate) fn is_obj(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Map(_)))
}

/// `Number(value)`.
pub(crate) fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => *number,
        Some(Value::Map(_)) => f64::NAN,
        Some(other) => number_of_text(&other.js_string()),
    }
}

/// `Number(string)`.
pub(crate) fn number_of_text(text: &str) -> f64 {
    let text = js::trim(text);
    if text.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(rest) = text.strip_prefix(prefix) {
            if rest.is_empty() {
                return f64::NAN;
            }
            return rest.chars().try_fold(0f64, |total, c| Some(total * f64::from(radix) + f64::from(c.to_digit(radix)?))).unwrap_or(f64::NAN);
        }
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if unsigned == "Infinity" {
        return if text.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    if !unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.') || !unsigned.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'.' | b'e' | b'E' | b'+' | b'-')) {
        return f64::NAN;
    }
    text.parse().unwrap_or(f64::NAN)
}

/* --------------------------------- Проблемы ------------------------------------ */

/// Проблема до значений по умолчанию.
#[derive(Debug, Clone)]
pub(crate) struct Draft {
    pub id: &'static str,
    pub severity: CiSeverity,
    pub title: String,
    pub when: Option<String>,
    pub how: String,
    pub why: String,
    pub fix: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub job: Option<String>,
    pub scenario: Option<String>,
}

impl Default for Draft {
    fn default() -> Self {
        Self {
            id: "",
            severity: CiSeverity::Warning,
            title: String::new(),
            when: None,
            how: String::new(),
            why: String::new(),
            fix: String::new(),
            file: None,
            line: None,
            job: None,
            scenario: None,
        }
    }
}

/* ----------------------------------- Опечатки ----------------------------------- */

fn distance(a: &str, b: &str) -> usize {
    let a: Vec<u16> = a.to_lowercase().encode_utf16().collect();
    let b: Vec<u16> = b.to_lowercase().encode_utf16().collect();
    if a == b {
        return 0;
    }
    if a.len().abs_diff(b.len()) > 3 {
        return 99;
    }
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

/// `suggest`.
pub(crate) fn suggest<'a>(word: &str, known: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let strip = |text: &str| text.replace(['-', '_'], "");
    let word = strip(word);
    let mut best = None;
    let mut best_distance = usize::MAX;
    for candidate in known {
        let found = distance(&word, &strip(candidate));
        let limit = 2.min(1.max(js::utf16_len(candidate) / 3));
        if found <= limit && found < best_distance {
            best = Some(candidate);
            best_distance = found;
        }
    }
    best
}

/// `didYouMean`.
pub(crate) fn did_you_mean<'a>(word: &str, known: impl IntoIterator<Item = &'a str>) -> String {
    suggest(word, known).map_or_else(String::new, |found| tr!(" Возможно, имелось в виду {0}.", q(found)))
}

/* ------------------------------- Позиции в файлах ------------------------------- */

struct PositionFile {
    text: String,
    document: Document,
}

/// `Positions`.
pub(crate) struct Positions {
    files: HashMap<String, PositionFile>,
}

impl Positions {
    pub fn new(files: &[CiFile]) -> Self {
        let files = files.iter().map(|file| (file.path.clone(), PositionFile { text: file.text.clone(), document: Document::parse(&file.text) })).collect();
        Self { files }
    }

    /// Документ и его текст.
    pub fn doc(&self, file: &str) -> Option<(&Document, &str)> {
        self.files.get(file).map(|item| (&item.document, item.text.as_str()))
    }

    pub fn line(&self, file: &str, path: &[PathItem]) -> Option<u32> {
        let item = self.files.get(file)?;
        item.document.line(path, &item.text)
    }

    /// `find`: номер первой строки с текстом, начиная со строки `from`.
    pub fn find(&self, file: &str, needle: &str, from: u32) -> Option<u32> {
        let text = &self.files.get(file)?.text;
        if text.is_empty() {
            return None;
        }
        let skip = from.max(1) as usize - 1;
        text.split('\n').enumerate().skip(skip).find(|(_, line)| line.contains(needle)).map(|(at, _)| at as u32 + 1)
    }

    pub fn duplicates(&self, file: &str) -> Vec<DuplicateKey> {
        self.files.get(file).map_or_else(Vec::new, |item| item.document.duplicates(&item.text))
    }
}

/* ------------------------------- Файлы репозитория ------------------------------ */

/// `path.posix.normalize`.
fn posix_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    let mut out = parts.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if trailing && !out.is_empty() && !out.ends_with('/') {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// `norm`.
pub(crate) fn norm(path: &str) -> String {
    let normalized = posix_normalize(&path.replace('\\', "/"));
    let stripped = if let Some(rest) = normalized.strip_prefix("./") { rest.trim_start_matches('/') } else { normalized.trim_start_matches('/') };
    stripped.trim_end_matches('/').to_owned()
}

/// Части glob в выражение: порядок замен как в 1.x.
pub(crate) fn glob_source(pattern: &str) -> String {
    let mut escaped = String::with_capacity(pattern.len() + 8);
    for c in pattern.chars() {
        if matches!(c, '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
        .replace("**/", "\u{0}")
        .replace("**", "\u{1}")
        .replace('*', "[^/]*")
        .replace('?', "[^/]")
        .replace('\u{0}', "(?:.*/)?")
        .replace('\u{1}', ".*")
}

/// `repoIndex`.
pub(crate) struct RepoIndex<'a> {
    root: &'a Path,
    modes: IndexMap<String, String>,
    dirs: HashSet<String>,
}

impl<'a> RepoIndex<'a> {
    pub fn new(root: &'a Path, repo: &dyn RepoView) -> Self {
        let output = repo.ls_files().unwrap_or_default();
        let mut modes = IndexMap::new();
        for entry in output.split('\0') {
            if let Some(groups) = re!(r"^(\d{6}) [0-9a-f]+ \d\t(.+)$").exec(entry)
                && let (Some(mode), Some(path)) = (groups[1].clone(), groups[2].clone())
            {
                modes.insert(path, mode);
            }
        }
        let mut dirs = HashSet::from([String::new()]);
        for path in modes.keys() {
            let parts: Vec<&str> = path.split('/').collect();
            for count in 1..parts.len() {
                dirs.insert(parts[..count].join("/"));
            }
        }
        Self { root, modes, dirs }
    }

    pub fn has_file(&self, path: &str) -> bool {
        let normalized = norm(path);
        self.modes.contains_key(&normalized) || detect::is_file(&detect::join(self.root, &normalized))
    }

    pub fn has_dir(&self, path: &str) -> bool {
        let normalized = norm(path);
        normalized.is_empty()
            || normalized == "."
            || self.dirs.contains(&normalized)
            || fs::metadata(detect::join(self.root, &normalized)).is_ok_and(|meta| meta.is_dir())
    }

    pub fn mode(&self, path: &str) -> Option<&str> {
        self.modes.get(&norm(path)).map(String::as_str)
    }

    pub fn read(&self, path: &str) -> Option<String> {
        let full = detect::join(self.root, &norm(path));
        if fs::metadata(&full).ok()?.len() > 512 * 1024 {
            return None;
        }
        fs::read(&full).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }

    /// `glob`: есть ли отслеживаемый файл по шаблону.
    pub fn glob(&self, pattern: &str) -> bool {
        let Ok(regex) = JsRegex::new(&format!("^{}$", glob_source(&norm(pattern))), "") else { return false };
        self.modes.keys().any(|path| regex.is_match(path))
    }
}

/// `defaultBranch`.
pub(crate) fn default_branch(repo: &dyn RepoView) -> String {
    let head = repo.origin_head().unwrap_or_default();
    let head = js::trim(&head);
    if !head.is_empty() {
        return head.split_once('/').map_or(head, |(_, rest)| rest).to_owned();
    }
    for branch in ["main", "master"] {
        if !js::trim(&repo.verify_branch(branch).unwrap_or_default()).is_empty() {
            return branch.to_owned();
        }
    }
    "main".to_owned()
}

/* ------------------------------ Выражения rules:if ------------------------------ */

/// Значение в выражении.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Var(String),
    Str(String),
    Re { body: String, flags: String },
    Null,
    Cmp { op: &'static str, left: Box<Expr>, right: Box<Expr> },
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Expr(Expr),
    Op(&'static str),
    Open,
    Close,
}

impl Token {
    fn shown(&self) -> String {
        match self {
            Token::Expr(Expr::Var(value) | Expr::Str(value)) => value.clone(),
            Token::Expr(Expr::Re { body, .. }) => body.clone(),
            Token::Expr(_) => "null".to_owned(),
            Token::Op(op) => (*op).to_owned(),
            Token::Open => "(".to_owned(),
            Token::Close => ")".to_owned(),
        }
    }
}

/// Выражение JS `new RegExp(body, flags)`: флаги `g` и `y` `JsRegex` не нужны, но проверяются на повтор.
pub(crate) struct ExprRegex {
    regex: JsRegex,
    sticky: bool,
}

impl ExprRegex {
    pub fn new(body: &str, flags: &str) -> Result<Self, String> {
        let mut seen = HashSet::new();
        if !flags.chars().all(|flag| seen.insert(flag)) {
            return Err(format!("Invalid flags supplied to RegExp constructor '{flags}'"));
        }
        let inner: String = flags.chars().filter(|flag| !matches!(flag, 'g' | 'y')).collect();
        Ok(Self { regex: JsRegex::new(body, &inner)?, sticky: flags.contains('y') })
    }

    /// `re.test(text)` на новом выражении.
    pub fn test(&self, text: &str) -> bool {
        let units: Vec<u16> = text.encode_utf16().collect();
        match self.regex.find(&units) {
            Some(range) => !self.sticky || range.start == 0,
            None => false,
        }
    }
}

fn gitlab_flags(flags: &str) -> String {
    flags.chars().filter(|flag| matches!(flag, 'g' | 'i' | 'm' | 's' | 'u' | 'y')).collect()
}

/// `parseExpr`: дерево и имена переменных, либо причина отказа.
pub(crate) fn parse_expr(source: &str) -> Result<(Expr, Vec<String>), String> {
    let units: Vec<u16> = source.encode_utf16().collect();
    let text_of = |range: &[u16]| String::from_utf16_lossy(range);
    let is_word = |unit: u16| matches!(unit, 0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x5F);
    let is_name_start = |unit: u16| matches!(unit, 0x41..=0x5A | 0x61..=0x7A | 0x5F);
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < units.len() {
        let c = units[i];
        if char::from_u32(u32::from(c)).is_some_and(js::is_whitespace) {
            i += 1;
            continue;
        }
        if c == u16::from(b'$') {
            let braced = units.get(i + 1) == Some(&u16::from(b'{'));
            let start = i + 1 + usize::from(braced);
            let mut end = start;
            if units.get(start).copied().is_some_and(is_name_start) {
                while units.get(end).copied().is_some_and(is_word) {
                    end += 1;
                }
            }
            if end == start || (braced && units.get(end) != Some(&u16::from(b'}'))) {
                return Err(tr!("после $ должно идти имя переменной (позиция {0})", i + 1));
            }
            tokens.push(Token::Expr(Expr::Var(text_of(&units[start..end]))));
            i = end + usize::from(braced);
            continue;
        }
        if c == u16::from(b'"') || c == u16::from(b'\'') {
            let Some(found) = units[i + 1..].iter().position(|unit| *unit == c) else {
                return Err(tr!("не закрыта кавычка {0} (позиция {1})", text_of(&[c]), i + 1));
            };
            tokens.push(Token::Expr(Expr::Str(text_of(&units[i + 1..i + 1 + found]))));
            i += found + 2;
            continue;
        }
        if c == u16::from(b'/') {
            let mut j = i + 1;
            while j < units.len() && (units[j] != u16::from(b'/') || units[j - 1] == u16::from(b'\\')) {
                j += 1;
            }
            if j >= units.len() {
                return Err(tr!("не закрыта регулярка /…/ (позиция {0})", i + 1));
            }
            let body = text_of(&units[i + 1..j]);
            let flags_end = units[j + 1..].iter().position(|unit| !matches!(unit, 0x61..=0x7A)).map_or(units.len(), |at| j + 1 + at);
            let flags = text_of(&units[j + 1..flags_end]);
            if let Err(error) = ExprRegex::new(&body, &gitlab_flags(&flags)) {
                return Err(tr!("неверная регулярка /{0}/: {1}", body, error));
            }
            i = flags_end;
            tokens.push(Token::Expr(Expr::Re { body, flags }));
            continue;
        }
        let two = text_of(&units[i..(i + 2).min(units.len())]);
        if let Some(op) = ["==", "!=", "=~", "!~", "&&", "||"].into_iter().find(|op| *op == two) {
            tokens.push(Token::Op(op));
            i += 2;
            continue;
        }
        if c == u16::from(b'(') {
            tokens.push(Token::Open);
            i += 1;
            continue;
        }
        if c == u16::from(b')') {
            tokens.push(Token::Close);
            i += 1;
            continue;
        }
        if text_of(&units[i..(i + 4).min(units.len())]) == "null" && !units.get(i + 4).copied().is_some_and(is_word) {
            tokens.push(Token::Expr(Expr::Null));
            i += 4;
            continue;
        }
        if c == u16::from(b'=') {
            return Err(tr!("одиночный «=» (позиция {0}) — для сравнения нужен «==»", i + 1));
        }
        let word_end = units[i..].iter().position(|unit| !(is_word(*unit) || matches!(unit, 0x2E | 0x2D))).map_or(units.len(), |at| i + at);
        if word_end > i {
            let word = text_of(&units[i..word_end]);
            return Err(tr!("{0} без кавычек (позиция {1}) — строки в выражениях пишутся в кавычках: \"{2}\"", q(&word), i + 1, word));
        }
        return Err(tr!("непонятный символ {0} (позиция {1})", q(text_of(&[c])), i + 1));
    }
    if tokens.is_empty() {
        return Err(tr!("пустое выражение"));
    }
    let mut parser = ExprParser { tokens: &tokens, at: 0 };
    let ast = parser.or_expr()?;
    if let Some(extra) = tokens.get(parser.at) {
        return Err(tr!("лишнее после выражения: {0} — не хватает && или ||?", q(extra.shown())));
    }
    let vars = tokens
        .iter()
        .filter_map(|token| match token {
            Token::Expr(Expr::Var(name)) => Some(name.clone()),
            _ => None,
        })
        .collect();
    Ok((ast, vars))
}

struct ExprParser<'a> {
    tokens: &'a [Token],
    at: usize,
}

impl ExprParser<'_> {
    fn operand(&mut self) -> Result<Expr, String> {
        let Some(token) = self.tokens.get(self.at) else { return Err(tr!("выражение обрывается")) };
        match token {
            Token::Open => {
                self.at += 1;
                let inner = self.or_expr()?;
                if self.tokens.get(self.at) != Some(&Token::Close) {
                    return Err(tr!("не закрыта скобка ("));
                }
                self.at += 1;
                Ok(inner)
            }
            Token::Expr(expr) => {
                self.at += 1;
                Ok(expr.clone())
            }
            other => Err(tr!("ожидалось значение, а встретилось {0}", q(other.shown()))),
        }
    }

    fn compare(&mut self) -> Result<Expr, String> {
        let left = self.operand()?;
        if let Some(Token::Op(op @ ("==" | "!=" | "=~" | "!~"))) = self.tokens.get(self.at) {
            self.at += 1;
            let right = self.operand()?;
            if matches!(*op, "=~" | "!~") && !matches!(right, Expr::Re { .. } | Expr::Var(_)) {
                let what = if matches!(right, Expr::Str(_)) { tr!("строка в кавычках") } else { tr!("значение") };
                return Err(tr!("справа от {0} должна быть регулярка /…/, а не {1}", op, what));
            }
            return Ok(Expr::Cmp { op, left: Box::new(left), right: Box::new(right) });
        }
        Ok(left)
    }

    fn and_expr(&mut self) -> Result<Expr, String> {
        let mut left = self.compare()?;
        while self.tokens.get(self.at) == Some(&Token::Op("&&")) {
            self.at += 1;
            let right = self.compare()?;
            left = Expr::And(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn or_expr(&mut self) -> Result<Expr, String> {
        let mut left = self.and_expr()?;
        while self.tokens.get(self.at) == Some(&Token::Op("||")) {
            self.at += 1;
            let right = self.and_expr()?;
            left = Expr::Or(Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}

/// Значение операнда при вычислении.
enum Operand<'a> {
    Value(Value),
    Re(&'a str, &'a str),
}

/// `evalExpr`.
pub(crate) fn eval_expr(ast: &Expr, vars: &HashMap<String, Value>) -> bool {
    fn value_of<'a>(node: &'a Expr, vars: &HashMap<String, Value>) -> Operand<'a> {
        match node {
            Expr::Var(name) => Operand::Value(vars.get(name).cloned().unwrap_or(Value::Null)),
            Expr::Str(text) => Operand::Value(Value::String(text.clone())),
            Expr::Null => Operand::Value(Value::Null),
            Expr::Re { body, flags } => Operand::Re(body, flags),
            other => Operand::Value(Value::Bool(eval_expr(other, vars))),
        }
    }
    fn as_regex(operand: &Operand<'_>) -> Option<ExprRegex> {
        match operand {
            Operand::Re(body, flags) => ExprRegex::new(body, &gitlab_flags(flags)).ok(),
            Operand::Value(value) => {
                let text = if value.is_null() { String::new() } else { value.js_string() };
                let groups = re!(r"^\/(.*)\/([a-z]*)$").exec(&text)?;
                ExprRegex::new(groups[1].as_deref().unwrap_or_default(), groups[2].as_deref().unwrap_or_default()).ok()
            }
        }
    }
    match ast {
        Expr::Var(name) => vars.get(name).is_some_and(|value| !value.is_null() && value.as_str() != Some("")),
        Expr::Str(text) => !text.is_empty(),
        Expr::Null => false,
        Expr::Re { .. } => true,
        Expr::And(left, right) => eval_expr(left, vars) && eval_expr(right, vars),
        Expr::Or(left, right) => eval_expr(left, vars) || eval_expr(right, vars),
        Expr::Cmp { op, left, right } => {
            let left_value = value_of(left, vars);
            if matches!(*op, "==" | "!=") {
                let equal = match (&left_value, &value_of(right, vars)) {
                    (Operand::Value(a), Operand::Value(b)) => a == b,
                    _ => false,
                };
                return if *op == "==" { equal } else { !equal };
            }
            let Some(regex) = as_regex(&value_of(right, vars)) else { return false };
            let hit = match &left_value {
                Operand::Value(Value::Null) => false,
                Operand::Value(value) => regex.test(&value.js_string()),
                Operand::Re(..) => regex.test("[object Object]"),
            };
            if *op == "=~" { hit } else { !hit }
        }
    }
}

/* --------------------------------- Длительности ---------------------------------- */

/// `durationSeconds`.
pub(crate) fn duration_seconds(value: Option<&Value>) -> Option<f64> {
    if let Some(Value::Number(number)) = value {
        return Some(*number);
    }
    let text = match value {
        None | Some(Value::Null) => String::new(),
        Some(other) => other.js_string(),
    };
    let text = js::trim(&text).to_lowercase();
    if text.is_empty() {
        return None;
    }
    if text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Some(number_of_text(&text));
    }
    let separators = re!(r"\band\b|,");
    let spaced = separators.replace_all(&text, " ");
    let parts: Vec<String> = re!(r"\d+(?:\.\d+)?\s*[a-z]+").match_all(&spaced).into_iter().filter_map(|groups| groups[0].clone()).collect();
    if parts.is_empty() {
        return None;
    }
    let no_space = |line: &str| line.chars().filter(|c| !js::is_whitespace(*c)).collect::<String>();
    if no_space(&parts.concat()) != no_space(&separators.replace_all(&text, "")) {
        return None;
    }
    let mut total = 0.0;
    for part in &parts {
        let groups = re!(r"^(\d+(?:\.\d+)?)\s*([a-z]+)$").exec(part)?;
        let (amount, unit) = (groups[1].as_deref()?, groups[2].as_deref()?);
        if !re!(r"^(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)$", "i").test(unit) {
            return None;
        }
        let seconds = if unit.starts_with("mo") {
            2_592_000.0
        } else {
            match unit.as_bytes()[0] {
                b'y' => 31_536_000.0,
                b'w' => 604_800.0,
                b'd' => 86_400.0,
                b'h' => 3_600.0,
                b'm' => 60.0,
                _ => 1.0,
            }
        };
        total += number_of_text(amount) * seconds;
    }
    Some(total)
}

/* ------------------------------- Секреты в открытом виде -------------------------- */

/// `SECRET_NAME`.
pub(crate) fn is_secret_name(name: &str) -> bool {
    re!(r"(PASS(WORD|WD)?|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)$", "i").test(name)
}

/// `SECRET_VALUE`: выражение и ключ перевода.
pub(crate) static SECRET_VALUE: LazyLock<Vec<(JsRegex, &'static str)>> = LazyLock::new(|| {
    [
        (r"\bglpat-[0-9A-Za-z_-]{20,}", "токен GitLab (glpat-…)"),
        (r"\bgh[pousr]_[0-9A-Za-z]{30,}", "токен GitHub (ghp_…)"),
        (r"\bgithub_pat_[0-9A-Za-z_]{40,}", "токен GitHub (github_pat_…)"),
        (r"\bAKIA[0-9A-Z]{16}\b", "ключ доступа AWS (AKIA…)"),
        (r"\bxox[baprs]-[0-9A-Za-z-]{10,}", "токен Slack"),
        (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "приватный ключ"),
        (r"\bAIza[0-9A-Za-z_-]{35}\b", "ключ Google API"),
        (r"\bsk_live_[0-9A-Za-z]{20,}", "секретный ключ Stripe"),
    ]
    .into_iter()
    .map(|(pattern, what)| (JsRegex::new(pattern, "").expect("шаблон из кода"), what))
    .collect()
});

/// `looksLikeVarRef`.
pub(crate) fn looks_like_var_ref(value: &Value) -> bool {
    let text = value.js_string();
    re!(r"^\$\{?\{?\s*[A-Za-z_]").test(js::trim(&text)) || re!(r"\$\{\{\s*secrets\.").test(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_normalize_matches_node() {
        for (input, expected) in [("", "."), (".", "."), ("./a", "a"), ("a/./b", "a/b"), ("a/../b", "b"), ("../a", "../a"), ("a//b/", "a/b/"), ("/a/../..", "/"), ("a/..", "."), ("..", "..")] {
            assert_eq!(posix_normalize(input), expected, "{input}");
        }
        assert_eq!(norm("./a/b/"), "a/b");
        assert_eq!(norm("/a"), "a");
        assert_eq!(norm(r".\a\b"), "a/b");
    }

    #[test]
    fn number_of_text_matches_js() {
        for (input, expected) in [("", 0.0), (" 12 ", 12.0), ("1e3", 1000.0), ("0x10", 16.0), ("-5", -5.0), (".5", 0.5), ("5.", 5.0)] {
            assert_eq!(number_of_text(input), expected, "{input}");
        }
        assert!(number_of_text("abc").is_nan());
        assert!(number_of_text("1h").is_nan());
        assert!(number_of_text("inf").is_nan());
        assert!(number_of_text("1_000").is_nan());
    }

    #[test]
    fn expressions() {
        let vars: HashMap<String, Value> = [("A".to_owned(), Value::String("main".to_owned())), ("E".to_owned(), Value::String(String::new()))].into();
        let run = |text: &str| eval_expr(&parse_expr(text).unwrap().0, &vars);
        assert!(run("$A == 'main' && ($B == null || $B)"));
        assert!(!run("$E"));
        assert!(run("$A =~ /^ma/"));
        assert!(run("$A !~ /x/"));
        assert!(!run("$B =~ /x/"));
        assert!(parse_expr("").is_err());
        assert!(parse_expr("$A = 1").is_err());
        assert!(parse_expr("$A =~ 'x'").is_err());
    }
}
