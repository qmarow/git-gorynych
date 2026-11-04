//! Расшифровка `safeStorage` из Electron 1.x: чтобы при обновлении не пришлось вводить пароли заново.
//!
//! # Формат (проверен на Electron 37 / Chromium 138, см. `tests/electron_migration.rs`)
//! - `Local State` → `os_crypt.encrypted_key`: base64 от `DPAPI` + блоб `CryptProtectData`; внутри ключ AES-256.
//! - Значение `enc`: base64 от `v10` + 12 байт nonce + шифротекст + 16 байт тега, AES-256-GCM без доп. данных.
//! - Значение без префикса `v10` записано старым Chromium напрямую через DPAPI.
//!
//! Блоб DPAPI привязан к учётной записи Windows. Под другим пользователем расшифровка не удастся, и запись станет
//! «нужно ввести заново» — как `decrypt() === null` в 1.x. На macOS и Linux расшифровка не реализована и тоже даёт `None`:
//! там ключ в Keychain или Secret Service, формат не проверялся.

use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

const V10: &[u8] = b"v10";
const DPAPI_PREFIX: &[u8] = b"DPAPI";
const NONCE_LEN: usize = 12;

/// Расшифровывает значения `{enc}` из файлов 1.x.
pub struct LegacyDecryptor {
    key: Option<Vec<u8>>,
}

impl LegacyDecryptor {
    /// Читает ключ из `Local State` профиля. Ключа нет — останется только прямая расшифровка DPAPI.
    pub fn for_profile(profile: &Path) -> Self {
        Self { key: read_key(profile) }
    }

    /// Расшифровывает значение `enc`; `None` — прочитать нельзя.
    pub fn decrypt(&self, encoded: &str) -> Option<String> {
        let data = STANDARD.decode(encoded).ok()?;
        let plain = match data.strip_prefix(V10) {
            Some(rest) => decrypt_aes(self.key.as_deref()?, rest)?,
            None => dpapi::unprotect(&data)?,
        };
        String::from_utf8(plain).ok()
    }
}

fn read_key(profile: &Path) -> Option<Vec<u8>> {
    let text = fs::read_to_string(profile.join("Local State")).ok()?;
    let state: serde_json::Value = serde_json::from_str(&text).ok()?;
    let encoded = state.get("os_crypt")?.get("encrypted_key")?.as_str()?;
    let blob = STANDARD.decode(encoded).ok()?;
    dpapi::unprotect(blob.strip_prefix(DPAPI_PREFIX)?)
}

fn decrypt_aes(key: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return None;
    }
    let (nonce, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt(&Nonce::try_from(nonce).ok()?, ciphertext).ok()
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod dpapi {
    //! Единственное место крейта с `unsafe`: вызов CryptoAPI Windows.
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData};

    pub(super) fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(data.len()).ok()?, pbData: data.as_ptr().cast_mut() };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        // SAFETY: `input` указывает на живой срез, CryptoAPI его не меняет. При успехе `output` заполнен буфером системы,
        // который копируется и освобождается через LocalFree, как требует документация.
        unsafe {
            let ok = CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return None;
            }
            let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            Some(plain)
        }
    }

    #[cfg(test)]
    pub(super) fn protect(data: &[u8]) -> Vec<u8> {
        use windows_sys::Win32::Security::Cryptography::CryptProtectData;
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr().cast_mut() };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        // SAFETY: см. `unprotect`.
        unsafe {
            let ok = CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            assert_ne!(ok, 0, "CryptProtectData");
            let blob = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            blob
        }
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub(super) fn unprotect(_data: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7; 32];
    const NONCE: [u8; 12] = [9; 12];

    fn encrypt_v10(text: &str) -> String {
        let cipher = Aes256Gcm::new_from_slice(&KEY).unwrap();
        let ciphertext = cipher.encrypt(&Nonce::try_from(&NONCE[..]).unwrap(), text.as_bytes()).unwrap();
        STANDARD.encode([V10, &NONCE, &ciphertext].concat())
    }

    fn profile_with_key(dir: &Path) {
        let blob = [DPAPI_PREFIX, &dpapi::protect(&KEY)].concat();
        let state = serde_json::json!({ "os_crypt": { "encrypted_key": STANDARD.encode(blob) } });
        fs::write(dir.join("Local State"), state.to_string()).unwrap();
    }

    #[test]
    fn decrypts_v10_and_direct_dpapi() {
        let dir = tempfile::tempdir().unwrap();
        profile_with_key(dir.path());
        let decryptor = LegacyDecryptor::for_profile(dir.path());
        assert_eq!(decryptor.decrypt(&encrypt_v10("пароль 🔑")).as_deref(), Some("пароль 🔑"));
        let direct = STANDARD.encode(dpapi::protect("старый формат".as_bytes()));
        assert_eq!(decryptor.decrypt(&direct).as_deref(), Some("старый формат"));
    }

    #[test]
    fn tampered_or_foreign_data_is_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        profile_with_key(dir.path());
        let decryptor = LegacyDecryptor::for_profile(dir.path());

        let mut bytes = STANDARD.decode(encrypt_v10("секрет")).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        assert_eq!(decryptor.decrypt(&STANDARD.encode(&bytes)), None, "тег GCM не сошёлся");

        for garbage in ["не base64!", "", "AAAA", &STANDARD.encode(b"v10"), &STANDARD.encode(b"v10short")] {
            assert_eq!(decryptor.decrypt(garbage), None, "{garbage}");
        }
    }

    #[test]
    fn missing_or_broken_key_is_unreadable_not_an_error() {
        let encoded = encrypt_v10("секрет");
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(LegacyDecryptor::for_profile(dir.path()).decrypt(&encoded), None, "нет Local State");

        for broken in ["{не json", "{}", r#"{"os_crypt":{}}"#, r#"{"os_crypt":{"encrypted_key":"AAAA"}}"#] {
            fs::write(dir.path().join("Local State"), broken).unwrap();
            assert_eq!(LegacyDecryptor::for_profile(dir.path()).decrypt(&encoded), None, "{broken}");
        }
    }
}
