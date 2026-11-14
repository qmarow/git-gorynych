/**
 * Новое в 2.0: форма новой задачи — на месте карточки (`issuesStore.select(path, 'new')`).
 *
 * - Заголовок с автофокусом, обязательный: пустой — «Создать задачу» неактивна, а Ctrl+Enter переводит фокус в
 *   заголовок с красной рамкой и «Введите заголовок».
 * - Шаблоны — `meta.templates`: один подставляется сразу в пустую форму; несколько — ряд кнопок над описанием и «Без
 *   шаблона». Шаблон заполняет описание, заголовок (если пуст) и метки (только существующие в `meta.labels`); если
 *   описание уже изменено — сначала подтверждение замены.
 * - Описание — `MarkdownEditor` от 8 строк; панель свойств — та же, что в карточке, но меняет черновик.
 * - Черновик — один объект под ключом `…:new` (`lib/issueDrafts.ts`): каждая правка — `saveDraft`, после создания его
 *   удаляет `issuesStore.create`. «Отмена» (Esc) не спрашивает: черновик сохранён, в шапке раздела — «Черновик задачи».
 * - «Создать ещё одну» — форма остаётся, заголовок и описание очищаются, метки, исполнители и веха остаются.
 * - Ошибка сервера — над кнопками, форма как есть.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, ShieldAlert } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs.tsx';
import { loadDraft, saveDraft, type NewIssueDraft } from '../../lib/issueDrafts.ts';
import { issueInput, nextLabelColor, type Issue } from '../../lib/issues.ts';
import { issuesStore } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps, IssueMeta_Serialize, IssueTemplate_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import IssueMetaPanel, { type MetaChange, type MetaValues } from './IssueMetaPanel.tsx';
import MarkdownEditor from './MarkdownEditor.tsx';

const COMPACT = 720;

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

interface Form extends MetaValues {
  title: string;
  body: string;
  template: string | null;
}

const EMPTY: Form = { title: '', body: '', labels: [], assignees: [], milestone: null, dueDate: null, confidential: false, template: null };

/** Черновик хранит полные объекты меток, людей и вехи (они подходят и под ссылки `IssueInput`). */
const fromDraft = (draft: NewIssueDraft | null): Form | null => (draft ? ({ ...EMPTY, ...draft } as unknown as Form) : null);

interface IssueFormProps {
  repoPath: string;
  caps: IssueCaps | null;
  meta: IssueMeta_Serialize | null;
  issues: readonly Issue[];
  onCancel: () => void;
  notify: Notify;
  /** Действие уведомления «Задача #N создана» (этап 6: «Создать ветку»). */
  createdAction?: (issue: Issue) => { label: ReactNode; onClick: () => void } | undefined;
}

