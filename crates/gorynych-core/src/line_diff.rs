//! Построчный diff (алгоритм Майерса). Перенос `electron/lineDiff.cjs`.
//!
//! # Конспект исходника
//! - `diffLines(a, b)`: общие начало и конец отделяются, Майерс считает только середину. Результат — операции
//!   `{type: equal|delete|insert, a, b}`; `a`/`b` — индексы строк, у `insert` нет `a`, у `delete` нет `b`.
//! - `toHunks(old, new, ops, context = 3)`: фрагменты склеиваются, пока между изменениями не больше `2×context`
//!   неизменных строк. Заголовок `@@ -A,B +C,D @@`, строки `{t, o, n, text}` (номера с единицы, `null` у отсутствующей
//!   стороны). Итог `{hunks, additions, deletions, binary:false, truncated:false}` — формат разбора `git diff`.
//! - Перенесён в ядро, потому что нужен `ci-linter` (Фаза 2) и `gorynych-git` (Фаза 3), а зависит только от строк.
//!   Порядок обхода Майерса сохранён точно: от него зависит, какой из равноценных diff будет показан.

use serde::{Deserialize, Serialize};

/// Контекст по умолчанию в [`to_hunks`].
pub const DEFAULT_CONTEXT: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    Equal,
    Delete,
    Insert,
}

/// Операция diff. `a` и `b` — индексы строк в старом и новом тексте.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Op {
    #[serde(rename = "type")]
    pub kind: OpKind,
    pub a: Option<usize>,
    pub b: Option<usize>,
}

impl Op {
    fn equal(a: usize, b: usize) -> Self {
        Self { kind: OpKind::Equal, a: Some(a), b: Some(b) }
    }

    fn delete(a: usize) -> Self {
        Self { kind: OpKind::Delete, a: Some(a), b: None }
    }

    fn insert(b: usize) -> Self {
        Self { kind: OpKind::Insert, a: None, b: Some(b) }
    }
}

/// Операции, превращающие `a` в `b`.
pub fn diff_lines<S: PartialEq>(a: &[S], b: &[S]) -> Vec<Op> {
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }
    let mut end_a = a.len();
    let mut end_b = b.len();
    while end_a > start && end_b > start && a[end_a - 1] == b[end_b - 1] {
        end_a -= 1;
        end_b -= 1;
    }

    let mut ops = Vec::with_capacity(a.len().max(b.len()));
    ops.extend((0..start).map(|i| Op::equal(i, i)));
    ops.extend(myers(&a[start..end_a], &b[start..end_b]).into_iter().map(|op| Op {
        kind: op.kind,
        a: op.a.map(|i| i + start),
        b: op.b.map(|i| i + start),
    }));
    ops.extend((0..a.len() - end_a).map(|i| Op::equal(end_a + i, end_b + i)));
    ops
}

fn myers<S: PartialEq>(a: &[S], b: &[S]) -> Vec<Op> {
    if a.is_empty() {
        return (0..b.len()).map(Op::insert).collect();
    }
    if b.is_empty() {
        return (0..a.len()).map(Op::delete).collect();
    }
    let n = a.len() as i32;
    let m = b.len() as i32;
    let max = n + m;
    let at = |k: i32| (max + k) as usize;

    let mut v = vec![0i32; 2 * max as usize + 2];
    let mut trace: Vec<Vec<i32>> = Vec::new();
    'outer: for d in 0..=max {
        trace.push(v.clone());
        for k in (-d..=d).step_by(2) {
            let mut x = if k == -d || (k != d && v[at(k - 1)] < v[at(k + 1)]) {
                v[at(k + 1)]
            } else {
                v[at(k - 1)] + 1
            };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[at(k)] = x;
            if x >= n && y >= m {
                trace.push(v.clone());
                break 'outer;
            }
        }
    }

    // Обратный проход по следу
    let mut ops = Vec::new();
    let (mut x, mut y) = (n, m);
    for d in (0..trace.len() as i32 - 1).rev() {
        let vd = &trace[d as usize];
        let k = x - y;
        let prev_k = if k == -d || (k != d && vd[at(k - 1)] < vd[at(k + 1)]) { k + 1 } else { k - 1 };
        let prev_x = vd[at(prev_k)];
        let prev_y = prev_x - prev_k;
        while x > prev_x && y > prev_y {
            x -= 1;
            y -= 1;
            ops.push(Op::equal(x as usize, y as usize));
        }
        if d > 0 {
            if x == prev_x {
                y -= 1;
                ops.push(Op::insert(y as usize));
            } else {
                x -= 1;
                ops.push(Op::delete(x as usize));
            }
        }
    }
    while x > 0 && y > 0 {
        x -= 1;
        y -= 1;
        ops.push(Op::equal(x as usize, y as usize));
    }
    ops.reverse();
    ops
}

