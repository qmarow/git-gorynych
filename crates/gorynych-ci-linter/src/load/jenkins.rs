//! Jenkins (Groovy, без YAML): `loadJenkins`, `extractBlock` и `dedent` из `electron/ci.cjs`.
//!
//! ## Конспект
//! - Этапы ищутся регуляркой `stage('x') {`, граница блока — `extractBlock` с учётом `'`, `"`, `'''`, `"""` и `//`-комментариев. Незакрытый блок
//!   идёт до конца текста. Конец этапа в `raw` не включает закрывающую скобку.
//! - Вложенность: `a` внутри `b`, если `a.start > b.start && a.end <= b.end`. Свой текст этапа — без первых вхождений текста дочерних.
//! - Этап без детей — одна колонка; с детьми и `parallel {` — колонка из листьев; иначе по колонке на лист с именем `a › b`.
//! - `id` — индекс среди всех этапов (`st0`…). `CRLF` заменяется на `LF` до разбора, и файл уходит в интерфейс с заменой.
//!
//! Все позиции — единицы UTF-16, как в 1.x: регулярки сохраняют семантику JS (`\b`, `\w`, `\s` только ASCII и пробелы JS).

use std::sync::LazyLock;

use gorynych_core::js;

use super::common::*;
use super::model::*;
use crate::js_regex::JsRegex;
use crate::yaml::Value;

fn regex(pattern: &str, flags: &str) -> JsRegex {
    JsRegex::new(pattern, flags).expect("шаблон из кода")
}

