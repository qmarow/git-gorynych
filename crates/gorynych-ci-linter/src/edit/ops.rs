//! Визуальные правки GitLab CI: `OPS` и `applyEdit` из `electron/ciEdit.cjs`.
//!
//! ## Конспект
//! - Операции: `addJob deleteJob renameJob setJob addStage renameStage deleteStage moveStage`. Коды: `INVALID_NAME` (пусто, длиннее 255 единиц UTF-16, перевод строки,
//!   для задания — зарезервированное слово), `JOB_EXISTS`, `STAGE_EXISTS`, `STAGE_NOT_EMPTY` с подсказкой, `NOT_FOUND`, `YAML_ERROR` (ошибки разбора, корень не словарь,
//!   `stages` не список), `BAD_ARGS` (неизвестная правка, поле не из `EDITABLE_FIELDS`, пустой `script`, недопустимый `when`).
//! - Задания: `jobPairs` — словари вне `GITLAB_GLOBAL`; алиас заданием не считается. `stages` — первая пара `stages` или `types`.
//! - `addJob`: после последнего задания того же этапа, иначе в конец, с пустой строкой перед ним (если файл не пуст). `script` по умолчанию `echo "<имя>"`. Этап, которого нет в
//!   существующем `stages`, дописывается. Сам `stages` создают только операции над этапами: строчной записью после ведущих `include`, из `build test deploy` и этапов заданий.
//! - `deleteJob` чистит `needs` и `dependencies` (не `extends`), опустевший список удаляется. `renameJob` меняет и `extends`. Заметки без повторов.
//! - `setJob`, поля по порядку: списочные поля — обрезка справа и без пустых строк; `when: on_success` и `allow_failure: false` не пишутся; правило без `if` и `when` получает
//!   `when: on_success`. Пустое значение удаляет ключ, кроме `needs: []`. Список в строку: если так было, или новые `needs` и `tags`. Вид скаляра сохраняется.
//! - `moveStage`: создание `stages` происходит и когда сдвигать некуда.
//!
//! ## Отличия от 1.x
//! Результат 1.x строился нормализацией всего файла и переносом изменённых строк, здесь правится только свой участок (см. `text.rs`). Данные результата совпадают, текст может отличаться:
//! - Не теряется: комментарий в строке переименованного ключа, отступ в 4 пробела и пробелы внутри скобок (1.x при несовпадении переписывал файл целиком).
//! - Якорь на заменённом значении сохраняется.
//! - Повтор ключа задания: 1.x менял первое определение, хотя действует последнее, и правка молча не имела эффекта. Здесь это отказ.
//! - При невозможной точечной правке — `YAML_ERROR`, а не перезапись всего файла. Например, удаление задания с `&якорем`, на который есть алиасы (в 1.x падение без кода).

use gorynych_core::Language;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n;
use gorynych_core::js;
use serde::{Deserialize, Serialize};

use super::text::{Editor, Pair};
use crate::js_regex::JsRegex;
use crate::yaml::{Document, JsMap, NodeId, NodeKind, Value};

const GITLAB_GLOBAL: [&str; 12] =
    ["default", "include", "stages", "types", "variables", "workflow", "image", "services", "cache", "before_script", "after_script", "spec"];
const DEFAULT_STAGES: [&str; 3] = ["build", "test", "deploy"];
const EDITABLE_FIELDS: [&str; 13] = ["stage", "image", "script", "before_script", "after_script", "when", "allow_failure", "needs", "tags", "environment", "timeout", "rules", "interruptible"];
const LIST_FIELDS: [&str; 5] = ["script", "before_script", "after_script", "tags", "needs"];
const WHEN_VALUES: [&str; 6] = ["on_success", "on_failure", "always", "manual", "delayed", "never"];
const MAX_NAME: usize = 255;

