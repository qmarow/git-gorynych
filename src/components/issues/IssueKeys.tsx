/**
 * Новое в 2.0: клавиши раздела «Задачи» — список для пустой карточки, окно «?» (`KeyHelpDialog`) и глава «Задачи» в
 * справке (`GuideDialog`).
 */
import { Keyboard } from 'lucide-react';
import { Modal } from '../Dialogs.tsx';
import { t } from '../../i18n/index.ts';

const KEYS: [string, Parameters<typeof t>[0]][] = [
  ['Ctrl+I', 'issues-key-toggle'],
  ['↑ ↓ · K J', 'issues-key-nav'],
  ['Enter', 'issues-key-card'],
  ['/', 'issues-key-search'],
  ['C', 'issues-key-new'],
  ['R', 'issues-key-comment'],
  ['E', 'issues-key-title'],
  ['B', 'issues-key-branch'],
  ['L · A · M', 'issues-key-pickers'],
  ['Ctrl+Enter', 'issues-key-send'],
  ['Ctrl+Shift+Enter', 'issues-key-send-close'],
  ['F5', 'issues-key-refresh'],
  ['Esc', 'issues-key-escape'],
  ['?', 'issues-key-help'],
];

export function KeyList() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-xs">
      {KEYS.map(([key, id]) => (
        <div key={id} className="contents">
          <dt><kbd className="rounded border border-gk-border bg-gk-sink/30 px-1.5 py-px font-mono text-[11px] text-gk-text">{key}</kbd></dt>
          <dd className="text-gk-muted">{t(id)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Памятка по клавишам — модальное окно (Esc закрывает только его). */
export function KeyHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('issues-keys-title')} icon={Keyboard} onClose={onClose}>
      <div data-testid="issues-key-help">
        <KeyList />
      </div>
    </Modal>
  );
}
