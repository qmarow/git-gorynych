//! Диалоги, открытие файлов и ссылок, терминал, картинка фона: перенос `electron/system.cjs` и обработчиков `repo:open-dialog`,
//! `repo:open-path`, `creds:pick-key`, `appearance:pick-image`, `appearance:image`, `cicd:artifact-download`, `cicd:show-file`,
//! `shell:*` из `electron/main.cjs`.
//!
//! # Конспект исходника
//! - `repo:open-dialog(title)`: выбор папки, заголовок — `title`, если строка, иначе «Открыть Git-репозиторий»; отмена → `null`.
//! - `repo:open-path(dir, rel)`: корень репозитория, `safeRelative(root, rel)`, открыть программой по умолчанию; ошибка оболочки
//!   — `Error` с её текстом (код `UNKNOWN`); ответ `{path}`.
//! - `creds:pick-key`: выбор файла «Приватный SSH-ключ», начальная папка — папка ключей, если есть, иначе домашняя; отмена → `null`.
//! - `appearance:pick-image`: файл с фильтром «Изображения» (`png jpg jpeg webp gif bmp`); расширение не из списка — «Этот формат не
//!   поддерживается»; больше 25 МБ — «Картинка слишком большая ({0} МБ, максимум 25 МБ)», МБ округляются; старые `current.*`
//!   удаляются, файл копируется в `backgrounds/current<ext>` (расширение в нижнем регистре); ответ — имя исходного файла.
//! - `appearance:image`: `current.*` как `data:`-URL с типом по расширению (по умолчанию `image/png`), нет файла → `null`.
//! - `cicd:artifact-download(dir, artifact, opts)`: имя `fileName` или `<name ?? 'artifact'>.zip`, `[\\/:*?"<>|]+` → `_`; диалог
//!   «Сохранить артефакт» в папку «Загрузки» с фильтром «Архив» (`zip`); отмена → `{canceled: true}`; иначе скачивание и
//!   `{path, size, name}`.
//! - `cicd:show-file(file)`: показать файл в Проводнике / Finder; ошибок нет.
//! - `shell:open-external(url)`: только `http:` и `https:`, иначе и при ошибке → `false`.
//! - `shell:open-folder(dir)`, `shell:open-terminal(dir)`: `requireDir` — не строка, пусто, нет такой папки или это файл →
//!   `NOT_FOUND` «Папка не найдена» с `hint` = `dir`; путь делается абсолютным. Папка: ошибка оболочки → `OPEN_FAILED` «Не удалось
//!   открыть папку» (`details` — текст). Терминал: варианты по порядку (Windows: Windows Terminal `wt.exe -d`, PowerShell
//!   `-NoExit -NoLogo`, `cmd.exe /K` в папке; macOS: iTerm, если установлен, затем Terminal через `open -a`; Linux: семь
//!   известных), первый запустившийся → `{terminal}`; ни один → `NO_TERMINAL` с подсказкой и текстом последней ошибки.
//!
//! # Отличия от 1.x
//! - Ошибка — отклонённый promise. `appearance:pick-image` в 1.x отвечал `{ok, canceled, error: {message}}` без кода: здесь отмена —
//!   `{canceled: true}`, а ошибки — `UNSUPPORTED` (формат) и `TOO_LARGE` (размер) с теми же текстами.
//! - **`appearance:image` отдаёт адрес, а не `data:`-URL**: картинку до 25 МБ 1.x превращал в строку base64 на 33 МБ, которая шла
//!   через IPC и жила в памяти страницы. Здесь файл отдаёт протокол `gorynych-bg` ([`serve_background`]), а в адресе — отметка
//!   времени и размер, чтобы новая картинка не бралась из кэша.
//! - `cicd:artifact-download`: в 1.x `opts.dest` подменял диалог под `GK_TEST_USERDATA`; здесь подмена общая для всех диалогов
//!   (ниже) и только в debug.
//! - `creds:pick-key`: флага «показывать скрытые файлы» у системного диалога через `rfd` нет.
//!
//! # Подмена в отладке
//! С `GORYNYCH_DEV_ROOT` (только debug) диалоги не показываются: ответ — первая строка файла `<папка>/dialog-answers.txt`
//! (пустая строка или нет файла — отмена), строка удаляется. Открытие файлов, ссылок, папок и запуск терминала не выполняются,
//! а дописываются строкой в `<папка>/desktop.log`, как и каждый вопрос диалога: тесты проверяют их, не открывая окон на машине.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

