//! Проверка команд в скриптах CI против самого репозитория и образа задания: `electron/ciCheckScripts.cjs`.
//!
//! ## Конспект
//! - `imageInfo`: срез `docker.io/` и `library/`, таблица `IMAGE_TOOLS`. Неизвестный образ не проверяется; `$` в имени — образа нет.
//! - `splitCommands`: разделители `&& || ; |` вне кавычек, `#` после пробела — комментарий. `words` снимает `VAR=…` и `sudo exec time command env nohup`.
//! - Папка: `created` (создано раньше в задании), `artifactsFrom`, `BUILD_OUTPUT`, затем индекс репозитория. `cd` меняет папку до нового шага; абсолютный путь отключает проверки файлов.
//! - Проверки: `cd-missing`, `pkg-alpine`, `pkg-debian`, `bash-alpine`, `tool-missing`, `docker-no-daemon`, `exec-missing`, `exec-not-executable`, `script-missing`, `pkg-json-missing`,
//!   `npm-ci-no-lock`, `npm-script-missing`, `yarn-no-lock`, `pnpm-no-lock`, `pip-req-missing`, `poetry-no-project`, `make-no-makefile`, `make-no-target`, `build-file-missing`, `dockerfile-missing`,
//!   `compose-missing`, `kubectl-missing`, `secret-in-script`.
//! - `package.json`: `scripts` по `in`; не словарь — `TypeError`, проверка прерывается как в 1.x.

use std::collections::{HashMap, HashSet};

use super::base::*;
use super::CheckContext;
use crate::yaml::{JsMap, Value};

/// Строка скрипта.
#[derive(Debug, Clone, Default)]
pub(crate) struct ScriptLine {
    pub text: String,
    pub line: Option<u32>,
    pub file: Option<String>,
    /// Новый шаг: новый shell.
    pub reset: bool,
    pub cwd: Option<String>,
}

/// Задание для проверки скриптов.
#[derive(Debug, Clone, Default)]
pub(crate) struct ScriptJob {
    pub name: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub lines: Vec<ScriptLine>,
    pub image: Option<String>,
    pub services: Vec<String>,
    pub vars: HashSet<String>,
    pub artifacts_from: Vec<String>,
    pub system: &'static str,
    pub where_text: Option<String>,
    pub kind: Option<String>,
    pub cwd: Option<String>,
}

const IMAGE_TOOLS: [(&str, &[&str]); 13] = [
    (r"^(?:.*\/)?node(?::|$)", &["node", "npm", "npx", "yarn", "corepack"]),
    (r"^(?:.*\/)?python(?::|$)", &["python", "python3", "pip", "pip3"]),
    (r"^(?:.*\/)?(?:golang|go)(?::|$)", &["go"]),
    (r"^(?:.*\/)?ruby(?::|$)", &["ruby", "gem", "bundle", "bundler"]),
    (r"^(?:.*\/)?php(?::|$)", &["php"]),
    (r"^(?:.*\/)?composer(?::|$)", &["php", "composer"]),
    (r"^(?:.*\/)?maven(?::|$)", &["mvn", "java"]),
    (r"^(?:.*\/)?gradle(?::|$)", &["gradle", "java"]),
    (r"^(?:.*\/)?(?:openjdk|eclipse-temurin|amazoncorretto)(?::|$)", &["java"]),
    (r"^(?:.*\/)?rust(?::|$)", &["cargo", "rustc"]),
    (r"^(?:.*\/)?docker(?::|$)", &["docker"]),
    (r"(?:^|\/)dotnet\/sdk(?::|$)", &["dotnet"]),
    (r"^(?:.*\/)?(?:alpine|busybox|ubuntu|debian|centos|fedora|rockylinux|almalinux)(?::|$)", &[]),
];

fn tool_family(tool: &str) -> Option<&'static str> {
    Some(match tool {
        "node" | "npm" | "npx" | "yarn" => "Node.js",
        "pnpm" => "pnpm",
        "python" | "python3" | "pip" | "pip3" => "Python",
        "go" => "Go",
        "ruby" | "gem" | "bundle" => "Ruby",
        "php" => "PHP",
        "composer" => "Composer",
        "mvn" => "Maven",
        "gradle" => "Gradle",
        "java" => "Java",
        "cargo" | "rustc" => "Rust",
        "docker" => "Docker CLI",
        "dotnet" => ".NET SDK",
        _ => return None,
    })
}

