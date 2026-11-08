//! Наблюдение за репозиторием.
//!
//! - [`watch`] — изменения в `.git` и рабочей папке (`electron/watch.cjs`).
//! - [`index_sync`] — индекс после правок из других программ (`electron/indexSync.cjs`).
//! - [`remote_watch`] — лёгкая проверка сервера (`electron/remoteWatch.cjs`).

pub mod index_sync;
pub mod remote_watch;
pub mod watch;
