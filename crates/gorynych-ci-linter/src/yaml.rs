//! Чтение YAML для линтера: то, что 1.x получал от `electron/vendor/yaml.cjs` (eemeli/yaml) через `parseYaml` в `ci.cjs` и
//! `Positions` в `ciCheckBase.cjs`. Разбор — `saphyr-parser`, данные и позиции строятся здесь.
//!
//! ## Конспект
//! - Опции `parseYaml`: `merge: true`, `!reference`, `uniqueKeys: false`, `maxAliasCount: 1000`. Ошибка `toJS` идёт в `errors` со строкой
//!   `null`, данные тогда `{}`; не словарь в корне тоже даёт `{}`. Это [`Schema::Ci`]. `Positions` и `ciEdit` читают без `merge`, а
//!   `!reference` у них обычный список: это [`Schema::Plain`].
//! - Несколько документов: берётся первый, плюс ошибка `MULTIPLE_DOCS`.
//! - Скаляры (схема core, YAML 1.2): `null`: `^(?:~|[Nn]ull|NULL)?$`; `bool`: `^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$`; `int`:
//!   `^0o[0-7]+$`, `^[-+]?[0-9]+$`, `^0x[0-9a-fA-F]+$`; `float`: `^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$`,
//!   `^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$`, `^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$`. Остальное — строка.
//!   Тег `!!int`, `!!float`, `!!bool`, `!!null` применяет только шаблоны своего типа (`!!float 1` остаётся строкой) и действует и на
//!   строку в кавычках. Прочие теги на скаляре дают строку.
//! - Ключ объекта: `null` → пустая строка, число и булево — `String(value)`. Порядок ключей как у объекта JS: целые индексы по
//!   возрастанию, затем остальные в порядке появления; повтор ключа заменяет значение, но не позицию.
//! - `<<` без кавычек: источники из значения по порядку, существующие ключи не заменяются; ключи после `<<` заменяют как обычно. Источник
//!   не словарь: `Merge sources must be maps or map aliases`.
//! - Алиасы: `Alias.toJSON` считает обращения к якорю: при `count * aliasCount > 1000` ошибка
//!   `Excessive alias count indicates a resource exhaustion attack`; `aliasCount` — `getAliasCount` источника. Счётчик `count` начинается с 1.
//! - `Positions.line(file, path)`: от полного пути к родителям, первое найденное. Родитель — `getIn` (без перехода по алиасам, строгое
//!   сравнение ключа: строка `"1"` не находит числовой ключ `1`), последний сегмент сравнивается через `String`. У словаря
//!   берётся строка ключа, у списка — строка элемента.
//! - `Positions.duplicates`: обход без алиасов до глубины 4, ключ `<<` пропускается, у каждого повтора `{key, path, line, first}`.
//!
//! ## Отличия от 1.x
//! Все, кроме последнего пункта, касаются только файлов с ошибкой или конструкций, которых нет в CI-файлах. Границы проверяет `tests/yaml_parity.rs`.
//! - **Сломанный файл.** `saphyr` останавливается на первой ошибке: другой текст сообщения, ошибка одна, данные только до неё, строка
//!   ошибки иногда другая. 1.x читал дальше: например, показывал все 442 ключа файла правил GitLab с ошибкой на строке 303.
//! - Предупреждения библиотеки (`doc.warnings`) не воспроизводятся.
//! - Ключ-коллекция становится исходным текстом ключа, а не текстом от сериализатора `yaml`.
//! - `!!binary`, `!!set`, `!!omap`, `!!pairs`, `!!timestamp` читаются как обычные значения, а не преобразуются.
//! - Алиас внутри собственного якоря в 1.x давал циклический объект, здесь это ошибка: [`Value`] не бывает циклическим.
//! - Вложенность больше [`MAX_DEPTH`] — ошибка, чтобы не переполнить стек.
//! - Повтор `%YAML` — ошибка (как в спецификации), в 1.x нет. Строка пустого ключа `?` в строчной записи может быть на единицу больше.
//! - Строка ошибки «несколько документов» может отличаться, если перед вторым документом есть другая ошибка или комментарии.

use std::collections::HashMap;
use std::ops::Range;

use gorynych_core::js;
use indexmap::IndexMap;
use saphyr_parser::{Event, Parser, ScalarStyle, Span, Tag};
use serde::{Serialize, Serializer};

/// Предел вложенности документа.
pub const MAX_DEPTH: usize = 256;
const MAX_ALIAS_COUNT: u64 = 1000;
const CORE_TAG: &str = "tag:yaml.org,2002:";

/// Как трактовать `<<` и `!reference`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schema {
    /// `parseYaml`: `<<` сливает словари, `!reference [a, b]` становится `{__reference: [a, b]}`.
    Ci,
    /// `Positions` и `ciEdit`: `<<` обычный ключ, `!reference` обычный список.
    Plain,
}

