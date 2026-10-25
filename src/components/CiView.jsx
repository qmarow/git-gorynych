import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
  ExternalLink,
  FileCode,
  Hand,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
  Variable,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { relativeTime } from '../lib/format.js';
import GitLabPanel from './GitLabPanel.jsx';

const api = window.api;

const SYSTEM_COLORS = {
  gitlab: '#fc6d26',
  github: '#8b9cff',
  jenkins: '#d24939',
  bitbucket: '#2684ff',
  circleci: '#3cf0a0',
  azure: '#0a84ff',
  travis: '#cd3f41',
  drone: '#7bc8ff',
  woodpecker: '#4caf50',
};

const WHEN_LABELS = {
  on_success: 'если предыдущие этапы успешны',
  on_failure: 'только если что-то упало',
  always: 'всегда',
  manual: 'вручную',
  delayed: 'с задержкой',
  never: 'не запускать',
};

const MODES = [
  { id: 'scheme', label: 'Схема', icon: Workflow },
  { id: 'file', label: 'Файл', icon: FileCode },
  { id: 'history', label: 'История', icon: History },
  { id: 'pipelines', label: 'Пайплайны', icon: Zap, gitlab: true },
];

/**
 * Просмотр настроек CI/CD из файлов репозитория: схема этапов и заданий, сам файл, история изменений.
 */
