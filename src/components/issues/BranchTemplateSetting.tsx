/**
 * Новое в 2.0: настройка «Шаблон имени ветки для задачи» (вкладка «Ветки» в настройках). Переменные `{number}`, `{slug}`,
 * `{type}`; под полем — живой пример. Хранение — `localStorage` (`lib/issues.ts`, в 2.0 ещё и SQLite), как у соседних
 * настроек; пустое поле — шаблон по умолчанию.
 */
import { useState } from 'react';
import { branchNameFor, DEFAULT_BRANCH_TEMPLATE, readBranchTemplate, writeBranchTemplate } from '../../lib/issues.ts';
import { t } from '../../i18n/index.ts';

export default function BranchTemplateSetting() {
  const [value, setValue] = useState(() => readBranchTemplate());
  const example = branchNameFor({ number: 123, title: t('issues-branch-template-example-title'), labels: [{ name: 'bug' }] }, value);
  return (
    <div data-testid="branch-template-setting">
      <label className="font-medium text-gk-text" htmlFor="issues-branch-template">
        {t('issues-branch-template')}
      </label>
      <div className="mt-0.5 text-gk-muted">{t('issues-branch-template-hint')}</div>
      <input
        id="issues-branch-template"
        value={value}
        placeholder={DEFAULT_BRANCH_TEMPLATE}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          writeBranchTemplate(e.target.value);
        }}
        className="mt-2 w-full max-w-sm rounded border border-gk-border bg-gk-panel px-2 py-1 font-mono text-[12px] text-gk-text outline-none focus:border-gk-blue/60"
      />
      <div className="mt-1 text-[11.5px] text-gk-dim">
        {t('issues-branch-template-example')} <span data-testid="branch-template-example" className="font-mono text-gk-text">{example}</span>
      </div>
    </div>
  );
}
