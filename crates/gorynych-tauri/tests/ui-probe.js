// Зонд настоящего интерфейса 1.x на слое совместимости (tests/app_smoke.rs). Подставляется только в отладочной сборке
// (`GORYNYCH_DEV_UI_PROBE`). Интерфейс открывает последний репозиторий сам; зонд ждёт, пока в окне появится граф коммитов,
// проверяет `localStorage` и сообщает итог через `frontend_ready`.
// Если в рабочей копии изменён `файл.txt`, зонд ещё и кликает по окну изменений: «Весь файл», «Редактировать», «Сохранить».
window.__GORYNYCH_PROBE__ = async (initial) => {
  const { invoke } = window.__TAURI__.core;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (condition, ms) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const value = condition();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };
  const text = () => document.body.innerText || '';
  // Тест кладёт в репозиторий коммит «Начало»: он виден в графе, когда интерфейс прочитал репозиторий через `repo:load`
  const graph = Boolean(await waitFor(() => text().includes('Начало'), 30000));
  // Настройка из прошлого запуска приходит из SQLite, если профиль WebView новый
  const seeded = localStorage.getItem('probe.saved');
  // Выбор «Весь файл» из прошлого запуска: второй запуск теста с новым профилем WebView получает его из SQLite
  const fullFilePref = localStorage.getItem('diff.fullFile');
  localStorage.setItem('probe.saved', 'сохранено');
  // Исключение сценария — в отчёт, иначе тест ждёт до таймаута без объяснений
  // Stash — пока в центре граф, а не окно изменений; потом выбор возвращается на WIP
  const stash = graph && fullFilePref === null ? await stashScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const lanes = graph && fullFilePref === null ? await lanesScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const main = graph && fullFilePref === null ? await mainBranchScenario(invoke, waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const editor = graph && fullFilePref === null ? await editorScenario(invoke, waitFor, sleep).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  // Выбор главных веток из прошлого запуска (второй запуск — из SQLite)
  const mainPref = localStorage.getItem(`graph.mainBranches.v1:${await invoke('repo_get_last')}`);
  // Запись уходит в базу пачкой через 400 мс
  await sleep(1000);
  const report = { ...initial, graph, seeded, fullFilePref, editor, stash, main, mainPref, lanes, errors: [...(window.__gorynychErrors || [])], text: graph ? '' : text().slice(0, 3000) };
  await invoke('frontend_ready', { report: JSON.stringify(report) });
};

// Stash в графе (как в GitKraken): строка между WIP и коммитом, на котором его сделали, квадратный узел; клик — детали stash
async function stashScenario(waitFor) {
  const row = await waitFor(() => document.querySelector('[data-testid="graph-stash"]'), 5000);
  if (!row) return { found: false };
  const top = (el) => el.getBoundingClientRect().top;
  const message = (text) => [...document.querySelectorAll('[data-col="message"]')].find((el) => el.textContent.includes(text));
  const base = message('Начало');
  const wip = message('// WIP');
  const node = Boolean(document.querySelector('[data-testid="graph-svg"] [data-node="stash"]'));
  const dashed = document.querySelectorAll('[data-testid="graph-svg"] path[stroke-dasharray]').length;
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  const panel = Boolean(await waitFor(() => document.querySelector('[data-testid="stash-panel"]'), 5000));
  wip?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  await waitFor(() => !document.querySelector('[data-testid="stash-panel"]'), 5000);
  return { found: true, label: row.textContent, between: Boolean(base && wip && top(wip) < top(row) && top(row) < top(base)), node, dashed: dashed >= 2, panel };
}

