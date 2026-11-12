import { getLanguage } from '../../i18n/index.ts';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
import { t, tj } from '../../i18n/index.ts';
import type { CiCheckStats, CiCheck_Serialize, CiIssue_Serialize, CiScenarioJob_Serialize, CiScenario_Serialize, CiSeverity } from '../../../crates/gorynych-tauri/bindings/commands.ts';

type Issue = CiIssue_Serialize;
type Icon = ComponentType<{ size?: number; className?: string }>;

interface SeverityStyle {
  label: string;
  one: string;
  icon: Icon;
  text: string;
  bg: string;
  ring: string;
  dot: string;
}

export const SEVERITY: Record<CiSeverity, SeverityStyle> = {
  error: { label: t('errors'), one: t('error'), icon: CircleX, text: 'text-gk-red', bg: 'bg-gk-red/10', ring: 'ring-gk-red/30', dot: 'bg-gk-red' },
  warning: { label: t('warnings'), one: t('warning'), icon: AlertTriangle, text: 'text-gk-yellow', bg: 'bg-gk-yellow/10', ring: 'ring-gk-yellow/30', dot: 'bg-gk-yellow' },
  info: { label: t('tips'), one: t('tip'), icon: Info, text: 'text-gk-blue', bg: 'bg-gk-blue/10', ring: 'ring-gk-blue/25', dot: 'bg-gk-blue' },
};
const ORDER: CiSeverity[] = ['error', 'warning', 'info'];

export const issueKey = (i: Pick<Issue, 'id' | 'file' | 'line' | 'title'>) => `${i.id}|${i.file}|${i.line}|${i.title}`;

