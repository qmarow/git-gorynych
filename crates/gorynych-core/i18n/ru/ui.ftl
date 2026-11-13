# Интерфейс (src/). Ключ — по английскому тексту; { $a0 }, { $a1 }… — аргументы t()/tj() по порядку.
# Сообщения без перевода на английский показываются по-русски.

## src/App.tsx

switching-branch = Переключаем ветку…
switching-to-commit = Переключаемся на коммит…
pulling-changes-from-server = Получаем изменения с сервера…
pushing-to-server = Отправляем на сервер…
fetching-from-server = Загружаем данные с сервера…
merging-branches = Слияние веток…
rebasing = Перебазирование…
applying-rebase = Применяем rebase…
creating-revert-commit = Создаём revert-коммит…
restoring-project-files = Возвращаем файлы проекта…
moving-branch = Перемещаем ветку…
stashing-changes = Прячем изменения…
applying-stash = Применяем stash…
undoing = Отменяем…
redoing = Повторяем…
creating-branch = Создаём ветку…
continuing = Продолжаем…
aborting = Прерываем…
new-tab = Новая вкладка
choose-project-folder-to-connect = Выберите папку проекта для подключения к репозиторию
choose-project-folder-for-new = Выберите папку проекта для нового репозитория
is-already-git-repository-opening = { $a0 } уже Git-репозиторий — открываем
branch-2 = ветка { $a0 }
history-loaded-from-server = история загружена с сервера
added-from-server = добавлено с сервера: { $a0 } { $a1 }
file = файл
files-2 = файла
files = файлов
commit-2 = коммит { $a0 } ({ $a1 } { $a2 })
pushed-to-server = отправлено на сервер
connected-to = { $a0 } подключён к { $a1 }
repository-is-connected-but-push = Репозиторий подключён, но push не прошёл: { $a0 }
commit-is-saved-locally-you = { $a0 } Коммит сохранён локально — его можно отправить позже кнопкой Push.
repository-created = Репозиторий { $a0 } создан
commit-skipped-no-files = коммит пропущен — нет файлов
open-repository = Открыть репозиторий…
create-repository = Создать репозиторий…
clone-repository = Клонировать репозиторий…
connect-folder-to-gitlab-github = Подключить папку к GitLab / GitHub…
close-tab = Закрыть вкладку
exit = Выход
sign-in = Авторизация
remote-now-points-to = Remote { $a0 } теперь указывает на { $a1 }
added-remote = Добавлен remote { $a0 }
pull-and-push-work-but = Pull и Push работают, а пайплайны CI/CD — нет
signed-in-to-credentials-saved = Вход для { $a0 } выполнен — данные сохранены
same-sign-in-also-works = Эта же авторизация работает и для пайплайнов CI/CD
shared-sign-in-for-removed = Общий вход для { $a0 } удалён
server = сервера
sign-in-for-removed = Вход для { $a0 } удалён
repository = репозитория
pull-updated-from = Pull: { $a0 } обновлена из { $a1 }
is-already-up-to-date = { $a0 } уже актуальна
fetch-updated = Fetch: обновлены { $a0 }
upstream-set = {" "}(upstream установлен)
undone = Отменено: { $a0 }
redone = Повторено: { $a0 }
switching-to = Переключаемся на { $a0 }
created-branch-tracking = Создана ветка { $a0 }, отслеживает { $a1 }
changes-in-stashed-theyll-come = правки { $a0 } спрятаны ({ $a1 }) — вернутся при возврате
changes-in-restored = правки { $a0 } восстановлены
changes-moved = изменения перенесены ({ $a0 })
changes-discarded-ctrl-z-brings = изменения выброшены ({ $a0 }) — Ctrl+Z вернёт
changes-of-branch-came-back = Правки ветки { $a0 } вернулись с конфликтом
stash-is-kept-in-stashes = Stash сохранён в списке Stashes. Решите конфликты в файлах с пометкой U или откатите их и примените stash позже.
changes-moved-to-with-conflict = Изменения перенесены в { $a0 } с конфликтом
copy-of-changes-remains-in = Копия изменений осталась в списке Stash. Решите конфликты в файлах с пометкой U.
stashed-changes-2 = Спрятано изменений: { $a0 }{ $a1 }
older-copy-with-same-changes = {" "}— прежняя копия с теми же правками убрана
stash-applied = Stash применён
branch-created = Ветка { $a0 } создана{ $a1 }
and-checked-out = {" "}и активна
creating-branch-2 = Создаём ветку { $a0 }
branch-created-and-checked-out = Ветка { $a0 } создана и активна
commit-created = Коммит { $a0 } создан
copied = { $a0 } скопирован
couldnt-copy-to-clipboard = Не удалось скопировать в буфер обмена
tag-created-on = Тег { $a0 } создан на { $a1 }
delete-branch-2 = Удаление ветки
branch-deleted-undo-brings-it = Ветка { $a0 } удалена (Undo вернёт её)
branch-not-merged = Ветка не слита
force-delete = Удалить { $a0 } принудительно
reset-to = { $a0 } сброшена на { $a1 } (--{ $a2 })
branch-will-be-moved-to = Ветка { $a0 } будет перемещена на { $a1 } «{ $a2 }».{ $a3 } Коммиты после этой точки можно вернуть через Undo.
uncommitted-changes-will-be-lost = {" "}Незакоммиченные изменения ({ $a0 }) будут удалены безвозвратно.
copy-name = Скопировать название
name-2 = Название
tag-3 = Тег { $a0 }
delete-tag-2 = Удалить тег { $a0 }…
delete-tag-3 = Удалить тег
delete-local-tag = Удалить локальный тег «{ $a0 }»?
delete-2 = Удалить
delete-tag-4 = Удаление тега
tag-deleted = Тег { $a0 } удалён
branch-3 = Ветка { $a0 } = { $a1 }
branch-4 = Ветка { $a0 }
switch-to = Переключиться на { $a0 }
update-branch = Обновить ветку — ↓{ $a0 }
update-branch-2 = Обновить ветку
no-new-commits-in = Новых коммитов в { $a0 } нет
has-its-own-commits-switch = В { $a0 } есть свои коммиты (↑{ $a1 }) — переключитесь на неё и сделайте Pull
pull-from = Забрать { $a0 } { $a1 } из { $a2 }
commit = коммит
commits = коммита
commits-2 = коммитов
fast-forward-to-without-switching = Перемотать { $a0 } до { $a1 } без переключения ветки
merge-into = Влить { $a0 } в { $a1 }
merged-into = { $a0 } слита в { $a1 }
rebase-onto-2 = Перебазировать { $a0 } на { $a1 }…
with-preview-resulting-graph-conflicts = С предпросмотром: итоговый граф, конфликты и изменения видны до применения
reset-to-2 = Сбросить { $a0 } к { $a1 }
rename-2 = Переименовать…
delete-branch-3 = Удалить ветку { $a0 }…
cant-delete-current-branch = Нельзя удалить текущую ветку
delete-local-branch-branch-on = Удалить локальную ветку. Ветка на сервере не затрагивается.
delete-branch-4 = Удалить ветку
delete-local-branch-undo-can = Удалить локальную ветку «{ $a0 }»? { $a1 } Вернуть можно кнопкой Undo.
branch-on-server-is-not = Ветка { $a0 } на сервере не затрагивается.
delete-from-server-2 = Удалить { $a0 } с сервера…
delete-branch-on-server-git = Удалить ветку на сервере (git push --delete). Локальная ветка останется.
on-server = На сервере: { $a0 }
local-branch-already-exists-but = Локальная ветка { $a0 } уже есть, но стоит на другом коммите — после переключения заберите изменения через Pull
create-local-and-switch-to = Создать локальную { $a0 } и переключиться
delete-branch-on-server-git-push = Удалить ветку на сервере (git push --delete) — для всех, кто работает с репозиторием
soft-keep-all-changes-in = Мягко — оставить все изменения в индексе
mixed-keep-changes-in-working = Смешанно — оставить изменения в рабочей папке
hard-discard-all-changes = Жёстко — удалить все изменения…
rename-3 = Переименование
branch-renamed-to-undo-reverts = Ветка { $a0 } переименована в { $a1 } — Undo вернёт
delete-from-server-3 = Удаление с сервера
deleting-from-server = Удаляем { $a0 } с сервера…
branch-deleted-from-undo-restores = Ветка { $a0 } удалена с { $a1 } — Undo вернёт её на сервер
update = Обновление { $a0 }
updating = Обновляем { $a0 }…
from-3 = { $a0 }: +{ $a1 } { $a2 } из { $a3 }{ $a4 }
without-switching = {" "}(без переключения)
commit-hash = Хэш коммита
copy-commit-hash-sha = Скопировать хэш коммита (SHA)
new-local = новая локальная
check-out-this-commit = Переключиться на этот коммит
head-at-detached-undo-returns = HEAD на { $a0 } (detached) — Undo вернёт на ветку
create-branch-here = Создать ветку здесь…
create-tag-here = Создать тег здесь…
cherry-pick-commit-into = Перенести коммит в { $a0 }
commit-applied-to = Коммит { $a0 } применён к { $a1 }
revert-commit-changes = Обратить изменения коммита
created-revert-commit-for = Создан revert-коммит для { $a0 }
restore-files-from-commit = Восстановить файлы из коммита…
new-commit-in-which-all = Новый коммит, в котором все файлы проекта — как в этом коммите. История не переписывается, ветка не переключается.
reset-to-this-commit = Сбросить { $a0 } к этому коммиту
local = локальная
on-server-2 = на сервере
copy-commit-hash = Скопировать хэш коммита
copy-commit-message = Скопировать сообщение коммита
commit-message = Текст коммита
rebase-works-on-branch = Rebase делается для ветки
youre-on-detached-head-switch = Сейчас detached HEAD — переключитесь на ветку.
amend-last-commit = Изменить последний коммит…
edit-commits-of-branch = Изменить коммиты ветки { $a0 }
reorder-reword-squash-or-drop = Изменить порядок, сообщения, объединить или удалить коммиты — с предпросмотром до применения
commits-after = Коммиты после { $a0 }…
starting-from-inclusive = Начиная с { $a0 } (включительно)…
rebase-onto-this-commit = Перебазировать { $a0 } на этот коммит…
with-preview-of-result-before = С предпросмотром результата до применения
compare-with-marked = Сравнить с отмеченным { $a0 }
compare-with-head = Сравнить с HEAD
unmark-for-comparison = Снять отметку для сравнения
mark-for-comparison = Отметить для сравнения
ctrl-click = Ctrl+клик
marked-for-comparison = { $a0 } отмечен для сравнения
ctrl-click-or-right-click = Ctrl+клик или правый клик по другому коммиту → «Сравнить с отмеченным»
already-on-this-branch = уже на этой ветке
branch-not-found-2 = Ветка { $a0 } не найдена
check-name-or-fetch = Проверьте имя или сделайте Fetch.
already-contains-all-commits = уже содержит все коммиты
already-merged = уже слита
nothing-to-stash = нечего прятать
stash-is-empty = stash пуст
empty-commit-message = Пустое сообщение коммита
no-changes-to-commit = Нет изменений для коммита
commit-cancelled-after-check = Коммит отменён после проверки
active-branch-is-required = Нужна активная ветка
gitlab-is-not-connected = GitLab не подключён
settings-connections-add-token-with = Настройки → Подключения: добавьте токен со scope «api».
created = создан
already-existed = уже был
pull-request-page-opened = открыта страница pull request
couldnt-determine-server-for-merge = Не удалось определить сервер для merge request
gitlab-via-token-and-github = Поддерживаются GitLab (через токен) и GitHub (откроется страница PR).
continue = Продолжить?
stopped-by-you = Остановлено вами
unknown-step = Неизвестный шаг: { $a0 }
each-step-can-be-undone = каждый шаг можно отменить через Undo
open-action-builder-and-fix = Откройте конструктор действий и поправьте шаги.
wait-for-current-operation-to = Дождитесь окончания текущей операции
already-in-nothing-to-merge = Уже есть в { $a0 } — сливать нечего
fast-forward = Перемотать { $a0 } вперёд (Fast-forward)
branch-simply-moves-forward-no = Ветка просто передвинется вперёд — без merge-коммита и без переключения
fast-forwarded-to-undo-reverts = { $a0 } перемотана до { $a1 } — Undo вернёт
merge-into-2 = Влить в { $a0 } (Merge)
switches-branch = с переключением
merged-into-undo-reverts-it = { $a0 } слита в { $a1 } — Undo вернёт
cherry-pick-commit-into-2 = Перенести коммит в { $a0 } (Cherry-pick)
one-commit = один коммит
rebase-onto-3 = Перебазировать { $a0 } на { $a1 } (Rebase)…
with-preview = с предпросмотром
cant-merge-branch-into-itself = Нельзя слить ветку саму в себя
my-actions = Мои действия
untitled = Без названия
action-builder = Конструктор действий…
changes = Изменения: { $a0 }
stash-all-changes = Спрятать все изменения (Stash)
stage-all-changes = Добавить все изменения в индекс (Stage)
discard-all-changes = Отменить все изменения (Discard)
discard-all-changes-2 = Отменить все изменения
all-uncommitted-changes-including-new = Все незакоммиченные изменения, включая новые неотслеживаемые файлы, будут удалены без возможности восстановления.
discard-changes-2 = Удалить изменения
discarded-changes-in-files = Отменены изменения в { $a0 } файлах
undo = Отменить: { $a0 }
undo-2 = Отменить
redo = Повторить: { $a0 }
redo-2 = Повторить
find-commit = Найти коммит…
switch-branch = Переключить ветку…
new-branch = Новая ветка…
stash-changes = Спрятать изменения (Stash)
pop-last-stash = Вернуть последний stash (Pop)
appearance = Оформление…
sync = Синхронизация…
connections-git-servers-and-gitlab = Подключения: Git-серверы и GitLab…
repository-sign-in = Авторизация репозитория…
save-and-check = Сохранить и проверить
guide = Руководство
keyboard-shortcuts = Горячие клавиши
about-2 = О программе
conflicts = Конфликтов: { $a0 } { $a1 }
pick-version-you-need-for = Выберите для каждого блока нужную версию и сохраните — затем нажмите «Продолжить».
resolved = { $a0 } — решено
files-left = Осталось файлов: { $a0 }
all-conflicts-resolved = Все конфликты решены
click-continue-in-yellow-bar = Нажмите «Продолжить» на жёлтой панели, чтобы завершить { $a0 }.
changes-are-ready-you-can = Изменения готовы — можно делать коммит.
pipeline-2 = { $a0 } Пайплайн #{ $a1 } { $a2 }
passed = прошёл
failed = упал
canceled = отменён
open = Открыть
restore-file = Вернуть файл
no-commit = { $a0 }: { $a1 } — без коммита{ $a2 }
deleted-it-didnt-exist-in = удалён (его не было в той версии)
version = версия { $a0 } { $a1 }
before = до
from = из
undo-reverts-it = , Undo вернёт
file-has-uncommitted-changes = В файле есть незакоммиченные изменения
file-is-already-changed-in = Файл { $a0 } уже изменён в рабочей папке. Он будет заменён версией { $a1 } коммита { $a2 }. Undo (Ctrl+Z) вернёт текущее содержимое.
replace = Заменить
revert-hunk = Отмена фрагмента
in-no-commit-undo-reverts = { $a0 } в { $a1 } — без коммита, Undo вернёт
commit-changes-reverted = Изменения коммита отменены
hunk-reverted = Фрагмент отменён
in-discarded-undo-brings-it = { $a0 } в { $a1 } отменён — Undo вернёт
changes-2 = Изменения
hunk = Фрагмент
stage-hunk = Добавление фрагмента в индекс
unstage-hunk = Удаление фрагмента из индекса
hunk-from-stash = Фрагмент из stash
from-stash-applied-to-undo = { $a0 } из stash применён к { $a1 } — Undo вернёт
revert-in-working-folder = Отменить в рабочей папке
remove-this-hunks-changes-from = Убрать изменения этого фрагмента из файла в рабочей папке — без коммита. Undo вернёт.
stage-2 = В индекс
add-only-this-hunk-to = Добавить только этот фрагмент в коммит (Stage)
discard-this-hunk-of-changes = Выбросить этот фрагмент изменений. Undo вернёт.
unstage = Из индекса
remove-this-hunk-from-commit = Убрать этот фрагмент из коммита (Unstage) (останется в рабочей папке)
apply = Применить
move-only-this-hunk-from = Перенести только этот фрагмент из stash в файл в рабочей папке. Stash не меняется, Undo вернёт.
resolve-conflict-first = Сначала разрешите конфликт
file-isnt-committed-yet-it = Файл ещё не закоммичен — у него нет истории
no-commit-2 = Нет коммита
file-was-deleted-in-this = Файл удалён в этом коммите
file-history-log = История файла (Log)
all-commits-that-changed-this = Все коммиты, которые меняли этот файл, — и под прежними именами
who-last-changed-each-line = Кто и когда последним менял каждую строку
show-changes = Показать изменения
restore-file-from-stash = Восстановить файл из stash
file-in-working-folder-will = Файл в рабочей папке станет таким, как в stash. Stash остаётся в списке. Undo вернёт.
restore-file-to-its-version = Вернуть файл к версии из этого коммита
file-in-working-folder-will-become = Файл в рабочей папке станет таким, как в этом коммите. Коммит не создаётся.
restore-file-to-its-version-before = Вернуть файл к версии до этого коммита
file-will-become-as-it = Файл станет таким, каким был до этого коммита. Коммит не создаётся.
revert-this-commits-changes-in = Отменить изменения этого коммита в файле
remove-from-working-file-only = Убрать из рабочего файла только то, что изменил этот коммит, — более поздние правки останутся
stage-3 = Добавить в индекс (Stage)
unstage-2 = Убрать из индекса (Unstage)
discard-changes-in-file = Отменить изменения в файле
discard-unstaged-changes-of-this = Выбросить незастейдженные правки этого файла. Undo вернёт.
copy-path = Копировать путь
path = Путь
delete-stash = Удалить stash
delete-undo-can-bring-it = Удалить «{ $a0 }»? Вернуть его можно кнопкой Undo.
stash-deleted-undo-brings-it = Stash удалён — Undo вернёт его
stash-applied-and-deleted = Stash «{ $a0 }» применён и удалён
stash-applied-2 = Stash «{ $a0 }» применён
restore-from-stash = Восстановление из stash
from-in-working-folder = { $a0 } из { $a1 } — в рабочей папке{ $a2 }
undo-reverts-it-2 = {"."} Undo вернёт
replace-changed-files = Заменить изменённые файлы?
you-have-unsaved-changes-in = У вас есть несохранённые правки в { $a0 }. Они будут заменены версией из { $a1 }. Undo (Ctrl+Z) вернёт текущее содержимое.
file-3 = файле { $a0 }
files-3 = { $a0 } файлах
apply-2 = Применить (Apply)
apply-and-delete-pop = Применить и удалить (Pop)
delete-drop = Удалить (Drop)
revert-to-commit = Вернуть к коммиту
restoring-files-to = Возвращаем файлы к { $a0 }…
files-restored-to-created-commit = Файлы возвращены к { $a0 } — создан коммит «{ $a1 }». Undo отменит.
and-more = {" "}и ещё { $a0 }
reverted-to-last-commit-by = { $a0 } — откат к последнему коммиту из другой программы, изменение убрано из индекса
changes-from-another-program-added = { $a0 } — правки из другой программы добавлены в индекс
updated-in-index = Обновлены в индексе: { $a0 }
turn-off-settings-sync = Отключить: Настройки → Синхронизация
loading-repository = Загружаем репозиторий…
starting = Запуск…
copy-path-2 = Скопировать путь
open-another-repository = Открыть другой репозиторий…
action-2 = Действие
continue-2 = Продолжить
finished = { $a0 } завершён
next-step = Следующий шаг
abort = Прервать
aborted-state-restored = { $a0 } прерван, состояние восстановлено
file-history = История файла
restore-file-2 = Вернуть файл…
restore-this-file-in-working = Вернуть этот файл в рабочей папке к версии из коммита или до него — без коммита
rebase-of-done-undo-ctrl = Rebase { $a0 } выполнен — Undo (Ctrl+Z) вернёт как было
rebase-done-undo-ctrl-z = Rebase выполнен — Undo (Ctrl+Z) вернёт как было
commit-isnt-in-loaded-history = Коммита нет в загруженной истории
fetch-or-pull = Сделайте fetch или pull
pre-commit-check-enabled-for = Проверка перед коммитом включена для этого репозитория
pre-commit-check-disabled-for = Проверка перед коммитом выключена для этого репозитория
turn-it-back-on-in = Включить обратно — в строке над кнопкой Commit или в настройках.
git-gorynych = git-Горыныч
about-version = Версия 2.0.0-alpha.0 · Rust + Tauri + React + Tailwind CSS
commit-graph-branches-stash-conflicts = Граф коммитов, ветки, stash, конфликты, CI/CD и пайплайны GitLab — в одном окне.
ci-cd-token-for-removed = Токен CI/CD для { $a0 } удалён
all-sign-ins-for-removed = Все входы для { $a0 } удалены
repository-cloned = Репозиторий { $a0 } склонирован
changes-stashed = Изменения спрятаны в Stash
in-progress = Идёт <0>{ $a1 }</0>{ $a2 }
conflicts-left-to-resolve-then = {" "}— осталось решить конфликтов: { $a0 }. Потом нажмите «Продолжить».
conflicts-resolved-you-can-continue = {" "}— конфликты решены, можно продолжить.
there-are-conflicts-after-applying = Есть конфликты после применения stash: { $a0 }. Решите их — после этого можно коммитить.
resolve-conflicts = Решить конфликты
restore-everything-as-it-was = Вернуть всё как было до операции
open-repository-2 = Откройте репозиторий
choose-folder-with-local-git = Выберите папку с локальным Git-репозиторием
loading = Загрузка…
open-repository-3 = Открыть репозиторий
create-repository-in-project-folder = { $a0 }Создать репозиторий в папке проекта
connect-project-folder-to-gitlab = { $a0 }Подключить папку проекта к GitLab / GitHub
clone-repository-from-link = { $a0 }Клонировать репозиторий по ссылке
if-chosen-folder-has-no = { $a0 } Если в выбранной папке нет Git, приложение предложит его инициализировать.
ctrl-o-open-ctrl-n = Ctrl+O — открыть · Ctrl+N — создать.
how-to-use-app-f1 = { $a0 } Как пользоваться программой (F1)

## src/boot.tsx

interface-crashed-with-error = Интерфейс упал с ошибкой
reload = Перезагрузить
copy-error = Скопировать ошибку

## src/components/ActionBuilder.tsx

new-action = Новое действие
action-builder-2 = { $a0 }<1>Конструктор действий</1>
new-action-2 = { $a0 } Новое действие
ready-made-templates = Готовые шаблоны
changes-are-saved-immediately = <0>Изменения сохраняются сразу</0>{ $a1 }
close-esc = Закрыть (Esc)
copy-2 = { $a0 } (копия)
your-own-buttons-for-frequent = Свои кнопки для частых дел
build-chain-of-steps-for = Соберите цепочку шагов — например, «создать ветку от main, rebase, push, merge request» — и запускайте её одной кнопкой на панели или сочетанием клавиш.
empty-action = { $a0 } Пустое действие
icon = Иконка
action-name = Название действия
button-on-top-toolbar = Кнопка на панели сверху
ask-for-confirmation-before-running = Спрашивать подтверждение перед запуском
run-in-order-error-stops = { $a0 }<1>выполняются по порядку; ошибка останавливает цепочку</1>
steps = Шаги
add-step = { $a0 } Добавить шаг
variables-in-fields = Переменные в полях
copy-3 = Скопировать
will-ask-at-run-time = При запуске спросит: { $a0 }
delete-for-sure = Точно удалить?
copy-4 = { $a0 } Копия
run-2 = { $a0 } Запустить
drag-to-reorder = Перетащите, чтобы изменить порядок
up = Выше
down = Ниже
remove-step = Убрать шаг
runs-as-is-undo-doesnt = { $a0 } Выполняется как есть — Undo для своих команд не работает
which-step-to-add = <0>Какой шаг добавить?</0>{ $a1 }
keyboard-shortcut = { $a0 } Горячая клавиша
press-shortcut-esc-cancel-backspace = Нажмите сочетание… (Esc — отмена, Backspace — убрать)
none-click-to-assign = Нет — нажмите, чтобы назначить
remove-shortcut = Убрать сочетание

## src/components/ActionRunner.tsx

retry-from-step = { $a0 } Повторить с шага { $a1 }
done-2 = Готово{ $a0 }
cancel = Отмена

## src/components/AuthDialog.tsx