// Дорожки и хвосты: шаг дорожек и скрытые дорожки колонки «Граф», «+N» расширяет колонку; внизу истории — хвосты к
// незагруженным родителям (видны, когда низ графа в окне прокрутки)
async function lanesScenario(waitFor) {
  const svg = () => document.querySelector('[data-testid="graph-svg"]');
  const hidden = () => Number(svg()?.dataset.hiddenLanes ?? -1);
  // Ширина колонки меряется ResizeObserver — ждём, пока атрибуты устоятся
  let prev = '';
  await waitFor(() => {
    const now = `${svg()?.dataset.laneW}|${hidden()}`;
    const stable = now === prev;
    prev = now;
    return stable && svg();
  }, 5000);
  const before = { laneW: Number(svg().dataset.laneW), forceDots: svg().dataset.forceDots === '1', hidden: hidden() };
  const graphW = () => Number(svg().dataset.width);
  const badge = document.querySelector('[data-testid="graph-hidden-lanes"]');
  const out = { before, badge: badge ? { text: badge.textContent, tip: badge.dataset.tip } : null };
  if (badge) {
    // В окне теста колонке «Граф» почти не остаётся места: метки, автор и дата забирают его. Скрываем их в меню вида
    // (правый клик по заголовку), чтобы «+N» было куда расширить колонку
    const header = document.querySelector('[data-testid="graph-header"]');
    header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 10 }));
    await waitFor(() => document.querySelector('[role="menuitemcheckbox"]'), 3000);
    for (const b of document.querySelectorAll('[role="menuitemcheckbox"][aria-checked="true"]:not([disabled])')) {
      if (b.textContent.trim() !== 'Граф') b.click();
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const narrow = graphW();
    await waitFor(() => graphW() > narrow && document.querySelector('[data-testid="graph-hidden-lanes"]'), 5000);
    await waitFor(() => {
      const now = `${graphW()}|${hidden()}`;
      const stable = now === prev;
      prev = now;
      return stable;
    }, 3000);
    const mid = hidden();
    out.mid = mid > 0 && mid < before.hidden;
    document.querySelector('[data-testid="graph-hidden-lanes"]')?.click();
    out.after = (await waitFor(() => hidden() >= 0 && hidden() < mid, 5000)) === true;
  }
  const scroller = svg().closest('.overflow-auto');
  // Короткая история целиком в окне и без хвостов — не ждём их зря
  if (scroller.scrollHeight < scroller.clientHeight * 3) return { ...out, tails: document.querySelectorAll('[data-tail]').length };
  // Догрузка истории (этап 5): ответ порции задерживается, пока зонд не посмотрит на хвост и индикатор загрузки
  const repoApi = window.api.repo;
  const realLoadMore = repoApi.loadMore;
  let release;
  const gate = new Promise((r) => (release = r));
  const pages = [];
  repoApi.loadMore = async (dir, opts) => {
    pages.push(opts);
    await gate;
    return realLoadMore(dir, opts);
  };
  const rows = () => Math.round(Number(svg().getAttribute('height')) / 34); // стандартная плотность
  out.rowsBefore = rows();
  scroller.scrollTop = scroller.scrollHeight;
  const tails = await waitFor(() => {
    const list = [...document.querySelectorAll('[data-tail]')];
    return list.length ? list : null;
  }, 5000);
  out.tails = tails?.length ?? 0;
  out.masked = Boolean(document.querySelector('[data-testid="graph-tails"][mask]'));
  out.loadingShown = Boolean(await waitFor(() => document.querySelector('[data-testid="graph-load-more"]')?.textContent.includes('Загрузка истории'), 5000));
  const top = scroller.scrollTop;
  release();
  out.rowsAfter = (await waitFor(() => rows() > out.rowsBefore && rows(), 10000)) || rows();
  out.scrollKept = scroller.scrollTop === top;
  out.tailsAfter = document.querySelectorAll('[data-tail]').length;
  out.footerAfter = Boolean(document.querySelector('[data-testid="graph-load-more"]'));
  out.pages = pages;
  repoApi.loadMore = realLoadMore;
  scroller.scrollTop = 0;
  // Новая ветка (ссылки изменились — граф перечитывается целиком): список не сжимается обратно до 2000
  const { invoke } = window.__TAURI__.core;
  const dir = await invoke('repo_get_last');
  await invoke('repo_action', { dir, action: { name: 'createBranch', payload: { name: 'после-догрузки', checkout: true } } });
  // Колонку меток выше скрыли ради «+N» — ветку ищем в боковой панели
  out.branchShown = Boolean(await waitFor(() => (document.body.innerText || '').includes('после-догрузки'), 10000));
  await new Promise((r) => setTimeout(r, 300));
  out.rowsAfterReload = rows();
  return out;
}

// Главные ветки: в режиме «авто» у main звезда; меню ветки (правый клик по метке) убирает её из главных и возвращает
async function mainBranchScenario(invoke, waitFor) {
  const key = `graph.mainBranches.v1:${await invoke('repo_get_last')}`;
  const label = () => [...document.querySelectorAll('[data-ref-name]')].find((el) => el.textContent === 'main')?.parentElement;
  const star = () => Boolean(label()?.querySelector('[data-testid="main-branch-star"]'));
  const steps = [['auto', Boolean(await waitFor(star, 5000)), localStorage.getItem(key)]];
  if (!label()) return { skipped: 'метки main нет в окне' };
  for (const item of ['Убрать из главных веток', 'Сделать главной веткой']) {
    const el = label();
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    const button = await waitFor(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(item)), 5000);
    button?.click();
    const want = item.startsWith('Сделать');
    steps.push([item, Boolean(button), Boolean(await waitFor(() => star() === want, 5000)), localStorage.getItem(key)]);
  }
  return { steps };
}

