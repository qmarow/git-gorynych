import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FileCode,
  GitBranch,
  GitMerge,
  Hand,
  Info,
  Lightbulb,
  ListChecks,
  MousePointerClick,
  SquareTerminal,
  Tag,
  Wrench,
} from 'lucide-react';

export const SEVERITY = {
  error: { label: 'Ошибки', one: 'ошибка', icon: CircleX, text: 'text-gk-red', bg: 'bg-gk-red/10', ring: 'ring-gk-red/30', dot: 'bg-gk-red' },
  warning: { label: 'Предупреждения', one: 'предупреждение', icon: AlertTriangle, text: 'text-gk-yellow', bg: 'bg-gk-yellow/10', ring: 'ring-gk-yellow/30', dot: 'bg-gk-yellow' },
  info: { label: 'Советы', one: 'совет', icon: Info, text: 'text-gk-blue', bg: 'bg-gk-blue/10', ring: 'ring-gk-blue/25', dot: 'bg-gk-blue' },
};
const ORDER = ['error', 'warning', 'info'];

export const issueKey = (i) => `${i.id}|${i.file}|${i.line}|${i.title}`;

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const countText = (stats) =>
  [
    stats.error && `${stats.error} ${plural(stats.error, 'ошибка', 'ошибки', 'ошибок')}`,
    stats.warning && `${stats.warning} ${plural(stats.warning, 'предупреждение', 'предупреждения', 'предупреждений')}`,
    stats.info && `${stats.info} ${plural(stats.info, 'совет', 'совета', 'советов')}`,
  ]
    .filter(Boolean)
    .join(' · ');

const SCENARIO_ICONS = { 'push-default': GitBranch, 'push-branch': GitBranch, mr: GitMerge, tag: Tag, schedule: CalendarClock, web: MousePointerClick };

/**
 * Вкладка «Проверка»: что в конфигурации CI/CD сломается, когда, как это будет выглядеть, почему и как исправить.
 */
