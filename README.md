# git-Горыныч

Десктопный Git-клиент в стиле GitKraken: Electron + React (Vite) + Tailwind CSS v4 + Lucide Icons.

## Требования (Windows)

- Node.js 20 LTS или 22 LTS
- Git (понадобится на следующих этапах)

## Запуск

```powershell
npm install
npm run electron:dev
```

`electron:dev` поднимает Vite на http://127.0.0.1:5173, ждёт его и открывает окно Electron с горячей перезагрузкой. DevTools открываются в отдельном окне.

## Сборка .exe

```powershell
npm run electron:build            # установщик NSIS -> release/git-Gorynych-Setup-0.1.0.exe
npm run electron:build:portable   # один portable .exe без установки
npm run electron:preview          # собрать фронт и открыть как в проде, без упаковки
```

Если сборка падает на распаковке `winCodeSign` с ошибкой про симлинки, включите «Режим разработчика» в Параметры → Система → Для разработчиков, или запустите терминал от администратора.

Иконка приложения — `build/icon.ico` (исходник `build/icon.svg`), electron-builder подхватывает её автоматически.

Настройки хранятся в `%APPDATA%\git-Gorynych`. При первом запуске после переименования они один раз копируются из папки `GitIdea` (или ещё более старой `GitKraken Clone`).

## Структура

```
electron/main.cjs        главный процесс: frameless-окно 1200×800, IPC
electron/preload.cjs     безопасный мост window.api
src/App.jsx              трёхпанельный layout
src/components/          TitleBar, Toolbar, Sidebar, CommitGraph, CommitDetails
src/lib/graphLayout.js   раскладка коммитов по дорожкам и пути рёбер
src/lib/format.js        даты, инициалы, цвета
src/lib/highlight.js     подсветка синтаксиса и поиск в diff
src/vendor/hljs.js       highlight.js (BSD-3) одним файлом — пересборка: scripts/build-hljs.mjs
src/data/mockRepo.js     демо-данные до подключения Git
```