/// Значение, как результат `doc.toJS()`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(untagged)]
pub enum Value {
    Null,
    Bool(bool),
    Number(#[serde(serialize_with = "js_number")] #[specta(type = f64)] f64),
    String(String),
    Seq(Vec<Value>),
    Map(JsMap),
}

impl Value {
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn as_str(&self) -> Option<&str> {
        if let Value::String(text) = self { Some(text) } else { None }
    }

    pub fn as_seq(&self) -> Option<&[Value]> {
        if let Value::Seq(items) = self { Some(items) } else { None }
    }

    pub fn as_map(&self) -> Option<&JsMap> {
        if let Value::Map(map) = self { Some(map) } else { None }
    }

    /// Свойство, как `value?.[key]` для обычного ключа: у строки, числа и списка таких свойств нет.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.as_map().and_then(|map| map.get(key))
    }

    /// Как `Boolean(value)`: пустой список и пустой словарь истинны.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::Number(value) => *value != 0.0 && !value.is_nan(),
            Value::String(value) => !value.is_empty(),
            Value::Seq(_) | Value::Map(_) => true,
        }
    }

    /// Как `String(value)`.
    pub fn js_string(&self) -> String {
        match self {
            Value::Null => "null".to_owned(),
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => js::number_to_string(*value),
            Value::String(value) => value.clone(),
            Value::Seq(items) => js_join(items.iter(), ","),
            Value::Map(_) => "[object Object]".to_owned(),
        }
    }

    /// Как `JSON.stringify(value)`.
    pub fn json_string(&self) -> String {
        match self {
            Value::Null => "null".to_owned(),
            Value::Bool(value) => value.to_string(),
            Value::Number(value) if !value.is_finite() => "null".to_owned(),
            Value::Number(value) => js::number_to_string(*value),
            Value::String(value) => js::json_quote(value),
            Value::Seq(items) => format!("[{}]", items.iter().map(Value::json_string).collect::<Vec<_>>().join(",")),
            Value::Map(map) => {
                let pairs: Vec<String> = map.iter().map(|(key, value)| format!("{}:{}", js::json_quote(key), value.json_string())).collect();
                format!("{{{}}}", pairs.join(","))
            }
        }
    }

    /// `Object.entries(value)`: индексы у списка, символы у строки, у прочего пусто.
    pub fn js_entries(&self) -> Vec<(String, Value)> {
        match self {
            Value::Map(map) => map.iter().map(|(key, value)| (key.clone(), value.clone())).collect(),
            Value::Seq(items) => items.iter().enumerate().map(|(index, item)| (index.to_string(), item.clone())).collect(),
            Value::String(text) => text.chars().enumerate().map(|(index, c)| (index.to_string(), Value::String(c.to_string()))).collect(),
            _ => Vec::new(),
        }
    }
}

/// Как `array.join(separator)`: `null` становится пустой строкой.
pub fn js_join<'a>(items: impl Iterator<Item = &'a Value>, separator: &str) -> String {
    let parts: Vec<String> = items.map(|item| if item.is_null() { String::new() } else { item.js_string() }).collect();
    parts.join(separator)
}

/// Как `JSON.stringify`: `NaN` и бесконечность становятся `null`, а `-0` — `0`.
fn js_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if !value.is_finite() {
        return serializer.serialize_unit();
    }
    serializer.serialize_f64(if *value == 0.0 { 0.0 } else { *value })
}

impl Serialize for JsMap {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.entries.iter())
    }
}

/// Словарь с порядком ключей объекта JS: целые индексы по возрастанию, затем остальные в порядке появления.
#[derive(Debug, Clone, Default, PartialEq, specta::Type)]
#[specta(type = std::collections::BTreeMap<String, Value>)]
pub struct JsMap {
    #[specta(skip)]
    entries: IndexMap<String, Value>,
    /// Сколько индексов лежит в начале `entries`.
    indexes: usize,
}

fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) || !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|value| *value != u32::MAX)
}

