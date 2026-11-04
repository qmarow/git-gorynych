# git-Горыныч 2.0 — архитектурный план миграции (Electron → Rust + Tauri v2)

Этот файл — постоянная память проекта между сессиями. Читай его первым.
Полная целевая спецификация: «Архитектура git-Горыныч 2.0 (Rust + Tauri v2)» (документ от 3 ноября 2026).

## Исходная точка (1.x)

- `electron/` — главный процесс на Node.js (CommonJS), 15 856 строк. **Эталонная спецификация поведения.**
- `src/` — React 19 JSX (26,2 тыс. строк), монолит `App.jsx`.
- Данные пользователя: `%APPDATA%\git-Gorynych\` (`settings.json`, `remote-credentials.json`,
  `gitlab-tokens.json`, `cicd-settings.json`, `language.json`, `backgrounds/`) + `localStorage` renderer'а.
- appId: `com.ironxenot.gitgorynych`.

## Правила работы (обязательны)

1. **1:1 Feature Parity.** Перед переписыванием модуля прочитать исходный `.cjs` в `electron/`, выписать
   все функции, граничные случаи, регулярные выражения и коды ошибок — и только потом писать Rust.
   Конспект каждого перенесённого модуля — в doc-комментарии вверху соответствующего `.rs`.
2. **`electron/` не удалять до завершения Фазы 4** — это эталон.
3. **Сквозная типизация.** Всё, что пересекает IPC, — `#[derive(serde::Serialize, serde::Deserialize, specta::Type)]`.
   Никаких `serde_json::Value` там, где можно описать структуру.
4. **Компиляция на каждом шаге:** после каждого модуля — `cargo check --workspace` и `cargo test --workspace`.
   Не переходить к следующему файлу, пока текущий не собирается.

### Соглашения по совместимости с UI 1.x

- Коды ошибок на проводе — **ровно те же строки**, что в 1.x (`AUTH`, `PROTECTED`, `WIP_CONFLICT`, …):
  UI проверяет их по `error.code === '…'`. `ErrorCode` сериализуется в `SCREAMING_SNAKE_CASE`.
- Сообщения пока переводятся по русскому ключу (как `t()` в 1.x) через словарь `electron/i18n/en.json`;
  переход на семантические ключи Fluent — постепенно, `i18n/{ru,en}/main.ftl`.
- `GK_TEST_USERDATA` / `GK_TEST_SSH_DIR` в релизном коде **отсутствуют**: тестовые подмены — только
  через `#[cfg(test)]` и внедрение зависимостей (`SecretStore`, явные пути).

## Cargo Workspace (`crates/`)

| Крейт | Назначение |
|---|---|
| `gorynych-core` | Доменные модели, `GorynychError` (`thiserror` + `specta::Type`), классификатор stderr git на `RegexSet`, локализация (Fluent `fluent-bundle` + переходный `en.json`). |
| `gorynych-storage` | Единая SQLite (`rusqlite`, WAL) вместо 5 JSON-файлов и `localStorage`; персистентный `undo_history`; секреты в системном `keyring`; встроенные `--internal-askpass` / `--internal-cred-helper` через Named Pipes (Windows) / Unix Sockets. |
| `gorynych-git` | Гибридный Git-движок: чтение через `gix` / `git2`, диффы `imara-diff`, симуляция interactive rebase в памяти (`git2::Repository::merge_trees`), запись через `tokio::process::Command` (`git`), актор `RepoSession` с `enum RepoAction`. |
| `gorynych-watcher` | `notify` + `notify-debouncer-full`: раздельно `.git/refs`, `.git/index` (`IndexSync`) и рабочая копия; `RemoteRepoWatcher` (ETag / `ls-remote`, экспоненциальный backoff 60 с → 10 мин). |
| `gorynych-cicd` | Трейт `CiCdProvider` на `reqwest` (rustls): GitLab, GitHub, Gitea/Forgejo, Bitbucket; слияние `gitlab.cjs` + `cicd/*`; шифрование секретов `crypto_box` (sealed box); Docker-раннер. |
| `gorynych-ci-linter` | YAML без потери комментариев (`tree-sitter-yaml` / `yaml-edit`), 4 группы проверок (`Base`, `GitLab`, `Other`, `Scripts`), сверка тегов с живыми раннерами, Pre-commit Guard на `regex::RegexSet`. |
| `gorynych-tauri` | Бинарь Tauri v2: команды `tauri-specta`, нативное меню, окно без рамки, CSP, суб-режим askpass. |

Граф зависимостей: `core` ← `storage` ← `git` ← `watcher`; `core` ← `ci-linter` ← `cicd`; `storage` ← `cicd`; все ← `tauri`.

Закрепление версий: `specta = "=2.0.0-rc.26"` и в dev-зависимостях `specta-typescript`/`specta-serde = "=0.0.13"` — этого требует
`tauri-specta 2.0.0-rc.26` (он же тянет `tauri ^2`). Не поднимать `specta` отдельно: rc.27 несовместим. Самая свежая `tauri` на crates.io — 3.0.0-alpha, нам нужна v2.

Проверка паритета: `tests/fixtures/gen-parity.cjs` прогоняет настоящие `electron/*.cjs` и пишет `parity.json`, а Rust обязан его воспроизвести
(`crates/gorynych-core/tests/parity.rs`). Тот же приём применять к следующим чистым модулям. При изменении эталона — перегенерировать из корня: `node crates/gorynych-core/tests/fixtures/gen-parity.cjs`.

## Маппинг файлов `electron/*.cjs` → Rust

