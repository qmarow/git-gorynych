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
| `gorynych-git` | Git-движок: всё через `tokio::process::Command` (`git`), как в 1.x; `RepoEngine` с `enum RepoAction`. Планируется чтение через `gix` / `git2`, диффы `imara-diff`, симуляция rebase через `git2::Repository::merge_trees` — за тем же API (см. журнал, решения пользователя пока нет). |
| `gorynych-watcher` | `notify`: `watch` (`.git` и рабочая копия), `IndexSync`, `RemoteRepoWatcher` (API GitLab с ETag через трейт `BranchHeadsApi` или `ls-remote`). Паузу между тиками (15 с → 5 мин) решает интерфейс, как в 1.x. |
| `gorynych-cicd` | Трейт `CiCdProvider` на `reqwest` (rustls с провайдером `ring`: `aws-lc` требует cmake и nasm; сертификаты из хранилища ОС): GitLab, GitHub, Gitea/Forgejo, Bitbucket; слияние `gitlab.cjs` + `cicd/*`; шифрование секретов `crypto_box` (sealed box); Docker-раннер. |
| `gorynych-ci-linter` | YAML без потери комментариев (`tree-sitter-yaml` / `yaml-edit`), 4 группы проверок (`Base`, `GitLab`, `Other`, `Scripts`), сверка тегов с живыми раннерами, Pre-commit Guard на `regress` (семантика `RegExp`). |
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
| `guard.cjs` | `gorynych-ci-linter::{guard, repo}`, `gorynych-core::js_regex` | 2 | ✅ |
| `parseYaml` из `ci.cjs`, `Positions` из `ciCheckBase.cjs` | `gorynych-ci-linter::yaml` | 2 | ✅ |
| `toYaml` (`YAML.stringify`) | `gorynych-ci-linter::yaml_write` | 2 | ✅ |
| Остальное в `ci.cjs` (без вызова `checkCi`) | `gorynych-ci-linter::{detect, load}`, `safeRelative` — `gorynych-core::paths` | 2 | ✅ |
| `ciEdit.cjs` | `gorynych-ci-linter::edit` | 2 | ✅ |
| `ciCheck*.cjs`, `cicd/tagCheck.cjs` | `gorynych-ci-linter::check` | 2 | ✅ |
| `gitlab.cjs` + `cicd/*`, `detectServer` из `credentials.cjs` | `gorynych-cicd` | 2 | ✅ |
| `git.cjs`, `conflicts.cjs`, `fileHistory.cjs`, `compare.cjs` | `gorynych-git::{run, read, diff, write, conflicts, history, compare}` | 3 | ✅ |
| `actions.cjs`, `rebase.cjs`, `restore.cjs`, `init.cjs`, `clone.cjs` | `gorynych-git::{actions, network, rebase, restore, init, clone}` | 3 | ✅ |
| `watch.cjs`, `indexSync.cjs`, `remoteWatch.cjs` | `gorynych-watcher::{watch, index_sync, remote_watch}` | 3 | ✅ |
| `main.cjs`, `preload.cjs`, `system.cjs` | `gorynych-tauri` (`repo:*` и `clone:*` — `commands/repo.rs`; `creds:*` — `commands/creds.rs`; `cicd:*` и `gitlab:*` — `commands/cicd.rs`; диалоги, открытие, терминал, картинка фона — `commands/desktop.rs`; мосты — `bridge.rs`) | 1 (каркас ✅) / 4 | 🔶 |

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
- **Регулярки.** `rules:if` / `only:variables` GitLab на сервере исполняет RE2 → при переносе `evalExpr` решить: `regex` точнее сервера, `JsRegex` точнее 1.x.
  Пользовательские правила Pre-commit Guard написаны для JS → `gorynych_ci_linter::js_regex::JsRegex` на `regress` (не `fancy-regex`: у него `\b`, `\w`, `\d` учитывают Unicode, и результат молча изменился бы). Поверх `regress` исправлен разбор `\u` без флага `u`; известные отличия от V8 — в шапке `js_regex.rs`, а тесты держат их точный список.
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
  Фаза 1 завершена.
- 2026-11-04 — Сессия 4, продолжение: Фаза 2 начата, готов `guard` (+ `js_regex`, `repo::RepoView` пока с одним методом `staged_diff`). Эталон: `node crates/gorynych-ci-linter/tests/fixtures/gen-guard-parity.cjs` прогоняет настоящие `guard.cjs`, `RegExp` из V8 и правила по умолчанию из `src/lib/guardRules.js`. Команда `repo:guard-scan` в Tauri пока не подключена.
  Позиции в `GuardFinding` — единицы UTF-16 (интерфейс передаёт их в `String.slice`). Правила по умолчанию живут в интерфейсе и приходят параметром.
  Три ошибки 1.x исправлены по решению пользователя: `guard.rs` теперь намеренно отличается от `electron/guard.cjs` (шапка `guard.rs`, «Отличия от 1.x»; эти сценарии исключены из сравнения в `FIXED_IN_2X`, новое поведение проверяют модульные тесты), а в `src/lib/guardRules.js` граница слова у `todo-remove` и `do-not-commit` задана через `\p{…}` с флагами `iu`, потому что `\b` не понимает кириллицу.
