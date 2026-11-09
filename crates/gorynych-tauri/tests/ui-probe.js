// Зонд настоящего интерфейса 1.x на слое совместимости (tests/app_smoke.rs). Подставляется только в отладочной сборке
// (`GORYNYCH_DEV_UI_PROBE`). Интерфейс открывает последний репозиторий сам; зонд ждёт, пока в окне появится граф коммитов,
// проверяет `localStorage` и сообщает итог через `frontend_ready`.
window.__GORYNYCH_PROBE__ = async (initial) => {
  const { invoke } = window.__TAURI__.core;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (condition, ms) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (condition()) return true;
      await sleep(100);
    }
    return false;
  };
  const text = () => document.body.innerText || '';
  // Тест кладёт в репозиторий коммит «Начало»: он виден в графе, когда интерфейс прочитал репозиторий через `repo:load`
  const graph = await waitFor(() => text().includes('Начало'), 30000);
  // Настройка из прошлого запуска приходит из SQLite, если профиль WebView новый
  const seeded = localStorage.getItem('probe.saved');
  localStorage.setItem('probe.saved', 'сохранено');
  // Запись уходит в базу пачкой через 400 мс
  await sleep(1000);
  const report = { ...initial, graph, seeded, errors: [...(window.__gorynychErrors || [])], text: graph ? '' : text().slice(0, 3000) };
  await invoke('frontend_ready', { report: JSON.stringify(report) });
};
