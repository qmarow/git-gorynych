//! `extends`, `!reference`, неиспользуемые шаблоны и этапы из `checkGitlab`.

use std::collections::HashSet;

use gorynych_core::js;

use super::{Gl, config_when, extend, rejected};
use crate::check::base::*;
use crate::js_regex::JsRegex;
use crate::load::gitlab::property;
use crate::load::model::CiSeverity;
use crate::load_common_as_array as arr;
use crate::yaml::{PathItem, Value, js_join};

enum Walk {
    Cycle(Vec<String>),
    Depth(usize),
}

impl Gl<'_, '_> {
    fn extends_of(&self, name: &str) -> Vec<Value> {
        self.raw.jobs.get(name).map_or_else(Vec::new, |entry| arr(entry.config.get("extends")).into_iter().cloned().collect())
    }

    fn walk_extends(&self, name: &str, stack: &mut Vec<String>) -> Walk {
        if let Some(at) = stack.iter().position(|item| item == name) {
            let mut cycle = stack[at..].to_vec();
            cycle.push(name.to_owned());
            return Walk::Cycle(cycle);
        }
        let mut depth = stack.len();
        stack.push(name.to_owned());
        for parent in self.extends_of(name) {
            // Родитель не строка в графе встречается, только если у него самого неверный `extends`: узла с таким именем нет
            let next = match parent.as_str() {
                Some(parent) => self.walk_extends(parent, stack),
                None => Walk::Depth(stack.len()),
            };
            match next {
                cycle @ Walk::Cycle(_) => {
                    stack.pop();
                    return cycle;
                }
                Walk::Depth(found) => depth = depth.max(found),
            }
        }
        stack.pop();
        Walk::Depth(depth)
    }

