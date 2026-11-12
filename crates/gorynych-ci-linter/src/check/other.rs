//! Проверка Bitbucket Pipelines, Jenkins, CircleCI и Azure Pipelines: остальная часть `electron/ciCheckOther.cjs`.
//!
//! ## Конспект
//! - **Bitbucket** (`bb-*`): разделы `pipelines`, шаги (ключи, `script`, `max-time`, `size`, `trigger`, кэши, сервисы, окружения), `docker` без сервиса, первый шаг вручную, затем проверка скриптов
//!   с артефактами уже пройденных шагов.
//! - **Jenkins** (`jenkins-*`): парность скобок и кавычек вне комментариев; для декларативного — `agent`, `stages`, дубли и пустые этапы, условия `post`; секреты; команды `sh`.
//! - **CircleCI** (`circle-*`): задания и орбы в потоках, `requires`, исполнитель, `steps`, проверка скриптов после `checkout`.
//! - **Azure** (`azure-*`): `dependsOn` заданий и этапов, отсутствие `pool`.
//!
//! ## Отличие от 1.x
//! `toJS()` у CircleCI и Azure в 1.x ограничен 100 алиасами (лимит `yaml` по умолчанию), здесь 1000, как у остальных. Файл с 100–1000 алиасами в 1.x давал «Проверка прервалась», здесь проверяется.

use std::collections::{HashMap, HashSet};

use super::CheckContext;
use super::base::*;
use super::scripts::{ScriptJob, ScriptLine, check_scripts};
use crate::load::jenkins_text::{index_of, text_of, units};
use crate::load::model::CiFile;
use crate::load_common_as_array as arr;
use crate::load_common_non_null as non_null;
use crate::yaml::{JsMap, PathItem, Schema, Value};

fn extend(base: &[PathItem], more: Vec<PathItem>) -> Vec<PathItem> {
    base.iter().cloned().chain(more).collect()
}

/* ------------------------------- Bitbucket ------------------------------- */

const BB_STEP: [&str; 18] = ["name", "script", "image", "caches", "services", "artifacts", "after-script", "size", "max-time", "trigger", "deployment", "condition", "oidc", "clone", "runs-on", "fail-fast", "runtime", "output-variables"];
const BB_CACHES: [&str; 9] = ["docker", "composer", "dotnetcore", "gradle", "ivy2", "maven", "node", "pip", "sbt"];
const BB_SIZES: [&str; 6] = ["1x", "2x", "4x", "8x", "16x", "32x"];
const BB_GROUPS: [&str; 5] = ["branches", "tags", "bookmarks", "pull-requests", "custom"];

fn bb_rejected(message: impl std::fmt::Display) -> String {
    tr!("bitbucket-wont-run-pipeline", message)
}

struct Bitbucket<'a, 'b, 'c> {
    cx: &'a mut CheckContext<'b>,
    file: &'c str,
    when: String,
    data: &'c Value,
    global_docker: bool,
    defined_caches: Vec<String>,
    defined_services: Vec<String>,
    counter: usize,
    script_jobs: Vec<ScriptJob>,
}

struct StepRef {
    step: Value,
    path: Vec<PathItem>,
}

struct Group {
    title: String,
    deployments: HashSet<String>,
    steps: Vec<StepRef>,
}