impl JsMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Как присваивание свойства: новый ключ встаёт на своё место, существующий сохраняет позицию.
    pub fn insert(&mut self, key: String, value: Value) {
        if let Some(existing) = self.entries.get_mut(&key) {
            *existing = value;
            return;
        }
        match array_index(&key) {
            Some(index) => {
                let index_at = |at: usize| self.entries.get_index(at).and_then(|(key, _)| array_index(key));
                let at = (0..self.indexes).find(|at| index_at(*at).is_some_and(|other| other > index)).unwrap_or(self.indexes);
                self.entries.shift_insert(at, key, value);
                self.indexes += 1;
            }
            None => {
                self.entries.insert(key, value);
            }
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.entries.get(key)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &Value)> {
        self.entries.iter()
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.entries.keys()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Индекс узла в [`Document`].
pub type NodeId = usize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeKind {
    Scalar { value: String, plain: bool },
    Seq(Vec<NodeId>),
    Map(Vec<(NodeId, NodeId)>),
    Alias(usize),
}

/// Узел документа с позицией в исходном тексте.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub kind: NodeKind,
    /// Байты в исходном тексте. Начало — после якоря и тега, у блочного скаляра — на `|` или `>`. Конец блочной коллекции может
    /// заходить на комментарии и пустые строки до следующего узла.
    pub span: Range<usize>,
    /// С единицы.
    pub line: u32,
    anchor: usize,
    tag: Option<(String, String)>,
}

/// Сообщение о проблеме в файле, как элемент `errors` у `parseYaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct YamlIssue {
    pub message: String,
    pub line: Option<u32>,
}

/// Сегмент пути для [`Document::line`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathItem {
    Key(String),
    Index(usize),
}

/// Повторяющийся ключ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DuplicateKey {
    pub key: String,
    pub path: Vec<String>,
    pub line: u32,
    pub first: u32,
}

/// Разобранный документ.
#[derive(Debug, Clone)]
pub struct Document {
    nodes: Vec<Node>,
    root: Option<NodeId>,
    anchors: HashMap<usize, NodeId>,
    errors: Vec<YamlIssue>,
}

/// Перевод позиций `saphyr` (символы) в байты и строки.
struct Offsets<'a> {
    text: &'a str,
    /// Смещение первого символа: длина BOM.
    prefix: usize,
    /// Байт каждого символа, если есть не-ASCII.
    chars: Option<Vec<u32>>,
    line_starts: Vec<usize>,
}

impl<'a> Offsets<'a> {
    fn new(text: &'a str, body: &str) -> Self {
        let mut line_starts = vec![0];
        line_starts.extend(text.bytes().enumerate().filter(|(_, byte)| *byte == b'\n').map(|(at, _)| at + 1));
        let chars = (!body.is_ascii()).then(|| {
            let mut table: Vec<u32> = body.char_indices().map(|(at, _)| at as u32).collect();
            table.push(body.len() as u32);
            table
        });
        Self { text, prefix: text.len() - body.len(), chars, line_starts }
    }

    fn byte(&self, char_index: usize) -> usize {
        let inner = match &self.chars {
            Some(table) => table.get(char_index).map_or(self.text.len() - self.prefix, |at| *at as usize),
            None => char_index,
        };
        (self.prefix + inner).min(self.text.len())
    }

    fn line(&self, byte: usize) -> u32 {
        self.line_starts.partition_point(|start| *start <= byte) as u32
    }

    /// Пропускает якорь и тег: `span` у узла с ними начинается раньше самого узла.
    fn skip_props(&self, mut at: usize) -> usize {
        let bytes = self.text.as_bytes();
        loop {
            match bytes.get(at) {
                Some(b'&' | b'!') => {
                    while at < bytes.len() && !matches!(bytes[at], b' ' | b'\t' | b'\r' | b'\n') {
                        at += 1;
                    }
                }
                Some(b' ' | b'\t' | b'\r' | b'\n') => at += 1,
                Some(b'#') => {
                    while at < bytes.len() && bytes[at] != b'\n' {
                        at += 1;
                    }
                }
                _ => return at,
            }
        }
    }

    /// Начало блочного скаляра: `saphyr` отмечает первую строку содержимого, а узел начинается с `|` или `>`.
    fn block_header(&self, content: usize) -> usize {
        let mut line = self.line(content.min(self.text.len())) as usize;
        while line > 1 {
            line -= 1;
            let start = self.line_starts[line - 1];
            let end = self.line_starts[line] - 1;
            let raw = &self.text[start..end];
            if raw.trim().is_empty() {
                continue;
            }
            let code = raw.find(" #").map_or(raw, |at| &raw[..at]).trim_end();
            let token_start = code.rfind([' ', '\t']).map_or(0, |at| at + 1);
            return if code[token_start..].starts_with(['|', '>']) { start + token_start } else { content };
        }
        content
    }
}

struct Open {
    id: NodeId,
    pending_key: Option<NodeId>,
}

fn tag_pair(tag: Option<std::borrow::Cow<'_, Tag>>) -> Option<(String, String)> {
    tag.map(|tag| (tag.handle.clone(), tag.suffix.clone()))
}

