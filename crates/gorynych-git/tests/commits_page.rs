//! Догрузка истории графа (`read::read_commits_page`, новое в 2.0): порции склеиваются в тот же список, что один запрос,
//! отпечаток порции — отпечаток ссылок без предела.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use gorynych_git::read::{graph_fingerprint, load_repository, load_repository_since, locate_repo, read_commits_page, refs_fingerprint};

fn git(dir: &Path, args: &[&str], input: Option<&str>) {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", dir.join("нет-такого-файла"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Тест")
        .env("GIT_AUTHOR_EMAIL", "t@example.com")
        .env("GIT_COMMITTER_NAME", "Тест")
        .env("GIT_COMMITTER_EMAIL", "t@example.com")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = input {
        child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

/// main и feature с перемежающимися датами, мерджи feature → main, тег и ветка на сервере: порядок `--date-order` нетривиален.
fn history(root: &Path) {
    git(root, &["init", "-q", "-b", "main"], None);
    let mut stream = String::new();
    let mut commit = |branch: &str, mark: usize, from: Option<usize>, merge: Option<usize>, time: u64| {
        let message = format!("{branch} {mark}");
        stream.push_str(&format!("commit refs/heads/{branch}\nmark :{mark}\ncommitter Тест <t@example.com> {time} +0000\ndata {}\n{message}\n", message.len()));
        if let Some(from) = from {
            stream.push_str(&format!("from :{from}\n"));
        }
        if let Some(merge) = merge {
            stream.push_str(&format!("merge :{merge}\n"));
        }
        stream.push_str(&format!("M 644 inline f{mark}.txt\ndata 2\n{}\n\n", mark % 10));
    };
    let (mut main, mut feature) = (1, 0);
    commit("main", 1, None, None, 1_700_000_000);
    for mark in 2..=60 {
        let time = 1_700_000_000 + mark as u64 * 60;
        if mark % 3 == 0 {
            commit("feature", mark, Some(if feature == 0 { main } else { feature }), None, time);
            feature = mark;
        } else if mark % 11 == 0 && feature != 0 {
            commit("main", mark, Some(main), Some(feature), time);
            main = mark;
        } else {
            commit("main", mark, Some(main), None, time);
            main = mark;
        }
    }
    stream.push_str(&format!("reset refs/tags/v1\nfrom :{}\n\nreset refs/remotes/origin/main\nfrom :{}\n\n", 20, main - 1));
    git(root, &["fast-import", "--quiet"], Some(&stream));
    git(root, &["reset", "-q", "--hard"], None);
}

#[tokio::test]
async fn pages_glue_into_one_request() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    history(root);

    let all = load_repository(root, Some(1000)).await.unwrap().commits;
    assert_eq!(all.len(), 60);
    for n in [1, 7, 13, 30] {
        let first = read_commits_page(root, 0, n).await.unwrap();
        let second = read_commits_page(root, n, n).await.unwrap();
        let both = read_commits_page(root, 0, 2 * n).await.unwrap();
        let glued: Vec<_> = first.commits.iter().chain(&second.commits).cloned().collect();
        assert_eq!(glued, both.commits, "порции по {n}");
        assert_eq!(both.commits[..], all[..(2 * n as usize).min(60)], "один запрос = load_repository, по {n}");
        // Порция из первой загрузки — то же, что load_repository с тем же пределом (украшения, HEAD, порядок)
        assert_eq!(first.commits, load_repository(root, Some(n)).await.unwrap().commits);
        assert!(first.truncated);
        assert_eq!(second.truncated, 2 * n <= 60, "по {n}");
    }
    let tail = read_commits_page(root, 55, 2000).await.unwrap();
    assert_eq!(tail.commits[..], all[55..]);
    assert!(!tail.truncated);
    let past = read_commits_page(root, 60, 10).await.unwrap();
    assert!(past.commits.is_empty() && !past.truncated);
}

#[tokio::test]
async fn page_fingerprint_is_refs_fingerprint_without_limit() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    history(root);
    let location = locate_repo(root).await.unwrap();
    let refs = refs_fingerprint(&location.git_dir).unwrap();

    let page = read_commits_page(root, 10, 10).await.unwrap();
    assert_eq!(page.fingerprint.as_deref(), Some(refs.as_str()));
    // Отпечаток ответа зависит от предела, отпечаток ссылок — нет
    let small = load_repository_since(root, Some(20), None).await.unwrap();
    let big = load_repository_since(root, Some(40), None).await.unwrap();
    assert_eq!(small.refs_fingerprint.as_deref(), Some(refs.as_str()));
    assert_eq!(big.refs_fingerprint.as_deref(), Some(refs.as_str()));
    assert_ne!(small.fingerprint, big.fingerprint);
    assert_eq!(small.fingerprint, graph_fingerprint(&location.git_dir, 20));
    // Тот же предел — git log не запускается (поведение load_repository_since прежнее)
    let again = load_repository_since(root, Some(40), big.fingerprint.as_deref()).await.unwrap();
    assert!(again.commits_unchanged);
    assert!(!load_repository_since(root, Some(20), big.fingerprint.as_deref()).await.unwrap().commits_unchanged);

    // Порция 20…40 отдаёт отпечаток загрузки с пределом 40: после склейки полное перечитывание с этим пределом пропускает git log
    let page = read_commits_page(root, 20, 20).await.unwrap();
    assert_eq!(page.graph_fingerprint, big.fingerprint);
    assert!(load_repository_since(root, Some(40), page.graph_fingerprint.as_deref()).await.unwrap().commits_unchanged);

    // Новый коммит меняет отпечаток ссылок
    git(root, &["commit", "-q", "--allow-empty", "-m", "ещё"], None);
    assert_ne!(refs_fingerprint(&location.git_dir).unwrap(), refs);
}