impl Bitbucket<'_, '_, '_> {
    fn issue(&mut self, path: &[PathItem], mut draft: Draft) {
        draft.when = draft.when.or_else(|| Some(self.when.clone()));
        draft.file = Some(self.file.to_owned());
        draft.line = self.cx.pos.line(self.file, path);
        self.cx.add(draft);
    }

    fn visit(&mut self, item: &Value, path: &[PathItem], group: &mut Group) {
        let wrapped;
        let mut item = item;
        if let Some(parallel @ Value::Map(_)) = item.get("parallel") {
            let inner = non_null(parallel.get("steps")).unwrap_or(parallel).clone();
            let mut map = JsMap::new();
            map.insert("parallel".to_owned(), inner);
            wrapped = Value::Map(map);
            item = &wrapped;
        }
        if let Some(Value::Seq(list)) = item.get("parallel") {
            if list.len() < 2 {
                let title = group.title.clone();
                self.issue(path, draft!("bb-parallel-one", Warning, title = tr!("parallel-with-one-step", title), how = tr!("there-will-be-no-error-but-no"), why = tr!("parallel-needs-at-least-two"), fix = tr!("remove-parallel-or-add-steps")));
            }
            for (index, step) in list.iter().enumerate() {
                self.visit(step, &extend(path, kp!["parallel", index]), group);
            }
            return;
        }
        if let Some(stage @ Value::Map(_)) = item.get("stage") {
            for (index, step) in arr(stage.get("steps")).into_iter().enumerate() {
                self.visit(step, &extend(path, kp!["stage", "steps", index]), group);
            }
            return;
        }
        let g = group.title.clone();
        let Some(step @ Value::Map(step_map)) = item.get("step") else {
            self.issue(path, draft!("bb-not-step", Error, title = tr!("item-without-step", g), how = bb_rejected("Each item in the pipeline must be a step, parallel or stage"), why = tr!("pipeline-item-is-step-parallel"), fix = "- step:\n    script:\n      - echo ok"));
            return;
        };
        let step_path = extend(path, kp!["step"]);
        let label = match step.get("name").filter(|value| value.truthy()) {
            Some(name) => q(name.js_string()),
            None => tr!("step", group.steps.len() + 1),
        };
        group.steps.push(StepRef { step: step.clone(), path: step_path.clone() });
        for key in step_map.keys() {
            if !BB_STEP.contains(&key.as_str()) {
                self.issue(&extend(&step_path, kp![key]), draft!("bb-step-key", Error, title = tr!("unknown-key-2", g, label, q(key)), how = bb_rejected(format!("Unexpected property \"{key}\"")), why = tr!("allowed", BB_STEP.join(", "), did_you_mean(key, BB_STEP)), fix = tr!("fix-key")));
            }
        }
        match step.get("script") {
            None => self.issue(&step_path, draft!("bb-no-script", Error, title = tr!("no-script-2", g, label), how = bb_rejected("Missing required property \"script\""), why = tr!("step-has-nothing-to-run"), fix = "script:\n  - echo ok")),
            script if arr(script).is_empty() => self.issue(&extend(&step_path, kp!["script"]), draft!("bb-script-empty", Error, title = tr!("empty-script-2", g, label), how = bb_rejected("\"script\" must not be empty"), why = tr!("at-least-one-command-is"), fix = tr!("add-command"))),
            _ => {}
        }
        if let Some(limit) = step.get("max-time") {
            let number = js_number(Some(limit));
            if number > 120.0 || number < 1.0 {
                self.issue(&extend(&step_path, kp!["max-time"]), draft!("bb-max-time", Error, title = format!("{g}: {label} — max-time {}", limit.js_string()), how = bb_rejected("max-time must be between 1 and 120"), why = tr!("from-1-to-120-minutes"), fix = "max-time: 60"));
            }
        }
        if let Some(size) = step.get("size")
            && !BB_SIZES.contains(&size.js_string().as_str())
        {
            let text = size.js_string();
            self.issue(&extend(&step_path, kp!["size"]), draft!("bb-size", Error, title = format!("{g}: {label} — size {text}"), how = bb_rejected(format!("\"{text}\" is not a valid size")), why = tr!("allowed-4", BB_SIZES.join(", ")), fix = "size: 2x"));
        }
        if let Some(trigger) = step.get("trigger")
            && !matches!(trigger.as_str(), Some("manual" | "automatic"))
        {
            self.issue(&extend(&step_path, kp!["trigger"]), draft!("bb-trigger", Error, title = format!("{g}: {label} — trigger {}", trigger.js_string()), how = bb_rejected("trigger must be \"manual\" or \"automatic\""), why = tr!("allowed-manual-and-automatic"), fix = "trigger: manual"));
        }
        for cache in arr(step.get("caches")) {
            let text = cache.js_string();
            if !BB_CACHES.contains(&text.as_str()) && !self.defined_caches.contains(&text) {
                let known = BB_CACHES.iter().copied().chain(self.defined_caches.iter().map(String::as_str));
                let why = tr!("built-in-caches-custom-ones", BB_CACHES.join(", "), did_you_mean(&text, known));
                self.issue(&extend(&step_path, kp!["caches"]), draft!("bb-cache-undefined", Error, title = tr!("unknown-cache", g, label, q(&text)), how = bb_rejected(format!("Cache \"{text}\" is not defined")), why = why, fix = tr!("definitions-caches-path-to-folder", arg(cache))));
            }
        }
        for service in arr(step.get("services")) {
            let text = service.js_string();
            if text != "docker" && !self.defined_services.contains(&text) {
                self.issue(&extend(&step_path, kp!["services"]), draft!("bb-service-undefined", Error, title = tr!("service-isnt-defined", g, label, q(&text)), how = bb_rejected(format!("Service \"{text}\" is not defined")), why = tr!("services-except-docker-are-defined"), fix = format!("definitions:\n  services:\n    {text}:\n      image: {text}")));
            }
        }
        if let Some(deployment) = step.get("deployment") {
            let env = deployment.js_string();
            if group.deployments.contains(&env) {
                self.issue(&extend(&step_path, kp!["deployment"]), draft!("bb-deployment-twice", Error, title = tr!("environment-is-used-twice", g, q(&env)), how = bb_rejected(format!("The deployment environment \"{env}\" in your bitbucket-pipelines.yml file occurs multiple times in the pipeline")), why = tr!("in-one-pipeline-each-environment"), fix = tr!("use-different-environments-or-merge")));
            }
            group.deployments.insert(env);
        }
        let script_items = arr(step.get("script"));
        let uses_docker = script_items.iter().any(|item| {
            let text = match item {
                Value::String(text) => text.clone(),
                Value::Map(_) if item.get("pipe").is_some_and(Value::truthy) => String::new(),
                other => other.json_string(),
            };
            re!(r"(^|\s|&&)docker\s+(build|push|run|login|compose|tag|pull)").test(&text)
        });
        let has_docker = arr(step.get("services")).iter().any(|service| service.as_str() == Some("docker"));
        if uses_docker && !has_docker && !self.global_docker {
            self.issue(&extend(&step_path, kp!["script"]), draft!("bb-docker-service", Error, title = tr!("docker-without-services-docker", g, label), when = tr!("when-step-runs", label), how = tr!("step-will-fail-cannot-connect"), why = tr!("docker-in-bitbucket-pipelines-is"), fix = "services:\n  - docker"));
        }
        self.counter += 1;
        let image_source = non_null(step.get("image")).or_else(|| self.data.get("image"));
        let image = match image_source {
            Some(Value::String(text)) => Some(text.clone()),
            Some(other) => other.get("name").filter(|value| value.truthy()).map(Value::js_string),
            None => None,
        };
        let artifacts_from = group
            .steps
            .iter()
            .flat_map(|item| {
                let artifacts = item.step.get("artifacts");
                let source = if is_obj(artifacts) { artifacts.and_then(|value| value.get("paths")) } else { artifacts };
                arr(source).into_iter().map(|path| re!(r"\/\*\*?$").replace_all(&path.js_string(), "")).collect::<Vec<_>>()
            })
            .collect();
        let lines = script_items
            .iter()
            .enumerate()
            .map(|(index, item)| ScriptLine {
                text: item.as_str().unwrap_or_default().to_owned(),
                line: self.cx.pos.line(self.file, &extend(&step_path, kp!["script", index])),
                ..ScriptLine::default()
            })
            .collect();
        self.script_jobs.push(ScriptJob {
            name: step.get("name").filter(|value| value.truthy()).map_or_else(|| tr!("step", self.counter), Value::js_string),
            file: Some(self.file.to_owned()),
            line: self.cx.pos.line(self.file, &step_path),
            lines,
            image,
            services: arr(step.get("services")).into_iter().map(Value::js_string).collect(),
            artifacts_from,
            system: "bitbucket",
            kind: Some(tr!("step-3")),
            ..ScriptJob::default()
        });
    }
}

