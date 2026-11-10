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

Проверять сами сверки: внести в старую копию заведомое изменение и убедиться, что сверка падает.
Ключи React (`key`) в `renderToStaticMarkup` не видны, такое изменение сверка не ловит.