use gorynych_cicd::models::ArtifactRef;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::paths::safe_relative;
use gorynych_git::read::resolve_repo_root;
use gorynych_storage::ssh_keys::list_ssh_keys;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewWindow};

use super::cicd::RemoteOptions;
use super::repo::blocking;
use crate::{AppState, Services};

/// Расширение → тип: `IMAGE_TYPES` из 1.x.
const IMAGE_TYPES: [(&str, &str); 6] = [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("webp", "image/webp"), ("gif", "image/gif"), ("bmp", "image/bmp")];
const MAX_IMAGE: u64 = 25 * 1024 * 1024;
/// Протокол картинки фона.
pub const BACKGROUND_SCHEME: &str = "gorynych-bg";

/* ---------- Типы ---------- */

/// Открытый путь: `repo:open-path`, `shell:open-folder`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OpenedPath {
    pub path: String,
}

/// Ответ `shell:open-terminal`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OpenedTerminal {
    pub terminal: String,
}

/// Ответ `appearance:pick-image`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PickedImage {
    pub canceled: bool,
    /// Имя исходного файла.
    pub name: Option<String>,
}

/// Артефакт для `cicd:artifact-download`: имя файла нужно диалогу.
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct ArtifactDownload {
    #[serde(flatten)]
    pub artifact: ArtifactRef,
    pub file_name: Option<String>,
    pub name: Option<String>,
}

/// Ответ `cicd:artifact-download`.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
pub struct ArtifactSaved {
    pub canceled: bool,
    pub path: Option<String>,
    #[specta(type = Option<f64>)]
    pub size: Option<u64>,
    pub name: Option<String>,
}

/* ---------- Подмена в отладке ---------- */

/// В релизе подмены нет: `dev_root` там всегда `None`, а этих функций нет вовсе.
#[cfg(not(debug_assertions))]
fn dev_log_at(_root: Option<&Path>, _line: &str) -> bool {
    false
}

#[cfg(not(debug_assertions))]
fn dev_answer(_root: &Path) -> Option<PathBuf> {
    None
}

/// Строка в журнал подмены. `true` — подмена включена, настоящее действие выполнять не нужно.
fn dev_log(services: &Services, line: &str) -> bool {
    dev_log_at(services.dev_root.as_deref(), line)
}

#[cfg(debug_assertions)]
fn dev_log_at(root: Option<&Path>, line: &str) -> bool {
    use std::io::Write;
    let Some(root) = root else {
        return false;
    };
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(root.join("desktop.log")) {
        let _ = writeln!(file, "{line}");
    }
    true
}

/// Ответ диалога из `dialog-answers.txt`.
#[cfg(debug_assertions)]
fn dev_answer(root: &Path) -> Option<PathBuf> {
    let file = root.join("dialog-answers.txt");
    let text = fs::read_to_string(&file).ok()?;
    let (first, rest) = text.split_once('\n').unwrap_or((&text, ""));
    let _ = fs::write(&file, rest);
    let first = first.trim_end_matches('\r');
    (!first.is_empty()).then(|| PathBuf::from(first))
}

