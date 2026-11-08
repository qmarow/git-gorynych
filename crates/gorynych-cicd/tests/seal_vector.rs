//! Совместимость шифрования с 1.x: то, что запечатал настоящий `sealedbox.cjs`, открывается ключом здесь, а новое значение раскрывает тот же алгоритм.
//! GitHub и libsodium используют именно `crypto_box_seal`, поэтому совпадение с `tweetnacl` + BLAKE2b из 1.x и есть проверка протокола.
//! Эталон: `node crates/gorynych-cicd/tests/fixtures/gen-seal-vector.cjs`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use crypto_box::SecretKey;
use gorynych_cicd::seal::seal;
use serde_json::Value;

fn vector() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/seal-vector.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn secret_key(data: &Value) -> SecretKey {
    let bytes: [u8; 32] = STANDARD.decode(data["secret"].as_str().unwrap()).unwrap().try_into().unwrap();
    SecretKey::from(bytes)
}

#[test]
fn opens_what_1x_sealed() {
    let data = vector();
    let secret = secret_key(&data);
    assert_eq!(STANDARD.encode(secret.public_key().as_bytes()), data["publicKey"].as_str().unwrap(), "тот же открытый ключ");
    for item in data["sealed"].as_array().unwrap() {
        let sealed = STANDARD.decode(item["sealed"].as_str().unwrap()).unwrap();
        assert_eq!(secret.unseal(&sealed).unwrap(), item["value"].as_str().unwrap().as_bytes());
    }
}

#[test]
fn sealed_here_has_the_same_form() {
    let data = vector();
    let secret = secret_key(&data);
    for item in data["sealed"].as_array().unwrap() {
        let value = item["value"].as_str().unwrap();
        let sealed = STANDARD.decode(seal(data["publicKey"].as_str().unwrap(), value).unwrap()).unwrap();
        assert_eq!(sealed.len(), STANDARD.decode(item["sealed"].as_str().unwrap()).unwrap().len(), "длина как у 1.x: эфемерный ключ, тег, данные");
        assert_eq!(secret.unseal(&sealed).unwrap(), value.as_bytes());
    }
}
