//! Единая SQLite вместо JSON-файлов и `localStorage` из 1.x.
#![forbid(unsafe_code)]

pub mod askpass;
pub mod credentials;
pub mod custom_actions;
pub mod db;
pub mod preferences;
pub mod repo_providers;
pub mod secrets;
pub mod ssh_keys;
pub mod undo;
pub mod workspaces;

pub use db::Db;