/* ---------- Диалоги ---------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Picker {
    Folder,
    File,
    Save,
}

impl Picker {
    fn as_str(self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::File => "file",
            Self::Save => "save",
        }
    }
}

/// Что спросить.
struct Ask {
    picker: Picker,
    title: String,
    directory: Option<PathBuf>,
    file_name: Option<String>,
    filter: Option<(String, Vec<&'static str>)>,
}

/// Системный диалог поверх окна; `None` — отмена.
async fn ask(window: &WebviewWindow, services: &Services, request: Ask) -> Result<Option<PathBuf>> {
    if let Some(root) = &services.dev_root {
        let directory = request.directory.as_ref().map_or_else(String::new, |dir| dir.display().to_string());
        dev_log(services, &format!("dialog {} | {} | {directory} | {}", request.picker.as_str(), request.title, request.file_name.as_deref().unwrap_or_default()));
        return Ok(dev_answer(root));
    }
    use tauri_plugin_dialog::DialogExt;
    let mut builder = window.dialog().file().set_parent(window).set_title(request.title);
    if let Some(dir) = request.directory {
        builder = builder.set_directory(dir);
    }
    if let Some(name) = request.file_name {
        builder = builder.set_file_name(name);
    }
    if let Some((name, extensions)) = &request.filter {
        builder = builder.add_filter(name, extensions);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let reply = move |path: Option<tauri_plugin_dialog::FilePath>| {
        let _ = sender.send(path);
    };
    match request.picker {
        Picker::Folder => builder.pick_folder(reply),
        Picker::File => builder.pick_file(reply),
        Picker::Save => builder.save_file(reply),
    }
    match receiver.await.ok().flatten() {
        Some(path) => path.into_path().map(Some).map_err(GorynychError::unknown),
        None => Ok(None),
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
#[specta::specta]
pub async fn repo_open_dialog(window: WebviewWindow, state: State<'_, AppState>, title: Option<String>) -> Result<Option<String>> {
    let services = state.services()?;
    let title = title.unwrap_or_else(|| t("Открыть Git-репозиторий", &[]));
    let picked = ask(&window, services, Ask { picker: Picker::Folder, title, directory: None, file_name: None, filter: None }).await?;
    Ok(picked.as_deref().map(path_text))
}

#[tauri::command]
#[specta::specta]
pub async fn creds_pick_key(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<String>> {
    let services = state.services()?;
    let keys = PathBuf::from(list_ssh_keys(&services.ssh_dir).dir);
    let directory = if keys.exists() { keys } else { std::env::home_dir().unwrap_or_default() };
    let picked = ask(&window, services, Ask { picker: Picker::File, title: t("Приватный SSH-ключ", &[]), directory: Some(directory), file_name: None, filter: None }).await?;
    Ok(picked.as_deref().map(path_text))
}

/* ---------- Картинка фона ---------- */

fn backgrounds(data_dir: &Path) -> PathBuf {
    data_dir.join("backgrounds")
}

/// `storedImage`: файл `current.*`.
pub(crate) fn stored_image(data_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(backgrounds(data_dir)).ok()?.flatten().find(|entry| entry.file_name().to_string_lossy().starts_with("current.")).map(|entry| entry.path())
}

/// Тип по расширению, как `IMAGE_TYPES[ext] ?? 'image/png'`.
fn mime_of(path: &Path) -> &'static str {
    let ext = path.extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
    IMAGE_TYPES.iter().find(|(known, _)| *known == ext).map_or("image/png", |(_, mime)| mime)
}

