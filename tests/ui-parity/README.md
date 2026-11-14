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

## Переводы (Fluent, `src/i18n/index.ts`)

С 2026-11-12 ключ сообщения — семантический (`t('branch-already-exists', name)`), тексты — `crates/gorynych-core/i18n/{ru,en}/ui.ftl`.
`i18n-t.mjs` сверяет `t()` интерфейса с ответами настоящего `electron/i18n.cjs` (случаи `t` эталона ядра, ключ в них заменён
ключом Fluent); случаи с ключами `main.ftl` проверяет Rust (`gorynych-core/tests/parity.rs`).

```powershell
node tests/ui-parity/i18n-t.mjs $PWD
```

Сверки модулей со старыми копиями (таблицы ниже) — история перевода на TypeScript, они проходили на своих коммитах.
К коду после перехода на Fluent они как есть не применимы: старая копия вызывает `t()` с русским текстом, а
`components-compiled.mjs` сравнивает JS, в котором теперь ключи. Сверки состояния (`repo-store`, `sync-store`, `ci-store`)
держат прежний код у себя и идут на русском — они проходят. `hooks.mjs` достаёт `en.json` для старых копий из истории git.

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

## Автообновление (`src/state/syncStore.ts`)

Прежний код — раздел «Автообновление» `App.tsx` до 2026-11-12 (`onChanged`, `backgroundFetch`, проверка сервера,
`changeSyncMode`, переключатель `autoSync`); `sync-store.mjs` держит его дословно. Часы (`Date`, `setTimeout`), фокус окна,
`localStorage` и api подставные, ответы приходят в случайном порядке; каждый сценарий идёт дважды с одним зерном.
Сравнивается след: вызовы api со временем, загрузки, `repo:status`, записи строки состояния (`lib/syncStatus.ts` подменён
в хранилище хуком загрузки), настройки, уведомления и после каждого шага — состояние, расписание таймеров, слушатели.

```powershell
node tests/ui-parity/sync-store.mjs $PWD [сценариев, по умолчанию 400]
```

Проверено 22 заведомыми поломками хранилища (задержки 30/400/300/2000/2500 мс, `pendingFull`, сброс ошибок подряд,
`Retry-After`, `busy` при загрузке после проверки, права на чтение, уведомление только при ручном fetch, настройка
`autoSync`…). Не ловится одна: проверка пути в тике (`repo.path() !== path`) — при смене пути эффект и так останавливается.

## CI/CD графа (`src/state/ciStore.ts`)

Прежний код — раздел «CI/CD: статусы пайплайнов для графа» `App.tsx` до 2026-11-12 (опрос `cicd:pipelines`, отбор
закончившихся пайплайнов в `announceFinished`, `refreshForge`, `onForgeChanged`, опрос `forge` при `token.pending`,
подсказки значков); `ci-store.mjs` держит его дословно. Часы (`setTimeout`, `setInterval`), видимость окна и api
подставные, `.tsx` (`PipelineStatus`) грузится через esbuild. Сравнивается след: вызовы api со временем и аргументами,
правки `repo.forge`, закончившиеся пайплайны и после каждого шага — `pipelineMap`, подсказки, расписание таймеров.

```powershell
node tests/ui-parity/ci-store.mjs $PWD [сценариев, по умолчанию 400]
```