| Исходник (1.x) | Цель (2.0) | Фаза | Статус |
|---|---|---|---|
| `errors.cjs` | `gorynych-core::error` | 1 | ✅ |
| `i18n.cjs` + `i18n/en.json` | `gorynych-core::i18n` (хранение языка — в `storage`, `en.json` пока подключён из `electron/`: перед Фазой 4 перенести в крейт) | 1 | ✅ |
| `lineDiff.cjs` | `gorynych-core::line_diff` | 1 | ✅ |
| `credentials.cjs` | `gorynych-storage::{credentials, secrets, ssh_keys, askpass}` ✅; `detectServer` (HTTP) — `gorynych-cicd`, Фаза 2 | 1 | ✅ |
| Хранилища из `main.cjs`, `cicd/settings.cjs`, стек undo из `actions.cjs`, `actions.v1` | `gorynych-storage::{db, preferences, workspaces, repo_providers, undo, custom_actions}` | 1 | ✅ |
| Перенос данных 1.x | `gorynych-storage::{migrator, legacy_crypto, local_storage}` | 1 | ✅ |
| `guard.cjs`, `ci.cjs`, `ciEdit.cjs`, `ciCheck*.cjs`, `cicd/tagCheck.cjs` | `gorynych-ci-linter` | 2 | 📝 конспект |
| `gitlab.cjs` + `cicd/*` | `gorynych-cicd` | 2 | 📝 конспект |
| `git.cjs`, `actions.cjs`, `rebase.cjs`, `restore.cjs`, `compare.cjs`, `fileHistory.cjs`, `conflicts.cjs`, `init.cjs`, `clone.cjs` | `gorynych-git` | 3 | — |
| `watch.cjs`, `indexSync.cjs`, `remoteWatch.cjs` | `gorynych-watcher` | 3 | — |
| `main.cjs`, `preload.cjs`, `system.cjs` | `gorynych-tauri` | 1 (каркас ✅) / 4 | 🔶 |

## Хранилище 2.0

- БД: `%APPDATA%\com.ironxenot.gitgorynych\state.db`, `PRAGMA journal_mode = WAL; synchronous = NORMAL; foreign_keys = ON`.
- Таблицы: `app_preferences`, `workspaces` (`kind` = `tab`|`recent`: логика дублей у них разная), `repo_providers`, `undo_history`, `undo_blobs`, `custom_actions`, `credential_logins`, `credential_servers`, `legacy_ci_tokens` (+ служебная `meta` для версии схемы и маркера миграции).
- `undo_blobs`: снимки файлов `fileSnapshot` (до 20 МБ на версию) не хранятся в JSON. `kind` и `payload` в `undo_history` для хранилища непрозрачны: типизированная запись и обработчики — в `gorynych-git` (Фаза 3). Там же решить вопрос общего размера: 1.x держал их только в памяти, здесь они переживают перезапуск.
- Новые таблицы (например, для `credentials`) — только новой записью в `MIGRATIONS`; выпущенные миграции не менять.
- Секреты — только в Keyring, сервис `com.ironxenot.gitgorynych`; в БД хранится лишь `keyring_account_id`.
- Миграция 1.x → 2.0 однократная и идемпотентная (маркер в `meta`); старые файлы не удаляются.

## Дорожная карта

- **Фаза 1** — каркас workspace, `gorynych-core`, `gorynych-storage` (SQLite + keyring + мигратор + askpass).
- **Фаза 2** — `gorynych-ci-linter`, `gorynych-cicd`.
- **Фаза 3** — `gorynych-git`, `gorynych-watcher`.
- **Фаза 4** — UI на TypeScript + Zustand + TanStack Query, Fluent, удаление `electron/`, инсталляторы.

## Конспект исходников Фазы 1 (снят в сессии 1)

### `errors.cjs` (174 стр.)
- `GitError { message, code='GIT', hint=null, details='', stdout='', data=null }`; `toJSON()` → `{code,message,hint,details,data?}` (stdout не сериализуется).
- `classify(stderr, stdout)` проверяет `${stderr}\n${stdout}`, правила по порядку (первое совпадение; все `/i`):
  `PROTECTED` → `HOOK_DECLINED` → `FORBIDDEN` → `HOST_KEY` → `AUTH` (включая `passphrase`, `SSH_AUTH_SOCK`, `Permission denied (publickey`) →
  `NOT_FOUND` → `REJECTED_NON_FF` → `DIVERGED` → `CONFLICT` → `DIRTY` → `NETWORK`. Порядок значим — при переносе на `RegexSet` брать минимальный индекс.
- `fromProcessError(error, stdout, stderr)`: `ENOENT` → `GIT_MISSING`; `killed` → `TIMEOUT` (details = stderr||message); правило → его code/message/hint;
  иначе `GIT` с первой непустой строкой details без префикса `fatal:|error:` (по умолчанию «Ошибка Git»).
- `serializeError(non-GitError)` → `{code:'UNKNOWN', message, hint:null, details:''}`.
- Единственная структура `data`: `WIP_CONFLICT` из `actions.cjs::inspectWip` →
  `{from, to, files, list[{path,status,untracked,staged}] (≤50), untracked, conflicted[], overlap[] (≤50), detached}`.
- Все коды в `electron/` (85): BAD_ARGS INVALID_NAME NOT_FOUND UNSUPPORTED NOT_FOUND_REF UP_TO_DATE NO_REMOTE HISTORY_STALE FORBIDDEN NO_COMMITS CONFLICT UNKNOWN NO_IDENTITY NOT_FAST_FORWARD NETWORK DIRTY BAD_REMOTE YAML_ERROR RATE_LIMIT PLAN_STALE PATCH_FAILED NO_UPSTREAM NO_TOKEN NO_STORAGE NO_DOCKER AUTH VALIDATION UPSTREAM_GONE TOO_LARGE STAGE_EXISTS REJECTED_NON_FF PROTECTED OPERATION_IN_PROGRESS NO_STASH NO_OPERATION NO_ENCRYPTION NOT_FOUND_PATH MARKERS_LEFT HISTORY_EMPTY GIT DETACHED BRANCH_EXISTS BAD_EMAIL ALREADY_REPO WIP_CONFLICT TOO_MANY TIMEOUT TARGET_EXISTS TAG_EXISTS STAGE_NOT_EMPTY ROOT_COMMIT OPEN_FAILED NO_TERMINAL NO_PROVIDER NOT_MERGED NOT_GITLAB NOT_A_REPO NOT_A_DIR NOTHING_TO_STASH NOTHING_TO_DISCARD LOCAL_CHANGES JOB_EXISTS HUNK_STALE HOST_KEY HOOK_DECLINED HISTORY_ROOT HISTORY_PUSHED GIT_TOO_OLD GIT_MISSING GITLAB_ERROR EXISTS EMPTY_MESSAGE DOCKER DIVERGED DEFAULT_BRANCH CURRENT_BRANCH CHANGED_ON_DISK CANCELLED BRANCH_IN_USE BINARY BAD_PLAN API_ERROR ALREADY_IN_BRANCH (+ KEYGEN_FAILED, NO_SSH_KEYGEN из credentials.cjs).

