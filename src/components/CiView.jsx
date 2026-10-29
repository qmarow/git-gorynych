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
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  ArrowLeft,
  Check,
  RefreshCw,
  Rocket,
  Server,
  Variable,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { relativeTime } from '../lib/format.js';
import { highlight } from '../lib/syntax.jsx';
import GitLabPanel from './GitLabPanel.jsx';
import CiEditor from './ci/CiEditor.jsx';
import JobForm from './ci/JobForm.jsx';
import { ChoiceDialog, DraftBar, DraftDiff, LintPanel } from './ci/DraftTools.jsx';
import CheckView, { CheckBanner, SEVERITY, issueKey } from './ci/CheckView.jsx';
import { kb } from '../lib/platform.js';
import { readable } from '../lib/scheme.js';

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
  { id: 'check', label: 'Проверка', icon: ListChecks },
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
  branches,
  onClose,
  onLocate,
  onForgeChanged,
  onEditLogin,
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
  const [focusIssue, setFocusIssue] = useState(null); // { key, n } — раскрыть проблему на вкладке «Проверка»
  const requested = useRef(0);

  // Редактирование: черновики (путь → текст), отпечатки файлов на момент начала правки
  const [drafts, setDrafts] = useState({});
  const [bases, setBases] = useState({});
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [lint, setLint] = useState(null); // { loading } | { result } | { error }
  const [choice, setChoice] = useState(null); // диалог выбора
  const [jobForm, setJobForm] = useState(null); // { mode: 'create' | 'edit', stage }
  const [editBusy, setEditBusy] = useState(false);
  const draftPaths = Object.keys(drafts);
  const hasDrafts = draftPaths.length > 0;

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

  // Живой предпросмотр: схема и проверки строятся по черновику, пока он не сохранён
  useEffect(() => {
    if (!hasDrafts) {
      setPreview(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const res = await api.repo.ciPreview(repoPath, file ?? state.data?.current?.file ?? null, drafts);
      if (alive && res.ok) setPreview(res.data);
    }, 280);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, repoPath, file, hasDrafts]);

  const baseCurrent = state.data?.current ?? null;
  const current = (hasDrafts && preview?.current) || baseCurrent;
  const systems = state.data?.systems ?? [];

  // Другой файл — сбрасываем выбор
  useEffect(() => {
    setJobId(null);
    setPipelineId(null);
    setFileTab(null);
    setJobForm(null);
    setLint(null);
  }, [baseCurrent?.file]);

  const pipeline = current?.pipelines.find((p) => p.id === pipelineId) ?? current?.pipelines[0] ?? null;
  const allJobs = useMemo(() => (pipeline ? pipeline.stages.flatMap((s) => s.jobs) : []), [pipeline]);
  const job = allJobs.find((j) => j.id === jobId) ?? null;
  const check = current?.check ?? null;
  // Проблемы по заданиям — для значков на схеме и в карточке задания
  const issuesByJob = useMemo(() => {
    const m = new Map();
    for (const i of check?.issues ?? []) if (i.job) m.set(i.job, [...(m.get(i.job) ?? []), i]);
    return m;
  }, [check]);
  const jobIssues = (j) => (j ? [...new Set([...(issuesByJob.get(j.id) ?? []), ...(issuesByJob.get(j.name) ?? []), ...(j.jobId ? issuesByJob.get(j.jobId) ?? [] : [])])] : []);
  const openCheck = (issue) => {
    setMode('check');
    setFocusIssue(issue ? { key: issueKey(issue), n: Date.now() } : null);
  };
  // Задание по имени/id из проблемы
  const selectJobByRef = (ref) => {
    const j = allJobs.find((x) => x.id === ref || x.name === ref || x.jobId === ref);
    setMode('scheme');
    setJobForm(null);
    setJobId(j?.id ?? null);
  };

  /* ---------- Черновики ---------- */

  const diskFile = (path) => baseCurrent?.files.find((x) => x.path === path) ?? null;
  const diskText = (path) => (diskFile(path)?.text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const textOf = (path) => drafts[path] ?? diskText(path);

  const setDraft = (path, text) => {
    const same = text === diskText(path);
    setDrafts((d) => {
      const next = { ...d };
      if (same) delete next[path];
      else next[path] = text;
      return next;
    });
    if (!same) setBases((b) => (path in b ? b : { ...b, [path]: diskFile(path)?.hash ?? null }));
  };

  const dropDrafts = (paths = Object.keys(drafts)) => {
    setDrafts((d) => {
      const next = { ...d };
      for (const p of paths) delete next[p];
      return next;
    });
    setBases((b) => {
      const next = { ...b };
      for (const p of paths) delete next[p];
      return next;
    });
  };

  // Сохранить все черновики. force — записать поверх изменений на диске
  const saveAll = async ({ force = false } = {}) => {
    if (!hasDrafts || saving) return true;
    setSaving(true);
    for (const path of Object.keys(drafts)) {
      const res = await api.repo.ciSave(repoPath, {
        path,
        content: drafts[path],
        baseHash: force || !(path in bases) ? undefined : bases[path],
      });
      if (!res.ok) {
        setSaving(false);
        if (res.error.code === 'CHANGED_ON_DISK') {
          setChoice({
            title: 'Файл изменился на диске',
            text: `${path} поменяли в другом редакторе, пока вы его правили здесь. Что сделать?`,
            choices: [
              { label: 'Отмена', onClick: () => setChoice(null) },
              {
                label: 'Загрузить с диска (мои правки пропадут)',
                danger: true,
                onClick: () => {
                  setChoice(null);
                  dropDrafts([path]);
                  setReloadKey((k) => k + 1);
                },
              },
              {
                label: 'Сохранить поверх',
                primary: true,
                onClick: () => {
                  setChoice(null);
                  saveAll({ force: true });
                },
              },
            ],
          });
        } else notify?.({ type: 'error', title: `Не удалось сохранить ${path}`, hint: res.error.message });
        return false;
      }
      dropDrafts([path]);
    }
    setSaving(false);
    setShowDiff(false);
    notify?.({ type: 'success', title: 'Сохранено', hint: 'Файл появится в изменениях — его можно закоммитить' });
    setReloadKey((k) => k + 1);
    return true;
  };

  const discard = () =>
    setChoice({
      title: 'Отменить правки?',
      text: `Несохранённые изменения в ${draftPaths.join(', ')} пропадут.`,
      choices: [
        { label: 'Нет', onClick: () => setChoice(null) },
        {
          label: 'Отменить правки',
          danger: true,
          onClick: () => {
            setChoice(null);
            dropDrafts();
          },
        },
      ],
    });

  const requestClose = () => {
    if (!hasDrafts) {
      onClose();
      return;
    }
    setChoice({
      title: 'Есть несохранённые правки',
      text: `Изменения в ${draftPaths.join(', ')} ещё не сохранены.`,
      choices: [
        { label: 'Отмена', onClick: () => setChoice(null) },
        {
          label: 'Закрыть без сохранения',
          danger: true,
          onClick: () => {
            setChoice(null);
            onClose();
          },
        },
        {
          label: 'Сохранить и закрыть',
          primary: true,
          onClick: async () => {
            setChoice(null);
            if (await saveAll()) onClose();
          },
        },
      ],
    });
  };

  /* ---------- Визуальные правки (GitLab) ---------- */

  const editable =
    current?.system === 'gitlab' && !current.errors.some((e) => e.severity === 'error' && e.file === current.file);

  // Правки применяются по очереди к тексту файла; результат — новый черновик
  const applyOps = async (ops) => {
    const path = current.file;
    let text = textOf(path);
    const notes = [];
    setEditBusy(true);
    for (const op of ops) {
      const res = await api.repo.ciEdit(text, op);
      if (!res.ok) {
        setEditBusy(false);
        notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
        return false;
      }
      text = res.data.content;
      notes.push(...res.data.notes);
    }
    setDraft(path, text);
    setEditBusy(false);
    if (notes.length) notify?.({ type: 'info', title: 'Заодно обновлено', hint: notes.join('\n') });
    return true;
  };

  /* ---------- Проверка в GitLab ---------- */

  const lintAvailable = isGitlab && forge?.token?.configured && current?.system === 'gitlab';
  const runLint = async () => {
    if (!current) return;
    setLint({ loading: true });
    const res = await api.gitlab.lint(repoPath, { content: textOf(current.file), ref: currentBranch ?? undefined }, { remote: remoteName });
    setLint(res.ok ? { result: res.data } : { error: res.error });
  };

  const showInFile = (path, line) => {
    setMode('file');
    setFileTab(path);
    setJump({ path, line, n: Date.now() });
  };

  // Esc — закрыть форму/детали задания, затем сам просмотр. Ctrl+S — сохранить
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !e.defaultPrevented) {
        if (mode === 'pipelines' || !hasDrafts) return;
        e.preventDefault();
        saveAll();
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.fixed.inset-0')) return;
      if (jobForm) setJobForm(null);
      else if (jobId) setJobId(null);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dirtyPaths = new Set((baseCurrent?.dirty ?? []).map((d) => d.path));
  const currentDirty = baseCurrent?.files.some((f) => dirtyPaths.has(f.path));
  const declaredStages = pipeline ? pipeline.stages.filter((s) => !s.name.startsWith('.')).map((s) => s.name) : [];

  const createFromTemplate = async (system) => {
    const res = await api.repo.ciCreate(repoPath, { system });
    if (!res.ok) {
      notify?.({ type: 'error', title: res.error.message, hint: res.error.hint });
      return;
    }
    notify?.({ type: 'success', title: `Создан ${res.data.path}`, hint: 'Поправьте под свой проект и закоммитьте' });
    setFile(res.data.path);
    setMode('file');
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg">
      {/* Верхняя панель */}
      <div className="glass flex shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3 py-2">
        <Workflow size={16} className="shrink-0" style={{ color: readable(SYSTEM_COLORS[current?.system] ?? '#3cf0a0') }} />
        <div className="shrink-0 text-[13px] font-semibold text-gk-strong">CI/CD</div>
        {current && <div className="shrink-0 text-[12px] text-gk-muted">{current.title}</div>}
        {currentDirty && !hasDrafts && (
          <span
            title="Файл изменён, но изменения ещё не закоммичены — показана версия с диска"
            className="shrink-0 rounded-full bg-gk-yellow/15 px-2 py-0.5 text-[10px] font-medium text-gk-yellow"
          >
            изменён локально
          </span>
        )}

        <div className="flex-1" />

        {lintAvailable && mode !== 'pipelines' && (
          <button
            onClick={runLint}
            disabled={lint?.loading}
            title="Проверить конфигурацию на сервере GitLab (CI Lint) — с учётом шаблонов и include"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-gk-muted transition-colors enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-50"
          >
            {lint?.loading ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Проверить в GitLab
          </button>
        )}
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
              {m.id === 'file' && hasDrafts && <span className="h-1.5 w-1.5 rounded-full bg-gk-yellow" />}
              {m.id === 'check' && check && <CheckBadge stats={check.stats} />}
              {m.id === 'history' && baseCurrent?.history.length > 0 && (
                <span className="text-[10px] text-gk-dim">{baseCurrent.history.length}</span>
              )}
            </button>
          ))}
        </div>
        <IconBtn title="Открыть файл во внешнем редакторе" disabled={!current || mode === 'pipelines'} onClick={() => api.repo.openPath(repoPath, fileTab ?? current.file)}>
          <ExternalLink size={14} />
        </IconBtn>
        <IconBtn title="Перечитать с диска" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw size={14} className={state.loading && state.data ? 'animate-spin' : ''} />
        </IconBtn>
        <IconBtn title="Закрыть (Esc)" onClick={requestClose}>
          <X size={15} />
        </IconBtn>
      </div>

      {/* Файлы CI в репозитории */}
      {mode !== 'pipelines' && systems.length > 0 && (systems.length > 1 || systems[0].files.length > 1) && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gk-border bg-gk-sink/10 px-3 py-1.5">
          {systems.map((sys) =>
            sys.files.map((f) => {
              const active = current?.file === f;
              return (
                <button
                  key={f}
                  title={`${sys.title}: ${f}`}
                  onClick={() => setFile(f)}
                  className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors ${
                    active ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted hover:bg-gk-hover/60 hover:text-gk-text'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SYSTEM_COLORS[sys.id] }} />
                  {f.split('/').pop()}
                  {drafts[f] !== undefined && <span className="text-gk-yellow">●</span>}
                  {sys.files.length === 1 && <span className="text-[10px] text-gk-dim">{sys.title}</span>}
                </button>
              );
            }),
          )}
        </div>
      )}

      {mode !== 'pipelines' && hasDrafts && (
        <DraftBar
          paths={draftPaths}
          saving={saving}
          onSave={() => saveAll()}
          onDiscard={discard}
          onDiff={() => setShowDiff(true)}
          onLint={runLint}
          linting={lint?.loading}
          lintAvailable={lintAvailable}
        />
      )}
      {mode !== 'pipelines' && lint && !lint.loading && (
        <LintPanel
          result={lint.result}
          error={lint.error}
          onClose={() => setLint(null)}
          onShowJob={(name) => {
            setMode('scheme');
            setJobId(name);
          }}
        />
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
            onEditLogin={onEditLogin}
            notify={notify}
            branches={branches}
          />
        ) : state.loading && !state.data ? (
          <Center>
            <Loader2 size={15} className="animate-spin" /> Читаем настройки CI/CD…
          </Center>
        ) : state.error ? (
          <Center className="text-gk-red">{state.error.message}</Center>
        ) : !current ? (
          <NoCi gitlab={isGitlab} onPipelines={() => setMode('pipelines')} onCreate={createFromTemplate} />
        ) : mode === 'check' ? (
          <CheckView
            check={check}
            systemTitle={current.title}
            draft={hasDrafts && Boolean(preview?.current)}
            focus={focusIssue}
            onShowLine={showInFile}
            onSelectJob={selectJobByRef}
          />
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
              onSelectJob={(id) => {
                setJobForm(null);
                setJobId((cur) => (cur === id ? null : id));
              }}
              onShowLine={showInFile}
              check={check}
              jobIssues={jobIssues}
              onOpenCheck={openCheck}
              editable={editable}
              busy={editBusy}
              onAddJob={(stage) => {
                setJobId(null);
                setJobForm({ mode: 'create', stage });
              }}
              onStageOp={(op) => applyOps([op])}
            />
            {jobForm ? (
              <aside className="flex w-[460px] shrink-0 animate-slide-in-right flex-col border-l border-gk-border bg-gk-panel/85 backdrop-blur-xl">
                <div className="flex items-center gap-2 border-b border-gk-border px-4 py-3">
                  <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gk-strong">
                    {jobForm.mode === 'create' ? 'Новое задание' : `Изменить «${job?.name ?? ''}»`}
                  </div>
                  <IconBtn title="Закрыть (Esc)" onClick={() => setJobForm(null)}>
                    <X size={14} />
                  </IconBtn>
                </div>
                <JobForm
                  key={`${jobForm.mode}:${job?.id ?? jobForm.stage}`}
                  mode={jobForm.mode}
                  job={jobForm.mode === 'edit' ? job : null}
                  presetStage={jobForm.stage}
                  stages={declaredStages}
                  allJobs={allJobs}
                  busy={editBusy}
                  onCancel={() => setJobForm(null)}
                  onSubmit={async (ops, newName) => {
                    if (!ops.length) {
                      setJobForm(null);
                      return;
                    }
                    if (await applyOps(ops)) {
                      setJobForm(null);
                      setJobId(newName ?? ops[0].name ?? null);
                    }
                  }}
                  onDelete={async () => {
                    if (await applyOps([{ type: 'deleteJob', name: job.name }])) {
                      setJobForm(null);
                      setJobId(null);
                    }
                  }}
                />
              </aside>
            ) : (
              job && (
                <JobDetails
                  key={job.id}
                  job={job}
                  allJobs={allJobs}
                  onSelectJob={setJobId}
                  onClose={() => setJobId(null)}
                  onShowLine={showInFile}
                  issues={jobIssues(job)}
                  onOpenIssue={openCheck}
                  editState={!editable ? null : job.source === current.file ? 'own' : 'include'}
                  onEdit={() => setJobForm({ mode: 'edit' })}
                />
              )
            )}
          </>
        ) : mode === 'file' ? (
          <FileEditor
            files={current.files}
            active={fileTab ?? current.file}
            onActive={setFileTab}
            jump={jump}
            errors={current.errors}
            issues={check?.issues ?? []}
            gitDirty={dirtyPaths}
            drafts={drafts}
            textOf={textOf}
            onChange={setDraft}
            onSave={() => saveAll()}
          />
        ) : (
          <HistoryView history={baseCurrent?.history ?? []} onLocate={onLocate} />
        )}
      </div>

      {showDiff && <DraftDiff repoPath={repoPath} drafts={drafts} saving={saving} onClose={() => setShowDiff(false)} onSave={() => saveAll()} />}
      {choice && <ChoiceDialog {...choice} onClose={() => setChoice(null)} />}
    </div>
  );
}