Проверено 19 заведомыми поломками (задержки 400 мс / 10 с / 60 с / 1,5 с, число повторов, скрытое окно, `NO_TOKEN`,
прежние статусы при ошибке, первый ответ без уведомления, отмена, повтор подсказки, порог 4 задания, путь в `refreshForge`…)
— каждую сверка ловит.

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
| `ContextMenu`, `PipelineStatus`, `RefBadge` | `fd6118d` |
| `Dialogs`, `TokenSetup` | `3b9565c` |
| `TitleBar`, `GraphViewMenu`, `NewTabPage`, `BranchSync`, `StatusBar`, `RevertToDialog`, `SearchBar`, `ci/common`, `ci/DagView`, `ci/Secrets` | `2021687` |
| `FileEditor`, `CloneDialog`, `BranchPicker` | `6806d93` |
| `ci/RunDialog`, `ci/JobLog` | `5c96e81` |
| `ci/CiEditor`, `ci/JobForm` | `2825ae8` |
| `ci/GitLabSchedules`, `ci/GitLabVariables` | `2277056` |
| `ci/CheckView`, `Guard` | `016de17` |
| `ActionBuilder`, `ActionRunner` | `6127f9f` |
| `ci/Runners`, `ci/CiPanel` | `d44b29a` |
| `InitRepoDialog`, `Toolbar` | `b2e41f5` |
| `Sidebar` | см. `git log -- src/components/Sidebar.tsx` |
| `RebaseView`, `CompareView` | см. `git log -- src/components/RebaseView.tsx` |
| `ConflictView`, `GuideDialog` | см. `git log -- src/components/ConflictView.tsx` |
| `CommitForm`, `CommitDetails` | см. `git log -- src/components/CommitForm.tsx` |
| `SettingsDialog` | см. `git log -- src/components/SettingsDialog.tsx` |
| `AuthDialog` | см. `git log -- src/components/AuthDialog.tsx` |
| `DiffView`, `ci/DraftTools` | см. `git log -- src/components/DiffView.tsx` |
| `FileView` | см. `git log -- src/components/FileView.tsx` |
| `CommitGraph` | см. `git log -- src/components/CommitGraph.tsx` |
| `CiView` | см. `git log -- src/components/CiView.tsx` |
| `App`, `boot`, `main` (вне `components/`: `../App`, `../boot`, `../main`; `main` стал `.ts`) | см. `git log -- src/App.tsx` |

Неиспользуемые имена `noUnusedLocals`/`noUnusedParameters` не пропускают, поэтому при переводе они убираются, а для
сверки та же правка делается в старой копии:

- `RebaseView` — мёртвый код `const ACTION = …` и `const a = ACTION[item.action]` в `PlanRow` (чистый поиск, результат
  не используется): `git show <коммит>~:src/components/RebaseView.jsx | grep -v "^const ACTION = " | grep -v "^  const a = ACTION"`.
- `SettingsDialog` — проп `onForgeChanged` не читается (App его по-прежнему передаёт), у `confirmBox` первый параметр
  стал `_id`: `git show <коммит>~:src/components/SettingsDialog.jsx | sed '/^  onForgeChanged,$/d; s/const confirmBox = (id, onYes)/const confirmBox = (_id, onYes)/'`.

Обе копии компилируются как TypeScript (`loader: 'tsx'`): он убирает неиспользуемые импорты (`COLUMNS` в `GraphViewMenu`),
и это не считается отличием. Импорт, у которого не используется ни одно имя, пропал бы целиком — у компонентов таких
импортов ради побочного действия нет. Компоненты из подпапок задаются путём: `ci/common`, `ci/DagView`.

## Главные ветки графа (`src/lib/mainBranches.ts`, `layoutGraph(commits, { pinned })`)

Новая возможность 2.0, прежней копии нет. `graph-main-branches.mjs` проверяет инварианты закреплённых дорожек на случайных
графах (с WIP и stash) и чистые функции выбора; без `pinned` раскладка обязана совпасть с прежней (это же сверяет `graph-layout.mjs`).

```powershell
node tests/ui-parity/graph-main-branches.mjs $PWD
```

## Построение графа (этап 4): хвосты, узкая колонка, stash

- `graph-stash.mjs` — кроме ожидаемых раскладок, сверяет подбор дорожки stash по интервалам занятости с прежним перебором всех
  узлов, рёбер и хвостов (300 случайных графов) и замеряет 40 stash на 20 000 коммитов: не больше чем вдвое медленнее, чем без stash.
