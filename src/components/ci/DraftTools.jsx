import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleX, FileDiff, Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { UnifiedDiff } from '../DiffView.jsx';
import { inlineHighlights } from '../../lib/inlineDiff.js';
import { detectLanguage, highlightHunks } from '../../lib/highlight.js';
import { kb } from '../../lib/platform.js';

const api = window.api;

/** Панель над редактором/схемой: есть несохранённые правки */
export function DraftBar({ paths, saving, onSave, onDiscard, onDiff, onLint, linting, lintAvailable }) {
  return (
    <div className="flex shrink-0 animate-fade-in items-center gap-2 border-b border-gk-yellow/25 bg-gk-yellow/[0.07] px-3 py-1.5 text-[12px]">
      <span className="h-2 w-2 shrink-0 rounded-full bg-gk-yellow shadow-[0_0_8px] shadow-gk-yellow/60" />
      <span className="min-w-0 flex-1 truncate text-gk-text">
        Не сохранено: <span className="font-mono text-gk-yellow">{paths.join(', ')}</span>
        <span className="ml-2 text-gk-dim">схема уже показывает черновик</span>
      </span>
      {lintAvailable && (
        <BarButton onClick={onLint} disabled={linting} title="Проверить черновик на сервере GitLab (CI Lint)">
          {linting ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Проверить в GitLab
        </BarButton>
      )}
      <BarButton onClick={onDiff} title="Что изменится в файле">
        <FileDiff size={12} /> Изменения
      </BarButton>
      <BarButton onClick={onDiscard} title="Вернуть файл как на диске">
        <X size={12} /> Отменить правки
      </BarButton>
      <button
        onClick={onSave}
        disabled={saving}
        title={kb('Сохранить (Ctrl+S)')}
        className="flex items-center gap-1.5 rounded-md bg-gk-green px-2.5 py-1 font-semibold text-gk-ink transition hover:brightness-110 disabled:opacity-50"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Сохранить
      </button>
    </div>
  );
}

function BarButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-gk-muted transition-colors enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Окно «что изменится»: diff файла на диске и черновика */
export function DraftDiff({ repoPath, drafts, onClose, onSave, saving }) {
  const [state, setState] = useState({ loading: true, items: [] });
  useEffect(() => {
    let alive = true;
    Promise.all(Object.entries(drafts).map(([path, content]) => api.repo.ciDiff(repoPath, { path, content }))).then((res) => {
      if (alive) setState({ loading: false, items: res.map((r) => (r.ok ? r.data : { error: r.error })) });
    });
    return () => {
      alive = false;
    };
  }, [repoPath, drafts]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[6vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong flex max-h-[84vh] w-[900px] max-w-[calc(100vw-2rem)] animate-pop-in flex-col overflow-hidden rounded-xl border border-gk-border bg-gk-panel-2">
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-border px-4 py-3">
          <FileDiff size={16} className="text-gk-blue" />
          <h2 className="flex-1 text-[14px] font-semibold text-gk-strong">Что изменится</h2>
          <button onClick={onClose} className="rounded p-1 text-gk-dim hover:bg-gk-hover hover:text-gk-text">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
          {state.loading ? (
            <div className="flex items-center gap-2 p-6 font-sans text-[13px] text-gk-muted">
              <Loader2 size={14} className="animate-spin" /> Сравниваем…
            </div>
          ) : (
            state.items.map((item, i) => <DiffBlock key={item.path ?? i} item={item} />)
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gk-border px-4 py-2.5">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[12.5px] text-gk-muted hover:bg-gk-hover hover:text-gk-text">
            Продолжить правку
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-gk-green px-3 py-1.5 text-[12.5px] font-semibold text-gk-ink hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffBlock({ item }) {
  const highlights = useMemo(() => (item.hunks ? item.hunks.map((h) => inlineHighlights(h.lines)) : null), [item]);
  const syntax = useMemo(() => (item.hunks ? highlightHunks(item.hunks, detectLanguage(item.path)) : null), [item]);
  if (item.error) return <div className="p-4 font-sans text-[12.5px] text-gk-red">{item.error.message}</div>;
  return (
    <div className="border-b border-gk-border last:border-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gk-border bg-gk-panel-2 px-4 py-1.5 font-sans text-[12px]">
        <span className="font-mono text-gk-text">{item.path}</span>
        <span className="text-gk-green">+{item.additions}</span>
        <span className="text-gk-red">−{item.deletions}</span>
      </div>
      {item.hunks.length === 0 ? (
        <div className="px-4 py-3 font-sans text-[12px] text-gk-dim">Нет изменений</div>
      ) : (
        <UnifiedDiff hunks={item.hunks} highlights={highlights} syntax={syntax} />
      )}
    </div>
  );
}

/** Результат GitLab CI Lint */
export function LintPanel({ result, error, onClose, onShowJob }) {
  if (!result && !error) return null;
  return (
    <div className={`shrink-0 animate-fade-in border-b px-4 py-2.5 text-[12px] ${error || !result?.valid ? 'border-gk-red/25 bg-gk-red/[0.06]' : 'border-gk-green/25 bg-gk-green/[0.06]'}`}>
      <div className="flex items-start gap-2">
        {error ? (
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-yellow" />
        ) : result.valid ? (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-gk-green" />
        ) : (
          <CircleX size={14} className="mt-0.5 shrink-0 text-gk-red" />
        )}
        <div className="min-w-0 flex-1">
          {error ? (
            <>
              <div className="font-medium text-gk-text">Проверка в GitLab не удалась: {error.message}</div>
              {error.hint && <div className="mt-0.5 text-gk-muted">{error.hint}</div>}
            </>
          ) : (
            <>
              <div className="font-medium text-gk-text">
                {result.valid ? 'GitLab принял конфигурацию' : 'GitLab нашёл ошибки'}
                {result.ref && <span className="ml-1.5 font-normal text-gk-muted">· для ветки {result.ref}</span>}
              </div>
              {result.errors.map((e, i) => (
                <div key={i} className="mt-1 text-gk-red">
                  {e}
                </div>
              ))}
              {result.warnings.map((w, i) => (
                <div key={`w${i}`} className="mt-1 text-gk-yellow">
                  {w}
                </div>
              ))}
              {result.valid && result.jobs.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-gk-muted">Запустятся:</span>
                  {result.jobs.map((j) => (
                    <button
                      key={`${j.stage}:${j.name}`}
                      onClick={() => onShowJob?.(j.name)}
                      title={`этап ${j.stage}${j.when !== 'on_success' ? ` · ${j.when}` : ''}`}
                      className={`rounded px-1.5 py-px font-mono text-[11px] ${j.when === 'manual' ? 'bg-gk-yellow/15 text-gk-yellow' : 'bg-gk-fg/5 text-gk-text'} hover:bg-gk-fg/10`}
                    >
                      {j.name}
                    </button>
                  ))}
                </div>
              )}
              {result.valid && result.jobs.length === 0 && <div className="mt-1 text-gk-muted">Для этой ветки ни одно задание не запустится.</div>}
              {result.includes.length > 0 && (
                <div className="mt-1 text-[11px] text-gk-dim">
                  Учтены подключаемые файлы: {result.includes.map((i) => i.location).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
        <button onClick={onClose} className="rounded p-0.5 text-gk-dim hover:bg-gk-fg/10 hover:text-gk-text">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

/** Диалог при сохранении, если файл поменяли снаружи, и при закрытии с несохранёнными правками */
export function ChoiceDialog({ title, text, choices, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-gk-scrim pt-[16vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong w-[460px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-gk-border bg-gk-panel-2 p-4">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-gk-strong">
          <AlertTriangle size={16} className="text-gk-yellow" /> {title}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gk-muted">{text}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {choices.map((c) => (
            <button
              key={c.label}
              onClick={c.onClick}
              className={`rounded-md px-3 py-1.5 text-[12.5px] transition ${
                c.primary
                  ? 'bg-gk-green font-semibold text-gk-ink hover:brightness-110'
                  : c.danger
                    ? 'bg-gk-red/90 font-semibold text-white hover:bg-gk-red'
                    : 'bg-gk-hover text-gk-text hover:bg-gk-fg/10'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