/// Правка: `op` у `repo:ci-edit`.
#[derive(Debug, Clone, PartialEq, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CiEditOp {
    AddJob {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        stage: Option<String>,
        #[serde(default)]
        image: Option<String>,
        /// Строка или список строк.
        #[serde(default)]
        script: Option<Value>,
    },
    DeleteJob {
        name: String,
    },
    RenameJob {
        from: String,
        to: String,
    },
    SetJob {
        name: String,
        #[serde(default)]
        fields: JsMap,
    },
    AddStage {
        name: String,
        #[serde(default)]
        index: Option<f64>,
    },
    RenameStage {
        from: String,
        to: String,
    },
    DeleteStage {
        name: String,
    },
    MoveStage {
        name: String,
        dir: f64,
    },
    #[serde(other)]
    Unknown,
}

/// Результат `applyEdit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CiEditResult {
    pub content: String,
    pub notes: Vec<String>,
}

fn string_value(text: impl Into<String>) -> Value {
    Value::String(text.into())
}

/// `stringifyOptions`: стиль списков в файле.
fn indent_seq_of(text: &str) -> bool {
    let regex = JsRegex::new(r"^( *)[^\s#-][^:\n]*:\s*\n( *)- ", "m").expect("шаблон из кода");
    let units: Vec<u16> = text.encode_utf16().collect();
    let Some(groups) = regex.captures(&units) else { return true };
    let length = |index: usize| groups.get(index).cloned().flatten().map_or(0, |range| range.len());
    length(2) > length(1)
}

struct Ops {
    editor: Editor,
    language: Language,
}

/// Ссылка на задание в `needs`, `dependencies`, `extends`.
#[derive(Debug, Clone)]
struct Reference {
    /// Индекс пары в словаре верхнего уровня.
    job_at: usize,
    job: String,
    key: &'static str,
    index: Option<usize>,
    value: String,
}

impl Ops {
    fn t(&self, msg: &str, args: &[&dyn std::fmt::Display]) -> String {
        i18n::tr(self.language, msg, args)
    }

    fn error(&self, code: ErrorCode, message: String) -> GorynychError {
        GorynychError::new(code, message)
    }

    /* -------------------------------- Задания ------------------------------- */

    fn job_pairs(&self) -> Vec<Pair> {
        let editor = &self.editor;
        editor.root_pairs().into_iter().filter(|pair| !GITLAB_GLOBAL.contains(&editor.key_of(*pair).as_str()) && editor.is_map(pair.value)).collect()
    }

    fn find_job(&self, name: &str) -> Result<(usize, Pair)> {
        let pairs = self.editor.root_pairs();
        match pairs.iter().position(|pair| self.editor.key_of(*pair) == name) {
            Some(at) if self.editor.is_map(pairs[at].value) => Ok((at, pairs[at])),
            _ => Err(self.error(ErrorCode::NotFound, self.t("Задание «{0}» не найдено в этом файле", &[&name]))),
        }
    }

    fn validate_name(&self, name: &str, is_job: bool) -> Result<String> {
        let trimmed = js::trim(name).to_owned();
        let kind = if is_job { self.t("задание", &[]) } else { self.t("этап", &[]) };
        if trimmed.is_empty() {
            return Err(self.error(ErrorCode::InvalidName, self.t("Введите имя ({0})", &[&kind])));
        }
        if js::utf16_len(&trimmed) > MAX_NAME {
            return Err(self.error(ErrorCode::InvalidName, self.t("Слишком длинное имя", &[])));
        }
        if trimmed.contains(['\n', '\r']) {
            return Err(self.error(ErrorCode::InvalidName, self.t("Имя не может содержать перевод строки", &[])));
        }
        if is_job {
            if GITLAB_GLOBAL.contains(&trimmed.as_str()) {
                return Err(self.error(ErrorCode::InvalidName, self.t("«{0}» — зарезервированное слово GitLab CI", &[&trimmed])));
            }
            if self.editor.root_pairs().iter().any(|pair| self.editor.key_of(*pair) == trimmed) {
                return Err(self.error(ErrorCode::JobExists, self.t("Задание «{0}» уже есть", &[&trimmed])));
            }
        }
        Ok(trimmed)
    }