export default function CiView({
  repoPath,
  initialFile,
  initialMode,
  initialPipelineId,
  version,
  forge,
  remoteName,
  currentBranch,
  commitsBySha,
  onClose,
  onLocate,
  onForgeChanged,
  notify,
}) {
  const [file, setFile] = useState(initialFile ?? null);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState(initialMode ?? 'scheme');
  const isGitlab = forge?.kind === 'gitlab';
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode, initialPipelineId]);
  const [pipelineId, setPipelineId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [fileTab, setFileTab] = useState(null);
  const [jump, setJump] = useState(null); // { path, line, n } — подсветить строку в файле
  const requested = useRef(0);

  useEffect(() => setFile(initialFile ?? null), [initialFile]);

  // Загрузка; при изменениях в репозитории (version) — тихо перечитываем
  useEffect(() => {
    let alive = true;
    const seq = ++requested.current;
    setState((s) => ({ ...s, loading: !s.data }));
    api.repo.ci(repoPath, file).then((res) => {
      if (!alive || seq !== requested.current) return;
      if (res.ok) setState({ loading: false, data: res.data, error: null });
      else setState({ loading: false, data: null, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [repoPath, file, reloadKey, version]);

  const current = state.data?.current ?? null;
  const systems = state.data?.systems ?? [];

  // Другой файл — сбрасываем выбор
  useEffect(() => {
    setJobId(null);
    setPipelineId(null);
    setFileTab(null);
  }, [current?.file]);

  const pipeline = current?.pipelines.find((p) => p.id === pipelineId) ?? current?.pipelines[0] ?? null;
  const allJobs = useMemo(() => (pipeline ? pipeline.stages.flatMap((s) => s.jobs) : []), [pipeline]);
  const job = allJobs.find((j) => j.id === jobId) ?? null;

  const showInFile = (path, line) => {
    setMode('file');
    setFileTab(path);
    setJump({ path, line, n: Date.now() });
  };

  // Esc — закрыть детали задания, затем сам просмотр
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.fixed.inset-0')) return;
      if (jobId) setJobId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobId, onClose]);

  const dirtyPaths = new Set((current?.dirty ?? []).map((d) => d.path));
  const currentDirty = current?.files.some((f) => dirtyPaths.has(f.path));

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg">
      {/* Верхняя панель */}
      <div className="glass flex shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3 py-2">
        <Workflow size={16} className="shrink-0" style={{ color: SYSTEM_COLORS[current?.system] ?? '#3cf0a0' }} />
        <div className="shrink-0 text-[13px] font-semibold text-white">CI/CD</div>
        {current && <div className="shrink-0 text-[12px] text-gk-muted">{current.title}</div>}
        {currentDirty && (
          <span
            title="Файл изменён, но изменения ещё не закоммичены — показана версия с диска"
            className="shrink-0 rounded-full bg-gk-yellow/15 px-2 py-0.5 text-[10px] font-medium text-gk-yellow"
          >
            изменён локально
          </span>
        )}

        <div className="flex-1" />

        <div className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-gk-border">
          {MODES.filter((m) => !m.gitlab || isGitlab).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={!m.gitlab && !current && !state.loading}
              title={!m.gitlab && !current && !state.loading ? 'В репозитории нет файлов CI/CD' : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors disabled:opacity-35 ${
                mode === m.id ? 'bg-gk-blue/20 text-gk-blue' : 'text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text'
              }`}
            >
              <m.icon size={13} />
              {m.label}
              {m.id === 'history' && current?.history.length > 0 && (
                <span className="text-[10px] text-gk-dim">{current.history.length}</span>
              )}
            </button>
          ))}
        </div>
        <IconBtn title="Открыть файл во внешнем редакторе" disabled={!current || mode === 'pipelines'} onClick={() => api.repo.openPath(repoPath, fileTab ?? current.file)}>
          <ExternalLink size={14} />
        </IconBtn>
        <IconBtn title="Перечитать" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw size={14} className={state.loading && state.data ? 'animate-spin' : ''} />
        </IconBtn>
        <IconBtn title="Закрыть (Esc)" onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>

      {/* Файлы CI в репозитории */}
      {mode !== 'pipelines' && systems.length > 0 && (systems.length > 1 || systems[0].files.length > 1) && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gk-border bg-black/10 px-3 py-1.5">
          {systems.map((sys) =>
            sys.files.map((f) => {
              const active = current?.file === f;
              return (
                <button
                  key={f}
                  title={`${sys.title}: ${f}`}
                  onClick={() => setFile(f)}
                  className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors ${
                    active ? 'bg-gk-hover text-white' : 'text-gk-muted hover:bg-gk-hover/60 hover:text-gk-text'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SYSTEM_COLORS[sys.id] }} />
                  {f.split('/').pop()}
                  {sys.files.length === 1 && <span className="text-[10px] text-gk-dim">{sys.title}</span>}
                </button>
              );
            }),
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {mode === 'pipelines' && isGitlab ? (
          <GitLabPanel
            repoPath={repoPath}
            forge={forge}
            remoteName={remoteName}
            currentBranch={currentBranch}
            commitsBySha={commitsBySha}
            initialPipelineId={initialPipelineId}
            onLocate={onLocate}
            onForgeChanged={onForgeChanged}
            notify={notify}
          />
        ) : state.loading && !state.data ? (
          <Center>
            <Loader2 size={15} className="animate-spin" /> Читаем настройки CI/CD…
          </Center>
        ) : state.error ? (
          <Center className="text-gk-red">{state.error.message}</Center>
        ) : !current ? (
          <NoCi gitlab={isGitlab} onPipelines={() => setMode('pipelines')} />
        ) : mode === 'scheme' ? (
          <>
            <Scheme
              key={current.file}
              data={current}
              pipeline={pipeline}
              onPipeline={(id) => {
                setPipelineId(id);
                setJobId(null);
              }}
              selectedJob={jobId}
              onSelectJob={(id) => setJobId((cur) => (cur === id ? null : id))}
              onShowLine={showInFile}
            />
            {job && (
              <JobDetails
                key={job.id}
                job={job}
                allJobs={allJobs}
                onSelectJob={setJobId}
                onClose={() => setJobId(null)}
                onShowLine={showInFile}
              />
            )}
          </>
        ) : mode === 'file' ? (
          <FileView files={current.files} active={fileTab ?? current.file} onActive={setFileTab} jump={jump} errors={current.errors} dirty={dirtyPaths} />
        ) : (
          <HistoryView history={current.history} onLocate={onLocate} />
        )}
      </div>
    </div>
  );
}

/* =================== Схема =================== */

function Scheme({ data, pipeline, onPipeline, selectedJob, onSelectJob, onShowLine }) {
  const [showVars, setShowVars] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const errors = data.errors.filter((e) => e.severity === 'error');
  const yamlWarnings = data.errors.filter((e) => e.severity !== 'error');

  return (
    <div className="min-w-0 flex-1 overflow-auto">
      <div className="space-y-3 p-4">
        {errors.length > 0 && (
          <Notice tone="red" icon={CircleX} title="Ошибки в файле — CI, скорее всего, не запустится">
            {errors.map((e, i) => (
              <ProblemLine key={i} problem={e} onShowLine={onShowLine} />
            ))}
          </Notice>
        )}
        {(data.warnings.length > 0 || yamlWarnings.length > 0) && (
          <Notice tone="yellow" icon={AlertTriangle} title="На что обратить внимание">
            {data.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
            {yamlWarnings.map((e, i) => (
              <ProblemLine key={`y${i}`} problem={e} onShowLine={onShowLine} />
            ))}
          </Notice>
        )}

        {/* Сводка */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          {data.triggers.length > 0 && (
            <Card title={data.triggersTitle || 'Когда запускается'} icon={Zap}>
              <ul className="space-y-1">
                {data.triggers.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gk-dim" />
                    <span className="min-w-0 break-words font-mono text-[11.5px] text-gk-text/90">{t.text}</span>
                    {t.when && t.when !== 'on_success' && <WhenChip when={t.when} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(data.info.length > 0 || data.variables.length > 0) && (
            <Card title="Параметры" icon={Server}>
              <dl className="space-y-1">
                {data.info.map((row) => (
                  <div key={row.label} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-gk-dim">{row.label}</dt>
                    <dd className="min-w-0 break-all font-mono text-[11.5px] text-gk-text/90">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {data.variables.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowVars((v) => !v)}
                    className="flex items-center gap-1 text-[12px] text-gk-blue hover:underline"
                  >
                    {showVars ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Переменные: {data.variables.length}
                  </button>
                  {showVars && <VariablesTable variables={data.variables} />}
                </div>
              )}
            </Card>
          )}

          {data.includes.length > 0 && (
            <Card title="Подключаемые файлы" icon={Layers}>
              <ul className="space-y-1.5">
                {data.includes.map((inc, i) => (
                  <li key={i}>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-white/5 px-1.5 text-[10px] uppercase tracking-wider text-gk-muted">
                        {inc.type}
                      </span>
                      <span
                        className={`ml-auto shrink-0 text-[10px] ${inc.resolved ? 'text-gk-green' : inc.error ? 'text-gk-red' : 'text-gk-dim'}`}
                        title={inc.resolved ? inc.files?.join('\n') : undefined}
                      >
                        {inc.resolved ? `прочитан${inc.files?.length > 1 ? ` (${inc.files.length})` : ''}` : inc.error ?? 'внешний — не загружается'}
                      </span>
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11.5px] text-gk-text/90">{inc.value}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Несколько пайплайнов (Bitbucket, CircleCI) */}
        {data.pipelines.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-gk-dim">Пайплайн</span>
            {data.pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => onPipeline(p.id)}
                className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                  p.id === pipeline?.id ? 'bg-gk-blue/20 text-gk-blue ring-1 ring-gk-blue/40' : 'bg-white/5 text-gk-muted hover:text-gk-text'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}

        {data.schemeUnsupported ? (
          <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-muted">
            Для {data.title} схема пока не строится — откройте вкладку «Файл».
          </div>
        ) : pipeline && pipeline.stages.length > 0 ? (
          <StagesBoard pipeline={pipeline} selectedJob={selectedJob} onSelectJob={onSelectJob} />
        ) : (
          errors.length === 0 && (
            <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-muted">
              В файле не найдено ни одного задания
            </div>
          )
        )}

        {data.templates.length > 0 && (
          <div>
            <button
              onClick={() => setShowTemplates((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim hover:text-gk-muted"
            >
              {showTemplates ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Шаблоны (скрытые задания) · {data.templates.length}
            </button>
            {showTemplates && (
              <div className="mt-2 grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                {data.templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onShowLine(t.source, t.line)}
                    title="Показать в файле"
                    className="rounded-md border border-gk-border bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-white/20"
                  >
                    <div className="truncate font-mono text-[12px] text-gk-text">{t.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-gk-dim">
                      {t.usedBy.length ? `используют: ${t.usedBy.join(', ')}` : 'нигде не используется через extends'}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-gk-dim">
                      {t.source}
                      {t.line ? `:${t.line}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StagesBoard({ pipeline, selectedJob, onSelectJob }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-stretch gap-0">
        {pipeline.stages.map((stage, si) => (
          <Fragment key={`${stage.name}-${si}`}>
            {si > 0 && (
              <div className="flex w-7 shrink-0 items-start justify-center pt-12 text-gk-dim">
                <ArrowRight size={14} />
              </div>
            )}
            <div
              className="flex w-60 shrink-0 animate-slide-up flex-col rounded-lg border border-gk-border bg-white/[0.02]"
              style={{ animationDelay: `${si * 45}ms` }}
            >
              <div className="flex items-center gap-2 border-b border-gk-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gk-muted" title={stage.name}>
                  {stage.name}
                </span>
                {stage.undeclared && (
                  <span title="Этап не объявлен в stages" className="text-gk-yellow">
                    <AlertTriangle size={12} />
                  </span>
                )}
                <span className="rounded bg-white/5 px-1.5 text-[10px] text-gk-dim">{stage.jobs.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {stage.jobs.length === 0 && <div className="px-1 py-2 text-[11px] italic text-gk-dim">нет заданий</div>}
                {stage.jobs.map((job) => (
                  <JobCard key={job.id} job={job} selected={selectedJob === job.id} onClick={() => onSelectJob(job.id)} />
                ))}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, selected, onClick }) {
  const badges = [];
  if (job.manual) badges.push({ icon: Hand, text: 'вручную', cls: 'text-gk-yellow' });
  if (job.kind === 'trigger') badges.push({ icon: Zap, text: job.trigger ? 'запускает другой пайплайн' : 'внешнее', cls: 'text-[#c084fc]' });
  if (job.environment?.name) badges.push({ icon: Rocket, text: job.environment.name, cls: 'text-gk-green' });
  if (job.allowFailure) badges.push({ icon: AlertTriangle, text: 'может упасть', cls: 'text-gk-muted' });
  if (job.rules?.length) badges.push({ icon: null, text: `правил: ${job.rules.length}`, cls: 'text-gk-muted' });
  if (job.condition) badges.push({ icon: null, text: 'if', cls: 'text-gk-muted', title: job.condition });
  if (job.parallel) badges.push({ icon: null, text: job.parallel.startsWith('×') ? job.parallel : 'matrix', cls: 'text-gk-blue', title: job.parallel });

  const where = job.image ?? job.runsOn;
  return (
    <button
      onClick={onClick}
      className={`group w-full rounded-md border px-2.5 py-2 text-left transition-all duration-200 ${
        selected
          ? 'border-gk-blue/60 bg-gk-blue/10 shadow-lg shadow-gk-blue/10'
          : 'border-gk-border bg-gk-panel/60 hover:-translate-y-px hover:border-white/20 hover:bg-gk-panel'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${job.manual ? 'bg-gk-yellow' : job.kind === 'trigger' ? 'bg-[#c084fc]' : 'bg-gk-green'}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gk-text" title={job.name}>
          {job.name}
        </span>
      </div>
      {where && (
        <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-gk-dim" title={where}>
          <Box size={11} className="shrink-0" />
          <span className="truncate font-mono">{where}</span>
        </div>
      )}
      {job.needs?.length > 0 && (
        <div className="mt-1 truncate text-[11px] text-gk-dim" title={job.needs.map((n) => n.job).join(', ')}>
          после: {job.needs.map((n) => n.job).join(', ')}
        </div>
      )}
      {badges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {badges.map((b, i) => (
            <span key={i} title={b.title} className={`flex items-center gap-1 rounded bg-white/5 px-1.5 py-px text-[10px] ${b.cls}`}>
              {b.icon && <b.icon size={10} />}
              <span className="max-w-[140px] truncate">{b.text}</span>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/* =================== Детали задания =================== */

function JobDetails({ job, allJobs, onSelectJob, onClose, onShowLine }) {
  const [showRaw, setShowRaw] = useState(false);
  const scripts = [
    ['before_script', job.beforeScript],
    ['script', job.script],
    ['after_script', job.afterScript],
  ].filter(([, s]) => s && s.lines.length);

  return (
    <aside className="flex w-[440px] shrink-0 animate-slide-in-right flex-col border-l border-gk-border bg-gk-panel/80 backdrop-blur-xl">
      <div className="flex items-start gap-2 border-b border-gk-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-[14px] font-semibold text-white">{job.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gk-dim">
            {job.stage && <span>этап {job.stage}</span>}
            {job.source && (
              <button onClick={() => onShowLine(job.source, job.line)} className="font-mono text-gk-blue hover:underline">
                {job.source}
                {job.line ? `:${job.line}` : ''}
              </button>
            )}
          </div>
        </div>
        <IconBtn title="Закрыть (Esc)" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
        <Section title="Когда запускается">
          <div className="flex flex-wrap items-center gap-1.5">
            {job.rules?.length > 0 ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gk-muted">по правилам ниже</span>
            ) : job.when ? (
              <WhenChip when={job.when} big />
            ) : (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gk-muted">
                {job.needs?.length ? 'после заданий из «Связи»' : 'автоматически'}
                {job.condition ? ', если выполнено условие' : ''}
              </span>
            )}
            {job.startIn && <span className="text-gk-muted">через {job.startIn}</span>}
            {job.allowFailure && <span className="text-gk-muted">· ошибка не остановит пайплайн</span>}
          </div>
          {job.condition && <Code className="mt-2">if: {job.condition}</Code>}
          {job.rules?.length > 0 && (
            <ol className="mt-2 space-y-1">
              {job.rules.map((r, i) => (
                <li key={i} className="flex items-start gap-2 rounded bg-white/[0.03] px-2 py-1.5">
                  <span className="shrink-0 text-gk-dim">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words font-mono text-[11.5px] text-gk-text/90">{r.text}</span>
                  {r.when && <WhenChip when={r.when} />}
                </li>
              ))}
              <li className="px-2 text-[11px] text-gk-dim">Срабатывает первое подходящее правило; если ни одно не подошло — задание не запускается.</li>
            </ol>
          )}
          {job.only && <KV k="only" v={job.only} />}
          {job.except && <KV k="except" v={job.except} />}
        </Section>

        {(job.image || job.runsOn || job.services?.length > 0 || job.tags?.length > 0) && (
          <Section title="Где выполняется">
            {job.image && (
              <KV
                k="образ"
                v={job.image}
                note={job.imageInherited ? `из ${job.imageInherited === 'default' ? 'default' : 'глобальных настроек'}` : null}
              />
            )}
            {job.runsOn && <KV k="runs-on" v={job.runsOn} />}
            {job.services?.length > 0 && <KV k="сервисы" v={job.services.join(', ')} />}
            {job.tags?.length > 0 && <KV k="теги раннера" v={job.tags.join(', ')} />}
          </Section>
        )}

        {(job.needs?.length > 0 || job.dependencies || job.extends?.length > 0 || job.trigger) && (
          <Section title="Связи">
            {job.needs?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 text-gk-dim">после</span>
                {job.needs.map((n) => {
                  const target = allJobs.find((j) => j.name === n.job);
                  return (
                    <button
                      key={n.job}
                      disabled={!target}
                      onClick={() => target && onSelectJob(target.id)}
                      className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-gk-text enabled:hover:bg-gk-blue/20 enabled:hover:text-gk-blue disabled:text-gk-red"
                      title={target ? 'Перейти к заданию' : 'Такого задания нет'}
                    >
                      {n.job}
                      {n.optional ? ' (опц.)' : ''}
                    </button>
                  );
                })}
              </div>
            )}
            {job.needs && job.needs.length === 0 && <KV k="needs" v="[] — стартует сразу, не дожидаясь этапов" />}
            {job.dependencies && <KV k="артефакты из" v={job.dependencies.join(', ') || '— (не скачивать)'} />}
            {job.extends?.length > 0 && <KV k="наследует" v={job.extends.join(' → ')} />}
            {job.trigger && <KV k="запускает" v={job.trigger} />}
          </Section>
        )}

        {scripts.length > 0 && (
          <Section title="Команды">
            {scripts.map(([label, s]) => (
              <div key={label} className="mb-2">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-gk-dim">
                  <span className="font-mono">{label}</span>
                  {s.inherited && <span className="rounded bg-white/5 px-1.5">из {s.inherited}</span>}
                </div>
                <Code>
                  {s.lines.map((line, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="select-none text-gk-dim">$</span>
                      <span className="min-w-0 whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))}
                </Code>
              </div>
            ))}
          </Section>
        )}

        {job.steps?.length > 0 && (
          <Section title={`Шаги · ${job.steps.length}`}>
            <ol className="space-y-1.5">
              {job.steps.map((st, i) => (
                <li key={i} className="rounded border border-gk-border bg-white/[0.02] px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-right text-[10px] text-gk-dim">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-gk-text" title={st.name}>
                      {st.name}
                    </span>
                    {st.uses && st.uses !== st.name && (
                      <span className="max-w-[180px] shrink-0 truncate rounded bg-gk-blue/10 px-1.5 font-mono text-[10px] text-gk-blue" title={st.uses}>
                        {st.uses}
                      </span>
                    )}
                  </div>
                  {st.condition && <div className="ml-6 mt-1 font-mono text-[10.5px] text-gk-dim">if: {st.condition}</div>}
                  {st.with?.length > 0 && <div className="ml-6 mt-1 font-mono text-[10.5px] text-gk-muted">{st.with.join(' · ')}</div>}
                  {st.run && st.run !== st.name && <Code className="ml-6 mt-1">{st.run}</Code>}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {job.variables?.length > 0 && (
          <Section title="Переменные">
            <VariablesTable variables={job.variables} />
          </Section>
        )}

        {(job.environment || job.artifacts || job.cache) && (
          <Section title="Результат">
            {job.environment && (
              <KV k="окружение" v={`${job.environment.name ?? '?'}${job.environment.action ? ` (${job.environment.action})` : ''}`} note={job.environment.url} />
            )}
            {job.artifacts && (
              <>
                {job.artifacts.paths?.length > 0 && <KV k="артефакты" v={job.artifacts.paths.join(', ')} />}
                {job.artifacts.expire && <KV k="хранятся" v={job.artifacts.expire} />}
                {job.artifacts.reports?.length > 0 && <KV k="отчёты" v={job.artifacts.reports.join(', ')} />}
              </>
            )}
            {job.cache && <KV k="кэш" v={job.cache} />}
          </Section>
        )}

        {(job.timeout || job.retry || job.resourceGroup || job.coverage || job.interruptible != null || job.permissions || job.outputs?.length > 0) && (
          <Section title="Прочее">
            {job.timeout && <KV k="таймаут" v={String(job.timeout)} />}
            {job.retry && <KV k="повторы" v={job.retry} />}
            {job.interruptible != null && <KV k="interruptible" v={String(job.interruptible)} />}
            {job.resourceGroup && <KV k="resource_group" v={job.resourceGroup} />}
            {job.coverage && <KV k="coverage" v={job.coverage} />}
            {job.outputs?.length > 0 && <KV k="outputs" v={job.outputs.join(', ')} />}
            {job.permissions && <KV k="permissions" v={job.permissions} />}
          </Section>
        )}

        {job.raw && (
          <div>
            <button onClick={() => setShowRaw((v) => !v)} className="flex items-center gap-1 text-[11px] text-gk-blue hover:underline">
              {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Итоговая конфигурация задания{job.extends?.length ? ' (с учётом extends)' : ''}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-80 animate-fade-in overflow-auto rounded-md bg-black/30 p-3 font-mono text-[11px] leading-[1.6]">
                {job.raw.split('\n').map((l, i) => (
                  <div key={i}>{highlight(l, 'yaml')}</div>
                ))}
              </pre>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/* =================== Файл =================== */

function FileView({ files, active, onActive, jump, errors, dirty }) {
  const file = files.find((f) => f.path === active) ?? files[0];
  const ref = useRef(null);
  const lang = /\.ya?ml$/i.test(file?.path ?? '') ? 'yaml' : 'groovy';
  const lines = useMemo(() => (file ? file.text.replace(/\r\n/g, '\n').split('\n') : []), [file]);
  const errorLines = useMemo(() => {
    const m = new Map();
    for (const e of errors) if (e.file === file?.path && e.line) m.set(e.line, e.message);
    return m;
  }, [errors, file]);
  const target = jump && jump.path === file?.path ? jump.line : null;

  useEffect(() => {
    if (!target) return;
    ref.current?.querySelector(`[data-line="${target}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [target, jump?.n]);

  if (!file) return <Center>Нет файла</Center>;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {files.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gk-border px-3 py-1.5">
          {files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => onActive(f.path)}
              className={`shrink-0 rounded px-2 py-0.5 font-mono text-[11.5px] ${
                f.path === file.path ? 'bg-gk-hover text-white' : 'text-gk-muted hover:text-gk-text'
              }`}
            >
              {i > 0 && <span className="mr-1 font-sans text-[10px] text-gk-dim">include</span>}
              {f.path}
              {dirty.has(f.path) && <span className="ml-1 text-gk-yellow">●</span>}
            </button>
          ))}
        </div>
      )}
      <div ref={ref} className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[12.5px] leading-[1.65] [tab-size:2]">
        {lines.map((line, i) => {
          const n = i + 1;
          const err = errorLines.get(n);
          return (
            <div
              key={i}
              data-line={n}
              title={err}
              className={`flex min-w-max ${n === target ? 'animate-fade-in bg-gk-blue/15' : err ? 'bg-gk-red/10' : 'hover:bg-white/[0.02]'}`}
            >
              <span className={`w-12 shrink-0 select-none pr-3 text-right ${err ? 'text-gk-red' : 'text-gk-dim'}`}>{n}</span>
              <span className="whitespace-pre pr-6 text-gk-text/90">{highlight(line, lang) || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =================== История =================== */

function HistoryView({ history, onLocate }) {
  if (!history.length) return <Center>Файлы CI/CD ещё ни разу не коммитились</Center>;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 text-[12px] text-gk-dim">Коммиты, в которых менялись настройки CI/CD. Клик — показать коммит в графе.</div>
      <ol className="relative space-y-1 border-l border-gk-border pl-4">
        {history.map((c, i) => (
          <li key={c.hash} className="animate-slide-up" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
            <button
              onClick={() => onLocate(c.hash)}
              className="group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-gk-hover"
            >
              <span className="absolute -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-gk-bg bg-gk-blue" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gk-text">{c.message}</span>
              <span className="shrink-0 text-[11px] text-gk-muted">{c.author}</span>
              <span className="flex w-24 shrink-0 items-center justify-end gap-1 text-[11px] text-gk-dim">
                <Clock size={10} />
                {relativeTime(c.date)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-gk-blue/80 group-hover:text-gk-blue">{c.hash.slice(0, 7)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* =================== Мелочи =================== */

function NoCi({ gitlab, onPipelines }) {
  return (
    <Center>
      <div className="max-w-md text-center">
        <Workflow size={28} className="mx-auto mb-3 text-gk-dim" />
        <div className="text-[14px] text-gk-text">В репозитории нет настроек CI/CD</div>
        <div className="mt-2 text-[12px] leading-relaxed text-gk-dim">
          Ищем файлы: <span className="font-mono">.gitlab-ci.yml</span>, <span className="font-mono">.github/workflows/*.yml</span>,{' '}
          <span className="font-mono">Jenkinsfile</span>, <span className="font-mono">bitbucket-pipelines.yml</span>,{' '}
          <span className="font-mono">.circleci/config.yml</span>, <span className="font-mono">azure-pipelines.yml</span> и другие.
        </div>
        {gitlab && (
          <button onClick={onPipelines} className="mt-4 rounded-md bg-gk-blue/15 px-3 py-1.5 text-[12px] text-gk-blue hover:bg-gk-blue/25">
            Посмотреть пайплайны в GitLab
          </button>
        )}
      </div>
    </Center>
  );
}

function ProblemLine({ problem, onShowLine }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 break-words">{problem.message}</span>
      {problem.line && (
        <button onClick={() => onShowLine(problem.file, problem.line)} className="shrink-0 font-mono text-[11px] underline-offset-2 hover:underline">
          {problem.file}:{problem.line}
        </button>
      )}
    </div>
  );
}

function Notice({ tone, icon: Icon, title, children }) {
  const cls = tone === 'red' ? 'border-gk-red/30 bg-gk-red/10 text-gk-red' : 'border-gk-yellow/30 bg-gk-yellow/[0.07] text-gk-yellow';
  return (
    <div className={`animate-fade-in rounded-lg border px-3 py-2.5 text-[12px] ${cls}`}>
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Icon size={14} /> {title}
      </div>
      <div className="space-y-1 pl-6 text-gk-text/85">{children}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="animate-fade-in rounded-lg border border-gk-border bg-white/[0.02] px-3 py-2.5 text-[12px]">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gk-dim">
        <Icon size={12} /> {title}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-gk-dim">{title}</div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({ k, v, note }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-gk-dim">{k}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11.5px] text-gk-text/90">
        {v}
        {note && <span className="ml-1.5 font-sans text-[11px] text-gk-dim">{note}</span>}
      </span>
    </div>
  );
}

function VariablesTable({ variables }) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-gk-border">
      {variables.map((v) => (
        <div key={v.name} className="flex gap-2 border-b border-gk-border/60 px-2 py-1 last:border-0" title={v.description ?? undefined}>
          <Variable size={11} className="mt-0.5 shrink-0 text-gk-dim" />
          <span className="w-40 shrink-0 truncate font-mono text-[11.5px] text-gk-blue">{v.name}</span>
          <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-gk-text/85">
            {v.value === '' ? <span className="italic text-gk-dim">пусто</span> : v.value}
            {v.description && <span className="ml-1.5 font-sans text-[11px] text-gk-dim">— {v.description}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function WhenChip({ when, big }) {
  const cls =
    when === 'manual'
      ? 'bg-gk-yellow/15 text-gk-yellow'
      : when === 'never'
        ? 'bg-gk-red/15 text-gk-red'
        : when === 'always'
          ? 'bg-gk-blue/15 text-gk-blue'
          : 'bg-white/5 text-gk-muted';
  return (
    <span className={`shrink-0 rounded px-1.5 ${big ? 'py-0.5 text-[11px]' : 'text-[10px]'} ${cls}`} title={`when: ${when}`}>
      {WHEN_LABELS[when] ?? when}
    </span>
  );
}

function Code({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-md bg-black/30 px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.6] text-gk-text/90 ${className}`}>
      {typeof children === 'string' ? <span className="whitespace-pre-wrap break-all">{children}</span> : children}
    </div>
  );
}

function Center({ children, className = '' }) {
  return <div className={`flex flex-1 items-center justify-center gap-2 p-6 text-[13px] text-gk-muted ${className}`}>{children}</div>;
}

function IconBtn({ children, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/* =================== Подсветка синтаксиса (минимальная) =================== */

const T = {
  comment: 'text-gk-dim italic',
  key: 'text-[#7ab8ff]',
  string: 'text-[#9be29b]',
  number: 'text-[#f5b971]',
  keyword: 'text-[#c792ea]',
  variable: 'text-[#ffcb6b]',
  anchor: 'text-[#c792ea]',
  punct: 'text-gk-dim',
};

function tokenizeValue(text, out, keyPrefix) {
  // Строки в кавычках, переменные $VAR / ${{ }}, якоря/теги, числа и булевы
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')|(\$\{\{[^}]*\}\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)|([&*][\w-]+|![\w-]+)|(\b(?:true|false|null|yes|no|on|off)\b|\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = m[1] ? T.string : m[2] ? T.variable : m[3] ? T.anchor : T.number;
    out.push(
      <span key={`${keyPrefix}-${k++}`} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
}

function highlight(line, lang) {
  if (!line) return line;
  const out = [];
  if (lang === 'yaml') {
    // Комментарий: # в начале или после пробела, не внутри кавычек (приблизительно)
    let code = line;
    let comment = '';
    const cm = /(^|\s)#/.exec(line);
    if (cm && !/["'][^"']*#/.test(line.slice(0, cm.index + cm[0].length))) {
      code = line.slice(0, cm.index + cm[1].length);
      comment = line.slice(cm.index + cm[1].length);
    }
    const km = /^(\s*(?:-\s+)?)([^\s#'"][^:#]*?|"[^"]*"|'[^']*')(:)(?=\s|$)/.exec(code);
    if (km) {
      out.push(
        <span key="d" className={T.punct}>
          {km[1]}
        </span>,
      );
      out.push(
        <span key="k" className={T.key}>
          {km[2]}
        </span>,
      );
      out.push(
        <span key="c" className={T.punct}>
          :
        </span>,
      );
      tokenizeValue(code.slice(km[0].length), out, 'v');
    } else {
      const dm = /^(\s*-\s)/.exec(code);
      if (dm) {
        out.push(
          <span key="d" className={T.punct}>
            {dm[1]}
          </span>,
        );
        tokenizeValue(code.slice(dm[1].length), out, 'v');
      } else tokenizeValue(code, out, 'v');
    }
    if (comment)
      out.push(
        <span key="cm" className={T.comment}>
          {comment}
        </span>,
      );
    return out;
  }
  // Groovy / Jenkinsfile
  const cm = line.indexOf('//');
  const code = cm >= 0 ? line.slice(0, cm) : line;
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(pipeline|agent|stages?|steps|parallel|post|when|environment|options|triggers|tools|parameters|script|node|def|if|else|always|success|failure|input|sh|bat|echo)\b/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    out.push(
      <span key={k++} className={m[1] ? T.string : T.keyword}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  if (cm >= 0)
    out.push(
      <span key="cm" className={T.comment}>
        {line.slice(cm)}
      </span>,
    );
  return out;
}
