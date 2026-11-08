//! Загрузка и проверка CI-конфигов, Pre-commit Guard (Фаза 2). Готовы: [`guard`], [`js_regex`], [`repo`], [`yaml`], [`yaml_write`], [`detect`], [`load`], [`edit`], [`check`].

#![deny(unsafe_code)]

pub mod check;
pub mod detect;
pub mod edit;
pub mod guard;
pub use gorynych_core::js_regex;
pub mod load;
pub mod repo;
pub mod yaml;
pub mod yaml_write;

pub(crate) use load::common::{as_array as load_common_as_array, non_null as load_common_non_null};
