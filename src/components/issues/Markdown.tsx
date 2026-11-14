/**
 * Новое в 2.0: показ Markdown задачи и комментария.
 *
 * ⚠ `dangerouslySetInnerHTML` в разделе «Задачи» допустим только здесь и только для HTML из
 * `crates/gorynych-cicd/src/issues/markdown.rs` (`bodyHtml` задачи и комментария, ответ `issues.renderMarkdown`): там он
 * очищен `ammonia` по явному списку тегов и атрибутов. Любой другой текст сюда не передавать — показывать его React-ом.
 *
 * Один обработчик `click` (и `auxclick` — средняя кнопка) на контейнере:
 * - `a[data-issue]` — `onIssueClick(номер)`;
 * - иная ссылка — `onOpenLink(адрес)` (внешний браузер), якорь `#…` — ничего; переход внутри окна отменяется всегда;
 * - `input[data-task-index]` — `onTaskToggle(номер, отмечен)`; без обработчика флажки неактивны.
 * Блоки `pre > code.language-*` после вставки подсвечиваются `lib/highlight.ts` (неизвестный язык — без подсветки).
 * Картинка, которая не загрузилась (закрытый репозиторий требует входа), заменяется ссылкой «Открыть изображение на сервере».
 */
import { memo, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { highlightLines } from '../../lib/highlight.ts';
import { t } from '../../i18n/index.ts';

interface MarkdownProps {
  html: string;
  onIssueClick?: (number: number) => void;
  onTaskToggle?: (index: number, checked: boolean) => void;
  onOpenLink?: (url: string) => void;
  className?: string;
}

/** Подсветка блоков кода: текст тот же, куски — `span` с классами `tok-*`. */
function highlightBlocks(root: HTMLElement): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const lang = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]?.toLowerCase();
    const text = code.textContent ?? '';
    const lines = text.replace(/\n$/, '').split('\n');
    const tokens = highlightLines(lines, lang);
    if (!tokens) continue;
    const doc = code.ownerDocument;
    const out = doc.createDocumentFragment();
    tokens.forEach((line, i) => {
      for (const piece of line) {
        if (!piece.cls) out.append(piece.text);
        else {
          const span = doc.createElement('span');
          span.className = piece.cls;
          span.textContent = piece.text;
          out.append(span);
        }
      }
      if (i < tokens.length - 1 || text.endsWith('\n')) out.append('\n');
    });
    code.replaceChildren(out);
  }
}

/** Картинка, которая не загрузилась, — ссылка на неё (откроется во внешнем браузере, где есть вход). */
function replaceBroken(img: HTMLImageElement): void {
  const link = img.ownerDocument.createElement('a');
  link.href = img.src;
  link.dataset.brokenImage = '';
  link.textContent = t('issues-open-image');
  img.replaceWith(link);
}

function Markdown({ html, onIssueClick, onTaskToggle, onOpenLink, className = '' }: MarkdownProps) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ onIssueClick, onTaskToggle, onOpenLink });
  live.current = { onIssueClick, onTaskToggle, onOpenLink };
  const toggles = Boolean(onTaskToggle);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    highlightBlocks(root);
    // Ошибка, случившаяся до подписки (картинка из кэша), видна по `complete` без размера
    for (const img of root.querySelectorAll('img')) if (img.complete && img.src && !img.naturalWidth) replaceBroken(img);
  }, [html]);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    for (const input of root.querySelectorAll<HTMLInputElement>('input[data-task-index]')) input.disabled = !toggles;
  }, [html, toggles]);

  // Картинка не загрузилась — ссылка на неё (событие `error` не всплывает, ловится на погружении)
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return undefined;
    const onError = (e: Event) => {
      if (e.target instanceof HTMLImageElement && e.target.src) replaceBroken(e.target);
    };
    root.addEventListener('error', onError, true);
    return () => root.removeEventListener('error', onError, true);
  }, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const input = target.closest('input[data-task-index]');
    if (input instanceof HTMLInputElement) {
      if (!live.current.onTaskToggle) {
        e.preventDefault();
        return;
      }
      live.current.onTaskToggle(Number(input.dataset.taskIndex), input.checked);
      return;
    }
    const link = target.closest('a');
    if (!link || !box.current?.contains(link)) return;
    e.preventDefault();
    if (e.button > 1) return;
    const issue = link.dataset.issue;
    if (issue) {
      live.current.onIssueClick?.(Number(issue));
      return;
    }
    const href = link.getAttribute('href');
    if (href && /^(https?:|mailto:)/i.test(href)) live.current.onOpenLink?.(href);
  };

  return (
    <div
      ref={box}
      onClick={onClick}
      onAuxClick={onClick}
      onDragStart={(e) => (e.target as HTMLElement).closest?.('a') && e.preventDefault()}
      className={`md-body ${className}`}
      // Только HTML из issues/markdown.rs — см. шапку файла
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(Markdown);
