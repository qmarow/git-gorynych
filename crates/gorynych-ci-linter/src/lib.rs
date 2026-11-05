//! Загрузка и проверка CI-конфигов, Pre-commit Guard (Фаза 2). Готовы: [`guard`], [`js_regex`], [`repo`], [`yaml`], [`yaml_write`], [`detect`], [`load`], [`edit`].

#![deny(unsafe_code)]

pub mod detect;
pub mod edit;
pub mod guard;
pub mod js_regex;
pub mod load;
pub mod repo;
pub mod yaml;
pub mod yaml_write;
