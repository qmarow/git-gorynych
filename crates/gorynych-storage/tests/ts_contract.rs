//! Типы, пересекающие IPC, должны экспортироваться в TypeScript с теми же именами полей, что в 1.x.

use gorynych_storage::custom_actions::CustomAction;
use gorynych_storage::preferences::Appearance;
use gorynych_storage::repo_providers::RepoProvider;
use gorynych_storage::undo::HistorySummary;
use gorynych_storage::workspaces::{RecentRepo, TabsState};
use specta::Types;
use specta_typescript::Typescript;

#[test]
fn ipc_types_export_with_1x_field_names() {
    let types = Types::default()
        .register::<Appearance>()
        .register::<CustomAction>()
        .register::<RepoProvider>()
        .register::<HistorySummary>()
        .register::<RecentRepo>()
        .register::<TabsState>();
    let ts = Typescript::default().export(&types, specta_serde::Format).expect("типы экспортируются в TypeScript");
    for field in ["imageBlur", "openedAt", "apiBase", "savedAt", "hotkey", "\"gitlab\"", "type: string", "boolean | string"] {
        assert!(ts.contains(field), "нет «{field}» в:\n{ts}");
    }
}
