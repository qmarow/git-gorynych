//! Замер нагрузки горячих путей: `cargo run --release -p gorynych-git --example bench -- <репозиторий> [повторов]`.
//!
//! Печатает время (медиану) и число запущенных процессов git на одну операцию. Процесс на Windows стоит десятки миллисекунд,
//! поэтому их число — главная мера: интерфейс зовёт `quick_status` на каждое изменение файла, а `load_repository` — на каждое
//! изменение в `.git`.

use std::path::PathBuf;
use std::time::Instant;

use gorynych_git::read::{load_repository, quick_status, resolve_repo_root};
use gorynych_git::run::spawned;

async fn measure<F, Fut, T>(name: &str, rounds: usize, mut work: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    work().await; // прогрев: кэш ОС и поиск git
    let mut times = Vec::with_capacity(rounds);
    let before = spawned();
    for _ in 0..rounds {
        let started = Instant::now();
        work().await;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    let per_call = (spawned() - before) as f64 / rounds as f64;
    println!("{name:<18} {:>8.1} мс (медиана), {:>8.1} мс (макс.), процессов git: {per_call:.1}", times[rounds / 2], times[rounds - 1]);
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("путь к репозиторию"));
    let rounds: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(10);
    measure("resolve_repo_root", rounds, || resolve_repo_root(&dir)).await;
    measure("quick_status", rounds, || quick_status(&dir)).await;
    measure("load_repository", rounds, || load_repository(&dir, None)).await;
    let repo = load_repository(&dir, None).await.expect("репозиторий читается");
    let json = serde_json::to_vec(&repo).expect("сериализация");
    println!("load_repository: коммитов {}, JSON для интерфейса {} КБ", repo.commits.len(), json.len() / 1024);
}