    /// Словарь задания в ожидаемом дереве.
    fn tree_job(&mut self, name: &str) -> Result<&mut JsMap> {
        let refused = self.editor.refuse::<()>("задание не найдено в дереве").unwrap_err();
        self.editor.tree.as_map_mut().and_then(|map| map.get_mut(name)).and_then(Value::as_map_mut).ok_or(refused)
    }

    /* --------------------------------- Этапы -------------------------------- */

    fn stages_pair(&self) -> Option<Pair> {
        self.editor.root_pairs().into_iter().find(|pair| matches!(self.editor.key_of(*pair).as_str(), "stages" | "types"))
    }

    /// `stagesNode`: пара `stages`. С `create` — создаётся, если её нет.
    fn stages_node(&mut self, create: bool) -> Result<Option<Pair>> {
        if self.stages_pair().is_none() && create {
            let mut list: Vec<String> = DEFAULT_STAGES.iter().map(|stage| (*stage).to_owned()).collect();
            for pair in self.job_pairs() {
                let used = self.editor.stage_of(pair.value);
                if !list.contains(&used) && used != ".pre" && used != ".post" {
                    list.push(used);
                }
            }
            let node = Value::Seq(list.into_iter().map(Value::String).collect());
            let pairs = self.editor.root_pairs();
            let at = pairs.iter().position(|pair| self.editor.key_of(*pair) != "include").unwrap_or(pairs.len());
            let before = pairs.get(at).map(|pair| self.editor.key_of(*pair));
            self.editor.insert_root_pair(at, "stages", &node, false, true)?;
            if let Some(map) = self.editor.tree.as_map_mut() {
                map.insert_before(before.as_deref(), "stages".to_owned(), node);
            }
        }
        let Some(pair) = self.stages_pair() else { return Ok(None) };
        if !matches!(self.editor.doc.node(pair.value).kind, NodeKind::Seq(_)) {
            return Err(self.error(ErrorCode::YamlError, self.t("stages должен быть списком", &[])));
        }
        Ok(Some(pair))
    }

    fn stage_names(&self, seq: Option<NodeId>) -> Vec<String> {
        match seq {
            Some(seq) => self.editor.items_of(seq).into_iter().map(|item| self.editor.doc.node_string(item, &self.editor.text)).collect(),
            None => DEFAULT_STAGES.iter().map(|stage| (*stage).to_owned()).collect(),
        }
    }

    fn tree_stages(&mut self, key: &str) -> Result<&mut Vec<Value>> {
        let refused = self.editor.refuse::<()>("этапы не найдены в дереве").unwrap_err();
        match self.editor.tree.as_map_mut().and_then(|map| map.get_mut(key)) {
            Some(Value::Seq(items)) => Ok(items),
            _ => Err(refused),
        }
    }

    /// Дописывает этап в конец существующего списка.
    fn push_stage(&mut self, pair: Pair, value: &Value) -> Result<()> {
        let key = self.editor.key_of(pair);
        let at = self.editor.items_of(pair.value).len();
        self.editor.insert_item(pair.value, at, value)?;
        self.tree_stages(&key)?.push(value.clone());
        Ok(())
    }

    /* ------------------------------- Ссылки ------------------------------- */