username-and-password = Логин и пароль
access-token = Токен доступа
ssh-key = SSH-ключ
public-key-copied-to-clipboard = Публичный ключ скопирован в буфер обмена
hide-2 = Скрыть
show = Показать
repository-sign-in-2 = Авторизация репозитория
remove-shared-sign-in-for = Удалить общий вход для всех репозиториев на { $a0 }
remove-this-repositorys-saved-sign = Удалить сохранённый вход этого репозитория
forget = { $a0 } Забыть
done = Готово
checking = Проверяем…
sign-in-and-retry = Войти и повторить
no-server-specified = Сервер не указан
repository-without-remote = Репозиторий без remote
enter-your-servers-address-below = введите адрес своего сервера ниже
specify-where-its-hosted-remote = укажите, где он хранится — remote origin будет добавлен
repository-address = Адрес репозитория
will-be-added-as-origin = будет добавлен как origin
add-project-path = Добавьте путь проекта: <0>{ $a1 }</0>
group-project = группа/проект
on-save-remote-will-change = При сохранении remote { $a0 } сменится:
on-save-remote-origin-will = При сохранении будет добавлен remote origin:
address-is-ssh-username-password = Адрес — SSH: логин, пароль и токен для него не используются
address-is-https-ssh-key = Адрес — HTTPS: SSH-ключ для него не используется
address-starts-with-https-ssh = Адрес начинается с https:// — SSH-ключ для него не используется. Войдите логином и паролем или токеном, либо переведите адрес на SSH.
address-is-ssh-git-it = Адрес — SSH (git@…): для него нужен SSH-ключ. Логин, пароль и токен работают только с адресами https://.
switch-address-to-ssh = Перевести адрес на SSH
switch-address-to-https = Перевести адрес на HTTPS
username = Имя пользователя (Username)
username-2 = Имя пользователя
password = Пароль (Password)
saved-type-to-replace = •••••• сохранён — введите, чтобы заменить
password-2 = Пароль
with-two-factor-authentication-doesnt = { $a0 } с двухфакторной защитой не принимает обычный пароль для Git — используйте вкладку «Токен доступа».
saved-paste-to-replace = •••••• сохранён — вставьте, чтобы заменить
token = Токен
optional = необязательно
default = по умолчанию: { $a0 }
username-for-token = Имя пользователя для токена
requires-scopes = Нужны права { $a0 }.
and = {" "}и{" "}
requires-token-with-write-access = Нужен токен с правом записи в репозиторий.
create-token = Создать токен { $a0 }
this-same-sign-in-also = { $a0 }<1>Эта же авторизация работает и для пайплайнов CI/CD — отдельно входить не нужно. { $a2 }</1>
existing-key = Существующий ключ
create-new-key = Создать новый ключ
private-key-2 = Приватный ключ
looking-for-keys-in-ssh = { $a0 } Ищем ключи в ~/.ssh…
no-keys-found-in-choose = В { $a0 } ключей не найдено — выберите файл или { $a1 }.
create-new-key-2 = создайте новый ключ
no-key-selected = ключ не выбран
file-4 = { $a0 } Файл…
copy-public-part-pub-to = Скопировать публичную часть (.pub) — для добавления на сервер
key-passphrase = Пароль ключа (Passphrase)
if-key-is-protected-by = если ключ защищён паролем
saved = •••••• сохранён
key-passphrase-2 = Пароль ключа
ci-cd-pipelines-optional = { $a0 } Пайплайны CI/CD<1>— необязательно</1>
accepts-it-for-pull-push = { $a0 } { $a1 } принимает для Pull/Push, но не для API. Чтобы эта же авторизация открывала и пайплайны, добавьте токен — он сохранится вместе с ней. { $a2 }{ $a3 }
token-for-pipelines = Токен для пайплайнов
theyre-tied-to-repository-on = { $a0 } Они привязаны к репозиторию <1>{ $a2 }</1> на { $a3 } — другие репозитории этого сервера их не получат. Git получает их напрямую, без окон входа.{ $a4 }{ $a5 }
credentials = Данные
server-2 = сервере
currently-saved = Сейчас сохранено: { $a0 }{ $a1 }{ $a2 }.
shared-sign-in-for-all = Сейчас действует общий вход для всего { $a0 } ({ $a1 }{ $a2 }), сохранённый раньше. После сохранения у этого репозитория будет свой.
username-and-password-2 = логин и пароль
token-2 = токен
api-scope-covers-everything = Права api хватает на всё.
token-needs-repo-and-workflow-scopes = Токену нужны права repo и workflow (для раннеров и секретов — администратор репозитория).
token-needs-write-repository-scope = Токену нужны права write:repository.
app-password-needs-pipelines-and = Паролю приложения нужны права Pipelines и Repositories.
ci-cd-pipelines-work-with = { $a0 } Пайплайны CI/CD работают от этой авторизации{ $a1 }.
ci-cd-pipelines-dont-open = Пайплайны CI/CD от этой авторизации не открываются — нужен токен.
own-server = Свой сервер
where-repository-is-hosted = Где хранится репозиторий
address-is-set-in-clone = Адрес задан в окне клонирования
server-address = Адрес сервера
from-repository-link = из ссылки на репозиторий
domain-optionally-with-port = домен, можно с портом
previously = Ранее:{ $a0 }
chosen-by-you = выбран вами
detecting-from-server-response = { $a0 } определяем по ответу сервера…
detected-from-server-response = { $a0 } определён по ответу сервера{ $a1 }
choose-type-manually = { $a0 } — выберите тип вручную
server-didnt-respond-2 = Сервер не ответил
remembered-for-this-server = запомнен для этого сервера
by-server-address = по адресу сервера
server-type = <0>Тип сервера</0>{ $a1 }{ $a2 }
server-type-2 = Тип сервера
not-selected = не выбран
recommended = рекомендуется
for-old-servers = для старых серверов
file-name = Имя файла
key-file-name = Имя файла ключа
comment = Комментарий
usually-email-to-recognize-key = обычно email — чтобы узнать ключ в списке на сервере
key-comment = Комментарий ключа
new-key-passphrase = Пароль нового ключа
repeat-passphrase = Повтор пароля
repeat-key-passphrase = Повтор пароля ключа
passphrases-dont-match = Пароли не совпадают
file-name-only-no-folders = Только имя файла — без папок и .pub
key-passphrase-will-be-saved = Пароль ключа сохранится зашифрованным — вводить его при каждой операции не придётся.
without-passphrase-key-is-protected = Без пароля ключ защищён только правами на файл. Существующие ключи не перезаписываются.
create-key = { $a0 } Создать ключ
key-created = { $a0 }<1>Ключ <2>{ $a3 }</2> создан<4> · { $a5 }</4></1>{ $a6 }
another-one = ещё один
public-key = Публичный ключ
copied-to-clipboard = Скопирован в буфер
open-ssh-keys-on = { $a0 } Открыть SSH Keys на { $a1 }
add-public-key-on-server = Добавьте публичный ключ на сервере: { $a0 } → вставьте из буфера → Add key.
button-above = кнопка выше
profile-settings-ssh-keys = настройки профиля → SSH Keys
click-app-will-remember-key = Нажмите <0>«{ $a1 }»</0> — программа запомнит ключ для { $a2 }.
this-server = этого сервера

## src/components/BranchPicker.tsx

find-branch-or-enter-new = Найти ветку или ввести имя новой…
in-progress-switching-branches-is = { $a0 }Идёт { $a1 } — переключение веток недоступно, пока операция не завершена или не прервана.
if-changes-conflict-with-selected = Если изменения конфликтуют с выбранной веткой, git остановится и попросит сначала сделать commit или stash
uncommitted-changes-will-come-with = Незакоммиченные изменения ({ $a0 }) перейдут вместе с вами в выбранную ветку
local-2 = Локальные
current-branch-show-in-graph = Текущая ветка — показать в графе
ahead-of-by = Впереди { $a0 } на { $a1 }
behind-by = Позади { $a0 } на { $a1 }
branch-was-deleted-on-remote = Ветка на remote удалена
no-upstream-branch-is-local = Нет upstream — ветка только локальная
remote = Удалённые
create-local-branch-tracking-and = Создать локальную ветку { $a0 }, отслеживающую { $a1 }, и переключиться
create-local = создать локальную
create-branch-from-current-head = Создать ветку { $a0 } от текущего HEAD и переключиться на неё
create-branch-2 = Создать ветку <0>{ $a1 }</0>
from-head = от HEAD
is-invalid-branch-name = «{ $a0 }» — недопустимое имя ветки
nothing-found = Ничего не найдено
select-switch = <0><1>↑↓</1> выбор</0><2><3>{ $a4 }</3>переключиться</2>{ $a5 }
new-branch-2 = { $a0 } Новая ветка…
current-2 = текущая
show-in-graph = Показать в графе

## src/components/BranchSync.tsx

update-pull = Обновить { $a0 } (Pull){ $a1 }
without-switching-2 = {" "}без переключения
has-diverged-from-server-switch = { $a0 } разошлась с сервером — переключитесь и сделайте Pull
update-3 = Обновить { $a0 }
was-deleted-on-server = { $a0 } удалена на сервере
incoming-commits = Входящие коммиты: { $a0 }
outgoing-commits = Исходящие коммиты: { $a0 }
couldnt-get-commit-list = Не удалось получить список коммитов
will-arrive-on-pull = Придут при Pull
will-leave-on-push = Уйдут при Push
loading-2 = { $a0 } Загружаем…
click-show-in-graph =
    { $a0 }
    { $a1 }
    Клик — показать в графе
and-more-2 = …и ещё { $a0 }
update-pull-2 = { $a0 } Обновить (Pull)
branch-has-its-own-commits = В ветке есть свои коммиты (↑{ $a0 }) — переключитесь на неё и сделайте Pull.
to-send-them-switch-to = Чтобы отправить — переключитесь на ветку и сделайте Push.
without-switching-branches = без переключения ветки

## src/components/ChangeRuler.tsx

change-map = Карта изменений
change-of = Изменение { $a0 } из { $a1 }: +{ $a2 } −{ $a3 }

## src/components/ci/CheckView.tsx

errors = Ошибки
error = ошибка
warnings = Предупреждения
warning = предупреждение
tips = Советы
tip = совет
errors-2 = ошибки
errors-3 = ошибок
warnings-2 = предупреждения
warnings-3 = предупреждений
tips-2 = совета
tips-3 = советов
configuration-check-isnt-available-for = Проверка конфигурации недоступна для этого файла
pipeline-wont-be-created-or = { $a0 } { $a1 } — пайплайн не создастся или задания упадут
no-obvious-errors-but-some = Явных ошибок нет, но есть то, что может сломаться
check-passed-no-errors-found = Проверка пройдена — ошибок не найдено
checked-locally-without-sending-to = { $a0 } · { $a1 }, проверено локально, без отправки на сервер{ $a2 }
no-remarks = Замечаний нет
on-unsaved-draft = {" "}· по несохранённому черновику
checked-syntax-and-keys-references = Проверяются синтаксис и ключи, ссылки между заданиями, правила запуска, а также команды скриптов — против файлов репозитория и образов заданий.
all = Все · { $a0 }
collapse-all = Свернуть все
expand-all = Развернуть все
when = Когда
how-it-shows-up = Как проявится
why = Почему
how-to-fix = Как исправить
show-in-file = { $a0 } Показать в файле{ $a1 }
line = {" "}· строка { $a0 }
job-on-diagram = Задание «{ $a0 }» на схеме { $a1 }
check-code = Код проверки
what-runs-on-different-events = { $a0 } Что запустится при разных событиях
workflow-rules-rules-and-only = Правила workflow, rules и only/except прогнаны для типичных событий. Значения переменных из настроек проекта и список изменённых файлов заранее неизвестны — такие задания помечены «?».
wont-be-created = { $a0 } не создастся
job-3 = задание
jobs = задания
jobs-3 = заданий
no-pipeline = { $a0 } нет пайплайна
depends-on-2 = {" "}· зависит от: { $a0 }
pipeline-wont-be-created-gitlab = Пайплайн: не создастся — GitLab отклонит его с ошибкой ниже
pipeline-3 = Пайплайн: { $a0 } — { $a1 }
created-2 = создаётся
not-created = не создаётся
will-be-in-pipeline = Попадут в пайплайн
wont-be-in-it = Не попадут
depends-on-3 = {" "}· зависит от { $a0 }
configuration-check-no-errors-found = { $a0 }<1>Проверка конфигурации: ошибок не найдено</1>{ $a2 }<3>Подробнее { $a4 }</3>
check-found-errors-ci-wont = Проверка нашла ошибки — CI не запустится или задания упадут
check-some-things-may-break = Проверка: есть то, что может сломаться
all-problems = Все проблемы { $a0 }
line-2 = стр. { $a0 }

## src/components/ci/CiEditor.tsx

live-runners-labels = Метки живых раннеров

## src/components/ci/CiPanel.tsx

detect-automatically = Определять автоматически
pipelines-2 = Пайплайны { $a0 }
ci-cd-pipelines = Пайплайны CI/CD
pipeline-statuses-in-graph-logs = Статусы пайплайнов в графе, логи, запуск, раннеры и секреты работают от авторизации репозитория — той же, что для Pull и Push. Отдельно входить не нужно.
couldnt-determine-where-this-repositorys = Не удалось определить, где выполняется CI этого репозитория. Укажите сервис и, для своего сервера, адрес API.
pipelines = Пайплайны
runners = Раннеры
secrets-and-variables = Секреты и переменные
secrets-are-visible-only-to = Секреты видны только администраторам репозитория
schedules = Расписания
connection = Подключение
open-repository-in = Открыть репозиторий в { $a0 }
ci-cd-token-from-previous = Токен CI/CD из прежней версии
repository-sign-in-same-as = Авторизация репозитория — та же, что для Pull и Push
repository-sign-in-3 = · авторизация репозитория
view-only = · только просмотр
ci-cd-connection-saved = Подключение CI/CD сохранено
own-server-specify-service-and = { $a0 } Свой сервер: указать сервис и адрес API
ci-cd-connection = Подключение CI/CD
service-2 = <0>Сервис</0>{ $a1 }
currently-2 = { $a0 } (сейчас: { $a1 })
base-api-url-for-your = <0>Base API URL — для своего сервера (GitLab Self-Managed, GitHub Enterprise, Gitea)</0>{ $a1 }<2>Пусто — { $a3 }. Токен — из авторизации репозитория, отдельно его вводить не нужно.</2>
by-remote-address = по адресу remote
save = Сохранить
minimize = Свернуть
all-2 = Все
branch-5 = ветка
refresh = Обновить
no-active-branch = Нет активной ветки
no-permission-to-run = Нет прав на запуск
run-3 = Запустить
couldnt-refresh = Не удалось обновить: { $a0 }
branch-has-had-no-pipelines = В ветке { $a0 } пайплайнов ещё не было
no-pipelines-yet = Пайплайнов ещё не было
select-pipeline-on-left = Выберите пайплайн слева
pipeline-started = Пайплайн #{ $a0 } запущен
pipeline-started-2 = Пайплайн запущен
artifact-downloaded = Артефакт { $a0 } скачан
loading-pipeline = { $a0 } Загружаем пайплайн #{ $a1 }…
unavailable-2 = Недоступно
failed-jobs-of-pipeline-restarted = Упавшие задания пайплайна #{ $a0 } перезапущены
retry-failed = Перезапустить упавшие ({ $a0 })
pipeline-restarted = Пайплайн #{ $a0 } перезапущен
retry = Перезапустить
cancel-for-sure = Точно отменить?
pipeline-canceled = Пайплайн #{ $a0 } отменён
in-2 = В { $a0 }
pipeline = Пайплайн
show-commit-in-graph = Показать коммит в графе
started-by = запустил { $a0 }
coverage = покрытие { $a0 }%
ci-configuration-error = { $a0 } Ошибка в конфигурации CI
pipeline-has-no-jobs = В пайплайне нет заданий
artifacts = { $a0 } Артефакты <1>{ $a2 }</1>
pipeline-saved-no-artifacts = Пайплайн не сохранил артефактов
retention-period-expired-artifact-was = Срок хранения истёк — артефакт удалён
download = Скачать
job-started = Задание { $a0 } запущено
job-restarted = Задание { $a0 } перезапущено
job-canceled = Задание { $a0 } отменено
starts-another-pipeline-open-in = Запускает другой пайплайн — открыть в браузере
open-log = Открыть лог
pipeline-4 = → пайплайн #{ $a0 } · { $a1 }
allowed-to-fail = {" "}· можно упасть

## src/components/ci/common.tsx

running-now = Идёт сейчас
duration = Длительность
b = { $a0 } Б
kb = { $a0 } КБ
mb = { $a0 } МБ
gb = { $a0 } ГБ
tag-4 = тег
label-is-set-by-server = Метку задаёт сам сервер — её не убрать
remove = Убрать { $a0 }

## src/components/ci/DagView.tsx

column-is-jobs-that-can = <0>Колонка — задания, которые могут идти одновременно</0>{ $a1 }{ $a2 }
waits-for-previous-stage = { $a0 }ждёт предыдущий этап

## src/components/ci/DraftTools.tsx

unsaved-diagram-already-shows-draft = { $a0 }<1>Не сохранено: <2>{ $a3 }</2><4>схема уже показывает черновик</4></1>{ $a5 }{ $a6 }{ $a7 }{ $a8 }
check-draft-on-gitlab-server = Проверить черновик на сервере GitLab (CI Lint)
check-in-gitlab = { $a0 } Проверить в GitLab
what-will-change-in-file = Что изменится в файле
changes-3 = { $a0 } Изменения
restore-file-as-on-disk = Вернуть файл как на диске
discard-edits = { $a0 } Отменить правки
save-ctrl-s = Сохранить (Ctrl+S)
save-2 = { $a0 } Сохранить
what-will-change = Что изменится
comparing = { $a0 } Сравниваем…
keep-editing = Продолжить правку
no-changes = Нет изменений
gitlab-check-failed = Проверка в GitLab не удалась: { $a0 }
gitlab-accepted-configuration = GitLab принял конфигурацию
gitlab-found-errors = GitLab нашёл ошибки
for-branch = · для ветки { $a0 }
will-run = <0>Запустятся:</0>{ $a1 }
stage-4 = этап { $a0 }{ $a1 }
no-job-will-run-for = Для этой ветки ни одно задание не запустится.
included-files-taken-into-account = Учтены подключаемые файлы: { $a0 }

## src/components/ci/GitLabSchedules.tsx

loading-schedules = { $a0 } Загружаем расписания…
pipelines-that-gitlab-runs-by = Пайплайны, которые GitLab запускает сам по расписанию — например, ночная сборка или еженедельная проверка зависимостей.
new-schedule = Новое расписание
requires-token-with-api-scope = Нужен токен со scope «api»
schedule-2 = { $a0 } Расписание
no-schedules-yet = Расписаний пока нет
next-run = след. запуск { $a0 }
owner = владелец @{ $a0 }
last-run-pipeline = Последний запуск: пайплайн #{ $a0 } — { $a1 }
run-now = Запустить сейчас
scheduled-pipeline-started = Пайплайн по расписанию «{ $a0 }» запущен
take-ownership-currently-required-to = Стать владельцем (сейчас — @{ $a0 }). Нужно, чтобы менять расписание
you-now-own-schedule = Теперь вы владелец расписания
edit-2 = Изменить
click-again-to-delete = Нажмите ещё раз, чтобы удалить
schedule-deleted = Расписание «{ $a0 }» удалено
open-in-gitlab = Открыть в GitLab
soon = скоро
in-min = через { $a0 } мин
in-h = через { $a0 } ч
schedule-saved = Расписание сохранено
schedule-created = Расписание создано
edit-schedule = Изменить расписание
description = Описание
nightly-build = Ночная сборка
when-to-run = Когда запускать
n-5-fields-are-needed-minute = Нужно 5 полей: минуты часы день месяц день_недели
format-accepted-gitlab-will-check = Формат принят — GitLab проверит при сохранении
branch = Ветка
time-zone = Часовой пояс
yours = {" "}(ваш)
enabled = { $a0 }Включено
create = Создать
enabled-turn-off = Включено — выключить
disabled-turn-on = Выключено — включить

## src/components/ci/GitLabVariables.tsx

variable-deleted = Переменная { $a0 } удалена
loading-variables = { $a0 } Загружаем переменные…
ci-cd-variables-are-visible = Переменные CI/CD видят только Maintainer и Owner проекта
variables-from-project-settings-settings = Переменные из настроек проекта (Settings → CI/CD → Variables). Значение запрашивается у GitLab, только когда вы нажимаете на глаз, и нигде не сохраняется.
add-variable = Добавить переменную
variable = { $a0 } Переменная
project-has-no-variables = В проекте нет переменных
name-value-environment-flags = <0>Имя</0><1>Значение</1><2>Окружение</2><3>Флаги</3>{ $a4 }
hidden-in-gitlab-value-isnt = скрыто в GitLab — значение не выдаётся
hidden-in-gitlab = скрыто в GitLab
empty-2 = пусто
show-value = Показать значение
only-for-protected-branches-and = Только для защищённых веток и тегов
masked-in-job-logs = Скрывается в логах заданий
value-cant-be-viewed-after = Значение нельзя посмотреть после сохранения
no-variable-expansion = Без подстановки $ПЕРЕМЕННЫХ
passed-to-job-as-file = Передаётся в задание как путь к файлу
variable-saved = Переменная { $a0 } сохранена
variable-added = Переменная { $a0 } добавлена
variable-2 = Переменная { $a0 }
new-variable = Новая переменная
name = Имя
type = Тип
variable-3 = Переменная
file-2 = Файл
value-unchanged-until-you-start = Значение (не меняется, пока не начнёте вводить)
value-2 = Значение
hidden-value-enter-new-one = скрытое значение — введите новое
previous-value = •••••••• (прежнее значение)
for-masked-one-line-at = Для masked: одна строка, не короче 8 символов, только буквы, цифры и @ : . ~ - _ + / =
environment = Окружение
all-3 = {"*"} (все)
mask-value-in-logs = Скрывать значение в логах
dont-expand-variables-inside = Не подставлять $ПЕРЕМЕННЫЕ внутри
set-only-on-creation = Задаётся только при создании
value-cant-be-viewed-later = Значение потом нельзя будет посмотреть
name-or-environment-changed-gitlab = Имя или окружение изменились — GitLab создаст новую переменную и удалит старую.
add-2 = Добавить

## src/components/ci/JobForm.tsx

if-previous-stages-succeed-default = Если предыдущие этапы успешны (по умолчанию)
manually-with-button-in-gitlab = Вручную — кнопкой в GitLab
always-even-if-something-failed = Всегда, даже если что-то упало
only-if-something-failed = Только если что-то упало
delayed = С задержкой
dont-run = Не запускать
run-4 = запускать
manually = вручную
always = всегда
dont-run-2 = не запускать
delayed-2 = с задержкой
inherited = унаследовано: { $a0 }
job-name = Имя задания
for-example-unit-tests = например, unit-tests
stage-5 = Этап
docker-image = Docker-образ
commands-script-one-per-line = Команды (script) — по одной на строку
inherited-2 =
    унаследовано:
    { $a0 }
environment-environment = Окружение (environment)
may-fail-error-wont-stop = { $a0 }Может упасть — ошибка не остановит пайплайн
run-after-needs = Запускать после (needs)
in-stage-order = по порядку этапов
right-away-without-waiting-for = сразу, не дожидаясь этапов
add-3 = + добавить…
in-stage-order-no-needs = — по порядку этапов (без needs)
right-away-needs = — сразу (needs: [])
runner-tags-comma-separated = Теги раннера — через запятую
run-rules-rules-first-matching = Правила запуска (rules) — срабатывает первое подходящее
there-are-complex-rules-here = Здесь сложные правила (changes, exists, variables) — правьте их во вкладке «Файл».
ci-commit-branch-main-empty = $CI_COMMIT_BRANCH == "main" (пусто — всегда)
delete-rule = Удалить правило
rule-2 = { $a0 } правило
if-no-rule-matches-job = Если ни одно правило не подошло — задание не запускается.
more-before-script-after-script = { $a0 } Дополнительно: before_script, after_script, timeout
timeout = Таймаут
add-job = Добавить задание

## src/components/ci/JobLog.tsx

back-to-pipeline-esc = Назад к пайплайну (Esc)
scroll-to-first-line-with = Прокрутить к первой строке с Error / FAIL / exit code
to-first-error = К первой ошибке ↓
search-log-f = Поиск по логу ({ $a0 }F)
dont-wrap-lines = Не переносить строки
wrap-lines = Переносить строки
copy-log = Скопировать лог
to-end = В конец
open-in = Открыть в { $a0 }
browser = браузере
find-in-log = Найти в логе…
of = { $a0 } из { $a1 }
not-found-3 = не найдено
previous-shift-enter = Предыдущее (Shift+Enter)
next-enter = Следующее (Enter)
close-search-esc = Закрыть поиск (Esc)
reason = { $a0 } Причина: { $a1 }
s = { $a0 }с
loading-log = { $a0 } Загружаем лог…
log-is-large-kb-end = Лог большой ({ $a0 } КБ) — показан конец. Полностью — на сервере.
this-server-doesnt-provide-logs = Этот сервер не отдаёт логи по API — откройте задание в браузере.
job-hasnt-run-yet-theres = Задание ещё не запускалось — лога нет
waiting-for-runner-output = Ждём вывод раннера…
log-is-empty = Лог пуст
running = { $a0 } выполняется…
s-2 = { $a0 } с

