//! Чтение `localStorage` профиля Electron 1.x из его LevelDB.
//!
//! # Формат (проверен на Electron 37, см. `tests/electron_migration.rs`)
//! - Каталог `Local Storage/leveldb`. Ключ: `_<origin>\0` + байт кодировки + имя. Значение: байт кодировки + текст.
//! - Кодировка: `0` — UTF-16 LE, `1` — Latin-1. Записи `META:` и `VERSION` — служебные.
//! - Рабочая версия 1.x грузит страницу через `loadFile`, поэтому берётся только origin `file://`. Значения от
//!   сервера разработки (`http://localhost`) не переносятся.
//!
//! LevelDB при открытии меняет файлы, а старый профиль нельзя портить: читается копия.

use std::fs;
use std::path::Path;

use rusty_leveldb::{DB, LdbIterator, Options};

const FILE_ORIGIN_PREFIX: &[u8] = b"_file://\0";

fn decode(bytes: &[u8]) -> Option<String> {
    let (kind, rest) = bytes.split_first()?;
    match kind {
        0 => {
            let units: Vec<u16> = rest.as_chunks::<2>().0.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
            String::from_utf16(&units).ok()
        }
        1 => Some(rest.iter().map(|byte| char::from(*byte)).collect()),
        _ => None,
    }
}

fn copy_database(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        // LOCK удерживает работающий 1.x, он не нужен
        if entry.file_type()?.is_file() && entry.file_name() != "LOCK" {
            fs::copy(entry.path(), target.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn read_database(path: &Path) -> Result<Vec<(String, String)>, String> {
    let options = Options { create_if_missing: false, ..Options::default() };
    let mut db = DB::open(path, options).map_err(|error| error.to_string())?;
    let mut iter = db.new_iter().map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    while let Some((key, value)) = iter.next() {
        let Some(name) = key.strip_prefix(FILE_ORIGIN_PREFIX) else {
            continue;
        };
        if let (Some(name), Some(value)) = (decode(name), decode(&value)) {
            items.push((name, value));
        }
    }
    Ok(items)
}

/// Значения `localStorage` профиля. `work_dir` — пустая папка для копии, после чтения удаляется.
/// Нет базы — пустой список: профиль мог ни разу не открывать окно.
pub fn read_local_storage(profile: &Path, work_dir: &Path) -> Result<Vec<(String, String)>, String> {
    let source = profile.join("Local Storage").join("leveldb");
    if !source.is_dir() {
        return Ok(Vec::new());
    }
    let result = copy_database(&source, work_dir).map_err(|error| error.to_string()).and_then(|()| read_database(work_dir));
    let _ = fs::remove_dir_all(work_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Vec<u8> {
        let mut bytes = vec![0];
        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        bytes
    }

    fn latin1(text: &str) -> Vec<u8> {
        let mut bytes = vec![1];
        bytes.extend(text.chars().map(|c| c as u8));
        bytes
    }

    fn key(origin: &str, name: Vec<u8>) -> Vec<u8> {
        let mut bytes = format!("_{origin}\0").into_bytes();
        bytes.extend(name);
        bytes
    }

    fn write_profile(profile: &Path) {
        let dir = profile.join("Local Storage").join("leveldb");
        fs::create_dir_all(&dir).unwrap();
        let mut db = DB::open(&dir, Options::default()).unwrap();
        db.put(b"VERSION", b"1").unwrap();
        db.put(b"META:file://", b"x").unwrap();
        db.put(&key("file://", latin1("pullMode")), &latin1("rebase")).unwrap();
        db.put(&key("file://", utf16("имя")), &utf16("значение 🔑")).unwrap();
        db.put(&key("file://", latin1("caf\u{e9}")), &latin1("\u{e9}")).unwrap();
        db.put(&key("http://localhost:5173", latin1("dev")), &latin1("не наш origin")).unwrap();
        db.put(&key("file://", vec![9, 1]), &latin1("неизвестная кодировка")).unwrap();
        db.flush().unwrap();
    }

    #[test]
    fn reads_both_encodings_from_file_origin_only() {
        let dir = tempfile::tempdir().unwrap();
        write_profile(dir.path());
        let work = dir.path().join("work");
        let mut items = read_local_storage(dir.path(), &work).unwrap();
        items.sort();
        let expected = [("caf\u{e9}", "\u{e9}"), ("pullMode", "rebase"), ("имя", "значение 🔑")];
        assert_eq!(items, expected.map(|(a, b)| (a.to_owned(), b.to_owned())));
        assert!(!work.exists(), "копия удалена");
    }

    #[test]
    fn source_files_stay_byte_identical() {
        let dir = tempfile::tempdir().unwrap();
        write_profile(dir.path());
        let snapshot = |profile: &Path| -> Vec<(String, Vec<u8>)> {
            let mut files: Vec<_> = fs::read_dir(profile.join("Local Storage").join("leveldb"))
                .unwrap()
                .flatten()
                .map(|entry| (entry.file_name().to_string_lossy().into_owned(), fs::read(entry.path()).unwrap()))
                .collect();
            files.sort();
            files
        };
        let before = snapshot(dir.path());
        read_local_storage(dir.path(), &dir.path().join("work")).unwrap();
        assert_eq!(snapshot(dir.path()), before);
    }

    #[test]
    fn missing_database_is_empty_and_broken_one_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_local_storage(dir.path(), &dir.path().join("work")).unwrap().is_empty());

        let broken = dir.path().join("Local Storage").join("leveldb");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("CURRENT"), "MANIFEST-999999\n").unwrap();
        assert!(read_local_storage(dir.path(), &dir.path().join("work")).is_err());
    }

    #[test]
    fn decode_rejects_malformed_values() {
        assert_eq!(decode(b""), None);
        assert_eq!(decode(&[0, 0x00, 0xD8]), None, "одинокий суррогат");
        assert_eq!(decode(&[7, b'x']), None);
        assert_eq!(decode(&[1]).as_deref(), Some(""));
    }
}