/// `checkBitbucket`.
pub(crate) fn check_bitbucket(files: &[CiFile], cx: &mut CheckContext<'_>) -> Result<(), String> {
    let Some(file) = files.first().map(|file| file.path.as_str()) else { return Ok(()) };
    let Some((document, text)) = cx.pos.doc(file) else { return Ok(()) };
    let Ok(data) = document.to_value(Schema::Plain, text) else { return Ok(()) };
    let empty = Value::Map(JsMap::new());
    let data = if data.is_null() { empty.clone() } else { data };
    let when = tr!("right-on-push-bitbucket-checks");
    let Some(pipelines @ Value::Map(pipeline_map)) = data.get("pipelines") else {
        cx.add(draft!("bb-no-pipelines", Error, title = tr!("no-pipelines-section"), when = when, how = bb_rejected("There is an error in your bitbucket-pipelines.yml: missing section \"pipelines\""), why = tr!("without-pipelines-bitbucket-doesnt-know"), fix = "pipelines:\n  default:\n    - step:\n        script:\n          - echo ok", file = file.to_owned(), line = None::<u32>));
        return Ok(());
    };
    let definitions = data.get("definitions").filter(|value| is_obj(Some(value))).unwrap_or(&empty);
    let keys_of = |value: Option<&Value>| value.and_then(Value::as_map).map_or_else(Vec::new, |map| map.keys().cloned().collect::<Vec<_>>());
    let global_max = data.get("options").and_then(|options| options.get("max-time"));
    let mut bb = Bitbucket {
        cx,
        file,
        when,
        data: &data,
        global_docker: matches!(data.get("options").and_then(|options| options.get("docker")), Some(Value::Bool(true))),
        defined_caches: keys_of(definitions.get("caches")),
        defined_services: keys_of(definitions.get("services")),
        counter: 0,
        script_jobs: Vec::new(),
    };
    if let Some(limit) = global_max
        && js_number(Some(limit)) > 120.0
    {
        bb.issue(&kp!["options", "max-time"], draft!("bb-max-time", Error, title = tr!("options-max-time-more-than", arg(limit)), how = bb_rejected("max-time must be between 1 and 120"), why = tr!("step-in-bitbucket-cloud-is"), fix = "max-time: 120"));
    }
    for key in pipeline_map.keys() {
        if !matches!(key.as_str(), "default" | "branches" | "tags" | "bookmarks" | "pull-requests" | "custom") {
            bb.issue(&kp!["pipelines", key], draft!("bb-pipelines-key", Error, title = tr!("pipelines-unknown-section", q(key)), how = bb_rejected(format!("Unexpected property \"{key}\"")), why = tr!("allowed-default-branches-tags-bookmarks", did_you_mean(key, ["default", "branches", "tags", "pull-requests", "custom"])), fix = tr!("fix-section-name")));
        }
    }
    let mut groups: Vec<(String, &Value, Vec<PathItem>)> = Vec::new();
    if let Some(list) = pipelines.get("default") {
        groups.push(("default".to_owned(), list, kp!["pipelines", "default"]));
    }
    for name in BB_GROUPS {
        if let Some(Value::Map(map)) = pipelines.get(name) {
            for (pattern, list) in map.iter() {
                groups.push((format!("{name}: {pattern}"), list, kp!["pipelines", name, pattern]));
            }
        }
    }
    for (title, list, path) in groups {
        let Value::Seq(items) = list else {
            bb.issue(&path, draft!("bb-pipeline-not-list", Error, title = tr!("must-be-list-of-steps", title), how = bb_rejected("A list of steps was expected"), why = tr!("pipeline-is-list-of-step"), fix = "- step:\n    script:\n      - echo ok"));
            continue;
        };
        let mut group = Group { title: title.clone(), deployments: HashSet::new(), steps: Vec::new() };
        for (index, item) in items.iter().enumerate() {
            bb.visit(item, &extend(&path, kp![index]), &mut group);
        }
        if let Some(first) = group.steps.first()
            && first.step.get("trigger").and_then(Value::as_str) == Some("manual")
            && !title.starts_with("custom")
        {
            let at = extend(&first.path, kp!["trigger"]);
            bb.issue(&at, draft!("bb-first-manual", Error, title = tr!("first-step-cant-be-manual", title), how = bb_rejected("The first step of a pipeline can't be manual"), why = tr!("pipeline-starts-automatically-and-so"), fix = tr!("remove-trigger-manual-from-first")));
        }
    }
    let script_jobs = std::mem::take(&mut bb.script_jobs);
    check_scripts(&script_jobs, bb.cx, "bitbucket")
}

