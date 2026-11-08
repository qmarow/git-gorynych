//! Контракт типов для интерфейса и проверка ключей перевода.

use std::path::{Path, PathBuf};

use gorynych_git::actions::{ActionOutput, RepoAction};
use gorynych_git::clone::{CloneProbe, CloneProgress, CloneRequest, Cloned};
use gorynych_git::compare::{ChangeSearch, Comparison, HistorySearch, SearchChanges, SearchHistory};
use gorynych_git::init::{ConnectOptions, ConnectResult, FolderInfo, InitOptions, InitResult, ProbeRemote, RemoteProbe};
use gorynych_git::rebase::{RebasePreview, RebaseRequest};
use gorynych_git::conflicts::{ConflictInfo, MarkResolved, ResolveResult, ResolveWhole, SaveResolution};
use gorynych_git::diff::{FileDiff, FileDiffRequest, ParsedDiff};
use gorynych_git::history::{Blame, BlameRequest, CommitInfo, CommitInfoRequest, FileHistory, FileHistoryRequest};
use gorynych_git::read::{CommitFile, QuickStatus, RefsInfo, Repository, StashDetails};
use gorynych_git::write::{BranchLog, BranchLogRequest, CommitResult, CommitTemplate, PathsArg};
use specta::Types;
use specta_typescript::Typescript;

#[test]
fn types_export_with_1x_field_names() {
    let types = Types::default()
        .register::<Repository>()
        .register::<RefsInfo>()
        .register::<QuickStatus>()
        .register::<CommitFile>()
        .register::<StashDetails>()
        .register::<FileDiff>()
        .register::<FileDiffRequest>()
        .register::<ParsedDiff>()
        .register::<CommitResult>()
        .register::<CommitTemplate>()
        .register::<BranchLog>()
        .register::<BranchLogRequest>()
        .register::<PathsArg>()
        .register::<ConflictInfo>()
        .register::<SaveResolution>()
        .register::<ResolveWhole>()
        .register::<MarkResolved>()
        .register::<ResolveResult>()
        .register::<FileHistory>()
        .register::<FileHistoryRequest>()
        .register::<Blame>()
        .register::<BlameRequest>()
        .register::<CommitInfo>()
        .register::<CommitInfoRequest>()
        .register::<Comparison>()
        .register::<ChangeSearch>()
        .register::<SearchChanges>()
        .register::<HistorySearch>()
        .register::<SearchHistory>()
        .register::<RepoAction>()
        .register::<ActionOutput>()
        .register::<RebaseRequest>()
        .register::<RebasePreview>()
        .register::<FolderInfo>()
        .register::<InitOptions>()
        .register::<InitResult>()
        .register::<ConnectOptions>()
        .register::<ConnectResult>()
        .register::<ProbeRemote>()
        .register::<RemoteProbe>()
        .register::<CloneRequest>()
        .register::<CloneProgress>()
        .register::<CloneProbe>()
        .register::<Cloned>();
    let text = Typescript::default().export(&types, specta_serde::PhasesFormat).unwrap();
    for field in ["canWrite", "writeError", "targetRef", "autoStash", "checkedOut", "dirtyCount", "pushedCount", "oldHead", "newHead", "identicalFiles", "isRepoRoot", "gitignorePreview", "remoteWasEmpty", "pushError", "phasePercent", "remoteBranch", "sourcePath", "currentBranch","localBranches", "wipFiles", "headHash", "upstreamRemote", "upstreamRef", "fullName", "isHead", "oldPath", "diffHash", "diffParent", "eolOnly", "tooLarge", "ignoreWhitespace", "finalNewline", "deletedSide", "keepSide", "oursLabel", "startLine", "origLine", "fileStat", "mergeBase", "onlyA", "commitsB", "moreFiles", "caseSensitive"] {
        assert!(text.contains(field), "нет поля {field} в типах");
    }
    assert!(!text.contains("local_branches"));
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn every_translation_key_exists() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dictionary: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(manifest.join("../../electron/i18n/en.json")).unwrap()).unwrap();
    let call = regex::Regex::new(r#"\bt\(\s*"((?:[^"\\]|\\.)*)""#).unwrap();
    let mut files = Vec::new();
    rust_files(&manifest.join("src"), &mut files);
    let (mut checked, mut missing) = (0, Vec::new());
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for caps in call.captures_iter(&text) {
            let key = caps[1].replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\");
            checked += 1;
            if !dictionary.contains_key(&key) {
                missing.push(format!("{}: {key}", file.display()));
            }
        }
    }
    assert!(checked >= 50, "шаблон перестал находить ключи: {checked}");
    assert!(missing.is_empty(), "нет в словаре:\n{}", missing.join("\n"));
}