/// Копирует выбранную картинку к себе: от исходного файла фон больше не зависит.
fn store_image(data_dir: &Path, source: &Path) -> Result<String> {
    let ext = source.extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !IMAGE_TYPES.iter().any(|(known, _)| *known == ext) {
        return Err(GorynychError::new(ErrorCode::Unsupported, t("Этот формат не поддерживается", &[])));
    }
    let size = fs::metadata(source).map_err(GorynychError::unknown)?.len();
    if size > MAX_IMAGE {
        let megabytes = (size as f64 / 1_048_576.0).round();
        return Err(GorynychError::new(ErrorCode::TooLarge, t("Картинка слишком большая ({0} МБ, максимум 25 МБ)", &[&megabytes])));
    }
    let dir = backgrounds(data_dir);
    fs::create_dir_all(&dir).map_err(GorynychError::unknown)?;
    for entry in fs::read_dir(&dir).map_err(GorynychError::unknown)?.flatten() {
        if entry.file_name().to_string_lossy().starts_with("current.") {
            let _ = fs::remove_file(entry.path());
        }
    }
    fs::copy(source, dir.join(format!("current.{ext}"))).map_err(GorynychError::unknown)?;
    Ok(source.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub async fn appearance_pick_image(window: WebviewWindow, state: State<'_, AppState>) -> Result<PickedImage> {
    let services = state.services()?;
    let filter = (t("Изображения", &[]), IMAGE_TYPES.iter().map(|(ext, _)| *ext).collect());
    let picked = ask(&window, services, Ask { picker: Picker::File, title: t("Картинка для фона", &[]), directory: None, file_name: None, filter: Some(filter) }).await?;
    let Some(source) = picked else {
        return Ok(PickedImage { canceled: true, name: None });
    };
    let data_dir = services.data_dir.clone();
    let name = blocking(move || store_image(&data_dir, &source)).await?;
    Ok(PickedImage { canceled: false, name: Some(name) })
}

/// Адрес протокола: на Windows WebView2 видит свои протоколы как `http://<имя>.localhost`.
fn background_url(version: &str) -> String {
    if cfg!(windows) { format!("http://{BACKGROUND_SCHEME}.localhost/current?v={version}") } else { format!("{BACKGROUND_SCHEME}://localhost/current?v={version}") }
}

/// Адрес картинки фона или `None`. В адресе — время изменения и размер файла: новая картинка не возьмётся из кэша.
#[tauri::command]
#[specta::specta]
pub fn appearance_image(state: State<'_, AppState>) -> Result<Option<String>> {
    let services = state.services()?;
    let Some(file) = stored_image(&services.data_dir) else {
        return Ok(None);
    };
    let meta = fs::metadata(&file).map_err(GorynychError::unknown)?;
    let modified = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |time| time.as_millis());
    Ok(Some(background_url(&format!("{modified}-{}", meta.len()))))
}

/// Обработчик протокола `gorynych-bg`: только `current`, файл читается в отдельном потоке.
pub fn serve_background<R: tauri::Runtime>(ctx: tauri::UriSchemeContext<'_, R>, request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    let data_dir = ctx.app_handle().try_state::<AppState>().and_then(|state| state.services().ok().map(|services| services.data_dir.clone()));
    let wanted = request.uri().path() == "/current";
    tauri::async_runtime::spawn_blocking(move || {
        let found = data_dir.filter(|_| wanted).and_then(|dir| stored_image(&dir)).and_then(|file| fs::read(&file).ok().map(|bytes| (mime_of(&file), bytes)));
        let response = match found {
            Some((mime, bytes)) => tauri::http::Response::builder().status(200).header("Content-Type", mime).header("Cache-Control", "max-age=31536000, immutable").body(bytes),
            None => tauri::http::Response::builder().status(404).body(Vec::new()),
        };
        if let Ok(response) = response {
            responder.respond(response);
        }
    });
}

/* ---------- Артефакт ---------- */

/// Имя файла артефакта без запрещённых в Windows символов.
fn artifact_file_name(artifact: &ArtifactDownload) -> String {
    let raw = artifact.file_name.clone().unwrap_or_else(|| format!("{}.zip", artifact.name.as_deref().unwrap_or("artifact")));
    let mut out = String::with_capacity(raw.len());
    let mut in_run = false;
    for ch in raw.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            if !in_run {
                out.push('_');
            }
            in_run = true;
        } else {
            out.push(ch);
            in_run = false;
        }
    }
    out
}

