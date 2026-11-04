//! Единая SQLite вместо JSON-файлов и `localStorage` из 1.x.
#![forbid(unsafe_code)]

pub mod custom_actions;
pub mod db;
pub mod preferences;
pub mod repo_providers;
pub mod undo;
pub mod workspaces;

pub use db::Db;
