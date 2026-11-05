//! Точечная правка YAML по позициям разбора. Заменяет связку Document API и `minimalPatch` из 1.x (решение — в журнале `CLAUDE.md`).
//!
//! Каждый шаг меняет только свой участок текста и разбирает файл заново. Параллельно вызывающий код меняет ожидаемое дерево
//! ([`Editor::tree`], алиасы не раскрыты). В конце [`Editor::finish`] сравнивает его с разбором результата: при расхождении правка отклоняется, а файл не переформатируется.
//!
//! Какие строки относятся к паре или элементу списка — как `commentBefore` в 1.x:
//! - выше ключа: пустые строки и комментарии не глубже него, но не у первого элемента (там комментарий принадлежит родителю или файлу);
//! - ниже значения: комментарии глубже ключа.

use std::ops::Range;

use gorynych_core::Language;
use gorynych_core::error::{ErrorCode, GorynychError, Result};
use gorynych_core::i18n;

use crate::yaml::{Document, JsMap, NodeId, NodeKind, Value};
use crate::yaml_write::{self, ScalarStyle};

/// Отказ: точечная правка невозможна или дала не тот результат.
fn refusal(language: Language, details: &str) -> GorynychError {
    GorynychError::new(ErrorCode::YamlError, i18n::tr(language, "Не удалось внести правку, не переписывая файл", &[]))
        .with_hint(i18n::tr(language, "Внесите это изменение вручную во вкладке «Файл»", &[]))
        .with_details(details)
}

/// Пара словаря.
#[derive(Debug, Clone, Copy)]
pub(super) struct Pair {
    pub key: NodeId,
    pub value: NodeId,
}

pub(super) struct Editor {
    pub text: String,
    pub doc: Document,
    /// Ожидаемое дерево: см. шапку.
    pub tree: Value,
    pub indent_seq: bool,
    pub language: Language,
}

/// Значения равны с учётом порядка ключей; `NaN` равен себе.
fn same_tree(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a == b || (a.is_nan() && b.is_nan()),
        (Value::Seq(a), Value::Seq(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_tree(a, b)),
        (Value::Map(a), Value::Map(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|((key_a, a), (key_b, b))| key_a == key_b && same_tree(a, b))
        }
        _ => a == b,
    }
}

impl Editor {
    pub fn new(text: String, doc: Document, indent_seq: bool, language: Language) -> Self {
        let tree = match doc.to_tree(&text) {
            // Пустой файл: как `doc.contents = doc.createNode({})`
            Value::Null => Value::Map(JsMap::new()),
            tree => tree,
        };
        Self { text, doc, tree, indent_seq, language }
    }

    pub fn refuse<T>(&self, details: &str) -> Result<T> {
        Err(refusal(self.language, details))
    }

    /// Заменяет участок и разбирает заново. Ошибка разбора — отказ.
    pub fn splice(&mut self, range: Range<usize>, with: &str) -> Result<()> {
        self.text.replace_range(range, with);
        self.doc = Document::parse(&self.text);
        match self.doc.errors().first() {
            Some(error) => Err(refusal(self.language, &error.message)),
            None => Ok(()),
        }
    }

    /// Итог: разбор результата равен ожидаемому дереву.
    pub fn finish(self) -> Result<String> {
        let actual = self.doc.to_tree(&self.text);
        // Удаление единственной пары оставляет пустой файл: для YAML это `null`
        let empty_root = actual.is_null() && self.tree.as_map().is_some_and(JsMap::is_empty);
        if !empty_root && !same_tree(&actual, &self.tree) {
            return Err(refusal(self.language, "результат правки не совпал с ожидаемым"));
        }
        Ok(self.text)
    }

    /* ---------------------------------- Чтение ---------------------------------- */

    pub fn root(&self) -> Option<NodeId> {
        self.doc.root().filter(|root| matches!(self.doc.node(*root).kind, NodeKind::Map(_)))
    }

