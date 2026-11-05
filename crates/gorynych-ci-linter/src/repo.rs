//! Что линтеру нужно от репозитория. `ci-linter` не зависит от `gorynych-git` (см. граф в `CLAUDE.md`):
//! реализация появится в Фазе 3, а методы добавляются по мере переноса `ci.cjs` и `ciCheck*.cjs`.

use gorynych_core::error::Result;

/// Чтение репозитория для линтера.
pub trait RepoView {
    /// Вывод `git` с аргументами [`crate::guard::STAGED_DIFF_ARGS`]. Ошибка git — с её `details`, как у `fromProcessError`.
    fn staged_diff(&self) -> Result<String>;

    /// Вывод `git` с аргументами [`crate::load::CI_LOG_ARGS`], затем `--` и `paths`. Репозиторий без коммитов — ошибка или пустой вывод.
    fn ci_log(&self, paths: &[String]) -> Result<String>;

    /// Вывод `git` с аргументами [`crate::load::CI_STATUS_ARGS`] и [`crate::load::CI_STATUS_UNTRACKED`], затем `--` и `paths`.
    fn ci_status(&self, paths: &[String]) -> Result<String>;
}