## src/components/ci/RunDialog.tsx

required = обязательно
run-pipeline = Запустить пайплайн · { $a0 }
reading-run-parameters-from-config = { $a0 } Читаем параметры запуска из конфига…
branch-6 = <0>{ $a1 } Ветка</0>{ $a2 }{ $a3 }
no-on-workflow-dispatch = {" "}(нет on: workflow_dispatch)
no-workflow-has-on-workflow = Ни в одном workflow нет «on: workflow_dispatch» — вручную их не запустить. Добавьте этот триггер в файл и отправьте его на сервер.
pipeline-variables = Переменные пайплайна
inputs = Входные параметры (inputs)
variables-from-gitlab-ci-yml-2 = Переменные из .gitlab-ci.yml
custom-environment-variables-key-value = <0>Свои переменные окружения (KEY=VALUE)</0>{ $a1 }
value = значение
remove-2 = Убрать
fill-in = Заполните: { $a0 }

## src/components/ci/Runners.tsx

idle = свободен
busy = занят
offline = не в сети
paused = на паузе
inactive-runners-deleted = Удалено неактивных раннеров: { $a0 }
failed-2 = Не удалось: { $a0 }
loading-runners = Загружаем раннеры…
self-hosted = { $a0 } Собственные <1>{ $a2 }</1>
cloud = { $a0 } Облачные <1>{ $a2 }</1>
name-or-tag = Имя или тег
clean-up-inactive = Очистить неактивные{ $a0 }
delete-offline = Удалить { $a0 } офлайн?
no-permission = Нет прав
no-offline-self-hosted-runners = Нет собственных раннеров не в сети
connect-runner = Подключить раннер
no-runners-available-jobs-will = Нет доступных раннеров — задания будут ждать в очереди. Нажмите «Подключить раннер».
no-self-hosted-runners-jobs = Собственных раннеров нет — задания берут облачные
open-job = Открыть задание
unknown-os = ОС неизвестна
cloud-2 = облачный
shared = общий
last-online = был в сети { $a0 }
insert-into-config = { $a0 } Вставить в конфиг
shared-runner-is-changed-by = Общий раннер меняет администратор сервера
runner-saved = Раннер { $a0 } сохранён
runner-deleted = Раннер { $a0 } удалён
runner = Раннер { $a0 }
delete-runner-for-sure = Точно удалить раннер?
shared-runner-is-deleted-by = Общий раннер удаляет администратор сервера
close = Закрыть
providers-cloud-runner-managed-by = Облачный раннер провайдера — им управляет сам сервис.
servers-shared-runner-only-admin = Общий раннер сервера: менять его может только администратор.
tags-labels = Теги / метки { $a0 }
gray-ones-are-system-labels = (серые — системные, их задаёт GitHub)
paused-2 = На паузе
active = Активен
paused-runner-doesnt-take-new = На паузе раннер не берёт новые задания, а текущие доделывает — можно вывести сервер на обслуживание без обрыва сборок
run-untagged-jobs = Брать задания без тегов (Run untagged jobs)
locked-to-current-project = Только для этого проекта (Locked to current project)
description-2 = <0>Описание (Description)</0>{ $a1 }
maximum-job-timeout-minutes = <0>Максимальный тайм-аут задания, минут (Maximum job timeout)</0>{ $a1 }
as-in-project = как в проекте
local-runner-started-in-docker = Локальный раннер { $a0 } запущен в Docker
in-few-seconds-it-will = Через несколько секунд он появится в списке со статусом Online
connect-runner-2 = Подключить раннер · { $a0 }
new-runners-tags = Теги нового раннера
name-optional = <0>Имя (необязательно)</0>{ $a1 }
run-untagged-jobs-2 = Брать задания без тегов
without-tags-runner-picks-up = Без тегов раннер берёт только такие задания
get-token-and-commands = Получить токен и команды
runner-token = Токен раннера
registration-token = Токен регистрации
valid-until = действует до { $a0 }
token-is-shown-once-dont = { $a0 } Токен показывается один раз — не публикуйте его.
run-in-powershell-as-administrator = Выполните в PowerShell от администратора.
run-in-terminal-of-server = Выполните в терминале сервера, где будет работать раннер.
local-runner-in-docker-on = { $a0 }<1>Локальный раннер в Docker на этом компьютере</1>{ $a2 }
starts-runner-container-with-these = Поднимет контейнер раннера с этими тегами и зарегистрирует его в { $a0 } — чтобы гонять пайплайны на своём компьютере. Остановить можно здесь же, во вкладке «Раннеры».
run-locally = Запустить локально
local-runners-docker = { $a0 } Локальные раннеры (Docker)
container-is-running = Контейнер { $a0 } запущен
stop-and-remove-container = Остановить и удалить контейнер
container-stopped-and-removed = Контейнер { $a0 } остановлен и удалён

## src/components/ci/Secrets.tsx

secret-deleted = Секрет { $a0 } удалён
loading-secrets-and-variables = Загружаем секреты и переменные…
repository-secrets-and-variables-in = Секреты и переменные репозитория в { $a0 }. Значения секретов сервер не показывает — их можно только заменить. Переменные видны всем, у кого есть доступ к репозиторию.
secrets-2 = Секреты
no-secrets = Секретов нет
variables = Переменные
no-variables = Переменных нет
secret-saved = Секрет { $a0 } сохранён
delete-3 = Удалить?
edit-3 = Изменить { $a0 }
new-secret-or-variable = Новый секрет или переменная
name-3 = <0>Имя</0>{ $a1 }
new-value-server-doesnt-show = Новое значение (старое сервер не показывает)
secret-value-hidden = Секрет (значение скрыто)
secret-is-encrypted-and-not = Секрет шифруется и не показывается в логах. Переменная видна в настройках и логах.

## src/components/CiView.tsx