    pub(super) fn check_extends(&mut self) {
        let names: Vec<String> = self.raw.jobs.keys().cloned().collect();
        let mut reported = HashSet::new();
        for name in &names {
            let declared = self.raw.jobs[name].config.get("extends").cloned();
            let valid = match &declared {
                None | Some(Value::String(_)) => true,
                Some(Value::Seq(items)) => items.iter().all(|item| matches!(item, Value::String(_))),
                Some(_) => false,
            };
            if !valid {
                self.job_issue(name, &kp!["extends"], draft!("extends-type", Error, title = tr!("{0}: extends должен быть именем или списком имён", q(name)), how = rejected(format!("jobs:{name}:extends config should be an array of strings or a string")), why = tr!("extends указывает имена заданий-шаблонов."), fix = tr!("extends: .template или extends: [.a, .b]")));
                continue;
            }
            for parent in self.extends_of(name) {
                let parent_name = parent.js_string();
                if !parent.as_str().is_some_and(|parent| self.raw.jobs.contains_key(parent)) {
                    let offline_hint = if self.offline.is_empty() { String::new() } else { tr!(" (Возможно, он в подключении из сети — тогда всё в порядке.)") };
                    let known = did_you_mean(&parent_name, self.raw.jobs.keys().map(String::as_str));
                    let mut item = draft!("extends-unknown", Error, title = tr!("{0}: extends ссылается на несуществующее {1}", q(name), q(&parent_name)), how = rejected(format!("{name}: unknown keys in `extends` ({parent_name})")), why = tr!("Задания или шаблона {0} нет ни в этом файле, ни в подключённых локальных.{1}{2}", q(&parent_name), known, offline_hint), fix = tr!("Поправьте имя или добавьте шаблон."));
                    if !self.offline.is_empty() {
                        item.severity = CiSeverity::Warning;
                    }
                    self.job_issue(name, &kp!["extends"], item);
                }
            }
            match self.walk_extends(name, &mut Vec::new()) {
                Walk::Cycle(cycle) => {
                    let mut unique: Vec<&str> = cycle.iter().map(String::as_str).collect::<HashSet<_>>().into_iter().collect();
                    unique.sort_by(|a, b| js::utf16_cmp(a, b));
                    if reported.insert(unique.join("|")) {
                        self.job_issue(name, &kp!["extends"], draft!("extends-cycle", Error, title = tr!("Циклическое наследование: {0}", cycle.join(" → ")), how = rejected("circular dependency detected in `extends`"), why = tr!("Задания наследуют друг друга по кругу — итоговую конфигурацию собрать невозможно."), fix = tr!("Разорвите цикл: вынесите общее в отдельный шаблон.")));
                    }
                }
                Walk::Depth(depth) if depth > 11 => {
                    self.job_issue(name, &kp!["extends"], draft!("extends-depth", Error, title = tr!("{0}: слишком глубокое наследование ({1})", q(name), depth), how = rejected("nesting too deep in `extends`"), why = tr!("GitLab допускает не более 11 уровней extends."), fix = tr!("Упростите цепочку шаблонов.")));
                }
                Walk::Depth(_) => {}
            }
        }

        // !reference
        fn find_refs(value: &Value, path: &[PathItem], out: &mut Vec<(Vec<Value>, Vec<PathItem>)>) {
            match value {
                Value::Seq(items) => {
                    for (index, item) in items.iter().enumerate() {
                        find_refs(item, &extend(path, kp![index]), out);
                    }
                }
                Value::Map(map) => {
                    if let Some(reference) = crate::load::common::reference_of(value) {
                        out.push((reference.to_vec(), path.to_vec()));
                    } else {
                        for (key, item) in map.iter() {
                            find_refs(item, &extend(path, kp![key]), out);
                        }
                    }
                }
                _ => {}
            }
        }
        let mut used: HashSet<String> = HashSet::new();
        for definition in &self.raw.job_defs {
            let mut found = Vec::new();
            find_refs(&definition.value, &kp![&definition.name], &mut found);
            for (reference, path) in found {
                let target = reference.first().map(Value::js_string);
                if let Some(target) = &target {
                    used.insert(target.clone());
                }
                let keys: Vec<String> = reference.iter().skip(1).map(Value::js_string).collect();
                let job_known = target.as_ref().is_some_and(|target| self.raw.jobs.contains_key(target));
                let global_known = target.as_ref().is_some_and(|target| self.globals.get(target).is_some());
                let mut current = match &target {
                    Some(name) if global_known => self.globals.get(name).cloned(),
                    Some(name) => self.raw.resolve_job(name).map(|job| job.config.clone()),
                    None => None,
                };
                for key in &keys {
                    current = current.and_then(|value| property(&value, key));
                }
                if current.is_some() {
                    continue;
                }
                let joined = js_join(reference.iter(), ", ");
                let quoted = js_join(reference.iter(), "\", \"");
                let shown = target.clone().unwrap_or_else(|| "undefined".to_owned());
                let why = if job_known || global_known {
                    tr!("У {0} нет ключа {1}.", q(&shown), q(keys.join(" → ")))
                } else {
                    tr!("Задания {0} нет.{1}", q(&shown), did_you_mean(&shown, self.raw.jobs.keys().map(String::as_str)))
                };
                let line = self.cx.pos.line(&definition.source, &path).or(definition.line);
                let mut item = draft!("reference-missing", Error, title = tr!("!reference [{0}] — такого нет", joined), when = config_when(), how = rejected(format!("!reference [\"{quoted}\"] could not be found")), why = why, fix = tr!("Поправьте имя задания/ключа в !reference."), file = definition.source.clone(), line = line, job = definition.name.clone());
                if !self.offline.is_empty() && !job_known {
                    item.severity = CiSeverity::Warning;
                }
                self.cx.add(item);
            }
        }

        // Шаблоны, которые никто не использует
        for name in &names {
            used.extend(self.chain_of(name));
        }
        for (name, entry) in &self.raw.jobs {
            let has_keys = entry.config.as_map().is_some_and(|map| !map.is_empty());
            if name.starts_with('.') && !used.contains(name) && name != ".pre" && name != ".post" && !entry.config.get("script").is_some_and(Value::truthy) && has_keys {
                let text = self.config.files.iter().find(|file| file.path == entry.source).map_or("", |file| file.text.as_str());
                let mut escaped = String::with_capacity(name.len() + 4);
                for c in name.chars() {
                    if matches!(c, '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\') {
                        escaped.push('\\');
                    }
                    escaped.push(c);
                }
                let anchored = JsRegex::new(&format!(r"^\s*{escaped}\s*:\s*&"), "m").is_ok_and(|regex| regex.is_match(text));
                if !anchored {
                    self.cx.add(draft!("template-unused", Info, title = tr!("Шаблон {0} нигде не используется", q(name)), when = config_when(), how = tr!("Ничего не сломается — он просто не участвует в пайплайне."), why = tr!("Ни одно задание не наследует его через extends и не ссылается через !reference."), fix = tr!("Удалите шаблон или подключите его через extends."), file = entry.source.clone(), line = entry.line, job = name.clone()));
                }
            }
        }

        // Этапы
        let declared = &self.raw.declared_stages;
        let mut duplicates: Vec<&str> = Vec::new();
        for (index, stage) in declared.iter().enumerate() {
            if declared.iter().position(|item| item == stage) != Some(index) && !duplicates.contains(&stage.as_str()) {
                duplicates.push(stage);
            }
        }
        if !duplicates.is_empty() {
            let title = tr!("Этап объявлен дважды: {0}", duplicates.join(", "));
            self.glob_issue(&kp!["stages"], draft!("stages-duplicate", Warning, title = title, how = tr!("GitLab оставит только первое упоминание; порядок этапов может оказаться не тем, что ожидается."), why = tr!("Каждый этап должен встречаться в stages один раз."), fix = tr!("Удалите повтор.")));
        }
        if declared.iter().any(|stage| stage == ".pre" || stage == ".post") {
            self.glob_issue(&kp!["stages"], draft!("stages-pre-post", Info, title = tr!(".pre и .post в stages указывать не нужно"), how = tr!("Ничего не сломается: эти этапы есть всегда и всегда идут первым и последним."), why = tr!("Их позиция фиксирована, указанный порядок игнорируется."), fix = tr!("Уберите .pre / .post из stages.")));
        }
    }
}