/// Вид строки во фрагменте.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum LineKind {
    #[serde(rename = " ")]
    Context,
    #[serde(rename = "-")]
    Removed,
    #[serde(rename = "+")]
    Added,
}

/// Строка фрагмента. Имена полей — как в UI 1.x.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct HunkLine {
    pub t: LineKind,
    /// Номер в старом тексте, с единицы.
    pub o: Option<u32>,
    /// Номер в новом тексте, с единицы.
    pub n: Option<u32>,
    pub text: String,
}

/// Фрагмент diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Hunk {
    pub header: String,
    pub section: String,
    pub lines: Vec<HunkLine>,
}

/// Результат diff в формате разбора `git diff`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct FileDiff {
    pub hunks: Vec<Hunk>,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub truncated: bool,
}

/// Собирает операции во фрагменты с `context` строками контекста.
pub fn to_hunks<S: AsRef<str>>(old_lines: &[S], new_lines: &[S], ops: &[Op], context: usize) -> FileDiff {
    let changed = |index: usize| ops[index].kind != OpKind::Equal;
    let mut hunks = Vec::new();
    let (mut additions, mut deletions) = (0u32, 0u32);
    let mut i = 0;
    let mut prev_to = 0;
    while i < ops.len() {
        if !changed(i) {
            i += 1;
            continue;
        }
        let from = prev_to.max(i.saturating_sub(context));
        let mut to = i;
        // Расширяем фрагмент, пока между изменениями не больше 2×context неизменных строк
        while to < ops.len() {
            if changed(to) {
                to += 1;
                continue;
            }
            let mut run = 0;
            while to + run < ops.len() && !changed(to + run) {
                run += 1;
            }
            if to + run >= ops.len() || run > context * 2 {
                to = ops.len().min(to + context);
                break;
            }
            to += run;
        }

        let slice = &ops[from..to];
        let first_old = slice.iter().find_map(|op| op.a).unwrap_or(0);
        let first_new = slice.iter().find_map(|op| op.b).unwrap_or(0);
        let number = |index: usize| index as u32 + 1;
        let (mut old_count, mut new_count) = (0, 0);
        let mut lines = Vec::with_capacity(slice.len());
        for op in slice {
            let line = match (op.kind, op.a, op.b) {
                (OpKind::Equal, Some(a), Some(b)) => {
                    old_count += 1;
                    new_count += 1;
                    HunkLine { t: LineKind::Context, o: Some(number(a)), n: Some(number(b)), text: old_lines[a].as_ref().to_owned() }
                }
                (OpKind::Delete, Some(a), None) => {
                    old_count += 1;
                    deletions += 1;
                    HunkLine { t: LineKind::Removed, o: Some(number(a)), n: None, text: old_lines[a].as_ref().to_owned() }
                }
                (OpKind::Insert, None, Some(b)) => {
                    new_count += 1;
                    additions += 1;
                    HunkLine { t: LineKind::Added, o: None, n: Some(number(b)), text: new_lines[b].as_ref().to_owned() }
                }
                _ => unreachable!("Op создаётся только конструкторами equal/delete/insert"),
            };
            lines.push(line);
        }
        hunks.push(Hunk {
            header: format!("@@ -{},{old_count} +{},{new_count} @@", first_old + 1, first_new + 1),
            section: String::new(),
            lines,
        });
        i = to;
        prev_to = to;
    }
    FileDiff { hunks, additions, deletions, binary: false, truncated: false }
}