const plural = (n: number, one: string, few: string, many: string) => {
  if (getLanguage() !== 'ru') return n === 1 ? one : many; // в английском две формы: one и many (few = many)
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const countText = (stats: Partial<CiCheckStats>) =>
  [
    stats.error && `${stats.error} ${plural(stats.error, t('error'), t('errors-2'), t('errors-3'))}`,
    stats.warning && `${stats.warning} ${plural(stats.warning, t('warning'), t('warnings-2'), t('warnings-3'))}`,
    stats.info && `${stats.info} ${plural(stats.info, t('tip'), t('tips-2'), t('tips-3'))}`,
  ]
    .filter(Boolean)
    .join(' · ');

const SCENARIO_ICONS: Record<string, Icon> = { 'push-default': GitBranch, 'push-branch': GitBranch, mr: GitMerge, tag: Tag, schedule: CalendarClock, web: MousePointerClick };

/**
 * Вкладка «Проверка»: что в конфигурации CI/CD сломается, когда, как это будет выглядеть, почему и как исправить.
 */
interface CheckViewProps {
  check: CiCheck_Serialize | null | undefined;
  systemTitle: ReactNode;
  draft?: boolean;
  onShowLine: (file: string, line: number | null) => void;
  onSelectJob?: (job: string) => void;
  /** Проблема, к которой перейти: `key` — `issueKey` */
  focus?: { key: string } | null;
}

export default function CheckView({ check, systemTitle, draft, onShowLine, onSelectJob, focus }: CheckViewProps) {
  const [filter, setFilter] = useState<CiSeverity | 'all'>('all');
  const [open, setOpen] = useState(() => new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
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
    return <div className="flex flex-1 items-center justify-center text-[13px] text-gk-muted">{t('configuration-check-isnt-available-for')}</div>;
  }
  const toggle = (key: string) =>
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
                ? t('pipeline-wont-be-created-or', stats.error, plural(stats.error, t('error'), t('errors-2'), t('errors-3')))
                : tone === 'warning'
                  ? t('no-obvious-errors-but-some')
                  : t('check-passed-no-errors-found')}
            </div>
            <div className="mt-0.5 text-[12px] text-gk-muted">
              {tj('checked-locally-without-sending-to', [countText(stats) || t('no-remarks'), systemTitle, draft ? t('on-unsaved-draft') : ''])}
            </div>
            <div className="mt-1 text-[11.5px] text-gk-dim">
              {t('checked-syntax-and-keys-references')}</div>
          </div>
        </div>

        {/* Фильтр */}
        {issues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              {tj('all', [issues.length])}
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
                {t('collapse-all')}</button>
            ) : (
              <button onClick={() => setOpen(new Set(shown.map(issueKey)))} className="text-[11.5px] text-gk-muted hover:text-gk-text">
                {t('expand-all')}</button>
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

        {check.scenarios?.length! > 0 && <Scenarios scenarios={check.scenarios} issues={issues} defaultBranch={check.defaultBranch} />}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: ReactNode; testid?: string }) {
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

function IssueRow({ issue, open, focused, onToggle, onShowLine, onSelectJob }: { issue: Issue; open: boolean; focused: boolean; onToggle: () => void } & Pick<CheckViewProps, 'onShowLine' | 'onSelectJob'>) {
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
            <Part icon={Clock} label={t('when')}>
              {issue.when}
            </Part>
            <Part icon={SquareTerminal} label={t('how-it-shows-up')} tone={S.text}>
              {issue.how}
            </Part>
            <Part icon={Lightbulb} label={t('why')}>
              {issue.why}
            </Part>
            <Part icon={Wrench} label={t('how-to-fix')} tone="text-gk-green">
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
                onClick={() => onShowLine(issue.file!, issue.line)}
                className="flex items-center gap-1 rounded-md bg-gk-blue/15 px-2 py-1 text-[12px] text-gk-blue transition-colors hover:bg-gk-blue/25"
              >
                {tj('show-in-file', [<FileCode size={12} />, issue.line ? t('line', issue.line) : ''])}
              </button>
            )}
            {issue.job && onSelectJob && (
              <button
                onClick={() => onSelectJob(issue.job!)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gk-muted transition-colors hover:bg-gk-hover hover:text-gk-text"
              >
                {tj('job-on-diagram', [issue.job, <ArrowRight size={11} />])}
              </button>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-gk-dim" title={t('check-code')}>
              {issue.id}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Part({ icon: Icon, label, tone = 'text-gk-dim', children }: { icon: Icon; label: ReactNode; tone?: string; children: ReactNode }) {
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

function Scenarios({ scenarios, issues }: { scenarios: CiScenario_Serialize[]; issues: Issue[]; defaultBranch?: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section data-testid="check-scenarios" className="space-y-1.5 pt-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">
        {tj('what-runs-on-different-events', [<ListChecks size={12} />])}</div>
      <div className="text-[11.5px] text-gk-dim">
        {t('workflow-rules-rules-and-only')}</div>
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
                    {tj('wont-be-created', [<CircleX size={11} />])}</span>
                ) : s.created ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-green/15 px-2 py-0.5 text-[11px] text-gk-green">
                    <CircleCheck size={11} /> {s.jobs.length} {plural(s.jobs.length, t('job-3'), t('jobs'), t('jobs-3'))}
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gk-fg/5 px-2 py-0.5 text-[11px] text-gk-muted">
                    {tj('no-pipeline', [<Ban size={11} />])}</span>
                )}
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {s.jobs.slice(0, 8).map((j) => (
                    <span
                      key={j.name}
                      title={`${j.why}${j.uncertain ? t('depends-on-2', j.uncertain) : ''}`}
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
                      ? t('pipeline-wont-be-created-gitlab')
                      : t('pipeline-3', s.created ? t('created-2') : t('not-created'), s.reason)}
                  </div>
                  {s.jobs.length > 0 && (
                    <JobList title={t('will-be-in-pipeline')} jobs={s.jobs as ScenarioJobRow[]} tone="text-gk-green" />
                  )}
                  {s.excluded.length > 0 && <JobList title={t('wont-be-in-it')} jobs={s.excluded as ScenarioJobRow[]} tone="text-gk-dim" />}
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

/** Задание сценария: попавшее в пайплайн (`CiScenarioJob`) или исключённое (только имя и причина) */
type ScenarioJobRow = Pick<CiScenarioJob_Serialize, 'name' | 'why'> & { when?: string | null; uncertain?: string | null };

function JobList({ title, jobs, tone }: { title: ReactNode; jobs: ScenarioJobRow[]; tone: string }) {
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
              {j.uncertain && <span className="text-gk-yellow"> {tj('depends-on-3', [j.uncertain])}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Полоса на схеме: главные проблемы и переход ко всем */
export function CheckBanner({ check, onOpen }: { check: CiCheck_Serialize | null | undefined; onOpen: (issue?: Issue) => void }) {
  if (!check) return null;
  const top = check.issues.filter((i) => i.severity !== 'info');
  if (!top.length) {
    return (
      <button
        data-testid="check-banner"
        onClick={() => onOpen()}
        className="flex w-full animate-fade-in items-center gap-2 rounded-lg border border-gk-green/25 bg-gk-green/[0.06] px-3 py-2 text-left text-[12px] text-gk-green transition-colors hover:bg-gk-green/10"
      >
        {tj('configuration-check-no-errors-found', [<CircleCheck size={14} />, <span className="font-medium" />, check.stats.info > 0 && <span className="text-gk-muted">· {countText({ info: check.stats.info })}</span>, <span className="ml-auto flex items-center gap-1 text-gk-muted" />, <ArrowRight size={12} />])}
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
        <span className="min-w-0 flex-1">{err ? t('check-found-errors-ci-wont') : t('check-some-things-may-break')}</span>
        <button data-testid="check-banner-open" onClick={() => onOpen()} className="flex shrink-0 items-center gap-1 font-normal text-gk-blue hover:underline">
          {tj('all-problems', [<ArrowRight size={12} />])}
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
              {i.line && <span className="shrink-0 font-mono text-[11px] text-gk-dim">{tj('line-2', [i.line])}</span>}
            </button>
          );
        })}
        {top.length > 4 && <div className="text-gk-dim">{tj('and-more-2', [top.length - 4])}</div>}
      </div>
    </div>
  );
}
