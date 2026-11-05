//! Правка файлов CI: `electron/ciEdit.cjs`. [`file`] — чтение и сохранение, [`apply_edit`] — визуальные правки GitLab CI.

pub mod file;
mod ops;
mod text;

pub use ops::{CiEditOp, CiEditResult, apply_edit};
