import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, CaseSensitive, ChevronDown, ChevronUp, CodeXml, Columns2, Diff, FileText, FoldVertical, Highlighter, Loader2, Pencil, Regex, Rows3, Save, Search, Space, UnfoldVertical, X } from 'lucide-react';
import { FILE_STATUS } from '../lib/format.ts';
import { inlineHighlights } from '../lib/inlineDiff.ts';
import { detectLanguage, findAll, highlightHunks, languageName, layerLine, searchRegex } from '../lib/highlight.ts';
import { isMod, kb } from '../lib/platform.ts';
import { readable } from '../lib/scheme.ts';
import { t as tr, tj } from '../i18n/index.ts';
import FileEditor from './FileEditor.jsx';
import { ConfirmDialog } from './Dialogs.jsx';

const writePref = (key, on) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* не страшно */
  }
};

// Поиск переносится между файлами: открыли следующий файл — строка поиска остаётся
let lastSearch = null;

// Несохранённые правки редактора, если окно изменений закрылось без вопроса (другой файл выбран в списке, сменилась вкладка):
// ключ — editor.key (репозиторий и путь), значение — { text, hash } той версии, с которой начиналась правка.
// При следующем открытии того же файла правки возвращаются; если файл с тех пор изменился, сохранение покажет CHANGED_ON_DISK
const editDrafts = new Map();
const MAX_HITS = 5000;

const readPref = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
};

const MODE_LABELS = {
  commit: (t) => (t.kind === 'compare' ? `${t.parent.slice(0, 7)} → ${t.hash.slice(0, 7)}` : t.kind === 'stash' ? (t.stashId ?? 'stash') : tr('коммит {0}', t.hash.slice(0, 7))),
  staged: () => 'staged',
  unstaged: () => 'unstaged',
  untracked: () => tr('новый файл'),
};