### `i18n.cjs` (62 стр.)
- Языки только `ru`/`en`, по умолчанию `ru`; ключ = русский текст; `en.json` — плоский словарь (4099 ключей, 518 КБ).
- `t(msg, ...args)`: для `ru` — сам ключ, для `en` — `dict[msg] ?? msg`; подстановка `/\{(\d+)\}/g`, индекс вне диапазона оставляет `{N}` как есть, `null/undefined` → ''.
- `setLanguage` игнорирует неизвестный язык, пишет `language.json` `{language}`, слушатели вызываются только при реальной смене. `locale()` → `en-GB` / `ru-RU`.

### Хранилища 1.x
- `settings.json` (main.cjs): `{ lastRepo, tabs[], activeTab, recentRepos[{path,name,openedAt}] (≤30, дедуп без учёта регистра на Windows), appearance{scheme,background,material,base,…} }`.
- `language.json`: `{ language }`.
- `cicd-settings.json`: `{ repos: { "<host>/<path без .git, lower>": { provider∈{gitlab,github,gitea,bitbucket}|null, apiBase|null, savedAt } } }`; `normalizeBase` — только http(s), без хвостовых `/`.
- `remote-credentials.json` (credentials.cjs): `{ hosts: {"https://host[:port]"|"ssh://host": entry}, repos: {"<serverKey>/<path lower>": entry}, servers: {hostname: {kind, base, savedAt}} }`,
  `entry = { method∈{password,token,ssh}, url, username, secret{enc|plain}, keyPath, passphrase{enc}, apiToken{enc}, savedAt }`; `enc` = Electron safeStorage (DPAPI) base64 —
  на Windows расшифровывается из Rust (`gorynych-storage::legacy_crypto`, проверено на настоящем Electron 37). Под другим пользователем Windows, на macOS и Linux запись становится «нужно ввести заново».
- `gitlab-tokens.json` (gitlab.cjs): `{ hosts: {base: {enc}}, repos: {"<base>/<path lower>": {enc}} }` → `migrateLegacy` прикрепляет токен как `apiToken` ко входу репозитория. В 2.0 переносится в таблицу `legacy_ci_tokens` и входом git не становится; `migrateLegacy` и порядок `authOptions` реализовать в `gorynych-cicd` (Фаза 2).
- Undo/Redo (actions.cjs): только в памяти, `Map<repo, {undo[], redo[]}>`, лимит 50, новая запись очищает redo; коды `HISTORY_EMPTY/STALE/ROOT/PUSHED`.
- Миграция профиля 1.x: однократное копирование из `%APPDATA%\GitIdea` или `GitKraken Clone` с маркером `.migrated`.

### `credentials.cjs` (816 стр.) — функции к переносу
`parseTarget, keyOf, repoPathOf, repoKeyOf, entryFor, describeEntry, describe, guessKind (CLOUD: github.com/gitlab.com/bitbucket.org/codeberg.org), serverKind, serverInfo, parseServer, setServer, listServers, forgetServer, defaultTokenUser (gitlab→oauth2, bitbucket→x-token-auth, иначе git), detectServer (probes /api/v4/version, /api/v3/meta, /api/v1/version, /rest/api/1.0/application-properties; таймаут 6 с), save (валидации и сообщения!), serverBase, attachApiToken, clear, forgetLogin, apiLoginFor (API_TOKEN_PREFIX glpat-|gloas-|glsoat-), envFor (GIT_CONFIG_COUNT/KEY_i/VALUE_i, helper на хост, сброс чужих helpers пустым значением), sshCommand (accept-new, ConnectTimeout=20, BatchMode либо Password/KbdInteractive=no), listSshKeys (NOT_KEYS, ≤64 КБ, пара .pub или id_*, сортировка), suggestKeyName, generateSshKey (ed25519 | rsa 4096, суффиксы _2,_3…, комментарий ≤200), sshUrlFor, publicKeyOf`.

## Конспект исходников Фазы 2 (снят в сессии 3)

### ⚠ Поправки к графу зависимостей (выяснились при чтении)
- `ci-linter` вызывает git (`ls-files -s -z`, `for-each-ref`, `symbolic-ref origin/HEAD`, `rev-parse --verify`, `log -n 50`, `status --porcelain -z`,
  `diff --cached -U0`) и `lineDiff.cjs` (`diffLines`, `toHunks`, Фаза 3). Решение: в `ci-linter` — трейт `RepoView` (ls_files/branches/default_branch/
  history/dirty/staged_diff) + перенести `lineDiff` в `gorynych-core::line_diff` (он чистый, 4,7 КБ). Тогда `core` ← `ci-linter` остаётся верным.
- `cicd` использует `ci.detectCi/parseYaml/loadCi/previewCi` (форма запуска, сверка тегов) и `credentials.apiLoginFor/serverKind/serverBase/attachApiToken`
  → `cicd` зависит от `ci-linter` и `storage`. Новый граф: `core` ← `ci-linter` ← `cicd`; `storage` ← `cicd`.
- Тестовые подмены `GK_TEST_USERDATA` (settings.cjs, gitlab.cjs), `GK_DOCKER_BIN` (runnerSetup) → внедрение путей/бинаря, `#[cfg(test)]`.

