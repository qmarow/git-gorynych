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
  // Клавиатура — на длинной истории (там, где была догрузка)
  const keyboard = lanes?.rowsAfter ? await keyboardScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const search = lanes?.rowsAfter ? await searchScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const main = graph && fullFilePref === null ? await mainBranchScenario(invoke, waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const highlight = graph && fullFilePref === null && !lanes?.rowsAfter ? await highlightScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  // Фильтры вида — пока в центре граф (сценарий редактора оставляет окно изменений); «Stash в графе» остаётся выключенным
  // до второго запуска
  const filters = graph && fullFilePref === null && !lanes?.rowsAfter ? await filtersScenario(invoke, waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  // Раздел «Задачи» (новое в 2.0) — пока в центре граф; у тестового репозитория нет remote
  const issues = graph && fullFilePref === null && !lanes?.rowsAfter ? await issuesScenario(waitFor).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  const editor = graph && fullFilePref === null ? await editorScenario(invoke, waitFor, sleep).catch((e) => ({ probeError: String(e?.stack ?? e) })) : null;
  // Второй запуск: выбор «Stash в графе» вернулся из SQLite — строки stash нет
  const viewPref = { showStash: JSON.parse(localStorage.getItem('graph.view.v1') ?? 'null')?.showStash ?? null, stashRow: Boolean(document.querySelector('[data-testid="graph-stash"]')) };
  // Выбор главных веток из прошлого запуска (второй запуск — из SQLite)
  const mainPref = localStorage.getItem(`graph.mainBranches.v1:${await invoke('repo_get_last')}`);
  // Запись уходит в базу пачкой через 400 мс
  await sleep(1000);
  const report = { ...initial, graph, seeded, fullFilePref, editor, stash, main, mainPref, lanes, keyboard, search, highlight, filters, issues, viewPref, errors: [...(window.__gorynychErrors || [])], text: graph ? '' : text().slice(0, 3000) };
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

// Клавиатура графа (этап 6): зажатая стрелка — строка всегда видна сразу (без плавной прокрутки), файлы коммита грузятся
// только после остановки; Home/End/PageDown, ← к родителю, → к потомку, Enter, Shift+F10; в поле ввода клавиши не перехватываются
async function keyboardScenario(waitFor) {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const grid = document.querySelector('[role="grid"]');
  const key = (k, extra = {}, target = grid) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const selectedId = () => grid.getAttribute('aria-activedescendant');
  const rowOf = () => Number(selectedId()?.replace('graph-row-', '') ?? -1);
  const messageOf = () => document.getElementById(selectedId())?.querySelector('[data-col="message"]')?.textContent ?? null;
  const fullyVisible = () => {
    const row = document.getElementById(selectedId());
    if (!row) return false;
    const r = row.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    return r.top >= g.top + 30 - 0.5 && r.bottom <= g.bottom + 0.5;
  };
  const out = {};
  grid.focus();
  key('Home');
  await waitFor(() => rowOf() === 0, 3000);
  out.home = rowOf();
  await sleep(300);
  // Зажатая стрелка: 40 строк по 15 мс, после каждой — кадр; файлы коммитов считаем
  const repoApi = window.api.repo;
  const realFiles = repoApi.commitFiles;
  let fileCalls = 0;
  repoApi.commitFiles = (...args) => {
    fileCalls++;
    return realFiles(...args);
  };
  let hidden = 0;
  for (let i = 0; i < 40; i++) {
    key('ArrowDown');
    await frame();
    if (!fullyVisible()) hidden++;
    await sleep(15);
  }
  out.afterArrows = rowOf();
  out.hiddenDuringArrows = hidden;
  out.filesDuringArrows = fileCalls;
  await sleep(400);
  out.filesAfterStop = fileCalls;
  repoApi.commitFiles = realFiles;
  // PageDown — на видимую высоту без одной строки
  const before = rowOf();
  const page = Math.floor((grid.clientHeight - 30) / 34) - 1;
  key('PageDown');
  await waitFor(() => rowOf() !== before, 3000);
  out.pageDown = rowOf() - before === page;
  key('End');
  await waitFor(() => rowOf() === Number(grid.getAttribute('aria-rowcount')) - 2, 3000);
  out.end = [rowOf(), Number(grid.getAttribute('aria-rowcount')) - 2, fullyVisible()];
  // Верхняя строка — «ветка 59»: её родитель — «main 2036», ближайший потомок того — «main 2037»
  key('Home');
  await waitFor(() => rowOf() === 0, 3000);
  out.top = messageOf();
  key('ArrowLeft');
  await waitFor(() => rowOf() !== 0, 3000);
  out.parent = messageOf();
  key('ArrowRight');
  await waitFor(() => messageOf() !== out.parent, 3000);
  out.child = messageOf();
  // Enter = двойной клик: на коммите без веток — окно «Переключиться…»; Esc закрывает
  const overlays = () => document.querySelectorAll('.fixed.inset-0').length;
  const base = overlays();
  key('Enter');
  out.enter = Boolean(await waitFor(() => overlays() > base, 3000));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => overlays() === base, 3000);
  // Shift+F10 — меню строки (шапка меню коммита)
  key('F10', { shiftKey: true });
  out.menu = Boolean(await waitFor(() => document.querySelector('[data-testid="menu-header-copy"]'), 3000));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await waitFor(() => !document.querySelector('[data-testid="menu-header-copy"]'), 3000);
  // Поле ввода внутри графа (поиск ветки в меню вида): End не двигает выбор
  const header = document.querySelector('[data-testid="graph-header"]');
  header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 10 }));
  const add = await waitFor(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Добавить ветку')), 3000);
  add?.click();
  const input = await waitFor(() => document.querySelector('[data-testid="main-branches-menu"] input'), 3000);
  const rowBefore = rowOf();
  if (input) key('End', {}, input);
  await sleep(200);
  out.inputIgnored = Boolean(input) && rowOf() === rowBefore;
  if (input) key('Escape', {}, input);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  out.roles = [grid.getAttribute('role'), document.getElementById(selectedId())?.getAttribute('role'), document.getElementById(selectedId())?.getAttribute('aria-selected'), document.querySelector('[data-testid="graph-svg"]')?.getAttribute('aria-hidden'), document.querySelectorAll(`#${selectedId()} [role="gridcell"]`).length > 0];
  return out;
}

