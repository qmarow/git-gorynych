//! Новое в 2.0: Markdown задач → безопасный HTML (`issues::markdown::render`).

use gorynych_cicd::issues::markdown::render;

const BASE: Option<&str> = Some("https://gitlab.example.com/group/project");

#[test]
fn table_keeps_structure_and_alignment() {
    let html = render("| a | b |\n|:--|--:|\n| 1 | 2 |\n", None);
    assert!(html.contains("<table>"), "{html}");
    assert!(html.contains("<thead>") && html.contains("<tbody>"), "{html}");
    assert!(html.contains(r#"<th align="left">a</th>"#), "{html}");
    assert!(html.contains(r#"<td align="right">2</td>"#), "{html}");
    assert!(!html.contains("style"), "{html}");
}

#[test]
fn task_list_items_are_numbered_from_zero() {
    let html = render("- [ ] один\n- [x] два\n\n1. [ ] три\n", None);
    assert_eq!(html.matches("<input").count(), 3, "{html}");
    for index in 0..3 {
        assert!(html.contains(&format!(r#"data-task-index="{index}""#)), "{html}");
    }
    let second = html.split("<input").nth(2).unwrap();
    assert!(second.split('>').next().unwrap().contains("checked"), "{html}");
    let first = html.split("<input").nth(1).unwrap();
    assert!(!first.split('>').next().unwrap().contains("checked"), "{html}");
    assert!(html.matches(r#"type="checkbox""#).count() == 3 && html.matches("disabled").count() == 3, "{html}");
}

#[test]
fn code_block_keeps_language_class() {
    let html = render("```rust\nfn main() {}\n```\n", None);
    assert!(html.contains(r#"<pre><code class="language-rust">fn main() {}"#), "{html}");
    let odd = render("<code class=\"evil language-js x\">a</code>", None);
    assert!(odd.contains(r#"<code class="language-js">"#), "{odd}");
    let none = render("<code class=\"evil\">a</code>", None);
    assert!(none.contains("<code>a</code>"), "{none}");
}

#[test]
fn dangerous_markup_is_removed() {
    let cases = [
        "<script>alert(1)</script>текст",
        "<img src=\"https://x.test/a.png\" onerror=\"alert(1)\">",
        "[ссылка](javascript:alert(1))",
        "<a href=\"javascript:alert(1)\">x</a>",
        "<iframe src=\"https://evil.test\"></iframe>",
        "<p style=\"background:url(x)\" onclick=\"x()\">a</p>",
        "<svg><script>alert(1)</script></svg>",
        "<form action=\"https://evil.test\"><input type=\"text\" name=\"p\"></form>",
        "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>",
        "<img src=\"http://x.test/a.png\">",
        "<img src=\"data:image/png;base64,AAAA\">",
    ];
    for case in cases {
        let html = render(case, BASE);
        let lower = html.to_lowercase();
        for bad in ["<script", "onerror", "onclick", "javascript:", "<iframe", "style=", "<svg", "<form", "data:", "http://x.test", "name="] {
            assert!(!lower.contains(bad), "{case} → {html} (есть {bad})");
        }
    }
    assert!(render("<script>alert(1)</script>текст", None).contains("текст"));
    // Чужой `input` — только неактивный флажок.
    let input = render("<input type=\"text\" value=\"x\">", None);
    assert!(input.contains(r#"type="checkbox""#) && input.contains("disabled") && !input.contains("value"), "{input}");
}

#[test]
fn links_get_rel_and_schemes_are_limited() {
    let html = render("[a](https://example.com) [m](mailto:a@b.ru) <https://auto.test/x>", None);
    assert_eq!(html.matches(r#"rel="noopener noreferrer""#).count(), 3, "{html}");
    assert!(html.contains(r#"href="mailto:a@b.ru""#), "{html}");
}

#[test]
fn bare_urls_become_links() {
    let html = render("см. https://example.com/a?b=1. и всё", None);
    assert!(html.contains(r#"<a href="https://example.com/a?b=1" rel="noopener noreferrer">https://example.com/a?b=1</a>."#), "{html}");
    let code = render("`https://example.com`", None);
    assert!(!code.contains("href"), "{code}");
}

#[test]
fn issue_references_outside_code_and_links() {
    let html = render("Смотри #12 и (#7), но не path#3 и не &#35;4", None);
    assert!(html.contains(r#"<a data-issue="12" rel="noopener noreferrer">#12</a>"#), "{html}");
    assert!(html.contains(r#"data-issue="7""#), "{html}");
    assert!(!html.contains(r#"data-issue="3""#) && !html.contains(r#"data-issue="4""#), "{html}");

    let block = render("```\n#12 в коде\n```\n", None);
    assert!(!block.contains("data-issue"), "{block}");
    let inline = render("`#12`", None);
    assert!(!inline.contains("data-issue"), "{inline}");
    let link = render("[задача #12](https://example.com)", None);
    assert!(!link.contains("data-issue"), "{link}");
    let word = render("#12abc", None);
    assert!(!word.contains("data-issue"), "{word}");
}

#[test]
fn user_mentions() {
    let html = render("спасибо @john.doe, а a@b.ru — почта", None);
    assert!(html.contains(r#"<span data-user="john.doe">@john.doe</span>,"#), "{html}");
    assert!(!html.contains(r#"data-user="b.ru""#), "{html}");
    let code = render("    @john\n", None);
    assert!(!code.contains("data-user"), "{code}");
}

#[test]
fn relative_images_and_links_get_full_address() {
    let html = render("![a](/uploads/abc/pic.png) ![b](docs/b.png) [c](/other/page) [d](README.md) [e](#anchor)", BASE);
    assert!(html.contains(r#"src="https://gitlab.example.com/group/project/uploads/abc/pic.png""#), "{html}");
    assert!(html.contains(r#"src="https://gitlab.example.com/group/project/docs/b.png""#), "{html}");
    assert!(html.contains(r#"href="https://gitlab.example.com/other/page""#), "{html}");
    assert!(html.contains(r#"href="https://gitlab.example.com/group/project/README.md""#), "{html}");
    assert!(html.contains(r##"href="#anchor""##), "{html}");

    let without = render("![a](/uploads/pic.png) [c](page)", None);
    assert!(!without.contains("src=") && !without.contains("href="), "{without}");

    // Протокол-относительный адрес не дополняется.
    let scheme = render("![a](//evil.test/x.png)", BASE);
    assert!(!scheme.contains("evil.test"), "{scheme}");
}

#[test]
fn allowed_tags_survive() {
    let html = render("<details><summary>Ещё</summary>текст <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup></details>\n\n~~нет~~ **да** _курсив_\n\n> цитата\n\n---\n", None);
    for tag in ["<details>", "<summary>", "<kbd>", "<sub>", "<sup>", "<del>", "<strong>", "<em>", "<blockquote>", "<hr>"] {
        assert!(html.contains(tag), "{tag}: {html}");
    }
}

#[test]
fn text_is_escaped() {
    let html = render("a < b & \"c\" #1", None);
    assert!(html.contains("a &lt; b &amp; \"c\""), "{html}");
}

/// Тот же документ, что в `tests/ui-parity/markdown-edit.mjs` (`toggleTask`): номера флажков у Rust и интерфейса совпадают.
#[test]
fn task_indices_match_toggle_task_in_interface() {
    let doc = ["- [ ] a", "- [x] b", "```", "- [ ] в коде", "```", "  1. [ ] c", "> - [ ] d", "~~~~", "- [ ] тоже код", "~~~", "- [ ] всё ещё код", "~~~~", "* [X] e", "- [ ]нет пробела", "- [] нет"].join("\n");
    let html = render(&doc, None);
    let inputs: Vec<&str> = html.split("<input").skip(1).map(|rest| rest.split('>').next().unwrap()).collect();
    assert_eq!(inputs.len(), 5, "{html}");
    let checked: Vec<bool> = inputs.iter().map(|input| input.contains("checked")).collect();
    assert_eq!(checked, [false, true, false, false, true], "{html}");
    for (index, input) in inputs.iter().enumerate() {
        assert!(input.contains(&format!(r#"data-task-index="{index}""#)), "{html}");
    }
    assert!(!html.contains("в коде</li>") && html.contains("в коде"), "{html}");
}