if-previous-stages-succeed = если предыдущие этапы успешны
only-if-something-failed-2 = только если что-то упало
diagram = Схема
check = Проверка
history = История
file-changed-on-disk = Файл изменился на диске
was-changed-in-another-editor = { $a0 } поменяли в другом редакторе, пока вы его правили здесь. Что сделать?
load-from-disk-my-edits = Загрузить с диска (мои правки пропадут)
save-over-it = Сохранить поверх
couldnt-save = Не удалось сохранить { $a0 }
saved-2 = Сохранено
file-will-appear-in-changes = Файл появится в изменениях — его можно закоммитить
discard-edits-2 = Отменить правки?
unsaved-changes-in-will-be = Несохранённые изменения в { $a0 } пропадут.
no-2 = Нет
discard-edits-3 = Отменить правки
there-are-unsaved-edits = Есть несохранённые правки
changes-in-arent-saved-yet = Изменения в { $a0 } ещё не сохранены.
close-without-saving = Закрыть без сохранения
save-and-close = Сохранить и закрыть
also-updated = Заодно обновлено
runner-tags-inserted-into-config = Теги раннера вставлены в конфиг
created-3 = Создан { $a0 }
adjust-it-for-your-project = Поправьте под свой проект и закоммитьте
file-is-changed-but-not = Файл изменён, но изменения ещё не закоммичены — показана версия с диска
changed-locally = изменён локально
check-configuration-on-gitlab-server = Проверить конфигурацию на сервере GitLab (CI Lint) — с учётом шаблонов и include
repository-has-no-ci-cd = В репозитории нет файлов CI/CD
open-file-in-external-editor = Открыть файл во внешнем редакторе
reload-from-disk = Перечитать с диска
reading-ci-cd-settings = { $a0 } Читаем настройки CI/CD…
new-job = Новое задание
edit-4 = Изменить «{ $a0 }»
errors-in-file-ci-most = Ошибки в файле — CI, скорее всего, не запустится
things-to-note = На что обратить внимание
when-it-runs = Когда запускается
parameters-2 = Параметры
variables-2 = { $a0 }Переменные: { $a1 }
included-files = Подключаемые файлы
read = прочитан{ $a0 }
external-not-loaded = внешний — не загружается
pipeline-5 = <0>Пайплайн</0>{ $a1 }
diagram-isnt-built-for-yet = Для { $a0 } схема пока не строится — откройте вкладку «Файл».
stages = Этапы
execution-graph-dag = Граф выполнения (DAG)
hover-over-job-to-highlight = Наведите на задание — подсветится цепочка зависимостей
no-jobs-found-in-file = В файле не найдено ни одного задания{ $a0 }
templates-hidden-jobs = { $a0 }Шаблоны (скрытые задания) · { $a1 }
show-in-file-2 = Показать в файле
used-by = используют: { $a0 }
not-used-anywhere-via-extends = нигде не используется через extends
no-jobs = нет заданий
job-5 = { $a0 } задание
stage-name = имя этапа
stage-6 = { $a0 } Этап
stage-isnt-declared-in-stages-2 = Этап не объявлен в stages
add-stage-to-stages = Добавить этап в stages
fix = исправить
rename-stage = Переименовать этап
move-earlier = Сдвинуть раньше
move-later = Сдвинуть позже
move-or-delete-stages-jobs = Сначала перенесите или удалите задания этапа
delete-stage = Удалить этап
starts-another-pipeline = запускает другой пайплайн
external = внешнее
may-fail = может упасть
rules = правил: { $a0 }
after = после: { $a0 }
stage-7 = этап { $a0 }
edit-5 = { $a0 } Изменить
job-is-defined-in-included = Задание описано в подключаемом файле — { $a0 }, чтобы его изменить.
open-2 = откройте { $a0 }
open-in-check-tab-when = Открыть на вкладке «Проверка»: когда, как проявится, почему и как исправить
per-rules-below = по правилам ниже
after-jobs-in-links = после заданий из «Связи»
automatically = автоматически
if-condition-is-met = , если выполнено условие
in-3 = через { $a0 }
error-wont-stop-pipeline = · ошибка не остановит пайплайн
first-matching-rule-fires-if = Срабатывает первое подходящее правило; если ни одно не подошло — задание не запускается.
where-it-runs = Где выполняется
image = образ
from-4 = из { $a0 }
global-settings = глобальных настроек
services-2 = сервисы
runner-tags-2 = теги раннера
links = Связи
after-2 = <0>после</0>{ $a1 }
go-to-job = Перейти к заданию
no-such-job = Такого задания нет
opt = {" "}(опц.)
starts-right-away-without-waiting = {"["}] — стартует сразу, не дожидаясь этапов
artifacts-from = артефакты из
dont-download = — (не скачивать)
inherits = наследует
starts = запускает
commands = Команды
steps-2 = Шаги · { $a0 }
result = Результат
environment-2 = окружение
artifacts-2 = артефакты
kept-for = хранятся
reports = отчёты
cache = кэш
other = Прочее
timeout-2 = таймаут
retries = повторы
final-job-configuration = { $a0 }Итоговая конфигурация задания{ $a1 }
with-extends-applied = {" "}(с учётом extends)
no-file-2 = Нет файла
changed-not-committed = Изменён, не закоммичен
tab-indent-ctrl-comment-ctrl = Tab — отступ · Ctrl+/ — комментарий · Ctrl+S — сохранить
step-template = { $a0 } Шаблон шага { $a1 }
insert-at-cursor = Вставить в позицию курсора
ci-cd-files-have-never = Файлы CI/CD ещё ни разу не коммитились
commits-that-changed-ci-cd = Коммиты, в которых менялись настройки CI/CD. Клик — показать коммит в графе.
repository-has-no-ci-cd-settings = В репозитории нет настроек CI/CD
looking-for-files-gitlab-ci = Ищем файлы: <0>.gitlab-ci.yml</0>, <1>.github/workflows/*.yml</1>, <2>Jenkinsfile</2>, <3>bitbucket-pipelines.yml</3>, <4>.circleci/config.yml</4>, <5>azure-pipelines.yml</5> и другие.
create-gitlab-ci-yml = { $a0 } Создать .gitlab-ci.yml
create-github-actions = { $a0 } Создать GitHub Actions
view-pipelines = Посмотреть пайплайны{ $a0 }

## src/components/CloneDialog.tsx

where-to-save-repository = Куда сохранить репозиторий
clone-repository-2 = Клонировать репозиторий
paste-address-and-click-check = Вставьте адрес и нажмите «Проверить»
choose-folder = Выберите папку
cancel-2 = { $a0 } Отменить
clone = { $a0 } Клонировать
check-2 = { $a0 }Проверить
https-or-ssh-address-from = HTTPS или SSH-адрес из кнопки «Code» / «Clone» на странице проекта. Если репозиторий приватный, появится окно входа.
enter-credentials = { $a0 } Ввести учётные данные
access-granted = <0>{ $a1 } Доступ есть{ $a2 }</0>{ $a3 }
repository-is-empty-it-will = Репозиторий пустой — склонируется без файлов
default-2 = {" "}(по умолчанию)
branches = веток
where = Куда
choose-folder-2 = Выберите папку…
folder-name = имя-папки
only-last-50-commits-faster = { $a0 }Только последние 50 коммитов — быстрее для больших репозиториев

## src/components/CommitDetails.tsx

select-commit = Выберите коммит
commit-3 = { $a0 }<1>коммит:</1><2>{ $a3 }</2>{ $a4 }{ $a5 }
this-is-current-commit-nothing = Это текущий коммит — восстанавливать нечего
restore-files-from-commit-checkout =
    Восстановить файлы из коммита… (checkout files)
    Новый коммит, в котором все файлы проекта — как в этом. История не переписывается, ветка не переключается.
author = автор · { $a0 }
parents = родители:
parent = родитель:
vs-1st-parent = vs 1-й родитель
no-changed-files = Нет изменённых файлов
found-here = «{ $a0 }» найдено здесь: { $a1 }
found-in = { $a0 }{ $a1 }<2>«{ $a3 }» найдено: { $a4 } в { $a5 } { $a6 }</2>
file-5 = файле
files-4 = файлах
open-changes-at-match =
    { $a0 }
    Открыть изменения на месте совпадения
added-line = Добавлено, строка { $a0 }
deleted-was-on-line = Удалено, было на строке { $a0 }
and-more-3 = …и ещё { $a0 } { $a1 }
on-branch = на ветке { $a0 }
stashed = спрятано { $a0 } · { $a1 }
restore-only-selected-files-to = Восстановить только выбранные файлы в рабочую папку. Stash остаётся в списке, индекс не меняется. Undo вернёт.
apply-selected = Применить выбранные ({ $a0 })
apply-whole-stash-apply-it = Применить весь stash (Apply), он остаётся в списке. Чтобы взять отдельные файлы — отметьте их ниже.
apply-all = Применить всё
apply-whole-stash-and-remove = Применить весь stash и удалить его из списка (Pop)
pop = Забрать
delete-stash-drop-undo-can = Удалить stash (Drop) — можно вернуть через Undo
clear-selection = Снять выбор
select-all-files = Выбрать все файлы
selected-of = выбрано <0>{ $a1 }</0> из { $a2 }
including-new = {" "}· включая новые
reset = сбросить
check-files-to-restore-only = Отметьте файлы, чтобы восстановить только их, или наведите на файл.
select-for-restoring = Выбрать для восстановления
new = новый
restore-this-file-to-working = Восстановить этот файл в рабочую папку (Undo вернёт)
change = изменение
changes-4 = изменения
changes-5 = изменений
in-4 = {" "}в <0>{ $a1 }</0>
conflicts-2 = <0>Конфликты <1>({ $a2 })</1></0>{ $a3 }
resolve = <0>решить →</0>
unstaged-files = Неиндексированные файлы
stage-all = Добавить все
staged-files = Индексированные файлы
unstage-all = Убрать все
pre-commit-guard-see-warning = Pre-commit Guard: { $a0 } — см. предупреждение над кнопкой Commit
moved-without-content-changes = Перенесён без изменений содержимого
moved-and-changed = Перенесён и изменён
file-was-only-moved-or = Файл только перенесён или переименован — содержимое не менялось
binary-or-too-large-file = Бинарный или слишком большой файл — строки не считаются

## src/components/CommitForm.tsx

commit-4 = Коммит
commit-message-templates = Шаблоны описания коммита
templates = Шаблоны
templates-2 = { $a0 } Шаблоны
commit-form-settings = Настройки формы коммита
commit-type = Тип коммита
click-to-remove = {" "}— клик уберёт
scope-area-of-changes-feat = Scope — область изменений: feat(api): …
choose-commit-type-first = Сначала выберите тип коммита
breaking-change-breaking-change-feat = Несовместимое изменение (BREAKING CHANGE): feat!: …
remove-from-message = Убрать { $a0 } из сообщения
add-issue-number-from-branch = Добавить номер задачи из ветки { $a0 }
how-to-add-issue-number = Как добавлять номер задачи
issue-number-format = Формат номера задачи
summary-what-was-done = Кратко: что сделано
commit-title = Заголовок коммита
git-recommends-keeping-title-within = Git советует укладывать заголовок в 50 символов, максимум — 72
message-contains-skip-ci-pipeline = В сообщении есть [skip ci] — пайплайн для этого коммита не запустится. Клик — убрать
add-skip-ci-commit-wont = Добавить [skip ci]: коммит не запустит пайплайн CI/CD (GitLab, GitHub, Gitea, Bitbucket)
skip-ci-skip-ci = { $a0 } Пропустить CI <1>[skip ci]</1>
stage-files-to-commit = Добавьте файлы в индекс, чтобы закоммитить
enter-commit-message = Введите сообщение коммита
commit-5 = Закоммитить { $a0 } { $a1 }
scope-whats-affected = Scope — что затронуто
by-staged-files-folders = По папкам staged-файлов
remove-scope = Убрать scope
issue-number = Номер задачи <0>{ $a1 }</0>
found-in-branch-name = Найден в имени ветки <0>{ $a1 }</0>
add-issue-number-automatically = { $a0 }<1>Автоматически добавлять номер задачи</1>
your-own-recognition-rule-in = Своё правило распознавания — в настройках →
from-git-config = Из git config
new-template = Новый шаблон
new-2 = { $a0 } новый
my-templates = Мои шаблоны
empty-for-now-save-description = Пока пусто — сохраните описание как шаблон.
save-whats-currently-in-description = Сохранить то, что сейчас в описании
write-description-first = Сначала напишите описание
save-current-description-as-template = { $a0 } Сохранить текущее описание как шаблон
ticket-and-branch-are-substituted = <0>{"{"}ticket{"}"}</0> и <1>{"{"}branch{"}"}</1> подставятся при вставке
edit-template = Изменить шаблон
what-was-done-how-to =
    Что сделано:
    -{" "}
    {""}
    Как проверить:
    {""}
    Задача: {"{"}ticket{"}"}
type-bar-above-commit-title = { $a0 }<1><2>Панель типов над заголовком коммита</2>{ $a3 }</1>
chips-etc-put-prefix-at = Чипсы { $a0 } { $a1 } { $a2 } и др. ставят префикс в начало заголовка, повторный клик убирает его. Рядом — { $a3 } с подсказками по папкам staged-файлов и { $a4 } для несовместимых изменений.
issue-number-from-branch-name = Номер задачи из имени ветки
add-issue-number-automatically-2 = { $a0 }<1><2>Автоматически добавлять номер задачи</2>{ $a3 }</1>
if-branch-name-has-number = Если в имени ветки есть номер ({ $a0 }, { $a1 }, { $a2 }), он сразу появится в новом сообщении. Выключено — номер добавляется кликом по кнопке { $a3 }.
where-to-put-it = Куда ставить
your-own-rule-regular-expression = Своё правило — регулярное выражение, номер берётся из первой группы. Пусто — встроенное распознавание.
for-example-task-d-or = например: (TASK-\d+)  или  /(\d+)-
error-in-expression-built-in = Ошибка в выражении — используется встроенное распознавание
test-on-branch = <0>Проверить на ветке</0>{ $a1 }<2>{ $a3 }</2>
description-templates = Шаблоны описания
take-template-from-git-config = { $a0 }<1><2>Брать шаблон из git config (commit.template)</2>{ $a3 }<4>{ $a5 }</4></1>
as-in-regular-template-text = Как в обычном { $a0 }: текст шаблона предзаполняет описание, строки с { $a1 } становятся подсказкой.
open-repository-to-see-its = Откройте репозиторий, чтобы увидеть его шаблон.
in-this-repository = В этом репозитории: <0>{ $a1 }</0>
not-set-in-this-repository = В этом репозитории не задан. Задать: { $a0 }
my-templates-inserted-with-templates = <0>Мои шаблоны — вставляются кнопкой «Шаблоны» над формой коммита</0>{ $a1 }{ $a2 }
restore-default-templates-yours-will = Вернуть стандартные шаблоны (свои будут удалены)
default-3 = { $a0 } По умолчанию
new-3 = { $a0 } Новый
reset-settings-templates-stay = { $a0 } Сбросить настройки (шаблоны останутся)

## src/components/CommitGraph.tsx

committed-at = Закоммичено: { $a0 }
repository-has-no-commits-yet = В репозитории ещё нет коммитов
drag-to-change-graph-width = Потяните, чтобы изменить ширину графа. Двойной клик — авто
drag-to-change-width-double = Потяните, чтобы изменить ширину. Двойной клик — по содержимому
table-view = Вид таблицы
table-view-columns-row-density = Вид таблицы: колонки, плотность строк, формат даты, узлы графа
showing-last-commits = Показаны последние { $a0 } коммитов
marked-for-comparison-ctrl-click = Отмечен для сравнения — Ctrl+клик по другому коммиту
found-in-changes =
    Найдено в изменениях:
    { $a0 }{ $a1 }
pipeline-click =
    Пайплайн #{ $a0 }: { $a1 }{ $a2 }
    Клик — { $a3 }
log-of-failed-job = лог упавшего задания
details = подробности
click-copy =
    { $a0 }
    Клик — скопировать
more-hover-over =
    {""}
    Ещё { $a0 }: наведите на «+{ $a1 }»
double-click-drag-onto-another =
    {""}
    Двойной клик — { $a0 }
    Перетащите на другую ветку: слить, перемотать, rebase
switch-to-branch = переключиться на ветку
create-local-branch-and-switch = создать локальную ветку и переключиться
head-detached-current-commit-without = HEAD (detached) — текущий коммит без ветки
head-current-commit = HEAD — текущий коммит

## src/components/CompareView.tsx

root-2 = (корень)
compare = { $a0 }<1>Сравнение</1>{ $a2 }{ $a3 }{ $a4 }{ $a5 }{ $a6 }
before-2 = было
swap = Поменять местами
after-3 = стало
file-changed = файл изменён
files-changed = файла изменено
files-changed-2 = файлов изменено
line-added = строка добавлена
lines-added = строки добавлено
lines-added-2 = строк добавлено
line-deleted = строка удалена
lines-deleted = строки удалено
lines-deleted-2 = строк удалено
only-in-after = Есть только в «стало» ({ $a0 })
only-in-before = Есть только в «было» ({ $a0 })
where-most-changes-are = Где больше всего изменений{ $a0 }
show-all-folders = показать все папки
filter-list-by-file-path = Фильтр списка по пути файла
search-text-in-changed-lines = Поиск текста в изменённых строках всех файлов (Ctrl+F)
content = Содержимое
filter-by-path = Фильтр по пути
find-in-changed-lines-of = Найти в изменённых строках всех файлов
find-in-changes = Найти в изменениях
match-case-alt-c = Учитывать регистр (Alt+C)
regular-expression-alt-r = Регулярное выражение (Alt+R)
by-path = по пути
by-size = по объёму
files-in-these-commits-are = Файлы в этих коммитах одинаковые
binary = бинарный
from-before-to-after = { $a0 } от «было» до «стало»
after-is-older-by = «стало» старше на { $a0 } { $a1 }
diverged-and = разошлись: { $a0 } и { $a1 } { $a2 }
enter-text-well-find-it = Введите текст — найдём его в добавленных и удалённых строках всех файлов сравнения.{ $a0 }Клик по строке откроет файл прямо на совпадении.
searching = { $a0 } Ищем…
not-found-in-changed-lines = В изменённых строках не найдено
in-5 = { $a0 } { $a1 } в { $a2 } { $a3 }{ $a4 }
match = совпадение
matches = совпадения
matches-2 = совпадений
first-shown = {" "}· показаны первые { $a0 }
collapse = свернуть
more = ещё { $a0 }{ $a1 }

## src/components/ConflictView.tsx

mine = Моё
theirs = Их
saving = Сохранение
conflict = Конфликт
file-of = { $a0 }файл { $a1 } из { $a2 }{ $a3 }
previous-conflicted-file = Предыдущий конфликтный файл
next-conflicted-file = Следующий конфликтный файл
resolved-of = <0>Решено { $a1 } из { $a2 }</0>{ $a3 }{ $a4 }{ $a5 }
previous-unresolved-alt = Предыдущий нерешённый (Alt+↑)
next-unresolved-alt = Следующий нерешённый (Alt+↓)
show-blocks = Показать блоки
preview-resulting-file = Предпросмотр итогового файла
reload-file-from-disk = Перечитать файл с диска
save-file-and-mark-conflict = Сохранить файл и отметить конфликт решённым (Ctrl+S)
resolve-all-conflicts-in-file = Сначала решите все конфликты в файле
save-and-next = Сохранить и дальше
reading-conflict = { $a0 } Читаем конфликт…
lines-without-conflicts-show = ⋯ { $a0 } строк без конфликтов — показать
conflict-of-line = <0>{ $a1 } Конфликт { $a2 } из { $a3 }</0><4>строка { $a5 }</4>{ $a6 }{ $a7 }{ $a8 }{ $a9 }{ $a10 }{ $a11 }
keep-both-versions-first-then = Оставить обе версии: сначала «{ $a0 }», потом «{ $a1 }»
both = Оба: { $a0 } + { $a1 }
remove-both-versions = Убрать обе версии
neither = { $a0 } Ничего
reset-resolution = Сбросить решение
as-before-both-changes-common = { $a0 } Как было до обоих изменений (общий предок)
result-2 = <0>Результат</0>{ $a1 }{ $a2 }{ $a3 }
order = порядок:{ $a0 }/{ $a1 }
edit-manually = { $a0 } Править вручную
back-to-choosing-lines = { $a0 } Вернуться к выбору строк
choose-version-with-buttons-above = Выберите версию кнопками выше или отметьте нужные строки
block-will-be-deleted = — блок будет удалён —
empty-lines-were-deleted-on = пусто — с этой стороны строки удалены
all-lines = все строки ({ $a0 })
conflict-isnt-resolved-yet = ● конфликт { $a0 } ещё не решён
block-deleted = (блок удалён)
file-was-deleted-in-but = Файл удалён в «{ $a0 }», но изменён в «{ $a1 }»
decide-whether-file-is-needed = { $a0 }: { $a1 }. { $a2 }: { $a3 }. Решите, нужен ли файл.
keep-file-version = { $a0 } Оставить файл (версия «{ $a1 }»)
delete-file = { $a0 } Удалить файл
binary-file-changed-on-both = Бинарный файл изменён с обеих сторон
image-or-other-binary-file = Объединить картинку или другой бинарный файл построчно нельзя — выберите одну версию целиком.
take = { $a0 } Взять «{ $a1 }» ({ $a2 })
take-2 = Взять «{ $a0 }» ({ $a1 }) { $a2 }
file-was-deleted-on-both = Файл удалён с обеих сторон
it-remains-to-confirm-deletion = Осталось подтвердить удаление.
there-are-no-conflict-markers = Маркеров конфликта в файле нет
file-isnt-on-disk = Файла нет на диске
it-looks-like-youve-already = Похоже, вы уже исправили файл (например, в редакторе). Проверьте и отметьте его решённым.
mark-conflict-resolved-file-will = Отметьте конфликт решённым — файл будет удалён из репозитория.
mark-resolved = { $a0 } Отметить решённым
take-entirely = Взять «{ $a0 }» целиком
conflict-in-this-file-is = Конфликт в этом файле уже решён
open-file-in-editor = { $a0 } Открыть файл в редакторе
take-in-all-conflicts-of = Во всех конфликтах этого файла взять «{ $a0 }»
take-everywhere = Взять «{ $a0 }» везде

## src/components/Dialogs.tsx

gits-response = { $a0 } Ответ Git
authorization-required = Требуется авторизация
no-write-access = Нет прав на запись
branch-is-protected = Ветка защищена
push-rejected-by-server = Push отклонён сервером
repository-is-unavailable = Репозиторий недоступен
ssh-unknown-server = SSH: неизвестный сервер
check-access = { $a0 } Проверить доступ
got-it = Понятно
yes = есть
no = нет
not-checked = не проверено
remote-access = Доступ к remote
enter-credentials-2 = Ввести учётные данные
enter-credentials-change-token = Ввести учётные данные / Сменить токен
checking-2 = Проверка…
check-again = Проверить снова
branch-7 = <0>Ветка</0><1>{ $a2 } → { $a3 }</1>
read-fetch = Чтение (fetch)
write-push = Запись (push)
branch-on-remote = Ветка на remote
will-be-created-on-first = — будет создана при первом Push
remote-has-commits-you-dont = { $a0 }На remote есть коммиты, которых нет у вас: перед Push нужен Pull.
permissions-are-checked-safely-git = Права проверяются безопасно: <0>git ls-remote</0> и <1>git push --dry-run</1> ничего не меняют на сервере. Правила защиты веток (protected branches) сервер применяет только при настоящем push — если ветка защищена, это будет сообщено после попытки.
checking-access = { $a0 } Проверяем доступ…
access-hasnt-been-checked-yet = Доступ ещё не проверялся
push-rejected = Push отклонён
yes-overwrite = Да, перезаписать { $a0 }/{ $a1 }
pull-rebase-and-push = Pull (rebase) и Push
has-commits-in-branch-that = На <0>{ $a1 }</0> в ветке <2>{ $a3 }</2> есть коммиты, которых нет у вас. Обычный push перезаписал бы их, поэтому сервер его не примет.
recommended-get-changes-with-pull = Рекомендуется: получить изменения через Pull (rebase), затем отправить свои коммиты.
force-push-with-force-with = Force Push (с <0>--force-with-lease</0>) удалит с remote чужие коммиты, которых нет у вас. Защищённые ветки сервер всё равно не даст перезаписать.
confirm = Подтвердить
delete-branch-from-server = Удалить ветку с сервера
deleting-on-server = Удаляем на сервере…
delete-from-server-4 = Удалить с сервера
branch-will-be-deleted-on = Ветка <0>{ $a1 }</0> будет удалена на сервере <2>{ $a3 }</2> (<4>git push { $a5 } --delete { $a6 }</4>).
nobody-working-with-repository-will = Её больше не увидят все, кто работает с репозиторием. Открытые merge request из этой ветки закроются или станут недоступны.
local-branch-stays-with-you = Локальная ветка { $a0 } останется у вас — её можно отправить снова (Push).
you-have-no-local-copy = Локальной копии этой ветки у вас нет.
undo-will-publish-branch-back = Undo ({ $a0 }) опубликует ветку обратно на тот же коммит.
app-is-busy-with-another = Программа занята другой операцией — повторите через секунду
new-tag = Новый тег
create-tag = { $a0 } Создать тег
on-commit = На коммите <0>{ $a1 }</0>
annotated-tag-with-message = { $a0 }Аннотированный тег (с сообщением)
tag-message = Сообщение тега
new-functionality = новая функциональность
fix-before-release = исправление ошибки до релиза
release-preparation = подготовка релиза
urgent-fix-in-production-version = срочное исправление в рабочей версии
support-of-old-version = поддержка старой версии
new-branch-3 = Новая ветка
create-branch-3 = { $a0 } Создать ветку
branch-type-git-flow = Тип ветки (git flow){ $a0 }
prefixes-from-repositorys-git-flow = · приписки из настроек git flow репозитория
by-git-flow-its-created =
    { $a0 }… — { $a1 }
    По git flow создаётся от { $a2 }
no-prefix = без приписки
branch-name = Имя ветки
branch-will-be-created = Будет создана ветка <0>{ $a1 }</0>
from-5 = От { $a0 } <1>{ $a2 }</1>{ $a3 }
branch-8 = ветки
go-back-to-selected-commit = вернуть выбранный коммит
by-git-flow-branches-are = По git flow ветки <0>{ $a1 }</0> создаются от <2>{ $a3 }</2>.{ $a4 }{ $a5 }{ $a6 }
theres-no-such-branch-in = {" "}Такой ветки в репозитории нет — ветка будет создана от выбранного коммита.
create-from = { $a0 } Создать от { $a1 }
switch-to-new-branch = { $a0 }Переключиться на новую ветку
commit-isnt-on-branch = Коммит { $a0 } не на ветке
switch-head-detached = { $a0 } Переключить HEAD (Detached)
create-branch-here-2 = { $a0 } Создать ветку здесь…
theres-no-branch-on-this = На этом коммите нет ни одной ветки. Если переключить HEAD прямо на коммит, вы окажетесь в состоянии <0>detached HEAD</0>: новые коммиты не попадут ни в одну ветку. Удобнее сначала создать здесь ветку.
there-are-several-branches-on = На коммите несколько веток — на какую переключиться?
local-3 = { $a0 }<1>{ $a2 }</1><3>локальная</3>
create-local-and-track = { $a0 }<1>{ $a2 }</1><3>создать локальную и следить</3>
rename-branch = Переименовать ветку { $a0 }
rename-4 = { $a0 } Переименовать
new-branch-name = Новое имя ветки
only-local-branch-changes-git = Меняется только локальная ветка (<0>git branch -m</0>), Undo вернёт прежнее имя.{ $a1 }
branch-on-server-keeps-its = {" "}Ветка на сервере <0>{ $a1 }</0> останется с прежним именем, а локальная продолжит за ней следить.
stash-and-switch = Спрятать и переключиться
changes-go-to-stash-you = Изменения уйдут в stash — достать их можно из списка Stash.
changes-will-be-stashed-as = Изменения спрячутся под именем { $a0 } и сами вернутся, когда вы переключитесь обратно на { $a1 }.
resolve-conflicts-in-files-marked = Сначала решите конфликты в файлах с пометкой U
bring-changes-to = Перенести изменения в { $a0 }
and-in-conflict-is-possible = { $a0 } { $a1 } и в { $a2 } — возможен конфликт. Если он будет, копия изменений останется в Stash.
changes-will-come-with-you = Изменения поедут вместе с вами: в { $a0 } они не пересекаются с чужими правками.
discard-changes-and-switch = Выбросить изменения и переключиться
working-folder-will-be-as = Рабочая папка станет как в коммите ветки. Ctrl+Z вернёт и ветку, и выброшенные изменения.
remember-choice-for-future-switches = Запомнить выбор для следующих переключений. Изменить — в Настройки → Ветки
dont-ask-again = { $a0 }Больше не спрашивать
bring-and-switch = Перенести и переключиться
discard-and-switch = Выбросить и переключиться
has-uncommitted-changes-what-to = В <0>{ $a1 }</0> есть незакоммиченные изменения: { $a2 } { $a3 }{ $a4 }. Что с ними сделать?
new-among-them = , из них новых: { $a0 }
changed-in-too = Изменён и в { $a0 }
also-in = есть и в { $a0 }
and-more-4 = … и ещё { $a0 }
recommended-2 = рекомендуем

## src/components/DiffView.tsx

commit-6 = коммит { $a0 }
new-file = новый файл
ignore-whitespace-changes = Игнорировать изменения пробелов
showing-whole-file-click-to = Показан весь файл. Нажмите, чтобы оставить только места изменений
show-whole-file-not-only = Показать весь файл, а не только места изменений
highlight-what-exactly-changed-within = Подсвечивать, что именно изменилось внутри строки
syntax-highlighting = Подсветка синтаксиса: { $a0 }
syntax-highlighting-file-type-not = Подсветка синтаксиса — тип файла не распознан
search-in-changes-ctrl-f = Поиск в изменениях (Ctrl+F)
editor-has-unsaved-edits-of = В редакторе остались несохранённые правки этого файла — открыть их
edit-file-in-working-folder = Редактировать файл в рабочей папке (Ctrl+S — сохранить)
edit-6 = Редактировать
previous-change-shift-f7 = Предыдущее изменение (Shift+F7)
change-blocks-in-file = Блоков изменений в файле
chg = { $a0 } изм.
next-change-f7 = Следующее изменение (F7)
ln-col = Стр { $a0 }, кол { $a1 }
file-has-both-crlf-and = В файле есть и CRLF, и LF: при сохранении все строки получат { $a0 }
mixed-line-endings = Смешанные окончания строк
changes-view-closed-before-edits = Окно изменений закрылось, пока правки не были сохранены: они возвращены. «Закрыть редактор» без сохранения их отбросит.
edits-restored = Правки восстановлены
not-saved = Не сохранено
back-to-changes-view-esc = Вернуться к просмотру изменений (Esc)
close-editor = Закрыть редактор
previous-file-alt = Предыдущий файл (Alt+↑)
next-file-alt = Следующий файл (Alt+↓)
reload-2 = Перечитать
opening-file = { $a0 } Открываю файл…
loading-diff = { $a0 } Загрузка diff…
binary-file-line-diff-unavailable = { $a0 } Бинарный файл — построчный diff недоступен
file-is-too-large-kb-to = Файл слишком большой ({ $a0 } КБ) для просмотра
only-line-endings-changed-crlf = Изменились только окончания строк (CRLF ↔ LF) — текст файла тот же
file-was-renamed-without-content = Файл переименован без изменения содержимого
whitespace-only-changes = Изменения только в пробелах
no-content-changes = Нет изменений в содержимом
diff-is-too-large-only = Diff слишком большой — показана только часть строк
unsaved-edits = Правки не сохранены
editor-has-unsaved-edits-they = В редакторе есть несохранённые правки. Если закрыть, они пропадут.
whitespace-changed = Изменились пробелы
only-in-changed-lines-and = Только в изменённых строках (+ и −)
of-2 = { $a0 } из { $a1 }{ $a2 }
no-matches = Нет совпадений
previous-shift-enter-shift-f3 = Предыдущее (Shift+Enter, Shift+F3)
next-enter-f3 = Следующее (Enter, F3)

## src/components/FileView.tsx

reading-file-history = { $a0 } Читаем историю файла…
file-has-no-history-yet = У файла ещё нет истории: он не закоммичен{ $a0 }.
in-this-version = {" "}в этой версии
with-renames = с переименованиями
up-to = до { $a0 }
ctrl-click-second-version-to = Ctrl+клик — вторая версия для сравнения
file-created = файл создан
file-deleted = файл удалён
renamed-from = переименован из { $a0 }
copied-from = скопирован из { $a0 }
remove-from-comparison = Убрать из сравнения
compare-this-version-with-selected = Сравнить эту версию с выбранной
version-comparison-b = { $a0 }Сравнение версий: <1>A { $a2 }</1> → <3>B { $a4 }</3><5>({ $a6 } → { $a7 })</5>{ $a8 }
normal-mode = Обычный режим
restore-version-b = Восстановить версию B
restore-file-to-this-version = Восстановить файл к этой версии
file-in-working-folder-will-become-as = Файл { $a0 } в рабочей папке станет таким, как в коммите { $a1 }{ $a2 }. Коммит не создаётся, Undo вернёт.
it-was-called-then = {" "}(тогда он назывался { $a0 })
blame-this-version = Blame этой версии
who-changed-lines-and-when = Кто и когда менял строки — в версии { $a0 }
commit-isnt-in-graphs-loaded = Коммита { $a0 } нет в загруженной истории графа
its-older-than-loaded-commits = Он старше загруженных коммитов или в другой ветке — сделайте Fetch или увеличьте историю
working-folder-with-uncommitted-lines = рабочая папка (с незакоммиченными строками)
version-2 = версия { $a0 }
blame-old-recent = { $a0 }<1>Blame: <2>{ $a3 }</2>{ $a4 }</1>{ $a5 }{ $a6 }{ $a7 }{ $a8 }<9>старые{ $a10 }свежие</9>{ $a11 }{ $a12 }
back-to-previous-blame-esc = Назад к предыдущему blame (Esc)
back = { $a0 } Назад
file-was-called-then = { $a0 } · тогда файл назывался { $a1 }
file-was-called-then-2 = {" "}· тогда файл назывался { $a0 }
depth = · глубина { $a0 }
to-head = к HEAD
with-uncommitted-changes = С незакоммиченными изменениями
working-folder = рабочая папка
heat-map-more-recent-change = Тепловая карта: чем свежее изменение, тем ярче полоса
ignore-whitespace-git-blame-w = Игнорировать пробелы (git blame -w): правки только в отступах не считаются изменением строки
ignore-whitespace = { $a0 } Игнорировать пробелы
computing-line-authorship = { $a0 } Считаем авторство строк…
file-is-empty = Файл пустой
not-committed = Не закоммичено
age = Возраст: { $a0 }
blame-before-this-commit = Blame до этого коммита ({ $a0 })
lines-appeared-together-with-file = Строки появились вместе с файлом — раньше их не было
statistics = { $a0 } статистика…
files-lines-in-blame = <0>файлов: <1>{ $a2 }</1></0><3><4>+{ $a5 }</4> <6>−{ $a7 }</6></3>{ $a8 }<9>строк в blame: { $a10 }</9>
in-this-file = в этом файле: <0>+{ $a1 }</0> <2>−{ $a3 }</2>
blame-before-this-commit-2 = Blame до этого коммита
changes-in-file-history = Изменения в истории файла
file-is-too-large-first = Файл слишком большой — показаны первые { $a0 } строк

## src/components/GraphViewMenu.tsx

commit-table-view = Вид таблицы коммитов
columns = Колонки
message-is-always-visible-and = Сообщение видно всегда и забирает место скрытых колонок
order-drag-column-header = { $a0 }Порядок — перетащите заголовок колонки
row-density = Плотность строк
date-and-time = Дата и время
graph-nodes = Узлы графа
reset-column-widths-and-view = { $a0 }Сбросить ширину и вид колонок

## src/components/Guard.tsx

pre-commit-check-is-off = Проверка перед коммитом выключена
turn-on = включить
configure = настроить
checked-nothing-suspicious = { $a0 }<1>Проверено: ничего подозрительного</1>{ $a2 }
added-lines-were-checked-no = Добавленные строки проверены: забытой отладки и похожих на секреты строк нет
show-what-was-found = Показать, что нашлось
commit-is-forbidden-by-check = Коммит запрещён правилами проверки
in-commit = { $a0 } { $a1 } в коммите
suspicious-spot = подозрительное место
suspicious-spots = подозрительных места
suspicious-spots-2 = подозрительных мест
turn-off-check-for-this = Выключить проверку для этого репозитория
configure-rules = Настроить правила
commit-forbidden = Коммит запрещён
check-before-committing = Проверьте перед коммитом
pre-commit-check = Проверка перед коммитом
added-lines-contain-line-can = { $a0 }В добавленных строках нашлось { $a1 } { $a2 }{ $a3 }. Строку можно пометить комментарием <4>gorynych-ignore</4>, чтобы проверка её пропускала.
rules-with-forbid-level-fix = { $a0 }<1>{ $a2 } { $a3 } правила с уровнем «Запрещать» — исправьте строки или измените уровень правила в настройках.</1>
finding-violates = находка нарушает
findings-violate = находки нарушают
findings-violate-2 = находок нарушают
of-them-look-like-secrets = , из них <0>{ $a1 } похоже на секреты</0> — ключи и токены в истории Git остаются навсегда, даже если потом удалить файл
open-files-changes = Открыть изменения файла
only-first-findings-are-shown = Показаны первые находки — их слишком много
configure-rules-2 = { $a0 } Настроить правила…
go-back-and-fix = Вернуться и исправить
commit-anyway = Всё равно закоммитить
check-before-committing-2 = Проверять перед коммитом
before-each-commit-app-looks = Перед каждым коммитом программа смотрит добавленные строки и предупреждает о забытой отладке и похожих на секреты строках.
hint-while-preparing-commit = Подсказывать, пока готовите коммит
banner-above-commit-button-badges = Плашка над кнопкой Commit, значки у файлов и отметки строк в diff — ещё до нажатия Commit.
check-in-this-repository = Проверять в этом репозитории
for-each-rule-off-dont = Для каждого правила: <0>Выкл</0> — не проверять, <1>Предупреждать</1> — показать и спросить, <2>Запрещать</2> — коммит не создаётся, пока строка не исправлена или не помечена <3>gorynych-ignore</3>.
add-4 = { $a0 } Добавить
for-example-forbid-fit-in = Например, запретить «fit(» в тестах или внутренние адреса серверов. Правило — регулярное выражение.
repositories-without-check = Репозитории без проверки
restore-all-defaults = { $a0 } Вернуть всё по умолчанию
all-4 = { $a0 }<1>все:</1>{ $a2 }
only-in-these-files = Только в этих файлах
dont-check-files = Не проверять файлы
path-patterns-md-by-name = Шаблоны путей: <0>*.md</0> — по имени в любой папке, <1>docs/**</1> — папка целиком, <2>**/*.test.*</2> — тесты где угодно.
for-example-internal-address = Например: внутренний адрес
debug = Отладка
secret-hide-text = Секрет (скрывать текст)
other-2 = Другое
regular-expression = Регулярное выражение
flags = Флаги
error-in-expression = Ошибка в выражении: { $a0 }
only-in-files-comma-separated = Только в файлах (расширения через запятую, пусто — во всех)
test-on-line = Проверить на строке
paste-line-of-code = Вставьте строку кода
will-fire = <0>{ $a1 } сработает:</0>{ $a2 }<3>{ $a4 }</3>{ $a5 }
wont-fire-on-this-line = не сработает на этой строке
save-rule = Сохранить правило

## src/components/GuideDialog.tsx