export default function DiffView({
  target,
  data,
  view,
  ignoreWhitespace,
  onViewChange,
  onToggleWhitespace,
  onPrev,
  onNext,
  onClose,
  hunkActions,
  onHunkAction,
  fileActions,
  guardMarkers,
  initialSearch,
  fullFile = false,
  onToggleFullFile,
  editor,
}) {
  const [hunkBusy, setHunkBusy] = useState(null);
  // Действия с фрагментом (stage / отменить …) — только когда фрагменты считаются по точному тексту и не на весь файл
  const actions = ignoreWhitespace || fullFile ? null : hunkActions?.length ? hunkActions : null;
  const runHunk = async (action, hunk, index) => {
    setHunkBusy(`${action.id}:${index}`);
    try {
      await onHunkAction(action.id, hunk);
    } finally {
      setHunkBusy(null);
    }
  };
  const hunkProps = actions ? { actions, busy: hunkBusy, onRun: runHunk } : null;

  /* ---------- Редактирование файла рабочей копии (нового в 2.0) ---------- */
  // edit: null — просмотр diff; { loading } — файл читается; { loadError } — не открылся;
  // { text, base, hash, eol, mixedEol, saving, error, savedAt } — открыт: base — текст последней сохранённой версии
  const [edit, setEdit] = useState(null);
  const [caret, setCaret] = useState(null);
  const [leaveGuard, setLeaveGuard] = useState(null); // () => void — что сделать после «Закрыть без сохранения»
  const editing = Boolean(edit);
  const dirty = Boolean(edit && edit.text !== undefined && edit.text !== edit.base);
  const opened = (file) => ({ text: file.text, base: file.text, hash: file.hash, eol: file.eol, mixedEol: file.mixedEol });

  const openEditor = async () => {
    setEdit({ loading: true });
    const res = await editor.read();
    if (!res.ok) {
      setEdit({ loadError: res.error });
      return;
    }
    const draft = editDrafts.get(editor.key);
    // Черновик с отпечатком своей исходной версии: base — текст на диске, поэтому правки видны как несохранённые
    setEdit(draft ? { ...opened(res.data), text: draft.text, hash: draft.hash, restored: true } : opened(res.data));
  };
  // Окно закрылось с несохранёнными правками — запомнить их; сохранили или закрыли без сохранения — забыть
  const editRef = useRef(null);
  editRef.current = edit;
  useEffect(
    () => () => {
      const e = editRef.current;
      if (editor?.key && e && e.text !== undefined && e.text !== e.base) editDrafts.set(editor.key, { text: e.text, hash: e.hash });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const reloadEditor = async () => {
    editDrafts.delete(editor.key);
    const res = await editor.read();
    setEdit((e) => (res.ok ? opened(res.data) : { ...e, error: res.error }));
  };
  // overwrite — «Сохранить поверх»: отпечаток берётся у того, что сейчас на диске
  const saveEditor = async (overwrite = false) => {
    if (!edit || edit.text === undefined || edit.saving) return;
    const text = edit.text;
    let hash = edit.hash;
    setEdit((e) => ({ ...e, saving: true, error: null }));
    if (overwrite) {
      const fresh = await editor.read();
      if (!fresh.ok) {
        setEdit((e) => ({ ...e, saving: false, error: fresh.error }));
        return;
      }
      hash = fresh.data.hash;
    }
    const res = await editor.save(text, hash);
    setEdit((e) => (res.ok ? { ...e, saving: false, error: null, hash: res.data.hash, base: text, savedAt: Date.now(), restored: false } : { ...e, saving: false, error: res.error }));
    if (res.ok) {
      editDrafts.delete(editor.key);
      editor.saved?.();
    }
  };
  // Несохранённые правки не теряются молча: закрыть редактор, перейти к другому файлу или закрыть diff — только после вопроса
  const guarded = (fn) => (...args) => (dirty ? setLeaveGuard(() => () => fn(...args)) : fn(...args));
  const closeEditor = guarded(() => {
    editDrafts.delete(editor.key);
    setEdit(null);
    setCaret(null);
  });
  const close = guarded(onClose);
  const prev = onPrev && guarded(onPrev);
  const next = onNext && guarded(onNext);

  const [inline, setInline] = useState(() => readPref('diff.inline', true));
  const scrollRef = useRef(null);
  const [current, setCurrent] = useState(-1); // текущий фрагмент изменений для навигации

  // Подсветка изменений внутри строк — для каждого фрагмента (hunk) своя карта
  const highlights = useMemo(
    () => (inline && data?.hunks ? data.hunks.map((h) => inlineHighlights(h.lines)) : null),
    [inline, data],
  );

  // Блоки изменений (подряд идущие +/−) — по ним ходим кнопками и F7
  const changeCount = useMemo(() => {
    if (!data?.hunks) return 0;
    let n = 0;
    for (const h of data.hunks) {
      let prev = ' ';
      for (const l of h.lines) {
        if ((l.t === '+' || l.t === '-') && prev !== '+' && prev !== '-') n++;
        prev = l.t;
      }
    }
    return n;
  }, [data]);

  useEffect(() => setCurrent(-1), [data]);

  const goChange = (dir) => {
    const blocks = [...(scrollRef.current?.querySelectorAll('[data-change]') ?? [])];
    if (!blocks.length) return;
    const next = current === -1 ? (dir > 0 ? 0 : blocks.length - 1) : (current + dir + blocks.length) % blocks.length;
    setCurrent(next);
    blocks[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
    blocks[next].animate?.([{ backgroundColor: 'rgb(47 155 255 / 0.35)' }, { backgroundColor: 'transparent' }], { duration: 900 });
  };

  const toggleInline = () =>
    setInline((v) => {
      writePref('diff.inline', !v);
      return !v;
    });

  /* ---------- Подсветка синтаксиса: сначала текст, цвета — следом (не задерживает открытие файла) ---------- */
  const [syntaxOn, setSyntaxOn] = useState(() => readPref('diff.syntax', true));
  const lang = useMemo(() => detectLanguage(target.file.path), [target.file.path]);
  const [syntax, setSyntax] = useState(null);
  useEffect(() => {
    setSyntax(null);
    if (!syntaxOn || !lang || !data?.hunks?.length) return undefined;
    let alive = true;
    const timer = setTimeout(() => alive && setSyntax(highlightHunks(data.hunks, lang)), 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [syntaxOn, lang, data]);
  const toggleSyntax = () =>
    setSyntaxOn((v) => {
      writePref('diff.syntax', !v);
      return !v;
    });

  /* ---------- Поиск в изменениях (Ctrl+F) ---------- */
  const [search, setSearch] = useState(() => {
    const init = initialSearch ?? (lastSearch?.open ? lastSearch : null);
    return { open: Boolean(init), query: init?.query ?? '', caseSensitive: Boolean(init?.caseSensitive), regex: Boolean(init?.regex), changedOnly: Boolean(init?.changedOnly) };
  });
  const [hitIndex, setHitIndex] = useState(0);
  const jumpLine = useRef(initialSearch?.line ?? null); // открыли из поиска по сравнению — к этой строке
  const searchInput = useRef(null);
  useEffect(() => {
    lastSearch = search;
  }, [search]);
  const patchSearch = (p) => setSearch((s) => ({ ...s, ...p }));
  const openSearch = () => {
    patchSearch({ open: true });
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  };
  const closeSearch = () => patchSearch({ open: false });

  const { re: searchRe, error: searchError } = useMemo(
    () => (search.open ? searchRegex(search.query, search) : { re: null }),
    [search],
  );
  const hits = useMemo(() => {
    const out = [];
    if (!searchRe || !data?.hunks) return out;
    outer: for (let hi = 0; hi < data.hunks.length; hi++) {
      const lines = data.hunks[hi].lines;
      for (let li = 0; li < lines.length; li++) {
        const l = lines[li];
        if (l.t === '\\' || (search.changedOnly && l.t === ' ')) continue;
        for (const m of findAll(l.text, searchRe)) {
          out.push({ hi, li, start: m.start, end: m.end });
          if (out.length >= MAX_HITS) break outer;
        }
      }
    }
    return out;
  }, [searchRe, data, search.changedOnly]);
  // Совпадения по строкам: массивы стабильны между переходами — перерисовываются только две строки
  const hitsByLine = useMemo(() => {
    const map = new Map();
    hits.forEach((h, idx) => {
      const key = `${h.hi}:${h.li}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ start: h.start, end: h.end, idx });
    });
    return map;
  }, [hits]);

  // Новые совпадения: к строке из поиска по сравнению или к первому
  useEffect(() => {
    if (!hits.length) {
      setHitIndex(0);
      return;
    }
    const want = jumpLine.current;
    if (want && data?.hunks) {
      const at = hits.findIndex((h) => {
        const l = data.hunks[h.hi].lines[h.li];
        return l.t === want.t && (want.t === '-' ? l.o === want.o : l.n === want.n);
      });
      if (at >= 0) {
        jumpLine.current = null;
        setHitIndex(at);
        return;
      }
    }
    setHitIndex(0);
  }, [hits, data]);

  // Текущее совпадение — в центр экрана
  useEffect(() => {
    if (!search.open || !hits.length) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.querySelector('[data-hit-current]')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hitIndex, hits, search.open, view]);

  const stepHit = (dir) => hits.length && setHitIndex((i) => (i + dir + hits.length) % hits.length);
  const hitsAt = (hi, li) => hitsByLine.get(`${hi}:${li}`) ?? null;
  const lineView = { syntax, hitsAt, current: search.open && hits.length ? hitIndex : null };

  // Ctrl+F — поиск в этом файле (а не по коммитам); перехватываем раньше общего обработчика окна
  useEffect(() => {
    const onKey = (e) => {
      if (editing || document.querySelector('.fixed.inset-0')) return;
      const key = e.key.toLowerCase();
      if (isMod(e) && !e.altKey && !e.shiftKey && (key === 'f' || key === 'а')) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      } else if (e.key === 'F3' && search.open) {
        e.preventDefault();
        e.stopPropagation();
        stepHit(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Esc — закрыть, Alt+↑/↓ — предыдущий/следующий файл, F7 / Shift+F7 — следующее/предыдущее изменение
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.fixed.inset-0')) return; // открыт диалог
      if (editing) {
        if (e.key === 'Escape' && !e.defaultPrevented) closeEditor();
        return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (search.open) closeSearch();
        else onClose();
      }
      if (e.altKey && e.key === 'ArrowUp' && onPrev) onPrev();
      if (e.altKey && e.key === 'ArrowDown' && onNext) onNext();
      if (e.key === 'F7') {
        e.preventDefault();
        goChange(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const file = target.file;
  const parts = file.path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  const raw = FILE_STATUS[file.status] ?? FILE_STATUS.M;
  const status = { ...raw, color: readable(raw.color) };

  return (
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col bg-gk-bg">
      {/* Заголовок */}
      <div className="glass flex h-10 shrink-0 items-center gap-2 border-b border-gk-border bg-gk-panel px-3">
        <span
          style={{ color: status.color, backgroundColor: `${status.color}22` }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
          title={status.label}
        >
          {file.status}
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px]" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {file.oldPath && file.oldPath !== file.path && (
            <span className="text-gk-dim">{file.oldPath} → </span>
          )}
          {dir && <span className="text-gk-muted">{dir}/</span>}
          <span className="font-medium text-gk-strong">{name}</span>
          <span className="ml-2 rounded bg-gk-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gk-muted">
            {MODE_LABELS[target.mode]?.(target)}
          </span>
        </div>

        {data && !data.error && !data.binary && (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-gk-green">+{data.additions}</span>{' '}
            <span className="text-gk-red">−{data.deletions}</span>
          </span>
        )}

        {fileActions?.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            title={a.title}
            disabled={a.disabled}
            data-testid="diff-file-action"
            data-label={a.label}
            className={`ml-1 flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11.5px] ring-1 ring-gk-border transition-colors disabled:opacity-40 ${
              a.danger ? 'text-gk-red enabled:hover:bg-gk-red/10' : 'text-gk-muted enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
            }`}
          >
            {a.icon && <a.icon size={12} />} {a.label}
          </button>
        ))}

        {!editing && (
          <>
        <div className="ml-2 flex overflow-hidden rounded ring-1 ring-gk-border">
          <ToggleButton active={view === 'unified'} onClick={() => onViewChange('unified')} title="Unified">
            <Rows3 size={13} />
          </ToggleButton>
          <ToggleButton active={view === 'split'} onClick={() => onViewChange('split')} title="Split">
            <Columns2 size={13} />
          </ToggleButton>
        </div>
        <ToggleButton
          active={ignoreWhitespace}
          onClick={onToggleWhitespace}
          title={tr('Игнорировать изменения пробелов')}
          className="rounded ring-1 ring-gk-border"
        >
          <Space size={13} />
        </ToggleButton>
        {onToggleFullFile && target.mode !== 'untracked' && (
          <ToggleButton
            active={fullFile}
            onClick={onToggleFullFile}
            title={fullFile ? tr('Показан весь файл. Нажмите, чтобы оставить только места изменений') : tr('Показать весь файл, а не только места изменений')}
            data-testid="diff-full-file"
            className="rounded ring-1 ring-gk-border"
          >
            {fullFile ? <FoldVertical size={13} /> : <UnfoldVertical size={13} />}
          </ToggleButton>
        )}
        <ToggleButton
          active={inline}
          onClick={toggleInline}
          title={tr('Подсвечивать, что именно изменилось внутри строки')}
          className="rounded ring-1 ring-gk-border"
        >
          <Highlighter size={13} />
        </ToggleButton>
        <ToggleButton
          active={syntaxOn && Boolean(lang)}
          onClick={toggleSyntax}
          disabled={!lang}
          title={lang ? tr('Подсветка синтаксиса: {0}', languageName(lang)) : tr('Подсветка синтаксиса — тип файла не распознан')}
          data-testid="diff-syntax"
          className="rounded ring-1 ring-gk-border disabled:opacity-40"
        >
          <CodeXml size={13} />
        </ToggleButton>
        <ToggleButton
          active={search.open}
          onClick={() => (search.open ? closeSearch() : openSearch())}
          title={kb(tr('Поиск в изменениях (Ctrl+F)'))}
          data-testid="diff-search-toggle"
          className="rounded ring-1 ring-gk-border"
        >
          <Search size={13} />
        </ToggleButton>
        {editor && (
          <button
            onClick={openEditor}
            disabled={!data || Boolean(data.error) || data.binary || data.tooLarge}
            data-testid="diff-edit"
            data-draft={editDrafts.has(editor.key) ? '1' : undefined}
            title={kb(editDrafts.has(editor.key) ? tr('В редакторе остались несохранённые правки этого файла — открыть их') : tr('Редактировать файл в рабочей папке (Ctrl+S — сохранить)'))}
            className={`ml-1 flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11.5px] ring-1 transition-colors disabled:opacity-40 ${
              editDrafts.has(editor.key) ? 'text-gk-yellow ring-gk-yellow/50 enabled:hover:bg-gk-yellow/10' : 'text-gk-muted ring-gk-border enabled:hover:bg-gk-fg/10 enabled:hover:text-gk-text'
            }`}
          >
            <Pencil size={12} /> {editDrafts.has(editor.key) ? tr('Продолжить правку') : tr('Редактировать')}
          </button>
        )}
        {changeCount > 0 && (
          <div className="ml-1 flex items-center rounded ring-1 ring-gk-border">
            <ToggleButton onClick={() => goChange(-1)} title={tr('Предыдущее изменение (Shift+F7)')}>
              <ArrowUpToLine size={13} />
            </ToggleButton>
            <span className="min-w-[44px] select-none text-center text-[11px] text-gk-muted" title={tr('Блоков изменений в файле')}>
              {current >= 0 ? `${current + 1} / ${changeCount}` : tr('{0} изм.', changeCount)}
            </span>
            <ToggleButton onClick={() => goChange(1)} title={tr('Следующее изменение (F7)')}>
              <ArrowDownToLine size={13} />
            </ToggleButton>
          </div>
        )}
          </>
        )}

        {editing && (
          <div className="ml-2 flex shrink-0 items-center gap-2 text-[11px]">
            {caret && <span className="text-gk-dim">{tr('Стр {0}, кол {1}', caret.line, caret.column)}</span>}
            {edit.mixedEol && (
              <span className="text-gk-yellow" title={tr('В файле есть и CRLF, и LF: при сохранении все строки получат {0}', edit.eol === '\r\n' ? 'CRLF' : 'LF')}>
                {tr('Смешанные окончания строк')}
              </span>
            )}
            {edit.restored && (
              <span className="text-gk-blue" title={tr('Окно изменений закрылось, пока правки не были сохранены: они возвращены. «Закрыть редактор» без сохранения их отбросит.')}>
                {tr('Правки восстановлены')}
              </span>
            )}
            {dirty ? (
              <span className="text-gk-yellow" data-testid="file-editor-dirty">{tr('Не сохранено')}</span>
            ) : edit.savedAt ? (
              <span className="text-gk-green" data-testid="file-editor-saved">{tr('Сохранено')}</span>
            ) : null}
            <button
              onClick={() => saveEditor()}
              disabled={!dirty || edit.saving}
              data-testid="file-editor-save"
              title={kb(tr('Сохранить (Ctrl+S)'))}
              className="flex h-6 items-center gap-1 rounded bg-gk-blue/20 px-2 text-[11.5px] text-gk-blue ring-1 ring-gk-blue/40 transition-colors enabled:hover:bg-gk-blue/30 disabled:opacity-40"
            >
              {edit.saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {tr('Сохранить')}
            </button>
            <button
              onClick={closeEditor}
              data-testid="file-editor-close"
              title={tr('Вернуться к просмотру изменений (Esc)')}
              className="flex h-6 items-center rounded px-2 text-[11.5px] text-gk-muted ring-1 ring-gk-border transition-colors hover:bg-gk-fg/10 hover:text-gk-text"
            >
              {tr('Закрыть редактор')}
            </button>
          </div>
        )}

        <div className="ml-1 flex items-center">
          <span className="mr-1 text-[11px] text-gk-dim">
            {target.index + 1} / {target.list.length}
          </span>
          <IconBtn title={kb(tr('Предыдущий файл (Alt+↑)'))} disabled={!onPrev} onClick={prev}>
            <ChevronUp size={15} />
          </IconBtn>
          <IconBtn title={kb(tr('Следующий файл (Alt+↓)'))} disabled={!onNext} onClick={next}>
            <ChevronDown size={15} />
          </IconBtn>
          <IconBtn title={tr('Закрыть (Esc)')} onClick={close}>
            <X size={15} />
          </IconBtn>
        </div>
      </div>

      {search.open && !editing && (
        <SearchBar
          inputRef={searchInput}
          search={search}
          onChange={patchSearch}
          error={searchError}
          count={hits.length}
          capped={hits.length >= MAX_HITS}
          index={hitIndex}
          onStep={stepHit}
          onClose={closeSearch}
        />
      )}

      {editing ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {edit.error && (
            <div data-testid="file-editor-error" className="flex shrink-0 items-center gap-2 border-b border-gk-red/30 bg-gk-red/10 px-3 py-1.5 text-xs text-gk-red">
              <span className="min-w-0 flex-1">
                {edit.error.message}
                {edit.error.hint ? ` ${edit.error.hint}` : ''}
              </span>
              {edit.error.code === 'CHANGED_ON_DISK' && (
                <>
                  <button onClick={reloadEditor} className="rounded px-2 py-0.5 ring-1 ring-gk-red/40 hover:bg-gk-red/15">
                    {tr('Перечитать')}
                  </button>
                  <button onClick={() => saveEditor(true)} data-testid="file-editor-overwrite" className="rounded px-2 py-0.5 ring-1 ring-gk-red/40 hover:bg-gk-red/15">
                    {tr('Сохранить поверх')}
                  </button>
                </>
              )}
            </div>
          )}
          {edit.loading ? (
            <Placeholder>{tj('{0} Открываю файл…', [<Loader2 size={15} className="animate-spin" />])}</Placeholder>
          ) : edit.loadError ? (
            <Placeholder className="text-gk-red">{edit.loadError.message}</Placeholder>
          ) : (
            <FileEditor value={edit.text} onChange={(text) => setEdit((e) => ({ ...e, text }))} lang={syntaxOn ? lang : null} onSave={() => saveEditor()} onCaret={setCaret} />
          )}
        </div>
      ) : (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5 [tab-size:4]">
        {!data ? (
          <Placeholder>
            {tj('{0} Загрузка diff…', [<Loader2 size={15} className="animate-spin" />])}</Placeholder>
        ) : data.error ? (
          <Placeholder className="text-gk-red">{data.error}</Placeholder>
        ) : data.binary ? (
          <Placeholder>
            {tj('{0} Бинарный файл — построчный diff недоступен', [<FileText size={15} />])}</Placeholder>
        ) : data.tooLarge ? (
          <Placeholder>{tj('Файл слишком большой ({0} КБ) для просмотра', [Math.round(data.size / 1024)])}</Placeholder>
        ) : data.hunks.length === 0 ? (
          <Placeholder>
            {data.eolOnly
              ? tr('Изменились только окончания строк (CRLF ↔ LF) — текст файла тот же')
              : file.oldPath && file.oldPath !== file.path
              ? tr('Файл переименован без изменения содержимого')
              : ignoreWhitespace
                ? tr('Изменения только в пробелах')
                : tr('Нет изменений в содержимом')}
          </Placeholder>
        ) : view === 'split' ? (
          <SplitDiff hunks={data.hunks} highlights={highlights} hunkProps={hunkProps} markers={guardMarkers} {...lineView} />
        ) : (
          <UnifiedDiff hunks={data.hunks} highlights={highlights} hunkProps={hunkProps} markers={guardMarkers} {...lineView} />
        )}
        {data?.truncated && (
          <div className="border-t border-gk-border px-4 py-2 font-sans text-xs text-gk-dim">
            {tr('Diff слишком большой — показана только часть строк')}</div>
        )}
      </div>
      )}
      {leaveGuard && (
        <ConfirmDialog title={tr('Правки не сохранены')} confirmLabel={tr('Закрыть без сохранения')} danger onConfirm={leaveGuard} onClose={() => setLeaveGuard(null)}>
          {tr('В редакторе есть несохранённые правки. Если закрыть, они пропадут.')}
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ---------- Unified ---------- */

const LINE_STYLES = {
  '+': { row: 'bg-gk-green/[0.09]', num: 'bg-gk-green/[0.13] text-gk-green/70', sign: 'text-gk-green' },
  '-': { row: 'bg-gk-red/[0.10]', num: 'bg-gk-red/[0.15] text-gk-red/70', sign: 'text-gk-red' },
  ' ': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
  '\\': { row: '', num: 'text-gk-dim', sign: 'text-gk-dim' },
};

// Строка с находкой Pre-commit Guard: жёлтая/красная метка слева и подсказка
const markerOf = (markers, line) => (markers && line.t === '+' ? markers.get(line.n) : null);
const markerCls = (m) => (m ? (m.category === 'secret' ? 'shadow-[inset_3px_0_0_rgb(242_93_93)]' : 'shadow-[inset_3px_0_0_rgb(242_202_51)]') : '');

// Совпадения строки и номер текущего (если он в этой строке) — для мемоизированной строки
const lineHits = (hitsAt, current, hi, li) => {
  const hits = hitsAt?.(hi, li) ?? null;
  return { hits, current: hits && current !== null && hits.some((h) => h.idx === current) ? current : null };
};

export function UnifiedDiff({ hunks, highlights, hunkProps, markers, syntax, hitsAt, current = null }) {
  return (
    <div className="min-w-max pb-6">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="group/hunk">
          <HunkHeader hunk={hunk} index={hi} {...hunkProps} />
          {hunk.lines.map((line, li) => {
            const startsChange = (line.t === '+' || line.t === '-') && !['+', '-'].includes(hunk.lines[li - 1]?.t);
            return (
              <UnifiedRow
                key={li}
                line={line}
                startsChange={startsChange}
                mark={markerOf(markers, line)}
                segs={highlights?.[hi]?.get(li) ?? null}
                tokens={syntax?.[hi]?.get(li) ?? null}
                {...lineHits(hitsAt, current, hi, li)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

const UnifiedRow = memo(function UnifiedRow({ line, startsChange, mark, segs, tokens, hits, current }) {
  const s = LINE_STYLES[line.t];
  return (
    <div className={`flex ${s.row} ${markerCls(mark)}`} data-change={startsChange ? '' : undefined} title={mark ? `Pre-commit Guard: ${mark.label}` : undefined}>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.o ?? ''}</span>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{line.n ?? ''}</span>
      <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === '\\' ? '' : line.t}</span>
      <span className={`select-text whitespace-pre pr-6 ${line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'}`}>
        <LineText line={line} segs={segs} tokens={tokens} hits={hits} current={current} />
      </span>
    </div>
  );
});

/* ---------- Split ---------- */

// Сопоставляем удаления и добавления: похожие строки — друг напротив друга, контекст — в обе стороны.
// pairs: Map индекс удалённой → индекс добавленной (из подсветки внутри строк); без неё — по порядку.
function toSplitRows(lines, pairs) {
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.t === ' ' || line.t === '\\') {
      rows.push({ left: { line, idx: i }, right: { line, idx: i } });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].t === '-') dels.push(i++);
    while (i < lines.length && lines[i].t === '+') adds.push(i++);
    const paired = [...dels].filter((d) => pairs?.has(d));
    if (!paired.length) {
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        rows.push({
          left: dels[k] !== undefined ? { line: lines[dels[k]], idx: dels[k] } : null,
          right: adds[k] !== undefined ? { line: lines[adds[k]], idx: adds[k] } : null,
        });
      }
      continue;
    }
    let a = 0;
    for (const d of dels) {
      const target = pairs.get(d);
      if (target === undefined) {
        rows.push({ left: { line: lines[d], idx: d }, right: null });
        continue;
      }
      // Добавленные строки до пары — отдельными строками справа
      while (adds[a] !== undefined && adds[a] < target) {
        rows.push({ left: null, right: { line: lines[adds[a]], idx: adds[a] } });
        a++;
      }
      rows.push({ left: { line: lines[d], idx: d }, right: { line: lines[target], idx: target } });
      a++;
    }
    while (adds[a] !== undefined) {
      rows.push({ left: null, right: { line: lines[adds[a]], idx: adds[a] } });
      a++;
    }
  }
  return rows;
}

function SplitDiff({ hunks, highlights, hunkProps, markers, syntax, hitsAt, current = null }) {
  const prepared = useMemo(
    () => hunks.map((h, hi) => ({ hunk: h, rows: toSplitRows(h.lines, highlights?.[hi]?.pairs) })),
    [hunks, highlights],
  );
  return (
    <div className="pb-6">
      {prepared.map(({ hunk, rows }, hi) => (
        <div key={hi} className="group/hunk">
          <HunkHeader hunk={hunk} index={hi} {...hunkProps} />
          {rows.map((row, ri) => {
            const isChange = (r) => r && (r.line.t === '+' || r.line.t === '-');
            const prev = rows[ri - 1];
            const startsChange = (isChange(row.left) || isChange(row.right)) && !(prev && (isChange(prev.left) || isChange(prev.right)));
            return (
              <div key={ri} className="grid grid-cols-2" data-change={startsChange ? '' : undefined}>
                <SplitCell
                  cell={row.left}
                  segs={row.left ? highlights?.[hi]?.get(row.left.idx) ?? null : null}
                  tokens={row.left ? syntax?.[hi]?.get(row.left.idx) ?? null : null}
                  {...(row.left ? lineHits(hitsAt, current, hi, row.left.idx) : {})}
                  side="old"
                />
                <SplitCell
                  cell={row.right}
                  segs={row.right ? highlights?.[hi]?.get(row.right.idx) ?? null : null}
                  tokens={row.right ? syntax?.[hi]?.get(row.right.idx) ?? null : null}
                  {...(row.right ? lineHits(hitsAt, current, hi, row.right.idx) : {})}
                  side="new"
                  border
                  mark={row.right ? markerOf(markers, row.right.line) : null}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const SplitCell = memo(function SplitCell({ cell, segs, tokens, hits = null, current = null, side, border, mark }) {
  if (!cell) {
    return <div className={`bg-gk-fg/[0.02] ${border ? 'border-l border-gk-border' : ''}`} />;
  }
  const line = cell.line;
  const s = LINE_STYLES[line.t];
  const num = side === 'old' ? line.o : line.n;
  return (
    <div className={`flex min-w-0 ${s.row} ${border ? 'border-l border-gk-border' : ''} ${markerCls(mark)}`} title={mark ? `Pre-commit Guard: ${mark.label}` : undefined}>
      <span className={`w-12 shrink-0 select-none pr-2 text-right ${s.num}`}>{num ?? ''}</span>
      <span className={`w-5 shrink-0 select-none text-center ${s.sign}`}>{line.t === ' ' || line.t === '\\' ? '' : line.t}</span>
      <span
        className={`min-w-0 select-text whitespace-pre-wrap break-all pr-3 ${
          line.t === '\\' ? 'italic text-gk-dim' : 'text-gk-text'
        }`}
      >
        <LineText line={line} segs={segs} tokens={tokens} hits={hits} current={current} />
      </span>
    </div>
  );
});

// Изменённые куски строки — яркой «маркерной» подложкой (цвет текста — от подсветки синтаксиса);
// пробелы в изменении делаем видимыми. Совпадения поиска — жёлтым, текущее — оранжевым.
const CHANGED = {
  '-': 'rounded-[2px] bg-gk-red/35 shadow-[inset_0_-1px_0_rgb(242_93_93/0.6)]',
  '+': 'rounded-[2px] bg-gk-green/30 shadow-[inset_0_-1px_0_rgb(60_240_160/0.6)]',
};
// Совпадение может быть разрезано токенами подсветки — поэтому сплошная подложка без рамок и скруглений
// (важнее подложки изменённого куска — иначе совпадение внутри изменения не видно)
const HIT = '!bg-gk-yellow/45';
const HIT_CURRENT = '!bg-[#ff9632] !text-[#1b1300]';

function LineText({ line, segs, tokens, hits, current }) {
  if (line.t === '\\') return line.text;
  if (!line.text) return ' ';
  if (!segs && !tokens && !hits) return line.text;
  const pieces = layerLine(line.text, {
    tokens,
    segs,
    hits: hits?.map((h) => ({ ...h, current: h.idx === current })),
  });
  return pieces.map((p, i) => {
    const changed = p.changed ? `${CHANGED[line.t] ?? CHANGED['+']} ${p.cls ? '' : 'text-gk-strong'}` : '';
    const hit = p.hit ? (p.hit.current ? HIT_CURRENT : HIT) : '';
    const cls = [p.cls, changed, hit].filter(Boolean).join(' ');
    const text = p.ws ? p.text.replace(/ /g, '·').replace(/\t/g, '→   ') : p.text;
    if (!cls) return <span key={i}>{text}</span>;
    const Tag = p.changed ? 'mark' : 'span';
    return (
      <Tag
        key={i}
        className={cls}
        data-hit={p.hit ? p.hit.idx : undefined}
        data-hit-current={p.hit?.current ? '' : undefined}
        title={p.ws ? tr('Изменились пробелы') : undefined}
      >
        {text}
      </Tag>
    );
  });
}

/* ---------- Поиск ---------- */

function SearchBar({ inputRef, search, onChange, error, count, capped, index, onStep, onClose }) {
  const opt = (key, Icon, title, testid) => (
    <button
      type="button"
      onClick={() => onChange({ [key]: !search[key] })}
      aria-pressed={search[key]}
      title={title}
      data-testid={testid}
      className={`flex h-5 w-6 shrink-0 items-center justify-center rounded ${search[key] ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-dim hover:text-gk-text'}`}
    >
      <Icon size={13} />
    </button>
  );
  return (
    <div className="flex h-9 shrink-0 animate-fade-in items-center gap-2 border-b border-gk-border bg-gk-panel/80 px-3 font-sans" data-testid="diff-search">
      <div
        className={`flex w-[min(460px,60%)] min-w-0 items-center gap-1.5 rounded bg-gk-bg px-2 ring-1 focus-within:ring-gk-blue ${
          error || (search.query && !count) ? 'ring-gk-red/60' : 'ring-gk-border'
        }`}
      >
        <Search size={12} className="shrink-0 text-gk-dim" />
        <input
          ref={inputRef}
          autoFocus
          value={search.query}
          onChange={(e) => onChange({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.altKey && (e.key === 'c' || e.key === 'с')) {
              e.preventDefault();
              onChange({ caseSensitive: !search.caseSensitive });
            } else if (e.altKey && (e.key === 'r' || e.key === 'к')) {
              e.preventDefault();
              onChange({ regex: !search.regex });
            }
          }}
          placeholder={tr('Найти в изменениях')}
          aria-label={tr('Найти в изменениях')}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-gk-text outline-none placeholder:font-sans placeholder:text-gk-dim"
        />
        {opt('caseSensitive', CaseSensitive, tr('Учитывать регистр (Alt+C)'), 'search-case')}
        {opt('regex', Regex, tr('Регулярное выражение (Alt+R)'), 'search-regex')}
        {opt('changedOnly', Diff, tr('Только в изменённых строках (+ и −)'), 'search-changed')}
      </div>
      <span className={`min-w-[88px] text-[11.5px] ${error || (search.query && !count) ? 'text-gk-red' : 'text-gk-muted'}`} data-testid="search-count">
        {error ? error : !search.query ? '' : count ? tr('{0} из {1}{2}', index + 1, count, capped ? '+' : '') : tr('Нет совпадений')}
      </span>
      <div className="flex items-center">
        <IconBtn title={tr('Предыдущее (Shift+Enter, Shift+F3)')} disabled={!count} onClick={() => onStep(-1)}>
          <ChevronUp size={15} />
        </IconBtn>
        <IconBtn title={tr('Следующее (Enter, F3)')} disabled={!count} onClick={() => onStep(1)}>
          <ChevronDown size={15} />
        </IconBtn>
        <IconBtn title={tr('Закрыть поиск (Esc)')} onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>
    </div>
  );
}

/* ---------- Общее ---------- */

function HunkHeader({ hunk, index, actions, busy, onRun }) {
  return (
    <div className="flex items-center border-y border-gk-border/60 bg-gk-blue/10 py-0.5 pl-3 text-[11px] text-gk-blue/90">
      <span className="sticky left-3 flex items-center gap-2">
        <span>{hunk.header.replace(/ @@.*$/, ' @@')}</span>
        {hunk.section && <span className="text-gk-muted">{hunk.section}</span>}
        {actions?.map((a) => {
          const running = busy === `${a.id}:${index}`;
          return (
            <button
              key={a.id}
              disabled={Boolean(busy)}
              title={a.title}
              onClick={() => onRun(a, hunk, index)}
              className={`flex items-center gap-1 rounded px-1.5 py-px font-sans text-[11px] opacity-70 ring-1 transition group-hover/hunk:opacity-100 disabled:opacity-40 ${
                a.danger ? 'text-gk-red ring-gk-red/30 hover:bg-gk-red/15' : 'text-gk-text ring-gk-border hover:bg-gk-fg/10'
              }`}
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : a.icon && <a.icon size={11} />}
              {a.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

function Placeholder({ children, className = '' }) {
  return (
    <div className={`flex h-full items-center justify-center gap-2 font-sans text-[13px] text-gk-muted ${className}`}>
      {children}
    </div>
  );
}

function ToggleButton({ active, children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`flex h-6 w-7 items-center justify-center ${
        active ? 'bg-gk-blue/25 text-gk-blue' : 'text-gk-dim hover:text-gk-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-gk-muted enabled:hover:bg-gk-hover enabled:hover:text-gk-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