// Поиск в графе (этап 6), запрос «main»: совпадают 2100 коммитов основной линии (верхний — по метке main), не совпадают
// 60 коммитов веток. Подсветка найденного, отметки у полосы прокрутки (место и клик), рёбра между совпадениями,
// «только совпадения» — граф без колонки «Граф» и без остальных коммитов
async function searchScenario(waitFor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const grid = () => document.querySelector('[role="grid"]');
  const rows = () => Number(grid().getAttribute('aria-rowcount')) - 1;
  const out = {};
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }));
  const input = await waitFor(() => document.querySelector('input[placeholder]') && document.activeElement?.tagName === 'INPUT' && document.activeElement, 3000);
  if (!input) return { opened: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'main');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const ruler = await waitFor(() => document.querySelector('[data-testid="graph-match-ruler"]'), 5000);
  await sleep(300);
  const marks = [...document.querySelectorAll('[data-testid="search-mark"]')].map((m) => m.textContent.toLowerCase());
  out.marked = marks.length > 0 && marks.every((m) => m === 'main');
  const buttons = ruler ? [...ruler.querySelectorAll('button')] : [];
  const total = rows();
  const h = ruler ? ruler.getBoundingClientRect().height : 0;
  out.rulerMarks = buttons.length > 10;
  out.rulerPlaced = buttons.every((b) => Math.abs(parseFloat(b.style.top) + 2 - Math.min(h - 2, Math.floor((Number(b.dataset.row) / total) * h))) <= 1);
  // Клик по отметке в середине — выбран этот коммит
  const pick = buttons[Math.floor(buttons.length / 2)];
  pick?.click();
  out.rulerPick = Boolean(await waitFor(() => grid().getAttribute('aria-activedescendant') === `graph-row-${pick?.dataset.row}`, 3000));
  // Около строки 60 видны и рёбра основной линии, и рёбра веток (не совпали), спускающиеся к ней
  await sleep(600);
  grid().scrollTop = 60 * 34;
  await sleep(300);
  const opacities = new Set([...document.querySelectorAll('[data-testid="graph-svg"] path.graph-edge')].map((p) => p.getAttribute('stroke-opacity')));
  out.edges = [...opacities].sort();
  // Только совпадения
  document.querySelector('[data-testid="search-only-matches"]').click();
  out.onlyMatches = Boolean(await waitFor(() => !document.querySelector('[data-testid="graph-svg"]') && rows() < total, 3000));
  out.onlyRows = rows();
  out.allMatch = [...document.querySelectorAll('[role="row"][id] [data-col="message"]')].every((m) => /main|Начало/.test(m.textContent));
  out.noRuler = !document.querySelector('[data-testid="graph-match-ruler"]');
  document.querySelector('[data-testid="search-only-matches"]').click();
  out.back = Boolean(await waitFor(() => document.querySelector('[data-testid="graph-svg"]') && rows() === total, 3000));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  out.closed = Boolean(await waitFor(() => !document.querySelector('[data-testid="graph-match-ruler"]'), 3000));
  return out;
}

// Подсветка ветки (этап 6): наведение на метку main дольше 300 мс подсвечивает её историю (цепочку первых родителей),
// остальные узлы — 0.35; уход мыши снимает подсветку. React ловит наведение по mouseover/mouseout
async function highlightScenario(waitFor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svg = () => document.querySelector('[data-testid="graph-svg"]');
  const label = [...document.querySelectorAll('[data-ref-name]')].find((el) => el.textContent === 'main')?.parentElement;
  if (!label) return { skipped: 'метки main нет' };
  const opacity = (hash) => svg().querySelector(`g[data-hash="${hash}"]`)?.style.opacity ?? null;
  const renders = () => window.__rowRenders ?? null;
  // Для сравнения: столько же времени без наведения (фоновые обновления окна тоже перерисовывают строки)
  const idleStart = renders();
  await sleep(650);
  const idle = idleStart === null ? null : renders() - idleStart;
  const before = renders();
  label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  await sleep(150);
  const early = svg().dataset.highlight ?? null;
  const tip = await waitFor(() => svg().dataset.highlight, 2000);
  await sleep(200);
  const lit = { wip: opacity('WIP'), tip: opacity(tip) };
  const during = renders();
  label.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  const cleared = Boolean(await waitFor(() => !svg().dataset.highlight, 2000));
  await sleep(200);
  return { early, highlighted: Boolean(tip), lit, cleared, after: opacity('WIP'), rowRenders: before === null ? null : during - before, idleRenders: idle };
}