/// `imageInfo`.
pub(crate) struct ImageInfo {
    pub name: String,
    pub alpine: bool,
    pub debian_like: bool,
    pub known: bool,
    pub tools: Vec<&'static str>,
}

pub(crate) fn image_info(image: Option<&str>) -> Option<ImageInfo> {
    let image = image.filter(|image| !image.is_empty() && !image.contains('$'))?;
    let lower = image.to_lowercase();
    let name = lower.strip_prefix("docker.io/").unwrap_or(&lower);
    let name = name.strip_prefix("library/").unwrap_or(name).to_owned();
    let alpine = name.contains("alpine") || name.contains("busybox");
    let known = IMAGE_TOOLS.iter().find(|(pattern, _)| crate::js_regex::JsRegex::new(pattern, "").is_ok_and(|regex| regex.is_match(&name)));
    let Some((_, tools)) = known else { return Some(ImageInfo { name, alpine, debian_like: false, known: false, tools: Vec::new() }) };
    let debian_like = !alpine && !re!(r"centos|fedora|rocky|alma|amazoncorretto").test(&name);
    Some(ImageInfo { name, alpine, debian_like, known: true, tools: tools.to_vec() })
}

fn words(command: &str) -> Vec<String> {
    let mut out: Vec<String> = re!(r#""([^"]*)"|'([^']*)'|(\S+)"#)
        .match_all(command)
        .into_iter()
        .map(|groups| groups[1].clone().or_else(|| groups[2].clone()).or_else(|| groups[3].clone()).unwrap_or_default())
        .collect();
    while out.first().is_some_and(|first| re!(r"^[A-Za-z_][A-Za-z0-9_]*=").test(first) || matches!(first.as_str(), "sudo" | "exec" | "time" | "command" | "env" | "nohup")) {
        out.remove(0);
    }
    out
}

/// `splitCommands`.
pub(crate) fn split_commands(line: &str) -> Vec<Vec<String>> {
    let chars: Vec<char> = line.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if let Some(open) = quote {
            if c == open {
                quote = None;
            }
            current.push(c);
            index += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            current.push(c);
            index += 1;
            continue;
        }
        let next = chars.get(index + 1).copied();
        if (c == '&' && next == Some('&')) || (c == '|' && next == Some('|')) {
            parts.push(std::mem::take(&mut current));
            index += 2;
            continue;
        }
        if c == ';' || c == '|' {
            parts.push(std::mem::take(&mut current));
            index += 1;
            continue;
        }
        if c == '#' && (index == 0 || gorynych_core::js::is_whitespace(chars[index - 1])) {
            break;
        }
        current.push(c);
        index += 1;
    }
    parts.push(current);
    parts.iter().map(|part| words(gorynych_core::js::trim(part))).filter(|part| !part.is_empty()).collect()
}

fn literal(path: &str) -> bool {
    !path.is_empty() && !path.contains(['$', '`', '*', '?', '{', '}', '~']) && !re!(r"^[a-z]+:\/\/", "i").test(path)
}

/// `join`.
pub(crate) fn join_path(cwd: &str, path: &str) -> String {
    let joined = if cwd.is_empty() { path.to_owned() } else { format!("{cwd}/{path}") };
    let mut out: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out.join("/")
}

const YARN_BUILTIN: &str = "install add remove upgrade up init info global audit cache config create dlx exec link pack publish run set unlink why workspace workspaces version bin help login logout outdated licenses list import check autoclean policies team tag owner versions node npm constraints dedupe explain patch plugin rebuild search stage unplug";

const OBJECT_PROTOTYPE: [&str; 12] = [
    "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
];

