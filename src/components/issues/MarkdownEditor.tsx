/**
 * Новое в 2.0: поле Markdown раздела «Задачи» — вкладки «Текст / Просмотр», панель форматирования, подсказки `#` и `@`,
 * черновик.
 *
 * - «Просмотр» — `render(text)` (команда `issues_render_markdown`) через 300 мс после переключения или правки; пока идёт
 *   запрос, виден прежний результат.
 * - `secondaryLabel` / `onSecondarySubmit` — вторая кнопка и Ctrl+Shift+Enter («Отправить и закрыть задачу»).
 * - Клавиши в поле: Ctrl+B — жирный, Ctrl+I — курсив (раздел при этом не закрывается: событие дальше поля не идёт),
 *   Ctrl+E — код, Ctrl+K — ссылка, Ctrl+Enter — `onSubmit` (пустой текст — ничего), Esc — `onCancel`, если задан;
 *   Enter в пункте списка продолжает список, в пустом пункте — завершает; Tab / Shift+Tab в пунктах — отступ.
 * - `#` — задачи из загруженного списка, `@` — участники (`meta.members`): стрелки, Enter или Tab, Esc.
 * - Черновик (`draft`): при монтировании `loadDraft` (если поле пусто) и строка «Восстановлен черновик» с «Очистить»;
 *   каждая правка — `saveDraft`. Удаляет черновик `issuesStore` после успешной отправки.
 * Правки текста — `lib/markdownEdit.ts`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Bold, Code, Italic, Link2, List, ListChecks, Loader2, Quote } from 'lucide-react';
import { Button } from '../Dialogs.tsx';
import { clearDraft, loadDraft, saveDraft, type DraftSlot } from '../../lib/issueDrafts.ts';
import {
  applyTrigger,
  continueList,
  findTrigger,
  indentList,
  insertLink,
  prefixLines,
  wrapSelection,
  type TextEdit,
  type Trigger,
} from '../../lib/markdownEdit.ts';
import type { ApiResult } from '../../platform/tauri.ts';
import { t } from '../../i18n/index.ts';
import type { IssueUser_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import Markdown from './Markdown.tsx';
import { buildSuggestions, type Suggestion } from './suggestions.tsx';

const PREVIEW_DELAY = 300;
const LINE = 20;

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Черновик: путь репозитория и чей он. */
  draft?: { path: string; slot: Exclude<DraftSlot, 'new'> };
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  onSubmit: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Идёт отправка: поле и кнопки заблокированы, на кнопке — индикатор. */
  busy?: boolean;
  submitLabel: ReactNode;
  /** Вторая кнопка (Ctrl+Shift+Enter): «Отправить и закрыть задачу». */
  secondaryLabel?: ReactNode;
  onSecondarySubmit?: () => void;
  /** Пустой текст разрешён (описание задачи). */
  allowEmpty?: boolean;
  /** Кнопка отправки неактивна (форма: пустой заголовок), а Ctrl+Enter всё равно зовёт `onSubmit` — для подсказки. */
  submitDisabled?: boolean;
  /** Слева в нижней строке вместо подсказки клавиш. */
  footer?: ReactNode;
  cancelLabel?: ReactNode;
  render: (text: string) => Promise<ApiResult<string>>;
  issues?: readonly { number: number; title: string }[];
  members?: readonly IssueUser_Serialize[];
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
}