// Раздел «Показывать» меню вида (этап 6): тег на «Начало» виден в «+1» у метки main, «Метки тегов» его прячут и возвращают;
// «Stash в графе» убирает строку stash и остаётся выключенным — второй запуск теста проверяет, что выбор вернулся из SQLite
async function filtersScenario(invoke, waitFor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dir = await invoke('repo_get_last');
  const refsCell = () => [...document.querySelectorAll('[data-ref-name]')].find((el) => el.textContent === 'main')?.closest('[role="gridcell"]');
  const plus = () => /\+1/.test(refsCell()?.textContent ?? '');
  const hash = [...document.querySelectorAll('[data-testid="graph-svg"] g[data-hash]')].map((g) => g.dataset.hash).find((h) => h !== 'WIP' && !h.startsWith('stash:'));
  await invoke('repo_action', { dir, action: { name: 'createTag', payload: { name: 'v-проба', hash } } });
  const out = { tagShown: Boolean(await waitFor(plus, 10000)) };
  const toggle = async (id) => {
    const header = document.querySelector('[data-testid="graph-header"]');
    header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 10 }));
    const button = await waitFor(() => document.querySelector(`[data-testid="view-${id}"]`), 3000);
    button.click();
    await sleep(100);
    const checked = document.querySelector(`[data-testid="view-${id}"]`)?.getAttribute('aria-checked');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => !document.querySelector(`[data-testid="view-${id}"]`), 3000);
    return checked;
  };
  out.tagsOff = await toggle('showTags');
  out.tagHidden = Boolean(await waitFor(() => !plus(), 3000));
  out.tagsOn = await toggle('showTags');
  out.tagBack = Boolean(await waitFor(plus, 3000));
  out.stashBefore = Boolean(document.querySelector('[data-testid="graph-stash"]'));
  out.stashOff = await toggle('showStash');
  out.stashHidden = Boolean(await waitFor(() => !document.querySelector('[data-testid="graph-stash"]'), 3000));
  out.pref = JSON.parse(localStorage.getItem('graph.view.v1') ?? 'null')?.showStash ?? null;
  return out;
}

