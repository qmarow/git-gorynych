//! Git-движок: перенос `electron/git.cjs`, `actions.cjs`, `conflicts.cjs`, `fileHistory.cjs`, `compare.cjs`, `restore.cjs`, `rebase.cjs`, `init.cjs`, `clone.cjs`.
//!
//! - [`actions`] — все изменяющие и сетевые действия, история Undo/Redo: [`actions::RepoEngine`] и [`actions::RepoAction`].
//! - [`network`] — окружение сетевых команд и учётные данные.
//! - [`restore`] — откат файла и фрагмента, снимки для Undo.
//! - [`rebase`] — предпросмотр и настоящий `git rebase -i`, редактор для git.
//! - [`init`] — инициализация папки и подключение к серверу.
//! - [`clone`] — клонирование с прогрессом и отменой.
//! - [`run`] — запуск `git` и поиск программы.
//! - [`read`] — ветки, история, рабочая копия, файлы коммита, stash.
//! - [`diff`] — diff одного файла.
//! - [`write`] — индекс, коммит, шаблон сообщения, журнал ветки.
//! - [`conflicts`] — разрешение конфликтов.
//! - [`history`] — история файла, авторство, поповер коммита.
//! - [`compare`] — сравнение коммитов и поиск по изменениям.
//! - [`gitflow`] — настройки git flow.
//!
//! Пока всё идёт теми же вызовами `git`, что и в 1.x, и закреплено эталонами `tests/fixtures/gen-git-parity.cjs` и `gen-actions-parity.cjs`. Чтение через `gix` и `imara-diff`
//! и симуляция через `git2` из плана подключаются потом за этим же API: эталон покажет любое изменение поведения.

pub mod actions;
pub mod clone;
mod common;
pub mod compare;
pub mod conflicts;
pub mod diff;
pub mod gitflow;
pub mod history;
pub mod init;
pub mod network;
pub mod read;
pub mod rebase;
pub mod restore;
pub mod run;
pub mod write;