/* =================== Схема =================== */

function Scheme({ data, pipeline, onPipeline, selectedJob, onSelectJob, onShowLine, check, jobIssues, onOpenCheck, editable, busy, onAddJob, onStageOp }) {
  const [showVars, setShowVars] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const errors = data.errors.filter((e) => e.severity === 'error');
  const yamlWarnings = data.errors.filter((e) => e.severity !== 'error');

  return (
    <div className="min-w-0 flex-1 overflow-auto">
      <div className="space-y-3 p-4">
        {check && <CheckBanner check={check} onOpen={onOpenCheck} />}
        {!check && errors.length > 0 && (
          <Notice tone="red" icon={CircleX} title="Ошибки в файле — CI, скорее всего, не запустится">
            {errors.map((e, i) => (
              <ProblemLine key={i} problem={e} onShowLine={onShowLine} />
            ))}
          </Notice>
        )}
        {!check && (data.warnings.length > 0 || yamlWarnings.length > 0) && (
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
                      <span className="shrink-0 rounded bg-gk-fg/5 px-1.5 text-[10px] uppercase tracking-wider text-gk-muted">
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
                  p.id === pipeline?.id ? 'bg-gk-blue/20 text-gk-blue ring-1 ring-gk-blue/40' : 'bg-gk-fg/5 text-gk-muted hover:text-gk-text'
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
          <StagesBoard
            pipeline={pipeline}
            jobIssues={jobIssues}
            selectedJob={selectedJob}
            onSelectJob={onSelectJob}
            editable={editable}
            busy={busy}
            onAddJob={onAddJob}
            onStageOp={onStageOp}
          />
        ) : (
          errors.length === 0 && (
            <div className="rounded-lg border border-dashed border-gk-border p-6 text-center text-[13px] text-gk-muted">
              В файле не найдено ни одного задания
              {editable && (
                <button onClick={() => onAddJob('build')} className="ml-2 text-gk-blue hover:underline">
                  Добавить задание
                </button>
              )}
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
                    className="rounded-md border border-gk-border bg-gk-fg/[0.02] px-3 py-2 text-left transition-colors hover:border-gk-fg/20"
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

function StagesBoard({ pipeline, jobIssues, selectedJob, onSelectJob, editable, busy, onAddJob, onStageOp }) {
  const [adding, setAdding] = useState(false);
  const realStages = pipeline.stages.filter((s) => !s.name.startsWith('.'));
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-stretch gap-0">
        {pipeline.stages.map((stage, si) => {
          const idx = realStages.indexOf(stage);
          return (
            <Fragment key={`${stage.name}-${si}`}>
              {si > 0 && (
                <div className="flex w-7 shrink-0 items-start justify-center pt-12 text-gk-dim">
                  <ArrowRight size={14} />
                </div>
              )}
              <div
                className="group/stage flex w-60 shrink-0 animate-slide-up flex-col rounded-lg border border-gk-border bg-gk-fg/[0.02]"
                style={{ animationDelay: `${si * 45}ms` }}
              >
                <StageHeader
                  stage={stage}
                  editable={editable && !stage.name.startsWith('.')}
                  busy={busy}
                  canLeft={idx > 0}
                  canRight={idx !== -1 && idx < realStages.length - 1}
                  onOp={onStageOp}
                />
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {stage.jobs.length === 0 && <div className="px-1 py-2 text-[11px] italic text-gk-dim">нет заданий</div>}
                  {stage.jobs.map((job) => (
                    <JobCard key={job.id} job={job} issues={jobIssues?.(job) ?? []} selected={selectedJob === job.id} onClick={() => onSelectJob(job.id)} />
                  ))}
                  {editable && !stage.name.startsWith('.') && (
                    <button
                      onClick={() => onAddJob(stage.name)}
                      disabled={busy}
                      className="flex items-center justify-center gap-1 rounded-md border border-dashed border-gk-border py-1.5 text-[11.5px] text-gk-dim opacity-0 transition-opacity hover:border-gk-blue/50 hover:text-gk-blue focus:opacity-100 group-hover/stage:opacity-100"
                    >
                      <Plus size={12} /> задание
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {editable && (
          <div className="flex w-44 shrink-0 items-start pl-4 pt-1">
            {adding ? (
              <InlineInput
                placeholder="имя этапа"
                onCancel={() => setAdding(false)}
                onSubmit={(name) => {
                  setAdding(false);
                  onStageOp({ type: 'addStage', name });
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                disabled={busy}
                className="flex items-center gap-1 rounded-md border border-dashed border-gk-border px-3 py-2 text-[12px] text-gk-dim transition-colors hover:border-gk-blue/50 hover:text-gk-blue"
              >
                <Plus size={12} /> Этап
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StageHeader({ stage, editable, busy, canLeft, canRight, onOp }) {
  const [renaming, setRenaming] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  if (renaming) {
    return (
      <div className="border-b border-gk-border px-2 py-1.5">
        <InlineInput
          initial={stage.name}
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            setRenaming(false);
            if (name !== stage.name) onOp({ type: 'renameStage', from: stage.name, to: name });
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 border-b border-gk-border px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gk-muted" title={stage.name}>
        {stage.name}
      </span>
      {stage.undeclared && (
        <span title="Этап не объявлен в stages" className="text-gk-yellow">
          <AlertTriangle size={12} />
        </span>
      )}
      {editable && stage.undeclared && (
        <button
          title="Добавить этап в stages"
          disabled={busy}
          onClick={() => onOp({ type: 'addStage', name: stage.name })}
          className="rounded px-1 text-[10px] text-gk-yellow hover:bg-gk-yellow/15"
        >
          исправить
        </button>
      )}
      {editable && !stage.undeclared && (
        <span className="flex items-center opacity-0 transition-opacity group-hover/stage:opacity-100">
          <MiniBtn title="Переименовать этап" onClick={() => setRenaming(true)} disabled={busy}>
            <Pencil size={11} />
          </MiniBtn>
          <MiniBtn title="Сдвинуть раньше" onClick={() => onOp({ type: 'moveStage', name: stage.name, dir: -1 })} disabled={busy || !canLeft}>
            <ArrowLeft size={11} />
          </MiniBtn>
          <MiniBtn title="Сдвинуть позже" onClick={() => onOp({ type: 'moveStage', name: stage.name, dir: 1 })} disabled={busy || !canRight}>
            <ArrowRight size={11} />
          </MiniBtn>
          <MiniBtn
            title={stage.jobs.length ? 'Сначала перенесите или удалите задания этапа' : armDelete ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить этап'}
            disabled={busy || stage.jobs.length > 0}
            danger={armDelete}
            onClick={() => {
              if (!armDelete) {
                setArmDelete(true);
                setTimeout(() => setArmDelete(false), 3000);
              } else onOp({ type: 'deleteStage', name: stage.name });
            }}
          >
            <Trash2 size={11} />
          </MiniBtn>
        </span>
      )}
      <span className="rounded bg-gk-fg/5 px-1.5 text-[10px] text-gk-dim">{stage.jobs.length}</span>
    </div>
  );
}

function MiniBtn({ children, danger, ...props }) {
  return (
    <button
      {...props}
      className={`flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        danger ? 'bg-gk-red text-white' : 'text-gk-dim enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
      }`}
    >
      {children}
    </button>
  );
}

function InlineInput({ initial = '', placeholder, onSubmit, onCancel }) {
  const [v, setV] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => (v.trim() && v.trim() !== initial ? onSubmit(v.trim()) : onCancel())}
        className="min-w-0 flex-1 rounded bg-gk-bg px-2 py-1 text-[12px] text-gk-text outline-none ring-1 ring-gk-blue"
      />
      <button type="submit" className="rounded p-1 text-gk-green hover:bg-gk-green/15">
        <Check size={12} />
      </button>
    </form>
  );
}

function JobCard({ job, issues = [], selected, onClick }) {
  const errCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const badges = [];
  if (job.manual) badges.push({ icon: Hand, text: 'вручную', cls: 'text-gk-yellow' });
  if (job.kind === 'trigger') badges.push({ icon: Zap, text: job.trigger ? 'запускает другой пайплайн' : 'внешнее', cls: 'text-gk-purple' });
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
          : 'border-gk-border bg-gk-panel/60 hover:-translate-y-px hover:border-gk-fg/20 hover:bg-gk-panel'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${job.manual ? 'bg-gk-yellow' : job.kind === 'trigger' ? 'bg-gk-purple' : 'bg-gk-green'}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gk-text" title={job.name}>
          {job.name}
        </span>
        {(errCount > 0 || warnCount > 0) && (
          <span
            data-testid="job-issues"
            title={issues
              .filter((i) => i.severity !== 'info')
              .map((i) => `• ${i.title}`)
              .join('\n')}
            className={`flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${errCount ? 'bg-gk-red/15 text-gk-red' : 'bg-gk-yellow/15 text-gk-yellow'}`}
          >
            {errCount ? <CircleX size={10} /> : <AlertTriangle size={10} />}
            {errCount || warnCount}
          </span>
        )}
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
            <span key={i} title={b.title} className={`flex items-center gap-1 rounded bg-gk-fg/5 px-1.5 py-px text-[10px] ${b.cls}`}>
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

function JobDetails({ job, allJobs, onSelectJob, onClose, onShowLine, issues = [], onOpenIssue, editState, onEdit }) {
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
          <div className="break-words text-[14px] font-semibold text-gk-strong">{job.name}</div>
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
        {editState === 'own' && (
          <button
            onClick={onEdit}
            className="flex shrink-0 items-center gap-1 rounded-md bg-gk-blue/15 px-2 py-1 text-[12px] text-gk-blue transition-colors hover:bg-gk-blue/25"
          >
            <Pencil size={12} /> Изменить
          </button>
        )}
        <IconBtn title="Закрыть (Esc)" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      </div>
      {editState === 'include' && (
        <div className="border-b border-gk-border bg-gk-fg/[0.02] px-4 py-2 text-[11.5px] text-gk-muted">
          Задание описано в подключаемом файле —{' '}
          <button onClick={() => onShowLine(job.source, job.line)} className="font-mono text-gk-blue hover:underline">
            откройте {job.source}
          </button>
          , чтобы его изменить.
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
        {issues.length > 0 && (
          <div data-testid="job-details-issues" className="space-y-1">
            {issues.map((i) => {
              const S = SEVERITY[i.severity];
              return (
                <button
                  key={issueKey(i)}
                  onClick={() => onOpenIssue?.(i)}
                  title="Открыть на вкладке «Проверка»: когда, как проявится, почему и как исправить"
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${S.bg} hover:brightness-110`}
                >
                  <S.icon size={13} className={`mt-0.5 shrink-0 ${S.text}`} />
                  <span className="min-w-0 flex-1 break-words text-gk-text/90">{i.title}</span>
                  {i.line && <span className="shrink-0 font-mono text-[10.5px] text-gk-dim">стр. {i.line}</span>}
                </button>
              );
            })}
          </div>
        )}
        <Section title="Когда запускается">
          <div className="flex flex-wrap items-center gap-1.5">
            {job.rules?.length > 0 ? (
              <span className="rounded bg-gk-fg/5 px-1.5 py-0.5 text-[11px] text-gk-muted">по правилам ниже</span>
            ) : job.when ? (
              <WhenChip when={job.when} big />
            ) : (
              <span className="rounded bg-gk-fg/5 px-1.5 py-0.5 text-[11px] text-gk-muted">
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
                <li key={i} className="flex items-start gap-2 rounded bg-gk-fg/[0.03] px-2 py-1.5">
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
                      className="rounded bg-gk-fg/5 px-1.5 py-0.5 font-mono text-[11px] text-gk-text enabled:hover:bg-gk-blue/20 enabled:hover:text-gk-blue disabled:text-gk-red"
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
                  {s.inherited && <span className="rounded bg-gk-fg/5 px-1.5">из {s.inherited}</span>}
                </div>
                <Code>
                  {/* Команды не переносим — длинные строки прокручиваются по горизонтали */}
                  <div className="w-max min-w-full">
                    {s.lines.map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="select-none text-gk-dim">$</span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    ))}
                  </div>
                </Code>
              </div>
            ))}
          </Section>
        )}

        {job.steps?.length > 0 && (
          <Section title={`Шаги · ${job.steps.length}`}>
            <ol className="space-y-1.5">
              {job.steps.map((st, i) => (
                <li key={i} className="rounded border border-gk-border bg-gk-fg/[0.02] px-2.5 py-1.5">
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
              <pre className="mt-2 max-h-80 animate-fade-in overflow-auto rounded-md bg-gk-sink/30 p-3 font-mono text-[11px] leading-[1.6]">
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

function FileEditor({ files, active, onActive, jump, errors, issues = [], gitDirty, drafts, textOf, onChange, onSave }) {
  const file = files.find((f) => f.path === active) ?? files[0];
  const lang = /\.ya?ml$/i.test(file?.path ?? '') ? 'yaml' : 'groovy';
  // Ошибки YAML и найденные проверкой проблемы этого файла (кроме советов)
  const problems = useMemo(() => {
    const list = errors.map((e) => ({ file: e.file, line: e.line, message: e.message, severity: e.severity === 'error' ? 'error' : 'warning' }));
    for (const i of issues) {
      if (i.severity === 'info' || i.id === 'yaml-syntax' || i.id === 'yaml-warning') continue;
      list.push({ file: i.file, line: i.line, message: i.title, severity: i.severity });
    }
    return list;
  }, [errors, issues]);
  const errorLines = useMemo(() => {
    const m = new Map();
    for (const e of problems) {
      if (e.file !== file?.path || !e.line) continue;
      const prev = m.get(e.line);
      const tone = e.severity === 'error' || prev?.tone === 'red' ? 'red' : 'yellow';
      m.set(e.line, { text: prev ? `${prev.text}\n${e.message}` : e.message, tone });
    }
    return m;
  }, [problems, file]);
  const [localJump, setLocalJump] = useState(null);
  if (!file) return <Center>Нет файла</Center>;
  const value = textOf(file.path);
  const fileErrors = problems.filter((e) => e.file === file.path || (!e.file && file === files[0]));
  const anyError = fileErrors.some((e) => e.severity === 'error');
  const effJump = [jump, localJump].filter((j) => j && j.path === file.path).sort((a, b) => b.n - a.n)[0] ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gk-border px-3 py-1.5">
        {files.map((f, i) => (
          <button
            key={f.path}
            onClick={() => onActive(f.path)}
            className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-mono text-[11.5px] ${
              f.path === file.path ? 'bg-gk-hover text-gk-strong' : 'text-gk-muted hover:text-gk-text'
            }`}
          >
            {i > 0 && <span className="mr-0.5 font-sans text-[10px] text-gk-dim">include</span>}
            {f.path}
            {drafts[f.path] !== undefined ? (
              <span className="text-gk-yellow" title="Есть несохранённые правки">●</span>
            ) : (
              gitDirty.has(f.path) && <span className="text-gk-muted" title="Изменён, не закоммичен">◦</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <span className="shrink-0 font-sans text-[11px] text-gk-dim">{kb('Tab — отступ · Ctrl+/ — комментарий · Ctrl+S — сохранить')}</span>
      </div>
      <CiEditor
        key={file.path}
        value={value}
        lang={lang}
        errors={errorLines}
        jump={effJump}
        onChange={(text) => onChange(file.path, text)}
        onSave={onSave}
      />
      {fileErrors.length > 0 && (
        <div
          data-testid="file-problems"
          className={`max-h-28 shrink-0 animate-fade-in overflow-y-auto border-t py-1 text-[12px] ${anyError ? 'border-gk-red/30 bg-gk-red/[0.07]' : 'border-gk-yellow/30 bg-gk-yellow/[0.06]'}`}
        >
          {fileErrors.map((e, i) => (
            <button
              key={i}
              onClick={() => e.line && setLocalJump({ path: file.path, line: e.line, n: Date.now() })}
              className="flex w-full items-start gap-2 px-3 py-0.5 text-left hover:bg-gk-fg/5"
            >
              {e.severity === 'error' ? <CircleX size={13} className="mt-0.5 shrink-0 text-gk-red" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-gk-yellow" />}
              {e.line && <span className={`shrink-0 font-mono ${e.severity === 'error' ? 'text-gk-red' : 'text-gk-yellow'}`}>стр. {e.line}</span>}
              <span className="min-w-0 text-gk-text">{e.message}</span>
            </button>
          ))}
        </div>
      )}
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

function NoCi({ gitlab, onPipelines, onCreate }) {
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
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => onCreate('gitlab')} className="flex items-center gap-1.5 rounded-md bg-gk-green/15 px-3 py-1.5 text-[12px] text-gk-green hover:bg-gk-green/25">
            <Plus size={12} /> Создать .gitlab-ci.yml
          </button>
          <button onClick={() => onCreate('github')} className="flex items-center gap-1.5 rounded-md bg-gk-fg/5 px-3 py-1.5 text-[12px] text-gk-text hover:bg-gk-fg/10">
            <Plus size={12} /> Создать GitHub Actions
          </button>
          {gitlab && (
            <button onClick={onPipelines} className="rounded-md bg-gk-blue/15 px-3 py-1.5 text-[12px] text-gk-blue hover:bg-gk-blue/25">
              Посмотреть пайплайны в GitLab
            </button>
          )}
        </div>
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

function CheckBadge({ stats }) {
  if (stats.error) return <span data-testid="check-badge" className="rounded-full bg-gk-red/20 px-1.5 text-[10px] font-semibold text-gk-red">{stats.error}</span>;
  if (stats.warning) return <span data-testid="check-badge" className="rounded-full bg-gk-yellow/20 px-1.5 text-[10px] font-semibold text-gk-yellow">{stats.warning}</span>;
  return <Check data-testid="check-badge" size={11} className="text-gk-green" />;
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
    <div className="animate-fade-in rounded-lg border border-gk-border bg-gk-fg/[0.02] px-3 py-2.5 text-[12px]">
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
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11.5px] text-gk-text/90 [overflow-wrap:anywhere]">
        {typeof v === 'string' ? softBreaks(v) : v}
        {note && <span className="ml-1.5 font-sans text-[11px] text-gk-dim">{note}</span>}
      </span>
    </div>
  );
}

// Мягкие переносы после / _ - . : = , — длинные пути и URL переносятся по смысловым границам,
// а не посреди слова («htm|l»). Совсем длинный кусок без разделителей — overflow-wrap: anywhere
function softBreaks(text) {
  const str = String(text ?? '');
  if (str.length < 24) return str;
  const out = [];
  let buf = '';
  for (const ch of str) {
    buf += ch;
    if ('/_-.:=,&?'.includes(ch)) {
      out.push(buf, <wbr key={out.length} />);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function VariablesTable({ variables }) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-gk-border">
      {variables.map((v) => (
        <div key={v.name} className="flex gap-2 border-b border-gk-border/60 px-2 py-1 last:border-0" title={v.description ?? undefined}>
          <Variable size={11} className="mt-0.5 shrink-0 text-gk-dim" />
          <span className="w-[38%] max-w-40 shrink-0 font-mono text-[11.5px] text-gk-blue [overflow-wrap:anywhere]">{softBreaks(v.name)}</span>
          <span className="min-w-0 flex-1 break-words font-mono text-[11.5px] text-gk-text/85 [overflow-wrap:anywhere]">
            {v.value === '' ? <span className="italic text-gk-dim">пусто</span> : softBreaks(v.value)}
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
          : 'bg-gk-fg/5 text-gk-muted';
  return (
    <span className={`shrink-0 rounded px-1.5 ${big ? 'py-0.5 text-[11px]' : 'text-[10px]'} ${cls}`} title={`when: ${when}`}>
      {WHEN_LABELS[when] ?? when}
    </span>
  );
}

function Code({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-md bg-gk-sink/30 px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.6] text-gk-text/90 ${className}`}>
      {typeof children === 'string' ? <span className="block w-max min-w-full whitespace-pre">{children}</span> : children}
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