// Раздел «Задачи» (этап 3): кнопки на панели инструментов нет (у репозитория нет сервера), Ctrl+I открывает раздел вместо
// графа — «нет сервера с задачами», правая панель коммита скрыта, граф не размонтирован; Esc закрывает раздел, Ctrl+Ш
// (русская раскладка) открывает снова, Ctrl+I закрывает. После закрытия — тот же узел графа
async function issuesScenario(waitFor) {
  const svg = () => document.querySelector('[data-testid="graph-svg"]');
  const section = () => document.querySelector('[data-testid="issues-view"]');
  const graphBefore = svg();
  const key = (key, init = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const out = { button: Boolean(document.querySelector('[data-testid="toolbar-issues"]')) };
  key('i', { code: 'KeyI', ctrlKey: true });
  out.opened = Boolean(await waitFor(section, 3000));
  out.state = (await waitFor(() => section()?.querySelector('[data-testid="issues-state"]')?.dataset.state, 10000)) ?? section()?.innerText.slice(0, 300) ?? null;
  out.graphKept = svg() === graphBefore && Boolean(svg()?.closest('[inert]'));
  out.detailsHidden = !document.querySelector('[data-testid="commit-details"]');
  out.focused = document.activeElement === section();
  key('Escape', { code: 'Escape' });
  out.escClosed = Boolean(await waitFor(() => !section(), 3000));
  key('ш', { code: 'KeyI', ctrlKey: true });
  out.reopened = Boolean(await waitFor(section, 3000));
  key('i', { code: 'KeyI', ctrlKey: true });
  out.toggledOff = Boolean(await waitFor(() => !section(), 3000));
  out.sameGraph = svg() === graphBefore && !svg()?.closest('[inert]');
  out.list = await issuesListScenario(waitFor, key, section).catch((e) => ({ probeError: String(e?.stack ?? e) }));
  return out;
}

// Список задач на подставном `window.api.issues` (настоящего сервера в тесте нет): 500 задач страницами по 30,
// виртуализация, поиск через 300 мс, «Назначены мне», подгрузка при прокрутке, выбор с клавиатуры — один запрос
// карточки через 150 мс, прокрутка вкладки после закрытия и открытия раздела
async function issuesListScenario(waitFor, key, section) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const real = window.api.issues;
  const calls = [];
  const me = { id: '1', login: 'tester', name: 'Тестер', avatarUrl: null, webUrl: null };
  const issue = (n) => ({
    id: String(n), number: n, title: `Задача номер ${n}`, body: `Описание ${n}`, state: 'open', stateReason: null, author: me,
    assignees: n % 3 ? [] : [me], labels: n % 2 ? [{ id: 'b', name: 'bug', color: '#d73a4a', description: null }] : [], milestone: null,
    commentsCount: n % 4, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z', closedAt: null, dueDate: null,
    confidential: false, locked: false, webUrl: `https://example.invalid/i/${n}`,
  });
  const caps = { create: true, edit: true, comment: true, editComments: true, deleteComments: true, close: true, labels: true, createLabel: true, multipleAssignees: true, milestones: true, dueDate: true, confidential: true, lock: true, delete: true, events: true, textSearch: true, counts: true, closeReasons: ['completed', 'not_planned'] };
  window.api.issues = {
    ...real,
    list: async (_dir, query) => {
      calls.push(['list', query.page, query.search ?? null, query.assignee ?? null]);
      const all = Array.from({ length: 500 }, (_, i) => issue(500 - i)).filter((x) => (!query.search || x.title.includes(query.search)) && (query.assignee !== '@me' || x.assignees.length));
      const items = all.slice((query.page - 1) * 30, query.page * 30);
      return { ok: true, data: { list: { items, page: query.page, hasMore: query.page * 30 < all.length, counts: { open: all.length, closed: 0 } }, caps, provider: 'github', label: 'GitHub', webUrl: 'https://example.invalid/i' } };
    },
    meta: async () => ({
      ok: true,
      data: {
        labels: [{ id: 'b', name: 'bug', color: '#d73a4a', description: null }, { id: 'f', name: 'feature', color: '#0e8a16', description: null }],
        milestones: [{ id: 'm1', number: 1, title: 'v1.0', dueDate: '2026-12-31', closed: false }],
        members: [me, { id: '2', login: 'anna', name: 'Анна', avatarUrl: null, webUrl: null }],
        me,
        templates: [{ name: 'Ошибка', title: 'Ошибка: ', body: '## Шаги\n', labels: ['bug', 'нет-такой'] }, { name: 'Идея', title: null, body: '## Зачем\n', labels: ['feature'] }],
      },
    }),
    get: async (_dir, number) => {
      calls.push(['get', number]);
      return { ok: true, data: { issue: issue(number), timeline: [], timelineTruncated: false } };
    },
  };
  const rows = () => [...section().querySelectorAll('[role="option"][data-number]')];
  const listbox = () => section().querySelector('[role="listbox"]');
  const out = {};
  try {
    key('i', { code: 'KeyI', ctrlKey: true });
    await waitFor(section, 3000);
    out.loaded = Boolean(await waitFor(() => rows().length && rows()[0].dataset.number === '500', 10000));
    out.rendered = rows().length; // только видимые и по 10 сверху и снизу
    out.counts = section().querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;
    // Поиск: запрос уходит один раз, после паузы
    const input = section().querySelector('input[placeholder]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    calls.length = 0;
    for (const value of ['1', '12', '123']) {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(50);
    }
    out.searchEarly = calls.length;
    out.search = Boolean(await waitFor(() => rows().length === 1 && rows()[0].dataset.number === '123', 3000)) && calls.map((c) => c[2]).join(',');
    section().querySelector('button[aria-label="Очистить"]').click();
    await waitFor(() => rows().length > 1, 3000);
    // «Назначены мне»
    const mine = [...section().querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === 'Назначены мне');
    calls.length = 0;
    mine.click();
    out.mine = Boolean(await waitFor(() => rows()[0]?.dataset.number === '498', 3000)) && calls[0]?.[3];
    mine.click();
    await waitFor(() => rows()[0]?.dataset.number === '500', 3000);
    // Подгрузка: прокрутка к концу запрашивает страницу 2
    calls.length = 0;
    listbox().scrollTop = listbox().scrollHeight;
    out.loadMore = Boolean(await waitFor(() => calls.some((c) => c[0] === 'list' && c[1] === 2), 3000));
    await waitFor(() => rows().some((r) => r.dataset.number === '440'), 3000);
    // Клавиатура: пять нажатий подряд — карточка загружается один раз, для последней задачи
    listbox().scrollTop = 0;
    await sleep(100);
    listbox().focus();
    calls.length = 0;
    for (let i = 0; i < 5; i++) {
      key('ArrowDown', { code: 'ArrowDown' });
      await sleep(20);
    }
    await sleep(400);
    out.keys = calls.filter((c) => c[0] === 'get').map((c) => c[1]);
    out.selected = section().querySelector('[role="option"][aria-selected="true"]')?.dataset.number ?? null;
    out.card = Boolean(await waitFor(() => section().innerText.includes('Описание 496'), 3000));
    // Прокрутка вкладки переживает закрытие раздела
    listbox().scrollTop = 30 * 56;
    await sleep(100);
    const scrolled = listbox().scrollTop;
    key('i', { code: 'KeyI', ctrlKey: true });
    await waitFor(() => !section(), 3000);
    key('i', { code: 'KeyI', ctrlKey: true });
    await waitFor(section, 3000);
    out.scrollKept = Boolean(await waitFor(() => listbox() && listbox().scrollTop === scrolled, 3000));
    out.selectedKept = section().innerText.includes('Описание 496'); // строка 496 вне окна прокрутки, карточка — та же
    out.detail = await issueCardScenario(waitFor, section, real, me, issue, calls).catch((e) => ({ probeError: String(e?.stack ?? e) }));
    out.edit = await issueEditScenario(waitFor, section, real, issue, calls).catch((e) => ({ probeError: String(e?.stack ?? e) }));
  } finally {
    window.api.issues = real;
    if (section()) key('i', { code: 'KeyI', ctrlKey: true });
    await waitFor(() => !section(), 3000);
  }
  return out;
}

// Карточка задачи (этап 4) на том же подставном API, HTML описания — настоящий `issues_render_markdown` из Rust: таблица,
// подсветка кода, флажки, вредоносная разметка не исполняется, сломанная картинка → ссылка, внешняя ссылка — во внешний
// браузер, `#77` открывает задачу 77; лента (события склеены, тексты по-русски); комментарий по Ctrl+Enter полупрозрачный
// до ответа, при ошибке текст возвращается; правка, удаление через подтверждение, цитата; черновик переживает переход
// к другой задаче; Ctrl+I в поле — курсив, раздел открыт; вкладка «Просмотр»
async function issueCardScenario(waitFor, section, real, me, issue, calls) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = window.api.issues;
  const card = () => section().querySelector('[data-testid="issue-detail"]');
  const row = (n) => section().querySelector(`[role="option"][data-number="${n}"]`);
  const listbox = () => section().querySelector('[role="listbox"]');
  const other = { id: '2', login: 'anna', name: 'Анна', avatarUrl: null, webUrl: null };
  const html = async (dir, text) => (await real.renderMarkdown(dir, text)).data;
  const body = [
    '| A | B |', '|:--|--:|', '| 1 | 2 |', '', '```rust', 'fn main() { let x = 1; }', '```', '', '- [ ] первый', '- [x] второй', '',
    'Смотри #77 и [сайт](https://example.invalid/page).', '', '<script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 1">', '',
    '![нет](https://127.0.0.1:1/missing.png)',
  ].join('\n');
  const bodies = new Map();
  let failComment = false;
  let commentNo = 1;
  const opened = [];
  const openExternal = window.api.openExternal;
  window.api.openExternal = async (url) => (opened.push(url), true);
  api.get = async (dir, number) => {
    calls.push(['get', number]);
    const text = bodies.get(number) ?? body;
    const comment = { id: 'c1', body: 'Первый **комментарий**', bodyHtml: await html(dir, 'Первый **комментарий**'), author: me, createdAt: '2026-11-02T10:00:00Z', updatedAt: null, canEdit: true, webUrl: null };
    const timeline = [
      { type: 'comment', ...comment },
      { type: 'event', id: 'e1', kind: 'closed', actor: other, createdAt: '2026-11-03T10:00:00Z', label: null, user: null, from: null, to: null, text: null },
      { type: 'event', id: 'e2', kind: 'labeled', actor: other, createdAt: '2026-11-03T10:00:20Z', label: { id: 'b', name: 'bug', color: '#d73a4a', description: null }, user: null, from: null, to: null, text: null },
      { type: 'event', id: 'e3', kind: 'assigned', actor: me, createdAt: '2026-11-04T10:00:00Z', label: null, user: me, from: null, to: null, text: null },
    ];
    return { ok: true, data: { issue: { ...issue(number), body: text, bodyHtml: await html(dir, text) }, timeline, timelineTruncated: false } };
  };
  api.update = async (dir, number, patch) => {
    calls.push(['update', number, patch.body ?? null]);
    if (patch.body != null) bodies.set(number, patch.body);
    return { ok: true, data: { ...issue(number), body: patch.body ?? body, bodyHtml: await html(dir, patch.body ?? body) } };
  };
  api.commentAdd = async (dir, number, text) => {
    calls.push(['commentAdd', number, text]);
    await sleep(300);
    if (failComment) return { ok: false, error: { code: 'NETWORK', message: 'нет сети', hint: null, details: '' } };
    return { ok: true, data: { id: `c${++commentNo}`, body: text, bodyHtml: await html(dir, text), author: me, createdAt: new Date().toISOString(), updatedAt: null, canEdit: true, webUrl: null } };
  };
  api.commentUpdate = async (dir, number, id, text) => {
    calls.push(['commentUpdate', id, text]);
    return { ok: true, data: { id, body: text, bodyHtml: await html(dir, text), author: me, createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', canEdit: true, webUrl: null } };
  };
  api.commentDelete = async (_dir, _number, id) => (calls.push(['commentDelete', id]), { ok: true, data: null });

  const type = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const field = () => card()?.querySelector('[data-testid="md-editor"] textarea');
  const press = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const menuItem = async (comment, text) => {
    comment.querySelector('[data-testid="comment-menu"]').click();
    // Не кнопка описания с тем же текстом («Изменить»)
    const button = await waitFor(() => [...document.querySelectorAll('button')].find((b) => !b.closest('[data-testid="issue-description"]') && b.textContent.trim() === text), 3000);
    button.click();
  };
  const out = {};
  const dbg = [];
  const note = (step) => dbg.push([step, Object.entries(localStorage).filter(([k]) => k.includes(':495:')).map(([, v]) => v).join('|'), field()?.value ?? null, Boolean(document.querySelector('.bg-gk-scrim'))]);
  try {
    listbox().scrollTop = 0;
    await waitFor(() => row(495), 3000);
    row(495).click();
    await waitFor(() => card()?.dataset.number === '495' && card().querySelector('.md-body table'), 5000);
    const md = card().querySelector('[data-testid="issue-description"] .md-body');
    out.table = Boolean(md.querySelector('th[align="left"]') && md.querySelector('td[align="right"]'));
    out.code = Boolean(md.querySelector('pre > code.language-rust span.tok-keyword'));
    out.tasks = [...md.querySelectorAll('input[data-task-index]')].map((i) => `${i.dataset.taskIndex}${i.checked ? 'x' : '-'}${i.disabled ? 'd' : ''}`).join(',');
    out.safe = !window.__pwned && !md.querySelector('script') && !md.innerHTML.includes('onerror');
    out.brokenImage = Boolean(await waitFor(() => md.querySelector('a[data-broken-image]'), 8000)) || md.innerHTML.match(/<img[^>]*>/g)?.join(' ') || 'нет img';
    md.querySelector('a[href="https://example.invalid/page"]').click();
    out.external = opened.join(',');
    // Лента: комментарий, «закрыта» и «метка» одной строкой (один автор за минуту), «взята в работу»
    out.events = [...card().querySelectorAll('[data-testid="issue-event"]')].map((li) => [...li.querySelectorAll('[data-kind]')].map((e) => e.dataset.kind).join('+')).join(',');
    out.eventText = card().querySelector('[data-kind="closed"]')?.textContent.split('·')[0].trim() ?? null;
    out.selfAssigned = card().querySelector('[data-kind="assigned"]')?.textContent.includes('взята в работу') ?? false;
    // Флажок меняет описание
    md.querySelector('input[data-task-index="0"]').click();
    out.toggle = Boolean(await waitFor(() => calls.some((c) => c[0] === 'update' && c[2]?.includes('- [x] первый')), 3000));
    // Цитата в поле комментария
    await menuItem(card().querySelector('[data-comment-id="c1"]'), 'Цитировать');
    out.quote = (await waitFor(() => field()?.value.startsWith('> Первый **комментарий**') && field().value, 3000)) ?? field()?.value ?? null;
    // Ctrl+I в поле — курсив, раздел не закрывается
    type(field(), '');
    field().focus();
    press(field(), { key: 'i', code: 'KeyI', ctrlKey: true });
    await sleep(50);
    out.italic = section() ? field().value : 'раздел закрыт';
    // Отправка: сразу полупрозрачный, затем обычный
    type(field(), 'Новый комментарий');
    press(field(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    out.cleared = (await waitFor(() => field()?.value === '', 1000)) ?? false;
    out.pending = Boolean(await waitFor(() => card().querySelector('[data-testid="issue-comment"][aria-busy="true"]'), 1000));
    out.sent = Boolean(await waitFor(() => card().querySelector('[data-comment-id="c2"]:not([aria-busy])'), 3000));
    // Ошибка: комментарий исчезает, текст возвращается
    failComment = true;
    type(field(), 'Не уйдёт');
    press(field(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    await waitFor(() => field()?.value === '' && card().querySelector('[aria-busy="true"]'), 1000);
    out.failed = (await waitFor(() => field()?.value === 'Не уйдёт' && !card().querySelector('[aria-busy="true"]') && 'returned', 3000)) ?? field()?.value ?? null;
    failComment = false;
    note('failed');
    out.comments = [...card().querySelectorAll('[data-comment-id]')].map((li) => li.dataset.commentId).join(',');
    // Правка
    await menuItem(card().querySelector('[data-comment-id="c1"]'), 'Изменить');
    const editor = await waitFor(() => card().querySelector('[data-comment-id="c1"] textarea'), 3000);
    type(editor, 'Исправлено');
    card().querySelector('[data-comment-id="c1"] [data-testid="md-submit"]').click();
    out.edited = Boolean(await waitFor(() => !card().querySelector('[data-comment-id="c1"] textarea') && card().querySelector('[data-comment-id="c1"] .md-body')?.textContent.includes('Исправлено'), 3000));
    // Удаление — через подтверждение
    await menuItem(card().querySelector('[data-comment-id="c2"]'), 'Удалить комментарий');
    const confirmButton = await waitFor(() => [...document.querySelectorAll('.bg-gk-scrim button')].find((b) => b.textContent.trim() === 'Удалить комментарий'), 3000);
    out.confirm = Boolean(confirmButton);
    note('confirm');
    confirmButton?.click();
    await sleep(100);
    note('clicked');
    out.deleted = Boolean(await waitFor(() => !card().querySelector('[data-comment-id="c2"]'), 3000)) && calls.some((c) => c[0] === 'commentDelete' && c[1] === 'c2');
    // Черновик: в поле остался «Не уйдёт»; другая задача и обратно — текст на месте
    await sleep(600);
    note('switch');
    const beforeSwitch = field()?.value ?? null;
    row(496).click();
    out.switched = Boolean(await waitFor(() => card()?.dataset.number === '496', 3000)) || beforeSwitch;
    row(495).click();
    await waitFor(() => card()?.dataset.number === '495', 3000);
    out.draft = Boolean(await waitFor(() => field()?.value === 'Не уйдёт' && card().innerText.includes('Восстановлен черновик'), 3000)) || { value: field()?.value ?? null, number: card()?.dataset.number, stored: Object.entries(localStorage).filter(([k]) => k.includes(':495:')) };
    // Просмотр — HTML из Rust
    [...card().querySelectorAll('[data-testid="md-editor"] [role="tab"]')].find((b) => b.textContent === 'Просмотр').click();
    out.preview = (await waitFor(() => card().querySelector('[data-testid="md-preview"] .md-body p')?.textContent, 3000)) ?? null;
    // #77 в описании открывает задачу 77
    card().querySelector('[data-testid="issue-description"] a[data-issue="77"]').click();
    out.issueLink = Boolean(await waitFor(() => card()?.dataset.number === '77', 3000));
  } finally {
    window.api.openExternal = openExternal;
  }
  if (out.draft !== true || out.deleted !== true) out.dbg = dbg;
  return out;
}

// Правка задачи и создание (этап 5) на том же подставном API: заголовок по E (Esc — отмена), закрытие с причиной и
// «Отменить», приглушённая строка под фильтром «Открытые», метки по L — два клика одним запросом, новая метка, откат при
// ошибке и «Повторить», веха, срок «Через неделю», конфиденциальность; конфликт описания; «Отправить и закрыть»;
// блокировка; удаление с вводом номера; форма новой задачи — проверка заголовка, шаблоны с подтверждением замены,
// «Создать ещё одну», черновик в шапке, создание
async function issueEditScenario(waitFor, section, real, issue, calls) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = window.api.issues;
  const card = () => section().querySelector('[data-testid="issue-detail"]');
  const row = (n) => section().querySelector(`[role="option"][data-number="${n}"]`);
  const listbox = () => section().querySelector('[role="listbox"]:not([aria-multiselectable])');
  const picker = () => document.querySelector('[role="listbox"][aria-multiselectable]');
  const option = (text) => [...(picker()?.querySelectorAll('[role="option"]') ?? [])].find((o) => o.textContent.includes(text));
  const press = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const keyOnSection = (code, key = code.replace(/^Key/, '').toLowerCase()) => {
    section().focus();
    press(section(), { key, code });
  };
  const toast = (text) => [...document.querySelectorAll('[data-testid="toast-action"]')].find((b) => b.parentElement.textContent.includes(text));
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const labelsShown = (root) => [...root.querySelectorAll('[data-testid="meta-labels"] span.truncate')].map((x) => x.textContent);
  const html = async (dir, text) => (await real.renderMarkdown(dir, text)).data;
  const state = new Map();
  let failUpdate = false;
  let serverBody = null;
  const updates = () => calls.filter((c) => c[0] === 'update2').map((c) => c[2]);
  api.update = async (dir, number, patch) => {
    calls.push(['update2', number, patch]);
    await sleep(50);
    if (failUpdate) return { ok: false, error: { code: 'NETWORK', message: 'нет сети', hint: null, details: '' } };
    const next = { ...issue(number), ...(state.get(number) ?? {}) };
    if (patch.title != null) next.title = patch.title;
    if (patch.body != null) next.body = patch.body;
    if (patch.state) Object.assign(next, { state: patch.state, stateReason: patch.stateReason ?? null });
    if (patch.labels) next.labels = patch.labels.map((l) => ({ id: l.id, name: l.name, color: '#888888', description: null }));
    if (patch.locked != null) next.locked = patch.locked;
    if (patch.confidential != null) next.confidential = patch.confidential;
    if (patch.milestone) next.milestone = { ...patch.milestone, dueDate: null, closed: false };
    if (patch.dueDate) next.dueDate = patch.dueDate;
    state.set(number, next);
    return { ok: true, data: { ...next, bodyHtml: await html(dir, next.body) } };
  };
  const get = api.get;
  api.get = async (dir, number) => {
    const res = await get(dir, number);
    Object.assign(res.data.issue, state.get(number) ?? {});
    if (serverBody != null && number === 495) Object.assign(res.data.issue, { body: serverBody, updatedAt: '2030-01-01T00:00:00Z' });
    return res;
  };
  api.labelCreate = async (_dir, name, color) => (calls.push(['labelCreate', name, color]), { ok: true, data: { id: 'n1', name, color, description: null } });
  api.remove = async (_dir, number) => (calls.push(['remove', number]), { ok: true, data: null });
  api.create = async (dir, input) => {
    calls.push(['create', input]);
    const n = 500 + calls.filter((c) => c[0] === 'create').length;
    return { ok: true, data: { ...issue(n), title: input.title, body: input.body, bodyHtml: await html(dir, input.body), labels: input.labels.map((l) => ({ ...l, color: '#888888', description: null })) } };
  };
  const out = {};
  // Свежие возможности (причины закрытия, удаление) — обновлением списка
  keyOnSection('F5', 'F5');
  await sleep(300);
  listbox().scrollTop = 0;
  await waitFor(() => row(495), 3000);
  row(495).click();
  await waitFor(() => card()?.dataset.number === '495' && card().querySelector('[data-testid="issue-close-reasons"]'), 5000);

  // Заголовок: E → поле с выделенным текстом; Esc — без запроса; Enter — сохранить
  keyOnSection('KeyE');
  const title = await waitFor(() => card().querySelector('[data-testid="issue-title-input"]'), 2000);
  out.titleSelected = title ? title.selectionStart === 0 && title.selectionEnd === title.value.length && title.value.length > 0 : false;
  if (title) press(title, { key: 'Escape', code: 'Escape' });
  await sleep(50);
  out.titleCancel = !card().querySelector('[data-testid="issue-title-input"]') && updates().length === 0 && Boolean(section());
  keyOnSection('KeyE');
  const input = await waitFor(() => card().querySelector('[data-testid="issue-title-input"]'), 2000);
  setValue(input, 'Новый заголовок');
  press(input, { key: 'Enter', code: 'Enter' });
  out.title = (await waitFor(() => card().querySelector('[data-testid="issue-title"]')?.textContent.startsWith('Новый заголовок') && updates().at(-1)?.title, 2000)) ?? null;

  // Закрытие: основная кнопка — «как выполненную»; уведомление с «Отменить»; строка приглушена
  card().querySelector('[data-testid="issue-state-button"]').click();
  out.closed = (await waitFor(() => updates().at(-1)?.state === 'closed' && updates().at(-1).stateReason, 2000)) ?? null;
  out.dimmed = Boolean(await waitFor(() => row(495)?.className.includes('opacity-50'), 2000));
  const undo = await waitFor(() => toast('#495'), 2000);
  undo?.click();
  out.undo = (await waitFor(() => updates().at(-1)?.state === 'open' && 'open', 2000)) ?? null;
  // Причина — из меню у стрелки
  (await waitFor(() => card().querySelector('[data-testid="issue-close-reasons"]'), 2000))?.click();
  const notPlanned = await waitFor(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Закрыть как непланируемую'), 2000);
  notPlanned?.click();
  out.notPlanned = (await waitFor(() => updates().at(-1)?.stateReason === 'not_planned' && 'not_planned', 2000)) ?? null;
  (await waitFor(() => card().querySelector('[data-testid="issue-state-button"]')?.textContent.includes('Открыть заново') && card().querySelector('[data-testid="issue-state-button"]'), 2000))?.click();
  await waitFor(() => updates().at(-1)?.state === 'open', 2000);

  // Метки по L: два клика — один запрос через 400 мс
  const before = updates().length;
  keyOnSection('KeyL');
  await waitFor(() => option('feature'), 2000);
  option('feature').click();
  await sleep(100);
  option('bug').click();
  await sleep(150);
  out.labelsBatched = updates().length === before;
  out.labelsShown = labelsShown(card()).join(',');
  await sleep(500);
  out.labels = updates().slice(before).map((u) => (u.labels ?? []).map((l) => l.name).join('+')).join(',');
  // Новая метка: совпадений нет → «Создать метку»
  const searchBox = picker()?.parentElement.querySelector('input');
  if (searchBox) {
    setValue(searchBox, 'срочно');
    (await waitFor(() => option('срочно'), 2000))?.click();
  }
  out.labelCreated = (await waitFor(() => updates().at(-1)?.labels?.some((l) => l.name === 'срочно') && calls.find((c) => c[0] === 'labelCreate')?.[2], 3000)) ?? null;
  await sleep(200); // ответ на создание метки — до включения ошибки
  // Ошибка: значение возвращается, «Повторить» отправляет снова
  failUpdate = true;
  keyOnSection('KeyL');
  (await waitFor(() => option('срочно'), 2000))?.click();
  if (picker()) press(picker(), { key: 'Escape', code: 'Escape' });
  const retry = await waitFor(() => toast('нет сети'), 3000);
  out.rolledBack = labelsShown(card()).includes('срочно');
  failUpdate = false;
  retry?.click();
  out.retried = Boolean(await waitFor(() => updates().at(-1)?.labels && !updates().at(-1).labels.some((l) => l.name === 'срочно') && !labelsShown(card()).includes('срочно'), 3000));
  // Веха по M, срок, конфиденциальность
  keyOnSection('KeyM');
  (await waitFor(() => option('v1.0'), 2000))?.click();
  out.milestone = (await waitFor(() => updates().at(-1)?.milestone?.title, 2000)) ?? null;
  card().querySelector('[data-testid="meta-due"] button').click();
  (await waitFor(() => [...document.querySelectorAll('[data-testid="date-popover"] button')].find((b) => b.textContent === 'Через неделю'), 2000))?.click();
  const inWeek = new Date();
  inWeek.setDate(inWeek.getDate() + 7);
  const expected = `${inWeek.getFullYear()}-${String(inWeek.getMonth() + 1).padStart(2, '0')}-${String(inWeek.getDate()).padStart(2, '0')}`;
  out.due = (await waitFor(() => updates().at(-1)?.dueDate === expected && 'week', 2000)) ?? updates().at(-1)?.dueDate ?? null;
  card().querySelector('[data-testid="meta-confidential"]').click();
  out.confidential = (await waitFor(() => updates().at(-1)?.confidential, 2000)) ?? null;

  // Описание изменили на сервере: полоса, без выбора ничего не уходит; «Сохранить мою»
  card().querySelector('[data-testid="description-edit"]').click();
  const editor = await waitFor(() => card().querySelector('[data-testid="issue-description"] textarea'), 2000);
  setValue(editor, 'Моё описание');
  serverBody = 'Чужая правка';
  const sent = updates().length;
  card().querySelector('[data-testid="issue-description"] [data-testid="md-submit"]').click();
  out.conflict = Boolean(await waitFor(() => card().querySelector('[data-testid="description-conflict"]'), 3000)) && updates().length === sent;
  card().querySelector('[data-testid="description-save-mine"]')?.click();
  out.savedMine = (await waitFor(() => updates().at(-1)?.body === 'Моё описание' && !card().querySelector('[data-testid="issue-description"] textarea') && 'saved', 3000)) ?? null;
  serverBody = null;

  // «Отправить и закрыть» (Ctrl+Shift+Enter): сначала комментарий, потом закрытие
  const field = card().querySelector('[data-testid="md-editor"] textarea');
  setValue(field, 'Готово');
  const commentsBefore = calls.filter((c) => c[0] === 'commentAdd').length;
  press(field, { key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true });
  out.sendClose = (await waitFor(() => calls.filter((c) => c[0] === 'commentAdd').length > commentsBefore && updates().at(-1)?.state === 'closed' && 'closed', 3000)) ?? null;
  await sleep(100);
  out.reopenLabel = card().querySelector('[data-testid="md-submit-secondary"]')?.textContent ?? null;

  // Меню «⋯»: блокировка; удаление с вводом номера
  const menuItem = async (text) => {
    card().querySelector('[data-testid="issue-more"]').click();
    (await waitFor(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text), 2000))?.click();
  };
  await menuItem('Заблокировать обсуждение');
  out.locked = (await waitFor(() => updates().at(-1)?.locked, 2000)) ?? null;
  await menuItem('Удалить задачу');
  const confirm = await waitFor(() => document.querySelector('[data-testid="issue-delete-confirm"]'), 2000);
  out.deleteDisabled = Boolean(confirm?.disabled);
  setValue(document.querySelector('[data-testid="issue-delete-number"]'), '495');
  await sleep(30);
  confirm?.click();
  out.deleted = Boolean(await waitFor(() => calls.some((c) => c[0] === 'remove' && c[1] === 495) && !row(495) && !card(), 3000));

  // Новая задача: C
  keyOnSection('KeyC');
  const form = () => section().querySelector('[data-testid="issue-form"]');
  await waitFor(form, 2000);
  const titleField = form().querySelector('[data-testid="issue-form-title"]');
  out.formFocus = document.activeElement === titleField;
  out.createDisabled = Boolean(form().querySelector('[data-testid="md-submit"]')?.disabled);
  press(titleField, { key: 'Enter', code: 'Enter', ctrlKey: true });
  out.titleRequired = Boolean(await waitFor(() => form().querySelector('[data-testid="issue-form-title-error"]'), 1000));
  // Шаблон «Ошибка»: описание, заголовок и только существующие метки
  const template = (name) => [...form().querySelectorAll('[data-testid="issue-form-templates"] button')].find((b) => b.textContent === name);
  template('Ошибка').click();
  await sleep(50);
  const body = () => form().querySelector('[data-testid="md-editor"] textarea');
  out.template = [titleField.value, body()?.value, labelsShown(form()).join(',')];
  setValue(body(), '## Шаги\nмоё');
  template('Идея').click();
  const replace = await waitFor(() => [...document.querySelectorAll('.bg-gk-scrim button')].find((b) => b.textContent.trim() === 'Заменить'), 2000);
  out.replaceAsked = Boolean(replace);
  replace?.click();
  await sleep(50);
  out.replaced = [body()?.value ?? null, labelsShown(form()).join(',')];
  // «Создать ещё одну»: заголовок и описание очищаются, метки остаются
  setValue(titleField, 'Первая');
  form().querySelector('[data-testid="issue-form-another"]').click();
  form().querySelector('[data-testid="md-submit"]').click();
  await waitFor(() => calls.some((c) => c[0] === 'create'), 2000);
  await sleep(100);
  const created = calls.find((c) => c[0] === 'create')?.[1];
  out.created = created ? [created.title, created.labels.map((l) => l.name).join('+')] : null;
  out.another = Boolean(form()) && titleField.value === '' && body()?.value === '' && labelsShown(form()).includes('bug');
  // Отмена (Esc) — черновик в шапке раздела
  press(titleField, { key: 'Escape', code: 'Escape' });
  out.draftLink = Boolean(await waitFor(() => !form() && section().querySelector('[data-testid="issues-draft-link"]'), 2000));
  section().querySelector('[data-testid="issues-draft-link"]')?.click();
  await waitFor(form, 2000);
  out.draftBack = labelsShown(form()).join(',');
  setValue(form().querySelector('[data-testid="issue-form-title"]'), 'Вторая');
  form().querySelector('[data-testid="md-submit"]').click();
  out.opened = (await waitFor(() => !form() && card()?.dataset.number, 3000)) ?? null;
  out.firstInList = section().querySelector('[role="option"][data-number]')?.dataset.number ?? null;
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