    pub fn pairs_of(&self, map: NodeId) -> Vec<Pair> {
        match &self.doc.node(map).kind {
            NodeKind::Map(pairs) => pairs.iter().map(|(key, value)| Pair { key: *key, value: *value }).collect(),
            _ => Vec::new(),
        }
    }

    pub fn root_pairs(&self) -> Vec<Pair> {
        self.root().map_or_else(Vec::new, |root| self.pairs_of(root))
    }

    pub fn key_of(&self, pair: Pair) -> String {
        self.doc.key_of(pair.key, &self.text)
    }

    pub fn is_map(&self, id: NodeId) -> bool {
        matches!(self.doc.node(id).kind, NodeKind::Map(_))
    }

    pub fn items_of(&self, seq: NodeId) -> Vec<NodeId> {
        match &self.doc.node(seq).kind {
            NodeKind::Seq(items) => items.clone(),
            _ => Vec::new(),
        }
    }

    /// `map.get(key, true)`: первая пара, ключ — строка.
    pub fn field(&self, map: NodeId, key: &str) -> Option<Pair> {
        self.pairs_of(map).into_iter().find(|pair| self.doc.scalar(pair.key).is_some_and(|value| value.as_str() == Some(key)))
    }

    /// `String(map.get('stage') ?? 'test')`.
    pub fn stage_of(&self, job: NodeId) -> String {
        let Some(field) = self.field(job, "stage") else { return "test".to_owned() };
        match self.doc.scalar(field.value) {
            Some(Value::Null) => "test".to_owned(),
            _ => self.doc.node_string(field.value, &self.text),
        }
    }

    pub fn is_flow(&self, id: NodeId) -> bool {
        let node = self.doc.node(id);
        matches!(node.kind, NodeKind::Seq(_) | NodeKind::Map(_)) && matches!(self.text.as_bytes().get(node.span.start), Some(b'[' | b'{'))
    }

    /// Лежит ли узел внутри строчной коллекции.
    fn inside_flow(&self, target: NodeId) -> bool {
        fn walk(editor: &Editor, id: NodeId, target: NodeId, flow: bool) -> Option<bool> {
            if id == target {
                return Some(flow);
            }
            let inner = flow || editor.is_flow(id);
            match &editor.doc.node(id).kind {
                NodeKind::Seq(items) => items.iter().find_map(|item| walk(editor, *item, target, inner)),
                NodeKind::Map(pairs) => pairs.iter().find_map(|(key, value)| walk(editor, *key, target, inner).or_else(|| walk(editor, *value, target, inner))),
                _ => None,
            }
        }
        self.doc.root().and_then(|root| walk(self, root, target, false)).unwrap_or(false)
    }

    /* --------------------------------- Позиции ---------------------------------- */

    fn line_start(&self, at: usize) -> usize {
        self.text[..at].rfind('\n').map_or(0, |found| found + 1)
    }

    /// Начало следующей строки или конец текста.
    fn line_end(&self, at: usize) -> usize {
        self.text[at..].find('\n').map_or(self.text.len(), |found| at + found + 1)
    }

    fn column(&self, at: usize) -> usize {
        at - self.line_start(at)
    }

    fn is_empty_scalar(&self, id: NodeId) -> bool {
        matches!(&self.doc.node(id).kind, NodeKind::Scalar { value, plain: true } if value.is_empty())
    }

    /// Позиция двоеточия после ключа. Явный ключ `? a` не поддерживается.
    fn colon_after(&self, key: NodeId) -> Option<usize> {
        let end = self.doc.node(key).span.end;
        let rest = &self.text[end..];
        let skipped = rest.len() - rest.trim_start_matches([' ', '\t']).len();
        (rest.as_bytes().get(skipped) == Some(&b':')).then_some(end + skipped)
    }