impl Document {
    /// Разбирает текст. Ошибки попадают в [`Document::errors`]: узлы до места ошибки остаются доступны.
    pub fn parse(text: &str) -> Self {
        let body = text.strip_prefix('\u{FEFF}').unwrap_or(text);
        let offsets = Offsets::new(text, body);
        let mut document = Self { nodes: Vec::new(), root: None, anchors: HashMap::new(), errors: Vec::new() };
        let mut stack: Vec<Open> = Vec::new();
        let mut documents = 0;

        for item in Parser::new_from_str(body) {
            let (event, span) = match item {
                Ok(event) => event,
                Err(error) => {
                    let marker = error.marker();
                    let line = marker.line() as u32;
                    document.push_error(format!("{} at line {line}, column {}", error.info(), marker.col() + 1), Some(line));
                    break;
                }
            };
            match event {
                Event::DocumentStart(_) => {
                    documents += 1;
                    if documents > 1 {
                        let line = offsets.line(offsets.byte(span.start.index()));
                        let column = span.start.col() + 1;
                        document.push_error(
                            format!("Source contains multiple documents; please use YAML.parseAllDocuments() at line {line}, column {column}"),
                            Some(line),
                        );
                        break;
                    }
                }
                Event::Alias(target) => {
                    document.add_node(NodeKind::Alias(target), span, 0, None, &offsets, &mut stack);
                }
                Event::Scalar(value, style, anchor, tag) => {
                    let plain = style == ScalarStyle::Plain;
                    let scalar_end = offsets.byte(span.end.index());
                    let mut range = document.range(span, &offsets, anchor != 0 || tag.is_some());
                    // Пустой скаляр с тегом: пропуск тега не должен уйти на следующие строки
                    if range.start > scalar_end {
                        range = scalar_end..scalar_end;
                    }
                    if matches!(style, ScalarStyle::Literal | ScalarStyle::Folded) {
                        range.start = offsets.block_header(range.start).min(range.end);
                    }
                    document.add_range(NodeKind::Scalar { value: value.into_owned(), plain }, range, anchor, tag_pair(tag), &offsets, &mut stack);
                }
                Event::SequenceStart(anchor, tag) | Event::MappingStart(anchor, tag) if stack.len() >= MAX_DEPTH => {
                    let _ = (anchor, tag);
                    let line = span.start.line() as u32;
                    document.push_error(format!("Document is nested too deeply at line {line}, column {}", span.start.col() + 1), Some(line));
                    break;
                }
                Event::SequenceStart(anchor, tag) => {
                    let id = document.add_node(NodeKind::Seq(Vec::new()), span, anchor, tag_pair(tag), &offsets, &mut stack);
                    stack.push(Open { id, pending_key: None });
                }
                Event::MappingStart(anchor, tag) => {
                    let id = document.add_node(NodeKind::Map(Vec::new()), span, anchor, tag_pair(tag), &offsets, &mut stack);
                    stack.push(Open { id, pending_key: None });
                }
                Event::SequenceEnd | Event::MappingEnd => {
                    if let Some(open) = stack.pop() {
                        document.nodes[open.id].span.end = offsets.byte(span.end.index()).max(document.nodes[open.id].span.start);
                    }
                }
                _ => {}
            }
        }
        // После ошибки: у ключа без значения значение `null`, незакрытые коллекции идут до конца текста
        while let Some(open) = stack.pop() {
            if let Some(key) = open.pending_key {
                let at = document.nodes[key].span.end;
                let line = document.nodes[key].line;
                let empty = Node {
                    kind: NodeKind::Scalar { value: String::new(), plain: true },
                    span: at..at,
                    line,
                    anchor: 0,
                    tag: None,
                };
                document.nodes.push(empty);
                let value = document.nodes.len() - 1;
                if let NodeKind::Map(pairs) = &mut document.nodes[open.id].kind {
                    pairs.push((key, value));
                }
            }
            document.nodes[open.id].span.end = text.len();
        }
        document
    }

    fn push_error(&mut self, message: String, line: Option<u32>) {
        self.errors.push(YamlIssue { message, line });
    }

    fn range(&self, span: Span, offsets: &Offsets<'_>, has_props: bool) -> Range<usize> {
        let mut start = offsets.byte(span.start.index());
        let end = offsets.byte(span.end.index());
        if has_props {
            start = offsets.skip_props(start);
        }
        start..end.max(start)
    }

    fn add_node(
        &mut self,
        kind: NodeKind,
        span: Span,
        anchor: usize,
        tag: Option<(String, String)>,
        offsets: &Offsets<'_>,
        stack: &mut [Open],
    ) -> NodeId {
        let range = self.range(span, offsets, anchor != 0 || tag.is_some());
        self.add_range(kind, range, anchor, tag, offsets, stack)
    }