/* -------------------------------- Jenkins -------------------------------- */

const JENKINS_POST: [&str; 10] = ["always", "changed", "fixed", "regression", "aborted", "failure", "success", "unstable", "unsuccessful", "cleanup"];

fn j_rejected(message: impl std::fmt::Display) -> String {
    tr!("build-will-fail-right-away", message)
}

/// `blockAt`: без учёта строк, как в 1.x.
fn block_at(text: &[u16], open: usize) -> &[u16] {
    let mut depth = 0i64;
    for index in open..text.len() {
        if text[index] == u16::from(b'{') {
            depth += 1;
        } else if text[index] == u16::from(b'}') {
            depth -= 1;
            if depth == 0 {
                return &text[open + 1..index];
            }
        }
    }
    &text[(open + 1).min(text.len())..]
}

/// `stripNested`.
fn strip_nested(inner: &[u16]) -> String {
    let mut out = Vec::with_capacity(inner.len());
    let mut depth = 0i64;
    for unit in inner {
        if *unit == u16::from(b'{') {
            if depth == 0 {
                out.push(*unit);
            }
            depth += 1;
        } else if *unit == u16::from(b'}') {
            depth -= 1;
        } else if depth == 0 {
            out.push(*unit);
        }
    }
    text_of(&out)
}

