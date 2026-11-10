//! Файл рабочей копии для редактора в окне изменений: прочитать как текст и сохранить. **Нового в 2.0**, в 1.x этого не было.
//!
//! Правила те же, что у сохранения файлов CI (`gorynych_ci_linter::edit::file`):
//! - отпечаток — SHA-1 сырых байтов; при сохранении отпечаток на диске должен совпасть с `baseHash` прочитанной версии, иначе
//!   `CHANGED_ON_DISK` с подсказкой (файл поменяли или удалили, пока он был открыт: внешний редактор, checkout, stash);
//! - текст отдаётся без BOM и с `\n`; при записи возвращаются BOM и окончания строк файла. Если окончания смешаны, берётся то, которого
//!   больше (`mixedEol` — интерфейс предупреждает, что строки будут приведены к одному виду);
//! - запись атомарная: `<путь>.gk-tmp-<pid>` и переименование; права файла (исполняемый бит) переносятся на новый.
//!
//! Чего нельзя (код ошибки): путь вне репозитория или внутри `.git` — `BAD_ARGS`; файла нет или это папка — `NOT_FOUND_PATH`;
//! символическая ссылка — `UNSUPPORTED` (запись заменила бы ссылку обычным файлом); больше [`MAX_EDIT_BYTES`] — `TOO_LARGE`;
//! ноль в первых 8000 байт или не UTF-8 — `BINARY`.

use std::fs;
use std::path::{Path, PathBuf};

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::{self, t};
use gorynych_core::paths::{relative_inside, safe_relative};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::read::resolve_repo_root;

/// Предел для редактора: как у просмотра нового файла (`diff::MAX_UNTRACKED_BYTES`).
pub const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;
const BOM: &str = "\u{FEFF}";

/// Файл для редактора.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeText {
    pub path: String,
    /// Без BOM, строки через `\n`.
    pub text: String,
    /// `"\n"` или `"\r\n"` — с какими окончаниями файл будет записан.
    pub eol: String,
    /// В файле есть и `\r\n`, и одиночные `\n`: при записи они станут одинаковыми (`eol`).
    pub mixed_eol: bool,
    pub bom: bool,
    /// SHA-1 сырых байтов: `baseHash` при сохранении.
    pub hash: String,
}

/// Что сохранить.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSave {
    pub path: String,
    /// Текст из редактора: окончания строк любые, на диск идут окончания файла.
    pub text: String,
    /// Отпечаток прочитанной версии ([`WorktreeText::hash`]).
    pub base_hash: String,
}

/// Результат сохранения.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSaved {
    pub path: String,
    /// Отпечаток записанного: `baseHash` следующего сохранения.
    pub hash: String,
}

fn sha1_hex(bytes: &[u8]) -> String {
    Sha1::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn io_error(error: std::io::Error) -> GorynychError {
    GorynychError::new(ErrorCode::Unknown, error.to_string())
}

/// Путь внутри рабочей копии, не в `.git`.
fn editable_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let full = safe_relative(root, rel, i18n::language())?;
    if relative_inside(root, &full).split('/').any(|part| part.eq_ignore_ascii_case(".git")) {
        return Err(GorynychError::new(ErrorCode::BadArgs, t("Сюда писать нельзя", &[])));
    }
    Ok(full)
}

/// Сырые байты файла с проверками: есть, не папка, не ссылка, не больше предела.
fn read_bytes(full: &Path) -> Result<Vec<u8>> {
    let meta = match fs::symlink_metadata(full) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(GorynychError::new(ErrorCode::NotFoundPath, t("Файл не найден в рабочей папке", &[]))),
        Err(error) => return Err(io_error(error)),
    };
    if meta.file_type().is_symlink() {
        return Err(GorynychError::new(ErrorCode::Unsupported, t("Символическую ссылку нельзя редактировать как файл", &[])));
    }
    if !meta.is_file() {
        return Err(GorynychError::new(ErrorCode::NotFoundPath, t("Файл не найден в рабочей папке", &[])));
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Err(GorynychError::new(ErrorCode::TooLarge, t("Файл слишком большой", &[])));
    }
    fs::read(full).map_err(io_error)
}