    /// Конец содержимого узла: без пустых строк и комментариев, на которые заходит диапазон блочной коллекции.
    fn content_end(&self, id: NodeId) -> Option<usize> {
        let node = self.doc.node(id);
        let trimmed = |range: &Range<usize>| range.start + self.text[range.clone()].trim_end().len();
        match &node.kind {
            NodeKind::Scalar { .. } | NodeKind::Alias(_) => Some(trimmed(&node.span)),
            _ if self.is_flow(id) => Some(trimmed(&node.span)),
            NodeKind::Seq(items) => {
                let last = *items.last()?;
                if self.is_empty_scalar(last) { self.dash_of(last).map(|dash| dash + 1) } else { self.content_end(last) }
            }
            NodeKind::Map(pairs) => {
                let (key, value) = *pairs.last()?;
                if self.is_empty_scalar(value) { self.colon_after(key).map(|colon| colon + 1) } else { self.content_end(value) }
            }
        }
    }

    fn pair_end(&self, pair: Pair) -> Option<usize> {
        if self.is_empty_scalar(pair.value) { self.colon_after(pair.key).map(|colon| colon + 1) } else { self.content_end(pair.value) }
    }

    /// Дефис элемента блочного списка: только если он прямо перед элементом на той же строке.
    fn dash_of(&self, item: NodeId) -> Option<usize> {
        let start = self.doc.node(item).span.start;
        let before = self.text[self.line_start(start)..start].trim_end();
        before.ends_with('-').then(|| self.line_start(start) + before.len() - 1)
    }

    /// Строки элемента с его комментариями: см. шапку.
    fn region(&self, start: usize, end: usize, first: bool) -> Range<usize> {
        let column = self.column(start);
        let mut from = self.line_start(start);
        if !first {
            let mut cursor = from;
            while cursor > 0 {
                let previous = self.line_start(cursor - 1);
                let line = &self.text[previous..cursor];
                let body = line.trim_start_matches(' ');
                let blank = line.trim().is_empty();
                let shallow_comment = body.starts_with('#') && line.len() - body.len() <= column;
                if !blank && !shallow_comment {
                    break;
                }
                cursor = previous;
            }
            from = cursor;
        }
        let mut to = self.line_end(end);
        let mut cursor = to;
        while cursor < self.text.len() {
            let next = self.line_end(cursor);
            let line = &self.text[cursor..next];
            let body = line.trim_start_matches(' ');
            if body.starts_with('#') && line.len() - body.len() > column {
                to = next;
            } else if !line.trim().is_empty() {
                break;
            }
            cursor = next;
        }
        from..to
    }

    fn pair_region(&self, pair: Pair, first: bool) -> Option<Range<usize>> {
        Some(self.region(self.doc.node(pair.key).span.start, self.pair_end(pair)?, first))
    }

    fn item_region(&self, item: NodeId, first: bool) -> Option<Range<usize>> {
        let end = if self.is_empty_scalar(item) { self.dash_of(item)? + 1 } else { self.content_end(item)? };
        Some(self.region(self.dash_of(item)?, end, first))
    }

    /// Вставка целых строк после строки с позицией `after`. Без перевода строки в конце файла он добавляется перед вставкой.
    fn insert_lines_after(&mut self, after: usize, lines: &str) -> Result<()> {
        let at = if after == 0 { 0 } else { self.line_end(after) };
        self.insert_lines_at(at, lines)
    }

    fn insert_lines_at(&mut self, at: usize, lines: &str) -> Result<()> {
        let text = if at == self.text.len() && !self.text.is_empty() && !self.text.ends_with('\n') { format!("\n{lines}") } else { format!("{lines}\n") };
        self.splice(at..at, &text)
    }

    /* ------------------------------ Скаляры ----------------------------------- */