### Выбор крейтов (последствия для 1:1)
- **YAML — главный риск.** 1.x использует `yaml` (eemeli) c: `LineCounter` (строка любого ключа), `uniqueKeys:false` (дубликаты не ошибка, берётся
  последний + отдельный поиск `duplicates()` до глубины 4), `merge:true` (`<<`), `maxAliasCount:1000`, кастомный тег `!reference` (seq →
  `{__reference:[…]}`), `prettyErrors`, предупреждения кроме `TAG_RESOLVE_FAILED`; в `ciEdit` — Document API с сохранением комментариев, `flow`,
  `spaceBefore`, `indentSeq` и сериализация `toString({lineWidth:0, flowCollectionPadding:false, indentSeq})`. Нужны: (а) парсер с позициями
  (`saphyr`/`yaml-rust2` c маркерами) для чтения и (б) CST без потерь (`yaml-edit`/rowan или `tree-sitter-yaml`) для правок. `minimalPatch`
  переносит в исходник только изменённые строки и страхуется `sameData()` — значит CST может быть неидеален, но сериализация «нормализованного»
  текста обязана быть детерминированной.
- **Регулярки.** `rules:if` / `only:variables` GitLab на сервере исполняет RE2 → крейт `regex` даже точнее JS. Но пользовательские правила
  Pre-commit Guard написаны в синтаксисе JS (флаги `imsu`, возможны lookaround/обратные ссылки) → `fancy-regex`; невалидные — в `invalid[]`, как сейчас.
- **Sealed box GitHub/Gitea:** `crypto_box` (feature `seal`) совместим с libsodium (`nonce = BLAKE2b-192(epk‖pk)`, вывод `epk ‖ box`, base64) —
  ручной BLAKE2b из `sealedbox.cjs` и `vendor/tweetnacl.cjs` не переносить, только тест-вектор.
- HTTP: `reqwest` (rustls), таймаут 20 с; артефакты потоком, таймаут 10 мин; логи — хвост ≤ 1,5 МБ (`MAX_LOG`) + исходный `size`.

### `guard.cjs` (173) → `ci_linter::guard`
- `scanStaged(cwd,{rules,exclude})`: `git diff --cached --no-color --no-ext-diff -U0 --diff-filter=ACMR`; ошибка `unknown revision|ambiguous argument 'HEAD'` →
  пустой diff (первый коммит); не строка → `GIT` «Не удалось прочитать изменения». Возвращает `scanDiff(...) + ms`.
- `compile(rules)`: правило `{id,label,pattern,flags,files,level,category}`; флаги фильтруются до `[imsu]`; `files` → расширения (`split /[,\s]+/`, срезать `*.`/`.`, lower).
- `scanDiff`: имя из `+++ b/…` (также `"b/…"`), `/dev/null` пропуск; `@@ … +N` задаёт номер строки; считаются `+` и ` ` строки; маркер игнора
  `/gorynych-ignore|gitidea-ignore|guard-ignore/i`; строка обрезается до 4000 символов; **на строку одна находка — самое строгое правило** (`block`=2 > `warn`=1,
  при равенстве — первое; на `block` прерывание); `text` = trim, ≤240; для `category:'secret'` совпадение маскируется (`mask`: ≤8 → `••••••••`, иначе
  4 символа + `•`×min(12,len−6) + 2 последних) и `start/end` пересчитываются; лимит 300 находок (`truncated`). Итог
  `{findings,invalid,files,addedLines,truncated,skippedFiles,blocked}`.
