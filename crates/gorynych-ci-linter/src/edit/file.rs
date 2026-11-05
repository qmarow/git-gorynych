//! Чтение и сохранение файлов CI, предпросмотр изменений и новый файл из шаблона: первая и последняя части `electron/ciEdit.cjs`.
//!
//! ## Конспект
//! - `checkWritablePath`: `safeRelative`; сегмент `.git` — `BAD_ARGS` «Сюда писать нельзя»; не `/\.ya?ml$/i` и не `Jenkinsfile` — `BAD_ARGS`.
//! - `fileState(raw)`: файла нет — пустой текст, `\n`, без BOM, `hash: null`. Иначе текст без BOM с `\n`, `eol` — `\r\n`, если он есть хоть раз; `hash` —
//!   sha1 сырого текста после декодирования UTF-8.
//! - `saveFile`, по порядку: больше 512 КБ в UTF-8 — `TOO_LARGE`; путь; `baseHash` задан и не равен текущему — `CHANGED_ON_DISK` с подсказкой (`baseHash: null`
//!   значит «файла быть не должно»). Сохраняются EOL и BOM файла. Запись через `<путь>.gk-tmp-<pid>` и переименование. Результат `{path, hash, created}`, `hash` — записанного.
//! - `readFile`: `{path, text, eol, bom, hash, exists}`. `diffDraft`: `toHunks` «на диске → черновик», контекст 3.
//! - `createFromTemplate`: `gitlab` (текст переводится), `github`; другая система — `BAD_ARGS`; файл есть — `EXISTS`.

use std::fs;
use std::path::{Path, PathBuf};

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, Language};
use gorynych_core::line_diff::{self, FileDiff};
use gorynych_core::paths;
use serde::{Deserialize, Deserializer, Serialize};
use sha1::{Digest, Sha1};

const MAX_SIZE: usize = 512 * 1024;
const BOM: char = '\u{FEFF}';

const GITLAB_TEMPLATE_PATH: &str = ".gitlab-ci.yml";
const GITHUB_TEMPLATE_PATH: &str = ".github/workflows/ci.yml";
/// Ключ перевода: текст шаблона на русском.
const GITLAB_TEMPLATE: &str = "# Пайплайн GitLab CI: этапы выполняются по порядку, задания одного этапа — параллельно\nstages: [build, test, deploy]\n\ndefault:\n  image: node:20\n\nbuild:\n  stage: build\n  script:\n    - npm ci\n    - npm run build\n  artifacts:\n    paths: [dist/]\n\ntest:\n  stage: test\n  script:\n    - npm ci\n    - npm test\n\ndeploy:\n  stage: deploy\n  script:\n    - echo \"Деплой\"\n  rules:\n    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH\n      when: manual\n";
const GITHUB_TEMPLATE: &str = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci\n      - run: npm run build\n\n  test:\n    needs: build\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n";

