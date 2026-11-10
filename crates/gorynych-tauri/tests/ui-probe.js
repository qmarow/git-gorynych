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
  const editor = graph && fullFilePref === null ? await editorScenario(invoke, waitFor, sleep) : null;
  // Запись уходит в базу пачкой через 400 мс
  await sleep(1000);
  const report = { ...initial, graph, seeded, fullFilePref, editor, errors: [...(window.__gorynychErrors || [])], text: graph ? '' : text().slice(0, 3000) };
  await invoke('frontend_ready', { report: JSON.stringify(report) });
};

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
  $('diff-edit').click();
  const again = await waitFor(() => $('file-editor-input'), 10000);
  setter.call(again, again.value.replace('строка 3\n', 'строка 3 черновик\n'));
  again.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => $('file-editor-dirty'), 5000);
  const other = [...document.querySelectorAll('span, div')].find((el) => el.children.length === 0 && el.textContent === 'другой.txt');
  other?.click();
  const switched = await waitFor(() => !$('file-editor-input') && $('diff-edit') && !$('diff-edit').dataset.draft, 10000);
  (await waitFor(leaf, 5000))?.click();
  const marked = await waitFor(() => $('diff-edit')?.dataset.draft === '1', 10000);
  $('diff-edit')?.click();
  const restored = await waitFor(() => $('file-editor-input')?.value.includes('строка 3 черновик\n') && $('file-editor-dirty'), 10000);
  const untouched = !(await invoke('repo_read_file', { dir, path: FILE })).text.includes('черновик');
  steps.push(['draft', Boolean(switched), Boolean(marked), Boolean(restored), untouched]);
  await sleep(100);
  return { steps, partial };
}