- 2026-11-04 — Сессия 4, продолжение: сравнение YAML-парсеров с эталоном `electron/vendor/yaml.cjs`. Корпус: 40 настоящих CI-файлов, 63 из `node_modules`, 402 из YAML Test Suite (в репозиторий не добавлен, код сравнения — во временной папке сессии).
  Чтение: `saphyr-parser` — настоящие файлы: данные 38/38 и 63/63, строки ключей 39/39 и 63/63 (с поправками: блочный скаляр начинается на строке `|`; коллекция с якорем или тегом — на первом элементе), ложных принятий 0. Расхождения только в ключах-коллекциях, `!!set`/`!!omap`/`!!binary` и пустых ключах. Комментарии он не отдаёт. `yaml-rust2` хуже (ложный отказ на настоящем файле, строки 31/39), `yaml-edit` принимает 71 файл, отвергаемый эталоном, `tree-sitter-yaml` без декодирования значений.
  Что теряется при `saphyr` относительно 1.x: другой текст ошибки YAML, только первая ошибка (строка совпала в 66 из 93 случаев Test Suite), данные только до места ошибки. Настоящий пример: `.gitlab/ci/rules.gitlab-ci.yml` из GitLab — 1.x отвергает его на строке 303, но показывает все 442 ключа.
  Правка: на 255 правках настоящего `applyEdit` ни один подход не лидирует (текст совпал: прототип по позициям 194, `yaml-edit` 182, оба упрощённые). Перенос `merge`/`!reference` учесть: `ciEdit.parse` работает без `merge`.
  Ошибка 1.x: `renameJob` теряет комментарий в строке ключа. `deleteJob` задания с якорем, на который есть ссылки, падает без кода ошибки: `Unresolved alias`.
  **Решение пользователя:** `saphyr-parser` для чтения + точечная правка текста по его позициям + свой перенос `stringifyString`; каждая правка проверяется повторным разбором и сравнением данных, при расхождении — отказ, а не переформатирование всего файла. Полный перенос eemeli/yaml отклонён как слишком дорогой.
- 2026-11-04 — Сессия 4, продолжение: готов `ci_linter::yaml` (`parse_yaml`, `Document`: `to_value`, `line`, `duplicates`, `key_lines`, `get_in`) и `core::js::number_to_string`. Узлы хранят точные байтовые позиции для будущей правки; индексы `saphyr` считаются в символах, перевод — в `Offsets`. Конец блочной коллекции неточен (заходит на комментарии до следующего узла): учесть в `edit`.
  Эталон: `gen-yaml-parity.cjs` (настоящие `parseYaml` и `Positions`). Внешний корпус (809 файлов) в репозиторий не добавлен, команда прогона — в шапке `tests/yaml_parity.rs`. Отличия от 1.x — в шапке `yaml.rs`.
  Guard: закрыты ещё две утечки, маскируются все совпадения секретных правил на строке.
  Следующий шаг: `detect` и загрузчики `ci.cjs` (`RepoView` дополнять по мере надобности), затем `edit`.
