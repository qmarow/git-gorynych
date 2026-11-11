# Сверка модулей интерфейса при переводе на TypeScript

Модуль `src/**/*.js` переводится в `.ts` без изменения поведения. Сверка: прежний `.js` из git и новый `.ts`
запускаются в одном процессе Node (24+ исполняет `.ts` сам) на одних и тех же входах, результаты сравниваются.

Прежние файлы достаются из коммита до перевода. Перенаправление через `cmd` сохраняет байты (кириллица в PowerShell
иначе портится):

```powershell
$old = "$env:TEMP\ui-old"
New-Item -ItemType Directory -Force "$old\lib", "$old\i18n" | Out-Null
cmd /c "git show f21c665~:src/lib/graphLayout.js > `"$old\graphLayout.js`""
cmd /c "git show f21c665~:src/lib/scheme.js > `"$old\scheme.js`""
'{"type":"module"}' | Set-Content "$old\package.json"
node tests/ui-parity/graph-layout.mjs $old "$PWD\src\lib"

cmd /c "git show e035232~:src/i18n/index.js > `"$old\i18n\index.js`""
cmd /c "git show e035232~:src/lib/graphView.js > `"$old\lib\graphView.js`""
node tests/ui-parity/i18n-graph-view.mjs $old $PWD
```

- `graph-layout.mjs` — `graphLayout` и `scheme`: 400 случайных графов, все плотности и ширины, обе схемы.
- `i18n-graph-view.mjs` — `t`, `tj`, `translateKnown` на ru/en/неизвестном языке, `normalizeView`, `moveColumn`.
  `en.json` грузится хуком `registerHooks` (Vite импортирует JSON без `with { type: 'json' }`); `?lang=…` даёт отдельный
  экземпляр модуля на каждый язык.

Остальные сверки берут прежние файлы из коммита перед переводом в папку `<old>/lib/` и запускаются так же:
`node tests/ui-parity/<сверка>.mjs <old> <корень репозитория>`. Общие хуки — `hooks.mjs` (`i18n` старой копии подменяется
текущим `src/i18n/index.ts`, у каждого языка свой экземпляр модулей).

```powershell
$old = "$env:TEMP\ui-old"
New-Item -ItemType Directory -Force "$old\lib" | Out-Null
foreach ($f in 'format','stashName','dnd','syncStatus','avatars') { cmd /c "git show d40db43~:src/lib/$f.js > `"$old\lib\$f.js`"" }
'{"type":"module"}' | Set-Content "$old\package.json"
node tests/ui-parity/lib-small.mjs $old $PWD
```

| Сверка | Модули | Коммит перевода |
|---|---|---|
| `lib-small.mjs` | `format`, `stashName`, `dnd`, `syncStatus`, `avatars` | `d40db43` |
| `lib-batch2.mjs` | `inlineDiff`, `cron`, `servers`, `ansi` | `e84e6c0` |
| `lib-commit.mjs` | `commitMsg`, `commitPrefs` | `1b412f6` |
| `lib-batch3.mjs` | `ciSnippets`, `platform`, `guardRules` | `7c8e902` |
| `lib-highlight.mjs` | `highlight` (корпус — настоящие файлы репозитория) | `a05d364` |
| `lib-actions.mjs` | `actions` | `8282755` |
| `lib-appearance.mjs` | `appearance` (подставные `document` и `matchMedia`) | `cf2a17a` |
| `lib-syntax.mjs` | `syntax.tsx` (обе копии через esbuild; сравнение элементов вместе с `key`) | `d68beaa` |

Для `syntax` прежний файл — `lib/syntax.jsx` (расширение `.jsx`, а не `.js`).

Проверять сами сверки: внести в старую копию заведомое изменение и убедиться, что сверка падает.
Ключи React (`key`) в `renderToStaticMarkup` не видны, такое изменение сверка не ловит.

## Состояние репозитория (`src/state/repoStore.ts`)

Прежнего модуля нет: код жил в `App.jsx`. Сверка `repo-store.mjs` держит прежний код (`loadRepo`, `showBlank`, `showTab`,
`rememberActiveTab`, слияние `repo:status`) дословно поверх подставных `useState`/`useRef` и гоняет его вместе с хранилищем:
400 случайных сценариев, ответы `repo:load` в случайном порядке, ошибки, `commitsUnchanged`. Сравниваются состояние,
тождество массива коммитов, запросы (`known`) и итог каждой загрузки. Старая копия не нужна:

```powershell
node tests/ui-parity/repo-store.mjs $PWD
```

Проверено заведомыми поломками хранилища (9 штук: отмена загрузок, тихая загрузка чужой вкладки, сохранение выделения,
`truncated`, ошибка тихой загрузки, сравнение `ci`, сброс `filesByHash`, `onSwitch`, выделение из кэша) — каждую сверка ловит.

## Компоненты (`src/components/*.tsx`)

Компонент, переведённый только типами, сверяется по скомпилированному JS: `components-compiled.mjs` прогоняет старый `.jsx` и
новый `.tsx` через esbuild (как Vite) и требует совпадения до символа. Расширение в импортах других компонентов не считается
отличием. Правка поведения при переводе (даже `null` → `undefined`) сверку роняет.

```powershell
$old = "$env:TEMP\ui-old-c"
New-Item -ItemType Directory -Force "$old\components" | Out-Null
foreach ($n in 'Toasts','CodeText','Resizer','AppLogo','Loader','TooltipLayer') { cmd /c "git show <коммит>~:src/components/$n.jsx > `"$old\components\$n.jsx`"" }
node tests/ui-parity/components-compiled.mjs $old $PWD Toasts CodeText Resizer AppLogo Loader TooltipLayer
```

| Компоненты | Коммит перевода |
|---|---|
| `Toasts`, `CodeText`, `Resizer`, `AppLogo`, `Loader`, `TooltipLayer` | `348133e` |
| `ContextMenu`, `PipelineStatus`, `RefBadge` | см. `git log -- src/components/RefBadge.tsx` |