/// Байты → текст для редактора.
fn decode(path: &str, bytes: &[u8]) -> Result<WorktreeText> {
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return Err(GorynychError::new(ErrorCode::Binary, t("Двоичный файл нельзя редактировать как текст", &[])));
    }
    let Ok(raw) = std::str::from_utf8(bytes) else {
        return Err(GorynychError::new(ErrorCode::Binary, t("Файл не в кодировке UTF-8 — редактирование недоступно", &[])));
    };
    let (bom, body) = match raw.strip_prefix(BOM) {
        Some(body) => (true, body),
        None => (false, raw),
    };
    let crlf = body.matches("\r\n").count();
    let lf = body.matches('\n').count() - crlf;
    Ok(WorktreeText {
        path: path.to_owned(),
        text: body.replace("\r\n", "\n"),
        eol: if crlf > lf { "\r\n" } else { "\n" }.to_owned(),
        mixed_eol: crlf > 0 && lf > 0,
        bom,
        hash: sha1_hex(bytes),
    })
}

// Модульные тесты — без git: проверяются сами правила. Через настоящий репозиторий — tests/worktree_file.rs, через окно — app_smoke.rs.

/// Прочитать файл рабочей копии `path` (относительно корня репозитория `dir`).
pub async fn read_worktree_file(dir: &Path, path: &str) -> Result<WorktreeText> {
    let root = resolve_repo_root(dir).await?;
    let full = editable_path(&root, path)?;
    let path = path.to_owned();
    blocking(move || decode(&path, &read_bytes(&full)?)).await
}

/// Сохранить текст редактора в файл рабочей копии.
pub async fn save_worktree_file(dir: &Path, request: &WorktreeSave) -> Result<WorktreeSaved> {
    let root = resolve_repo_root(dir).await?;
    let full = editable_path(&root, &request.path)?;
    let request = request.clone();
    blocking(move || save(&full, &request)).await
}

