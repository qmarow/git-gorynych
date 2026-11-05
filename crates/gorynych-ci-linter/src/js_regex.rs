//! Регулярные выражения с семантикой `RegExp` из JS.
//!
//! Шаблоны правил Pre-commit Guard написаны пользователем для JS, поэтому `regex` и `fancy-regex` не подходят: у них `\b`,
//! `\w` и `\d` учитывают Unicode, а в JS — только ASCII. Например, `НЕ\s*КОММИТИТЬ\b` в JS не срабатывает на «НЕ КОММИТИТЬ»
//! (после кириллицы нет границы слова), и другой движок молча изменил бы результат проверки у всех пользователей 1.x.
//!
//! Позиции — в единицах UTF-16, как `RegExp.exec().index`. Без флага `u` и шаблон, и текст разбираются по единицам UTF-16,
//! как в JS: `.` в такой регулярке захватывает половину эмодзи.
//!
//! Поведение сверяется с V8 в `tests/guard_parity.rs`. **Известные отличия:**
//! - Текст ошибки другой, чем у V8. Интерфейс 1.x поле `invalid` не показывает, а свой текст для формы правила получает
//!   из `validatePattern` на стороне интерфейса.
//! - С флагом `i` без `u` регистр сворачивается по таблице Unicode, а не через `toUpperCase`. Разница в 31 паре символов (перебор
//!   всей BMP): `ı` ~ `I`/`i`, `ſ` ~ `S`/`s` и 27 титульных греческих букв с подстрочной йотой. Кроме того, `\w` с этими флагами
//!   считает словом `ſ` и `K` (U+212A). Строки из ASCII и кириллицы это не затрагивает: `/password/i` лишь дополнительно найдёт «paſſword».

use std::ops::Range;

use regress::{Flags, Regex};

/// Шаблон без флага `u` для `regress`: единицы UTF-16 и две правки там, где разбор `\u` отличается от JS.
/// - `\u{41}` в JS без `u` — буква `u` с повтором 41 раз, `regress` читает кодовую точку.
/// - `😀` в JS без `u` — две единицы, `regress` склеивает их в один символ, которого нет в тексте по единицам.
///   Половина пары передаётся единицей напрямую, такие единицы `regress` не склеивает.
fn legacy_pattern_units(pattern: &str) -> Vec<u32> {
    const BACKSLASH: u16 = b'\\' as u16;
    const U: u16 = b'u' as u16;
    const BRACE: u16 = b'{' as u16;
    const OPEN_CLASS: u16 = b'[' as u16;
    const CLOSE_CLASS: u16 = b']' as u16;
    const GROUP_NAME: [u16; 3] = [b'(' as u16, b'?' as u16, b'<' as u16];
    const GREATER: u16 = b'>' as u16;
    const EQUALS: u16 = b'=' as u16;
    const BANG: u16 = b'!' as u16;

    let units: Vec<u16> = pattern.encode_utf16().collect();
    let mut result = Vec::with_capacity(units.len());
    let mut index = 0;
    let mut in_class = false;
    while index < units.len() {
        let unit = units[index];
        // Имя группы: здесь `\u{41}` и в JS означает кодовую точку, `regress` читает его так же
        if !in_class && units[index..].starts_with(&GROUP_NAME) && !matches!(units.get(index + 3), Some(&EQUALS | &BANG)) {
            let end = units[index..].iter().position(|item| *item == GREATER).map_or(units.len(), |at| index + at + 1);
            result.extend(units[index..end].iter().copied().map(u32::from));
            index = end;
            continue;
        }
        if unit != BACKSLASH || index + 1 == units.len() {
            if unit == OPEN_CLASS {
                in_class = true;
            } else if unit == CLOSE_CLASS {
                in_class = false;
            }
            result.push(u32::from(unit));
            index += 1;
            continue;
        }
        let next = units[index + 1];
        let surrogate = units.get(index + 2..index + 6).and_then(|hex| {
            let hex = String::from_utf16(hex).ok()?;
            let value = u32::from_str_radix(&hex, 16).ok().filter(|_| hex.bytes().all(|b| b.is_ascii_hexdigit()))?;
            (0xD800..=0xDFFF).contains(&value).then_some(value)
        });
        match (next, units.get(index + 2), surrogate) {
            (U, Some(&BRACE), _) => {
                result.push(u32::from(U));
                index += 2;
            }
            (U, _, Some(value)) => {
                result.push(value);
                index += 6;
            }
            _ => {
                result.extend([u32::from(unit), u32::from(next)]);
                index += 2;
            }
        }
    }
    result
}

