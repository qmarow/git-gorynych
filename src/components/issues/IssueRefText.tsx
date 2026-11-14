/**
 * Новое в 2.0: текст со ссылками `#123` на задачи — в графе (`CommitGraph`, `MessageText`) и в панели коммита
 * (`CommitDetails`). Номера ищет `findIssueRefs`, разбор — в `useMemo` по тексту. Без `onOpen` (у репозитория нет
 * сервера) — текст как есть.
 *
 * Клик открывает задачу; `mousedown`, `click` и `dragstart` дальше кнопки не идут — строка графа не выбирается и коммит
 * не начинает перетаскиваться (как значок пайплайна). Подсказка ставится при наведении: заголовок и состояние из
 * `issuesStore`, если задача там уже есть, иначе «Открыть задачу #N». Запросов при наведении нет.
 */
import { memo, useMemo, type ReactNode } from 'react';
import { findIssueRefs } from '../../lib/issues.ts';
import { issuesStore } from '../../state/issuesStore.ts';
import { t } from '../../i18n/index.ts';
import { stateTitle } from './IssueBits.tsx';

/** Подсказка ссылки `#N`: из уже загруженного, без запросов. */
export function issueRefTip(repoPath: string | null | undefined, number: number): string {
  const repo = repoPath ? issuesStore.getState().byRepo[repoPath] : undefined;
  const issue = repo?.items.find((i) => i.number === number) ?? repo?.details[number]?.detail?.issue;
  return issue ? `#${number} ${issue.title} · ${stateTitle(issue)}` : t('issues-open-ref', number);
}

interface IssueRefTextProps {
  text: string;
  repoPath?: string | null;
  onOpen?: (number: number) => void;
  /** Как показать обычный кусок текста (подсветка поиска в графе). */
  renderPart?: (text: string) => ReactNode;
}

function IssueRefText({ text, repoPath, onOpen, renderPart }: IssueRefTextProps) {
  const refs = useMemo(() => (onOpen ? findIssueRefs(text) : []), [text, onOpen]);
  if (!onOpen || !refs.length) return renderPart ? renderPart(text) : text;
  const out: ReactNode[] = [];
  let last = 0;
  refs.forEach((ref, i) => {
    if (ref.start > last) out.push(<span key={`t${i}`}>{renderPart ? renderPart(text.slice(last, ref.start)) : text.slice(last, ref.start)}</span>);
    out.push(
      <button
        key={`r${i}`}
        type="button"
        data-issue-ref={ref.number}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseOver={(e) => {
          e.currentTarget.dataset.tip = issueRefTip(repoPath, ref.number);
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen(ref.number);
        }}
        className="text-gk-blue hover:underline"
      >
        {text.slice(ref.start, ref.end)}
      </button>,
    );
    last = ref.end;
  });
  if (last < text.length) out.push(<span key="tail">{renderPart ? renderPart(text.slice(last)) : text.slice(last)}</span>);
  return <>{out}</>;
}

export default memo(IssueRefText);