- `globToRe`: `\`→`/`, срез `./`; хвост `/` → `**`; `**/`→`(?:.*/)?`, `**`→`.*`, `*`→`[^/]*`, `?`→`[^/]`; без `/` в шаблоне — совпадение по имени в любой папке; флаг `i`.

### `ci.cjs` (1101) → `ci_linter::{detect, load::*}`
- `SYSTEMS` (порядок важен): gitlab `.gitlab-ci.yml|.yaml`; github `.github/workflows/*.ya?ml`; gitea `.gitea/workflows`; forgejo `.forgejo/workflows`;
  jenkins `Jenkinsfile`; bitbucket `bitbucket-pipelines.yml`; circleci `.circleci/config.ya?ml`; azure `azure-pipelines.ya?ml`; travis; drone; woodpecker
  (`.woodpecker.yml` + `.woodpecker/*.ya?ml`). Файлы в папке — по алфавиту.
- `readText`: черновики `overrides` (путь нормализуется `\`→`/`, срез `./`,`/`) приоритетнее диска; >512 КБ → `TOO_LARGE`; BOM срезается. `safeRelative` из git.cjs.
- **GitLab** `loadGitlab`: обход include рекурсивно (сначала include, потом свои ключи — основной файл переопределяет), глубина ≤6, только `local`
  (glob `*`/`**`/`?`, обход ≤6 уровней, без `.git`/`node_modules`, сортировка); остальные типы (`remote/project/template/component`) показываются, не
  разрешаются. Глобальные ключи `default include stages types variables workflow image services cache before_script after_script spec`; `variables` и
  `default` сливаются глубоко, прочие — замена. Повторное задание — `deepMerge` (массивы заменяются). `extends` (строка|массив) с детекцией циклов и
  предупреждениями; `!reference [job, key…]` (глубина ≤10, массивы «расплющиваются»). Этапы: объявленные → `['.pre',…,'.post']`, иначе
  `.pre build test deploy .post`; необъявленный этап вставляется перед `.post` с `undeclared:true`. Скрытые задания (`.name`) → `templates[]` с `usedBy`.
  `gitlabJob` наследует `image/before_script/after_script/services/tags` из `default` и глобальных с учётом `inherit:default` (bool|список);
  `stage` по умолчанию `test`, `when` — `on_success`; `manual` также если любое правило `when: manual`; `rulesEditable` — правила только из `if/when/allow_failure`.
  `_raw` (jobs, jobDefs, globalDefs, resolveJob, resolveReferences, globals, declaredStages, stageNames, includes) идёт только в проверку и удаляется.
- **GitHub/Gitea/Forgejo** `loadGithub`: `on` или `data[true]` (YAML 1.1); `runsOnLabels` (map → `labels`), `runsOnGroup`; needs → name; колонки
  `levelize` по needs («Старт», «После шага N»; цикл → уровень 0). **Bitbucket**: default, затем `branches/tags/bookmarks/pull-requests/custom`; `parallel`
  (массив или `{steps}`), `stage`. **CircleCI**: workflows → levelize; `approval` — ручное; неизвестный ref → orb (`kind:trigger`). **Azure**: stages | jobs
  (dependsOn → levelize) | steps. **Jenkins** (Groovy, без YAML): `stage('x') {` + `extractBlock` (учёт `'`,`"`,`'''`,`"""`, `//`-комментариев), вложенность,
  `parallel {`, `steps`/`when`/`agent`, `input` = ручное, `@Library(...)` → includes, Declarative/Scripted. Прочие — `loadGeneric` (`schemeUnsupported`).
- `loadCi(root, file, {skipHistory})` → `{systems, current:{system,title,file,jobCount,…result,history(≤50, %H␟%s␟%an␟%aI),dirty,check}}`; у каждого
  файла `hash` (sha1 сырого текста с диска) и `draft`. `previewCi(root,file,drafts)` = то же по черновикам без истории. Исключение загрузчика → один
  `error` вместо падения; ошибка `checkCi` → `{issues:[],…,failed}`.

### `ciEdit.cjs` (457) → `ci_linter::edit`
- Запись только `*.ya?ml` и `Jenkinsfile`, не внутри `.git` (`BAD_ARGS`); `saveFile`: строка ≤512 КБ (`TOO_LARGE`), `baseHash` ≠ sha1 текущего →
  `CHANGED_ON_DISK` (+hint); сохраняются EOL (`\r\n` если был) и BOM; атомарно через `${full}.gk-tmp-${pid}` + rename; `{path,hash,created}`.
- `fileState(raw)` → `{text(\n, без BOM), eol, bom, hash|null}`; `readFile` + `exists`; `diffDraft` → `toHunks(diffLines)`.
- `applyEdit(content, op)` — операции `addJob deleteJob renameJob setJob addStage renameStage deleteStage moveStage`; коды `INVALID_NAME`
  (пусто, >255, перевод строки, зарезервированное слово), `JOB_EXISTS`, `STAGE_EXISTS`, `STAGE_NOT_EMPTY`(+hint), `NOT_FOUND`, `YAML_ERROR` (ошибки
  в файле / не словарь / stages не список), `BAD_ARGS` (поле не из `EDITABLE_FIELDS`, пустой script, недопустимый `when`). Правила записи:
  `when:on_success` и `allow_failure:false` не пишутся; правило без `if` и `when` получает `when: on_success`; новый этап автоматически
  дописывается в `stages`; `stages` создаётся (flow) после `include`; `addJob` ставит задание после последнего того же этапа, с пустой строкой
  перед ним, script по умолчанию `echo "<name>"`; rename/delete правят ссылки `needs/dependencies/extends` (delete не трогает `extends`), `notes[]`
  без повторов. Стиль списков (`indentSeq`) определяется по файлу регуляркой.
- `createFromTemplate({system})`: `gitlab` → `.gitlab-ci.yml` (текст переводится), `github` → `.github/workflows/ci.yml`; существует → `EXISTS`.

### `ciCheck.cjs` + `ciCheckBase.cjs` → `ci_linter::check`
- Issue: `{id, severity: error|warning|info, title, when, how, why, fix, file, line, job, scenario}`; дедуп по `id|file|line|title`; сортировка
  severity → file (localeCompare) → line; `stats`. YAML-ошибки первыми (`yaml-syntax` / `yaml-warning`); исключение проверки → `check-failed` (info).
  Маршрут: gitlab (только при `_raw`, + defaultBranch и множество веток из heads/remotes без префикса remote) | github/gitea/forgejo | bitbucket |
  jenkins | circleci | azure; для прочих — `loader-warning` из `warnings`.
- База: Дамерау—Левенштейн (без регистра, разница длин >3 → 99), `suggest` (без `-`/`_`, порог min(2, max(1, ⌊len/3⌋))), `didYouMean`;
  `Positions.line(file, keyPath)` с откатом к ближайшему существующему родителю, `find`, `duplicates`; `repoIndex` (режимы из `ls-files -s`, папки,
  `hasFile/hasDir` с откатом на fs, `read` ≤512 КБ, `glob`); `defaultBranch`: `origin/HEAD` → main → master → `'main'`.
- `parseExpr` (токены `$VAR`/`${VAR}`, строки в `'`/`"`, `/re/flags`, `null`, `== != =~ !~ && ||`, скобки; приоритет `||` < `&&` < сравнение;
  тексты ошибок как у GitLab: одиночный `=`, слово без кавычек, справа от `=~` не регулярка…) и `evalExpr` (неизвестная переменная = null; пустая
  строка = ложь; `=~` принимает и переменную со строкой `/…/flags`).
- `durationSeconds` (`1 week 2 days`, `30m`, `3600`, `and`/запятые; mo=30 д, y=365 д); `SECRET_NAME`, `SECRET_VALUE` (glpat, ghp_/gho_/…, github_pat_,
  AKIA, xox?-, PRIVATE KEY, AIza, sk_live_), `looksLikeVarRef`.

### `ciCheckGitlab.cjs` (1350) — каталог (169 id) + прогон сценариев
- Справочники: `JOB_KEYS`, `DEFAULT_KEYS`, `WORKFLOW(_RULE)_KEYS`, `RULE_KEYS`, `ARTIFACT/CACHE/ENV_KEYS`, `REPORTS` + `REMOVED_REPORTS` (cobertura,
  performance, license_*), `RETRY_WHEN`, `ENV_ACTIONS`, `TIERS`, `PIPELINE_SOURCES`, `ONLY_REFS/KEYS`, `PREDEFINED` (≈190 переменных, экспорт),
  `CONTENT_VARS` (непредсказуемые → `uncertain`), `OLD_VARS` (CI_BUILD_* → замена). Тексты `how` строятся через `rejected(msg)` — **сообщение GitLab
  в кавычках остаётся английским дословно** (`jobs:<name>:environment name can't be blank` и т. п.).
- Группы id: структура (`no-visible-jobs`, `stages-*`, `types-removed`, `default-unknown-key`, `workflow-*`, `job-unknown-key`, `job-name-long`…),
  include (`include-*` ×7), extends/reference (`extends-*`, `reference-missing`, `template-unused`), script/stage/when/start_in, needs/dependencies
  (`needs-*`, `dependencies-*`, `needs-cycle`), parallel/matrix/retry/timeout/coverage/inherit/trigger/release/pages, rules/only (`rule-*`,
  `rules-*`, `only-*`, `rule-unreachable`, `workflow-all-never`, `pipeline-source-value`), переменные и секреты (`var-*`, `variable-*`,
  `secret-value`, `secret-name`), image (`image-*` ×8), artifacts/reports (×9), cache (×12), environment (×12, включая сверку `on_stop`).
- `simulate()`: сценарии `push-default` (ветка по умолчанию), `push-branch` (`feature/example`), `mr` (detached MR !12), `tag` (`v1.0.0`),
  `schedule`, `web` + скрытый `push-branch-mr` (`CI_OPEN_MERGE_REQUESTS`). Для каждого: workflow:rules → первое подходящее правило (переменные
  правила применяются), иначе блок; задание: rules (первое совпадение; `when: manual` в rules ⇒ `allow_failure:false` по умолчанию) | `when:never`
  | only/except (по умолчанию `only: [branches, tags]`; без only/except задание попадает в MR-пайплайн, если workflow разрешил). Пайплайн создан, если
  есть задания вне `.pre/.post`. Межсценарные выводы: `duplicate-pipelines`, `mr-nothing-runs`, `pipeline-never`, `job-never-runs`; внутри сценария:
  `scenario-empty`, `scenario-needs-missing` (warning при uncertain), `scenario-dependency-missing`, `scenario-on-stop-missing`,
  `scenario-release-no-tag`, `manual-blocking`. Результат `scenarios[{id,title,ref,vars,created,reason,uncertain,jobs,excluded,problems,workflowRule}]`.
- ⚠ Уровни severity в каталоге снимались скриптом приблизительно — при переносе каждого правила сверять с исходником.

### `ciCheckOther.cjs` (598) — GitHub (58 id `gh-*` + `secret-in-script`), Bitbucket (16 `bb-*`), Jenkins (10 `jenkins-*`), CircleCI (7), Azure (3)
- GitHub: ключи верхнего уровня/событий/фильтров/job/step/permissions, inputs (≤10, типы, choice), `cronProblem` (5 полей, имена месяцев/дней,
  диапазоны, `/0`, частота <5 мин при `*` в часах → `gh-cron-frequent`; UTC-предупреждение), `RETIRED_RUNNERS`, `OLD_ACTIONS` (версия, severity,
  текст, рекомендуемая), pwn-request, script-injection `${{ github.event… }}`, set-output/set-env, локальные actions до checkout, needs-цикл.
- Bitbucket: `BB_STEP`, `BB_CACHES` (встроенные), `BB_SIZES 1x…32x`, max-time, первый шаг manual, docker как сервис, деплой дважды.
- Jenkins: баланс скобок/кавычек (`blockAt`, `stripNested`), agent, stages, дубли/пустые этапы, `JENKINS_POST`.

### `ciCheckScripts.cjs` (478) — 23 id
- `imageInfo(image)` (срез `docker.io/`, `library/`; alpine/busybox; таблица `IMAGE_TOOLS`; `$` в имени → null), `splitCommands` (`&& || ; |`, кавычки,
  `#` после пробела), `words` (снимает `VAR=…`, `sudo exec time command env nohup`), `INSTALLS` (доустановка инструмента гасит `tool-missing`),
  `BUILD_OUTPUT` (папки сборки не требуются в репо), `YARN_BUILTIN`. Проверки: cd/exec/script/файлы сборки, npm/yarn/pnpm lock и скрипты,
  pip/poetry, make + цель, Dockerfile/compose/kubectl-манифесты, apt в alpine / apk в debian, bash в alpine, docker без dind.

### `cicd/tagCheck.cjs` (112)
- `requirements`: GitLab — все задания (кроме trigger), `untagged` если тегов нет; GitHub-семейство — `runsOnLabels`, пропуск `${{ }}`; Bitbucket — `runs-on`.
  Группировка по отсортированному набору меток (lower). Живой = `online|busy`. `runner-untagged` (нет живого с `runUntagged !== false`),
  `runner-tags-missing` (`missing[]`, три варианта `why`: есть, но не в сети / каждый тег есть, но не все у одного / тега нет ни у кого).

### `gitlab.cjs` (1240) → `cicd::gitlab`
- `parseRemoteUrl`: scp-вид `user@host:path(.git)` и URL http/https/ssh/git+ssh → `{protocol,host,port,path}` (для ssh протокол `https`, порт null).
- `detectRemote`: remote `[preferred, origin, …]`; `siteBase` для SSH — из `credentials.serverBase(host)`; override API из `cicd-settings` (срез
  `/api/v4`); GitLab ли: provider из настроек, иначе `serverKind==='gitlab'` || есть старый токен || (`kind===null` && /gitlab/i в хосте).
- Авторизация (по порядку): `login` (вход репозитория) → `legacy` (старый токен репо, DPAPI) → `legacy-shared` (хоста) → `login-shared`.
  `verifyLogin` — `/user` + токен-инфо; при `AUTH` повтор как Bearer (OAuth); `FORBIDDEN` → `/personal_access_tokens/self` чтобы назвать scope;
  нужен `api` или `read_api`; кэш по sha256(base␤secret)[:24], `bad` — на 10 мин, NETWORK/RATE_LIMIT не кэшируются (`unknown`). `migrateLegacy`
  прикрепляет старый токен как `apiToken` ко входу (password/ssh) и удаляет его из `gitlab-tokens.json`.
- `request(base, token, …)`: `${base}/api/v4…`, `PRIVATE-TOKEN` или `Authorization: Bearer`; 401 `AUTH`, 403 `FORBIDDEN` (hint про scope при /scope/),
  404 `NOT_FOUND`, 400/409/422 `VALIDATION` с переводом (`PHRASES`, `FIELD_NAMES`, hint для mask/cron/key), 429 `RATE_LIMIT`, прочее `GITLAB_ERROR`.
  `fetchAll` — per_page 100, ≤3 страниц. Проект кэшируется 10 мин по `base|path|последние 6 символов токена`; `accessLevel` = max(project, group).
- Эндпоинты: pipelines (+`/jobs`, `/bridges`, cancel/retry), jobs (trace, cancel/play/retry), `/pipeline` (запуск), variables (CRUD, `VAR_KEY`
  `/^[A-Za-z0-9_]+$/`), `pipeline_schedules` (CRUD + play/take ownership; `CRON_RE` 5 полей), `ci/lint`, `merge_requests`, runners (`/projects/:id/runners`,
  `/runners/:id`, `/managers`, `/jobs`, `POST /user/runners`). `branchHeads` — ветки через API с ETag/304 (≤20 стр., таймаут 8 с, кэш ≤300 URL,
  429 c `retry-after`) → `null`, если токена нет (тогда `ls-remote`) — **используется `remoteWatch` (Фаза 3)**.

### `cicd/*` → `cicd::{http, models, settings, providers::*, runner_setup, service}`
- `http.request(ctx, method, path, {query,body,text,raw,notFound,accept,timeout})`: авторизация **только на тот же host** (подписанные ссылки
  артефактов/логов); `User-Agent: git-Gorynych`; ошибки: сеть/таймаут `NETWORK`; 401 `AUTH`; 403 → `RATE_LIMIT` при `x-ratelimit-remaining: 0`, иначе
  `FORBIDDEN` (+`scopeHint`); 404 `NOT_FOUND`; 400/409/422 `VALIDATION` «<label>: <message>»; 429 `RATE_LIMIT`; прочее `API_ERROR`; 202/204 → JSON|null.
- `models`: `NO_CAPS` (22 флага), `reasons()`, `githubStatus(status, conclusion)`, `bitbucketStatus(state)`, `aggregate` (порядок `failed running pending
  preparing waiting_for_resource scheduled manual canceling canceled created success skipped`; failed+allowFailure = success; все skipped → skipped),
  `bySha`, `platformFromLabels`, `runner(fields)` (editable = !virtual). Модели PipelineRun/Job/Step, CiRunner, CiArtifact, CiSecretVariable — см. шапку.
- `settings`: ключ `host/path(lower, без .git)`, `PROVIDERS {gitlab,github,gitea,bitbucket}`, `normalizeBase` (схема ≠ http(s) → `BAD_ARGS`, без схемы
  — `https://`), пустые provider+apiBase удаляют запись, нет хранилища → `NO_STORAGE`. Переезжает в таблицу `repo_providers`.
- `index` (сервис): `resolveRemote` (provider: настройки → `serverKind` → `.gitea|.forgejo/workflows` → gitea); `apiBaseFor` (github.com →
  api.github.com, иначе `/api/v3`; gitea `/api/v1`; bitbucket.org → `api.bitbucket.org/2.0`, иначе `/rest/api/1.0`; override дополняется суффиксом);
  заголовки: GitHub `Bearer` + `X-GitHub-Api-Version: 2022-11-28`, Gitea `token …` или Basic, Bitbucket Bearer или Basic (кроме `x-token-auth`);
  `verify` с кэшем (как у GitLab); коды `NO_REMOTE`, `NO_PROVIDER`, `NO_TOKEN`, `UNSUPPORTED` (`require_` по capability + `why`), `BAD_ARGS`.
  `ACTION_CAPS` (pipeline.cancel/retry/retry-failed, job.retry/cancel/play). `runForm`: GitHub/Gitea — workflow_dispatch inputs; Bitbucket — custom-пайплайны
  с variables; GitLab — `spec:inputs` из заголовка до `---` и переменные с `description`. `runnersPrune` — offline, не shared/virtual, editable.
  `runnerRegister` — имя `git-gorynych-xxxx`. `secretSave`: имя `/^[A-Za-z_][A-Za-z0-9_]*$/`, не `GITHUB_*`, значение ≤48 КБ. `setSettings` сбрасывает кэш проверок.
  `runnerTagCheck` — метки живых раннеров: свои, затем виртуальные, без повторов без учёта регистра.
- Возможности провайдеров: GitLab — всё (действия при scope `api`, раннеры — Maintainer ≥40, schedules, stages); GitHub — без паузы/настроек раннера,
  без запуска с переменными, без отмены задания; Gitea — запуск/артефакты/раннеры(удаление, токен)/секреты, без cancel/retry; Bitbucket — запуск с
  переменными, cancel/retry, секреты; без раннеров и артефактов.
- `runnerSetup`: команды копирования (GitLab: docker/linux/macos/windows; GitHub `config.sh|cmd`; Gitea `act_runner register --no-interactive`),
  `shq`/`psq`, `forContainer` (localhost → `host.docker.internal`); Docker: `ENOENT` → `NO_DOCKER`, демон недоступен → `NO_DOCKER`, иначе `DOCKER`;
  контейнеры с метками `ru.gorynych.runner{,.provider,.repo,.labels}`, имя `gorynych-<provider>-<slug>-xxxx` (проверка `/^gorynych-[a-z0-9-]+$/`),
  образы `gitlab/gitlab-runner`, `myoung34/github-runner`, `gitea/act_runner`; при сбое регистрации GitLab — `rm -f` контейнера и удаление раннера на сервере.

## Журнал сессий

- 2026-11-03 — Сессия 1: создан этот план и конспект исходников Фазы 1. Cargo Workspace **не начат**:
  облачная среда не имела доступа к crates.io (403), а по правилу №4 код без `cargo check` не пишем.
  Следующий шаг: убедиться, что `curl https://index.crates.io/config.json` отвечает 200, затем Шаг 2 (workspace) и Шаг 3.
- 2026-11-04 — Сессия 2: crates.io всё ещё недоступен из облака (`index.crates.io` — DNS не резолвится напрямую и 403
  через прокси; `static.crates.io`, `crates.io` — 403 policy denial). Rust 1.97 / cargo в контейнере есть, реестра нет.
  Код не писался (правило №4). Варианты разблокировки: (а) разрешить домены `crates.io`, `index.crates.io`,
  `static.crates.io` в claude.ai → Settings → Capabilities; (б) вести сессию из десктоп-приложения с shell на
  локальной машине и запускать `cargo` там; (в) положить в проект `cargo vendor`-каталог, собранный локально.
- 2026-11-04 — Сессия 4 (локально, Windows, Rust 1.99.1, crates.io доступен — запрет снят): создан workspace из 7 крейтов
  (всё, кроме `gorynych-core`, — заглушки; `gorynych-tauri` пока без зависимости `tauri`). Готов `gorynych-core`: `error`, `i18n`, `line_diff`,
  паритет с `electron/*.cjs` по фикстуре и контракт TS. Сверка кодов: 85 в main-процессе; `BUSY` живёт только в UI и в `ErrorCode` не входит.
  `.ftl` содержат только сообщения классификатора, и в рабочем коде Fluent пока не вызывается. Известное расхождение `(?i)` с JS — в шапке `error.rs`.
  Следующий шаг: `gorynych-storage` (`db`, затем `credentials`/`askpass`/`migrator`).
- 2026-11-04 — Сессия 4, продолжение: готова SQLite-часть `gorynych-storage` (схема v1, настройки, вкладки и недавние, провайдеры, undo, действия).
  Эталон — `crates/gorynych-storage/tests/fixtures/gen-parity.cjs`, но только для `settings.cjs`: логика `main.cjs` и `actions.cjs` проверена ручными тестами,
  потому что эти модули нельзя запустить без Electron. `GorynychError.data` теперь в `Box` (ошибка была 240 байт).
  Следующий шаг: `credentials` + `secrets` (keyring), `ssh_keys`, `askpass`, затем `migrator`.
- 2026-11-04 — Сессия 4, продолжение: готовы `credentials`, `secrets`, `ssh_keys`, `core::js` (схема v2). Эталон — сценарий через настоящий `credentials.cjs`
  (`GK_TEST_USERDATA` включает режим `plain`), воспроизводится шаг за шагом на обоих языках. Секрет в Keyring лежит под случайным `login-<hex>`, и одна запись
  Keyring может использоваться несколькими входами: удалять только через `Credentials::release`. Нечитаемый секрет 1.x = идентификатор без записи в Keyring.
  Лимит Windows Credential Manager — 2560 байт на секрет: более длинный токен даёт `NO_ENCRYPTION`.
- 2026-11-04 — Сессия 4, продолжение: готов `askpass`. `Credentials::git_auth` → `AuthBroker::session` → окружение для git; сессию держать живой до конца процесса git, `Drop` отзывает токен.
  В `gorynych-git` (Фаза 3) `networkOptions` из `actions.cjs` собирать так же, а `GIT_TERMINAL_PROMPT=0` и `BatchMode` по умолчанию добавлять там. `run_helper()` — первая строка `main` в `gorynych-tauri`.
  `ssh` не умеет передавать флаг в `SSH_ASKPASS`, поэтому режим задаёт `GORYNYCH_ASKPASS=1`. Сквозные тесты — `crates/gorynych-tauri/tests/auth_helper.rs`: настоящие git и ssh, в том числе путь с кириллицей.
  Проверено только на Windows; на Linux и macOS канал не запускался. `interprocess`: клиент, ушедший раньше `accept`, теряется (ERROR_NO_DATA) — пробуждающее соединение держать открытым.
- 2026-11-04 — Сессия 4, продолжение: готов `migrator` (схема v3), `gorynych-storage` завершён. `migrate_from_1x` вызывать при старте, до открытия окна: при недоступном Keyring он вернёт `NO_ENCRYPTION` без маркера и повторится при следующем запуске; `MigrationReport.issues` показать пользователю.
  `localStorage` читается из копии LevelDB (`local_storage.rs`), поэтому отдельный экспорт из 1.x не нужен. Значения лежат в `app_preferences` под прежними ключами строкой как есть: UI 2.0 читает их так же (`preference::<String>`).
  Проверка на настоящем Electron: `cargo test -p gorynych-storage --test electron_migration -- --ignored`; повторять при обновлении Electron. На настоящем профиле пользователя перенос не запускался.
- 2026-11-04 — Сессия 4, продолжение: готов каркас Tauri 2.12 (окно без рамки, Mica/Acrylic, CSP, перенос при старте, команды окна/вкладок/недавних/языка/оформления, `bindings/commands.ts`). Страница `ui/` — заглушка до Фазы 4.
  ⚠ Запуск бинаря без флагов — настоящее приложение с настоящим профилем (`%APPDATA%\git-Gorynych`) и Keyring. Тесты и ручные проверки только с `GORYNYCH_DEV_ROOT=<временная папка>` (есть лишь в debug). На настоящем профиле приложение ещё не запускалось: перед этим спросить пользователя.
  Известное: модульные тесты крейта не должны вызывать код Tauri — такой exe на Windows падает с 0xc0000139 (нет манифеста comctl); проверки с Tauri делать через настоящий бинарь (`tests/app_smoke.rs`). CSP: Tauri добавляет nonce к `<script>`, поэтому `script-src 'none'` скрипт не блокирует; действие CSP проверяет `assertCspEnforced` в `ui/app.js`.
  Для инсталлятора в Фазе 4 нужна фича `tauri/custom-protocol` и `bundle.active`. macOS-часть окна (`TitleBarStyle::Overlay`) не собиралась и не запускалась. Кнопки окна и события развёртывания и фокуса проверены только компиляцией.
  Фаза 1 завершена. Следующий шаг: Фаза 2, `gorynych-ci-linter`, начать с `core`-части: `guard`, затем выбор YAML-парсера (см. конспект, главный риск).