fn groups_of(matched: &regress::Match) -> Vec<Option<Range<usize>>> {
    std::iter::once(Some(matched.range())).chain(matched.captures.iter().cloned()).collect()
}

/// Скомпилированное выражение, как `new RegExp(pattern, flags)`.
#[derive(Debug, Clone)]
pub struct JsRegex {
    regex: Regex,
    unicode: bool,
}

impl JsRegex {
    /// Поддерживаются флаги `i`, `m`, `s`, `u`. Как и в JS, повтор флага — ошибка.
    pub fn new(pattern: &str, flags: &str) -> Result<Self, String> {
        let mut parsed = Flags::default();
        for flag in flags.chars() {
            let field = match flag {
                'i' => &mut parsed.icase,
                'm' => &mut parsed.multiline,
                's' => &mut parsed.dot_all,
                'u' => &mut parsed.unicode,
                _ => return Err(format!("Invalid flags: {flags}")),
            };
            if *field {
                return Err(format!("Invalid flags: {flags}"));
            }
            *field = true;
        }
        let compiled = if parsed.unicode {
            Regex::from_unicode(pattern.chars().map(u32::from), parsed)
        } else {
            Regex::from_unicode(legacy_pattern_units(pattern).into_iter(), parsed)
        };
        compiled.map(|regex| Self { regex, unicode: parsed.unicode }).map_err(|error| error.to_string())
    }

    /// Первое совпадение, как `exec` без флага `g`. Диапазон — в единицах UTF-16.
    pub fn find(&self, text: &[u16]) -> Option<Range<usize>> {
        let found =
            if self.unicode { self.regex.find_from_utf16(text, 0).next() } else { self.regex.find_from_ucs2(text, 0).next() };
        found.map(|matched| matched.range())
    }

    /// Все совпадения, как `matchAll`. Диапазоны — в единицах UTF-16.
    pub fn find_all(&self, text: &[u16]) -> Vec<Range<usize>> {
        if self.unicode {
            self.regex.find_from_utf16(text, 0).map(|matched| matched.range()).collect()
        } else {
            self.regex.find_from_ucs2(text, 0).map(|matched| matched.range()).collect()
        }
    }

    /// Как `exec`: диапазоны всего совпадения и групп, `None` у группы без совпадения.
    pub fn captures(&self, text: &[u16]) -> Option<Vec<Option<Range<usize>>>> {
        let found =
            if self.unicode { self.regex.find_from_utf16(text, 0).next() } else { self.regex.find_from_ucs2(text, 0).next() };
        found.map(|matched| groups_of(&matched))
    }

    /// Как `matchAll`, с группами.
    pub fn captures_all(&self, text: &[u16]) -> Vec<Vec<Option<Range<usize>>>> {
        if self.unicode {
            self.regex.find_from_utf16(text, 0).map(|matched| groups_of(&matched)).collect()
        } else {
            self.regex.find_from_ucs2(text, 0).map(|matched| groups_of(&matched)).collect()
        }
    }

    /// Как `test`.
    pub fn is_match(&self, text: &str) -> bool {
        self.find(&text.encode_utf16().collect::<Vec<_>>()).is_some()
    }
}