- `graph-main-branches.mjs` — инварианты хвостов: по одному на каждого незагруженного родителя, ниже начала хвоста на его
  дорожке нет узлов.
- `graph-fit.mjs` — `fitMetrics(…, { squeeze: true })`: шаг ужимается до всех дорожек, не меньше `2 * dotR + 4`, точки при
  узком шаге, прижатие к краю только сверх этого; видно не меньше дорожек, чем без ужатия.

```powershell
node tests/ui-parity/graph-fit.mjs $PWD
```

## Догрузка истории (этап 5, `repoStore.loadMore`)

`repo-store.mjs` после сверки с прежним кодом проверяет догрузку на подставном сервере с длинной историей: порция дописывается,
повтор во время загрузки не уходит, `load` просит уже показанное число коммитов, устаревшая порция (другой отпечаток ссылок,
другая вкладка) отбрасывается, ошибка оставляет «Загрузить ещё».

## Поиск в графе (этап 6.3)

`search-marks.mjs` — `markSegments`/`searchWords` (`src/lib/searchMarks.ts`): куски склеиваются в исходный текст, размечены ровно
вхождения слов запроса. `matchCommit` берёт слова из того же `searchWords`.

```powershell
node tests/ui-parity/search-marks.mjs $PWD
```

## Вид таблицы коммитов (этап 6.5)

`graph-view.mjs` заменяет `i18n-graph-view.mjs` (тот читает `electron/i18n/en.json` и `translateKnown` и с перехода на Fluent не
запускается): `normalizeView`, `moveColumn` и значения по умолчанию новой `graphView.ts` против копии до раздела «Показывать».

```powershell
$old = "$env:TEMP\gv-old"
New-Item -ItemType Directory -Force "$old\lib" | Out-Null
cmd /c "git show f423922:src/lib/graphView.ts > `"$old\lib\graphView.ts`""
node tests/ui-parity/graph-view.mjs $old $PWD
```

## Задачи (новое в 2.0)

Эталона в 1.x нет: ожидаемые значения записаны в самих сверках, плюс случайные проверки свойств.

```powershell
node tests/ui-parity/lib-issues.mjs $PWD
node tests/ui-parity/issues-store.mjs $PWD
node tests/ui-parity/markdown-edit.mjs $PWD
node tests/ui-parity/lib-issue-board.mjs $PWD
```

- `lib-issues.mjs` — `src/lib/issues.ts` (фильтр, `#123`, имя ветки, склейка ленты, `applyPatch`, цвет текста метки) и
  `src/lib/issueDrafts.ts` (ключи, запись не чаще 500 мс, удаление пустого, ошибки `localStorage`) на подставных часах.
- `issues-store.mjs` — `src/state/issuesStore.ts` на заглушке API, ответы отдаются вручную в любом порядке: пять правил
  хранилища, откат `update`, временный комментарий, `loadMore`, предел страниц `refresh`, карточки; затем 300 случайных
  сценариев с инвариантами. Проверено от противного: без счётчика списка или карточки, без `keepPending`, со стиранием
  данных при ошибке, с записью после `forget` и без удаления черновика сверка падает.
- `lib-issue-board.mjs` — `src/lib/issueBoard.ts` (доска: `columnsFor`, `columnOf`, `patchForMove` на четырёх случаях и 3000 случайных
  переносах, хранение колонок).
- `markdown-edit.mjs` — `src/lib/markdownEdit.ts` (редактор Markdown: обёртка выделения, ссылка, приставки строк, продолжение и
  отступ списка, подсказки `#`/`@`, цитата). `toggleTask` (`lib/issues.ts`) — в `lib-issues.mjs`; документ флажков тот же, что в Rust-тесте
  `task_indices_match_toggle_task_in_interface` (`gorynych-cicd/tests/issues_markdown.rs`): номера совпадают.