    /// Новое значение скаляра с сохранением кавычек: `scalar.value = n` в 1.x.
    pub fn set_scalar(&mut self, id: NodeId, value: &str, is_key: bool) -> Result<()> {
        let span = self.doc.node(id).span.clone();
        let Some(end) = self.content_end(id) else { return self.refuse("скаляр без позиции") };
        let indent = " ".repeat(self.column(span.start) + 2);
        let style = self.scalar_style(id);
        let in_flow = self.inside_flow(id);
        let rendered = yaml_write::render_string(value, &indent, is_key, in_flow, style);
        self.splice(span.start..end, &rendered)
    }

    fn scalar_style(&self, id: NodeId) -> ScalarStyle {
        let node = self.doc.node(id);
        if !matches!(node.kind, NodeKind::Scalar { .. }) {
            return ScalarStyle::Any;
        }
        match self.text.as_bytes().get(node.span.start) {
            Some(b'"') => ScalarStyle::DoubleQuoted,
            Some(b'\'') => ScalarStyle::SingleQuoted,
            Some(b'|' | b'>') => ScalarStyle::Block,
            _ => ScalarStyle::Any,
        }
    }

    /* ------------------------------- Словари ---------------------------------- */

    /// Новая пара перед элементом `at` словаря верхнего уровня.
    pub fn insert_root_pair(&mut self, at: usize, key: &str, value: &Value, blank_before: bool, flow: bool) -> Result<()> {
        if let Some(root) = self.root().filter(|root| self.is_flow(*root)) {
            return self.rewrite_flow_root(root, at, key, value);
        }
        let pairs = self.root_pairs();
        let column = pairs.first().map_or(0, |pair| self.column(self.doc.node(pair.key).span.start));
        let indent = " ".repeat(column);
        let rendered = yaml_write::render_pair(key, value, &indent, self.indent_seq, flow);
        let gap = if blank_before && !pairs.is_empty() { "\n" } else { "" };
        let lines = format!("{gap}{indent}{rendered}");
        if pairs.is_empty() {
            // Комментарий файла не должен выглядеть описанием нового ключа
            let has_comment = !self.text.trim().is_empty() && self.text.trim_start().starts_with('#');
            let separated = if has_comment && !self.text.ends_with("\n\n") { format!("\n{lines}") } else { lines };
            return self.insert_lines_at(self.text.len(), &separated);
        }
        if at == 0 {
            let start = self.line_start(self.doc.node(pairs[0].key).span.start);
            return self.insert_lines_at(start, &lines);
        }
        let Some(region) = self.pair_region(pairs[at - 1], at == 1) else { return self.refuse("конец пары не найден") };
        self.insert_lines_at(region.end, &lines)
    }

    fn rewrite_flow_root(&mut self, root: NodeId, at: usize, key: &str, value: &Value) -> Result<()> {
        let Some(map) = self.tree.as_map() else { return self.refuse("корень не словарь") };
        let mut out = JsMap::new();
        for (index, (name, item)) in map.iter().enumerate() {
            if index == at {
                out.insert(key.to_owned(), value.clone());
            }
            out.insert(name.clone(), item.clone());
        }
        if at >= map.len() {
            out.insert(key.to_owned(), value.clone());
        }
        self.replace_flow(root, &Value::Map(out))
    }

    /// Строчная коллекция целиком, с новым содержимым.
    pub fn replace_flow(&mut self, id: NodeId, value: &Value) -> Result<()> {
        let span = self.doc.node(id).span.clone();
        let Some(end) = self.content_end(id) else { return self.refuse("конец коллекции не найден") };
        let indent = " ".repeat(self.column(self.line_start(span.start)));
        let rendered = yaml_write::render_flow(value, &indent);
        self.splice(span.start..end, &rendered)
    }

    /// Удаление пары из блочного словаря, если она не единственная.
    pub fn remove_pair_lines(&mut self, map: NodeId, index: usize) -> Result<()> {
        let pairs = self.pairs_of(map);
        let Some(region) = self.pair_region(pairs[index], index == 0) else { return self.refuse("конец пары не найден") };
        self.splice(region, "")
    }