static STAGE: LazyLock<JsRegex> = LazyLock::new(|| regex(r#"\bstage\s*\(\s*(['"])(.+?)\1\s*\)\s*\{"#, ""));
static AGENT_BLOCK: LazyLock<JsRegex> = LazyLock::new(|| regex(r"\bagent\s*\{([^}]*)\}", ""));
static AGENT_WORD: LazyLock<JsRegex> = LazyLock::new(|| regex(r"\bagent\s+(\w+)", ""));
static INPUT: LazyLock<JsRegex> = LazyLock::new(|| regex(r#"\binput\b\s*[('"{]"#, ""));
static PARALLEL: LazyLock<JsRegex> = LazyLock::new(|| regex(r"\bparallel\s*\{", ""));
static TOP_AGENT: LazyLock<JsRegex> = LazyLock::new(|| regex(r"^\s*agent\s+(\w+|\{[^}]*\})", "m"));
static DECLARATIVE: LazyLock<JsRegex> = LazyLock::new(|| regex(r"^\s*pipeline\s*\{", "m"));
static SCRIPTED: LazyLock<JsRegex> = LazyLock::new(|| regex(r"\bnode\s*[({]", ""));
static LIBRARY: LazyLock<JsRegex> = LazyLock::new(|| regex(r#"@Library\(\s*['"]([^'"]+)['"]"#, ""));

pub(crate) fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub(crate) fn text_of(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

pub(crate) fn index_of(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if from > haystack.len() {
        return None;
    }
    if needle.is_empty() {
        return Some(from);
    }
    haystack[from..].windows(needle.len()).position(|window| window == needle).map(|at| at + from)
}

/// `extractBlock`: содержимое `{…}`, начиная с открывающей скобки.
fn extract_block(text: &[u16], open: usize) -> &[u16] {
    const BACKSLASH: u16 = b'\\' as u16;
    const SINGLE: u16 = b'\'' as u16;
    const DOUBLE: u16 = b'"' as u16;
    const SLASH: u16 = b'/' as u16;
    const OPEN: u16 = b'{' as u16;
    const CLOSE: u16 = b'}' as u16;
    const NEWLINE: u16 = b'\n' as u16;

    let mut depth = 0i64;
    let mut quote: Option<&[u16]> = None;
    let triple_single = [SINGLE; 3];
    let triple_double = [DOUBLE; 3];
    let (single, double) = ([SINGLE], [DOUBLE]);
    let mut index = open;
    while index < text.len() {
        let c = text[index];
        if let Some(current) = quote {
            if c == BACKSLASH {
                index += 1;
            } else if text[index..].starts_with(current) {
                index += current.len() - 1;
                quote = None;
            }
            index += 1;
            continue;
        }
        if text[index..].starts_with(&triple_single) {
            quote = Some(&triple_single);
            index += 2;
        } else if text[index..].starts_with(&triple_double) {
            quote = Some(&triple_double);
            index += 2;
        } else if c == DOUBLE {
            quote = Some(&double);
        } else if c == SINGLE {
            quote = Some(&single);
        } else if c == SLASH && text.get(index + 1) == Some(&SLASH) {
            index = index_of(text, &[NEWLINE], index).unwrap_or(text.len());
        } else if c == OPEN {
            depth += 1;
        } else if c == CLOSE {
            depth -= 1;
            if depth == 0 {
                return &text[open + 1..index];
            }
        }
        index += 1;
    }
    &text[(open + 1).min(text.len())..]
}

/// `dedent`.
fn dedent(block: &[u16]) -> Vec<String> {
    let text = text_of(block);
    // `/^\s*\n/`: начальные пробельные символы до последнего перевода строки среди них
    let leading = text.len() - text.trim_start_matches(js::is_whitespace).len();
    let start = text[..leading].rfind('\n').map_or(0, |at| at + 1);
    let body = text[start..].trim_end_matches(js::is_whitespace);
    let lines: Vec<&str> = body.split('\n').collect();
    let indent = lines
        .iter()
        .filter(|line| !js::trim(line).is_empty())
        .map(|line| line.chars().take_while(|c| js::is_whitespace(*c)).count())
        .min()
        .unwrap_or(0);
    lines.iter().map(|line| line.chars().skip(indent).collect()).collect()
}

fn block_of(body: &[u16], keyword: &str) -> Option<Vec<String>> {
    let found = JsRegex::new(&format!(r"\b{keyword}\s*\{{"), "").ok()?.find(body)?;
    let open = index_of(body, &[u16::from(b'{')], found.start)?;
    Some(dedent(extract_block(body, open)))
}

struct Stage {
    name: String,
    start: usize,
    open: usize,
    end: usize,
    children: Vec<usize>,
    own: Vec<u16>,
}

fn inside(a: &Stage, b: &Stage) -> bool {
    a.start > b.start && a.end <= b.end
}

fn normalize_spaces(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if js::is_whitespace(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

fn make_job(index: usize, stages: &[Stage], text: &[u16], file: &str) -> CiJob {
    let stage = &stages[index];
    let steps = block_of(&stage.own, "steps").unwrap_or_default();
    let when = block_of(&stage.own, "when").unwrap_or_default();
    let group = |pattern: &JsRegex| pattern.captures(&stage.own).and_then(|groups| groups.get(1).cloned().flatten()).map(|range| text_of(&stage.own[range]));
    let agent = group(&AGENT_BLOCK).map(|body| js::trim(&body).to_owned()).or_else(|| group(&AGENT_WORD));
    let manual = INPUT.find(&stage.own).is_some();
    let line = text[..stage.start].iter().filter(|unit| **unit == u16::from(b'\n')).count() as u32 + 1;
    CiJob {
        id: format!("st{index}"),
        name: stage.name.clone(),
        source: file.to_owned(),
        line: Some(line),
        kind: CiJobKind::Job,
        image: agent.filter(|agent| !agent.is_empty()).map(|agent| Value::String(normalize_spaces(&agent))),
        manual,
        when: Some(Value::String(if manual { "manual" } else { "on_success" }.to_owned())),
        script: (!steps.is_empty()).then_some(CiScript { lines: steps, inherited: None }),
        rules: when.iter().map(|line| js::trim(line)).filter(|line| !line.is_empty()).map(CiRule::text).collect(),
        raw: text_of(&text[stage.start..stage.end]),
        ..CiJob::default()
    }
}

fn leaves(index: usize, stages: &[Stage], out: &mut Vec<usize>) {
    if stages[index].children.is_empty() {
        out.push(index);
    } else {
        for child in &stages[index].children {
            leaves(*child, stages, out);
        }
    }
}

/// `loadJenkins`.
pub(crate) fn load_jenkins(ctx: &Ctx<'_>, file: &str) -> LoadResult<CiConfig> {
    let source = ctx.read_text(file).map_err(|error| error.message)?.replace("\r\n", "\n");
    let text = units(&source);

    let mut stages: Vec<Stage> = STAGE
        .captures_all(&text)
        .into_iter()
        .map(|groups| {
            let whole = groups[0].clone().unwrap_or_default();
            let open = whole.end - 1;
            let body_len = extract_block(&text, open).len();
            let name = groups[2].clone().map_or_else(String::new, |range| text_of(&text[range]));
            Stage { name, start: whole.start, open, end: open + body_len + 1, children: Vec::new(), own: Vec::new() }
        })
        .collect();
    for index in 0..stages.len() {
        let children: Vec<usize> = (0..stages.len())
            .filter(|&child| {
                child != index
                    && inside(&stages[child], &stages[index])
                    && !(0..stages.len()).any(|middle| middle != child && middle != index && inside(&stages[child], &stages[middle]) && inside(&stages[middle], &stages[index]))
            })
            .collect();
        let stage = &stages[index];
        let mut own = text[(stage.open + 1).min(stage.end)..stage.end].to_vec();
        for child in &children {
            let piece = &text[stages[*child].start..stages[*child].end];
            if let Some(at) = index_of(&own, piece, 0) {
                own.drain(at..at + piece.len());
            }
        }
        stages[index].children = children;
        stages[index].own = own;
    }

    let mut columns = Vec::new();
    let roots: Vec<usize> =
        (0..stages.len()).filter(|&index| !(0..stages.len()).any(|other| other != index && inside(&stages[index], &stages[other]))).collect();
    for root in roots {
        let stage = &stages[root];
        if stage.children.is_empty() {
            columns.push(CiStage::new(stage.name.clone(), vec![make_job(root, &stages, &text, file)]));
            continue;
        }
        let mut list = Vec::new();
        leaves(root, &stages, &mut list);
        if PARALLEL.find(&stage.own).is_some() {
            let jobs = list.iter().map(|leaf| make_job(*leaf, &stages, &text, file)).collect();
            columns.push(CiStage::new(ctx.t("{0} · параллельно", &[&stage.name]), jobs));
        } else {
            for leaf in list {
                columns.push(CiStage::new(format!("{} › {}", stage.name, stages[leaf].name), vec![make_job(leaf, &stages, &text, file)]));
            }
        }
    }

    let mut info = Vec::new();
    let top_agent = TOP_AGENT.captures(&text).and_then(|groups| groups.get(1).cloned().flatten()).map(|range| text_of(&text[range]));
    if let Some(agent) = top_agent.filter(|agent| !agent.is_empty()) {
        info.push(CiInfo { label: ctx.t("Агент", &[]), value: Value::String(normalize_spaces(&agent)) });
    }
    if DECLARATIVE.find(&text).is_some() {
        info.push(CiInfo { label: ctx.t("Синтаксис", &[]), value: Value::String("Declarative Pipeline".to_owned()) });
    } else if SCRIPTED.find(&text).is_some() {
        info.push(CiInfo { label: ctx.t("Синтаксис", &[]), value: Value::String("Scripted Pipeline".to_owned()) });
    }
    let triggers = block_of(&text, "triggers").unwrap_or_default().iter().map(|line| js::trim(line)).filter(|line| !line.is_empty()).map(CiRule::text).collect();
    let includes = LIBRARY
        .captures_all(&text)
        .into_iter()
        .map(|groups| CiInclude {
            kind: "library".to_owned(),
            value: Value::String(groups[1].clone().map_or_else(String::new, |range| text_of(&text[range]))),
            rules: None,
            from: None,
            resolved: false,
            files: None,
            error: None,
        })
        .collect();
    Ok(CiConfig {
        warnings: if columns.is_empty() { vec![ctx.t("Не удалось найти этапы stage(...) — показан только файл", &[])] } else { Vec::new() },
        includes,
        info,
        triggers,
        triggers_title: Some(ctx.t("Триггеры", &[])),
        pipelines: vec![CiPipeline { id: "main".to_owned(), title: "Pipeline".to_owned(), stages: columns }],
        files: vec![CiFile { path: file.to_owned(), text: source, hash: None, draft: false }],
        ..CiConfig::default()
    })
}
