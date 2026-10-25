# GitIdea

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
npm run electron:build            # установщик NSIS -> release/GitIdea-Setup-0.1.0.exe
npm run electron:build:portable   # один portable .exe без установки
npm run electron:preview          # собрать фронт и открыть как в проде, без упаковки
```

Если сборка падает на распаковке `winCodeSign` с ошибкой про симлинки, включите «Режим разработчика» в Параметры → Система → Для разработчиков, или запустите терминал от администратора.

Иконка приложения: положите `build/icon.ico` (256×256) — electron-builder подхватит её автоматически.

## Структура

```
electron/main.cjs        главный процесс: frameless-окно 1200×800, IPC
electron/preload.cjs     безопасный мост window.api
src/App.jsx              трёхпанельный layout
src/components/          TitleBar, Toolbar, Sidebar, CommitGraph, CommitDetails
src/lib/graphLayout.js   раскладка коммитов по дорожкам и пути рёбер
src/lib/format.js        даты, инициалы, цвета
src/data/mockRepo.js     демо-данные до подключения Git
```
