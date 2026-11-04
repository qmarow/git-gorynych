// Страница-заглушка: проходит все команды каркаса. Любая ошибка оставляет окно скрытым от проверки и видна в #status.
const { invoke } = window.__TAURI__.core;

const status = document.getElementById('status');

// CSP должна запрещать eval: иначе политика не применилась, и дальше идти нельзя
function assertCspEnforced() {
  let evaluated = false;
  try {
    evaluated = new Function('return true')();
  } catch {
    return;
  }
  if (evaluated) throw new Error('CSP не действует');
}

async function main() {
  assertCspEnforced();
  const startup = await invoke('startup_status');
  if (startup.storageError) {
    status.textContent = JSON.stringify(startup, null, 2);
    return;
  }
  const language = await invoke('app_get_language');
  const tabs = await invoke('tabs_get');
  const recent = await invoke('recent_list');
  const last = await invoke('repo_get_last');
  const appearance = await invoke('appearance_get');
  const maximized = await invoke('window_is_maximized');
  status.textContent = JSON.stringify({ startup, language, tabs, recent, last, appearance, maximized }, null, 2);
}

for (const [id, command] of [
  ['minimize', 'window_minimize'],
  ['maximize', 'window_toggle_maximize'],
  ['close', 'window_close'],
]) {
  document.getElementById(id).addEventListener('click', () => invoke(command));
}

main()
  .then(() => invoke('frontend_ready'))
  .catch((error) => {
    status.textContent = `Ошибка: ${JSON.stringify(error)}`;
    invoke('window_show');
  });