/// Спросить, куда сохранить, и скачать потоком.
#[tauri::command]
#[specta::specta]
pub async fn cicd_artifact_download(window: WebviewWindow, state: State<'_, AppState>, dir: String, artifact: Option<ArtifactDownload>, opts: Option<RemoteOptions>) -> Result<ArtifactSaved> {
    let services = state.services()?;
    let root = resolve_repo_root(Path::new(&dir)).await?;
    let artifact = artifact.unwrap_or_default();
    let name = artifact_file_name(&artifact);
    let downloads = window.path().download_dir().ok();
    let request = Ask {
        picker: Picker::Save,
        title: t("Сохранить артефакт", &[]),
        directory: downloads,
        file_name: Some(name.clone()),
        filter: Some((t("Архив", &[]), vec!["zip"])),
    };
    let Some(dest) = ask(&window, services, request).await? else {
        return Ok(ArtifactSaved { canceled: true, ..ArtifactSaved::default() });
    };
    let remote = opts.as_ref().and_then(|opts| opts.remote.as_deref());
    let saved = services.cicd.artifact_download(&root, Some(&artifact.artifact), Some(&dest), remote).await?;
    Ok(ArtifactSaved { canceled: false, path: Some(saved.path), size: Some(saved.size), name: Some(name) })
}

/* ---------- Открытие ---------- */

/// `requireDir`.
fn require_dir(dir: Option<&str>) -> Result<PathBuf> {
    let text = dir.unwrap_or_default();
    let path = Path::new(text);
    if text.is_empty() || !path.is_dir() {
        return Err(GorynychError::new(ErrorCode::NotFound, t("Папка не найдена", &[])).with_hint(text.to_owned()));
    }
    std::path::absolute(path).map_err(GorynychError::unknown)
}

/// Открыть программой по умолчанию; ошибка — текст оболочки.
fn open_with_shell(services: &Services, path: &Path) -> std::result::Result<(), String> {
    if dev_log(services, &format!("open {}", path.display())) {
        return Ok(());
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|error| error.to_string())
}

/// Открыть файл репозитория в программе по умолчанию (например, VS Code).
#[tauri::command]
#[specta::specta]
pub async fn repo_open_path(state: State<'_, AppState>, dir: String, rel: String) -> Result<OpenedPath> {
    let services = state.services()?;
    let root = resolve_repo_root(Path::new(&dir)).await?;
    let full = safe_relative(&root, &rel, i18n::language())?;
    open_with_shell(services, &full).map_err(GorynychError::unknown)?;
    Ok(OpenedPath { path: path_text(&full) })
}

/// Папка в Проводнике / Finder.
#[tauri::command]
#[specta::specta]
pub async fn shell_open_folder(state: State<'_, AppState>, dir: Option<String>) -> Result<OpenedPath> {
    let services = state.services()?;
    let target = require_dir(dir.as_deref())?;
    open_with_shell(services, &target).map_err(|error| GorynychError::new(ErrorCode::OpenFailed, t("Не удалось открыть папку", &[])).with_details(error))?;
    Ok(OpenedPath { path: path_text(&target) })
}

/// Показать скачанный файл в папке.
#[tauri::command]
#[specta::specta]
pub async fn cicd_show_file(state: State<'_, AppState>, file: String) -> Result<()> {
    let services = state.services()?;
    if !dev_log(services, &format!("reveal {file}")) {
        // Как `shell.showItemInFolder`: ошибок нет
        let _ = tauri_plugin_opener::reveal_item_in_dir(&file);
    }
    Ok(())
}

/// Ссылка (пайплайн, задание) в браузере: только `http:` и `https:`.
#[tauri::command]
#[specta::specta]
pub fn shell_open_external(state: State<'_, AppState>, url: String) -> bool {
    let Ok(parsed) = url::Url::parse(&url) else {
        return false;
    };
    let dev_root = state.services().ok().and_then(|services| services.dev_root.clone());
    open_link(&parsed, dev_root.as_deref())
}

/// Ссылка в браузере, только `http:` и `https:`. Это же делает окно для `target=_blank` и `window.open` (см. `lib.rs`):
/// в 1.x `setWindowOpenHandler` отдавал оболочке любой адрес, включая `file:` и чужие протоколы, — здесь только веб.
pub(crate) fn open_link(url: &url::Url, dev_root: Option<&Path>) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    if dev_log_at(dev_root, &format!("url {url}")) {
        return true;
    }
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).is_ok()
}

/* ---------- Терминал ---------- */

/// Для какой системы подбирать терминал.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Platform {
    Windows,
    Mac,
    Other,
}