/// `runName in scripts`.
fn has_script(scripts: &Value, name: &str) -> Result<bool, String> {
    match scripts {
        Value::Map(map) => Ok(map.contains_key(name) || OBJECT_PROTOTYPE.contains(&name)),
        Value::Seq(items) => Ok(name == "length" || name.parse::<usize>().is_ok_and(|index| index < items.len()) || OBJECT_PROTOTYPE.contains(&name)),
        other => Err(format!("Cannot use 'in' operator to search for '{name}' in {}", other.js_string())),
    }
}

fn script_keys(scripts: &Value) -> Vec<String> {
    scripts.js_entries().into_iter().map(|(key, _)| key).collect()
}

struct MakeInfo {
    file: String,
    targets: Vec<String>,
    dynamic: bool,
}

const FETCH_OUTPUT: [&str; 4] = ["-o", "-O", "--output", "--output-document"];

/// `checkScripts`.
pub(crate) fn check_scripts(jobs: &[ScriptJob], cx: &mut CheckContext<'_>, system: &str) -> Result<(), String> {
    let shell = if system == "github" { "bash" } else { "sh" };
    let mut package_cache: HashMap<String, Option<Value>> = HashMap::new();
    let mut once: HashSet<String> = HashSet::new();

    for job in jobs {
        let where_text = job.where_text.clone().unwrap_or_else(|| tr!("job-2", q(&job.name)));
        let mut cwd = job.cwd.clone().unwrap_or_default();
        let mut created: Vec<String> = Vec::new();
        let img = image_info(job.image.as_deref());
        let known_img = img.as_ref().filter(|img| img.known);
        let mut installed = false;
        let mut docker_warned = false;
        let mut missing_tool: HashSet<&'static str> = HashSet::new();
        let when = tr!("when-runs", job.kind.clone().unwrap_or_else(|| tr!("jobs")), q(&job.name));

        for ln in &job.lines {
            if ln.reset {
                cwd = ln.cwd.clone().or_else(|| job.cwd.clone()).unwrap_or_default();
            }
            let file = ln.file.clone().or_else(|| job.file.clone());
            let line_no = ln.line.or(job.line);
            let text = &ln.text;
            macro_rules! line_add {
                ($id:expr, $severity:ident $(, $field:ident = $value:expr)* $(,)?) => {
                    cx.add(draft!($id, $severity, file = file.clone(), line = line_no, job = job.name.clone(), when = when.clone() $(, $field = $value)*))
                };
            }
            for (regex, what) in SECRET_VALUE.iter() {
                if regex.is_match(text) {
                    line_add!(
                        "secret-in-script",
                        Error,
                        title = tr!("script-of-has-in-plain", where_text, tr!(what)),
                        how = tr!("value-will-end-up-in"),
                        why = tr!("secrets-in-ci-file-arent"),
                        fix = tr!("revoke-this-key-token-and"),
                    );
                    break;
                }
            }
            if re!(r"\b(?:apt-get|apt|apk|yum|dnf|microdnf|zypper)\s+(?:-\S+\s+)*(?:install|add)\b|\bcurl\b[^|]*\|\s*(?:ba|z)?sh\b|\bwget\b[^|]*\|\s*(?:ba|z)?sh\b|\bnvm\s+install\b|\bcorepack\s+enable\b|\bnpm\s+(?:i|install)\s+(?:-g|--global)\b|\bsdk\s+install\b|\bpyenv\s+install\b|\buv\s+(?:python|tool)\s+install\b|\bsetup-\w+\b").test(text) {
                installed = true;
            }

            for command in split_commands(text) {
                let (cmd, args) = (command[0].as_str(), &command[1..]);
                let arg0 = args.first().map(String::as_str);
                let pos: Vec<&str> = args.iter().map(String::as_str).filter(|item| !item.starts_with('-')).collect();
                macro_rules! exists {
                    ($path:expr, $dir:expr) => {{
                        let full = join_path(&cwd, $path);
                        created.iter().any(|item| full == *item || full.starts_with(&format!("{item}/")))
                            || job.artifacts_from.iter().any(|item| full == *item || full.starts_with(&format!("{}/", item.trim_end_matches('/'))) || item == "." || item.is_empty())
                            || re!(r"^(dist|build|out|target|public|coverage|node_modules|\.venv|venv|vendor|bin|obj|\.next|\.nuxt|tmp|\.cache|reports?|artifacts?|release)(\/|$)").test(&full)
                            || if $dir { cx.repo.has_dir(&full) } else { cx.repo.has_file(&full) }
                    }};
                }

                if cmd == "cd" {
                    let dir = pos.first().copied().unwrap_or_default();
                    if !dir.is_empty() && literal(dir) && dir != "-" && !dir.starts_with('/') {
                        if !exists!(dir, true) {
                            line_add!(
                                "cd-missing",
                                Error,
                                title = tr!("cd-no-such-folder-in", dir),
                                how = tr!("job-will-fail-on-this", shell, dir),
                                why = tr!("folder-isnt-among-repository-files", q(join_path(&cwd, dir))),
                                fix = tr!("check-path-letter-case-matters"),
                            );
                        }
                        cwd = join_path(&cwd, dir);
                    } else if dir.starts_with('/') {
                        cwd = "\u{0}".to_owned();
                    }
                    continue;
                }
                if cwd == "\u{0}" {
                    continue;
                }

                if cmd == "mkdir" || cmd == "touch" {
                    created.extend(pos.iter().filter(|item| literal(item)).map(|item| join_path(&cwd, item)));
                }
                if cmd == "git" && arg0 == Some("clone") {
                    created.extend(pos.iter().skip(2).filter(|item| literal(item)).map(|item| join_path(&cwd, item)));
                    if pos.len() == 2 {
                        let last = pos[1].rsplit('/').next().unwrap_or_default();
                        created.push(join_path(&cwd, last.strip_suffix(".git").unwrap_or(last)));
                    }
                }
                if cmd == "curl" || cmd == "wget" {
                    for pair in args.windows(2) {
                        if FETCH_OUTPUT.contains(&pair[0].as_str()) && literal(&pair[1]) {
                            created.push(join_path(&cwd, &pair[1]));
                        }
                    }
                }
                if matches!(cmd, "cp" | "mv" | "ln" | "unzip" | "tar" | "npx" | "cookiecutter")
                    && let Some(last) = pos.last()
                {
                    created.push(join_path(&cwd, last));
                }
                if matches!(cmd, "echo" | "cat" | "printf")
                    && let Some(groups) = re!(r"(?:^|\s)>{1,2}\s*(\S+)").exec(text)
                {
                    let target = groups[1].as_deref().unwrap_or_default();
                    if literal(target) {
                        created.push(join_path(&cwd, target));
                    }
                }

                if let Some(image) = known_img {
                    if image.alpine && matches!(cmd, "apt-get" | "apt" | "yum" | "dnf") {
                        line_add!(
                            "pkg-alpine",
                            Error,
                            title = tr!("in-image", cmd, image.name),
                            how = tr!("job-will-fail-not-found", shell, cmd),
                            why = tr!("is-alpine-linux-image-it", q(&image.name), cmd),
                            fix = tr!("use-apk-add-no-cache"),
                        );
                    }
                    if image.debian_like && cmd == "apk" {
                        line_add!(
                            "pkg-debian",
                            Error,
                            title = tr!("apk-in-image", image.name),
                            how = tr!("job-will-fail-apk-not", shell),
                            why = tr!("is-based-on-debian-ubuntu", q(&image.name)),
                            fix = tr!("replace-it-with-apt-get"),
                        );
                    }
                    if image.alpine && cmd == "bash" && !installed {
                        line_add!(
                            "bash-alpine",
                            Warning,
                            title = tr!("bash-in-image", image.name),
                            how = tr!("sh-bash-not-found-alpine"),
                            why = tr!("alpine-images-are-minimal-bash"),
                            fix = tr!("run-it-via-sh-or"),
                        );
                    }
                    if let Some(family) = tool_family(cmd)
                        && !image.tools.contains(&cmd)
                        && !installed
                        && !missing_tool.contains(family)
                        && !(cmd == "docker" && job.system == "bitbucket")
                    {
                        let pnpm_in_node = cmd == "pnpm" && image.tools.contains(&"node");
                        missing_tool.insert(family);
                        line_add!(
                            "tool-missing",
                            Warning,
                            title = tr!("image-has-no", cmd, image.name, family),
                            how = tr!("job-will-most-likely-fail", shell, cmd),
                            why = if pnpm_in_node {
                                tr!("node-images-have-npm-and")
                            } else {
                                tr!("official-image-doesnt-contain-and", q(&image.name), family)
                            },
                            fix = if pnpm_in_node { tr!("add-corepack-enable-or-npm") } else { tr!("take-image-with-or-install", family) },
                        );
                    }
                }

                if cmd == "docker"
                    && arg0.is_some_and(|sub| matches!(sub, "build" | "push" | "run" | "pull" | "login" | "compose" | "buildx" | "tag" | "exec" | "ps" | "images"))
                    && job.system == "gitlab"
                    && !docker_warned
                {
                    let dind = job.services.iter().any(|service| re!(r"docker.*dind", "i").test(service));
                    if !dind && !job.vars.contains("DOCKER_HOST") {
                        docker_warned = true;
                        line_add!(
                            "docker-no-daemon",
                            Warning,
                            title = tr!("docker-without-docker-daemon", arg0.unwrap_or_default()),
                            how = tr!("on-runner-with-docker-executor"),
                            why = tr!("job-container-has-only-docker"),
                            fix = tr!("add-services-docker-dind-and"),
                        );
                    }
                }

                let runs_file = (cmd.starts_with("./") || (cmd.contains('/') && !cmd.starts_with('/') && !cmd.starts_with('$'))) && literal(cmd);
                if runs_file {
                    let path = join_path(&cwd, cmd);
                    if !exists!(cmd, false) {
                        line_add!(
                            "exec-missing",
                            Error,
                            title = tr!("file-isnt-in-repository-3", cmd),
                            how = tr!("job-will-fail-not-found-or", shell, cmd),
                            why = tr!("file-isnt-among-repository-files", q(&path)),
                            fix = tr!("check-path-and-letter-case"),
                        );
                    } else if cx.repo.mode(&path) == Some("100644") {
                        line_add!(
                            "exec-not-executable",
                            Error,
                            title = tr!("file-isnt-executable", cmd),
                            how = tr!("job-will-fail-permission-denied", shell, cmd),
                            why = tr!("in-git-file-is-saved", q(&path)),
                            fix = tr!("run-git-update-index-chmod", path, cmd),
                        );
                    }
                }
                if matches!(cmd, "sh" | "bash" | "source" | "." | "python" | "python3" | "node" | "ruby" | "php" | "perl" | "pwsh" | "powershell") {
                    let script = pos.first().copied().unwrap_or_default();
                    if !script.is_empty()
                        && literal(script)
                        && re!(r"\.[A-Za-z0-9]+$").test(script)
                        && !(matches!(cmd, "python" | "python3") && arg0 == Some("-m"))
                        && !exists!(script, false)
                    {
                        line_add!(
                            "script-missing",
                            Error,
                            title = tr!("file-isnt-in-repository-4", cmd, script),
                            how = if cmd == "node" {
                                tr!("job-will-fail-error-cannot", script)
                            } else if cmd.starts_with("python") {
                                tr!("job-will-fail-cant-open", script)
                            } else {
                                tr!("job-will-fail-no-such", script)
                            },
                            why = tr!("file-isnt-in-repository-taking", q(join_path(&cwd, script))),
                            fix = tr!("check-path-and-letter-case-or"),
                        );
                    }
                }

                let is_npm = cmd == "npm";
                let place = || if cwd.is_empty() { tr!("root") } else { cwd.clone() };
                let place_q = || q(place());
                if (is_npm || cmd == "yarn" || cmd == "pnpm") && !exists!("package.json", false) {
                    if once.insert(format!("pkg|{cwd}")) {
                        line_add!(
                            "pkg-json-missing",
                            Error,
                            title = tr!("no-package-json-in", cmd, place()),
                            how = if is_npm { "«npm ERR! enoent Could not read package.json: ENOENT: no such file or directory».".to_owned() } else { tr!("will-fail-package-json-not", cmd) },
                            why = tr!("command-runs-in-folder-and", q(if cwd.is_empty() { "." } else { &cwd })),
                            fix = tr!("go-to-project-folder-cd"),
                        );
                    }
                    continue;
                }
                if is_npm && matches!(arg0, Some("ci" | "clean-install")) && !exists!("package-lock.json", false) && !exists!("npm-shrinkwrap.json", false) {
                    line_add!(
                        "npm-ci-no-lock",
                        Error,
                        title = tr!("npm-ci-without-package-lock"),
                        how = "«npm ERR! The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json».",
                        why = tr!("has-no-package-lock-json", place_q()),
                        fix = tr!("commit-package-lock-json-npm"),
                    );
                }
                let run_name: Option<String> = match cmd {
                    "npm" => match arg0 {
                        Some("run" | "run-script") => pos.get(1).map(|item| (*item).to_owned()),
                        Some("t") => Some("test".to_owned()),
                        Some(sub @ ("test" | "start" | "stop" | "restart")) => Some(sub.to_owned()),
                        _ => None,
                    },
                    "yarn" => match arg0 {
                        Some("run") => pos.get(1).map(|item| (*item).to_owned()),
                        Some(sub) if !sub.is_empty() && !sub.starts_with('-') && !YARN_BUILTIN.split(' ').any(|word| word == sub) => Some(sub.to_owned()),
                        _ => None,
                    },
                    "pnpm" => match arg0 {
                        Some("run") => pos.get(1).map(|item| (*item).to_owned()),
                        Some("test") => Some("test".to_owned()),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(run_name) = run_name.filter(|name| literal(name)) {
                    let key = join_path(&cwd, "package.json");
                    let scripts = package_cache
                        .entry(key.clone())
                        .or_insert_with(|| {
                            let text = cx.repo.read(&key).filter(|text| !text.is_empty())?;
                            Some(match serde_json::from_str::<Value>(&text) {
                                Ok(Value::Null) | Err(_) => Value::Map(JsMap::new()),
                                Ok(parsed) => crate::load_common_non_null(parsed.get("scripts")).cloned().unwrap_or_else(|| Value::Map(JsMap::new())),
                            })
                        })
                        .clone();
                    if let Some(scripts) = scripts
                        && !has_script(&scripts, &run_name)?
                        && !(run_name == "start" && cx.repo.has_file(&join_path(&cwd, "server.js")))
                    {
                        let keys = script_keys(&scripts);
                        line_add!(
                            "npm-script-missing",
                            Error,
                            title = tr!("no-such-script-in-package", cmd, if arg0 == Some("run") { "run " } else { "" }, run_name),
                            how = if is_npm { format!("«npm ERR! Missing script: \"{run_name}\"».") } else { format!("«error Command \"{run_name}\" not found.»") },
                            why = tr!("scripts-section-of-has", key, if keys.is_empty() { tr!("nothing") } else { keys.join(", ") }),
                            fix = tr!("add-to-scripts-or-fix", run_name, if keys.is_empty() { String::new() } else { tr!("similar", keys.iter().take(5).cloned().collect::<Vec<_>>().join(", ")) }),
                        );
                    }
                }
                let has_arg = |wanted: &str| args.iter().any(|item| item == wanted);
                if cmd == "yarn" && (has_arg("--frozen-lockfile") || has_arg("--immutable")) && !exists!("yarn.lock", false) {
                    line_add!(
                        "yarn-no-lock",
                        Error,
                        title = tr!("yarn-with-frozen-lockfile-without"),
                        how = "«error Your lockfile needs to be updated, but yarn was run with `--frozen-lockfile`».",
                        why = tr!("has-no-yarn-lock", place_q()),
                        fix = tr!("commit-yarn-lock-or-remove"),
                    );
                }
                if cmd == "pnpm" && matches!(arg0, Some("install" | "i")) && !has_arg("--no-frozen-lockfile") && !exists!("pnpm-lock.yaml", false) {
                    line_add!(
                        "pnpm-no-lock",
                        Error,
                        title = tr!("pnpm-install-without-pnpm-lock"),
                        how = tr!("in-ci-pnpm-uses-frozen"),
                        why = tr!("has-no-pnpm-lock-yaml", place_q()),
                        fix = tr!("commit-pnpm-lock-yaml-or"),
                    );
                }

                let after = |flag: &str| args.iter().position(|item| item == flag).and_then(|at| args.get(at + 1)).map(String::as_str);
                if (cmd == "pip" || cmd == "pip3" || (cmd.starts_with("python") && arg0 == Some("-m") && args.get(1).map(String::as_str) == Some("pip"))) && has_arg("-r")
                    && let Some(requirements) = after("-r").filter(|item| literal(item))
                    && !exists!(requirements, false)
                {
                    line_add!(
                        "pip-req-missing",
                        Error,
                        title = tr!("pip-install-r-no-such", requirements),
                        how = format!("«ERROR: Could not open requirements file: [Errno 2] No such file or directory: '{requirements}'»."),
                        why = tr!("file-isnt-in-repository-2", q(join_path(&cwd, requirements))),
                        fix = tr!("check-name-requirements-txt-requirements"),
                    );
                }
                if cmd == "poetry" && arg0 == Some("install") && !exists!("pyproject.toml", false) {
                    line_add!(
                        "poetry-no-project",
                        Error,
                        title = tr!("poetry-install-without-pyproject-toml"),
                        how = "«Poetry could not find a pyproject.toml file in … or its parents».",
                        why = tr!("has-no-pyproject-toml", place_q()),
                        fix = tr!("go-to-project-folder-or"),
                    );
                }

                if cmd == "make" && !has_arg("-f") && !has_arg("-C") {
                    let info = ["GNUmakefile", "makefile", "Makefile"].into_iter().find_map(|name| {
                        let file = join_path(&cwd, name);
                        let text = cx.repo.read(&file)?;
                        let mut targets = Vec::new();
                        for groups in re!(r"^([A-Za-z0-9_.\-/%]+)\s*:(?!=)", "m").match_all(&text) {
                            let target = groups[1].clone().unwrap_or_default();
                            if !targets.contains(&target) {
                                targets.push(target);
                            }
                        }
                        Some(MakeInfo { file, targets, dynamic: re!(r"^include\s|\$\(|%:", "m").test(&text) })
                    });
                    match info {
                        None => {
                            if once.insert(format!("make|{cwd}")) {
                                line_add!(
                                    "make-no-makefile",
                                    Error,
                                    title = tr!("make-no-makefile-in", place()),
                                    how = "«make: *** No targets specified and no makefile found.  Stop.»",
                                    why = tr!("has-no-makefile", q(if cwd.is_empty() { "." } else { &cwd })),
                                    fix = tr!("add-makefile-or-go-to"),
                                );
                            }
                        }
                        Some(info) if !info.dynamic => {
                            for target in pos.iter().filter(|item| literal(item) && !item.contains('=')) {
                                if !info.targets.iter().any(|item| item == target) {
                                    let known = if info.targets.is_empty() { tr!("no") } else { info.targets.iter().take(12).cloned().collect::<Vec<_>>().join(", ") };
                                    line_add!(
                                        "make-no-target",
                                        Error,
                                        title = tr!("make-no-such-target-in", target, info.file),
                                        how = format!("«make: *** No rule to make target '{target}'.  Stop.»"),
                                        why = tr!("has-targets", info.file, known),
                                        fix = tr!("fix-target-name-or-add"),
                                    );
                                }
                            }
                        }
                        Some(_) => {}
                    }
                }

                let build: Option<(&[&str], String, String)> = match cmd {
                    "mvn" => Some((&["pom.xml"], tr!("mvn-no-pom-xml"), "«[ERROR] The goal you specified requires a project to execute but there is no POM in this directory».".to_owned())),
                    "gradle" => Some((&["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"], tr!("gradle-no-build-gradle"), tr!("gradle-wont-find-build-directory"))),
                    "go" if matches!(arg0, Some("build" | "test" | "vet" | "run" | "mod")) => Some((&["go.mod"], tr!("go-no-go-mod"), "«go: go.mod file not found in current directory or any parent directory».".to_owned())),
                    "cargo" if matches!(arg0, Some("build" | "test" | "run" | "check" | "clippy")) => Some((&["Cargo.toml"], tr!("cargo-no-cargo-toml"), "«error: could not find `Cargo.toml` in … or any parent directory».".to_owned())),
                    "composer" if matches!(arg0, Some("install" | "update")) => Some((&["composer.json"], tr!("composer-no-composer-json"), "«Composer could not find a composer.json file».".to_owned())),
                    "bundle" if matches!(arg0, Some("install" | "exec")) => Some((&["Gemfile"], tr!("bundle-no-gemfile"), "«Could not locate Gemfile».".to_owned())),
                    "dotnet" if matches!(arg0, Some("build" | "test" | "restore" | "publish")) && pos.get(1).is_none_or(|item| item.is_empty()) => Some((&["*.sln", "*.csproj", "*.fsproj"], tr!("dotnet-no-project-sln-csproj"), "«MSBUILD : error MSB1003: Specify a project or solution file».".to_owned())),
                    _ => None,
                };
                if let Some((files, title, how)) = build {
                    let mut found = false;
                    for item in files {
                        found = if item.contains('*') { cx.repo.glob(&join_path(&cwd, item)) } else { exists!(item, false) };
                        if found {
                            break;
                        }
                    }
                    if !found && once.insert(format!("build|{}|{cwd}", files[0])) {
                        line_add!(
                            "build-file-missing",
                            Error,
                            title = title,
                            how = how,
                            why = tr!("has-no", place_q(), files.join(" / ")),
                            fix = tr!("go-to-project-folder-cd-or"),
                        );
                    }
                }

                let file_flag = args.iter().position(|item| item == "-f" || item == "--file");
                if cmd == "docker" && (arg0 == Some("build") || (arg0 == Some("buildx") && args.get(1).map(String::as_str) == Some("build"))) {
                    let context = pos.last().copied().unwrap_or_default();
                    let dockerfile = match file_flag {
                        Some(at) => args.get(at + 1).cloned(),
                        None if !context.is_empty() && literal(context) => Some(join_path(context, "Dockerfile")),
                        None => None,
                    };
                    if let Some(dockerfile) = dockerfile.filter(|item| literal(item))
                        && !exists!(&dockerfile, false)
                    {
                        line_add!(
                            "dockerfile-missing",
                            Error,
                            title = tr!("docker-build-no", dockerfile),
                            how = "«failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory».",
                            why = tr!("file-isnt-in-repository-2", q(join_path(&cwd, &dockerfile))),
                            fix = tr!("specify-right-path-with-f"),
                        );
                    }
                }
                if (cmd == "docker-compose" || (cmd == "docker" && arg0 == Some("compose")))
                    && let Some(compose) = file_flag.and_then(|at| args.get(at + 1)).filter(|item| literal(item))
                    && !exists!(compose, false)
                {
                    line_add!(
                        "compose-missing",
                        Error,
                        title = tr!("docker-compose-f-no-such", compose),
                        how = "«open …: no such file or directory».",
                        why = tr!("file-isnt-in-repository-2", q(join_path(&cwd, compose))),
                        fix = tr!("check-path"),
                    );
                }
                if cmd == "kubectl"
                    && matches!(arg0, Some("apply" | "create" | "delete" | "replace"))
                    && let Some(manifest) = after("-f").filter(|item| literal(item) && re!(r"\.(ya?ml|json)$").test(item))
                    && !exists!(manifest, false)
                {
                    line_add!(
                        "kubectl-missing",
                        Error,
                        title = tr!("kubectl-f-no-such-file", arg0.unwrap_or_default(), manifest),
                        how = format!("«error: the path \"{manifest}\" does not exist»."),
                        why = tr!("file-isnt-in-repository-2", q(join_path(&cwd, manifest))),
                        fix = tr!("check-path"),
                    );
                }
            }
        }
    }
    Ok(())
}
