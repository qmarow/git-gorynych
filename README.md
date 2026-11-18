# git-Горыныч

Десктопный Git-клиент. Версия 2.0: ядро на Rust (`crates/`, Cargo Workspace), окно — Tauri v2,
интерфейс — React 19 + TypeScript (Vite) + Tailwind CSS v4 + Lucide Icons, переводы — Fluent. Версия 1.x на Electron
удалена из дерева; её код — в истории git (коммит `b63610b`).

## Требования (Windows)

- Rust (stable) и Node.js 20 LTS или 22 LTS
- Git for Windows
- WebView2 (в Windows 11 уже есть)

## Сборка

```powershell
npm install
npm run app:build    # vite build + cargo build --release -p gorynych-tauri --features custom-protocol
```

Результат — `target\release\gorynych-tauri.exe` (один файл, без инсталлятора). Он работает с настоящим профилем
пользователя и Keyring.

Инсталлятор NSIS (без подписи):

```powershell
npm run app:installer   # tauri build: vite build + release-сборка + NSIS
```

Результат — `target\release\bundle\nsis\git-Горыныч_<версия>_x64-setup.exe`. Установка — в профиль пользователя, без прав
администратора (`%LOCALAPPDATA%\git-Горыныч`), язык установщика — русский или английский. NSIS при первой сборке
скачивается сам. Без подписи Windows SmartScreen предупреждает при запуске установщика («Подробнее» → «Выполнить в любом случае»).

## Разработка

```powershell
npm run build                     # интерфейс в dist/ (встраивается в бинарь при компиляции)
npm run typecheck                 # типы интерфейса и актуальность ключей переводов
$env:GORYNYCH_DEV_ROOT = "$env:TEMP\gorynych-dev"; cargo run -p gorynych-tauri   # отладка на отдельном профиле
cargo test --workspace            # из PowerShell и после npm run build
```

Отладочная сборка без `GORYNYCH_DEV_ROOT` работает с настоящим профилем. Переводы — `crates/gorynych-core/i18n/{ru,en}/`
(`ui.ftl` — интерфейс, `main.ftl` — сообщения Rust); после правки `ui.ftl` — `npm run i18n:types`.

Иконка приложения — `build/icon.ico` и `build/icon.png` (исходник `build/icon.svg`), их берёт `tauri.conf.json`.

Настройки 2.0 — `%APPDATA%\com.ironxenot.gitgorynych\state.db` (SQLite) и системный Keyring. При первом запуске данные 1.x
из `%APPDATA%\git-Gorynych` переносятся один раз; старые файлы не удаляются.

## Структура

```
crates/                  Rust: core, storage, git, watcher, ci-linter, cicd, tauri (команды и окно)
crates/gorynych-tauri/bindings/commands.ts  типы команд для интерфейса (tauri-specta)
src/platform/tauri.ts    window.api поверх команд Tauri
src/state/               хранилища Zustand: репозиторий, автообновление, CI/CD
src/App.tsx              трёхпанельный layout
src/components/          TitleBar, Toolbar, Sidebar, CommitGraph, CommitDetails
src/lib/graphLayout.ts   раскладка коммитов по дорожкам и пути рёбер
src/lib/format.ts        даты, инициалы, цвета
src/lib/highlight.ts     подсветка синтаксиса и поиск в diff
src/vendor/hljs.js       highlight.js (BSD-3) одним файлом — пересборка: scripts/build-hljs.mjs
```
