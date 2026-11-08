//! Шифрование секрета GitHub Actions: `electron/cicd/sealedbox.cjs`. `crypto_box_seal` из libsodium: X25519 + XSalsa20-Poly1305,
//! nonce = BLAKE2b-192(эфемерный ключ ‖ ключ репозитория), результат `эфемерный ключ ‖ шифротекст` в base64.
//! Ручной BLAKE2b и `vendor/tweetnacl.cjs` не перенесены; совместимость с ними проверяет `tests/seal_vector.rs`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use crypto_box::aead::OsRng;
use gorynych_core::error::{GorynychError, Result};
use gorynych_core::i18n::t;

/// Шифрует значение открытым ключом репозитория (base64).
pub fn seal(public_key: &str, plaintext: &str) -> Result<String> {
    let bad_key = || GorynychError::unknown(t("Некорректный открытый ключ репозитория", &[]));
    let bytes: [u8; 32] = STANDARD.decode(public_key).map_err(|_| bad_key())?.try_into().map_err(|_| bad_key())?;
    let sealed = crypto_box::PublicKey::from(bytes).seal(&mut OsRng, plaintext.as_bytes()).map_err(|_| bad_key())?;
    Ok(STANDARD.encode(sealed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crypto_box::SecretKey;

    #[test]
    fn sealed_value_opens_with_the_secret_key() {
        let secret = SecretKey::from([7u8; 32]);
        let public = STANDARD.encode(secret.public_key().as_bytes());
        let sealed = STANDARD.decode(seal(&public, "значение").unwrap()).unwrap();
        assert_eq!(secret.unseal(&sealed).unwrap(), "значение".as_bytes());
    }

    #[test]
    fn wrong_key_is_rejected() {
        for key in ["не base64", "AAAA", ""] {
            assert_eq!(seal(key, "x").unwrap_err().code, gorynych_core::ErrorCode::Unknown);
        }
    }
}