    /// Значение существующего ключа. `flow`: новое значение-коллекция строчной записью. Хвостовой комментарий однострочного значения сохраняется.
    pub fn replace_value(&mut self, pair: Pair, value: &Value, flow: bool) -> Result<()> {
        let Some(colon) = self.colon_after(pair.key) else { return self.refuse("явный ключ") };
        let key_column = self.column(self.doc.node(pair.key).span.start);
        let child = " ".repeat(key_column + 2);
        let block_collection = !flow
            && match value {
                Value::Seq(items) => !items.is_empty(),
                Value::Map(map) => !map.is_empty(),
                _ => false,
            };
        let old_empty = self.is_empty_scalar(pair.value);
        let old_start = self.doc.node(pair.value).span.start;
        let Some(old_end) = (if old_empty { Some(colon + 1) } else { self.content_end(pair.value) }) else {
            return self.refuse("конец значения не найден");
        };
        let same_line = !old_empty && !self.text[colon..old_start].contains('\n');
        if block_collection {
            let old_is_block_seq = matches!(self.doc.node(pair.value).kind, NodeKind::Seq(_)) && !self.is_flow(pair.value) && !same_line && !old_empty;
            let indent = match value {
                Value::Seq(_) if old_is_block_seq => self.column(self.dash_of_first(pair.value).unwrap_or(old_start)),
                Value::Seq(_) if !self.indent_seq => key_column,
                _ => key_column + 2,
            };
            let indent = " ".repeat(indent);
            let rendered = yaml_write::render(value, &indent, self.indent_seq);
            if old_empty {
                return self.splice(colon + 1..colon + 1, &format!("\n{indent}{rendered}"));
            }
            if same_line {
                // Якорь и тег остаются на строке ключа
                let keep = self.text[..old_start].trim_end_matches([' ', '\t']).len();
                return self.splice(keep..old_end, &format!("\n{indent}{rendered}"));
            }
            let start = if old_is_block_seq { self.dash_of_first(pair.value).unwrap_or(old_start) } else { old_start };
            let line = self.line_start(start);
            return self.splice(line..old_end, &format!("{indent}{rendered}"));
        }
        let rendered = match value {
            Value::String(text) => {
                let style = if same_line { self.scalar_style(pair.value) } else { ScalarStyle::Any };
                yaml_write::render_string(text, &child, false, self.inside_flow(pair.value), style)
            }
            other => yaml_write::render_flow(other, &child),
        };
        if same_line {
            return self.splice(old_start..old_end, &rendered);
        }
        self.splice(colon + 1..old_end, &format!(" {rendered}"))
    }

    fn dash_of_first(&self, seq: NodeId) -> Option<usize> {
        self.items_of(seq).first().and_then(|item| self.dash_of(*item))
    }

    /// Новая пара в конец блочного словаря.
    pub fn append_pair(&mut self, map: NodeId, key: &str, value: &Value, flow: bool) -> Result<()> {
        let pairs = self.pairs_of(map);
        let Some(last) = pairs.last().copied() else { return self.refuse("пустой блочный словарь") };
        let column = self.column(self.doc.node(pairs[0].key).span.start);
        let indent = " ".repeat(column);
        let rendered = yaml_write::render_pair(key, value, &indent, self.indent_seq, flow);
        let Some(end) = self.pair_end(last) else { return self.refuse("конец пары не найден") };
        self.insert_lines_after(end, &format!("{indent}{rendered}"))
    }

    /* -------------------------------- Списки ---------------------------------- */