    fn add_range(
        &mut self,
        kind: NodeKind,
        span: Range<usize>,
        anchor: usize,
        tag: Option<(String, String)>,
        offsets: &Offsets<'_>,
        stack: &mut [Open],
    ) -> NodeId {
        let line = offsets.line(span.start);
        let id = self.nodes.len();
        self.nodes.push(Node { kind, span, line, anchor, tag });
        if anchor != 0 {
            self.anchors.insert(anchor, id);
        }
        match stack.last_mut() {
            None => {
                self.root = Some(id);
            }
            Some(open) => {
                let parent = open.id;
                let is_map = matches!(self.nodes[parent].kind, NodeKind::Map(_));
                if is_map && open.pending_key.is_none() {
                    open.pending_key = Some(id);
                } else {
                    let key = open.pending_key.take();
                    match (&mut self.nodes[parent].kind, key) {
                        (NodeKind::Map(pairs), Some(key)) => pairs.push((key, id)),
                        (NodeKind::Seq(items), _) => items.push(id),
                        _ => {}
                    }
                }
            }
        }
        id
    }

    pub fn errors(&self) -> &[YamlIssue] {
        &self.errors
    }

    pub fn root(&self) -> Option<NodeId> {
        self.root
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id]
    }

    /// Как `doc.toJS({ maxAliasCount: 1000 })`. Пустой документ — `Null`.
    pub fn to_value(&self, schema: Schema, text: &str) -> Result<Value, String> {
        let Some(root) = self.root else { return Ok(Value::Null) };
        ToJs { document: self, schema, text, anchors: HashMap::new() }.value(root)
    }

    /// Текст ключа, как `String(pair.key?.value ?? pair.key?.source)`.
    fn key_text(&self, key: NodeId, text: &str) -> Option<String> {
        let node = self.node(key);
        match &node.kind {
            NodeKind::Scalar { .. } => Some(match scalar_value(node) {
                // `saphyr` даёт пустому ключу чужой участок текста: исходный текст есть только у записи вроде `~`
                Value::Null => Some(&text[node.span.clone()]).filter(|source| is_null(source)).unwrap_or_default().to_owned(),
                value => js_key(&value),
            }),
            NodeKind::Alias(_) => Some(text[node.span.clone()].trim_start_matches('*').to_owned()),
            _ => None,
        }
    }

    /// Строки ключей словаря, как `lines` и `nestedLines` у `parseYaml`. Повтор ключа — строка последнего.
    pub fn key_lines(&self, map: Option<NodeId>, text: &str) -> HashMap<String, u32> {
        let mut lines = HashMap::new();
        if let Some(NodeKind::Map(pairs)) = map.map(|id| &self.node(id).kind) {
            for (key, _) in pairs {
                if let Some(name) = self.key_text(*key, text) {
                    lines.insert(name, self.node(*key).line);
                }
            }
        }
        lines
    }

    /// `doc.getIn(path, true)`: без перехода по алиасам, ключ сравнивается строго по типу.
    pub fn get_in(&self, path: &[PathItem]) -> Option<NodeId> {
        let mut current = self.root?;
        for item in path {
            current = match (&self.node(current).kind, item) {
                (NodeKind::Map(pairs), item) => pairs.iter().find(|(key, _)| self.key_equals(*key, item))?.1,
                (NodeKind::Seq(items), PathItem::Index(index)) => *items.get(*index)?,
                (NodeKind::Seq(items), PathItem::Key(key)) => *items.get(sequence_index(key)?)?,
                _ => return None,
            };
        }
        Some(current)
    }

    fn key_equals(&self, key: NodeId, item: &PathItem) -> bool {
        let node = self.node(key);
        if !matches!(node.kind, NodeKind::Scalar { .. }) {
            return false;
        }
        match (scalar_value(node), item) {
            (Value::String(value), PathItem::Key(wanted)) => value == *wanted,
            (Value::Number(value), PathItem::Index(wanted)) => value == *wanted as f64,
            _ => false,
        }
    }

    /// `Positions.line`: строка ключа или элемента по пути, если его нет — ближайшего существующего родителя.
    pub fn line(&self, path: &[PathItem], text: &str) -> Option<u32> {
        for length in (1..=path.len()).rev() {
            let (parent_path, last) = path[..length].split_at(length - 1);
            let Some(parent) = self.get_in(parent_path) else { continue };
            match &self.node(parent).kind {
                NodeKind::Map(pairs) => {
                    let wanted = match &last[0] {
                        PathItem::Key(key) => key.clone(),
                        PathItem::Index(index) => index.to_string(),
                    };
                    if let Some((key, _)) = pairs.iter().find(|(key, _)| self.key_text(*key, text).as_deref() == Some(wanted.as_str())) {
                        return Some(self.node(*key).line);
                    }
                }
                NodeKind::Seq(items) => {
                    let index = match &last[0] {
                        PathItem::Index(index) => Some(*index),
                        PathItem::Key(key) => sequence_index(key),
                    };
                    if let Some(item) = index.and_then(|index| items.get(index)) {
                        return Some(self.node(*item).line);
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// `Positions.duplicates`: повторяющиеся ключи до глубины 4.
    pub fn duplicates(&self, text: &str) -> Vec<DuplicateKey> {
        let mut found = Vec::new();
        if let Some(root) = self.root {
            self.walk_duplicates(root, &mut Vec::new(), 0, text, &mut found);
        }
        found
    }

    fn walk_duplicates(&self, id: NodeId, path: &mut Vec<String>, depth: usize, text: &str, found: &mut Vec<DuplicateKey>) {
        if depth > 4 {
            return;
        }
        let NodeKind::Map(pairs) = &self.node(id).kind else { return };
        let mut seen: HashMap<String, u32> = HashMap::new();
        for (key, value) in pairs {
            // Ключ-коллекция в 1.x даёт строку «undefined»: все такие ключи считаются одинаковыми
            let name = self.key_text(*key, text).unwrap_or_else(|| "undefined".to_owned());
            if name == "<<" {
                continue;
            }
            let line = self.node(*key).line;
            match seen.get(&name) {
                Some(first) => found.push(DuplicateKey { key: name.clone(), path: path.clone(), line, first: *first }),
                None => {
                    seen.insert(name.clone(), line);
                }
            }
            path.push(name);
            self.walk_duplicates(*value, path, depth + 1, text, found);
            path.pop();
        }
    }
}

fn sequence_index(key: &str) -> Option<usize> {
    let number: f64 = js_number_of(key)?;
    (number >= 0.0 && number.fract() == 0.0).then_some(number as usize)
}

/// `Number(text)` для пути: только простая запись.
fn js_number_of(text: &str) -> Option<f64> {
    if text.is_empty() {
        return Some(0.0);
    }
    text.parse().ok()
}

fn digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_null(text: &str) -> bool {
    matches!(text, "" | "~" | "null" | "Null" | "NULL")
}

fn bool_of(text: &str) -> Option<bool> {
    match text {
        "true" | "True" | "TRUE" => Some(true),
        "false" | "False" | "FALSE" => Some(false),
        _ => None,
    }
}

fn int_of(text: &str) -> Option<f64> {
    let radix = |digits_text: &str, radix: u32| {
        digits_text.chars().try_fold(0f64, |total, c| Some(total * f64::from(radix) + f64::from(c.to_digit(radix)?)))
    };
    if let Some(octal) = text.strip_prefix("0o") {
        return if octal.is_empty() { None } else { radix(octal, 8) };
    }
    if let Some(hex) = text.strip_prefix("0x") {
        return if hex.is_empty() { None } else { radix(hex, 16) };
    }
    digits(text.strip_prefix(['+', '-']).unwrap_or(text)).then(|| text.parse().ok()).flatten()
}

fn float_of(text: &str) -> Option<f64> {
    match text {
        ".inf" | ".Inf" | ".INF" | "+.inf" | "+.Inf" | "+.INF" => return Some(f64::INFINITY),
        "-.inf" | "-.Inf" | "-.INF" => return Some(f64::NEG_INFINITY),
        ".nan" | ".NaN" | ".NAN" => return Some(f64::NAN),
        _ => {}
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (unsigned, None),
    };
    if !exponent.is_none_or(|exponent| digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent))) {
        return None;
    }
    let mantissa_ok = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole.is_empty() && digits(fraction)) || (digits(whole) && (fraction.is_empty() || digits(fraction))),
        None => exponent.is_some() && digits(mantissa),
    };
    if mantissa_ok { text.parse().ok() } else { None }
}