/// `hash` из `ciEdit.cjs`.
fn sha1_hex(text: &str) -> String {
    Sha1::digest(text.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn read_raw(full: &Path) -> Option<String> {
    fs::read(full).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// `fileState`: текст для редактора и отпечаток.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileState {
    text: String,
    eol: &'static str,
    bom: bool,
    hash: Option<String>,
}

fn file_state(raw: Option<&str>) -> FileState {
    let Some(raw) = raw else { return FileState { text: String::new(), eol: "\n", bom: false, hash: None } };
    let body = raw.strip_prefix(BOM);
    let bom = body.is_some();
    let body = body.unwrap_or(raw);
    FileState {
        text: body.replace("\r\n", "\n"),
        eol: if body.contains("\r\n") { "\r\n" } else { "\n" },
        bom,
        hash: Some(sha1_hex(raw)),
    }
}

/// Результат `readFile`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiFileContent {
    pub path: String,
    pub text: String,
    pub eol: String,
    pub bom: bool,
    pub hash: Option<String>,
    pub exists: bool,
}

/// `readFile`.
pub fn read_file(root: &Path, rel: &str, language: Language) -> Result<CiFileContent> {
    let full = paths::safe_relative(root, rel, language)?;
    let state = file_state(read_raw(&full).as_deref());
    let exists = state.hash.is_some();
    Ok(CiFileContent { path: rel.to_owned(), text: state.text, eol: state.eol.to_owned(), bom: state.bom, hash: state.hash, exists })
}

fn check_writable_path(root: &Path, rel: &str, language: Language) -> Result<PathBuf> {
    let full = paths::safe_relative(root, rel, language)?;
    let relative = paths::relative_inside(root, &full);
    if relative.split('/').any(|part| part == ".git") {
        return Err(GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Сюда писать нельзя", &[])));
    }
    let lower = relative.as_bytes();
    let ends_with = |suffix: &[u8]| lower.len() >= suffix.len() && lower[lower.len() - suffix.len()..].eq_ignore_ascii_case(suffix);
    let basename = relative.rsplit('/').next().unwrap_or_default();
    if !ends_with(b".yml") && !ends_with(b".yaml") && basename != "Jenkinsfile" {
        return Err(GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Сохранять можно только файлы CI/CD (.yml, .yaml, Jenkinsfile)", &[])));
    }
    Ok(full)
}

/// Отличает отсутствующее поле от `null`.
fn some_option<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

/// Что сохранить: `draft` у `repo:ci-save`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CiSaveRequest {
    pub path: String,
    pub content: String,
    /// Нет поля — не проверять, `null` — файла быть не должно, строка — ожидаемый отпечаток.
    #[serde(default, deserialize_with = "some_option")]
    #[specta(type = Option<Option<String>>)]
    pub base_hash: Option<Option<String>>,
}

/// Результат `saveFile`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiSaved {
    pub path: String,
    pub hash: String,
    pub created: bool,
}

/// `saveFile`.
pub fn save_file(root: &Path, request: &CiSaveRequest, language: Language) -> Result<CiSaved> {
    if request.content.len() > MAX_SIZE {
        return Err(GorynychError::new(ErrorCode::TooLarge, i18n::tr(language, "Файл слишком большой", &[])));
    }
    let full = check_writable_path(root, &request.path, language)?;
    let current = read_raw(&full);
    let state = file_state(current.as_deref());
    if let Some(base_hash) = &request.base_hash
        && state.hash != *base_hash
    {
        return Err(GorynychError::new(ErrorCode::ChangedOnDisk, i18n::tr(language, "Файл изменился на диске, пока вы его редактировали", &[])).with_hint(i18n::tr(
            language,
            "Нажмите «Перечитать», чтобы загрузить свежую версию, или сохраните поверх (ваши правки заменят изменения на диске).",
            &[],
        )));
    }
    let mut out = request.content.replace("\r\n", "\n");
    if state.eol == "\r\n" {
        out = out.replace('\n', "\r\n");
    }
    if state.bom {
        out.insert(0, BOM);
    }
    let io_error = |error: std::io::Error| GorynychError::new(ErrorCode::Unknown, error.to_string());
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(io_error)?;
    }
    let mut temp = full.clone().into_os_string();
    temp.push(format!(".gk-tmp-{}", std::process::id()));
    fs::write(&temp, &out).map_err(io_error)?;
    fs::rename(&temp, &full).map_err(io_error)?;
    Ok(CiSaved { path: request.path.clone(), hash: sha1_hex(&out), created: current.is_none() })
}

/// Результат `diffDraft`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CiDraftDiff {
    pub path: String,
    #[serde(flatten)]
    pub diff: FileDiff,
}

/// `diffDraft`.
pub fn diff_draft(root: &Path, rel: &str, content: &str, language: Language) -> Result<CiDraftDiff> {
    let full = paths::safe_relative(root, rel, language)?;
    let before = file_state(read_raw(&full).as_deref()).text;
    let after = content.replace("\r\n", "\n");
    let old_lines: Vec<&str> = before.split('\n').collect();
    let new_lines: Vec<&str> = after.split('\n').collect();
    let ops = line_diff::diff_lines(&old_lines, &new_lines);
    Ok(CiDraftDiff { path: rel.to_owned(), diff: line_diff::to_hunks(&old_lines, &new_lines, &ops, line_diff::DEFAULT_CONTEXT) })
}

/// `createFromTemplate`.
pub fn create_from_template(root: &Path, system: &str, language: Language) -> Result<CiSaved> {
    let (path, content) = match system {
        "gitlab" => (GITLAB_TEMPLATE_PATH, i18n::tr(language, GITLAB_TEMPLATE, &[])),
        "github" => (GITHUB_TEMPLATE_PATH, GITHUB_TEMPLATE.to_owned()),
        _ => return Err(GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Нет шаблона для этой системы", &[]))),
    };
    let full = check_writable_path(root, path, language)?;
    if read_raw(&full).is_some() {
        return Err(GorynychError::new(ErrorCode::Exists, i18n::tr(language, "Файл {0} уже существует", &[&path])));
    }
    save_file(root, &CiSaveRequest { path: path.to_owned(), content, base_hash: Some(None) }, language)
}
