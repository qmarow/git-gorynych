//! Контракт с UI на уровне TypeScript: то, что увидит `tauri-specta`, совпадает с JSON из 1.x.

use gorynych_core::line_diff::FileDiff;
use gorynych_core::{ErrorCode, GorynychError, Language};
use specta::Types;
use specta_typescript::Typescript;

fn bindings() -> String {
    let types = Types::default()
        .register::<GorynychError>()
        .register::<FileDiff>()
        .register::<Language>();
    Typescript::default().export(&types, specta_serde::Format).expect("типы экспортируются в TypeScript")
}

#[test]
fn error_code_is_a_union_of_wire_strings() {
    let ts = bindings();
    for code in ErrorCode::ALL {
        assert!(ts.contains(&format!("\"{code}\"")), "нет кода {code} в:\n{ts}");
    }
}

#[test]
fn stdout_stays_private_and_shapes_match_1x() {
    let ts = bindings();
    assert!(!ts.contains("stdout"), "stdout не должен попасть в UI:\n{ts}");
    assert!(ts.contains("hint: string | null"), "{ts}");
    assert!(ts.contains("data?:"), "{ts}");
    assert!(ts.contains("Language = \"ru\" | \"en\""), "{ts}");
    assert!(ts.contains("\" \" | \"-\" | \"+\""), "{ts}");
}