pub(crate) fn resolve_plain(text: &str) -> Value {
    if is_null(text) {
        return Value::Null;
    }
    if let Some(value) = bool_of(text) {
        return Value::Bool(value);
    }
    if let Some(value) = int_of(text).or_else(|| float_of(text)) {
        return Value::Number(value);
    }
    Value::String(text.to_owned())
}

/// Значение скаляра. Тег core применяет только шаблоны своего типа, остальные теги дают строку.
fn scalar_value(node: &Node) -> Value {
    let NodeKind::Scalar { value, plain } = &node.kind else { return Value::Null };
    let core = node.tag.as_ref().filter(|(handle, _)| handle == CORE_TAG).map(|(_, suffix)| suffix.as_str());
    let as_string = || Value::String(value.clone());
    match (node.tag.is_some(), core) {
        (false, _) if *plain => resolve_plain(value),
        (true, Some("null")) if is_null(value) => Value::Null,
        (true, Some("bool")) => bool_of(value).map_or_else(as_string, Value::Bool),
        (true, Some("int")) => int_of(value).map_or_else(as_string, Value::Number),
        (true, Some("float")) => float_of(value).map_or_else(as_string, Value::Number),
        _ => as_string(),
    }
}

/// Ключ объекта, как `stringifyKey` для скаляра.
fn js_key(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => js::number_to_string(*value),
        Value::String(value) => value.clone(),
        Value::Seq(_) | Value::Map(_) => String::new(),
    }
}