fn save(full: &Path, request: &WorktreeSave) -> Result<WorktreeSaved> {
    let changed = || {
        GorynychError::new(ErrorCode::ChangedOnDisk, t("Файл изменился на диске, пока вы его редактировали", &[]))
            .with_hint(t("Нажмите «Перечитать», чтобы загрузить свежую версию, или сохраните поверх (ваши правки заменят изменения на диске).", &[]))
    };
    let current = match read_bytes(full) {
        Ok(bytes) => bytes,
        // Файл удалили, пока он был открыт: это тоже «изменился на диске», а не повод создать его заново
        Err(error) if error.code == ErrorCode::NotFoundPath => return Err(changed()),
        Err(error) => return Err(error),
    };
    if sha1_hex(&current) != request.base_hash {
        return Err(changed());
    }
    let state = decode(&request.path, &current)?;
    let mut out = request.text.replace("\r\n", "\n");
    if state.eol == "\r\n" {
        out = out.replace('\n', "\r\n");
    }
    if state.bom {
        out.insert_str(0, BOM);
    }
    if out.len() as u64 > MAX_EDIT_BYTES {
        return Err(GorynychError::new(ErrorCode::TooLarge, t("Файл слишком большой", &[])));
    }
    let mut temp = full.as_os_str().to_owned();
    temp.push(format!(".gk-tmp-{}", std::process::id()));
    let temp = PathBuf::from(temp);
    let write = || -> std::io::Result<()> {
        fs::write(&temp, out.as_bytes())?;
        fs::set_permissions(&temp, fs::metadata(full)?.permissions())?;
        fs::rename(&temp, full)
    };
    if let Err(error) = write() {
        let _ = fs::remove_file(&temp);
        return Err(io_error(error));
    }
    Ok(WorktreeSaved { path: request.path.clone(), hash: sha1_hex(out.as_bytes()) })
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(work).await.map_err(GorynychError::unknown)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        dir
    }

    #[test]
    fn decode_keeps_bom_and_line_endings() {
        let file = decode("a.txt", "\u{FEFF}раз\r\nдва\r\n".as_bytes()).unwrap();
        assert_eq!((file.text.as_str(), file.eol.as_str(), file.bom, file.mixed_eol), ("раз\nдва\n", "\r\n", true, false));
        let mixed = decode("b.txt", b"a\r\nb\nc\n").unwrap();
        assert_eq!((mixed.eol.as_str(), mixed.mixed_eol), ("\n", true));
        assert_eq!(decode("c", b"x\0y").unwrap_err().code, ErrorCode::Binary);
        assert_eq!(decode("d", &[0xff, 0xfe, b'a']).unwrap_err().code, ErrorCode::Binary);
        assert_eq!(decode("e", b"").unwrap().text, "");
    }

    #[test]
    fn save_restores_file_format_and_checks_hash() {
        let dir = repo();
        let root = dir.path();
        let full = root.join("a.txt");
        fs::write(&full, "\u{FEFF}раз\r\nдва\r\n").unwrap();
        let read = decode("a.txt", &read_bytes(&full).unwrap()).unwrap();

        let saved = save(&full, &WorktreeSave { path: "a.txt".into(), text: "раз\nтри\n".into(), base_hash: read.hash.clone() }).unwrap();
        assert_eq!(fs::read_to_string(&full).unwrap(), "\u{FEFF}раз\r\nтри\r\n");
        assert_eq!(saved.hash, sha1_hex(&fs::read(&full).unwrap()));
        assert!(!root.join(format!("a.txt.gk-tmp-{}", std::process::id())).exists());

        // Старый отпечаток — файл уже другой
        let stale = save(&full, &WorktreeSave { path: "a.txt".into(), text: "x".into(), base_hash: read.hash }).unwrap_err();
        assert_eq!(stale.code, ErrorCode::ChangedOnDisk);
        assert!(stale.hint.is_some());
        assert_eq!(fs::read_to_string(&full).unwrap(), "\u{FEFF}раз\r\nтри\r\n", "файл не тронут");

        // Удалён, пока был открыт
        fs::remove_file(&full).unwrap();
        assert_eq!(save(&full, &WorktreeSave { path: "a.txt".into(), text: "x".into(), base_hash: saved.hash }).unwrap_err().code, ErrorCode::ChangedOnDisk);
        assert!(!full.exists(), "не создаётся заново");
    }

    #[test]
    fn paths_and_kinds_are_checked() {
        let dir = repo();
        let root = dir.path();
        assert_eq!(editable_path(root, ".git/config").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(editable_path(root, "sub/.GIT/x").unwrap_err().code, ErrorCode::BadArgs);
        assert_eq!(editable_path(root, "../outside.txt").unwrap_err().code, ErrorCode::BadArgs);
        assert!(editable_path(root, "src/.gitignore").is_ok(), ".gitignore — обычный файл");

        assert_eq!(read_bytes(&root.join("нет.txt")).unwrap_err().code, ErrorCode::NotFoundPath);
        fs::create_dir(root.join("папка")).unwrap();
        assert_eq!(read_bytes(&root.join("папка")).unwrap_err().code, ErrorCode::NotFoundPath);
        let big = root.join("big.txt");
        fs::write(&big, vec![b'a'; MAX_EDIT_BYTES as usize + 1]).unwrap();
        assert_eq!(read_bytes(&big).unwrap_err().code, ErrorCode::TooLarge);
    }

    #[cfg(unix)]
    #[test]
    fn executable_bit_survives_save_and_symlinks_are_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = repo();
        let full = dir.path().join("run.sh");
        fs::write(&full, "echo 1\n").unwrap();
        fs::set_permissions(&full, fs::Permissions::from_mode(0o755)).unwrap();
        let hash = sha1_hex(&fs::read(&full).unwrap());
        save(&full, &WorktreeSave { path: "run.sh".into(), text: "echo 2\n".into(), base_hash: hash }).unwrap();
        assert_eq!(fs::metadata(&full).unwrap().permissions().mode() & 0o777, 0o755);
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&full, &link).unwrap();
        assert_eq!(read_bytes(&link).unwrap_err().code, ErrorCode::Unsupported);
    }
}
