/**
 * Новое в 2.0: кнопка состояния задачи. Открытая — «Закрыть задачу»; если сервер знает причины закрытия
 * (`caps.closeReasons`, GitHub) — разделённая кнопка: основная часть «Закрыть как выполненную», стрелка — меню с
 * «Закрыть как выполненную» и «Закрыть как непланируемую». Закрытая — «Открыть заново». Подтверждения нет: действие
 * обратимо (уведомление с «Отменить» показывает вызывающий).
 */
import { useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleSlash, RotateCcw } from 'lucide-react';
import ContextMenu from '../ContextMenu.tsx';
import type { Issue } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';
import type { IssueCaps } from '../../../crates/gorynych-tauri/bindings/commands.ts';

interface IssueStateButtonProps {
  issue: Pick<Issue, 'state'>;
  caps: IssueCaps | null;
  disabled?: boolean;
  onChange: (state: 'open' | 'closed', reason: string | null) => void;
}

const base = 'flex h-7 items-center gap-1.5 border border-gk-border bg-gk-hover px-2.5 text-xs text-gk-text hover:bg-gk-fg/10 disabled:opacity-50';

export default function IssueStateButton({ issue, caps, disabled, onChange }: IssueStateButtonProps) {
  const arrow = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!caps?.close) return null;
  if (issue.state === 'closed') {
    return (
      <button type="button" data-testid="issue-state-button" disabled={disabled} onClick={() => onChange('open', null)} className={`${base} rounded`}>
        <RotateCcw size={13} className="text-gk-green" />
        {t('issues-reopen')}
      </button>
    );
  }
  const reasons = caps.closeReasons ?? [];
  const completed = reasons.includes('completed') ? 'completed' : null;
  return (
    <span className="flex">
      <button
        type="button"
        data-testid="issue-state-button"
        disabled={disabled}
        onClick={() => onChange('closed', completed)}
        className={`${base} ${reasons.length ? 'rounded-l' : 'rounded'}`}
      >
        <CheckCircle2 size={13} className="text-gk-purple" />
        {reasons.length ? t('issues-close-completed') : t('issues-close')}
      </button>
      {reasons.length > 0 && (
        <button
          ref={arrow}
          type="button"
          data-testid="issue-close-reasons"
          aria-label={t('issues-close-reasons')}
          data-tip={t('issues-close-reasons')}
          disabled={disabled}
          onClick={() => {
            const r = arrow.current!.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 2 });
          }}
          className={`${base} -ml-px rounded-r px-1.5`}
        >
          <ChevronDown size={13} />
        </button>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            reasons.includes('completed') && { label: t('issues-close-completed'), icon: CheckCircle2, onClick: () => onChange('closed', 'completed') },
            reasons.includes('not_planned') && { label: t('issues-close-not-planned'), icon: CircleSlash, onClick: () => onChange('closed', 'not_planned') },
          ]}
        />
      )}
    </span>
  );
}