#[derive(Default)]
struct AnchorState {
    count: u64,
    alias_count: u64,
    result: Option<Value>,
}

struct ToJs<'a> {
    document: &'a Document,
    schema: Schema,
    text: &'a str,
    anchors: HashMap<NodeId, AnchorState>,
}

impl ToJs<'_> {
    fn value(&mut self, id: NodeId) -> Result<Value, String> {
        let node = self.document.node(id);
        if node.anchor == 0 {
            return self.inner(id);
        }
        self.anchors.insert(id, AnchorState { count: 1, alias_count: 0, result: None });
        let result = self.inner(id)?;
        if let Some(state) = self.anchors.get_mut(&id) {
            state.result = Some(result.clone());
        }
        Ok(result)
    }

    fn inner(&mut self, id: NodeId) -> Result<Value, String> {
        let document = self.document;
        let node = document.node(id);
        match &node.kind {
            NodeKind::Scalar { .. } => Ok(scalar_value(node)),
            NodeKind::Alias(anchor) => self.alias(*anchor),
            NodeKind::Seq(items) => {
                let values = items.iter().map(|item| self.value(*item)).collect::<Result<Vec<_>, _>>()?;
                let reference = self.schema == Schema::Ci && node.tag.as_ref().is_some_and(|(handle, suffix)| handle == "!" && suffix == "reference");
                if reference {
                    let mut map = JsMap::new();
                    map.insert("__reference".to_owned(), Value::Seq(values));
                    return Ok(Value::Map(map));
                }
                Ok(Value::Seq(values))
            }
            NodeKind::Map(pairs) => Ok(Value::Map(self.map(pairs)?)),
        }
    }

    fn alias(&mut self, anchor: usize) -> Result<Value, String> {
        let target = *self.document.anchors.get(&anchor).ok_or("Unresolved alias")?;
        if !self.anchors.contains_key(&target) {
            self.value(target)?;
        }
        if self.anchors[&target].alias_count == 0 {
            let count = self.alias_count(target);
            if let Some(state) = self.anchors.get_mut(&target) {
                state.alias_count = count;
            }
        }
        let state = self.anchors.get_mut(&target).ok_or("Unresolved alias")?;
        state.count += 1;
        if state.count.saturating_mul(state.alias_count) > MAX_ALIAS_COUNT {
            return Err("Excessive alias count indicates a resource exhaustion attack".to_owned());
        }
        state.result.clone().ok_or_else(|| "Alias refers to its own anchor".to_owned())
    }

    /// `getAliasCount`.
    fn alias_count(&self, id: NodeId) -> u64 {
        match &self.document.node(id).kind {
            NodeKind::Alias(anchor) => self
                .document
                .anchors
                .get(anchor)
                .and_then(|target| self.anchors.get(target))
                .map_or(0, |state| state.count.saturating_mul(state.alias_count)),
            NodeKind::Seq(items) => items.iter().map(|item| self.alias_count(*item)).max().unwrap_or(0),
            NodeKind::Map(pairs) => {
                pairs.iter().map(|(key, value)| self.alias_count(*key).max(self.alias_count(*value))).max().unwrap_or(0)
            }
            NodeKind::Scalar { .. } => 1,
        }
    }

    fn is_merge_key(&self, key: NodeId) -> bool {
        let node = self.document.node(key);
        self.schema == Schema::Ci && node.tag.is_none() && matches!(&node.kind, NodeKind::Scalar { value, plain: true } if value == "<<")
    }

    fn map(&mut self, pairs: &[(NodeId, NodeId)]) -> Result<JsMap, String> {
        let mut map = JsMap::new();
        for (key, value) in pairs {
            if self.is_merge_key(*key) {
                self.merge(*value, &mut map)?;
                continue;
            }
            let name = self.key(*key)?;
            let value = self.value(*value)?;
            map.insert(name, value);
        }
        Ok(map)
    }

    /// `addMergeToJSMap`: источники из значения, существующие ключи не заменяются.
    fn merge(&mut self, source: NodeId, map: &mut JsMap) -> Result<(), String> {
        let resolved = self.resolve_alias(source);
        if let NodeKind::Seq(items) = &self.document.node(resolved).kind {
            for item in items {
                self.merge_one(*item, map)?;
            }
            return Ok(());
        }
        self.merge_one(resolved, map)
    }

    fn merge_one(&mut self, source: NodeId, map: &mut JsMap) -> Result<(), String> {
        let resolved = self.resolve_alias(source);
        let NodeKind::Map(pairs) = &self.document.node(resolved).kind else {
            return Err("Merge sources must be maps or map aliases".to_owned());
        };
        let mut entries = JsMap::new();
        for (key, value) in pairs {
            if self.is_merge_key(*key) {
                self.merge(*value, &mut entries)?;
                continue;
            }
            // В 1.x источник сначала становится Map с настоящими значениями ключей, поэтому `null` тут — свойство «null»
            let name = match scalar_key_null(self.document.node(*key)) {
                true => "null".to_owned(),
                false => self.key(*key)?,
            };
            let value = self.value(*value)?;
            entries.insert(name, value);
        }
        for (name, value) in entries.iter() {
            if !map.contains_key(name) {
                map.insert(name.clone(), value.clone());
            }
        }
        Ok(())
    }

    fn resolve_alias(&self, id: NodeId) -> NodeId {
        match &self.document.node(id).kind {
            NodeKind::Alias(anchor) => self.document.anchors.get(anchor).copied().unwrap_or(id),
            _ => id,
        }
    }

    fn key(&mut self, key: NodeId) -> Result<String, String> {
        let value = self.value(key)?;
        Ok(match value {
            Value::Seq(_) | Value::Map(_) => self.text[self.document.node(key).span.clone()].trim().to_owned(),
            scalar => js_key(&scalar),
        })
    }
}