    /// `forEachRef`: ссылки в порядке 1.x, элементы списка — с конца.
    fn references(&self) -> Vec<Reference> {
        let editor = &self.editor;
        let mut out = Vec::new();
        let roots = editor.root_pairs();
        for pair in self.job_pairs() {
            let job = editor.key_of(pair);
            let job_at = roots.iter().position(|item| item.key == pair.key).unwrap_or(0);
            for key in ["needs", "dependencies", "extends"] {
                let Some(field) = editor.field(pair.value, key) else { continue };
                if let Some(value) = editor.doc.scalar(field.value) {
                    out.push(Reference { job_at, job: job.clone(), key, index: None, value: value.js_string() });
                    continue;
                }
                for (index, item) in editor.items_of(field.value).into_iter().enumerate().rev() {
                    let scalar = if editor.is_map(item) { editor.field(item, "job").map(|pair| pair.value) } else { Some(item) };
                    if let Some(value) = scalar.and_then(|scalar| editor.doc.scalar(scalar)) {
                        out.push(Reference { job_at, job: job.clone(), key, index: Some(index), value: value.js_string() });
                    }
                }
            }
        }
        out
    }

    /* ----------------------------- Поля задания ----------------------------- */

    /// `setOrDelete`.
    fn set_or_delete(&mut self, name: &str, job_at: usize, key: &str, value: &Value) -> Result<()> {
        let empty = match value {
            Value::Null => true,
            Value::String(text) => text.is_empty(),
            Value::Seq(items) => items.is_empty() && key != "needs",
            _ => false,
        };
        let job = self.editor.root_pairs()[job_at];
        let existing = self.editor.field(job.value, key);
        if self.editor.is_flow(job.value) {
            {
                let tree = self.tree_job(name)?;
                if empty {
                    tree.remove(key);
                } else {
                    tree.insert(key.to_owned(), value.clone());
                }
            }
            let updated = Value::Map(self.tree_job(name)?.clone());
            return self.editor.replace_flow(job.value, &updated);
        }
        if empty {
            let Some(field) = existing else { return Ok(()) };
            self.tree_job(name)?.remove(key);
            let pairs = self.editor.pairs_of(job.value);
            if pairs.len() == 1 {
                return self.editor.replace_value(job, &Value::Map(JsMap::new()), true);
            }
            let index = pairs.iter().position(|pair| pair.key == field.key).unwrap_or(0);
            return self.editor.remove_pair_lines(job.value, index);
        }
        let is_seq = matches!(value, Value::Seq(_));
        let flow = is_seq && (existing.is_some_and(|field| self.editor.is_flow(field.value)) || (matches!(key, "needs" | "tags") && existing.is_none()));
        self.tree_job(name)?.insert(key.to_owned(), value.clone());
        match existing {
            Some(field) => self.editor.replace_value(field, value, flow),
            None => self.editor.append_pair(job.value, key, value, flow),
        }
    }

    /// Значение поля до записи: приведение типов и значения по умолчанию из `OPS.setJob`.
    fn normalize_field(&self, key: &str, raw: &Value) -> Result<Value> {
        let mut value = raw.clone();
        if LIST_FIELDS.contains(&key) && !value.is_null() {
            let lines: Vec<String> = match &value {
                Value::Seq(items) => items.iter().map(Value::js_string).collect(),
                other => other.js_string().split('\n').map(str::to_owned).collect(),
            };
            let cleaned: Vec<Value> = lines
                .iter()
                .map(|line| line.trim_end_matches(js::is_whitespace))
                .filter(|line| !js::trim(line).is_empty())
                .map(string_value)
                .collect();
            if key == "script" && cleaned.is_empty() {
                return Err(self.error(ErrorCode::BadArgs, self.t("У задания должен быть хотя бы один шаг script", &[])));
            }
            value = Value::Seq(cleaned);
        }
        if key == "when" && value.truthy() && !value.as_str().is_some_and(|when| WHEN_VALUES.contains(&when)) {
            return Err(self.error(ErrorCode::BadArgs, self.t("Недопустимое значение when: {0}", &[&value.js_string()])));
        }
        if key == "allow_failure" && !value.is_null() {
            value = Value::Bool(value.truthy());
        }
        if (key == "when" && value.as_str() == Some("on_success")) || (key == "allow_failure" && value == Value::Bool(false)) {
            value = Value::Null;
        }
        if key == "rules"
            && let Value::Seq(rules) = &value
        {
            value = Value::Seq(rules.iter().map(normalize_rule).collect());
        }
        Ok(value)
    }

