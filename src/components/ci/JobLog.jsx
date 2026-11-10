// Умный просмотр лога задания: ANSI-цвета, сворачиваемые секции (GitLab section_*, GitHub ##[group] / ::group::),
// поиск по логу, «К первой ошибке», живой таймер, повтор / отмена / ручной запуск по возможностям провайдера.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Square,
  TriangleAlert,
  WrapText,
  X,
} from 'lucide-react';
import { parseLog } from '../../lib/ansi.ts';
import { ACTIVE_STATUSES, FAILURE_REASONS, StatusPill } from '../PipelineStatus.jsx';
import { ActionButton, Duration, ErrorNote, IconBtn, usePolling } from './common.jsx';
import { t as tr, tj } from '../../i18n/index.ts';

const api = window.api;

/** Все строки дерева по порядку, с путём из секций (чтобы раскрыть их при переходе к строке) */
function flatten(nodes, path = [], out = []) {
  for (const node of nodes) {
    if (node.type === 'line') out.push({ node, path });
    else {
      out.push({ node, path, header: true });
      flatten(node.children, [...path, node], out);
    }
  }
  return out;
}

const plain = (segs) => segs.map((s) => s.text).join('');

export default function JobLog({ repoPath, opts, job: initialJob, pipelineId, caps, onClose, onAction, providerLabel }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [wrap, setWrap] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Map());
  const [search, setSearch] = useState(null); // строка поиска (null — поле закрыто)
  const [hit, setHit] = useState(0);
  const [flash, setFlash] = useState(null); // номер строки, к которой перешли
  const scrollRef = useRef(null);
  const searchRef = useRef(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    const res = await api.cicd.jobLog(repoPath, initialJob.id, { ...opts, pipelineId });
    setState((prev) => (res.ok ? { loading: false, data: res.data, error: null } : { loading: false, data: prev.data, error: res.error }));
  }, [repoPath, initialJob.id, opts, pipelineId]);

  useEffect(() => {
    load();
  }, [load]);

  const job = { ...initialJob, ...(state.data?.job ?? {}) };
  const running = ACTIVE_STATUSES.has(job.status);
  usePolling(load, state.error ? 0 : running ? 3000 : 0, [load]);

  const tree = useMemo(() => (state.data ? parseLog(state.data.text ?? '') : null), [state.data]);
  const flat = useMemo(() => (tree ? flatten(tree.children) : []), [tree]);
  const firstError = useMemo(() => flat.find((x) => !x.header && x.node.error) ?? null, [flat]);

  const query = (search ?? '').trim().toLowerCase();
  const hits = useMemo(() => (query ? flat.filter((x) => plain(x.header ? x.node.title : x.node.segs).toLowerCase().includes(query)) : []), [flat, query]);
  useEffect(() => setHit(0), [query]);

  // Esc — закрыть поиск, затем назад к пайплайну
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation(); // поиск по логу, а не по графу
        setSearch((s) => s ?? '');
        setTimeout(() => searchRef.current?.select(), 0);
        return;
      }
      if (e.key !== 'Escape' || document.querySelector('.fixed.inset-0')) return;
      e.preventDefault();
      e.stopPropagation();
      if (search !== null) setSearch(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, search]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current && !query) el.scrollTop = el.scrollHeight;
  }, [tree, query]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const isCollapsed = (s) => (collapsed.has(s.key) ? collapsed.get(s.key) : s.collapsed);
  const toggle = (s) => setCollapsed((m) => new Map(m).set(s.key, !isCollapsed(s)));

  /** Раскрыть секции и прокрутить к строке */
  const goTo = useCallback((entry) => {
    if (!entry) return;
    stickToBottom.current = false;
    setCollapsed((m) => {
      const next = new Map(m);
      for (const s of entry.path) next.set(s.key, false);
      return next;
    });
    setFlash(entry.node.n);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`[data-n="${entry.node.n}"]`);
        el?.scrollIntoView({ block: 'center' });
      }),
    );
  }, []);
  useEffect(() => {
    if (hits.length) goTo(hits[Math.min(hit, hits.length - 1)]);
  }, [hit, hits, goTo]);
  useEffect(() => {
    if (flash == null) return undefined;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const copyLog = () => {
    const text = (state.data?.text ?? '')
      .replace(/section_(start|end):\d+:[^\r\n]*?\r?\x1b\[0K/g, '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    navigator.clipboard?.writeText(text);
  };

  const hitSet = useMemo(() => new Set(hits.map((h) => h.node.n)), [hits]);
  const currentHit = hits[Math.min(hit, hits.length - 1)]?.node.n ?? null;
  const shownStatus = job.allowFailure && job.status === 'failed' ? 'warning' : job.status;

  return (
    <div className="absolute inset-0 z-10 flex animate-slide-in-right flex-col bg-[var(--gk-base)] shadow-[-12px_0_30px_-12px_rgba(0,0,0,0.6)]" data-testid="job-log">
      <div className="flex shrink-0 items-center gap-2 border-b border-gk-border bg-[var(--gk-solid-2)] px-3 py-2">
        <IconBtn title={tr('Назад к пайплайну (Esc)')} onClick={onClose}>
          <ArrowLeft size={15} />
        </IconBtn>
        <StatusPill status={shownStatus} />
        <span className="min-w-0 shrink truncate text-[13px] font-semibold text-gk-strong" title={job.name}>
          {job.name}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-gk-dim">
          {job.stage && <span className="truncate">{job.stage}</span>}
          <Duration startedAt={job.startedAt} duration={job.duration} running={running} prefix=" · " />
          {job.runnerName && <span className="truncate"> · {job.runnerName}</span>}
        </span>
        {firstError && (
          <ActionButton icon={TriangleAlert} tone="red" onClick={() => goTo(firstError)} data-testid="log-first-error" data-tip={tr('Прокрутить к первой строке с Error / FAIL / exit code')}>
            {tr('К первой ошибке ↓')}</ActionButton>
        )}
        {job.status === 'manual' && caps?.canPlayManualJob && (
          <ActionButton icon={Play} onClick={() => onAction('job.play', tr('Задание {0} запущено', job.name))}>
            {tr('Запустить')}</ActionButton>
        )}
        {['failed', 'canceled', 'success'].includes(job.status) && (
          <ActionButton icon={RotateCcw} why={caps?.canRerunSingleJob ? null : caps?.why?.canRerunSingleJob ?? tr('Недоступно')} onClick={() => onAction('job.retry', tr('Задание {0} перезапущено', job.name))} data-testid="log-retry">
            {tr('Повторить')}</ActionButton>
        )}
        {running && caps?.canCancelJob && (
          <ActionButton icon={Square} onClick={() => onAction('job.cancel', tr('Задание {0} отменено', job.name))}>
            {tr('Отменить')}</ActionButton>
        )}
        <IconBtn title={tr('Поиск по логу ({0}F)', navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl+')} active={search !== null} onClick={() => setSearch((s) => (s === null ? '' : null))}>
          <Search size={14} />
        </IconBtn>
        <IconBtn title={wrap ? tr('Не переносить строки') : tr('Переносить строки')} onClick={() => setWrap((v) => !v)} active={wrap}>
          <WrapText size={14} />
        </IconBtn>
        <IconBtn title={tr('Скопировать лог')} onClick={copyLog}>
          <Copy size={14} />
        </IconBtn>
        <IconBtn
          title={tr('В конец')}
          onClick={() => {
            stickToBottom.current = true;
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ArrowDownToLine size={14} />
        </IconBtn>
        <IconBtn title={tr('Открыть в {0}', providerLabel ?? tr('браузере'))} onClick={() => (job.logsUrl || job.url) && api.openExternal(job.logsUrl || job.url)}>
          <ExternalLink size={14} />
        </IconBtn>
      </div>

      {search !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-border bg-[var(--gk-solid-2)] px-3 py-1.5" data-testid="log-search">
          <Search size={13} className="text-gk-dim" />
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (hits.length) setHit((h) => (e.shiftKey ? (h - 1 + hits.length) % hits.length : (h + 1) % hits.length));
              }
            }}
            placeholder={tr('Найти в логе…')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-gk-dim"
          />
          <span className="shrink-0 text-[11px] text-gk-dim" data-testid="log-search-count">
            {query ? (hits.length ? tr('{0} из {1}', Math.min(hit, hits.length - 1) + 1, hits.length) : tr('не найдено')) : ''}
          </span>
          <IconBtn title={tr('Предыдущее (Shift+Enter)')} disabled={!hits.length} onClick={() => setHit((h) => (h - 1 + hits.length) % hits.length)}>
            <ChevronUp size={14} />
          </IconBtn>
          <IconBtn title={tr('Следующее (Enter)')} disabled={!hits.length} onClick={() => setHit((h) => (h + 1) % hits.length)}>
            <ChevronDown size={14} />
          </IconBtn>
          <IconBtn title={tr('Закрыть поиск (Esc)')} onClick={() => setSearch(null)}>
            <X size={14} />
          </IconBtn>
        </div>
      )}

      {job.failureReason && job.status === 'failed' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-gk-red/20 bg-gk-red/10 px-4 py-1.5 text-[12px] text-gk-red">
          {tj('{0} Причина: {1}', [<AlertTriangle size={13} />, FAILURE_REASONS[job.failureReason] ?? job.failureReason])}
        </div>
      )}

      {job.steps?.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-gk-border px-3 py-1.5" data-testid="job-steps">
          {job.steps.map((s) => (
            <span key={s.number} className="flex items-center gap-1 rounded bg-gk-fg/[0.04] px-1.5 py-0.5 text-[11px] text-gk-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${s.status === 'success' ? 'bg-gk-green' : s.status === 'failed' ? 'bg-gk-red' : s.status === 'running' ? 'animate-pulse bg-gk-blue' : 'bg-gk-dim'}`} />
              {s.name}
              {s.duration != null && <span className="text-gk-dim">{tj('{0}с', [s.duration])}</span>}
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-[var(--gk-log-bg)] py-2 font-mono text-[12px] leading-[1.6] text-[#d7dae0]"
        data-testid="log-body"
      >
        {state.loading && !state.data && (
          <div className="flex items-center gap-2 px-4 py-6 font-sans text-[13px] text-gk-muted">
            {tj('{0} Загружаем лог…', [<Loader2 size={14} className="animate-spin" />])}</div>
        )}
        {state.error && !state.data && <ErrorNote error={state.error} />}
        {state.data?.truncated && (
          <div className="px-4 pb-2 font-sans text-[11px] text-gk-dim">{tj('Лог большой ({0} КБ) — показан конец. Полностью — на сервере.', [Math.round(state.data.size / 1024)])}</div>
        )}
        {state.data?.unavailable && (
          <div className="px-4 py-6 font-sans text-[13px] text-gk-dim">{tr('Этот сервер не отдаёт логи по API — откройте задание в браузере.')}</div>
        )}
        {tree && tree.children.length === 0 && !state.data?.unavailable && (
          <div className="px-4 py-6 font-sans text-[13px] text-gk-dim">
            {job.status === 'manual' || job.status === 'created' || job.status === 'skipped' ? tr('Задание ещё не запускалось — лога нет') : running ? tr('Ждём вывод раннера…') : tr('Лог пуст')}
          </div>
        )}
        {tree && <LogNodes nodes={tree.children} wrap={wrap} isCollapsed={isCollapsed} toggle={toggle} hitSet={hitSet} current={currentHit} flash={flash} query={query} />}
        {running && tree?.children.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-1 font-sans text-[11px] text-gk-blue">
            {tj('{0} выполняется…', [<Loader2 size={11} className="animate-spin" />])}</div>
        )}
      </div>
    </div>
  );
}

function LogNodes({ nodes, wrap, isCollapsed, toggle, hitSet, current, flash, query }) {
  return nodes.map((node, i) =>
    node.type === 'line' ? (
      <LogLine key={`l${node.n}-${i}`} node={node} wrap={wrap} hit={hitSet.has(node.n)} current={current === node.n} flash={flash === node.n} query={query} />
    ) : (
      <div key={`s${node.key}`}>
        <div
          onClick={() => toggle(node)}
          data-n={node.n}
          data-testid="log-section"
          className={`group flex cursor-pointer hover:bg-gk-fg/[0.04] ${current === node.n ? 'bg-gk-yellow/20' : hitSet.has(node.n) ? 'bg-gk-yellow/[0.08]' : ''}`}
        >
          <span className="w-12 shrink-0 select-none pr-3 text-right text-[#4b5263]">{node.n || ''}</span>
          <span className="flex w-4 shrink-0 items-center text-gk-dim group-hover:text-gk-text">{isCollapsed(node) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
          <span className={`min-w-0 flex-1 pr-4 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
            <Segs segs={node.title} query={query} />
          </span>
          {node.duration != null && <span className="shrink-0 pr-4 font-sans text-[10.5px] text-gk-dim">{tj('{0} с', [node.duration])}</span>}
        </div>
        {!isCollapsed(node) && <LogNodes nodes={node.children} wrap={wrap} isCollapsed={isCollapsed} toggle={toggle} hitSet={hitSet} current={current} flash={flash} query={query} />}
      </div>
    ),
  );
}

function LogLine({ node, wrap, hit, current, flash, query }) {
  return (
    <div
      data-n={node.n}
      data-error={node.error ? 'true' : undefined}
      className={`flex transition-colors ${current || flash ? 'bg-gk-yellow/20' : hit ? 'bg-gk-yellow/[0.08]' : node.error ? 'bg-gk-red/[0.07]' : 'hover:bg-gk-fg/[0.03]'}`}
    >
      <span className={`w-12 shrink-0 select-none pr-3 text-right ${node.error ? 'text-gk-red/70' : 'text-[#4b5263]'}`}>{node.n}</span>
      <span className="w-4 shrink-0" />
      <span className={`min-w-0 flex-1 pr-4 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>{node.segs.length ? <Segs segs={node.segs} query={query} /> : ' '}</span>
    </div>
  );
}

/** Сегменты с цветами; совпадения поиска — подсвечены */
function Segs({ segs, query }) {
  return segs.map((s, i) => {
    const style = s.fg || s.bold || s.italic || s.underline || s.dim
      ? { color: s.fg ?? undefined, fontWeight: s.bold ? 700 : undefined, fontStyle: s.italic ? 'italic' : undefined, textDecoration: s.underline ? 'underline' : undefined, opacity: s.dim ? 0.6 : undefined }
      : undefined;
    if (!query || !s.text.toLowerCase().includes(query)) return <span key={i} style={style}>{s.text}</span>;
    const parts = [];
    const low = s.text.toLowerCase();
    let at = 0;
    let k = 0;
    for (let j = low.indexOf(query); j >= 0; j = low.indexOf(query, j + query.length)) {
      if (j > at) parts.push(<span key={k++}>{s.text.slice(at, j)}</span>);
      parts.push(
        <mark key={k++} className="rounded-sm bg-gk-yellow/60 text-inherit">
          {s.text.slice(j, j + query.length)}
        </mark>,
      );
      at = j + query.length;
    }
    if (at < s.text.length) parts.push(<span key={k++}>{s.text.slice(at)}</span>);
    return (
      <span key={i} style={style}>
        {parts}
      </span>
    );
  });
}