fn scalar_key_null(node: &Node) -> bool {
    matches!(node.kind, NodeKind::Scalar { .. }) && scalar_value(node).is_null()
}

/// Результат `parseYaml`.
#[derive(Debug, Clone)]
pub struct ParsedYaml {
    /// Всегда словарь: всё остальное в корне и ошибка данных дают пустой.
    pub data: Value,
    pub errors: Vec<YamlIssue>,
    pub document: Document,
}

impl ParsedYaml {
    /// `lines`: строки ключей верхнего уровня.
    pub fn lines(&self, text: &str) -> HashMap<String, u32> {
        self.document.key_lines(self.document.root(), text)
    }

    /// `nestedLines(path)`: строки ключей вложенного словаря.
    pub fn nested_lines(&self, path: &[PathItem], text: &str) -> HashMap<String, u32> {
        self.document.key_lines(self.document.get_in(path), text)
    }
}

/// `parseYaml` из `ci.cjs`.
pub fn parse_yaml(text: &str) -> ParsedYaml {
    let document = Document::parse(text);
    let mut errors = document.errors().to_vec();
    let data = match document.to_value(Schema::Ci, text) {
        Ok(value @ Value::Map(_)) => value,
        Ok(_) => Value::Map(JsMap::new()),
        Err(message) => {
            errors.push(YamlIssue { message, line: None });
            Value::Map(JsMap::new())
        }
    };
    ParsedYaml { data, errors, document }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_orders_keys_like_a_js_object() {
        let mut map = JsMap::new();
        for key in ["b", "10", "a", "2", "02", "4294967295", "4294967294", "0"] {
            map.insert(key.to_owned(), Value::Null);
        }
        map.insert("b".to_owned(), Value::Bool(true));
        let keys: Vec<&str> = map.keys().map(String::as_str).collect();
        assert_eq!(keys, ["0", "2", "10", "4294967294", "b", "a", "02", "4294967295"]);
        assert_eq!(map.get("b"), Some(&Value::Bool(true)));
    }

    #[test]
    fn offsets_are_bytes_with_cyrillic_and_bom() {
        let text = "\u{FEFF}# комментарий 😀\nзадание: &a значение\nключ: |\n  блок\n";
        let document = Document::parse(text);
        assert!(document.errors().is_empty(), "{:?}", document.errors());
        let NodeKind::Map(pairs) = &document.node(document.root().unwrap()).kind else { panic!() };
        let span = |id: NodeId| &text[document.node(id).span.clone()];
        assert_eq!(span(pairs[0].0), "задание");
        assert_eq!(document.node(pairs[0].0).line, 2);
        assert_eq!(span(pairs[0].1), "значение");
        assert_eq!(span(pairs[1].0), "ключ");
        assert!(span(pairs[1].1).starts_with('|'), "{:?}", span(pairs[1].1));
        assert_eq!(document.node(pairs[1].1).line, 3);
    }

    #[test]
    fn too_deep_nesting_is_an_error_not_a_crash() {
        let parsed = parse_yaml(&"[".repeat(200_000));
        assert!(!parsed.errors.is_empty());
        let parsed = parse_yaml(&"- ".repeat(50_000));
        assert!(!parsed.errors.is_empty());
    }

    #[test]
    fn alias_inside_own_anchor_is_an_error() {
        let parsed = parse_yaml("a: &x\n  b: *x\n");
        assert!(!parsed.errors.is_empty(), "{:?}", parsed.data);
    }
}