export default function CheckView({ check, systemTitle, draft, onShowLine, onSelectJob, focus }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const listRef = useRef(null);
  const issues = check?.issues ?? [];
  const stats = check?.stats ?? { error: 0, warning: 0, info: 0 };

  // Переход к конкретной проблеме (из схемы или карточки задания)
  useEffect(() => {
    if (!focus) return;
    setFilter('all');
    setOpen((s) => new Set(s).add(focus.key));
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-key="${CSS.escape(focus.key)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [focus]);

  const shown = useMemo(() => (filter === 'all' ? issues : issues.filter((i) => i.severity === filter)), [issues, filter]);
  if (!check) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-gk-muted">Проверка конфигурации недоступна для этого файла</div>;
  }
  const toggle = (key) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const tone = stats.error ? 'error' : stats.warning ? 'warning' : null;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto" ref={listRef}>
      <div className="mx-auto max-w-[1100px] space-y-4 p-4">
        {/* Итог */}
        <div
          data-testid="check-summary"
          className={`flex animate-fade-in items-start gap-3 rounded-lg border px-4 py-3 ${
            tone === 'error' ? 'border-gk-red/30 bg-gk-red/[0.07]' : tone === 'warning' ? 'border-gk-yellow/30 bg-gk-yellow/[0.06]' : 'border-gk-green/30 bg-gk-green/[0.07]'
          }`}
        >
          {tone === 'error' ? (
            <CircleX size={22} className="mt-0.5 shrink-0 text-gk-red" />
          ) : tone === 'warning' ? (
            <AlertTriangle size={22} className="mt-0.5 shrink-0 text-gk-yellow" />
          ) : (
            <CircleCheck size={22} className="mt-0.5 shrink-0 text-gk-green" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gk-strong">
              {tone === 'error'
                ? `${stats.error} ${plural(stats.error, 'ошибка', 'ошибки', 'ошибок')} — пайплайн не создастся или задания упадут`
                : tone === 'warning'
                  ? 'Явных ошибок нет, но есть то, что может сломаться'
                  : 'Проверка пройдена — ошибок не найдено'}
            </div>
            <div className="mt-0.5 text-[12px] text-gk-muted">
              {countText(stats) || 'Замечаний нет'}
              {' · '}
              {systemTitle}, проверено локально, без отправки на сервер{draft ? ' · по несохранённому черновику' : ''}
            </div>
            <div className="mt-1 text-[11.5px] text-gk-dim">
              Проверяются синтаксис и ключи, ссылки между заданиями, правила запуска, а также команды скриптов — против файлов репозитория и образов
              заданий.
            </div>
          </div>
        </div>

        {/* Фильтр */}
        {issues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              Все · {issues.length}
            </FilterChip>
            {ORDER.filter((s) => stats[s]).map((s) => {
              const S = SEVERITY[s];
              return (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} testid={`check-filter-${s}`}>
                  <S.icon size={12} className={S.text} /> {S.label} · {stats[s]}
                </FilterChip>
              );
            })}
            <div className="flex-1" />
            {open.size > 0 ? (
              <button onClick={() => setOpen(new Set())} className="text-[11.5px] text-gk-muted hover:text-gk-text">
                Свернуть все
              </button>
            ) : (
              <button onClick={() => setOpen(new Set(shown.map(issueKey)))} className="text-[11.5px] text-gk-muted hover:text-gk-text">
                Развернуть все
              </button>
            )}
          </div>
        )}

        {/* Список */}
        {ORDER.map((sev) => {
          const list = shown.filter((i) => i.severity === sev);
          if (!list.length) return null;
          const S = SEVERITY[sev];
          return (
            <section key={sev} className="space-y-1.5">
              <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${S.text}`}>
                <S.icon size={12} /> {S.label} · {list.length}
              </div>
              {list.map((issue) => (
                <IssueRow
                  key={issueKey(issue)}
                  issue={issue}
                  open={open.has(issueKey(issue))}
                  focused={focus?.key === issueKey(issue)}
                  onToggle={() => toggle(issueKey(issue))}
                  onShowLine={onShowLine}
                  onSelectJob={onSelectJob}
                />
              ))}
            </section>
          );
        })}

        {check.scenarios?.length > 0 && <Scenarios scenarios={check.scenarios} issues={issues} defaultBranch={check.defaultBranch} />}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition-colors ${
        active ? 'bg-gk-blue/20 text-gk-blue ring-1 ring-gk-blue/40' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

function IssueRow({ issue, open, focused, onToggle, onShowLine, onSelectJob }) {
  const S = SEVERITY[issue.severity] ?? SEVERITY.warning;
  return (
    <div
      data-testid="issue-row"
      data-id={issue.id}
      data-key={issueKey(issue)}
      className={`overflow-hidden rounded-lg border bg-gk-fg/[0.02] transition-colors ${open ? 'border-gk-fg/15' : 'border-gk-border hover:border-gk-fg/15'} ${
        focused ? `ring-1 ${S.ring}` : ''
      }`}
    >
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-2 text-left">
        <S.icon size={14} className={`mt-0.5 shrink-0 ${S.text}`} />
        <span className="min-w-0 flex-1 break-words text-[13px] text-gk-text">{issue.title}</span>
        {issue.file && (
          <span className="mt-px shrink-0 font-mono text-[11px] text-gk-dim">
            {issue.file.split('/').pop()}
            {issue.line ? `:${issue.line}` : ''}
          </span>
        )}
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-gk-dim" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-gk-dim" />}
      </button>
      {open && (
        <div data-testid="issue-details" className="animate-fade-in border-t border-gk-border/70 px-3 pb-3 pt-2.5">
          <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
            <Part icon={Clock} label="Когда">
              {issue.when}
            </Part>
            <Part icon={SquareTerminal} label="Как проявится" tone={S.text}>
              {issue.how}
            </Part>
            <Part icon={Lightbulb} label="Почему">
              {issue.why}
            </Part>
            <Part icon={Wrench} label="Как исправить" tone="text-gk-green">
              {issue.fix?.includes('\n') ? (
                <pre className="mt-0.5 overflow-x-auto whitespace-pre rounded-md bg-gk-fg/[0.045] px-2.5 py-1.5 font-mono text-[11.5px] leading-5 text-gk-text/90 ring-1 ring-gk-border">
                  {issue.fix}
                </pre>
              ) : (
                issue.fix
              )}
            </Part>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {issue.file && (
              <button
                data-testid="issue-show-line"
                onClick={() => onShowLine(issue.file, issue.line)}
                className="flex items-center gap-1 rounded-md bg-gk-blue/15 px-2 py-1 text-[12px] text-gk-blue transition-colors hover:bg-gk-blue/25"
              >
                <FileCode size={12} /> Показать в файле{issue.line ? ` · строка ${issue.line}` : ''}
              </button>
            )}
            {issue.job && onSelectJob && (
              <button
                onClick={() => onSelectJob(issue.job)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
              >
                Задание «{issue.job}» на схеме <ArrowRight size={11} />
              </button>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-gk-dim" title="Код проверки">
              {issue.id}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Part({ icon: Icon, label, tone = 'text-gk-dim', children }) {
  return (
    <div className="min-w-0">
      <div className={`mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider ${tone}`}>
        <Icon size={11} /> {label}
      </div>
      <div className="break-words text-[12.5px] leading-[1.5] text-gk-text/90">{children}</div>
    </div>
  );
}

/* ---------- Прогон событий ---------- */

function Scenarios({ scenarios, issues }) {
  const [open, setOpen] = useState(null);
  return (
    <section data-testid="check-scenarios" className="space-y-1.5 pt-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">
        <ListChecks size={12} /> Что запустится при разных событиях
      </div>
      <div className="text-[11.5px] text-gk-dim">
        Правила workflow, rules и only/except прогнаны для типичных событий. Значения переменных из настроек проекта и список изменённых
        файлов заранее неизвестны — такие задания помечены «?».
      </div>
      <div className="overflow-hidden rounded-lg border border-gk-border">
        {scenarios.map((s, idx) => {
          const Icon = SCENARIO_ICONS[s.id] ?? GitBranch;
          const problems = issues.filter((i) => i.scenario === s.id && i.severity === 'error').length;
          const isOpen = open === s.id;
          return (
            <div key={s.id} data-testid="scenario-row" data-id={s.id} className={idx ? 'border-t border-gk-border' : ''}>
              <button onClick={() => setOpen(isOpen ? null : s.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gk-hover/50">
                <Icon size={14} className="shrink-0 text-gk-muted" />
                <span className="w-64 shrink-0 truncate text-[12.5px] text-gk-text" title={s.title}>
                  {s.title}
                </span>
                {problems > 0 ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-red/15 px-2 py-0.5 text-[11px] text-gk-red">
                    <CircleX size={11} /> не создастся
                  </span>
                ) : s.created ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-green/15 px-2 py-0.5 text-[11px] text-gk-green">
                    <CircleCheck size={11} /> {s.jobs.length} {plural(s.jobs.length, 'задание', 'задания', 'заданий')}
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-fg/5 px-2 py-0.5 text-[11px] text-gk-muted">
                    <Ban size={11} /> нет пайплайна
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {s.jobs.slice(0, 8).map((j) => (
                    <span
                      key={j.name}
                      title={`${j.why}${j.uncertain ? ` · зависит от: ${j.uncertain}` : ''}`}
                      className="flex items-center gap-0.5 rounded bg-gk-fg/5 px-1.5 py-px font-mono text-[10.5px] text-gk-text/85"
                    >
                      {j.when === 'manual' && <Hand size={9} className="text-gk-yellow" />}
                      {j.when === 'delayed' && <Clock size={9} className="text-gk-blue" />}
                      {j.name}
                      {j.uncertain && <span className="text-gk-yellow">?</span>}
                    </span>
                  ))}
                  {s.jobs.length > 8 && <span className="text-[10.5px] text-gk-dim">+{s.jobs.length - 8}</span>}
                  {!s.created && <span className="truncate text-[11px] text-gk-dim">{s.reason}</span>}
                </span>
                {isOpen ? <ChevronDown size={13} className="shrink-0 text-gk-dim" /> : <ChevronRight size={13} className="shrink-0 text-gk-dim" />}
              </button>
              {isOpen && (
                <div data-testid="scenario-details" className="animate-fade-in space-y-2 border-t border-gk-border/60 bg-gk-fg/[0.015] px-4 py-2.5 text-[12px]">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-gk-dim">
                    {Object.entries(s.vars).map(([k, v]) => (
                      <span key={k}>
                        {k}=<span className="text-gk-text/80">{v}</span>
                      </span>
                    ))}
                  </div>
                  <div className="text-gk-muted">
                    {s.problems.length
                      ? 'Пайплайн: не создастся — GitLab отклонит его с ошибкой ниже'
                      : `Пайплайн: ${s.created ? 'создаётся' : 'не создаётся'} — ${s.reason}`}
                  </div>
                  {s.jobs.length > 0 && (
                    <JobList title="Попадут в пайплайн" jobs={s.jobs} tone="text-gk-green" />
                  )}
                  {s.excluded.length > 0 && <JobList title="Не попадут" jobs={s.excluded} tone="text-gk-dim" />}
                  {s.problems.length > 0 && (
                    <div className="space-y-1 rounded-md bg-gk-red/[0.07] px-2.5 py-1.5 text-gk-red ring-1 ring-gk-red/25">
                      {s.problems.map((p, i) => (
                        <div key={i} className="break-words font-mono text-[11px]">
                          {p}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function JobList({ title, jobs, tone }) {
  return (
    <div>
      <div className={`mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider ${tone}`}>{title}</div>
      <div className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-0.5">
        {jobs.map((j) => (
          <div key={j.name} className="contents">
            <span className="truncate font-mono text-[11.5px] text-gk-text">
              {j.name}
              {j.when && j.when !== 'on_success' && <span className="ml-1 text-gk-yellow">({j.when})</span>}
            </span>
            <span className="text-[11.5px] text-gk-muted">
              {j.why}
              {j.uncertain && <span className="text-gk-yellow"> · зависит от {j.uncertain}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Полоса на схеме: главные проблемы и переход ко всем */
export function CheckBanner({ check, onOpen }) {
  if (!check) return null;
  const top = check.issues.filter((i) => i.severity !== 'info');
  if (!top.length) {
    return (
      <button
        data-testid="check-banner"
        onClick={() => onOpen()}
        className="flex w-full animate-fade-in items-center gap-2 rounded-lg border border-gk-green/25 bg-gk-green/[0.06] px-3 py-2 text-left text-[12px] text-gk-green transition-colors hover:bg-gk-green/10"
      >
        <CircleCheck size={14} />
        <span className="font-medium">Проверка конфигурации: ошибок не найдено</span>
        {check.stats.info > 0 && <span className="text-gk-muted">· {countText({ info: check.stats.info })}</span>}
        <span className="ml-auto flex items-center gap-1 text-gk-muted">
          Подробнее <ArrowRight size={12} />
        </span>
      </button>
    );
  }
  const err = check.stats.error > 0;
  return (
    <div
      data-testid="check-banner"
      className={`animate-fade-in rounded-lg border px-3 py-2.5 text-[12px] ${err ? 'border-gk-red/30 bg-gk-red/[0.08]' : 'border-gk-yellow/30 bg-gk-yellow/[0.06]'}`}
    >
      <div className={`flex items-start gap-2 font-semibold ${err ? 'text-gk-red' : 'text-gk-yellow'}`}>
        {err ? <CircleX size={14} className="mt-px shrink-0" /> : <AlertTriangle size={14} className="mt-px shrink-0" />}
        <span className="min-w-0 flex-1">{err ? 'Проверка нашла ошибки — CI не запустится или задания упадут' : 'Проверка: есть то, что может сломаться'}</span>
        <button data-testid="check-banner-open" onClick={() => onOpen()} className="flex shrink-0 items-center gap-1 font-normal text-gk-blue hover:underline">
          Все проблемы <ArrowRight size={12} />
        </button>
      </div>
      <div className="mb-1.5 pl-6 text-[11.5px] text-gk-muted">{countText(check.stats)}</div>
      <div className="space-y-0.5 pl-6">
        {top.slice(0, 4).map((i) => {
          const S = SEVERITY[i.severity];
          return (
            <button key={issueKey(i)} onClick={() => onOpen(i)} className="flex w-full items-start gap-2 text-left text-gk-text/85 hover:text-gk-text">
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${S.dot}`} />
              <span className="min-w-0 flex-1 break-words">{i.title}</span>
              {i.line && <span className="shrink-0 font-mono text-[11px] text-gk-dim">стр. {i.line}</span>}
            </button>
          );
        })}
        {top.length > 4 && <div className="text-gk-dim">…и ещё {top.length - 4}</div>}
      </div>
    </div>
  );
}