    /* ------------------------------- Операции ------------------------------- */

    fn add_job(&mut self, name: Option<&str>, stage: Option<&str>, image: Option<&str>, script: Option<&Value>) -> Result<Vec<String>> {
        let name = self.validate_name(name.unwrap_or_default(), true)?;
        let stage = Some(js::trim(stage.unwrap_or_default())).filter(|stage| !stage.is_empty()).unwrap_or("test").to_owned();
        let mut job = JsMap::new();
        job.insert("stage".to_owned(), string_value(stage.clone()));
        if let Some(image) = image.map(js::trim).filter(|image| !image.is_empty()) {
            job.insert("image".to_owned(), string_value(image));
        }
        let lines: Vec<String> = match script {
            Some(Value::Seq(items)) => items.iter().map(Value::js_string).collect(),
            Some(Value::Null) | None => vec![String::new()],
            Some(other) => other.js_string().split('\n').map(str::to_owned).collect(),
        };
        let mut steps: Vec<Value> = lines.iter().map(|line| line.trim_end_matches(js::is_whitespace)).filter(|line| !line.is_empty()).map(string_value).collect();
        if steps.is_empty() {
            steps.push(string_value(format!("echo \"{name}\"")));
        }
        job.insert("script".to_owned(), Value::Seq(steps));
        let job = Value::Map(job);

        let pairs = self.editor.root_pairs();
        let last_same = self.job_pairs().iter().rev().find(|pair| self.editor.stage_of(pair.value) == stage).copied();
        let at = last_same.and_then(|last| pairs.iter().position(|pair| pair.key == last.key)).map_or(pairs.len(), |at| at + 1);
        let before = pairs.get(at).map(|pair| self.editor.key_of(*pair));
        self.editor.insert_root_pair(at, &name, &job, true, false)?;
        if let Some(map) = self.editor.tree.as_map_mut() {
            map.insert_before(before.as_deref(), name, job);
        }

        if let Some(pair) = self.stages_node(false)? {
            let names = self.stage_names(Some(pair.value));
            if !names.contains(&stage) && stage != ".pre" && stage != ".post" {
                self.push_stage(pair, &string_value(stage))?;
            }
        }
        Ok(Vec::new())
    }

