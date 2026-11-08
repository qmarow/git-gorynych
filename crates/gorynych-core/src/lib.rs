//! Ядро git-Горыныч 2.0: ошибки и классификатор stderr git, локализация, построчный diff.
#![forbid(unsafe_code)]

pub mod error;
pub mod i18n;
pub mod js;
pub mod js_regex;
pub mod line_diff;
pub mod paths;

pub use error::{ErrorCode, GorynychError, Result};
pub use i18n::Language;
