//! Хранилище секретов: системный Keyring. Заменяет `safeStorage` (`encrypt`/`decrypt`) из `electron/credentials.cjs`.
//!
//! # Конспект исходника
//! - `encrypt`: нет шифрования → `NO_ENCRYPTION` «Шифрование недоступно в системе — данные нельзя сохранить безопасно».
//! - `decrypt`: любая ошибка → `null` («зашифровано под другим пользователем — нужно ввести заново»). Поэтому
//!   [`SecretStore::get`] при сбое чтения тоже даёт `None`: UI покажет «введите заново», а не ошибку.
//! - Режим `plain` для `GK_TEST_USERDATA` не переносится: для тестов есть трейт [`SecretStore`].
//!
//! # Ограничение Windows
//! Credential Manager хранит не больше 2560 байт на запись (в 1.x длина не ограничивалась). Более длинный токен, например
//! OAuth в виде JWT, вернёт `NO_ENCRYPTION`, а причина будет в `details`.

use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n::t;

/// Имя сервиса в системном хранилище.
pub const SERVICE: &str = "com.ironxenot.gitgorynych";

/// Хранилище секретов. Ключ записи — случайный идентификатор из [`new_account`].
pub trait SecretStore: Send + Sync {
    /// Секрет записи; `None`, если записи нет или её нельзя прочитать.
    fn get(&self, account: &str) -> Option<String>;

    /// Создаёт или заменяет запись.
    fn set(&self, account: &str, secret: &str) -> Result<()>;

    /// Удаляет запись. Отсутствие записи ошибкой не считается.
    fn delete(&self, account: &str) -> Result<()>;
}

fn encryption_error(error: impl std::fmt::Display) -> GorynychError {
    GorynychError::new(
        ErrorCode::NoEncryption,
        t("Шифрование недоступно в системе — данные нельзя сохранить безопасно", &[]),
    )
    .with_details(error.to_string())
}

/// 256 случайных бит в шестнадцатеричном виде.
pub fn random_hex() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(encryption_error)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Случайный идентификатор записи. Секрет и данные входа из него не восстановить.
pub fn new_account() -> Result<String> {
    let hex = random_hex()?;
    Ok(format!("login-{}", &hex[..32]))
}

/// Системное хранилище: Windows Credential Manager, macOS Keychain или Secret Service.
#[derive(Debug, Clone)]
pub struct KeyringStore {
    service: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self { service: SERVICE.to_owned() }
    }
}

impl KeyringStore {
    /// Хранилище под другим именем сервиса: только для проверки на настоящей системе.
    pub fn with_service(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self, account: &str) -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(&self.service, account)
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Option<String> {
        self.entry(account).and_then(|entry| entry.get_password()).ok()
    }

    fn set(&self, account: &str, secret: &str) -> Result<()> {
        self.entry(account).and_then(|entry| entry.set_password(secret)).map_err(encryption_error)
    }

    fn delete(&self, account: &str) -> Result<()> {
        match self.entry(account).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(encryption_error(error)),
        }
    }
}

#[cfg(test)]
pub(crate) mod memory {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Хранилище в памяти. Умеет отказывать в записи, как система без Keyring.
    #[derive(Default)]
    pub(crate) struct MemoryStore {
        pub(crate) values: Mutex<HashMap<String, String>>,
        pub(crate) fail_writes: std::sync::atomic::AtomicBool,
    }

    impl SecretStore for MemoryStore {
        fn get(&self, account: &str) -> Option<String> {
            self.values.lock().unwrap().get(account).cloned()
        }

        fn set(&self, account: &str, secret: &str) -> Result<()> {
            if self.fail_writes.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(encryption_error("запись запрещена тестом"));
            }
            self.values.lock().unwrap().insert(account.to_owned(), secret.to_owned());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<()> {
            self.values.lock().unwrap().remove(account);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_are_random_and_reveal_nothing() {
        let (a, b) = (new_account().unwrap(), new_account().unwrap());
        assert_ne!(a, b);
        assert_eq!(a.len(), "login-".len() + 32);
    }

    /// Пишет в настоящее системное хранилище и сразу удаляет запись:
    /// `cargo test -p gorynych-storage -- --ignored real_keyring`
    #[test]
    #[ignore = "обращается к системному хранилищу секретов"]
    fn real_keyring_round_trip() {
        let store = KeyringStore::with_service("com.ironxenot.gitgorynych.selftest");
        let account = new_account().unwrap();
        assert_eq!(store.get(&account), None);
        store.set(&account, "пароль-🔑").unwrap();
        assert_eq!(store.get(&account).as_deref(), Some("пароль-🔑"));
        store.set(&account, "второй").unwrap();
        assert_eq!(store.get(&account).as_deref(), Some("второй"));
        store.delete(&account).unwrap();
        assert_eq!(store.get(&account), None);
        store.delete(&account).unwrap();

        let too_long = "x".repeat(4000);
        let error = store.set(&account, &too_long).unwrap_err();
        assert_eq!(error.code, ErrorCode::NoEncryption);
    }
}