    fn delete_job(&mut self, name: &str) -> Result<Vec<String>> {
        let (at, _) = self.find_job(name)?;
        let root = self.editor.root();
        let flow_root = root.is_some_and(|root| self.editor.is_flow(root));
        if let Some(map) = self.editor.tree.as_map_mut() {
            map.remove(name);
        }
        match root {
            Some(_) if flow_root => {
                let updated = self.editor.tree.clone();
                if let Some(root) = root {
                    self.editor.replace_flow(root, &updated)?;
                }
            }
            Some(root) => self.editor.remove_pair_lines(root, at)?,
            None => {}
        }
        let mut notes = Vec::new();
        for reference in self.references() {
            if reference.value != name || reference.key == "extends" {
                continue;
            }
            self.remove_reference(&reference)?;
            let note = self.t("«{0}»: убрано из {1}", &[&reference.job, &reference.key]);
            if !notes.contains(&note) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    fn remove_reference(&mut self, reference: &Reference) -> Result<()> {
        let job = self.editor.root_pairs()[reference.job_at];
        let Some(field) = self.editor.field(job.value, reference.key) else { return self.editor.refuse("ссылка не найдена") };
        let Some(index) = reference.index else {
            return self.delete_field(&reference.job, reference.job_at, reference.key);
        };
        if self.editor.items_of(field.value).len() == 1 {
            return self.delete_field(&reference.job, reference.job_at, reference.key);
        }
        let flow_job = self.editor.is_flow(job.value);
        match self.tree_job(&reference.job)?.get_mut(reference.key) {
            Some(Value::Seq(items)) if index < items.len() => {
                items.remove(index);
            }
            _ => return self.editor.refuse("ссылка не найдена в дереве"),
        }
        if flow_job {
            let updated = Value::Map(self.tree_job(&reference.job)?.clone());
            return self.editor.replace_flow(job.value, &updated);
        }
        self.editor.remove_item(field.value, index)
    }

    fn delete_field(&mut self, job_name: &str, job_at: usize, key: &str) -> Result<()> {
        self.set_or_delete(job_name, job_at, key, &Value::Null)
    }

    fn rename_job(&mut self, from: &str, to: &str) -> Result<Vec<String>> {
        let (_, pair) = self.find_job(from)?;
        let name = self.validate_name(to, true)?;
        self.editor.set_scalar(pair.key, &name, true)?;
        if let Some(map) = self.editor.tree.as_map() {
            self.editor.tree = Value::Map(map.rename(from, &name));
        }
        let mut notes = Vec::new();
        for reference in self.references() {
            if reference.value != from {
                continue;
            }
            self.rename_reference(&reference, &name)?;
            let note = self.t("«{0}»: обновлена ссылка в {1}", &[&reference.job, &reference.key]);
            if !notes.contains(&note) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    fn rename_reference(&mut self, reference: &Reference, name: &str) -> Result<()> {
        let job = self.editor.root_pairs()[reference.job_at];
        let Some(field) = self.editor.field(job.value, reference.key) else { return self.editor.refuse("ссылка не найдена") };
        let scalar = match reference.index {
            None => field.value,
            Some(index) => {
                let item = self.editor.items_of(field.value)[index];
                if self.editor.is_map(item) {
                    match self.editor.field(item, "job") {
                        Some(pair) => pair.value,
                        None => return self.editor.refuse("ссылка не найдена"),
                    }
                } else {
                    item
                }
            }
        };
        self.editor.set_scalar(scalar, name, false)?;
        let value = string_value(name);
        let target = self.tree_job(&reference.job)?.get_mut(reference.key);
        match (target, reference.index) {
            (Some(slot), None) => *slot = value,
            (Some(Value::Seq(items)), Some(index)) if index < items.len() => match &mut items[index] {
                Value::Map(map) => map.insert("job".to_owned(), value),
                slot => *slot = value,
            },
            _ => return self.editor.refuse("ссылка не найдена в дереве"),
        }
        Ok(())
    }

    fn set_job(&mut self, name: &str, fields: &JsMap) -> Result<Vec<String>> {
        let (job_at, _) = self.find_job(name)?;
        let mut notes = Vec::new();
        for (key, raw) in fields.iter() {
            if !EDITABLE_FIELDS.contains(&key.as_str()) {
                return Err(self.error(ErrorCode::BadArgs, self.t("Поле {0} нельзя менять здесь", &[key])));
            }
            let value = self.normalize_field(key, raw)?;
            if key == "stage"
                && value.truthy()
                && let Some(pair) = self.stages_node(false)?
            {
                let names = self.stage_names(Some(pair.value));
                let text = value.as_str();
                if !text.is_some_and(|text| names.iter().any(|name| name == text)) && text != Some(".pre") && text != Some(".post") {
                    self.push_stage(pair, &value)?;
                    notes.push(self.t("Этап «{0}» добавлен в stages", &[&value.js_string()]));
                }
            }
            // Правка `stages` могла сдвинуть пары: индекс не меняется, пока не создаётся новая
            self.set_or_delete(name, job_at, key, &value)?;
        }
        Ok(notes)
    }

    fn require_stages(&mut self) -> Result<Pair> {
        match self.stages_node(true)? {
            Some(pair) => Ok(pair),
            None => self.editor.refuse("этапы не созданы"),
        }
    }

    fn add_stage(&mut self, name: &str, index: Option<f64>) -> Result<Vec<String>> {
        let name = self.validate_name(name, false)?;
        let pair = self.require_stages()?;
        if self.stage_names(Some(pair.value)).contains(&name) {
            return Err(self.error(ErrorCode::StageExists, self.t("Этап «{0}» уже есть", &[&name])));
        }
        let length = self.editor.items_of(pair.value).len();
        let at = index.filter(|index| index.fract() == 0.0 && index.is_finite()).map_or(length, |index| index.clamp(0.0, length as f64) as usize);
        let value = string_value(name);
        if !self.editor.is_flow(pair.value) && length == 0 {
            return self.editor.refuse("пустой блочный список");
        }
        self.editor.insert_item(pair.value, at, &value)?;
        let key = self.editor.key_of(pair);
        self.tree_stages(&key)?.insert(at, value);
        Ok(Vec::new())
    }

    fn rename_stage(&mut self, from: &str, to: &str) -> Result<Vec<String>> {
        let name = self.validate_name(to, false)?;
        let pair = self.require_stages()?;
        let names = self.stage_names(Some(pair.value));
        let Some(index) = names.iter().position(|stage| stage == from) else {
            return Err(self.error(ErrorCode::NotFound, self.t("Этап «{0}» не найден в stages", &[&from])));
        };
        if names.contains(&name) {
            return Err(self.error(ErrorCode::StageExists, self.t("Этап «{0}» уже есть", &[&name])));
        }
        let key = self.editor.key_of(pair);
        let item = self.editor.items_of(pair.value)[index];
        self.editor.set_scalar(item, &name, false)?;
        self.tree_stages(&key)?[index] = string_value(name.clone());

        let job_keys: Vec<NodeId> = self.job_pairs().iter().map(|pair| pair.key).collect();
        let mut moved = 0usize;
        for at in 0..job_keys.len() {
            let pair = self.job_pairs()[at];
            let Some(field) = self.editor.field(pair.value, "stage") else { continue };
            let current = self.editor.doc.scalar(field.value);
            if current.is_some_and(|value| value.js_string() == from) {
                let job = self.editor.key_of(pair);
                self.editor.set_scalar(field.value, &name, false)?;
                self.tree_job(&job)?.insert("stage".to_owned(), string_value(name.clone()));
                moved += 1;
            }
        }
        Ok(if moved > 0 { vec![self.t("Перенесено заданий: {0}", &[&moved])] } else { Vec::new() })
    }

    fn delete_stage(&mut self, name: &str) -> Result<Vec<String>> {
        let pair = self.require_stages()?;
        let Some(index) = self.stage_names(Some(pair.value)).iter().position(|stage| stage == name) else {
            return Err(self.error(ErrorCode::NotFound, self.t("Этап «{0}» не найден в stages", &[&name])));
        };
        let users: Vec<String> =
            self.job_pairs().into_iter().filter(|job| self.editor.stage_of(job.value) == name).map(|job| self.editor.key_of(job)).collect();
        if !users.is_empty() {
            return Err(self
                .error(ErrorCode::StageNotEmpty, self.t("В этапе «{0}» есть задания: {1}", &[&name, &users.join(", ")]))
                .with_hint(self.t("Сначала перенесите или удалите эти задания", &[])));
        }
        let key = self.editor.key_of(pair);
        self.tree_stages(&key)?.remove(index);
        if self.editor.items_of(pair.value).len() == 1 && !self.editor.is_flow(pair.value) {
            self.editor.replace_value(pair, &Value::Seq(Vec::new()), true)?;
        } else {
            self.editor.remove_item(pair.value, index)?;
        }
        Ok(Vec::new())
    }

    fn move_stage(&mut self, name: &str, dir: f64) -> Result<Vec<String>> {
        let pair = self.require_stages()?;
        let Some(index) = self.stage_names(Some(pair.value)).iter().position(|stage| stage == name) else { return Ok(Vec::new()) };
        let length = self.editor.items_of(pair.value).len();
        let target = if dir < 0.0 { index.checked_sub(1) } else { Some(index + 1) };
        let Some(target) = target.filter(|target| *target < length) else { return Ok(Vec::new()) };
        let (first, second) = (index.min(target), index.max(target));
        self.editor.swap_items(pair.value, first, second)?;
        let key = self.editor.key_of(pair);
        self.tree_stages(&key)?.swap(first, second);
        Ok(Vec::new())
    }

    fn run(&mut self, op: &CiEditOp) -> Result<Vec<String>> {
        match op {
            CiEditOp::AddJob { name, stage, image, script } => self.add_job(name.as_deref(), stage.as_deref(), image.as_deref(), script.as_ref()),
            CiEditOp::DeleteJob { name } => self.delete_job(name),
            CiEditOp::RenameJob { from, to } => self.rename_job(from, to),
            CiEditOp::SetJob { name, fields } => self.set_job(name, fields),
            CiEditOp::AddStage { name, index } => self.add_stage(name, *index),
            CiEditOp::RenameStage { from, to } => self.rename_stage(from, to),
            CiEditOp::DeleteStage { name } => self.delete_stage(name),
            CiEditOp::MoveStage { name, dir } => self.move_stage(name, *dir),
            CiEditOp::Unknown => Err(self.error(ErrorCode::BadArgs, self.t("Неизвестная правка", &[]))),
        }
    }
}

/// Правило из формы: `value.map` в `OPS.setJob`.
fn normalize_rule(rule: &Value) -> Value {
    let mut out = JsMap::new();
    if let Some(condition) = rule.get("if").filter(|value| value.truthy()) {
        let text = condition.js_string();
        let text = js::trim(&text);
        if !text.is_empty() {
            out.insert("if".to_owned(), string_value(text));
        }
    }
    if let Some(when) = rule.get("when").filter(|value| value.truthy() && value.as_str() != Some("on_success")) {
        out.insert("when".to_owned(), when.clone());
    }
    if !out.contains_key("if") && !out.contains_key("when") {
        out.insert("when".to_owned(), string_value("on_success"));
    }
    if rule.get("allow_failure").is_some_and(Value::truthy) {
        out.insert("allow_failure".to_owned(), Value::Bool(true));
    }
    Value::Map(out)
}

/// `applyEdit`.
pub fn apply_edit(content: &str, op: &CiEditOp, language: Language) -> Result<CiEditResult> {
    if *op == CiEditOp::Unknown {
        return Err(GorynychError::new(ErrorCode::BadArgs, i18n::tr(language, "Неизвестная правка", &[])));
    }
    let text = content.replace("\r\n", "\n");
    let doc = Document::parse(&text);
    if !doc.errors().is_empty() {
        let details: Vec<&str> = doc.errors().iter().map(|error| error.message.as_str()).collect();
        return Err(GorynychError::new(ErrorCode::YamlError, i18n::tr(language, "В файле есть ошибки YAML — сначала исправьте их во вкладке «Файл»", &[]))
            .with_details(details.join("\n")));
    }
    if let Some(root) = doc.root()
        && !matches!(doc.node(root).kind, NodeKind::Map(_))
        && !doc.is_empty_document(&text)
    {
        return Err(GorynychError::new(ErrorCode::YamlError, i18n::tr(language, "Файл должен быть словарём (key: value) на верхнем уровне", &[])));
    }
    let indent_seq = indent_seq_of(&text);
    let mut ops = Ops { editor: Editor::new(text, doc, indent_seq, language), language };
    let notes = ops.run(op)?;
    Ok(CiEditResult { content: ops.editor.finish()?, notes })
}