repositories = Репозитории
clone-2 = Клонировать
create-repository-2 = Создать репозиторий
next-previous-tab = Следующая / предыдущая вкладка
new-tab-open-clone-create = Новая вкладка: открыть, клонировать, создать, недавние
work = Работа
undo-redo-action = Отменить / повторить действие
commit-search-in-open-diff = Поиск коммитов (в открытом diff — поиск в изменениях, в сравнении — по содержимому)
filter-branches-and-tags-on = Фильтр веток и тегов слева
switch-branch-2 = Переключить ветку
commit-in-message-field = Сделать коммит (в поле сообщения)
click-feat-fix-chip = Клик по чипсу feat / fix / …
conventional-commits-prefix-second-click = Префикс Conventional Commits; повторный клик убирает
double-click-commit = Двойной клик по коммиту
switch-to-its-branch-without = Переключиться на его ветку; без ветки — спросит
double-click-branch-label = Двойной клик по метке ветки
switch-to-exactly-that-branch = Переключиться именно на эту ветку
right-click-commit = Правый клик по коммиту
action-menu = Меню действий
ctrl-click-commit = Ctrl+клик по коммиту
compare-with-selected-one = Сравнить с выбранным
drag-commit-or-branch-onto = Перетащить коммит или ветку на ветку
merge-cherry-pick-fast-forward = Merge, cherry-pick, fast-forward или rebase
hover-over-n-next-to = Наведение на «+N» у веток
all-branches-and-tags-of = Все ветки и теги коммита
hover-over-next-to-branch = Наведение на ↓ / ↑ у ветки слева
incoming-outgoing-commits-update-branch = Входящие / исходящие коммиты, обновить ветку
custom-shortcuts = Свои сочетания
running-actions-from-builder-actions = Запуск действий из конструктора (меню Actions)
right-click-file = Правый клик по файлу
restore-file-discard-edits = Вернуть файл / отменить правки
viewing-changes = Просмотр изменений
search-in-files-changes = Поиск в изменениях файла
next-previous-match = Следующее / предыдущее совпадение
search-match-case-regular-expression = Поиск: учитывать регистр / регулярное выражение
next-previous-change = Следующее / предыдущее изменение
previous-next-file = Предыдущий / следующий файл
interactive-rebase = Интерактивный rebase
select-commit-2 = Выбрать коммит
move-commit = Переместить коммит
pick-reword-squash-fixup-drop = Оставить / сообщение / squash / fixup / удалить
conflicts-3 = Конфликты
save-resolution-and-move-on = Сохранить решение и перейти дальше
to-previous-next-conflict = К предыдущему / следующему конфликту
save-ci-file = Сохранить файл CI
comment-out-line = Закомментировать строку
indent = Отступ
window = Окно
settings-and-appearance = Настройки и оформление
developer-tools = Инструменты разработчика
getting-started = Начало работы
open-create-clone-connect-tabs = открыть создать клонировать подключить вкладки репозиторий папка gitlab github
git-gorynych-is-app-for = <0>git-Горыныч</0> — программа для работы с Git-репозиториями: история в виде графа, коммиты, ветки, синхронизация с сервером, безопасная отмена любых действий и работа с CI/CD GitLab.
open-project = Открыть проект
open-repository-ctrl-o-choose = <0>Открыть репозиторий</0> <1>Ctrl+O</1> — выберите папку, где уже есть Git.
clone-ctrl-shift-o-paste = <0>Клонировать</0> <1>Ctrl+Shift+O</1> — вставьте ссылку на репозиторий (GitLab, GitHub и т. п.). Программа сама проверит доступ, покажет ветки и предложит папку.
create-repository-ctrl-n-make = <0>Создать репозиторий</0> <1>Ctrl+N</1> — сделать Git-репозиторий из обычной папки, с первым коммитом и .gitignore.
connect-folder-to-gitlab-github-you = <0>Подключить папку к GitLab / GitHub</0> — у вас есть файлы и пустой (или не пустой) репозиторий на сервере: программа свяжет их и отправит изменения.
all-of-this-is-on = Всё это есть на стартовом экране и в меню <0>File</0>.
tabs = Вкладки
each-repository-opens-in-its = Каждый репозиторий открывается в своей вкладке сверху. <0>Ctrl+Tab</0> — следующая вкладка, <1>Ctrl+W</1> — закрыть. Открытые вкладки запоминаются и восстанавливаются при следующем запуске.
almost-any-action-can-be = Почти любое действие можно отменить: <0>Ctrl+Z</0> или кнопка <1>Отменить</1> на панели сверху. Подробнее — в разделе «Отмена и безопасность».
how-window-is-laid-out = Как устроено окно
interface-panel-graph-left-right = интерфейс панель граф слева справа тулбар статус ветки remote stash теги колонки шапка таблица плотность sha дата узлы точки аватары проводник finder терминал командная строка папка путь
top-toolbar = Панель сверху
on-left-current-repository-and = Слева — текущий <0>репозиторий</0> и <1>ветка</1> (клик по ветке — быстрое переключение, <2>Ctrl+B</2>).
undo-redo-pull-arrow-next = Кнопки <0>Отменить / Повторить</0>, <1>Pull</1> (стрелка рядом — выбор режима), <2>Push</2>, <3>Ветка</3> (новая ветка), <4>Stash / Pop</4>.
on-right-server-access-status = Справа — состояние доступа к серверу, поиск коммитов, обновление и настройки.
each-repository-is-separate-tab = Каждый репозиторий — отдельная вкладка вверху. <0>«+»</0> (или <1>Ctrl+T</1>) открывает <2>Новую вкладку</2>: кнопки «Открыть», «Клонировать», «Создать» и список недавних репозиториев — клик откроет репозиторий прямо в этой вкладке, а если он уже открыт, программа переключится на него. Крестик у строки убирает её из списка (сам репозиторий не трогается).
on-left-branches-and-everything = Слева — ветки и всё остальное
local-your-branches-on-server = Разделы <0>Локальные</0> (ваши ветки), <1>На сервере</1> (remote-ветки), <2>Stash</2>, <3>Теги</3> и <4>CI/CD</4>. Двойной клик по ветке — переключиться на неё; по remote-ветке — создать локальную копию и переключиться. Правый клик — все действия с веткой. Поле фильтра сверху (<5>Ctrl+Alt+F</5>) ищет по названиям.
in-center-commit-graph = В центре — граф коммитов
each-row-is-commit-branches = Каждая строка — коммит: ветки и теги слева, линии графа, сообщение, автор, дата. Самая верхняя строка <0>// WIP</0> — ваши незакоммиченные изменения. Клик — показать коммит справа, двойной клик — переключиться на его ветку, правый клик — меню действий. Строку коммита или метку ветки можно перетащить на другую ветку — см. раздел «Перетаскивание».
commit-table-settings = Настройка таблицы коммитов
right-click-table-header-or = <0>Правый клик по шапке</0> таблицы или значок в её правом углу — меню вида: какие колонки показывать (в том числе <1>SHA</1> — короткий хэш, клик копирует полный), плотность строк (<2>компактная 26px</2>, <3>стандартная 34px</3>, <4>свободная 42px</4>), дата <5>абсолютная</5> или <6>относительная</6> («15 мин назад», точная — в подсказке), узлы графа — <7>аватары</7> или <8>точки</8>.
columns-are-reordered-by-dragging = Колонки меняются местами <0>перетаскиванием заголовка</0>. «Сообщение коммита» видно всегда и забирает место скрытых колонок.
columns-width-is-dragged-by = Ширину колонки тянут за разделитель в шапке; <0>двойной клик по разделителю</0> подгоняет ширину под содержимое (у графа — авто). «Сбросить ширину и вид колонок» в том же меню возвращает всё как было.
conventional-commits-prefixes-feat-fix = Префиксы Conventional Commits (<0>feat:</0>, <1>fix:</1>, <2>docs:</2>…) показываются цветным бейджем. Если сообщение не влезло — наведите курсор: всплывёт полный заголовок с описанием.
on-right-details = Справа — детали
for-commit-message-author-parents = Для коммита — сообщение, автор, родители и список изменённых файлов (клик по файлу открывает diff). Для строки WIP — списки «Неиндексированные файлы» / «Индексированные файлы» и форма коммита.
at-bottom-status-bar = Снизу — строка состояния
current-branch-and-how-far = Текущая ветка и насколько она впереди/позади сервера, HEAD, переключатель <0>авто</0> (фоновая проверка сервера; правый клик — настройки) и кнопка fetch. Справа — путь к репозиторию: клик открывает папку в { $a1 }, кнопки рядом — папку и терминал (командную строку) прямо в этой папке. То же — в меню «Файл» и по правому клику на названии репозитория.
panel-borders-can-be-dragged = Границы панелей можно перетаскивать мышью; двойной клик по границе возвращает исходную ширину.
changes-and-commits = Изменения и коммиты
stage-unstage-commit-wip-hunk = stage unstage коммит commit wip фрагмент hunk сообщение статистика строки переименование перенос moved
select-wip-row-in-graph = Выберите строку <0>// WIP</0> в графе — справа появятся изменённые файлы.
click-file-to-see-changes = Нажмите на файл, чтобы посмотреть изменения. Добавьте нужное в коммит: кнопка <0>+</0> у файла, двойной клик по файлу или <1>Добавить все</1>.
you-can-add-only-part = Можно добавить <0>только часть файла</0>: в diff у каждого фрагмента есть кнопка <1>В индекс</1>.
write-commit-title-and-description = Напишите заголовок коммита (и при желании описание) и нажмите <0>Закоммитить</0> или <1>Ctrl+Enter</1>. Тип коммита, номер задачи и шаблоны описания — раздел «Сообщение коммита».
on-right-of-each-file = Справа у каждого файла — сколько строк добавлено и удалено (<0>+12</0> <1>-3</1>), у бинарных — <2>bin</2>. Перенесённый или переименованный файл помечен <3>R</3> и показан как «старый путь → новый»; если содержимое не менялось, рядом метка <4>moved</4>. Если убрать такой файл из индекса, уйдут оба пути сразу.
made-mistake-ctrl-z-undoes = Ошиблись — <0>Ctrl+Z</0> отменит коммит, изменения снова окажутся в индексированных файлах. Если коммит уже отправлен на сервер, Undo его не тронет (иначе переписалась бы общая история) — используйте <1>Обратить изменения коммита (Revert)</1> из меню коммита.
commit-message-2 = Сообщение коммита
conventional-commits-feat-fix-refactor = conventional commits feat fix refactor chore docs style test perf scope префикс тип номер задачи тикет jira issue ветка шаблон template commit.template gitmessage описание refs breaking
commit-type-in-one-click = Тип коммита одним кликом
above-commit-title-there-are = Над заголовком коммита — чипсы <0>feat</0>, <1>fix</1>, <2>refactor</2>, <3>chore</3>, <4>docs</4>, <5>style</5>, <6>test</6>, <7>perf</7> (формат Conventional Commits). Клик ставит префикс <8>feat: </8> в начало сообщения, клик по другому чипсу меняет тип, повторный клик убирает. Если ввести префикс руками, нужный чипс подсветится сам.
scope-area-of-changes-feat-api = <0>(scope)</0> — область изменений: <1>feat(api): …</1>. Можно ввести свой или выбрать из подсказок — это папки, в которых лежат staged-файлы.
breaking-change-feat = <0>!</0> — несовместимое изменение: <1>feat!: …</1>.
on-right-of-field-title = Справа в поле — длина заголовка: жёлтая после 50 символов, красная после 72.
if-branch-is-named-for = Если ветка называется, например, <0>feature/PROJ-123-login</0>, <1>bugfix/1234-fix</1> или <2>issue-42</2>, рядом с чипсами появляется кнопка { $a3 } <4>+ [PROJ-123]</4> (или <5>#1234</5>). Клик добавляет номер в сообщение, ещё клик — убирает. По умолчанию номер добавляется сам в каждое новое сообщение.
arrow-next-to-button-where = Стрелка рядом с кнопкой — куда ставить номер:
proj-123-feat-at-start = <0>[PROJ-123] feat: …</0> — в начало (по умолчанию);
feat-proj-123-instead-of = <0>feat(PROJ-123): …</0> — вместо scope (пока тип не выбран — в скобках в начале);
feat-proj-123-at-end = <0>feat: … (PROJ-123)</0> — в конец;
refs-proj-123-on-separate = <0>Refs: PROJ-123</0> — отдельной строкой в конце описания.
theres-also-add-issue-number = Там же — переключатель <0>Автоматически добавлять номер задачи</0>. Если номера в ваших ветках устроены иначе, задайте своё правило (регулярное выражение) в <1>Настройки → Сообщение коммита</1> и проверьте его на имени ветки прямо там.
templates-button-above-commit-form = Кнопка { $a0 } <1>Шаблоны</1> над формой коммита — готовые заготовки для описания: «Что сделано / Как проверить», «Исправление ошибки», «Несовместимое изменение». Клик вставляет шаблон, курсор встаёт туда, где начинать писать; <2>{"{"}ticket{"}"}</2> и <3>{"{"}branch{"}"}</3> заменяются на номер задачи и имя ветки.
save-current-description-as-template-2 = <0>Сохранить текущее описание как шаблон</0> — превращает то, что вы написали, в шаблон (номер задачи сам станет <1>{"{"}ticket{"}"}</1>).
edit-or-delete-template-buttons = Изменить или удалить шаблон — кнопки при наведении. Полный список — в настройках.
if-repository-has-git-config = Если в репозитории задан <0>git config commit.template</0>, его текст сам заполняет описание, а строки с <1>#</1> показываются подсказкой в пустом поле — как в обычном <2>git commit</2>.
typed-message-isnt-lost-if = Набранное сообщение не теряется, если посмотреть другой коммит и вернуться к строке WIP. После коммита форма снова заполняется номером задачи и шаблоном.
branches-2 = Ветки
branch-git-flow-gitflow-feature = ветка branch git flow gitflow feature bugfix release hotfix support приписка префикс checkout merge слить удалить переключить создать detached тег tag сервер remote origin облако ноутбук +N удалить с сервера push --delete входящие исходящие ahead behind gone update обновить без переключения stash спрятать перенести выбросить изменения wip незакоммиченные
create-and-switch = Создать и переключить
branch-on-toolbar-new-branch = <0>Ветка</0> на панели — новая ветка от текущего коммита (или от выбранного в графе).
right-click-commit-create-branch = Правый клик по коммиту → <0>Создать ветку здесь…</0> — ветка от любого коммита.
in-new-branch-window-you = В окне новой ветки выбирается <0>тип по git flow</0>: <1>feature/</1>, <2>bugfix/</2>, <3>release/</3>, <4>hotfix/</4>, <5>support/</5> или без приписки — приписка подставится сама, вводится только остальное имя. Программа подскажет, от какой ветки по git flow создаётся такой тип (feature — от develop, hotfix — от main), и предложит <6>Создать от develop</6>. Если в репозитории выполнен <7>git flow init</7>, приписки берутся из его настроек. Последний выбранный тип запоминается.
to-switch-double-click-branch = Переключиться: двойной клик по ветке слева или по её метке в графе, клик по названию ветки вверху или <0>Ctrl+B</0>.
double-clicking-commit-works-as = <0>Двойной клик по коммиту</0> работает как в GitKraken: на коммите одна ваша ветка — переключает на неё; только ветка сервера — создаёт локальную, которая за ней следит; веток несколько — спросит, на какую. Если веток нет, программа предложит <1>Создать ветку здесь</1> или осознанно перейти в <2>detached HEAD</2> — случайно туда больше не попасть.
merge-and-delete = Слить и удалить
right-click-branch-label-in = <0>Правый клик по метке ветки</0> (в графе или в списке слева) — меню только этой ветки: переключиться, <1>Влить … в …</1>(Merge), <2>Перебазировать … на …</2> (Rebase, с предпросмотром), <3>Сбросить … к …</3> (Reset), <4>Переименовать…</4>,<5>Удалить ветку…</5> и <6>Удалить … с сервера…</6>. Ветка и её копия на сервере на одном коммите — одно меню, без дублей. Удалённую или переименованную ветку возвращает <7>Ctrl+Z</7>.
right-click-commit-row-commit = Правый клик по строке коммита — меню коммита; ветки на нём собраны в подменю <0>Ветка … ›</0>. Английский термин Git (Merge, Rebase, Cherry-pick…) стоит справа в строке меню. Клик по хэшу в шапке меню копирует его.
faster-with-mouse-drag-branch = Быстрее — мышью: перетащите ветку или коммит на ветку, в которую нужно слить (раздел «Перетаскивание»). Переключаться заранее не нужно.
where-branch-is-on-your = Где ветка: у вас или на сервере
branch-is-only-on-your = { $a0 } — ветка только у вас (на сервер не отправлена).
branch-on-server-origin-in = { $a0 } — ветка на сервере (origin/…); в графе такие метки нарисованы пунктирной рамкой.
local-and-server-branches-are = <0>{ $a1 }{ $a2 }</0> — локальная и серверная ветки на одном коммите, то есть синхронизированы.
if-commit-has-several-branches = Если на коммите несколько веток и тегов, в графе видна первая и бейдж <0>+N</0>. Наведите на него — откроется список всех веток и тегов этого коммита с пометками «у вас / на сервере». В списке: двойной клик — checkout, правый клик — меню ветки, кнопки при наведении — checkout и удаление с сервера.
incoming-and-outgoing-commits = Входящие и исходящие коммиты
each-local-branch-in-local = У каждой локальной ветки в разделе Local видно, чем она отличается от своей ветки на сервере:
n-3-server-has-3 = <0>↓3</0> — на сервере 3 новых коммита, они придут при Pull;
n-2-2-of-your = <0>↑2</0> — 2 ваших коммита ещё не отправлены (уйдут при Push);
gone-branch-on-server-was = <0>gone</0> — ветку на сервере удалили.
hover-over-or-list-of = Наведите на ↓ или ↑ — откроется список этих коммитов (клик по коммиту показывает его в графе). Чтобы забрать новые коммиты, нажмите <0>Обновить (Pull)</0> в этом списке, кнопку со стрелкой при наведении на ветку или пункт в правом клике. Если ветка не текущая и своих коммитов в ней нет, она обновляется <1>без переключения</1> — рабочая папка не трогается. <2>Ctrl+Z</2> вернёт ветку туда, где она была.
delete-branch-on-server = Удалить ветку на сервере
right-click-remote-branch-on = Правый клик по remote-ветке (слева, в графе или в списке «+N») → <0>Удалить … с сервера…</0>, или кнопка с перечёркнутым облаком при наведении на ветку в разделе Remote. Программа спросит подтверждение: ветка пропадёт для всех, кто работает с репозиторием. Пока идёт запрос к серверу, на кнопке крутится индикатор. Локальная ветка остаётся, а <1>Ctrl+Z</1> опубликует удалённую ветку обратно на тот же коммит. Защищённую или основную ветку сервер не даст удалить — программа объяснит, что сделать.
branch-folders = Папки веток
branches-with-in-name-are = Ветки с «/» в имени собираются в папки: feature/create-task и feature/docker — в папке <0>feature</0>. Папки сворачиваются кликом, состояние запоминается. Кнопка справа в поле фильтра переключает вид «папками / списком».
switching-with-uncommitted-changes = Переключение с незакоммиченными изменениями
if-working-folder-has-edits = Если в рабочей папке есть правки, при переключении ветки откроется окно с выбором. В нём видно, какие файлы изменены, и какие из них изменены и в целевой ветке (там возможен конфликт).
stash-and-switch-stash-edits = <0>Спрятать и переключиться</0> (Stash) — правки прячутся в stash с именем текущей ветки и сами возвращаются, когда вы переключитесь обратно, вместе со staged. Ветка, у которой ждут спрятанные правки, помечена значком коробки.
move-changes-edits-go-with = <0>Перенести изменения</0> (Move changes) — правки едут с вами в новую ветку. Если они пересекутся с правками ветки, будет конфликт, а копия останется в Stash.
discard-changes-discard-folder-becomes = <0>Выбросить изменения</0> (Discard) — папка станет как в коммите ветки; <1>Ctrl+Z</1> вернёт и ветку, и правки.
app-suggests-whats-better-move = Программа подсказывает, что лучше: перенести, если пересечений нет, или спрятать, если есть. «Больше не спрашивать» запоминает выбор; поменять — в <0>Настройки → Ветки</0>. Remote-ветка при переключении становится локальной веткой с тем же именем, которая следит за сервером. После переключения граф плавно прокручивается к новому HEAD. <1>Ctrl+Z</1> переключает обратно.
if-you-switch-to-commit = Если переключиться на коммит, а не на ветку, программа предупредит в строке состояния: новые коммиты не попадут ни в одну ветку. Вернуться — <0>Ctrl+Z</0> или двойной клик по нужной ветке.
tags-2 = Теги
right-click-commit-create-tag = Правый клик по коммиту → <0>Создать тег здесь…</0>. Можно добавить описание — тогда будет аннотированный тег.
drag-and-drop = Перетаскивание
drag-drop-mouse-merge-cherry = перетащить перетаскивание drag drop бросить мышью слить merge cherry-pick fast-forward перемотать rebase ветка коммит
you-can-merge-branch-or = Слить ветку или перенести коммит можно мышью — без переключения веток и меню.
take-commit-row-in-graph = Возьмите <0>строку коммита</0> в графе, <1>метку ветки</1> в графе или <2>ветку в панели слева</2> (локальную или remote).
drag-it-onto-branch-you = Перетащите на <0>ветку</0>, куда нужно влить изменения: на ветку слева или на строку графа, где стоит эта ветка. Цель подсвечивается зелёной рамкой.
release-it-menu-with-suitable = Отпустите — появится меню с подходящими вариантами.
whats-offered = Что предлагается
fast-forward-if-target-branch = <0>Перемотать вперёд (Fast-forward)</0> — если в целевой ветке нет своих новых коммитов. Ветка просто передвигается, без merge-коммита и без переключения.
merge-into-merge-regular-merge = <0>Влить в … (Merge)</0> — обычное слияние.
cherry-pick-commit-into-cherry = <0>Перенести коммит в … (Cherry-pick)</0> — только для коммита: перенести один этот коммит.
rebase-onto-opens-interactive-rebase = <0>Rebase … на …</0> — откроется интерактивный rebase с предпросмотром.
if-target-branch-isnt-current = Если целевая ветка не текущая, программа сначала переключится на неё (с пометкой «с переключением»). При включённом умном переключении ваши незакоммиченные правки сами спрячутся и вернутся, когда вы придёте обратно. Если коммит уже есть в ветке, меню так и скажет: сливать нечего.
everything-is-undone-with-ctrl = Всё отменяется <0>Ctrl+Z</0>: сначала merge или cherry-pick, следующим нажатием — переключение ветки. При конфликте появится обычная жёлтая панель — раздел «Конфликты».
syncing-with-server = Синхронизация с сервером
repository-sign-in-self-managed = авторизация репозитория self-managed свой сервер домен gitlab github enterprise gitea bitbucket тип сервера вход pull push fetch сервер remote force upstream автообновление доступ логин пароль авто проверка реалтайм интервал ls-remote etag нет связи авторизация вход токен ssh ключ passphrase credential
fetch-find-out-whats-new = <0>Fetch</0> — узнать, что нового на сервере, ничего не меняя у вас. При включённом <1>авто</1> программа делает это сама (см. ниже).
pull-bring-changes-into-current = <0>Pull</0> — забрать изменения в текущую ветку. Стрелка рядом выбирает режим: обычный (fast-forward, если возможно), только fast-forward или rebase.
push-send-your-commits-for = <0>Push</0> — отправить ваши коммиты. Для новой ветки upstream настроится автоматически.
if-server-rejected-push-because = Если сервер отклонил push, потому что там появились чужие коммиты, программа предложит сначала сделать Pull (rebase) и отправить снова. <0>Force Push</0> нужен только после переписывания истории (rebase уже отправленных коммитов) — он заменяет ветку на сервере.
if-theres-no-access-app = Если нет доступа, программа объяснит причину (неверный логин, нет прав, неизвестный ключ SSH и т. п.) и что сделать.
if-server-refused-on-fetch = Если сервер не пустил при Fetch, Pull, Push или клонировании, сразу откроется окно <0>Авторизация репозитория</0>. Вход сохраняется <1>для этого репозитория</1>, а не для всего сервера: у разных репозиториев одного GitLab могут быть разные учётные записи. Способы входа: <2>логин и пароль</2>, <3>токен доступа</3> (glpat-… / ghp_…; логин можно не указывать) или <4>SSH-ключ</4> из ~/.ssh — с паролем ключа, если он есть.
at-top-of-window-where = Вверху окна — <0>где хранится репозиторий</0>: <1>GitHub</1>, <2>GitLab</2> или <3>Свой сервер</3> (Self-Managed — GitLab, GitHub Enterprise, Gitea/Forgejo или Bitbucket компании). Для своего сервера укажите домен (можно с портом), а тип программа спросит у сервера по API; если он не ответил (VPN, внутренняя сеть) — выберите тип вручную. Способы входа видны сразу, ещё до ввода домена. Выбор сервера меняет <4>адрес репозитория</4> (тот же путь проекта на другом сервере) — его можно поправить и целиком; при сохранении remote origin сменится, а у репозитория без remote — будет добавлен. При клонировании адрес задан в окне клонирования и здесь не меняется.
no-key-on-ssh-key = Нет ключа — на вкладке «SSH-ключ» выберите <0>Создать новый ключ</0>: тип (Ed25519 или RSA 4096 для старых серверов), имя файла, комментарий (подставится ваш email из Git) и, по желанию, пароль ключа с повтором. Существующие ключи не перезаписываются. Публичная часть сразу копируется в буфер, кнопка <1>Открыть SSH Keys</1> ведёт на нужную страницу сервера — вставьте ключ туда. Если адрес начинается с https://, там же есть кнопка <2>Перевести адрес на SSH</2> (git@сервер:группа/проект.git) — ключ работает только с SSH-адресами.
sign-in-and-retry-saves = «Войти и повторить» сохраняет данные и сразу повторяет прерванную операцию. Данные шифруются средствами системы; Git получает их напрямую, без окон входа. Все сохранённые входы — <0>Настройки → Подключения</0>: серверы и привязанные к ним репозитории, у каждого — способ входа; там же изменить, забыть или авторизовать открытый репозиторий. Вход, сохранённый раньше на весь сервер, показан как <1>общий</1> и действует для репозиториев без своего. Если ничего не вводить, работает как раньше — через Git Credential Manager.
background-server-check = Фоновая проверка сервера
while-auto-is-on-app = Пока включено <0>авто</0>, программа сама замечает новые коммиты и ветки на сервере — по умолчанию каждые 5 секунд. Сначала она спрашивает у сервера только хэши веток (для GitLab с сохранённым токеном — через API с ETag, иначе — <1>git ls-remote</1>), и только если что-то изменилось, делает настоящий <2>fetch --prune</2>. Поэтому частая проверка не нагружает сервер и не упирается в лимиты.
only-open-tab-is-checked = Проверяется только открытая вкладка. Окно свёрнуто или в фоне — раз в 90 секунд; вернулись в окно — проверка сразу.
while-you-commit-checkout-rebase = Пока вы делаете коммит, checkout, rebase и т. п. (или git работает в терминале), проверка пропускается — она никогда не мешает вашим командам.
no-connection-no-connection-appears = Нет связи — в строке состояния появляется «нет связи», без всплывающих окон; паузы между попытками растут: 15 с → 30 с → 1 мин → 5 мин.
frequency-settings-sync-or-right = Частота — <0>Настройки → Синхронизация</0> (или правый клик по «авто»): Реалтайм (5 с), Быстро (15 с), Стандартно (30 с), Редко (5 мин).
app-sees-fetch-or-pull = Fetch или pull во внешнем терминале программа видит сразу — по изменениям в папке .git.
guard-pre-commit-console-log = guard pre-commit console.log debugger print todo секрет токен ключ пароль aws bearer правило уровень запрещать предупреждать исключения шаблоны gorynych-ignore репозиторий выключить webstorm vs code откат индекс staged синхронизация
before-each-commit-app-scans = Перед каждым коммитом программа за доли секунды просматривает <0>добавленные строки</0> того, что войдёт в коммит, и предупреждает (или, если так настроено, не даёт закоммитить), если видит:
forgotten-debug-code-console-log = забытую отладку: console.log, debugger, print(), breakpoint(), var_dump, .only в тестах, «TODO: remove», маркеры конфликта;
things-that-look-like-secrets = похожее на секреты: ключи sk-…, токены GitHub/GitLab/Slack, Bearer, AWS_…, JWT, приватные ключи, пароли в коде.
while-you-prepare-commit-banner = Пока вы готовите коммит, над кнопкой <0>Закоммитить</0> видна плашка: «Проверено: ничего подозрительного» или что нашлось. У файлов — значок, в diff строка отмечена полосой слева. При нажатии <1>Закоммитить</1> откроется список находок: <2>Вернуться и исправить</2> или <3>Всё равно закоммитить</3>. Секреты в списке показываются замаскированными.
everything-is-configurable = Всё настраивается
settings-pre-commit-check-or = <0>Настройки → Проверка перед коммитом</0> (или кнопка-шестерёнка на плашке):
check-before-committing-main-switch = <0>Проверять перед коммитом</0> — главный выключатель. <1>Подсказывать, пока готовите коммит</1> — плашка, значки и отметки в diff до нажатия «Закоммитить»; если выключить, проверка сработает только при коммите.
for-this-repository-turn-off = <0>Для этого репозитория</0> — выключить проверку только здесь. То же делает кнопка со щитом на плашке; включить обратно — «включить» на плашке. Список таких репозиториев — внизу настроек.
each-rule-has-three-levels = У каждого правила три уровня: <0>Выкл</0>, <1>Предупреждать</1> (спросить, коммитить ли всё равно) и <2>Запрещать</2> — коммит не создаётся, пока строка не исправлена. Переключатель «все:» меняет уровень сразу у всей группы.
your-own-rules-regular-expression = <0>Свои правила</0> — регулярное выражение, расширения файлов, тип. Правило можно сразу проверить на строке кода.
dont-check-files-path-patterns = <0>Не проверять файлы</0> — шаблоны путей: <1>*.md</1> — по имени в любой папке, <2>docs/**</2> — папка целиком, <3>**/*.test.*</3> — тесты где угодно. Частые варианты добавляются одним кликом.
check-skips-single-line-if = Отдельную строку проверка пропустит, если в ней есть комментарий <0>gorynych-ignore</0> — так можно оставить нужный console.log или тестовый ключ, даже когда правило запрещает коммит. Кнопка «Вернуть всё по умолчанию» сбрасывает настройки.
if-you-edit-files-in = Если правите файлы в другой программе
you-staged-file-and-then = Застейдили файл, а потом откатили его в WebStorm или VS Code к последнему коммиту — программа заметит это и уберёт изменение целиком: без «призрака» в «Индексированных файлах» и без устаревшего предупреждения. Поправили снаружи файл, застейдженный целиком, — в индекс попадёт новая версия. Проверка перед коммитом перезапускается при каждом изменении файлов на диске. Частично застейдженные файлы не трогаются; выключить — Настройки → Синхронизация.
key-that-once-got-into = Ключ, однажды попавший в историю Git, остаётся там навсегда — даже если потом удалить файл. Такой ключ нужно отозвать.
action-builder-3 = Конструктор действий
action-button-hotkey-shortcut-chain = действие action кнопка горячая клавиша цепочка шаблон merge request pr автоматизация
builds-chain-of-commands-for = Собирает цепочку команд — например, «создать ветку от main, rebase, push, merge request» — и запускает её одной кнопкой на панели или сочетанием клавиш.
actions-action-builder-menu = Меню <0>Actions → Конструктор действий…</0>
take-ready-made-template-on = Возьмите готовый шаблон слева («Новая задача → MR», «Обновить ветку из основной», «Закончить задачу», «Подтянуть основную ветку») или создайте пустое действие.
add-steps-with-add-step = Добавляйте шаги кнопкой <0>Добавить шаг</0>: ветки (создать, переключить, rebase, merge, удалить), сервер (fetch, pull, push), изменения (stash, pop, коммит), merge request, вопрос «продолжить?», своя git-команда. Порядок меняется перетаскиванием номера шага.
assign-keyboard-shortcut-for-example = Назначьте <0>горячую клавишу</0> (например <1>Ctrl+Alt+1</1>) и/или включите <2>кнопку на панели сверху</2>.
default-main-branch-main-master = <0>{"{"}default{"}"}</0> — основная ветка (main / master), <1>{"{"}branch{"}"}</1> — текущая, <2>{"{"}start{"}"}</2> — с которой запустили, <3>{"{"}date{"}"}</3> — дата.
input-task-name-ask-at = <0>{"{"}input:Название задачи{"}"}</0> — спросить при запуске; <1>{"{"}input:Название задачи|slug{"}"}</1> — сразу сделать из ответа имя ветки: «Новая форма входа» → novaya-forma-vhoda.
running-2 = Запуск
bottom-right-shows-which-step = Справа внизу видно, какой шаг выполняется. Ошибка останавливает цепочку и объясняет причину — исправьте (например, решите конфликт) и нажмите <0>Повторить с шага N</0>. Каждый шаг можно отменить <1>Ctrl+Z</1>, как обычное действие.
merge-request-is-created-via = Merge request создаётся через API GitLab (нужен токен со scope api). Для GitHub откроется страница создания pull request.
diff-split-unified-whitespace-syntax = diff split unified пробелы подсветка синтаксиса язык поиск найти ctrl+f регистр регулярное f3 f7 файл изменения
clicking-file-in-right-panel = Клик по файлу в правой панели открывает его изменения в центре.
toggles-at-top-unified-one = Переключатели сверху: <0>Unified</0> (одной колонкой) / <1>Split</1> (было | стало), игнорировать пробелы, подсветка того, что именно изменилось внутри строки.
f7-shift-f7-to-next = <0>F7</0> / <1>Shift+F7</1> — к следующему / предыдущему изменению, <2>Alt+↑</2> / <3>Alt+↓</3> — к соседнему файлу, <4>Esc</4> — закрыть.
syntax-highlighting-language-is-detected = <0>Подсветка синтаксиса</0> — язык определяется по расширению или имени файла (JavaScript/TypeScript, Python, Java, C/C++, C#, Go, Rust, PHP, HTML/Vue, CSS, SQL, YAML, Dockerfile и ещё около 40). Работает и в диффах, и в редакторе конфликтов; выключается кнопкой <1></></1>. Очень большие диффы показываются без подсветки — чтобы не тормозить.
search-in-changes-ctrl-f-or = <0>Поиск в изменениях</0> — <1>Ctrl+F</1> или лупа: все совпадения подсвечиваются, текущее — оранжевым, справа «3 из 17». <2>Enter</2> / <3>Shift+Enter</3> (или <4>F3</4>) — к следующему / предыдущему. Рядом с полем — учитывать регистр (<5>Alt+C</5>), регулярное выражение (<6>Alt+R</6>) и «только в изменённых строках» (без контекста). Строка поиска остаётся при переходе к соседнему файлу; <7>Esc</7> сначала закрывает поиск, второй — diff.
each-hunk-has-action-buttons = У каждого фрагмента есть кнопки действий: для незакоммиченных — <0>В индекс</0> и <1>Отменить</1>, для индексированных — <2>Из индекса</2>, для коммита — <3>Отменить в рабочей папке</3>. Когда включено «игнорировать пробелы», кнопки скрываются: фрагменты считаются по точному тексту.
undo-and-safety = Отмена и безопасность
undo-redo-revert-rollback-file = undo redo отменить вернуть откат файл фрагмент reset revert вернуть проект к коммиту
ctrl-z-ctrl-y-undo = <0>Ctrl+Z</0> / <1>Ctrl+Y</1> отменяют и повторяют: коммит, checkout, создание и удаление веток (в том числе на сервере) и тегов, merge, fast-forward, rebase, cherry-pick, revert, reset, stash, восстановление файлов из stash, откат файлов и фрагментов. Если после действия что-то поменялось снаружи, программа не будет ничего затирать, а объяснит, почему отменить нельзя.
restore-file-or-part-of = Вернуть файл или его часть — без коммита
right-click-file-in-commits = Правый клик по файлу в списке файлов коммита:
restore-file-to-its-version-in = <0>Вернуть файл к версии из этого коммита</0> — файл в рабочей папке станет как в коммите.
restore-file-to-its-version-before-this = <0>Вернуть файл к версии до этого коммита</0> — как было до него (если файла тогда не было — он удалится).
revert-this-commits-changes-in-file = <0>Отменить изменения этого коммита в файле</0> — убрать только то, что сделал этот коммит; более поздние правки останутся.
same-for-single-hunk-revert = То же для отдельного фрагмента — кнопка <0>Отменить в рабочей папке</0> в diff коммита. Меняется только рабочая папка: проверьте результат и закоммитьте, когда будете готовы. Для незакоммиченных правок: правый клик по файлу → <1>Отменить изменения в файле</1>.
whole-project = Весь проект
restore-files-from-commit-commit = <0>Восстановить файлы из коммита…</0> (меню коммита или значок в шапке панели коммита справа) — новый коммит, в котором все файлы как в выбранном. История не переписывается, ветка не переключается — безопасно даже для отправленных веток.
revert-commit-changes-revert-new = <0>Обратить изменения коммита</0> (Revert) — новый коммит, отменяющий один конкретный коммит.
reset-to-this-commit-reset = <0>Сбросить … к этому коммиту</0> (Reset) — переносит ветку назад: мягко (Soft), смешанно (Mixed) или жёстко (Hard). Hard удаляет незакоммиченные правки — программа спросит подтверждение.
rebase-squash-fixup-reword-drop = rebase squash fixup reword drop порядок история сообщение объединить удалить коммит предпросмотр
lets-you-tidy-up-branchs = Позволяет навести порядок в истории ветки: поменять порядок коммитов, исправить сообщения, объединить или удалить коммиты.
right-click-branch-commit-interactive = Правый клик по коммиту ветки → <0>Интерактивный rebase …</0> → «Коммиты после …» или «Начиная с … (включительно)». Чтобы перенести ветку на другую — правый клик по той ветке → <1>Rebase … onto …</1>.
on-left-plan-new-commits = Слева — план (новые коммиты сверху). Перетаскивайте коммиты мышью или <0>Alt+↑</0>/<1>Alt+↓</1>. Для каждого выберите действие: <2>P</2> оставить, <3>R</3> изменить сообщение, <4>S</4> объединить с коммитом ниже, <5>F</5> влить в коммит ниже без его сообщения, <6>D</6> удалить.
on-right-you-see-preview = Справа сразу виден <0>предпросмотр</0>: граф «Сейчас → После», какие файлы ветки изменятся, будут ли конфликты, нужен ли будет Force Push.
click-apply-rebase-branch-will = Нажмите <0>Применить rebase</0>. Ветка перейдёт ровно на то, что было в предпросмотре. <1>Ctrl+Z</1> вернёт всё как было.
until-you-click-apply-nothing = Пока вы не нажали «Применить», ничего не меняется: ни ветка, ни файлы.
if-preview-shows-conflict-change = Если предпросмотр показывает конфликт — поменяйте план или нажмите <0>Начать и решить конфликты вручную</0>: rebase остановится на конфликте, вы решите его (раздел «Конфликты») и нажмёте <1>Продолжить</1> в жёлтой панели. <2>Прервать</2> вернёт всё как было.
preview-needs-git-2-40 = Для предпросмотра нужен Git 2.40 или новее. Если Git старее, программа об этом скажет.
comparing-commits = Сравнение коммитов
compare-comparison-diff-two-commits = сравнить сравнение diff двух коммитов ветки разница поиск содержимое найти текст
shows-how-any-two-commits = Показывает, чем отличаются любые два коммита (или ветки — выберите коммиты, на которых они стоят).
select-commit-and-second-one = Выберите коммит и <0>{ $a1 }</0> по второму.
or-right-click-compare-with = Или правый клик → <0>Сравнить с HEAD</0>.
or-right-click-mark-for = Или правый клик → <0>Отметить для сравнения</0> (у коммита появится метка «A»), затем на другом коммите → <1>Сравнить с отмеченным</1>.
at-top-summary-how-many = Вверху — сводка: сколько файлов и строк изменено и сколько коммитов между ними (клик — список коммитов). Ниже — где больше всего изменений по папкам (клик по папке фильтрует таблицу) и таблица файлов с полосками объёма. Клик по файлу — его diff, <0>Esc</0> — назад к сравнению. Кнопка ⇄ меняет «было» и «стало» местами.
content-search-path-content-switch = <0>Поиск по содержимому</0> — переключатель <1>Путь / Содержимое</1> над таблицей или <2>Ctrl+F</2>: текст ищется в добавленных и удалённых строках всех файлов сравнения (с учётом регистра или без, можно регулярным выражением). Видно, в каких файлах и сколько совпадений, и сами строки. Клик по строке открывает diff файла сразу на этом совпадении, с той же строкой поиска; <3>Alt+↓</3> переходит к следующему файлу с совпадениями.
file-history-and-blame = История файла и Blame
file-history-log-blame-authorship = история файла log blame авторство кто изменил строку автор переименование follow восстановить версию пробелы
for-any-file-in-commit = Для любого файла — в коммите, в stash, в незакоммиченных изменениях (WIP), в списке и в дереве файлов, в сравнении коммитов — правый клик → <0>История файла (Log)</0> или <1>Blame</1>. Те же кнопки есть в шапке открытого diff файла.
file-history-all-commits-that = <0>История файла</0> — все коммиты, которые меняли файл, и под прежними именами тоже (git log --follow): хэш, автор, дата, сообщение и <1>+X −Y</1>. Клик по коммиту — справа diff файла в этом коммите, <2>Alt+↑</2>/<3>Alt+↓</3> — соседние коммиты.
compare-two-versions-second-commit = <0>Сравнить две версии</0>: { $a1 } по второму коммиту (или кнопка сравнения при наведении) — справа разница между ними, даже если файл тогда назывался иначе.
restore-file-to-this-version-file = <0>Восстановить файл к этой версии</0> — файл в рабочей папке станет таким, как в выбранном коммите. Коммит не создаётся, <1>Ctrl+Z</1> вернёт.
click-hash-show-commit-in = Клик по хэшу — показать коммит в графе.
blame-to-left-of-each = <0>Blame</0> — слева от каждой строки: кто и когда последним её менял. Строки одного коммита собраны в блок: аватар, автор, сообщение, дата и короткий хэш. Полоса у края — «возраст»: чем свежее изменение, тем она ярче, старый код — приглушённее.
hover-over-block-full-commit = Наведите на блок — полное сообщение коммита и статистика: сколько файлов и строк он изменил, в том числе в этом файле.
click-hash-graph-goes-to = Клик по хэшу — граф переходит к этому коммиту.
blame-before-this-commit-arrow = <0>Blame до этого коммита</0> (стрелка ↰ у блока или кнопка в подсказке) — blame файла в версии до этого коммита: видно, кто писал строку раньше. Так можно копать историю строки вглубь, и через переименования. <1>Назад</1> или <2>Esc</2> — на шаг обратно.
ignore-whitespace-git-blame-w-2 = <0>Игнорировать пробелы</0> (git blame -w) — правки только в отступах не считаются изменением строки.
for-wip-file-blame-is = Для файла из WIP blame строится по рабочей папке: новые строки помечены «Не закоммичено».
conflict-merge-rebase-pull-mine = конфликт merge rebase pull моё их решить продолжить прервать
if-changes-overlapped-during-merge = Если при merge, rebase, pull или cherry-pick изменения пересеклись, сверху появится жёлтая панель, а файлы с конфликтами — в отдельном списке справа.
click-resolve-conflicts-editor-opens = Нажмите <0>Решить конфликты</0> — откроется редактор: слева «Моё», справа «Их», внизу результат.
for-each-conflict-block-choose = Для каждого конфликтного блока выберите версию или <0>Оба</0>; результат можно поправить вручную. Для всего файла есть «Взять … везде».
save-and-next-ctrl-s = <0>Сохранить и дальше</0> (<1>Ctrl+S</1>) — к следующему файлу.
when-everything-is-resolved-continue = Когда всё решено — <0>Продолжить</0> в жёлтой панели. Передумали — <1>Прервать</1>, всё вернётся как было.
stash-hide-pop-apply-drop = stash спрятать pop apply drop частично файл выбранные apply selected фрагмент восстановить
stash-temporarily-hides-uncommitted = Stash временно прячет незакоммиченные изменения — например, чтобы переключиться на другую ветку.
stash-on-toolbar-stash-everything = <0>Stash</0> на панели — спрятать всё; <1>Pop</1> — вернуть последнее спрятанное.
names-in-list-follow-one = Названия в списке единого вида: своё сообщение, «Правки в <ветка>» для Stash без сообщения или имя ветки с пометкой<0>авто</0>; справа — когда спрятано. Одинаковые правки дважды не хранятся: при повторном Stash старая копия убирается.
stash-section-on-left-click = Раздел <0>Stash</0> слева: клик — посмотреть содержимое; кнопки и правый клик — <1>Применить</1> (Apply, stash остаётся),<2>Забрать</2> (Pop — применить и удалить), <3>Удалить</3> (Drop; <4>Ctrl+Z</4> вернёт).
take-only-part-of-stash = Взять из stash только часть
individual-files-check-them-in = <0>Отдельные файлы</0>: отметьте их галочками в списке stash — появится кнопка <1>Применить выбранные (N)</1>. Галочка в заголовке списка выбирает все файлы.
one-file-restore-button-when = <0>Один файл</0>: кнопка восстановления при наведении на строку файла или правый клик → <1>Восстановить файл из stash</1>.
individual-pieces-of-code-open = <0>Отдельные куски кода</0>: откройте файл из stash — у каждого фрагмента в diff есть кнопка <1>Применить</1>.
files-go-to-working-folder = Файлы попадают в рабочую папку (в неиндексированные), stash остаётся в списке. Новые файлы из stash создаются, удалённые — удаляются. Если в файле есть ваши несохранённые правки, программа сначала спросит. Всё отменяется <0>Ctrl+Z</0>.
search = Поиск
search-find-commit-filter-author = поиск найти коммит фильтр автор хэш файл строка изменения код текст
ctrl-f-commit-search-message = <0>Ctrl+F</0> — поиск по коммитам: сообщение, автор, хэш, ветка — и текст в изменениях файлов (кнопка <1>В файлах</1>, включена по умолчанию). Подходящие коммиты подсвечиваются, остальные приглушаются; <2>Enter</2> / <3>Shift+Enter</3> — к следующему и предыдущему. Фильтр веток и тегов слева — <4>Ctrl+Alt+F</4>.
if-text-is-found-in = Если текст найден в файлах, у коммита в графе появляется значок с числом файлов, а справа — блок «найдено»: файл и строка (номер, добавлена она или удалена) с подсвеченным совпадением. Такие файлы выделены и в списке файлов коммита. Клик по строке открывает изменения файла сразу на этом месте, с тем же поиском.
ci-cd-pipelines-and-runners = CI/CD: пайплайны и раннеры
ci-cd-gitlab-pipeline-token = ci cd gitlab pipeline пайплайн токен переменные расписание раннер runner lint yml github actions gitea forgejo jenkins bitbucket проверка ошибка конфиг сценарий merge request тег docker секреты артефакты cron dag skip ci уведомление
ci-cd-settings-in-repository = Настройки CI/CD в репозитории
ci-cd-section-on-left = Раздел <0>CI/CD</0> слева находит файлы GitLab CI, GitHub Actions, Jenkins, Bitbucket и других систем. Клик по файлу открывает:
diagram-stages-and-jobs-at = <0>Схема</0> — этапы и задания наглядно. Для GitLab их можно менять: <1>+ задание</1>, <2>+ Этап</2>, кнопка <3>Изменить</3> в деталях задания.
check-what-will-break-in = <0>Проверка</0> — что в конфигурации сломается: для каждой проблемы написано, <1>когда</1> она проявится, <2>как</2> это будет выглядеть (какую ошибку покажет сервер или лог задания), <3>почему</3> и <4>как исправить</4>.
file-editor-with-on-fly = <0>Файл</0> — редактор с проверкой на лету: строки с ошибками отмечены красным, с предупреждениями — жёлтым, схема и проверка обновляются по мере ввода. <1>Ctrl+S</1> — сохранить.
history-commits-that-changed-ci = <0>История</0> — коммиты, в которых менялись настройки CI.
execution-graph-dag-switch-above = <0>Граф выполнения (DAG)</0> — переключатель над схемой: задания колонками по зависимостям needs, линии показывают, кто кого ждёт; при наведении подсвечивается вся цепочка.
next-to-cron-in-schedule = Рядом с <0>cron</0> в расписании — расшифровка по-русски: «каждый день в 03:00 UTC».
in-editor-step-template-insert = В редакторе: <0>Шаблон шага</0> — вставить Checkout, кэширование зависимостей, сборку Docker-образа или деплой по SSH в место курсора; после <1>tags:</1> / <2>runs-on:</2> всплывают метки живых раннеров.
while-changes-arent-saved-theres = Пока изменения не сохранены, сверху жёлтая полоса: «Изменения» (что поменяется в файле), «Отменить правки», «Сохранить». Кнопка <0>Проверить в GitLab</0> проверяет черновик на сервере и показывает, какие задания запустятся.
configuration-check = Проверка конфигурации
check-runs-right-away-on = Проверка идёт сразу, на этом компьютере, без отправки файла на сервер, — и по сохранённому файлу, и по черновику. Красное — ошибка (пайплайн не создастся или задание упадёт наверняка), жёлтое — может сломаться, синее — совет. Значки с числом проблем видны на вкладке «Проверка» и на карточках заданий схемы; клик по проблеме в деталях задания открывает её разбор.
syntax-and-keys-yaml-errors = <0>Синтаксис и ключи</0>: ошибки YAML, повторяющиеся ключи, опечатки в ключах (scirpt → script), неверные значения when, retry, parallel, timeout, expire_in, cache, environment, неизвестные события и права GitHub Actions.
links-needs-and-dependencies-on = <0>Связи</0>: needs и dependencies на несуществующие или более поздние задания, циклы, extends и !reference, этапы не из stages, on_stop без задания остановки, include файлов, которых нет.
scripts-against-repository-missing-file = <0>Скрипты против репозитория</0>: нет файла или права на запуск (Permission denied), нет package.json / lock-файла / npm-скрипта, нет Makefile или цели, cd в несуществующую папку, docker без демона, apt-get в Alpine, команды, которых нет в образе.
security-and-deprecations-tokens-and = <0>Безопасность и устаревшее</0>: токены и пароли в открытом виде, отключённые версии действий GitHub и образы раннеров, подстановка заголовков PR прямо в команды.
for-gitlab-rules-are-evaluated = Для GitLab правила прогоняются для типичных событий — push в основную и в другую ветку, merge request, тег, расписание, ручной запуск. В таблице «Что запустится» видно, какие задания попадут в пайплайн и почему; отдельно находятся двойные пайплайны (ветка + MR), needs на задание, которого в этом пайплайне не будет, ручные задания, которые остановят пайплайн, релиз без тега.
network-includes-include-remote-project = Подключения из сети (include: remote / project / template) без сети не проверить — они отмечены советом. Полную проверку на сервере даёт кнопка «Проверить в GitLab».
pipelines-gitlab-github-gitea-forgejo = Пайплайны: GitLab, GitHub, Gitea/Forgejo, Bitbucket
service-is-detected-by-itself = Сервис определяется сам — по адресу remote и файлам CI (.gitlab-ci.yml, .github/workflows, .gitea/workflows, .forgejo/workflows, bitbucket-pipelines.yml). Для своего сервера (GitLab Self-Managed, GitHub Enterprise, свой Gitea) во вкладке <0>Пайплайны → Подключение</0> можно указать сервис и <1>Base API URL</1>.
repository-has-one-sign-in = Авторизация у репозитория одна — для Pull, Push и пайплайнов. Авторизуйтесь один раз в окне <0>Авторизация репозитория</0>, и пайплайны откроются сами.
open-ci-cd-pipelines-and = Откройте <0>CI/CD → Пайплайны</0> и нажмите <1>Авторизовать репозиторий</1> (это то же окно, что появляется при Pull или Push).
for-gitlab-access-token-with = Для GitLab удобнее всего <0>токен доступа</0> с правом <1>api</1> — ссылка «Создать токен» откроет страницу GitLab с уже выбранными правами. Один токен работает и для git, и для пайплайнов.
if-you-sign-in-with = Если входите паролем или SSH-ключом — в том же окне заполните поле <0>Пайплайны CI/CD</0>: GitLab не принимает пароль и ключ для API, а токен сохранится вместе с этой авторизацией.
after-that-pipeline-statuses-are = После этого статусы пайплайнов видны прямо в графе, а во вкладке «Пайплайны» можно смотреть этапы, логи заданий, перезапускать и отменять. Вкладки <0>Переменные</0> и <1>Расписания</1> позволяют добавлять, менять и удалять переменные CI/CD и расписания пайплайнов, <2>Раннеры</2> — смотреть, кто выполняет задания.
read-only-token-read-api-lets = Токен только для чтения (read_api) позволяет смотреть; чтобы запускать и менять — нужен токен с правом api.
run-window-with-branch-and = <0>Запуск</0> — окно с веткой и параметрами: inputs из workflow_dispatch (выбор, флажок, строка), переменные GitLab с описанием, custom-пайплайны Bitbucket, свои переменные KEY=VALUE.
cancel-running-pipeline-retry-failed = <0>Отменить</0> идущий пайплайн, <1>Перезапустить упавшие</1> — только упавшие задания. У идущего задания тикает таймер.
job-log-ansi-colors-collapsible = <0>Лог задания</0>: ANSI-цвета, сворачиваемые секции (::group:: и section GitLab), поиск <1>Ctrl+F</1> и кнопка <2>К первой ошибке ↓</2> — прокрутит к первой строке с Error / FAIL / exit code.
artifacts-of-finished-pipeline-with = <0>Артефакты</0> законченного пайплайна — с размером, скачиваются в один клик.
secrets-and-variables-list-of = <0>Секреты и переменные</0> — список переменных репозитория и создание или замена секретов (значения секретов сервис не отдаёт).
whats-unavailable-for-particular-service = Что недоступно у конкретного сервиса (например, пауза раннера в GitHub или раннеры в Bitbucket Cloud), выключено, и в подсказке написано почему.
runners-tab-self-hosted-project = Вкладка <0>Раннеры</0>: собственные (self-hosted, раннеры проекта) и облачные — со статусом Online, Busy (с ссылкой на задание), Offline и Paused, ОС, архитектурой, версией и метками. <1>Очистить неактивные</1> удаляет все собственные раннеры не в сети одним кликом.
click-runner-editor-labels-as = Клик по раннеру — редактор: метки чипсами, <0>Активен / На паузе</0> (раннер доделает текущие задания и не возьмёт новые), «Брать задания без тегов», «Только для этого проекта», описание, максимальный тайм-аут, удаление.
connect-runner-gets-registration-token = <0>Подключить раннер</0> — получает токен регистрации и даёт готовую команду (Docker, Linux, macOS, Windows) с адресом, токеном и тегами. <1>Запустить локально</1> поднимает раннер в Docker на этом компьютере; остановить его можно там же.
insert-into-config-on-runner = <0>Вставить в конфиг</0> на карточке раннера — вставит tags / runs-on с его метками в файл CI.
configuration-check-matches-tags-and = Проверка конфигурации сверяет tags и runs-on с живыми раннерами: если ни у одного раннера в сети нет нужного тега (или подходящие не в сети или на паузе), будет предупреждение «пайплайн зависнет в очереди (Pending)».
statuses-in-graph-and-notifications = Статусы в графе и уведомления
commits-in-graph-have-pipeline = У коммитов в графе — значок пайплайна (✓, ✕, ⟳, ⊘). Подсказка показывает сводку по заданиям, клик открывает пайплайн, а у красного — сразу лог упавшего задания. Статус пайплайна текущей ветки — в строке состояния внизу. Когда пайплайн, который шёл, заканчивается, приходит уведомление системы. В форме коммита кнопка <0>Пропустить CI</0> добавляет в сообщение [skip ci] — такой коммит не запустит пайплайн.
in-settings-connections-each-repositorys = В <0>Настройки → Подключения</0> у каждого репозитория рядом с авторизацией написано, работают ли от неё пайплайны. Токены CI/CD, сохранённые в прежних версиях отдельно, переносятся в авторизацию репозитория автоматически.
appearance-2 = Оформление
theme-light-dark-white-system = тема светлая тёмная белая как в системе фон прозрачность оформление настройки анимации
ctrl-or-gear-at-top = <0>Ctrl+,</0> или шестерёнка справа вверху → <1>Оформление</1>: тема, фон (градиенты, своя картинка или прозрачность Windows 11), прозрачность панелей, размытие, анимация фона. Изменения видны сразу и сохраняются.
light-theme-white-panels-and = <0>Светлая</0> тема — белые панели и тёмный текст; цвета веток в графе, подсветка кода и диффы подобраны под светлый фон.<1> Как в системе</1> — светлая или тёмная по настройке Windows/macOS: тема переключится сама, когда система сменит режим.
interface-language-russkiy-or-english = <0>Язык интерфейса</0> — Русский или English: Настройки → Оформление → Язык. Окно перерисуется сразу, меню, подсказки и сообщения об ошибках сменятся целиком; вкладки и настройки сохранятся.
if-somethings-wrong = Если что-то не так
error-problem-git-not-found = ошибка проблема git не найден доступ пароль ssh не работает частые вопросы
git-not-found-and-fully = <0>«Git не найден»</0> — { $a1 } и полностью перезапустите программу (и терминал, из которого её запускали).
no-access-to-server-repository = <0>Нет доступа к серверу</0> — откроется окно «Авторизация репозитория»: выберите, где хранится репозиторий, и введите логин и пароль, токен или SSH-ключ. Если вход прошёл, а записать нельзя — проверьте права в проекте на сервере.
action-is-unavailable-gray-hover = <0>Действие недоступно (серое)</0> — наведите курсор, подсказка объяснит почему: например, не завершён merge или вы не на ветке.
branch-cant-be-deleted-from = <0>Ветку не удалить с сервера</0> — она защищена или основная. Снимите защиту или смените ветку по умолчанию в настройках проекта на GitLab/GitHub.
no-connection-in-status-bar = <0>«нет связи» в строке состояния</0> — фоновая проверка не достучалась до сервера (интернет, VPN, сервер недоступен). Программа сама повторит попытку чуть позже; кнопка рядом делает fetch сразу и показывает подробную ошибку.
did-something-by-mistake-ctrl = <0>Что-то сделали по ошибке</0> — <1>Ctrl+Z</1>. Название того, что будет отменено, видно в меню <2>Edit</2>.
new-features-arent-visible-after = <0>После обновления программы не видно новых возможностей</0> — закройте программу полностью (все окна) и откройте снова: часть изменений подхватывается только при запуске.
pre-commit-check-gets-in = <0>Проверка перед коммитом мешает</0> — плашка над кнопкой «Закоммитить»: кнопка со щитом выключает её для репозитория, шестерёнка открывает настройки правил.
graph-didnt-update-after-working = <0>Граф не обновился после работы в терминале</0> — кнопка обновления справа вверху. Обычно программа замечает изменения сама.
guide-2 = { $a0 }<1>Руководство</1>
search-guide = Поиск по руководству

## src/components/InitRepoDialog.tsx

uploading = загрузка { $a0 }
first-commit-2 = первый коммит
checking-repository = Проверяем репозиторий…
connect-to-remote-repository = Подключить к удалённому репозиторию
new-git-repository = Новый Git-репозиторий
check-author-email = Проверьте email автора ↓
enter-commit-authors-name-and = Укажите имя и email автора коммита ↓
connecting = Подключаем…
creating = Создаём…
connect-and-push = Подключить и отправить
connect = Подключить
empty-folder = Пустая папка
folder = папка
folders = папки
folders-2 = папок
another-folder = Другая папка
new-repository = Новый репозиторий
git-init-from-scratch = git init с нуля
connect-existing = Подключить существующий
already-created-on-gitlab-github = уже создан на GitLab / GitHub
this-folder-has-no-git = В этой папке ещё нет Git. Создадим репозиторий прямо здесь — файлы проекта останутся на месте.
folder-is-already-inside-repository = Папка уже находится внутри репозитория <0>{ $a1 }</0>. Новый репозиторий будет вложенным — обычно это не нужно.{ $a2 }
open-it = Открыть его
service-folders-will-get-into = В коммит попадут служебные папки: { $a0 }. Включите .gitignore, чтобы их исключить.
excluded-via-gitignore = Исключены через .gitignore: { $a0 }
branch-for-first-push = Ветка для первого push
main-branch = Основная ветка
already-in-project-well-leave = Уже есть в проекте — оставим без изменений
already-in-repository-on-server = Уже есть в репозитории на сервере — возьмём его
which-files-git-will-ignore = Какие файлы Git будет игнорировать
found = · найден
rules-2 = { $a0 }{ $a1 } ({ $a2 } правил)
show-and-edit = Показать и отредактировать
already-in-project = Уже есть в проекте
file-with-project-name = Файл с названием проекта
commit-project-files = Коммит файлов проекта
first-commit = Первый коммит
on-top-of-last-commit = Поверх последнего коммита с сервера «{ $a0 }»
your-files-will-become-repositorys = Ваши файлы станут первым коммитом репозитория
folder-is-empty-nothing-to = Папка пуста — коммитить пока нечего
save-current-state-of-all = Сохранить текущее состояние всех файлов
author-2 = { $a0 }Автор: <1>{ $a2 }</1><3><{ $a4 }></3>{ $a5 }
change-2 = изменить
git-doesnt-know-who-you = { $a0 }Git ещё не знает, кто вы. Имя и email будут указаны в коммитах.
use-for-all-repositories-on = { $a0 }Использовать для всех репозиториев на этом компьютере
push-to-server-right-away = Сразу отправить на сервер (push)
to-on = в { $a0 } на { $a1 }
after-connecting = После подключения
optional-can-be-added-later = Необязательно — можно добавить позже
copy-address-on-project-page = Скопируйте адрес на странице проекта в GitLab: кнопка «Code» → «Clone with HTTPS» или «Clone with SSH». Проверка ничего не меняет ни в папке, ни на сервере.
connecting-to-server-if-sign = { $a0 } Подключаемся к серверу… Если появится окно входа — авторизуйтесь в нём.
address-changed-click-check-again = Адрес изменился — нажмите «Проверить» ещё раз.
access-granted-2 = { $a0 }<1>Доступ есть{ $a2 }</1>
repository-is-empty-your-files = Репозиторий пустой. Ваши файлы станут первым коммитом и будут отправлены на сервер.
branch-9 = { $a0 }Ветка{ $a1 }
last-commit = Последний коммит: <0>«{ $a1 }»</0> · { $a2 } · { $a3 } { $a4 }
what-happens-to-files = Что будет с файлами:
identical-nothing-changes = Совпадают ({ $a0 }) — ничего не меняется
different-your-version-stays-difference = Различаются ({ $a0 }): { $a1 } — останется <2>ваша</2> версия, разница попадёт в коммит
only-on-server-will-appear = Есть только на сервере ({ $a0 }): { $a1 } — появятся в папке
rest-of-your-files-will = Остальные ваши файлы добавятся новым коммитом поверх истории сервера

## src/components/Loader.tsx

opening-repository = Открываем репозиторий

## src/components/NewTabPage.tsx

connect-to-gitlab-github = Подключить к GitLab / GitHub
recent = Недавние
find-repository = Найти репозиторий…
find-repository-2 = Найти репозиторий
loading-list = { $a0 } Загружаем список…
repositories-youve-opened-will-appear = Здесь появятся репозитории, которые вы открывали. Начните с «Открыть» — если в папке нет Git, программа предложит его создать.
opened =
    {""}
    Открывали { $a0 }
already-open-switch-to-tab =
    {""}
    Уже открыт — переключиться на вкладку
remove-from-recent = Убрать { $a0 } из недавних
remove-from-list-repository-itself = Убрать из списка (сам репозиторий не трогается)
work-faster-with-git-gorynych = Работайте быстрее с git-Горынычем
drag-branches-onto-branches-to = Перетаскивайте ветки на ветки для merge и rebase, переключайтесь без stash вручную, проверяйте коммиты на забытые console.log и ключи до отправки, следите за пайплайнами GitLab и правьте .gitlab-ci.yml — всё в одном окне.
open-guide = { $a0 } Открыть руководство
resources = Ресурсы
how-to-use-app-f1-2 = Как пользоваться программой (F1)
keyboard-shortcuts-2 = { $a0 } Горячие клавиши
settings-and-appearance-2 = { $a0 } Настройки и оформление

## src/components/PipelineStatus.tsx

success = успешно
running-3 = выполняется
queued = в очереди
preparing = подготовка
waiting-for-resource = ждёт ресурс
waiting-for-manual-run = ждёт ручного запуска
scheduled = запланирован
canceling = отменяется
skipped = пропущен
success-with-warnings = успешно, с предупреждениями
on-schedule-2 = по расписанию
started-manually = запущен вручную
via-api = через API
trigger = триггер
child = дочерний
from-another-project = из другого проекта
from-chat = из чата
external-2 = внешний
release = релиз
after-another-workflow = после другого workflow
called-workflow = вызван workflow
script-error-command-exited-with = ошибка в скрипте (команда завершилась с ненулевым кодом)
runner-failure = сбой раннера
wait-time-exceeded = превышено время ожидания
job-ran-longer-than-timeout = задание выполнялось дольше таймаута
artifacts-from-dependencies-not-found = не найдены артефакты из зависимостей
runner-doesnt-support-job = раннер не поддерживает задание
project-is-archived = проект в архиве
preconditions-not-met = не выполнены предварительные условия
scheduler-error = ошибка планировщика
data-integrity-violated = нарушена целостность данных
api-error = ошибка API
unknown-reason = неизвестная причина
min-2 = { $a0 } мин{ $a1 }
s-3 = {" "}{ $a0 } с
h = { $a0 } ч{ $a1 }
min-3 = {" "}{ $a0 } мин

## src/components/RebaseView.tsx

pick = Оставить
commit-stays-as-is = Коммит остаётся как есть
reword = Изменить сообщение
commit-stays-only-text-changes = Коммит остаётся, меняется только текст
squash-into-commit-below = Объединить с коммитом ниже
changes-and-text-are-joined = Изменения и текст присоединяются к коммиту ниже
fixup-into-commit-below-without = Влить в коммит ниже без текста
changes-are-joined-to-commit = Изменения присоединяются к коммиту ниже, его текст не меняется
commit-and-its-changes-will = Коммит и его изменения пропадут из истории
interactive-rebase-2 = <0>Интерактивный rebase</0>{ $a1 }
branch-10 = ветка <0>{ $a1 }</0>{ $a2 }
onto = {" "}→ на { $a0 } <1>«{ $a2 }»</1>
commits-after-2 = , коммиты после { $a0 }
select-alt-move-p-r = ↑↓ выбор · Alt+↑↓ двигать · P R S F D — действие
close-without-changes-esc = Закрыть без изменений (Esc)
collecting-commits = { $a0 } Собираем коммиты…
newest-on-top = <0>{ $a1 } { $a2 } · новые сверху</0>{ $a3 }{ $a4 }
reset-plan = Сбросить план
new-base = новая основа:
base-unchanged = основа (не меняется):
bottom-commit-has-nothing-to = Самый нижний коммит не с чем объединить — выберите для него другое действие
plan-changes-nothing = План ничего не меняет
branch-will-move-to-new = Ветка <0>{ $a1 }</0> перейдёт на новую историю. Undo ({ $a2 }) вернёт как было.
cant-apply-automatically-there-will = Применить автоматически нельзя — будет конфликт
start-anyway-ill-resolve-conflicts = Точно начать — я решу конфликты
run-real-git-rebase-it = Запустить настоящий git rebase: он остановится на конфликте, вы решите его и нажмёте «Продолжить». «Прервать» вернёт всё как было.
start-and-resolve-conflicts-manually = { $a0 } Начать и решить конфликты вручную
apply-rebase = { $a0 } Применить rebase
double-click-reword = Двойной клик — изменить сообщение
empty-message = пустое сообщение
how-many-commits-will-be = Сколько коммитов будет объединено с этим
conflict-2 = конфликт
into-2 = → в { $a0 }
up-alt = Выше (Alt+↑)
down-alt = Ниже (Alt+↓)
message-of-combined-commit-pcs = Сообщение объединённого коммита ({ $a0 } шт.)
new-commit-message = Новое сообщение коммита
message-cant-be-empty = Сообщение не может быть пустым
done-3 = Готово ({ $a0 })
preview-computed-in-advance-working = Предпросмотр{ $a0 }<1>— посчитан заранее, рабочая папка не тронута</1>
bottom-commit-cant-be-combined = Нижний коммит нельзя объединить
squash-and-fixup-join-commit-to = Squash и fixup присоединяют коммит к тому, что ниже. Для самого нижнего выберите «Оставить» или «Удалить».
conflict-on-commit = Конфликт на коммите { $a0 } «{ $a1 }»
files-5 = Файлы
its-changes-dont-apply-onto = Его изменения не ложатся на коммиты ниже в новом порядке. Поменяйте план (например, верните порядок) или начните rebase и решите конфликт вручную.
choose-actions-for-commits-on = Выберите действия для коммитов слева: изменить порядок, сообщение, объединить или удалить.
will-go-through-without-conflicts = Пройдёт без конфликтов
resulting-files-wont-change-only = Итоговые файлы не изменятся — меняется только история.
resulting-files-will-change-list = Итоговые файлы изменятся: { $a0 } { $a1 } (список ниже).
already-on-server = { $a0 } { $a1 } уже на сервере
after-rebase-branch-will-have = После rebase ветку придётся отправить через Force Push — это перепишет её и у коллег.
merge-commits-will-be-flattened = Merge-коммиты ({ $a0 }) будут выпрямлены
like-regular-git-rebase-it = Как и обычный git rebase, он переносит только обычные коммиты — история станет линейной.
uncommitted-changes = Незакоммиченные изменения: { $a0 }
theyll-be-kept-if-rebase = Они сохранятся. Если rebase меняет те же файлы, приложение попросит сначала сделать Commit или Stash.
how-branch-files-will-change = Как изменятся файлы ветки
no-changes-2 = без изменений
moved = перенесён
new-message = новое сообщение
combined = объединён
merges-into = вливается в { $a0 }
now = Сейчас
dropped = удаляется
will-become-empty-skipped = станет пустым — пропустится
branchs-old-base = прежняя основа ветки
after-4 = После
no-commits-will-remain = коммитов не останется
will-stop-at-conflict = { $a0 } остановится на конфликте

## src/components/RefBadge.tsx

local-and-on-server = локальная и на сервере
local-4 = локальная = { $a0 }
server-3 = сервер
local-only = только локальная
branches-on-this-commit = Ветки на этом коммите · { $a0 }
tags-3 = Теги · { $a0 }
yours-on-server-right-click = <0>{ $a1 } у вас</0><2>·</2><3>{ $a4 } на сервере</3><5>·</5>правый клик — действия
double-click-checkout-right-click = Двойной клик — checkout, правый клик — все действия
right-click-actions = Правый клик — действия
current-3 = текущая ·{" "}
checkout-creates-local-branch = Checkout { $a0 } (создаст локальную ветку)

## src/components/Resizer.tsx

drag-to-change-width-double-click = Потяните, чтобы изменить ширину. Двойной клик — по умолчанию

## src/components/RevertToDialog.tsx

restore-project-to-commit = Вернуть проект к коммиту
restore-to = { $a0 }Вернуть к { $a1 }
computing-what-will-change = { $a0 } Считаем, что изменится…
project-files-already-match-this = Файлы проекта уже совпадают с этим коммитом — откатывать нечего.
all-files-will-become-as = Все файлы станут такими, как в этом коммите{ $a0 }. Изменится <1>{ $a2 } { $a3 }</1> (<4>+{ $a5 }</4> <6>−{ $a7 }</6>).
on-branch-2 = {" "}на ветке <0>{ $a1 }</0>
changes-of-will-be-undone = Будут отменены изменения { $a0 } { $a1 }:
this-commit-isnt-from-current = Этот коммит не из истории текущей ветки. Файлы всё равно станут как в нём — убедитесь, что это нужно.
safe-history-isnt-rewritten-new = Безопасно: история не переписывается. Сверху появится новый коммит «Revert to { $a0 }», старые коммиты останутся. Передумали — нажмите Undo.{ $a1 }
suitable-for-commits-already-pushed = {" "}Подходит и для уже отправленных на сервер коммитов.
there-are-uncommitted-changes-they = Есть незакоммиченные изменения ({ $a0 }). Их нужно убрать перед откатом.{ $a1 }
stash-and-continue = { $a0 } Спрятать в Stash и продолжить
untracked-files-have-same-names = Неотслеживаемые файлы совпадают по имени с файлами коммита и будут мешать: <0>{ $a1 }</0>. Переместите их или спрячьте в Stash.
push-to-server-right-away-2 = { $a0 }{ $a1 }Сразу отправить на сервер (push)

## src/components/SearchBar.tsx

all-time = Всё время
today = Сегодня
n-7-days = 7 дней
n-30-days = 30 дней
period = Период…
message-sha-author-branch-or = Сообщение, SHA, автор, ветка или текст в файлах…
message-sha-author-branch = Сообщение, SHA, автор, ветка…
text-in-file-changes-is = Ищется и текст в изменениях файлов: найденный коммит, файл и строка подсвечиваются. Клик — искать только в описании коммитов
search-in-file-changes-too = Искать и в изменениях файлов
in-files = { $a0 }В файлах
all-authors = Все авторы
authors = Авторы: { $a0 }
find-author = Найти автора
nobody-found = Никого не нашли
reset-authors = Сбросить авторов
from-to = с{ $a0 }по{ $a1 }
searching-last-commits = Поиск по последним { $a0 } коммитам
searching-2 = Ищем…
in-last = {" "}· в { $a0 } посл.
commits-whose-changes-contain-text = Коммиты, в изменениях которых найден текст
in-files-2 = { $a0 } в файлах: { $a1 }{ $a2 }
previous-shift-enter-2 = Предыдущий (Shift+Enter)
next-enter-2 = Следующий (Enter)
reset-2 = Сбросить

## src/components/SettingsDialog.tsx

sync-2 = Синхронизация
connections = Подключения
settings-2 = Настройки
restore-default-appearance = Вернуть оформление по умолчанию
couldnt-load-image = Не удалось загрузить картинку
language = Язык
window-will-redraw-in-selected = Окно перерисуется на выбранном языке; вкладки и настройки сохранятся.
theme = Тема
light-or-dark-per-windows = Светлая или тёмная — как в настройках Windows/macOS, переключается сама
background = Фон
requires-windows-11-version-22h2 = Нужна Windows 11 (версия 22H2 или новее)
choose-another-image = Выбрать другую картинку…
choose-image = Выбрать картинку…
image-blur = Размытие картинки
dimming = Затемнение
window-material = Материал окна
strong-blur-desktop-is-barely = Сильное размытие — рабочий стол едва угадывается
light-tint-of-wallpaper-calmer = Лёгкий тон обоев, спокойнее и экономнее
transparency-and-glass = Прозрачность и стекло
panel-transparency = Прозрачность панелей
opaque-panels = панели непрозрачные
almost-pure-glass = почти одно стекло
blur-under-glass = Размытие под стеклом
background-animation-smooth-movement-of = { $a0 }{ $a1 }Анимация фона<2>— плавное движение пятен и сияния</2>
uncommitted-changes-when-switching = Незакоммиченные изменения при переключении ветки
what-to-do-with-edits = Что делать с правками в рабочей папке, когда вы переходите на другую ветку.
ask-every-time = Спрашивать каждый раз
window-with-choice-stash-move = Окно с выбором: спрятать, перенести или выбросить — с подсказкой, какие файлы пересекаются с целевой веткой.
stash-automatically-smart-switching = Прятать автоматически (умное переключение)
edits-are-stashed-under-current = Правки прячутся в stash с именем текущей ветки и сами возвращаются, когда вы вернётесь на неё.
move-to-new-branch = Переносить в новую ветку
like-regular-git-switch-edits = Как обычный git switch: правки едут с вами. Если пересекутся с правками ветки — будет конфликт, копия останется в Stash.
how-stash-works = { $a0 } Как работает «спрятать»
youre-working-in-feature-and = Работаете в feature-A, есть правки. Двойной клик по hotfix.
feature-edits-are-stashed-stash = Правки feature-A спрятаны (stash «feature-A (авто)»), вы на чистой hotfix.
back-on-feature-edits-are = Вернулись на feature-A — правки на месте, в том числе staged.
works-for-all-switches-from = Работает для всех переключений из программы. Если при возврате будет конфликт, stash не удаляется. Ctrl+Z переключает обратно вместе с правками.
gitlab-api-with-etag-not = GitLab API с ETag — ответ «не изменилось» почти ничего не стоит серверу
git-ls-remote-no-token = git ls-remote — без токена, работает с любым сервером
auto-update-graph-and-branches = { $a0 }<1><2>Автообновление</2><3>Граф и ветки обновляются сами: при изменениях в папке (в том числе fetch/pull из терминала) и при новых коммитах на сервере. То же переключает «авто» в строке состояния.</3></1>
sync-index-with-edits-from = { $a0 }<1><2>Синхронизировать индекс с правками из других программ</2><3>Откатили застейдженный файл в WebStorm или VS Code к последнему коммиту — изменение исчезнет целиком, без «призрака» в Staged и устаревших предупреждений проверки перед коммитом. Поправили снаружи файл, застейдженный целиком, — в индекс попадёт новая версия. Частично застейдженные файлы (по кускам) не трогаются.</3></1>
how-often-to-check-server = Как часто проверять сервер
only-open-tab-is-checked-and = Проверяется только открытая вкладка и только пока окно программы активно. Окно свёрнуто или в фоне — раз в { $a0 } секунд.
first-we-ask-server-only = Сначала спрашиваем у сервера только хэши веток — это быстро и почти бесплатно. Настоящий <0>git fetch --prune</0> запускается, только если что-то изменилось.
while-you-commit-checkout-rebase-or = Пока вы делаете коммит, checkout, rebase или другое действие, проверка ждёт — она никогда не мешает вашим командам.
no-connection-or-server-asks = Нет связи или сервер просит подождать (429) — без всплывающих ошибок, паузы растут: { $a0 }.
min = { $a0 } мин
for-gitlab-with-saved-token = Для GitLab с сохранённым токеном используется API с ETag, иначе — git ls-remote.
server-is-unavailable-errors-in = Сервер недоступен: { $a0 }. Ошибок подряд: { $a1 }.
last-check-at-method = Последняя проверка в { $a0 }{ $a1 }. Способ: { $a2 }.
ms = {" "}({ $a0 } мс)
not-checked-yet-first-check = Ещё не проверяли — первая проверка через пару секунд после открытия репозитория.
sign-in-unavailable = Авторизация недоступна.
view-and-actions = просмотр и действия
view-only-2 = только просмотр
pipelines-token-from-previous-version = Пайплайны: токен из прежней версии{ $a0 } — авторизуйте репозиторий, чтобы была одна авторизация
pipelines-this-sign-in-doesnt = Пайплайны: эта авторизация не подходит для API — откройте «Изменить»
pipelines-still-using-token-from = Пайплайны: пока по токену из прежней версии
pipelines-doesnt-work-for-api = Пайплайны: { $a0 } не подходит для API — добавьте токен в «Изменить»
password-3 = пароль
pipelines-same-sign-in = Пайплайны: та же авторизация{ $a0 }{ $a1 }{ $a2 }{ $a3 }
with-api-token = {" "}(с токеном для API)
will-be-checked-on-first = {" "}— проверится при первом обращении
enter-it-again = — введите заново
forget-2 = <0>Забыть?</0>{ $a1 }{ $a2 }
yes-2 = Да
repository-sign-ins = { $a0 }<1>Авторизация репозиториев</1>{ $a2 }
sign-in-to-open-repository = { $a0 } Авторизовать открытый репозиторий…
sign-in-is-saved-for = Авторизация сохраняется для конкретного репозитория и одна на всё: Pull, Push, клонирование и пайплайны CI/CD. На одном сервере у разных репозиториев могут быть разные учётные записи. В окне авторизации выбирается, где хранится репозиторий: GitHub, GitLab или свой сервер (Self-Managed).
none-yet-sign-in-is = Пока ни одного. Вход сохраняется сам, когда сервер впервые попросит авторизацию при Pull, Push или клонировании.
type-not-selected = тип не выбран
forget-server-sign-ins-of = Забыть сервер: входы всех его репозиториев, общий вход и выбранный тип
forget-3 = Забыть { $a0 }
sign-in-to-repository = Авторизовать репозиторий
edit-sign-in-pull-push = Изменить авторизацию (Pull/Push и пайплайны)
forget-this-repositorys-sign-in = Забыть авторизацию этого репозитория
applies-to-repositories-whose-sign = { $a0 }<1>{ $a2 } · действует для репозиториев, чья авторизация не открывает пайплайны</1>
pipeline-token-for-whole-server = Токен пайплайнов для всего сервера (из прежней версии)
ci-cd-of-all-repositories = CI/CD всех репозиториев { $a0 }
forget-shared-ci-cd-token = Забыть общий токен CI/CD (сохранён раньше, до привязки к репозиториям)
forget-shared-ci-cd-token-2 = Забыть общий токен CI/CD
shared-sign-in-for-all-repositories = Общий вход для всех репозиториев сервера
all-repositories-on = всех репозиториев { $a0 }
forget-shared-sign-in-saved = Забыть общий вход (сохранён раньше, до привязки к репозиториям)
forget-shared-sign-in = Забыть общий вход

## src/components/Sidebar.tsx

filter-branches-and-tags = Фильтр веток и тегов…
filter-branches-and-tags-ctrl = Фильтр веток и тегов (Ctrl+Alt+F)
branches-are-grouped-into-folders = Ветки сгруппированы по папкам (feature/, bugfix/…) — показать списком
group-branches-into-folders-by = Сгруппировать ветки по папкам до «/»
double-click-checkout-right-click-2 =
    { $a0 }
    { $a1 }
    Двойной клик — checkout, правый клик — действия
only-on-your-side-not = Только у вас — на сервер ещё не отправлена
in-sync-with = Синхронизирована с { $a0 }
tracks = Следит за { $a0 }{ $a1 }{ $a2 }
ahead = {" "}· впереди на { $a0 }
behind = {" "}· позади на { $a0 }
stashed-edits-of-branch-theyll =
    Спрятанные правки ветки { $a0 }{ $a1 }{ $a2 }
    Вернутся сами, когда вы переключитесь на эту ветку (stash «{ $a3 }» с пометкой «авто»)
no-commits = Нет коммитов
on-server-3 = На сервере
remote-isnt-configured = Remote не настроен
click-view-changes-right-click =
    { $a0 }{ $a1 }
    { $a2 } · { $a3 }
    { $a4 }Клик — посмотреть изменения, правый клик — действия
itll-come-back-by-itself =
    Вернётся само, когда вы переключитесь на эту ветку
    {""}
auto = авто
no-stashed-changes = Нет спрятанных изменений
tag-5 =
    Тег { $a0 }
    { $a1 }
no-tags = Нет тегов
click-view-settings =
    { $a0 }: { $a1 }
    Клик — посмотреть настройки
ci-cd-service-isnt-determined = Сервис CI/CD не определён — укажите его и адрес API
sign-in-to-repository-same-sign-in = Авторизуйте репозиторий — эта же авторизация откроет пайплайны
last-pipeline-of-branch = Последний пайплайн ветки { $a0 }: #{ $a1 } — { $a2 }
pipelines-3 = { $a0 }<1>Пайплайны</1><2>{ $a3 }</2>
sign-in-2 = авторизовать
looking-for-gitlab-ci-yml = Ищем .gitlab-ci.yml, .github/workflows, Jenkinsfile, bitbucket-pipelines.yml и другие
not-found-4 = Не найдено
on-server-double-click-checkout =
    { $a0 } — на сервере{ $a1 }
    Двойной клик — checkout, правый клик — действия
local-is-on-same-commit =
    {""}
    Локальная { $a0 } на том же коммите
local-differs =
    {""}
    Локальная { $a0 } отличается
no-local-copy =
    {""}
    Локальной копии нет
current-branch-is-here = Здесь текущая ветка

## src/components/StatusBar.tsx

no-upstream = Нет upstream
head-isnt-on-branch-new = HEAD не на ветке: новые коммиты не попадут ни в одну ветку
relative-to-upstream = Относительно upstream
unpushed-commits = Неотправленных коммитов: { $a0 }
will-arrive-on-pull-2 = Придут при Pull: { $a0 }
go-to-head =
    Перейти к HEAD
    { $a0 }
    { $a1 }
    { $a2 } · { $a3 }
go-to-head-2 =
    Перейти к HEAD
    { $a0 }
last-pipeline-of-branch-click =
    { $a0 }: последний пайплайн ветки { $a1 } — #{ $a2 }, { $a3 }{ $a4 }
    Клик — { $a5 }
in-progress-2 = { $a0 } в процессе
uncommitted-changes-2 = Незакоммиченные изменения
click-right-click-more-actions =
    { $a0 }
    Клик — { $a1 }, правый клик — ещё действия
gitlab-api-and-git-ls = GitLab API и git ls-remote
auto-update-is-on-graph = Автообновление включено: граф обновляется при любых изменениях в папке.
server-is-checked-window-not = Сервер проверяется { $a0 } (окно не в фокусе — раз в { $a1 } с); fetch — только если там что-то изменилось.
last-check = Последняя проверка: { $a0 }{ $a1 }{ $a2 }.
in-6 = {" "}через { $a0 }
ms-2 = , { $a0 } мс
click-turn-off-right-click = Клик — выключить, правый клик — настройки.
auto-update-is-off-click = Автообновление выключено. Клик — включить, правый клик — настройки.
auto-2 = авто · { $a0 }
auto-off = авто выкл
server-is-unavailable-click-to =
    Сервер недоступен: { $a0 }{ $a1 }
    Нажмите, чтобы сделать fetch сейчас.
next-attempt-in-s =
    {""}
    Следующая попытка через { $a0 } с
last-fetch-failed = Последний fetch не удался: { $a0 }
new-data-from-server-received = Новые данные с сервера получены в { $a0 }. Нажмите, чтобы сделать fetch сейчас.
get-changes-from-server-fetch = Получить изменения с сервера (fetch)
no-connection = нет связи

## src/components/TitleBar.tsx

edit = Правка
view = Вид
actions = Действия
help = Справка
new-tab-ctrl-t = Новая вкладка (Ctrl+T)
restore = Восстановить
maximize = Развернуть
new-tab-open-clone-or = Новая вкладка — открыть, клонировать или создать репозиторий
close-tab-ctrl-w = Закрыть вкладку (Ctrl+W)

## src/components/Toasts.tsx

details-2 = { $a0 } Подробнее

## src/components/TokenSetup.tsx

repository-has-no-remote-nothing = У репозитория нет remote — авторизовать нечего.
checking-sign-in = Проверяем авторизацию…
signed-in = Авторизован
ci-cd-token-from-previous-version = Токен CI/CD из прежней версии — авторизуйте репозиторий, чтобы всё работало от одной авторизации
repository-sign-in-one-for = Авторизация репозитория — одна для Pull, Push и пайплайнов
valid-until-2 = {" "}· действует до { $a0 }
read-only-token-pipelines-and = Токен только для чтения: пайплайны и логи видны, но запускать, перезапускать и отменять нельзя. Для действий нужен токен с правом «api».
edit-repository-sign-in = { $a0 } Изменить авторизацию репозитория
repository-on-isnt-signed-in = Репозиторий на { $a0 } ещё не авторизован. Авторизуйтесь один раз — эта авторизация будет работать и для Pull/Push, и для пайплайнов.
edit-repository-sign-in-2 = Изменить авторизацию репозитория

## src/components/Toolbar.tsx

pull-fast-forward-otherwise-merge = Pull — перемотать, иначе слить (merge)
pull-fast-forward-only = Pull — только перемотка (fast-forward)
pull-rebase = Pull — перебазировать (rebase)
no-remote = Нет remote
from-6 = {" "}из { $a0 }
push-to = Push в { $a0 }
push-publish-branch-and-set = Push — опубликовать ветку и установить upstream
repository-2 = репозиторий
click-open-another-repository-right =
    { $a0 }
    Клик — открыть другой репозиторий, правый клик — открыть папку или терминал
nothing-to-undo = Нечего отменять
nothing-to-redo = Нечего повторять
create-branch-4 = Создать ветку
stash-changes-2 = Спрятать { $a0 } изменений
apply-3 = Применить { $a0 }: { $a1 }
search-commits-ctrl-f = Поиск коммитов (Ctrl+F)
settings-ctrl = Настройки (Ctrl+,)
repository-has-no-remote = У репозитория нет remote
has-no-remote = { $a0 } нет remote
checking-3 = проверка…
checking-access-to-remote = Проверяем доступ к remote
no-access = нет доступа
read-only = только чтение
read-and-write = { $a0 }: чтение и запись
read-write-not-checked = { $a0 }: чтение (запись не проверялась)
click-for-details =
    { $a0 }
    Нажмите для подробностей
pull-and-fetch-modes = Режимы Pull и Fetch
selected-mode-becomes-default = Выбранный режим станет режимом по умолчанию
switch-branch-ctrl-b = Переключить ветку (Ctrl+B)

## src/lib/actions.ts

find-out-whats-new-on = Узнать, что нового на сервере
fetch-download-new-data-from = Fetch — загрузить новое с сервера
bring-changes-into-current-branch = Забрать изменения в текущую ветку
mode = Режим
fast-forward-if-possible = Fast-forward, если возможно
fast-forward-only = Только fast-forward
fast-forward-only-2 = {" "}(только fast-forward)
push-current-branch = Отправить текущую ветку
force-push-force-with-lease = Force push (--force-with-lease) — нужен после rebase отправленной ветки
force-push-current-branch = Force push текущей ветки
push-current-branch-2 = Push текущей ветки
new-branch-from-any-branch = Новая ветка от любой ветки или коммита
feature-input-task-name-slug = feature/{"{"}input:Название задачи|slug{"}"}
feature-input-name-slug = feature/{"{"}input:Название|slug{"}"}
from-7 = От чего
switch-to-it-right-away = Сразу переключиться на неё
create-branch-from = Создать ветку «{ $a0 }» от { $a1 }{ $a2 }
and-switch = {" "}и переключиться
checkout-respects-smart-switching = Checkout (учитывает «умное переключение»)
move-current-branch-on-top = Перенести текущую ветку поверх другой
onto-2 = На что
rebase-current-branch-onto = Rebase текущей ветки на { $a0 }
merge-branch-into-current-one = Слить ветку в текущую
which-branch-to-merge = Какую ветку слить
merge-into-current-branch = Слить { $a0 } в текущую ветку
local-branch-undo-brings-it = Локальная ветка (Undo вернёт)
even-if-not-merged = Даже если не слита
delete-branch-5 = Удалить ветку { $a0 }{ $a1 }
forced = {" "}(принудительно)
stash-uncommitted-changes = Спрятать незакоммиченные изменения
label-optional = Подпись (необязательно)
stash-changes-3 = Спрятать изменения{ $a0 }
pop-last-stash-2 = Вернуть последний stash
with-pre-commit-guard-check = С проверкой Pre-commit Guard
message = Сообщение
input-commit-message = {"{"}input:Сообщение коммита{"}"}
stage-all-changes-first-stage = Сначала добавить все изменения (Stage all)
commit-7 = Коммит «{ $a0 }»{ $a1 }
of-all-changes = {" "}всех изменений
gitlab-via-api-github-pr = GitLab — через API, GitHub — откроется страница PR
into-which-branch = В какую ветку
title = Заголовок
draft = Черновик (Draft)
open-in-browser = Открыть в браузере
from-current-branch-into = { $a0 } из текущей ветки в { $a1 }
draft-mr = Черновик MR
ask = Спросить
pause-continue-or-stop = Пауза: продолжить или остановиться
question = Вопрос
ask-2 = Спросить: «{ $a0 }»
custom-git-command = Своя git-команда
any-git-command-no-shell = Любая команда git (без shell)
command = Команда
server-4 = Сервер
new-task-mr = Новая задача → MR
branch-from-main-rebase-onto = Ветка от основной, rebase на свежую основу, push и merge request
new-task = Новая задача
input-task-name = {"{"}input:Название задачи{"}"}
update-branch-from-main = Обновить ветку из основной
fetch-rebase-onto-origin-main = Fetch, rebase на origin/основную и force push
update-from-main = Обновить из main
finish-task = Закончить задачу
commit-all-changes-push-and = Коммит всех изменений, push и merge request
send-for-review = Отправить на ревью
pull-in-main-branch = Подтянуть основную ветку
switch-to-main-pull-and = Переключиться на основную, pull и вернуться обратно
update-main = Обновить main
branch-merged-clean-up = Ветка слита — убрать
switch-to-main-pull-and-delete = Переключиться на основную, pull и удалить ветку, с которой начали
clean-up-merged-branch = Убрать слитую ветку
delete-branch-start-after-updating = Удалить ветку {"{"}start{"}"} после обновления основной?
current-branch-at-time-of = текущая ветка в момент шага
branch-action-was-started-from = ветка, с которой запустили действие
main-branch-main-master = основная ветка (main / master)
todays-date-2026-10-26 = сегодняшняя дата, 2026-10-26
input-question = {"{"}input:Вопрос{"}"}
ask-at-run-time = спросить при запуске
input-question-slug = {"{"}input:Вопрос|slug{"}"}
ask-and-make-branch-name = спросить и сделать имя ветки: «Новая форма» → novaya-forma
modifier-is-needed-ctrl-alt = Нужен модификатор: Ctrl, Alt или Shift
shift-letter-gets-in-way = Shift + буква мешает вводу текста — добавьте Ctrl или Alt
this-shortcut-is-already-taken = Это сочетание уже занято программой
already-assigned-to-action = Уже назначено действию «{ $a0 }»
enter-name-2 = Введите название
add-at-least-one-step = Добавьте хотя бы один шаг
step-unknown-type = Шаг { $a0 }: неизвестный тип
step-fill-in = Шаг { $a0 } «{ $a1 }»: заполните «{ $a2 }»

## src/lib/ansi.ts

error-2 = Ошибка:{" "}
warning-2 = Предупреждение:{" "}
group = Группа

## src/lib/appearance.ts

dark = Тёмная
light = Светлая
midnight = Полночь
dracula = Дракула
monokai = Монокай
forest = Лес
sakura = Сакура
black = Чёрная
glow = Сияние
soft-colored-spots-behind-glass = Мягкие цветные пятна за стеклом
aurora = Аврора
shimmering-bands-like-northern-lights = Переливающиеся полосы, как северное сияние
grid = Сетка
thin-grid-and-glow-from = Тонкая сетка и свечение сверху
gradient = Градиент
calm-static-gradient = Спокойный статичный градиент
solid = Однотонный
no-effects = Без эффектов
image-2 = Картинка
your-own-image-with-blur = Своё изображение с размытием и затемнением
desktop-shows-through-window-mica = Сквозь окно видно рабочий стол (Mica / Acrylic, Windows 11)
system = Как в системе

## src/lib/ciSnippets.ts

repository-checkout = Checkout репозитория
dependency-caching = Кэширование зависимостей
docker-image-build = Сборка Docker-образа
ssh-deploy = Деплой по SSH
name-ssh-deploy-uses-appleboy =
    - name: Деплой по SSH
    {"  "}uses: appleboy/ssh-action@v1
    {"  "}with:
    {"    "}host: ${"{"}{"{"} secrets.DEPLOY_HOST {"}"}{"}"}
    {"    "}username: ${"{"}{"{"} secrets.DEPLOY_USER {"}"}{"}"}
    {"    "}key: ${"{"}{"{"} secrets.DEPLOY_KEY {"}"}{"}"}
    {"    "}script: |
    {"      "}cd /srv/app
    {"      "}git pull
    {"      "}./restart.sh
checkout-clone-depth-and-strategy = Checkout: глубина и стратегия клона
job-docker-image-build = Задание: сборка Docker-образа
job-ssh-deploy = Задание: деплой по SSH
checkout-clone-depth = Checkout: глубина клона
step-docker-image-build = Шаг: сборка Docker-образа
step-name-image-build-services =
    - step:
    {"    "}name: Сборка образа
    {"    "}services: [docker]
    {"    "}script:
    {"      "}- docker build -t app:$BITBUCKET_COMMIT .
step-ssh-deploy = Шаг: деплой по SSH
step-name-deploy-deployment-production =
    - step:
    {"    "}name: Деплой
    {"    "}deployment: production
    {"    "}trigger: manual
    {"    "}script:
    {"      "}- pipe: atlassian/ssh-run:0.8.1
    {"        "}variables:
    {"          "}SSH_USER: $DEPLOY_USER
    {"          "}SERVER: $DEPLOY_HOST
    {"          "}COMMAND: 'cd /srv/app && git pull && ./restart.sh'

## src/lib/commitMsg.ts

new-feature = Новая возможность
bug-fix = Исправление ошибки
code-rework-without-behavior-changes = Переделка кода без изменения поведения
chores-dependencies-configs-build = Рутина: зависимости, конфиги, сборка
documentation = Документация
formatting-whitespace-no-logic-changes = Форматирование, пробелы, без изменения логики
tests = Тесты
performance = Производительность
in-square-brackets-at-start = В квадратных скобках в начале
instead-of-scope-without-type = Вместо scope; без типа — в скобках в начале
at-end-as-on-github = В конце, как в GitHub
on-separate-line-at-end = Отдельной строкой в конце Description
what-was-done-how-to-test = Что сделано / Как проверить
what-was-done-how-to-test-1 =
    Что сделано:
    -{" "}
    {""}
    Как проверить:
    1.{" "}
    {""}
    Задача: {"{"}ticket{"}"}
problem-cause-solution-how-to =
    Проблема:
    {""}
    Причина:
    {""}
    Решение:
    {""}
    Как проверить:
    {""}
breaking-change = Несовместимое изменение
breaking-change-what-to-do =
    BREAKING CHANGE:{" "}
    {""}
    Что сделать при обновлении:
    -{" "}

## src/lib/cron.ts

every-day-at-3-00 = Каждый день в 3:00
weekdays-at-9-00 = По будням в 9:00
every-hour = Каждый час
every-15-minutes = Каждые 15 минут
mondays-at-4-00 = По понедельникам в 4:00
n-1st-of-every-month = 1-го числа каждого месяца в 2:00

## src/lib/format.ts

just-now = только что
min-ago = { $a0 } мин назад
h-ago = { $a0 } ч назад
yesterday = вчера
d-ago = { $a0 } дн назад

## src/lib/graphView.ts

branch-tag = Ветка / тег
graph = Граф
sha-commit-hash = SHA (хэш коммита)
author-3 = Автор
date-time = Дата / время
compact = Компактный
standard = Стандартный
roomy = Свободный
absolute = Абсолютный
relative = Относительный
n-15-min-ago-yesterday = 15 мин назад, вчера
avatars-initials = Аватары / инициалы
compact-dots = Компактные точки

## src/lib/guardRules.ts

aws-key-aws = Ключ AWS (AWS_…)
sk-api-key = API-ключ sk-…
github-token = Токен GitHub
gitlab-token = Токен GitLab
slack-token-2 = Токен Slack
google-api-key-2 = Ключ Google API
bearer-token = Bearer-токен
password-or-key-in-code = Пароль или ключ в коде
conflict-marker = Маркер конфликта
only-in-tests = {"."}only в тестах
looks-like-secret = Похоже на секрет
forgotten-debug-code = Забытая отладка
custom-rules = Свои правила
off = Выкл
rule-isnt-checked = Правило не проверяется
warn = Предупреждать
show-and-ask-whether-to = Показать и спросить, коммитить ли всё равно
forbid = Запрещать
commit-isnt-created-until-line = Коммит не создаётся, пока строка не исправлена или не помечена gorynych-ignore

## src/lib/highlight.ts

expression-matches-empty-string = Выражение совпадает с пустой строкой
invalid-expression = Неверное выражение: { $a0 }

## src/lib/platform.ts

are-encrypted = шифруются
is-encrypted = шифруется
stored = хранится
in-macos-keychain-and-only = { $a0 } { $a1 } в Связке ключей macOS (Keychain) и { $a2 } только на этом компьютере.
with-windows-tools-dpapi-and = { $a0 } { $a1 } средствами Windows (DPAPI) и { $a2 } только на этом компьютере.
by-system-keyring-gnome-keyring = { $a0 } { $a1 } системным хранилищем ключей (GNOME Keyring / KWallet) и { $a2 } только на этом компьютере.
install-git-run-xcode-select = установите Git: в Терминале выполните xcode-select --install (или brew install git)
install-git-for-windows-git-scm = установите Git for Windows (git-scm.com)
install-git-from-package-manager = установите Git из менеджера пакетов (например, sudo apt install git)
show-in-finder = Показать в Finder
open-in-explorer = Открыть в Проводнике
open-in-file-manager = Открыть в файловом менеджере
open-in-terminal = Открыть в Терминале
open-in-terminal-command-line = Открыть в терминале (командной строке)
open-in-terminal-2 = Открыть в терминале

## src/lib/servers.ts

other-git-server = Другой Git-сервер
git-server = Git-сервер
ghp-or-github-pat = ghp_… или github_pat_…
access-token-2 = токен доступа

## src/lib/stashName.ts

stashed-when-switching-branches = спрятано при переключении ветки
edits-in = Правки в { $a0 }
at = на { $a0 }{ $a1 }
ago = {" "}назад

## src/lib/syncStatus.ts

realtime = Реалтайм
every-5-seconds = каждые 5 секунд
fast = Быстро
every-15-seconds = каждые 15 секунд
standard-2 = Стандартно
every-30-seconds = каждые 30 секунд
rare = Редко
every-5-minutes = каждые 5 минут

## src/state/repoStore.ts

window-api-is-unavailable = window.api недоступен — интерфейс открыт вне приложения (запускайте gorynych-tauri).

## src/state/syncStore.ts

no-connection-to-server = Нет связи с сервером

## src/lib/mainBranches.ts (главные ветки графа)

main-branches = Главные ветки
main-branch-pinned = Главная ветка: своя дорожка слева
make-main-branch = Сделать главной веткой
remove-from-main-branches = Убрать из главных веток
main-branches-limit = Главных веток не больше { $a0 }
add-main-branch = Добавить ветку…
detect-main-branches-automatically = Определять автоматически
main-branches-auto-hint = Выбраны автоматически: main, master или trunk и develop или dev
main-branch-absent = Такой ветки нет в репозитории
main-branch-unloaded = Вершина ветки за пределами загруженной истории
no-main-branches = Главных веток нет — дорожки раскладываются как обычно
find-branch = Найти ветку…
lanes-hidden-stretch-column = Скрыто дорожек: { $a0 }. Растяните колонку или дважды щёлкните по границе

## Догрузка истории графа (repoStore.loadMore)

loading-history = Загрузка истории…
load-more-history = Загрузить ещё
