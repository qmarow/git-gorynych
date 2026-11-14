/**
 * Новое в 2.0: черновики раздела «Задачи» — текст не теряется при закрытии раздела и перезапуске.
 *
 * Ключи `localStorage` (в 2.0 они ещё и в SQLite, см. `platform/tauri.ts`):
 * - `issues.draft.v1:<путь>:new` — новая задача целиком (`NewIssueDraft`);
 * - `issues.draft.v1:<путь>:<номер>:comment` — комментарий к задаче;
 * - `issues.draft.v1:<путь>:<номер>:body` — правка описания.
 *
 * Значение — JSON. Запись по ключу — не чаще раза в 500 мс (последнее значение пишется в конце окна); пустой черновик
 * удаляет ключ. Удаляет черновик после успешного ответа сервера `issuesStore`, а не редактор. Ошибки `localStorage`
 * молча игнорируются, как в `graphView.ts`.
 */
import type { IssueInput_Deserialize } from '../../crates/gorynych-tauri/bindings/commands.ts';

export const DRAFT_PREFIX = 'issues.draft.v1:';
export const DRAFT_DELAY = 500;

/** Новая задача: то же, что уходит в `issues.create`, плюс выбранный шаблон. */
export type NewIssueDraft = IssueInput_Deserialize & { template?: string | null };

/** Чей черновик: новой задачи, комментария или описания задачи. */
export type DraftSlot = 'new' | { number: number; field: 'comment' | 'body' };

export type DraftValue<S extends DraftSlot> = S extends 'new' ? NewIssueDraft : string;

export function draftKey(path: string, slot: DraftSlot): string {
  return slot === 'new' ? `${DRAFT_PREFIX}${path}:new` : `${DRAFT_PREFIX}${path}:${slot.number}:${slot.field}`;
}

/** Пустой ли черновик: пустая строка или новая задача без заголовка, текста и свойств. */
export function isEmptyDraft(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value === '';
  if (typeof value !== 'object') return true;
  const draft = value as NewIssueDraft;
  return (
    !draft.title &&
    !draft.body &&
    !draft.labels?.length &&
    !draft.assignees?.length &&
    !draft.milestone &&
    !draft.dueDate &&
    !draft.confidential &&
    !draft.template
  );
}

const pending = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> | null }>();
const lastWrite = new Map<string, number>();

function write(key: string, value: unknown): void {
  try {
    if (isEmptyDraft(value)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно — черновик живёт до перезапуска только в редакторе */
  }
}

/** Черновик или `null`. Ещё не записанное значение (в окне 500 мс) тоже возвращается. */
export function loadDraft<S extends DraftSlot>(path: string, slot: S): DraftValue<S> | null {
  const key = draftKey(path, slot);
  const queued = pending.get(key);
  if (queued) return isEmptyDraft(queued.value) ? null : (queued.value as DraftValue<S>);
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const value: unknown = JSON.parse(raw);
    if (slot === 'new' ? value === null || typeof value !== 'object' || Array.isArray(value) : typeof value !== 'string') return null;
    return isEmptyDraft(value) ? null : (value as DraftValue<S>);
  } catch {
    return null;
  }
}

/** Сохраняет черновик: сразу, если с прошлой записи прошло 500 мс, иначе в конце окна (последнее значение). */
export function saveDraft<S extends DraftSlot>(path: string, slot: S, value: DraftValue<S>): void {
  const key = draftKey(path, slot);
  const now = Date.now();
  const queued = pending.get(key);
  if (queued) {
    queued.value = value;
    return;
  }
  const since = now - (lastWrite.get(key) ?? -Infinity);
  if (since >= DRAFT_DELAY) {
    lastWrite.set(key, now);
    write(key, value);
    return;
  }
  const entry: { value: unknown; timer: ReturnType<typeof setTimeout> | null } = { value, timer: null };
  entry.timer = setTimeout(() => {
    pending.delete(key);
    lastWrite.set(key, Date.now());
    write(key, entry.value);
  }, DRAFT_DELAY - since);
  pending.set(key, entry);
}

/** Удаляет черновик и отменяет его отложенную запись. */
export function clearDraft(path: string, slot: DraftSlot): void {
  const key = draftKey(path, slot);
  const queued = pending.get(key);
  if (queued?.timer) clearTimeout(queued.timer);
  pending.delete(key);
  write(key, null);
}

/** Записывает всё отложенное сразу (закрытие окна). */
export function flushDrafts(): void {
  for (const [key, entry] of [...pending]) {
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(key);
    lastWrite.set(key, Date.now());
    write(key, entry.value);
  }
}
