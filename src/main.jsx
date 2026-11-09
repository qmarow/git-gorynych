// Точка входа. Под Tauri сначала ставится `window.api` (слой совместимости с `electron/preload.cjs`) и заполняется
// `localStorage`: модули интерфейса читают их сразу при загрузке, поэтому сам интерфейс загружается только после этого.
// Под Electron `window.api` уже поставил preload, и слой ничего не делает.
import './platform/errors.js';
import { installTauriApi } from './platform/tauri.ts';

installTauriApi()
  .catch((error) => console.error('installTauriApi', error))
  // Отладочная проверка окна запускает свой сценарий вместо интерфейса (см. `GORYNYCH_DEV_SMOKE_SCRIPT` в gorynych-tauri)
  .then(() => (window.__GORYNYCH_SMOKE__ ? null : import('./boot.jsx')));