export default function IssueForm({ repoPath, caps, meta, issues, onCancel, notify, createdAction }: IssueFormProps) {
  const store = issuesStore.getState;
  const rootEl = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLInputElement>(null);
  const bodyEl = useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = useState<Form>(() => fromDraft(loadDraft(repoPath, 'new')) ?? EMPTY);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [another, setAnother] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<IssueTemplate_Serialize | null | undefined>(undefined);
  const [compact, setCompact] = useState(false);
  const templateBody = useRef<string>('');
  const templates = useMemo(() => meta?.templates ?? [], [meta?.templates]);

  useEffect(() => {
    titleEl.current?.focus();
    const el = rootEl.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const update = useCallback(
    (patch: Partial<Form>) =>
      setForm((cur) => {
        const next = { ...cur, ...patch };
        saveDraft(repoPath, 'new', next as unknown as NewIssueDraft);
        return next;
      }),
    [repoPath],
  );

  const applyTemplate = useCallback(
    (template: IssueTemplate_Serialize | null) => {
      const known = meta?.labels ?? [];
      setForm((cur) => {
        const labels = template ? known.filter((l) => template.labels.includes(l.name)) : [];
        const next: Form = {
          ...cur,
          body: template?.body ?? '',
          title: cur.title || template?.title || '',
          labels: labels.length ? [...cur.labels, ...labels.filter((l) => !cur.labels.some((c) => c.name === l.name))] : cur.labels,
          template: template?.name ?? null,
        };
        templateBody.current = next.body;
        saveDraft(repoPath, 'new', next as unknown as NewIssueDraft);
        return next;
      });
    },
    [meta?.labels, repoPath],
  );

  // Один шаблон — сразу в пустую форму (когда шаблоны пришли)
  const autoApplied = useRef(false);
  useEffect(() => {
    if (autoApplied.current || templates.length !== 1) return;
    autoApplied.current = true;
    if (!form.body && !form.template) applyTemplate(templates[0]);
  }, [templates, form.body, form.template, applyTemplate]);

  const chooseTemplate = (template: IssueTemplate_Serialize | null) => {
    const changed = form.body.trim() && form.body !== templateBody.current;
    if (changed) setConfirmTemplate(template);
    else applyTemplate(template);
  };

  const create = async () => {
    if (busy) return;
    if (!form.title.trim()) {
      setTitleError(true);
      titleEl.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await store().create(repoPath, issueInput(form), { stay: another });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    notify({ type: 'success', title: t('issues-created-toast', res.data.number), action: createdAction?.(res.data) });
    if (another) {
      update({ title: '', body: '', template: null });
      templateBody.current = '';
      titleEl.current?.focus();
    }
  };

  const onMeta = (change: MetaChange) => update(change);
  const onCreateLabel = async (name: string) => {
    const res = await store().labelCreate(repoPath, name, nextLabelColor(meta?.labels.length ?? 0));
    if (res.ok) return res.data;
    notify({ type: 'error', title: t('issues-label-create-failed'), hint: res.error.message });
    return null;
  };

  const panel = (
    <IssueMetaPanel
      values={form}
      caps={caps}
      meta={meta}
      editable
      onChange={onMeta}
      onCreateLabel={caps?.createLabel ? onCreateLabel : undefined}
      compact={compact}
    />
  );

  return (
    <div ref={rootEl} data-testid="issue-form" className="flex min-h-0 flex-1 flex-col animate-fade-in">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-gk-border px-5">
        <FileText size={15} className="text-gk-green" />
        <h1 className="text-sm font-semibold text-gk-strong">{t('issues-new')}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-3">
          {compact && <div className="-mx-5 -mt-3 mb-3">{panel}</div>}
          <label className="mb-1 text-xs font-medium text-gk-muted" htmlFor="issue-form-title">
            {t('issues-form-title')}
          </label>
          <input
            id="issue-form-title"
            ref={titleEl}
            data-testid="issue-form-title"
            value={form.title}
            aria-invalid={titleError || undefined}
            placeholder={t('issues-form-title-placeholder')}
            onChange={(e) => {
              update({ title: e.target.value });
              if (e.target.value.trim()) setTitleError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                void create();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                bodyEl.current?.focus();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
            }}
            className={`rounded border bg-gk-panel px-2.5 py-1.5 text-[15px] text-gk-strong outline-none ${titleError ? 'border-gk-red' : 'border-gk-border focus:border-gk-blue/60'}`}
          />
          {titleError && (
            <span data-testid="issue-form-title-error" className="mt-1 text-xs text-gk-red">
              {t('issues-form-title-required')}
            </span>
          )}
          {templates.length > 1 && (
            <div data-testid="issue-form-templates" className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gk-muted">{t('issues-form-template')}</span>
              {templates.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  aria-pressed={form.template === template.name}
                  onClick={() => chooseTemplate(template)}
                  className={`rounded-full border px-2 py-0.5 ${form.template === template.name ? 'border-gk-blue bg-gk-blue/15 text-gk-strong' : 'border-gk-border text-gk-text hover:bg-gk-hover'}`}
                >
                  {template.name}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!form.template}
                onClick={() => chooseTemplate(null)}
                className={`rounded-full border px-2 py-0.5 ${!form.template ? 'border-gk-blue bg-gk-blue/15 text-gk-strong' : 'border-gk-border text-gk-muted hover:bg-gk-hover'}`}
              >
                {t('issues-form-no-template')}
              </button>
            </div>
          )}
          <div className="mt-3 mb-1 text-xs font-medium text-gk-muted">{t('issues-form-body')}</div>
          {error && (
            <div role="alert" data-testid="issue-form-error" className="mb-2 rounded border border-gk-red/30 bg-gk-red/10 px-2.5 py-1.5 text-xs text-gk-text">
              {error}
            </div>
          )}
          <MarkdownEditor
            value={form.body}
            onChange={(body) => update({ body })}
            minRows={8}
            maxRows={30}
            allowEmpty
            submitDisabled={!form.title.trim()}
            busy={busy}
            onSubmit={() => void create()}
            onCancel={onCancel}
            submitLabel={t('issues-form-create')}
            render={(text) => store().renderMarkdown(repoPath, text)}
            issues={issues}
            members={meta?.members ?? []}
            textareaRef={(el) => (bodyEl.current = el)}
            footer={
              <span className="mr-auto flex items-center gap-3 text-xs text-gk-muted">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" data-testid="issue-form-another" checked={another} onChange={(e) => setAnother(e.target.checked)} />
                  {t('issues-form-another')}
                </label>
                {form.confidential && (
                  <span className="flex items-center gap-1 text-gk-yellow">
                    <ShieldAlert size={12} />
                    {t('issues-confidential')}
                  </span>
                )}
              </span>
            }
          />
        </div>
        {!compact && <div className="w-[260px] shrink-0 overflow-y-auto border-l border-gk-border">{panel}</div>}
      </div>
      {confirmTemplate !== undefined && (
        <ConfirmDialog title={t('issues-form-replace-title')} confirmLabel={t('issues-form-replace')} onConfirm={() => applyTemplate(confirmTemplate)} onClose={() => setConfirmTemplate(undefined)}>
          {t('issues-form-replace-text')}
        </ConfirmDialog>
      )}
    </div>
  );
}