// Окно изменений: файл открывается кликом в списке «Неиндексированные файлы»
async function editorScenario(invoke, waitFor, sleep) {
  const FILE = 'файл.txt';
  const leaf = () => [...document.querySelectorAll('span, div')].find((el) => el.children.length === 0 && el.textContent === FILE);
  const row = await waitFor(leaf, 10000);
  if (!row) return { skipped: 'нет изменённого файла' };
  const steps = [];
  const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
  // Строки diff в моноширинном блоке: считаем номера новых строк, которые видны
  const diffText = () => document.querySelector('.font-mono.text-\\[12px\\]')?.innerText ?? '';

  row.click();
  const opened = await waitFor(() => $('diff-full-file') && diffText().includes('правка'), 10000);
  steps.push(['diff', Boolean(opened)]);
  if (!opened) return { steps };
  // «строка 5» и «строка 40» далеко от правки (строка 20): по умолчанию их не видно
  const partial = !diffText().includes('строка 5') && !diffText().includes('строка 40');
  $('diff-full-file').click();
  const full = await waitFor(() => diffText().includes('строка 5') && diffText().includes('строка 40'), 10000);
  steps.push(['fullFile', Boolean(full), localStorage.getItem('diff.fullFile')]);

  // Карта изменений у полосы прокрутки: одна отметка (строка 20 заменена) около середины файла, клик — переход к ней
  const marks = await waitFor(() => {
    const list = [...document.querySelectorAll('[data-testid="change-mark"]')];
    return list.length ? list : null;
  }, 5000);
  const mark = marks?.[0];
  const top = mark ? parseFloat(mark.style.top) : NaN;
  mark?.click();
  const jumped = await waitFor(() => /\b1 \/ 1\b/.test(document.body.innerText || ''), 3000);
  steps.push(['ruler', marks?.length ?? 0, mark?.dataset.kind ?? null, top > 35 && top < 60, mark?.dataset.tip ?? null, Boolean(jumped)]);

  await waitFor(() => $('diff-edit') && !$('diff-edit').disabled, 10000);
  $('diff-edit').click();
  const input = await waitFor(() => $('file-editor-input'), 10000);
  steps.push(['editor', Boolean(input)]);
  if (!input) return { steps, partial };
  // Набор как у пользователя: значение через сеттер DOM и событие input — так его видит React
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, input.value.replace('строка 2\n', 'строка 2 из окна\n'));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const dirty = Boolean(await waitFor(() => $('file-editor-dirty'), 5000));
  // Ctrl+S в редакторе
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
  const saved = Boolean(await waitFor(() => $('file-editor-saved'), 10000));
  const dir = await invoke('repo_get_last');
  const onDisk = (await invoke('repo_read_file', { dir, path: FILE })).text;
  steps.push(['save', dirty, saved, onDisk.includes('строка 2 из окна\n')]);

  $('file-editor-close').click();
  const back = await waitFor(() => !$('file-editor-input') && diffText().includes('строка 2 из окна'), 10000);
  steps.push(['back', Boolean(back)]);

  // Черновик: правка без сохранения, затем другой файл кликом в списке (без вопроса) и обратно — правка не потеряна
  await waitFor(() => $('diff-edit') && !$('diff-edit').disabled, 10000);
  $('diff-edit').click();
  const again = await waitFor(() => $('file-editor-input'), 10000);
  setter.call(again, again.value.replace('строка 3\n', 'строка 3 черновик\n'));
  again.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => $('file-editor-dirty'), 5000);
  const other = [...document.querySelectorAll('span, div')].find((el) => el.children.length === 0 && el.textContent === 'другой.txt');
  other?.click();
  const switched = await waitFor(() => !$('file-editor-input') && $('diff-edit') && !$('diff-edit').dataset.draft, 10000);
  (await waitFor(leaf, 5000))?.click();
  // Кнопка выключена, пока не пришёл diff файла: клик по ней раньше ничего не делает (так и у пользователя)
  const marked = await waitFor(() => $('diff-edit')?.dataset.draft === '1' && !$('diff-edit').disabled, 10000);
  $('diff-edit')?.click();
  const restored = await waitFor(() => $('file-editor-input')?.value.includes('строка 3 черновик\n') && $('file-editor-dirty'), 10000);
  const untouched = !(await invoke('repo_read_file', { dir, path: FILE })).text.includes('черновик');
  steps.push(['draft', Boolean(switched), Boolean(marked), Boolean(restored), untouched]);
  await sleep(100);
  return { steps, partial };
}