export default function MarkdownEditor({
  value,
  onChange,
  draft,
  placeholder,
  minRows = 3,
  maxRows = 14,
  onSubmit,
  onCancel,
  autoFocus,
  disabled,
  busy,
  submitLabel,
  secondaryLabel,
  onSecondarySubmit,
  allowEmpty = false,
  submitDisabled = false,
  footer,
  cancelLabel,
  render,
  issues = [],
  members = [],
  textareaRef,
}: MarkdownEditorProps) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [tab, setTab] = useState<'text' | 'preview'>('text');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restored, setRestored] = useState(false);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const locked = Boolean(disabled || busy);
  const draftPath = draft?.path;
  const draftSlot = draft?.slot;

  // Черновик — один раз при монтировании
  useEffect(() => {
    if (!draftPath || !draftSlot || value) return;
    const saved = loadDraft(draftPath, draftSlot);
    if (saved) {
      onChange(saved);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: string) => {
    onChange(next);
    if (draftPath && draftSlot) saveDraft(draftPath, draftSlot, next);
    if (!next) setRestored(false);
  };

  const apply = (edit: TextEdit | null): boolean => {
    if (!edit) return false;
    selection.current = { start: edit.start, end: edit.end };
    change(edit.value);
    return true;
  };

  // Выделение после правки и высота поля
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    if (selection.current) {
      el.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
    el.style.height = 'auto';
    const height = Math.min(Math.max(el.scrollHeight, minRows * LINE + 12), maxRows * LINE + 12);
    el.style.height = `${height}px`;
  }, [value, tab, minRows, maxRows]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  // Просмотр: через 300 мс после переключения или правки, прежний результат — пока идёт запрос
  useEffect(() => {
    if (tab !== 'preview') return undefined;
    let current = true;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const res = await render(value);
      if (!current) return;
      setPreviewing(false);
      setPreview(res.ok ? res.data : null);
    }, PREVIEW_DELAY);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [tab, value, render]);

  const suggestions = useMemo(() => buildSuggestions(trigger, issues, members), [trigger, issues, members]);

  const updateTrigger = (el: HTMLTextAreaElement) => {
    const next = el.selectionStart === el.selectionEnd ? findTrigger(el.value, el.selectionStart) : null;
    setTrigger((prev) => (prev?.at === next?.at && prev?.kind === next?.kind && prev?.query === next?.query ? prev : next));
    if (next?.at !== trigger?.at) setActive(0);
  };

  const pick = (item: Suggestion) => {
    const el = area.current;
    if (!el || !trigger) return;
    apply(applyTrigger(el.value, el.selectionStart, trigger, item.insert));
    setTrigger(null);
  };

  const format = (kind: 'bold' | 'italic' | 'code' | 'link' | 'list' | 'task' | 'quote') => {
    const el = area.current;
    if (!el || locked) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const edit =
      kind === 'bold'
        ? wrapSelection(v, s, e, '**', t('issues-md-bold-text'))
        : kind === 'italic'
          ? wrapSelection(v, s, e, '_', t('issues-md-italic-text'))
          : kind === 'code'
            ? wrapSelection(v, s, e, '`', t('issues-md-code-text'))
            : kind === 'link'
              ? insertLink(v, s, e, t('issues-md-link-text'))
              : prefixLines(v, s, e, kind === 'list' ? '- ' : kind === 'task' ? '- [ ] ' : '> ');
    apply(edit);
    el.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (suggestions.length && trigger) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !mod && !e.shiftKey) {
        stop();
        pick(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        stop();
        setTrigger(null);
        return;
      }
    }
    if (mod && !e.altKey && e.key === 'Enter') {
      stop();
      if ((value.trim() || allowEmpty) && !locked) (e.shiftKey && onSecondarySubmit ? onSecondarySubmit : onSubmit)();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const kind = ({ KeyB: 'bold', KeyI: 'italic', KeyE: 'code', KeyK: 'link' } as const)[e.code as 'KeyB'];
      if (kind) {
        stop();
        format(kind);
        return;
      }
    }
    if (e.key === 'Escape' && onCancel) {
      stop();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      if (apply(continueList(el.value, el.selectionStart, el.selectionEnd))) e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (apply(indentList(el.value, el.selectionStart, el.selectionEnd, e.shiftKey))) stop();
    }
  };

  const tool = (kind: Parameters<typeof format>[0], Icon: typeof Bold, tip: string) => (
    <button
      type="button"
      tabIndex={-1}
      disabled={locked || tab !== 'text'}
      data-tip={tip}
      aria-label={tip}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => format(kind)}
      className="flex h-6 w-6 items-center justify-center rounded text-gk-muted hover:bg-gk-hover hover:text-gk-text disabled:opacity-40"
    >
      <Icon size={14} strokeWidth={1.9} />
    </button>
  );

  const tabButton = (id: 'text' | 'preview', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-t px-2.5 py-1 text-xs ${tab === id ? 'bg-gk-hover font-medium text-gk-strong' : 'text-gk-muted hover:text-gk-text'}`}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="md-editor" className="flex flex-col rounded-md border border-gk-border bg-gk-panel focus-within:border-gk-blue/60">
      <div className="flex items-center gap-0.5 border-b border-gk-border px-1.5 pt-1" role="tablist">
        {tabButton('text', t('issues-md-write'))}
        {tabButton('preview', t('issues-md-preview'))}
        <span className="flex-1" />
        {tool('bold', Bold, t('issues-md-bold'))}
        {tool('italic', Italic, t('issues-md-italic'))}
        {tool('code', Code, t('issues-md-code'))}
        {tool('link', Link2, t('issues-md-link'))}
        {tool('list', List, t('issues-md-list'))}
        {tool('task', ListChecks, t('issues-md-task-list'))}
        {tool('quote', Quote, t('issues-md-quote'))}
      </div>
      {restored && (
        <div className="flex items-center gap-2 border-b border-gk-border bg-gk-blue/5 px-2.5 py-1 text-[11px] text-gk-muted">
          {t('issues-draft-restored')}
          <button
            type="button"
            className="text-gk-blue hover:underline"
            onClick={() => {
              if (draftPath && draftSlot) clearDraft(draftPath, draftSlot);
              onChange('');
              setRestored(false);
              area.current?.focus();
            }}
          >
            {t('issues-draft-clear')}
          </button>
        </div>
      )}
      <div className="relative">
        {tab === 'text' ? (
          <textarea
            ref={(el) => {
              area.current = el;
              textareaRef?.(el);
            }}
            value={value}
            disabled={locked}
            placeholder={placeholder}
            spellCheck
            onChange={(e) => {
              change(e.target.value);
              updateTrigger(e.target);
            }}
            onSelect={(e) => updateTrigger(e.currentTarget)}
            onBlur={() => setTrigger(null)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none bg-transparent px-2.5 py-1.5 text-[13px] leading-5 text-gk-text outline-none placeholder:text-gk-dim disabled:opacity-60"
          />
        ) : (
          <div data-testid="md-preview" className="min-h-16 px-3 py-2" style={{ minHeight: minRows * LINE + 12 }}>
            {preview == null ? (
              <span className="text-xs text-gk-dim">{previewing ? t('issues-md-rendering') : value.trim() ? '' : t('issues-md-nothing')}</span>
            ) : preview ? (
              <Markdown html={preview} />
            ) : (
              <span className="text-xs text-gk-dim">{t('issues-md-nothing')}</span>
            )}
          </div>
        )}
        {tab === 'text' && trigger && suggestions.length > 0 && (
          <div role="listbox" data-testid="md-suggestions" className="absolute left-2 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-gk-border bg-gk-panel-2 py-1 shadow-xl backdrop-blur">
            {suggestions.map((item, i) => (
              <div
                key={item.key}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs ${i === active ? 'bg-gk-hover text-gk-strong' : 'text-gk-text'}`}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-gk-border px-2 py-1.5">
        {footer ?? <span className="mr-auto text-[11px] text-gk-dim">{t('issues-md-hint')}</span>}
        {onCancel && (
          <Button type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('cancel')}
          </Button>
        )}
        {secondaryLabel && onSecondarySubmit && (
          <Button type="button" data-testid="md-submit-secondary" disabled={locked || (!value.trim() && !allowEmpty)} onClick={onSecondarySubmit}>
            {secondaryLabel}
          </Button>
        )}
        <Button type="button" variant="blue" data-testid="md-submit" disabled={locked || submitDisabled || (!value.trim() && !allowEmpty)} onClick={onSubmit}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