- 2026-11-05 — Сессия 5: готовы `yaml_write` (`YAML.stringify` при `lineWidth: 0`), `detect`, `load` (все загрузчики, `load_ci`, `preview_ci`), `core::paths::safe_relative`; `RepoView` дополнен `ci_log` и `ci_status`. `CiLoaded::gitlab` — бывший `_raw`, его потребитель `check` ещё не перенесён, поэтому поля `check` в `CiCurrent` пока нет.
  Эталон: `gen-load-parity.cjs` (настоящий `previewCi`, `checkCi` заменён заглушкой). В репозитории 106 случаев, каждая 40-я подмена значения и 7942 случая `YAML.stringify`. Вне репозитория проверены и совпали: все 6975 подмен (`null`, `0`, списки и т. п. в каждом поле; падения 1.x воспроизведены с тем же текстом `TypeError`) и 40 настоящих файлов, каждый как файл 6 систем. Команды — в шапке `tests/load_parity.rs`.
  Поля IPC: значение из файла как есть — `yaml::Value` (`timeout` бывает и числом, и строкой); `null` и отсутствие поля на проводе не различаются, интерфейс 1.x проверен на это поиском, а не запуском. Отличия от 1.x — в шапках `yaml_write.rs` (алиасы в `raw` пишутся целиком, это встречается в настоящих файлах GitLab), `gitlab.rs`, `pipelines.rs`.
  В 1.x найдена особенность, сохранена: `inherit: {default: [список]}` наследует всё, потому что `inheritDefault === true` при любом значении, кроме `false`.
  ⚠ В инструменте Bash `\\` в heredoc превращается в `\`: файлы с обратной чертой писать через Write или Edit.
  ⚠ Апостроф в heredoc инструмента Bash тоже ломает разбор: скрипты правки держать в файле из scratchpad.
- 2026-11-05 — Сессия 5, продолжение: готов `edit` (`file` — сохранение, чтение, diff, шаблоны; `ops` и `text` — правки). Подход — по решению пользователя: `minimalPatch` не перенесён, каждый шаг меняет свой участок текста и разбирает файл заново, а `Editor::tree` (ожидаемое дерево, алиасы не раскрыты) в конце сравнивается с разбором результата. Расхождение — отказ `YAML_ERROR` с подсказкой, файл не переписывается целиком. Два ключа перевода добавлены в `electron/i18n/en.json`.
  Эталон: `gen-edit-parity.cjs` (настоящий `applyEdit` и файловые функции). В репозитории 5472 правки на 36 видах файлов (2932 успешны в 1.x, остальные проверяют ошибки) и 74 файловых сценария; вне репозитория — 3600 правок на 40 настоящих файлах. Совпадают коды и тексты ошибок, заметки и данные результата; текст файла совпадать не обязан. На настоящих файлах отказов 0; на написанных 31, все на файле с повторяющимся ключом задания (1.x правил первое определение, правка молча не действовала): список допустимых отказов — `ALLOWED_REFUSALS`. Отличия — в шапке `edit/ops.rs`. Различия текста проверены выборочно по дампу (`GORYNYCH_EDIT_TEXT_DIFFS`), не все.
  Команды Tauri к `load` и `edit` не подключены.
  Следующий шаг: `check` (`ciCheck.cjs`, `ciCheckBase.cjs`), `RepoView` дополнить `ls_files`, веткой по умолчанию и списком веток.
- 2026-11-05 — Сессия 5, продолжение: готов `check` (`base`, `scripts`, `github`, `other`, `gitlab/*`, `tags`), `gorynych-ci-linter` закончен. `preview_ci` теперь принимает `RepoView`: 1.x выполнял проверку и в предпросмотре. Тексты идут через `tr!` с языком в thread-local на время `check_ci` (`LanguageScope`). Тест `every_translation_key_exists` сверяет каждый ключ `tr!` со словарём: он нашёл опечатку при переносе.
  Эталон: `gen-check-parity.cjs` + `check-cases.cjs` (настоящий `checkCi`, git отключён подменой, кроме случаев с `git`). Покрыты все `id` из исходников, кроме `loader-warning` (в 1.x недостижим: у прочих систем `warnings` всегда пуст). В репозитории 468 случаев и 175 подмен; вне репозитория совпали 6975 подмен и 200 запусков настоящих файлов (в них 27 тыс. проблем GitLab и 12 тыс. сценариев).
  Отличия от 1.x (шапки `check/base.rs`, `check/other.rs`): текст ошибки регулярки от `regress`; у CircleCI и Azure лимит алиасов 1000, а не 100 (на `rust-lang/jobs.yml` 1.x прерывал проверку); свойства прототипа JS не особенны.
  ⚠ Ошибка 1.x воспроизведена намеренно до решения пользователя: `workflow:rules` с непредопределённой переменной прерывает всю проверку GitLab (`yamlVars` до инициализации, 2 из 40 настоящих файлов). Флаг `Gl::yaml_vars_ready`, см. шапку `check/gitlab/mod.rs`.
  Сверка раннеров `check_runner_tags` принимает свой `RunnerInfo`: `gorynych-cicd` будет заполнять его из `CiRunner`. Команды Tauri не подключены.
  Следующий шаг: `gorynych-cicd` (`gitlab.cjs` + `cicd/*`).
- 2026-11-06 — Сессия 6: готов `gorynych-cicd` (`http`, `models`, `seal`, `remote`, `gitlab/{http,auth,api,light}`, `providers/{gitlab,github,gitea,bitbucket}`, `runner_setup`, `detect_server`, `service`), Фаза 2 завершена. `CicdService` принимает `CicdGit` (`git remote -v`, `git show`, `RepoView`): реализация появится с `gorynych-git`. Схема v4: у `legacy_ci_tokens` столбец `meta` (пользователь и права нужны `canWrite` и окну авторизации); `ServerKind::as_str` стал публичным; `yaml::Value` в TypeScript называется `YamlValue` (иначе конфликт имён). Значения `serde_json::Value` из ответов серверов остаются внутри крейта или идут как `Json` с типом `JsonType` (у specta `serde_json::Value` не экспортируется: i64).
  Эталон: `gen-cicd-parity.cjs` + `cicd-cases.cjs` гоняют настоящие `electron/gitlab.cjs` и `cicd/*` против локального HTTP-сервера под Node. Rust обязан воспроизвести результат и множество запросов (метод, адрес, заголовки, тело). В репозитории 257 сценариев на двух языках, 1253 шага, 1627 запросов и 102 подмены `null` в ответах. Вне репозитория: 4056 подмен, совпали 4020; остальные 36 — обязательное поле с `null`, разобраны и записаны в шапке `models.rs`. Сверку покрытия делали через `NODE_V8_COVERAGE`: оставшиеся строки — код без вызовов, ветки только для Electron, недостижимые `UNSUPPORTED`, таймауты (проверены модульным тестом только в Rust).
  Docker подменён самим `node` через `NODE_OPTIONS=--require fake-docker.cjs`: настоящего Docker на машине нет. Путь в `NODE_OPTIONS` только с прямыми чертами, иначе preload молча не грузится.
  Не перенесены `setToken` и `clearToken`: в `src/` нет вызовов. `serversWithCi` и `apiState` из `main.cjs` — в `gorynych-tauri` (Фаза 4), нужные им функции готовы. Команды Tauri не подключены.
  Не проверено: настоящие серверы GitLab, GitHub, Gitea и Bitbucket, настоящий Docker, `electron.net.fetch` (эталон идёт через `fetch` Node), системный прокси и корпоративные сертификаты.
  ⚠ Ждёт решения пользователя: `PRIVATE-TOKEN` уходит на чужой хост при редиректе (артефакт GitLab из объектного хранилища), и в 1.x под Node, и в Rust. `fetch` и `reqwest` снимают только `Authorization`. Сценарий «артефакт редиректом на другой сервер». В силе и более ранний вопрос про `Gl::yaml_vars_ready`.
  ⚠ `python` на этой машине — заглушка Microsoft Store. Сборка `reqwest` с провайдером по умолчанию требует cmake и nasm, которых нет.
- 2026-11-06 — Сессия 6, продолжение: Фаза 3 начата. В `gorynych-git` готовы `git.cjs` (`run`, `read`, `diff`, `write`), `conflicts`, `history` (`fileHistory.cjs`), `compare`. `JsRegex` переехал из `ci-linter` в `gorynych-core` (`ci-linter` реэкспортирует): он нужен поиску по изменениям.
  **Отступление от плана:** чтение идёт теми же вызовами `git`, что и в 1.x, а не через `gix`, `git2` и `imara-diff`. Сначала закреплено поведение эталоном; движки подключаются потом за тем же API, эталон покажет любое изменение. Пользователь об этом предупреждён, решения пока нет.
  Эталон: `gen-git-parity.cjs` + `git-cases.cjs` (настоящие модули на настоящих репозиториях, даты фиксированы, поэтому хэши на обеих сторонах одинаковы). `GIT_CONFIG_GLOBAL` — несуществующий файл: `NUL` на Windows git не открывает. Подмен значений здесь нет: вход — вывод самого git.
  `CicdGit` и `RepoView` из `git_blocking` пока не реализованы: это связка в `gorynych-tauri` вместе с командами (Фаза 4). Поэтому `gorynych-cicd` пока работает с настоящим git только в тестах.
- 2026-11-07 — Сессия 7: Фаза 3 завершена. В `gorynych-git` готовы `restore`, `network`, `init`, `clone`, `rebase`, `actions`; готов `gorynych-watcher`. Команды Tauri ко всему этому не подключены (Фаза 4).
  Эталоны: `gen-actions-parity.cjs` + `actions-cases.cjs` (настоящие модули, сервер — папка, отказы сервера — хук `pre-receive`, 120 сценариев на двух языках, 2392 шага; сверяются и ответ, и состояние git) и `gen-watcher-parity.cjs` (150 шагов, API GitLab подменён прямо в настоящем `gitlab.cjs`). Покрытие сверено через `NODE_V8_COVERAGE`: `remoteWatch.cjs` целиком. Не выполнялись в 1.x: Git старше 2.28 и 2.40; сбой запуска; отмена клонирования и занятость (зависят от гонки по времени, проверены только тестами на Rust); предел обхода папки 50 000 и `TOO_MANY` (не проверены нигде); сбой шага в `connectRepository`, `PATCH_FAILED` у `discard` и `stage`, повторные `throw error` после разбора текста ошибки.
  `actions_parity` с `harness = false`: git запускает сам файл теста как редактор rebase. Сквозные тесты с настоящим бинарём — `crates/gorynych-tauri/tests/engine_bin.rs`: редактор rebase и сохранённый вход через брокер. Настоящее слежение за файлами проверено только на Windows.
  Решения, отличные от плана (шапки `actions/mod.rs`, `watch.rs`, `remote_watch.rs`): **не актор, а `RepoEngine` с общим состоянием** — действия одного репозитория не становятся в очередь, как и в 1.x, иначе долгий push блокировал бы работу с файлами; **без `notify-debouncer-full`** — он ждёт затишья, а 1.x уведомляет через `delay` после первого события; **API GitLab — трейт `BranchHeadsApi`**, реализация появится в `gorynych-tauri` через `CicdService::gitlab_branch_heads` и `retry_after`; пауза между тиками осталась в интерфейсе (`src/lib/syncStatus.js`), и в Фазе 4 её надо перенести туда же, а цифры из плана (60 с → 10 мин) с 1.x не совпадали.
  История Undo теперь на диске, вопрос размера решён: `UNDO_BLOBS_LIMIT` = 256 МБ снимков на репозиторий, сверх него пропадают самые старые записи, самая новая остаётся. Ошибка записи в базу не отменяет сделанную операцию git.
  Новая запись: `gorynych_git::rebase::run_editor_helper()` стоит в `main` рядом с `askpass::run_helper` (замена скрипта под `ELECTRON_RUN_AS_NODE`).
  ⚠ Запускать `RepoEngine::run` только на рабочем потоке tokio (2 МБ стека): в отладочной сборке главному потоку Windows (1 МБ) его не хватает, даже с `Box::pin` внутри `run`. Команды Tauri этому условию удовлетворяют, `block_on` из `main` — нет.
  ⚠ Аргументы `t(...)` не держать в выражении с `.await`: `&dyn Display` не `Send`, и будущее перестанет подходить для команд Tauri. Сперва `let label = t(...)`.
  В силе вопросы к пользователю: `PRIVATE-TOKEN` при редиректе, `Gl::yaml_vars_ready`, чтение через `gix`/`git2`.
  Следующий шаг: Фаза 4: команды Tauri (`repo:*`, `clone:*`, `repo:watch`), связка `CicdGit`, `RepoView`, `BranchHeadsApi`; затем UI.
- 2026-11-08 — Сессия 8: Фаза 4 начата. В `gorynych-tauri` подключены команды `repo:*` и `clone:*` (`commands/repo.rs`, 32 команды) и события `repo-changed`, `repo-index-synced`, `clone-progress-event`.
  `Services` теперь держит `RepoEngine`, `CicdService`, `IndexSync`, `RemoteRepoWatcher`; `Credentials` и `AuthBroker` — в `Arc`. Мосты `bridge.rs`: `GitView` (`RepoView` на `git_blocking`), `GitForCicd` (`CicdGit`), `GitlabHeads` (`BranchHeadsApi`). Линтер синхронный, поэтому он вызывается только через `spawn_blocking`.
  Новое в `gorynych-git`: `gitflow` (бывший обработчик `repo:gitflow-config` из `main.cjs`, сверен с JS) и `compare::CompareRequest`. Для IPC включены фичи `indexmap/serde` и `specta/indexmap`; `line_diff::FileDiff` в TypeScript называется `TextDiff` (имя совпало с `diff::FileDiff`).
  Отличие от 1.x: `repo:action(dir, action)` принимает одно размеченное объединение `{name, payload}`. Неизвестное имя или аргумент неверной формы отклоняет сам Tauri строкой, а не `BAD_ARGS`; поля внутри `payload` по-прежнему `lenient`. Остальное — в шапке `commands/repo.rs`.
  Проверка: `tests/app_smoke.rs::git_commands_work_through_the_page` — настоящий WebView2, репозиторий попадает в «последний» через перенос профиля 1.x, страница-заглушка проходит загрузку, stage, слежение, Guard, commit, undo, CI, проверку сервера, diff и ошибки. Отчёт страницы приходит в `frontend_ready(report)` (используется только в debug). Сценарий запускается только при файле-метке `gorynych-smoke.txt`, поэтому заглушка не меняет настоящий репозиторий. Ошибка страницы теперь видна в отчёте, а не таймаутом.
  Не перенесены: `repo:open-dialog`, `repo:open-path` (нужны плагины диалогов и открытия; вместе с `shell:*`, `appearance:pick-image`, `creds:pick-key`).
  Следующий шаг: команды `creds:*` (`credTarget`, `describeTarget`, `serversWithCi`, `apiState`), `cicd:*`, `gitlab:*`; затем плагины диалогов и `shell:*`.
  ⚠ `cargo test --workspace` запускать из PowerShell: в Git Bash в `PATH` первым стоит `Git\ucrt64\bin\git.exe`, а эталоны `actions_parity` снимались с `Git\cmd\git.exe`. Путь входит в текст ошибки, поэтому 8 шагов расходятся только им.
- 2026-11-08 — Сессия 9: работа сессий 5–8 закоммичена четырьмя коммитами. Подключены 14 команд `creds:*` (`commands/creds.rs`: `credTarget`, `describeTarget`, `apiState`, `serversWithCi`). Буфер обмена — `tauri-plugin-clipboard-manager` 2.5 только со стороны Rust, разрешений для страницы нет.
  Подмена путей (`GORYNYCH_DEV_ROOT`, только debug) теперь включает папку SSH-ключей, буфер обмена (файл `clipboard.txt`) и сервис Keyring `com.ironxenot.gitgorynych.dev`. Это всё ещё настоящий Credential Manager: сквозной тест удаляет свой вход сам (`creds_clear`), после прогона записей `gitgorynych` в `cmdkey /list` нет.
  Отличия от 1.x — в шапке `commands/creds.rs`: пустой `dir` сразу `NOT_A_REPO` (1.x искал репозиторий в текущей папке процесса), аргумент `keyType` вместо `type`, `copied` — настоящий итог записи в буфер.
  Проверка: `app_smoke.rs::git_commands_work_through_the_page` (вход с новым адресом → remote добавлен, описание, серверы, удаление входа, переход на SSH, ключ ed25519 через настоящий `ssh-keygen`, ошибки) и модульный тест `serversWithCi` со старыми токенами CI/CD. Сервер `gitlab.example.invalid` в этой сети не отвечает быстро: проверка API ждёт свои 8 с, тест стал на столько же длиннее.
  Не перенесён `creds:pick-key` (плагин диалогов). `creds:detect-server` и `creds:check-url` через окно не запускались: нужна сеть, их логика проверена эталоном `gorynych-cicd` и `gorynych-git`.
  Следующий шаг: команды `cicd:*` и `gitlab:*`; затем плагины диалогов и открытия (`repo:open-dialog`, `repo:open-path`, `creds:pick-key`, `appearance:pick-image`, `cicd:artifact-download`, `shell:*`).
- 2026-11-09 — Сессия 10: подключены 23 команды `cicd:*` и 15 `gitlab:*` (`commands/cicd.rs`): это тонкая обёртка над `CicdService`, своей логики в ней нет. `opts` типизирован тремя структурами: `RemoteOptions {remote}`, `PipelinesOptions {remote, ref}`, `JobLogOptions {remote, pipelineId}`. Тела `runner-update`, `runner-delete`, `runners-prune` и `local-runner-start` — свои структуры той же формы, что в 1.x. Номер, которого нет, уходит как `CiId::Text("undefined")` (так это делает эталон `cicd_parity`).
  Не перенесены: `gitlab:set-token` и `gitlab:clear-token` (вызовов в `src/` нет), `cicd:artifact-download` и `cicd:show-file` (нужны плагины диалогов и открытия файлов).
  Проверка: `cicdSmoke` в `ui/app.js` + утверждения в `app_smoke.rs`. После `credsSmoke` remote уже SSH, а входа нет, поэтому ни одна команда не идёт в сеть: состояние провайдера, сохранение и сброс настроек, форма запуска, локальные раннеры, `NO_TOKEN`, ошибки аргументов. Запросы к серверам через окно не проверялись: их логика сверена эталоном `gorynych-cicd`.
  Следующий шаг: плагины диалогов и открытия (`repo:open-dialog`, `repo:open-path`, `creds:pick-key`, `appearance:pick-image`, `cicd:artifact-download`, `cicd:show-file`, `shell:*`).
- 2026-11-09 — Сессия 10, продолжение. **Решения пользователя** («всё исправь и сделай правильно, не забывай про оптимизацию»):
  1. Токен при редиректе исправлен: общий клиент `reqwest` без автоматических редиректов, переходы — `gorynych_cicd::http::send_following`. При смене источника (схема, хост, порт) снимаются все заголовки провайдера: `PRIVATE-TOKEN`, `Authorization`, `X-GitHub-Api-Version`. 303 и 301/302 после POST превращаются в GET без тела, как в `fetch`; предел — 10 переходов. В эталоне `cicd_parity` это учтено функцией `without_auth_on_other_host`, а `redirect_to_other_host_is_covered` следит, что сценарий на месте.
  2. `Gl::yaml_vars_ready` убран: `yaml_vars` вычисляются до `workflow:rules`. В `check_parity` случаи, где 1.x падал (`hits_yaml_vars_bug`), обязаны пройти без `check-failed`; добавлен тест `workflow_rules_see_file_variables`.
  3. Нагрузка. Мера — число процессов git: на этой машине запуск стоит 35–50 мс, даже у `git --version`. Счётчик — `gorynych_git::run::spawned()`, замер — `cargo run --release -p gorynych-git --example bench -- <репозиторий>`. Обёртка `Git\cmd\git.exe` даёт только 18% (42 → 34 мс), её не трогали: она готовит `PATH` для хуков и ssh. Сделано, результат прежний:
     - кэш корня и папки git (`read::locate_repo`) с проверкой по файловой системе при каждом обращении;
     - `detect_operation` по файлам, без `rev-parse --git-path`;
     - HEAD из `.git/HEAD`, `git log` параллельно с чтением веток;
     - `core.sshCommand` и адреса remote одним вызовом `git config` (`network::NetConfig`);
     - в тике `remote_watch` запрос к серверу и локальные ссылки параллельно;
     - `git remote -v` один раз на `detect` и `context` в `CicdService` (было два для GitLab);
     - профиль release: `lto = "fat"`, `codegen-units = 1`, `strip`.
     На ripgrep (2303 коммита): `quick_status` — 3 процесса и 142 мс → 1 и 55 мс (это каждое изменение файла); `load_repository` — 9 процессов и 304 мс → 6 и 171 мс; поиск корня — 48 мс → 0,1 мс.
  Не сделано и требует решения: (а) чтение через `gix`. Сэкономило бы оставшиеся процессы (`status` около 50 мс), но поведение `git status` (ignore, фильтры, autocrlf, fsmonitor, подмодули) воспроизводить самим рискованно. (б) `repo:load` отдаёт около 930 КБ JSON на каждое изменение в `.git`, а интерфейс 1.x перечитывает весь граф. Это вопрос Фазы 4: нужен ответ «граф не изменился» по отпечатку ссылок и обновление по частям в UI.
- 2026-11-09 — Сессия 10, продолжение (gix по решению пользователя пока не трогаем). Подключены 10 команд `commands/desktop.rs`: `repo:open-dialog`, `repo:open-path`, `creds:pick-key`, `appearance:pick-image`, `appearance:image`, `cicd:artifact-download`, `cicd:show-file`, `shell:open-external`, `shell:open-folder`, `shell:open-terminal` (перенос `system.cjs`).
  Плагины: `tauri-plugin-dialog` 2.8, а от `tauri-plugin-opener` 2.7 — только свободные функции, без самого плагина. Разрешений у страницы по-прежнему нет. Ветка 3.x этих плагинов — альфа под Tauri 3, не брать.
  Отличия от 1.x (шапка `desktop.rs`): **`appearance:image` возвращает адрес протокола `gorynych-bg`, а не `data:`-URL**. Картинка до 25 МБ больше не идёт через IPC base64-строкой на 33 МБ. CSP: `img-src` дополнен `http://gorynych-bg.localhost gorynych-bg:`. Ошибки `appearance:pick-image` — `UNSUPPORTED` и `TOO_LARGE` вместо `{ok:false, error}`.
  Подмена в debug с `GORYNYCH_DEV_ROOT`: диалоги отвечают построчно из `dialog-answers.txt`, а открытия и терминал пишутся в `desktop.log`. В релизе этих функций нет (`#[cfg(debug_assertions)]`).
  Проверка: `desktopSmoke` + утверждения в `app_smoke.rs`, включая загрузку картинки фона в настоящем WebView2 сквозь CSP. Настоящие системные диалоги, Проводник, браузер и терминал вручную не открывались. macOS и Linux не собирались.
  Следующий шаг: меню macOS (`menu:set`) и перехват `target=_blank`; затем UI Фазы 4.
- 2026-11-09 — Сессия 10, продолжение: `menu:set` → `commands/menu.rs`, событие `menu-invoke` (`{menu, index, id}`, идентификатор пункта `gm|<меню>|<номер>|<id>`). Та же модель меню не пересобирается. На других системах меню не строится, кроме отладки с подменой путей: там оно собирается без установки и пишет `menu built N` в `desktop.log`.
  **Отличие от 1.x: сочетания клавиш в меню macOS не показываются.** У `muda` нет подписи без перехвата (`registerAccelerator: false` в Electron). Перехват отдал бы, например, ⌘Z меню, а не полю ввода. Клавиши, как и прежде, обрабатывает интерфейс. Если подписи нужны, это решение пользователя.
  `target=_blank` и `window.open`: `on_new_window` → `desktop::open_link` (только `http(s)`; 1.x отдавал оболочке любой адрес) → `Deny`.
  В сквозном тесте `repo_remote_check` иногда давал `skipped`, когда синхронизация индекса после stage держала `index.lock`. Страница теперь повторяет запрос, как интерфейс 1.x; причины пишутся в `skippedReasons`.
  Не проверено: код меню под `cfg(target_os = "macos")` (`set_as_windows_menu_for_nsapp` и `set_as_help_menu_for_nsapp`) не собирался, меню на macOS не запускалось.
  Каркас `gorynych-tauri` перенесён полностью: все каналы `ipcMain` из `main.cjs` подключены, кроме `gitlab:set-token` и `gitlab:clear-token` (вызовов нет). Следующий шаг: UI Фазы 4 (TypeScript, Zustand, TanStack Query) поверх `bindings/commands.ts`.
- 2026-11-09 — Сессия 10, продолжение. **Решение пользователя по Фазе 4: постепенный перевод.** Сначала слой совместимости, интерфейс 1.x работает на 2.0 как есть; затем модули по одному переводятся на TypeScript, Zustand и TanStack Query.
  - `src/platform/tauri.ts` — `window.api` той же формы, что `electron/preload.cjs`. Каналы с `safe` отвечают `{ok, data}` / `{ok, error}` (отклонённый promise 2.0 превращается в ошибку; строка от Tauri — `BAD_ARGS`), остальные — значением как есть. Слой сглаживает `repo.action(dir, name, payload)`, `appearance.pickImage`, имена событий. Под Electron он ничего не делает: preload уже поставил `window.api`, и 1.x для сверки запускается по-прежнему (`npm run electron:dev`).
  - `src/main.jsx` — загрузчик: сначала `installTauriApi()`, потом `import('./boot.jsx')` (бывший `main.jsx`). Модули читают `window.api` и `localStorage` при загрузке, поэтому порядок обязателен.
  - `localStorage`: при первом запуске (метка `__gorynych.seeded`) заполняется из SQLite командой `prefs_snapshot`, изменения пачкой через 400 мс уходят в `prefs_write` (`commands/storage.rs`; `Db::preferences_raw`, `Db::apply_preferences`). Ключи `language`, `appearance`, `actions.v1`, `lastRepo` и `activeTab` маршрутизируются, как при переносе 1.x.
  - Окно грузит `dist` (`frontendDist: ../../dist`). **Перед сборкой и тестами `gorynych-tauri` нужен `npm run build`**: `dist` встраивается в бинарь при компиляции. `npm run ui:watch` пересобирает его при правках, `npm run typecheck` проверяет `.ts` (`tsconfig.json`, пока только `src/**/*.ts`). Заглушки `ui/` больше нет.
  - CSP: `img-src` дополнен хостами аватаров (`gravatar.com`, `*.gravatar.com`, `avatars.githubusercontent.com`, `github.com`) — `src/lib/avatars.js`.
  - Проверки окна (только debug): `GORYNYCH_DEV_SMOKE_SCRIPT` подставляет `tests/smoke-page.js` скриптом инициализации вместо интерфейса (`window.__GORYNYCH_SMOKE__`). `GORYNYCH_DEV_UI_PROBE` — зонд `tests/ui-probe.js` поверх настоящего интерфейса. Тест `real_interface_opens_repository_on_the_compatibility_layer`: интерфейс открывает репозиторий из профиля 1.x и рисует граф без ошибок; после удаления профиля WebView настройка возвращается из SQLite.
  - Известное: в `bindings/commands.ts` шесть команд с `WithCaps<T>` без подставленного `T` (`specta` не раскрывает обобщение с `flatten`). Во время выполнения это не мешает, но перед проверкой типов модулей CI/CD это надо исправить. Основной бандл интерфейса — 1,9 МБ (как в 1.x), разделение на части — отдельная задача.
  - Не проверено: интерфейс вручную на настоящем профиле не запускался (перед этим спросить пользователя). Действия мышью в окне проверяются только сценарием на командах, не кликами.
  Следующий шаг: запуск для ручной проверки (`GORYNYCH_DEV_ROOT` на копии профиля), затем перевод модулей на TypeScript, начиная с горячего пути «изменение в `.git` → полный `repo:load`».
- 2026-11-10 — Сессия 11: горячий путь `repo:load`, пункт (б) сессии 10. `read::graph_fingerprint` — SHA-1 содержимого HEAD, `config.worktree`, `packed-refs`, `shallow`, `info/grafts`, `config`, `reftable/tables.list` и всех файлов под `refs/` (кроме `refs/stash` и `.lock`), плюс предел; у worktree ссылки берутся из `commondir`. Процессов git нет, отпечаток снимается до `git log`.
  `read::load_repository_since(dir, limit, known)`: при совпадении `git log` не запускается, `commits` пуст, `truncated: false`; `load_repository` — обёртка с `known: None`, эталоны не менялись. Команда `repo_load(dir, known)` отдаёт `graphFingerprint` и `commitsUnchanged`; `api.repo.load(dir, {known})` в `tauri.ts`. `loadRepo` в `App.jsx` берёт коммиты из того ответа, чей отпечаток отправил, — тот же массив, поэтому граф и поиск не пересчитываются. Под Electron второго аргумента нет, ответ полный.
  Замер (`examples/bench.rs`, синтетический репозиторий на 2500 коммитов): 122 → 91 мс, 6 → 5 процессов, JSON 644 КБ → меньше 1 КБ. На этом репозитории (54 коммита) время то же: его определяет `git status`.
  Проверка: `tests/graph_fingerprint.rs` (что меняет отпечаток, а что нет: индекс, stash, ветка, тег, checkout, коммит, `pack-refs`, remote-ветка, detached; worktree; пустой репозиторий; остальной ответ совпадает с полным) и `reload` в `app_smoke.rs`: после коммита граф перечитан, после undo — пропущен.
  `read_status`: если прошлый вызов со счётчиками нашёл изменения (`DIRTY`, не больше 64 копий), оба `diff --numstat` идут одновременно со `status`, а не после. Процессов столько же, результат тот же (тест `early_line_counts_match_sequential_ones`); `quick_status` на изменённой копии 119 → 67 мс. Тесты быстрых путей — `tests/read_fast_paths.rs`.
  Ручной запуск в отладке на копии профиля (`GORYNYCH_DEV_ROOT`): окно открылось, перенос 1.x прошёл, замечаний пользователь не высказал.
  **Рабочая сборка:** `npm run app:build` (`vite build` + `cargo build --release -p gorynych-tauri --features custom-protocol`) → `target/release/gorynych-tauri.exe`, около 33 МБ, без инсталлятора (`bundle.active: false`). Без фичи `custom-protocol` Tauri собирается в режиме разработки. Строк `GORYNYCH_DEV_*` в рабочем exe нет (проверено поиском по файлу). Этот exe работает с настоящим профилем и Keyring.
  `WithCaps<T>` в `bindings/commands.ts` исправлен: шесть команд `cicd:*` отдают конкретные типы (`ForgeInfoWithCaps`, `PipelineListWithCaps`, `PipelineDetailWithCaps`, `JobLogWithCaps`, `RunnersWithCaps`, `SecretsWithCaps`) из макроса `with_caps!` в `commands/cicd.rs`; JSON тот же, `gorynych-cicd` не менялся. `bindings/commands.ts` теперь входит в `npm run typecheck` (раньше он не компилировался: `Cannot find name T`).
  ⚠ Параллельно в той же папке работала другая сессия Claude (исправления входа в `gorynych-storage`, `gorynych-cicd`, `auth_helper.rs`, `en.json`, `gorynych-check.cmd`), её правки не закоммичены. Коммитить только свои пути, не `git add -A`.
  **Перевод интерфейса на TypeScript начат** (по модулю, поведение то же): `lib/scheme.ts`, `lib/graphLayout.ts` (типы `LayoutCommit`, `GraphNode`, `GraphEdge`, `Metrics`), `i18n/index.ts`, `lib/graphView.ts`. Импорты в JSX — с расширением `.ts`. Добавлены `@types/react` и `@types/react-dom` 19.3, `resolveJsonModule`. Каждый модуль сверяется со своим прежним `.js` из git в одном процессе Node: `tests/ui-parity/` (команды — в README там же). Zustand и TanStack Query пока не подключались: они нужны, когда дойдёт до состояния `App.jsx`.
  Переведены также `format`, `stashName`, `dnd`, `syncStatus`, `avatars`, `inlineDiff`, `cron`, `servers`, `ansi`, `commitMsg`, `commitPrefs`, `ciSnippets`, `platform`, `guardRules` (каждая партия — своя сверка в `tests/ui-parity/`, сверки проверены заведомыми правками старой копии). Эталон Guard `gen-guard-parity.cjs` читает правила из `guardRules.ts`: литерал `DEFAULT_RULES` держать без типов внутри.
  Осталось в `lib`: `highlight`, `actions`, `appearance`, `syntax.jsx`; затем `platform/errors.js` и состояние репозитория из `App.jsx` (`loadRepo`, `onChanged`) в отдельный модуль на типах `bindings/commands.ts`.
