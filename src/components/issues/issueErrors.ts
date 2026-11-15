/**
 * Новое в 2.0: уведомление об ошибке правки задачи. Текст — `error.message` и `error.hint` (без «сырых» кодов).
 * `FORBIDDEN` — «Недостаточно прав», и возможности (`caps`) перечитываются тихим обновлением списка: кнопки без права
 * исчезнут. Значения к этому моменту уже вернул `issuesStore`.
 */
import type { ReactNode } from 'react';
import type { ApiError } from '../../platform/tauri.ts';
import { issuesStore } from '../../state/issuesStore.ts';
import { t, type MessageId } from '../../i18n/index.ts';

type Notify = (toast: { type: string; title: ReactNode; hint?: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => void;

export function notifyWriteError(notify: Notify, repoPath: string, error: ApiError, title: MessageId, retry?: () => void): void {
  if (error.code === 'FORBIDDEN') {
    notify({ type: 'error', title: t('issues-forbidden'), hint: error.hint ?? error.message });
    void issuesStore.getState().refresh(repoPath, { silent: true });
    return;
  }
  const hint = error.hint ? `${error.message} ${error.hint}` : error.message;
  notify({ type: 'error', title: t(title), hint, action: retry ? { label: t('issues-retry'), onClick: retry } : undefined });
}