impl Platform {
    fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Mac
        } else {
            Self::Other
        }
    }
}

/// Вариант запуска терминала.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub name: String,
    pub cmd: &'static str,
    pub args: Vec<String>,
    /// Рабочая папка процесса.
    pub cwd: Option<PathBuf>,
}

/// `terminalCandidates`: варианты в порядке предпочтения.
pub(crate) fn terminal_candidates(dir: &Path, platform: Platform, exists: impl Fn(&Path) -> bool) -> Vec<Candidate> {
    let text = path_text(dir);
    let item = |name: &str, cmd: &'static str, args: &[&str], cwd: bool| Candidate { name: name.to_owned(), cmd, args: args.iter().map(|arg| (*arg).to_owned()).collect(), cwd: cwd.then(|| dir.to_path_buf()) };
    match platform {
        Platform::Mac => {
            let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
            let iterm = [PathBuf::from("/Applications/iTerm.app"), home.join("Applications/iTerm.app")].iter().any(|path| exists(path));
            let mut list = Vec::new();
            if iterm {
                list.push(item("iTerm", "open", &["-a", "iTerm", &text], false));
            }
            list.push(item("Terminal", "open", &["-a", "Terminal", &text], false));
            list
        }
        // Свой процесс получает собственное окно консоли
        Platform::Windows => vec![
            item("Windows Terminal", "wt.exe", &["-d", &text], false),
            item("PowerShell", "powershell.exe", &["-NoExit", "-NoLogo"], true),
            // Папка уже рабочая: лишние кавычки в аргументах cmd.exe разбирает плохо
            item(&t("Командная строка", &[]), "cmd.exe", &["/K"], true),
        ],
        Platform::Other => vec![
            item("x-terminal-emulator", "x-terminal-emulator", &[], true),
            item("GNOME Terminal", "gnome-terminal", &[&format!("--working-directory={text}")], true),
            item("Konsole", "konsole", &["--workdir", &text], true),
            item("Xfce Terminal", "xfce4-terminal", &[&format!("--working-directory={text}")], true),
            item("kitty", "kitty", &["--directory", &text], true),
            item("Alacritty", "alacritty", &["--working-directory", &text], true),
            item("xterm", "xterm", &[], true),
        ],
    }
}