    /// Новый элемент-строка. `at` — индекс среди элементов.
    pub fn insert_item(&mut self, seq: NodeId, at: usize, raw_value: &Value) -> Result<()> {
        let items = self.items_of(seq);
        if self.is_flow(seq) {
            let indent = " ".repeat(self.column(self.line_start(self.doc.node(seq).span.start)));
            let rendered = yaml_write::render_flow(raw_value, &indent);
            return self.insert_flow_text(seq, at, &rendered);
        }
        let Some(first_dash) = items.first().and_then(|item| self.dash_of(*item)) else { return self.refuse("первый элемент списка не найден") };
        let column = self.column(first_dash);
        let indent = " ".repeat(column);
        let rendered = yaml_write::render(raw_value, &format!("{indent}  "), self.indent_seq);
        let line = format!("{indent}- {rendered}");
        if at >= items.len() {
            let Some(end) = self.content_end(*items.last().unwrap_or(&seq)) else { return self.refuse("конец списка не найден") };
            return self.insert_lines_after(end, &line);
        }
        let Some(region) = self.item_region(items[at], at == 0) else { return self.refuse("элемент не найден") };
        self.insert_lines_at(region.start, &line)
    }

    fn insert_flow_text(&mut self, seq: NodeId, at: usize, rendered: &str) -> Result<()> {
        let items = self.items_of(seq);
        if items.is_empty() {
            let open = self.doc.node(seq).span.start + 1;
            return self.splice(open..open, rendered);
        }
        if at >= items.len() {
            let Some(end) = self.content_end(items[items.len() - 1]) else { return self.refuse("конец элемента не найден") };
            return self.splice(end..end, &format!(", {rendered}"));
        }
        let start = self.doc.node(items[at]).span.start;
        self.splice(start..start, &format!("{rendered}, "))
    }

    /// Удаление элемента списка. Единственный элемент блочного списка удаляет вызывающий код вместе с ключом или заменой на `[]`.
    pub fn remove_item(&mut self, seq: NodeId, index: usize) -> Result<()> {
        let items = self.items_of(seq);
        if self.is_flow(seq) {
            let start = self.doc.node(items[index]).span.start;
            let Some(end) = self.content_end(items[index]) else { return self.refuse("конец элемента не найден") };
            let range = if let Some(next) = items.get(index + 1) {
                start..self.doc.node(*next).span.start
            } else if index > 0 {
                let Some(previous_end) = self.content_end(items[index - 1]) else { return self.refuse("конец элемента не найден") };
                previous_end..end
            } else {
                start..end
            };
            return self.splice(range, "");
        }
        let Some(region) = self.item_region(items[index], index == 0) else { return self.refuse("элемент не найден") };
        self.splice(region, "")
    }

    /// Обмен соседних элементов списка, `first + 1 == second`.
    pub fn swap_items(&mut self, seq: NodeId, first: usize, second: usize) -> Result<()> {
        let items = self.items_of(seq);
        if self.is_flow(seq) {
            let span = |editor: &Self, id: NodeId| Some(editor.doc.node(id).span.start..editor.content_end(id)?);
            let (Some(a), Some(b)) = (span(self, items[first]), span(self, items[second])) else { return self.refuse("элемент не найден") };
            let swapped = format!("{}{}{}", &self.text[b.clone()], &self.text[a.end..b.start], &self.text[a.clone()]);
            return self.splice(a.start..b.end, &swapped);
        }
        let (Some(a), Some(b)) = (self.item_region(items[first], first == 0), self.item_region(items[second], false)) else {
            return self.refuse("элемент не найден");
        };
        if a.end > b.start {
            return self.refuse("элементы пересекаются");
        }
        let with_newline = |text: &str| if text.ends_with('\n') { text.to_owned() } else { format!("{text}\n") };
        let at_end = b.end == self.text.len() && !self.text.ends_with('\n');
        let mut swapped = format!("{}{}{}", with_newline(&self.text[b.clone()]), &self.text[a.end..b.start], &self.text[a.clone()]);
        if at_end {
            swapped.truncate(swapped.trim_end_matches('\n').len());
        }
        self.splice(a.start..b.end, &swapped)
    }
}