/// `checkJenkins`.
pub(crate) fn check_jenkins(files: &[CiFile], cx: &mut CheckContext<'_>) -> Result<(), String> {
    let file = files.first().map(|file| file.path.clone());
    let source = files.first().map_or("", |file| file.text.as_str());
    let text = units(source);
    let line_at = |index: usize| text[..index.min(text.len())].iter().filter(|unit| **unit == u16::from(b'\n')).count() as u32 + 1;
    let when = tr!("when-build-starts-jenkins-parses");
    macro_rules! issue {
        ($index:expr, $id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {{
            let index: Option<usize> = $index;
            let mut item = draft!($id, $severity $(, $field = $value)*);
            item.when = item.when.or_else(|| Some(when.clone()));
            item.file = file.clone();
            item.line = index.map(&line_at);
            cx.add(item);
        }};
    }

    let single = [u16::from(b'\'')];
    let double = [u16::from(b'"')];
    let triple_single = [u16::from(b'\''); 3];
    let triple_double = [u16::from(b'"'); 3];
    let mut stack: Vec<(u16, usize)> = Vec::new();
    let mut quote: Option<&[u16]> = None;
    let mut index = 0;
    while index < text.len() {
        let c = text[index];
        if let Some(open) = quote {
            if c == u16::from(b'\\') {
                index += 1;
            } else if text[index..].starts_with(open) {
                index += open.len() - 1;
                quote = None;
            }
            index += 1;
            continue;
        }
        let rest = &text[index..];
        if rest.starts_with(&[u16::from(b'/'), u16::from(b'/')]) {
            index = index_of(&text, &[u16::from(b'\n')], index).unwrap_or(text.len()) + 1;
            continue;
        }
        if rest.starts_with(&[u16::from(b'/'), u16::from(b'*')]) {
            index = index_of(&text, &[u16::from(b'*'), u16::from(b'/')], index + 2).map_or(text.len(), |at| at + 1) + 1;
            continue;
        }
        if rest.starts_with(&triple_single) {
            quote = Some(&triple_single);
            index += 3;
            continue;
        }
        if rest.starts_with(&triple_double) {
            quote = Some(&triple_double);
            index += 3;
            continue;
        }
        if c == u16::from(b'"') {
            quote = Some(&double);
            index += 1;
            continue;
        }
        if c == u16::from(b'\'') {
            quote = Some(&single);
            index += 1;
            continue;
        }
        if matches!(c, 0x7B | 0x28 | 0x5B) {
            stack.push((c, index));
        } else if matches!(c, 0x7D | 0x29 | 0x5D) {
            let open = stack.pop();
            let want = match c {
                0x7D => 0x7B,
                0x29 => 0x28,
                _ => 0x5B,
            };
            if open.is_none_or(|item| item.0 != want) {
                let shown = text_of(&[c]);
                let line = line_at(index);
                let why = match open {
                    Some((other, at)) => tr!("expected-closing-one-for-from", text_of(&[other]), line_at(at)),
                    None => tr!("it-has-no-opening-bracket"),
                };
                issue!(Some(index), "jenkins-brace", Error, title = tr!("extra-on-line", shown, line), how = j_rejected(format!("{line}: unexpected token: {shown}")), why = why, fix = tr!("check-that-brackets-are-paired"));
                stack.clear();
                break;
            }
        }
        index += 1;
    }
    if let Some(open) = quote {
        issue!(None, "jenkins-quote", Error, title = tr!("unclosed-string", text_of(open)), how = j_rejected("unexpected end of file, expecting quote"), why = tr!("quote-somewhere-has-no-pair"), fix = tr!("check-quotes"));
    } else if let Some((open, at)) = stack.last().copied() {
        let end = line_at(text.len());
        issue!(Some(at), "jenkins-unclosed", Error, title = tr!("unclosed-from-line", text_of(&[open]), line_at(at)), how = j_rejected(format!("{end}: expecting '}}', found '' @ line {end}")), why = tr!("file-ended-before-all-blocks"), fix = tr!("add-missing-bracket"));
    }

    let pipeline_at = re!(r"^\s*pipeline\s*\{", "m").find(&text).map(|range| range.start);
    if let Some(start) = pipeline_at {
        let brace = index_of(&text, &[u16::from(b'{')], start).unwrap_or(start);
        let top = strip_nested(block_at(&text, brace));
        if !re!(r"(^|\n)\s*agent\b").test(&top) {
            issue!(Some(start), "jenkins-no-agent", Error, title = tr!("pipeline-has-no-agent"), how = j_rejected("Missing required section \"agent\""), why = tr!("declarative-pipeline-must-say-where"), fix = "pipeline {\n  agent any\n  …");
        }
        if !re!(r"(^|\n)\s*stages\s*\{").test(&top) {
            issue!(Some(start), "jenkins-no-stages", Error, title = tr!("pipeline-has-no-stages"), how = j_rejected("Missing required section \"stages\""), why = tr!("stages-are-required"), fix = "stages {\n  stage('Build') {\n    steps { sh 'make' }\n  }\n}");
        }
        let mut names: HashMap<String, u32> = HashMap::new();
        for groups in re!(r#"\bstage\s*\(\s*(['"])(.+?)\1\s*\)\s*\{"#).captures_all(&text) {
            let whole = groups[0].clone().unwrap_or_default();
            let name = groups[2].clone().map_or_else(String::new, |range| text_of(&text[range]));
            let inner = strip_nested(block_at(&text, whole.end - 1));
            if let Some(first) = names.get(&name).copied() {
                issue!(Some(whole.start), "jenkins-stage-dup", Error, title = tr!("stage-declared-twice-2", q(&name)), how = j_rejected(format!("Duplicate stage name: \"{name}\"")), why = tr!("first-time-on-line", first), fix = tr!("rename-one-of-stages"));
            }
            names.insert(name.clone(), line_at(whole.start));
            let kinds: Vec<&str> = [
                ("steps", re!(r"(^|\n)\s*steps\s*\{")),
                ("stages", re!(r"(^|\n)\s*stages\s*\{")),
                ("parallel", re!(r"(^|\n)\s*parallel\s*\{")),
                ("matrix", re!(r"(^|\n)\s*matrix\s*\{")),
            ]
            .into_iter()
            .filter(|(_, regex)| regex.test(&inner))
            .map(|(kind, _)| kind)
            .collect();
            let rejected = format!("Stage \"{name}\" must have one and only one of \"steps\", \"stages\", \"parallel\", or \"matrix\"");
            if kinds.is_empty() {
                issue!(Some(whole.start), "jenkins-stage-empty", Error, title = tr!("stage-without-steps", q(&name)), how = j_rejected(&rejected), why = tr!("stage-has-nothing-to-run"), fix = "steps {\n  sh 'echo ok'\n}");
            } else if kinds.len() > 1 {
                issue!(Some(whole.start), "jenkins-stage-multi", Error, title = tr!("stage-at-once", q(&name), kinds.join(&tr!("and"))), how = j_rejected(&rejected), why = tr!("only-one-is-allowed"), fix = tr!("split-them-into-nested-stages"));
            }
        }
        for range in re!(r"\bpost\s*\{").find_all(&text) {
            let inner = block_at(&text, range.end - 1);
            for groups in re!(r"(?:^|\n)\s*([A-Za-z_]+)\s*\{").captures_all(inner) {
                let condition = groups[1].clone().map_or_else(String::new, |group| text_of(&inner[group]));
                if !JENKINS_POST.contains(&condition.as_str()) {
                    issue!(Some(range.start), "jenkins-post", Error, title = tr!("post-unknown-condition", q(&condition)), how = j_rejected(format!("Invalid condition \"{condition}\" - valid conditions are [{}]", JENKINS_POST.join(", "))), why = tr!("unknown-condition", did_you_mean(&condition, JENKINS_POST)), fix = tr!("fix-condition"));
                }
            }
        }
    } else if re!(r"\bnode\s*[({]").find(&text).is_none() && !gorynych_core::js::trim(source).is_empty() {
        issue!(Some(1), "jenkins-no-pipeline", Warning, title = tr!("neither-pipeline-nor-node-found"), how = tr!("jenkins-will-run-file-as"), why = tr!("jenkinsfile-starts-with-pipeline"), fix = "pipeline {\n  agent any\n  stages { … }\n}");
    }
    for (regex, what) in SECRET_VALUE.iter() {
        if let Some(found) = regex.find(&text) {
            issue!(Some(found.start), "secret-in-script", Error, title = tr!("in-plain-text-in-jenkinsfile", tr!(what)), when = tr!("right-now-file-is-in"), how = tr!("everyone-with-access-to-repository"), why = tr!("secrets-must-be-stored-in-jenkins"), fix = tr!("revoke-key-use-withcredentials-string"));
        }
    }
    let mut lines = Vec::new();
    for groups in re!(r#"\b(sh|bat)\s*\(?\s*(?:script\s*:\s*)?('''|"""|'|")([\s\S]*?)\2"#).captures_all(&text) {
        let part = |at: usize| groups[at].clone().map_or_else(String::new, |range| text_of(&text[range]));
        if part(1) == "bat" {
            continue;
        }
        let start = line_at(groups[0].clone().unwrap_or_default().start);
        let quote_text = part(2);
        for (at, line_text) in part(3).split('\n').enumerate() {
            let shown = if quote_text == "\"" || quote_text == "\"\"\"" { re!(r"\$\{[^}]*\}").replace_all(line_text, "$X") } else { line_text.to_owned() };
            lines.push(ScriptLine { text: shown, line: Some(start + at as u32), ..ScriptLine::default() });
        }
    }
    if !lines.is_empty() {
        let job = ScriptJob { name: "Jenkinsfile".to_owned(), file: file.clone(), line: Some(1), lines, system: "jenkins", where_text: Some("Jenkinsfile".to_owned()), kind: Some(tr!("build")), ..ScriptJob::default() };
        check_scripts(std::slice::from_ref(&job), cx, "jenkins")?;
    }
    Ok(())
}

/* -------------------------------- CircleCI ------------------------------- */

fn first_entry(entry: &Value) -> Option<(String, Value)> {
    entry.js_entries().into_iter().next()
}

/// `checkCircle`.
pub(crate) fn check_circle(files: &[CiFile], cx: &mut CheckContext<'_>) -> Result<(), String> {
    let Some(file) = files.first().map(|file| file.path.as_str()) else { return Ok(()) };
    let Some((document, text)) = cx.pos.doc(file) else { return Ok(()) };
    let data = document.to_value(Schema::Plain, text)?;
    let empty = Value::Map(JsMap::new());
    let data = if data.is_null() { empty.clone() } else { data };
    let when = tr!("right-on-push-circleci-checks");
    if data.get("version").is_none() {
        cx.add(draft!("circle-no-version", Error, title = tr!("version-isnt-specified"), when = when.clone(), how = tr!("circleci-wont-run-build-config"), why = tr!("first-line-of-configuration-is"), fix = "version: 2.1", file = file.to_owned(), line = Some(1u32)));
    }
    let jobs = data.get("jobs").filter(|value| is_obj(Some(value))).unwrap_or(&empty);
    let job_names: Vec<&str> = jobs.as_map().map_or_else(Vec::new, |map| map.keys().map(String::as_str).collect());
    let orbs: Vec<&str> = data.get("orbs").and_then(Value::as_map).map_or_else(Vec::new, |map| map.keys().map(String::as_str).collect());
    if let Some(Value::Map(workflows)) = data.get("workflows") {
        for (workflow, cfg) in workflows.iter() {
            if !matches!(cfg, Value::Map(_)) {
                continue;
            }
            let entries = arr(cfg.get("jobs"));
            // Имя задания в потоке: `undefined`, если у записи нет ключей
            let names: Vec<Option<Value>> = entries
                .iter()
                .map(|entry| match entry {
                    Value::String(_) => Some((*entry).clone()),
                    other => first_entry(other).and_then(|(key, value)| non_null(value.get("name")).cloned().or(Some(Value::String(key)))),
                })
                .collect();
            let name_texts: Vec<String> = names.iter().map(|name| js_str(name.as_ref())).collect();
            for (index, entry) in entries.iter().enumerate() {
                let (reference, opts): (Option<String>, Value) = match entry {
                    Value::String(text) => (Some(text.clone()), empty.clone()),
                    other => match first_entry(other) {
                        Some((key, value)) => (Some(key), if value.is_null() { empty.clone() } else { value }),
                        None => (None, empty.clone()),
                    },
                };
                let line = cx.pos.line(file, &kp!["workflows", workflow, "jobs", index]);
                if let Some(reference) = reference.as_deref().filter(|item| !item.is_empty()) {
                    if !jobs.get(reference).is_some_and(Value::truthy) && !reference.contains('/') && opts.get("type").and_then(Value::as_str) != Some("approval") {
                        cx.add(draft!("circle-job-unknown", Error, title = tr!("job-isnt-defined", workflow, q(reference)), when = when.clone(), how = tr!("circleci-wont-run-workflow-job", reference), why = tr!("jobs-has-no", q(reference), did_you_mean(reference, job_names.iter().copied())), fix = tr!("fix-name-or-define-job"), file = file.to_owned(), line = line));
                    }
                    if reference.contains('/') {
                        let orb = reference.split('/').next().unwrap_or_default();
                        if !orbs.contains(&orb) {
                            cx.add(draft!("circle-orb-unknown", Error, title = tr!("orb-isnt-included", workflow, q(orb)), when = when.clone(), how = tr!("circleci-wont-run-workflow-cannot", reference), why = tr!("orb-must-be-declared-in"), fix = format!("orbs:\n  {orb}: circleci/{orb}@x.y"), file = file.to_owned(), line = line));
                        }
                    }
                }
                for required in arr(opts.get("requires")) {
                    if !names.iter().any(|name| name.as_ref() == Some(required)) {
                        let text = required.js_string();
                        let shown_ref = reference.clone().unwrap_or_else(|| "undefined".to_owned());
                        cx.add(draft!("circle-requires-unknown", Error, title = tr!("waits-for-which-isnt-in", workflow, q(&shown_ref), q(&text)), when = when.clone(), how = tr!("circleci-wont-run-workflow-job-requires", reference.clone().unwrap_or_default(), arg(required), workflow), why = tr!("workflow-has-no-job", q(workflow), q(&text), did_you_mean(&text, name_texts.iter().map(String::as_str))), fix = tr!("fix-name-2"), file = file.to_owned(), line = line));
                    }
                }
            }
        }
    }
    if let Some(job_map) = jobs.as_map() {
        for (name, job) in job_map.iter() {
            if !matches!(job, Value::Map(_)) {
                continue;
            }
            let line = cx.pos.line(file, &kp!["jobs", name]);
            if !["docker", "machine", "macos", "executor", "resource_class"].iter().any(|key| job.get(key).is_some_and(Value::truthy)) {
                cx.add(draft!("circle-no-executor", Error, title = tr!("no-executor-specified", q(name)), when = when.clone(), how = tr!("circleci-wont-run-job-job", name), why = tr!("job-needs-execution-environment"), fix = "docker:\n  - image: cimg/base:stable", file = file.to_owned(), line = line));
            }
            let steps = arr(job.get("steps"));
            if steps.is_empty() {
                cx.add(draft!("circle-no-steps", Error, title = tr!("no-steps", q(name)), when = when.clone(), how = tr!("circleci-wont-run-job-steps"), why = tr!("job-has-nothing-to-run"), fix = "steps:\n  - checkout\n  - run: echo ok", file = file.to_owned(), line = line));
            }
            let checkout = steps.iter().any(|step| step.as_str() == Some("checkout"));
            let mut lines = Vec::new();
            for (index, step) in steps.iter().enumerate() {
                let run = step.get("run");
                let command = match run {
                    Some(Value::String(_)) => run,
                    Some(other) => other.get("command"),
                    None => None,
                };
                if let Some(command) = command.filter(|value| value.truthy()) {
                    let base = cx.pos.line(file, &kp!["jobs", name, "steps", index]).unwrap_or(0);
                    for (at, line_text) in command.js_string().split('\n').enumerate() {
                        let number = base + at as u32;
                        lines.push(ScriptLine { text: line_text.to_owned(), line: (number != 0).then_some(number), ..ScriptLine::default() });
                    }
                }
            }
            if checkout {
                let image = arr(job.get("docker")).first().and_then(|first| first.get("image")).filter(|value| value.truthy()).map(Value::js_string);
                let script_job = ScriptJob { name: name.clone(), file: Some(file.to_owned()), line, lines, image, system: "circleci", ..ScriptJob::default() };
                check_scripts(std::slice::from_ref(&script_job), cx, "circleci")?;
            } else if lines.iter().any(|item: &ScriptLine| re!(r"(^|\s)(\.\/|npm (ci|install)|make\b|mvn|gradle)").test(&item.text)) {
                cx.add(draft!("circle-no-checkout", Warning, title = tr!("no-checkout-step", q(name)), when = tr!("when-job-runs-2", q(name)), how = tr!("commands-will-fail-there-are"), why = tr!("code-appears-only-after-checkout"), fix = "steps:\n  - checkout", file = file.to_owned(), line = cx.pos.line(file, &kp!["jobs", name, "steps"])));
            }
        }
    }
    Ok(())
}

/* --------------------------------- Azure --------------------------------- */

/// `checkAzure`.
pub(crate) fn check_azure(files: &[CiFile], cx: &mut CheckContext<'_>) -> Result<(), String> {
    let Some(file) = files.first().map(|file| file.path.as_str()) else { return Ok(()) };
    let Some((document, text)) = cx.pos.doc(file) else { return Ok(()) };
    let data = document.to_value(Schema::Plain, text)?;
    let data = if data.is_null() { Value::Map(JsMap::new()) } else { data };
    let when = tr!("right-on-push-azure-devops");
    let is_jobs_list = matches!(data.get("jobs"), Some(Value::Seq(_)));
    let stages = data.get("stages").and_then(Value::as_seq);
    let jobs: Vec<&Value> = match (data.get("jobs"), stages) {
        (Some(Value::Seq(items)), _) => items.iter().collect(),
        (_, Some(items)) => items.iter().flat_map(|stage| arr(stage.get("jobs"))).collect(),
        _ => Vec::new(),
    };
    let job_id = |job: &Value| non_null(job.get("job")).or_else(|| job.get("deployment")).cloned();
    let ids: Vec<Value> = jobs.iter().filter_map(|job| job_id(job)).filter(Value::truthy).collect();
    let id_texts: Vec<String> = ids.iter().map(Value::js_string).collect();
    for (index, job) in jobs.iter().enumerate() {
        for dep in arr(job.get("dependsOn")) {
            if !ids.contains(dep) {
                let own = job_id(job);
                let text = dep.js_string();
                let path = if is_jobs_list { kp!["jobs", index] } else { Vec::new() };
                cx.add(draft!("azure-depends-unknown", Error, title = tr!("dependson-on-unknown", q_opt(own.as_ref()), q(&text)), when = when.clone(), how = tr!("azure-wont-run-pipeline-job", arg_opt(own.as_ref()), arg(dep)), why = tr!("theres-no-job", q(&text), did_you_mean(&text, id_texts.iter().map(String::as_str))), fix = tr!("fix-name-2"), file = file.to_owned(), line = cx.pos.line(file, &path)));
            }
        }
    }
    if let Some(stages) = stages {
        let stage_ids: Vec<&Value> = stages.iter().filter_map(|stage| stage.get("stage")).filter(|value| value.truthy()).collect();
        let stage_texts: Vec<String> = stage_ids.iter().map(|value| value.js_string()).collect();
        for (index, stage) in stages.iter().enumerate() {
            for dep in arr(stage.get("dependsOn")) {
                if !stage_ids.contains(&dep) {
                    let text = dep.js_string();
                    cx.add(draft!("azure-stage-depends-unknown", Error, title = tr!("stage-dependson-on-unknown", q_opt(stage.get("stage")), q(&text)), when = when.clone(), how = tr!("azure-wont-run-pipeline-stage", arg_opt(stage.get("stage")), arg(dep)), why = tr!("theres-no-stage", q(&text), did_you_mean(&text, stage_texts.iter().map(String::as_str))), fix = tr!("fix-name-2"), file = file.to_owned(), line = cx.pos.line(file, &kp!["stages", index])));
                }
            }
        }
    }
    if !data.get("pool").is_some_and(Value::truthy) && !jobs.iter().any(|job| job.get("pool").is_some_and(Value::truthy)) && stages.is_none() {
        cx.add(draft!("azure-no-pool", Info, title = tr!("pool-isnt-specified"), when = when, how = tr!("projects-default-pool-will-be"), why = tr!("pool-isnt-set-in-file"), fix = "pool:\n  vmImage: ubuntu-latest", file = file.to_owned(), line = Some(1u32)));
    }
    Ok(())
}