/// `launch`: отдельная программа, не привязанная к нашему процессу. Ждать её не нужно.
fn launch(candidate: &Candidate) -> std::io::Result<()> {
    let mut command = Command::new(candidate.cmd);
    command.args(&candidate.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(cwd) = &candidate.cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Как `detached: true` в Node: своё окно консоли и своя группа процессов
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn().map(drop)
}

/// Папка репозитория в терминале.
#[tauri::command]
#[specta::specta]
pub async fn shell_open_terminal(state: State<'_, AppState>, dir: Option<String>) -> Result<OpenedTerminal> {
    let services = state.services()?;
    let target = require_dir(dir.as_deref())?;
    let candidates = terminal_candidates(&target, Platform::current(), Path::exists);
    if let Some(first) = candidates.first()
        && dev_log(services, &format!("terminal {} | {}", first.name, target.display()))
    {
        return Ok(OpenedTerminal { terminal: first.name.clone() });
    }
    let mut last_error = String::new();
    for candidate in &candidates {
        match launch(candidate) {
            Ok(()) => return Ok(OpenedTerminal { terminal: candidate.name.clone() }),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(GorynychError::new(ErrorCode::NoTerminal, t("Не удалось открыть терминал", &[]))
        .with_hint(t("Не найден ни один из известных терминалов. Откройте папку вручную.", &[]))
        .with_details(last_error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_candidates_follow_1x() {
        let dir = Path::new("/r/папка");
        let names = |platform, exists: bool| terminal_candidates(dir, platform, |_| exists).into_iter().map(|c| c.name).collect::<Vec<_>>();
        assert_eq!(names(Platform::Mac, true), ["iTerm", "Terminal"]);
        assert_eq!(names(Platform::Mac, false), ["Terminal"]);
        assert_eq!(names(Platform::Windows, false), ["Windows Terminal", "PowerShell", "Командная строка"]);
        assert_eq!(names(Platform::Other, false).len(), 7);
        let windows = terminal_candidates(dir, Platform::Windows, |_| false);
        assert_eq!(windows[0].args, ["-d", &path_text(dir)]);
        assert_eq!(windows[0].cwd, None, "wt получает папку аргументом");
        assert_eq!(windows[2].args, ["/K"]);
        assert_eq!(windows[2].cwd.as_deref(), Some(dir), "cmd.exe — рабочей папкой, без кавычек");
        let other = terminal_candidates(dir, Platform::Other, |_| false);
        assert_eq!(other[1].args, [format!("--working-directory={}", path_text(dir))]);
    }

    #[test]
    fn artifact_name_is_safe_for_windows() {
        let named = |file: Option<&str>, name: Option<&str>| artifact_file_name(&ArtifactDownload { file_name: file.map(str::to_owned), name: name.map(str::to_owned), ..ArtifactDownload::default() });
        assert_eq!(named(None, None), "artifact.zip");
        assert_eq!(named(None, Some("build:linux/x86")), "build_linux_x86.zip");
        assert_eq!(named(Some("a<>|b?.zip"), Some("нет")), "a_b_.zip", "подряд идущие символы — одно подчёркивание");
    }

    #[test]
    fn require_dir_checks_like_1x() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("файл.txt");
        fs::write(&file, "x").unwrap();
        for bad in [None, Some(""), Some(file.to_str().unwrap()), Some("нет-такой-папки")] {
            let error = require_dir(bad).unwrap_err();
            assert_eq!(error.code, ErrorCode::NotFound, "{bad:?}");
            assert_eq!(error.hint.as_deref(), Some(bad.unwrap_or_default()));
        }
        assert!(require_dir(Some(dir.path().to_str().unwrap())).unwrap().is_absolute());
    }

    #[test]
    fn stored_image_rules() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let png = source.path().join("Фон.PNG");
        fs::write(&png, b"png").unwrap();
        let txt = source.path().join("фон.txt");
        fs::write(&txt, b"x").unwrap();
        assert_eq!(store_image(data.path(), &txt).unwrap_err().code, ErrorCode::Unsupported);
        fs::create_dir_all(backgrounds(data.path())).unwrap();
        fs::write(backgrounds(data.path()).join("current.gif"), b"old").unwrap();
        assert_eq!(store_image(data.path(), &png).unwrap(), "Фон.PNG");
        let stored = stored_image(data.path()).unwrap();
        assert_eq!(stored.file_name().unwrap(), "current.png", "расширение в нижнем регистре, старая картинка удалена");
        assert_eq!(mime_of(&stored), "image/png");
        assert_eq!(mime_of(Path::new("current.JPG")), "image/jpeg");
        assert_eq!(mime_of(Path::new("current")), "image/png");
    }

    #[test]
    fn too_large_image_is_refused_with_rounded_size() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let big = source.path().join("big.jpg");
        let file = fs::File::create(&big).unwrap();
        file.set_len(MAX_IMAGE + 600 * 1024).unwrap();
        let error = store_image(data.path(), &big).unwrap_err();
        assert_eq!(error.code, ErrorCode::TooLarge);
        assert_eq!(error.message, "Картинка слишком большая (26 МБ, максимум 25 МБ)");
        assert!(stored_image(data.path()).is_none());
    }

    #[test]
    fn dev_answers_are_consumed_in_order() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(dev_answer(root.path()), None, "нет файла — отмена");
        fs::write(root.path().join("dialog-answers.txt"), "C:\\a\r\n\nC:\\b").unwrap();
        assert_eq!(dev_answer(root.path()), Some(PathBuf::from("C:\\a")));
        assert_eq!(dev_answer(root.path()), None, "пустая строка — отмена");
        assert_eq!(dev_answer(root.path()), Some(PathBuf::from("C:\\b")));
        assert_eq!(dev_answer(root.path()), None);
    }
}
